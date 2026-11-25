/* Флейм-Сити — соцсеть «Флеймграм» и прямые эфиры (FC.social).
 *
 * Задача: «стримы и соцсеть — трюки снимают прохожие, в ленте копятся лайки и подписчики,
 * подписчики дают доступ к новым миссиям и машинам». Как в GTA 6: свидетели снимают на телефон — пост попадает в
 * «Ленту» (FC.story.post, fstory2), растут подписчики и лайки. Пороги подписчиков открывают подарки спонсоров (машины
 * у дороги, вертолёт «Флейм ТВ»), миссии стримеров. «Прямой эфир» в телефоне: зрители, чат, донаты (игровые $),
 * за трюки в эфире — двойная награда.
 */
(function (global) {
  "use strict";
  var FC = global.FC, M = FC.map;

  function S() {
    var s = FC.save;
    if (!s.social) s.social = { followers: 0, likes: 0, posts: 0, got: [], ch: {}, my: [], streamSec: 0 };
    return s.social;
  }
  function fmt(n) { return n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(".0", "") + "K" : String(Math.round(n)); }
  function who() { var me = FC.me || {}, nk = FC.nick && FC.nick.name(); return (nk || (me.guest ? "Гость" : (me.name || me.creatureName || "Ты"))) + " · Флеймграм"; }
  function street(x, z) { return FC.story && FC.story.streetAt ? FC.story.streetAt(x, z) : M.district(x, z).name; }

  /* ---- пороги подписчиков: подарки и открытия --------------------------------------------------------- */
  var LEVELS = [
    { n: 100, id: "s100", title: "Спонсор прислал $1 000", money: 1000 },
    { n: 400, id: "s400", title: "Спорткар от спонсора", car: "sport", color: 0xff3d6e },
    { n: 1000, id: "s1k", title: "Миссии стримеров открыты", missions: true },
    { n: 2500, id: "s2k", title: "Маслкар «Флеймграм»", car: "muscle", color: 0xffb02e },
    { n: 5000, id: "s5k", title: "Мотоцикл «Блогер»", car: "moto", color: 0x8338ec },
    { n: 10000, id: "s10k", title: "Вертолёт «Флейм ТВ» на Башне", heli: "heli_news" },
    { n: 25000, id: "s25k", title: "Звезда города: $25 000 и суперкар", money: 25000, car: "sport", color: 0xffd23f }
  ];
  function gift(L) {
    var P = FC.player;
    if (L.money) FC.money(L.money, "Флеймграм: " + L.title);
    if (L.car && FC.cars && FC.cars.spawn && FC.cars.TYPES && FC.cars.TYPES[L.car]) {
      var nl = M.nearestLane(P.x, P.z);
      var car = nl ? FC.cars.spawn(L.car, nl.x, nl.z, Math.atan2(nl.dx, nl.dz), { owned: true, color: L.color, parked: true }) : null;
      if (car) car.keep = true;
      if (FC.save.garage) FC.save.garage.push({ type: L.car, color: L.color, name: "Подарок спонсора" });
      FC.save.flags["unlock_" + L.car] = true;
    }
    if (L.heli && FC.air && FC.air.spawn && M.hq) {
      FC.air.spawn(L.heli, M.hq.x, M.hq.z, 0, { owned: true, y: M.hq.h + 1 });
      FC.save.flags.unlock_heli_news = true;
    }
    if (L.missions) FC.save.flags.unlock_streamer = true;
  }
  function addFollowers(n, why) {
    if (!n) return;
    var st = S(), before = st.followers;
    st.followers = Math.max(0, Math.round(st.followers + n));
    LEVELS.forEach(function (L) {
      if (before < L.n && st.followers >= L.n && st.got.indexOf(L.id) < 0) {
        st.got.push(L.id);
        gift(L);
        FC.hud.big(fmt(L.n) + " ПОДПИСЧИКОВ", L.title, "#ff5d8f", 4);
        if (FC.audio) FC.audio.play("mission");
        if (FC.fx) FC.fx.burst(FC.player.x, 1.6, FC.player.z, "confetti", 70);
      }
    });
    if (n >= 5 && why) FC.hud.popup("+" + fmt(n) + " подписчиков", { color: "#ff8fb8" });
    FC.emit("social:followers", { total: st.followers, delta: n });
    FC.dirty();
  }

  /* ---- посты: свидетели снимают — пост в «Ленту» ------------------------------------------------------------ */
  var pend = null;              // склейка трюков подряд в один пост
  function filmers(x, z) {
    var w = FC.people.witnesses ? FC.people.witnesses(x, z, 28) : [];
    return w.filter(function (c) { return c.kind === "ped" || c.kind === "agent" || c.kind === "npc"; });
  }
  function film(x, z) {
    var w = filmers(x, z);
    if (w.length) FC.people.say(w[Math.floor(Math.random() * w.length)], "📱 снимаю!", 2.2);
    return w.length;
  }
  function post(text, likes, at, extra) {
    var st = S(), P = FC.player;
    st.posts++; st.likes += likes;
    var p = { id: "me" + Date.now() + Math.floor(Math.random() * 99), kind: "me", cell: P && P.ch ? P.ch.cell : -1, who: who(), text: text,
      likes: likes, at: at || (P ? { x: P.x, z: P.z } : null) };
    if (extra) Object.assign(p, extra);
    if (FC.story && FC.story.post) FC.story.post(p);
    st.my.unshift({ text: text, likes: likes, t: Date.now() });
    if (st.my.length > 25) st.my.length = 25;
    FC.dirty();
  }
  function viral(base) { return Math.round(base * (1 + Math.log10(1 + S().followers) * 0.6) * (0.7 + Math.random() * 0.6)); }

  var STUNT = { drift: "Дрифт", near: "Впритирку", air: "Полёт", oncoming: "По встречке", wheelie: "Вилли", loop: "Петля", roll: "Бочка" };
  FC.on("stunt", function (s) {
    if (!s) return;
    var P = FC.player;
    var seen = film(P.x, P.z) || live.on;
    if (!seen) return;
    if (!pend) pend = { kinds: {}, score: 0, x: P.x, z: P.z, t: 0 };
    pend.kinds[s.kind] = (pend.kinds[s.kind] || 0) + 1; pend.score += s.score || 0; pend.t = 3;
    if (live.on) {
      live.hype = Math.min(1, live.hype + 0.15 + (s.score || 0) / 4000);
      var bonus = Math.round((s.score || 0) * 0.15);
      if (bonus > 0) FC.money(bonus, "эфир: трюк ×2");
      chat(pick(["ВОТ ЭТО " + (STUNT[s.kind] || "ТРЮК").toUpperCase() + "!!", "🔥🔥🔥", "клип!", "ещё раз!!", "топ", "как он это сделал 😱"]));
    }
  });
  function flushStunts() {
    var P = pend; pend = null;
    var names = Object.keys(P.kinds).map(function (k) { return (STUNT[k] || k) + (P.kinds[k] > 1 ? " ×" + P.kinds[k] : ""); }).join(", ");
    var likes = viral(15 + P.score / 25);
    post("🔥 " + names + " на " + street(P.x, P.z) + " — " + fmt(P.score) + " очков" + (live.on ? " · в прямом эфире 🔴" : "") + " #флеймсити", likes, { x: P.x, z: P.z });
    addFollowers(Math.max(2, Math.round(P.score / 120)) * (live.on ? 2 : 1), true);
  }
  var lastStars = 0;
  FC.on("wanted", function (w) {
    var n = (w && w.stars) || 0, P = FC.player;
    if (n >= 3 && lastStars < 3) {
      film(P.x, P.z);
      post("🚨 Погоня на " + street(P.x, P.z) + "! " + "★".repeat(n) + " Весь город смотрит", viral(60), { x: P.x, z: P.z });
      addFollowers(15 * n * (live.on ? 2 : 1), true);
      if (live.on) { live.hype = 1; chat("ПОГОНЯ!!! 🚓🚓🚓"); }
    }
    lastStars = n;
  });
  FC.on("wanted:lost", function () {
    if (lastStars >= 2 || live.on) { post("😎 Ушёл от погони. Копы, до встречи!", viral(40)); addFollowers(20 * (live.on ? 2 : 1), true); }
    lastStars = 0;
  });
  FC.on("heist:done", function (h) {
    var take = (h && h.take) || 0, kinds = { store: "касса", atm: "банкомат", jewelry: "ювелирный", van: "инкассатор", bank: "Флейм-Банк" };
    post("💰 Налёт: " + (kinds[h && h.kind] || "ограбление") + (take ? " · " + FC.fmtMoney(take) : "") + ". Новости уже в шоке", viral(h && h.kind === "bank" ? 400 : 80));
    addFollowers((h && h.kind === "bank" ? 300 : 40) * (live.on ? 2 : 1), true);
    challenge("heist");
  });
  FC.on("gang:capture", function (e) {
    post("🏴 Точка «" + ((e && e.name) || "район") + "» теперь наша", viral(50), e ? { x: e.x, z: e.z } : null);
    addFollowers(35 * (live.on ? 2 : 1), true);
    challenge("gang");
  });
  FC.on("gang:district", function (e) { post("👑 Весь район " + ((M.DIST[e && e.dist] || {}).name || "") + " под нами!", viral(500)); addFollowers(500, true); });
  FC.on("car:explode", function (e) { var P = FC.player; if (e && e.car && FC.dist2(e.car.x, e.car.z, P.x, P.z) < 30 * 30 && film(P.x, P.z)) { post("💥 Взрыв на " + street(P.x, P.z) + "!", viral(30)); addFollowers(8, false); } });
  FC.on("story:pass", function () { addFollowers(120, true); });
  FC.on("buddy:task", function () { addFollowers(60, true); });
  FC.on("job:done", function () { addFollowers(2, false); });
  FC.on("busted", function () { if (live.on) { chat("ну всё, повязали 😂"); stopLive("Эфир прерван — задержание"); } });
  FC.on("wasted", function () { if (live.on) stopLive("Эфир прерван"); });

  /* ---- прямой эфир: зрители, чат, донаты ------------------------------------------------------------------- */
  var live = { on: false, viewers: 0, hype: 0, donT: 12, chatT: 2, sec: 0 };
  var NAMES = ["Лис", "Сова", "Кот", "Капля", "Дракон", "Пончик", "Светляк", "Эхо", "Бобр", "Магнит", "Тюлень", "Пиксель"];
  var CHAT = ["привет из Минска 👋", "го ограбление", "дрифт давай", "а где Макс?", "лайк не глядя", "сколько звёзд выдержишь?", "топ стример", "😂😂", "покажи Башню", "это реально Флейм-Сити?", "мой агент тоже так умеет", "в Алматы снег ❄️"];
  function pick(l) { return l[Math.floor(Math.random() * l.length)]; }
  var box = document.createElement("div"); box.className = "fs-live";
  box.innerHTML = "<div class='fs-top'><b>🔴 ЭФИР</b><span class='fs-v'>👁 0</span><button type='button'>Стоп</button></div><div class='fs-chat'></div>";
  document.body.appendChild(box);
  box.querySelector("button").addEventListener("click", function () { stopLive(); });
  FC.css([
    ".fs-live{position:fixed;left:12px;top:calc(110px + env(safe-area-inset-top));width:min(230px,58vw);z-index:6;display:none;pointer-events:none;font:600 12px system-ui;color:#fff}",
    ".fs-live.on{display:block}.fs-top{display:flex;gap:8px;align-items:center;background:rgba(14,18,36,.8);border-radius:12px;padding:5px 8px;pointer-events:auto}",
    ".fs-top b{color:#ff4d6d;animation:sflash 1.2s steps(2) infinite}.fs-top span{flex:1}.fs-top button{border:0;border-radius:8px;background:rgba(255,255,255,.15);color:#fff;font:700 11px system-ui;padding:3px 8px;cursor:pointer}",
    ".fs-chat{display:flex;flex-direction:column;gap:3px;margin-top:6px}.fs-chat p{margin:0;background:rgba(0,0,0,.45);border-radius:9px;padding:3px 8px;animation:pop .2s;text-shadow:0 1px 2px #000}",
    ".fs-chat p i{font-style:normal;color:#ffcf7a}.fs-chat p.don{background:rgba(47,191,113,.75)}",
    "body.touch .fs-live{top:calc(250px + env(safe-area-inset-top))}"
  ].join("\n"));
  var chatEl = box.querySelector(".fs-chat"), vEl = box.querySelector(".fs-v");
  function chat(text, don) {
    if (!live.on) return;
    var p = document.createElement("p"); if (don) p.className = "don";
    p.innerHTML = "<i>" + FC.hud.esc(pick(NAMES)) + ":</i> " + FC.hud.esc(text);
    chatEl.appendChild(p);
    while (chatEl.children.length > 5) chatEl.firstChild.remove();
    setTimeout(function () { p.remove(); }, 9000);
  }
  function startLive() {
    if (live.on) return;
    live.on = true; live.sec = 0; live.hype = 0.3; live.viewers = Math.max(3, Math.round(S().followers * 0.04 + 5));
    box.classList.add("on");
    FC.hud.toast("🔴 Ты в эфире — трюки ×2, зрители донатят", "ok", 3);
    chat("о, эфир начался!"); chat(pick(CHAT));
    FC.emit("social:live", { on: true });
  }
  function stopLive(why) {
    if (!live.on) return;
    live.on = false; box.classList.remove("on");
    var st = S(), gain = Math.round(live.viewers * 0.2 + live.sec / 20);
    st.streamSec = (st.streamSec || 0) + live.sec;
    if (live.sec > 30) { post("📺 Эфир " + Math.round(live.sec / 60) + " мин · " + fmt(live.viewers) + " зрителей", viral(25 + live.viewers / 4)); addFollowers(gain, true); }
    FC.hud.toast(why || ("Эфир окончен: +" + fmt(gain) + " подписчиков"), "", 3);
    FC.emit("social:live", { on: false });
  }

  /* ---- миссии стримеров (с 1 000 подписчиков) --------------------------------------------------------------- */
  var CH = [
    { id: "heist", text: "Ограбление в прямом эфире", reward: 3000, fol: 400 },
    { id: "gang", text: "Захвати точку банды в эфире", reward: 2000, fol: 250 },
    { id: "chase", text: "Продержись 60 с с 3★ в эфире", reward: 2500, fol: 300 },
    { id: "stunts", text: "Набери 5 000 очков трюков за эфир", reward: 2500, fol: 300 }
  ];
  function challenge(id) {
    var st = S();
    if (!live.on || !FC.save.flags.unlock_streamer || st.ch[id]) return;
    var C = CH.filter(function (c) { return c.id === id; })[0]; if (!C) return;
    st.ch[id] = Date.now();
    FC.money(C.reward, "миссия стримера: " + C.text);
    FC.hud.big("МИССИЯ СТРИМЕРА", C.text + " · +" + FC.fmtMoney(C.reward), "#ff5d8f", 3.5);
    addFollowers(C.fol, true);
    chat("ЛЕГЕНДА 🏆", true);
  }
  var chaseSec = 0, liveScore = 0;
  FC.on("stunt", function (s) { if (live.on) { liveScore += (s && s.score) || 0; if (liveScore >= 5000) challenge("stunts"); } });

  /* ---- кадр ------------------------------------------------------------------------------------------------- */
  FC.addSystem({
    name: "social", order: 33,
    update: function (dt) {
      if (!FC.started) return;
      if (pend) { pend.t -= dt; if (pend.t <= 0) flushStunts(); }
      if (!live.on) { liveScore = 0; return; }
      live.sec += dt;
      live.hype = Math.max(0, live.hype - dt * 0.03);
      var P = FC.player, moving = P && Math.hypot(P.vx || 0, P.vz || 0) > 4;
      var want = (S().followers * 0.05 + 6) * (0.6 + live.hype * 1.8 + (moving ? 0.2 : 0));
      live.viewers = Math.max(1, FC.damp(live.viewers, want, 0.5, dt));
      vEl.textContent = "👁 " + fmt(live.viewers);
      live.chatT -= dt;
      if (live.chatT <= 0) { live.chatT = 2.5 + Math.random() * 4 / (0.5 + live.hype); chat(pick(CHAT)); }
      live.donT -= dt;
      if (live.donT <= 0) {
        live.donT = 10 + Math.random() * 20 / (0.4 + live.hype);
        var d = Math.max(5, Math.round(live.viewers * (0.4 + Math.random()) * (0.5 + live.hype)));
        FC.money(d, "донат в эфире");
        chat("💸 донат " + FC.fmtMoney(d) + " — " + pick(["за дрифт", "на бензин", "продолжай!", "огонь 🔥", "на аптечку"]), true);
      }
      if (FC.police && FC.police.stars >= 3) { chaseSec += dt; if (chaseSec >= 60) challenge("chase"); } else chaseSec = 0;
    }
  });

  /* ---- приложение «Флеймграм» ---------------------------------------------------------------------------- */
  FC.hud.addApp({
    id: "social", icon: "📸", name: "Флеймграм", color: "#c13584", order: 4,
    badge: function () { return live.on ? "LIVE" : ""; },
    render: function (b, api) {
      var st = S(), esc = FC.hud.esc, P = FC.player;
      var next = LEVELS.filter(function (L) { return st.followers < L.n; })[0];
      var cell = P && P.ch ? P.ch.cell : -1;
      var av = cell >= 0 && cell < 1000 ? "<span class='fsav' style='" + FC.hud.atlasStyle(cell) + "'></span>" : "<span class='fsav'>🥚</span>";
      var html = "<div class='list'><div class='card fspost'>" + av + "<div><b>" + esc(who()) + "</b><p>👥 " + fmt(st.followers) + " подписчиков · ❤️ " + fmt(st.likes) + " · 📝 " + st.posts + " постов</p>" +
        (next ? "<p class='quiet'>До «" + esc(next.title) + "»: " + fmt(next.n - st.followers) + "</p>" : "<p class='quiet'>Ты — звезда города ⭐</p>") + "</div></div>";
      html += "<div class='card'><b>" + (live.on ? "🔴 Ты в эфире · 👁 " + fmt(live.viewers) : "Прямой эфир") + "</b><p>В эфире трюки дают двойную награду, зрители донатят, подписчиков вдвое больше.</p>" +
        "<button type='button' data-act='" + (live.on ? "stop" : "live") + "'>" + (live.on ? "Закончить эфир" : "🔴 Начать эфир") + "</button></div>";
      if (FC.save.flags.unlock_streamer) {
        html += "<div class='card'><b>🎬 Миссии стримеров</b>" + CH.map(function (c) {
          return "<p>" + (st.ch[c.id] ? "✅ " : "▫️ ") + esc(c.text) + " — " + FC.fmtMoney(c.reward) + "</p>";
        }).join("") + "<p class='quiet'>Засчитываются только в прямом эфире.</p></div>";
      } else html += "<div class='card'><p>🔒 Миссии стримеров — с 1 000 подписчиков.</p></div>";
      html += "<div class='card'><b>Награды за подписчиков</b>" + LEVELS.map(function (L) {
        return "<p>" + (st.got.indexOf(L.id) >= 0 ? "✅" : "🔒") + " " + fmt(L.n) + " — " + esc(L.title) + "</p>";
      }).join("") + "</div>";
      if (st.my.length) html += "<div class='card'><b>Мои посты</b>" + st.my.slice(0, 8).map(function (p) { return "<p>" + esc(p.text) + " <span class='quiet'>❤️ " + fmt(p.likes) + "</span></p>"; }).join("") + "</div>";
      html += "<div class='card'><p class='quiet'>Как набрать: трюки на машине и мото рядом с прохожими (они снимают), погони, налёты, захваты районов, задания агента.</p></div></div>";
      b.innerHTML = html;
      b.onclick = function (e) {
        var t = e.target.closest("button"); if (!t) return;
        if (t.dataset.act === "live") { startLive(); api.close(); }
        if (t.dataset.act === "stop") { stopLive(); api.refresh(); }
      };
    }
  });

  FC.social = { followers: function () { return S().followers; }, add: addFollowers, post: post, live: function () { return live.on; }, start: startLive, stop: stopLive };
})(window);
