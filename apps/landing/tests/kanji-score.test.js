import test from 'node:test';
import { strict as assert } from 'node:assert';

function restoreGlobal(name, descriptor) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    delete globalThis[name];
  }
}

// The scorer is a classic script inside an ESM monorepo; stub CommonJS to test its export.
const moduleDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'module');
let score;
try {
  globalThis.module = { exports: {} };
  await import('../web/kanji-score.js');
  score = globalThis.module.exports;
} finally {
  restoreGlobal('module', moduleDescriptor);
}

const san = [
  [
    { x: 20, y: 25 },
    { x: 50, y: 25 },
    { x: 80, y: 25 },
  ],
  [
    { x: 30, y: 50 },
    { x: 50, y: 50 },
    { x: 70, y: 50 },
  ],
  [
    { x: 10, y: 75 },
    { x: 50, y: 75 },
    { x: 90, y: 75 },
  ],
];
const kawa = [
  [
    { x: 25, y: 15 },
    { x: 25, y: 50 },
    { x: 25, y: 85 },
  ],
  [
    { x: 50, y: 20 },
    { x: 50, y: 50 },
    { x: 50, y: 80 },
  ],
  [
    { x: 75, y: 10 },
    { x: 75, y: 50 },
    { x: 75, y: 90 },
  ],
];

function transform(strokes, scale, offset) {
  return strokes.map(function (stroke) {
    return stroke.map(function (point) {
      return { x: point.x * scale + offset, y: point.y * scale + offset };
    });
  });
}

function jitter(strokes, seed) {
  let state = seed;
  function noise() {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state / 4294967296) * 4 - 2;
  }
  return strokes.map(function (stroke) {
    return stroke.map(function (point) {
      return { x: point.x + noise(), y: point.y + noise() };
    });
  });
}

function reversed(strokes) {
  return strokes.map(function (stroke) {
    return stroke.slice().reverse();
  });
}

function assertScores(result) {
  for (const key of ['total', 'shape', 'count', 'order']) {
    assert.ok(Number.isInteger(result[key]), key + ' must be an integer');
    assert.ok(result[key] >= 0 && result[key] <= 100, key + ' must be in 0..100');
  }
  assert.ok(Array.isArray(result.notes));
  assert.ok(result.notes.length <= 3);
}

const emptyScore = { total: 0, shape: 0, count: 0, order: 0, notes: [] };

test('exports a scoring function through CommonJS', function () {
  assert.equal(typeof score, 'function');
});

test('self comparisons score at least 95 for 三 and 川', function () {
  for (const glyph of [san, kawa]) {
    const result = score(glyph, glyph);
    assert.ok(result.total >= 95, JSON.stringify(result));
    assert.equal(result.shape, 100);
    assert.equal(result.count, 100);
    assert.equal(result.order, 100);
    assert.deepEqual(result.notes, []);
  }
});

test('translation by 10 and scaling by 0.7 score at least 90', function () {
  for (const glyph of [san, kawa]) {
    for (const [scale, offset] of [
      [1, 10],
      [0.7, 0],
      [0.7, 10],
    ]) {
      const result = score(transform(glyph, scale, offset), glyph);
      assert.ok(result.total >= 90, JSON.stringify(result));
    }
  }
});

test('seeded per-point jitter within ±2 scores at least 80', function () {
  for (const glyph of [san, kawa]) {
    const result = score(jitter(glyph, 20261119), glyph);
    assert.ok(result.total >= 80, JSON.stringify(result));
  }
});

test('reversing all directions lowers order and total with direction notes', function () {
  for (const glyph of [san, kawa]) {
    const result = score(reversed(glyph), glyph);
    assert.ok(result.order <= 60, JSON.stringify(result));
    assert.ok(result.total <= score(glyph, glyph).total - 10, JSON.stringify(result));
    assert.equal(result.shape, 100);
    assert.deepEqual(result.notes, [
      'Stroke 1: try the other direction.',
      'Stroke 2: try the other direction.',
      'Stroke 3: try the other direction.',
    ]);
  }
});

test('bottom-first 三 scores lower than the correct stroke order', function () {
  const result = score([san[2], san[0], san[1]], san);
  assert.ok(result.total < score(san, san).total);
  assert.equal(result.shape, 100);
  assert.equal(result.count, 100);
  assert.ok(result.notes.includes('Stroke 1: check its position or order.'));
});

