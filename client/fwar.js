/* Флейм-Сити — «Война за район» (FC.war): кланы делят районы «Передела» по недельному календарю, лёгкий KvK из RoK.
 *
 * Сервер — server/war.py: пн–пт подготовка (тема дня ×1,5–×2 к своему источнику влияния), сб и вс
 * 19:00–21:00 по Минску — окно войны (влияние клана ×2, флаги районов держатся стоянием рядом), в конце окна район уходит
 * клану с наибольшим влиянием недели. Расширяться — только от своих районов, штаба и зданий соклановцев к соседям.
 * PvP нет: соревнуются доставками, кассой, делами в районе и удержанием флага (позицию сервер берёт из онлайна).
 * Здесь: данные войны (GET /g/war — раз в 5 мин и при открытии), флаги в окно войны (метки на карте и в мире — только
 * районы, доступные клану), удержание флага (проверка 4 раза в секунду, без выделений памяти; отметка — раз в 30 с),
 * цвета кланов-хозяев на большой карте, смены хозяев и итоги недели — в «Ленту».
 *   FC.war.data() / me() / load(force) / block() — HTML-сводка для «Передела» и «Клана»
 */
(function (global) {
  "use strict";
  var FC = global.FC;
  var W = { data: null, at: 0, me: null, meAt: 0, flags: [], holdT: 0, holdD: null, chk: 0, sent: 0, busy: false };

  function token() { return FC.net && FC.net.token; }
  function esc(s) { return FC.hud.esc(s); }
  function city() { return FC.city === "minsk" ? "minsk" : "flame"; }
  function crewId() { return FC.crews && FC.crews.id ? FC.crews.id() : null; }
  function hm(ts) { var d = new Date(ts * 1000); return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); }
  function left(sec) { sec = Math.max(0, sec); var d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60); return (d ? d + " д " : "") + (d || h ? h + " ч " : "") + m + " мин"; }

  function load(force) {
    if (!force && W.data && Date.now() - W.at < 60000) return Promise.resolve(W.data);
    return FC.gfetch("/g/war?city=" + city()).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
      W.data = d; W.at = Date.now(); W.skew = d.now - Date.now() / 1000;
      feed(d); flags();
      return d;
    }).catch(function () { return W.data; });
  }
  function loadMe(force) {
    if (!token() || !crewId()) { W.me = null; return Promise.resolve(null); }
    if (!force && W.me && Date.now() - W.meAt < 60000) return Promise.resolve(W.me);
    return FC.prop.post("/g/war/me", { token: token(), city: city() }).then(function (d) { W.me = d; W.meAt = Date.now(); flags(); return d; })
      .catch(function () { return W.me; });
  }
  function now() { return Date.now() / 1000 + (W.skew || 0); }
  function active() {
    var d = W.data; if (!d) return false;
    var t = now();
    for (var i = 0; i < d.windows.length; i++) if (t >= d.windows[i][0] && t < d.windows[i][1]) return true;
    return false;
  }

  /* ---- «Лента»: смены хозяев и итоги недели --------------------------------------------------------------------- */
  function feed(d) {
    if (!FC.story || !FC.story.post) return;
    var f = FC.save.flags || (FC.save.flags = {}), seen = f.war || (f.war = {}), k = city(), last = seen[k] || 0;
    var names = {}; d.dists.forEach(function (x) { names[x.d] = x.name; });
    var fresh = d.log.filter(function (x) { return x.id > last; }).reverse();
    if (last) fresh.slice(-6).forEach(function (x) {
      if (!x.crew) return;
      FC.story.post({ id: "war" + x.id, kind: "story", cell: -1, who: "Война за район · итоги окна",
        text: "🏴 Район «" + (names[x.d] || x.d) + "» теперь за кланом [" + x.crew.tag + "] " + x.crew.emblem + " " + x.crew.name +
          (x.prev ? " — отбили у [" + x.prev.tag + "]" : "") + ". Их бизнесы здесь получают +10%", likes: 60 + Math.floor(Math.random() * 200),
        at: d.dists.filter(function (z) { return z.d === x.d; }).map(function (z) { return { x: z.x, z: z.z }; })[0] });
      var my = crewId();
      if (my && x.crew.id === my && FC.ach) FC.ach.unlock("war_flag");
    });
    if (d.log.length) seen[k] = Math.max(last, d.log[0].id);
    // итоги недели: кто сколько районов держит — один пост на неделю
    var wk = (f.warWeek || (f.warWeek = {}));
    if (wk[k] && wk[k] < d.week) {
      var by = {};
      d.dists.forEach(function (x) { if (x.holder) { var h = by[x.holder.id] || (by[x.holder.id] = { c: x.holder, n: 0 }); h.n++; } });
      var top = Object.keys(by).map(function (i) { return by[i]; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 3);
      if (top.length) FC.story.post({ id: "warwk" + d.week + k, kind: "story", cell: -1, who: "Война за район · неделя",
        text: "🗺️ Итоги недели " + FC.cityOf + ": " + top.map(function (t) { return "[" + t.c.tag + "] " + t.n + " р."; }).join(", ") + ". Новое влияние — с нуля, окна — в субботу и воскресенье 19:00",
        likes: 120 + Math.floor(Math.random() * 300) });
    }
    wk[k] = d.week;
    FC.dirty();
  }

  /* ---- флаги в окно войны ------------------------------------------------------------------------------------------ */
  function flags() {
    var on = active() && W.me && W.me.can && W.data, want = {};
    if (on) W.data.dists.forEach(function (x) { if (W.me.can.indexOf(x.d) >= 0) want["war-" + x.d] = x; });
    W.flags.forEach(function (id) { if (!want[id]) FC.markers.remove(id); });
    W.flags = Object.keys(want);
    W.flags.forEach(function (id) {
      var x = want[id], mine = x.holder && x.holder.id === crewId();
      FC.markers.add({ id: id, x: x.x, z: x.z, color: mine ? "#2fbf71" : "#ff5d6c", icon: "🚩", label: "Флаг: " + x.name, ring: 12 });
    });
  }
  // удержание: игрок у флага доступного района — копим 30 с, потом отметка на сервере (позицию сервер сверяет сам)
  FC.addSystem({
    name: "war", order: 97,
    update: function () {
      // по настоящим часам, а не по dt кадра: dt урезан до 0,05 с, и на слабом телефоне 30 «игровых» секунд тянулись бы минуты
      var t = performance.now();
      if (t - W.chk < 250) return;
      var step = W.chk ? Math.min(1, (t - W.chk) / 1000) : 0.25; W.chk = t;
      var a = active();
      if (a !== W.wasA) { W.wasA = a; flags(); }        // окно началось или кончилось — флаги появляются и убираются сами
      if (!W.flags.length || !FC.player || W.busy) { W.holdT = 0; return; }
      var P = FC.player, best = null, bd = 120 * 120;
      for (var i = 0; i < W.data.dists.length; i++) {
        var x = W.data.dists[i];
        if (!W.me || W.me.can.indexOf(x.d) < 0) continue;
        var dx = x.x - P.x, dz = x.z - P.z, d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = x; }
      }
      if (!best || !active()) { W.holdT = 0; W.holdD = null; return; }
      if (W.holdD !== best.d) { W.holdD = best.d; W.holdT = 0; FC.hud.toast("🚩 Держишь флаг района «" + best.name + "» — стой рядом", "", 2.5); }
      W.holdT += step;
      if (W.holdT >= 30) { W.holdT = 0; hold(best); }
    }
  });
  function hold(x) {
    W.busy = true;
    FC.prop.post("/g/war/hold", { token: token(), city: city(), d: x.d }).then(function (r) {
      W.busy = false;
      FC.hud.toast("🚩 Флаг «" + x.name + "»: +" + Math.round(r.pts) + " влияния клану", "ok", 2.6);
      if (r.xp && FC.progress) FC.progress.shown(r.xp);
      if (FC.ach) FC.ach.unlock("war_hold");
      W.meAt = 0;
    }).catch(function (e) { W.busy = false; FC.hud.toast("Флаг: " + (e.message || "не вышло"), "bad", 3); });
  }

  /* ---- карта: районы цветом клана-хозяина (кольцо поверх «Передела») ------------------------------------------- */
  FC.hud.addMapLayer(function (c, k, mode) {
    var d = W.data; if (!d) return;
    var R = city() === "minsk" ? 1300 : 330, my = crewId();
    for (var i = 0; i < d.dists.length; i++) {
      var x = d.dists[i], h = x.holder;
      if (!h) continue;
      if (mode === "big") {
        c.globalAlpha = 0.85; c.strokeStyle = h.color; c.lineWidth = (h.id === my ? 5 : 3) / k;
        c.beginPath(); c.arc(x.x, x.z, R * 0.92, 0, 7); c.stroke();
        c.globalAlpha = 1; c.fillStyle = "#fff"; c.font = "800 " + (12 / k) + "px system-ui"; c.textAlign = "center"; c.textBaseline = "middle";
        c.fillText(h.emblem + " [" + h.tag + "]", x.x, x.z + 18 / k);
      } else if (h.id === my) {
        c.globalAlpha = 0.9; c.fillStyle = h.color; c.font = "700 " + (12 / k) + "px system-ui"; c.textAlign = "center"; c.textBaseline = "middle";
        c.fillText("🏴", x.x, x.z);
      }
    }
    c.globalAlpha = 1;
  });

  /* ---- сводка для «Передела» и «Клана» ------------------------------------------------------------------------------ */
  function block(full) {
    var d = W.data;
    if (!d) { load(); return "<div class='card'><b>⚔️ Война за район</b><p>Загружаю…</p></div>"; }
    var t = now(), on = active();
    var win = d.windows.map(function (w) { return ["сб", "вс"][d.windows.indexOf(w)] + " " + hm(w[0]) + "–" + hm(w[1]); }).join(", ");
    var html = "<div class='card'><b>⚔️ Война за район " + (on ? "· <span style='color:#ff5d6c'>идёт сейчас</span>" : "") + "</b>" +
      "<p>" + (on ? "До конца окна: " + left(d.ends - t) + ". Влияние клана ×2, флаги районов — стой у флага." :
        "До окна войны: " + left(d.next - t) + " (" + win + " по твоему времени).") + "</p>" +
      "<p>Тема дня: <b style='display:inline'>" + esc(d.theme.name) + "</b></p></div>";
    if (!full) return html;
    var my = crewId(), can = W.me && W.me.can || [];
    d.dists.forEach(function (x) {
      var h = x.holder, top = x.top || [];
      html += "<div class='card ss-d'><b>" + esc(x.name) + "</b><span>" + (h ? "<span class='ss-team' style='background:" + esc(h.color) + "'>" + esc(h.emblem + " " + h.tag) + "</span>" : "<span class='quiet'>ничей</span>") + "</span>" +
        "<span class='pr-meta'>" + (top.length ? top.map(function (c) { return esc(c.emblem + " " + c.tag) + " " + c.pts; }).join(" · ") : "влияния кланов пока нет") + "</span>" +
        "<span>" + (my ? (can.indexOf(x.d) >= 0 ? "<span class='ss-can'>можно</span>" : "<span class='quiet'>не сосед</span>") : "") + "</span></div>";
    });
    if (W.me && my) html += "<p class='quiet'>Твой вклад в клан за неделю: " + W.me.pts + " · сегодня " + W.me.today + " из " + W.me.day_cap +
      (W.me.roots.length ? "" : " · у клана нет опоры в этом городе: купите здание или поставьте штаб") + "</p>";
    html += "<p class='jb-note'>Пн–пт — подготовка: влияние клана копится от кассы и доставок бизнесов, захватов, налётов, гонок и смен " +
      "(у каждого дня своя тема ×1,5–×2). Сб и вс 19:00–21:00 по Минску — окно войны: всё ×2, флаги районов. В конце окна район уходит клану, " +
      "набравшему за неделю больше всех (не меньше " + d.rules.flip_min + " и на 15% больше хозяина). Расширяться можно только к соседям своих районов, штаба " +
      "и зданий соклановцев. Хозяину — +10% к кассе бизнесов клана в районе, цвет клана на карте и титул «Знаменосец». Без стрельбы по игрокам.</p>";
    if (d.log.length) {
      var names = {}; d.dists.forEach(function (x) { names[x.d] = x.name; });
      html += "<h4>Последние смены</h4><div class='card'>" + d.log.slice(0, 6).map(function (x) {
        return "<p class='bz-hist'>" + esc(names[x.d] || x.d) + ": " + (x.crew ? esc(x.crew.emblem + " [" + x.crew.tag + "]") : "—") + (x.prev ? " ← [" + esc(x.prev.tag) + "]" : "") + "</p>";
      }).join("") + "</div>";
    }
    return html;
  }

  var pollT = 0;
  FC.addSystem({ name: "warpoll", order: 98, update: function () {
    var t = performance.now(); if (!pollT) pollT = t;
    if (t - pollT < 300000) return;
    pollT = t; load(true); if (crewId()) loadMe(true);
  } });
  FC.on("me", function () { W.me = null; setTimeout(function () { load(true).then(function () { return loadMe(true); }); }, 4000); });
  FC.on("crew:changed", function () { W.me = null; W.meAt = 0; loadMe(true); });

  FC.war = { data: function () { return W.data; }, me: function () { return W.me; }, load: load, loadMe: loadMe, block: block, active: active };
})(window);
