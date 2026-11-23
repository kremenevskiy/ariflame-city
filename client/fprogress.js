/* Флейм-Сити — уровень и опыт игрока (FC.progress): опыт за любое дело, уровень 1–100+ по GTA-кривой, титулы, открытия
 * по уровню, праздник нового уровня, значок уровня у миникарты, награда за вход по дням (серия 7 дней).
 *
 * Задача: «рейтинги, лидерборды… как в Rise of Kingdoms — всё из ресёрча». Ресёрч: GTA Online — ранг
 * за любое дело и открытия по рангу; RoK — ежедневный вход и недельный ритм. Ничего за настоящие деньги.
 * Сервер — server/progress.py: опыт выдаёт ОН. Клиент копит, что игрок сделал ({источник: раз}), и раз в
 * 30 с уносит пачкой (/g/prog/sync) вместе с новыми достижениями (FC.ach.pending); сервер режет частоту и потолки и
 * отвечает настоящим опытом — его и берём. Касса и доставки бизнесов, гонки, дела в районах, помощь клану, флаг в войну,
 * вход по дням сервер начисляет сам — здесь только всплывашка «+N опыта». Гость копит опыт локально (рейтинга у гостя нет).
 *
 *   FC.progress.gain(src, n?)     опыт за дело: job, mission, event, heist, photo, daily, stunt, secret (их сообщает клиент)
 *   FC.progress.lvl() / xp() / need(l) / lvlOf(xp) / title(l) / me() / refresh() / sync()
 *   FC.progress.gate(kind, x)     0 — можно; иначе нужный уровень: weapon (id), car (цена), biz (тип), prop (B), crew
 *   FC.progress.unlocks(l)        что открывается на уровне l — [{icon, text}]
 * События шины: «progress:xp» {xp, lvl, d}, «progress:level» {lvl, from}.
 */
