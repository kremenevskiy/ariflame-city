/* Флейм-Сити — разговоры и стычки с прохожими (FC.talk).
 *
 * С любым человеком на улице или в здании (fhumans: прохожие, офисные, патруль «Щит», медики, охрана) — «Поговорить»
 * (E / ✋): он останавливается, поворачивается к игроку и отвечает репликой по обстановке — район, время суток, погода,
 * что недавно было в городе (шина событий: розыск, налёты, аварии, трюки, захваты районов), слухи про агентов города,
 * подсказки с меткой на карте (перекраска, оружейная, банк, больница…), в Минске — свой колорит без политики и брендов.
 * Дальше — выбор из 2–3 вариантов. «Дать в нос» — тот же удар, что 👊 (fmain): первый раз мирный прохожий шатается и
 * решает сам — огрызнуться, дать сдачи, вызвать патруль (событие crime — свидетельскую логику ведёт fpolice) или
 * сбежать; сбитый с ног встаёт и делает то же. Без крови — только «вырубился». Реплики — таблица LINES ниже.
 */
(function (global) {
  "use strict";
  var FC = global.FC, M = FC.map, G = FC.gfx;
  if (!FC.people || !FC.interact || !FC.hud) return;
  var H = FC.hud;

  /* ---- память города: что недавно случилось (секунды назад) ---------------------------------------------------- */
  var mem = {};
  function mark(k) { mem[k] = performance.now(); }
  function ago(k, sec) { return mem[k] != null && performance.now() - mem[k] < sec * 1000; }
  FC.on("crime", function (e) { mark("crime"); if (e && /assault/.test(e.type || "")) mark("fight"); if (e && e.type === "car_theft") mark("theft"); });
  FC.on("wanted", function (w) { if (w && w.stars) { mark("wanted"); mem.stars = w.stars; } });
  FC.on("wanted:lost", function () { mark("escaped"); });
  FC.on("heist:start", function () { mark("heist"); });
  FC.on("heist:done", function () { mark("heist"); });
  FC.on("car:explode", function () { mark("boom"); });
  FC.on("stunt", function (s) { if (s && s.score > 300) mark("stunt"); });
  FC.on("gang:capture", function () { mark("gang"); });
  FC.on("race:done", function () { mark("race"); });
  FC.on("busted", function () { mark("busted"); });
  FC.on("wasted", function () { mark("wasted"); });
  FC.on("job:done", function () { mark("job"); });
  FC.on("home:buy", function () { mark("home"); });

  /* ---- контекст собеседника ------------------------------------------------------------------------------------ */
  var SP = FC.people.SPECIAL;
  function roleOf(ch) {
    if (ch.kind === "cop" || ch.cell === SP.cop || ch.cell === SP.cop2) return "cop";
    if (ch.cell === SP.medic) return "medic";
    if (ch.cell === SP.guard) return "guard";
    if (ch.gang || ch.crew) return "gang";
    var hs = ch._hs;
    if (hs && hs.v.role === "office") return "office";
    return "civ";
  }
  function ctx(ch) {
    var P = FC.player, h = FC.clock.hour, inside = !!(FC.inside && FC.inside.active);
    var hs = ch._hs, d = M.district ? M.district(ch.x, ch.z) : null;
    return { ch: ch, role: roleOf(ch), f: !!(hs && hs.g === "f"), old: !!(hs && hs.v.old), h: h,
      morning: h >= 5 && h < 11, day: h >= 11 && h < 18, evening: h >= 18 && h < 23, night: h >= 23 || h < 5,
      rain: G.weather && G.weather.target > 0.5, minsk: FC.city === "minsk", inside: inside,
      dist: d ? d.name : "", B: inside ? FC.inside.building : null, P: P, angry: ch.hurtAt && performance.now() - ch.hurtAt < 120000,
      stars: mem.stars || 0 };
  }
  function fill(t, c) {
    return t.replace(/\{dist\}/g, c.dist || "район").replace(/\{city\}/g, FC.cityName).replace(/\{cityIn\}/g, FC.cityIn)
      .replace(/\{cityOf\}/g, FC.cityOf).replace(/\{b\}/g, c.B ? c.B.name : "здание");
  }

  /* ---- реплики: {t: текст или варианты, when: условие(c), w: вес, anim: клип, poi: метка на карте} ----------------- */
  // Слои: greet — первая реплика; news — «что слышно»; tip — «подскажи» (часто с меткой); bye; обиды и стычки — ниже.
  var LINES = {
    greet: [
      { t: ["Доброе утро! Если оно доброе.", "Утро, а я уже третий кофе.", "Рано ты. Город ещё зевает."], when: function (c) { return c.morning; } },
      { t: ["Хороший денёк, правда?", "День как день — пробки и шаурма.", "Что, тоже прогуливаешь работу?"], when: function (c) { return c.day; } },
      { t: ["Вечер — самое время для приключений.", "Огни зажглись — город другой.", "Вечером тут красиво, если не смотреть под ноги."], when: function (c) { return c.evening; } },
      { t: ["Ночью гулять — смело.", "Не спится? Мне тоже.", "Тсс… ночью город слышит всё."], when: function (c) { return c.night; } },
      { t: ["Опять дождь. Зонт дома, конечно.", "Промок до носков. Спасибо, погода.", "Дождь — лучшее время для такси."], when: function (c) { return c.rain; }, w: 3 },
      { t: ["Привет! Ты из {dist}? Я тут всю жизнь.", "Это {dist}. Не заблудись.", "{dist} — лучший район, спорить не буду."], when: function (c) { return c.dist && !c.inside; } },
      { t: ["Мы знакомы? Лицо знакомое.", "Ой, я думал, ты курьер.", "Чем могу помочь?", "Только недолго — спешу."] },
      { t: ["Не сейчас, у меня созвон через минуту.", "Дедлайн горит, агент монтирует, а я пью кофе.", "Опять совещание про совещание."], when: function (c) { return c.role === "office"; }, w: 3 },
      { t: ["Патруль «Щит». Проходите, не задерживайтесь.", "Всё спокойно? Вот и хорошо.", "Гражданин, вы что-то хотели?"], when: function (c) { return c.role === "cop"; }, w: 6 },
      { t: ["Не болейте. У нас и так очередь.", "Если что — я медик, но лучше не надо.", "Пейте воду и не прыгайте с крыш."], when: function (c) { return c.role === "medic"; }, w: 6 },
      { t: ["Проход только для своих.", "Я тут слежу. Не шали.", "Мимо проходи, мимо."], when: function (c) { return c.role === "guard"; }, w: 6 },
      { t: ["Чё надо? Это наш район.", "Ты не отсюда, да?", "Сюда без приглашения не ходят."], when: function (c) { return c.role === "gang"; }, w: 6 },
      { t: ["О, опять ты. Нос ещё болит, между прочим.", "Ты же меня недавно стукнул! Чего надо?", "Я тебя запомнил, драчун."], when: function (c) { return c.angry; }, w: 12 },
      { t: ["Минск — город-сад. Особенно когда цветёт сирень.", "Хорошо у нас: чисто, спокойно, троллейбусы ходят.", "Ты не местный? Минчане сразу видят."], when: function (c) { return c.minsk; }, w: 2 },
      { t: ["Тут всегда кто-то работает. Даже ночью.", "В {b} лифт опять застрял. Ходим пешком.", "Кофемашина сломалась — офис в трауре."], when: function (c) { return c.inside; }, w: 3 }
    ],
    news: [
      { t: ["Тут только что кого-то вырубили! Ты не видел?", "Слышал крики? Кто-то дерётся во дворах.", "Опять драка на районе. Куда смотрит патруль…"], when: function () { return ago("fight", 90); }, w: 5 },
      { t: ["Патруль кого-то ищет — все машины с мигалками.", "Говорят, в розыске какой-то шустрый тип. Не ты?", "Видел вертолёт? Кого-то ловят."], when: function () { return ago("wanted", 180); }, w: 5 },
      { t: ["Опять «Флейм-Банк» грабанули! Третий раз за неделю.", "Слышал про налёт? Мешки с деньгами по всей улице!", "В новостях: ограбление века. Ну, века этой недели."], when: function () { return ago("heist", 600); }, w: 6 },
      { t: ["Что-то бабахнуло у перекрёстка — я чуть кофе не пролил.", "Машина взорвалась! Прямо как в кино."], when: function () { return ago("boom", 300); }, w: 6 },
      { t: ["Видел, как кто-то сальто на машине сделал? Это в рилс!", "Кто-то гоняет по крышам машин. Безумец. Уважаю."], when: function () { return ago("stunt", 300); }, w: 4 },
      { t: ["Банды опять делят районы. Не суйся туда в цвете.", "Слышал? Район перешёл к новой банде."], when: function () { return ago("gang", 600); }, w: 4 },
      { t: ["Говорят, кто-то уходил от «Щита» через дворы — и ушёл!", "От погони ушёл? Ну ты… то есть тот парень — молодец."], when: function () { return ago("escaped", 300); }, w: 4 },
      { t: ["Кого-то задержали — штраф и ночь в участке.", "Видел, как патруль кого-то паковал. Не повезло."], when: function () { return ago("busted", 600); }, w: 4 },
      { t: ["Гонку видел? Ревели так, что окна дрожали.", "На набережной опять гонки."], when: function () { return ago("race", 600); }, w: 3 },
      // слухи про агентов — они живут в городе
      { t: ["Мой агент смонтировал рилс за пять минут. С субтитрами! Я в шоке.", "Говорят, в Башне Флейм на 64-м этаже живёт Уголёк.",
        "Видел этих существ у зданий? Это агенты — работают за людей.", "Мой агент ночью сам сделал презентацию. А я спал.",
        "В Проявочной очередь — все ждут свои ролики.", "Подруга завела агента — теперь он ей сайт сверстал.",
        "Говорят, агенты смотрят тренды и сами придумывают рилсы.", "Агент соседа фотосессию сделал. Ни одного фотографа!"], w: 3 },
      { t: ["Говорят, в метро ночью ездит пустой поезд. Мистика.", "Слышал легенду про Свислочь? Кто бросит монетку — вернётся.",
        "На Комаровке такие драники — язык проглотишь.", "Троллейбус до Уручья опять битком.", "У Немиги, говорят, когда-то была река прямо на улице."],
        when: function (c) { return c.minsk; }, w: 4 },
      { t: ["Говорят, на крыше Башни кто-то оставил сундук с деньгами.", "Слышал, в канализации живёт огромный крокодил. Врут, наверное.",
        "Шаурма «У Огонька» — лучшая в городе. Это не реклама, это крик души.", "На пляже ночью кто-то включает музыку. Никто не знает кто."],
        when: function (c) { return !c.minsk; }, w: 3 },
      { t: ["Всё тихо. Подозрительно тихо.", "Ничего нового. Скукота.", "Цены растут, а зарплата — нет. Как обычно.", "Говорят, скоро снег. Говорят каждый год."], w: 2 },
      { t: ["Не отвлекай патруль, гражданин.", "Сводки пока спокойные. Будь паинькой.", "Если увидишь драку — звони, приедем."], when: function (c) { return c.role === "cop"; }, w: 8 }
    ],
    tip: [
      { t: ["Машину помял? Перекраска рядом — и как новенькая. И патруль забудет.", "Хочешь сменить цвет тачки? Тут недалеко перекраска."], poi: "paint", w: 3 },
      { t: ["Оружейная «Искромёт» рядом. Говорят, там дают пощупать всё.", "Нужна защита? Загляни в «Искромёт»."], poi: "guns", w: 2 },
      { t: ["Хочешь заработать — работа в телефоне. Такси, доставка, всё такое.", "Подработку ищешь? Открой «Работа» в телефоне."], w: 2 },
      { t: ["Говорят, во «Флейм-Банке» охрана меняется в полночь…", "Банк, банк… Если что, я ничего не говорил."], poi: "bank", w: 2, when: function (c) { return c.role !== "cop"; } },
      { t: ["Больница вон там. Запомни, пригодится.", "Если побьют — больница недалеко. Я туда уже как домой."], poi: "hospital", w: 2 },
      { t: ["Бензин кончается? Заправка рядом.", "Тут заправка за углом, если ты на колёсах."], poi: "gas", w: 1 },
      { t: ["Новую тачку хочешь? Автосалон «Искра Моторс» — только посмотреть, цены кусаются.", "В автосалоне спорткар стоит. Мечта."], poi: "cars", w: 1 },
      { t: ["Вечером в клубе «Неон» весело.", "Танцевать любишь? Клуб «Неон» ждёт."], poi: "club", w: 1, when: function (c) { return c.evening || c.night; } },
      { t: ["Проголодался? Магазин 24/7 рядом — шаурма, кофе, энергетик.", "В магазине есть лотерея «Огонёк». Я выиграл $3. Один раз."], poi: "store", w: 2 },
      { t: ["Хочешь качаться — спортзал «Железо».", "В «Железе» тренер — зверь. В хорошем смысле."], poi: "gym", w: 1 },
      { t: ["Свой бизнес хочешь? Шаурма, мойка, барбершоп — всё продаётся. Смотри «Бизнес» в телефоне.", "Купи бизнес — деньги капают, даже когда спишь."], w: 2 },
      { t: ["Проблемы? Пост «Щита» рядом. Но лучше без проблем.", "Если что — пост патруля вон там."], poi: "police", w: 1, when: function (c) { return c.role === "cop"; } },
      { t: ["Хочешь, чтобы агент сделал рилс? Загляни в здания-зоны — там агенты людей работают.", "Тебе в Башню Флейм — Уголёк подскажет, что дальше."], w: 1 },
      { t: ["Без понятия, честно.", "Я тут сам первый день.", "Спроси у кого-нибудь другого. Я только за хлебом вышел."], anim: "shrug", w: 1 }
    ],
    bye: ["Ну, бывай!", "Удачи!", "Пока-пока!", "Береги нос.", "Заходи, если что.", "Не скучай!"],
    // ударили (первый раз, не с ног): короткий выкрик
    slap: ["Ай! Ты чего?!", "Эй! Совсем?!", "Ой-ой-ой!", "За что?!", "Нос! Мой нос!", "Ты нормальный вообще?!", "Ауч!"],
    snap: ["Ещё раз — и пожалеешь!", "Тебя мама не учила?!", "Псих какой-то!", "Иди проспись!", "Я это запомню!"],
    fight: ["Ах так?! Получай!", "Ну всё, держись!", "Сдачи хочешь? На!", "Я на бокс три года ходил!", "Сам напросился!"],
    hitback: ["На!", "Получай!", "Ещё хочешь?", "Вот тебе!", "Хоп!"],
    call: ["📱 Алло, патруль?! Меня бьют!", "📱 Щит? Тут хулиган!", "📱 Срочно приезжайте, тут драка!"],
    flee: ["Мама!", "Помогите!", "Я в сторис это выложу!", "Не догонишь!", "Аааа!", "Я бегу, бегу!"],
    dazed: ["Где я?.. Какой сейчас год?", "Звёздочки… красивые…", "Кто выключил свет?", "Я в порядке. Я в полном порядке.", "Ох… голова…"],
    car: ["Смотри, куда едешь!!!", "Права купил?!", "Я теперь на такси ходить буду!", "Ну спасибо, водила!"],
    chatter: ["…и тут он говорит: «а давай без субтитров»!", "Представляешь, агент сам ролик выложил!", "Кофе тут дорогой стал.",
      "Ты видел вчерашний закат? Огонь!", "Я вообще-то на диете. С завтрашнего дня.", "У тебя тоже рилс в рекомендации залетел?",
      "Шаурму будешь?", "Снова этот тип с камерой…", "Говорят, в Башне вечеринка.", "Да ну, не может быть!"]
  };
  var CHOICES = [
    { id: "news", label: "Что слышно в городе?" },
    { id: "tip", label: "Подскажи что-нибудь" },
    { id: "punch", label: "👊 Дать в нос" },
    { id: "bye", label: "👋 Пока" }
  ];
  var NAME = { cop: "Патруль «Щит»", medic: "Медик", guard: "Охранник", gang: "Парень из банды", office: "Офисный работник" };
  var FACE = { cop: "🛡️", medic: "🩺", guard: "🕶️", gang: "😎", office: "💼" };
  function nameOf(c) {
    if (c.role === "office") return c.f ? "Офисная работница" : "Офисный работник";
    if (NAME[c.role]) return NAME[c.role];
    return c.old ? (c.f ? "Пожилая прохожая" : "Пожилой прохожий") : c.f ? "Прохожая" : "Прохожий";
  }
  function faceOf(c) { return FACE[c.role] || (c.old ? "🧓" : c.f ? "👩" : "🧑"); }
  function pickW(list, c) {
    var ok = list.filter(function (l) { return !l.when || l.when(c); }), sum = 0;
    ok.forEach(function (l) { sum += l.w || 1; });
    var r = Math.random() * sum;
    for (var i = 0; i < ok.length; i++) { r -= ok[i].w || 1; if (r <= 0) return ok[i]; }
    return ok[ok.length - 1];
  }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function line(kind, c) {
    var l = pickW(LINES[kind], c);
    if (!l) return { text: "…" };
    return { text: fill(Array.isArray(l.t) ? pick(l.t) : l.t, c), anim: l.anim, poi: l.poi };
  }

  /* ---- окно разговора: реплика собеседника + варианты (1–4 / тап) ---------------------------------------------- */
  FC.css([
    ".tk{position:fixed;left:50%;bottom:calc(18px + var(--safe-b));transform:translate(-50%,20px);width:min(560px,94vw);background:rgba(14,18,36,.95);",
    "border:1px solid var(--line);border-radius:18px;padding:12px 14px;opacity:0;transition:.22s;pointer-events:none;z-index:7}",
    ".tk.on{opacity:1;transform:translate(-50%,0);pointer-events:auto}",
    ".tk .tw{display:flex;gap:10px;align-items:flex-start}.tk .tf{font-size:30px;line-height:1;width:44px;height:44px;flex:none;display:grid;place-items:center;",
    "border-radius:12px;background:radial-gradient(circle at 50% 60%,#4a3a6a,#151a30)}",
    ".tk b{color:var(--gold);font-size:13px;letter-spacing:.03em}.tk p{margin:2px 0 8px;font-size:15px;line-height:1.35}",
    ".tk .tc{display:grid;grid-template-columns:1fr 1fr;gap:6px}.tk button{background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.12);",
    "border-radius:11px;padding:9px 10px;font:600 13.5px system-ui;color:var(--ink);text-align:left;cursor:pointer}",
    ".tk button:hover{background:rgba(255,207,122,.18)}.tk button i{font-style:normal;color:var(--gold);margin-right:6px;font-weight:800}",
    ".tk button.pn{border-color:rgba(255,107,122,.45)}"
  ].join(""));
  var box = document.createElement("div");
  box.className = "ui tk";
  (document.getElementById("hud") || document.body).appendChild(box);
  var cur = null;                       // {ch, c, asked:{}}
  function render(who, text, opts) {
    box.innerHTML = "<div class='tw'><div class='tf'>" + faceOf(who) + "</div><div style='flex:1'><b>" + H.esc(nameOf(who)) + "</b><p>" +
      H.esc(text) + "</p><div class='tc'>" + opts.map(function (o, i) {
      return "<button type='button' data-i='" + i + "' class='" + (o.id === "punch" ? "pn" : "") + "'><i>" + (FC.input.touch ? "" : i + 1) + "</i>" + H.esc(o.label) + "</button>";
    }).join("") + "</div></div></div>";
    box.classList.add("on");
    box._opts = opts;
  }
  box.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("button") : null;
    if (b && box._opts) choose(box._opts[+b.dataset.i]);
  });
  global.addEventListener("keydown", function (e) {
    if (!cur) return;
    var k = /^Digit([1-4])$/.exec(e.code);
    if (k && box._opts && box._opts[+k[1] - 1]) { e.preventDefault(); choose(box._opts[+k[1] - 1]); }
    else if (e.code === "Escape") { e.preventDefault(); end(true); }
  });
  function speak(ch, text, anim) {
    FC.people.say(ch, text, 4.5);
    if (FC.humans) {
      if (anim) FC.humans.play(ch, anim, { rate: 1.1 });
      else ch.talk = Math.random() < 0.35 ? "talk2" : "talk";
    }
  }
  /* собеседник стоит и смотрит на игрока: у прохожих — свой ход (brain), у NPC зданий — подмена update на время */
  function holdBrain(ch) {
    ch.vx = ch.vz = 0; ch.speed = 0; ch.look = FC.player;
    return true;
  }
  function hold(ch) {
    if (ch.kind === "ped") { ch._brain0 = ch.brain; ch.brain = holdBrain; }
    else if (ch.update && !ch.sit) { ch._upd0 = ch.update; ch.update = function (c) { holdBrain(c); }; }
    ch.look = FC.player; ch.pause = 0;
  }
  function unhold(ch) {
    if (ch.brain === holdBrain) { ch.brain = ch._brain0 || null; ch._brain0 = null; }
    if (ch._upd0) { ch.update = ch._upd0; ch._upd0 = null; }
    ch.look = null; ch.talk = null;
  }
  function start(ch) {
    if (cur) end(false);
    var c = ctx(ch);
    cur = { ch: ch, c: c, asked: {} };
    hold(ch);
    FC.input.enable(false);
    document.body.classList.add("indlg");
    if (FC.humans && FC.player) FC.humans.play(FC.player.ch, "wave", { rate: 1.4 });
    var l = line("greet", c);
    speak(ch, l.text, c.angry ? "deny" : null);
    render(c, l.text, opts());
    if (FC.audio) FC.audio.play("blip");
  }
  function opts() {
    return CHOICES.filter(function (o) { return !cur.asked[o.id] || o.id === "punch" || o.id === "bye"; });
  }
  function choose(o) {
    if (!cur || !o) return;
    var ch = cur.ch, c = cur.c;
    if (o.id === "bye") {
      var b = pick(LINES.bye);
      FC.people.say(ch, b, 2.5);
      if (FC.humans) FC.humans.play(ch, "wave", { rate: 1.3 });
      end(true);
      return;
    }
    if (o.id === "punch") {
      end(false);
      var P = FC.player;
      if (P && P.punch) { P.heading = Math.atan2(ch.x - P.x, ch.z - P.z); P.punch(); }
      return;
    }
    cur.asked[o.id] = 1;
    var l = line(o.id, c);
    var text = l.text;
    if (l.poi) {
      var B = M.poi ? M.poi(l.poi, ch.x, ch.z) : null;
      if (B && B.doors && B.doors[0]) {
        var d = B.doors[0];
        FC.markers.add({ id: "talk-tip", x: d.x + d.nx * 2, z: d.z + d.nz * 2, color: B.color || "#ffcf7a", icon: B.emoji || "📍", label: B.name, ring: 0, route: true });
        clearTimeout(tipT); tipT = setTimeout(function () { FC.markers.remove("talk-tip"); }, 120000);
        text += " (метка на карте)";
      }
    }
    speak(ch, l.text, l.anim);
    if (FC.audio) FC.audio.play("blip");
    var left = opts();
    if (left.length <= 2) { left = left.slice(); }
    render(c, text, left);
  }
  var tipT = 0;
  function end(wave) {
    if (!cur) return;
    var ch = cur.ch;
    cur = null;
    box.classList.remove("on"); box._opts = null;
    unhold(ch);
    if (ch.kind === "ped") ch.pause = wave ? 1.2 : 0;
    FC.input.enable(true);
    if (!(FC.hud.inDialog && FC.hud.inDialog())) document.body.classList.remove("indlg");
  }
  // разговор рвётся, если собеседника сбили, увели или игрок ушёл
  FC.addSystem({
    name: "talk", order: 31,
    update: function () {
      if (!cur) return;
      var ch = cur.ch, P = FC.player;
      if (!P || P.dead || P.mode !== "foot" || ch.knocked > 0 || FC.people.all.indexOf(ch) < 0 || FC.dist2(ch.x, ch.z, P.x, P.z) > 5 * 5) end(false);
    }
  });

  /* ---- «Поговорить» с ближайшим человеком ---------------------------------------------------------------------- */
  var it = { id: "talk", x: 0, z: 0, r: 2.3, key: "use", label: "Поговорить", room: null, ch: null,
    act: function () { if (it.ch) start(it.ch); } }, one = [it];
  var LBL_T = "Поговорить · 👊 — в нос", LBL_K = "Поговорить · Q — в нос";
  function talkable(c, room) {
    if (c.kind === "player" || c.kind === "remote" || c.kind === "agent" || c.realAgent || c.buddy || c.code) return false;
    if (c.knocked > 0 || c.down || c.brain && c.brain !== holdBrain || c.visible === false || c.calling) return false;
    if (FC.humans && !FC.humans.isHuman(c)) return false;
    if (room != null) return c.room === room;
    return c.room == null && c.inside == null;
  }
  FC.interact.provider(function (px, pz, room) {
    var P = FC.player;
    if (!P || P.mode !== "foot" || cur || !(FC.humans && FC.humans.ready)) return null;
    var all = FC.people.all, best = null, bd = 2.3 * 2.3;
    for (var i = 0; i < all.length; i++) {
      var c = all[i], dx = c.x - px, dz = c.z - pz, d = dx * dx + dz * dz;
      if (d < bd && talkable(c, room)) { bd = d; best = c; }
    }
    if (!best) return null;
    it.x = best.x; it.z = best.z; it.room = room; it.ch = best;
    it.label = FC.input.touch ? LBL_T : LBL_K;
    return one;
  });

  /* ---- реакции на удар: пошатнулся (ped:slap) и встал после нокаута (human:up) -------------------------------- */
  function persona(ch) { return (FC.hash(ch.id || "x", 11) % 100) / 100; }
  function nearPlayer(ch, r) { var P = FC.player; return P && P.mode === "foot" && !P.dead && FC.dist2(ch.x, ch.z, P.x, P.z) < r * r; }
  function flee(ch) {
    var P = FC.player, dx = ch.x - P.x, dz = ch.z - P.z, d = Math.hypot(dx, dz) || 1;
    ch.brain = null; ch.fx = dx / d; ch.fz = dz / d; ch.flee = 5 + Math.random() * 4; ch.look = null;
    FC.people.say(ch, pick(LINES.flee), 2);
  }
  function call(ch) {
    ch.brain = null; ch.pause = 4.5; ch.look = null;
    // жертва сама звонит: она ближе всех к месту, свидетельская логика fpolice выберет её (📱 и 4 с на дозвон)
    FC.emit("crime", { type: "assault", x: ch.x, z: ch.z });
    if (!ch.calling) FC.people.say(ch, pick(LINES.call), 3);
  }
  function snap(ch) {
    ch.brain = null; ch.angry = clockS() + 4; ch.look = FC.player; ch.pause = 2.5;
    FC.people.say(ch, pick(LINES.snap), 2.6);
    if (FC.humans) FC.humans.play(ch, Math.random() < 0.5 ? "deny" : "angry", { rate: 1.2 });
    setTimeout(function () { if (ch.look === FC.player) ch.look = null; }, 2600);
  }
  function clockS() { return performance.now() / 1000; }
  /* Ответка: подбегает и бьёт (6–9 урона, раз в ~1,1 с), до 8 с; игрок убежал — машет кулаком и уходит. */
  function fight(ch) {
    var until = performance.now() + 8000, next = 0;
    FC.people.say(ch, pick(LINES.fight), 2.2);
    ch.brain = function (c, dt) {
      var P = FC.player, now = performance.now();
      if (!P || P.dead || P.mode !== "foot" || now > until || FC.dist2(c.x, c.z, P.x, P.z) > 18 * 18) {
        c.brain = null; c.look = null; c.pause = 1.5;
        FC.people.say(c, pick(LINES.snap), 2);
        return true;
      }
      var dx = P.x - c.x, dz = P.z - c.z, d = Math.hypot(dx, dz) || 1;
      if (d > 1.05) {
        var sp = d > 3 ? 4.6 : 2.2, r = M.collide(c.x + dx / d * sp * dt, c.z + dz / d * sp * dt, 0.35, { prev: c });
        c.vx = (r.x - c.x) / Math.max(dt, 1e-3); c.vz = (r.z - c.z) / Math.max(dt, 1e-3); c.x = r.x; c.z = r.z; c.speed = sp;
      } else {
        c.vx = c.vz = 0; c.speed = 0; c.look = P;
        if (now > next) {
          next = now + 1100;
          if (FC.humans) FC.humans.play(c, Math.random() < 0.5 ? "punch" : "jab", { rate: 1.6, prio: 2 });
          setTimeout(function () {
            if (c.knocked > 0 || c.brain == null || FC.dist2(c.x, c.z, P.x, P.z) > 1.8 * 1.8 || P.invuln > 0) return;
            P.damage(6 + Math.floor(Math.random() * 4), "fight");
            if (FC.cam) FC.cam.shake(0.18);
            if (FC.audio) FC.audio.play("punch");
            if (FC.fx) FC.fx.haptic("light");
            if (Math.random() < 0.4) FC.people.say(c, pick(LINES.hitback), 1.2);
          }, 230);
        }
      }
      return true;
    };
  }
  function react(ch, how) {
    if (cur && cur.ch === ch) end(false);
    if (ch.kind !== "ped" && ch.kind !== "npc") return;
    var p = persona(ch), r = Math.random(), inside = ch.room != null;
    if (how === "car") { ch.pause = 2; ch.angry = clockS() + 3; FC.people.say(ch, pick(LINES.car), 2.5); if (FC.humans) FC.humans.play(ch, "angry", { rate: 1.3 }); return; }
    if (inside) {                                         // в здании не бегают и не дерутся — ругаются и звонят
      if (r < 0.5) call(ch); else snap(ch);
      return;
    }
    if (how === "up" && r < 0.18) { ch.pause = 3; FC.people.say(ch, pick(LINES.dazed), 2.8); if (FC.humans) FC.humans.play(ch, "look", { rate: 1.4 }); return; }
    // характер решает: смелые дают сдачи, осторожные звонят, пугливые бегут
    if (ch.kind === "ped" && p > 0.72 && nearPlayer(ch, 10) && !(ch._hs && ch._hs.v.old)) fight(ch);
    else if (p > 0.5) call(ch);
    else if (p > 0.3) snap(ch);
    else flee(ch);
  }
  FC.on("ped:slap", function (e) {
    var ch = e && e.ch; if (!ch) return;
    FC.people.say(ch, pick(LINES.slap), 1.6);
    setTimeout(function () { if (!(ch.knocked > 0)) react(ch, "slap"); }, 450);
  });
  FC.on("human:up", function (e) {
    var ch = e && e.ch; if (!ch) return;
    react(ch, nearPlayer(ch, 14) ? "up" : "car");
  });

  /* ---- болтовня в кружках (fpeople.group) ---------------------------------------------------------------------- */
  function chatter(ch) {
    var P = FC.player;
    if (!ch || !P || FC.dist2(ch.x, ch.z, P.x, P.z) > 26 * 26) return;
    FC.people.say(ch, pick(LINES.chatter), 3);
  }

  FC.talk = { start: start, end: end, chatter: chatter, lines: LINES, react: react, get open() { return !!cur; } };
})(window);
