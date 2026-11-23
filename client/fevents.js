/* Флейм-Сити — события города и календарь недели (FC.events). Задача: «реализм как в GTA, чтобы
 * возвращались, стримили и клипали». Ресерч: GTA Online держит еженедельными бонусами ×2 и скидками, CoC/Last War —
 * общим ритмом недели; уличные события в узнаваемых местах дают моменты для клипов.
 *
 * Календарь недели — сервер игры GET /g/events (server/events.py: сид недели, у всех одинаковый): тема,
 * ×2 и ×1,5 за работу (по причине FC.money — «такси», «курьер», «трюки», «гонка», «событие: …»), скидка в Оружейной
 * (FC.events.discount — fweap.js), гонка недели, событие недели (награда ×2), по дням — какое событие чаще, выходные —
 * события ×1,5. Кэш — localStorage до конца недели; сервер недоступен — бонусов нет, события идут. Телефон — «Афиша».
 *
 * События города — раз в 10–15 реальных минут рядом с игроком (первое — через 2–4 мин), карточка «Поехали / ✕»,
 * метка, таймер, награда, пост в «Ленту»: 🚚 инкассатор (останови фургон — забери выручку, розыск 2★), 🏎️ уличный
 * вызов (доедь до ориентира за время), 🌟 звезда в городе (сними её в фоторежиме), 💃 флешмоб у достопримечательности
 * (встань в круг), 🧳 потерянный турист (проводи), 🌮 фудтрак-ажиотаж (обслужи очередь). В Минске — у настоящих
 * ориентиров из OSM, кроме госзданий, храмов и мемориалов (M.gov, M.quiet, список BAD). Звёзды — вымышленные.
 * Отладка: FC.events.start("flashmob").
 */
