/* Флейм-Сити — патруль: розыск в духе GTA 6.
 *
 * Преступление (FC.emit("crime", {type, x, z})) засчитывается, только если его ВИДЕЛИ: коп рядом и в прямой видимости —
 * сразу и «полными» звёздами (опознан); иначе свидетель звонит 4 с (📱 над ним) — помешать можно, сбив его; дозвонился —
 * «полые» звёзды: патруль знает о преступлении, но не знает тебя, ищет в зоне вокруг места. Коп увидел вблизи — опознан.
 * Зона поиска — круг на миникарте; вне зоны и вне видимости — кулдаун 20/30/45/60/75 с, звёзды гаснут.
 * Эскалация: 1★ — 2 машины и пешие (арест), 2★ — 4 машины и таран, 3★ — блокпост по маршруту и вертолёт с прожектором,
 * 4★ — PIT, шипы, спецгруппа, 5★ — 8 машин. Задержан — FC.player.die("busted"). Мелкие нарушения при копе — штраф.
 * «Перекраска» снимает розыск и чинит машину ($250), если копы не смотрят прямо сейчас.
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE, M = FC.map, G = FC.gfx;

  // оружие (fguns.js, 22.11 v3): выстрел в воздух — 1★, тяжёлое (дробовик, автомат, винтовка) и стрельба по людям — 2★,
  // поджог и взрыв — серьёзные; угроза патрульному оружием — 1★. e.r — на сколько метров слышно (свидетели звонят)
  var SEV = { assault: 1, hit_ped: 1, car_theft: 1, robbery: 2, assault_cop: 2, hit_cop: 3, police_car_theft: 2, ram_cop: 2,
    explosion: 2, heist: 3, red_light: 0, speeding: 0, gunfire: 1, gunfire_heavy: 2, shooting: 2, arson: 2, threat_cop: 1 };
  var SERIOUS = { assault_cop: 1, hit_cop: 1, police_car_theft: 1, ram_cop: 1, robbery: 1, heist: 1, explosion: 1, arson: 1, shooting: 1 };
  var FINE = { red_light: [50, "проезд на красный"], speeding: [80, "превышение скорости"] };
  var UNITS = [0, 2, 4, 5, 6, 8], COOL = [0, 20, 30, 45, 60, 75], ZONE_R = [0, 120, 200, 300, 400, 500];

  var W = { stars: 0, hollow: false, zone: null, seenT: 99, cool: 0, last: null, calls: [], units: [], foot: [], heli: null,
    block: null, recent: [], fines: [], lastFine: 0, grab: 0, knownCar: null, dispatchT: 0, detectT: 0, searchT: 0, blockT: 0 };

  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function now() { return performance.now(); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

  /* Прямая видимость по плоскости: отрезок не проходит сквозь здания (шаг 4 м). */
  function los(ax, az, bx, bz) {
    var d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / 4);
    for (var i = 1; i < n; i++) {
      var t = i / n;
      if (M.buildingAt(ax + (bx - ax) * t, az + (bz - az) * t, 0)) return false;
    }
    return true;
  }
  function copCars() {
    return FC.cars ? FC.cars.list.filter(function (c) { return c.police && !c.wrecked && !c.dead && (c.driver === "cop" || c.driver === "ai"); }) : [];
  }
  // видит ли патруль точку (машины — 70 м, пешие — 40 м, по прямой)
  function copSees(x, z) {
    if (FC.inside && FC.inside.active) return false;
    var cars = copCars();
    for (var i = 0; i < cars.length; i++) {
      var c = cars[i], d = Math.hypot(c.x - x, c.z - z);
      if (d < 70 && los(c.x, c.z, x, z)) return { d: d, unit: c };
    }
    var foot = FC.people.all.filter(function (p) { return p.kind === "cop" && !(p.knocked > 0); });
    for (var j = 0; j < foot.length; j++) {
      var f = foot[j], df = Math.hypot(f.x - x, f.z - z);
      if (df < 40 && los(f.x, f.z, x, z)) return { d: df, unit: f };
    }
    if (W.heli && Math.hypot(W.heli.sx - x, W.heli.sz - z) < 13) return { d: 20, unit: W.heli };
    return null;
  }

  /* ---- преступления ------------------------------------------------------------------------------------------ */
  var hudKey = "";
  function hud() {
    var flash = W.seenT < 2.5, key = W.stars + "|" + flash + "|" + W.hollow;
    if (key === hudKey || !FC.hud) return;
    hudKey = key;
    FC.hud.setStars(W.stars, flash, W.hollow);
  }
  function raise(sev, type, hollow, x, z) {
    var P = FC.player, before = W.stars;
    if (W.stars === 0) { W.stars = sev; W.hollow = !!hollow; }
    else {
      if (sev >= W.stars && SERIOUS[type]) W.stars++;
      else W.stars = Math.max(W.stars, sev);
      if (!hollow) W.hollow = false;
    }
    var t = now();
    W.recent.push(t);
    W.recent = W.recent.filter(function (q) { return t - q < 60000; });
    if (W.recent.length >= 3 && W.stars < 5) { W.stars++; W.recent = []; }
    W.stars = Math.min(5, W.stars);
    W.cool = 0;
    var cx = hollow && x != null ? x : P.x, cz = hollow && z != null ? z : P.z;
    W.zone = { x: cx, z: cz, r: ZONE_R[W.stars] };
    if (!hollow) { W.seenT = 0; W.last = { x: P.x, z: P.z }; W.knownCar = P.car || null; }
    if (W.stars !== before) {
      FC.emit("wanted", { stars: W.stars, hollow: W.hollow });
      if (FC.audio) FC.audio.play("wanted");
      if (before === 0) FC.hud.toast(W.hollow ? "🚨 Свидетель вызвал патруль — тебя ищут" : "🚨 Патруль видел! Розыск", "bad", 3);
      else FC.hud.toast("🚨 Розыск растёт: " + W.stars + "★", "bad", 2.5);
    }
    hud();
  }
  function fine(type) {
    var f = FINE[type]; if (!f || W.stars > 0) return;
    var t = now();
    if (t - W.lastFine < 12000) return;
    W.lastFine = t;
    if (FC.money(-f[0], "штраф: " + f[1]) === false) { raise(1, type, false); return; }
    FC.hud.toast("🚔 Штраф " + FC.fmtMoney(f[0]) + ": " + f[1], "bad", 3);
    if (FC.audio) FC.audio.play("whoop");
    W.fines.push(t);
    W.fines = W.fines.filter(function (q) { return t - q < 90000; });
    if (W.fines.length >= 3) { W.fines = []; FC.hud.toast("Слишком много нарушений — за тобой едут", "bad", 3); raise(1, type, false); }
  }
  FC.on("crime", function (e) {
    var P = FC.player;
    if (!P || P.dead) return;
    var sev = SEV[e.type]; if (sev == null) sev = 1;
    if (sev > 0) { FC.save.stats.crimes = (FC.save.stats.crimes || 0) + 1; FC.dirty(); }
    var seen = copSees(e.x, e.z);
    if (sev === 0) { if (seen) fine(e.type); return; }
    if (seen) { raise(sev, e.type, false); return; }
    // свидетели: ближайший звонит; агенты людей и угнанные водители тоже звонят
    var ws = FC.people.witnesses(e.x, e.z, FC.clamp(e.r || 24, 8, 120)).filter(function (ch) { return ch.kind !== "cop" && !ch.calling && ch !== e.victim && ch.cell !== -1; });
    if (!ws.length || W.calls.length >= 3) return;
    ws.sort(function (a, b) { return FC.dist2(a.x, a.z, e.x, e.z) - FC.dist2(b.x, b.z, e.x, e.z); });
    var w = ws[0];
    w.calling = true;
    W.calls.push({ ch: w, t: 4, sev: sev, type: e.type, x: e.x, z: e.z });
    FC.people.say(w, pick(["📱 Алло, патруль?!", "📱 Тут беспредел, приезжайте!", "📱 Я всё видел, записывайте!"]), 4.2, "cop");
  });
  function stepCalls(dt) {
    for (var i = W.calls.length - 1; i >= 0; i--) {
      var c = W.calls[i];
      if (c.ch.knocked > 0 || FC.people.all.indexOf(c.ch) < 0) {
        c.ch.calling = false; W.calls.splice(i, 1);
        if (FC.hud) FC.hud.toast("📵 Свидетель не дозвонился", "", 2);
        continue;
      }
      c.t -= dt;
      if (c.t <= 0) { c.ch.calling = false; W.calls.splice(i, 1); raise(c.sev, c.type, true, c.x, c.z); }
    }
  }

  /* ---- погоня: машины ---------------------------------------------------------------------------------------- */
  function chaseTarget(car) {
    var P = FC.player, ai = car.ai;
    var d = Math.hypot(car.x - P.x, car.z - P.z);
    var sp = Math.hypot(car.vx, car.vz);
    // не видят — сначала к месту, где видели в последний раз, потом прочёсывают всё шире (у «полых» — вокруг места вызова)
    if (W.seenT > 3 || W.hollow) {
      var z = W.zone || { x: P.x, z: P.z, r: 150 };
      var c0 = W.hollow || !W.last ? z : W.last;
      if (!W.hollow && W.last && W.seenT < 12 && !ai.reachedLast) {
        if (Math.hypot(W.last.x - car.x, W.last.z - car.z) < 20) ai.reachedLast = true;
        else return routeTo(car, W.last.x, W.last.z, car.spec.vmax * 0.8);
      }
      if (!ai.search || Math.hypot(ai.search.x - car.x, ai.search.z - car.z) < 18 || now() > ai.searchUntil) {
        var a = Math.random() * 6.28, r = Math.random() * Math.min(z.r * 0.8, 30 + W.seenT * 6);
        var n = M.nodes[M.nearestNode(c0.x + Math.cos(a) * r, c0.z + Math.sin(a) * r)];
        ai.search = { x: n.x, z: n.z }; ai.searchUntil = now() + 9000; ai.route = null;
      }
      return routeTo(car, ai.search.x, ai.search.z, car.spec.vmax * 0.6);
    }
    ai.reachedLast = false;
    var direct = d < 60 && los(car.x, car.z, P.x, P.z);
    if (direct) {
      var Tp = FC.clamp(d / Math.max(sp, 10), 0.2, 1.5);
      var tx = P.x + P.vx * Tp, tz = P.z + P.vz * Tp;
      var psp = Math.hypot(P.vx, P.vz);
      // таран — только по едущему; скорость сближения ограничена, чтобы удар толкал, а не взрывал с одного раза
      var ram = W.stars >= 2 && P.mode === "car" && psp > 4;
      var v = car.spec.vmax * (1 + 0.1 * W.stars);
      if (ram && d < 30) v = Math.min(v, psp + 6 + W.stars * 1.5);
      if (P.mode === "foot") { v = Math.min(v, Math.max(0, (d - 7) * 1.2)); ram = false; }
      else if (!ram && d < 16) v = Math.max(0, (d - 7) * 1.5);
      ai.pit = W.stars >= 4;
      return { x: tx, z: tz, v: Math.min(v, brakeCap(d, ram ? psp + 6 : 0)), ram: ram, boost: 1 + 0.06 * W.stars };
    }
    return routeTo(car, P.x, P.z, Math.min(car.spec.vmax * 0.95, brakeCap(d, Math.hypot(P.vx, P.vz))));
  }
  // скорость, с которой ещё успеваешь оттормозиться до игрока (≈12 м/с²), плюс его собственная скорость
  function brakeCap(d, plus) { return Math.sqrt(24 * Math.max(0, d - 8)) + (plus || 0) + 4; }
  function routeTo(car, x, z, v) {
    var ai = car.ai, t = now();
    if (!ai.route || !ai.route.length || t > ai.routeAt) { ai.route = M.roadRoute(car.x, car.z, x, z); ai.routeAt = t + 1500; }
    while (ai.route.length && Math.hypot(ai.route[0].x - car.x, ai.route[0].z - car.z) < 12) ai.route.shift();
    var nx = ai.route.length ? ai.route[0] : { x: x, z: z };
    return { x: nx.x, z: nx.z, v: v, ram: false, boost: 1 + 0.06 * W.stars };
  }
  function makeChase(car) {
    car.keep = true; car.siren = true; car.driver = "cop"; car.parked = false;
    car.ai = { mode: "chase", target: chaseTarget, route: null, routeAt: 0, pit: W.stars >= 4 };
    if (W.units.indexOf(car) < 0) W.units.push(car);
  }
  function spawnUnit() {
    var P = FC.player, st = M.poi("police", P.x, P.z), x, z, h;
    if (st && dist(st, P) < 350 && dist(st, P) > 70 && Math.random() < 0.5) {
      var d = st.doors[0], nl = M.nearestLane(d.x + d.nx * 10, d.z + d.nz * 10);
      if (nl) { x = nl.x; z = nl.z; h = Math.atan2(nl.dx, nl.dz); }
    }
    if (x == null) {
      for (var k = 0; k < 8 && x == null; k++) {
        var a = Math.random() * 6.28, r = 120 + Math.random() * 80;
        var node = M.nodes[M.nearestNode(P.x + Math.cos(a) * r, P.z + Math.sin(a) * r)];
        var e = M.edges[pick(node.edges)], from = e.oneway || Math.random() < 0.5 ? e.a : e.b;
        var lp = M.lanePoint(e, from, 0, 0.5);
        var dd = Math.hypot(lp.x - P.x, lp.z - P.z);
        if (dd > 90 && dd < 230 && !M.water(lp.x, lp.z)) { x = lp.x; z = lp.z; h = Math.atan2(lp.dx, lp.dz); }
      }
    }
    if (x == null) return null;
    var car = FC.cars.spawn("police", x, z, h, { driver: "cop" });
    makeChase(car);
    return car;
  }
  function dispatch() {
    var P = FC.player;
    W.units = W.units.filter(function (c) { return !c.dead && !c.wrecked && FC.cars.list.indexOf(c) >= 0 && c.driver !== "player"; });
    // застрявшую далеко машину убираем — диспетчер пришлёт новую (игрок этого не видит: > 90 м)
    var t = now();
    W.units.slice().forEach(function (c) {
      if (!c.movedAt || Math.hypot(c.x - c.mx, c.z - c.mz) > 4) { c.movedAt = t; c.mx = c.x; c.mz = c.z; }
      if (t - c.movedAt > 6000 && dist(c, P) > 90) { W.units.splice(W.units.indexOf(c), 1); FC.cars.remove(c); }
    });
    var want = UNITS[W.stars];
    // сначала — патрули рядом
    if (W.units.length < want) {
      copCars().forEach(function (c) {
        if (W.units.length >= want || W.units.indexOf(c) >= 0 || (c.ai && c.ai.mode === "block")) return;
        if (dist(c, P) < 260) makeChase(c);
      });
    }
    var tries = 0;
    while (W.units.length < want && tries++ < 2) { if (!spawnUnit()) break; }
    // лишние (после удачного ухода от части погони) — обратно в поток
    while (W.units.length > want + 1) release(W.units.pop());
    if (W.stars >= 3 && !W.heli) makeHeli();
    if (W.stars >= 3 && !W.block && now() > W.blockT && P.mode === "car" && Math.hypot(P.vx, P.vz) > 8) makeBlock();
  }
  function release(car) {
    if (!car || car.dead || car.driver === "player") return;   // машину, в которой сидит игрок, патрулю не «отпускать»
    car.siren = false; car.keep = false;
    if (!FC.cars.toLane(car)) car.ai = { mode: "free", freeT: 0, lost: true };
    car.driver = "cop";
  }

  /* ---- пешие копы: выходят из машины рядом, бегут к игроку, задерживают ----------------------------------------- */
  var SHOUT = ["Стоять! Патруль!", "Руки за голову!", "Не двигаться!", "Ты задержан!", "Лицом к машине!"];
  function footCop(x, z, omon) {
    var ch = FC.people.make("cop", omon ? FC.people.SPECIAL.cop2 : FC.people.SPECIAL.cop, x, z, { scale: 1.9, walk: 4.4 });
    ch.alpha = 1; ch.hitAt = 0; ch.lost = 0;
    ch.update = footUpdate;
    W.foot.push(ch);
    FC.people.say(ch, pick(SHOUT), 2, "cop");
    return ch;
  }
  function footUpdate(c, dt) {
    var P = FC.player;
    if (W.stars === 0 || c.leave) {
      c.leave = (c.leave || 0) + dt; c.speed = 0; c.vx = c.vz = 0;
      if (c.leave > 4) dropFoot(c);
      return;
    }
    if (c.guard && dist(c, P) > 26) { c.speed = 0; c.vx = c.vz = 0; return; }      // блокпост: стоят на месте
    var dx = P.x - c.x, dz = P.z - c.z, d = Math.hypot(dx, dz);
    if (d > 45) { c.lost += dt; if (c.lost > 8) { dropFoot(c); return; } } else c.lost = 0;
    var sp = d > 1.1 && !(FC.inside && FC.inside.active) ? 4.4 : 0;
    if (sp) {
      var r = M.collide(c.x + dx / d * sp * dt, c.z + dz / d * sp * dt, 0.35, { prev: c });
      c.vx = (r.x - c.x) / Math.max(dt, 1e-3); c.vz = (r.z - c.z) / Math.max(dt, 1e-3); c.x = r.x; c.z = r.z;
    } else { c.vx = c.vz = 0; }
    c.speed = sp;
    if (W.stars >= 2 && d < 1.4 && P.mode === "foot" && now() - c.hitAt > 1400) {
      c.hitAt = now(); c.lean = 0.4; setTimeout(function () { c.lean = 0; }, 180);
      P.damage(6, "cop"); FC.cam.shake(0.2);
      if (FC.audio) FC.audio.play("punch");
    }
    if (Math.random() < dt * 0.25) FC.people.say(c, pick(SHOUT), 1.8, "cop");
  }
  function dropFoot(c) { FC.people.remove(c); var i = W.foot.indexOf(c); if (i >= 0) W.foot.splice(i, 1); }
  function deployFoot() {
    var P = FC.player, psp = Math.hypot(P.vx, P.vz);
    W.units.forEach(function (car) {
      if (car.deployedAt && now() - car.deployedAt < 15000) return;
      if (dist(car, P) > 18 || Math.hypot(car.vx, car.vz) > 3 || (P.mode === "car" && psp > 6)) return;
      car.deployedAt = now();
      var fx = Math.sin(car.heading), fz = Math.cos(car.heading), n = W.stars >= 3 ? 2 : 1;
      for (var i = 0; i < n && W.foot.length < 8; i++) {
        var s = i ? -1 : 1, off = car.spec.W / 2 + 0.8;
        footCop(car.x + fz * off * s, car.z - fx * off * s, W.stars >= 4);
      }
    });
  }

  /* ---- вертолёт с прожектором (3★+) ----------------------------------------------------------------------------- */
  function makeHeli() {
    var g = new T.Group();
    var body = new T.Mesh(new T.SphereGeometry(1.6, 14, 10).scale(1, 0.8, 1.7), G.mat.std(0x1d2b4f, 0.45, 0.3));
    var stripe = new T.Mesh(new T.SphereGeometry(1.62, 14, 10, 0, Math.PI * 2, 1.2, 0.5).scale(1, 0.8, 1.7), G.mat.std(0xf1f3f6, 0.5, 0.1));
    var tail = new T.Mesh(new T.BoxGeometry(0.35, 0.35, 4.2).translate(0, 0.3, -3.6), G.mat.std(0x1d2b4f, 0.45, 0.3));
    var fin = new T.Mesh(new T.BoxGeometry(0.1, 1.2, 0.8).translate(0, 0.9, -5.5), G.mat.std(0xf1f3f6, 0.5, 0.1));
    var skidL = new T.Mesh(new T.BoxGeometry(0.12, 0.12, 3.2).translate(0.9, -1.45, 0), G.mat.std(0x2c2f35, 0.5, 0.5));
    var skidR = skidL.clone(); skidR.position.x = -1.8;
    var rotor = new T.Mesh(new T.BoxGeometry(9, 0.06, 0.32), G.mat.std(0x222428, 0.6, 0.4)); rotor.position.y = 1.55;
    var rotor2 = rotor.clone(); rotor2.rotation.y = Math.PI / 2; rotor.add(rotor2); rotor2.position.y = 0;
    var tr = new T.Mesh(new T.BoxGeometry(0.06, 1.4, 0.18), G.mat.std(0x222428, 0.6, 0.4)); tr.position.set(0.25, 0.9, -5.6);
    var blink = new T.Mesh(new T.SphereGeometry(0.15, 8, 6), new T.MeshBasicMaterial({ color: 0xff2030, toneMapped: false })); blink.position.set(0, -1.3, 0.6);
    g.add(body, stripe, tail, fin, skidL, skidR, rotor, tr, blink);
    var coneM = new T.MeshBasicMaterial({ color: 0xf2f6ff, transparent: true, opacity: 0.1, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide });
    var cone = new T.Mesh(new T.ConeGeometry(9, 1, 20, 1, true).translate(0, -0.5, 0), coneM);
    var pool = new T.Mesh(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ map: G.tex.glow, color: 0xeaf2ff, transparent: true, opacity: 0.55, blending: T.AdditiveBlending, depthWrite: false }));
    pool.scale.set(24, 1, 24);
    cone.frustumCulled = false;
    var P = FC.player;
    g.position.set(P.x + 180, 60, P.z + 120);
    G.add(g); G.add(cone); G.add(pool);
    W.heli = { g: g, rotor: rotor, tr: tr, blink: blink, cone: cone, pool: pool, sx: P.x, sz: P.z, tx: P.x, tz: P.z, wander: 0 };
  }
  function stepHeli(dt) {
    var H = W.heli; if (!H) return;
    var P = FC.player;
    if (W.stars < 3) { H.leave = (H.leave || 0) + dt; }
    var tgt = W.seenT < 4 ? { x: P.x, z: P.z } : (W.zone || { x: P.x, z: P.z });
    if (W.seenT >= 4) {       // прочёсывает зону
      H.wander -= dt;
      if (H.wander <= 0) { H.wander = 4; var a = Math.random() * 6.28, r = Math.random() * (W.zone ? W.zone.r * 0.6 : 60); H.tx = tgt.x + Math.cos(a) * r; H.tz = tgt.z + Math.sin(a) * r; }
    } else { H.tx = tgt.x; H.tz = tgt.z; }
    if (H.leave) { H.tx = H.g.position.x + 300; H.tz = H.g.position.z + 300; }
    var g = H.g, dx = H.tx - 14 - g.position.x, dz = H.tz - 10 - g.position.z, d = Math.hypot(dx, dz), sp = Math.min(26, d * 0.8);
    if (d > 0.1) { g.position.x += dx / d * sp * dt; g.position.z += dz / d * sp * dt; g.rotation.y = FC.angDamp(g.rotation.y, Math.atan2(dx, dz), 1.5, dt); }
    g.position.y = 58 + Math.sin(now() / 900) * 1.2;
    g.rotation.z = FC.clamp(-sp * 0.006, -0.2, 0.2);
    H.rotor.rotation.y += dt * 28; H.tr.rotation.x += dt * 40;
    H.blink.visible = Math.floor(now() / 500) % 2 === 0;
    // пятно прожектора: тянется к цели с запаздыванием
    H.sx = FC.damp(H.sx, H.tx, 1.4, dt); H.sz = FC.damp(H.sz, H.tz, 1.4, dt);
    var hx = g.position.x, hy = g.position.y - 1.4, hz = g.position.z;
    var vx = H.sx - hx, vy = 0.1 - hy, vz = H.sz - hz, L = Math.hypot(vx, vy, vz);
    H.cone.position.set(hx, hy, hz); H.cone.scale.set(1, L, 1);
    H.cone.lookAt(H.sx, 0.1, H.sz); H.cone.rotateX(-Math.PI / 2);
    H.pool.position.set(H.sx, 0.12, H.sz);
    // прожектор виден только в сумерках и ночью: днём пятно 24 м на земле и луч «светили» поверх солнца (задача)
    var nk = FC.clamp((G.night - 0.15) / 0.5, 0, 1);
    H.cone.material.opacity = nk * 0.12; H.pool.material.opacity = nk * 0.6;
    H.cone.visible = H.pool.visible = nk > 0.02;
    if (FC.audio && FC.audio.loop) FC.audio.loop("heli", true, { vol: Math.max(0, 1 - Math.hypot(hx - P.x, hz - P.z) / 220) });
    if (H.leave > 12) dropHeli();
  }
  function dropHeli() {
    var H = W.heli; if (!H) return;
    G.scene.remove(H.g); G.scene.remove(H.cone); G.scene.remove(H.pool);
    W.heli = null;
    if (FC.audio && FC.audio.loop) FC.audio.loop("heli", false);
  }

  /* ---- блокпост и шипы (3★/4★): впереди по маршруту игрока ------------------------------------------------------ */
  var spikeMat = new T.MeshStandardMaterial({ color: 0x23252a, roughness: 0.6, metalness: 0.5 });
  function makeBlock() {
    var P = FC.player, sp = Math.hypot(P.vx, P.vz); if (sp < 1) return;
    var dx = P.vx / sp, dz = P.vz / sp, want = FC.clamp(sp * 8, 120, 300);
    var n = M.nodes[M.nearestNode(P.x + dx * 30, P.z + dz * 30)], prev = -1, acc = Math.hypot(n.x - P.x, n.z - P.z), edge = null, from = null;
    for (var k = 0; k < 14; k++) {
      var best = null, bd = -2;
      for (var i = 0; i < n.edges.length; i++) {
        var e = M.edges[n.edges[i]]; if (e.i === prev) continue;
        var o = M.nodes[M.other(e, n.i)], ex = (o.x - n.x) / e.len, ez = (o.z - n.z) / e.len, dot = ex * dx + ez * dz;
        if (dot > bd) { bd = dot; best = e; }
      }
      if (!best) return;
      var nb = M.nodes[M.other(best, n.i)];
      if (acc + best.len >= want) { edge = best; from = n.i; break; }
      acc += best.len; prev = best.i; dx = (nb.x - n.x) / best.len; dz = (nb.z - n.z) / best.len; n = nb;
    }
    if (!edge || edge.bridge) { W.blockT = now() + 8000; return; }
    var A = M.nodes[from], B = M.nodes[M.other(edge, from)];
    var ux = (B.x - A.x) / edge.len, uz = (B.z - A.z) / edge.len, mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
    var base = Math.atan2(ux, uz), cars = [], cops = [];
    [-1, 1].forEach(function (s) {
      var off = s * edge.w * 0.24;
      var c = FC.cars.spawn("police", mx - uz * off, mz + ux * off, base + s * 1.05, { driver: "cop" });
      c.keep = true; c.siren = true; c.ai = { mode: "block" };
      cars.push(c);
      cops.push(footCop(mx - ux * 4 - uz * off * 1.3, mz - uz * 4 + ux * off * 1.3, W.stars >= 4));
    });
    cops.forEach(function (c) { c.guard = true; });
    var spikes = null;
    if (W.stars >= 4) {
      spikes = new T.Group();
      var sx = mx - ux * 9, sz = mz - uz * 9;
      var strip = new T.Mesh(new T.BoxGeometry(edge.w * 0.9, 0.05, 0.45), spikeMat);
      spikes.add(strip);
      for (var j = 0; j < 14; j++) {
        var cone = new T.Mesh(new T.ConeGeometry(0.07, 0.18, 5), spikeMat);
        cone.position.set(-edge.w * 0.42 + j * edge.w * 0.06, 0.1, 0); spikes.add(cone);
      }
      spikes.position.set(sx, 0.05, sz); spikes.rotation.y = base;
      G.add(spikes);
      spikes.userData = { x: sx, z: sz, ux: ux, uz: uz, w: edge.w };
    }
    W.block = { cars: cars, cops: cops, spikes: spikes, x: mx, z: mz, ux: ux, uz: uz };
    W.blockT = now() + 40000;
    FC.hud.toast("🚧 Впереди блокпост!", "bad", 2.5);
  }
  function stepBlock() {
    var b = W.block; if (!b) return;
    var P = FC.player, rel = (P.x - b.x) * b.ux + (P.z - b.z) * b.uz, d = Math.hypot(P.x - b.x, P.z - b.z);
    if (W.stars === 0 || d > 320 || rel > 110) { dropBlock(); return; }
    // шипы: машина игрока проезжает полосу
    var s = b.spikes && b.spikes.userData;
    if (s && P.mode === "car" && P.car && !P.car.spiked) {
      var lx = (P.x - s.x) * s.ux + (P.z - s.z) * s.uz, lat = Math.abs((P.x - s.x) * (-s.uz) + (P.z - s.z) * s.ux);
      if (Math.abs(lx) < 1.2 && lat < s.w / 2) { P.car.spiked = true; FC.hud.toast("💥 Шины пробиты!", "bad", 2.5); FC.cam.shake(0.4); if (FC.audio) FC.audio.play("pop"); }
    }
  }
  function dropBlock() {
    var b = W.block; if (!b) return;
    b.cars.forEach(function (c) { if (!c.dead && c.driver !== "player") FC.cars.remove(c); });
    b.cops.forEach(function (c) { c.leave = 0.01; });
    if (b.spikes) G.scene.remove(b.spikes);
    W.block = null;
  }

  /* ---- снять розыск -------------------------------------------------------------------------------------------- */
  function clear(silent) {
    var had = W.stars > 0;
    W.stars = 0; W.hollow = false; W.zone = null; W.cool = 0; W.grab = 0; W.recent = []; W.knownCar = null; W.seenT = 99;
    W.calls.forEach(function (c) { c.ch.calling = false; }); W.calls = [];
    W.units.forEach(release); W.units = [];
    W.foot.forEach(function (c) { c.leave = 0.01; });
    dropBlock();
    if (W.heli) W.heli.leave = 0.01;
    hud();
    if (had) { FC.emit("wanted", { stars: 0 }); if (!silent && FC.audio && FC.audio.loop) FC.audio.loop("siren", false); }
  }
  FC.on("busted", function () { clear(true); });
  // Угнанная машина патруля — больше не машина патруля. Иначе при снятии розыска (перемещение с карты, розыск истёк)
  // release() отдавал её автопилоту «копа»: машина уезжала без игрока, а он оставался «за рулём» на пустом месте —
  // «переместился, себя не вижу» (24.11). Плюс из неё же высаживались пешие копы (deployFoot).
  FC.on("car:enter", function (e) { var i = e && e.car ? W.units.indexOf(e.car) : -1; if (i >= 0) W.units.splice(i, 1); });
  FC.on("wasted", function () { clear(true); });

  /* ---- «Перекраска» и «Сдаться» ----------------------------------------------------------------------------------- */
  function provider(px, pz, room) {
    var P = FC.player; if (room != null || P.dead) return null;
    var out = [];
    if (P.mode === "car" && P.car) {
      var B = M.poi("paint", px, pz);
      if (B) {
        var d = B.doors[0];
        if (Math.hypot(d.x + d.nx * 3 - px, d.z + d.nz * 3 - pz) < 10) {
          out.push({ id: "respray", x: px, z: pz, r: 12, key: "use", mode: "car",
            label: "Перекраска — $250" + (W.stars ? " (снимет розыск)" : ", ремонт и новый цвет"), act: respray });
        }
      }
    }
    if (P.mode === "foot" && W.stars > 0) {
      var S = M.poi("police", px, pz);
      if (S) {
        var sd = S.doors[0];
        if (Math.hypot(sd.x - px, sd.z - pz) < 3) out.push({ id: "surrender", x: px, z: pz, r: 4, key: "use", mode: "foot", label: "Сдаться патрулю", act: function () { FC.player.die("busted"); } });
      }
    }
    return out;
  }
  function respray() {
    var P = FC.player, car = P.car; if (!car) return;
    if (W.stars > 0 && W.seenT < 3) { FC.hud.toast("👀 Копы смотрят — сначала оторвись от хвоста", "bad", 2.5); return; }
    if (FC.money(-250, "перекраска") === false) { FC.hud.toast("Нужно $250", "bad", 2); return; }
    var pal = FC.cars.PALETTE, c = car.color;
    while (c === car.color) c = pal[Math.floor(Math.random() * pal.length)];
    FC.cars.setColor(car, c); FC.cars.repair(car);
    if (car.owned) { FC.save.carColor = c; FC.dirty(); }
    var had = W.stars > 0;
    clear(true);
    FC.hud.big("ПЕРЕКРАШЕНО", had ? "Розыск снят, машина как новая" : "Машина как новая", "#ffb02e", 2.6);
    if (FC.audio) FC.audio.play("spray");
  }

  /* ---- карта: зона поиска и метки патруля ------------------------------------------------------------------------- */
  function mapLayer(c, k) {
    var t = now();
    if (W.zone && W.stars > 0) {
      var red = Math.floor(t / 500) % 2 === 0;
      c.beginPath(); c.arc(W.zone.x, W.zone.z, W.zone.r, 0, Math.PI * 2);
      c.fillStyle = red ? "rgba(255,50,70,0.16)" : "rgba(60,110,255,0.16)"; c.fill();
      c.lineWidth = 2 / k; c.strokeStyle = red ? "rgba(255,80,90,0.8)" : "rgba(90,140,255,0.8)"; c.stroke();
    }
    var r = 4.5 / k;
    copCars().forEach(function (car) {
      if (!car.siren && W.stars === 0) return;
      c.fillStyle = Math.floor(t / 250) % 2 ? "#ff3048" : "#3a78ff";
      c.beginPath(); c.arc(car.x, car.z, r, 0, Math.PI * 2); c.fill();
    });
    W.foot.forEach(function (f) { c.fillStyle = "#6fa8ff"; c.beginPath(); c.arc(f.x, f.z, r * 0.6, 0, Math.PI * 2); c.fill(); });
    if (W.heli) { c.strokeStyle = "#ffffff"; c.lineWidth = 1.5 / k; c.beginPath(); c.arc(W.heli.sx, W.heli.sz, 12, 0, Math.PI * 2); c.stroke(); }
  }

  /* ---- кадр ------------------------------------------------------------------------------------------------------ */
  function update(dt) {
    var P = FC.player;
    if (!P || !FC.started) return;
    stepCalls(dt);
    if (W.stars > 0) {
      W.detectT -= dt;
      if (W.detectT <= 0) {
        W.detectT = 0.2;
        var s = P.dead ? null : copSees(P.x, P.z);
        if (s) {
          var wasSeen = W.seenT;
          W.seenT = 0; W.cool = 0;
          W.last = { x: P.x, z: P.z };
          W.zone = { x: P.x, z: P.z, r: ZONE_R[W.stars] };
          if (W.hollow && (s.d < 35 || (P.car && P.car === W.knownCar))) {
            W.hollow = false; W.knownCar = P.car || null;
            FC.hud.toast("👁 Тебя опознали!", "bad", 2.2);
          }
          if (!W.hollow && P.car) W.knownCar = P.car;
          if (wasSeen > 6) FC.hud.toast("👁 Патруль снова видит тебя", "bad", 1.8);
        } else W.seenT += 0.2;
      }
      // кулдаун: не видят — вне зоны в полную силу, внутри зоны — медленно
      if (W.seenT > 1.5) {
        var out = !W.zone || Math.hypot(P.x - W.zone.x, P.z - W.zone.z) > W.zone.r;
        W.cool += dt * (out ? 1 : 0.3);
        if (W.cool >= COOL[W.stars]) {
          clear();
          FC.hud.big("ОТОРВАЛСЯ", "Розыск снят", "#7dffb0", 2.4);
          FC.emit("wanted:lost", {});
        }
      }
      W.dispatchT -= dt;
      if (W.dispatchT <= 0) { W.dispatchT = 1; dispatch(); }
      deployFoot();
      // задержание
      var psp = Math.hypot(P.vx, P.vz), close = false, grabbing = false;
      // по высоте тоже: игрок на крыше у края — не в руках у патруля на тротуаре внизу (fmain: крыши)
      for (var i = 0; i < W.foot.length; i++) { var f = W.foot[i]; if (!(f.knocked > 0) && dist(f, P) < 1.6 && Math.abs((f.y || 0) - (P.y || 0)) < 2.5) { grabbing = true; close = true; } }
      W.units.forEach(function (c) { if (dist(c, P) < 10) close = true; });
      var limit = P.mode === "car" ? 1.4 : 1;
      if (!P.dead && close && psp < limit && (P.mode === "car" || grabbing) && W.seenT < 2 && !W.hollow) {
        W.grab += dt;
        if (W.grab > 0.6 && FC.hud) FC.hud.help("🚔 Тебя задерживают — двигайся!", 1);
        if (W.grab > (P.mode === "car" ? 3 : 2)) { W.grab = 0; P.die("busted"); }
      } else W.grab = Math.max(0, W.grab - dt * 2);
    }
    stepHeli(dt);
    stepBlock();
    hud();
  }

  FC.addSystem({
    name: "police", order: 25,
    init: function () {
      FC.interact.provider(provider);
      FC.hud.addMapLayer(mapLayer);
    },
    update: update
  });

  FC.police = {
    get stars() { return W.stars; }, get hollow() { return W.hollow; }, state: W,
    crime: function (type, x, z, opt) { FC.emit("crime", Object.assign({ type: type, x: x, z: z }, opt || {})); },
    clear: function () { clear(true); },
    add: function (n) {
      var P = FC.player, b = W.stars;
      if (!b) { raise(Math.min(5, n || 1), "heist", false); return; }
      W.stars = Math.min(5, W.stars + (n || 1)); W.hollow = false; W.seenT = 0; W.cool = 0;
      W.zone = { x: P.x, z: P.z, r: ZONE_R[W.stars] };
      if (W.stars !== b) { FC.emit("wanted", { stars: W.stars, hollow: false }); FC.hud.toast("🚨 Розыск растёт: " + W.stars + "★", "bad", 2.5); }
      hud();
    },
    sees: copSees
  };
})(window);
