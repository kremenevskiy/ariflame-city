/* Флейм-Сити — сюжет «Огонь в каждом»: движок миссий и семь миссий.
 *
 * Уголёк — талисман и наставник (портрет face:"mascot", FC.MASCOT), «СкукаСофт» — корпорация, которая хочет погасить творческий огонь
 * города (её офис — высокое офисное здание в Москве). Миссия — данные: список шагов. Шаг — {t: тип, …}:
 *   dialog {lines} · goto {at, r, text, car?} · enter {b, text} · floor {b, floor, text} · car {text, spawn?} ·
 *   pickup {text} · drive_to {at, r, text, time} · minigame {id, text} · chase {text, hits} · wanted {n} ·
 *   lose_wanted {text} · collect {n, time, text} · stealth {b} · escape {b, text} · fn {run(cur, next)}.
 * cp: true у шага — чекпоинт (повтор после провала — с него). Провал — один повод на экране; после 3 провалов —
 * «Пропустить». Прогресс — FC.save.story {done: [], fails: {}}. Случайные события, лента и приложения — fstory2.js.
 *
 * Чужие модули (машины, патруль, интерьеры, мини-игры) — по контракту из спеки и с проверкой наличия: без них шаг
 * упрощается (пешком, без этажей, мини-игра засчитывается), но сюжет не падает.
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE, M = FC.map, G = FC.gfx;
  var GOLD = "#ffd23f";
  var esc = function (s) { return FC.hud ? FC.hud.esc(s) : String(s); };

  function story() {
    var s = FC.save;
    if (!s.story) s.story = { done: [], step: 0 };
    if (!s.story.done) s.story.done = [];
    if (!s.story.fails) s.story.fails = {};
    return s.story;
  }
  function flags() { return FC.save.flags || (FC.save.flags = {}); }
  function door(B, k) { var d = B.doors[k || 0] || B.doors[0]; return { x: d.x + d.nx * 2.5, z: d.z + d.nz * 2.5 }; }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  function plazaC() { var p = M.plaza; return { x: (p.x0 + p.x1) / 2, z: (p.z0 + p.z1) / 2 }; }
  function has(mod, fn) { return !!(FC[mod] && (!fn || typeof FC[mod][fn] === "function")); }
  function stars() { return FC.police ? (FC.police.stars || 0) : 0; }
  function wanted(n) {
    if (!FC.police) return false;
    if (typeof FC.police.add === "function") { FC.police.add(n); return true; }
    if (typeof FC.police.set === "function") { FC.police.set(Math.max(stars(), n)); return true; }
    if (typeof FC.police.crime === "function") { for (var i = 0; i < n; i++) FC.police.crime("mission", FC.player.x, FC.player.z); return true; }
    return false;
  }
  function inCar() { var P = FC.player; return P.mode === "car" && !!P.car; }
  function speed() { var P = FC.player; return inCar() ? Math.hypot(P.car.vx || 0, P.car.vz || 0) : Math.hypot(P.vx || 0, P.vz || 0); }
  // имя вида из набора FC_SPECIES; без набора — ник блогера (персонаж — человек)
  var NICK = ["Луна", "Макс", "Вайб", "Соня", "Тим", "Кекс", "Ника", "Гоша"];
  function creatureName(code) { var W = global.FC_SPECIES; return code && W && W.META[code] ? W.META[code][0] : NICK[Math.floor(Math.random() * NICK.length)]; }

  /* ---- смс от талисмана: уведомление + история для «Сообщений» -------------------------------------------- */
  function sms(text, from) {
    from = from || FC.MASCOT.name;
    var f = flags();
    f.sms = (f.sms || []).concat([{ from: from, text: text, t: Date.now() }]).slice(-40);
    FC.dirty();
    if (FC.hud) FC.hud.notify(from, text, from === FC.MASCOT.name ? "🔥" : "💬", 7);
  }

  /* ---- офис «СкукаСофт»: самое высокое офисное здание у центра Москвы ------------------------------------- */
  var skukaB = null;
  function skuka() {
    if (skukaB) return skukaB;
    var d = M.DIST.msk;
    var list = M.buildings.filter(function (B) { return B.dist === "msk" && B.type === "office" && !B.zone && !B.poi && B.floors >= 8 && B.w >= 18 && B.d >= 18; })
      .sort(function (a, b) { return FC.dist2(a.x, a.z, d.x * 0.7, d.z * 0.7) - FC.dist2(b.x, b.z, d.x * 0.7, d.z * 0.7); });
    skukaB = list[0] || M.buildings.filter(function (B) { return B.type === "office"; })[0];
    skukaB.name = "Офис «СкукаСофт»"; skukaB.skuka = true;
    // серая вывеска над входом — у компании без огня и вывеска без огня
    var tex = G.tex.sign("СКУКАСОФТ", "🩶", "#5c636a"), dr = skukaB.doors[0];
    var mat = new T.MeshStandardMaterial({ map: tex, roughness: 0.7 });
    var s = new T.Mesh(new T.PlaneGeometry(1, 0.25), mat), w = Math.min(14, Math.max(7, (dr.nz !== 0 ? skukaB.w : skukaB.d) * 0.6));
    s.scale.set(w, w, 1); s.position.set(dr.x - dr.nx * 0.7, 5.4 + w * 0.125, dr.z - dr.nz * 0.7); s.rotation.y = Math.atan2(dr.nx, dr.nz);
    G.add(s);
    var s2 = s.clone(); s2.scale.set(w * 1.8, w * 1.8, 1); s2.position.set(skukaB.x + dr.nx * (skukaB.w / 2 - 1), skukaB.h + 2 + w * 0.22, skukaB.z + dr.nz * (skukaB.d / 2 - 1));
    G.add(s2);
    return skukaB;
  }

  /* ---- сюжетные машины, которых нет в трафике: фургон СкукаСофт (свой меш, едет сам по графу дорог) -------- */
  function vanMesh(color, label) {
    var g = new T.Group();
    var body = new T.Mesh(new T.BoxGeometry(2.1, 2.1, 5.2), G.mat.std(color, 0.45, 0.3));
    body.position.y = 1.35; g.add(body);
    var cab = new T.Mesh(new T.BoxGeometry(2.0, 1.1, 1.2), G.mat.std(0x1b2430, 0.2, 0.5));
    cab.position.set(0, 1.85, 2.2); g.add(cab);
    var wg = new T.CylinderGeometry(0.42, 0.42, 0.3, 12).rotateZ(Math.PI / 2), wm = G.mat.std(0x151515, 0.8);
    [[-1, 1.7], [1, 1.7], [-1, -1.7], [1, -1.7]].forEach(function (p) { var w = new T.Mesh(wg, wm); w.position.set(p[0] * 1.05, 0.42, p[1]); g.add(w); });
    if (label) {
      var tex = G.tex.sign(label, "", "#5c636a");
      [-1, 1].forEach(function (sd) {
        var pl = new T.Mesh(new T.PlaneGeometry(3.6, 0.9), new T.MeshBasicMaterial({ map: tex }));
        pl.position.set(sd * 1.07, 1.5, -0.3); pl.rotation.y = sd * Math.PI / 2; g.add(pl);
      });
    }
    var tl = new T.Mesh(new T.BoxGeometry(1.8, 0.2, 0.05), new T.MeshBasicMaterial({ color: 0xff2020 }));
    tl.position.set(0, 0.9, -2.62); g.add(tl);
    g.traverse(function (o) { if (o.isMesh) o.castShadow = G.Q.shadows; });
    G.add(g);
    return g;
  }
  /* Едет по дорогам: на каждом перекрёстке выбирает следующее ребро (чаще прямо), держится правой полосы. */
  function driver(obj, x, z, sp) {
    var n = M.nearestNode(x, z);
    var D = { obj: obj, x: M.nodes[n].x, z: M.nodes[n].z, h: 0, from: n, to: null, sp: sp, v: sp, dirX: 0, dirZ: 1, hp: 5, dead: false };
    D.pick = function () {
      var node = M.nodes[D.from], best = null, bs = -9;
      node.edges.forEach(function (ei) {
        var e = M.edges[ei], nb = M.other(e, D.from);
        if (nb === D.prev) return;
        var B = M.nodes[nb], dx = (B.x - node.x) / e.len, dz = (B.z - node.z) / e.len;
        var score = dx * D.dirX + dz * D.dirZ + Math.random() * 0.9 + (e.kind !== "st" ? 0.3 : 0);
        if (score > bs) { bs = score; best = nb; }
      });
      if (best == null) best = M.other(M.edges[node.edges[0]], D.from);
      D.to = best;
    };
    D.step = function (dt) {
      if (D.dead) { D.v = FC.damp(D.v, 0, 2.5, dt); }
      if (D.to == null) D.pick();
      var A = M.nodes[D.from], B = M.nodes[D.to];
      var dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz) || 1;
      D.dirX = dx / L; D.dirZ = dz / L;
      var rx = -D.dirZ * 3, rz = D.dirX * 3;                 // правая полоса
      var tx = B.x + rx, tz = B.z + rz;
      var ex = tx - D.x, ez = tz - D.z, e = Math.hypot(ex, ez);
      if (e < 2.5) { D.prev = D.from; D.from = D.to; D.to = null; return; }
      var v = D.v * dt;
      D.x += ex / e * Math.min(v, e); D.z += ez / e * Math.min(v, e);
      D.h = FC.angDamp(D.h, Math.atan2(ex, ez), 6, dt);
      obj.position.set(D.x, 0, D.z); obj.rotation.y = D.h;
    };
    return D;
  }

  /* ---- искры-тренды (сбор) ----------------------------------------------------------------------------- */
  function spark(x, z) {
    var sp = new T.Sprite(new T.SpriteMaterial({ map: G.tex.glow, color: 0xff9a3c, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
    sp.scale.set(3.4, 3.4, 1); sp.position.set(x, 1.6, z); G.add(sp);
    return sp;
  }

  /* ---- обработчики шагов --------------------------------------------------------------------------------- */
  var cur = null;              // активная миссия
  function mark(id, at, icon, opt) {
    if (!FC.markers) return null;
    return FC.markers.add(Object.assign({ id: "st-" + id, x: at.x, z: at.z, color: GOLD, icon: icon || "★", route: true, ring: 2.6 }, opt || {}));
  }
  function unmark(id) { if (FC.markers) FC.markers.remove("st-" + id); }
  var lastObj = null;
  function obj(text) { if (FC.hud && text !== lastObj) { lastObj = text; FC.hud.objective(text); } }
  function resolve(v, c) { return typeof v === "function" ? v(c) : v; }

  var STEP = {
    dialog: { start: function (c, s) { FC.hud.dialog(resolve(s.lines, c), function () { next(); }); } },
    fn: { start: function (c, s) { s.run(c, next); } },
    wait: { start: function (c, s) { c.t = s.sec; if (s.text) obj(s.text); }, update: function (c, s, dt) { c.t -= dt; if (c.t <= 0) next(); } },
    goto: {
      start: function (c, s) { c.at = resolve(s.at, c); mark("goto", c.at, s.icon); obj(s.text); if (s.time) timer(s.time, s.fail || "Не успел"); },
      update: function (c, s) {
        if (s.car && has("cars") && !inCar()) return;
        if (dist(FC.player, c.at) < (s.r || 4)) { if (s.time) FC.hud.timer(null); next(); }
      },
      end: function () { unmark("goto"); }
    },
    enter: {
      start: function (c, s) {
        c.B = resolve(s.b, c); c.d = door(c.B);
        mark("enter", c.d, "🚪");
        obj(s.text || ("Зайди в <b>" + esc(c.B.name) + "</b>"));
      },
      update: function (c) {
        var I = FC.inside;
        if (I && I.enter) { if (I.active && I.building && I.building.id === c.B.id) next(); }
        else if (dist(FC.player, c.d) < 3.5) { FC.hud.toast("🚧 Внутри ремонт — засчитано", "", 2); next(); }
      },
      end: function () { unmark("enter"); }
    },
    floor: {
      start: function (c, s) { c.B = resolve(s.b, c); c.fl = resolve(s.floor, c); obj(s.text || ("Поднимись на лифте на <b>" + c.fl + "-й этаж</b>")); },
      update: function (c) {
        var I = FC.inside;
        if (!I || !I.enter) { next(); return; }
        if (!I.active || !I.building || I.building.id !== c.B.id) { obj("Вернись в <b>" + esc(c.B.name) + "</b>"); return; }
        obj("Лифт — к <b>" + c.fl + "-му этажу</b>");
        // FC.inside.floor считает с нуля (вестибюль — 0), человеку показывает +1: «64-й» = floor 63
        if (I.floor == null || I.floor + 1 >= c.fl) next();
      }
    },
    car: {
      start: function (c, s) {
        if (!has("cars")) { FC.hud.toast("Машины ещё в пути — бежим пешком!", "", 2.5); next(); return; }
        obj(s.text || "Сядь в машину — <b>F</b> (чужую — угонишь)");
        if (s.spawn && has("cars", "spawn")) {
          var P = FC.player, at = resolve(s.spawn.at, c) || { x: P.x, z: P.z };
          var ln = M.nearestLane(at.x, at.z);
          try { c.car = FC.cars.spawn(s.spawn.type || "sedan", ln.x, ln.z, Math.atan2(ln.dx, ln.dz), { color: s.spawn.color, owned: true, story: true }); } catch (e) { c.car = null; }
          if (c.car) { c.car.story = true; mark("car", c.car, "🚗", { ring: 0 }); }
        }
      },
      update: function (c) {
        if (c.car && FC.markers && FC.markers.all["st-car"]) { var m = FC.markers.all["st-car"]; m.x = c.car.x; m.z = c.car.z; if (m.obj) m.obj.position.set(c.car.x, 0, c.car.z); }
        if (inCar()) next();
      },
      end: function () { unmark("car"); }
    },
    pickup: {
      start: function (c, s) {
        var r = FC.rng(Date.now() & 0xffff), base = resolve(s.near, c) || FC.player;
        var sp = M.sidewalkPoint(r, base.x, base.z, 140) || { x: base.x + 30, z: base.z };
        var codes = FC.people.CODES, code = codes[Math.floor(r() * codes.length)];
        c.pass = FC.people.make("npc", FC.people.cellOf(code), sp.x, sp.z, { scale: 1.85, code: code, name: creatureName(code) });
        c.passName = creatureName(code);
        cur.cleanup.push(function () { if (c.pass) FC.people.remove(c.pass); });
        mark("pick", sp, "🙋");
        obj(s.text || ("Забери <b>блогера «" + esc(c.passName) + "»</b>"));
        FC.people.say(c.pass, "Я здесь! 👋", 6);
      },
      update: function (c) {
        var d = dist(FC.player, c.pass), need = has("cars") ? 8 : 2.5;
        if (d < 40 && Math.random() < 0.01) FC.people.say(c.pass, "Сюда, сюда!", 2);
        if (d < need && speed() < 4) {
          c.pass.visible = false; c.pass.riding = true;
          c.pass.update = function (ch) { ch.x = FC.player.x; ch.z = FC.player.z; };
          FC.hud.toast("🙋 «" + c.passName + "» в машине", "ok", 2);
          if (FC.audio) FC.audio.play("door");
          next();
        }
      },
      end: function () { unmark("pick"); }
    },
    drive_to: {
      start: function (c, s) {
        c.at = resolve(s.at, c); mark("drive", c.at, s.icon || "🏁");
        obj(s.text);
        var t = s.time && (has("cars") ? s.time : s.time * 2);
        if (t) timer(t, s.fail || "Опоздал");
      },
      update: function (c, s) {
        if (dist(FC.player, c.at) < (s.r || 7) && speed() < 5) {
          FC.hud.timer(null);
          if (c.pass) {
            var p = c.pass, B = s.dropB ? resolve(s.dropB, c) : null, to = B ? door(B) : c.at;
            p.visible = true; p.riding = false; p.x = FC.player.x + 2; p.z = FC.player.z + 2;
            p.update = function (ch, dt) {
              var dx = to.x - ch.x, dz = to.z - ch.z, d = Math.hypot(dx, dz);
              if (d < 1) { ch.visible = false; return; }
              ch.vx = dx / d * 1.6; ch.vz = dz / d * 1.6; ch.speed = 1.6; ch.x += ch.vx * dt; ch.z += ch.vz * dt;
            };
            FC.people.say(p, s.thanks || "Спасибо! Ты огонь 🔥", 4);
          }
          next();
        }
      },
      end: function () { unmark("drive"); }
    },
    minigame: {
      start: function (c, s) {
        obj(s.text || "Мини-игра");
        var done = false;
        function fin(r) {
          if (done || cur !== c) return; done = true;
          var ok = !r || r === true || (r.ok !== false && !r.quit);
          if (ok) next(); else fail(s.fail || "Не получилось");
        }
        if (!has("games", "run")) { FC.hud.toast("🎮 Мини-игра засчитана", "", 2); setTimeout(function () { fin(true); }, 600); return; }
        try {
          var r = FC.games.run(s.id, { done: fin, story: true, title: s.title });
          if (r && typeof r.then === "function") r.then(fin, function () { fin({ ok: false }); });
        } catch (e) { fin(true); }
      }
    },
    chase: {
      start: function (c, s) {
        var P = FC.player, fx = Math.sin(P.heading || 0), fz = Math.cos(P.heading || 0);
        var g = vanMesh(0x8a8f98, "СКУКАСОФТ");
        c.van = driver(g, P.x + fx * 70, P.z + fz * 70, has("cars") ? 15 : 6.5);
        c.van.hp = s.hits || 5; c.hitT = 0;
        cur.cleanup.push(function () { G.scene.remove(g); });
        mark("van", c.van, "🚐", { ring: 0, route: false });
        obj(s.text || "Протарань фургон СкукаСофт — <b>" + c.van.hp + "</b> ударов");
      },
      update: function (c, s, dt) {
        var V = c.van, P = FC.player;
        V.step(dt);
        var m = FC.markers && FC.markers.all["st-van"];
        if (m) { m.x = V.x; m.z = V.z; if (m.obj) m.obj.position.set(V.x, 0, V.z); }
        c.hitT -= dt;
        var d = dist(P, V);
        if (V.dead) { if (V.v < 0.6) next(); return; }
        if (d > 330) { fail("Фургон ушёл"); return; }
        var reach = inCar() ? 4.4 : 2.6;
        if (d < reach && c.hitT <= 0 && (speed() > 3 || !has("cars"))) {
          c.hitT = 0.9; V.hp--; V.v = Math.max(5, V.v * 0.8);
          if (inCar()) { P.car.vx = (P.car.vx || 0) * 0.5; P.car.vz = (P.car.vz || 0) * 0.5; }
          if (FC.cam) FC.cam.shake(0.6);
          if (FC.audio) FC.audio.play("crash", { power: 14 });
          if (V.hp <= 0) { V.dead = true; obj("Фургон остановлен!"); FC.hud.toast("💥 Фургон встал!", "ok", 2); }
          else obj("Протарань фургон СкукаСофт — осталось <b>" + V.hp + "</b>");
        }
      },
      end: function () { unmark("van"); }
    },
    wanted: { start: function (c, s) { if (!wanted(s.n)) FC.hud.toast("🚨 Патруль в пути!", "bad", 2); next(); } },
    lose_wanted: {
      start: function (c, s) { c.t = 0; obj(s.text || "Уйди от патруля — <b>скройся</b> из зоны поиска"); },
      update: function (c, s, dt) {
        c.t += dt;
        if (!FC.police) { if (c.t > 6) next(); return; }
        if (c.t > 1.5 && stars() === 0) next();
      }
    },
    collect: {
      start: function (c, s) {
        var r = FC.rng(Date.now() & 0xffff), ctr = resolve(s.center, c) || plazaC();
        c.items = [];
        for (var i = 0; i < s.n; i++) {
          var e = M.edges[Math.floor(r() * M.edges.length)], a = M.nodes[e.a], b = M.nodes[e.b], t = r.range(0.25, 0.75);
          var x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
          if (Math.hypot(x - ctr.x, z - ctr.z) > (s.radius || 420) || e.bridge) { i--; continue; }
          var it = { x: x, z: z, sp: spark(x, z), id: "sp" + i };
          if (FC.markers) FC.markers.add({ id: "st-" + it.id, x: x, z: z, color: "#ff9a3c", icon: "✨", ring: 0, beam: true });
          c.items.push(it);
        }
        c.got = 0;
        cur.cleanup.push(function () { c.items.forEach(function (it) { G.scene.remove(it.sp); unmark(it.id); }); });
        obj((s.text || "Собери искры-тренды") + " — <b>0/" + s.n + "</b>");
        if (s.time) timer(s.time, "Тренд прошёл");
      },
      update: function (c, s) {
        var t = performance.now() / 300;
        c.items.forEach(function (it) {
          if (it.done) return;
          it.sp.position.y = 1.6 + Math.sin(t + it.x) * 0.4;
          if (Math.hypot(FC.player.x - it.x, FC.player.z - it.z) < 4) {
            it.done = true; G.scene.remove(it.sp); unmark(it.id); c.got++;
            if (FC.audio) FC.audio.play("cash");
            FC.hud.toast("✨ Искра " + c.got + "/" + s.n, "ok", 1.5);
            obj((s.text || "Собери искры-тренды") + " — <b>" + c.got + "/" + s.n + "</b>");
          }
        });
        if (c.got >= s.n) { FC.hud.timer(null); next(); }
      }
    },
    stealth: {
      start: function (c, s) {
        c.B = resolve(s.b, c);
        obj("Найди <b>сервер СкукаСофт</b> и не попадись охране");
        c.guards = []; c.spotted = false;
        var P = FC.player, fy = FC.inside && FC.inside.floorY ? FC.inside.floorY() : P.y;
        var room = FC.inside && FC.inside.active ? FC.inside.building.id : null;
        for (var i = 0; i < 3; i++) {
          var ang = i * 2.1 + 0.6, r = 7 + i * 2.5;
          var ax = P.x + Math.cos(ang) * r, az = P.z + Math.sin(ang) * r;
          var bx = ax + Math.cos(ang + 1.57) * 7, bz = az + Math.sin(ang + 1.57) * 7;
          if (FC.inside && FC.inside.collide) { var q = FC.inside.collide(ax, az, 0.4); ax = q.x; az = q.z; q = FC.inside.collide(bx, bz, 0.4); bx = q.x; bz = q.z; }
          var g = FC.people.make("npc", FC.people.SPECIAL.guard, ax, az, { scale: 1.9, room: room, y: fy });
          g.pa = { x: ax, z: az }; g.pb = { x: bx, z: bz }; g.goB = true; g.wait = 0;
          var cone = new T.Mesh(new T.CircleGeometry(9, 18, -0.62, 1.24).rotateX(-Math.PI / 2),
            new T.MeshBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.18, depthWrite: false }));
          cone.position.set(ax, fy + 0.06, az); G.add(cone); g.cone = cone;
          c.guards.push(g);
        }
        cur.cleanup.push(function () { c.guards.forEach(function (g) { FC.people.remove(g); G.scene.remove(g.cone); }); });
        // сервер — в стороне от лифта
        var hx = P.x - 11, hz = P.z + 6;
        if (FC.inside && FC.inside.collide) { var h = FC.inside.collide(hx, hz, 0.5); hx = h.x; hz = h.z; }
        c.hack = { x: hx, z: hz };
        mark("hack", c.hack, "💻", { ring: 1.6, route: false, room: room });
        FC.interact.add({ id: "st-hack", x: hx, z: hz, r: 2.6, room: room, label: "Взломать сервер СкукаСофт",
          act: function () {
            FC.interact.remove("st-hack"); unmark("hack");
            obj("Взлом…");
            var fin = function (r) {
              if (cur !== c) return;
              if (r && r.ok === false) { fail("Взлом не удался"); return; }
              FC.hud.toast("💾 Исходники у тебя!", "ok", 2.5); next();
            };
            if (has("games", "run")) { var pr = FC.games.run("hack", { done: fin, story: true }); if (pr && pr.then) pr.then(fin); }
            else fin(true);
          } });
        cur.cleanup.push(function () { FC.interact.remove("st-hack"); unmark("hack"); });
      },
      update: function (c, s, dt) {
        var P = FC.player;
        c.guards.forEach(function (g) {
          if (g.wait > 0) { g.wait -= dt; g.speed = 0; }
          else {
            var t = g.goB ? g.pb : g.pa, dx = t.x - g.x, dz = t.z - g.z, d = Math.hypot(dx, dz);
            if (d < 0.5) { g.goB = !g.goB; g.wait = 1.5; }
            else { g.vx = dx / d * 1.4; g.vz = dz / d * 1.4; g.x += g.vx * dt; g.z += g.vz * dt; g.speed = 1.4; g.fh = Math.atan2(dx, dz); }
          }
          g.cone.position.set(g.x, g.cone.position.y, g.z); g.cone.rotation.y = (g.fh || 0) - Math.PI / 2;
          var px = P.x - g.x, pz = P.z - g.z, pd = Math.hypot(px, pz);
          var ang = Math.abs(FC.angWrap(Math.atan2(px, pz) - (g.fh || 0)));
          if (!c.spotted && pd < 9 && ang < 0.62) {
            c.spotted = true; FC.people.say(g, "Стоять! Охрана!", 3);
            g.cone.material.color.setHex(0xff0000); g.cone.material.opacity = 0.32;
            if (!wanted(3)) FC.hud.toast("🚨 Тебя заметили!", "bad", 2);
            obj("Тебя заметили! Взломай сервер и <b>уходи</b>");
          }
        });
      }
    },
    escape: {
      start: function (c, s) { c.B = resolve(s.b, c); obj(s.text || "Уходи из здания — лучше через <b>второй выход</b>"); },
      update: function (c) {
        var I = FC.inside;
        if (I && I.active) return;
        if (dist(FC.player, c.B) > Math.max(c.B.w, c.B.d) / 2 + 40) next();
      }
    }
  };

  /* ---- таймер шага: по истечении — провал ----------------------------------------------------------------- */
  function timer(sec, why) {
    if (!FC.hud) return;
    var c = cur;
    FC.hud.timer(sec, "⏱", function () { if (cur === c) fail(why); });
  }

  /* ---- движок миссии --------------------------------------------------------------------------------------- */
  function start(id) {
    var m = BY[id]; if (!m) return false;
    if (cur) stop(true);
    cur = { m: m, i: 0, cp: 0, cleanup: [], data: {} };
    removeGiver();
    if (m.prep) m.prep(cur);
    FC.hud.big(m.title, "Задание " + (ORDER.indexOf(id) + 1) + " из " + ORDER.length, GOLD, 2.6);
    if (FC.audio) FC.audio.play("note");
    FC.emit("story:start", { id: id });
    setTimeout(function () { if (cur && cur.m === m) runStep(); }, 1200);
    return true;
  }
  function runStep() {
    var s = cur.m.steps[cur.i];
    if (s.cp) cur.cp = cur.i;
    cur.s = s; cur.h = STEP[s.t];
    if (!cur.h) { next(); return; }
    try { cur.h.start(cur, s); } catch (e) { if (global.console) console.error("story step", s.t, e); next(); }
  }
  function endStep() { if (cur && cur.h && cur.h.end) { try { cur.h.end(cur, cur.s); } catch (e) { /* уборка шага */ } } }
  function next() {
    if (!cur) return;
    var c = cur;
    endStep();
    if (cur !== c) return;
    cur.i++;
    if (cur.i >= cur.m.steps.length) pass(); else runStep();
  }
  function stop(silent) {
    if (!cur) return;
    endStep();
    cur.cleanup.forEach(function (f) { try { f(); } catch (e) { /* уборка */ } });
    cur = null;
    if (FC.hud) { obj(""); FC.hud.timer(null); }
    if (!silent) placeGiver();
  }
  function pass() {
    var m = cur.m, st = story();
    stop(true);
    var first = st.done.indexOf(m.id) < 0;
    if (first) st.done.push(m.id);
    var reward = first ? m.reward : Math.round(m.reward * 0.25);
    FC.money(reward, "задание «" + m.title + "»");
    FC.hud.big("ЗАДАНИЕ ВЫПОЛНЕНО", m.title + " · +" + FC.fmtMoney(reward), "#ffcf7a", 4.2);
    if (FC.audio) FC.audio.play("mission");
    if (m.id === "m1") FC.save.tutorial = false;
    st.fails[m.id] = 0;
    FC.dirty(); FC.saveNow();
    FC.emit("story:pass", { id: m.id, title: m.title, reward: reward });
    setTimeout(function () {
      if (m.after) m.after();
      placeGiver();
      var nx = nextId();
      if (nx && first) sms("Есть новое дело: «" + BY[nx].title + "». Жду у Башни Флейм 🔥");
    }, 4400);
  }
  function fail(why) {
    if (!cur) return;
    var c = cur, st = story();
    st.fails[c.m.id] = (st.fails[c.m.id] || 0) + 1;
    FC.dirty();
    endStep();
    c.cleanup.forEach(function (f) { try { f(); } catch (e) { /* уборка */ } });
    c.cleanup = [];
    cur = null;
    obj(""); FC.hud.timer(null);
    FC.hud.big("ПРОВАЛ", why, "#ff5d6c", 3);
    if (FC.audio) FC.audio.play("fail");
    setTimeout(function () { failCard(c, why); }, 1800);
  }
  // обучение (soft) не проваливается из-за случайной аварии или ареста — после больницы задание идёт дальше
  FC.on("busted", function () { if (cur && !cur.m.soft) fail("Тебя задержали"); });
  FC.on("wasted", function () { if (cur && !cur.m.soft) fail("Ты вырубился"); });

  /* ---- карточка провала: повторить с чекпоинта / пропустить / позже ---------------------------------------- */
  FC.css([
    ".fs-card{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(360px,90vw);background:rgba(14,18,36,.96);border:1px solid rgba(255,207,122,.35);border-radius:20px;padding:18px;text-align:center;z-index:9;pointer-events:auto;box-shadow:0 20px 60px rgba(0,0,0,.6);animation:pop .25s}",
    ".fs-card h3{margin:0 0 4px;font:800 italic 26px Georgia,serif;color:#ff8a8a}.fs-card p{margin:0 0 14px;color:rgba(255,245,230,.8)}",
    ".fs-card button{display:block;width:100%;margin-top:8px;border-radius:14px;padding:11px;font:700 15px system-ui;cursor:pointer;border:1px solid rgba(255,207,122,.35);background:transparent;color:#f6efe2}",
    ".fs-card button.go{border:0;background:linear-gradient(90deg,#ffcf7a,#ff9b4a);color:#2a1205}"
  ].join("\n"));
  function failCard(c, why) {
    var st = story(), fails = st.fails[c.m.id] || 0;
    var el = document.createElement("div"); el.className = "fs-card";
    el.innerHTML = "<h3>Провал</h3><p>" + esc(why) + "</p><button type='button' class='go' data-a='retry'>Повторить" + (c.cp ? " с чекпоинта" : "") + "</button>" +
      (fails >= 3 ? "<button type='button' data-a='skip'>Пропустить задание</button>" : "") + "<button type='button' data-a='later'>Позже</button>";
    document.body.appendChild(el);
    FC.input.enable(false); FC.input.unlock();
    function onKey(e) {                                                   // Enter — повторить, Esc — позже
      if (e.code === "Enter") { e.preventDefault(); el.querySelector("[data-a=retry]").click(); }
      else if (e.code === "Escape") { e.preventDefault(); el.querySelector("[data-a=later]").click(); }
    }
    global.addEventListener("keydown", onKey);
    el.addEventListener("click", function (e) {
      var a = e.target.dataset && e.target.dataset.a; if (!a) return;
      global.removeEventListener("keydown", onKey);
      el.remove(); FC.input.enable(true);
      if (a === "retry") restart(c.m.id, c.cp);
      else if (a === "skip") { cur = { m: c.m, i: c.m.steps.length, cp: 0, cleanup: [] }; pass(); }
      else placeGiver();
    });
  }
  function restart(id, cp) {
    start(id);
    if (cp && cur) { cur.i = cp; }
  }

  /* ---- миссии --------------------------------------------------------------------------------------------- */
  function ogo(text) { return { who: FC.MASCOT.name, text: text, face: "mascot" }; }
  function zoneB(k) { return function () { return M.zones[k] || M.hq; }; }
  function hqDoor() { return door(M.hq); }
  function guideSpot() {
    var s = FC.places && FC.places.spawnAt;                    // начал в выбранном районе — Уголёк встречает там
    if (s) return { x: s.x + 6, z: s.z + 4 };
    var p = plazaC(); return { x: p.x + 17.5, z: p.z + 4 };
  }
  var MISSIONS = [
    { id: "m1", title: "С приездом", reward: 500, where: guideSpot, icon: "🧳", soft: true,
      steps: [
        { t: "dialog", lines: function () {
          var nm = FC.me && FC.me.label && FC.me.label !== "Гость" ? FC.me.label : "новичок";
          return [ogo("Эй, " + nm + "! С приездом — добро пожаловать " + FC.cityTo + "!"),
            ogo("Я Уголёк. В этом городе живут агенты — у каждого человека свой. Они работают в зданиях: монтируют, снимают, пишут."),
            ogo("Но «СкукаСофт» хочет погасить огонь в каждом и превратить город в серую табличку. Поможешь?")]; } },
        { t: "goto", at: guideSpot, r: 5, text: "Подойди ко мне — к <b>фонтану</b> на площади", icon: "🔥" },
        { t: "dialog", lines: [ogo("Смотри: Shift — бег, пробел — прыжок, M — карта, P — телефон. На телефоне всё: задания, работа, лента города."),
          ogo("Наш штаб — Башня Флейм, 64 этажа. Зайди внутрь — E у двери.")] },
        { t: "enter", b: function () { return M.hq; }, text: "Зайди в <b>Башню Флейм</b> — E у двери", cp: true },
        { t: "floor", b: function () { return M.hq; }, floor: function () { return M.hq.floors; }, text: "Поднимись на лифте на <b>64-й этаж</b>" },
        { t: "dialog", lines: [ogo("Отсюда видно весь город. Каждый огонёк в окне — чья-то работа."),
          ogo("Держи первые деньги. Дальше — настоящие дела. Загляни в телефон: «Работа» и «Лента» уже ждут.")] }
      ] },
    { id: "m2", title: "Первый клиент", reward: 900, where: hqDoor, icon: "🚕",
      steps: [
        { t: "dialog", lines: [ogo("Блогер застрял на улице, а у него съёмка в Съёмочной. Отвезёшь?"),
          ogo("Машины — F. Своей нет — бери любую: город простит… если патруль не увидит.")] },
        { t: "car", cp: true },
        { t: "pickup", near: function () { return door(M.hq); } },
        { t: "drive_to", at: function () { return door(zoneB("shoot")()); }, dropB: zoneB("shoot"), r: 9, time: 170,
          text: "Довези блогера до <b>Съёмочной</b> (Алматы)", fail: "Блогер опоздал на съёмку", thanks: "Успели! Ты лучший 🔥" },
        { t: "dialog", lines: [ogo("Видел? Агенты затем и нужны — чтобы человек успевал жить.")] }
      ] },
    { id: "m3", title: "Монтаж до рассвета", reward: 1400, where: hqDoor, icon: "🎬",
      prep: function () { if (FC.clock.hour > 6 && FC.clock.hour < 21) { FC.setHour(23); FC.hud.toast("🌙 Наступила ночь", "", 2); } },
      steps: [
        { t: "dialog", lines: [ogo("Отснятое надо смонтировать до рассвета, иначе тренд уйдёт. Едем в Монтажную!")] },
        { t: "enter", b: zoneB("cut"), text: "Зайди в <b>Монтажную</b>", cp: true },
        { t: "minigame", id: "montage", text: "Смонтируй ролик — режь <b>в бит</b>", fail: "Ролик не собрался" },
        { t: "dialog", lines: [ogo("Огонь монтаж! Теперь срочно в Рилс-студию — выкладываем.")] },
        { t: "drive_to", at: function () { return door(zoneB("reels")()); }, r: 8, time: 150, cp: true,
          text: "Отвези ролик в <b>Рилс-студию</b>", fail: "Рассвет — тренд прошёл" }
      ] },
    { id: "m4", title: "Утечка", reward: 2200, where: function () { return door(zoneB("cut")()); }, icon: "🚐",
      steps: [
        { t: "dialog", lines: [ogo("Беда! Фургон СкукаСофт украл исходники из Монтажной. Они хотят выдать наши ролики за свои!"),
          ogo("Догони и протарань его. Пять хороших ударов — и он встанет.")] },
        { t: "car", cp: true },
        { t: "chase", hits: 5, cp: true },
        { t: "dialog", lines: [ogo("Исходники у нас! Но СкукаСофт настучала патрулю — уходим!")] },
        { t: "wanted", n: 2 },
        { t: "lose_wanted", text: "Уйди от патруля: <b>2★</b> — скройся из зоны поиска" }
      ] },
    { id: "m5", title: "Вирусный", reward: 2600, where: hqDoor, icon: "✨",
      steps: [
        { t: "dialog", lines: [ogo("По городу рассыпались искры-тренды. Соберёшь шесть за четыре минуты — и наш ролик залетит.")] },
        { t: "collect", n: 6, radius: 430, time: 240, text: "Собери искры-тренды", cp: true },
        { t: "dialog", lines: [ogo("Миллион просмотров! Город снова горит.")] }
      ] },
    { id: "m6", title: "Внутри Скуки", reward: 4200, where: function () { return door(skuka()); }, icon: "🕵️",
      steps: [
        { t: "dialog", lines: [ogo("Пора узнать, что задумала СкукаСофт. Их сервер — на 7-м этаже."),
          ogo("Охрана смотрит перед собой — видишь красные конусы? Обходи сзади. Заметят — будет жарко.")] },
        { t: "enter", b: skuka, text: "Проникни в <b>офис СкукаСофт</b> (Москва)", cp: true },
        { t: "floor", b: skuka, floor: function () { return Math.min(7, skuka().floors); }, text: "Лифт — на <b>7-й этаж</b>" },
        { t: "stealth", b: skuka },
        { t: "dialog", lines: [ogo("Вот их план: «Отменить огонёк. Заменить всё таблицей». Уходим через второй выход!")] },
        { t: "escape", b: skuka },
        { t: "lose_wanted", text: "Если за тобой хвост — <b>сбрось</b> его" }
      ] },
    { id: "m7", title: "Большой релиз", reward: 50000, where: hqDoor, icon: "🔥",
      steps: [
        { t: "dialog", lines: [ogo("Финал. В огненном фургоне — большой релиз всего города: ролики, сайты, песни агентов."),
          ogo("Довези его до площади, и огонёк загорится для всех. СкукаСофт бросит на нас весь патруль. Готов?")] },
        { t: "car", text: "Садись в <b>огненный фургон</b> у Башни", cp: true,
          spawn: { type: "van", color: 0xff6a1a, at: function () { return door(M.hq); } } },
        { t: "wanted", n: 4 },
        { t: "drive_to", at: function () { return plazaC(); }, r: 24, text: "Прорвись к <b>площади Огонька</b> через блокпосты" },
        { t: "fn", run: function (c, nextFn) {
          if (FC.police && FC.police.clear) FC.police.clear();
          flags().rank = "Хранитель огня";
          FC.dirty();
          FC.hud.dialog([ogo("ТЫ СДЕЛАЛ ЭТО! Огонёк горит для всего " + FC.cityOf + "!"),
            ogo("СкукаСофт закрывается на «вечную оптимизацию». А ты теперь — Хранитель огня."),
            { who: "Титры", text: FC.cityName + " · сделано огнём агентов города · спасибо, что играл", face: "🎬" }], nextFn);
        } }
      ] }
  ];
  var BY = {}, ORDER = [];
  MISSIONS.forEach(function (m) { BY[m.id] = m; ORDER.push(m.id); });
  function nextId() { var d = story().done; for (var i = 0; i < ORDER.length; i++) if (d.indexOf(ORDER[i]) < 0) return ORDER[i]; return null; }

  /* ---- выдача миссий: метка «★» у следующей и талисман-гид у фонтана --------------------------------------- */
  function removeGiver() { if (FC.markers) FC.markers.remove("st-giver"); FC.interact.remove("st-giver"); }
  function placeGiver() {
    removeGiver();
    var id = nextId(); if (!id) return;
    var m = BY[id], at = m.where();
    if (FC.markers) FC.markers.add({ id: "st-giver", x: at.x, z: at.z, color: GOLD, icon: m.icon, ring: 2.2, route: false });
    FC.interact.add({ id: "st-giver", x: at.x, z: at.z, r: 3, label: "Задание: «" + m.title + "»", act: function () { start(id); } });
  }
  var guide = null;
  function placeGuide() {
    var g = guideSpot();
    guide = FC.people.make("npc", FC.people.SPECIAL.guide, g.x, g.z, { scale: 2.3 });
    guide.update = function (ch) { ch.y = 0.35 + Math.sin(performance.now() / 500) * 0.25; };
    FC.interact.add({ id: "st-guide", x: g.x, z: g.z, r: 3.2, label: "Поговорить с Угольком", when: function () { return !cur || cur.m.id !== "m1"; },
      act: function () {
        var id = nextId();
        if (!cur && id === "m1") { start("m1"); return; }
        var tips = ["Загляни в «Ленту» — там видно, кто из агентов прямо сейчас работает.", "Перекраска снимает розыск. Запомни, где она.",
          "Бизнес в телефоне приносит деньги, даже пока ты гуляешь.", "Каждое здание открыто — заходи, этажи везде разные."];
        FC.hud.dialog([ogo(cur ? "Ты на задании «" + cur.m.title + "». Вперёд!" : id ? "Следующее дело: «" + BY[id].title + "». Метка ★ на карте." : "Ты Хранитель огня! Город твой."),
          ogo(tips[Math.floor(Math.random() * tips.length)])]);
      } });
  }

  /* ---- приложение «Задания» -------------------------------------------------------------------------------- */
  if (FC.hud) FC.hud.addApp({ id: "missions", icon: "★", name: "Задания", color: "#b8860b", order: 2,
    badge: function () { return cur ? "" : nextId() ? "!" : ""; },
    render: function (b, api) {
      var st = story(), nx = nextId(), f = flags();
      var html = "<div class='list'><div class='card'><b>Огонь в каждом</b><p>Пройдено " + st.done.length + " из " + ORDER.length +
        (f.rank ? " · звание: " + esc(f.rank) : "") + " · репутация " + (f.rep || 0) + "</p></div>";
      if (cur) html += "<div class='row'><span>Сейчас: <b>" + esc(cur.m.title) + "</b></span><button type='button' class='ghost' data-a='stop'>Бросить</button></div>";
      MISSIONS.forEach(function (m) {
        var done = st.done.indexOf(m.id) >= 0, open = done || m.id === nx;
        html += "<div class='row'><span>" + (done ? "✅" : open ? m.icon : "🔒") + " " + esc(m.title) + "<br><small class='quiet'>" +
          (done ? "пройдено" : open ? "+" + FC.fmtMoney(m.reward) : "откроется позже") + "</small></span>" +
          (open && !cur ? "<button type='button' data-a='go' data-id='" + m.id + "'>" + (done ? "Ещё раз" : "Начать") + "</button>" : "") + "</div>";
      });
      b.innerHTML = html + "</div>";
      b.addEventListener("click", function (e) {
        var a = e.target.dataset && e.target.dataset.a;
        if (a === "stop") { stop(); api.refresh(); }
        if (a === "go") { api.close(); start(e.target.dataset.id); }
      });
    } });

  /* ---- цикл ------------------------------------------------------------------------------------------------- */
  FC.addSystem({
    name: "story", order: 55,
    init: function () {
      placeGuide();
      placeGiver();
    },
    update: function (dt) {
      if (!cur || !cur.h || !cur.h.update) return;
      if (FC.hud && FC.hud.inDialog && FC.hud.inDialog()) return;
      try { cur.h.update(cur, cur.s, dt); } catch (e) { if (global.console) console.error("story update", e); next(); }
    }
  });
  FC.on("start", function () {
    var st = story();
    if (FC.save.tutorial && st.done.indexOf("m1") < 0) setTimeout(function () { if (!cur) start("m1"); }, 2500);
    else if (nextId()) setTimeout(function () { sms("С возвращением! Следующее дело — «" + BY[nextId()].title + "». Метка ★ на карте."); }, 4000);
  });

  FC.story = {
    start: start, stop: stop, missions: MISSIONS, sms: sms, skuka: skuka, vanMesh: vanMesh, driver: driver,
    nextId: nextId, active: function () { return cur ? cur.m.id : null; }, busy: function () { return !!cur; }
  };
})(window);
