export const { initPhysics, stepBodies } = (() => {
  'use strict';

  const MAX_SPEED = 720; // CSS pixels / second, including pointer throws.
  const MAX_GRAVITY = 220; // CSS pixels / second squared.
  const MAX_DT = 0.05;
  const MAX_SUBSTEPS = 24;
  const WALL_RESTITUTION = 0.8;
  const EPSILON = 1e-7;
  const GLYPHS = [
    ['日', 'sun / day', 'matahari / hari'],
    ['月', 'moon / month', 'bulan'],
    ['山', 'mountain', 'gunung'],
    ['川', 'river', 'sungai'],
    ['水', 'water', 'air'],
    ['火', 'fire', 'api'],
    ['木', 'tree', 'pohon'],
    ['心', 'heart', 'hati'],
    ['旅', 'journey', 'perjalanan'],
    ['道', 'path', 'jalan'],
  ];
  const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const extent = (value) => clamp(finite(value), 0, 1e6);

  function limitVector(x, y, maximum) {
    x = finite(x);
    y = finite(y);
    // Scale before measuring so even near-MAX_VALUE inputs remain finite,
    // without changing the direction of a fast diagonal throw.
    const peak = Math.max(Math.abs(x), Math.abs(y), maximum);
    const length = Math.hypot(x / peak, y / peak);
    const scale = Math.min(1, maximum / peak / (length || 1));
    return { x: x * scale, y: y * scale };
  }

  function walls(body, bounds, reflectTravel = false) {
    for (const [axis, size, velocity] of [
      ['x', 'width', 'vx'],
      ['y', 'height', 'vy'],
    ]) {
      const end = bounds[size] - body[size];
      if (end <= 0) {
        body[axis] = 0;
        body[velocity] = 0;
      } else if (body[axis] <= 0) {
        // Reflect the remaining travel after impact, not just the velocity.
        body[axis] = reflectTravel ? Math.min(end, -body[axis] * WALL_RESTITUTION) : 0;
        if (body[velocity] < 0) body[velocity] *= -WALL_RESTITUTION;
      } else if (body[axis] >= end) {
        body[axis] = reflectTravel ? Math.max(0, end - (body[axis] - end) * WALL_RESTITUTION) : end;
        if (body[velocity] > 0) body[velocity] *= -WALL_RESTITUTION;
      }
    }
  }

  function collide(a, b, bounds) {
    const dx = b.x + b.width / 2 - a.x - a.width / 2;
    const dy = b.y + b.height / 2 - a.y - a.height / 2;
    const overlapX = (a.width + b.width) / 2 - Math.abs(dx);
    const overlapY = (a.height + b.height) / 2 - Math.abs(dy);
    if (overlapX < 0 || overlapY < 0) return 0;
    const inverseA = a.fixed ? 0 : 1;
    const inverseB = b.fixed ? 0 : 1;
    const inverseSum = inverseA + inverseB;
    if (!inverseSum) return 0;
    const horizontal = overlapX <= overlapY;
    let axis = horizontal ? 'x' : 'y';
    let size = horizontal ? 'width' : 'height';
    let normal = (horizontal ? dx : dy) >= 0 ? 1 : -1;
    let overlap = horizontal ? overlapX : overlapY;
    const room = (item, inverse, key, dimension, sign) =>
      inverse
        ? Math.max(0, sign > 0 ? bounds[dimension] - item[dimension] - item[key] : item[key])
        : 0;
    let roomA = room(a, inverseA, axis, size, -normal);
    let roomB = room(b, inverseB, axis, size, normal);

    // A drag can put the nearest separation axis against an immovable wall.
    // Choose the shortest feasible escape (including the opposite direction).
    if (roomA + roomB < overlap - EPSILON) {
      let best = Infinity;
      for (const [key, dimension] of [
        ['x', 'width'],
        ['y', 'height'],
      ]) {
        for (const sign of [1, -1]) {
          const distance =
            sign > 0 ? a[key] + a[dimension] - b[key] : b[key] + b[dimension] - a[key];
          const availableA = room(a, inverseA, key, dimension, -sign);
          const availableB = room(b, inverseB, key, dimension, sign);
          if (distance < best && availableA + availableB >= distance - EPSILON) {
            best = distance;
            axis = key;
            size = dimension;
            normal = sign;
            overlap = distance;
            roomA = availableA;
            roomB = availableB;
          }
        }
      }
    }
    const velocity = axis === 'x' ? 'vx' : 'vy';

    // Give wall-blocked correction to the neighbour rather than projecting
    // both bodies into a wall and leaving them overlapped.
    let moveA = Math.min(roomA, (overlap * inverseA) / inverseSum);
    let moveB = Math.min(roomB, (overlap * inverseB) / inverseSum);
    let remaining = Math.max(0, overlap - moveA - moveB);
    const extraA = Math.min(remaining, roomA - moveA);
    moveA += extraA;
    remaining -= extraA;
    moveB += Math.min(remaining, roomB - moveB);
    a[axis] -= normal * moveA;
    b[axis] += normal * moveB;

    const relativeSpeed = (b[velocity] - a[velocity]) * normal;
    if (relativeSpeed < 0) {
      // Restitution 1: equal-mass elastic impulse, only when approaching.
      const impulse = (-2 * relativeSpeed) / inverseSum;
      a[velocity] -= impulse * inverseA * normal;
      b[velocity] += impulse * inverseB * normal;
    }
    return moveA + moveB;
  }

  function overlaps(a, b) {
    return (
      Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > EPSILON &&
      Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > EPSILON
    );
  }

  function repairPositions(bodies, bounds) {
    // Deep overlap can arrive from a resize or a discontinuous pointer event,
    // not ordinary integration. If iterative projection jams a cluster, move
    // the nearest movable tile to a free AABB edge candidate. Do not reset the
    // arena or inject energy; already-separated bodies are never relocated.
    for (let pass = 0; pass < bodies.length; pass += 1) {
      const affected = bodies.filter(
        (a) => !a.fixed && bodies.some((b) => a !== b && overlaps(a, b)),
      );
      if (!affected.length) return;
      let best = null;
      for (const body of affected) {
        const others = bodies.filter((other) => other !== body);
        const xs = new Set([body.x, 0, bounds.width - body.width]);
        const ys = new Set([body.y, 0, bounds.height - body.height]);
        for (const other of others) {
          xs.add(clamp(other.x - body.width, 0, bounds.width - body.width));
          xs.add(clamp(other.x + other.width, 0, bounds.width - body.width));
          ys.add(clamp(other.y - body.height, 0, bounds.height - body.height));
          ys.add(clamp(other.y + other.height, 0, bounds.height - body.height));
        }
        for (const x of xs) {
          for (const y of ys) {
            const distance = (x - body.x) ** 2 + (y - body.y) ** 2;
            if (best && distance >= best.distance) continue;
            const candidate = { x, y, width: body.width, height: body.height };
            if (!others.some((other) => overlaps(candidate, other)))
              best = { body, x, y, distance };
          }
        }
      }
      if (!best) return; // No vacancy in this packing; retain finite wall bounds.
      best.body.x = best.x;
      best.body.y = best.y;
    }
  }

  /**
   * Pure, immutable equal-mass AABB step. Coordinates/sizes are CSS pixels,
   * velocities px/s, dt seconds and gravity {x, y} px/s² (default zero-G).
   * Bodies: {x, y, width, height, vx, vy, fixed?}; extra fields are preserved.
   * A fixed body can transfer velocity but is not integrated. dt <= 0 or
   * non-finite performs constraint repair only. Excess elapsed time is dropped.
   * Non-overlap assumes the arena can fit the bodies; impossible packing is
   * still bounded and finite. No DOM, timers, random state or input mutation.
   */
  function stepBodies(bodies, bounds, dt, gravity = { x: 0, y: 0 }) {
    const box = { width: extent(bounds?.width), height: extent(bounds?.height) };
    const result = bodies.map((body) => {
      const velocity = limitVector(body.vx, body.vy, MAX_SPEED);
      const next = {
        ...body,
        x: finite(body.x),
        y: finite(body.y),
        width: clamp(finite(body.width, 64), 0, box.width),
        height: clamp(finite(body.height, 64), 0, box.height),
        vx: velocity.x,
        vy: velocity.y,
      };
      walls(next, box);
      return next;
    });
    const acceleration = limitVector(gravity?.x, gravity?.y, MAX_GRAVITY);
    const smallest = result.reduce(
      (size, body) => Math.min(size, Math.max(1, body.width), Math.max(1, body.height)),
      64,
    );
    // Travel per substep is <= a quarter of the smallest tile. Bound work even
    // for tiny arenas, and avoid fast bodies tunnelling through one another.
    const quantum = Math.min(1 / 120, smallest / (MAX_SPEED * 4));
    const elapsed = clamp(finite(dt), 0, Math.min(MAX_DT, quantum * MAX_SUBSTEPS));
    const count = Math.max(1, Math.min(MAX_SUBSTEPS, Math.ceil(elapsed / quantum)));
    const h = elapsed / count;
    for (let substep = 0; substep < count; substep += 1) {
      for (const body of result) {
        if (body.fixed) continue;
        const velocity = limitVector(
          body.vx + acceleration.x * h,
          body.vy + acceleration.y * h,
          MAX_SPEED,
        );
        body.vx = velocity.x;
        body.vy = velocity.y;
        body.x += body.vx * h;
        body.y += body.vy * h;
        walls(body, box, true);
      }
      for (let pass = 0; pass < 32; pass += 1) {
        let correction = 0;
        for (let i = 0; i < result.length; i += 1) {
          for (let j = i + 1; j < result.length; j += 1) {
            correction = Math.max(correction, collide(result[i], result[j], box));
          }
        }
        for (const body of result) walls(body, box);
        if (correction <= EPSILON) break;
      }
      repairPositions(result, box);
      for (const body of result) {
        const velocity = limitVector(body.vx, body.vy, MAX_SPEED);
        body.vx = velocity.x;
        body.vy = velocity.y;
      }
    }
    return result;
  }

  function initPhysics({
    arena,
    pauseButton,
    tiltButton,
    resetButton,
    status,
    onSelect = () => {},
    t = (en) => en,
  }) {
    if (!arena?.ownerDocument?.defaultView)
      throw new TypeError('initPhysics requires a DOM arena.');
    const doc = arena.ownerDocument;
    const win = doc.defaultView;
    const cleanups = [];
    const media = win.matchMedia?.('(prefers-reduced-motion: reduce)');
    let reducedMotion = Boolean(media?.matches);
    let paused = reducedMotion;
    let destroyed = false;
    let hasSize = false;
    let initialised = false;
    let bounds = { width: 0, height: 0 };
    let bodies = [];
    let frame = null;
    let lastFrame = null;
    let drag = null;
    let tiltEnabled = false;
    let tiltPending = false;
    let tiltListening = false;
    let tiltReceived = false;
    let tiltTimeout = null;
    let permissionEpoch = 0;
    let gravity = { x: 0, y: 0 };
    let notice = '';
    let lastSelection = { index: -1, time: -Infinity };
    const suppressClicks = GLYPHS.map(() => -Infinity);
    const previousPaused = arena.getAttribute('data-paused');
    const previousTilt = arena.getAttribute('data-tilt');

    function listen(target, type, handler, options) {
      if (!target) return;
      target.addEventListener(type, handler, options);
      cleanups.push(() => target.removeEventListener(type, handler, options));
    }

    function onScreen() {
      const rect = arena.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < (win.innerHeight || doc.documentElement.clientHeight) &&
        rect.left < (win.innerWidth || doc.documentElement.clientWidth)
      );
    }
    let inView = onScreen();

    const tiles = GLYPHS.map(([glyph], index) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'physics-tile';
      button.textContent = glyph;
      // Geometry/input only; colours, typography, focus rings and decoration
      // belong to the parent stylesheet. --tile-size may be responsive.
      Object.assign(button.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        margin: '0',
        width: 'var(--tile-size, 64px)',
        height: 'var(--tile-size, 64px)',
        minWidth: '0',
        minHeight: '0',
        boxSizing: 'border-box',
        touchAction: 'none',
        userSelect: 'none',
      });
      listen(button, 'pointerdown', (event) => startDrag(event, index));
      listen(button, 'lostpointercapture', (event) => {
        if (drag?.pointerId === event.pointerId) finishDrag(null, true);
      });
      listen(button, 'click', (event) => {
        if (destroyed) return;
        if (event.detail !== 0 && (drag?.moved || win.performance.now() < suppressClicks[index])) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        const now = win.performance.now();
        // Native clicks cover touch taps, double taps, Enter and Space. Avoid
        // loading the same handwriting model twice for one double tap/click.
        if (lastSelection.index === index && now - lastSelection.time < 300) return;
        lastSelection = { index, time: now };
        onSelect(glyph);
      });
      listen(button, 'keydown', (event) => nudge(event, index));
      arena.appendChild(button);
      return button;
    });

    function updateLanguage() {
      if (destroyed) return;
      if (pauseButton) {
        pauseButton.textContent = paused
          ? t('Resume motion', 'Lanjutkan gerakan')
          : t('Pause motion', 'Jeda gerakan');
        pauseButton.setAttribute('aria-pressed', String(paused));
      }
      if (tiltButton) {
        tiltButton.textContent = tiltPending
          ? t('Cancel tilt request', 'Batalkan permintaan kemiringan')
          : tiltEnabled
            ? t('Disable tilt gravity', 'Nonaktifkan gravitasi kemiringan')
            : t('Enable tilt gravity', 'Aktifkan gravitasi kemiringan');
        tiltButton.setAttribute('aria-pressed', String(tiltEnabled));
        tiltButton.setAttribute('aria-busy', String(tiltPending));
      }
      if (resetButton) resetButton.textContent = t('Reset positions', 'Atur ulang posisi');
      tiles.forEach((tile, index) => {
        const [glyph, en, id] = GLYPHS[index];
        tile.setAttribute(
          'aria-label',
          `${glyph} — ${t(en, id)}. ${t(
            'Practise this kanji. Drag to throw; use arrow keys to move.',
            'Latih kanji ini. Seret untuk melempar; gunakan tombol panah untuk menggeser.',
          )}`,
        );
      });
      arena.setAttribute('data-paused', String(paused));
      arena.setAttribute('data-tilt', String(tiltEnabled));
      if (!status) return;
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.setAttribute('aria-atomic', 'true');
      const messages = {
        insecure: [
          'Tilt needs a secure HTTPS connection.',
          'Kemiringan memerlukan koneksi HTTPS yang aman.',
        ],
        unavailable: [
          'Tilt is unavailable on this device.',
          'Kemiringan tidak tersedia di perangkat ini.',
        ],
        denied: [
          'Tilt permission was not granted. You can still drag the tiles.',
          'Izin kemiringan tidak diberikan. Anda tetap dapat menyeret ubin.',
        ],
        noData: [
          'No tilt data received. You can still drag the tiles.',
          'Data kemiringan tidak diterima. Anda tetap dapat menyeret ubin.',
        ],
        reset: ['Starting positions restored.', 'Posisi awal dipulihkan.'],
      };
      const parts = [
        paused
          ? t('Motion paused. Drag or select a kanji.', 'Gerakan dijeda. Seret atau pilih kanji.')
          : tiltEnabled
            ? t(
                'Tilt gravity on. Tilt gently to move the kanji.',
                'Gravitasi kemiringan aktif. Miringkan perangkat perlahan untuk menggerakkan kanji.',
              )
            : t(
                'Zero-G. Drag to throw, or select a kanji to practise.',
                'Tanpa gravitasi. Seret untuk melempar, atau pilih kanji untuk berlatih.',
              ),
      ];
      if (reducedMotion && paused)
        parts.push(t('Reduced motion is respected.', 'Preferensi pengurangan gerakan dihormati.'));
      if (tiltPending) parts.push(t('Waiting for tilt permission.', 'Menunggu izin kemiringan.'));
      if (messages[notice]) parts.push(t(...messages[notice]));
      const text = parts.join(' ');
      if (status.textContent !== text) status.textContent = text;
    }

    function render() {
      bodies.forEach((body, index) => {
        tiles[index].style.transform =
          `translate3d(${body.x.toFixed(3)}px, ${body.y.toFixed(3)}px, 0)`;
      });
    }

    function gridFor(width, height) {
      let best = { columns: 1, rows: GLYPHS.length, size: 0 };
      for (let columns = 1; columns <= GLYPHS.length; columns += 1) {
        const rows = Math.ceil(GLYPHS.length / columns);
        const size = Math.max(1, Math.min(width / columns, height / rows) - 8);
        if (size > best.size) best = { columns, rows, size };
      }
      return best;
    }

    function startingPositions() {
      const grid = gridFor(bounds.width, bounds.height);
      bodies = bodies.map((body, index) => {
        const row = Math.floor(index / grid.columns);
        const inRow = Math.min(grid.columns, GLYPHS.length - row * grid.columns);
        return {
          ...body,
          x:
            (bounds.width - inRow * (bounds.width / grid.columns)) / 2 +
            ((index % grid.columns) + 0.5) * (bounds.width / grid.columns) -
            body.width / 2,
          y: (row + 0.5) * (bounds.height / grid.rows) - body.height / 2,
          vx: Math.cos(index * 2.4 + 0.3) * 38,
          vy: Math.sin(index * 2.4 + 0.3) * 30,
          fixed: false,
        };
      });
      bodies = stepBodies(bodies, bounds, 0);
      initialised = true;
      render();
    }

    function measure() {
      if (destroyed) return;
      const width = arena.clientWidth;
      const height = arena.clientHeight;
      hasSize = width > 0 && height > 0;
      if (!hasSize) {
        inView = false;
        syncMotion();
        return; // Keep the last usable geometry while display:none.
      }
      const previous = bounds;
      const grid = gridFor(width, height);
      const rect = arena.getBoundingClientRect();
      const scaleX = rect.width / (arena.offsetWidth || width) || 1;
      const scaleY = rect.height / (arena.offsetHeight || height) || 1;
      const sizes = tiles.map((tile) => {
        tile.style.maxWidth = `${grid.size}px`;
        tile.style.maxHeight = `${grid.size}px`;
        const tileRect = tile.getBoundingClientRect();
        return {
          width: clamp(tileRect.width / scaleX || 64, 1, Math.min(width, grid.size)),
          height: clamp(tileRect.height / scaleY || 64, 1, Math.min(height, grid.size)),
        };
      });
      const changed =
        width !== previous.width ||
        height !== previous.height ||
        sizes.some(
          (size, index) =>
            size.width !== bodies[index]?.width || size.height !== bodies[index]?.height,
        );
      if (changed) {
        finishDrag(null, true);
        bounds = { width, height };
        bodies = sizes.map((size, index) => {
          const old = bodies[index];
          const nx = old && previous.width > old.width ? old.x / (previous.width - old.width) : 0.5;
          const ny =
            old && previous.height > old.height ? old.y / (previous.height - old.height) : 0.5;
          return {
            ...old,
            ...size,
            x: clamp(nx, 0, 1) * (width - size.width),
            y: clamp(ny, 0, 1) * (height - size.height),
            vx: old?.vx ?? 0,
            vy: old?.vy ?? 0,
            fixed: false,
          };
        });
        if (!initialised) startingPositions();
        else {
          bodies = stepBodies(bodies, bounds, 0);
          render();
        }
      }
      inView = onScreen();
      syncMotion();
    }

    function canRun() {
      return !destroyed && !paused && !doc.hidden && inView && hasSize;
    }

    function stopFrame() {
      if (frame !== null) win.cancelAnimationFrame(frame);
      frame = null;
      lastFrame = null;
    }

    function animate(time) {
      frame = null;
      if (!canRun() || !onScreen()) {
        inView = onScreen();
        syncMotion();
        return;
      }
      if (lastFrame !== null) {
        if (drag && win.performance.now() - drag.lastMotionClock > 100) {
          bodies[drag.index].vx = 0;
          bodies[drag.index].vy = 0;
        }
        bodies = stepBodies(bodies, bounds, (time - lastFrame) / 1000, gravity);
        render();
      }
      lastFrame = time;
      frame = win.requestAnimationFrame(animate);
    }

    function syncMotion() {
      syncTiltListener();
      if (canRun()) {
        if (frame === null) frame = win.requestAnimationFrame(animate);
      } else {
        stopFrame();
        if (doc.hidden || !inView) finishDrag(null, true);
      }
    }

    function clearTiltTimeout() {
      if (tiltTimeout !== null) win.clearTimeout(tiltTimeout);
      tiltTimeout = null;
    }

    function orientation(event) {
      if (!tiltListening || !Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
      const radians = Math.PI / 180;
      const beta = clamp(event.beta, -180, 180) * radians;
      const gamma = clamp(event.gamma, -90, 90) * radians;
      const angle = finite(win.screen?.orientation?.angle, finite(win.orientation)) * radians;
      const deviceX = Math.sin(gamma) * Math.cos(beta);
      const deviceY = Math.sin(beta);
      const target = limitVector(
        (deviceX * Math.cos(angle) + deviceY * Math.sin(angle)) * MAX_GRAVITY,
        (deviceY * Math.cos(angle) - deviceX * Math.sin(angle)) * MAX_GRAVITY,
        MAX_GRAVITY,
      );
      const smoothing = tiltReceived ? 0.25 : 1;
      gravity.x += (target.x - gravity.x) * smoothing;
      gravity.y += (target.y - gravity.y) * smoothing;
      tiltReceived = true;
      clearTiltTimeout();
    }

    function syncTiltListener() {
      const shouldListen = tiltEnabled && canRun();
      if (shouldListen === tiltListening) return;
      tiltListening = shouldListen;
      if (shouldListen) {
        tiltReceived = false;
        win.addEventListener('deviceorientation', orientation);
        tiltTimeout = win.setTimeout(() => {
          tiltTimeout = null;
          if (destroyed || !tiltListening || tiltReceived) return;
          tiltEnabled = false;
          notice = 'noData';
          syncMotion();
          updateLanguage();
        }, 6000);
      } else {
        win.removeEventListener('deviceorientation', orientation);
        clearTiltTimeout();
        gravity = { x: 0, y: 0 };
      }
    }

    async function toggleTilt() {
      if (destroyed) return;
      const epoch = ++permissionEpoch;
      notice = '';
      if (tiltEnabled || tiltPending) {
        tiltEnabled = false;
        tiltPending = false;
        syncMotion();
        updateLanguage();
        return;
      }
      const Orientation = win.DeviceOrientationEvent;
      if (!win.isSecureContext || !Orientation) {
        notice = !win.isSecureContext ? 'insecure' : 'unavailable';
        updateLanguage();
        return;
      }
      tiltPending = true;
      updateLanguage();
      try {
        // This is called only by the tilt button's explicit click. In iOS the
        // request must occur before yielding the user-activation call stack.
        const permission =
          typeof Orientation.requestPermission === 'function'
            ? await Orientation.requestPermission()
            : 'granted';
        if (destroyed || epoch !== permissionEpoch) return;
        tiltPending = false;
        tiltEnabled = permission === 'granted';
        if (!tiltEnabled) notice = 'denied';
      } catch (error) {
        if (destroyed || epoch !== permissionEpoch) return;
        tiltPending = false;
        notice = error?.name === 'NotAllowedError' ? 'denied' : 'unavailable';
      }
      syncMotion();
      updateLanguage();
    }

    function pointerPoint(event) {
      const rect = arena.getBoundingClientRect();
      const scaleX = rect.width / (arena.offsetWidth || bounds.width) || 1;
      const scaleY = rect.height / (arena.offsetHeight || bounds.height) || 1;
      return {
        x: (finite(event.clientX) - rect.left) / scaleX - (arena.clientLeft || 0),
        y: (finite(event.clientY) - rect.top) / scaleY - (arena.clientTop || 0),
      };
    }

    function capture(tile, pointerId, release = false) {
      try {
        if (release) {
          if (tile.hasPointerCapture?.(pointerId)) tile.releasePointerCapture(pointerId);
        } else tile.setPointerCapture?.(pointerId);
      } catch (error) {
        // Synthetic PointerEvents have no active pointer in the capture map.
        // Do not swallow unrelated exceptions or permission/security errors.
        if (error?.name !== 'NotFoundError') throw error;
      }
    }

    function startDrag(event, index) {
      if (destroyed || drag || !hasSize || event.isPrimary === false || event.button !== 0) return;
      const point = pointerPoint(event);
      const body = bodies[index];
      const now = finite(event.timeStamp, win.performance.now());
      drag = {
        index,
        pointerId: event.pointerId,
        moved: false,
        startX: point.x,
        startY: point.y,
        offsetX: point.x - body.x,
        offsetY: point.y - body.y,
        samples: [{ x: body.x, y: body.y, time: now }],
        lastMovedAt: now,
        lastMotionClock: win.performance.now(),
      };
      body.fixed = true;
      body.vx = 0;
      body.vy = 0;
      suppressClicks[index] = -Infinity;
      tiles[index].focus({ preventScroll: true });
      capture(tiles[index], event.pointerId);
    }

    function sampledVelocity(now) {
      const samples = drag.samples;
      const first = samples[0];
      const last = samples[samples.length - 1];
      const seconds = (last.time - first.time) / 1000;
      if (seconds < 0.008 || now - drag.lastMovedAt > 100) return { x: 0, y: 0 };
      return limitVector((last.x - first.x) / seconds, (last.y - first.y) / seconds, MAX_SPEED);
    }

    function moveDrag(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const point = pointerPoint(event);
      if (!drag.moved && Math.hypot(point.x - drag.startX, point.y - drag.startY) < 6) return;
      drag.moved = true;
      if (event.cancelable) event.preventDefault();
      const body = bodies[drag.index];
      const x = clamp(point.x - drag.offsetX, 0, bounds.width - body.width);
      const y = clamp(point.y - drag.offsetY, 0, bounds.height - body.height);
      const now = finite(event.timeStamp, win.performance.now());
      if (x !== body.x || y !== body.y) {
        drag.lastMovedAt = now;
        drag.lastMotionClock = win.performance.now();
      }
      body.x = x;
      body.y = y;
      const samples = drag.samples;
      if (now > samples[samples.length - 1].time) samples.push({ x, y, time: now });
      while (samples.length > 2 && (samples[1].time < now - 80 || samples.length > 12))
        samples.shift();
      const velocity = sampledVelocity(now);
      body.vx = paused ? 0 : velocity.x;
      body.vy = paused ? 0 : velocity.y;
      tiles[drag.index].setAttribute('data-dragging', 'true');
      bodies = stepBodies(bodies, bounds, 0);
      render();
    }

    function finishDrag(event, cancelled = false) {
      if (!drag || (event && event.pointerId !== drag.pointerId)) return;
      if (event && !cancelled) moveDrag(event);
      const current = drag;
      const body = bodies[current.index];
      const velocity =
        !cancelled && current.moved && !paused
          ? sampledVelocity(finite(event?.timeStamp, win.performance.now()))
          : { x: 0, y: 0 };
      drag = null; // Clear before release: lostpointercapture can be synchronous.
      body.fixed = false;
      body.vx = velocity.x;
      body.vy = velocity.y;
      if (current.moved || cancelled) suppressClicks[current.index] = win.performance.now() + 500;
      tiles[current.index].removeAttribute('data-dragging');
      capture(tiles[current.index], current.pointerId, true);
    }

    function nudge(event, index) {
      const directions = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const direction = directions[event.key];
      if (
        !direction ||
        destroyed ||
        drag ||
        !hasSize ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      event.preventDefault();
      const body = bodies[index];
      const distance = event.shiftKey ? 24 : 12;
      body.x = clamp(body.x + direction[0] * distance, 0, bounds.width - body.width);
      body.y = clamp(body.y + direction[1] * distance, 0, bounds.height - body.height);
      body.vx = 0;
      body.vy = 0;
      body.fixed = true;
      bodies = stepBodies(bodies, bounds, 0);
      bodies[index].fixed = false;
      render();
    }

    listen(win, 'pointermove', moveDrag, { passive: false });
    listen(win, 'pointerup', (event) => finishDrag(event));
    listen(win, 'pointercancel', (event) => finishDrag(event, true));
    listen(win, 'blur', () => finishDrag(null, true));
    listen(pauseButton, 'click', () => {
      finishDrag(null, true);
      paused = !paused; // An explicit Resume is allowed; never auto-resume a preference change.
      notice = '';
      syncMotion();
      updateLanguage();
    });
    listen(tiltButton, 'click', toggleTilt);
    listen(resetButton, 'click', () => {
      finishDrag(null, true);
      lastSelection = { index: -1, time: -Infinity };
      stopFrame();
      if (bodies.length) startingPositions();
      else initialised = false; // A hidden, not-yet-measured arena resets when first shown.
      notice = 'reset';
      syncMotion();
      updateLanguage();
    });
    listen(doc, 'visibilitychange', () => {
      inView = onScreen();
      syncMotion();
    });
    const preferenceChanged = (event) => {
      reducedMotion = event.matches;
      if (reducedMotion) {
        paused = true;
        finishDrag(null, true);
      }
      syncMotion();
      updateLanguage();
    };
    if (media?.addEventListener) listen(media, 'change', preferenceChanged);
    else if (media?.addListener) {
      media.addListener(preferenceChanged);
      cleanups.push(() => media.removeListener(preferenceChanged));
    }
    if (win.ResizeObserver) {
      const observer = new win.ResizeObserver(measure);
      observer.observe(arena);
      tiles.forEach((tile) => observer.observe(tile));
      cleanups.push(() => observer.disconnect());
    }
    listen(win, 'resize', measure);
    if (win.IntersectionObserver) {
      const observer = new win.IntersectionObserver(
        (entries) => {
          if (destroyed) return;
          const entry = entries.find((item) => item.target === arena);
          if (!entry) return;
          inView =
            entry.isIntersecting &&
            entry.intersectionRect.width > 0 &&
            entry.intersectionRect.height > 0;
          syncMotion();
        },
        { threshold: 0 },
      );
      observer.observe(arena);
      cleanups.push(() => observer.disconnect());
    } else {
      listen(
        win,
        'scroll',
        () => {
          inView = onScreen();
          syncMotion();
        },
        { passive: true, capture: true },
      );
    }
    measure();
    updateLanguage();

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      permissionEpoch += 1;
      tiltPending = false;
      tiltEnabled = false;
      finishDrag(null, true);
      stopFrame();
      syncTiltListener();
      clearTiltTimeout();
      cleanups.forEach((cleanup) => cleanup());
      tiles.forEach((tile) => tile.remove());
      tiltButton?.setAttribute('aria-busy', 'false');
      tiltButton?.setAttribute('aria-pressed', 'false');
      for (const [name, value] of [
        ['data-paused', previousPaused],
        ['data-tilt', previousTilt],
      ]) {
        if (value === null) arena.removeAttribute(name);
        else arena.setAttribute(name, value);
      }
    }

    return { updateLanguage, destroy };
  }

  return { initPhysics, stepBodies };
})();
