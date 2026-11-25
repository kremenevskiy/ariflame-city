/* Флейм-Сити — план города. Только данные и геометрия, без three.js: дороги, полосы, перекрёстки, кварталы, здания,
 * зоны мира агентов, дома жителей, точки (участок, больница, перекраска…), вода, столкновения, маршруты.
 *
 * Масштаб человека: 1 ед. = 1 м, карта ±1200 м. Север — к -z (вверху карты), восток — +x.
 * Районы: Москва на северо-западе, Алматы на северо-востоке, Минск на юге, Центр с огоньком и Башней Флейм посередине.
 * Здания-зоны — из data/zones.js (FC_ZONES): новая строка там сама получает здание здесь.
 *
 * Сетка улиц — сквозная по обеим осям с разным шагом; квартал между двумя улицами. Полосы — правостороннее движение.
 */
(function (global) {
  "use strict";
  if (global.FC_CITY === "minsk" && global.MINSK) return;   // Минск 1:1 — план даёт fmapx.js
  var FC = global.FC;
  var R = FC.rng(20261122);
  var EDGE = 1200, HALF = 1100;                      // край мира и периметр-шоссе
  var LANE = 3.5, WALK = 4.5;                        // ширина полосы и тротуара

  /* ---- районы ------------------------------------------------------------------------------------------- */
  function polar(r, a) { return { x: r * Math.cos(a * Math.PI / 180), z: r * Math.sin(a * Math.PI / 180) }; }
  var DISTRICTS = [
    { key: "center", name: "Центр", x: 0, z: 0, color: "#ffcf7a" },
    { key: "msk", name: "Москва", a: 225, color: "#ff6b6b" },
    { key: "ala", name: "Алматы", a: 335, color: "#6bd5ff" },
    { key: "minsk", name: "Минск", a: 100, color: "#9dff8a" }
  ];
  var DIST = {};
  DISTRICTS.forEach(function (d) {
    if (d.a != null) { var p = polar(680, d.a); d.x = p.x; d.z = p.z; }
    DIST[d.key] = d;
  });
  var CENTER_R = 260;
  function district(x, z) {
    if (x * x + z * z < CENTER_R * CENTER_R) return DIST.center;
    var best = null, bd = 1e18;
    for (var i = 1; i < DISTRICTS.length; i++) {
      var d = DISTRICTS[i], q = FC.dist2(x, z, d.x, d.z);
      if (q < bd) { bd = q; best = d; }
    }
    return best;
  }

  /* ---- имена улиц: у каждой линии сетки своё, по району, где она проходит больше всего ------------------ */
  var STREETS = {
    center: ["Огненный проспект", "Бульвар Искр", "Площадь Огонька", "Агентская улица", "Проспект Ариф"],
    msk: ["Тверская", "Арбат", "Пресненская наб.", "Садовая", "Большая Ордынка", "Мясницкая", "Петровка", "Покровка",
      "Остоженка", "Сретенка", "Маросейка", "Неглинная", "Кутузовский пр.", "Ленинградский пр.", "Профсоюзная"],
    minsk: ["пр. Независимости", "Немига", "Притыцкого", "Сурганова", "Карла Маркса", "Кальварийская", "Победителей",
      "Якуба Коласа", "Богдановича", "Козлова", "Захарова", "Плеханова"],
    ala: ["Абая", "Достык", "Аль-Фараби", "Толе би", "Сатпаева", "Фурманова", "Жибек Жолы", "Розыбакиева",
      "Желтоксан", "Гоголя", "Байзакова", "Наурызбай батыра"]
  };

  /* ---- сетка улиц ------------------------------------------------------------------------------------------ */
  function lines() {
    var out = [-HALF], v = -HALF;
    while (true) {
      v += R.int(9, 13) * 10;
      if (v > HALF - 70) break;
      out.push(v);
    }
    out.push(HALF);
    return out;
  }
  var XS = lines(), ZS = lines();
  // Ширина: периметр — шоссе, каждая третья и ближайшие к центру — проспекты, остальное — улицы.
  function widthOf(list, i) {
    if (i === 0 || i === list.length - 1) return { w: 24, lanes: 3, kind: "hw" };
    var nearCenter = Math.abs(list[i]) === Math.min.apply(null, list.map(function (v) { return Math.abs(v); }));
    if (nearCenter || i % 3 === 0) return { w: 18, lanes: 2, kind: "av" };
    return { w: 11, lanes: 1, kind: "st" };
  }
  var VROADS = XS.map(function (x, i) { var o = widthOf(XS, i); o.x = x; o.axis = "z"; o.i = i; return o; });
  var HROADS = ZS.map(function (z, i) { var o = widthOf(ZS, i); o.z = z; o.axis = "x"; o.i = i; return o; });
  function nameRoads(list, isV) {
    var used = {};
    list.forEach(function (r) {
      var mid = isV ? district(r.x, 0) : district(0, r.z);
      var pool = STREETS[mid.key], n = 0, name;
      do { name = pool[(FC.hash(mid.key + (isV ? "v" : "h") + r.i + n) % pool.length)]; n++; } while (used[name] && n < 30);
      used[name] = 1;
      if (r.kind === "hw") name = isV ? (r.i ? "Восточное шоссе" : "Западное шоссе") : (r.i ? "Южное шоссе" : "Северное шоссе");
      r.name = name;
    });
  }
  nameRoads(VROADS, true); nameRoads(HROADS, false);

  /* ---- река и вода ------------------------------------------------------------------------------------------ */
  // Москва-река: от западного края через Москву к Центру и на юг вдоль Минска — в залив. Ширина 46 м.
  var RIVER = [[-1250, -260], [-900, -330], [-620, -420], [-420, -300], [-330, -120], [-300, 80], [-360, 320],
    [-470, 520], [-480, 760], [-380, 980], [-300, 1250]];
  var RIVER_W = 46;
  var SEA_Z = 1150;                                  // за южным шоссе — море с пляжем
  var LAKE = { x: 220, z: 640, r: 90 };              // Комсомольское озеро в Минске
  function segD(px, pz, ax, az, bx, bz) {
    var dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz, t = l ? ((px - ax) * dx + (pz - az) * dz) / l : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var qx = ax + dx * t - px, qz = az + dz * t - pz;
    return Math.sqrt(qx * qx + qz * qz);
  }
  function riverD(x, z) {
    var best = 1e9;
    for (var i = 0; i < RIVER.length - 1; i++) {
      var d = segD(x, z, RIVER[i][0], RIVER[i][1], RIVER[i + 1][0], RIVER[i + 1][1]);
      if (d < best) best = d;
    }
    return best;
  }
  // Сырая вода (линия реки, круг озера) — только чтобы решить, какие кварталы станут водой. Игровая вода — water()
  // ниже: по кварталам, ровно как нарисовано (река каналами между кварталами, мосты — улицы над водой).
  function wetRaw(x, z) {
    if (z > SEA_Z + 40) return true;
    return field(x, z) < 0;
  }
  /* Поле берега: < 0 — вода реки или озера, > 0 — расстояние до кромки (м). По нему же строится набережная. */
  function field(x, z) {
    return Math.min(riverD(x, z) - RIVER_W / 2, Math.hypot(x - LAKE.x, z - LAKE.z) - LAKE.r);
  }

  /* ---- узлы и рёбра дорог -------------------------------------------------------------------------------- */
  var NODES = [], EDGES = [], NODE_AT = {};
  XS.forEach(function (x, ix) {
    ZS.forEach(function (z, iz) {
      var n = { i: NODES.length, x: x, z: z, ix: ix, iz: iz, edges: [], vr: VROADS[ix], hr: HROADS[iz] };
      NODE_AT[ix + "," + iz] = n.i; NODES.push(n);
    });
  });
  function addEdge(a, b, road) {
    var A = NODES[a], B = NODES[b], len = Math.hypot(B.x - A.x, B.z - A.z);
    var midX = (A.x + B.x) / 2, midZ = (A.z + B.z) / 2;
    var e = { i: EDGES.length, a: a, b: b, axis: road.axis, w: road.w, lanes: road.lanes, kind: road.kind, len: len,
      road: road, mx: midX, mz: midZ, bridge: false };
    EDGES.push(e); A.edges.push(e.i); B.edges.push(e.i);
  }
  XS.forEach(function (x, ix) {
    for (var iz = 0; iz < ZS.length - 1; iz++) addEdge(NODE_AT[ix + "," + iz], NODE_AT[ix + "," + (iz + 1)], VROADS[ix]);
  });
  ZS.forEach(function (z, iz) {
    for (var ix = 0; ix < XS.length - 1; ix++) addEdge(NODE_AT[ix + "," + iz], NODE_AT[(ix + 1) + "," + iz], HROADS[iz]);
  });
  // Светофор — на перекрёстке, где сходятся не только улицы (на тихих — без него, как в жизни).
  NODES.forEach(function (n) {
    n.signal = n.edges.length >= 3 && (n.vr.kind !== "st" || n.hr.kind !== "st") && !wetRaw(n.x, n.z);
    n.phase = (n.ix + n.iz) % 2;
  });
  function other(e, n) { return e.a === n ? e.b : e.a; }

  /* Полоса: ехать по ребру e от узла from, полоса k (0 — у осевой). Точка на доле t пути и направление. */
  function lanePoint(e, from, k, t) {
    var A = NODES[from], B = NODES[other(e, from)];
    var dx = (B.x - A.x) / e.len, dz = (B.z - A.z) / e.len;
    var off = (e.kind === "av" ? 0.6 : e.kind === "hw" ? 1.2 : 0) + LANE * (k + 0.5);
    // вправо от направления: (-dz, dx)
    var sx = A.x + (B.x - A.x) * t - dz * off, sz = A.z + (B.z - A.z) * t + dx * off;
    return { x: sx, z: sz, dx: dx, dz: dz };
  }

  /* ---- кварталы ---------------------------------------------------------------------------------------------- */
  var BLOCKS = [];
  for (var bx = 0; bx < XS.length - 1; bx++) {
    for (var bz = 0; bz < ZS.length - 1; bz++) {
      var x0 = XS[bx] + VROADS[bx].w / 2, x1 = XS[bx + 1] - VROADS[bx + 1].w / 2;
      var z0 = ZS[bz] + HROADS[bz].w / 2, z1 = ZS[bz + 1] - HROADS[bz + 1].w / 2;
      var cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      var b = { i: BLOCKS.length, ix: bx, iz: bz, x0: x0, x1: x1, z0: z0, z1: z1, cx: cx, cz: cz,
        dist: district(cx, cz), kind: "city" };
      // река и озеро режут квартал: весь в воде — «water», задет — «shore» (набережная без домов, край воды — по кривой)
      var wc = 0, n = 0;
      for (var sx = 0; sx <= 6; sx++) for (var sz = 0; sz <= 6; sz++) {
        n++; if (field(x0 - 3 + (x1 - x0 + 6) * sx / 6, z0 - 3 + (z1 - z0 + 6) * sz / 6) < 0) wc++;
      }
      if (wc === n) b.kind = "water";
      else if (wc > 0) b.kind = "shore";
      BLOCKS.push(b);
    }
  }
  function blockAt(x, z) {
    // бинарный поиск по линиям сетки
    // последняя линия сетки не правее точки (бинарный поиск)
    function idx(list, v) {
      if (v < list[0]) return -1;
      var lo = 0, hi = list.length - 1;
      while (lo < hi) { var m = (lo + hi + 1) >> 1; if (list[m] <= v) lo = m; else hi = m - 1; }
      return lo;
    }
    var ix = idx(XS, x), iz = idx(ZS, z);
    if (ix < 0 || iz < 0 || ix >= XS.length - 1 || iz >= ZS.length - 1) return null;
    return BLOCKS[ix * (ZS.length - 1) + iz];
  }

  // Площадь Огонька — квартал в самом центре; рядом — Башня Флейм.
  var plaza = blockAt(0, 0);
  plaza.kind = "plaza";
  // парки: в Минске чаще; у берега — набережные
  BLOCKS.forEach(function (b) {
    if (b.kind !== "city") return;
    var p = b.dist.key === "minsk" ? 0.16 : b.dist.key === "center" ? 0.08 : 0.07;
    if (FC.hash("park" + b.i) % 1000 < p * 1000) b.kind = "park";
  });

  /* Игровая вода: квартал-вода (не дорога над ним), за пляжем — море. Мост — ребро, у которого с любой стороны вода. */
  var BEACH_Z0 = HALF + 12, SEA_LINE = SEA_Z + 40;
  function water(x, z) {
    if (z > SEA_LINE) return true;
    return field(x, z) < 0;
  }
  // Мост — участок улицы над водой: пролёт [s0, s1] в метрах от узла a (с запасом 4 м на устои).
  EDGES.forEach(function (e) {
    var A = NODES[e.a], B = NODES[e.b], s0 = -1, s1 = -1;
    for (var s = 0; s <= e.len; s += 2) {
      var t = s / e.len, x = A.x + (B.x - A.x) * t, z = A.z + (B.z - A.z) * t;
      var hw = e.w / 2, wet = e.axis === "z" ? Math.min(field(x - hw, z), field(x + hw, z), field(x, z)) : Math.min(field(x, z - hw), field(x, z + hw), field(x, z));
      if (wet < 2) { if (s0 < 0) s0 = s; s1 = s; }
    }
    e.bridge = s0 >= 0;
    if (e.bridge) e.span = [Math.max(0, s0 - 4), Math.min(e.len, s1 + 4)];
  });

  /* ---- здания ------------------------------------------------------------------------------------------------ */
  var STYLE = { glass: 0, panel: 1, brick: 2, stalin: 3, modern: 4, studio: 5, house: 6 };
  var BUILDINGS = [];
  var OFFICE_NAMES = ["Нева", "Альфа", "Меридиан", "Орбита", "Квант", "Пульс", "Вектор", "Галактика", "Север", "Лотос",
    "Олимп", "Сфера", "Атлант", "Гранит", "Эверест", "Купол", "Призма", "Восход", "Сигма", "Кристалл"];

  function heightFor(b, dAnchor, r) {
    var k = b.dist.key;
    if (k === "center") return dAnchor < 120 ? r.range(60, 140) : r.range(28, 80);
    if (k === "msk") return dAnchor < 170 ? r.range(90, 230) : dAnchor < 380 ? r.range(24, 70) : r.range(30, 52);
    if (k === "minsk") return dAnchor < 220 ? r.range(18, 44) : r.range(25, 48);
    return dAnchor < 200 ? r.range(14, 42) : r.range(7, 26);   // Алматы — низкий, с горами за краем
  }
  function styleFor(b, h, dAnchor, r) {
    var k = b.dist.key;
    if (h > 70) return "glass";
    if (k === "msk") return dAnchor < 380 ? r.pick(["modern", "stalin", "brick", "glass"]) : r.pick(["panel", "panel", "brick"]);
    if (k === "minsk") return dAnchor < 220 ? r.pick(["stalin", "stalin", "modern"]) : r.pick(["panel", "panel", "modern"]);
    if (k === "ala") return h < 12 ? r.pick(["house", "brick", "studio"]) : r.pick(["modern", "brick", "panel", "glass"]);
    return r.pick(["glass", "modern", "modern", "stalin"]);
  }

  function addBuilding(b, x0, x1, z0, z1, front, r) {
    var w = x1 - x0, d = z1 - z0;
    if (w < 9 || d < 9) return null;
    // у реки — только на сухом, с набережной не меньше 9 м
    if (b.kind === "shore" && Math.min(field(x0, z0), field(x1, z0), field(x0, z1), field(x1, z1), field((x0 + x1) / 2, (z0 + z1) / 2)) < 9) return null;
    var cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    var anc = b.dist, dA = Math.hypot(cx - anc.x, cz - anc.z);
    var h = heightFor(b, dA, r);
    if (w * d < 300) h = Math.min(h, 30);
    var style = styleFor(b, h, dA, r);
    if (style === "house") h = Math.min(h, 10);
    var floors = Math.max(1, Math.round(h / 3.5));
    h = floors * 3.5;
    var B = { id: BUILDINGS.length, block: b.i, x: cx, z: cz, w: w, d: d, h: h, floors: floors, style: style,
      styleI: STYLE[style], dist: b.dist.key, type: style === "panel" || style === "house" ? "res" : r.chance(0.55) ? "office" : "res",
      front: front, shop: false, zone: null, poi: null, home: null, name: "", tint: r.range(0.82, 1.08), seed: r.int(1, 1e9) };
    B.shop = B.type !== "res" && h < 90 && style !== "studio" && r.chance(0.55);
    if (style === "studio") B.type = "office";
    BUILDINGS.push(B);
    return B;
  }

  // Квартал режем на участки вдоль длинной стороны; глубокий — в два ряда (лицом на разные улицы).
  BLOCKS.forEach(function (b) {
    if (b.kind !== "city" && b.kind !== "shore") return;
    var r = FC.rng(FC.hash("blk" + b.i));
    var ix0 = b.x0 + WALK, ix1 = b.x1 - WALK, iz0 = b.z0 + WALK, iz1 = b.z1 - WALK;
    var W = ix1 - ix0, D = iz1 - iz0;
    var alongX = W >= D;
    var long = alongX ? W : D, short = alongX ? D : W;
    var rows = short > 62 ? 2 : 1;
    var set = 1.5;
    for (var row = 0; row < rows; row++) {
      var pos = 0;
      while (pos < long - 9) {
        var lw = Math.min(long - pos, r.range(18, b.dist.key === "msk" ? 46 : 36));
        if (long - pos - lw < 12) lw = long - pos;
        var a0 = pos + set, a1 = pos + lw - set;
        var s0, s1, front;
        if (rows === 1) { s0 = set; s1 = short - set; front = 0; }
        else if (row === 0) { s0 = set; s1 = short / 2 - set; front = 0; }
        else { s0 = short / 2 + set; s1 = short - set; front = 1; }
        // front: 0 — лицом на «меньшую» улицу (север/запад), 1 — на «большую» (юг/восток)
        if (alongX) addBuilding(b, ix0 + a0, ix0 + a1, iz0 + s0, iz0 + s1, front ? "s" : "n", r);
        else addBuilding(b, ix0 + s0, ix0 + s1, iz0 + a0, iz0 + a1, front ? "e" : "w", r);
        pos += lw;
      }
    }
  });

  // Двери: посередине лицевой стороны; у больших — вторая на противоположной (второй выход — уйти от копов).
  function doorsOf(B) {
    var out = [], hw = B.w / 2, hd = B.d / 2, o = 0.9;
    function door(side) {
      if (side === "n") out.push({ x: B.x, z: B.z - hd - o, nx: 0, nz: -1, side: side });
      if (side === "s") out.push({ x: B.x, z: B.z + hd + o, nx: 0, nz: 1, side: side });
      if (side === "w") out.push({ x: B.x - hw - o, z: B.z, nx: -1, nz: 0, side: side });
      if (side === "e") out.push({ x: B.x + hw + o, z: B.z, nx: 1, nz: 0, side: side });
    }
    door(B.front);
    var opp = { n: "s", s: "n", w: "e", e: "w" }[B.front];
    if (B.w * B.d > 900 || B.zone || B.poi) door(opp);
    return out;
  }

  /* ---- здания-зоны (data/zones.js) ---------------------------------------------------------------------------- */
  var ZONES = global.FC_ZONES || [];
  var KIND_EMOJI = { mail: "📧", gallery: "📸", chat: "✈️", web: "🌐", notes: "📝", deck: "📊", office: "🗂️",
    stalin: "🗄️", diamond: "📚", beacon: "🛰️", forge: "🛠️", shoot: "🎥", cut: "🎬", reels: "📱", queue: "⏳", wheel: "🎡" };
  var KIND_COLOR = { mail: "#4285f4", gallery: "#e1306c", chat: "#2aabee", web: "#7c5cff", notes: "#e9e9e9",
    deck: "#ff9f1c", office: "#c9a14a", stalin: "#b59b74", diamond: "#5bc0eb", beacon: "#ff4a4a", forge: "#ff7a2f",
    shoot: "#ffcf3f", cut: "#ff5d8f", reels: "#a77bff", queue: "#41e0c8", wheel: "#ffd166" };
  var ZONE_B = {};
  function freeLots(distKey, ax, az) {
    return BUILDINGS.filter(function (B) { return B.dist === distKey && !B.zone && !B.poi && B.w >= 16 && B.d >= 16; })
      .sort(function (p, q) { return FC.dist2(p.x, p.z, ax, az) - FC.dist2(q.x, q.z, ax, az); });
  }
  ZONES.forEach(function (z, zi) {
    if (!z.city || !DIST[z.city]) return;
    var d = DIST[z.city];
    // кольцо вокруг якоря района: зоны идут по спирали, чтобы не слипались в одну кучу
    var p = polar(90 + (zi % 5) * 30, zi * 47 % 360);
    var list = freeLots(z.city, d.x + p.x, d.z + p.z);
    var B = list[0];
    if (!B) return;
    var sh = z.shop || {};
    B.zone = z.key; B.type = "zone"; B.name = z.name; B.sub = z.sub || "";
    B.emoji = sh.emoji || KIND_EMOJI[z.kind] || "🏢";
    B.color = sh.color || KIND_COLOR[z.kind] || "#ffcf7a";
    B.title = sh.title || z.name.toUpperCase();
    if (z.kind === "shoot" || z.kind === "cut" || z.kind === "reels") { B.style = "studio"; B.styleI = STYLE.studio; B.floors = Math.min(B.floors, 3); B.h = B.floors * 4.5; }
    else if (sh.h) { B.floors = Math.max(2, Math.round(sh.h / 3.5)); B.h = B.floors * 3.5; }
    B.shop = false;
    ZONE_B[z.key] = B;
  });

  /* ---- точки: участки, больницы, перекраска, магазины, бизнесы ----------------------------------------------- */
  var POI_DEF = [
    { poi: "police", name: "Пост патруля «Щит»", emoji: "🚓", color: "#2f6fd6", per: ["msk", "minsk", "ala", "center"] },
    { poi: "hospital", name: "Больница", emoji: "🏥", color: "#ff4d6d", per: ["msk", "minsk", "ala"] },
    { poi: "paint", name: "Перекраска", emoji: "🎨", color: "#ffb02e", per: ["msk", "minsk", "ala"] },
    { poi: "store", name: "Магазин 24/7", emoji: "🛒", color: "#41e08c", per: ["msk", "msk", "minsk", "minsk", "ala", "ala", "center"] },
    { poi: "gas", name: "Заправка", emoji: "⛽", color: "#ffd23f", per: ["msk", "minsk", "ala"] },
    { poi: "cars", name: "Автосалон «Искра Моторс»", emoji: "🏎️", color: "#ff7a2f", per: ["msk"] },
    { poi: "club", name: "Клуб «Неон»", emoji: "🪩", color: "#c86bff", per: ["ala"] },
    { poi: "gym", name: "Спортзал «Железо»", emoji: "🏋️", color: "#9aa5b1", per: ["minsk"] },
    { poi: "hotel", name: "Отель «Флейм»", emoji: "🏨", color: "#e9c46a", per: ["msk"] },
    { poi: "bank", name: "Флейм-Банк", emoji: "💰", color: "#2fbf71", per: ["center"] },
    { poi: "biz", id: "shawarma", name: "Шаурма «У Огонька»", emoji: "🌯", color: "#ff9f1c", per: ["msk"], price: 4000, income: 160 },
    { poi: "biz", id: "carwash", name: "Автомойка «Пена»", emoji: "🧽", color: "#4cc9f0", per: ["minsk"], price: 7000, income: 260 },
    { poi: "biz", id: "flowers", name: "Цветы «Букет»", emoji: "💐", color: "#ff70a6", per: ["ala"], price: 5500, income: 210 },
    { poi: "biz", id: "barber", name: "Барбершоп «Бритва»", emoji: "💈", color: "#e63946", per: ["msk"], price: 9000, income: 330 },
    { poi: "biz", id: "coffee", name: "Кофейня «Пенка»", emoji: "☕", color: "#a0522d", per: ["center"], price: 12000, income: 430 },
    { poi: "biz", id: "studio", name: "Студия звука «Эхо»", emoji: "🎧", color: "#7c5cff", per: ["minsk"], price: 18000, income: 640 },
    { poi: "biz", id: "taxi", name: "Такси-парк «Шашки»", emoji: "🚕", color: "#ffd23f", per: ["ala"], price: 30000, income: 1050 },
    { poi: "biz", id: "nightclub", name: "Ночной клуб «Искра»", emoji: "🔥", color: "#ff006e", per: ["msk"], price: 60000, income: 2200 },
    // 22.11 (v2): мультяшное оружие, аптечки, броня — только нежилые дома, чтобы дома жителей не сдвигались
    { poi: "guns", name: "Оружейная «Искромёт»", emoji: "🎯", color: "#e63946", per: ["msk", "minsk", "ala"], noRes: true }
  ];
  var POIS = [];
  POI_DEF.forEach(function (p, pi) {
    p.per.forEach(function (dk, k) {
      var d = DIST[dk], q = polar(150 + ((pi * 37 + k * 71) % 220), (pi * 83 + k * 131) % 360);
      var cand = BUILDINGS.filter(function (B) { return B.dist === dk && !B.zone && !B.poi && B.h < 60 && B.w >= 12 && B.d >= 12 && !(p.noRes && B.type === "res"); })
        .sort(function (a, b) { return FC.dist2(a.x, a.z, d.x + q.x, d.z + q.z) - FC.dist2(b.x, b.z, d.x + q.x, d.z + q.z); });
      var B = cand[0]; if (!B) return;
      B.poi = p.poi; B.type = p.poi; B.name = p.name; B.emoji = p.emoji; B.color = p.color; B.title = p.name.toUpperCase();
      if (p.poi === "biz") { B.biz = { id: p.id, price: p.price, income: p.income }; B.title = p.name.replace(/«|»/g, "").toUpperCase(); }
      B.shop = false;
      if (B.floors > 6 && p.poi !== "hotel" && p.poi !== "hospital") { B.floors = Math.max(2, Math.min(B.floors, 4)); B.h = B.floors * 3.5; }
      POIS.push(B);
    });
  });

  // Башня Флейм — штаб сюжета: самый близкий к площади участок, 64 этажа.
  var HQ = BUILDINGS.filter(function (B) { return !B.zone && !B.poi && B.dist === "center" && B.w > 16 && B.d > 16; })
    .sort(function (a, b) { return (a.x * a.x + a.z * a.z) - (b.x * b.x + b.z * b.z); })[0];
  if (HQ) {
    HQ.type = "hq"; HQ.style = "glass"; HQ.styleI = STYLE.glass; HQ.floors = 64; HQ.h = 64 * 3.5; HQ.name = "Башня Флейм";
    HQ.emoji = "🔥"; HQ.color = "#ff8a3d"; HQ.title = "FLAME"; HQ.shop = false; HQ.poi = "hq";
  }

  /* ---- дома жителей: жилые дома каждого района по кругу -------------------------------------------------------- */
  var HOMES = BUILDINGS.filter(function (B) { return B.type === "res" && !B.poi && !B.zone && B.dist !== "center"; })
    .sort(function (a, b) { return FC.hash("home" + a.id) - FC.hash("home" + b.id); });
  HOMES.forEach(function (B, i) { B.home = i; });

  // имена и адреса
  BUILDINGS.forEach(function (B) {
    var road = (B.front === "n" || B.front === "s") ? HROADS[BLOCKS[B.block].iz + (B.front === "s" ? 1 : 0)] :
      VROADS[BLOCKS[B.block].ix + (B.front === "e" ? 1 : 0)];
    B.street = road ? road.name : "";
    B.num = 1 + (FC.hash("num" + B.id) % 120);
    if (!B.name) {
      if (B.type === "office") B.name = (B.style === "studio" ? "Студия «" : "БЦ «") + OFFICE_NAMES[B.seed % OFFICE_NAMES.length] + "»";
      else B.name = "Жилой дом";
    }
    B.addr = B.street + ", " + B.num;
    B.doors = doorsOf(B);
  });

  /* ---- столкновения: сетка 40 м со списками зданий ------------------------------------------------------------- */
  var CELL = 40, GRID = {};
  function cellKey(cx, cz) { return cx + "," + cz; }
  function gridAdd(item, x0, x1, z0, z1) {
    for (var gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++) {
      for (var gz = Math.floor(z0 / CELL); gz <= Math.floor(z1 / CELL); gz++) {
        (GRID[cellKey(gx, gz)] || (GRID[cellKey(gx, gz)] = [])).push(item);
      }
    }
  }
  BUILDINGS.forEach(function (B) { gridAdd(B, B.x - B.w / 2, B.x + B.w / 2, B.z - B.d / 2, B.z + B.d / 2); });
  var PROPS = [];                                    // столбы и деревья — круги (их ставит fbuild через addProp)
  function addProp(x, z, r, kind) {
    var p = { prop: true, x: x, z: z, r: r, kind: kind };
    PROPS.push(p); gridAdd(p, x - r, x + r, z - r, z + r);
    return p;
  }
  function near(x, z, r) {
    var out = [], seen = new Set();
    for (var gx = Math.floor((x - r) / CELL); gx <= Math.floor((x + r) / CELL); gx++) {
      for (var gz = Math.floor((z - r) / CELL); gz <= Math.floor((z + r) / CELL); gz++) {
        var l = GRID[cellKey(gx, gz)]; if (!l) continue;
        for (var i = 0; i < l.length; i++) if (!seen.has(l[i])) { seen.add(l[i]); out.push(l[i]); }
      }
    }
    return out;
  }
  /* Крыши (ходьба по ним — fmain): башня ступенями (fbuild: стекло выше 90 м, обе стороны шире 22 м) — подиум до 0,18 h,
     ствол с отступом 3 м до 0,8 h, верхушка с отступом 6 м; остальные — плоская крыша на h. */
  var STEP = 0.5;                                    // ступенька: стена ниже ног + STEP не держит (на крыше), выше — стена
  function setback(B) { return B.style === "glass" && B.h > 90 && B.w > 22 && B.d > 22; }
  function roofY(B, x, z) {
    if (!setback(B)) return B.h;
    var e = Math.min(B.w / 2 - Math.abs(x - B.x), B.d / 2 - Math.abs(z - B.z));
    return e < 3 ? B.h * 0.18 : e < 6 ? B.h * 0.8 : B.h;
  }
  // отступ стены, что ещё выше ног y (−1 — ниже ног: не стена)
  function wallInset(B, y) {
    if (y >= B.h - STEP) return -1;
    if (!setback(B)) return 0;
    return y < B.h * 0.18 - STEP ? 0 : y < B.h * 0.8 - STEP ? 3 : 6;
  }
  /* Крыша под точкой не выше yMax (−1e9 — нет). Без выделений памяти: 4 последние клетки сетки кэшируются (дома
     Флейм-Сити не меняются; столб, добавленный позже в пустую клетку, крыше не важен). */
  var rc = [{ gx: 1e9, gz: 0, l: null }, { gx: 1e9, gz: 0, l: null }, { gx: 1e9, gz: 0, l: null }, { gx: 1e9, gz: 0, l: null }], rcI = 0;
  function roofAt(x, z, yMax) {
    var gx = Math.floor(x / CELL), gz = Math.floor(z / CELL), best = -1e9, rList = null, i;
    for (i = 0; i < 4; i++) if (rc[i].gx === gx && rc[i].gz === gz) { rList = rc[i].l; break; }
    if (i === 4) { var n = rc[rcI]; rcI = (rcI + 1) & 3; n.gx = gx; n.gz = gz; rList = n.l = GRID[cellKey(gx, gz)] || null; }
    if (!rList) return best;
    for (i = 0; i < rList.length; i++) {
      var o = rList[i];
      if (o.prop || o.h <= best || Math.abs(x - o.x) > o.w / 2 || Math.abs(z - o.z) > o.d / 2) continue;
      var y = roofY(o, x, z);
      if (y <= yMax && y > best) best = y;
    }
    return best;
  }
  /* Круг (x, z, r) против зданий, столбов, воды и края: возвращает исправленную точку и признак удара.
     opt.y — высота ног пешехода: здание ниже ног (стоит на крыше) не стена, у башни ступенями — стена своего яруса;
     столбы и деревья выше 3 м не мешают. Без y — как раньше: каждое здание — стена на всю высоту. */
  function collide(x, z, r, opt) {
    var hit = false, nx = 0, nz = 0, y = opt && opt.y != null ? opt.y : null;
    var list = near(x, z, r + 2);
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o.prop) {
        if ((opt && opt.noProps) || y > 3) continue;
        var dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz), m = r + o.r;
        if (d < m && d > 1e-4) { x = o.x + dx / d * m; z = o.z + dz / d * m; hit = true; nx = dx / d; nz = dz / d; }
        continue;
      }
      var ins = y == null ? 0 : wallInset(o, y);
      if (ins < 0) continue;
      var hw = o.w / 2 - ins, hd = o.d / 2 - ins;
      var qx = FC.clamp(x, o.x - hw, o.x + hw), qz = FC.clamp(z, o.z - hd, o.z + hd);
      var ex = x - qx, ez = z - qz, e = Math.hypot(ex, ez);
      if (e < r) {
        if (e < 1e-4) {                              // центр внутри — выталкиваем по кратчайшей оси
          var px = hw - Math.abs(x - o.x), pz = hd - Math.abs(z - o.z);
          if (px < pz) { ex = Math.sign(x - o.x) || 1; ez = 0; x = o.x + ex * (hw + r); }
          else { ez = Math.sign(z - o.z) || 1; ex = 0; z = o.z + ez * (hd + r); }
          nx = ex; nz = ez;
        } else { nx = ex / e; nz = ez / e; x = qx + nx * r; z = qz + nz * r; }
        hit = true;
      }
    }
    if (!(opt && opt.water === false) && water(x, z) && !onRoad(x, z)) {
      // вода — стена для пешехода и машины вне моста
      hit = true; nx = 0; nz = 0;
      if (opt && opt.prev) { x = opt.prev.x; z = opt.prev.z; }
    }
    var L = EDGE - 6;
    if (x < -L) { x = -L; hit = true; } if (x > L) { x = L; hit = true; }
    if (z < -L) { z = -L; hit = true; } if (z > L) { z = L; hit = true; }
    return { x: x, z: z, hit: hit, nx: nx, nz: nz };
  }
  /* На проезжей части? Возвращает ребро и расстояние до оси. */
  function lineIdx(list, v, roads) {
    for (var i = 0; i < list.length; i++) if (Math.abs(v - list[i]) <= roads[i].w / 2) return i;
    return -1;
  }
  function onRoad(x, z) {
    return lineIdx(XS, x, VROADS) >= 0 || lineIdx(ZS, z, HROADS) >= 0;
  }
  function buildingAt(x, z, pad) {
    pad = pad || 0;
    var l = near(x, z, pad + 1);
    for (var i = 0; i < l.length; i++) {
      var o = l[i];
      if (!o.prop && Math.abs(x - o.x) <= o.w / 2 + pad && Math.abs(z - o.z) <= o.d / 2 + pad) return o;
    }
    return null;
  }

  /* ---- маршруты по дорогам: A* по узлам (навигатор, агенты, копы) ---------------------------------------------- */
  function nearestNode(x, z) {
    var ix = 0, iz = 0, bd = 1e18, i;
    for (i = 0; i < XS.length; i++) { var d = Math.abs(XS[i] - x); if (d < bd) { bd = d; ix = i; } }
    bd = 1e18;
    for (i = 0; i < ZS.length; i++) { var e = Math.abs(ZS[i] - z); if (e < bd) { bd = e; iz = i; } }
    return NODE_AT[ix + "," + iz];
  }
  function roadRoute(ax, az, bx, bz) {
    var s = nearestNode(ax, az), g = nearestNode(bx, bz);
    var G = NODES[g], open = [s], came = {}, cost = {}, seen = {};
    cost[s] = 0;
    var guard = 0;
    while (open.length && guard++ < 4000) {
      var bi = 0, bf = 1e18;
      for (var i = 0; i < open.length; i++) {
        var n = NODES[open[i]], f = cost[open[i]] + Math.abs(n.x - G.x) + Math.abs(n.z - G.z);
        if (f < bf) { bf = f; bi = i; }
      }
      var cur = open.splice(bi, 1)[0];
      if (cur === g) break;
      seen[cur] = 1;
      NODES[cur].edges.forEach(function (ei) {
        var e = EDGES[ei], nb = other(e, cur);
        if (seen[nb]) return;
        var c = cost[cur] + e.len * (e.kind === "hw" ? 0.7 : e.kind === "av" ? 0.85 : 1);
        if (cost[nb] == null || c < cost[nb]) { cost[nb] = c; came[nb] = cur; if (open.indexOf(nb) < 0) open.push(nb); }
      });
    }
    var path = [], k = g;
    while (k != null) { path.unshift({ x: NODES[k].x, z: NODES[k].z, n: k }); k = came[k]; }
    return path;
  }

  /* Пешеходный маршрут: по тротуару до угла квартала, через перекрёстки до квартала цели, к двери. */
  function walkRoute(ax, az, bx, bz) {
    var path = roadRoute(ax, az, bx, bz), out = [];
    // смещаем точки узлов в угол тротуара со стороны движения — пешеход идёт не по осевой
    for (var i = 0; i < path.length; i++) {
      var n = NODES[path[i].n];
      var sx = Math.sign((i ? path[i - 1].x : ax) - n.x) || 1, sz = Math.sign((i ? path[i - 1].z : az) - n.z) || 1;
      out.push({ x: n.x + sx * (n.vr.w / 2 + 2), z: n.z + sz * (n.hr.w / 2 + 2) });
    }
    out.push({ x: bx, z: bz });
    return out;
  }

  /* Случайная точка на тротуаре квартала (для прохожих). */
  function sidewalkPoint(r, nearX, nearZ, rad) {
    for (var t = 0; t < 30; t++) {
      var b;
      if (nearX != null) {
        b = blockAt(nearX + r.range(-rad, rad), nearZ + r.range(-rad, rad));
      } else b = BLOCKS[Math.floor(r() * BLOCKS.length)];
      if (!b || b.kind === "water") continue;
      var side = r.int(0, 3), u = r();
      var x = side < 2 ? b.x0 + (b.x1 - b.x0) * u : (side === 2 ? b.x0 + 2 : b.x1 - 2);
      var z = side >= 2 ? b.z0 + (b.z1 - b.z0) * u : (side === 0 ? b.z0 + 2 : b.z1 - 2);
      if (!water(x, z)) return { x: x, z: z, block: b };
    }
    return null;
  }

  /* Ближайшая полоса к точке: для появления машин и для возврата угнанной на дорогу. */
  function nearestLane(x, z) {
    var best = null, bd = 1e18;
    var n = NODES[nearestNode(x, z)];
    n.edges.forEach(function (ei) {
      var e = EDGES[ei];
      [e.a, e.b].forEach(function (from) {
        for (var k = 0; k < e.lanes; k++) {
          for (var t = 0.1; t < 0.95; t += 0.1) {
            var p = lanePoint(e, from, k, t), d = FC.dist2(x, z, p.x, p.z);
            if (d < bd) { bd = d; best = { edge: e.i, from: from, lane: k, t: t, x: p.x, z: p.z, dx: p.dx, dz: p.dz }; }
          }
        }
      });
    });
    return best;
  }

  FC.map = {
    EDGE: EDGE, HALF: HALF, LANE: LANE, WALK: WALK, SEA_Z: SEA_Z, SEA_LINE: SEA_LINE, BEACH_Z0: BEACH_Z0, RIVER: RIVER, RIVER_W: RIVER_W, LAKE: LAKE,
    XS: XS, ZS: ZS, VROADS: VROADS, HROADS: HROADS, nodes: NODES, edges: EDGES, blocks: BLOCKS, buildings: BUILDINGS,
    districts: DISTRICTS, DIST: DIST, zones: ZONE_B, pois: POIS, homes: HOMES, hq: HQ, plaza: plaza, props: PROPS,
    district: district, water: water, riverD: riverD, field: field, onRoad: onRoad, blockAt: blockAt, buildingAt: buildingAt,
    collide: collide, roofAt: roofAt, near: near, addProp: addProp, other: other, lanePoint: lanePoint, nearestNode: nearestNode,
    nearestLane: nearestLane, roadRoute: roadRoute, walkRoute: walkRoute, sidewalkPoint: sidewalkPoint,
    poi: function (kind, x, z) {
      var l = POIS.filter(function (B) { return B.poi === kind; });
      if (x != null) l.sort(function (a, b) { return FC.dist2(a.x, a.z, x, z) - FC.dist2(b.x, b.z, x, z); });
      return l[0] || null;
    },
    homeOf: function (house) { return HOMES.length ? HOMES[((house % HOMES.length) + HOMES.length) % HOMES.length] : null; }
  };
})(window);
