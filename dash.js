/* Havana Dash — original art, hand-charted rhythms, no third-party game assets. */
(function (global) {
  'use strict';
  const P = Object.freeze({ width: 720, height: 400, ground: 322, playerX: 132,
    size: 34, speed: 240, gravity: 1900, jumpSpeed: 640, step: 1 / 240, maxFrame: .25 });
  // Encounter beats mark the moment an obstacle reaches the cube's leading edge.
  // Every encounter has a .16s lead-in jump. The widest group is 64px: its complete
  // crossing (98/240=.4084s) fits inside the .6737s jump with >28px clearance.
  // Encounters are >=2 beats apart; the cube returns to the floor between groups.
  const charts = {
    hava: [[6,'s'],[10,'s'],[14,'b'],[18,'ss'],[22,'s'],[26,'b'],[30,'ss'],
      [34,'s'],[38,'b'],[42,'ss'],[46,'b'],[50,'ss'],[54,'s'],[58,'ss']],
    maoz: [[6,'ss'],[9,'b'],[12,'ss'],[15,'t'],[18,'s'],[20,'ss'],[23,'b'],
      [26,'ss'],[28,'s'],[31,'t'],[34,'ss'],[36,'b'],[39,'ss'],[42,'t'],
      [44,'s'],[47,'ss'],[50,'b'],[52,'ss'],[55,'t'],[58,'ss'],[60,'b'],
      [63,'ss'],[66,'t'],[68,'ss'],[71,'b'],[74,'ss']]
  };
  const DASH_LEVELS = Object.freeze([
    makeLevel('hava', 'Хава Нагила', 132, 64, 'Первый полёт', 'blue'),
    makeLevel('maoz', 'Маоз Цур', 120, 80, 'Точный ритм', 'amber')
  ]);
  function makeLevel(id, title, bpm, beats, subtitle, theme) {
    const beatSeconds = 60 / bpm;
    const obstacles = [];
    charts[id].forEach(([beat, kind], index) => {
      const x = P.playerX + P.size + beat * beatSeconds * P.speed;
      if (kind === 's' || kind === 'ss') {
        for (let j = 0; j < (kind === 'ss' ? 2 : 1); j++) {
          obstacles.push(Object.freeze({ id: index + '-' + j, type: 'spike',
            x: x + j * 32, y: P.ground - 32, width: 32, height: 32, beat }));
        }
      } else {
        const height = kind === 't' ? 60 : 42;
        obstacles.push(Object.freeze({ id: index + '-0', type: 'block', x,
          y: P.ground - height, width: kind === 't' ? 44 : 54, height, beat }));
      }
    });
    return Object.freeze({ id, title, bpm, beats, subtitle, theme,
      duration: beats * beatSeconds, length: beats * beatSeconds * P.speed,
      obstacles: Object.freeze(obstacles),
      jumps: Object.freeze(charts[id].map(([beat]) => beat * beatSeconds - .16)) });
  }
  const DASH_JUMP_GUIDES = Object.freeze(Object.fromEntries(DASH_LEVELS.map(l => [l.id, l.jumps])));
  const getLevel = id => DASH_LEVELS.find(l => l.id === id) || DASH_LEVELS[0];

  // Pure deterministic model. advance is bounded to .25s and subdivided to <=1/240s.
  // jump() is an edge, not a held input. Guides contain seconds from the audio start.
  // Snapshots are detached copies; neither level geometry nor model state is exposed.
  function createDashModel(options = {}) {
    let level = getLevel(typeof options === 'string' ? options : options.level);
    let state, elapsed, player, jumps;
    function reset(id = level.id) {
      level = getLevel(id); state = 'ready'; elapsed = 0; jumps = 0;
      player = { x: P.playerX, y: P.ground - P.size, width: P.size, height: P.size,
        vy: 0, grounded: true, angle: 0 };
      return getState();
    }
    function jump() {
      if (state !== 'playing' || !player.grounded) return false;
      player.vy = -P.jumpSpeed; player.grounded = false; jumps++;
      return true;
    }
    function spikeHit(o, distance) {
      // Triangle/AABB intersection, inset cube by 3px for a forgiving visible edge.
      const left = player.x + 3, right = player.x + player.width - 3;
      const top = player.y + 3, bottom = player.y + player.height - 3;
      const x = o.x - distance, overlapLeft = Math.max(left, x + 2);
      const overlapRight = Math.min(right, x + o.width - 2);
      if (overlapLeft >= overlapRight || top >= P.ground || bottom <= o.y + 2) return false;
      const nearest = Math.max(overlapLeft, Math.min(x + o.width / 2, overlapRight));
      const surface = P.ground - o.height * (1 - Math.abs(nearest - (x + o.width / 2)) / (o.width / 2));
      return bottom > surface + 2;
    }
    function step(dt) {
      const oldBottom = player.y + player.height;
      elapsed = Math.min(level.duration, elapsed + dt);
      const distance = elapsed * P.speed;
      if (!player.grounded) {
        player.y += player.vy * dt + .5 * P.gravity * dt * dt;
        player.vy += P.gravity * dt;
        player.angle += Math.PI * 3 * dt;
      }
      let support = false;
      for (const o of level.obstacles) {
        const x = o.x - distance;
        if (x > player.x + player.width + 2 || x + o.width < player.x - 2) continue;
        if (o.type === 'spike') {
          if (spikeHit(o, distance)) { state = 'dead'; return; }
          continue;
        }
        const horizontal = player.x + player.width > x + .5 && player.x < x + o.width - .5;
        if (!horizontal) continue;
        const bottom = player.y + player.height;
        if (player.vy >= 0 && oldBottom <= o.y + .6 && bottom >= o.y) {
          player.y = o.y - player.height; player.vy = 0; player.angle = 0;
          player.grounded = true; support = true;
        } else if (bottom > o.y + .6 && player.y < o.y + o.height &&
            player.x + player.width - 2 > x && player.x + 2 < x + o.width) {
          state = 'dead'; return;
        } else if (Math.abs(bottom - o.y) < .7 && player.grounded) support = true;
      }
      if (player.y + player.height >= P.ground) {
        player.y = P.ground - player.height; player.vy = 0;
        player.grounded = true; player.angle = 0;
      } else if (player.grounded && !support) player.grounded = false;
      if (elapsed >= level.duration - 1e-8) { elapsed = level.duration; state = 'won'; }
    }
    function advance(dt) {
      if (state !== 'playing' || !Number.isFinite(dt) || dt <= 0) return getState();
      let remaining = Math.min(P.maxFrame, dt);
      while (remaining > 1e-10 && state === 'playing') {
        const amount = Math.min(P.step, remaining);
        step(amount); remaining -= amount;
      }
      return getState();
    }
    function getState() {
      return { state, level: level.id, elapsed, progress: Math.min(100, elapsed / level.duration * 100),
        player: { ...player }, obstacles: level.obstacles.map(o => ({ ...o })),
        distance: elapsed * P.speed, length: level.length, duration: level.duration, jumps };
    }
    reset();
    return Object.freeze({ start() { if (state === 'ready') state = 'playing'; return getState(); },
      pause() { if (state === 'playing') state = 'paused'; return getState(); },
      resume() { if (state === 'paused') state = 'playing'; return getState(); }, reset, jump, advance,
      advanceTo(seconds) { return advance(seconds - elapsed); }, getState });
  }

  function createDashGame({ windowElement, portraitImage, onNotice = () => {}, onBeforePlay = () => {} } = {}) {
    if (!windowElement) throw new Error('Havana Dash needs a windowElement');
    const body = windowElement.querySelector('.window-body');
    if (!body) throw new Error('Havana Dash needs its own .window-body');
    if (windowElement.gameController && windowElement.gameController.destroy) windowElement.gameController.destroy();
    const doc = windowElement.ownerDocument;
    const win = doc.defaultView || global;
    const storageKey = 'havanagila.havana-dash.v1';
    let saved = {};
    try { saved = JSON.parse(win.localStorage.getItem(storageKey) || '{}') || {}; } catch (_) {}
    if (typeof saved !== 'object') saved = {};
    const best = { hava: Math.min(100, Math.max(0, Number(saved.best && saved.best.hava) || 0)),
      maoz: Math.min(100, Math.max(0, Number(saved.best && saved.best.maoz) || 0)) };
    let skin = saved.skin === 'bibi' ? 'bibi' : 'star';
    let volume = Number.isFinite(saved.volume) ? Math.min(1, Math.max(0, saved.volume)) : .5;
    let lastVolume = volume || .5;
    const model = createDashModel({ level: saved.level === 'maoz' ? 'maoz' : 'hava' });
    let destroyed = false, raf = 0, sound = null, silent = false, starting = false;
    let generation = 0, silentBase = 0, silentAt = 0, lastState = 'ready', particles = [];
    let portraitReady = !!(portraitImage && portraitImage.complete && portraitImage.naturalWidth);
    const held = new Set(), cleanup = [];
    let reduced = false;
    const motion = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
    reduced = !!(motion && motion.matches);
    body.innerHTML = '<section class="dash-shell" data-state="ready" data-theme="blue" aria-label="Havana Dash">' +
      '<header class="dash-toolbar"><div class="dash-brand"><span class="dash-brand-mark" aria-hidden="true">◇</span><div><strong>HAVANA <b>DASH</b></strong><small>Поймай ритм. Перепрыгни город.</small></div></div>' +
      '<label class="dash-level-label">Трек / уровень<select id="dash-level"><option value="hava">01 · Хава Нагила — легче</option><option value="maoz">02 · Маоз Цур — сложнее</option></select></label></header>' +
      '<div class="dash-settings"><div class="dash-skins" role="group" aria-label="Облик куба"><button type="button" data-dash-skin="star" aria-label="Белый куб со звездой Давида"><canvas width="48" height="48" aria-hidden="true"></canvas><span>Звезда</span></button>' +
      '<button type="button" data-dash-skin="bibi" aria-label="Биби в синей кипе"><canvas width="48" height="48" aria-hidden="true"></canvas><span>Биби</span></button></div>' +
      '<div class="dash-audio"><button id="dash-mute" type="button" aria-label="Выключить звук">Звук</button><input id="dash-volume" type="range" min="0" max="1" step="0.05" aria-label="Громкость музыки"></div>' +
      '<span class="dash-tempo">132 BPM · 64 такта</span></div>' +
      '<div class="dash-status"><span id="dash-progress" role="progressbar" aria-label="Прогресс уровня" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i><b>0%</b></span><span id="dash-best">Рекорд 0%</span></div>' +
      '<div class="dash-stage"><canvas id="dash-canvas" width="720" height="400" tabindex="0" aria-label="Havana Dash: пробел, стрелка вверх, W или касание — прыжок. Escape — пауза."></canvas>' +
      '<div id="dash-overlay" role="status" aria-live="polite"><span class="dash-overlay-kicker">ОДНА КНОПКА · ЦЕЛЫЙ РИТМ</span><h2>Havana Dash</h2><p>Куб бежит сам. Перепрыгивай шипы и блоки.</p><small>Нажми «Играть», когда будешь готов.</small></div></div>' +
      '<footer class="dash-footer"><div class="dash-actions"><button id="dash-start" type="button">▶ Играть</button><button id="dash-pause" type="button" disabled>Пауза</button><button id="dash-restart" type="button">↺ Заново</button><button id="dash-jump" type="button" disabled>↑ Прыжок</button></div>' +
      '<div class="dash-footnote"><span>ПРОБЕЛ / ↑ / W / касание</span><span class="dash-audio-state" role="status">Музыка начнётся только по кнопке</span></div></footer></section>';
    const $ = selector => body.querySelector(selector);
    const shell = $('.dash-shell'), canvas = $('#dash-canvas'), ctx = canvas.getContext('2d');
    const overlay = $('#dash-overlay'), startButton = $('#dash-start'), pauseButton = $('#dash-pause');
    const levelSelect = $('#dash-level'), volumeInput = $('#dash-volume'), muteButton = $('#dash-mute');
    const jumpButton = $('#dash-jump'), progressNode = $('#dash-progress'), bestNode = $('#dash-best');
    const audioLabel = $('.dash-audio-state');
    levelSelect.value = model.getState().level; volumeInput.value = String(volume);
    function listen(target, event, handler, options) {
      target.addEventListener(event, handler, options);
      cleanup.push(() => target.removeEventListener(event, handler, options));
    }
    function save() {
      try { win.localStorage.setItem(storageKey, JSON.stringify({ best, skin, volume, level: model.getState().level })); } catch (_) {}
    }
    function notice(text) { audioLabel.textContent = text; try { onNotice(text); } catch (_) {} }
    function visible() {
      return !destroyed && windowElement.isConnected && !windowElement.hidden && !doc.hidden &&
        win.getComputedStyle(windowElement).display !== 'none' && win.getComputedStyle(windowElement).visibility !== 'hidden';
    }
    function active() { return visible() && windowElement.classList.contains('focused') && (!doc.hasFocus || doc.hasFocus()); }
    function stopFrame() { if (raf) win.cancelAnimationFrame(raf); raf = 0; }
    function clearInput() { held.clear(); }
    function soundtrackStop(reset) {
      if (!sound) return;
      try { reset ? sound.stop() : sound.pause(); } catch (_) {}
    }
    function remember(s) {
      if (s.progress > best[s.level]) { best[s.level] = s.progress; save(); }
    }
    function pausedTimeline() {
      const s = model.getState();
      if (s.state !== 'playing') return;
      const target = silent ? silentBase + (win.performance.now() - silentAt) / 1000 : sound ? sound.getPosition() : s.elapsed;
      if (Number.isFinite(target) && target >= s.elapsed && target - s.elapsed <= P.maxFrame) model.advanceTo(target);
    }
    function pause() {
      if (destroyed) return;
      ++generation; clearInput();
      // Freeze the audio clock first, then advance to that exact frozen sample.
      soundtrackStop(false);
      try { pausedTimeline(); } catch (_) {}
      starting = false; model.pause(); stopFrame();
      const s = model.getState();
      if (s.state === 'dead' || s.state === 'won') finish(s);
      remember(s); update(s); draw(s);
    }
    async function play() {
      if (destroyed || starting || !active()) return;
      let s = model.getState();
      if (s.state === 'playing') return;
      if (s.state === 'dead' || s.state === 'won') { model.reset(s.level); particles = []; s = model.getState(); }
      const token = ++generation;
      starting = true; update(s); audioLabel.textContent = 'Подключаем ритм…';
      let played = false;
      try {
        if (!sound && typeof global.createDashSound === 'function') sound = global.createDashSound({ onState: () => {} });
        if (sound) {
          sound.setVolume(volume);
          // The parent can stop calculator music at the exact explicit-play boundary.
          onBeforePlay();
          played = !!(await sound.play(s.level, s.elapsed));
        }
      } catch (_) { played = false; }
      if (destroyed || token !== generation || !active()) {
        if (token === generation) pause();
        else if (!starting && model.getState().state !== 'playing') soundtrackStop(false);
        return;
      }
      starting = false; silent = !played;
      if (silent) { soundtrackStop(true); notice('Без звука: музыка недоступна. Ритм и игра работают.'); }
      else audioLabel.textContent = 'Музыка синхронизирована с уровнем';
      silentBase = s.elapsed; silentAt = win.performance.now();
      if (s.state === 'paused') model.resume(); else model.start();
      clearInput(); canvas.focus({ preventScroll: true }); update(model.getState());
      stopFrame(); raf = win.requestAnimationFrame(frame);
    }
    function reset(level = model.getState().level) {
      ++generation; starting = false; soundtrackStop(true); stopFrame(); clearInput();
      remember(model.getState()); model.reset(level); particles = []; lastState = 'ready';
      levelSelect.value = level; audioLabel.textContent = 'Музыка начнётся только по кнопке';
      save(); update(model.getState()); draw(model.getState());
    }
    function finish(s) {
      ++generation; starting = false; soundtrackStop(true); clearInput(); remember(s);
      if (s.state === 'dead') {
        particles = Array.from({ length: reduced ? 0 : 9 }, (_, i) => ({
          x: s.player.x + P.size / 2 + Math.cos(i * 2.4) * (18 + i * 3),
          y: s.player.y + P.size / 2 + Math.sin(i * 2.4) * (18 + i * 3), size: 3 + i % 3 }));
      }
      audioLabel.textContent = s.state === 'won' ? 'Финиш! Музыка остановлена.' : 'Ещё попытка? Музыка остановлена.';
    }
    function frame() {
      raf = 0;
      if (!active()) { pause(); return; }
      let s = model.getState();
      if (s.state !== 'playing') return;
      let position;
      try {
        const audioState = sound && !silent ? sound.getState() : null;
        if (audioState && audioState.contextState && audioState.contextState !== 'running' && audioState.contextState !== 'unavailable') {
          pause(); notice('Звук приостановлен. Нажми «Продолжить».'); return;
        }
        position = silent ? silentBase + (win.performance.now() - silentAt) / 1000 : sound.getPosition();
      } catch (_) { pause(); notice('Потерян аудиоритм. Нажми «Продолжить».'); return; }
      const delta = position - s.elapsed;
      if (!Number.isFinite(position) || delta > P.maxFrame + .001 || delta < -.05) {
        pause(); notice('Пауза: окно потеряло ритм. Продолжи с того же места.'); return;
      }
      s = model.advanceTo(position);
      if (s.state === 'dead' || s.state === 'won') finish(s);
      update(s); draw(s);
      if (s.state === 'playing') raf = win.requestAnimationFrame(frame);
    }
    function update(s) {
      const level = getLevel(s.level), percent = Math.floor(s.progress);

      // Костыль
      const isEvening = localStorage.getItem('havanagila-evening') === 'true';
      shell.dataset.theme = isEvening ? 'evening' : (level.theme || 'default');

      shell.dataset.starting = String(starting); shell.setAttribute('aria-busy', String(starting));
      progressNode.setAttribute('aria-valuenow', String(percent));
      progressNode.querySelector('i').style.width = s.progress + '%';
      progressNode.querySelector('b').textContent = percent + '%';
      bestNode.textContent = 'Рекорд ' + Math.floor(Math.max(best[s.level], s.progress)) + '%';
      $('.dash-tempo').textContent = level.bpm + ' BPM · ' + level.beats + ' долей';
      startButton.disabled = s.state === 'playing' || starting;
      startButton.textContent = starting ? 'Подождите…' : s.state === 'paused' ? '▶ Продолжить' : s.state === 'dead' || s.state === 'won' ? '▶ Ещё раз' : '▶ Играть';
      pauseButton.disabled = s.state !== 'playing' && !starting;
      jumpButton.disabled = s.state !== 'playing';
      overlay.hidden = s.state === 'playing';
      if (lastState !== s.state || !overlay.dataset.initialized) {
        const content = {
          ready: ['ОДНА КНОПКА · ЦЕЛЫЙ РИТМ', 'Havana Dash', 'Куб бежит сам. Перепрыгивай шипы и блоки.', 'Нажми «Играть», когда будешь готов.'],
          paused: ['РИТМ НА ПАУЗЕ', 'Не спеши', 'Твой прогресс на месте. Музыка тоже ждёт.', 'Нажми «Продолжить».'],
          dead: ['ПОПЫТКА ЗА ПОПЫТКОЙ', 'Ещё один прыжок!', percent + '% уровня · присмотрись к следующему препятствию.', 'Нажми «Ещё раз». Ты уже знаешь дорогу.'],
          won: ['100% · ЧИСТЫЙ РИТМ', 'Отличный пробег!', level.title + ' — уровень пройден.', s.level === 'hava' ? 'Попробуй «Маоз Цур»: препятствия плотнее.' : 'Оба ритма тебе по плечу. Повторим?']
        }[s.state];
        if (content) {
          overlay.querySelector('span').textContent = content[0]; overlay.querySelector('h2').textContent = content[1];
          overlay.querySelector('p').textContent = content[2]; overlay.querySelector('small').textContent = content[3];
        }
        overlay.dataset.initialized = 'true';
      }
      lastState = s.state;
    }
    function star(c, x, y, radius, color, lineWidth) {
      c.strokeStyle = color; c.lineWidth = lineWidth; c.lineJoin = 'round';
      for (let turn = 0; turn < 2; turn++) {
        c.beginPath();
        for (let i = 0; i < 3; i++) {
          const a = -Math.PI / 2 + turn * Math.PI + i * Math.PI * 2 / 3;
          const px = x + Math.cos(a) * radius, py = y + Math.sin(a) * radius;
          i ? c.lineTo(px, py) : c.moveTo(px, py);
        }
        c.closePath(); c.stroke();
      }
    }
    function skinArt(c, x, y, size, angle, type = skin) {
      c.save(); c.translate(x + size / 2, y + size / 2); c.rotate(angle || 0);
      c.fillStyle = '#fff'; c.fillRect(-size / 2, -size / 2, size, size);
      c.save(); c.beginPath(); c.rect(-size / 2 + 1, -size / 2 + 1, size - 2, size - 2); c.clip();
      if (type === 'star') star(c, 0, 0, size * .34, '#145be1', Math.max(1.5, size * .053));
      else {
        if (portraitReady) {
          try { c.drawImage(portraitImage, 138, 40, 212, 275, -size / 2, -size / 2, size, size); } catch (_) {}
        } else {
          c.fillStyle = '#ead1bb'; c.fillRect(-size / 2, -size / 2, size, size);
          c.fillStyle = '#e5e8ef'; c.fillRect(-size / 2, -size / 2, size, size * .23);
          c.fillStyle = '#314569'; c.fillRect(-size * .24, -size * .04, size * .14, size * .05);
          c.fillRect(size * .1, -size * .04, size * .14, size * .05);
          c.fillRect(-size * .17, size * .25, size * .34, size * .035);
        }
        c.fillStyle = '#145be1'; c.beginPath(); c.moveTo(-size * .40, -size * .29);
        c.quadraticCurveTo(-size * .34, -size * .53, 0, -size * .52);
        c.quadraticCurveTo(size * .34, -size * .53, size * .40, -size * .29);
        c.quadraticCurveTo(0, -size * .20, -size * .40, -size * .29); c.fill();
        star(c, 0, -size * .365, size * .104, '#fff', Math.max(.9, size * .028));
      }
      c.restore(); c.strokeStyle = '#d5e8ff'; c.lineWidth = 2; c.strokeRect(-size / 2, -size / 2, size, size); c.restore();
    }
    function previews() {
      body.querySelectorAll('[data-dash-skin]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.dashSkin === skin));
        const small = button.querySelector('canvas'), c = small.getContext('2d');
        c.clearRect(0, 0, 48, 48); skinArt(c, 5, 5, 38, 0, button.dataset.dashSkin);
      });
      draw(model.getState());
    }
    function draw(s) {
      if (!ctx) return;
      const amber = s.level === 'maoz', accent = amber ? '#ffc66d' : '#72dfff';
      const secondary = amber ? '#bb7236' : '#3777bd';
      const backdrop = ctx.createLinearGradient(0, 0, 0, 400);
      backdrop.addColorStop(0, amber ? '#201a30' : '#0b1d43'); backdrop.addColorStop(1, '#080e20');
      ctx.fillStyle = backdrop; ctx.fillRect(0, 0, 720, 400);
      const shift = reduced ? 0 : s.distance * .16;
      ctx.strokeStyle = amber ? '#342942' : '#172f52'; ctx.lineWidth = 1;
      for (let x = -(shift % 48); x < 720; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, P.ground); ctx.stroke(); }
      for (let y = 34; y < P.ground; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(720, y); ctx.stroke(); }
      // A quiet, abstract skyline; no flashing, shake, or animated full-screen effects.
      ctx.fillStyle = amber ? '#392740' : '#142d4f';
      for (let i = -1; i < 13; i++) {
        const x = i * 76 - (shift * .55 % 76), height = 36 + ((i + 14) * 37 % 87);
        ctx.fillRect(x, P.ground - height, 55, height);
        ctx.strokeStyle = secondary; ctx.globalAlpha = .25; ctx.strokeRect(x + 8, P.ground - height + 9, 39, height - 9); ctx.globalAlpha = 1;
      }
      ctx.fillStyle = accent; ctx.font = '600 12px Arial'; ctx.textAlign = 'left';
      ctx.fillText(getLevel(s.level).title.toUpperCase(), 25, 28);
      ctx.fillStyle = '#a2b5cd'; ctx.font = '11px Arial'; ctx.textAlign = 'right';
      ctx.fillText('01 КНОПКА / ' + getLevel(s.level).beats + ' ДОЛЕЙ', 695, 28);
      // Beat ticks are spatial landmarks, not strobe lights.
      const beatDistance = P.speed * 60 / getLevel(s.level).bpm;
      ctx.strokeStyle = secondary;
      for (let n = Math.floor(s.distance / beatDistance); n < s.distance / beatDistance + 8; n++) {
        const x = P.playerX + P.size + n * beatDistance - s.distance;
        ctx.beginPath(); ctx.moveTo(x, P.ground + 12); ctx.lineTo(x, P.ground + (n % 4 ? 19 : 26)); ctx.stroke();
      }
      ctx.fillStyle = '#080f20'; ctx.fillRect(0, P.ground, 720, 78);
      ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, P.ground); ctx.lineTo(720, P.ground); ctx.stroke();
      for (let n = Math.floor(s.distance / beatDistance); n < s.distance / beatDistance + 8; n++) {
        const x = P.playerX + P.size + n * beatDistance - s.distance;
        ctx.fillStyle = secondary; ctx.fillRect(x, P.ground + 14, 2, n % 4 ? 6 : 14);
        if (n % 4 === 0 && n >= 0) { ctx.font = '10px Arial'; ctx.textAlign = 'center'; ctx.fillText(String(n), x, P.ground + 45); }
      }
      for (const o of s.obstacles) {
        const x = o.x - s.distance;
        if (x + o.width < -10 || x > 730) continue;
        ctx.lineWidth = 2; ctx.strokeStyle = accent;
        if (o.type === 'spike') {
          ctx.fillStyle = amber ? '#804836' : '#245f85'; ctx.beginPath();
          ctx.moveTo(x, P.ground); ctx.lineTo(x + o.width / 2, o.y); ctx.lineTo(x + o.width, P.ground); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.strokeStyle = '#f3f7ff'; ctx.beginPath(); ctx.moveTo(x + 10, P.ground - 8); ctx.lineTo(x + o.width / 2, o.y + 9); ctx.stroke();
        } else {
          ctx.fillStyle = amber ? '#634737' : '#23486f'; ctx.fillRect(x, o.y, o.width, o.height); ctx.strokeRect(x, o.y, o.width, o.height);
          ctx.strokeStyle = secondary; ctx.strokeRect(x + 7, o.y + 7, o.width - 14, o.height - 14);
          ctx.fillStyle = accent; ctx.fillRect(x + 5, o.y + 4, o.width - 10, 3);
        }
      }
      const finishX = P.playerX + s.length - s.distance;
      if (finishX < 730) {
        ctx.strokeStyle = accent; ctx.beginPath(); ctx.moveTo(finishX, 105); ctx.lineTo(finishX, P.ground); ctx.stroke();
        ctx.fillStyle = accent; ctx.font = 'bold 13px Arial'; ctx.textAlign = 'center'; ctx.fillText('ФИНИШ', finishX, 90);
        for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? '#fff' : secondary; ctx.fillRect(finishX + (i % 2) * 10, 107 + i * 10, 10, 10); }
      }
      if (s.state !== 'dead') {
        ctx.fillStyle = '#0005'; ctx.beginPath(); ctx.ellipse(s.player.x + P.size / 2, P.ground + 5, 23, 4, 0, 0, Math.PI * 2); ctx.fill();
        skinArt(ctx, s.player.x, s.player.y, P.size, s.player.angle);
      } else {
        ctx.fillStyle = accent; particles.forEach(p => ctx.fillRect(p.x, p.y, p.size, p.size));
      }
      if (s.state === 'ready') {
        ctx.textAlign = 'left'; ctx.fillStyle = '#92accb'; ctx.font = '12px Arial'; ctx.fillText('ПЕРВЫЙ ПРЫЖОК — ПОСЛЕ ВСТУПЛЕНИЯ', 24, 382);
      }
    }
    function syncJump() {
      if (!active() || model.getState().state !== 'playing') return;
      try { pausedTimeline(); } catch (_) {}
      const s = model.getState();
      if (s.state === 'dead' || s.state === 'won') { finish(s); stopFrame(); update(s); draw(s); return; }
      model.jump(); draw(model.getState());
    }
    function volumeChanged(value) {
      volume = Math.min(1, Math.max(0, Number(value) || 0)); if (volume) lastVolume = volume;
      if (sound) sound.setVolume(volume);
      volumeInput.value = String(volume); muteButton.textContent = volume ? 'Звук' : 'Тихо';
      muteButton.setAttribute('aria-label', volume ? 'Выключить звук' : 'Включить звук');
      muteButton.setAttribute('aria-pressed', String(volume === 0)); save();
    }
    listen(startButton, 'click', play); listen(pauseButton, 'click', pause);
    listen($('#dash-restart'), 'click', () => reset());
    listen(levelSelect, 'change', () => reset(levelSelect.value));
    listen(volumeInput, 'input', () => volumeChanged(volumeInput.value));
    listen(muteButton, 'click', () => volumeChanged(volume ? 0 : lastVolume));
    body.querySelectorAll('[data-dash-skin]').forEach(button => listen(button, 'click', () => {
      skin = button.dataset.dashSkin; save(); previews();
    }));
    listen(canvas, 'pointerdown', event => {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault(); canvas.focus({ preventScroll: true }); syncJump();
    });
    listen(jumpButton, 'pointerdown', event => {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault(); canvas.focus({ preventScroll: true }); syncJump();
    });
    // Keyboard-activated native jump button retains native semantics, without a double pointer jump.
    listen(jumpButton, 'click', event => { if (event.detail === 0) syncJump(); });
    listen(doc, 'keydown', event => {
      if (!active() || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
      const target = event.target;
      if (target && target.closest && target.closest('input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"]),[role="textbox"]')) return;
      if (event.code === 'Escape') { event.preventDefault(); pause(); return; }
      if (event.code === 'KeyP') {
        event.preventDefault();
        if (!event.repeat) { if (model.getState().state === 'paused') play(); else pause(); }
        return;
      }
      if (!['Space', 'ArrowUp', 'KeyW'].includes(event.code)) return;
      if (model.getState().state !== 'playing') return;
      event.preventDefault(); if (event.repeat || held.has(event.code)) return;
      held.add(event.code); syncJump();
    });
    listen(doc, 'keyup', event => held.delete(event.code));
    listen(win, 'blur', pause);
    listen(doc, 'visibilitychange', () => { if (doc.hidden) pause(); });
    listen(doc, 'pointerdown', event => { if (!windowElement.contains(event.target)) pause(); }, true);
    listen(doc, 'focusin', event => { if (!windowElement.contains(event.target)) pause(); });
    listen(windowElement, 'focusout', () => {
      Promise.resolve().then(() => { if (!destroyed && !windowElement.contains(doc.activeElement)) pause(); });
    });
    const observer = new win.MutationObserver(() => { if (!active()) pause(); });
    observer.observe(windowElement, { attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
    // A removed desktop window must also stop its audio and animation.
    const removalObserver = new win.MutationObserver(() => { if (!windowElement.isConnected) pause(); });
    removalObserver.observe(doc.documentElement, { childList: true, subtree: true });
    if (portraitImage) listen(portraitImage, 'load', () => {
      portraitReady = !!portraitImage.naturalWidth; previews();
    });
    if (motion) {
      const changed = event => { reduced = event.matches; draw(model.getState()); };
      if (motion.addEventListener) listen(motion, 'change', changed);
    }
    volumeChanged(volume); previews(); update(model.getState());
    const controller = Object.freeze({ pause,
      getState() {
        let audio = null;
        try { if (sound) audio = { ...sound.getState() }; } catch (_) {}
        return { ...model.getState(), skin, best: { ...best }, volume, silent, starting, audio };
      },
      destroy() {
        if (destroyed) return;
        pause(); destroyed = true; ++generation; stopFrame(); observer.disconnect(); removalObserver.disconnect();
        cleanup.splice(0).forEach(fn => fn());
        if (sound) { try { sound.destroy(); } catch (_) {} }
        if (windowElement.gameController === controller) delete windowElement.gameController;
        shell.remove();
      }
    });
    windowElement.gameController = controller;
    return controller;
  }
  const api = { createDashGame, createDashModel, DASH_LEVELS, DASH_PHYSICS: P, DASH_JUMP_GUIDES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global && global.document) Object.assign(global, api);
})(typeof window !== 'undefined' ? window : globalThis);
