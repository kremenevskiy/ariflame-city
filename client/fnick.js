/* Флейм-Сити — свой ник: как тебя зовут в городе (25.11.2026).
 *
 * Задача: «при старте писать свой юзернейм… и потом его можно было изменить: заходишь, выбираешь локацию, спавнишься,
 * вводишь ник — чтобы тебя было видно другим, не «Гость». Чтобы работало и на телефоне, и на компьютере».
 *
 * Первые секунды остаются чистыми (пролёт, плашка района, сообщение Макса в полосе уведомлений): карточка «Как тебя зовут
 * в городе?» приходит не раньше ASK_AT с после старта — когда онлайн на связи, полоса уведомлений пуста, на экране нет
 * диалога, телефона, карты, паузы и человек остановился (или прошло ASK_LATE с). Карточка ничего не блокирует и сама
 * уходит через CARD_SEC. Тап — лист с полем: на телефоне он прижат к верху видимой области (visualViewport) — экранная
 * клавиатура его не закрывает; на компьютере Enter — сохранить, Esc — закрыть. Отказ — только «Потом» или закрыть лист;
 * карточку не заметили (сама ушла за CARD_SEC) — не отказ: спросим снова через ASK_AGAIN с, до ASK_SHOWS раз за заход
 * (25.11: «не вводил ник — и не спросило»). ASK_MAX отказов — молчим неделю (ASK_PAUSE), потом спросим снова; ник
 * сохранён — больше не спрашиваем (localStorage «fc.nick.ask»).
 * Сменить потом: пауза и «Настройки» телефона («Ник: … · Изменить»), «Онлайн», «Рейтинг».
 *
 * Правду хранит сервер (server/nicks.py: проверка, фильтр, лимиты смен): ник уходит кадром {t:"nick"} по сокету онлайна,
 * ответ — {t:"nick", ok, nick | why}. Копия — localStorage «fc.nick»: fmp.js кладёт её в hi (гостю — его ник на этом
 * устройстве, вошедшему — перенос, если на сервере ника ещё нет); что записано на сервере — welcome.name. Без онлайна
 * ник пишется только на устройство и уйдёт на сервер при следующем входе (там его и проверят).
 *
 * FC.nick: {name(), open(), set(text) → Promise<{ok, nick | why}>, check(text) → {nick | why}, forHi()}
 * Шина: «nick» (имя) — ник сменился.
 */
