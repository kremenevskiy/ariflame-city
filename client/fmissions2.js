/* Флейм-Сити — одиннадцать миссий с медалями (движок — fmissions.js). Оба города; маршруты — по данным карты и
 * детерминированы (рекорды у всех сравнимы), в Минске — у настоящих ориентиров OSM, но никогда не у госзданий и
 * мемориалов (они — тихие зоны), без настоящих брендов и символики. Пороги медалей — от длины маршрута (formula в
 * medals(plan)): у каждого города свои, в приложении «Миссии» видны до старта.
 *
 *   🚁 tour     «Над городом»       — экскурсия на вертолёте: кольца над ориентирами, рассказчик, фото-бонус (−10 с)
 *   🆘 rescue   «Вертолёт спасения» — сесть на крышу, забрать троих, доставить на площадку больницы
 *   📦 cargo    «Груз на тросе»     — подцепить контейнер, донести, не разбив о стены и землю (маятник)
 *   🪂 skydive  «Прыжок»            — из «Кукурузника»: свободное падение, купол, точность приземления
 *   🏍️ courier  «Курьер-молния»     — супербайк по проспектам через контрольные точки, удары — штраф
 *   💅 vip      «VIP-клиент»        — такси для звезды рилсов, шкала настроения: трюки радуют, удары злят
 *   🏁 race     «Уличная гонка»     — три соперника на маршруте (догоняют и подтормаживают — «резинка»), место = медаль
 *   🤸 stunts   «Каскадёр»          — пять трамплинов на перекрытой улице по порядку
 *   💰 getaway  «Водитель налёта»   — забрать команду, тихо или громко, оторваться от «Щита» и в гараж
 *   💥 crash    «Краш-тест»         — 60 секунд видеорегистратора: очки за силу ударов и комбо
 *   🛸 drones   «Дроны СкукаСофт»   — сюжет: перехватить на вертолёте дроны, ворующие идеи агентов
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE, M = FC.map, G = FC.gfx, X = FC.mis;
  if (!X || !FC.cars || !FC.air) return;
  var H = FC.hud, I = FC.input, MINSK = !!M.minsk;
  var tv = { x: 0, z: 0, h: 0 };                      // переиспользуемая точка (без аллокаций в кадре)

  function P() { return FC.player; }
  function d2(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  function d3(ax, ay, az, bx, by, bz) { var dx = ax - bx, dy = ay - by, dz = az - bz; return Math.sqrt(dx * dx + dy * dy + dz * dz); }
  function spd() { var p = P(); if (p.mode === "car" && p.car) return Math.hypot(p.car.vx, p.car.vz); if (p.mode === "air" && p.air) return Math.hypot(p.air.vx, p.air.vz); return Math.hypot(p.vx || 0, p.vz || 0); }
  function ogo(text) { return { who: FC.MASCOT.name, text: text, face: "mascot" }; }
  function say(who, face, text) { return { who: who, text: text, face: face }; }
  function pop(t, col, big) { if (H.popup) H.popup(t, { color: col || "#ffcf7a", big: !!big }); }
  function snd(n, o) { if (FC.audio) FC.audio.play(n, o); }
  function gnd(x, z) { return FC.air.ground ? FC.air.ground(x, z).h : 0; }
  // тротуар у точки (детерминированно по координатам) — туда ставим метку старта
  function sw(x, z) {
    var sp = M.sidewalkPoint(FC.rng(FC.hash("mis" + Math.round(x) + ":" + Math.round(z))), x, z, 50);
    return sp ? { x: sp.x, z: sp.z } : X.lane(x, z);
  }
  function plazaC() { var p = M.plaza; return { x: (p.x0 + p.x1) / 2, z: (p.z0 + p.z1) / 2 }; }
  function doorOf(B, k) { var d = B.doors[k || 0] || B.doors[0]; return { x: d.x + d.nx * 3, z: d.z + d.nz * 3 }; }
  function nodeAt(x, z, rMin, rMax, want) {
    var best = null, bd = 1e18;
    M.nodes.forEach(function (n) { var d = Math.hypot(n.x - x, n.z - z); if (d < rMin || d > rMax) return; var q = Math.abs(d - want); if (q < bd) { bd = q; best = n; } });
    return best ? { x: best.x, z: best.z } : { x: x + want, z: z };
  }
  // точка маршрута с продолжением назад за старт (стартовая решётка гонки)
  function pathAt(p, s, out) {
    if (s >= 0) return X.polyAt(p, s, out);
    X.polyAt(p, 0, out);
    out.x -= Math.sin(out.h) * -s; out.z -= Math.cos(out.h) * -s;
    return out;
  }
  // Минск: ориентиры (координаты — research/minsk-landmarks-coords.json; госздания и мемориалы сюда не входят)
  var MK = { library: [4337, -3447], mayak: [4795, -3389], nemiga: [-2126, -164], upper: [-1562, -449], trinity: [-1539, -927],
    kolas: [187, -1720], academy: [1207, -2244], arena: [-6453, -3985], world: [-2372, 3864], gates: [-1867, 889], oktyabr: [-617, 964],
    gorky: [-438, -344], uruchye: [7078, -5016], komar: [-173, -2186], hotel: [-2381, 1245] };
  function mk(k) { return { x: MK[k][0], z: MK[k][1] }; }

  /* ---- трамплин: клин как в fcars2 (физика — его rampTick по общему списку FC.cars.ramps), своя раскраска ----- */
  var RL = 7.5, RW = 4.6, RH = 1.7, wedgeGeo = null;
  function wedge() {
    if (wedgeGeo) return wedgeGeo;
    var L = RL, W = RW, h = RH, p = [], uv = [];
    function tri(a, b, c, ua, ub, uc) { p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]); }
    var A = [-W / 2, 0, -L / 2], B = [W / 2, 0, -L / 2], C = [W / 2, h, L / 2], D = [-W / 2, h, L / 2], E = [W / 2, 0, L / 2], F = [-W / 2, 0, L / 2];
    tri(A, C, B, [0, 0], [1, 1], [1, 0]); tri(A, D, C, [0, 0], [0, 1], [1, 1]);
    tri(B, C, E, [0, 0], [0, 0], [0, 0]); tri(F, D, A, [0, 0], [0, 0], [0, 0]);
    tri(E, C, D, [0, 0], [0, 0], [0, 0]); tri(E, D, F, [0, 0], [0, 0], [0, 0]);
    wedgeGeo = new T.BufferGeometry();
    wedgeGeo.setAttribute("position", new T.Float32BufferAttribute(p, 3)); wedgeGeo.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    wedgeGeo.computeVertexNormals();
    return wedgeGeo;
  }
  var rampMats = {};
  function rampMat(a, b) {
    var k = a + ":" + b;
    if (rampMats[k]) return rampMats[k];
    var tex = G.tex.canvas(128, 256, function (x, w, hh) {
      x.fillStyle = a; x.fillRect(0, 0, w, hh); x.fillStyle = b;
      for (var i = -4; i < 12; i++) { x.beginPath(); x.moveTo(0, i * 32); x.lineTo(w, i * 32 - 48); x.lineTo(w, i * 32 - 32); x.lineTo(0, i * 32 + 16); x.fill(); }
    });
    return (rampMats[k] = new T.MeshStandardMaterial({ map: tex, roughness: 0.6, side: T.DoubleSide }));
  }
  // InstancedMesh клиньев по списку {x, z, h}; общая геометрия и материал помечены shared — уборка их не трогает
  function rampMesh(list, a, b) {
    var im = new T.InstancedMesh(wedge(), rampMat(a || "#e11d48", b || "#ffffff"), Math.max(1, list.length)), o = new T.Object3D();
    list.forEach(function (r, i) { o.position.set(r.x, 0.18, r.z); o.rotation.set(0, r.h, 0); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
    im.count = list.length; im.castShadow = G.Q.shadows; im.receiveShadow = G.Q.shadows; im.frustumCulled = false;
    im.userData.shared = true;               // геометрия общая: dispose не нужен
    return im;
  }
  function rampAt(x, z, h) { return { x: x, z: z, h: h, fx: Math.sin(h), fz: Math.cos(h), mis: true }; }
  X.rampMesh = rampMesh; X.rampAt = rampAt; X.RAMP = { L: RL, W: RW, H: RH };

  /* ---- контрольные точки на земле: текущая и следующая метки ------------------------------------------------- */
  function cpShow(c, list, i, icon) {
    if (i < list.length) c.mark("cp", list[i], { ring: 7, icon: i === list.length - 1 ? "🏁" : icon || "⬤", color: "#ffcf3f", route: true });
    else c.unmark("cp");
    if (i + 1 < list.length) c.mark("cp2", list[i + 1], { ring: 0, icon: "", color: "#6bd5ff", route: false, blip: false });
    else c.unmark("cp2");
  }

  /* ---- вертолёт миссии: висит над точкой, игрок сразу за штурвалом ------------------------------------------ */
  function heliStart(c, type, x, z, agl, yaw) {
    var A = c.heli(type, x, z, yaw || 0, { y: gnd(x, z) + (agl || 35) });
    A.engine = true; A.rpm = 1; A.onGround = false;
    FC.air.enter(A);
    return A;
  }
  // скоростной экскурсионный вертолёт — свой вид в таблице fair (данные, не код)
  if (!FC.air.SPEC.heli_tour) FC.air.SPEC.heli_tour = Object.assign({}, FC.air.SPEC.heli_news, { name: "экскурсионный «Огонёк»", color: 0xff8a1a, vmax: MINSK ? 56 : 46, acc: 14, climb: 13 });

  /* =========================================================================================================== */
  /* 1. «Над городом» — экскурсия                                                                                 */
  /* =========================================================================================================== */
  function tourPlan() {
    var rings, start, photo;
    if (MINSK) {
      start = { x: -2470, z: -40 };                     // над проспектом Победителей, Немига — первое кольцо впереди
      var riv = X.riverNear(-560, -430);
      rings = [
        { x: -2126, z: -164, y: 42, who: "Немига", fact: "Под этой улицей в трубе течёт река Немига — та самая из летописи 1067 года, где впервые упомянут Минск." },
        { x: -1562, z: -449, y: 58, who: "Верхний город", fact: "Верхний город — площадь Свободы и ратуша с часами: её отстроили заново в начале 2000-х по старым чертежам." },
        { x: -1539, z: -927, y: 34, who: "Троицкое предместье", fact: "Троицкое — уголок XIX века на берегу Свислочи: черепичные крыши, кофейни, мостики." },
        { x: riv.x, z: riv.z, y: 18, who: "Свислочь", fact: "Свислочь — главная река Минска. Вдоль неё можно пройти через весь центр по набережным." },
        { x: 697, z: -1982, y: 32, who: "Проспект Независимости", fact: "Проспект Независимости — один из самых длинных в Европе: около 15 км от центра до кольцевой." },
        { x: 4337, z: -3447, y: 64, who: "Национальная библиотека", fact: "Библиотека-«алмаз» высотой 72 м. Ночью её грани светятся, как огромный экран." },
        { x: 4795, z: -3389, y: 92, who: "Маяк Минска", fact: "Маяк Минска — новые высотки у библиотеки. Отсюда видно пол-города — финиш экскурсии!" }
      ];
      photo = { x: 4337, y: 36, z: -3447, name: "Национальную библиотеку" };
    } else {
      var hq = M.hq, pad = FC.air.pads.filter(function (p) { return !p.B; })[0] || { x: -564, z: -423 };
      var biz = M.zones.notes || M.zones.mail || hq, lake = M.LAKE, rw = FC.air.runway;
      start = { x: pad.x + 12, z: pad.z + 12 };
      rings = [
        { x: biz.x + 30, z: biz.z - 20, y: 95, who: "Деловой квартал", fact: "Москва Флейм-Сити — офисы-небоскрёбы. Здесь работают агенты: монтируют, пишут, снимают — без выходных." },
        { x: -330, z: -120, y: 22, who: "Москва-река", fact: "Москва-река течёт через весь город к заливу. Рыбаки клянутся, что видели сома размером с такси." },
        { x: hq.x + hq.w / 2 + 26, z: hq.z, y: 120, who: "Башня Флейм", fact: "Башня Флейм — 64 этажа. Каждый огонёк в окне — чья-то работа, которую делает агент." },
        { x: hq.x, z: hq.z, y: hq.h + 22, who: "Над Башней", fact: "Выше в городе только облака. На крыше — вертолётная площадка, а говорят, и кое-что ещё…" },
        { x: lake.x, z: lake.z, y: 26, who: "Озеро", fact: "Комсомольское озеро — любимое место для свиданий. А по ночам там бывает… странное." },
        { x: 0, z: (M.BEACH_Z0 + M.SEA_LINE) / 2, y: 24, who: "Пляж", fact: "Пляж Флейм-Сити: песок, волейбол и самые дорогие закаты в городе." },
        { x: (rw.x0 + rw.x1) / 2, z: rw.z, y: 34, who: "Аэродром на сваях", fact: "Аэродром стоит прямо над морем. «Кукурузник» тут — местная легенда." },
        { x: plazaC().x, z: plazaC().z, y: 18, who: "Площадь Огонька", fact: "Финиш у фонтана — сердца города. Спасибо, что летали с «Флейм ТВ»!" }
      ];
      photo = { x: hq.x, y: hq.h * 0.55, z: hq.z, name: "Башню Флейм" };
    }
    // длина маршрута в 3D: от зависания над стартом через все кольца
    var L = 0, px = start.x, py = gnd(start.x, start.z) + 40, pz = start.z;
    rings.forEach(function (r) { L += d3(px, py, pz, r.x, r.y, r.z); px = r.x; py = r.y; pz = r.z; });
    return { start: sw(start.x, start.z), hover: start, rings: rings, photo: photo, L: L };
  }
  X.def({ id: "tour", title: "Над городом", icon: "🚁", kind: "air", pay: 1500,
    short: "Экскурсия на вертолёте: кольца над ориентирами",
    desc: "Пролети на экскурсионном вертолёте через кольца над главными местами города и послушай рассказчика. Сфотографируй ориентир в фоторежиме (📸 / O, ближе 60 м) — минус 10 секунд.",
    plan: tourPlan,
    // пороги — от длины облёта и скорости экскурсионного вертолёта (в Минске он быстрее: город больше)
    medals: function (p) { var k = FC.air.SPEC.heli_tour.vmax / 46; return { by: "time", g: Math.round(p.L / (40 * k) + 12), s: Math.round(p.L / (31 * k) + 22), b: Math.round(p.L / (23 * k) + 35), limit: Math.round((p.L / (23 * k) + 35) * 1.7) }; },
    intro: function () { return [say("Флейм ТВ", "📺", "В эфире «Город с высоты»! Вертолёт заправлен, рассказчик на связи."), say("Флейм ТВ", "📺", "Лети через золотые кольца. Пробел — вверх, Shift — вниз, W — вперёд.")]; },
    setup: function (c) {
      var p = c.plan;
      c.A = heliStart(c, "heli_tour", p.hover.x, p.hover.z, 40, Math.atan2(p.rings[0].x - p.hover.x, p.rings[0].z - p.hover.z));
      c.pool = X.ringPool(c); c.i = 0; c.photoGot = false;
      placeRings(c);
      c.on("photo:shot", function (e) {
        var f = c.plan.photo;
        if (c.photoGot || !e || !e.see || !e.see(f.x, f.y, f.z)) return;
        c.photoGot = true; c.penalty -= 10;
        pop("📸 ФОТО-БОНУС −10 с", "#7dffb0", true); snd("cash");
      });
      c.obj("Лети к <b>золотому кольцу</b>");
    },
    tick: function (c, dt) {
      var A = c.A, p = c.plan;
      if (!A || A.wrecked) { c.fail("Вертолёт разбит"); return; }
      if (P().air !== A) { c.fail("Ты покинул вертолёт"); return; }
      var r = p.rings[c.i], R = 11;
      if (d3(A.x, A.y, A.z, r.x, r.y, r.z) < R) {
        snd("note"); pop("КОЛЬЦО " + (c.i + 1) + "/" + p.rings.length, "#ffcf3f");
        X.sub(r.who, r.fact, 7);
        c.i++;
        if (c.i >= p.rings.length) { c.pass(); return; }
        placeRings(c);
      }
      // кольцо не должно сидеть в доме: высоту поднимаем над крышей, когда кусок рядом загружен (Минск — лениво)
      c.adjT = (c.adjT || 0) - dt;
      if (c.adjT <= 0) {
        c.adjT = 0.5;
        for (var k = c.i; k < Math.min(p.rings.length, c.i + 3); k++) {
          var q = p.rings[k];
          // только поднимаем: кусок мог догрузиться позже, тогда кольцо всплывёт над новой крышей
          if (q.y0 == null) q.y0 = q.y;
          if (Math.hypot(A.x - q.x, A.z - q.z) < 600) { var ny = Math.max(q.y0, gnd(q.x, q.z) + 24); if (ny > q.y + 0.5) { q.y = ny; placeRings(c); } }
        }
      }
      c.pool[0].rotation.z += dt * 0.8;
      var f = p.photo;
      if (!c.photoGot && d3(A.x, A.y, A.z, f.x, f.y, f.z) < 75 && !c.photoHint) { c.photoHint = true; X.sub("Флейм ТВ", "Красиво! Сними " + f.name + " — 📸 / O, минус 10 секунд.", 5); }
      c.obj("Кольцо <b>" + (c.i + 1) + "/" + p.rings.length + "</b> · " + r.who);
    },
    hud: function (c) { return "<small>кольца " + c.i + "/" + c.plan.rings.length + (c.photoGot ? " · 📸 −10 с" : "") + "</small>"; },
    done: function () { X.ach("mis_tour_" + FC.city); }
  });
  function placeRings(c) {
    var rs = c.plan.rings;
    for (var k = 0; k < 3; k++) {
      var m = c.pool[k], r = rs[c.i + k];
      if (!r) { m.visible = false; continue; }
      var prev = c.i + k > 0 ? rs[c.i + k - 1] : c.plan.hover;
      m.visible = true; m.position.set(r.x, r.y, r.z); m.scale.setScalar(k ? 8 : 11);
      m.rotation.set(0, Math.atan2(r.x - prev.x, r.z - prev.z), 0);
    }
    c.mark("ring", rs[c.i], { ring: 0, beam: false, route: false, icon: "◎", color: "#ffcf3f" });
  }

  /* =========================================================================================================== */
  /* 2. «Вертолёт спасения» — с крыши в больницу                                                                  */
  /* =========================================================================================================== */
  function medPad() {
    var meds = FC.air.pads.filter(function (p) { return p.type === "heli_med"; }), c0 = MINSK ? { x: -1500, z: -500 } : { x: 0, z: 0 };
    meds.sort(function (a, b) { return d2(a, c0) - d2(b, c0); });
    return meds[0] || FC.air.pads[0];
  }
  X.def({ id: "rescue", title: "Вертолёт спасения", icon: "🆘", kind: "air", pay: 1800,
    short: "Сесть на крышу, забрать троих, доставить в больницу",
    desc: "На крыше высотки застряли трое — лифт сгорел, внизу дым. Сядь на крышу санитарным вертолётом, подожди, пока все сядут, и доставь их на площадку больницы.",
    plan: function () {
      var pad = medPad(), tg = null, best = 1e18, want = 800;
      if (MINSK) {
        (M.marks || []).forEach(function (m) {
          if (m[3] < 25 || m[3] > 75 || X.BAD.test(m[0]) || !X.safe(m[1], m[2])) return;
          var q = Math.abs(Math.hypot(m[1] - pad.x, m[2] - pad.z) - want);
          if (q < best) { best = q; tg = { x: m[1], z: m[2], h: m[3] }; }
        });
      } else {
        M.buildings.forEach(function (B) {
          if (B.zone || B.poi || B === M.hq || B.h < 26 || B.h > 85 || B.w < 14 || B.d < 14) return;
          var q = Math.abs(Math.hypot(B.x - pad.x, B.z - pad.z) - want) + (FC.hash("res" + B.id) % 60);
          if (q < best) { best = q; tg = { x: B.x, z: B.z, h: B.h, B: B }; }
        });
      }
      tg = tg || { x: pad.x + 500, z: pad.z, h: 30 };
      var D = Math.hypot(tg.x - pad.x, tg.z - pad.z);
      var door = pad.B && pad.B.doors ? doorOf(pad.B) : { x: pad.x + 10, z: pad.z + 10 };
      return { start: sw(door.x, door.z), pad: { x: pad.x, z: pad.z, y: pad.y }, tg: tg, L: D * 2 };
    },
    medals: function (p) { return { by: "time", g: Math.round(p.L / 30 + 24), s: Math.round(p.L / 23 + 38), b: Math.round(p.L / 17 + 55), limit: Math.round((p.L / 17 + 55) * 1.7) }; },
    intro: [say("Диспетчер", "🚑", "Внимание, борт «Скорая»! На крыше высотки трое, внизу дым, лифт не работает."), say("Диспетчер", "🚑", "Садись на крышу аккуратно, жди посадки и вези в больницу. Удачи!")],
    setup: function (c) {
      var p = c.plan;
      c.A = heliStart(c, "heli_med", p.pad.x, p.pad.z, 28, Math.atan2(p.tg.x - p.pad.x, p.tg.z - p.pad.z));
      c.phase = "fly"; c.hold = 0; c.smokeT = 0; c.ppl = null;
      c.mark("roof", p.tg, { y: p.tg.h, ring: 7, icon: "🆘", color: "#ff5d6c", route: false });
      c.obj("Лети к <b>крыше с дымом</b> 🆘");
    },
    tick: function (c, dt) {
      var A = c.A, p = c.plan;
      if (!A || A.wrecked) { c.fail("Вертолёт разбит"); return; }
      if (P().air !== A) { c.fail("Ты покинул вертолёт"); return; }
      var tg = p.tg, dTg = Math.hypot(A.x - tg.x, A.z - tg.z);
      // крыша известна, когда кусок загружен (Минск): высота — по настоящему контуру
      if (!c.roof && dTg < 400 && X.loaded(tg.x, tg.z)) {
        var B = tg.B || M.buildingAt(tg.x, tg.z, 0);
        c.roof = { x: B ? B.x : tg.x, z: B ? B.z : tg.z, y: B ? B.h : tg.h, r: B ? Math.max(B.w || 16, B.d || 16) / 2 : 9, B: B };
        c.move("roof", c.roof.x, c.roof.z, c.roof.y);
        c.ppl = [];
        for (var i = 0; i < 3; i++) {
          var ch = c.npc(FC.people.randomCell(), c.roof.x + (i - 1) * 2.2, c.roof.z + 2, { y: c.roof.y + 0.05, scale: 1.8 });
          ch.update = (function (y) { return function (q) { q.y = y; }; })(c.roof.y + 0.05);
          c.ppl.push(ch);
          FC.people.say(ch, ["Помогите!", "Мы здесь!!", "Сюда! Сюда!"][i], 5);
        }
      }
      if (c.roof && c.phase === "fly") {
        c.smokeT -= dt;
        if (c.smokeT <= 0 && FC.fx && dTg < 600) { c.smokeT = 0.22; FC.fx.burst(c.roof.x + 4, c.roof.y + 1, c.roof.z - 4, "smoke", 2); }
        var onRoof = A.onGround && Math.hypot(A.x - c.roof.x, A.z - c.roof.z) < c.roof.r + 2 && A.y > c.roof.y - 2.5;
        if (onRoof) {
          c.hold += dt;
          c.obj("Посадка… <b>" + Math.ceil(3 - c.hold) + "</b> — не взлетай");
          c.ppl.forEach(function (ch, k) { if (ch.visible) { var dx = A.x - ch.x, dz = A.z - ch.z, dd = Math.hypot(dx, dz); if (dd < 2.2 || c.hold > 1 + k * 0.6) ch.visible = false; else { ch.x += dx / dd * 3 * dt; ch.z += dz / dd * 3 * dt; ch.speed = 3; } } });
          if (c.hold >= 3) {
            c.phase = "back"; c.unmark("roof");
            c.ppl.forEach(function (ch) { ch.visible = false; });
            c.mark("pad", p.pad, { y: p.pad.y, ring: 6, icon: "🏥", color: "#7dffb0", route: false });
            X.sub("Спасённые", "Спасибо!! Мы думали, это конец… Лети быстрее, у Гены паника!", 5);
            snd("cash"); pop("ВСЕ НА БОРТУ", "#7dffb0", true);
          }
        } else { c.hold = 0; c.obj(dTg < 80 ? "Садись на крышу — <b>Shift</b> вниз, медленно" : "Лети к <b>крыше с дымом</b> 🆘"); }
      } else if (c.phase === "back") {
        var onPad = A.onGround && Math.hypot(A.x - p.pad.x, A.z - p.pad.z) < 7 && Math.abs(A.y - p.pad.y) < 2.5;
        c.obj(onPad ? "Готово!" : "Доставь всех на <b>площадку больницы</b> 🏥");
        if (onPad) c.pass();
      } else c.obj("Лети к <b>крыше с дымом</b> 🆘");
    },
    done: function () { X.ach("mis_rescue"); }
  });

  /* =========================================================================================================== */
  /* 3. «Груз на тросе» — маятник                                                                                 */
  /* =========================================================================================================== */
  var crateGeo = null, crateMat = null, ropeMat = null, ropeGeo = null, ropeV = new T.Vector3(), ropeUp = new T.Vector3(0, 1, 0);
  X.def({ id: "cargo", title: "Груз на тросе", icon: "📦", kind: "air", pay: 1700,
    short: "Подцепить контейнер и донести, не разбив",
    desc: MINSK ? "Свет и звук для концерта на Минск-Арене застряли в парке. Подцепи контейнер (зависни над ним низко), донеси к арене и опусти мягко. Удар о стену или землю на скорости — груз разбит."
      : "Сцену для концерта привезли в порт. Подцепи контейнер (зависни над ним низко), донеси на площадь Огонька и опусти мягко. Удар о стену или землю на скорости — груз разбит.",
    plan: function () {
      var a, b;
      if (MINSK) {
        b = mk("arena");
        var best = null, bd = 1e18;
        M.blocks.forEach(function (k) { if (k.kind !== "park") return; var d = Math.hypot(k.cx - b.x, k.cz - b.z); if (d < 800 || d > 1700) return; var q = Math.abs(d - 1200); if (q < bd) { bd = q; best = k; } });
        a = best ? { x: best.cx, z: best.cz } : { x: b.x + 1200, z: b.z };
      } else {
        a = { x: 640, z: (M.BEACH_Z0 + M.SEA_LINE) / 2 - 8 };
        var pc = plazaC(); b = { x: M.plaza.x0 + 18, z: pc.z };
      }
      return { start: sw(a.x, a.z), a: a, b: b, L: Math.hypot(a.x - b.x, a.z - b.z) };
    },
    medals: function (p) { return { by: "time", g: Math.round(p.L / 25 + 28), s: Math.round(p.L / 19 + 45), b: Math.round(p.L / 14 + 65), limit: Math.round((p.L / 14 + 65) * 1.6) }; },
    intro: [say("Прораб", "👷", "Контейнер на земле, трос — 10 метров. Зависни низко над ним — подцеплю сам."), say("Прораб", "👷", "Не раскачивай! Ударишь о стену — платить будешь из своих.")],
    setup: function (c) {
      var p = c.plan, s = X.spot(p.a.x, p.a.z, 80, 4);
      c.crate = { x: s.x, y: gnd(s.x, s.z) + 1.2, z: s.z, vx: 0, vy: 0, vz: 0, px: 0, py: 0, pz: 0 };
      c.A = heliStart(c, "heli_light", s.x + 25, s.z + 25, 30, Math.atan2(-1, -1));
      if (!crateGeo) {
        crateGeo = new T.BoxGeometry(2.4, 2.4, 2.4);
        var tex = G.tex.canvas(128, 128, function (x, w, h) { x.fillStyle = "#ff7a1a"; x.fillRect(0, 0, w, h); x.strokeStyle = "#2a1205"; x.lineWidth = 8; x.strokeRect(6, 6, w - 12, h - 12); x.beginPath(); x.moveTo(6, 6); x.lineTo(w - 6, h - 6); x.stroke(); x.fillStyle = "#fff"; x.font = "900 26px system-ui"; x.textAlign = "center"; x.fillText("🔥", w / 2, h / 2 + 10); });
        crateMat = new T.MeshStandardMaterial({ map: tex, roughness: 0.6 });
        ropeMat = new T.MeshBasicMaterial({ color: 0x222222 });
        ropeGeo = new T.CylinderGeometry(0.06, 0.06, 1, 5).translate(0, 0.5, 0);
      }
      c.box = new T.Mesh(crateGeo, crateMat); c.box.castShadow = G.Q.shadows; c.box.userData.shared = true; c.add(c.box);
      // трос — цилиндр единичной длины: ставим в груз, тянем к крюку (поворот от оси Y к направлению, без аллокаций)
      c.rope = new T.Mesh(ropeGeo, ropeMat); c.rope.visible = false; c.rope.userData.shared = true; c.add(c.rope);
      c.hooked = false; c.hold = 0; c.target = null;
      c.mark("crate", s, { ring: 4, icon: "📦", color: "#ff9b4a", route: false });
      c.obj("Зависни низко над <b>контейнером</b> 📦");
    },
    tick: function (c, dt) {
      var A = c.A, p = c.plan, k = c.crate;
      if (!A || A.wrecked) { c.fail("Вертолёт разбит"); return; }
      if (P().air !== A) { c.fail("Ты покинул вертолёт"); return; }
      if (!c.hooked) {
        var hd = Math.hypot(A.x - k.x, A.z - k.z), up = A.y - k.y;
        if (hd < 7 && up > 3 && up < 20) {
          c.hold += dt; c.obj("Цепляю… <b>" + Math.ceil(1.2 - c.hold) + "</b>");
          if (c.hold > 1.2) {
            c.hooked = true; c.hold = 0; c.rope.visible = true; c.unmark("crate"); snd("door"); pop("ГРУЗ НА ТРОСЕ", "#ffcf7a");
            c.mark("drop", p.b, { ring: 8, icon: "🎯", color: "#7dffb0", route: false });
            c.obj("Неси груз к <b>точке доставки</b> 🎯 — не раскачивай");
          }
        } else { c.hold = 0; c.obj(hd < 30 ? "Ниже! Над контейнером, <b>3–20 м</b>" : "Зависни низко над <b>контейнером</b> 📦"); }
      } else {
        // маятник: свободный полёт + трос не длиннее 10 м (позиционная поправка), скорость — из сдвига
        k.px = k.x; k.py = k.y; k.pz = k.z;
        k.vy -= 9.8 * dt;
        var damp = Math.exp(-0.9 * dt); k.vx *= damp; k.vy *= damp; k.vz *= damp;
        k.x += k.vx * dt; k.y += k.vy * dt; k.z += k.vz * dt;
        var ax = A.x, ay = A.y - 0.8, az = A.z, dx = k.x - ax, dy = k.y - ay, dz = k.z - az, L = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (L > 10) { k.x = ax + dx / L * 10; k.y = ay + dy / L * 10; k.z = az + dz / L * 10; }
        var gy = gnd(k.x, k.z) + 1.2;
        k.vx = (k.x - k.px) / Math.max(dt, 1e-3); k.vy = (k.y - k.py) / Math.max(dt, 1e-3); k.vz = (k.z - k.pz) / Math.max(dt, 1e-3);
        var sp = Math.sqrt(k.vx * k.vx + k.vy * k.vy + k.vz * k.vz);
        var B = M.buildingAt(k.x, k.z, 1.2);
        if (B && k.y - 1.2 < B.h) {
          if (sp > 9) { boomCrate(c); c.fail("Груз разбился о стену"); return; }
          k.x = k.px; k.z = k.pz; k.vx *= -0.3; k.vz *= -0.3;
        }
        if (k.y < gy) {
          if (sp > 11) { boomCrate(c); c.fail("Груз разбился о землю"); return; }
          k.y = gy; k.vy = 0; k.vx *= 0.85; k.vz *= 0.85;
        }
        // точка доставки: ищем свободное место, когда кусок рядом загружен
        if (!c.target && Math.hypot(k.x - p.b.x, k.z - p.b.z) < 400 && X.loaded(p.b.x, p.b.z)) { c.target = X.spot(p.b.x, p.b.z, 120, 5); c.move("drop", c.target.x, c.target.z); }
        var tg = c.target || p.b, dt2 = Math.hypot(k.x - tg.x, k.z - tg.z);
        if (dt2 < 8 && k.y - gy < 2.2 && sp < 5) {
          c.hold += dt; c.obj("Опускаю… <b>" + Math.ceil(1 - c.hold) + "</b>");
          if (c.hold > 1) { c.rope.visible = false; snd("thud"); pop("ДОСТАВЛЕНО", "#7dffb0", true); c.pass(); return; }
        } else { c.hold = 0; c.obj(dt2 < 40 ? "Опусти груз <b>в круг</b> мягко" : "Неси груз к <b>точке доставки</b> 🎯 — не раскачивай"); }
        ropeV.set(ax - k.x, ay - k.y - 1.2, az - k.z);
        var rl = ropeV.length() || 1;
        c.rope.position.set(k.x, k.y + 1.2, k.z); c.rope.scale.set(1, rl, 1);
        c.rope.quaternion.setFromUnitVectors(ropeUp, ropeV.multiplyScalar(1 / rl));
      }
      c.box.position.set(k.x, k.y, k.z);
      c.box.rotation.set(c.hooked ? FC.clamp(k.vz * 0.02, -0.4, 0.4) : 0, c.hooked ? A.yaw : 0, c.hooked ? FC.clamp(-k.vx * 0.02, -0.4, 0.4) : 0);
    },
    hud: function (c) { var k = c.crate, s = Math.round(Math.sqrt(k.vx * k.vx + k.vy * k.vy + k.vz * k.vz)); return c.hooked ? "<small>раскачка " + s + " м/с</small>" : ""; },
    done: function () { X.ach("mis_cargo"); }
  });
  function boomCrate(c) { var k = c.crate; if (FC.fx) { FC.fx.burst(k.x, k.y, k.z, "debris", 24); FC.fx.burst(k.x, k.y, k.z, "smoke", 12); } snd("crash", { power: 14 }); c.box.visible = false; c.rope.visible = false; }

  /* =========================================================================================================== */
  /* 4. «Прыжок» — свободное падение и точность приземления                                                       */
  /* =========================================================================================================== */
  var bullTex = null;
  X.def({ id: "skydive", title: "Прыжок", icon: "🪂", kind: "air", pay: 1400,
    short: "Из самолёта — в центр мишени",
    desc: MINSK ? "«Кукурузник» с аэродрома Минск-1 пролетит над Минск-Миром. Прыгай, лети в свободном падении к мишени, раскрой купол (пробел/🪂) и приземлись в центр. Медаль — по промаху."
      : "«Кукурузник» пролетит над парком у центра. Прыгай, лети в свободном падении к мишени, раскрой купол (пробел/🪂) и приземлись в центр. Медаль — по промаху.",
    plan: function () {
      var tg;
      if (MINSK) tg = mk("world");
      else {
        var best = null, bd = 1e18;
        M.blocks.forEach(function (b) { if (b.kind !== "park") return; var d = Math.hypot(b.cx - 250, b.cz - 250); if (d < bd) { bd = d; best = b; } });
        tg = best ? { x: best.cx, z: best.cz } : { x: 250, z: 250 };
      }
      var bd2 = FC.air.board;
      return { start: { x: bd2.x, z: bd2.z }, tg: tg };
    },
    medals: function () { return { by: "dist", g: 3, s: 8, b: 20, limit: 300 }; },
    intro: [say("Инструктор", "🪂", "Высота 420. Как скажу — прыгай: пробел, ✋ или F."), say("Инструктор", "🪂", "В падении рули к мишени. Пробел — купол. Ниже 140 метров раскрою сам, но будет поздно.")],
    setup: function (c) {
      var p = c.plan, tg = p.tg, P0 = P();
      c.allowJump = true;
      // ветер с запада: самолёт заходит против ветра, точка прыжка — в 380 м до мишени
      var dir = { x: 1, z: 0.15 }, l = Math.hypot(dir.x, dir.z); dir.x /= l; dir.z /= l;
      c.dir = dir; c.jx = tg.x - dir.x * 380; c.jz = tg.z - dir.z * 380;
      c.plane = FC.air.visual("plane_prop"); c.add(c.plane);
      c.pl = { x: c.jx - dir.x * 520, y: 420, z: c.jz - dir.z * 520, v: 48 };     // выше ~500 м туман съедает город
      c.phase = "plane"; c.fall = { vx: 0, vy: 0, vz: 0 };
      P0.mode = "mis"; P0.x = c.pl.x; P0.z = c.pl.z; P0.y = c.pl.y;
      c.camWant = FC.cam.want; FC.cam.want = 16;
      // в самолёте игрока не видно: система игрока ставит visible раньше, чем рисуются люди, — прячем масштабом
      c.chScale = P0.ch ? P0.ch.scale : 1; if (P0.ch) P0.ch.scale = 0.001;
      c.clean(function () { FC.cam.want = c.camWant; var q = P(); if (q.ch && q.ch.scale < 0.01) q.ch.scale = c.chScale; if (q.mode === "mis") { q.mode = "foot"; q.teleport(q.x, q.z); } });
      // мишень: ставим, когда кусок под ней загружен (дома и деревья известны)
      if (!bullTex) bullTex = G.tex.canvas(256, 256, function (x, W) {
        var cols = ["#ffffff", "#e11d48", "#ffffff", "#e11d48", "#ffffff", "#ffcf3f"];
        for (var i = 0; i < cols.length; i++) { x.fillStyle = cols[i]; x.beginPath(); x.arc(W / 2, W / 2, W / 2 - i * 21, 0, 7); x.fill(); }
      });
      c.bull = new T.Mesh(new T.CircleGeometry(20, 40).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ map: bullTex, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 }));
      c.bull.position.set(tg.x, 0.24, tg.z); c.add(c.bull);
      c.tgt = { x: tg.x, z: tg.z }; c.fixed = false;
      c.mark("tg", tg, { ring: 0, icon: "🎯", color: "#e11d48", route: false });
      c.obj("Жди команды инструктора…");
    },
    tickCount: true,
    tick: function (c, dt) {
      var p = P(), pl = c.pl;
      if (!c.fixed && Math.hypot(p.x - c.tgt.x, p.z - c.tgt.z) < 800 && X.loaded(c.tgt.x, c.tgt.z)) {
        c.fixed = true; var s = X.spot(c.tgt.x, c.tgt.z, 140, 14); c.tgt = s; c.bull.position.set(s.x, 0.24, s.z); c.move("tg", s.x, s.z);
      }
      // самолёт летит всегда (и после прыжка — улетает)
      pl.x += c.dir.x * pl.v * dt; pl.z += c.dir.z * pl.v * dt;
      c.plane.position.set(pl.x, pl.y, pl.z); c.plane.rotation.set(0, Math.atan2(c.dir.x, c.dir.z), 0);
      if (c.phase === "plane") {
        p.mode = "mis"; p.x = pl.x; p.z = pl.z; p.y = pl.y + 1; p.vx = c.dir.x * pl.v; p.vz = c.dir.z * pl.v; p.heading = Math.atan2(c.dir.x, c.dir.z);
        if (c.state !== "run") return;
        var toJ = (c.jx - pl.x) * c.dir.x + (c.jz - pl.z) * c.dir.z;
        c.obj(toJ > 40 ? "Приготовься… <b>" + Math.round(toJ) + " м</b> до точки прыжка" : "<b>ПРЫГАЙ!</b> — пробел / ✋ / F");
        var jump = I.pressed("jump") || I.pressed("use") || I.pressed("car");
        if (jump || toJ < -260) {
          if (jump) { I.consume && I.consume("jump"); I.consume && I.consume("use"); I.consume && I.consume("car"); }
          c.phase = "fall"; c.fall.vx = p.vx * 0.6; c.fall.vz = p.vz * 0.6; c.fall.vy = 0; p.y = pl.y - 1.5;
          if (p.ch) p.ch.scale = c.chScale;
          snd("whoosh"); pop("ПРЫЖОК!", "#6bd5ff", true);
          if (FC.fx && FC.fx.hitstop) FC.fx.hitstop(0.35, 0.3);
        }
        return;
      }
      if (c.phase === "fall") {
        var f = c.fall, s = Math.sin(FC.cam.yaw), co = Math.cos(FC.cam.yaw);
        c.fallT = (c.fallT || 0) + dt;
        var wx = -s * I.mz + co * I.mx, wz = -co * I.mz - s * I.mx, mag = Math.hypot(wx, wz);
        var tvx = mag > 0.05 ? wx / Math.max(1, mag) * 18 : 0, tvz = mag > 0.05 ? wz / Math.max(1, mag) * 18 : 0;
        f.vx = FC.damp(f.vx, tvx, 1.2, dt); f.vz = FC.damp(f.vz, tvz, 1.2, dt);
        f.vy = Math.max(-54, f.vy - 9.8 * dt);
        p.x += f.vx * dt; p.z += f.vz * dt; p.y += f.vy * dt; p.vx = f.vx; p.vz = f.vz; p.vy = f.vy;
        if (mag > 0.05) p.heading = FC.angDamp(p.heading, Math.atan2(wx, wz), 4, dt);
        if (FC.fx && FC.fx.speed) FC.fx.speed(FC.clamp(-f.vy / 54, 0, 1) * 0.8);
        var agl = p.y - gnd(p.x, p.z);
        var dT = Math.round(Math.hypot(p.x - c.tgt.x, p.z - c.tgt.z));
        c.obj("Свободное падение · <b>" + Math.round(agl) + " м</b> · до мишени " + dT + " м · <b>пробел</b> — купол");
        if ((c.fallT > 0.6 && (I.pressed("jump") || I.pressed("car") || I.pressed("use"))) || agl < 140) {
          if (agl < 140) pop("АВТОРАСКРЫТИЕ", "#ff9b4a");
          c.phase = "chute"; FC.air.openChute(f.vx * 0.4, f.vz * 0.4);
        }
        return;
      }
      if (c.phase === "chute") {
        var dd = Math.hypot(p.x - c.tgt.x, p.z - c.tgt.z);
        c.obj("Рули куполом к мишени · <b>" + Math.round(dd) + " м</b> · " + Math.round(p.y - gnd(p.x, p.z)) + " м до земли");
        if (p.mode === "foot") {
          if (FC.inside && FC.inside.active) { c.fail("Сел на крышу — мимо мишени"); return; }
          if (dd > 60) { c.fail(dd > 400 ? "Приводнился или улетел далеко" : "Мимо мишени: " + Math.round(dd) + " м"); return; }
          pop("ПРОМАХ " + dd.toFixed(1) + " м", dd < 3 ? "#ffd23f" : "#ffffff", true);
          c.pass({ v: +dd.toFixed(1) });
        }
      }
    },
    hud: function (c) { return "<small>" + (c.phase === "fall" ? "падение " + Math.round(-c.fall.vy * 3.6) + " км/ч" : c.phase === "chute" ? "под куполом" : "в самолёте") + "</small>"; },
    done: function (c, medal, v) { if (v <= 2) X.ach("mis_bullseye"); }
  });

  /* =========================================================================================================== */
  /* 5. «Курьер-молния» — супербайк                                                                               */
  /* =========================================================================================================== */
  function bikePlan(a, b) {
    var la = X.lane(a.x, a.z), lb = X.lane(b.x, b.z), r = X.route(la, lb);
    return { start: sw(la.x, la.z), a: la, b: lb, route: r, cps: X.checkpoints(r, 300), L: r.L };
  }
  X.def({ id: "courier", title: "Курьер-молния", icon: "🏍️", kind: "car", pay: 1300,
    short: "Супербайк, проспекты, контрольные точки",
    desc: MINSK ? "Срочная посылка с площади Якуба Коласа в Уручье — по проспекту Независимости на супербайке. Проходи контрольные точки; удар — посылка мнётся (+2 с)."
      : "Срочная посылка через весь город на супербайке. Проходи контрольные точки; удар — посылка мнётся (+2 с).",
    plan: function () { return MINSK ? bikePlan(mk("kolas"), mk("uruchye")) : bikePlan({ x: -900, z: -700 }, { x: 950, z: 650 }); },
    medals: function (p) { return { by: "time", g: Math.round(p.L / 40 + 8), s: Math.round(p.L / 31 + 14), b: Math.round(p.L / 23 + 24), limit: Math.round((p.L / 23 + 24) * 1.5) }; },
    intro: [say("Диспетчер «Молнии»", "⚡", "Посылка хрупкая, клиент нервный. Байк — «Казэ Цуруги», 260 км/ч."), say("Диспетчер «Молнии»", "⚡", "Точки — по порядку. Удар — минус репутация и плюс две секунды.")],
    setup: function (c) {
      var p = c.plan;
      c.bike = c.car("moto", p.a.x, p.a.z, p.a.h, { color: 0xff3b1f });
      FC.cars.enter(c.bike);
      c.i = 0; c.off = 0;
      cpShow(c, p.cps, 0, "⚡");
      c.on("car:crash", function (e) { if (e.car === c.bike && e.power > 9 && c.state === "run") { c.penalty += 2; pop("ПОСЫЛКА ПОМЯЛАСЬ +2 с", "#ff9aa5"); } });
      c.obj("Гони к <b>контрольной точке</b>");
    },
    tick: function (c, dt) { ridePoints(c, dt, c.bike, "байк", 14); },
    hud: function (c) { return "<small>точка " + c.i + "/" + c.plan.cps.length + "</small>"; },
    done: function (c, medal) { if (medal === "g") X.ach("mis_courier_gold"); }
  });
  // общий шаг «едь через точки»: без машины дольше 12 с — провал
  function ridePoints(c, dt, car, name, r) {
    var p = c.plan, pl = P();
    if (car.wrecked) { c.fail("Транспорт разбит"); return; }
    if (pl.car !== car) {
      c.off += dt;
      c.obj("Вернись на " + name + "! <b>" + Math.max(0, Math.ceil(12 - c.off)) + "</b>");
      c.move("veh", car.x, car.z);
      if (!c.vehMark) { c.vehMark = true; c.mark("veh", car, { ring: 0, icon: "🔑", color: "#6bd5ff", route: false }); }
      if (c.off > 12) c.fail("Брошен " + name);
      return;
    }
    if (c.vehMark) { c.vehMark = false; c.unmark("veh"); }
    c.off = 0;
    var cp = p.cps[c.i];
    if (d2(pl, cp) < r) {
      c.i++; snd("note");
      if (c.i >= p.cps.length) { c.pass(); return; }
      cpShow(c, p.cps, c.i, "⚡");
    }
    c.obj("Точка <b>" + (c.i + 1) + "/" + p.cps.length + "</b> · " + Math.round(d2(pl, p.cps[c.i])) + " м");
  }

  /* =========================================================================================================== */
  /* 6. «VIP-клиент» — такси со шкалой настроения                                                                 */
  /* =========================================================================================================== */
  X.def({ id: "vip", title: "VIP-клиент", icon: "💅", kind: "car", pay: 1300,
    short: "Такси для звезды рилсов: шкала настроения",
    desc: "Звезда рилсов Алиса (2 млн подписчиков) опаздывает на съёмку. Трюки и скорость она обожает — «это в сторис!», удары и пробки бесят. Медаль — по настроению на финише.",
    plan: function () {
      var a, pk, dst;
      if (MINSK) { a = mk("gates"); pk = mk("hotel"); dst = mk("oktyabr"); }
      else {
        a = plazaC();
        var zi = M.zones.gallery || M.zones.mail, zs = M.zones.shoot || M.poi("club") || M.zones.reels;
        pk = zi ? doorOf(zi) : { x: -400, z: -300 }; dst = zs ? doorOf(zs) : { x: 600, z: -200 };
      }
      var la = X.lane(a.x, a.z), lp = X.lane(pk.x, pk.z), ld = X.lane(dst.x, dst.z);
      return { start: sw(la.x, la.z), a: la, pk: lp, dst: ld, L: X.route(lp, ld).L };
    },
    medals: function () { return { by: "score", g: 85, s: 60, b: 30, limit: 300 }; },
    intro: [say("Алиса", "💅", "Ало, такси? Я у входа, я опаздываю, я в шоке!"), say(FC.MASCOT.name, "mascot", "Она любит трюки и скорость — но не удары. Следи за шкалой настроения.")],
    setup: function (c) {
      var p = c.plan;
      c.taxi = c.car("taxi", p.a.x, p.a.z, p.a.h);
      FC.cars.enter(c.taxi);
      c.mood = 70; c.phase = "pickup"; c.slow = 0; c.off = 0; c.lineT = 0;
      c.vip = c.npc(FC.people.randomCell(), p.pk.x + 5, p.pk.z + 5, { scale: 1.85 });
      c.vip.update = function (q) { q.look = FC.player; };
      c.mark("pk", p.pk, { ring: 5, icon: "💅", color: "#ff5d8f" });
      c.moodEl = c.el("mi-mood", "");
      var vip = function (t) { X.sub("Алиса", t, 3.5); };
      c.on("car:crash", function (e) {
        if (c.phase !== "ride" || (e.car !== c.taxi && e.other !== c.taxi) || e.power < 4) return;
        c.mood -= Math.min(25, e.power * 1.6); vip(["Ай! Мои ноготочки!", "Ты водить умеешь вообще?!", "Я это в сторис не выложу!", "Минус звезда, минус!"][Math.floor(Math.random() * 4)]);
      });
      c.on("stunt", function (e) {
        if (c.phase !== "ride") return;
        var add = e.kind === "air" ? 12 : e.kind === "drift" ? 7 : e.kind === "near" ? 4 : 3;
        c.mood += add; pop("НАСТРОЕНИЕ +" + add, "#ff8fb8");
        vip(e.kind === "air" ? "ААА! Это в сторис!!" : e.kind === "drift" ? "Боже, как в кино!" : "Вот это водила!");
      });
      c.on("crime", function (e) { if (c.phase === "ride" && e && /hit_ped|hit_and_run/.test(e.type || "")) { c.mood -= 30; vip("ТЫ ЧТО, СБИЛ ЧЕЛОВЕКА?!"); } });
      c.obj("Забери <b>Алису</b> 💅");
    },
    tick: function (c, dt) {
      var p = c.plan, pl = P(), car = c.taxi, v = spd();
      if (car.wrecked) { c.fail("Такси разбито"); return; }
      if (pl.car !== car) { c.off += dt; c.obj("Вернись в такси! <b>" + Math.max(0, Math.ceil(10 - c.off)) + "</b>"); if (c.off > 10) c.fail("Ты бросил такси"); return; }
      c.off = 0;
      if (c.phase === "pickup") {
        if (d2(pl, p.pk) < 10 && v < 4) {
          c.phase = "ride"; c.vip.visible = false; c.unmark("pk"); snd("door");
          c.mark("dst", p.dst, { ring: 6, icon: "🎬", color: "#ff5d8f" });
          X.sub("Алиса", "Наконец-то! На съёмку, быстро, но нежно. Поехали!", 4);
        } else c.obj("Забери <b>Алису</b> 💅 · " + Math.round(d2(pl, p.pk)) + " м");
        return;
      }
      // поездка: скорость радует, пробка и розыск злят
      if (v > 22) c.mood += 1.6 * dt;
      if (v < 3) { c.slow += dt; if (c.slow > 6) { c.mood -= 2.2 * dt; c.lineT -= dt; if (c.lineT <= 0) { c.lineT = 6; X.sub("Алиса", "Мы стоим?! Я опаздываю!!", 3); } } } else c.slow = 0;
      if (FC.police && FC.police.stars > 0) c.mood -= 3 * dt;
      c.mood = FC.clamp(c.mood, 0, 100);
      c.score = Math.round(c.mood);
      c.moodEl.innerHTML = "💅 Настроение <b>" + Math.round(c.mood) + "</b><div class='bar'><b style='width:" + Math.round(c.mood) + "%'></b></div>";
      if (c.mood <= 0) { c.fail("Алиса вышла на ходу и поставила одну звезду"); return; }
      if (d2(pl, p.dst) < 11 && v < 5) { X.sub("Алиса", c.mood > 85 ? "Ты лучший! Подписываюсь на тебя!" : "Ну… доехали. Спасибо.", 4); c.pass({ v: Math.round(c.mood) }); return; }
      c.obj("Вези Алису на <b>съёмку</b> 🎬 · " + Math.round(d2(pl, p.dst)) + " м");
    },
    done: function (c, medal, v) { if (v >= 95) X.ach("mis_vip_five"); }
  });

  /* =========================================================================================================== */
  /* 7. «Уличная гонка» — три соперника, «резинка»                                                                */
  /* =========================================================================================================== */
  function racePlan(a, w, b) {
    var la = X.lane(a.x, a.z), r1 = X.route(la, X.lane(w.x, w.z)), r2 = X.route(X.lane(w.x, w.z), X.lane(b.x, b.z));
    var pts = r1.pts.concat(r2.pts.slice(1)), r = X.poly(pts);
    // ограничение скорости в вершинах маршрута по углу поворота (соперникам — тормозить перед углами)
    var lim = r.pts.map(function (q, i) {
      if (i === 0 || i === r.pts.length - 1) return 60;
      var A = r.pts[i - 1], B = r.pts[i + 1], h1 = Math.atan2(q.x - A.x, q.z - A.z), h2 = Math.atan2(B.x - q.x, B.z - q.z);
      var th = Math.abs(FC.angWrap(h2 - h1));
      return th < 0.12 ? 60 : FC.clamp(60 - th * 40, 13, 60);
    });
    return { start: sw(la.x, la.z), a: la, route: r, lim: lim, cps: X.checkpoints(r, 320), L: r.L };
  }
  var RACERS = MINSK ? [["Шумахер с Каменной Горки", "sport", 0xffd23f], ["Таксист Гена", "ingw_st", 0x2f9e44], ["Дрифт-Катя", "muscle", 0xe11d48]]
    : [["Шумахер из Москвы", "sport", 0xffd23f], ["Таксист Гена", "ingw_st", 0x2f9e44], ["Дрифт-Катя", "muscle", 0xe11d48]];
  X.def({ id: "race", title: "Уличная гонка", icon: "🏁", kind: "car", pay: 1600,
    short: "Три соперника, место — медаль",
    desc: MINSK ? "Ночной спринт от Немиги к Минск-Арене по проспекту Победителей. Три соперника. Первое место — золото, второе — серебро, третье — бронза."
      : "Спринт через весь город против трёх местных гонщиков. Первое место — золото, второе — серебро, третье — бронза.",
    plan: function () { return MINSK ? racePlan({ x: -2050, z: -200 }, { x: -3300, z: -1150 }, { x: -6400, z: -3900 }) : racePlan({ x: -300, z: 900 }, { x: 800, z: 700 }, { x: 850, z: -400 }); },
    medals: function () { return { by: "place", g: 1, s: 2, b: 3, limit: 420 }; },
    intro: function () { return [say(RACERS[0][0], "😎", "Новенький? Ну, посмотрим, что у тебя под капотом."), say(FC.MASCOT.name, "mascot", "Точки — по порядку. Соперники срезают углы хуже тебя — пользуйся.")]; },
    setup: function (c) {
      var p = c.plan, r = p.route, q = {};
      pathAt(r, 0, q);
      var rx = -Math.cos(q.h), rz = Math.sin(q.h);
      c.my = c.car("sport", q.x - rx * 1.6, q.z - rz * 1.6, q.h, { color: 0xff6a1a });
      FC.cars.enter(c.my);
      c.racers = RACERS.map(function (R, k) {
        var s = k === 0 ? 0 : -9 * k, off = k === 0 ? 3.4 : k === 1 ? 0 : 3.4;
        pathAt(r, s, q);
        var car = c.car(R[1], q.x + (-Math.cos(q.h)) * off, q.z + Math.sin(q.h) * off, q.h, { color: R[2], owned: false, driver: "mis", ai: { mode: "mis" } });
        return { car: car, s: s, v: 0, off: off, name: R[0], vmax: 52 + k * 2, done: false, idx: 0 };
      });
      c.i = 0; c.off = 0; c.ps = 0; c.order = [];
      cpShow(c, p.cps, 0, "🏁");
      c.obj("Гонка! Точки — по порядку");
    },
    tickCount: true,
    tick: function (c, dt) {
      var p = c.plan, r = p.route, pl = P(), q = tv;
      // соперники: кинематика по маршруту, скорость — по углам впереди и «резинка» к игроку
      c.ps = progress(r, pl, c.ps);
      for (var k = 0; k < c.racers.length; k++) {
        var R = c.racers[k], car = R.car;
        if (car.driver === "player" || car.dead) { R.done = true; continue; }
        if (c.state !== "run") { pathAt(r, R.s, q); car.x = q.x + (-Math.cos(q.h)) * R.off; car.z = q.z + Math.sin(q.h) * R.off; car.heading = q.h; car.vx = car.vz = 0; continue; }
        if (!R.done) {
          while (R.idx < r.cum.length - 1 && r.cum[R.idx + 1] < R.s) R.idx++;
          var lim = R.vmax;
          for (var j = R.idx + 1; j < r.cum.length && r.cum[j] < R.s + 70; j++) lim = Math.min(lim, p.lim[j] + (r.cum[j] - R.s) * 0.25);
          var gap = R.s - c.ps;
          if (gap > 110) lim *= 0.8; else if (gap < -110) lim *= 1.15;
          R.v = R.v < lim ? Math.min(lim, R.v + 7 * dt) : Math.max(lim, R.v - 14 * dt);
          R.s += R.v * dt;
          if (R.s >= r.L) { R.done = true; R.v = 0; c.order.push(k); }
        }
        pathAt(r, Math.min(R.s, r.L), q);
        var h0 = q.h;
        pathAt(r, Math.min(R.s + 7, r.L), q);
        var px = q.x, pz = q.z;
        pathAt(r, Math.min(R.s, r.L), q);
        car.x = q.x + (-Math.cos(h0)) * R.off; car.z = q.z + Math.sin(h0) * R.off;
        car.heading = FC.angDamp(car.heading, Math.atan2(px - q.x, pz - q.z), 8, dt);
        car.vx = Math.sin(car.heading) * R.v; car.vz = Math.cos(car.heading) * R.v; car.w = 0;
      }
      if (c.state !== "run") return;
      var place = 1;
      for (var n = 0; n < c.racers.length; n++) { var Rn = c.racers[n]; if (!Rn.done && Rn.car.driver !== "player" ? Rn.s > c.ps : c.order.indexOf(n) >= 0) place++; }
      c.place = Math.min(4, place);
      if (pl.car !== c.my) {
        c.off += dt; c.obj("Вернись в машину! <b>" + Math.max(0, Math.ceil(12 - c.off)) + "</b>");
        if (c.off > 12 || c.my.wrecked) c.fail("Сошёл с гонки");
        return;
      }
      c.off = 0;
      if (c.my.wrecked) { c.fail("Машина разбита"); return; }
      var cp = p.cps[c.i];
      if (d2(pl, cp) < 16) {
        c.i++; snd("note");
        if (c.i >= p.cps.length) { var fin = 1 + c.order.length; pop(fin === 1 ? "ПОБЕДА!" : fin + "-е МЕСТО", fin === 1 ? "#ffd23f" : "#fff", true); c.pass({ v: fin, noMedal: fin > 3 }); return; }
        cpShow(c, p.cps, c.i, "🏁");
      }
      c.obj("Место <b>" + c.place + "/4</b> · точка " + (c.i + 1) + "/" + p.cps.length);
    },
    hud: function (c) { return "<small>место " + (c.place || 1) + "/4</small>"; },
    done: function (c, medal, v) { if (v === 1) X.ach("mis_race_win"); }
  });
  // прогресс игрока по маршруту: ближайшая точка в окне [s−60, s+200]
  function progress(r, pl, s) {
    var best = s, bd = 1e18, lo = 0;
    while (lo < r.cum.length - 1 && r.cum[lo + 1] < s - 60) lo++;
    for (var i = lo; i < r.pts.length - 1 && r.cum[i] < s + 200; i++) {
      var A = r.pts[i], B = r.pts[i + 1], dx = B.x - A.x, dz = B.z - A.z, l2 = dx * dx + dz * dz || 1;
      var t = FC.clamp(((pl.x - A.x) * dx + (pl.z - A.z) * dz) / l2, 0, 1), qx = A.x + dx * t - pl.x, qz = A.z + dz * t - pl.z, d = qx * qx + qz * qz;
      if (d < bd) { bd = d; best = r.cum[i] + Math.sqrt(l2) * t; }
    }
    return best;
  }

  /* =========================================================================================================== */
  /* 8. «Каскадёр» — пять трамплинов на перекрытой улице                                                          */
  /* =========================================================================================================== */
  X.def({ id: "stunts", title: "Каскадёр", icon: "🤸", kind: "car", pay: 1400,
    short: "Пять трамплинов по порядку",
    desc: "Киностудия перекрыла улицу для съёмки погони. Пять трамплинов — прыгай по порядку (полёт от 0,45 с). Разбил машину — дубль сорван.",
    plan: function () {
      var a, b;
      if (MINSK) { a = mk("uruchye"); b = { x: 5687, z: -4220 }; }
      else { a = { x: -800, z: M.HALF }; b = { x: 650, z: M.HALF }; }
      var la = X.lane(a.x, a.z), lb = X.lane(b.x, b.z), r = X.route(la, lb), ramps = [], q = {};
      for (var k = 1; k <= 5; k++) {
        X.polyAt(r, r.L * k / 6, q);
        var ox = -Math.cos(q.h) * 1.8, oz = Math.sin(q.h) * 1.8;
        ramps.push(rampAt(q.x + ox, q.z + oz, q.h));
      }
      return { start: sw(la.x, la.z), a: la, route: r, ramps: ramps, L: r.L };
    },
    medals: function (p) { return { by: "time", g: Math.round(p.L / 30 + 6), s: Math.round(p.L / 23 + 12), b: Math.round(p.L / 17 + 20), limit: Math.round((p.L / 17 + 20) * 1.6) }; },
    intro: [say("Режиссёр", "🎬", "Мотор! Пять трамплинов, камера ведёт. Разгоняйся — на малой скорости не взлетишь."), say("Режиссёр", "🎬", "Порядок важен: прыжок мимо очереди не считаю.")],
    setup: function (c) {
      var p = c.plan;
      c.my = c.car("sport", p.a.x, p.a.z, p.a.h, { color: 0x1d4ed8 });
      FC.cars.enter(c.my);
      p.ramps.forEach(function (r) { c.ramp(r); });
      c.add(rampMesh(p.ramps, "#1d1d1f", "#ffc21a"));
      c.i = 0; c.off = 0; c.launch = -1; c.airT = 0; c.clearT = 0;
      c.mark("cp", p.ramps[0], { ring: 0, icon: "1", color: "#ffc21a" });
      c.obj("Трамплин <b>1/5</b>");
    },
    tick: function (c, dt) {
      var p = c.plan, pl = P(), car = c.my;
      // перекрытие: трафик у трамплинов убираем (если игрок далеко — исчезновения не видно)
      c.clearT -= dt;
      if (c.clearT <= 0) {
        c.clearT = 0.4;
        FC.cars.list.slice().forEach(function (o) {
          if (!o.ai || o.ai.mode !== "lane" || o.driver === "player") return;
          for (var k = c.i; k < p.ramps.length; k++) if (Math.hypot(o.x - p.ramps[k].x, o.z - p.ramps[k].z) < 22 && Math.hypot(o.x - pl.x, o.z - pl.z) > 45) { FC.cars.remove(o); return; }
        });
      }
      if (car.wrecked) { c.fail("Машина разбита — дубль сорван"); return; }
      if (pl.car !== car) { c.off += dt; c.obj("Вернись в машину! <b>" + Math.max(0, Math.ceil(10 - c.off)) + "</b>"); if (c.off > 10) c.fail("Каскадёр ушёл со съёмки"); return; }
      c.off = 0;
      if (car.air && c.launch < 0) {
        for (var k = 0; k < p.ramps.length; k++) if (Math.hypot(car.x - p.ramps[k].x, car.z - p.ramps[k].z) < 9) { c.launch = k; c.airT = 0; if (FC.fx && FC.fx.hitstop && k === c.i) FC.fx.hitstop(0.5, 0.35); break; }
      }
      if (c.launch >= 0) {
        if (car.air) c.airT += dt;
        else {
          if (c.launch === c.i && c.airT >= 0.45) {
            c.i++; snd("cash"); pop("ПРЫЖОК " + c.i + "/5", "#ffc21a", true);
            if (c.i >= p.ramps.length) { c.pass(); return; }
            c.mark("cp", p.ramps[c.i], { ring: 0, icon: String(c.i + 1), color: "#ffc21a" });
          } else if (c.launch !== c.i) pop("НЕ ПО ПОРЯДКУ", "#ff9aa5");
          else pop("МАЛО ПОЛЁТА — РАЗГОНИСЬ", "#ff9aa5");
          c.launch = -1;
        }
      }
      c.obj("Трамплин <b>" + (c.i + 1) + "/5</b> · " + Math.round(d2(pl, p.ramps[c.i])) + " м");
    },
    hud: function (c) { return "<small>прыжки " + c.i + "/5</small>"; },
    done: function () { X.ach("mis_stunts"); }
  });

  /* =========================================================================================================== */
  /* 9. «Водитель налёта» — тихо или громко                                                                       */
  /* =========================================================================================================== */
  X.def({ id: "getaway", title: "Водитель налёта", icon: "💰", kind: "car", pay: 2000,
    short: "Забрать команду, оторваться, в гараж",
    desc: "Команда Лиса чистит ломбард «Блеск». Ты — за рулём: подъехать к чёрному ходу, забрать двоих, оторваться от «Щита» и спрятаться в гараже. Подход — твой выбор.",
    choice: { title: "Как идём?", opts: [{ id: "quiet", label: "🤫 Тихо — 1★ позже, награда ×1" }, { id: "loud", label: "💥 Громко — сразу 3★, награда ×1,6" }] },
    plan: function () {
      var pkB = null, base = MINSK ? mk("komar") : { x: 420, z: -260 }, bd = 1e18;
      (MINSK ? M.buildings : M.pois).forEach(function (B) {
        if (!B.doors || !B.doors.length || B.zone || B === M.hq || B.poi === "police" || B.poi === "hospital") return;
        if (MINSK && !X.safe(B.x, B.z)) return;
        var d = Math.hypot(B.x - base.x, B.z - base.z); if (d < bd) { bd = d; pkB = B; }
      });
      var pk = pkB ? doorOf(pkB) : base, lpk = X.lane(pk.x, pk.z);
      var a = nodeAt(lpk.x, lpk.z, 200, 360, 280), la = X.lane(a.x, a.z);
      var sv = nodeAt(lpk.x, lpk.z, 900, 1500, 1150), ls = X.lane(sv.x, sv.z);
      var L = X.route(la, lpk).L + X.route(lpk, ls).L;
      return { start: sw(la.x, la.z), a: la, pk: lpk, safe: ls, L: L };
    },
    medals: function (p) { var b = Math.round(p.L / 11 + 85); return { by: "time", g: Math.round(p.L / 22 + 30), s: Math.round(p.L / 16 + 55), b: b, limit: Math.max(420, Math.round(b * 1.3)) }; },
    intro: [say("Лис", "🦊", "Мы внутри. Подгоняй тачку к чёрному ходу — и без глупостей."), say("Лис", "🦊", "Гараж знаешь где. Хвост за собой не тащи.")],
    setup: function (c) {
      var p = c.plan;
      c.my = c.car("muscle", p.a.x, p.a.z, p.a.h, { color: 0x111111 });
      FC.cars.enter(c.my);
      c.phase = "drive"; c.off = 0; c.callT = 0;
      c.payMul = c.data.choice === "loud" ? 1.6 : 1;
      c.mark("pk", p.pk, { ring: 5, icon: "🦊", color: "#ff9b4a" });
      c.obj("Подъезжай к <b>чёрному ходу</b> 🦊");
    },
    tick: function (c, dt) {
      var p = c.plan, pl = P(), car = c.my, v = spd(), stars = FC.police ? FC.police.stars : 0;
      if (car.wrecked) { c.fail("Машина разбита — команда в шоке"); return; }
      if (pl.car !== car) { c.off += dt; c.obj("В машину! <b>" + Math.max(0, Math.ceil(10 - c.off)) + "</b>"); if (c.off > 10) c.fail("Ты бросил команду"); return; }
      c.off = 0;
      if (c.phase === "drive") {
        if (d2(pl, p.pk) < 9 && v < 4) {
          c.phase = "board"; c.unmark("pk"); c.crew = []; c.boardT = 0;
          for (var i = 0; i < 2; i++) { var ch = c.npc(FC.people.randomCell(), p.pk.x + 4 + i * 1.5, p.pk.z + 4, { scale: 1.85 }); c.crew.push(ch); }
          FC.people.say(c.crew[0], "Гони, гони, гони!", 3);
          snd("wanted");
        } else c.obj("Подъезжай к <b>чёрному ходу</b> 🦊 · " + Math.round(d2(pl, p.pk)) + " м");
        return;
      }
      if (c.phase === "board") {
        c.boardT += dt;
        c.crew.forEach(function (ch) { if (!ch.visible) return; var dx = car.x - ch.x, dz = car.z - ch.z, dd = Math.hypot(dx, dz); if (dd < 1.6) ch.visible = false; else { ch.x += dx / dd * 6 * dt; ch.z += dz / dd * 6 * dt; ch.speed = 6; ch.vx = dx / dd * 6; ch.vz = dz / dd * 6; } });
        c.obj("Команда садится…");
        if (c.boardT > 1.6) {
          c.crew.forEach(function (ch) { ch.visible = false; });
          c.phase = "run"; snd("door");
          if (c.data.choice === "loud") { if (FC.police && FC.police.add) FC.police.add(3); X.sub("Лис", "Сигнализация орёт! Три звезды — уходи дворами!", 4); }
          else { c.callT = 12; X.sub("Лис", "Тихо вышли. Но свидетель уже звонит — валим.", 4); }
          c.mark("safe", p.safe, { ring: 6, icon: "🏠", color: "#7dffb0" });
        }
        return;
      }
      if (c.callT > 0) { c.callT -= dt; if (c.callT <= 0 && FC.police && FC.police.add) { FC.police.add(1); X.sub("Лис", "Нас засекли. Одна звезда — сбрось её.", 3); } }
      var atSafe = d2(pl, p.safe) < 9;
      if (atSafe && stars === 0 && c.callT <= 0 && v < 5) { X.sub("Лис", "Чисто сработано. Твоя доля — как договаривались.", 4); c.pass(); return; }
      c.obj(stars > 0 ? "Оторвись от «Щита» <b>" + stars + "★</b>, потом в <b>гараж</b> 🏠" : atSafe ? "Тормози в гараже" : "Гони в <b>гараж</b> 🏠 · " + Math.round(d2(pl, p.safe)) + " м");
    },
    done: function (c, medal) { if (c.data.choice === "loud" && medal === "g") X.ach("mis_getaway_loud"); if (FC.police) FC.police.clear(); }
  });

  /* =========================================================================================================== */
  /* 10. «Краш-тест» — видеорегистратор, очки за удары                                                           */
  /* =========================================================================================================== */
  FC.css([
    ".mi-dash{position:fixed;left:14px;top:calc(14px + var(--safe-t,0px));z-index:6;pointer-events:none;font:700 13px ui-monospace,Menlo,monospace;color:#fff;",
    "  text-shadow:0 1px 3px #000;letter-spacing:.04em}.mi-dash b{color:#ff3b30;animation:midash 1s steps(2) infinite}@keyframes midash{50%{opacity:0}}",
    ".mi-dash:before{content:'';position:fixed;inset:10px;border:2px solid rgba(255,255,255,.25);border-radius:8px;pointer-events:none}",
    ".mi-mood{position:fixed;right:14px;top:calc(176px + var(--safe-t,0px));z-index:6;pointer-events:none;font:700 13px system-ui;color:#fff;text-shadow:0 1px 4px #000;text-align:right}",
    ".mi-mood .bar{width:150px;height:9px;border-radius:6px;background:rgba(0,0,0,.45);margin:4px 0 0 auto;overflow:hidden}",
    ".mi-mood .bar b{display:block;height:100%;background:linear-gradient(90deg,#ff5d6c,#ffcf7a,#ff8fb8)}"
  ].join("\n"));
  X.def({ id: "crash", title: "Краш-тест", icon: "💥", kind: "car", pay: 1200,
    short: "60 секунд регистратора: очки за удары",
    desc: "Страховая «Огонёк-Полис» снимает рекламу про видеорегистраторы. У тебя минута и седан-манекен: очки за силу ударов (квадрат скорости), комбо — удары подряд, взрыв чужой машины +800. Тебе ничего не будет — ты в ремнях.",
    plan: function () { var a = MINSK ? { x: 300, z: -1800 } : { x: 150, z: -180 }, la = X.lane(a.x, a.z); return { start: sw(la.x, la.z), a: la }; },
    medals: function () { return { by: "score", g: 10000, s: 5000, b: 2000, limit: null }; },
    intro: [say("Оператор", "🎥", "Регистратор пишет. Минута. Бей сильнее — страховой нужна драма."), say("Оператор", "🎥", "Только людей не трогай — «Щит» рядом.")],
    setup: function (c) {
      var p = c.plan;
      c.my = c.car("sedan", p.a.x, p.a.z, p.a.h, { color: 0xf2f2f2 });
      FC.cars.enter(c.my);
      if (FC.cars.fillTraffic) FC.cars.fillTraffic(40);
      c.combo = 1; c.lastHit = -9; c.dash = c.el("mi-dash", "");
      var inv0 = P().invuln || 0; P().invuln = 1e6;
      c.clean(function () { P().invuln = inv0; });
      c.on("car:crash", function (e) {
        if (c.state !== "run" || e.power < 3 || (e.car !== c.my && e.other !== c.my)) return;
        c.combo = c.t - c.lastHit < 2.5 ? Math.min(5, c.combo + 1) : 1; c.lastHit = c.t;
        var pts = Math.round(e.power * e.power * 1.2) * c.combo;
        c.score += pts; pop("+" + pts + (c.combo > 1 ? " ×" + c.combo : ""), c.combo > 2 ? "#ff5d8f" : "#ffcf7a", pts > 800);
      });
      c.on("car:explode", function (e) {
        if (c.state !== "run") return;
        if (e.car === c.my) { c.score += 1500; pop("ФИНАЛ +1500", "#ff3b30", true); c.later(1.2, function () { c.pass({ v: c.score }); }); }
        else if (Math.hypot(e.car.x - c.my.x, e.car.z - c.my.z) < 30) { c.score += 800; pop("ВЗРЫВ +800", "#ff9b4a", true); }
      });
      c.on("stunt", function (e) { if (c.state === "run" && e.kind === "air") { c.score += Math.round(e.score / 2); } });
      c.obj("Минута хаоса — <b>бей сильнее</b>");
    },
    tick: function (c) {
      var d = new Date(2026, 10, 22, 13, 0, Math.floor(c.t));
      c.dash.innerHTML = "<b>● REC</b> КРАШ-ТЕСТ · " + d.toLocaleTimeString("ru-RU") + " · " + Math.round(spd() * 3.6) + " км/ч";
      if (c.t >= 60) { c.pass({ v: c.score }); return; }
      if (P().car !== c.my && !c.my.wrecked) c.obj("Обратно за руль — время идёт!");
      else c.obj("Очки <b>" + c.score + "</b> · комбо ×" + c.combo + " · осталось " + Math.ceil(60 - c.t) + " с");
    },
    hud: function (c) { return "<small>осталось " + Math.max(0, Math.ceil(60 - c.t)) + " с</small>"; },
    done: function (c, medal, v) { if (v >= 10000) X.ach("mis_crash_master"); }
  });

  /* =========================================================================================================== */
  /* 11. «Дроны СкукаСофт» — сюжет города                                                                          */
  /* =========================================================================================================== */
  var droneGeo = null, droneMat = null, rotorMat = null, lampMat = null;
  function droneMesh() {
    if (!droneGeo) {
      droneGeo = new T.BoxGeometry(1.6, 0.5, 1.6);
      droneMat = new T.MeshStandardMaterial({ color: 0x8a8f98, roughness: 0.5, metalness: 0.3 });
      rotorMat = new T.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.5 });
      lampMat = new T.MeshBasicMaterial({ color: 0xff2020, toneMapped: false });
    }
    var g = new T.Group(), b = new T.Mesh(droneGeo, droneMat); b.userData.shared = true; g.add(b);
    var rg = new T.CylinderGeometry(0.7, 0.7, 0.04, 12);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (s) { var r = new T.Mesh(rg, rotorMat); r.position.set(s[0] * 1.1, 0.3, s[1] * 1.1); g.add(r); });
    var l = new T.Mesh(new T.SphereGeometry(0.18, 6, 4), lampMat); l.position.y = -0.35; g.add(l); g.userData.lamp = l;
    g.scale.setScalar(1.6);
    return g;
  }
  X.def({ id: "drones", title: "Дроны СкукаСофт", icon: "🛸", kind: "air", pay: 2200,
    short: "Сюжет: перехвати дронов-воров",
    desc: "«СкукаСофт» запустила дронов, которые воруют идеи из черновиков агентов Флейм. Перехвати на вертолёте шесть дронов — подлети вплотную. Они удирают, если подлететь в лоб.",
    plan: function () {
      var st = MINSK ? { x: 4250, z: -3560 } : doorOf(M.hq), r = FC.rng(FC.hash("drones" + FC.city)), pts = [];
      for (var i = 0; i < 6; i++) { var a = i / 6 * Math.PI * 2 + r() * 0.6, d = 280 + r() * 380; pts.push({ x: st.x + Math.cos(a) * d, z: st.z + Math.sin(a) * d, y: 45 + r() * 45, ph: r() * 6 }); }
      // длина облёта ближайшим соседом — от неё пороги
      var L = 0, cx = st.x, cz = st.z, left = pts.slice();
      while (left.length) { left.sort(function (a, b) { return Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz); }); var n = left.shift(); L += Math.hypot(n.x - cx, n.z - cz); cx = n.x; cz = n.z; }
      return { start: sw(st.x, st.z), hover: st, drones: pts, L: L };
    },
    medals: function (p) { return { by: "time", g: Math.round(p.L / 26 + 25), s: Math.round(p.L / 20 + 45), b: Math.round(p.L / 15 + 70), limit: Math.round((p.L / 15 + 70) * 1.6) }; },
    intro: [ogo("Тревога! «СкукаСофт» запустила дронов. Они висят над городом и тянут идеи из черновиков агентов."),
      say("Искра — агент Флейм", "🤖", "Мой черновик рилса утащили прямо из монтажки! Там был лучший хук недели!"),
      ogo("Бери вертолёт. Подлети к дрону вплотную — он отключится и вернёт идеи. Заходи сбоку: в лоб они удирают.")],
    setup: function (c) {
      var p = c.plan;
      c.A = heliStart(c, "heli_light", p.hover.x, p.hover.z, 35, 0);
      c.ds = p.drones.map(function (d, i) {
        var g = droneMesh(); c.add(g);
        var D = { g: g, cx: d.x, cz: d.z, x: d.x, z: d.z, y: d.y, ph: d.ph, flee: 0, vx: 0, vz: 0, got: false, id: "d" + i };
        c.mark(D.id, D, { beam: false, ring: 0, route: false, icon: "🛸", color: "#9aa3ad" });
        return D;
      });
      c.got = 0;
      c.obj("Перехвати <b>дронов</b> 🛸 — 0/6");
    },
    tick: function (c, dt) {
      var A = c.A, t = performance.now() / 1000;
      if (!A || A.wrecked) { c.fail("Вертолёт разбит"); return; }
      if (P().air !== A) { c.fail("Ты покинул вертолёт"); return; }
      for (var i = 0; i < c.ds.length; i++) {
        var D = c.ds[i]; if (D.got) continue;
        var dx = D.x - A.x, dz = D.z - A.z, dh = Math.hypot(dx, dz);
        if (dh < 85 && D.flee <= 0 && Math.abs(FC.angWrap(Math.atan2(dx, dz) - A.yaw)) < 0.5) D.flee = 4;   // заметил в лоб
        if (D.flee > 0) {
          D.flee -= dt;
          D.vx = FC.damp(D.vx, dx / (dh || 1) * 22, 2, dt); D.vz = FC.damp(D.vz, dz / (dh || 1) * 22, 2, dt);
        } else {
          var ang = t * 0.35 + D.ph, tx = D.cx + Math.cos(ang) * 40, tz = D.cz + Math.sin(ang) * 40;
          D.vx = FC.damp(D.vx, (tx - D.x) * 0.6, 1.5, dt); D.vz = FC.damp(D.vz, (tz - D.z) * 0.6, 1.5, dt);
        }
        D.x += D.vx * dt; D.z += D.vz * dt;
        D.yT = (D.yT || 0) - dt;
        if (D.yT <= 0) { D.yT = 0.5; D.y = Math.max(D.y0 || (D.y0 = D.y), gnd(D.x, D.z) + 16); }
        if (Math.hypot(D.x - D.cx, D.z - D.cz) > 400) { D.cx = D.x; D.cz = D.z; }
        D.g.position.set(D.x, D.y + Math.sin(t * 2 + D.ph) * 0.8, D.z); D.g.rotation.y += dt * 0.6;
        D.g.userData.lamp.visible = (t * 2 + D.ph) % 1 < 0.5;
        c.move(D.id, D.x, D.z);
        if (d3(A.x, A.y, A.z, D.x, D.y, D.z) < 8) {
          D.got = true; c.got++; c.unmark(D.id); D.g.visible = false;
          if (FC.fx) { FC.fx.burst(D.x, D.y, D.z, "sparks", 24); FC.fx.burst(D.x, D.y, D.z, "confetti", 18); }
          snd("cash"); pop("🛸 ДРОН " + c.got + "/6", "#7dffb0", true);
          if (c.got === 3) X.sub("Искра — агент Флейм", "Мой хук вернулся! Спасибо! Ещё три — и черновики целы.", 5);
          if (c.got >= c.ds.length) { c.pass(); return; }
        }
      }
      c.obj("Перехвати <b>дронов</b> 🛸 — " + c.got + "/6");
    },
    hud: function (c) { return "<small>дроны " + c.got + "/6</small>"; },
    done: function () {
      X.ach("mis_drones");
    }
  });
})(window);
