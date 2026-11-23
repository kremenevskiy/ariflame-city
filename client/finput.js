/* Флейм-Сити — ввод: клавиатура, мышь (pointer lock), тач (джойстик слева, обзор пальцем справа, кнопки).
 *
 * Одна модель для всех: оси движения mx/mz (-1..1, mz>0 — вперёд), накопленный обзор lookX/lookY (забирает камера
 * через takeLook), удержание held(имя) и нажатие pressed(имя) — «один раз за нажатие», сбрасывается в конце кадра.
 * Имена действий: use (E), car (F), jump (Space), brake (Space в машине), punch (ЛКМ/Q), phone (P/Tab), map (M),
 * horn (H), cam (C), pause (Esc), run (Shift), skip (Enter).
 */
(function (global) {
  "use strict";
  var FC = global.FC;

  var KEYS = {
    KeyW: "fw", ArrowUp: "fw", KeyS: "bw", ArrowDown: "bw", KeyA: "lf", ArrowLeft: "lf", KeyD: "rt", ArrowRight: "rt",
    ShiftLeft: "run", ShiftRight: "run", Space: "jump", KeyE: "use", KeyF: "car", KeyQ: "punch", KeyP: "phone",
    Tab: "phone", KeyM: "map", KeyH: "horn", KeyC: "cam", Escape: "pause", Enter: "skip", KeyR: "radio", KeyV: "roll", ControlLeft: "roll", AltLeft: "roll",
    Digit1: "d1", Digit2: "d2", Digit3: "d3", Digit4: "d4", Digit5: "d5", Digit6: "d6", Digit7: "d7", Digit8: "d8", Digit9: "d9"
  };
  var held = {}, fresh = {}, look = { x: 0, y: 0 };
  var I = { mx: 0, mz: 0, run: false, touch: false, locked: false, enabled: true };

  function down(name) { if (!held[name]) fresh[name] = true; held[name] = true; }
  function up(name) { held[name] = false; }

  function typing(e) {
    var t = e.target;
    return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  }
  global.addEventListener("keydown", function (e) {
    if (typing(e)) return;
    var n = KEYS[e.code];
    if (!n) return;
    if (n === "phone" || n === "jump" || e.code.indexOf("Arrow") === 0) e.preventDefault();
    if (!e.repeat) down(n);
  });
  global.addEventListener("keyup", function (e) { var n = KEYS[e.code]; if (n) up(n); });
  global.addEventListener("blur", function () { held = {}; });

  /* ---- мышь: клик по холсту захватывает указатель, движение — обзор --------------------------------- */
  function bindCanvas(cv) {
    cv.addEventListener("mousedown", function (e) {
      if (I.touch) return;
      if (!I.locked && I.enabled && cv.requestPointerLock) { cv.requestPointerLock(); return; }
      if (e.button === 0) down("punch");
      if (e.button === 2) down("aim");
    });
    cv.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    global.addEventListener("mouseup", function (e) { if (e.button === 0) up("punch"); if (e.button === 2) up("aim"); });
    document.addEventListener("pointerlockchange", function () {
      I.locked = document.pointerLockElement === cv;
      FC.emit("input:lock", I.locked);
    });
    global.addEventListener("mousemove", function (e) {
      if (!I.locked) return;
      look.x += e.movementX || 0; look.y += e.movementY || 0;
    });
    // колесо — дальше/ближе камера
    cv.addEventListener("wheel", function (e) { FC.emit("input:zoom", e.deltaY > 0 ? 1 : -1); }, { passive: true });
  }
  function unlock() { if (document.exitPointerLock && I.locked) document.exitPointerLock(); }

  /* ---- тач: левая половина — джойстик, правая — обзор, кнопки — DOM ----------------------------------- */
  var stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 }, lookTouch = { id: null, x: 0, y: 0 };
  var stickEl = null, knobEl = null, padEl = null;
  var BTN = [
    // name, label, класс позиции
    ["car", "🚗", "b-car"], ["use", "✋", "b-use"], ["jump", "⤒", "b-jump"], ["punch", "👊", "b-punch"],
    ["run", "🏃", "b-run"], ["horn", "📯", "b-horn"], ["roll", "🌀", "b-roll"]
  ];
  /* Иконки кнопок (23.11: «эмодзи — непрофессионально»): свои линейные SVG 24×24 одного веса — белые на стекле, на
     нажатой кнопке — тёмные. Подписи кнопок в коде прежние (эмодзи) — здесь они переводятся в иконку; чего нет в
     таблице (оружие из магазина) — остаётся как есть. FC.icons(имя) — для HUD (телефон, карта, пауза…). */
  var SV = function (d, extra) { return "<svg viewBox='0 0 24 24' width='26' height='26' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'>" + d + (extra || "") + "</svg>"; };
  var ICONS = {
    car: SV("<path d='M3 15.5V12l2.2-5.2A2 2 0 0 1 7 5.6h10a2 2 0 0 1 1.8 1.2L21 12v3.5a1 1 0 0 1-1 1h-1.5'/><path d='M5.5 16.5H4a1 1 0 0 1-1-1'/><path d='M9.5 16.5h5'/><circle cx='7.5' cy='16.5' r='2'/><circle cx='16.5' cy='16.5' r='2'/><path d='M3.5 11.5h17'/>"),
    exit: SV("<path d='M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4'/><path d='M9 16l-4-4 4-4'/><path d='M5 12h10'/>"),
    use: SV("<circle cx='12' cy='12' r='8.5'/><circle cx='12' cy='12' r='3' fill='currentColor' stroke='none'/>"),
    jump: SV("<path d='M12 19V6'/><path d='M6.5 11.5 12 6l5.5 5.5'/><path d='M5 20h14'/>"),
    punch: SV("<path d='M7 11V8.5a1.5 1.5 0 0 1 3 0V11'/><path d='M10 10V7.5a1.5 1.5 0 0 1 3 0V10'/><path d='M13 10V8a1.5 1.5 0 0 1 3 0v3'/><path d='M16 11a1.5 1.5 0 0 1 3 0v2.5A6.5 6.5 0 0 1 12.5 20H11a5 5 0 0 1-5-5v-2a2 2 0 0 1 2-2h3'/>"),
    run: SV("<path d='M5 7l5 5-5 5'/><path d='M12 7l5 5-5 5'/>"),
    horn: SV("<path d='M4 10v4h3l5 4V6L7 10H4z'/><path d='M16 9a4 4 0 0 1 0 6'/><path d='M18.5 6.5a7.5 7.5 0 0 1 0 11'/>"),
    roll: SV("<path d='M20 12a8 8 0 1 1-2.3-5.6'/><path d='M20 4v5h-5'/>"),
    nitro: SV("<path d='M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.3 1.2-3.6 2.4-4.8C10.5 7 11.6 5.6 12 3z'/><path d='M12 21a2.5 2.5 0 0 1-2.5-2.5c0-1.6 1.4-2.3 2.5-4 1.1 1.7 2.5 2.4 2.5 4A2.5 2.5 0 0 1 12 21z'/>"),
    brake: SV("<circle cx='12' cy='12' r='8.5'/><path d='M10 16.5v-9h3a2.6 2.6 0 0 1 0 5.2h-3'/>"),
    chute: SV("<path d='M3 11a9 7 0 0 1 18 0'/><path d='M3 11l9 9 9-9'/><path d='M9 11l3 9 3-9'/>"),
    up: SV("<path d='M6 15l6-6 6 6'/>"), down: SV("<path d='M6 9l6 6 6-6'/>"),
    aim: SV("<circle cx='12' cy='12' r='7'/><path d='M12 2v4M12 18v4M2 12h4M18 12h4'/><circle cx='12' cy='12' r='1.5' fill='currentColor' stroke='none'/>"),
    phone: SV("<rect x='7' y='2.5' width='10' height='19' rx='2.5'/><path d='M11 18.5h2'/>"),
    map: SV("<path d='M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z'/><path d='M9 4v13.5M15 6.5V20'/>"),
    pause: SV("<path d='M9 5v14M15 5v14'/>"),
    camera: SV("<path d='M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z'/><circle cx='12' cy='13' r='3.5'/>"),
    full: SV("<path d='M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'/>"),
    rotate: SV("<rect x='4' y='8' width='16' height='10' rx='2'/><path d='M8 4.5A6 6 0 0 1 17.5 6'/><path d='M17.5 3v3h-3'/>")
  };
  var EMO = { "🚗": "car", "🚪": "exit", "✋": "use", "⤒": "jump", "👊": "punch", "🏃": "run", "📯": "horn", "🌀": "roll", "🔥": "nitro",
    "🅿️": "brake", "🪂": "chute", "⬆": "up", "⏫": "up", "⬇": "down", "⏬": "down", "📱": "phone", "🗺️": "map", "⏸": "pause", "📸": "camera", "⛶": "full" };
  function label(el, t) {
    var k = EMO[t] || (ICONS[t] ? t : null);
    if (k) { el.innerHTML = ICONS[k]; el.dataset.icon = k; } else { el.innerHTML = ICONS.aim; el.dataset.icon = "aim"; el.title = t; }
  }
  FC.icons = function (name) { return ICONS[EMO[name] || name] || ""; };
  var btnEls = {};
  // джойстик отпустили — обратно в угол (позиция из CSS .stick.rest)
  function toRest() {
    stickEl.classList.remove("on"); stickEl.style.left = ""; stickEl.style.top = "";
    knobEl.style.transform = "translate(0px,0px)"; stickEl.classList.add("rest");
  }
  function buildTouch() {
    if (padEl) return;
    padEl = document.createElement("div"); padEl.id = "pad";
    stickEl = document.createElement("div"); stickEl.className = "stick";
    knobEl = document.createElement("div"); knobEl.className = "knob";
    stickEl.appendChild(knobEl); padEl.appendChild(stickEl);
    stickEl.classList.add("rest");                         // в покое база видна в левом нижнем углу — понятно, куда ставить палец
    BTN.forEach(function (b) {
      var el = document.createElement("button");
      el.type = "button"; el.className = "tbtn " + b[2]; label(el, b[1]); el.dataset.act = b[0];
      el.addEventListener("touchstart", function (e) {
        e.preventDefault(); e.stopPropagation();
        if (b[0] === "run") { I.runToggle = !I.runToggle; el.classList.toggle("on", I.runToggle); return; }
        down(b[0]); el.classList.add("on");
      }, { passive: false });
      el.addEventListener("touchend", function (e) { e.preventDefault(); if (b[0] !== "run") { up(b[0]); el.classList.remove("on"); } }, { passive: false });
      btnEls[b[0]] = el; padEl.appendChild(el);
    });
    document.body.appendChild(padEl);
  }
  function setButton(name, opt) {
    var el = btnEls[name]; if (!el) return;
    if (opt.label != null) label(el, opt.label);
    if (opt.show != null) el.style.display = opt.show ? "" : "none";
    if (opt.hot != null) el.classList.toggle("hot", !!opt.hot);
  }
  /* Касания — НЕ пассивные: на игровом поле гасим preventDefault-ом всё, что Telegram и браузер делают с жестами
     (свайп вниз сворачивает мини-аппу, щипок и двойной тап масштабируют страницу, «резинка» прокрутки). Касания
     в интерфейсе (телефон, карта, диалог, мини-игры, кнопки) не трогаем — там своя прокрутка и клики.
     Джойстик «плавающий»: опора там, где лёг палец, и тянется за пальцем, если тот ушёл дальше радиуса;
     мёртвая зона 12% с перешкалированием — нет дрейфа. Обзор — сглаженный, с плавной чувствительностью. */
  var UI_SEL = "button,a,input,select,textarea,.ui,#phone,#bigmap,#dlg,.mg,.pause,.phone,.bigmap,[data-ui]";
  function isUI(t) { return t && t.closest && t.closest(UI_SEL); }
  var R = 58, DEAD = 0.12;
  function onTouchStart(e) {
    if (!I.enabled) return;
    touchMode();
    var game = false;
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (isUI(t.target)) continue;
      game = true;
      if (t.clientX < global.innerWidth * 0.42 && stick.id === null) {
        stick.id = t.identifier; stick.ox = t.clientX; stick.oy = t.clientY; stick.x = 0; stick.y = 0;
        stickEl.classList.remove("rest");
        stickEl.style.left = (t.clientX - 60) + "px"; stickEl.style.top = (t.clientY - 60) + "px";
        stickEl.classList.add("on"); knobEl.style.transform = "translate(0px,0px)";
      } else if (lookTouch.id === null) {
        lookTouch.id = t.identifier; lookTouch.x = t.clientX; lookTouch.y = t.clientY; lookTouch.t = performance.now();
      }
    }
    if (game && e.cancelable) e.preventDefault();
  }
  function onTouchMove(e) {
    var game = false;
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (t.identifier === stick.id) {
        game = true;
        var dx = t.clientX - stick.ox, dy = t.clientY - stick.oy, m = Math.hypot(dx, dy);
        if (m > R) {                                   // опора едет за пальцем
          stick.ox += dx / m * (m - R); stick.oy += dy / m * (m - R);
          stickEl.style.left = (stick.ox - 60) + "px"; stickEl.style.top = (stick.oy - 60) + "px";
          dx = t.clientX - stick.ox; dy = t.clientY - stick.oy; m = R;
        }
        var k = m / R, kk = k < DEAD ? 0 : (k - DEAD) / (1 - DEAD);
        stick.x = m ? dx / m * kk : 0; stick.y = m ? dy / m * kk : 0;
        knobEl.style.transform = "translate(" + dx + "px," + dy + "px)";
      } else if (t.identifier === lookTouch.id) {
        game = true;
        var ddx = t.clientX - lookTouch.x, ddy = t.clientY - lookTouch.y;
        // чувствительность растёт с быстротой движения: точно — медленно, разворот — быстрым свайпом
        var speed = Math.hypot(ddx, ddy), gain = 1.05 + Math.min(1.2, speed / 22);
        look.x += ddx * gain; look.y += ddy * gain * 0.8;
        lookTouch.x = t.clientX; lookTouch.y = t.clientY;
      }
    }
    if (game && e.cancelable) e.preventDefault();
  }
  function onTouchEnd(e) {
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (t.identifier === stick.id) { stick.id = null; stick.x = stick.y = 0; if (stickEl) toRest(); }
      if (t.identifier === lookTouch.id) {
        // короткий тап по правой половине без движения — «действие» (как ✋), если рядом есть что сделать
        if (performance.now() - lookTouch.t < 180 && FC.interact && FC.interact.current && FC.interact.current()) I.tap("use");
        lookTouch.id = null;
      }
    }
  }
  global.addEventListener("touchstart", onTouchStart, { passive: false });
  global.addEventListener("touchmove", onTouchMove, { passive: false });
  global.addEventListener("touchend", onTouchEnd, { passive: true });
  global.addEventListener("touchcancel", onTouchEnd, { passive: true });
  // щипок-масштаб и жесты Safari — мимо
  document.addEventListener("gesturestart", function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener("dblclick", function (e) { if (!isUI(e.target)) e.preventDefault(); }, { passive: false });

  /* Telegram: развернуть, запретить свайп-закрытие, подстроиться под безопасные зоны и полноэкранный режим. */
  var TG = global.Telegram && global.Telegram.WebApp;
  function tgSetup() {
    if (!TG || !TG.initData) return;
    try {
      TG.ready(); TG.expand();
      if (TG.disableVerticalSwipes) TG.disableVerticalSwipes();
      if (TG.setHeaderColor) TG.setHeaderColor("#0b1024");
      if (TG.setBackgroundColor) TG.setBackgroundColor("#0b1024");
      // не закрыть игру случайным движением посреди погони
      if (TG.enableClosingConfirmation && TG.isVersionAtLeast && TG.isVersionAtLeast("6.2")) TG.enableClosingConfirmation();
      // мини-апп свернули (Bot API 8.0) — пауза мира и звука, вернули — дальше
      if (TG.onEvent) {
        TG.onEvent("deactivated", function () { FC.tgPaused = true; FC.emit("app:hidden", true); });
        TG.onEvent("activated", function () { FC.tgPaused = false; FC.emit("app:hidden", false); });
      }
    } catch (e) { /* старый клиент */ }
  }
  tgSetup();
  I.fullscreen = function () {
    try {
      if (TG && TG.initData && TG.requestFullscreen) { if (TG.isFullscreen) TG.exitFullscreen(); else TG.requestFullscreen(); return true; }
      var d = document.documentElement;
      if (document.fullscreenElement) document.exitFullscreen();
      else if (d.requestFullscreen) d.requestFullscreen({ navigationUI: "hide" });
      else if (d.webkitRequestFullscreen) d.webkitRequestFullscreen();
      return true;
    } catch (e) { return false; }
  };
  I.canFullscreen = !!((TG && TG.initData && TG.requestFullscreen) || document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
  /* Горизонтально (23.11: «чтобы горизонтально тоже можно было играть и включить»). Интерфейс подстраивается под любой
     поворот сам (CSS: body.touch + orientation). Кнопка помогает повернуть: Android — во весь экран и замок ориентации;
     Telegram — во весь экран (повернуть телефон и закрепить — lockOrientation); iPhone в Safari замка нет — подсказка
     «поверни телефон». Обратно — та же кнопка (замок снимается). */
  I.landscape = function () {
    var landNow = global.innerWidth > global.innerHeight, so = global.screen && global.screen.orientation;
    try {
      if (TG && TG.initData) {
        if (TG.isOrientationLocked && TG.unlockOrientation) { TG.unlockOrientation(); return "unlocked"; }
        if (TG.requestFullscreen && !TG.isFullscreen) TG.requestFullscreen();
        if (landNow && TG.lockOrientation) { TG.lockOrientation(); return "locked"; }
        return "rotate";
      }
      if (so && so.lock) {
        if (I.orientLocked) { so.unlock(); I.orientLocked = false; return "unlocked"; }
        var go = function () { return so.lock(landNow ? "portrait" : "landscape").then(function () { I.orientLocked = true; }); };
        var d = document.documentElement;
        (document.fullscreenElement || !d.requestFullscreen ? go() : d.requestFullscreen({ navigationUI: "hide" }).then(go))
          .catch(function () { if (FC.emit) FC.emit("input:rotate-hint", {}); });
        return "lock";
      }
    } catch (e) { /* нет замка ориентации */ }
    return "rotate";
  };

  /* ---- кадр: оси из клавиш или джойстика --------------------------------------------------------------- */
  function poll() {
    if (!I.enabled) { I.mx = I.mz = 0; I.run = false; return; }
    var kx = (held.rt ? 1 : 0) - (held.lf ? 1 : 0), kz = (held.fw ? 1 : 0) - (held.bw ? 1 : 0);
    if (stick.id !== null || I.touch) {
      var sx = stick.x, sz = -stick.y;
      if (kx || kz) { sx = kx; sz = kz; }
      I.mx = sx; I.mz = sz;
      I.run = !!held.run || !!I.runToggle || Math.hypot(stick.x, stick.y) > 0.86;
    } else {
      var m = Math.hypot(kx, kz) || 1;
      I.mx = kx / m; I.mz = kz / m; I.run = !!held.run;
    }
  }
  function endFrame() { fresh = {}; }
  function takeLook() { var r = { x: look.x, y: look.y }; look.x = look.y = 0; return r; }

  I.held = function (n) { return !!held[n]; };
  I.pressed = function (n) { return !!fresh[n] && I.enabled; };
  I.consume = function (n) { fresh[n] = false; };
  I.tap = function (n) { fresh[n] = true; };            // HUD-кнопки и мини-игры жмут действие программно
  I.poll = poll; I.endFrame = endFrame; I.takeLook = takeLook; I.bindCanvas = bindCanvas; I.unlock = unlock;
  I.setButton = setButton;
  I.enable = function (on) {
    I.enabled = !!on;
    if (!on) { held = {}; stick.id = null; stick.x = stick.y = 0; lookTouch.id = null; if (stickEl) toRest(); }
  };
  FC.input = I;
  // телефон — сенсорная раскладка сразу (а не после первого касания): миникарта наверху, джойстик внизу слева
  function touchMode() { if (I.touch) return; I.touch = true; document.body.classList.add("touch"); buildTouch(); FC.emit("input:touch", true); }
  if (FC.mobile) { if (document.body) touchMode(); else document.addEventListener("DOMContentLoaded", touchMode); }
})(window);
