/* Флейм-Сити — звук: всё синтезом WebAudio, без единого файла.
 *
 * FC.audio.play(имя, {vol, power, dist, dur}) — разовый звук: blip, note, cash, mission, fail, punch, whoosh, jump,
 *   door, elevator, crash, skid, horn, step.
 * FC.audio.loop(имя, вкл, {rate, vol, dist, rel}) — длящийся звук: engine (тон от rate 0..1), siren (вой, громкость по
 *   dist, «доплер» по rel — скорости сближения), rain, city. Пока модуль сам не слышит чужих вызовов 1,5 с, он ведёт
 *   мотор, сирену, дождь и город сам — по игроку, машинам патруля и погоде (так звук есть, даже если машины молчат).
 * Радио в машине: три станции по районам — «Флейм FM» (поп), «Минск Лоу-фай», «Алматы Ночь» (синтвейв). По умолчанию —
 *   процедурная музыка (аккорды, бас, ритм, мелодия от сида трека). Свои треки (необязательно) — config.js music/musicBase:
 *   порядок перемешан, первый — с середины, как в эфире; файл не загрузился или браузер не дал играть — снова синтез.
 *   R — следующая станция; между треками — новости города.
 * Звук будится первым касанием или клавишей (правило браузеров); «выкл» помнится в localStorage.
 */
