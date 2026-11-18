(function () {
  'use strict';

  const N = 32;
  const SHAPE_MAX = 0.15;
  const STROKE_MAX = 0.25;
  const SHAPE_WEIGHT = 0.6;
  const COUNT_WEIGHT = 0.15;
  const ORDER_WEIGHT = 0.25;

  function clamp(value) {
    return Math.max(0, Math.min(1, value));
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function resample(stroke) {
    if (!stroke.length) {
      return [];
    }

    const lengths = [0];
    for (let i = 1; i < stroke.length; i += 1) {
      lengths.push(lengths[i - 1] + distance(stroke[i - 1], stroke[i]));
    }

    const length = lengths[lengths.length - 1];
    if (length === 0) {
      return Array.from({ length: N }, function () {
        return { x: stroke[0].x, y: stroke[0].y };
      });
    }

    const points = [];
    let segment = 1;
    for (let i = 0; i < N; i += 1) {
      const target = (length * i) / (N - 1);
      while (segment < stroke.length - 1 && lengths[segment] < target) {
        segment += 1;
      }
      const start = stroke[segment - 1];
      const end = stroke[segment];
      const span = lengths[segment] - lengths[segment - 1];
      const fraction = span === 0 ? 0 : (target - lengths[segment - 1]) / span;
      points.push({
        x: start.x + (end.x - start.x) * fraction,
        y: start.y + (end.y - start.y) * fraction,
      });
    }
    return points;
  }

  function normalize(strokes) {
    const sampled = strokes.map(resample);
    const points = sampled.flat();
    if (!points.length) {
      return sampled;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const scale = Math.max(maxX - minX, maxY - minY) || 1;
    return sampled.map(function (stroke) {
      return stroke.map(function (point) {
        return {
          x: (point.x - centerX) / scale,
          y: (point.y - centerY) / scale,
        };
      });
    });
  }

  function nearestMean(points, targets) {
    let sum = 0;
    for (const point of points) {
      let nearest = Infinity;
      for (const target of targets) {
        nearest = Math.min(nearest, distance(point, target));
      }
      sum += nearest;
    }
    return sum / points.length;
  }

  function score(userStrokes, refStrokes) {
    const empty = { total: 0, shape: 0, count: 0, order: 0, notes: [] };
    if (!userStrokes.length || !refStrokes.length) {
      return empty;
    }

    const user = normalize(userStrokes);
    const reference = normalize(refStrokes);
    const userPoints = user.flat();
    const refPoints = reference.flat();
    if (!userPoints.length || !refPoints.length) {
      return empty;
    }

    const d = (nearestMean(userPoints, refPoints) + nearestMean(refPoints, userPoints)) / 2;
    const shape = clamp(1 - d / SHAPE_MAX);
    const count = Math.max(0, 1 - Math.abs(user.length - reference.length) / reference.length);
    const notes = [];
    let similaritySum = 0;

    for (let i = 0; i < reference.length; i += 1) {
      if (!user[i] || !user[i].length || !reference[i].length) {
        continue;
      }

      let df = 0;
      let dr = 0;
      for (let j = 0; j < N; j += 1) {
        df += distance(user[i][j], reference[i][j]);
        dr += distance(user[i][N - 1 - j], reference[i][j]);
      }
      df /= N;
      dr /= N;
      let similarity = clamp(1 - Math.min(df, dr) / STROKE_MAX);
      if (dr < df) {
        similarity *= 0.5;
        if (notes.length < 3) {
          notes.push('Stroke ' + (i + 1) + ': try the other direction.');
        }
      } else if (similarity < 0.5 && notes.length < 3) {
        notes.push('Stroke ' + (i + 1) + ': check its position or order.');
      }
      similaritySum += similarity;
    }

    const order = similaritySum / reference.length;
    return {
      total: Math.round(100 * (SHAPE_WEIGHT * shape + COUNT_WEIGHT * count + ORDER_WEIGHT * order)),
      shape: Math.round(100 * shape),
      count: Math.round(100 * count),
      order: Math.round(100 * order),
      notes: notes,
    };
  }

  if (typeof module !== 'undefined') {
    module.exports = score;
  } else {
    window.KanjiScore = score;
  }
})();
