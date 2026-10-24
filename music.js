/* Hava Nagila — traditional melody, original synthesized accompaniment.
 * Pitch/rhythm reference (ABC, consulted at authoring time only):
 * https://abcnotation.com/tunePage?a=www.tousauxbalkans.net/abc/Havah%20nagilah/0000
 * Also: https://www.tousauxbalkans.net/Havah_nagilah
 * E Freygish: E F G# A B C D. No samples, dependencies, or network requests.
 * Beats are zero-based quarter notes; callback time is AudioContext time in seconds.
 */
(function (root) {
  'use strict';

  const BPM = 132;
  const SPB = 60 / BPM;
  const LOOKAHEAD = 0.18;
  const PITCH = { D: 62, E: 64, F: 65, G: 68, A: 69, B: 71, c: 72, d: 74, e: 76 };
  const CHORDS = {
    E: { bass: 40, fifth: 47, notes: [56, 59, 64] },
    Am: { bass: 45, fifth: 52, notes: [57, 60, 64] },
    Dm: { bass: 38, fifth: 45, notes: [57, 62, 65] }
  };
  // G means G-sharp throughout. Each entry is one 4/4 bar.
  const A = [
    ['E', 'E:1 E:1.5 G:.5 F:.5 E:.5'],
    ['E', 'G:1 G:1.5 B:.5 A:.5 G:.5'],
    ['Am', 'A:1 A:1.5 c:.5 B:.5 A:.5']
  ];
  const B = [
    ['E', 'G:.5 G:1 F:.5 E:.5 E:.5 E:1'],
    ['Dm', 'F:.5 F:1 E:.5 D:.5 D:.5 D:1'],
    ['Dm', 'D:1 F:.75 E:.25 D:.5 D:.5 A:1']
  ];
  const C = [
    ['Am', 'A:2 A:2'],
    ['Am', 'A:1 A:1 A:1 A:1'],
    ['Am', 'A:.5 A:.5 c:.75 B:.25 A:.5 c:.5 B:.5 A:.5'],
    ['Am', 'A:.5 A:.5 c:.75 B:.25 A:.5 c:.5 B:.5 A:.5'],
    ['E', 'B:.5 B:.5 d:.75 c:.25 B:.5 d:.5 c:.5 B:.5'],
    ['E', 'B:.5 B:.5 d:.75 c:.25 B:.5 d:.5 c:.5 B:.5'],
    ['E', 'B:.5 B:.5 e:1 B:.5 B:.5 E:1'],
    ['Am', 'E:.5 E:.5 c:.25 B:.25 A:.25 G:.25 A:2']
  ];
  const bars = [];
  [A, B].forEach(function (section) {
    [0, 1].forEach(function (repeat) {
      bars.push.apply(bars, section);
      bars.push(['E', 'G:1 F:.25 E:.25 F:.5 ' + (repeat ? 'E:2' : 'G:2')]);
    });
  });
  bars.push.apply(bars, C.concat(C));
  const events = [];
  bars.forEach(function (bar, index) {
    let offset = 0;
    bar[1].split(' ').forEach(function (token) {
      const parts = token.split(':');
      const duration = Number(parts[1]);
      events.push({ beat: index * 4 + offset, kind: 'melody', note: PITCH[parts[0]], duration: duration });
      offset += duration;
    });
    for (let beat = 0; beat < 4; beat++) {
      events.push({ beat: index * 4 + beat, kind: 'pulse', chord: bar[0], accent: beat });
      events.push({ beat: index * 4 + beat + 0.5, kind: 'hat' });
    }
  });
  events.sort(function (a, b) { return a.beat - b.beat; });
  const LENGTH = bars.length * 4;
  const hz = function (note) { return 440 * Math.pow(2, (note - 69) / 12); };

  function createHavaPlayer(options) {
    options = options || {};
    let context = null;
    let master = null;
    let compressor = null;
    let noise = null;
    let playing = false;
    let volume = 0.35;
    let generation = 0;
    let pending = null;
    let timer = null;
    let frame = null;
    let origin = 0;
    let cursor = 0;
    let cycle = 0;
    let lastBeat = -1;
    let lastError = null;
    const voices = new Set();
    const raf = typeof root.requestAnimationFrame === 'function';

    function getBeatPosition() {
      return playing && context ? Math.max(0, (context.currentTime - origin) / SPB) : null;
    }
    function getState() {
      const position = getBeatPosition();
      return {
        playing: playing,
        volume: volume,
        bpm: BPM,
        beat: position === null ? 0 : Math.floor(position),
        contextState: context ? context.state : 'unavailable',
        // Optional diagnostic; the six documented fields are always present.
        error: lastError
      };
    }
    function notify(callback, value) {
      if (typeof callback === 'function') {
        // UI callbacks cannot break scheduling or turn start() into a rejection.
        try { callback(value); } catch (_) { /* Consumer owns callback errors. */ }
      }
    }
    function report() { notify(options.onState, getState()); }
    function disconnect(node) { try { node.disconnect(); } catch (_) { /* Already detached. */ } }
    function release(voice) {
      if (!voices.delete(voice)) return;
      voice.nodes.forEach(disconnect);
    }
    function clearAudio() {
      if (timer !== null) { root.clearInterval(timer); timer = null; }
      if (frame !== null) { root.cancelAnimationFrame(frame); frame = null; }
      voices.forEach(function (voice) {
        voice.sources.forEach(function (source) {
          source.onended = null;
          try { source.stop(); } catch (_) { /* Ended or never started. */ }
        });
        voice.nodes.forEach(disconnect);
      });
      voices.clear();
      if (master) { disconnect(master); master = null; }
      if (compressor) { disconnect(compressor); compressor = null; }
    }
    function stop() {
      generation++;
      pending = null;
      playing = false;
      lastBeat = -1;
      clearAudio();
      report();
    }
    function fail(error, token) {
      if (token !== generation) return false;
      playing = false;
      lastError = error && error.message ? error.message : String(error);
      clearAudio();
      report();
      return false;
    }
    function setVolume(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return;
      volume = Math.max(0, Math.min(1, value));
      if (master && context) {
        try { master.gain.setTargetAtTime(volume * 0.7, context.currentTime, 0.025); }
        catch (error) { fail(error, generation); return; }
      }
      report();
    }

    function envelope(time, duration, peak, attack, releaseTime) {
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(peak, time + attack);
      gain.gain.setValueAtTime(peak * 0.8, time + Math.max(attack, duration - releaseTime));
      gain.gain.linearRampToValueAtTime(0, time + duration);
      gain.connect(master);
      return gain;
    }
    function register(sources, nodes, start, end) {
      const voice = { sources: sources, nodes: nodes };
      voices.add(voice);
      sources[sources.length - 1].onended = function () { release(voice); };
      sources.forEach(function (source) { source.start(start); source.stop(end); });
    }
    function tone(note, time, duration, level, type, detune) {
      const gain = envelope(time, duration, level, 0.015, Math.min(0.07, duration * 0.25));
      const oscillator = context.createOscillator();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(hz(note), time);
      oscillator.detune.setValueAtTime(detune || 0, time);
      oscillator.connect(gain);
      // Register before start so even a partial WebAudio failure is cancellable.
      register([oscillator], [oscillator, gain], time, time + duration + 0.01);
    }
    function melody(event, time) {
      const duration = event.duration * SPB * 0.92;
      // Rounded odd harmonics suggest clarinet; a quiet detuned reed adds air.
      tone(event.note, time, duration, 0.18, 'triangle', -3);
      tone(event.note, time, duration, 0.045, 'sine', 4);
      tone(event.note + 19, time, duration, 0.018, 'sine', 0);
    }
    function percussion(time, strong) {
      const duration = strong ? 0.11 : 0.045;
      const gain = envelope(time, duration, strong ? 0.038 : 0.024, 0.002, duration - 0.003);
      const filter = context.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = strong ? 1400 : 6500;
      const source = context.createBufferSource();
      source.buffer = noise;
      source.connect(filter);
      filter.connect(gain);
      register([source], [source, filter, gain], time, time + duration + 0.01);
    }
    function kick(time) {
      const gain = envelope(time, 0.14, 0.19, 0.004, 0.12);
      const source = context.createOscillator();
      source.frequency.setValueAtTime(105, time);
      source.frequency.exponentialRampToValueAtTime(43, time + 0.12);
      source.connect(gain);
      register([source], [source, gain], time, time + 0.15);
    }
    function scheduleEvent(event, time) {
      if (event.kind === 'melody') return melody(event, time);
      if (event.kind === 'hat') return percussion(time, false);
      const chord = CHORDS[event.chord];
      if (event.accent % 2 === 0) {
        tone(event.accent === 0 ? chord.bass : chord.fifth, time, SPB * 0.7, 0.20, 'triangle');
        kick(time);
      } else {
        chord.notes.forEach(function (note, index) {
          tone(note, time, SPB * 0.43, 0.038, 'triangle', index % 2 ? -5 : 5);
        });
        percussion(time, true);
      }
    }
    function deliverBeat(token) {
      if (token !== generation || !playing || context.state !== 'running' || context.currentTime < origin) return;
      const beat = Math.floor((context.currentTime - origin) / SPB);
      if (beat > lastBeat) {
        // Deliver the audible beat, never lookahead beats or a burst of stale beats.
        lastBeat = beat;
        notify(options.onBeat, { beat: beat, time: origin + beat * SPB, bpm: BPM });
      }
    }
    function tick(token) {
      if (token !== generation || !playing) return;
      try {
        if (context.state === 'closed') throw new Error('AudioContext was closed.');
        if (context.state !== 'running') return;
        const now = context.currentTime;
        // After a background-tab stall, seek rather than replaying missed notes.
        const elapsedBeats = Math.max(0, (now - origin) / SPB);
        if ((cycle * LENGTH + events[cursor].beat) < elapsedBeats - 0.5) {
          cycle = Math.floor(elapsedBeats / LENGTH);
          cursor = events.findIndex(function (event) { return event.beat >= elapsedBeats - cycle * LENGTH; });
          if (cursor < 0) { cursor = 0; cycle++; }
        }
        while (true) {
          const event = events[cursor];
          const time = origin + (cycle * LENGTH + event.beat) * SPB;
          if (time > now + LOOKAHEAD) break;
          if (time >= now - 0.03) scheduleEvent(event, Math.max(now, time));
          cursor++;
          if (cursor === events.length) { cursor = 0; cycle++; }
        }
        deliverBeat(token);
      } catch (error) { fail(error, token); }
    }
    function animate(token) {
      if (token !== generation || !playing) return;
      deliverBeat(token);
      if (token === generation && playing) frame = root.requestAnimationFrame(function () { animate(token); });
    }
    function start() {
      if (pending) return pending;
      if (playing) return Promise.resolve(true);
      const token = ++generation;
      lastError = null;
      // AudioContext creation/resume occurs synchronously within the user's gesture.
      let resumed;
      try {
        if (!context || context.state === 'closed') {
          const AudioContextClass = root.AudioContext || root.webkitAudioContext;
          if (!AudioContextClass) throw new Error('Web Audio is not supported in this browser.');
          context = new AudioContextClass();
          context.onstatechange = function () {
            if (context.state === 'closed' && playing) fail(new Error('AudioContext was closed.'), generation);
            else report();
          };
          noise = null;
        }
        resumed = context.state === 'running' ? Promise.resolve() : context.resume();
      } catch (error) { return Promise.resolve(fail(error, token)); }
      const attempt = Promise.resolve(resumed).then(function () {
        if (token !== generation) return false;
        if (context.state !== 'running') throw new Error('AudioContext could not start (' + context.state + ').');
        master = context.createGain();
        master.gain.value = volume * 0.7;
        compressor = context.createDynamicsCompressor();
        compressor.threshold.value = -18;
        compressor.knee.value = 14;
        compressor.ratio.value = 3;
        compressor.attack.value = 0.006;
        compressor.release.value = 0.15;
        master.connect(compressor);
        compressor.connect(context.destination);
        if (!noise) {
          noise = context.createBuffer(1, Math.ceil(context.sampleRate * 0.2), context.sampleRate);
          const data = noise.getChannelData(0);
          let seed = 1729;
          for (let i = 0; i < data.length; i++) {
            seed = (1664525 * seed + 1013904223) >>> 0;
            data[i] = seed / 2147483648 - 1;
          }
        }
        origin = context.currentTime + 0.04;
        cursor = 0;
        cycle = 0;
        lastBeat = -1;
        playing = true;
        tick(token);
        if (!playing || token !== generation) return false;
        timer = root.setInterval(function () { tick(token); }, 25);
        if (raf) frame = root.requestAnimationFrame(function () { animate(token); });
        report();
        return playing && token === generation;
      }).catch(function (error) { return fail(error, token); });
      pending = attempt;
      attempt.then(function () { if (pending === attempt) pending = null; });
      return attempt;
    }
    return { start: start, stop: stop, setVolume: setVolume, getState: getState, getBeatPosition: getBeatPosition };
  }
  root.createHavaPlayer = createHavaPlayer;
  if (typeof module === 'object' && module.exports) module.exports = { createHavaPlayer: createHavaPlayer };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
