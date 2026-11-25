/* Флейм-Сити — «Рядом с игроками» (FC.crowd, 25.11.2026): начать игру или переместиться туда, где больше всего народу.
 *
 * Задача владельца: «добавь режим спавна — чтобы ты мог спавниться сразу рядом с каким-то игроком, а если их несколько —
 * рядом с большинством игроков». Игровой сервер (server/crowd.py, GET /g/crowd) отдаёт одну точку — центр самой
 * плотной кучки игроков города на клетке 20 м, как в «who» (точное место — только другу, аудит L-4), — и сколько их.
 *  • «Где начнёшь?» (экран fplaces — FC.places.pickSpawn): карточка «Рядом с игроками · N онлайн» — только если в городе
 *    кто-то есть; ответ сервера ждём до 0,9 с, чтобы карточка встала в сетку сразу, а не «прыгнула» под пальцем.
 *  • Большая карта: кнопка «👥 К игрокам» — через FC.hud.teleport (розыск, ограбление — его проверки; за рулём — с машиной).
 *  • Точка появления — тротуар в 15–40 м от центра: не в доме, не в воде, не на проезжей части, лицом к игрокам. В Минске
 *    дома и вода приходят с кусками города уже после старта: когда куски вокруг построены, точку проверяем ещё раз и при
 *    нужде переставляем на безопасный тротуар (игрок ещё не ушёл сам).
 *
 * FC.crowd: {last, get(me) → Promise<{city, online, n, x, z}|null>, wait(ms, cb), card() → html|"", spawn() → место
 *   старта для FC.places.spawnAt, spot(cx, cz, seed) → {x, z, h}|null, safe(x, z), settle(cx, cz, x0, z0, seed) — проверить
 *   место, когда куски построены, go(fromMap) → Promise<bool>}
 */
