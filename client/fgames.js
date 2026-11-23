/* Флейм-Сити — мини-игры работ (FC.games). Игрок — ИИ-агент, и работа его — то, что умеют агенты города:
 * разобрать заявку и отправить её в нужное «здание» (умение), смонтировать ролик в такт, поймать кадр, перевести,
 * отличить правду от фейка; «hack» — терминал для сюжета.
 *
 *   FC.games.run(id, opt) → Promise<{ok, score, ratio, pay, quit}>
 *     id: "tasks" | "montage" | "photo" | "type" | "hack" (= "source")
 *     opt: {title, sub, icon, pay (база оплаты, $), level (1..10), time (с), variant ("translate"|"news" у type),
 *           rounds (у hack), zone (ключ зоны — тема заявок)}
 * Деньги модуль НЕ начисляет: оплату (pay) добавляет вызывающий через FC.money. Оверлей — полноэкранный .mg
 * (finput не ловит в нём тач-джойстик), ввод игрока на время игры выключен. Тач и клавиатура: 1–4, пробел, Enter, ←/→.
 */
(function (global) {
  "use strict";
  var FC = global.FC;

  FC.css([
    ".mg{position:fixed;inset:0;z-index:12;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 40%,rgba(40,30,70,.8),rgba(5,8,18,.92));animation:mgIn .25s ease-out;touch-action:none}",
    "@keyframes mgIn{from{opacity:0}to{opacity:1}}",
    ".mg-card{position:relative;width:min(760px,96vw);max-height:96vh;display:flex;flex-direction:column;background:linear-gradient(170deg,rgba(24,28,52,.97),rgba(12,14,30,.97));border:1px solid rgba(255,207,122,.35);border-radius:22px;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.04) inset;padding:14px 16px 16px;color:#f6efe2;overflow:hidden}",
    ".mg-head{display:flex;align-items:center;gap:12px}",
    ".mg-ico{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;font-size:24px;background:linear-gradient(135deg,#ffcf7a,#ff8a3d);box-shadow:0 6px 18px rgba(255,140,50,.35);flex:none}",
    ".mg-head b{display:block;font:800 18px/1.15 Georgia,serif;color:#fff}.mg-head i{font-style:normal;font-size:12px;color:rgba(255,240,215,.65)}",
    ".mg-x{margin-left:auto;width:36px;height:36px;border-radius:12px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#fff;font-size:16px;cursor:pointer;flex:none}",
    ".mg-bar{height:6px;border-radius:4px;background:rgba(255,255,255,.08);margin:12px 0 8px;overflow:hidden}",
    ".mg-bar i{display:block;height:100%;width:100%;background:linear-gradient(90deg,#ffcf7a,#ff8a3d);transition:width .12s linear}",
    ".mg-bar.hurry i{background:linear-gradient(90deg,#ff5d6c,#ff9a9a)}",
    ".mg-stats{display:flex;gap:10px;align-items:baseline;font:700 14px system-ui;min-height:22px}",
    ".mg-score{font:800 22px system-ui;color:#9dffbf}.mg-combo{color:#ffcf7a}.mg-time{margin-left:auto;color:rgba(255,255,255,.75)}",
    ".mg-body{position:relative;flex:1;min-height:0;margin-top:8px;overflow-y:auto;overflow-x:hidden}",
    ".mg-hint{margin-top:8px;text-align:center;font-size:12px;color:rgba(255,240,215,.55);min-height:16px}",
    ".mg-intro{text-align:center;padding:18px 6px 6px}.mg-intro p{margin:0 auto 16px;max-width:460px;font-size:15px;line-height:1.45;color:rgba(255,245,230,.85)}",
    ".mg-intro ul{list-style:none;margin:0 auto 18px;padding:0;max-width:420px;text-align:left;font-size:14px;color:rgba(255,245,230,.75)}.mg-intro li{margin:5px 0}.mg-intro li b{color:#ffcf7a}",
    ".mg-go{display:inline-block;border:0;border-radius:16px;padding:14px 34px;font:800 17px system-ui;background:linear-gradient(90deg,#ffcf7a,#ff8a3d);color:#2a1205;cursor:pointer;box-shadow:0 10px 30px rgba(255,140,50,.35)}",
    ".mg-go:disabled{opacity:.4;cursor:default;box-shadow:none}",
    ".mg-go.ghost{background:rgba(255,255,255,.08);color:#fff;box-shadow:none;border:1px solid rgba(255,255,255,.18);margin-left:8px}",
    ".mg-res{text-align:center;padding:10px 6px}.mg-res .rst{font-size:42px;letter-spacing:6px;color:#ffcf7a;text-shadow:0 0 18px rgba(255,190,90,.5)}.mg-res .rst i{font-style:normal;color:rgba(255,255,255,.15)}",
    ".mg-res h3{margin:6px 0 2px;font:800 italic 30px Georgia,serif;color:#fff}.mg-res .pay{font:800 28px system-ui;color:#9dffbf;margin:8px 0 16px}.mg-res .pay.no{color:#ff6b7a;font-size:18px}",
    ".mg-res .rows{display:flex;gap:8px;justify-content:center;margin:12px 0}.mg-res .rows div{background:rgba(255,255,255,.06);border-radius:12px;padding:8px 12px;font-size:11px;color:rgba(255,245,230,.6)}.mg-res .rows b{display:block;font:700 18px system-ui;color:#fff}",
    ".mg-flash{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);font:800 italic 30px Georgia,serif;pointer-events:none;text-shadow:0 3px 12px rgba(0,0,0,.6);animation:mgPop .55s ease-out forwards}",
    "@keyframes mgPop{0%{opacity:0;transform:translate(-50%,-30%) scale(.6)}25%{opacity:1;transform:translate(-50%,-50%) scale(1.08)}100%{opacity:0;transform:translate(-50%,-80%) scale(1)}}",
    ".mg-shake{animation:mgShake .3s}@keyframes mgShake{25%{transform:translateX(-8px)}50%{transform:translateX(7px)}75%{transform:translateX(-4px)}}",
    /* задачи агента */
    ".tk-req{display:flex;gap:12px;align-items:center;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);border-radius:18px;padding:14px;min-height:92px}",
    ".tk-ava{width:56px;height:56px;border-radius:50%;flex:none;display:grid;place-items:center;font-size:30px;background:radial-gradient(circle at 40% 35%,#5a4a8a,#1c1f3a)}",
    ".tk-req b{display:block;font-size:12px;color:#ffcf7a;letter-spacing:.04em}.tk-req p{margin:3px 0 0;font:600 18px/1.3 system-ui;color:#fff}",
    ".tk-urg{display:inline-block;margin-left:6px;font:700 10px system-ui;padding:2px 6px;border-radius:8px;background:#ff3b5c;color:#fff;vertical-align:middle}",
    ".tk-clock{height:4px;border-radius:3px;background:rgba(255,255,255,.08);margin:8px 2px 12px;overflow:hidden}.tk-clock i{display:block;height:100%;background:#7dffb0}",
    ".tk-opts{display:grid;grid-template-columns:1fr 1fr;gap:10px}",
    ".tk-opt{display:flex;align-items:center;gap:10px;text-align:left;border:1px solid rgba(255,207,122,.25);background:rgba(255,255,255,.05);color:#fff;border-radius:16px;padding:12px;cursor:pointer;font:600 14px/1.2 system-ui;min-height:64px;transition:transform .08s,background .15s}",
    ".tk-opt:active{transform:scale(.97)}.tk-opt span{font-size:26px;flex:none}.tk-opt small{display:block;font-weight:400;font-size:11px;color:rgba(255,255,255,.5);margin-top:2px}",
    ".tk-opt kbd{margin-left:auto;flex:none;opacity:.7}.tk-opt.good{background:rgba(80,255,160,.25);border-color:#7dffb0}.tk-opt.bad{background:rgba(255,80,100,.25);border-color:#ff6b7a}",
    /* канвасы */
    ".mg-cv{display:block;width:100%;border-radius:16px;background:#0a0d1c;touch-action:none;cursor:pointer}",
    ".mg-strip{display:flex;gap:6px;justify-content:center;margin-top:8px;min-height:46px}.mg-strip canvas{width:60px;height:45px;border-radius:6px;border:2px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,.4);animation:mgIn .3s}",
    ".mg-snap{display:block;margin:10px auto 0;width:74px;height:74px;border-radius:50%;border:4px solid #fff;background:radial-gradient(circle,#ff5d6c 55%,#c22 56%);cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.4)}",
    /* перевод и новости */
    ".ty-word{text-align:center;padding:18px 8px 8px}.ty-word small{display:block;font-size:12px;color:rgba(255,240,215,.6);letter-spacing:.08em;text-transform:uppercase}",
    ".ty-word b{display:block;font:800 34px/1.2 Georgia,serif;color:#fff;margin-top:6px}.ty-word.news b{font:700 22px/1.35 system-ui}",
    ".ty-opts{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px}.ty-opts.two{grid-template-columns:1fr 1fr}",
    ".ty-opts button{border:1px solid rgba(255,207,122,.3);background:rgba(255,255,255,.06);color:#fff;border-radius:16px;padding:16px 8px;font:700 17px system-ui;cursor:pointer;overflow-wrap:anywhere}",
    ".ty-opts button.good{background:rgba(80,255,160,.28);border-color:#7dffb0}.ty-opts button.bad{background:rgba(255,80,100,.28);border-color:#ff6b7a}",
    ".ty-in{display:block;width:min(320px,90%);margin:12px auto 0;padding:10px 14px;border-radius:12px;border:1px solid rgba(255,207,122,.35);background:rgba(0,0,0,.35);color:#fff;font:600 17px system-ui;text-align:center;outline:none;-webkit-user-select:text;user-select:text}",
    /* терминал */
    ".hk{position:relative;display:flex;justify-content:space-between;padding:6px 4px;font-family:ui-monospace,Menlo,monospace}",
    ".hk-col{display:flex;flex-direction:column;gap:10px;z-index:1}",
    ".hk-n{width:clamp(64px,18vw,96px);height:46px;border-radius:12px;border:1px solid rgba(125,255,176,.35);background:rgba(10,30,22,.85);color:#9dffbf;font-size:22px;cursor:pointer;display:grid;place-items:center;transition:transform .1s}",
    ".hk-n.sel{border-color:#ffcf7a;box-shadow:0 0 14px rgba(255,207,122,.6);transform:scale(1.06)}.hk-n.done{opacity:.45;border-color:#7dffb0;cursor:default}",
    ".hk svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}",
    ".hk-log{margin-top:10px;height:46px;overflow:hidden;font:12px/1.3 ui-monospace,Menlo,monospace;color:rgba(125,255,176,.75)}",
    "@media (max-width:560px){.mg-card{padding:12px 12px 14px;border-radius:18px}.tk-opts{grid-template-columns:1fr}.tk-opt{min-height:54px;padding:10px}.tk-req p{font-size:16px}.ty-word b{font-size:28px}.mg-head b{font-size:16px}.ty-opts button{font-size:14px;padding:14px 4px}.ty-word.news b{font-size:19px}.mg-intro p{font-size:14px}}"
  ].join("\n"));

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return FC.hud && FC.hud.esc ? FC.hud.esc(s) : String(s); }
  function shuffle(a, r) { r = r || Math.random; for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function snd(n) { if (FC.audio && FC.audio.play) FC.audio.play(n); }
  function touch() { return !!(FC.input && FC.input.touch) || FC.mobile; }

  /* ---- оболочка: шапка, полоса времени, счёт, тело, вступление и итог --------------------------------------- */
  var running = null;
  function shell(o) {
    var root = el("div", "mg");
    var card = el("div", "mg-card");
    card.innerHTML = "<div class='mg-head'><span class='mg-ico'>" + o.icon + "</span><div><b>" + esc(o.title) + "</b><i>" + esc(o.sub || "") +
      "</i></div><button type='button' class='mg-x' aria-label='Уйти'>✕</button></div><div class='mg-bar'><i></i></div>" +
      "<div class='mg-stats'><span class='mg-score'></span><span class='mg-combo'></span><span class='mg-time'></span></div><div class='mg-body'></div><div class='mg-hint'></div>";
    root.appendChild(card); document.body.appendChild(root);
    var q = function (s) { return card.querySelector(s); };
    var api = {
      root: root, card: card, body: q(".mg-body"), keys: [],
      time: function (frac, sec) {
        q(".mg-bar i").style.width = FC.clamp(frac, 0, 1) * 100 + "%";
        q(".mg-bar").classList.toggle("hurry", sec != null && sec < 8);
        q(".mg-time").textContent = sec == null ? "" : "⏱ " + Math.max(0, Math.ceil(sec));
      },
      score: function (n) { q(".mg-score").textContent = n == null ? "" : n.toLocaleString("ru-RU"); },
      combo: function (t) { q(".mg-combo").textContent = t || ""; },
      hint: function (t) { q(".mg-hint").textContent = t || ""; },
      flash: function (text, color) {
        var f = el("div", "mg-flash", esc(text)); f.style.color = color || "#ffcf7a";
        api.body.appendChild(f); setTimeout(function () { f.remove(); }, 600);
      },
      shake: function () { card.classList.remove("mg-shake"); void card.offsetWidth; card.classList.add("mg-shake"); },
      onKey: function (fn) { api.keys.push(fn); },
      quit: null,
      close: function () { root.style.opacity = "0"; root.style.transition = "opacity .2s"; setTimeout(function () { root.remove(); }, 220); }
    };
    q(".mg-x").addEventListener("click", function () { if (api.quit) api.quit(); });
    function onKey(e) {
      if (e.code === "Escape") { if (api.quit) api.quit(); return; }
      for (var i = 0; i < api.keys.length; i++) if (api.keys[i](e) === true) { e.preventDefault(); e.stopPropagation(); return; }
    }
    global.addEventListener("keydown", onKey, true);
    api.unbind = function () { global.removeEventListener("keydown", onKey, true); };
    return api;
  }
  function intro(api, text, rules, go) {
    api.body.innerHTML = "<div class='mg-intro'><p>" + text + "</p><ul>" + rules.map(function (r) { return "<li>" + r + "</li>"; }).join("") +
      "</ul><button type='button' class='mg-go'>Начать</button></div>";
    api.hint(touch() ? "" : "Enter — начать, Esc — уйти");
    var started = false;
    function start() { if (started) return; started = true; api.keys.length = 0; api.hint(""); api.body.innerHTML = ""; go(); }
    api.body.querySelector(".mg-go").addEventListener("click", start);
    api.onKey(function (e) { if (e.code === "Enter" || e.code === "Space") { start(); return true; } });
  }
  function stars(r) { var n = r >= 0.95 ? 3 : r >= 0.65 ? 2 : r >= 0.35 ? 1 : 0, s = ""; for (var i = 0; i < 3; i++) s += i < n ? "★" : "<i>★</i>"; return s; }
  function result(api, o, ratio, rows, finish) {
    var ok = ratio >= 0.35;
    var pay = ok ? Math.round((o.pay || 0) * FC.clamp(0.3 + ratio * 1.05, 0.3, 1.45)) : 0;
    var title = ratio >= 0.95 ? "Блестяще!" : ratio >= 0.65 ? "Отлично" : ok ? "Сойдёт" : "Не вышло";
    api.time(0, null); api.combo(""); api.hint("");
    api.body.innerHTML = "<div class='mg-res'><div class='rst'>" + stars(ratio) + "</div><h3>" + title + "</h3>" +
      "<div class='rows'>" + rows.map(function (r) { return "<div><b>" + esc(r[1]) + "</b>" + esc(r[0]) + "</div>"; }).join("") + "</div>" +
      (o.pay ? "<div class='pay" + (ok ? "" : " no") + "'>" + (ok ? "+" + FC.fmtMoney(pay) : "Заказчик недоволен — без оплаты") + "</div>" : "") +
      "<button type='button' class='mg-go'>" + (ok && o.pay ? "Забрать" : "Готово") + "</button></div>";
    snd(ok ? "mission" : "fail");
    // Итог не закрывается первые 0,9 с: пробел, нажатый в конце монтажа, иначе пролистывал его невиданным.
    var done = false, readyAt = performance.now() + 900;
    function end() {
      if (done || performance.now() < readyAt) return;
      done = true; finish({ ok: ok, score: Math.round(ratio * 1000), ratio: ratio, pay: pay, quit: false });
    }
    api.body.querySelector(".mg-go").addEventListener("click", end);
    api.keys.length = 0;
    api.onKey(function (e) { if (e.code === "Enter" || e.code === "Space") { end(); return true; } });
  }

  /* Таймер на requestAnimationFrame: tick(dt, now) зовётся, пока не вернёт false или не вызван stop().
     Шаг — настоящее время (потолок 1 с — только от провала, когда вкладку уводили в фон), а не 0,05 с, как у мира:
     на слабом телефоне кадр бывает длинным, и с потолком мира 60 секунд смены тянулись бы минутами. */
  function loop(tick) {
    var last = performance.now(), alive = true;
    function f(now) {
      if (!alive) return;
      var dt = Math.min(1, (now - last) / 1000); last = now;
      if (tick(dt, now) === false) { alive = false; return; }
      requestAnimationFrame(f);
    }
    requestAnimationFrame(f);
    return function () { alive = false; };
  }

  /* ---- заявки людей: по зданиям-зонам мира (одно знание — FC.map.zones, имена — data/zones.js) ---------- */
  var REQ = {
    foto34: ["Фото на визу в США — по стандарту", "Нужно фото 3×4 на пропуск", "Фото на паспорт без очереди"],
    photoshoot: ["Фотосессию 3×3 из моего селфи", "Хочу обложку как у глянцевого журнала", "Образы для профиля в соцсетях"],
    restore: ["Оживи старое фото бабушки", "Сделай фото чётче — оно мутное", "Портрет трёх поколений"],
    retouch: ["Убери прохожего с фотографии", "Сделай прозрачный фон у товара", "Поправь свет на снимке"],
    interior: ["Покажи, как будет выглядеть ремонт", "Новый интерьер кухни по фото"],
    salon: ["Подойдёт ли мне каре? Примерь", "Хочу увидеть себя блондинкой"],
    art: ["Нарисуй меня в стиле аниме", "Карикатуру на друга к юбилею"],
    effects: ["Трендовый эффект для видео из фото", "Сделай вирусный эффект для сторис"],
    shoot: ["Сними видео-обложку для канала", "Нарисуй картинку для поста"],
    cut: ["Смонтируй ролик из 12 кусков", "Добавь субтитры к интервью", "Склей влог из отпуска"],
    reels: ["Сделай рилс из моих сторис", "AI-монтаж рилса с музыкой"],
    queue: ["Сколько ещё ждать рендер?"],
    view: ["Разбери мои снимки — что не так?", "Посмотри ролик и дай отзыв"],
    mail: ["Разбери почту и поставь встречи", "Найди файл на диске и пришли"],
    gallery: ["Посмотри профили конкурентов", "Что сейчас залетает в рилсах?"],
    chat: ["Собери бота для записи клиентов", "Ответь в чате, пока я в самолёте"],
    web: ["Сверстай лендинг для кофейни", "Выложи сайт-визитку за вечер"],
    notes: ["Заведи базу клиентов", "Собери заметки в одну страницу"],
    deck: ["Презентация для инвестора на 10 слайдов", "Слайды к защите диплома"],
    office: ["Напомни про созвон в 10:00", "Утренняя сводка: что у меня сегодня"],
    memory: ["Запомни мой бренд-бук", "Как я люблю, чтобы мне писали?"],
    agency: ["Карусель для поста про скидки", "Сценарий рилса для салона", "Разбери конкурентов и клиентов"],
    bank: ["Посчитай расходы за месяц", "Какой сейчас курс доллара?", "График выручки по неделям"],
    notary: ["Проверь договор аренды", "Подготовь доверенность"],
    news: ["Это правда или фейк?", "Главное из чатов за день"],
    translate: ["Переведи договор на английский", "Голосовое в текст, пожалуйста", "Суть письма в 3 строки"],
    concierge: ["Найди мастера маникюра рядом", "Где выгоднее купить кроссовки?"],
    library: ["Найди ответ: почему небо синее?", "Что пишут про новый закон?"],
    scout: ["Собери блогеров по теме фитнеса", "Выгрузи комментарии под постом"],
    forge: ["Напиши скрипт для таблицы", "Собери документ из черновиков"],
    school: ["Реши задачу по фото", "Перепиши конспект с доски"],
    lab: ["Сколько калорий в тарелке?", "Разбери состав крема"],
    print: ["Сделай QR-код на меню", "Пригласительные на свадьбу в PDF"],
    skills: ["Научи агента новому умению"],
    toys: ["3D-фигурку меня в коробке"],
    stickers: ["Стикерпак из моих фото"],
    baby: ["Каким будет наш малыш?"],
    voice: ["Озвучь текст приятным голосом", "Голосом поставь задачу агенту"]
  };
  var FALLBACK_ZONES = [
    { key: "cut", name: "Монтажная", emoji: "🎬", sub: "собирают ролики и субтитры" },
    { key: "foto34", name: "Фото на документы", emoji: "📇", sub: "паспорт, виза, пропуск" },
    { key: "web", name: "Сайты", emoji: "🌐", sub: "верстают и выкладывают сайты" },
    { key: "deck", name: "Презентации", emoji: "📊", sub: "собирают слайды" },
    { key: "translate", name: "Бюро переводов", emoji: "🌍", sub: "переводы, суть в 3 строки" },
    { key: "bank", name: "Банк", emoji: "🏦", sub: "курсы валют, расходы, таблицы" },
    { key: "reels", name: "Рилс-студия", emoji: "📱", sub: "AI-монтаж рилсов" }
  ];
  function zoneList() {
    var z = FC.map && FC.map.zones, out = [];
    if (z) Object.keys(z).forEach(function (k) {
      var B = z[k];
      if (k === "queue" || k === "square") return;
      out.push({ key: k, name: B.name, emoji: B.emoji || "🏢", sub: B.sub || "" });
    });
    return out.length >= 4 ? out : FALLBACK_ZONES;
  }
  var CLIENTS = ["👩‍💼", "🧑‍🎤", "👨‍🍳", "👩‍🎨", "🧑‍💻", "👵", "🧔", "👩‍🏫", "🧑‍🚀", "👨‍🔧", "💃", "🕺"];
  function makeRequest(zones, prefer) {
    var pick = prefer && Math.random() < 0.35 ? zones.filter(function (z) { return z.key === prefer; })[0] : null;
    var z = pick || zones[Math.floor(Math.random() * zones.length)];
    var list = REQ[z.key];
    var text = list ? list[Math.floor(Math.random() * list.length)] : "Нужно: " + (z.sub || z.name);
    var others = shuffle(zones.filter(function (q) { return q.key !== z.key; })).slice(0, 3);
    return { zone: z, text: text, client: CLIENTS[Math.floor(Math.random() * CLIENTS.length)], urgent: Math.random() < 0.2, opts: shuffle([z].concat(others)) };
  }

  /* ---- 1. «Задачи агента»: заявку — в нужное здание ----------------------------------------------------------- */
  function gTasks(api, o, finish) {
    var zones = zoneList(), T = o.time || 60, left = T, score = 0, combo = 0, solved = 0, wrong = 0, best = 0;
    var cur = null, reqT = 0, REQ_T = Math.max(5, 9 - (o.level || 1) * 0.35), lock = false, stop = null;
    function next() {
      cur = makeRequest(zones, o.zone); reqT = REQ_T; lock = false;
      api.body.innerHTML = "<div class='tk-req'><div class='tk-ava'>" + cur.client + "</div><div><b>ЗАЯВКА ОТ ЧЕЛОВЕКА" +
        (cur.urgent ? "<span class='tk-urg'>СРОЧНО ×2</span>" : "") + "</b><p>«" + esc(cur.text) + "»</p></div></div>" +
        "<div class='tk-clock'><i></i></div><div class='tk-opts'>" + cur.opts.map(function (z, i) {
          return "<button type='button' class='tk-opt' data-i='" + i + "'><span>" + z.emoji + "</span><div>" + esc(z.name) + "<small>" + esc(z.sub) + "</small></div>" + (touch() ? "" : "<kbd>" + (i + 1) + "</kbd>") + "</button>";
        }).join("") + "</div>";
      api.body.querySelectorAll(".tk-opt").forEach(function (b) { b.addEventListener("click", function () { choose(+b.dataset.i); }); });
    }
    function choose(i) {
      if (lock || !cur || !cur.opts[i]) return;
      lock = true;
      var btn = api.body.querySelectorAll(".tk-opt")[i];
      if (cur.opts[i].key === cur.zone.key) {
        combo++; best = Math.max(best, combo); solved++;
        var pts = Math.round((100 + 50 * reqT / REQ_T) * Math.min(2, 1 + combo * 0.1) * (cur.urgent ? 2 : 1));
        score += pts; btn.classList.add("good"); api.flash("+" + pts, "#9dffbf"); snd("cash");
      } else {
        combo = 0; wrong++; left -= 3; btn.classList.add("bad"); api.shake(); api.flash("Не то здание! −3 с", "#ff6b7a"); snd("fail");
        api.body.querySelectorAll(".tk-opt").forEach(function (b, k) { if (cur.opts[k].key === cur.zone.key) b.classList.add("good"); });
      }
      api.score(score); api.combo(combo > 1 ? "комбо ×" + combo : "");
      setTimeout(next, 420);
    }
    api.onKey(function (e) { var m = /^Digit([1-4])$|^Numpad([1-4])$/.exec(e.code); if (m) { choose(+(m[1] || m[2]) - 1); return true; } });
    api.score(0); next();
    stop = loop(function (dt) {
      left -= dt; if (!lock) reqT -= dt;
      api.time(left / T, left);
      var c = api.body.querySelector(".tk-clock i"); if (c) c.style.width = FC.clamp(reqT / REQ_T, 0, 1) * 100 + "%";
      if (reqT <= 0 && !lock) { lock = true; combo = 0; wrong++; api.flash("Заявка ушла к другому", "#ff9a6b"); api.combo(""); setTimeout(next, 380); }
      if (left <= 0) {
        stop();
        var target = 1200 + (o.level || 1) * 60;
        result(api, o, Math.min(1.3, score / target), [["выполнено", solved], ["ошибки", wrong], ["лучшее комбо", best]], finish);
        return false;
      }
    });
    return function () { if (stop) stop(); };
  }

  /* ---- 2. Монтажная: режь ролик в такт ------------------------------------------------------------------------ */
  var CAPTIONS = ["Как я", "сделал", "рилс", "за 5 минут", "без", "монтажёра", "и камеры", "— агент", "сам", "нарезал", "всё", "в такт", "🔥"];
  function gMontage(api, o, finish) {
    var lvl = o.level || 1, bpm = 100 + lvl * 4, beat = 60 / bpm;
    var marks = [], t0 = 1.6, i, k = 0;
    for (i = 0; k < 22; i++) {
      if (i > 2 && Math.random() < 0.18) continue;
      marks.push({ t: t0 + i * beat * (Math.random() < 0.15 ? 0.5 : 1), hit: false, grade: null }); k++;
    }
    marks.sort(function (a, b) { return a.t - b.t; });
    var END = marks[marks.length - 1].t + 1.4;
    var cv = el("canvas", "mg-cv"); api.body.appendChild(cv);
    var ctx = cv.getContext("2d"), W = 0, H = 0, dpr = Math.min(global.devicePixelRatio || 1, 2);
    function size() { W = cv.clientWidth; H = Math.round(Math.min(W * 0.62, global.innerHeight * 0.55)); cv.style.height = H + "px"; cv.width = W * dpr; cv.height = H * dpr; }
    size();
    var COLORS = ["#ff5d8f", "#6bd5ff", "#ffcf7a", "#a77bff", "#41e0c8", "#ff8a3d", "#9dff8a"];
    var wave = []; for (i = 0; i < 400; i++) wave.push(0.25 + Math.random() * 0.75 * (i % 4 === 0 ? 1 : 0.6));
    var t = 0, score = 0, combo = 0, best = 0, hits = 0, perfect = 0, miss = 0, lastGrade = "", gradeT = 0, capI = 0;
    var PPS = 0;          // пикселей в секунду
    function cut() {
      var bestM = null, bd = 1;
      marks.forEach(function (m) { if (!m.hit && Math.abs(m.t - t) < bd) { bd = Math.abs(m.t - t); bestM = m; } });
      if (bestM && bd < 0.22) {
        bestM.hit = true;
        var g = bd < 0.06 ? ["Идеально", 100, "#9dffbf"] : bd < 0.12 ? ["Хорошо", 60, "#ffcf7a"] : ["Норм", 25, "#ffb36b"];
        combo++; best = Math.max(best, combo); hits++; if (bd < 0.06) perfect++;
        var pts = Math.round(g[1] * Math.min(1.6, 1 + combo * 0.04));
        score += pts; bestM.grade = g[0]; lastGrade = g[0]; gradeT = 0.6; capI++;
        api.flash(g[0], g[2]); snd("blip");
      } else { score = Math.max(0, score - 10); combo = 0; api.flash("Мимо", "#ff6b7a"); lastGrade = ""; }
      api.score(score); api.combo(combo > 2 ? "в такт ×" + combo : "");
    }
    cv.addEventListener("pointerdown", function (e) { e.preventDefault(); cut(); });
    api.onKey(function (e) { if (e.code === "Space" || e.code === "Enter" || e.code === "KeyX") { cut(); return true; } });
    api.hint(touch() ? "Тапай по экрану, когда ножницы на красной линии" : "Пробел — разрез, когда ножницы на красной линии");
    api.score(0);
    var stop = loop(function (dt) {
      t += dt; gradeT -= dt;
      if (cv.clientWidth !== W) size();
      PPS = W * 0.32;
      var c = ctx; c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fillStyle = "#0a0d1c"; c.fillRect(0, 0, W, H);
      // монитор превью
      var mh = H * 0.46, mw = mh * 9 / 16, mx = W / 2 - mw / 2, my = 10;
      var segI = marks.filter(function (m) { return m.t <= t; }).length;
      var gcol = COLORS[segI % COLORS.length];
      var g = c.createLinearGradient(mx, my, mx + mw, my + mh); g.addColorStop(0, gcol); g.addColorStop(1, "#1a1d36");
      c.fillStyle = "#000"; roundRect(c, mx - 4, my - 4, mw + 8, mh + 8, 12); c.fill();
      c.fillStyle = g; roundRect(c, mx, my, mw, mh, 9); c.fill();
      c.globalAlpha = 0.25; c.fillStyle = "#fff";
      for (var s = 0; s < 5; s++) { c.beginPath(); c.arc(mx + mw * (0.2 + 0.15 * s), my + mh * (0.35 + 0.2 * Math.sin(t * 2 + s)), mw * 0.08, 0, 7); c.fill(); }
      c.globalAlpha = 1;
      c.font = "800 " + Math.round(mw * 0.13) + "px system-ui"; c.textAlign = "center"; c.fillStyle = "#fff";
      c.strokeStyle = "rgba(0,0,0,.6)"; c.lineWidth = 4;
      var cap = CAPTIONS[capI % CAPTIONS.length];
      c.strokeText(cap, mx + mw / 2, my + mh * 0.82); c.fillText(cap, mx + mw / 2, my + mh * 0.82);
      if (gradeT > 0 && lastGrade) { c.fillStyle = "rgba(255,255,255," + (gradeT * 0.5) + ")"; c.fillRect(mx, my, mw, mh); }
      // дорожки
      var py = my + mh + 18, th = H - py - 10, ph = W * 0.28;
      c.fillStyle = "rgba(255,255,255,.04)"; c.fillRect(0, py, W, th);
      var clipH = th * 0.5, waveY = py + clipH + 6, waveH = th - clipH - 10;
      // клипы между разрезами
      var prev = 0;
      for (var m = 0; m <= marks.length; m++) {
        var a = prev, b = m < marks.length ? marks[m].t : END;
        var x0 = ph + (a - t) * PPS, x1 = ph + (b - t) * PPS;
        if (x1 > -10 && x0 < W + 10) {
          c.fillStyle = COLORS[m % COLORS.length]; c.globalAlpha = 0.85;
          roundRect(c, x0 + 1, py + 4, Math.max(2, x1 - x0 - 2), clipH - 6, 6); c.fill(); c.globalAlpha = 1;
          c.fillStyle = "rgba(0,0,0,.18)";
          for (var fx = x0 + 8; fx < x1 - 8; fx += 22) c.fillRect(fx, py + 10, 14, clipH - 18);
        }
        prev = b;
      }
      // волна
      c.fillStyle = "rgba(125,255,176,.55)";
      for (var wv = 0; wv < 140; wv++) {
        var wt = t - 0.8 + wv * 0.04, wx = ph + (wt - t) * PPS;
        if (wx < 0 || wx > W) continue;
        var amp = wave[Math.abs(Math.floor(wt * 25)) % wave.length] * (marks.some(function (mm) { return Math.abs(mm.t - wt) < 0.05; }) ? 1 : 0.55);
        c.fillRect(wx, waveY + waveH / 2 - amp * waveH / 2, 3, amp * waveH);
      }
      // ножницы-метки
      marks.forEach(function (mm) {
        var x = ph + (mm.t - t) * PPS;
        if (x < -20 || x > W + 20) return;
        if (!mm.hit && t - mm.t > 0.22 && !mm.grade) { mm.grade = "miss"; miss++; combo = 0; api.combo(""); }
        c.globalAlpha = mm.hit ? 0.35 : mm.grade === "miss" ? 0.25 : 1;
        c.fillStyle = mm.hit ? "#9dffbf" : mm.grade === "miss" ? "#ff6b7a" : "#ffcf7a";
        c.beginPath(); c.moveTo(x, py - 6); c.lineTo(x + 8, py + 4); c.lineTo(x, py + 14); c.lineTo(x - 8, py + 4); c.closePath(); c.fill();
        c.fillRect(x - 1, py + 4, 2, th - 8);
        c.font = "16px system-ui"; c.fillText("✂", x, py - 10);
        c.globalAlpha = 1;
      });
      // плейхед
      c.fillStyle = "#ff3b5c"; c.fillRect(ph - 1.5, py - 4, 3, th + 4);
      c.beginPath(); c.moveTo(ph - 8, py - 12); c.lineTo(ph + 8, py - 12); c.lineTo(ph, py - 2); c.closePath(); c.fill();
      api.time(1 - t / END, END - t);
      if (t >= END) {
        stop();
        result(api, o, Math.min(1.3, score / (marks.length * 92)), [["попаданий", hits + "/" + marks.length], ["идеально", perfect], ["пропущено", miss], ["лучшее комбо", best]], finish);
        return false;
      }
    });
    return function () { stop(); };
  }
  function roundRect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  /* ---- 3. Фотостудия: поймай кадр — модель в центре и в фокусе ------------------------------------------------ */
  var MODELS = ["💃", "🕺", "🦊", "🐱", "🐼", "🦄", "🐸", "🦁"];       // кто позирует: эмодзи системы, без картинок
  function gPhoto(api, o, finish) {
    var SH = 5, shots = [], T = o.time || 28, left = T;
    var model = MODELS[Math.floor(Math.random() * MODELS.length)];
    var cv = el("canvas", "mg-cv"), strip = el("div", "mg-strip"), btn = el("button", "mg-snap");
    btn.type = "button"; btn.setAttribute("aria-label", "Снять");
    api.body.appendChild(cv); api.body.appendChild(strip); api.body.appendChild(btn);
    var ctx = cv.getContext("2d"), W = 0, H = 0, dpr = Math.min(global.devicePixelRatio || 1, 2);
    function size() { W = cv.clientWidth; H = Math.round(Math.min(W * 0.6, global.innerHeight * 0.45)); cv.style.height = H + "px"; cv.width = W * dpr; cv.height = H * dpr; }
    size();
    var t = 0, ph1 = Math.random() * 6, ph2 = Math.random() * 6, sp = 1 + (o.level || 1) * 0.06, flash = 0;
    var BG = ["#2b3a67", "#5a2a4a", "#24463f", "#4a3a1c"][Math.floor(Math.random() * 4)];
    var mx = 0, my = 0, focus = 0, total = 0;
    function snap() {
      if (shots.length >= SH) return;
      var cx = W / 2, cy = H / 2;
      var d = Math.hypot(mx - cx, my - cy) / Math.hypot(W / 2, H / 2);
      var cs = FC.clamp(1 - d * 2.2, 0, 1), fs = FC.clamp(1 - Math.abs(focus) * 1.15, 0, 1);
      var pts = Math.round(cs * 60 + fs * 40);
      total += pts; flash = 1; snd("blip");
      var th = document.createElement("canvas"); th.width = 120; th.height = 90;
      th.getContext("2d").drawImage(cv, 0, 0, cv.width, cv.height, 0, 0, 120, 90);
      strip.appendChild(th);
      shots.push(pts);
      api.flash(pts >= 85 ? "В обложку! " + pts : pts >= 60 ? "Хороший кадр " + pts : pts >= 35 ? "Так себе " + pts : "Смазано " + pts, pts >= 60 ? "#9dffbf" : pts >= 35 ? "#ffcf7a" : "#ff6b7a");
      api.score(total); api.combo("кадр " + shots.length + "/" + SH);
      sp += 0.12;
    }
    btn.addEventListener("click", snap);
    cv.addEventListener("pointerdown", function (e) { e.preventDefault(); snap(); });
    api.onKey(function (e) { if (e.code === "Space" || e.code === "Enter") { snap(); return true; } });
    api.hint(touch() ? "Жми на кнопку, когда модель в центре и резкая" : "Пробел — снимок: модель в центре и в фокусе");
    api.score(0); api.combo("кадр 0/" + SH);
    var stop = loop(function (dt) {
      t += dt * sp; left -= dt; flash = Math.max(0, flash - dt * 3);
      if (cv.clientWidth !== W) size();
      var c = ctx; c.setTransform(dpr, 0, 0, dpr, 0, 0);
      // студия: фон-циклорама, свет
      var bg = c.createRadialGradient(W / 2, H * 0.4, 10, W / 2, H / 2, W * 0.7); bg.addColorStop(0, "#e9e4dc"); bg.addColorStop(0.6, BG); bg.addColorStop(1, "#0b0d18");
      c.fillStyle = bg; c.fillRect(0, 0, W, H);
      c.fillStyle = "rgba(255,255,255,.06)";
      for (var s = 0; s < 3; s++) { c.beginPath(); c.moveTo(W * (0.15 + s * 0.35), 0); c.lineTo(W * (0.05 + s * 0.35), H); c.lineTo(W * (0.25 + s * 0.35), H); c.fill(); }
      mx = W / 2 + Math.sin(t * 1.3 + ph1) * W * 0.32 + Math.sin(t * 3.1) * W * 0.04;
      my = H / 2 + Math.sin(t * 0.9 + ph2) * H * 0.22;
      focus = Math.sin(t * 1.7 + ph2);
      var sz = H * 0.62, blur = Math.abs(focus) * 9;
      // модель — эмодзи; размытие — несколько смещённых копий (ctx.filter есть не везде)
      var n = blur > 1 ? 6 : 1;
      c.font = Math.round(sz * 0.7) + "px system-ui, Apple Color Emoji, Segoe UI Emoji"; c.textAlign = "center"; c.textBaseline = "middle";
      c.globalAlpha = n > 1 ? 0.28 : 1;
      for (var k = 0; k < n; k++) {
        var a = k / n * Math.PI * 2, ox = n > 1 ? Math.cos(a) * blur : 0, oy = n > 1 ? Math.sin(a) * blur : 0;
        c.fillText(model, mx + ox, my + oy);
      }
      c.globalAlpha = 1;
      // видоискатель: трети, рамка центра, шкала фокуса
      c.strokeStyle = "rgba(255,255,255,.35)"; c.lineWidth = 1;
      c.beginPath(); c.moveTo(W / 3, 0); c.lineTo(W / 3, H); c.moveTo(W * 2 / 3, 0); c.lineTo(W * 2 / 3, H); c.moveTo(0, H / 3); c.lineTo(W, H / 3); c.moveTo(0, H * 2 / 3); c.lineTo(W, H * 2 / 3); c.stroke();
      var good = Math.hypot(mx - W / 2, my - H / 2) < Math.min(W, H) * 0.12;
      c.strokeStyle = good ? "#7dffb0" : "#ffcf7a"; c.lineWidth = 3;
      var b = Math.min(W, H) * 0.16, L = b * 0.35, cx = W / 2, cy = H / 2;
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (q) {
        c.beginPath(); c.moveTo(cx + q[0] * b, cy + q[1] * (b - L)); c.lineTo(cx + q[0] * b, cy + q[1] * b); c.lineTo(cx + q[0] * (b - L), cy + q[1] * b); c.stroke();
      });
      var fw = W * 0.3, fx = W - fw - 14, fy = H - 22;
      c.fillStyle = "rgba(0,0,0,.45)"; roundRect(c, fx - 8, fy - 14, fw + 16, 26, 10); c.fill();
      c.fillStyle = "rgba(255,255,255,.2)"; c.fillRect(fx, fy - 2, fw, 4);
      c.fillStyle = Math.abs(focus) < 0.2 ? "#7dffb0" : "#ffcf7a"; c.fillRect(fx + fw / 2 + focus * fw / 2 - 3, fy - 8, 6, 16);
      c.fillStyle = "#fff"; c.font = "700 11px system-ui"; c.textAlign = "left"; c.fillText("ФОКУС", 14, H - 14);
      c.fillStyle = "#ff3b5c"; c.beginPath(); c.arc(22, 20, 6, 0, 7); c.fill(); c.fillStyle = "#fff"; c.fillText("REC", 34, 24);
      if (flash > 0) { c.fillStyle = "rgba(255,255,255," + flash + ")"; c.fillRect(0, 0, W, H); }
      api.time(left / T, left);
      if (shots.length >= SH || left <= 0) {
        stop();
        while (shots.length < SH) shots.push(0);
        result(api, o, Math.min(1.3, total / (SH * 78)), [["кадров", shots.filter(function (x) { return x > 0; }).length + "/" + SH], ["лучший", Math.max.apply(null, shots)], ["очки", total]], finish);
        return false;
      }
    });
    return function () { stop(); };
  }

  /* ---- 4. Бюро переводов / Редакция ----------------------------------------------------------------------- */
  var WORDS = [["договор", "contract"], ["счёт", "invoice"], ["встреча", "meeting"], ["ролик", "video"], ["отчёт", "report"],
    ["цена", "price"], ["доставка", "delivery"], ["подпись", "signature"], ["скидка", "discount"], ["клиент", "client"],
    ["задача", "task"], ["срок", "deadline"], ["бюджет", "budget"], ["прибыль", "profit"], ["реклама", "advertising"],
    ["сайт", "website"], ["заказ", "order"], ["оплата", "payment"], ["отпуск", "vacation"], ["письмо", "letter"],
    ["команда", "team"], ["идея", "idea"], ["рынок", "market"], ["товар", "product"], ["вывеска", "sign"], ["аренда", "rent"],
    ["налог", "tax"], ["зарплата", "salary"], ["склад", "warehouse"], ["поставщик", "supplier"], ["презентация", "presentation"],
    ["монтаж", "editing"], ["субтитры", "subtitles"], ["обложка", "cover"], ["подписчик", "follower"], ["расписание", "schedule"]];
  var NEWS = [["В Центре открылась новая кофейня у Башни Флейм", true], ["Уголёк уехал в отпуск на Луну", false],
    ["На Огненном проспекте пробка из такси после концерта", true], ["В Минске запретили ходить по тротуарам по вторникам", false],
    ["В Монтажной Алматы рекордная очередь на рилсы", true], ["Агенты " + FC.cityOf + " отказались от сна навсегда", false],
    ["Патруль ищет угонщика спорткара в Москве", true], ["В реке нашли говорящую рыбу-бухгалтера", false],
    ["На пляже открылся фестиваль уличной еды", true], ["Мэр пообещал раздать каждому по вертолёту", false],
    ["Новый мост соединил Москву и Центр", true], ["Светофоры будут работать только по выходным", false],
    ["Фотостудия 3×3 работает до полуночи", true], ["Телеграм-бот выиграл выборы в Минске", false],
    ["Синоптики обещают дождь к вечеру", true], ["В метро начали принимать оплату улыбкой", false],
    ["В Читальне прошла ночь лекций про ИИ", true], ["Существа научились летать над Кок-Тобе", false]];
  function gType(api, o, finish) {
    var news = o.variant === "news", T = o.time || (news ? 40 : 45), left = T, score = 0, combo = 0, best = 0, good = 0, bad = 0, lock = false, cur = null;
    var pool = shuffle((news ? NEWS : WORDS).slice()), pi = 0;
    var useInput = !news && !touch();
    function next() {
      lock = false;
      if (pi >= pool.length) { pool = shuffle(pool); pi = 0; }
      cur = pool[pi++];
      if (news) {
        api.body.innerHTML = "<div class='ty-word news'><small>Правда или фейк?</small><b>«" + esc(cur[0]) + "»</b></div>" +
          "<div class='ty-opts two'><button type='button' data-v='0'>❌ Фейк" + (touch() ? "" : " <kbd>←</kbd>") + "</button><button type='button' data-v='1'>✅ Правда" + (touch() ? "" : " <kbd>→</kbd>") + "</button></div>";
        api.body.querySelectorAll("button").forEach(function (b) { b.addEventListener("click", function () { answer(b.dataset.v === "1", b); }); });
      } else {
        var opts = shuffle([cur[1]].concat(shuffle(WORDS.filter(function (w) { return w !== cur; })).slice(0, 2).map(function (w) { return w[1]; })));
        api.body.innerHTML = "<div class='ty-word'><small>Переведи на английский</small><b>" + esc(cur[0]) + "</b></div>" +
          "<div class='ty-opts'>" + opts.map(function (w, i) { return "<button type='button' data-w='" + esc(w) + "'>" + esc(w) + (touch() ? "" : " <kbd>" + (i + 1) + "</kbd>") + "</button>"; }).join("") + "</div>" +
          (useInput ? "<input class='ty-in' placeholder='или впиши слово и Enter (+50)' autocomplete='off' spellcheck='false'>" : "");
        api.body.querySelectorAll(".ty-opts button").forEach(function (b) { b.addEventListener("click", function () { answer(b.dataset.w === cur[1], b); }); });
        var inp = api.body.querySelector(".ty-in");
        if (inp) {
          setTimeout(function () { inp.focus(); }, 30);
          inp.addEventListener("keydown", function (e) {
            if (e.code === "Enter") { e.preventDefault(); e.stopPropagation(); var ok = inp.value.trim().toLowerCase() === cur[1]; answer(ok, null, ok ? 50 : 0); }
            else if (/^Digit[1-3]$/.test(e.code)) { e.preventDefault(); e.stopPropagation(); pickN(+e.code.slice(5) - 1); }
            else e.stopPropagation();
          });
        }
      }
    }
    function pickN(i) { var bs = api.body.querySelectorAll(".ty-opts button"); if (bs[i]) bs[i].click(); }
    function answer(right, btn, bonus) {
      if (lock) return;
      if (news) right = right === cur[1];
      lock = true;
      if (right) { combo++; best = Math.max(best, combo); good++; var pts = Math.round((80 + (bonus || 0)) * Math.min(2, 1 + combo * 0.1)); score += pts; api.flash("+" + pts, "#9dffbf"); snd("cash"); if (btn) btn.classList.add("good"); }
      else { combo = 0; bad++; left -= 2; api.shake(); api.flash(news ? (cur[1] ? "Это правда" : "Это фейк") : cur[1], "#ff6b7a"); snd("fail"); if (btn) btn.classList.add("bad"); }
      api.score(score); api.combo(combo > 1 ? "серия ×" + combo : "");
      setTimeout(next, right ? 260 : 650);
    }
    api.onKey(function (e) {
      if (news && e.code === "ArrowLeft") { answer(false, api.body.querySelectorAll(".ty-opts button")[0]); return true; }
      if (news && e.code === "ArrowRight") { answer(true, api.body.querySelectorAll(".ty-opts button")[1]); return true; }
      var m = /^Digit([1-3])$/.exec(e.code); if (m && !news) { pickN(+m[1] - 1); return true; }
    });
    // свайп на телефоне для новостей
    var sx = null;
    api.body.addEventListener("touchstart", function (e) { sx = e.touches[0].clientX; }, { passive: true });
    api.body.addEventListener("touchend", function (e) {
      if (!news || sx == null) return;
      var dx = e.changedTouches[0].clientX - sx; sx = null;
      if (Math.abs(dx) > 70) answer(dx > 0, api.body.querySelectorAll(".ty-opts button")[dx > 0 ? 1 : 0]);
    }, { passive: true });
    api.score(0); next();
    var stop = loop(function (dt) {
      left -= dt; api.time(left / T, left);
      if (left <= 0) {
        stop();
        result(api, o, Math.min(1.3, score / (news ? 1100 : 1250)), [["верно", good], ["ошибки", bad], ["лучшая серия", best]], finish);
        return false;
      }
    });
    return function () { stop(); };
  }

  /* ---- 5. Терминал: соедини узлы (сюжет — «добыть исходники», «взломать сейф») ------------------------------ */
  var GLYPHS = ["🔥", "⚡", "💎", "🎬", "📸", "🛰️", "🔑", "🧠", "📼", "🛡️"];
  function gHack(api, o, finish) {
    var rounds = o.rounds || 2, round = 0, T = o.time || 35, left = T, sel = null, done = 0, need = 0, wrong = 0, stop = null;
    var logs = [];
    function log(s) { logs.push(s); if (logs.length > 3) logs.shift(); var L = api.body.querySelector(".hk-log"); if (L) L.innerHTML = logs.map(esc).join("<br>"); }
    function build() {
      var n = 4 + round + (o.level > 4 ? 1 : 0);
      var g = shuffle(GLYPHS.slice()).slice(0, n), R = shuffle(g.slice());
      need = n; done = 0; sel = null;
      api.body.innerHTML = "<div class='hk'><svg></svg><div class='hk-col'>" + g.map(function (s, i) { return "<button type='button' class='hk-n' data-s='L' data-i='" + i + "'>" + s + "</button>"; }).join("") +
        "</div><div class='hk-col'>" + R.map(function (s, i) { return "<button type='button' class='hk-n' data-s='R' data-i='" + i + "'>" + s + "</button>"; }).join("") + "</div></div><div class='hk-log'></div>";
      var Lb = api.body.querySelectorAll(".hk-n[data-s=L]"), Rb = api.body.querySelectorAll(".hk-n[data-s=R]");
      Lb.forEach(function (b, i) { b.addEventListener("click", function () { if (b.classList.contains("done")) return; Lb.forEach(function (x) { x.classList.remove("sel"); }); b.classList.add("sel"); sel = { i: i, g: g[i], b: b }; snd("blip"); }); });
      Rb.forEach(function (b, i) {
        b.addEventListener("click", function () {
          if (!sel || b.classList.contains("done")) return;
          if (R[i] === sel.g) { wire(sel.b, b); sel.b.classList.remove("sel"); sel.b.classList.add("done"); b.classList.add("done"); done++; log("> канал " + sel.g + " … OK"); snd("cash"); sel = null; if (done >= need) nextRound(); }
          else { wrong++; left -= 3; api.shake(); api.flash("Отказ доступа −3 с", "#ff6b7a"); log("> " + sel.g + " ≠ " + R[i] + " … ОТКАЗ"); snd("fail"); }
        });
      });
      log("> раунд " + (round + 1) + "/" + rounds + ": сопоставь каналы");
    }
    function wire(a, b) {
      var svg = api.body.querySelector("svg"), box = api.body.querySelector(".hk").getBoundingClientRect();
      var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      var x1 = ra.right - box.left, y1 = ra.top + ra.height / 2 - box.top, x2 = rb.left - box.left, y2 = rb.top + rb.height / 2 - box.top;
      var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", "M" + x1 + "," + y1 + " C" + (x1 + x2) / 2 + "," + y1 + " " + (x1 + x2) / 2 + "," + y2 + " " + x2 + "," + y2);
      p.setAttribute("stroke", "#7dffb0"); p.setAttribute("stroke-width", "3"); p.setAttribute("fill", "none"); p.setAttribute("stroke-linecap", "round");
      svg.appendChild(p);
    }
    function nextRound() {
      round++;
      api.score(round * 100 + Math.round(left) * 5);
      if (round >= rounds) { end(true); return; }
      setTimeout(build, 350);
    }
    function end(win) {
      if (stop) stop();
      var ratio = win ? Math.min(1.3, 0.55 + left / T * 0.8 - wrong * 0.04) : Math.min(0.3, round / rounds * 0.3);
      result(api, o, Math.max(win ? 0.36 : 0, ratio), [["раундов", round + "/" + rounds], ["ошибки", wrong], ["осталось", Math.max(0, Math.round(left)) + " с"]], finish);
    }
    api.hint(touch() ? "Тапни символ слева, потом такой же справа" : "Кликни символ слева, потом такой же справа");
    api.score(0); build();
    stop = loop(function (dt) {
      left -= dt; api.time(left / T, left);
      if (left <= 0) { end(false); return false; }
    });
    return function () { if (stop) stop(); };
  }

  /* ---- запуск ---------------------------------------------------------------------------------------------- */
  var GAMES = {
    tasks: { fn: gTasks, icon: "🗂️", title: "Задачи агента", sub: "Разбери заявки людей и отправь в нужное здание",
      intro: "Люди пишут своему агенту. Ты — агент: реши, какое здание " + FC.cityOf + " (то есть какое умение агента) выполнит заявку.",
      rules: ["<b>Верно</b> — деньги и комбо, быстрее — больше", "<b>Ошибка</b> — минус 3 секунды", "<b>Срочно</b> — двойная оплата"] },
    montage: { fn: gMontage, icon: "🎬", title: "Монтажная", sub: "Нарежь рилс в такт музыке",
      intro: "Дорожка ролика едет. Режь, когда ножницы проходят красную линию — так монтируют в Монтажной.",
      rules: ["<b>Идеально</b> — точно в такт", "Серия в такт — множитель", "Лишний разрез — минус очки"] },
    photo: { fn: gPhoto, icon: "📸", title: "Фотостудия", sub: "Поймай кадр для обложки",
      intro: "Модель позирует и двигается. Снимай, когда она в центре рамки и резкая.",
      rules: ["<b>5 кадров</b> — у каждого своя оценка", "Центр рамки — 60 очков, фокус — 40", "Время ограничено"] },
    type: { fn: gType, icon: "🌍", title: "Бюро переводов", sub: "Переводи быстро и без ошибок",
      intro: "Клиенту нужен перевод договора. Слово за словом — быстро и точно.",
      rules: ["Выбери верный перевод", "Серия — множитель, ошибка — минус 2 с", "На компьютере можно вписать слово (+50)"] },
    hack: { fn: gHack, icon: "🛰️", title: "Терминал", sub: "Подбери каналы до таймера",
      intro: "Защита на каналах. Соедини одинаковые символы слева и справа, пока не сработала тревога.",
      rules: ["Слева — выбрать, справа — соединить", "Ошибка — минус 3 секунды", "Все раунды — доступ получен"] }
  };
  GAMES.source = GAMES.hack;
  var NEWS_META = { icon: "📰", title: "Редакция", sub: "Правда или фейк?", intro: "Новости сыплются из чатов. Отличи правду от фейка, пока она не разлетелась.",
    rules: ["← фейк, → правда (на телефоне — свайп)", "Серия — множитель", "Ошибка — минус 2 секунды"] };

  function run(id, opt) {
    var g = GAMES[id] || GAMES.tasks;
    var o = Object.assign({}, opt || {});
    var meta = id === "type" && o.variant === "news" ? Object.assign({}, g, NEWS_META) : g;
    o.icon = o.icon || meta.icon; o.title = o.title || meta.title; o.sub = o.sub || meta.sub;
    if (running) running.abort();
    return new Promise(function (resolve) {
      var api = shell(o), cleanup = null, settled = false;
      var P = FC.player, wasBusy = P ? P.busy : false, wasPaused = !!FC.paused;
      if (FC.input) { FC.input.enable(false); FC.input.unlock(); }
      if (P) P.busy = true;
      // мир на время смены стоит: игрок «за столом», а телефону не тянуть город и игру разом
      FC.paused = true;
      function finish(res) {
        if (settled) return; settled = true;
        if (cleanup) cleanup();
        api.unbind(); api.close();
        FC.paused = wasPaused;
        if (FC.input) FC.input.enable(true);
        if (P) P.busy = wasBusy;
        running = null;
        FC.emit("game:end", { id: id, res: res });
        resolve(res);
      }
      api.quit = function () { finish({ ok: false, score: 0, ratio: 0, pay: 0, quit: true }); };
      running = { abort: api.quit };
      intro(api, meta.intro, meta.rules, function () { cleanup = g.fn(api, o, finish); });
      FC.emit("game:start", { id: id });
    });
  }

  FC.games = { run: run, list: Object.keys(GAMES), active: function () { return !!running; }, requests: REQ };
})(window);