(function (global) {
  "use strict";
  var FC = global.FC;
  // источник → опыт за раз (как SRC на сервере); CLIENT — их клиент сообщает сам
  var SRC = { job: 35, mission: 120, event: 60, heist: 200, photo: 25, daily: 100, stunt: 8, secret: 40,
    run: 80, race: 100, district: 20, help: 12, war: 40 };
  var CAP = { job: 2500, mission: 3000, event: 1500, heist: 2400, photo: 300, daily: 600, stunt: 400, secret: 1200 };
  var CLIENT = { job: 1, mission: 1, event: 1, heist: 1, photo: 1, daily: 1, stunt: 1, secret: 1 };
  var DAY_CAP = 15000, SYNC_S = 30, SEED_LVL = 25;
  var TITLES = [[1, "Новичок"], [3, "Местный"], [5, "Свой человек"], [10, "Делец"], [15, "Решала"], [20, "Деловой"],
    [30, "Авторитет"], [40, "Магнат"], [50, "Легенда района"], [75, "Хозяин города"], [100, "Икона города"], [150, "Миф"]];
  // открытия по уровню: оружие — поверх заработка (fweap), машины — по цене, бизнесы — по оборудованию, ориентиры, клан
  var GATES = {
    weapon: { revolver: 3, smg: 5, molotov: 7, shotgun: 8, grenade: 10, rifle: 12, sniper: 16 },
    car: [[20000, 0], [40000, 4], [70000, 8], [100000, 12], [200000, 18], [1e12, 25]],
    biz: [[30000, 0], [60000, 4], [120000, 8], [1e12, 12]],
    prop: 8, crew: 5
  };
  var UNLOCKS = {
    3: [["🤠", "Револьвер «Гром .44» в Оружейной"]], 4: [["🚗", "Машины до $40 000"], ["🏪", "Бизнесы среднего класса"]],
    5: [["🛡️", "Свой клан — «Клан» в телефоне"], ["🐝", "ПП «Шмель»"]], 7: [["🍾", "Коктейль «Факел»"]],
    8: [["🏙️", "Ориентиры: высотки и известные здания"], ["💥", "Дробовик «Тайфун»"], ["🚙", "Машины до $70 000"], ["🏢", "Крупные бизнесы"]],
    10: [["🧨", "Граната «Хлопушка»"]], 12: [["🪖", "Автомат «Буря»"], ["🏎️", "Машины до $100 000"], ["🎆", "Клуб и самые дорогие бизнесы"]],
    16: [["🎯", "Винтовка «Ястреб»"]], 18: [["🏁", "Суперкары до $200 000"]], 25: [["🚀", "Гиперкары — весь автосалон"]]
  };

  var P = { xp: 0, lvl: 1, pend: {}, pendXp: 0, inflight: null, t: 0, me: null, meAt: 0, srv: false, lastErr: 0 };

  FC.css([
    ".pg-lvl{position:absolute;left:0;top:-44px;width:38px;height:38px;border-radius:50%;display:grid;place-items:center;cursor:pointer;",
    "background:conic-gradient(#ffcf7a var(--p,0%),rgba(255,255,255,.14) 0);box-shadow:0 4px 14px rgba(0,0,0,.45)}",
    ".pg-lvl b{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:#141829;color:#ffcf7a;font:800 13px system-ui}",
    ".pg-lvl i{position:absolute;left:42px;top:10px;white-space:nowrap;font:700 11px system-ui;font-style:normal;color:rgba(255,240,215,.85);text-shadow:0 1px 3px #000}",
    "body.touch .pg-lvl{left:110px;top:0}body.touch .pg-lvl i{display:none}",
    ".pg-day{position:fixed;inset:0;display:grid;place-items:center;background:rgba(5,7,15,.55);z-index:9;pointer-events:auto}",
    ".pg-day .cd{width:min(360px,92vw);background:#121626;border:1px solid rgba(255,207,122,.35);border-radius:20px;padding:16px;box-shadow:0 20px 60px rgba(0,0,0,.6)}",
    ".pg-day h3{margin:0 0 4px;font:800 18px system-ui;color:#ffcf7a}.pg-day p{margin:0 0 10px;font-size:13px;color:rgba(255,255,255,.7)}",
    ".pg-days{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:12px}",
    ".pg-days div{border-radius:10px;padding:6px 2px;text-align:center;background:rgba(255,255,255,.07);font:700 10px system-ui;color:rgba(255,255,255,.6)}",
    ".pg-days div b{display:block;font:800 12px system-ui;color:#fff}.pg-days div.got{background:rgba(47,191,113,.25)}",
    ".pg-days div.now{background:#ffcf7a;color:#2a1205}.pg-days div.now b{color:#2a1205}",
    ".pg-day button{width:100%;border:0;border-radius:12px;padding:10px;font:800 15px system-ui;background:#ffcf7a;color:#2a1205;cursor:pointer}",
    ".pg-day button.ghost{background:rgba(255,255,255,.1);color:#fff;margin-top:6px;font-weight:600}"
  ].join("\n"));

  /* ---- кривая и титулы (те же, что progress.py) -------------------------------------------------------------- */
  function need(l) { var k = Math.max(0, l - 1); return 250 * k + 60 * k * k; }
  function lvlOf(xp) {
    xp = Math.max(0, xp || 0);
    var k = Math.floor((-250 + Math.sqrt(62500 + 240 * xp)) / 120);
    while (need(k + 2) <= xp) k++;
    while (k > 0 && need(k + 1) > xp) k--;
    return Math.max(1, Math.min(500, k + 1));
  }
  function title(l) { var n = TITLES[0][1]; for (var i = 0; i < TITLES.length; i++) if (l >= TITLES[i][0]) n = TITLES[i][1]; return n; }
  function unlocks(l) { return (UNLOCKS[l] || []).map(function (u) { return { icon: u[0], text: u[1] }; }); }
  function tier(list, v) { for (var i = 0; i < list.length; i++) if (v < list[i][0]) return list[i][1]; return 0; }
  function gate(kind, x) {
    var want = 0;
    if (kind === "weapon") want = GATES.weapon[x] || 0;
    else if (kind === "car") want = tier(GATES.car, +x || 0);
    else if (kind === "biz") want = tier(GATES.biz, FC.biz && FC.biz.TYPES[x] ? FC.biz.TYPES[x].equip : 0);
    else if (kind === "prop") want = x && FC.prop && FC.prop.landmarkOf && FC.prop.landmarkOf(x) ? GATES.prop : 0;
    else if (kind === "crew") want = GATES.crew;
    return P.lvl >= want ? 0 : want;
  }

  /* ---- состояние в сохранении ------------------------------------------------------------------------------------ */
  function today() { var d = new Date(); return d.getFullYear() * 400 + d.getMonth() * 32 + d.getDate(); }
  function S() {
    var s = FC.save.prog;
    if (!s || typeof s !== "object") {
      // первый заход с уровнями: опыт из прошлого (заработок и минуты игры) — как на сервере, не выше SEED_LVL
      var st = FC.save.stats || {};
      var seed = Math.min(need(SEED_LVL), Math.floor((st.earned || 0) / 40 + (st.playMin || 0) * 15));
      s = FC.save.prog = { xp: seed, top: lvlOf(seed), day: { k: today(), x: {} } };
      FC.dirty();
    }
    if (!s.day || s.day.k !== today()) s.day = { k: today(), x: {} };
    return s;
  }
  function token() { return FC.net && FC.net.token; }
  function post(path, body) {
    if (FC.prop && FC.prop.post) return FC.prop.post(path, body);
    return FC.gfetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.detail || r.status); return j; }); });
  }

  /* ---- значок уровня у миникарты (обновляется только по событиям) ------------------------------------------------ */
  var badge = document.createElement("div"); badge.className = "pg-lvl"; badge.innerHTML = "<b>1</b><i></i>";
  badge.title = "Уровень и рейтинг";
  badge.addEventListener("click", function (e) { e.stopPropagation(); if (FC.hud) FC.hud.openPhone("ranks"); });
  function mountBadge() {
    if (badge.parentNode) return;
    var w = document.querySelector(".miniwrap");
    if (w) w.appendChild(badge);
  }
  function drawBadge() {
    mountBadge();
    var cur = need(P.lvl), nx = need(P.lvl + 1), p = Math.max(0, Math.min(100, (P.xp - cur) / Math.max(1, nx - cur) * 100));
    badge.firstChild.textContent = P.lvl;
    badge.style.setProperty("--p", p.toFixed(1) + "%");
    badge.lastChild.textContent = title(P.lvl);
  }

  /* ---- опыт ------------------------------------------------------------------------------------------------------ */
  function setXp(xp, quiet) {
    var s = S(), was = P.lvl;
    P.xp = Math.max(0, Math.round(xp));
    P.lvl = lvlOf(P.xp);
    s.xp = P.xp;
    FC.dirty();
    drawBadge();
    FC.emit("progress:xp", { xp: P.xp, lvl: P.lvl });
    if (P.lvl > (s.top || 1)) {
      var from = s.top || was;
      s.top = P.lvl;
      if (!quiet) celebrate(from, P.lvl);
    }
  }
  function popup(n) { if (n > 0 && FC.hud && FC.hud.popup) FC.hud.popup("+" + n + " опыта", { color: "#ffcf7a" }); }
  function gain(src, n) {
    n = n == null ? 1 : Math.max(0, Math.floor(n));
    var per = SRC[src];
    if (!per || !n || !FC.save) return 0;
    var s = S(), used = s.day.x[src] || 0, all = s.day.x._ || 0;
    var cap = CAP[src] || 1e9, x = Math.max(0, Math.min(per * n, cap - used, DAY_CAP - all));
    if (CLIENT[src] && token()) P.pend[src] = (P.pend[src] || 0) + n;
    if (!x) return 0;
    s.day.x[src] = used + x; s.day.x._ = all + x;
    if (CLIENT[src] && token()) P.pendXp += x;
    popup(x);
    setXp(P.xp + x);
    return x;
  }
  // опыт, который начислил сервер (касса, гонка, помощь…): показать сразу, правду возьмём при синхронизации
  function shown(n) {
    n = Math.round(n || 0);
    if (n <= 0) return;
    var s = S(); s.day.x._ = (s.day.x._ || 0) + n;
    popup(n);
    setXp(P.xp + n);
  }

  function celebrate(from, to) {
    var un = [];
    for (var l = from + 1; l <= to; l++) un = un.concat(unlocks(l));
    if (FC.hud) FC.hud.big("УРОВЕНЬ " + to, title(to) + (un.length ? " · открыто: " + un.map(function (u) { return u.icon + " " + u.text; }).join(", ") : ""), "#ffcf7a", 4.2);
    if (FC.audio && FC.audio.play) FC.audio.play("mission");
    if (FC.fx) {
      if (FC.fx.haptic) FC.fx.haptic("heavy");
      var pl = FC.player;
      if (FC.fx.burst && pl) FC.fx.burst(pl.x, (pl.y || 0) + 1.6, pl.z, "confetti", 70);
    }
    [10, 25, 50, 100].forEach(function (k) { if (to >= k && FC.ach) FC.ach.unlock("lvl_" + k); });
    if (un.length && FC.hud && FC.hud.notify) FC.hud.notify("Уровень " + to, un.map(function (u) { return u.icon + " " + u.text; }).join(" · "), "⭐", 7);
    FC.emit("progress:level", { lvl: to, from: from });
    if (FC.story && FC.story.post && to % 5 === 0) {
      FC.story.post({ id: "lvl" + to, kind: "story", cell: -1, who: "Флеймграм", text: "⭐ Новый уровень — " + to + ": «" + title(to) + "»", likes: 20 + Math.floor(Math.random() * 60) });
    }
  }

  /* ---- сервер: пачка раз в 30 с, профиль по запросу ---------------------------------------------------------------- */
  function sync(force) {
    if (!token() || P.inflight) return Promise.resolve(null);
    var gains = P.pend, ach = FC.ach ? FC.ach.pending() : [];
    if (!force && !Object.keys(gains).length && !ach.length) return Promise.resolve(null);
    P.pend = {}; var sent = P.pendXp; P.pendXp = 0;
    P.inflight = post("/g/prog/sync", { token: token(), city: FC.city || "flame", gains: gains, ach: ach }).then(function (d) {
      P.inflight = null; P.srv = true; P.meAt = 0;     // профиль в «Рейтинге» — перечитать
      if (ach.length && FC.ach) FC.ach.synced(d.ach_ok || []);
      setXp(d.xp + P.pendXp, false);               // правда сервера + то, что набежало, пока шёл запрос
      if (d.daily) P.daily = d.daily;
      return d;
    }).catch(function (e) {
      P.inflight = null;
      if (e && e.status === 429) { Object.keys(gains).forEach(function (k) { P.pend[k] = (P.pend[k] || 0) + gains[k]; }); P.pendXp += sent; }
      return null;
    });
    return P.inflight;
  }
  function refresh(force) {
    if (!token()) return Promise.resolve(null);
    if (!force && P.me && Date.now() - P.meAt < 60000) return Promise.resolve(P.me);
    return post("/g/prog/me", { token: token(), city: FC.city || "flame" }).then(function (d) {
      P.me = d; P.meAt = Date.now(); P.srv = true; P.daily = d.daily;
      if (FC.ach && FC.ach.merge && d.ach) FC.ach.merge(d.ach);
      setXp(d.xp + P.pendXp, true);
      FC.emit("progress:me", d);
      return d;
    }).catch(function () { P.meAt = Date.now() - 30000; return P.me; });   // сервер молчит — снова не раньше чем через 30 с
  }
  FC.addSystem({
    name: "progress", order: 96,
    update: function () {
      var t = performance.now();                     // настоящие часы: dt кадра урезан и на паузе стоит
      if (!P.t) P.t = t;
      if (t - P.t < SYNC_S * 1000) return;
      P.t = t;
      sync(false);
    }
  });
  global.addEventListener("pagehide", function () {
    // ушёл из игры — несохранённое уносим маяком (text/plain без preflight, как сохранение в fmp.js)
    var tok = token();
    if (!tok || !global.navigator.sendBeacon || (!Object.keys(P.pend).length && !(FC.ach && FC.ach.pending().length))) return;
    try {
      var body = JSON.stringify({ token: tok, city: FC.city || "flame", gains: P.pend, ach: FC.ach ? FC.ach.pending() : [] });
      if (!FC.gsOff()) global.navigator.sendBeacon(FC.gs() + "/g/prog/sync", new Blob([body], { type: "text/plain;charset=UTF-8" }));
    } catch (e) { /* в следующий раз */ }
  });

  /* ---- награда за вход: серия 7 дней ------------------------------------------------------------------------------- */
  function dailyCard() {
    var D = P.daily; if (!D || !D.can || document.querySelector(".pg-day")) return;
    var box = document.createElement("div"); box.className = "pg-day";
    var cells = D.table.map(function (t, i) {
      var cls = i + 1 < D.day ? "got" : i + 1 === D.day ? "now" : "";
      return "<div class='" + cls + "'>день " + (i + 1) + "<b>" + FC.fmtMoney(t[0]).replace(" ", " ") + "</b>+" + t[1] + "</div>";
    }).join("");
    box.innerHTML = "<div class='cd'><h3>🔥 Награда за вход</h3><p>" + (D.streak ? "Серия " + D.streak + " дн. подряд — не прерывай: на седьмой день больше всего и титул «Завсегдатай»." :
      "Заходи каждый день — награда растёт семь дней подряд.") + "</p><div class='pg-days'>" + cells + "</div>" +
      "<button type='button' class='go'>Забрать " + FC.fmtMoney(D.money) + " и +" + D.xp + " опыта</button><button type='button' class='ghost'>Потом</button></div>";
    (document.getElementById("hud") || document.body).appendChild(box);
    if (FC.input && FC.input.enable) FC.input.enable(false);
    function close() { box.remove(); if (FC.input && FC.input.enable) FC.input.enable(true); }
    box.querySelector(".ghost").addEventListener("click", close);
    box.querySelector(".go").addEventListener("click", function () {
      var b = this; b.disabled = true;
      post("/g/prog/daily", { token: token() }).then(function (d) {
        close();
        if (d.ok) {
          FC.money(d.paid, "награда за вход");
          if (FC.hud) FC.hud.big("ДЕНЬ " + d.day + " ИЗ 7", "+" + FC.fmtMoney(d.paid) + " · серия " + d.streak + " дн.", "#9dffbf", 3);
          shown(d.xp);
          if (d.streak >= 7 && FC.ach) FC.ach.unlock("streak_7");
          if (d.streak >= 30 && FC.ach) FC.ach.unlock("streak_30");
        }
        P.daily = d.daily; P.meAt = 0;
      }).catch(function (e) { b.disabled = false; if (FC.hud) FC.hud.toast(e.message || "Не получилось", "bad", 3); });
    });
  }

  /* ---- опыт за дела: события шины ---------------------------------------------------------------------------------- */
  FC.on("job:done", function () { gain("job"); });
  FC.on("story:pass", function () { gain("mission"); });
  FC.on("buddy:task", function () { gain("mission"); });
  FC.on("cityevent:end", function (e) { if (e && e.ok) gain("event"); });
  FC.on("heist:done", function () { gain("heist"); });
  FC.on("photo:story", function () { gain("photo"); });
  FC.on("photo:share", function () { gain("photo"); });           // «Другу» и «Поделиться» (fphoto.js)
  FC.on("stunt", function () { gain("stunt"); });
  FC.on("pickup", function () { gain("secret"); });
  FC.on("money", function (m) { if (m && m.why === "задание дня") gain("daily"); });
  FC.on("race:done", function (e) { if (e && e.official) shown(SRC.race); else gain("event"); });
  FC.on("biz:collect", function (e) { if (e && e.paid > 0) shown(Math.min(150, 10 + e.paid / 400)); });
  FC.on("biz:run", function (e) { if (e && e.paid > 0) shown(SRC.run); });

  FC.on("save:load", function () {
    var s = S();
    P.xp = s.xp || 0; P.lvl = lvlOf(P.xp);
    if (!s.top) s.top = P.lvl;
    drawBadge();
  });
  FC.on("me", function () {
    P.me = null; P.meAt = 0; P.pend = {}; P.pendXp = 0;
    if (token()) refresh(true).then(function () { setTimeout(dailyCard, 2500); });
  });

  FC.progress = {
    gain: gain, shown: shown, lvl: function () { return P.lvl; }, xp: function () { return P.xp; }, need: need, lvlOf: lvlOf,
    title: title, unlocks: unlocks, gate: gate, GATES: GATES, UNLOCKS: UNLOCKS, TITLES: TITLES, SRC: SRC,
    me: function () { return P.me; }, fresh: function () { return !!P.me && Date.now() - P.meAt < 60000; }, refresh: refresh, sync: sync, daily: function () { return P.daily; }, dailyCard: dailyCard,
    server: function () { return P.srv; }
  };
})(window);