(function (global) {
  "use strict";
  var FC = global.FC;
  var AC = global.AudioContext || global.webkitAudioContext;
  var ctx = null, master = null, sfx = null, music = null, amb = null, noiseBuf = null, radioBus = null;
  var muted = false;
  try { muted = global.localStorage.getItem("fc.mute") === "1"; } catch (e) { muted = false; }

  function gainNode(v, dest) { var g = ctx.createGain(); g.gain.value = v; g.connect(dest); return g; }
  function makeNoise() {
    var len = ctx.sampleRate * 2, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function wake() {
    if (!AC) return null;
    if (!ctx) {
      try { ctx = new AC(); } catch (e) { return null; }
      master = ctx.createGain(); master.gain.value = muted ? 0 : 0.8; master.connect(ctx.destination);
      sfx = gainNode(0.9, master); amb = gainNode(0.55, master);
      music = gainNode(0.32, master);
      radioBus = ctx.createBiquadFilter(); radioBus.type = "lowpass"; radioBus.frequency.value = 7200; radioBus.connect(music);
      noiseBuf = makeNoise();
      melInit();
    }
    if (ctx.state !== "running") ctx.resume();                // iOS: и «interrupted» после сворачивания
    return ctx;
  }
  ["pointerdown", "keydown", "touchstart"].forEach(function (ev) { global.addEventListener(ev, wake, { passive: true }); });
  document.addEventListener("visibilitychange", function () {
    if (!ctx) return;
    if (document.hidden) ctx.suspend(); else ctx.resume();
    melPause(document.hidden);
  });
  // Telegram свернул мини-апп (fcore/finput шлют app:hidden) — звук на паузу
  FC.on("app:hidden", function (hidden) { if (!ctx) return; if (hidden) ctx.suspend(); else ctx.resume(); melPause(hidden); });

  /* ---- треки станций: один <audio> через граф WebAudio (громкость, приглушение в диалогах и «выкл» — общие) -- */
  // треки станций — необязательные, из config.js: music: {fm: [...], lofi: [...], night: [...]} → <musicBase><id>.m4a;
  // по умолчанию файлов нет — радио играет процедурный синтез
  var TRACKS = FC.cfg.music, MUSIC = FC.cfg.musicBase;
  var mel = null, melFails = 0, melOrder = {}, melSeek = false;
  function silentWav() {
    var n = 800, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
    function s(o, t) { for (var i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); }
    s(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); s(8, "WAVE"); s(12, "fmt "); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 16000, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, "data"); v.setUint32(40, n * 2, true);
    return URL.createObjectURL(new Blob([b], { type: "audio/wav" }));
  }
  // создаётся в первом касании: iOS/WebView разрешают потом play() без жеста только «освящённому» элементу
  function melInit() {
    if (mel || !global.Audio) return;
    try {
      mel = new global.Audio(); mel.preload = "auto";
      ctx.createMediaElementSource(mel).connect(radioBus);
      mel.addEventListener("ended", function () { if (R.on && R.file) { newsBreak(); jingle(); setTimeout(function () { if (R.on && R.file) playFile(); }, 1400); } });
      mel.addEventListener("error", function () { if (R.on && R.file && mel.src.indexOf("blob:") !== 0) melFail(); });
      mel.addEventListener("loadedmetadata", function () {
        if (melSeek && isFinite(mel.duration) && mel.duration > 30) { try { mel.currentTime = mel.duration * (0.1 + Math.random() * 0.45); } catch (e) { /* без перемотки */ } }
        melSeek = false;
      });
      mel.src = silentWav();
      var p = mel.play(); if (p && p.then) p.then(function () { if (!R.file) mel.pause(); }).catch(function () {});
    } catch (e) { mel = null; }
  }
  function melFail() {
    melFails++;
    R.file = false; R.nextT = ctx.currentTime + 0.08; R.step = 0; R.bar = 0;   // дальше — синтез
  }
  function melPause(hidden) {
    if (!mel || !R.file) return;
    if (hidden) mel.pause(); else if (R.on) { var p = mel.play(); if (p && p.catch) p.catch(function () {}); }
  }
  function playFile() {
    var st = STATIONS[R.st], list = TRACKS[st.id];
    if (!mel || melFails >= 2 || !list || !list.length) return false;
    var o = melOrder[st.id];
    if (!o || !o.length) {
      o = melOrder[st.id] = list.slice();
      for (var i = o.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = o[i]; o[i] = o[j]; o[j] = t; }
    }
    mel.src = MUSIC + o.shift() + ".m4a";
    var p = mel.play();
    if (p && p.catch) p.catch(function (e) { if (R.on && R.file && !(e && e.name === "AbortError")) melFail(); });
    return true;
  }
  function jingle() { var t = ctx.currentTime + 0.05; [72, 76, 79].forEach(function (n, i) { note(t + i * 0.12, n, 0.5, "triangle", 0.08, 4000); }); }

  /* ---- кирпичики: тон с огибающей и шум через фильтр ---------------------------------------------------- */
  function tone(type, f0, f1, dur, vol, dest, delay, attack) {
    var t = ctx.currentTime + (delay || 0);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t + (attack || 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || curDest || sfx);
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }
  function noise(dur, vol, ftype, freq, q, dest, delay, f1) {
    var t = ctx.currentTime + (delay || 0);
    var s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    var f = ctx.createBiquadFilter(); f.type = ftype || "lowpass"; f.frequency.setValueAtTime(freq || 1000, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    f.Q.value = q || 1;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || curDest || sfx);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }

  /* ---- разовые звуки ------------------------------------------------------------------------------------ */
  var SFX = {
    blip: function (v) { tone("sine", 880, 1320, 0.08, 0.16 * v); },
    note: function (v) { tone("sine", 1046, null, 0.14, 0.18 * v); tone("sine", 1568, null, 0.22, 0.16 * v, null, 0.1); },
    cash: function (v) {
      tone("square", 1318, null, 0.07, 0.07 * v); tone("square", 1760, null, 0.24, 0.07 * v, null, 0.07);
      noise(0.18, 0.04 * v, "highpass", 6500, 1, null, 0.05);
    },
    mission: function (v) {
      [523, 659, 784, 1046].forEach(function (f, i) { tone("triangle", f, null, 0.45, 0.16 * v, null, i * 0.11); });
      [523, 659, 784].forEach(function (f) { tone("sine", f, null, 1.4, 0.09 * v, null, 0.48, 0.05); });
      noise(0.5, 0.03 * v, "highpass", 7000, 1, null, 0.44);
    },
    fail: function (v) { [392, 349, 311, 262].forEach(function (f, i) { tone("triangle", f, f * 0.97, 0.38, 0.15 * v, null, i * 0.16); }); },
    punch: function (v) { tone("sine", 150, 45, 0.18, 0.5 * v); noise(0.09, 0.25 * v, "lowpass", 1300); },
    whoosh: function (v) { noise(0.24, 0.12 * v, "bandpass", 500, 1.4, null, 0, 2600); },
    jump: function (v) { tone("sine", 300, 640, 0.15, 0.1 * v); },
    door: function (v) { noise(0.12, 0.14 * v, "bandpass", 900, 2); tone("sine", 95, 60, 0.22, 0.25 * v, null, 0.05); },
    elevator: function (v) { tone("sine", 1318, null, 0.9, 0.14 * v); tone("sine", 1046, null, 1.2, 0.12 * v, null, 0.32); },
    crash: function (v, o) {
      var p = FC.clamp((o.power || 10) / 20, 0.3, 1.4);
      noise(0.7 * p, 0.55 * v * p, "lowpass", 2600, 0.7, null, 0, 260);
      tone("sine", 95, 38, 0.45, 0.6 * v * p);
      tone("square", 190, 120, 0.25, 0.06 * v * p, null, 0.02);
      noise(0.35, 0.12 * v * p, "highpass", 4500, 1, null, 0.05);       // осколки стекла
    },
    skid: function (v) { noise(0.55, 0.14 * v, "bandpass", 2300, 7); },
    horn: function (v, o) {
      var d = o.dur || 0.45, f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1900; f.connect(sfx);
      tone("sawtooth", 349, null, d, 0.11 * v, f, 0, 0.02); tone("sawtooth", 440, null, d, 0.1 * v, f, 0, 0.02);
    },
    step: function (v) { noise(0.05, 0.045 * v, "bandpass", 420 + Math.random() * 380, 1.2); },
    // звуки машин и патруля (их зовёт fcars/fpolice)
    thud: function (v) { tone("sine", 110, 50, 0.2, 0.4 * v); noise(0.12, 0.15 * v, "lowpass", 600); },
    explosion: function (v) { noise(1.4, 0.7 * v, "lowpass", 1800, 0.7, null, 0, 120); tone("sine", 80, 30, 1.2, 0.6 * v); },
    wanted: function (v) { tone("square", 660, null, 0.12, 0.08 * v); tone("square", 880, null, 0.14, 0.08 * v, null, 0.14); },
    whoop: function (v) { tone("sawtooth", 500, 1400, 0.35, 0.09 * v); },
    pop: function (v) { noise(0.06, 0.3 * v, "highpass", 1500); },
    spray: function (v) { noise(1.2, 0.12 * v, "highpass", 3500, 0.8); }
  };
  /* Пространственный звук (v2): play(name, {x, z}) — громкость по расстоянию до камеры и панорама влево/вправо
     относительно взгляда камеры. Звуки без координат — как были, в центр. */
  var curDest = null;
  function spatial(x, z) {
    var cam = FC.gfx && FC.gfx.camera; if (!cam || !ctx.createStereoPanner) return null;
    var dx = x - cam.position.x, dz = z - cam.position.z, d = Math.hypot(dx, dz);
    var yaw = FC.cam ? FC.cam.yaw : 0;
    // правая сторона камеры: (cos yaw, -sin yaw) — как в fpeople
    var pan = d > 0.5 ? FC.clamp((dx * Math.cos(yaw) - dz * Math.sin(yaw)) / d, -1, 1) * 0.85 : 0;
    var g = ctx.createGain(); g.gain.value = FC.clamp(1 - d / 160, 0, 1) * (1 / (1 + d * 0.02));
    var p = ctx.createStereoPanner(); p.pan.value = pan;
    g.connect(p); p.connect(sfx);
    return g.gain.value > 0.01 ? g : false;
  }
  function play(name, opt) {
    if (!ctx || muted || !SFX[name]) return;
    opt = opt || {};
    var v = opt.vol == null ? 1 : opt.vol;
    if (opt.dist != null) v *= FC.clamp(1 - opt.dist / 120, 0, 1);
    if (v <= 0.01) return;
    if (opt.x != null && opt.z != null) {
      var node = spatial(opt.x, opt.z);
      if (node === false) return;
      curDest = node || null;
    }
    try { SFX[name](v, opt); } catch (e) { /* звук не должен ронять игру */ }
    curDest = null;
  }

  /* ---- длящиеся звуки ------------------------------------------------------------------------------------- */
  var loops = {}, ext = {};
  function makeLoop(name) {
    var L = { name: name, out: ctx.createGain() };
    L.out.gain.value = 0;
    if (name === "engine") {
      // голос мотора: два генератора + суб-октава (рокот V8, дизель) + «бульканье» тактов (модуляция громкости)
      L.f = ctx.createBiquadFilter(); L.f.type = "lowpass"; L.f.frequency.value = 900; L.f.Q.value = 2;
      L.o1 = ctx.createOscillator(); L.o1.type = "sawtooth"; L.o1.frequency.value = 45;
      L.o2 = ctx.createOscillator(); L.o2.type = "square"; L.o2.frequency.value = 45.6;
      L.o3 = ctx.createOscillator(); L.o3.type = "sine"; L.o3.frequency.value = 22;
      L.am = ctx.createGain(); L.am.gain.value = 1;
      L.lfo = ctx.createOscillator(); L.lfo.frequency.value = 20; L.amD = gainNode(0, L.am.gain); L.lfo.connect(L.amD);
      var g2 = gainNode(0.4, L.f);
      L.g3 = gainNode(0, L.f);
      L.o1.connect(L.f); L.o2.connect(g2); L.o3.connect(L.g3); L.f.connect(L.am); L.am.connect(L.out); L.out.connect(sfx);
      L.o1.start(); L.o2.start(); L.o3.start(); L.lfo.start();
    } else if (name === "siren") {
      L.o = ctx.createOscillator(); L.o.type = "triangle"; L.o.frequency.value = 950;
      L.lfo = ctx.createOscillator(); L.lfo.frequency.value = 0.55;
      L.depth = gainNode(330, L.o.frequency);
      L.lfo.connect(L.depth);
      L.o.connect(L.out); L.out.connect(sfx);
      L.o.start(); L.lfo.start();
    } else if (name === "heli") {      // вертолёт: низкий шум, «рубленый» лопастями 18 Гц
      L.s = ctx.createBufferSource(); L.s.buffer = noiseBuf; L.s.loop = true;
      L.f = ctx.createBiquadFilter(); L.f.type = "lowpass"; L.f.frequency.value = 260;
      L.chop = ctx.createGain(); L.chop.gain.value = 0.5;
      L.lfo = ctx.createOscillator(); L.lfo.type = "square"; L.lfo.frequency.value = 18;
      var lg = gainNode(0.5, L.chop.gain); L.lfo.connect(lg);
      L.s.connect(L.f); L.f.connect(L.chop); L.chop.connect(L.out); L.out.connect(sfx);
      L.s.start(0, Math.random()); L.lfo.start();
    } else if (name === "skid") {      // визг шин
      L.s = ctx.createBufferSource(); L.s.buffer = noiseBuf; L.s.loop = true;
      L.f = ctx.createBiquadFilter(); L.f.type = "bandpass"; L.f.frequency.value = 2300; L.f.Q.value = 7;
      L.s.connect(L.f); L.f.connect(L.out); L.out.connect(sfx);
      L.s.start(0, Math.random());
    } else {          // rain, city — шум через фильтры
      L.s = ctx.createBufferSource(); L.s.buffer = noiseBuf; L.s.loop = true;
      L.f = ctx.createBiquadFilter();
      if (name === "rain") { L.f.type = "bandpass"; L.f.frequency.value = 3200; L.f.Q.value = 0.5; }
      else { L.f.type = "lowpass"; L.f.frequency.value = 380; L.f.Q.value = 0.7; }
      L.s.connect(L.f); L.f.connect(L.out); L.out.connect(amb);
      L.s.start(0, Math.random());
    }
    loops[name] = L;
    return L;
  }
  function setLoop(name, on, opt) {
    if (!ctx) return;
    var L = loops[name] || (on ? makeLoop(name) : null);
    if (!L) return;
    opt = opt || {};
    var t = ctx.currentTime, vol = on ? (opt.vol == null ? 0.4 : opt.vol) : 0;
    if (opt.dist != null) vol *= FC.clamp(1 - opt.dist / 200, 0, 1);
    L.out.gain.setTargetAtTime(muted ? 0 : vol, t, 0.08);
    if (!on) return;
    if (name === "engine") {
      var V = VOICE[opt.kind] || VOICE.i4;
      if (L.kind !== (opt.kind || "i4")) {
        L.kind = opt.kind || "i4"; L.o1.type = V.w1; L.o2.type = V.w2; L.f.Q.value = V.q;
        L.g3.gain.setTargetAtTime(V.sub * 0.6, t, 0.1); L.amD.gain.setTargetAtTime(V.am * 0.5, t, 0.1); L.am.gain.setTargetAtTime(1 - V.am * 0.5, t, 0.1);
      }
      var r = FC.clamp(opt.rate || 0, 0, 1.2), f = (38 + r * 115) * V.f0 + Math.sin(t * 7) * 1.5;
      L.o1.frequency.setTargetAtTime(f, t, 0.06); L.o2.frequency.setTargetAtTime(f * V.r2, t, 0.06);
      L.o3.frequency.setTargetAtTime(f * 0.5, t, 0.06); L.lfo.frequency.setTargetAtTime(f * 0.25, t, 0.08);
      L.f.frequency.setTargetAtTime((600 + r * 2600) * V.bright, t, 0.08);
    } else if (name === "siren") {
      var dop = 1 + FC.clamp(opt.rel || 0, -40, 40) / 340;
      L.o.frequency.setTargetAtTime(950 * dop, t, 0.1);
    }
  }
  function loop(name, on, opt) { ext[name] = performance.now(); setLoop(name, on, opt); }
  /* Голоса моторов (fcarlist.js snd.k): w1/w2 — формы генераторов, r2 — второй к первому, sub — суб-октава, f0 — высота,
   * bright — фильтр, q — «гнусавость», am — бульканье тактов. i4 — прежний звук (по умолчанию: самолёты, старые типы). */
  var VOICE = {
    i4: { w1: "sawtooth", w2: "square", r2: 1.012, sub: 0, f0: 1, bright: 1, q: 2, am: 0 },
    i4old: { w1: "square", w2: "sawtooth", r2: 1.02, sub: 0.15, f0: 0.85, bright: 0.75, q: 3, am: 0.2 },
    v6: { w1: "sawtooth", w2: "sawtooth", r2: 1.5, sub: 0.2, f0: 0.9, bright: 0.9, q: 1.5, am: 0 },
    v8: { w1: "sawtooth", w2: "square", r2: 1.006, sub: 0.7, f0: 0.62, bright: 0.7, q: 3.5, am: 0.35 },
    v10: { w1: "sawtooth", w2: "square", r2: 2.0, sub: 0.1, f0: 1.3, bright: 1.6, q: 4, am: 0 },
    v12: { w1: "sawtooth", w2: "triangle", r2: 1.5, sub: 0.15, f0: 1.1, bright: 1.15, q: 1, am: 0 },
    flat6: { w1: "square", w2: "sawtooth", r2: 1.5, sub: 0.25, f0: 1.05, bright: 1.3, q: 5, am: 0.12 },
    diesel: { w1: "square", w2: "sawtooth", r2: 1.02, sub: 0.45, f0: 0.55, bright: 0.55, q: 2, am: 0.5 },
    bus: { w1: "square", w2: "sawtooth", r2: 1.03, sub: 0.6, f0: 0.45, bright: 0.45, q: 2, am: 0.6 },
    ev: { w1: "sine", w2: "triangle", r2: 3, sub: 0, f0: 2.4, bright: 2.2, q: 0.7, am: 0 },
    hyper: { w1: "sine", w2: "sawtooth", r2: 4, sub: 0.25, f0: 2, bright: 2.6, q: 1.5, am: 0 },
    troll: { w1: "triangle", w2: "sine", r2: 6, sub: 0.3, f0: 1.6, bright: 1.6, q: 0.7, am: 0 },
    moto: { w1: "sawtooth", w2: "square", r2: 2, sub: 0, f0: 1.5, bright: 1.6, q: 4, am: 0.1 },
    moto1: { w1: "square", w2: "square", r2: 1.01, sub: 0.2, f0: 1, bright: 0.9, q: 3, am: 0.45 },
    tuk: { w1: "square", w2: "square", r2: 1.5, sub: 0.1, f0: 1.4, bright: 1, q: 3, am: 0.5 }
  };

  /* ---- радио: секвенсор с упреждением ---------------------------------------------------------------------- */
  function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  var STATIONS = [
    { id: "fm", name: "Флейм FM", genre: "поп", bpm: 114, root: 60, lead: "square", pad: "triangle",
      scale: [0, 2, 4, 5, 7, 9, 11], prog: [[0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14]] },
    { id: "lofi", name: "Минск Лоу-фай", genre: "лоу-фай", bpm: 78, root: 57, lead: "sine", pad: "sine", swing: 0.16, crackle: true,
      scale: [0, 2, 3, 5, 7, 9, 10], prog: [[2, 5, 9, 12], [7, 11, 14, 17], [0, 4, 7, 11], [9, 12, 16, 19]] },
    { id: "night", name: "Алматы Ночь", genre: "синтвейв", bpm: 100, root: 57, lead: "sawtooth", pad: "sawtooth", arp: true,
      scale: [0, 2, 3, 5, 7, 8, 10], prog: [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]] }
  ];
  var DIST_ST = { center: 0, msk: 0, minsk: 1, ala: 2 };
  var R = { on: false, st: 0, nextT: 0, step: 0, bar: 0, seed: 1, motif: null, timer: null, picked: false, news: false, file: false };
  function trackMotif(seed, st) {
    var r = FC.rng(seed), m = [], deg = 2;
    for (var i = 0; i < 16; i++) {          // 2 такта по восьмым
      if (r() < (st.id === "lofi" ? 0.42 : 0.28)) { m.push(null); continue; }
      deg = FC.clamp(deg + r.int(-2, 2), 0, st.scale.length + 3);
      m.push(deg);
    }
    return m;
  }
  function degNote(st, deg) { var o = Math.floor(deg / st.scale.length); return st.root + 12 + st.scale[deg % st.scale.length] + o * 12; }
  function kick(t) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    g.gain.setValueAtTime(0.55, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g); g.connect(radioBus); o.start(t); o.stop(t + 0.25);
  }
  function hit(t, dur, vol, type, freq) {
    var s = ctx.createBufferSource(); s.buffer = noiseBuf;
    var f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    var g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(radioBus); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }
  function note(t, n, dur, type, vol, cut) {
    var o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = type; o.frequency.value = midi(n);
    f.type = "lowpass"; f.frequency.value = cut || 3000;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(vol * 0.5, t + dur * 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(radioBus); o.start(t); o.stop(t + dur + 0.05);
  }
  var BARS = 16;
  function schedule() {
    if (!R.on || !ctx || R.file) return;
    var st = STATIONS[R.st], spb = 60 / st.bpm / 4;            // длительность шестнадцатой
    while (R.nextT < ctx.currentTime + 0.15) {
      var t = R.nextT, s = R.step % 16, bar = R.bar;
      if (s % 2 === 1 && st.swing) t += spb * st.swing;
      if (R.news) {
        // пауза под новости: тихий джингл в первом такте
        if (s === 0 && bar === 0) [72, 76, 79].forEach(function (n, i) { note(t + i * 0.12, n, 0.5, "triangle", 0.08, 4000); });
      } else {
        var ch = st.prog[Math.floor(bar / (st.id === "lofi" ? 2 : 1)) % st.prog.length];
        // ударные
        if (s === 0 || s === 8 || (st.id === "fm" && s === 10) || (st.id === "night" && s % 4 === 0)) kick(t);
        if (s === 4 || s === 12) hit(t, st.id === "lofi" ? 0.12 : 0.18, st.id === "lofi" ? 0.12 : 0.2, "bandpass", 1800);
        if (s % 2 === 0) hit(t, 0.04, st.id === "lofi" ? 0.04 : 0.06, "highpass", 8000);
        // бас
        var bassAt = st.id === "night" ? s % 2 === 0 : (s === 0 || s === 6 || s === 8 || s === 14);
        if (bassAt) note(t, st.root - 12 + ch[0], spb * (st.id === "night" ? 1.6 : 3), st.id === "lofi" ? "sine" : "triangle", 0.2, 700);
        // аккорд — на долю такта
        if (s === 0) ch.forEach(function (iv) { note(t, st.root + iv, spb * 15, st.pad, st.id === "night" ? 0.035 : 0.05, st.id === "night" ? 1600 : 2400); });
        if (st.id === "lofi" && s === 8) ch.forEach(function (iv) { note(t, st.root + iv, spb * 6, "sine", 0.04, 2000); });
        // арпеджио синтвейва
        if (st.arp && s % 2 === 0) note(t, st.root + 12 + ch[(s / 2) % ch.length], spb * 1.8, "square", 0.025, 2600);
        // мелодия — со второй четверти трека, мотив из сида трека
        if (bar >= 4 && bar < BARS - 1 && s % 2 === 0) {
          var deg = R.motif[(bar % 2) * 8 + s / 2];
          if (deg != null) note(t, degNote(st, deg + (bar >= 8 && bar < 12 ? 2 : 0)), spb * 1.9, st.lead, st.lead === "square" ? 0.045 : st.lead === "sawtooth" ? 0.04 : 0.09, 3200);
        }
        if (st.crackle && s % 4 === 0 && Math.random() < 0.5) hit(t + Math.random() * spb, 0.02, 0.03, "highpass", 3000);
      }
      R.nextT += spb; R.step++;
      if (R.step % 16 === 0) {
        R.bar++;
        var limit = R.news ? 2 : BARS;
        if (R.bar >= limit) {
          R.bar = 0;
          if (R.news) { R.news = false; R.seed++; R.motif = trackMotif(R.seed, STATIONS[R.st]); }
          else { R.news = true; newsBreak(); }
        }
      }
    }
  }
  function newsBreak() {
    var st = STATIONS[R.st], line = FC.story && FC.story.newsLine ? FC.story.newsLine() : null;
    if (!line) line = cityNews();
    if (FC.hud) FC.hud.toast("📻 " + st.name + ": " + line, "", 6);
  }
  function cityNews() {
    var z = (FC.net && FC.net.zones) || {}, keys = Object.keys(z).sort(function (a, b) { return z[b].people - z[a].people; });
    var M = FC.map, k = keys[0], B = k && M.zones[k];
    var pool = [
      B ? "сегодня самое людное место — «" + B.name + "»: там поработали " + z[k].people + " агентов" : null,
      "на дорогах " + FC.cityOf + " спокойно, патруль советует пристёгиваться",
      "синоптики обещают " + (FC.gfx && FC.gfx.weather.target > 0.5 ? "дождь до вечера — берите зонты" : "ясную погоду и тёплый вечер"),
      "Макс на площади снова собрал толпу: агенты делятся задачами",
      "СкукаСофт опять обещает «эффективность без огонька». Горожане не верят"
    ].filter(Boolean);
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function radioOn(stIdx, announce) {
    if (!wake()) return;
    R.on = true; R.st = stIdx; R.step = 0; R.bar = 0; R.news = false; R.seed = Math.floor(Math.random() * 1e6);
    R.motif = trackMotif(R.seed, STATIONS[R.st]);
    R.nextT = ctx.currentTime + 0.08;
    melSeek = true; R.file = playFile();
    if (announce && FC.hud) FC.hud.toast("📻 " + STATIONS[stIdx].name + " · " + STATIONS[stIdx].genre, "", 2.5);
  }
  function radioOff(announce) { R.on = false; R.file = false; if (mel) mel.pause(); if (announce && FC.hud) FC.hud.toast("📻 Радио выключено", "", 1.5); }
  function nextStation() {
    if (!R.on) { radioOn(0, true); R.picked = true; return; }
    if (R.st >= STATIONS.length - 1) { radioOff(true); R.picked = true; R.user = "off"; return; }
    radioOn(R.st + 1, true); R.picked = true; R.user = R.st;
  }
  FC.on("car:enter", function () { startCarRadio(); });
  FC.on("car:exit", function () { radioOff(false); });
  function startCarRadio() {
    if (R.user === "off") return;
    var P = FC.player, d = FC.map.district(P.x, P.z).key;
    radioOn(R.user != null ? R.user : DIST_ST[d] || 0, true);
  }

  /* ---- сам ведём мотор, сирену, дождь, город и шаги ------------------------------------------------------- */
  var wasCar = false, stepAcc = 0, chirpT = 0, eventT = 4;
  function auto(name, on, opt) {
    if (ext[name] && performance.now() - ext[name] < 1500) return;
    setLoop(name, on, opt);
  }
  FC.addSystem({
    name: "audio", order: 92,
    update: function (dt) {
      var P = FC.player;
      if (!ctx || !P || !FC.started) return;
      var inside = !!(FC.inside && FC.inside.active);
      var inCar = P.mode === "car" && P.car;
      if (inCar && !wasCar) startCarRadio();
      if (!inCar && wasCar) radioOff(false);
      wasCar = !!inCar;
      if (FC.input && FC.input.pressed("radio") && inCar) nextStation();
      schedule();
      music.gain.setTargetAtTime(muted ? 0 : (FC.hud && FC.hud.inDialog && FC.hud.inDialog() ? 0.12 : 0.32), ctx.currentTime, 0.2);
      // мотор
      if (inCar) {
        var car = P.car, sp = Math.hypot(car.vx || 0, car.vz || 0), vmax = (car.spec && car.spec.vmax) || 40;
        auto("engine", true, { rate: 0.12 + Math.min(sp / vmax, 1) * 0.9, vol: 0.3 });
      } else auto("engine", false);
      // сирена ближайшей машины патруля с включённой мигалкой
      var best = 1e9, rel = 0;
      if (FC.cars && FC.cars.list) {
        FC.cars.list.forEach(function (c) {
          if (!(c.siren || (c.police && c.driver === "cop")) || c.wrecked) return;
          var d = Math.hypot(c.x - P.x, c.z - P.z);
          if (d < best) {
            best = d;
            var dx = (P.x - c.x) / (d || 1), dz = (P.z - c.z) / (d || 1);
            rel = (c.vx || 0) * dx + (c.vz || 0) * dz - ((inCar ? P.car.vx : P.vx) || 0) * dx - ((inCar ? P.car.vz : P.vz) || 0) * dz;
          }
        });
      }
      auto("siren", best < 220, { vol: 0.22, dist: best, rel: rel });
      // дождь и город
      var rain = FC.gfx ? FC.gfx.weather.rain : 0;
      auto("rain", rain > 0.05, { vol: rain * (inside ? 0.12 : 0.5) });
      var night = FC.clock.night;
      auto("city", true, { vol: inside ? 0.06 : 0.28 - night * 0.14 });
      // сверчки ночью, редкие гудки и птицы днём
      if (!inside && !muted) {
        chirpT -= dt;
        if (night > 0.6 && chirpT <= 0) {
          chirpT = 0.5 + Math.random() * 1.4;
          for (var i = 0; i < 3; i++) tone("sine", 4300 + Math.random() * 300, null, 0.035, 0.012, amb, i * 0.07);
        }
        eventT -= dt;
        if (eventT <= 0) {
          eventT = 6 + Math.random() * 10;
          if (night < 0.5 && Math.random() < 0.5) { var bf = 2400 + Math.random() * 900; tone("sine", bf, bf * 1.3, 0.09, 0.02, amb); tone("sine", bf * 1.1, bf * 1.4, 0.08, 0.018, amb, 0.12); }
          else if (Math.random() < 0.6) { var hf = 280 + Math.random() * 120; tone("sawtooth", hf, null, 0.3, 0.012, amb, 0, 0.03); }
        }
      }
      // шаги
      if (P.mode === "foot" && P.onGround) {
        var v = Math.hypot(P.vx || 0, P.vz || 0);
        if (v > 0.6) { stepAcc += v * dt; if (stepAcc > (v > 5 ? 1.05 : 0.75)) { stepAcc = 0; play("step", { vol: v > 5 ? 1 : 0.7 }); } }
      }
    }
  });

  // деньги звенят сами — шина событий ядра
  FC.on("money", function (m) { if (m.delta > 0) play("cash"); });

  function setMuted(on) {
    muted = !!on;
    try { global.localStorage.setItem("fc.mute", muted ? "1" : "0"); } catch (e) { /* без хранилища */ }
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.05);
    FC.audio.muted = muted;
  }

  /* Звуки других модулей (fguns.js — выстрелы, перезарядка, гильзы; 22.11 v3): define(имя, fn(vol, opt, syn)) —
     syn.tone/noise — те же кирпичики (пространственность play(имя, {x, z}) работает и для них), syn.ctx() — контекст. */
  var SYN = { tone: tone, noise: noise, ctx: function () { return ctx; } };
  function define(name, fn) { SFX[name] = function (v, o) { return fn(v, o, SYN); }; }

  FC.audio = {
    play: play, loop: loop, setMuted: setMuted, muted: muted, wake: wake, define: define,
    radio: { next: nextStation, on: function (i) { radioOn(i || 0, true); }, off: function () { radioOff(true); }, stations: STATIONS,
      current: function () { return R.on ? STATIONS[R.st] : null; } }
  };
})(window);
