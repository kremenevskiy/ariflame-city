/* Флейм-Сити — стрельба и ощущение оружия (FC.guns): у каждого ствола свой темп, падение урона, разброс и его рост
 * от очереди, отдача камеры, перезарядка, трассер, вспышка, гильзы, искры попаданий и свой синтезированный звук.
 * Таблица характеристик и патроны — fweap.js (FC.weap). Задача: «реализм близкий к GTA».
 *
 * Прицел: на компьютере (мышь захвачена) — свободный, камера за плечом, ПКМ — точнее и ближе, у винтовки — оптика ×6;
 * на тач — мягкий захват ближней цели в конусе взгляда (прицел плавно «прилипает»), 🔭 — оптика, ⟳ — перезарядка,
 * зажать 🔫 — колесо оружия. Клавиши: 1–9 — оружие, T (держать) — колесо, R — перезарядка, ЛКМ — огонь, ПКМ — прицел.
 * Автомат: короткий тап — очередь по 3, держишь — авто. Дробовик заряжается по патрону (выстрел прерывает). Винтовка —
 * затвор после выстрела. Граната и «Факел»: держишь — дуга броска, отпустил — бросок.
 * Крови нет: попадание — вспышка-пыль, человек вырубается и встаёт; машины — урон до пожара. Патруль: выстрел слышно на
 * w.loud м — свидетели звонят (fpolice e.r), тяжёлое оружие — 2★, поджог/взрыв — серьёзные; навёл ствол на патрульного —
 * 1★. Последние 60 с из тяжёлого — патруль бьёт шокерами дальше и чаще (FC.guns.heat, fweap.js).
 *
 * События шины (для анимации людей — fhumans): weapon:equip {id, cls} (fweap), weapon:fire {id, x, y, z, dx, dy, dz},
 * weapon:reload {id, time, perShell}, weapon:swing {id}, weapon:throw {id}, weapon:hit {ch|car, dmg, head, ko}.
 * Рука: FC.guns.handAnchor = fn(out) → true — модуль людей кладёт в out {x, y, z} точку ладони; иначе — у плеча.
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE, M = FC.map, G = FC.gfx, I = FC.input, WP = FC.weap;
  if (!WP) return;

  function A() { return WP.A(); }
  function cur() { return WP.cur(); }
  function room() { return FC.inside && FC.inside.active ? FC.inside.building.id : null; }
  function snd(n, o) { if (FC.audio) FC.audio.play(n, o); }
  function hap(k) { if (FC.fx && FC.fx.haptic) FC.fx.haptic(k); }
  function burst(kind, x, y, z, n) { if (FC.fx && FC.fx.burst) FC.fx.burst(x, y, z, kind, n); }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  /* ---- звук: синтез каждого ствола (FC.audio.define — faudio.js) ------------------------------------------------ */
  var SOUNDS = {
    g_pistol: function (v, o, s) {
      s.noise(0.07, 0.55 * v, "highpass", 1400, 0.8); s.tone("triangle", 190, 60, 0.12, 0.42 * v);
      s.noise(0.45, 0.12 * v, "lowpass", 1400, 0.7, null, 0.02, 200); s.noise(0.3, 0.05 * v, "bandpass", 700, 1, null, 0.16);
    },
    g_revolver: function (v, o, s) {
      s.noise(0.09, 0.75 * v, "highpass", 1000, 0.8); s.tone("sine", 140, 38, 0.32, 0.6 * v);
      s.noise(0.8, 0.22 * v, "lowpass", 1800, 0.7, null, 0.01, 130); s.noise(0.5, 0.08 * v, "lowpass", 800, 1, null, 0.22, 150);
    },
    g_smg: function (v, o, s) {
      s.noise(0.05, 0.42 * v, "bandpass", 2600, 0.9); s.tone("square", 240, 90, 0.05, 0.1 * v);
      s.noise(0.2, 0.06 * v, "lowpass", 1200, 0.7, null, 0.01, 200);
    },
    g_shotgun: function (v, o, s) {
      s.noise(0.08, 0.7 * v, "highpass", 900); s.noise(0.75, 0.48 * v, "lowpass", 2200, 0.7, null, 0, 140);
      s.tone("sine", 78, 30, 0.45, 0.65 * v); s.noise(0.55, 0.08 * v, "lowpass", 900, 1, null, 0.2, 160);
    },
    g_pump: function (v, o, s) {
      s.noise(0.05, 0.25 * v, "bandpass", 1800, 3); s.tone("square", 520, 300, 0.03, 0.07 * v);
      s.noise(0.06, 0.3 * v, "bandpass", 1200, 3, null, 0.16); s.tone("square", 380, 220, 0.04, 0.08 * v, null, 0.16);
    },
    g_rifle: function (v, o, s) {
      s.noise(0.06, 0.6 * v, "highpass", 1800); s.noise(0.14, 0.32 * v, "bandpass", 900, 0.9);
      s.tone("sine", 160, 48, 0.16, 0.42 * v); s.noise(0.5, 0.08 * v, "lowpass", 900, 0.7, null, 0.05, 150);
    },
    g_sniper: function (v, o, s) {
      s.noise(0.1, 0.85 * v, "highpass", 1300); s.tone("sine", 120, 30, 0.5, 0.7 * v);
      s.noise(1.6, 0.22 * v, "lowpass", 1600, 0.6, null, 0.03, 90); s.noise(0.9, 0.08 * v, "lowpass", 700, 0.7, null, 0.38, 120);
    },
    g_bolt: function (v, o, s) {
      s.noise(0.05, 0.22 * v, "bandpass", 1500, 4); s.tone("square", 700, 400, 0.03, 0.06 * v);
      s.noise(0.06, 0.26 * v, "bandpass", 1100, 4, null, 0.22); s.tone("square", 500, 260, 0.04, 0.07 * v, null, 0.22);
    },
    g_taser: function (v, o, s) {
      s.noise(0.05, 0.3 * v, "highpass", 2500); s.tone("sawtooth", 58, 61, 0.7, 0.1 * v);
      s.tone("square", 117, 121, 0.7, 0.04 * v); s.noise(0.7, 0.08 * v, "highpass", 5200, 0.8);
    },
    g_dry: function (v, o, s) { s.noise(0.02, 0.25 * v, "highpass", 3000, 2); s.tone("square", 1800, 1200, 0.015, 0.05 * v); },
    g_magout: function (v, o, s) { s.noise(0.04, 0.2 * v, "bandpass", 1500, 4); s.tone("triangle", 900, 600, 0.04, 0.07 * v); },
    g_magin: function (v, o, s) { s.noise(0.05, 0.3 * v, "bandpass", 1100, 3); s.tone("square", 420, 250, 0.04, 0.09 * v); },
    g_rack: function (v, o, s) {
      s.noise(0.04, 0.24 * v, "bandpass", 2000, 4); s.noise(0.05, 0.28 * v, "bandpass", 1300, 4, null, 0.09);
      s.tone("square", 600, 330, 0.03, 0.06 * v, null, 0.09);
    },
    g_cyl: function (v, o, s) { for (var i = 0; i < 3; i++) s.noise(0.02, 0.18 * v, "highpass", 2600, 3, null, i * 0.08); },
    g_shell: function (v, o, s) { s.noise(0.04, 0.22 * v, "bandpass", 1300, 3); s.tone("square", 600, 380, 0.03, 0.06 * v); },
    g_tink: function (v, o, s) { var f = 3900 + Math.random() * 900; s.tone("sine", f, null, 0.05, 0.05 * v); s.tone("sine", f * 0.74, null, 0.08, 0.03 * v, null, 0.06); },
    g_hitwall: function (v, o, s) { s.noise(0.05, 0.26 * v, "bandpass", 700 + Math.random() * 500, 1.2); },
    g_hitmetal: function (v, o, s) { s.tone("sine", 2300 + Math.random() * 800, 1500, 0.12, 0.1 * v); s.noise(0.04, 0.2 * v, "highpass", 3000); },
    g_hitbody: function (v, o, s) { s.tone("sine", 120, 60, 0.08, 0.3 * v); s.noise(0.05, 0.12 * v, "lowpass", 800); },
    g_glass: function (v, o, s) {
      s.noise(0.35, 0.3 * v, "highpass", 5000, 0.7);
      for (var i = 0; i < 5; i++) s.tone("sine", 3000 + Math.random() * 3000, null, 0.08, 0.04 * v, null, 0.03 + i * 0.05);
    },
    g_fire: function (v, o, s) {
      s.noise(1.4, 0.32 * v, "lowpass", 500, 0.8, null, 0, 1600);
      for (var i = 0; i < 8; i++) s.noise(0.03, 0.08 * v, "highpass", 2500, 1, null, 0.2 + Math.random() * 1.2);
    },
    g_pin: function (v, o, s) { s.tone("sine", 2600, null, 0.05, 0.06 * v); s.noise(0.03, 0.08 * v, "highpass", 4000); },
    g_boom: function (v, o, s) {
      s.noise(0.1, 0.8 * v, "highpass", 800); s.noise(1.8, 0.75 * v, "lowpass", 2000, 0.7, null, 0, 90);
      s.tone("sine", 70, 25, 1.2, 0.75 * v); s.noise(1, 0.12 * v, "lowpass", 600, 0.7, null, 0.4, 100);
    },
    g_swing: function (v, o, s) { s.noise(0.2, 0.14 * v, "bandpass", 420, 1.6, null, 0, 1800); }
  };
  var SHOT = { pistol: "g_pistol", revolver: "g_revolver", smg: "g_smg", shotgun: "g_shotgun", rifle: "g_rifle", sniper: "g_sniper", taser: "g_taser" };
  var soundsOk = false;
  function defineSounds() {
    if (soundsOk || !FC.audio || !FC.audio.define) return;
    Object.keys(SOUNDS).forEach(function (k) { FC.audio.define(k, SOUNDS[k]); });
    soundsOk = true;
  }

  /* ---- стили: прицел, оптика, колесо, кнопки тача ------------------------------------------------------------- */
  FC.css([
    ".gx{position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:4;opacity:0;transition:opacity .12s}",
    ".gx.on{opacity:1}.gx i{position:absolute;background:#fff;box-shadow:0 0 3px rgba(0,0,0,.9);border-radius:1px}",
    ".gx .t,.gx .b{width:2px;height:8px;left:-1px}.gx .l,.gx .r{height:2px;width:8px;top:-1px}",
    ".gx .d{width:3px;height:3px;left:-1.5px;top:-1.5px;border-radius:50%}",
    ".gx.lock i{background:#ff5d6c}.gx.ko i{background:#ff2d4a}",
    ".gx .hm{position:absolute;left:-11px;top:-11px;width:22px;height:22px;opacity:0;background:none;box-shadow:none}",
    ".gx .hm:before,.gx .hm:after{content:'';position:absolute;left:10px;top:-2px;width:2px;height:26px;background:#fff;transform:rotate(45deg);box-shadow:0 0 3px #000}",
    ".gx .hm:after{transform:rotate(-45deg)}.gx .hm.on{animation:ghm .25s ease-out}.gx .hm.red:before,.gx .hm.red:after{background:#ff3b4e}",
    "@keyframes ghm{0%{opacity:1;transform:scale(1.3)}100%{opacity:0;transform:scale(.8)}}",
    ".gx svg{position:absolute;left:-19px;top:-19px;width:38px;height:38px;opacity:0;transform:rotate(-90deg)}.gx.rl svg{opacity:1}",
    ".gx .arc{position:absolute;left:14px;top:12px;font:700 11px system-ui;color:#fff;text-shadow:0 1px 3px #000;white-space:nowrap}",
    ".gscope{position:fixed;inset:0;pointer-events:none;z-index:3;opacity:0;transition:opacity .1s;",
    " background:radial-gradient(circle at 50% 50%,rgba(0,0,0,0) 0,rgba(0,0,0,0) min(38vh,38vw),rgba(0,0,0,.96) calc(min(38vh,38vw) + 2px))}",
    ".gscope.on{opacity:1}.gscope:before,.gscope:after{content:'';position:absolute;background:rgba(0,0,0,.85)}",
    ".gscope:before{left:50%;top:calc(50% - min(38vh,38vw));width:1.5px;height:calc(min(38vh,38vw) * 2);margin-left:-.75px}",
    ".gscope:after{top:50%;left:calc(50% - min(38vh,38vw));height:1.5px;width:calc(min(38vh,38vw) * 2);margin-top:-.75px}",
    ".gscope b{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px;border-radius:50%;background:#ff3b4e;box-shadow:0 0 6px #ff3b4e}",
    ".gscope span{position:absolute;left:calc(50% + 14px);top:calc(50% + 14px);font:700 12px ui-monospace,monospace;color:#9dffbf;text-shadow:0 1px 3px #000}",
    ".gwheel{position:fixed;inset:0;z-index:8;display:none;align-items:center;justify-content:center;background:radial-gradient(circle,rgba(5,8,18,.55),rgba(5,8,18,.2) 60%);pointer-events:auto;touch-action:none}",
    ".gwheel.on{display:flex}.gwring{position:relative;width:min(340px,86vw);height:min(340px,86vw);border-radius:50%;",
    " background:rgba(12,16,32,.78);border:1px solid rgba(255,207,122,.35);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}",
    ".gwseg{position:absolute;width:68px;height:68px;margin:-34px 0 0 -34px;border-radius:50%;display:flex;flex-direction:column;align-items:center;",
    " justify-content:center;font:700 10px system-ui;color:#fff;background:rgba(255,255,255,.06);border:1px solid transparent;transition:transform .08s}",
    ".gwseg b{font-size:26px;line-height:1}.gwseg i{font-style:normal;color:#9dffbf;font-size:10px}.gwseg.hot{transform:scale(1.18);",
    " background:rgba(255,207,122,.28);border-color:#ffcf7a}.gwseg.cur{box-shadow:0 0 0 2px rgba(157,255,191,.6) inset}",
    ".gwmid{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:46%;text-align:center;font:700 13px system-ui;color:#fff}",
    ".gwmid small{display:block;font-weight:600;font-size:11px;color:rgba(255,245,230,.65);margin-top:3px}",
    ".tbtn.b-wpn,.tbtn.b-rel,.tbtn.b-scope{z-index:5}.tbtn.b-wpn{right:164px;bottom:calc(232px + var(--safe-b))}.tbtn.b-rel{right:100px;bottom:calc(60px + var(--safe-b));width:48px;height:48px;font-size:20px}",
    ".tbtn.b-scope{right:20px;bottom:calc(304px + var(--safe-b))}"
  ].join("\n"));

  var gx = document.createElement("div"); gx.className = "gx";
  gx.innerHTML = "<i class='t'></i><i class='b'></i><i class='l'></i><i class='r'></i><i class='d'></i><i class='hm'></i>" +
    "<svg viewBox='0 0 38 38'><circle cx='19' cy='19' r='16' fill='none' stroke='rgba(255,255,255,.25)' stroke-width='3'/>" +
    "<circle class='rp' cx='19' cy='19' r='16' fill='none' stroke='#ffcf7a' stroke-width='3' stroke-dasharray='100.5' stroke-dashoffset='100.5'/></svg><span class='arc'></span>";
  document.body.appendChild(gx);
  var gxT = gx.querySelector(".t"), gxB = gx.querySelector(".b"), gxL = gx.querySelector(".l"), gxR = gx.querySelector(".r");
  var gxHm = gx.querySelector(".hm"), gxRp = gx.querySelector(".rp"), gxArc = gx.querySelector(".arc");
  var scopeEl = document.createElement("div"); scopeEl.className = "gscope"; scopeEl.innerHTML = "<b></b><span></span>";
  document.body.appendChild(scopeEl);
  var scopeTxt = scopeEl.querySelector("span");

  /* ---- эффекты: вспышка, трассеры, гильзы, свет, провода шокера, дуга броска, огонь ------------------------------ */
  var starTex = G.tex.canvas(128, 128, function (x) {
    var g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,230,1)"); g.addColorStop(0.18, "rgba(255,220,140,.95)"); g.addColorStop(0.45, "rgba(255,140,40,.45)"); g.addColorStop(1, "rgba(255,80,0,0)");
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    x.globalCompositeOperation = "lighter"; x.fillStyle = "rgba(255,230,160,.9)";
    for (var i = 0; i < 6; i++) {
      var a = i / 6 * Math.PI * 2 + 0.3;
      x.beginPath(); x.moveTo(64 + Math.cos(a) * 60, 64 + Math.sin(a) * 60); x.lineTo(64 + Math.cos(a + 0.18) * 10, 64 + Math.sin(a + 0.18) * 10);
      x.lineTo(64 + Math.cos(a - 0.18) * 10, 64 + Math.sin(a - 0.18) * 10); x.closePath(); x.fill();
    }
  });
  var flashes = [];
  for (var fi = 0; fi < 4; fi++) {
    var sp = new T.Sprite(new T.SpriteMaterial({ map: starTex, color: 0xffffff, transparent: true, blending: T.AdditiveBlending, depthWrite: false, fog: false }));
    sp.visible = false; sp.renderOrder = 6; G.add(sp); flashes.push({ s: sp, t: 0 });
  }
  var flashI = 0;
  var light = null;
  if (G.Q.level === "high") { light = new T.PointLight(0xffb060, 0, 9, 2); light.castShadow = false; G.add(light); }
  var lightT = 0, lightFresh = false;
  function muzzleFlash(x, y, z, size) {
    var f = flashes[flashI = (flashI + 1) % flashes.length];
    f.s.position.set(x, y, z); f.s.scale.setScalar(size * rnd(0.8, 1.2)); f.s.material.rotation = Math.random() * 6.28;
    f.s.visible = true; f.t = 0.05; f.fresh = true;                     // свежая — хотя бы один кадр на экране (и при 10 FPS)
    if (light) { light.position.set(x, y, z); light.intensity = 7 * size; lightT = 0.05; lightFresh = true; }
  }
  // трассеры: летящая полоска (голова — путь пули, хвост до 7 м), до точки попадания
  var TRMAX = 48, tracers = [];
  var trMesh = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1).translate(0, 0, -0.5),
    new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: T.AdditiveBlending, depthWrite: false, fog: false }), TRMAX);
  trMesh.instanceMatrix.setUsage(T.DynamicDrawUsage); trMesh.count = 0; trMesh.frustumCulled = false; trMesh.renderOrder = 6;
  G.add(trMesh);
  function tracer(ax, ay, az, bx, by, bz, speed, hex) {
    if (tracers.length >= TRMAX) tracers.shift();
    var d = Math.hypot(bx - ax, by - ay, bz - az) || 0.01;
    tracers.push({ ax: ax, ay: ay, az: az, dx: (bx - ax) / d, dy: (by - ay) / d, dz: (bz - az) / d, d: d, s: Math.min(d, 7), v: speed || 340, hex: hex || 0xffd27a, fresh: true });
  }
  // гильзы: латунь (у дробовика — красные), отскок и звон, лежат 6 с
  var CMAX = 70, casings = [];
  var cMesh = new T.InstancedMesh(new T.CylinderGeometry(1, 1, 1, 6), new T.MeshStandardMaterial({ color: 0xffffff, metalness: 0.7, roughness: 0.35 }), CMAX);
  cMesh.instanceMatrix.setUsage(T.DynamicDrawUsage); cMesh.count = 0; cMesh.frustumCulled = false; cMesh.castShadow = false;
  G.add(cMesh);
  function casing(x, y, z, rx, rz, w) {
    if (w.cls === "taser" || w.cls === "revolver") return;            // у револьвера гильзы остаются в барабане
    if (casings.length >= CMAX) casings.shift();
    var big = w.cls === "shotgun" || w.cls === "sniper";
    casings.push({ x: x, y: y, z: z, vx: rx * rnd(2, 3.2) + rnd(-0.4, 0.4), vy: rnd(2, 3.4), vz: rz * rnd(2, 3.2) + rnd(-0.4, 0.4),
      r: big ? 0.022 : 0.014, l: big ? 0.07 : 0.04, hex: w.cls === "shotgun" ? 0xc0282d : 0xd6a640, rx: Math.random() * 6, rz: Math.random() * 6,
      sx: rnd(-14, 14), sz: rnd(-14, 14), t: 0, rest: false, bounced: 0 });
  }
  // провода шокера
  var wires = [];
  var wireMat = new T.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.9, blending: T.AdditiveBlending, depthWrite: false });
  var wireGeo = new T.BoxGeometry(0.012, 0.012, 1).translate(0, 0, 0.5);
  function wire(ax, ay, az, bx, by, bz, t) {
    for (var k = 0; k < 2; k++) {
      var m = new T.Mesh(wireGeo, wireMat);
      m.position.set(ax, ay + k * 0.04, az); m.lookAt(bx, by + k * 0.18, bz);
      m.scale.set(1, 1, Math.hypot(bx - ax, by + k * 0.18 - ay, bz - az)); G.add(m); wires.push({ m: m, t: t });
    }
  }
  // дуга броска — пунктир из точек (линий в сборке движка нет)
  var ARC_N = 36, arcPos = new Float32Array(ARC_N * 3);
  var arcLine = new T.InstancedMesh(new T.SphereGeometry(0.11, 8, 6), new T.MeshBasicMaterial({ color: 0xffcf7a, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false, fog: false }), ARC_N);
  arcLine.instanceMatrix.setUsage(T.DynamicDrawUsage); arcLine.frustumCulled = false; arcLine.visible = false; arcLine.renderOrder = 6; G.add(arcLine);
  var arcO = new T.Object3D();
  var arcEnd = new T.Mesh(new T.RingGeometry(0.5, 0.75, 24).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: 0xffcf7a, transparent: true, opacity: 0.75, depthWrite: false, depthTest: false }));
  arcEnd.visible = false; arcEnd.renderOrder = 6; G.add(arcEnd);
  // волна взрыва и пятна огня
  var waves = [], fires = [];
  var waveGeo = new T.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2);
  var fireGeo = new T.CircleGeometry(1, 24).rotateX(-Math.PI / 2);

  /* ---- оружие в руке: простые модели из примитивов (люди моделями — fhumans — могут дать ладонь) ------------------ */
  var matGun = new T.MeshStandardMaterial({ color: 0x23262d, metalness: 0.6, roughness: 0.45 });
  var matGrip = new T.MeshStandardMaterial({ color: 0x3a2b22, metalness: 0.1, roughness: 0.8 });
  var matWood = new T.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.7 });
  var matYel = new T.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.5 });
  var matGlass = new T.MeshStandardMaterial({ color: 0x3f8f4f, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 });
  var matRed = new T.MeshStandardMaterial({ color: 0x7a1c1c, roughness: 0.6 });
  function part(geo, mat, x, y, z, rx) { var m = new T.Mesh(geo, mat); m.position.set(x, y, z); if (rx) m.rotation.x = rx; m.castShadow = false; return m; }
  function box(w, h, d) { return new T.BoxGeometry(w, h, d); }
  function cyl(r, l) { return new T.CylinderGeometry(r, r, l, 10).rotateX(Math.PI / 2); }
  // модель вдоль +z (ствол вперёд), начало — у кисти; barrel — длина до дульного среза
  var MODELS = {
    pistol: function (g) { g.add(part(box(0.034, 0.04, 0.2), matGun, 0, 0.05, 0.06)); g.add(part(box(0.03, 0.1, 0.045), matGrip, 0, 0, 0, -0.25)); return 0.17; },
    revolver: function (g) { g.add(part(cyl(0.012, 0.2), matGun, 0, 0.06, 0.12)); g.add(part(cyl(0.024, 0.05), matGun, 0, 0.05, 0.02)); g.add(part(box(0.03, 0.1, 0.045), matWood, 0, 0, -0.02, -0.35)); return 0.22; },
    smg: function (g) { g.add(part(box(0.05, 0.07, 0.3), matGun, 0, 0.05, 0.08)); g.add(part(box(0.03, 0.14, 0.035), matGun, 0, -0.05, 0.12)); g.add(part(box(0.03, 0.09, 0.04), matGrip, 0, -0.02, -0.02, -0.2)); g.add(part(cyl(0.01, 0.1), matGun, 0, 0.06, 0.27)); return 0.32; },
    shotgun: function (g) { g.add(part(cyl(0.016, 0.62), matGun, 0, 0.06, 0.26)); g.add(part(cyl(0.02, 0.16), matWood, 0, 0.03, 0.2)); g.add(part(box(0.04, 0.07, 0.26), matWood, 0, 0.02, -0.14)); g.add(part(box(0.035, 0.07, 0.14), matGun, 0, 0.05, 0.0)); return 0.57; },
    rifle: function (g) { g.add(part(box(0.055, 0.08, 0.46), matGun, 0, 0.05, 0.1)); g.add(part(cyl(0.012, 0.22), matGun, 0, 0.06, 0.43)); g.add(part(box(0.035, 0.15, 0.06), matGun, 0, -0.06, 0.16, 0.25)); g.add(part(box(0.04, 0.08, 0.2), matGun, 0, 0.02, -0.2)); g.add(part(box(0.03, 0.09, 0.04), matGrip, 0, -0.03, 0.0, -0.25)); return 0.54; },
    sniper: function (g) { g.add(part(box(0.05, 0.07, 0.6), matGun, 0, 0.04, 0.15)); g.add(part(cyl(0.011, 0.4), matGun, 0, 0.05, 0.62)); g.add(part(cyl(0.022, 0.26), matGun, 0, 0.12, 0.14)); g.add(part(box(0.045, 0.1, 0.26), matWood, 0, 0.0, -0.22)); return 0.82; },
    taser: function (g) { g.add(part(box(0.04, 0.05, 0.15), matYel, 0, 0.05, 0.04)); g.add(part(box(0.032, 0.09, 0.045), matGun, 0, 0, -0.01, -0.25)); return 0.12; },
    bat: function (g) { g.add(part(new T.CylinderGeometry(0.035, 0.018, 0.82, 10).rotateX(Math.PI / 2), matWood, 0, 0, 0.36)); return 0.8; },
    knuck: function (g) { g.add(part(box(0.09, 0.03, 0.03), matGun, 0, 0.02, 0.03)); return 0.05; },
    grenade: function (g) { g.add(part(new T.SphereGeometry(0.045, 10, 8), new T.MeshStandardMaterial({ color: 0x4b5a32, roughness: 0.6 }), 0, 0.03, 0.03)); g.add(part(box(0.012, 0.03, 0.03), matGun, 0, 0.08, 0.03)); return 0.05; },
    molotov: function (g) { g.add(part(new T.CylinderGeometry(0.035, 0.035, 0.18, 10), matGlass, 0, 0.06, 0.02)); g.add(part(new T.CylinderGeometry(0.012, 0.012, 0.06, 6), matGlass, 0, 0.18, 0.02)); g.add(part(box(0.03, 0.06, 0.02), matRed, 0, 0.23, 0.02)); return 0.05; }
  };
  var held = {}, heldNow = null, holder = new T.Group(); holder.visible = false; G.add(holder);
  function modelOf(id) {
    if (held[id]) return held[id];
    var w = WP.W[id], key = w.cls === "throw" ? id : w.melee ? id : w.cls, mk = MODELS[key];
    if (!mk) return null;
    var g = new T.Group(); g.userData.barrel = mk(g); g.visible = false; holder.add(g);
    held[id] = g; return g;
  }
  var proj = [];                                                   // летящие гранаты и бутылки
  var projGeo = { grenade: new T.SphereGeometry(0.07, 10, 8), molotov: new T.CylinderGeometry(0.04, 0.04, 0.2, 8) };
  var projMat = { grenade: new T.MeshStandardMaterial({ color: 0x4b5a32, roughness: 0.6 }), molotov: matGlass };

  /* ---- луч: люди (цилиндры), машины (коробки), здания и земля (шагом с уточнением) -------------------------------- */
  function skipChar(c, rm) {
    if (c.kind === "player" || c.kind === "remote" || c.knocked > 0 || c.visible === false || c.alpha < 0.3) return true;
    return rm != null ? c.room !== rm : (c.inside != null || c.room != null);
  }
  function wallAt(x, y, z, rm) {
    if (rm != null) { var fy = FC.inside.floorY(); return y > fy + 3.2 || FC.inside.collide(x, z, 0.05).hit; }
    var B = M.buildingAt(x, z);
    return !!(B && y < (B.h || 10));
  }
  var HIT = { t: 0, kind: null, ch: null, car: null, x: 0, y: 0, z: 0, head: false };
  function raycast(ox, oy, oz, dx, dy, dz, maxD, people) {
    var best = maxD, kind = null, bch = null, bcar = null, head = false, rm = room();
    var dl2 = dx * dx + dz * dz;
    if (people !== false && dl2 > 1e-6) {
      var all = FC.people.all;
      for (var i = 0; i < all.length; i++) {
        var c = all[i];
        if (skipChar(c, rm)) continue;
        var cx = c.x - ox, cz = c.z - oz, tc = (cx * dx + cz * dz) / dl2;
        if (tc < 0 || tc > best + 1) continue;
        var px = dx * tc - cx, pz = dz * tc - cz, d2 = px * px + pz * pz, r = 0.42;
        if (d2 > r * r) continue;
        var th = Math.max(0, tc - Math.sqrt((r * r - d2) / dl2));
        var base = c.y || 0.15, hgt = 1.8 * FC.clamp((c.scale || 1.8) / 1.8, 0.8, 1.15), y = oy + dy * th;
        if (y < base || y > base + hgt) { th = tc; y = oy + dy * tc; if (y < base || y > base + hgt) continue; }
        if (th < best) { best = th; kind = "ped"; bch = c; head = y > base + hgt * 0.8; }
      }
    }
    if (rm == null && FC.cars) {
      var L = FC.cars.list;
      for (var j = 0; j < L.length; j++) {
        var car = L[j];
        if (car.dead || car.hidden || car.driver === "player") continue;
        var S = car.spec, rx = ox - car.x, rz = oz - car.z;
        var q = (rx + dx * best * 0.5), qz = (rz + dz * best * 0.5);
        if (q * q + qz * qz > Math.pow(best * 0.5 + S.L, 2)) continue;     // грубо: машина не у луча
        var fx = Math.sin(car.heading), fz = Math.cos(car.heading), vx = -Math.cos(car.heading), vz = Math.sin(car.heading);
        var ou = rx * fx + rz * fz, ov = rx * vx + rz * vz, du = dx * fx + dz * fz, dv = dx * vx + dz * vz;
        var t0 = -1e9, t1 = 1e9, ok = true;
        [[ou, du, S.L / 2], [ov, dv, S.W / 2]].forEach(function (ax) {
          if (!ok) return;
          if (Math.abs(ax[1]) < 1e-6) { if (Math.abs(ax[0]) > ax[2]) ok = false; return; }
          var a = (-ax[2] - ax[0]) / ax[1], b = (ax[2] - ax[0]) / ax[1];
          if (a > b) { var s = a; a = b; b = s; }
          t0 = Math.max(t0, a); t1 = Math.min(t1, b);
        });
        if (!ok || t0 > t1 || t1 < 0) continue;
        var te = Math.max(0, t0), hy = oy + dy * te, top = S.camH ? Math.max(1.3, S.camH * 0.9) : 1.5;
        if (hy < 0.05 || hy > top) continue;
        if (te < best) { best = te; kind = "car"; bcar = car; bch = null; }
      }
    }
    // здания и земля: шаг 1 м до ближайшего попадания, уточнение делением
    var t = 0, prev = 0, floor = rm != null ? FC.inside.floorY() : 0.05;
    while (t < best) {
      t = Math.min(t + 1, best);
      var x = ox + dx * t, yy = oy + dy * t, z = oz + dz * t;
      if (yy <= floor) { var tg = dy < -1e-6 ? (floor - oy) / dy : t; if (tg < best) { best = Math.max(0, tg); kind = "ground"; bch = bcar = null; } break; }
      if (wallAt(x, yy, z, rm)) {
        var lo = prev, hi = t;
        for (var k = 0; k < 5; k++) { var mid = (lo + hi) / 2; if (wallAt(ox + dx * mid, oy + dy * mid, oz + dz * mid, rm)) hi = mid; else lo = mid; }
        if (hi < best) { best = hi; kind = "wall"; bch = bcar = null; }
        break;
      }
      prev = t;
    }
    HIT.t = best; HIT.kind = kind; HIT.ch = bch; HIT.car = bcar; HIT.head = head;
    HIT.x = ox + dx * best; HIT.y = oy + dy * best; HIT.z = oz + dz * best;
    return HIT;
  }

  /* ---- прицел: направление, камера за плечом, оптика, мягкий захват на тач ------------------------------------ */
  var S = { aimK: 0, adsK: 0, scopeK: 0, scopeOn: false, bloom: 0, recoil: 0, lastShot: -9, soft: null, softSince: 0, heat: 0,
    cd: 0, buf: 0, burst: 0, rl: null, bolt: 0, charge: -1, crimeT: 0, panicT: 0, threatT: 0, swingT: 0, hm: 0 };
  var camDir = new T.Vector3(), tv = new T.Vector3(), tv2 = new T.Vector3();
  function P() { return FC.player; }
  function canFight() {
    var p = P();
    return p && p.mode === "foot" && !p.dead && FC.started && I.enabled && !(FC.hud.inDialog && FC.hud.inDialog());
  }
  // камера за плечом: компьютер с захваченной мышью, огнестрел или бросок, на улице
  function combatCam() { var w = cur(); return canFight() && I.locked && !I.touch && w.id !== "fist" && !w.melee && room() == null; }
  // наклон прицела из наклона камеры fmain (0,32 — по горизонту): вверх до ~36°, вниз до ~68°
  function elev() { return FC.clamp((0.32 - FC.cam.pitch) * 1.35, -1.2, 0.64); }
  function camFwd(out) {
    var yaw = FC.cam.yaw, el = elev();
    out.set(-Math.sin(yaw) * Math.cos(el), Math.sin(el), -Math.cos(yaw) * Math.cos(el));
    return out;
  }
  // направление «взгляда» по земле (без мыши — куда смотрит герой)
  function flatDir() {
    var p = P();
    G.camera.getWorldDirection(camDir);
    var l = Math.hypot(camDir.x, camDir.z);
    if (l < 0.2 || (!I.locked && !I.touch && Math.hypot(p.vx, p.vz) > 0.5)) return { x: Math.sin(p.heading), z: Math.cos(p.heading) };
    return { x: camDir.x / l, z: camDir.z / l };
  }
  // мягкий захват: ближняя видимая цель в конусе, липкая (держим прежнюю, пока она в конусе пошире)
  function pickSoft(w, dir) {
    var p = P(), range = w.range ? w.range[1] : 30, rm = room(), best = null, bs = 1e9;
    var cone = w.cls === "sniper" ? 0.22 : w.cls === "rifle" ? 0.3 : 0.42, keep = S.soft && S.soft.ch;
    var all = FC.people.all;
    for (var i = 0; i < all.length; i++) {
      var c = all[i];
      if (skipChar(c, rm)) continue;
      var dx = c.x - p.x, dz = c.z - p.z, d = Math.hypot(dx, dz);
      if (d > range || d < 0.6) continue;
      var cs = (dx * dir.x + dz * dir.z) / d, lim = Math.cos(c === keep ? cone * 1.6 : cone);
      if (cs < lim) continue;
      var sc = d * (1.7 - cs) - (c === keep ? 6 : 0) - (c.kind === "cop" ? 1 : 0);
      if (sc < bs) { bs = sc; best = { ch: c, x: c.x, y: (c.y || 0.15) + 1.25, z: c.z, d: d }; }
    }
    if (!best && FC.cars && rm == null) {
      FC.cars.list.forEach(function (car) {
        if (car.dead || car.wrecked || car.driver === "player") return;
        var dx = car.x - p.x, dz = car.z - p.z, d = Math.hypot(dx, dz);
        if (d > Math.min(range, 60) || d < 1.5) return;
        var cs = (dx * dir.x + dz * dir.z) / d;
        if (cs < Math.cos(cone * 0.8)) return;
        var sc = d * (1.7 - cs) + 8;
        if (sc < bs) { bs = sc; best = { car: car, x: car.x, y: 0.9, z: car.z, d: d }; }
      });
    }
    if (best && !losClear(p.x, (p.y || 0) + 1.4, p.z, best.x, best.y, best.z)) best = null;
    return best;
  }
  function losClear(ax, ay, az, bx, by, bz) {
    var d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d / 2)), rm = room();
    for (var i = 1; i < n; i++) { var t = i / n; if (wallAt(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t, rm)) return false; }
    return true;
  }
  // куда целимся: {ox, oy, oz, dx, dy, dz} — луч прицела (камера или ствол)
  var AIM = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 1, cam: false };
  function aimRay(w) {
    if (S.aimK > 0.5 || S.scopeK > 0.5) {
      camFwd(tv); AIM.ox = G.camera.position.x; AIM.oy = G.camera.position.y; AIM.oz = G.camera.position.z;
      AIM.dx = tv.x; AIM.dy = tv.y; AIM.dz = tv.z; AIM.cam = true;
      return AIM;
    }
    var h = hand(), dir = flatDir(), t = S.soft;
    AIM.ox = h.x; AIM.oy = h.y; AIM.oz = h.z; AIM.cam = false;
    if (t) {
      var ty = t.ch ? (t.ch.y || 0.15) + (w.cls === "sniper" || w.cls === "revolver" ? 1.6 : 1.2) : t.y;
      var tx = t.ch ? t.ch.x : t.car.x, tz = t.ch ? t.ch.z : t.car.z;
      var dx = tx - h.x, dy = ty - h.y, dz = tz - h.z, l = Math.hypot(dx, dy, dz) || 1;
      AIM.dx = dx / l; AIM.dy = dy / l; AIM.dz = dz / l;
    } else { AIM.dx = dir.x; AIM.dy = 0; AIM.dz = dir.z; }
    return AIM;
  }
  function aimYaw() {
    if (S.aimK > 0.3 || S.scopeK > 0.3) return FC.cam.yaw + Math.PI;
    if (S.soft) { var p = P(), t = S.soft; return Math.atan2((t.ch ? t.ch.x : t.car.x) - p.x, (t.ch ? t.ch.z : t.car.z) - p.z); }
    return P().heading;
  }
  // точка кисти: модуль людей может дать свою (FC.guns.handAnchor), иначе — у правого плеча
  var HAND = { x: 0, y: 0, z: 0 };
  function raised() { return S.aimK > 0.3 || S.scopeK > 0.3 || performance.now() / 1000 - S.lastShot < 1.2 || S.charge >= 0 || !!S.soft; }
  function hand() {
    if (FC.guns.handAnchor && FC.guns.handAnchor(HAND)) return HAND;
    var p = P(), yaw = aimYaw(), up = raised();
    var fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -Math.cos(yaw), rz = Math.sin(yaw);
    // фигурки видов широкие (~1,2 м): ствол — сбоку и чуть впереди, чтобы его было видно из-за плеча
    HAND.x = p.x + rx * 0.58 + fx * (up ? 0.5 : 0.3); HAND.y = (p.y || 0) + (up ? 1.32 : 0.95); HAND.z = p.z + rz * 0.58 + fz * (up ? 0.5 : 0.3);
    return HAND;
  }

  /* ---- урон ------------------------------------------------------------------------------------------------- */
  function falloff(w, d) { return d <= w.range[0] ? 1 : Math.max(0.4, 1 - 0.6 * (d - w.range[0]) / Math.max(1, w.range[1] - w.range[0])); }
  function baseHp(c) { return c.kind === "cop" ? (c.cell === FC.people.SPECIAL.cop2 ? 180 : 130) : 100; }
  function crime(type, x, z, r) { FC.emit("crime", { type: type, x: x, z: z, r: r }); }
  function hitmark(ko) { gxHm.classList.remove("on", "red"); void gxHm.offsetWidth; gxHm.classList.add("on"); if (ko) gxHm.classList.add("red"); }
  function hurtPed(c, w, dmg, dx, dz, head) {
    var now = performance.now();
    if (c._gT && now - c._gT > 8000) c._ghp = null;
    c._gT = now;
    if (c._ghp == null) c._ghp = baseHp(c);
    c._ghp -= dmg;
    var p = P(), ko = c._ghp <= 0;
    burst("dust", c.x, (c.y || 0.15) + (head ? 1.6 : 1.1), c.z, head ? 8 : 5);
    snd("g_hitbody", { x: c.x, z: c.z, vol: 0.7 });
    if (!ko) {
      c.x += dx * 0.12; c.z += dz * 0.12; c.lean = (Math.random() - 0.5) * 0.6;
      setTimeout(function () { c.lean = 0; }, 160);
      if (Math.random() < 0.4) FC.people.say(c, ["Ай!", "А-а!", "Ты чего?!", "Не стреляй!"][(Math.random() * 4) | 0], 1.2, c.kind === "cop" ? "cop" : "");
    } else {
      c._ghp = null;
      var pw = (w.power || 6) * (head ? 1.2 : 1);
      FC.people.hit(c, dx * pw, dz * pw, pw);
      if (head && (w.cls === "sniper" || w.cls === "revolver") && FC.fx && FC.fx.hitstop) FC.fx.hitstop(0.35, 0.22);   // момент для клипа
    }
    if (c.kind !== "cop") FC.people.panic(c.x, c.z, 12, "shot");
    var ct = c.kind === "cop" ? "assault_cop" : w.melee ? "assault" : w.throw ? null : "shooting";
    if (ct) crime(ct, p.x, p.z, w.loud || 30);
    hitmark(ko);
    FC.emit("weapon:hit", { ch: c, dmg: dmg, head: head, ko: ko, id: w.id });
    return ko;
  }
  function hurtCar(car, w, dmg, x, y, z) {
    FC.cars.damage(car, dmg);
    car.lastHit = performance.now();
    burst("sparks", x, y, z, 6);
    snd("g_hitmetal", { x: x, z: z, vol: 0.6 });
    hitmark(false);
    FC.emit("weapon:hit", { car: car, dmg: dmg, id: w.id });
  }
  function impact(h, w) {
    if (h.kind === "wall") { burst("dust", h.x, h.y, h.z, 4); burst("sparks", h.x, h.y, h.z, 2); snd("g_hitwall", { x: h.x, z: h.z, vol: 0.5 }); }
    else if (h.kind === "ground") { burst("dust", h.x, h.y + 0.05, h.z, 3); }
    void w;
  }

  /* ---- выстрел ---------------------------------------------------------------------------------------------- */
  function spreadNow(w) {
    var p = P(), mv = Math.hypot(p.vx, p.vz), ads = S.scopeK > 0.5 || S.adsK > 0.5;
    var base = ads ? w.spread[1] : w.spread[0];
    if (!I.locked || I.touch) base = (w.spread[0] + w.spread[1]) / 2;        // с захватом — середина
    if (S.scopeK > 0.5) base = w.spread[1];
    return base * (1 + Math.min(1.2, mv / 5)) * (p.onGround === false ? 1.8 : 1) + S.bloom;
  }
  var dirV = new T.Vector3(), upV = new T.Vector3(0, 1, 0), sideV = new T.Vector3(), up2 = new T.Vector3();
  function cone(dx, dy, dz, sp) {
    dirV.set(dx, dy, dz).normalize();
    sideV.crossVectors(dirV, upV); if (sideV.lengthSq() < 1e-6) sideV.set(1, 0, 0); sideV.normalize();
    up2.crossVectors(sideV, dirV).normalize();
    var a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * sp;
    dirV.addScaledVector(sideV, Math.cos(a) * r).addScaledVector(up2, Math.sin(a) * r).normalize();
    return dirV;
  }
  function shoot(w) {
    var a = A();
    if (S.rl && !(S.rl.w.perShell && S.rl.loaded > 0)) return;                         // перезаряжаемся
    if (S.rl) S.rl = null;                                                             // дробовик: выстрел прерывает дозарядку
    if ((a.mag[w.id] || 0) <= 0) {
      if (S.cd <= 0) { snd("g_dry", { vol: 0.6 }); S.cd = 0.3; }
      if (WP.reserve(w) > 0) startReload(w);
      else if (S.cd <= 0.31) FC.hud.toast("Нет патронов — купи в Оружейной 🎯", "bad", 1.4);
      return;
    }
    a.mag[w.id]--; FC.dirty();
    var p = P(), ray = aimRay(w), h = hand(), yaw = aimYaw();
    var fx = Math.sin(yaw), fz = Math.cos(yaw);
    var bar = (heldNow && heldNow.userData.barrel) || 0.3;
    var mx = h.x + fx * bar, my = h.y + 0.05, mz = h.z + fz * bar;
    // точка прицела: что под перекрестьем (с камеры) или цель захвата
    var aim0 = raycast(ray.ox, ray.oy, ray.oz, ray.dx, ray.dy, ray.dz, w.range[1], true);
    var tx = aim0.x, ty = aim0.y, tz = aim0.z;
    if (ray.cam && aim0.t < 2.5) { tx = ray.ox + ray.dx * 40; ty = ray.oy + ray.dy * 40; tz = ray.oz + ray.dz * 40; }
    var bx = tx - mx, by = ty - my, bz = tz - mz;
    var sp = spreadNow(w), n = w.pellets || 1, kos = 0, hits = 0;
    if (w.cls === "taser") { taser(w, mx, my, mz, bx, by, bz); }
    else for (var i = 0; i < n; i++) {
      var d = cone(bx, by, bz, sp), hx = d.x, hy = d.y, hz = d.z;
      var hit = raycast(mx, my, mz, hx, hy, hz, w.range[1], true);
      var ex = hit.x, ey = hit.y, ez = hit.z, kind = hit.kind, ch = hit.ch, car = hit.car, head = hit.head, dist = hit.t;
      if (kind === "ped") { hits++; if (hurtPed(ch, w, w.dmg * falloff(w, dist) * (head ? (w.head || 1) : 1), hx, hz, head)) kos++; }
      else if (kind === "car") { hits++; hurtCar(car, w, w.car * falloff(w, dist), ex, ey, ez); }
      else if (kind) impact({ kind: kind, x: ex, y: ey, z: ez }, w);
      if (i < 3 || Math.random() < 0.4) tracer(mx, my, mz, ex, ey, ez, w.cls === "sniper" ? 700 : 360, w.cls === "shotgun" ? 0xffb15a : 0xffd27a);
    }
    void kos; void hits;
    // отдача, разброс, вспышка, гильза, звук, вибрация
    // в оптике кадр увеличен в 6 раз — тот же толчок выглядел бы прыжком на полнеба: делим на зум
    var k = w.kick * (S.scopeK > 0.5 ? 1.8 / (w.scope || 6) : S.adsK > 0.5 ? 0.75 : 1) * rnd(0.85, 1.15);
    if (S.aimK > 0.3 || S.scopeK > 0.3) { FC.cam.pitch -= k; FC.cam.yaw += (Math.random() - 0.5) * k * 0.5; S.recoil += k * 0.6; }
    else FC.cam.shake(Math.min(0.5, k * 2.2));
    S.bloom = Math.min(w.bloomMax || 0.08, S.bloom + (w.bloom || 0));
    S.kick = Math.min(1, (S.kick || 0) + k * 6);
    S.lastShot = performance.now() / 1000;
    if (w.cls !== "taser") {
      muzzleFlash(mx, my, mz, w.cls === "shotgun" || w.cls === "sniper" ? 1.1 : w.cls === "smg" ? 0.55 : w.cls === "pistol" ? 0.6 : 0.8);
      casing(h.x, h.y + 0.05, h.z, -Math.cos(yaw), Math.sin(yaw), w);
    }
    snd(SHOT[w.cls] || "g_pistol", { vol: w.cls === "smg" ? 0.75 : 1 });
    hap(w.cls === "shotgun" || w.cls === "sniper" || w.cls === "revolver" ? "heavy" : w.cls === "rifle" || w.cls === "pistol" ? "medium" : "light");
    if (w.bolt) { S.bolt = 0.18; }
    if (w.cls === "shotgun") setTimeout(function () { snd("g_pump", { vol: 0.8 }); }, 300);
    if (w.heavy) S.heat = 1;
    // слышно на w.loud м: свидетели, паника
    if (S.crimeT <= 0 && w.cls !== "taser") { S.crimeT = 1.5; crime(w.heavy ? "gunfire_heavy" : "gunfire", p.x, p.z, w.loud); }
    if (S.panicT <= 0) { S.panicT = 0.6; FC.people.panic(p.x, p.z, Math.min(70, (w.loud || 30) * 0.7), "shot"); }
    FC.emit("weapon:fire", { id: w.id, x: mx, y: my, z: mz, dx: bx, dy: by, dz: bz });
    if ((a.mag[w.id] || 0) === 0 && WP.reserve(w) > 0) setTimeout(function () { if (cur() === w) startReload(w); }, 250);
    WP.drawPill();
  }
  function taser(w, mx, my, mz, bx, by, bz) {
    var l = Math.hypot(bx, by, bz) || 1, h = raycast(mx, my, mz, bx / l, by / l, bz / l, w.range[1], true);
    wire(mx, my, mz, h.x, h.y, h.z, 0.7);
    snd("g_taser", { vol: 0.9 }); hap("medium");
    if (h.kind === "ped") {
      var c = h.ch, p = P();
      FC.people.hit(c, bx / l * 1.5, bz / l * 1.5, 1);
      c._ghp = null;
      var n = 0, iv = setInterval(function () { burst("sparks", c.x, (c.y || 0.15) + 0.9, c.z, 4); if (++n > 6) clearInterval(iv); }, 160);
      FC.people.say(c, "Бзззт!", 1.2);
      crime(c.kind === "cop" ? "assault_cop" : "assault", p.x, p.z, w.loud);
      hitmark(true);
      FC.emit("weapon:hit", { ch: c, dmg: 0, head: false, ko: true, id: w.id });
    } else if (h.kind === "car") burst("sparks", h.x, h.y, h.z, 8);
  }

  /* ---- перезарядка ------------------------------------------------------------------------------------------ */
  function startReload(w) {
    var a = A();
    if (!w.mag || S.rl || (a.mag[w.id] || 0) >= w.mag || WP.reserve(w) <= 0) return;
    if (w.perShell) S.rl = { w: w, t: 0.3, total: 0.3 + w.reload * Math.min(w.mag - (a.mag[w.id] || 0), WP.reserve(w)), loaded: 0, next: 0.3 };
    else S.rl = { w: w, t: w.reload, total: w.reload, stage: 0 };
    snd(w.cls === "revolver" ? "g_cyl" : "g_magout", { vol: 0.8 });
    FC.emit("weapon:reload", { id: w.id, time: S.rl.total, perShell: !!w.perShell });
    hap("light");
  }
  function stepReload(dt) {
    var r = S.rl; if (!r) return;
    var w = r.w, a = A();
    if (cur() !== w) { S.rl = null; return; }
    r.t -= dt;
    if (w.perShell) {
      r.next -= dt;
      if (r.next <= 0) {
        if ((a.mag[w.id] || 0) < w.mag && (a.ammo[w.id] || 0) > 0) {
          a.mag[w.id] = (a.mag[w.id] || 0) + 1; a.ammo[w.id]--; r.loaded++; snd("g_shell", { vol: 0.8 }); WP.drawPill(); FC.dirty();
          r.next = w.reload;
        }
        if ((a.mag[w.id] || 0) >= w.mag || (a.ammo[w.id] || 0) <= 0) { S.rl = null; snd("g_pump", { vol: 0.8 }); }
      }
      return;
    }
    var k = 1 - r.t / r.total;
    if (r.stage === 0 && k > 0.62) { r.stage = 1; snd(w.cls === "revolver" ? "g_cyl" : "g_magin", { vol: 0.85 }); }
    if (r.t <= 0) {
      var need = w.mag - (a.mag[w.id] || 0), take = Math.min(need, a.ammo[w.id] || 0);
      a.mag[w.id] = (a.mag[w.id] || 0) + take; a.ammo[w.id] -= take; FC.dirty();
      if (w.cls !== "taser") snd("g_rack", { vol: 0.8 });
      S.rl = null; WP.drawPill();
    }
  }

  /* ---- ближний бой ------------------------------------------------------------------------------------------ */
  function swing(w) {
    var p = P(), dir = flatDir(), t = pickSoft({ range: [w.range[1] + 1.5, w.range[1] + 1.5], cls: "melee" }, dir);
    if (t && t.ch) { var hx = t.x - p.x, hz = t.z - p.z, hl = Math.hypot(hx, hz) || 1; dir = { x: hx / hl, z: hz / hl }; p.heading = Math.atan2(dir.x, dir.z); }
    p.ch.lean = -0.5 * (p.ch.face || 1); setTimeout(function () { if (p.ch) p.ch.lean = 0; }, 180);
    snd("g_swing", { vol: w.id === "bat" ? 1 : 0.6 });
    S.swingT = 0.25;
    FC.emit("weapon:swing", { id: w.id });
    var cx = p.x + dir.x * 1.1, cz = p.z + dir.z * 1.1, hit = false, rm = room();
    FC.people.all.forEach(function (c) {
      if (skipChar(c, rm)) return;
      if (Math.hypot(c.x - cx, c.z - cz) < w.range[1] * 0.75) { hurtPed(c, w, w.dmg, dir.x, dir.z, false); hit = true; }
    });
    if (FC.cars && rm == null) {
      var car = FC.cars.nearestTo(cx, cz, w.range[1] + 1.2, function (c) { return c.driver !== "player" && !c.wrecked; });
      if (car) { FC.cars.damage(car, w.car); car.vx += dir.x * 1.5; car.vz += dir.z * 1.5; hit = true; burst("sparks", cx, 1, cz, 10); }
    }
    if (hit) { snd("punch"); FC.cam.shake(0.3); hap("medium"); if (FC.fx && FC.fx.hitstop) FC.fx.hitstop(0.06, 0.2); }
  }

  /* ---- броски: граната и «Факел» ---------------------------------------------------------------------------- */
  function throwVel(w, k, out) {
    var p = P(), yaw = aimYaw(), el;
    // по горизонту — бросок под ~24°: тап ≈ 7 м, полный замах ≈ 30 м (дальше откатывается)
    if (S.aimK > 0.5) { camFwd(tv2); el = FC.clamp(Math.asin(FC.clamp(tv2.y, -0.9, 0.9)) + 0.5, 0.15, 1.1); }
    else if (S.soft) { el = 0.5; k = FC.clamp((Math.sqrt(S.soft.d * 9.8 / Math.sin(2 * el)) - 4.1) / 16.2, 0, 1); }
    else el = 0.45;
    var v = 4.1 + 16.2 * k;
    out.vx = Math.sin(yaw) * Math.cos(el) * v; out.vy = Math.sin(el) * v; out.vz = Math.cos(yaw) * Math.cos(el) * v;
    void p; void w;
    return out;
  }
  var TV = { vx: 0, vy: 0, vz: 0 };
  function drawArc(w, k) {
    var h = hand(); throwVel(w, k, TV);
    var x = h.x, y = h.y, z = h.z, vx = TV.vx, vy = TV.vy, vz = TV.vz, n = 0, rm = room(), dt = 0.06;
    for (var i = 0; i < ARC_N; i++) {
      arcPos[i * 3] = x; arcPos[i * 3 + 1] = y; arcPos[i * 3 + 2] = z; n = i + 1;
      vy -= 9.8 * dt; x += vx * dt; y += vy * dt; z += vz * dt;
      if (y < 0.08 || wallAt(x, y, z, rm)) { arcPos[(i + 1) * 3] = x; arcPos[(i + 1) * 3 + 1] = Math.max(0.08, y); arcPos[(i + 1) * 3 + 2] = z; n = Math.min(ARC_N, i + 2); break; }
    }
    for (var j = 0; j < n; j++) {
      arcO.position.set(arcPos[j * 3], arcPos[j * 3 + 1], arcPos[j * 3 + 2]); arcO.scale.setScalar(1 - j / ARC_N * 0.5); arcO.updateMatrix();
      arcLine.setMatrixAt(j, arcO.matrix);
    }
    arcLine.count = n; arcLine.instanceMatrix.needsUpdate = true; arcLine.visible = true;
    arcEnd.position.set(arcPos[(n - 1) * 3], Math.max(0.12, arcPos[(n - 1) * 3 + 1]), arcPos[(n - 1) * 3 + 2]); arcEnd.scale.setScalar(w.splash / 3.5); arcEnd.visible = true;
  }
  function throwIt(w, k) {
    var a = A();
    if ((a.ammo[w.id] || 0) <= 0) { snd("g_dry"); FC.hud.toast("Кончились — купи в Оружейной 🎯", "bad", 1.4); return; }
    a.ammo[w.id]--; FC.dirty(); WP.drawPill();
    var h = hand(); throwVel(w, k, TV);
    var m = new T.Mesh(projGeo[w.id], projMat[w.id]); m.position.set(h.x, h.y, h.z); G.add(m);
    proj.push({ w: w, m: m, x: h.x, y: h.y, z: h.z, vx: TV.vx, vy: TV.vy, vz: TV.vz, t: w.fuse || 9, bounce: 0 });
    snd(w.id === "grenade" ? "g_pin" : "g_swing", { vol: 0.7 }); snd("whoosh", { vol: 0.5 });
    var p = P(); p.ch.lean = -0.6 * (p.ch.face || 1); setTimeout(function () { if (p.ch) p.ch.lean = 0; }, 220);
    FC.emit("weapon:throw", { id: w.id });
    S.lastShot = performance.now() / 1000;
    if (w.heavy) S.heat = 1;
  }
  function stepProj(dt) {
    var rm = room();
    for (var i = proj.length - 1; i >= 0; i--) {
      var q = proj[i], w = q.w, dead = false, steps = 3;
      for (var s = 0; s < steps && !dead; s++) {
        var h = dt / steps;
        q.vy -= 9.8 * h;
        var nx = q.x + q.vx * h, ny = q.y + q.vy * h, nz = q.z + q.vz * h;
        if (wallAt(nx, ny, nz, rm)) {
          if (w.id === "molotov") { dead = true; break; }
          if (wallAt(nx, q.y, q.z, rm)) q.vx *= -0.45; else q.vz *= -0.45;
          nx = q.x; nz = q.z; q.bounce++;
        }
        var floor = rm != null ? FC.inside.floorY() + 0.07 : 0.1;
        if (ny < floor) {
          if (w.id === "molotov") { ny = floor; dead = true; }
          else { ny = floor; q.vy = Math.abs(q.vy) * 0.3; q.vx *= 0.45; q.vz *= 0.45; if (q.bounce++ < 3 && Math.abs(q.vy) > 1) snd("g_tink", { x: nx, z: nz, vol: 0.6 }); }
        }
        q.x = nx; q.y = ny; q.z = nz;
      }
      q.m.position.set(q.x, q.y, q.z); q.m.rotation.x += dt * 9; q.m.rotation.z += dt * 5;
      if (w.id === "molotov" && Math.random() < 0.5) burst("flame", q.x, q.y + 0.12, q.z, 1);
      q.t -= dt;
      if (dead || q.t <= 0) {
        G.scene.remove(q.m); proj.splice(i, 1);
        if (w.id === "grenade") explode(q.x, Math.max(q.y, 0.2), q.z, w); else ignite(q.x, q.z, w);
      }
    }
  }
  function explode(x, y, z, w) {
    var p = P(), pd = Math.hypot(p.x - x, p.z - z);
    snd("g_boom", { x: x, z: z, vol: 1 }); snd("explosion", { x: x, z: z, vol: 0.6 });
    burst("sparks", x, y + 0.3, z, 70); burst("smoke", x, y, z, 22); burst("debris", x, y, z, 26); burst("dust", x, 0.3, z, 20);
    if (FC.fx) { FC.fx.flash("rgba(255,210,150,.6)", Math.max(0.15, 0.7 - pd / 80)); if (FC.fx.hitstop) FC.fx.hitstop(0.12, 0.3); }
    if (light) { light.position.set(x, y + 1, z); light.intensity = 30; lightT = 0.15; }
    FC.cam.shake(Math.max(0.15, 1.1 - pd / 35));
    if (pd < 40) hap("heavy");
    var wv = new T.Mesh(waveGeo, new T.MeshBasicMaterial({ color: 0xffe0b0, transparent: true, opacity: 0.8, blending: T.AdditiveBlending, depthWrite: false }));
    wv.position.set(x, 0.15, z); G.add(wv); waves.push({ m: wv, t: 0, r: w.splash * 2.2 });
    var rm = room();
    FC.people.all.forEach(function (c) {
      if (skipChar(c, rm)) return;
      var dx = c.x - x, dz = c.z - z, d = Math.hypot(dx, dz);
      if (d < w.splash && losClear(x, y + 0.5, z, c.x, (c.y || 0) + 1, c.z)) {
        var k = 1 - d / w.splash;
        hurtPed(c, w, w.dmg * (0.4 + k), dx / (d || 1), dz / (d || 1), false);
        if (c.knocked > 0) { c.vy = 4 + k * 5; c.vx += dx / (d || 1) * k * 8; c.vz += dz / (d || 1) * k * 8; }
      }
    });
    if (FC.cars && rm == null) FC.cars.list.forEach(function (car) {
      var dx = car.x - x, dz = car.z - z, d = Math.hypot(dx, dz);
      if (d < w.splash + 2 && car.driver !== "player") { FC.cars.damage(car, w.car * (1 - d / (w.splash + 3))); car.vx += dx / (d || 1) * 9; car.vz += dz / (d || 1) * 9; }
    });
    if (pd < w.splash * 0.8 && p.mode === "foot") p.damage(70 * (1 - pd / w.splash), "blast");
    crime("explosion", x, z, w.loud);
    FC.people.panic(x, z, 60, "boom");
    FC.emit("weapon:explode", { id: w.id, x: x, y: y, z: z });
  }
  function ignite(x, z, w) {
    snd("g_glass", { x: x, z: z, vol: 0.9 }); snd("g_fire", { x: x, z: z, vol: 0.9 });
    burst("flame", x, 0.4, z, 30); burst("smoke", x, 0.5, z, 8);
    var rm = room(), floor = rm != null ? FC.inside.floorY() + 0.03 : 0.08;
    var g = new T.Mesh(fireGeo, new T.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.55, blending: T.AdditiveBlending, depthWrite: false }));
    g.position.set(x, floor, z); g.scale.setScalar(w.splash); G.add(g);
    fires.push({ x: x, z: z, r: w.splash, t: w.fire, m: g, w: w, tick: 0 });
    var p = P();
    crime("arson", p.x, p.z, w.loud);
    FC.people.panic(x, z, 30, "boom");
  }
  function stepFires(dt) {
    var p = P(), rm = room();
    for (var i = fires.length - 1; i >= 0; i--) {
      var f = fires[i];
      f.t -= dt; f.tick -= dt;
      var k = Math.min(1, f.t / 1.5);
      f.m.material.opacity = 0.35 + Math.sin(performance.now() / 70 + i) * 0.12 * k + 0.15 * k;
      for (var n = 0; n < (G.Q.level === "low" ? 1 : 3); n++) {
        var a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * f.r;
        burst("flame", f.x + Math.cos(a) * r, 0.2, f.z + Math.sin(a) * r, 1);
      }
      if (Math.random() < 0.3) burst("smoke", f.x, 1, f.z, 1);
      if (f.tick <= 0) {
        f.tick = 0.4;
        FC.people.all.forEach(function (c) {
          if (skipChar(c, rm)) return;
          if (Math.hypot(c.x - f.x, c.z - f.z) < f.r) hurtPed(c, f.w, f.w.dmg, c.x - f.x, c.z - f.z, false);
        });
        if (FC.cars && rm == null) FC.cars.list.forEach(function (car) {
          if (car.dead || Math.hypot(car.x - f.x, car.z - f.z) > f.r + car.spec.L / 2) return;
          FC.cars.damage(car, f.w.car * 0.4); car.burnT = Math.max(car.burnT || 0, 2);
        });
        if (p.mode === "foot" && Math.hypot(p.x - f.x, p.z - f.z) < f.r) p.damage(10, "fire");
      }
      if (f.t <= 0) { G.scene.remove(f.m); fires.splice(i, 1); }
    }
    for (var j = waves.length - 1; j >= 0; j--) {
      var wv = waves[j]; wv.t += dt;
      var kk = wv.t / 0.45;
      wv.m.scale.setScalar(0.5 + kk * wv.r); wv.m.material.opacity = Math.max(0, 0.8 * (1 - kk));
      if (kk >= 1) { G.scene.remove(wv.m); waves.splice(j, 1); }
    }
  }

  /* ---- колесо оружия: зажать 🔫 (тач) или T (клавиатура); время замедляется ---------------------------------- */
  var wheel = document.createElement("div"); wheel.className = "gwheel"; wheel.innerHTML = "<div class='gwring'><div class='gwmid'></div></div>";
  document.body.appendChild(wheel);
  var ring = wheel.firstChild, mid = ring.querySelector(".gwmid"), segs = [], hot = -1, wheelOn = false, vcur = { x: 0, y: 0 };
  function openWheel() {
    if (wheelOn || !canFight()) return;
    var l = WP.owned();
    ring.querySelectorAll(".gwseg").forEach(function (e) { e.remove(); });
    segs = l.map(function (w, i) {
      var a = -Math.PI / 2 + i / l.length * Math.PI * 2, e = document.createElement("div");
      e.className = "gwseg" + (w === cur() ? " cur" : "");
      e.style.left = (50 + Math.cos(a) * 38) + "%"; e.style.top = (50 + Math.sin(a) * 38) + "%";
      var am = w.maxAmmo ? (w.mag ? WP.mag(w) + "/" : "") + WP.reserve(w) : "";
      e.innerHTML = "<b>" + w.icon + "</b>" + FC.hud.esc(w.name.replace(/ «.*»/, "")) + (am ? "<i>" + am + "</i>" : "");
      e.dataset.id = w.id; e.dataset.a = a;
      ring.appendChild(e);
      return e;
    });
    hot = segs.indexOf(segs.filter(function (e) { return e.dataset.id === cur().id; })[0]);
    vcur.x = vcur.y = 0;
    wheel.classList.add("on"); wheelOn = true; markHot();
    snd("blip", { vol: 0.4 });
  }
  function markHot() {
    segs.forEach(function (e, i) { e.classList.toggle("hot", i === hot); });
    var w = hot >= 0 ? WP.W[segs[hot].dataset.id] : cur();
    mid.innerHTML = w.icon + " " + FC.hud.esc(w.name) + "<small>" + FC.hud.esc(w.sub || "") + "</small>";
  }
  function pointWheel(dx, dy) {
    if (Math.hypot(dx, dy) < 18 || !segs.length) return;
    var a = Math.atan2(dy, dx), best = -1, bd = 9;
    segs.forEach(function (e, i) { var d = Math.abs(FC.angWrap(a - +e.dataset.a)); if (d < bd) { bd = d; best = i; } });
    if (best !== hot) { hot = best; markHot(); hap("light"); }
  }
  function closeWheel(pick) {
    if (!wheelOn) return;
    wheel.classList.remove("on"); wheelOn = false;
    if (pick && hot >= 0) WP.select(segs[hot].dataset.id);
  }
  wheel.addEventListener("pointermove", function (e) {
    var r = ring.getBoundingClientRect(); pointWheel(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
  });
  wheel.addEventListener("click", function (e) {
    var s = e.target.closest(".gwseg");
    if (s) { hot = segs.indexOf(s); closeWheel(true); } else closeWheel(false);
  });
  global.addEventListener("mousemove", function (e) {
    if (!wheelOn || !I.locked) return;
    vcur.x += e.movementX || 0; vcur.y += e.movementY || 0;
    var l = Math.hypot(vcur.x, vcur.y); if (l > 120) { vcur.x *= 120 / l; vcur.y *= 120 / l; }
    pointWheel(vcur.x, vcur.y);
  });
  global.addEventListener("keydown", function (e) {
    if (e.repeat || !I.enabled) return;
    if (e.code === "KeyT") openWheel();
    if (e.code === "KeyB" && cur().id === "rifle") FC.hud.toast("Автомат: тап — очередь по 3, держи — авто", "", 2);
  });
  global.addEventListener("keyup", function (e) { if (e.code === "KeyT") closeWheel(true); });

  /* ---- кнопки тача: 🔫 (тап — прошлое оружие, держать — колесо), ⟳ перезарядка, 🔭 оптика ------------------------ */
  var tb = {};
  function touchButtons() {
    if (tb.wpn || !document.body.classList.contains("touch")) return;
    function mk(cls, label, onDown, onUp) {
      var b = document.createElement("button"); b.type = "button"; b.className = "tbtn " + cls; b.textContent = label; b.style.display = "none";
      b.addEventListener("touchstart", function (e) { e.preventDefault(); e.stopPropagation(); b.classList.add("on"); onDown(e); }, { passive: false });
      b.addEventListener("touchmove", function (e) { e.preventDefault(); if (b._move) b._move(e); }, { passive: false });
      b.addEventListener("touchend", function (e) { e.preventDefault(); b.classList.remove("on"); if (onUp) onUp(e); }, { passive: false });
      document.body.appendChild(b); return b;
    }
    var holdT = null, t0 = { x: 0, y: 0 };
    tb.wpn = mk("b-wpn", "🔫", function (e) {
      var t = e.changedTouches[0]; t0.x = t.clientX; t0.y = t.clientY;
      holdT = setTimeout(function () { holdT = null; openWheel(); }, 230);
    }, function () {
      if (holdT) { clearTimeout(holdT); holdT = null; WP.swapPrev(); } else closeWheel(true);
    });
    tb.wpn._move = function (e) {
      if (!wheelOn) return;
      var t = e.changedTouches[0], r = ring.getBoundingClientRect();
      pointWheel(t.clientX - (r.left + r.width / 2), t.clientY - (r.top + r.height / 2));
      void t0;
    };
    tb.rel = mk("b-rel", "⟳", function () { startReload(cur()); });
    tb.scope = mk("b-scope", "🔭", function () { S.scopeOn = !S.scopeOn; tb.scope.classList.toggle("hot", S.scopeOn); });
  }
  FC.on("input:touch", function () { setTimeout(touchButtons, 0); });
  var btnKey = "";
  function syncButtons() {
    var w = cur(), p = P(), foot = p && p.mode === "foot" && !p.dead, key = w.id + "|" + foot + "|" + WP.owned().length + "|" + (w.mag ? WP.mag(w) < w.mag && WP.reserve(w) > 0 : 0);
    if (key === btnKey) return;
    btnKey = key;
    I.setButton("punch", { label: !foot ? "👊" : w.icon });
    if (!tb.wpn) return;
    tb.wpn.style.display = foot && WP.owned().length > 1 ? "" : "none";
    tb.wpn.textContent = w.id === "fist" ? "🔫" : w.icon;
    tb.rel.style.display = foot && w.mag && WP.mag(w) < w.mag && WP.reserve(w) > 0 ? "" : "none";
    tb.scope.style.display = foot && w.scope ? "" : "none";
    if (!w.scope && S.scopeOn) { S.scopeOn = false; tb.scope.classList.remove("hot"); }
  }

  /* ---- обзор: в оптике и при прицеливании мышь/палец медленнее ------------------------------------------------ */
  var takeLook0 = I.takeLook;
  I.takeLook = function () {
    var r = takeLook0();
    var k = wheelOn ? 0 : S.scopeK > 0.5 ? 1 / ((cur().scope || 6) * 0.55) : S.adsK > 0.5 ? 0.7 : 1;
    r.x *= k; r.y *= k;
    return r;
  };

  /* ---- кадр: ввод и огонь (до игрока, чтобы перехватить удар рукой) ------------------------------------------- */
  function numberKeys() {
    var l = WP.owned();
    for (var k = 1; k <= 9; k++) if (I.pressed("d" + k) && l[k - 1]) { WP.select(l[k - 1].id); S.rl = null; }
  }
  function update(dt) {
    var p = P(); if (!p || !FC.started) return;
    defineSounds();
    var w = cur();
    S.cd -= dt; S.crimeT -= dt; S.panicT -= dt; S.threatT -= dt; S.swingT -= dt;
    S.bloom *= Math.exp(-5 * dt); S.kick = (S.kick || 0) * Math.exp(-12 * dt);
    S.heat = Math.max(0, S.heat - dt / 60);
    if (S.recoil > 0) { var back = Math.min(S.recoil, S.recoil * 9 * dt + 0.0005); FC.cam.pitch += back; S.recoil -= back; }
    if (S.bolt > 0) { S.bolt -= dt; if (S.bolt <= 0) snd("g_bolt", { vol: 0.8 }); }
    numberKeys();
    stepReload(dt);
    if (wheelOn && FC.fx && FC.fx.hitstop) FC.fx.hitstop(0.08, 0.3);                     // колесо: время замедляется
    var fight = canFight() && !(WP.stunned && WP.stunned());
    // мягкий захват — на тач и без захвата мыши
    if (fight && w.id !== "fist" && !(I.locked && !I.touch) && S.scopeK < 0.5) {
      var s = pickSoft(w, flatDir());
      if ((s && s.ch) !== (S.soft && S.soft.ch) || (s && s.car) !== (S.soft && S.soft.car)) S.softSince = performance.now();
      S.soft = s;
    } else S.soft = null;
    // в оптике — стоим
    if (S.scopeK > 0.5) { I.mx = 0; I.mz = 0; }
    if (I.pressed("radio") && p.mode === "foot") startReload(w);
    if (!fight || w.id === "fist") { S.buf = 0; S.burst = 0; if (S.charge >= 0) { S.charge = -1; arcLine.visible = arcEnd.visible = false; } return; }
    // с оружием удар рукой не нужен: нажатие — наше
    var press = I.pressed("punch"), hold = I.held("punch");
    I.consume("punch");
    if (w.throw) {
      // тап — короткий бросок, держишь — дальше
      if ((hold || press) && (A().ammo[w.id] || 0) > 0) { S.charge = Math.min(1, Math.max(0, S.charge) + dt * 1.25); drawArc(w, 0.35 + S.charge * 0.65); }
      else if (S.charge >= 0) { throwIt(w, 0.35 + S.charge * 0.65); S.charge = -1; arcLine.visible = arcEnd.visible = false; }
      else if (press) { snd("g_dry"); FC.hud.toast("Кончились — купи в Оружейной 🎯", "bad", 1.4); }
      return;
    }
    if (press) S.buf = 0.25;
    S.buf -= dt;
    if (w.melee) {
      if (S.buf > 0 && S.cd <= 0) { S.cd = 1 / w.rof; S.buf = 0; swing(w); }
      return;
    }
    if (press && w.burst) S.burst = w.burst;
    var want = (w.auto && hold) || S.buf > 0 || S.burst > 0;
    if (want && S.cd <= 0 && S.bolt <= 0) {
      S.cd = 1 / w.rof; S.buf = 0; if (S.burst > 0) S.burst--;
      shoot(w);
    }
    // навёл ствол на патрульного
    if (S.soft && S.soft.ch && S.soft.ch.kind === "cop" && S.soft.d < 25 && performance.now() - S.softSince > 1500 && S.threatT <= 0) {
      S.threatT = 15; crime("threat_cop", p.x, p.z, 25);
    }
  }

  /* ---- после игрока: разворот к прицелу, скрыть героя в оптике -------------------------------------------- */
  function pose() {
    var p = P(); if (!p || !FC.started || p.mode !== "foot" || p.dead) return;
    var w = cur();
    if (w.id !== "fist" && (S.aimK > 0.3 || S.scopeK > 0.3 || (raised() && !w.melee))) p.heading = aimYaw();
    if (S.scopeK > 0.6 && p.ch) p.ch.visible = false;
  }

  /* ---- камера за плечом и оптика (после камеры fmain: подменяем её кадр, плавно) ------------------------------ */
  var look = new T.Vector3(), camT = new T.Vector3(), eye = new T.Vector3(), fovSet = false;
  function aimCam(dt) {
    var p = P(), w = cur(); if (!p) return;
    var combat = combatCam(), ads = combat && I.held("aim");
    var scoped = canFight() && !!w.scope && (ads || (I.touch && S.scopeOn)) && room() == null;
    S.aimK = FC.damp(S.aimK, combat || scoped ? 1 : 0, 10, dt);
    S.adsK = FC.damp(S.adsK, ads ? 1 : 0, 12, dt);
    S.scopeK = FC.damp(S.scopeK, scoped ? 1 : 0, 16, dt);
    if (S.aimK < 0.004 && S.scopeK < 0.004) { if (fovSet) { G.camera.fov = FC.cam.fov; G.camera.updateProjectionMatrix(); fovSet = false; } return; }
    var yaw = FC.cam.yaw, el = elev(), t = performance.now() / 1000;
    if (S.scopeK > 0.5) { yaw += Math.sin(t * 0.9) * 0.0022; el += Math.sin(t * 1.3 + 1) * 0.0018; }
    var fx = -Math.sin(yaw) * Math.cos(el), fy = Math.sin(el), fz = -Math.cos(yaw) * Math.cos(el);
    var rx = Math.cos(yaw), rz = -Math.sin(yaw), py = p.y || 0;
    // герой — в левой трети кадра (фигура ~1,2 м в ширину): плечо 1 м вправо, камера 4,3 м (прицел — 2,9 м)
    var dist = 4.3 - 1.4 * S.adsK, sh = 1.05 - 0.15 * S.adsK;
    var sx = p.x + rx * sh, sy = py + 1.85, sz = p.z + rz * sh;
    // по высоте камера ходит вдвое меньше взгляда и не ниже 0,6 м над землёй
    var cx = sx - fx * dist, cy = Math.max(py + 0.6, sy - fy * dist * 0.5 + 0.15), cz = sz - fz * dist;
    for (var k = 1; k <= 8; k++) {
      var f = k / 8;
      if (wallAt(sx + (cx - sx) * f, sy + (cy - sy) * f, sz + (cz - sz) * f, null)) { var f2 = Math.max(0.12, f - 0.15); cx = sx + (cx - sx) * f2; cy = sy + (cy - sy) * f2; cz = sz + (cz - sz) * f2; break; }
    }
    camT.set(cx, cy, cz);
    if (S.scopeK > 0.001) { eye.set(p.x + fx * 0.35, py + 1.66, p.z + fz * 0.35); camT.lerp(eye, S.scopeK); }
    var mix = Math.max(S.aimK, S.scopeK);
    look.copy(G.focus || camT).lerp(tv.set(camT.x + fx * 40, camT.y + fy * 40, camT.z + fz * 40), mix);
    G.camera.position.lerp(camT, mix);
    G.camera.lookAt(look);
    var zoom = 1 + ((w.scope || 1) - 1) * S.scopeK;
    G.camera.fov = FC.cam.fov * (1 - 0.16 * S.adsK) / zoom; G.camera.updateProjectionMatrix(); fovSet = true;
  }

  /* ---- эффекты кадра и прицел на экране -------------------------------------------------------------------- */
  var o3 = new T.Object3D(), col = new T.Color();
  function stepFx(dt) {
    flashes.forEach(function (f) { if (f.fresh) { f.fresh = false; return; } if (f.t > 0) { f.t -= dt; if (f.t <= 0) f.s.visible = false; } });
    if (light && lightFresh) lightFresh = false;
    else if (light && lightT > 0) { lightT -= dt; if (lightT <= 0) light.intensity = 0; }
    var n = 0;
    for (var i = tracers.length - 1; i >= 0; i--) {
      var tr = tracers[i];
      if (tr.fresh) { tr.fresh = false; continue; }
      tr.s += tr.v * dt;
      if (tr.s - 7 > tr.d) { tracers.splice(i, 1); continue; }
    }
    for (var j = 0; j < tracers.length && n < TRMAX; j++) {
      var q = tracers[j], head = Math.min(q.s, q.d), tail = Math.max(0, q.s - 7), len = head - tail;
      if (len <= 0.05) continue;
      o3.position.set(q.ax + q.dx * head, q.ay + q.dy * head, q.az + q.dz * head);
      o3.lookAt(q.ax + q.dx * (head + 1), q.ay + q.dy * (head + 1), q.az + q.dz * (head + 1));
      o3.scale.set(0.035, 0.035, len); o3.updateMatrix();
      trMesh.setMatrixAt(n, o3.matrix); trMesh.setColorAt(n, col.setHex(q.hex).multiplyScalar(1.4)); n++;
    }
    trMesh.count = n; trMesh.instanceMatrix.needsUpdate = true; if (trMesh.instanceColor) trMesh.instanceColor.needsUpdate = true;
    // гильзы
    var m = 0, rm = room(), floor = rm != null ? FC.inside.floorY() + 0.02 : 0.06;
    for (var c = casings.length - 1; c >= 0; c--) {
      var g = casings[c]; g.t += dt;
      if (g.t > 6) { casings.splice(c, 1); continue; }
      if (!g.rest) {
        g.vy -= 14 * dt; g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt; g.rx += g.sx * dt; g.rz += g.sz * dt;
        if (g.y < floor) {
          g.y = floor; g.vy = -g.vy * 0.35; g.vx *= 0.5; g.vz *= 0.5; g.sx *= 0.5; g.sz *= 0.5;
          if (g.bounced++ === 0) snd("g_tink", { x: g.x, z: g.z, vol: 0.5 });
          if (Math.abs(g.vy) < 0.4) { g.rest = true; g.rx = Math.PI / 2; }
        }
      }
    }
    for (var cc = 0; cc < casings.length; cc++) {
      var h = casings[cc];
      o3.position.set(h.x, h.y + h.r, h.z); o3.rotation.set(h.rx, 0, h.rz); o3.scale.set(h.r, h.l, h.r); o3.updateMatrix();
      cMesh.setMatrixAt(m, o3.matrix); cMesh.setColorAt(m, col.setHex(h.hex)); m++;
    }
    cMesh.count = m; cMesh.instanceMatrix.needsUpdate = true; if (cMesh.instanceColor) cMesh.instanceColor.needsUpdate = true;
    for (var wi = wires.length - 1; wi >= 0; wi--) {
      wires[wi].t -= dt; wires[wi].m.visible = Math.random() > 0.15;
      if (wires[wi].t <= 0) { G.scene.remove(wires[wi].m); wires.splice(wi, 1); }
    }
  }
  var heldId = null, holdLift = 0;
  function stepHeld(dt) {
    var p = P(), w = cur();
    var show = p && p.mode === "foot" && !p.dead && w.id !== "fist" && S.scopeK < 0.6;
    if (heldId !== w.id) { if (heldNow) heldNow.visible = false; heldNow = w.id !== "fist" ? modelOf(w.id) : null; heldId = w.id; if (heldNow) heldNow.visible = true; }
    holder.visible = !!(show && heldNow && !(S.charge < 0 && w.throw && (A().ammo[w.id] || 0) <= 0));
    if (!holder.visible) return;
    var h = hand(), yaw = aimYaw(), up = raised();
    holdLift = FC.damp(holdLift, up ? 1 : 0, 10, dt);
    var el = up ? (S.aimK > 0.3 ? elev() : AIM.dy ? Math.asin(FC.clamp(AIM.dy, -0.9, 0.9)) : 0) : -0.9;
    var rl = S.rl ? Math.sin(Math.min(1, 1 - S.rl.t / S.rl.total) * Math.PI) * 0.9 : 0;       // перезарядка: ствол вниз и вбок
    holder.position.set(h.x, h.y, h.z);
    holder.rotation.order = "YXZ";
    holder.rotation.z = 0;
    holder.rotation.y = yaw + rl * 0.5;
    holder.rotation.x = -(el * holdLift - 0.9 * (1 - holdLift)) + rl * 0.6 - (S.kick || 0) * 0.35;
    if (w.melee && S.swingT > 0) holder.rotation.x -= Math.sin(S.swingT / 0.25 * Math.PI) * 1.6;
    holder.position.x -= Math.sin(yaw) * (S.kick || 0) * 0.05; holder.position.z -= Math.cos(yaw) * (S.kick || 0) * 0.05;
  }
  function drawCross() {
    var p = P(), w = cur();
    var show = canFight() && w.id !== "fist" && !w.melee && S.scopeK < 0.5 && !wheelOn;
    gx.classList.toggle("on", !!show);
    scopeEl.classList.toggle("on", S.scopeK > 0.5);
    if (S.scopeK > 0.5) {
      var r = raycast(G.camera.position.x, G.camera.position.y, G.camera.position.z, camFwd(tv).x, tv.y, tv.z, w.range ? w.range[1] : 300, true);
      scopeTxt.textContent = (r.kind ? Math.round(r.t) + " м" : "—") + (r.kind === "ped" ? (r.head ? " · голова" : " · цель") : "");
    }
    if (!show) return;
    var x, y;
    if (S.aimK > 0.5) { x = global.innerWidth / 2; y = global.innerHeight / 2; }
    else {
      var t = S.soft;
      if (t) tv.set(t.ch ? t.ch.x : t.car.x, t.ch ? (t.ch.y || 0.15) + 1.2 : 0.9, t.ch ? t.ch.z : t.car.z);
      else { var d = flatDir(), rr = w.range ? Math.min(w.range[0], 22) : 12; tv.set(p.x + d.x * rr, (p.y || 0) + 1.3, p.z + d.z * rr); }
      tv.project(G.camera);
      x = (tv.x + 1) / 2 * global.innerWidth; y = (1 - tv.y) / 2 * global.innerHeight;
      if (gx._x != null) { x = gx._x + (x - gx._x) * 0.35; y = gx._y + (y - gx._y) * 0.35; }
    }
    gx._x = x; gx._y = y;
    gx.style.transform = "translate(" + x.toFixed(1) + "px," + y.toFixed(1) + "px)";
    gx.classList.toggle("lock", !!S.soft);
    // зазор прицела — по разбросу (в пикселях на расстоянии 1 м по полю зрения)
    var gap = w.throw ? 6 : 4 + spreadNow(w) / Math.tan((G.camera.fov * Math.PI / 180) / 2) * global.innerHeight / 2 * 0.9;
    gap = Math.min(60, gap);
    gxT.style.top = (-gap - 8) + "px"; gxB.style.top = gap + "px"; gxL.style.left = (-gap - 8) + "px"; gxR.style.left = gap + "px";
    var r2 = S.rl;
    gx.classList.toggle("rl", !!r2);
    if (r2) gxRp.setAttribute("stroke-dashoffset", (100.5 * (1 - FC.clamp(1 - r2.t / r2.total, 0, 1))).toFixed(1));
    gxArc.textContent = w.throw ? (S.charge >= 0 ? "бросок " + Math.round((0.35 + S.charge * 0.65) * 100) + "%" : "держи — дуга") : "";
  }

  FC.addSystem({ name: "guns", order: 9, init: function () { defineSounds(); touchButtons(); }, update: update });

  /* ---- «Руки вверх»: наставил ствол — прохожие впереди (конус ~35°, до 14 м) поднимают руки и замирают (поза surrender у людей,
     fhumans: ch.hands), через 2–4 с убегают от тебя. Опрос 4 раза в секунду, без аллокаций. Тот же флаг — у продавца при
     ограблении кассы (fheist). */
  var huT = 0;
  function handsUp(ch, sec) { ch.hands = true; ch.handsT = sec; ch.pause = sec; ch.flee = 0; ch.talk = null; }
  FC.guns_handsUp = handsUp;
  FC.addSystem({
    name: "handsup", order: 31,
    update: function (dt) {
      huT -= dt; if (huT > 0) return; huT = 0.25;
      var peds = FC.people && FC.people.peds, P = FC.player; if (!peds || !P) return;
      var w = cur(), armed = P.mode === "foot" && w && !w.melee && w.cls !== "taser";
      var hx = Math.sin(P.heading), hz = Math.cos(P.heading);
      for (var i = 0; i < peds.length; i++) {
        var ch = peds[i];
        if (ch.handsT > 0) {
          ch.handsT -= 0.25;
          if (ch.handsT <= 0) {                                   // опустил руки — и бежать
            ch.hands = false; ch.pause = 0;
            var d0 = Math.hypot(ch.x - P.x, ch.z - P.z) || 1;
            ch.flee = 4 + Math.random() * 3; ch.fx = (ch.x - P.x) / d0; ch.fz = (ch.z - P.z) / d0;
          }
          continue;
        }
        if (!armed || ch.knocked > 0 || ch.kind === "cop") continue;
        var dx = ch.x - P.x, dz = ch.z - P.z, d = Math.hypot(dx, dz);
        if (d > 14 || d < 0.5) continue;
        if ((dx * hx + dz * hz) / d < 0.82) continue;
        handsUp(ch, 2 + Math.random() * 2);
        if (FC.people.say && Math.random() < 0.35) FC.people.say(ch, ["Не стреляй!", "Всё отдам!", "Спокойно, спокойно…", "Я ничего не видел!"][Math.floor(Math.random() * 4)], 1.6);
      }
    }
  });
  FC.addSystem({ name: "gunpose", order: 11, update: pose });
  FC.addSystem({ name: "gunfx", order: 93, update: function (dt) { if (!FC.started) return; stepProj(dt); stepFires(dt); stepFx(dt); stepHeld(dt); syncButtons(); } });
  FC.addSystem({ name: "aimcam", order: 96, update: function (dt) { if (!FC.started) return; aimCam(dt); drawCross(); } });
  FC.on("weapon:equip", function () { S.rl = null; S.charge = -1; S.burst = 0; arcLine.visible = arcEnd.visible = false; btnKey = ""; });
  FC.on("busted", function () { S.rl = null; S.scopeOn = false; });

  FC.guns = {
    raycast: raycast, reload: function () { startReload(cur()); }, heat: function () { return S.heat; },
    aiming: function () { return S.aimK > 0.5 || S.scopeK > 0.5; }, scoped: function () { return S.scopeK > 0.5; },
    openWheel: openWheel, closeWheel: closeWheel, handAnchor: null, state: S, held: holder, flying: function () { return proj.length; },
    // отладка: FC.guns.test("rifle") — выдать и взять в руки с запасом патронов
    test: function (id) { WP.give(id, 999); var w = WP.W[id]; if (w && w.mag) { A().mag[id] = w.mag; } WP.select(id); WP.drawPill(); }
  };
})(window);
