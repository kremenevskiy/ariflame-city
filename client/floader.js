/* Флейм-Сити — экран загрузки (window.FCL). Грузится первым скриптом страницы, до движка и модулей.
 *
 * Ключ-арт города на весь экран (client/loader/<город>-<сцена>.webp, на телефоне — вертикальный «-p»; каждый заход —
 * другая сцена; у Минска — свой экран: белорусский указатель «Мінск / Minsk» и места города), дорожный указатель: выбранный город с обратным отсчётом «км до города» по ходу загрузки и второй город
 * кнопкой «Поехать», советы талисмана. Город — ?city=minsk|flame или выбранный раньше (localStorage fc.city) →
 * window.FC_CITY (по нему index.html подгружает данные Минска).
 *
 * Ход загрузки честный, но сглаженный: скрипты страницы (≈60) → window.load → FCL.stage("start") (fmain: вход готов,
 * игра пошла под заставкой) → FCL.done() (fmain: шейдеры собраны, кварталы достроены). Между шагами полоска
 * подползает сама, чтобы не стоять на месте. Без поддержки анимаций (prefers-reduced-motion) — без наездов камеры.
 */
(function (global) {
  "use strict";
  var doc = global.document, L = doc.getElementById("loader");

  /* ---- город -------------------------------------------------------------------------------------------------- */
  var q = null, c = null;
  try { q = new URLSearchParams(global.location.search).get("city"); } catch (e) { q = null; }
  try { c = q || global.localStorage.getItem("fc.city"); } catch (e) { c = q; }
  var CITY = global.FC_CITY = c === "minsk" ? "minsk" : "flame";
  if (q) { try { global.localStorage.setItem("fc.city", CITY); } catch (e) { /* приватное окно */ } }
  // sign — подписи на указателе. Экран Минска — свой: указатель как на белорусских дорогах (название по-белорусски,
  // под ним латиницей), сверху — «Минск 1:1», картинки — узнаваемые места города.
  var CITIES = {
    flame: { name: "Флейм-Сити", art: ["flame-sunset", "flame-roof", "flame-chase"],
      sign: { flame: ["Флейм-Сити"], minsk: ["Минск 1:1"] } },
    minsk: { name: "Минск 1:1", art: ["minsk-library", "minsk-trinity", "minsk-gates", "minsk-church", "minsk-avenue", "minsk-mayak", "minsk-mir", "minsk-zyb", "minsk-nemiga"],
      sign: { minsk: ["Мінск", "Minsk"], flame: ["Флейм-Сіці", "Flame City"] } }
  };
  var OTHER = CITY === "minsk" ? "flame" : "minsk";
  if (!L) { global.FCL = { stage: function () {}, done: function () {}, afterPaint: function (cb) { cb(); } }; return; }

  var coarse = global.matchMedia && global.matchMedia("(pointer: coarse)").matches;
  var still = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- советы ------------------------------------------------------------------------------------------------- */
  var TIPS = [
    "Подойди к любому прохожему — можно поговорить, а можно дать в нос.",
    "Любое здание можно купить, открыть в нём бизнес и нанять людей.",
    "Кланы воюют за районы по выходным, с 19 до 21 по Минску.",
    "Угнал вертолёт — сразу звезда розыска. Зато какой вид сверху.",
    "Самые быстрые машины разгоняются до 500 км/ч. Ищи «Корсаро Ураган 500».",
    "Нарушишь правила — за тобой выедет «Патруль «Щит»».",
    "В телефоне — миссии, задачи дня, «Афиша», рейтинг и кланы."
  ];
  if (!coarse) TIPS.push(
    "За рулём зажми Shift — нитро. Бак пополняют трюки: дрифт, впритирку, полёт.",
    "M — карта. С неё можно переместиться в любую точку города.",
    "O — фоторежим: мир замирает, камера свободная. K — повтор последних секунд.",
    "T — колесо оружия, Z и X — листать оружие."
  );
  if (CITY === "minsk") TIPS.push(
    "Минск собран по OpenStreetMap улица за улицей — найди свой дом.",
    "В Минске перемещение с карты работает даже в погоне.",
    "Немига, Комаровка, Октябрьская, Нацбиблиотека — на карте Минска есть быстрые точки: один клик — и ты там."
  );
  else TIPS.push("Гонка недели и совместное ограбление — только во Флейм-Сити.");

  /* ---- разметка ----------------------------------------------------------------------------------------------- */
  var UP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5 21 11h-5.5v11h-7V11H3z" fill="#fff"/></svg>';
  var TURN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 22V12.5Q5 7.5 10 7.5h4.5V2.5L23 10l-8.5 7.5v-5H10.5q-.5 0-.5.5V22z" fill="#fff"/></svg>';
  var last = null, pick;
  try { last = global.localStorage.getItem("fc.art"); } catch (e) { last = null; }
  var pool = CITIES[CITY].art.filter(function (a) { return a !== last; });
  pick = pool[Math.floor(Math.random() * pool.length)];
  // разработка: ?art=<сцена> — конкретная картинка, ?loader=hold — экран не уходит (разглядеть и снять)
  var qs = global.location.search, forced = (qs.match(/[?&]art=([a-z-]+)/) || [])[1], HOLD = /[?&]loader=hold\b/.test(qs);
  if (forced && CITIES[CITY].art.indexOf(forced) >= 0) pick = forced;
  try { global.localStorage.setItem("fc.art", pick); } catch (e) { /* приватное окно */ }
  var portrait = global.innerHeight > global.innerWidth * 1.05;
  var DASH = 16, dashes = "", SIGN = CITIES[CITY].sign;
  function label(names) { return "<b>" + names[0] + (names[1] ? "<i>" + names[1] + "</i>" : "") + "</b>"; }
  for (var i = 0; i < DASH; i++) dashes += "<i></i>";

  L.setAttribute("aria-label", "Загрузка: " + CITIES[CITY].name);
  if (CITY === "minsk") L.classList.add("osm-on", "by");
  L.innerHTML =
    '<div class="art"><img alt="" decoding="sync" fetchpriority="high"></div>' +
    '<div class="shade"></div>' +
    '<div class="mark"><img src="brand/mascot.png" alt=""><span>' +
      (CITY === "minsk" ? "<small>Флейм-Сити</small>Минск 1:1" : "Флейм-Сити") + '</span></div>' +
    '<div class="dock">' +
      '<p class="tip"><img src="brand/mascot.png" alt=""><span></span></p>' +
      '<div class="sign"><div class="sign-in">' +
        '<div class="row cur">' + UP + label(SIGN[CITY]) + '<span class="km"></span></div>' +
        '<div class="lane" aria-hidden="true">' + dashes + '</div>' +
        '<button type="button" class="row alt" aria-label="Поехать: ' + CITIES[OTHER].name + '">' + TURN +
          label(SIGN[OTHER]) + '<span class="go">Поехать</span></button>' +
      '</div></div>' +
    '</div>' +
    (CITY === "minsk" ? '<small class="osm">Карта © участники OpenStreetMap</small>' : "");

  // без ожидания onload: под синхронными скриптами страницы событие доходит через секунды, а картинка (≈100 КБ) уже
  // готова — пусть рисуется с первым кадром, под ней — тёмный фон
  var img = L.querySelector(".art img");
  img.src = "loader/" + pick + (portrait ? "-p" : "") + ".webp";
  // Игра строит город одним длинным куском работы (секунды на слабом телефоне) — пока он идёт, браузер не рисует ни
  // кадра, и заставка стояла бы тёмной без картинки. Поэтому старт игры (fmain) ждёт кадра с картинкой: декод (обычно
  // ~0,1 с) + два кадра; не дольше 1,2 с, что бы ни случилось с картинкой.
  var painted = false, waiters = [];
  function markPainted() {
    if (painted) return;
    painted = true;
    try { global.performance.mark("fcl:painted"); } catch (e) { /* старый браузер */ }
    waiters.splice(0).forEach(function (f) { try { f(); } catch (e) { if (global.console) console.error(e); } });
  }
  function twoFrames() {
    try { global.performance.mark("fcl:decoded"); } catch (e) { /* старый браузер */ }
    global.requestAnimationFrame(function () { global.requestAnimationFrame(function () { setTimeout(markPainted, 60); }); });
  }
  if (img.decode) img.decode().then(twoFrames, twoFrames); else { img.onload = twoFrames; img.onerror = twoFrames; }
  setTimeout(markPainted, 1200);

  L.querySelector(".row.alt").addEventListener("click", function () {
    try { global.localStorage.setItem("fc.city", OTHER); } catch (e) { /* приватное окно */ }
    var u = new URL(global.location.href); u.searchParams.set("city", OTHER); global.location.href = u.toString();
  });

  /* советы по кругу: первый — случайный, дальше раз в 4,5 с */
  var tipEl = L.querySelector(".tip span"), tipBox = L.querySelector(".tip"), ti = Math.floor(Math.random() * TIPS.length);
  tipEl.textContent = TIPS[ti];
  var tipTimer = setInterval(function () {
    tipBox.classList.add("swap");
    setTimeout(function () { ti = (ti + 1) % TIPS.length; tipEl.textContent = TIPS[ti]; tipBox.classList.remove("swap"); }, 320);
  }, 4500);

  /* ---- ход загрузки: km до города -------------------------------------------------------------------------------- */
  var KM = 2 + Math.round(Math.random() * 24) / 10;     // 2,0–4,4 км: у каждого захода свой путь
  var kmEl = L.querySelector(".km"), lane = L.querySelectorAll(".lane i");
  var target = 0.04, cap = 0.12, shown = 0, finished = false, prev = performance.now(), raf = 0;
  var SCRIPTS = 61;                                      // ≈ скриптов страницы (index.html): движок, данные, модули
  var seen = 0;
  function bump(p, nextCap) { if (p > target) target = p; if (nextCap > cap) cap = nextCap; }
  doc.addEventListener("load", function (e) {
    if (e.target && e.target.tagName === "SCRIPT") { seen++; bump(0.05 + 0.55 * Math.min(1, seen / SCRIPTS), 0.62); }
  }, true);
  global.addEventListener("load", function () { bump(0.62, 0.8); });
  function fmt(km) { return (km < 0.05 ? "0" : km.toFixed(1).replace(".", ",")) + " км"; }
  function frame(now) {
    var dt = Math.min(0.1, (now - prev) / 1000); prev = now;
    if (!finished && target < cap) target = Math.min(cap, target + dt * 0.018);   // подползаем к следующему шагу
    shown += (target - shown) * Math.min(1, dt * 4);
    if (finished && target - shown < 0.004) shown = 1;
    kmEl.textContent = fmt(KM * (1 - shown));
    var on = Math.round(shown * DASH);
    for (var k = 0; k < DASH; k++) lane[k].className = k < on ? "on" : "";
    raf = shown < 1 ? global.requestAnimationFrame(frame) : 0;
  }
  raf = global.requestAnimationFrame(frame);

  function stage(name) {
    if (name === "start") bump(0.86, 0.97);
  }
  function done() {
    if (finished || HOLD) return;
    finished = true; target = 1; cap = 1;
    if (!raf) raf = global.requestAnimationFrame(frame);
    // «0 км» успевает показаться — и камера «въезжает» в город
    setTimeout(function () {
      clearInterval(tipTimer);
      L.classList.add("done");
      setTimeout(function () { global.cancelAnimationFrame(raf); if (L.parentNode) L.parentNode.removeChild(L); }, still ? 400 : 1100);
    }, still ? 0 : 380);
  }
  function afterPaint(cb) { if (painted) cb(); else waiters.push(cb); }
  // выбран район на «Где начнёшь?» — пока строится город, на заставке его картинка (если она есть в loader/)
  function setArt(name) { if (!name || HOLD && forced) return; img.src = "loader/" + name + (portrait ? "-p" : "") + ".webp"; }
  global.FCL = { stage: stage, done: done, afterPaint: afterPaint, setArt: setArt, city: CITY };
})(window);
