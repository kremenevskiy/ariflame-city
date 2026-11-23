/* Флейм-Сити — облик города поверх планировки: узнаваемые здания зон (алмаз библиотеки, маяк разведки, колесо
 * обозрения, сталинская высотка, студии), огонёк на Башне Флейм, рекламные щиты на крышах, вывески
 * магазинов (атлас — один вызов отрисовки), остановки, киоски, таблички улиц на перекрёстках.
 *
 * Своё — без копий чужих башен (задача): силуэты по мотивам городов, но собственные.
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE, M = FC.map, G = FC.gfx, B_ = FC.build;
  if (M.minsk) return;                               // Минск 1:1 — убранство улиц даёт fosm.js
  var root = B_.root;
  var night = G.uniforms.night;

  /* ---- светящиеся ночью материалы: картинка как есть днём, ярче ночью ------------------------------------- */
  function glowMat(tex, opt) {
    var m = new T.MeshStandardMaterial(Object.assign({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 1, roughness: 0.6 }, opt || {}));
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uNight = night;
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uNight;")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 0.25 + uNight * 1.5;");
    };
    return m;
  }
  function add(o) { root.add(o); return o; }
  var spin = [];                                // что крутится каждый кадр: [obj, ось, скорость]

  /* Статичные мелочи (щиты, остановки, киоски) сливаем по материалу: сотни мелких мешей — сотни вызовов отрисовки. */
  var bakes = new Map(), tmpO = new T.Object3D(), tmpM = new T.Matrix4();
  function piece(mat, geo, x, y, z, ry, rx, sx, sy, sz, parent) {
    tmpO.position.set(x, y, z); tmpO.rotation.set(rx || 0, ry || 0, 0); tmpO.scale.set(sx || 1, sy || 1, sz || 1); tmpO.updateMatrix();
    var g = geo.clone().applyMatrix4(parent ? tmpM.multiplyMatrices(parent, tmpO.matrix) : tmpO.matrix);
    if (!bakes.has(mat)) bakes.set(mat, []);
    bakes.get(mat).push(g);
  }
  function bakeAll() {
    bakes.forEach(function (list, mat) {
      var m = new T.Mesh(T.mergeGeometries(list), mat);
      m.receiveShadow = G.Q.shadows; m.matrixAutoUpdate = false; add(m);
      list.forEach(function (g) { g.dispose(); });
    });
    bakes.clear();
  }
  var BOX = new T.BoxGeometry(1, 1, 1), PLANE = new T.PlaneGeometry(1, 1);
  function frameOf(x, y, z, ry) { tmpO.position.set(x, y, z); tmpO.rotation.set(0, ry, 0); tmpO.scale.set(1, 1, 1); tmpO.updateMatrix(); return tmpO.matrix.clone(); }

  /* ---- атлас вывесок: 4×16 клеток 256×64 ------------------------------------------------------------------ */
  var SHOPS = [["ПРОДУКТЫ", "#2e7d32"], ["АПТЕКА", "#00897b"], ["КАФЕ «УЮТ»", "#6d4c41"], ["ЦВЕТЫ", "#d81b60"], ["ПЕКАРНЯ", "#ef6c00"],
    ["РЕМОНТ ТЕЛЕФОНОВ", "#3949ab"], ["ОБУВЬ", "#5d4037"], ["ОПТИКА", "#1e88e5"], ["ШАУРМА 24", "#f4511e"], ["КНИГИ", "#7b1fa2"],
    ["ХОЗТОВАРЫ", "#546e7a"], ["САЛОН СВЯЗИ", "#e53935"], ["СУШИ", "#c62828"], ["ПИЦЦА", "#ff8f00"], ["ХИМЧИСТКА", "#0277bd"],
    ["ЛОМБАРД", "#827717"], ["ЗООМАГАЗИН", "#2e7d32"], ["КОФЕ С СОБОЙ", "#4e342e"], ["ФРУКТЫ", "#558b2f"], ["БАНКОМАТ", "#1565c0"],
    ["ШИНОМОНТАЖ", "#37474f"], ["ПЕЛЬМЕННАЯ", "#bf360c"], ["СТОЛОВАЯ", "#795548"], ["ДЕТСКИЙ МИР", "#f06292"], ["ЭЛЕКТРОНИКА", "#283593"],
    ["БАР «ИСКРА»", "#ad1457"], ["ПЛОВ", "#e65100"], ["БЛИННАЯ", "#f9a825"], ["ЧАЙХАНА", "#00695c"], ["ТАБАК", "#4e342e"],
    ["КОПИЦЕНТР", "#0288d1"], ["НОТАРИУС", "#5d4037"], ["СТОМАТОЛОГИЯ", "#26a69a"], ["ФИТНЕС", "#6a1b9a"], ["КАЛЬЯННАЯ", "#4527a0"],
    ["ВЕЛОСИПЕДЫ", "#2e7d32"], ["ОДЕЖДА", "#ad1457"], ["ПАРИКМАХЕРСКАЯ", "#c2185b"], ["МЕБЕЛЬ", "#6d4c41"], ["СТРОЙКА", "#f57f17"]];
  var CW = 256, CH = 64, COLS = 4, ROWS = 16;
  var signAtlas = G.tex.canvas(CW * COLS, CH * ROWS, function (x) {
    SHOPS.forEach(function (s, i) {
      if (i >= COLS * ROWS) return;
      var cx = (i % COLS) * CW, cy = Math.floor(i / COLS) * CH;
      x.fillStyle = s[1]; x.fillRect(cx + 2, cy + 2, CW - 4, CH - 4);
      x.strokeStyle = "rgba(255,255,255,.35)"; x.lineWidth = 3; x.strokeRect(cx + 6, cy + 6, CW - 12, CH - 12);
      x.fillStyle = "#fff"; x.textAlign = "center"; x.textBaseline = "middle";
      x.font = "800 " + (s[0].length > 12 ? 24 : 32) + "px system-ui, sans-serif";
      x.shadowColor = "rgba(0,0,0,.4)"; x.shadowBlur = 4;
      x.fillText(s[0], cx + CW / 2, cy + CH / 2 + 2); x.shadowBlur = 0;
    });
  });
  var ST = { p: [], uv: [], n: [], idx: [] };
  function plane(acc, cx, cy, cz, w, h, nx, nz, u0, v0, u1, v1) {
    var tx = -nz, tz = nx, base = acc.p.length / 3;
    var pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
    var uvs = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    for (var i = 0; i < 4; i++) {
      acc.p.push(cx + tx * pts[i][0], cy + pts[i][1], cz + tz * pts[i][0]);
      acc.n.push(nx, 0, nz); acc.uv.push(uvs[i][0], uvs[i][1]);
    }
    acc.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  function accGeo(acc) {
    var g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(acc.p, 3));
    g.setAttribute("normal", new T.Float32BufferAttribute(acc.n, 3));
    g.setAttribute("uv", new T.Float32BufferAttribute(acc.uv, 2));
    g.setIndex(acc.idx); g.computeBoundingSphere();
    return g;
  }
  // вывески над витринами: на лицевой стороне, над лентой первого этажа
  M.buildings.forEach(function (B) {
    if (!B.shop) return;
    var i = (B.seed >> 3) % SHOPS.length, cx = (i % COLS), cy = Math.floor(i / COLS);
    var u0 = cx / COLS, u1 = (cx + 1) / COLS, v1 = 1 - cy / ROWS, v0 = 1 - (cy + 1) / ROWS;
    var f = B.front, w = Math.min(9, (f === "n" || f === "s" ? B.w : B.d) * 0.55), h = w / 4;
    var o = 0.08;
    var sx = f === "e" ? B.x + B.w / 2 + o : f === "w" ? B.x - B.w / 2 - o : B.x - (f === "n" || f === "s" ? B.w * 0.22 : 0);
    var sz = f === "s" ? B.z + B.d / 2 + o : f === "n" ? B.z - B.d / 2 - o : B.z - (f === "e" || f === "w" ? B.d * 0.22 : 0);
    var nx = f === "e" ? 1 : f === "w" ? -1 : 0, nz = f === "s" ? 1 : f === "n" ? -1 : 0;
    plane(ST, sx, 3.85 + h / 2 - 0.3, sz, w, h, nx, nz, u0, v0, u1, v1);
  });
  if (ST.p.length) {
    var sm = new T.Mesh(accGeo(ST), glowMat(signAtlas));
    sm.matrixAutoUpdate = false; add(sm);
  }

  /* ---- рекламные щиты на крышах (вымышленные марки города) (лицом к проспекту) ---------------------------------------------- */
  var ADS = [
    ["Флейм-Банк", "кредит на мечту — без звонков", "#2fbf71", "💰"],
    ["Рилс за 5 минут", "Монтажная Алматы, без очереди", "#e1306c", "🎬"],
    ["Фото на документы", "за минуту, по стандарту", "#2f6fd6", "📇"],
    ["Сайт за вечер", "агент сверстает и выложит", "#7c5cff", "🌐"],
    ["Агент, который помнит всё", "почта, планы, напоминания", "#2fbf71", "🧠"],
    ["Презентация к утру", "агенты «Презентаций» успеют", "#ff9f1c", "📊"],
    ["Радио «Флейм FM»", "хиты, пробки, слухи города", "#ffcf7a", "📻"],
    ["Фотосессия 3×3", "образы из одного селфи", "#ff6fae", "📷"]
  ];
  var adTex = ADS.map(function (a) {
    return G.tex.canvas(1024, 384, function (x, w, h) {
      var g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, a[2]); g.addColorStop(1, G.tex.shade(a[2], -0.55));
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.globalAlpha = 0.12; x.fillStyle = "#fff";
      for (var i = 0; i < 9; i++) { x.beginPath(); x.arc(w * 0.82 + i * 9, h * 0.5, 40 + i * 26, 0, 7); x.fill(); }
      x.globalAlpha = 1;
      x.font = "180px system-ui, Apple Color Emoji, Segoe UI Emoji"; x.textBaseline = "middle"; x.fillText(a[3], 40, h / 2 + 10);
      x.fillStyle = "#fff"; x.font = "800 " + (a[0].length > 18 ? 64 : 84) + "px system-ui, sans-serif"; x.shadowColor = "rgba(0,0,0,.35)"; x.shadowBlur = 10;
      x.fillText(a[0], 270, h * 0.4); x.font = "600 42px system-ui, sans-serif"; x.globalAlpha = 0.92; x.fillText(a[1], 272, h * 0.72);
      x.globalAlpha = 1; x.shadowBlur = 0;
      x.font = "800 30px system-ui"; x.textAlign = "right"; x.fillText("ФЛЕЙМ-СИТИ", w - 30, h - 34);
    });
  });
  var adMats = adTex.map(function (t) { return glowMat(t); });
  var frameMat = G.mat.std(0x2a2d33, 0.5, 0.6);
  var adCount = 0;
  M.buildings.slice().sort(function (a, b) { return FC.hash("ad" + a.id) - FC.hash("ad" + b.id); }).forEach(function (B) {
    if (adCount >= 34 || B.title || B.h < 14 || B.h > 70 || B.w < 18 || B.d < 18) return;
    var road = B.front;
    var nx = road === "e" ? 1 : road === "w" ? -1 : 0, nz = road === "s" ? 1 : road === "n" ? -1 : 0;
    var span = Math.min(16, (nz ? B.w : B.d) * 0.8), y = B.h + 1.2 + span * 0.19, legH = y - B.h;
    var px = B.x + nx * (B.w / 2 - 2), pz = B.z + nz * (B.d / 2 - 2);
    var F = frameOf(px, y, pz, Math.atan2(nx, nz));
    piece(adMats[adCount % adMats.length], PLANE, 0, 0, 0, 0, 0, span, span * 0.375, 1, F);
    piece(frameMat, BOX, 0, 0, -0.2, 0, 0, span + 0.4, span * 0.375 + 0.4, 0.3, F);
    piece(frameMat, BOX, -span * 0.35, -legH / 2 - span * 0.19, -0.3, 0, 0, 0.25, legH, 0.25, F);
    piece(frameMat, BOX, span * 0.35, -legH / 2 - span * 0.19, -0.3, 0, 0, 0.25, legH, 0.25, F);
    adCount++;
  });

  /* ---- здания зон: свои силуэты по виду зоны (data/zones.js) ----------------------------------------------- */
  var ZK = {};
  (global.FC_ZONES || []).forEach(function (z) { ZK[z.key] = z; });
  var glass = new T.MeshStandardMaterial({ color: 0x9fd4ff, roughness: 0.08, metalness: 0.4, transparent: true, opacity: 0.85, envMapIntensity: 1.4 });
  var gold = G.mat.std(0xd9b45a, 0.3, 0.8), white = G.mat.std(0xeeeae2, 0.6, 0.0), dark = G.mat.std(0x2a2d33, 0.5, 0.5);
  function ledMat(hex) {
    var m = new T.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 0.4, roughness: 0.4 });
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uNight = night;
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uNight;")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 0.6 + uNight * 3.0;");
    };
    return m;
  }
  Object.keys(M.zones).forEach(function (key) {
    var B = M.zones[key], z = ZK[key] || {}, kind = z.kind, top = B.h;
    var cx = B.x, cz = B.z, s = Math.min(B.w, B.d);
    if (kind === "diamond") {                                 // Читальня: стеклянный алмаз на подиуме, ночью — светодиоды
      var dm = new T.Mesh(new T.OctahedronGeometry(s * 0.55, 1), glass); dm.position.set(cx, top + s * 0.5, cz); dm.rotation.y = 0.4; add(dm);
      var edges = new T.Mesh(new T.OctahedronGeometry(s * 0.56, 1), new T.MeshBasicMaterial({ color: 0x5bc0eb, wireframe: true, transparent: true, opacity: 0.5 }));
      edges.position.copy(dm.position); edges.rotation.y = 0.4; add(edges); spin.push([edges, "hue", 0.05]);
    } else if (kind === "beacon") {                           // Разведка: маяк-башня с вращающимся лучом
      var tw = new T.Mesh(new T.CylinderGeometry(1.6, 3.2, 46, 12), white); tw.position.set(cx, top + 23, cz); add(tw);
      [0.25, 0.5, 0.75].forEach(function (k) { var band = new T.Mesh(new T.CylinderGeometry(2.4 - k * 0.9, 2.5 - k * 0.9, 3, 12), ledMat(0xff4a4a)); band.position.set(cx, top + 46 * k, cz); add(band); });
      var lamp = new T.Mesh(new T.SphereGeometry(2.2, 12, 8), ledMat(0xfff2c0)); lamp.position.set(cx, top + 48, cz); add(lamp);
      var beam = new T.Mesh(new T.ConeGeometry(9, 90, 16, 1, true), new T.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.12, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, fog: false }));
      beam.geometry.translate(0, -45, 0); beam.rotation.z = Math.PI / 2;
      var pivot = new T.Group(); pivot.position.copy(lamp.position); pivot.add(beam); add(pivot); spin.push([pivot, "y", 0.6]);
      beam.userData.night = true;
    } else if (kind === "wheel") {                            // Просмотровая: колесо обозрения рядом со зданием
      var R = 22, wheel = new T.Group();
      var rim = new T.Mesh(new T.TorusGeometry(R, 0.45, 8, 64), ledMat(0xffd166)); wheel.add(rim);
      for (var k = 0; k < 16; k++) {
        var a = k / 16 * Math.PI * 2, sp = new T.Mesh(new T.BoxGeometry(0.25, R, 0.25), dark);
        sp.position.set(Math.cos(a) * R / 2, Math.sin(a) * R / 2, 0); sp.rotation.z = a - Math.PI / 2; wheel.add(sp);
        var cab = new T.Mesh(new T.BoxGeometry(2.2, 2.2, 2.2), G.mat.std(["#ff5d8f", "#41e0c8", "#ffcf3f", "#7c5cff"][k % 4], 0.5));
        cab.position.set(Math.cos(a) * R, Math.sin(a) * R - 1.6, 0); cab.userData.cabin = true; wheel.add(cab);
      }
      var ox = B.x + (B.doors[0].nz !== 0 ? B.w / 2 + R * 0.4 : 0), oz = B.z + (B.doors[0].nx !== 0 ? B.d / 2 + R * 0.4 : 0);
      if (M.onRoad(ox, oz) || M.buildingAt(ox, oz, 2)) { ox = B.x; oz = B.z; }
      wheel.position.set(ox, Math.max(top, 0) + R + 4, oz); wheel.rotation.y = Math.atan2(B.doors[0].nx, B.doors[0].nz) + Math.PI / 2;
      add(wheel); spin.push([wheel, "wheel", 0.08]);
      [-1, 1].forEach(function (sd) { var leg = new T.Mesh(new T.CylinderGeometry(0.5, 0.8, R + 4 + top, 8), dark); leg.position.set(ox + sd * 3 * Math.cos(wheel.rotation.y), (R + 4 + top) / 2, oz - sd * 3 * Math.sin(wheel.rotation.y)); add(leg); });
    } else if (kind === "stalin") {                           // Архив: ступенчатая высотка со шпилем и звездой
      var tiers = 3, w = B.w * 0.7, d = B.d * 0.7, y = top;
      for (var t = 0; t < tiers; t++) {
        var th = 10 - t * 2, tb = new T.Mesh(new T.BoxGeometry(w, th, d), G.mat.std(0xd8c29a, 0.8)); tb.position.set(cx, y + th / 2, cz); add(tb);
        y += th; w *= 0.68; d *= 0.68;
      }
      var spire = new T.Mesh(new T.ConeGeometry(1.2, 18, 8), gold); spire.position.set(cx, y + 9, cz); add(spire);
      var star = new T.Mesh(new T.OctahedronGeometry(1.4, 0), ledMat(0xff3030)); star.position.set(cx, y + 19, cz); add(star); spin.push([star, "y", 0.8]);
    } else if (kind === "shoot" || kind === "cut" || kind === "reels") {   // киностудия: прожекторы и вывеска «В ЭФИРЕ»
      for (var l = 0; l < 4; l++) {
        var lx = cx + (l % 2 ? 1 : -1) * B.w * 0.35, lz = cz + (l < 2 ? 1 : -1) * B.d * 0.35;
        var pole = new T.Mesh(new T.CylinderGeometry(0.12, 0.12, 4, 6), dark); pole.position.set(lx, top + 2, lz); add(pole);
        var head = new T.Mesh(new T.BoxGeometry(0.9, 0.7, 0.9), ledMat(0xfff4d6)); head.position.set(lx, top + 4.2, lz); add(head);
      }
      var onair = new T.Mesh(new T.BoxGeometry(6, 1.6, 0.4), ledMat(0xff2a2a)); onair.position.set(cx, top + 2, cz); add(onair);
    } else if (kind === "mail" || kind === "gallery" || kind === "chat" || kind === "web" || kind === "notes" || kind === "deck" || kind === "office") {
      // офисы сервисов: светящаяся корона в цветах зоны (без логотипов)
      var crown = new T.Mesh(new T.BoxGeometry(B.w + 0.6, 2.2, B.d + 0.6), ledMat(new T.Color(B.color).getHex()));
      crown.position.set(cx, top - 1.4, cz); add(crown);
    } else if (B.zone) {
      var cap = new T.Mesh(new T.CylinderGeometry(1.5, 1.5, 0.6, 16), ledMat(new T.Color(B.color).getHex())); cap.position.set(cx, top + 0.4, cz); add(cap);
    }
  });

  /* ---- Башня Флейм: корона и огонёк на шпиле, видно с любого конца города --------------------------------- */
  var HQ = M.hq, hqFire = null;
  if (HQ) {
    var ring = new T.Mesh(new T.TorusGeometry(Math.min(HQ.w, HQ.d) * 0.42, 0.6, 8, 48), ledMat(0xff8a3d));
    ring.rotation.x = Math.PI / 2; ring.position.set(HQ.x, HQ.h + 4, HQ.z); add(ring);
    var mast = new T.Mesh(new T.CylinderGeometry(0.6, 1.2, 26, 8), gold); mast.position.set(HQ.x, HQ.h + 13, HQ.z); add(mast);
    var tex = new T.TextureLoader().load(FC.BRAND.logo); tex.colorSpace = T.SRGBColorSpace;
    hqFire = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, fog: false }));
    hqFire.scale.set(22, 22, 1); hqFire.position.set(HQ.x, HQ.h + 36, HQ.z); add(hqFire);
    var halo = new T.Sprite(new T.SpriteMaterial({ map: G.tex.glow, color: 0xff9a3c, transparent: true, opacity: 0.6, blending: T.AdditiveBlending, depthWrite: false, fog: false }));
    halo.scale.set(70, 70, 1); halo.position.copy(hqFire.position); add(halo);
    spin.push([halo, "pulse", 1]);
  }

  /* ---- остановки на проспектах, киоски у перекрёстков ------------------------------------------------------- */
  var stops = [], kiosks = [];
  M.edges.forEach(function (e, i) {
    if (e.bridge) return;
    var a = M.nodes[e.a], b = M.nodes[e.b];
    if (e.kind === "av" && i % 3 === 0) {
      var t = 0.5, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, off = e.w / 2 + 2.2, sd = i % 2 ? 1 : -1;
      var px = e.axis === "z" ? x + sd * off : x, pz = e.axis === "z" ? z : z + sd * off;
      if (!M.buildingAt(px, pz, 1.5) && !M.water(px, pz)) stops.push([px, pz, e.axis === "z" ? (sd > 0 ? Math.PI / 2 : -Math.PI / 2) : (sd > 0 ? 0 : Math.PI)]);
    }
    if (e.kind === "st" && i % 7 === 0) {
      var kx = a.x + (b.x - a.x) * 0.2, kz = a.z + (b.z - a.z) * 0.2, ko = e.w / 2 + 2.6;
      var qx = e.axis === "z" ? kx + ko : kx, qz = e.axis === "z" ? kz : kz + ko;
      if (!M.buildingAt(qx, qz, 1.5) && !M.water(qx, qz)) kiosks.push([qx, qz, i]);
    }
  });
  var glassP = new T.MeshStandardMaterial({ color: 0xbfe3ff, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.35 });
  var wood = G.mat.std(0x8a5a3b, 0.7), stopSign = ledMat(0x2aabee), kioskBody = G.mat.std(0xe8e2d4, 0.7), kioskWin = ledMat(0xfff1c6);
  stops.forEach(function (s, k) {
    var F = frameOf(s[0], 0.15, s[1], s[2]);
    piece(dark, BOX, 0, 2.6, 0, 0, 0, 5, 0.15, 1.8, F);
    piece(glassP, BOX, 0, 1.35, -0.8, 0, 0, 5, 2.3, 0.08, F);
    piece(wood, BOX, 0, 0.6, -0.45, 0, 0, 3.4, 0.12, 0.45, F);
    piece(adMats[k % adMats.length], PLANE, 2.55, 1.3, 0, Math.PI / 2, 0, 1.5, 2.1, 1, F);
    piece(stopSign, BOX, -2.3, 2.95, 0.6, 0, 0, 0.9, 0.9, 0.06, F);
    M.addProp(s[0], s[1], 1.2, "stop");
  });
  var kioskCols = [0x2e7d32, 0xc62828, 0x1565c0, 0xef6c00, 0x6a1b9a].map(function (c) { return G.mat.std(c, 0.6); });
  kiosks.forEach(function (k) {
    var F = frameOf(k[0], 0.15, k[1], 0);
    piece(kioskBody, BOX, 0, 1.2, 0, 0, 0, 2.6, 2.4, 2.2, F);
    piece(kioskCols[k[2] % kioskCols.length], BOX, 0, 2.5, 1.3, 0, 0.25, 3, 0.12, 1, F);
    piece(kioskWin, PLANE, 0, 1.5, 1.11, 0, 0, 1.8, 1, 1, F);
    M.addProp(k[0], k[1], 1.5, "kiosk");
  });
  bakeAll();

  /* ---- скатные крыши частных домов и детские площадки во дворах -------------------------------------------- */
  var roofMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true, side: T.DoubleSide });
  var RP = [], RN = [], RC = [], rc = new T.Color();
  var ROOFC = [0xa0452e, 0x6b3a2a, 0x3f5d4a, 0x7a2f2f, 0x5a4a3a];
  function tri(a, b, c, col) {
    RP.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; RP.splice(RP.length - 6, 6, c[0], c[1], c[2], b[0], b[1], b[2]); }
    for (var i = 0; i < 3; i++) { RN.push(nx / l, ny / l, nz / l); RC.push(col.r, col.g, col.b); }
  }
  M.buildings.forEach(function (B) {
    if (B.style !== "house" || B.title) return;
    rc.setHex(ROOFC[B.seed % ROOFC.length]);
    var x0 = B.x - B.w / 2 - 0.4, x1 = B.x + B.w / 2 + 0.4, z0 = B.z - B.d / 2 - 0.4, z1 = B.z + B.d / 2 + 0.4, y = B.h + 0.1;
    var rh = Math.min(B.w, B.d) * 0.35;
    if (B.w >= B.d) {                     // конёк вдоль x
      var zm = B.z;
      tri([x0, y, z0], [x1, y, z0], [x1, y + rh, zm], rc); tri([x0, y, z0], [x1, y + rh, zm], [x0, y + rh, zm], rc);
      tri([x1, y, z1], [x0, y, z1], [x0, y + rh, zm], rc); tri([x1, y, z1], [x0, y + rh, zm], [x1, y + rh, zm], rc);
      tri([x0, y, z1], [x0, y, z0], [x0, y + rh, zm], rc); tri([x1, y, z0], [x1, y, z1], [x1, y + rh, zm], rc);
    } else {
      var xm = B.x;
      tri([x0, y, z1], [x0, y, z0], [xm, y + rh, z0], rc); tri([x0, y, z1], [xm, y + rh, z0], [xm, y + rh, z1], rc);
      tri([x1, y, z0], [x1, y, z1], [xm, y + rh, z1], rc); tri([x1, y, z0], [xm, y + rh, z1], [xm, y + rh, z0], rc);
      tri([x0, y, z0], [x1, y, z0], [xm, y + rh, z0], rc); tri([x1, y, z1], [x0, y, z1], [xm, y + rh, z1], rc);
    }
  });
  if (RP.length) {
    var rg = new T.BufferGeometry();
    rg.setAttribute("position", new T.Float32BufferAttribute(RP, 3)); rg.setAttribute("normal", new T.Float32BufferAttribute(RN, 3));
    rg.setAttribute("color", new T.Float32BufferAttribute(RC, 3)); rg.computeBoundingSphere();
    var rm = new T.Mesh(rg, roofMat); rm.castShadow = G.Q.shadows; rm.receiveShadow = G.Q.shadows; rm.matrixAutoUpdate = false; add(rm);
  }
  // площадки: в жилых кварталах с пустым двором — качели, горка, песочница, скамейки
  var pipe = G.mat.std(0xd9483b, 0.5, 0.3), slide = G.mat.std(0x2f8fd8, 0.4, 0.2), sandM = G.mat.std(0xe2cf96, 0.95), seat = G.mat.std(0xf2c14e, 0.6);
  M.blocks.forEach(function (b) {
    if (b.kind !== "city" || b.dist.key === "center") return;
    var cx = b.cx, cz = b.cz;
    if (M.buildingAt(cx, cz, 7) || (FC.hash("pg" + b.i) % 3) === 0) return;
    var F = frameOf(cx, 0.18, cz, (b.i % 4) * Math.PI / 2);
    piece(pipe, BOX, -2.2, 1.3, 0, 0, 0, 0.12, 2.6, 0.12, F); piece(pipe, BOX, 2.2, 1.3, 0, 0, 0, 0.12, 2.6, 0.12, F);
    piece(pipe, BOX, 0, 2.6, 0, 0, 0, 4.5, 0.12, 0.12, F);
    piece(seat, BOX, -0.9, 0.6, 0, 0, 0, 0.7, 0.08, 0.35, F); piece(seat, BOX, 0.9, 0.6, 0, 0, 0, 0.7, 0.08, 0.35, F);
    piece(slide, BOX, 0, 0.9, 4, 0, -0.55, 0.8, 0.08, 3.4, F); piece(pipe, BOX, 0, 0.9, 5.6, 0, 0, 0.9, 1.8, 0.9, F);
    piece(sandM, BOX, -4.5, 0.08, 3.5, 0, 0, 3, 0.16, 3, F);
    piece(wood, BOX, 4.5, 0.45, -3, 0, 0, 1.8, 0.1, 0.5, F);
    M.addProp(cx, cz, 3.2, "playground");
  });
  bakeAll();

  /* ---- таблички улиц на перекрёстках: синие, с названием (атлас) ----------------------------------------- */
  var names = [], nameIdx = {};
  M.VROADS.concat(M.HROADS).forEach(function (r) { if (nameIdx[r.name] == null) { nameIdx[r.name] = names.length; names.push(r.name); } });
  var NC = 4, NR = Math.ceil(names.length / NC), NW = 256, NH = 48;
  var nameTex = G.tex.canvas(NW * NC, NH * NR, function (x) {
    names.forEach(function (n, i) {
      var cx = (i % NC) * NW, cy = Math.floor(i / NC) * NH;
      x.fillStyle = "#1f4fa8"; x.fillRect(cx + 1, cy + 1, NW - 2, NH - 2);
      x.strokeStyle = "#fff"; x.lineWidth = 3; x.strokeRect(cx + 5, cy + 5, NW - 10, NH - 10);
      x.fillStyle = "#fff"; x.font = "700 " + (n.length > 16 ? 19 : 24) + "px system-ui"; x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText(n, cx + NW / 2, cy + NH / 2 + 1);
    });
  });
  var NS = { p: [], uv: [], n: [], idx: [] };
  function nameUV(name) { var i = nameIdx[name], cx = i % NC, cy = Math.floor(i / NC); return [cx / NC, 1 - (cy + 1) / NR, (cx + 1) / NC, 1 - cy / NR]; }
  M.nodes.forEach(function (n) {
    if (!n.signal && (n.ix + n.iz) % 3) return;
    var ox = n.vr.w / 2 + 1.2, oz = n.hr.w / 2 + 1.2, x = n.x + ox, z = n.z + oz;
    if (M.water(x, z)) return;
    var uv1 = nameUV(n.hr.name), uv2 = nameUV(n.vr.name);
    // табличка улицы, идущей вдоль x (лицом на юг и север), и вдоль z (лицом на восток и запад)
    plane(NS, x, 4.9, z + 0.05, 2.6, 0.5, 0, 1, uv1[0], uv1[1], uv1[2], uv1[3]);
    plane(NS, x, 4.9, z - 0.05, 2.6, 0.5, 0, -1, uv1[2], uv1[1], uv1[0], uv1[3]);
    plane(NS, x + 0.05, 5.5, z, 2.6, 0.5, 1, 0, uv2[0], uv2[1], uv2[2], uv2[3]);
    plane(NS, x - 0.05, 5.5, z, 2.6, 0.5, -1, 0, uv2[2], uv2[1], uv2[0], uv2[3]);
  });
  if (NS.p.length) { var nm = new T.Mesh(accGeo(NS), glowMat(nameTex, { side: T.DoubleSide })); nm.matrixAutoUpdate = false; add(nm); }

  /* ---- кадр: вращение и пульс --------------------------------------------------------------------------- */
  FC.addSystem({
    name: "deco", order: 41,
    update: function (dt) {
      var t = performance.now() / 1000;
      for (var i = 0; i < spin.length; i++) {
        var o = spin[i][0], kind = spin[i][1], sp = spin[i][2];
        if (kind === "y") o.rotation.y += sp * dt;
        else if (kind === "wheel") {
          o.children.forEach(function (c) { if (c.userData.cabin) c.rotation.z -= sp * dt; });
          o.rotateZ(sp * dt);
        } else if (kind === "pulse") o.material.opacity = 0.45 + Math.sin(t * 2) * 0.12 + G.night * 0.3;
        else if (kind === "hue") o.material.color.setHSL((t * sp) % 1, 0.7, 0.6);
        if (o.children[0] && o.children[0].userData.night) o.children[0].material.opacity = 0.04 + G.night * 0.16;
      }
      if (hqFire) hqFire.position.y = HQ.h + 36 + Math.sin(t * 1.2) * 0.8;
    }
  });
  FC.deco = { ads: ADS };
})(window);
