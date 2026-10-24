/* Dash audio: traditional tunes, newly synthesized accompaniment; entirely offline.
 * Hava Nagila: compact A+B+C transcription copied from sibling music.js (read-only).
 * Original notation: https://abcnotation.com/tunePage?a=www.tousauxbalkans.net/abc/Havah%20nagilah/0000
 * https://www.tousauxbalkans.net/Havah_nagilah
 * Maoz Tzur: traditional Ashkenazi melody, top voice of this ABC score:
 * https://abcnotation.com/tunePage?a=trillian.mit.edu/~jc/music/abc/hymn/Maoz_Tsur_Ew/0000
 * Authoring reference only: X:1, T:Maoz Tsur, M:C, L:1/8, K:E.
 * ABC chords were reduced to their upper melodic voice; accompaniment below is new.
 * Both loops are 16 bars / 64 quarter-note beats. MIDI numbers below are concert pitch.
 * Hava uses E Freygish (G means G#); Maoz uses E major (F/G/C/D mean sharps).
 * No samples, external recordings, imports, fetches, or calculator-player dependencies.
 *
 * Public API: window.DASH_TRACKS; window.createDashSound({ onState? }).
 * play(id, seconds=0) -> Promise<boolean>; pause(); stop(); getPosition(); getState();
 * setVolume(0..1); destroy(). No AudioContext exists until an explicit play() call.
 * Position is unbounded musical seconds, NOT modulo loop length. A short startup lead
 * holds the requested offset until the audio clock reaches it. Resume reconstructs
 * active notes at the requested phase, including envelopes and percussion pitch.
 * Oscillator carrier phase is restarted (not a sample-exact recording seek).
 */
