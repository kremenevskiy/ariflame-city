/* Флейм-Сити — фоторежим, мгновенный повтор и «поделиться» (FC.photo). Задача: «то, что будут
 * стримить и клипать — вау, это мой город». Ресерч (cis_rp_games_and_virality.md): фоторежим + сторис Telegram с
 * ссылкой-телепортом в точку снимка, водяной знак, мгновенный повтор аварий и трюков.
 *
 * Фоторежим (📸, клавиша O): мир на паузе, свободная камера вокруг героя (палец/мышь — облёт, щипок/колесо — ближе,
 * WASD/QE и два пальца — сдвиг), зум, наклон, время суток, фильтры, позы (FC.emit("photo:pose", {id}) — анимацию
 * делает модуль людей; без него — наклон фигурки), спрятать интерфейс, кадр «Сторис 9:16» или «Весь экран».
 * Снимок: кадр рисуется заново (на телефоне — с повышенным разрешением), фильтр — цветовой матрицей, водяной знак
 * «Флейм-Сити · <место>» и адрес игры; JPEG до 900 КБ. Дальше — «В сторис» (Telegram shareToStory: кадр уходит на
 * игровой сервер POST /g/photo и живёт 48 ч), «Другу» (t.me/share), «Сохранить» (downloadFile / скачать), «Ссылка».
 * Ссылка-телепорт: Telegram — t.me/<бот>?startapp=fc_<f|m>_<x>_<z> (n — минус; бот — config.js telegramBot), сайт —
 * <адрес игры>?city=…&at=x,z (config.js site). При заходе по ней — перенос в точку.
 *
 * Повтор (⏪, клавиша K): кольцевой буфер последних 8 с — игрок, машины до 90 м и люди до 60 м, 15 раз в секунду (только
 * числа, не видео). Показ — мир на паузе, состояния подставляются в машины и людей (FC.cars.render, FC.people.draw),
 * облёт камерой, замедление, перемотка; «Сохранить момент» — фоторежим в этом кадре. После аварии, взрыва, трюка или
 * эффектного попадания на 6 с всплывает кнопка «⏪ Повтор».
 * Сервер игры — FC.gs() (config.js; ?gs=http://localhost:8091 локально).
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE, M = FC.map, G = FC.gfx, I = FC.input;
  var TG = global.Telegram && global.Telegram.WebApp;
  var tgOn = !!(TG && TG.initData);
  // ссылки «поделиться»: сайт игры (config.js site, иначе адрес страницы) и, если задан, бот Telegram (t.me/<бот>?startapp=…)
  var SITE = FC.cfg.site, BOT = FC.cfg.telegramBot ? "https://t.me/" + FC.cfg.telegramBot : null;
  var SITE_HOST = (function () { try { var u = new URL(SITE); return u.host + u.pathname.replace(/\/(index\.html)?$/, ""); } catch (e) { return ""; } })();
  function esc(s) { return FC.hud.esc(s); }
  function snd(n, o) { if (FC.audio) FC.audio.play(n, o); }
  function tgv(v) { try { return tgOn && TG.isVersionAtLeast && TG.isVersionAtLeast(v); } catch (e) { return false; } }


  /* ---- место: ориентир (в Минске — не госздания и не мемориалы), улица, район ---------------------------------- */
  var BAD = /президент|министер|суд\b|суда|прокурат|комитет|кгб|мвд|омон|милиц|исполком|администрац|мемориал|памятник|воинск|войск|храм|собор|костёл|церк|часовн|мечеть|синагог|могил|кладбищ/i;  // guard:allow
  function placeName(x, z) {
    if (M.minsk && M.marks) {
      var best = null, bd = 350 * 350;
      M.marks.forEach(function (m) {
        var d = FC.dist2(m[1], m[2], x, z);
        if (d < bd && !BAD.test(m[0]) && !(M.gov && M.gov(m[1], m[2])) && !(M.quiet && M.quiet(m[1], m[2])) && m[0].length < 40) { bd = d; best = m[0]; }
      });
      if (best) return best;
    }
    var st = FC.story && FC.story.streetAt ? FC.story.streetAt(x, z) : null, dn = M.district(x, z).name;
    return st && st !== dn ? st + ", " + dn : dn;
  }
  function num(n) { n = Math.round(n); return n < 0 ? "n" + (-n) : String(n); }
  function links(x, z) {
    var c = FC.city === "minsk" ? "m" : "f";
    var web = SITE + "?city=" + FC.city + "&at=" + Math.round(x) + "," + Math.round(z);
    return { tg: BOT ? BOT + "?startapp=fc_" + c + "_" + num(x) + "_" + num(z) : web, web: web };
  }
  FC.placeName = placeName;

  /* ---- заход по ссылке-телепорту ------------------------------------------------------------------------------ */
  function inBounds(x, z) {
    var b = M.mapBounds || [-1250, -1250, 1250, 1250];
    return x > b[0] && x < b[2] && z > b[1] && z < b[3];
  }
  function parseAt() {
    var m = location.search.match(/[?&]at=(-?\d{1,6}),(-?\d{1,6})/);
    var sp = TG && TG.initDataUnsafe && TG.initDataUnsafe.start_param;
    if (m) { try { if (sp) global.sessionStorage.setItem("fc.at", sp); } catch (e) { /* без хранилища */ } return { x: +m[1], z: +m[2], src: "url" }; }
    var s = sp && /^fc_([fm])_(n?\d{1,6})_(n?\d{1,6})$/.exec(sp);
    if (!s) return null;
    try { if (global.sessionStorage.getItem("fc.at") === sp) return null; global.sessionStorage.setItem("fc.at", sp); } catch (e) { /* без хранилища */ }
    function dec(v) { return v[0] === "n" ? -+v.slice(1) : +v; }
    var city = s[1] === "m" ? "minsk" : "flame", at = { x: dec(s[2]), z: dec(s[3]), src: "tg" };
    if (city !== FC.city) {
      try { global.localStorage.setItem("fc.city", city); } catch (e) { /* приватное окно */ }
      var u = new URL(location.href); u.searchParams.set("city", city); u.searchParams.set("at", at.x + "," + at.z);
      location.replace(u.toString()); return null;
    }
    return at;
  }
  FC.on("start", function () {
    var at = parseAt(); if (!at) return;
    try { var u = new URL(location.href); if (u.searchParams.has("at")) { u.searchParams.delete("at"); global.history.replaceState(null, "", u.toString()); } } catch (e) { /* старый браузер */ }
    if (!inBounds(at.x, at.z)) return;
    setTimeout(function () {
      if (FC.hud.teleport(at.x, at.z)) setTimeout(function () { FC.hud.toast("📍 Ты там, где сделан кадр: " + placeName(at.x, at.z), "ok", 4); }, 700);
    }, 900);
  });

  /* ---- стили ----------------------------------------------------------------------------------------------- */
  FC.css([
    "body.photo #hud>:not(.toasts),body.photo #pad,body.photo .tbtn,body.photo .wpill,body.photo .gx,body.photo .gscope,body.photo #bubbles,",
    "body.photo .fx-pops,body.photo .mp-online,body.photo #mp-tags,body.photo .fh-pill,body.photo .fe-chip,body.photo .ph-chip,body.photo #fx-vig{display:none!important}",
    ".ph-ui{position:fixed;inset:0;z-index:12;display:none;pointer-events:none;font:600 13px system-ui;color:#fff}",
    "body.photo .ph-ui{display:block}.ph-cap{position:absolute;inset:0;pointer-events:auto;touch-action:none;cursor:grab}",
    ".ph-frame{position:absolute;top:0;bottom:0;left:50%;transform:translateX(-50%);aspect-ratio:9/16;max-width:100%;border:1.5px solid rgba(255,255,255,.55);",
    " box-shadow:0 0 0 100vmax rgba(0,0,0,.32);pointer-events:none;display:none}.ph-ui.story .ph-frame{display:block}",
    ".ph-top{position:absolute;left:12px;right:12px;top:calc(10px + var(--safe-t));display:flex;gap:8px;align-items:center;pointer-events:auto}",
    ".ph-top b{flex:1;font:800 italic 18px Georgia,serif;text-shadow:0 2px 6px #000}.ph-top button,.ph-bar button{border:1px solid rgba(255,207,122,.35);",
    " background:rgba(12,16,32,.72);color:#fff;border-radius:12px;padding:7px 11px;font:700 13px system-ui;cursor:pointer;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}",
    ".ph-top button.on,.ph-bar button.on{background:#ffcf7a;color:#2a1205;border-color:#ffcf7a}",
    ".ph-panel{position:absolute;left:0;right:0;bottom:0;padding:8px 10px calc(10px + var(--safe-b));pointer-events:auto;",
    " background:linear-gradient(0deg,rgba(5,8,18,.78),rgba(5,8,18,0))}",
    ".ph-bar{display:flex;gap:6px;overflow-x:auto;padding:3px 2px;scrollbar-width:none}.ph-bar::-webkit-scrollbar{display:none}.ph-bar button{flex:none}",
    ".ph-sl{display:flex;gap:10px;align-items:center;margin:4px 2px;font-size:12px;color:rgba(255,245,230,.8)}.ph-sl label{display:flex;align-items:center;gap:6px;flex:1}",
    ".ph-sl input{flex:1;accent-color:#ffcf7a;min-width:60px}",
    ".ph-shoot{display:flex;justify-content:center;align-items:center;gap:22px;margin-top:6px}",
    ".ph-shoot .sh{width:66px;height:66px;border-radius:50%;border:4px solid #fff;background:radial-gradient(circle,#fff 55%,rgba(255,255,255,.2) 56%);cursor:pointer}",
    ".ph-shoot .sh:active{transform:scale(.92)}.ph-shoot button.sm{width:46px;height:46px;border-radius:50%;border:1px solid rgba(255,255,255,.35);background:rgba(12,16,32,.7);font-size:20px;cursor:pointer;color:#fff}",
    ".ph-ui.clean .ph-top,.ph-ui.clean .ph-panel,.ph-ui.clean .ph-frame{display:none}",
    ".ph-hint{position:absolute;left:50%;top:calc(56px + var(--safe-t));transform:translateX(-50%);font-size:12px;color:rgba(255,245,230,.75);text-shadow:0 1px 3px #000;white-space:nowrap;pointer-events:none}",
    ".ph-flash{position:fixed;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:13;transition:opacity .35s}",
    ".ph-sheet{position:fixed;inset:0;z-index:14;display:none;align-items:center;justify-content:center;background:rgba(5,8,18,.82);pointer-events:auto;padding:12px}",
    ".ph-sheet.on{display:flex}.ph-card{width:min(420px,96vw);max-height:96vh;overflow:auto;background:rgba(14,18,36,.97);border:1px solid rgba(255,207,122,.35);border-radius:20px;padding:12px;text-align:center}",
    ".ph-card img{max-width:100%;max-height:52vh;border-radius:12px;display:block;margin:0 auto 10px;box-shadow:0 8px 30px rgba(0,0,0,.5)}",
    ".ph-card .acts{display:grid;grid-template-columns:1fr 1fr;gap:8px}.ph-card button{border:0;border-radius:12px;padding:11px 8px;font:700 14px system-ui;cursor:pointer;",
    " background:rgba(255,255,255,.1);color:#fff}.ph-card button.main{background:linear-gradient(90deg,#ffcf7a,#ff9b4a);color:#2a1205;grid-column:1/-1}",
    ".ph-card p{margin:8px 0 0;font-size:12px;color:rgba(255,245,230,.6)}.ph-card .st{min-height:16px;margin:6px 0 0;font-size:12px;color:#9dffbf}",
    ".ph-chip{position:fixed;left:50%;top:calc(64px + var(--safe-t));transform:translateX(-50%);z-index:7;pointer-events:auto;display:none;",
    " background:rgba(12,16,32,.84);border:1px solid rgba(255,207,122,.5);color:#fff;border-radius:16px;padding:8px 14px;font:800 14px system-ui;cursor:pointer;animation:pop .25s}",
    ".ph-chip.on{display:block}",
    ".rp-ui{position:fixed;left:0;right:0;bottom:0;z-index:12;display:none;padding:10px 12px calc(12px + var(--safe-b));pointer-events:auto;",
    " background:linear-gradient(0deg,rgba(5,8,18,.85),rgba(5,8,18,0));font:700 13px system-ui;color:#fff}",
    "body.replay .rp-ui{display:block}body.replay #hud>:not(.toasts),body.replay #pad,body.replay .tbtn,body.replay .wpill,body.replay .gx,body.replay #bubbles,body.replay .fe-chip{display:none!important}",
    ".rp-ui .row{display:flex;gap:8px;align-items:center}.rp-ui input{flex:1;accent-color:#ff5d6c}.rp-ui button{border:1px solid rgba(255,207,122,.35);",
    " background:rgba(12,16,32,.72);color:#fff;border-radius:12px;padding:8px 11px;font:700 13px system-ui;cursor:pointer}.rp-ui button.on{background:#ffcf7a;color:#2a1205}",
    ".rp-ui button.main{background:linear-gradient(90deg,#ffcf7a,#ff9b4a);color:#2a1205;border:0}",
    ".rp-tag{position:fixed;left:14px;top:calc(12px + var(--safe-t));z-index:12;display:none;font:900 italic 22px Georgia,serif;color:#ff5d6c;text-shadow:0 2px 8px #000;letter-spacing:.05em}",
    "body.replay .rp-tag{display:block}.rp-tag i{display:inline-block;width:12px;height:12px;border-radius:50%;background:#ff3b4e;margin-right:8px;animation:sflash 1s infinite}"
  ].join("\n"));

  /* ---- фильтры: CSS для предпросмотра, та же цветовая матрица для снимка ------------------------------------------ */
  var FILTERS = [
    { id: "none", name: "Как есть", ops: [] },
    { id: "street", name: "Улица", ops: [["contrast", 1.12], ["saturate", 1.15]] },
    { id: "noir", name: "Нуар", ops: [["grayscale", 1], ["contrast", 1.3], ["brightness", 0.95]], vig: 0.5 },
    { id: "sunset", name: "Закат", ops: [["sepia", 0.35], ["saturate", 1.4], ["hue-rotate", -12], ["brightness", 1.05]], vig: 0.25 },
    { id: "neon", name: "Неон-ночь", ops: [["saturate", 1.8], ["contrast", 1.15], ["hue-rotate", 14]], vig: 0.35 },
    { id: "film", name: "Плёнка", ops: [["sepia", 0.22], ["contrast", 0.92], ["brightness", 1.07], ["saturate", 0.85]], grain: 14, vig: 0.3 },
    { id: "retro", name: "Ретро", ops: [["sepia", 0.55], ["saturate", 0.9], ["contrast", 1.1]], grain: 18, vig: 0.45 },
    { id: "cold", name: "Холод", ops: [["saturate", 0.8], ["hue-rotate", 18], ["contrast", 1.05]] }
  ];
  function cssOf(f) { return f.ops.map(function (o) { return o[0] + "(" + o[1] + (o[0] === "hue-rotate" ? "deg" : "") + ")"; }).join(" "); }
  // матрицы 3×3 + сдвиг по спецификации Filter Effects (sepia, saturate, hueRotate, grayscale), яркость/контраст — линейно
  function matOf(f) {
    var m = [1, 0, 0, 0, 1, 0, 0, 0, 1], off = [0, 0, 0];
    function mul(a) { var r = []; for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * m[j] + a[i * 3 + 1] * m[3 + j] + a[i * 3 + 2] * m[6 + j];
      var o = [0, 1, 2].map(function (i) { return a[i * 3] * off[0] + a[i * 3 + 1] * off[1] + a[i * 3 + 2] * off[2]; }); m = r; off = o; }
    f.ops.forEach(function (o) {
      var k = o[1], c, s;
      if (o[0] === "grayscale") { var g = 1 - k; mul([0.2126 + 0.7874 * g, 0.7152 - 0.7152 * g, 0.0722 - 0.0722 * g, 0.2126 - 0.2126 * g, 0.7152 + 0.2848 * g, 0.0722 - 0.0722 * g, 0.2126 - 0.2126 * g, 0.7152 - 0.7152 * g, 0.0722 + 0.9278 * g]); }
      else if (o[0] === "sepia") { var q = 1 - k; mul([0.393 + 0.607 * q, 0.769 - 0.769 * q, 0.189 - 0.189 * q, 0.349 - 0.349 * q, 0.686 + 0.314 * q, 0.168 - 0.168 * q, 0.272 - 0.272 * q, 0.534 - 0.534 * q, 0.131 + 0.869 * q]); }
      else if (o[0] === "saturate") { mul([0.213 + 0.787 * k, 0.715 - 0.715 * k, 0.072 - 0.072 * k, 0.213 - 0.213 * k, 0.715 + 0.285 * k, 0.072 - 0.072 * k, 0.213 - 0.213 * k, 0.715 - 0.715 * k, 0.072 + 0.928 * k]); }
      else if (o[0] === "hue-rotate") { var a = k * Math.PI / 180; c = Math.cos(a); s = Math.sin(a);
        mul([0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283,
          0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072]); }
      else if (o[0] === "brightness") mul([k, 0, 0, 0, k, 0, 0, 0, k]);
      else if (o[0] === "contrast") { mul([k, 0, 0, 0, k, 0, 0, 0, k]); off = off.map(function (v) { return v + (0.5 - 0.5 * k); }); }
    });
    return { m: m, off: off };
  }
  function applyFilter(ctx, w, h, f) {
    if (!f.ops.length && !f.grain) return;
    var img = ctx.getImageData(0, 0, w, h), d = img.data, X = matOf(f), m = X.m, o0 = X.off[0] * 255, o1 = X.off[1] * 255, o2 = X.off[2] * 255, gr = f.grain || 0;
    for (var i = 0; i < d.length; i += 4) {
      var r = d[i], g = d[i + 1], b = d[i + 2], n = gr ? (Math.random() - 0.5) * gr : 0;
      d[i] = m[0] * r + m[1] * g + m[2] * b + o0 + n;
      d[i + 1] = m[3] * r + m[4] * g + m[5] * b + o1 + n;
      d[i + 2] = m[6] * r + m[7] * g + m[8] * b + o2 + n;
    }
    ctx.putImageData(img, 0, 0);
  }
  function vignette(ctx, w, h, k) {
    if (!k) return;
    var g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0," + k + ")");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }

  /* ---- фоторежим ------------------------------------------------------------------------------------------- */
  var PM = { on: false, yaw: 0, pitch: 0.3, dist: 6, fov: 55, roll: 0, f: new T.Vector3(), base: new T.Vector3(), filter: FILTERS[0], story: true, clean: false,
    hour0: 0, pose: null, hideMe: false, want: false, keys: {}, last: null, shots: [] };
  var ui = document.createElement("div"); ui.className = "ph-ui story";
  ui.innerHTML = "<div class='ph-cap'></div><div class='ph-frame'></div><div class='ph-hint'></div>" +
    "<div class='ph-top'><b>📸 Фоторежим</b><button type='button' data-a='frame' class='on'>9:16</button><button type='button' data-a='clean'>👁</button><button type='button' data-a='x'>✕</button></div>" +
    "<div class='ph-panel'><div class='ph-bar' data-k='f'></div><div class='ph-bar' data-k='p'></div>" +
    "<div class='ph-sl'><label>🔍<input type='range' min='18' max='90' value='55' data-s='fov'></label><label>↻<input type='range' min='-30' max='30' value='0' data-s='roll'></label>" +
    "<label>🕘<input type='range' min='0' max='47' value='18' data-s='hour'></label></div>" +
    "<div class='ph-shoot'><button type='button' class='sm' data-a='me' title='Без меня'>🙈</button><button type='button' class='sh' data-a='shot' aria-label='Снять'></button>" +
    "<button type='button' class='sm' data-a='replay' title='Повтор'>⏪</button></div></div>";
  document.body.appendChild(ui);
  var cap = ui.querySelector(".ph-cap"), hint = ui.querySelector(".ph-hint");
  var flashEl = document.createElement("div"); flashEl.className = "ph-flash"; document.body.appendChild(flashEl);
  var POSES = [["stand", "🧍 Стойка"], ["wave", "👋 Привет"], ["peace", "✌️ Победа"], ["cool", "😎 Круто"], ["selfie", "🤳 Селфи"], ["dance", "💃 Танец"], ["jump", "🦘 Прыжок"]];
  ui.querySelector("[data-k='f']").innerHTML = FILTERS.map(function (f, i) { return "<button type='button' data-f='" + i + "'" + (i ? "" : " class='on'") + ">" + esc(f.name) + "</button>"; }).join("");
  ui.querySelector("[data-k='p']").innerHTML = POSES.map(function (p) { return "<button type='button' data-pose='" + p[0] + "'>" + p[1] + "</button>"; }).join("");

  function playerFocus(out) {
    var P = FC.player, car = P.mode === "car" && P.car;
    return out.set(car ? car.x : P.x, (car ? 0 : (P.y || 0)) + (car ? 1.1 : 1.3), car ? car.z : P.z);
  }
  function openPhoto() {
    if (PM.on || !FC.started) return false;
    var wasPaused = RP.on ? RP.wasPaused : !!FC.paused;              // из повтора: мир на паузе из-за него, а не до него
    if (RP.on) { RP.keep = true; closeReplayUI(); }
    PM.on = true; PM.wasPaused = wasPaused; FC.paused = true; I.enable(false); I.unlock();
    playerFocus(PM.f); PM.base.copy(PM.f);
    var c = G.camera.position, dx = c.x - PM.f.x, dy = c.y - PM.f.y, dz = c.z - PM.f.z;
    PM.dist = FC.clamp(Math.hypot(dx, dy, dz), 2, 30); PM.yaw = Math.atan2(dx, dz); PM.pitch = FC.clamp(Math.asin(dy / (PM.dist || 1)), -0.15, 1.4);
    PM.fov = Math.round(G.camera.fov); PM.roll = 0; PM.hour0 = FC.clock.t; PM.pose = null; PM.hideMe = false;
    ui.querySelector("[data-s='fov']").value = PM.fov; ui.querySelector("[data-s='roll']").value = 0;
    ui.querySelector("[data-s='hour']").value = Math.floor(FC.clock.t / 1800);
    document.body.classList.add("photo"); setClean(false);
    hint.textContent = FC.input.touch ? "палец — облёт · щипок — ближе · два пальца — сдвиг" : "мышь — облёт · колесо — ближе · WASD/QE — сдвиг · Пробел — снять · H — без интерфейса";
    FC.emit("photo:open", {});
    snd("blip", { vol: 0.5 });
    return true;
  }
  function closePhoto() {
    if (!PM.on) return;
    PM.on = false;
    document.body.classList.remove("photo"); G.renderer.domElement.style.filter = "";
    FC.setHour(PM.hour0 / 3600);
    var P = FC.player; if (P.ch) { P.ch.lean = 0; P.ch.tilt = 0; P.ch.land = 0; }
    if (PM.pose) FC.emit("photo:pose", { id: null });
    G.camera.up.set(0, 1, 0);
    if (RP.keep) { RP.keep = false; restoreReplay(); }
    FC.paused = PM.wasPaused; I.enable(true);
    if (PM.hideMe && P.ch) P.ch.visible = true;
    FC.emit("photo:close", {});
  }
  function setClean(on) { PM.clean = on; ui.classList.toggle("clean", on); }
  function redrawWorld() { if (FC.people.draw) FC.people.draw(0); }
  function setPose(id) {
    PM.pose = id; var P = FC.player, ch = P.ch; if (!ch) return;
    ch.lean = id === "cool" ? -0.18 : id === "selfie" ? 0.22 : id === "peace" ? 0.12 : id === "wave" ? -0.1 : 0;
    ch.tilt = id === "dance" ? 0.35 : 0; ch.land = id === "jump" ? -0.15 : 0;
    ch.y = (FC.player.y || 0) + (id === "jump" ? 0.6 : 0);
    FC.emit("photo:pose", { id: id });
    redrawWorld();
  }
  function photoCam(dt) {
    var k = PM.keys, sp = (k.ShiftLeft ? 14 : 5) * dt, fx = -Math.sin(PM.yaw), fz = -Math.cos(PM.yaw), rx = Math.cos(PM.yaw), rz = -Math.sin(PM.yaw);
    var mx = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0), mz = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0), my = (k.KeyE ? 1 : 0) - (k.KeyQ ? 1 : 0);
    if (k.ArrowLeft) PM.yaw += dt * 1.4; if (k.ArrowRight) PM.yaw -= dt * 1.4;
    if (k.ArrowUp) PM.pitch = Math.min(1.45, PM.pitch + dt); if (k.ArrowDown) PM.pitch = Math.max(-0.25, PM.pitch - dt);
    PM.f.x += (fx * mz + rx * mx) * sp; PM.f.z += (fz * mz + rz * mx) * sp; PM.f.y = FC.clamp(PM.f.y + my * sp, 0.3, 60);
    // не дальше 80 м от героя: дальше город может быть не догружен
    var ox = PM.f.x - PM.base.x, oz = PM.f.z - PM.base.z, ol = Math.hypot(ox, oz);
    if (ol > 80) { PM.f.x = PM.base.x + ox / ol * 80; PM.f.z = PM.base.z + oz / ol * 80; }
    var cp = Math.cos(PM.pitch), c = G.camera;
    c.position.set(PM.f.x + Math.sin(PM.yaw) * cp * PM.dist, Math.max(0.25, PM.f.y + Math.sin(PM.pitch) * PM.dist), PM.f.z + Math.cos(PM.yaw) * cp * PM.dist);
    c.up.set(0, 1, 0); c.lookAt(PM.f);
    if (PM.roll) c.rotateZ(PM.roll * Math.PI / 180);
    if (Math.abs(c.fov - PM.fov) > 0.01) { c.fov = PM.fov; c.updateProjectionMatrix(); }
    G.focus = PM.f;
    G.renderer.domElement.style.filter = cssOf(PM.filter);
  }
  // облёт и масштаб: мышь, касания, колесо
  var ptrs = {}, pinch0 = 0, mid0 = null;
  cap.addEventListener("pointerdown", function (e) { ptrs[e.pointerId] = { x: e.clientX, y: e.clientY }; cap.setPointerCapture(e.pointerId); pinch0 = 0; mid0 = null; });
  cap.addEventListener("pointermove", function (e) {
    var p = ptrs[e.pointerId]; if (!p) return;
    var dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    var ids = Object.keys(ptrs);
    if (ids.length === 1) { PM.yaw -= dx * 0.006; PM.pitch = FC.clamp(PM.pitch + dy * 0.005, -0.25, 1.45); }
    else if (ids.length === 2) {
      var a = ptrs[ids[0]], b = ptrs[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (pinch0) PM.dist = FC.clamp(PM.dist * pinch0 / Math.max(20, d), 1.2, 40);
      if (mid0) { var k = PM.dist * 0.0025, fx = -Math.sin(PM.yaw), fz = -Math.cos(PM.yaw), rx = Math.cos(PM.yaw), rz = -Math.sin(PM.yaw);
        PM.f.x -= (rx * (mx - mid0.x) - fx * (my - mid0.y)) * k; PM.f.z -= (rz * (mx - mid0.x) - fz * (my - mid0.y)) * k; }
      pinch0 = d; mid0 = { x: mx, y: my };
    }
  });
  function ptrUp(e) { delete ptrs[e.pointerId]; pinch0 = 0; mid0 = null; }
  cap.addEventListener("pointerup", ptrUp); cap.addEventListener("pointercancel", ptrUp);
  cap.addEventListener("wheel", function (e) { e.preventDefault(); PM.dist = FC.clamp(PM.dist * (e.deltaY > 0 ? 1.12 : 0.89), 1.2, 40); }, { passive: false });
  cap.addEventListener("click", function () { if (PM.clean) setClean(false); });
  ui.addEventListener("input", function (e) {
    var s = e.target.dataset && e.target.dataset.s; if (!s) return;
    if (s === "fov") PM.fov = +e.target.value;
    if (s === "roll") PM.roll = +e.target.value;
    if (s === "hour") { FC.setHour(+e.target.value / 2); }
  });
  ui.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    e.stopPropagation();
    if (b.dataset.f != null) { PM.filter = FILTERS[+b.dataset.f]; ui.querySelectorAll("[data-f]").forEach(function (x) { x.classList.toggle("on", x === b); }); }
    else if (b.dataset.pose) { setPose(b.dataset.pose); ui.querySelectorAll("[data-pose]").forEach(function (x) { x.classList.toggle("on", x === b); }); }
    else if (b.dataset.a === "x") closePhoto();
    else if (b.dataset.a === "clean") setClean(true);
    else if (b.dataset.a === "frame") { PM.story = !PM.story; b.classList.toggle("on", PM.story); b.textContent = PM.story ? "9:16" : "Экран"; ui.classList.toggle("story", PM.story); }
    else if (b.dataset.a === "shot") shoot();
    else if (b.dataset.a === "me") { PM.hideMe = !PM.hideMe; b.classList.toggle("on", PM.hideMe); if (FC.player.ch) FC.player.ch.visible = !PM.hideMe; redrawWorld(); }
    else if (b.dataset.a === "replay") { closePhoto(); openReplay(); }
  });
  global.addEventListener("keydown", function (e) {
    if (PM.on) {
      if (sheet.classList.contains("on")) { if (e.code === "Escape") closeSheet(); return; }
      PM.keys[e.code] = true;
      if (e.code === "Escape") closePhoto();
      else if ((e.code === "Space" || e.code === "Enter") && !e.repeat) { e.preventDefault(); shoot(); }
      else if (e.code === "KeyH" && !e.repeat) setClean(!PM.clean);
      return;
    }
    if (RP.on) { if (e.code === "Escape" || e.code === "KeyK") closeReplay(); else if (e.code === "Space") { e.preventDefault(); RP.play = !RP.play; } return; }
    if (e.repeat || !I.enabled || !FC.started || (e.target && /INPUT|TEXTAREA/.test(e.target.tagName))) return;
    if (e.code === "KeyO") openPhoto();
    if (e.code === "KeyK") openReplay();
  });
  global.addEventListener("keyup", function (e) { PM.keys[e.code] = false; });

  /* ---- снимок: кадр заново (на телефоне — крупнее), фильтр, водяной знак, JPEG ------------------------------------ */
  var logo = new global.Image(); logo.src = FC.BRAND.logo;
  var frame0 = G.frame, outCv = document.createElement("canvas");
  function shoot() { if (!PM.on || PM.busy) return; PM.want = true; }
  function grab() {
    PM.busy = true;
    var r = G.renderer, src = r.domElement, pr0 = r.getPixelRatio(), W0 = global.innerWidth, H0 = global.innerHeight;
    // мало пикселей (телефон) — разово рисуем крупнее, без свечения (до ~4,2 Мп)
    // сторис 9:16 берёт всю высоту — ей нужно ~1920 px по высоте; «весь экран» — 1920 по длинной стороне
    var want = Math.min(3, Math.sqrt(4.2e6 / (W0 * H0)), Math.max(pr0, PM.story ? 1920 / H0 : 1920 / Math.max(W0, H0)));
    var big = want > pr0 * 1.1;
    if (big) { r.setPixelRatio(want); r.setSize(W0, H0, false); r.render(G.scene, G.camera); }
    var sw = src.width, sh = src.height, cw = sw, ch = sh, sx = 0, sy = 0;
    if (PM.story) { if (sw / sh > 9 / 16) { cw = Math.round(sh * 9 / 16); sx = Math.round((sw - cw) / 2); } else { ch = Math.round(sw * 16 / 9); sy = Math.round((sh - ch) / 2); if (ch > sh) { ch = sh; sy = 0; } } }
    var k = Math.min(1, (PM.story ? 1920 : 2160) / Math.max(cw, ch)), ow = Math.round(cw * k), oh = Math.round(ch * k);
    outCv.width = ow; outCv.height = oh;
    var x = outCv.getContext("2d");
    x.drawImage(src, sx, sy, cw, ch, 0, 0, ow, oh);
    // кадр для «звезды в городе» и других: что видно на снимке (проекция той же камерой)
    // в кадре: перед камерой, в пределах снимка (с запасом 10%) и не дальше 60 м
    var cam = G.camera.clone(), cpos = cam.position.clone(), see = function (px, py, pz) {
      if (cpos.distanceTo(new T.Vector3(px, py, pz)) > 60) return false;
      var v = new T.Vector3(px, py, pz).project(cam);
      if (v.z > 1 || v.z < -1) return false;
      var X = (v.x + 1) / 2 * sw, Y = (1 - v.y) / 2 * sh, mx = cw * 0.1, my = ch * 0.1;
      return X > sx - mx && X < sx + cw + mx && Y > sy - my && Y < sy + ch + my;
    };
    if (big) { r.setPixelRatio(pr0); G.resize(); }
    applyFilter(x, ow, oh, PM.filter);
    vignette(x, ow, oh, PM.filter.vig || 0.18);
    var P = FC.player, place = placeName(PM.f.x, PM.f.z);
    watermark(x, ow, oh, place);
    flashEl.style.transition = "none"; flashEl.style.opacity = "0.85"; void flashEl.offsetWidth; flashEl.style.transition = "opacity .35s"; flashEl.style.opacity = "0";
    snd("note", { vol: 0.5 }); if (FC.fx && FC.fx.haptic) FC.fx.haptic("light");
    toJpeg(outCv, function (blob) {
      PM.busy = false;
      if (!blob) { FC.hud.toast("Снимок не получился", "bad", 2); return; }
      var at = { x: PM.f.x, z: PM.f.z };
      PM.last = { blob: blob, url: URL.createObjectURL(blob), place: place, at: at, links: links(at.x, at.z), up: null };
      PM.shots.unshift(PM.last); if (PM.shots.length > 6) { URL.revokeObjectURL(PM.shots.pop().url); }
      reward(place, at);
      FC.emit("photo:shot", { x: at.x, z: at.z, place: place, see: see, player: { x: P.x, z: P.z } });
      openSheet();
    });
  }
  function toJpeg(cv, cb) {
    var q = [0.9, 0.82, 0.72, 0.6], i = 0;
    (function next() {
      cv.toBlob(function (b) { if (b && b.size > 900 * 1024 && i < q.length - 1) { i++; next(); } else cb(b); }, "image/jpeg", q[i]);
    })();
  }
  function watermark(x, w, h, place) {
    var u = Math.min(w, h) / 100, band = h * 0.15;
    var g = x.createLinearGradient(0, h - band, 0, h); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.6)");
    x.fillStyle = g; x.fillRect(0, h - band, w, band);
    var pad = u * 4, ls = u * 9, y = h - pad - u * 2;
    if (logo.complete && logo.naturalWidth) x.drawImage(logo, pad, y - ls * 0.95, ls, ls);
    var tx = pad + ls + u * 2;
    x.shadowColor = "rgba(0,0,0,.7)"; x.shadowBlur = u; x.fillStyle = "#fff"; x.textBaseline = "alphabetic";
    x.font = "800 " + (u * 4.4).toFixed(1) + "px system-ui,-apple-system,Segoe UI,Roboto,sans-serif";
    var line = "Флейм-Сити · " + place;
    while (x.measureText(line).width > w - tx - pad && line.length > 12) line = line.slice(0, -2);
    if (line !== "Флейм-Сити · " + place) line = line.replace(/\s*\S?$/, "") + "…";
    x.fillText(line, tx, y - u * 4);
    x.font = "600 " + (u * 2.8).toFixed(1) + "px system-ui,-apple-system,Segoe UI,Roboto,sans-serif"; x.fillStyle = "rgba(255,240,215,.85)";
    x.fillText((FC.city === "minsk" ? "Минск 1:1 · карта © участники OpenStreetMap" : "Флейм-Сити") + (SITE_HOST ? " · " + SITE_HOST : ""), tx, y);
    x.shadowBlur = 0;
  }
  function reward(place, at) {
    var f = FC.save.flags || (FC.save.flags = {}), day = new Date().toISOString().slice(0, 10);
    if (f.photoDay !== day) { f.photoDay = day; f.photoN = 0; }
    f.photoN = (f.photoN || 0) + 1; FC.dirty();
    if (f.photoN <= 3) { FC.money(100, "фото: " + place); }
    if (FC.social && FC.social.post) FC.social.post("📸 Новый кадр: " + place, 20 + Math.floor(Math.random() * 60), at);
    if (FC.social && FC.social.add && f.photoN <= 5) FC.social.add(5 + Math.floor(Math.random() * 10), "фото");
  }

  /* ---- поделиться ---------------------------------------------------------------------------------------- */
  var sheet = document.createElement("div"); sheet.className = "ph-sheet"; document.body.appendChild(sheet);
  function shareText(L) { return (FC.city === "minsk" ? "Я в Минске 1:1 — " : "Я во Флейм-Сити — ") + L.place + " 🔥 Заходи сюда:"; }
  function openSheet() {
    var L = PM.last; if (!L) return;
    var story = tgOn && TG.shareToStory && tgv("7.8"), dl = tgOn ? (TG.downloadFile && tgv("8.0")) : true;
    var share = !tgOn && navigator.canShare && navigator.canShare({ files: [new File([L.blob], "flame-city.jpg", { type: "image/jpeg" })] });
    sheet.innerHTML = "<div class='ph-card'><img alt='Снимок' src='" + L.url + "'>" +
      "<div class='acts'>" + (story ? "<button type='button' class='main' data-s='story'>📲 В сторис Telegram</button>" : "") +
      (tgOn ? "<button type='button' data-s='friend'>📤 Другу</button>" : share ? "<button type='button' class='" + (story ? "" : "main") + "' data-s='share'>📤 Поделиться</button>" : "") +
      (dl ? "<button type='button' data-s='save'>💾 Сохранить</button>" : "") + "<button type='button' data-s='link'>🔗 Ссылка-телепорт</button>" +
      "<button type='button' data-s='more'>📸 Ещё кадр</button><button type='button' data-s='done'>Готово</button></div>" +
      "<div class='st'></div><p>По ссылке друг окажется в этой точке " + (FC.city === "minsk" ? "Минска" : "Флейм-Сити") + ". Кадр для сторис хранится 48 часов.</p></div>";
    sheet.classList.add("on");
  }
  function closeSheet() { sheet.classList.remove("on"); }
  function status(t, bad) { var s = sheet.querySelector(".st"); if (s) { s.textContent = t; s.style.color = bad ? "#ff8a8a" : "#9dffbf"; } }
  function upload(L) {
    if (L.up) return Promise.resolve(L.up);
    var tok = FC.net && FC.net.token;
    if (!tok) return Promise.reject(new Error("Нужен вход: открой игру из Telegram или войди на сайте"));
    return FC.gfetch("/g/photo", { method: "POST", headers: { "Content-Type": "image/jpeg", "X-FC-Token": tok }, body: L.blob })
      .then(function (r) {
        if (r.status === 429) throw new Error("Слишком часто — подожди пару минут");
        if (r.status === 401) throw new Error("Нужен вход: открой игру из Telegram");
        if (!r.ok) throw new Error("Сервер кадров не ответил (" + r.status + ")");
        return r.json();
      }).then(function (j) { L.up = j.url; return j.url; });
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (ok, no) {
      var t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand("copy") ? ok() : no(); } catch (e) { no(e); } t.remove();
    });
  }
  sheet.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    var L = PM.last, s = b.dataset.s;
    if (s === "done") { closeSheet(); closePhoto(); }
    else if (s === "more") closeSheet();
    else if (s === "link") copy(tgOn ? L.links.tg : L.links.web).then(function () { status("Ссылка скопирована — отправь другу"); }, function () { status(tgOn ? L.links.tg : L.links.web); });
    else if (s === "friend") { try { TG.openTelegramLink("https://t.me/share/url?url=" + encodeURIComponent(L.links.tg) + "&text=" + encodeURIComponent(shareText(L))); FC.emit("photo:share", { how: "friend" }); } catch (x) { status("Telegram не открыл окно", true); } }
    else if (s === "share") {
      navigator.share({ files: [new File([L.blob], "flame-city.jpg", { type: "image/jpeg" })], text: shareText(L) + " " + L.links.web })
        .then(function () { status("Отправлено"); FC.emit("photo:share", { how: "share" }); }, function () { /* отменили */ });
    } else if (s === "save") {
      if (!tgOn) { var a = document.createElement("a"); a.href = L.url; a.download = "flame-city-" + FC.city + "-" + Date.now() + ".jpg"; document.body.appendChild(a); a.click(); a.remove(); status("Скачано"); return; }
      status("Готовлю файл…");
      upload(L).then(function (url) { TG.downloadFile({ url: url, file_name: "flame-city-" + FC.city + ".jpg" }, function (ok) { status(ok ? "Сохраняю" : "Отменено"); }); })
        .catch(function (x) { status(x.message, true); });
    } else if (s === "story") {
      status("Готовлю сторис…");
      upload(L).then(function (url) {
        var p = { text: (shareText(L) + " " + L.links.tg).slice(0, 200) };
        var u = TG.initDataUnsafe && TG.initDataUnsafe.user;
        if (u && u.is_premium) p.widget_link = { url: L.links.tg, name: "Играть тут" };
        TG.shareToStory(url, p);
        status("Открыл редактор сторис");
        FC.emit("photo:story", { place: L.place });
      }).catch(function (x) { status(x.message, true); });
    }
  });

  /* ---- мгновенный повтор: запись --------------------------------------------------------------------------- */
  var BUF = [], REC = 1 / 15, KEEP = 8, recT = 0;
  function snap() {
    var P = FC.player, now = performance.now() / 1000, pc = P.ch;
    var fr = { t: now, p: [P.x, P.y || 0, P.z, P.heading, P.mode === "car" ? 1 : 0], pc: pc ? [pc.face || 1, pc.tilt || 0, pc.lean || 0, pc.speed || 0, pc.phase || 0, pc.visible ? 1 : 0, pc.y || 0] : null, cars: [], peds: [] };
    var L = FC.cars ? FC.cars.list : [];
    for (var i = 0; i < L.length && fr.cars.length < 30; i++) {
      var c = L[i]; if (c.dead || FC.dist2(c.x, c.z, P.x, P.z) > 90 * 90) continue;
      fr.cars.push([c, c.x, c.z, c.heading, c.vx || 0, c.vz || 0, c.y || 0, c.roll || 0, c.pitch || 0, c.hp, c.wrecked ? 1 : 0, c.steer || 0, c.hidden ? 1 : 0]);
    }
    var A = FC.people.all;
    for (var j = 0; j < A.length && fr.peds.length < 50; j++) {
      var h = A[j]; if (h.kind === "player" || h.inside != null || h.room != null || FC.dist2(h.x, h.z, P.x, P.z) > 60 * 60) continue;
      fr.peds.push([h, h.x, h.y, h.z, h.face || 1, h.tilt || 0, h.knocked || 0, h.speed || 0, h.phase || 0, h.alpha == null ? 1 : h.alpha, h.visible === false ? 0 : 1]);
    }
    BUF.push(fr);
    while (BUF.length && now - BUF[0].t > KEEP) BUF.shift();
  }
  FC.addSystem({
    name: "replayrec", order: 97,
    update: function (dt) {
      if (!FC.started || RP.on || PM.on) return;
      if (FC.inside && FC.inside.active) { BUF.length = 0; return; }
      recT -= dt; if (recT > 0) return;
      recT = REC; snap();
    }
  });

  /* ---- повтор: показ ---------------------------------------------------------------------------------------- */
  var RP = { on: false, keep: false, t: 0, t0: 0, t1: 0, speed: 1, play: true, frames: null, saved: null, yaw: 0, pitch: 0.35, dist: 9, orbit: true };
  var rpUI = document.createElement("div"); rpUI.className = "rp-ui";
  rpUI.innerHTML = "<div class='row'><button type='button' data-r='play'>⏸</button><input type='range' min='0' max='1000' value='0' data-r='seek'>" +
    "<button type='button' data-r='slow'>🐢 ×0,25</button></div><div class='row' style='margin-top:8px'><button type='button' data-r='cam' class='on'>🎥 Облёт</button>" +
    "<button type='button' class='main' data-r='photo' style='flex:1'>📸 Сохранить момент</button><button type='button' data-r='x'>✕</button></div>";
  document.body.appendChild(rpUI);
  var rpTag = document.createElement("div"); rpTag.className = "rp-tag"; rpTag.innerHTML = "<i></i>ПОВТОР"; document.body.appendChild(rpTag);
  var seek = rpUI.querySelector("[data-r='seek']");
  function openReplay() {
    if (RP.on || PM.on || !FC.started) return false;
    if (BUF.length < 3 || BUF[BUF.length - 1].t - BUF[0].t < 1.5) { FC.hud.toast("Повтор пока пуст — нужно пару секунд на улице", "", 2.5); return false; }
    RP.frames = BUF.slice(); RP.t0 = RP.frames[0].t; RP.t1 = RP.frames[RP.frames.length - 1].t; RP.t = RP.t0;
    RP.speed = 1; RP.play = true; RP.on = true; RP.wasPaused = !!FC.paused; FC.paused = true; I.enable(false); I.unlock();
    // живое состояние — запомнить, вернуть после
    var P = FC.player, sv = { p: [P.x, P.y, P.z, P.heading], pc: P.ch ? [P.ch.face, P.ch.tilt, P.ch.lean, P.ch.speed, P.ch.phase, P.ch.visible, P.ch.y] : null, cars: new Map(), peds: new Map() };
    (FC.cars ? FC.cars.list : []).forEach(function (c) { sv.cars.set(c, [c.x, c.z, c.heading, c.vx, c.vz, c.y, c.roll, c.pitch, c.hp, c.wrecked, c.steer, c.hidden]); });
    FC.people.all.forEach(function (h) { if (h.kind !== "player") sv.peds.set(h, [h.x, h.y, h.z, h.face, h.tilt, h.knocked, h.speed, h.phase, h.alpha, h.visible]); });
    RP.frames.forEach(function (f) {
      f.cars.forEach(function (c) { if (!sv.cars.has(c[0])) sv.cars.set(c[0], null); });
      f.peds.forEach(function (h) { if (!sv.peds.has(h[0])) sv.peds.set(h[0], null); });
    });
    RP.saved = sv;
    var c = G.camera.position, fp = playerFocus(new T.Vector3());
    RP.yaw = Math.atan2(c.x - fp.x, c.z - fp.z); RP.dist = FC.clamp(Math.hypot(c.x - fp.x, c.z - fp.z), 6, 14); RP.pitch = 0.3;
    document.body.classList.add("replay"); rpUI.querySelector("[data-r='play']").textContent = "⏸";
    chip(false);
    FC.emit("replay:open", {});
    return true;
  }
  function closeReplayUI() { document.body.classList.remove("replay"); RP.on = false; }
  function closeReplay() { if (!RP.on) return; closeReplayUI(); restoreReplay(); FC.paused = RP.wasPaused; I.enable(true); FC.emit("replay:close", {}); }
  function restoreReplay() {
    var sv = RP.saved; if (!sv) return;
    var P = FC.player; P.x = sv.p[0]; P.y = sv.p[1]; P.z = sv.p[2]; P.heading = sv.p[3];
    if (P.ch && sv.pc) { P.ch.face = sv.pc[0]; P.ch.tilt = sv.pc[1]; P.ch.lean = sv.pc[2]; P.ch.speed = sv.pc[3]; P.ch.phase = sv.pc[4]; P.ch.visible = sv.pc[5]; P.ch.y = sv.pc[6]; P.ch.x = P.x; P.ch.z = P.z; }
    sv.cars.forEach(function (v, c) {
      if (!v) { c.hidden = c._rpHid ? false : c.hidden; delete c._rpHid; return; }
      c.x = v[0]; c.z = v[1]; c.heading = v[2]; c.vx = v[3]; c.vz = v[4]; c.y = v[5]; c.roll = v[6]; c.pitch = v[7]; c.hp = v[8]; c.wrecked = v[9]; c.steer = v[10]; c.hidden = v[11]; delete c._rpHid;
    });
    sv.peds.forEach(function (v, h) {
      if (!v) { if (h._rpHid) h.visible = true; delete h._rpHid; return; }
      h.x = v[0]; h.y = v[1]; h.z = v[2]; h.face = v[3]; h.tilt = v[4]; h.knocked = v[5]; h.speed = v[6]; h.phase = v[7]; h.alpha = v[8]; h.visible = v[9]; delete h._rpHid;
    });
    RP.saved = null;
    if (FC.cars && FC.cars.render) FC.cars.render(0);
    if (FC.people.draw) FC.people.draw(0);
  }
  function lerpA(a, b, k) { return a + FC.angWrap(b - a) * k; }
  function applyAt(t) {
    var F = RP.frames, i = 0;
    while (i < F.length - 2 && F[i + 1].t < t) i++;
    var A = F[i], B = F[Math.min(F.length - 1, i + 1)], k = B.t > A.t ? FC.clamp((t - A.t) / (B.t - A.t), 0, 1) : 0;
    var P = FC.player;
    P.x = FC.lerp(A.p[0], B.p[0], k); P.y = FC.lerp(A.p[1], B.p[1], k); P.z = FC.lerp(A.p[2], B.p[2], k); P.heading = lerpA(A.p[3], B.p[3], k);
    if (P.ch && A.pc) { var c0 = A.pc, c1 = B.pc || A.pc; P.ch.x = P.x; P.ch.z = P.z; P.ch.y = FC.lerp(c0[6], c1[6], k); P.ch.face = c0[0]; P.ch.tilt = FC.lerp(c0[1], c1[1], k); P.ch.lean = c0[2]; P.ch.speed = c0[3]; P.ch.phase = c0[4]; P.ch.visible = !!c0[5]; }
    var bm = new Map(); B.cars.forEach(function (c) { bm.set(c[0], c); });
    var seen = new Set();
    A.cars.forEach(function (a) {
      var c = a[0], b = bm.get(c) || a; seen.add(c);
      c.x = FC.lerp(a[1], b[1], k); c.z = FC.lerp(a[2], b[2], k); c.heading = lerpA(a[3], b[3], k); c.vx = a[4]; c.vz = a[5]; c.y = FC.lerp(a[6], b[6], k);
      c.roll = a[7]; c.pitch = a[8]; c.hp = a[9]; c.wrecked = !!a[10]; c.steer = a[11]; c.hidden = !!a[12]; c._rpHid = false;
    });
    RP.saved.cars.forEach(function (v, c) { if (!seen.has(c)) { c.hidden = true; c._rpHid = true; } });
    var pm = new Map(); B.peds.forEach(function (h) { pm.set(h[0], h); });
    var seenP = new Set();
    A.peds.forEach(function (a) {
      var h = a[0], b = pm.get(h) || a; seenP.add(h);
      h.x = FC.lerp(a[1], b[1], k); h.y = FC.lerp(a[2], b[2], k); h.z = FC.lerp(a[3], b[3], k); h.face = a[4]; h.tilt = FC.lerp(a[5], b[5], k);
      h.knocked = a[6]; h.speed = a[7]; h.phase = FC.lerp(a[8], b[8], k); h.alpha = a[9]; h.visible = !!a[10]; h._rpHid = false;
    });
    RP.saved.peds.forEach(function (v, h) { if (!seenP.has(h)) { h.visible = false; h._rpHid = true; } });
    if (FC.cars && FC.cars.render) FC.cars.render(1 / 60);
    if (FC.people.draw) FC.people.draw(1 / 60);
  }
  var rpFocus = new T.Vector3();
  function replayStep(dt) {
    if (RP.play) { RP.t += dt * RP.speed; if (RP.t > RP.t1) RP.t = RP.t0; }
    applyAt(RP.t);
    seek.value = String(Math.round((RP.t - RP.t0) / Math.max(0.001, RP.t1 - RP.t0) * 1000));
    if (RP.orbit) RP.yaw += dt * 0.35;
    playerFocus(rpFocus);
    var cp = Math.cos(RP.pitch), c = G.camera;
    c.position.set(rpFocus.x + Math.sin(RP.yaw) * cp * RP.dist, rpFocus.y + Math.sin(RP.pitch) * RP.dist, rpFocus.z + Math.cos(RP.yaw) * cp * RP.dist);
    c.up.set(0, 1, 0); c.lookAt(rpFocus); G.focus = rpFocus;
  }
  rpUI.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    var r = b.dataset.r;
    if (r === "play") { RP.play = !RP.play; b.textContent = RP.play ? "⏸" : "▶"; }
    else if (r === "slow") { RP.speed = RP.speed === 1 ? 0.25 : 1; b.classList.toggle("on", RP.speed < 1); }
    else if (r === "cam") { RP.orbit = !RP.orbit; b.classList.toggle("on", RP.orbit); }
    else if (r === "x") closeReplay();
    else if (r === "photo") { RP.play = false; openPhoto(); }
  });
  seek.addEventListener("input", function () { RP.play = false; rpUI.querySelector("[data-r='play']").textContent = "▶"; RP.t = RP.t0 + (+seek.value / 1000) * (RP.t1 - RP.t0); });
  // облёт пальцем/мышью и в повторе
  var rpDrag = null;
  G.renderer.domElement.addEventListener("pointerdown", function (e) { if (RP.on) { rpDrag = { x: e.clientX, y: e.clientY }; RP.orbit = false; rpUI.querySelector("[data-r='cam']").classList.remove("on"); } });
  global.addEventListener("pointermove", function (e) {
    if (!RP.on || !rpDrag) return;
    RP.yaw -= (e.clientX - rpDrag.x) * 0.006; RP.pitch = FC.clamp(RP.pitch + (e.clientY - rpDrag.y) * 0.005, -0.1, 1.4);
    rpDrag.x = e.clientX; rpDrag.y = e.clientY;
  });
  global.addEventListener("pointerup", function () { rpDrag = null; });
  G.renderer.domElement.addEventListener("wheel", function (e) { if (RP.on) RP.dist = FC.clamp(RP.dist * (e.deltaY > 0 ? 1.12 : 0.89), 3, 40); }, { passive: true });

  /* ---- кадр: камера фоторежима/повтора и снимок сразу после отрисовки ------------------------------------------ */
  var lastT = performance.now(), mpSys = null;
  G.frame = function (dt) {
    var now = performance.now(), rdt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
    if (RP.on) replayStep(rdt);
    if (PM.on) photoCam(rdt);
    // онлайн на паузе фоторежима: сервер рвёт молчащих 30 с — ведём его систему (в повторе — нет: там чужие позиции)
    if (PM.on && !RP.keep && FC.started) { if (!mpSys) mpSys = FC.systems.filter(function (q) { return q.name === "mp"; })[0] || 0; if (mpSys) { try { mpSys.update(rdt); } catch (e) { /* онлайн не должен ронять снимок */ } } }
    frame0(dt);
    if (PM.want) { PM.want = false; try { grab(); } catch (e) { PM.busy = false; if (global.console) console.error("photo", e); } }
  };

  /* ---- кнопка «⏪ Повтор» после яркого момента, 📸 в углу ----------------------------------------------------- */
  var chipEl = document.createElement("button"); chipEl.type = "button"; chipEl.className = "ph-chip"; chipEl.textContent = "⏪ Повтор";
  document.body.appendChild(chipEl);
  var chipT = null;
  function chip(on, label) {
    clearTimeout(chipT); chipEl.classList.toggle("on", !!on);
    if (on) { chipEl.textContent = label || "⏪ Повтор"; chipT = setTimeout(function () { chipEl.classList.remove("on"); }, 6000); }
  }
  chipEl.addEventListener("click", function (e) { e.stopPropagation(); chip(false); openReplay(); });
  var lastMoment = 0;
  function moment(label) { var t = performance.now(); if (t - lastMoment < 4000 || RP.on || PM.on) return; lastMoment = t; setTimeout(function () { chip(true, label); }, 1200); }
  FC.on("car:crash", function (e) { if (e && e.power > 14 && FC.player.mode === "car") moment("⏪ Повтор аварии"); });
  FC.on("car:explode", function () { moment("⏪ Повтор взрыва"); });
  FC.on("car:bail", function () { moment("⏪ Повтор"); });
  FC.on("stunt", function (e) { if (e && e.score >= 300) moment("⏪ Повтор трюка"); });
  FC.on("weapon:hit", function (e) { if (e && e.ko && e.head && e.id === "sniper") moment("⏪ Повтор выстрела"); });
  var corner = document.querySelector(".corner");
  if (corner) {
    var cb = document.createElement("button"); cb.type = "button"; cb.textContent = "📸"; cb.title = "Фоторежим (O), повтор (K)";
    cb.addEventListener("click", function (e) { e.stopPropagation(); openPhoto(); });
    corner.insertBefore(cb, corner.lastChild && corner.lastChild.dataset && corner.lastChild.dataset.a === "full" ? corner.lastChild : null);
  }
  FC.hud.addApp({ id: "camera", icon: "📸", name: "Камера", color: "#7048e8", order: 6, render: function (b, api) {
    var h = "<div class='list'><button type='button' data-c='photo'>📸 Фоторежим</button><button type='button' data-c='replay'>⏪ Повтор последних 8 с</button>" +
      "<div class='card'><b>Сделай кадр — отправь в сторис</b><p>Друг по ссылке окажется в этой точке. Первые 3 кадра в день — +$100.</p></div>";
    if (PM.shots.length) h += "<div class='card'><b>Последние кадры</b><div style='display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:6px'>" +
      PM.shots.map(function (s, i) { return "<img data-i='" + i + "' src='" + s.url + "' style='width:100%;border-radius:8px;cursor:pointer'>"; }).join("") + "</div></div>";
    b.innerHTML = h + "</div>";
    b.querySelector("[data-c='photo']").addEventListener("click", function () { api.close(); setTimeout(openPhoto, 300); });
    b.querySelector("[data-c='replay']").addEventListener("click", function () { api.close(); setTimeout(openReplay, 300); });
    b.querySelectorAll("img[data-i]").forEach(function (im) { im.addEventListener("click", function () { PM.last = PM.shots[+im.dataset.i]; api.close(); openSheet(); }); });
  } });

  FC.photo = { open: openPhoto, close: closePhoto, shoot: shoot, replay: openReplay, closeReplay: closeReplay, links: links, place: placeName,
    active: function () { return PM.on || RP.on; }, state: PM, replayState: RP, buffer: function () { return BUF; } };
})(window);
