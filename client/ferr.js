/* Флейм-Сити — ошибки у игроков (FC.err). 25.11.2026, слово владельца: «чтобы всё, что ломается у людей — на
 * телефонах, в браузере — нам приходило: у кого что падает, кто завис, что не прорисовалось».
 *
 * Грузится ПЕРВЫМ (раньше floader.js) и ни от чего не зависит: ловит и ошибки при загрузке остальных модулей.
 * Что шлём (server/errors.py, POST /g/err — свой же сервер, чужих адресов нет):
 *   js / promise   — исключение или отклонённое обещание (сообщение, стек, файл:строка);
 *   console        — console.error самой игры (системы кадра пишут туда свои падения);
 *   load           — не загрузился скрипт, картинка, модель;
 *   webgl          — потерян контекст WebGL (чёрный экран на телефонах);
 *   freeze         — страница не отвечала дольше 5 с (вкладка при этом была на экране);
 *   lowfps         — меньше 8 кадров/с дольше 15 с (один раз за сеанс);
 *   start          — игра не запустилась за 60 с (что писал экран загрузки);
 *   state          — «невозможное» состояние: «в машине», а машины рядом нет; позиция NaN; игрок под миром.
 * Контекст — версия, город, качество графики, телефон/компьютер/Telegram, браузер, экран, видеокарта, режим игрока,
 * позиция с шагом 50 м. Никаких аккаунтов, ников и токенов. Одинаковое — один раз (дальше только счётчик),
 * не больше 40 разных за сеанс, отправка пачкой раз в 8 с и при уходе со страницы. Онлайн выключен (?gs=off) — молчим.
 * Модулям: FC.err.report(вид, сообщение, данные) — для своих проверок; FC.err.ctx() / log() / fps() — для «Сообщить о
 * проблеме» (freport.js): журнал (последние 60 строк консоли) уходит только оттуда, по кнопке игрока.
 */
