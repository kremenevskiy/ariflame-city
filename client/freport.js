/* Флейм-Сити — «Сообщить о проблеме» (FC.report). 25.11.2026, слово владельца: «чтобы я нажал — и вся инфа: где он,
 * точка, что от сервера — ушла вам, сохранилась, а мне код, который я закину; и можно дописать текстом, что случилось».
 *
 * Где: пауза → «Сообщить о проблеме», телефон → приложение «Проблема», на компьютере — F8; модулям — FC.report.open(текст).
 * Что уходит (POST /g/report → server/errors.py, ответ — код вида R-7K2F; тот же сервер, чужих адресов нет):
 *   текст игрока (необязательно, ≤ 1000 знаков); снимок экрана 3D без интерфейса (по галочке, ≤ ~80 КБ);
 *   точное место (x, y, z, курс, район, здание и этаж), режим (пешком, в машине — какая, скорость, кто за рулём);
 *   что держит рядом: проверка столкновений по 8 направлениям, дома OSM рядом (id, высота, «стена без дома»), вода,
 *   дорога; кадры/с, качество, видеокарта, экран, вызовы отрисовки; онлайн (подключён ли, номер соединения, сколько
 *   рядом); версия, сеанс ошибок (sid — свяжет с /g/err) и последние 60 строк журнала игры (FC.err.log).
 * Без аккаунта, токена, ника, денег и сохранения. Онлайн выключен (?gs=off) — код не получить: «Скопировать всё».
 */
