/* Флейм-Сити — авиация (FC.air): вертолёты (лёгкий «Шмель», полиция, «Флейм ТВ», санавиация) на площадках — крыша
 * Башни Флейм, крыши больниц и участков, площадка у набережной; аэродром на сваях у пляжа с «Кукурузником» и
 * «Искра-Джетом»; парашют; трюки (петля, бочка, бреющий полёт) за деньги; лайнеры и вертолёт новостей в небе;
 * погоня вертолётом патруля за летящим игроком; приложение «Авиа» — вызвать вертолёт.
 *
 * Задача: «чтобы вертолёты были, можно было летать, ещё самолёты разные».
 * Режимы игрока: P.mode = "air" (за штурвалом) и "chute" (под куполом) — fmain двигает игрока только в "foot",
 * поэтому полёт и парашют целиком здесь. Камеру оборачиваем, как fcars: дальше, за хвостом, с наклоном.
 * Крыша — не пол для пешехода: сел на крышу и вышел → верхний этаж этого здания (FC.inside), и наоборот — с верхнего
 * этажа «На крышу — в вертолёт».
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE, M = FC.map, G = FC.gfx;

  /* ---- характеристики ------------------------------------------------------------------------------------ */
  var SPEC = {
    heli_light: { kind: "heli", name: "вертолёт «Шмель»", color: 0xffc21a, accent: 0x1d1f24, vmax: 38, acc: 11, climb: 10, yaw: 1.8, hp: 100, blades: 3, dist: 15 },
    heli_police: { kind: "heli", name: "вертолёт патруля «Щит»", color: 0x1d2b4f, accent: 0xf1f3f6, vmax: 44, acc: 13, climb: 11, yaw: 1.9, hp: 140, blades: 4, police: true, dist: 16 },
    heli_news: { kind: "heli", name: "вертолёт «Флейм ТВ»", color: 0xff5d3d, accent: 0xffffff, vmax: 35, acc: 10, climb: 9, yaw: 1.7, hp: 100, blades: 3, news: true, dist: 15 },
    heli_med: { kind: "heli", name: "санитарный вертолёт", color: 0xf4f6f8, accent: 0xe63946, vmax: 40, acc: 12, climb: 10, yaw: 1.8, hp: 110, blades: 4, med: true, dist: 15 },
    plane_prop: { kind: "plane", name: "«Кукурузник»", color: 0x6bbf59, accent: 0xf4efe0, stall: 17, vrot: 22, vmax: 62, thrust: 6.5, pitch: 1.5, roll: 2.8, steer: 1.1, hp: 100, dist: 17 },
    plane_jet: { kind: "plane", name: "«Искра-Джет»", color: 0xe8ecf2, accent: 0xff6a2a, stall: 32, vrot: 40, vmax: 120, thrust: 13, pitch: 1.15, roll: 3.6, steer: 0.8, hp: 120, dist: 21, jet: true }
  };
  var GRAV = 9.8;

  /* ---- стили: панель полёта, кнопки тача ----------------------------------------------------------------- */
  FC.css([
    "#air-hud{position:fixed;left:50%;top:calc(12px + env(safe-area-inset-top));transform:translateX(-50%);display:none;gap:10px;",
    "  background:rgba(12,16,32,.74);border:1px solid rgba(255,207,122,.3);border-radius:14px;padding:6px 12px;font:700 13px system-ui;",
    "  color:#f6efe2;z-index:6;pointer-events:none;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);white-space:nowrap}",
    "#air-hud.on{display:flex}#air-hud b{color:#ffcf7a}#air-hud i{font-style:normal;color:rgba(255,255,255,.55);font-weight:600}",
    "#air-hud .warn{color:#ff6b7a;animation:airw .5s steps(2) infinite}@keyframes airw{50%{opacity:.3}}",
    ".air-app .pad{display:flex;justify-content:space-between;align-items:center;gap:8px}"
  ].join("\n"));
  var hudEl = document.createElement("div"); hudEl.id = "air-hud"; document.body.appendChild(hudEl);

  /* ---- материалы ----------------------------------------------------------------------------------------- */
  var glassM = new T.MeshStandardMaterial({ color: 0x1c2a3a, roughness: 0.06, metalness: 0.6, envMapIntensity: 1.5 });
  var lampM = {}, lampT = 0, lampK = 1;
  function lamp(hex) { return lampM[hex] || (lampM[hex] = new T.MeshBasicMaterial({ color: hex, toneMapped: false })); }
  function std(hex, r, m) { return G.mat.std(hex, r == null ? 0.5 : r, m || 0); }
  function textTex(text, bg, fg, w, h) {
    return G.tex.canvas(w || 512, h || 128, function (x, W, H) {
      x.fillStyle = bg; x.fillRect(0, 0, W, H);
      x.fillStyle = fg; x.font = "800 " + Math.round(H * 0.56) + "px system-ui, sans-serif";
      x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(text, W / 2, H / 2 + 2);
    });
  }

  /* ---- сборка модели: статичные части сливаются по материалу (мало вызовов отрисовки) ------------------------- */
  function Kit() {
    var parts = new Map(), o = new T.Object3D();
    return {
      add: function (mat, geo, x, y, z, rx, ry, rz) {
        o.position.set(x || 0, y || 0, z || 0); o.rotation.set(rx || 0, ry || 0, rz || 0); o.scale.set(1, 1, 1); o.updateMatrix();
        var g = geo.index ? geo.toNonIndexed() : geo.clone();
        g.applyMatrix4(o.matrix);
        if (!g.attributes.uv) g.setAttribute("uv", new T.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        if (!parts.has(mat)) parts.set(mat, []);
        parts.get(mat).push(g);
      },
      into: function (group, shadow) {
        parts.forEach(function (list, mat) {
          var m = new T.Mesh(T.mergeGeometries(list), mat);
          m.castShadow = !!shadow && G.Q.shadows;
          group.add(m);
          list.forEach(function (g) { g.dispose(); });
        });
      }
    };
  }
  var BOX = new T.BoxGeometry(1, 1, 1);
  function box(k, mat, sx, sy, sz, x, y, z, rx, ry, rz) {
    var g = BOX.clone().scale(sx, sy, sz); k.add(mat, g, x, y, z, rx, ry, rz); g.dispose();
  }

  function buildHeli(sp) {
    var g = new T.Group(); g.rotation.order = "YXZ";
    var k = Kit(), cM = std(sp.color, 0.38, 0.35), aM = std(sp.accent, 0.5, 0.2), dM = std(0x22252b, 0.6, 0.45);
    k.add(cM, new T.SphereGeometry(1.55, 16, 12).scale(1, 0.85, 1.6), 0, 1.55, 0);
    k.add(aM, new T.SphereGeometry(1.57, 16, 12, 0, Math.PI * 2, 1.85, 0.55).scale(1, 0.85, 1.6), 0, 1.55, 0);
    k.add(glassM, new T.SphereGeometry(1.25, 14, 10, -1.2, 2.4, 0.35, 1.2).scale(1, 0.82, 1.25), 0, 1.65, 0.95);
    k.add(cM, new T.CylinderGeometry(0.2, 0.4, 4.6, 8).rotateX(Math.PI / 2), 0, 1.85, -3.7);
    box(k, cM, 0.12, 1.4, 1.0, 0, 2.5, -5.9);
    box(k, aM, 2.0, 0.08, 0.55, 0, 1.95, -5.4);
    [-1, 1].forEach(function (s) {
      box(k, dM, 0.12, 0.12, 3.5, s * 0.95, 0.06, 0.15);
      box(k, dM, 0.08, 0.62, 0.08, s * 0.92, 0.36, 0.95); box(k, dM, 0.08, 0.62, 0.08, s * 0.92, 0.36, -0.75);
    });
    k.add(dM, new T.CylinderGeometry(0.22, 0.3, 0.5, 8), 0, 2.6, 0);
    if (sp.police) { box(k, lamp(0xff2a2a), 0.5, 0.14, 0.2, 0.32, 2.42, 0.2); box(k, lamp(0x2a6bff), 0.5, 0.14, 0.2, -0.32, 2.42, 0.2); }
    if (sp.news) k.add(dM, new T.SphereGeometry(0.32, 10, 8), 0, 0.55, 1.9);
    k.into(g, true);
    // надписи по бортам
    if (sp.news || sp.police || sp.med) {
      var tt = sp.news ? textTex("ФЛЕЙМ ТВ", "#ff5d3d", "#ffffff") : sp.police ? textTex("ПАТРУЛЬ", "#1d2b4f", "#ffffff") : textTex("✚ 103", "#ffffff", "#e63946");
      var lm = new T.MeshStandardMaterial({ map: tt, roughness: 0.5 });
      [-1, 1].forEach(function (s) {
        var pl = new T.Mesh(new T.PlaneGeometry(2.1, 0.52), lm);
        pl.position.set(s * 1.58, 1.45, -0.1); pl.rotation.y = s * Math.PI / 2; g.add(pl);
      });
    }
    // несущий винт: лопасти + «диск размытия» на оборотах
    var rotor = new T.Group(); rotor.position.set(0, 2.88, 0);
    var n = sp.blades || 3, bm = std(0x1b1d22, 0.6, 0.4);
    for (var i = 0; i < n; i++) {
      var bl = new T.Mesh(new T.BoxGeometry(5.3, 0.05, 0.3).translate(2.65, 0, 0), bm);
      bl.rotation.y = i / n * Math.PI * 2; rotor.add(bl);
    }
    var disc = new T.Mesh(new T.CircleGeometry(5.4, 32).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: 0x9aa4b0, transparent: true, opacity: 0, depthWrite: false }));
    rotor.add(disc); g.add(rotor);
    var tail = new T.Group(); tail.position.set(0.24, 2.4, -5.95);
    var tb = new T.Mesh(new T.BoxGeometry(0.05, 1.4, 0.16), bm); tail.add(tb);
    var tb2 = tb.clone(); tb2.rotation.x = Math.PI / 2; tail.add(tb2); g.add(tail);
    // огни: левый красный (+X — борт слева от пилота), правый зелёный, проблесковый на хвосте
    var nl = new T.Mesh(new T.SphereGeometry(0.11, 6, 4), lamp(0xff2020)); nl.position.set(1.0, 0.25, 0.4); g.add(nl);
    var nr = new T.Mesh(new T.SphereGeometry(0.11, 6, 4), lamp(0x20ff60)); nr.position.set(-1.0, 0.25, 0.4); g.add(nr);
    var beacon = new T.Mesh(new T.SphereGeometry(0.14, 6, 4), lamp(0xffffff)); beacon.position.set(0, 3.25, -5.9); g.add(beacon);
    return { g: g, rotor: rotor, tail: tail, disc: disc, beacon: beacon };
  }

  function buildPlane(sp) {
    var g = new T.Group();
    var k = Kit(), cM = std(sp.color, 0.35, 0.3), aM = std(sp.accent, 0.5, 0.15), dM = std(0x24272d, 0.55, 0.5);
    var prop = null, flame = null;
    if (!sp.jet) {          // «Кукурузник»: биплан
      k.add(cM, new T.CylinderGeometry(0.62, 0.42, 6.6, 12).rotateX(Math.PI / 2), 0, 1.75, 0);
      k.add(dM, new T.CylinderGeometry(0.7, 0.66, 1.0, 12).rotateX(Math.PI / 2), 0, 1.75, 3.4);
      box(k, aM, 10.5, 0.12, 1.55, 0, 2.95, 0.9); box(k, aM, 9.6, 0.12, 1.45, 0, 1.15, 0.9);
      box(k, lamp(0xe63946), 10.52, 0.13, 0.25, 0, 2.95, 1.6);
      [-1, 1].forEach(function (s) {
        box(k, dM, 0.08, 1.8, 0.08, s * 3.6, 2.05, 0.6); box(k, dM, 0.08, 1.8, 0.08, s * 3.6, 2.05, 1.3);
        k.add(dM, new T.CylinderGeometry(0.42, 0.42, 0.22, 12).rotateZ(Math.PI / 2), s * 1.15, 0.42, 1.4);
        box(k, dM, 0.08, 1.0, 0.08, s * 0.9, 0.85, 1.4, 0, 0, s * 0.35);
      });
      box(k, cM, 0.1, 1.4, 1.1, 0, 2.45, -3.0); box(k, aM, 3.4, 0.08, 0.9, 0, 1.85, -2.95);
      k.add(dM, new T.CylinderGeometry(0.16, 0.16, 0.12, 8).rotateZ(Math.PI / 2), 0, 0.16, -3.0);
      box(k, dM, 0.85, 0.35, 1.0, 0, 2.38, -0.4);
      k.add(glassM, new T.PlaneGeometry(0.9, 0.45), 0, 2.65, 0.15, -0.5);
      prop = new T.Group(); prop.position.set(0, 1.75, 3.95);
      var bm = std(0x3a2b1e, 0.6, 0.1);
      prop.add(new T.Mesh(new T.BoxGeometry(0.16, 2.7, 0.07), bm));
      prop.add(new T.Mesh(new T.ConeGeometry(0.22, 0.45, 10).rotateX(Math.PI / 2), dM));
      var pdisc = new T.Mesh(new T.CircleGeometry(1.35, 24), new T.MeshBasicMaterial({ color: 0x8a7a66, transparent: true, opacity: 0, depthWrite: false, side: T.DoubleSide }));
      prop.add(pdisc); prop.userData.disc = pdisc;
    } else {                // «Искра-Джет»: стреловидное крыло, два киля, форсаж
      k.add(cM, new T.CylinderGeometry(0.62, 0.82, 9, 14).rotateX(Math.PI / 2), 0, 1.6, -0.3);
      k.add(cM, new T.ConeGeometry(0.62, 2.4, 14).rotateX(Math.PI / 2), 0, 1.6, 5.35);
      k.add(glassM, new T.SphereGeometry(0.55, 12, 8).scale(1, 0.75, 2.4), 0, 2.15, 2.4);
      [-1, 1].forEach(function (s) {
        box(k, cM, 3.6, 0.14, 2.6, s * 2.3, 1.45, -0.9, 0, s * -0.45, 0);
        box(k, aM, 3.6, 0.15, 0.35, s * 2.55, 1.46, -1.95, 0, s * -0.45, 0);
        box(k, cM, 0.1, 1.5, 1.5, s * 0.55, 2.4, -3.7, 0, 0, s * 0.28);
        box(k, cM, 2.2, 0.08, 1.0, s * 1.3, 1.6, -3.9, 0, s * -0.35, 0);
        k.add(dM, new T.CylinderGeometry(0.2, 0.2, 0.18, 10).rotateZ(Math.PI / 2), s * 1.1, 0.2, -0.6);
        box(k, dM, 0.08, 1.1, 0.08, s * 1.1, 0.75, -0.6);
      });
      k.add(dM, new T.CylinderGeometry(0.17, 0.17, 0.15, 10).rotateZ(Math.PI / 2), 0, 0.2, 3.2);
      box(k, dM, 0.08, 1.1, 0.08, 0, 0.75, 3.2);
      k.add(dM, new T.CylinderGeometry(0.66, 0.58, 0.7, 14).rotateX(Math.PI / 2), 0, 1.6, -5.05);
      k.add(lamp(0xff8a3d), new T.CircleGeometry(0.5, 14).rotateY(Math.PI), 0, 1.6, -5.42);
      flame = new T.Mesh(new T.ConeGeometry(0.5, 4, 12, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -2), new T.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.7, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false }));
      flame.position.set(0, 1.6, -5.4);
    }
    k.into(g, true);
    if (prop) g.add(prop);
    if (flame) g.add(flame);
    var nl = new T.Mesh(new T.SphereGeometry(0.12, 6, 4), lamp(0xff2020)); nl.position.set(sp.jet ? 4.2 : 5.2, sp.jet ? 1.45 : 2.95, sp.jet ? -2.2 : 0.9); g.add(nl);
    var nr = new T.Mesh(new T.SphereGeometry(0.12, 6, 4), lamp(0x20ff60)); nr.position.set(sp.jet ? -4.2 : -5.2, nl.position.y, nl.position.z); g.add(nr);
    return { g: g, prop: prop, flame: flame };
  }

  /* ---- земля под точкой: крыша, палуба аэродрома, вода или асфальт -------------------------------------------- */
  // Флейм-Сити — палуба на сваях за пляжем; Минск 1:1 — та же палуба на месте аэропорта Минск-1 (FC.map.airfield)
  var AF = M.airfield, OX = AF ? AF.x0 + 80 : 0, OZ = AF ? AF.z0 - 4 - M.SEA_LINE : 0;
  var DECK = { x0: -80 + OX, x1: 1110 + OX, z0: M.SEA_LINE + 4 + OZ, z1: M.SEA_LINE + 84 + OZ, y: 0.45 };
  var RWY = { x0: -60 + OX, x1: 1000 + OX, z: DECK.z0 + 58, w: 34 };    // полоса вдоль x
  var APRON = { x0: 830 + OX, x1: 1100 + OX, z0: DECK.z0 + 2, z1: DECK.z0 + 36 };
  var BOARD = { x: 935 + OX, z: M.SEA_LINE - 5 + OZ };                  // точка посадки с пляжа
  var LIM = M.minsk && M.mapBounds ? M.mapBounds.slice() : [-2700, -2700, 2700, 2700];
  function onDeck(x, z) { return x > DECK.x0 && x < DECK.x1 && z > DECK.z0 && z < DECK.z1; }
  function ground(x, z) {
    var B = M.buildingAt(x, z, 0);
    if (B) return { h: B.h, B: B };
    if (onDeck(x, z)) return { h: DECK.y, deck: true };
    if (M.water(x, z) && !M.onRoad(x, z)) return { h: -1.0, water: true };
    return { h: M.onRoad(x, z) ? 0.04 : 0.17 };
  }

  /* ---- воздушные суда ------------------------------------------------------------------------------------ */
  var list = [], seq = 0;
  var root = new T.Group(); root.name = "air"; G.add(root);
  function spawn(type, x, z, yaw, opt) {
    var sp = SPEC[type]; if (!sp) return null;
    opt = opt || {};
    var vis = sp.kind === "heli" ? buildHeli(sp) : buildPlane(sp);
    var gh = opt.y != null ? opt.y : ground(x, z).h;
    var A = { id: "air" + (seq++), type: type, spec: sp, kind: sp.kind, vis: vis, g: vis.g, x: x, y: gh, z: z, vx: 0, vy: 0, vz: 0,
      yaw: yaw || 0, pitch: 0, roll: 0, rotor: 0, rpm: 0, throttle: 0, speed: 0, hp: sp.hp, onGround: true, pad: opt.pad || null,
      ai: !!opt.ai, player: false, wrecked: false, idle: 0, sink: 0, q: new T.Quaternion(), smokeT: 0, washT: 0,
      loopAcc: 0, rollAcc: 0, lowT: 0, lowCd: 0, landed: false, home: opt.home || null };
    A.q.setFromEuler(new T.Euler(0, A.yaw, 0, "YXZ"));
    place(A);
    root.add(A.g);
    list.push(A);
    return A;
  }
  function remove(A) {
    var i = list.indexOf(A); if (i >= 0) list.splice(i, 1);
    root.remove(A.g);
    A.g.traverse(function (o) { if (o.geometry && o.geometry !== BOX) o.geometry.dispose(); });
    if (A.pad && A.pad.heli === A) A.pad.heli = null;
  }
  function place(A) {
    A.g.position.set(A.x, A.y, A.z);
    if (A.kind === "plane") A.g.quaternion.copy(A.q);
    else A.g.rotation.set(A.pitch, A.yaw, A.roll);
  }

  /* ---- площадки ------------------------------------------------------------------------------------------ */
  var pads = [];
  var padTex = G.tex.canvas(256, 256, function (x, W) {
    x.fillStyle = "#2b2e34"; x.beginPath(); x.arc(W / 2, W / 2, W / 2 - 2, 0, 7); x.fill();
    x.strokeStyle = "#ffcf3f"; x.lineWidth = 14; x.beginPath(); x.arc(W / 2, W / 2, W / 2 - 22, 0, 7); x.stroke();
    x.fillStyle = "#ffffff"; x.font = "900 130px system-ui"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("H", W / 2, W / 2 + 6);
  });
  var padMat = new T.MeshStandardMaterial({ map: padTex, roughness: 0.8, transparent: true, alphaTest: 0.1 });
  function addPad(x, z, y, B, type, name) {
    var m = new T.Mesh(new T.CircleGeometry(5, 32).rotateX(-Math.PI / 2), padMat);
    m.position.set(x, y + 0.08, z); m.receiveShadow = G.Q.shadows; root.add(m);
    for (var i = 0; i < 4; i++) {
      var l = new T.Mesh(new T.SphereGeometry(0.14, 6, 4), lamp(0x5fd0ff));
      l.position.set(x + Math.cos(i * Math.PI / 2 + 0.78) * 5.2, y + 0.15, z + Math.sin(i * Math.PI / 2 + 0.78) * 5.2); root.add(l);
    }
    var p = { x: x, z: z, y: y, B: B || null, type: type, name: name, heli: null, emptyT: 0 };
    pads.push(p);
    return p;
  }
  function stockPad(p) {
    if (p.heli) return;
    var yaw = p.B ? Math.atan2(p.B.doors[0].nx, p.B.doors[0].nz) : 0;
    p.heli = spawn(p.type, p.x, p.z, yaw, { pad: p, y: p.y });
  }
  // Минск: вертолётные площадки у ориентиров (задача: «в Минске вертолёты, чтобы летать»). Место ищем,
  // когда игрок в 700 м: тогда куски с домами вокруг загружены и площадка не встанет в дом
  var MINSK_PADS = M.minsk ? [["Нацбиблиотека", 4337, -3447, "heli_light"], ["Маяк Минска", 4795, -3389, "heli_news"],
    ["Минск-Мир", -2372, 3865, "heli_light"], ["Минск-Арена", -6453, -3985, "heli_light"], ["Немига", -2126, -164, "heli_news"],
    ["Парк Победы", -2855, -2547, "heli_light"], ["Чижовка-Арена", 3201, 6142, "heli_light"], ["Уручье", 7078, -5016, "heli_med"],
    ["Пл. Победы", -322, -958, "heli_news"], ["Ворота Минска", -1867, 889, "heli_light"]] : [];
  var padT = 0;
  function minskPads(P) {
    padT -= 1; if (padT > 0) return; padT = 60;                       // раз в ~секунду (60 кадров)
    for (var i = 0; i < MINSK_PADS.length; i++) {
      var d = MINSK_PADS[i]; if (!d || d.done) continue;
      if (Math.hypot(P.x - d[1], P.z - d[2]) > 700) continue;
      d.done = true;
      var spot = null;
      for (var r = 0; r < 160 && !spot; r += 8) {
        for (var a = 0; a < (r ? 16 : 1) && !spot; a++) {
          var x = d[1] + Math.cos(a * 0.3927) * r, z = d[2] + Math.sin(a * 0.3927) * r;
          if (M.onRoad(x, z) || M.buildingAt(x, z, 7) || M.water(x, z) || propNear(x, z, 4.5)) continue;
          spot = { x: x, z: z };
        }
      }
      if (spot) stockPad(addPad(spot.x, spot.z, 0.17, null, d[3], "Вертолётная: " + d[0]));
    }
  }
  (function makePads() {
    var H = M.hq;
    if (H) {
      var x0 = H.x - H.w / 2, x1 = H.x + H.w / 2, z0 = H.z - H.d / 2, z1 = H.z + H.d / 2;
      if (H.style === "glass" && H.h > 90 && H.w > 22 && H.d > 22) { x0 += 6; x1 -= 6; z0 += 6; z1 -= 6; }
      var px = x1 - Math.min(6.5, (x1 - x0) / 2 - 0.5), pz = z1 - Math.min(6.5, (z1 - z0) / 2 - 0.5);
      addPad(px, pz, H.h, H, "heli_light", "Крыша Башни Флейм");
    }
    var hosp = M.pois.filter(function (B) { return B.poi === "hospital"; }).slice(0, 2);
    hosp.forEach(function (B) { addPad(B.x, B.z, B.h, B, "heli_med", "Крыша: " + B.name); });
    var pol = M.pois.filter(function (B) { return B.poi === "police"; }).slice(0, 2);
    pol.forEach(function (B) { addPad(B.x, B.z, B.h, B, "heli_police", "Крыша участка"); });
    // площадка у набережной: в стороне от воды, дорог и домов
    var R = M.RIVER, done = false;
    function clear(x, z) {
      if (Math.abs(x) > M.HALF - 20 || Math.abs(z) > M.HALF - 20) return false;
      if (M.onRoad(x, z) || M.buildingAt(x, z, 6) || M.field(x, z) < 6) return false;
      return !propNear(x, z, 4.5);
    }
    for (var i = 2; i < R.length - 2 && !done; i++) {
      var ax = R[i][0], az = R[i][1], bx = R[i + 1][0], bz = R[i + 1][1], l = Math.hypot(bx - ax, bz - az) || 1;
      for (var t = 0.2; t < 0.9 && !done; t += 0.15) {
        for (var s = -1; s <= 1 && !done; s += 2) {
          for (var off = M.RIVER_W / 2 + 9; off < M.RIVER_W / 2 + 70 && !done; off += 3) {
            var x = ax + (bx - ax) * t - (bz - az) / l * off * s, z = az + (bz - az) * t + (bx - ax) / l * off * s;
            if (!clear(x, z)) continue;
            addPad(x, z, 0.17, null, "heli_news", "Вертолётная у набережной"); done = true;
          }
        }
      }
    }
  })();

  /* ---- аэродром на сваях у пляжа ------------------------------------------------------------------------- */
  var planes = [], sockRef = null;
  (function makeAirfield() {
    var k = Kit(), conc = std(0x8d8f93, 0.9), pile = std(0x5c5a56, 0.85), white = std(0xf2f2ee, 0.6), dark = std(0x2a2d33, 0.6, 0.3);
    box(k, conc, DECK.x1 - DECK.x0, 0.5, DECK.z1 - DECK.z0, (DECK.x0 + DECK.x1) / 2, DECK.y - 0.25, (DECK.z0 + DECK.z1) / 2);
    for (var px = DECK.x0 + 10; px < DECK.x1; px += 40) {
      [DECK.z0 + 3, DECK.z1 - 3, (DECK.z0 + DECK.z1) / 2].forEach(function (pz) { box(k, pile, 1.2, 4, 1.2, px, -1.8, pz); });
    }
    // мостик с пляжа
    box(k, std(0x9a7b55, 0.85), 8, 0.3, DECK.z0 - BOARD.z + 2, BOARD.x, 0.35, (DECK.z0 + BOARD.z) / 2);
    // ангар, вышка, ветроуказатель
    box(k, std(0xb9c0c8, 0.6, 0.4), 34, 12, 28, 1072 + OX, DECK.y + 6, APRON.z0 + 16);
    box(k, dark, 0.3, 9, 22, 1054.9 + OX, DECK.y + 4.5, APRON.z0 + 16);
    box(k, std(0xa3aab2, 0.5, 0.5), 36, 0.8, 30, 1072 + OX, DECK.y + 12.4, APRON.z0 + 16);
    box(k, white, 6, 13, 6, 850 + OX, DECK.y + 6.5, APRON.z0 + 6);
    box(k, glassM, 7.5, 3.2, 7.5, 850 + OX, DECK.y + 14.6, APRON.z0 + 6);
    box(k, dark, 8.2, 0.5, 8.2, 850 + OX, DECK.y + 16.4, APRON.z0 + 6);
    box(k, dark, 0.2, 5, 0.2, 850 + OX, DECK.y + 19, APRON.z0 + 6);
    box(k, dark, 0.18, 7, 0.18, 820 + OX, DECK.y + 3.5, APRON.z1 - 2);
    k.into(root, true);
    // полоса: разметка холстом на всю длину
    var L = RWY.x1 - RWY.x0;
    var rt = G.tex.canvas(4096, 132, function (x, W, Hh) {
      x.fillStyle = "#33363b"; x.fillRect(0, 0, W, Hh);
      for (var i = 0; i < 900; i++) { x.fillStyle = "rgba(255,255,255," + (Math.random() * 0.04) + ")"; x.fillRect(Math.random() * W, Math.random() * Hh, 6, 2); }
      x.fillStyle = "#f2f2ee";
      x.fillRect(0, 4, W, 3); x.fillRect(0, Hh - 7, W, 3);
      for (var c = 120; c < W - 120; c += 60) x.fillRect(c, Hh / 2 - 2, 34, 4);
      [8, W - 70].forEach(function (s) { for (var j = 0; j < 8; j++) x.fillRect(s, 14 + j * 13, 60, 7); });
      x.font = "900 54px system-ui"; x.textBaseline = "middle";
      x.save(); x.translate(110, Hh / 2); x.rotate(Math.PI / 2); x.textAlign = "center"; x.fillText("09", 0, 0); x.restore();
      x.save(); x.translate(W - 110, Hh / 2); x.rotate(-Math.PI / 2); x.textAlign = "center"; x.fillText("27", 0, 0); x.restore();
    });
    var rwy = new T.Mesh(new T.PlaneGeometry(L, RWY.w).rotateX(-Math.PI / 2), new T.MeshStandardMaterial({ map: rt, roughness: 0.9 }));
    rwy.position.set((RWY.x0 + RWY.x1) / 2, DECK.y + 0.02, RWY.z); rwy.receiveShadow = G.Q.shadows; root.add(rwy);
    var ap = new T.Mesh(new T.PlaneGeometry(APRON.x1 - APRON.x0, APRON.z1 - APRON.z0).rotateX(-Math.PI / 2), std(0x55585e, 0.9));
    ap.position.set((APRON.x0 + APRON.x1) / 2, DECK.y + 0.015, (APRON.z0 + APRON.z1) / 2); ap.receiveShadow = G.Q.shadows; root.add(ap);
    // огни по краям полосы
    var pts = [];
    for (var lx = RWY.x0; lx <= RWY.x1; lx += 30) { pts.push([lx, RWY.z - RWY.w / 2 - 0.6]); pts.push([lx, RWY.z + RWY.w / 2 + 0.6]); }
    var lights = new T.InstancedMesh(new T.SphereGeometry(0.22, 6, 4), lamp(0xcfe6ff), pts.length);
    var o = new T.Object3D();
    pts.forEach(function (p, i) { o.position.set(p[0], DECK.y + 0.2, p[1]); o.updateMatrix(); lights.setMatrixAt(i, o.matrix); });
    root.add(lights);
    // ветроуказатель — полосатый конус
    var sock = new T.Group(); sock.position.set(820 + OX, DECK.y + 6.6, APRON.z1 - 2);
    var c1 = new T.Mesh(new T.CylinderGeometry(0.55, 0.42, 1.4, 10, 1, true).rotateZ(Math.PI / 2).translate(0.8, 0, 0), new T.MeshStandardMaterial({ color: 0xff6a2a, side: T.DoubleSide }));
    var c2 = new T.Mesh(new T.CylinderGeometry(0.42, 0.28, 1.4, 10, 1, true).rotateZ(Math.PI / 2).translate(2.2, 0, 0), new T.MeshStandardMaterial({ color: 0xffffff, side: T.DoubleSide }));
    sock.add(c1, c2); root.add(sock); sockRef = sock;
    // вывеска на пляже
    var st = textTex(AF ? "✈ АЭРОДРОМ «МИНСК-1»" : "✈ АЭРОДРОМ «ФЛЕЙМ»", "#1f4fa8", "#ffffff", 1024, 160);
    var sign = new T.Mesh(new T.PlaneGeometry(9, 1.4), new T.MeshStandardMaterial({ map: st, roughness: 0.6, side: T.DoubleSide }));
    sign.position.set(BOARD.x + 7, 3.4, BOARD.z - 2); root.add(sign);
    var post = new T.Mesh(new T.BoxGeometry(0.2, 3, 0.2), dark); post.position.set(BOARD.x + 7, 1.5, BOARD.z - 2); root.add(post);
  })();
  function stockPlanes() {
    [["plane_prop", 900 + OX], ["plane_jet", 975 + OX], ["plane_jet", 1045 + OX]].forEach(function (p) {
      var have = planes.filter(function (A) { return A.type === p[0] && A.home && A.home.x === p[1] && list.indexOf(A) >= 0; })[0];
      if (have) return;
      planes.push(spawn(p[0], p[1], APRON.z0 + 18, -Math.PI / 2, { home: { x: p[1], z: APRON.z0 + 18 } }));
    });
  }

  /* ---- посадка, выход, парашют --------------------------------------------------------------------------- */
  var cur = null, touchLabels = null, chute = null;
  function setButtons(on) {
    var I = FC.input; if (!I.setButton) return;
    if (on) {
      touchLabels = true;
      I.setButton("jump", { label: cur && cur.kind === "plane" ? "⏫" : "⬆" });
      I.setButton("punch", { label: cur && cur.kind === "plane" ? "⏬" : "⬇" });
      I.setButton("car", { label: "🪂" });
    } else if (touchLabels) {
      touchLabels = null;
      I.setButton("jump", { label: "⤒" }); I.setButton("punch", { label: "👊" }); I.setButton("car", { label: "🚗" });
    }
  }
  function enter(A) {
    var P = FC.player; if (!P || A.wrecked || cur) return;
    if (P.mode === "car" && FC.cars) FC.cars.exit(true);
    cur = A; A.player = true; A.ai = false; A.idle = 0;
    if (A.pad && A.pad.heli === A) A.pad.heli = null;          // площадка освободилась — потом пополнится
    P.mode = "air"; P.air = A; P.vx = P.vz = 0;
    sync(A);
    setButtons(true);
    if (FC.audio) FC.audio.play("door");
    if (A.spec.police && FC.police && FC.police.add) {
      FC.police.add(2);
      if (FC.hud) FC.hud.toast("Угон вертолёта патруля! +2★", "bad", 3);
    } else if (!A.mine && !A.stolen && FC.police && FC.police.add) {
      // чужой борт со стоянки или площадки — угон (свой вызванный из «Авиа» — нет): +1★ и строка в ленте
      A.stolen = true; FC.police.add(1);
      var what = A.kind === "plane" ? "самолёт " + A.spec.name : A.spec.name;
      if (FC.hud) FC.hud.toast("✈️ Угон: " + what + "! +1★", "bad", 3);
      FC.emit("crime", { type: "aircraft_theft", x: A.x, z: A.z });
      FC.emit("air:stolen", { type: A.type, kind: A.kind, name: A.spec.name });
      if (FC.story && FC.story.post) FC.story.post({ id: "air" + Date.now(), kind: "crime", cell: FC.people.SPECIAL.cop, who: "Новости " + (FC.cityOf || ""),
        text: "✈️ Неизвестный угнал " + what + " — патруль поднимает вертолёт" });
    }
    var hint = A.kind === "heli" ?
      (FC.input.touch ? "Джойстик — лететь и разворот, ⬆/⬇ — высота, 🪂 — выйти или прыгнуть с парашютом." :
        "<b>W/S</b> — вперёд/назад, <b>A/D</b> — разворот, <b>Пробел</b> — вверх, <b>Shift</b> — вниз, <b>F</b> — выйти или парашют.") :
      (FC.input.touch ? "Джойстик — нос вверх/вниз и крен, ⏫/⏬ — газ. Разгонись по полосе и потяни вверх." :
        "<b>W/S</b> — нос вверх/вниз, <b>A/D</b> — крен, <b>Пробел/Shift</b> — газ, на земле <b>A/D</b> рулят. Разгон по полосе — и тяни <b>W</b>.");
    if (FC.hud) { FC.hud.help(hint, 9); FC.hud.toast("✈ " + A.spec.name, "", 2); }
    FC.emit("air:enter", { air: A });
  }
  function sync(A) {
    var P = FC.player;
    P.x = A.x; P.z = A.z; P.y = A.y + (A.kind === "heli" ? 1.0 : 1.2);
    var fx = A.kind === "plane" ? fwdOf(A) : null;
    P.heading = A.kind === "plane" ? Math.atan2(fx.x, fx.z) : A.yaw;
    P.vx = A.vx; P.vz = A.vz;
  }
  function leave(A, toX, toZ) {
    var P = FC.player;
    A.player = false; cur = null; A.idle = 0;
    P.mode = "foot"; P.air = null;
    setButtons(false);
    if (FC.audio && FC.audio.loop) { FC.audio.loop("engine", false); FC.audio.loop("heli", false); }
    if (toX != null) P.teleport(toX, toZ);
    FC.emit("air:exit", { air: A });
  }
  /* Выход: на земле — рядом; на крыше — на верхний этаж этого здания; в воздухе высоко — парашют. */
  function exitCur(force) {
    var A = cur; if (!A) return;
    var gr = ground(A.x, A.z), agl = A.y - gr.h, P = FC.player;
    var slow = Math.hypot(A.vx, A.vz) < 3 && (A.kind === "heli" || A.speed < 4);
    if (!force && !(A.onGround && slow)) {
      if (agl > 18) { bail(A); return; }
      if (FC.hud) FC.hud.toast(A.kind === "heli" ? "Сначала сядь — или поднимись выше для прыжка с парашютом" : "Сначала остановись на земле", "", 2.5);
      return;
    }
    if (gr.B && agl < 3) { roofExit(A, gr.B); return; }
    if (gr.deck || onDeck(A.x, A.z)) { leave(A, BOARD.x, BOARD.z); return; }
    var side = A.kind === "plane" ? fwdOf(A) : { x: Math.sin(A.yaw), z: Math.cos(A.yaw) };
    var ex = A.x + side.z * 3.5, ez = A.z - side.x * 3.5;
    var c = M.collide(ex, ez, 0.4);
    leave(A, c.x, c.z);
    P.y = 0.2;
  }
  /* С крыши — на верхний этаж: ждём, пока интерьер откроется (событие inside:enter), и едем лифтом наверх. */
  function goTop(B) {
    var top = Math.max(0, (B.floors || 1) - 1);
    if (!top) return;
    var off = FC.on("inside:enter", function (e) {
      if (!e || e.building !== B) return;
      off();
      var tries = 0;
      var again = function () {
        if (!FC.inside.active || FC.inside.building !== B || FC.inside.floor === top || tries++ > 8) return;
        FC.inside.go(top);
        setTimeout(again, 900);
      };
      setTimeout(again, 80);
    });
    setTimeout(off, 15000);
  }
  function roofExit(A, B) {
    leave(A, null);
    var P = FC.player, d = B.doors[0];
    if (FC.inside && FC.inside.enter) {
      P.x = d.x + d.nx * 1.5; P.z = d.z + d.nz * 1.5; P.y = 0.2;
      goTop(B);
      FC.inside.enter(B, 0);
      if (FC.hud) FC.hud.toast("С крыши — на " + Math.max(1, B.floors || 1) + "-й этаж", "", 2);
    } else P.teleport(d.x + d.nx * 2.5, d.z + d.nz * 2.5);
  }
  function bail(A) {
    var P = FC.player;
    leave(A, null);
    A.abandoned = true; A.engine = false;
    P.mode = "chute"; P.x = A.x; P.z = A.z; P.y = A.y - 1.5;
    chute = { vy: -2, open: 0.6, vx: A.vx * 0.5, vz: A.vz * 0.5 };
    showCanopy(true);
    if (FC.hud) FC.hud.toast("🪂 Прыжок! Джойстик/WASD — рулить куполом", "", 3);
    if (FC.audio) FC.audio.play("whoosh");
  }

  // купол парашюта
  var canopy = new T.Group();
  (function () {
    var dome = new T.Mesh(new T.SphereGeometry(2.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), new T.MeshStandardMaterial({ color: 0xff6a2a, side: T.DoubleSide, roughness: 0.7 }));
    dome.scale.set(1.2, 0.55, 1); dome.position.y = 4.2; canopy.add(dome);
    var stripe = new T.Mesh(new T.SphereGeometry(2.62, 16, 8, 0, Math.PI * 2, 0.55, 0.25), new T.MeshStandardMaterial({ color: 0xffffff, side: T.DoubleSide }));
    stripe.scale.copy(dome.scale); stripe.position.copy(dome.position); canopy.add(stripe);
    for (var i = 0; i < 6; i++) {
      var a = i / 6 * Math.PI * 2, ln = new T.Mesh(new T.CylinderGeometry(0.015, 0.015, 3.2, 3), std(0x222222, 0.8));
      ln.position.set(Math.cos(a) * 1.4, 2.6, Math.sin(a) * 1.2); ln.rotation.set(Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45); canopy.add(ln);
    }
    canopy.visible = false; root.add(canopy);
  })();
  function showCanopy(on) { canopy.visible = on; }
  function stepChute(dt) {
    var P = FC.player, I = FC.input;
    if (!chute) { P.mode = "foot"; return; }
    chute.open = Math.min(1, chute.open + dt * 1.5);
    var target = -4.2 * (0.6 + 0.4 * chute.open);
    chute.vy = FC.damp(chute.vy, target, 3, dt);
    var s = Math.sin(FC.cam.yaw), c = Math.cos(FC.cam.yaw);
    var wx = -s * I.mz + c * I.mx, wz = -c * I.mz - s * I.mx, m = Math.hypot(wx, wz) || 1;
    var sp = 6.5 * Math.min(1, Math.hypot(I.mx, I.mz));
    chute.vx = FC.damp(chute.vx, wx / m * sp, 1.5, dt); chute.vz = FC.damp(chute.vz, wz / m * sp, 1.5, dt);
    if (Math.hypot(wx, wz) > 0.05) P.heading = FC.angDamp(P.heading, Math.atan2(wx, wz), 4, dt);
    P.x += chute.vx * dt; P.z += chute.vz * dt; P.y += chute.vy * dt;
    P.vx = chute.vx; P.vz = chute.vz;
    canopy.position.set(P.x, P.y, P.z); canopy.rotation.set(chute.vz * 0.03, P.heading, -chute.vx * 0.03);
    var gr = ground(P.x, P.z);
    if (P.y <= gr.h + 0.2) {
      chute = null; showCanopy(false);
      if (gr.B) { P.mode = "foot"; roofLand(gr.B); return; }
      if (gr.water) {
        P.mode = "foot"; P.teleport(BOARD.x, BOARD.z);
        if (FC.hud) FC.hud.toast("Тебя выловили спасатели и привезли на пляж", "", 3);
        return;
      }
      P.mode = "foot"; P.y = gr.h + 0.03; P.vy = 0;
      if (FC.fx && FC.fx.burst) FC.fx.burst(P.x, gr.h + 0.1, P.z, "dust", 10);
      if (FC.hud && FC.hud.popup) FC.hud.popup("ПРИЗЕМЛЕНИЕ +$100", { color: "#7dffb0" });
      FC.money(100, "парашют");
    }
  }
  function roofLand(B) {
    var P = FC.player, d = B.doors[0];
    P.x = d.x + d.nx * 1.5; P.z = d.z + d.nz * 1.5; P.y = 0.2;
    if (FC.hud && FC.hud.popup) FC.hud.popup("НА КРЫШУ! +$250", { color: "#ffcf7a", big: true });
    FC.money(250, "парашют на крышу");
    if (FC.inside && FC.inside.enter) { goTop(B); FC.inside.enter(B, 0); }
  }

  /* ---- вертолёт: аркада ----------------------------------------------------------------------------------- */
  function stepHeli(A, dt, c) {
    var sp = A.spec;
    A.rpm = FC.damp(A.rpm, A.engine ? 1 : 0, A.engine ? 1.4 : 0.35, dt);
    var lift = FC.clamp((A.rpm - 0.55) / 0.4, 0, 1);
    if (A.wrecked) lift = 0;
    A.yaw -= c.turn * sp.yaw * dt * (A.onGround ? 0.6 : 1);
    var fx = Math.sin(A.yaw), fz = Math.cos(A.yaw), rx = -Math.cos(A.yaw), rz = Math.sin(A.yaw);
    var tvx = (fx * c.fw * sp.vmax + rx * c.strafe * sp.vmax * 0.45) * lift, tvz = (fz * c.fw * sp.vmax + rz * c.strafe * sp.vmax * 0.45) * lift;
    if (A.onGround && c.up <= 0) { tvx = 0; tvz = 0; }
    var ax = FC.clamp(tvx - A.vx, -sp.acc * dt, sp.acc * dt), az = FC.clamp(tvz - A.vz, -sp.acc * dt, sp.acc * dt);
    A.vx += ax; A.vz += az;
    var tvy = c.up > 0 ? sp.climb * c.up * lift : c.down > 0 ? -sp.climb * 1.2 * c.down : 0;
    if (lift < 1) tvy = Math.min(tvy, 0);
    A.vy = FC.damp(A.vy, tvy, 2.2, dt) - GRAV * (1 - lift) * dt;
    var px = A.x, pz = A.z;
    A.x += A.vx * dt; A.z += A.vz * dt; A.y += A.vy * dt;
    // наклон корпуса: вперёд — носом вниз, разворот — креном
    var fwdA = (ax * fx + az * fz) / Math.max(dt, 1e-3), sideA = (ax * rx + az * rz) / Math.max(dt, 1e-3);
    A.pitch = FC.damp(A.pitch, FC.clamp(c.fw * 0.22 + fwdA * 0.012, -0.35, 0.4), 4, dt);
    A.roll = FC.damp(A.roll, FC.clamp(c.turn * 0.25 - sideA * 0.012, -0.45, 0.45), 4, dt);
    collideWorld(A, px, pz, dt);
    // винты
    A.vis.rotor.rotation.y += dt * A.rpm * 26;
    A.vis.tail.rotation.x += dt * A.rpm * 40;
    A.vis.disc.material.opacity = Math.max(0, A.rpm - 0.4) * 0.22;
    A.vis.beacon.visible = A.engine && (performance.now() % 1200) < 140;
  }

  /* ---- самолёт: аркада с кватернионом (петли и бочки честные) -------------------------------------------- */
  var tq = new T.Quaternion(), tv = new T.Vector3(), AX = new T.Vector3(1, 0, 0), AZ = new T.Vector3(0, 0, 1), AY = new T.Vector3(0, 1, 0);
  function fwdOf(A) { return tv.set(0, 0, 1).applyQuaternion(A.q).clone(); }
  function stepPlane(A, dt, c) {
    var sp = A.spec;
    A.throttle = FC.clamp(A.throttle + (c.up - c.down) * 0.55 * dt, 0, 1);
    if (!A.engine) A.throttle = Math.max(0, A.throttle - dt);
    var f = new T.Vector3(0, 0, 1).applyQuaternion(A.q);
    var right = new T.Vector3(-1, 0, 0).applyQuaternion(A.q);
    var drag = sp.thrust / (sp.vmax * sp.vmax);
    var px = A.x, pz = A.z;
    if (A.onGround) {
      A.speed += (A.throttle * sp.thrust - drag * A.speed * A.speed - 1.2 - (c.down > 0 && A.throttle < 0.05 ? 9 : 0)) * dt;
      A.speed = Math.max(0, A.speed);
      A.yaw -= c.turn * sp.steer * dt * FC.clamp(A.speed / 8, 0.25, 1);
      var rot = A.speed > sp.vrot && c.fw > 0.25;
      A.q.setFromEuler(new T.Euler(rot ? -0.12 : 0, A.yaw, 0, "YXZ"));
      f.set(0, 0, 1).applyQuaternion(A.q);
      A.x += Math.sin(A.yaw) * A.speed * dt; A.z += Math.cos(A.yaw) * A.speed * dt;
      var gr = ground(A.x, A.z);
      if (gr.water || gr.B) { crash(A, gr.water ? "в воду" : "в здание"); return; }
      A.y = gr.h;
      if (rot) { A.onGround = false; A.y += 0.4; A.loopAcc = 0; A.rollAcc = 0; FC.emit("air:takeoff", { air: A }); if (A.player && FC.hud) FC.hud.toast("Взлёт!", "ok", 1.5); }
      A.vx = Math.sin(A.yaw) * A.speed; A.vz = Math.cos(A.yaw) * A.speed; A.vy = 0;
    } else {
      var auth = FC.clamp(A.speed / (sp.stall * 1.6), 0.25, 1.1);
      var pr = c.fw * sp.pitch * auth, rr = c.turn * sp.roll * auth;
      A.q.multiply(tq.setFromAxisAngle(AX, -pr * dt));
      A.q.multiply(tq.setFromAxisAngle(AZ, rr * dt));
      // крен поворачивает (скоординированный разворот), без ввода крен сам выравнивается
      var bank = Math.asin(FC.clamp(-right.y, -1, 1));
      if (Math.abs(c.turn) < 0.1 && Math.abs(bank) < 1.2) A.q.multiply(tq.setFromAxisAngle(AZ, -bank * 1.1 * dt));
      // стик отпущен — нос мягко к горизонту (для телефона), петля возможна, пока стик держат
      var fy0 = new T.Vector3(0, 0, 1).applyQuaternion(A.q).y;
      if (Math.abs(c.fw) < 0.1 && Math.abs(fy0) < 0.6 && A.speed > sp.stall) A.q.multiply(tq.setFromAxisAngle(AX, Math.asin(fy0) * 0.45 * dt));
      A.q.premultiply(tq.setFromAxisAngle(AY, -Math.sin(bank) * 1.7 * dt * FC.clamp(A.speed / 30, 0.3, 1.3)));
      A.q.normalize();
      f.set(0, 0, 1).applyQuaternion(A.q);
      A.speed += (A.throttle * sp.thrust - drag * A.speed * A.speed - GRAV * f.y) * dt;
      A.speed = Math.max(0, A.speed);
      // сваливание: мало скорости — нос вниз и проседание
      var st = Math.max(0, sp.stall - A.speed);
      if (st > 0) {
        var hr = new T.Vector3(right.x, 0, right.z);
        if (hr.lengthSq() > 0.04 && f.y > -0.9) A.q.premultiply(tq.setFromAxisAngle(hr.normalize(), -st * 0.03 * dt));   // нос вниз
        A.sink = FC.damp(A.sink, st * 0.9, 1.5, dt);
      } else A.sink = FC.damp(A.sink, 0, 2, dt);
      A.vx = f.x * A.speed; A.vz = f.z * A.speed; A.vy = f.y * A.speed - A.sink;
      A.x += A.vx * dt; A.z += A.vz * dt; A.y += A.vy * dt;
      // трюки
      A.loopAcc += -pr * dt; A.rollAcc += rr * dt;
      if (Math.abs(c.fw) < 0.15) A.loopAcc *= Math.exp(-dt * 0.7);
      if (Math.abs(c.turn) < 0.15) A.rollAcc *= Math.exp(-dt * 0.7);
      if (A.player) stunts(A, dt);
      if (st > 6 && A.player && FC.hud && Math.random() < dt * 2) FC.hud.toast("⚠ Сваливание — газ и нос вниз!", "bad", 1);
      // земля
      var g2 = ground(A.x, A.z);
      if (A.y <= g2.h + 0.05) {
        var soft = A.vy > -5.5 && Math.abs(bank) < 0.4 && f.y > -0.22 && !g2.water && !g2.B && A.speed < sp.vmax * 0.85;
        if (!soft) { crash(A, g2.water ? "в воду" : "о землю"); return; }
        A.onGround = true; A.y = g2.h; A.sink = 0;
        A.yaw = Math.atan2(f.x, f.z);
        A.q.setFromEuler(new T.Euler(0, A.yaw, 0, "YXZ"));
        if (A.player) {
          var onRwy = onDeck(A.x, A.z) && Math.abs(A.z - RWY.z) < RWY.w / 2;
          if (FC.hud && FC.hud.popup) FC.hud.popup(onRwy ? "ПОСАДКА НА ПОЛОСУ +$300" : "ПОСАДКА +$120", { color: "#7dffb0", big: onRwy });
          FC.money(onRwy ? 300 : 120, "посадка");
          if (FC.cam) FC.cam.shake(0.3);
        }
      }
      collideWorld(A, px, pz, dt);
    }
    if (A.vis.prop) {
      A.vis.prop.rotation.z += dt * (6 + A.throttle * 50) * (A.engine ? 1 : 0.1);
      A.vis.prop.userData.disc.material.opacity = A.engine ? 0.12 + A.throttle * 0.15 : 0;
    }
    if (A.vis.flame) {
      var fl = A.engine ? 0.25 + A.throttle * 1.1 : 0;
      A.vis.flame.scale.set(0.6 + fl * 0.5, 0.6 + fl * 0.5, Math.max(0.01, fl));
      A.vis.flame.material.opacity = 0.25 + fl * 0.45;
      A.vis.flame.visible = fl > 0.05;
    }
  }
  function stunts(A, dt) {
    var pop = FC.hud && FC.hud.popup;
    if (Math.abs(A.loopAcc) > Math.PI * 2) {
      A.loopAcc = 0; FC.money(500, "петля");
      if (pop) FC.hud.popup("МЁРТВАЯ ПЕТЛЯ +$500", { color: "#ffcf7a", big: true });
      if (FC.audio) FC.audio.play("cash");
      FC.save.stats.loops = (FC.save.stats.loops || 0) + 1; FC.dirty();
    }
    if (Math.abs(A.rollAcc) > Math.PI * 2) {
      A.rollAcc = 0; FC.money(250, "бочка");
      if (pop) FC.hud.popup("БОЧКА +$250", { color: "#6bd5ff" });
      if (FC.audio) FC.audio.play("cash");
    }
    var agl = A.y - ground(A.x, A.z).h;
    A.lowCd = Math.max(0, A.lowCd - dt);
    if (agl < 10 && A.speed > A.spec.vmax * 0.55) A.lowT += dt; else A.lowT = 0;
    if (A.lowT > 2.2 && A.lowCd <= 0) {
      A.lowT = 0; A.lowCd = 8; FC.money(150, "бреющий полёт");
      if (pop) FC.hud.popup("БРЕЮЩИЙ ПОЛЁТ +$150", { color: "#c86bff" });
    }
  }

  /* ---- мир: стены зданий, крыши, вода, граница ----------------------------------------------------------- */
  function collideWorld(A, px, pz, dt) {
    var r = A.kind === "heli" ? 3.2 : 4.5;
    var near = M.near(A.x, A.z, r + 2);
    for (var i = 0; i < near.length; i++) {
      var B = near[i];
      if (B.prop) continue;
      var inside = Math.abs(A.x - B.x) < B.w / 2 + r * 0.6 && Math.abs(A.z - B.z) < B.d / 2 + r * 0.6;
      if (!inside || A.y >= B.h - 0.4) continue;
      var wasOut = !(Math.abs(px - B.x) < B.w / 2 + r * 0.6 && Math.abs(pz - B.z) < B.d / 2 + r * 0.6);
      var spd = Math.hypot(A.vx, A.vz);
      if (!wasOut) continue;                     // над крышей — садится по ground() ниже, это не удар в стену
      A.x = px; A.z = pz;
      if (A.kind === "plane" || spd > 16) { crash(A, "в здание"); return; }
      A.vx *= -0.35; A.vz *= -0.35;
      hurt(A, spd * 3.2);
      if (A.player && FC.cam) FC.cam.shake(Math.min(1, spd / 14));
      if (FC.audio) FC.audio.play("thud");
      if (FC.fx && FC.fx.burst) FC.fx.burst(A.x, A.y + 1.5, A.z, "sparks", 12);
    }
    if (A.kind === "heli") {
      var gr = ground(A.x, A.z);
      if (gr.water && A.y < 0.3) { crash(A, "в воду"); return; }
      if (A.y <= gr.h) {
        if (A.vy < -8) { hurt(A, (-A.vy - 6) * 12); if (A.player && FC.cam) FC.cam.shake(0.6); }
        A.y = gr.h; A.vy = Math.max(0, A.vy);
        A.onGround = true;
        var fr = Math.exp(-dt * 6); A.vx *= fr; A.vz *= fr;
        A.pitch *= fr; A.roll *= fr;
      } else if (A.y > gr.h + 0.3) A.onGround = false;
      // поток от винта: пыль/брызги у земли
      A.washT -= dt;
      if (A.rpm > 0.8 && A.y - gr.h < 12 && A.washT <= 0 && FC.fx && FC.fx.burst) {
        A.washT = 0.12;
        FC.fx.burst(A.x + (Math.random() - 0.5) * 6, Math.max(gr.h, -0.8) + 0.2, A.z + (Math.random() - 0.5) * 6, gr.water ? "water" : "dust", 3);
      }
    }
    // граница неба: Флейм-Сити — ±2700 м; Минск 1:1 — границы данных города (было ±2700 и там: дальше центра не улететь)
    if (A.x < LIM[0] || A.z < LIM[1] || A.x > LIM[2] || A.z > LIM[3]) {
      A.x = FC.clamp(A.x, LIM[0], LIM[2]); A.z = FC.clamp(A.z, LIM[1], LIM[3]);
      if (A.kind === "plane") A.q.premultiply(tq.setFromAxisAngle(AY, Math.PI * dt));
      if (A.player && FC.hud && Math.random() < dt) FC.hud.toast("Граница воздушного пространства — разворот", "", 2);
    }
    if (A.y > 900) { A.y = 900; A.vy = Math.min(A.vy, 0); }
  }
  function hurt(A, n) {
    if (A.wrecked) return;
    A.hp -= n;
    if (A.hp <= 0) crash(A, "поломка");
  }
  function crash(A, why) {
    if (A.wrecked) return;
    A.wrecked = true; A.engine = false; A.hp = 0;
    var gr = ground(A.x, A.z);
    A.y = Math.max(A.y, gr.h);
    if (gr.water) {
      if (FC.fx && FC.fx.burst) FC.fx.burst(A.x, -0.6, A.z, "water", 40);
      A.sinking = 1;
    } else boom(A);
    if (A.player) {
      var P = FC.player;
      var tx = A.x, tz = A.z;
      if (gr.B) { var d = gr.B.doors[0]; tx = d.x + d.nx * 3; tz = d.z + d.nz * 3; }
      if (gr.water) { tx = BOARD.x; tz = BOARD.z; }
      leave(A, tx, tz);
      if (FC.hud) FC.hud.big("КРУШЕНИЕ", "Удар " + why, "#ff5d6c", 2.6);
      P.damage(gr.water ? 25 : 60, "crash");
      if (gr.water && FC.hud) FC.hud.toast("Тебя выловили спасатели", "", 3);
    }
    A.wreckT = 0;
    if (A.pad && A.pad.heli === A) A.pad.heli = null;
  }
  function boom(A) {
    if (FC.fx) {
      if (FC.fx.burst) { FC.fx.burst(A.x, A.y + 1.5, A.z, "flame", 34); FC.fx.burst(A.x, A.y + 1.5, A.z, "debris", 24); FC.fx.burst(A.x, A.y + 2, A.z, "smoke", 20); }
      if (FC.fx.flash) FC.fx.flash("#ffb04a", 0.55);
      if (FC.fx.hitstop) FC.fx.hitstop(0.25, 0.25);
    }
    if (FC.audio) FC.audio.play("explosion");
    var P = FC.player;
    if (FC.cam && P) FC.cam.shake(Math.max(0, 1.2 - Math.hypot(A.x - P.x, A.z - P.z) / 60));
    var burnt = std(0x1a1a1c, 0.9);
    A.g.traverse(function (o) { if (o.isMesh && o.material && o.material.toneMapped !== false && !o.material.transparent) o.material = burnt; });
    if (FC.people && FC.people.panic) FC.people.panic(A.x, A.z, 30, "boom");
  }

  /* ---- ввод и камера ------------------------------------------------------------------------------------- */
  function controls() {
    var I = FC.input;
    return { fw: FC.clamp(I.mz, -1, 1), turn: FC.clamp(I.mx, -1, 1), strafe: 0,
      up: I.held("jump") ? 1 : 0, down: (I.held("run") || I.held("punch")) ? 1 : 0 };
  }
  var camIdle = 0;
  function wrapCamera() {
    var sys = FC.systems.filter(function (s) { return s.name === "camera"; })[0];
    if (!sys || sys._airWrap) return;
    var orig = sys.update; sys._airWrap = true;
    sys.update = function (dt) {
      var P = FC.player, cam = FC.cam;
      if (!P || !cam || (P.mode !== "air" && P.mode !== "chute")) { camIdle = 2; orig(dt); return; }
      var A = cur, saved = cam.want;
      cam.want = P.mode === "chute" ? 9 : A.spec.dist + (A.kind === "plane" ? Math.min(10, A.speed * 0.08) : 0);
      if (A && camIdle > 1.0) {
        var hd = A.kind === "plane" ? P.heading : A.yaw;
        if (A.kind === "plane" && A.speed > 6) hd = Math.atan2(A.vx, A.vz);
        cam.yaw = FC.angDamp(cam.yaw, hd + Math.PI, A.kind === "plane" ? 3.5 : 2.2, dt);
        cam.pitch = FC.damp(cam.pitch, A.kind === "plane" ? 0.12 : 0.3, 2, dt);
      }
      cam.idle = 0;
      orig(dt);
      camIdle = cam.idle > 0 ? camIdle + dt : 0;
      cam.want = saved;
      // поле зрения и лёгкий крен камеры вслед за самолётом
      if (A) {
        var spd = Math.hypot(A.vx, A.vy, A.vz), k = FC.clamp(spd / A.spec.vmax, 0, 1.2);
        var fov = 62 + (A.kind === "plane" ? 22 : 10) * k * k;
        if (Math.abs(G.camera.fov - fov) > 0.2) { G.camera.fov = fov; cam.fov = fov; G.camera.updateProjectionMatrix(); }
        if (A.kind === "plane" && !A.onGround) {
          var right = new T.Vector3(-1, 0, 0).applyQuaternion(A.q);
          G.camera.rotateZ(FC.clamp(Math.asin(FC.clamp(-right.y, -1, 1)), -1, 1) * 0.22);
        }
        if (FC.fx && FC.fx.speed) FC.fx.speed(FC.clamp((k - 0.55) * 2, 0, 1));
      }
    };
  }

  /* ---- ИИ: вертолёт патруля за летящим игроком, вертолёт новостей, лайнеры ------------------------------------- */
  var cop = null, newsAI = null, liners = [], coneMat = null;
  function policeHeliFpolice() { return !!(FC.police && FC.police.state && FC.police.state.heli); }
  function stepCop(dt) {
    var P = FC.player, wanted = FC.police && FC.police.stars > 0, flying = P.mode === "air" && cur && !cur.onGround;
    if (!cop && wanted && flying && !policeHeliFpolice()) {
      cop = spawn("heli_police", P.x + 160, P.z + 140, 0, { ai: true, y: Math.max(60, P.y + 30) });
      cop.engine = true; cop.rpm = 1; cop.onGround = false; cop.copAI = true;
      if (!coneMat) coneMat = new T.MeshBasicMaterial({ color: 0xf2f6ff, transparent: true, opacity: 0.1, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide });
      var cone = new T.Mesh(new T.ConeGeometry(7, 1, 18, 1, true).translate(0, -0.5, 0), coneMat);
      cone.frustumCulled = false; root.add(cone); cop.cone = cone;
      if (FC.hud) FC.hud.notify("Диспетчер", "Воздушная цель! Вертолёт патруля в пути.", "🚁", 4);
    }
    if (!cop) return;
    var leaveNow = !wanted || !flying || policeHeliFpolice();
    cop.leaveT = leaveNow ? (cop.leaveT || 0) + dt : 0;
    var tx, ty, tz;
    if (cop.leaveT > 0) { tx = cop.x + Math.sin(cop.yaw) * 200; tz = cop.z + Math.cos(cop.yaw) * 200; ty = 220; }
    else {
      var bx = P.x - Math.sin(P.heading) * 45, bz = P.z - Math.cos(P.heading) * 45;
      tx = bx; tz = bz; ty = P.y + 14;
    }
    var dx = tx - cop.x, dz = tz - cop.z, d = Math.hypot(dx, dz), v = Math.min(cop.spec.vmax * 1.25, d * 0.9 + 6);
    cop.vx = FC.damp(cop.vx, dx / (d || 1) * v, 1.5, dt); cop.vz = FC.damp(cop.vz, dz / (d || 1) * v, 1.5, dt);
    cop.vy = FC.damp(cop.vy, FC.clamp((ty - cop.y) * 0.8, -12, 12), 1.5, dt);
    cop.x += cop.vx * dt; cop.z += cop.vz * dt; cop.y += cop.vy * dt;
    cop.yaw = FC.angDamp(cop.yaw, Math.atan2(P.x - cop.x, P.z - cop.z), 2, dt);
    cop.pitch = FC.damp(cop.pitch, FC.clamp(Math.hypot(cop.vx, cop.vz) / 60, 0, 0.3), 3, dt);
    cop.vis.rotor.rotation.y += dt * 26; cop.vis.tail.rotation.x += dt * 40; cop.vis.disc.material.opacity = 0.13;
    cop.vis.beacon.visible = (performance.now() % 900) < 120;
    cop.g.visible = true;
    place(cop);
    var night = G.night > 0.35;
    cop.cone.visible = night;
    if (night) {
      var h = Math.max(2, cop.y - P.y + 2);
      cop.cone.scale.set(1, h, 1); cop.cone.position.set(cop.x, cop.y - 0.5, cop.z);
      cop.cone.lookAt(P.x, P.y, P.z); cop.cone.rotateX(-Math.PI / 2);
    }
    if (FC.audio && FC.audio.loop) FC.audio.loop("siren", cop.leaveT === 0, { vol: Math.max(0, 0.6 - d / 400) });
    if (cop.leaveT > 14) { root.remove(cop.cone); remove(cop); cop = null; }
  }
  function stepNews(dt, t) {
    if (!newsAI) {
      var H = M.hq || { x: 0, z: 0, h: 120 };
      newsAI = spawn("heli_news", H.x + 140, H.z, 0, { ai: true, y: H.h + 60 });
      newsAI.engine = true; newsAI.rpm = 1; newsAI.onGround = false; newsAI.orbit = { x: H.x, z: H.z, r: 160, y: H.h + 50 };
    }
    var A = newsAI, o = A.orbit, a = t * 0.06;
    A.x = o.x + Math.cos(a) * o.r; A.z = o.z + Math.sin(a) * o.r; A.y = o.y + Math.sin(t * 0.3) * 6;
    A.yaw = Math.atan2(-Math.sin(a), Math.cos(a)); A.pitch = 0.12; A.roll = -0.15;
    A.vis.rotor.rotation.y += dt * 26; A.vis.tail.rotation.x += dt * 40; A.vis.disc.material.opacity = 0.13;
    A.vis.beacon.visible = (performance.now() % 1300) < 140;
    place(A);
  }
  function makeLiner() {
    var g = new T.Group(), wm = new T.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.4, metalness: 0.3, fog: false });
    var am = new T.MeshStandardMaterial({ color: [0xff6a2a, 0x2f6fd6, 0xe63946][liners.length % 3], roughness: 0.5, fog: false });
    var k = Kit();
    k.add(wm, new T.CylinderGeometry(2.1, 2.1, 40, 12).rotateX(Math.PI / 2), 0, 0, 0);
    k.add(wm, new T.SphereGeometry(2.1, 12, 8).scale(1, 1, 1.6), 0, 0, 20);
    k.add(wm, new T.ConeGeometry(2.1, 7, 12).rotateX(-Math.PI / 2), 0, 0.4, -23.5);
    [-1, 1].forEach(function (s) {
      box(k, wm, 17, 0.5, 6, s * 9.5, -0.6, 1, 0, s * -0.4, 0);
      k.add(am, new T.CylinderGeometry(0.9, 0.9, 4, 10).rotateX(Math.PI / 2), s * 6.5, -1.7, 3.5);
      box(k, wm, 6, 0.3, 2.6, s * 3.6, 0.4, -21, 0, s * -0.4, 0);
    });
    box(k, am, 0.4, 6, 4, 0, 3.6, -20.5);
    k.into(g, false);
    var trail = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.26, depthWrite: false, fog: false });
    [-1, 1].forEach(function (s) { var c = new T.Mesh(new T.BoxGeometry(0.8, 0.8, 320).translate(0, 0, -165), trail); c.position.set(s * 6.5, -1.7, 1); g.add(c); });
    root.add(g);
    return { g: g, t: 0 };
  }
  function resetLiner(L) {
    var P = FC.player, a = Math.random() * Math.PI * 2, off = (Math.random() - 0.5) * 900;
    var dir = { x: Math.cos(a), z: Math.sin(a) }, n = { x: -dir.z, z: dir.x };
    L.x = P.x - dir.x * 1100 + n.x * off; L.z = P.z - dir.z * 1100 + n.z * off; L.y = 340 + Math.random() * 140;
    L.vx = dir.x * 75; L.vz = dir.z * 75; L.t = 0;
    L.g.rotation.set(0, Math.atan2(dir.x, dir.z), 0);
  }
  function stepLiners(dt) {
    while (liners.length < 2) { var L = makeLiner(); liners.push(L); resetLiner(L); L.t = Math.random() * 20; }
    liners.forEach(function (L) {
      L.t += dt; L.x += L.vx * dt; L.z += L.vz * dt;
      L.g.position.set(L.x, L.y, L.z);
      if (L.t > 30) resetLiner(L);
    });
  }

  /* ---- пополнение площадок и самолётов, брошенные машины --------------------------------------------------- */
  function upkeep(dt) {
    var P = FC.player;
    pads.forEach(function (p) {
      if (!p.heli) {                              // вернули вертолёт на площадку — снова её
        var back = list.filter(function (A) { return A.kind === "heli" && !A.wrecked && !A.player && !A.ai && !A.abandoned && A.onGround && Math.hypot(A.x - p.x, A.z - p.z) < 6 && Math.abs(A.y - p.y) < 1.5; })[0];
        if (back) { p.heli = back; back.pad = p; back.idle = 0; }
      }
      if (p.heli) return;
      p.emptyT += dt;
      if (p.emptyT > 45 && Math.hypot(P.x - p.x, P.z - p.z) > 80) { p.emptyT = 0; stockPad(p); }
    });
    list.slice().forEach(function (A) {
      if (A.ai || A.player || A === newsAI || A === cop) return;
      var far = Math.hypot(P.x - A.x, P.z - A.z) > 250;
      var parkedHome = A.pad ? A.pad.heli === A : (A.home && Math.hypot(A.x - A.home.x, A.z - A.home.z) < 3);
      if (A.wrecked) { A.wreckT += dt; if (A.wreckT > 25 && far) remove(A); return; }
      if (parkedHome) return;
      A.idle += dt;
      if (A.idle > 50 && far) {
        var idx = planes.indexOf(A); if (idx >= 0) planes.splice(idx, 1);
        remove(A);
      }
    });
    if (Math.random() < dt * 0.2) stockPlanes();
  }
  // брошенный в воздухе (после прыжка) — падает сам
  function stepAbandoned(A, dt) {
    if (A.kind === "heli") stepHeli(A, dt, { fw: 0, turn: 0.3, strafe: 0, up: 0, down: 1 });
    else stepPlane(A, dt, { fw: -0.4, turn: 0.2, strafe: 0, up: 0, down: 0 });
  }

  /* ---- взаимодействия: сесть в воздушное судно, с верхнего этажа — на крышу ---------------------------------- */
  function airProvider(px, pz, room) {
    var P = FC.player;
    if (room != null || P.mode !== "foot") return null;
    var out = [];
    list.forEach(function (A) {
      if (A.ai || A.wrecked || A === newsAI || A === cop) return;
      var gr = ground(A.x, A.z);
      if (gr.B || gr.deck || A.y - gr.h > 1.5) return;               // крыша и палуба — отдельными входами
      var d = Math.hypot(A.x - px, A.z - pz);
      if (d < 5.5) out.push({ id: "air_" + A.id, x: A.x, z: A.z, r: 5.5, key: "car",
        label: (A.spec.police ? "Угнать " : "Сесть: ") + A.spec.name, act: function () { enter(A); } });
    });
    return out;
  }
  function registerBoarding() {
    [["plane_prop", 900], ["plane_jet", 975]].forEach(function (p) {
      FC.interact.add({ id: "air_board_" + p[0], x: BOARD.x + (p[0] === "plane_jet" ? 3 : -3), z: BOARD.z, r: 6, key: "car",
        label: "✈ Сесть в " + SPEC[p[0]].name,
        when: function () {
          var A = planes.filter(function (a) { return a.type === p[0] && !a.wrecked && !a.player && onDeck(a.x, a.z); })[0];
          return !!A && FC.player.mode === "foot";
        },
        act: function () {
          var A = planes.filter(function (a) { return a.type === p[0] && !a.wrecked && !a.player && onDeck(a.x, a.z); })[0];
          if (A) enter(A);
        } });
    });
    // с верхнего этажа здания с площадкой — на крышу, в вертолёт
    pads.forEach(function (p, i) {
      if (!p.B) return;
      var B = p.B;
      FC.interact.add({ id: "air_roof_" + i, x: B.x, z: B.z, r: Math.max(B.w, B.d), room: B.id, key: "car",
        label: "🚁 На крышу — в вертолёт",
        when: function () { return FC.inside && FC.inside.active && FC.inside.building === B && FC.inside.floor === Math.max(0, B.floors - 1) && !!p.heli && !p.heli.wrecked; },
        act: function () {
          var A = p.heli; if (!A) return;
          if (FC.inside.exit) FC.inside.exit(true);
          FC.player.mode = "foot";
          enter(A);
        } });
    });
  }

  /* ---- карта, телефон ------------------------------------------------------------------------------------ */
  function mapLayer(c, k, mode) {
    c.save();
    pads.forEach(function (p) {
      c.fillStyle = p.heli ? "#5fd0ff" : "rgba(95,208,255,.35)";
      c.beginPath(); c.arc(p.x, p.z, (mode === "big" ? 9 : 6) / k, 0, 7); c.fill();
      if (mode === "big") { c.fillStyle = "#0b1020"; c.font = "800 " + (11 / k) + "px system-ui"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("H", p.x, p.z); }
    });
    c.fillStyle = "rgba(255,255,255,.18)";
    c.fillRect(RWY.x0, RWY.z - RWY.w / 2, RWY.x1 - RWY.x0, RWY.w);
    if (mode === "big") { c.font = (18 / k) + "px system-ui"; c.textAlign = "center"; c.fillText("✈", (RWY.x0 + RWY.x1) / 2, RWY.z); }
    if (cop) { c.fillStyle = "#ff3b5c"; c.beginPath(); c.arc(cop.x, cop.z, 7 / k, 0, 7); c.fill(); }
    c.restore();
  }
  // столбы и деревья рядом с точкой (M.near отдаёт клетками по 40 м — фильтруем по расстоянию сами)
  function propNear(x, z, r) {
    return M.near(x, z, r).some(function (o) { return o.prop && Math.hypot(o.x - x, o.z - z) < r + o.r; });
  }
  function callHeli() {
    var P = FC.player;
    if (P.mode !== "foot" || (FC.inside && FC.inside.active)) { if (FC.hud) FC.hud.toast("Выйди на улицу — вертолёт сядет рядом", "", 2.5); return; }
    var spot = null;
    for (var r = 14; r < 60 && !spot; r += 6) {
      for (var a = 0; a < 12 && !spot; a++) {
        var x = P.x + Math.cos(a / 12 * Math.PI * 2) * r, z = P.z + Math.sin(a / 12 * Math.PI * 2) * r;
        if (M.buildingAt(x, z, 7) || M.water(x, z) || propNear(x, z, 4.5)) continue;
        spot = { x: x, z: z };
      }
    }
    if (!spot) { if (FC.hud) FC.hud.toast("Здесь негде сесть — найди открытое место", "bad", 2.5); return; }
    if (FC.money(-500, "вызов вертолёта") === false) { if (FC.hud) FC.hud.toast("Нужно $500", "bad", 2); return; }
    var A = spawn("heli_light", spot.x, spot.z, Math.atan2(P.x - spot.x, P.z - spot.z), { y: ground(spot.x, spot.z).h + 60 });
    A.engine = true; A.rpm = 1; A.onGround = false; A.delivery = true; A.mine = true;   // свой — не угон
    if (FC.markers) FC.markers.add({ id: "air_call", x: spot.x, z: spot.z, color: "#5fd0ff", icon: "🚁", ring: 5 });
    if (FC.hud) FC.hud.toast("🚁 Вертолёт летит к тебе", "ok", 2.5);
  }
  function stepDelivery(A, dt) {
    var gr = ground(A.x, A.z);
    A.vy = FC.damp(A.vy, A.y - gr.h > 8 ? -9 : -2.5, 2, dt);
    A.y += A.vy * dt;
    A.vis.rotor.rotation.y += dt * 26; A.vis.tail.rotation.x += dt * 40; A.vis.disc.material.opacity = 0.13;
    if (A.y - gr.h < 12) {
      A.washT -= dt;
      if (A.washT <= 0 && FC.fx && FC.fx.burst) { A.washT = 0.1; FC.fx.burst(A.x + (Math.random() - 0.5) * 6, gr.h + 0.2, A.z + (Math.random() - 0.5) * 6, "dust", 3); }
    }
    if (A.y <= gr.h) { A.y = gr.h; A.vy = 0; A.onGround = true; A.delivery = false; A.engine = false; if (FC.markers) FC.markers.remove("air_call"); }
    place(A);
  }
  FC.hud.addApp({ id: "air", icon: "🚁", name: "Авиа", color: "#2a6f97", order: 18, render: function (b, ui) {
    var P = FC.player;
    var rows = pads.map(function (p) {
      var d = Math.round(Math.hypot(P.x - p.x, P.z - p.z));
      return "<div class='row pad'><span>🚁 " + FC.hud.esc(p.name) + "<br><small class='quiet'>" + d + " м · " + (p.heli ? "вертолёт на месте" : "пусто — скоро будет") + "</small></span><button type='button' class='ghost' data-pad='" + pads.indexOf(p) + "'>📍</button></div>";
    }).join("");
    b.innerHTML = "<div class='list air-app'>" +
      "<div class='card'><b>Вызвать вертолёт — $500</b><p>«Шмель» сядет рядом с тобой. Пробел — вверх, Shift — вниз, F — выйти или парашют.</p><button type='button' id='air-call'>Вызвать</button></div>" +
      "<div class='card'><b>✈ Аэродром «Флейм»</b><p>На сваях у пляжа: «Кукурузник» и «Искра-Джет». Петля +$500, бочка +$250, посадка на полосу +$300.</p><button type='button' id='air-field' class='ghost'>Проложить маршрут</button></div>" +
      rows + "</div>";
    b.querySelector("#air-call").addEventListener("click", function () { ui.close(); callHeli(); });
    b.querySelector("#air-field").addEventListener("click", function () {
      FC.markers.add({ id: "wp", x: BOARD.x, z: BOARD.z, color: "#c86bff", icon: "✈", route: true, ring: 0 }); ui.close();
    });
    b.querySelectorAll("[data-pad]").forEach(function (el) {
      el.addEventListener("click", function () {
        var p = pads[+el.dataset.pad], tx = p.x, tz = p.z;
        if (p.B) { var d = p.B.doors[0]; tx = d.x + d.nx * 3; tz = d.z + d.nz * 3; }
        FC.markers.add({ id: "wp", x: tx, z: tz, color: "#c86bff", icon: "🚁", route: true, ring: 0 }); ui.close();
        if (p.B && FC.hud) FC.hud.toast("Площадка на крыше: войди и поднимись на верхний этаж", "", 3);
      });
    });
  } });

  /* ---- панель полёта ------------------------------------------------------------------------------------- */
  var hudT = 0;
  function drawHud(dt) {
    var P = FC.player, A = cur;
    var on = P.mode === "air" && !!A;
    hudEl.classList.toggle("on", on || P.mode === "chute");
    if (!on && P.mode !== "chute") return;
    hudT -= dt; if (hudT > 0) return; hudT = 0.12;
    if (P.mode === "chute") { hudEl.innerHTML = "🪂 <b>" + Math.round(P.y) + " м</b> <i>рули куполом</i>"; return; }
    var gr = ground(A.x, A.z), agl = Math.max(0, A.y - gr.h), spd = Math.hypot(A.vx, A.vy, A.vz) * 3.6;
    var warn = A.kind === "plane" && !A.onGround && A.speed < A.spec.stall + 3;
    var hp = Math.max(0, Math.round(A.hp / A.spec.hp * 100));
    hudEl.innerHTML = (A.kind === "heli" ? "🚁" : "✈") + " <b>" + Math.round(agl) + " м</b> · <b>" + Math.round(spd) + " км/ч</b>" +
      (A.kind === "plane" ? " · газ <b>" + Math.round(A.throttle * 100) + "%</b>" : "") +
      " · корпус <b>" + hp + "%</b>" + (warn ? " <span class='warn'>СВАЛИВАНИЕ</span>" : "") +
      " <i>" + (FC.input.touch ? "🪂 — выйти" : "F — выйти") + "</i>";
  }

  /* ---- кадр ---------------------------------------------------------------------------------------------- */
  var started = false;
  FC.on("busted", forceOut); FC.on("wasted", forceOut);
  function forceOut() {
    if (cur) { var A = cur; leave(A, null); if (!A.onGround) A.abandoned = true; }
    if (chute) { chute = null; showCanopy(false); }
    if (FC.player && (FC.player.mode === "air" || FC.player.mode === "chute")) FC.player.mode = "foot";
  }
  FC.addSystem({
    name: "air", order: 15,
    init: function () {
      if (started) return; started = true;
      pads.forEach(stockPad);
      stockPlanes();
      FC.interact.provider(airProvider);
      registerBoarding();
      FC.hud.addMapLayer(mapLayer);
      wrapCamera();
    },
    update: function (dt) {
      if (!started) return;
      var P = FC.player, t = performance.now() / 1000;
      if (MINSK_PADS.length && P) minskPads(P);
      // огни бортов и площадок — мимо тональной коррекции: днём приглушаем (иначе ореол «светит» на солнце), ночью — в полную
      lampT -= dt;
      if (lampT <= 0) {
        lampT = 0.5; var lk = 0.3 + 0.7 * FC.clamp(((G.night || 0) - 0.1) / 0.5, 0, 1);
        if (Math.abs(lk - lampK) > 0.02) { lampK = lk; Object.keys(lampM).forEach(function (h) { lampM[h].color.setHex(+h).multiplyScalar(lk); }); }
      }
      // штурвал игрока
      if (cur && P.mode === "air") {
        var A = cur;
        if (!A.engine) { A.engine = true; if (A.kind === "plane" && A.throttle < 0.05) A.throttle = 0; }
        var c = controls();
        if (A.kind === "heli" && c.up && A.rpm < 0.6 && !A.spinHint) { A.spinHint = true; if (FC.hud) FC.hud.toast("Раскрутка винта…", "", 1.6); }
        if (A.kind === "heli") stepHeli(A, dt, c); else stepPlane(A, dt, c);
        if (cur === A) {
          A.g.visible = true;                       // своё судно не отсекаем по дальности
          place(A); sync(A);
          if (FC.input.pressed("car")) { FC.input.consume("car"); exitCur(false); }
          if (FC.audio && FC.audio.loop) {
            if (A.kind === "heli") FC.audio.loop("heli", true, { vol: 0.5 + A.rpm * 0.3 });
            else FC.audio.loop("engine", true, { rate: 0.25 + A.throttle * 0.85 + (A.spec.jet ? 0.3 : 0), vol: 0.35 + A.throttle * 0.3 });
          }
          if (A.hp < A.spec.hp * 0.35) {
            A.smokeT -= dt;
            if (A.smokeT <= 0 && FC.fx && FC.fx.burst) { A.smokeT = 0.15; FC.fx.burst(A.x, A.y + 2, A.z, "smoke", 2); }
          }
        }
      } else if (P.mode === "chute") stepChute(dt);
      if (P.mode === "air" || P.mode === "chute") P.ch.visible = P.mode === "chute";
      // остальные: брошенные, доставка, обломки, вода
      for (var i = list.length - 1; i >= 0; i--) {
        var B = list[i];
        if (B === cur || B === cop || B === newsAI) continue;
        if (B.delivery) { stepDelivery(B, dt); continue; }
        if (B.abandoned && !B.wrecked) { stepAbandoned(B, dt); place(B); continue; }
        if (B.sinking) { B.y -= dt * 0.8; B.sinking += dt; place(B); if (B.sinking > 8) remove(B); continue; }
        if (!B.wrecked && B.rpm > 0.01 && !B.player) {            // винт глохнет после выхода
          B.rpm = FC.damp(B.rpm, 0, 0.5, dt); B.engine = false;
          if (B.vis.rotor) { B.vis.rotor.rotation.y += dt * B.rpm * 26; B.vis.disc.material.opacity = Math.max(0, B.rpm - 0.4) * 0.22; }
          if (B.vis.prop) B.vis.prop.rotation.z += dt * B.rpm * 30;
        }
        if (B.wrecked && FC.fx && FC.fx.burst && Math.random() < dt * 3 && Math.hypot(B.x - P.x, B.z - P.z) < 200) FC.fx.burst(B.x, B.y + 1.5, B.z, Math.random() < 0.5 ? "smoke" : "flame", 2);
        B.g.visible = Math.hypot(B.x - G.camera.position.x, B.z - G.camera.position.z) < (G.Q.far || 900);
      }
      stepCop(dt);
      stepNews(dt, t);
      stepLiners(dt);
      upkeep(dt);
      if (sockRef) sockRef.rotation.y = 0.6 + Math.sin(t * 0.4) * 0.35;
      drawHud(dt);
    }
  });

  /* Парашют без самолёта (миссия прыжка, fmissions2.js): игрок уже в свободном падении — купол раскрывается здесь. */
  function openChute(vx, vz) {
    var P = FC.player;
    if (cur) leave(cur, null);
    P.mode = "chute"; P.air = null;
    chute = { vy: Math.max(-12, P.vy || -8), open: 0.3, vx: vx || 0, vz: vz || 0 };
    showCanopy(true);
    if (FC.audio) FC.audio.play("whoosh");
  }
  FC.air = { list: list, pads: pads, SPEC: SPEC, spawn: spawn, enter: enter, exit: function (force) { if (force) forceOut(); else exitCur(false); },
    visual: function (type) { var sp = SPEC[type] || SPEC.heli_light; return (sp.kind === "heli" ? buildHeli(sp) : buildPlane(sp)).g; },
    call: callHeli, board: BOARD, runway: RWY, remove: remove, openChute: openChute, ground: ground };
})(window);
