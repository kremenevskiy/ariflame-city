/* Флейм-Сити — интерьеры: в ЛЮБОЕ здание можно войти, внутри этажи, у каждого этажа свой план и арендатор.
 *
 * Этаж строится НА МЕСТЕ здания (те же x, z; высота этажа как у фасада FC.map): грани фасада изнутри не рисуются
 * (FrontSide), поэтому в окна виден настоящий город на нужной высоте. В памяти только один этаж; лифт маскирует
 * сборку (шторка → новый этаж → шторка). План — по сиду здания и этажа (одинаков у всех и при каждом заходе):
 * ядро (лифт + лестница), коридор кольцом или «хребтом», полосы комнат до наружных стен; залы магазинов, банков,
 * клубов и зданий-зон мира — открытым планом. Мебель — коробки и цилиндры инстансами (ffurn.js — наборы по типу
 * комнаты), всё в «запечённом» освещении без источников света: тени граней, затенение у пола, пятна от светильников
 * — шейдером, поэтому город снаружи не пересобирается и на телефоне дёшево.
 *
 * Агенты людей, которые сейчас работают в здании-зоне (FC.people.insideOf), сидят за столами на том этаже, где игрок,
 * и говорят, что делают. Ближняя стена между камерой и игроком растворяется (дизер), потолок не мешает камере.
 *
 * FC.inside: {active, building, floor, enter(B, doorIdx), exit(force), floorY(), collide(x, z, r), clampCam(...),
 *   label(), go(floor), spots}; события inside:enter, inside:floor {building, floor, spots}, inside:exit,
 *   inside:safe {building} (сейф банка — для сюжета), inside:talk {who: "mascot"} (кабинет талисмана).
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE, G = FC.gfx;
  var CORR = 1.8, WT = 0.14;

  var S = { active: false, building: null, floor: 0, group: null, y0: 0, FH: 3.5, W: 10, D: 10, ox: 0, oz: 0, c: 1, s: 0,
    colliders: [], lights: [], acts: [], seats: [], npcs: [], seated: [], spots: null, plan: null, busy: false };

  /* ---- поворот: план строится в «канонических» координатах (вход — к -z), здание повёрнуто на 0/90/180/-90° ---- */
  var ROT = { n: 0, w: Math.PI / 2, s: Math.PI, e: -Math.PI / 2 };
  function toW(lx, lz) { return { x: S.ox + lx * S.c + lz * S.s, z: S.oz - lx * S.s + lz * S.c }; }
  function toL(wx, wz) { var dx = wx - S.ox, dz = wz - S.oz; return { x: dx * S.c - dz * S.s, z: dx * S.s + dz * S.c }; }

  /* ---- материалы: без источников света, освещение «запечено» шейдером ----------------------------------- */
  var lightArr = []; for (var li = 0; li < 8; li++) lightArr.push(new T.Vector3(0, -999, 0));
  var IU = { uCam: { value: new T.Vector3() }, uPly: { value: new T.Vector3() }, uFloorY: { value: 0 },
    uLights: { value: lightArr }, uLN: { value: 0 }, uCut: { value: 1 }, uTime: { value: 0 } };
  var GLSL = [
    "uniform vec3 uCam; uniform vec3 uPly; uniform float uFloorY; uniform vec3 uLights[8]; uniform float uLN; uniform float uCut; uniform float uTime;",
    "varying vec3 vIW; varying vec3 vIN;",
    "float iHash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }",
    "float iLight(vec3 p){ float s = 0.0; for (int i = 0; i < 8; i++) { if (float(i) >= uLN) break; vec3 d = p - uLights[i]; d.y *= 0.55; s += exp(-dot(d, d) / 16.0); } return s; }",
    "void iCut(vec3 p, vec3 n){",
    "  if (uCut < 0.5 || abs(n.y) > 0.5) return;",
    "  vec3 ab = uPly - uCam; float L = length(ab); if (L < 0.05) return;",
    "  vec3 dr = ab / L; float t = dot(p - uCam, dr);",
    "  if (t > 0.02 && t < L - 0.5) { float d = length(p - (uCam + dr * t)); float R = 0.95 + 0.3 * t / L;",
    "    if (d < R) { float k = smoothstep(R - 0.55, R, d); if (iHash(floor(gl_FragCoord.xy)) > k) discard; } }",
    "}"].join("\n");
  var VERT_DECL = "varying vec3 vIW; varying vec3 vIN;";
  var VERT_BODY = [
    "vec4 iw = vec4(transformed, 1.0);",
    "#ifdef USE_INSTANCING",
    "  iw = instanceMatrix * iw;",
    "#endif",
    "iw = modelMatrix * iw; vIW = iw.xyz;",
    "vec3 inrm = normal;",
    "#ifdef USE_INSTANCING",
    "  inrm = mat3(instanceMatrix) * inrm;",
    "#endif",
    "vIN = normalize(mat3(modelMatrix) * inrm);"].join("\n");
  function bake(mat, opt) {
    opt = opt || {};
    mat.onBeforeCompile = function (sh) {
      Object.keys(IU).forEach(function (k) { sh.uniforms[k] = IU[k]; });
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\n" + VERT_DECL + (opt.pat ? "\nattribute float aPat; varying float vPat;" : ""))
        .replace("#include <project_vertex>", "#include <project_vertex>\n" + VERT_BODY + (opt.pat ? "\nvPat = aPat;" : ""));
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\n" + GLSL + (opt.pat ? "\nvarying float vPat;" : ""))
        .replace("#include <color_fragment>", [
          "#include <color_fragment>",
          opt.cut ? "iCut(vIW, vIN);" : "",
          opt.pat ? [
            "{ vec3 pc = diffuseColor.rgb;",
            "  if (vPat > 0.5 && vPat < 1.5) { float pl = floor(vIW.x / 0.24); float off = iHash(vec2(pl, 3.0)) * 2.0;",
            "    float sg = floor((vIW.z + off) / 1.7); pc *= 0.84 + 0.22 * iHash(vec2(pl, sg));",
            "    pc *= 1.0 - 0.25 * step(fract(vIW.x / 0.24), 0.05); }",
            "  else if (vPat > 1.5 && vPat < 2.5) { vec2 f = fract(vIW.xz / 0.6); pc *= 1.0 - 0.16 * min(step(f.x, 0.035) + step(f.y, 0.035), 1.0);",
            "    pc *= 0.95 + 0.08 * iHash(floor(vIW.xz / 0.6)); }",
            "  else if (vPat > 2.5 && vPat < 3.5) { pc *= 0.9 + 0.12 * iHash(floor(vIW.xz * 9.0)); }",
            "  else if (vPat > 3.5 && vPat < 4.5) { vec2 c = floor(vIW.xz / 1.0); float ch = mod(c.x + c.y, 2.0);",
            "    float pulse = 0.5 + 0.5 * sin(uTime * 3.0 + iHash(c) * 6.28); pc = mix(pc * 0.35, pc * (1.2 + pulse), ch); }",
            "  diffuseColor.rgb = pc; }"].join("\n") : "",
          "{ float sh = 0.8 + 0.2 * vIN.y + 0.06 * abs(vIN.x) - 0.04 * abs(vIN.z);",
          "  float hy = vIW.y - uFloorY;",
          "  float ao = mix(0.72, 1.0, smoothstep(0.0, 0.85, hy)) * mix(1.0, 0.86, smoothstep(2.3, 3.4, hy));",
          "  float lp = iLight(vIW);",
          opt.flat ? "  diffuseColor.rgb *= 0.78 + 0.38 * min(lp, 1.4);" : "  diffuseColor.rgb *= sh * ao * (0.74 + 0.4 * min(lp, 1.4));",
          "}"].join("\n"));
    };
    mat.customProgramCacheKey = function () { return "fc-in-" + JSON.stringify(opt); };
    return mat;
  }
  var wallMat = bake(new T.MeshBasicMaterial({ vertexColors: true }), { cut: true });
  var floorMat = bake(new T.MeshBasicMaterial({ vertexColors: true }), { pat: true, flat: true });
  var furnMat = bake(new T.MeshBasicMaterial({ color: 0xffffff }), { cut: true });
  var glowMat = new T.MeshBasicMaterial({ color: 0xffffff });
  var glassMat = new T.MeshBasicMaterial({ color: 0xa8cde4, transparent: true, opacity: 0.14, depthWrite: false, side: T.DoubleSide });
  var boxGeo = new T.BoxGeometry(1, 1, 1), cylGeo = new T.CylinderGeometry(1, 1, 1, 14), planeGeo = new T.PlaneGeometry(1, 1);

  /* ---- накопитель геометрии стен/пола ---------------------------------------------------------------- */
  function Acc(pat) { return { p: [], n: [], c: [], i: [], pat: pat ? [] : null }; }
  var colr = new T.Color();
  function cArr(hex) { colr.set(hex); return [colr.r, colr.g, colr.b]; }
  function quad(a, v, n, c, pat) {
    var b = a.p.length / 3;
    for (var k = 0; k < 4; k++) { a.p.push(v[k][0], v[k][1], v[k][2]); a.n.push(n[0], n[1], n[2]); a.c.push(c[0], c[1], c[2]); if (a.pat) a.pat.push(pat || 0); }
    a.i.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  function abox(a, x0, x1, y0, y1, z0, z1, c, pat) {
    quad(a, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], c, pat);
    quad(a, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], c, pat);
    quad(a, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], c, pat);
    quad(a, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], c, pat);
    quad(a, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], c, pat);
  }
  function geoOf(a) {
    var g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(a.p, 3));
    g.setAttribute("normal", new T.Float32BufferAttribute(a.n, 3));
    g.setAttribute("color", new T.Float32BufferAttribute(a.c, 3));
    if (a.pat) g.setAttribute("aPat", new T.Float32BufferAttribute(a.pat, 1));
    g.setIndex(a.i);
    return g;
  }

  /* ---- что за здание: роль этажа, палитра, программа ------------------------------------------------- */
  var TEAM = [["Монтаж", "🎬", "#ff5d8f"], ["Фото", "📷", "#e1306c"], ["Сайты", "🌐", "#7c5cff"], ["Презентации", "📊", "#ff9f1c"],
    ["Разведка", "🛰️", "#ff4a4a"], ["Голос", "🎙️", "#41e0c8"], ["Маркетинг", "📣", "#ff8a3d"], ["Переводы", "🌍", "#2aabee"],
    ["Код", "🛠️", "#9dff8a"], ["Дизайн", "🎨", "#ffb02e"], ["Поддержка", "💬", "#6bd5ff"], ["Исследования", "🔬", "#c86bff"]];
  var TENANTS = [["ООО «Пиксель»", "🖼️", "#5b8cff"], ["Агентство «Хайп»", "📣", "#ff6b9a"], ["Юристы «Параграф»", "⚖️", "#b59b74"],
    ["Стартап «Нейронка»", "🧠", "#a77bff"], ["Бухгалтерия «Сальдо»", "🧮", "#6aa89a"], ["Дизайн-бюро «Линия»", "✏️", "#ffb02e"],
    ["Колл-центр «Алло»", "📞", "#ff7a59"], ["IT «Байт»", "💻", "#3fd98b"], ["Риелторы «Ключ»", "🔑", "#e9c46a"],
    ["Коворкинг «Улей»", "🐝", "#ffd23f"], ["Офис агентов Флейм", "🔥", "#ff8a3d"], ["Медиа «Кадр»", "🎥", "#ff4d6d"],
    ["Логистика «Маршрут»", "🚚", "#4cc9f0"], ["Студия «Звук»", "🎧", "#7c5cff"]];
  function hallKit(B) {
    if (B.zone) return "z:" + B.zone;
    if (B.poi === "biz") return "biz:" + (B.biz ? B.biz.id : "shop");
    if (B.poi === "hotel") return "hotellobby";
    if (B.poi && B.poi !== "hq") return B.poi;
    return null;
  }
  // этажи: банк — с подвалом-хранилищем (-1)
  function minFloor(B) { return B.poi === "bank" ? -1 : 0; }
  function hasRoof(B) { return B.floors >= 5; }
  function floorInfo(B, f) {
    var r = FC.rng(FC.hash(B.id + ":" + f, 7));
    var top = B.floors - 1, info = { role: "typical", plan: null, tenant: null, hero: null };
    if (B.place && FC.places && FC.places.floorInfo) { var pin = FC.places.floorInfo(B, f); if (pin) return pin; }
    var kit = hallKit(B);
    if (f < 0) { info.role = "vault"; info.plan = "open"; info.title = "Хранилище"; info.emoji = "🔐"; info.color = "#2fbf71"; return info; }
    if (f >= B.floors) { info.role = "roof"; info.plan = "open"; info.title = B.type === "hq" || B.h > 100 ? "Крыша · вертолётная площадка" : "Крыша"; info.emoji = "🌇"; info.color = "#ffcf7a"; return info; }
    if (B.type === "hq") {
      if (f === 0) { info.role = "lobbyhq"; info.plan = "open"; info.title = "Лобби Флейм"; info.emoji = "🔥"; info.color = "#ff8a3d"; }
      else if (f === top) { info.role = "boss"; info.plan = "open"; info.title = "Кабинет Макса"; info.emoji = "🔥"; info.color = "#ffcf7a"; }
      else if (f % 16 === 0) { info.role = "skylobby"; info.plan = "open"; info.title = "Небесное лобби"; info.emoji = "🌿"; info.color = "#7dffb0"; }
      else { var tm = TEAM[f % TEAM.length]; info.role = "team"; info.title = "Команда «" + tm[0] + "»"; info.emoji = tm[1]; info.color = tm[2]; info.tenant = tm; }
      return info;
    }
    if (kit) {
      info.plan = "open";
      if (f === 0 || B.zone || B.poi === "biz" || ["store", "gas", "paint", "club", "gym", "cars"].indexOf(B.poi) >= 0) {
        info.role = "hall"; info.kit = kit;
        if (f > 0) info.role = B.zone ? "zoneup" : "office";
        if (f > 0 && !B.zone) info.plan = null;
      } else {
        info.role = B.poi === "hospital" ? "wards" : B.poi === "police" ? "precinct" : B.poi === "hotel" ? "hotelrooms" : "office";
        info.plan = null;
      }
      info.title = B.name; info.emoji = B.emoji; info.color = B.color;
      if (f > 0 && info.role === "office") { var tn0 = TENANTS[(B.seed + f) % TENANTS.length]; info.tenant = tn0; info.title = tn0[0]; info.emoji = tn0[1]; info.color = tn0[2]; }
      return info;
    }
    if (B.type === "res") {
      info.role = f === 0 && B.floors > 1 ? "lobbyres" : "apartments";
      info.title = f === 0 && B.floors > 1 ? "Подъезд" : "Квартиры";
      info.emoji = "🏠"; info.color = "#e9c46a";
      if (f === 0 && B.floors === 1) info.plan = "open";
      return info;
    }
    // офис
    if (f === 0 && B.floors > 1) { info.role = "lobby"; info.title = B.name; info.emoji = "🏢"; info.color = "#9fb4d0"; return info; }
    var tn = TENANTS[(B.seed + f * 7) % TENANTS.length];
    info.tenant = tn; info.title = tn[0]; info.emoji = tn[1]; info.color = tn[2];
    info.open = tn[0].indexOf("Коворкинг") === 0 || tn[0].indexOf("Колл") === 0 || tn[0].indexOf("Флейм") >= 0 || r.chance(0.45);
    if (f > 0 && r.chance(0.12)) info.hero = r.pick(["party", "renovation", "empty", "blackout"]);
    if (B.floors === 1) info.plan = "open";
    return info;
  }
  function floorH(B) { return B.h / Math.max(1, B.floors); }
  function insetAt(B, f) {
    if (!(B.style === "glass" && B.h > 90 && B.w > 22 && B.d > 22)) return 0;
    var y = 0.15 + (f + 0.5) * floorH(B);
    return y < B.h * 0.18 ? 0 : y < B.h * 0.8 ? 3 : 6;
  }

  /* ---- план этажа -------------------------------------------------------------------------------------- */
  function rect(x0, x1, z0, z1, type) { return { x0: x0, x1: x1, z0: z0, z1: z1, type: type, doors: [] }; }
  function split(band, sizes, r) {
    var alongX = band.x1 - band.x0 >= band.z1 - band.z0;
    var L = alongX ? band.x1 - band.x0 : band.z1 - band.z0, out = [], pos = 0;
    while (pos < L - 0.01) {
      var s = Math.min(L - pos, r.range(sizes[0], sizes[1]));
      if (L - pos - s < sizes[0] * 0.75) s = L - pos;
      out.push(alongX ? rect(band.x0 + pos, band.x0 + pos + s, band.z0, band.z1) : rect(band.x0, band.x1, band.z0 + pos, band.z0 + pos + s));
      pos += s;
    }
    out.forEach(function (o) { o.alongX = alongX; o.band = band; });
    return out;
  }
  function layout(B, f, info, W, D, r) {
    var hw = W / 2, hd = D / 2, P = { rooms: [], corr: [], core: null, walls: [], exits: [], W: W, D: D };
    var floors = B.floors + (minFloor(B) < 0 ? 1 : 0);
    var plan = info.plan || (W >= 22 && D >= 22 ? "ring" : W >= 16 && D >= 13 ? "spine" : "open");
    P.plan = plan;
    var needCore = floors > 1;
    function wall(x0, z0, x1, z1, gaps, color, ext) { P.walls.push({ x0: x0, z0: z0, x1: x1, z1: z1, gaps: gaps || [], color: color, ext: !!ext }); }
    // наружные стены (окна рисуются у ext), на 1-м этаже — проёмы дверей
    var g0 = [], g1 = [];
    if (f === 0) { g0.push([-1.3, 1.3]); if (B.doors.length > 1) g1.push([-1.0, 1.0]); }
    wall(-hw, -hd, hw, -hd, g0, null, true); wall(-hw, hd, hw, hd, g1, null, true);
    wall(-hw, -hd, -hw, hd, [], null, true); wall(hw, -hd, hw, hd, [], null, true);
    if (f === 0) {
      P.exits.push({ x: 0, z: -hd + 1.4, door: 0 });
      if (B.doors.length > 1) P.exits.push({ x: 0, z: hd - 1.4, door: 1 });
    }
    var cw = 6, cd = 4.4;
    if (plan === "ring") {
      var cx0 = -cw / 2, cx1 = cw / 2, cz0 = -cd / 2, cz1 = cd / 2, c = CORR;
      P.core = rect(cx0, cx1, cz0, cz1, "core");
      P.corr.push(rect(cx0 - c, cx1 + c, cz0 - c, cz0), rect(cx0 - c, cx1 + c, cz1, cz1 + c), rect(cx0 - c, cx0, cz0, cz1), rect(cx1, cx1 + c, cz0, cz1));
      var bands = [
        { b: rect(-hw, hw, -hd, cz0 - c), edge: "z", at: cz0 - c, span: [cx0 - c, cx1 + c] },
        { b: rect(-hw, hw, cz1 + c, hd), edge: "z", at: cz1 + c, span: [cx0 - c, cx1 + c] },
        { b: rect(-hw, cx0 - c, cz0 - c, cz1 + c), edge: "x", at: cx0 - c, span: [cz0 - c, cz1 + c] },
        { b: rect(cx1 + c, hw, cz0 - c, cz1 + c), edge: "x", at: cx1 + c, span: [cz0 - c, cz1 + c] }];
      bands.forEach(function (bd, bi) { addBand(P, bd, bi, info, r, wall); });
    } else if (plan === "spine") {
      var bz = hd - cd, c2 = CORR;
      P.core = rect(-cw / 2, cw / 2, bz, hd, "core");
      P.corr.push(rect(-hw, hw, bz - c2, bz));
      if (bz - c2 - (-hd) >= 3) addBand(P, { b: rect(-hw, hw, -hd, bz - c2), edge: "z", at: bz - c2, span: [-hw, hw] }, 0, info, r, wall);
      else P.corr.push(rect(-hw, hw, -hd, bz - c2));
      if (-cw / 2 - (-hw) >= 3) addBand(P, { b: rect(-hw, -cw / 2, bz, hd), edge: "z", at: bz, span: [-hw, -cw / 2] }, 1, info, r, wall);
      if (hw - cw / 2 >= 3) addBand(P, { b: rect(cw / 2, hw, bz, hd), edge: "z", at: bz, span: [cw / 2, hw] }, 2, info, r, wall);
    } else {
      // открытый план: зал на весь этаж; ядро (если нужно) — в дальнем правом углу
      if (needCore) {
        var ccw = Math.min(5.4, W * 0.45), ccd = Math.min(3.2, D * 0.35);
        P.core = rect(hw - ccw, hw, hd - ccd, hd, "core");
        P.small = true;
      }
      var type = roomTypeOpen(B, info);
      if (info.role === "hall" && D > 26 && W >= 10) {
        // глубокий зал: спереди — сам зал, сзади — служебные комнаты; к ядру — проход вдоль правой стены
        var zB = -hd + Math.max(16, D * 0.55), bx1 = P.core ? P.core.x0 - 0.2 : hw;
        var front = rect(-hw, hw, -hd, zB, type); front.open = true; P.rooms.push(front);
        if (P.core) P.corr.push(rect(bx1, hw, zB, P.core.z0));
        addBand(P, { b: rect(-hw, bx1, zB, hd), edge: "z", at: zB, span: [-hw, bx1] }, 3, { role: "backoffice", color: info.color }, r, wall);
      } else {
        var room = rect(-hw, hw, -hd, hd, type);
        room.open = true; room.core = P.core;
        P.rooms.push(room);
      }
    }
    // ядро: стены, проёмы лифта и лестницы на «лицевой» стороне
    if (P.core && needCore) {
      var C = P.core, mid = (C.x0 + C.x1) / 2, cwid = C.x1 - C.x0;
      var ex = C.x0 + cwid * 0.27, sx = C.x0 + cwid * 0.73;
      var faceZ = C.z0;
      // ядро — одна сплошная коробка с гранями наружу: камера, заехавшая в ядро, его не видит (FrontSide)
      P.coreSolid = true;
      P.elev = { x: ex, z: faceZ - 0.9, door: { x: ex, z: faceZ } };
      P.stairs = { x: sx, z: faceZ - 0.9, door: { x: sx, z: faceZ } };
      if (plan === "ring") { P.elev2 = { x: mid, z: C.z1 + 0.9 }; }
    } else if (P.core) P.core = null;
    return P;
  }
  function roomTypeOpen(B, info) {
    if (info.role === "hall") return info.kit;
    if (info.role === "vault") return "vault";
    if (info.role === "lobbyhq") return "lobbyhq";
    if (info.role === "boss") return "boss";
    if (info.role === "skylobby") return "skylobby";
    if (info.role === "zoneup") return "z:" + B.zone + ":up";
    if (info.role === "lobby") return "lobby";
    if (info.role === "lobbyres") return "lobbyres";
    if (info.role === "apartments") return "studioapt";
    if (info.role === "team") return "team";
    if (info.hero) return info.hero;
    return info.open ? "open" : "office";
  }
  // полоса комнат вдоль коридора: делим, раздаём типы, двери в коридор и между соседями
  function addBand(P, bd, bi, info, r, wall) {
    var b = bd.b;
    if (b.x1 - b.x0 < 2.6 || b.z1 - b.z0 < 2.6) { P.corr.push(b); return; }
    var role = info.role, rooms;
    var depth = Math.min(b.x1 - b.x0, b.z1 - b.z0);
    if (role === "lobby" && bi === 0) { rooms = [rect(b.x0, b.x1, b.z0, b.z1, "lobby")]; rooms[0].open = true; }
    else if (role === "lobbyres" && bi === 0) { rooms = [rect(b.x0, b.x1, b.z0, b.z1, "lobbyres")]; rooms[0].open = true; }
    else if (role === "lobbyhq" || role === "team" && (bi === 0 || bi === 1)) { rooms = [rect(b.x0, b.x1, b.z0, b.z1, "team")]; rooms[0].open = true; }
    else if ((role === "typical" || role === "office") && info.open && (bi === 0 || bi === 1)) { rooms = [rect(b.x0, b.x1, b.z0, b.z1, info.hero || "open")]; rooms[0].open = true; }
    else {
      var sizes = role === "apartments" ? [3.4, 5.6] : role === "hotelrooms" ? [3.8, 4.6] : role === "wards" ? [5, 7.5] :
        role === "precinct" ? [3, 4.5] : [3.6, 6];
      rooms = split(b, sizes, r);
      var cyc = role === "apartments" ? ["living", "bedroom", "kitchenres", "bath", "bedroom", "living", "kitchenres"] :
        role === "hotelrooms" ? ["hotel"] : role === "wards" ? ["ward", "ward", "nurse", "ward"] :
          role === "precinct" ? ["cell", "cell", "interrogation", "bullpen", "cell"] :
            role === "lobby" ? ["cafe", "office", "meeting", "storage"] : role === "lobbyres" ? ["storage", "mail", "living"] :
              role === "team" ? ["meeting", "kitchen", "office", "server"] :
                ["office", "meeting", "office", "kitchen", "office", "server", "office", "wc"];
      if (info.hero && role !== "apartments") cyc = [info.hero];
      var off = r.int(0, cyc.length - 1);
      rooms.forEach(function (o, k) { o.type = cyc[(k + off + bi * 2) % cyc.length]; if (depth < 3.2 && o.type !== "wc" && o.type !== "storage") o.type = "storage"; });
    }
    // стена полосы со стороны коридора: двери тем комнатам, что выходят на коридор
    var gaps = [];
    rooms.forEach(function (o) {
      var a0 = bd.edge === "z" ? o.x0 : o.z0, a1 = bd.edge === "z" ? o.x1 : o.z1;
      var s0 = Math.max(a0, bd.span[0]), s1 = Math.min(a1, bd.span[1]);
      if (o.open) {
        // открытая зона — широкие проёмы в коридор
        if (s1 - s0 > 3) { gaps.push([s0 + 0.4, Math.min(s1 - 0.4, s0 + 3.4)]); if (s1 - s0 > 8) gaps.push([s1 - 3.4, s1 - 0.4]); }
      } else if (s1 - s0 > 1.4) {
        var dc = r.range(s0 + 0.7, s1 - 0.7);
        gaps.push([dc - 0.5, dc + 0.5]);
        o.doors.push(bd.edge === "z" ? { x: dc, z: bd.at } : { x: bd.at, z: dc });
      }
    });
    if (bd.edge === "z") wall(b.x0, bd.at, b.x1, bd.at, gaps); else wall(bd.at, b.z0, bd.at, b.z1, gaps);
    // перегородки между соседними комнатами — с дверью (связность гарантирована)
    for (var k = 1; k < rooms.length; k++) {
      var p = rooms[k - 1], q = rooms[k];
      if (p.alongX) {
        var lz0 = b.z0, lz1 = b.z1, dz = r.range(lz0 + 0.8, lz1 - 0.8);
        wall(q.x0, lz0, q.x0, lz1, [[dz - 0.45, dz + 0.45]]);
        p.doors.push({ x: q.x0, z: dz }); q.doors.push({ x: q.x0, z: dz });
      } else {
        var lx0 = b.x0, lx1 = b.x1, dx = r.range(lx0 + 0.8, lx1 - 0.8);
        wall(lx0, q.z0, lx1, q.z0, [[dx - 0.45, dx + 0.45]]);
        p.doors.push({ x: dx, z: q.z0 }); q.doors.push({ x: dx, z: q.z0 });
      }
    }
    rooms.forEach(function (o) { P.rooms.push(o); });
  }

  /* ---- сборка этажа: стены, пол, потолок, мебель (ffurn), окна, люди, взаимодействия -------------------- */
  var PAL = {
    office: { wall: "#e7e3da", floor: "#7d8a99", fpat: 3, ceil: "#f2f0ea" }, res: { wall: "#efe2cc", floor: "#a8734a", fpat: 1, ceil: "#f6f1e6" },
    hq: { wall: "#1d2233", floor: "#2b3042", fpat: 2, ceil: "#151926" }, store: { wall: "#f4f4f0", floor: "#d7d7d2", fpat: 2, ceil: "#fafafa" },
    bank: { wall: "#e9e1cf", floor: "#c9bfa9", fpat: 2, ceil: "#f6f1e4" }, police: { wall: "#c9d4e2", floor: "#8e98a6", fpat: 2, ceil: "#eef2f7" },
    hospital: { wall: "#eef6f4", floor: "#b9d3cc", fpat: 2, ceil: "#ffffff" }, club: { wall: "#1b1426", floor: "#5a2a8a", fpat: 4, ceil: "#0e0a16" },
    dark: { wall: "#23262e", floor: "#2c2f36", fpat: 3, ceil: "#1a1c22" }, studio: { wall: "#2a2d33", floor: "#3a3d44", fpat: 0, ceil: "#1c1e22" },
    warm: { wall: "#f1e4cf", floor: "#9b6a44", fpat: 1, ceil: "#f8f1e5" }, vault: { wall: "#5b6066", floor: "#6c7177", fpat: 2, ceil: "#4a4e53" },
    garage: { wall: "#cfd3d6", floor: "#8a8f94", fpat: 0, ceil: "#e6e9ec" },
    roof: { wall: "#8d8a84", floor: "#6f6c66", fpat: 2, ceil: "#8d8a84" }
  };
  function palette(B, info) {
    if (info.pal) return info.pal;                               // свой интерьер места (FC.places): стены, пол, потолок
    if (info.role === "vault") return PAL.vault;
    if (info.role === "roof") return PAL.roof;
    if (B.type === "hq") return info.role === "boss" ? PAL.hq : info.role === "lobbyhq" ? PAL.hq : PAL.office;
    if (B.zone) return ["shoot", "cut", "reels", "queue", "view", "scout"].indexOf(B.zone) >= 0 ? PAL.studio : B.zone === "memory" || B.zone === "library" ? PAL.warm : PAL.office;
    if (B.poi === "club" || (B.biz && B.biz.id === "nightclub")) return PAL.club;
    if (B.poi === "store" || B.poi === "gas" || (B.biz && (B.biz.id === "flowers" || B.biz.id === "shawarma"))) return PAL.store;
    if (B.poi === "bank") return PAL.bank;
    if (B.poi === "police") return PAL.police;
    if (B.poi === "hospital") return PAL.hospital;
    if (B.poi === "cars" || B.poi === "paint" || (B.biz && (B.biz.id === "carwash" || B.biz.id === "taxi"))) return PAL.garage;
    if (B.biz && (B.biz.id === "studio")) return PAL.dark;
    if (B.biz) return PAL.warm;
    if (B.type === "res") return PAL.res;
    return PAL.office;
  }

  var box = [], cyl = [], glow = [], signs = [];
  function build(B, f) {
    var t0 = performance.now();
    clear();
    var r = FC.rng(FC.hash(B.id + "/" + f, 11));
    var info = floorInfo(B, f), pal = palette(B, info);
    var inset = insetAt(B, f), ns = B.front === "n" || B.front === "s", RM = B.room || null;   // B.room — зал места из пакета (fplaces)
    var W = RM ? RM.w : (ns ? B.w : B.d) - 2 * inset - 0.5, D = RM ? RM.d : (ns ? B.d : B.w) - 2 * inset - 0.5;
    var FH = floorH(B);
    S.FH = FH; S.W = W; S.D = D; S.info = info; S.pal = pal;
    // 1-й этаж — выше плиты квартала (0,18): иначе пол города перекрывает наш (z-fighting)
    S.y0 = 0.15 + f * FH + (f === 0 ? 0.09 : 0.0);
    // подвал — целиком ниже плоскости воды под городом (-1,2): иначе вода режет комнату пополам
    if (f < 0) S.y0 = -1.35 - (FH - 0.32);
    var rot = RM ? RM.rot : B.rot != null ? B.rot : (ROT[B.front] || 0);       // Минск 1:1: дом под любым углом — свой поворот (fmapx)
    S.c = Math.cos(rot); S.s = Math.sin(rot); S.ox = RM ? RM.x : B.x; S.oz = RM ? RM.z : B.z;
    var P;
    if (info.role === "roof") {
      // крыша: ядро (будка лестницы и машинное отделение лифта) — там же, где на последнем этаже
      var Pt = layout(B, B.floors - 1, floorInfo(B, B.floors - 1), W, D, FC.rng(1));
      var roofRoom = rect(-W / 2, W / 2, -D / 2, D / 2, "roof"); roofRoom.open = true; roofRoom.core = Pt.core;
      P = { rooms: [roofRoom], corr: [], walls: [], exits: [], W: W, D: D, plan: Pt.plan, core: Pt.core, coreSolid: Pt.coreSolid,
        elev: Pt.elev, stairs: Pt.stairs, small: Pt.small, roof: true };
    } else P = layout(B, f, info, W, D, r);
    S.plan = P;
    S.stair = stairGeom(B, f, P, FH);
    // подвал без окон: город над головой не нужен (и его земля/вода не режут комнату) — прячем
    if (FC.build && FC.build.setVisible) FC.build.setVisible(f >= 0);
    var grp = new T.Group();
    grp.position.set(B.x, S.y0, B.z); grp.rotation.y = rot;
    var hc = FH - 0.32;                                   // высота потолка
    S.ceil = P.roof ? 40 : hc;
    var WA = Acc(false), FA = Acc(true), GL = Acc(false);
    var wallC = cArr(pal.wall), hw = W / 2, hd = D / 2;
    // пол: зал/комнаты своим цветом, коридор светлее
    var SG = S.stair;
    rectMinus(-hw, hw, -hd, hd, SG && SG.down ? SG.hole : null).forEach(function (q) { abox(FA, q[0], q[1], -0.25, 0.0, q[2], q[3], cArr(pal.floor), pal.fpat); });
    P.corr.forEach(function (c) { quad(FA, [[c.x0, 0.005, c.z1], [c.x1, 0.005, c.z1], [c.x1, 0.005, c.z0], [c.x0, 0.005, c.z0]], [0, 1, 0], cArr(G.tex.shade(pal.floor, 0.25)), pal.fpat === 4 ? 2 : pal.fpat); });
    P.rooms.forEach(function (o) {
      var fc = FLOOR_OF[o.type];
      if (!fc) return;
      quad(FA, [[o.x0, 0.006, o.z1], [o.x1, 0.006, o.z1], [o.x1, 0.006, o.z0], [o.x0, 0.006, o.z0]], [0, 1, 0], cArr(fc[0]), fc[1]);
    });
    // потолок (смотрит вниз)
    if (!P.roof) rectMinus(-hw, hw, -hd, hd, SG && SG.up ? SG.box : null).forEach(function (q) {
      quad(WA, [[q[0], hc, q[2]], [q[1], hc, q[2]], [q[1], hc, q[3]], [q[0], hc, q[3]]], [0, -1, 0], cArr(pal.ceil));
    });
    // стены
    var cols = [];
    P.walls.forEach(function (w) {
      var c = w.color ? cArr(w.color) : wallC;
      if (w.ext) extWall(WA, GL, w, B, info, hc, c, f, cols);
      else partWall(WA, w, hc, c, cols);
    });
    // ядро: сплошная коробка, двери лифта и лестницы на лицевой стороне
    var coreH = P.roof ? 2.9 : hc;
    if (P.core && P.coreSolid && SG) {
      abox(WA, P.core.x0, SG.x0, 0, coreH, P.core.z0, P.core.z1, cArr("#8d8a84"));
      stairShell(WA, SG, coreH, P.roof);
    } else if (P.core && P.coreSolid) abox(WA, P.core.x0, P.core.x1, 0, coreH, P.core.z0, P.core.z1, cArr("#8d8a84"));
    if (P.core && P.elev) coreDecor(P, hc, B, f);
    S.colliders = cols;
    if (P.core && SG) stairColliders(cols, P, SG);
    else if (P.core) cols.push([P.core.x0, P.core.x1, P.core.z0, P.core.z1]);
    if (P.roof) roofKit(cols, W, D, B);
    // мебель по комнатам (ffurn), светильники
    var ctx = kitCtx(B, f, info, P, r, hc);
    P.rooms.forEach(function (o) {
      ctx.room = o;
      var fn = FC.furn && FC.furn.kit(o.type);
      if (fn) { try { fn(o, ctx); } catch (e) { if (global.console) console.error("kit " + o.type, e); } }
      if (!P.roof) ceilingLights(o, hc, info);
    });
    P.corr.forEach(function (c) { ceilingLights(c, hc, info, true); });
    if (SG) S.lights.push([(SG.x0 + SG.x1) / 2, Math.min(hc, 2.6), (SG.z0 + SG.z1) / 2]);
    if (FC.furn && FC.furn.floorDecor) FC.furn.floorDecor(ctx);
    // вывеска арендатора у лифта
    if (P.elev && info.title && !info.place) addSign(   // у места (кальянная, бар) своя вывеска — табличка арендатора не нужна
      P.elev.door.x + (P.small ? -2.2 : 0), P.elev.door.z - 0.02, 2.35, 2.6, Math.PI, info.title, info.emoji || "", info.color || "#ffcf7a");
    // меши
    var wm = new T.Mesh(geoOf(WA), wallMat); grp.add(wm);
    var fm = new T.Mesh(geoOf(FA), floorMat); grp.add(fm);
    if (GL.p.length) { var gm = new T.Mesh(geoOf(GL), glassMat); gm.renderOrder = 2; grp.add(gm); }
    grp.add(instanced(boxGeo, furnMat, box, true));
    grp.add(instanced(cylGeo, furnMat, cyl, false));
    S.glowList = glow; S.glowMesh = instanced(boxGeo, glowMat, glow, true);
    grp.add(S.glowMesh);
    signs.forEach(function (s) { grp.add(s); });
    grp.traverse(function (o) { o.frustumCulled = false; o.matrixAutoUpdate = o === grp; });
    grp.updateMatrixWorld(true);
    G.add(grp);
    S.group = grp;
    // люди и взаимодействия
    S.ctx = ctx;
    if (FC.life && FC.life.populate) { try { FC.life.populate(B, f, ctx, S); } catch (e) { if (global.console) console.error("life", e); placePeople(B, f, ctx); } }
    else placePeople(B, f, ctx);
    registerActs(B, f, P, ctx, info);
    S.spots = spotsWorld(ctx);
    IU.uFloorY.value = S.y0;
    S.buildMs = Math.round(performance.now() - t0);
    FC.emit("inside:floor", { building: B, floor: f, spots: S.spots, info: info });
  }
  var FLOOR_OF = { bath: ["#d9e4ea", 2], wc: ["#d9e4ea", 2], kitchenres: ["#c9c1b2", 2], kitchen: ["#c9c1b2", 2], server: ["#5c626b", 2],
    living: ["#9b6a44", 1], bedroom: ["#8a5d3b", 1], cell: ["#7e8792", 0], meeting: ["#6b7b8e", 3], cafe: ["#a0522d", 1], hotel: ["#7a3f3f", 3],
    ward: ["#cfe3dd", 2], storage: ["#7d8188", 0], mail: ["#b9b2a5", 2] };

  // наружная стена: простенки и подоконные части, стекло в проёмах; на 1-м этаже — проёмы дверей
  function extWall(WA, GL, w, B, info, hc, c, f, cols) {
    var alongX = w.z0 === w.z1, L = alongX ? w.x1 - w.x0 : w.z1 - w.z0;
    var a0 = alongX ? w.x0 : w.z0, fixed = alongX ? w.z0 : w.x0;
    var inward = alongX ? (fixed < 0 ? 1 : -1) : (fixed < 0 ? 1 : -1);
    var t = 0.2, p0 = fixed + (inward > 0 ? 0 : -t), p1 = p0 + t;
    var glass = B.style === "glass" || info.role === "boss" || info.role === "lobbyhq";
    var noWin = f < 0 || info.role === "vault";
    var bay = glass ? 2.0 : B.style === "modern" ? 4.2 : B.style === "stalin" ? 3.6 : 3.2;
    var ws = glass ? 0.9 : 0.5, sill = glass ? 0.06 : 0.85, head = glass ? hc - 0.08 : Math.min(2.55, hc - 0.35);
    function seg(s0, s1, y0, y1) {
      if (s1 - s0 < 0.01 || y1 - y0 < 0.01) return;
      if (alongX) abox(WA, s0, s1, y0, y1, p0, p1, c); else abox(WA, p0, p1, y0, y1, s0, s1, c);
    }
    function pane(s0, s1, y0, y1) {
      if (alongX) { var z = (p0 + p1) / 2; quad(GL, [[s0, y0, z], [s1, y0, z], [s1, y1, z], [s0, y1, z]], [0, 0, 1], [1, 1, 1]); }
      else { var x = (p0 + p1) / 2; quad(GL, [[x, y0, s0], [x, y0, s1], [x, y1, s1], [x, y1, s0]], [1, 0, 0], [1, 1, 1]); }
    }
    // проёмы дверей (на 1-м этаже): режем отрезок
    var pieces = [[a0, a0 + L]];
    w.gaps.forEach(function (g) {
      var out = [];
      pieces.forEach(function (p) {
        if (g[1] <= p[0] || g[0] >= p[1]) { out.push(p); return; }
        if (g[0] > p[0]) out.push([p[0], g[0]]);
        if (g[1] < p[1]) out.push([g[1], p[1]]);
      });
      pieces = out;
      seg(g[0], g[1], 2.75, hc);                            // перемычка над дверью
      // стеклянная дверь
      pane(g[0], g[1], 0, 2.75);
    });
    pieces.forEach(function (p) {
      // столкновение — сплошная полоса
      if (alongX) cols.push([p[0], p[1], Math.min(p0, p1) - 0.05, Math.max(p0, p1) + 0.05]);
      else cols.push([Math.min(p0, p1) - 0.05, Math.max(p0, p1) + 0.05, p[0], p[1]]);
      if (noWin) { seg(p[0], p[1], 0, hc); return; }
      var n = Math.max(1, Math.round((p[1] - p[0]) / bay)), bw = (p[1] - p[0]) / n;
      for (var k = 0; k < n; k++) {
        var s = p[0] + k * bw, wv = bw * ws, m0 = s + (bw - wv) / 2, m1 = m0 + wv;
        if (wv < 0.6) { seg(s, s + bw, 0, hc); continue; }
        seg(s, m0, 0, hc); seg(m1, s + bw, 0, hc);         // простенки
        seg(m0, m1, 0, sill); seg(m0, m1, head, hc);       // под и над окном
        pane(m0, m1, sill, head);
        if (!glass) {                                      // подоконник
          if (alongX) box.push([(m0 + m1) / 2, sill, (p0 + p1) / 2 + inward * 0.12, wv + 0.1, 0.05, 0.3, "#dcd6cc", 0]);
          else box.push([(p0 + p1) / 2 + inward * 0.12, sill, (m0 + m1) / 2, 0.3, 0.05, wv + 0.1, "#dcd6cc", 0]);
        }
      }
    });
  }
  // перегородка: коробка толщиной WT с проёмами; над проёмом — перемычка
  function partWall(WA, w, hc, c, cols) {
    var alongX = w.z0 === w.z1, a0 = alongX ? w.x0 : w.z0, a1 = alongX ? w.x1 : w.z1, fx = alongX ? w.z0 : w.x0;
    var pieces = [[a0, a1]];
    w.gaps.slice().sort(function (p, q) { return p[0] - q[0]; }).forEach(function (g) {
      var out = [];
      pieces.forEach(function (p) {
        if (g[1] <= p[0] || g[0] >= p[1]) { out.push(p); return; }
        if (g[0] > p[0]) out.push([p[0], g[0]]);
        if (g[1] < p[1]) out.push([g[1], p[1]]);
      });
      pieces = out;
      if (alongX) abox(WA, g[0], g[1], 2.2, hc, fx - WT / 2, fx + WT / 2, c); else abox(WA, fx - WT / 2, fx + WT / 2, 2.2, hc, g[0], g[1], c);
    });
    pieces.forEach(function (p) {
      if (p[1] - p[0] < 0.02) return;
      if (alongX) { abox(WA, p[0], p[1], 0, hc, fx - WT / 2, fx + WT / 2, c); cols.push([p[0], p[1], fx - WT / 2 - 0.02, fx + WT / 2 + 0.02]); }
      else { abox(WA, fx - WT / 2, fx + WT / 2, 0, hc, p[0], p[1], c); cols.push([fx - WT / 2 - 0.02, fx + WT / 2 + 0.02, p[0], p[1]]); }
    });
  }
  /* ---- лестничная клетка: два марша «туда-обратно» с площадкой, проём вниз, ходьба по ступеням ------------
     Правая половина ядра. Левый марш поднимает от передней площадки к задней (до FH/2), правый — от задней к
     передней (до FH, это уже следующий этаж). Проём вниз — правая половина над маршем нижнего этажа: шагнул в него
     с уровня пола — уходишь на этаж ниже и оказываешься на его правом марше сверху. */
  function stairGeom(B, f, P, FH) {
    if (!P.core || !P.coreSolid) return null;
    var C = P.core, x0 = (C.x0 + C.x1) / 2, x1 = C.x1, z0 = C.z0, z1 = C.z1, dep = z1 - z0;
    // площадка разворота сзади — не уже 1,1 м: игрок (радиус 0,35) должен пройти между концом перегородки и задней
    // стеной (0,14). Было Lb = Lf ≤ 0,9 — зазор 0,6…0,76 м, игрок застревал на площадке и не мог подняться
    var Lf = Math.min(0.9, dep * 0.24), Lb = Math.max(Lf, Math.min(1.1, dep - Lf - 1.0)), run = dep - Lf - Lb;
    if (run < 0.8 || x1 - x0 < 1.6) return null;
    var roof = f >= B.floors;
    var g = { x0: x0, x1: x1, z0: z0, z1: z1, sm: (x0 + x1) / 2, Lf: Lf, Lb: Lb, run: run, FH: FH,
      up: !roof && (f < B.floors - 1 || hasRoof(B)), down: roof || f > minFloor(B) };
    g.box = { x0: x0, x1: x1, z0: z0, z1: z1 };
    g.hole = { x0: g.sm + 0.06, x1: x1 - 0.12, z0: z0 + Lf, z1: z1 - Lb };
    return g;
  }
  // прямоугольник минус дыра → до 4 прямоугольников [x0, x1, z0, z1]
  function rectMinus(x0, x1, z0, z1, H) {
    if (!H || H.x1 <= x0 || H.x0 >= x1 || H.z1 <= z0 || H.z0 >= z1) return [[x0, x1, z0, z1]];
    var out = [], hx0 = Math.max(x0, H.x0), hx1 = Math.min(x1, H.x1), hz0 = Math.max(z0, H.z0), hz1 = Math.min(z1, H.z1);
    if (hz0 > z0) out.push([x0, x1, z0, hz0]);
    if (hz1 < z1) out.push([x0, x1, hz1, z1]);
    if (hx0 > x0) out.push([x0, hx0, hz0, hz1]);
    if (hx1 < x1) out.push([hx1, x1, hz0, hz1]);
    return out;
  }
  function stairShell(WA, g, h, roof) {
    // свой вид лестницы у места: interior.stair {step, landing, wall, led: [цвета подсветки снизу вверх]}
    var pl = S.info && S.info.place, SS = (pl && pl.interior && pl.interior.stair) || {};
    var c = cArr(SS.wall || "#8d8a84"), N = 9, stepC = SS.step || "#b8b0a3", landC = SS.landing || SS.step || "#a69f93", FH = g.FH;
    var LED = SS.led && SS.led.length ? SS.led : ["#ffcf7a"], ledAt = function (i) { return LED[Math.min(LED.length - 1, Math.floor(i / N * LED.length))]; };
    abox(WA, g.x1 - 0.12, g.x1, g.down ? -FH / 2 : 0, h, g.z0, g.z1, c);          // правая стена
    abox(WA, g.x0, g.x1, g.down ? -FH / 2 : 0, h, g.z1 - 0.12, g.z1, c);          // задняя
    if (g.up) abox(WA, g.sm - 0.06, g.sm + 0.06, g.down ? -FH / 2 : 0, h, g.z0 + g.Lf, g.z1 - g.Lb, cArr("#9a968f"));   // между маршами
    else if (g.down) abox(WA, g.sm - 0.05, g.sm + 0.05, -FH / 2, 1.0, g.z0 + g.Lf, g.z1 - g.Lb, cArr("#3a3d42"));      // перила у проёма
    if (roof) abox(WA, g.x0 - 0.1, g.x1 + 0.05, h, h + 0.22, g.z0 - 0.25, g.z1 + 0.05, cArr("#6b6862"));            // крыша будки
    // шахта над пролётом: на лестнице камера поднимается выше потолка (он над клеткой вырезан) — раньше там была пустота
    // и белый туман на весь экран; теперь стены пролёта идут до следующего этажа и закрыты крышкой
    if (g.up && !roof) {
      var capY = FH + Math.min(1.8, h * 0.5), sc = cArr(SS.wall || "#7f7b74");
      abox(WA, g.x0 - 0.12, g.x0, h, capY, g.z0, g.z1, sc);                       // левая
      abox(WA, g.x1 - 0.12, g.x1, h, capY, g.z0, g.z1, sc);                       // правая
      abox(WA, g.x0, g.x1, h, capY, g.z1 - 0.12, g.z1, sc);                       // задняя
      abox(WA, g.x0, g.x1, h, capY, g.z0 - 0.12, g.z0, sc);                       // передняя (над входом в пролёт)
      abox(WA, g.x0 - 0.12, g.x1, capY, capY + 0.15, g.z0 - 0.12, g.z1, cArr("#3a3a3e"));   // крышка
      glow.push([(g.x0 + g.x1) / 2, capY - 0.06, (g.z0 + g.z1) / 2, 0.8, 0.04, 0.5, "#fff3d6"]);   // светильник в шахте
    }
    var a0 = g.z0 + g.Lf, a1 = g.z1 - g.Lb, sd = g.run / N, i;
    if (g.up) {
      for (i = 0; i < N; i++) {
        box.push([(g.x0 + g.sm) / 2 + 0.02, 0, a0 + (i + 0.5) * sd, g.sm - g.x0 - 0.12, (i + 1) * FH / 2 / N, sd + 0.01, stepC, 0]);
        glow.push([(g.x0 + g.sm) / 2 + 0.02, (i + 1) * FH / 2 / N, a0 + i * sd + 0.03, g.sm - g.x0 - 0.2, 0.012, 0.04, ledAt(i)]);
      }
      box.push([(g.x0 + g.x1) / 2, FH / 2 - 0.22, a1 + g.Lb / 2 - 0.06, g.x1 - g.x0 - 0.14, 0.22, g.Lb - 0.12, landC, 0]);
      for (i = 0; i < N; i++) {
        var tb = FH / 2 + (i + 1) * FH / 2 / N;
        box.push([(g.sm + g.x1) / 2 - 0.03, tb - 0.2, a1 - (i + 0.5) * sd, g.x1 - g.sm - 0.16, 0.2, sd + 0.01, stepC, 0]);
        glow.push([(g.sm + g.x1) / 2 - 0.03, tb, a1 - i * sd - 0.03 - sd + 0.06, g.x1 - g.sm - 0.24, 0.012, 0.04, ledAt(i)]);
      }
    }
    if (g.down) {
      for (i = 0; i < N; i++) box.push([(g.sm + g.x1) / 2 - 0.03, -(i + 1) * FH / 2 / N - 0.2, a0 + (i + 0.5) * sd, g.x1 - g.sm - 0.16, 0.2, sd + 0.01, stepC, 0]);
      box.push([(g.sm + g.x1) / 2, -FH / 2 - 0.45, (g.z0 + g.z1) / 2, g.x1 - g.sm, 0.1, g.z1 - g.z0, "#2a2c30", 0]);
      glow.push([(g.sm + g.x1) / 2, 0.01, a0 + 0.04, g.x1 - g.sm - 0.2, 0.02, 0.06, "#ffcf7a"]);   // кромка проёма
    }
    // таблички со стрелками
    if (g.up) glow.push([(g.x0 + g.sm) / 2, 2.1, g.z0 - 0.02, 0.36, 0.22, 0.02, "#2bff6a"]);
    if (g.down) glow.push([(g.sm + g.x1) / 2, 2.1, g.z0 - 0.02, 0.36, 0.22, 0.02, "#ff9a3c"]);
  }
  // столкновения клетки; «low» — только на уровне пола (над головой идёт марш)
  function stairColliders(cols, P, g) {
    var C = P.core;
    cols.push([C.x0, g.x0, C.z0, C.z1]);
    cols.push([g.x1 - 0.14, g.x1 + 0.02, C.z0, C.z1]);
    cols.push([g.x0, g.x1, g.z1 - 0.14, g.z1 + 0.02]);
    if (g.up || g.down) cols.push([g.sm - 0.08, g.sm + 0.08, g.z0 + g.Lf, g.z1 - g.Lb]);
    if (g.up && !g.down) cols.push([g.sm, g.x1, g.z0 + g.Lf + 0.3, g.z1 - g.Lb, "low"]);
  }
  // высота ступени под точкой клетки и куда ведёт (ph — высота игрока над полом этажа)
  function stairLocal(lx, lz, ph) {
    var g = S.stair;
    if (!g || lx < g.x0 || lx > g.x1 || lz < g.z0 - 0.05 || lz > g.z1) return null;
    var FH = g.FH, a0 = g.z0 + g.Lf, a1 = g.z1 - g.Lb, h = 0, act = null;
    if (lz >= a1) h = g.up ? FH / 2 : 0;
    else if (lx < g.sm) h = g.up ? FC.clamp((lz - a0) / g.run, 0, 1) * FH / 2 : 0;
    else if (g.up && ph > FH * 0.3) { h = FH / 2 + FC.clamp((a1 - lz) / g.run, 0, 1) * FH / 2; if (lz < a0 + 0.15) act = "up"; }
    else if (g.down && lz > a0 + 0.1) act = "down";
    return { h: h, act: act };
  }
  // переход по лестнице: тот же угол клетки на новом этаже (ядро может стоять иначе — переносим долями)
  function stairTo(nf, l, fromTop) {
    var B = S.building, g0 = S.stair, P = FC.player;
    var u = (l.x - g0.x0) / (g0.x1 - g0.x0), v = (l.z - g0.z0) / (g0.z1 - g0.z0), vx = P.vx, vz = P.vz;
    var camDy = G.camera.position.y - P.y;
    build(B, nf); S.floor = nf; FC.inside.floor = nf;
    var g = S.stair, lx = l.x, lz = l.z;
    if (g) {
      lx = g.x0 + u * (g.x1 - g.x0); lz = g.z0 + v * (g.z1 - g.z0);
      if (fromTop) lz = Math.max(lz, g.z0 + g.Lf + 0.5); else lz = Math.min(lz, g.z0 + g.Lf - 0.3);
    }
    var w = toW(lx, lz);
    P.x = w.x; P.z = w.z; P.vx = vx; P.vz = vz; P.vy = 0;
    if (fromTop && g) { var st = stairLocal(lx, lz, g.FH); P.y = S.y0 + (st ? st.h : g.FH * 0.9); } else P.y = S.y0;
    G.camera.position.y = P.y + camDy;
    S.stairCool = 0.7;
    if (FC.hud) FC.hud.toast(label(), "", 1.3);
    if (FC.audio) FC.audio.play("step");
  }
  /* ---- крыша: вертолётная площадка у высоток и штаба, иначе сад с гирляндами ----------------------------- */
  function roofKit(cols, W, D, B) {
    var hw = W / 2, hd = D / 2, r = FC.rng(B.seed + 77);
    cols.push([-hw - 1, -hw + 0.35, -hd, hd], [hw - 0.35, hw + 1, -hd, hd], [-hw, hw, -hd - 1, -hd + 0.35], [-hw, hw, hd - 0.35, hd + 1]);
    var cxp = S.plan.core ? -(S.plan.core.x0 + S.plan.core.x1) / 2 * 0.4 : 0, czp = S.plan.core ? -hd * 0.25 : 0;
    if (B.type === "hq" || B.h > 100) {
      var R = Math.min(hw, hd) * 0.42;
      cyl.push([cxp, 0, czp, R, 0.08, "#2b2f36"]);
      glow.push([cxp - R * 0.25, 0.09, czp, R * 0.12, 0.01, R * 0.9, "#ffffff"]);      // буква H
      glow.push([cxp + R * 0.25, 0.09, czp, R * 0.12, 0.01, R * 0.9, "#ffffff"]);
      glow.push([cxp, 0.09, czp, R * 0.5, 0.01, R * 0.12, "#ffffff"]);
      for (var k = 0; k < 16; k++) { var a = k / 16 * Math.PI * 2; glow.push([cxp + Math.cos(a) * R, 0.1, czp + Math.sin(a) * R, 0.18, 0.06, 0.18, k % 2 ? "#ffcf7a" : "#ff8a3d"]); }
    } else {
      for (var i = 0; i < 6; i++) {
        var px = r.range(-hw + 1.5, hw - 1.5), pz = r.range(-hd + 1.5, hd - 1.5);
        if (S.plan.core && px > S.plan.core.x0 - 1 && px < S.plan.core.x1 + 1 && pz > S.plan.core.z0 - 1 && pz < S.plan.core.z1 + 1) continue;
        box.push([px, 0, pz, 1.6, 0.5, 0.8, "#7a5a3f", 0]); cyl.push([px, 0.5, pz, 0.45, 0.55, "#4f9a52"]);
        cols.push([px - 0.85, px + 0.85, pz - 0.45, pz + 0.45]);
      }
      for (var j = 0; j < 14; j++) glow.push([-hw + 0.6 + j * (W - 1.2) / 13, 2.2 + Math.sin(j) * 0.15, -hd + 0.5, 0.08, 0.08, 0.08, ["#ffcf7a", "#ff6b9a", "#7dffb0"][j % 3]]);
    }
    // вентиляция и бак
    box.push([hw - 1.4, 0, hd - 1.4, 1.6, 1.1, 1.6, "#9aa1a8", 0]); cols.push([hw - 2.2, hw - 0.6, hd - 2.2, hd - 0.6]);
    cyl.push([-hw + 1.3, 0, hd - 1.3, 0.8, 1.8, "#b0aaa0"]); cols.push([-hw + 0.5, -hw + 2.1, hd - 2.1, hd - 0.5]);
  }

  function coreDecor(P, hc, B, f) {
    var e = P.elev.door, s = P.stairs.door;
    // двери лифта (металл), табло с номером этажа, кнопка
    box.push([e.x, 0, e.z - 0.06, 1.25, 2.2, 0.06, "#b9c0c8", 0]);
    box.push([e.x, 0, e.z - 0.09, 0.02, 2.2, 0.04, "#6c737b", 0]);
    glow.push([e.x, 2.35, e.z - 0.08, 0.6, 0.18, 0.03, "#ff9a3c"]);
    glow.push([e.x + 0.85, 1.1, e.z - 0.08, 0.1, 0.14, 0.03, "#9fe3ff"]);
    // лестница: открытый проём, над ним зелёная табличка
    glow.push([s.x, 2.3, s.z - 0.08, 0.5, 0.16, 0.03, "#2bff6a"]);
    if (f === 0 && B.floors > 1) glow.push([e.x, 2.62, e.z - 0.08, 1.2, 0.05, 0.02, "#ffd9a0"]);
    if (P.elev2) { box.push([P.elev2.x, 0, P.core.z1 + 0.06, 1.25, 2.2, 0.06, "#b9c0c8", 0]); glow.push([P.elev2.x, 2.35, P.core.z1 + 0.08, 0.6, 0.18, 0.03, "#ff9a3c"]); }
  }

  /* ---- светильники: панели в потолке (видны) + пятна света в шейдере ------------------------------------ */
  function ceilingLights(o, hc, info, corridor) {
    var w = o.x1 - o.x0, d = o.z1 - o.z0;
    var step = corridor ? 4.2 : 3.6;
    var nx = Math.max(1, Math.floor(w / step)), nz = Math.max(1, Math.floor(d / step));
    var dim = info.hero === "blackout";
    var club = S.pal === PAL.club;
    for (var i = 0; i < nx; i++) {
      for (var j = 0; j < nz; j++) {
        var x = o.x0 + (i + 0.5) * w / nx, z = o.z0 + (j + 0.5) * d / nz;
        if (S.plan.core && x > S.plan.core.x0 - 0.3 && x < S.plan.core.x1 + 0.3 && z > S.plan.core.z0 - 0.3 && z < S.plan.core.z1 + 0.3) continue;
        glow.push([x, hc - 0.05, z, corridor ? 0.5 : 1.1, 0.04, corridor ? 0.5 : 0.5, dim ? "#3a2020" : club ? "#c86bff" : "#fff4dc"]);
        if (!dim) S.lights.push([x, hc - 0.4, z]);
      }
    }
  }

  /* ---- контекст для наборов мебели (ffurn.js) --------------------------------------------------------- */
  function kitCtx(B, f, info, P, r, hc) {
    var clearZones = [];
    // у дверей комнат и у лифта/лестницы — не ставить мебель
    P.rooms.forEach(function (o) { o.doors.forEach(function (d) { clearZones.push([d.x - 1.1, d.x + 1.1, d.z - 1.1, d.z + 1.1]); }); });
    P.exits.forEach(function (e) { clearZones.push([e.x - 1.6, e.x + 1.6, e.z - 1.8, e.z + 2.2]); });
    if (P.elev) { clearZones.push([P.elev.x - 1.4, P.elev.x + 1.4, P.elev.z - 1.4, P.elev.z + 0.9]); clearZones.push([P.stairs.x - 1.3, P.stairs.x + 1.3, P.stairs.z - 1.4, P.stairs.z + 0.9]); }
    P.walls.forEach(function (w) {                       // проёмы в перегородках
      w.gaps.forEach(function (g) {
        if (w.z0 === w.z1) clearZones.push([g[0] - 0.3, g[1] + 0.3, w.z0 - 1.1, w.z0 + 1.1]);
        else clearZones.push([w.x0 - 1.1, w.x0 + 1.1, g[0] - 0.3, g[1] + 0.3]);
      });
    });
    function blocked(x0, x1, z0, z1) {
      for (var i = 0; i < clearZones.length; i++) {
        var c = clearZones[i];
        if (x1 > c[0] && x0 < c[1] && z1 > c[2] && z0 < c[3]) return true;
      }
      if (P.core && x1 > P.core.x0 - 0.2 && x0 < P.core.x1 + 0.2 && z1 > P.core.z0 - 0.2 && z0 < P.core.z1 + 0.2) return true;
      return Math.abs(x0) > S.W / 2 + 0.01 || Math.abs(x1) > S.W / 2 + 0.01 || Math.abs(z0) > S.D / 2 + 0.01 || Math.abs(z1) > S.D / 2 + 0.01;
    }
    var ctx = {
      B: B, f: f, info: info, plan: P, r: r, hc: hc, W: S.W, D: S.D, seats: [], npcs: [], acts: [], marks: {},
      blocked: blocked,
      // коробка: центр x,z, размеры w,d, высота h, низ y; rot — 0 или π/2 (меняет w/d); solid — препятствие
      box: function (x, z, w, d, h, y, color, opt) {
        opt = opt || {};
        var rw = opt.rot ? d : w, rd = opt.rot ? w : d;
        if (opt.solid !== false && !opt.force && blocked(x - rw / 2, x + rw / 2, z - rd / 2, z + rd / 2)) return false;
        box.push([x, y || 0, z, rw, h, rd, color, 0]);
        if (opt.solid !== false && (h + (y || 0)) > 0.35) S.colliders.push([x - rw / 2 - 0.05, x + rw / 2 + 0.05, z - rd / 2 - 0.05, z + rd / 2 + 0.05]);
        return true;
      },
      cyl: function (x, z, rad, h, y, color, opt) {
        opt = opt || {};
        if (opt.solid !== false && !opt.force && blocked(x - rad, x + rad, z - rad, z + rad)) return false;
        cyl.push([x, y || 0, z, rad, h, color]);
        if (opt.solid !== false && (h + (y || 0)) > 0.35) S.colliders.push([x - rad, x + rad, z - rad, z + rad]);
        return true;
      },
      glow: function (x, z, w, d, h, y, color) { glow.push([x, y || 0, z, w, h, d, color]); },
      seat: function (x, z, face, kind) { ctx.seats.push({ x: x, z: z, face: face || 0, kind: kind || "desk" }); },
      npc: function (x, z, cell, opt) { ctx.npcs.push(Object.assign({ x: x, z: z, cell: cell }, opt || {})); },
      act: function (x, z, label, fn, rr) { ctx.acts.push({ x: x, z: z, label: label, act: fn, r: rr || 1.7 }); },
      mark: function (k, x, z) { ctx.marks[k] = { x: x, z: z }; },
      sign: function (x, z, y, w, rotY, title, emoji, color) { addSign(x, z, y, w, rotY, title, emoji, color); },
      image: function (x, z, y, w, rotY, url) { addImage(x, z, y, w, rotY, url); },
      light: function (x, z) { S.lights.push([x, hc - 0.4, z]); }
    };
    return ctx;
  }
  function addSign(x, z, y, w, rotY, title, emoji, color) {
    var tex = G.tex.sign(title, emoji, color);
    var m = new T.Mesh(planeGeo, new T.MeshBasicMaterial({ map: tex, toneMapped: false }));
    m.scale.set(w, w * 0.25, 1);
    m.position.set(x, y, z); m.rotation.y = rotY;
    m.updateMatrix();               // у детей группы matrixAutoUpdate выключен (см. build) — без этого вывеска в центре комнаты 1×1
    signs.push(m);
  }
  // картинка на стене: ширина w, высота — по пропорциям картинки (раньше всё было квадратом: мурал 16:9 шириной 7 м
  // уходил за пол и потолок, а на уровне глаз оставалась пустая стена). Пока картинка грузится — квадрат.
  var imgCache = {}, imgAspect = {}, imgWait = {};
  function addImage(x, z, y, w, rotY, url) {
    var mat = imgCache[url];
    if (!mat) {
      var tex = new T.TextureLoader().load(url, function (t) {
        var im = t.image, a = im && im.width ? im.height / im.width : 1;
        imgAspect[url] = a;
        (imgWait[url] || []).forEach(function (q) { q.scale.y = q.userData.w * a; q.updateMatrix(); });
        imgWait[url] = [];
      });
      tex.colorSpace = T.SRGBColorSpace;
      mat = imgCache[url] = new T.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.05, side: T.DoubleSide, toneMapped: false });
    }
    var m = new T.Mesh(planeGeo, mat), a = imgAspect[url];
    m.userData.w = w;
    m.scale.set(w, a ? w * a : w, 1); m.position.set(x, y, z); m.rotation.y = rotY; m.userData.keep = true;
    m.updateMatrix();               // matrixAutoUpdate у детей группы выключен: без этого картинка висела в центре комнаты 1×1
    if (!a) (imgWait[url] = imgWait[url] || []).push(m);
    signs.push(m);
  }
  function instanced(geo, mat, list, isBox) {
    var im = new T.InstancedMesh(geo, mat, Math.max(1, list.length));
    var o = new T.Object3D(), c = new T.Color();
    list.forEach(function (it, i) {
      if (isBox) { o.position.set(it[0], it[1] + it[4] / 2, it[2]); o.scale.set(Math.max(it[3], 0.001), Math.max(it[4], 0.001), Math.max(it[5], 0.001)); o.rotation.set(0, it[7] || 0, 0); }
      else { o.position.set(it[0], it[1] + it[4] / 2, it[2]); o.scale.set(it[3], it[4], it[3]); o.rotation.set(0, 0, 0); }
      o.updateMatrix(); im.setMatrixAt(i, o.matrix);
      c.set(isBox ? it[6] : it[5]);
      if (mat === glowMat) c.multiplyScalar(1.6);
      im.setColorAt(i, c);
    });
    im.count = list.length;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    return im;
  }

  /* ---- люди внутри: живые агенты за столами, сотрудники, кассиры --------------------------------------- */
  var LINES = {
    office: ["Созвон через пять минут.", "Агент уже собрал отчёт.", "Кто взял мой степлер?", "Дедлайн — вчера.", "Кофе закончился!", "Отдал задачу агенту — сделает.", "Обед в 13:00?"],
    res: ["Кто опять шумит?", "Заказал пиццу.", "Сериал на паузе.", "Агент напомнил про коммуналку."],
    shop: ["Пакет нужен?", "Карта или наличные?", "Что-нибудь ещё?"],
    cop: ["Документы!", "Без глупостей.", "Штрафы — в окошко."],
    medic: ["Следующий!", "Не волнуйтесь, подлатаем."],
    club: ["🎵", "Огонь!", "Ещё трек!", "Какой бас!"], gym: ["Ещё подход!", "Не филонь!"],
    hq: ["Макс на 64-м.", "Релиз в пятницу!", "Агенты работают 24/7.", "Новый эффект уже в цеху."]
  };
  function placePeople(B, f, ctx) {
    var seats = ctx.seats.slice();
    var r = FC.rng(FC.hash(B.id + "#" + f, 3));
    // живые агенты: в здании-зоне все работающие — на этаже игрока
    var real = FC.people && FC.people.insideOf ? FC.people.insideOf(B) : [];
    real.sort(function (a, b) { return a.aid < b.aid ? -1 : 1; });
    var deskSeats = seats.filter(function (s) { return s.kind === "desk" || s.kind === "stand"; });
    real.forEach(function (ch, i) {
      var st = deskSeats[i % Math.max(1, deskSeats.length)];
      var w;
      if (st && i < deskSeats.length) { w = toW(st.x, st.z); st.taken = true; }
      else { var a = i * 2.4; w = toW(Math.cos(a) * (S.W / 4), Math.sin(a) * (S.D / 4)); }
      seat(ch, w, true);
      S.seated.push(ch);
    });
    // сотрудники: заданные набором (кассир, коп, медик, танцоры) + часть свободных столов
    ctx.npcs.forEach(function (n) { spawnNpc(n.cell != null ? n.cell : FC.people.randomCell(r), toW(n.x, n.z), n); });
    // живых агентов мало — сотрудники заполняют часть мест, но не всё (иначе толпа и лишняя нагрузка на телефон)
    var fillP = B.zone ? Math.max(0.12, 0.32 - real.length * 0.02) : S.info.role === "team" ? 0.4 : S.info.hero === "empty" ? 0 : 0.28;
    var cap = 60, used = 0;
    seats.forEach(function (s) {
      if (s.taken || s.kind === "bed" || s.kind === "vip") return;
      if (used < cap && r() < (s.kind === "chair" ? fillP * 0.5 : fillP)) { used++; s.taken = true; spawnNpc(FC.people.randomCell(r), toW(s.x, s.z), { line: lineSet(B) }); }
    });
  }
  function lineSet(B) {
    if (B.type === "hq") return LINES.hq;
    if (B.type === "res") return LINES.res;
    if (B.poi === "club" || (B.biz && B.biz.id === "nightclub")) return LINES.club;
    if (B.poi === "gym") return LINES.gym;
    return LINES.office;
  }
  function seat(ch, w, real) {
    ch._was = { kind: ch.kind, update: ch.update };
    ch.kind = "npc";
    ch.room = S.building.id;
    ch.x = w.x; ch.z = w.z; ch.y = S.y0; ch.ground = S.y0; ch.vx = ch.vz = 0; ch.speed = 0;
    ch.seatAt = { x: w.x, z: w.z };
    ch.realAgent = !!real;
    ch.update = npcUpdate;
  }
  function npcUpdate(ch) {
    var a = ch.seatAt; if (!a) return;
    ch.x = a.x; ch.z = a.z; ch.y = S.y0 + (ch.bounce ? Math.abs(Math.sin(performance.now() / 240 + ch.phase)) * 0.25 : 0);
    ch.vx = ch.vz = 0; ch.speed = ch.dance ? 2 : 0;
    ch.lean = ch.dance ? Math.sin(performance.now() / 300 + ch.phase) * 0.25 : 0;
  }
  function spawnNpc(cell, w, opt) {
    var ch = FC.people.make("npc", cell, w.x, w.z, { room: S.building.id, y: S.y0, ground: S.y0, scale: opt.scale || 1.8, alpha: 1 });
    ch.seatAt = { x: w.x, z: w.z }; ch.update = npcUpdate; ch.line = opt.line; ch.dance = !!opt.dance; ch.bounce = !!opt.dance;
    ch.title = opt.title || null;
    S.npcs.push(ch);
    return ch;
  }
  function freePeople() {
    S.seated.forEach(function (ch) {
      if (ch._was) { ch.kind = ch._was.kind; ch.update = ch._was.update; delete ch._was; }
      ch.room = null; ch.seatAt = null; ch.y = 0.15; ch.ground = undefined; ch.realAgent = false; ch.sit = false; ch.lean = 0;
      if (S.building && S.building.doors[0]) { var d = S.building.doors[0]; ch.x = d.x + d.nx * 3; ch.z = d.z + d.nz * 3; }
    });
    S.seated = [];
    S.npcs.forEach(function (ch) { FC.people.remove(ch); });
    S.npcs = [];
  }

  /* ---- взаимодействия этажа --------------------------------------------------------------------------- */
  function registerActs(B, f, P, ctx, info) {
    var id = 0;
    function add(lx, lz, label, act, rr, key) {
      var w = toW(lx, lz), iid = "in:" + B.id + ":" + f + ":" + (id++);
      FC.interact.add({ id: iid, x: w.x, z: w.z, r: rr || 1.7, label: label, key: key || "use", act: act, room: B.id });
      S.acts.push(iid);
    }
    P.exits.forEach(function (e) { add(e.x, e.z, "Выйти на улицу", function () { exit(false, e.door); }, 1.9); });
    var floors = floorList(B);
    if (P.elev && P.roof) add(P.stairs.x, P.stairs.z - 0.3, "Лестница вниз", function () { openStairs(); }, 1.5);
    else if (P.elev) {
      add(P.elev.x, P.elev.z, "Лифт · " + floors.length + " эт.", function () { openElevator(); }, 1.6);
      add(P.stairs.x, P.stairs.z - 0.3, "Лестница (быстро)", function () { openStairs(); }, 1.2);
      if (P.elev2) add(P.elev2.x, P.elev2.z, "Лифт (служебный)", function () { openElevator(); }, 1.6);
    }
    ctx.acts.forEach(function (a) { add(a.x, a.z, a.label, a.act, a.r); });
    // «Поработать» — до четырёх свободных столов (стул подсвечен)
    var n = 0;
    ctx.seats.forEach(function (s) {
      if (s.kind !== "desk" || s.taken || n >= 4 || info.hero === "empty") return;
      n++;
      add(s.x, s.z, "Поработать за столом", function () { work(B, f, s); }, 1.3);
    });
  }
  function work(B, f, s) {
    if (FC.jobs && FC.jobs.work) FC.jobs.work(B, { floor: f, desk: toW(s.x, s.z), zone: B.zone || null });
    else if (FC.hud) FC.hud.toast("Работа скоро откроется", "", 2);
  }
  function spotsWorld(ctx) {
    var o = { desks: [], seats: [], marks: {}, exits: [], elevator: null };
    ctx.seats.forEach(function (s) { var w = toW(s.x, s.z); w.y = S.y0; w.kind = s.kind; o.seats.push(w); if (s.kind === "desk") o.desks.push(w); });
    Object.keys(ctx.marks).forEach(function (k) { var w = toW(ctx.marks[k].x, ctx.marks[k].z); w.y = S.y0; o.marks[k] = w; });
    S.plan.exits.forEach(function (e) { var w = toW(e.x, e.z); w.y = S.y0; o.exits.push(w); });
    if (S.plan.elev) { o.elevator = toW(S.plan.elev.x, S.plan.elev.z); o.elevator.y = S.y0; }
    return o;
  }

  /* ---- живые агенты: подойти и посмотреть, кто это и что делает --------------------------------------- */
  // FC.interact живёт в fhud.js; порядок тегов в index.html может поменяться — подключаемся, когда он есть
  function bindAgentProvider() { if (bindAgentProvider.done || !FC.interact) return; bindAgentProvider.done = true; FC.interact.provider(agentProvider); }
  FC.on("start", bindAgentProvider);
  function agentProvider(px, pz, room) {
    if (!S.active || room !== S.building.id) return null;
    var out = [];
    S.seated.concat(S.npcs).forEach(function (ch) {
      if (FC.dist2(ch.x, ch.z, px, pz) > 2.2 * 2.2) return;
      if (ch.realAgent) out.push({ id: "ag:" + ch.id, x: ch.x, z: ch.z, r: 1.9, room: room, key: "use", label: "Агент: " + (ch.doing || "отдыхает"), act: function () { agentCard(ch); } });
    });
    return out;
  }
  bindAgentProvider();
  function agentCard(ch) {
    var W = global.FC_SPECIES, m = W && ch.creature ? W.META[ch.creature] : null;
    var zoneB = ch.zone && FC.map.zones[ch.zone];
    card("<div class='fi-ag'>" + (ch.cell >= 0 && ch.cell < 999 ? "<span class='fi-ava' style='" + FC.hud.atlasStyle(ch.cell) + "'></span>" : "<span class='fi-ava fi-egg'>👤</span>") +
      "<div><small>агент другого человека</small><h3>" + esc(m ? m[0] : "Агент") + "</h3><p>" + esc(m ? m[1] + " · " + m[2] : "") + "</p></div></div>" +
      "<p class='fi-doing'>" + esc((FC.people.ICON[ch.zone] || "✨") + " " + (ch.doing || "отдыхает")) + (zoneB ? " · " + esc(zoneB.name) : "") + "</p>" +
      "<p class='fi-q'>У каждого жителя города — свой агент. Он работает здесь, пока хозяин занят своими делами.</p>",
    [["Закрыть", null]]);
  }

  /* ---- вход, выход, этажи --------------------------------------------------------------------------- */
  function floorList(B) { var out = []; for (var f = minFloor(B); f < B.floors; f++) out.push(f); return out; }
  function enter(B, doorIdx) {
    if (S.busy || !B) return;
    bindAgentProvider();
    var P = FC.player; if (!P || P.mode !== "foot") return;
    S.busy = true;
    veil(true, function () {
      if (S.active) teardown();
      S.active = true; S.building = B; S.floor = 0; S.door = doorIdx || 0;
      FC.inside.active = true; FC.inside.building = B; FC.inside.floor = 0;
      build(B, 0);
      var e = S.plan.exits[Math.min(doorIdx || 0, S.plan.exits.length - 1)] || { x: 0, z: -S.D / 2 + 1.4 };
      var inwardZ = e.z < 0 ? 1 : -1;
      placePlayer(e.x, e.z + inwardZ * 0.6, inwardZ > 0 ? 0 : Math.PI);
      if (FC.audio) FC.audio.play("door");
      FC.emit("inside:enter", { building: B, floor: 0 });
      if (FC.hud) FC.hud.toast(B.name + (B.floors > 1 ? " · " + B.floors + " эт." : ""), "", 2.2);
      veil(false); S.busy = false;
    });
  }
  // localHeading: направление «вглубь» в канонических координатах (0 — к +z)
  function placePlayer(lx, lz, localHeading) {
    var P = FC.player, w = toW(lx, lz);
    P.x = w.x; P.z = w.z; P.y = S.y0; P.vx = P.vz = P.vy = 0;
    var rot = Math.atan2(S.s, S.c);
    P.heading = localHeading + rot;
    if (FC.cam) { FC.cam.yaw = P.heading + Math.PI; FC.cam.snap = true; FC.cam.pitch = 0.28; }
  }
  function go(f) {
    var B = S.building; if (!B || S.busy || f === S.floor) return;
    S.busy = true;
    if (FC.audio) FC.audio.play("elevator");
    var byStairs0 = S.goStairs;
    var riders = !byStairs0 && FC.life && FC.life.boardElevator ? FC.life.boardElevator(f) : [];
    veil(true, function () {
      var byStairs = S.goStairs; S.goStairs = false;
      build(B, f);
      S.floor = f; FC.inside.floor = f;
      var p = byStairs && S.plan.stairs ? S.plan.stairs : S.plan.elev || { x: 0, z: 0 };
      placePlayer(p.x, p.z - 0.3, Math.PI);
      if (FC.life && FC.life.arriveElevator && !byStairs) FC.life.arriveElevator(riders);
      if (FC.hud) FC.hud.toast(label() + (riders && riders.length ? " · с тобой ехали: " + riders.join(", ") : ""), "", 2.2);
      veil(false); S.busy = false;
    }, 420);
  }
  function exit(force, doorIdx) {
    if (!S.active) return;
    var B = S.building;
    var finish = function () {
      teardown();
      if (FC.build && FC.build.setVisible) FC.build.setVisible(true);
      S.active = false; FC.inside.active = false; FC.inside.building = null;
      if (!force) {
        var d = B.doors[Math.min(doorIdx || 0, B.doors.length - 1)];
        FC.player.teleport(d.x + d.nx * 2.2, d.z + d.nz * 2.2, Math.atan2(d.nx, d.nz));
        if (FC.cam) FC.cam.yaw = Math.atan2(d.nx, d.nz) + Math.PI;
        if (FC.audio) FC.audio.play("door");
      }
      FC.emit("inside:exit", { building: B });
    };
    if (force) { closeUI(); finish(); return; }
    S.busy = true;
    veil(true, function () { finish(); veil(false); S.busy = false; });
  }
  function teardown() {
    closeUI();
    freePeople();
    clear();
    S.acts.forEach(function (id) { FC.interact.remove(id); });
    S.acts = [];
  }
  function clear() {
    if (S.group) {
      G.scene.remove(S.group);
      S.group.traverse(function (o) {
        if (o.geometry && o.geometry !== boxGeo && o.geometry !== cylGeo && o.geometry !== planeGeo) o.geometry.dispose();
        if (o.isInstancedMesh) o.dispose();
        if (signs.indexOf(o) >= 0 && !o.userData.keep) o.material.dispose();
      });
      S.group = null;
    }
    S.acts.forEach(function (id) { FC.interact.remove(id); });
    S.acts = [];
    if (S.seated.length || S.npcs.length) freePeople();
    box = []; cyl = []; glow = []; signs = []; S.lights = []; S.colliders = [];
  }
  function label() {
    var B = S.building; if (!B) return "";
    var f = S.floor;
    if (f >= B.floors) return "Крыша · " + B.name;
    return (f < 0 ? "Подвал" : (f + 1) + " эт.") + " · " + (S.info && S.info.title ? S.info.title : B.name);
  }

  /* ---- столкновения и камера внутри ------------------------------------------------------------------- */
  function collide(wx, wz, r) {
    var p = toL(wx, wz), x = p.x, z = p.z, hit = false;
    for (var pass = 0; pass < 2; pass++) {
      for (var i = 0; i < S.colliders.length; i++) {
        var c = S.colliders[i];
        if (c[4] === "low" && FC.player && FC.player.y - S.y0 > 0.8) continue;
        var qx = FC.clamp(x, c[0], c[1]), qz = FC.clamp(z, c[2], c[3]);
        var ex = x - qx, ez = z - qz, e = Math.hypot(ex, ez);
        if (e < r) {
          hit = true;
          if (e < 1e-4) {
            var cx = (c[0] + c[1]) / 2, cz = (c[2] + c[3]) / 2, px = (c[1] - c[0]) / 2 - Math.abs(x - cx), pz = (c[3] - c[2]) / 2 - Math.abs(z - cz);
            if (px < pz) x = cx + (Math.sign(x - cx) || 1) * ((c[1] - c[0]) / 2 + r); else z = cz + (Math.sign(z - cz) || 1) * ((c[3] - c[2]) / 2 + r);
          } else { x = qx + ex / e * r; z = qz + ez / e * r; }
        }
      }
    }
    var hw = S.W / 2 - r - 0.2, hd = S.D / 2 - r - 0.2;
    if (x < -hw) { x = -hw; hit = true; } if (x > hw) { x = hw; hit = true; }
    if (z < -hd) { z = -hd; hit = true; } if (z > hd) { z = hd; hit = true; }
    var w = toW(x, z);
    return { x: w.x, z: w.z, hit: hit };
  }
  function clampCam(fx, fy, fz, tx, ty, tz) {
    var p = toL(tx, tz), hw = S.W / 2 - 0.35, hd = S.D / 2 - 0.35;
    var x = FC.clamp(p.x, -hw, hw), z = FC.clamp(p.z, -hd, hd);
    var w = toW(x, z);
    var py = FC.player ? FC.player.y : S.y0, top = S.y0 + S.ceil - 0.35;
    var g = S.stair, onSt = g && p.x > g.x0 - 1.5 && p.x < g.x1 + 0.5 && p.z > g.z0 - 2 && p.z < g.z1 + 0.5;
    if (py - S.y0 > 0.8) top = Math.min(py + 2.2, S.y0 + (g ? g.FH + Math.min(1.8, S.ceil * 0.5) - 0.3 : py + 2.2));   // на лестнице — до крышки шахты
    if (onSt && ty > S.y0 + S.ceil - 0.35) {                   // выше потолка камера — только внутри шахты пролёта
      x = FC.clamp(x, g.x0 + 0.3, g.x1 - 0.3); z = FC.clamp(z, g.z0 + 0.3, g.z1 - 0.3); w = toW(x, z);
    }
    var y = FC.clamp(ty, Math.max(S.y0 + 0.7, py + 0.5), Math.max(top, py + 0.9));
    return { x: w.x, y: y, z: w.z };
  }

  /* ---- интерфейс: шторка, лифт, лестница, карточки ---------------------------------------------------- */
  FC.css([
    "#fi-veil{position:fixed;inset:0;background:#05070d;opacity:0;pointer-events:none;transition:opacity .28s;z-index:15}",
    "#fi-veil.on{opacity:1}",
    "#fi-panel{position:fixed;left:50%;top:50%;transform:translate(-50%,-46%);width:min(420px,92vw);max-height:78vh;overflow:auto;background:rgba(14,18,36,.96);border:1px solid rgba(255,207,122,.35);border-radius:20px;padding:16px;z-index:12;opacity:0;pointer-events:none;transition:.2s;color:#f6efe2}",
    "#fi-panel.on{opacity:1;transform:translate(-50%,-50%);pointer-events:auto}",
    "#fi-panel h3{margin:0 0 4px;font:700 20px Georgia,serif;color:#fff}#fi-panel small{color:#ffcf7a;letter-spacing:.08em;text-transform:uppercase;font-size:11px}",
    "#fi-panel p{margin:4px 0 10px;color:rgba(255,245,230,.8);font-size:14px}",
    ".fi-floors{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-top:8px}",
    ".fi-floors button{min-width:0;overflow:hidden;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#fff;border-radius:12px;padding:8px 4px;cursor:pointer;font:700 15px system-ui;line-height:1.1}",
    ".fi-floors button i{display:block;font:500 9.5px system-ui;color:rgba(255,240,215,.65);font-style:normal;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".fi-floors button.cur{background:linear-gradient(90deg,#ffcf7a,#ff9b4a);color:#2a1205;border:0}.fi-floors button.cur i{color:#5a3010}",
    ".fi-floors button.ag{border-color:rgba(125,255,176,.6)}.fi-floors button.ag i{color:#9dffc6}",
    ".fi-btns{display:flex;flex-direction:column;gap:8px;margin-top:12px}",
    ".fi-btns button{border:0;border-radius:14px;padding:12px;font:700 15px system-ui;cursor:pointer;background:rgba(255,255,255,.1);color:#fff}",
    ".fi-btns button:first-child{background:linear-gradient(90deg,#ffcf7a,#ff9b4a);color:#2a1205}",
    ".fi-x{position:absolute;right:10px;top:6px;background:none;border:0;color:rgba(255,255,255,.6);font-size:24px;cursor:pointer}",
    ".fi-ag{display:flex;gap:12px;align-items:center}.fi-ava{width:74px;height:74px;flex:none;display:block;border-radius:14px;background-color:rgba(255,255,255,.06)}",
    ".fi-egg{display:grid;place-items:center;font-size:40px}.fi-doing{font-weight:600;color:#9dffc6!important}.fi-q{font-size:13px!important}",
    ".fi-feed{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}",
    ".fi-feed li{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.06);border-radius:12px;padding:6px 8px;font-size:13px}",
    ".fi-feed li .fi-ava{width:34px;height:34px;border-radius:8px}.fi-feed li b{color:#fff}.fi-feed li span{color:rgba(255,245,230,.7)}",
    ".fi-feed li button{margin-left:auto;border:0;border-radius:9px;padding:4px 8px;background:#ffcf7a;color:#2a1205;font-weight:700;cursor:pointer}"
  ].join("\n"));
  var veilEl = document.createElement("div"); veilEl.id = "fi-veil"; document.body.appendChild(veilEl);
  var panel = document.createElement("div"); panel.id = "fi-panel"; document.body.appendChild(panel);
  function esc(s) { return FC.hud && FC.hud.esc ? FC.hud.esc(s) : String(s); }
  function veil(on, then, ms) {
    veilEl.classList.toggle("on", on);
    if (then) setTimeout(then, ms || 300);
  }
  var uiOpen = false;
  function openPanel(html) {
    panel.innerHTML = "<button type='button' class='fi-x'>✕</button>" + html;
    panel.classList.add("on"); uiOpen = true;
    FC.input.enable(false); FC.input.unlock();
    panel.querySelector(".fi-x").addEventListener("click", closeUI);
  }
  function closeUI() {
    if (!uiOpen) return;
    panel.classList.remove("on"); uiOpen = false; FC.input.enable(true);
  }
  global.addEventListener("keydown", function (e) { if (uiOpen && !e.repeat && (e.code === "Escape" || e.code === "KeyE" && !panel.querySelector(".fi-floors"))) { e.stopPropagation(); closeUI(); } });
  function card(html, buttons) {
    openPanel(html + "<div class='fi-btns'>" + (buttons || []).map(function (b, i) { return "<button type='button' data-i='" + i + "'>" + esc(b[0]) + "</button>"; }).join("") + "</div>");
    panel.querySelectorAll(".fi-btns button").forEach(function (b) {
      b.addEventListener("click", function () { var fn = buttons[+b.dataset.i][1]; closeUI(); if (fn) fn(); });
    });
  }
  function floorTitle(B, f) {
    var inf = floorInfo(B, f);
    if (inf.role === "team") return inf.tenant[0];            // в штабе — просто имя команды: «Монтаж»
    return inf.role === "apartments" ? "квартиры" : inf.role === "lobby" || inf.role === "lobbyres" || inf.role === "lobbyhq" ? "лобби" : inf.title || "";
  }
  function openElevator() {
    var B = S.building, list = floorList(B);
    openPanel("<small>лифт</small><h3>" + esc(B.name) + "</h3><p>Выбери этаж</p><div class='fi-floors'>" + list.map(function (f) {
      var cnt = FC.life && FC.life.floorCount ? FC.life.floorCount(B, f) : 0;
      return "<button type='button' data-f='" + f + "' class='" + (f === S.floor ? "cur" : "") + (cnt ? " ag" : "") + "'>" + (f < 0 ? "−1" : f + 1) + "<i>" + (cnt ? "👥" + cnt + " " : "") + esc(floorTitle(B, f)) + "</i></button>";
    }).join("") + "</div>");
    panel.querySelectorAll(".fi-floors button").forEach(function (b) {
      b.addEventListener("click", function () { var f = +b.dataset.f; closeUI(); if (f !== S.floor) go(f); });
    });
  }
  function openStairs() {
    var B = S.building, lo = minFloor(B), hi = B.floors - 1 + (hasRoof(B) ? 1 : 0), opts = [];
    if (S.floor < hi) opts.push([S.floor + 1 >= B.floors ? "Подняться на крышу" : "Подняться на " + (S.floor + 2) + " этаж", function () { S.goStairs = true; go(S.floor + 1); }]);
    if (S.floor > lo) opts.push([S.floor - 1 < 0 ? "Спуститься в подвал" : "Спуститься на " + S.floor + " этаж", function () { S.goStairs = true; go(S.floor - 1); }]);
    opts.push(["Остаться", null]);
    card("<small>лестница</small><h3>" + esc(label()) + "</h3>", opts);
  }
  function capabilityStand(B) {
    var n = FC.people.insideOf ? FC.people.insideOf(B).length : 0;
    var z = FC.net && FC.net.zones && FC.net.zones[B.zone];
    card("<small>что здесь делают</small><h3>" + esc((B.emoji || "") + " " + B.name) + "</h3><p>" + esc(B.sub || "") + "</p><p>Сейчас здесь работают: <b>" + n + "</b>" +
      (z ? " · за сутки заходили " + z.people : "") + "</p><p class='fi-q'>Здесь работают агенты города. Сядь за свободный стол — смена с мини-игрой и оплатой.</p>",
    [["Поработать здесь", function () { work(B, S.floor, { x: 0, z: 0 }); }], ["Закрыть", null]]);
  }

  /* ---- кадр: свет рядом с игроком, растворение стен, разговоры ---------------------------------------- */
  var talkT = 0;
  FC.addSystem({
    name: "inside", order: 45,
    update: function (dt) {
      IU.uTime.value += dt;
      if (!S.active || !S.group) return;
      var P = FC.player, cam = G.camera;
      // ходьба по лестнице: дошёл до верха марша — следующий этаж; шагнул в проём — этаж ниже
      S.stairCool = Math.max(0, (S.stairCool || 0) - dt);
      if (S.stair && !S.busy && !S.stairCool && P.mode === "foot") {
        var sl = toL(P.x, P.z), st = stairLocal(sl.x, sl.z, P.y - S.y0);
        if (st && st.act === "up") stairTo(S.floor + 1, sl, false);
        else if (st && st.act === "down") stairTo(S.floor - 1, sl, true);
      }
      IU.uCam.value.copy(cam.position);
      IU.uPly.value.set(P.x, (P.y || S.y0) + 1.0, P.z);
      // 8 ближайших к игроку светильников → пятна света
      var L = S.lights, n = 0;
      if (L.length) {
        var pl = toL(P.x, P.z);
        var sorted = L.map(function (l) { return [l, (l[0] - pl.x) * (l[0] - pl.x) + (l[2] - pl.z) * (l[2] - pl.z)]; }).sort(function (a, b) { return a[1] - b[1]; });
        for (var i = 0; i < Math.min(8, sorted.length); i++) { var w = toW(sorted[i][0][0], sorted[i][0][2]); lightArr[i].set(w.x, S.y0 + sorted[i][0][1], w.z); n++; }
      }
      IU.uLN.value = n;
      // разговоры: живые агенты — что делают; сотрудники — свои реплики
      talkT -= dt;
      if (talkT <= 0) {
        talkT = 2.4 + Math.random() * 2;
        var near = S.seated.concat(S.npcs).filter(function (c) { return !c.cluster && !c.mute && FC.dist2(c.x, c.z, P.x, P.z) < 14 * 14; });
        if (near.length) {
          // чаще говорят настоящие агенты — их дело и есть смысл здания
          var reals = near.filter(function (q) { return q.realAgent; });
          var c = reals.length && Math.random() < 0.6 ? reals[Math.floor(Math.random() * reals.length)] : near[Math.floor(Math.random() * near.length)];
          if (c.realAgent) FC.people.say(c, FC.people.line(c), 3.5, "busy");
          else if (c.line && c.line.length) FC.people.say(c, c.line[Math.floor(Math.random() * c.line.length)], 3, c.title === "cop" ? "cop" : "");
        }
      }
    }
  });
  // живые агенты обновились (раз в 30 с): если игрок в здании-зоне — пересадить
  FC.on("citizens", function () {
    if (FC.life) return;                                    // приход и уход агентов ведёт flife.js — без пересборки этажа
    if (!S.active || !S.building || !S.building.zone || S.busy) return;
    var now = FC.people.insideOf(S.building).length;
    if (now !== S.seated.length) { var p = FC.player, pl = { x: p.x, z: p.z, h: p.heading }; build(S.building, S.floor); p.x = pl.x; p.z = pl.z; p.heading = pl.h; }
  });

  FC.inside = {
    active: false, building: null, floor: 0,
    enter: enter, exit: exit, go: go, label: label,
    floorY: function () {
      if (!S.active || !S.stair || !FC.player) return S.y0;
      var P = FC.player, l = toL(P.x, P.z), st = stairLocal(l.x, l.z, (P.y || S.y0) - S.y0);
      return S.y0 + (st ? st.h : 0);
    },
    stairs: function () { return S.stair; }, stairLocal: stairLocal, hasRoof: hasRoof, _seat: seat, _spawn: spawnNpc,
    collide: collide, clampCam: clampCam,
    get spots() { return S.spots; },
    // для наборов мебели и сюжета
    capabilityStand: capabilityStand, card: card, toWorld: toW, toLocal: toL,
    floorInfo: floorInfo, LINES: LINES,
    debug: function () { return S; }
  };
})(window);