(function (root) {
  'use strict';

  const TRACKS = Object.freeze([
    Object.freeze({ id: 'hava', title: 'Хава Нагила', bpm: 132 }),
    Object.freeze({ id: 'maoz', title: 'Маоз Цур', bpm: 120 })
  ]);
  const HAVA_PITCH = { D: 62, E: 64, F: 65, G: 68, A: 69, B: 71, c: 72, d: 74, e: 76 };
  const MAOZ_PITCH = { B: 59, D: 63, E: 64, F: 66, G: 68, A: 69, b: 71, c: 73, d: 75, e: 76 };
  // Every [harmony, melody] entry spans exactly four quarter notes.
  const HAVA = [
    ['E', 'E:1 E:1.5 G:.5 F:.5 E:.5'],
    ['E', 'G:1 G:1.5 B:.5 A:.5 G:.5'],
    ['Am', 'A:1 A:1.5 c:.5 B:.5 A:.5'],
    ['E', 'G:1 F:.25 E:.25 F:.5 E:2'],
    ['E', 'G:.5 G:1 F:.5 E:.5 E:.5 E:1'],
    ['Dm', 'F:.5 F:1 E:.5 D:.5 D:.5 D:1'],
    ['Dm', 'D:1 F:.75 E:.25 D:.5 D:.5 A:1'],
    ['E', 'G:1 F:.25 E:.25 F:.5 E:2'],
    ['Am', 'A:2 A:2'],
    ['Am', 'A:1 A:1 A:1 A:1'],
    ['Am', 'A:.5 A:.5 c:.75 B:.25 A:.5 c:.5 B:.5 A:.5'],
    ['Am', 'A:.5 A:.5 c:.75 B:.25 A:.5 c:.5 B:.5 A:.5'],
    ['E', 'B:.5 B:.5 d:.75 c:.25 B:.5 d:.5 c:.5 B:.5'],
    ['E', 'B:.5 B:.5 d:.75 c:.25 B:.5 d:.5 c:.5 B:.5'],
    ['E', 'B:.5 B:.5 e:1 B:.5 B:.5 E:1'],
    ['Am', 'E:.5 E:.5 c:.25 B:.25 A:.25 G:.25 A:2']
  ];
  // Lowercase b is B4 (71); uppercase B is the score's B, / B3 (59).
  // z is the source's rest; dots and half-beat runs follow its ABC rhythm.
  const MAOZ = [
    ['E', 'E:1 B:1 E:1 A:1'], ['E', 'G:1 F:1 E:1 z:1'],
    ['A', 'b:1 c:1 F:1 A:1'], ['E', 'G:1 F:1 E:1 z:1'],
    ['E', 'E:1 B:1 E:1 A:1'], ['E', 'G:1 F:1 E:1 z:1'],
    ['Fs', 'b:1 c:1 F:1 A:1'], ['E', 'G:1 F:1 E:1 z:1'],
    ['E', 'b:1.5 b:.5 c:1 d:1'], ['E', 'e:2 b:1 z:1'],
    ['A', 'e:1 d:1 c:1 b:1'], ['B', 'b:.5 A:.5 G:.5 A:.5 F:1 z:1'],
    ['E', 'G:1.5 A:.5 b:2'], ['Fs', 'F:1.5 G:.5 A:1.5 A:.5'],
    ['A', 'G:1 D:1 E:1 A:1'], ['E', 'G:1 F:1 E:2']
  ];
  const HARMONY = {
    E: [40, 47, 56, 59, 64], Am: [45, 52, 57, 60, 64],
    Dm: [38, 45, 57, 62, 65], A: [45, 52, 57, 61, 64],
    B: [47, 54, 59, 63, 66], Fs: [42, 49, 57, 61, 66]
  };
  const LEAD = 0.035;
  const HORIZON = 0.16;
  const frequency = midi => 440 * Math.pow(2, (midi - 69) / 12);

  function arrange(bars, pitches, bpm) {
    const spb = 60 / bpm;
    const events = [];
    const add = (beat, beats, kind, midi, level) => {
      events.push({ start: beat * spb, duration: beats * spb, kind, midi, level });
    };
    bars.forEach(([chord, phrase], bar) => {
      let beat = bar * 4;
      phrase.split(' ').forEach(token => {
        const [pitch, length] = token.split(':');
        const beats = Number(length);
        if (pitch !== 'z') add(beat, beats * 0.94, 'melody', pitches[pitch], 0.20);
        beat += beats;
      });
      const notes = HARMONY[chord];
      for (let step = 0; step < 4; step++) {
        add(bar * 4 + step, 0.72, 'bass', notes[step % 2], 0.17);
        add(bar * 4 + step, 0.34, 'kick', 0, step % 2 ? 0.13 : 0.22);
        // Light offbeat chord plucks: original accompaniment, not a sampled arrangement.
        if (step % 2) notes.slice(2).forEach(midi => add(bar * 4 + step + 0.5, 0.36, 'chord', midi, 0.035));
        add(bar * 4 + step, 0.09, 'hat', 0, 0.033);
        add(bar * 4 + step + 0.5, 0.12, 'hat', 0, 0.047);
      }
    });
    events.sort((a, b) => a.start - b.start);
    return { events, length: bars.length * 4 * spb };
  }
  const SCORES = {
    hava: arrange(HAVA, HAVA_PITCH, 132),
    maoz: arrange(MAOZ, MAOZ_PITCH, 120)
  };

  function createDashSound(options = {}) {
    const onState = options && typeof options.onState === 'function' ? options.onState : null;
    let context = null;
    let master = null;
    let compressor = null;
    let noise = null;
    let playing = false;
    let trackId = null;
    let position = 0;
    let origin = 0;
    let volume = 0.28;
    let error = null;
    let destroyed = false;
    let generation = 0;
    let timer = null;
    const voices = new Set();
    const scheduled = new Map();

    function getPosition() {
      return playing && context ? Math.max(position, context.currentTime - origin) : position;
    }
    function getState() {
      const track = TRACKS.find(item => item.id === trackId);
      return {
        playing: playing && !!context && context.state === 'running',
        trackId, position: getPosition(), bpm: track ? track.bpm : 0, volume,
        contextState: context ? context.state : 'uninitialized', error
      };
    }
    function notify() {
      if (onState) { try { onState(getState()); } catch (_) { /* UI callbacks cannot break audio. */ } }
    }
    function clearVoices() {
      if (timer !== null) { root.clearInterval(timer); timer = null; }
      for (const voice of voices) {
        voice.source.onended = null;
        try { voice.gain.gain.cancelScheduledValues(context.currentTime); voice.gain.gain.setValueAtTime(0, context.currentTime); } catch (_) {}
        try { voice.source.stop(); } catch (_) {}
        try { voice.source.disconnect(); voice.gain.disconnect(); if (voice.filter) voice.filter.disconnect(); } catch (_) {}
      }
      voices.clear();
      scheduled.clear();
    }
    function freeze() {
      position = getPosition();
      playing = false;
      clearVoices();
    }
    function fail(problem) {
      freeze();
      error = problem && problem.message ? problem.message : String(problem || 'Audio unavailable');
      notify();
      return false;
    }
    function initialize() {
      if (context) return;
      const Constructor = root.AudioContext || root.webkitAudioContext;
      if (!Constructor) throw new Error('Web Audio is not supported by this browser.');
      context = new Constructor({ latencyHint: 'interactive' });
      try {
        master = context.createGain();
        master.gain.value = volume;
        compressor = context.createDynamicsCompressor();
        compressor.threshold.value = -14;
        compressor.knee.value = 15;
        compressor.ratio.value = 5;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.12;
        master.connect(compressor);
        compressor.connect(context.destination);
        noise = context.createBuffer(1, Math.ceil(context.sampleRate * 0.15), context.sampleRate);
        const data = noise.getChannelData(0);
        let seed = 0x2468ace;
        for (let i = 0; i < data.length; i++) {
          seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
          data[i] = (seed >>> 0) / 2147483648 - 1;
        }
        context.onstatechange = () => {
          if (destroyed) return;
          if (context.state === 'closed' && playing) fail(new Error('Audio context was closed.'));
          else notify();
        };
      } catch (problem) {
        const broken = context;
        context = null;
        try { Promise.resolve(broken.close()).catch(() => {}); } catch (_) {}
        throw problem;
      }
    }
    // Piecewise-linear envelope; seeking evaluates it at the elapsed note time.
    function envelope(event) {
      const attack = Math.min(0.009, event.duration * 0.12);
      if (event.kind === 'hat' || event.kind === 'kick') {
        return [[0, 0], [attack, event.level], [event.duration * 0.35, event.level * 0.28], [event.duration, 0]];
      }
      const release = Math.min(0.06, event.duration * 0.25);
      return [[0, 0], [attack, event.level], [event.duration - release, event.level * 0.74], [event.duration, 0]];
    }
    function voiceAt(event, absoluteStart, now) {
      const when = Math.max(context.currentTime, origin + Math.max(absoluteStart, now));
      const elapsed = Math.max(0, when - (origin + absoluteStart));
      const remaining = event.duration - elapsed;
      if (remaining <= 0.001) return;
      const source = event.kind === 'hat' ? context.createBufferSource() : context.createOscillator();
      const gain = context.createGain();
      const voice = { source, gain, filter: null };
      voices.add(voice); // Register before setup so any partial failure can be silenced.
      if (event.kind === 'hat') {
        source.buffer = noise;
        voice.filter = context.createBiquadFilter();
        voice.filter.type = 'highpass';
        voice.filter.frequency.value = 6500;
        source.connect(voice.filter);
        voice.filter.connect(gain);
      } else {
        source.type = event.kind === 'melody' ? 'triangle' : 'sine';
        if (event.kind === 'kick') {
          const endFrequency = 48 + 112 * Math.exp(-event.duration * 32);
          const initial = 160 * Math.pow(endFrequency / 160, elapsed / event.duration);
          source.frequency.setValueAtTime(initial, when);
          source.frequency.exponentialRampToValueAtTime(endFrequency, when + remaining);
        } else source.frequency.setValueAtTime(frequency(event.midi), when);
        source.connect(gain);
      }
      gain.connect(master);
      const points = envelope(event);
      let amplitude = 0;
      for (let i = 1; i < points.length; i++) {
        if (elapsed <= points[i][0]) {
          const [a, b] = [points[i - 1], points[i]];
          amplitude = a[1] + (b[1] - a[1]) * (elapsed - a[0]) / (b[0] - a[0]);
          break;
        }
      }
      // Tiny de-click ramp only on mid-note seeks; rhythm and end time stay unchanged.
      gain.gain.setValueAtTime(elapsed > 0.002 ? 0 : amplitude, when);
      const fade = elapsed > 0.002 ? Math.min(0.004, remaining * 0.2) : 0;
      if (fade) gain.gain.linearRampToValueAtTime(amplitude, when + fade);
      for (const [at, level] of points) {
        if (at > elapsed + fade) gain.gain.linearRampToValueAtTime(level, when + at - elapsed);
      }
      source.onended = () => {
        voices.delete(voice);
        try { source.disconnect(); gain.disconnect(); if (voice.filter) voice.filter.disconnect(); } catch (_) {}
      };
      if (event.kind === 'hat') source.start(when, elapsed);
      else source.start(when);
      source.stop(when + remaining);
    }
    function pump(token) {
      if (!playing || token !== generation || !context || context.state !== 'running') return;
      try {
        const score = SCORES[trackId];
        const now = getPosition();
        const horizon = now + HORIZON;
        for (const [key, end] of scheduled) if (end < now - 1) scheduled.delete(key);
        // Scan intersecting notes, not just onsets: arbitrary seeks and throttled timers
        // reconstruct sustained notes without replaying expired notes or duplicate voices.
        for (let cycle = Math.max(0, Math.floor(now / score.length) - 1); cycle <= Math.floor(horizon / score.length); cycle++) {
          score.events.forEach((event, index) => {
            const start = cycle * score.length + event.start;
            const end = start + event.duration;
            if (start >= horizon || end <= now) return;
            const key = cycle + ':' + index;
            if (scheduled.has(key)) return;
            scheduled.set(key, end);
            voiceAt(event, start, now);
          });
        }
      } catch (problem) { fail(problem); }
    }
    async function play(id, offsetSeconds = 0) {
      const token = ++generation;
      try {
        freeze();
        if (destroyed) return fail(new Error('Audio player has been destroyed.'));
        const track = TRACKS.find(item => item.id === id);
        if (!track) return fail(new Error('Unknown audio track: ' + String(id)));
        if (typeof offsetSeconds !== 'number' || !Number.isFinite(offsetSeconds) || offsetSeconds < 0) {
          return fail(new Error('Audio offset must be a finite non-negative number.'));
        }
        trackId = id;
        position = offsetSeconds;
        error = null;
        initialize();
        if (context.state === 'closed') return fail(new Error('Audio context is closed.'));
        // resume() is called synchronously within the explicit user play gesture.
        if (context.state !== 'running') {
          let timeout;
          try {
            await Promise.race([
              context.resume(),
              new Promise((_, reject) => { timeout = root.setTimeout(() => reject(new Error('Audio is blocked; press Play again to enable sound.')), 2500); })
            ]);
          } finally { if (timeout !== undefined) root.clearTimeout(timeout); }
        }
        if (token !== generation || destroyed) return false;
        if (context.state !== 'running') return fail(new Error('Audio is suspended; press Play again.'));
        origin = context.currentTime + LEAD - position;
        playing = true;
        pump(token);
        if (!playing) return false;
        timer = root.setInterval(() => pump(token), 25);
        notify();
        return true;
      } catch (problem) {
        if (token !== generation || destroyed) return false;
        return fail(problem);
      }
    }
    function pause() { ++generation; freeze(); notify(); }
    function stop() { ++generation; freeze(); position = 0; error = null; notify(); }
    function setVolume(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return;
      volume = Math.max(0, Math.min(1, value));
      try { if (master && context && context.state !== 'closed') master.gain.setTargetAtTime(volume, context.currentTime, 0.015); }
      catch (problem) { fail(problem); return; }
      notify();
    }
    function destroy() {
      if (destroyed) return;
      ++generation;
      freeze();
      position = 0;
      destroyed = true;
      if (context) {
        context.onstatechange = null;
        try { master.disconnect(); compressor.disconnect(); } catch (_) {}
        try { Promise.resolve(context.close()).catch(() => {}); } catch (_) {}
      }
      notify();
    }
    return { play, pause, stop, getPosition, getState, setVolume, destroy };
  }
  root.DASH_TRACKS = TRACKS;
  root.createDashSound = createDashSound;
})(window);