(function (global) {
  "use strict";
  var FC = global.FC;
  if (!FC || !FC.map) return;
  var M = FC.map, CITY = FC.city || "flame";
  var C = { last: null, lastT: 0 };
  var early = null;

  function plural(n, a, b, c) { var m = n % 100, k = n % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k > 1 && k < 5 ? b : c; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch]; }); }
  function myId() { return FC.mp && FC.mp.connected && FC.mp.id != null ? FC.mp.id : null; }

  /* ---- сервер ------------------------------------------------------------------------------------------------- */
  C.get = function (me) {
    if (!FC.gfetch || (FC.gsOff && FC.gsOff())) return Promise.resolve(null);
    return FC.gfetch("/g/crowd?city=" + encodeURIComponent(CITY) + (me != null ? "&me=" + (+me) : ""), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var c = j && j.n > 0 && isFinite(j.x) && isFinite(j.z) ? { online: Math.max(j.online | 0, j.n | 0), n: j.n | 0, x: +j.x, z: +j.z } : null;
        C.last = c; C.lastT = performance.now();
        return c;
      })
      .catch(function () { return null; });
  };
  // ждём ответ не дольше ms (экран «Где начнёшь?»): сервер молчит — выбор без карточки
  C.wait = function (ms, cb) {
    var done = false;
    function fin() { if (!done) { done = true; cb(); } }
    if (!early) early = C.get(null);
    early.then(fin, fin);
    setTimeout(fin, ms);
  };
  // запрос — как только ясно, что будет выбор места: к показу экрана ответ обычно уже есть
  if (FC.places && FC.places.ready) FC.places.ready(function () { if (FC.places.wantPick() && !early) early = C.get(null); });

  /* ---- безопасная точка у центра кучки ------------------------------------------------------------------------- */
  // стоит ли игрок там, где стоять нельзя: в доме, в воде, на проезжей части (после старта — проверка уже на месте)
  function blocked(x, z, pad) { return M.water(x, z) || !!M.buildingAt(x, z, pad) || M.onRoad(x, z); }
  C.safe = function (x, z) {
    if (blocked(x, z, 1) || (M.field && M.field(x, z) < 3)) return false;    // field — река и озеро плана (есть всегда)
    // не в стволе дерева и не в столбе: столкновение вытолкнуло бы в сторону, а камера смотрела бы в кору
    var l = M.near ? M.near(x, z, 2) : [];
    for (var i = 0; i < l.length; i++) if (l[i].prop && Math.hypot(l[i].x - x, l[i].z - z) < (l[i].r || 0.3) + 1) return false;
    return true;
  };
  // Кандидат — тротуар у случайной точки кольца. В Минске sidewalkPoint берёт случайное место вдоль всей улицы (у длинных
  // проспектов — за 100–200 м), поэтому там — ближайшая к точке кольца точка тротуара той же улицы (walkBlock — полоса
  // вдоль ребра графа в w/2 + 1,7 м от оси, без перекрёстков); Флейм-Сити — его sidewalkPoint (края кварталов).
  function candidate(r, cx, cz, rad) {
    if (!M.walkBlock || !M.polyAt) return M.sidewalkPoint(r, cx, cz, rad);
    var a = r() * Math.PI * 2, d = 15 + r() * Math.max(1, rad - 15), x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    var blk = M.walkBlock(x, z, 60, r() < 0.5 ? 1 : -1), e = blk && M.edges[blk.edge];
    if (!blk || !e || e.bridge) return null;                                   // мост — над водой (её Минск знает позже)
    var per = blk.per, pts = per.pts, bs = 0, bd = 1e18;
    for (var i = 0; i < pts.length - 1; i++) {
      var ax = pts[i][0], az = pts[i][1], ex = pts[i + 1][0] - ax, ez = pts[i + 1][1] - az, L = ex * ex + ez * ez || 1e-9;
      var t = FC.clamp(((x - ax) * ex + (z - az) * ez) / L, 0, 1), qx = ax + ex * t - x, qz = az + ez * t - z, dd = qx * qx + qz * qz;
      if (dd < bd) { bd = dd; bs = per.cum[i] + t * (per.cum[i + 1] - per.cum[i]); }
    }
    var q = M.polyAt(per, FC.clamp(bs, per.s0, Math.max(per.s0, per.s1)));
    return { x: q[0], z: q[1] };
  }
  // Место в кольце 15–40 м от центра: 1) тротуар; 2) площадь, сквер, бульвар — открытое место без улицы рядом (у
  // Пл. Независимости, Верхнего города, бульвара Пикассо ближайшая улица графа — в 60–170 м); 3) тротуар ближе всего к кольцу
  C.spot = function (cx, cz, seed) {
    var r = FC.rng(seed || 1), best = null, bestOff = 1e9, i;
    function take(p) {
      if (!p || !C.safe(p.x, p.z)) return;
      var d = Math.hypot(p.x - cx, p.z - cz), off = d < 15 ? 15 - d : d > 40 ? d - 40 : 0;
      if (off < bestOff) { bestOff = off; best = p; }
    }
    for (i = 0; i < 80 && bestOff > 0; i++) take(candidate(r, cx, cz, 40));
    for (i = 0; i < 80 && bestOff > 0; i++) { var a = r() * Math.PI * 2, d = 15 + r() * 25; take({ x: cx + Math.cos(a) * d, z: cz + Math.sin(a) * d }); }
    for (i = 0; i < 80 && bestOff > 0; i++) take(candidate(r, cx, cz, i < 40 ? 70 : 150));
    return best ? { x: best.x, z: best.z, h: Math.atan2(cx - best.x, cz - best.z) } : null;
  };

  /* ---- Минск: дома и вода — с кусками города; построены — проверить, где стоим ---------------------------------- */
  var SUPERS = null;
  function chunksReady(x, z) {
    var O = FC.osm; if (!O || !O.loadedKeys || !O.meta) return true;
    var S = O.meta.sup || 1000, have = {};
    if (!SUPERS) { SUPERS = {}; (O.meta.supers || []).forEach(function (s) { SUPERS[s[0] + "_" + s[1]] = 1; }); }
    O.loadedKeys().forEach(function (k) { have[k] = 1; });
    for (var dx = -40; dx <= 40; dx += 80) for (var dz = -40; dz <= 40; dz += 80) {
      var k2 = Math.floor((x + dx) / S) + "_" + Math.floor((z + dz) / S);
      if (SUPERS[k2] && !have[k2]) return false;
    }
    return true;
  }
  var settle = C.settle = function (cx, cz, x0, z0, seed) {
    var t0 = performance.now();
    (function tick() {
      var P = FC.player;
      if (!P || P.dead || P.mode !== "foot" || (FC.inside && FC.inside.active)) return;
      if (Math.hypot(P.x - x0, P.z - z0) > 8) return;                         // уже пошёл сам — не дёргаем
      if (!chunksReady(P.x, P.z) && performance.now() - t0 < 20000) { setTimeout(tick, 500); return; }
      if (!blocked(P.x, P.z, 0.3)) return;
      var p = C.spot(cx, cz, seed + 7);
      if (p) P.teleport(p.x, p.z, p.h);
    })();
  };

  /* ---- «Где начнёшь?»: карточка и место старта --------------------------------------------------------------- */
  FC.css([
    "#spawnpick .card.crowd{background:#0b4a7a}",
    "#spawnpick .card.crowd .ph{position:relative;display:block;width:100%;aspect-ratio:16/10;overflow:hidden;background:",
    "radial-gradient(circle at 52% 54%,rgba(79,195,255,.34),rgba(79,195,255,0) 46%),",
    "repeating-linear-gradient(90deg,transparent 0 34px,rgba(154,160,168,.16) 34px 38px),",
    "repeating-linear-gradient(0deg,transparent 0 26px,rgba(154,160,168,.16) 26px 30px),#14203a}",
    "#spawnpick .card.crowd .ph i{position:absolute;width:12px;height:12px;margin:-8px 0 0 -8px;border-radius:50%;background:#4fc3ff;",
    "border:2px solid #fff;box-shadow:0 0 10px rgba(79,195,255,.9)}",
    "#spawnpick .card.crowd .ph i.ring{width:74px;height:74px;margin:-39px 0 0 -39px;background:none;border:2px solid rgba(79,195,255,.7);",
    "box-shadow:none;animation:cr-ring 1.8s ease-out infinite}",
    "#spawnpick .card.crowd .ph i.you{background:#ffcf7a;border-color:#000;box-shadow:0 0 10px rgba(255,207,122,.8)}",
    "#spawnpick .card.crowd .ph em{position:absolute;left:9px;top:9px;font:700 12px/1 system-ui,sans-serif;font-style:normal;color:#dff4ff;",
    "background:rgba(9,13,34,.78);padding:5px 9px 5px 8px;border-radius:999px}",
    "#spawnpick .card.crowd .ph em:before{content:'';display:inline-block;width:7px;height:7px;border-radius:50%;background:#3dff8a;",
    "margin-right:6px;vertical-align:1px;animation:cr-live 1.4s ease-in-out infinite}",
    "@keyframes cr-ring{from{transform:scale(.55);opacity:1}to{transform:scale(1.25);opacity:0}}",
    "@keyframes cr-live{50%{opacity:.35}}",
    "@media (prefers-reduced-motion:reduce){#spawnpick .card.crowd .ph i.ring,#spawnpick .card.crowd .ph em:before{animation:none}}"
  ].join(""));
  var DOTS = [[50, 57], [61, 47], [41, 51], [58, 68], [47, 41], [67, 60]];      // точки игроков — кучкой вокруг кольца
  C.card = function () {
    var c = C.last; if (!c || !c.n) return "";
    var D = M.district ? M.district(c.x, c.z) : null, where = D && D.name ? D.name : "";
    var dots = "<i class='ring' style='left:52%;top:54%'></i>";
    for (var i = 0; i < Math.min(c.n, DOTS.length); i++) dots += "<i style='left:" + DOTS[i][0] + "%;top:" + DOTS[i][1] + "%'></i>";
    dots += "<i class='you' style='left:24%;top:76%'></i>";
    var label = "Рядом с игроками · " + c.online + " онлайн";
    return "<button type='button' class='card crowd' data-i='crowd' aria-label='" + esc(label) + "'><i class='ph'>" + dots +
      "<em>" + c.online + " онлайн</em></i><b>Рядом с игроками</b><span>" +
      esc(c.n > 1 ? "Где больше всего народу" + (where ? " — " + where : "") : "Рядом с игроком" + (where ? " — " + where : "")) +
      "</span></button>";
  };
  // место старта: тротуар у кучки; точку ищем в момент выбора (у каждого своя — не «в одну точку» толпой)
  C.spawn = function () {
    var c = C.last; if (!c || !c.n) return null;
    var seed = (Math.random() * 1e9) | 0, p = C.spot(c.x, c.z, seed) || { x: c.x + 18, z: c.z + 18, h: Math.atan2(-18, -18) };
    return { x: p.x, z: p.z, h: p.h, id: "crowd", name: "Рядом с игроками", cx: c.x, cz: c.z, seed: seed,
      about: c.n + " " + plural(c.n, "игрок", "игрока", "игроков") + " рядом — голубые точки на миникарте" };
  };
  // Экран выбора рисует fplaces (он и так больше 1500 строк — не растим): ждём ответ сервера и ставим карточку в его сетку
  // после «Где был в прошлый раз» (или первой). Клик по ней задаёт место раньше, чем общий обработчик экрана (он на сетке,
  // клик всплывает к нему позже) отдаёт FC.places.spawnAt игре: пролёт камеры и плашка — как у районов.
  var PL = FC.places, pick0 = PL && PL.pickSpawn;
  if (pick0) PL.pickSpawn = function (cb, last) {
    if (!PL.districts.length) { pick0(cb, last); return; }
    C.wait(900, function () {
      pick0(cb, last);
      var html = C.card(), grid = html && document.querySelector("#spawnpick .grid"); if (!grid) return;
      var tmp = document.createElement("div"); tmp.innerHTML = html;
      var b = tmp.firstChild, after = grid.querySelector("button.card[data-i='last']");
      grid.insertBefore(b, after ? after.nextSibling : grid.firstChild);
      b.addEventListener("click", function () { PL.spawnAt = C.spawn(); });
      // фокус экрана — на первой карточке (fplaces ставит его через 50 мс на ту, что была первой до нашей)
      if (!after) setTimeout(function () { try { if (b.isConnected) b.focus({ preventScroll: true }); } catch (e) { /* старый браузер */ } }, 60);
    });
  };
  FC.on("start", function () {
    var s = FC.places && FC.places.spawnAt;
    if (s && s.id === "crowd") settle(s.cx, s.cz, s.x, s.z, s.seed);
  });

  /* ---- в игре: «👥 К игрокам» на большой карте ------------------------------------------------------------------ */
  C.go = function (fromMap) {
    var H = FC.hud;
    return C.get(myId()).then(function (c) {
      if (!c) { if (H) H.toast("Сейчас в городе больше никого — позови друзей", "", 2.5); return false; }
      var seed = (Math.random() * 1e9) | 0, p = C.spot(c.x, c.z, seed) || { x: c.x + 18, z: c.z + 18 };
      var ok = H && H.teleport ? H.teleport(p.x, p.z, fromMap) : false;
      if (!ok) return false;
      setTimeout(function () {                                         // перемещение — через 0,26 с (затемнение fhud)
        var P = FC.player; if (!P) return;
        if (P.mode === "foot") {
          P.heading = Math.atan2(c.x - P.x, c.z - P.z);
          if (FC.cam) { FC.cam.yaw = P.heading + Math.PI; FC.cam.snap = true; }
          settle(c.x, c.z, P.x, P.z, seed);
        }
        if (H) H.toast("👥 Рядом " + c.n + " " + plural(c.n, "игрок", "игрока", "игроков") + " — голубые точки на миникарте", "ok", 3.5);
      }, 700);
      return true;
    });
  };
  FC.on("map:open", function (e) {
    var leg = e && e.legend; if (!leg) return;
    var b = document.createElement("button"); b.type = "button"; b.className = "lgo lq lcrowd"; b.style.display = "none";
    var after = leg.querySelector(".lmore");
    leg.insertBefore(b, after ? after.nextSibling : leg.firstChild);
    function show(c) { if (!c) { b.style.display = "none"; return; } b.textContent = "👥 К игрокам · " + c.online; b.style.display = ""; }
    if (C.last && performance.now() - C.lastT < 8000) show(C.last);
    C.get(myId()).then(show);
    b.addEventListener("click", function (ev) { ev.stopPropagation(); C.go(true); });
  });

  FC.crowd = C;
})(window);
