import test from 'node:test';
import { strict as assert } from 'node:assert';
import { normalizeMask, scoreMasks } from '../web/kanji-bitmap-score.js';

(() => {
  'use strict';

  function mask(width, height, rectangles = []) {
    const data = new Float64Array(width * height);
    for (const [left, top, w, h, alpha = 1] of rectangles) {
      for (let y = top; y < top + h; y += 1) {
        for (let x = left; x < left + w; x += 1) data[y * width + x] = alpha;
      }
    }
    return { width, height, data };
  }

  const horizontal = mask(40, 40, [
    [5, 5, 30, 2],
    [10, 19, 20, 2],
    [5, 33, 30, 2],
  ]);
  const vertical = mask(40, 40, [
    [5, 5, 2, 30],
    [19, 10, 2, 20],
    [33, 5, 2, 30],
  ]);
  const subset = mask(40, 40, [
    [5, 5, 30, 2],
    [5, 33, 30, 2],
  ]);
  const empty = mask(40, 40);
  const counts = { userStrokeCount: 3, referenceStrokeCount: 3 };

  function transform(source, scale, offsetX, offsetY) {
    const result = mask(source.width * scale + offsetX + 7, source.height * scale + offsetY + 11);
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            result.data[(y * scale + offsetY + dy) * result.width + x * scale + offsetX + dx] =
              source.data[y * source.width + x];
          }
        }
      }
    }
    return result;
  }

  function metrics(result) {
    return Object.fromEntries(
      ['total', 'precision', 'recall', 'f1', 'count'].map((key) => [key, result[key]]),
    );
  }

  function assertBounded(result) {
    for (const [key, value] of Object.entries(metrics(result))) {
      assert.ok(Number.isFinite(value) && Number.isInteger(value), `${key}: ${value}`);
      assert.ok(value >= 0 && value <= 100, `${key} is in 0..100`);
    }
    assert.equal(result.comparison.width, 64);
    assert.equal(result.comparison.height, 64);
    for (const name of ['overlap', 'extra', 'missing']) {
      assert.equal(result.comparison[name].length, 64 * 64);
      for (const alpha of result.comparison[name])
        assert.ok(Number.isFinite(alpha) && alpha >= 0 && alpha <= 1);
    }
  }

  test('native modules import without a DOM or global registration', async () => {
    const before = Reflect.ownKeys(globalThis);
    const { initKanjiStudio } = await import('../web/kanji-practice.js');
    assert.equal(typeof initKanjiStudio, 'function');
    assert.equal(typeof normalizeMask, 'function');
    assert.equal(typeof scoreMasks, 'function');
    assert.deepEqual(Reflect.ownKeys(globalThis), before);
  });

  test('identical opaque, antialiased, and single-pixel masks score exactly 100', () => {
    const antialiased = mask(20, 18, [
      [2, 3, 13, 2, 0.3],
      [3, 10, 10, 3, 0.85],
    ]);
    for (const source of [horizontal, vertical, antialiased, mask(10, 10, [[4, 7, 1, 1]])]) {
      const result = scoreMasks(source, source, counts);
      assert.deepEqual(metrics(result), {
        total: 100,
        precision: 100,
        recall: 100,
        f1: 100,
        count: 100,
      });
      assert.ok(result.comparison.extra.every((alpha) => alpha === 0));
      assert.ok(result.comparison.missing.every((alpha) => alpha === 0));
      assert.ok(result.comparison.overlap.some((alpha) => alpha > 0));
    }
  });

  test('independent bounding boxes remove translation and uniform bitmap scale', () => {
    for (const source of [horizontal, vertical]) {
      for (const [scale, offsetX, offsetY] of [
        [1, 13, 7],
        [2, 0, 0],
        [3, 11, 4],
      ]) {
        const moved = transform(source, scale, offsetX, offsetY);
        const expected = normalizeMask(source);
        const actual = normalizeMask(moved);
        for (let i = 0; i < expected.data.length; i += 1) {
          assert.ok(Math.abs(actual.data[i] - expected.data[i]) < 1e-12, `pixel ${i}`);
        }
        assert.equal(scoreMasks(moved, source, counts).total, 100);
        assert.equal(scoreMasks(source, moved, counts).total, 100);
      }
    }
  });

  test('normalization is proportional, centered, and padded, not stretched square', () => {
    const normalized = normalizeMask(mask(50, 30, [[10, 10, 20, 10]]));
    const occupied = [];
    normalized.data.forEach((alpha, i) => {
      if (alpha > 0) occupied.push([i % 64, Math.floor(i / 64)]);
    });
    assert.equal(Math.min(...occupied.map(([x]) => x)), 6);
    assert.equal(Math.max(...occupied.map(([x]) => x)), 57);
    assert.equal(Math.min(...occupied.map(([, y]) => y)), 19);
    assert.equal(Math.max(...occupied.map(([, y]) => y)), 44);
  });

  test('empty user, empty reference, and zero-area inputs return zero metrics', () => {
    for (const blank of [empty, null, { width: 0, height: 0, data: [] }]) {
      for (const [user, reference] of [
        [blank, horizontal],
        [horizontal, blank],
        [blank, blank],
      ]) {
        assert.deepEqual(metrics(scoreMasks(user, reference, counts)), {
          total: 0,
          precision: 0,
          recall: 0,
          f1: 0,
          count: 0,
        });
      }
    }
  });

  test('unrelated horizontal and vertical masks score low, without rotation invariance', () => {
    assert.ok(scoreMasks(horizontal, vertical, counts).total < 40);
    assert.ok(scoreMasks(vertical, horizontal, counts).total < 40);
  });

  test('Gaussian support tolerates a small local offset, but not a large one', () => {
    const near = mask(40, 40, [
      [5, 5, 30, 2],
      [10, 20, 20, 2],
      [5, 33, 30, 2],
    ]);
    const far = mask(40, 40, [
      [5, 5, 30, 2],
      [10, 27, 20, 2],
      [5, 33, 30, 2],
    ]);
    assert.equal(scoreMasks(near, horizontal, counts).total, 100);
    assert.ok(scoreMasks(far, horizontal, counts).total < 90);
  });

  test('precision penalizes extra ink and recall penalizes missing ink symmetrically', () => {
    const missing = scoreMasks(subset, horizontal, counts);
    const extra = scoreMasks(horizontal, subset, counts);
    assert.equal(missing.precision, 100);
    assert.ok(missing.recall < 85);
    assert.equal(extra.recall, 100);
    assert.ok(extra.precision < 85);
    assert.equal(missing.precision, extra.recall);
    assert.equal(missing.recall, extra.precision);
    assert.equal(missing.f1, extra.f1);
    assert.equal(missing.total, extra.total);
    assert.ok(missing.comparison.missing.some((alpha) => alpha > 0));
    assert.ok(extra.comparison.extra.some((alpha) => alpha > 0));
    assert.ok(missing.comparison.extra.every((alpha) => alpha === 0));
  });

  test('stroke multiplier penalizes both missing and extra, symmetric under swapping counts', () => {
    for (const [userStrokeCount, referenceStrokeCount, expected] of [
      [2, 3, 67],
      [3, 2, 67],
      [4, 3, 75],
      [3, 4, 75],
      [1, 3, 33],
      [3, 1, 33],
    ]) {
      const result = scoreMasks(horizontal, horizontal, { userStrokeCount, referenceStrokeCount });
      assert.equal(result.f1, 100);
      assert.equal(result.count, expected);
      assert.equal(result.total, expected);
    }
    const geometricMismatch = scoreMasks(horizontal, vertical, counts);
    const withExtraStroke = scoreMasks(horizontal, vertical, {
      userStrokeCount: 6,
      referenceStrokeCount: 3,
    });
    assert.ok(Math.abs(withExtraStroke.total - geometricMismatch.f1 / 2) <= 1);
  });

  test('nonpositive or invalid stroke counts cannot produce a positive total', () => {
    for (const invalid of [0, -1, 1.5, NaN, Infinity]) {
      for (const options of [
        { userStrokeCount: invalid, referenceStrokeCount: 3 },
        { userStrokeCount: 3, referenceStrokeCount: invalid },
      ]) {
        const result = scoreMasks(horizontal, horizontal, options);
        assert.equal(result.total, 0);
        assert.equal(result.count, 0);
        assertBounded(result);
      }
    }
  });

  test('mask validation rejects inconsistent dimensions; alpha values are sanitized', () => {
    assert.throws(() => normalizeMask({ width: 2, height: 3, data: [1] }), RangeError);
    assert.throws(() => normalizeMask({ width: -1, height: 1, data: [] }), RangeError);
    assert.throws(() => normalizeMask(horizontal, { size: 64, padding: 32 }), RangeError);
    const unusual = { width: 3, height: 2, data: [NaN, Infinity, -1, 2, 0.4, 0] };
    assertBounded(scoreMasks(unusual, horizontal, counts));
  });

  test('scoring and normalization never mutate inputs or share output buffers', () => {
    const user = Object.freeze({ ...horizontal, data: Object.freeze(Array.from(horizontal.data)) });
    const reference = Object.freeze({
      ...vertical,
      data: Object.freeze(Array.from(vertical.data)),
    });
    const before = JSON.stringify([user, reference]);
    normalizeMask(user);
    const first = scoreMasks(user, reference, counts);
    const repeat = scoreMasks(user, reference, counts);
    scoreMasks(reference, user, counts);
    assert.deepEqual(first, repeat);
    assert.equal(JSON.stringify([user, reference]), before);
    first.comparison.overlap.fill(0);
    assert.deepEqual(scoreMasks(user, reference, counts), repeat);
  });

  test('all outputs are finite and bounded across varied deterministic masks', () => {
    let state = 20261119;
    const noise = mask(40, 40);
    for (let i = 0; i < noise.data.length; i += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      noise.data[i] = state % 19 === 0 ? (state % 255) / 255 : 0;
    }
    const samples = [empty, horizontal, vertical, subset, noise, mask(40, 40, [[2, 30, 1, 1]])];
    for (const user of samples) {
      for (const reference of samples) assertBounded(scoreMasks(user, reference, counts));
    }
  });
})();
