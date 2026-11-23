/* Флейм-Сити — «Минск 1:1»: план города для остальных модулей (FC.map) из данных OpenStreetMap (© участники
 * OpenStreetMap, ODbL; данные — client/minsk/, конвертер tools/minsk-osm.py).
 *
 * Работает только при FC_CITY === "minsk" (выбор города — index.html); иначе план даёт fmap.js. Наружу — тот же FC.map,
 * что у сетки: узлы и рёбра дорог (рёбра — ломаные, правостороннее движение, одностороннее — только от a к b),
 * полосы, маршруты, тротуары, районы, здания-зоны, точки, дома жителей, штаб, площадь старта, аэродром.
 * Здания: «важные» (зоны, точки, дома, штаб) — постоянные записи из meta.js (M.buildings, id = индекс); остальные дома
 * города — записи по запросу из загруженных кусков fosm.js (id — строка «o…»), с дверью к ближайшей улице.
 * Повёрнутый дом: B.rot — поворот локальной системы (−z — к двери), B.w × B.d — коробка внутри контура (интерьер).
 * Светофоры: FC.map.signal(узел, ось, ребро) — фаза по направлению подъезда (главная ось перекрёстка из данных).
 */
(function (global) {
  "use strict";
  var FC = global.FC, D = global.MINSK;
  if (global.FC_CITY !== "minsk" || !D) return;
  var LANE = 3.5, WALK = 4.5, CYCLE = 26;
  var BX0 = D.bounds[0], BZ0 = D.bounds[1], BX1 = D.bounds[2], BZ1 = D.bounds[3];

  /* ---- районы: настоящие (метки на карте и в тостах) и четыре «больших» ключа для модулей ---------------------- */
  function macro(x, z) {
    if (Math.hypot(x + 900, z + 400) < 2600) return "center";
    return x < -1800 ? "msk" : x > 1800 ? "ala" : "minsk";
  }
  var DIST = {
    center: { key: "center", name: "Центр", x: -900, z: -400, color: "#ffcf7a" },
    msk: { key: "msk", name: "Запад", x: -6000, z: -500, color: "#ff6b6b" },
    ala: { key: "ala", name: "Восток", x: 5500, z: -1500, color: "#6bd5ff" },
    minsk: { key: "minsk", name: "Север и юг", x: 0, z: 4500, color: "#9dff8a" }
  };
  var PLACES = D.districts.map(function (d) {
    var k = macro(d[1], d[2]);
    return { key: k, name: d[0], x: d[1], z: d[2], rank: d[3], color: DIST[k].color };
  });
  // кнопки «перенестись» на большой карте: главные места (задача: Центр, Немига, … Зелёный Луг)
  var LEGEND = ["Центр", "Немига", "Верхний город", "Проспект Независимости", "Проспект Победителей", "Мир-Сити", "Маяк Минска",
    "Вокзал", "Октябрьская", "Комаровка", "Уручье", "Каменная Горка", "Малиновка", "Серебрянка", "Чижовка", "Зелёный Луг", "Тракторный завод"];
  var DISTRICTS = LEGEND.map(function (n) { return PLACES.filter(function (d) { return d.name === n; })[0]; }).filter(Boolean);
  var pcache = {};
  function district(x, z) {
    var k = Math.round(x / 50) + "," + Math.round(z / 50);
    if (pcache[k]) return pcache[k];
    var best = DIST[macro(x, z)], bd = 1e18;
    for (var i = 0; i < PLACES.length; i++) {
      var d = PLACES[i], q = FC.dist2(x, z, d.x, d.z) / (1 + d.rank * 0.6);
      if (q < bd) { bd = q; best = d; }
    }
    return (pcache[k] = best);
  }

  /* ---- граф дорог ------------------------------------------------------------------------------------------- */
  var KIND = { motorway: "hw", trunk: "hw", primary: "av", secondary: "av" };
  var NODES = [], EDGES = [];
  for (var ni = 0; ni < D.nodes.length; ni += 5) {
    NODES.push({ i: NODES.length, x: D.nodes[ni] / 10, z: D.nodes[ni + 1] / 10, edges: [], signal: !!D.nodes[ni + 2],
      ax: D.nodes[ni + 3], off: D.nodes[ni + 4], phase: (D.nodes[ni + 4] / 13) | 0, grp: null, vr: null, hr: null });
  }
  var DELTA = (D.fmt || 1) >= 2;                            // точки рёбер и контуров — приращения (meta.js вдвое меньше)
  D.edges.forEach(function (r) {
    var n = (r.length - 7) / 2, px = new Float32Array(n), pz = new Float32Array(n), cum = new Float32Array(n), ax = 0, az = 0;
    for (var k = 0; k < n; k++) {
      if (DELTA && k) { ax += r[7 + k * 2]; az += r[8 + k * 2]; } else { ax = r[7 + k * 2]; az = r[8 + k * 2]; }
      px[k] = ax / 10; pz[k] = az / 10; if (k) cum[k] = cum[k - 1] + Math.hypot(px[k] - px[k - 1], pz[k] - pz[k - 1]);
    }
    var cls = D.cls[r[2]], len = Math.max(cum[n - 1], 0.5), m = Math.floor(n / 2);
    var e = { i: EDGES.length, a: r[0], b: r[1], cls: cls, kind: KIND[cls] || "st", lanes: Math.max(1, r[3]), oneway: !!(r[4] & 1),
      bridge: !!(r[4] & 2), w: r[5] / 10, name: r[6] >= 0 ? D.names[r[6]] : "", px: px, pz: pz, cum: cum, len: len,
      mx: (px[m] + px[n - 1 - m]) / 2, mz: (pz[m] + pz[n - 1 - m]) / 2,
      axis: Math.abs(px[n - 1] - px[0]) > Math.abs(pz[n - 1] - pz[0]) ? "x" : "z" };
    e.road = { w: e.w, kind: e.kind, name: e.name, lanes: e.lanes };
    EDGES.push(e); NODES[e.a].edges.push(e.i); NODES[e.b].edges.push(e.i);
  });
  function other(e, n) { return e.a === n ? e.b : e.a; }
  // направление ребра у узла (первый отрезок от узла), градусы 0..180 — для фаз светофора
  function bearingAt(e, n) {
    var k = e.px.length - 1, dx, dz;
    if (e.a === n) { dx = e.px[1] - e.px[0]; dz = e.pz[1] - e.pz[0]; } else { dx = e.px[k - 1] - e.px[k]; dz = e.pz[k - 1] - e.pz[k]; }
    var a = Math.atan2(dz, dx) * 180 / Math.PI;
    return ((a % 180) + 180) % 180;
  }
  function angD(a, b) { var d = Math.abs(a - b) % 180; return d > 90 ? 180 - d : d; }
  NODES.forEach(function (n) {
    var w = 8;
    n.edges.forEach(function (ei) { w = Math.max(w, Math.min(26, EDGES[ei].w)); });
    n.vr = { w: w, kind: "st" }; n.hr = n.vr;
    if (n.signal) {
      n.grp = {};
      n.edges.forEach(function (ei) { n.grp[ei] = angD(bearingAt(EDGES[ei], n.i), n.ax) < 45 ? 0 : 1; });
    }
  });
  function signal(nodeI, axis, ei) {
    var n = NODES[nodeI];
    if (!n || !n.signal) return "g";
    var g = ei != null && n.grp[ei] != null ? n.grp[ei] : angD(axis === "x" ? 0 : 90, n.ax) < 45 ? 0 : 1;
    var t = (FC.clock.t / FC.clock.speed + n.off) % CYCLE;
    return g === 0 ? (t < 11 ? "g" : t < 13 ? "y" : "r") : (t < 13 ? "r" : t < 24 ? "g" : "y");
  }

  // точка на оси ребра по длине s от узла a
  function segAt(e, s) {
    var c = e.cum, lo = 0, hi = c.length - 2;
    while (lo < hi) { var m = (lo + hi + 1) >> 1; if (c[m] <= s) lo = m; else hi = m - 1; }
    return lo;
  }
  function axisAt(e, s, out) {
    s = s < 0 ? 0 : s > e.len ? e.len : s;
    var i = segAt(e, s), L = (e.cum[i + 1] - e.cum[i]) || 1e-6, u = (s - e.cum[i]) / L;
    out.x = e.px[i] + (e.px[i + 1] - e.px[i]) * u; out.z = e.pz[i] + (e.pz[i + 1] - e.pz[i]) * u;
    out.dx = (e.px[i + 1] - e.px[i]) / L; out.dz = (e.pz[i + 1] - e.pz[i]) / L;
    return out;
  }
  function laneOff(e, k) {
    return e.oneway ? LANE * (k + 0.5) - e.lanes * LANE / 2 : Math.max(0, (e.w - 2 * e.lanes * LANE) / 2) + LANE * (k + 0.5);
  }
  /* Полоса: ехать по ребру e от узла from, полоса k (0 — у осевой). Точка на доле t пути и направление. */
  function lanePoint(e, from, k, t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var rev = from !== e.a, q = axisAt(e, rev ? e.len * (1 - t) : e.len * t, {});
    if (rev) { q.dx = -q.dx; q.dz = -q.dz; }
    var off = laneOff(e, k);
    return { x: q.x - q.dz * off, z: q.z + q.dx * off, dx: q.dx, dz: q.dz };
  }
  function axisPoint(e, t) { return axisAt(e, e.len * t, {}); }

  /* ---- сетки поиска: узлы (120 м), отрезки рёбер (50 м) ------------------------------------------------------ */
  var NG = 120, ngrid = {}, EG = 50, egrid = {};
  NODES.forEach(function (n) { var k = Math.floor(n.x / NG) + "," + Math.floor(n.z / NG); (ngrid[k] || (ngrid[k] = [])).push(n.i); });
  EDGES.forEach(function (e) {
    var seen = {};
    for (var i = 1; i < e.px.length; i++) {
      var x0 = Math.min(e.px[i - 1], e.px[i]) - e.w / 2, x1 = Math.max(e.px[i - 1], e.px[i]) + e.w / 2;
      var z0 = Math.min(e.pz[i - 1], e.pz[i]) - e.w / 2, z1 = Math.max(e.pz[i - 1], e.pz[i]) + e.w / 2;
      for (var gx = Math.floor(x0 / EG); gx <= Math.floor(x1 / EG); gx++) for (var gz = Math.floor(z0 / EG); gz <= Math.floor(z1 / EG); gz++) {
        var k = gx + "," + gz; if (seen[k]) continue; seen[k] = 1; (egrid[k] || (egrid[k] = [])).push(e.i);
      }
    }
  });
  function edgesNear(x, z, r) {
    var out = [], seen = {};
    for (var gx = Math.floor((x - r) / EG); gx <= Math.floor((x + r) / EG); gx++) for (var gz = Math.floor((z - r) / EG); gz <= Math.floor((z + r) / EG); gz++) {
      var l = egrid[gx + "," + gz]; if (!l) continue;
      for (var i = 0; i < l.length; i++) if (!seen[l[i]]) { seen[l[i]] = 1; out.push(EDGES[l[i]]); }
    }
    return out;
  }
  // проекция точки на ось ребра: {s, d, i}
  function project(e, x, z) {
    var best = { s: 0, d: 1e9 };
    for (var i = 1; i < e.px.length; i++) {
      var ax = e.px[i - 1], az = e.pz[i - 1], dx = e.px[i] - ax, dz = e.pz[i] - az, L = dx * dx + dz * dz || 1e-9;
      var t = ((x - ax) * dx + (z - az) * dz) / L; t = t < 0 ? 0 : t > 1 ? 1 : t;
      var d = Math.hypot(ax + dx * t - x, az + dz * t - z);
      if (d < best.d) { best.d = d; best.s = e.cum[i - 1] + t * Math.sqrt(L); }
    }
    return best;
  }
  function nearestEdge(x, z, r) {
    var best = null, bd = 1e9, bs = 0;
    for (var rr = r || 60; rr <= 480 && !best; rr *= 2) {
      edgesNear(x, z, rr).forEach(function (e) { var p = project(e, x, z); if (p.d < bd) { bd = p.d; best = e; bs = p.s; } });
    }
    return best ? { e: best, d: bd, s: bs } : null;
  }
  function nearestNode(x, z) {
    var gx = Math.floor(x / NG), gz = Math.floor(z / NG), best = -1, bd = 1e18;
    for (var r = 0; r < 40 && best < 0; r++) {
      for (var ix = gx - r; ix <= gx + r; ix++) for (var iz = gz - r; iz <= gz + r; iz++) {
        if (r && Math.abs(ix - gx) !== r && Math.abs(iz - gz) !== r) continue;
        var l = ngrid[ix + "," + iz]; if (!l) continue;
        for (var i = 0; i < l.length; i++) { var n = NODES[l[i]], d = FC.dist2(x, z, n.x, n.z); if (d < bd) { bd = d; best = l[i]; } }
      }
      if (best >= 0 && r === 0) { r++; for (var jx = gx - 1; jx <= gx + 1; jx++) for (var jz = gz - 1; jz <= gz + 1; jz++) {
        var l2 = ngrid[jx + "," + jz]; if (!l2) continue;
        for (var j = 0; j < l2.length; j++) { var n2 = NODES[l2[j]], d2 = FC.dist2(x, z, n2.x, n2.z); if (d2 < bd) { bd = d2; best = l2[j]; } }
      } }
    }
    return best < 0 ? 0 : best;
  }
  /* Ближайшая полоса к точке: для появления машин и для возврата угнанной на дорогу (одностороннее — только от a). */
  function nearestLane(x, z) {
    var ne = nearestEdge(x, z, 40); if (!ne) return null;
    var e = ne.e, best = null, bd = 1e18;
    [e.a, e.b].forEach(function (from) {
      if (e.oneway && from !== e.a) return;
      var t = FC.clamp((from === e.a ? ne.s : e.len - ne.s) / e.len, 0.02, 0.98);
      for (var k = 0; k < e.lanes; k++) {
        var p = lanePoint(e, from, k, t), d = FC.dist2(x, z, p.x, p.z);
        if (d < bd) { bd = d; best = { edge: e.i, from: from, lane: k, t: t, x: p.x, z: p.z, dx: p.dx, dz: p.dz }; }
      }
    });
    return best;
  }
  function onRoad(x, z) {
    var l = egrid[Math.floor(x / EG) + "," + Math.floor(z / EG)]; if (!l) return false;
    for (var i = 0; i < l.length; i++) { var e = EDGES[l[i]]; if (project(e, x, z).d < e.w / 2) return true; }
    return false;
  }

  /* ---- маршруты: A* с кучей по узлам; путь — точки ломаных рёбер (навигатор, копы, агенты) ------------------ */
  function heapPush(h, it) { h.push(it); var i = h.length - 1; while (i) { var p = (i - 1) >> 1; if (h[p][0] <= h[i][0]) break; var t = h[p]; h[p] = h[i]; h[i] = t; i = p; } }
  function heapPop(h) {
    var top = h[0], last = h.pop();
    if (h.length) { h[0] = last; var i = 0; for (;;) { var l = i * 2 + 1, r = l + 1, m = i; if (l < h.length && h[l][0] < h[m][0]) m = l; if (r < h.length && h[r][0] < h[m][0]) m = r; if (m === i) break; var t = h[m]; h[m] = h[i]; h[i] = t; i = m; } }
    return top;
  }
  var COSTK = { hw: 0.7, av: 0.85, st: 1 };
  function route(s, g, walk) {
    var G = NODES[g], open = [[0, s]], cost = {}, came = {}, via = {}, done = {}, n = 0;
    cost[s] = 0;
    while (open.length && n++ < 60000) {
      var cur = heapPop(open)[1];
      if (cur === g) break;
      if (done[cur]) continue;
      done[cur] = 1;
      var ed = NODES[cur].edges;
      for (var i = 0; i < ed.length; i++) {
        var e = EDGES[ed[i]];
        if (!walk && e.oneway && e.a !== cur) continue;
        var nb = other(e, cur); if (done[nb]) continue;
        var c = cost[cur] + e.len * (walk ? 1 : COSTK[e.kind]);
        if (cost[nb] == null || c < cost[nb]) {
          cost[nb] = c; came[nb] = cur; via[nb] = e.i;
          var N = NODES[nb]; heapPush(open, [c + Math.hypot(N.x - G.x, N.z - G.z) * 0.7, nb]);
        }
      }
    }
    var chain = [], k = g;
    if (came[g] == null && g !== s) return [{ x: NODES[s].x, z: NODES[s].z, n: s }];
    while (k != null) { chain.unshift(k); k = came[k]; }
    var path = [{ x: NODES[chain[0]].x, z: NODES[chain[0]].z, n: chain[0] }];
    for (var j = 1; j < chain.length; j++) {
      var E = EDGES[via[chain[j]]], fwd = E.a === chain[j - 1], m = E.px.length;
      for (var q = 1; q < m - 1; q++) { var ii = fwd ? q : m - 1 - q; path.push({ x: E.px[ii], z: E.pz[ii], e: E.i }); }
      path.push({ x: NODES[chain[j]].x, z: NODES[chain[j]].z, n: chain[j], e: E.i });
    }
    return path;
  }
  function roadRoute(ax, az, bx, bz) { return route(nearestNode(ax, az), nearestNode(bx, bz), false); }
  /* Пешеходный маршрут: те же улицы, но по тротуару справа и без запрета одностороннего. */
  function walkRoute(ax, az, bx, bz) {
    var p = route(nearestNode(ax, az), nearestNode(bx, bz), true), out = [];
    for (var i = 0; i < p.length; i++) {
      var a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      var w = p[i].e != null ? EDGES[p[i].e].w / 2 + 2.2 : 6;
      out.push({ x: p[i].x - dz / l * w, z: p[i].z + dx / l * w });
    }
    out.push({ x: bx, z: bz });
    return out;
  }

  /* ---- вода, берег, тихие зоны, фон ---------------------------------------------------------------------- */
  var RIVER = [];
  if (D.river[0]) for (var ri = 0; ri < D.river[0].length; ri += 2) RIVER.push([D.river[0][ri] / 10, D.river[0][ri + 1] / 10]);
  var RIVER_W = 40;
  function segD(px, pz, ax, az, bx, bz) {
    var dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz, t = l ? ((px - ax) * dx + (pz - az) * dz) / l : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(ax + dx * t - px, az + dz * t - pz);
  }
  function riverD(x, z) {
    var best = 1e9;
    for (var i = 0; i < RIVER.length - 1; i++) { var d = segD(x, z, RIVER[i][0], RIVER[i][1], RIVER[i + 1][0], RIVER[i + 1][1]); if (d < best) best = d; }
    return best;
  }
  function water(x, z) { return !!(FC.osm && FC.osm.water(x, z)); }
  function field(x, z) { return water(x, z) ? -1 : Math.max(0.5, riverD(x, z) - RIVER_W / 2); }
  function inList(x, z, l) { for (var i = 0; i < l.length; i++) if (Math.hypot(x - l[i][0], z - l[i][1]) < l[i][2]) return l[i]; return null; }
  function quiet(x, z) { return inList(x, z, D.quiet); }
  function gov(x, z) { return inList(x, z, D.gov); }

  /* ---- здания: геометрия записи (коробка внутри контура, поворот к улице, двери) ------------------------- */
  var STYLE_N = ["glass", "panel", "brick", "stalin", "modern", "studio", "house"];
  function pip(x, z, p) {
    var inside = false;
    for (var i = 0, j = p.length - 1; i < p.length; j = i++) {
      var xi = p[i][0], zi = p[i][1], xj = p[j][0], zj = p[j][1];
      if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
    }
    return inside;
  }
  // минимальный по площади прямоугольник по направлениям рёбер контура
  function obb(p) {
    var best = null;
    for (var i = 0; i < p.length; i++) {
      var j = (i + 1) % p.length, dx = p[j][0] - p[i][0], dz = p[j][1] - p[i][1], l = Math.hypot(dx, dz);
      if (l < 0.5) continue;
      var ux = dx / l, uz = dz / l, a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
      for (var k = 0; k < p.length; k++) {
        var a = p[k][0] * ux + p[k][1] * uz, b = -p[k][0] * uz + p[k][1] * ux;
        if (a < a0) a0 = a; if (a > a1) a1 = a; if (b < b0) b0 = b; if (b > b1) b1 = b;
      }
      var A = (a1 - a0) * (b1 - b0);
      if (!best || A < best.A) {
        var ca = (a0 + a1) / 2, cb = (b0 + b1) / 2;
        best = { A: A, ux: ux, uz: uz, w: a1 - a0, d: b1 - b0, x: ca * ux - cb * uz, z: ca * uz + cb * ux };
      }
    }
    return best;
  }
  // луч из (x, z) по (dx, dz) до контура: расстояние до ближайшего пересечения
  function rayHit(p, x, z, dx, dz) {
    var best = 1e9;
    for (var i = 0, j = p.length - 1; i < p.length; j = i++) {
      var ax = p[j][0], az = p[j][1], ex = p[i][0] - ax, ez = p[i][1] - az, den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      var t = ((ax - x) * ez - (az - z) * ex) / den, u = ((ax - x) * dz - (az - z) * dx) / den;
      if (t > 0 && u >= 0 && u <= 1 && t < best) best = t;
    }
    return best;
  }
  function frame(B, p) {
    var o = obb(p) || { ux: 1, uz: 0, w: 10, d: 10, x: B.x, z: B.z };
    var cx = o.x, cz = o.z;
    if (!pip(cx, cz, p)) { cx = B.x; cz = B.z; }
    // лицом к ближайшей улице: из четырёх нормалей коробки — та, что смотрит на дорогу
    var ne = nearestEdge(cx, cz, 60), nx = 0, nz = -1;
    if (ne) {
      var q = axisAt(ne.e, ne.s, {}), vx = q.x - cx, vz = q.z - cz, vl = Math.hypot(vx, vz) || 1;
      vx /= vl; vz /= vl;
      var cands = [[o.ux, o.uz], [-o.ux, -o.uz], [-o.uz, o.ux], [o.uz, -o.ux]], bd = -2;
      cands.forEach(function (c) { var dd = c[0] * vx + c[1] * vz; if (dd > bd) { bd = dd; nx = c[0]; nz = c[1]; } });
      B.street = ne.e.name || "";
      if (!B.street) { var ne2 = namedNear(cx, cz); if (ne2) B.street = ne2; }
    }
    var alongU = Math.abs(nx * o.ux + nz * o.uz) > 0.5;
    var W = alongU ? o.d : o.w, Dp = alongU ? o.w : o.d;       // W — вдоль фасада, Dp — вглубь
    var tx = -nz, tz = nx, f = 1;
    for (var it = 0; it < 7; it++) {                          // коробка внутри контура (Г-образные дома)
      var hw = W * f / 2 - 0.6, hd = Dp * f / 2 - 0.6, ok = true;
      for (var sx = -1; sx <= 1 && ok; sx++) for (var sz = -1; sz <= 1 && ok; sz++) {
        if (!pip(cx + tx * hw * sx + nx * hd * sz, cz + tz * hw * sx + nz * hd * sz, p)) ok = false;
      }
      if (ok) break;
      f *= 0.85;
    }
    B.x = cx; B.z = cz; B.w = Math.max(6, W * f - 0.4); B.d = Math.max(6, Dp * f - 0.4);
    B.rot = Math.atan2(-nx, -nz); B.front = "n"; B.nx = nx; B.nz = nz;
    var t1 = rayHit(p, cx, cz, nx, nz), t2 = rayHit(p, cx, cz, -nx, -nz);
    if (t1 > 1e8) t1 = B.d / 2; if (t2 > 1e8) t2 = B.d / 2;
    B.doors = [{ x: cx + nx * (t1 + 0.9), z: cz + nz * (t1 + 0.9), nx: nx, nz: nz, side: "n" }];
    if (B.w * B.d > 900 || B.zone || B.poi) B.doors.push({ x: cx - nx * (t2 + 0.9), z: cz - nz * (t2 + 0.9), nx: -nx, nz: -nz, side: "s" });
    B.num = 1 + (FC.hash("num" + B.id) % 120);
    B.addr = (B.street || district(cx, cz).name) + ", " + B.num;
  }
  function namedNear(x, z) {
    var l = edgesNear(x, z, 150), best = null, bd = 1e9;
    l.forEach(function (e) { if (!e.name) return; var p = project(e, x, z); if (p.d < bd) { bd = p.d; best = e.name; } });
    return best;
  }
  function pts10(a) {
    var out = [], x = 0, z = 0;
    for (var i = 0; i < a.length; i += 2) { if (DELTA && i) { x += a[i]; z += a[i + 1]; } else { x = a[i]; z = a[i + 1]; } out.push([x / 10, z / 10]); }
    return out;
  }
  function makeRecord(id, gid, x, z, h, kind, levels, name, st, poly) {
    var r = FC.rng(FC.hash("b" + gid));
    var floors = levels > 0 ? levels : Math.max(1, Math.round(h / 3.3));
    var B = { id: id, gid: gid, x: x, z: z, w: 10, d: 10, h: h, floors: floors, style: STYLE_N[st] || "modern", styleI: st,
      dist: macro(x, z), type: kind === "res" || kind === "house" ? "res" : "office", kindOsm: kind, front: "n", shop: false,
      zone: null, poi: null, home: null, name: name || "", tint: r.range(0.82, 1.08), seed: r.int(1, 1e9), poly: poly, osm: true };
    frame(B, poly);
    if (FC.places && FC.places.claim) FC.places.claim(B);           // место из пакета мест: имя, настоящий вход, интерьер
    if (!B.name) B.name = B.type === "res" ? "Жилой дом" : kind === "church" ? "Храм" : kind === "public" ? "Общественное здание" :
      kind === "industrial" ? "Завод" : kind === "shop" ? "Магазин" : "Здание";
    return B;
  }

  /* ---- постоянные записи: зоны, точки, дома жителей, штаб ----------------------------------------------- */
  var BUILDINGS = D.persist.map(function (r, i) {
    return makeRecord(i, r[0], r[1] / 10, r[2] / 10, r[3], r[4], r[5], r[6], r[7], pts10(r[9]));
  });
  var used = {};
  var KIND_EMOJI = { mail: "📧", gallery: "📸", chat: "✈️", web: "🌐", notes: "📝", deck: "📊", office: "🗂️",
    stalin: "🗄️", diamond: "📚", beacon: "🛰️", forge: "🛠️", shoot: "🎥", cut: "🎬", reels: "📱", queue: "⏳", wheel: "🎡" };
  var KIND_COLOR = { mail: "#4285f4", gallery: "#e1306c", chat: "#2aabee", web: "#7c5cff", notes: "#e9e9e9",
    deck: "#ff9f1c", office: "#c9a14a", stalin: "#b59b74", diamond: "#5bc0eb", beacon: "#ff4a4a", forge: "#ff7a2f",
    shoot: "#ffcf3f", cut: "#ff5d8f", reels: "#a77bff", queue: "#41e0c8", wheel: "#ffd166" };
  // Башня Флейм — штаб сюжета: вымышленная высотка на месте не построенной «башни-маяка» Маяка Минска
  var HQ = BUILDINGS[D.hq];
  HQ.type = "hq"; HQ.style = "glass"; HQ.styleI = 0; HQ.floors = 64; HQ.h = 64 * 3.5; HQ.name = "Башня Флейм";
  HQ.emoji = "🔥"; HQ.color = "#ff8a3d"; HQ.title = "FLAME"; HQ.shop = false; HQ.poi = "hq"; used[HQ.id] = 1;
  // Башня Флейм — выдуманный штаб сюжета. Конвертер ставил её у «Маяка Минска» (там по плану башня-маяк, её не построили —
  // пустой участок); с 23.11.2026 она на строящемся участке Западного коммерческого квартала «Минск-Мира», а у Маяка —
  // пусто, как в жизни. Старый дом из данных fosm не строит (hqOldGid), новую башню рисует fplaces.js, столкновения — здесь.
  var HQ_AT = [-3572, 3479], hqPoly = [[HQ_AT[0] - 18, HQ_AT[1] - 18], [HQ_AT[0] + 18, HQ_AT[1] - 18], [HQ_AT[0] + 18, HQ_AT[1] + 18], [HQ_AT[0] - 18, HQ_AT[1] + 18]];
  HQ.hqOldGid = HQ.gid; HQ.poly = hqPoly; HQ.x = HQ_AT[0]; HQ.z = HQ_AT[1]; frame(HQ, hqPoly); HQ.moved = true;
  function candList(k) { return (D.cand[k] || []).map(function (i) { return BUILDINGS[i]; }); }
  function takeNear(list, x, z, filt) {
    var best = null, bd = 1e18;
    list.forEach(function (B) { if (used[B.id] || (filt && !filt(B))) return; var d = FC.dist2(B.x, B.z, x, z); if (d < bd) { bd = d; best = B; } });
    if (best) used[best.id] = 1;
    return best;
  }
  var ZONES = global.FC_ZONES || [];
  var ZONE_B = {};
  var CITY_AT = { msk: [-2300, -650], minsk: [4200, -3300], ala: [3300, -2950] };     // Немига–Победителей, у библиотеки, у киностудии
  var FIXED = { library: "library", scout: "scout", forge: "forge", cut: "film" };
  var POOL = candList("office").concat(candList("shop"));
  ZONES.forEach(function (z, zi) {
    if (!z.city || !CITY_AT[z.city]) return;
    var B = FIXED[z.key] && D.anchors[FIXED[z.key]] != null && !used[D.anchors[FIXED[z.key]]] ? BUILDINGS[D.anchors[FIXED[z.key]]] : null;
    if (B) used[B.id] = 1;
    else {
      var a = CITY_AT[z.city], ang = zi * 47 * Math.PI / 180, rr = 60 + (zi % 5) * 70;
      if (z.key === "view") a = [-372, -374];                     // колесо обозрения в парке Горького
      B = takeNear(z.kind === "shop" ? POOL : candList("office").concat(candList("cinema")), a[0] + Math.cos(ang) * rr, a[1] + Math.sin(ang) * rr) ||
        takeNear(POOL, a[0], a[1]);
    }
    if (!B) return;
    var sh = z.shop || {};
    B.zone = z.key; B.type = "zone"; B.name = z.name; B.sub = z.sub || "";
    B.emoji = sh.emoji || KIND_EMOJI[z.kind] || "🏢";
    B.color = sh.color || KIND_COLOR[z.kind] || "#ffcf7a";
    B.title = sh.title || z.name.toUpperCase();
    if (z.kind === "shoot" || z.kind === "cut" || z.kind === "reels") { B.style = "studio"; B.styleI = 5; B.floors = Math.min(B.floors, 3); }
    B.shop = false;
    frame(B, B.poly);                                          // вторая дверь у зоны
    ZONE_B[z.key] = B;
  });

  /* ---- точки: настоящие участки, больницы, заправки, банки — и игровые места ---------------------------- */
  var ZYB = [-1608, -608];                                    // Зыбицкая: бары и клубы
  var SPREAD = [[-900, -400], [-5500, -600], [5000, -2500], [500, 4200], [-500, -5200], [-4500, 3500], [6000, 2500], [3000, -5500]];
  var POI_DEF = [
    { poi: "police", name: "Пост патруля «Щит»", emoji: "🚓", color: "#2f6fd6", n: 6, from: ["police"] },
    { poi: "hospital", name: "Больница", emoji: "🏥", color: "#ff4d6d", n: 4, from: ["hospital"] },
    { poi: "paint", name: "Перекраска", emoji: "🎨", color: "#ffb02e", n: 3, from: ["carwash", "shop"] },
    { poi: "store", name: "Магазин 24/7", emoji: "🛒", color: "#41e08c", n: 7, from: ["store", "shop"] },
    { poi: "gas", name: "Заправка", emoji: "⛽", color: "#ffd23f", n: 4, from: ["fuel"] },
    { poi: "cars", name: "Автосалон «Искра Моторс»", emoji: "🏎️", color: "#ff7a2f", n: 1, from: ["cars", "shop"] },
    { poi: "club", name: "Клуб «Неон»", emoji: "🪩", color: "#c86bff", n: 1, from: ["zyb", "bar"], at: ZYB },
    { poi: "gym", name: "Спортзал «Железо»", emoji: "🏋️", color: "#9aa5b1", n: 1, from: ["gym", "shop"] },
    { poi: "hotel", name: "Отель «Флейм»", emoji: "🏨", color: "#e9c46a", n: 1, from: ["hotel", "office"] },
    { poi: "bank", name: "Флейм-Банк", emoji: "💰", color: "#2fbf71", n: 1, from: ["bank"] },
    { poi: "biz", id: "shawarma", name: "Шаурма «У Огонька»", emoji: "🌯", color: "#ff9f1c", from: ["fastfood", "shop"], price: 4000, income: 160 },
    { poi: "biz", id: "carwash", name: "Автомойка «Пена»", emoji: "🧽", color: "#4cc9f0", from: ["carwash", "shop"], price: 7000, income: 260 },
    { poi: "biz", id: "flowers", name: "Цветы «Букет»", emoji: "💐", color: "#ff70a6", from: ["florist", "shop"], price: 5500, income: 210 },
    { poi: "biz", id: "barber", name: "Барбершоп «Бритва»", emoji: "💈", color: "#e63946", from: ["barber", "shop"], price: 9000, income: 330 },
    { poi: "biz", id: "coffee", name: "Кофейня «Пенка»", emoji: "☕", color: "#a0522d", from: ["zyb", "cafe"], price: 12000, income: 430, at: ZYB },
    { poi: "biz", id: "studio", name: "Студия звука «Эхо»", emoji: "🎧", color: "#7c5cff", from: ["office"], price: 18000, income: 640 },
    { poi: "biz", id: "taxi", name: "Такси-парк «Шашки»", emoji: "🚕", color: "#ffd23f", from: ["shop"], price: 30000, income: 1050 },
    { poi: "biz", id: "nightclub", name: "Ночной клуб «Искра»", emoji: "🔥", color: "#ff006e", from: ["zyb", "bar"], price: 60000, income: 2200, at: ZYB },
    { poi: "guns", name: "Оружейная «Искромёт»", emoji: "🎯", color: "#e63946", n: 3, from: ["shop"] }
  ];
  var POIS = [];
  POI_DEF.forEach(function (p, pi) {
    var list = [];
    p.from.forEach(function (k) { list = list.concat(candList(k)); });
    for (var k = 0; k < (p.n || 1); k++) {
      var a = p.at || SPREAD[(k + pi) % SPREAD.length];
      var B = takeNear(list, a[0], a[1]); if (!B) break;
      B.poi = p.poi; B.type = p.poi; B.name = p.name; B.emoji = p.emoji; B.color = p.color; B.title = p.name.toUpperCase();
      if (p.poi === "biz") { B.biz = { id: p.id, price: p.price, income: p.income }; B.title = p.name.replace(/«|»/g, "").toUpperCase(); }
      B.shop = false;
      frame(B, B.poly);
      POIS.push(B);
    }
  });
  // витрины для налётов: магазины из пула (центр — «center»/«msk»/«ala» по большим районам)
  candList("shop").forEach(function (B) { if (!used[B.id]) B.shop = true; });
  /* ---- дома жителей ---------------------------------------------------------------------------------------- */
  var HOMES = candList("res").filter(function (B) { return !used[B.id]; })
    .sort(function (a, b) { return FC.hash("home" + a.gid) - FC.hash("home" + b.gid); });
  HOMES.forEach(function (B, i) { B.home = i; B.type = "res"; used[B.id] = 1; });

  /* ---- «кварталы»: парки и площади (для банд, трамплинов, находок), площадь старта ----------------------- */
  var BLOCKS = D.spots.map(function (s, i) {
    var b = { i: i, kind: s[0] === "square" ? "plaza" : "park", x0: s[1], z0: s[2], x1: s[3], z1: s[4], cx: (s[1] + s[3]) / 2, cz: (s[2] + s[4]) / 2, name: s[5] };
    b.dist = district(b.cx, b.cz); b.dist = DIST[macro(b.cx, b.cz)];
    return b;
  });
  var SX = D.start[0], SZ = D.start[1];
  var plaza = { i: BLOCKS.length, kind: "plaza", x0: SX - 22 - 30, x1: SX - 22 + 30, z0: SZ - 18 - 30, z1: SZ - 18 + 30, cx: SX - 22, cz: SZ - 18, dist: DIST.ala, start: true };
  function blockAt(x, z) {
    for (var i = 0; i < BLOCKS.length; i++) { var b = BLOCKS[i]; if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return b; }
    var w = walkBlock(x, z, 80);
    return w;
  }
  // «квартал»-тротуар: полоса вдоль ближайшей улицы (прохожие ходят по ней туда-обратно)
  var wcache = {};
  function walkBlock(x, z, r, side) {
    var ne = nearestEdge(x, z, r || 60); if (!ne) return null;
    var e = ne.e;
    if (side == null) { var q = axisAt(e, ne.s, {}); side = ((x - q.x) * -q.dz + (z - q.z) * q.dx) >= 0 ? 1 : -1; }
    var key = e.i + ":" + side;
    if (wcache[key]) return wcache[key];
    var off = side * (e.w / 2 + 1.7), pts = [], x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (var i = 0; i < e.px.length; i++) {
      var a = Math.max(0, i - 1), b = Math.min(e.px.length - 1, i + 1), dx = e.px[b] - e.px[a], dz = e.pz[b] - e.pz[a], l = Math.hypot(dx, dz) || 1;
      var px = e.px[i] - dz / l * off, pz = e.pz[i] + dx / l * off;
      // не заходить в перекрёсток: концы укорачиваем на полширины узла
      pts.push([px, pz]);
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); z0 = Math.min(z0, pz); z1 = Math.max(z1, pz);
    }
    var cum = [0];
    for (var k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
    var L = cum[cum.length - 1], cut = Math.min(L * 0.2, NODES[e.a].vr.w / 2 + 2);
    var blk = { i: "w" + key, kind: "city", walk: true, x0: x0 - 3, x1: x1 + 3, z0: z0 - 3, z1: z1 + 3, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2,
      dist: DIST[macro((x0 + x1) / 2, (z0 + z1) / 2)], per: { pts: pts, cum: cum, L: L, s0: cut, s1: L - cut }, edge: e.i };
    if (Object.keys(wcache).length > 3000) wcache = {};
    return (wcache[key] = blk);
  }
  /* Случайная точка на тротуаре у улицы рядом с (nearX, nearZ) (для прохожих, находок, заданий). */
  function sidewalkPoint(r, nearX, nearZ, rad) {
    if (nearX == null) { var P = FC.player; nearX = P ? P.x : SX; nearZ = P ? P.z : SZ; rad = 1400; }
    for (var t = 0; t < 24; t++) {
      var a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad, x = nearX + Math.cos(a) * d, z = nearZ + Math.sin(a) * d;
      var ne = nearestEdge(x, z, 60); if (!ne || ne.d > 90) continue;
      var e = ne.e, side = r() < 0.5 ? 1 : -1, blk = walkBlock(x, z, 60, side); if (!blk) continue;
      var s = blk.per.s0 + r() * Math.max(1, blk.per.s1 - blk.per.s0), q = polyAt(blk.per, s);
      if (e.bridge && r() < 0.7) continue;
      if (!water(q[0], q[1]) && !buildingAt(q[0], q[1], 0.5)) return { x: q[0], z: q[1], block: blk, per: blk.per, s: s };
    }
    return null;
  }
  function polyAt(p, s) {
    s = s < 0 ? 0 : s > p.L ? p.L : s;
    var c = p.cum, lo = 0, hi = c.length - 2;
    while (lo < hi) { var m = (lo + hi + 1) >> 1; if (c[m] <= s) lo = m; else hi = m - 1; }
    var L = (c[lo + 1] - c[lo]) || 1e-6, u = (s - c[lo]) / L;
    return [p.pts[lo][0] + (p.pts[lo + 1][0] - p.pts[lo][0]) * u, p.pts[lo][1] + (p.pts[lo + 1][1] - p.pts[lo][1]) * u];
  }

  /* ---- столкновения и поиск зданий: контуры из fosm + столбы и деревья (addProp) -------------------------- */
  var CELL = 40, PGRID = {}, PROPS = [];
  function addProp(x, z, r, kind) {
    var p = { prop: true, x: x, z: z, r: r, kind: kind };
    PROPS.push(p);
    for (var gx = Math.floor((x - r) / CELL); gx <= Math.floor((x + r) / CELL); gx++)
      for (var gz = Math.floor((z - r) / CELL); gz <= Math.floor((z + r) / CELL); gz++) (PGRID[gx + "," + gz] || (PGRID[gx + "," + gz] = [])).push(p);
    return p;
  }
  function removeProp(p) {
    var i = PROPS.indexOf(p); if (i >= 0) PROPS.splice(i, 1);
    for (var gx = Math.floor((p.x - p.r) / CELL); gx <= Math.floor((p.x + p.r) / CELL); gx++)
      for (var gz = Math.floor((p.z - p.r) / CELL); gz <= Math.floor((p.z + p.r) / CELL); gz++) {
        var l = PGRID[gx + "," + gz]; if (!l) continue; var j = l.indexOf(p); if (j >= 0) l.splice(j, 1);
      }
  }
  function propsNear(x, z, r, out) {
    for (var gx = Math.floor((x - r) / CELL); gx <= Math.floor((x + r) / CELL); gx++)
      for (var gz = Math.floor((z - r) / CELL); gz <= Math.floor((z + r) / CELL); gz++) {
        var l = PGRID[gx + "," + gz]; if (!l) continue;
        for (var i = 0; i < l.length; i++) if (out.indexOf(l[i]) < 0) out.push(l[i]);
      }
    return out;
  }
  // запись здания для контура куска (лениво, кэш на самом контуре)
  function recordOf(it) {
    if (!it) return null;
    if (it.pi >= 0 && BUILDINGS[it.pi]) { if (it.addr && !BUILDINGS[it.pi].addrOsm) { BUILDINGS[it.pi].addr = it.addr; BUILDINGS[it.pi].addrOsm = true; } return BUILDINGS[it.pi]; }
    if (!it.B) {
      var cx = 0, cz = 0; it.p.forEach(function (q) { cx += q[0]; cz += q[1]; });
      it.B = makeRecord("o" + it.id, it.id, cx / it.p.length, cz / it.p.length, it.h, it.kind, it.levels, it.name, it.st, it.p);
      if (it.addr) it.B.addr = it.addr;                       // настоящий адрес из OSM («ул. Сурганова, 24»)
    }
    return it.B;
  }
  function buildingAt(x, z, pad) {
    if (!FC.osm) return null;
    return recordOf(FC.osm.itemAt(x, z, pad || 0));
  }
  function near(x, z, r) {
    var out = [];
    if (FC.osm) FC.osm.near(x, z, r).forEach(function (it) { var B = recordOf(it); if (B && out.indexOf(B) < 0) out.push(B); });
    return propsNear(x, z, r, out);
  }
  /* Круг (x, z, r) против домов (контуры), столбов, воды и края города. */
  function collide(x, z, r, opt) {
    var c = FC.osm ? FC.osm.collide(x, z, r) : { x: x, z: z, hit: false, nx: 0, nz: 0 };
    x = c.x; z = c.z;
    var hit = c.hit, nx = c.nx, nz = c.nz;
    if (HQ.moved && x > HQ.x - 19 - r && x < HQ.x + 19 + r && z > HQ.z - 19 - r && z < HQ.z + 19 + r) {
      // перенесённая Башня Флейм — квадрат 36×36: выталкиваем к ближней грани
      var dx0 = x - (HQ.x - 18 - r), dx1 = (HQ.x + 18 + r) - x, dz0 = z - (HQ.z - 18 - r), dz1 = (HQ.z + 18 + r) - z, m = Math.min(dx0, dx1, dz0, dz1);
      if (m === dx0) { x = HQ.x - 18 - r; nx = -1; nz = 0; } else if (m === dx1) { x = HQ.x + 18 + r; nx = 1; nz = 0; }
      else if (m === dz0) { z = HQ.z - 18 - r; nx = 0; nz = -1; } else { z = HQ.z + 18 + r; nx = 0; nz = 1; }
      hit = true;
    }
    if (!(opt && opt.noProps)) {
      var pl = propsNear(x, z, r + 1, []);
      for (var i = 0; i < pl.length; i++) {
        var o = pl[i], dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz), m = r + o.r;
        if (d < m && d > 1e-4) { x = o.x + dx / d * m; z = o.z + dz / d * m; hit = true; nx = dx / d; nz = dz / d; }
      }
    }
    if (!(opt && opt.water === false) && water(x, z) && !onRoad(x, z)) {
      hit = true; nx = 0; nz = 0;
      if (opt && opt.prev) { x = opt.prev.x; z = opt.prev.z; }
    }
    if (x < BX0 + 6) { x = BX0 + 6; hit = true; } if (x > BX1 - 6) { x = BX1 - 6; hit = true; }
    if (z < BZ0 + 6) { z = BZ0 + 6; hit = true; } if (z > BZ1 - 6) { z = BZ1 - 6; hit = true; }
    return { x: x, z: z, hit: hit, nx: nx, nz: nz };
  }

  /* ---- подложка карты (fhud): застройка, вода, зелень из map.json, улицы из графа, подписи ------------------ */
  var mapData = null;
  var mapWaitT = 0;
  function loadMap() {
    if (mapData) return;
    // подложку карты (~0,4 МБ) качаем после старта: сначала — данные города и куски вокруг игрока
    if (!FC.started || !mapWaitT || performance.now() - mapWaitT < 3500) {
      if (FC.started && !mapWaitT) mapWaitT = performance.now();
      if (!loadMap.t) loadMap.t = setTimeout(function () { loadMap.t = 0; loadMap(); }, 1200);
      return;
    }
    mapData = { pending: true };
    fetch("minsk/map.json?v=" + D.v).then(function (r) { return r.json(); }).then(function (j) {
      mapData = j; FC.emit("map:base");
    }).catch(function () { mapData = null; });
  }
  var LANDC = { residential: "#3a404a", commercial: "#45434f", retail: "#4a4450", industrial: "#3d3a36", construction: "#4a4636",
    railway: "#34353a", garages: "#38393d" };
  // подложка: старый формат — абсолютные дециметры, fmt 2 — метры с приращениями
  function poly(c, a, X, Z) {
    var d2 = mapData && mapData.fmt >= 2, x = 0, z = 0;
    c.beginPath();
    for (var i = 0; i < a.length; i += 2) {
      if (d2) { if (i) { x += a[i]; z += a[i + 1]; } else { x = a[i]; z = a[i + 1]; } } else { x = a[i] / 10; z = a[i + 1] / 10; }
      if (i) c.lineTo(X(x), Z(z)); else c.moveTo(X(x), Z(z));
    }
  }
  function paintBase(c, S) {
    function X(v) { return (v - BX0) * S; } function Z(v) { return (v - BZ0) * S; }
    c.fillStyle = "#1d3b2c"; c.fillRect(0, 0, (BX1 - BX0) * S, (BZ1 - BZ0) * S);
    if (mapData && mapData.land) {
      mapData.land.forEach(function (l) { c.fillStyle = LANDC[l[0]] || "#3a404a"; poly(c, l[1], X, Z); c.fill(); });
      c.fillStyle = "#2d5a3a"; mapData.green.forEach(function (g) { poly(c, g, X, Z); c.fill(); });
      c.fillStyle = "#123a55"; mapData.water.forEach(function (w) { poly(c, w, X, Z); c.fill(); });
      c.strokeStyle = "#123a55"; c.lineCap = "round"; c.lineJoin = "round";
      mapData.wline.forEach(function (w) { c.lineWidth = Math.max(1, w[1] * S); poly(c, w[0], X, Z); c.stroke(); });
      c.strokeStyle = "#5a5560"; c.lineWidth = 1; mapData.rail.forEach(function (r) { poly(c, r, X, Z); c.stroke(); });
    } else loadMap();
    c.lineCap = "round"; c.lineJoin = "round";
    ["st", "av", "hw"].forEach(function (k) {
      c.strokeStyle = k === "hw" ? "#b7a36a" : k === "av" ? "#9aa0a8" : "#6c727b";
      EDGES.forEach(function (e) {
        if (e.kind !== k) return;
        c.lineWidth = Math.max(k === "st" ? 0.6 : 1.2, e.w * S);
        c.beginPath(); for (var i = 0; i < e.px.length; i++) { if (i) c.lineTo(X(e.px[i]), Z(e.pz[i])); else c.moveTo(X(e.px[i]), Z(e.pz[i])); }
        c.stroke();
      });
    });
  }
  /* Подробный слой рядом с игроком (миникарта и крупная карта): дома загруженных кусков, улицы по ширине. */
  var det = { cv: null, x: 1e9, z: 1e9, n: -1, t: 0 }, DET = 700, DK = 1.2;
  function detail(c, k, mode, view) {
    var P = FC.player; if (!P || !FC.osm) return;
    var cx = mode === "big" && view ? view.x : P.x, cz = mode === "big" && view ? view.z : P.z;
    if (mode === "big" && k < 0.25) return;                        // подписи рисует карта последними (mapLabels)
    var nl = FC.osm.chunksLoaded();
    if (!det.cv) { det.cv = document.createElement("canvas"); det.cv.width = det.cv.height = Math.round(DET * DK); }
    if (Math.hypot(cx - det.x, cz - det.z) > DET * 0.28 || (nl !== det.n && performance.now() - det.t > 1500)) {
      det.x = Math.round(cx); det.z = Math.round(cz); det.n = nl; det.t = performance.now();
      var g = det.cv.getContext("2d"), x0 = det.x - DET / 2, z0 = det.z - DET / 2;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, det.cv.width, det.cv.height);
      g.setTransform(DK, 0, 0, DK, -x0 * DK, -z0 * DK);
      g.lineCap = "round"; g.lineJoin = "round";
      edgesNear(det.x, det.z, DET / 2).forEach(function (e) {
        g.strokeStyle = e.kind === "hw" ? "#b7a36a" : e.kind === "av" ? "#9aa0a8" : "#7c828b"; g.lineWidth = e.w;
        g.beginPath(); for (var i = 0; i < e.px.length; i++) { if (i) g.lineTo(e.px[i], e.pz[i]); else g.moveTo(e.px[i], e.pz[i]); } g.stroke();
      });
      FC.osm.near(det.x, det.z, DET / 2).forEach(function (it) {
        var B = it.pi >= 0 ? BUILDINGS[it.pi] : null;
        g.fillStyle = B && B.title ? B.color : it.h > 60 ? "#5b6676" : "#4b525e";
        g.beginPath(); it.p.forEach(function (q, i) { if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); g.closePath(); g.fill();
      });
    }
    c.drawImage(det.cv, det.x - DET / 2, det.z - DET / 2, DET, DET);
  }
  // названия станций метро (с 0,1 пикс/м) и ориентиров (с 0,35 — короткие, с 0,7 — все); наложения отсекает карта (fhud)
  function drawLabels(c, k, view) {
    var vw = 900 / k, fs = Math.max(10, 12 / k);
    c.textAlign = "center"; c.textBaseline = "middle";
    c.font = "600 " + fs + "px system-ui";
    var near = function (m) { return Math.abs(m[1] - view.x) < vw && Math.abs(m[2] - view.z) < vw; };
    if (k > 0.1) {
      c.lineWidth = 3 / k; c.strokeStyle = "rgba(8,12,24,.75)"; c.fillStyle = "rgba(255,255,255,.9)";
      D.metro.forEach(function (m) { if (near(m)) { c.strokeText("Ⓜ " + m[0], m[1], m[2]); c.fillText("Ⓜ " + m[0], m[1], m[2]); } });
    }
    if (k > 0.35) {
      c.font = "500 " + Math.max(9, 11 / k) + "px system-ui"; c.fillStyle = "rgba(255,230,180,.85)";
      D.marks.forEach(function (m) { if (near(m) && (k > 0.7 || m[0].length <= 26)) { c.strokeText(m[0], m[1], m[2] + fs * 1.2); c.fillText(m[0], m[1], m[2] + fs * 1.2); } });
    }
  }

  /* ---- «Найди свой дом»: поиск по адресу (улица по-русски или по-белорусски + номер) → к подъезду. Индекс адресов —
   * minsk/addr.json (OSM addr:*, грузится при первом поиске). Адрес игрока остаётся на устройстве: не уходит ни на
   * сервер, ни другим игрокам (только localStorage этого браузера). ----------------------------------------------- */
  var ADDR = null, addrP = null;
  var STOPW = { "улица": 1, "ул": 1, "проспект": 1, "пр-т": 1, "пр": 1, "переулок": 1, "пер": 1, "бульвар": 1, "б-р": 1, "площадь": 1,
    "пл": 1, "проезд": 1, "шоссе": 1, "ш": 1, "тупик": 1, "вуліца": 1, "вул": 1, "праспект": 1, "завулак": 1, "плошча": 1,
    "праезд": 1, "тракт": 1, "минск": 1, "мінск": 1, "г": 1, "дом": 1, "д": 1 };
  function normA(s) {
    return (s || "").toLowerCase().replace(/ё/g, "е").replace(/[«»"'.,()]/g, " ").split(/\s+/).filter(function (w) { return w && !STOPW[w]; });
  }
  function loadAddr() {
    if (!addrP) addrP = fetch("minsk/addr.json?v=" + D.v).then(function (r) { return r.json(); }).then(function (j) {
      ADDR = j.s.map(function (q) { return { ru: q[0], be: q[1], w: normA(q[0]).concat(normA(q[1])), h: q[2] }; });
      return ADDR;
    }).catch(function () { addrP = null; return null; });
    return addrP;
  }
  function findAddr(qs) {
    if (!ADDR) return [];
    var words = normA(qs), num = null;
    if (words.length && /^\d/.test(words[words.length - 1])) num = words.pop().replace(/корп(ус)?|к/, "к");
    if (!words.length) return [];
    var out = [];
    ADDR.forEach(function (st) {
      var ok = words.every(function (w) { return st.w.some(function (x) { return x.indexOf(w) === 0; }); });
      if (!ok) return;
      st.h.forEach(function (hh) {
        if (num && hh[0].toLowerCase().replace(/\s/g, "").indexOf(num) !== 0) return;
        if (!num && out.length > 40) return;
        out.push({ st: st, n: hh[0], x: hh[1], z: hh[2], lv: hh[3], exact: num && hh[0].toLowerCase().replace(/\s/g, "") === num });
      });
    });
    out.sort(function (a, b) { return (b.exact ? 1 : 0) - (a.exact ? 1 : 0) || a.st.ru.length - b.st.ru.length; });
    return out.slice(0, 14);
  }
  function goHome(r) {
    var H = FC.hud; if (!H) return;
    var ok = H.teleport(r.x, r.z, false);
    if (ok === false) return;
    H.closePhone();
    var label = r.st.ru + ", " + r.n;
    try { global.localStorage.setItem("fc.minsk.home", JSON.stringify({ a: label, x: r.x, z: r.z })); } catch (e) { /* приватное окно */ }
    if (FC.markers) FC.markers.add({ id: "myhome", x: r.x, z: r.z, color: "#7cf29a", icon: "🏠", ring: 6 });
    H.toast("🏠 " + label + (r.lv ? " · " + r.lv + " эт." : "") + " — видишь только ты", "ok", 4);
    FC.emit("home:found", { local: true });
  }
  function addrApp() {
    var H = FC.hud; if (!H || !H.addApp) return;
    H.addApp({ id: "myhome", icon: "🏠", name: "Мой дом", color: "#2f9e5a", order: 3, render: function (b) {
      var esc = H.esc, saved = null;
      try { saved = JSON.parse(global.localStorage.getItem("fc.minsk.home") || "null"); } catch (e) { saved = null; }
      b.innerHTML = "<div class='list'><div class='card'><b>Найди свой дом</b><p>Улица и номер — по-русски или по-белорусски: " +
        "«Сурганова 24», «Независимости 95к2». Адрес остаётся на твоём телефоне — его не видят другие игроки.</p>" +
        "<input class='addrq' type='search' placeholder='Улица и дом' autocomplete='off' style='width:100%;box-sizing:border-box;padding:10px;border-radius:10px;border:0;font-size:16px;margin-top:6px'>" +
        (saved ? "<p><button type='button' class='addrsaved' style='margin-top:8px;padding:8px 10px;border-radius:9px;border:0;background:#2f9e5a;color:#fff'>🏠 " + esc(saved.a) + "</button></p>" : "") +
        "</div><div class='addrres'></div></div>";
      var inp = b.querySelector(".addrq"), res = b.querySelector(".addrres"), t = null;
      if (saved) b.querySelector(".addrsaved").addEventListener("click", function () { goHome({ st: { ru: saved.a.split(", ").slice(0, -1).join(", ") }, n: saved.a.split(", ").pop(), x: saved.x, z: saved.z }); });
      function show() {
        var q = inp.value;
        loadAddr().then(function () {
          var r = findAddr(q);
          res.innerHTML = r.map(function (x, i) {
            return "<div class='card' data-i='" + i + "' style='cursor:pointer'><b>" + esc(x.st.ru) + ", " + esc(x.n) + "</b><p>" +
              (x.lv ? x.lv + " эт. · " : "") + esc(x.st.be || "") + "</p></div>";
          }).join("") || (q.trim().length > 2 ? "<div class='card'><p>Не нашёл такой адрес. Проверь улицу и номер.</p></div>" : "");
          res.querySelectorAll("[data-i]").forEach(function (el) { el.addEventListener("click", function () { goHome(r[+el.dataset.i]); }); });
        });
      }
      inp.addEventListener("input", function () { clearTimeout(t); t = setTimeout(show, 180); });
      inp.addEventListener("keydown", function (e) { e.stopPropagation(); });
      setTimeout(function () { inp.focus(); }, 60);
      loadAddr();
    } });
    // вид города: погода и свет (ресёрч: лето — для красоты, пасмурно — как Минск выглядит полгода, зима со снегом)
    H.addApp({ id: "look", icon: "🌦️", name: "Погода", color: "#4a6fa5", order: 60, render: function (b) {
      var cur = FC.gfx.look ? FC.gfx.look.name : "summer";
      var L = [["auto", "Как сейчас в Минске"], ["summer", "Лето"], ["overcast", "Пасмурно"], ["winter", "Зима, снег"]];
      b.innerHTML = "<div class='list'><div class='card'><b>Погода в Минске</b><p>Сейчас: " + ({ summer: "лето", overcast: "пасмурно", winter: "зима" }[cur] || cur) + "</p>" +
        L.map(function (l) { return "<button type='button' data-k='" + l[0] + "' style='margin:4px;padding:8px 10px;border-radius:9px;border:0;background:#4a6fa5;color:#fff'>" + l[1] + "</button>"; }).join("") + "</div></div>";
      b.querySelectorAll("button[data-k]").forEach(function (el) {
        el.addEventListener("click", function () {
          var n = FC.gfx.preset(el.dataset.k);
          try { global.localStorage.setItem("fc.minsk.look", el.dataset.k); } catch (e) { /* приватное окно */ }
          H.toast("🌦️ " + ({ summer: "Лето", overcast: "Пасмурно", winter: "Зима" }[n] || n), "ok", 2); H.closePhone();
        });
      });
    } });
  }
  FC.on("start", function () {
    addrApp();
    try { var lk = global.localStorage.getItem("fc.minsk.look"); if (lk && FC.gfx.preset) FC.gfx.preset(lk); } catch (e) { /* приватное окно */ }
    // первый вход в Минск: предложить найти свой дом (один раз; не поверх диалогов)
    var asked = false;
    try { asked = !!global.localStorage.getItem("fc.minsk.homeAsked"); } catch (e) { asked = true; }
    if (asked) return;
    var tries = 0, t0 = Date.now();
    (function ask() {
      if (++tries > 120) return;
      // не поверх вступления и диалогов: через минуту игры, когда обучение пройдено или идёт уже 4 минуты
      var busy = !FC.hud || (FC.hud.inDialog && FC.hud.inDialog()) || FC.paused || document.body.classList.contains("indlg") ||
        Date.now() - t0 < 60000 || (FC.save && FC.save.tutorial && Date.now() - t0 < 240000) || (FC.inside && FC.inside.active);
      if (busy) { setTimeout(ask, 5000); return; }
      try { global.localStorage.setItem("fc.minsk.homeAsked", "1"); } catch (e) { /* приватное окно */ }
      FC.hud.dialog([{ who: FC.MASCOT.name, face: "mascot", text: "Это настоящий Минск — дома, улицы и номера из OpenStreetMap. Хочешь найти свой дом? Телефон → «Мой дом». Адрес останется только у тебя.", face: "ogonek" }],
        function () { FC.hud.openPhone("myhome"); });
    })();
  });

  FC.map = {
    minsk: true, title: "Карта Минска", attribution: D.attribution, EDGE: 20000, HALF: 1e6, LANE: LANE, WALK: WALK,
    SEA_Z: 1e7, SEA_LINE: 1e7, BEACH_Z0: 1e7 - 10, RIVER: RIVER, RIVER_W: RIVER_W, LAKE: { x: 1e7, z: 1e7, r: 0 },
    mapBounds: [BX0, BZ0, BX1, BZ1], mapScale: 0.1, paintBase: paintBase, mapDetail: detail, mapLabels: drawLabels,
    XS: [], ZS: [], VROADS: [], HROADS: [], nodes: NODES, edges: EDGES, blocks: BLOCKS, buildings: BUILDINGS,
    districts: DISTRICTS, places: PLACES, DIST: DIST, zones: ZONE_B, pois: POIS, homes: HOMES, hq: HQ, plaza: plaza, props: PROPS,
    start: { x: SX, z: SZ }, airfield: D.airfield, metro: D.metro, marks: D.marks, quiet: quiet, gov: gov,
    district: district, water: water, riverD: riverD, field: field, onRoad: onRoad, blockAt: blockAt, buildingAt: buildingAt,
    collide: collide, near: near, addProp: addProp, removeProp: removeProp, other: other, lanePoint: lanePoint, axisPoint: axisPoint,
    nearestNode: nearestNode, nearestLane: nearestLane, nearestEdge: nearestEdge, edgesNear: edgesNear, roadRoute: roadRoute,
    walkRoute: walkRoute, sidewalkPoint: sidewalkPoint, walkBlock: walkBlock, polyAt: polyAt, recordOf: recordOf, signal: signal,
    poi: function (kind, x, z) {
      var l = POIS.filter(function (B) { return B.poi === kind; });
      if (x != null) l.sort(function (a, b) { return FC.dist2(a.x, a.z, x, z) - FC.dist2(b.x, b.z, x, z); });
      return l[0] || null;
    },
    homeOf: function (house) { return HOMES.length ? HOMES[((house % HOMES.length) + HOMES.length) % HOMES.length] : null; },
    findAddress: function (q) { return loadAddr().then(function () { return findAddr(q); }); },
    dispose: function () {}
  };
})(window);
