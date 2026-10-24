/* Desktop icon interactions. Load after app styles, instantiate after removing
 * the application's old icon click/double-click/keydown listeners. */
(function () {
  'use strict';
  const STORAGE_KEY = 'havanagila.desktop-icons.v1';
  const instances = new WeakMap();
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  window.createDesktopIcons = function createDesktopIcons(options = {}) {
    const desktop = options.desktop || document.querySelector('#desktop');
    const container = options.container || desktop?.querySelector('.desktop-icons');
    if (!desktop || !container || !desktop.contains(container)) {
      throw new TypeError('createDesktopIcons requires a desktop and its icon container');
    }
    instances.get(desktop)?.destroy();
    const icons = Array.from(container.querySelectorAll('.desktop-icon[data-app]'));
    const byId = new Map(icons.map(icon => [icon.dataset.app, icon]));
    const selected = new Set();
    const positions = new Map();
    const removers = [];
    const originals = icons.map(icon => ({
      icon, style: icon.getAttribute('style'), pressed: icon.getAttribute('aria-pressed'),
      draggable: icon.getAttribute('draggable'), selected: icon.classList.contains('selected')
    }));
    const oldTabIndex = desktop.getAttribute('tabindex');
    const hadDesktopClass = desktop.classList.contains('desktop-icons-enabled');
    const hadContainerClass = container.classList.contains('desktop-icons-managed');
    let layouts = { wide: Object.create(null), narrow: Object.create(null) };
    let gesture = null;
    let destroyed = false;
    let resizeFrame = 0;
    let noticeSent = false;
    let suppressUntil = 0;
    let suppressedIcons = new Set();
    let lastTouchOpen = -Infinity;
    let geometry;
    const rectangle = document.createElement('div');
    rectangle.className = 'desktop-selection-rectangle';
    rectangle.setAttribute('aria-hidden', 'true');
    rectangle.hidden = true;
    desktop.classList.add('desktop-icons-enabled');
    container.classList.add('desktop-icons-managed');
    if (!desktop.hasAttribute('tabindex')) desktop.tabIndex = 0;
    desktop.appendChild(rectangle);

    function listen(target, type, handler, opts) {
      target.addEventListener(type, handler, opts);
      removers.push(() => target.removeEventListener(type, handler, opts));
    }
    function notice() {
      if (noticeSent || typeof options.onNotice !== 'function') return;
      noticeSent = true;
      options.onNotice('Не удалось сохранить расположение значков. Оно останется доступным до закрытия страницы.');
    }
    function load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (!saved || saved.version !== 1 || !saved.layouts || typeof saved.layouts !== 'object') return;
        for (const mode of ['wide', 'narrow']) {
          const source = saved.layouts[mode];
          if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
          for (const id of byId.keys()) {
            const p = Object.prototype.hasOwnProperty.call(source, id) && source[id];
            if (p && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y)
              && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) {
              layouts[mode][id] = { x: p.x, y: p.y };
            }
          }
        }
      } catch (_) { notice(); }
    }
    function save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, layouts }));
      } catch (_) { notice(); }
    }
    function measure() {
      const width = desktop.clientWidth;
      const height = desktop.clientHeight;
      const narrow = window.matchMedia('(max-width: 640px)').matches;
      const gap = narrow ? (width <= 360 ? 6 : 7) : 9;
      return {
        width, height, mode: narrow ? 'narrow' : 'wide',
        iconWidth: Math.min(width, narrow ? Math.max(1, (width - 28 - gap * 2) / 3) : 98),
        iconHeight: Math.min(height, narrow && width <= 360 ? 91 : 100), gap
      };
    }
    function setPosition(icon, p) {
      positions.set(icon, { x: p.x, y: p.y });
      icon.style.left = p.x + 'px';
      icon.style.top = p.y + 'px';
    }
    function renderLayout() {
      geometry = measure();
      const g = geometry;
      const maxX = Math.max(0, g.width - g.iconWidth);
      const maxY = Math.max(0, g.height - g.iconHeight);
      const rows = Math.max(1, Math.floor((g.height - 26 - 40 + 9) / 109));
      icons.forEach((icon, index) => {
        icon.style.width = g.iconWidth + 'px';
        icon.style.height = g.iconHeight + 'px';
        let x, y;
        const preferred = layouts[g.mode][icon.dataset.app];
        if (preferred) {
          x = preferred.x * maxX;
          y = preferred.y * maxY;
        } else if (g.mode === 'narrow') {
          x = 14 + (index % 3) * (g.iconWidth + g.gap);
          y = (g.width <= 360 ? 14 : 20) + Math.floor(index / 3) * (g.iconHeight + 12);
        } else {
          x = 24 + Math.floor(index / rows) * 107;
          y = 26 + (index % rows) * 109;
        }
        setPosition(icon, { x: clamp(x, 0, maxX), y: clamp(y, 0, maxY) });
      });
    }
    function updateSelection(next) {
      selected.clear();
      for (const icon of next) if (positions.has(icon)) selected.add(icon);
      for (const icon of icons) {
        const active = selected.has(icon);
        icon.classList.toggle('selected', active);
        icon.setAttribute('aria-pressed', String(active));
      }
    }
    function focus(element) {
      try { element.focus({ preventScroll: true }); } catch (_) { element.focus(); }
    }
    function iconAt(target) {
      const icon = target instanceof Element ? target.closest('.desktop-icon[data-app]') : null;
      return icon && byId.get(icon.dataset.app) === icon ? icon : null;
    }
    function backgroundAt(target) {
      if (!(target instanceof Element) || !desktop.contains(target)) return false;
      // Deliberately allow only the desktop and known decorative surfaces. A new
      // widget/control cannot accidentally become a rubber-band starting point.
      return target === desktop || target === container || !!target.closest(
        '.desktop-watermark, .desktop-hint, .build-label, .clock-widget'
      ) && !target.closest('button,a,input,textarea,select,[contenteditable],.app-window,.welcome-card');
    }
    function point(event) {
      const bounds = desktop.getBoundingClientRect();
      return {
        x: event.clientX - bounds.left - desktop.clientLeft,
        y: event.clientY - bounds.top - desktop.clientTop
      };
    }
    function open(icon) {
      if (!destroyed && icon && typeof options.onOpen === 'function') options.onOpen(icon.dataset.app);
    }
    function beginCapture(event, owner) {
      try { owner.setPointerCapture(event.pointerId); } catch (_) { /* Window listeners remain a fallback. */ }
      document.documentElement.classList.add('desktop-icons-gesturing');
    }
    function pointerDown(event) {
      if (destroyed || gesture || event.button !== 0 || event.isPrimary === false) return;
      const icon = iconAt(event.target);
      if (!icon && !backgroundAt(event.target)) return;
      const previous = new Set(selected);
      const toggle = event.ctrlKey || event.metaKey;
      const add = event.shiftKey;
      const start = point(event);
      if (icon) {
        focus(icon);
        const next = new Set(selected);
        if (toggle) {
          if (next.has(icon)) next.delete(icon); else next.add(icon);
        } else if (add) next.add(icon);
        else if (!next.has(icon)) { next.clear(); next.add(icon); }
        updateSelection(next);
        gesture = {
          type: 'icons', id: event.pointerId, owner: icon, icon, start,
          before: new Map(Array.from(selected, item => [item, { ...positions.get(item) }])),
          previous, toggle, add, collapse: !toggle && !add, moved: false,
          touch: event.pointerType === 'touch'
        };
      } else {
        focus(desktop);
        if (!toggle && !add) updateSelection([]);
        gesture = {
          type: 'rectangle', id: event.pointerId, owner: desktop, start,
          previous, toggle, add, moved: false, touch: event.pointerType === 'touch'
        };
        if (typeof options.onBackground === 'function') options.onBackground();
      }
      // Touch retains native click generation, but our click handler consumes it.
      // preventDefault for mouse/pen prevents browser selection immediately.
      if (event.pointerType !== 'touch') event.preventDefault();
      beginCapture(event, gesture.owner);
    }
    function moveGesture(event) {
      const g = gesture;
      if (!g || event.pointerId !== g.id) return;
      const p = point(event);
      const rawX = p.x - g.start.x, rawY = p.y - g.start.y;
      if (!g.moved && Math.hypot(rawX, rawY) < (g.touch ? 9 : 5)) return;
      g.moved = true;
      if (event.cancelable) event.preventDefault();
      if (g.type === 'icons') {
        if (!g.before.size) return;
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        for (const position of g.before.values()) {
          left = Math.min(left, position.x); top = Math.min(top, position.y);
          right = Math.max(right, position.x + geometry.iconWidth);
          bottom = Math.max(bottom, position.y + geometry.iconHeight);
        }
        const dx = clamp(rawX, -left, geometry.width - right);
        const dy = clamp(rawY, -top, geometry.height - bottom);
        for (const [icon, position] of g.before) {
          icon.classList.add('desktop-icon-dragging');
          setPosition(icon, { x: position.x + dx, y: position.y + dy });
        }
      } else {
        const x1 = clamp(g.start.x, 0, geometry.width), y1 = clamp(g.start.y, 0, geometry.height);
        const x2 = clamp(p.x, 0, geometry.width), y2 = clamp(p.y, 0, geometry.height);
        const left = Math.min(x1, x2), top = Math.min(y1, y2);
        const right = Math.max(x1, x2), bottom = Math.max(y1, y2);
        Object.assign(rectangle.style, { left: left + 'px', top: top + 'px', width: (right - left) + 'px', height: (bottom - top) + 'px' });
        rectangle.hidden = false;
        const next = new Set(g.toggle || g.add ? g.previous : []);
        for (const icon of icons) {
          const pos = positions.get(icon);
          if (pos.x < right && pos.x + geometry.iconWidth > left && pos.y < bottom && pos.y + geometry.iconHeight > top) {
            if (g.toggle && next.has(icon)) next.delete(icon); else next.add(icon);
          }
        }
        updateSelection(next);
      }
    }
    function finish(cancelled) {
      const g = gesture;
      if (!g) return;
      gesture = null; // releasePointerCapture can synchronously dispatch capture loss.
      rectangle.hidden = true;
      document.documentElement.classList.remove('desktop-icons-gesturing');
      icons.forEach(icon => icon.classList.remove('desktop-icon-dragging'));
      try { if (g.owner.hasPointerCapture(g.id)) g.owner.releasePointerCapture(g.id); } catch (_) { /* Already released. */ }
      if (cancelled) {
        if (g.before) for (const [icon, p] of g.before) setPosition(icon, p);
        updateSelection(g.previous);
        if (g.moved && g.type === 'icons') {
          suppressUntil = performance.now() + 500;
          suppressedIcons = new Set(g.before.keys());
        }
        return;
      }
      if (g.moved) {
        if (g.type === 'icons') {
          suppressUntil = performance.now() + 500;
          suppressedIcons = new Set(g.before.keys());
        }
        if (g.type === 'icons' && g.before.size) {
          const maxX = Math.max(0, geometry.width - geometry.iconWidth);
          const maxY = Math.max(0, geometry.height - geometry.iconHeight);
          for (const icon of g.before.keys()) {
            const p = positions.get(icon);
            const old = layouts[geometry.mode][icon.dataset.app];
            layouts[geometry.mode][icon.dataset.app] = {
              x: maxX ? clamp(p.x / maxX, 0, 1) : (old?.x || 0),
              y: maxY ? clamp(p.y / maxY, 0, 1) : (old?.y || 0)
            };
          }
          save();
        }
      } else if (g.type === 'icons') {
        if (g.collapse) updateSelection([g.icon]);
        if (g.touch) { lastTouchOpen = performance.now(); open(g.icon); }
      }
    }
    function pointerUp(event) {
      if (!gesture || event.pointerId !== gesture.id) return;
      moveGesture(event); // Account for a final movement without a pointermove.
      finish(false);
    }
    function cancelPointer(event) {
      if (gesture && event.pointerId === gesture.id) finish(true);
    }
    function click(event) {
      const icon = iconAt(event.target);
      if (!icon) return;
      // Ordinary pointer selection is settled on pointerup; this also prevents
      // generated touch clicks and accidental post-drag activation reaching app code.
      event.preventDefault();
      event.stopPropagation();
      if (suppressedIcons.has(icon) && performance.now() < suppressUntil) return;
      // Assistive technology invokes a button without pointer events (detail 0).
      if (event.detail === 0) { updateSelection([icon]); open(icon); }
    }
    function doubleClick(event) {
      const icon = iconAt(event.target);
      if (!icon) return;
      event.preventDefault();
      event.stopPropagation();
      if ((suppressedIcons.has(icon) && performance.now() < suppressUntil) || performance.now() - lastTouchOpen < 600) return;
      open(icon);
    }
    function keyDown(event) {
      const target = event.target;
      const icon = iconAt(target);
      if (target !== desktop && target !== container && !icon) return;
      if (event.key === 'Escape') {
        if (gesture) finish(true); else updateSelection([]);
        event.preventDefault(); event.stopPropagation();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        updateSelection(icons); event.preventDefault(); event.stopPropagation();
      } else if (event.key === 'Enter' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault(); event.stopPropagation();
        if (event.repeat) return;
        if (!selected.size && icon) updateSelection([icon]);
        for (const item of Array.from(selected)) open(item);
      } else if (event.key === ' ' && icon) {
        event.preventDefault(); event.stopPropagation();
        if (event.repeat) return;
        const next = new Set(event.ctrlKey || event.metaKey || event.shiftKey ? selected : []);
        if (next.has(icon) && (event.ctrlKey || event.metaKey)) next.delete(icon); else next.add(icon);
        updateSelection(next);
      }
    }
    function scheduleLayout() {
      if (destroyed) return;
      // Do not persist responsive clamping: preferred normalized coordinates stay
      // intact, and wide/narrow layouts never overwrite each other on resize.
      finish(true);
      if (!resizeFrame) resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        if (!destroyed) renderLayout();
      });
    }
    function preventNative(event) {
      if (iconAt(event.target) || gesture) event.preventDefault();
    }
    const api = {
      resetLayout() {
        if (destroyed) return;
        finish(true);
        layouts = { wide: Object.create(null), narrow: Object.create(null) };
        renderLayout(); save();
      },
      clearSelection() { if (!destroyed) { finish(true); updateSelection([]); } },
      getSelection() { return icons.filter(icon => selected.has(icon)).map(icon => icon.dataset.app); },
      cancelGesture() { finish(true); },
      destroy() {
        if (destroyed) return;
        finish(true); destroyed = true;
        if (resizeFrame) cancelAnimationFrame(resizeFrame);
        observer?.disconnect();
        removers.forEach(remove => remove());
        rectangle.remove();
        if (!hadDesktopClass) desktop.classList.remove('desktop-icons-enabled');
        if (!hadContainerClass) container.classList.remove('desktop-icons-managed');
        restoreAttribute(desktop, 'tabindex', oldTabIndex);
        originals.forEach(({ icon, style, pressed, draggable, selected: wasSelected }) => {
          restoreAttribute(icon, 'style', style);
          restoreAttribute(icon, 'aria-pressed', pressed);
          restoreAttribute(icon, 'draggable', draggable);
          icon.classList.toggle('selected', wasSelected);
        });
        selected.clear();
        instances.delete(desktop);
      }
    };
    function restoreAttribute(element, name, value) {
      if (value === null) element.removeAttribute(name); else element.setAttribute(name, value);
    }
    icons.forEach(icon => { icon.draggable = false; });
    load(); renderLayout(); updateSelection([]);
    listen(desktop, 'pointerdown', pointerDown);
    listen(window, 'pointermove', moveGesture, { passive: false });
    listen(window, 'pointerup', pointerUp);
    listen(window, 'pointercancel', cancelPointer);
    listen(window, 'lostpointercapture', cancelPointer);
    listen(window, 'blur', () => finish(true));
    listen(document, 'visibilitychange', () => { if (document.hidden) finish(true); });
    listen(desktop, 'click', click);
    listen(desktop, 'dblclick', doubleClick);
    listen(desktop, 'keydown', keyDown);
    // Escape also ends a capture if focus was moved programmatically mid-drag.
    listen(window, 'keydown', event => {
      if (gesture && event.key === 'Escape') { finish(true); event.preventDefault(); }
    });
    listen(desktop, 'dragstart', preventNative);
    listen(desktop, 'selectstart', preventNative);
    listen(window, 'resize', scheduleLayout);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      if (desktop.clientWidth !== geometry.width || desktop.clientHeight !== geometry.height) scheduleLayout();
    }) : null;
    observer?.observe(desktop);
    instances.set(desktop, api);
    return api;
  };
})();
