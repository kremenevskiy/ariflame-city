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
      el.type = "button"; el.className = "tbtn " + b[2]; el.textContent = b[1]; el.dataset.act = b[0];
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
    if (opt.label != null) el.textContent = opt.label;
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
