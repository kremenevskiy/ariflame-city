/* Флейм-Сити — вход: кто играет (гость или вошедший через внешний аккаунт), сохранение по rid.
 *
 * Провайдер входа — FC_CONFIG.auth (config.js, подробно — docs/AUTH.md):
 *   guest    — по умолчанию: гость «g-…» (случайный id в localStorage устройства). Прогресс — только на устройстве,
 *              онлайн виден как «Гость».
 *   external — свой аккаунт у внешнего сервиса. Клиент получает его токен (в Telegram — обменом подписи initData,
 *              на сайте — запросом с куками), берёт профиль и rid, а игровой сервер проверяет тот же токен сам —
 *              вебхуком FC_WORLD (server/README.md «Личность»). Ничего не ответил за 6 с — гость.
 * Локально: ?devtok=tok-<8 hex> на localhost — игровой сервер с FC_WORLD=fake (server/README.md «Локально»).
 *
 * Имя вошедшего видит только он сам; другим игрокам — ник, который игрок выбрал сам (fnick.js), иначе ник из «Рейтинга»
 * или «Гость» (имя аккаунта наружу не уходит намеренно).
 * FC.net: {me, token, login(), loginHint(), canLogin(), openLogin(), citizens, zones}
 *   citizens/zones — лента «живых жителей» внешнего мира; в этой сборке не подключена (пустые списки).
 */
(function (global) {
  "use strict";
  var FC = global.FC;
  var A = (FC.cfg && FC.cfg.auth) || { provider: "guest" };
  var EXT = A.provider === "external";
  var TG = global.Telegram && global.Telegram.WebApp;
  var N = { me: null, citizens: [], zones: {}, token: null };
  var LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  function abs(base, path) { return /^https?:\/\//.test(path) ? path : String(base || "").replace(/\/$/, "") + path; }
  function postJSON(url, body) {
    return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }

  function guestId() {
    var id = null;
    try { id = global.localStorage.getItem("fc.guest"); } catch (e) { id = null; }
    if (!id) {
      id = "g-" + Math.random().toString(36).slice(2, 10);
      try { global.localStorage.setItem("fc.guest", id); } catch (e) { /* без хранилища — гость на один заход */ }
    }
    return id;
  }

  // Telegram: развернуть мини-аппу и не закрывать свайпом (у гостя тоже)
  function tgReady() {
    if (!TG) return;
    try { TG.ready(); TG.expand(); if (TG.disableVerticalSwipes) TG.disableVerticalSwipes(); } catch (e) { /* старый клиент */ }
  }

  /* ---- внешний аккаунт: токен ---------------------------------------------------------------------------------- */
  function extToken() {
    if (TG && TG.initData && A.tgSession) {
      return postJSON(abs(A.api, A.tgSession), { initData: TG.initData }).then(function (j) { return j && j.token; });
    }
    if (A.siteToken) {
      return fetch(abs(A.site, A.siteToken), { credentials: "include", cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { return j && j.token; });
    }
    return Promise.resolve(null);
  }
  function token() {
    var dev = (location.search.match(/[?&]devtok=(tok-[0-9a-f]{8})/) || [])[1];
    if (dev && LOCAL) return Promise.resolve(dev);
    return EXT ? extToken() : Promise.resolve(null);
  }

  function finish(me) {
    N.me = me; FC.me = me;
    me.label = me.name ? me.name : me.guest ? "Гость" : "Игрок";
    FC.loadSave(me.rid);
    FC.emit("me", me);
  }

  function login() {
    tgReady();
    var timeout = new Promise(function (res) { setTimeout(function () { res(null); }, 6000); });
    Promise.race([token().catch(function () { return null; }), timeout]).then(function (tok) {
      if (!tok) return guest();
      N.token = tok;
      if (/^tok-/.test(tok) && LOCAL) return finish({ rid: tok.slice(4), name: "", house: null, guest: false, level: 1 });
      return Promise.all([
        A.profile ? postJSON(abs(A.api, A.profile), { token: tok }).catch(function () { return null; }) : null,
        A.me ? postJSON(abs(A.api, A.me), { token: tok }).catch(function () { return null; }) : null
      ]).then(function (r) {
        var lv = r[0] || {}, wm = r[1] || {};
        if (!wm.rid) { N.token = null; return guest(); }
        finish({ rid: String(wm.rid), name: lv.name || "", house: wm.house == null ? null : wm.house, guest: false, level: lv.level || 1 });
      });
    }).catch(function () { guest(); });
  }
  function guest() {
    finish({ rid: guestId(), name: "", house: null, guest: true });
  }

  /* ---- подсказки «как войти» для модулей (клан, рейтинг, недвижимость, онлайн) ------------------------------------ */
  function canLogin() { return EXT; }
  function loginHint() {
    if (!EXT) return "Вход в аккаунт на этом сервере не включён — прогресс хранится на этом устройстве.";
    return "Войди через " + (A.label || "аккаунт") + " — и прогресс сохранится на сервере.";
  }
  function openLogin() {
    if (!EXT) return;
    var inTg = !!(TG && TG.initData);
    try {
      if (inTg && A.tgLogin && TG.openTelegramLink) { TG.openTelegramLink(A.tgLogin); return; }
    } catch (e) { /* старый клиент */ }
    if (A.login) global.open(A.login, "_blank", "noopener");
  }

  FC.on("me", function (me) {
    // свой дом: выбранный или по хэшу rid
    me.home = FC.map.homeOf(me.house != null ? me.house : FC.hash(me.rid) % 9973);
  });

  N.login = login; N.canLogin = canLogin; N.loginHint = loginHint; N.openLogin = openLogin;
  FC.net = N;
  // вход стартует, как только загрузились все модули (fmain подписан на «me»)
  global.addEventListener("load", function () { setTimeout(login, 30); });
})(window);
