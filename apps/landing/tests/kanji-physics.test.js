import test from 'node:test';
import { strict as assert } from 'node:assert';
import { initPhysics, stepBodies } from '../web/kanji-physics.js';

const box = { width: 500, height: 360 };
const body = (values = {}) => ({ x: 100, y: 100, width: 64, height: 64, vx: 0, vy: 0, ...values });
const close = (actual, expected, tolerance = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be close to ${expected}`);
};
const overlap = (a, b) =>
  Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1e-5 &&
  Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1e-5;

function bounded(bodies, bounds) {
  for (const item of bodies) {
    for (const key of ['x', 'y', 'width', 'height', 'vx', 'vy'])
      assert.ok(Number.isFinite(item[key]), key);
    assert.ok(item.x >= -1e-7 && item.x + item.width <= bounds.width + 1e-7);
    assert.ok(item.y >= -1e-7 && item.y + item.height <= bounds.height + 1e-7);
    assert.ok(Math.hypot(item.vx, item.vy) <= 720 + 1e-7);
  }
}

test('native module exports the initializer and a pure immutable step', () => {
  assert.equal(typeof initPhysics, 'function');
  const source = Object.freeze([Object.freeze(body({ glyph: '日', vx: 20 }))]);
  const bounds = Object.freeze({ ...box });
  const gravity = Object.freeze({ x: 0, y: 0 });
  const next = stepBodies(source, bounds, 0.02, gravity);
  assert.notEqual(next, source);
  assert.notEqual(next[0], source[0]);
  assert.equal(source[0].x, 100);
  assert.equal(next[0].glyph, '日');
  close(next[0].x, 100.4);
  assert.deepEqual(stepBodies(source, bounds, 0.02, gravity), next);
});

test('opposing equal-mass tiles collide elastically without overlap', () => {
  const next = stepBodies(
    [body({ x: 100, vx: 100, vy: 12 }), body({ x: 165, vx: -100, vy: 12 })],
    box,
    0.02,
  );
  close(next[0].vx, -100);
  close(next[1].vx, 100);
  close(next[0].vy, 12);
  close(next[1].vy, 12);
  assert.equal(overlap(...next), false);
  close(
    next.reduce((sum, item) => sum + item.vx, 0),
    0,
  );
  close(
    next.reduce((sum, item) => sum + item.vx ** 2 + item.vy ** 2, 0),
    2 * (100 ** 2 + 12 ** 2),
  );
});

test('vertical elastic impulse leaves tangential velocity unchanged', () => {
  const next = stepBodies(
    [body({ y: 100, vx: 17, vy: 80 }), body({ y: 164, vx: 17, vy: -20 })],
    box,
    0.01,
  );
  close(next[0].vy, -20);
  close(next[1].vy, 80);
  close(next[0].vx, 17);
  assert.equal(overlap(...next), false);
});

test('already separating contacts are corrected without another impulse', () => {
  const next = stepBodies([body({ x: 100, vx: -25 }), body({ x: 160, vx: 25 })], box, 0);
  close(next[0].vx, -25);
  close(next[1].vx, 25);
  assert.equal(overlap(...next), false);
});

test('all four walls use 0.8 restitution and reflect remaining travel', () => {
  const arena = { width: 164, height: 164 };
  for (const axis of ['x', 'y']) {
    const velocity = axis === 'x' ? 'vx' : 'vy';
    for (const side of [-1, 1]) {
      const input = body({ x: 50, y: 50, [axis]: side > 0 ? 99 : 1, [velocity]: side * 100 });
      const [next] = stepBodies([input], arena, 0.02);
      close(next[velocity], -side * 80);
      close(next[axis], side > 0 ? 99.2 : 0.8);
      bounded([next], arena);
    }
  }
});

test('wall-adjacent pair separation does not push a tile out of bounds', () => {
  const next = stepBodies([body({ x: 0 }), body({ x: 50 })], box, 0);
  assert.equal(overlap(...next), false);
  bounded(next, box);
});

test('kinematic drag bodies remain in place and transfer an elastic impulse', () => {
  const next = stepBodies([body({ x: 100, fixed: true, vx: 30 }), body({ x: 160 })], box, 0);
  close(next[0].x, 100);
  close(next[0].vx, 30);
  close(next[1].vx, 60);
  assert.equal(overlap(...next), false);
});

test('a dragged tile can displace a neighbour trapped against a wall', () => {
  const arena = { width: 280, height: 360 };
  const next = stepBodies([body({ x: 215, y: 0, fixed: true }), body({ x: 216, y: 0 })], arena, 0);
  close(next[0].x, 215);
  assert.equal(overlap(...next), false);
  bounded(next, arena);
});

test('non-finite input, degenerate bounds and oversized tiles remain finite', () => {
  for (const arena of [
    { width: 280, height: 180 },
    { width: 0, height: 0 },
  ]) {
    const next = stepBodies(
      [
        body({ x: Infinity, y: NaN, vx: Infinity, vy: -Infinity, width: 900, height: 800 }),
        body({ x: -1e300, y: 1e300, vx: Number.MAX_VALUE, vy: Number.MAX_VALUE }),
      ],
      arena,
      0.05,
      { x: NaN, y: Infinity },
    );
    bounded(next, arena);
  }
  bounded(stepBodies([body()], { width: NaN, height: Infinity }, 1), { width: 0, height: 0 });
});

test('dt guards discard invalid and excess elapsed time', () => {
  const input = [body({ vx: 40, vy: 10 })];
  for (const dt of [0, -0.1, NaN, Infinity, -Infinity, undefined]) {
    assert.deepEqual(stepBodies(input, box, dt), input);
  }
  assert.deepEqual(stepBodies(input, box, 1000), stepBodies(input, box, 0.05));
  const [next] = stepBodies(input, box, 1000);
  close(next.x, 102);
  close(next.y, 100.5);
});

test('substeps prevent opposing fast small tiles from tunnelling', () => {
  const next = stepBodies(
    [body({ x: 80, width: 8, vx: 720 }), body({ x: 100, width: 8, vx: -720 })],
    box,
    0.05,
  );
  assert.ok(next[0].vx < 0 && next[1].vx > 0);
  assert.ok(next[0].x + next[0].width <= next[1].x + 1e-6);
  bounded(next, box);
});

test('gravity uses seconds and speed limiting preserves direction', () => {
  const [next] = stepBodies([body()], box, 0.04, { x: 100, y: 50 });
  close(next.vx, 4);
  close(next.vy, 2);
  const [fast] = stepBodies([body({ vx: 10000, vy: 1000 })], box, 0);
  close(fast.vx / fast.vy, 10);
  close(Math.hypot(fast.vx, fast.vy), 720);
});

test('ten tiles stay bounded and non-overlapping in a 280px arena over time', () => {
  const arena = { width: 280, height: 360 };
  let items = Array.from({ length: 10 }, (_, index) =>
    body({
      x: (index % 4) * 70 + 3,
      y: Math.floor(index / 4) * 110 + 10,
      vx: Math.cos(index * 2.4) * 180,
      vy: Math.sin(index * 2.4) * 140,
    }),
  );
  for (let i = 0; i < 600; i += 1) {
    items = stepBodies(items, arena, 1 / 60, { x: 25, y: 30 });
    bounded(items, arena);
    for (let a = 0; a < items.length; a += 1) {
      for (let b = a + 1; b < items.length; b += 1)
        assert.equal(overlap(items[a], items[b]), false, `frame ${i}, pair ${a}/${b}`);
    }
  }
});

test('deep overlaps from discontinuous pointer moves have deterministic bounded repair', () => {
  let seed = 123;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const arena = { width: 280, height: 360 };
  for (let trial = 0; trial < 200; trial += 1) {
    const input = Array.from({ length: 10 }, () => body({ x: random() * 216, y: random() * 296 }));
    const next = stepBodies(input, arena, 0);
    bounded(next, arena);
    assert.deepEqual(stepBodies(input, arena, 0), next);
    for (let a = 0; a < next.length; a += 1) {
      for (let b = a + 1; b < next.length; b += 1)
        assert.equal(overlap(next[a], next[b]), false, `trial ${trial}`);
    }
  }
});

// Small local DOM/event model: no browser driver, dependencies or global stubs.
class Events {
  handlers = new Map();
  addEventListener(type, handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(handler);
  }
  removeEventListener(type, handler) {
    this.handlers.get(type)?.delete(handler);
  }
  emit(type, values = {}) {
    const event = {
      type,
      target: this,
      detail: 1,
      cancelable: true,
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
      stopPropagation() {},
      ...values,
    };
    for (const handler of [...(this.handlers.get(type) || [])]) handler(event);
    return event;
  }
  count(type) {
    return this.handlers.get(type)?.size || 0;
  }
}

class Element extends Events {
  style = {};
  attributes = new Map();
  children = [];
  textContent = '';
  captures = new Set();
  clientLeft = 0;
  clientTop = 0;
  constructor(doc, width = 0, height = 0) {
    super();
    this.ownerDocument = doc;
    this.clientWidth = width;
    this.clientHeight = height;
    this.left = 0;
    this.top = 0;
  }
  get offsetWidth() {
    return this.clientWidth;
  }
  get offsetHeight() {
    return this.clientHeight;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }
  appendChild(child) {
    this.children.push(child);
    child.parent = this;
  }
  remove() {
    this.parent.children = this.parent.children.filter((child) => child !== this);
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
  setPointerCapture(id) {
    if (this.captureError) throw this.captureError;
    this.captures.add(id);
  }
  hasPointerCapture(id) {
    return this.captures.has(id);
  }
  releasePointerCapture(id) {
    this.captures.delete(id);
    this.emit('lostpointercapture', { pointerId: id });
  }
  getBoundingClientRect() {
    const width = this.parent
      ? Math.min(this.parent.tileSize || 64, parseFloat(this.style.maxWidth) || 64)
      : this.clientWidth;
    const height = this.parent
      ? Math.min(this.parent.tileSize || 64, parseFloat(this.style.maxHeight) || 64)
      : this.clientHeight;
    return {
      left: this.left,
      top: this.top,
      width,
      height,
      right: this.left + width,
      bottom: this.top + height,
    };
  }
}

function setup({ reduced = false, width = 500, height = 360, secure = true, orientation } = {}) {
  const win = new Events();
  const doc = new Events();
  doc.defaultView = win;
  doc.hidden = false;
  doc.documentElement = { clientWidth: 1200, clientHeight: 800 };
  doc.createElement = () => new Element(doc);
  win.innerWidth = 1200;
  win.innerHeight = 800;
  win.isSecureContext = secure;
  win.DeviceOrientationEvent = orientation;
  win.screen = { orientation: { angle: 0 } };
  let clock = 0;
  let id = 0;
  const frames = new Map();
  const timers = new Map();
  win.performance = { now: () => clock };
  win.requestAnimationFrame = (callback) => {
    frames.set(++id, callback);
    return id;
  };
  win.cancelAnimationFrame = (key) => frames.delete(key);
  win.setTimeout = (callback) => {
    timers.set(++id, callback);
    return id;
  };
  win.clearTimeout = (key) => timers.delete(key);
  const media = new Events();
  media.matches = reduced;
  win.matchMedia = () => media;
  const resizers = [];
  const intersections = [];
  win.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      resizers.push(this);
    }
    observe() {}
    disconnect() {
      this.disconnected = true;
    }
  };
  win.IntersectionObserver = class {
    constructor(callback) {
      this.callback = callback;
      intersections.push(this);
    }
    observe() {}
    disconnect() {
      this.disconnected = true;
    }
  };
  const arena = new Element(doc, width, height);
  const pauseButton = new Element(doc);
  const tiltButton = new Element(doc);
  const resetButton = new Element(doc);
  const status = new Element(doc);
  const selected = [];
  let language = 'en';
  const api = initPhysics({
    arena,
    pauseButton,
    tiltButton,
    resetButton,
    status,
    onSelect: (glyph) => selected.push(glyph),
    t: (en, indonesian) => (language === 'en' ? en : indonesian),
  });
  return {
    win,
    doc,
    arena,
    pauseButton,
    tiltButton,
    resetButton,
    status,
    api,
    frames,
    timers,
    media,
    selected,
    resizers,
    intersections,
    locale(value) {
      language = value;
      api.updateLanguage();
    },
    tick(time) {
      clock = time;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(time));
    },
    resize(w, h) {
      arena.clientWidth = w;
      arena.clientHeight = h;
      resizers.forEach((observer) => observer.callback([]));
    },
    visible(value) {
      arena.top = value ? 0 : 2000;
      intersections.forEach((observer) =>
        observer.callback([
          {
            target: arena,
            isIntersecting: value,
            intersectionRect: {
              width: value ? arena.clientWidth : 0,
              height: value ? arena.clientHeight : 0,
            },
          },
        ]),
      );
    },
  };
}
const positions = (h) => h.arena.children.map((tile) => tile.style.transform);
const xy = (tile) =>
  [...tile.style.transform.matchAll(/(-?[\d.]+)px/g)].map((match) => Number(match[1]));
const pointer = (values = {}) => ({
  pointerId: 1,
  isPrimary: true,
  button: 0,
  clientX: 50,
  clientY: 50,
  timeStamp: 0,
  ...values,
});

test('creates accessible glyph buttons and locale updates never reset positions or select', () => {
  const h = setup();
  assert.equal(
    h.arena.children.map((tile) => tile.textContent).join(' '),
    '日 月 山 川 水 火 木 心 旅 道',
  );
  h.arena.children.forEach((tile) => {
    assert.equal(tile.type, 'button');
    assert.equal(tile.className, 'physics-tile');
    assert.match(tile.getAttribute('aria-label'), /Practise/);
  });
  h.tick(0);
  h.tick(16);
  const before = positions(h);
  h.locale('id');
  assert.deepEqual(positions(h), before);
  assert.equal(h.pauseButton.textContent, 'Jeda gerakan');
  assert.match(h.status.textContent, /Tanpa gravitasi/);
  assert.equal(h.status.getAttribute('aria-live'), 'polite');
  assert.deepEqual(h.selected, []);
  h.api.destroy();
});

test('pause and reduced-motion preference prevent autoplay but allow manual selection and movement', () => {
  const h = setup({ reduced: true });
  assert.equal(h.frames.size, 0);
  assert.equal(h.pauseButton.getAttribute('aria-pressed'), 'true');
  assert.match(h.status.textContent, /Motion paused/);
  const tile = h.arena.children[0];
  const old = xy(tile);
  tile.emit('keydown', { key: 'ArrowRight' });
  close(xy(tile)[0], old[0] + 12, 0.001);
  // Native keyboard activation fires click with detail 0.
  tile.emit('click', { detail: 0 });
  assert.deepEqual(h.selected, ['日']);
  h.resetButton.emit('click');
  h.locale('id');
  h.visible(false);
  h.visible(true);
  assert.equal(h.frames.size, 0);
  h.media.emit('change', { matches: false });
  assert.equal(h.frames.size, 0, 'removing the preference must not resume automatically');
  h.pauseButton.emit('click');
  assert.equal(h.frames.size, 1, 'explicit Resume may start motion');
  h.media.emit('change', { matches: true });
  assert.equal(h.frames.size, 0);
  h.api.destroy();
});

test('visibility/offscreen suspend RAF with no catch-up, and reset is deterministic', () => {
  const h = setup();
  const initial = positions(h);
  h.tick(0);
  h.tick(16);
  assert.notDeepEqual(positions(h), initial);
  const before = positions(h);
  h.doc.hidden = true;
  h.doc.emit('visibilitychange');
  assert.equal(h.frames.size, 0);
  h.doc.hidden = false;
  h.doc.emit('visibilitychange');
  h.tick(100000);
  assert.deepEqual(positions(h), before);
  h.visible(false);
  assert.equal(h.frames.size, 0);
  h.visible(true);
  assert.equal(h.frames.size, 1);
  h.resetButton.emit('click');
  assert.deepEqual(positions(h), initial);
  h.pauseButton.emit('click');
  h.resetButton.emit('click');
  assert.equal(h.frames.size, 0);
  h.api.destroy();
});

test('ResizeObserver preserves normalized locations and fits small responsive arenas', () => {
  const h = setup({ reduced: true });
  const before = xy(h.arena.children[0]);
  h.resize(700, 460);
  const after = xy(h.arena.children[0]);
  close(after[0] / (700 - 64), before[0] / (500 - 64), 1e-5);
  close(after[1] / (460 - 64), before[1] / (360 - 64), 1e-5);
  h.resize(0, 0);
  assert.equal(h.frames.size, 0);
  h.resize(280, 180);
  const tiles = h.arena.children.map((tile) => {
    const [x, y] = xy(tile);
    const rect = tile.getBoundingClientRect();
    return body({ x, y, width: rect.width, height: rect.height });
  });
  bounded(tiles, { width: 280, height: 180 });
  h.resetButton.emit('click');
  const reset = h.arena.children.map((tile) => {
    const [x, y] = xy(tile);
    return body({ x, y, ...tile.getBoundingClientRect() });
  });
  for (let a = 0; a < reset.length; a += 1) {
    for (let b = a + 1; b < reset.length; b += 1) assert.equal(overlap(reset[a], reset[b]), false);
  }
  h.api.destroy();
});

test('primary capture drag suppresses selection, cancel releases, taps and keyboard select', () => {
  const h = setup({ reduced: true });
  const tile = h.arena.children[0];
  tile.emit('pointerdown', pointer({ isPrimary: false }));
  assert.equal(tile.captures.size, 0);
  tile.emit('pointerdown', pointer());
  assert.equal(tile.captures.size, 1);
  h.win.emit('pointermove', pointer({ clientX: 100, clientY: 80, timeStamp: 30 }));
  assert.equal(tile.getAttribute('data-dragging'), 'true');
  h.win.emit('pointerup', pointer({ clientX: 100, clientY: 80, timeStamp: 40 }));
  assert.equal(tile.captures.size, 0);
  assert.equal(tile.emit('click').prevented, true);
  assert.deepEqual(h.selected, []);
  tile.emit('click', { detail: 0 });
  assert.deepEqual(h.selected, ['日']);
  h.tick(600);
  tile.emit('pointerdown', pointer({ timeStamp: 600 }));
  h.win.emit('pointercancel', pointer({ timeStamp: 610 }));
  assert.equal(tile.captures.size, 0);
  assert.equal(tile.getAttribute('data-dragging'), null);
  assert.equal(h.frames.size, 0);
  h.tick(1200);
  tile.emit('pointerdown', pointer({ timeStamp: 1200 }));
  h.win.emit('pointerup', pointer({ timeStamp: 1220 }));
  tile.emit('click');
  tile.emit('click', { detail: 2 });
  assert.deepEqual(h.selected, ['日', '日'], 'double tap does not load the same model twice');
  h.api.destroy();
});

test('throw velocity uses elapsed seconds, clamps speed and discards stale releases', () => {
  for (const [moveTime, releaseTime, delta, expectedSpeed] of [
    [40, 50, 20, 400],
    [8, 10, 40, 720],
    [40, 250, 20, 0],
  ]) {
    const h = setup();
    const tile = h.arena.children[0];
    tile.emit('pointerdown', pointer());
    h.win.emit('pointermove', pointer({ clientY: 50 + delta, timeStamp: moveTime }));
    h.win.emit('pointerup', pointer({ clientY: 50 + delta, timeStamp: releaseTime }));
    const released = xy(tile);
    h.tick(releaseTime);
    h.tick(releaseTime + 10);
    close(xy(tile)[1] - released[1], expectedSpeed * 0.01, 0.002);
    assert.equal(tile.captures.size, 0);
    h.api.destroy();
  }
});

test('reset before the first visible measurement still produces deterministic positions', () => {
  const h = setup({ width: 0, height: 0, reduced: true });
  h.resetButton.emit('click');
  h.resize(500, 360);
  const reference = setup({ reduced: true });
  assert.deepEqual(positions(h), positions(reference));
  h.api.destroy();
  reference.api.destroy();
});

test('enabling tilt while reduced-motion is paused never starts sensors or RAF', () => {
  const h = setup({ reduced: true, orientation: {} });
  h.tiltButton.emit('click');
  assert.equal(h.tiltButton.getAttribute('aria-pressed'), 'true');
  assert.equal(h.frames.size, 0);
  assert.equal(h.win.count('deviceorientation'), 0);
  h.resetButton.emit('click');
  h.locale('id');
  assert.equal(h.frames.size, 0);
  h.api.destroy();
});

test('synthetic pointer capture swallows only NotFoundError', () => {
  const h = setup({ reduced: true });
  const tile = h.arena.children[0];
  tile.captureError = Object.assign(new Error('synthetic pointer'), { name: 'NotFoundError' });
  assert.doesNotThrow(() => tile.emit('pointerdown', pointer()));
  h.win.emit('pointercancel', pointer());
  tile.captureError = new TypeError('unexpected bug');
  assert.throws(() => tile.emit('pointerdown', pointer()), TypeError);
  h.api.destroy();
});

test('tilt permission is requested only on explicit click; denial is localized', async () => {
  let calls = 0;
  const h = setup({
    orientation: {
      requestPermission: async () => {
        calls += 1;
        return 'denied';
      },
    },
  });
  h.locale('id');
  h.resetButton.emit('click');
  assert.equal(calls, 0);
  h.tiltButton.emit('click');
  assert.equal(calls, 1);
  await Promise.resolve();
  assert.match(h.status.textContent, /Izin kemiringan tidak diberikan/);
  assert.equal(h.win.count('deviceorientation'), 0);
  assert.equal(h.tiltButton.getAttribute('aria-pressed'), 'false');
  h.locale('en');
  assert.match(h.status.textContent, /permission was not granted/);
  h.api.destroy();
});

test('tilt handles nonsecure, missing sensors, timeouts and screen orientation', () => {
  for (const options of [{ secure: false }, {}]) {
    const h = setup(options);
    h.tiltButton.emit('click');
    assert.match(h.status.textContent, options.secure === false ? /HTTPS/ : /unavailable/);
    h.api.destroy();
  }
  const h = setup({ orientation: {} });
  h.tiltButton.emit('click');
  assert.equal(h.win.count('deviceorientation'), 1);
  assert.equal(h.timers.size, 1);
  h.visible(false);
  assert.equal(h.win.count('deviceorientation'), 0);
  assert.equal(h.timers.size, 0);
  h.visible(true);
  h.win.screen.orientation.angle = 90;
  h.win.emit('deviceorientation', { beta: 30, gamma: 0 });
  assert.equal(h.timers.size, 0);
  const initial = xy(h.arena.children[0]);
  h.tick(0);
  h.tick(40);
  const moved = xy(h.arena.children[0]);
  assert.ok(
    moved[0] > initial[0] + Math.cos(0.3) * 38 * 0.04,
    'portrait-down maps to landscape-right',
  );
  h.tiltButton.emit('click');
  assert.equal(h.win.count('deviceorientation'), 0);
  h.tiltButton.emit('click');
  for (const callback of [...h.timers.values()]) callback();
  assert.match(h.status.textContent, /No tilt data received/);
  assert.equal(h.win.count('deviceorientation'), 0);
  h.api.destroy();
});

test('pending permission cannot reactivate tilt after cancel or destroy', async () => {
  let grant;
  const h = setup({
    orientation: {
      requestPermission: () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    },
  });
  h.tiltButton.emit('click');
  assert.equal(h.tiltButton.getAttribute('aria-busy'), 'true');
  h.tiltButton.emit('click');
  grant('granted');
  await Promise.resolve();
  assert.equal(h.win.count('deviceorientation'), 0);
  h.tiltButton.emit('click');
  h.api.destroy();
  grant('granted');
  await Promise.resolve();
  assert.equal(h.win.count('deviceorientation'), 0);
  assert.equal(h.frames.size, 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.arena.children.length, 0);
  assert.ok(h.resizers.every((observer) => observer.disconnected));
  assert.ok(h.intersections.every((observer) => observer.disconnected));
  assert.equal(h.win.count('pointermove'), 0);
  assert.equal(h.doc.count('visibilitychange'), 0);
  assert.equal(h.media.count('change'), 0);
  assert.doesNotThrow(() => {
    h.api.destroy();
    h.api.updateLanguage();
  });
});
