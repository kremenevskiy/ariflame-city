/* Флейм-Сити — «сочность»: линии скорости, стоп-кадр и замедление, вспышки экрана, частицы (пыль, искры, дым,
 * обломки, конфетти, пламя), всплывающие очки трюков, виньетка раненого.
 *
 * Задача: «не хватает динамики». Контракт для модулей (звать с проверкой FC.fx):
 *   FC.fx.speed(k 0..1)                — линии скорости на этот кадр (гаснут сами, если не звать)
 *   FC.fx.hitstop(сек, масштаб)        — стоп-кадр/замедление: цикл fmain множит dt на FC.fx.timeScale()
 *   FC.fx.flash(css-цвет, сила 0..1)   — вспышка экрана
 *   FC.fx.burst(x, y, z, вид, n)       — частицы: dust | sparks | smoke | debris | confetti | flame | cash | water
 *   FC.hud.popup(текст, {color, big})  — всплывающая надпись трюка/находки
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE, G = FC.gfx;

  FC.css([
    "#fx-lines{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:3}",
    "#fx-flash{position:fixed;inset:0;pointer-events:none;z-index:4;opacity:0}",
    "#fx-vig{position:fixed;inset:0;pointer-events:none;z-index:3;opacity:0;transition:opacity .4s;",
    "  background:radial-gradient(ellipse at center,rgba(0,0,0,0) 55%,rgba(170,0,20,.55) 100%)}",
    ".fx-pops{position:fixed;left:50%;top:58%;transform:translateX(-50%);display:flex;flex-direction:column-reverse;",
    "  align-items:center;gap:4px;pointer-events:none;z-index:6}",
    ".fx-pop{font:900 italic 22px/1 system-ui,sans-serif;color:#ffcf7a;letter-spacing:.02em;white-space:nowrap;",
    "  text-shadow:0 2px 0 rgba(0,0,0,.55),0 0 14px rgba(0,0,0,.45);animation:fxpop 1.6s ease-out forwards}",
    ".fx-pop.big{font-size:34px}",
    "@keyframes fxpop{0%{opacity:0;transform:scale(1.8)}12%{opacity:1;transform:scale(1)}75%{opacity:1;transform:translateY(-18px)}",
    "  100%{opacity:0;transform:translateY(-40px)}}"
  ].join("\n"));

  /* ---- линии скорости: 2D-холст поверх сцены, лучи от центра -------------------------------------------- */
  var lc = document.createElement("canvas"); lc.id = "fx-lines"; document.body.appendChild(lc);
  var lx = lc.getContext("2d");
  var streaks = [];
  for (var i = 0; i < 48; i++) streaks.push({ a: Math.random() * Math.PI * 2, r: Math.random(), v: 0.6 + Math.random() * 0.9, w: 1 + Math.random() * 2 });
  var speedWant = 0, speedNow = 0;
  function drawLines(dt) {
    speedNow = FC.damp(speedNow, speedWant, speedWant > speedNow ? 10 : 4, dt);
    speedWant = 0;
    var W = global.innerWidth, H = global.innerHeight, dpr = Math.min(global.devicePixelRatio || 1, 1.5);
    if (lc.width !== Math.round(W * dpr * 0.5)) { lc.width = Math.round(W * dpr * 0.5); lc.height = Math.round(H * dpr * 0.5); }
    var cw = lc.width, ch = lc.height;
    lx.clearRect(0, 0, cw, ch);
    if (speedNow < 0.03) return;
    var cx = cw / 2, cy = ch * 0.46, R = Math.hypot(cw, ch) * 0.55;
    lx.lineCap = "round";
    for (var j = 0; j < streaks.length; j++) {
      var s = streaks[j];
      s.r += dt * s.v * (1.2 + speedNow * 2.4);
      if (s.r > 1) { s.r = 0.25 + Math.random() * 0.2; s.a = Math.random() * Math.PI * 2; }
      var r0 = R * (0.35 + s.r * 0.65), r1 = r0 + R * 0.08 * (0.5 + speedNow);
      var ca = Math.cos(s.a), sa = Math.sin(s.a);
      lx.strokeStyle = "rgba(255,255,255," + (0.22 * speedNow * Math.min(1, s.r * 3)).toFixed(3) + ")";
      lx.lineWidth = s.w * (0.6 + speedNow);
      lx.beginPath(); lx.moveTo(cx + ca * r0, cy + sa * r0 * 0.8); lx.lineTo(cx + ca * r1, cy + sa * r1 * 0.8); lx.stroke();
    }
  }

  /* ---- вспышка, виньетка ------------------------------------------------------------------------------- */
  var fl = document.createElement("div"); fl.id = "fx-flash"; document.body.appendChild(fl);
  var vig = document.createElement("div"); vig.id = "fx-vig"; document.body.appendChild(vig);
  function flash(color, a) {
    fl.style.transition = "none"; fl.style.background = color || "#fff"; fl.style.opacity = String(a == null ? 0.5 : a);
    void fl.offsetWidth; fl.style.transition = "opacity .35s ease-out"; fl.style.opacity = "0";
  }

  /* ---- время: стоп-кадр и замедление ----------------------------------------------------------------- */
  var stopUntil = 0, stopScale = 1;
  function hitstop(sec, scale) {
    if (G.Q.level === "low" && sec > 0.15) sec = 0.15;
    stopUntil = Math.max(stopUntil, performance.now() + (sec || 0.12) * 1000);
    stopScale = Math.min(stopScale === 1 ? 1 : stopScale, scale == null ? 0.1 : scale);
  }
  function timeScale() {
    if (performance.now() < stopUntil) return stopScale;
    stopScale = 1; return 1;
  }

  /* ---- частицы: один Points с цветом и размером на вершину --------------------------------------------- */
  var N = G.Q.level === "low" ? 700 : 1800;
  var pos = new Float32Array(N * 3), col = new Float32Array(N * 3), siz = new Float32Array(N), alp = new Float32Array(N);
  var vel = new Float32Array(N * 3), life = new Float32Array(N), age = new Float32Array(N), grav = new Float32Array(N), grow = new Float32Array(N);
  var pg = new T.BufferGeometry();
  pg.setAttribute("position", new T.BufferAttribute(pos, 3).setUsage(T.DynamicDrawUsage));
  pg.setAttribute("color", new T.BufferAttribute(col, 3).setUsage(T.DynamicDrawUsage));
  pg.setAttribute("aSize", new T.BufferAttribute(siz, 1).setUsage(T.DynamicDrawUsage));
  pg.setAttribute("aAlpha", new T.BufferAttribute(alp, 1).setUsage(T.DynamicDrawUsage));
  var pm = new T.ShaderMaterial({
    transparent: true, depthWrite: false, vertexColors: true,
    uniforms: { uScale: { value: 1 }, uTex: { value: G.tex.glow } },
    vertexShader: [
      "attribute float aSize; attribute float aAlpha; varying vec3 vC; varying float vA; uniform float uScale;",
      "void main(){ vC = color; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0);",
      "  gl_PointSize = aSize * uScale / max(-mv.z, 0.1); gl_Position = projectionMatrix * mv; }"].join("\n"),
    fragmentShader: [
      "uniform sampler2D uTex; varying vec3 vC; varying float vA;",
      "void main(){ vec4 t = texture2D(uTex, gl_PointCoord); if (t.a * vA < 0.02) discard; gl_FragColor = vec4(vC, t.a * vA); }"].join("\n")
  });
  var pts = new T.Points(pg, pm); pts.frustumCulled = false; pts.renderOrder = 5;
  G.add(pts);
  var next = 0, live = 0;
  var KIND = {
    dust: { c: [0.72, 0.66, 0.56], s: [0.6, 1.4], v: [0.6, 2.2], up: [0.3, 1.2], g: 1.5, l: [0.6, 1.1], grow: 1.2 },
    sparks: { c: [1.0, 0.75, 0.3], s: [0.12, 0.25], v: [4, 11], up: [1, 5], g: 14, l: [0.25, 0.6], grow: 0, add: true },
    smoke: { c: [0.45, 0.45, 0.48], s: [1.2, 2.6], v: [0.3, 1.2], up: [1.2, 2.6], g: -0.6, l: [1.4, 2.6], grow: 1.5 },
    debris: { c: [0.25, 0.25, 0.28], s: [0.18, 0.35], v: [3, 8], up: [3, 7], g: 16, l: [0.8, 1.4], grow: 0 },
    confetti: { c: null, s: [0.18, 0.3], v: [2, 6], up: [4, 9], g: 6, l: [1.6, 2.6], grow: 0 },
    flame: { c: [1.0, 0.5, 0.12], s: [0.6, 1.3], v: [0.2, 1.0], up: [2, 4], g: -1.5, l: [0.35, 0.7], grow: -0.8, add: true },
    cash: { c: [0.45, 0.95, 0.55], s: [0.25, 0.4], v: [1, 3], up: [3, 6], g: 7, l: [0.8, 1.3], grow: 0 },
    water: { c: [0.75, 0.88, 1.0], s: [0.3, 0.6], v: [1, 4], up: [2, 5], g: 12, l: [0.5, 0.9], grow: 0.5 }
  };
  var CONF = [[1, 0.3, 0.4], [1, 0.8, 0.2], [0.3, 0.8, 1], [0.5, 1, 0.4], [0.8, 0.4, 1], [1, 0.55, 0.15]];
  function rr(a) { return a[0] + Math.random() * (a[1] - a[0]); }
  function burst(x, y, z, kind, n) {
    var K = KIND[kind] || KIND.dust;
    n = Math.min(n || 12, 120);
    if (G.Q.level === "low") n = Math.ceil(n / 2);
    for (var k = 0; k < n; k++) {
      var i = next; next = (next + 1) % N;
      var a = Math.random() * Math.PI * 2, sp = rr(K.v);
      pos[i * 3] = x + (Math.random() - 0.5) * 0.3; pos[i * 3 + 1] = y + Math.random() * 0.2; pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.3;
      vel[i * 3] = Math.cos(a) * sp; vel[i * 3 + 1] = rr(K.up); vel[i * 3 + 2] = Math.sin(a) * sp;
      var c = K.c || CONF[k % CONF.length];
      var shade = 0.85 + Math.random() * 0.3;
      col[i * 3] = c[0] * shade; col[i * 3 + 1] = c[1] * shade; col[i * 3 + 2] = c[2] * shade;
      siz[i] = rr(K.s); grav[i] = K.g; grow[i] = K.grow; life[i] = rr(K.l); age[i] = 0; alp[i] = 1;
    }
    live = Math.min(N, live + n);
  }
  var Hh = G.renderer.domElement;
  function stepParticles(dt) {
    pm.uniforms.uScale.value = Hh.height * 0.9;
    for (var i = 0; i < N; i++) {
      if (life[i] <= 0) continue;
      age[i] += dt;
      var t = age[i] / life[i];
      if (t >= 1) { life[i] = 0; alp[i] = 0; continue; }
      vel[i * 3 + 1] -= grav[i] * dt;
      var drag = Math.exp(-1.2 * dt);
      vel[i * 3] *= drag; vel[i * 3 + 2] *= drag;
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (pos[i * 3 + 1] < 0.05) { pos[i * 3 + 1] = 0.05; vel[i * 3 + 1] *= -0.3; vel[i * 3] *= 0.6; vel[i * 3 + 2] *= 0.6; }
      siz[i] = Math.max(0.02, siz[i] + grow[i] * dt);
      alp[i] = t < 0.1 ? t * 10 : 1 - (t - 0.1) / 0.9;
    }
    pg.attributes.position.needsUpdate = true; pg.attributes.color.needsUpdate = true;
    pg.attributes.aSize.needsUpdate = true; pg.attributes.aAlpha.needsUpdate = true;
  }

  /* ---- всплывающие надписи ------------------------------------------------------------------------------ */
  var pops = document.createElement("div"); pops.className = "fx-pops"; document.body.appendChild(pops);
  function popup(text, opt) {
    opt = opt || {};
    var e = document.createElement("div");
    e.className = "fx-pop" + (opt.big ? " big" : "");
    e.textContent = text;
    if (opt.color) e.style.color = opt.color;
    pops.appendChild(e);
    while (pops.children.length > 4) pops.firstChild.remove();
    setTimeout(function () { e.remove(); }, 1700);
  }

  FC.addSystem({
    name: "juice", order: 92,
    update: function (dt) {
      drawLines(dt);
      if (live) stepParticles(dt);
      var P = FC.player;
      if (P) vig.style.opacity = P.hp < (P.maxHp || 100) * 0.25 ? String(0.55 + Math.sin(performance.now() / 260) * 0.25) : "0";
    }
  });

  // Вибрация телефона в Telegram (бесплатно и очень «чувствуется»): light — приземление, medium — удар, heavy — авария
  var TGW = global.Telegram && global.Telegram.WebApp, lastHap = 0;
  function haptic(kind) {
    var now = performance.now();
    if (now - lastHap < 60) return;
    lastHap = now;
    try {
      if (TGW && TGW.HapticFeedback && TGW.initData) TGW.HapticFeedback.impactOccurred(kind || "light");
      else if (navigator.vibrate && FC.mobile) navigator.vibrate(kind === "heavy" ? 40 : kind === "medium" ? 20 : 8);
    } catch (e) { /* старый клиент без вибрации */ }
  }

  FC.fx = {
    haptic: haptic,
    speed: function (k) { speedWant = Math.max(speedWant, FC.clamp(k, 0, 1)); },
    hitstop: hitstop, timeScale: timeScale, flash: flash, burst: burst
  };
  if (FC.hud) FC.hud.popup = popup;
})(window);
