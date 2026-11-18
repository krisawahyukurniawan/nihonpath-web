export const { normalizeMask, scoreMasks } = (() => {
  'use strict';

  const SIZE = 64;
  const PADDING = 6;
  const SIGMA = 1.8;
  const SUPPORT_THRESHOLD = 0.05;
  const ink = (value) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);
  const percent = (value) => Math.round(100 * ink(value));

  // Masks contain row-major alpha coverage in 0..1, NOT RGBA bytes. Null is empty.
  // Pixel-area resampling preserves coverage and proportional scale, including taps.
  function normalizeMask(mask, { size = SIZE, padding = PADDING } = {}) {
    if (!Number.isInteger(size) || size < 1 || !Number.isInteger(padding) || padding < 0 || padding * 2 >= size) {
      throw new RangeError('Normalization requires a positive integer size and padding smaller than half the size.');
    }
    const normalized = { width: size, height: size, data: new Float64Array(size * size) };
    if (mask == null) return normalized;
    const { width, height, data } = mask;
    if (!Number.isInteger(width) || width < 0 || !Number.isInteger(height) || height < 0 || data?.length !== width * height) {
      throw new RangeError('A mask needs integer dimensions and width × height alpha values.');
    }

    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (ink(data[y * width + x]) > 0) {
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
      }
    }
    if (right < left) return normalized;

    const boxWidth = right - left + 1;
    const boxHeight = bottom - top + 1;
    const scale = (size - padding * 2) / Math.max(boxWidth, boxHeight);
    const offsetX = (size - boxWidth * scale) / 2;
    const offsetY = (size - boxHeight * scale) / 2;
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const alpha = ink(data[y * width + x]);
        if (alpha === 0) continue;
        const x0 = offsetX + (x - left) * scale;
        const y0 = offsetY + (y - top) * scale;
        const x1 = offsetX + (x - left + 1) * scale;
        const y1 = offsetY + (y - top + 1) * scale;
        for (let dy = Math.max(0, Math.floor(y0)); dy < Math.min(size, Math.ceil(y1)); dy += 1) {
          const coverageY = Math.max(0, Math.min(dy + 1, y1) - Math.max(dy, y0));
          for (let dx = Math.max(0, Math.floor(x0)); dx < Math.min(size, Math.ceil(x1)); dx += 1) {
            const coverageX = Math.max(0, Math.min(dx + 1, x1) - Math.max(dx, x0));
            normalized.data[dy * size + dx] += alpha * coverageX * coverageY;
          }
        }
      }
    }
    for (let i = 0; i < normalized.data.length; i += 1) {
      normalized.data[i] = ink(normalized.data[i]);
    }
    return normalized;
  }

  // Deterministic separable Gaussian convolution (sigma 1.8 normalized pixels,
  // radius ceil(3 sigma), transparent outside the image). Thresholding the blur
  // expands support; union with original ink guarantees self-comparisons = 100.
  function toleranceSupport(mask) {
    const { width, height, data } = mask;
    const radius = Math.ceil(SIGMA * 3);
    const kernel = Array.from({ length: radius * 2 + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * SIGMA ** 2)));
    const weight = kernel.reduce((sum, value) => sum + value, 0);
    const horizontal = new Float64Array(data.length);
    const support = new Uint8Array(data.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        for (let k = -radius; k <= radius; k += 1) {
          if (x + k >= 0 && x + k < width) {
            horizontal[y * width + x] += data[y * width + x + k] * kernel[k + radius] / weight;
          }
        }
      }
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let blurred = 0;
        for (let k = -radius; k <= radius; k += 1) {
          if (y + k >= 0 && y + k < height) {
            blurred += horizontal[(y + k) * width + x] * kernel[k + radius] / weight;
          }
        }
        support[y * width + x] = data[y * width + x] > 0 || blurred >= SUPPORT_THRESHOLD ? 1 : 0;
      }
    }
    return support;
  }

  // Independent ink bounding boxes remove translation and uniform bitmap scale,
  // not rotation or aspect ratio. Count accuracy is symmetric: min / max.
  // No stroke order, direction, proficiency, or JLPT assessment is performed.
  function scoreMasks(user, reference, { userStrokeCount = 1, referenceStrokeCount = 1 } = {}) {
    const userMask = normalizeMask(user);
    const referenceMask = normalizeMask(reference);
    const userSupport = toleranceSupport(userMask);
    const referenceSupport = toleranceSupport(referenceMask);
    const comparison = {
      width: SIZE,
      height: SIZE,
      overlap: new Float64Array(SIZE * SIZE),
      extra: new Float64Array(SIZE * SIZE),
      missing: new Float64Array(SIZE * SIZE),
    };
    let userInk = 0;
    let referenceInk = 0;
    let supportedUser = 0;
    let supportedReference = 0;
    for (let i = 0; i < userMask.data.length; i += 1) {
      const u = userMask.data[i];
      const r = referenceMask.data[i];
      userInk += u;
      referenceInk += r;
      supportedUser += u * referenceSupport[i];
      supportedReference += r * userSupport[i];
      // Cyan represents tolerance-supported ink, not only exact pixel overlap.
      comparison.overlap[i] = Math.max(u * referenceSupport[i], r * userSupport[i]);
      comparison.extra[i] = u * (1 - referenceSupport[i]);
      comparison.missing[i] = r * (1 - userSupport[i]);
    }

    if (userInk === 0 || referenceInk === 0) {
      return { total: 0, precision: 0, recall: 0, f1: 0, count: 0, comparison };
    }
    const precision = supportedUser / userInk;
    const recall = supportedReference / referenceInk;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    const validCounts = Number.isInteger(userStrokeCount) && userStrokeCount > 0
      && Number.isInteger(referenceStrokeCount) && referenceStrokeCount > 0;
    const count = validCounts ? Math.min(userStrokeCount, referenceStrokeCount) / Math.max(userStrokeCount, referenceStrokeCount) : 0;
    return {
      total: percent(f1 * count),
      precision: percent(precision),
      recall: percent(recall),
      f1: percent(f1),
      count: percent(count),
      comparison,
    };
  }

  return { normalizeMask, scoreMasks };
})();
