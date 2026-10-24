(() => {
  'use strict';
  const instances = new WeakMap();
  const WIDTH = 960, HEIGHT = 600, HISTORY_LIMIT = 16;
  const toolList = [
    ['brush', 'Кисть', 'B', '<path d="m15 4 5 5-9 9-5-5Z"/><path d="M6 13c-5 1-1 5-4 7 5 1 8-1 7-4"/>'],
    ['eraser', 'Ластик', 'E', '<path d="m14 3 7 7-11 11H5l-4-4Z"/><path d="m7 11 7 7M10 21h11"/>'],
    ['line', 'Линия', 'L', '<path d="m4 20 16-16"/>'],
    ['rect', 'Прямоугольник', 'R', '<rect x="3" y="5" width="18" height="14" rx="1"/>'],
    ['ellipse', 'Эллипс', 'O', '<ellipse cx="12" cy="12" rx="9" ry="7"/>'],
    ['star', 'Звезда Давида', 'S', '<path d="M12 2 3.34 17h17.32ZM12 22 3.34 7h17.32Z"/>']
  ];
  const colors = ['#214fde', '#153262', '#111827', '#ffffff', '#718096', '#e44857', '#f28c38', '#f6c945', '#37a879', '#35a8c9', '#9256c8', '#ed85b3'];
  const colorNames = ['Синий', 'Тёмно-синий', 'Чёрный', 'Белый', 'Серый', 'Красный', 'Оранжевый', 'Жёлтый', 'Зелёный', 'Голубой', 'Фиолетовый', 'Розовый'];
  const svg = paths => '<svg class="paint-icon" viewBox="0 0 24 24" aria-hidden="true">' + paths + '</svg>';
  const icons = {
    undo: '<path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12"/>',
    redo: '<path d="m16 4 5 5-5 5m5-5H10a6 6 0 0 0 0 12"/>',
    clear: '<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
    save: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6"/>'
  };

  window.createPaintApp = function createPaintApp({windowElement, onNotice = () => {}} = {}) {
    if (!windowElement || windowElement.id !== 'paint') throw new Error('Paint requires the #paint window element.');
    if (instances.has(windowElement)) return instances.get(windowElement);
    const body = windowElement.querySelector('.window-body');
    if (!body) throw new Error('Paint requires a .window-body.');
    const root = document.createElement('div');
    root.className = 'paint-app';
    root.innerHTML = '<div class="paint-ribbon">' +
      '<div class="paint-heading"><span class="paint-eyebrow">МАСТЕРСКАЯ</span><strong>Чистый лист. Ваша идея.</strong></div>' +
      '<div class="paint-actions" role="group" aria-label="Действия с рисунком">' +
      '<button type="button" id="paint-undo" title="Отменить (Ctrl+Z)" aria-label="Отменить (Ctrl+Z)">' + svg(icons.undo) + '</button>' +
      '<button type="button" id="paint-redo" title="Повторить (Ctrl+Y / Ctrl+Shift+Z)" aria-label="Повторить (Ctrl+Y / Ctrl+Shift+Z)">' + svg(icons.redo) + '</button>' +
      '<button type="button" id="paint-clear" title="Очистить холст">' + svg(icons.clear) + '<span>Очистить</span></button>' +
      '<button type="button" id="paint-save" class="paint-save" title="Скачать рисунок в PNG">' + svg(icons.save) + '<span>Скачать PNG</span></button></div></div>' +
      '<div class="paint-settings">' +
      '<div class="paint-color-group"><span class="paint-label">Цвет</span><div class="paint-palette" role="group" aria-label="Палитра">' +
      colors.map((color, i) => '<button type="button" class="paint-swatch" data-paint-color="' + color + '" style="--paint-swatch:' + color + '" title="' + colorNames[i] + '" aria-label="' + colorNames[i] + '" aria-pressed="false"></button>').join('') +
      '</div><label class="paint-custom" title="Выбрать свой цвет"><input id="paint-color" type="color" value="#214fde" aria-label="Свой цвет"><span>Свой</span></label></div>' +
      '<label class="paint-setting" for="paint-size"><span>Толщина <output id="paint-size-value" for="paint-size">5 px</output></span><input id="paint-size" type="range" min="1" max="48" value="5" title="Толщина линии в пикселях"></label>' +
      '<label class="paint-setting" for="paint-star-size"><span>Радиус звезды <output id="paint-star-value" for="paint-star-size">48 px</output></span><input id="paint-star-size" type="range" min="12" max="160" value="48" title="Радиус звезды при одиночном нажатии"></label>' +
      '<label class="paint-fill"><input id="paint-fill" type="checkbox">Заливка фигур</label></div>' +
      '<div class="paint-workspace"><div class="paint-tools" role="group" aria-label="Инструменты рисования">' +
      toolList.map(([id, label, key, paths]) => '<button type="button" class="paint-tool" data-paint-tool="' + id + '" title="' + label + ' (' + key + ')" aria-label="' + label + ' (' + key + ')" aria-pressed="false">' + svg(paths) + '<span>' + label + '</span><kbd>' + key + '</kbd></button>').join('') +
      '</div><div class="paint-paper-area"><div class="paint-paper"><canvas id="paint-canvas" width="960" height="600" tabindex="0" role="img" aria-label="Холст для рисования, 960 на 600 пикселей. Выберите инструмент и рисуйте мышью, пером или пальцем." aria-describedby="paint-hint">Для рисования необходим браузер с поддержкой Canvas.</canvas></div><div class="paint-paper-caption"><span>960 × 600 px</span><span>Белый холст · PNG</span></div></div></div>' +
      '<div class="paint-status"><span class="paint-status-dot" aria-hidden="true"></span><span id="paint-hint" role="status" aria-live="polite"></span><span class="paint-session" title="Рисунок остаётся при закрытии окна, но не при перезагрузке страницы">В этой сессии</span></div>';
    body.append(root);
    const $ = selector => root.querySelector(selector);
    const canvas = $('#paint-canvas');
    const ctx = canvas.getContext('2d', {willReadFrequently: true, alpha: false});
    if (!ctx) { root.remove(); throw new Error('Canvas 2D is unavailable.'); }
    const aborter = new AbortController();
    const listen = (target, name, handler, options = {}) => target.addEventListener(name, handler, {...options, signal: aborter.signal});
    let selectedTool = 'brush', color = '#214fde', size = 5, starSize = 48, fill = false;
    let gesture = null, destroyed = false, exporting = false;
    let history = [], historyIndex = 0;
    const downloadURLs = new Map();
    const hint = $('#paint-hint');
    const hints = {
      brush: 'Кисть · ведите по холсту. Esc — отменить текущий штрих.',
      eraser: 'Ластик · рисует белым по белому холсту.',
      line: 'Линия · нажмите и тяните до конечной точки.',
      rect: 'Прямоугольник · тяните от одного угла к другому.',
      ellipse: 'Эллипс · нажмите и тяните, чтобы задать размер.',
      star: 'Звезда Давида · нажмите для штампа; тяните от центра, чтобы изменить радиус.'
    };
    function whiteCanvas() {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
    whiteCanvas();
    history.push({pixels: ctx.getImageData(0, 0, WIDTH, HEIGHT), blank: true});
    function sync() {
      $('#paint-undo').disabled = historyIndex === 0 || !!gesture;
      $('#paint-redo').disabled = historyIndex === history.length - 1 || !!gesture;
      $('#paint-clear').disabled = history[historyIndex].blank || !!gesture;
      $('#paint-save').disabled = exporting || !!gesture;
      $('#paint-star-size').disabled = selectedTool !== 'star';
      $('#paint-fill').disabled = !['rect', 'ellipse', 'star'].includes(selectedTool);
      root.querySelectorAll('[data-paint-tool]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.paintTool === selectedTool)));
      root.querySelectorAll('[data-paint-color]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.paintColor === color)));
      canvas.dataset.tool = selectedTool;
      hint.textContent = hints[selectedTool];
    }
    function restore() { ctx.putImageData(history[historyIndex].pixels, 0, 0); }
    // Sixteen full, opaque raster states: at most 35.2 MiB of retained pixel data.
    // An unfinished gesture uses the current history entry as its rollback snapshot.
    function commit() {
      const pixels = ctx.getImageData(0, 0, WIDTH, HEIGHT);
      const next = new Uint32Array(pixels.data.buffer);
      const prev = new Uint32Array(history[historyIndex].pixels.data.buffer);
      let changed = false, blank = true;
      for (let i = 0; i < next.length; i++) {
        if (next[i] !== prev[i]) changed = true;
        if (next[i] !== 0xffffffff) blank = false;
      }
      if (changed) {
        history.splice(historyIndex + 1);
        history.push({pixels, blank});
        if (history.length > HISTORY_LIMIT) history.shift();
        historyIndex = history.length - 1;
      }
      sync();
    }
    function release(id) {
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    }
    function cancelGesture() {
      if (!gesture || destroyed) return;
      const id = gesture.id;
      gesture = null;
      restore();
      release(id);
      sync();
    }
    function selectTool(tool) {
      cancelGesture();
      selectedTool = tool;
      sync();
    }
    function travel(direction) {
      cancelGesture();
      const target = historyIndex + direction;
      if (target < 0 || target >= history.length) return;
      historyIndex = target;
      restore();
      sync();
    }
    function point(event) {
      const rect = canvas.getBoundingClientRect();
      return {x: (event.clientX - rect.left) * WIDTH / rect.width, y: (event.clientY - rect.top) * HEIGHT / rect.height};
    }
    function penStyle(g) {
      ctx.strokeStyle = g.tool === 'eraser' ? '#ffffff' : g.color;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = g.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }
    function dot(p, g) {
      penStyle(g);
      ctx.beginPath();
      ctx.arc(p.x, p.y, g.size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    function stroke(from, to, g) {
      penStyle(g);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    function shape(p, g) {
      restore();
      penStyle(g);
      const a = g.start, dx = p.x - a.x, dy = p.y - a.y;
      ctx.beginPath();
      if (g.tool === 'star') {
        const radius = g.dragged ? Math.hypot(dx, dy) : g.starSize;
        // Exactly two equilateral triangles, each inscribed in the same circle.
        for (const rotation of [-Math.PI / 2, Math.PI / 2]) {
          for (let i = 0; i < 3; i++) {
            const angle = rotation + i * Math.PI * 2 / 3;
            const x = a.x + radius * Math.cos(angle), y = a.y + radius * Math.sin(angle);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath();
        }
      } else if (g.tool === 'line') {
        ctx.moveTo(a.x, a.y); ctx.lineTo(p.x, p.y);
      } else if (g.tool === 'rect') {
        ctx.rect(Math.min(a.x, p.x), Math.min(a.y, p.y), Math.abs(dx), Math.abs(dy));
      } else {
        ctx.ellipse((a.x + p.x) / 2, (a.y + p.y) / 2, Math.abs(dx) / 2, Math.abs(dy) / 2, 0, 0, Math.PI * 2);
      }
      if (g.fill && g.tool !== 'line') ctx.fill();
      ctx.stroke();
    }
    function updateGesture(event) {
      const g = gesture;
      if (!g || event.pointerId !== g.id) return;
      const p = point(event);
      if (Math.hypot(event.clientX - g.clientX, event.clientY - g.clientY) >= 3) g.dragged = true;
      if (g.tool === 'brush' || g.tool === 'eraser') stroke(g.last, p, g);
      else shape(p, g);
      g.last = p;
    }
    listen(canvas, 'pointerdown', event => {
      if (gesture || !event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      canvas.focus({preventScroll: true});
      const p = point(event);
      gesture = {id: event.pointerId, start: p, last: p, clientX: event.clientX, clientY: event.clientY, dragged: false, tool: selectedTool, color, size, starSize, fill};
      const rect = canvas.getBoundingClientRect();
      gesture.displayWidth = rect.width;
      gesture.displayHeight = rect.height;
      canvas.setPointerCapture(event.pointerId);
      if (selectedTool === 'brush' || selectedTool === 'eraser') dot(p, gesture);
      else shape(p, gesture);
      sync();
    });
    listen(canvas, 'pointermove', event => {
      if (!gesture || gesture.id !== event.pointerId) return;
      event.preventDefault();
      const samples = (gesture.tool === 'brush' || gesture.tool === 'eraser') && event.getCoalescedEvents ? event.getCoalescedEvents() : [];
      if (samples.length) samples.forEach(updateGesture); else updateGesture(event);
    });
    listen(canvas, 'pointerup', event => {
      if (!gesture || gesture.id !== event.pointerId) return;
      updateGesture(event);
      gesture = null;
      release(event.pointerId);
      commit();
    });
    listen(canvas, 'pointercancel', event => { if (gesture && gesture.id === event.pointerId) cancelGesture(); });
    listen(canvas, 'lostpointercapture', event => { if (gesture && gesture.id === event.pointerId) cancelGesture(); });
    listen(window, 'blur', cancelGesture);
    listen(window, 'resize', cancelGesture);
    const resizeObserver = new ResizeObserver(() => {
      if (gesture) {
        const rect = canvas.getBoundingClientRect();
        if (rect.width !== gesture.displayWidth || rect.height !== gesture.displayHeight) cancelGesture();
      }
    });
    resizeObserver.observe(canvas);
    const visibilityObserver = new MutationObserver(() => {
      if (gesture && (windowElement.hidden || !windowElement.getClientRects().length)) cancelGesture();
    });
    visibilityObserver.observe(windowElement, {attributes: true, attributeFilter: ['hidden', 'style', 'class']});
    listen(document, 'visibilitychange', () => { if (document.hidden) cancelGesture(); });
    root.querySelectorAll('[data-paint-tool]').forEach(button => listen(button, 'click', () => selectTool(button.dataset.paintTool)));
    root.querySelectorAll('[data-paint-color]').forEach(button => listen(button, 'click', () => {
      cancelGesture(); color = button.dataset.paintColor; $('#paint-color').value = color; sync();
    }));
    listen($('#paint-color'), 'input', event => { cancelGesture(); color = event.target.value; sync(); });
    listen($('#paint-size'), 'input', event => { size = Number(event.target.value); $('#paint-size-value').value = size + ' px'; });
    listen($('#paint-star-size'), 'input', event => { starSize = Number(event.target.value); $('#paint-star-value').value = starSize + ' px'; });
    listen($('#paint-fill'), 'change', event => { fill = event.target.checked; });
    listen($('#paint-undo'), 'click', () => travel(-1));
    listen($('#paint-redo'), 'click', () => travel(1));
    listen($('#paint-clear'), 'click', () => {
      cancelGesture();
      if (window.confirm('Очистить весь холст? Это действие можно отменить.')) { whiteCanvas(); commit(); }
    });
    listen($('#paint-save'), 'click', () => {
      if (exporting || gesture) return;
      exporting = true;
      sync();
      const finish = blob => {
        if (destroyed) return;
        exporting = false;
        sync();
        if (!blob) { onNotice('Не удалось подготовить PNG. Попробуйте ещё раз.'); return; }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'havanagila-paint-' + new Date().toISOString().replace(/[:.]/g, '-') + '.png';
        link.hidden = true;
        root.append(link);
        link.click();
        link.remove();
        const timer = window.setTimeout(() => { URL.revokeObjectURL(url); downloadURLs.delete(url); }, 60000);
        downloadURLs.set(url, timer);
        onNotice('Рисунок подготовлен для скачивания');
      };
      try { canvas.toBlob(finish, 'image/png'); }
      catch { exporting = false; sync(); onNotice('Не удалось подготовить PNG. Попробуйте ещё раз.'); }
    });
    listen(document, 'keydown', event => {
      if (destroyed || windowElement.hidden || !windowElement.contains(document.activeElement) || !windowElement.getClientRects().length) return;
      if (windowElement.classList.contains('app-window') && !windowElement.classList.contains('focused')) return;
      if (event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
      if (event.key === 'Escape' && gesture) { event.preventDefault(); cancelGesture(); return; }
      if (event.altKey) return;
      const key = event.key.toLowerCase();
      if (event.ctrlKey || event.metaKey) {
        if (key === 'z' || key === 'y') { event.preventDefault(); travel(key === 'y' || event.shiftKey ? 1 : -1); }
        return;
      }
      if (event.shiftKey || event.repeat) return;
      const tool = toolList.find(item => item[2].toLowerCase() === key);
      if (tool) { event.preventDefault(); selectTool(tool[0]); }
    });
    function destroy() {
      if (destroyed) return;
      cancelGesture();
      destroyed = true;
      aborter.abort();
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      downloadURLs.forEach((timer, url) => { clearTimeout(timer); URL.revokeObjectURL(url); });
      downloadURLs.clear();
      history = [];
      canvas.width = 0;
      canvas.height = 0;
      root.remove();
      instances.delete(windowElement);
    }
    const api = {cancelGesture, destroy};
    instances.set(windowElement, api);
    sync();
    return api;
  };
})();
