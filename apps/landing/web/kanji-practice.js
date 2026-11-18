import { scoreMasks } from './kanji-bitmap-score.js';

export const initKanjiStudio = (() => {
  'use strict';

  const SPACE = 109;
  const PEN_WIDTH = 3.5;
  const RASTER_SIZE = SPACE * 3;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  return function initKanjiStudio({ root, t, kanjiData }) {
    if (!root?.querySelector || typeof t !== 'function' || !Array.isArray(kanjiData) || !kanjiData.length) {
      throw new TypeError('Kanji Studio requires a root, t(en, id), and a nonempty kanjiData array.');
    }
    const document = root.ownerDocument || root;
    const view = document.defaultView;
    if (!view?.Path2D) throw new Error('Kanji Studio requires Canvas Path2D support.');
    const get = (id) => {
      const element = root.querySelector(`#${id}`);
      if (!element) throw new Error(`Kanji Studio is missing #${id}.`);
      return element;
    };
    const elements = Object.fromEntries([
      'model', 'kana', 'romaji', 'meaning-en', 'meaning-id', 'stroke-count', 'user-count',
      'canvas', 'trace', 'undo', 'clear', 'check', 'new', 'result', 'total', 'feedback',
      'precision', 'recall', 'count', 'diff',
    ].map((name) => [name, get(`write-${name}`)]));
    const canvas = elements.canvas;
    const context = canvas.getContext('2d');
    const diffContext = elements.diff.getContext('2d');
    if (!context || !diffContext) throw new Error('Kanji Studio requires a 2D canvas context.');
    function surface(size) {
      const element = document.createElement('canvas');
      element.width = size;
      element.height = size;
      const context = element.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Kanji Studio could not create an offscreen canvas.');
      return { element, context };
    }
    // Detached, transparent canvases; neither the grid nor tracing guide is scored.
    const referenceSurface = surface(RASTER_SIZE);
    const userSurface = surface(RASTER_SIZE);
    const comparisonSurface = surface(64);
    const colorSurface = surface(1);
    const disposers = [];
    let currentIndex = -1;
    let referencePaths = [];
    let referenceMask = null;
    let userStrokes = [];
    let activePointer = null;
    let tracing = false;
    let lastScore = null;
    let destroyed = false;
    let dprQuery = null;

    canvas.width = 300;
    canvas.height = 300;
    elements.diff.width = 128;
    elements.diff.height = 128;
    elements.model.setAttribute('viewBox', `0 0 ${SPACE} ${SPACE}`);
    elements.model.setAttribute('role', 'img');
    elements.model.setAttribute('focusable', 'false');
    elements.diff.setAttribute('role', 'img');
    elements.result.setAttribute('role', 'status');
    elements.result.setAttribute('aria-live', 'polite');
    elements.result.setAttribute('aria-atomic', 'true');
    elements['user-count'].setAttribute('aria-live', 'polite');
    elements.kana.lang = 'ja';
    elements.romaji.lang = 'ja-Latn';
    elements['meaning-en'].lang = 'en';
    elements['meaning-id'].lang = 'id';
    for (const name of ['trace', 'undo', 'clear', 'check', 'new']) elements[name].type = 'button';

    function listen(target, name, handler) {
      target.addEventListener(name, handler);
      disposers.push(() => target.removeEventListener(name, handler));
    }

    function strokeLabel(count) {
      return t(`${count} ${count === 1 ? 'stroke' : 'strokes'}`, `${count} goresan`);
    }

    function updateControls() {
      const empty = userStrokes.length === 0;
      elements.undo.disabled = empty;
      elements.clear.disabled = empty;
      elements.check.disabled = empty || activePointer !== null;
      elements.new.disabled = false;
      elements.trace.disabled = false;
      elements.trace.setAttribute('aria-pressed', String(tracing));
      elements['user-count'].textContent = t(`${strokeLabel(userStrokes.length)} drawn`, `${userStrokes.length} goresan digambar`);
    }

    function invalidateResult() {
      lastScore = null;
      elements.result.hidden = true;
      elements.feedback.textContent = '';
      for (const name of ['total', 'precision', 'recall', 'count', 'diff']) {
        elements[name].textContent = '';
        elements[name].removeAttribute('aria-label');
      }
      diffContext.clearRect(0, 0, elements.diff.width, elements.diff.height);
    }

    function pen(target, color) {
      target.lineWidth = PEN_WIDTH;
      target.lineCap = 'round';
      target.lineJoin = 'round';
      target.strokeStyle = color;
      target.fillStyle = color;
      target.setLineDash([]);
    }

    function paintUser(target) {
      for (const points of userStrokes) {
        if (!points.length) continue;
        target.beginPath();
        if (points.length === 1) {
          target.arc(points[0].x, points[0].y, PEN_WIDTH / 2, 0, Math.PI * 2);
          target.fill();
        } else {
          target.moveTo(points[0].x, points[0].y);
          for (let i = 1; i < points.length; i += 1) target.lineTo(points[i].x, points[i].y);
          target.stroke();
        }
      }
    }

    function rasterize(target, paint) {
      const { element, context } = target;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, element.width, element.height);
      context.setTransform(element.width / SPACE, 0, 0, element.height / SPACE, 0, 0);
      context.globalAlpha = 1;
      pen(context, '#000');
      paint(context);
      const rgba = context.getImageData(0, 0, element.width, element.height).data;
      return {
        width: element.width,
        height: element.height,
        data: Float64Array.from({ length: element.width * element.height }, (_, i) => rgba[i * 4 + 3] / 255),
      };
    }

    function redraw() {
      if (destroyed) return;
      const style = view.getComputedStyle(canvas);
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(canvas.width / SPACE, 0, 0, canvas.height / SPACE, 0, 0);
      pen(context, style.color || '#f5f1e8');
      context.globalAlpha = 1;
      if (tracing) {
        context.globalAlpha = 0.12;
        for (const path of referencePaths) context.stroke(path);
      }
      context.globalAlpha = 1;
      paintUser(context);
    }

    function resizeCanvas() {
      if (destroyed) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const ratio = view.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(rect.width * ratio));
      const height = Math.max(1, Math.round(rect.height * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      redraw();
    }

    function watchDpr() {
      dprQuery?.removeEventListener('change', onDprChange);
      dprQuery = view.matchMedia?.(`(resolution: ${view.devicePixelRatio || 1}dppx)`) || null;
      dprQuery?.addEventListener('change', onDprChange);
    }

    function onDprChange() {
      if (destroyed) return;
      resizeCanvas();
      watchDpr();
    }

    function paintComparison() {
      if (!lastScore) return;
      const style = view.getComputedStyle(elements.diff);
      function color(token, fallback) {
        const ctx = colorSurface.context;
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = fallback;
        ctx.fillStyle = style.getPropertyValue(token).trim() || fallback;
        ctx.fillRect(0, 0, 1, 1);
        return ctx.getImageData(0, 0, 1, 1).data;
      }
      const colors = {
        overlap: color('--accent-focus', '#67dce5'),
        extra: color('--accent-text-sm', '#ff8a80'),
        missing: color('--accent-summit', '#e9bf70'),
      };
      const comparison = lastScore.comparison;
      const image = comparisonSurface.context.createImageData(comparison.width, comparison.height);
      for (let i = 0; i < comparison.overlap.length; i += 1) {
        const kind = comparison.extra[i] > 0 ? 'extra' : comparison.missing[i] > 0 ? 'missing' : 'overlap';
        image.data[i * 4] = colors[kind][0];
        image.data[i * 4 + 1] = colors[kind][1];
        image.data[i * 4 + 2] = colors[kind][2];
        image.data[i * 4 + 3] = Math.round(comparison[kind][i] * 255);
      }
      comparisonSurface.context.putImageData(image, 0, 0);
      diffContext.clearRect(0, 0, elements.diff.width, elements.diff.height);
      diffContext.imageSmoothingEnabled = false;
      diffContext.drawImage(comparisonSurface.element, 0, 0, elements.diff.width, elements.diff.height);
    }

    function renderResult() {
      if (!lastScore) return;
      const entry = kanjiData[currentIndex];
      const { total, precision, recall, count } = lastScore;
      elements.total.textContent = String(total);
      elements.total.setAttribute('aria-label', t(`Bitmap similarity: ${total} out of 100`, `Kemiripan bitmap: ${total} dari 100`));
      for (const [name, value, label] of [
        ['precision', precision, t('Precision: drawn ink supported by the reference', 'Presisi: tinta gambar yang sesuai dengan acuan')],
        ['recall', recall, t('Recall: reference ink covered by the drawing', 'Cakupan: tinta acuan yang tercakup oleh gambar')],
        ['count', count, t('Stroke-count accuracy multiplier', 'Pengali ketepatan jumlah goresan')],
      ]) {
        elements[name].textContent = `${value}%`;
        elements[name].setAttribute('aria-label', `${label}: ${value}%`);
      }
      const feedback = total >= 85
        ? t('Close bitmap match. Compare the details with the model.', 'Bitmap sangat mirip. Bandingkan detailnya dengan contoh.')
        : total >= 50
          ? t('Some bitmap shapes match. Look for extra or missing ink.', 'Sebagian bentuk bitmap cocok. Perhatikan tinta yang berlebih atau kurang.')
          : t('The bitmap shapes differ. Compare the shapes and try again.', 'Bentuk bitmap berbeda. Bandingkan bentuknya lalu coba lagi.');
      const countNote = t(
        `Strokes drawn: ${userStrokes.length}; reference: ${entry.strokes}.`,
        `Goresan digambar: ${userStrokes.length}; acuan: ${entry.strokes}.`,
      );
      const limitation = t(
        'Bitmap similarity does not evaluate stroke order or direction. This is not a handwriting proficiency assessment or an official JLPT score.',
        'Kemiripan bitmap tidak menilai urutan atau arah goresan. Ini bukan penilaian kemahiran menulis atau skor resmi JLPT.',
      );
      elements.feedback.textContent = `${feedback} ${countNote} ${limitation}`;
      const alt = t(
        `Normalized bitmap comparison for ${entry.kanji}. Cyan: overlapping ink within tolerance; coral: extra ink; gold: missing ink. Precision ${precision}%, recall ${recall}%.`,
        `Perbandingan bitmap yang dinormalisasi untuk ${entry.kanji}. Sian: tinta yang cocok dalam toleransi; koral: tinta berlebih; emas: tinta yang kurang. Presisi ${precision}%, cakupan ${recall}%.`,
      );
      elements.diff.setAttribute('aria-label', alt);
      elements.diff.textContent = alt;
      elements.result.setAttribute('aria-label', t('Bitmap comparison result', 'Hasil perbandingan bitmap'));
      elements.result.hidden = false;
      paintComparison();
    }

    function updateLanguage() {
      if (destroyed || currentIndex < 0) return;
      const entry = kanjiData[currentIndex];
      elements.kana.textContent = entry.kana;
      elements.romaji.textContent = entry.romaji;
      elements['meaning-en'].textContent = entry.english;
      elements['meaning-id'].textContent = entry.indonesian;
      elements['stroke-count'].textContent = strokeLabel(entry.strokes);
      elements.result.setAttribute('aria-label', t('Bitmap comparison result', 'Hasil perbandingan bitmap'));
      elements.model.setAttribute('aria-label', t(`Reference strokes for ${entry.kanji}`, `Goresan acuan untuk ${entry.kanji}`));
      const drawingLabel = t(
        `Draw ${entry.kanji} here with a pen, mouse, or touch.`,
        `Gambar ${entry.kanji} di sini dengan pena, tetikus, atau sentuhan.`,
      );
      canvas.setAttribute('aria-label', drawingLabel);
      canvas.textContent = drawingLabel;
      for (const [name, label] of [
        ['trace', t('Trace', 'Jiplak')],
        ['undo', t('Undo', 'Urungkan')],
        ['clear', t('Clear', 'Hapus')],
        ['check', t('Check', 'Periksa')],
        ['new', t('New kanji', 'Kanji baru')],
      ]) {
        elements[name].textContent = label;
        elements[name].setAttribute('aria-label', name === 'trace'
          ? t('Toggle the tracing guide', 'Tampilkan atau sembunyikan panduan jiplak') : label);
      }
      updateControls();
      renderResult();
      redraw();
    }

    function releasePointer() {
      const pointer = activePointer;
      activePointer = null;
      if (pointer !== null && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
    }

    function clearDrawing() {
      if (destroyed) return;
      releasePointer();
      userStrokes = [];
      invalidateResult();
      updateControls();
      redraw();
    }

    function selectKanji(glyph) {
      if (destroyed) return false;
      const index = kanjiData.findIndex((entry) => entry.kanji === glyph);
      if (index < 0) return false;
      const entry = kanjiData[index];
      const paths = entry.paths.map((d) => new view.Path2D(d));
      const svgPaths = entry.paths.map((d) => {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', String(PEN_WIDTH));
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        return path;
      });
      currentIndex = index;
      referencePaths = paths;
      elements.model.replaceChildren(...svgPaths);
      referenceMask = rasterize(referenceSurface, (ctx) => {
        for (const path of referencePaths) ctx.stroke(path);
      });
      clearDrawing();
      updateLanguage();
      return true;
    }

    function chooseKanji() {
      if (destroyed) return;
      const candidates = kanjiData.filter((entry) => entry.kanji !== kanjiData[currentIndex]?.kanji);
      const entry = candidates[Math.floor(Math.random() * candidates.length)] || kanjiData[currentIndex];
      if (entry) selectKanji(entry.kanji);
    }

    function pointFromEvent(event) {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
      return { x: (event.clientX - rect.left) * SPACE / rect.width, y: (event.clientY - rect.top) * SPACE / rect.height };
    }

    function addPoint(event) {
      const point = pointFromEvent(event);
      if (!point) return;
      const stroke = userStrokes[userStrokes.length - 1];
      const previous = stroke[stroke.length - 1];
      // Keep a tap as a disk rather than a zero-length stroked segment.
      if (!previous || point.x !== previous.x || point.y !== previous.y) stroke.push(point);
    }

    listen(canvas, 'pointerdown', (event) => {
      if (!event.isPrimary || event.button !== 0 || activePointer !== null || !pointFromEvent(event)) return;
      event.preventDefault();
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (error) {
        // Synthetic pointer events have no browser pointer to capture.
        if (error.name !== 'NotFoundError') throw error;
      }
      activePointer = event.pointerId;
      userStrokes.push([]);
      addPoint(event);
      invalidateResult();
      updateControls();
      redraw();
    });
    listen(canvas, 'pointermove', (event) => {
      if (!event.isPrimary || activePointer !== event.pointerId) return;
      event.preventDefault();
      for (const sample of event.getCoalescedEvents?.() || []) addPoint(sample);
      addPoint(event);
      redraw();
    });
    listen(canvas, 'pointerup', (event) => {
      if (!event.isPrimary || activePointer !== event.pointerId) return;
      addPoint(event);
      releasePointer();
      updateControls();
      redraw();
    });
    const finishInterruptedStroke = (event) => {
      if (activePointer !== event.pointerId) return;
      // Keep the visible partial stroke if a device cancels or loses capture.
      releasePointer();
      updateControls();
      redraw();
    };
    listen(canvas, 'pointercancel', (event) => {
      if (event.isPrimary) finishInterruptedStroke(event);
    });
    listen(canvas, 'lostpointercapture', finishInterruptedStroke);
    listen(elements.undo, 'click', () => {
      releasePointer();
      userStrokes.pop();
      invalidateResult();
      updateControls();
      redraw();
    });
    listen(elements.clear, 'click', clearDrawing);
    listen(elements.new, 'click', chooseKanji);
    listen(elements.trace, 'click', () => {
      tracing = !tracing;
      updateControls();
      redraw();
    });
    listen(elements.check, 'click', () => {
      if (!userStrokes.length || activePointer !== null) return;
      lastScore = scoreMasks(rasterize(userSurface, paintUser), referenceMask, {
        userStrokeCount: userStrokes.length,
        referenceStrokeCount: kanjiData[currentIndex].strokes,
      });
      renderResult();
    });
    const resizeObserver = view.ResizeObserver ? new view.ResizeObserver(resizeCanvas) : null;
    resizeObserver?.observe(canvas);
    listen(view, 'resize', resizeCanvas);
    watchDpr();
    chooseKanji();
    resizeCanvas();

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      releasePointer();
      resizeObserver?.disconnect();
      dprQuery?.removeEventListener('change', onDprChange);
      for (const dispose of disposers) dispose();
      for (const name of ['trace', 'undo', 'clear', 'check', 'new']) elements[name].disabled = true;
    }

    return { selectKanji, updateLanguage, destroy };
  };
})();
