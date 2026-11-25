/* Флейм-Сити — «город обновился» (FC.update). С 25.11.2026 правки после слияния в main уезжают на сайт сами (выпуск
 * «live» → tools/deploy/pull-live.sh на сервере, раз в минуту). У того, кто уже играет, в браузере старый код: раз в
 * 2 минуты сверяем version.txt сайта с тем, с которым загрузились (только на сайте, не локально). Поменялся —
 * карточка «Город обновился» с кнопкой (сохраняемся и перезагружаемся). Вкладку свернули дольше чем на 2 минуты при готовом обновлении — при возвращении
 * перезагружаемся сами: человек всё равно отходил, а вернётся уже в новый город. Без version.txt (локально) — молчим.
 */
(function (global) {
  "use strict";
  var FC = global.FC;
  // только на выложенном сайте (боевые настройки задают его адрес): локально и в CI version.txt нет — запрос дал бы 404
  if (!(global.FC_CONFIG && global.FC_CONFIG.site)) return;
  var EVERY = 120000, AWAY = 120000;
  var mine = null, fresh = null, shown = false, hiddenAt = 0;

  function get() {
    return global.fetch("version.txt", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (t) { t = (t || "").trim(); return /^[0-9a-f]{7,40}$/.test(t) ? t : null; })
      .catch(function () { return null; });
  }
  function reload() {
    try { if (FC.saveNow) FC.saveNow(); } catch (e) { /* сохранение не важнее обновления */ }
    global.location.reload();
  }
  function offer() {
    if (shown || !FC.hud || !FC.hud.offer) return;
    shown = true;
    FC.hud.offer("✨", "Город обновился", "Игроки добавили новое — обнови, чтобы увидеть.", "Обновить", reload, 60);
    setTimeout(function () { shown = false; }, 15 * 60000);   // отказался — напомним через 15 минут
  }
  function check() {
    if (document.hidden) return;
    get().then(function (v) {
      if (!v) return;
      if (!mine) { mine = v; return; }
      if (v !== mine) { fresh = v; if (FC.started) offer(); }
    });
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (fresh && hiddenAt && Date.now() - hiddenAt > AWAY) reload();
    else check();
  });
  get().then(function (v) { mine = v; });
  setInterval(check, EVERY);
  FC.update = { check: check, get version() { return mine; } };
})(window);
