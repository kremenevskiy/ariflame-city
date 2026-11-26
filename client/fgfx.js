/* Флейм-Сити — графика: рендер, камера, небо, солнце/луна, тени, туман, сутки, дождь, свечение, качество,
 * материалы (фасады и дороги шейдером поверх MeshStandardMaterial — свет, тени и туман остаются штатными) и
 * текстуры холстом (вывески).
 *
 * Качество: ?q=low|mid|high; по умолчанию телефон — mid, компьютер — high; при FPS < 35 первые 8 с — ступень вниз.
 * Грабли шейдеров: NaN в одном пикселе свечение размазывает в чёрный прямоугольник —
 * только pow(max(x, 0.0), k) и smoothstep с a < b. Бесконечность от бликов — так же; вход свечения чистит safeHdr.
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE;

  /* Уровни графики, как в играх: «низкая» (экономно), «средняя», «высокая», «ультра». Модули видят Q.level —
   * low | mid | high («ультра» для них — high: та же толпа и дальность), сам рендер — Q.tier. Выбор в «Настройках»
   * телефона запоминается (localStorage fc.q); без выбора — телефон «средняя», компьютер «высокая». ?q=… — для замеров. */
  var qs = (location.search.match(/[?&]q=(low|mid|high|ultra)/) || [])[1];
  var MINSK = global.FC_CITY === "minsk", D2R = Math.PI / 180;
  // Telegram на Android сам говорит класс телефона в user agent: «… ; LOW)» / AVERAGE / HIGH — стартуем с него
  var tgClass = (navigator.userAgent.match(/Telegram-Android\/[^ ]+ \([^)]*;\s*(LOW|AVERAGE|HIGH)\)/) || [])[1];
  var qSaved = null;
  try { qSaved = global.localStorage.getItem("fc.q"); } catch (e) { qSaved = null; }
  if (!/^(low|mid|high|ultra)$/.test(qSaved || "")) qSaved = null;
  var Q = { tier: qs || qSaved || (tgClass === "LOW" ? "low" : tgClass === "HIGH" ? "mid" : FC.mobile ? "mid" : "high") };
  function applyQ() {
    var t = Q.tier, ultra = t === "ultra";
    Q.level = ultra ? "high" : t;
    Q.shadows = Q.level !== "low";
    Q.shadowSize = ultra ? 4096 : Q.level === "high" ? 2048 : 1024;   // «ультра» — та же площадь теней, вдвое чётче
    Q.bloom = Q.level === "high";
    Q.ratio = Math.min(global.devicePixelRatio || 1, ultra ? 2 : Q.level === "high" ? 1.75 : Q.level === "mid" ? 1.35 : 1);
    Q.msaa = 4;
    // для замеров: ?pr=1.5 — масштаб рендера, ?msaa=2 — отсчёты сглаживания буфера свечения
    var prQ = +((global.location.search.match(/[?&]pr=([\d.]+)/) || [])[1] || 0), msQ = (global.location.search.match(/[?&]msaa=(\d)/) || [])[1];
    if (prQ) Q.ratio = Math.min(global.devicePixelRatio || 1, prQ);
    if (msQ != null) Q.msaa = +msQ;
    Q.far = Q.level === "low" ? 650 : Q.level === "mid" ? 900 : ultra ? 1500 : 1300;
    Q.peds = Q.level === "low" ? 60 : Q.level === "mid" ? 110 : 180;     // v2: «город живее» — плотнее толпа
    Q.cars = Q.level === "low" ? 18 : Q.level === "mid" ? 30 : 46;
  }
  applyQ();

  var canvas = document.getElementById("cv");
  // powerPreference «default», не «high-performance»: на ноутбуках с двумя видеокартами «высокая» включала дискретную —
  // горячо и шумно ради кадров, которых и так хватает (частота кадров ограничена ниже, разрешение подстраивается само)
  // Со свечением (high) сглаживает свой буфер композера (MSAA ×4) — холст со своим MSAA сглаживал ещё раз
  // полноэкранный квадрат итога: лишний проход на 4 млн пикселей с 4 отсчётами. Холст — без сглаживания.
  var canvasAA = Q.level !== "low" && !(Q.bloom && T.EffectComposer);
  var renderer = new T.WebGLRenderer({ canvas: canvas, antialias: canvasAA, powerPreference: "default" });
  renderer.setPixelRatio(Q.ratio);
  renderer.setSize(global.innerWidth, global.innerHeight, false);
  renderer.outputColorSpace = T.SRGBColorSpace;
  // Минск — AgX (r160: константа 6; в нашей сборке three её имени нет): мягче в светах и честнее в пасмурном свете;
  // ?tm=aces — сравнить со старым
  renderer.toneMapping = MINSK && !/[?&]tm=aces/.test(location.search) ? 6 : T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = Q.shadows;
  renderer.shadowMap.type = T.PCFSoftShadowMap;

  var scene = new T.Scene();
  var camera = new T.PerspectiveCamera(62, global.innerWidth / global.innerHeight, 0.3, Q.far + 400);
  camera.position.set(0, 40, 80);
  scene.fog = new T.Fog(0x9fc3e6, 120, Q.far);

  // Отражения для стекла и машин — из НАШЕГО неба (шар с градиентом и солнцем), пересчёт раз в игровой час:
  // комната RoomEnvironment светила одинаково днём и ночью, и ночной город выходил белёсым.
  var pmrem = new T.PMREMGenerator(renderer);
  var envScene = new T.Scene(), envRT = null;
  var envGeo = new T.SphereGeometry(10, 24, 12), envCol = new Float32Array(envGeo.attributes.position.count * 3);
  envGeo.setAttribute("color", new T.BufferAttribute(envCol, 3));
  envScene.add(new T.Mesh(envGeo, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide })));
  var envSun = new T.Mesh(new T.SphereGeometry(1.2, 8, 6), new T.MeshBasicMaterial({ color: 0xffffff }));
  envScene.add(envSun);
  var ec = new T.Color(), eg = new T.Color();
  function rebuildEnv(top, hor, sunCol, sunDir, night) {
    var pos = envGeo.attributes.position;
    eg.copy(hor).multiplyScalar(0.35);
    for (var i = 0; i < pos.count; i++) {
      var y = pos.getY(i) / 10;
      if (y >= 0) ec.copy(hor).lerp(top, Math.pow(y, 0.6)); else ec.copy(hor).lerp(eg, Math.min(1, -y * 3));
      envCol[i * 3] = ec.r; envCol[i * 3 + 1] = ec.g; envCol[i * 3 + 2] = ec.b;
    }
    envGeo.attributes.color.needsUpdate = true;
    envSun.position.copy(sunDir).multiplyScalar(8);
    envSun.material.color.copy(sunCol).multiplyScalar(6 * (1 - night));
    var rt = pmrem.fromScene(envScene, 0.02);
    scene.environment = rt.texture;
    if (envRT) envRT.dispose();
    envRT = rt;
  }

  /* ---- свет ------------------------------------------------------------------------------------------------ */
  var hemi = new T.HemisphereLight(0xcfe6ff, 0x5a5040, 0.9);
  scene.add(hemi);
  var sun = new T.DirectionalLight(0xfff1dc, 2.4);
  sun.castShadow = Q.shadows;
  sun.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
  var SC = Q.level === "high" ? 90 : 60;
  sun.shadow.camera.left = -SC; sun.shadow.camera.right = SC; sun.shadow.camera.top = SC; sun.shadow.camera.bottom = -SC;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 600;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
  scene.add(sun); scene.add(sun.target);

  /* ---- небо: градиент, солнце, звёзды, облака — один шар вокруг камеры --------------------------------------- */
  var skyU = {
    uTop: { value: new T.Color(0x3d7cc9) }, uHor: { value: new T.Color(0xbcd8ef) }, uSun: { value: new T.Vector3(0, 1, 0) },
    uSunCol: { value: new T.Color(0xfff0c8) }, uNight: { value: 0 }, uTime: { value: 0 }, uCloud: { value: 0.35 }
  };
  var sky = new T.Mesh(new T.SphereGeometry(1, 32, 16), new T.ShaderMaterial({
    uniforms: skyU, side: T.BackSide, depthWrite: false, fog: false,
    vertexShader: "varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }",
    fragmentShader: [
      "uniform vec3 uTop, uHor, uSun, uSunCol; uniform float uNight, uTime, uCloud; varying vec3 vD;",
      "float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }",
      "float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);",
      "  return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }",
      "void main(){",
      "  vec3 d = normalize(vD); float y = max(d.y, 0.0);",
      "  vec3 col = mix(uHor, uTop, pow(y, 0.55));",
      "  if (d.y < 0.0) col = mix(uHor, uHor * 0.55, min(-d.y * 4.0, 1.0));",
      "  float s = max(dot(d, normalize(uSun)), 0.0);",
      "  col += uSunCol * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.35) * (1.0 - uNight * 0.6);",
      // звёзды
      "  vec2 sp = d.xz / max(d.y + 0.25, 0.1) * 90.0; float st = step(0.996, h(floor(sp)));",
      "  col += vec3(st) * uNight * smoothstep(0.05, 0.4, y) * (0.6 + 0.4 * sin(uTime * 3.0 + h(floor(sp)) * 40.0));",
      // облака — две октавы шума на плоскости над городом
      "  vec2 cp = d.xz / max(d.y, 0.06) * 1.6 + vec2(uTime * 0.01, 0.0);",
      "  float c = n(cp) * 0.65 + n(cp * 2.3) * 0.35; c = smoothstep(1.0 - uCloud, 1.05 - uCloud * 0.4, c) * smoothstep(0.02, 0.25, y);",
      "  vec3 cc = mix(vec3(1.0), uHor * 1.1, 0.35) * (1.0 - uNight * 0.85);",
      "  col = mix(col, cc, c * 0.85);",
      "  gl_FragColor = vec4(col, 1.0);",
      "}"].join("\n")
  }));
  // небо — последним среди непрозрачных (глубина = 1, проходит только там, где ничего не нарисовано): на Android
  // (Adreno, Mali) шейдер неба больше не считается под каждым домом; Apple и так отбрасывает закрытое
  sky.frustumCulled = false; sky.renderOrder = 1e6;
  sky.scale.setScalar(Q.far + 200);
  scene.add(sky);

  /* ---- время суток: цвета неба, света, тумана, экспозиция ------------------------------------------------------ */
  var KEYS = [ // час: верх неба, горизонт, солнце, полусфера (небо), сила солнца, сила полусферы
    [0, 0x0a1022, 0x22304f, 0x9fb4ff, 0x3d4d7a, 0.42, 0.58],      // ночь — лунный синий свет: город читается (23.11: «ничего не видно»)
    [5, 0x101a3a, 0x40466e, 0x9fb0ff, 0x45557f, 0.42, 0.6],
    [6.5, 0x4a6aa8, 0xf0a070, 0xffb070, 0x9fb0d0, 1.2, 0.6],
    [8, 0x3f7fd0, 0xbfdcf2, 0xfff0d8, 0xcfe6ff, 2.4, 0.9],
    [17, 0x3f7fd0, 0xc6ddf0, 0xfff0d8, 0xcfe6ff, 2.4, 0.9],
    [19, 0x3d5aa0, 0xff9a60, 0xff9a50, 0xb0a0c0, 1.3, 0.62],
    [20.5, 0x15224a, 0x4a3f6a, 0x9fb0ff, 0x4a5a8a, 0.45, 0.62],
    [24, 0x0a1022, 0x22304f, 0x9fb4ff, 0x3d4d7a, 0.42, 0.58]
  ];
  var cA = new T.Color(), cB = new T.Color();
  function mixHex(a, b, t, out) { cA.setHex(a); cB.setHex(b); return out.copy(cA).lerp(cB, t); }
  var weather = { rain: 0, target: 0, wet: 0 };
  var lastEnv = "";
  function applyTime() {
    var h = FC.clock.t / 3600, i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1][0] <= h) i++;
    var A = KEYS[i], B = KEYS[i + 1], t = (h - A[0]) / Math.max(0.0001, B[0] - A[0]);
    mixHex(A[1], B[1], t, skyU.uTop.value);
    mixHex(A[2], B[2], t, skyU.uHor.value);
    mixHex(A[3], B[3], t, sun.color);
    mixHex(A[4], B[4], t, hemi.color);
    var gray = weather.rain;
    skyU.uTop.value.lerp(cA.setHex(0x55606e), gray * 0.6);
    skyU.uHor.value.lerp(cA.setHex(0x8a949f), gray * 0.6);
    sun.intensity = FC.lerp(A[5], B[5], t) * (1 - gray * 0.55);
    hemi.intensity = FC.lerp(A[6], B[6], t);
    hemi.groundColor.setHex(0x4a4238).multiplyScalar(0.5 + 0.5 * (1 - FC.clock.night));
    // солнце по дуге: восход на востоке (+x), закат на западе; ночью — «луна» с той же стороны неба
    var ang = (h - 6) / 12 * Math.PI, up = Math.sin(ang);
    if (up < 0.12) { ang = (h - 18) / 12 * Math.PI; up = Math.max(Math.sin(ang), 0.3) * 0.8; }
    skyU.uSun.value.set(Math.cos(ang), Math.max(up, 0.05), 0.35).normalize();
    if (MINSK) minskLight(h);
    skyU.uSunCol.value.copy(sun.color);
    skyU.uNight.value = FC.clock.night;
    skyU.uCloud.value = (MINSK ? LOOKS[LOOK.name].cloud : 0.32) + weather.rain * 0.5;
    scene.fog.color.copy(skyU.uHor.value);
    renderer.toneMappingExposure = (MINSK ? LOOKS[LOOK.name].exp : 1.0) + FC.clock.night * 0.05;
    var envKey = Math.floor(h * 2) + "|" + (weather.target > 0.5 ? 1 : 0) + "|" + LOOK.name;
    if (envKey !== lastEnv) { lastEnv = envKey; rebuildEnv(skyU.uTop.value, skyU.uHor.value, sun.color, skyU.uSun.value, FC.clock.night); }
    G.night = FC.clock.night;
  }

  /* ---- Минск: свет под широту 53,9° и погода-«вид»: лето, пасмурно (по умолчанию ноябрь–март
   * — так Минск выглядит полгода), зима со снегом; ночь — по игровым часам. Солнце — настоящее для сегодняшней даты:
   * высота и азимут по формулам NOAA, игровой световой день 6:30–19:30 растянут на настоящий (в декабре полдень — 12,7°). */
  var LOOKS = {
    summer: { cloud: 0.38, sunK: 1.05, hemiK: 0.95, fog: 1 / 2600, exp: 1.0, snow: 0, over: 0, top: null, hor: null, hs: null, hg: null },
    overcast: { cloud: 0.97, sunK: 0.24, hemiK: 1.45, fog: 1 / 1400, exp: 1.08, snow: 0, over: 1, top: 0x8d97a1, hor: 0xc4c9cd, hs: 0xc2c8ce, hg: 0x6b6a5e },
    winter: { cloud: 0.82, sunK: 0.5, hemiK: 1.4, fog: 1 / 1500, exp: 1.02, snow: 1, over: 0.6, top: 0x93a2b2, hor: 0xd5dce2, hs: 0xcdd6de, hg: 0xa8b0b8 }
  };
  function autoLook() {
    var d = new Date(), m = d.getMonth(), r = (FC.hash ? FC.hash("look" + d.getFullYear() + "-" + m + "-" + d.getDate()) : 7) % 100;
    if (m >= 3 && m <= 8) return r < 78 ? "summer" : "overcast";
    if (m === 9) return r < 50 ? "summer" : "overcast";
    if (m === 11 || m <= 1) return r < 70 ? "winter" : "overcast";
    return r < 25 ? "summer" : "overcast";                  // ноябрь и март: чаще пасмурно
  }
  function setLook(name) {
    var q = (location.search.match(/[?&]look=(summer|overcast|winter)/) || [])[1];
    if (!name || name === "auto") name = q || autoLook();
    if (!LOOKS[name]) name = "summer";
    LOOK.name = name; LOOK.snow = !!LOOKS[name].snow; LOOK.uSnow.value = LOOKS[name].snow; LOOK.uOver.value = LOOKS[name].over;
    LOOK.overcast = LOOKS[name].over; lastEnv = "";
    FOGU.uFogP.value.x = LOOKS[name].fog;
    FC.emit && FC.emit("look", name);
    return name;
  }
  var sunTmp = new T.Vector3();
  function minskSun(h, out) {
    var d = new Date(), N = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
    var decl = 23.44 * Math.sin(2 * Math.PI * (284 + N) / 365) * D2R, lat = 53.9 * D2R;
    var H0 = Math.acos(Math.max(-1, Math.min(1, -Math.tan(lat) * Math.tan(decl))));
    var tt = (h - 6.5) / 13, H;
    if (tt < 0 || tt > 1) return null;
    H = -H0 + tt * 2 * H0;
    var sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H), alt = Math.asin(sinAlt);
    var az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat));
    out.set(-Math.sin(az) * Math.cos(alt), Math.max(sinAlt, 0.035), Math.cos(az) * Math.cos(alt)).normalize();
    return alt;
  }
  function minskLight(h) {
    var L = LOOKS[LOOK.name], day = 1 - FC.clock.night, alt = minskSun(h, sunTmp);
    if (alt != null) {
      skyU.uSun.value.copy(sunTmp);
      sun.intensity *= Math.max(0.35, Math.min(1, Math.sin(alt) * 3.2 + 0.25));   // низкое зимнее солнце — слабее и желтее
      if (alt < 0.2) sun.color.lerp(cA.setHex(0xffc890), (0.2 - alt) * 2.5 * day);
    }
    sun.intensity *= L.sunK; hemi.intensity *= L.hemiK;
    if (L.top) {
      skyU.uTop.value.lerp(cA.setHex(L.top), day * 0.9); skyU.uHor.value.lerp(cA.setHex(L.hor), day * 0.9);
      hemi.color.lerp(cA.setHex(L.hs), day * 0.85); hemi.groundColor.lerp(cA.setHex(L.hg), day * 0.85);
      sun.color.lerp(cA.setHex(0xf4f0ea), 0.5 * day);
      // пасмурная ночь в городе — небо подсвечено снизу тёплым
      skyU.uHor.value.lerp(cA.setHex(0x4a3f46), FC.clock.night * 0.5);
    }
    FOGU.uFogSun.value.copy(skyU.uSun.value); FOGU.uFogSunCol.value.copy(sun.color).lerp(skyU.uHor.value, 0.45);
    FOGU.uFogP.value.w = L.top ? 0.15 : 0.55;
    G.look = LOOK;
  }

  /* ---- дождь: точки, падающие вокруг камеры ------------------------------------------------------------------- */
  var RAIN_N = Q.level === "low" ? 900 : 2600;
  var rainGeo = new T.BufferGeometry(), rp = new Float32Array(RAIN_N * 3);
  for (var i = 0; i < RAIN_N; i++) { rp[i * 3] = Math.random() * 80 - 40; rp[i * 3 + 1] = Math.random() * 40; rp[i * 3 + 2] = Math.random() * 80 - 40; }
  rainGeo.setAttribute("position", new T.BufferAttribute(rp, 3));
  // капля — вертикальный штрих, снежинка — мягкая точка (без текстуры точки рисуются квадратами — «белые квадраты в воздухе»)
  function dropTex(snow) {
    var cv = document.createElement("canvas"); cv.width = cv.height = 32; var c = cv.getContext("2d");
    if (snow) { var g = c.createRadialGradient(16, 16, 0, 16, 16, 15); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.5, "rgba(255,255,255,.7)"); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.fillRect(0, 0, 32, 32); }
    else { var l = c.createLinearGradient(0, 0, 0, 32); l.addColorStop(0, "rgba(255,255,255,0)"); l.addColorStop(0.5, "rgba(255,255,255,.9)"); l.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = l; c.fillRect(15, 0, 2, 32); }
    var t = new T.CanvasTexture(cv); t.colorSpace = T.SRGBColorSpace; return t;
  }
  var RAIN_TEX = dropTex(false), SNOW_TEX = dropTex(true);
  var rain = new T.Points(rainGeo, new T.PointsMaterial({ color: 0xaac4e0, size: 0.28, map: RAIN_TEX, alphaTest: 0.02, transparent: true, opacity: 0.55, depthWrite: false }));
  rain.frustumCulled = false; rain.visible = false;
  scene.add(rain);
  function updateRain(dt) {
    weather.rain = FC.damp(weather.rain, weather.target, 0.4, dt);
    weather.wet = FC.damp(weather.wet, weather.target > 0.5 ? 1 : 0, weather.target > 0.5 ? 0.3 : 0.05, dt);
    G.wet.value = Math.max(weather.wet, MINSK && LOOK.name === "overcast" ? 0.3 : 0);
    rain.visible = weather.rain > 0.05;
    if (!rain.visible) return;
    // в Алматы (горы рядом) вместо дождя — снег: крупнее, белее, медленнее и с ветром
    var snow = FC.map && FC.map.district(camera.position.x, camera.position.z).key === "ala";
    if (snow !== weather.snow) {
      weather.snow = snow;
      rain.material.color.setHex(snow ? 0xffffff : 0xaac4e0); rain.material.size = snow ? 0.26 : 0.28;
      rain.material.map = snow ? SNOW_TEX : RAIN_TEX; rain.material.needsUpdate = true;
    }
    rain.material.opacity = (snow ? 0.9 : 0.55) * weather.rain;
    rain.position.set(camera.position.x, camera.position.y - 10, camera.position.z);
    var a = rainGeo.attributes.position.array, fall = snow ? 3.2 : 28, tt = performance.now() / 1000;
    for (var k = 0; k < RAIN_N; k++) {
      a[k * 3 + 1] -= dt * fall;
      if (snow) { a[k * 3] += Math.sin(tt * 0.9 + k) * dt * 0.8; a[k * 3 + 2] += Math.cos(tt * 0.7 + k * 1.3) * dt * 0.6 + dt * 0.5; }
      if (a[k * 3 + 1] < 0) { a[k * 3 + 1] += 40; if (snow) { a[k * 3] = Math.random() * 80 - 40; a[k * 3 + 2] = Math.random() * 80 - 40; } }
      var lx = a[k * 3], lz = a[k * 3 + 2], ly = a[k * 3 + 1];                 // камера — в (0, 10, 0) облака капель
      if (lx * lx + lz * lz < 6.25 && ly > 7 && ly < 13) a[k * 3] += lx >= 0 ? 3 : -3;
    }
    rainGeo.attributes.position.needsUpdate = true;
  }
  // погода меняется сама: раз в игровые сутки 30% шанс дождя на 2–5 игровых часов
  var nextWeatherAt = 0;
  function weatherTick() {
    if (Date.now() < nextWeatherAt) return;
    nextWeatherAt = Date.now() + 120000 + Math.random() * 240000;
    weather.target = Math.random() < 0.28 ? 1 : 0;
    FC.emit("weather", weather.target);
  }

  /* ---- свечение (только high) ------------------------------------------------------------------------------- */
  var composer = null, bloom = null;
  function makeComposer() {
    // свой буфер со сглаживанием (MSAA ×4): композер рисует сцену не в холст, и сглаживание холста (antialias) терялось —
    // на «высоком» качестве края домов, машин и проводов были лесенкой
    var dbs = renderer.getDrawingBufferSize(new T.Vector2());
    var rt = new T.WebGLRenderTarget(dbs.x, dbs.y, { type: T.HalfFloatType, samples: renderer.capabilities.isWebGL2 ? Q.msaa : 0 });
    composer = new T.EffectComposer(renderer, rt);
    composer.addPass(new T.RenderPass(scene, camera));
    bloom = new T.UnrealBloomPass(new T.Vector2(global.innerWidth / 2, global.innerHeight / 2), 0.45, 0.45, 0.92);
    composer.addPass(bloom);
    var outPass = new T.OutputPass();
    composer.addPass(outPass);
    safeHdr(bloom.materialHighPassFilter, outPass.material);
    // свечение — с четверти разрешения, а не с половины: оно и так размыто пятью уровнями, а стоило ~треть кадра
    var bset = bloom.setSize, bdiv = /[?&]bloom=half/.test(global.location.search) ? 1 : 2;     // ?bloom=half — как раньше, для сравнения
    bloom.setSize = function (w, h) { bset.call(this, Math.max(2, Math.round(w / bdiv)), Math.max(2, Math.round(h / bdiv))); };
    var pr = renderer.getPixelRatio();
    composer.setPixelRatio(pr); composer.setSize(global.innerWidth, global.innerHeight);
  }
  if (Q.bloom && T.EffectComposer) makeComposer();
  /* Блик солнца на гладком (стекло фасадов и машин, мокрый асфальт — шероховатость ~0,05) даёт тысячи единиц яркости;
   * в буфере половинной точности это бесконечность. Свечение растягивало её по уровням размытия в прямоугольники,
   * тонмаппинг делал из бесконечности NaN — мигающие чёрные блоки в полэкрана (23.11, Новая Боровая). Чистим вход
   * свечения (бесконечность → потолок, NaN → 0, проверка по битам — её не выкидывает «быстрая математика» драйвера)
   * и вход тонмаппинга (потолок). Блики остаются бликами, только без блоков и без вспышек на всё окно. */
  function safeHdr(hp, out) {
    var SAFE = "vec3 fcSafe(vec3 c) {\n#if __VERSION__ >= 300\n" +
      "  highp uvec3 u = floatBitsToUint(c); bvec3 ex = equal(u & 0x7f800000u, uvec3(0x7f800000u)); bvec3 nm = notEqual(u & 0x007fffffu, uvec3(0u));\n" +
      "  c = mix(c, vec3(16.0), ex); c = mix(c, vec3(0.0), bvec3(ex.x && nm.x, ex.y && nm.y, ex.z && nm.z));\n#endif\n" +
      "  return clamp(c, 0.0, 16.0);\n}\n";
    var TX = "vec4 texel = texture2D( tDiffuse, vUv );", OUT = "gl_FragColor = texture2D( tDiffuse, vUv );";
    if (hp.fragmentShader.indexOf(TX) < 0 || out.fragmentShader.indexOf(OUT) < 0) { console.warn("fgfx: шейдеры свечения изменились — защита от бесконечности не встала"); return; }
    hp.fragmentShader = hp.fragmentShader.replace("void main() {", SAFE + "void main() {").replace(TX, TX + " texel.rgb = fcSafe(texel.rgb);");
    out.fragmentShader = out.fragmentShader.replace(OUT, OUT + " gl_FragColor.rgb = clamp(gl_FragColor.rgb, 0.0, 32.0);");
    hp.needsUpdate = out.needsUpdate = true;
  }

  function resize() {
    holdDrawn = false;                                   // при удержании (пауза, карта) — перерисовать один кадр под новый размер
    var w = global.innerWidth, h = global.innerHeight;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    if (composer) composer.setSize(w, h);
  }
  global.addEventListener("resize", resize);


  /* ---- Минск: семейства домов (коды 20–37 — tools/minsk-osm.py FAM). Ресёрч 22.11 «minsk_architecture_details»:
   * шаг окон и высота этажа по сериям, цоколь, лоджии, швы панелей, карнизы сталинок, витрины, ленточные окна, гаражи.
   * Окна подогнаны под длину стены (aWall.x — метры от угла, aWall.y — длина) и число этажей (aFac.z). За стеклом —
   * «комната» (interior mapping): днём видна глубина, ночью — свет и обстановка. */
  var MINSK_GLSL = [
    "float fcN(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);",
    "  return mix(mix(fcH(i),fcH(i+vec2(1,0)),f.x), mix(fcH(i+vec2(0,1)),fcH(i+vec2(1,1)),f.x), f.y); }",
    // A: шаг, ширина окна, высота окна, подоконник; B: цоколь, парапет, множитель 1-го этажа, плитка атласа (−1 — нет)
    "void mkP(float f, float vr, out vec4 A, out vec4 B){",
    "  A = vec4(3.4, 1.5, 1.6, 0.85); B = vec4(0.6, 0.8, 1.15, -1.0);",
    "  if (f < 21.5) { A = vec4(3.5, 1.45, 2.15, 0.75); B = vec4(1.0, 1.6, 1.45, vr < 4.5 ? 7.0 : 8.0); }",
    "  else if (f < 22.5) { A = vec4(3.1, 1.3, 1.75, 0.85); B = vec4(0.8, 0.9, 1.2, vr < 5.5 ? 7.0 : -1.0); }",
    "  else if (f < 23.5) { A = vec4(3.2, 1.5, 1.45, 0.85); B = vec4(0.9, 0.6, 1.3, vr < 2.5 ? 9.0 : -1.0); }",
    "  else if (f < 24.5) { A = vec4(3.2, 1.8, 1.4, 0.85); B = vec4(0.9, 0.5, 1.3, -1.0); }",
    "  else if (f < 25.5) { A = vec4(3.2, 1.5, 1.5, 0.85); B = vec4(0.9, 1.3, 1.3, vr < 3.5 ? 10.0 : -1.0); }",
    "  else if (f < 26.5) { A = vec4(3.0, 1.5, 1.5, 0.85); B = vec4(1.0, 2.4, 1.35, vr < 2.5 ? 10.0 : -1.0); }",
    "  else if (f < 27.5) { A = vec4(3.2, 1.5, 1.5, 0.85); B = vec4(0.9, 1.2, 1.3, vr < 2.5 ? 9.0 : vr < 4.5 ? 10.0 : -1.0); }",
    "  else if (f < 29.5) { A = vec4(3.4, 1.7, 1.6, 0.7); B = vec4(1.4, 1.8, 1.45, vr < 4.5 ? 11.0 : 14.0); }",
    "  else if (f < 30.5) { A = vec4(1.7, 1.6, 3.0, 0.3); B = vec4(0.4, 1.2, 1.4, 12.0); }",
    "  else if (f < 31.5) { A = vec4(2.8, 1.1, 1.9, 0.9); B = vec4(0.6, 0.8, 1.15, vr < 5.5 ? 13.0 : -1.0); }",
    "  else if (f < 32.5) { A = vec4(5.0, 3.8, 1.6, 2.4); B = vec4(0.3, 0.8, 1.0, -1.0); }",
    "  else if (f < 33.5) { A = vec4(3.6, 1.15, 1.35, 0.9); B = vec4(0.5, 0.2, 1.1, -1.0); }",
    "  else if (f < 34.5) { A = vec4(3.0, 2.5, 1.8, 0.9); B = vec4(0.8, 0.8, 1.1, -1.0); }",
    "  else if (f < 35.5) { A = vec4(5.0, 1.0, 3.6, 2.0); B = vec4(0.6, 0.6, 1.0, -1.0); }",
    "  else if (f < 36.5) { A = vec4(3.2, 2.6, 2.1, 0.0); B = vec4(0.0, 0.3, 1.0, -1.0); }",
    "  else if (f < 37.5) { A = vec4(3.0, 2.9, 1.5, 0.95); B = vec4(0.8, 1.0, 1.15, -1.0); }",
    "}",
    // акцентные цвета (новостройки, «свечки», плитка М-464БК, школы)
    "vec3 mkAcc(float k){ k = mod(k, 7.0);",
    "  if (k < 0.5) return vec3(0.58,0.13,0.05); if (k < 1.5) return vec3(0.87,0.53,0.06); if (k < 2.5) return vec3(0.1,0.32,0.68);",
    "  if (k < 3.5) return vec3(0.38,0.6,0.13); if (k < 4.5) return vec3(0.8,0.24,0.04); if (k < 5.5) return vec3(0.76,0.55,0.1); return vec3(0.2,0.42,0.2); }",
    // комната за окном: p — точка окна (м от левого нижнего угла ячейки), vl — луч (вдоль, вверх, вглубь > 0)
    "vec3 mkRoom(vec2 p, vec3 vl, vec2 room, float rnd){",
    "  float D = room.x * (0.9 + rnd * 0.7); vl.z = max(vl.z, 0.02);",
    "  float tb = D / vl.z;",
    "  float ts = vl.x > 0.0 ? (room.x - p.x) / max(vl.x, 1e-4) : p.x / max(-vl.x, 1e-4);",
    "  float tf = vl.y > 0.0 ? (room.y - p.y) / max(vl.y, 1e-4) : p.y / max(-vl.y, 1e-4);",
    "  float t = min(tb, min(ts, tf)); vec3 hit = vec3(p, 0.0) + vl * t;",
    "  vec3 wc = mix(vec3(0.62,0.55,0.44), vec3(0.47,0.52,0.56), fract(rnd * 7.31)); vec3 c;",
    "  if (t >= tb - 1e-3) { c = wc;",
    "    float fx = hit.x / room.x - 0.5 - (fract(rnd * 3.7) - 0.5) * 0.5;",
    "    c = mix(c, vec3(0.28,0.2,0.15), step(hit.y, room.y * 0.32) * step(abs(fx), 0.22) * 0.85);",
    "    c = mix(c, vec3(0.75,0.6,0.38), step(abs(hit.y / room.y - 0.62), 0.09) * step(abs(hit.x / room.x - 0.3 - fract(rnd * 5.1) * 0.4), 0.07));",
    "  } else if (t >= ts - 1e-3) c = wc * 0.78;",
    "  else if (vl.y < 0.0) c = vec3(0.36,0.25,0.17);",
    "  else c = vec3(0.86,0.85,0.82);",
    "  return c * (1.05 - clamp(t / (D * 1.6), 0.0, 0.55));",
    "}"
  ].join("\n");

  /* ---- шейдер фасада: окна по сетке из мировой позиции, ночью горит часть окон --------------------------------- */
  // Стили (fmap STYLE): 0 стекло, 1 панель, 2 кирпич, 3 сталинка, 4 модерн, 5 ангар-студия, 6 частный дом.
  var FAC_GLSL = [
    "float fcH(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }",
    "vec3 fcWall(float st){",
    "  if (st < 0.5) return vec3(0.16,0.25,0.33); if (st < 1.5) return vec3(0.80,0.78,0.72);",
    "  if (st < 2.5) return vec3(0.55,0.27,0.19); if (st < 3.5) return vec3(0.83,0.74,0.58);",
    "  if (st < 4.5) return vec3(0.60,0.63,0.66); if (st < 5.5) return vec3(0.72,0.74,0.76); return vec3(0.90,0.83,0.68); }",
    "vec2 fcCell(float st){",
    "  if (st < 0.5) return vec2(2.0, 3.5); if (st < 1.5) return vec2(3.2, 3.5); if (st < 2.5) return vec2(3.0, 3.5);",
    "  if (st < 3.5) return vec2(3.6, 3.5); if (st < 4.5) return vec2(4.2, 3.5); if (st < 5.5) return vec2(6.0, 4.5); return vec2(3.0, 3.5); }",
    "vec2 fcWin(float st){",
    "  if (st < 0.5) return vec2(0.92, 0.86); if (st < 1.5) return vec2(0.5, 0.45); if (st < 2.5) return vec2(0.45, 0.55);",
    "  if (st < 3.5) return vec2(0.42, 0.6); if (st < 4.5) return vec2(0.8, 0.55); if (st < 5.5) return vec2(0.0, 0.0); return vec2(0.4, 0.45); }",
    // Минск: 7–14 — фасады из атласа tex/facades.webp (плитка = 2 окна × 2 этажа, размер в метрах), 15 — глухая стена,
    // 16 — редкие высокие окна (храмы, театры). Атлас грузит FC.gfx.facadeTex() — во Флейм-Сити этих видов нет.
    "vec2 fcTile(float st){",
    "  if (st < 7.5) return vec2(6.8, 7.2); if (st < 8.5) return vec2(7.2, 8.0); if (st < 9.5) return vec2(5.8, 5.6); if (st < 10.5) return vec2(6.4, 5.6);",
    "  if (st < 11.5) return vec2(6.8, 6.0); if (st < 12.5) return vec2(6.0, 7.0); if (st < 13.5) return vec2(6.4, 6.8); return vec2(6.8, 6.0); }",
    "vec3 fcPal(float s){ float k = mod(s, 6.0);",
    "  if (k < 0.5) return vec3(1.0,0.74,0.72); if (k < 1.5) return vec3(1.0,0.90,0.62); if (k < 2.5) return vec3(0.76,0.94,0.82);",
    "  if (k < 3.5) return vec3(0.78,0.87,1.0); if (k < 4.5) return vec3(1.0,0.82,0.64); return vec3(0.97,0.96,0.92); }",
    MINSK_GLSL
  ].join("\n");

  /* ---- Минск: воздушная перспектива (туман гуще у земли, подсветка со стороны солнца) — в своих материалах города;
   * во Флейм-Сити uFogMode = 0 — обычный линейный туман, как раньше. Ресёрч: «без тумана город кажется игрушечным». */
  var FOGU = { uFogMode: { value: MINSK ? 1 : 0 }, uFogP: { value: new T.Vector4(1 / 1500, 0.012, 0, 0.55) },
    uFogSun: { value: new T.Vector3(0, 1, 0) }, uFogSunCol: { value: new T.Color(1, 0.9, 0.75) },
    // «вырез» внутри здания (Минск, FC.inside): наружная оболочка дома и земля под интерьером не рисуются — без
    // просветов и z-fighting у повёрнутых контуров. uCut: центр x, z и ось u; uCutS: полудлина, полуширина, верх, вкл
    uCut: { value: new T.Vector4(0, 0, 1, 0) }, uCutS: { value: new T.Vector4(0, 0, 0, 0) } };
  function CUT_FRAG(wv) {
    return "#include <clipping_planes_fragment>\nif (uCutS.w > 0.5) { vec3 cw3 = " + wv + "; vec2 cd = cw3.xz - uCut.xy; float clx = dot(cd, uCut.zw); float clz = dot(cd, vec2(-uCut.w, uCut.z));" +
      " if (abs(clx) < uCutS.x && abs(clz) < uCutS.y && cw3.y < uCutS.z) discard; }";
  }
  function fogUniforms(sh) { Object.keys(FOGU).forEach(function (k) { sh.uniforms[k] = FOGU[k]; }); }
  var FOG_PARS = "\nuniform float uFogMode; uniform vec4 uFogP; uniform vec3 uFogSun; uniform vec3 uFogSunCol; uniform vec4 uCut; uniform vec4 uCutS;\n";
  function FOG_FRAG(wv) {
    return ["#ifdef USE_FOG", "{ float fd = vFogDepth; float fogF;",
      "  if (uFogMode > 0.5) {",
      "    float hf = exp(-max((" + wv + ").y, 0.0) * uFogP.y);",
      "    fogF = 1.0 - exp(-fd * uFogP.x * (0.45 + 0.55 * hf));",
      "    fogF = max(fogF * 0.92, smoothstep(fogFar * 0.66, fogFar, fd));",
      "    vec3 Vf = normalize((" + wv + ") - cameraPosition); float sa = pow(max(dot(Vf, uFogSun), 0.0), 5.0) * uFogP.w;",
      "    gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(fogColor, uFogSunCol, sa), fogF);",
      "  } else { fogF = smoothstep(fogNear, fogFar, fd); gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogF); }",
      "}", "#endif"].join("\n");
  }
  var LOOK = { name: "summer", snow: false, uSnow: { value: 0 }, uOver: { value: 0 }, overcast: 0 };

  var facadeU = { uNight: { value: 0 }, uWet: null, uLit: { value: 0 }, uShop: { value: 1 }, uSky: { value: new T.Color(0xbcd8ef) },
    uFacTex: { value: null }, uFacOn: { value: 0 } };
  var G = { wet: { value: 0 } };
  facadeU.uWet = G.wet;
  function facadeMaterial() {
    var m = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.0, envMapIntensity: 0.6 });
    m.customProgramCacheKey = function () { return "fc-facade-4"; };
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uNight = facadeU.uNight; sh.uniforms.uWet = facadeU.uWet; sh.uniforms.uLit = facadeU.uLit;
      sh.uniforms.uShop = facadeU.uShop; sh.uniforms.uTime = waterU.uTime; sh.uniforms.uSky = facadeU.uSky;
      sh.uniforms.uFacTex = facadeU.uFacTex; sh.uniforms.uFacOn = facadeU.uFacOn; sh.uniforms.uSnow = LOOK.uSnow; fogUniforms(sh);
      // aCol: rgb — цвет стены (линейный), a = 0 — «цвет задан»; нет атрибута → (0,0,0,1) = «нет цвета»
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec4 aFac; attribute vec4 aCol; attribute vec4 aWall; varying vec4 vFac; varying vec4 vCol; varying vec4 vWall; varying vec3 vFcP; varying vec3 vFcN;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFac = aFac; vCol = aCol; vWall = aWall; vec4 fcW = modelMatrix * vec4(transformed, 1.0); vFcP = fcW.xyz; vFcN = normalize(mat3(modelMatrix) * objectNormal);");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uNight, uWet, uLit, uShop, uTime, uFacOn, uSnow; uniform vec3 uSky; uniform sampler2D uFacTex; varying vec4 vFac; varying vec4 vCol; varying vec4 vWall; varying vec3 vFcP; varying vec3 vFcN; float fcLit = 0.0; float fcGlass = 0.0; float fcTv = 0.0; vec3 fcEm = vec3(0.0);\n" + FAC_GLSL + FOG_PARS)
        .replace("#include <color_fragment>", [
          "#include <color_fragment>",
          "if (vFac.x > 19.5)",
          "{ float fam = floor(vFac.x + 0.5); float seed = floor(vFac.y + 0.5); float floors = max(1.0, floor(vFac.z + 0.5));",
          "  float shopW = step(0.5, vFac.w); float vr = floor(vCol.a + 0.5); vec3 wcol = vCol.rgb;",
          "  if (vFcN.y > 0.5 || vr > 7.5) {",
          "    vec3 rc = wcol * (0.86 + 0.22 * fcN(vFcP.xz * 0.35) - 0.08 * fcN(vFcP.xz * 2.1));",
          "    rc = mix(rc, vec3(0.86, 0.89, 0.93), uSnow * smoothstep(0.4, 0.9, vFcN.y));",
          "    diffuseColor.rgb = rc * (1.0 - uWet * 0.2);",
          "  } else {",
          "    vec4 A; vec4 B; mkP(fam, vr, A, B);",
          "    float u = vWall.x; float len = max(vWall.y, 0.01); float v = vFcP.y - vWall.z; float wallH = max(vWall.w - vWall.z, 0.5);",
          "    float par = min(B.y, wallH * 0.18); float gm = B.z;",
          "    float Fm = (wallH - par) / max(floors - 1.0 + gm, 1.0); float G0 = Fm * gm;",
          "    float nC = max(1.0, floor(len / A.x + 0.5)); float cw = len / nC;",
          "    float cu = u / cw; float cx = floor(cu); float fu = fract(cu);",
          "    float row = v < G0 ? 0.0 : 1.0 + floor((v - G0) / Fm);",
          "    float fl0 = v < G0 ? 0.0 : G0 + (row - 1.0) * Fm; float Fh = v < G0 ? G0 : Fm;",
          "    float fv = clamp((v - fl0) / Fh, 0.0, 1.0);",
          "    float topZ = step(wallH - par, v);",
          "    vec2 cc2 = vec2(cu, v / Fm); vec2 fw = fwidth(cc2); float far = smoothstep(0.2, 0.5, max(fw.x, fw.y));",
          "    vec2 cg = cc2 * 0.5; vec2 tgx = dFdx(cg) * 0.24; vec2 tgy = dFdy(cg) * 0.24;",
          "    float ww = min(A.y, cw * 0.82) / cw * 0.5;",
          "    float wb = (A.w + Fh - Fm) / Fh; float wt = min(wb + A.z / Fh, 0.95);",
          "    vec2 e = fw * vec2(1.0, Fm / Fh) * 1.2 + 0.003;",
          "    float inWin = (1.0 - smoothstep(ww - e.x, ww + e.x, abs(fu - 0.5))) * smoothstep(wb - e.y, wb + e.y, fv) * (1.0 - smoothstep(wt - e.y, wt + e.y, fv));",
          "    if (len < 2.2 || topZ > 0.5) inWin = 0.0;",
          "    vec3 wall = wcol;",
          "    wall *= 0.92 + 0.08 * fcN(vec2(u * 0.35, v * 0.06) + seed) - 0.04 * fcN(vec2(u * 2.0, v * 0.25));",
          "    float tile = B.w; float txd = 0.0; vec3 tcol = wcol;",
          "    if (tile > 6.5 && uFacOn > 0.5) {",
          "      float k = tile - 7.0; vec2 org = vec2(mod(k, 4.0), 3.0 - floor(k / 4.0)) * 0.25;",
          "      float rr = row < 0.5 ? 0.0 : row - 1.0;",
          "      vec2 tuv = vec2((mod(cx, 2.0) + fu) * 0.5, (mod(rr, 2.0) + fv) * 0.5);",
          "      vec2 uvT = org + 0.005 + tuv * 0.24;",
          "      tcol = textureGrad(uFacTex, uvT, tgx, tgy).rgb; float tm = textureGrad(uFacTex, uvT - vec2(0.0, 0.5), tgx, tgy).r;",
          "      vec3 tavg = textureLod(uFacTex, org + 0.125, 8.0).rgb;",
          "      if (tile < 10.5 || tile > 12.5) {",
          "        float l = dot(tcol, vec3(0.3, 0.59, 0.11)) / max(dot(tavg, vec3(0.3, 0.59, 0.11)), 0.05);",
          "        tcol = mix(tcol, wcol * l, (1.0 - tm) * 0.8);",
          "      }",
          "      if (topZ < 0.5 && len >= 2.2) { wall = mix(tcol, wall, far); inWin = mix(tm, inWin, far); txd = 1.0 - far; }",
          "    }",
          "    float glazeT = -1.0;",
          "    if (fam > 22.5 && fam < 27.5 && txd < 0.5) {",
          "      float sx = min(fu, 1.0 - fu) * cw; float sy = v - fl0;",
          "      float seam = (1.0 - smoothstep(0.02, 0.05 + fw.x * cw, sx)) + (1.0 - smoothstep(0.02, 0.05 + fw.y * Fm, abs(sy)));",
          "      wall *= 1.0 - 0.16 * clamp(seam, 0.0, 1.0) * (1.0 - far);",
          "      wall *= 1.0 - 0.07 * smoothstep(0.55, 1.0, fcN(vec2(u * 3.0, v * 0.4))) * (1.0 - smoothstep(0.0, 0.1, min(fu, 1.0 - fu)));",
          "    }",
          "    if ((fam > 24.5 && fam < 27.5) || (fam > 27.5 && fam < 29.5)) {",
          "      float col3 = mod(cx + floor(seed * 0.1), 3.0);",
          "      float isL = (fam > 25.5 && fam < 26.5) ? step(nC - 1.5, cx) + step(cx, 0.5) : step(col3, 0.5);",
          "      if (isL > 0.5 && row > 0.5 && topZ < 0.5 && nC > 2.5) {",
          "        float fr = fcH(vec2(cx * 3.1, row * 1.7) + seed);",
          "        glazeT = fr < 0.4 ? 0.0 : fr < 0.7 ? 1.0 : fr < 0.88 ? 2.0 : 3.0;",
          "        float inL = step(0.035, fu) * step(fu, 0.965) * step(fv, 0.93);",
          "        if (inL > 0.5) {",
          "          vec3 front = (fam > 24.5 && fam < 25.5 && vr > 3.5) ? mkAcc(vr + cx) * 0.9 + 0.1 : (fam > 27.5 ? mkAcc(seed + vr) : wcol * 1.06);",
          "          if (fv < 0.36) { wall = mix(wall, front, 1.0 - far); inWin = 0.0; } else inWin = mix(inWin, 1.0, 1.0 - far);",
          "        }",
          "        wall *= 1.0 - 0.3 * (step(fu, 0.035) + step(0.965, fu)) * (1.0 - far);",
          "      }",
          "    }",
          "    if (fam > 22.5 && fam < 24.5 && txd < 0.5 && row > 0.5) {",
          "      float isB = step(0.62, fcH(vec2(cx * 1.3, seed)));",
          "      if (isB > 0.5 && fv < 0.34 && abs(fu - 0.5) < 0.44) { wall = mix(wall, wcol * 1.1 + 0.04, 1.0 - far); inWin = 0.0; }",
          "      if (isB > 0.5 && fv > 0.34 && fv < 0.38 && abs(fu - 0.5) < 0.44) wall *= 0.6;",
          "    }",
          "    if (fam > 25.5 && fam < 26.5 && txd < 0.5 && (cx < 0.5 || cx > nC - 1.5)) wall = mix(wall, mkAcc(vr + 2.0) * 0.8 + 0.12, 0.65);",
          "    if (fam > 20.5 && fam < 21.5) {",
          "      if (row < 0.5 && v > B.x) wall *= 1.0 - 0.18 * step(fract(v / 0.55), 0.07) * (1.0 - far);",
          "      if (row > 0.5 && fv > 0.955) wall = mix(wall, wcol * 1.12 + 0.03, 1.0 - far);",
          "      if (topZ > 0.5) { float czz = (v - (wallH - par)) / par; wall = wcol * (czz < 0.12 ? 0.62 : 1.12) * (0.95 + 0.1 * step(0.5, fract(u / 0.55)) * step(czz, 0.45)); }",
          "    }",
          "    if (fam > 31.5 && fam < 32.5) {",
          "      if (vr < 2.5) { float rw = floor(v * 4.0); float bx = fract(u * 2.0 + mod(rw, 2.0) * 0.5);",
          "        wall *= mix(1.0, 0.8, max(step(fract(v * 4.0), 0.08), step(bx, 0.05)) * (1.0 - far)); }",
          "      else wall *= 1.0 - 0.12 * step(fract(v / 1.2), 0.04) * (1.0 - far);",
          "      inWin = (1.0 - smoothstep(0.47 - e.x, 0.47, abs(fu - 0.5))) * step(0.52, fv) * step(fv, 0.82) * (1.0 - topZ) * step(4.0, len);",
          "    }",
          "    if (fam > 32.5 && fam < 33.5 && vr > 3.5) wall *= 1.0 - 0.1 * step(fract(v / 0.24), 0.1) * (1.0 - far);",
          "    if (fam > 33.5 && fam < 34.5 && fv < wb && row > 0.5) wall = mix(wall, mkAcc(seed + vr) * 0.85 + 0.12, 0.45 * (1.0 - far));",
          "    if (fam > 35.5 && fam < 36.5) {",
          "      inWin = 0.0;",
          "      if (len > 7.0 && v < 2.15) { float gg = step(0.08, fu) * step(fu, 0.92);",
          "        vec3 gc = mix(vec3(0.33, 0.36, 0.33), vec3(0.42, 0.3, 0.22), step(0.5, fcH(vec2(cx, seed)))) * (0.8 + 0.4 * fcH(vec2(cx + 3.0, seed)));",
          "        gc *= 1.0 - 0.15 * step(0.5, fract(v * 3.5)); wall = mix(wall, gc, gg * (1.0 - far)); }",
          "    }",
          "    if (fam > 36.5 || (fam < 20.5 && vr > 5.5)) inWin = step(0.03, fu) * step(fu, 0.97) * step(wb, fv) * step(fv, wt) * (1.0 - topZ) * step(2.2, len);",
          "    if (v < B.x && shopW < 0.5) { wall = ((fam > 20.5 && fam < 21.5) ? vec3(0.16, 0.14, 0.13) : wcol * 0.55) * (0.9 + 0.2 * fcN(vec2(u, v) * 2.0)); inWin = 0.0; }",
          "    if (v > wallH - 0.22 && (fam < 20.5 || fam > 21.5)) wall *= 0.82;",
          "    float shopBand = 0.0;",
          "    if (shopW > 0.5 && row < 0.5) {",
          "      float sw = step(0.07, fu) * step(fu, 0.93) * step(2.2, len);",
          "      float stl = (fam > 20.5 && fam < 21.5) ? 1.0 : 0.0;",
          "      float topS = G0 - (stl > 0.5 ? 1.0 : 0.65);",
          "      float inS = sw * step(0.45, v) * step(v, topS);",
          "      if (stl > 0.5) { float ar = 0.43 * cw; float ac = topS - ar; inS = sw * step(0.45, v) * (v < ac ? 1.0 : step(length(vec2((fu - 0.5) * cw, v - ac)), ar)); }",
          "      if (v > topS && v < G0 - 0.05 && stl < 0.5) wall *= 0.45;",
          "      if (v < 0.45) wall = vec3(0.12, 0.12, 0.13);",
          "      inWin = inS; shopBand = inS;",
          "    }",
          "    float wr = fcH(vec2(cx, row) + seed * 0.013);",
          "    float frameK = 0.0;",
          "    if (inWin > 0.5 && txd < 0.5 && shopBand < 0.5) {",
          "      float wpx = (fu - 0.5) * cw; float wpy = (fv - (wb + wt) * 0.5) * Fh; float hwm = ww * cw; float hhm = (wt - wb) * Fh * 0.5;",
          "      float edg = step(hwm - 0.07, abs(wpx)) + step(hhm - 0.07, abs(wpy));",
          "      if (glazeT > -0.5) edg += step(abs(fract((u + 0.4) / 1.1) - 0.5), 0.03) + step(abs(wpy - hhm * 0.35), 0.03);",
          "      else if (hwm > 0.6) edg += step(abs(wpx), 0.04) + step(abs(wpy - hhm * 0.45), 0.03) * step(0.0, wpx);",
          "      frameK = clamp(edg, 0.0, 1.0) * (1.0 - far);",
          "    }",
          "    vec3 frameC = (wr < 0.68 || glazeT == 0.0) ? vec3(0.9, 0.9, 0.88) : (wr < 0.88 || glazeT == 1.0) ? vec3(0.32, 0.2, 0.12) : vec3(0.62, 0.64, 0.66);",
          "    if (txd < 0.5 && inWin < 0.5 && abs(fu - 0.5) < ww && shopBand < 0.5 && glazeT < -0.5) {",
          "      wall *= 1.0 - 0.22 * step(wt, fv) * step(fv, wt + 0.035) * (1.0 - far);",
          "      wall = mix(wall, vec3(0.75), 0.4 * step(wb - 0.025, fv) * step(fv, wb) * (1.0 - far));",
          "    }",
          "    vec3 col = wall; float on = 0.0; vec3 rm = vec3(0.0);",
          "    if (inWin > 0.01) {",
          "      vec3 Vw = normalize(vFcP - cameraPosition); vec3 tng = vec3(vFcN.z, 0.0, -vFcN.x);",
          "      vec3 vl = vec3(dot(Vw, tng), Vw.y, -dot(Vw, vFcN));",
          // вдали (окно в 2–3 пикселя) объём комнаты не виден: вместо трассировки — цвет её стены, плавно по far
          "      vec3 rmF = mix(vec3(0.62,0.55,0.44), vec3(0.47,0.52,0.56), fract(wr * 7.31)) * 0.76;",
          "      rm = far > 0.95 ? rmF : mix(mkRoom(vec2(fu * cw, fv * Fh), vl, vec2(cw, Fh), wr), rmF, far);",
          "      float curtain = step(0.55, fract(wr * 13.7)) * step(0.5, fract(fu * 2.0 + 0.25 * wr));",
          "      rm = mix(rm, mix(vec3(0.78, 0.72, 0.6), vec3(0.6, 0.66, 0.7), fract(wr * 5.3)), curtain * 0.6);",
          "      float fres = pow(1.0 - max(dot(-Vw, vFcN), 0.0), 3.0);",
          "      float dens = 0.3 + 0.9 * fract(seed * 0.131);",
          "      on = shopBand > 0.5 ? uShop : step(wr, uLit * dens);",
          "      vec3 sky = uSky * (0.72 + 0.28 * fcH(vec2(cx, seed)));",
          "      vec3 glass = mix(rm * (0.14 + 0.12 * (1.0 - uNight)), sky, clamp(0.22 + fres * 0.7, 0.0, 0.88) * (1.0 - uNight * 0.85));",
          "      if (fam > 29.5 && fam < 30.5) glass = mix(tcol * 0.9, sky, clamp(0.3 + fres * 0.6, 0.0, 0.85) * (1.0 - uNight * 0.8));",
          "      if (glazeT > 2.5) glass = rm * 0.2;",
          "      col = mix(wall, glass, inWin);",
          "      col = mix(col, frameC, frameK * inWin);",
          "    }",
          "    float ao = 1.0 - (1.0 - smoothstep(0.0, 2.2, v)) * 0.32;",
          "    diffuseColor.rgb = col * ao * (1.0 - uWet * 0.22);",
          "    fcGlass = inWin * (1.0 - frameK) * (1.0 - far * 0.5);",
          "    vec3 warm = mix(vec3(1.0, 0.8, 0.52), vec3(0.78, 0.88, 1.0), step(0.75, fract(wr * 9.7)));",
          "    float litK = inWin * (1.0 - frameK) * on * (glazeT > 2.5 ? 0.3 : 1.0);",
          "    if (shopBand > 0.5) fcEm = vec3(1.0, 0.93, 0.78) * 0.8 * litK * (0.05 + uNight * 1.05);",
          "    else fcEm = (rm * 0.75 + 0.25) * warm * 1.3 * litK * (0.04 + uNight * 1.05);",
          "    if (step(0.97, fract(wr * 37.0)) * litK > 0.5) fcEm = vec3(0.45, 0.6, 1.0) * (0.7 + 0.3 * sin(uTime * 13.0 + wr * 90.0)) * litK * (0.04 + uNight);",
          "  }",
          "}",
          "else",
          "{ float st = floor(vFac.x + 0.5); float seed = floor(vFac.y + 0.5); float tint = vFac.z; float shop = step(0.5, vFac.w);",   // интерполяция «плывёт» — округляем, иначе хэш даёт шум
          "  vec3 wall = fcWall(st) * tint;",
          "  if (vCol.a < 0.5) wall = vCol.rgb * (0.9 + 0.1 * tint);",
          "  if (vFcN.y > 0.5) { diffuseColor.rgb = vec3(0.32,0.31,0.30) * (0.85 + 0.3 * fcH(floor(vFcP.xz * 0.5)));",
          "  } else {",
          "    vec3 tn = normalize(vec3(-vFcN.z, 0.0, vFcN.x) + 1e-5); float u = dot(vFcP, tn); float v = vFcP.y;",
          "    vec2 cs = fcCell(st); vec2 ws = fcWin(st);",
          "    vec2 c = vec2(u / cs.x, v / cs.y); vec2 f = fract(c); vec2 id = floor(c);",
          // окно с мягким краем; вдали узор растворяется в средний цвет — без ряби (fwidth)
          "    vec2 fw = fwidth(c); float far = smoothstep(0.22, 0.55, max(fw.x, fw.y));",
          "    vec2 hw = ws * 0.5; vec2 e = fw * 1.2 + 0.002;",
          "    float inWin = (1.0 - smoothstep(hw.x - e.x, hw.x + e.x, abs(f.x - 0.5))) * (1.0 - smoothstep(hw.y - e.y, hw.y + e.y, abs(f.y - 0.5)));",
          "    inWin = mix(inWin, ws.x * ws.y, far);",
          // текстурные фасады (Минск): цвет и маска окон из атласа 4×4 (верх — цвета, низ — маски), textureGrad — без шва мипов на краю плитки
          "    vec3 tcol = vec3(0.0); vec3 tavg = vec3(0.0); float txd = 0.0;",
          "    if (st > 6.5 && st < 14.5 && uFacOn > 0.5) {",
          "      vec2 ts = fcTile(st); vec2 c2 = vec2(u / ts.x, v / ts.y); vec2 f2 = fract(c2); float k = st - 7.0;",
          "      vec2 org = vec2(mod(k, 4.0), 3.0 - floor(k / 4.0)) * 0.25;",
          "      vec2 gx = dFdx(c2) * 0.24; vec2 gy = dFdy(c2) * 0.24; vec2 tuv = org + 0.005 + f2 * 0.24;",
          "      tcol = textureGrad(uFacTex, tuv, gx, gy).rgb; float tm = textureGrad(uFacTex, tuv - vec2(0.0, 0.5), gx, gy).r;",
          "      tavg = textureLod(uFacTex, org + 0.125, 8.0).rgb;",
          "      if (st > 12.5 && st < 13.5) { vec3 pal = fcPal(seed); tcol *= mix(pal, vec3(1.0), tm); tavg *= pal; }",   // Верхний город и Троицкое — пастель по дому
          "      if (vCol.a < 0.5) { float l = dot(tcol, vec3(0.3, 0.59, 0.11)) / max(dot(tavg, vec3(0.3, 0.59, 0.11)), 0.05); tcol = mix(tcol, vCol.rgb * l, 1.0 - tm); tavg = vCol.rgb; }",
          "      if (st < 8.5 && v < 1.3) { tcol = vec3(0.21, 0.19, 0.18) * (0.85 + 0.3 * fcH(floor(vec2(u * 1.5, v * 2.5)))); tm = 0.0; }",   // гранитный цоколь сталинки
          "      tcol *= mix(tint, 1.0, 0.6); wall = tcol; inWin = tm; id = floor(c2 * 2.0) + 17.0; txd = 1.0;",
          "    }",
          "    if (st > 14.5) {",                                                    // 15 — глухая стена, 16 — редкие высокие окна
          "      vec2 c3 = vec2(u / 5.0, v / 7.5); vec2 f3 = fract(c3); vec2 e3 = fwidth(c3) * 1.2 + 0.002;",
          "      inWin = st > 15.5 ? (1.0 - smoothstep(0.11 - e3.x, 0.11 + e3.x, abs(f3.x - 0.5))) * (1.0 - smoothstep(0.3 - e3.y, 0.3 + e3.y, abs(f3.y - 0.5))) * step(4.0, v) : 0.0;",
          "      inWin = mix(inWin, st > 15.5 ? 0.13 : 0.0, far); id = floor(c3) + 5.0;",
          "      wall *= 0.94 + 0.06 * fcH(floor(vec2(u * 0.7, v * 1.4))) - 0.05 * step(0.93, f3.y) * (1.0 - far);",
          "    }",
          "    float base = 1.0 - smoothstep(0.0, 2.5, v);",                     // тёмный низ — затенение у земли
          "    if (st > 4.5 && st < 5.5) { inWin = 0.0; wall *= 0.88 + 0.12 * step(0.5, fract(u * 1.2)); }",   // гофра ангара
          "    if (st > 2.5 && st < 3.5) { if (f.x < 0.12) wall *= 0.88; if (abs(f.y - 0.95) < 0.05) wall *= 1.08; }",   // пилястры и карнизы сталинки
          "    if (st > 1.5 && st < 2.5) { float row = floor(v * 4.0); float bx = fract(u * 2.0 + mod(row, 2.0) * 0.5);",       // кирпич
          "      float mortar = max(step(fract(v * 4.0), 0.08), step(bx, 0.05)); wall *= mix(1.0, 0.78, mortar * (1.0 - far)) * (0.94 + 0.12 * fcH(vec2(row, floor(u * 2.0)))); }",
          "    if (st > 0.5 && st < 1.5) {",                                                    // панелька: швы и балконы
          "      if (abs(f.y - 0.02) < 0.02 || abs(f.x - 0.01) < 0.01) wall *= 0.84;",
          "      float bal = step(0.45, fcH(vec2(id.x * 1.7, seed))) * step(1.0, id.y);",
          "      if (bal > 0.5 && f.y < 0.34 && abs(f.x - 0.5) < 0.46) { float bars = step(0.5, fract(u * 6.0)) * 0.08; wall = vec3(0.86,0.84,0.78) * tint * (0.92 + bars); inWin *= 0.0; }",
          "      if (bal > 0.5 && f.y > 0.34 && f.y < 0.4 && abs(f.x - 0.5) < 0.46) wall *= 0.55;",   // тень под балконом выше
          "    }",
          "    if (st < 0.5) { float band = step(fract(v / 3.5), 0.12); inWin *= 1.0 - band * 0.85; }",     // перекрытия стеклянной башни
          "    float shopBand = shop * (1.0 - step(4.4, v));",
          "    if (shopBand > 0.5) { inWin = step(0.35, v) * step(v, 3.6) * step(0.06, f.x) * step(f.x, 0.94); id = vec2(id.x, -7.0); if (txd > 0.5) { wall = tavg * 0.9; txd = 0.0; } }",
          "    else if (v < 3.4 && st > 0.5) inWin *= 0.6;",
          "    float r = fcH(id + seed * 0.013);",
          "    vec3 glass = mix(vec3(0.09,0.13,0.19), vec3(0.30,0.40,0.50), r * 0.6);",
          "    if (st < 0.5) glass = mix(vec3(0.16,0.30,0.40), vec3(0.36,0.54,0.64), fcH(vec2(id.y, seed)) * 0.7);",
          "    if (txd > 0.5) glass = tcol * (0.8 + 0.4 * r);",                  // текстурное стекло: своё, с разбросом по окнам
          // отражение неба в стекле: чем более скользящий взгляд, тем больше неба (френель без карты окружения)
          "    vec3 vd = normalize(cameraPosition - vFcP); float fres = pow(1.0 - max(dot(vd, vFcN), 0.0), 3.0);",
          "    glass = mix(glass, uSky * (0.75 + 0.25 * fcH(vec2(id.x, seed))), clamp(0.18 + fres * 0.7, 0.0, 0.85) * (1.0 - uNight * 0.8));",
          "    diffuseColor.rgb = mix(wall, glass, inWin) * (1.0 - base * 0.35);",
          "    fcGlass = inWin * (1.0 - far * 0.5);",
          // свет в окнах: доля зажжённых растёт вечером (uLit), у каждого дома своя плотность; витрины — в часы работы
          "    float dens = 0.25 + 0.95 * fract(seed * 0.131);",   // у каждого дома своя доля горящих окон: от сонных до офисов-полуночников
          "    float on = shopBand > 0.5 ? uShop : step(r, uLit * dens);",
          "    fcLit = inWin * on * (0.6 + 0.4 * fcH(id + 3.1));",
          "    fcTv = step(0.97, fract(r * 37.0));",
          "  }",
          "  diffuseColor.rgb *= 1.0 - uWet * 0.25;",
          "}"].join("\n"))
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, fcGlass); roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.5, uWet);")
        .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.3, fcGlass * step(vFac.x, 0.5));")
        .replace("#include <emissivemap_fragment>", [
          "#include <emissivemap_fragment>",
          "{ vec3 warm = mix(vec3(1.0,0.76,0.42), vec3(0.75,0.88,1.0), step(0.72, fract(fcLit * 13.7)));",
          "  if (vFac.w > 0.5 && vFcP.y < 4.4) warm = vec3(1.0, 0.9, 0.7);",
          "  if (fcTv > 0.5) warm = vec3(0.5, 0.65, 1.0) * (0.75 + 0.25 * sin(uTime * 13.0 + fcLit * 90.0));",   // телевизор
          "  totalEmissiveRadiance += warm * fcLit * (0.06 + uNight * 1.0) + fcEm; }"].join("\n"))
        .replace("#include <clipping_planes_fragment>", CUT_FRAG("vFcP"))
        .replace("#include <fog_fragment>", FOG_FRAG("vFcP"));
    };
    return m;
  }

  /* ---- шейдер дороги: разметка из uv (u — поперёк 0..1, v — метры вдоль) и мокрый асфальт ---------------------- */
  // aRoad: x — полос в одну сторону (0 — перекрёсток), y — 1 у проспекта/шоссе (двойная сплошная), z — зебра у концов
  function roadMaterial() {
    var m = new T.MeshStandardMaterial({ color: 0x3b3e43, roughness: 0.92, metalness: 0.0, envMapIntensity: 0.5 });
    m.customProgramCacheKey = function () { return "fc-road-2"; };
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uWet = G.wet; sh.uniforms.uSnowR = LOOK.uSnow; fogUniforms(sh);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec3 aRoad; varying vec3 vRoad; varying vec2 vRUv; varying vec2 vRP;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRoad = aRoad; vRUv = uv; vec4 rpw = modelMatrix * vec4(transformed,1.0); vRP = rpw.xz;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uWet, uSnowR; varying vec3 vRoad; varying vec2 vRUv; varying vec2 vRP; float rWet = 0.0;\nfloat rH(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }" + FOG_PARS)
        .replace("#include <color_fragment>", [
          "#include <color_fragment>",
          "{ float lanes = vRoad.x; float u = vRUv.x; float v = vRUv.y; vec3 col = diffuseColor.rgb;",
          "  float grain = rH(floor(vRP * 3.0)) * 0.06 + rH(floor(vRP * 0.4)) * 0.05; col *= 0.92 + grain;",
          "  float paint = 0.0; vec3 pc = vec3(0.92);",
          // Минск (aRoad.y ≥ 4): полосы по OSM, ширина в метрах (aRoad.z); односторонние полотна проспектов — пунктир
          // между рядами и сплошные по краям; двусторонние — двойная сплошная у магистралей; заплаты и накатанные колеи
          "  if (vRoad.y > 3.5) {",
          "    float fl = vRoad.y - 4.0; float major = mod(fl, 2.0); float one = step(1.5, fl); float W = max(vRoad.z, 2.0); float x = (u - 0.5) * W;",
          "    float ln = max(lanes, 1.0); float pw = 0.07; float fwx = fwidth(x) * 1.2 + 0.01; float dsh = step(fract(v / 9.0), 0.34);",
          "    float pnt = 0.0;",
          "    if (lanes > 0.5) {",
          "      float edgeX = W * 0.5 - 0.35; pnt = (1.0 - smoothstep(pw, pw + fwx, abs(abs(x) - edgeX))) * max(major, one);",
          "      if (one > 0.5) { float lw = (W - 0.7) / ln; float xx = x + edgeX; float k = floor(xx / lw + 0.5);",
          "        if (k > 0.5 && k < ln - 0.5) pnt = max(pnt, (1.0 - smoothstep(pw, pw + fwx, abs(xx - k * lw))) * dsh); }",
          "      else { float cl = major > 0.5 ? (1.0 - smoothstep(pw, pw + fwx, abs(abs(x) - 0.16))) : (1.0 - smoothstep(pw, pw + fwx, abs(x))) * dsh;",
          "        pnt = max(pnt, cl); float lw2 = edgeX / ln; float xa = abs(x); float k2 = floor(xa / lw2 + 0.5);",
          "        if (k2 > 0.5 && k2 < ln - 0.5) pnt = max(pnt, (1.0 - smoothstep(pw, pw + fwx, abs(xa - k2 * lw2))) * dsh); }",
          "      float lwc = one > 0.5 ? (W - 0.7) / ln : (W * 0.5 - 0.35) / ln; float xl = one > 0.5 ? x + W * 0.5 - 0.35 : abs(x);",
          "      float inl = abs(fract(xl / lwc) - 0.5) * lwc; col *= 1.0 + 0.05 * (1.0 - smoothstep(0.0, 0.35, abs(inl - 0.85)));",   // колеи
          "    }",
          "    float pch = step(0.74, rH(floor(vRP / vec2(3.4, 2.3)))) * step(0.45, rH(floor(vRP / 9.0) + 3.0));",
          "    col *= (1.0 - pch * 0.13) * (0.93 + 0.09 * rH(floor(vRP * 0.11)));",
          "    col = mix(col, vec3(0.92, 0.92, 0.9), pnt * 0.86 * (1.0 - uSnowR * 0.5));",
          "    col = mix(col, vec3(0.44, 0.4, 0.36), uSnowR * smoothstep(0.42, 0.5, abs(u - 0.5)) * 0.8);",   // зимой — бурая каша у бордюров
          "  } else {",
          "  if (lanes > 0.5) {",
          "    float w = vRoad.y > 0.5 ? 0.008 : 0.006;",
          "    float centre = step(abs(u - 0.5), w);",
          "    if (vRoad.y > 0.5) { centre = step(abs(abs(u - 0.5) - 0.012), 0.004); pc = vec3(0.95,0.8,0.3); }",
          "    else centre *= step(0.5, fract(v / 6.0));",
          "    float lw = 0.5 / lanes; float lane = 0.0;",
          "    for (int k = 1; k < 3; k++) { if (float(k) < lanes) { float o = float(k) * lw; lane += step(abs(abs(u - 0.5) - o), 0.004) * step(0.55, fract(v / 9.0)); } }",
          "    float edge = step(abs(abs(u - 0.5) - 0.46), 0.006);",
          "    paint = max(max(centre, lane), edge);",
          "    if (centre > 0.5 && vRoad.y > 0.5) paint = 2.0;",
          "    float zebra = vRoad.z * step(v, 4.0) * step(0.5, fract(u * 9.0));",
          "    if (zebra > 0.5) { paint = 1.0; pc = vec3(0.95); }",
          "  }",
          "  if (paint > 1.5) col = mix(col, pc, 0.9); else col = mix(col, pc, paint * 0.85);",
          "  }",
          "  float puddle = smoothstep(0.55, 0.7, rH(floor(vRP * 0.25)) * 0.6 + rH(floor(vRP * 0.9)) * 0.4);",
          "  rWet = uWet * (0.6 + 0.4 * puddle);",
          "  col *= 1.0 - rWet * 0.35;",
          "  diffuseColor.rgb = col; }"].join("\n"))
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.08, rWet);")
        .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.3, rWet);")
        .replace("#include <clipping_planes_fragment>", CUT_FRAG("vec3(vRP.x, 0.0, vRP.y)"))
        .replace("#include <fog_fragment>", FOG_FRAG("vec3(vRP.x, 0.0, vRP.y)"));
    };
    return m;
  }

  /* ---- вода: волны и блики в вершинах и фрагментах --------------------------------------------------------- */
  var waterU = { uTime: { value: 0 }, uNight: facadeU.uNight };
  function waterMaterial() {
    var m = new T.MeshStandardMaterial({ color: 0x1d5f7a, roughness: 0.15, metalness: 0.2, envMapIntensity: 1.2, transparent: true, opacity: 0.92 });
    m.customProgramCacheKey = function () { return "fc-water-2"; };
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uTime = waterU.uTime;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vWP; uniform float uTime;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvec4 wwp = modelMatrix * vec4(transformed,1.0); vWP = wwp.xz;");
      fogUniforms(sh);
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec2 vWP; uniform float uTime;" + FOG_PARS)
        .replace("#include <normal_fragment_maps>", [
          "#include <normal_fragment_maps>",
          "{ float a = sin(vWP.x * 0.35 + uTime * 1.3) * 0.5 + sin(vWP.y * 0.27 - uTime * 1.1) * 0.5 + sin((vWP.x + vWP.y) * 0.9 + uTime * 2.3) * 0.25;",
          "  float b = cos(vWP.y * 0.33 + uTime * 1.2) * 0.5 + cos(vWP.x * 0.8 - uTime * 1.9) * 0.25;",
          "  normal = normalize(normal + (viewMatrix * vec4(a * 0.12, 0.0, b * 0.12, 0.0)).xyz); }"].join("\n"))
        .replace("#include <color_fragment>", "#include <color_fragment>\n{ float f = sin(vWP.x * 0.05 + uTime * 0.2) * 0.5 + 0.5; diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12,0.45,0.5), f * 0.25); }")
        .replace("#include <clipping_planes_fragment>", CUT_FRAG("vec3(vWP.x, 0.0, vWP.y)"))
        .replace("#include <fog_fragment>", FOG_FRAG("vec3(vWP.x, 0.0, vWP.y)"));
    };
    return m;
  }

  /* ---- Минск: земля (газоны, тротуары, бордюры — цвет вершин), подложка, деревья: шум против «пластика», снег,
   * мокрое, воздушная перспектива ------------------------------------------------------------------------------- */
  var NOISE_GLSL = "float gH(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }\n" +
    "float gN(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(gH(i),gH(i+vec2(1,0)),f.x), mix(gH(i+vec2(0,1)),gH(i+vec2(1,1)),f.x), f.y); }\n";
  function worldVary(sh) {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vGW; varying vec3 vGN;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvec4 gw4 = vec4(transformed, 1.0); vec3 gn3 = objectNormal;\n#ifdef USE_INSTANCING\ngw4 = instanceMatrix * gw4; gn3 = mat3(instanceMatrix) * gn3;\n#endif\nvGW = (modelMatrix * gw4).xyz; vGN = normalize(mat3(modelMatrix) * gn3);");
  }
  function groundMaterial(plane) {
    var m = new T.MeshStandardMaterial(plane ? { color: 0x56663f, roughness: 1 } : { vertexColors: true, roughness: 0.95 });
    m.customProgramCacheKey = function () { return plane ? "fc-ground-plane" : "fc-ground"; };
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uWet = G.wet; sh.uniforms.uSnow = LOOK.uSnow; fogUniforms(sh);
      worldVary(sh);
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uWet, uSnow; varying vec3 vGW; varying vec3 vGN; float gWet = 0.0;\n" + NOISE_GLSL + FOG_PARS)
        .replace("#include <color_fragment>", [
          "#include <color_fragment>",
          "{ vec3 c = diffuseColor.rgb; float up = smoothstep(0.6, 0.95, vGN.y);",
          "  float green = step(c.r * 1.06, c.g) * step(c.b * 1.12, c.g);",
          "  float n1 = gN(vGW.xz * 0.06), n2 = gN(vGW.xz * 0.55), n3 = gN(vGW.xz * 3.1);",
          "  c *= 0.86 + 0.18 * n1 + 0.08 * n2;",
          "  if (green > 0.5) { c = mix(c, c * vec3(1.12, 1.02, 0.72), smoothstep(0.55, 0.8, n1) * 0.7); c *= 0.92 + 0.12 * n3; }",   // выгоревшие и тёмные пятна травы
          "  else if (up > 0.5 && vGW.y > 0.08 && vGW.y < 0.13) {",                       // плитка тротуаров 0,5 м, у края — полоса
          "    vec2 tp = fract(vGW.xz * 2.0); float jt = step(0.94, max(tp.x, tp.y)); c *= 1.0 - 0.1 * jt; c *= 0.96 + 0.06 * gH(floor(vGW.xz * 2.0)); }",
          "  float snow = uSnow * up * (green > 0.5 ? 1.0 : 0.8) * smoothstep(0.25, 0.55, n2 * 0.5 + n1 * 0.5 + 0.3);",
          "  c = mix(c, vec3(0.88, 0.9, 0.94), snow);",
          "  gWet = uWet * (1.0 - green) * (1.0 - snow);",
          "  diffuseColor.rgb = c * (1.0 - gWet * 0.3); diffuseColor.a = 1.0; }"].join("\n"))
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.25, gWet);")
        .replace("#include <clipping_planes_fragment>", CUT_FRAG("vGW"))
        .replace("#include <fog_fragment>", FOG_FRAG("vGW"));
    };
    return m;
  }
  function treeMaterial() {
    var m = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    m.customProgramCacheKey = function () { return "fc-tree"; };
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uSnow = LOOK.uSnow; sh.uniforms.uOver = LOOK.uOver; fogUniforms(sh);
      worldVary(sh);
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uSnow, uOver; varying vec3 vGW; varying vec3 vGN;\n" + NOISE_GLSL + FOG_PARS)
        .replace("#include <color_fragment>", [
          "#include <color_fragment>",
          "{ vec3 c = diffuseColor.rgb; float leaf = step(c.r * 1.1, c.g);",
          "  c *= 0.85 + 0.3 * gN(vGW.xz * 0.9 + vGW.y * 0.7);",
          "  float l = dot(c, vec3(0.3, 0.59, 0.11)); c = mix(c, vec3(l), leaf * uOver * 0.3);",               // пасмурно — зелень глуше
          "  c = mix(c, vec3(0.86, 0.88, 0.92), uSnow * smoothstep(0.35, 0.8, vGN.y) * 0.85);",
          "  diffuseColor.rgb = c; }"].join("\n"))
        .replace("#include <fog_fragment>", FOG_FRAG("vGW"));
    };
    return m;
  }

  /* ---- общие материалы и холсты ------------------------------------------------------------------------------- */
  var matCache = {};
  function std(hex, rough, metal, extra) {
    var k = hex + "|" + rough + "|" + metal + "|" + (extra ? JSON.stringify(extra) : "");
    if (!matCache[k]) {
      matCache[k] = new T.MeshStandardMaterial(Object.assign({ color: hex, roughness: rough == null ? 0.8 : rough, metalness: metal || 0 }, extra || {}));
    }
    return matCache[k];
  }
  function canvasTex(w, h, draw) {
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    var t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }
  // Вывеска: эмодзи + название на цветной плашке; светится ночью (emissive = та же картинка).
  var signCache = {};
  function signTex(title, emoji, color) {
    var k = title + emoji + color;
    if (signCache[k]) return signCache[k];
    var t = canvasTex(512, 128, function (x, w, h) {
      x.fillStyle = "#0e1220"; x.fillRect(0, 0, w, h);
      var g = x.createLinearGradient(0, 0, w, 0); g.addColorStop(0, color); g.addColorStop(1, shade(color, -0.35));
      x.fillStyle = g; x.fillRect(6, 6, w - 12, h - 12);
      x.font = "72px system-ui, Apple Color Emoji, Segoe UI Emoji"; x.textBaseline = "middle"; x.textAlign = "left";
      x.fillText(emoji || "", 18, h / 2 + 4);
      x.fillStyle = "#fff"; x.font = "700 " + (title.length > 14 ? 34 : 46) + "px system-ui, sans-serif";
      x.shadowColor = "rgba(0,0,0,.5)"; x.shadowBlur = 6;
      x.fillText(title.slice(0, 22), emoji ? 108 : 24, h / 2 + 3);
    });
    signCache[k] = t;
    return t;
  }
  function shade(hex, k) {
    var c = new T.Color(hex);
    if (k < 0) c.multiplyScalar(1 + k); else c.lerp(new T.Color(1, 1, 1), k);
    return "#" + c.getHexString();
  }
  // мягкое пятно (ореол фонаря, тень, фары)
  var glowTex = canvasTex(64, 64, function (x, w, h) {
    var g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.35, "rgba(255,255,255,.45)"); g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g; x.fillRect(0, 0, w, h);
  });
  var blobTex = canvasTex(64, 64, function (x, w, h) {
    var g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, "rgba(0,0,0,.55)"); g.addColorStop(0.6, "rgba(0,0,0,.25)"); g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g; x.fillRect(0, 0, w, h);
  });

  /* ---- кадр ------------------------------------------------------------------------------------------------ */
  var sunStepT = 0, sunDir = new T.Vector3(0, 1, 0), lightM = new T.Matrix4(), lightInv = new T.Matrix4(), snapV = new T.Vector3();
  var ORIGIN = new T.Vector3(0, 0, 0), UP = new T.Vector3(0, 1, 0), shadowsOn = true, wasIndoor = false;
  var fpsT = 0, fpsN = 0, started = performance.now(), downgraded = false;
  /* ---- частота кадров и «удержание» ------------------------------------------------------------------------
   * Частота: по умолчанию 60 к/с. На экранах 120 Гц (MacBook, многие Android) цикл рисовал 120 кадров — вдвое больше
   * работы видеокарте и процессору ради плавности, которую в игре почти не видно (замер 26.11: Минск на MacBook — 120 к/с,
   * видеокарта занята ~70%). Настройка «Плавность» в «Настройках» телефона: 30 — экономно, 60, «макс» — как частота
   * экрана; хранится в localStorage fc.fps; ?cap=30|60|0 — для замеров. Лишние кадры экрана пропускаем по накопителю
   * времени (90/120/144 Гц дают ровные 60 в среднем), время пропущенных кадров уходит в dt следующего.
   * Удержание: пауза, большая карта, мини-игра закрывают город — сцена рисуется один раз и стоит (картинка на холсте
   * остаётся), пока удержание не снято; мир под картой считается не чаще 30 раз в секунду. */
  var capQs = (global.location.search.match(/[?&]cap=(\d+)/) || [])[1];
  function capRead() {
    if (capQs != null) return +capQs;
    var v = null; try { v = global.localStorage.getItem("fc.fps"); } catch (e) { v = null; }
    return v === "30" ? 30 : v === "max" ? 0 : 60;
  }
  var capFps = capRead(), capAcc = 0, capPrev = 0;
  var holds = {}, holdN = 0, holdDrawn = false;
  G.cap = function () { return capFps; };
  G.setCap = function (n) {
    capFps = n === 30 ? 30 : n === 0 ? 0 : 60; capAcc = 0;
    try { global.localStorage.setItem("fc.fps", capFps === 0 ? "max" : String(capFps)); } catch (e) { /* приватное окно */ }
    FC.emit("fps:cap", capFps);
  };
  // кадр экрана — считать ли его (fmain зовёт до систем): false — пропустить, время копится до следующего
  G.tick = function (now) {
    var fps = holdN > 0 ? (capFps ? Math.min(capFps, 30) : 30) : capFps;
    var d = now - capPrev; capPrev = now;
    if (!fps) return true;
    var iv = 1000 / fps;
    capAcc = d > 250 ? iv : capAcc + d;
    if (capAcc < iv * 0.85) return false;              // запас 15%: на 60 Гц не теряем кадры из-за дрожания отметок
    capAcc -= iv; if (capAcc > iv) capAcc = 0;          // после рывка не «догоняем» пачкой кадров
    return true;
  };
  G.hold = function (k, on) {
    on = !!on; if (!!holds[k] === on) return;
    holds[k] = on; holdN += on ? 1 : -1; holdDrawn = false;
  };
  G.held = function () { return holdN > 0; };
  // строка «Плавность» в «Настройках» телефона — сразу под «Графикой»
  FC.on("phone:settings", function (list) {
    if (!list) return;
    var row = document.createElement("div"); row.className = "row";
    row.innerHTML = "<span>Плавность</span><select id='fps-sel'><option value='30'>экономно · 30 к/с</option>" +
      "<option value='60'>60 к/с</option><option value='0'>максимум</option></select>";
    var sel = row.querySelector("select"); sel.value = String(capFps);
    sel.addEventListener("change", function () { G.setCap(+sel.value); });
    var q = list.querySelector("#q-sel"), qr = q && q.parentNode;
    if (qr && qr.parentNode === list && qr.nextSibling) list.insertBefore(row, qr.nextSibling); else list.appendChild(row);
  });
  function frame(dt) {
    if (holdN > 0 && holdDrawn) return;                 // город закрыт паузой/картой — кадр уже на холсте
    applyTime();
    facadeU.uNight.value = FC.clock.night;
    facadeU.uSky.value.copy(skyU.uHor.value).lerp(skyU.uTop.value, 0.35);
    // доля зажжённых окон: днём 0, к 18:00 — 0.15, к 21:00 — 0.55, к часу ночи 0.25, к 4:00 — 0.08; витрины открыты 8–22
    var hh = FC.clock.t / 3600;
    facadeU.uLit.value = hh < 1 ? 0.55 - hh * 0.3 : hh < 4 ? 0.25 - (hh - 1) * 0.057 : hh < 6.5 ? 0.08 * (6.5 - hh) / 2.5 + 0.02 :
      hh < 17 ? 0.02 : hh < 18 ? 0.02 + (hh - 17) * 0.13 : hh < 21 ? 0.15 + (hh - 18) * 0.133 : 0.55;
    facadeU.uShop.value = hh >= 8 && hh < 22 ? 1 : 0.15;
    waterU.uTime.value += dt;
    skyU.uTime.value += dt;
    sky.position.copy(camera.position);
    // тень следует за игроком с привязкой к текселю карты теней в пространстве света — тени не «плавают»;
    // солнце поворачиваем ступенями раз в секунду; ночью карту теней не перерисовываем (солнца нет — экономим проход)
    var tg = G.focus || camera.position, d = skyU.uSun.value;
    sunStepT -= dt;
    if (sunStepT <= 0) { sunStepT = 1; sunDir.copy(d); lightM.lookAt(sunDir, ORIGIN, UP); lightInv.copy(lightM).invert(); }
    snapV.set(tg.x, 0, tg.z).applyMatrix4(lightInv);
    var texel = 2 * SC / Q.shadowSize;
    snapV.x = Math.round(snapV.x / texel) * texel; snapV.y = Math.round(snapV.y / texel) * texel;
    snapV.applyMatrix4(lightM);
    sun.target.position.copy(snapV);
    sun.position.copy(snapV).addScaledVector(sunDir, 220);
    // внутри здания солнечные тени не видны (свет — потолочный): проход теней по городу не рисуем; город за окнами —
    // только ближний (дальше — дымка), иначе в интерьере рисовался весь город (~600 тыс. треугольников, замер 22.11)
    var indoor = !!(FC.inside && FC.inside.active);
    if (indoor !== wasIndoor) {
      wasIndoor = indoor;
      camera.far = indoor ? 420 : Q.far + 400; camera.updateProjectionMatrix();
      if (scene.fog) { scene.fog.far = indoor ? 380 : Q.far; }
    }
    var up = sunDir.y > 0.12 && FC.clock.night < 0.6 && !indoor;
    if (Q.shadows) {
      // солнце и фары игрока (fcars, G.spotShadow) — у каждого света своя карта: рисуем только ту, что нужна
      if (up !== shadowsOn) { shadowsOn = up; sun.shadow.needsUpdate = true; renderer.shadowMap.needsUpdate = true; }
      sun.shadow.autoUpdate = up;
      renderer.shadowMap.autoUpdate = up || !!G.spotShadow;
    }
    updateRain(dt);
    weatherTick();
    for (var bi = 0; bi < preRender.length; bi++) preRender[bi]();
    cullInstances();
    if (shadowJobs.length) shadowWork(FC.started ? 1.5 : 8);
    gpuBegin();
    if (composer) {
      bloom.strength = 0.3 + FC.clock.night * 0.35;
      composer.render(dt);
    } else renderer.render(scene, camera);
    gpuEnd();
    holdDrawn = holdN > 0;
    // авто-качество: первые 8 секунд
    fpsT += dt; fpsN++;
    if (!downgraded && !qs && !qSaved && fpsT > 2) {
      var fps = fpsN / fpsT; fpsT = 0; fpsN = 0;
      if (fps < 32 && performance.now() - started < 12000 && Q.tier !== "low") { downgraded = true; setQuality(Q.tier === "ultra" ? "high" : Q.tier === "high" ? "mid" : "low"); }
    }
    dynRes();
    fpsTick();
  }
  /* ?fps — счётчик в углу (для жалоб «лагает» и «греется»): кадры в секунду и худший кадр; работа кадра — JS (системы
   * и рендер, мс), GPU (мс, где браузер даёт таймер; на iPhone — «—»), вызовы отрисовки и треугольники за кадр целиком
   * (с тенями); качество, свечение, масштаб рендера, ограничение частоты. */
  var fpsBox = null, fpsB = { t: 0, n: 0, worst: 0, last: 0, js: 0, gpu: 0, gn: 0, calls: 0, tris: 0 };
  function fpsTick() {
    if (fpsBox === null) {
      fpsBox = false;
      if (!/[?&]fps\b/.test(global.location.search || "")) return;
      renderer.info.autoReset = false;
      fpsBox = document.createElement("div");
      fpsBox.style.cssText = "position:fixed;left:50%;top:6px;transform:translateX(-50%);z-index:99;font:600 11px/1.35 system-ui;color:#fff;" +
        "background:rgba(0,0,0,.6);padding:3px 8px;border-radius:6px;pointer-events:none;white-space:pre;text-align:center";
      document.body.appendChild(fpsBox); fpsB.last = performance.now(); return;
    }
    if (!fpsBox) return;
    var now = performance.now(), d = now - fpsB.last; fpsB.last = now; fpsB.n++; fpsB.t += d; if (d > fpsB.worst) fpsB.worst = d;
    var inf = renderer.info.render; fpsB.calls += inf.calls; fpsB.tris += inf.triangles; inf.calls = 0; inf.triangles = 0;
    fpsB.js += FC.loopMs || 0; if (tq && gpuLast) { fpsB.gpu += gpuLast; fpsB.gn++; }
    if (fpsB.t < 1000) return;
    var n = fpsB.n;
    fpsBox.textContent = Math.round(n * 1000 / fpsB.t) + " к/с · худший кадр " + Math.round(fpsB.worst) + " мс\n" +
      "JS " + (fpsB.js / n).toFixed(1) + " мс · GPU " + (fpsB.gn ? (fpsB.gpu / fpsB.gn).toFixed(1) + " мс" : "—") +
      " · " + Math.round(fpsB.calls / n) + " вызовов · " + Math.round(fpsB.tris / n / 1000) + "k тр\n" +
      Q.tier + (composer && bloom && bloom.enabled ? " + свечение" : "") + " · рендер ×" + (Q.ratio * drScale).toFixed(2) +
      " · " + (capFps ? capFps + " к/с" : "без ограничения");
    fpsB.t = fpsB.n = fpsB.worst = fpsB.js = fpsB.gpu = fpsB.gn = fpsB.calls = fpsB.tris = 0;
  }
  /* Динамическое разрешение (всю игру): мерим работу, а не промежутки между кадрами — при ограничении 60 к/с
   * промежуток всегда ~16,7 мс, и прежняя подстройка, однажды сбавив чёткость, не возвращала её. Окно 2 с:
   *  • есть таймер GPU (EXT_disjoint_timer_query_webgl2: Chrome на компьютере, часть Android) — держим видеокарту
   *    занятой не больше ~70% кадра: дольше — рендер на 10% мельче (до 0,6 от базы), меньше 40% два окна подряд — обратно;
   *  • таймера нет (iPhone) — по пропущенным кадрам: больше 20% кадров опоздали — мельче, опозданий нет два окна — обратно.
   * Меняем редко (смена размера буфера — сама по себе рывок); ?q=… или ?dr=off — без подстройки. */
  var drScale = 1, drT = 0, drN = 0, drMiss = 0, drGood = 0, drLast = performance.now(), drOff = /[?&]dr=off/.test(global.location.search || "");
  var gl = renderer.getContext(), tq = null;
  try { tq = global.__perf ? null : gl.getExtension("EXT_disjoint_timer_query_webgl2"); } catch (e) { tq = null; }   // __perf — стенд tools/perf: у него свой таймер
  var tqCur = null, tqPend = [], gpuSum = 0, gpuN = 0, gpuLast = 0;
  // таймер GPU вокруг рендера кадра: результат читаем через кадр-два, без ожидания
  function gpuBegin() {
    if (!tq || tqCur) return;
    try { tqCur = gl.createQuery(); gl.beginQuery(tq.TIME_ELAPSED_EXT, tqCur); } catch (e) { tq = null; tqCur = null; }
  }
  function gpuEnd() {
    if (!tqCur) return;
    gl.endQuery(tq.TIME_ELAPSED_EXT); tqPend.push(tqCur); tqCur = null;
    var dis = gl.getParameter(tq.GPU_DISJOINT_EXT);
    while (tqPend.length && gl.getQueryParameter(tqPend[0], gl.QUERY_RESULT_AVAILABLE)) {
      var q = tqPend.shift(), ns = gl.getQueryParameter(q, gl.QUERY_RESULT); gl.deleteQuery(q);
      if (!dis) { gpuLast = ns / 1e6; gpuSum += gpuLast; gpuN++; }
    }
    if (tqPend.length > 8) { tqPend.forEach(function (x) { gl.deleteQuery(x); }); tqPend.length = 0; }
  }
  G.gpuMs = function () { return tq ? gpuLast : null; };
  // Режим энергосбережения iPhone (и экраны 30 Гц) сам даёт ровные ~33 мс: это не перегрузка — опоздания считаем от
  // такой частоты. Узнаём по окну: середина промежутков ≥ 1,6 от нашей и почти все рядом с ней.
  var drIv = new Float32Array(240), drIvN = 0;
  function dynRes() {
    var now = performance.now(), ms = now - drLast; drLast = now;
    if (drOff || qs || document.hidden || FC.paused || holdN > 0 || ms > 250) return;      // пауза/свёрнуто — не мерим
    drN++; drT += ms; if (drIvN < drIv.length) drIv[drIvN++] = ms;
    if (drT < 2000) return;
    var iv = 1000 / (capFps || 60), srt = Array.prototype.slice.call(drIv, 0, drIvN).sort(function (a, b) { return a - b; });
    var med = srt[srt.length >> 1] || iv, p90 = srt[Math.floor(srt.length * 0.9)] || iv;
    if (med > iv * 1.6 && p90 < med * 1.25) iv = med;             // частоту ограничивает система, а не нагрузка
    for (var mi = 0; mi < drIvN; mi++) if (drIv[mi] > iv * 1.5) drMiss++;
    var miss = drMiss / Math.max(1, drN), gpu = gpuN >= 10 ? gpuSum / gpuN : -1;
    drT = 0; drN = 0; drMiss = 0; drIvN = 0; gpuSum = 0; gpuN = 0;
    var heavy = gpu >= 0 ? gpu > iv * 0.7 || miss > 0.2 : miss > 0.2;
    var light = gpu >= 0 ? gpu < iv * 0.4 && miss < 0.05 : miss < 0.03;
    var next = drScale;
    if (heavy && drScale > 0.6) { next = Math.max(0.6, Math.round((drScale - 0.1) * 10) / 10); drGood = 0; }
    else if (light && drScale < 1) { if (++drGood >= 2) { next = Math.min(1, Math.round((drScale + 0.1) * 10) / 10); drGood = 0; } }
    else drGood = 0;
    if (next !== drScale) { drScale = next; renderer.setPixelRatio(Q.ratio * drScale); if (composer && composer.setPixelRatio) composer.setPixelRatio(Q.ratio * drScale); resize(); }
  }
  function setQuality(level, save) {
    if (!/^(low|mid|high|ultra)$/.test(level)) return;
    Q.tier = level; applyQ();
    if (save) { try { global.localStorage.setItem("fc.q", level); } catch (e) { /* приватное окно */ } qSaved = level; }
    if (sun.shadow.mapSize.x !== Q.shadowSize) {                    // карта теней другого размера — пересоздать
      sun.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    renderer.setPixelRatio(Q.ratio * (typeof drScale === "number" ? drScale : 1));
    if (composer) composer.setPixelRatio(renderer.getPixelRatio());
    renderer.shadowMap.enabled = Q.shadows; sun.castShadow = Q.shadows;
    // без свечения: холст со сглаживанием — рисуем прямо в него; холст без сглаживания (создан под «высокое») —
    // композер остаётся ради MSAA своего буфера, только свечение выключено
    if (!Q.bloom) { if (canvasAA) composer = null; else if (bloom) bloom.enabled = false; }
    else if (T.EffectComposer) { if (!composer) makeComposer(); else if (bloom) bloom.enabled = true; }
    scene.fog.far = Q.far; camera.far = Q.far + 400; camera.updateProjectionMatrix();
    sky.scale.setScalar(Q.far + 200);
    resize();
    holdDrawn = false;
    FC.emit("quality", Q.level);
  }

  function add(o) { scene.add(o); return o; }
  // атлас текстурных фасадов (виды 7–14) — грузится лениво, только когда он нужен (Минск); до загрузки — процедурные окна
  var facTex = null;
  function facadeTex() {
    if (facTex) return facTex;
    facTex = new T.TextureLoader().load("tex/facades.webp", function () { facadeU.uFacOn.value = 1; });
    facTex.colorSpace = T.SRGBColorSpace;
    facTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    facadeU.uFacTex.value = facTex;
    return facTex;
  }

  G.scene = scene; G.camera = camera; G.renderer = renderer; G.Q = Q; G.sun = sun; G.hemi = hemi;
  // Шейдеры — компилировать заранее и фоном (KHR_parallel_shader_compile), а не в кадре первого показа: в профиле
  // на «телефонной» скорости это был главный рывок (≈0,5 с внутри движка при появлении людей/фасадов, замер 22.11).
  // Невидимые объекты three пропускает — на время вызова включаем их видимость.
  G.warm = function (obj, cb) {
    var done = function () { if (cb) { var f = cb; cb = null; f(); } };
    if (!obj || !renderer.compileAsync) { done(); return; }
    var hidden = [];
    obj.traverse(function (o) { if (o.visible === false) { hidden.push(o); o.visible = true; } });
    var pr = null;
    try { pr = renderer.compileAsync(obj, camera, scene); } catch (e) { pr = null; }
    hidden.forEach(function (o) { o.visible = false; });
    if (pr && pr.then) pr.then(done, done); else done();
    setTimeout(done, 4000);                          // не ждать вечно: на старом WebView без расширения — как раньше
  };
  // точка в кадре камеры (с запасом по краям): машины и люди не появляются и не пропадают на глазах у игрока
  var vView = new T.Vector3();
  G.inView = function (x, y, z) { vView.set(x, y, z).project(camera); return vView.z < 1 && Math.abs(vView.x) < 1.15 && Math.abs(vView.y) < 1.15; };
  /* ---- тени по клеткам ---------------------------------------------------------------------------------------
   * Карта теней покрывает ±60–90 м вокруг игрока, а слитые меши (дома куска Минска 1 км, весь Флейм-Сити) в проходе
   * теней рисовались целиком — до сотен тысяч треугольников каждый кадр (замер 26.11: тени — до 35% треугольников кадра).
   * Для прохода теней у такого меша — «виды» по клеткам: те же позиции (буфер общий, память не растёт), свой отрезок
   * индексов и своя сфера — камера солнца отбрасывает всё, что вне карты. Сам меш в тенях больше не участвует.
   * Виды видимы только на время прохода теней (обёртка shadowMap.render): в three r160 списки основного прохода уже
   * собраны к этому моменту, так что в кадр они не попадают. */
  // перед каждой отрисовкой (и на паузе — фоторежим двигает камеру): отбор по камере у модулей (fosm — куски за дымкой)
  var preRender = [];
  G.beforeRender = function (fn) { preRender.push(fn); };
  var shadowSets = [], shadowJobs = [];
  // в сцене ли объект: у выгруженного куска Минска меш остаётся в своей группе, а группа — уже без родителя
  function inScene(o) { while (o.parent) o = o.parent; return o === scene; }
  // разбиение — кусочками по времени (≤ 1,5 мс за кадр): кусок Минска — до 300 тыс. треугольников, разом это рывок
  G.shadowCells = function (mesh, cell) {
    if (!Q.shadows || !mesh || !mesh.castShadow || !mesh.geometry) return;
    var g = mesh.geometry, pos = g.attributes.position; if (!pos) return;
    var idx = g.index ? g.index.array : null, nTri = ((idx ? idx.length : pos.count) / 3) | 0;
    if (nTri < 256) return;                                             // мелкий меш — как было
    shadowJobs.push({ mesh: mesh, cell: cell || 128, pos: pos, idx: idx, nTri: nTri, t: 0, ph: 0, tb: new Int32Array(nTri), keyOf: {}, B: [], fill: null, ni: null });
  };
  function shadowWork(budget) {
    var t0 = performance.now();
    while (shadowJobs.length && performance.now() - t0 < budget) {
      var J = shadowJobs[0];
      if (J.ph > 0 && !inScene(J.mesh)) { shadowJobs.shift(); continue; }    // кусок выгрузили раньше, чем доделали
      var P = J.pos.array, st = J.pos.itemSize, idx = J.idx, nTri = J.nTri, end = Math.min(nTri, J.t + 8192), t;
      if (J.ph === 0) {                                                   // треугольники → клетки, рамки клеток
        for (t = J.t; t < end; t++) {
          var a = idx ? idx[t * 3] : t * 3, b = idx ? idx[t * 3 + 1] : t * 3 + 1, c = idx ? idx[t * 3 + 2] : t * 3 + 2;
          var x = (P[a * st] + P[b * st] + P[c * st]) / 3, z = (P[a * st + 2] + P[b * st + 2] + P[c * st + 2]) / 3;
          var k = Math.floor(x / J.cell) * 8192 + Math.floor(z / J.cell), bi = J.keyOf[k];
          if (bi === undefined) { bi = J.keyOf[k] = J.B.length; J.B.push({ n: 0, s: 0, x0: 1e9, y0: 1e9, z0: 1e9, x1: -1e9, y1: -1e9, z1: -1e9 }); }
          J.tb[t] = bi; var o = J.B[bi]; o.n++;
          for (var j = 0; j < 3; j++) {
            var v = (j === 0 ? a : j === 1 ? b : c) * st, vx = P[v], vy = P[v + 1], vz = P[v + 2];
            if (vx < o.x0) o.x0 = vx; if (vx > o.x1) o.x1 = vx; if (vy < o.y0) o.y0 = vy; if (vy > o.y1) o.y1 = vy;
            if (vz < o.z0) o.z0 = vz; if (vz > o.z1) o.z1 = vz;
          }
        }
        J.t = end;
        if (end >= nTri) {
          if (J.B.length < 2) { shadowJobs.shift(); continue; }
          J.fill = new Int32Array(J.B.length); var s0 = 0;
          for (var i = 0; i < J.B.length; i++) { J.B[i].s = s0; J.fill[i] = s0; s0 += J.B[i].n; }
          J.ni = J.pos.count > 65535 ? new Uint32Array(nTri * 3) : new Uint16Array(nTri * 3);
          J.ph = 1; J.t = 0;
        }
      } else if (J.ph === 1) {                                            // индексы по клеткам подряд
        var ni = J.ni, tb = J.tb, fill = J.fill;
        for (t = J.t; t < end; t++) {
          var w = fill[tb[t]]++ * 3;
          if (idx) { ni[w] = idx[t * 3]; ni[w + 1] = idx[t * 3 + 1]; ni[w + 2] = idx[t * 3 + 2]; } else { ni[w] = t * 3; ni[w + 1] = t * 3 + 1; ni[w + 2] = t * 3 + 2; }
        }
        J.t = end;
        if (end >= nTri) J.ph = 2;
      } else {                                                            // виды: общий буфер позиций, свой отрезок
        shadowJobs.shift();
        var mesh = J.mesh; if (!inScene(mesh)) continue;
        var index = new T.BufferAttribute(J.ni, 1), views = [];
        J.B.forEach(function (o) {
          var vg = new T.BufferGeometry();
          vg.setAttribute("position", J.pos); vg.setIndex(index); vg.setDrawRange(o.s * 3, o.n * 3);
          vg.boundingSphere = new T.Sphere(new T.Vector3((o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2, (o.z0 + o.z1) / 2),
            Math.hypot(o.x1 - o.x0, o.y1 - o.y0, o.z1 - o.z0) / 2 + 0.5);
          var m = new T.Mesh(vg, mesh.material);
          m.castShadow = true; m.receiveShadow = false; m.visible = false; m.matrixAutoUpdate = false;
          m.matrix.copy(mesh.matrix); m.matrixWorldNeedsUpdate = true; m.userData.shadowView = true;
          mesh.parent.add(m); views.push(m);
        });
        mesh.castShadow = false;
        shadowSets.push({ mesh: mesh, views: views });
      }
    }
  }
  // виды живут с мешем: меш убран со сцены (кусок Минска выгружен) — набор забываем
  var smRender = renderer.shadowMap.render, smOn = [];
  renderer.shadowMap.render = function (lights, sc, cam) {
    smOn.length = 0;
    for (var i = shadowSets.length - 1; i >= 0; i--) {
      var S = shadowSets[i], m = S.mesh, vis = m.visible, p = m;
      while (p.parent) { p = p.parent; if (!p.visible) vis = false; }
      if (p !== sc) { if (p !== scene) shadowSets.splice(i, 1); continue; }   // выгружен — забываем; другая сцена — пропуск
      if (!vis) continue;
      for (var j = 0; j < S.views.length; j++) { S.views[j].visible = true; smOn.push(S.views[j]); }
    }
    try { smRender.call(this, lights, sc, cam); }
    finally { for (var k = 0; k < smOn.length; k++) smOn[k].visible = false; }
  };

  /* ---- реквизит без лишнего: экземпляры только в кадре ----------------------------------------------------------
   * Деревья, фонари, опоры, остановки — общие InstancedMesh на сотни метров вокруг, без отсечения: рисовались и за
   * спиной (замер 26.11: реквизит — половина треугольников кадра на телефоне, ~22% времени видеокарты). Здесь держим
   * полный список экземпляров и в буфер меша кладём только те, что в кадре камеры с запасом 14° и 4 м (и всё в радиусе
   * карты теней, если меш даёт тень: тень от дерева за спиной падает в кадр). Пересчёт — только когда камера сдвинулась
   * на 2 м или повернулась на 3°, до отрисовки того же кадра — поворот не «проявляет» деревья на глазах.
   * Владелец меша после своей перестановки зовёт G.instChanged(меш). */
  var cullSets = [], cullDirty = true, cullPos = new T.Vector3(1e9, 0, 0), cullDir = new T.Vector3(), cullFov = 0, cullAsp = 0;
  // плоскости кадра — свои (в нашей урезанной сборке three нет Frustum): a, b, c, d × 6, нормали внутрь
  var PL = new Float32Array(24), cM = new T.Matrix4(), cV = new T.Vector3();
  function planesOf(m) {
    var e = m.elements, r = [[e[3] - e[0], e[7] - e[4], e[11] - e[8], e[15] - e[12]], [e[3] + e[0], e[7] + e[4], e[11] + e[8], e[15] + e[12]],
      [e[3] + e[1], e[7] + e[5], e[11] + e[9], e[15] + e[13]], [e[3] - e[1], e[7] - e[5], e[11] - e[9], e[15] - e[13]],
      [e[3] - e[2], e[7] - e[6], e[11] - e[10], e[15] - e[14]], [e[3] + e[2], e[7] + e[6], e[11] + e[10], e[15] + e[14]]];
    for (var i = 0; i < 6; i++) { var l = Math.hypot(r[i][0], r[i][1], r[i][2]) || 1; for (var j = 0; j < 4; j++) PL[i * 4 + j] = r[i][j] / l; }
  }
  G.cullInst = function (mesh, on) {
    if (!mesh || !mesh.isInstancedMesh) return;
    if (on === false) {                                                  // снять: вернуть полный список экземпляров
      var e0 = mesh.userData.cull; if (!e0) return;
      cullSets.splice(cullSets.indexOf(e0), 1); mesh.userData.cull = null;
      // полный список хранится по клеткам — возвращаем экземпляры на их исходные номера (владелец пишет по номеру)
      var A0 = mesh.instanceMatrix.array, C0 = mesh.instanceColor && e0.C ? mesh.instanceColor.array : null;
      for (var j0 = 0; j0 < e0.n; j0++) {
        var o0 = e0.ord[j0]; A0.set(e0.M.subarray(j0 * 16, j0 * 16 + 16), o0 * 16);
        if (C0) { C0[o0 * 3] = e0.C[j0 * 3]; C0[o0 * 3 + 1] = e0.C[j0 * 3 + 1]; C0[o0 * 3 + 2] = e0.C[j0 * 3 + 2]; }
      }
      mesh.count = e0.n; mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) { mesh.instanceColor.clearUpdateRanges(); mesh.instanceColor.needsUpdate = true; }
      return;
    }
    mesh.frustumCulled = false;
    var g = mesh.geometry; if (!g.boundingSphere) g.computeBoundingSphere();
    var e = { m: mesh, n: 0, M: null, C: null, S: null, cap: 0 };
    mesh.userData.cull = e; cullSets.push(e);
    if (mesh.count) G.instChanged(mesh);
  };
  // полный список — по клеткам 64 м подряд: отбор сначала по сфере клетки (вся в кадре — целиком, вся вне — мимо),
  // по одному — только в клетках на краю кадра; целые клетки копируются в буфер меша одним блоком
  var CELL = 64;
  G.instChanged = function (mesh) {
    var e = mesh && mesh.userData.cull; if (!e) return;
    var n = mesh.count, A = mesh.instanceMatrix.array, IC = mesh.instanceColor;
    if (e.cap < n) { e.cap = Math.max(n, 16); e.M = new Float32Array(e.cap * 16); e.S = new Float32Array(e.cap * 4); e.C = IC ? new Float32Array(e.cap * 3) : null; }
    if (IC && !e.C) e.C = new Float32Array(e.cap * 3);
    var bs = mesh.geometry.boundingSphere, c = bs.center, r = bs.radius;
    // клетка каждого экземпляра, порядок по клеткам
    var key = new Float64Array(n), ord = new Array(n);
    for (var i = 0; i < n; i++) {
      var o = i * 16;
      var wx = A[o] * c.x + A[o + 4] * c.y + A[o + 8] * c.z + A[o + 12], wz = A[o + 2] * c.x + A[o + 6] * c.y + A[o + 10] * c.z + A[o + 14];
      key[i] = Math.floor(wx / CELL) * 65536 + Math.floor(wz / CELL); ord[i] = i;
    }
    ord.sort(function (x, y) { return key[x] - key[y]; });
    var M = e.M, S = e.S, C = e.C, cells = [], cur = null;
    for (var j = 0; j < n; j++) {
      var src = ord[j], so = src * 16, d = j * 16;
      for (var q = 0; q < 16; q++) M[d + q] = A[so + q];
      if (IC) { C[j * 3] = IC.array[src * 3]; C[j * 3 + 1] = IC.array[src * 3 + 1]; C[j * 3 + 2] = IC.array[src * 3 + 2]; }
      var sx = Math.hypot(M[d], M[d + 1], M[d + 2]), sy = Math.hypot(M[d + 4], M[d + 5], M[d + 6]), sz = Math.hypot(M[d + 8], M[d + 9], M[d + 10]);
      var x = M[d] * c.x + M[d + 4] * c.y + M[d + 8] * c.z + M[d + 12], y = M[d + 1] * c.x + M[d + 5] * c.y + M[d + 9] * c.z + M[d + 13];
      var z = M[d + 2] * c.x + M[d + 6] * c.y + M[d + 10] * c.z + M[d + 14], rr = r * Math.max(sx, sy, sz);
      S[j * 4] = x; S[j * 4 + 1] = y; S[j * 4 + 2] = z; S[j * 4 + 3] = rr;
      if (!cur || key[src] !== cur.k) { cur = { k: key[src], s: j, n: 0, x0: 1e9, y0: 1e9, z0: 1e9, x1: -1e9, y1: -1e9, z1: -1e9 }; cells.push(cur); }
      cur.n++;
      if (x - rr < cur.x0) cur.x0 = x - rr; if (x + rr > cur.x1) cur.x1 = x + rr; if (y - rr < cur.y0) cur.y0 = y - rr; if (y + rr > cur.y1) cur.y1 = y + rr;
      if (z - rr < cur.z0) cur.z0 = z - rr; if (z + rr > cur.z1) cur.z1 = z + rr;
    }
    cells.forEach(function (k) { k.x = (k.x0 + k.x1) / 2; k.y = (k.y0 + k.y1) / 2; k.z = (k.z0 + k.z1) / 2; k.r = Math.hypot(k.x1 - k.x0, k.y1 - k.y0, k.z1 - k.z0) / 2; });
    e.n = n; e.cells = cells; e.ord = ord; cullDirty = true;
  };
  // сфера против плоскостей кадра с запасом: 1 — целиком внутри, 0 — снаружи, 0.5 — на краю
  function sphereIn(x, y, z, r, cx, cy, cz) {
    var pad = 4 + 0.25 * Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy) + (z - cz) * (z - cz)), res = 1;
    for (var p = 0; p < 24; p += 4) {
      var dd = PL[p] * x + PL[p + 1] * y + PL[p + 2] * z + PL[p + 3];
      if (dd < -(r + pad)) return 0;
      if (dd < r) res = 0.5;
    }
    return res;
  }
  function cullInstances() {
    if (!cullSets.length) return;
    camera.updateMatrixWorld();
    cV.set(0, 0, -1).applyQuaternion(camera.quaternion);
    if (!cullDirty && camera.position.distanceToSquared(cullPos) < 4 && cV.dot(cullDir) > 0.9986 && camera.fov === cullFov && camera.aspect === cullAsp) return;
    cullDirty = false; cullPos.copy(camera.position); cullDir.copy(cV); cullFov = camera.fov; cullAsp = camera.aspect;
    cM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); planesOf(cM);
    var cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    var f = G.focus || camera.position, SR = SC * 1.3;
    for (var s = 0; s < cullSets.length; s++) {
      var e = cullSets[s], m = e.m; if (!inScene(m)) { if (!m.parent) cullSets.splice(s--, 1); continue; }
      if (!e.cells) continue;
      var A = m.instanceMatrix.array, IC = m.instanceColor, S = e.S, M = e.M, C = e.C, k = 0, keepSh = m.castShadow && Q.shadows;
      for (var ci = 0; ci < e.cells.length; ci++) {
        var cl = e.cells[ci];
        // тень: всё в радиусе карты теней остаётся (тень дерева за спиной падает в кадр)
        var nearSh = keepSh && Math.hypot(cl.x - f.x, cl.z - f.z) < SR + cl.r;
        var w = sphereIn(cl.x, cl.y, cl.z, cl.r, cx, cy, cz);
        if (w === 0 && !nearSh) continue;
        if (w === 1 || (nearSh && Math.hypot(cl.x - f.x, cl.z - f.z) + cl.r < SR)) {   // клетка целиком — одним блоком
          A.set(M.subarray(cl.s * 16, (cl.s + cl.n) * 16), k * 16);
          if (IC) IC.array.set(C.subarray(cl.s * 3, (cl.s + cl.n) * 3), k * 3);
          k += cl.n; continue;
        }
        for (var i = cl.s; i < cl.s + cl.n; i++) {
          var x = S[i * 4], y = S[i * 4 + 1], z = S[i * 4 + 2], r = S[i * 4 + 3];
          var ok = (nearSh && (x - f.x) * (x - f.x) + (z - f.z) * (z - f.z) < SR * SR) || sphereIn(x, y, z, r, cx, cy, cz) > 0;
          if (!ok) continue;
          for (var q = 0; q < 16; q++) A[k * 16 + q] = M[i * 16 + q];
          if (IC) { IC.array[k * 3] = C[i * 3]; IC.array[k * 3 + 1] = C[i * 3 + 1]; IC.array[k * 3 + 2] = C[i * 3 + 2]; }
          k++;
        }
      }
      m.count = k;
      if (k) {
        m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, k * 16); m.instanceMatrix.needsUpdate = true;
        if (IC) { IC.clearUpdateRanges(); IC.addUpdateRange(0, k * 3); IC.needsUpdate = true; }
      }
    }
  }
  G.cullNow = function () { cullDirty = true; };

  G.add = add; G.frame = frame; G.resize = resize; G.setQuality = setQuality; G.weather = weather;
  G.calm = function (sec) { nextWeatherAt = Date.now() + sec * 1000; weather.target = 0; weather.rain = 0; };
  G.mat = { facade: facadeMaterial, road: roadMaterial, water: waterMaterial, std: std, ground: function () { return groundMaterial(false); },
    groundPlane: function () { return groundMaterial(true); }, tree: treeMaterial };
  G.tex = { canvas: canvasTex, sign: signTex, glow: glowTex, blob: blobTex, shade: shade };
  G.uniforms = { night: facadeU.uNight, time: waterU.uTime };
  G.facadeTex = facadeTex;
  G.preset = setLook; G.look = LOOK; G.LOOKS = LOOKS;
  // вырез под интерьер: {x, z, ux, uz, hl, hw, top} или null
  G.cut = function (c) {
    if (!c) { FOGU.uCutS.value.w = 0; return; }
    FOGU.uCut.value.set(c.x, c.z, c.ux, c.uz); FOGU.uCutS.value.set(c.hl, c.hw, c.top, 1);
  };
  if (MINSK) setLook("auto");
  G.night = 0; G.focus = null;
  FC.gfx = G;
})(window);