test('川 compared with 三 scores at most 50', function () {
  const result = score(kawa, san);
  assert.ok(result.total <= 50, JSON.stringify(result));
});

test('empty user input returns all zeros and no notes', function () {
  assert.deepEqual(score([], san), emptyScore);
  assert.deepEqual(score([], []), emptyScore);
  assert.deepEqual(score([[], []], san), emptyScore);
});

test('empty references and empty stroke slots are safe', function () {
  assert.deepEqual(score(san, []), emptyScore);
  assert.deepEqual(score(san, [[], []]), emptyScore);
  const missing = score([san[0], [], san[2]], san);
  assert.equal(missing.order, 67);
  assert.deepEqual(missing.notes, []);
  const emptyReference = score(san, [san[0], [], san[2]]);
  assert.equal(emptyReference.order, 67);
  assertScores(missing);
  assertScores(emptyReference);
});

test('stroke count penalizes both missing and extra strokes', function () {
  assert.equal(score([san[0], san[2]], san).count, 67);
  assert.equal(score([...san, san[0]], san).count, 67);
  assert.equal(score([...san, ...san, san[0]], san).count, 0);
  const missing = score(san, [...san, san[0]]);
  assert.equal(missing.order, 75);
  assert.deepEqual(missing.notes, []);
});

test('single points and repeated zero-length paths normalize safely', function () {
  const point = [[{ x: 40, y: 60 }]];
  const repeated = [
    [
      { x: 7, y: 9 },
      { x: 7, y: 9 },
      { x: 7, y: 9 },
    ],
  ];
  assert.equal(score(point, point).total, 100);
  assert.equal(score(repeated, repeated).total, 100);
  assert.equal(score(point, repeated).total, 100);
  assertScores(score(point, san));
  assertScores(score(san, repeated));
});

test('arc-length resampling ignores uneven spacing and duplicate points', function () {
  const uneven = san.map(function (stroke) {
    const start = stroke[0];
    const end = stroke[stroke.length - 1];
    return [start, start, { x: start.x + 1, y: start.y }, end, end];
  });
  assert.deepEqual(score(uneven, san), score(san, san));
  const vertical = kawa.map(function (stroke) {
    return [stroke[0], stroke[0], stroke[2], stroke[2]];
  });
  assert.deepEqual(score(vertical, kawa), score(kawa, kawa));
});

test('shape uses symmetric nearest-point comparisons', function () {
  const subset = [san[0], san[2]];
  assert.equal(score(subset, san).shape, score(san, subset).shape);
});

test('feedback is limited to three notes', function () {
  const reference = [...san, san[0], san[1]];
  const result = score(reversed(reference), reference);
  assert.equal(result.notes.length, 3);
  assert.equal(result.notes[2], 'Stroke 3: try the other direction.');
});

test('scoring does not mutate either input, even when frozen', function () {
  const user = jitter(san, 37);
  const reference = transform(san, 1, 0);
  const before = JSON.stringify([user, reference]);
  for (const glyph of [user, reference]) {
    for (const stroke of glyph) {
      stroke.forEach(Object.freeze);
      Object.freeze(stroke);
    }
    Object.freeze(glyph);
  }
  score(user, reference);
  score(reference, user);
  assert.equal(JSON.stringify([user, reference]), before);
});

test('all scores remain integers within 0..100 across varied inputs', function () {
  const samples = [
    [],
    [[]],
    san,
    kawa,
    reversed(san),
    [san[2]],
    [...san, ...san, ...san],
    [[{ x: 0, y: 0 }]],
    [san[0], [], san[2]],
  ];
  for (let seed = 1; seed <= 10; seed += 1) {
    samples.push(jitter(san, seed));
  }
  for (const user of samples) {
    for (const reference of samples) {
      assertScores(score(user, reference));
    }
  }
});

test('classic browser branch exposes window.KanjiScore without DOM access', async function () {
  const previousModule = Object.getOwnPropertyDescriptor(globalThis, 'module');
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    delete globalThis.module;
    globalThis.window = {};
    await import('../web/kanji-score.js?browser');
    assert.equal(typeof globalThis.window.KanjiScore, 'function');
    assert.deepEqual(globalThis.window.KanjiScore(san, san), score(san, san));
  } finally {
    restoreGlobal('module', previousModule);
    restoreGlobal('window', previousWindow);
  }
});
