/* Флейм-Сити — «Минск 1:1»: меши города из OpenStreetMap суперкусками по 1 км (данные — client/minsk/s_*.json,
 * конвертер tools/minsk-osm.py; © участники OpenStreetMap, ODbL). Работает только в Минске (FC_CITY === "minsk").
 *
 * Задача: «чтобы люди видели свои районы, свои дома, всё узнаваемое, прям как реально в Минске;
 * проспекты, движение машин». Что строится здесь (по исследованию облика районов и домов):
 *  • дома — настоящий контур и этажность; семейство из конвертера (хрущёвка, панелька М-464, «свечка», сталинка, новые КПД,
 *    стекло, историческое ядро, частный дом, промзона…) → фасад шейдером FC.gfx.mat.facade (ветка «Минск», виды 20+):
 *    атрибуты aFac (семейство, сид, этажей, витрина), aCol (цвет стены, вариант), aWall (метры вдоль стены, длина стены,
 *    низ и верх стены) — окна подогнаны под длину стены и число этажей;
 *  • крыши по семейству и тегам: плоская чёрная с будками лифтов над подъездами, вальма на любом контуре (отступ-«скат»
 *    по прямому скелету), двускатная и вальмовая по прямоугольнику, шатёр, купол, луковица; цвет — OSM или семейства;
 *  • подъезды OSM — козырёк, дверь, номер; магазины OSM на первых этажах — витрина в шейдере и вывеска категории;
 *    адресная табличка «ул. X, 5» на углу у улицы (нейтральная, тёмно-синяя);
 *  • улица: тротуары с бордюром (без тротуара на разделительной у раздельных полотен), «зебры» по переходам OSM,
 *    троллейбусные провода и опоры по trolley_wire, фонари по точкам OSM, остановки с павильонами, спуски в метро с
 *    красной «М», деревья: аллеи, дворы (выше пятиэтажек), парки — четыре породы; машины во дворах вдоль проездов;
 *  • мягкое затенение земли у стен (AO), город за туманом.
 * Суперкусок — меши: дома, дороги (шейдер разметки), «плоское» (газоны, стоянки, тротуары, бордюры, зебры, козырьки,
 * крыши-формы), вода; ближние куски — ещё надписи (вывески, таблички) и тень у стен. Деревья, фонари, опоры, остановки,
 * метро, светофоры — общие инстансы на город. Кольцо загрузки — по качеству графики; сборка куска — кусочками за кадр.
 *
 * FC.osm: {ready, root, collide(x, z, r), itemAt(x, z, pad), near(x, z, r) → контуры, water(x, z), chunksLoaded(),
 *   mask(x, z, r), maskPoly(pts) — убрать дома OSM в маске (ориентиры рисует flandmarks.js), metro() → входы, debug}
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE, G = FC.gfx, D = global.MINSK;
  if (global.FC_CITY !== "minsk" || !D) return;
  var M = FC.map;
  var BASE = "minsk/", SUP = D.sup, LV = G.Q.level, DELTA = (D.fmt || 1) >= 2;
  var R_LOAD = LV === "low" ? 900 : LV === "mid" ? 1300 : 1800, R_DROP = R_LOAD + 700, R_NEAR = LV === "low" ? 380 : 650;
  var TREES_MAX = LV === "low" ? 1600 : LV === "mid" ? 3600 : 6500, LAMPS_MAX = LV === "low" ? 450 : 1100;
  var PARK_MAX = LV === "low" ? 14 : LV === "mid" ? 34 : 56;
  var useTex = typeof G.facadeTex === "function";
  if (useTex) G.facadeTex(true);

  var root = new T.Group(); root.name = "minsk"; G.add(root);
  var facadeMat = G.mat.facade(), roadMat = G.mat.road(), waterMat = G.mat.water();
  var flatMat = G.mat.ground ? G.mat.ground() : new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  var treeMat = G.mat.tree ? G.mat.tree() : new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  var lampMat = new T.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.5, metalness: 0.5 });
  var lampHeadMat = new T.MeshStandardMaterial({ color: 0xdfe3e6, roughness: 0.4, emissive: 0xffe9c8, emissiveIntensity: 0 });
  var aoMat = new T.MeshBasicMaterial({ color: 0x000000, vertexColors: true, transparent: true, depthWrite: false, fog: true });
  var wireMat = new T.MeshBasicMaterial({ color: 0x1a1c1e, side: T.DoubleSide });
  // подложка-земля: 8×8 км за фокусом камеры, отодвинута в глубине (polygonOffset) — плоскость 60 км с вершинами за
  // десятки километров на телефонах и в SwiftShader перекрывала дороги и газоны при взгляде вдоль улицы (найдено 22.11)
  var groundMat = G.mat.groundPlane ? G.mat.groundPlane() : new T.MeshStandardMaterial({ color: 0x5f6e4f, roughness: 1 });
  groundMat.polygonOffset = true; groundMat.polygonOffsetFactor = 4; groundMat.polygonOffsetUnits = 8;
  var ground = new T.Mesh(new T.PlaneGeometry(8000, 8000, 8, 8), groundMat);
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.06; ground.receiveShadow = G.Q.shadows; ground.frustumCulled = false; root.add(ground);

  /* ---- цвета ------------------------------------------------------------------------------------------------ */
  function lin(c) { return Math.pow(c / 255, 2.2); }
  // цвет вершин three считает линейным: sRGB-HEX переводим, иначе всё «выбелено» (так было до 22.11)
  function linOf(hex) { return [lin((hex >> 16) & 255), lin((hex >> 8) & 255), lin(hex & 255)]; }
  var rgbOf = linOf;
  var C = { park: rgbOf(0x5a7f45), parking: rgbOf(0x5f6266), square: rgbOf(0x9a948b), walk: rgbOf(0x9b9893), walkC: rgbOf(0x8e8a84),
    path: rgbOf(0xa9a08a), rail: rgbOf(0x3b3430), tram: rgbOf(0x4a4440), roofTile: rgbOf(0x8a4b3a), roofGrey: rgbOf(0x5b5e63),
    gold: rgbOf(0xd8b04a), green: rgbOf(0x4f7d4a), tin: rgbOf(0x8d8f93), curb: rgbOf(0xa5a39d), zebra: rgbOf(0xe8e8e2),
    canopy: rgbOf(0x9a9893), door: rgbOf(0x3a3532), doorM: rgbOf(0x5a5f63), plate: rgbOf(0x1f3a5f), median: rgbOf(0x5f7a48),
    stopLine: rgbOf(0xe8e8e2) };

  /* ---- семейства (коды — tools/minsk-osm.py FAM): палитры стен и крыш (HEX — оценки по фото) ---- */
  // [этаж м, цоколь+низ м, парапет м, стены…, крыши…]
  var FAMP = {
    20: { f: 3.2, b: 0.6, p: 0.8, w: [0xd8d4cc, 0xc9c4b8, 0xe2ddd2, 0xbfc3c6, 0xd6cbb6], r: [0x3a3b3d, 0x55585c] },
    21: { f: 3.6, b: 2.1, p: 1.6, w: [0xf1e2b8, 0xe8d09a, 0xf3e7c6, 0xe9d5a6, 0xefdcb0, 0xf4ead0], r: [0xb36552, 0x7e4b3b, 0x9a5a48, 0x8d8f93] },
    22: { f: 3.3, b: 0.8, p: 0.9, w: [0xe6d3a3, 0xd9c49a, 0xe8c3b0, 0xe9dcc0, 0xd8c8a8, 0xdfd3b8], r: [0xa0523f, 0x8a8d90, 0x7e4b3b, 0x6f7275] },
    23: { f: 2.8, b: 0.9, p: 0.6, w: [0xb7b4ad, 0xe6e4de, 0xd9d6cf, 0xc9c5bd, 0xdcd8cf, 0xd8cfc2, 0xcdd6cf], r: [0x2b2b2b, 0x3a3a3a] },
    24: { f: 2.8, b: 0.9, p: 0.5, w: [0xd9d6cf, 0xc9c5bd, 0xe6e4de, 0xdcd3c5], r: [0x6f7275, 0x8a8d90, 0x7e5a4a] },
    25: { f: 2.8, b: 0.9, p: 1.3, w: [0xa9a69f, 0xbdbab3, 0xc8c5be, 0xb3b0a8, 0xd2cfc8], r: [0x2b2b2b, 0x333436] },
    26: { f: 2.8, b: 1.0, p: 2.4, w: [0xe9e8e4, 0xd6d5d0, 0xc9c8c3, 0xdedbd2], r: [0x2b2b2b, 0x3d3e40] },
    27: { f: 2.9, b: 0.9, p: 1.2, w: [0xc9c6bf, 0xd8d5ce, 0xb9b6af, 0xe0dcd2, 0xd4cbbd], r: [0x2b2b2b, 0x444547] },
    28: { f: 3.0, b: 1.4, p: 1.6, w: [0xededea, 0xe6e4df, 0xf2f0ea, 0xe0ddd5], r: [0x4a4d51, 0x5a5d61] },
    29: { f: 3.1, b: 1.6, p: 2.2, w: [0xe4e2dc, 0xd3d0c8, 0xc9c7c2, 0xd8cdb8, 0xc4c8cc], r: [0x4a4d51, 0x3a3d42] },
    30: { f: 3.7, b: 0.8, p: 1.2, w: [0x9dbfd8, 0x5f8fa3, 0x2d3358, 0x7fafb0, 0x6c8fa8, 0x8aa2b2], r: [0x3a3d42, 0x55585c] },
    31: { f: 3.8, b: 0.6, p: 0.8, w: [0xedc278, 0xfeb08c, 0xfebaad, 0xf2d5ad, 0xcfe3c8, 0xc8dcef, 0xf6e7b4, 0xf3efe6], r: [0xc6683d, 0xb85c35, 0x599784, 0xa8553a] },
    32: { f: 5.0, b: 0.3, p: 0.8, w: [0x9b4a35, 0x6e3b2e, 0x9c9a94, 0xb0aca2, 0x8a8f93, 0xa89f90], r: [0x5e5f5c, 0x6e6e6a, 0x4f5052] },
    33: { f: 3.0, b: 0.5, p: 0.2, w: [0xd9c8a0, 0xc7b199, 0xe6e2d6, 0xa9b8a0, 0xc9a47e, 0xb8c4cc, 0xe0d0b8, 0xa0705a], r: [0x7a3e32, 0x4f5459, 0x6b4a3a, 0x8a3b2c, 0x3f5a4a] },
    34: { f: 3.4, b: 0.8, p: 0.8, w: [0xe7e5df, 0xdcdad3, 0xefe9dc, 0xe3ddd0], r: [0x3b3d40, 0x4a4c4f] },
    35: { f: 4.5, b: 0.6, p: 0.6, w: [0xf3f1ea, 0xefe6d0, 0xf6f0e2], r: [0x4f7d6a, 0x8d8f93, 0xb36552] },
    36: { f: 2.8, b: 0.0, p: 0.3, w: [0x8d8f93, 0xa7a49d, 0x7f7f7a, 0xb9b3a6, 0x9a8f82], r: [0x4a4b4d, 0x5a5b5d] },
    37: { f: 3.6, b: 0.8, p: 1.0, w: [0xc9c7c2, 0xd8cdb8, 0xb8bcc0, 0xe0ddd5, 0xcfc6b5], r: [0x3a3b3d, 0x4a4c4f] }
  };
  function famP(f) { return FAMP[f] || FAMP[20]; }

  /* ---- накопитель вершин ------------------------------------------------------------------------------------ */
  function Acc(fac) { return { p: [], n: [], c: fac ? null : [], f: fac ? [] : null, k: fac ? [] : null, w: fac ? [] : null }; }
  var W0 = [0, 0, 0, 0];
  function vtx(a, x, y, z, nx, ny, nz, col, fac, kol, wl) {
    a.p.push(x, y, z); a.n.push(nx, ny, nz);
    if (a.c) a.c.push(col[0], col[1], col[2]);
    if (a.f) { a.f.push(fac[0], fac[1], fac[2], fac[3]); a.k.push(kol[0], kol[1], kol[2], kol[3]); wl = wl || W0; a.w.push(wl[0], wl[1], wl[2], wl[3]); }
  }
  // треугольник с нормалью по обходу; hint — куда должна смотреть (переворачиваем, если против)
  function tri(a, A, B, Cc, col, fac, kol, hint) {
    var ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = Cc[0] - A[0], vy = Cc[1] - A[1], vz = Cc[2] - A[2];
    var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (hint && nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { var t = B; B = Cc; Cc = t; nx = -nx; ny = -ny; nz = -nz; }
    vtx(a, A[0], A[1], A[2], nx, ny, nz, col, fac, kol); vtx(a, B[0], B[1], B[2], nx, ny, nz, col, fac, kol); vtx(a, Cc[0], Cc[1], Cc[2], nx, ny, nz, col, fac, kol);
  }
  function quad(a, A, B, Cc, Dd, col, hint) { tri(a, A, B, Cc, col, null, null, hint); tri(a, A, Cc, Dd, col, null, null, hint); }
  // коробка с цветом вершин (козырьки, будки): центр, ось u (вдоль), размеры
  function boxC(a, cx, y0, cz, ux, uz, L, Wd, H, col) {
    var vx = -uz, vz = ux, hl = L / 2, hw = Wd / 2, y1 = y0 + H;
    function P(u, v, y) { return [cx + ux * u + vx * v, y, cz + uz * u + vz * v]; }
    var c = [P(-hl, -hw, 0), P(hl, -hw, 0), P(hl, hw, 0), P(-hl, hw, 0)];
    for (var i = 0; i < 4; i++) {
      var A = c[i], B = c[(i + 1) % 4], mx = (A[0] + B[0]) / 2 - cx, mz = (A[2] + B[2]) / 2 - cz;
      quad(a, [A[0], y0, A[2]], [B[0], y0, B[2]], [B[0], y1, B[2]], [A[0], y1, A[2]], col, [mx, 0, mz]);
    }
    quad(a, [c[0][0], y1, c[0][2]], [c[1][0], y1, c[1][2]], [c[2][0], y1, c[2][2]], [c[3][0], y1, c[3][2]], col, [0, 1, 0]);
    quad(a, [c[0][0], y0, c[0][2]], [c[1][0], y0, c[1][2]], [c[2][0], y0, c[2][2]], [c[3][0], y0, c[3][2]], col, [0, -1, 0]);
  }
  function geoOf(a) {
    if (!a.p.length) return null;
    var g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(a.p, 3));
    g.setAttribute("normal", new T.Float32BufferAttribute(a.n, 3));
    if (a.c) g.setAttribute("color", new T.Float32BufferAttribute(a.c, a.c4 ? 4 : 3));
    if (a.f) { g.setAttribute("aFac", new T.Float32BufferAttribute(a.f, 4)); g.setAttribute("aCol", new T.Float32BufferAttribute(a.k, 4)); g.setAttribute("aWall", new T.Float32BufferAttribute(a.w, 4)); }
    if (a.uv) g.setAttribute("uv", new T.Float32BufferAttribute(a.uv, 2));
    return g;
  }

  /* ---- триангуляция многоугольника (отсечение ушей; контуры OSM — по часовой в x-z, нормаль вверх) ---------- */
  function inTri(p, a, b, c) {
    var d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
    var d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
    var d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  }
  function signedA(p) { var s = 0; for (var i = 0; i < p.length; i++) { var j = (i + 1) % p.length; s += p[i][0] * p[j][1] - p[j][0] * p[i][1]; } return s / 2; }
  function earclip(p) {
    var idx = [], out = [], i;
    for (i = 0; i < p.length; i++) idx.push(i);
    if (signedA(p) > 0) idx.reverse();                  // работаем по часовой
    var guard = 0;
    while (idx.length > 3 && guard++ < 4000) {
      var found = false, L = idx.length;
      for (var k = 0; k < L; k++) {
        var i0 = idx[(k + L - 1) % L], i1 = idx[k], i2 = idx[(k + 1) % L], a = p[i0], b = p[i1], c = p[i2];
        var cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if (cr >= 0) continue;
        var bad = false;
        if (L > 4) for (var m = 0; m < L; m++) { var q = idx[m]; if (q === i0 || q === i1 || q === i2) continue; if (inTri(p[q], a, b, c)) { bad = true; break; } }
        if (bad) continue;
        out.push(i0, i1, i2); idx.splice(k, 1); found = true; break;
      }
      if (!found) break;
    }
    if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
    else for (i = 1; i < idx.length - 1; i++) out.push(idx[0], idx[i], idx[i + 1]);
    return out;
  }
  function flatPoly(a, p, y, col) {
    var t = earclip(p);
    for (var i = 0; i < t.length; i += 3) {
      var A = p[t[i]], B = p[t[i + 1]], Cc = p[t[i + 2]];
      tri(a, [A[0], y, A[1]], [B[0], y, B[1]], [Cc[0], y, Cc[1]], col, null, null, [0, 1, 0]);
    }
  }
  // точки из данных: абсолютные дециметры (старый формат) или приращения (fmt 2)
  function pts(arr) {
    var out = [], x = 0, z = 0;
    for (var i = 0; i < arr.length; i += 2) {
      if (DELTA && i) { x += arr[i]; z += arr[i + 1]; } else { x = arr[i]; z = arr[i + 1]; }
      out.push([x / 10, z / 10]);
    }
    return out;
  }
  function centroid(p) { var x = 0, z = 0; p.forEach(function (q) { x += q[0]; z += q[1]; }); return [x / p.length, z / p.length]; }
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
      if (!best || A < best.A) best = { A: A, ux: ux, uz: uz, L: a1 - a0, W: b1 - b0, ca: (a0 + a1) / 2, cb: (b0 + b1) / 2 };
    }
    if (!best) return null;
    best.x = best.ca * best.ux - best.cb * best.uz; best.z = best.ca * best.uz + best.cb * best.ux;
    if (best.W > best.L) { var t = best.L; best.L = best.W; best.W = t; var ux2 = -best.uz; best.uz = best.ux; best.ux = ux2; }
    return best;
  }
  // упрощение кольца для крыши: убрать короткие рёбра и почти прямые углы (ступеньки в контуре ломают скат)
  function roofRing(p) {
    var q = p.slice(), changed = true, guard = 0;
    while (changed && q.length > 3 && guard++ < 50) {
      changed = false;
      for (var i = 0; i < q.length && q.length > 3; i++) {
        var a = q[(i + q.length - 1) % q.length], b = q[i], c = q[(i + 1) % q.length];
        var e1x = b[0] - a[0], e1z = b[1] - a[1], e2x = c[0] - b[0], e2z = c[1] - b[1], l1 = Math.hypot(e1x, e1z), l2 = Math.hypot(e2x, e2z);
        var cr = Math.abs(e1x * e2z - e1z * e2x) / Math.max(1e-6, l1 * l2);
        if (l2 < 1.6 || cr < 0.12) { q.splice(i, 1); changed = true; break; }
      }
    }
    return q;
  }
  function pipP(x, z, p) {
    var inside = false;
    for (var i = 0, j = p.length - 1; i < p.length; j = i++) {
      var xi = p[i][0], zi = p[i][1], xj = p[j][0], zj = p[j][1];
      if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
    }
    return inside;
  }
  function segDist(x, z, ax, az, bx, bz) {
    var ex = bx - ax, ez = bz - az, L = ex * ex + ez * ez || 1e-9, t = ((x - ax) * ex + (z - az) * ez) / L;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(x - ax - ex * t, z - az - ez * t);
  }

  /* ---- надписи: атлас глифов (вывески, адресные таблички, номера подъездов) — один материал на все ------------- */
  var GLYPHS = "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюяІіЎўABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,-/«»()№'\"!:+&@%#’";
  var GL = { cols: 16, cell: 64, map: {}, tex: null, mat: null };
  (function glyphAtlas() {
    var rows = Math.ceil(GLYPHS.length / GL.cols), cv = document.createElement("canvas");
    cv.width = GL.cols * GL.cell; cv.height = rows * GL.cell;
    var x = cv.getContext("2d");
    x.font = "600 46px system-ui, -apple-system, Segoe UI, Roboto, sans-serif"; x.textBaseline = "middle"; x.textAlign = "center";
    x.fillStyle = "#fff";
    for (var i = 0; i < GLYPHS.length; i++) {
      var ch = GLYPHS[i], cx = (i % GL.cols) * GL.cell, cy = Math.floor(i / GL.cols) * GL.cell;
      x.fillText(ch, cx + GL.cell / 2, cy + GL.cell / 2 + 2);
      GL.map[ch] = { u0: cx / cv.width, v0: 1 - (cy + GL.cell) / cv.height, u1: (cx + GL.cell) / cv.width, v1: 1 - cy / cv.height,
        adv: Math.max(0.28, Math.min(1, x.measureText(ch).width / GL.cell + 0.06)) };
    }
    GL.rows = rows;
    GL.tex = new T.CanvasTexture(cv); GL.tex.colorSpace = T.SRGBColorSpace; GL.tex.anisotropy = 4;
    GL.mat = new T.MeshStandardMaterial({ map: GL.tex, vertexColors: true, alphaTest: 0.45, roughness: 0.7,
      emissive: 0xffffff, emissiveMap: GL.tex, emissiveIntensity: 0.05 });
  })();
  function textWidth(s, size) { var w = 0; for (var i = 0; i < s.length; i++) { var g = GL.map[s[i]] || GL.map["."]; w += g.adv * size; } return w; }
  // строка на вертикальной плоскости: центр (cx, cy, cz), направление письма (ux, uz), нормаль наружу (nx, nz)
  function textLine(acc, s, cx, cy, cz, ux, uz, nx, nz, size, col) {
    var w = textWidth(s, size), u = -w / 2;
    for (var i = 0; i < s.length; i++) {
      var g = GL.map[s[i]] || GL.map["."], adv = g.adv * size, mid = u + adv / 2, hs = size / 2;
      if (s[i] !== " ") {
        var x0 = cx + ux * (mid - hs), z0 = cz + uz * (mid - hs), x1 = cx + ux * (mid + hs), z1 = cz + uz * (mid + hs);
        var b = acc.p.length / 3;
        acc.p.push(x0, cy - hs, z0, x1, cy - hs, z1, x1, cy + hs, z1, x0, cy + hs, z0);
        for (var k = 0; k < 4; k++) { acc.n.push(nx, 0, nz); acc.c.push(col[0], col[1], col[2]); }
        acc.uv.push(g.u0, g.v0, g.u1, g.v0, g.u1, g.v1, g.u0, g.v1);
        acc.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
      u += adv;
    }
    return w;
  }
  function TextAcc() { return { p: [], n: [], c: [], uv: [], idx: [] }; }
  function textGeo(a) {
    if (!a.p.length) return null;
    var g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(a.p, 3)); g.setAttribute("normal", new T.Float32BufferAttribute(a.n, 3));
    g.setAttribute("color", new T.Float32BufferAttribute(a.c, 3)); g.setAttribute("uv", new T.Float32BufferAttribute(a.uv, 2));
    g.setIndex(a.idx);
    return g;
  }
  // вывески категорий (tools/minsk-osm.py SIGNS): фон и цвет текста — нейтральные, без брендов
  var SIGN_BG = [0x2a7d3c, 0x1d9a54, 0x6b3f22, 0x5a1f22, 0x1a1020, 0xb0447a, 0xc2457a, 0x1f4f8a, 0x333a48, 0xb98a3a, 0x3d5a80,
    0x2f6f5a, 0x1f4f8a, 0x5a4a3a, 0x2a6f9a, 0x5a3a8a, 0xd0402a, 0x2c6bb8, 0x2a8a9a, 0x6a8a2a, 0x2a3a5a, 0x8a5a2a, 0x7a2a5a,
    0x6a1f2f, 0x5a4a3a, 0xd07a2a];

  /* ---- дом «Минск»: стены с атрибутами фасада, крыша, подъезды, витрины, табличка ----------------------------- */
  // ряд: [id, h, mh, вид, контур, имя, флаги, стена, крыша, форма, высота крыши, стиль, семейство, важный, этажей,
  //       подъезды, магазины, адрес]
  function wallsOf(A, p, mh, top, fac, kol, shopWalls) {
    for (var i = 0; i < p.length; i++) {
      var a = p[i], c = p[(i + 1) % p.length], dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz);
      if (l < 0.05) continue;
      var nx = -dz / l, nz = dx / l, f = fac;
      if (shopWalls && shopWalls[i]) f = [fac[0], fac[1], fac[2], 1];
      var w0 = [0, l, mh, top], w1 = [l, l, mh, top];
      vtx(A, a[0], mh, a[1], nx, 0, nz, null, f, kol, w0); vtx(A, c[0], mh, c[1], nx, 0, nz, null, f, kol, w1); vtx(A, c[0], top, c[1], nx, 0, nz, null, f, kol, w1);
      vtx(A, a[0], mh, a[1], nx, 0, nz, null, f, kol, w0); vtx(A, c[0], top, c[1], nx, 0, nz, null, f, kol, w1); vtx(A, a[0], top, a[1], nx, 0, nz, null, f, kol, w0);
    }
  }
  function capOf(A, p, y, fac, kol, down) {
    var t = earclip(p), w = [0, 0, y, y];
    for (var k = 0; k < t.length; k += 3) {
      var P0 = p[t[k]], P1 = p[t[k + 1]], P2 = p[t[k + 2]];
      tri(A, [P0[0], y, P0[1]], [P1[0], y, P1[1]], [P2[0], y, P2[1]], null, fac, kol, [0, down ? -1 : 1, 0]);
      for (var q = A.w.length - 12; q < A.w.length; q += 4) { A.w[q] = w[0]; A.w[q + 1] = w[1]; A.w[q + 2] = w[2]; A.w[q + 3] = w[3]; }
    }
  }
  // вальма на любом контуре: «скаты» от стен внутрь до отступа d (митра), сверху — плоская часть (у широких сталинок так
  // и есть). d — до схлопывания самого короткого ребра; на прямоугольнике — честная вальма с коньком.
  function insetRoof(R, p0, y0, slope, maxD, col) {
    var p = roofRing(p0); if (p.length < 3) return 0;
    var n = p.length, s = signedA(p) > 0 ? -1 : 1, mit = [], i;
    for (i = 0; i < n; i++) {
      var a = p[(i + n - 1) % n], b = p[i], c = p[(i + 1) % n];
      var d1x = b[0] - a[0], d1z = b[1] - a[1], l1 = Math.hypot(d1x, d1z) || 1, d2x = c[0] - b[0], d2z = c[1] - b[1], l2 = Math.hypot(d2x, d2z) || 1;
      // внутрь: для контура по часовой (s = 1) — (dz, −dx)
      var n1x = d1z / l1 * s, n1z = -d1x / l1 * s, n2x = d2z / l2 * s, n2z = -d2x / l2 * s, dt = 1 + n1x * n2x + n1z * n2z;
      if (dt < 0.3) return 0;
      mit.push([(n1x + n2x) / dt, (n1z + n2z) / dt]);
    }
    var dmax = maxD;
    for (i = 0; i < n; i++) {
      var j = (i + 1) % n, ex = p[j][0] - p[i][0], ez = p[j][1] - p[i][1], L = Math.hypot(ex, ez) || 1e-6;
      var rate = ((mit[j][0] - mit[i][0]) * ex + (mit[j][1] - mit[i][1]) * ez) / L;
      if (rate < -1e-6) dmax = Math.min(dmax, L / -rate);
    }
    var d = dmax * 0.995;
    if (d < 1.0) return 0;
    var q = [];
    for (i = 0; i < n; i++) q.push([p[i][0] + mit[i][0] * d, p[i][1] + mit[i][1] * d]);
    for (i = 0; i < n; i++) if (!pipP(q[i][0] + (q[(i + 1) % n][0] - q[i][0]) * 0.5, q[i][1] + (q[(i + 1) % n][1] - q[i][1]) * 0.5, p) && Math.hypot(q[(i + 1) % n][0] - q[i][0], q[(i + 1) % n][1] - q[i][1]) > 0.3) return 0;
    var y1 = y0 + d * slope, cc = centroid(p);
    for (i = 0; i < n; i++) {
      var j2 = (i + 1) % n, A = [p[i][0], y0, p[i][1]], B = [p[j2][0], y0, p[j2][1]], Cq = [q[j2][0], y1, q[j2][1]], Dq = [q[i][0], y1, q[i][1]];
      var hx = (p[i][0] + p[j2][0]) / 2 - cc[0], hz = (p[i][1] + p[j2][1]) / 2 - cc[1];
      var mx = -(mit[i][0] + mit[j2][0]), mz = -(mit[i][1] + mit[j2][1]), ml = Math.hypot(mx, mz) || 1;
      var hint = [mx / ml, d * slope / Math.max(d, 0.1), mz / ml];
      if (!(hx || hz)) hint = [0, 1, 0];
      tri(R, A, B, Cq, col, null, null, hint); if (Math.hypot(Dq[0] - Cq[0], Dq[2] - Cq[2]) > 0.02) tri(R, A, Cq, Dq, col, null, null, hint);
    }
    if (Math.abs(signedA(q)) > 2) flatPoly(R, q, y1, col);
    return d * slope;
  }
  function roofColor(b, fam, shape) {
    var rc = b[8];
    if (rc >= 0) return rgbOf(rc);
    if (fam >= 20) { var R = famP(fam).r; return rgbOf(R[(b[0] >> 2) % R.length]); }
    return (shape === 3 || shape === 4) ? (b[3] === "church" ? (b[0] % 3 ? C.gold : C.green) : C.tin) : shape === 5 ? C.roofGrey : (b[3] === "house" || b[0] % 2 ? C.roofTile : C.roofGrey);
  }
  // стены, обращённые к проспекту (у сталинок, новостроек, офисов — магазины по всему первому этажу)
  function avenueWalls(p) {
    var out = null;
    for (var i = 0; i < p.length; i++) {
      var a = p[i], c = p[(i + 1) % p.length], dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz);
      if (l < 8) continue;
      var nx = -dz / l, nz = dx / l, mx = (a[0] + c[0]) / 2 + nx * 14, mz = (a[1] + c[1]) / 2 + nz * 14;
      var es = M.edgesNear(mx, mz, 24);
      for (var k = 0; k < es.length; k++) {
        var e = es[k]; if (e.kind === "st") continue;
        for (var s = 1; s < e.px.length; s++) {
          if (segDist(mx, mz, e.px[s - 1], e.pz[s - 1], e.px[s], e.pz[s]) < e.w / 2 + 16) { (out || (out = {}))[i] = 1; s = 1e9; k = 1e9; }
        }
      }
    }
    return out;
  }
  function nearestWall(p, x, z, minL) {
    var best = -1, bd = 1e9;
    for (var i = 0; i < p.length; i++) {
      var a = p[i], c = p[(i + 1) % p.length];
      if (Math.hypot(c[0] - a[0], c[1] - a[1]) < (minL || 0)) continue;
      var d = segDist(x, z, a[0], a[1], c[0], c[1]);
      if (d < bd) { bd = d; best = i; }
    }
    return best < 0 ? null : { i: best, d: bd };
  }
  function wallFrame(p, i, x, z) {        // проекция точки на стену i: позиция, касательная, наружная нормаль, t
    var a = p[i], c = p[(i + 1) % p.length], dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz) || 1;
    var ux = dx / l, uz = dz / l, t = FC.clamp(((x - a[0]) * ux + (z - a[1]) * uz), Math.min(1.4, l / 2), Math.max(l - 1.4, l / 2));
    return { x: a[0] + ux * t, z: a[1] + uz * t, ux: ux, uz: uz, nx: -uz, nz: ux, t: t, l: l };
  }
  function buildingM(b, J, p0) {
    var p = p0 || pts(b[4]); if (p.length < 3) return;
    var fam = b[12], FP = famP(fam), h = b[1], mh = b[2], shape = b[9], seed = b[0] % 997, lv = Math.max(1, b[14] || 1);
    var wc = b[7] >= 0 ? b[7] : FP.w[(b[0] >> 3) % FP.w.length], wl = linOf(wc);
    var variant = (b[0] >> 5) % 8;
    var kol = [wl[0], wl[1], wl[2], variant];
    var o = obb(p), rect = o ? Math.abs(signedA(p)) / Math.max(1, o.L * o.W) : 0, rh = 0, top = h;
    var rcol = roofColor(b, fam, shape);
    // части зданий: этажи по высоте части
    var floors = mh > 2.5 ? Math.max(1, Math.round((h - mh) / FP.f)) : lv;
    // крыша: по прямоугольнику (почти прямоугольный контур) или «скатами внутрь» на любом контуре
    var pitched = (shape === 1 || shape === 2 || shape === 7) && o;
    var rectRoof = pitched && rect > 0.86 && p.length <= 10;
    if (shape === 6) shape = 0;
    if (pitched && !rectRoof) {
      var slope = fam === 33 ? 0.75 : fam === 31 ? 0.8 : 0.55;
      var maxD = Math.min(7.5, (h - mh) * 0.45 / slope);
      top = h - Math.min(maxD * slope, (h - mh) * 0.4);
      var used = insetRoof(J.R, p, top, slope, Math.max(1.2, (h - top) / slope), rcol);
      if (!used) { shape = 0; top = h; } else shape = -1;
    } else if (shape && o) {
      rh = b[10] || (shape === 3 || shape === 4 ? Math.min(o.W, o.L) * (shape === 4 ? 0.9 : 0.5) : shape === 5 ? Math.min(o.W * 0.5, 8) :
        Math.min(o.W * (fam === 33 || h < 18 ? 0.36 : 0.26), 6.5));
      rh = Math.min(rh, (h - mh) * 0.7);
      top = h - rh;
    } else shape = 0;
    var shopWalls = null;
    if (b[16] && b[16].length) {
      shopWalls = {};
      for (var s = 0; s < b[16].length; s += 3) { var nw = nearestWall(p, b[16][s] / 10, b[16][s + 1] / 10, 3); if (nw && nw.d < 14) shopWalls[nw.i] = 1; }
    }
    if ((fam === 21 || fam === 28 || fam === 29 || fam === 37 || fam === 30) && floors >= 3 && mh < 1) {
      var av = avenueWalls(p); if (av) { shopWalls = shopWalls || {}; for (var k0 in av) shopWalls[k0] = 1; }
    }
    var fac = [fam, seed, floors, 0];
    wallsOf(J.A, p, mh, top, fac, kol, shopWalls);
    var rk = [rcol[0], rcol[1], rcol[2], 8];
    if (!shape) {
      capOf(J.A, p, top, fac, rk, false);
      if (mh > 2.5) capOf(J.A, p, mh, fac, kol, true);
    } else if (shape > 0) roof(J.R, p, o, shape, top, rh, b, rcol);
    // подъезды: козырёк, дверь, номер; будки лифтов над подъездами у 9+ этажей
    var ents = b[15];
    if (ents && ents.length && mh < 1) {
      for (var e = 0; e < ents.length; e += 4) {
        var ex = ents[e] / 10, ez = ents[e + 1] / 10, ref = ents[e + 2], nwi = nearestWall(p, ex, ez, 2.4);
        if (!nwi || nwi.d > 2) continue;
        var fr = wallFrame(p, nwi.i, ex, ez), main = ents[e + 3] === 2;
        var dw = main ? 1.9 : 1.4, dh = main ? 2.5 : 2.2;
        quad(J.F, [fr.x - fr.ux * dw / 2 + fr.nx * 0.04, 0.05, fr.z - fr.uz * dw / 2 + fr.nz * 0.04], [fr.x + fr.ux * dw / 2 + fr.nx * 0.04, 0.05, fr.z + fr.uz * dw / 2 + fr.nz * 0.04],
          [fr.x + fr.ux * dw / 2 + fr.nx * 0.04, dh, fr.z + fr.uz * dw / 2 + fr.nz * 0.04], [fr.x - fr.ux * dw / 2 + fr.nx * 0.04, dh, fr.z - fr.uz * dw / 2 + fr.nz * 0.04],
          fam === 21 || fam === 31 ? C.door : C.doorM, [fr.nx, 0, fr.nz]);
        if (h > 6) {
          boxC(J.F, fr.x + fr.nx * 0.7, dh + 0.35, fr.z + fr.nz * 0.7, fr.ux, fr.uz, dw + 1.0, 1.4, 0.16, C.canopy);
          if (floors < 9) boxC(J.F, fr.x + fr.nx * 0.55, 0.0, fr.z + fr.nz * 0.55, fr.ux, fr.uz, dw + 1.2, 1.1, 0.16, C.curb);  // крыльцо
        }
        if (ref > 0) J.labels.push({ k: "ent", s: String(ref), x: fr.x + fr.nx * 0.07, y: dh + 0.85, z: fr.z + fr.nz * 0.07, ux: fr.ux, uz: fr.uz, nx: fr.nx, nz: fr.nz });
        if (floors >= 9 && !shape && h > 24) {       // машинное отделение лифта на крыше над подъездом
          var dIn = 4.2, lx = fr.x - fr.nx * dIn, lz = fr.z - fr.nz * dIn;
          if (pipP(lx, lz, p)) boxC(J.F, lx, top, lz, fr.ux, fr.uz, 3.2, 4.4, 2.5, C.canopy);
        }
      }
    }
    // магазины: вывеска над витриной на ближайшей стене
    if (b[16] && b[16].length && mh < 1) {
      var placed = [];                       // вывески этого дома: стена, позиция вдоль неё, ширина — чтобы не налезали друг на друга
      for (var sh = 0; sh < b[16].length; sh += 3) {
        var sx = b[16][sh] / 10, sz = b[16][sh + 1] / 10, nw2 = nearestWall(p, sx, sz, 4);
        if (!nw2 || nw2.d > 14) continue;
        var f2 = wallFrame(p, nw2.i, sx, sz), txt = (D.signs || [])[b[16][sh + 2]] || "МАГАЗИН";
        // место из пакета мест (FC.places) рядом — его вывеска: настоящее название и цвета; своя вывеска места — без нашей
        var pl = FC.places && FC.places.signFor ? FC.places.signFor(sx, sz) : null;
        if (pl && pl.skip) continue;
        var sTxt = pl ? pl.s : txt, maxW = Math.min(f2.l - 1, 7), sw = Math.min(textWidth(sTxt, 0.42), maxW) + 0.5, st = f2.t;
        // занято — сдвигаем вдоль стены вправо или влево; не помещается — второй вывески на этой стене не будет
        var ok = false;
        for (var tryK = 0; tryK < 3 && !ok; tryK++) {
          var clash = null;
          for (var q = 0; q < placed.length; q++) { var o = placed[q]; if (o.i === nw2.i && Math.abs(o.t - st) < (o.w + sw) / 2 + 0.3) { clash = o; break; } }
          if (!clash) { ok = true; break; }
          var right = clash.t + (clash.w + sw) / 2 + 0.3, left = clash.t - (clash.w + sw) / 2 - 0.3;
          st = right + sw / 2 <= f2.l - 0.2 ? right : left - sw / 2 >= 0.2 ? left : -1;
          if (st < 0) break;
        }
        if (!ok) continue;
        placed.push({ i: nw2.i, t: st, w: sw });
        var sa = p[nw2.i], sxp = sa[0] + f2.ux * st, szp = sa[1] + f2.uz * st;
        (J.signs || (J.signs = [])).push([sxp + f2.nx * 0.12, fam === 21 ? 5.0 : FP.b + 3.05, szp + f2.nz * 0.12, f2.ux, f2.uz, sw]);
        J.labels.push({ k: "sign", s: sTxt, cat: b[16][sh + 2], bg: pl ? pl.bg : null, fg: pl ? pl.fg : null, x: sxp + f2.nx * 0.12, y: fam === 21 ? 5.0 : FP.b + 3.05, z: szp + f2.nz * 0.12, ux: f2.ux, uz: f2.uz, nx: f2.nx, nz: f2.nz, maxW: maxW });
      }
    }
    // адресная табличка: на стене, что ближе к улице, у правого угла, на высоте 2,8 м
    if (b[17] && mh < 1 && h > 3) {
      var best = null, bd = 1e9, cc = centroid(p), ne = M.nearestEdge(cc[0], cc[1], 60);
      if (ne) {
        var q = M.axisPoint(ne.e, ne.s / ne.e.len);
        for (var wi = 0; wi < p.length; wi++) {
          var a = p[wi], c = p[(wi + 1) % p.length], l = Math.hypot(c[0] - a[0], c[1] - a[1]);
          if (l < 4) continue;
          var d = segDist(q.x, q.z, a[0], a[1], c[0], c[1]);
          if (d < bd) { bd = d; best = wi; }
        }
      }
      if (best != null) {
        var pa = p[best], pc = p[(best + 1) % p.length], L2 = Math.hypot(pc[0] - pa[0], pc[1] - pa[1]), ux = (pc[0] - pa[0]) / L2, uz = (pc[1] - pa[1]) / L2;
        var tt = Math.max(L2 / 2, L2 - 1.6);
        J.labels.push({ k: "addr", s: b[17], x: pa[0] + ux * tt - uz * 0.06, y: Math.min(2.9, h - 0.6), z: pa[1] + uz * tt + ux * 0.06, ux: ux, uz: uz, nx: -uz, nz: ux });
      }
    }
    // тень у стен (AO): кольцо наружу 1,8 м, прозрачность 0,38 → 0
    if (h > 4 && mh < 1) J.ao.push(p);
  }
  // дом старого формата (без семейства) — как раньше
  function building(b, J, p0) {
    if (b[12] >= 20) { buildingM(b, J, p0); return; }
    var A = J.A, R = J.R;
    var p = p0 || pts(b[4]); if (p.length < 3) return;
    var h = b[1], mh = b[2], shape = b[9], kind = b[3];
    var st = useTex && b[12] ? b[12] : b[11];
    var seed = b[0] % 997, tint = 0.85 + ((b[0] >> 3) % 23) / 100;
    var shop = kind === "shop" || (h > 10 && h < 40 && (b[0] % 4) === 0 && kind !== "res") ? 1 : 0;
    var fac = [st, seed, tint, shop];
    var wc = b[7], kol = wc >= 0 ? [lin((wc >> 16) & 255), lin((wc >> 8) & 255), lin(wc & 255), 0] : [0, 0, 0, 1];
    var o = shape ? obb(p) : null, rh = 0, top = h;
    if (shape && o) {
      var rect = Math.abs(signedA(p)) / Math.max(1, o.L * o.W);
      if ((shape === 1 || shape === 2 || shape === 7) && (rect < 0.8 || p.length > 14)) shape = 5;
      if (shape === 6) shape = 0;
      if (shape) {
        rh = b[10] || (shape === 3 || shape === 4 ? Math.min(o.W, o.L) * (shape === 4 ? 0.9 : 0.5) : shape === 5 ? Math.min(o.W * 0.5, 8) :
          Math.min(o.W * (kind === "house" || h < 18 ? 0.35 : 0.22), 6));
        rh = Math.min(rh, (h - mh) * 0.7);
        top = h - rh;
      }
    } else shape = 0;
    wallsOf(A, p, mh, top, fac, kol, null);
    if (!shape) { capOf(A, p, top, fac, kol, false); if (mh > 2.5) capOf(A, p, mh, fac, kol, true); return; }
    roof(R, p, o, shape, top, rh, b, roofColor(b, 0, shape));
  }
  function roof(R, p, o, shape, y0, rh, b, col) {
    var cc = centroid(p), y1 = y0 + rh, i, k;
    if (shape === 5) {                                     // шатёр: к центру
      for (i = 0; i < p.length; i++) {
        var a = p[i], c = p[(i + 1) % p.length], mx = (a[0] + c[0]) / 2 - cc[0], mz = (a[1] + c[1]) / 2 - cc[1];
        tri(R, [a[0], y0, a[1]], [c[0], y0, c[1]], [cc[0], y1, cc[1]], col, null, null, [mx, rh * 0.5, mz]);
      }
      return;
    }
    if (shape === 3 || shape === 4) {                      // купол и луковица: тело вращения в центре
      var r = Math.max(1, Math.min(o.W, o.L) / 2 * 0.95), prof = shape === 4 ?
        [[1, 0], [1.18, 0.3], [1.05, 0.52], [0.62, 0.72], [0.2, 0.88], [0.04, 1]] : [[1, 0], [0.95, 0.31], [0.81, 0.59], [0.59, 0.81], [0.31, 0.95], [0, 1]];
      var N = 12, H = shape === 4 ? rh : Math.min(rh, r);
      var t0 = earclip(p);                                 // основание — плоская крышка, чтобы не было дыры
      for (k = 0; k < t0.length; k += 3) { var P0 = p[t0[k]], P1 = p[t0[k + 1]], P2 = p[t0[k + 2]]; tri(R, [P0[0], y0, P0[1]], [P1[0], y0, P1[1]], [P2[0], y0, P2[1]], C.tin, null, null, [0, 1, 0]); }
      for (var s = 0; s < N; s++) {
        var a0 = s / N * Math.PI * 2, a1 = (s + 1) / N * Math.PI * 2, am = (a0 + a1) / 2, hint = [Math.cos(am), 0.5, Math.sin(am)];
        for (var j = 0; j < prof.length - 1; j++) {
          var q0 = prof[j], q1 = prof[j + 1];
          var A0 = [cc[0] + Math.cos(a0) * r * q0[0], y0 + H * q0[1], cc[1] + Math.sin(a0) * r * q0[0]];
          var B0 = [cc[0] + Math.cos(a1) * r * q0[0], y0 + H * q0[1], cc[1] + Math.sin(a1) * r * q0[0]];
          var A1 = [cc[0] + Math.cos(a0) * r * q1[0], y0 + H * q1[1], cc[1] + Math.sin(a0) * r * q1[0]];
          var B1 = [cc[0] + Math.cos(a1) * r * q1[0], y0 + H * q1[1], cc[1] + Math.sin(a1) * r * q1[0]];
          tri(R, A0, B0, B1, col, null, null, hint); if (q1[0] > 0.01) tri(R, A0, B1, A1, col, null, null, hint);
        }
      }
      if (shape === 4) {                                   // шпиль
        var sy = y0 + H, sh = r * 0.9;
        for (var z = 0; z < 4; z++) {
          var b0 = z / 4 * Math.PI * 2, b1 = (z + 1) / 4 * Math.PI * 2;
          tri(R, [cc[0] + Math.cos(b0) * 0.12, sy, cc[1] + Math.sin(b0) * 0.12], [cc[0] + Math.cos(b1) * 0.12, sy, cc[1] + Math.sin(b1) * 0.12],
            [cc[0], sy + sh, cc[1]], C.gold, null, null, [Math.cos((b0 + b1) / 2), 0, Math.sin((b0 + b1) / 2)]);
        }
      }
      return;
    }
    // двускатная / вальмовая по прямоугольнику: конёк — вдоль длинной стороны (u), поперёк — v
    var ux = o.ux, uz = o.uz, vx = -uz, vz = ux, hl = o.L / 2, hw = o.W / 2, cx = o.x, cz = o.z;
    function P(u, v, y) { return [cx + ux * u + vx * v, y, cz + uz * u + vz * v]; }
    var inset = shape === 2 ? Math.min(hw, hl * 0.9) : 0, up = rh * 0.6, ov = b[12] === 24 ? 0.9 : b[12] >= 20 ? 0.35 : 0;   // вынос карниза (у 1-335 — большой)
    var c00 = P(-hl - ov, -hw - ov, y0 - ov * 0.4), c10 = P(hl + ov, -hw - ov, y0 - ov * 0.4), c11 = P(hl + ov, hw + ov, y0 - ov * 0.4), c01 = P(-hl - ov, hw + ov, y0 - ov * 0.4);
    var r0 = P(-hl + inset, 0, y1), r1 = P(hl - inset, 0, y1);
    tri(R, c00, c10, r1, col, null, null, [-vx, up, -vz]); tri(R, c00, r1, r0, col, null, null, [-vx, up, -vz]);
    tri(R, c11, c01, r0, col, null, null, [vx, up, vz]); tri(R, c11, r0, r1, col, null, null, [vx, up, vz]);
    var gcol = shape === 2 ? col : (b[12] >= 20 ? rgbOf(famP(b[12]).w[(b[0] >> 3) % famP(b[12]).w.length]) : C.tin);
    tri(R, c01, c00, r0, gcol, null, null, [-ux, shape === 2 ? up : 0, -uz]);
    tri(R, c10, c11, r1, gcol, null, null, [ux, shape === 2 ? up : 0, uz]);
    if (ov > 0) {                                          // свес снизу — чтобы не просвечивал
      tri(R, c00, c10, c11, col, null, null, [0, -1, 0]); tri(R, c00, c11, c01, col, null, null, [0, -1, 0]);
    }
  }

  /* ---- ленты: дорога (uv поперёк 0..1, v — метры вдоль; атрибут разметки), плоская полоса с цветом ----------- */
  function ribbon(p, w, y, lanes, dbl, one) {
    var pos = [], uv = [], ar = [], idx = [], len = 0;
    for (var i = 0; i < p.length; i++) {
      var a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
      var dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
      if (i > 0) len += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
      pos.push(p[i][0] + nx * w / 2, y, p[i][1] + nz * w / 2, p[i][0] - nx * w / 2, y, p[i][1] - nz * w / 2);
      uv.push(0, len, 1, len); ar.push(lanes, 4 + dbl + (one ? 2 : 0), w, lanes, 4 + dbl + (one ? 2 : 0), w);   // y ≥ 4 — разметка «Минск»
      if (i > 0) { var k = i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
    }
    var g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    var nrm = new Float32Array(pos.length); for (var j = 1; j < nrm.length; j += 3) nrm[j] = 1;
    g.setAttribute("normal", new T.BufferAttribute(nrm, 3));
    g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    g.setAttribute("aRoad", new T.Float32BufferAttribute(ar, 3));
    g.setIndex(idx);
    return g.toNonIndexed();
  }
  function strip(a, p, w, y, col) {
    for (var i = 1; i < p.length; i++) {
      var A = p[i - 1], B = p[i], dx = B[0] - A[0], dz = B[1] - A[1], l = Math.hypot(dx, dz);
      if (l < 0.05) continue;
      var nx = -dz / l * w / 2, nz = dx / l * w / 2;
      tri(a, [A[0] + nx, y, A[1] + nz], [A[0] - nx, y, A[1] - nz], [B[0] - nx, y, B[1] - nz], col, null, null, [0, 1, 0]);
      tri(a, [A[0] + nx, y, A[1] + nz], [B[0] - nx, y, B[1] - nz], [B[0] + nx, y, B[1] + nz], col, null, null, [0, 1, 0]);
    }
  }
  // вертикальная лента (бордюр): по ломаной от y0 до y1, лицом в сторону hintSide (−1/1 — от оси)
  function curb(a, p, y0, y1, col, side) {
    for (var i = 1; i < p.length; i++) {
      var A = p[i - 1], B = p[i], dx = B[0] - A[0], dz = B[1] - A[1], l = Math.hypot(dx, dz);
      if (l < 0.05) continue;
      quad(a, [A[0], y0, A[1]], [B[0], y0, B[1]], [B[0], y1, B[1]], [A[0], y1, A[1]], col, [dz / l * side, 0, -dx / l * side]);
    }
  }
  function offsetLine(p, off) {
    var out = [];
    for (var i = 0; i < p.length; i++) {
      var a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      out.push([p[i][0] - dz / l * off, p[i][1] + dx / l * off]);
    }
    return out;
  }
  // ось ребра графа от s0 до s1 (метры от узла a) — ломаная
  function edgeSlice(e, s0, s1) {
    if (s1 <= s0) return [];
    var a = M.axisPoint(e, s0 / e.len), out = [[a.x, a.z]];
    for (var i = 1; i < e.px.length - 1; i++) if (e.cum[i] > s0 && e.cum[i] < s1) out.push([e.px[i], e.pz[i]]);
    var b = M.axisPoint(e, s1 / e.len); out.push([b.x, b.z]);
    return out;
  }
  // раздельные полотна: у одностороннего ребра есть «близнец» той же улицы слева — там разделительная, не тротуар
  function twinSide(e) {
    if (!e.oneway || !e.name) return 0;
    if (e.twin != null) return e.twin;
    var q = M.axisPoint(e, 0.5), es = M.edgesNear(q.x, q.z, 45), side = 0, gap = 0;
    for (var i = 0; i < es.length; i++) {
      var o = es[i]; if (o === e || !o.oneway || o.name !== e.name) continue;
      var best = 1e9, bx = 0, bz = 0;
      for (var s = 1; s < o.px.length; s++) {
        var ex = o.px[s] - o.px[s - 1], ez = o.pz[s] - o.pz[s - 1], L = ex * ex + ez * ez || 1e-9, t = FC.clamp(((q.x - o.px[s - 1]) * ex + (q.z - o.pz[s - 1]) * ez) / L, 0, 1);
        var px = o.px[s - 1] + ex * t, pz = o.pz[s - 1] + ez * t, d = Math.hypot(px - q.x, pz - q.z);
        if (d < best) { best = d; bx = px; bz = pz; }
      }
      if (best < 45 && best > 2) {
        var sd = ((bx - q.x) * -q.dz + (bz - q.z) * q.dx) >= 0 ? 1 : -1;
        side = sd; gap = best - (e.w + o.w) / 2; break;
      }
    }
    e.twin = side; e.median = gap;
    return side;
  }

  /* ---- рёбра графа по суперкускам (тротуары, деревья, фонари — по рёбрам, с отступом от перекрёстков) -------- */
  function skey(x, z) { return Math.floor(x / SUP) + "_" + Math.floor(z / SUP); }
  var EDGES_OF = {};
  M.edges.forEach(function (e) { var k = skey(e.mx, e.mz); (EDGES_OF[k] || (EDGES_OF[k] = [])).push(e); });

  /* ---- маски ориентиров (flandmarks.js рисует их сам) ------------------------------------------------------ */
  var masks = [], HQ_OLD = FC.map && FC.map.hq && FC.map.hq.moved ? FC.map.hq.hqOldGid : null;
  function masked(x, z) {
    for (var i = 0; i < masks.length; i++) {
      var m = masks[i];
      if (m.r != null ? Math.hypot(x - m.x, z - m.z) < m.r : (x >= m.x0 && x <= m.x1 && z >= m.z0 && z <= m.z1 && pipP(x, z, m.p))) return true;
    }
    return false;
  }

  /* ---- столкновения: сетка 20 м со ссылками на контуры ----------------------------------------------------- */
  var GRID = 20, grid = {};
  function gfor(it, fn) {
    for (var gx = Math.floor(it.x0 / GRID); gx <= Math.floor(it.x1 / GRID); gx++)
      for (var gz = Math.floor(it.z0 / GRID); gz <= Math.floor(it.z1 / GRID); gz++) fn(gx + "," + gz);
  }
  function gridAdd(it) { gfor(it, function (k) { (grid[k] || (grid[k] = [])).push(it); }); }
  function gridDel(it) { gfor(it, function (k) { var l = grid[k]; if (!l) return; var i = l.indexOf(it); if (i >= 0) l.splice(i, 1); }); }

  /* ---- сборка суперкуска: по шагам, не дольше ~7 мс за кадр ------------------------------------------------ */
  var loaded = {}, pending = {}, queue = [], ready = [], job = null, inflight = 0;
  var signSrc = {}, treeSrc = {}, lampSrc = {}, poleSrc = {}, stopSrc = {}, metroSrc = {}, spotSrc = {}, instDirty = false, waters = [], waterLines = [];
  function startJob(key, data) {
    job = { key: key, data: data, step: 0, i: 0, A: Acc(true), R: Acc(false), F: Acc(false), W: Acc(false), roads: [], items: [],
      trees: [], lamps: [], poles: [], stops: [], metro: [], spots: [], labels: [], ao: [], wires: Acc(false), rnd: FC.rng(FC.hash("ms" + key)) };
  }
  function bbOf(p, pad) {
    var x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; pad = (pad || 0) / 2;
    p.forEach(function (q) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); });
    return [x0 - pad, z0 - pad, x1 + pad, z1 + pad];
  }
  function stepBuildings(J, d) {
    var bs = d.b || [], t0 = performance.now();
    for (var n = 0; n < 400 && J.i < bs.length; n++, J.i++) {
      var b = bs[J.i], p0 = pts(b[4]), bb = bbOf(p0), cx = (bb[0] + bb[2]) / 2, cz = (bb[1] + bb[3]) / 2;
      if (HQ_OLD != null && b[0] === HQ_OLD) continue;           // Башня Флейм перенесена (fmapx) — старой нет ни в мешах, ни в столкновениях
      // Стена — только то, что нарисовано и стоит на земле (23.11: «на Маяке не пройти»). Контур дома с частями
      // (флаг 2 без 1: башни на подиуме, корпуса с проходами и дворами) не рисуется — он остаётся записью дома (адрес,
      // двери, владение), но не стеной; стенами становятся его нарисованные части от земли (флаг 1, низ ниже 2,5 м).
      if (b[6] & 2 && b[2] < 2.5) J.items.push({ p: p0, x0: bb[0], z0: bb[1], x1: bb[2], z1: bb[3], h: b[1], mh: b[2], name: b[5], id: b[0], kind: b[3], pi: b[13], levels: b[14], st: b[11], fam: b[12], addr: b[17] || "", nocol: !(b[6] & 1) });
      else if (b[6] === 1 && b[2] < 2.5) J.items.push({ p: p0, x0: bb[0], z0: bb[1], x1: bb[2], z1: bb[3], h: b[1], mh: b[2], id: b[0], colOnly: true });
      if (b[6] & 1 && !(masks.length && masked(cx, cz))) building(b, J, p0);
      if ((n & 15) === 15 && performance.now() - t0 > 4) { J.i++; break; }
    }
    if (J.i >= bs.length) { J.step = 1; J.i = 0; }
  }
  function stepRoads(J, d) {
    (d.r || []).forEach(function (r) {
      var p = pts(r[5]); if (p.length < 2) return;
      if (r[3] & 4) {
        J.roads.push(ribbon(p, r[1], 0.05 + (r[3] & 2 ? 0.02 : 0) + (r[4] > 0 ? 0.005 : 0), r[0] === "service" ? 0 : r[2],
          r[0] === "primary" || r[0] === "trunk" || r[0] === "secondary" ? 1 : 0, r[3] & 1));
        // дворовые проезды и парковочные дорожки: места для машин вдоль (ставим через FC.cars, когда игрок рядом)
        if (r[0] === "service" && !(r[3] & 2)) {
          var aisle = r[3] & 8, stepM = aisle ? 2.7 : 5.6;
          for (var i = 1; i < p.length; i++) {
            var A = p[i - 1], B = p[i], dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz); if (L < 6) continue;
            var ux = dx / L, uz = dz / L;
            for (var s = 3; s < L - 3; s += stepM) {
              for (var sd = -1; sd <= 1; sd += 2) {
                if (J.rnd() > (aisle ? 0.62 : 0.4)) continue;
                var off = sd * (r[1] / 2 + (aisle ? 2.6 : 1.25)), x = A[0] + ux * s - uz * off, z = A[1] + uz * s + ux * off;
                // на парковке — поперёк проезда, у проезда — вдоль
                var hdg = aisle ? Math.atan2(-uz * sd, ux * sd) : Math.atan2(ux * sd, uz * sd);
                J.spots.push([x, z, hdg, J.rnd()]);
              }
            }
          }
        }
      } else strip(J.F, p, r[1], r[0] === "pedestrian" ? 0.03 : 0.036, r[0] === "pedestrian" ? C.square : C.path);
    });
    (d.l || []).forEach(function (l) { strip(J.F, pts(l[1]), l[0] === "rail" ? 2.6 : 2.0, 0.035, l[0] === "rail" ? C.rail : C.tram); });
    // «зебры» по переходам OSM: полосы вдоль движения поперёк всей проезжей части
    (d.x || []).forEach(function (c) {
      var x = c[0] / 10, z = c[1] / 10, a = c[2] * Math.PI / 180, w = c[3] / 10, ux = Math.cos(a), uz = Math.sin(a), vx = -uz, vz = ux;
      for (var v = -w / 2 + 0.4; v < w / 2 - 0.3; v += 1.0) {
        var cx = x + vx * (v + 0.25), cz = z + vz * (v + 0.25), hl = 2.0, hw = 0.25;
        quad(J.F, [cx - ux * hl - vx * hw, 0.075, cz - uz * hl - vz * hw], [cx + ux * hl - vx * hw, 0.075, cz + uz * hl - vz * hw],
          [cx + ux * hl + vx * hw, 0.075, cz + uz * hl + vz * hw], [cx - ux * hl + vx * hw, 0.075, cz - uz * hl + vz * hw], C.zebra, [0, 1, 0]);
      }
    });
    J.step = 2;
  }
  function stepFlats(J, d) {
    (d.w || []).forEach(function (w) {
      var p = pts(w[0]);
      if (w.length === 1) { if (p.length >= 3) { flatPoly(J.W, p, 0.012, [1, 1, 1]); waters.push({ p: p, key: J.key, bb: bbOf(p) }); } }
      else if (p.length >= 2) { strip(J.W, p, w[1], 0.013, [1, 1, 1]); waterLines.push({ p: p, w: w[1], key: J.key, bb: bbOf(p, w[1]) }); }
    });
    (d.g || []).forEach(function (g) {
      var p = pts(g[1]); if (p.length < 3) return;
      flatPoly(J.F, p, g[0] === "park" ? 0.014 : g[0] === "parking" ? 0.01 : 0.018, C[g[0]] || C.park);
      var bb = bbOf(p);
      if (g[0] === "parking") {                            // открытая стоянка: машины рядами
        var o = obb(p); if (!o || o.W < 8) return;
        var n = Math.min(60, Math.floor(o.L / 2.7) * Math.max(1, Math.floor(o.W / 11)));
        for (var k = 0; k < n; k++) {
          var row = Math.floor(k / Math.floor(o.L / 2.7)), col = k % Math.floor(o.L / 2.7);
          var u = -o.L / 2 + 1.4 + col * 2.7, v = -o.W / 2 + 3 + row * 11;
          if (v > o.W / 2 - 2.5) break;
          var x = o.x + o.ux * u - o.uz * v, z = o.z + o.uz * u + o.ux * v;
          if (pipP(x, z, p) && J.rnd() < 0.7) J.spots.push([x, z, Math.atan2(-o.uz, o.ux) + (row % 2 ? Math.PI : 0), J.rnd()]);
        }
        return;
      }
      if (g[0] !== "park") return;
      var nn = Math.min(140, Math.floor((bb[2] - bb[0]) * (bb[3] - bb[1]) / 220));
      for (var q = 0; q < nn; q++) {
        var tx = bb[0] + J.rnd() * (bb[2] - bb[0]), tz = bb[1] + J.rnd() * (bb[3] - bb[1]);
        if (pipP(tx, tz, p)) J.trees.push([tx, tz, J.rnd() * 6, 1.0 + J.rnd() * 0.7, J.rnd(), J.rnd() < 0.15 ? 3 : J.rnd() < 0.4 ? 0 : 1]);
      }
    });
    // деревья OSM (отдельные и аллеи) и дворы: взрослые, выше пятиэтажек
    // (fmt 2: одна ломаная с приращениями; старый формат — пары)
    function treeList(a) { return !a ? [] : typeof a[0] === "number" ? pts(a) : a.map(function (t) { return [t[0] / 10, t[1] / 10]; }); }
    treeList(d.t).forEach(function (t) { J.trees.push([t[0], t[1], J.rnd() * 6, 1.1 + J.rnd() * 0.6, J.rnd(), J.rnd() < 0.3 ? 0 : J.rnd() < 0.2 ? 2 : 1]); });
    treeList(d.ty).forEach(function (t) {
      var r = J.rnd();
      J.trees.push([t[0], t[1], J.rnd() * 6, 1.35 + J.rnd() * 0.75, J.rnd(), r < 0.34 ? 0 : r < 0.86 ? 1 : 2]);
    });
    J.step = 3;
  }
  function stepStreets(J, d) {
    var osmLamps = (d.lp || []).length >= 12;
    (EDGES_OF[J.key] || []).forEach(function (e) {
      if (/link/.test(e.cls)) return;
      var na = M.nodes[e.a], nb = M.nodes[e.b], s0 = na.edges.length > 1 ? na.vr.w / 2 + 1.5 : 0, s1 = e.len - (nb.edges.length > 1 ? nb.vr.w / 2 + 1.5 : 0);
      var ax = edgeSlice(e, s0, s1); if (ax.length < 2) return;
      var tw = twinSide(e);
      [-1, 1].forEach(function (sd) {
        if (sd === tw) {                                   // разделительная: газон с бордюром, если широкая
          if (e.median > 1.5) { var mw = Math.min(e.median, 12); strip(J.F, offsetLine(ax, sd * (e.w / 2 + mw / 2)), mw, 0.11, C.median); curb(J.F, offsetLine(ax, sd * e.w / 2), 0.03, 0.12, C.curb, sd); }
          return;
        }
        strip(J.F, offsetLine(ax, sd * (e.w / 2 + 1.6)), 3.2, 0.1, e.kind === "st" ? C.walkC : C.walk);
        curb(J.F, offsetLine(ax, sd * e.w / 2), 0.03, 0.1, C.curb, sd);
      });
      if (e.bridge) return;
      var big = e.kind !== "st", step = big ? 11 : 19, lstep = big ? 32 : 42;
      for (var s = s0 + 4; s < s1 - 2; s += step) {
        var q = M.axisPoint(e, s / e.len), nx = -q.dz, nz = q.dx;
        for (var sd = -1; sd <= 1; sd += 2) {
          var off = e.w / 2 + 4.4;
          if (sd === tw) { if (e.median < 7) continue; off = e.w / 2 + e.median / 2; }
          if (J.rnd() < (big ? 0.85 : 0.5)) J.trees.push([q.x + nx * sd * off, q.z + nz * sd * off, J.rnd() * 6, 0.8 + J.rnd() * 0.35, J.rnd(), J.rnd() < (big ? 0.7 : 0.4) ? 1 : J.rnd() < 0.5 ? 0 : 2]);
        }
        if (!osmLamps && Math.floor((s - s0) / lstep) !== Math.floor((s - s0 - step) / lstep)) {
          var sd2 = (Math.floor(s / lstep) % 2) ? 1 : -1;
          if (sd2 === tw && e.median > 1.5) J.lamps.push([q.x + nx * sd2 * (e.w / 2 + e.median / 2), q.z + nz * sd2 * (e.w / 2 + e.median / 2), Math.atan2(nx * sd2, nz * sd2), 1]);
          else J.lamps.push([q.x + nx * sd2 * (e.w / 2 + 0.6), q.z + nz * sd2 * (e.w / 2 + 0.6), Math.atan2(-nx * sd2, -nz * sd2), 0]);
        }
      }
    });
    // фонари OSM: стрела к дороге (угол из конвертера)
    (d.lp || []).forEach(function (l) { var a = l[2] < 0 ? J.rnd() * 6.28 : l[2] * Math.PI / 180; J.lamps.push([l[0] / 10, l[1] / 10, Math.atan2(Math.cos(a), Math.sin(a)), 0]); });
    // остановки: павильон спиной к тротуару
    (d.sp || []).forEach(function (s) {
      var a = s[2] * Math.PI / 180, x = s[0] / 10, z = s[1] / 10, side = s[3];
      // лицом к дороге: нормаль от остановки к оси = −side · (−sin a, cos a)
      var fx = side * Math.sin(a), fz = -side * Math.cos(a);
      J.stops.push([x, z, Math.atan2(fx, fz), s[4]]);
    });
    // спуски в метро
    (d.me || []).forEach(function (m) { J.metro.push([m[0] / 10, m[1] / 10, m[2] * Math.PI / 180]); });
    // троллейбусная сеть: по паре проводов над правым рядом каждого направления, опоры с растяжкой через 34 м
    (d.tw || []).forEach(function (w) {
      var p = pts(w[2]), fl = w[0], wd = w[1] / 10, one = fl & 1, pairs = [];
      if (fl & 2) pairs.push(one ? wd / 2 - 1.9 : wd / 2 - 1.9);
      if (fl & 4) pairs.push(-(wd / 2 - 1.9));
      if (!pairs.length) return;
      var acc = 0, spans = [];
      for (var i = 1; i < p.length; i++) {
        var A = p[i - 1], B = p[i], L = Math.hypot(B[0] - A[0], B[1] - A[1]);
        while (acc < L) { var t = acc / L; spans.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, (B[0] - A[0]) / L, (B[1] - A[1]) / L]); acc += 34; }
        acc -= L;
      }
      var last = p[p.length - 1], pl = p[p.length - 2], LL = Math.hypot(last[0] - pl[0], last[1] - pl[1]) || 1;
      spans.push([last[0], last[1], (last[0] - pl[0]) / LL, (last[1] - pl[1]) / LL]);
      for (var k = 0; k < spans.length; k++) {
        var S = spans[k], nx = -S[3], nz = S[2], half = wd / 2 + 0.8;
        J.poles.push([S[0] + nx * half, S[1] + nz * half, 0]); J.poles.push([S[0] - nx * half, S[1] - nz * half, 0]);
        wireSeg(J.wires, S[0] + nx * half, 6.3, S[1] + nz * half, S[0] - nx * half, 6.3, S[1] - nz * half, 0);  // растяжка поперёк
        if (k === 0) continue;
        var P0 = spans[k - 1];
        for (var pi = 0; pi < pairs.length; pi++) for (var o = -0.3; o <= 0.31; o += 0.6) {
          var off = pairs[pi] + o, ax = P0[0] - P0[3] * off, az = P0[1] + P0[2] * off, bx = S[0] - S[3] * off, bz = S[1] + S[2] * off;
          var mx = (ax + bx) / 2, mz = (az + bz) / 2;
          wireSeg(J.wires, ax, 6.0, az, mx, 5.78, mz, 1); wireSeg(J.wires, mx, 5.78, mz, bx, 6.0, bz, 1);
        }
      }
    });
    J.step = 4;
  }
  function wireSeg(a, x0, y0, z0, x1, y1, z1, thick) {
    var dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1, nx = -dz / l * 0.018, nz = dx / l * 0.018, hh = thick ? 0.022 : 0.012;
    quad(a, [x0 - nx, y0, z0 - nz], [x1 - nx, y1, z1 - nz], [x1 + nx, y1, z1 + nz], [x0 + nx, y0, z0 + nz], [0.1, 0.1, 0.1], [0, -1, 0]);
    quad(a, [x0, y0 - hh, z0], [x1, y1 - hh, z1], [x1, y1 + hh, z1], [x0, y0 + hh, z0], [0.1, 0.1, 0.1], [nz, 0, -nx]);
  }
  function stepLabels(J) {
    var tx = TextAcc();
    J.labels.forEach(function (L) {
      var dark = [0.95, 0.95, 0.95];
      if (L.k === "sign") {
        var size = 0.42, w = Math.min(textWidth(L.s, size), L.maxW || 7), sz = w < textWidth(L.s, size) ? size * w / textWidth(L.s, size) : size;
        var bw = w + 0.5, bh = 0.78, bg = rgbOf(L.bg != null ? L.bg : SIGN_BG[L.cat] || 0x2a7d3c);
        quad(J.F, [L.x - L.ux * bw / 2, L.y - bh / 2, L.z - L.uz * bw / 2], [L.x + L.ux * bw / 2, L.y - bh / 2, L.z + L.uz * bw / 2],
          [L.x + L.ux * bw / 2, L.y + bh / 2, L.z + L.uz * bw / 2], [L.x - L.ux * bw / 2, L.y + bh / 2, L.z - L.uz * bw / 2], bg, [L.nx, 0, L.nz]);
        textLine(tx, L.s, L.x + L.nx * 0.02, L.y, L.z + L.nz * 0.02, L.ux, L.uz, L.nx, L.nz, sz, L.fg != null ? rgbOf(L.fg) : dark);
      } else if (L.k === "addr") {
        var parts = L.s.split(", "), num = parts.pop(), st = parts.join(", "), s1 = 0.15, s2 = 0.3;
        var w1 = textWidth(st, s1), w2 = textWidth(num, s2), bw2 = Math.max(w1, w2) + 0.24, y = L.y;
        quad(J.F, [L.x - L.ux * bw2 / 2, y - 0.33, L.z - L.uz * bw2 / 2], [L.x + L.ux * bw2 / 2, y - 0.33, L.z + L.uz * bw2 / 2],
          [L.x + L.ux * bw2 / 2, y + 0.33, L.z + L.uz * bw2 / 2], [L.x - L.ux * bw2 / 2, y + 0.33, L.z - L.uz * bw2 / 2], C.plate, [L.nx, 0, L.nz]);
        textLine(tx, st, L.x + L.nx * 0.02, y + 0.17, L.z + L.nz * 0.02, L.ux, L.uz, L.nx, L.nz, s1, dark);
        textLine(tx, num, L.x + L.nx * 0.02, y - 0.1, L.z + L.nz * 0.02, L.ux, L.uz, L.nx, L.nz, s2, dark);
      } else if (L.k === "ent") {
        quad(J.F, [L.x - L.ux * 0.22, L.y - 0.2, L.z - L.uz * 0.22], [L.x + L.ux * 0.22, L.y - 0.2, L.z + L.uz * 0.22],
          [L.x + L.ux * 0.22, L.y + 0.2, L.z + L.uz * 0.22], [L.x - L.ux * 0.22, L.y + 0.2, L.z - L.uz * 0.22], C.plate, [L.nx, 0, L.nz]);
        textLine(tx, L.s, L.x + L.nx * 0.02, L.y, L.z + L.nz * 0.02, L.ux, L.uz, L.nx, L.nz, 0.3, dark);
      }
    });
    J.text = textGeo(tx);
    // тень у стен: кольцо наружу, прозрачность по вершинам
    var ao = { p: [], n: [], c: [], c4: true };
    J.ao.forEach(function (p) {
      var s = signedA(p) > 0 ? -1 : 1, n = p.length, W = 1.9, y = 0.112;
      for (var i = 0; i < n; i++) {
        var a = p[i], b = p[(i + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz); if (l < 0.3) continue;
        var ox = -dz / l * s * W, oz = dx / l * s * W;
        // внешняя сторона: нормаль стены наружу (−dz, dx) у контура по часовой
        var A = [a[0], y, a[1]], B = [b[0], y, b[1]], Bo = [b[0] - ox, y, b[1] - oz], Ao = [a[0] - ox, y, a[1] - oz];
        [A, B, Bo, A, Bo, Ao].forEach(function (v, k) { ao.p.push(v[0], v[1], v[2]); ao.n.push(0, 1, 0); var al = (k === 0 || k === 1 || k === 3) ? 0.36 : 0; ao.c.push(1, 1, 1, al); });
      }
    });
    J.aoGeo = geoOf(ao);
    J.step = 5;
  }
  // старт: пока идёт заставка и первые секунды — куски строим большими порциями (первый кадр города раньше)
  var bootT = performance.now();
  function stepJob(t0) {
    var J = job, d = J.data, budget = !FC.started || performance.now() - bootT < 3000 ? 28 : 7;
    while (performance.now() - t0 < budget) {
      if (J.step === 0) stepBuildings(J, d);
      else if (J.step === 1) stepRoads(J, d);
      else if (J.step === 2) stepFlats(J, d);
      else if (J.step === 3) stepStreets(J, d);
      else if (J.step === 4) stepLabels(J);
      else { finish(J); job = null; return; }
    }
  }
  function addMesh(grp, geo, mat, shadow, recv) {
    if (!geo) return null;
    geo.computeBoundingSphere();
    var m = new T.Mesh(geo, mat);
    m.castShadow = !!shadow && G.Q.shadows; m.receiveShadow = recv !== false && G.Q.shadows;
    m.matrixAutoUpdate = false; m.updateMatrix();
    grp.add(m); return m;
  }
  function finish(J) {
    var grp = new T.Group(); grp.name = "s" + J.key;
    addMesh(grp, geoOf(J.A), facadeMat, true);
    addMesh(grp, J.roads.length ? T.mergeGeometries(J.roads, false) : null, roadMat, false);
    var F = J.F; F.p = F.p.concat(J.R.p); F.n = F.n.concat(J.R.n); F.c = F.c.concat(J.R.c);
    addMesh(grp, geoOf(F), flatMat, false);
    addMesh(grp, geoOf(J.W), waterMat, false);
    var near = [];
    var wm = addMesh(grp, geoOf(J.wires), wireMat, false, false); if (wm) near.push(wm);
    var tm = addMesh(grp, J.text, GL.mat, false); if (tm) near.push(tm);
    var am = addMesh(grp, J.aoGeo, aoMat, false, false); if (am) { am.renderOrder = 2; near.push(am); }
    root.add(grp);
    J.items.forEach(gridAdd);
    loaded[J.key] = { grp: grp, items: J.items, data: J.data, near: near };
    signSrc[J.key] = J.signs || [];
    treeSrc[J.key] = J.trees; lampSrc[J.key] = J.lamps; poleSrc[J.key] = J.poles; stopSrc[J.key] = J.stops; metroSrc[J.key] = J.metro; spotSrc[J.key] = J.spots;
    instDirty = true;
    nearVis(true);
    FC.emit("osm:chunk", J.key);
  }
  function drop(key) {
    var c = loaded[key]; if (!c) return;
    c.items.forEach(gridDel);
    c.grp.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
    root.remove(c.grp);
    delete signSrc[key];
    delete loaded[key]; delete treeSrc[key]; delete lampSrc[key]; delete poleSrc[key]; delete stopSrc[key]; delete metroSrc[key]; delete spotSrc[key];
    instDirty = true;
    waters = waters.filter(function (w) { return w.key !== key; });
    waterLines = waterLines.filter(function (w) { return w.key !== key; });
  }
  // надписи, провода и тень у стен — только у ближних кусков (вдали их не видно, а вызовы отрисовки стоят)
  function nearVis(force) {
    var f = G.focus || G.camera.position;
    Object.keys(loaded).forEach(function (k) {
      var c = loaded[k], on = rectD(byKey[k], f.x, f.z) < R_NEAR;
      if (force || c.nearOn !== on) { c.nearOn = on; c.near.forEach(function (m) { m.visible = on; }); }
    });
  }

  /* ---- общие инстансы: деревья (4 породы), фонари, опоры сети, остановки, метро ------------------------------ */
  function paintGeo(g, col) {
    var n = g.attributes.position.count, c = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) { c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2]; }
    g.setAttribute("color", new T.BufferAttribute(c, 3));
    if (g.attributes.uv) g.deleteAttribute("uv");
    return g;
  }
  function ni(g) { return g.index ? g.toNonIndexed() : g; }
  // породы: 0 берёза (узкая крона, белый ствол), 1 липа/клён (круглая крона из двух комков), 2 тополь (колонна), 3 ель
  var TREE_G = [
    T.mergeGeometries([paintGeo(ni(new T.CylinderGeometry(0.13, 0.2, 5.5, 5, 1, true).translate(0, 2.75, 0)), linOf(0xdcd8cf)),
      paintGeo(ni(new T.IcosahedronGeometry(1, 0).scale(2.1, 3.6, 2.1).translate(0, 7.8, 0)), linOf(0x6f8a3c)),
      paintGeo(ni(new T.IcosahedronGeometry(1, 0).scale(1.5, 2.2, 1.5).translate(0.5, 10.6, -0.3)), linOf(0x7b9446))]),
    T.mergeGeometries([paintGeo(ni(new T.CylinderGeometry(0.18, 0.3, 4.6, 5, 1, true).translate(0, 2.3, 0)), linOf(0x4e4236)),
      paintGeo(ni(new T.IcosahedronGeometry(1, 0).scale(3.4, 2.9, 3.4).translate(0, 6.6, 0)), linOf(0x4f6b2e)),
      paintGeo(ni(new T.IcosahedronGeometry(1, 0).scale(2.5, 2.2, 2.5).translate(-0.8, 8.9, 0.6)), linOf(0x5a7834))]),
    T.mergeGeometries([paintGeo(ni(new T.CylinderGeometry(0.2, 0.3, 4, 5, 1, true).translate(0, 2, 0)), linOf(0x5a5046)),
      paintGeo(ni(new T.IcosahedronGeometry(1, 0).scale(1.7, 6.5, 1.7).translate(0, 9.5, 0)), linOf(0x4c6a30))]),
    T.mergeGeometries([paintGeo(ni(new T.CylinderGeometry(0.15, 0.22, 2, 5, 1, true).translate(0, 1, 0)), linOf(0x4a3e33)),
      paintGeo(ni(new T.ConeGeometry(2.6, 5.5, 7, 1, true).translate(0, 4.5, 0)), linOf(0x2c4a33)),
      paintGeo(ni(new T.ConeGeometry(1.9, 4.5, 7, 1, true).translate(0, 7.6, 0)), linOf(0x33553a))])
  ];
  var trees = TREE_G.map(function (g) {
    // тени деревьев — только на «высоком»: инстансы рисуются в карту теней все разом
    var m = new T.InstancedMesh(g, treeMat, TREES_MAX); m.castShadow = G.Q.shadows && LV === "high"; m.receiveShadow = false; m.frustumCulled = false; m.count = 0;
    m.setColorAt(0, new T.Color(1, 1, 1)); root.add(m); return m;
  });
  var LAMP = T.mergeGeometries([ni(new T.CylinderGeometry(0.07, 0.13, 9, 6, 1, true).translate(0, 4.5, 0)),
    ni(new T.CylinderGeometry(0.05, 0.05, 2.2, 4, 1, true).rotateX(Math.PI / 2).rotateX(-0.25).translate(0, 8.95, 1.05))].map(function (g) { if (g.attributes.uv) g.deleteAttribute("uv"); return g; }));
  var HEAD = ni(new T.BoxGeometry(0.34, 0.12, 0.7).translate(0, 9.2, 2.15)); HEAD.deleteAttribute("uv");
  var POLE = ni(new T.CylinderGeometry(0.11, 0.17, 7.2, 6, 1, true).translate(0, 3.6, 0)); POLE.deleteAttribute("uv");
  // остановка: стеклянная задняя стенка, крыша, стойки, скамья, табличка; цвета вершин
  var STOP = (function () {
    var parts = [paintGeo(ni(new T.BoxGeometry(5.6, 0.14, 1.9).translate(0, 2.65, 0)), [0.036, 0.047, 0.061]),
      paintGeo(ni(new T.BoxGeometry(5.4, 2.2, 0.06).translate(0, 1.35, -0.85)), [0.268, 0.401, 0.485]),
      paintGeo(ni(new T.BoxGeometry(0.06, 2.2, 1.6).translate(-2.7, 1.35, -0.1)), [0.268, 0.401, 0.485]),
      paintGeo(ni(new T.BoxGeometry(0.1, 2.6, 0.1).translate(-2.7, 1.3, 0.85)), [0.047, 0.056, 0.071]),
      paintGeo(ni(new T.BoxGeometry(0.1, 2.6, 0.1).translate(2.7, 1.3, 0.85)), [0.047, 0.056, 0.071]),
      paintGeo(ni(new T.BoxGeometry(3.2, 0.08, 0.45).translate(0, 0.48, -0.55)), [0.173, 0.087, 0.036]),
      paintGeo(ni(new T.BoxGeometry(0.08, 2.6, 0.08).translate(3.6, 1.3, 0.9)), [0.071, 0.082, 0.099]),
      paintGeo(ni(new T.BoxGeometry(0.06, 0.55, 0.55).translate(3.6, 2.75, 0.9)), [0.914, 0.914, 0.873])];
    return T.mergeGeometries(parts);
  })();
  // спуск в подземный переход: гранитный парапет «П», чёрный проём, перила; стела со знаком «М»
  var METRO_G = (function () {
    var g = [0.148, 0.133, 0.119], parts = [paintGeo(ni(new T.BoxGeometry(6.4, 0.9, 0.3).translate(0, 0.45, -1.75)), g),
      paintGeo(ni(new T.BoxGeometry(6.4, 0.9, 0.3).translate(0, 0.45, 1.75)), g), paintGeo(ni(new T.BoxGeometry(0.3, 0.9, 3.8).translate(-3.2, 0.45, 0)), g),
      paintGeo(ni(new T.BoxGeometry(6.2, 0.04, 3.2).translate(0.15, 0.04, 0)), [0.001, 0.001, 0.002]),
      paintGeo(ni(new T.BoxGeometry(6.4, 0.06, 0.06).translate(0, 1.05, -1.75)), [0.456, 0.485, 0.516]),
      paintGeo(ni(new T.BoxGeometry(6.4, 0.06, 0.06).translate(0, 1.05, 1.75)), [0.456, 0.485, 0.516]),
      paintGeo(ni(new T.CylinderGeometry(0.09, 0.11, 3.9, 6, 1, true).translate(-3.6, 1.95, 2.2)), [0.047, 0.052, 0.061])];
    for (var s = 0; s < 6; s++) parts.push(paintGeo(ni(new T.BoxGeometry(0.42, 0.06, 3.1).translate(2.9 - s * 0.5, -0.05 - s * 0.18, 0)), [0.087, 0.082, 0.076]));
    return T.mergeGeometries(parts);
  })();
  var mTex = G.tex.canvas(128, 128, function (x, w, h) {
    x.fillStyle = "#ffffff"; x.beginPath(); x.arc(w / 2, h / 2, w / 2 - 2, 0, 7); x.fill();
    x.fillStyle = "#E31E25"; x.font = "900 104px system-ui, Arial, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("М", w / 2, h / 2 + 6);
  });
  var mSignMat = new T.MeshStandardMaterial({ map: mTex, transparent: true, alphaTest: 0.3, side: T.DoubleSide, emissive: 0xffffff, emissiveMap: mTex, emissiveIntensity: 0.15, roughness: 0.5 });
  var MSIGN = new T.PlaneGeometry(1.05, 1.05).translate(-3.6, 4.35, 2.2);
  var stdVC = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1 });
  function inst(geo, mat, max, shadow) { var m = new T.InstancedMesh(geo, mat, max); m.count = 0; m.frustumCulled = false; m.castShadow = !!shadow && G.Q.shadows; root.add(m); return m; }
  var lamps = inst(LAMP, lampMat, LAMPS_MAX), heads = inst(HEAD, lampHeadMat, LAMPS_MAX), poles = inst(POLE, lampMat, LAMPS_MAX);
  var stops = inst(STOP, stdVC, 160, true), metros = inst(METRO_G, stdVC, 120), msigns = inst(MSIGN, mSignMat, 120);
  // пятна света фонарей на земле ночью
  var poolMat = new T.MeshBasicMaterial({ map: G.tex.glow, color: 0xffd9a8, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending });
  var POOL = new T.PlaneGeometry(13, 13).rotateX(-Math.PI / 2).translate(0, 0.13, 1.9);
  var pools = inst(POOL, poolMat, LAMPS_MAX);
  var mtx = new T.Matrix4(), qq = new T.Quaternion(), sc = new T.Vector3(), ps = new T.Vector3(), UPV = new T.Vector3(0, 1, 0), tcol = new T.Color();
  function nearest(list, max, fx, fz) {
    if (list.length <= max) return list;
    list.forEach(function (t) { t.d = (t[0] - fx) * (t[0] - fx) + (t[1] - fz) * (t[1] - fz); });
    list.sort(function (a, b) { return a.d - b.d; }); list.length = max;
    return list;
  }
  function gather(src) { var all = []; Object.keys(src).forEach(function (k) { Array.prototype.push.apply(all, src[k]); }); return all; }
  function place(m, list, fn) { list.forEach(function (it, i) { fn(it); m.setMatrixAt(i, mtx.compose(ps, qq, sc)); }); m.count = list.length; m.instanceMatrix.needsUpdate = true; }
  function rebuildInst(fx, fz) {
    instDirty = false;
    var src = gather(treeSrc), kc = FC.places && FC.places.keepClear;
    if (kc) src = src.filter(function (t) { return !kc(t[0], t[1]); });        // у места с exterior.clear деревьев нет (fplaces)
    var all = nearest(src, TREES_MAX, fx, fz), by = [[], [], [], []];
    all.forEach(function (t) { by[t[5] | 0].push(t); });
    var winter = G.look && G.look.snow;
    by.forEach(function (l, s) {
      var m = trees[s];
      l.forEach(function (t, i) {
        qq.setFromAxisAngle(UPV, t[2]); sc.set(t[3] * (0.9 + t[4] * 0.2), t[3], t[3] * (0.9 + t[4] * 0.2)); ps.set(t[0], 0, t[1]);
        m.setMatrixAt(i, mtx.compose(ps, qq, sc));
        var v = t[4];
        if (winter && s !== 3) tcol.setRGB(1.3 + v * 0.2, 1.05 + v * 0.1, 1.0); else tcol.setRGB(0.85 + v * 0.3, 0.88 + v * 0.22, 0.8 + v * 0.25);
        m.setColorAt(i, tcol);
      });
      m.count = l.length; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
    var ls = nearest(gather(lampSrc), LAMPS_MAX, fx, fz);
    sc.set(1, 1, 1);
    place(lamps, ls, function (l) { qq.setFromAxisAngle(UPV, l[2]); ps.set(l[0], 0, l[1]); });
    place(heads, ls, function (l) { qq.setFromAxisAngle(UPV, l[2]); ps.set(l[0], 0, l[1]); });
    place(pools, ls, function (l) { qq.setFromAxisAngle(UPV, l[2]); ps.set(l[0], 0, l[1]); });
    place(poles, nearest(gather(poleSrc), LAMPS_MAX, fx, fz), function (l) { qq.identity(); ps.set(l[0], 0, l[1]); });
    var st = nearest(gather(stopSrc), 160, fx, fz);
    place(stops, st, function (s) { qq.setFromAxisAngle(UPV, s[2]); ps.set(s[0], 0.1, s[1]); });
    var me = nearest(gather(metroSrc), 120, fx, fz);
    place(metros, me, function (s) { qq.setFromAxisAngle(UPV, -s[2]); ps.set(s[0], 0.1, s[1]); });
    place(msigns, me, function (s) { qq.setFromAxisAngle(UPV, -s[2]); ps.set(s[0], 0.1, s[1]); });
  }

  /* ---- машины во дворах: места вдоль проездов и на стоянках; ставим через FC.cars, когда игрок рядом ---------- */
  var parked = [], PARK_COL = [0xc0c3c8, 0xf1f1ef, 0x2a2c30, 0x5b6068, 0x7a1f1f, 0x2b3f63, 0x3d4d3b, 0xb9a98a, 0x9aa0a6, 0xd9d9d6, 0x4a2a2a];
  /* Что стоит во дворе — по району (23.11: «Маяк — крутой район, тачки должны быть заряженные»). Уровни — по ценам
   * жилья (элитный центр у пл. Победы, Немига, Верхний город и Троицкое, проспекты, новые кварталы «Маяк Минска»):
   * 3 — премиум (люкс, бизнес, спорт, GT, электро, изредка суперкар; часть — заниженные), 2 — выше среднего,
   * 1 — обычный спальный, 0 — заводские посёлки. Вес — сколько «билетов» у модели в лотерее места. */
  var RICH = { "Маяк Минска": 3, "Верхний город": 3, "Немига": 3, "Троицкое": 3, "Центр": 3, "Проспект Победителей": 3,
    "Проспект Независимости": 3, "Октябрьская": 3, "Зыбицкая": 3, "Дрозды": 3, "Мир-Сити": 2, "Комаровка": 2, "Восток": 2,
    "Золотая Горка": 2, "Захарова-Пулихова": 2, "Новая Боровая": 2, "Зелёная гавань": 2, "Вокзал": 2,
    "Тракторный завод": 0, "Тракторозаводской посёлок": 0, "Автозаводской Посёлок": 0, "Посёлок Велозавода": 0, "Шабаны": 0 };
  var PARK_W = [
    { eco: 4, stavr: 3, sedan: 3, van: 1.5, hanul: 2, bremer: 1, truck: 0.3 },
    { sedan: 3, bremer: 2, vltava: 2, xd_gr: 2, kaze3: 1, xd_cool: 2, hanul: 1.5, tundrus: 0.7, yamaki: 0.6, ev_cube: 0.6, van: 0.5, taxi: 0.4, moto_c: 0.3 },
    { yamaki: 2, kronw: 1.5, ingw: 1.5, rhein: 1, xd_atl: 2, xd_cool: 1.5, tundrus: 1.5, rhein_f: 1, ev: 1.5, xd_ev: 1, vltava: 1, kaze3: 1, kaze_rd: 0.5, ev_x: 0.5, moto: 0.3 },
    { kronw_i: 2.5, ashbury: 2, kronw: 2, rhein: 2, ingw: 1.5, rhein_f: 2.5, tundrus: 1.5, ingw_st: 1.5, sport: 1.2, crewf: 1, kaze_rd: 1, muscle: 0.6,
      ev_x: 1.5, ev_bolt: 1, ev: 1, tauro: 0.35, corsaro: 0.35, hyper: 0.15, moto: 0.5 }
  ];
  var RICH_COL = [0x111214, 0x1a1c20, 0xf4f4f2, 0x2b2f36, 0x5b6068, 0x0f2a4a, 0x3a0d12, 0xc9a24a, 0xe8e8e6, 0xff6a1a, 0x9be02a];
  function tierAt(x, z) {
    var d = M.district ? M.district(x, z) : null, n = d && d.name;
    return n != null && RICH[n] != null ? RICH[n] : 1;
  }
  function parkPick(x, z, r) {
    var t = tierAt(x, z), W = PARK_W[t], keys = Object.keys(W).filter(function (k) { return FC.cars.TYPES[k]; }), sum = 0;
    keys.forEach(function (k) { sum += W[k]; });
    var u = r * sum, type = keys[0];
    for (var i = 0; i < keys.length; i++) { u -= W[keys[i]]; if (u <= 0) { type = keys[i]; break; } }
    var rich = t === 3, col = rich ? RICH_COL[Math.floor(r * 977) % RICH_COL.length] : PARK_COL[Math.floor(r * 977) % PARK_COL.length];
    return { type: type, opt: { parked: true, color: col, tune: rich && ((r * 31) % 1) < 0.35 ? { lower: true, color: col } : null } };
  }
  function parkTick() {
    if (!FC.cars || !FC.cars.spawn || !FC.player) return;
    // во дворах: появляются до 200 м, в кадре — не ближе 170 м (на скорости не возникают перед носом), убираются за 250 м
    var P = FC.player, R1 = 200, R2 = 250, fill = performance.now() < (FC.fillUntil || 0) || !FC.started;
    for (var i = parked.length - 1; i >= 0; i--) {
      var c = parked[i].car;
      if (c.dead || !c.parked || c.driver !== "none") { parked[i].spot.used = false; parked.splice(i, 1); continue; }
      if (FC.dist2(c.x, c.z, P.x, P.z) > R2 * R2) { FC.cars.remove(c); parked[i].spot.used = false; parked.splice(i, 1); }
    }
    if (parked.length >= PARK_MAX || (FC.inside && FC.inside.active)) return;
    var cand = [];
    Object.keys(spotSrc).forEach(function (k) {
      var s = byKey[k]; if (rectD(s, P.x, P.z) > R1) return;
      spotSrc[k].forEach(function (sp) { if (!sp.used && FC.dist2(sp[0], sp[1], P.x, P.z) < R1 * R1) cand.push(sp); });
    });
    cand.sort(function (a, b) { return FC.dist2(a[0], a[1], P.x, P.z) - FC.dist2(b[0], b[1], P.x, P.z); });
    for (var j = 0; j < cand.length && parked.length < PARK_MAX; j++) {
      var sp = cand[j];
      var dsp = FC.dist2(sp[0], sp[1], P.x, P.z);
      if (dsp < 20 * 20) continue;                                          // не прямо на глазах
      if (!fill && dsp < 170 * 170 && G.inView && G.inView(sp[0], 1, sp[1])) continue;
      if (M.buildingAt(sp[0], sp[1], 1.2) || FC.cars.list.some(function (c) { return FC.dist2(c.x, c.z, sp[0], sp[1]) < 9; })) { sp.used = true; continue; }
      var r = sp[3], pk = parkPick(sp[0], sp[1], r), car = FC.cars.spawn(pk.type, sp[0], sp[1], sp[2], pk.opt);
      if (!car) break;
      sp.used = true; parked.push({ car: car, spot: sp });
    }
  }

  /* ---- светофоры: головы у перекрёстков рядом с фокусом, цвет — по фазе подъезда --------------------------- */
  var SIG_MAX = 480;
  var sigPole = new T.InstancedMesh(new T.CylinderGeometry(0.1, 0.12, 4.2, 5, 1, true).translate(0, 2.1, 0), G.mat.std(0x2c3035, 0.5, 0.5), SIG_MAX);
  var sigBox = new T.InstancedMesh(new T.BoxGeometry(0.45, 1.25, 0.35).translate(0, 4.0, 0), G.mat.std(0x1d2024, 0.6), SIG_MAX);
  var sigLamp = new T.InstancedMesh(new T.BoxGeometry(0.3, 0.3, 0.1).translate(0, 4.0, 0.2), new T.MeshBasicMaterial({ color: 0xffffff }), SIG_MAX);
  sigLamp.setColorAt(0, tcol.setHex(0x222222));
  [sigPole, sigBox, sigLamp].forEach(function (m) { m.count = 0; m.frustumCulled = false; root.add(m); });
  var heads2 = [], sigAt = { x: 1e9, z: 1e9 };
  function rebuildSignals(fx, fz) {
    sigAt.x = fx; sigAt.z = fz; heads2 = [];
    var R = LV === "low" ? 260 : 400;
    M.nodes.forEach(function (n) {
      if (!n.signal || Math.abs(n.x - fx) > R || Math.abs(n.z - fz) > R) return;
      n.edges.forEach(function (ei) {
        var e = M.edges[ei];
        if ((e.oneway && e.b !== n.i) || heads2.length >= SIG_MAX) return;     // только подъезды
        var k = e.px.length - 1, dx, dz;
        if (e.a === n.i) { dx = e.px[1] - e.px[0]; dz = e.pz[1] - e.pz[0]; } else { dx = e.px[k - 1] - e.px[k]; dz = e.pz[k - 1] - e.pz[k]; }
        var l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        var o = n.vr.w / 2 + 1.5, side = e.w / 2 + 1.2;   // справа от едущих к узлу: (dz, −dx)
        heads2.push([n.i, ei, n.x + dx * o + dz * side, n.z + dz * o - dx * side, Math.atan2(dx, dz)]);
      });
    });
    heads2.forEach(function (h, i) {
      qq.setFromAxisAngle(UPV, h[4]); ps.set(h[2], 0.15, h[3]); sc.set(1, 1, 1); mtx.compose(ps, qq, sc);
      sigPole.setMatrixAt(i, mtx); sigBox.setMatrixAt(i, mtx); sigLamp.setMatrixAt(i, mtx);
    });
    [sigPole, sigBox, sigLamp].forEach(function (m) { m.count = heads2.length; m.instanceMatrix.needsUpdate = true; });
  }
  var SIGC = { g: 0x2bff6a, y: 0xffc21a, r: 0xff2a2a }, lastSig = -1;

  /* ---- подгрузка: суперкуски в радиусе от фокуса камеры ---------------------------------------------------- */
  var SUPERS = D.supers.map(function (s) { return { key: s[0] + "_" + s[1], x0: s[0] * SUP, z0: s[1] * SUP }; });
  var byKey = {}; SUPERS.forEach(function (s) { byKey[s.key] = s; });
  function rectD(s, x, z) {
    var dx = Math.max(s.x0 - x, 0, x - s.x0 - SUP), dz = Math.max(s.z0 - z, 0, z - s.z0 - SUP);
    return Math.hypot(dx, dz);
  }
  function stream(fx, fz) {
    var keep = {};
    SUPERS.forEach(function (s) {
      if (rectD(s, fx, fz) >= R_LOAD) return;
      keep[s.key] = 1;
      if (!loaded[s.key] && !pending[s.key] && queue.indexOf(s.key) < 0 && !(job && job.key === s.key) && !ready.some(function (r) { return r[0] === s.key; })) queue.push(s.key);
    });
    queue = queue.filter(function (k) { return keep[k]; });
    queue.sort(function (a, b) { return rectD(byKey[a], fx, fz) - rectD(byKey[b], fx, fz); });
    Object.keys(loaded).forEach(function (k) { if (rectD(byKey[k], fx, fz) > R_DROP) drop(k); });
  }
  function pump() {
    while (inflight < 3 && queue.length) {
      var k = queue.shift();
      pending[k] = 1; inflight++;
      (function (key) {
        fetch(BASE + "s_" + key + ".json?v=" + D.v).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
          .then(function (d) { ready.push([key, d]); }, function () { /* кусок не пришёл — попробуем при следующем обходе */ })
          .then(function () { inflight--; delete pending[key]; });
      })(k);
    }
    var t0 = performance.now();
    if (!job && ready.length) {
      var f = G.focus || G.camera.position;
      ready.sort(function (a, b) { return rectD(byKey[a[0]], f.x, f.z) - rectD(byKey[b[0]], f.x, f.z); });
      var r = ready.shift();
      if (!loaded[r[0]] && rectD(byKey[r[0]], f.x, f.z) < R_DROP) startJob(r[0], r[1]);
    }
    if (job) stepJob(t0);
  }

  /* ---- столкновения: круг против многоугольника ------------------------------------------------------------ */
  // записи домов вокруг точки (без частей-«только стен»)
  function near(x, z, r) { return nearAll(x, z, r).filter(function (it) { return !it.colOnly; }); }
  function nearAll(x, z, r) {
    var out = [], seen = new Set();
    for (var gx = Math.floor((x - r) / GRID); gx <= Math.floor((x + r) / GRID); gx++)
      for (var gz = Math.floor((z - r) / GRID); gz <= Math.floor((z + r) / GRID); gz++) {
        var l = grid[gx + "," + gz]; if (!l) continue;
        for (var i = 0; i < l.length; i++) if (!seen.has(l[i])) { seen.add(l[i]); out.push(l[i]); }
      }
    return out;
  }
  function edgeDist(p, x, z, out) {
    var best = 1e9;
    for (var i = 0, j = p.length - 1; i < p.length; j = i++) {
      var ax = p[j][0], az = p[j][1], ex = p[i][0] - ax, ez = p[i][1] - az, L = ex * ex + ez * ez || 1e-9;
      var t = ((x - ax) * ex + (z - az) * ez) / L; t = t < 0 ? 0 : t > 1 ? 1 : t;
      var qx = ax + ex * t, qz = az + ez * t, d = Math.hypot(x - qx, z - qz);
      if (d < best) { best = d; if (out) { out[0] = qx; out[1] = qz; } }
    }
    return best;
  }
  var q2 = [0, 0];
  function collide(x, z, r) {
    var hit = false, nx = 0, nz = 0, list = nearAll(x, z, r + 1);
    for (var k = 0; k < list.length; k++) {
      var it = list[k];
      if (it.nocol) continue;
      if (x < it.x0 - r || x > it.x1 + r || z < it.z0 - r || z > it.z1 + r) continue;
      var inside = pipP(x, z, it.p), best = edgeDist(it.p, x, z, q2);
      if (inside || best < r) {
        var dx = x - q2[0], dz = z - q2[1], dl = Math.hypot(dx, dz) || 1e-6;
        if (inside) { dx = -dx; dz = -dz; }
        x = q2[0] + dx / dl * r; z = q2[1] + dz / dl * r; hit = true; nx = dx / dl; nz = dz / dl;
      }
    }
    return { x: x, z: z, hit: hit, nx: nx, nz: nz };
  }
  function itemAt(x, z, pad) {
    pad = pad || 0;
    var list = near(x, z, pad + 1);
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (it.nocol && pad > 0) continue;                       // контур с частями — не препятствие для проверок «рядом дом»
      if (x < it.x0 - pad || x > it.x1 + pad || z < it.z0 - pad || z > it.z1 + pad) continue;
      if (pipP(x, z, it.p) || (pad > 0 && edgeDist(it.p, x, z) <= pad)) return it;
    }
    return null;
  }
  function water(x, z) {
    for (var i = 0; i < waters.length; i++) { var w = waters[i], bb = w.bb; if (x >= bb[0] && x <= bb[2] && z >= bb[1] && z <= bb[3] && pipP(x, z, w.p)) return true; }
    for (var j = 0; j < waterLines.length; j++) {
      var l = waterLines[j], b2 = l.bb; if (x < b2[0] || x > b2[2] || z < b2[1] || z > b2[3]) continue;
      for (var k = 1; k < l.p.length; k++) if (segDist(x, z, l.p[k - 1][0], l.p[k - 1][1], l.p[k][0], l.p[k][1]) < l.w / 2) return true;
    }
    return false;
  }
  function remask(x0, z0, x1, z1) {
    Object.keys(loaded).forEach(function (k) {
      var s = byKey[k]; if (s.x0 > x1 || s.x0 + SUP < x0 || s.z0 > z1 || s.z0 + SUP < z0) return;
      var data = loaded[k].data; drop(k); ready.push([k, data]);
    });
  }

  /* ---- кадр ----------------------------------------------------------------------------------------------- */
  var t = 0, pt = 0, lastF = { x: 1e9, z: 1e9 }, lastSnow = null;
  FC.addSystem({
    name: "osm", order: 39,
    update: function (dt) {
      t += dt; pt += dt;
      var f = G.focus || G.camera.position;
      if (t > 0.4) {
        t = 0; stream(f.x, f.z); nearVis(false);
        ground.position.x = Math.round(f.x / 500) * 500; ground.position.z = Math.round(f.z / 500) * 500;
        var n = G.night || 0;
        lampHeadMat.emissiveIntensity = n * 2.4; poolMat.opacity = n * 0.55;
        GL.mat.emissiveIntensity = 0.05 + n * 0.6; mSignMat.emissiveIntensity = 0.15 + n * 0.9;
        var snow = !!(G.look && G.look.snow);
        if (instDirty || snow !== lastSnow || Math.hypot(f.x - lastF.x, f.z - lastF.z) > 260) { lastSnow = snow; lastF.x = f.x; lastF.z = f.z; rebuildInst(f.x, f.z); }
        if (Math.hypot(f.x - sigAt.x, f.z - sigAt.z) > 120) rebuildSignals(f.x, f.z);
      }
      if (pt > 1.1) { pt = 0; try { parkTick(); } catch (e) { /* машины — не критично для города */ } }
      pump();
      var key = Math.floor(FC.clock.t / FC.clock.speed * 4);
      if (key !== lastSig && heads2.length) {
        lastSig = key;
        for (var i = 0; i < heads2.length; i++) sigLamp.setColorAt(i, tcol.setHex(SIGC[M.signal(heads2[i][0], null, heads2[i][1])]));
        sigLamp.instanceColor.needsUpdate = true;
      }
    }
  });

  // сразу при загрузке — куски вокруг места старта (сохранённого или у библиотеки): качаются, пока грузится остальное
  (function prefetch() {
    var p = FC.save && FC.save.pos, x = p && p.x != null ? p.x : D.start[0], z = p && p.z != null ? p.z : D.start[1];
    stream(x, z); queue = queue.slice(0, 6);
    while (inflight < 3 && queue.length) pump();
  })();
  FC.on("start", function () { bootT = performance.now(); });

  /* ---- интерьер: вырез оболочки своего дома и земли под полом (FC.inside шлёт события — finside.js не трогаем) ---- */
  FC.on("inside:enter", function (e) {
    var B = e && e.building, p = B && B.poly; if (!p || !G.cut) return;
    var o = obb(p); if (!o) return;
    G.cut({ x: o.x, z: o.z, ux: o.ux, uz: o.uz, hl: o.L / 2 + 0.35, hw: o.W / 2 + 0.35, top: (B.h || 30) + 1.5 });
  });
  FC.on("inside:exit", function () { if (G.cut) G.cut(null); });

  FC.osm = {
    propsDirty: function () { instDirty = true; },
    // вывески магазинов на фасадах рядом: [x, y, z, ux, uz, ширина] — таблички мест (fplaces) обходят их
    signsNear: function (x, z, r) {
      var out = [];
      Object.keys(signSrc).forEach(function (k) { var l = signSrc[k]; for (var i = 0; i < l.length; i++) if (Math.abs(l[i][0] - x) < r && Math.abs(l[i][2] - z) < r) out.push(l[i]); });
      return out;
    },
    ready: true, meta: D, root: root, collide: collide, itemAt: itemAt, near: near, water: water, tierAt: tierAt, parkPick: parkPick,
    chunksLoaded: function () { return Object.keys(loaded).length; },
    loadedKeys: function () { return Object.keys(loaded); },
    busy: function () { return !!job || queue.length > 0 || inflight > 0 || ready.length > 0; },
    // маска ориентира: дома OSM с центром внутри не рисуются (столкновения остаются); задетые куски пересобираются
    mask: function (x, z, r) { masks.push({ x: x, z: z, r: r }); remask(x - r, z - r, x + r, z + r); },
    maskPoly: function (p) {
      var bb = bbOf(p); masks.push({ p: p, x0: bb[0], z0: bb[1], x1: bb[2], z1: bb[3] }); remask(bb[0], bb[1], bb[2], bb[3]);
    },
    metro: function () { return gather(metroSrc); },
    parked: function () { return parked.length; },
    debug: { grid: grid, loaded: loaded, masks: masks }
  };
  // FC.build в Минске: корень городских мешей, светофоры, видимость (подвал прячет город)
  FC.build = { root: root, signal: M.signal, facade: facadeMat, setVisible: function (v) { root.visible = v; } };
})(window);