(function (global) {
  "use strict";
  var FC = global.FC;
  var CSS = [
    ".rp-back{position:fixed;inset:0;z-index:60;background:rgba(5,8,20,.55);display:flex;align-items:flex-start;justify-content:center;",
    "padding:calc(12px + env(safe-area-inset-top)) 12px 12px;pointer-events:auto}",
    ".rp{width:min(440px,100%);max-height:calc(100vh - 24px);overflow:auto;background:rgba(14,18,36,.97);border:1px solid rgba(255,207,122,.4);",
    "border-radius:16px;padding:14px 16px;color:#fff3df;font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.5)}",
    ".rp h3{margin:0 0 4px;font-size:18px;color:#ffcf7a}.rp p{margin:4px 0 10px;color:rgba(255,243,223,.72);font-size:13px}",
    ".rp textarea{width:100%;min-height:84px;resize:vertical;box-sizing:border-box;font:inherit;color:#fff3df;background:rgba(10,15,34,.8);",
    "border:1px solid rgba(255,243,223,.25);border-radius:10px;padding:9px 10px}",
    ".rp label{display:flex;gap:8px;align-items:center;margin:8px 0;font-size:13px}.rp label input{width:18px;height:18px;accent-color:#ff7a2f}",
    ".rp .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}",
    ".rp button{min-height:42px;border:0;border-radius:10px;padding:9px 14px;font:700 14px system-ui;cursor:pointer;color:#2a1205;",
    "background:linear-gradient(180deg,#ffb347,#ff7a2f)}.rp button.no{background:rgba(255,255,255,.1);color:#fff3df}",
    ".rp button:disabled{opacity:.55;cursor:default}",
    ".rp .code{font:700 34px/1.1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em;color:#fff;margin:6px 0}",
    ".rp .where{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:rgba(255,243,223,.7);word-break:break-all}",
    ".rp .err{color:#ff8d98;font-weight:600}",
  ].join("");

  function esc(s) { return FC.hud && FC.hud.esc ? FC.hud.esc(s) : String(s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
  function r1(v) { return isFinite(v) ? Math.round(v * 10) / 10 : null; }

  /* ---- что держит рядом: столкновения по 8 направлениям и дома OSM ------------------------------------------------- */
  function around(P) {
    var M = FC.map, out = { at: null, dirs: [], osm: [], water: false, road: false };
    if (!M || !M.collide) return out;
    try {
      var c0 = M.collide(P.x, P.z, 0.4);
      out.at = { hit: c0.hit, push: [r1(c0.x - P.x), r1(c0.z - P.z)] };
      for (var k = 0; k < 8; k++) {                       // шаг 1,5 м в 8 сторон: куда не пускает и насколько
        var a = k * Math.PI / 4, tx = P.x + Math.sin(a) * 1.5, tz = P.z + Math.cos(a) * 1.5, c = M.collide(tx, tz, 0.4, { prev: { x: P.x, z: P.z } });
        out.dirs.push(c.hit ? r1(Math.hypot(c.x - P.x, c.z - P.z)) : 1.5);
      }
      out.water = !!(M.water && M.water(P.x, P.z));
      out.road = !!(M.onRoad && M.onRoad(P.x, P.z));
      var O = FC.osm;
      if (O && O.near) {
        var masks = O.debug && O.debug.masks || [];
        O.near(P.x, P.z, 10).slice(0, 12).forEach(function (it) {
          var cx = (it.x0 + it.x1) / 2, cz = (it.z0 + it.z1) / 2;
          var hidden = masks.some(function (m) { return m.r != null ? Math.hypot(cx - m.x, cz - m.z) < m.r : (cx >= m.x0 && cx <= m.x1 && cz >= m.z0 && cz <= m.z1); });
          out.osm.push({ id: it.id, name: it.name || "", h: r1(it.h), mh: r1(it.mh), nocol: !!it.nocol, part: !!it.colOnly, masked: hidden || undefined,
            bb: [it.x0, it.z0, it.x1, it.z1].map(Math.round) });
        });
      }
    } catch (e) { out.fail = String(e && e.message || e).slice(0, 120); }
    return out;
  }

  function collect(text) {
    var P = FC.player || {}, G = FC.gfx || {}, d = { v: 1, text: text || "" };
    d.ctx = FC.err && FC.err.ctx ? FC.err.ctx() : {};
    d.sid = FC.err ? FC.err.sid : "";
    try { d.nick = { name: FC.nick && FC.nick.name() || "", ask: localStorage.getItem("fc.nick.ask") || "" }; } catch (e) { /* приватное окно */ }
    d.url = location.pathname + location.search.replace(/([?&](token|tgWebAppData|auth)[^&]*)/g, "");
    d.player = { x: r1(P.x), y: r1(P.y), z: r1(P.z), h: r1(P.heading != null ? P.heading : P.yaw), mode: P.mode || "", hp: P.hp, dead: !!P.dead,
      vy: r1(P.vy), swim: !!(P.swim || P.inWater) || undefined };
    var car = P.mode === "car" && P.car;
    if (car) d.player.car = { type: car.spec && (car.spec.id || car.spec.name) || car.type || "", x: r1(car.x), z: r1(car.z), speed: r1(Math.hypot(car.vx || 0, car.vz || 0)),
      driver: car.driver, inList: !!(FC.cars && FC.cars.list && FC.cars.list.indexOf(car) >= 0), dead: !!car.dead };
    try {
      var M = FC.map, D = M && M.district ? M.district(P.x, P.z) : null;
      d.place = { district: D && (D.name || D.id) || "", city: FC.city || "" };
      var I = FC.inside; if (I && I.active) d.place.inside = { building: I.building && (I.building.name || I.building.id) || "", floor: I.floor };
    } catch (e) { /* район — по возможности */ }
    if (G.camera) d.cam = { x: r1(G.camera.position.x), y: r1(G.camera.position.y), z: r1(G.camera.position.z) };
    d.around = around(P);
    if (FC.police) d.police = { stars: FC.police.stars };
    var mp = FC.mp || {};
    d.net = { on: !FC.gsOff || !FC.gsOff(), connected: !!mp.connected, id: mp.id || null, online: mp.count || 0,
      remotes: mp.remotes ? Object.keys(mp.remotes).length : undefined, close: mp.closeCode || undefined };
    try {
      var info = G.renderer && G.renderer.info;
      d.perf = { fps: FC.err && FC.err.fps ? FC.err.fps() : null, calls: info && info.render.calls, tris: info && info.render.triangles,
        geo: info && info.memory.geometries, tex: info && info.memory.textures,
        heap: global.performance && performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : undefined };
    } catch (e) { /* счётчики отрисовки — по возможности */ }
    d.log = FC.err && FC.err.log ? FC.err.log() : [];
    return d;
  }

  /* ---- снимок 3D: кадр рисуем заново и тут же копируем (буфер WebGL не хранится) — до ~80 КБ JPEG ------------------- */
  function shot(cb) {
    var G = FC.gfx;
    if (!G || !G.renderer || !G.scene || !G.camera) return cb(null);
    try {
      var src = G.renderer.domElement, w = 640, h = Math.round(640 * src.height / Math.max(1, src.width));
      G.renderer.render(G.scene, G.camera);
      var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(src, 0, 0, w, h);
      var q = [0.7, 0.55, 0.4, 0.3], i = 0;
      (function next() {
        var url = cv.toDataURL("image/jpeg", q[i]);
        if (url.length > 82000 && i < q.length - 1) { i++; return next(); }
        cb(url.length <= 82000 ? url.slice(url.indexOf(",") + 1) : null);
      })();
    } catch (e) { cb(null); }
  }

  /* ---- окно --------------------------------------------------------------------------------------------------- */
  var back = null, wasEnabled = true;
  function close() {
    if (!back) return;
    back.remove(); back = null;
    if (FC.input) FC.input.enable(wasEnabled);
  }
  function open(text) {
    if (back) return;
    if (!document.getElementById("rp-css")) { var st = document.createElement("style"); st.id = "rp-css"; st.textContent = CSS; document.head.appendChild(st); }
    // снимок — до окна (иначе в кадр попадёт затемнение... оно DOM, но кадр всё равно снимаем раньше: игра под окном стоит)
    var data = collect(""), pic = null;
    shot(function (b64) { pic = b64; });
    wasEnabled = !FC.input || FC.input.enabled !== false;
    if (FC.input) { FC.input.enable(false); if (FC.input.unlock) FC.input.unlock(); }
    back = document.createElement("div"); back.className = "rp-back";
    var MODE = { foot: "пешком", car: "в машине", ride: "пассажиром", air: "в воздухе", para: "парашют", inside: "в здании" };
    var p = data.player, where = (data.place && data.place.district ? data.place.district + " · " : "") + "x " + p.x + ", z " + p.z + " · " + (MODE[p.mode] || p.mode || "—");
    back.innerHTML = "<div class='rp' role='dialog' aria-modal='true' aria-labelledby='rp-h'><h3 id='rp-h'>Сообщить о проблеме</h3>" +
      "<p>Что случилось? Можно пусто — мы получим место, где ты стоишь, снимок экрана и журнал игры. Без аккаунта и переписки.</p>" +
      "<textarea maxlength='1000' placeholder='Например: не могу пройти между домами, упираюсь в невидимую стену'></textarea>" +
      "<label><input type='checkbox' checked> Приложить снимок экрана</label>" +
      "<div class='where'>" + esc(where) + "</div><div class='err' role='status'></div>" +
      "<div class='row'><button type='button' class='go'>Отправить</button><button type='button' class='no'>Отмена</button></div></div>";
    document.body.appendChild(back);
    var ta = back.querySelector("textarea"), box = back.querySelector(".rp"), errEl = back.querySelector(".err");
    if (text) ta.value = String(text).slice(0, 1000);
    setTimeout(function () { if (!FC.input || !FC.input.touch) ta.focus(); }, 30);
    back.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Escape") close(); }, true);
    back.addEventListener("click", function (e) { if (e.target === back) close(); });
    back.querySelector(".no").addEventListener("click", close);
    back.querySelector(".go").addEventListener("click", function () {
      var btn = this;
      data.text = ta.value.trim().slice(0, 1000);
      data.log = FC.err && FC.err.log ? FC.err.log() : data.log;
      var body = { sid: data.sid || "nosid0", data: data, shot: back.querySelector("input[type=checkbox]").checked ? pic : null };
      if (FC.gsOff && FC.gsOff()) return copyAll(box, data, "Онлайн выключен — код не получить. Скопируй всё и пришли нам:");
      btn.disabled = true; btn.textContent = "Отправляю…";
      global.fetch(FC.gs() + "/g/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.detail || r.status); return j; }); })
        .then(function (j) { done(box, j.code, where); })
        .catch(function (e) {
          btn.disabled = false; btn.textContent = "Отправить ещё раз";
          errEl.textContent = "Не отправилось (" + String(e.message || e).slice(0, 60) + "). Можно скопировать всё и прислать нам.";
          if (!box.querySelector(".cp")) {
            var b = document.createElement("button"); b.type = "button"; b.className = "no cp"; b.textContent = "Скопировать всё";
            b.addEventListener("click", function () { copy(JSON.stringify(data), b); });
            box.querySelector(".row").appendChild(b);
          }
        });
    });
  }
  function copy(t, btn) {
    var ok = function () { if (btn) { btn.textContent = "Скопировано ✓"; } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, function () { fallback(t); ok(); });
    else { fallback(t); ok(); }
  }
  function fallback(t) {
    var a = document.createElement("textarea"); a.value = t; a.style.position = "fixed"; a.style.opacity = "0"; document.body.appendChild(a);
    a.select(); try { document.execCommand("copy"); } catch (e) { /* без буфера — человек скопирует руками */ } a.remove();
  }
  function done(box, code, where) {
    box.innerHTML = "<h3>Спасибо — получили</h3><p>Код обращения — пришли его нам, по нему видно всё: место, снимок, журнал.</p>" +
      "<div class='code'>" + esc(code || "—") + "</div><div class='where'>" + esc(where) + "</div>" +
      "<div class='row'><button type='button' class='cp'>Скопировать код</button><button type='button' class='no'>Играть</button></div>";
    box.querySelector(".cp").addEventListener("click", function () { copy(code, this); });
    box.querySelector(".no").addEventListener("click", close);
    if (FC.err && FC.err.flush) FC.err.flush();
  }
  function copyAll(box, data, msg) {
    box.querySelector(".err").textContent = msg;
    copy(JSON.stringify(data), box.querySelector(".go"));
  }

  /* ---- входы: пауза, телефон, F8 ------------------------------------------------------------------------------- */
  FC.on("pause:open", function (card) {
    if (!card) return;
    var b = document.createElement("button"); b.type = "button"; b.className = "sec"; b.textContent = "🐞 Сообщить о проблеме";
    b.addEventListener("click", function () { if (FC.hud && FC.hud.pause) FC.hud.pause(false); open(); });
    card.appendChild(b);
  });
  if (FC.hud && FC.hud.addApp) FC.hud.addApp({ id: "report", icon: "🐞", name: "Проблема", color: "#8a3b3b", order: 98, render: function (b) {
    b.innerHTML = "<div class='card'><b>Что-то сломалось?</b><p>Застрял, провалился, машина пропала, всё зависло — нажми и коротко напиши. Мы получим место, снимок и журнал игры.</p>" +
      "<button type='button' class='main' id='rp-open'>Сообщить о проблеме</button></div>";
    b.querySelector("#rp-open").addEventListener("click", function () { if (FC.hud.closePhone) FC.hud.closePhone(); open(); });
  } });
  global.addEventListener("keydown", function (e) { if (e.code === "F8" && !back) { e.preventDefault(); open(); } });

  FC.report = { open: open, collect: collect };
})(window);
