/* Флейм-Сити — машины: ростер марок-пародий (fcarlist.js → define), аркадная физика с характером класса (привод,
 * отзывчивость, занос, пробуксовка), трафик по графу полос, угон, урон (дым → огонь → взрыв), фары и пятна света
 * ночью, следы шин, припаркованные машины.
 *
 * Отрисовка (22.11 v3): одна модель на тип — один InstancedMesh (краска, стёкла, фары, хром — вид поверхности в
 * вершинах, цвет краски — цвет экземпляра, фары — по экземпляру), колёса — общий InstancedMesh на стиль диска,
 * дальше LOD_D — силуэт класса одним мешем с впечатанными колёсами. Модели — cars/cars-*.glb (fcarsgl.js), до загрузки
 * — прежние коробки-заглушки в том же формате. Пулы создаются при первой машине типа и растут вдвое.
 * Физика игрока (и погони — fpolice ставит ai.mode "chase") — вектор скорости, боковое сцепление гасит занос,
 * руль слабее на скорости (по разборам Marco Monster и kidscancode). Трафик — кинематика по точкам полосы:
 * pure pursuit, IDM до лидера, стоп-линия на красный (FC.build.signal), повороты дугами Безье.
 *
 * Курс (heading): 0 — к +z, вперёд = (sin h, cos h); рост курса — поворот налево; правая сторона = (-cos h, sin h).
 * Машина: {type, spec, x, z, heading, vx, vz, w (рысканье), hp, color, driver: player|ai|cop|none, ai, police,
 *   siren, parked, owned, wrecked, spiked}.
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE, M = FC.map, G = FC.gfx;

  var D2R = Math.PI / 180;
  // Характер типа: масса, разгон, скорость, сцепление и занос (по исследованию поведения машин), крен кузова (roll), звук мотора
  // snd = [высота, громкость], тряска камеры (shake). flat — электрический разгон без провала; drifty — уходит в занос легче;
  // moto — двухколёсный (наклон в повороте, вилли, падение); emergency — спецмашина с сиреной.
  var TYPES = {
    sedan: { name: "седан", L: 4.6, W: 1.9, wb: 2.7, wr: 0.36, mass: 1400, vmax: 42, accel: 9.2, brake: 14, grip: 8, gripDrift: 2.0, steer: 32, aLat: 11, camDist: 8.5, camH: 1.7, roll: 1, snd: [1, 0.8], shake: 1 },
    taxi: { name: "такси", L: 4.6, W: 1.9, wb: 2.7, wr: 0.36, mass: 1400, vmax: 41, accel: 8.8, brake: 14, grip: 8, gripDrift: 2.0, steer: 32, aLat: 11, camDist: 8.5, camH: 1.7, roll: 1, snd: [0.96, 0.8], shake: 1 },
    sport: { name: "спорткар", L: 4.4, W: 1.95, wb: 2.6, wr: 0.36, mass: 1250, vmax: 68, accel: 13.5, brake: 19, grip: 11, gripDrift: 2.6, steer: 30, aLat: 15.5, camDist: 7.8, camH: 1.45, roll: 0.45, snd: [1.22, 0.95], shake: 0.8 },
    muscle: { name: "маслкар", L: 4.95, W: 2.0, wb: 2.95, wr: 0.38, mass: 1650, vmax: 60, accel: 12, brake: 13, grip: 6.8, gripDrift: 1.35, steer: 31, aLat: 12, camDist: 8.6, camH: 1.6, roll: 1.25, snd: [0.7, 1.15], shake: 1.25, drifty: true },
    ev: { name: "электрокар", L: 4.6, W: 1.92, wb: 2.85, wr: 0.37, mass: 1750, vmax: 52, accel: 15, brake: 17, grip: 9.5, gripDrift: 2.3, steer: 31, aLat: 13, camDist: 8.4, camH: 1.6, roll: 0.6, snd: [1.9, 0.2], shake: 0.7, flat: true },
    van: { name: "фургон", L: 5.0, W: 2.0, wb: 3.0, wr: 0.4, mass: 2200, vmax: 34, accel: 6.4, brake: 10, grip: 6, gripDrift: 1.6, steer: 30, aLat: 7.5, camDist: 9.5, camH: 2.2, roll: 1.8, snd: [0.85, 0.85], shake: 1.3 },
    truck: { name: "грузовик", L: 8.6, W: 2.5, wb: 5.0, wr: 0.55, mass: 9000, vmax: 31, accel: 4.8, brake: 8, grip: 6, gripDrift: 1.7, steer: 36, aLat: 5.5, camDist: 14, camH: 3.6, roll: 1.4, snd: [0.55, 1.1], shake: 1.6 },
    bus: { name: "автобус", L: 12, W: 2.5, wb: 6.4, wr: 0.52, mass: 11000, vmax: 25, accel: 2.5, brake: 7, grip: 5, gripDrift: 1.5, steer: 40, aLat: 5, camDist: 16, camH: 4, roll: 1.3, snd: [0.6, 1], shake: 1.5 },
    police: { name: "патруль", L: 4.8, W: 1.95, wb: 2.8, wr: 0.37, mass: 1600, vmax: 56, accel: 12.5, brake: 16, grip: 9, gripDrift: 2.2, steer: 32, aLat: 12, camDist: 8.5, camH: 1.7, roll: 0.9, snd: [1.05, 0.9], shake: 1 },
    moto: { name: "мотоцикл", L: 2.1, W: 0.8, wb: 1.42, wr: 0.33, mass: 240, vmax: 64, accel: 15, brake: 17, grip: 9.5, gripDrift: 2.4, steer: 34, aLat: 15, camDist: 6.4, camH: 1.4, roll: 0, snd: [1.45, 0.75], shake: 0.9, moto: true },
    tuk: { name: "тук-тук", L: 2.8, W: 1.4, wb: 1.9, wr: 0.28, mass: 450, vmax: 24, accel: 6.5, brake: 12, grip: 7, gripDrift: 2.2, steer: 38, aLat: 9, camDist: 6.8, camH: 1.6, roll: 2.0, snd: [1.6, 0.6], shake: 1 },
    ambulance: { name: "скорая", L: 5.2, W: 2.05, wb: 3.1, wr: 0.4, mass: 2400, vmax: 46, accel: 8.5, brake: 12, grip: 7, gripDrift: 1.8, steer: 32, aLat: 9, camDist: 9.5, camH: 2.3, roll: 1.6, snd: [0.9, 0.9], shake: 1.3, emergency: true },
    fire: { name: "пожарная", L: 9.2, W: 2.55, wb: 5.2, wr: 0.56, mass: 12000, vmax: 34, accel: 5.2, brake: 9, grip: 6, gripDrift: 1.6, steer: 36, aLat: 5.5, camDist: 15, camH: 3.8, roll: 1.4, snd: [0.6, 1.1], shake: 1.6, emergency: true }
  };
  // крепость кузова: множитель урона (задача: «машины сильно быстро разбиваются» — всё втрое крепче)
  var ARMOR = { truck: 0.3, bus: 0.3, fire: 0.3, police: 0.55, van: 0.7, ambulance: 0.6, muscle: 0.85, moto: 1.1, tuk: 1.1 };
  Object.keys(TYPES).forEach(function (k) { TYPES[k].key = k; TYPES[k].fb = k; TYPES[k].maxSteer = TYPES[k].steer * D2R; TYPES[k].armor = ARMOR[k] || 1; });
  /* Ростер (fcarlist.js) подменяет и дополняет типы. Из vtop (честная максималка) — vmax кривой тяги и сопротивление cd:
   * на vtop тяга accel·(1 − (vtop/vmax)²) равна качению + cd·v², иначе тяжёлое сопротивление съедало треть скорости. */
  function define(list) {
    Object.keys(list).forEach(function (k) {
      var S = list[k], old = TYPES[k];
      S.key = k; S.fb = S.fb || (old && old.fb) || "sedan";
      // электро (flat) — кривая тяги 1 − (v/vmax)⁶, остальные — квадрат
      if (S.vtop) { S.vmax = S.vtop * 1.12; S.cd = Math.max(0.0002, (S.accel * (1 - Math.pow(1 / 1.12, S.flat ? 6 : 2)) - 0.25) / (S.vtop * S.vtop)); }
      S.maxSteer = S.steer * D2R; S.armor = S.armor || 1; S.resp = S.resp || 1;
      if (S.camDist == null) S.camDist = 8.5; if (S.camH == null) S.camH = 1.7;
      if (S.shake == null) S.shake = 1;
      if (!Array.isArray(S.snd)) S.snd = S.snd ? [S.snd.p || 1, S.snd.v || 0.8, S.snd.k || "i4"] : [1, 0.8, "i4"];
      TYPES[k] = S;
    });
  }
  var PALETTE = [0xd7263d, 0xf46036, 0x2e294e, 0x1b998b, 0xc5d86d, 0xe8e8e8, 0x1d1d1f, 0x3a86ff, 0x8338ec, 0xff006e,
    0xfb5607, 0xffbe0b, 0x6c757d, 0xadb5bd, 0x264653, 0x2a9d8f, 0xe9c46a, 0xe76f51, 0xf1faee, 0x457b9d, 0x5f0f40, 0x0b6e4f];
  var CAP = { police: 24, taxi: 16, sedan: 16 };     // стартовые ёмкости ближнего плана (растут вдвое по нужде)

  var cTmp = new T.Color();

  /* ---- материал: один на все машины; вид поверхности (attribute kind, как K в tools/lib/fc-cargen.cjs) задаёт
   * блеск и свечение: 0 отделка, 1 краска (× цвет экземпляра), 2 стекло, 3 хром, 4 фары, 5 фонари, 6 резина,
   * 7 табло/фонарь такси, 8 поворотник, 9 диск (× цвет экземпляра колеса). iLit — по экземпляру: фары, фонари, гарь. */
  var K = { TRIM: 0, PAINT: 1, GLASS: 2, CHROME: 3, HEAD: 4, TAIL: 5, RUBBER: 6, SIGN: 7, AMBER: 8, RIM: 9 };
  var lightU = { uNight: G.uniforms.night };
  function carMaterial() {
    var m = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2, envMapIntensity: 1.15 });
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uNight = lightU.uNight;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float kind;\nattribute vec3 iLit;\nvarying float vKind;\nvarying vec3 vLit;")
        .replace("#include <color_vertex>", ["vColor = vec3(color);", "vKind = kind; vLit = iLit;", "#ifdef USE_INSTANCING_COLOR",
          "if ((kind > 0.5 && kind < 1.5) || kind > 8.5) vColor *= instanceColor;", "#endif"].join("\n"));
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vKind;\nvarying vec3 vLit;\nuniform float uNight;")
        .replace("#include <color_fragment>", "#include <color_fragment>\nfloat kk = floor(vKind + 0.5);\ndiffuseColor.rgb *= 1.0 - 0.82 * vLit.z;")
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n" +
          "roughnessFactor = kk == 1.0 ? 0.3 : kk == 2.0 ? 0.06 : kk == 3.0 ? 0.16 : kk == 6.0 ? 0.92 : kk == 9.0 ? 0.32 : kk >= 4.0 ? 0.25 : 0.62;\n" +
          "roughnessFactor = mix(roughnessFactor, 0.95, vLit.z);")
        .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\n" +
          "metalnessFactor = kk == 1.0 ? 0.45 : kk == 2.0 ? 0.88 : kk == 3.0 ? 1.0 : kk == 9.0 ? 0.65 : 0.08;")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n" +
          "if (kk == 4.0) totalEmissiveRadiance = vColor * vLit.x; else if (kk == 5.0) totalEmissiveRadiance = vColor * vLit.y;" +
          " else if (kk == 7.0) totalEmissiveRadiance = vColor * (0.25 + uNight * 1.4) * step(0.01, vLit.x); else if (kk == 8.0) totalEmissiveRadiance = vColor * 0.25 * step(0.01, vLit.x);");
    };
    return m;
  }
  var MAT = { car: carMaterial(), rider: new T.MeshStandardMaterial({ vertexColors: true, metalness: 0.2, roughness: 0.6 }) };

  /* ---- модели: заглушка из коробок (до загрузки cars-*.glb) в том же формате, что и настоящие ------------------ */
  // части старой модели → одна геометрия с kind: краска белая (красится экземпляром), отделка — цвета вершин,
  // фары — по цвету (красные — фонари, жёлтые табло — 7)
  function kindGeo(geo, kind, colorHex) {
    geo = geo.index ? geo.toNonIndexed() : geo;
    var n = geo.attributes.position.count, kd = new Float32Array(n), c = geo.attributes.color;
    if (!c) { var ca = new Float32Array(n * 3); cTmp.set(colorHex != null ? colorHex : 0xffffff); for (var i = 0; i < n; i++) { ca[i * 3] = cTmp.r; ca[i * 3 + 1] = cTmp.g; ca[i * 3 + 2] = cTmp.b; } geo.setAttribute("color", new T.BufferAttribute(ca, 3)); c = geo.attributes.color; }
    for (var j = 0; j < n; j++) {
      if (kind !== "light") { kd[j] = kind; continue; }
      var r = c.getX(j), g = c.getY(j), b = c.getZ(j);
      kd[j] = r > 0.5 && g < 0.2 ? K.TAIL : r > 0.6 && g > 0.25 && b < 0.2 ? K.SIGN : K.HEAD;
    }
    geo.setAttribute("kind", new T.BufferAttribute(kd, 1));
    if (geo.attributes.uv) geo.deleteAttribute("uv");
    return geo;
  }
  var FALLBACK = {}, MODEL = {}, LODM = {}, WHEEL = {};
  function fallback(type) {
    if (FALLBACK[type]) return FALLBACK[type];
    var g = FC.cars.boxModel(TYPES[type]), S = TYPES[type];
    var parts = [kindGeo(g.paint, K.PAINT), kindGeo(g.trim, K.TRIM), kindGeo(g.glass, K.GLASS, 0x101720), kindGeo(g.lights, "light")];
    var geo = T.mergeGeometries(parts, false);
    geo.computeBoundingSphere();
    return (FALLBACK[type] = { geo: geo, wheels: g.wheels, wheelStyle: "fb", tireW: S.moto ? 0.14 : S.L > 7 ? 0.34 : S.fb === "tuk" ? 0.16 : 0.26,
      beacons: g.beacons, rider: g.rider, fallback: true });
  }
  function fbWheel() { return WHEEL.fb || (WHEEL.fb = kindGeo(FC.cars.wheelGeo(1, 1), K.TRIM)); }
  function modelOf(type) { return MODEL[type] || fallback(type); }

  /* ---- пулы экземпляров: тип (ближний план), силуэт (дальний), стиль колёс; создаются по первой машине ---------- */
  var root = new T.Group(); root.name = "cars"; G.add(root);
  // вид геометрии со своими атрибутами экземпляров (буферы вершин — общие)
  function geoView(geo, n) {
    var g = new T.BufferGeometry();
    if (geo.index) g.setIndex(geo.index);
    Object.keys(geo.attributes).forEach(function (k) { if (k !== "iLit") g.setAttribute(k, geo.attributes[k]); });
    g.setAttribute("iLit", new T.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(T.DynamicDrawUsage));
    g.boundingSphere = geo.boundingSphere;
    return g;
  }
  function makePool(geo, n, shadow, colored) {
    var m = new T.InstancedMesh(geoView(geo, n), MAT.car, n);
    m.instanceMatrix.setUsage(T.DynamicDrawUsage);
    if (colored) { m.setColorAt(0, cTmp.setHex(0xffffff)); m.instanceColor.setUsage(T.DynamicDrawUsage); }
    m.count = 0; m.frustumCulled = false;
    m.castShadow = !!shadow && G.Q.shadows; m.receiveShadow = G.Q.shadows;
    root.add(m);
    return { mesh: m, n: n, used: 0, src: geo };
  }
  function grow(p) {           // вдвое больше экземпляров: новый меш, старый — в утиль
    var n = Math.min(p.n * 2, 256);
    if (n === p.n) return false;
    var old = p.mesh, q = makePool(p.src, n, old.castShadow, !!old.instanceColor);
    old.geometry.dispose(); old.dispose(); root.remove(old);
    p.mesh = q.mesh; p.n = n;
    return true;
  }
  function swapGeo(p, geo) {   // модели догрузились — подменить геометрию, экземпляры живут дальше
    var old = p.mesh.geometry;
    p.mesh.geometry = geoView(geo, p.n); p.src = geo;
    old.dispose();
  }
  var POOL = {}, POOL1 = {}, WPOOL = {};
  function pool0(type) { return POOL[type] || (POOL[type] = makePool(modelOf(type).geo, CAP[type] || (TYPES[type].price > 40000 ? 8 : 16), true, true)); }
  function pool1(cat) { return LODM[cat] ? POOL1[cat] || (POOL1[cat] = makePool(LODM[cat].geo, 32, false, true)) : null; }
  function wpool(style) { return WPOOL[style] || (WPOOL[style] = makePool(WHEEL[style] || fbWheel(), 64, false, true)); }
  var riderMesh = null;
  function riderPool() {
    if (riderMesh) return riderMesh;
    riderMesh = new T.InstancedMesh(FC.cars.riderGeo(0, 0), MAT.rider, 24);
    riderMesh.instanceMatrix.setUsage(T.DynamicDrawUsage); riderMesh.count = 0; riderMesh.frustumCulled = false;
    riderMesh.castShadow = G.Q.shadows; root.add(riderMesh);
    return riderMesh;
  }
  // модели из cars-*.glb (fcarsgl): {types: {id: {geo, wheels, wheel, tireW, beacons, seat}}, lods: {cat: {geo}}, wheels: {style: geo}}
  function setModels(pack) {
    Object.keys(pack.wheels || {}).forEach(function (k) { WHEEL[k] = pack.wheels[k]; if (WPOOL[k]) swapGeo(WPOOL[k], WHEEL[k]); });
    Object.keys(pack.lods || {}).forEach(function (k) { LODM[k] = pack.lods[k]; if (POOL1[k]) swapGeo(POOL1[k], LODM[k].geo); });
    Object.keys(pack.types || {}).forEach(function (k) {
      if (!TYPES[k]) return;
      MODEL[k] = pack.types[k];
      if (POOL[k]) swapGeo(POOL[k], MODEL[k].geo);
    });
    FC.emit("cars:models", { n: Object.keys(MODEL).length });
  }
  var BEACON_N = 96;
  var beaconMesh = new T.InstancedMesh(new T.BoxGeometry(0.34, 0.13, 0.22), new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), BEACON_N);
  beaconMesh.instanceMatrix.setUsage(T.DynamicDrawUsage); beaconMesh.setColorAt(0, cTmp.setHex(0xffffff));
  beaconMesh.count = 0; beaconMesh.frustumCulled = false; root.add(beaconMesh);
  function inst(geo, mat, n) {
    var m = new T.InstancedMesh(geo, mat, n);
    m.instanceMatrix.setUsage(T.DynamicDrawUsage); m.count = 0; m.frustumCulled = false; root.add(m);
    return m;
  }

  // фары ночью: пятно света перед машиной на асфальте (все машины), у игрока — ещё прожектор (high) с тенями: прохожие,
  // столбы и машины впереди отбрасывают тень от фар. Карта теней прожектора рисуется только пока фары горят
  // (shadow.autoUpdate), castShadow не переключаем — иначе пересборка всех шейдеров на каждой посадке.
  var poolMat = new T.MeshBasicMaterial({ map: G.tex.glow, color: 0xfff0c8, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false });
  var beams = inst(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMat, 260);
  beams.renderOrder = 2;
  var tailMat = new T.MeshBasicMaterial({ map: G.tex.glow, color: 0xff2a2a, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false });
  var tails = inst(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), tailMat, 260);
  var spot = null;
  if (G.Q.level === "high") {
    spot = new T.SpotLight(0xfff0d0, 0, 70, 0.55, 0.6, 1);
    spot.castShadow = !!G.Q.shadows;
    spot.shadow.mapSize.set(1024, 1024); spot.shadow.camera.near = 0.6; spot.shadow.camera.far = 48;
    spot.shadow.bias = -0.0006; spot.shadow.normalBias = 0.05; spot.shadow.autoUpdate = false;
    G.add(spot); G.add(spot.target);
  }

  // следы шин: кольцо тёмных полосок на асфальте
  var SKID_N = 600, skidI = 0;
  var skids = new T.InstancedMesh(new T.PlaneGeometry(0.24, 0.9).rotateX(-Math.PI / 2),
    new T.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), SKID_N);
  skids.count = 0; skids.frustumCulled = false; root.add(skids);
  var skidObj = new T.Object3D();
  function skid(x, z, h) {
    skidObj.position.set(x, 0.06, z); skidObj.rotation.set(0, h, 0); skidObj.updateMatrix();
    skids.setMatrixAt(skidI, skidObj.matrix); skidI = (skidI + 1) % SKID_N;
    skids.count = Math.min(SKID_N, skids.count + 1); skids.instanceMatrix.needsUpdate = true;
  }

  /* ---- частицы: дым (обычное смешение) и огонь (сложение) — точки со своим размером и прозрачностью ---------- */
  function particles(n, additive) {
    var geo = new T.BufferGeometry();
    var pos = new Float32Array(n * 3), size = new Float32Array(n), alpha = new Float32Array(n), col = new Float32Array(n * 3);
    geo.setAttribute("position", new T.BufferAttribute(pos, 3).setUsage(T.DynamicDrawUsage));
    geo.setAttribute("aSize", new T.BufferAttribute(size, 1).setUsage(T.DynamicDrawUsage));
    geo.setAttribute("aAlpha", new T.BufferAttribute(alpha, 1).setUsage(T.DynamicDrawUsage));
    geo.setAttribute("aCol", new T.BufferAttribute(col, 3).setUsage(T.DynamicDrawUsage));
    var mat = new T.ShaderMaterial({
      uniforms: { uScale: { value: 600 } }, transparent: true, depthWrite: false,
      blending: additive ? T.AdditiveBlending : T.NormalBlending,
      vertexShader: "attribute float aSize; attribute float aAlpha; attribute vec3 aCol; uniform float uScale; varying float vA; varying vec3 vC;" +
        "void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uScale / max(-mv.z, 0.5); gl_Position = projectionMatrix * mv; vA = aAlpha; vC = aCol; }",
      fragmentShader: "varying float vA; varying vec3 vC; void main(){ float d = length(gl_PointCoord - vec2(0.5)); float a = (1.0 - smoothstep(0.0, 0.5, d)) * vA; if (a < 0.01) discard; gl_FragColor = vec4(vC, a); }"
    });
    var pts = new T.Points(geo, mat); pts.frustumCulled = false; root.add(pts);
    var P = [];
    for (var i = 0; i < n; i++) P.push({ life: 0 });
    return { pts: pts, geo: geo, mat: mat, P: P, n: n, i: 0 };
  }
  var SMOKE = particles(G.Q.level === "low" ? 160 : 360, false), FIRE = particles(G.Q.level === "low" ? 120 : 260, true);
  function emit(sys, x, y, z, vx, vy, vz, life, s0, s1, a0, r, g, b) {
    var p = sys.P[sys.i]; sys.i = (sys.i + 1) % sys.n;
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.life = p.max = life; p.s0 = s0; p.s1 = s1; p.a0 = a0; p.r = r; p.g = g; p.b = b;
  }
  function stepParticles(sys, dt) {
    var pos = sys.geo.attributes.position.array, sz = sys.geo.attributes.aSize.array, al = sys.geo.attributes.aAlpha.array, cl = sys.geo.attributes.aCol.array;
    for (var i = 0; i < sys.n; i++) {
      var p = sys.P[i];
      if (p.life <= 0) { al[i] = 0; continue; }
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vx *= 0.98; p.vz *= 0.98;
      var k = 1 - p.life / p.max;
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      sz[i] = p.s0 + (p.s1 - p.s0) * k; al[i] = p.a0 * (1 - k) * Math.min(1, k * 6 + 0.2);
      cl[i * 3] = p.r; cl[i * 3 + 1] = p.g; cl[i * 3 + 2] = p.b;
    }
    sys.geo.attributes.position.needsUpdate = true; sys.geo.attributes.aSize.needsUpdate = true;
    sys.geo.attributes.aAlpha.needsUpdate = true; sys.geo.attributes.aCol.needsUpdate = true;
    sys.mat.uniforms.uScale.value = G.renderer.domElement.height / (2 * Math.tan(G.camera.fov * D2R / 2));
  }
  var flash = new T.Sprite(new T.SpriteMaterial({ map: G.tex.glow, color: 0xffb347, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false }));
  flash.visible = false; root.add(flash);
  var flashT = 0;

  /* ---- машины --------------------------------------------------------------------------------------------- */
  var list = [], seq = 0;
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function spawn(type, x, z, heading, opt) {
    opt = opt || {};
    var S = TYPES[type] || TYPES.sedan;
    var color = colorHex(opt.color != null ? opt.color : pick(S.colors || PALETTE));
    var car = { id: "car" + (seq++), type: S.key, spec: S, x: x, z: z, heading: heading || 0, vx: 0, vz: 0, w: 0, v: 0,
      steer: 0, steerVis: 0, spin: 0, hp: 100, color: color, owned: !!opt.owned, parked: !!opt.parked, police: type === "police" || !!opt.police,
      siren: !!opt.siren, driver: opt.driver || (opt.ai ? "ai" : "none"), ai: opt.ai || null, wrecked: false, spiked: false,
      roll: 0, pitch: 0, drift: false, smokeT: 0, burnT: 0, slot: opt.slot != null ? opt.slot : null, born: performance.now(),
      honkT: 0, stuckT: 0, revT: 0, lastX: x, lastZ: z, node: -1, gear: 0, tune: opt.tune || null };
    if (car.tune && car.tune.color != null) car.color = colorHex(car.tune.color);
    list.push(car);
    return car;
  }
  function remove(car) {
    var i = list.indexOf(car); if (i >= 0) list.splice(i, 1);
    if (car.slot != null && SLOTS[car.slot]) SLOTS[car.slot].car = null;
    car.dead = true;
  }
  function setColor(car, hex) { car.color = colorHex(hex); }
  function fwdOf(h) { return { x: Math.sin(h), z: Math.cos(h) }; }

  /* Отдельная модель — для машин других игроков (fmp) и витрин: кузов — InstancedMesh на один экземпляр (краска —
   * цвет экземпляра, как у трафика), колёса — обычные меши. Догрузились модели — пересобирается сама при следующем
   * кадре владельца (fmp держит объект по ключу тип:цвет; кузов меняем на месте). */
  function visual(type, color) {
    type = TYPES[type] ? type : "sedan";
    var grp = new T.Group();
    function fill() {
      while (grp.children.length) { var c = grp.children.pop(); if (c.geometry && c.userData.own) c.geometry.dispose(); }
      var md = modelOf(type), S = TYPES[type];
      var body = new T.InstancedMesh(geoView(md.geo, 1), MAT.car, 1);
      body.userData.own = true;
      body.setMatrixAt(0, mB.identity()); body.setColorAt(0, cTmp.set(colorHex(color != null ? color : 0xd7263d)));
      body.geometry.attributes.iLit.setXYZ(0, 0.3, 0.2, 0);
      body.frustumCulled = false; body.castShadow = G.Q.shadows;
      grp.add(body);
      grp.userData.body = body;
      var wg = WHEEL[md.wheelStyle] || fbWheel();
      grp.userData.wheels = md.wheels.map(function (w) {
        var m = new T.InstancedMesh(geoView(wg, 1), MAT.car, 1);
        m.userData.own = true; m.setColorAt(0, cTmp.setHex(0xffffff)); m.frustumCulled = false;
        eA.set(0, w[0] < 0 ? Math.PI : 0, 0, "YXZ"); mL.makeRotationFromEuler(eA).scale(vW.set(md.tireW, S.wr, S.wr)); mL.setPosition(w[0], w[1], w[2]);
        m.setMatrixAt(0, mL); grp.add(m); return m;
      });
      grp.userData.fallback = !!md.fallback;
      grp.children.forEach(function (m) { m.castShadow = G.Q.shadows; });
    }
    fill();
    grp.userData.spec = TYPES[type];
    VISUALS.push({ grp: grp, fill: fill });
    return grp;
  }
  var VISUALS = [];
  FC.on("cars:models", function () {
    VISUALS = VISUALS.filter(function (v) { return v.grp.parent; });
    VISUALS.forEach(function (v) { if (v.grp.userData.fallback) v.fill(); });
  });
  // цвет машины: число или строка «#rrggbb» (автосалон хранит строкой)
  function colorHex(c) { return typeof c === "string" ? parseInt(c.replace("#", ""), 16) || 0 : c; }

  /* ---- физика (игрок, погоня, свободное качение) ------------------------------------------------------------- */
  function physStep(car, h, inp) {
    var S = car.spec, th = car.heading;
    var fx = Math.sin(th), fz = Math.cos(th), rx = -fz, rz = fx;     // вперёд и вправо
    var vF = car.vx * fx + car.vz * fz, vR = car.vx * rx + car.vz * rz, spd = Math.hypot(car.vx, car.vz);
    var vmax = S.vmax * (car.spiked ? 0.6 : 1) * (car.hp < 30 ? 0.75 : 1) * (inp.boost || 1);
    var t = inp.throttle || 0, b = inp.brake || 0;
    if (car.wrecked) { t = 0; b = 1; }
    // ложная коробка (только игрок): на переключении 0,12 с без тяги и «хлопок» — машины звучат и тянут по-разному
    if (inp.gears && t > 0 && !S.flat) {
      var gear = Math.min(5, Math.floor(Math.max(vF, 0) / vmax * 5.4));
      if (gear > (car.gear || 0)) { car.shiftT = 0.12; if (FC.audio && gear > 1) FC.audio.play("pop", { vol: 0.5 * S.snd[1] }); if (FC.cam) FC.cam.pitch += 0.015; }
      car.gear = gear;
    } else if (vF < 2) car.gear = 0;
    if (car.shiftT > 0) { car.shiftT -= h; t *= 0.1; }
    var curve = S.flat ? Math.max(0, 1 - Math.pow(Math.max(vF, 0) / vmax, 6)) : Math.max(0, 1 - Math.pow(Math.max(vF, 0) / vmax, 2));
    var tq = t * S.accel * (inp.accelK || 1) * curve;
    // пробуксовка со старта (маслкар, мощный задний привод): газ в пол до ~7 м/с — тяга срывается, дым и следы
    car.wheelspin = 0;
    if (S.spin && t > 0.9 && vF > -0.5 && vF < 7 && !S.moto) { car.wheelspin = S.spin * (1 - vF / 7); tq *= 1 - 0.45 * car.wheelspin; }
    if (t > 0 && vF > -0.5) vF += tq * h;
    if (b > 0) {
      if (vF > 0.5) vF -= S.brake * b * h;
      else if (inp.reverse) vF = Math.max(vF - S.accel * 0.6 * h, -vmax * 0.3);
      else vF -= Math.sign(vF) * Math.min(Math.abs(vF), S.brake * b * h);
    }
    if (t > 0 && vF < -0.5) vF += S.brake * h;                      // газ на заднем ходу — сначала тормоз
    var coast = t > 0 || (b > 0 && inp.reverse) ? 0.25 : (inp.free ? 3.0 : 1.4);
    vF -= Math.sign(vF) * Math.min(Math.abs(vF), (coast + (S.cd != null ? S.cd : 0.0016) * vF * vF) * h);
    if (inp.hb) vF -= Math.sign(vF) * Math.min(Math.abs(vF), 4 * h);
    var slip = Math.atan2(vR, Math.max(Math.abs(vF), 1));
    // руль игрока — аркадный (задача: «еле поворачивают»): поворот 90° на городской скорости ~1 с
    // вместо ~3 с; трафик и погоня едут по прежней физике (inp.arcade ставит только playerInput)
    var arc = inp.arcade ? 1 : 0, dr = S.drive || "r", st = inp.steer || 0;
    // привод: полный липнет и срывается позже всех, передний прощает, задний (ovs) уходит в занос на газу
    var slipT = (S.drifty ? 0.14 : 0.21) * (arc ? 1.45 : 1) * (dr === "a" ? 1.3 : dr === "f" ? 1.18 : 1);
    if (S.ovs && t > 0.8 && Math.abs(st) > 0.5 && spd > 9) slipT *= 1 - 0.35 * S.ovs;
    // мотор сзади: бросил газ посреди поворота на скорости — корма уходит наружу
    if (dr === "rr" && !t && (car.lastT || 0) > 0.5 && Math.abs(st) > 0.6 && spd > 16) { car.driftT = Math.max(car.driftT || 0, 0.3); car.w += st * 0.35; }
    car.lastT = t;
    if (inp.hb || (Math.abs(slip) > slipT && spd > (S.drifty ? 11 : 15))) car.drift = true;
    if (car.drift && Math.abs(slip) < 0.087 && !inp.hb) car.drift = false;
    if (car.driftT > 0) { car.driftT -= h; car.drift = true; }
    var low = (car.tune && car.tune.lower) || 0;          // занижение (гараж): сцепление и боковое ускорение выше
    var g = (car.drift ? S.gripDrift * (arc ? 1.2 : 1) * (dr === "a" ? 1.3 : dr === "f" ? 1.22 : 1) : S.grip * (arc ? 1.3 : 1) * (dr === "a" ? 1.06 : 1)) * (1 + 0.15 * low);
    if (car.wheelspin) g *= 1 - 0.3 * car.wheelspin;
    // задний привод на газу в повороте: зад теряет сцепление — машина «рисует» занос (ovs — насколько охотно)
    if (S.ovs && !car.drift && t > 0.6 && Math.abs(st) > 0.4 && spd > 8 && spd < S.vmax * 0.7) g *= 1 - 0.5 * S.ovs * t * Math.abs(st);
    if (car.spiked) g *= 0.4;
    vR *= Math.exp(-g * h);
    var delta = (inp.steer || 0) * S.maxSteer * (arc ? 1.15 : 1) * (1 - (arc ? 0.5 : 0.78) * FC.clamp(spd / S.vmax, 0, 1));    // 35° на месте → ~7° на максималке (игрок — ~17°)
    var wT = vF * Math.tan(delta) / S.wb;
    var cap = (car.drift ? 1.6 : 1) * S.aLat * (arc ? 1.8 : 1) * (1 + 0.1 * low) / Math.max(spd, 1);
    // перенос веса: тормоз грузит перед — руль острее; газ у переднего привода — нос уплывает (недостаточная)
    cap *= 1 + 0.12 * b - (dr === "f" ? 0.1 * t * FC.clamp((spd - 8) / 20, 0, 1) : 0);
    wT = FC.clamp(wT, -cap, cap);
    if (inp.hb) wT *= 1.4;
    // отзывчивость: лимузин и автобус доворачивают медленно, родстер и суперкар — мгновенно
    car.w += (wT - car.w) * (1 - Math.exp(-(arc ? 15 : 10) * (S.resp || 1) * (S.resp || 1) * h));
    if (spd < 0.5 && !t) car.w *= Math.exp(-10 * h);
    car.vx = fx * vF + rx * vR; car.vz = fz * vF + rz * vR;
    car.heading += car.w * h;
    car.x += car.vx * h; car.z += car.vz * h;
    car.vF = vF; car.slip = slip;
  }

  // круги машины (два по длине): центры
  function circles(car) {
    var S = car.spec, r = S.W / 2, o = S.L / 2 - r, fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    if (S.L > 7) return [[car.x + fx * o, car.z + fz * o, r], [car.x, car.z, r], [car.x - fx * o, car.z - fz * o, r]];
    return [[car.x + fx * o, car.z + fz * o, r], [car.x - fx * o, car.z - fz * o, r]];
  }
  function hitWorld(car, prevX, prevZ) {
    var cs = circles(car), dx0 = prevX - car.x, dz0 = prevZ - car.z, worst = 0;
    for (var i = 0; i < cs.length; i++) {
      var c = cs[i];
      // вода — не стена для машины игрока (23.11: «в воду можно»): въехал — вязнет и тонет (water() ниже); поток — как был
      var res = M.collide(c[0], c[1], c[2], { prev: { x: c[0] + dx0, z: c[1] + dz0 }, water: car.driver === "player" || car.wet ? false : undefined });
      if (!res.hit) continue;
      var mx = res.x - c[0], mz = res.z - c[1];
      car.x += mx; car.z += mz;
      var nx = res.nx, nz = res.nz, nl = Math.hypot(nx, nz);
      if (nl < 0.5) { var ml = Math.hypot(mx, mz); if (ml < 1e-5) { car.vx *= 0.5; car.vz *= 0.5; continue; } nx = mx / ml; nz = mz / ml; }
      var vn = car.vx * nx + car.vz * nz;
      if (vn < 0) {
        var e = Math.abs(vn) < 1 ? 0 : 0.2;
        car.vx -= (1 + e) * vn * nx; car.vz -= (1 + e) * vn * nz;
        var tvx = car.vx - (car.vx * nx + car.vz * nz) * nx, tvz = car.vz - (car.vx * nx + car.vz * nz) * nz;
        car.vx -= 0.15 * tvx; car.vz -= 0.15 * tvz;
        // рысканье от удара углом
        var ax = c[0] - car.x, az = c[1] - car.z;
        car.w += (ax * nz - az * nx) * (-(1 + e) * vn) * 0.12;
        worst = Math.max(worst, -vn);
      }
    }
    if (worst > 0) impact(car, worst, null);
  }
  function impact(car, dv, other) {
    if (dv < 1.5) return;
    car.lastHit = performance.now();
    // до ~8 м/с — только искры и вмятина; один удар о стену на обычной скорости машину не уничтожает (кроме лобового > 25 м/с)
    var dmg = Math.max(0, dv - 8) * 2.2 * car.spec.armor / ((car.tune && car.tune.armorMul) || 1);
    if (dmg > 0) damage(car, dv > 25 ? dmg : Math.min(dmg, 45));
    if (car.driver === "player") {
      FC.cam.shake(Math.min(1, (dv > 14 ? 0.4 : 0.15) + dv / 60) * (car.spec.shake || 1));
      if (dv > 4 && FC.audio) FC.audio.play("crash", { vol: Math.min(1, dv / 18) });
      if (dv > 8) FC.player.damage(Math.min(30, dv < 14 ? 3 + (dv - 8) : 15 + (dv - 14) * 1.2), "crash");
      if (FC.fx && FC.fx.haptic) FC.fx.haptic(dv > 14 ? "heavy" : dv > 6 ? "medium" : "light");
      // мотоцикл: сильный удар — седок вылетает
      if (car.spec.moto && dv > 15) bail(car);
    }
    FC.emit("car:crash", { car: car, power: dv, other: other || null });
  }
  function bail(car) {
    var P = FC.player, vx = car.vx, vz = car.vz;
    exit(true);
    P.vx = vx * 0.7; P.vz = vz * 0.7; P.vy = 5; P.onGround = false;
    car.vx *= 0.3; car.vz *= 0.3; car.w += (Math.random() - 0.5) * 6;
    if (FC.hud) FC.hud.toast("💥 Вылетел из седла!", "bad", 2);
    if (FC.fx && FC.fx.hitstop) FC.fx.hitstop(0.5, 0.3);
    FC.emit("car:bail", { car: car });
  }
  function damage(car, n) {
    if (car.wrecked) return;
    car.hp -= n;
    if (car.hp <= 0) explode(car);
  }
  function explode(car) {
    car.hp = 0; car.wrecked = true; car.burnT = 22; car.siren = false;
    car.color = 0x1b1a19;
    var fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    for (var i = 0; i < 70; i++) {
      var a = Math.random() * 6.28, s = 4 + Math.random() * 9;
      emit(FIRE, car.x + fx, 1, car.z + fz, Math.cos(a) * s, 2 + Math.random() * 7, Math.sin(a) * s, 0.6 + Math.random() * 0.6, 1.2, 3.5, 1, 1, 0.55 + Math.random() * 0.3, 0.15);
    }
    for (var j = 0; j < 40; j++) {
      var b = Math.random() * 6.28, sp = 1 + Math.random() * 3;
      emit(SMOKE, car.x, 1.2, car.z, Math.cos(b) * sp, 2 + Math.random() * 3, Math.sin(b) * sp, 3 + Math.random() * 2, 2, 8, 0.8, 0.08, 0.08, 0.08);
    }
    flash.visible = true; flash.position.set(car.x, 2, car.z); flashT = 0.7;
    var P = FC.player, d = Math.hypot(P.x - car.x, P.z - car.z);
    if (d < 40) FC.cam.shake(Math.max(0.2, 0.8 * (1 - d / 40) + 0.2));
    if (FC.audio) FC.audio.play("explosion", { vol: Math.max(0.2, 1 - d / 120) });
    if (car.driver === "player") { exit(true); P.damage(75, "explosion"); }
    else if (d < 7 && P.mode === "foot") P.damage(40 * (1 - d / 7), "explosion");
    FC.people.all.forEach(function (ch) {
      if (ch.kind === "player" || ch.kind === "remote" || ch.room != null || ch.inside != null) return;
      var dx = ch.x - car.x, dz = ch.z - car.z, dd = Math.hypot(dx, dz);
      if (dd < 7 && dd > 0.01) FC.people.hit(ch, dx / dd * 9, dz / dd * 9, 12);
    });
    FC.people.panic(car.x, car.z, 40, "explosion");
    FC.emit("car:explode", { car: car });
  }

  /* ---- столкновения машин между собой: пары кругов, импульс -------------------------------------------------- */
  // кузова — прямоугольники (оси по курсу): пересечение по разделяющим осям, нормаль от a к b, точки удара — углы.
  // Раньше были круги по ширине машины: углы кузовов в них не попадали, и машины под углом заезжали друг в друга.
  function box2(c) {
    var fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    return { x: c.x, z: c.z, ux: fx, uz: fz, sx: fz, sz: -fx, hl: c.spec.L / 2, hw: c.spec.W / 2 };
  }
  function corner(B, nx, nz, sgn) {           // угол кузова, дальше всех по направлению sgn·n
    var a = (B.ux * nx + B.uz * nz) * sgn >= 0 ? 1 : -1, b = (B.sx * nx + B.sz * nz) * sgn >= 0 ? 1 : -1;
    return [B.x + B.ux * B.hl * a + B.sx * B.hw * b, B.z + B.uz * B.hl * a + B.sz * B.hw * b];
  }
  function satPair(a, b) {
    var A = box2(a), B = box2(b), dx = B.x - A.x, dz = B.z - A.z, best = 1e9, nx = 0, nz = 0;
    var axes = [[A.ux, A.uz], [A.sx, A.sz], [B.ux, B.uz], [B.sx, B.sz]];
    for (var i = 0; i < 4; i++) {
      var ax = axes[i][0], az = axes[i][1];
      var rA = A.hl * Math.abs(A.ux * ax + A.uz * az) + A.hw * Math.abs(A.sx * ax + A.sz * az);
      var rB = B.hl * Math.abs(B.ux * ax + B.uz * az) + B.hw * Math.abs(B.sx * ax + B.sz * az);
      var d = dx * ax + dz * az, ov = rA + rB - Math.abs(d);
      if (ov <= 0) return null;
      if (ov < best) { best = ov; nx = d >= 0 ? ax : -ax; nz = d >= 0 ? az : -az; }
    }
    return { nx: nx, nz: nz, pen: best, pa: corner(A, nx, nz, 1), pb: corner(B, nx, nz, -1) };
  }
  // две дорожные машины всё же налезли друг на друга (поворот наперерез, вернулась в полосу после аварии): без удара
  // и урона раздвигаем, задняя — та, у которой другая впереди, — останавливается
  function lanePair(a, b) {
    var res = satPair(a, b);
    if (!res || res.pen < 0.03) return;
    var k = Math.min(res.pen, 0.6) * 0.5;
    a.x -= res.nx * k; a.z -= res.nz * k; b.x += res.nx * k; b.z += res.nz * k;
    var fa = (b.x - a.x) * Math.sin(a.heading) + (b.z - a.z) * Math.cos(a.heading);
    var fb = (a.x - b.x) * Math.sin(b.heading) + (a.z - b.z) * Math.cos(b.heading);
    var back = fa > fb ? a : b;
    back.v = Math.min(back.v, 0.3); back.vx = Math.sin(back.heading) * back.v; back.vz = Math.cos(back.heading) * back.v;
  }
  function carPair(a, b) {
    var res = satPair(a, b);
    if (!res) return;
    // дорожная машина становится «свободной», только если удар ощутимый
    [a, b].forEach(function (c) { if (c.ai && c.ai.mode === "lane") { c.vx = Math.sin(c.heading) * c.v; c.vz = Math.cos(c.heading) * c.v; } });
    var ma = a.spec.mass, mb = b.spec.mass;
    if (a.ai && a.ai.mode === "block") ma = 1e6;
    if (b.ai && b.ai.mode === "block") mb = 1e6;
    var ia = 1 / ma, ib = 1 / mb, s = ia + ib;
    a.x -= res.nx * res.pen * 0.8 * ia / s; a.z -= res.nz * res.pen * 0.8 * ia / s;
    b.x += res.nx * res.pen * 0.8 * ib / s; b.z += res.nz * res.pen * 0.8 * ib / s;
    var rvx = b.vx - a.vx, rvz = b.vz - a.vz, vn = rvx * res.nx + rvz * res.nz;
    if (vn >= 0) return;
    var j2 = -(1.3) * vn / s;
    a.vx -= j2 * res.nx * ia; a.vz -= j2 * res.nz * ia; b.vx += j2 * res.nx * ib; b.vz += j2 * res.nz * ib;
    a.w += ((res.pa[0] - a.x) * res.nz - (res.pa[1] - a.z) * res.nx) * j2 * ia * 0.5;
    b.w -= ((res.pb[0] - b.x) * res.nz - (res.pb[1] - b.z) * res.nx) * j2 * ib * 0.5;
    var dvA = j2 * ia, dvB = j2 * ib;
    [[a, dvA, b], [b, dvB, a]].forEach(function (q) {
      var c = q[0];
      if (c.ai && c.ai.mode === "lane" && q[1] > 2) { c.ai.mode = "free"; c.ai.freeT = 0; }
      else if (c.ai && c.ai.mode === "lane") { c.v = Math.max(0, c.v - q[1]); }
      impact(c, q[1], q[2]);
    });
    // PIT: удар патруля в заднюю треть машины игрока сбоку — разворот
    var P = FC.player;
    [[a, b], [b, a]].forEach(function (q) {
      var cop = q[0], tgt = q[1];
      if (!cop.police || cop.driver === "player" || tgt.driver !== "player" || !cop.ai || !cop.ai.pit) return;
      var fx = Math.sin(tgt.heading), fz = Math.cos(tgt.heading);
      var rel = (cop.x - tgt.x) * fx + (cop.z - tgt.z) * fz;
      if (rel < -tgt.spec.L * 0.2) {
        var side = (cop.x - tgt.x) * (-fz) + (cop.z - tgt.z) * fx;
        tgt.w += (side > 0 ? 1 : -1) * 1.6; tgt.driftT = 0.6;
        if (P.mode === "car") FC.cam.shake(0.5);
      }
    });
  }

  /* ---- пешеходы под колёсами и игрок пешком ------------------------------------------------------------------- */
  function hitPeople(car) {
    var spd = Math.hypot(car.vx, car.vz);
    if (spd < 1.2) return;
    var S = car.spec, fx = Math.sin(car.heading), fz = Math.cos(car.heading), all = FC.people.all;
    for (var i = 0; i < all.length; i++) {
      var ch = all[i];
      if (ch.kind === "player" || ch.kind === "remote" || ch.knocked > 0 || ch.room != null || ch.inside != null) continue;
      var dx = ch.x - car.x, dz = ch.z - car.z;
      if (Math.abs(dx) > S.L || Math.abs(dz) > S.L) continue;
      var lz = dx * fx + dz * fz, lx = dx * (-fz) + dz * fx;
      if (Math.abs(lz) > S.L / 2 + 0.35 || Math.abs(lx) > S.W / 2 + 0.35) continue;
      if (spd > 3) {
        FC.people.hit(ch, car.vx, car.vz, spd);
        car.vx *= 1 - Math.min(0.2, 70 / S.mass); car.vz *= 1 - Math.min(0.2, 70 / S.mass);
        if (car.driver === "player") {
          FC.cam.shake(0.25); if (FC.audio) FC.audio.play("thud");
          FC.emit("crime", { type: ch.kind === "cop" ? "hit_cop" : "hit_ped", x: car.x, z: car.z, victim: ch });
          FC.people.panic(car.x, car.z, 25, "car");
        }
      } else {
        var s = lx >= 0 ? 1 : -1, push = S.W / 2 + 0.4 - Math.abs(lx);
        ch.x += -fz * s * push; ch.z += fx * s * push;
      }
    }
  }
  // fmain зовёт это для игрока пешком: выталкивает из машин, сбивает быстрой машиной
  function pushOut(x, z, r) {
    var out = null, P = FC.player;
    for (var i = 0; i < list.length; i++) {
      var car = list[i];
      if (car.driver === "player") continue;
      var S = car.spec, dx = x - car.x, dz = z - car.z;
      if (Math.abs(dx) > S.L || Math.abs(dz) > S.L) continue;
      var fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      var lz = dx * fx + dz * fz, lx = dx * (-fz) + dz * fx;
      var hl = S.L / 2 + r, hw = S.W / 2 + r;
      if (Math.abs(lz) >= hl || Math.abs(lx) >= hw) continue;
      var spd = Math.hypot(car.vx, car.vz);
      if (spd > 4 && performance.now() - (P.carHitAt || 0) > 900) {
        P.carHitAt = performance.now();
        P.damage(Math.min(60, spd * 3), "car");
        FC.cam.shake(0.6);
        P.vx = car.vx * 0.8; P.vz = car.vz * 0.8;
        if (FC.audio) FC.audio.play("thud");
      }
      // выталкиваем по меньшей оси
      if (hl - Math.abs(lz) < hw - Math.abs(lx)) lz = Math.sign(lz || 1) * hl; else lx = Math.sign(lx || 1) * hw;
      x = car.x + fx * lz - fz * lx; z = car.z + fz * lz + fx * lx;
      out = { x: x, z: z };
    }
    return out;
  }

  /* ---- трафик: точки полосы, повороты, IDM, стоп-линии --------------------------------------------------------- */
  var LIMIT = { st: 11, av: 14, hw: 22 };
  function crossHalf(e, nodeI) { var n = M.nodes[nodeI]; return (e.axis === "z" ? n.hr.w : n.vr.w) / 2; }
  // добавить в путь машины полосу ребра e от узла from (полоса k), начиная с расстояния d
  function pushLane(ai, e, from, k, d) {
    var d1 = e.len - crossHalf(e, M.other(e, from)) - 0.6;
    for (var s = d; s < d1; s += 3) { var p = M.lanePoint(e, from, k, s / e.len); ai.wp.push({ x: p.x, z: p.z, kind: e.kind }); }
    var pe = M.lanePoint(e, from, k, d1 / e.len);
    ai.wp.push({ x: pe.x, z: pe.z, kind: e.kind, stop: { node: M.other(e, from), axis: e.axis }, dx: pe.dx, dz: pe.dz, e: e.i, from: from, k: k });
  }
  // выбрать следующее ребро на узле и добавить дугу поворота + начало следующей полосы
  function pushTurn(ai, last) {
    var e = M.edges[last.e], node = M.nodes[last.stop.node];
    // одностороннее ребро (Минск 1:1) — только от узла a; тупик — разворот или любое ребро
    var opts = node.edges.filter(function (ei) { var q = M.edges[ei]; return ei !== e.i && !(q.oneway && q.a !== node.i); });
    if (!opts.length) opts = e.oneway ? node.edges.filter(function (ei) { return ei !== e.i; }) : [e.i];
    if (!opts.length) opts = [e.i];
    var dx = last.dx, dz = last.dz, best = null, roll = Math.random(), acc = 0, cands = [];
    opts.forEach(function (ei) {
      var e2 = M.edges[ei], d0 = M.lanePoint(e2, node.i, 0, Math.min(1, 8 / e2.len)), ox = d0.dx, oz = d0.dz;   // ломаная — по первому отрезку
      var dot = dx * ox + dz * oz, crs = dx * oz - dz * ox;     // crs>0 — направо (правая система: x вправо, z вниз карты)
      var kind = dot > 0.7 ? "s" : crs > 0 ? "r" : "l";
      if (ai.police && e2.kind === "st" && Math.random() < 0.3) return;
      cands.push({ ei: ei, kind: kind, w: kind === "s" ? 0.5 : kind === "r" ? 0.3 : 0.2 });
    });
    if (!cands.length) cands.push({ ei: opts[0], kind: "s", w: 1 });
    var tot = cands.reduce(function (s, c) { return s + c.w; }, 0);
    for (var i = 0; i < cands.length; i++) { acc += cands[i].w / tot; if (roll <= acc) { best = cands[i]; break; } }
    best = best || cands[0];
    var e2 = M.edges[best.ei];
    var k2 = best.kind === "r" ? e2.lanes - 1 : best.kind === "l" ? 0 : Math.min(last.k, e2.lanes - 1);
    if (ai.bus) k2 = e2.lanes - 1;
    var s1 = crossHalf(e2, node.i) + 0.6;
    var p1 = M.lanePoint(e2, node.i, k2, s1 / e2.len);
    // контрольная точка — пересечение линий полос (на сетке — угол, в Минске — под любым углом)
    var cx = (last.x + p1.x) / 2, cz = (last.z + p1.z) / 2, den = dx * p1.dz - dz * p1.dx;
    if (best.kind !== "s" && Math.abs(den) > 0.2) {
      var tt = ((p1.x - last.x) * p1.dz - (p1.z - last.z) * p1.dx) / den;
      if (tt > 0 && tt < 40) { cx = last.x + dx * tt; cz = last.z + dz * tt; }
    }
    for (var t = 0.2; t < 0.95; t += 0.2) {
      var a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
      ai.wp.push({ x: a * last.x + b * cx + c * p1.x, z: a * last.z + b * cz + c * p1.z, turn: best.kind !== "s" });
    }
    pushLane(ai, e2, node.i, k2, s1);
  }
  function laneAI(e, from, k, d, opt) {
    opt = opt || {};
    // характер водителя: спокойный, обычный, лихач (быстрее, ближе к бамперу, чаще сигналит); спецмашины — быстро и мимо красного
    var aggr = !opt.bus && !opt.emergency && Math.random() < 0.2;
    var v0f = opt.emergency ? 1.45 : aggr ? 1.15 + Math.random() * 0.2 : opt.moto ? 1.05 + Math.random() * 0.25 : 0.8 + Math.random() * 0.28;
    var ai = { mode: "lane", wp: [], v0f: v0f, police: !!opt.police, bus: !!opt.bus, taxi: !!opt.taxi, moto: !!opt.moto,
      emergency: !!opt.emergency, aggr: aggr, offset: 0 };
    pushLane(ai, M.edges[e], from, k, d);
    return ai;
  }
  function ensurePath(ai) {
    var n = 0;
    while (ai.wp.length < 30 && n++ < 3) {
      var last = null;
      for (var i = ai.wp.length - 1; i >= 0; i--) if (ai.wp[i].stop) { last = ai.wp[i]; break; }
      if (!last || last.used) return;
      last.used = true;
      pushTurn(ai, last);
    }
  }
  // вернуть машину на ближайшую полосу (после удара или погони)
  function toLane(car) {
    var nl = M.nearestLane(car.x, car.z);
    if (!nl || Math.hypot(nl.x - car.x, nl.z - car.z) > 7) { car.ai = { mode: "free", freeT: 0, lost: true }; return false; }
    var e = M.edges[nl.edge];
    car.ai = laneAI(nl.edge, nl.from, nl.lane, nl.t * e.len, { police: car.police, bus: !!car.spec.bus, taxi: car.type === "taxi", moto: !!car.spec.moto, emergency: !!car.spec.emergency });
    car.v = Math.hypot(car.vx, car.vz);
    car.driver = car.police ? "cop" : "ai";
    return true;
  }

  function driveLane(car, dt) {
    var ai = car.ai, S = car.spec;
    ensurePath(ai);
    var fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    // выкинуть пройденные точки
    while (ai.wp.length > 1) {
      var p0 = ai.wp[0], ddx = p0.x - car.x, ddz = p0.z - car.z;
      if (ddx * fx + ddz * fz < 0.5 || ddx * ddx + ddz * ddz < 1.2) { ai.wp.shift(); continue; }
      break;
    }
    if (!ai.wp.length) { car.ai = { mode: "free", freeT: 0, lost: true }; return; }
    // цель pure pursuit
    var Ld = FC.clamp(4 + 0.6 * car.v, 5, 18), tgt = ai.wp[ai.wp.length - 1];
    for (var i = 0; i < ai.wp.length; i++) {
      var q = ai.wp[i]; if (Math.hypot(q.x - car.x, q.z - car.z) >= Ld) { tgt = q; break; }
    }
    var tx = tgt.x, tz = tgt.z;
    if (ai.offset) { var ox = tgt.dx != null ? tgt.dz : fz, oz = tgt.dx != null ? -tgt.dx : -fx; tx += ox * ai.offset; tz += oz * ai.offset; }
    var dx = tx - car.x, dz = tz - car.z;
    var lf = dx * fx + dz * fz, lleft = dx * fz - dz * fx;              // вперёд, влево
    var kap = 2 * lleft / Math.max(Ld * Ld, 1);
    var delta = FC.clamp(Math.atan(S.wb * kap), -S.maxSteer, S.maxSteer);
    if (lf < 0) delta = Math.sign(lleft || 1) * S.maxSteer;
    car.steer = delta / S.maxSteer;
    // желаемая скорость: дорога × характер водителя, кап на поворотах
    var v0 = Math.min((LIMIT[ai.wp[0].kind] || 12) * ai.v0f * (S.bus ? 0.8 : 1), S.vtop || 99);
    if (ai.panic > 0) { ai.panic -= dt; v0 *= 1.3; }
    var distAcc = 0, px = car.x, pz = car.z, stopD = 1e9, turnD = 1e9;
    for (var j = 0; j < ai.wp.length && distAcc < 60; j++) {
      var w = ai.wp[j]; distAcc += Math.hypot(w.x - px, w.z - pz); px = w.x; pz = w.z;
      if (w.turn && turnD > 1e8) turnD = distAcc;
      if (w.stop && stopD > 1e8 && !ai.emergency) {
        var sig = FC.build.signal(w.stop.node, w.stop.axis, w.e);
        if (sig === "r" || (sig === "y" && distAcc > car.v * car.v / 8 + 2)) stopD = distAcc;
      }
    }
    if (turnD < 18) v0 = Math.min(v0, 6 + turnD * 0.3);
    // уступить спецмашине (fcars2 ставит yieldT), остановка такси и автобуса у тротуара, мото между рядами, спецмашина по осевой
    if (ai.yieldT > 0) { ai.yieldT -= dt; v0 = Math.min(v0, 3); ai.offset = -2.1; ai.offT = 0.4; }
    else if (ai.curbT > 0) { ai.curbT -= dt; v0 = 0; ai.offset = -1.7; ai.offT = 0.4; }
    else if ((ai.taxi && Math.random() < dt / 50) || (ai.bus && Math.random() < dt / 26)) { if (turnD > 30 && stopD > 40) ai.curbT = ai.bus ? 6 : 4; }
    if (ai.emergency) { ai.offset = 1.6; ai.offT = 0.4; }
    else if (ai.moto && ai.wp[0].kind !== "st" && !(ai.yieldT > 0)) { ai.offset = 1.75; ai.offT = 0.4; }
    // лидер: ближайшая машина в коридоре впереди; игрок пешком на дороге — тоже
    var lead = stopD, leadV = 0, half = S.L / 2, blockedBy = null;
    for (var c = 0; c < list.length; c++) {
      var o = list[c]; if (o === car || o.dead) continue;
      var rx = o.x - car.x, rz = o.z - car.z;
      if (Math.abs(rx) > 50 || Math.abs(rz) > 50) continue;
      var f = rx * fx + rz * fz; if (f <= 0 || f > 45) continue;
      var lat = Math.abs(rx * fz - rz * fx);
      if (lat > (o.spec.W + S.W) / 2 + 0.2) continue;
      var gap = f - half - o.spec.L / 2;
      if (gap < lead) { lead = gap; leadV = (o.ai && o.ai.mode === "lane") ? o.v : o.vx * fx + o.vz * fz; blockedBy = o; }
    }
    var P = FC.player;
    if (P.mode === "foot") {
      var prx = P.x - car.x, prz = P.z - car.z, pf = prx * fx + prz * fz;
      if (pf > 0 && pf < 30 && Math.abs(prx * fz - prz * fx) < S.W / 2 + 0.8) { var pg = pf - half - 0.5; if (pg < lead) { lead = pg; leadV = 0; blockedBy = "player"; } }
    }
    // IDM
    var a = ai.aggr || ai.emergency ? 3.4 : 2.5, b = 3, s0 = ai.aggr ? 1.6 : 2.5, Tg = ai.aggr ? 0.8 : ai.moto ? 0.7 : 1.2, v = car.v;
    var acc = a * (1 - Math.pow(v / Math.max(v0, 0.1), 4));
    if (lead < 1e8) {
      var sStar = s0 + Math.max(0, v * Tg + v * (v - leadV) / (2 * Math.sqrt(a * b)));
      acc -= a * Math.pow(sStar / Math.max(lead, 0.3), 2);
    }
    acc = Math.max(acc, -9);
    car.braking = acc < -1.5;
    car.v = Math.max(0, v + acc * dt);
    // стоит из-за игрока или аварии — сигналит, потом объезжает по встречке
    if (car.v < 0.5 && blockedBy && (blockedBy === "player" || !(blockedBy.ai && blockedBy.ai.mode === "lane") || blockedBy.driver === "player")) {
      ai.wait = (ai.wait || 0) + dt;
      car.honkT -= dt;
      if (ai.wait > (ai.aggr ? 0.6 : 1.5) && car.honkT <= 0) {
        car.honkT = 2 + Math.random() * 3;
        var dp = Math.hypot(P.x - car.x, P.z - car.z);
        if (dp < 45 && FC.audio) FC.audio.play("horn", { vol: Math.max(0.15, 1 - dp / 45), pitch: hornPitch(car.spec) * (0.9 + Math.random() * 0.2) });
        if (dp < 25 && Math.random() < 0.35 && FC.hud) FC.hud.toast(pick(["📯 «Проезжай уже!»", "📯 «Освободи дорогу!»", "📯 «Ну сколько можно?»"]), "", 1.6);
      }
      if (ai.wait > 6 && !ai.offset) { ai.offset = 3.6; ai.offT = 6; }
    } else ai.wait = 0;
    if (ai.offset) { ai.offT -= dt; if (ai.offT <= 0) ai.offset = 0; }
    // кинематика велосипеда
    car.heading += car.v * Math.tan(delta) / S.wb * dt;
    car.vx = Math.sin(car.heading) * car.v; car.vz = Math.cos(car.heading) * car.v;
    car.x += car.vx * dt; car.z += car.vz * dt;
    car.w = car.v * Math.tan(delta) / S.wb;
  }

  /* Погоня и любая езда «к точке»: физика + автопилот (fpolice даёт car.ai.target(car) → {x, z, v, ram}). */
  function driveChase(car, dt) {
    var ai = car.ai, S = car.spec;
    var t = ai.target ? ai.target(car) : null;
    if (!t) { physSub(car, dt, { free: true }); return; }
    var fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    var dx = t.x - car.x, dz = t.z - car.z, d = Math.hypot(dx, dz);
    var lf = dx * fx + dz * fz, lleft = dx * fz - dz * fx;
    var err = Math.atan2(lleft, lf);
    var spd = Math.hypot(car.vx, car.vz);
    var inp = { steer: FC.clamp(err / (35 * D2R), -1, 1), throttle: 0, brake: 0 };
    var want = t.v != null ? t.v : S.vmax * 0.9;
    if (!t.ram && d < 9) want = Math.min(want, d * 0.8);
    if (Math.abs(err) > 1.2 && spd > 12) want = Math.min(want, 10);
    var vF = car.vx * fx + car.vz * fz;
    if (vF < want) inp.throttle = 1; else if (vF > want + 3) inp.brake = 0.7;
    // застрял: газ есть, а машина стоит — задний ход с обратным рулём
    if (ai.revT > 0) { ai.revT -= dt; inp.throttle = 0; inp.brake = 1; inp.reverse = true; inp.steer = -inp.steer; }
    else {
      ai.stuckT = (inp.throttle && spd < 1) ? (ai.stuckT || 0) + dt : 0;
      if (ai.stuckT > 1.6 || (lf < -3 && d < 14 && spd < 4)) { ai.revT = 1.4; ai.stuckT = 0; }
    }
    inp.boost = t.boost || 1;
    physSub(car, dt, inp);
  }
  /* Машина в воде: брызги при въезде, вязнет (сопротивление растёт), через секунду глохнет, оседает до крыши за ~4 с;
     через 7 с — утонула: игрок выплывает рядом (плывёт, fmain), машина остаётся на дне. Выехал на берег — всплывает. */
  function water(car, dt, inp) {
    var inW = M.water(car.x, car.z) && !M.onRoad(car.x, car.z);
    if (!inW) { if (car.wet) { car.wet = 0; } if (car.y < 0) car.y = Math.min(0, car.y + dt * 0.8); return; }
    if (!car.wet && FC.fx && FC.fx.burst) { FC.fx.burst(car.x, 0.1, car.z, "water", 46); if (FC.audio) FC.audio.play("splash"); }
    car.wet = (car.wet || 0) + dt;
    var k = Math.exp(-(1.2 + car.wet * 0.8) * dt);
    car.vx *= k; car.vz *= k; car.w *= Math.exp(-2.5 * dt);
    if (car.wet > 1.1 && inp) { inp.throttle = 0; inp.boost = 0; }
    car.y = Math.max(-1.35, (car.y || 0) - dt * 0.34);
    if (car.wet > 7 && !car.drowned) {
      car.drowned = true; car.wrecked = true;
      if (car.driver === "player") { exit(true); if (FC.hud) FC.hud.toast("Машина утонула — плыви к берегу", "", 3); }
    }
  }
  function surface(car, dt) {
    var s = FC.places && FC.places.surfaceAt ? FC.places.surfaceAt(car.x, car.z) : null, want = s != null ? s - 0.03 : 0;
    car.gy = car.gy == null || dt <= 0 ? want : FC.damp(car.gy, want, 12, dt);
  }
  function physSub(car, dt, inp) {
    surface(car, dt);
    if (car.driver === "player" || car.wet) water(car, dt, inp);
    var spd = Math.hypot(car.vx, car.vz);
    var n = Math.max(1, Math.min(8, Math.ceil(spd * dt / 0.45)));
    var h = dt / n;
    for (var i = 0; i < n; i++) {
      var px = car.x, pz = car.z;
      physStep(car, h, inp);
      hitWorld(car, px, pz);
    }
  }

  /* ---- игрок за рулём ------------------------------------------------------------------------------------------ */
  var I = FC.input;
  var drv = { steer: 0, rev: false, revT: 0 };
  function playerInput(car, dt) {
    var inp = { steer: 0, throttle: 0, brake: 0, hb: I.held("jump"), reverse: false, arcade: true };
    var spd = Math.hypot(car.vx, car.vz), fx = Math.sin(car.heading), fz = Math.cos(car.heading), vF = car.vx * fx + car.vz * fz;
    var touchStick = I.touch && (Math.abs(I.mx) > 0.12 || Math.abs(I.mz) > 0.12) && !(I.held("fw") || I.held("bw") || I.held("lf") || I.held("rt"));
    if (touchStick) {
      // джойстик относительно камеры: куда тянешь — туда едешь
      var yaw = FC.cam.yaw, s = Math.sin(yaw), c = Math.cos(yaw);
      var wx = -s * I.mz + c * I.mx, wz = -c * I.mz - s * I.mx, mag = Math.min(1, Math.hypot(I.mx, I.mz));
      var desired = Math.atan2(wx, wz), err = FC.angWrap(desired - car.heading);
      if (!drv.rev && Math.abs(err) > 120 * D2R && spd < 3) { drv.revT += dt; if (drv.revT > 0.25) drv.rev = true; } else drv.revT = 0;
      if (drv.rev && Math.abs(err) < 60 * D2R) drv.rev = false;
      if (drv.rev) {
        var err2 = FC.angWrap(desired + Math.PI - car.heading);
        inp.steer = -FC.clamp(err2 / (45 * D2R), -1, 1); inp.brake = mag; inp.reverse = true;
      } else {
        inp.steer = FC.clamp(err / (30 * D2R), -1, 1);
        inp.throttle = Math.pow(mag, 1.3) * (Math.abs(err) > 100 * D2R && spd > 6 ? 0 : 1);
        if (Math.abs(err) > 100 * D2R && spd > 6) inp.brake = 0.8;
      }
      drv.steer = inp.steer;
    } else {
      var up = I.held("fw") || I.mz > 0.3, dn = I.held("bw") || I.mz < -0.3;
      var target = (I.held("lf") || I.mx < -0.3 ? 1 : 0) - (I.held("rt") || I.mx > 0.3 ? 1 : 0);
      var rate = target === 0 || Math.sign(target) !== Math.sign(drv.steer) ? 12 : 7;
      drv.steer += FC.clamp(target - drv.steer, -rate * dt, rate * dt);
      inp.steer = drv.steer;
      if (up) inp.throttle = 1;
      if (dn) { if (vF > 0.5) inp.brake = 1; else { inp.brake = 1; inp.reverse = true; } }
    }
    if (I.pressed("horn") && FC.audio) FC.audio.play("horn", { vol: 1, pitch: hornPitch(car.spec) });
    inp.gears = true;
    // мотоцикл: «назад + газ» — вилли (руль слабее)
    if (car.spec.moto) {
      var back = I.held("bw") && (I.held("fw") || inp.throttle > 0.5);
      car.wheelieWant = back && spd > 2;
      if (car.wheelieWant) { inp.throttle = 1; inp.brake = 0; inp.reverse = false; inp.steer *= 0.2; }
    }
    if (FC.cars.mod) FC.cars.mod(car, inp, dt);
    return inp;
  }

  function hornPitch(S) { return S.moto || S.fb === "tuk" ? 1.5 : S.L > 5.5 ? 0.6 : S.cls === "lux" ? 0.8 : S.cls === "eco" ? 1.12 : 1; }

  /* ---- посадка, угон, выход ---------------------------------------------------------------------------------- */
  function enter(car) {
    var P = FC.player;
    if (!car || car.wrecked || P.mode !== "foot") return false;
    var stolen = false;
    if (car.driver === "ai" || car.driver === "cop") {
      stolen = true;
      var fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      var ex = car.x + fz * (car.spec.W / 2 + 0.9), ez = car.z - fx * (car.spec.W / 2 + 0.9);
      ejectDriver(car, ex, ez);
      FC.emit("crime", { type: car.police ? "police_car_theft" : "car_theft", x: car.x, z: car.z, car: car });
    }
    car.driver = "player"; car.ai = null; car.parked = false; car.siren = false;
    if (car.slot != null && SLOTS[car.slot]) { SLOTS[car.slot].car = null; SLOTS[car.slot].gone = true; car.slot = null; }
    P.mode = "car"; P.car = car; P.vy = 0;
    drv.steer = 0; drv.rev = false;
    if (FC.audio) FC.audio.play("door");
    I.setButton("car", { label: "🚪" }); I.setButton("jump", { label: "🅿️" }); I.setButton("punch", { show: false }); I.setButton("run", { label: "🔥", show: true });
    I.runToggle = false;
    FC.emit("car:enter", { car: car, stolen: stolen });
    return true;
  }
  function ejectDriver(car, x, z) {
    var cell = car.police ? FC.people.SPECIAL.cop : FC.people.randomCell();
    var ch = FC.people.make(car.police ? "cop" : "npc", cell, x, z, { scale: 1.8, walk: 4.6 });
    ch.alpha = 1;
    var t = 0, fx = x - car.x, fz = z - car.z, fl = Math.hypot(fx, fz) || 1;
    ch.update = function (c, dt) {
      t += dt;
      var sp = t < 0.4 ? 0 : 4.6;
      var r = M.collide(c.x + fx / fl * sp * dt, c.z + fz / fl * sp * dt, 0.35, { prev: c });
      if (r.hit) { var tmp = fx; fx = -fz; fz = tmp; }
      c.vx = (r.x - c.x) / Math.max(dt, 1e-3); c.vz = (r.z - c.z) / Math.max(dt, 1e-3); c.x = r.x; c.z = r.z; c.speed = sp;
      if (t > 9) { FC.people.remove(c); }
    };
    FC.people.say(ch, car.police ? "Стой! Это служебная!" : pick(["Эй! Моя машина!!", "Угоняют!", "Помогите, угон!", "Верни тачку!"]), 2.5);
  }
  function exit(force) {
    var P = FC.player, car = P.car;
    if (!car) return;
    var fx = Math.sin(car.heading), fz = Math.cos(car.heading), W = car.spec.W / 2 + 0.85;
    // дверь водителя — слева; занято — справа; иначе позади
    var opts = [[car.x + fz * W, car.z - fx * W], [car.x - fz * W, car.z + fx * W], [car.x - fx * (car.spec.L / 2 + 1), car.z - fz * (car.spec.L / 2 + 1)]];
    var pos = opts[0];
    for (var i = 0; i < opts.length; i++) { if (!M.buildingAt(opts[i][0], opts[i][1], 0.3) && !M.water(opts[i][0], opts[i][1])) { pos = opts[i]; break; } }
    car.driver = "none"; car.ai = { mode: "free", freeT: 0, parkedByPlayer: true };
    P.mode = "foot"; P.car = null;
    P.x = pos[0]; P.z = pos[1]; P.y = 0.2; P.vx = force ? car.vx * 0.3 : 0; P.vz = force ? car.vz * 0.3 : 0;
    P.heading = car.heading;
    if (FC.audio) { FC.audio.play("door"); if (FC.audio.loop) FC.audio.loop("engine", false); }
    I.setButton("car", { label: "🚗" }); I.setButton("jump", { label: "⤒" }); I.setButton("punch", { show: true }); I.setButton("run", { label: "🏃", show: false });
    I.runToggle = false; car.nitro = false;
    if (car.spec.moto || car.spec.fb === "tuk") { P.ch.scale = P.chScale || P.ch.scale; }
    FC.emit("car:exit", { car: car, force: !!force });
  }

  // FC.interact появляется позже (fhud грузится после нас) — подключаемся в init
  function carProvider(px, pz, room) {
    var P = FC.player;
    if (room != null || P.mode !== "foot" || P.dead) return null;
    var best = null, bd = 2.2;
    for (var i = 0; i < list.length; i++) {
      var car = list[i];
      if (car.wrecked || car.driver === "player" || car.driver === "remote") continue;
      var dx = px - car.x, dz = pz - car.z;
      if (Math.abs(dx) > 8 || Math.abs(dz) > 8) continue;
      var fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      var lz = dx * fx + dz * fz, lx = dx * (-fz) + dz * fx;
      var qx = FC.clamp(lx, -car.spec.W / 2, car.spec.W / 2), qz = FC.clamp(lz, -car.spec.L / 2, car.spec.L / 2);
      var d = Math.hypot(lx - qx, lz - qz);
      if (d < bd && Math.hypot(car.vx, car.vz) < 6) { bd = d; best = car; }
    }
    if (!best) return null;
    var c = best;
    var label = c.owned ? "Сесть в свою машину" : c.driver === "ai" ? "Угнать (" + c.spec.name + " с водителем)" :
      c.driver === "cop" ? "Угнать машину патруля" : c.police ? "Сесть в машину патруля" : "Сесть: " + c.spec.name;
    return [{ id: "car_" + c.id, x: px, z: pz, r: 5, key: "car", mode: "foot", label: label, act: function () { enter(c); } }];
  }

  /* ---- припаркованные: места вдоль улиц детерминированы, машины появляются рядом с игроком ---------------- */
  var SLOTS = [];
  (function slots() {
    M.edges.forEach(function (e) {
      if (e.kind !== "st" || e.bridge) return;
      var r = FC.rng(FC.hash("park" + e.i)), n = r.int(0, 3);
      var A = M.nodes[e.a], B = M.nodes[e.b], dx = (B.x - A.x) / e.len, dz = (B.z - A.z) / e.len;
      for (var k = 0; k < n; k++) {
        var t = r.range(0.2, 0.8), side = r.chance(0.5) ? 1 : -1, off = side * (M.minsk ? e.w / 2 + 1.1 : e.w / 2 - 1.05);
        var ap = M.axisPoint ? M.axisPoint(e, t) : { x: A.x + (B.x - A.x) * t, z: A.z + (B.z - A.z) * t, dx: dx, dz: dz };
        var x = ap.x - ap.dz * off, z = ap.z + ap.dx * off;
        var h = side > 0 ? Math.atan2(ap.dx, ap.dz) : Math.atan2(-ap.dx, -ap.dz);
        // тип и цвет — по смеси города (fcarlist.js), детерминированно от места: решаем при первом появлении
        SLOTS.push({ x: x, z: z, h: h, type: null, seed: FC.hash("pk" + e.i + ":" + k), dk: M.district(x, z).key, car: null, gone: false });
      }
    });
  })();
  var slotT = 0;
  function slotsTick() {
    var P = FC.player;
    for (var i = 0; i < SLOTS.length; i++) {
      var s = SLOTS[i], d2 = FC.dist2(s.x, s.z, P.x, P.z);
      // припаркованная появляется за 240 м (в кадре ближе 210 м — нет: не возникает перед носом на скорости)
      if (!s.car && !s.gone && d2 < 240 * 240 && (d2 > 210 * 210 || !(G.inView && G.inView(s.x, 1, s.z)) || performance.now() < (FC.fillUntil || 0) || !FC.started)) {
        if (list.some(function (c) { return FC.dist2(c.x, c.z, s.x, s.z) < 25; })) continue;
        if (!s.type) {
          var rs = FC.rng(s.seed);
          s.type = FC.carList ? FC.carList.pickParked(s.dk, FC.city, rs) : "sedan";
          if (!TYPES[s.type]) s.type = "sedan";
          var pal = TYPES[s.type].colors || PALETTE; s.color = pal[Math.floor(rs() * pal.length)];
        }
        s.car = spawn(s.type, s.x, s.z, s.h, { parked: true, color: s.color, slot: i });
      } else if (s.car && d2 > 265 * 265 && s.car.parked && s.car.slot === i) { remove(s.car); s.car = null; }
      if (s.gone && d2 > 300 * 300) s.gone = false;
    }
  }

  /* ---- трафик: кольцо вокруг игрока ---------------------------------------------------------------------- */
  // Смесь — fcarlist.js (FC.carList.pickTraffic): Минск — кроссоверы, компакты, маршрутки, автобусы и троллейбусы
  // по проспектам; Флейм-Сити — по районам (центр и Москва богаче, Алматы — тук-туки и маслкары).
  function trafficType(e, dk) {
    var t = FC.carList ? FC.carList.pickTraffic(e.kind, dk, FC.city) : "sedan";
    return TYPES[t] ? t : "sedan";
  }
  var spawnT = 0;
  function trafficCount() { var n = 0; for (var i = 0; i < list.length; i++) if (list[i].ai && list[i].ai.mode === "lane") n++; return n; }
  // Новые машины не появляются на глазах: в кадре — только дальше 240 м (там они маленькие и в дымке), рядом — только
  // за спиной и сбоку. Исключение — «пустой город» (старт, перемещение по карте: экран закрыт загрузкой) — тогда ближе.
  var R_IN = 85, R_OUT = 175;
  function trySpawnTraffic() {
    var P = FC.player, fill = performance.now() < (FC.fillUntil || 0) || !FC.started;
    var rMin = fill ? 85 : 140, rMax = fill ? 175 : 270;
    R_IN = rMin; R_OUT = rMax;
    var a = Math.random() * Math.PI * 2, r = rMin + 10 + Math.random() * (rMax - rMin - 20);
    // чаще — впереди по движению
    var sp = Math.hypot(P.vx, P.vz);
    if (sp > 3 && Math.random() < 0.6) a = Math.atan2(P.vz, P.vx) + (Math.random() - 0.5) * 1.6;
    var x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r;
    // ближайший перекрёсток → случайное его ребро, направление и полоса
    var node = M.nodes[M.nearestNode(x, z)], e = M.edges[pick(node.edges)];
    if (e.bridge && Math.random() < 0.5) return;
    var from = e.oneway || Math.random() < 0.5 ? e.a : e.b, lane = Math.floor(Math.random() * e.lanes), tt = 0, lp = null, d = 0;
    // точка на ребре в кольце 85–175 м: в Минске рёбра — длинные ломаные, одна случайная точка почти всегда мимо кольца
    for (var tr = 0; tr < 6; tr++) {
      tt = 0.15 + Math.random() * 0.7; lp = M.lanePoint(e, from, lane, tt);
      d = Math.hypot(lp.x - P.x, lp.z - P.z);
      if (d >= R_IN && d <= R_OUT) break;
    }
    if (d < R_IN || d > R_OUT) return;
    if (!fill && d < 240 && G.inView && G.inView(lp.x, 1, lp.z)) return;
    var nl = { edge: e.i, from: from, lane: lane, t: tt, x: lp.x, z: lp.z, dx: lp.dx, dz: lp.dz };
    for (var i = 0; i < list.length; i++) if (FC.dist2(list[i].x, list[i].z, nl.x, nl.z) < 14 * 14) return;
    var type = trafficType(e, M.district(nl.x, nl.z).key);
    if (TYPES[type].moto && e.lanes > 1) { lane = e.lanes - 1; lp = M.lanePoint(e, from, lane, tt); nl.x = lp.x; nl.z = lp.z; nl.lane = lane; }
    if (TYPES[type].bus && e.lanes > 1) { lane = e.lanes - 1; lp = M.lanePoint(e, from, lane, tt); nl.x = lp.x; nl.z = lp.z; nl.lane = lane; }
    var car = spawn(type, nl.x, nl.z, Math.atan2(nl.dx, nl.dz), { driver: type === "police" ? "cop" : "ai" });
    car.ai = laneAI(nl.edge, nl.from, nl.lane, nl.t * e.len, { police: type === "police", bus: !!TYPES[type].bus, taxi: type === "taxi", moto: !!TYPES[type].moto });
    car.v = (LIMIT[e.kind] || 12) * 0.7;
  }

  /* ---- рендер ---------------------------------------------------------------------------------------------- */
  var mB = new T.Matrix4(), mBody = new T.Matrix4(), mL = new T.Matrix4(), mW = new T.Matrix4();
  var qA = new T.Quaternion(), eA = new T.Euler(), vP = new T.Vector3(), vS = new T.Vector3(1, 1, 1), oB = new T.Object3D();
  var vW = new T.Vector3();
  // вид колёс (гараж): s — размер, w — ширина, c — оттенок диска
  var WHEEL_STYLE = { std: { s: 1, w: 1, c: [1, 1, 1] }, sport: { s: 0.97, w: 0.9, c: [1, 0.5, 0.45] },
    offroad: { s: 1.16, w: 1.3, c: [0.72, 0.7, 0.6] }, chrome: { s: 1.02, w: 1, c: [1.7, 1.7, 1.8] } };
  // ближний план — до LOD_D от камеры (модель типа, колёса крутятся, тени); дальше — силуэт класса одним мешем
  var LOD_D = G.Q.level === "high" ? 85 : G.Q.level === "mid" ? 60 : 45;
  function render(dt) {
    var cam = G.camera, night = G.night, t = performance.now() / 1000;
    var k;
    for (k in POOL) POOL[k].used = 0;
    for (k in POOL1) POOL1[k].used = 0;
    for (k in WPOOL) WPOOL[k].used = 0;
    var nb = 0, nbeam = 0, nr = 0, rp = null;
    var P = FC.player;
    for (var i = 0; i < list.length; i++) {
      var car = list[i];
      if (car.hidden) continue;
      var d2 = FC.dist2(car.x, car.z, cam.position.x, cam.position.z);
      if (d2 > 380 * 380) continue;
      var S = car.spec, md = modelOf(car.type);
      var far = d2 > LOD_D * LOD_D && car.driver !== "player" && LODM[S.lod];
      var pool = far ? pool1(S.lod) : pool0(car.type);
      if (pool.used >= pool.n && !grow(pool)) continue;
      var j = pool.used++;
      // крен и клевок — пружина с демпфером только на меше (ресерч: седан ~7°, спорт 3°, фургон 12°; разгон — нос вверх)
      var fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      var vF = car.vx * fx + car.vz * fz;
      var lat = car.w * vF;
      var lon = (vF - (car.prevVF || vF)) / Math.max(dt, 1e-3); car.prevVF = vF;
      var rollT, pitchT;
      if (S.moto) {
        // мотоцикл кренится В поворот, до 45°, не быстрее 180°/с; вилли — нос вверх на 25°
        rollT = FC.clamp(lat * 0.035, -0.78, 0.78);
        car.roll += FC.clamp(rollT - car.roll, -3.1 * dt, 3.1 * dt);
        car.wheelie = FC.damp(car.wheelie || 0, car.wheelieWant && !car.air ? 0.44 : 0, car.wheelieWant ? 4 : 7, dt);
        pitchT = -car.wheelie;
        car.pitch = FC.damp(car.pitch, pitchT, 10, dt);
      } else if (!far) {
        rollT = FC.clamp(-lat * 0.012 * S.roll, -0.12 * S.roll, 0.12 * S.roll);
        pitchT = FC.clamp(-lon * 0.006 * Math.min(S.roll, 1.2), -0.07, 0.07);
        var rv = car.rollV || 0, pv = car.pitchV || 0, sdt = Math.min(dt, 0.033);
        car.rollV = rv + ((rollT - car.roll) * 70 - rv * 9) * sdt;
        car.pitchV = pv + ((pitchT - car.pitch) * 80 - pv * 10) * sdt;
        car.roll += car.rollV * sdt; car.pitch += car.pitchV * sdt;
      }
      car.spin += vF / S.wr * dt;
      car.steerVis = FC.damp(car.steerVis, (car.steer || 0) * S.maxSteer, 10, dt);
      var pitchAll = car.pitch + (car.airPitch || 0);
      // вилли: поворот вокруг заднего колеса, а не центра — заднее колесо остаётся на асфальте
      var tu = car.tune, ws = tu && tu.wheels ? WHEEL_STYLE[tu.wheels] || WHEEL_STYLE.std : WHEEL_STYLE.std;
      if (car.gy == null) surface(car, 0);                       // стоящие без физики (во дворе, на бульваре) — тоже на плитке
      var y = (car.wrecked ? -0.08 : 0) + (car.y || 0) + car.gy + (pitchAll < 0 ? Math.sin(-pitchAll) * S.wb / 2 : 0) +
        (ws.s - 1) * S.wr - (tu && tu.lower ? tu.lower * 0.07 : 0);
      vP.set(car.x, y, car.z);
      eA.set(pitchAll, car.heading, car.roll, "YXZ"); qA.setFromEuler(eA);
      mBody.compose(vP, qA, vS);
      eA.set(0, car.heading, 0, "YXZ"); qA.setFromEuler(eA); mB.compose(vP, qA, vS);
      var mesh = pool.mesh;
      mesh.setMatrixAt(j, mBody);
      mesh.setColorAt(j, cTmp.set(colorHex(car.color)));
      // фары: днём ходовые огни, ночью ярко; фонари — ярче при торможении; стоящие без водителя — погашены
      var idle = car.parked && car.driver === "none", dead = car.wrecked;
      var head = dead || idle ? 0 : 0.18 + night * 2.6, tail = dead || idle ? 0 : car.braking ? 1.1 + night * 1.6 : 0.08 + night * 1.2;
      mesh.geometry.attributes.iLit.setXYZ(j, head, tail, dead ? 1 : 0);
      if (!far) {
        var wn = md.wheels.length, wp = wpool(md.wheelStyle), tw = md.tireW || 0.22;
        if (wp.used + wn > wp.n) grow(wp);
        var rim = 1;
        for (var w = 0; w < wn && wp.used < wp.n; w++) {
          var wd = md.wheels[w], left = wd[0] < 0;
          eA.set(left ? -car.spin : car.spin, (wd[3] ? car.steerVis : 0) + (left ? Math.PI : 0), 0, "YXZ");
          mL.makeRotationFromEuler(eA).scale(vW.set(tw * ws.w, S.wr * ws.s, S.wr * ws.s));
          mL.setPosition(wd[0], wd[1] - (ws.s - 1) * S.wr, wd[2]);
          // у мотоцикла колёса кренятся с кузовом; у остальных — по земле
          mW.multiplyMatrices(S.moto || car.y ? mBody : mB, mL);
          var wj = wp.used++;
          wp.mesh.setMatrixAt(wj, mW);
          wp.mesh.setColorAt(wj, cTmp.setRGB(ws.c[0] * rim, ws.c[1] * rim, ws.c[2] * rim));
          wp.mesh.geometry.attributes.iLit.setXYZ(wj, 0, 0, dead ? 1 : 0);
        }
        // седок мото и тук-тука (у игрока — его собственное существо, см. seatPlayer)
        var seat = md.seat || (md.rider ? [S.fb === "tuk" ? 0.82 : 0.86, S.fb === "tuk" ? 0.2 : -0.25] : null);
        if (seat && car.driver !== "player" && car.driver !== "none") {
          rp = rp || riderPool();
          if (nr < rp.instanceMatrix.count) { mL.makeTranslation(0, seat[0], seat[1]); mW.multiplyMatrices(mBody, mL); rp.setMatrixAt(nr++, mW); }
        }
      }
      var bc0 = md.beacons;
      if ((car.police || S.emergency) && bc0 && nb < BEACON_N - 1) {
        for (var bi = 0; bi < 2; bi++) {
          var bc = bc0[bi];
          mL.makeTranslation(bc[0], bc[1], bc[2]); mW.multiplyMatrices(mBody, mL);
          beaconMesh.setMatrixAt(nb, mW);
          var on = car.siren && ((Math.floor(t * 6) + bi) % 2 === 0);
          var cOn = car.police ? (bi ? 0x2a6bff : 0xff2030) : car.type === "ambulance" ? (bi ? 0xffffff : 0xff2030) : 0xff2030;
          beaconMesh.setColorAt(nb, cTmp.setHex(on ? cOn : (bi ? 0x0a1a40 : 0x400a0a)).multiplyScalar(on ? 3 : 1));
          nb++;
        }
      }
      // пятна фар ночью
      if (night > 0.05 && !car.wrecked && !idle && nbeam < 260) {
        oB.position.set(car.x + fx * (S.L / 2 + 4.8), 0.07, car.z + fz * (S.L / 2 + 4.8));
        oB.rotation.set(0, car.heading, 0); oB.scale.set(S.W * 2.6, 1, 10); oB.updateMatrix();
        beams.setMatrixAt(nbeam, oB.matrix);
        oB.position.set(car.x - fx * (S.L / 2 + 0.8), 0.07, car.z - fz * (S.L / 2 + 0.8));
        oB.scale.set(S.W * 1.4, 1, car.braking ? 3.4 : 2); oB.updateMatrix();
        tails.setMatrixAt(nbeam, oB.matrix);
        nbeam++;
      }
    }
    // пустой пул — меш выключен: 40 типов не должны стоить вызовов отрисовки
    [POOL, POOL1, WPOOL].forEach(function (set) {
      for (var q in set) {
        var pl = set[q], m = pl.mesh;
        m.count = pl.used; m.visible = pl.used > 0;
        if (pl.used) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.geometry.attributes.iLit.needsUpdate = true; }
      }
    });
    if (riderMesh) { riderMesh.count = nr; riderMesh.visible = nr > 0; riderMesh.instanceMatrix.needsUpdate = true; }
    beaconMesh.count = nb; beaconMesh.visible = nb > 0; beaconMesh.instanceMatrix.needsUpdate = true; if (beaconMesh.instanceColor) beaconMesh.instanceColor.needsUpdate = true;
    beams.count = nbeam; beams.visible = nbeam > 0; beams.instanceMatrix.needsUpdate = true; tails.count = nbeam; tails.visible = nbeam > 0; tails.instanceMatrix.needsUpdate = true;
    poolMat.opacity = night * 0.42; tailMat.opacity = night * 0.5;
    // фары игрока: настоящий прожектор (только high; объёмные конусы выглядели «пузырями» — убраны)
    var pc = P.mode === "car" ? P.car : null;
    var lightsOn = !!pc && night > 0.15 && !pc.wrecked;
    if (spot) {
      if (lightsOn) {
        var hx = Math.sin(pc.heading), hz = Math.cos(pc.heading);
        spot.position.set(pc.x + hx * (pc.spec.L / 2), 1.0, pc.z + hz * (pc.spec.L / 2));
        spot.target.position.set(pc.x + hx * 22, 0, pc.z + hz * 22);
        spot.intensity = 40 * night;
      } else spot.intensity = 0;
      spot.shadow.autoUpdate = lightsOn && spot.castShadow;
      G.spotShadow = spot.shadow.autoUpdate;
    }
    if (flashT > 0) {
      flashT -= dt; var k2 = 1 - flashT / 0.7;
      flash.scale.setScalar(8 + k2 * 30); flash.material.opacity = Math.max(0, 1 - k2);
      if (flashT <= 0) flash.visible = false;
    }
  }

  /* ---- кадр ----------------------------------------------------------------------------------------------- */
  var lastNode = -1, speedT = 0;
  function update(dt) {
    var P = FC.player;
    if (!P || !FC.started) return;
    var insideNow = FC.inside && FC.inside.active;
    // появление и уборка
    slotT -= dt; if (slotT <= 0) { slotT = 0.5; slotsTick(); }
    spawnT -= dt;
    if (spawnT <= 0 && !insideNow) {
      spawnT = 0.3;
      var tgap = Math.round(G.Q.cars * 1.5) - trafficCount();         // после старта и перемещения — пачкой
      for (var ts = 0; ts < Math.min(8, Math.max(0, Math.ceil(tgap / 4))); ts++) trySpawnTraffic();
    }
    for (var i = list.length - 1; i >= 0; i--) {
      var c = list[i];
      if (c.driver === "player" || c.owned || c.keep) continue;
      var d2 = FC.dist2(c.x, c.z, P.x, P.z);
      var lim = c.parked && c.driver === "none" ? 270 : c.wrecked ? 150 : 290;     // дальше кольца появления — не пропадают на глазах
      if (d2 > lim * lim) remove(c);
    }
    // ход
    for (var k = 0; k < list.length; k++) {
      var car = list[k];
      if (car.dead) continue;
      var px = car.x, pz = car.z;
      if (car.driver === "player") {
        physSub(car, dt, playerInput(car, dt));
        P.x = car.x; P.z = car.z; P.heading = car.heading; P.vx = car.vx; P.vz = car.vz; P.y = 0.6;
        playerExtras(car, dt);
        seatPlayer(car);
      } else if (car.ai && car.ai.mode === "lane") {
        driveLane(car, dt);
        if (FC.dist2(car.x, car.z, P.x, P.z) < 120 * 120) hitWorldSoft(car, px, pz);
      } else if (car.ai && car.ai.mode === "chase") {
        driveChase(car, dt);
      } else if (car.ai && car.ai.mode === "block") {
        car.vx = car.vz = 0;
      } else if (Math.abs(car.vx) + Math.abs(car.vz) > 0.05 || car.w) {
        physSub(car, dt, { free: true });
        if (car.ai && car.ai.mode === "free" && !car.ai.parkedByPlayer && !car.wrecked) {
          car.ai.freeT = Math.hypot(car.vx, car.vz) < 0.3 ? (car.ai.freeT || 0) + dt : 0;
          if (car.ai.freeT > 2.5 && !car.ai.lost) toLane(car);
        }
      }
      if (car.driver === "player" || (car.ai && car.ai.mode === "chase") || (car.ai && car.ai.mode === "free")) hitPeople(car);
      // повреждения: дым и огонь
      if (car.hp < 30 || car.burnT > 0) {
        car.smokeT -= dt;
        if (car.smokeT <= 0) {
          car.smokeT = car.wrecked ? 0.12 : car.hp < 12 ? 0.06 : 0.14;
          var fx = Math.sin(car.heading), fz = Math.cos(car.heading), hx = car.x + fx * car.spec.L * 0.32, hz = car.z + fz * car.spec.L * 0.32;
          var dark = car.hp < 12 || car.wrecked ? 0.08 : 0.55;
          emit(SMOKE, hx, 1.1, hz, (Math.random() - 0.5) * 0.6 + car.vx * 0.2, 1.6 + Math.random(), (Math.random() - 0.5) * 0.6 + car.vz * 0.2, 2.2, 0.8, 3.5, 0.55, dark, dark, dark);
          if (car.hp < 12 || car.burnT > 0) emit(FIRE, hx, 1.0, hz, (Math.random() - 0.5) * 0.8, 2 + Math.random() * 2, (Math.random() - 0.5) * 0.8, 0.5, 0.9, 0.3, 0.9, 1, 0.5, 0.12);
        }
        // горит: запас тает ~2 в секунду — есть время выскочить; взрыв только на нуле
        if (car.hp < 12 && !car.wrecked) { car.hp -= dt * 2; if (car.hp <= 0) explode(car); }
        if (car.burnT > 0) car.burnT -= dt;
      }
    }
    // столкновения машин (рядом с игроком)
    for (var a = 0; a < list.length; a++) {
      var A = list[a]; if (A.dead) continue;
      if (FC.dist2(A.x, A.z, P.x, P.z) > 140 * 140) continue;
      for (var b = a + 1; b < list.length; b++) {
        var B = list[b]; if (B.dead) continue;
        var rr = (Math.hypot(A.spec.L, A.spec.W) + Math.hypot(B.spec.L, B.spec.W)) / 2 + 0.3;
        if (Math.abs(A.x - B.x) > rr || Math.abs(A.z - B.z) > rr) continue;
        // два «дорожных» друг друга не толкают (у них IDM), но и не стоят друг в друге
        if (A.ai && A.ai.mode === "lane" && B.ai && B.ai.mode === "lane") { lanePair(A, B); continue; }
        if (A.parked && B.parked && A.driver === "none" && B.driver === "none") continue;
        carPair(A, B);
      }
    }
    // нарушения игрока: красный свет и скорость (засчитывает патруль, если видит — fpolice)
    var pc = P.mode === "car" ? P.car : null;
    if (pc) {
      var nI = M.nearestNode(pc.x, pc.z), n = M.nodes[nI];
      var inBox = Math.abs(pc.x - n.x) < n.vr.w / 2 && Math.abs(pc.z - n.z) < n.hr.w / 2;
      if (inBox && nI !== lastNode) {
        lastNode = nI;
        var axis = Math.abs(pc.vx) > Math.abs(pc.vz) ? "x" : "z", sp = Math.hypot(pc.vx, pc.vz);
        if (n.signal && sp > 4 && FC.build.signal(nI, axis) === "r") FC.emit("crime", { type: "red_light", x: pc.x, z: pc.z });
      } else if (!inBox && Math.hypot(pc.x - n.x, pc.z - n.z) > 25) lastNode = -1;
      speedT -= dt;
      var sp2 = Math.hypot(pc.vx, pc.vz), road = M.onRoad(pc.x, pc.z);
      if (road && speedT <= 0 && sp2 > 26) { speedT = 5; FC.emit("crime", { type: "speeding", x: pc.x, z: pc.z, speed: sp2 }); }
    }
    stepParticles(SMOKE, dt); stepParticles(FIRE, dt);
    render(dt);
    sirenSound();
  }
  // дорожные машины не въезжают в дома и столбы, но мягко (без урона)
  function hitWorldSoft(car, px, pz) {
    var cs = circles(car);
    for (var i = 0; i < cs.length; i++) {
      var r = M.collide(cs[i][0], cs[i][1], cs[i][2] * 0.85, { noProps: true, prev: { x: cs[i][0] + px - car.x, z: cs[i][1] + pz - car.z } });
      if (r.hit) { car.x += r.x - cs[i][0]; car.z += r.z - cs[i][1]; }
    }
  }
  // мотоцикл и тук-тук открытые — игрока видно в седле
  function seatPlayer(car) {
    var P = FC.player, ch = P.ch;
    if (!car.spec.moto && car.spec.fb !== "tuk") return;
    if (P.chScale == null) P.chScale = ch.scale;
    var fx = Math.sin(car.heading), fz = Math.cos(car.heading), back = car.spec.moto ? -0.3 : 0.15;
    ch.visible = true; ch.scale = P.chScale * 0.82;
    ch.x = car.x + fx * back; ch.z = car.z + fz * back; ch.y = (car.y || 0) + (car.spec.moto ? 0.78 : 0.7);
    ch.speed = 0; ch.vx = car.vx; ch.vz = car.vz; ch.lean = car.spec.moto ? -car.roll * 0.8 : 0;
  }
  // игрок за рулём: звук мотора, следы и дым шин, пожар внутри
  var skidAcc = 0;
  function playerExtras(car, dt) {
    var spd = Math.hypot(car.vx, car.vz), S = car.spec;
    if (FC.audio && FC.audio.loop) {
      var gearPos = spd / S.vmax * 5, frac = gearPos - Math.floor(gearPos);
      var base = S.flat ? 0.4 + spd / S.vmax * 0.9 : 0.55 + frac * 0.75 + Math.floor(gearPos) * 0.06;
      FC.audio.loop("engine", !car.wrecked, { rate: base * S.snd[0] * (car.nitro ? 1.12 : 1), vol: (0.35 + Math.min(0.5, spd / S.vmax)) * S.snd[1], kind: S.snd[2] });
    }
    var sliding = (car.drift && spd > 6) || (car.slip != null && Math.abs(car.slip) > 0.25 && spd > 8) || car.wheelspin > 0.3;
    if (sliding) {
      skidAcc += Math.max(spd, car.wheelspin > 0.3 ? 9 : 0) * dt;
      var fx = Math.sin(car.heading), fz = Math.cos(car.heading), rx = -fz, rz = fx, bk = -S.wb / 2, sd = S.W / 2 - 0.15;
      if (skidAcc > 0.7) {
        skidAcc = 0;
        var vh = Math.atan2(car.vx, car.vz);
        skid(car.x + fx * bk + rx * sd, car.z + fz * bk + rz * sd, vh);
        skid(car.x + fx * bk - rx * sd, car.z + fz * bk - rz * sd, vh);
        emit(SMOKE, car.x + fx * bk, 0.4, car.z + fz * bk, (Math.random() - 0.5), 0.8, (Math.random() - 0.5), 1.4, 0.6, 2.6, 0.35, 0.85, 0.85, 0.85);
      }
      if (FC.audio && FC.audio.loop) FC.audio.loop("skid", true, { vol: Math.min(1, spd / 25) });
    } else if (FC.audio && FC.audio.loop) FC.audio.loop("skid", false);
    // самовосстановление до 40% вне аварий (8 с без удара)
    if (!car.wrecked && car.hp < 40 && car.hp >= 12 && performance.now() - (car.lastHit || 0) > 8000) car.hp = Math.min(40, car.hp + dt * 2);
    if (car.hp < 12 && !car.wrecked) {
      FC.player.damage(4 * dt, "fire");
      if (!car.warned) { car.warned = true; FC.hud.toast("🔥 Машина горит — выходи (F)!", "bad", 3); }
    }
    // выход
    if (I.pressed("car")) { I.consume("car"); exit(false); }
  }
  function sirenSound() {
    if (!FC.audio || !FC.audio.loop) return;
    var P = FC.player, best = 1e9;
    for (var i = 0; i < list.length; i++) { var c = list[i]; if (c.siren && !c.wrecked) best = Math.min(best, Math.hypot(c.x - P.x, c.z - P.z)); }
    FC.audio.loop("siren", best < 160, { vol: Math.max(0, 1 - best / 160) });
  }

  /* ---- камера за машиной: исправленный «ленивый» поворот (fmain ставил камеру перед капотом) -------------------- */
  var camIdle = 0;
  function wrapCamera() {
    var sys = FC.systems.filter(function (s) { return s.name === "camera"; })[0];
    if (!sys || sys._carWrap) return;
    var orig = sys.update;
    sys._carWrap = true;
    sys.update = function (dt) {
      var P = FC.player, cam = FC.cam;
      if (P && P.mode === "car" && P.car && cam) {
        var car = P.car, fx = Math.sin(car.heading), fz = Math.cos(car.heading);
        var vF = car.vx * fx + car.vz * fz, sp = Math.hypot(car.vx, car.vz);
        if (camIdle > 1.2) {
          var behind = sp > 5 && vF > 0 ? Math.atan2(-car.vx, -car.vz) : car.heading + Math.PI;
          cam.yaw = FC.angDamp(cam.yaw, behind, 3.2, dt);
          cam.pitch = FC.damp(cam.pitch, 0.22, 2, dt);
        }
        cam.idle = 0;
        orig(dt);
        camIdle = cam.idle > 0 ? camIdle + dt : 0;
      } else { camIdle = 2; orig(dt); }
    };
  }

  // своя машина у дома
  function homeCar() {
    var me = FC.me; if (!me || !me.home || FC.save.flags.noHomeCar) return;
    var d = me.home.doors[0];
    var nl = M.nearestLane(d.x + d.nx * 8, d.z + d.nz * 8);
    if (!nl) return;
    var e = M.edges[nl.edge], A = M.nodes[e.a], B = M.nodes[e.b], dx = (B.x - A.x) / e.len, dz = (B.z - A.z) / e.len;
    // к обочине со стороны дома
    var side = ((d.x - nl.x) * (-dz) + (d.z - nl.z) * dx) > 0 ? 1 : -1, off = side * (e.w / 2 - 1.05);
    var bx = A.x + (B.x - A.x) * nl.t, bz = A.z + (B.z - A.z) * nl.t;
    var car = spawn(FC.save.flags.homeCarType || "sport", bx - dz * off, bz + dx * off, side > 0 ? Math.atan2(dx, dz) : Math.atan2(-dx, -dz),
      { owned: true, color: FC.save.carColor || 0xffb02e });
    car.keep = true;
    FC.cars.home = car;
  }

  FC.addSystem({
    name: "cars", order: 20,
    init: function () { FC.interact.provider(carProvider); wrapCamera(); homeCar(); },
    update: update
  });
  FC.on("busted", function () { if (FC.player.mode === "car") exit(true); });

  FC.cars = {
    list: list, TYPES: TYPES, PALETTE: PALETTE, spawn: spawn, remove: remove, enter: enter, exit: exit, pushOut: pushOut,
    visual: visual, setColor: setColor, toLane: toLane, damage: damage, explode: explode, fwd: fwdOf,
    nearestTo: function (x, z, r, filter) {
      var best = null, bd = (r || 6) * (r || 6);
      for (var i = 0; i < list.length; i++) {
        var c = list[i]; if (filter && !filter(c)) continue;
        var d = FC.dist2(c.x, c.z, x, z); if (d < bd) { bd = d; best = c; }
      }
      return best;
    },
    repair: function (car) { car.hp = 100; car.spiked = false; car.fireT = 0; car.warned = false; },
    define: define, setModels: setModels, colorHex: colorHex, LOD_D: LOD_D,
    // отладка и проверки: досыпать трафик сразу (n попыток), а не пачками по 0,3 с
    fillTraffic: function (n) { for (var i = 0; i < (n || 40); i++) trySpawnTraffic(); return trafficCount(); },
    // витрина и гараж: имя, класс, км/ч и полоски 0..1 (скорость, разгон, управляемость, прочность)
    info: function (type) {
      var S = TYPES[type]; if (!S) return null;
      var C = FC.carList && FC.carList.CLS[S.cls], c01 = function (v) { return FC.clamp(v, 0.04, 1); };
      return { name: S.name, cls: C ? C.name : "", icon: C ? C.icon : "🚗", kmh: Math.round((S.vtop || S.vmax * 0.85) * 3.6), price: S.price || 0,
        speed: c01(((S.vtop || S.vmax) - 18) / 78), accel: c01(S.accel / 24), handling: c01(S.aLat * (S.resp || 1) / 21), armor: c01(1.15 - (S.armor || 1) * 0.85) };
    },
    // сколько мешей машин рисуется в кадре и сколько экземпляров (проверка бюджета вызовов)
    drawStats: function () {
      var o = { meshes: 0, inst: 0, near: 0, far: 0, wheels: 0, models: Object.keys(MODEL).length };
      [[POOL, "near"], [POOL1, "far"], [WPOOL, "wheels"]].forEach(function (q) {
        for (var k in q[0]) { var m = q[0][k].mesh; if (m.visible && m.count) { o.meshes++; o.inst += m.count; o[q[1]] += m.count; } }
      });
      [beaconMesh, beams, tails, riderMesh].forEach(function (m) { if (m && m.visible && m.count) o.meshes++; });
      return o;
    },
    // для fcars2 (нитро, трюки, спецмашины): полосы, частицы, следы
    LIMIT: LIMIT, _lane: laneAI, _fx: { emit: emit, SMOKE: SMOKE, FIRE: FIRE, skid: skid }, _phys: physStep, mod: null
  };
  // повтор и фоторежим (fphoto.js, 22.11 v3): нарисовать машины по их полям без хода физики — мир на паузе
  FC.cars.render = render;
})(window);
