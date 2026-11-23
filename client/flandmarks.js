/* Флейм-Сити — Минск: узнаваемые места, фасады и атмосфера улиц. Работает только в Минске (FC_CITY / FC.map.city /
 * FC.osm.ready), во Флейм-Сити молчит.
 *
 * Задача: «все здания в Минске должны быть узнаваемыми, максимально, проспекты».
 * Что здесь:
 *  • ориентиры — стилизованные низкополигональные модели в настоящих координатах (x = (lon − 27.58)·cos 53.9°·111320,
 *    z = −(lat − 53.9)·110540): Нацбиблиотека с медиафасадом, Ворота Минска с часами по игровому времени, «Арена»,
 *    Дворец спорта, башня «Мир-Сити», колесо обозрения, звезда и огонь на площади Победы, маяк, купола площади
 *    Независимости. Без барельефов, скульптур и гербов — силуэт, а не копия (в Беларуси нет свободы панорамы);
 *  • исторический центр «как в OSM 3D» — Верхний город, Троицкое, Красный костёл, Ратуша (куранты каждый игровой час),
 *    собор, вокзал, Дворец Республики, театр, цирк, Royal-башня: части зданий с высотами и крышами (скатные, шатры,
 *    купола, луковицы) из tex/minsk-landmarks.json (© участники OpenStreetMap, ODbL; сборка — tools/);
 *  • проспекты: текстурные фасады (сталинки Независимости, хрущёвки, панельки с балконами, новостройки Мир-Сити,
 *    офисное стекло, пастель старого города — атлас tex/facades.webp, виды 7–14 шейдера фасада), троллейбусная
 *    контактная сеть, торшеры, остановки и киоски; метро «М» у настоящих входов — поездка между станциями за $5;
 *    Зыбицкая (гирлянды, террасы, неон баров с выдуманными названиями), мозаики на торцах панелек у «Востока»,
 *    вывески «Аптека», «Продукты» на первых этажах (без брендов).
 * Дома OSM под ориентиром прячутся: FC.osm.mask(x, z, r), если он есть; иначе — схлопыванием их вершин в готовом
 * меше куска (дом = непрерывный отрезок вершин с одинаковым aFac). Там же — выбор текстурного вида по району и высоте.
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE;
  if (!FC || !T || !FC.gfx) return;
  var G = FC.gfx;
  var DATA_URL = "tex/minsk-landmarks.json";
  var Z3_ON = !!global.FQ_Z3;                              // старые зоны — только для сравнения (?…&FQ_Z3)
  var LOAD_D = 1500, DROP_D = 2100;                     // строим ориентир ближе LOAD_D к фокусу камеры, убираем дальше DROP_D

  function inMinsk() { return global.FC_CITY === "minsk" || !!(FC.map && FC.map.city === "minsk") || !!(FC.osm && FC.osm.ready); }

  var D = null, root = null, active = false, MAT = {}, sites = [], t0 = 0;
  var low = function () { return G.Q.level === "low"; };

  /* ---- материалы ----------------------------------------------------------------------------------------------- */
  function S(hex, r, m, o) { var x = new T.MeshStandardMaterial({ color: hex, roughness: r == null ? 0.8 : r, metalness: m || 0 }); if (o) Object.keys(o).forEach(function (k) { x[k] = o[k]; }); return x; }
  function lin(hex) { return new T.Color(hex); }       // r160: sRGB → линейный рабочий цвет
  function initMats() {
    MAT.vc = S(0xffffff, 0.8, 0.05, { vertexColors: true });
    MAT.roof = S(0xffffff, 0.72, 0.15, { vertexColors: true, side: T.DoubleSide });
    MAT.fac = G.mat.facade();
    MAT.gold = S(0xd9aa3c, 0.3, 0.9);
    MAT.glass = S(0x6f9fb4, 0.08, 0.7, { transparent: true, opacity: 0.55, side: T.DoubleSide, depthWrite: false });
    MAT.dark = S(0x24292b, 0.55, 0.45);
    MAT.wire = S(0x1b1d1f, 0.7, 0.3);
    MAT.glow = S(0xfff3dc, 0.4, 0, { emissive: new T.Color(0xffdcaa), emissiveIntensity: 0.15 });
    MAT.flame = new T.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.85, blending: T.AdditiveBlending, depthWrite: false });
    MAT.jet = new T.MeshBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.35, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide });
    MAT.beam = new T.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide });
    // лампочки гирлянд — круглые тёплые огоньки с ореолом (раньше — квадраты по полметра)
    var bulbTex = G.tex.canvas(64, 64, function (x) { var gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.25, "rgba(255,255,255,.9)"); gr.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); });
    MAT.bulb = new T.PointsMaterial({ size: 0.26, map: bulbTex, vertexColors: true, transparent: true, opacity: 1, blending: T.AdditiveBlending, depthWrite: false });
    MAT.led = ledMaterial(0x2b5664, 0);
    MAT.ledArena = ledMaterial(0xdfe5ea, 1);
    MAT.ledTower = ledMaterial(0x2d4b5c, 2);
  }
  // стекло с медиафасадом: ночью — бегущие цветные волны пикселями (Нацбиблиотека), полосы (Арена), огни короны (башня)
  function ledMaterial(hex, mode) {
    var m = S(hex, mode === 1 ? 0.5 : 0.22, mode === 1 ? 0.2 : 0.45);
    m.customProgramCacheKey = function () { return "fq-led-" + mode; };
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uT = G.uniforms.time; sh.uniforms.uN = G.uniforms.night;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vLw;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLw = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uT, uN; varying vec3 vLw;")
        .replace("#include <color_fragment>", mode === 1 ? "#include <color_fragment>" : [
          "#include <color_fragment>",
          // днём — стеклянные панели с переплётом и отсветом неба сверху
          "{ vec2 gq = vec2((vLw.x + vLw.z) / 3.2, vLw.y / 3.0); vec2 gf = abs(fract(gq) - 0.5); vec2 gw = fwidth(gq) * 1.5;",
          "  float fr = max(1.0 - smoothstep(0.47 - gw.x, 0.47, gf.x), 1.0 - smoothstep(0.46 - gw.y, 0.46, gf.y));",
          "  fr = max(1.0 - smoothstep(0.03, 0.03 + gw.x, 0.5 - gf.x), 1.0 - smoothstep(0.04, 0.04 + gw.y, 0.5 - gf.y));",
          "  float sh = 0.75 + 0.5 * fract(sin(dot(floor(gq), vec2(12.9898, 78.233))) * 43758.5453);",
          "  diffuseColor.rgb = mix(diffuseColor.rgb * sh, vec3(0.62, 0.66, 0.68), fr * 0.8 * (1.0 - uN * 0.7)); }"].join("\n"))
        .replace("#include <emissivemap_fragment>", [
          "#include <emissivemap_fragment>",
          "{ float y = vLw.y;",
          "  vec2 px = floor(vec2((vLw.x + vLw.z) * 0.9, y * 0.9)); vec2 fp = fract(vec2((vLw.x + vLw.z) * 0.9, y * 0.9));",
          "  float dot1 = step(0.18, fp.x) * step(0.18, fp.y);",
          "  vec3 c = 0.5 + 0.5 * cos(6.2831 * (uT * 0.06 + y * 0.012 + (vLw.x - vLw.z) * 0.004 + vec3(0.0, 0.33, 0.67)));",
          "  float wave = 0.55 + 0.45 * sin(y * 0.18 - uT * 1.4 + (vLw.x + vLw.z) * 0.05);",
          "  float mode = mod(floor(uT / 14.0), 3.0);",
          "  if (mode > 0.5 && mode < 1.5) { wave = step(0.5, fract(y * 0.05 - uT * 0.25)); c = mix(vec3(0.2, 0.6, 1.0), vec3(1.0, 0.35, 0.6), step(0.5, fract(y * 0.025))); }",
          "  if (mode > 1.5) { float sp = fract(sin(dot(px + floor(uT * 3.0), vec2(12.9898, 78.233))) * 43758.5453); wave = step(0.82, sp); c = vec3(1.0, 0.92, 0.75); }",
          mode === 1 ? "  wave = 0.35 + 0.65 * step(0.5, fract((vLw.x * 0.7 + vLw.z * 0.7) * 0.08 + uT * 0.2)); c = mix(vec3(0.3, 0.7, 1.0), vec3(1.0, 0.5, 0.2), 0.5 + 0.5 * sin(uT * 0.3)); dot1 = 1.0;" : "",
          mode === 2 ? "  wave = step(0.6, fract(y * 0.08 - uT * 0.5)) * step(150.0, y); c = vec3(0.6, 0.85, 1.0); dot1 = 1.0;" : "",
          "  totalEmissiveRadiance += c * wave * dot1 * uN * " + (mode === 1 ? "0.9" : "1.6") + "; }"
        ].join("\n"));
    };
    return m;
  }

  /* ---- геометрия: набор деталей → один меш на материал --------------------------------------------------------- */
  function strip(g, keepUv) {
    if (g.index) g = g.toNonIndexed();
    ["uv1", "uv2", "color"].concat(keepUv ? [] : ["uv"]).forEach(function (n) { if (g.attributes[n]) g.deleteAttribute(n); });
    return g;
  }
  function paint(g, hex) {
    var c = lin(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute("color", new T.BufferAttribute(a, 3));
    return g;
  }
  function facAttr(g, st, seed, tint, hex) {
    var n = g.attributes.position.count, f = new Float32Array(n * 4), c = new Float32Array(n * 4), col = hex ? lin(hex) : null;
    for (var i = 0; i < n; i++) {
      f[i * 4] = st; f[i * 4 + 1] = seed; f[i * 4 + 2] = tint; f[i * 4 + 3] = 0;
      if (col) { c[i * 4] = col.r; c[i * 4 + 1] = col.g; c[i * 4 + 2] = col.b; c[i * 4 + 3] = 0; } else c[i * 4 + 3] = 1;
    }
    g.setAttribute("aFac", new T.BufferAttribute(f, 4)); g.setAttribute("aCol", new T.BufferAttribute(c, 4));
    return g;
  }
  function Kit() { this.p = {}; }
  // key — материал MAT[key]; col — цвет вершин (для vc/roof); fac — [вид, сид, оттенок, цвет] для фасада
  Kit.prototype.add = function (key, geo, x, y, z, ry, col, fac) {
    var m = MAT[key], g = strip(geo, !!(m && m.map));
    if (ry) g.rotateY(ry);
    g.translate(x || 0, y || 0, z || 0);
    if (col != null) paint(g, col);
    if (fac) facAttr(g, fac[0], fac[1], fac[2], fac[3]);
    (this.p[key] || (this.p[key] = [])).push(g);
    return g;
  };
  Kit.prototype.build = function (grp, shadow) {
    var self = this;
    Object.keys(this.p).forEach(function (k) {
      var list = self.p[k]; if (!list.length) return;
      var geo = list.length === 1 ? list[0] : T.mergeGeometries(list, false);
      if (!geo) { if (global.console) console.warn("flandmarks: не склеилось", k); return; }
      geo.computeBoundingSphere();
      var mesh = new T.Mesh(geo, MAT[k]);
      mesh.castShadow = !!shadow && G.Q.shadows && k !== "glow" && k !== "glass" && k !== "wire";
      mesh.receiveShadow = G.Q.shadows && k !== "glass";
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      grp.add(mesh);
    });
    this.p = {};
  };
  // треугольники в мировых координатах (крыши, клинья): нормали — по граням, материал двусторонний
  function Tri() { this.v = []; }
  Tri.prototype.t = function (a, b, c) { this.v.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); return this; };
  Tri.prototype.q = function (a, b, c, d) { return this.t(a, b, c).t(a, c, d); };
  Tri.prototype.geo = function () { var g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(this.v, 3)); g.computeVertexNormals(); return g; };

  function box(w, h, d) { return new T.BoxGeometry(w, h, d).translate(0, h / 2, 0); }
  function cyl(rt, rb, h, seg) { return new T.CylinderGeometry(rt, rb, h, seg || 12).translate(0, h / 2, 0); }
  function shapeOf(p) {
    var s = new T.Shape(); s.moveTo(p[0][0], -p[0][1]);
    for (var i = 1; i < p.length; i++) s.lineTo(p[i][0], -p[i][1]);
    s.closePath(); return s;
  }
  function extrude(p, y0, y1) {
    var g = new T.ExtrudeGeometry(shapeOf(p), { depth: Math.max(0.1, y1 - y0), bevelEnabled: false, curveSegments: 1 });
    g.rotateX(-Math.PI / 2); g.translate(0, y0, 0); return g;
  }
  function star(r, depth) {
    var s = new T.Shape();
    for (var i = 0; i < 10; i++) { var a = Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.42 : r; if (i) s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    s.closePath();
    return new T.ExtrudeGeometry(s, { depth: depth, bevelEnabled: false }).translate(0, 0, -depth / 2);
  }
  function hash(s) { return FC.hash(String(s)); }
  // ориентированная рамка контура: угол a (в плоскости x–z), длина L вдоль a, ширина W, центр
  function obb(p) {
    var best = null;
    for (var i = 0; i < p.length; i++) {
      var q = p[(i + 1) % p.length], a = Math.atan2(q[1] - p[i][1], q[0] - p[i][0]), c = Math.cos(a), s = Math.sin(a);
      var u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
      for (var k = 0; k < p.length; k++) { var u = p[k][0] * c + p[k][1] * s, v = -p[k][0] * s + p[k][1] * c; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
      var ar = (u1 - u0) * (v1 - v0);
      if (!best || ar < best.ar) { var cu = (u0 + u1) / 2, cv = (v0 + v1) / 2; best = { ar: ar, a: a, L: u1 - u0, W: v1 - v0, x: cu * c - cv * s, z: cu * s + cv * c }; }
    }
    if (best.W > best.L) { best.a += Math.PI / 2; var t = best.L; best.L = best.W; best.W = t; }
    return best;
  }
  function loc(o) { var c = Math.cos(o.a), s = Math.sin(o.a); return function (u, v, y) { return [o.x + u * c - v * s, y, o.z + u * s + v * c]; }; }

  /* ---- крыши (simple 3D buildings): 1 двускатная, 2 вальмовая, 3 шатёр, 4 купол, 5 луковица, 6 односкатная, 7 свод */
  var ROOF_K = { 1: 0.35, 2: 0.3, 3: 0.45, 4: 0.5, 5: 1.1, 6: 0.2, 7: 0.3 };
  function roofH(rs, o) { var m = Math.min(o.L, o.W); if (rs === 3 && m < 10) return m * 1.5; return Math.max(1, Math.min(rs === 4 || rs === 5 ? 40 : 9, m * ROOF_K[rs])); }
  function roofGeo(rs, p, o, y0, rh) {
    var P = loc(o), L = o.L / 2, W = o.W / 2, y1 = y0 + rh, t = new Tri();
    if (rs === 1 || rs === 2) {
      var r = rs === 2 ? Math.max(0, L - W) : L;
      t.q(P(-L, -W, y0), P(L, -W, y0), P(r, 0, y1), P(-r, 0, y1)).q(P(L, W, y0), P(-L, W, y0), P(-r, 0, y1), P(r, 0, y1));
      t.t(P(L, -W, y0), P(L, W, y0), P(r, 0, y1)).t(P(-L, W, y0), P(-L, -W, y0), P(-r, 0, y1));
      return t.geo();
    }
    if (rs === 3) {
      var cx = 0, cz = 0; p.forEach(function (q) { cx += q[0]; cz += q[1]; }); cx /= p.length; cz /= p.length;
      for (var i = 0; i < p.length; i++) { var a = p[i], b = p[(i + 1) % p.length]; t.t([a[0], y0, a[1]], [b[0], y0, b[1]], [cx, y1, cz]); }
      return t.geo();
    }
    if (rs === 6) {
      t.q(P(-L, -W, y0), P(L, -W, y0), P(L, W, y1), P(-L, W, y1)).q(P(-L, W, y0), P(L, W, y0), P(L, W, y1), P(-L, W, y1));
      t.t(P(-L, -W, y0), P(-L, W, y0), P(-L, W, y1)).t(P(L, -W, y0), P(L, W, y0), P(L, W, y1));
      return t.geo();
    }
    if (rs === 7) {
      var N = 8, prev = null;
      for (var k = 0; k <= N; k++) {
        var th = Math.PI * k / N, v = -Math.cos(th) * W, y = y0 + Math.sin(th) * rh;
        if (prev) { t.q(P(-L, prev[0], prev[1]), P(L, prev[0], prev[1]), P(L, v, y), P(-L, v, y)); t.t(P(L, 0, y0), P(L, prev[0], prev[1]), P(L, v, y)).t(P(-L, 0, y0), P(-L, prev[0], prev[1]), P(-L, v, y)); }
        prev = [v, y];
      }
      return t.geo();
    }
    var g;
    if (rs === 5) {
      var pr = [[0.62, 0], [0.76, 0.14], [0.8, 0.3], [0.66, 0.52], [0.36, 0.76], [0.12, 0.9], [0.03, 1.0], [0, 1.06]].map(function (q) { return new T.Vector2(q[0] / 0.8, q[1]); });
      g = new T.LatheGeometry(pr, 12);
    } else g = new T.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(W, rh, W); if (rs === 4) g.scale(L / W, 1, 1);
    g.rotateY(-o.a); g.translate(o.x, y0, o.z);
    return g;
  }

  /* ---- исторический центр «как в OSM 3D»: части с высотами и крышами из данных ------------------------------ */
  var ZONE_WALL = { church: "#9b3f2b", govt: "#bdb7aa", rep: "#dcd8cf", opera: "#efe6d0", circus: "#e9e2cc", museum: "#cfcac0", vict: "#b9b1a3", gum: "#e8d8b4", station: "#efe3c2", island: "#f2efe8" };
  function buildZone(name, Z, grp) {
    var k = new Kit(), rt = new Kit();
    Z.b.forEach(function (r, i) {
      var p = []; for (var j = 0; j < r[7].length; j += 2) p.push([r[7][j], r[7][j + 1]]);
      if (p.length < 3) return;
      var h = r[0], mh = r[1], rs = r[2], rh = r[3], wc = r[4], rc = r[5], st = r[6];
      var o = obb(p), cx = o.x, cz = o.z;
      if (name === "church" && h >= 45) { rs = 3; rh = 13; }                        // главная башня костёла — шпиль
      if (name === "upper" && Math.hypot(cx + 1567, cz + 396) < 24) { wc = "#f4f2ec"; st = 16; }   // Ратуша — белая
      if (rs && !rh) rh = roofH(rs, o);
      if (rs && h - rh < mh + 0.3) rh = Math.max(0.5, (h - mh) * 0.5);
      var top = rs ? h - rh : h;
      if (st === 12) wc = "";                                                      // стеклу — свой цвет атласа
      if (!wc) wc = ZONE_WALL[name] || "";
      if (top - mh > 0.4) {
        var seed = hash(name + i) % 997;
        k.add("fac", extrude(p, mh, top), 0, 0, 0, 0, null, [st, seed, 0.93 + (seed % 13) / 100, wc]);
      }
      if (rs) {
        if (!rc) rc = rs === 4 || rs === 5 ? (name === "church" || name === "upper" && st === 16 ? "#4c3a30" : "#6f9a86") : rs === 3 ? "#5b463c" : name === "upper" || name === "trinity" ? "#8f4a33" : "#70757a";
        if (name === "museum" && rs === 4) rc = "#9fc4d6";
        rt.add("roof", roofGeo(rs, p, o, top, rh), 0, 0, 0, 0, rc);
      }
    });
    k.build(grp, true); rt.build(grp, true);
  }

  /* ---- ориентиры своей постройки ------------------------------------------------------------------------------- */
  // Нацбиблиотека: ромбокубооктаэдр (26 граней) на трёхъярусном стилобате; ночью — медиафасад
  function rhombicubo(s) {
    var q = 1 + Math.SQRT2, R = Math.sqrt(1 + q * q), t = new Tri(), A = [], B = [], i;
    for (i = 0; i < 4; i++) { var aa = Math.PI / 4 + i * Math.PI / 2; A.push([Math.cos(aa) * Math.SQRT2, Math.sin(aa) * Math.SQRT2]); }
    for (i = 0; i < 8; i++) { var bb = Math.PI / 8 + i * Math.PI / 4; B.push([Math.cos(bb) * R, Math.sin(bb) * R]); }
    function P(p, y) { return [p[0] * s, y * s, p[1] * s]; }
    [1, -1].forEach(function (sg) {
      t.q(P(A[0], q * sg), P(A[1], q * sg), P(A[2], q * sg), P(A[3], q * sg));
      for (var m = 0; m < 4; m++) {
        t.t(P(A[m], q * sg), P(B[2 * m], sg), P(B[2 * m + 1], sg));
        t.q(P(A[m], q * sg), P(B[2 * m + 1], sg), P(B[(2 * m + 2) % 8], sg), P(A[(m + 1) % 4], q * sg));
      }
    });
    for (i = 0; i < 8; i++) t.q(P(B[i], 1), P(B[(i + 1) % 8], 1), P(B[(i + 1) % 8], -1), P(B[i], -1));
    return t.geo();
  }
  function buildLibrary(grp) {
    var x = 4337, z = -3452, k = new Kit(), seed = 311;
    [[78, 0, 6.4], [68, 6.4, 12.8], [58, 12.8, 19.2]].forEach(function (t, i) {
      k.add("fac", new T.CylinderGeometry(t[0], t[0] + 1, t[2] - t[1], 8).translate(0, (t[1] + t[2]) / 2, 0), x, 0, z, Math.PI / 8, null, [i === 2 ? 12 : 15, seed + i, 1, i === 2 ? "" : "#d9d4c8"]);
      k.add("vc", new T.CylinderGeometry(t[0] + 1.2, t[0] + 1.2, 0.6, 8).translate(0, t[2], 0), x, 0, z, Math.PI / 8, 0xbfb8aa);
    });
    k.add("vc", new T.CylinderGeometry(92, 96, 0.4, 32).translate(0, 0.2, 0), x, 0, z, 0, 0xa49c8f);       // площадь вокруг
    var s = 11.6, cy = 73 - s * (1 + Math.SQRT2);
    var g = rhombicubo(s); g.rotateY(Math.PI / 8); g.translate(x, cy, z);
    k.add("led", g);
    k.add("vc", box(10, 1.2, 10), x, 73, z, Math.PI / 8, 0x2d3438);                                      // смотровая площадка
    k.add("glow", new T.TorusGeometry(70, 0.35, 4, 48).rotateX(Math.PI / 2).translate(0, 12.9, 0), x, 0, z);   // подсветка ярусов
    k.add("glow", new T.TorusGeometry(60, 0.35, 4, 48).rotateX(Math.PI / 2).translate(0, 19.3, 0), x, 0, z);
    k.build(grp, true);
  }
  // площадь Победы: звезда-орден на вершине обелиска и вечный огонь у подножия (сам обелиск — части OSM)
  var flames = [];
  function buildVictory(grp) {
    var x = -322.6, z = -958.9, k = new Kit();
    k.add("gold", star(2.6, 0.5), x, 41.2, z, 0.6);
    k.add("gold", star(2.6, 0.5), x, 41.2, z, 0.6 + Math.PI / 2);
    k.add("gold", new T.TorusGeometry(1.6, 0.18, 6, 20), x, 41.2, z, 0.6);
    k.add("vc", cyl(30, 31, 0.5, 40), x, 0, z, 0, 0x8e877d);                                                 // круг площади
    k.add("vc", cyl(10.5, 11, 0.6, 32), x, 0.5, z, 0, 0x5d5650);
    k.add("dark", cyl(1.6, 1.2, 0.9, 16), x + 9.5, 0, z, 0);                                                  // чаша огня
    k.build(grp, true);
    var f = new T.Mesh(new T.ConeGeometry(0.9, 2.2, 8, 1, true).translate(0, 1.9, 0), MAT.flame);
    f.position.set(x + 9.5, 0, z); grp.add(f); flames.push(f);
  }
  // стела «город-герой»: звезда на вершине; купол музея — часть OSM
  function buildStele(grp) {
    var k = new Kit();
    k.add("gold", star(2.4, 0.5), -2748, 46.6, -1759, 0.5);
    k.add("gold", star(2.4, 0.5), -2748, 46.6, -1759, 0.5 + Math.PI / 2);
    k.build(grp, true);
  }
  // Ворота Минска: короны башен (аттик, ротонда, шпиль), часы на левой — по игровому времени
  var clockTex = null, clockMin = -1;
  function drawClock() {
    var c = clockTex.image, x = c.getContext("2d"), w = c.width, r = w / 2;
    x.clearRect(0, 0, w, w);
    x.fillStyle = "#f6efdc"; x.beginPath(); x.arc(r, r, r - 2, 0, 7); x.fill();
    x.strokeStyle = "#7a5a2a"; x.lineWidth = 6; x.stroke();
    x.fillStyle = "#3a2a18";
    for (var i = 0; i < 12; i++) { var a = i * Math.PI / 6; x.save(); x.translate(r, r); x.rotate(a); x.fillRect(-3, -r + 10, 6, i % 3 ? 10 : 18); x.restore(); }
    var hh = FC.clock.hour % 12 + FC.clock.minute / 60, mm = FC.clock.minute;
    function hand(a, len, wd) { x.save(); x.translate(r, r); x.rotate(a); x.fillRect(-wd / 2, -len, wd, len + 8); x.restore(); }
    hand(hh * Math.PI / 6, r * 0.5, 8); hand(mm * Math.PI / 30, r * 0.78, 5);
    clockTex.needsUpdate = true;
  }
  function clockMat() {
    if (!MAT.clock) {
      var c = document.createElement("canvas"); c.width = c.height = 128;
      clockTex = new T.CanvasTexture(c); clockTex.colorSpace = T.SRGBColorSpace;
      MAT.clock = S(0xffffff, 0.6, 0, { map: clockTex, transparent: true, emissive: new T.Color(0xfff1d0), emissiveMap: clockTex, emissiveIntensity: 0.1 });
      drawClock();
    }
    return MAT.clock;
  }
  function towerTop(k, x, z, a, y, clock) {
    var ry = -a, W = 16.4, Dd = 18.8, w2 = 11, d2 = 12.4;
    k.add("fac", box(W - 0.6, 2.4, Dd - 0.6), x, y, z, ry, null, [15, 7, 1, "#efe2c6"]);                      // аттик
    k.add("vc", box(W + 0.8, 0.7, Dd + 0.8), x, y + 2.4, z, ry, 0xe9dcc2);
    k.add("fac", box(w2, 6.5, d2), x, y + 3.1, z, ry, null, [15, 8, 1, "#f3e6ca"]);                           // верхний ярус
    k.add("vc", box(w2 + 1.2, 0.6, d2 + 1.2), x, y + 9.6, z, ry, 0xe9dcc2);
    for (var i = 0; i < 8; i++) { var aa = i * Math.PI / 4; k.add("vc", cyl(0.35, 0.4, 5.5, 6), x + Math.cos(aa) * 4.2, y + 10.2, z + Math.sin(aa) * 4.2, 0, 0xf4ead4); }
    k.add("vc", cyl(5, 5, 0.7, 16), x, y + 15.7, z, 0, 0xe9dcc2);
    k.add("vc", new T.SphereGeometry(3.5, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), x, y + 16.4, z, 0, 0xd8cfb8);
    k.add("gold", new T.ConeGeometry(0.5, 7, 6).translate(0, 3.5, 0), x, y + 19.6, z);
    for (var j = 0; j < 4; j++) {
      var na = a + j * Math.PI / 2, off = (j % 2 ? d2 : w2) / 2 + 0.07, nx = Math.cos(na), nz = Math.sin(na);
      if (clock) k.add("clock", new T.CircleGeometry(3.2, 24), x + nx * off, y + 6.4, z + nz * off, Math.PI / 2 - na);
      else k.add("vc", new T.CylinderGeometry(3, 3, 0.3, 20).rotateX(Math.PI / 2), x + nx * (off + 0.1), y + 6.4, z + nz * (off + 0.1), Math.PI / 2 - na, 0xe6d6b0);
    }
  }
  function buildGates(grp) {
    clockMat();
    var k = new Kit();
    towerTop(k, -1841, 895.8, 0.31, 38.5, true);
    towerTop(k, -1896.2, 879.5, 0.32, 38.5, false);
    k.build(grp, true);
  }
  // Ратуша: часы на башне (циферблаты), куранты — каждый игровой час
  function buildHall(grp) {
    clockMat();
    var k = new Kit(), x = -1569.2, z = -397.9, a = -0.453;
    for (var j = 0; j < 4; j++) {
      var na = a + j * Math.PI / 2, nx = Math.cos(na), nz = Math.sin(na);
      k.add("clock", new T.CircleGeometry(1.6, 20), x + nx * 4.2, 21.5, z + nz * 4.2, Math.PI / 2 - na);
    }
    k.build(grp, false);
  }
  // Дворец спорта: квадратный стеклянный зал на подиуме, складчатый карниз-«корона»
  function buildSport(grp) {
    var x = -1983.5, z = -1187.5, a = 58.2 * Math.PI / 180, k = new Kit(), ry = -a;
    k.add("vc", box(92, 3, 86), x, 0, z, ry, 0xb8b2a6);
    k.add("fac", box(82, 17, 76), x, 3, z, ry, null, [12, 41, 1, ""]);
    var P = loc({ x: x, z: z, a: a }), t = new Tri(), n = 18, y0 = 20, y1 = 25.5, hx = 41, hz = 38;
    function edge(side, sv, y) { return side === 0 ? P(sv * hx, -hz, y) : side === 1 ? P(hx, sv * hz, y) : side === 2 ? P(-sv * hx, hz, y) : P(-hx, -sv * hz, y); }
    for (var side = 0; side < 4; side++) {
      for (var i = 0; i < n; i++) t.t(edge(side, -1 + 2 * i / n, y0), edge(side, -1 + 2 * (i + 0.5) / n, y1), edge(side, -1 + 2 * (i + 1) / n, y0));
    }
    k.add("vc", t.geo(), 0, 0, 0, 0, 0xeeeeea);
    k.add("vc", box(80, 1.2, 74), x, 19.4, z, ry, 0xd6d6d2);
    k.add("vc", box(84, 0.8, 78), x, 20, z, ry, 0xf2f2ee);
    k.build(grp, true);
    sign(grp, "ДВОРЕЦ СПОРТА", P(0, -38.6, 14.5), a - Math.PI / 2, 30, 3.2, "#ffffff", "rgba(0,0,0,0)", 1.2);
  }
  // «Арена»: диск Ø ~130 м, светодиодный пояс, белая пологая крыша
  function buildArena(grp) {
    var x = -6452.8, z = -3985.3, k = new Kit();
    k.add("fac", new T.CylinderGeometry(63, 64, 8, 48).translate(0, 4, 0), x, 0, z, 0, null, [15, 9, 1, "#8f8a84"]);
    k.add("ledArena", new T.CylinderGeometry(66.5, 63.5, 22, 64, 1, true).translate(0, 19, 0), x, 0, z);
    k.add("vc", new T.CylinderGeometry(67.5, 66.5, 1.2, 64).translate(0, 30.6, 0), x, 0, z, 0, 0xe8ebee);
    k.add("vc", new T.SphereGeometry(1, 40, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(66, 5, 66).translate(0, 31, 0), x, 0, z, 0, 0xf0f2f4);
    k.add("vc", cyl(95, 98, 0.3, 48), x, 0, z, 0, 0xa59f95);
    k.build(grp, true);
  }
  // «Мир-Сити»: стеклянная башня ~180 м с короной и шпилем, огни короны ночью
  function buildMirTower(grp) {
    var x = -2124, z = 3748, a = 80.5 * Math.PI / 180, k = new Kit();
    k.add("vc", box(46, 8, 46), x, 0, z, -a, 0x8d949a);
    k.add("fac", new T.CylinderGeometry(21, 22, 150, 8).translate(0, 83, 0), x, 0, z, -a + Math.PI / 8, null, [12, 77, 1, ""]);
    k.add("ledTower", new T.CylinderGeometry(15, 21, 22, 8, 1, true).translate(0, 169, 0), x, 0, z, -a + Math.PI / 8);
    k.add("vc", new T.CylinderGeometry(15.5, 15.5, 1, 8).translate(0, 180, 0), x, 0, z, -a + Math.PI / 8, 0x30363c);
    k.add("dark", new T.ConeGeometry(1.2, 18, 6).translate(0, 189, 0), x, 0, z);
    k.add("glow", new T.SphereGeometry(0.8, 8, 6), x, 198.5, z);
    k.build(grp, true);
    sign(grp, "МИР-СИТИ", [x + Math.cos(a) * 23, 12, z + Math.sin(a) * 23], a, 22, 3, "#e8f6ff", "rgba(0,0,0,0)", 1.4);
  }
  // колесо обозрения в Парке Горького (54 м): обод со спицами крутится, кабинки висят ровно
  var wheels = [];
  function buildWheel(grp) {
    var x = -372, z = -374, R = 25, cy = 29, ry = 0.95, k = new Kit();
    [-1, 1].forEach(function (sd) {
      [-1, 1].forEach(function (lg) {
        var g = new T.CylinderGeometry(0.35, 0.5, Math.hypot(cy, 11), 6), tilt = Math.atan2(11, cy) * lg;
        g.rotateZ(tilt); g.translate(lg * 5.5, cy / 2, sd * 2.2);
        k.add("vc", g, x, 0, z, ry, 0xe9ecef);
      });
    });
    k.add("vc", new T.CylinderGeometry(0.6, 0.6, 5.4, 10).rotateX(Math.PI / 2).translate(0, cy, 0), x, 0, z, ry, 0x9aa0a6);
    k.add("vc", box(16, 0.6, 7), x, 0, z, ry, 0x8a847a);
    k.build(grp, true);
    var spin = new T.Group(); spin.position.set(x, cy, z); spin.rotation.y = ry;
    var w = new Kit();
    [-1.1, 1.1].forEach(function (zz) {
      w.add("vc", new T.TorusGeometry(R, 0.32, 5, 64).translate(0, 0, zz), 0, 0, 0, 0, 0xf2f4f6);
      for (var i = 0; i < 16; i++) { var g = new T.BoxGeometry(0.14, R, 0.14).translate(0, R / 2, zz); g.rotateZ(i * Math.PI / 8); w.add("vc", g, 0, 0, 0, 0, 0xd8dde2); }
    });
    w.add("glow", new T.TorusGeometry(R + 0.5, 0.12, 4, 64), 0, 0, 0);
    w.build(spin, false);
    grp.add(spin);
    var cab = new T.InstancedMesh(new T.BoxGeometry(1.8, 2.2, 1.8).translate(0, -1.6, 0), MAT.vc, 24);
    var colors = [0xd94f4f, 0x4f8fd9, 0xe8c24a, 0x5fbf73, 0xe07a3a, 0x9a6fd0];
    var geo = cab.geometry; paint(geo, 0xffffff);
    for (var c = 0; c < 24; c++) cab.setColorAt(c, lin(colors[c % colors.length]));
    grp.add(cab);
    wheels.push({ spin: spin, cab: cab, x: x, z: z, cy: cy, R: R, ry: ry, a: 0 });
  }
  var tmpM = new T.Matrix4(), tmpQ = new T.Quaternion(), tmpV = new T.Vector3(), tmpS = new T.Vector3(1, 1, 1), YAX = new T.Vector3(0, 1, 0);
  function tickWheels(dt) {
    wheels.forEach(function (w) {
      w.a += dt * 0.035; w.spin.rotation.z = w.a;
      tmpQ.setFromAxisAngle(YAX, w.ry);
      var c = Math.cos(w.ry), s = Math.sin(w.ry);
      for (var i = 0; i < 24; i++) {
        var aa = w.a + i * Math.PI * 2 / 24, lx = Math.cos(aa) * w.R, ly = Math.sin(aa) * w.R;
        tmpV.set(w.x + lx * c, w.cy + ly, w.z - lx * s);
        w.cab.setMatrixAt(i, tmpM.compose(tmpV, tmpQ, tmpS));
      }
      w.cab.instanceMatrix.needsUpdate = true;
    });
  }
  // площадь Независимости: стеклянные купола подземного центра и фонтаны
  var jets = [];
  function buildSquare(grp) {
    var k = new Kit();
    (D.domes || []).forEach(function (d) {
      var r = d[2], h = r > 8 ? r * 0.55 : r * 0.45;
      k.add("glass", new T.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(r, h, r), d[0], 0.6, d[1]);
      for (var i = 0; i < 8; i++) {
        var g = new T.TorusGeometry(r, 0.07, 3, 20, Math.PI).rotateY(i * Math.PI / 8); g.scale(1, h / r, 1);
        k.add("dark", g, d[0], 0.6, d[1]);
      }
      k.add("vc", new T.CylinderGeometry(r + 0.4, r + 0.6, 0.6, 24).translate(0, 0.3, 0), d[0], 0, d[1], 0, 0x8b857c);
    });
    k.build(grp, false);
  }
  function buildFountains(grp) {
    var k = new Kit();
    (D.fount || []).forEach(function (f, i) {
      k.add("vc", new T.CylinderGeometry(6, 6.3, 0.7, 28).translate(0, 0.35, 0), f[0], 0, f[1], 0, 0x9c958a);
      k.add("vc", new T.CylinderGeometry(5.5, 5.5, 0.1, 28).translate(0, 0.62, 0), f[0], 0, f[1], 0, 0x5f8fa8);
      var j = new T.Mesh(new T.ConeGeometry(1.2, 6, 10, 1, true).translate(0, 3.6, 0), MAT.jet);
      j.position.set(f[0], 0, f[1]); grp.add(j); jets.push({ m: j, ph: i * 1.7 });
    });
    k.build(grp, false);
  }
  // маяк у «Маяка Минска»: полосатая башня, фонарь и луч ночью
  var beams = [];
  function buildLighthouse(grp) {
    var x = 4998, z = -3019, k = new Kit();
    for (var i = 0; i < 6; i++) k.add("vc", new T.CylinderGeometry(2.4 - i * 0.18 - 0.18, 2.4 - i * 0.18, 3.6, 16).translate(0, 1.8 + i * 3.6, 0), x, 0, z, 0, i % 2 ? 0xf2f2f2 : 0xc8352e);
    k.add("vc", cyl(2.6, 2.6, 0.4, 16), x, 21.6, z, 0, 0x2b2f33);
    k.add("glow", cyl(1.2, 1.2, 2.2, 12), x, 22, z);
    k.add("vc", new T.ConeGeometry(1.7, 2, 12).translate(0, 25.2, 0), x, 0, z, 0, 0xc8352e);
    k.build(grp, true);
    var b = new T.Mesh(new T.ConeGeometry(6, 70, 16, 1, true).rotateZ(Math.PI / 2).translate(35, 0, 0), MAT.beam);
    b.position.set(x, 23.1, z); grp.add(b); beams.push(b);
  }

  /* ---- надписи: холст → плоскость, ночью светятся ------------------------------------------------------------ */
  var signMats = {};
  function signMat(text, fg, bg, glow) {
    var key = text + "|" + fg + "|" + bg;
    if (signMats[key]) return signMats[key];
    var w = 512, h = 96, tex = G.tex.canvas(w, h, function (x) {
      x.clearRect(0, 0, w, h);
      if (bg && bg !== "rgba(0,0,0,0)") { x.fillStyle = bg; x.fillRect(0, 0, w, h); }
      x.font = "bold 62px system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
      if (glow) { x.shadowColor = fg; x.shadowBlur = 18; }
      x.fillStyle = fg; x.fillText(text, w / 2, h / 2 + 3, w - 20);
    });
    tex.colorSpace = T.SRGBColorSpace;
    var m = new T.MeshStandardMaterial({ map: tex, transparent: true, emissive: new T.Color(0xffffff), emissiveMap: tex, emissiveIntensity: 0.15, roughness: 0.6, side: T.DoubleSide, depthWrite: false });
    m.userData.glow = glow || 0.8;
    signMats[key] = m; return m;
  }
  function sign(grp, text, pos, a, w, h, fg, bg, glow) {
    var m = new T.Mesh(new T.PlaneGeometry(w, h), signMat(text, fg, bg, glow));
    m.position.set(pos[0], pos[1], pos[2]); m.rotation.y = Math.PI / 2 - a;
    m.matrixAutoUpdate = false; m.updateMatrix(); grp.add(m);
    return m;
  }

  /* ---- проспекты: ось Независимости, сеть троллейбуса, торшеры, остановки и киоски --------------------------- */
  var IND = null;                                       // [{x, z, s}] — ось проспекта с длиной дуги
  function prepLines() {
    var s = 0;
    IND = D.indep.map(function (p, i) { if (i) s += Math.hypot(p[0] - D.indep[i - 1][0], p[1] - D.indep[i - 1][1]); return { x: p[0], z: p[1], s: s }; });
  }
  function onInd(x, z) {                                // ближайшая точка оси: {d, s}
    var best = { d: 1e9, s: 0 };
    for (var i = 1; i < IND.length; i++) {
      var a = IND[i - 1], b = IND[i], ex = b.x - a.x, ez = b.z - a.z, L = ex * ex + ez * ez || 1e-9;
      var t = FC.clamp(((x - a.x) * ex + (z - a.z) * ez) / L, 0, 1), d = Math.hypot(x - a.x - ex * t, z - a.z - ez * t);
      if (d < best.d) { best.d = d; best.s = a.s + Math.sqrt(L) * t; }
    }
    return best;
  }
  function atS(s) {                                     // точка и направление оси на дуге s
    for (var i = 1; i < IND.length; i++) {
      if (IND[i].s >= s) {
        var a = IND[i - 1], b = IND[i], L = b.s - a.s || 1, t = (s - a.s) / L, dx = (b.x - a.x) / L, dz = (b.z - a.z) / L;
        return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dx: dx, dz: dz };
      }
    }
    var e = IND[IND.length - 1]; return { x: e.x, z: e.z, dx: 1, dz: 0 };
  }
  var S_ACAD = 0, S_END = 0;
  // участок проспекта [s0, s1): опоры с консолями, два провода на каждую сторону, торшеры в центре, остановки
  function buildAvenue(grp, s0, s1) {
    var k = new Kit(), step = 32, OFF = 13, POLE = 20.5, center = s1 <= S_ACAD + 200;
    for (var s = s0; s < s1; s += step) {
      var p = atS(s), q = atS(Math.min(s + step, S_END)), nx = -p.dz, nz = p.dx, ang = Math.atan2(p.dz, p.dx);
      [-1, 1].forEach(function (sd) {
        var px = p.x + nx * POLE * sd, pz = p.z + nz * POLE * sd;
        k.add("dark", cyl(0.12, 0.17, 8.2, 6), px, 0, pz);
        var arm = new T.BoxGeometry(POLE - OFF + 1.2, 0.09, 0.09).translate(-(POLE - OFF + 1.2) / 2, 7.4, 0);
        k.add("dark", arm, px, 0, pz, -(ang + (sd > 0 ? Math.PI / 2 : -Math.PI / 2)));
        if (!low()) [-0.4, 0.4].forEach(function (o) {
          var w0x = p.x + nx * (OFF + o) * sd, w0z = p.z + nz * (OFF + o) * sd, w1x = q.x + (-q.dz) * (OFF + o) * sd, w1z = q.z + q.dx * (OFF + o) * sd;
          var L = Math.hypot(w1x - w0x, w1z - w0z);
          if (L < 0.5) return;
          k.add("wire", new T.BoxGeometry(L, 0.05, 0.05), (w0x + w1x) / 2, 6.9, (w0z + w1z) / 2, -Math.atan2(w1z - w0z, w1x - w0x));
        });
        if (center && Math.round(s / step) % 2 === 0) torch(k, p.x + nx * (POLE + 4.5) * sd, p.z + nz * (POLE + 4.5) * sd);
      });
      if (Math.round(s / step) % 17 === 5) [-1, 1].forEach(function (sd) { stop(k, grp, p.x + nx * (POLE + 1.8) * sd, p.z + nz * (POLE + 1.8) * sd, ang, Math.atan2(-nz * sd, -nx * sd), s); });
    }
    k.build(grp, false);
  }
  // торшер сталинского проспекта: чугунный столб, крестовина, пять шаров
  function torch(k, x, z) {
    k.add("dark", cyl(0.16, 0.28, 6.2, 8), x, 0, z);
    k.add("dark", cyl(0.42, 0.42, 0.8, 8), x, 0, z);
    k.add("dark", box(3.2, 0.12, 0.12), x, 5.6, z, 0.6);
    k.add("dark", box(0.12, 0.12, 3.2), x, 5.6, z, 0.6);
    var g = new T.SphereGeometry(0.34, 10, 8);
    k.add("glow", g.clone(), x, 6.6, z);
    for (var i = 0; i < 4; i++) { var a = 0.6 + i * Math.PI / 2; k.add("glow", g.clone(), x + Math.cos(a) * 1.45, 5.95, z - Math.sin(a) * 1.45); }
  }
  var KIOSK = ["ПРЕССА", "ЦВЕТЫ", "МОРОЖЕНОЕ", "КОФЕ", "ШАУРМА", "ТАБАК"];
  function stop(k, grp, x, z, a, f, s) {
    var ry = -a, fx = Math.cos(f), fz = Math.sin(f);                  // a — вдоль проспекта, f — лицом к дороге
    k.add("glass", box(8, 2.6, 1.6), x, 0, z, ry);
    k.add("vc", box(8.6, 0.18, 2.2), x, 2.6, z, ry, 0x39424a);
    k.add("vc", box(0.3, 0.6, 1.4), x + Math.cos(a) * 4.6, 2.9, z + Math.sin(a) * 4.6, ry, 0x2c6bb8);
    var kx = x + Math.cos(a) * 9, kz = z + Math.sin(a) * 9;
    k.add("vc", box(3.2, 2.8, 2.4), kx, 0, kz, ry, 0x5d7f9c);
    k.add("vc", box(3.6, 0.3, 2.8), kx, 2.8, kz, ry, 0xe9e9e4);
    var txt = KIOSK[Math.abs(Math.round(s / 31)) % KIOSK.length];
    sign(grp, txt, [kx + fx * 1.25, 3.25, kz + fz * 1.25], f, 3, 0.55, "#ffffff", "#2c6bb8", 0.7);
    sign(grp, "ОСТАНОВКА", [x + fx * 1.15, 3.25, z + fz * 1.15], f, 3.6, 0.5, "#ffffff", "#1f4f8a", 0.5);
  }

  /* ---- метро: павильоны «М» у настоящих входов и поездка между станциями за $5 ------------------------------ */
  var METRO = [], ENT = [], LINE_HEX = { blue: "#2f6fd6", red: "#d9363e", green: "#2f9e5a" };
  function prepMetro() {
    METRO = D.st.map(function (s) { return { name: s[0], x: s[1], z: s[2], line: LINE_HEX[s[3]] ? s[3] : "green", ref: s[4], ents: [] }; });
    METRO.sort(function (a, b) { return a.ref < b.ref ? -1 : 1; });
    D.ent.forEach(function (e) {
      var best = null, bd = 450;
      METRO.forEach(function (m) { var d = Math.hypot(m.x - e[1], m.z - e[2]); if (d < bd) { bd = d; best = m; } });
      if (best) { var E = { x: e[1], z: e[2], st: best }; ENT.push(E); best.ents.push(E); }
    });
    FC.metroData = function () { return { st: METRO, ent: ENT, hex: LINE_HEX }; };   // метро под землёй — fmetro.js
  }
  function mMat(line) {
    var key = "m_" + line;
    if (!MAT[key]) {
      var hex = LINE_HEX[line], tex = G.tex.canvas(128, 128, function (x) {
        x.fillStyle = hex; x.beginPath(); x.arc(64, 64, 62, 0, 7); x.fill();
        x.fillStyle = "#fff"; x.font = "bold 92px system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("М", 64, 70);
      });
      tex.colorSpace = T.SRGBColorSpace;
      MAT[key] = S(0xffffff, 0.5, 0, { map: tex, transparent: true, emissive: new T.Color(0xffffff), emissiveMap: tex, emissiveIntensity: 0.2, side: T.DoubleSide });
    }
    return key;
  }
  function buildMetro(grp, list) {
    var k = new Kit();
    list.forEach(function (e) {
      // ось входа — от станции к выходу; лестница уходит вниз «к станции»
      var a = Math.atan2(e.z - e.st.z, e.x - e.st.x), ry = -a, c = Math.cos(a), s = Math.sin(a);
      [-1, 1].forEach(function (sd) { k.add("vc", box(6, 1.1, 0.35), e.x - c * 1 - s * 1.7 * sd, 0, e.z - s * 1 + c * 1.7 * sd, ry, 0x6d665e); });
      k.add("vc", box(0.35, 1.1, 3.75), e.x + c * 1.8, 0, e.z + s * 1.8, ry, 0x6d665e);
      k.add("vc", box(6.4, 0.05, 3.2), e.x - c * 1, 0.02, e.z - s * 1, ry, 0x1b1b1d);
      k.add("glass", box(6.6, 0.12, 4.3), e.x - c * 1, 2.9, e.z - s * 1, ry);
      k.add("dark", box(6.8, 0.18, 0.18), e.x - c * 1 - s * 2.1, 2.85, e.z - s * 1 + c * 2.1, ry);
      k.add("dark", box(6.8, 0.18, 0.18), e.x - c * 1 + s * 2.1, 2.85, e.z - s * 1 - c * 2.1, ry);
      for (var i = 0; i < 4; i++) { var sx = i < 2 ? -4.2 : 2.2, sz = i % 2 ? 2.1 : -2.1; k.add("dark", cyl(0.06, 0.06, 2.85, 5), e.x + c * sx - s * sz, 0, e.z + s * sx + c * sz); }
      k.add("dark", cyl(0.07, 0.09, 3.6, 6), e.x + c * 2.6 + s * 2.6, 0, e.z + s * 2.6 - c * 2.6);
      k.add(mMat(e.st.line), new T.CircleGeometry(0.62, 24), e.x + c * 2.6 + s * 2.6, 3.95, e.z + s * 2.6 - c * 2.6, Math.PI / 2 - a);
    });
    k.build(grp, false);
  }
  function nearEnt(x, z, r) {
    var best = null, bd = r;
    ENT.forEach(function (e) { var d = Math.hypot(e.x - x, e.z - z); if (d < bd) { bd = d; best = e; } });
    return best;
  }
  function ride(m) {
    var P = FC.player; if (!P) return;
    var here = nearEnt(P.x, P.z, 30);
    if (!here) { if (FC.hud) FC.hud.toast("Подойди ко входу «М» — поездка начинается со станции", "bad", 3); return; }
    if (here.st === m) { if (FC.hud) FC.hud.toast("Ты уже на «" + m.name + "»", "", 2); return; }
    if (FC.save && FC.save.money < 5) { if (FC.hud) FC.hud.toast("Жетон стоит $5 — не хватает денег", "bad", 3); return; }
    var e = m.ents[Math.floor(Math.random() * m.ents.length)] || m;
    var dx = e.x - m.x, dz = e.z - m.z, dl = Math.hypot(dx, dz) || 1;
    var ok = FC.hud && FC.hud.teleport ? FC.hud.teleport(e.x + dx / dl * 5, e.z + dz / dl * 5, false) : (P.teleport && (P.teleport(e.x, e.z), true));
    if (ok === false) return;
    FC.money(-5, "метро: жетон");
    if (FC.hud) { FC.hud.closePhone(); FC.hud.toast("🚇 «" + here.st.name + "» → «" + m.name + "»", "ok", 3); }
    if (FC.audio) FC.audio.play("whoosh");
    FC.emit("metro:ride", { from: here.st.name, to: m.name });
  }
  function metroApp() {
    if (!FC.hud || !FC.hud.addApp) return;
    FC.hud.addApp({
      id: "metro", icon: "🚇", name: "Метро", color: "#2f6fd6", order: 6,
      render: function (b) {
        var P = FC.player, here = P ? nearEnt(P.x, P.z, 30) : null, esc = FC.hud.esc;
        var head = here ? "<div class='card'><b>Ты у входа «" + esc(here.st.name) + "»</b><p>Жетон — $5, выбери станцию</p></div>"
          : "<div class='card'><b>Найди вход «М»</b><p>Павильоны метро — у настоящих выходов. Подойди и нажми E, поездка — $5.</p></div>";
        var groups = { blue: "Московская линия", red: "Автозаводская линия", green: "Зеленолужская линия" };
        var html = "<div class='list'>" + head;
        Object.keys(groups).forEach(function (ln) {
          html += "<div class='card'><b style='color:" + LINE_HEX[ln] + "'>● " + groups[ln] + "</b><p>";
          METRO.forEach(function (m, i) {
            if (m.line !== ln) return;
            html += "<button type='button' data-i='" + i + "' style='margin:3px;padding:6px 9px;border-radius:8px;border:0;background:" + (here && here.st === m ? "#555" : LINE_HEX[ln]) + ";color:#fff'>" + esc(m.name) + "</button>";
          });
          html += "</p></div>";
        });
        b.innerHTML = html + "</div>";
        b.querySelectorAll("button[data-i]").forEach(function (btn) { btn.addEventListener("click", function () { ride(METRO[+btn.dataset.i]); }); });
      }
    });
    if (FC.interact) FC.interact.provider(function (px, pz, room) {
      if (room) return null;
      var e = nearEnt(px, pz, 7); if (!e) return null;
      return [{ id: "metro_" + Math.round(e.x) + "_" + Math.round(e.z), x: e.x, z: e.z, r: 7, key: "use",
        label: FC.metro ? "🚇 Спуститься в метро «" + e.st.name + "» — жетон $5" : "🚇 Метро «" + e.st.name + "» — поехать ($5)",
        act: function () { if (FC.metro) FC.metro.enter(e); else FC.hud.openPhone("metro"); } }];
    });
  }

  /* ---- Зыбицкая: гирлянды над улицей, террасы, неон баров (названия выдуманы) ------------------------------- */
  var BARS = ["ЗЫБЬ", "НЕОН", "КОТ И РОМ", "СОРОК КАПЕЛЬ", "ОГОНЁК", "БУДКА", "СВИСЛЯР", "ЛУНА", "ХМЕЛЬ", "ПОДВАЛ"];
  var NEON = ["#ff4fa8", "#4fe3ff", "#ffd84f", "#9dff6a", "#ff7a3a", "#c77dff"];
  function buildZyb(grp) {
    var p = D.zyb, k = new Kit(), bpos = [], bcol = [], n = 0, cols = [0xffd27a, 0xff8f6a, 0x9fd7ff, 0xfff3c4];
    for (var i = 1; i < p.length; i++) {
      var ax = p[i - 1][0], az = p[i - 1][1], dx = p[i][0] - ax, dz = p[i][1] - az, L = Math.hypot(dx, dz);
      if (L < 1) continue;
      var ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
      for (var d = 0; d < L; d += 7) {
        var x = ax + ux * d, z = az + uz * d, W = 7.5, zig = (n % 2 ? 3 : -3);
        for (var b = 0; b <= 16; b++) {                         // провисающая гирлянда поперёк улицы, зигзагом
          var t = b / 16, sag = Math.sin(t * Math.PI) * 0.9;
          bpos.push(x + nx * (t * 2 - 1) * W + ux * zig * (t - 0.5), 6.4 - sag, z + nz * (t * 2 - 1) * W + uz * zig * (t - 0.5));
          var cc = lin(cols[(b + n) % cols.length]); bcol.push(cc.r, cc.g, cc.b);
        }
        if (n % 2 === 0) [-1, 1].forEach(function (sd) {            // столики с зонтами — летние веранды
          var tx = x + nx * 5.6 * sd, tz = z + nz * 5.6 * sd;
          k.add("vc", cyl(0.45, 0.45, 0.75, 10), tx, 0, tz, 0, 0x6b4a32);
          k.add("vc", cyl(0.04, 0.04, 2.3, 4), tx, 0, tz, 0, 0x333333);
          k.add("vc", new T.ConeGeometry(1.5, 0.6, 8).translate(0, 2.4, 0), tx, 0, tz, 0, n % 4 ? 0xf2eee4 : 0x8c2f2f);
        });
        // выдуманные неоновые названия — только если настоящих заведений (FC.places) у нас нет
        if (n % 3 === 1 && !(FC.places && FC.places.biz && FC.places.biz.length)) {
          var sd2 = n % 2 ? 1 : -1, name = BARS[(n / 3 | 0) % BARS.length];
          sign(grp, name, [x + nx * 8.6 * sd2, 4.2, z + nz * 8.6 * sd2], Math.atan2(-nz * sd2, -nx * sd2), 4.2, 0.8, NEON[n % NEON.length], "rgba(0,0,0,0)", 1.6);
        }
        n++;
      }
    }
    var bg = new T.BufferGeometry();
    bg.setAttribute("position", new T.Float32BufferAttribute(bpos, 3)); bg.setAttribute("color", new T.Float32BufferAttribute(bcol, 3));
    var pts = new T.Points(bg, MAT.bulb); grp.add(pts);
    k.build(grp, false);
  }

  /* ---- дома OSM: спрятать под ориентирами, выбрать текстурный вид по району ---------------------------------- */
  var MASKS = [], VOSTOK = { x: 4680, z: -3808 }, OKT = { x: -1169, z: -231 }, mosaicQ = [];
  function masked(x, z) { for (var i = 0; i < MASKS.length; i++) { var m = MASKS[i]; if (Math.hypot(x - m[0], z - m[1]) < m[2]) return true; } return false; }
  function pickStyle(cx, cz, h, st, seed) {
    if (st === 5 || st === 6) return st;
    var r = (seed * 7919 % 997) / 997, ind = onInd(cx, cz);
    // ансамбль Независимости: от площади Независимости до Академии наук — сталинки кремовые и охристые
    if (ind.d < 125 && ind.s < S_ACAD + 150 && h > 9 && h < 48) return r < 0.55 ? 7 : 8;
    if (Math.hypot(cx - OKT.x, cz - OKT.z) < 1700 && h > 10 && h < 34 && st !== 0 && r < 0.6) return r < 0.3 ? 7 : 8;
    if (cx > -3800 && cx < -1300 && cz > 2800 && cz < 4900 && h > 16) return r < 0.5 ? 11 : 14;        // Мир-Сити
    if (cx > 4450 && cx < 5200 && cz > -3700 && cz < -2850 && h > 30) return r < 0.5 ? 11 : 14;      // Маяк Минска
    if (st === 0) return h < 95 ? 12 : 0;
    if (st === 4) return h > 28 ? 12 : r < 0.35 ? 9 : 4;
    if (st === 2 && h < 18) return r < 0.7 ? 9 : 2;
    if (st === 3) return r < 0.5 ? 7 : 3;
    if (st === 1) return h >= 22 ? (r < 0.65 ? 10 : 1) : (r < 0.6 ? 9 : 1);
    return st;
  }
  function processMesh(mesh) {
    var g = mesh.geometry, fac = g.attributes.aFac, pos = g.attributes.position, n = fac.count, f = fac.array, P = pos.array;
    var changedF = false, changedP = false, start = 0;
    function run(a, b) {
      var cx = 0, cz = 0, y0 = 1e9, y1 = -1e9, m = 0;
      for (var i = a; i < b; i += 3) { cx += P[i * 3]; cz += P[i * 3 + 2]; m++; var y = P[i * 3 + 1]; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      cx /= m; cz /= m;
      if (masked(cx, cz)) {
        for (var j = a; j < b; j++) { P[j * 3] = cx; P[j * 3 + 1] = y0; P[j * 3 + 2] = cz; }
        changedP = true; return;
      }
      var st = Math.round(f[a * 4]), seed = Math.round(f[a * 4 + 1]), ns = pickStyle(cx, cz, y1, st, seed);
      if (ns !== st) { for (var q = a; q < b; q++) f[q * 4] = ns; changedF = true; }
      if ((ns === 1 || ns === 10) && y1 > 24 && Math.hypot(cx - VOSTOK.x, cz - VOSTOK.z) < 1100 && seed % 2 === 0) mosaicQ.push({ a: a, b: b, P: P, h: y1 });
    }
    for (var i = 1; i <= n; i++) {
      if (i === n || f[i * 4] !== f[start * 4] || f[i * 4 + 1] !== f[start * 4 + 1] || f[i * 4 + 2] !== f[start * 4 + 2] || f[i * 4 + 3] !== f[start * 4 + 3]) { run(start, i); start = i; }
    }
    if (changedF) fac.needsUpdate = true;
    if (changedP) pos.needsUpdate = true;
  }
  function scanOsm() {
    var R = FC.osm && FC.osm.root; if (!R || FC.osm.mask) return;      // новый fosm сам прячет дома и выбирает виды
    R.traverse(function (o) {
      if (!o.isMesh || o.userData.fq || !o.geometry || !o.geometry.attributes.aFac) return;
      o.userData.fq = true;
      if (o.parent && o.parent.userData.fqLm) return;            // свои меши не трогаем
      processMesh(o);
    });
    if (mosaicQ.length) buildMosaics();
  }
  // мозаики на торцах панелек у «Востока»: торец — короткая сторона рамки контура
  var mosaicGrp = null, mosaicMats = null, mosaicN = 0;
  function mosaicTex(i) {
    var t = G.tex.canvas(128, 256, function (x, w, h) {
      var r = FC.rng(77 + i * 13), pal = [["#c94f3a", "#e9b44c", "#2f6f8f", "#f2ead8", "#1f3b52"], ["#3a7d5c", "#e8d28a", "#b5452f", "#f4efe2", "#2a3f6a"]][i % 2];
      x.fillStyle = pal[3]; x.fillRect(0, 0, w, h);
      for (var k = 0; k < 900; k++) { x.fillStyle = pal[(r() * 5) | 0]; x.globalAlpha = 0.12; x.fillRect(r() * w, r() * h, 3, 3); }
      x.globalAlpha = 1;
      if (i % 4 === 0) { x.fillStyle = pal[1]; x.beginPath(); x.arc(w / 2, h * 0.3, 34, 0, 7); x.fill(); for (var a = 0; a < 12; a++) { x.save(); x.translate(w / 2, h * 0.3); x.rotate(a * Math.PI / 6); x.fillRect(-3, 40, 6, 22); x.restore(); } }
      if (i % 4 === 1) { for (var b = 0; b < 7; b++) { x.fillStyle = pal[b % 3]; x.beginPath(); x.moveTo(0, h * 0.35 + b * 22); for (var u = 0; u <= w; u += 8) x.lineTo(u, h * 0.35 + b * 22 + Math.sin(u * 0.08 + b) * 9); x.lineTo(w, h); x.lineTo(0, h); x.fill(); } }
      if (i % 4 === 2) { for (var c = 0; c < 9; c++) { x.fillStyle = pal[c % 5]; x.beginPath(); x.moveTo(w / 2, 20 + c * 18); x.lineTo(w - 10, 120 + c * 14); x.lineTo(10, 120 + c * 14); x.fill(); } }
      if (i % 4 === 3) { x.strokeStyle = pal[4]; x.lineWidth = 7; for (var d = 0; d < 6; d++) { x.beginPath(); x.arc(w / 2, h / 2, 14 + d * 16, d * 0.7, d * 0.7 + 4.2); x.stroke(); } x.fillStyle = pal[0]; x.beginPath(); x.arc(w / 2, h / 2, 10, 0, 7); x.fill(); }
      x.strokeStyle = pal[4]; x.lineWidth = 6; x.strokeRect(3, 3, w - 6, h - 6);
    });
    t.colorSpace = T.SRGBColorSpace; return t;
  }
  function buildMosaics() {
    if (!mosaicGrp) { mosaicGrp = new T.Group(); mosaicGrp.userData.fqLm = true; root.add(mosaicGrp); mosaicMats = [0, 1, 2, 3].map(function (i) { return S(0xffffff, 0.85, 0, { map: mosaicTex(i) }); }); }
    mosaicQ.splice(0).forEach(function (m) {
      if (mosaicN > 60) return;
      var pts = [], seen = {};
      for (var i = m.a; i < m.b; i += 2) { var x = m.P[i * 3], z = m.P[i * 3 + 2], key = Math.round(x) + "," + Math.round(z); if (!seen[key]) { seen[key] = 1; pts.push([x, z]); } }
      if (pts.length < 4 || pts.length > 400) return;
      var o = obb(pts); if (o.L < o.W * 1.6 || o.W < 8) return;
      var c = Math.cos(o.a), s = Math.sin(o.a), hh = Math.min(m.h * 0.7, 34), ww = o.W * 0.62;
      var mesh = new T.Mesh(new T.PlaneGeometry(ww, hh), mosaicMats[mosaicN % 4]);
      mesh.position.set(o.x + c * (o.L / 2 + 0.12), 3 + hh / 2, o.z + s * (o.L / 2 + 0.12));
      mesh.rotation.y = Math.PI / 2 - o.a;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix(); mosaicGrp.add(mesh); mosaicN++;
    });
  }

  /* ---- вывески первых этажей по точкам OSM: «Аптека», «Продукты», «Кафе» — без брендов -------------------- */
  var shopGrp = null, shopSeen = {}, shopN = 0;
  function shopText(p) {
    var n = (p.name || "").toLowerCase();
    if (/аптек/.test(n)) return ["АПТЕКА", "#ffffff", "#1d9a54"];
    if (p.kind === "cafe") return ["КАФЕ", "#3a2416", "#f2dcb0"];
    if (p.kind === "restaurant") return ["РЕСТОРАН", "#f6e7c8", "#5a1f22"];
    if (p.kind === "bar" || p.kind === "pub" || p.kind === "nightclub") return ["БАР", "#ff5fb0", "#1a1020"];
    if (p.kind === "fast_food") return ["ФАСТФУД", "#ffffff", "#d0402a"];
    if (p.kind !== "shop") return null;
    if (/цвет/.test(n)) return ["ЦВЕТЫ", "#ffffff", "#c2457a"];
    if (/хлеб|пекар|булоч/.test(n)) return ["ХЛЕБ", "#3a2416", "#f0c870"];
    if (/одеж|обув|мода/.test(n)) return ["ОДЕЖДА", "#ffffff", "#333a48"];
    if (/книг/.test(n)) return ["КНИГИ", "#ffffff", "#5a3a8a"];
    if (/оптик|очк/.test(n)) return ["ОПТИКА", "#ffffff", "#2a6f9a"];
    return ["ПРОДУКТЫ", "#ffffff", "#2a7d3c"];
  }
  function scanShops() {
    if (!FC.osm || !FC.osm.pois || !FC.osm.buildingAt) return;
    if (!shopGrp) { shopGrp = new T.Group(); shopGrp.userData.fqLm = true; root.add(shopGrp); }
    var f = G.focus || G.camera.position;
    FC.osm.pois().forEach(function (p) {
      var key = Math.round(p.x) + "," + Math.round(p.z);
      if (shopSeen[key] || shopN > 260 || Math.hypot(p.x - f.x, p.z - f.z) > 500) return;
      shopSeen[key] = 1;
      var tx = shopText(p); if (!tx) return;
      var B = FC.osm.buildingAt(p.x, p.z), poly = B && (B.p || B.poly);
      if (!poly || poly.length < 3 || (B.h || 10) < 5) return;
      var best = null, bd = 1e9;
      for (var i = 0; i < poly.length; i++) {
        var a = poly[i], b = poly[(i + 1) % poly.length], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
        if (L < 5) continue;
        var t = FC.clamp(((p.x - a[0]) * ex + (p.z - a[1]) * ez) / (L * L), 0.15, 0.85), qx = a[0] + ex * t, qz = a[1] + ez * t, d = Math.hypot(p.x - qx, p.z - qz);
        if (d < bd) { bd = d; best = { x: qx, z: qz, ex: ex / L, ez: ez / L }; }
      }
      if (!best) return;
      var nx = best.ez, nz = -best.ex;                         // наружу: проверим, что точка снаружи контура
      if (FC.osm.buildingAt(best.x + nx * 1.5, best.z + nz * 1.5)) { nx = -nx; nz = -nz; }
      var m = sign(shopGrp, tx[0], [best.x + nx * 0.25, 3.7, best.z + nz * 0.25], Math.atan2(nz, nx), 4.4, 0.85, tx[1], tx[2], 0.9);
      m.userData.key = key; shopN++;
    });
  }

  /* ---- куранты Ратуши: каждый игровой час — удары по числу часов (до 12), слышно рядом ------------------------ */
  function chime(h) {
    var cam = G.camera.position, d = Math.hypot(cam.x + 1569, cam.z + 398);
    if (d > 450 || !FC.audio) return;
    var n = h % 12 || 12, i = 0;
    (function ring() { if (i++ >= n) return; FC.audio.play("note", { x: -1569, z: -398, vol: 0.9 }); setTimeout(ring, 900); })();
  }

  /* ---- площадки: строим рядом, убираем далеко ------------------------------------------------------------------ */
  function site(id, x, z, r, fn) { sites.push({ id: id, x: x, z: z, r: r, fn: fn, grp: null }); }
  function setupSites() {
    // исторический центр, проспект (провода, торшеры, остановки) и входы в метро теперь строит fosm.js по OSM для всего
    // города (части зданий, trolley_wire, остановки и спуски с «М» по настоящим точкам) — здесь только свои ориентиры
    if (Z3_ON) Object.keys(D.z3).forEach(function (n) { var Z = D.z3[n]; site("z3:" + n, Z.c[0], Z.c[1], Z.c[2], function (g) { buildZone(n, Z, g); }); });
    site("lib", 4337, -3452, 100, buildLibrary);
    site("vict", -322, -959, 40, buildVictory);
    site("stele", -2748, -1759, 20, buildStele);
    site("gates", -1870, 890, 40, buildGates);
    site("hall", -1569, -398, 20, buildHall);
    site("sport", -1983, -1187, 60, buildSport);
    site("arena", -6452, -3985, 100, buildArena);
    site("mirt", -2124, 3748, 40, buildMirTower);
    site("wheel", -372, -374, 40, buildWheel);
    site("square", -2120, 480, 150, buildSquare);
    site("fount", -1300, -300, 1400, buildFountains);
    site("mayak", 4998, -3019, 30, buildLighthouse);
    site("zyb", -1390, -620, 200, buildZyb);
    if (Z3_ON) {
      for (var s = 0; s < S_END; s += 400) (function (s0) { var p = atS(s0 + 200); site("ind" + s0, p.x, p.z, 260, function (g) { buildAvenue(g, s0, Math.min(s0 + 400, S_END)); }); })(s);
      var cells = {};
      ENT.forEach(function (e) { var k = Math.floor(e.x / 1000) + "_" + Math.floor(e.z / 1000); (cells[k] || (cells[k] = [])).push(e); });
      Object.keys(cells).forEach(function (k) { var l = cells[k], cx = 0, cz = 0; l.forEach(function (e) { cx += e.x; cz += e.z; }); site("m" + k, cx / l.length, cz / l.length, 800, function (g) { buildMetro(g, l); }); });
    }
  }
  function freeGroup(g) {
    g.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
    root.remove(g);
  }
  function stream() {
    var f = G.focus || G.camera.position, built = 0;
    sites.forEach(function (s) {
      var d = Math.hypot(s.x - f.x, s.z - f.z) - s.r;
      if (!s.grp && d < LOAD_D && built < 3) {
        var g = new T.Group(); g.name = "lm:" + s.id; g.userData.fqLm = true;
        try { s.fn(g); } catch (e) { if (global.console) console.error("flandmarks: " + s.id, e); }
        root.add(g); s.grp = g; built++;
      } else if (s.grp && d > DROP_D) {
        if (s.id === "wheel") wheels.length = 0;
        if (s.id === "vict") flames.length = 0;
        if (s.id === "fount") jets.length = 0;
        if (s.id === "mayak") beams.length = 0;
        freeGroup(s.grp); s.grp = null;
      }
    });
  }

  /* ---- запуск ------------------------------------------------------------------------------------------------- */
  function start() {
    root = new T.Group(); root.name = "landmarks"; root.userData.fqLm = true; G.add(root);
    initMats();
    if (G.facadeTex) G.facadeTex();
    fetch(DATA_URL).then(function (r) { return r.json(); }).then(function (d) {
      D = d;
      MASKS = (d.mask || []).slice();
      if (!Z3_ON) MASKS = MASKS.slice(-4);                    // библиотека, «Арена», Дворец спорта, башня «Мир-Сити»
      if (FC.osm && FC.osm.mask) MASKS.forEach(function (m) { FC.osm.mask(m[0], m[1], m[2]); });
      prepLines(); prepMetro();
      S_END = IND[IND.length - 1].s;
      S_ACAD = onInd(1269, -2405).s;
      setupSites(); metroApp();
      FC.on("hour", chime);
      FC.landmarks.ready = true;
      FC.emit("landmarks:ready", { sites: sites.length, metro: METRO.length });
    }).catch(function (e) { if (global.console) console.error("flandmarks: данные", e); });
  }
  var scanT = 0, shopT = 0;
  FC.addSystem({
    name: "landmarks", order: 44,
    update: function (dt) {
      if (!active) { if (!inMinsk()) return; active = true; start(); }
      if (!D) return;
      t0 += dt; scanT += dt; shopT += dt;
      if (scanT > 0.5) { scanT = 0; stream(); scanOsm(); }
      if (shopT > 2.5) { shopT = 0; scanShops(); }
      var n = FC.clock.night;
      MAT.glow.emissiveIntensity = 0.15 + n * 2.6;
      Object.keys(signMats).forEach(function (k) { signMats[k].emissiveIntensity = 0.12 + n * signMats[k].userData.glow; });
      ["m_blue", "m_red", "m_green"].forEach(function (k) { if (MAT[k]) MAT[k].emissiveIntensity = 0.2 + n * 0.9; });
      if (MAT.clock) { MAT.clock.emissiveIntensity = 0.1 + n * 0.8; if (FC.clock.minute !== clockMin) { clockMin = FC.clock.minute; drawClock(); } }
      MAT.bulb.opacity = 0.35 + n * 0.65;
      flames.forEach(function (f, i) { var s = 0.85 + Math.sin(t0 * 11 + i) * 0.1 + Math.sin(t0 * 17.3) * 0.06; f.scale.set(s, 0.9 + Math.sin(t0 * 7.7 + i) * 0.18, s); });
      jets.forEach(function (j) { var s = 0.8 + 0.25 * Math.sin(t0 * 1.3 + j.ph); j.m.scale.set(1, s, 1); });
      beams.forEach(function (b) { b.rotation.y += dt * 0.9; MAT.beam.opacity = n * 0.22; });
      if (wheels.length) tickWheels(dt);
    }
  });

  FC.landmarks = {
    ready: false,
    metro: function () { return METRO; },
    entrances: function () { return ENT; },
    ride: ride,
    debug: { sites: sites, masks: function () { return MASKS; }, pickStyle: function (x, z, h, st, seed) { return pickStyle(x, z, h, st, seed); } }
  };
})(window);
