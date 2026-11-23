/* Флейм-Сити — жизнь города вокруг сюжета: случайные события, «Лента» (соцсеть города в духе GTA 6 — посты
 * очевидцев о твоих проделках), «Сообщения» (смс Уголька), репутация, новости для радио (FC.story.newsLine).
 *
 * События — раз в ~3 минуты рядом с игроком, когда нет задания: вор сумки, заглохшая машина, уличная гонка,
 * свадебный кортеж, потерянный кошелёк, блогер просит снять, «живой эфир» агента в здании-зоне, искры Уголька.
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE, M = FC.map, G = FC.gfx, S = FC.story;
  var esc = FC.hud.esc;
  function flags() { return FC.save.flags || (FC.save.flags = {}); }
  function rep(d) { var f = flags(); f.rep = (f.rep || 0) + d; FC.dirty(); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  function door(B) { var d = B.doors[0]; return { x: d.x + d.nx * 2.5, z: d.z + d.nz * 2.5 }; }
  function inCar() { return FC.player.mode === "car" && !!FC.player.car; }
  var W = global.FC_SPECIES;
  var NICK = ["Луна", "Макс", "Вайб", "Соня", "Тим", "Кекс", "Ника", "Гоша"];                   // без набора видов — ник (персонаж — человек)
  function cname(code) { return code && W && W.META[code] ? W.META[code][0] : NICK[Math.floor(Math.random() * NICK.length)]; }

  /* ---- улица у точки и подписи преступлений (одна запись для ленты и радио) -------------------------------- */
  function streetAt(x, z) {
    var best = null, bd = 1e18;
    M.near(x, z, 60).forEach(function (B) { if (B.prop || !B.street) return; var d = FC.dist2(B.x, B.z, x, z); if (d < bd) { bd = d; best = B; } });
    return best ? best.street : M.district(x, z).name;
  }
  var CRIME = {
    assault: "драка — кто-то раздаёт тумаки прохожим", assault_cop: "нападение на патрульного", car_theft: "угнан автомобиль",
    carjack: "водителя выкинули из машины", hit_ped: "наезд на пешехода", hit_and_run: "сбили пешехода и скрылись",
    red_light: "проезд на красный", speeding: "лихач гоняет по встречке", theft: "кража кошелька", robbery: "ограбление",
    vandal: "разбита витрина", mission: "переполох у офиса СкукаСофт",
    gunfire: "стрельба на улице", gunfire_heavy: "очереди из автомата", shooting: "стрельба по прохожим", arson: "поджог",
    explosion: "взрыв", threat_cop: "угрожал патрульному оружием"
  };
  function crimeText(type) { return CRIME[type] || "переполох"; }
  var log = [];               // последние события для радио
  function remember(text) { log.push({ text: text, t: Date.now() }); if (log.length > 12) log.shift(); }
  function newsLine() {
    var fresh = log.filter(function (e) { return Date.now() - e.t < 5 * 60000; });
    if (fresh.length && Math.random() < 0.75) {
      var e = fresh[fresh.length - 1];
      return "срочно: " + e.text + ". Свидетели уже выложили видео в «Ленту»";
    }
    return null;
  }

  /* ---- «Лента»: посты ---------------------------------------------------------------------------------------- */
  var posts = [];            // {id, kind, cell, who, text, t, likes, liked, at}
  var LAB = { work: "работает", linger: "только что закончил", wait: "ждёт рендер" };
  function post(p) {
    p.t = p.t || Date.now(); p.likes = p.likes == null ? Math.floor(Math.random() * 40) : p.likes;
    var i = posts.findIndex(function (q) { return q.id === p.id; });
    if (i >= 0) { p.likes = posts[i].likes; p.liked = posts[i].liked; posts.splice(i, 1); }
    posts.unshift(p);
    if (posts.length > 70) posts.length = 70;
    unread++;
  }
  var unread = 0;
  function ago(t) {
    var s = Math.max(0, (Date.now() - t) / 1000);
    return s < 60 ? "только что" : s < 3600 ? Math.round(s / 60) + " мин назад" : Math.round(s / 3600) + " ч назад";
  }
  FC.on("citizens", function (list) {
    (list || []).forEach(function (a) {
      if (!a.zone || !a.doing || (a.state !== "work" && a.state !== "linger" && a.state !== "wait")) return;
      var B = M.zones[a.state === "wait" ? "queue" : a.zone] || M.zones[a.zone];
      if (!B) return;
      var icon = (FC.people.ICON && FC.people.ICON[a.zone]) || B.emoji || "✨";
      post({ id: "a" + a.id, kind: "agent", cell: FC.people.cellOf(a.creature), who: "Агент-" + cname(a.creature),
        text: icon + " " + (a.state === "work" ? a.doing : LAB[a.state] + ": " + a.doing) + " · " + B.name,
        t: Date.now() - (a.ago || 0) * 1000, at: door(B), b: B.id, live: a.state === "work" });
    });
    // болтовня: пара случайных агентов говорит фразу своего вида — лента живая, даже когда все отдыхают
    var idle = (list || []).filter(function (a) { return a.creature && W && W.LINES && W.LINES[a.creature]; });
    for (var k = 0; k < 2 && idle.length; k++) {
      var a = idle[Math.floor(Math.random() * idle.length)], L = W.LINES[a.creature];
      var home = M.homeOf(a.house != null ? a.house : FC.hash(a.id) % 9973);
      post({ id: "t" + a.id, kind: "chat", cell: FC.people.cellOf(a.creature), who: "Агент-" + cname(a.creature),
        text: "💭 «" + L[Math.floor(Math.random() * L.length)] + "» · " + (home ? M.district(home.x, home.z).name : FC.cityName),
        at: home ? door(home) : null, likes: Math.floor(Math.random() * 12) });
    }
  });
  FC.on("crime", function (c) {
    var st = streetAt(c.x, c.z), txt = crimeText(c.type);
    remember(txt + " на " + st);
    if (Math.random() < 0.7) post({ id: "c" + Date.now(), kind: "crime", cell: FC.people.randomCell(), who: "Очевидец",
      text: "📱 " + txt[0].toUpperCase() + txt.slice(1) + " на улице " + st + "! Сняла на телефон 😱", at: { x: c.x, z: c.z } });
  });
  FC.on("car:crash", function (c) {
    if (!c || (c.power || 0) < 12 || Math.random() < 0.5) return;
    var P = FC.player, st = streetAt(P.x, P.z);
    remember("ДТП на " + st);
    post({ id: "x" + Date.now(), kind: "crime", cell: FC.people.randomCell(), who: "Флейм Дороги", text: "💥 ДТП на " + st + ". Объезжайте!", at: { x: P.x, z: P.z } });
  });
  FC.on("busted", function () { var P = FC.player; post({ id: "b" + Date.now(), kind: "crime", cell: FC.people.SPECIAL.cop, who: "Патруль " + FC.cityOf, text: "🚓 Задержан подозреваемый на " + streetAt(P.x, P.z) + ". Спасибо бдительным агентам." }); });
  FC.on("story:pass", function (e) { post({ id: "s" + e.id, kind: "story", cell: FC.people.SPECIAL.guide, who: FC.MASCOT.name, text: "🔥 Город благодарит героя: задание «" + e.title + "» выполнено!", likes: 120 + Math.floor(Math.random() * 300) }); });

  FC.hud.addApp({ id: "feed", icon: "📣", name: "Лента", color: "#e1306c", order: 3,
    badge: function () { return unread ? Math.min(unread, 99) : ""; },
    render: function (b, api) {
      unread = 0;
      var live = posts.filter(function (p) { return p.live; }).length;
      var html = "<div class='list'><div class='card'><b>Флейм Лента</b><p>Что прямо сейчас делают агенты людей" + (live ? " · <b style='color:#ff6b7a'>🔴 " + live + " в эфире</b>" : "") + "</p>" +
        // Флеймграм (fsocial.js): твои подписчики — трюки и налёты рядом с прохожими попадают сюда же
        (FC.social ? "<p class='quiet'>📸 Твой Флеймграм: " + FC.social.followers() + " подписчиков" + (FC.social.live() ? " · 🔴 ты в эфире" : "") + "</p>" : "") + "</div>";
      if (!posts.length) html += "<div class='card'><p>Тихо… Лента оживёт, когда агенты возьмутся за работу.</p></div>";
      posts.slice(0, 40).forEach(function (p, i) {
        var av = p.cell != null && p.cell >= 0 ? (p.cell >= 1000 ? "<span class='fsav'>" + (p.cell === FC.people.SPECIAL.guide ? "🔥" : "🚓") + "</span>"
          : "<span class='fsav' style='" + FC.hud.atlasStyle(p.cell) + "'></span>") : "<span class='fsav'>🥚</span>";
        html += "<div class='card fspost'>" + av + "<div><b>" + esc(p.who) + (p.live ? " <i class='fslive'>LIVE</i>" : "") + "</b><p>" + esc(p.text) + "</p><small class='quiet'>" + ago(p.t) + "</small>" +
          "<div class='fsact'><button type='button' class='ghost' data-like='" + i + "'>" + (p.liked ? "❤️" : "🤍") + " " + p.likes + "</button>" +
          (p.at ? "<button type='button' data-go='" + i + "'>Поехать</button>" : "") + "</div></div></div>";
      });
      b.innerHTML = html + "</div>";
      b.addEventListener("click", function (e) {
        var t = e.target, li = t.dataset && t.dataset.like, gi = t.dataset && t.dataset.go;
        if (li != null) { var p = posts[+li]; p.liked = !p.liked; p.likes += p.liked ? 1 : -1; t.textContent = (p.liked ? "❤️" : "🤍") + " " + p.likes; }
        if (gi != null) {
          var q = posts[+gi];
          FC.markers.add({ id: "feed", x: q.at.x, z: q.at.z, color: "#c86bff", icon: "📍", route: true, ring: 2 });
          watch = q.live ? q : null;
          FC.hud.toast("📍 Маршрут проложен", "ok", 2); api.close();
        }
      });
    } });
  FC.css([
    ".fspost{display:flex;gap:10px;align-items:flex-start}.fsav{flex:none;width:42px;height:42px;border-radius:12px;background-color:rgba(255,255,255,.08);display:grid;place-items:center;font-size:24px}",
    ".fslive{font-style:normal;background:#ff3b5c;color:#fff;border-radius:6px;padding:0 5px;font-size:10px}",
    ".fsact{display:flex;gap:6px;margin-top:6px}.fsact button{padding:4px 9px;font-size:12px}",
    ".fs-offer{position:fixed;left:50%;top:calc(64px + env(safe-area-inset-top));transform:translateX(-50%);width:min(380px,92vw);background:rgba(14,18,36,.95);border:1px solid rgba(255,207,122,.4);border-radius:16px;padding:11px 13px;z-index:8;pointer-events:auto;animation:pop .25s;display:flex;gap:10px;align-items:center}",
    ".fs-offer .ic{font-size:30px}.fs-offer div{flex:1;font-size:13px}.fs-offer b{color:#ffcf7a;display:block}",
    ".fs-offer button{border:0;border-radius:10px;padding:8px 11px;font:700 13px system-ui;cursor:pointer;background:linear-gradient(90deg,#ffcf7a,#ff9b4a);color:#2a1205}",
    ".fs-offer button.no{background:rgba(255,255,255,.1);color:#fff}"
  ].join("\n"));

  // «приехать посмотреть» живой эфир: дошёл до здания — бонус и пост
  var watch = null;

  /* ---- «Сообщения» ------------------------------------------------------------------------------------------- */
  FC.hud.addApp({ id: "sms", icon: "💬", name: "Сообщения", color: "#2aabee", order: 4,
    render: function (b) {
      var l = (flags().sms || []).slice().reverse();
      b.innerHTML = "<div class='list'>" + (l.length ? l.map(function (m) {
        return "<div class='card'><b>" + (m.from === FC.MASCOT.name ? "🔥 " : "💬 ") + esc(m.from) + "</b><p>" + esc(m.text) + "</p><small class='quiet'>" + ago(m.t) + "</small></div>";
      }).join("") : "<div class='card'><p>Сообщений пока нет.</p></div>") + "</div>";
    } });

  /* ---- карточка-предложение события (да / нет) ---------------------------------------------------------- */
  var offerEl = null;
  function offer(icon, title, text, yes, onYes, sec) {
    if (offerEl) offerEl.remove();
    var el = document.createElement("div"); el.className = "fs-offer"; offerEl = el;
    el.innerHTML = "<span class='ic'>" + icon + "</span><div><b>" + esc(title) + "</b>" + esc(text) + "</div>" +
      (yes ? "<button type='button' class='yes'>" + esc(yes) + "</button>" : "") + "<button type='button' class='no'>✕</button>";
    document.body.appendChild(el);
    if (FC.audio) FC.audio.play("note");
    var kill = function () { if (offerEl === el) offerEl = null; el.remove(); };
    if (yes) el.querySelector(".yes").addEventListener("click", function () { kill(); onYes(); });
    el.querySelector(".no").addEventListener("click", kill);
    setTimeout(kill, (sec || 12) * 1000);
  }

  /* ---- случайные события ----------------------------------------------------------------------------------- */
  var ev = null, evT = 75;
  function endEvent(ok, msg) {
    if (!ev) return;
    var e = ev; ev = null;
    (e.cleanup || []).forEach(function (f) { try { f(); } catch (x) { /* уборка */ } });
    FC.markers.remove("ev"); FC.interact.remove("ev");
    if (FC.hud.objective) FC.hud.objective("");
    if (msg) FC.hud.toast(msg, ok ? "ok" : "bad", 3);
  }
  function spotNear(min, max) {
    var P = FC.player, r = FC.rng(Date.now() & 0xffff);
    for (var i = 0; i < 20; i++) {
      var sp = M.sidewalkPoint(r, P.x, P.z, max);
      if (sp && dist(sp, P) > min) return sp;
    }
    return null;
  }
  function npcAt(at, code, opt) {
    code = code || FC.people.CODES[Math.floor(Math.random() * FC.people.CODES.length)];
    var ch = FC.people.make("npc", FC.people.cellOf(code), at.x, at.z, Object.assign({ scale: 1.8 }, opt || {}));
    ch.code = code; ch.cname = cname(code);
    return ch;
  }
  function mk(at, icon, color) { FC.markers.add({ id: "ev", x: at.x, z: at.z, color: color || "#4cc9f0", icon: icon, ring: 2, route: false }); }
  function follow(id, o) { var m = FC.markers.all[id]; if (m) { m.x = o.x; m.z = o.z; if (m.obj) m.obj.position.set(o.x, 0, o.z); } }

  var EVENTS = [
    { id: "thief", w: 3, run: function () {
      var sp = spotNear(25, 70); if (!sp) return false;
      var victim = npcAt(sp), thief = npcAt({ x: sp.x + 1.5, z: sp.z });
      var ang = Math.random() * 6.28, e = { t: 45, cleanup: [function () { FC.people.remove(victim); FC.people.remove(thief); }] };
      FC.people.say(victim, "Держи вора! Сумку украли!", 4);
      thief.update = function (ch, dt) {
        if (ch.caught) { ch.speed = 0; return; }
        var P = FC.player, dx = ch.x - P.x, dz = ch.z - P.z, d = Math.hypot(dx, dz) || 1;
        ang = FC.angDamp(ang, Math.atan2(dx, dz) + Math.sin(performance.now() / 700) * 0.6, d < 25 ? 3 : 0.5, dt);
        var sp2 = d < 30 ? 5.2 : 3.5, nx = ch.x + Math.sin(ang) * sp2 * dt, nz = ch.z + Math.cos(ang) * sp2 * dt;
        var c = M.collide(nx, nz, 0.35, { prev: ch });
        if (c.hit) ang += 1.6;
        ch.vx = (c.x - ch.x) / dt; ch.vz = (c.z - ch.z) / dt; ch.x = c.x; ch.z = c.z; ch.speed = sp2;
      };
      e.update = function (dt) {
        e.t -= dt; follow("ev", thief);
        if (dist(FC.player, thief) < (inCar() ? 4 : 1.7)) {
          thief.caught = true; FC.people.say(thief, "Ладно, ладно! Держи…", 3);
          rep(1); FC.money(150, "вернул сумку"); endEvent(true, "👜 Сумка возвращена · +$150 · репутация ↑");
        } else if (e.t <= 0 || dist(FC.player, thief) > 160) endEvent(false, "Вор скрылся");
      };
      mk(thief, "🦹", "#ff6b7a");
      FC.hud.objective("Догони <b>вора</b> — " + "коснись его");
      return e;
    } },
    { id: "stall", w: 2, run: function () {
      var sp = spotNear(20, 60); if (!sp) return false;
      var g = S.vanMesh(0x4a90d9, null), drv = npcAt({ x: sp.x + 2.5, z: sp.z });
      g.position.set(sp.x, 0, sp.z); g.rotation.y = Math.random() * 6.28;
      var e = { cleanup: [function () { G.scene.remove(g); FC.people.remove(drv); }], t: 90 };
      FC.people.say(drv, "Заглохла… Подтолкнёшь?", 5);
      mk(sp, "🔧");
      FC.interact.add({ id: "ev", x: sp.x, z: sp.z, r: 4.5, label: "Подтолкнуть машину", act: function () {
        FC.interact.remove("ev");
        if (FC.audio) FC.audio.play("whoosh");
        if (FC.cam) FC.cam.shake(0.3);
        setTimeout(function () {
          if (FC.audio) FC.audio.play("horn", { dur: 0.25 });
          FC.people.say(drv, "Завелась! Спасибо!", 3); rep(1); FC.money(80, "помог водителю");
          endEvent(true, "🔧 Машина завелась · +$80");
        }, 1200);
      } });
      e.update = function (dt) { e.t -= dt; if (e.t <= 0 || dist(FC.player, sp) > 200) endEvent(false); };
      return e;
    } },
    { id: "race", w: 2, need: function () { return !!FC.cars; }, run: function () {
      var P = FC.player, r = FC.rng(Date.now() & 0xffff), pts = [], cx = P.x, cz = P.z;
      for (var i = 0; i < 4; i++) {
        var n = M.nodes[M.nearestNode(cx + r.range(-260, 260), cz + r.range(-260, 260))];
        pts.push({ x: n.x, z: n.z }); cx = n.x; cz = n.z;
      }
      var e = { k: 0, started: false, cleanup: [] };
      offer("🏁", "Уличная гонка", "Местный гонщик вызывает: 4 точки за 100 секунд. Ставка $400.", "Погнали", function () {
        if (!inCar()) { FC.hud.toast("Нужна машина — F", "bad", 2); endEvent(false); return; }
        e.started = true; FC.hud.timer(100, "🏁", function () { if (ev === e) endEvent(false, "Гонка проиграна"); });
        FC.markers.add({ id: "ev", x: pts[0].x, z: pts[0].z, color: "#ff9f1c", icon: "1", route: true, ring: 6 });
      });
      e.update = function () {
        if (!e.started) { if (!offerEl) endEvent(false); return; }
        var p = pts[e.k];
        if (dist(FC.player, p) < 12) {
          e.k++;
          if (FC.audio) FC.audio.play("blip");
          if (e.k >= pts.length) { FC.hud.timer(null); FC.money(400, "уличная гонка"); rep(1); endEvent(true, "🏆 Победа в гонке · +$400"); return; }
          FC.markers.add({ id: "ev", x: pts[e.k].x, z: pts[e.k].z, color: "#ff9f1c", icon: String(e.k + 1), route: true, ring: 6 });
        }
      };
      return e;
    } },
    { id: "wedding", w: 1, run: function () {
      var P = FC.player, fx = Math.sin(P.heading || 0), fz = Math.cos(P.heading || 0), cars = [], e = { t: 0, near: 0, cleanup: [] };
      for (var i = 0; i < 3; i++) {
        var g = S.vanMesh(0xf5f5f5, null);
        var D = S.driver(g, P.x + fx * (60 + i * 9), P.z + fz * (60 + i * 9), 9);
        cars.push(D); e.cleanup.push((function (gg) { return function () { G.scene.remove(gg); }; })(g));
        if (i === 0) {
          var rib = new T.Mesh(new T.TorusGeometry(0.6, 0.12, 6, 16), G.mat.std(0xff70a6, 0.5));
          rib.position.set(0, 2.6, 1.2); g.add(rib);
        }
      }
      // остальные едут за первой
      for (var k = 1; k < cars.length; k++) { cars[k].lead = cars[k - 1]; }
      FC.hud.toast("💍 Свадебный кортеж! Проводи его 40 секунд — гости щедрые", "", 4);
      e.update = function (dt) {
        e.t += dt;
        cars[0].step(dt);
        for (var j = 1; j < cars.length; j++) {
          var c = cars[j], L = c.lead, dx = L.x - c.x, dz = L.z - c.z, d = Math.hypot(dx, dz) || 1;
          var sp = d > 10 ? 10 : d < 7 ? 0 : 8;
          c.x += dx / d * sp * dt; c.z += dz / d * sp * dt; c.h = FC.angDamp(c.h, Math.atan2(dx, dz), 5, dt);
          c.obj.position.set(c.x, 0, c.z); c.obj.rotation.y = c.h;
        }
        follow("ev", cars[0]);
        if (dist(FC.player, cars[1]) < 35) e.near += dt;
        if (Math.random() < dt * 0.6 && FC.audio) FC.audio.play("horn", { dur: 0.2, dist: dist(FC.player, cars[0]) });
        if (e.near >= 40) { FC.money(200, "свадьба"); rep(1); endEvent(true, "💍 Гости осыпали тебя деньгами · +$200"); }
        else if (e.t > 120 || dist(FC.player, cars[0]) > 260) endEvent(false);
      };
      FC.markers.add({ id: "ev", x: cars[0].x, z: cars[0].z, color: "#ff70a6", icon: "💍", ring: 0, route: false });
      return e;
    } },
    { id: "wallet", w: 2, run: function () {
      var sp = spotNear(12, 50); if (!sp) return false;
      var w = new T.Mesh(new T.BoxGeometry(0.4, 0.08, 0.28), G.mat.std(0x6b3e26, 0.6));
      w.position.set(sp.x, 0.2, sp.z); G.add(w);
      var e = { t: 120, cleanup: [function () { G.scene.remove(w); }] };
      mk(sp, "👛", "#7dffb0");
      FC.interact.add({ id: "ev", x: sp.x, z: sp.z, r: 2, label: "Поднять кошелёк", act: function () {
        FC.interact.remove("ev"); G.scene.remove(w);
        var home = FC.map.homeOf(Math.floor(Math.random() * 999));
        offer("👛", "Чужой кошелёк: $300 и визитка", "Вернуть владельцу (адрес на визитке) или оставить себе?", "Вернуть", function () {
          var at = door(home);
          e.ret = at; FC.markers.add({ id: "ev", x: at.x, z: at.z, color: "#7dffb0", icon: "🏠", route: true, ring: 2.5 });
          FC.hud.objective("Верни кошелёк: <b>" + esc(home.addr) + "</b>");
        }, 15);
        e.keep = setTimeout(function () {
          if (e.ret || ev !== e) return;
          FC.money(300, "чужой кошелёк"); rep(-1);
          if (FC.people.witnesses(FC.player.x, FC.player.z, 18).length && FC.police && FC.police.crime) FC.police.crime("theft", FC.player.x, FC.player.z);
          endEvent(true, "👛 +$300… совесть −1");
        }, 15500);
      } });
      e.update = function (dt) {
        e.t -= dt;
        if (e.ret && dist(FC.player, e.ret) < 4) { FC.money(100, "вернул кошелёк"); rep(2); endEvent(true, "🙏 Владелец счастлив · +$100 · репутация ↑↑"); }
        else if (!e.ret && e.t <= 0) endEvent(false);
        else if (e.ret && e.t < -300) endEvent(false);
      };
      return e;
    } },
    { id: "photo", w: 2, run: function () {
      var sp = spotNear(15, 60); if (!sp) return false;
      var b = npcAt(sp), e = { t: 90, cleanup: [function () { FC.people.remove(b); }] };
      FC.people.say(b, "Снимешь меня для рилса? 📸", 6);
      mk(sp, "📸", "#e1306c");
      FC.interact.add({ id: "ev", x: sp.x, z: sp.z, r: 2.6, label: "Снять блогера «" + b.cname + "»", act: function () {
        FC.interact.remove("ev");
        var fin = function (r) {
          if (ev !== e) return;
          if (r && r.ok === false) { FC.people.say(b, "Ну… пересниму сам", 3); endEvent(false, "Кадр не удался"); return; }
          FC.people.say(b, "Огонь кадр! 🔥", 3); FC.money(120, "фото для блогера"); rep(1); endEvent(true, "📸 Блогер доволен · +$120");
        };
        if (FC.games && FC.games.run) { var pr = FC.games.run("photo", { done: fin }); if (pr && pr.then) pr.then(fin); } else fin(true);
      } });
      e.update = function (dt) { e.t -= dt; if (e.t <= 0 || dist(FC.player, sp) > 200) endEvent(false); };
      return e;
    } },
    { id: "live", w: 3, need: function () { return liveAgents().length > 0; }, run: function () {
      var l = liveAgents(); if (!l.length) return false;
      var a = l[Math.floor(Math.random() * l.length)], B = M.zones[a.zone];
      var e = { t: 240, cleanup: [] };
      offer("🔴", "Эфир: агент-" + cname(a.creature), a.doing + " — в здании «" + B.name + "». Приехать посмотреть?", "Поехать", function () {
        var at = door(B); e.at = at; e.B = B;
        FC.markers.add({ id: "ev", x: at.x, z: at.z, color: "#ff3b5c", icon: "🔴", route: true, ring: 2.5 });
        FC.hud.objective("Эфир: <b>" + esc(B.name) + "</b> — зайди внутрь");
      });
      e.update = function (dt) {
        e.t -= dt;
        if (!e.at) { if (!offerEl) endEvent(false); return; }
        var I = FC.inside;
        if ((I && I.active && I.building && I.building.id === e.B.id) || (!(I && I.enter) && dist(FC.player, e.at) < 4)) {
          rep(1); FC.money(60, "попал в эфир");
          post({ id: "me" + Date.now(), kind: "story", cell: FC.me && FC.me.creature ? FC.people.cellOf(FC.me.creature) : -1, who: FC.me ? FC.me.label : "Ты", text: "🎥 Заглянул на эфир в «" + e.B.name + "» — агенты работают вживую!" });
          endEvent(true, "🎥 Ты в кадре эфира · +$60");
        } else if (e.t <= 0) endEvent(false);
      };
      return e;
    } },
    { id: "sparks", w: 1, run: function () {
      var P = FC.player, items = [], e = { cleanup: [] };
      for (var i = 0; i < 3; i++) {
        var sp = spotNear(15, 90); if (!sp) continue;
        var s = new T.Sprite(new T.SpriteMaterial({ map: G.tex.glow, color: 0xff9a3c, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
        s.scale.set(3, 3, 1); s.position.set(sp.x, 1.5, sp.z); G.add(s);
        items.push({ x: sp.x, z: sp.z, s: s });
        e.cleanup.push((function (ss) { return function () { G.scene.remove(ss); }; })(s));
      }
      if (!items.length) return false;
      FC.hud.notify(FC.MASCOT.name, "Я рассыпал искры рядом с тобой — собери, пока не погасли! ✨", "🔥", 5);
      e.t = 60;
      e.update = function (dt) {
        e.t -= dt;
        items.forEach(function (it) {
          if (it.got) return;
          it.s.position.y = 1.5 + Math.sin(performance.now() / 300 + it.x) * 0.3;
          if (Math.hypot(P.x - it.x, P.z - it.z) < 3.5) { it.got = true; G.scene.remove(it.s); FC.money(40, "искра"); }
        });
        if (items.every(function (it) { return it.got; })) endEvent(true, "✨ Все искры собраны");
        else if (e.t <= 0) endEvent(false);
      };
      return e;
    } }
  ];
  function liveAgents() {
    return (FC.net && FC.net.citizens || []).filter(function (a) { return a.state === "work" && a.zone && M.zones[a.zone] && a.doing; });
  }
  function pickEvent() {
    var ok = EVENTS.filter(function (e) { return !e.need || e.need(); });
    var tot = ok.reduce(function (s, e) { return s + e.w; }, 0), r = Math.random() * tot;
    for (var i = 0; i < ok.length; i++) { r -= ok[i].w; if (r <= 0) return ok[i]; }
    return ok[0];
  }

  FC.addSystem({
    name: "events", order: 56,
    update: function (dt) {
      var P = FC.player; if (!P || !FC.started) return;
      // живой эфир из ленты: дошёл до здания
      if (watch && FC.inside && FC.inside.active && FC.inside.building && FC.inside.building.id === watch.b) {
        FC.markers.remove("feed"); rep(1); FC.hud.toast("🎥 Ты на эфире агента! Репутация ↑", "ok", 3); watch = null;
      }
      if (ev) {
        if (ev.update) { try { ev.update(dt); } catch (e) { if (global.console) console.error("event", e); endEvent(false); } }
        return;
      }
      if (S.busy() || (FC.inside && FC.inside.active) || P.dead) return;
      evT -= dt;
      if (evT > 0) return;
      evT = 150 + Math.random() * 90;
      var E = pickEvent();
      var res = null;
      try { res = E.run(); } catch (e) { res = null; if (global.console) console.error("event start", e); }
      if (res) { res.id = E.id; ev = res; }
      else evT = 20;
    }
  });
  FC.on("story:start", function () { if (ev) endEvent(false); });

  S.endEvent = endEvent; S.newsLine = newsLine; S.crimeText = crimeText; S.streetAt = streetAt; S.post = post; S.rep = rep;
  S.event = function (id) {
    var E = EVENTS.filter(function (e) { return e.id === id; })[0];
    if (E && !ev && (!E.need || E.need())) { var r = E.run(); if (r) { r.id = id; ev = r; } }
    return !!ev;
  };
})(window);
