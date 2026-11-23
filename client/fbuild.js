/* Флейм-Сити — меши города из плана FC.map: земля, дороги с разметкой, мосты, набережные, здания (фасад шейдером),
 * крыши, витрины и навесы, двери, вывески зон и точек, огонёк на площади, деревья, фонари, светофоры, скамейки,
 * пляж, море, горы за краем.
 *
 * Всё статичное слито в несколько больших мешей (вызовов отрисовки — единицы), повторяющееся — InstancedMesh.
 * Светофоры: цикл 26 с, ось X зелёная 0–11, жёлтая 11–13, ось Z зелёная 13–24, жёлтая 24–26; соседние перекрёстки
 * сдвинуты на полцикла (FC.build.signal(узел, ось) → "g" | "y" | "r").
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE, M = FC.map, G = FC.gfx;
  if (M.minsk) return;                               // Минск 1:1 — меши города даёт fosm.js

  /* ---- накопитель геометрии: позиции, нормали, uv, цвета и свои атрибуты одним проходом -------------------- */
  function Acc(extra) {
    var a = { p: [], n: [], uv: [], c: [], idx: [], ex: {} };
    (extra || []).forEach(function (e) { a.ex[e[0]] = { size: e[1], d: [] }; });
    return a;
  }
  // четырёхугольник: 4 вершины по кругу, нормаль, uv, цвет, значения своих атрибутов
  function quad(a, v, nrm, uvs, col, ex) {
    var base = a.p.length / 3;
    for (var i = 0; i < 4; i++) {
      a.p.push(v[i][0], v[i][1], v[i][2]); a.n.push(nrm[0], nrm[1], nrm[2]);
      a.uv.push(uvs ? uvs[i][0] : 0, uvs ? uvs[i][1] : 0);
      if (col) a.c.push(col[0], col[1], col[2]);
      for (var k in a.ex) { var vals = ex[k]; for (var j = 0; j < a.ex[k].size; j++) a.ex[k].d.push(vals[j]); }
    }
    // обход по нормали: если треугольник смотрит против заданной нормали — переворачиваем (иначе грань отсечётся)
    var e1x = v[1][0] - v[0][0], e1y = v[1][1] - v[0][1], e1z = v[1][2] - v[0][2];
    var e2x = v[2][0] - v[0][0], e2y = v[2][1] - v[0][1], e2z = v[2][2] - v[0][2];
    var cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
    if (cx * nrm[0] + cy * nrm[1] + cz * nrm[2] < 0) a.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else a.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  // коробка по границам; faces — какие грани нужны (по умолчанию все, кроме дна); uv — мировые метры
  function box(a, x0, x1, y0, y1, z0, z1, col, ex, faces) {
    faces = faces || "tnsew";
    if (faces.indexOf("t") >= 0) quad(a, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], [[x0, z1], [x1, z1], [x1, z0], [x0, z0]], col, ex);
    if (faces.indexOf("s") >= 0) quad(a, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], col, ex);
    if (faces.indexOf("n") >= 0) quad(a, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], [[-x1, y0], [-x0, y0], [-x0, y1], [-x1, y1]], col, ex);
    if (faces.indexOf("e") >= 0) quad(a, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], [[-z1, y0], [-z0, y0], [-z0, y1], [-z1, y1]], col, ex);
    if (faces.indexOf("w") >= 0) quad(a, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], [[z0, y0], [z1, y0], [z1, y1], [z0, y1]], col, ex);
  }
  function geoOf(a) {
    var g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(a.p, 3));
    g.setAttribute("normal", new T.Float32BufferAttribute(a.n, 3));
    g.setAttribute("uv", new T.Float32BufferAttribute(a.uv, 2));
    if (a.c.length) g.setAttribute("color", new T.Float32BufferAttribute(a.c, 3));
    for (var k in a.ex) g.setAttribute(k, new T.Float32BufferAttribute(a.ex[k].d, a.ex[k].size));
    g.setIndex(a.idx);
    g.computeBoundingSphere();
    return g;
  }
  function mesh(geo, mat, shadow) {
    var m = new T.Mesh(geo, mat);
    m.castShadow = !!shadow && G.Q.shadows; m.receiveShadow = G.Q.shadows;
    m.matrixAutoUpdate = false; m.updateMatrix();
    G.add(m);
    return m;
  }
  var col = new T.Color();
  function rgb(hex, k) { col.set(hex); if (k) col.multiplyScalar(k); return [col.r, col.g, col.b]; }

  var root = new T.Group(); root.name = "city"; G.add(root);
  function addTo(m) { G.scene.remove(m); root.add(m); return m; }

  /* ---- земля: за городом трава до горизонта, пляж и море на юге ------------------------------------------ */
  var groundMat = new T.MeshStandardMaterial({ color: 0x6f8f4e, roughness: 1 });
  var g0 = new T.Mesh(new T.PlaneGeometry(7000, 7000), groundMat);
  g0.rotation.x = -Math.PI / 2; g0.position.y = -2.5;     // дальняя земля — ниже воды, чтобы не закрывала реку g0.receiveShadow = G.Q.shadows;
  addTo(g0);
  // вода под всем городом (река и озеро видны там, где земля вырезана по кривой берега), море — за пляжем
  var waterMat = G.mat.water();
  var wPlane = new T.Mesh(new T.PlaneGeometry(2 * M.EDGE + 600, 2 * M.EDGE + 600), waterMat);
  wPlane.rotation.x = -Math.PI / 2; wPlane.position.y = -1.2; addTo(wPlane);
  var sea = new T.Mesh(new T.PlaneGeometry(9000, 4000), waterMat);
  sea.rotation.x = -Math.PI / 2; sea.position.set(0, -0.9, M.SEA_LINE + 2000); addTo(sea);
  var A = Acc([["aG", 1]]);
  var sand = rgb(0xdcc795), stone = rgb(0x8f897f), pave = rgb(0xa3a099), grass = rgb(0x5f8a45), plazaC = rgb(0xb4a996), yard = rgb(0x8d8a83);
  // вид поверхности для шейдера земли: 0 плитка, 1 трава, 2 песок, 3 гранит набережной, 4 площадь, 5 двор
  var GK = { pave: 0, grass: 1, sand: 2, stone: 3, plaza: 4, yard: 5 };
  var GC = { pave: pave, grass: grass, sand: sand, stone: stone, plaza: plazaC, yard: yard };
  function topQuad(pts, y, kind) {
    // многоугольник веером (2–5 вершин по кругу), нормаль вверх
    for (var i = 1; i < pts.length - 1; i++) {
      var tri = [pts[0], pts[i], pts[i + 1], pts[i + 1]];
      quad(A, tri.map(function (p) { return [p[0], y, p[1]]; }), [0, 1, 0], tri.map(function (p) { return [p[0], p[1]]; }), GC[kind], { aG: [GK[kind]] });
    }
  }
  /* Земля прямоугольником с вырезом по кривой берега: поле M.field — расстояние до кромки воды (1-липшицево),
     поэтому прямоугольник целиком сух, если поле в центре больше полудиагонали; на кромке — marching squares. */
  function land(x0, x1, z0, z1, y, kindFn, depth) {
    var cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hd = Math.hypot(x1 - x0, z1 - z0) / 2;
    var f = M.field(cx, cz);
    var k = kindFn(f, cx, cz);
    var uniform = !kindFn.edge || Math.abs(f - kindFn.edge) > hd;
    if (f > hd && uniform) { landBox(x0, x1, z0, z1, y, k); return; }
    if (f < -hd) return;
    if ((x1 - x0) > 2.6 && depth < 9) {
      var mx = cx, mz = cz;
      land(x0, mx, z0, mz, y, kindFn, depth + 1); land(mx, x1, z0, mz, y, kindFn, depth + 1);
      land(x0, mx, mz, z1, y, kindFn, depth + 1); land(mx, x1, mz, z1, y, kindFn, depth + 1);
      return;
    }
    // клетка на кромке: обходим углы, на рёбрах со сменой знака — точка пересечения
    var C = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], F = C.map(function (c) { return M.field(c[0], c[1]); }), pts = [];
    for (var i = 0; i < 4; i++) {
      var j = (i + 1) % 4;
      if (F[i] >= 0) pts.push(C[i]);
      if ((F[i] >= 0) !== (F[j] >= 0)) {
        var t = F[i] / (F[i] - F[j]);
        pts.push([C[i][0] + (C[j][0] - C[i][0]) * t, C[i][1] + (C[j][1] - C[i][1]) * t]);
      }
    }
    if (pts.length >= 3) topQuad(pts, y, k);
  }
  function landBox(x0, x1, z0, z1, y, kind) {
    // только верх: вертикаль у воды даёт стенка набережной по кривой, иначе края клеток видны «лесенкой»
    box(A, x0, x1, -1.6, y, z0, z1, GC[kind], { aG: [GK[kind]] }, "t");
  }
  function fixed(kind) { return function () { return kind; }; }
  // пляж между южным шоссе и морем (у устья реки — вырез)
  land(-M.EDGE, M.EDGE, M.BEACH_Z0, M.SEA_LINE, 0.05, fixed("sand"), 0);
  // кварталы: тротуар по кругу, внутри — двор, парк, площадь; у реки — гранитная набережная и газон
  M.blocks.forEach(function (b) {
    if (b.kind === "water") return;
    var W = M.WALK, ix0 = b.x0 + W, ix1 = b.x1 - W, iz0 = b.z0 + W, iz1 = b.z1 - W;
    if (b.kind === "shore") {
      land(b.x0, b.x1, b.z0, iz0, 0.15, fixed("pave"), 0); land(b.x0, b.x1, iz1, b.z1, 0.15, fixed("pave"), 0);
      land(b.x0, ix0, iz0, iz1, 0.15, fixed("pave"), 0); land(ix1, b.x1, iz0, iz1, 0.15, fixed("pave"), 0);
      var shoreKind = function (f) { return f < 9 ? "stone" : "grass"; };
      shoreKind.edge = 9;
      land(ix0, ix1, iz0, iz1, 0.17, shoreKind, 0);
      return;
    }
    box(A, b.x0, b.x1, -1.6, 0.15, b.z0, b.z1, pave, { aG: [0] });
    var k = b.kind === "park" ? "grass" : b.kind === "plaza" ? "plaza" : "yard";
    box(A, ix0, ix1, 0.15, 0.18, iz0, iz1, GC[k], { aG: [GK[k]] }, "t");
  });
  // за пределами сетки — земля до края карты (у реки — с вырезом)
  [[-M.EDGE - 300, -M.HALF - 12, -M.EDGE - 300, M.BEACH_Z0], [M.HALF + 12, M.EDGE + 300, -M.EDGE - 300, M.BEACH_Z0],
    [-M.HALF - 12, M.HALF + 12, -M.EDGE - 300, -M.HALF - 12]].forEach(function (r) {
    land(r[0], r[1], r[2], r[3], 0.0, fixed("grass"), 0);
  });
  var groundM = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  groundM.customProgramCacheKey = function () { return "fc-ground-1"; };
  groundM.onBeforeCompile = function (sh) {
    sh.uniforms.uWet = G.wet;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float aG; varying float vG; varying vec3 vGP;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvG = aG; vGP = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uWet; varying float vG; varying vec3 vGP; float gWet = 0.0;\nfloat gH(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }\nfloat gN(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(gH(i),gH(i+vec2(1,0)),f.x), mix(gH(i+vec2(0,1)),gH(i+vec2(1,1)),f.x), f.y); }")
      .replace("#include <color_fragment>", [
        "#include <color_fragment>",
        "{ vec2 p = vGP.xz; float k = vG; vec3 c = diffuseColor.rgb; vec2 fw = fwidth(p); float far = smoothstep(0.08, 0.3, max(fw.x, fw.y));",
        "  if (k < 0.5 || (k > 3.5 && k < 4.5) || k > 4.5) {",                       // плитка: швы и разнотон плит
        "    float sz = k > 3.5 && k < 4.5 ? 1.2 : k > 4.5 ? 0.9 : 0.6; vec2 g = p / sz; vec2 f = fract(g);",
        "    float seam = max(step(f.x, 0.05), step(f.y, 0.05)) * (1.0 - far);",
        "    c *= (0.93 + 0.1 * gH(floor(g))) * (1.0 - seam * 0.18);",
        "    if (k > 3.5 && k < 4.5) c = mix(c, c * vec3(1.05, 0.95, 0.85), step(0.5, fract((floor(g.x) + floor(g.y)) * 0.5)));",
        "  } else if (k < 1.5) {",                                                      // трава: пятна и светлые проплешины
        "    float n = gN(p * 0.15) * 0.6 + gN(p * 0.9) * 0.4; c *= 0.8 + n * 0.45; c = mix(c, vec3(0.42,0.5,0.28), smoothstep(0.75, 0.95, gN(p * 0.05)) * 0.35);",
        "  } else if (k < 2.5) {",                                                      // песок
        "    c *= 0.92 + gN(p * 0.6) * 0.14; c = mix(c, c * 0.8, smoothstep(0.35, 0.0, vGP.z - 1150.0 + gN(p * 0.1) * 8.0) * 0.0);",
        "  } else {",                                                                   // гранит набережной: крупные блоки
        "    vec2 g = p / vec2(1.8, 0.9); vec2 f = fract(g); float seam = max(step(f.x, 0.04), step(f.y, 0.06)) * (1.0 - far);",
        "    c *= (0.9 + 0.14 * gH(floor(g))) * (1.0 - seam * 0.22);",
        "  }",
        "  gWet = uWet * (k < 0.5 || k > 2.5 ? 1.0 : 0.4);",
        "  diffuseColor.rgb = c * (1.0 - gWet * 0.3); }"].join("\n"))
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.2, gWet * 0.8);");
  };
  addTo(mesh(geoOf(A), groundM, false));

  /* ---- набережные: гранитная стенка до воды и парапет по обоим берегам реки и вокруг озера ------------------ */
  var EM_ = Acc();
  (function embankments() {
    var R = M.RIVER, hw = M.RIVER_W / 2, wallC = rgb(0x8f877c), capC = rgb(0xb8b0a2);
    function bank(ax, az, bx, bz, nx, nz) {
      // стенка лицом к воде (нормаль к воде), парапет сверху
      var mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (M.onRoad(mx, mz) || M.onRoad(ax, az) || M.onRoad(bx, bz)) return;
      if (az > M.SEA_LINE - 2 && bz > M.SEA_LINE - 2) return;
      quad(EM_, [[ax, -1.6, az], [bx, -1.6, bz], [bx, 0.17, bz], [ax, 0.17, az]], [nx, 0, nz], null, wallC);
      var ox = -nx * 0.45, oz = -nz * 0.45, y1 = 1.0;
      quad(EM_, [[ax, 0.17, az], [bx, 0.17, bz], [bx, y1, bz], [ax, y1, az]], [nx, 0, nz], null, capC);
      quad(EM_, [[bx + ox, 0.17, bz + oz], [ax + ox, 0.17, az + oz], [ax + ox, y1, az + oz], [bx + ox, y1, bz + oz]], [-nx, 0, -nz], null, capC);
      quad(EM_, [[ax + ox, y1, az + oz], [bx + ox, y1, bz + oz], [bx, y1, bz], [ax, y1, az]], [0, 1, 0], null, rgb(0xcfc8ba));
    }
    // равномерная выборка линии реки
    var pts = [];
    for (var i = 0; i < R.length - 1; i++) {
      var dx = R[i + 1][0] - R[i][0], dz = R[i + 1][1] - R[i][1], L = Math.hypot(dx, dz), n = Math.ceil(L / 3);
      for (var k = 0; k < n; k++) pts.push([R[i][0] + dx * k / n, R[i][1] + dz * k / n]);
    }
    pts.push(R[R.length - 1]);
    for (var j = 0; j < pts.length - 1; j++) {
      var p = pts[j], q = pts[j + 1], tx = q[0] - p[0], tz = q[1] - p[1], tl = Math.hypot(tx, tz) || 1;
      var nx = -tz / tl, nz = tx / tl;                // нормаль влево от течения
      var pp = pts[j - 1] || p, qq = pts[j + 2] || q;
      // точки берега считаем по биссектрисе соседних нормалей — без щелей на изгибах
      var n0x = -(q[1] - pp[1]), n0z = q[0] - pp[0], l0 = Math.hypot(n0x, n0z) || 1; n0x /= l0; n0z /= l0;
      var n1x = -(qq[1] - p[1]), n1z = qq[0] - p[0], l1 = Math.hypot(n1x, n1z) || 1; n1x /= l1; n1z /= l1;
      // левый берег: стенка смотрит к воде (−n), правый — (+n)
      bank(q[0] + n1x * hw, q[1] + n1z * hw, p[0] + n0x * hw, p[1] + n0z * hw, -nx, -nz);
      bank(p[0] - n0x * hw, p[1] - n0z * hw, q[0] - n1x * hw, q[1] - n1z * hw, nx, nz);
    }
    var L2 = M.LAKE, SEG = 72;
    for (var a = 0; a < SEG; a++) {
      var a0 = a / SEG * Math.PI * 2, a1 = (a + 1) / SEG * Math.PI * 2;
      bank(L2.x + Math.cos(a1) * L2.r, L2.z + Math.sin(a1) * L2.r, L2.x + Math.cos(a0) * L2.r, L2.z + Math.sin(a0) * L2.r,
        -Math.cos((a0 + a1) / 2), -Math.sin((a0 + a1) / 2));
    }
  })();
  addTo(mesh(geoOf(EM_), new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), true));

  /* ---- дороги: рёбра половинками (зебра у каждого конца), перекрёстки квадратами, мосты с бортами ------------ */
  var RA = Acc([["aRoad", 3]]), BR = Acc();
  var Y = 0.03;
  /* Мост: настил с балками под дорогой на пролёте, кованые перила, опоры в воду, фонарные «свечи» на перилах. */
  function bridge(e, alongZ, c, s0, s1, hw) {
    var deck = rgb(0x6d6a66), rail = rgb(0x3a3d42), cap = rgb(0xc9c3b8), pier = rgb(0x8b8378);
    if (alongZ) {
      box(BR, c - hw - 0.6, c + hw + 0.6, -1.1, Y - 0.01, s0, s1, deck, null, "sewn");
      box(BR, c - hw - 0.6, c - hw, Y, 0.35, s0, s1, cap); box(BR, c + hw, c + hw + 0.6, Y, 0.35, s0, s1, cap);
      box(BR, c - hw - 0.4, c - hw - 0.2, 0.35, 1.15, s0, s1, rail); box(BR, c + hw + 0.2, c + hw + 0.4, 0.35, 1.15, s0, s1, rail);
      for (var p = s0 + 6; p < s1 - 4; p += 16) box(BR, c - hw + 1, c + hw - 1, -2.4, -1.1, p - 0.9, p + 0.9, pier);
    } else {
      box(BR, s0, s1, -1.1, Y - 0.01, c - hw - 0.6, c + hw + 0.6, deck, null, "nsew");
      box(BR, s0, s1, Y, 0.35, c - hw - 0.6, c - hw, cap); box(BR, s0, s1, Y, 0.35, c + hw, c + hw + 0.6, cap);
      box(BR, s0, s1, 0.35, 1.15, c - hw - 0.4, c - hw - 0.2, rail); box(BR, s0, s1, 0.35, 1.15, c + hw + 0.2, c + hw + 0.4, rail);
      for (var q = s0 + 6; q < s1 - 4; q += 16) box(BR, q - 0.9, q + 0.9, -2.4, -1.1, c - hw + 1, c + hw - 1, pier);
    }
    if (e) e.deckY = Y;
  }
  M.edges.forEach(function (e) {
    var a = M.nodes[e.a], b = M.nodes[e.b];
    var hw = e.w / 2;
    var lanes = e.lanes, dbl = e.kind !== "st" ? 1 : 0;
    if (e.axis === "z") {                     // вдоль z: x постоянен
      var x = a.x, za = a.z + a.hr.w / 2, zb = b.z - b.hr.w / 2, zm = (za + zb) / 2;
      // половина от a к середине: v растёт от a
      quad(RA, [[x - hw, Y, za], [x + hw, Y, za], [x + hw, Y, zm], [x - hw, Y, zm]], [0, 1, 0], [[0, 0], [1, 0], [1, zm - za], [0, zm - za]], null, { aRoad: [lanes, dbl, 1] });
      quad(RA, [[x + hw, Y, zb], [x - hw, Y, zb], [x - hw, Y, zm], [x + hw, Y, zm]], [0, 1, 0], [[0, 0], [1, 0], [1, zb - zm], [0, zb - zm]], null, { aRoad: [lanes, dbl, 1] });
      if (e.bridge) bridge(e, true, x, a.z + e.span[0], a.z + e.span[1], hw);
    } else {
      var z = a.z, xa = a.x + a.vr.w / 2, xb = b.x - b.vr.w / 2, xm = (xa + xb) / 2;
      quad(RA, [[xa, Y, z + hw], [xa, Y, z - hw], [xm, Y, z - hw], [xm, Y, z + hw]], [0, 1, 0], [[0, 0], [1, 0], [1, xm - xa], [0, xm - xa]], null, { aRoad: [lanes, dbl, 1] });
      quad(RA, [[xb, Y, z - hw], [xb, Y, z + hw], [xm, Y, z + hw], [xm, Y, z - hw]], [0, 1, 0], [[0, 0], [1, 0], [1, xb - xm], [0, xb - xm]], null, { aRoad: [lanes, dbl, 1] });
      if (e.bridge) bridge(e, false, z, a.x + e.span[0], a.x + e.span[1], hw);
    }
  });
  M.nodes.forEach(function (n) {
    var hx = n.vr.w / 2, hz = n.hr.w / 2;
    quad(RA, [[n.x - hx, Y, n.z + hz], [n.x + hx, Y, n.z + hz], [n.x + hx, Y, n.z - hz], [n.x - hx, Y, n.z - hz]], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], null, { aRoad: [0, 0, 0] });
  });
  addTo(mesh(geoOf(RA), G.mat.road(), false));
  if (BR.p.length) addTo(mesh(geoOf(BR), new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), true));

  /* ---- здания ----------------------------------------------------------------------------------------------- */
  var FA = Acc([["aFac", 4]]);       // фасады (шейдер окон)
  var RF = Acc();                    // крыши: парапеты, вентиляция, баки, антенны, шпили — цветом вершин
  var AW = Acc();                    // навесы витрин, двери, козырьки, акцентные полосы зон
  var EM = Acc();                    // светящееся: рамки дверей, полосы зон, огни на крышах (ночью ярче)
  var signs = [];
  M.buildings.forEach(function (B) {
    var x0 = B.x - B.w / 2, x1 = B.x + B.w / 2, z0 = B.z - B.d / 2, z1 = B.z + B.d / 2, h = B.h;
    var r = FC.rng(B.seed);
    var fac = [B.styleI, B.seed % 997, B.tint, B.shop ? 1 : 0];
    var setback = B.style === "glass" && h > 90 && B.w > 22 && B.d > 22;
    if (setback) {                         // башня ступенями: подиум, ствол, верхушка
      var p = h * 0.18, s = 3;
      box(FA, x0, x1, 0.15, p, z0, z1, null, { aFac: fac });
      box(FA, x0 + s, x1 - s, p, h * 0.8, z0 + s, z1 - s, null, { aFac: fac });
      box(FA, x0 + s * 2, x1 - s * 2, h * 0.8, h, z0 + s * 2, z1 - s * 2, null, { aFac: fac });
      x0 += s * 2; x1 -= s * 2; z0 += s * 2; z1 -= s * 2;
    } else box(FA, x0, x1, 0.15, h, z0, z1, null, { aFac: fac });
    // парапет
    var pc = rgb(B.style === "glass" ? 0x2f3a44 : 0x5a5650, 1);
    var t = 0.35;
    // парапет: только верх и наружная грань (внутренние с улицы не видны — минус 60% треугольников крыш)
    box(RF, x0, x1, h, h + 1, z0, z0 + t, pc, null, "tn"); box(RF, x0, x1, h, h + 1, z1 - t, z1, pc, null, "ts");
    box(RF, x0, x0 + t, h, h + 1, z0, z1, pc, null, "tw"); box(RF, x1 - t, x1, h, h + 1, z0, z1, pc, null, "te");
    // крыша: вентиляция, баки, выход на крышу; у высоких — антенна или корона
    var n = r.int(1, 4);
    for (var i = 0; i < n; i++) {
      var w = r.range(1.5, 4), d = r.range(1.5, 4), cx = r.range(x0 + w, x1 - w), cz = r.range(z0 + d, z1 - d);
      if (x1 - x0 < 2 * w + 1 || z1 - z0 < 2 * d + 1) break;
      box(RF, cx - w / 2, cx + w / 2, h, h + r.range(1, 2.6), cz - d / 2, cz + d / 2, rgb(r.pick([0x9aa1a8, 0x7d848a, 0xb0aaa0])));
    }
    if (B.style === "panel" || B.style === "stalin") {
      var bx = x0 + 3, bz = z0 + 3;
      box(RF, bx, bx + 2.4, h, h + 2.8, bz, bz + 2.4, rgb(0x8a8076));
    }
    if (h > 80) {
      var mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, ah = r.range(8, 22);
      box(RF, mx - 0.25, mx + 0.25, h, h + ah, mz - 0.25, mz + 0.25, rgb(0xcfd3d6));
      box(EM, mx - 0.4, mx + 0.4, h + ah, h + ah + 0.8, mz - 0.4, mz + 0.4, rgb(0xff3030));
      if (r.chance(0.5)) box(EM, x0, x1, h - 0.6, h - 0.2, z0 - 0.05, z0, rgb(B.dist === "msk" ? 0x6bd5ff : 0xffcf7a, 0.8));
    }
    // витрины: навес над каждой дверью и над лентой первого этажа
    B.doors.forEach(function (dr, k) {
      var ox = dr.nx, oz = dr.nz, along = oz !== 0;
      var dw = k === 0 ? 2.4 : 1.8;
      var fx = dr.x - ox * 0.9, fz = dr.z - oz * 0.9;          // точка на фасаде
      // дверь (тёмное стекло), рамка-свечение, козырёк
      if (along) {
        box(AW, fx - dw / 2, fx + dw / 2, 0.15, 2.7, fz + (oz > 0 ? 0 : -0.12), fz + (oz > 0 ? 0.12 : 0), rgb(0x1b2430));
        box(EM, fx - dw / 2 - 0.15, fx + dw / 2 + 0.15, 2.7, 2.85, fz + (oz > 0 ? 0 : -0.15), fz + (oz > 0 ? 0.15 : 0), rgb(0xffe2a8));
        box(AW, fx - dw / 2 - 0.8, fx + dw / 2 + 0.8, 3.1, 3.3, Math.min(fz, fz + oz * 1.6), Math.max(fz, fz + oz * 1.6), rgb(B.color || 0x3c4450, 0.9));
      } else {
        box(AW, fx + (ox > 0 ? 0 : -0.12), fx + (ox > 0 ? 0.12 : 0), 0.15, 2.7, fz - dw / 2, fz + dw / 2, rgb(0x1b2430));
        box(EM, fx + (ox > 0 ? 0 : -0.15), fx + (ox > 0 ? 0.15 : 0), 2.7, 2.85, fz - dw / 2 - 0.15, fz + dw / 2 + 0.15, rgb(0xffe2a8));
        box(AW, Math.min(fx, fx + ox * 1.6), Math.max(fx, fx + ox * 1.6), 3.1, 3.3, fz - dw / 2 - 0.8, fz + dw / 2 + 0.8, rgb(B.color || 0x3c4450, 0.9));
      }
    });
    if (B.shop) {
      var ac = rgb(r.pick([0xc0392b, 0x16a085, 0x2c3e50, 0xd35400, 0x8e44ad, 0x27ae60]));
      var f = B.front, L = 1.4;
      if (f === "n") box(AW, x0 + 0.5, x1 - 0.5, 4.3, 4.6, z0 - L, z0, ac);
      if (f === "s") box(AW, x0 + 0.5, x1 - 0.5, 4.3, 4.6, z1, z1 + L, ac);
      if (f === "w") box(AW, x0 - L, x0, 4.3, 4.6, z0 + 0.5, z1 - 0.5, ac);
      if (f === "e") box(AW, x1, x1 + L, 4.3, 4.6, z0 + 0.5, z1 - 0.5, ac);
    }
    // зоны, точки, штаб: цветная полоса по периметру и вывеска над входом + на крыше
    if (B.title) {
      var cc = rgb(B.color, 1.0), y0 = Math.min(h - 1.2, 6.6);
      box(EM, x0 - 0.06, x1 + 0.06, y0, y0 + 0.5, z0 - 0.06, z1 + 0.06, cc, null, "nsew");
      signs.push(B);
    }
  });
  var facade = mesh(geoOf(FA), G.mat.facade(), true); addTo(facade);
  addTo(mesh(geoOf(RF), new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), true));
  addTo(mesh(geoOf(AW), new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 }), true));
  var emMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0.3 });
  // вершинные цвета в emissive не идут сами — подмешиваем их шейдером
  emMat.onBeforeCompile = function (sh) {
    sh.uniforms.uNight = G.uniforms.night;
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uNight;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance = diffuseColor.rgb * (0.35 + uNight * 1.6);");
  };
  addTo(mesh(geoOf(EM), emMat, false));

  /* ---- вывески: над входом и на крыше (лицом на улицу) ------------------------------------------------------ */
  var signGeo = new T.PlaneGeometry(1, 0.25);
  signs.forEach(function (B) {
    var tex = G.tex.sign(B.title, B.emoji || "", B.color || "#ffcf7a");
    var mat = new T.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.6 });
    mat.onBeforeCompile = function (sh) {
      sh.uniforms.uNight = G.uniforms.night;
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uNight;")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 0.5 + uNight * 1.4;");
    };
    var dr = B.doors[0];
    var rotY = Math.atan2(dr.nx, dr.nz);
    // над входом
    var s1 = new T.Mesh(signGeo, mat);
    var sw = Math.min(14, Math.max(6, (dr.nz !== 0 ? B.w : B.d) * 0.6));
    s1.scale.set(sw, sw, 1);
    s1.position.set(dr.x - dr.nx * 0.75, Math.min(B.h - 1, 4.6) + sw * 0.125, dr.z - dr.nz * 0.75);
    s1.rotation.y = rotY;
    root.add(s1);
    // на крыше — большая, видна издалека
    if (B.h > 8) {
      var s2 = new T.Mesh(signGeo, mat), big = Math.min(28, Math.max(10, (dr.nz !== 0 ? B.w : B.d) * 0.9));
      s2.scale.set(big, big, 1);
      s2.position.set(B.x + dr.nx * (B.w / 2 - 1), B.h + 1 + big * 0.125, B.z + dr.nz * (B.d / 2 - 1));
      s2.rotation.y = rotY;
      root.add(s2);
    }
  });

  /* ---- площадь Огонька: фонтан, постамент, талисман-огонёк ----------------------------------------------------- */
  var pz = M.plaza, pcx = (pz.x0 + pz.x1) / 2, pcz = (pz.z0 + pz.z1) / 2;
  var fount = new T.Mesh(new T.CylinderGeometry(14, 15, 1.2, 40), G.mat.std(0xcfc6b4, 0.7));
  fount.position.set(pcx, 0.6, pcz); fount.receiveShadow = true; root.add(fount);
  var fw = new T.Mesh(new T.CircleGeometry(13.2, 40), waterMat);
  fw.rotation.x = -Math.PI / 2; fw.position.set(pcx, 1.05, pcz); root.add(fw);
  var ped = new T.Mesh(new T.CylinderGeometry(2.6, 3.2, 5, 8), G.mat.std(0x3b3632, 0.5, 0.3));
  ped.position.set(pcx, 3.5, pcz); ped.castShadow = true; root.add(ped);
  var ogTex = new T.TextureLoader().load(FC.BRAND.logo);
  ogTex.colorSpace = T.SRGBColorSpace;
  var ogonek = new T.Mesh(new T.PlaneGeometry(11, 11), new T.MeshBasicMaterial({ map: ogTex, transparent: true, alphaTest: 0.05, side: T.DoubleSide, fog: false }));
  ogonek.position.set(pcx, 11.5, pcz); root.add(ogonek);
  var ogGlow = new T.Sprite(new T.SpriteMaterial({ map: G.tex.glow, color: 0xff9a3c, transparent: true, opacity: 0.55, blending: T.AdditiveBlending, depthWrite: false }));
  ogGlow.scale.set(30, 30, 1); ogGlow.position.copy(ogonek.position); root.add(ogGlow);
  M.addProp(pcx, pcz, 15.2, "fountain");

  /* ---- деревья, фонари, скамейки, урны — инстансами вдоль тротуаров и в парках --------------------------------- */
  var trees = [], lamps = [], benches = [];
  var PR = FC.rng(77);
  M.edges.forEach(function (e) {
    if (e.bridge) return;
    var a = M.nodes[e.a], b = M.nodes[e.b];
    var hw = e.w / 2 + 0.9;
    var len = e.len, step = e.kind === "hw" ? 44 : 36;
    for (var s = 18; s < len - 18; s += step) {
      var t = s / len, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      var side = (Math.round(s / step) % 2) ? 1 : -1;
      var lx = e.axis === "z" ? x + side * hw : x, lz = e.axis === "z" ? z : z + side * hw;
      if (!M.buildingAt(lx, lz, 0.6) && !M.water(lx, lz)) lamps.push([lx, lz, e.axis === "z" ? (side > 0 ? -Math.PI / 2 : Math.PI / 2) : (side > 0 ? Math.PI : 0)]);
      // деревья между фонарями на обеих сторонах (у проспектов и в Минске гуще)
      var dens = e.kind === "av" ? 0.9 : 0.55;
      for (var sd = -1; sd <= 1; sd += 2) {
        if (PR() > dens) continue;
        var ts = s + step / 2, tt = ts / len;
        if (ts > len - 12) continue;
        var tx = a.x + (b.x - a.x) * tt, tz = a.z + (b.z - a.z) * tt;
        var px = e.axis === "z" ? tx + sd * (e.w / 2 + 2.2) : tx, pz2 = e.axis === "z" ? tz : tz + sd * (e.w / 2 + 2.2);
        if (!M.buildingAt(px, pz2, 1.2) && !M.water(px, pz2)) trees.push([px, pz2, PR.range(0.8, 1.3), PR()]);
      }
    }
  });
  M.blocks.forEach(function (b) {
    if (b.kind !== "park" && b.kind !== "shore") return;
    var r = FC.rng(FC.hash("park" + b.i)), n = Math.floor((b.x1 - b.x0) * (b.z1 - b.z0) / 260);
    for (var i = 0; i < n; i++) {
      var x = r.range(b.x0 + 7, b.x1 - 7), z = r.range(b.z0 + 7, b.z1 - 7);
      if (Math.abs(x - b.cx) < 2.5 || Math.abs(z - b.cz) < 2.5) continue;     // дорожки крестом
      if (M.field(x, z) < 5 || M.buildingAt(x, z, 2)) continue;              // не в реке и не в доме
      trees.push([x, z, r.range(0.9, 1.6), r()]);
    }
    for (var k = 0; k < 6; k++) { var bx2 = b.cx + r.range(-20, 20), bz2 = b.cz + (k % 2 ? 3.4 : -3.4); if (M.field(bx2, bz2) > 3 && !M.buildingAt(bx2, bz2, 1)) benches.push([bx2, bz2, k % 2 ? Math.PI : 0]); }
  });
  // пальмы и зонтики на пляже
  var umbrellas = [];
  for (var bx = -M.HALF; bx < M.HALF; bx += 26) {
    trees.push([bx + PR.range(-6, 6), M.BEACH_Z0 + PR.range(8, 20), PR.range(1.1, 1.5), 2]);
    if (PR() < 0.7) umbrellas.push([bx + PR.range(-8, 8), M.BEACH_Z0 + PR.range(30, 66)]);
  }

  function inst(geo, mat, list, place, shadow) {
    var im = new T.InstancedMesh(geo, mat, Math.max(1, list.length));
    var o = new T.Object3D();
    list.forEach(function (it, i) { place(o, it, i, im); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
    im.count = list.length;
    im.castShadow = !!shadow && G.Q.shadows; im.receiveShadow = G.Q.shadows;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    root.add(im);
    return im;
  }
  var tc = new T.Color();
  // ствол + крона (две кроны: лиственная шаром, пальма — веером конусов)
  inst(new T.CylinderGeometry(0.16, 0.26, 3.2, 5, 1, true).translate(0, 1.6, 0), G.mat.std(0x6b4a33, 0.9), trees, function (o, t) {
    o.position.set(t[0], 0.15, t[1]); o.scale.set(t[2], t[3] === 2 ? t[2] * 2.2 : t[2], t[2]); o.rotation.set(0, 0, t[3] === 2 ? 0.12 : 0);
  }, true);
  trees.forEach(function (t) { M.addProp(t[0], t[1], 0.35 * t[2], "tree"); });
  var leafy = trees.filter(function (t) { return t[3] !== 2; }), palms = trees.filter(function (t) { return t[3] === 2; });
  inst(new T.IcosahedronGeometry(1.9, G.Q.level === "high" ? 1 : 0).translate(0, 4.4, 0), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), leafy, function (o, t, i, im) {
    o.position.set(t[0], 0.15, t[1]); o.scale.set(t[2] * 1.1, t[2] * (0.9 + t[3] * 0.4), t[2] * 1.1); o.rotation.set(0, t[3] * 6, 0);
    tc.setHSL(0.24 + t[3] * 0.08, 0.45, 0.26 + t[3] * 0.1); im.setColorAt(i, tc);
  }, true);
  inst(new T.ConeGeometry(3.2, 1.2, 7, 1, true).translate(0, 7.2, 0), new T.MeshStandardMaterial({ color: 0x3f8a3a, roughness: 0.9, side: T.DoubleSide, flatShading: true }), palms, function (o, t) {
    o.position.set(t[0], 0.15, t[1]); o.scale.set(t[2], t[2], t[2]);
  }, true);
  // зонтики
  inst(new T.ConeGeometry(1.8, 0.7, 10).translate(0, 2.4, 0), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }), umbrellas, function (o, u, i, im) {
    o.position.set(u[0], 0, u[1]); tc.setHSL((i * 0.17) % 1, 0.75, 0.55); im.setColorAt(i, tc);
  }, true);

  // фонари: столб с консолью и плафоном; ночью — ореол и световое пятно на асфальте
  var poleGeo = new T.CylinderGeometry(0.09, 0.13, 7, 5, 1, true).translate(0, 3.5, 0);
  inst(poleGeo, G.mat.std(0x3a3f44, 0.5, 0.6), lamps, function (o, l) { o.position.set(l[0], 0.15, l[1]); o.rotation.set(0, 0, 0); }, true);
  var armGeo = new T.BoxGeometry(0.12, 0.12, 2.2).translate(0, 6.9, 1.1);
  inst(armGeo, G.mat.std(0x3a3f44, 0.5, 0.6), lamps, function (o, l) { o.position.set(l[0], 0.15, l[1]); o.rotation.set(0, l[2], 0); }, false);
  var headMat = new T.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffd9a0, emissiveIntensity: 0.1 });
  inst(new T.BoxGeometry(0.5, 0.18, 0.9).translate(0, 6.8, 2.1), headMat, lamps, function (o, l) { o.position.set(l[0], 0.15, l[1]); o.rotation.set(0, l[2], 0); }, false);
  lamps.forEach(function (l) { M.addProp(l[0], l[1], 0.2, "lamp"); });
  // ореолы — точки с текстурой пятна (один вызов отрисовки), пятна на асфальте — инстансы плоскости
  var gp = new Float32Array(lamps.length * 3);
  lamps.forEach(function (l, i) { gp[i * 3] = l[0] + Math.sin(l[2]) * 2.1; gp[i * 3 + 1] = 6.8; gp[i * 3 + 2] = l[1] + Math.cos(l[2]) * 2.1; });
  var gGeo = new T.BufferGeometry(); gGeo.setAttribute("position", new T.BufferAttribute(gp, 3));
  var glowMat = new T.PointsMaterial({ map: G.tex.glow, color: 0xffd08a, size: 4.5, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false });
  var glows = new T.Points(gGeo, glowMat); root.add(glows);
  var poolMat = new T.MeshBasicMaterial({ map: G.tex.glow, color: 0xffc070, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false });
  var pools = inst(new T.PlaneGeometry(11, 11).rotateX(-Math.PI / 2), poolMat, lamps, function (o, l) {
    o.position.set(l[0] + Math.sin(l[2]) * 2.1, 0.2, l[1] + Math.cos(l[2]) * 2.1);
  }, false);
  pools.receiveShadow = false;
  /* Мокрый асфальт ночью: от каждого фонаря — вытянутая к камере полоса отражения (как на мокрой улице в кино).
     Вершинный шейдер разворачивает квад к камере и тянет его от лампы к зрителю; видна только в дождь ночью. */
  var streakU = { uA: { value: 0 }, uTex: { value: G.tex.glow } };
  var streakGeo = new T.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  var sOff = new Float32Array(lamps.length * 2);
  lamps.forEach(function (l, i) { sOff[i * 2] = l[0] + Math.sin(l[2]) * 2.1; sOff[i * 2 + 1] = l[1] + Math.cos(l[2]) * 2.1; });
  streakGeo.setAttribute("aLamp", new T.InstancedBufferAttribute(sOff, 2));
  var streaks = new T.InstancedMesh(streakGeo, new T.ShaderMaterial({
    uniforms: streakU, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    vertexShader: [
      "attribute vec2 aLamp; varying vec2 vUv; varying float vF;",
      "void main(){ vec3 base = vec3(aLamp.x, 0.07, aLamp.y);",
      "  vec2 toCam = cameraPosition.xz - base.xz; float d = length(toCam); vec2 dir = toCam / max(d, 0.001);",
      "  vec2 side = vec2(-dir.y, dir.x); float len = clamp(d * 0.45, 4.0, 26.0);",
      "  vec3 p = base + vec3(side.x, 0.0, side.y) * (position.x * 1.6) + vec3(dir.x, 0.0, dir.y) * (position.y * len);",
      "  vUv = uv; vF = smoothstep(240.0, 60.0, d);",
      "  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }"].join("\n"),
    fragmentShader: [
      "uniform float uA; varying vec2 vUv; varying float vF;",
      "void main(){ float x = 1.0 - abs(vUv.x - 0.5) * 2.0; float y = 1.0 - vUv.y;",
      "  float a = pow(max(x, 0.0), 2.5) * pow(max(y, 0.0), 1.6) * uA * vF;",
      "  if (a < 0.003) discard; gl_FragColor = vec4(vec3(1.0, 0.72, 0.38) * a, a); }"].join("\n")
  }), lamps.length);
  streaks.frustumCulled = false; streaks.count = lamps.length; streaks.renderOrder = 2; streaks.visible = false;
  root.add(streaks);

  // скамейки
  inst(new T.BoxGeometry(1.8, 0.45, 0.55).translate(0, 0.45, 0), G.mat.std(0x8a5a3b, 0.8), benches, function (o, b) { o.position.set(b[0], 0.2, b[1]); o.rotation.set(0, b[2], 0); }, true);

  /* ---- светофоры: столб на углу для каждой оси, лампы — инстансы с цветом по фазе -------------------------- */
  var heads = [];      // [узел, ось, x, z, поворот]
  M.nodes.forEach(function (n) {
    if (!n.signal) return;
    var ox = n.vr.w / 2 + 1.2, oz = n.hr.w / 2 + 1.2;
    // для машин по оси z (едут на север/юг) — головы на углах +x+z и -x-z, смотрят навстречу потоку
    heads.push([n.i, "z", n.x + ox, n.z + oz, 0]); heads.push([n.i, "z", n.x - ox, n.z - oz, Math.PI]);
    heads.push([n.i, "x", n.x - ox, n.z + oz, -Math.PI / 2]); heads.push([n.i, "x", n.x + ox, n.z - oz, Math.PI / 2]);
  });
  inst(new T.CylinderGeometry(0.1, 0.12, 4.2, 5, 1, true).translate(0, 2.1, 0), G.mat.std(0x2c3035, 0.5, 0.5), heads, function (o, h) { o.position.set(h[2], 0.15, h[3]); }, false);
  heads.forEach(function (h) { M.addProp(h[2], h[3], 0.2, "signal"); });
  inst(new T.BoxGeometry(0.45, 1.25, 0.35).translate(0, 4.0, 0), G.mat.std(0x1d2024, 0.6), heads, function (o, h) { o.position.set(h[2], 0.15, h[3]); o.rotation.set(0, h[4], 0); }, false);
  var lampMat = new T.MeshBasicMaterial({ color: 0xffffff });
  var sigLamps = inst(new T.BoxGeometry(0.3, 0.3, 0.1), lampMat, heads, function (o, h, i, im) {
    o.position.set(h[2] + Math.sin(h[4]) * 0.2, 4.0, h[3] + Math.cos(h[4]) * 0.2); im.setColorAt(i, tc.setHex(0x222222));
  }, false);

  var CYCLE = 26;
  function signal(nodeI, axis) {
    var n = M.nodes[nodeI];
    if (!n || !n.signal) return "g";
    var t = (FC.clock.t / FC.clock.speed + n.phase * 13) % CYCLE;     // реальные секунды
    var xs = t < 11 ? "g" : t < 13 ? "y" : "r";
    var zs = t < 13 ? "r" : t < 24 ? "g" : "y";
    return axis === "x" ? xs : zs;
  }
  var SIGC = { g: 0x2bff6a, y: 0xffc21a, r: 0xff2a2a };
  var lastSig = "";

  /* ---- горы за Алматы и холмы по горизонту ------------------------------------------------------------- */
  var mt = [];
  var MR = FC.rng(5);
  for (var i = 0; i < 46; i++) {
    var ang = MR.range(-1.75, 0.25), rr = MR.range(1650, 2600);
    var x = Math.cos(ang) * rr + 400, z = Math.sin(ang) * rr - 300;
    mt.push([x, z, MR.range(180, 420), MR.range(260, 520)]);
  }
  for (var j = 0; j < 30; j++) {
    var a2 = MR.range(0.3, 4.6), r2 = MR.range(1800, 2500);
    mt.push([Math.cos(a2) * r2, Math.sin(a2) * r2 - 200, MR.range(60, 160), MR.range(300, 600)]);
  }
  var mGeo = new T.ConeGeometry(1, 1, 7, 3).translate(0, 0.5, 0);
  // снег на вершинах — цветом вершин по высоте
  var mc = [], mpos = mGeo.attributes.position;
  for (var v = 0; v < mpos.count; v++) {
    var yy = mpos.getY(v);
    var c3 = yy > 0.72 ? [0.95, 0.96, 0.98] : yy > 0.5 ? [0.55, 0.55, 0.58] : [0.36, 0.42, 0.33];
    mc.push(c3[0], c3[1], c3[2]);
  }
  mGeo.setAttribute("color", new T.Float32BufferAttribute(mc, 3));
  inst(mGeo, new T.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }), mt, function (o, m) {
    o.position.set(m[0], -2, m[1]); o.scale.set(m[3], m[2], m[3] * 0.9); o.rotation.set(0, m[0] * 0.01, 0);
  }, false);

  /* ---- кадр: огонёк смотрит на камеру, ночной свет, светофоры --------------------------------------------- */
  FC.addSystem({
    name: "build", order: 40,
    update: function () {
      var cam = G.camera, n = G.night;
      ogonek.rotation.y = Math.atan2(cam.position.x - ogonek.position.x, cam.position.z - ogonek.position.z);
      ogonek.position.y = 11.5 + Math.sin(performance.now() / 900) * 0.35;
      ogGlow.material.opacity = 0.35 + n * 0.45 + Math.sin(performance.now() / 300) * 0.05;
      glowMat.opacity = n * 0.95; poolMat.opacity = n * 0.55;
      streakU.uA.value = n * G.wet.value * 0.9; streaks.visible = streakU.uA.value > 0.02;
      headMat.emissiveIntensity = 0.1 + n * 2.4;
      glows.visible = n > 0.02; pools.visible = n > 0.02;
      // светофоры: пересчёт цветов раз в 0,25 с
      var key = Math.floor(FC.clock.t / FC.clock.speed * 4);
      if (key !== lastSig) {
        lastSig = key;
        for (var i = 0; i < heads.length; i++) {
          sigLamps.setColorAt(i, tc.setHex(SIGC[signal(heads[i][0], heads[i][1])]));
        }
        sigLamps.instanceColor.needsUpdate = true;
      }
    }
  });

  FC.build = { root: root, signal: signal, facade: facade, setVisible: function (v) { root.visible = v; } };
})(window);
