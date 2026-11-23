/* Флейм-Сити — бизнесы в своих нежилых зданиях (FC.biz): виды, улучшения, сырьё и касса по таймерам, рейсы-миссии,
 * сотрудники — ИИ-агенты (черты, навык, ставка, мораль, уходы, увольнение с последствиями), менеджер, приложение «Бизнес».
 *
 * Задача: «…бизнес сделать, построить, потом кого-то нанять на работу или уволить; механики как в
 * Rise of Kingdoms, чтобы люди оставались». Цикл — как бизнесы GTA Online: купил здание (FC.prop) → открыл бизнес →
 * сырьё → выручка копится в кассе по часам сервера → забрал у здания или отвёз заказ («доставка» ×1,35).
 * Всё, что дёшево проверить, считает сервер (server/realty.py): владение, уровень, сырьё, касса, сотрудники и
 * кандидаты (их выдаёт сервер — подделать навык нельзя), время рейса. Клиент платит наличными (FC.money) за открытие,
 * улучшения, сырьё и менеджера, если не платит из кассы; выручку сервер выдаёт «кредитом» честности сохранений.
 *
 * Здание с бизнесом выглядит бизнесом у всех игроков: запись здания получает poi «biz» и набор мебели (ffurn K.biz —
 * своими наборами fbz_*), внутри у своего — сотрудники за работой (FC.life.onPopulate), касса и кабинет; у двери —
 * «касса $X». События — в «Ленту» (FC.story.post): открытие, отзыв уволенного, уход, 5-й уровень.
 *
 *   FC.biz.TYPES / TRAITS / list() / get(key) / refresh() / open(prop) / atDoor(prop, B) / doorLabel(prop) / collect(key)
 */
