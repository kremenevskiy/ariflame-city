/* Флейм-Сити — 3D-модели жителей (FC.models): ближние персонажи объёмные, дальние остаются спрайтами fpeople.
 *
 * Фигурки из картинок (талисман FC.MASCOT.img; виды — необязательный набор FC_SPECIES.img(код)) → альфа-маска → контур
 * (трассировка Мура, Дуглас–Пейкер, сглаживание Чайкина) → THREE.Shape → ExtrudeGeometry с фаской. Лицо и спина —
 * картинка вида (спина зеркальная и темнее, цветом вершин), бока — цвет края (цвета «протекают» в прозрачное холстом).
 * Получается фигурка-игрушка с настоящим светом и тенью. Шаг — переваливание, подскок и мультяшный изгиб (вершинный
 * шейдер), бег — сильнее и с наклоном, стоит — дышит, сбит — кувырок и лежит.
 * Копы, спецгруппа, медики, охрана — низкополигональные человечки-игрушки из частей; скелет — кодом (ходьба, бег, стойка,
 * «задерживает» — руки вперёд, сидит). Пока модель человека не загрузилась — простой человечек (SPECIAL.civ), талисман-гид — фигурка из FC.MASCOT.img.
 *
 * Связь с fpeople: fpeople.draw зовёт FC.models.draw(order, dt) и ждёт Set тех, кого мы нарисовали сами; остальных
 * рисует спрайтами. Люди (прохожие, копы, медики, игрок — fhumans.js) идут первыми: кого взял FC.humans.draw, того здесь
 * не рисуем; пока модели людей грузятся, человек остаётся фигуркой/человечком отсюда. Состояние ch (x/y/z, vx/vz, speed, phase, face, alpha, knocked, tilt, lean, scale, cell, kind)
 * уже обновлено. Свои поля держим с подчёркиванием (ch._yaw, ch._m3d).
 *
 * Бюджет: high — до 80 моделей в 70 м (тени), mid — 40 в 45 м, low — 24 в 32 м (без теней); внутри здания — все в
 * комнате. Геометрия вида строится лениво — один вид за кадр; кэш видов — до 140, лишние выгружаются.
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE, G = FC.gfx;
  var W = global.FC_SPECIES;

  var CFG = {};
  function budget() {
    var l = G.Q.level;
    CFG.far = l === "high" ? 70 : l === "mid" ? 45 : 32;
    CFG.max = l === "high" ? 80 : l === "mid" ? 40 : 24;
    CFG.shadows = !!G.Q.shadows;
    CFG.tex = l === "high" ? 256 : 192;
    CFG.bevelSeg = l === "high" ? 2 : 1;
    CFG.eps = l === "high" ? 0.85 : 1.15;
  }
  budget();

  var SPECIAL = FC.people.SPECIAL;
  var HUMAN = {};
  HUMAN[SPECIAL.cop] = "cop"; HUMAN[SPECIAL.cop2] = "omon"; HUMAN[SPECIAL.medic] = "medic"; HUMAN[SPECIAL.guard] = "guard";
  HUMAN[SPECIAL.civ] = "civ";

  var root = new T.Group(); root.name = "models";
  G.add(root);
  var wigU = { uTime: { value: 0 } };

  /* =========================================================================================================
   * 1. Фигурки существ: контур картинки → объём
   * ========================================================================================================= */

  var OX = [-1, -1, 0, 1, 1, 1, 0, -1], OY = [0, -1, -1, -1, 0, 1, 1, 1];      // W NW N NE E SE S SW (y вниз)
  function dirOf(dx, dy) { for (var i = 0; i < 8; i++) if (OX[i] === dx && OY[i] === dy) return i; return 0; }

  // Самая крупная 4-связная область маски; остальное — в ноль (пылинки, отдельные блики).
  function largest(m, w, h) {
    var lab = new Int32Array(w * h), best = 0, bestN = 0, id = 0, stack = [];
    for (var i = 0; i < w * h; i++) {
      if (!m[i] || lab[i]) continue;
      id++; var n = 0; stack.push(i); lab[i] = id;
      while (stack.length) {
        var p = stack.pop(), x = p % w, y = (p / w) | 0; n++;
        if (x > 0 && m[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack.push(p - 1); }
        if (x < w - 1 && m[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack.push(p + 1); }
        if (y > 0 && m[p - w] && !lab[p - w]) { lab[p - w] = id; stack.push(p - w); }
        if (y < h - 1 && m[p + w] && !lab[p + w]) { lab[p + w] = id; stack.push(p + w); }
      }
      if (n > bestN) { bestN = n; best = id; }
    }
    for (var j = 0; j < w * h; j++) m[j] = lab[j] === best ? 1 : 0;
    return bestN;
  }
  // Морфология на маске: dilate (8-соседи) и erode.
  function morph(m, w, h, grow) {
    var o = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var any = 0, all = 1;
        for (var k = 0; k < 8; k++) {
          var nx = x + OX[k], ny = y + OY[k];
          var v = nx >= 0 && ny >= 0 && nx < w && ny < h ? m[ny * w + nx] : 0;
          if (v) any = 1; else all = 0;
        }
        var c = m[y * w + x];
        o[y * w + x] = grow ? (c || any ? 1 : 0) : (c && all ? 1 : 0);
      }
    }
    return o;
  }
  // Заливка дыр: всё, что не достижимо от края по фону, — внутри (фигурке дырки не нужны).
  function fillHoles(m, w, h) {
    var out = new Uint8Array(w * h), st = [];
    for (var x = 0; x < w; x++) { st.push(x, (h - 1) * w + x); }
    for (var y = 0; y < h; y++) { st.push(y * w, y * w + w - 1); }
    while (st.length) {
      var p = st.pop();
      if (out[p] || m[p]) continue;
      out[p] = 1;
      var px = p % w, py = (p / w) | 0;
      if (px > 0) st.push(p - 1); if (px < w - 1) st.push(p + 1);
      if (py > 0) st.push(p - w); if (py < h - 1) st.push(p + w);
    }
    for (var i = 0; i < w * h; i++) m[i] = out[i] ? 0 : 1;
  }
  // Трассировка Мура: внешняя граница области по часовой (в координатах картинки).
  function trace(m, w, h) {
    var s = -1;
    for (var i = 0; i < w * h; i++) if (m[i]) { s = i; break; }
    if (s < 0) return null;
    var sx = s % w, sy = (s / w) | 0, cx = sx, cy = sy, bd = 0, pts = [[sx, sy]], firstMove = -1;
    for (var step = 0; step < w * h * 4; step++) {
      var found = false;
      for (var k = 1; k <= 8; k++) {
        var d = (bd + k) % 8, nx = cx + OX[d], ny = cy + OY[d];
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && m[ny * w + nx]) {
          var pd = (bd + k + 7) % 8, bx = cx + OX[pd], by = cy + OY[pd];
          if (firstMove < 0) firstMove = d;
          else if (cx === sx && cy === sy && d === firstMove) return pts;      // критерий Джейкоба
          cx = nx; cy = ny; bd = dirOf(bx - cx, by - cy); found = true;
          break;
        }
      }
      if (!found) return pts;
      if (!(cx === sx && cy === sy)) pts.push([cx, cy]);
    }
    return pts;
  }
  function dpOpen(pts, a, b, eps, out) {
    var ax = pts[a][0], ay = pts[a][1], bx = pts[b][0], by = pts[b][1];
    var dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, best = -1, bi = -1;
    for (var i = a + 1; i < b; i++) {
      var d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > eps) { dpOpen(pts, a, bi, eps, out); out.push(pts[bi]); dpOpen(pts, bi, b, eps, out); }
  }
  function simplify(pts, eps) {
    if (pts.length < 8) return pts;
    var far = 0, fd = -1;
    for (var i = 1; i < pts.length; i++) { var d = (pts[i][0] - pts[0][0]) * (pts[i][0] - pts[0][0]) + (pts[i][1] - pts[0][1]) * (pts[i][1] - pts[0][1]); if (d > fd) { fd = d; far = i; } }
    var loop = pts.concat([pts[0]]), out = [loop[0]];
    dpOpen(loop, 0, far, eps, out); out.push(loop[far]); dpOpen(loop, far, loop.length - 1, eps, out);
    return out;
  }
  function chaikin(pts) {
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], q = pts[(i + 1) % pts.length];
      out.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25], [p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
    }
    return out;
  }

  /* Текстура вида: цвета краёв «протекают» в прозрачное (иначе на кромке белая/чёрная бахрома), фон — средний цвет. */
  function bleedTexture(img, size) {
    var k = size / Math.max(img.width, img.height);
    var w = Math.max(2, Math.round(img.width * k)), h = Math.max(2, Math.round(img.height * k));
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    var x = c.getContext("2d");
    x.drawImage(img, 0, 0, w, h);
    x.globalCompositeOperation = "destination-over";
    for (var r = 1; r <= 6; r++) {
      for (var a = 0; a < 8; a++) {
        var ang = a / 8 * Math.PI * 2;
        x.drawImage(img, Math.round(Math.cos(ang) * r), Math.round(Math.sin(ang) * r), w, h);
      }
    }
    // средний цвет картинки — на подложку
    var s = document.createElement("canvas"); s.width = s.height = 1;
    var sx = s.getContext("2d", { willReadFrequently: true }); sx.drawImage(img, 0, 0, 1, 1);
    var px = sx.getImageData(0, 0, 1, 1).data;
    x.fillStyle = "rgb(" + px[0] + "," + px[1] + "," + px[2] + ")";
    x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = "source-over";
    var t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4;
    t.generateMipmaps = true; t.minFilter = T.LinearMipmapLinearFilter;
    return t;
  }

  function patchFigure(m) {
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uTime = wigU.uTime;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec2 aWig;")
        .replace("#include <begin_vertex>", [
          "#include <begin_vertex>",
          // мультяшный изгиб: верх отстаёт и раскачивается, чем выше точка — тем сильнее
          "{ float hy = max(transformed.y, 0.0);",
          "  transformed.x += aWig.y * sin(aWig.x) * hy * hy * 0.16;",
          "  transformed.z += aWig.y * cos(aWig.x * 2.0) * hy * 0.035; }"].join("\n"));
    };
    m.customProgramCacheKey = function () { return "fc-figure"; };
    return m;
  }

  /* Строит геометрию и материал вида из картинки. Возвращает {geo, mat, h} или null. */
  function buildFigure(img) {
    var MAXD = 112;
    var k = MAXD / Math.max(img.width, img.height);
    var w = Math.round(img.width * k), h = Math.round(img.height * k), P = 3;
    var W2 = w + P * 2, H2 = h + P * 2;
    var c = document.createElement("canvas"); c.width = W2; c.height = H2;
    // willReadFrequently: холст в памяти процессора — getImageData без чтения из видеокарты (было 60% CPU в профиле)
    var cx2 = c.getContext("2d", { willReadFrequently: true }); cx2.drawImage(img, P, P, w, h);
    var data = cx2.getImageData(0, 0, W2, H2).data;
    var m = new Uint8Array(W2 * H2);
    for (var i = 0; i < W2 * H2; i++) m[i] = data[i * 4 + 3] > 96 ? 1 : 0;
    m = morph(morph(m, W2, H2, true), W2, H2, false);       // закрыть щели в один пиксель
    if (largest(m, W2, H2) < 30) return null;
    fillHoles(m, W2, H2);
    m = morph(m, W2, H2, true);                               // чуть шире — вобрать сглаженный край рисунка
    var pts = trace(m, W2, H2);
    if (!pts || pts.length < 8) return null;
    pts = simplify(pts, CFG.eps);
    if (pts.length < 70) pts = chaikin(pts);
    if (pts.length < 6) return null;
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    pts.forEach(function (p) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); });
    var S = Math.max(maxX - minX, maxY - minY), cxm = (minX + maxX) / 2;
    // маска → координаты фигуры (высота до 1, низ в 0, центр по x) и обратно → uv картинки
    function toUV(X, Y) {
      var mx = X * S + cxm, my = maxY - Y * S;
      return new T.Vector2((mx - P) / w, 1 - (my - P) / h);
    }
    var shape = new T.Shape();
    pts.forEach(function (p, j) {
      var X = (p[0] - cxm) / S, Y = (maxY - p[1]) / S;
      if (j === 0) shape.moveTo(X, Y); else shape.lineTo(X, Y);
    });
    var depth = 0.15, bt = 0.035, bs = 0.016;
    var uvGen = {
      generateTopUV: function (geo, v, a, b, cc) { return [toUV(v[a * 3], v[a * 3 + 1]), toUV(v[b * 3], v[b * 3 + 1]), toUV(v[cc * 3], v[cc * 3 + 1])]; },
      generateSideWallUV: function (geo, v, a, b, cc, d) {
        return [toUV(v[a * 3], v[a * 3 + 1]), toUV(v[b * 3], v[b * 3 + 1]), toUV(v[cc * 3], v[cc * 3 + 1]), toUV(v[d * 3], v[d * 3 + 1])];
      }
    };
    var geo = new T.ExtrudeGeometry(shape, { depth: depth, bevelEnabled: true, bevelThickness: bt, bevelSize: bs,
      bevelSegments: CFG.bevelSeg, curveSegments: 1, steps: 1, UVGenerator: uvGen });
    geo.translate(0, bs, -depth / 2);
    // лицо — полная яркость, спина — темнее, бока — между
    var nrm = geo.attributes.normal, cols = new Float32Array(nrm.count * 3);
    for (var q = 0; q < nrm.count; q++) {
      var nz = nrm.getZ(q), v2 = nz > 0.55 ? 1 : nz < -0.55 ? 0.66 : 0.86;
      cols[q * 3] = cols[q * 3 + 1] = cols[q * 3 + 2] = v2;
    }
    geo.setAttribute("color", new T.BufferAttribute(cols, 3));
    geo.computeBoundingSphere();
    var tex = bleedTexture(img, CFG.tex);
    var mat = patchFigure(new T.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.5, metalness: 0,
      emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.06, envMapIntensity: 0.7 }));
    return { geo: geo, mat: mat, h: (maxY - minY) / S, depth: depth + bt * 2 };
  }

  /* ---- кэш видов: загрузка картинки → очередь → постройка по одному за кадр -------------------------------------- */
  var species = {};          // код → {state, img, geo, mat, pool, used}
  var queue = [];
  var nSpecies = 0;
  // картинка фигурки: талисман — FC.MASCOT.img; вид — из необязательного набора видов FC_SPECIES.img(code)
  function urlOf(code) { var S = global.FC_SPECIES; return code === "mascot" ? FC.MASCOT.img : S && S.img ? S.img(code) : null; }
  function want(code) {
    var s = species[code];
    if (s) { s.used = performance.now(); return s.state === "ready" ? s : null; }
    s = species[code] = { state: "loading", used: performance.now(), code: code };
    var url = urlOf(code);
    if (!url) { s.state = "failed"; return null; }
    var img = new Image();
    img.decoding = "async";
    img.onload = function () { s.img = img; s.state = "queued"; queue.push(s); };
    img.onerror = function () { s.state = "failed"; };
    img.src = url;
    return null;
  }
  var lastBuild = 0;
  function pump() {
    var now = performance.now();
    if (!queue.length || now - lastBuild < 24) return;
    var s = queue.shift();
    lastBuild = now;
    var f = null;
    try { f = buildFigure(s.img); } catch (e) { f = null; }
    s.img = null;
    if (!f) { s.state = "failed"; return; }
    s.geo = f.geo; s.mat = f.mat; s.h = f.h; s.depth = f.depth;
    s.pool = pool(s.geo, s.mat, 4, true);
    s.state = "ready"; nSpecies++;
    evict();
  }
  function evict() {
    if (nSpecies <= 140) return;
    var list = Object.keys(species).map(function (k) { return species[k]; })
      .filter(function (s) { return s.state === "ready" && s.pool.mesh.count === 0; })
      .sort(function (a, b) { return a.used - b.used; });
    for (var i = 0; i < list.length && nSpecies > 120; i++) {
      var s = list[i];
      root.remove(s.pool.mesh);
      s.geo.dispose(); s.mat.map.dispose(); s.mat.dispose();
      delete species[s.code]; nSpecies--;
    }
  }

  /* ---- пул инстансов: InstancedMesh, растущий удвоением; у фигурок — атрибут изгиба aWig ------------------------- */
  function pool(geo, mat, cap, wig) {
    var P = { geo: geo, mat: mat, cap: cap, wig: wig, mesh: null, n: 0 };
    P.make = function () {
      if (P.mesh) root.remove(P.mesh);
      if (P.wig) {
        var a = new T.InstancedBufferAttribute(new Float32Array(P.cap * 2), 2);
        a.setUsage(T.DynamicDrawUsage); P.geo.setAttribute("aWig", a); P.aWig = a;
      }
      P.mesh = new T.InstancedMesh(P.geo, P.mat, P.cap);
      P.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      P.mesh.frustumCulled = false; P.mesh.count = 0;
      P.mesh.castShadow = CFG.shadows; P.mesh.receiveShadow = false;
      root.add(P.mesh);
    };
    P.slot = function () {
      if (P.n >= P.cap) {
        var old = P.mesh, oldW = P.aWig;
        P.cap *= 2; P.make();
        for (var i = 0; i < P.n; i++) {
          old.getMatrixAt(i, tmpM); P.mesh.setMatrixAt(i, tmpM);
          if (old.instanceColor) { old.getColorAt(i, tmpC); P.mesh.setColorAt(i, tmpC); }
          if (oldW) P.aWig.setXY(i, oldW.getX(i), oldW.getY(i));
        }
      }
      return P.n++;
    };
    P.begin = function () { P.n = 0; };
    P.end = function () {
      P.mesh.count = P.n;
      if (P.n) {
        P.mesh.instanceMatrix.needsUpdate = true;
        if (P.mesh.instanceColor) P.mesh.instanceColor.needsUpdate = true;
        if (P.aWig) P.aWig.needsUpdate = true;
      }
    };
    P.make();
    return P;
  }
  var tmpM = new T.Matrix4(), tmpC = new T.Color();

  /* =========================================================================================================
   * 2. Человечки-игрушки: части InstancedMesh, скелет кодом
   * ========================================================================================================= */
  function cyl(rt, rb, h, seg, dy) { return new T.CylinderGeometry(rt, rb, h, seg || 8).translate(0, dy, 0); }
  function sph(r, ws, hs) { return new T.SphereGeometry(r, ws || 10, hs || 8); }
  function paint(geo, hex) {
    var n = geo.attributes.position.count, c = new Float32Array(n * 3), col = new T.Color(hex);
    for (var i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
    geo.setAttribute("color", new T.BufferAttribute(c, 3));
    return geo;
  }
  function merge(list) { return T.mergeGeometries(list, false); }
  // Единичный человечек 1.8 м: ось части — от точки подвеса вниз (ноги, руки) или от центра (тело, голова).
  var partMat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.05 });
  var vcMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1 });
  var PARTS = {
    leg: pool(merge([cyl(0.085, 0.075, 0.74, 8, -0.37), paint(new T.BoxGeometry(0.13, 0.09, 0.25).translate(0, -0.77, 0.04), 0x141414)].map(function (g, i) { return i ? g : paint(g, 0xffffff); })), vcMat.clone(), 16),
    hips: pool(new T.BoxGeometry(0.34, 0.17, 0.22), partMat.clone(), 8),
    torso: pool(cyl(0.22, 0.19, 0.54, 10, 0).scale(1, 1, 0.62), partMat.clone(), 8),
    arm: pool(cyl(0.062, 0.055, 0.56, 8, -0.28), partMat.clone(), 16),
    hand: pool(sph(0.07, 8, 6), partMat.clone(), 16),
    head: pool(sph(0.18, 14, 12).scale(1, 1.05, 1), partMat.clone(), 8),
    eyes: pool(merge([sph(0.032, 6, 5).translate(-0.065, 0.02, 0.16), sph(0.032, 6, 5).translate(0.065, 0.02, 0.16),
      new T.BoxGeometry(0.08, 0.012, 0.01).translate(0, -0.07, 0.172)]), new T.MeshStandardMaterial({ color: 0x1b1b22, roughness: 0.3 }), 8),
    cap: pool(merge([paint(cyl(0.19, 0.18, 0.1, 14, 0.05), 0x1c2c5e), paint(cyl(0.2, 0.2, 0.02, 14, 0.0).scale(1, 1, 1).translate(0, 0, 0.07), 0x111111),
      paint(new T.BoxGeometry(0.06, 0.05, 0.02).translate(0, 0.06, 0.19), 0xffd23f), paint(cyl(0.192, 0.192, 0.022, 14, 0.1), 0xc0392b)]), vcMat.clone(), 8),
    helmet: pool(merge([paint(new T.SphereGeometry(0.215, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0x2b3138), paint(new T.BoxGeometry(0.3, 0.09, 0.02).translate(0, -0.03, 0.2), 0x7fa4c8)]), vcMat.clone(), 8),
    medcap: pool(merge([paint(cyl(0.18, 0.18, 0.09, 12, 0.045), 0xf4f6f8), paint(new T.BoxGeometry(0.06, 0.02, 0.015).translate(0, 0.05, 0.185), 0xe63946),
      paint(new T.BoxGeometry(0.02, 0.06, 0.015).translate(0, 0.05, 0.186), 0xe63946)]), vcMat.clone(), 8),
    vest: pool(paint(new T.BoxGeometry(0.47, 0.42, 0.32), 0x2a2f36), vcMat.clone(), 8),
    coat: pool(merge([paint(cyl(0.235, 0.27, 0.78, 10, -0.12).scale(1, 1, 0.64), 0xf2f5f7), paint(new T.BoxGeometry(0.11, 0.03, 0.02).translate(-0.09, 0.12, 0.155), 0xe63946),
      paint(new T.BoxGeometry(0.03, 0.11, 0.02).translate(-0.09, 0.12, 0.156), 0xe63946)]), vcMat.clone(), 8),
    badge: pool(paint(new T.BoxGeometry(0.06, 0.07, 0.02), 0xffd23f), vcMat.clone(), 8)
  };
  var LOOK = {
    cop: { uniform: 0x2f5fd0, pants: 0x1b2a5a, hat: "cap", extra: "badge" },
    omon: { uniform: 0x3a4a5a, pants: 0x2a323c, hat: "helmet", extra: "vest" },
    medic: { uniform: 0xe9eef2, pants: 0x9fb4c8, hat: "medcap", extra: "coat" },
    guard: { uniform: 0x2a2a2a, pants: 0x1a1a1a, hat: null, extra: "badge" },
    civ: { uniform: 0xd2553a, pants: 0x2b3a55, hat: null, extra: null }
  };
  var SKIN = [0xffd8b0, 0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffe0c4];

  var mB = new T.Matrix4(), mL = new T.Matrix4(), mO = new T.Matrix4(), qq = new T.Quaternion(), ee = new T.Euler(0, 0, 0, "YXZ");
  var vv = new T.Vector3(), ss = new T.Vector3(1, 1, 1), one = new T.Vector3(1, 1, 1);
  function put(P, px, py, pz, rx, ry, rz, sx, sy, sz, color) {
    ee.set(rx || 0, ry || 0, rz || 0, "XYZ"); qq.setFromEuler(ee); vv.set(px, py, pz);
    if (sx) ss.set(sx, sy, sz); else ss.copy(one);
    mL.compose(vv, qq, ss); mO.multiplyMatrices(mB, mL);
    var i = P.slot(); P.mesh.setMatrixAt(i, mO);
    if (color != null) P.mesh.setColorAt(i, tmpC.setHex(color));
    return mO;
  }
  // кисть — на конце руки: матрица руки × сдвиг вдоль её оси
  var mHandOff = new T.Matrix4().makeTranslation(0, -0.6, 0), mHand = new T.Matrix4();
  function hand(armM, color) {
    mHand.multiplyMatrices(armM, mHandOff);
    var i = PARTS.hand.slot(); PARTS.hand.mesh.setMatrixAt(i, mHand); PARTS.hand.mesh.setColorAt(i, tmpC.setHex(color));
  }
  function drawHuman(ch, look, t) {
    var sp = ch.speed || 0, run = sp > 3.4, walk = sp > 0.25;
    var ph = ch.phase, A = run ? 0.95 : walk ? 0.55 : 0;
    var arrest = ch.kind === "cop" && FC.player && FC.dist2(ch.x, ch.z, FC.player.x, FC.player.z) < 2.4 * 2.4 && FC.player.mode === "foot";
    var sit = !!ch.sit;
    var swing = Math.sin(ph) * A, bob = walk ? Math.abs(Math.cos(ph)) * (run ? 0.07 : 0.035) : Math.sin(t * 2 + ph) * 0.006;
    var k = (ch.scale || 1.8) / 1.8;
    var lean = run ? 0.14 : walk ? 0.04 : 0;
    // корпус: позиция, курс, крен (сбит), наклон (бег)
    ee.set(lean, ch._yaw, ch.knocked > 0 ? ch.tilt : 0, "YXZ"); qq.setFromEuler(ee);
    var lie = ch.knocked > 0 ? Math.abs(Math.sin(ch.tilt)) * 0.18 : 0;
    vv.set(ch.x, (ch.y || 0.15) + bob + lie - (sit ? 0.42 : 0), ch.z);
    ss.set(k, k, k);
    mB.compose(vv, qq, ss);
    var skin = SKIN[ch._skin], uni = look.uniform, pants = look.pants;
    var legX = sit ? -1.45 : 0;
    put(PARTS.leg, -0.1, 0.86, 0, legX + swing, 0, 0, 0, 0, 0, pants);
    put(PARTS.leg, 0.1, 0.86, 0, legX - swing, 0, 0, 0, 0, 0, pants);
    put(PARTS.hips, 0, 0.9, 0, 0, 0, 0, 0, 0, 0, pants);
    put(PARTS.torso, 0, 1.22, 0, 0, 0, 0, 0, 0, 0, uni);
    var armA = arrest ? -1.35 : sit ? -0.9 : -swing * 0.85;
    var armL = arrest ? armA + Math.sin(t * 9) * 0.08 : armA, armR = arrest ? armA - Math.sin(t * 9) * 0.08 : -armA;
    var spread = arrest ? 0.12 : 0.08;
    hand(put(PARTS.arm, -0.27, 1.45, 0, armL, 0, -spread, 0, 0, 0, uni), skin);
    hand(put(PARTS.arm, 0.27, 1.45, 0, armR, 0, spread, 0, 0, 0, uni), skin);
    var nod = walk ? Math.sin(ph * 2) * 0.04 : Math.sin(t * 1.3 + ph) * 0.03;
    put(PARTS.head, 0, 1.68, 0, nod, 0, 0, 0, 0, 0, skin);
    put(PARTS.eyes, 0, 1.68, 0, nod, 0, 0);
    if (look.hat) put(PARTS[look.hat], 0, 1.8, 0, nod, 0, 0);
    if (look.extra === "badge") put(PARTS.badge, -0.1, 1.32, 0.135, 0, 0, 0);
    else if (look.extra) put(PARTS[look.extra], 0, look.extra === "coat" ? 1.22 : 1.24, 0, 0, 0, 0);
  }

  /* =========================================================================================================
   * 3. Тени
   * ========================================================================================================= */
  var blobs = pool(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ map: G.tex.blob, transparent: true, depthWrite: false }), 16);
  blobs.mesh.castShadow = false; blobs.mesh.renderOrder = 1;

  /* =========================================================================================================
   * 4. Кадр: кого берём в 3D, поза, матрицы
   * ========================================================================================================= */
  var taken = new Set();
  var cand = [];
  var LIM_NPC = 55 * Math.PI / 180, LIM_ME = 115 * Math.PI / 180;
  function kindOf(ch) {
    if (HUMAN[ch.cell]) return "human";
    if (ch.cell === SPECIAL.guide) return "fig:mascot";
    if (ch.cell == null || ch.cell < 0 || ch.cell >= 900) return null;
    var code = W && W.CRE[ch.cell + 1];
    return code ? "fig:" + code : null;
  }
  function faceYaw(ch, cam, dt, human) {
    var toCam = Math.atan2(cam.x - ch.x, cam.z - ch.z);
    var sp = ch.speed || 0;
    if (ch._yaw == null) ch._yaw = toCam;
    var target;
    if (sp > 0.3) target = Math.atan2(ch.vx, ch.vz);
    else target = human ? ch._yaw : toCam;
    if (!human) {
      var lim = ch.kind === "player" ? LIM_ME : LIM_NPC;
      var rel = FC.angWrap(target - toCam);
      if (rel > lim) rel = lim; if (rel < -lim) rel = -lim;
      target = toCam + rel;
    }
    if (ch.knocked > 0) target = ch._yaw;
    ch._yaw = FC.angDamp(ch._yaw, target, sp > 3 ? 10 : 7, dt);
  }
  var mF = new T.Matrix4(), qF = new T.Quaternion(), eF = new T.Euler(0, 0, 0, "YXZ"), vF = new T.Vector3(), sF = new T.Vector3();
  function drawFigure(s, ch, t) {
    var sp = ch.speed || 0, run = sp > 3.4, walk = sp > 0.25;
    var ph = ch.phase, sc = (ch.scale || 1.8) * (0.25 + 0.75 * Math.min(1, ch.alpha * 1.3));
    var bob = walk ? Math.abs(Math.sin(ph)) * (run ? 0.16 : 0.09) * sc * 0.5 : 0;
    var waddle = walk ? Math.sin(ph) * (run ? 0.1 : 0.14) : Math.sin(t * 1.6 + ph) * 0.02;   // ±8° шаг
    var lean = run ? 0.2 : walk ? 0.06 : 0;
    var breath = walk ? Math.cos(ph * 2) * 0.04 : Math.sin(t * 2.2 + ph) * 0.02;
    if (ch.sit) { waddle = Math.sin(t * 1.2 + ph) * 0.015; bob = -0.12 * sc; lean = 0.05; }    // сидит за столом (интерьер)
    var roll = ch.knocked > 0 ? ch.tilt : waddle + (ch.lean || 0) * 0.6;
    eF.set(lean, ch._yaw, roll, "YXZ"); qF.setFromEuler(eF);
    var lie = ch.knocked > 0 ? Math.abs(Math.sin(ch.tilt)) * s.depth * 0.5 * sc : 0;
    vF.set(ch.x, (ch.y || 0.15) + bob + lie, ch.z);
    sF.set(sc * (1 - breath * 0.5), sc * (1 + breath), sc);
    mF.compose(vF, qF, sF);
    var i = s.pool.slot();
    s.pool.mesh.setMatrixAt(i, mF);
    s.pool.aWig.setXY(i, ph + (walk ? 0 : t), walk ? (run ? 0.9 : 0.6) : 0.18);
  }
  function blob(ch, r) {
    eF.set(0, 0, 0); qF.setFromEuler(eF);
    vF.set(ch.x, (ch.ground || 0.17) + 0.012, ch.z); sF.set(r, 1, r * 0.8);
    mF.compose(vF, qF, sF);
    blobs.mesh.setMatrixAt(blobs.slot(), mF);
  }

  function addTaken(c) { taken.add(c); }
  function draw(order, dt) {
    taken.clear();
    var hum = FC.humans && FC.humans.draw ? FC.humans.draw(order, dt) : null;
    var t = performance.now() / 1000;
    wigU.uTime.value = t;
    pump();
    var cam = G.camera.position;
    var inside = FC.inside && FC.inside.active;
    var far = CFG.far, far2 = far * far, max = inside ? 60 : CFG.max;
    cand.length = 0;
    for (var i = 0; i < order.length; i++) {
      var ch = order[i];
      if (!ch.visible) continue;
      if (hum && hum.has(ch)) { ch._m3d = false; continue; }
      var d = ch._d != null ? ch._d : FC.dist2(ch.x, ch.z, cam.x, cam.z);
      var lim = ch._m3d ? far2 * 1.2 : far2;               // гистерезис: не мигать на границе
      if (!inside && d > lim && ch.kind !== "player") { ch._m3d = false; continue; }
      cand.push(ch);
    }
    cand.sort(function (a, b) { return (a.kind === "player" ? -1 : a._d) - (b.kind === "player" ? -1 : b._d); });
    // начало кадра у всех пулов
    Object.keys(species).forEach(function (k) { var s = species[k]; if (s.pool) s.pool.begin(); });
    Object.keys(PARTS).forEach(function (k) { PARTS[k].begin(); });
    blobs.begin();
    var n = 0;
    for (var j = 0; j < cand.length && n < max; j++) {
      var c = cand[j], kind = kindOf(c);
      if (!kind) { c._m3d = false; continue; }
      if (kind === "human") {
        if (c._skin == null) c._skin = FC.hash(c.id) % SKIN.length;
        faceYaw(c, cam, dt, true);
        drawHuman(c, LOOK[HUMAN[c.cell]], t);
        blob(c, 0.9);
      } else {
        var s = want(kind.slice(4));
        if (!s) { c._m3d = false; continue; }
        faceYaw(c, cam, dt, false);
        drawFigure(s, c, t);
        blob(c, (c.scale || 1.8) * 0.5);
      }
      c._m3d = true; taken.add(c); n++;
    }
    Object.keys(species).forEach(function (k) { var s = species[k]; if (s.pool) s.pool.end(); });
    Object.keys(PARTS).forEach(function (k) { PARTS[k].end(); });
    blobs.end();
    // ночью фигурки чуть светятся своими цветами — иначе в темноте их не прочесть
    var glow = 0.05 + G.night * 0.22;
    Object.keys(species).forEach(function (k) { var s = species[k]; if (s.mat) s.mat.emissiveIntensity = glow; });
    if (hum) hum.forEach(addTaken);
    return taken;
  }

  FC.on("quality", function () {
    budget();
    Object.keys(species).forEach(function (k) { var s = species[k]; if (s.pool) s.pool.mesh.castShadow = CFG.shadows; });
    Object.keys(PARTS).forEach(function (k) { PARTS[k].mesh.castShadow = CFG.shadows; });
  });

  // заранее — фигурка талисмана
  FC.on("me", function () { want("mascot"); });

  FC.models = {
    draw: draw,
    stats: function () {
      var ready = 0, drawn = 0;
      Object.keys(species).forEach(function (k) { var s = species[k]; if (s.state === "ready") { ready++; drawn += s.pool.mesh.count; } });
      return { species: ready, queued: queue.length, figures: drawn, humans: PARTS.head.mesh.count, far: CFG.far, max: CFG.max };
    },
    preload: want
  };
})(window);
