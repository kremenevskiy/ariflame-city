/* Флейм-Сити — «новая правка в городе» (FC.update). С 25.11.2026 правки после слияния в main уезжают на сайт сами
 * (выпуск «live» → tools/deploy/pull-live.sh на сервере, раз в минуту). Слово владельца: «плашка — новая правка, город
 * перезагрузится через 10, 9, 8…, а после перезагрузки — что поменялось».
 *
 *   Как узнаём: pull-live.sh после выкладки зовёт /g/admin/announce — сервер шлёт всем в онлайне {t:"upd", v, in, server};
 *   без онлайна — сверка version.txt раз в 2 минуты.
 *   Плашка: что добавилось (заголовок и автор из changes.json — его собирает сборка, tools/status/build-changes.cjs),
 *   «перезагрузка через N» с полосой, кнопки «Сейчас» и «Позже» (через 5 минут спросим снова). На нуле — сохраняемся и
 *   перезагружаемся; вкладка свёрнута — перезагрузимся, когда вернётся.
 *   После перезагрузки: «Что нового» — до 3 правок, которых этот игрок ещё не видел (localStorage fc.seenVer), со ссылкой
 *   на ленту правок (contribute.html#new). Первый заход — без карточки.
 * Только на выложенном сайте (FC_CONFIG.site): локально и в CI version.txt и changes.json нет.
 */
