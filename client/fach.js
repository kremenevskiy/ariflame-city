/* Флейм-Сити — достижения (FC.ach): реестр, разблокировка, редкость, скрытые, счётчики, витрина «Достижения» в телефоне.
 *
 * Задача: «рейтинги, лидерборды, захваты… как в Rise of Kingdoms — всё из ресёрча». Достижения —
 * долгая цель для тех, кому не нужна борьба (коллекционеры, ресёрч «коллекции» и Steam-редкость), и повод показать себя
 * в профиле (franks.js). Ничего за настоящие деньги: награда — опыт (FC.progress) и строка в профиле.
 *
 * Контракт для других модулей (fmissions*.js, fsecrets.js и любые новые) — fach.js грузится сразу после fprop.js, раньше
 * игровых модулей, так что звать можно и при загрузке, и потом:
 *   FC.ach.define({id, name, desc, icon, rarity, hidden?, need?, group?})   описать (или массивом — пачкой)
 *       id — [a-z0-9_]{2,40}, свой префикс модуля (sec_…, mis_…); rarity — common | rare | epic | legend;
 *       hidden — до открытия видно только «Скрытое достижение»; need — для счётчика (progress/add)
 *   FC.ach.unlock(id)        открыть; true — открыто сейчас (повтор и неизвестный id — false). Событие шины «ach:unlock»
 *                            {id, def}. Неописанный id тоже запоминается (вдруг define придёт позже) — показ без тоста
 *   FC.ach.add(id, d)        прибавить к счётчику (открывается само при n ≥ need); FC.ach.progress(id, n) — поставить
 *   FC.ach.has(id) / get(id) / list() / count() / RARITY
 * Хранение — FC.save.ach {u: {id: время}, p: {id: n}, s: [отправлено на сервер]}; на сервер (server/
 * progress.py, /g/prog/sync) их уносит fprogress.js пачкой раз в 30 с: опыт за достижение — по редкости, сервер режет
 * дневным потолком; число открытых и доля игроков с достижением («есть у 4%») — с сервера (/g/ach/stats, кэш 10 мин).
 */
