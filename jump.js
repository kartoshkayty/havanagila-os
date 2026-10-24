/* Bibi Jump — original canvas artwork and deterministic, fixed-step physics. */
(function (global) {
  'use strict';
  const C = Object.freeze({ width: 420, height: 560, playerWidth: 52, playerHeight: 72,
    gravity: 1500, bounce: 570, speed: 280, acceleration: 1900, step: 1 / 120,
    spawnY: 500, cameraLine: 210, maxPlatforms: 28 });
  const BEST_KEY = 'havanagila.bibi-jump.best.v1';

  // Coordinates are world-space pixels, +y downward. No DOM, clock, or storage here.
  function createJumpModel(options = {}) {
    const initialSeed = Number(options.seed) >>> 0 || 0xB1B12026;
    let seed, state = 'ready', player, platforms, cameraY, score, best;
    let jumps, accumulator, nextId, highestFoot;
    best = Math.max(0, Math.floor(Number(options.best) || 0));
    function random() {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return (seed >>> 0) / 4294967296;
    }
    function generate() {
      while (platforms[platforms.length - 1].y > cameraY - C.height) {
        const last = platforms[platforms.length - 1];
        const id = nextId++;
        const width = id < 4 ? 116 : 100 + Math.floor(random() * 17);
        // Max rise 82 < v²/(2g) = 108.3. Max center shift 82; never a blind leap.
        const gap = id < 4 ? 72 : 70 + Math.floor(random() * 13);
        const previousCenter = last.x + last.width / 2;
        const center = id === 1 ? 210 : id === 2 ? 252 : id === 3 ? 194 :
          Math.max(65, Math.min(C.width - 65, previousCenter + (random() * 2 - 1) * 82));
        platforms.push({ id, x: center - width / 2, y: last.y - gap, width, height: 12,
          kind: id % 3 === 0 ? 'blue' : 'green' });
      }
      platforms = platforms.filter(p => p.y < cameraY + C.height + 100).slice(-C.maxPlatforms);
    }
    function reset() {
      seed = initialSeed; cameraY = 0; score = 0; jumps = 0; accumulator = 0; nextId = 1;
      highestFoot = C.spawnY;
      player = { x: (C.width - C.playerWidth) / 2, y: C.spawnY - C.playerHeight,
        vx: 0, vy: 0, width: C.playerWidth, height: C.playerHeight };
      platforms = [{ id: 0, x: 135, y: C.spawnY, width: 150, height: 14, kind: 'blue' }];
      generate();
    }
    function start() { reset(); state = 'playing'; player.vy = -C.bounce; jumps = 1; }
    function pause() { if (state === 'playing') { state = 'paused'; accumulator = 0; } }
    function resume() { if (state === 'paused') { state = 'playing'; accumulator = 0; } }
    function tick(direction) {
      const p = player, dt = C.step, oldFoot = p.y + p.height;
      const target = direction * C.speed;
      const change = C.acceleration * dt;
      p.vx += Math.max(-change, Math.min(change, target - p.vx));
      p.x += p.vx * dt;
      if (p.x < -p.width / 2) p.x += C.width;
      if (p.x > C.width - p.width / 2) p.x -= C.width;
      p.y += p.vy * dt + C.gravity * dt * dt / 2;
      p.vy += C.gravity * dt;
      const newFoot = p.y + p.height;
      if (p.vy > 0) {
        // Crossed tops only: no underside/side snaps. Highest crossed platform wins.
        const landed = platforms.filter(platform => oldFoot <= platform.y + 0.001 && newFoot >= platform.y &&
          [-C.width, 0, C.width].some(offset => p.x + offset + p.width - 9 > platform.x &&
            p.x + offset + 9 < platform.x + platform.width)).sort((a, b) => a.y - b.y)[0];
        if (landed) { p.y = landed.y - p.height; p.vy = -C.bounce; jumps++; }
      }
      highestFoot = Math.min(highestFoot, p.y + p.height);
      score = Math.max(score, Math.floor((C.spawnY - highestFoot) / 10));
      best = Math.max(best, score);
      const targetCamera = Math.min(cameraY, p.y - C.cameraLine);
      cameraY += (targetCamera - cameraY) * (1 - Math.exp(-12 * dt));
      generate();
      if (p.y > cameraY + C.height + 40) { state = 'gameover'; accumulator = 0; p.vx = 0; }
    }
    function step(seconds, direction = 0) {
      if (state !== 'playing' || !Number.isFinite(seconds) || seconds <= 0) return;
      accumulator += Math.min(seconds, 0.1);
      const axis = Math.max(-1, Math.min(1, Number(direction) || 0));
      while (accumulator + 1e-10 >= C.step && state === 'playing') {
        accumulator -= C.step; tick(axis);
      }
    }
    function getState() {
      return { state, score, best, player: { ...player }, cameraY,
        platforms: platforms.map(p => ({ ...p })), jumps };
    }
    reset();
    return Object.freeze({ start, pause, resume, step, getState });
  }

  function createJumpGame({ windowElement, portraitImage, onNotice } = {}) {
    if (!windowElement) throw new TypeError('Bibi Jump requires windowElement');
    if (windowElement.jumpGame) return windowElement.jumpGame;
    const body = windowElement.querySelector('.window-body');
    if (!body) throw new TypeError('Bibi Jump requires .window-body');
    let storedBest = 0;
    try { storedBest = Number(global.localStorage.getItem(BEST_KEY)) || 0; } catch (_) { /* private mode */ }
    const model = createJumpModel({ best: Number.isFinite(storedBest) ? storedBest : 0 });
    body.innerHTML = `<section class="jump-game" data-state="ready" aria-label="Bibi Jump">
      <header class="jump-hud"><div class="jump-brand"><span class="jump-eyebrow">МИНИ-АРКАДА</span><strong>Bibi Jump<span>↑</span></strong></div>
      <div class="jump-counters"><div><span>ВЫСОТА</span><strong><b id="jump-score">0</b><small> м</small></strong></div><div><span>РЕКОРД</span><strong><b id="jump-best">0</b><small> м</small></strong></div></div>
      <button id="jump-pause" type="button" aria-label="Приостановить игру" title="Пауза · P" disabled>Ⅱ</button></header>
      <div class="jump-stage"><canvas id="jump-canvas" width="840" height="1120" tabindex="0" role="img" aria-label="Биби в синей кипе прыгает по платформам. Управляйте стрелками или кнопками внизу."></canvas>
      <div id="jump-overlay" class="jump-overlay"><div class="jump-card"><span class="jump-card-label">ТОЛЬКО ВВЕРХ!</span><h2 id="jump-message">Ещё на этаж выше?</h2><p id="jump-description">Прыжки — сами. Направление — за вами.<br>Ловите платформы и набирайте высоту.</p>
      <div class="jump-key-guide"><span><kbd>←</kbd> <kbd>→</kbd> или <kbd>A</kbd> <kbd>D</kbd></span><small>За краем экрана — другая сторона</small></div>
      <button id="jump-start" class="jump-primary" type="button">Поехали! <span>↑</span></button><button id="jump-restart" class="jump-primary" type="button" hidden>Ещё попытка <span>↗</span></button><small class="jump-space-hint">Пробел — старт · P — пауза</small></div></div>
      <span class="jump-paper-label" aria-hidden="true">ВЫШЕ ОБЛАКОВ · BIBI JUMP</span></div>
      <footer class="jump-footer"><div class="jump-touch"><button id="jump-left" type="button" aria-label="Двигаться влево">← <span>ВЛЕВО</span></button><span class="jump-bounce-hint">Прыгаем<br>автоматически</span><button id="jump-right" type="button" aria-label="Двигаться вправо"><span>ВПРАВО</span> →</button></div><div class="jump-footer-meta"><p>Держите направление. Не теряйте платформу.</p><button id="jump-new" type="button" title="Начать новый забег">↻ Заново</button></div></footer></section>`;
    const root = body.querySelector('.jump-game');
    const $ = selector => root.querySelector(selector);
    const canvas = $('#jump-canvas'), ctx = canvas.getContext('2d');
    const overlay = $('#jump-overlay'), startButton = $('#jump-start'), restartButton = $('#jump-restart');
    const pauseButton = $('#jump-pause');
    const keys = new Set(), pointers = new Map(), cleanup = [];
    let raf = 0, lastTime = 0, destroyed = false, shownState = '', savedBest = storedBest;
    const portrait = portraitImage || document.querySelector('.dancer-head img, img.dancer-head');
    function listen(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      cleanup.push(() => target.removeEventListener(type, handler, options));
    }
    function active() {
      return !destroyed && windowElement.isConnected && !document.hidden &&
        windowElement.classList.contains('focused') && !windowElement.closest('[hidden], .hidden') &&
        global.getComputedStyle(windowElement).display !== 'none' &&
        global.getComputedStyle(windowElement).visibility !== 'hidden';
    }
    function clearKeys() {
      keys.clear(); pointers.clear();
      $('#jump-left').classList.remove('is-held'); $('#jump-right').classList.remove('is-held');
    }
    function axis() {
      const values = Array.from(pointers.values());
      return Number(keys.has('ArrowRight') || keys.has('KeyD') || values.includes(1)) -
        Number(keys.has('ArrowLeft') || keys.has('KeyA') || values.includes(-1));
    }
    function saveBest(best) {
      if (best <= savedBest) return;
      savedBest = best;
      try { global.localStorage.setItem(BEST_KEY, String(best)); } catch (_) { /* memory best still works */ }
    }
    function rounded(x, y, w, h, radius, fill, stroke) {
      ctx.beginPath(); ctx.roundRect(x, y, w, h, radius);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
    }
    function cloud(x, y, scale) {
      ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale); ctx.beginPath();
      ctx.moveTo(-34, 12); ctx.bezierCurveTo(-55, 10, -48, -12, -29, -10);
      ctx.bezierCurveTo(-28, -37, 8, -42, 16, -14); ctx.bezierCurveTo(40, -26, 60, 12, 32, 14);
      ctx.closePath(); ctx.fillStyle = '#ffffffb5'; ctx.fill(); ctx.strokeStyle = '#b9d3dd'; ctx.lineWidth = 1.1; ctx.stroke(); ctx.restore();
    }
    function hero(p, cameraY, offset = 0) {
      ctx.save(); ctx.translate(p.x + p.width / 2 + offset, p.y - cameraY);
      // Entire cap, face, original suit and shoes fit a 52 × 72 world-pixel body.
      ctx.lineWidth = 1.8; ctx.lineJoin = 'round';
      ctx.strokeStyle = '#203d62'; ctx.fillStyle = '#25486c';
      ctx.beginPath(); ctx.moveTo(-14, 42); ctx.lineTo(-23, 56); ctx.lineTo(-18, 60);
      ctx.lineTo(-12, 53); ctx.lineTo(-13, 65); ctx.lineTo(13, 65); ctx.lineTo(12, 53);
      ctx.lineTo(18, 60); ctx.lineTo(23, 56); ctx.lineTo(14, 42); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fffdf4'; ctx.beginPath(); ctx.moveTo(-8, 44); ctx.lineTo(0, 62); ctx.lineTo(8, 44); ctx.fill();
      ctx.fillStyle = '#3980b5'; ctx.beginPath(); ctx.moveTo(0, 47); ctx.lineTo(-3, 51); ctx.lineTo(0, 60); ctx.lineTo(3, 51); ctx.closePath(); ctx.fill();
      rounded(-12, 62, 9, 9, 2, '#244361'); rounded(3, 62, 9, 9, 2, '#244361');
      rounded(-15, 68, 13, 4, 2, '#17324e'); rounded(2, 68, 13, 4, 2, '#17324e');
      ctx.save(); ctx.beginPath(); ctx.ellipse(0, 28, 21, 25, 0, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = '#edc7a0'; ctx.fillRect(-22, 3, 44, 50);
      if (portrait && portrait.complete && portrait.naturalWidth) {
        ctx.drawImage(portrait, 138, 40, 212, 275, -21, 3, 42, 50);
      } else {
        ctx.fillStyle = '#d6d9d8'; ctx.fillRect(-22, 3, 44, 12);
        ctx.fillStyle = '#254568'; ctx.fillRect(-12, 25, 5, 2); ctx.fillRect(7, 25, 5, 2);
        ctx.beginPath(); ctx.moveTo(-6, 39); ctx.lineTo(6, 39); ctx.stroke();
      }
      ctx.restore(); ctx.beginPath(); ctx.ellipse(0, 28, 21, 25, 0, 0, Math.PI * 2);
      ctx.strokeStyle = '#284966'; ctx.lineWidth = 1.3; ctx.stroke();
      // Kippah sits ON the forehead: blue domed cap with a white six-point star.
      ctx.beginPath(); ctx.moveTo(-21, 15); ctx.bezierCurveTo(-22, -5, 22, -5, 21, 15);
      ctx.quadraticCurveTo(0, 19, -21, 15); ctx.fillStyle = '#1769c5'; ctx.fill();
      ctx.strokeStyle = '#174375'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.55; ctx.lineJoin = 'miter';
      ctx.beginPath(); ctx.moveTo(0, 3); ctx.lineTo(5.2, 12); ctx.lineTo(-5.2, 12); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 15); ctx.lineTo(-5.2, 6); ctx.lineTo(5.2, 6); ctx.closePath(); ctx.stroke();
      ctx.restore();
    }
    function draw(snapshot) {
      if (!ctx) return;
      ctx.setTransform(2, 0, 0, 2, 0, 0);
      ctx.fillStyle = '#fbf8ed'; ctx.fillRect(0, 0, C.width, C.height);
      const gridY = ((-snapshot.cameraY) % 28 + 28) % 28;
      ctx.lineWidth = 0.65; ctx.strokeStyle = '#dce7e7'; ctx.beginPath();
      for (let x = 0; x <= C.width; x += 28) { ctx.moveTo(x, 0); ctx.lineTo(x, C.height); }
      for (let y = gridY; y <= C.height; y += 28) { ctx.moveTo(0, y); ctx.lineTo(C.width, y); }
      ctx.stroke(); ctx.strokeStyle = '#eac8bf'; ctx.beginPath(); ctx.moveTo(30, 0); ctx.lineTo(30, C.height); ctx.stroke();
      cloud(73, 104 + ((-snapshot.cameraY * 0.14) % 640), 0.85);
      cloud(348, 220 + ((-snapshot.cameraY * 0.1) % 640), 1.05);
      ctx.font = '10px monospace'; ctx.textAlign = 'right'; ctx.fillStyle = '#8aa5ad';
      for (let worldY = Math.floor(snapshot.cameraY / 100) * 100; worldY < snapshot.cameraY + C.height; worldY += 100) {
        const metres = Math.round((C.spawnY - worldY) / 10);
        if (metres >= 0) ctx.fillText(metres + ' м', 410, worldY - snapshot.cameraY - 6);
      }
      snapshot.platforms.forEach(platform => {
        const y = platform.y - snapshot.cameraY;
        if (y < -16 || y > C.height + 16) return;
        ctx.lineWidth = 2;
        const blue = platform.kind === 'blue';
        rounded(platform.x + 2, y + 4, platform.width, platform.height, 5, '#284b5d12');
        rounded(platform.x, y, platform.width, platform.height, 5, blue ? '#a6d9ea' : '#c2dda5', blue ? '#3688a6' : '#6c9a5b');
        ctx.strokeStyle = '#ffffffbd'; ctx.lineWidth = 1.4; ctx.beginPath();
        ctx.moveTo(platform.x + 7, y + 4); ctx.lineTo(platform.x + platform.width - 7, y + 4); ctx.stroke();
      });
      if (snapshot.state === 'ready') {
        ctx.save(); ctx.fillStyle = '#719589'; ctx.textAlign = 'center'; ctx.font = '12px sans-serif';
        ctx.fillText('↑ первая платформа', 210, 402); ctx.restore();
      }
      hero(snapshot.player, snapshot.cameraY);
      if (snapshot.player.x < 0) hero(snapshot.player, snapshot.cameraY, C.width);
      if (snapshot.player.x + snapshot.player.width > C.width) hero(snapshot.player, snapshot.cameraY, -C.width);
    }
    function sync() {
      const s = model.getState();
      root.dataset.state = windowElement.dataset.state = s.state;
      $('#jump-score').textContent = String(s.score); $('#jump-best').textContent = String(s.best);
      saveBest(s.best); draw(s);
      if (shownState === s.state) return;
      shownState = s.state;
      overlay.hidden = s.state === 'playing';
      pauseButton.disabled = s.state !== 'playing' && s.state !== 'paused';
      pauseButton.textContent = s.state === 'paused' ? '▶' : 'Ⅱ';
      pauseButton.setAttribute('aria-label', s.state === 'paused' ? 'Продолжить игру' : 'Приостановить игру');
      pauseButton.title = s.state === 'paused' ? 'Продолжить · Пробел' : 'Пауза · P';
      startButton.hidden = s.state === 'gameover'; restartButton.hidden = s.state !== 'gameover';
      if (s.state === 'paused') {
        $('#jump-message').textContent = 'Передышка на высоте';
        $('#jump-description').textContent = 'Всё на месте. Продолжим, когда будете готовы.';
        startButton.innerHTML = 'Продолжить <span>↑</span>';
      } else if (s.state === 'gameover') {
        $('#jump-message').textContent = 'Хороший полёт!';
        $('#jump-description').textContent = 'Высота: ' + s.score + ' м. Рекорд: ' + s.best + ' м. Ещё выше?';
        clearKeys();
        if (typeof onNotice === 'function') { try { onNotice('Bibi Jump · ' + s.score + ' м'); } catch (_) {} }
      }
    }
    function stopLoop() { if (raf) global.cancelAnimationFrame(raf); raf = 0; lastTime = 0; }
    function pause() {
      clearKeys(); stopLoop(); model.pause(); if (!destroyed) sync();
    }
    function frame(time) {
      raf = 0;
      if (!active()) { pause(); return; }
      const dt = lastTime ? (time - lastTime) / 1000 : 0;
      lastTime = time;
      // A throttled tab is a pause, never a several-second fall.
      if (dt > 1) { pause(); return; }
      model.step(dt, axis()); sync();
      if (model.getState().state === 'playing') raf = global.requestAnimationFrame(frame);
      else stopLoop();
    }
    function play() {
      if (!active()) return;
      const state = model.getState().state;
      if (state === 'playing') return;
      clearKeys(); if (state === 'paused') model.resume(); else model.start();
      sync(); canvas.focus({ preventScroll: true }); stopLoop(); raf = global.requestAnimationFrame(frame);
    }
    listen(startButton, 'click', play); listen(restartButton, 'click', play);
    listen($('#jump-new'), 'click', () => {
      if (!active()) return;
      clearKeys(); stopLoop(); model.start(); sync(); canvas.focus({preventScroll:true});
      raf = global.requestAnimationFrame(frame);
    });
    listen(pauseButton, 'click', () => model.getState().state === 'playing' ? pause() : play());
    const nativeInput = target => target && target.closest && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
    listen(global, 'keydown', event => {
      if (!active() || nativeInput(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
      const code = event.code;
      if (!['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'Space', 'KeyP'].includes(code)) return;
      if (code === 'Space' || code === 'KeyP') {
        event.preventDefault(); if (event.repeat) return;
        if (code === 'KeyP') { if (model.getState().state === 'playing') pause(); else if (model.getState().state === 'paused') play(); }
        else if (model.getState().state !== 'playing') play();
      } else if (model.getState().state === 'playing') { event.preventDefault(); keys.add(code); }
    });
    listen(global, 'keyup', event => keys.delete(event.code));
    [[-1, $('#jump-left')], [1, $('#jump-right')]].forEach(([direction, button]) => {
      listen(button, 'pointerdown', event => {
        if (!active() || model.getState().state !== 'playing') return;
        event.preventDefault(); pointers.set(event.pointerId, direction); button.classList.add('is-held');
        try { button.setPointerCapture(event.pointerId); } catch (_) {}
      });
      const release = event => { pointers.delete(event.pointerId); button.classList.remove('is-held'); };
      listen(button, 'pointerup', release); listen(button, 'pointercancel', release); listen(button, 'lostpointercapture', release);
      listen(button, 'contextmenu', event => event.preventDefault());
    });
    listen(global, 'blur', pause);
    listen(document, 'visibilitychange', () => { if (document.hidden) pause(); });
    const observer = new MutationObserver(() => { if (!active()) pause(); });
    observer.observe(windowElement, { attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'] });
    if (portrait) listen(portrait, 'load', () => { if (!destroyed) draw(model.getState()); });
    function destroy() {
      if (destroyed) return;
      pause(); destroyed = true; observer.disconnect(); cleanup.forEach(fn => fn());
      if (windowElement.jumpGame === controller) delete windowElement.jumpGame;
      if (windowElement.gameController === controller) delete windowElement.gameController;
      root.remove();
    }
    const controller = Object.freeze({ pause, destroy, getState: model.getState });
    windowElement.jumpGame = windowElement.gameController = controller;
    sync(); return controller;
  }
  global.createJumpGame = createJumpGame;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createJumpModel, createJumpGame, JUMP_CONSTANTS: C, BEST_KEY };
  }
}(typeof window !== 'undefined' ? window : globalThis));
