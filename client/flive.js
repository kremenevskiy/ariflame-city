/* Флейм-Сити — жизнь мест (FC.live): бульвары и площади из пакетов мест (FC.places.streets) не бывают пустыми.
 * Задача 23.11: «на бульваре Маяка никто не гуляет — должны стоять мотоциклы, пара тачек, людей много, чтобы не было
 * ощущения, что ты один; и так — на всех точках старта».
 *
 * - Люди: вдоль каждой улицы шире 6 м гуляют (FC.people.strollLine): по 1 на ~7 м, до 40 на бульвар, пары болтают;
 *   новые появляются за спиной или вдали, не перед носом. У точек старта районов — свои гуляющие (fpeople).
 * - Транспорт: у краёв бульвара шире 14 м — группы мотоциклов (2–3, поперёк края) через ~55 м и пара машин у краёв,
 *   по уровню района (FC.osm.tierAt: на Маяке — дорогие, часть заниженные). Места держатся: ушёл дальше 260 м —
 *   машины убираются, вернулся — встают снова (в кадре — только при старте/перемещении или дальше 110 м).
 */
(function (global) {
  "use strict";
  var FC = global.FC, M = FC.map, G = FC.gfx;
  if (!FC.places || !FC.people || !FC.cars) return;

  var slots = [], ready = false;
  var MOTO_RICH = ["moto", "moto", "moto_c"], MOTO = ["moto_c", "moto_c", "moto"];
  function rnd(seed) { return FC.rng ? FC.rng(FC.hash ? FC.hash(seed) : 7) : Math.random; }

  function setup() {
    if (ready) return; ready = true;
    var streets = FC.places.streets || [], low = G.Q && G.Q.level === "low";
    streets.forEach(function (S, si) {
      var pts = S.points, w = S.width || 8;
      if (!pts || pts.length < 2 || w < 6) return;
      var L = 0; for (var i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      var n = Math.min(low ? 18 : 40, Math.max(6, Math.round(L / 7 * (low ? 0.5 : 1))));
      FC.people.strollLine(pts, w, n);
      if (w >= 14) vehicles(S, si, pts, w);
    });
  }

  // места транспорта у краёв бульвара: мотоциклы группами поперёк края, машины — вдоль, ближе к концам
  function vehicles(S, si, pts, w) {
    var r = rnd("live" + (S.id || si)), acc = 0, next = 18, cars = 0;
    for (var i = 1; i < pts.length; i++) {
      var ax = pts[i - 1][0], az = pts[i - 1][1], dx = pts[i][0] - ax, dz = pts[i][1] - az, len = Math.hypot(dx, dz) || 1;
      var fx = dx / len, fz = dz / len, h = Math.atan2(fx, fz);
      for (var s = 0; s < len; s += 3) {
        acc += 3; if (acc < next) continue;
        acc = 0; next = 45 + r() * 25;
        var side = r() < 0.5 ? 1 : -1, off = (w / 2 - 2.2) * side;
        var bx = ax + fx * s - fz * off, bz = az + fz * s + fx * off;
        if (cars < 2 && r() < 0.35) {                                  // машина вдоль края
          slots.push({ x: bx, z: bz, h: h, kind: "car", r: r(), car: null });
          cars++;
        } else {                                                         // 2–3 мотоцикла поперёк края
          var k = r() < 0.5 ? 2 : 3;
          for (var j = 0; j < k; j++) slots.push({ x: bx + fx * (j * 1.25), z: bz + fz * (j * 1.25), h: h + side * Math.PI / 2 + (r() - 0.5) * 0.3, kind: "moto", r: r(), car: null });
        }
      }
    }
  }

  function free(x, z, rad, gap) {
    if (M.water(x, z) || (M.buildingAt && M.buildingAt(x, z, rad)) || M.collide(x, z, rad, { noProps: true }).hit) return false;
    for (var i = 0; i < FC.cars.list.length; i++) { var c = FC.cars.list[i]; if (FC.dist2(c.x, c.z, x, z) < gap * gap) return false; }
    return true;
  }
  function spawnAt(sl) {
    var tier = FC.osm && FC.osm.tierAt ? FC.osm.tierAt(sl.x, sl.z) : 1, type, opt;
    if (sl.kind === "moto") {
      var list = tier >= 3 ? MOTO_RICH : MOTO; type = list[Math.floor(sl.r * list.length) % list.length];
      opt = { parked: true, color: tier >= 3 ? [0x111214, 0xff6a1a, 0xf4f4f2, 0x9be02a, 0x0f2a4a][Math.floor(sl.r * 50) % 5] : null };
    } else if (FC.osm && FC.osm.parkPick) {
      var pk = FC.osm.parkPick(sl.x, sl.z, sl.r); type = pk.type; opt = pk.opt;
    } else { type = "sedan"; opt = { parked: true }; }
    if (!FC.cars.TYPES[type]) return null;
    return FC.cars.spawn(type, sl.x, sl.z, sl.h, opt);
  }

  var T = 0;
  FC.addSystem({
    name: "live", order: 41,
    update: function (dt) {
      if (!ready) { if (FC.started && FC.places.loaded !== false) setup(); return; }
      T -= dt; if (T > 0) return; T = 0.5;
      var P = FC.player; if (!P || (FC.inside && FC.inside.active)) return;
      var fill = performance.now() < (FC.fillUntil || 0) || !FC.started, spawned = 0;
      for (var i = 0; i < slots.length; i++) {
        var sl = slots[i], d2 = FC.dist2(sl.x, sl.z, P.x, P.z);
        if (sl.car && (FC.cars.list.indexOf(sl.car) < 0 || sl.car.driver !== "none" || !sl.car.parked)) sl.car = null;   // угнали, взорвали, убрали
        if (sl.car && d2 > 260 * 260) { FC.cars.remove(sl.car); sl.car = null; continue; }
        if (sl.car || d2 > 200 * 200 || spawned >= 6) continue;
        if (!fill && d2 < 110 * 110 && G.inView && G.inView(sl.x, 1, sl.z)) continue;
        if (!free(sl.x, sl.z, sl.kind === "moto" ? 0.6 : 1.6, sl.kind === "moto" ? 1.0 : 3.6)) continue;
        sl.car = spawnAt(sl); if (sl.car) spawned++;
      }
    }
  });

  FC.live = { slots: slots, setup: setup };
})(window);