(function (global) {
  "use strict";
  var FC = global.FC, M = FC.map;

  /* ---- справочник: то же, что realty.py (цены и формулы — на сервере, здесь — показ) ------------------------- */
  var TYPES = {
    cafe: { name: "Кафе", emoji: "☕", rate: 3000, equip: 15000, area: 80, kit: "coffee", color: "#a0522d", about: "кофе и завтраки — стабильный поток" },
    shawarma: { name: "Шаурма", emoji: "🌯", rate: 2200, equip: 8000, area: 40, kit: "shawarma", color: "#ff9f1c", about: "дёшево открыть, быстро окупается" },
    tires: { name: "Шиномонтаж", emoji: "🛞", rate: 2600, equip: 12000, area: 100, kit: "carwash", color: "#6c757d", about: "сезонный спрос, машины всегда едут" },
    carshow: { name: "Автосалон", emoji: "🏎️", rate: 5800, equip: 60000, area: 450, kit: "fbz_cars", color: "#ff7a2f", about: "дорого, но выручка большая; нужен простор" },
    beauty: { name: "Салон красоты", emoji: "💅", rate: 3200, equip: 18000, area: 60, kit: "barber", color: "#ff70a6", about: "постоянные клиенты любят мастеров" },
    it: { name: "IT-студия", emoji: "💻", rate: 5200, equip: 30000, area: 120, kit: "fbz_it", color: "#7c5cff", about: "сайты и боты на заказ — ИИ-агенты в деле" },
    corner: { name: "Магазин у дома", emoji: "🛒", rate: 2400, equip: 10000, area: 60, kit: "fbz_store", color: "#41e08c", about: "хлеб, молоко и сырки — с утра до ночи" },
    club: { name: "Клуб", emoji: "🪩", rate: 6400, equip: 70000, area: 300, kit: "nightclub", color: "#c86bff", about: "ночью — главный бизнес района" },
    fitness: { name: "Фитнес", emoji: "🏋️", rate: 4000, equip: 25000, area: 200, kit: "fbz_gym", color: "#9aa5b1", about: "абонементы — деньги вперёд" },
    carwash: { name: "Автомойка", emoji: "🧽", rate: 2700, equip: 14000, area: 100, kit: "carwash", color: "#4cc9f0", about: "после дождя — очередь" },
    print: { name: "Типография", emoji: "🖨️", rate: 3400, equip: 20000, area: 100, kit: "fbz_print", color: "#e9c46a", about: "визитки, меню, баннеры для соседей" },
    bakery: { name: "Пекарня", emoji: "🥐", rate: 2500, equip: 11000, area: 60, kit: "fbz_cafe", color: "#d4a373", about: "запах хлеба зовёт с улицы" }
  };
  var WORDS = ["Огонёк", "Искра", "Улей", "Байт", "Вектор", "Сокол", "Лён", "Зубр", "Янтарь", "Комета", "Пчёлка", "Кедр",
    "Неон", "Пиксель", "Восход", "Ромашка", "Маяк", "Орбита", "Капля", "Берёзка", "Сова", "Лис", "Прилив", "Север"];
  var TRAITS = {
    hard: ["Трудоголик", "+15% выработки", "ok"], lazy: ["Лентяй", "−20% выработки, ставка ниже", "bad"],
    cheap: ["Работает за копейки", "ставка −30%, не обижается", "ok"], soul: ["Душа компании", "+мораль всем", "ok"],
    grump: ["Ворчун", "−мораль всем", "bad"], fast: ["Шустрый", "+10% выработки", "ok"], perfect: ["Перфекционист", "+10% к доставке", "ok"],
    thrifty: ["Экономный", "−10% расход сырья", "ok"], loyal: ["Верный", "почти не уходит", "ok"], flighty: ["Летун", "уходит легко", "bad"],
    greedy: ["Любит деньги", "мораль — от ставки", ""], star: ["Звезда района", "+8% клиентов, ставка +30%", ""], learner: ["Быстро учится", "навык растёт вдвое быстрее", "ok"]
  };
  var MAX_LVL = 5;
  function lvlK(l) { return 1 + 0.4 * (l - 1); }
  function capH(l, mgr) { return mgr ? 6 + l : 2 + 0.5 * (l - 1); }

  var Z = { list: {}, at: 0, view: null, open: null, word: 0, run: null, npcs: [], acts: [], busy: false, seen: {}, deco: [] };

  FC.css([
    ".bz-bar{height:6px;border-radius:4px;background:rgba(255,255,255,.1);overflow:hidden;margin:3px 0 5px}.bz-bar i{display:block;height:100%;border-radius:4px}",
    ".bz-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:6px 0}.bz-grid div{background:rgba(255,255,255,.07);border-radius:10px;padding:6px 8px;font-size:11px;color:rgba(255,245,230,.62)}",
    ".bz-grid b{display:block;font:800 14px system-ui;color:#fff}",
    ".bz-tr{display:inline-block;font:600 10px system-ui;padding:1px 6px;border-radius:8px;margin:2px 3px 0 0;background:rgba(255,255,255,.12);color:#fff}",
    ".bz-tr.ok{background:rgba(47,191,113,.25);color:#b8ffd6}.bz-tr.bad{background:rgba(255,93,108,.25);color:#ffc2c8}",
    ".bz-emp{display:flex;gap:8px;align-items:flex-start}.bz-av{flex:none;width:40px;height:40px;border-radius:12px;background-color:rgba(255,255,255,.08);display:grid;place-items:center;font-size:22px}",
    ".bz-emp>div{flex:1;min-width:0}.bz-q{font-size:12px;font-style:italic;color:rgba(255,240,215,.75);margin:3px 0}",
    ".bz-types{display:grid;grid-template-columns:1fr 1fr;gap:6px}.bz-types button{text-align:left;padding:7px 8px!important;font-size:11px!important;line-height:1.3;background:rgba(255,255,255,.08)!important;color:#fff!important;border-radius:12px}",
    ".bz-types button b{display:block;font-size:13px}.bz-types button.on{outline:2px solid #c86bff;background:rgba(200,107,255,.22)!important}",
    ".bz-back{background:none!important;color:#ffcf7a!important;padding:0!important;font-size:13px!important;margin-bottom:6px}",
    ".bz-hist{font-size:11px;color:rgba(255,240,215,.62);margin:2px 0}"
  ].join("\n"));

  function P() { return FC.prop; }
  function money(n) { return FC.fmtMoney(n); }
  function toast(t, c, s) { if (FC.hud) FC.hud.toast(t, c || "", s || 2.4); }
  function esc(s) { return FC.hud && FC.hud.esc ? FC.hud.esc(s) : String(s == null ? "" : s); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function city() { return P() ? P().CITY : FC.city; }
  function creatureName(code) { var W = global.FC_SPECIES; return code && W && W.META[code] ? W.META[code][0] : ""; }
  function cellOf(code) { var c = FC.people && FC.people.cellOf ? FC.people.cellOf(code) : -1; return c >= 0 ? c : (FC.people ? FC.people.randomCell() : 0); }
  function bar(v, max, color) { return "<div class='bz-bar'><i style='width:" + Math.round(FC.clamp(v / Math.max(1, max), 0, 1) * 100) + "%;background:" + color + "'></i></div>"; }
  function moraleColor(m) { return m >= 60 ? "#2fbf71" : m >= 30 ? "#ffcf3f" : "#ff5d6c"; }
  function traitChips(tr) { return (tr || []).map(function (t) { var d = TRAITS[t] || [t, "", ""]; return "<span class='bz-tr " + d[2] + "' title='" + esc(d[1]) + "'>" + esc(d[0]) + "</span>"; }).join(""); }

  /* ---- сервер -------------------------------------------------------------------------------------------------- */
  function call(path, body) {
    var t = P() && P().token();
    if (!t) { if (P()) P().loginCard(); return Promise.reject(Object.assign(new Error("войди своим агентом"), { status: 401 })); }
    return P().post(path, Object.assign({ token: t, city: city() }, body || {}));
  }
  function keep(v) { if (v && v.key) Z.list[v.key] = Object.assign(v, { _t: Date.now() }); return v; }
  function refresh() {
    if (!(P() && P().token())) { Z.list = {}; return Promise.resolve([]); }
    return call("/g/biz/mine", {}).then(function (d) {
      var l = {};
      (d.biz || []).forEach(function (v) { v._t = Date.now(); l[v.key] = v; events(v, v.events); });
      Z.list = l; Z.at = Date.now();
      FC.emit("biz:list", l);
      return d.biz;
    }).catch(function () { return []; });
  }
  function list() { return Object.keys(Z.list).map(function (k) { return Z.list[k]; }); }
  function get(key) { return Z.list[key] || null; }
  function propOf(key) { return P() ? P().mine("com").filter(function (p) { return p.key === key; })[0] : null; }
  function err(e) { if (e && e.status !== 401) toast((e && e.message) || "Не получилось", "bad", 3); }

  /* ---- события сервера → уведомления и «Лента» ---------------------------------------------------------------- */
  function feed(text, who, cell, at, likes) {
    if (FC.story && FC.story.post) FC.story.post({ id: "bz" + Date.now() + Math.floor(Math.random() * 999), kind: "biz", cell: cell == null ? -1 : cell,
      who: who, text: text, likes: likes == null ? 5 + Math.floor(Math.random() * 40) : likes, at: at || null, t: Date.now() });
  }
  function atOf(key) { var p = propOf(key), d = p && P().door(p); return d ? { x: d.x, z: d.z } : null; }
  function events(v, ev) {
    (ev || []).forEach(function (e) {
      var tag = v.key + ":" + e.t + ":" + e.e + ":" + (e.n || "");
      if (Z.seen[tag]) return;
      Z.seen[tag] = 1;
      if (e.e === "quit") {
        if (FC.hud) FC.hud.notify(v.name, "🚪 " + e.n + " уволился сам — мораль была на нуле", "💼", 6);
        feed("Ухожу из «" + v.name + "»: сил больше нет, ставка смешная. Ищу работу 🙏", e.n + " · бывш. сотрудник", cellOf(e.cre), atOf(v.key));
      } else if (e.e === "auto_hire") {
        if (FC.hud) FC.hud.notify(v.name, "📋 Управляющий нанял: " + e.n, "💼", 5);
      } else if (e.e === "auto_supply") {
        if (FC.hud) FC.hud.notify(v.name, "📋 Управляющий докупил сырьё из кассы: " + money(e.cost), "💼", 4);
      }
    });
  }

  /* ---- здание с бизнесом выглядит бизнесом (у всех игроков) --------------------------------------------------- */
  function decorate(B, t) {
    if (!B || !t || !t.biz || !TYPES[t.biz]) return;
    var tag = (t.k || t.key) + ":" + t.biz + ":" + (t.name || "");
    if (B._own === tag) return;
    if (!B._orig) B._orig = { poi: B.poi, biz: B.biz, name: B.name, emoji: B.emoji, color: B.color, title: B.title };
    var T = TYPES[t.biz];
    B.poi = "biz"; B.biz = { id: T.kit, own: true, type: t.biz };
    B.name = t.name || T.name; B.emoji = T.emoji; B.color = T.color; B.title = B.name.replace(/[«»]/g, "").toUpperCase();
    B._own = tag;
    if (Z.deco.indexOf(B) < 0) Z.deco.push(B);
  }
  function undecorate(B) {
    if (!B || !B._orig) return;
    var o = B._orig;
    B.poi = o.poi; B.biz = o.biz; B.name = o.name; B.emoji = o.emoji; B.color = o.color; B.title = o.title;
    delete B._orig; delete B._own;
    var i = Z.deco.indexOf(B); if (i >= 0) Z.deco.splice(i, 1);
  }
  function decorateNear() {
    if (!P() || !FC.player) return;
    var pl = FC.player, taken = P().taken();
    // бизнес закрыли или здание продали (в том числе другой игрок) — здание снова обычное
    Z.deco.slice().forEach(function (B) {
      var t = taken[P().keyOf(B)] || P().takenOf(B), m = P().mineOf(B);
      if (!(t && t.biz) && !(m && m.biz)) undecorate(B);
    });
    P().takenList().forEach(function (t) {
      if (!t.biz || t.x == null || Math.abs(t.x - pl.x) > 700 || Math.abs(t.z - pl.z) > 700) return;
      decorate(P().resolve(t), t);
    });
    P().mine("com").forEach(function (p) { if (p.biz) decorate(P().resolve(p), { key: p.key, biz: p.biz.type, name: p.biz.name }); });
  }
  // свои наборы мебели (ffurn K.biz): автосалон, IT-студия, магазин, фитнес, типография, пекарня — из готовых наборов
  function wrapKits() {
    var F = FC.furn; if (!F || !F.K || !F.K.biz || F.K.biz._fbz) return;
    var K = F.K, orig = K.biz;
    var MY = { fbz_cars: "cars", fbz_it: "open", fbz_store: "store", fbz_gym: "gym", fbz_print: "open", fbz_cafe: "cafe" };
    K.biz = function (o, ctx, id) {
      var fn = MY[id] && K[MY[id]];
      if (!fn) return orig(o, ctx, id);
      fn(o, ctx);
      var x0 = o.x0 + 0.8, x1 = o.x1 - 0.8;
      if (ctx.sign) ctx.sign((x0 + x1) / 2, o.z0 + 0.95, 2.7, Math.min(4, x1 - x0), 0, ctx.B.title || ctx.B.name, ctx.B.emoji || "", ctx.B.color || "#ffcf7a");
    };
    K.biz._fbz = true;
  }

  /* ---- у двери и внутри ---------------------------------------------------------------------------------------- */
  function nearKey(key, r) {
    var p = propOf(key); if (!p || !FC.player) return false;
    var I = FC.inside, B = P().resolve(p);
    if (I && I.active && B && I.building === B) return true;
    var d = P().door(p); if (!d) return false;
    return Math.hypot(FC.player.x - d.x, FC.player.z - d.z) < (r || 60);
  }
  function doorLabel(p) {
    var v = Z.list[p.key], T = TYPES[p.biz && p.biz.type] || {};
    if (!v) return (T.emoji || "🏪") + " " + (p.biz ? p.biz.name : "Бизнес") + " — управление";
    return (T.emoji || "🏪") + " " + v.name + (v.till > 0 ? " — касса " + money(v.till) : " — управление");
  }
  function atDoor(p, B) {
    if (!p.biz) { open(p); return; }
    var v = Z.list[p.key];
    if (v && v.till >= 1) collect(p.key); else openManage(p.key);
  }
  function collect(key, remote) {
    var v = Z.list[key]; if (Z.busy) return Promise.resolve(0);
    if (!remote && !nearKey(key, 70)) {
      if (v && v.manager) {
        if (!global.confirm("Ты далеко от «" + v.name + "». Управляющий перешлёт кассу за 10%. Забрать?")) return Promise.resolve(0);
      } else { toast("Касса — у здания. Найми управляющего, чтобы забирать издалека", "", 3.5); routeTo(key); return Promise.resolve(0); }
    }
    Z.busy = true;
    return call("/g/biz/collect", { key: key }).then(function (d) {
      Z.busy = false; keep(d.biz); events(d.biz, d.events);
      if (!d.paid) { toast("Касса пока пуста — выручка копится по часам", "", 2.6); return 0; }
      FC.money(d.paid, "бизнес: выручка");
      if (FC.audio) FC.audio.play("cash");
      if (FC.fx && FC.player) FC.fx.burst(FC.player.x, 1.3, FC.player.z, "cash", 24);
      toast("💰 " + d.biz.name + ": +" + money(d.paid) + (d.fee ? " (−10% управляющему)" : "") + (d.bonus ? " · район твой: +10%" : "") + (d.pts ? " · влияние +" + Math.round(d.pts) : ""), "ok", 3.4);
      FC.emit("biz:collect", { key: key, paid: d.paid });
      return d.paid;
    }).catch(function (e) {
      Z.busy = false;
      if (e.status === 403) toast("Подойди к зданию — кассу забирают на месте", "bad", 3); else err(e);
      return 0;
    });
  }
  function routeTo(key) { var p = propOf(key); if (p && P().route(p, (TYPES[p.biz && p.biz.type] || {}).emoji)) toast("Маршрут к бизнесу проложен", "ok"); }

  function clearActs() { Z.acts.forEach(function (id) { FC.interact.remove(id); }); Z.acts = []; }
  FC.on("inside:floor", function (e) {
    clearActs();
    var B = e && e.building, p = B && P() && P().mineOf(B);
    if (!p || !p.biz || e.floor !== 0) return;
    setTimeout(function () {
      var S = FC.inside.debug && FC.inside.debug(), ex = S && S.plan && S.plan.exits && S.plan.exits[0];
      if (!ex) return;
      var a = FC.inside.toWorld(ex.x + 2.2, ex.z + 2.6), b = FC.inside.toWorld(ex.x - 2.2, ex.z + 2.6);
      FC.interact.add({ id: "bz_till", x: a.x, z: a.z, r: 2.0, room: B.id, key: "use", label: "",
        when: function () { var v = Z.list[p.key]; this.label = "💰 Касса «" + (v ? v.name : p.biz.name) + "»" + (v ? ": забрать " + money(v.till) : ""); return true; },
        act: function () { collect(p.key); } });
      FC.interact.add({ id: "bz_office", x: b.x, z: b.z, r: 2.0, room: B.id, key: "use", label: "💼 Кабинет: сотрудники, улучшения, сырьё",
        act: function () { openManage(p.key); } });
      Z.acts.push("bz_till", "bz_office");
      if (!Z.list[p.key] || Date.now() - Z.list[p.key]._t > 30000) refresh();
    }, 0);
  });
  FC.on("inside:exit", function () { clearActs(); Z.npcs = []; });

  /* ---- сотрудники на рабочих местах (FC.life.onPopulate: живые интерьеры flife.js) ---------------------------- */
  var LINES = {
    low: ["Когда прибавка?..", "Сил уже нет…", "Подумываю уйти.", "Без премии тяжко."],
    grump: ["Опять эти клиенты…", "Раньше было лучше.", "Кто опять трогал мою кружку?"],
    soul: ["Команда — огонь! 🔥", "Кто со мной на обед?", "Сегодня всех угощаю 🍩"],
    hard: ["Ещё заказ — и перерыв.", "Работаем! 💪", "Успеем к вечеру."],
    lazy: ["Пять минуточек…", "А можно завтра?", "Я на перерыве."],
    high: ["Клиентов полно! 🔥", "Лучшая работа в городе!", "Спасибо за премию!"],
    mid: ["Нормально, работаем.", "Сырья бы побольше.", "Клиенты идут."]
  };
  function lineOf(e) {
    var t = e.tr || [];
    if (e.m < 30) return pick(LINES.low);
    if (t.indexOf("grump") >= 0 && Math.random() < 0.6) return pick(LINES.grump);
    if (t.indexOf("soul") >= 0 && Math.random() < 0.6) return pick(LINES.soul);
    if (t.indexOf("hard") >= 0 && Math.random() < 0.5) return pick(LINES.hard);
    if (t.indexOf("lazy") >= 0 && Math.random() < 0.5) return pick(LINES.lazy);
    return pick(e.m > 75 ? LINES.high : LINES.mid);
  }
  function populate(B, f, api) {
    if (f !== 0 || !P()) return 0;
    var p = P().mineOf(B); if (!p || !p.biz) return 0;
    var v = Z.list[p.key]; if (!v) return 0;
    Z.npcs = [];
    var spots = api.pois(["desk", "stand", "sit"]), n = 0, base = api.spot();
    v.staff.forEach(function (e, i) {
      var s = spots[i] || api.near(base.x + (i % 3 - 1) * 1.6, base.z + Math.floor(i / 3) * 1.6, 6) || base;
      var ch = api.spawn("worker", s.x, s.z, { cell: cellOf(e.cre), line: [lineOf(e), lineOf(e)] });
      if (spots[i]) api.seat(ch, spots[i]);
      ch.staff = { key: p.key, id: e.id };
      Z.npcs.push(ch); n++;
      if (i === 0) setTimeout(function () { if (FC.people) FC.people.say(ch, e.n + ": «" + lineOf(e) + "»", 3.2); }, 900);
    });
    if (v.manager) {
      var ms = api.near(base.x + 2, base.z - 1, 6) || base;
      var mg = api.spawn("manager", ms.x, ms.z, { line: ["Я управляющий. Всё под контролем 📋", "Сырьё докуплю сам."] });
      mg.staff = { key: p.key, id: "mgr" }; Z.npcs.push(mg); n++;
    }
    return n;
  }
  function staffProvider(px, pz, room) {
    if (room == null || !Z.npcs.length) return null;
    var out = [];
    Z.npcs.forEach(function (ch) {
      if (!ch.staff || ch.staff.id === "mgr") return;
      var v = Z.list[ch.staff.key], e = v && v.staff.filter(function (x) { return x.id === ch.staff.id; })[0];
      if (!e) return;
      out.push({ id: "bzs" + e.id, x: ch.x, z: ch.z, r: 1.4, room: room, key: "use", label: "💬 " + e.n + " · мораль " + Math.round(e.m),
        act: function () {
          if (!FC.hud) return;
          FC.hud.dialog([{ who: e.n + " · " + (creatureName(e.cre) || "агент"), face: { cell: cellOf(e.cre) }, text: lineOf(e) + " (навык " + Math.round(e.sk) + ", ставка " + money(e.w) + "/ч)" }],
            function () { openManage(ch.staff.key); });
        } });
    });
    return out;
  }

  /* ---- действия владельца ------------------------------------------------------------------------------------- */
  // оплата: из кассы, если хватает (сервер проверит), иначе — наличными (списываем здесь)
  function payable(v, cost) { return v.till >= cost ? "till" : "cash"; }
  function act(path, body, opts) {
    opts = opts || {};
    if (opts.cash && FC.save.money < opts.cash) { toast("Не хватает " + money(opts.cash - FC.save.money), "bad"); return Promise.resolve(null); }
    return call(path, body).then(function (d) {
      if (d.paid === "cash" && d.cost) FC.money(-d.cost, opts.why || "бизнес");
      else if (opts.alwaysCash && d.cost) FC.money(-d.cost, opts.why || "бизнес");
      if (d.biz) keep(d.biz);
      return d;
    }).catch(function (e) { err(e); return null; });
  }
  function openBiz(p, type, word) {
    var T = TYPES[type]; if (!T) return Promise.resolve(null);
    if (FC.save.money < T.equip) { toast("Оборудование стоит " + money(T.equip), "bad"); return Promise.resolve(null); }
    return call("/g/biz/open", { key: p.key, type: type, word: word }).then(function (d) {
      FC.money(-d.cost, "бизнес: оборудование");
      keep(d.biz);
      p.biz = { type: type, level: 1, name: d.biz.name };
      decorate(P().resolve(p), { key: p.key, biz: type, name: d.biz.name });
      if (FC.audio) FC.audio.play("mission");
      if (FC.hud) FC.hud.big("БИЗНЕС ОТКРЫТ", T.emoji + " " + d.biz.name + " · найми людей и закупи сырьё", T.color, 3.4);
      feed("🎉 Открылся " + d.biz.name + " — " + P().addrOf(p) + ". Заходите, первым гостям — скидка!", "Новости района", FC.people && FC.people.SPECIAL ? FC.people.SPECIAL.guide : -1, atOf(p.key), 30 + Math.floor(Math.random() * 90));
      FC.emit("biz:open", { key: p.key, type: type });
      P().refresh();
      return d;
    }).catch(function (e) { err(e); return null; });
  }
  var REV = {
    low: ["Меня уволили из «%b». Зарплата смешная, премий нет. ⭐☆☆☆☆", "«%b»: уволили без предупреждения. Не советую. ⭐☆☆☆☆"],
    high: ["Выкладываюсь на все сто — и вот: уволили из «%b». ⭐⭐☆☆☆", "Работа в «%b» была делом жизни. Владелец решил иначе. ⭐⭐☆☆☆"],
    grump: ["Наконец-то свобода от «%b». Клиенты там так себе. ⭐☆☆☆☆"],
    soul: ["Буду скучать по команде «%b». А вот владелец… ⭐⭐☆☆☆"]
  };
  function fire(key, e) {
    var v = Z.list[key]; if (!v) return Promise.resolve(null);
    var soul = (e.tr || []).indexOf("soul") >= 0;
    if (!global.confirm("Уволить " + e.n + "? Выходное пособие — 2 часа ставки из кассы, остальные расстроятся (мораль −" + (soul ? 14 : 8) + ")" +
      (soul ? " — уходит душа компании" : "") + ", а бывший сотрудник напишет отзыв в «Ленту».")) return Promise.resolve(null);
    return call("/g/biz/fire", { key: key, emp: e.id }).then(function (d) {
      keep(d.biz);
      var r = d.review, t = r.tr || [];
      var set = t.indexOf("grump") >= 0 ? REV.grump : t.indexOf("soul") >= 0 ? REV.soul : r.m >= 55 ? REV.high : REV.low;
      feed(pick(set).replace("%b", r.biz), r.n + " · бывш. сотрудник", cellOf(r.cre), atOf(key), 10 + Math.floor(Math.random() * 60));
      toast("Уволен(а): " + e.n + (d.severance ? " · пособие " + money(d.severance) : "") + (d.hit > 0 ? " · команда расстроена" : " · команда выдохнула"), d.hit > 0 ? "bad" : "ok", 3.4);
      FC.emit("biz:fire", { key: key, emp: e });
      return d;
    }).catch(function (e2) { err(e2); return null; });
  }
  function upgrade(key) {
    var v = Z.list[key]; if (!v || !v.upgrade) return Promise.resolve(null);
    var how = payable(v, v.upgrade);
    return act("/g/biz/upgrade", { key: key, pay: how }, { cash: how === "cash" ? v.upgrade : 0, why: "бизнес: улучшение" }).then(function (d) {
      if (!d) return d;
      if (FC.audio) FC.audio.play("mission");
      toast("⬆ " + d.biz.name + ": уровень " + d.biz.level + (how === "till" ? " (из кассы)" : ""), "ok", 3);
      if (d.biz.level === MAX_LVL) feed("⭐ «" + d.biz.name + "» вырос до 5-го уровня — лучший в районе!", "Новости района", -1, atOf(key), 80 + Math.floor(Math.random() * 120));
      return d;
    });
  }
  function supply(key) {
    var v = Z.list[key]; if (!v || !v.supply) return Promise.resolve(null);
    var how = payable(v, v.supply);
    return act("/g/biz/supply", { key: key, pay: how }, { cash: how === "cash" ? v.supply : 0, why: "бизнес: сырьё" }).then(function (d) {
      if (d) toast("📦 Склад полон" + (how === "till" ? " (из кассы)" : ""), "ok"); return d;
    });
  }
  function hire(key, c) { return act("/g/biz/hire", { key: key, cand: c.id }).then(function (d) { if (d) { toast("🤝 " + c.n + " в команде", "ok"); FC.emit("biz:hire", { key: key }); } return d; }); }
  function bonus(key, e) {
    var v = Z.list[key], cost = 3 * e.w, how = v && payable(v, cost);
    return act("/g/biz/bonus", { key: key, emp: e.id, pay: how }, { cash: how === "cash" ? cost : 0, why: "бизнес: премия" }).then(function (d) { if (d) toast("🎁 " + e.n + " доволен(на): мораль +15", "ok"); return d; });
  }
  function raise(key, e) { return act("/g/biz/raise", { key: key, emp: e.id }).then(function (d) { if (d) toast("⬆ Ставка " + e.n + ": " + money(d.wage) + "/ч (снизить потом нельзя)", "ok", 3); return d; }); }
  function manager(key, on) {
    var v = Z.list[key]; if (!v) return Promise.resolve(null);
    return act("/g/biz/manager", { key: key, on: on }, { cash: on ? v.mgr_fee : 0, alwaysCash: true, why: "бизнес: управляющий" }).then(function (d) {
      if (d) toast(on ? "📋 Управляющий нанят: касса копит дольше, сырьё и вакансии — на нём" : "Управляющий уволен", on ? "ok" : "", 3.2); return d;
    });
  }

  /* ---- рейсы-миссии: доставка заказа и за сырьём ------------------------------------------------------------- */
  function places() {
    var out = [];
    if (M.zones) Object.keys(M.zones).forEach(function (k) { out.push(M.zones[k]); });
    (M.pois || []).forEach(function (B) { out.push(B); });
    return out.filter(function (B) { return B && B.doors && B.doors.length; });
  }
  function pickDest(x, z, lo, hi, filt) {
    var l = places().filter(function (B) { var d = Math.hypot(B.x - x, B.z - z); return d > lo && d < hi && (!filt || filt(B)); });
    if (!l.length) l = places().filter(function (B) { return Math.hypot(B.x - x, B.z - z) > 200; });
    return l.length ? l[Math.floor(Math.random() * l.length)] : null;
  }
  function startRun(key, kind) {
    var v = Z.list[key], p = propOf(key); if (!v || !p) return;
    if (Z.run) { toast("Сначала закончи текущий рейс", "bad"); return; }
    if (FC.jobs && FC.jobs.active && FC.jobs.active()) { toast("Закончи работу — потом рейс", "bad"); return; }
    if (!nearKey(key, 150)) { toast("Рейс начинается у здания бизнеса", "", 3); routeTo(key); return; }
    var home = P().door(p), dest = kind === "sell" ? pickDest(home.x, home.z, 450, 1500) :
      pickDest(home.x, home.z, 350, 1300, function (B) { return B.poi === "gas" || B.poi === "store" || B.poi === "paint" || B.poi === "cars"; });
    if (!dest) { toast("Некуда везти — попробуй позже", "bad"); return; }
    var dd = dest.doors[0], to = { x: dd.x + dd.nx * 5, z: dd.z + dd.nz * 5 }, dist = Math.hypot(to.x - home.x, to.z - home.z) * (kind === "supply" ? 2 : 1);
    call("/g/biz/run", { key: key, kind: kind, a: "start", dist: Math.round(dist) }).then(function (d) {
      keep(d.biz);
      Z.run = { key: key, kind: kind, t0: performance.now(), min: d.run.min, amount: d.run.amount, to: to, home: home, dest: dest, stage: "go", name: v.name };
      // фургон у дверей бизнеса
      if (FC.cars && FC.cars.spawn && FC.player.mode === "foot" && M.nearestLane) {
        var L = M.nearestLane(home.x + (home.x - (p.x || home.x)) * 2, home.z + (home.z - (p.z || home.z)) * 2) || M.nearestLane(home.x, home.z);
        if (L) {
          var car = FC.cars.spawn("van", L.x, L.z, Math.atan2(L.dx, L.dz), { owned: true, color: 0xffffff });
          Z.run.van = car;
          FC.markers.add({ id: "bzvan", x: L.x, z: L.z, color: "#9dffbf", icon: "🚐", ring: 0 });
        }
      }
      FC.markers.add({ id: "bzrun", x: to.x, z: to.z, color: "#ffcf7a", icon: kind === "sell" ? "📦" : "🏭", route: true, ring: 8 });
      FC.hud.objective(kind === "sell" ? "🚚 Доставка заказа «" + v.name + "» → " + esc(dest.name) + " · товар " + money(d.run.amount) + " (×1,35 по приезде)" :
        "🛻 За сырьём для «" + v.name + "» → " + esc(dest.name) + ", потом обратно");
      FC.hud.timer(12 * 60 - 15, kind === "sell" ? "Доставка" : "Сырьё", function () { endRun(false, "время вышло"); });
      if (FC.hud.closePhone) FC.hud.closePhone();
      toast(kind === "sell" ? "🚐 Фургон у входа — садись (F) и вези заказ" : "🚐 Фургон у входа — езжай за сырьём", "ok", 3.6);
    }).catch(err);
  }
  function endRun(ok, why) {
    var R = Z.run; if (!R) return;
    Z.run = null;
    FC.markers.remove("bzrun"); FC.markers.remove("bzvan");
    FC.hud.objective(""); FC.hud.timer(null);
    call("/g/biz/run", { key: R.key, kind: R.kind, a: ok ? "done" : "fail" }).then(function (d) {
      if (d.biz) keep(d.biz);
      if (d.ok && d.paid) {
        FC.money(d.paid, "бизнес: доставка");
        if (FC.audio) FC.audio.play("mission");
        FC.hud.big("ЗАКАЗ ДОСТАВЛЕН", "+" + money(d.paid) + " · " + R.name + (d.pts ? " · влияние +" + Math.round(d.pts) : ""), "#9dffbf", 3.2);
        FC.emit("biz:run", { kind: "sell", paid: d.paid });
      } else if (d.ok) {
        FC.hud.big("СЫРЬЁ НА СКЛАДЕ", R.name + " · склад " + Math.round(d.biz.stock) + "%", "#9dffbf", 3);
        FC.emit("biz:run", { kind: "supply" });
      } else toast("Рейс сорван" + (why ? ": " + why : d.why ? ": " + d.why : "") + (d.back ? " · товар вернулся в кассу (75%)" : ""), "bad", 3.6);
    }).catch(err);
  }
  function tickRun() {
    var R = Z.run, pl = FC.player; if (!R || !pl) return;
    var inCar = pl.mode === "car";
    if (R.stage === "go" && inCar && Math.hypot(pl.x - R.to.x, pl.z - R.to.z) < 16) {
      if (R.kind === "sell") R.stage = "wait";
      else {
        R.stage = "back";
        FC.markers.remove("bzrun");
        FC.markers.add({ id: "bzrun", x: R.home.x, z: R.home.z, color: "#9dffbf", icon: "🏪", route: true, ring: 8 });
        FC.hud.objective("📦 Сырьё загружено — вези в «" + R.name + "»");
        toast("📦 Сырьё в фургоне — обратно к бизнесу", "ok", 3);
      }
    }
    if (R.stage === "back" && inCar && Math.hypot(pl.x - R.home.x, pl.z - R.home.z) < 20) R.stage = "wait";
    if (R.stage === "wait") {
      // сервер не примет рейс быстрее расстояния на 35 м/с — подождём получателя, а не сорвём заказ
      var left = R.min + 1 - (performance.now() - R.t0) / 1000;
      if (left <= 0) endRun(true);
      else if (!R.waitShown) { R.waitShown = true; toast("⏳ Получатель выходит… " + Math.ceil(left) + " с", "", Math.min(6, left)); }
    }
  }
  FC.on("busted", function () { if (Z.run) endRun(false, "задержание"); });
  FC.on("wasted", function () { if (Z.run) endRun(false, "тебя вырубили"); });

  /* ---- приложение «Бизнес» ------------------------------------------------------------------------------------ */
  function sumOf() {
    var l = list(), till = 0, net = 0;
    l.forEach(function (v) { till += v.till; net += Math.max(0, v.net_h); });
    return { n: l.length, till: till, net: net };
  }
  function bizCard(v) {
    var T = TYPES[v.type] || {}, s = v.staff.length, m = s ? Math.round(v.staff.reduce(function (a, e) { return a + e.m; }, 0) / s) : 0;
    var near = nearKey(v.key, 70);
    return "<div class='card'><b>" + T.emoji + " " + esc(v.name) + "<span class='pr-badge biz'>ур. " + v.level + "</span><span class='pr-badge'>" + "⭐".repeat(v.stars) + "</span></b>" +
      "<p class='pr-meta'>Касса " + money(v.till) + " из " + money(v.cap) + "</p>" + bar(v.till, v.cap, "#ffcf7a") +
      "<p class='pr-meta'>Сырьё " + Math.round(v.stock) + "%" + (v.stock < 15 ? " — <b style='color:#ff8a8a'>кончается</b>" : "") + "</p>" + bar(v.stock, 100, v.stock < 15 ? "#ff5d6c" : "#7dffb0") +
      "<p class='pr-meta'>Штат " + s + "/" + v.slots + (s ? " · мораль " + m : " · нанять людей!") + " · ~" + money(Math.max(0, v.net_h)) + "/ч чистыми" + (v.manager ? " · 📋 управляющий" : "") + (v.run ? " · 🚚 в рейсе" : "") + "</p>" +
      "<div class='hm-row'><button type='button' data-bz-manage='" + esc(v.key) + "'>Управлять</button>" +
      (v.till > 0 && (near || v.manager) ? "<button type='button' data-bz-collect='" + esc(v.key) + "'>💰 " + (near ? "Забрать" : "Забрать (−10%)") + "</button>" : "") +
      (!near ? "<button type='button' class='ghost' data-bz-route='" + esc(v.key) + "'>Маршрут</button>" : "") + "</div></div>";
  }
  function renderList(b) {
    var l = list(), s = sumOf(), coms = P() ? P().mine("com") : [];
    var html = "<div class='pr-sum'><div><b>" + s.n + "/3</b>бизнесов</div><div><b>" + money(s.till) + "</b>в кассах</div><div><b>" + money(s.net) + "</b>в час</div></div>";
    if (!(P() && P().token())) html += "<div class='card'><b>Бизнес закрепляется за агентом</b><p>Войди своим агентом — сервер будет копить выручку, пока тебя нет.</p></div>";
    l.forEach(function (v) { html += bizCard(v); });
    coms.filter(function (p) { return !p.biz; }).forEach(function (p) {
      html += "<div class='card'><b>🏢 " + esc(P().kindName(P().resolve(p), "com")) + " · " + esc(P().addrOf(p)) + "</b><p class='pr-meta'>Своё здание без дела" + (p.area ? " · " + Math.round(p.area) + " м²" : "") + "</p>" +
        "<div class='hm-row'><button type='button' data-bz-open='" + esc(p.key) + "'>Открыть бизнес</button></div></div>";
    });
    if (!coms.length) html += "<div class='card'><b>Бизнес — в своём нежилом здании</b><p>Купи офис, магазин или цех в «Недвижимости» (вкладка «Под бизнес»), открой кафе, шиномонтаж, клуб или IT-студию, найми агентов — и выручка пойдёт даже без тебя.</p>" +
      "<div class='hm-row'><button type='button' data-bz-buy='1'>🏢 Выбрать здание</button></div></div>";
    // франшизы города (fjobs: прежние точки «Шаурма у Огонька», «Кофейня Пенка»… — местные, не закреплены за агентом)
    var fr = FC.jobs && FC.jobs.businesses ? FC.jobs.businesses() : [];
    if (fr.length) {
      html += "<h4>Франшизы города</h4><div class='jb-list'>";
      fr.forEach(function (B, i) {
        var o = FC.save.biz && FC.save.biz[B.biz.id];
        html += "<div class='jb-row'><div class='ji'>" + (B.emoji || "🏪") + "</div><div class='jt'><b>" + esc(B.name) + "</b><i>" + (o ? "сейф " + money(Math.floor(o.safe || 0)) : money(B.biz.income) + "/игровой час · " + money(B.biz.price)) + "</i></div>" +
          (o ? "<button type='button' class='jb-btn' data-fr-c='" + i + "'" + ((o.safe || 0) < 1 ? " disabled" : "") + ">Забрать</button>" : "<button type='button' class='jb-btn ghost' data-fr-m='" + i + "'>На карте</button>") + "</div>";
      });
      html += "</div><p class='jb-note'>Франшизу покупают у входа в точку (✋); её сейф копит до 8 игровых часов.</p>";
    }
    b.innerHTML = html;
    return fr;
  }
  function empCard(v, e) {
    var risk = e.risk > 0 ? " · <b style='color:#ff8a8a'>может уйти</b>" : "";
    return "<div class='card bz-emp'><span class='bz-av' style='" + (FC.hud && FC.hud.atlasStyle ? FC.hud.atlasStyle(cellOf(e.cre)) : "") + "'></span><div>" +
      "<b>" + esc(e.n) + " <span class='quiet'>· " + esc(creatureName(e.cre) || "агент") + "</span></b>" +
      "<p class='pr-meta'>навык " + Math.round(e.sk) + " · " + money(e.w) + "/ч (рынок " + money(e.market) + ") · стаж " + (e.d || 0).toFixed(1) + " дн.</p>" + traitChips(e.tr) +
      "<p class='bz-q'>«" + esc(lineOf(e)) + "»</p><p class='pr-meta'>мораль " + Math.round(e.m) + risk + "</p>" + bar(e.m, 100, moraleColor(e.m)) +
      "<div class='hm-row'><button type='button' data-bz-bonus='" + e.id + "'>🎁 Премия " + money(3 * e.w) + "</button><button type='button' class='ghost' data-bz-raise='" + e.id + "'>⬆ +10% ставки</button>" +
      "<button type='button' class='danger' data-bz-fire='" + e.id + "'>Уволить</button></div></div></div>";
  }
  function candCard(v, c, full) {
    return "<div class='card bz-emp'><span class='bz-av' style='" + (FC.hud && FC.hud.atlasStyle ? FC.hud.atlasStyle(cellOf(c.cre)) : "") + "'></span><div>" +
      "<b>" + esc(c.n) + " <span class='quiet'>· " + esc(creatureName(c.cre) || "агент") + "</span></b><p class='pr-meta'>навык " + c.sk + " · " + money(c.w) + "/ч · настрой " + c.m + "</p>" + traitChips(c.tr) +
      "<div class='hm-row'><button type='button' data-bz-hire='" + esc(c.id) + "'" + (full ? " disabled" : "") + ">🤝 Нанять</button></div></div></div>";
  }
  var EV = { open: "открыт", hire: "нанят(а) %n", fire: "уволен(а) %n", quit: "ушёл(ла) сам(а): %n", auto_hire: "управляющий нанял %n", upgrade: "улучшение до ур. %l",
    manager_on: "нанят управляющий", manager_off: "управляющий уволен", run_sell: "доставка: +%p", run_supply: "привезли сырьё" };
  function renderManage(b, key) {
    var v = Z.list[key], p = propOf(key);
    if (!v) { b.innerHTML = "<button type='button' class='bz-back' data-bz-back='1'>‹ Мои бизнесы</button><div class='card'><p>Загружаю…</p></div>"; return; }
    var T = TYPES[v.type], near = nearKey(key, 150), lv = v.level, nl = lv + 1;
    var html = "<button type='button' class='bz-back' data-bz-back='1'>‹ Мои бизнесы</button>" +
      "<div class='card'><b>" + T.emoji + " " + esc(v.name) + "<span class='pr-badge biz'>ур. " + lv + "</span><span class='pr-badge'>" + "⭐".repeat(v.stars) + "</span></b>" +
      "<p class='pr-meta'>" + esc(p ? P().addrOf(p) : "") + " · выручка " + money(v.earned) + " всего</p>" +
      "<div class='bz-grid'><div><b>" + money(v.till) + "</b>касса из " + money(v.cap) + "</div><div><b>" + Math.round(v.stock) + "%</b>сырьё (" + v.supply_h + " ч на склад)</div>" +
      "<div><b>" + money(v.rate) + "/ч</b>выручка сейчас (макс. " + money(v.full) + ")</div><div><b>" + money(v.net_h) + "/ч</b>чистыми (−налог 5%, −зарплаты " + money(v.wages_h) + ")</div></div>" +
      "<div class='hm-row'><button type='button' data-bz-collect='" + esc(key) + "'" + (v.till < 1 ? " disabled" : "") + ">💰 Забрать" + (near || !v.manager ? "" : " (−10%)") + "</button>" +
      "<button type='button' data-bz-supply='1'" + (v.supply <= 0 ? " disabled" : "") + ">📦 Сырьё " + money(v.supply) + (v.till >= v.supply ? " из кассы" : "") + "</button></div></div>";
    // рейсы
    var cs = v.cool.sell || 0, cu = v.cool.supply || 0;
    html += "<div class='card'><b>🚚 Рейсы</b><p class='pr-meta'>Доставка заказа: товар из кассы (до " + money(Math.min(v.till, v.full * 3)) + ") ×1,35 по приезде. За сырьём: +60% склада бесплатно. " + (near ? "" : "Начинаются у здания.") + "</p>" +
      (v.run ? "<p class='pr-meta'>Рейс в пути.</p><div class='hm-row'><button type='button' class='danger' data-bz-runfail='1'>Отменить рейс (товар вернётся 75%)</button></div>" :
        "<div class='hm-row'><button type='button' data-bz-run='sell'" + (v.till < 200 || cs || !near ? " disabled" : "") + ">🚚 Доставка" + (cs ? " · " + Math.ceil(cs / 60) + " мин" : "") + "</button>" +
        "<button type='button' class='ghost' data-bz-run='supply'" + (cu || !near || v.stock > 90 ? " disabled" : "") + ">🛻 За сырьём" + (cu ? " · " + Math.ceil(cu / 60) + " мин" : "") + "</button>" +
        (!near ? "<button type='button' class='ghost' data-bz-route='" + esc(key) + "'>Маршрут</button>" : "") + "</div>") + "</div>";
    // улучшение
    if (v.upgrade) html += "<div class='card'><b>⬆ Уровень " + nl + "</b><p class='pr-meta'>Выручка ×" + lvlK(nl).toFixed(1) + " (сейчас ×" + lvlK(lv).toFixed(1) + "), мест " + (1 + nl) + ", касса копит " +
      capH(nl, v.manager) + " ч, кандидаты сильнее.</p><div class='hm-row'><button type='button' data-bz-up='1'" + (v.till < v.upgrade && FC.save.money < v.upgrade ? " disabled" : "") + ">Улучшить · " + money(v.upgrade) +
      (v.till >= v.upgrade ? " из кассы" : "") + "</button></div></div>";
    else html += "<div class='card'><b>⭐ Максимальный уровень</b><p class='pr-meta'>Лучший бизнес района. Дальше — держать штат и район.</p></div>";
    // менеджер
    html += "<div class='card'><b>📋 Управляющий " + (v.manager ? "<span class='pr-badge ok'>работает</span>" : "") + "</b><p class='pr-meta'>" +
      (v.manager ? "Докупает сырьё из кассы, закрывает вакансии, касса копит " + capH(lv, true) + " ч, забрать можно издалека (−10%). Берёт 8% выручки."
        : "Без него касса копит " + capH(lv, false) + " ч и стоит, пока не заберёшь. Нанять — " + money(v.mgr_fee) + ", потом 8% выручки.") + "</p>" +
      "<div class='hm-row'><button type='button' " + (v.manager ? "class='ghost' data-bz-mgr='0'>Уволить управляющего" : "data-bz-mgr='1'" + (FC.save.money < v.mgr_fee ? " disabled" : "") + ">Нанять · " + money(v.mgr_fee)) + "</button></div></div>";
    // сотрудники
    html += "<h4>Сотрудники " + v.staff.length + "/" + v.slots + "</h4>";
    if (!v.staff.length) html += "<div class='card'><p>Пусто — без людей выручка всего 15%. Найми кого-нибудь ниже.</p></div>";
    v.staff.forEach(function (e) { html += empCard(v, e); });
    html += "<h4>Кандидаты · новые через " + Math.ceil(v.cand_next / 3600) + " ч</h4>";
    if (!v.cands.length) html += "<div class='card'><p>Всех из этого списка уже наняли — жди новых.</p></div>";
    v.cands.forEach(function (c) { html += candCard(v, c, v.staff.length >= v.slots); });
    html += "<p class='jb-note'>Сотрудники — ИИ-агенты: у каждого черты (до 5), навык, ставка и мораль. Мораль растёт от ставки выше рынка, премий, «души компании» и уровня бизнеса; " +
      "падает от ворчунов, простоя и увольнений. Ниже 30 — могут уйти. Ставку можно только поднять.</p>";
    if (v.hist && v.hist.length) {
      html += "<h4>Журнал</h4><div class='card'>" + v.hist.slice().reverse().map(function (h) {
        var tx = (EV[h.e] || h.e).replace("%n", h.n || "").replace("%l", h.lvl || "").replace("%p", money(h.paid || 0));
        return "<p class='bz-hist'>" + new Date(h.t * 1000).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) + " — " + esc(tx) + "</p>";
      }).join("") + "</div>";
    }
    b.innerHTML = html;
  }
  function renderOpen(b, key) {
    var p = propOf(key); if (!p) { Z.open = null; return renderList(b); }
    var area = p.area || 9999, sel = Z.pick || null;
    var html = "<button type='button' class='bz-back' data-bz-back='1'>‹ Мои бизнесы</button><div class='card'><b>🏢 Что открыть: " + esc(P().addrOf(p)) + "</b>" +
      "<p class='pr-meta'>Площадь " + (p.area ? Math.round(p.area) + " м²" : "—") + ". Выручка — в час на 1-м уровне при полном штате; сырьё — 30% от неё.</p></div><div class='bz-types'>";
    Object.keys(TYPES).forEach(function (t) {
      var T = TYPES[t], lv = FC.progress ? FC.progress.gate("biz", t) : 0, ok = area >= T.area && !lv;   // уровень — fprogress.js
      html += "<button type='button' data-bz-type='" + t + "' class='" + (sel === t ? "on" : "") + "'" + (ok ? "" : " disabled") + "><b>" + T.emoji + " " + T.name + "</b>до " + money(T.rate) + "/ч · " + money(T.equip) +
        (ok ? "<br>" + esc(T.about) : lv ? "<br>🔒 с " + lv + "-го уровня" : "<br>нужно от " + T.area + " м²") + "</button>";
    });
    html += "</div>";
    if (sel) {
      var T2 = TYPES[sel], name = T2.name + " «" + WORDS[Z.word % WORDS.length] + "»";
      html += "<div class='card'><b>" + T2.emoji + " " + esc(name) + "</b><div class='hm-row'><button type='button' class='ghost' data-bz-word='1'>🎲 Другое название</button>" +
        "<button type='button' data-bz-go='1'" + (FC.save.money < T2.equip ? " disabled" : "") + ">Открыть · " + money(T2.equip) + "</button></div>" +
        "<p class='pr-meta'>Первые 50% сырья — в подарок. Дальше: найми людей, закупи сырьё, забирай кассу.</p></div>";
    }
    b.innerHTML = html;
  }
  function render(b, ctl) {
    var fr = null;
    Z.body = b; Z.ctl = ctl;
    if (Z.open) renderOpen(b, Z.open);
    else if (Z.view) renderManage(b, Z.view);
    else fr = renderList(b);
    function on(sel, fn) { b.querySelectorAll(sel).forEach(function (x) { x.addEventListener("click", function () { fn(x); }); }); }
    function after(pr) { Promise.resolve(pr).then(function () { ctl.refresh(); }); }
    on("[data-bz-back]", function () { Z.view = null; Z.open = null; Z.pick = null; ctl.refresh(); });
    on("[data-bz-manage]", function (x) { Z.view = x.dataset.bzManage; ctl.refresh(); call("/g/biz/state", { key: Z.view }).then(function (d) { keep(d.biz); events(d.biz, d.events); ctl.refresh(); }).catch(err); });
    on("[data-bz-collect]", function (x) { after(collect(x.dataset.bzCollect)); });
    on("[data-bz-route]", function (x) { routeTo(x.dataset.bzRoute); ctl.close(); });
    on("[data-bz-open]", function (x) { Z.open = x.dataset.bzOpen; Z.pick = null; Z.word = Math.floor(Math.random() * WORDS.length); ctl.refresh(); });
    on("[data-bz-buy]", function () { ctl.close(); if (P()) P().open("buy", { filt: "com" }); });
    on("[data-bz-type]", function (x) { Z.pick = x.dataset.bzType; ctl.refresh(); });
    on("[data-bz-word]", function () { Z.word++; ctl.refresh(); });
    on("[data-bz-go]", function (x) {
      x.disabled = true; var p = propOf(Z.open);
      after(openBiz(p, Z.pick, Z.word % WORDS.length).then(function (d) { if (d) { Z.view = p.key; Z.open = null; Z.pick = null; } }));
    });
    var key = Z.view, v = key && Z.list[key];
    function emp(id) { return v && v.staff.filter(function (e) { return e.id === +id; })[0]; }
    on("[data-bz-supply]", function () { after(supply(key)); });
    on("[data-bz-up]", function () { after(upgrade(key)); });
    on("[data-bz-mgr]", function (x) { after(manager(key, x.dataset.bzMgr === "1")); });
    on("[data-bz-hire]", function (x) { var c = v.cands.filter(function (q) { return q.id === x.dataset.bzHire; })[0]; if (c) after(hire(key, c)); });
    on("[data-bz-fire]", function (x) { var e = emp(x.dataset.bzFire); if (e) after(fire(key, e)); });
    on("[data-bz-bonus]", function (x) { var e = emp(x.dataset.bzBonus); if (e) after(bonus(key, e)); });
    on("[data-bz-raise]", function (x) { var e = emp(x.dataset.bzRaise); if (e) after(raise(key, e)); });
    on("[data-bz-run]", function (x) { startRun(key, x.dataset.bzRun); });
    on("[data-bz-runfail]", function () { after(call("/g/biz/run", { key: key, kind: v.run.kind, a: "fail" }).then(function (d) { keep(d.biz); Z.run = null; FC.markers.remove("bzrun"); FC.hud.objective(""); FC.hud.timer(null); }).catch(err)); });
    on("[data-fr-c]", function (x) { if (fr && FC.jobs.collect) { FC.jobs.collect(fr[+x.dataset.frC]); ctl.refresh(); } });
    on("[data-fr-m]", function (x) {
      var B = fr && fr[+x.dataset.frM]; if (!B) return; var d = B.doors[0];
      FC.markers.add({ id: "wp", x: d.x + d.nx * 2, z: d.z + d.nz * 2, color: "#c86bff", icon: B.emoji || "🏪", route: true, ring: 0 }); ctl.close();
    });
  }
  function openApp() { if (FC.hud && FC.hud.openPhone) FC.hud.openPhone("biz"); }
  function openManage(key) { Z.view = key; Z.open = null; openApp(); refresh().then(function () { if (Z.view === key && Z.ctl && Z.body && Z.body.isConnected) Z.ctl.refresh(); }); }
  function open(p) { if (p.biz) { openManage(p.key); return; } Z.open = p.key; Z.view = null; Z.pick = null; Z.word = Math.floor(Math.random() * WORDS.length); openApp(); }

  /* ---- жизнь модуля ------------------------------------------------------------------------------------------- */
  FC.on("prop:mine", function () { refresh(); decorateNear(); });
  FC.on("prop:taken", decorateNear);
  FC.on("prop:sell", function (e) { if (e && e.prop) { delete Z.list[e.prop.key]; undecorate(e.B); } });
  FC.on("start", wrapKits);
  var decoT = 1, pollT = 45;
  FC.addSystem({
    name: "biz", order: 59,
    init: function () {
      wrapKits();
      if (FC.interact) FC.interact.provider(staffProvider);
      if (FC.life && FC.life.onPopulate) FC.life.onPopulate(populate);
      if (FC.hud) FC.hud.addApp({ id: "biz", icon: "🏪", name: "Бизнес", color: "#7c3aed", order: 11, render: render,
        badge: function () { var n = list().filter(function (v) { return v.till >= v.cap * 0.9 || v.stock < 10; }).length; return n ? String(n) : ""; } });
    },
    update: function (dt) {
      tickRun();
      decoT -= dt; pollT -= dt;
      if (decoT <= 0) { decoT = 2; decorateNear(); }
      // касса копится на сервере — подтягиваем, пока у игрока есть бизнесы (раз в 45 с; в приложении — при открытии)
      if (pollT <= 0) { pollT = 45; if (Object.keys(Z.list).length) refresh(); }
    }
  });

  FC.biz = { TYPES: TYPES, TRAITS: TRAITS, WORDS: WORDS, list: list, get: get, refresh: refresh, open: open, manage: openManage, atDoor: atDoor,
    doorLabel: doorLabel, collect: collect, decorate: decorate, run: function () { return Z.run; }, _state: Z };
})(window);
