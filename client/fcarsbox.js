/* Флейм-Сити — машины-заглушки из примитивов (прежние модели до 22.11 v3): видны, пока не догрузились настоящие
 * модели cars/cars-*.glb (fcarsgl.js), и остаются, если те не загрузились (?cars=box — нарочно). Форма — по полю fb
 * типа (седан, спорт, маслкар, электро, фургон, грузовик, автобус, мото, тук-тук, спецмашины), размеры — из ростера.
 * fcars.js зовёт FC.cars.boxModel(spec) лениво — при первой машине типа, поэтому модуль грузится после fcars2.js.
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE;
  if (!FC || !FC.cars) return;
  var cTmp = new T.Color();

  /* ---- геометрия: профиль сбоку → выдавливание по ширине, коробки с цветом вершин ---------------------------- */
  function paintV(geo, hex) {
    geo = geo.index ? geo.toNonIndexed() : geo;
    var n = geo.attributes.position.count, a = new Float32Array(n * 3);
    cTmp.set(hex);
    for (var i = 0; i < n; i++) { a[i * 3] = cTmp.r; a[i * 3 + 1] = cTmp.g; a[i * 3 + 2] = cTmp.b; }
    geo.setAttribute("color", new T.BufferAttribute(a, 3));
    return geo;
  }
  function plain(geo) { geo = geo.index ? geo.toNonIndexed() : geo; if (geo.attributes.color) geo.deleteAttribute("color"); return geo; }
  // Профиль: точки [длина, высота] и команды кривых ["q", cx, cy, x, y]; ширина — по x машины.
  function profile(cmds, width, bevel) {
    var s = new T.Shape();
    s.moveTo(cmds[0][0], cmds[0][1]);
    for (var i = 1; i < cmds.length; i++) {
      var c = cmds[i];
      if (c[0] === "q") s.quadraticCurveTo(c[1], c[2], c[3], c[4]); else s.lineTo(c[0], c[1]);
    }
    var depth = Math.max(0.05, width - 2 * bevel);
    var g = new T.ExtrudeGeometry(s, { depth: depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel,
      bevelSegments: 2, steps: 1, curveSegments: 5 });
    g.translate(0, 0, -depth / 2);
    g.rotateY(-Math.PI / 2);                              // длина профиля → +z (вперёд), толщина → x
    return g;
  }
  function box(w, h, d, x, y, z) { return new T.BoxGeometry(w, h, d).translate(x, y, z); }
  function merge(list) { return T.mergeGeometries(list, false); }

  function wheelGeo(r, w) {
    var tire = paintV(new T.CylinderGeometry(r, r, w, 16).rotateZ(Math.PI / 2), 0x18191b);
    var rim = paintV(new T.CylinderGeometry(r * 0.62, r * 0.62, w + 0.02, 12).rotateZ(Math.PI / 2), 0xb9bfc6);
    var hub = paintV(new T.CylinderGeometry(r * 0.22, r * 0.22, w + 0.04, 8).rotateZ(Math.PI / 2), 0x2a2c30);
    var parts = [tire, rim, hub];
    for (var i = 0; i < 5; i++) {
      var a = i / 5 * Math.PI * 2;
      parts.push(paintV(new T.BoxGeometry(w + 0.03, r * 0.1, r * 1.1).rotateX(a), 0x8d949c));
    }
    return merge(parts);
  }

  // Сборка модели типа: части + места колёс + маячки (+ водитель у мото и тук-тука)
  var GEN = {        // легковые: высоты и длины капота/багажника профиля
    sedan: { lo: 0.34, belt: 1.02, roof: 1.5, hood: 1.35, wr: 0.7, rs: 0.98, rr: 0.5 },
    sport: { lo: 0.28, belt: 0.86, roof: 1.24, hood: 1.35, wr: 0.85, rs: 1.25, rr: 0.6 },
    muscle: { lo: 0.32, belt: 0.96, roof: 1.34, hood: 1.75, wr: 0.6, rs: 1.05, rr: 0.45 },
    ev: { lo: 0.32, belt: 0.98, roof: 1.46, hood: 1.05, wr: 0.85, rs: 0.75, rr: 0.7 }
  };
  GEN.taxi = GEN.sedan; GEN.police = GEN.sedan;
  function rot(geo, rx, x, y, z) { return geo.rotateX(rx).translate(x, y, z); }
  function riderGeo(seatY, z) {
    var jacket = 0x2b2f3a, jeans = 0x34476b, skin = 0xe0b48f;
    return merge([
      paintV(box(0.42, 0.62, 0.3, 0, seatY + 0.42, z - 0.05), jacket),
      paintV(box(0.36, 0.18, 0.62, 0, seatY + 0.08, z + 0.15), jeans),
      paintV(rot(new T.BoxGeometry(0.11, 0.11, 0.62), -0.35, 0.22, seatY + 0.5, z + 0.25), jacket),
      paintV(rot(new T.BoxGeometry(0.11, 0.11, 0.62), -0.35, -0.22, seatY + 0.5, z + 0.25), jacket),
      paintV(new T.SphereGeometry(0.13, 10, 8).translate(0, seatY + 0.86, z), skin),
      paintV(new T.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62).translate(0, seatY + 0.9, z - 0.01), 0xd7263d)
    ]);
  }
  function buildModel(S) {
    var k = S.fb || S.key, L = S.L, W = S.W, P = [], TR = [], GL = [], LI = [], beacons = null, rider = null, wheels = null;
    var hl = 0xfff4dc, tl = 0xff1f1f, dark = 0x24262b, black = 0x0d0e10, chrome = 0xb9bfc6;
    var f = L / 2, r = -L / 2, i;
    if (k === "bus") {
      P.push(plain(box(W, 2.55, L, 0, 1.78, 0)));
      P.push(plain(box(W - 0.1, 0.1, L - 0.3, 0, 3.08, 0)));
      GL.push(plain(box(W + 0.04, 0.95, L - 2.2, 0, 2.2, -0.5)));
      GL.push(plain(box(W - 0.2, 1.55, 0.08, 0, 2.05, L / 2 + 0.01)));
      GL.push(plain(box(0.06, 1.7, 1.0, W / 2 + 0.01, 1.4, L / 2 - 1.6)));
      TR.push(paintV(box(W + 0.02, 0.35, L + 0.04, 0, 0.62, 0), dark));
      TR.push(paintV(box(W - 0.4, 0.06, 0.06, 0, 2.95, L / 2 + 0.03), black));
      LI.push(paintV(box(1.4, 0.22, 0.05, 0, 2.86, L / 2 + 0.04), 0xffa31a));
      LI.push(paintV(box(0.35, 0.18, 0.05, W / 2 - 0.3, 0.9, L / 2 + 0.03), hl), paintV(box(0.35, 0.18, 0.05, -W / 2 + 0.3, 0.9, L / 2 + 0.03), hl));
      LI.push(paintV(box(0.3, 0.3, 0.05, W / 2 - 0.25, 1.2, -L / 2 - 0.03), tl), paintV(box(0.3, 0.3, 0.05, -W / 2 + 0.25, 1.2, -L / 2 - 0.03), tl));
    } else if (k === "van" || k === "ambulance") {
      P.push(plain(profile([[-2.48, 0.38], [2.4, 0.38], ["q", 2.52, 0.4, 2.5, 0.7], [2.45, 1.12], [1.7, 1.3], [1.05, 2.18],
        [-2.42, 2.2], ["q", -2.5, 2.18, -2.5, 2.0], [-2.5, 0.55]], W, 0.05)));
      GL.push(plain(profile([[1.72, 1.32], [1.08, 2.12], [0.92, 2.12], [0.95, 1.3]], W + 0.02, 0)));
      TR.push(paintV(box(W + 0.04, 0.24, 0.3, 0, 0.5, L / 2 - 0.05), dark), paintV(box(W + 0.04, 0.24, 0.3, 0, 0.5, -L / 2 + 0.05), dark));
      TR.push(paintV(box(W * 0.5, 0.2, 0.05, 0, 0.82, L / 2 + 0.02), black));
      TR.push(paintV(box(0.2, 0.12, 0.14, W / 2 + 0.08, 1.45, 1.2), dark), paintV(box(0.2, 0.12, 0.14, -W / 2 - 0.08, 1.45, 1.2), dark));
      if (k === "ambulance") {
        // красная полоса и кресты по бокам, маячки на крыше
        TR.push(paintV(box(0.03, 0.3, 4.2, W / 2 + 0.02, 1.15, -0.3), 0xd62828), paintV(box(0.03, 0.3, 4.2, -W / 2 - 0.02, 1.15, -0.3), 0xd62828));
        [1, -1].forEach(function (sd) {
          TR.push(paintV(box(0.03, 0.55, 0.16, sd * (W / 2 + 0.03), 1.75, -1.2), 0xd62828), paintV(box(0.03, 0.16, 0.55, sd * (W / 2 + 0.03), 1.75, -1.2), 0xd62828));
        });
        beacons = [[W / 2 - 0.45, 2.3, 1.0], [-W / 2 + 0.45, 2.3, 1.0]];
      } else TR.push(paintV(box(0.06, 0.14, 1.6, W / 2 + 0.02, 1.15, -1.1), dark), paintV(box(0.06, 0.14, 1.6, -W / 2 - 0.02, 1.15, -1.1), dark));
      LI.push(paintV(box(0.38, 0.16, 0.05, W / 2 - 0.32, 0.92, L / 2 + 0.01), hl), paintV(box(0.38, 0.16, 0.05, -W / 2 + 0.32, 0.92, L / 2 + 0.01), hl));
      LI.push(paintV(box(0.18, 0.5, 0.05, W / 2 - 0.15, 1.0, -L / 2 - 0.02), tl), paintV(box(0.18, 0.5, 0.05, -W / 2 + 0.15, 1.0, -L / 2 - 0.02), tl));
    } else if (k === "truck" || k === "fire") {
      // кабина спереди, кузов-фургон (у пожарной — цистерна с лестницей в цвет машины)
      P.push(plain(profile([[f - 2.5, 0.62], [f - 0.05, 0.62], ["q", f + 0.06, 0.64, f, 0.95], [f - 0.05, 1.75], [f - 0.5, 2.9], [f - 2.5, 2.95]], W, 0.06)));
      GL.push(plain(profile([[f - 0.1, 1.82], [f - 0.48, 2.74], [f - 0.62, 2.74], [f - 0.24, 1.82]], W - 0.25, 0)));
      GL.push(plain(box(W + 0.02, 0.7, 1.0, 0, 2.2, f - 1.45)));
      TR.push(paintV(box(W - 0.3, 0.32, L - 0.2, 0, 0.62, 0), dark), paintV(box(W + 0.06, 0.32, 0.32, 0, 0.72, f - 0.02), dark));
      TR.push(paintV(box(W * 0.6, 0.5, 0.04, 0, 1.2, f + 0.01), black));
      TR.push(paintV(box(0.12, 0.12, 1.4, W / 2 - 0.15, 3.0, f - 2.65), chrome));                       // выхлопная труба
      if (k === "fire") {
        P.push(plain(box(W + 0.04, 1.9, L - 2.9, 0, 1.75, r + (L - 2.9) / 2 + 0.1)));
        TR.push(paintV(box(0.03, 0.18, L - 3.0, W / 2 + 0.03, 1.3, r + (L - 2.9) / 2 + 0.1), 0xf1faee), paintV(box(0.03, 0.18, L - 3.0, -W / 2 - 0.03, 1.3, r + (L - 2.9) / 2 + 0.1), 0xf1faee));
        TR.push(paintV(box(0.08, 0.08, L - 2.4, 0.45, 2.85, -0.6), chrome), paintV(box(0.08, 0.08, L - 2.4, -0.45, 2.85, -0.6), chrome));
        for (i = 0; i < 12; i++) TR.push(paintV(box(0.9, 0.05, 0.05, 0, 2.85, r + 0.8 + i * (L - 2.6) / 12), chrome));
        beacons = [[W / 2 - 0.4, 3.02, f - 1.2], [-W / 2 + 0.4, 3.02, f - 1.2]];
      } else {
        TR.push(paintV(box(W + 0.06, 3.0, L - 2.8, 0, 2.15, r + (L - 2.8) / 2 + 0.1), 0xe9ecef));
        TR.push(paintV(box(W + 0.08, 0.08, L - 2.8, 0, 3.66, r + (L - 2.8) / 2 + 0.1), 0xc9ced3));
      }
      LI.push(paintV(box(0.36, 0.2, 0.05, W / 2 - 0.3, 0.95, f + 0.04), hl), paintV(box(0.36, 0.2, 0.05, -W / 2 + 0.3, 0.95, f + 0.04), hl));
      LI.push(paintV(box(0.22, 0.28, 0.05, W / 2 - 0.2, 1.05, r - 0.03), tl), paintV(box(0.22, 0.28, 0.05, -W / 2 + 0.2, 1.05, r - 0.03), tl));
      var tw = W / 2 - 0.14, tz = S.wb / 2;
      wheels = [[tw, S.wr, tz, 1], [-tw, S.wr, tz, 1], [tw, S.wr, -tz, 0], [-tw, S.wr, -tz, 0], [tw, S.wr, -tz + 1.25, 0], [-tw, S.wr, -tz + 1.25, 0]];
    } else if (k === "moto") {
      P.push(plain(box(0.34, 0.26, 0.7, 0, 0.84, 0.16)));                         // бак
      P.push(plain(rot(new T.BoxGeometry(0.38, 0.34, 0.5), -0.35, 0, 0.82, 0.62)));   // обтекатель
      P.push(plain(rot(new T.BoxGeometry(0.28, 0.12, 0.55), 0.25, 0, 0.72, -0.66)));  // хвост
      TR.push(paintV(box(0.3, 0.1, 0.6, 0, 0.9, -0.3), black));                      // сиденье
      TR.push(paintV(box(0.24, 0.3, 0.8, 0, 0.48, -0.05), dark));                      // мотор и рама
      TR.push(paintV(rot(new T.BoxGeometry(0.06, 0.78, 0.06), -0.38, 0.11, 0.62, 0.62), chrome), paintV(rot(new T.BoxGeometry(0.06, 0.78, 0.06), -0.38, -0.11, 0.62, 0.62), chrome));
      TR.push(paintV(box(0.72, 0.04, 0.04, 0, 1.06, 0.46), dark));                     // руль
      TR.push(paintV(box(0.1, 0.1, 0.75, 0.2, 0.4, -0.45), chrome));                   // выхлоп
      GL.push(plain(rot(new T.BoxGeometry(0.32, 0.24, 0.03), -0.6, 0, 1.06, 0.78)));   // ветровой щиток
      LI.push(paintV(box(0.18, 0.13, 0.05, 0, 0.84, 0.9), hl), paintV(box(0.16, 0.06, 0.04, 0, 0.72, -0.94), tl));
      wheels = [[0, S.wr, 0.71, 1], [0, S.wr, -0.71, 0]];
      rider = riderGeo(0.86, -0.25);
    } else if (k === "tuk") {
      P.push(plain(profile([[r + 0.1, 0.3], [f - 0.15, 0.3], ["q", f + 0.03, 0.32, f, 0.58], [f - 0.1, 1.0], [f - 0.55, 1.05], [r + 0.3, 1.0], [r + 0.05, 0.6]], W, 0.06)));
      P.push(plain(box(W + 0.12, 0.09, L - 0.4, 0, 2.02, -0.05)));                  // тент
      [[W / 2 - 0.07, f - 0.6], [-W / 2 + 0.07, f - 0.6], [W / 2 - 0.07, r + 0.25], [-W / 2 + 0.07, r + 0.25]].forEach(function (q) {
        TR.push(paintV(box(0.06, 1.0, 0.06, q[0], 1.5, q[1]), dark));
      });
      TR.push(paintV(box(W - 0.3, 0.14, 0.3, 0, 0.42, f - 0.05), dark), paintV(box(W - 0.2, 0.08, 0.55, 0, 1.08, r + 0.5), 0x8a5a3b));
      GL.push(plain(box(W - 0.25, 0.62, 0.04, 0, 1.38, f - 0.58)));
      LI.push(paintV(box(0.22, 0.16, 0.05, 0, 0.82, f + 0.01), hl));
      LI.push(paintV(box(0.14, 0.14, 0.04, W / 2 - 0.12, 0.7, r - 0.02), tl), paintV(box(0.14, 0.14, 0.04, -W / 2 + 0.12, 0.7, r - 0.02), tl));
      var kx = W / 2 - 0.1, kz = S.wb / 2;
      wheels = [[0, S.wr, kz, 1], [kx, S.wr, -kz, 0], [-kx, S.wr, -kz, 0]];
      rider = riderGeo(0.82, 0.2);
    } else {
      var C = GEN[k] || GEN.sedan;
      var lo = C.lo, belt = C.belt, roof = C.roof;
      P.push(plain(profile([[r + 0.06, lo], [f - 0.12, lo], ["q", f + 0.04, lo + 0.02, f, lo + 0.26], [f - 0.08, belt - 0.24],
        ["q", f - 0.7, belt - 0.02, f - C.hood, belt], [r + 1.0, belt + 0.02], ["q", r + 0.35, belt, r + 0.05, belt - 0.08], [r, lo + 0.25],
        ["q", r - 0.02, lo + 0.02, r + 0.06, lo]], W, 0.06)));
      // стёкла: лобовое, крыша, заднее — трапецией, уже кузова
      var ws = f - C.hood, rs = r + C.rs;
      GL.push(plain(profile([[ws, belt - 0.02], [ws - C.wr, roof - 0.04], [rs + C.rr, roof - 0.02], [rs, belt]], W - 0.32, 0)));
      // крыша и стойки (у электрокара крыша стеклянная)
      var roofG = plain(profile([[ws - C.wr + 0.02, roof - 0.07], [ws - C.wr - 0.01, roof + 0.03], [rs + C.rr - 0.02, roof + 0.04], [rs + C.rr + 0.02, roof - 0.05]], W - 0.28, 0));
      (k === "ev" ? GL : P).push(roofG);
      var bp = (ws + rs) / 2 - 0.1;
      P.push(plain(box(W - 0.3, roof - belt, 0.12, 0, (roof + belt) / 2, bp)));
      // отделка: бамперы, решётка, номера, пороги, зеркала
      TR.push(paintV(box(W - 0.06, 0.2, 0.26, 0, lo + 0.1, f - 0.08), dark), paintV(box(W - 0.06, 0.2, 0.26, 0, lo + 0.1, r + 0.08), dark));
      if (k !== "ev") TR.push(paintV(box(W * 0.46, 0.14, 0.05, 0, lo + 0.34, f + 0.0), black));
      TR.push(paintV(box(0.5, 0.12, 0.02, 0, lo + 0.18, f + 0.06), 0xf2f2f2), paintV(box(0.5, 0.12, 0.02, 0, lo + 0.22, r - 0.06), 0xf2f2f2));
      TR.push(paintV(box(0.05, 0.1, L - 1.6, W / 2 + 0.01, lo + 0.08, 0), dark), paintV(box(0.05, 0.1, L - 1.6, -W / 2 - 0.01, lo + 0.08, 0), dark));
      TR.push(paintV(box(0.2, 0.1, 0.14, W / 2 + 0.06, belt + 0.06, ws - 0.15), dark), paintV(box(0.2, 0.1, 0.14, -W / 2 - 0.06, belt + 0.06, ws - 0.15), dark));
      if (k === "sport") {
        TR.push(paintV(box(W - 0.2, 0.05, 0.32, 0, belt + 0.22, r + 0.2), black));
        TR.push(paintV(box(0.06, 0.2, 0.06, W / 2 - 0.35, belt + 0.1, r + 0.2), black), paintV(box(0.06, 0.2, 0.06, -W / 2 + 0.35, belt + 0.1, r + 0.2), black));
      }
      if (k === "muscle") {
        // воздухозаборник, гоночные полосы по капоту-крыше-багажнику, утиный спойлер, боковые выхлопы
        TR.push(paintV(box(0.72, 0.13, 0.9, 0, belt + 0.04, f - 0.95), black));
        [0.17, -0.17].forEach(function (sx) {
          TR.push(paintV(box(0.16, 0.012, C.hood - 0.15, sx, belt + 0.005, f - C.hood / 2 - 0.05), 0xf1faee));
          TR.push(paintV(box(0.16, 0.012, rs - ws + C.wr + C.rr - 0.2, sx, roof + 0.045, (ws - C.wr + rs + C.rr) / 2), 0xf1faee));
          TR.push(paintV(box(0.16, 0.012, 0.9, sx, belt + 0.03, r + 0.5), 0xf1faee));
        });
        TR.push(paintV(box(W - 0.3, 0.07, 0.24, 0, belt + 0.1, r + 0.14), black));
        TR.push(paintV(box(0.09, 0.09, 0.7, W / 2 + 0.03, lo + 0.05, 0.4), chrome), paintV(box(0.09, 0.09, 0.7, -W / 2 - 0.03, lo + 0.05, 0.4), chrome));
      }
      if (k === "taxi") {
        for (i = 0; i < 8; i++) {
          var col = i % 2 ? 0x111111 : 0xf7f7f7, zz = -1.3 + i * 0.32;
          TR.push(paintV(box(0.03, 0.1, 0.32, W / 2 + 0.02, belt - 0.22, zz), col), paintV(box(0.03, 0.1, 0.32, -W / 2 - 0.02, belt - 0.22, zz), col));
        }
        LI.push(paintV(box(0.72, 0.22, 0.32, 0, roof + 0.15, (ws + rs) / 2), 0xffd23f));
      }
      if (k === "police") {
        TR.push(paintV(box(0.03, 0.34, L - 1.4, W / 2 + 0.02, belt - 0.3, 0), 0x1d4ed8), paintV(box(0.03, 0.34, L - 1.4, -W / 2 - 0.02, belt - 0.3, 0), 0x1d4ed8));
        TR.push(paintV(box(W - 0.5, 0.08, 0.5, 0, roof + 0.07, (ws + rs) / 2 + 0.1), black));
        TR.push(paintV(box(0.5, 0.12, 0.02, 0, belt - 0.12, f - 0.02), 0x1d4ed8));
        beacons = [[W / 2 - 0.5, roof + 0.17, (ws + rs) / 2 + 0.1], [-W / 2 + 0.5, roof + 0.17, (ws + rs) / 2 + 0.1]];
      }
      var hy = belt - 0.22;
      if (k === "ev") {
        // световые полосы во всю ширину спереди и сзади
        LI.push(paintV(box(W - 0.3, 0.06, 0.05, 0, hy + 0.02, f - 0.03), 0xdff6ff), paintV(box(W - 0.24, 0.07, 0.05, 0, belt - 0.1, r + 0.03), tl));
      } else {
        LI.push(paintV(box(0.42, 0.13, 0.06, W / 2 - 0.3, hy, f - 0.04), hl), paintV(box(0.42, 0.13, 0.06, -W / 2 + 0.3, hy, f - 0.04), hl));
        LI.push(paintV(box(0.46, 0.14, 0.05, W / 2 - 0.3, belt - 0.1, r + 0.03), tl), paintV(box(0.46, 0.14, 0.05, -W / 2 + 0.3, belt - 0.1, r + 0.03), tl));
      }
    }
    var wx = W / 2 - 0.12, wz = S.wb / 2;
    if (!GL.length) GL.push(plain(box(0.01, 0.01, 0.01, 0, -5, 0)));
    return {
      paint: merge(P), trim: merge(TR), glass: merge(GL), lights: merge(LI),
      wheel: null,
      wheels: wheels || [[wx, S.wr, wz, 1], [-wx, S.wr, wz, 1], [wx, S.wr, -wz, 0], [-wx, S.wr, -wz, 0]], beacons: beacons, rider: rider
    };
  }

  FC.cars.boxModel = buildModel; FC.cars.wheelGeo = wheelGeo; FC.cars.riderGeo = riderGeo;
})(window);