(function (global) {
  "use strict";
  var T0 = Date.now(), Q = [], SEEN = {}, SENT = 0, MAX = 40, gpu = null, LOG = [], fpsNow = 0;
  // журнал игры — последние 60 строк консоли и отчётов; уходит только с «Сообщить о проблеме» (freport.js)
  function logLine(lvl, msg) { LOG.push([Math.round((Date.now() - T0) / 100) / 10, lvl, String(msg).slice(0, 200)]); if (LOG.length > 60) LOG.shift(); }
  var SID = (function () { var s = "", a = "abcdefghijklmnopqrstuvwxyz0123456789"; for (var i = 0; i < 12; i++) s += a[Math.floor(Math.random() * a.length)]; return s; })();
  var UA = (function (u) {
    var b = /YaBrowser\/\d+/.exec(u) || /Edg\/\d+/.exec(u) || /OPR\/\d+/.exec(u) || /Firefox\/\d+/.exec(u) || /CriOS\/\d+/.exec(u) || /Chrome\/\d+/.exec(u) || /Version\/[\d.]+.*Safari/.exec(u);
    var o = /iPhone OS [\d_]+|iPad; CPU OS [\d_]+|Android [\d.]+|Windows NT [\d.]+|Mac OS X [\d_]+|Linux/.exec(u);
    return ((b ? b[0].replace(/Version\/([\d.]+).*Safari/, "Safari/$1") : "?") + " · " + (o ? o[0] : "?")).slice(0, 80);
  })(navigator.userAgent || "");

  function FC() { return global.FC || {}; }
  function gpuName() {
    if (gpu !== null) return gpu;
    try {
      var gl = FC().gfx && FC().gfx.renderer && FC().gfx.renderer.getContext();
      var ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
      gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)).slice(0, 80) : "";
    } catch (e) { gpu = ""; }
    return gpu;
  }
  function ctx() {
    var F = FC(), P = F.player, c = {
      v: (F.update && F.update.version) || "dev", city: F.city || global.FC_CITY || "", ua: UA,
      phone: !!F.mobile, tg: !!(global.Telegram && global.Telegram.WebApp && global.Telegram.WebApp.initData),
      w: global.innerWidth, h: global.innerHeight, dpr: +(global.devicePixelRatio || 1).toFixed(2),
      q: F.gfx && F.gfx.Q ? F.gfx.Q.level : "", gpu: F.gfx && F.gfx.renderer ? gpuName() : "",
      started: !!F.started, up: Math.round((Date.now() - T0) / 1000), mem: navigator.deviceMemory || 0
    };
    if (P) { c.mode = P.mode || ""; if (isFinite(P.x) && isFinite(P.z)) c.pos = [Math.round(P.x / 50) * 50, Math.round(P.z / 50) * 50]; }
    return c;
  }
  function report(kind, msg, stack, extra) {
    msg = String(msg == null ? "" : msg).slice(0, 300);
    if (!msg) return;
    stack = String(stack || "").slice(0, 1500);
    var key = kind + "|" + msg.replace(/\d+/g, "N") + "|" + (stack.split("\n")[1] || "").replace(/:\d+:\d+/, "");   // числа — та же ошибка
    var old = SEEN[key];
    if (old) { old.more++; return; }
    if (SENT + Q.length >= MAX) return;
    var it = { kind: kind, msg: msg, stack: stack, at: Date.now() - T0, ctx: ctx(), n: 1 };
    if (extra && extra.src) it.src = String(extra.src).slice(0, 200);
    if (extra && extra.line) it.line = extra.line | 0;
    SEEN[key] = { item: it, more: 0 };
    Q.push(it);
    logLine("!" + kind, msg);
  }
  function url() {
    var F = FC();
    if (!F.gs || !F.gsOff) return null;                  // ядро ещё не загрузилось — подождём
    if (F.gsOff()) return false;                          // онлайн выключен (разработка, проверки) — не шлём
    return F.gs() + "/g/err";
  }
  function flush(leaving) {
    Object.keys(SEEN).forEach(function (k) {             // повторы уже отправленного — одной строкой со счётчиком
      var s = SEEN[k]; if (s.more && Q.indexOf(s.item) < 0) { var it = JSON.parse(JSON.stringify(s.item)); it.n = s.more; s.more = 0; Q.push(it); }
    });
    if (!Q.length) return;
    var u = url();
    if (u === false) { SENT += Q.length; Q.length = 0; return; }
    if (!u) return;
    var items = Q.splice(0, 20);
    SENT += items.length;
    try {
      global.fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, keepalive: !!leaving,
        body: JSON.stringify({ sid: SID, items: items }) }).catch(function () { /* сети нет — не страшно */ });
    } catch (e) { /* старый браузер */ }
  }
  setInterval(flush, 8000);
  global.addEventListener("pagehide", function () { flush(true); });

  // ---- исключения, обещания, незагрузившиеся файлы --------------------------------------------------------------
  global.addEventListener("error", function (e) {
    var t = e.target;
    if (t && t !== global && (t.src || t.href)) { report("load", "не загрузился " + (t.tagName || "файл").toLowerCase(), "", { src: t.src || t.href }); return; }
    report("js", e.message || "ошибка", e.error && e.error.stack, { src: e.filename, line: e.lineno });
  }, true);
  global.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    report("promise", (r && (r.message || r.name)) || String(r), r && r.stack);
  });
  function line(args) {
    var st = "";
    var msg = Array.prototype.map.call(args, function (x) { if (x && x.stack) { st = x.stack; return x.message || String(x); } return typeof x === "string" ? x : (function () { try { return JSON.stringify(x); } catch (e) { return String(x); } })(); }).join(" ");
    return [msg, st];
  }
  var C = global.console;
  if (C) ["error", "warn", "log", "info"].forEach(function (lvl) {
    var orig = C[lvl]; if (!orig) return;
    C[lvl] = function () {
      try {
        var l = line(arguments);
        if (lvl === "error") report("console", l[0], l[1]); else logLine(lvl, l[0]);   // error — сразу нам; прочее — в журнал
      } catch (e) { /* сам отчёт не должен ломать вывод */ }
      return orig.apply(this, arguments);
    };
  });

  // ---- зависания: таймер раз в секунду; разрыв > 5 с при видимой вкладке — страница висела. Сборка города при старте
  // законно держит поток (её длительность — в ctx.up отчёта «start»), поэтому считаем с 3-й секунды после старта игры.
  var last = Date.now(), hiddenAt = 0;
  document.addEventListener("visibilitychange", function () { if (document.hidden) hiddenAt = Date.now(); });
  setInterval(function () {
    var now = Date.now(), gap = now - last, F = FC(); last = now;
    var live = F.started && F.startedAt && global.performance.now() - gap - F.startedAt > 3000;
    if (gap > 5000 && live && !document.hidden && now - hiddenAt > gap) report("freeze", "страница не отвечала " + Math.round(gap / 1000) + " с");
  }, 1000);

  // ---- мало кадров: счёт кадров за 5 с; три окна подряд < 8 к/с при видимой вкладке — один отчёт за сеанс -----------
  var frames = 0, low = 0, lowSent = false;
  function rf() { frames++; global.requestAnimationFrame(rf); }
  global.requestAnimationFrame(rf);
  setInterval(function () {
    var fps = frames / 5; frames = 0; fpsNow = fps;
    if (!FC().started || document.hidden || lowSent) { low = 0; return; }
    low = fps < 8 ? low + 1 : 0;
    if (low >= 3) { lowSent = true; report("lowfps", "мало кадров: " + fps.toFixed(1) + " к/с"); }
  }, 5000);

  // ---- старт: не запустилась за минуту --------------------------------------------------------------------------
  setTimeout(function () {
    if (FC().started || document.hidden) return;
    var L = document.getElementById("loader");
    report("start", "игра не стартовала за 60 с", "", { src: L ? (L.innerText || "").replace(/\s+/g, " ").slice(0, 160) : "" });
  }, 60000);

  // ---- WebGL и «невозможные» состояния — когда игра запущена --------------------------------------------------------
  var glHooked = false;
  setInterval(function () {
    var F = FC(), P = F.player;
    if (!F.started || !P) return;
    if (!glHooked && F.gfx && F.gfx.renderer) {
      glHooked = true;
      F.gfx.renderer.domElement.addEventListener("webglcontextlost", function () { report("webgl", "потерян контекст WebGL"); }, false);
    }
    var floorY = F.inside && F.inside.active && typeof F.inside.floorY === "function" ? F.inside.floorY() : 0;
    if (!isFinite(P.x) || !isFinite(P.z)) report("state", "позиция игрока не число (NaN)");
    else if ((P.y || 0) < floorY - 30) report("state", "игрок провалился под мир");
    if (P.mode === "car") {
      var c = P.car;
      if (!c) report("state", "режим «в машине», а машины нет");
      else if (F.cars && F.cars.list && F.cars.list.indexOf(c) < 0) report("state", "игрок «в машине», а машина убрана из мира");
      else if (c.driver !== "player") report("state", "игрок «в машине», а водитель — " + c.driver);
      else if (Math.hypot(c.x - P.x, c.z - P.z) > 25) report("state", "игрок «в машине», а машина далеко");
    }
  }, 5000);

  global.FC = global.FC || {};
  global.FC.err = {
    report: function (kind, msg, data) { report(kind === "state" || kind === "console" ? kind : "state", msg, data && data.stack, data); },
    sid: SID, ctx: ctx, fps: function () { return fpsNow; }, flush: function () { flush(); },
    log: function () { return LOG.slice(); }
  };
})(window);
