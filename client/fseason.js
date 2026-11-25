/* Флейм-Сити — сезон «Передел» (FC.season): банды игроков набирают влияние в районах, район недели — за сильнейшей.
 *
 * Ресёрч (territory_ownership_business_mechanics.md, п. 1, 2, 7): сезон по расписанию, расширяться — только в соседние
 * районы от своих (правило флагов Rise of Kingdoms), владение районом — неотчуждаемый бафф (+10% к выручке своих
 * бизнесов в нём), а не отъём чужого дохода. Призы — только игровые; ничего за настоящие деньги.
 * Банды — те же три команды, что в «Районах» (fgang.js): «Красные Звёзды», «Зубры», «Снежные Барсы». Сервер —
 * server/realty.py: банда игрока в городе (менять раз в неделю), очки по районам, хозяева недели (лениво при
 * смене недели), соседство районов (грани ячеек Вороного), лучшие игроки — видом агента, без rid.
 * Влияние: выручка своих бизнесов и доставки в районе (сервер начисляет сам), захват и оборона точек, налёты, гонки,
 * смены — их клиент сообщает (/g/season/act, сервер режет частоту и дневной потолок). Смена хозяина района — в «Ленту».
 */
(function (global) {
  "use strict";
  var FC = global.FC;
  var TEAM = {
    msk: { name: "Красные Звёзды", emoji: "⭐", color: "#e63946" },
    minsk: { name: "Зубры", emoji: "🦬", color: "#2fbf71" },
    ala: { name: "Снежные Барсы", emoji: "🐆", color: "#4cc9f0" }
  };
  var S = { data: null, me: null, at: 0, show: false, actT: 0 };

  FC.css([
    ".ss-team{display:inline-block;padding:1px 7px;border-radius:8px;color:#fff;font:700 11px system-ui}",
    ".ss-d{display:grid;grid-template-columns:1fr auto;gap:2px 8px;align-items:center}",
    ".ss-bars{grid-column:1/3;display:flex;height:6px;border-radius:4px;overflow:hidden;background:rgba(255,255,255,.08)}",
    ".ss-bars i{display:block;height:100%}.ss-can{font:700 10px system-ui;color:#9dffbf}"
  ].join("\n"));

  function P() { return FC.prop; }
  function city() { return P() ? P().CITY : FC.city; }
  function esc(s) { return FC.hud && FC.hud.esc ? FC.hud.esc(s) : String(s == null ? "" : s); }
  function creatureName(code) { var W = global.FC_SPECIES; return code && W && W.META[code] ? W.META[code][0] : "Агент"; }
  function chip(t) { var T = TEAM[t]; return T ? "<span class='ss-team' style='background:" + T.color + "'>" + T.emoji + " " + esc(T.name) + "</span>" : "<span class='quiet'>ничей</span>"; }
  function left(sec) { var d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600); return (d ? d + " д " : "") + h + " ч"; }

  function load() {
    var url = "/g/season?city=" + city();
    return FC.gfetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
      announce(d); S.data = d; S.at = Date.now(); return d;
    }).catch(function () { return S.data; });
  }
  function loadMe() {
    if (!(P() && P().token())) { S.me = null; return Promise.resolve(null); }
    return P().post("/g/season/me", { token: P().token(), city: city() }).then(function (d) { S.me = d; return d; }).catch(function () { return S.me; });
  }
  function setTeam(t) {
    return P().post("/g/season/team", { token: P().token(), city: city(), team: t }).then(function (d) {
      S.me = Object.assign(S.me || {}, { team: d.team, since: d.since });
      FC.hud.toast("Ты в банде «" + TEAM[t].name + "» в этом городе", "ok", 3);
      return d;
    }).catch(function (e) { FC.hud.toast(e.message || "Не получилось", "bad", 3); });
  }
  // смена хозяев районов с прошлого захода — в «Ленту»
  function announce(d) {
    var seen = FC.save.flags.season || (FC.save.flags.season = {}), k = city(), was = seen[k];
    var now = {}; (d.dists || []).forEach(function (x) { now[x.d] = x.holder; });
    if (was && was.week < d.week) {
      (d.dists || []).forEach(function (x) {
        if (!x.holder || was.h[x.d] === x.holder || !FC.story || !FC.story.post) return;
        var T = TEAM[x.holder];
        FC.story.post({ id: "ss" + d.week + x.d, kind: "story", cell: -1, who: "Передел · итоги недели",
          text: "⚔️ Район «" + x.name + "» теперь за «" + T.name + "» " + T.emoji + " — их бизнесы здесь получают +10%", likes: 40 + Math.floor(Math.random() * 160), at: { x: x.x, z: x.z } });
      });
    }
    seen[k] = { week: d.week, h: now }; FC.dirty();
  }

  /* ---- дела → влияние (сервер режет частоту и потолок за сутки) ---------------------------------------------------- */
  function report(kind, x, z) {
    if (!(P() && P().token()) || !FC.player) return;
    var t = performance.now();
    if (t - S.actT < 9000) return;
    S.actT = t;
    var go = function () {
      return P().post("/g/season/act", { token: P().token(), city: city(), kind: kind, x: x == null ? FC.player.x : x, z: z == null ? FC.player.z : z })
        .then(function (d) {
          if (d.pts > 0) FC.hud.toast("⚔️ Влияние в районе +" + Math.round(d.pts), "ok", 2.2);
          if (d.xp && FC.progress) FC.progress.shown(d.xp);                 // опыт за дело в районе начислил сервер
        }).catch(function () {});
    };
    // ещё не в банде на сервере — вступаем в ту, что в «Районах» (fgang), и засчитываем дело
    if (S.me && S.me.team) go();
    else loadMe().then(function (m) { if (m && m.team) return go(); var t0 = FC.gang && FC.gang.team ? FC.gang.team() : "msk"; return setTeam(TEAM[t0] ? t0 : "msk").then(go); });
  }
  FC.on("gang:capture", function (e) { report("capture", e && e.x, e && e.z); });
  FC.on("gang:defend", function (e) { report("defend", e && e.x, e && e.z); });
  FC.on("heist:done", function () { report("heist"); });
  FC.on("race:done", function (e) { if (e && e.official) report("race"); });
  FC.on("job:done", function (e) { var k = e && e.id === "desk" ? "shift" : e && (e.id === "taxi" || e.id === "courier") ? e.id : null; if (k) report(k); });

  /* ---- карта: районы цветом хозяина (включается в приложении) --------------------------------------------------- */
  FC.hud.addMapLayer(function (c, k, mode) {
    if (!S.show || mode !== "big" || !S.data) return;
    var R = city() === "minsk" ? 1300 : 330;
    S.data.dists.forEach(function (d) {
      var T = TEAM[d.holder];
      c.globalAlpha = 0.16; c.fillStyle = T ? T.color : "#888"; c.beginPath(); c.arc(d.x, d.z, R, 0, 7); c.fill();
      c.globalAlpha = 0.9; c.fillStyle = "#fff"; c.font = "700 " + (13 / k) + "px system-ui"; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText((T ? T.emoji + " " : "") + d.name, d.x, d.z);
    });
    c.globalAlpha = 1;
  });

  /* ---- приложение «Передел» ------------------------------------------------------------------------------------- */
  function render(b, ctl) {
    var d = S.data, me = S.me, my = me && me.team;
    if (!d) { b.innerHTML = "<div class='card'><p>Загружаю районы…</p></div>"; Promise.all([load(), loadMe()]).then(function () { ctl.refresh(); }); return; }
    if (Date.now() - S.at > 30000) Promise.all([load(), loadMe()]).then(function () { if (b.isConnected) ctl.refresh(); });
    var mt = my && d.teams.filter(function (t) { return t.team === my; })[0];
    var html = "<div class='card'><b>⚔️ Передел " + (city() === "minsk" ? "Минска" : "Флейм-Сити") + "</b><p class='pr-meta'>До итогов недели: " + left(d.ends_in) + "</p>" +
      (my ? "<p>Твоя банда: " + chip(my) + " · твой вклад " + (me.pts || 0) + " · районов " + (mt ? mt.held : 0) + "</p>" :
        (P() && P().token() ? "<p>Выбери банду — её влияние растёт от твоих бизнесов и дел.</p>" : "<p>Войди своим агентом, чтобы воевать за районы.</p>")) +
      (P() && P().token() ? "<div class='hm-row'>" + Object.keys(TEAM).map(function (t) {
        return "<button type='button' class='" + (t === my ? "" : "ghost") + "' data-ss-team='" + t + "'" + (t === my ? " disabled" : "") + ">" + TEAM[t].emoji + " " + TEAM[t].name.split(" ").pop() + "</button>";
      }).join("") + "</div><p class='quiet'>Банду в городе можно менять раз в неделю.</p>" : "") + "</div>";
    if (FC.war) html += FC.war.block(false) + "<div class='row'><span>Кланы и флаги районов</span><button type='button' class='ghost' data-ss-war='1'>⚔️ Война</button></div>";
    html += "<div class='row'><span>Районы на большой карте</span><button type='button' data-ss-map='1'>" + (S.show ? "показаны" : "показать") + "</button></div>";
    d.dists.forEach(function (x) {
      var tot = 0; Object.keys(TEAM).forEach(function (t) { tot += x.pts[t] || 0; });
      var can = my && mt && mt.can.indexOf(x.d) >= 0;
      html += "<div class='card ss-d'><b>" + esc(x.name) + (x.home ? " <span class='quiet'>· родной " + TEAM[x.home].emoji + "</span>" : "") + "</b><span>" + chip(x.holder) + "</span>" +
        "<div class='ss-bars'>" + Object.keys(TEAM).map(function (t) { return tot ? "<i style='width:" + Math.round((x.pts[t] || 0) / tot * 100) + "%;background:" + TEAM[t].color + "'></i>" : ""; }).join("") + "</div>" +
        "<span class='pr-meta'>" + Object.keys(TEAM).filter(function (t) { return x.pts[t]; }).map(function (t) { return TEAM[t].emoji + " " + x.pts[t]; }).join(" · ") + (tot ? "" : "влияния пока нет") + "</span>" +
        "<span>" + (my ? (can ? "<span class='ss-can'>можно</span>" : "<span class='quiet'>не сосед</span>") : "") + "</span></div>";
    });
    html += "<h4>Банды</h4>" + d.teams.map(function (t) {
      return "<div class='row'><span>" + chip(t.team) + "</span><span class='quiet'>районов " + t.held + " · влияние " + t.pts + " · игроков " + t.members + "</span></div>";
    }).join("");
    if (d.top && d.top.length) html += "<h4>Лучшие недели</h4><div class='card'>" + d.top.map(function (r, i) {
      return "<p class='bz-hist'>" + (i + 1) + ". " + esc(r.name || creatureName(r.creature)) + " " + (TEAM[r.team] ? TEAM[r.team].emoji : "") + " — " + r.pts + "</p>";
    }).join("") + "</div>";
    html += "<p class='jb-note'>Влияние в районе дают выручка твоих бизнесов в нём и доставки, захват и оборона точек, налёты, гонки и смены. " +
      "Набирать можно в родном районе банды, в своих и в соседних. В конце недели район уходит банде с наибольшим влиянием; её бизнесы в нём получают +10% к выручке. Призы — только игровые.</p>";
    b.innerHTML = html;
    b.querySelectorAll("[data-ss-team]").forEach(function (x) { x.addEventListener("click", function () { setTeam(x.dataset.ssTeam).then(function () { load().then(ctl.refresh); }); }); });
    var wb = b.querySelector("[data-ss-war]");
    if (wb) wb.addEventListener("click", function () { if (FC.crews && FC.crews.id()) FC.crews.open("war"); else if (FC.crews) FC.crews.open(); });
    var mb = b.querySelector("[data-ss-map]");
    if (mb) mb.addEventListener("click", function () { S.show = !S.show; if (S.show) { ctl.close(); FC.hud.openMap(); } else ctl.refresh(); });
  }
  FC.hud.addApp({ id: "season", icon: "🚩", name: "Передел", color: "#9b2226", order: 9, render: render });
  FC.on("me", function () { S.me = null; loadMe(); load(); });

  FC.season = { TEAM: TEAM, load: load, me: function () { return S.me; }, data: function () { return S.data; }, report: report, setTeam: setTeam };
})(window);