(function (global) {
  "use strict";
  var FC = global.FC;
  var RARITY = {
    common: { name: "Обычное", color: "#b8c4d6", xp: 25 },
    rare: { name: "Редкое", color: "#4cc9f0", xp: 60 },
    epic: { name: "Эпическое", color: "#c86bff", xp: 120 },
    legend: { name: "Легендарное", color: "#ffb703", xp: 250 }
  };
  var ID_RE = /^[a-z0-9_]{2,40}$/;
  var defs = {}, order = [];
  var S = { filt: "all", share: null, shareAt: 0, banner: null, q: [] };

  FC.css([
    ".ac-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}",
    ".ac-it{background:rgba(255,255,255,.07);border-radius:12px;padding:8px;border:1px solid transparent;min-height:86px;display:flex;flex-direction:column;gap:2px}",
    ".ac-it .ai{font-size:22px;line-height:1}.ac-it b{font:700 12px/1.2 system-ui}.ac-it p{margin:0;font-size:10.5px;color:rgba(255,255,255,.62)}",
    ".ac-it.off{opacity:.55}.ac-it.off .ai{filter:grayscale(1)}",
    ".ac-it em{font:700 9.5px system-ui;font-style:normal;margin-top:auto}",
    ".ac-bar{height:4px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden;margin-top:3px}.ac-bar i{display:block;height:100%;background:#ffcf7a}",
    ".ac-chips{display:flex;gap:5px;margin:0 0 8px}.ac-chips button{flex:1;padding:5px 2px!important;font-size:11px!important}",
    ".ac-ban{position:fixed;left:50%;top:calc(118px + env(safe-area-inset-top));transform:translate(-50%,-30px);opacity:0;z-index:6;",
    "display:flex;gap:10px;align-items:center;background:rgba(14,16,28,.92);border:1px solid;border-radius:16px;padding:8px 14px;",
    "box-shadow:0 10px 30px rgba(0,0,0,.45);transition:transform .35s cubic-bezier(.2,.9,.3,1.2),opacity .35s;pointer-events:none;max-width:86vw}",
    ".ac-ban.on{transform:translate(-50%,0);opacity:1}.ac-ban .ai{font-size:28px}.ac-ban small{display:block;font:700 10px system-ui;letter-spacing:.06em;text-transform:uppercase}",
    ".ac-ban b{font:800 15px system-ui;color:#fff}.ac-ban p{margin:1px 0 0;font-size:12px;color:rgba(255,255,255,.7)}"
  ].join("\n"));

  function st() {
    var s = FC.save.ach;
    if (!s || typeof s !== "object") s = FC.save.ach = { u: {}, p: {}, s: [] };
    if (!s.u) s.u = {}; if (!s.p) s.p = {}; if (!Array.isArray(s.s)) s.s = [];
    return s;
  }
  function esc(t) { return FC.hud && FC.hud.esc ? FC.hud.esc(t) : String(t == null ? "" : t); }

  /* ---- реестр ---------------------------------------------------------------------------------------------------- */
  function define(d) {
    if (Array.isArray(d)) { d.forEach(define); return; }
    if (!d || !ID_RE.test(d.id || "")) { if (global.console) console.warn("FC.ach.define: плохой id", d && d.id); return; }
    var x = { id: d.id, name: String(d.name || d.id), desc: String(d.desc || ""), icon: d.icon || "🏅",
      rarity: RARITY[d.rarity] ? d.rarity : "common", hidden: !!d.hidden, need: d.need > 1 ? Math.round(d.need) : 0,
      group: d.group || "", order: d.order != null ? d.order : order.length };
    if (!defs[x.id]) order.push(x.id);
    defs[x.id] = x;
  }
  function get(id) { return defs[id] || null; }
  function has(id) { return !!(FC.save && FC.save.ach && FC.save.ach.u && FC.save.ach.u[id]); }

  function unlock(id) {
    if (!ID_RE.test(id || "") || !FC.save) return false;
    var s = st();
    if (s.u[id]) return false;
    s.u[id] = Date.now();
    FC.dirty();
    var d = defs[id];
    if (!d) return false;                                       // описание придёт позже — без тоста и опыта
    banner(d);
    FC.emit("ach:unlock", { id: id, def: d });
    return true;
  }
  function progress(id, n) {
    var d = defs[id]; if (!d || has(id)) return;
    var s = st();
    n = Math.max(0, Math.floor(n));
    if (n === s.p[id]) return;
    s.p[id] = n; FC.dirty();
    if (d.need && n >= d.need) unlock(id);
  }
  function add(id, k) { var s = st(); progress(id, (s.p[id] || 0) + (k == null ? 1 : k)); }
  function count() { var s = st(), n = 0; for (var k in s.u) if (defs[k]) n++; return n; }
  function list() { return order.map(function (id) { return defs[id]; }); }
  // для fprogress.js: что ещё не ушло на сервер — [[id, редкость], …] (не больше 40 за раз)
  function pending() {
    var s = st(), sent = {}, out = [];
    s.s.forEach(function (id) { sent[id] = 1; });
    for (var id in s.u) if (!sent[id] && defs[id] && out.length < 40) out.push([id, defs[id].rarity]);
    return out;
  }
  function synced(ids) { var s = st(); ids.forEach(function (id) { if (s.s.indexOf(id) < 0) s.s.push(id); }); FC.dirty(); }
  // открытые на сервере (другое устройство, откат сохранения) — тихо, без плашки и опыта
  function merge(ids) {
    var s = st(), n = 0;
    (ids || []).forEach(function (id) { if (ID_RE.test(id) && !s.u[id]) { s.u[id] = Date.now(); n++; } if (s.s.indexOf(id) < 0) s.s.push(id); });
    if (n) FC.dirty();
    return n;
  }

  /* ---- плашка «достижение открыто»: по одной, очередью ---------------------------------------------------------- */
  var ban = document.createElement("div"); ban.className = "ac-ban";
  function mountBan() { if (!ban.parentNode) (document.getElementById("hud") || document.body).appendChild(ban); }
  function banner(d) {
    S.q.push(d);
    if (S.q.length === 1) showNext();
  }
  function showNext() {
    var d = S.q[0]; if (!d) return;
    mountBan();
    var R = RARITY[d.rarity];
    ban.style.borderColor = R.color;
    ban.style.boxShadow = "0 10px 30px rgba(0,0,0,.45),0 0 22px " + R.color + "55";
    ban.innerHTML = "<span class='ai'>" + esc(d.icon) + "</span><div><small style='color:" + R.color + "'>Достижение · " + R.name + "</small><b>" +
      esc(d.name) + "</b><p>" + esc(d.desc) + " · +" + R.xp + " опыта</p></div>";
    ban.classList.add("on");
    if (FC.audio && FC.audio.play) FC.audio.play("note");
    if (FC.fx && FC.fx.haptic) FC.fx.haptic(d.rarity === "legend" || d.rarity === "epic" ? "heavy" : "medium");
    setTimeout(function () {
      ban.classList.remove("on");
      setTimeout(function () { S.q.shift(); showNext(); }, 420);
    }, 3600);
  }

  /* ---- доля игроков с достижением (сервер, кэш 10 мин) ---------------------------------------------------------- */
  function loadShare() {
    if (FC.gsOff() || Date.now() - S.shareAt < 600000) return Promise.resolve(S.share);
    S.shareAt = Date.now();
    return FC.gfetch("/g/ach/stats").then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.share) S.share = d; return S.share; }).catch(function () { return S.share; });
  }

  /* ---- витрина в телефоне ------------------------------------------------------------------------------------------- */
  function card(d, s) {
    var got = !!s.u[d.id], R = RARITY[d.rarity], secret = d.hidden && !got;
    var share = S.share && S.share.share && S.share.share[d.id], n = s.p[d.id] || 0;
    return "<div class='ac-it" + (got ? "" : " off") + "' style='" + (got ? "border-color:" + R.color + "66" : "") + "'>" +
      "<span class='ai'>" + (secret ? "❔" : esc(d.icon)) + "</span><b>" + (secret ? "Скрытое достижение" : esc(d.name)) + "</b>" +
      "<p>" + (secret ? "Откроется само — когда случится" : esc(d.desc)) + "</p>" +
      (!got && d.need && !secret ? "<div class='ac-bar'><i style='width:" + Math.min(100, Math.round(n / d.need * 100)) + "%'></i></div><p>" + Math.min(n, d.need) + " / " + d.need + "</p>" : "") +
      "<em style='color:" + R.color + "'>" + R.name + (share != null ? " · есть у " + (share < 1 ? "<1" : Math.round(share)) + "%" : "") +
      (got ? " · ✓" : "") + "</em></div>";
  }
  function render(b, ctl) {
    var s = st(), all = list(), got = all.filter(function (d) { return s.u[d.id]; });
    var by = { common: 0, rare: 0, epic: 0, legend: 0 };
    got.forEach(function (d) { by[d.rarity]++; });
    var show = all.filter(function (d) {
      return S.filt === "got" ? s.u[d.id] : S.filt === "todo" ? !s.u[d.id] : S.filt === "rare" ? d.rarity !== "common" : true;
    });
    // открытые — вперёд, внутри — по редкости (легендарные сверху)
    var rk = { legend: 0, epic: 1, rare: 2, common: 3 };
    show.sort(function (a, c) { return (!!s.u[c.id] - !!s.u[a.id]) || (rk[a.rarity] - rk[c.rarity]) || (a.order - c.order); });
    var html = "<div class='card'><b>🏅 Открыто " + got.length + " из " + all.length + "</b><p>" +
      Object.keys(RARITY).map(function (k) { return "<span style='color:" + RARITY[k].color + "'>" + RARITY[k].name + " " + by[k] + "</span>"; }).join(" · ") +
      "</p><p>Опыт за достижение — по редкости. Скрытые откроются, когда случится что-то особенное.</p></div>";
    html += "<div class='ac-chips'>" + [["all", "Все"], ["got", "Мои"], ["todo", "Ещё нет"], ["rare", "Редкие"]].map(function (f) {
      return "<button type='button' class='" + (S.filt === f[0] ? "" : "ghost") + "' data-acf='" + f[0] + "'>" + f[1] + "</button>";
    }).join("") + "</div>";
    html += "<div class='ac-grid'>" + show.map(function (d) { return card(d, s); }).join("") + "</div>";
    b.innerHTML = html;
    b.querySelectorAll("[data-acf]").forEach(function (x) { x.addEventListener("click", function () { S.filt = x.dataset.acf; ctl.refresh(); }); });
    loadShare().then(function (d) { if (d && b.isConnected && !b._shared) { b._shared = 1; render(b, ctl); } });
  }
  if (FC.hud) FC.hud.addApp({ id: "ach", icon: "🏅", name: "Достижения", color: "#a86b00", order: 8, render: render });

  /* ---- свои достижения: по событиям шины (у других модулей — свои, через define/unlock) ------------------------- */
  define([
    { id: "first_job", name: "Первая смена", desc: "Отработай любую смену", icon: "💼", rarity: "common" },
    { id: "jobs_50", name: "Трудоголик", desc: "50 смен, поездок и доставок", icon: "🛠️", rarity: "rare", need: 50 },
    { id: "jobs_300", name: "Ударник", desc: "300 смен, поездок и доставок", icon: "🏭", rarity: "epic", need: 300 },
    { id: "first_home", name: "Ключи от дома", desc: "Купи своё первое здание", icon: "🔑", rarity: "common" },
    { id: "rentier", name: "Рантье", desc: "Владей шестью зданиями сразу", icon: "🏙️", rarity: "epic" },
    { id: "first_biz", name: "Своё дело", desc: "Открой бизнес", icon: "🏪", rarity: "common" },
    { id: "biz_cash_1m", name: "Касса гудит", desc: "Собери $1 000 000 выручки бизнесов", icon: "💰", rarity: "epic", need: 1000000 },
    { id: "deliver_10", name: "Логист", desc: "10 доставок заказов бизнеса", icon: "🚚", rarity: "rare", need: 10 },
    { id: "first_race", name: "Первый финиш", desc: "Пройди гонку до конца", icon: "🏁", rarity: "common" },
    { id: "race_25", name: "Асфальт знает", desc: "25 гонок до финиша", icon: "🏎️", rarity: "rare", need: 25 },
    { id: "first_heist", name: "Тихий налёт", desc: "Проверни первое дело", icon: "🕶️", rarity: "common" },
    { id: "heist_20", name: "Почерк мастера", desc: "20 удачных налётов", icon: "💼", rarity: "epic", need: 20 },
    { id: "escape", name: "Ушёл огородами", desc: "Оторвись от погони «Щита»", icon: "💨", rarity: "common" },
    { id: "five_stars", name: "Пять звёзд", desc: "Собери пять звёзд розыска", icon: "🌟", rarity: "rare", hidden: true },
    { id: "stunts_50", name: "Каскадёр", desc: "50 трюков на машине", icon: "🤸", rarity: "rare", need: 50 },
    { id: "photo_story", name: "Звезда сторис", desc: "Выложи кадр из игры в сторис или другу", icon: "📸", rarity: "common" },
    { id: "photo_25", name: "Фотограф", desc: "25 снимков в фоторежиме", icon: "🎞️", rarity: "rare", need: 25 },
    { id: "sky", name: "Небо зовёт", desc: "Подними в воздух вертолёт или самолёт", icon: "🚁", rarity: "common" },
    { id: "crew_join", name: "Своя семья", desc: "Вступи в клан", icon: "🛡️", rarity: "common" },
    { id: "crew_found", name: "Основатель", desc: "Создай свой клан", icon: "🚩", rarity: "rare" },
    { id: "crew_help_30", name: "Плечо", desc: "Помоги соклановцам 30 раз", icon: "🤝", rarity: "rare", need: 30 },
    { id: "war_flag", name: "Знамя над районом", desc: "Твой клан взял район в «войне за район»", icon: "🏴", rarity: "epic" },
    { id: "war_hold", name: "Держим точку", desc: "Удержи флаг района в окно войны", icon: "⛳", rarity: "rare" },
    { id: "lvl_10", name: "Свой в городе", desc: "Достигни 10-го уровня", icon: "⭐", rarity: "common" },
    { id: "lvl_25", name: "Авторитет", desc: "Достигни 25-го уровня", icon: "🌠", rarity: "rare" },
    { id: "lvl_50", name: "Легенда района", desc: "Достигни 50-го уровня", icon: "👑", rarity: "epic" },
    { id: "lvl_100", name: "Икона города", desc: "Достигни 100-го уровня", icon: "🔥", rarity: "legend" },
    { id: "streak_7", name: "Без выходных", desc: "Заходи семь дней подряд", icon: "📆", rarity: "rare" },
    { id: "streak_30", name: "Старожил", desc: "Заходи 30 дней подряд", icon: "🗓️", rarity: "legend" },
    { id: "millionaire", name: "Миллионер", desc: "Состояние больше $1 000 000", icon: "💎", rarity: "epic" },
    { id: "top10", name: "В десятке", desc: "Попади в десятку любого рейтинга", icon: "🏆", rarity: "epic" },
    { id: "two_cities", name: "Турист", desc: "Побывай и во Флейм-Сити, и в Минске", icon: "🧳", rarity: "rare", hidden: true },
    { id: "night_owl", name: "Сова", desc: "Играй глубокой ночью", icon: "🦉", rarity: "rare", hidden: true },
    { id: "boom", name: "Бабах", desc: "Взорви машину", icon: "💥", rarity: "common", hidden: true }
  ]);

  function job() { if (!has("first_job")) unlock("first_job"); add("jobs_50"); add("jobs_300"); }
  FC.on("job:done", job);
  FC.on("prop:buy", function () {
    unlock("first_home");
    if (FC.prop && FC.prop.all && FC.prop.all().length >= 6) unlock("rentier");
  });
  FC.on("home:buy", function () { unlock("first_home"); });
  FC.on("biz:open", function () { unlock("first_biz"); });
  FC.on("biz:collect", function (e) { if (e && e.paid > 0) add("biz_cash_1m", e.paid); });
  FC.on("biz:run", function (e) { if (e && e.kind === "sell" && e.paid > 0) add("deliver_10"); });
  FC.on("race:done", function () { unlock("first_race"); add("race_25"); });
  FC.on("heist:done", function () { unlock("first_heist"); add("heist_20"); });
  FC.on("wanted:lost", function () { unlock("escape"); });
  FC.on("wanted", function (e) { var n = typeof e === "number" ? e : e && (e.stars || e.n); if (n >= 5) unlock("five_stars"); });
  FC.on("stunt", function () { add("stunts_50"); });
  FC.on("photo:shot", function () { add("photo_25"); });
  FC.on("photo:story", function () { unlock("photo_story"); });
  FC.on("photo:share", function () { unlock("photo_story"); });
  FC.on("air:takeoff", function () { unlock("sky"); });
  FC.on("car:explode", function () { unlock("boom"); });
  FC.on("save:load", function () {
    var f = FC.save.flags || (FC.save.flags = {}), c = f.cities || (f.cities = {});
    if (!c[FC.city]) { c[FC.city] = 1; FC.dirty(); }
    if (c.flame && c.minsk) unlock("two_cities");
  });
  FC.on("start", function () { var h = new Date().getHours(); if (h >= 2 && h < 5) unlock("night_owl"); });

  FC.ach = { define: define, unlock: unlock, add: add, progress: progress, has: has, get: get, list: list, count: count,
    pending: pending, synced: synced, merge: merge, RARITY: RARITY, open: function () { if (FC.hud) FC.hud.openPhone("ach"); } };
})(window);
