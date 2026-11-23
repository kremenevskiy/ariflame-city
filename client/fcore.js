/* Флейм-Сити — ядро: пространство FC, сид-рандом, шина событий, системы, сохранение, деньги, часы.
 *
 * Игровой режим мира агентов (docs/ARCHITECTURE.md). Модули — IIFE на window.FC,
 * порядок — в index.html. Модули говорят друг с другом через FC.on/emit и через объекты-API (FC.map, FC.cars, …),
 * а не через общие переменные: так каждый можно править отдельно.
 */
(function (global) {
  "use strict";
  var FC = global.FC || (global.FC = {});

  /* ---- сид-рандом: город и интерьеры одинаковы у всех и при каждом заходе ---------------------------- */
  function rng(seed) {
    var s = (seed >>> 0) || 1;
    function r() {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    r.range = function (a, b) { return a + r() * (b - a); };
    r.int = function (a, b) { return a + Math.floor(r() * (b - a + 1)); };
    r.pick = function (list) { return list[Math.floor(r() * list.length)]; };
    r.chance = function (p) { return r() < p; };
    return r;
  }
  function hash(str, k) {
    var h = 2166136261 ^ (k || 0);
    str = String(str);
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /* ---- математика ---------------------------------------------------------------------------------- */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function damp(a, b, k, dt) { return lerp(a, b, 1 - Math.exp(-k * dt)); }
  function angWrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function angDamp(a, b, k, dt) { return a + angWrap(b - a) * (1 - Math.exp(-k * dt)); }
  function dist2(ax, az, bx, bz) { var dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }
  function money(n) { return "$" + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " "); }

  /* ---- шина событий --------------------------------------------------------------------------------- */
  var subs = {};
  function on(ev, fn) { (subs[ev] || (subs[ev] = [])).push(fn); return function () { off(ev, fn); }; }
  function off(ev, fn) { var l = subs[ev]; if (l) { var i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } }
  function emit(ev, data) {
    var l = subs[ev]; if (!l) return;
    l.slice().forEach(function (fn) {
      try { fn(data); } catch (e) { if (global.console) console.error("FC event " + ev, e); }
    });
  }

  /* ---- системы: каждый модуль добавляет init/update, цикл в fmain зовёт по order -------------------- */
  var systems = [];
  function addSystem(s) {
    s.order = s.order == null ? 50 : s.order;
    systems.push(s);
    systems.sort(function (a, b) { return a.order - b.order; });
  }

  /* ---- сохранение: localStorage по rid (гость — свой ключ) ----------------------------------------- */
  var SAVE_VER = 1;
  var saveKey = "fc.save.guest";
  function fresh() {
    return { v: SAVE_VER, money: 500, bank: 0, story: { done: [], step: 0 }, biz: {}, garage: [], carColor: null,
      stats: { jobs: 0, earned: 0, busted: 0, wasted: 0, crimes: 0, km: 0, playMin: 0 }, flags: {}, pos: null,
      hp: 100, hour: 15, tutorial: true };
  }
  var save = fresh();
  /* Город (index.html: FC_CITY): деньги, гараж, сюжет — общие; место, дома, мебель и районы банд — у каждого города свои.
     Файл сохранения один: поля Флейм-Сити — сверху, Минска — в cities.minsk. */
  var CITY = global.FC_CITY === "minsk" ? "minsk" : "flame", PER_CITY = ["pos", "homes", "homePrimary", "furniture", "gang"], other = {};
  function load(key) {
    if (key) saveKey = "fc.save." + key;
    var raw = null;
    try { raw = global.localStorage.getItem(saveKey); } catch (e) { raw = null; }
    var data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch (e) { data = null; }
    if (data && CITY !== "flame") {
      var mine = (data.cities && data.cities[CITY]) || {};
      other = {};
      PER_CITY.forEach(function (k) { other[k] = data[k]; data[k] = mine[k]; if (data[k] === undefined) delete data[k]; });
    }
    save = Object.assign(fresh(), data && data.v === SAVE_VER ? data : {});
    FC.save = save;
    emit("save:load", save);
    return save;
  }
  var dirtyAt = 0;
  function saveNow() {
    var out = save;
    if (CITY !== "flame") {
      out = Object.assign({}, save); out.cities = Object.assign({}, save.cities || {}); out.cities[CITY] = {};
      PER_CITY.forEach(function (k) { out.cities[CITY][k] = save[k]; out[k] = other[k]; if (out[k] === undefined) delete out[k]; });
    }
    try { global.localStorage.setItem(saveKey, JSON.stringify(out)); } catch (e) { /* приватное окно — без сохранения */ }
    dirtyAt = 0;
  }
  function dirty() { if (!dirtyAt) dirtyAt = Date.now(); }
  function resetSave() { save = fresh(); FC.save = save; saveNow(); emit("save:load", save); }

  /* Деньги — одна дверь: всё, что меняет кошелёк, идёт сюда (HUD, статистика и звук слушают событие). */
  function addMoney(delta, why) {
    delta = Math.round(delta);
    if (!delta) return save.money;
    if (delta < 0 && save.money + delta < 0) return false;
    save.money += delta;
    if (delta > 0) save.stats.earned += delta;
    dirty();
    emit("money", { delta: delta, why: why || "", total: save.money });
    return save.money;
  }

  /* ---- игровые часы: сутки = 24 реальные минуты ----------------------------------------------------- */
  var clock = { t: 10 * 3600, hour: 10, minute: 0, day: 1, night: 0, speed: 60, paused: false };
  function tickClock(dt) {
    if (clock.paused) return;
    var prevHour = clock.hour;
    var prevT = clock.t;
    clock.t += dt * clock.speed * (clock.night > 0.5 ? 4 : 1);       // ночь (если её включили) пролетает вчетверо быстрее
    if (clock.t >= 86400) { clock.t -= 86400; clock.day++; emit("day", clock.day); }
    // в игре всегда день (23.11.2026, «сделай день»): дойдя до 18:30, часы сами переходят на утро следующего дня;
    // ночь — только когда её ставят нарочно (задание «Монтаж до рассвета», фоторежим, чит «НОЧЬ»)
    if (prevT < 18.5 * 3600 && clock.t >= 18.5 * 3600) { clock.t = 9 * 3600; clock.day++; emit("day", clock.day); }
    clock.hour = Math.floor(clock.t / 3600);
    clock.minute = Math.floor((clock.t % 3600) / 60);
    // ночь — плавно: 0 днём, 1 глубокой ночью, сумерки по часу с каждой стороны
    var h = clock.t / 3600;
    var n = h < 5 ? 1 : h < 7 ? 1 - (h - 5) / 2 : h < 19 ? 0 : h < 21 ? (h - 19) / 2 : 1;
    clock.night = n;
    if (clock.hour !== prevHour) { save.hour = clock.hour; emit("hour", clock.hour); }
  }
  function setHour(h) { clock.t = (h % 24) * 3600; tickClock(0); }

  addSystem({
    name: "core", order: 0,
    update: function (dt) {
      tickClock(dt);
      save.stats.playMin += dt / 60;
      if (dirtyAt && Date.now() - dirtyAt > 4000) saveNow();
    }
  });
  global.addEventListener("pagehide", saveNow);
  document.addEventListener("visibilitychange", function () { if (document.hidden) saveNow(); });

  /* Стили модуля — своим тегом <style> (index.html общий, модули его не правят). */
  function css(text) { var st = document.createElement("style"); st.textContent = text; document.head.appendChild(st); return st; }

  FC.rng = rng; FC.hash = hash; FC.css = css;
  FC.clamp = clamp; FC.lerp = lerp; FC.damp = damp; FC.angWrap = angWrap; FC.angDamp = angDamp; FC.dist2 = dist2;
  FC.fmtMoney = money;
  FC.on = on; FC.off = off; FC.emit = emit;
  FC.addSystem = addSystem; FC.systems = systems;
  // имя города в текстах: «добро пожаловать в Минск» / «во Флейм-Сити», «патруль Минска»
  FC.cityName = CITY === "minsk" ? "Минск" : "Флейм-Сити";
  FC.cityTo = CITY === "minsk" ? "в Минск" : "во Флейм-Сити";
  FC.cityIn = CITY === "minsk" ? "в Минске" : "во Флейм-Сити";
  FC.cityOf = CITY === "minsk" ? "Минска" : "Флейм-Сити";
  FC.city = CITY; FC.save = save; FC.loadSave = load; FC.saveNow = saveNow; FC.dirty = dirty; FC.resetSave = resetSave;
  FC.money = addMoney;
  FC.clock = clock; FC.setHour = setHour;
  FC.mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && !global.matchMedia("(pointer:fine)").matches);

  /* ---- настройки развёртывания (config.js → window.FC_CONFIG) и адрес игрового сервера ------------------------- */
  var C = global.FC_CONFIG || {};
  FC.cfg = {
    server: typeof C.server === "string" ? C.server.replace(/\/$/, "") : "",
    auth: C.auth && C.auth.provider ? C.auth : { provider: "guest" },
    site: C.site || (location.origin + location.pathname),
    telegramBot: (C.telegramBot || "").replace(/^@/, ""),
    music: C.music && typeof C.music === "object" ? C.music : {},          // треки радио по станциям (faudio.js)
    musicBase: C.musicBase || "music/",
    places: Array.isArray(C.places) ? C.places : C.places ? [C.places] : []   // пакеты мест развёртывания (fplaces.js)
  };
  // рассказчик — Макс, местный (23.11: мультяшный огонёк-гид убран — «не похоже на игру»): портрет в диалогах и сообщениях;
  // огонёк остаётся только логотипом бренда — вывески, билборды, водяной знак снимков
  FC.MASCOT = { name: "Макс", img: "brand/max.webp", variant: "m20" };
  FC.BRAND = { logo: "brand/mascot.png" };
  // Игровой сервер (server/): ?gs=http://host:port — HTTP для разработки; ?mp=ws://host:port/g/ws | off — сокет;
  // иначе FC_CONFIG.server ("" — тот же адрес, что у страницы; "off" — одиночная игра).
  function qp(k) { var m = location.search.match(new RegExp("[?&]" + k + "=([^&]+)")); return m ? decodeURIComponent(m[1]) : null; }
  var MPQ = qp("mp"), GSQ = qp("gs");
  function gsOff() { return MPQ === "off" || (!MPQ && !GSQ && FC.cfg.server === "off"); }
  function gs() {
    if (GSQ) return GSQ.replace(/\/$/, "");
    if (MPQ && MPQ !== "off") return MPQ.replace(/^ws/, "http").replace(/\/g\/ws$/, "");
    if (FC.cfg.server && FC.cfg.server !== "off") return FC.cfg.server;
    return location.origin;
  }
  function gsWs() {
    if (MPQ && MPQ !== "off") return MPQ;
    return gs().replace(/^http/, "ws") + "/g/ws";
  }
  // запрос к игровому серверу: при выключенном онлайне — сразу отказ, без запроса
  function gfetch(path, opt) { return gsOff() ? Promise.reject(new Error("off")) : global.fetch(gs() + path, opt); }
  FC.gs = gs; FC.gsWs = gsWs; FC.gsOff = gsOff; FC.gfetch = gfetch;
})(window);