(function (global) {
  "use strict";
  var FC = global.FC;
  var MIN = 2, MAX = 20;
  var ASK_AT = 12, ASK_LATE = 30, ASK_GIVEUP = 150, CARD_SEC = 20, ASK_MAX = 2, ASK_AGAIN = 180, ASK_SHOWS = 3;
  var ASK_PAUSE = 7 * 86400 * 1000;
  var K_NAME = "fc.nick", K_ASK = "fc.nick.ask";
  var ALLOWED = /^[A-Za-z0-9Ѐ-џҐґ _.-]+$/, LETTER = /[A-Za-zЀ-џҐґ]/;

  function esc(s) { return FC.hud && FC.hud.esc ? FC.hud.esc(s) : String(s == null ? "" : s); }
  function readLS(k) { try { return global.localStorage.getItem(k); } catch (e) { return null; } }
  function writeLS(k, v) {
    try { if (v == null) global.localStorage.removeItem(k); else global.localStorage.setItem(k, v); } catch (e) { /* приватное окно */ }
  }
  var name = readLS(K_NAME) || null;
  var ask = (function () { try { return JSON.parse(readLS(K_ASK) || "{}") || {}; } catch (e) { return {}; } })();
  function saveAsk() { writeLS(K_ASK, JSON.stringify(ask)); }

  // Та же форма, что на сервере (nicks.check) — для мгновенной подсказки; мат, ссылки и занятые имена проверяет сервер.
  function check(text) {
    var s = String(text == null ? "" : text);
    if (s.normalize) s = s.normalize("NFKC");
    s = s.replace(/[\u0000-\u001f\u007f-\u009f​-‏⁠﻿]/g, "").replace(/\s+/g, " ").trim();
    if (s.length < MIN || s.length > MAX) return { why: "Ник — от " + MIN + " до " + MAX + " знаков" };
    if (!ALLOWED.test(s)) return { why: "Только буквы, цифры, пробел и _ - ." };
    if (!LETTER.test(s)) return { why: "Нужна хотя бы одна буква" };
    return { nick: s };
  }

  FC.css([
    "#hud .nk-card{pointer-events:auto;cursor:pointer;display:flex;gap:10px;align-items:flex-start;background:rgba(245,247,255,.97);",
    "color:#14182a;border-radius:14px;padding:10px 11px;box-shadow:0 8px 24px rgba(0,0,0,.35);animation:slide .3s ease-out;transition:.35s;",
    "border-left:4px solid #ff9b4a}",
    "#hud .nk-card.bye{opacity:0;transform:translateX(20px)}",
    ".nk-card .ni{font-size:24px;line-height:1}.nk-card b{display:block;font-size:14px}.nk-card p{margin:2px 0 7px;font-size:12.5px;color:#3a4058}",
    ".nk-card .nk-b{display:flex;gap:6px}.nk-card button,.nk-box button{border:0;border-radius:10px;padding:7px 12px;font:700 13px system-ui;cursor:pointer}",
    ".nk-card .y,.nk-box .nk-save{background:linear-gradient(90deg,#ffcf7a,#ff9b4a);color:#2a1205}",
    ".nk-card .n{background:rgba(20,24,42,.08);color:#2a3048}",
    ".nk-sheet{position:fixed;inset:0;z-index:60;display:none}.nk-sheet.on{display:block}",
    ".nk-bg{position:absolute;inset:0;background:rgba(6,8,18,.55)}",
    ".nk-box{position:fixed;left:50%;top:28%;transform:translateX(-50%);width:min(380px,calc(100vw - 32px));background:rgba(14,18,36,.97);",
    "border:1px solid var(--line);border-radius:18px;padding:14px 14px 12px;box-shadow:0 20px 60px rgba(0,0,0,.6);color:var(--ink);",
    "display:flex;flex-direction:column;gap:8px;overflow:auto;-webkit-overflow-scrolling:touch}",
    ".nk-box b{font-size:16px;color:var(--gold)}.nk-box p{margin:0;font-size:12.5px;color:rgba(255,255,255,.7)}",
    ".nk-box input{width:100%;font:600 17px system-ui;padding:10px 12px;border-radius:12px;border:1px solid rgba(255,207,122,.45);",
    "background:rgba(255,255,255,.08);color:#fff;outline:none;-webkit-user-select:text;user-select:text;touch-action:manipulation}",
    ".nk-box input:focus{border-color:var(--gold);box-shadow:0 0 0 3px rgba(255,207,122,.18)}",
    ".nk-err{min-height:16px;font-size:12.5px;color:var(--bad)}.nk-err.ok{color:var(--ok)}",
    ".nk-btns{display:flex;gap:8px;justify-content:flex-end}.nk-box .nk-later{background:rgba(255,255,255,.12);color:#fff}",
    ".nk-box button:disabled{opacity:.5;cursor:default}",
    ".nk-row .nk-edit{background:none;border:0;padding:0 2px;color:var(--gold);font:700 13px system-ui;cursor:pointer;text-decoration:underline;text-underline-offset:3px}",
    // телефон: лист у верхнего края видимой области — клавиатура снизу его не закрывает; на низком экране — без пояснения
    "body.touch .nk-box{top:calc(var(--nk-top,0px) + 8px + var(--safe-t));width:min(440px,calc(100vw - 16px - var(--safe-l) - var(--safe-r)));",
    "max-height:calc(var(--nk-h,100vh) - 16px - var(--safe-t))}",
    ".nk-box.tight{gap:6px;padding:10px 12px}.nk-box.tight p{display:none}.nk-box.tight input{padding:7px 10px}"
  ].join(""));

  /* ---- применить ник: копия на устройстве, пауза, шина ------------------------------------------------------------- */
  function apply(n) {
    name = n || null;
    writeLS(K_NAME, name);
    if (name) { ask.done = 1; saveAsk(); }
    if (FC.me) FC.me.label = name || (FC.me.name ? FC.me.name : FC.me.guest ? "Гость" : "Игрок");
    // профиль «Рейтинга» вошедшего (fprogress) — с новым ником, а не из кэша минуту назад
    if (FC.progress && FC.progress.refresh && FC.net && FC.net.token) FC.progress.refresh(true);
    FC.emit("nick", name);
  }

  /* ---- сервер: кадр по сокету онлайна ------------------------------------------------------------------------------ */
  var waiting = null, hiSent = null;
  function set(text) {
    var c = check(text);
    if (!c.nick) return Promise.resolve({ ok: false, why: c.why });
    if (c.nick === name) return Promise.resolve({ ok: true, nick: name });
    var MP = FC.mp;
    if (!(MP && MP.connected && MP.send)) {                 // без онлайна — на устройство; проверит сервер при входе
      apply(c.nick);
      return Promise.resolve({ ok: true, nick: c.nick, local: true });
    }
    if (waiting) waiting({ ok: false, why: "Подожди ответа сервера" });
    return new Promise(function (res) {
      var t = setTimeout(function () { if (waiting === done) { waiting = null; res({ ok: false, why: "Сервер не ответил — попробуй ещё раз" }); } }, 5000);
      function done(r) { clearTimeout(t); waiting = null; res(r); }
      waiting = done;
      if (!MP.send({ t: "nick", nick: c.nick })) done({ ok: false, why: "Нет связи с сервером — попробуй ещё раз" });
    }).then(function (r) { if (r.ok && r.nick) apply(r.nick); return r; });
  }
  FC.on("mp:nick", function (m) {
    if (waiting) waiting({ ok: !!m.ok, nick: m.nick, why: m.why, wait: m.wait });
    else if (m.ok && m.nick) apply(m.nick);                // ответ после ожидания — всё равно записан на сервере
  });
  // что записано на сервере: есть — берём (другое устройство, вход в аккаунт); копию с устройства сервер не принял —
  // снимаем её и спросим снова; ник, выбранный без связи уже после hi, — отправляем сейчас
  FC.on("mp:on", function (w) {
    if (!w || !("name" in w)) return;                      // старый сервер без ников
    if (w.name) { if (w.name !== name) apply(w.name); else { ask.done = 1; saveAsk(); } }
    else if (name && hiSent === name) {
      var bad = name;
      apply(null); ask.done = 0; ask.no = 0; saveAsk();
      if (FC.hud) FC.hud.toast("Ник «" + bad + "» не прошёл проверку — выбери другой", "bad", 4);
    } else if (name) {
      var keep = name; name = null;
      set(keep).then(function (r) { if (!r.ok) { apply(null); ask.done = 0; saveAsk(); } });
    }
    hiSent = null;
  });
  FC.on("me", function (me) { if (name && me) me.label = name; });

  /* ---- лист с полем ввода ------------------------------------------------------------------------------------------ */
  var sheet = null, box, input, errEl, saveBtn, from = null, prevInput = true;
  function build() {
    sheet = document.createElement("div");
    sheet.className = "nk-sheet ui"; sheet.setAttribute("data-ui", "1");
    sheet.innerHTML = "<div class='nk-bg'></div><form class='nk-box' role='dialog' aria-modal='true' aria-labelledby='nk-h' novalidate>" +
      "<b id='nk-h'>Как тебя зовут в городе?</b><p>Ник увидят другие игроки: над головой, в «Онлайн» и рейтингах.</p>" +
      "<input type='text' name='nick' maxlength='" + MAX + "' autocomplete='nickname' autocapitalize='words' autocorrect='off' " +
      "spellcheck='false' enterkeyhint='done' placeholder='Например, Огонёк' aria-label='Ник'>" +
      "<div class='nk-err' aria-live='polite'></div>" +
      "<div class='nk-btns'><button type='button' class='nk-later'>Потом</button><button type='submit' class='nk-save'>Сохранить</button></div></form>";
    document.body.appendChild(sheet);
    box = sheet.querySelector(".nk-box"); input = sheet.querySelector("input");
    errEl = sheet.querySelector(".nk-err"); saveBtn = sheet.querySelector(".nk-save");
    sheet.querySelector(".nk-bg").addEventListener("click", function () { close(true); });
    sheet.querySelector(".nk-later").addEventListener("click", function () { close(true); });
    box.addEventListener("submit", function (e) { e.preventDefault(); submit(); });
    input.addEventListener("input", function () {
      var c = check(input.value);
      errEl.className = "nk-err"; errEl.textContent = input.value.trim() && !c.nick ? c.why : "";
    });
  }
  // клавиши, пока лист открыт: Esc — закрыть, Enter — сохранить; игре и телефону/паузе — ничего (ловим раньше них)
  function onKey(e) {
    if (e.isComposing || e.keyCode === 229) return;          // набор через IME — Enter выбирает слово
    if (e.key === "Escape") { e.preventDefault(); close(true); }
    else if (e.key === "Enter") { e.preventDefault(); submit(); }
    e.stopPropagation();
  }
  // экранная клавиатура: видимая область меньше окна — держим лист в ней (iOS Safari, Android, Telegram)
  function fit() {
    if (!sheet || !sheet.classList.contains("on")) return;
    var vv = global.visualViewport, h = vv ? vv.height : global.innerHeight, top = vv ? vv.offsetTop : 0;
    sheet.style.setProperty("--nk-top", Math.max(0, top) + "px");
    sheet.style.setProperty("--nk-h", h + "px");
    box.classList.toggle("tight", h < 300);
  }
  if (global.visualViewport) {
    global.visualViewport.addEventListener("resize", fit);
    global.visualViewport.addEventListener("scroll", fit);
  }
  global.addEventListener("resize", fit);

  function open(src) {
    if (!sheet) build();
    hideCard(false);
    from = src || null;
    prevInput = !FC.input || FC.input.enabled !== false;
    if (FC.input) { FC.input.enable(false); FC.input.unlock(); }
    input.value = name || "";
    errEl.className = "nk-err"; errEl.textContent = "";
    saveBtn.disabled = false;
    sheet.classList.add("on");
    fit();
    global.addEventListener("keydown", onKey, true);
    input.focus();                                           // в обработчике тапа — iOS покажет клавиатуру
    try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) { /* старый браузер */ }
  }
  function close(refused) {
    if (!sheet || !sheet.classList.contains("on")) return;
    sheet.classList.remove("on");
    global.removeEventListener("keydown", onKey, true);
    if (input) input.blur();
    if (FC.input && prevInput && !FC.paused && !document.querySelector("#phone.on")) FC.input.enable(true);
    if (refused && from === "ask" && !name) refuse();
    from = null;
  }
  function submit() {
    if (saveBtn.disabled) return;
    var c = check(input.value);
    if (!c.nick) { errEl.className = "nk-err"; errEl.textContent = c.why; return; }
    saveBtn.disabled = true;
    errEl.className = "nk-err ok"; errEl.textContent = "Сохраняю…";
    set(c.nick).then(function (r) {
      saveBtn.disabled = false;
      if (!r.ok) { errEl.className = "nk-err"; errEl.textContent = r.why || "Не получилось"; return; }
      close(false);
      if (FC.hud) FC.hud.toast(r.local ? "Ник «" + r.nick + "» сохранён — другие увидят его в онлайне" : "Теперь ты — " + r.nick, "ok", 3);
      if (FC.fx && FC.fx.haptic) FC.fx.haptic("light");
    });
  }

  /* ---- первый заход: карточка-приглашение -------------------------------------------------------------------------- */
  var card = null, cardT = 0;
  function want() {
    if (name || ask.done || FC.gsOff()) return false;
    if ((ask.no | 0) >= ASK_MAX) {                         // дважды «Потом» — неделю молчим, потом спросим снова
      if (Date.now() - (ask.at || 0) < ASK_PAUSE) return false;
      ask.no = 0; saveAsk();
    }
    return true;
  }
  function refuse() { ask.no = (ask.no | 0) + 1; ask.at = Date.now(); saveAsk(); }
  function quiet() {
    if (!FC.started || FC.paused || document.hidden) return false;
    if (FC.input && FC.input.enabled === false) return false;              // диалог, телефон, карта, награда за вход…
    if (FC.hud && FC.hud.inDialog && FC.hud.inDialog()) return false;
    if (FC.story && FC.story.busy && FC.story.busy()) return false;         // идёт задание — не отвлекаем
    // полоса уведомлений: плашка района, сообщение Макса, большие надписи — ждём, пока уйдут
    return !document.querySelector("#hud .notes .note:not(.bye), #hud .areacard.on, #hud .big.on, .pg-day, .mi-card, .fs-card");
  }
  function showCard() {
    var host = document.querySelector("#hud .notes") || document.getElementById("hud");
    if (!host || card) return;
    card = document.createElement("div");
    card.className = "nk-card"; card.setAttribute("data-ui", "1"); card.setAttribute("role", "button");
    var guest = !FC.me || FC.me.guest;
    card.innerHTML = "<div class='ni'>🪪</div><div><b>Как тебя зовут в городе?</b><p>Назовись — ник увидят другие игроки" +
      (guest ? " вместо «Гость»." : " над тобой и в рейтингах.") + "</p>" +
      "<div class='nk-b'><button type='button' class='y'>Назваться</button><button type='button' class='n'>Потом</button></div></div>";
    host.insertBefore(card, host.firstChild);
    card.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest(".n")) { e.stopPropagation(); hideCard(true); return; }
      open("ask");
    });
    if (FC.audio) FC.audio.play("note");
    shows++;
    cardT = setTimeout(function () { hideCard(false); later(); }, CARD_SEC * 1000);   // не заметил — не отказ, спросим позже
  }
  function hideCard(refused) {
    if (!card) return;
    clearTimeout(cardT);
    var el = card; card = null;
    el.classList.add("bye"); setTimeout(function () { el.remove(); }, 400);
    if (refused) refuse();
  }
  var shows = 0;
  function later() { if (shows < ASK_SHOWS) setTimeout(function () { look(ASK_AGAIN - ASK_AT); }, ASK_AGAIN * 1000); }
  FC.on("start", function () { look(0); });
  function look(skip) {
    if (!want()) return;
    var t0 = performance.now() - skip * 1000, still = 0, lx = null, lz = null;
    (function tick() {
      if (!want() || card || (sheet && sheet.classList.contains("on"))) return;
      var t = (performance.now() - t0) / 1000;
      if (t > ASK_GIVEUP) { shows++; later(); return; }      // тихой минуты так и не нашлось — попробуем позже
      var P = FC.player;
      if (P) { still = lx != null && Math.hypot(P.x - lx, P.z - lz) < 0.4 ? still + 0.5 : 0; lx = P.x; lz = P.z; }
      // тихо (никаких сообщений и заданий) и стоит — сразу; через минуту — уже просто без диалога, телефона и паузы:
      // розыск, сообщения и задание не должны откладывать вопрос навсегда
      var ok = quiet() && (still >= 1.5 || t >= ASK_LATE) || t >= ASK_LATE * 2 && calm();
      if (t >= ASK_AT && FC.mp && FC.mp.connected && ok) { showCard(); return; }
      setTimeout(tick, 500);
    })();
  }
  function calm() {
    return FC.started && !FC.paused && !document.hidden && !(FC.input && FC.input.enabled === false) && !(FC.hud && FC.hud.inDialog && FC.hud.inDialog());
  }

  /* ---- где сменить: пауза и «Настройки» телефона (fhud.js зовёт pause:open и phone:settings) ------------------- */
  function rowHtml() {
    return "Ник: <b>" + (name ? esc(name) : "не выбран") + "</b> · <button type='button' class='nk-edit'>" + (name ? "Изменить" : "Назваться") + "</button>";
  }
  FC.on("pause:open", function (card0) {
    var p = card0 && card0.querySelector("p");
    if (!p) return;
    p.className = "nk-row"; p.innerHTML = rowHtml();
    p.querySelector(".nk-edit").addEventListener("click", function () { open("pause"); });
  });
  FC.on("phone:settings", function (list) {
    if (!list) return;
    var row = document.createElement("div"); row.className = "row";
    row.innerHTML = "<span>" + rowHtml().replace(" · <button", "</span><button");
    list.insertBefore(row, list.firstChild);
    row.querySelector(".nk-edit").addEventListener("click", function () { open("settings"); });
  });
  FC.on("nick", function () {
    document.querySelectorAll(".nk-row").forEach(function (p) {
      p.innerHTML = rowHtml();
      p.querySelector(".nk-edit").addEventListener("click", function () { open("pause"); });
    });
  });

  FC.nick = {
    name: function () { return name; },
    open: function () { open("menu"); },
    set: set, check: check,
    forHi: function () { hiSent = name; return name; }      // fmp.js: копия с устройства в hi
  };
})(window);