(function (global) {
  "use strict";
  var FC = global.FC;
  if (!(global.FC_CONFIG && global.FC_CONFIG.site)) return;
  var EVERY = 120000, AWAY = 120000, LATER = 5 * 60000, KEY = "fc.seenVer";
  var mine = null, fresh = null, hiddenAt = 0, card = null, tick = 0, later = 0, changes = null;

  var CSS = [
    ".fu{position:fixed;left:50%;top:calc(12px + env(safe-area-inset-top));transform:translateX(-50%);width:min(420px,94vw);z-index:12;",
    "background:rgba(14,18,36,.96);border:1px solid rgba(255,207,122,.45);border-radius:16px;padding:12px 14px 10px;color:#fff3df;",
    "font:13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 14px 40px rgba(0,0,0,.45);pointer-events:auto;animation:fu-in .25s}",
    "@keyframes fu-in{from{opacity:0;transform:translate(-50%,-12px)}}",
    ".fu b{display:block;color:#ffcf7a;font-size:14px}.fu .fu-t{margin:2px 0 0;color:#fff3df}.fu .fu-w{color:rgba(255,243,223,.65);font-size:12px}",
    ".fu .fu-n{font:700 22px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:#fff;min-width:28px;text-align:right}",
    ".fu .fu-top{display:flex;gap:10px;align-items:flex-start}.fu .fu-top>div{flex:1;min-width:0}.fu .fu-top>.fu-n{flex:none}",
    ".fu .fu-bar{height:4px;border-radius:2px;background:rgba(255,255,255,.12);margin:9px 0 8px;overflow:hidden}",
    ".fu .fu-bar i{display:block;height:100%;background:linear-gradient(90deg,#ffb347,#ff7a2f);transition:width 1s linear}",
    ".fu .fu-row{display:flex;gap:8px}.fu button{flex:1;min-height:38px;border:0;border-radius:10px;font:700 13px system-ui;cursor:pointer;",
    "background:linear-gradient(180deg,#ffb347,#ff7a2f);color:#2a1205}.fu button.no{background:rgba(255,255,255,.1);color:#fff3df}",
    ".fu ul{margin:6px 0 8px;padding:0;list-style:none}.fu li{padding:6px 0;border-top:1px solid rgba(255,243,223,.1)}",
    ".fu li:first-child{border-top:0}.fu li span{display:block;color:rgba(255,243,223,.65);font-size:12px}",
    ".fu a{color:#ffcf7a}",
  ].join("");
  function css() { if (!document.getElementById("fu-css")) { var s = document.createElement("style"); s.id = "fu-css"; s.textContent = CSS; document.head.appendChild(s); } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
  function same(a, b) { return !!a && !!b && (a.indexOf(b) === 0 || b.indexOf(a) === 0); }   // короткий и длинный sha
  function ago(iso) {
    var s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    return s < 90 ? "только что" : s < 3600 ? Math.round(s / 60) + " мин назад" : s < 86400 ? Math.round(s / 3600) + " ч назад" : Math.round(s / 86400) + " дн назад";
  }
  function store(k, v) { try { if (v === undefined) return global.localStorage.getItem(k); global.localStorage.setItem(k, v); } catch (e) { /* приватный режим */ } return null; }

  function get() {
    return global.fetch("version.txt", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (t) { t = (t || "").trim(); return /^[0-9a-f]{7,40}$/.test(t) ? t : null; })
      .catch(function () { return null; });
  }
  function loadChanges() {
    return global.fetch("changes.json", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.items) changes = j; return changes; }).catch(function () { return changes; });
  }
  // правки новее версии `since` (до неё в журнале), без служебных
  function newer(list, since, n) {
    var out = [];
    for (var i = 0; i < list.length && out.length < n; i++) {
      if (since && same(list[i].sha, since)) break;
      if (!list[i].tech) out.push(list[i]);
    }
    return out;
  }
  function reload() {
    try { if (FC.saveNow) FC.saveNow(); } catch (e) { /* сохранение не важнее обновления */ }
    global.location.reload();
  }
  function kill() { if (card) { card.remove(); card = null; } clearInterval(tick); tick = 0; }

  /* ---- плашка с отсчётом ------------------------------------------------------------------------------------- */
  function countdown(sec, server) {
    if (card || Date.now() < later || !FC.started) return;
    css();
    sec = Math.max(3, Math.min(sec || 10, 60));
    var left = sec;
    card = document.createElement("div"); card.className = "fu"; card.setAttribute("role", "status");
    card.innerHTML = "<div class='fu-top'><div><b>🔧 Новая правка в городе</b><div class='fu-t'>Загружаю, что добавилось…</div>" +
      (server ? "<div class='fu-w'>Сервер тоже перезапустится — игру сохраним.</div>" : "") + "</div><div class='fu-n'>" + left + "</div></div>" +
      "<div class='fu-bar'><i style='width:100%'></i></div><div class='fu-row'><button type='button' class='go'>Обновить сейчас</button>" +
      "<button type='button' class='no'>Позже</button></div>";
    document.body.appendChild(card);
    var el = card;
    el.querySelector(".go").addEventListener("click", reload);
    el.querySelector(".no").addEventListener("click", function () { kill(); later = Date.now() + LATER; setTimeout(check, LATER + 1000); });
    loadChanges().then(function (j) {
      if (card !== el) return;
      var it = j ? newer(j.items, mine, 3) : [];
      el.querySelector(".fu-t").innerHTML = it.length ? "«" + esc(it[0].title) + "»<div class='fu-w'>" + esc(it[0].who) + (it[0].site ? " (с сайта)" : "") +
        (it.length > 1 ? " · и ещё " + (it.length - 1) : "") + "</div>" : "Город обновился — перезагрузим, чтобы увидеть новое.";
    });
    if (FC.audio) FC.audio.play("note");
    requestAnimationFrame(function () { var b = el.querySelector(".fu-bar i"); b.style.transition = "width " + sec + "s linear"; b.style.width = "0%"; });
    tick = setInterval(function () {
      left--;
      if (card !== el) return;
      el.querySelector(".fu-n").textContent = Math.max(0, left);
      if (left <= 0) {
        clearInterval(tick); tick = 0;
        if (document.hidden) { el.querySelector(".fu-t").textContent = "Обновим, когда вернёшься."; return; }
        reload();
      }
    }, 1000);
  }
  function check() {
    if (document.hidden) return;
    get().then(function (v) {
      if (!v) return;
      if (!mine) { mine = v; return; }
      if (v !== mine) { fresh = v; countdown(10, false); }
    });
  }
  // сервер сообщил о новой версии (fmp.js → FC.emit("mp:upd")) — всем сразу, без ожидания сверки
  FC.on("mp:upd", function (m) {
    if (!m || !m.v || same(m.v, mine || "")) return;
    fresh = m.v; countdown(m.in, m.server);
  });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (fresh && hiddenAt && (Date.now() - hiddenAt > AWAY || (card && !tick))) reload();
    else check();
  });

  /* ---- «Что нового» после перезагрузки --------------------------------------------------------------------- */
  function whatsNew() {
    var seen = store(KEY);
    if (!mine) return;
    store(KEY, mine);
    if (!seen || same(seen, mine)) return;               // первый заход или та же версия — молчим
    loadChanges().then(function (j) {
      var it = j ? newer(j.items, seen, 3) : [];
      if (!it.length || card) return;
      css();
      var el = document.createElement("div"); el.className = "fu"; card = el;
      el.innerHTML = "<b>✨ Что нового в городе</b><ul>" + it.map(function (c) {
        return "<li>" + esc(c.title) + "<span>" + esc(c.who) + (c.site ? " (с сайта)" : "") + " · " + ago(c.at) + "</span></li>";
      }).join("") + "</ul><div class='fu-row'><button type='button' class='no'>Играть</button>" +
        "<button type='button' class='go'>Все изменения</button></div>";
      document.body.appendChild(el);
      el.querySelector(".no").addEventListener("click", kill);
      el.querySelector(".go").addEventListener("click", function () { global.open("contribute.html#new", "_blank", "noopener"); kill(); });
      setTimeout(function () { if (card === el) kill(); }, 16000);
    });
  }
  get().then(function (v) {
    mine = v;
    if (FC.started) setTimeout(whatsNew, 6000); else FC.on("start", function () { setTimeout(whatsNew, 6000); });
  });
  setInterval(check, EVERY);
  FC.update = { check: check, countdown: countdown, get version() { return mine; } };
})(window);