(function (global) {
  "use strict";
  var FC = global.FC, M = FC.map, G = FC.gfx;
  var esc = FC.hud.esc;
  function snd(n, o) { if (FC.audio) FC.audio.play(n, o); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(l) { return l[Math.floor(Math.random() * l.length)]; }
  function inCar() { return FC.player.mode === "car" && !!FC.player.car; }
  function pop(t, c) { if (FC.hud.popup) FC.hud.popup(t, { color: c || "#ffcf7a" }); }

  /* ---- календарь недели ------------------------------------------------------------------------------------- */
  var CAL = null;
  try { var c0 = JSON.parse(global.localStorage.getItem("fc.cal") || "null"); if (c0 && c0.until > Date.now()) CAL = c0.data; } catch (e) { CAL = null; }
  function loadCal() {
    FC.gfetch("/g/events").then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !j.bonuses) return;
      j._got = Date.now(); CAL = j;
      try { global.localStorage.setItem("fc.cal", JSON.stringify({ until: Date.now() + (j.next_in || 3600) * 1000, data: j })); } catch (e) { /* без хранилища */ }
      FC.emit("events:calendar", j);
    }).catch(function () { /* сервер недоступен — неделя без бонусов */ });
  }
  function bonus(kind) { return CAL ? CAL.bonuses.filter(function (b) { return b.kind === kind; }) : []; }
  function moneyMult(why) {
    var m = 1;
    bonus("money").forEach(function (b) { try { if (new RegExp(b.match).test(why)) m = Math.max(m, b.mult); } catch (e) { /* плохая регулярка */ } });
    return m;
  }
  function discount(kind) { var s = bonus("sale").filter(function (b) { return b.shop === kind; })[0]; return s ? 1 - s.pct / 100 : 1; }
  function saleLine() { var s = bonus("sale")[0]; return s ? s.title + " — до конца недели" : ""; }
  function todayIdx() { var d = new Date().getUTCDay(); return (d + 6) % 7; }
  function eventMult(id) {
    var m = 1, ev = bonus("event")[0];
    if (ev && ev.event === id) m *= ev.mult || 2;
    if (CAL && todayIdx() >= 5) m *= CAL.weekend_mult || 1.5;
    return Math.min(2.5, m);
  }
  // ×2 за работу недели: доплата отдельной строкой — видно, что это бонус
  var money0 = FC.money, inBonus = false;
  FC.money = function (delta, why) {
    var r = money0(delta, why);
    if (r !== false && delta > 0 && why && CAL && !inBonus && !/^бонус недели/.test(why)) {
      var m = moneyMult(why);
      if (m > 1) {
        inBonus = true;
        var extra = Math.round(delta * (m - 1));
        money0(extra, "бонус недели ×" + String(m).replace(".", ",") + ": " + why);
        inBonus = false;
        pop("Бонус недели +" + FC.fmtMoney(extra), "#ff8fb8");
      }
    }
    return r;
  };

  /* ---- места: ориентиры города (Минск — OSM без госзданий и святынь), тротуар рядом ---------------------------- */
  var BAD = /президент|министер|суд\b|суда|прокурат|комитет|кгб|мвд|омон|милиц|исполком|администрац|мемориал|памятник|музей великой|воинск|войск|храм|собор|костёл|церк|часовн|мечеть|синагог|могил|кладбищ|общежит|академия управления|дворец республики/i;
  var GOOD = /библиотек|ворота минска|башни|арена|планетарий|олимпиец|парус|филармон|театр|бизнес-центр|европа|пекин|марриотт|отель|спорт|парк|сад|цирк|галере|торгов|молл|набережн/i;
  function safe(x, z) { return !(M.gov && M.gov(x, z)) && !(M.quiet && M.quiet(x, z)); }
  var SPOTS = null;
  function spots() {
    if (SPOTS) return SPOTS;
    SPOTS = [];
    if (M.minsk) {
      (M.marks || []).forEach(function (m) { if (GOOD.test(m[0]) && !BAD.test(m[0]) && safe(m[1], m[2])) SPOTS.push({ name: m[0].replace(/^Бизнес-центр /, "БЦ "), x: m[1], z: m[2] }); });
      var D = global.MINSK;
      if (D && D.spots) D.spots.forEach(function (s) { if (s[5] && !BAD.test(s[5])) { var x = (s[1] + s[3]) / 2, z = (s[2] + s[4]) / 2; if (safe(x, z)) SPOTS.push({ name: s[5], x: x, z: z }); } });
    } else {
      Object.keys(M.zones || {}).forEach(function (k) { var B = M.zones[k]; if (B && B.doors) SPOTS.push({ name: B.name, x: B.x, z: B.z }); });
      (M.pois || []).forEach(function (B) { if (B.poi !== "police" && B.poi !== "hospital" && B.doors && B.name) SPOTS.push({ name: B.name, x: B.x, z: B.z }); });
      if (M.plaza) SPOTS.push({ name: "Главная площадь", x: (M.plaza.x0 + M.plaza.x1) / 2, z: (M.plaza.z0 + M.plaza.z1) / 2 });
    }
    return SPOTS;
  }
  // ориентир в кольце min…max; нет — ближайший дальше min (до 3 км); нет и его — тротуар рядом с именем места
  function spotIn(min, max) {
    var P = FC.player, all = spots(), l = all.filter(function (s) { var d = dist(s, P); return d > min && d < max; });
    if (l.length) return pick(l);
    var far = all.filter(function (s) { var d = dist(s, P); return d > min && d < 3000; }).sort(function (a, b) { return dist(a, P) - dist(b, P); });
    if (far.length) return far[Math.floor(Math.random() * Math.min(3, far.length))];
    var sp = spotNear(min, max);
    return sp ? { name: placeOf(sp.x, sp.z), x: sp.x, z: sp.z } : null;
  }
  // тротуар у ориентира; кусок карты ещё не загружен (Минск) — точка у ближайшей полосы, сдвинутая к обочине
  function walkNear(x, z, r) {
    var R = FC.rng((Date.now() ^ (x * 7 + z * 13)) & 0xffffff);
    for (var i = 0; i < 6; i++) { var sp = M.sidewalkPoint(R, x, z, r || 40); if (sp && safe(sp.x, sp.z)) return sp; }
    if (!M.buildingAt(x, z, 1) && !M.water(x, z) && safe(x, z)) return { x: x, z: z };
    var nl = M.nearestLane(x, z);
    if (nl && safe(nl.x, nl.z)) { var l = Math.hypot(nl.dx, nl.dz) || 1; return { x: nl.x - nl.dz / l * 6, z: nl.z + nl.dx / l * 6 }; }
    return null;
  }
  function spotNear(min, max) {
    var P = FC.player, R = FC.rng(Date.now() & 0xffffff);
    for (var i = 0; i < 20; i++) { var sp = M.sidewalkPoint(R, P.x, P.z, max); if (sp && dist(sp, P) > min && safe(sp.x, sp.z)) return sp; }
    return null;
  }
  function placeOf(x, z) { return FC.placeName ? FC.placeName(x, z) : M.district(x, z).name; }

  /* ---- общие кирпичики событий ------------------------------------------------------------------------------- */
  var cev = null, nextAt = 0;
  function npc(at, opt) {
    var code = FC.people.CODES[Math.floor(Math.random() * FC.people.CODES.length)];
    var ch = FC.people.make("npc", FC.people.cellOf(code), at.x, at.z, Object.assign({ scale: 1.8, alpha: 1 }, opt || {}));
    ch.code = code; ch.update = ch.update || function () {};
    return ch;
  }
  function mark(at, icon, color, route, ring) { FC.markers.add({ id: "cev", x: at.x, z: at.z, color: color || "#ff5d8f", icon: icon, route: route !== false, ring: ring == null ? 3 : ring }); }
  function follow(o) { var m = FC.markers.all.cev; if (m) { m.x = o.x; m.z = o.z; if (m.obj) m.obj.position.set(o.x, 0, o.z); } }
  function news(text, icon) {
    FC.hud.notify("Флейм-Новости", text, icon || "📣", 6);
    if (FC.story && FC.story.post) FC.story.post({ id: "ce" + Date.now(), kind: "story", cell: FC.people.SPECIAL.guide, who: "Флейм-Новости", text: (icon || "📣") + " " + text, at: cev && cev.at ? { x: cev.at.x, z: cev.at.z } : null });
  }
  function brag(text, at, likes) { if (FC.social && FC.social.post) FC.social.post(text, likes || 60, at); }
  function pay(id, base, title) {
    var m = eventMult(id), n = Math.round(base * m);
    FC.money(n, "событие: " + title);
    return { n: n, m: m };
  }
  function end(ok, msg) {
    if (!cev) return;
    var e = cev; cev = null;
    (e.cleanup || []).forEach(function (f) { try { f(); } catch (x) { /* уборка */ } });
    FC.markers.remove("cev"); FC.interact.remove("cev");
    FC.hud.timer(null); FC.hud.objective("");
    if (msg) FC.hud.toast(msg, ok ? "ok" : "bad", 3.5);
    if (ok) { snd("mission"); if (FC.fx) FC.fx.burst(FC.player.x, 1.6, FC.player.z, "confetti", 50); }
    FC.emit("cityevent:end", { id: e.id, ok: !!ok });
    nextAt = performance.now() + rnd(600, 900) * 1000;
  }

  // карточка-приглашение
  FC.css([
    ".fe-offer{position:fixed;left:50%;top:calc(64px + env(safe-area-inset-top));transform:translateX(-50%);width:min(400px,92vw);",
    " background:linear-gradient(135deg,rgba(40,14,48,.96),rgba(14,18,36,.96));border:1px solid rgba(255,93,143,.55);border-radius:18px;padding:12px 13px;",
    " z-index:8;pointer-events:auto;animation:pop .25s;display:flex;gap:10px;align-items:center;box-shadow:0 10px 30px rgba(0,0,0,.45)}",
    ".fe-offer .ic{font-size:34px}.fe-offer div{flex:1;font-size:13px;color:rgba(255,245,230,.85)}.fe-offer b{color:#ffcf7a;display:block;font-size:14px}",
    ".fe-offer em{font-style:normal;color:#ff8fb8;font-weight:700}",
    ".fe-offer button{border:0;border-radius:11px;padding:9px 12px;font:700 13px system-ui;cursor:pointer;background:linear-gradient(90deg,#ff5d8f,#ff9b4a);color:#fff}",
    ".fe-offer button.no{background:rgba(255,255,255,.1)}",
    ".fe-chip{position:fixed;right:14px;top:calc(122px + env(safe-area-inset-top));z-index:5;pointer-events:none;display:none;",
    " background:rgba(40,14,48,.85);border:1px solid rgba(255,93,143,.5);border-radius:12px;padding:5px 10px;font:700 12px system-ui;color:#fff;max-width:56vw}",
    ".fe-chip.on{display:block}.fe-day{display:flex;gap:8px;align-items:center}.fe-day.today{color:#ffcf7a;font-weight:800}"
  ].join("\n"));
  var offerEl = null;
  function offer(E, text, onYes) {
    if (offerEl) offerEl.remove();
    var el = document.createElement("div"); el.className = "fe-offer"; offerEl = el;
    var m = eventMult(E.id);
    el.innerHTML = "<span class='ic'>" + E.icon + "</span><div><b>" + esc(E.title) + (m > 1 ? " <em>×" + String(m).replace(".", ",") + "</em>" : "") + "</b>" + esc(text) + "</div>" +
      "<button type='button' class='yes'>Поехали" + (FC.input.touch ? "" : " (Y)") + "</button><button type='button' class='no'>✕</button>";
    document.body.appendChild(el);
    snd("note");
    var kill = function () { if (offerEl === el) offerEl = null; el.remove(); };
    el.querySelector(".yes").addEventListener("click", function (e) { e.stopPropagation(); kill(); onYes(); });
    el.querySelector(".no").addEventListener("click", function (e) { e.stopPropagation(); kill(); if (cev && !cev.started) end(false); });
    // на компьютере — клавиша Y принимает (мышь захвачена — до кнопки не дотянуться)
    el._key = function (e) { if (offerEl === el && e.code === "KeyY") { kill(); onYes(); } };
    global.addEventListener("keydown", el._key);
    setTimeout(function () { global.removeEventListener("keydown", el._key); if (offerEl === el) { kill(); if (cev && !cev.started) end(false); } }, 16000);
  }
  var chipEl = document.createElement("div"); chipEl.className = "fe-chip"; document.body.appendChild(chipEl);

  /* ---- события ------------------------------------------------------------------------------------------- */
  var STARS = ["диджей Искра", "блогерша Луна Флейм", "актёр Марк Пламенный", "певица Ветта", "рэпер Огонёк-младший", "стример Кекс"];
  var EVENTS = [
    { id: "armored", title: "Инкассатор", icon: "🚚", need: function () { return !!(FC.cars && FC.cars.spawn) && !(FC.police && FC.police.stars >= 3); }, run: function (E) {
      var P = FC.player, nl = null, R = FC.rng(Date.now() & 0xffff);
      for (var i = 0; i < 12 && !nl; i++) {
        var a = R() * 6.28, d = rnd(140, 240), q = M.nearestLane(P.x + Math.cos(a) * d, P.z + Math.sin(a) * d);
        if (q && safe(q.x, q.z)) nl = q;
      }
      if (!nl) return null;
      var e = { at: { x: nl.x, z: nl.z }, cleanup: [], stage: 0, t: 150 };
      offer(E, "Фургон «Флейм-Инкассации» везёт выручку рядом. Останови его — внутри деньги. Патруль приедет быстро.", function () {
        var van = FC.cars.spawn("van", nl.x, nl.z, Math.atan2(nl.dx, nl.dz), { color: 0x34404d });
        if (FC.cars.toLane) FC.cars.toLane(van);
        van.keep = true; van.armored = true; e.van = van; e.started = true;
        e.cleanup.push(function () { van.keep = false; van.armored = false; });
        mark(van, "🚚", "#ffb02e", true, 0);
        FC.hud.timer(e.t, "🚚", function () { if (cev === e && e.stage === 0) end(false, "Инкассатор уехал"); });
        FC.hud.objective("Останови <b>инкассатора</b>: таранить или стрелять по фургону");
        news("Инкассаторский фургон замечен у " + placeOf(nl.x, nl.z), "🚚");
      });
      e.update = function (dt) {
        if (!e.started) return;
        var van = e.van;
        if (!van || van.dead) { end(false, "Фургон пропал"); return; }
        if (e.stage === 0) {
          follow(van);
          if (dist(van, FC.player) > 420) { end(false, "Инкассатор ушёл слишком далеко"); return; }
          if (van.hp < 55 || van.wrecked) {
            e.stage = 1; van.ai = null; van.driver = "none"; van.vx *= 0.3; van.vz *= 0.3;
            FC.hud.timer(60, "💰", function () { if (cev === e) end(false, "Патруль забрал выручку"); });
            FC.hud.objective("Фургон встал — <b>забери выручку</b> у задних дверей (E)");
            snd("crash"); if (FC.fx) FC.fx.burst(van.x, 1.2, van.z, "cash", 30);
            var bx = van.x - Math.sin(van.heading) * (van.spec.L / 2 + 1), bz = van.z - Math.cos(van.heading) * (van.spec.L / 2 + 1);
            e.back = { x: bx, z: bz };
            mark(e.back, "💰", "#41e08c", false, 2);
            FC.interact.add({ id: "cev", x: bx, z: bz, r: 3, label: "💰 Забрать выручку", act: function () {
              FC.interact.remove("cev");
              var r = pay("armored", rnd(1400, 2600), "инкассатор");
              FC.emit("crime", { type: "robbery", x: FC.player.x, z: FC.player.z, r: 60 });
              brag("🚚 Обчистил инкассатора у " + placeOf(bx, bz) + " — $" + r.n, e.back, 180);
              end(true, "💰 Выручка твоя · +" + FC.fmtMoney(r.n) + " · уходи от патруля!");
            } });
          }
        }
      };
      return e;
    } },
    { id: "streetrace", title: "Уличный вызов", icon: "🏎️", need: function () { return !!FC.cars; }, run: function (E) {
      var S = spotIn(450, 1100); if (!S) return null;
      var fin = walkNear(S.x, S.z, 40) || S, P = FC.player, d = dist(P, fin);
      var e = { at: fin, cleanup: [] }, limit = Math.round(d / 17 + 25);
      offer(E, "Гонщик на спорткаре: «До " + S.name + " за " + limit + " с — слабо?» Нужна машина.", function () {
        e.started = true;
        mark(fin, "🏁", "#ff9f1c", true, 8);
        FC.hud.timer(limit, "🏁", function () { if (cev === e) end(false, "Не успел — гонщик смеётся"); });
        FC.hud.objective(inCar() ? "Гони к <b>" + esc(S.name) + "</b>" : "Садись в машину (F) и гони к <b>" + esc(S.name) + "</b>");
        if (FC.cars && FC.cars.spawn) {
          var nl = M.nearestLane(P.x + 8, P.z + 8);
          if (nl) { var rv = FC.cars.spawn("sport", nl.x, nl.z, Math.atan2(nl.dx, nl.dz), { color: 0xff3d6e }); if (FC.cars.toLane) FC.cars.toLane(rv); e.cleanup.push(function () { rv.keep = false; }); }
        }
        e.t0 = performance.now(); e.limit = limit;
      });
      e.update = function () {
        if (!e.started) return;
        if (dist(FC.player, fin) < 12) {
          if (!inCar()) { FC.hud.objective("Финиш — только на машине!"); return; }
          var left = Math.max(0, e.limit - (performance.now() - e.t0) / 1000);
          var r = pay("streetrace", 500 + left * 18, "уличный вызов");
          brag("🏁 Обогнал уличного гонщика до " + S.name + " — " + Math.round((performance.now() - e.t0) / 1000) + " с", fin, 120);
          end(true, "🏆 Вызов принят и выигран · +" + FC.fmtMoney(r.n));
        }
      };
      return e;
    } },
    { id: "celebrity", title: "Звезда в городе", icon: "🌟", run: function (E) {
      var S = spotIn(150, 600); if (!S) return null;
      var at = walkNear(S.x, S.z, 30); if (!at) return null;
      var name = pick(STARS), e = { at: at, cleanup: [] };
      offer(E, "У «" + S.name + "» снимают клип — " + name + " в городе! Сделай кадр со звездой в фоторежиме 📸.", function () {
        e.started = true;
        var star = npc(at, { scale: 2.15 }), fans = [];
        star.star = true; e.star = star;
        var a0 = Math.random() * 6.28, home = { x: at.x, z: at.z };
        star.update = function (ch, dt) {
          a0 += dt * 0.25;
          var tx = home.x + Math.cos(a0) * 3, tz = home.z + Math.sin(a0) * 3, dx = tx - ch.x, dz = tz - ch.z, dd = Math.hypot(dx, dz);
          if (dd > 0.2) { ch.vx = dx / dd * 1.1; ch.vz = dz / dd * 1.1; ch.x += ch.vx * dt; ch.z += ch.vz * dt; ch.speed = 1.1; } else ch.speed = 0;
        };
        for (var i = 0; i < 7; i++) {
          var f = npc({ x: at.x + Math.cos(i) * 4.5, z: at.z + Math.sin(i) * 4.5 });
          (function (ff, k) { ff.update = function (ch, dt) { var tx = star.x + Math.cos(k) * 3.6, tz = star.z + Math.sin(k) * 3.6; ch.x += (tx - ch.x) * Math.min(1, dt * 1.5); ch.z += (tz - ch.z) * Math.min(1, dt * 1.5); ch.speed = 0.6; }; })(f, i * 0.9);
          fans.push(f);
        }
        e.cleanup.push(function () { FC.people.remove(star); fans.forEach(function (f) { FC.people.remove(f); }); });
        mark(star, "🌟", "#ffd23f", true, 0);
        FC.hud.timer(180, "🌟", function () { if (cev === e) end(false, "Звезда уехала со съёмок"); });
        FC.hud.objective("Найди <b>" + esc(name) + "</b> и сними в фоторежиме (📸 / O)");
        e.say = 0;
        e.onShot = function (s) {
          if (!s || !s.see) return;
          if (!s.see(star.x, (star.y || 0.15) + 1.6, star.z)) { FC.hud.toast("Звезды нет в кадре — поверни камеру", "bad", 2.5); return; }
          var r = pay("celebrity", rnd(450, 700), "звезда в городе");
          if (FC.social && FC.social.add) FC.social.add(150, "звезда");
          brag("🌟 Кадр с " + name + " у " + S.name + "!", at, 400);
          FC.people.say(star, "Огонь кадр! Отметь меня 🔥", 3.5);
          setTimeout(function () { end(true, "🌟 Кадр со звездой · +" + FC.fmtMoney(r.n) + " · +150 подписчиков"); }, 400);
        };
        news(name + " снимает клип у «" + S.name + "» — фанаты уже там", "🌟");
      });
      e.update = function (dt) {
        if (!e.started || !e.star) return;
        follow(e.star);
        e.say -= dt;
        if (e.say <= 0) { e.say = 4; FC.people.say(e.star, pick(["Всем привет! ✨", "Снимаем дубль!", "Кто со мной селфи?", "Ариflame — лучший город!"]).replace("Ариflame", FC.cityName), 3); }
      };
      return e;
    } },
    { id: "flashmob", title: "Флешмоб", icon: "💃", run: function (E) {
      var S = spotIn(120, 500); if (!S) return null;
      var at = walkNear(S.x, S.z, 25); if (!at) return null;
      var e = { at: at, cleanup: [], inT: 0 };
      offer(E, "У «" + S.name + "» собирается флешмоб. Успей и потанцуй в кругу 12 секунд!", function () {
        e.started = true;
        var dancers = [];
        for (var i = 0; i < 12; i++) {
          var a = i / 12 * Math.PI * 2, ch = npc({ x: at.x + Math.cos(a) * 5, z: at.z + Math.sin(a) * 5 });
          (function (c, k) {
            c.update = function (h, dt) { var t = performance.now() / 1000; h.phase += dt * 9; h.y = 0.15 + Math.abs(Math.sin(t * 4.2 + k)) * 0.35; h.lean = Math.sin(t * 4.2 + k) * 0.35; h.face = Math.sin(t * 2.1 + k) > 0 ? 1 : -1; h.speed = 0.3; };
          })(ch, i);
          dancers.push(ch);
        }
        e.dancers = dancers;
        e.cleanup.push(function () { dancers.forEach(function (c) { FC.people.remove(c); }); var P = FC.player; if (P.ch) P.ch.lean = 0; });
        mark(at, "💃", "#ff5d8f", true, 5);
        FC.hud.timer(150, "💃", function () { if (cev === e) end(false, "Флешмоб разошёлся"); });
        FC.hud.objective("Встань в <b>круг флешмоба</b> у «" + esc(S.name) + "»");
        news("Флешмоб у «" + S.name + "» — приходите танцевать!", "💃");
      });
      e.beat = 0;
      e.update = function (dt) {
        if (!e.started) return;
        var P = FC.player, d = dist(P, at);
        if (d < 35) { e.beat -= dt; if (e.beat <= 0) { e.beat = 0.48; snd("step", { vol: 1, x: at.x, z: at.z }); snd("blip", { vol: 0.25, x: at.x, z: at.z }); } }
        if (d < 5.5 && P.mode === "foot") {
          e.inT += dt;
          if (P.ch) P.ch.lean = Math.sin(performance.now() / 120) * 0.35;
          FC.emit("event:dance", { on: true });
          FC.hud.objective("Танцуй! <b>" + Math.ceil(Math.max(0, 12 - e.inT)) + "</b> с");
          if (e.inT >= 12) {
            var r = pay("flashmob", rnd(300, 450), "флешмоб");
            if (FC.social && FC.social.add) FC.social.add(80, "флешмоб");
            brag("💃 Зажёг на флешмобе у " + placeOf(at.x, at.z), at, 220);
            FC.emit("event:dance", { on: false });
            end(true, "💃 Флешмоб удался · +" + FC.fmtMoney(r.n) + " · +80 подписчиков");
          }
        } else if (e.inT > 0 && d > 7) { FC.hud.objective("Вернись в <b>круг</b>!"); }
      };
      return e;
    } },
    { id: "tourist", title: "Потерянный турист", icon: "🧳", run: function (E) {
      var sp = spotNear(30, 80); if (!sp) return null;
      var S = spotIn(300, 750); if (!S) return null;
      var dest = walkNear(S.x, S.z, 30) || S, e = { at: sp, cleanup: [], stage: 0 };
      var tour = npc(sp, { scale: 1.75 });
      e.cleanup.push(function () { FC.people.remove(tour); });
      FC.people.say(tour, "🧳 Извините… как пройти к «" + S.name + "»?", 6);
      offer(E, "Турист потерялся: ищет «" + S.name + "». Проводи — он щедро отблагодарит.", function () {
        e.started = true;
        mark(tour, "🧳", "#4cc9f0", true, 0);
        FC.hud.objective("Подойди к <b>туристу</b>");
        FC.interact.add({ id: "cev", x: tour.x, z: tour.z, r: 3, label: "🧳 Проводить туриста", act: function () {
          FC.interact.remove("cev");
          e.stage = 1; FC.people.say(tour, "Спасибо! Я за вами 🙏", 3);
          mark(dest, "📍", "#4cc9f0", true, 6);
          var lim = Math.round(dist(FC.player, dest) / 2.6 + 70);
          FC.hud.timer(lim, "🧳", function () { if (cev === e) end(false, "Турист устал и взял такси"); });
          FC.hud.objective("Проводи туриста к <b>" + esc(S.name) + "</b> — можно на машине");
        } });
      });
      tour.update = function (ch, dt) {
        if (e.stage !== 1) { ch.speed = 0; return; }
        var P = FC.player;
        if (inCar()) { ch.visible = false; ch.x = P.x; ch.z = P.z; return; }
        if (!ch.visible) { ch.visible = true; ch.x = P.x + 1.5; ch.z = P.z + 1.5; }
        var dx = P.x - ch.x, dz = P.z - ch.z, d = Math.hypot(dx, dz);
        if (d > 2.4) { var s = Math.min(7.5, d * 1.6); ch.vx = dx / d * s; ch.vz = dz / d * s; var c = M.collide(ch.x + ch.vx * dt, ch.z + ch.vz * dt, 0.35, { prev: ch }); ch.x = c.x; ch.z = c.z; ch.speed = s; }
        else { ch.vx = ch.vz = 0; ch.speed = 0; }
      };
      e.update = function () {
        if (!e.started) return;
        if (e.stage === 0) follow(tour);
        if (tour.knocked > 0) { end(false, "Туриста напугали — он убежал"); return; }
        if (e.stage === 1 && dist(FC.player, dest) < 14 && (inCar() || dist(tour, dest) < 16)) {
          var r = pay("tourist", rnd(300, 520), "турист");
          tour.visible = true; tour.x = dest.x; tour.z = dest.z;
          FC.people.say(tour, "Вот оно! Спасибо, держите 🙏", 3);
          brag("🧳 Проводил туриста к " + S.name, dest, 90);
          end(true, "🧳 Турист доволен · +" + FC.fmtMoney(r.n));
        }
      };
      return e;
    } },
    { id: "foodtruck", title: "Фудтрак-ажиотаж", icon: "🌮", run: function (E) {
      var sp = spotNear(60, 200); if (!sp) return null;
      var e = { at: sp, cleanup: [], stage: 0, served: 0, lost: 0, q: [], spawnT: 0 };
      offer(E, "Фудтрак «Огненное тако» не справляется с очередью. Встань за прилавок на минуту — плата за каждого гостя.", function () {
        e.started = true;
        var g = FC.story && FC.story.vanMesh ? FC.story.vanMesh(0xff8a1f, null) : null;
        if (g) { g.position.set(sp.x, 0, sp.z); g.rotation.y = Math.random() * 6.28; e.cleanup.push(function () { G.scene.remove(g); }); e.h = g.rotation.y; }
        else e.h = 0;
        var wx = sp.x + Math.cos(e.h) * 1.6, wz = sp.z - Math.sin(e.h) * 1.6;
        e.win = { x: wx + Math.cos(e.h) * 1.4, z: wz - Math.sin(e.h) * 1.4 };
        mark(sp, "🌮", "#ff9f1c", true, 0);
        FC.hud.objective("Дойди до <b>фудтрака</b>");
        FC.interact.add({ id: "cev", x: wx, z: wz, r: 3, label: "🌮 Встать за прилавок", act: function () {
          FC.interact.remove("cev"); e.stage = 1; e.left = 50;
          FC.hud.timer(50, "🌮", function () { if (cev === e) finish(); });
          FC.hud.objective("Жми <b>E</b>, когда гость у окна");
          snd("door");
        } });
        e.cleanup.push(function () { e.q.forEach(function (c) { FC.people.remove(c.ch); }); });
      });
      function finish() {
        if (e.served === 0) { end(false, "Никого не обслужил — фудтрак закрылся"); return; }
        var r = pay("foodtruck", e.served * 45, "фудтрак");
        brag("🌮 Накормил очередь у фудтрака: " + e.served + " гостей", e.at, 70 + e.served * 8);
        end(true, "🌮 Обслужил " + e.served + " гостей · +" + FC.fmtMoney(r.n));
      }
      e.update = function (dt) {
        if (!e.started || e.stage !== 1) return;
        e.spawnT -= dt;
        if (e.spawnT <= 0 && e.q.length < 5) {
          e.spawnT = rnd(1.6, 3);
          var a = Math.random() * 6.28, c = npc({ x: e.win.x + Math.cos(a) * 14, z: e.win.z + Math.sin(a) * 14 });
          e.q.push({ ch: c, wait: 0 });
          FC.people.say(c, pick(["Тако, пожалуйста!", "Два бурито!", "Можно острое?", "Мне с сыром!"]), 2.5);
        }
        var P = FC.player;
        e.q.forEach(function (o, i) {
          var tx = e.win.x + Math.cos(e.h + Math.PI / 2) * i * 1.2, tz = e.win.z - Math.sin(e.h + Math.PI / 2) * i * 1.2;
          var c = o.ch, dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz);
          if (d > 0.3) { c.vx = dx / d * 3; c.vz = dz / d * 3; c.x += c.vx * dt; c.z += c.vz * dt; c.speed = 3; } else c.speed = 0;
          if (i === 0 && d < 1) o.wait += dt;
        });
        var head = e.q[0];
        if (head && head.wait > 0) {
          if (FC.input.pressed("use") && dist(P, e.win) < 4.5) {
            FC.input.consume("use");
            e.served++; snd("cash"); pop("+1 гость 🌮");
            FC.people.say(head.ch, pick(["Ммм, огонь!", "Спасибо!", "Лучшее тако в городе!"]), 2);
            var gone = head.ch; e.q.shift(); setTimeout(function () { FC.people.remove(gone); }, 1500);
            gone.update = function (h, dt2) { h.x += Math.sin(h.phase) * dt2; h.z += 2 * dt2; h.speed = 2; };
          } else if (head.wait > 6) {
            e.lost++; FC.people.say(head.ch, "Долго! Ухожу 😤", 2);
            var g2 = head.ch; e.q.shift(); setTimeout(function () { FC.people.remove(g2); }, 1500);
          }
        }
      };
      return e;
    } }
  ];
  var BY = {}; EVENTS.forEach(function (E) { BY[E.id] = E; });

  /* ---- расписание ------------------------------------------------------------------------------------------ */
  function busy() {
    var P = FC.player;
    return !P || P.dead || (FC.story && FC.story.busy && FC.story.busy()) || (FC.inside && FC.inside.active) || (FC.heist && FC.heist.busy && FC.heist.busy()) ||
      !!(FC.markers.all && FC.markers.all.ev) || (FC.photo && FC.photo.active && FC.photo.active()) || P.mode === "air";
  }
  function weight(E) {
    var w = 1, today = CAL && CAL.days ? CAL.days[todayIdx()] : null, ev = bonus("event")[0];
    if (today && today.event === E.id) w *= 2.5;
    if (ev && ev.event === E.id) w *= 2;
    return w;
  }
  function start(id) {
    if (cev) return false;
    var list = EVENTS.filter(function (E) { return (!id || E.id === id) && (!E.need || E.need()); });
    if (!list.length) return false;
    var E = list[0];
    if (!id) { var tot = list.reduce(function (s, x) { return s + weight(x); }, 0), r = Math.random() * tot; for (var i = 0; i < list.length; i++) { r -= weight(list[i]); if (r <= 0) { E = list[i]; break; } } }
    var e = null;
    try { e = E.run(E); } catch (x) { if (global.console) console.error("cityevent", x); e = null; }
    if (!e) return false;
    e.id = E.id; e.E = E; e.born = performance.now();
    cev = e;
    FC.emit("cityevent:start", { id: E.id });
    return true;
  }
  FC.on("photo:shot", function (s) { if (cev && cev.onShot) cev.onShot(s); });
  FC.addSystem({
    name: "cityevents", order: 57,
    init: function () { loadCal(); nextAt = performance.now() + rnd(120, 240) * 1000; setTimeout(announce, 25000); },
    update: function (dt) {
      if (!FC.started) return;
      if (cev) {
        if (!cev.started && performance.now() - cev.born > 17000) { end(false); return; }
        if (cev.update) { try { cev.update(dt); } catch (x) { if (global.console) console.error("cityevent", x); end(false); } }
        chipEl.classList.toggle("on", !!(cev && cev.started));
        if (cev && cev.started) chipEl.textContent = cev.E.icon + " " + cev.E.title + (eventMult(cev.id) > 1 ? " · ×" + String(eventMult(cev.id)).replace(".", ",") : "");
        return;
      }
      chipEl.classList.remove("on");
      if (performance.now() < nextAt || busy()) return;
      if (!start()) nextAt = performance.now() + 30000;
    }
  });
  function announce() {
    if (!CAL) return;
    var f = FC.save.flags || (FC.save.flags = {});
    if (f.calSeen === CAL.iso + (new Date().toISOString().slice(0, 10))) return;
    f.calSeen = CAL.iso + (new Date().toISOString().slice(0, 10)); FC.dirty();
    var main = CAL.bonuses[0];
    FC.hud.notify("Афиша недели", CAL.theme.icon + " " + CAL.theme.name + ": " + (main ? main.title : "") + ". Подробно — 📅 в телефоне.", "📅", 8);
  }

  /* ---- телефон: «Афиша» -------------------------------------------------------------------------------------- */
  function left(sec) { var d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600); return d ? d + " дн " + h + " ч" : h + " ч " + Math.floor(sec % 3600 / 60) + " мин"; }
  FC.hud.addApp({ id: "afisha", icon: "📅", name: "Афиша", color: "#d6336c", order: 7, badge: function () { return cev && cev.started ? "1" : ""; }, render: function (b, api) {
    if (!CAL) {
      b.innerHTML = "<div class='list'><div class='card'><b>Афиша недели</b><p>Календарь не загрузился — сервер игры недоступен. События города идут и без него.</p></div>" +
        "<button type='button' data-r='1'>Обновить</button></div>";
      b.querySelector("[data-r]").addEventListener("click", function () { loadCal(); setTimeout(api.refresh, 1200); });
      return;
    }
    var t = todayIdx(), sinceT = (Date.now() - (CAL._got || Date.now())) / 1000;
    var h = "<div class='list'><div class='card'><b>" + esc(CAL.theme.icon + " " + CAL.theme.name) + "</b><p>" + esc(CAL.theme.text) + "</p><p>Неделя " + esc(CAL.iso) +
      (CAL.next_in ? " · до смены " + left(Math.max(0, CAL.next_in - sinceT)) : "") + "</p></div>";
    h += "<div class='card'><b>Бонусы недели</b>" + CAL.bonuses.map(function (x) { return "<p>" + esc(x.icon + " " + x.title) + "</p>"; }).join("") +
      (CAL.race ? "<p>🏁 Гонка недели: " + esc(CAL.race.name) + " — в «Гонках»</p>" : "") + "</div>";
    h += "<div class='card'><b>По дням</b>" + CAL.days.map(function (d, i) { return "<p class='fe-day" + (i === t ? " today" : "") + "'>" + esc(d.icon + " " + d.title) + (i === t ? " · сегодня" : "") + "</p>"; }).join("") + "</div>";
    if (cev && cev.started) h += "<div class='card'><b>Сейчас: " + esc(cev.E.icon + " " + cev.E.title) + "</b><p>Метка на карте.</p></div>";
    else h += "<div class='card'><b>Следующее событие города</b><p>примерно через " + Math.max(1, Math.round((nextAt - performance.now()) / 60000)) + " мин — рядом с тобой</p></div>";
    if (CAL.next) h += "<div class='card'><b>На следующей неделе: " + esc(CAL.next.theme.icon + " " + CAL.next.theme.name) + "</b><p>" + esc(CAL.next.titles[0] || "") + "</p></div>";
    b.innerHTML = h + "</div>";
  } });

  FC.events = {
    calendar: function () { return CAL; }, discount: discount, saleLine: saleLine, mult: moneyMult, eventMult: eventMult,
    start: start, end: end, active: function () { return cev ? cev.id : null; }, spots: spots, list: EVENTS.map(function (E) { return E.id; })
  };
})(window);
