/* Флейм-Сити — секреты и лайфхаки (FC.secrets), как «скрытые пакеты», уникальные прыжки и пасхалки GTA.
 *
 *   🔥 Огоньки — 50 на город: крыши (только с вертолёта или парашюта), дворы, парки, берег реки, пляж, особые места.
 *      Счётчик, награды на 10/25/50 (радар огоньков на миникарте 300 м → 1 км, деньги, звание). Минск: дворы и парки
 *      уточняются, когда кусок OSM рядом загружен (огонёк не останется в стене или в воде).
 *   🎯 Уникальные прыжки — 20 на город: свои трамплины (красно-белые), зачёт — полёт ≥ 0,85 с и ≥ 20 м; на взлёте —
 *      замедление и камера сбоку. Физика — общий rampTick (fcars2) по FC.cars.ramps.
 *   ↗️ Срезки — 8 на город: проехать парк по диагонали ≥ 36 км/ч.
 *   👽 Пасхалки: НЛО над озером в 3 часа ночи в дождь; дверь без таблички на 42-м этаже Башни; машина-призрак после
 *      полуночи; говорящий голубь; тайный гараж (бесплатный гиперкар раз в игровые сутки).
 *   🥤 Автоматы «Огонёк-кола» (здоровье до максимума за $5), 🚕 бесплатное такси (свистнуть такси «Огонька» с меткой на
 *      карте — довезёт даром и, если звезда одна, «не сдаст»).
 *   ⌨️ Читы — скрытое поле в «Миссиях» (пять тапов по номеру версии): ОГОНЬ, ДОЖДЬ, СОЛНЦЕ, НОЧЬ, ДЕНЬ, МЕДЛЕННО,
 *      ГОЛОВА, ТАЧКА, ВЕРТОЛЁТ, БРОНЯ, ЧИСТО. Пока действуют — без медалей и достижений (FC.mis.cheat).
 * Точные места — только в docs/ARCHITECTURE.md (для сопровождающих), игроку — слухи прохожих (ftalk: FC.talk.lines).
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE, M = FC.map, G = FC.gfx, X = FC.mis;
  if (!X || !FC.hud || !T) return;
  var H = FC.hud, esc = H.esc, CITY = FC.city || "flame", MINSK = !!M.minsk;
  var N_OG = 50, N_JUMP = 20, N_CUT = 8;
  // этаж комнаты без таблички: 42-й (индекс 41), а если штаб ниже — предпоследний
  var ROOM_FL = M.hq && M.hq.floors >= 42 ? 41 : Math.max(1, ((M.hq && M.hq.floors) || 4) - 2), ROOM_TXT = (ROOM_FL + 1) + "-м этаже";

  function sv() {
    var s = FC.save;
    if (!s.sec) s.sec = {};
    var c = s.sec[CITY] || (s.sec[CITY] = {});
    ["og", "jumps", "cuts", "eggs", "seen"].forEach(function (k) { if (!c[k]) c[k] = {}; });
    return c;
  }
  function cnt(o) { return Object.keys(o).length; }
  function pop(t, col, big) { if (H.popup) H.popup(t, { color: col || "#ffcf7a", big: !!big }); }
  function snd(n, o) { if (FC.audio) FC.audio.play(n, o); }
  function egg(id, title) {
    var s = sv();
    if (s.eggs[id]) return false;
    s.eggs[id] = Date.now(); FC.dirty();
    pop("🥚 ПАСХАЛКА: " + title, "#c86bff", true); snd("mission");
    X.ach("egg_" + id);
    FC.emit("secret:egg", { id: id });
    return true;
  }
  function spread(list, n, minD, get, out) {
    out = out || [];
    for (var i = 0; i < list.length && out.length < n; i++) {
      var p = get(list[i]); if (!p) continue;
      var ok = true;
      for (var k = 0; k < out.length; k++) if (Math.hypot(out[k].x - p.x, out[k].z - p.z) < minD) { ok = false; break; }
      if (ok) out.push(p);
    }
    return out;
  }
  function byHash(tag) { return function (a, b) { return FC.hash(tag + (a.id != null ? a.id : a.i)) - FC.hash(tag + (b.id != null ? b.id : b.i)); }; }
  function centerOf() { return MINSK ? { x: -1200, z: -700 } : { x: 0, z: 0 }; }
  function inR(p, r) { var c = centerOf(); return Math.hypot(p.x - c.x, p.z - c.z) < r; }
  // свободная точка во дворе квартала: дальше всего от улиц, не в доме и не в воде
  function courtyard(b) {
    var best = null, bs = -1;
    for (var i = 1; i < 6; i++) for (var j = 1; j < 6; j++) {
      var x = b.x0 + (b.x1 - b.x0) * i / 6, z = b.z0 + (b.z1 - b.z0) * j / 6;
      if (M.onRoad(x, z) || M.buildingAt(x, z, 1.4) || M.water(x, z)) continue;
      var e = Math.min(x - b.x0, b.x1 - x, z - b.z0, b.z1 - z);
      if (e > bs) { bs = e; best = { x: x, z: z }; }
    }
    return best;
  }

  /* =========================================================================================================== */
  /* Огоньки                                                                                                       */
  /* =========================================================================================================== */
  var OG = [];
  function genOgonki() {
    var out = [];
    function add(kind, p, y) { if (p && out.length < N_OG) out.push({ id: "o" + out.length, kind: kind, x: p.x, y: y != null ? y : 0.95, z: p.z, fix: MINSK && kind !== "roof" }); }
    function far(p) { for (var k = 0; k < out.length; k++) if (Math.hypot(out[k].x - p.x, out[k].z - p.z) < 60) return false; return true; }
    if (!MINSK) {
      var roofs = M.buildings.filter(function (B) { return !B.zone && !B.poi && B !== M.hq && B.h >= 14 && B.h <= 150 && B.w >= 10 && B.d >= 10; }).sort(byHash("ogr"));
      spread(roofs, 14, 150, function (B) { return B; }).forEach(function (B) { add("roof", { x: B.x + (FC.hash("ox" + B.id) % 2 ? 1 : -1) * (B.w / 2 - 3), z: B.z + (FC.hash("oz" + B.id) % 2 ? 1 : -1) * (B.d / 2 - 3) }, B.h + 1.3); });
      add("roof", { x: M.hq.x - M.hq.w / 2 + 4, z: M.hq.z - M.hq.d / 2 + 4 }, M.hq.h + 1.3);
      if (FC.story && FC.story.skuka) { var sk = FC.story.skuka(); add("roof", { x: sk.x, z: sk.z }, sk.h + 1.3); }
      var city = M.blocks.filter(function (b) { return b.kind === "city"; }).sort(byHash("ogc"));
      spread(city, 14, 160, courtyard).forEach(function (p) { add("yard", p); });
      var parks = M.blocks.filter(function (b) { return b.kind === "park" || b.kind === "shore"; }).sort(byHash("ogp"));
      spread(parks, 9, 150, function (b) { var p = { x: b.x0 + (b.x1 - b.x0) * 0.22, z: b.z1 - (b.z1 - b.z0) * 0.2 }; return !M.water(p.x, p.z) && !M.buildingAt(p.x, p.z, 1) && far(p) ? p : null; }).forEach(function (p) { add("park", p); });
      // у мостов: берег под устоем
      M.edges.filter(function (e) { return e.bridge && e.span; }).sort(byHash("ogb")).slice(0, 12).forEach(function (e) {
        if (out.filter(function (o) { return o.kind === "bank"; }).length >= 5) return;
        var A = M.nodes[e.a], B = M.nodes[e.b], dx = (B.x - A.x) / e.len, dz = (B.z - A.z) / e.len, s = Math.max(0, e.span[0] - 3);
        var p = { x: A.x + dx * s - dz * (e.w / 2 + 4), z: A.z + dz * s + dx * (e.w / 2 + 4) };
        if (!M.water(p.x, p.z) && !M.buildingAt(p.x, p.z, 1) && far(p)) add("bank", p);
      });
      var bz = M.BEACH_Z0 + 10;
      [-1040, 260, 1040].forEach(function (x) { add("beach", { x: x, z: bz }); });
      add("lake", { x: M.LAKE.x + M.LAKE.r + 6, z: M.LAKE.z });
      var extra = city.slice(40);
      for (var i = 0; i < extra.length && out.length < N_OG; i++) { var q = courtyard(extra[i]); if (q && far(q)) add("yard", q); }
    } else {
      var marks = (M.marks || []).filter(function (m) { return m[3] >= 25 && !X.BAD.test(m[0]) && X.safe(m[1], m[2]) && inR({ x: m[1], z: m[2] }, 9000); })
        .map(function (m) { return { x: m[1], z: m[2], h: m[3], id: m[0] }; }).sort(byHash("ogm"));
      spread(marks, 16, 320, function (m) { return m; }).forEach(function (m) { add("roof", m, m.h + 1.5); });
      var homes = (M.homes || []).filter(function (B) { return B.doors && B.doors.length && inR(B, 7000) && X.safe(B.x, B.z); }).sort(byHash("ogh"));
      spread(homes, 14, 450, function (B) { var d = B.doors[0]; return { x: B.x - d.nx * ((B.d || 12) / 2 + 8), z: B.z - d.nz * ((B.d || 12) / 2 + 8) }; }).forEach(function (p) { add("yard", p); });
      var parks2 = M.blocks.filter(function (b) { return b.kind === "park" && inR({ x: b.cx, z: b.cz }, 8000) && X.safe(b.cx, b.cz); }).sort(byHash("ogp"));
      spread(parks2, 12, 450, function (b) { return { x: b.cx + (b.x1 - b.x0) * 0.18, z: b.cz - (b.z1 - b.z0) * 0.15 }; }).forEach(function (p) { add("park", p); });
      var rr = [];
      X.rivers().forEach(function (R, li) {
        for (var k = 0; k < R.length - 1; k += 2) {
          var a = R[k], b2 = R[k + 1], l = Math.hypot(b2[0] - a[0], b2[1] - a[1]) || 1, w = (M.RIVER_W || 30) / 2 + 7;
          var p2 = { x: a[0] - (b2[1] - a[1]) / l * w, z: a[1] + (b2[0] - a[0]) / l * w, i: li * 1000 + k };
          if (inR(p2, 6000) && X.safe(p2.x, p2.z)) rr.push(p2);
        }
      });
      spread(rr.sort(byHash("ogr")), 6, 500, function (p) { return p; }).forEach(function (p) { add("bank", p); });
      var af = M.airfield;
      if (af) add("field", { x: af.x1 + 25, z: (af.z0 + af.z1) / 2 });
      for (var j = 16; j < marks.length && out.length < N_OG; j++) add("roof", marks[j], marks[j].h + 1.5);
    }
    return out;
  }
  // огонёк в Минске уточняем на месте: дом или вода под ним — ищем свободное рядом
  function fixOg(o) {
    if (!X.loaded(o.x, o.z)) return;
    o.fix = false;
    if (!M.buildingAt(o.x, o.z, 1.2) && !M.water(o.x, o.z)) return;
    for (var r = 3; r <= 45; r += 3) for (var a = 0; a < 12; a++) {
      var x = o.x + Math.cos(a / 12 * 6.283 + r) * r, z = o.z + Math.sin(a / 12 * 6.283 + r) * r;
      if (!M.buildingAt(x, z, 1.2) && !M.water(x, z)) { o.x = x; o.z = z; return; }
    }
  }
  // меш: капля огня (тело вращения), один InstancedMesh на все, видимы только ближние
  var ogMesh = null, ogObj = new T.Object3D(), ogNear = [], ogT = 0;
  function buildOgMesh() {
    var pts = [[0, -0.55], [0.26, -0.45], [0.4, -0.2], [0.38, 0.08], [0.25, 0.38], [0.1, 0.62], [0, 0.85]].map(function (p) { return new T.Vector2(p[0], p[1]); });
    var geo = new T.LatheGeometry(pts, 10);
    var mat = new T.MeshBasicMaterial({ color: 0xff8a2a, toneMapped: false, transparent: true, opacity: 0.95 });
    ogMesh = new T.InstancedMesh(geo, mat, 64); ogMesh.count = 0; ogMesh.frustumCulled = false; ogMesh.name = "ogonki";
    G.add(ogMesh);
  }
  function ogTick(dt) {
    var P = FC.player, s = sv(), t = performance.now() / 1000;
    ogT -= dt;
    if (ogT <= 0) {
      ogT = 0.5; ogNear.length = 0;
      for (var i = 0; i < OG.length; i++) {
        var o = OG[i]; if (s.og[o.id]) continue;
        var d = Math.hypot(o.x - P.x, o.z - P.z);
        if (o.fix && d < 300) fixOg(o);
        if (d < (o.kind === "roof" ? 380 : 230)) ogNear.push(o);
      }
    }
    var n = 0, py = P.y || 0;
    for (var k = 0; k < ogNear.length; k++) {
      var q = ogNear[k];
      if (s.og[q.id]) continue;
      var dd = Math.hypot(q.x - P.x, q.z - P.z);
      var hit = q.kind === "roof" ? dd < 7.5 && Math.abs(py - q.y) < 7.5 : dd < 2.6 && Math.abs(py - q.y) < 3.2;
      if (hit && !(FC.inside && FC.inside.active)) { collect(q); continue; }
      ogObj.position.set(q.x, q.y + Math.sin(t * 2 + k) * 0.18, q.z); ogObj.rotation.set(0, t * 1.5 + k, 0);
      var sc = q.kind === "roof" ? 2.2 : 1.1; ogObj.scale.set(sc, sc * (1 + Math.sin(t * 6 + k) * 0.06), sc);
      ogObj.updateMatrix(); ogMesh.setMatrixAt(n++, ogObj.matrix);
      if (n >= 64) break;
    }
    ogMesh.count = n; ogMesh.instanceMatrix.needsUpdate = true;
  }
  function collect(o) {
    var s = sv();
    s.og[o.id] = Date.now(); FC.dirty();
    var n = cnt(s.og);
    snd("cash"); pop("🔥 ОГОНЁК " + n + "/" + OG.length, "#ff9b4a", true);
    if (FC.fx) FC.fx.burst(o.x, o.y, o.z, "sparks", 16);
    FC.money(100, "огонёк");
    FC.emit("secret:ogonek", { n: n });
    if (n === 1) H.toast("Огоньки спрятаны по всему городу — на крышах, во дворах, у воды. Найдёшь все?", "", 4);
    if (n === 10) { FC.money(3000, "10 огоньков"); H.toast("🔥 10 огоньков: +$3 000 и радар огоньков на миникарте (300 м)", "ok", 5); X.ach("sec_og10"); }
    if (n === 25) { FC.money(15000, "25 огоньков"); H.toast("🔥 25 огоньков: +$15 000, радар — до километра", "ok", 5); X.ach("sec_og25"); }
    if (n === OG.length) {
      FC.money(50000, "все огоньки");
      var f = FC.save.flags || (FC.save.flags = {}); f.ogTitle = "Собиратель огня"; FC.dirty();
      H.big("ВСЕ ОГОНЬКИ!", "+$50 000 · звание «Собиратель огня»", "#ffd23f", 4.5); X.ach("sec_og_all_" + CITY);
    }
  }

  /* =========================================================================================================== */
  /* Уникальные прыжки                                                                                             */
  /* =========================================================================================================== */
  var JUMPS = [], jumpMesh = null, jumpObj = new T.Object3D(), jst = null, cine = null;
  // коридор: 40 м разгона и 32 м приземления свободны от домов, воды и столбов
  function corridor(x, z, fx, fz) {
    for (var d = -40; d <= 32; d += 2) {
      var px = x + fx * d, pz = z + fz * d;
      if (M.water(px, pz) || M.buildingAt(px, pz, 1.6)) return false;
      var nr = M.near(px, pz, 3);
      for (var i = 0; i < nr.length; i++) {
        var o = nr[i]; if (!o.prop) continue;
        if (Math.abs((o.x - px) * fz - (o.z - pz) * fx) < 2.6 + o.r && Math.abs((o.x - px) * fx + (o.z - pz) * fz) < 2.2) return false;
      }
    }
    for (var k = 0; k < FC.cars.ramps.length; k++) { var r = FC.cars.ramps[k]; if (!r.uj && Math.hypot(r.x - x, r.z - z) < 50) return false; }
    return true;
  }
  function variants(b) {
    var w = b.x1 - b.x0, d = b.z1 - b.z0, out = [];
    var hs = w >= d ? [Math.PI / 2, -Math.PI / 2, 0, Math.PI] : [0, Math.PI, Math.PI / 2, -Math.PI / 2];
    [0, 0.22, -0.22].forEach(function (o) { hs.forEach(function (h) { out.push({ x: b.cx + (w >= d ? 0 : w * o), z: b.cz + (w >= d ? d * o : 0), h: h }); }); });
    return out;
  }
  function genJumps() {
    var out = [], base = [];
    if (!MINSK) {
      var bz = (M.BEACH_Z0 + M.SEA_LINE) / 2;
      // пляж — длинная полоса песка: трамплины через 170 м вперемешку с парками
      var beach = [], parks = M.blocks.filter(function (b) { return b.kind === "park" || b.kind === "plaza" || b.kind === "shore"; }).sort(byHash("ujp"));
      for (var x = -1020, i = 0; x <= 1020; x += 150, i++) beach.push({ x0: x - 40, x1: x + 40, z0: bz - 20, z1: bz + 20, cx: x, cz: bz + (i % 2 ? 9 : -9), i: "b" + i, name: "Пляж" });
      for (var k = 0; k < Math.max(beach.length, parks.length); k++) { if (parks[k]) base.push(parks[k]); if (beach[k]) base.push(beach[k]); }
    } else {
      M.blocks.filter(function (b) { return b.kind === "park" && Math.max(b.x1 - b.x0, b.z1 - b.z0) > 100 && inR({ x: b.cx, z: b.cz }, 8500) && X.safe(b.cx, b.cz); })
        .sort(byHash("ujm")).forEach(function (b) { base.push(b); });
    }
    spread(base, N_JUMP * 3, MINSK ? 500 : 95, function (b) { return { x: b.cx, z: b.cz, b: b }; }).forEach(function (p) {
      if (out.length >= N_JUMP) return;
      var J = { id: "j" + out.length, b: p.b, name: p.b.name || M.district(p.b.cx, p.b.cz).name, ok: false, r: null };
      if (!MINSK) { if (!placeJump(J)) return; }
      out.push(J);
    });
    return out;
  }
  // ставим трамплин в первый свободный вариант; Минск — когда кусок рядом загружен
  function placeJump(J) {
    var vs = variants(J.b);
    for (var i = 0; i < vs.length; i++) {
      var v = vs[i], fx = Math.sin(v.h), fz = Math.cos(v.h);
      if (corridor(v.x, v.z, fx, fz)) { J.r = { x: v.x, z: v.z, h: v.h, fx: fx, fz: fz, uj: true }; break; }
    }
    if (!J.r) { if (!MINSK) return false; var v0 = vs[0]; J.r = { x: v0.x, z: v0.z, h: v0.h, fx: Math.sin(v0.h), fz: Math.cos(v0.h), uj: true }; }
    J.ok = true; FC.cars.ramps.push(J.r);
    return true;
  }
  function jumpMatrices() {
    if (!jumpMesh) { var cap = []; for (var c = 0; c < N_JUMP; c++) cap.push({ x: 0, z: 0, h: 0 }); jumpMesh = X.rampMesh(cap, "#e11d48", "#ffffff"); jumpMesh.count = 0; G.add(jumpMesh); }
    var n = 0;
    JUMPS.forEach(function (J) { if (!J.ok) return; jumpObj.position.set(J.r.x, 0.18, J.r.z); jumpObj.rotation.set(0, J.r.h, 0); jumpObj.updateMatrix(); jumpMesh.setMatrixAt(n++, jumpObj.matrix); });
    jumpMesh.count = n; jumpMesh.instanceMatrix.needsUpdate = true;
  }
  var jT = 0;
  function jumpTick(dt) {
    var P = FC.player, s = sv();
    jT -= dt;
    if (jT <= 0) {
      jT = 0.5;
      var changed = false;
      JUMPS.forEach(function (J) {
        var d = Math.hypot(J.b.cx - P.x, J.b.cz - P.z);
        if (!J.ok && MINSK && d < 320 && X.loaded(J.b.x0, J.b.z0) && X.loaded(J.b.x1, J.b.z1)) { placeJump(J); changed = true; }
        if (J.ok && d < 90 && !s.seen[J.id]) { s.seen[J.id] = 1; FC.dirty(); }
      });
      if (changed) jumpMatrices();
    }
    var car = P.mode === "car" ? P.car : null;
    if (!car) { jst = null; return; }
    if (car.air && !jst) {
      for (var i = 0; i < JUMPS.length; i++) {
        var J = JUMPS[i]; if (!J.ok) continue;
        if (Math.abs(car.x - J.r.x) < 10 && Math.abs(car.z - J.r.z) < 10) {
          var v = Math.hypot(car.vx, car.vz);
          jst = { J: J, t: 0, x0: car.x, z0: car.z, v: v };
          if (v > 16) {
            if (FC.fx && FC.fx.hitstop) FC.fx.hitstop(1.1, 0.3);
            cine = { car: car, t: 1.6, side: FC.hash(J.id) % 2 ? 1 : -1 };
          }
          break;
        }
      }
    }
    if (jst) {
      if (car.air) jst.t += dt;
      else {
        var dist = Math.hypot(car.x - jst.x0, car.z - jst.z0), J2 = jst.J;
        if (jst.t >= 0.85 && dist >= 20 && !car.wrecked) {
          var first = !s.jumps[J2.id];
          if (first) { s.jumps[J2.id] = Date.now(); FC.dirty(); FC.money(500, "уникальный прыжок"); }
          var n = cnt(s.jumps);
          pop("🎯 ПРЫЖОК " + n + "/" + JUMPS.length, "#ff5d6c", true); snd(first ? "mission" : "cash");
          if (first && n === 1) X.ach("sec_jump_first");
          if (first && n === JUMPS.length) { FC.money(25000, "все прыжки"); H.big("ВСЕ ПРЫЖКИ!", "Каскадёр года · +$25 000", "#ffd23f", 4); X.ach("sec_jumps_all_" + CITY); }
          FC.emit("secret:jump", { n: n });
        } else if (jst.v > 10) pop("НЕ ЗАСЧИТАН: НУЖНО 80+ КМ/Ч", "#ff9aa5");
        jst = null;
      }
    }
  }
  // камера-зевака сбоку на время уникального прыжка (после основной камеры)
  var cineV = new T.Vector3();
  FC.addSystem({ name: "secretcam", order: 98, update: function (dt) {
    if (!cine) return;
    var car = cine.car, P = FC.player;
    cine.t -= dt;
    if (cine.t <= 0 || P.car !== car || (FC.photo && FC.photo.active && FC.photo.active())) { cine = null; return; }
    var fx = Math.sin(car.heading), fz = Math.cos(car.heading), sx = -fz * cine.side, sz = fx * cine.side;
    G.camera.position.set(car.x + sx * 11 + fx * 6, (car.y || 0) + 3.2, car.z + sz * 11 + fz * 6);
    cineV.set(car.x, (car.y || 0) + 1, car.z); G.camera.lookAt(cineV);
  } });

  /* =========================================================================================================== */
  /* Срезки                                                                                                        */
  /* =========================================================================================================== */
  var CUTS = [], cutT = 0;
  function genCuts() {
    var list = M.blocks.filter(function (b) {
      var dg = Math.hypot(b.x1 - b.x0, b.z1 - b.z0);
      return (b.kind === "park" || b.kind === "plaza") && dg > 60 && dg < 280 && inR({ x: b.cx, z: b.cz }, MINSK ? 6000 : 1200) && (!MINSK || X.safe(b.cx, b.cz));
    }).sort(byHash("cut"));
    return spread(list, N_CUT, MINSK ? 600 : 160, function (b) { return { x: b.cx, z: b.cz, b: b }; }).map(function (p, i) {
      var b = p.b, flip = FC.hash("cf" + i) % 2;
      return { id: "c" + i, a: { x: b.x0 + 6, z: flip ? b.z1 - 6 : b.z0 + 6 }, b: { x: b.x1 - 6, z: flip ? b.z0 + 6 : b.z1 - 6 }, len: Math.hypot(b.x1 - b.x0, b.z1 - b.z0), hit: null, t: 0 };
    });
  }
  function cutTick(dt) {
    var P = FC.player; if (P.mode !== "car" || !P.car) return;
    var v = Math.hypot(P.car.vx, P.car.vz), now = performance.now() / 1000, s = sv();
    cutT -= dt; if (cutT > 0) return; cutT = 0.1;
    for (var i = 0; i < CUTS.length; i++) {
      var C = CUTS[i];
      if (Math.abs(C.a.x - P.x) > C.len + 20 || Math.abs(C.a.z - P.z) > C.len + 20) continue;
      var da = Math.hypot(P.x - C.a.x, P.z - C.a.z), db = Math.hypot(P.x - C.b.x, P.z - C.b.z);
      if (v > 10 && (da < 9 || db < 9)) {
        var at = da < 9 ? "a" : "b";
        if (C.hit && C.hit !== at && now - C.t < C.len / 8 + 4) {
          C.hit = null;
          var first = !s.cuts[C.id];
          if (first) { s.cuts[C.id] = Date.now(); FC.dirty(); FC.money(250, "срезка"); }
          pop("↗️ СРЕЗКА " + cnt(s.cuts) + "/" + CUTS.length, "#6bd5ff", true);
          if (first && cnt(s.cuts) === CUTS.length) X.ach("sec_cuts_" + CITY);
        } else if (!C.hit || C.hit === at || now - C.t > C.len / 8 + 4) { C.hit = at; C.t = now; }
      }
    }
  }

  /* =========================================================================================================== */
  /* Пасхалки                                                                                                      */
  /* =========================================================================================================== */
  // НЛО: 3:00–3:59, дождь; над озером (Флейм-Сити — Комсомольское, Минск — у Чижовки)
  var ufo = null, UFO_AT = MINSK ? { x: 3420, z: 6420 } : { x: M.LAKE.x, z: M.LAKE.z };
  function ufoMesh() {
    var g = new T.Group();
    var disc = new T.Mesh(new T.SphereGeometry(6, 20, 8), new T.MeshStandardMaterial({ color: 0xb8c4d0, metalness: 0.85, roughness: 0.25 }));
    disc.scale.set(1, 0.22, 1); g.add(disc);
    var dome = new T.Mesh(new T.SphereGeometry(2.4, 16, 8, 0, 6.283, 0, 1.6), new T.MeshBasicMaterial({ color: 0x7dffb0, transparent: true, opacity: 0.6, toneMapped: false }));
    dome.position.y = 0.8; g.add(dome);
    for (var i = 0; i < 8; i++) { var l = new T.Mesh(new T.SphereGeometry(0.35, 6, 4), new T.MeshBasicMaterial({ color: i % 2 ? 0xff5d8f : 0x6bd5ff, toneMapped: false })); l.position.set(Math.cos(i / 8 * 6.283) * 5.6, -0.2, Math.sin(i / 8 * 6.283) * 5.6); g.add(l); }
    var beam = new T.Mesh(new T.CylinderGeometry(1.2, 7, 60, 16, 1, true).translate(0, -30, 0), new T.MeshBasicMaterial({ color: 0x9dffbf, transparent: true, opacity: 0.12, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, toneMapped: false }));
    g.add(beam);
    return g;
  }
  function ufoTick(dt) {
    var want = FC.clock.hour === 3 && G.weather.rain > 0.4 && !ufo;
    if (want) { ufo = { g: ufoMesh(), t: 0, gone: 0 }; ufo.g.position.set(UFO_AT.x, 70, UFO_AT.z); G.add(ufo.g); }
    if (!ufo) return;
    var P = FC.player, t = performance.now() / 1000;
    ufo.t += dt;
    if (!ufo.gone) {
      ufo.g.position.set(UFO_AT.x + Math.sin(t * 0.4) * 30, 70 + Math.sin(t * 1.3) * 3, UFO_AT.z + Math.cos(t * 0.3) * 30);
      ufo.g.rotation.y += dt * 1.2;
      var d = Math.hypot(P.x - ufo.g.position.x, P.z - ufo.g.position.z);
      if (d < 70 && (P.mode === "air" || d < 40)) { ufo.gone = 0.01; egg("ufo", "Они среди нас"); }
    } else {
      ufo.gone += dt; ufo.g.position.y += dt * (40 + ufo.gone * 120); ufo.g.position.x += dt * 80;
      if (ufo.gone > 3) { G.scene.remove(ufo.g); ufo.g.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); ufo = null; }
    }
    if (ufo && !ufo.gone && FC.clock.hour !== 3) { ufo.gone = 0.01; }
  }
  FC.on("photo:shot", function (e) {
    if (ufo && !ufo.gone && e && e.see) { var p = ufo.g.position; if (e.see(p.x, p.y, p.z)) { egg("ufo", "Они среди нас"); ufo.gone = 0.01; } }
  });

  // машина-призрак: после полуночи (0–4 ч), изредка рядом с игроком; растворяется при приближении
  var ghost = null, ghostCd = 30, ghostMat = null;
  function ghostMesh() {
    if (!ghostMat) ghostMat = new T.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.28, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false });
    var g = new T.Group();
    var b = new T.Mesh(new T.BoxGeometry(1.9, 0.8, 4.8), ghostMat); b.position.y = 0.75; g.add(b);
    var c = new T.Mesh(new T.BoxGeometry(1.6, 0.6, 2.4), ghostMat); c.position.set(0, 1.45, -0.3); g.add(c);
    var wg = new T.CylinderGeometry(0.38, 0.38, 0.25, 10).rotateZ(Math.PI / 2);
    [[-0.95, 1.5], [0.95, 1.5], [-0.95, -1.5], [0.95, -1.5]].forEach(function (p) { var w = new T.Mesh(wg, ghostMat); w.position.set(p[0], 0.38, p[1]); g.add(w); });
    return g;
  }
  function ghostTick(dt) {
    var P = FC.player, h = FC.clock.hour;
    if (!ghost) {
      ghostCd -= dt;
      if (ghostCd > 0 || h >= 4 || P.mode === "air" || (FC.inside && FC.inside.active) || !FC.story || !FC.story.driver || (X.active && X.active())) return;
      ghostCd = 70 + Math.random() * 90;
      if (Math.random() > 0.5) return;
      var g = ghostMesh(); G.add(g);
      var a = Math.random() * 6.283;
      ghost = { g: g, D: FC.story.driver(g, P.x + Math.cos(a) * 70, P.z + Math.sin(a) * 70, 13), t: 0, fade: 0 };
      return;
    }
    ghost.t += dt;
    ghost.D.step(dt);
    var d = Math.hypot(P.x - ghost.D.x, P.z - ghost.D.z);
    if (!ghost.fade && (d < 13 || ghost.t > 40 || h >= 4)) { ghost.fade = 0.01; if (d < 13) egg("ghost", "Призрак проспекта"); }
    if (ghost.fade) {
      ghost.fade += dt; ghostMat.opacity = Math.max(0, 0.28 * (1 - ghost.fade / 1.5));
      if (ghost.fade > 1.5) { G.scene.remove(ghost.g); ghost.g.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); ghost = null; ghostMat.opacity = 0.28; }
    } else ghostMat.opacity = 0.2 + Math.sin(ghost.t * 7) * 0.08;
  }

  // говорящий голубь: Флейм-Сити — парк у центра, Минск — Верхний город (площадь Свободы)
  var PIGEON = null;
  function placePigeon() {
    var at;
    if (MINSK) at = { x: -1548, z: -470 };
    else { var b = M.blocks.filter(function (k) { return k.kind === "park"; }).sort(function (p, q) { return Math.hypot(p.cx, p.cz) - Math.hypot(q.cx, q.cz); })[0]; at = b ? { x: b.cx + 6, z: b.cz - 4 } : { x: 40, z: 60 }; }
    var g = new T.Group(), body = new T.MeshStandardMaterial({ color: 0x8b93a1, roughness: 0.8 }), neck = new T.MeshStandardMaterial({ color: 0x4b7f6b, roughness: 0.5, metalness: 0.3 });
    var b1 = new T.Mesh(new T.SphereGeometry(0.22, 10, 8), body); b1.scale.set(1, 0.85, 1.4); b1.position.y = 0.28; g.add(b1);
    var hd = new T.Mesh(new T.SphereGeometry(0.12, 8, 6), neck); hd.position.set(0, 0.48, 0.2); g.add(hd);
    var bk = new T.Mesh(new T.ConeGeometry(0.03, 0.09, 5).rotateX(Math.PI / 2), new T.MeshStandardMaterial({ color: 0xe8b04a })); bk.position.set(0, 0.47, 0.33); g.add(bk);
    var st = new T.Mesh(new T.CylinderGeometry(0.35, 0.4, 0.5, 10), new T.MeshStandardMaterial({ color: 0x9a9286, roughness: 0.9 })); st.position.y = -0.25; g.add(st);
    b1.position.y += 0.5; hd.position.y += 0.5; bk.position.y += 0.5; st.position.y += 0.5;
    g.scale.setScalar(2.4); g.position.set(at.x, 0, at.z); G.add(g);
    PIGEON = { g: g, at: at, n: 0, hd: hd };
    var TALK = [
      "Курлык. Не пугайся — я просто начитанный голубь.",
      "Огоньки прячутся там, где люди не смотрят: на крышах, во дворах, у воды. С вертолёта видно больше.",
      "Таксисты Огонька возят даром, если поставить точку на карте и свистнуть рядом с такси — E. Одну звезду они «не замечают».",
      "В Башне Флейм на " + ROOM_TXT + " есть дверь без таблички. Я туда залетал. Больше не скажу.",
      "В три часа ночи, когда моросит, над озером кто-то светит. Это не я.",
      "В телефоне, в «Миссиях», пять раз тапни по номеру версии. Там… коды. Курлык.",
      "Автомат «Огонёк-кола» лечит лучше больницы — и дешевле.",
      "Где-то во дворах есть гараж без вывески. Ключи — под ковриком.",
      "Красно-белые трамплины — особые. Разгонись до 80 и лети."
    ];
    FC.interact.add({ id: "sec-pigeon", x: at.x, z: at.z, r: 2.6, label: "🐦 Поговорить с голубем", act: function () {
      var t = TALK[PIGEON.n % TALK.length]; PIGEON.n++;
      H.dialog([{ who: "Голубь Гуля", text: t, face: "🐦" }]);
      if (PIGEON.n >= 3) egg("pigeon", "Голубь-мудрец");
    } });
  }

  // дверь без таблички: Башня, 42-й этаж (floor 41)
  // дверь — у места, где игрок вышел из лифта на этом этаже (интерьер строится заново, своих координат у двери нет)
  var roomSpot = null;
  function placeRoom() {
    var B = M.hq; if (!B || (B.floors || 0) < 4) return;
    FC.interact.provider(function (px, pz, room) {
      if (room !== B.id || !roomSpot || Math.hypot(px - roomSpot.x, pz - roomSpot.z) > 4) return null;
      return [{ id: "sec-room", x: px, z: pz, r: 1, room: B.id, label: "🚪 Дверь без таблички", act: openRoom }];
    });
  }
  function roomTick() {
    var I2 = FC.inside, B = M.hq;
    var on = I2 && I2.active && I2.building === B && I2.floor === ROOM_FL;
    if (!on) { roomSpot = null; return; }
    if (!roomSpot) roomSpot = { x: FC.player.x, z: FC.player.z };
  }
  function openRoom() {
    H.dialog([{ who: "Табличка внутри", text: "«Комната разработчиков. Здесь делают Флейм-Сити — ночью, с огоньком».", face: "🛠️" },
      { who: "Записка на столе", text: "Если ты это читаешь — спасибо, что ищешь. Держи на кофе. P.S. Голубь всё врёт про НЛО. Или нет.", face: "📝" }],
    function () { if (egg("room", "Комната без таблички")) FC.money(5000, "секретная комната"); });
  }

  /* =========================================================================================================== */
  /* Лайфхаки: тайный гараж, автоматы, бесплатное такси                                                           */
  /* =========================================================================================================== */
  var GARAGE = null;
  function placeGarage() {
    var at;
    if (MINSK) at = { x: -560, z: 1010, fix: true };
    else {
      var blk = M.blocks.filter(function (b) { return b.kind === "city" && b.dist && b.dist.key === "msk"; }).sort(byHash("garage"));
      for (var i = 0; i < blk.length && !at; i++) { var p = courtyard(blk[i]); if (p) at = p; }
      at = at || { x: -600, z: -200 };
    }
    GARAGE = { at: at, fix: !!at.fix, mesh: null };
    if (!GARAGE.fix) buildGarage();
  }
  function buildGarage() {
    var at = GARAGE.at, g = new T.Group();
    var tex = G.tex.canvas(128, 128, function (x, w, h) { x.fillStyle = "#6b7078"; x.fillRect(0, 0, w, h); x.fillStyle = "#565b62"; for (var i = 0; i < 12; i++) x.fillRect(0, i * 11, w, 5); x.fillStyle = "#ffcf3f"; x.font = "900 20px system-ui"; x.textAlign = "center"; x.fillText("№ 42", w / 2, 116); });
    var box = new T.Mesh(new T.BoxGeometry(6, 3.4, 7), G.mat.std(0x8a8172, 0.9)); box.position.y = 1.7; g.add(box);
    var door = new T.Mesh(new T.PlaneGeometry(4.6, 2.8), new T.MeshStandardMaterial({ map: tex, roughness: 0.7 })); door.position.set(0, 1.45, 3.51); g.add(door);
    var nl = M.nearestLane(at.x, at.z), face = nl ? Math.atan2(nl.x - at.x, nl.z - at.z) : 0;
    g.position.set(at.x, 0, at.z); g.rotation.y = face; G.add(g);
    GARAGE.mesh = g; GARAGE.face = face;
    var dx = at.x + Math.sin(face) * 5, dz = at.z + Math.cos(face) * 5;
    FC.interact.add({ id: "sec-garage", x: dx, z: dz, r: 3, label: "🔧 Гараж без вывески", act: function () {
      var s = sv();
      if (s.garageDay === FC.clock.day) { H.toast("Пусто. Хозяин сказал: «Верни до утра» — машина уже у тебя", "", 3); return; }
      s.garageDay = FC.clock.day; FC.dirty();
      var car = FC.cars.spawn("hyper", dx + Math.sin(face) * 3, dz + Math.cos(face) * 3, face, { owned: true, color: 0xff6a1a });
      if (car) { H.toast("🔑 Ключи под ковриком. «Эфир Гиперион» твой до утра — 338 км/ч", "ok", 4); egg("garage", "Тайный гараж"); }
    } });
  }

  var COLA = [], colaMesh = null;
  function placeCola() {
    var spots = [];
    if (MINSK) {
      var mt = (M.metro || []).map(function (m) { return { x: m[1] != null ? m[1] : m.x, z: m[2] != null ? m[2] : m.z, name: m[0] }; })
        .filter(function (m) { return inR(m, 5000); }).sort(function (a, b) { var c = centerOf(); return Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z); });
      spots = mt.slice(0, 6).map(function (m) { return { x: m.x + 9, z: m.z + 5, fix: true }; });
    } else {
      var pc = { x: (M.plaza.x0 + M.plaza.x1) / 2, z: (M.plaza.z0 + M.plaza.z1) / 2 }, d = M.hq.doors[0];
      [[pc.x - 30, pc.z + 20], [d.x + d.nx * 6 + 4, d.z + d.nz * 6], [0, M.BEACH_Z0 + 4], [M.LAKE.x - M.LAKE.r - 6, M.LAKE.z], [M.DIST.msk.x, M.DIST.msk.z], [M.DIST.ala.x, M.DIST.ala.z]].forEach(function (q) {
        var sp = M.sidewalkPoint(FC.rng(FC.hash("cola" + q[0])), q[0], q[1], 40); spots.push(sp ? { x: sp.x, z: sp.z } : { x: q[0], z: q[1] });
      });
    }
    COLA = spots;
    var body = new T.MeshStandardMaterial({ color: 0xc81e1e, roughness: 0.5 });
    var tex = G.tex.canvas(64, 128, function (x, w, h) { x.fillStyle = "#1a0505"; x.fillRect(0, 0, w, h); x.fillStyle = "#ff8a2a"; x.font = "900 34px system-ui"; x.textAlign = "center"; x.fillText("🔥", w / 2, 46); x.fillStyle = "#fff"; x.font = "800 11px system-ui"; x.fillText("ОГОНЁК", w / 2, 74); x.fillText("КОЛА", w / 2, 88); x.fillStyle = "#ffcf3f"; x.fillRect(10, 100, w - 20, 8); });
    colaMesh = { body: new T.InstancedMesh(new T.BoxGeometry(1, 2, 0.8), body, 6), front: new T.InstancedMesh(new T.PlaneGeometry(0.8, 1.7), new T.MeshBasicMaterial({ map: tex, toneMapped: false }), 6) };
    colaMesh.body.count = 0; colaMesh.front.count = 0; colaMesh.body.frustumCulled = colaMesh.front.frustumCulled = false;
    G.add(colaMesh.body); G.add(colaMesh.front);
    colaMatrices();
    FC.interact.provider(function (px, pz, room) {
      if (room != null || FC.player.mode !== "foot") return null;
      for (var i = 0; i < COLA.length; i++) {
        var c = COLA[i]; if (c.fix || Math.abs(c.x - px) > 3 || Math.abs(c.z - pz) > 3) continue;
        return [{ id: "sec-cola" + i, x: c.x, z: c.z, r: 2.2, key: "use", label: "🥤 «Огонёк-кола» — $5: здоровье до максимума", act: drinkCola }];
      }
      return null;
    });
  }
  function colaMatrices() {
    var o = new T.Object3D(), n = 0;
    COLA.forEach(function (c) {
      if (c.fix) return;
      var nl = M.nearestLane(c.x, c.z), f = nl ? Math.atan2(nl.x - c.x, nl.z - c.z) : 0; c.f = f;
      o.position.set(c.x, 1, c.z); o.rotation.set(0, f, 0); o.scale.set(1, 1, 1); o.updateMatrix(); colaMesh.body.setMatrixAt(n, o.matrix);
      o.position.set(c.x + Math.sin(f) * 0.41, 1.05, c.z + Math.cos(f) * 0.41); o.updateMatrix(); colaMesh.front.setMatrixAt(n, o.matrix);
      n++;
    });
    colaMesh.body.count = colaMesh.front.count = n;
    colaMesh.body.instanceMatrix.needsUpdate = colaMesh.front.instanceMatrix.needsUpdate = true;
  }
  function drinkCola() {
    var P = FC.player;
    if (P.hp >= P.maxHp) { H.toast("Ты и так полон сил. Автомат подмигнул 🔥", "", 2); return; }
    if (FC.money(-5, "«Огонёк-кола»") === false) { H.toast("Нужно $5", "bad", 2); return; }
    P.hp = P.maxHp; snd("pop"); pop("🥤 ЗДОРОВЬЕ — МАКС", "#7dffb0");
    var s = sv(); s.cola = (s.cola || 0) + 1; FC.dirty();
  }

  // бесплатное такси: у остановившегося такси с водителем — E «свистнуть» (F — как всегда, угнать); метка на карте — куда
  function isTaxi(c) { return c.type === "taxi" && c.driver === "ai" && !c.wrecked && Math.hypot(c.vx, c.vz) < 2.5; }
  var taxiHintT = 0;
  function taxiTick(dt) {
    var P = FC.player, cur = FC.interact.current && FC.interact.current();
    taxiHintT -= dt;
    if (P.mode !== "foot" || P.dead || !cur || !/^car_/.test(cur.id || "")) return;
    var car = FC.cars.nearestTo(P.x, P.z, 4.5, isTaxi);
    if (!car) return;
    if (taxiHintT <= 0 && FC.markers.all.wp) { taxiHintT = 90; H.help("Говорят, таксисты «Огонька» возят даром: <b>E</b> — свистнуть", 4); }
    if (FC.input.pressed("use")) { if (FC.input.consume) FC.input.consume("use"); taxiRide(car); }
  }
  function taxiRide(car) {
    var wp = FC.markers.all.wp, stars = FC.police ? FC.police.stars : 0;
    if (!wp) { H.toast("Таксист: «Куда едем? Поставь точку на карте — довезу»", "", 3); return; }
    if (stars >= 2) { H.toast("Таксист: «С такими звёздами — не повезу. Ищи другого»", "bad", 3); return; }
    if (X.active && X.active()) { H.toast("Таксист: «Сначала закончи свои дела»", "", 2.5); return; }
    var P = FC.player, sp = M.sidewalkPoint(FC.rng(FC.hash("taxi" + Math.round(wp.x))), wp.x, wp.z, 60) || { x: wp.x, z: wp.z };
    document.body.classList.add("warp"); snd("door");
    setTimeout(function () {
      P.teleport(sp.x, sp.z);
      document.body.classList.remove("warp");
      if (stars === 1 && FC.police) { FC.police.clear(); H.toast("Таксист не сдаёт клиентов — звезда погасла", "ok", 3); }
      H.toast("🚕 Бесплатно: акция «Огонёк возит»", "ok", 3);
      FC.markers.remove("wp");
      egg("taxi", "Таксист не сдаёт");
      FC.emit("travel", { x: sp.x, z: sp.z });
    }, 900);
  }

  /* =========================================================================================================== */
  /* Читы                                                                                                          */
  /* =========================================================================================================== */
  var big = { on: false, bones: [] };
  var CHEATS = {
    "ОГОНЬ": { t: "салют", fn: function () { var P = FC.player; for (var i = 0; i < 6; i++) setTimeout(function () { var x = P.x + (Math.random() - 0.5) * 60, z = P.z + (Math.random() - 0.5) * 60, y = 30 + Math.random() * 25; if (FC.fx) { FC.fx.burst(x, y, z, "confetti", 50); FC.fx.burst(x, y, z, "sparks", 30); FC.fx.flash("#ffcf7a", 0.15); } snd("pop"); }, i * 380); } },
    "ДОЖДЬ": { t: "дождь", fn: function () { G.weather.target = 1; } },
    "СОЛНЦЕ": { t: "ясно", fn: function () { G.weather.target = 0; } },
    "НОЧЬ": { t: "ночь", fn: function () { FC.setHour(2); } },
    "ДЕНЬ": { t: "день", fn: function () { FC.setHour(12); } },
    "МЕДЛЕННО": { t: "замедление", toggle: "slow" },
    "ГОЛОВА": { t: "большие головы", toggle: "heads" },
    "ТАЧКА": { t: "суперкар рядом", fn: function () { var P = FC.player, l = X.lane(P.x + Math.sin(P.heading) * 8, P.z + Math.cos(P.heading) * 8); FC.cars.spawn("tauro", l.x, l.z, l.h, { color: 0xffd23f }); } },
    "ВЕРТОЛЁТ": { t: "вертолёт рядом", fn: function () { var P = FC.player, s = X.spot(P.x + 14, P.z + 14, 60, 6); FC.air.spawn("heli_light", s.x, s.z, 0); } },
    "БРОНЯ": { t: "здоровье и броня", fn: function () { var P = FC.player; P.hp = P.maxHp; var a = FC.save.arsenal; if (a) { a.armor = 100; FC.dirty(); } } },
    "ЧИСТО": { t: "розыск снят", fn: function () { if (FC.police) FC.police.clear(); } }
  };
  var TOG = { slow: false, heads: false };
  function applyCheat(raw) {
    var code = String(raw || "").trim().toUpperCase().replace(/Ё/g, "Е").replace(/\s+/g, "");
    var key = Object.keys(CHEATS).filter(function (k) { return k.replace(/Ё/g, "Е") === code; })[0];
    if (!key) { H.toast("Неверный код", "bad", 1.8); return false; }
    var C = CHEATS[key], s = sv();
    if (C.toggle) {
      TOG[C.toggle] = !TOG[C.toggle];
      X.cheat(C.toggle, TOG[C.toggle], 0);
      if (C.toggle === "heads" && !TOG.heads) resetHeads();
      H.toast("⌨️ Чит «" + C.t + "» — " + (TOG[C.toggle] ? "вкл" : "выкл"), "ok", 2.5);
    } else {
      try { C.fn(); } catch (e) { /* чит не должен ронять игру */ }
      X.cheat(key, null, 180);
      H.toast("⌨️ Чит: " + C.t + " · медали и достижения — 3 минуты без зачёта", "ok", 3);
    }
    s.cheats = s.cheats || {}; s.cheats[key] = 1; FC.dirty();
    snd("whoop");
    return true;
  }
  // замедление — множитель поверх стоп-кадра fjuice (цикл fmain берёт FC.fx.timeScale() каждый кадр)
  if (FC.fx && FC.fx.timeScale) { var ts0 = FC.fx.timeScale; FC.fx.timeScale = function () { return ts0() * (TOG.slow ? 0.5 : 1); }; }
  // большие головы: кость головы у ближнего яруса людей (рендер дальнего — запечённая текстура, его не трогаем)
  function headsTick() {
    if (!TOG.heads || !FC.humans || !FC.humans.bones) return;
    var all = FC.people.all;
    for (var i = 0; i < all.length; i++) {
      var bs = FC.humans.bones(all[i]); if (!bs) continue;
      for (var k = 0; k < bs.length; k++) {
        if (!/head$/i.test(bs[k].name)) continue;
        bs[k].scale.set(2.2, 2.2, 2.2);
        if (big.bones.indexOf(bs[k]) < 0) big.bones.push(bs[k]);
      }
    }
  }
  function resetHeads() { big.bones.forEach(function (b) { b.scale.set(1, 1, 1); }); big.bones.length = 0; }

  /* =========================================================================================================== */
  /* Слухи прохожих (ftalk) — без точных мест                                                                      */
  /* =========================================================================================================== */
  function rumors() {
    if (!FC.talk || !FC.talk.lines) return;
    FC.talk.lines.news.push({ t: ["Говорят, по городу спрятаны огоньки. Полсотни! Кто соберёт все — тому звание.",
      "Мой брат нашёл огонёк на крыше. На вертолёте летал, представляешь?", "Видел красно-белые трамплины? Говорят, особые — с них летишь как в кино.",
      "Ночью, в три, когда моросит, над озером что-то висит. Я трезвый был!", "После полуночи по улицам ездит машина без водителя. Прозрачная.",
      "Голубь в парке разговаривает. Честно! Спроси его сам."], w: 2 });
    FC.talk.lines.tip.push({ t: ["Таксисты «Огонька» возят бесплатно — поставь точку на карте и свистни у такси.",
      "Автомат «Огонёк-кола» лечит лучше больницы. И дешевле.", "Через парки можно срезать — если гнать, засчитают срезку.",
      "В «Миссиях» в телефоне, говорят, есть секретные коды. Тапни по версии пять раз.", "В Башне Флейм на " + ROOM_TXT + " есть дверь без таблички.",
      "Где-то во дворах есть гараж без вывески. Ключи под ковриком — для своих."], w: 2 });
  }

  /* =========================================================================================================== */
  /* Телефон: раздел «Секреты» внутри «Миссий» + скрытое поле кодов                                               */
  /* =========================================================================================================== */
  var taps = 0;
  function renderApp(el, ui) {
    if (!el) return;
    var s = sv();
    var eggsN = cnt(s.eggs), eggsTotal = 6;
    el.innerHTML = "<div class='card'><b>Секреты · " + esc(FC.cityName) + "</b><p>🔥 Огоньки " + cnt(s.og) + "/" + OG.length + " · 🎯 Прыжки " + cnt(s.jumps) + "/" + JUMPS.length +
      " · ↗️ Срезки " + cnt(s.cuts) + "/" + CUTS.length + " · 🥚 Пасхалки " + eggsN + "/" + eggsTotal + "</p>" +
      "<p class='quiet'>Огоньки — на крышах, во дворах, у воды. Прыжки — красно-белые трамплины, 80+ км/ч. Прохожие знают слухи — поговори.</p></div>" +
      "<div class='row'><span class='quiet' data-v='1' style='cursor:default'>Флейм-Сити · версия 1.0.42</span></div><div class='cheat-slot'></div>";
    var v = el.querySelector("[data-v]");
    v.addEventListener("click", function () {
      taps++;
      if (taps < 5) return;
      taps = 0;
      var slot = el.querySelector(".cheat-slot");
      slot.innerHTML = "<div class='row'><input type='text' maxlength='16' placeholder='Код' style='flex:1;border-radius:10px;padding:8px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.3);color:#fff;font:700 15px system-ui'><button type='button'>OK</button></div>" +
        "<p class='quiet' style='font-size:12px'>Пока действует код — медали и достижения не засчитываются.</p>";
      var inp = slot.querySelector("input"), ok = slot.querySelector("button");
      var go = function () { if (applyCheat(inp.value)) { inp.value = ""; } };
      ok.addEventListener("click", go);
      inp.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") go(); });
      inp.focus();
    });
  }

  /* =========================================================================================================== */
  /* Карта: радар огоньков (после 10), найденные прыжки                                                           */
  /* =========================================================================================================== */
  H.addMapLayer(function (c, k, mode) {
    var s = sv(), n = cnt(s.og), P = FC.player; if (!P) return;
    if (mode === "big" && FC.hud.mapTier(k) < 2) return;        // находки — с приближения, издалека не засоряют карту
    c.save();
    if (n >= 10) {
      var R = n >= 25 ? 1000 : 300;
      c.fillStyle = "rgba(255,138,42,.9)";
      for (var i = 0; i < OG.length; i++) { var o = OG[i]; if (s.og[o.id] || Math.hypot(o.x - P.x, o.z - P.z) > R) continue; c.beginPath(); c.arc(o.x, o.z, (mode === "big" ? 5 : 3.5) / k, 0, 7); c.fill(); }
    }
    var sz = (mode === "big" ? 7 : 5) / k;
    JUMPS.forEach(function (J) {
      if (!J.ok || !s.seen[J.id]) return;
      c.fillStyle = s.jumps[J.id] ? "rgba(125,255,176,.9)" : "rgba(225,29,72,.95)";
      c.save(); c.translate(J.r.x, J.r.z); c.rotate(-J.r.h);
      c.beginPath(); c.moveTo(0, sz); c.lineTo(sz * 0.8, -sz); c.lineTo(-sz * 0.8, -sz); c.closePath(); c.fill(); c.restore();
    });
    c.restore();
  });

  /* =========================================================================================================== */
  /* Старт и кадр                                                                                                  */
  /* =========================================================================================================== */
  var ready = false, fixT = 0;
  FC.on("start", function () {
    try {
      OG = genOgonki(); buildOgMesh();
      JUMPS = genJumps(); jumpMatrices();
      CUTS = genCuts();
      placePigeon(); placeRoom(); placeGarage(); placeCola();
      rumors();
      ready = true;
    } catch (e) { if (global.console) console.error("secrets init", e); }
  });
  FC.addSystem({ name: "secrets", order: 60, update: function (dt) {
    if (!ready || !FC.player) return;
    ogTick(dt); jumpTick(dt); cutTick(dt); ufoTick(dt); ghostTick(dt); headsTick(); taxiTick(dt); roomTick();
    if (PIGEON) { var t = performance.now() / 1000; PIGEON.hd.position.y = 0.98 + Math.max(0, Math.sin(t * 3)) * 0.05; PIGEON.g.rotation.y = Math.sin(t * 0.7) * 0.8; }
    // Минск: гараж и автоматы ставим, когда кусок рядом загружен (дома известны)
    fixT -= dt;
    if (fixT <= 0) {
      fixT = 1;
      var P = FC.player, ch = false;
      if (GARAGE && GARAGE.fix && X.loaded(GARAGE.at.x, GARAGE.at.z) && Math.hypot(P.x - GARAGE.at.x, P.z - GARAGE.at.z) < 300) { GARAGE.fix = false; var g = X.spot(GARAGE.at.x, GARAGE.at.z, 80, 5); GARAGE.at = g; buildGarage(); }
      COLA.forEach(function (c) { if (c.fix && X.loaded(c.x, c.z) && Math.hypot(P.x - c.x, P.z - c.z) < 300) { c.fix = false; var q = X.spot(c.x, c.z, 40, 1.2); c.x = q.x; c.z = q.z; ch = true; } });
      if (ch) colaMatrices();
    }
  } });

  FC.secrets = {
    renderApp: renderApp, cheat: applyCheat, cheats: Object.keys(CHEATS),
    ogonki: function () { return OG; }, jumps: function () { return JUMPS; }, cuts: function () { return CUTS; },
    state: sv, garage: function () { return GARAGE; }, cola: function () { return COLA; }, pigeon: function () { return PIGEON && PIGEON.at; }, ufoAt: UFO_AT
  };
})(window);
