/* Флейм-Сити — онлайн-режимы на клиенте: гонки по чекпоинтам (время засчитывает сервер), «коп против вора», совместный
 * налёт на инкассатора, рейтинг районов (+10% к доходу района-лидера прошлой недели).
 *
 * Задача. Сервер — арбитр (server/modes.py): клиент только показывает и шлёт
 * намерения (старт, удар по фургону, «взять мешок»); время гонки, касания копа, мешки и делёж считает сервер по потоку
 * позиций. Без связи гонки идут «только у себя» — время не попадает в таблицу.
 * Трассы — tracks.json рядом (тот же файл кладётся на сервер; генератор — tools/gen_tracks.cjs).
 *
 * FC.modes: {tracks, startRace(id), quitRace(), renderOnline(el, ctx), state}
 */
(function (global) {
  "use strict";
  var FC = global.FC;
  var MP = function () { return FC.mp || {}; };
  var S = { tracks: [], byId: {}, race: null, room: null, cvt: null, coop: null, invites: [], dist: null, bonus: 0,
    weekly: null, boards: null };

  function http() { return FC.gsOff() ? null : FC.gs(); }
  function getJSON(path) {
    var h = http();
    if (!h) return Promise.reject(new Error("off"));
    return fetch(h + path).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }
  function esc(s) { return FC.hud && FC.hud.esc ? FC.hud.esc(s) : String(s); }
  function fmtMs(ms) {
    if (ms == null) return "—";
    var s = ms / 1000, m = Math.floor(s / 60);
    return m + ":" + ("0" + (s - m * 60).toFixed(1)).slice(-4);
  }
  function online() { var m = MP(); return !!(m.connected && m.modes); }
  function creatureName(code) { var W = global.FC_SPECIES, m = W && code && W.META[code]; return m ? m[0] : "Агент"; }

  FC.css([
    ".fm-race{position:fixed;left:50%;top:calc(12px + env(safe-area-inset-top));transform:translateX(-50%);z-index:6;",
    "  background:rgba(12,16,32,.82);border:1px solid rgba(255,207,122,.45);border-radius:14px;padding:6px 14px;",
    "  font:700 14px system-ui;color:#fff;display:none;gap:12px;align-items:center;white-space:nowrap;pointer-events:none}",
    ".fm-race.on{display:flex}.fm-race b{font:800 20px system-ui;color:#ffcf7a;min-width:78px;text-align:right}",
    ".fm-race i{font-style:normal;color:rgba(255,255,255,.65);font-size:12px}",
    ".fm-inv{position:fixed;left:14px;bottom:calc(210px + env(safe-area-inset-bottom));z-index:7;width:min(290px,80vw);",
    "  background:rgba(245,247,255,.97);color:#14182a;border-radius:14px;padding:10px 12px;box-shadow:0 8px 24px rgba(0,0,0,.35);",
    "  animation:slide .3s ease-out}",
    ".fm-inv b{display:block;font-size:13px}.fm-inv p{margin:2px 0 8px;font-size:12px}",
    ".fm-inv button{border:0;border-radius:10px;padding:6px 12px;font:700 13px system-ui;cursor:pointer;margin-right:6px}",
    ".fm-inv .y{background:#ffcf7a;color:#2a1205}.fm-inv .n{background:#e3e6ee;color:#334}",
    ".fm-tbl{width:100%;font-size:12px;border-collapse:collapse;margin-top:4px}.fm-tbl td{padding:2px 4px}",
    ".fm-tbl tr.me td{color:#ffcf7a;font-weight:700}",
    ".fm-roles{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}"
  ].join("\n"));

  var panel = document.createElement("div"); panel.className = "fm-race";
  document.body.appendChild(panel);
  function showPanel(html) { panel.innerHTML = html; panel.classList.toggle("on", !!html); }

  /* ---- трассы ------------------------------------------------------------------------------------------- */
  // трассы проложены по Флейм-Сити: в Минске их чекпоинты попали бы в дома — там гонок нет (подсказка загрузки так и говорит)
  (global.FC_CITY === "minsk" ? Promise.resolve(null) : fetch("tracks.json").then(function (r) { return r.json(); })).then(function (d) {
    ((d && d.tracks) || []).forEach(function (t) { S.tracks.push(t); S.byId[t.id] = t; });   // тот же массив, что в FC.modes
    if (FC.map) S.tracks.forEach(function (t) {
      // план города поменяли, а трассы не перегенерировали — чекпоинт окажется в доме: скажем в консоль
      if (t.cps.some(function (p) { return !FC.map.onRoad(p[0], p[1]); }) && global.console) console.warn("tracks.json отстал: " + t.id);
    });
  }).catch(function () { /* без трасс — без гонок */ });
  function refreshBoards() {
    return getJSON("/g/races").then(function (d) { S.weekly = d.weekly; S.boards = d; return d; });
  }

  /* ---- гонка: отсчёт → (сервер «go») → чекпоинты → финиш ------------------------------------------------- */
  function mark(id, p, color, ring, route, icon) {
    if (!FC.markers) return;
    FC.markers.add({ id: id, x: p[0], z: p[1], color: color, ring: ring, route: route, icon: icon || "🏁" });
  }
  function clearRaceMarks() { if (FC.markers) { FC.markers.remove("race-cp"); FC.markers.remove("race-cp2"); } }
  function carSpeed() { var P = FC.player, c = P && P.car; return c ? Math.hypot(c.vx || 0, c.vz || 0) : 0; }

  function startRace(id) {
    var t = S.byId[id], P = FC.player;
    if (!t || !P || S.race) return;
    if (P.mode !== "car" || !P.car) { if (FC.hud) FC.hud.toast("Гонка — на машине: сядь в любую (F)", "bad", 3); return; }
    if (Math.hypot(P.x - t.cps[0][0], P.z - t.cps[0][1]) > 25) {
      mark("race-start", t.cps[0], "#ff8a3d", 10, true);
      if (FC.hud) FC.hud.toast("Маршрут к старту «" + t.name + "» на карте", "", 3);
      return;
    }
    S.race = { id: id, t: t, phase: "count", n: t.cps.length, i: 1, t0: 0, local: !online(), split: null };
    if (FC.markers) FC.markers.remove("race-start");
    if (FC.police && FC.police.stars) FC.police.clear();
    var steps = ["3", "2", "1"], k = 0;
    (function tick() {
      if (!S.race || S.race.phase !== "count") return;
      if (k < steps.length) {
        if (FC.hud) FC.hud.big(steps[k], k === 0 ? "«" + t.name + "» — стой до старта" : "", "#ffcf7a", 0.9);
        if (FC.audio) FC.audio.play("blip");
        if (carSpeed() > 3.5) { dq("фальстарт — стой до «Марш!»"); return; }
        k++; setTimeout(tick, 1000); return;
      }
      if (FC.hud) FC.hud.big("МАРШ!", "", "#9dffbf", 0.9);
      if (FC.audio) FC.audio.play("mission");
      if (S.race.local) go();
      else {
        MP().send({ t: "race", a: "start", id: id });
        S.race.phase = "wait";
        setTimeout(function () { if (S.race && S.race.phase === "wait") { S.race.local = true; go(); } }, 2500);
      }
    })();
  }
  function go(weekly) {
    var r = S.race; if (!r) return;
    r.phase = "run"; r.t0 = performance.now(); r.weekly = !!weekly;
    if (FC.fx) FC.fx.haptic("medium");
    nextMarks();
  }
  function nextMarks() {
    var r = S.race; if (!r) return;
    clearRaceMarks();
    if (r.i < r.n) mark("race-cp", r.t.cps[r.i], r.i === r.n - 1 ? "#9dffbf" : "#ffcf3f", 14, true, r.i === r.n - 1 ? "🏁" : "◆");
    if (r.i + 1 < r.n) mark("race-cp2", r.t.cps[r.i + 1], "#ffcf3f", 8, false, "·");
  }
  function quitRace(why) {
    if (!S.race) return;
    if (!S.race.local && online()) MP().send({ t: "race", a: "quit" });
    dq(why || "сход");
  }
  function dq(why) {
    var r = S.race; if (!r) return;
    S.race = null; clearRaceMarks(); showPanel("");
    if (FC.hud) FC.hud.big("ГОНКА ОКОНЧЕНА", why, "#ff6b7a", 2.8);
    if (FC.audio) FC.audio.play("fail");
  }
  function finish(ms, official) {
    var r = S.race; if (!r) return;
    S.race = null; clearRaceMarks(); showPanel("");
    var sec = ms / 1000, md = r.t.medals || [0, 0, 0];
    var medal = sec <= md[0] ? ["🥇 ЗОЛОТО", 1500] : sec <= md[1] ? ["🥈 СЕРЕБРО", 900] : sec <= md[2] ? ["🥉 БРОНЗА", 500] : ["ФИНИШ", 200];
    var bests = FC.save.races || (FC.save.races = {});
    var prev = bests[r.id], rec = prev == null || ms < prev;
    if (rec) bests[r.id] = ms;
    FC.money(medal[1], "гонка: " + r.t.name);
    if (FC.hud) FC.hud.big(medal[0] + " · " + fmtMs(ms), (rec ? "Личный рекорд! " : "") + (official ? (official.rank ? "Место в таблице: " + official.rank : "")
      : "Без связи — время только у тебя"), "#ffcf7a", 4);
    if (FC.fx) { FC.fx.burst(FC.player.x, 2, FC.player.z, "confetti", 50); FC.fx.haptic("heavy"); }
    if (FC.audio) FC.audio.play("cash");
    FC.emit("race:done", { id: r.id, ms: ms, medal: medal[0], official: !!official });
    FC.dirty();
  }
  FC.on("mp:race", function (m) {
    var r = S.race;
    if (m.e === "go" && r && r.id === m.id) go(m.weekly);
    else if (m.e === "cp" && r && r.id === m.id) { r.split = m.ms; if (m.i > r.i) { r.i = m.i; nextMarks(); } }
    else if (m.e === "done" && r && r.id === m.id) finish(m.ms, m);
    else if (m.e === "dq" && r && r.id === m.id) dq(m.why);
    else if (m.e === "dq" && !r && FC.hud) FC.hud.toast("🏁 " + m.why, "bad", 3);
  });
  FC.on("mp:off", function () { if (S.race && !S.race.local && S.race.phase === "run") { S.race.local = true; } });

  function raceUpdate() {
    var r = S.race, P = FC.player;
    if (!r || r.phase !== "run" || !P) return;
    if (P.mode !== "car") { quitRace("вышел из машины"); return; }
    var c = r.t.cps[r.i];
    if (c && Math.hypot(P.x - c[0], P.z - c[1]) < 18) {
      r.i++;
      if (FC.audio) FC.audio.play("blip");
      if (FC.fx) FC.fx.haptic("light");
      if (r.i >= r.n) {
        if (r.local) finish(performance.now() - r.t0, null);
        else showPanel("<span>🏁 финиш — ждём время сервера…</span>");
        if (!r.local) setTimeout(function () { if (S.race === r) finish(performance.now() - r.t0, null); }, 4000);
        return;
      }
      nextMarks();
    }
    var el = performance.now() - r.t0, best = FC.save.races && FC.save.races[r.id];
    showPanel("<span>" + esc(r.t.emoji + " " + r.t.name) + (r.weekly ? " · <i>трасса недели</i>" : "") + "</span><span>КП " + Math.min(r.i, r.n - 1) +
      "/" + (r.n - 1) + "</span><b>" + fmtMs(el) + "</b>" + (best ? "<i>рекорд " + fmtMs(best) + "</i>" : "") + (r.local ? "<i>без связи</i>" : ""));
  }

  /* ---- карта: флажки стартов, игроки комнаты, фургон и схрон ----------------------------------------------- */
  function onMap(ctx, k, kind) {
    var u = 1 / k;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    if (kind === "big" || !S.race) {
      S.tracks.forEach(function (t) {
        var p = t.cps[0];
        ctx.fillStyle = t.id === S.weekly ? "rgba(255,138,61,.95)" : "rgba(20,24,40,.85)";
        ctx.beginPath(); ctx.arc(p[0], p[1], 9 * u, 0, 7); ctx.fill();
        ctx.font = (11 * u) + "px system-ui"; ctx.fillStyle = "#fff"; ctx.fillText("🏁", p[0], p[1] + 0.5 * u);
        if (kind === "big") { ctx.font = "700 " + (11 * u) + "px system-ui"; ctx.fillStyle = "#ffcf7a"; ctx.fillText(t.name, p[0], p[1] + 16 * u); }
      });
    }
    if (S.race) {                                                   // трасса гонки — линией
      var cps = S.race.t.cps;
      ctx.strokeStyle = "rgba(255,207,63,.8)"; ctx.lineWidth = 4 * u; ctx.setLineDash([8 * u, 6 * u]);
      ctx.beginPath(); cps.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.stroke();
      ctx.setLineDash([]);
    }
    var pos = S.roomPos;
    if (pos && S.room && S.room.phase === "run") {
      pos.forEach(function (p) {
        if (p[0] === MP().id) return;
        var role = (S.cvt && S.cvt.roles[p[0]]) || (S.room.roles && S.room.roles[p[0]]);
        var thief = role === "thief", caught = S.cvt && S.cvt.caught.indexOf(p[0]) >= 0;
        if (thief && caught) return;
        var blink = !thief || (performance.now() / 500 | 0) % 2;
        if (!blink) return;
        ctx.fillStyle = thief ? "#ff3b5c" : role === "cop" ? "#3b8bff" : "#7dffb0";
        ctx.beginPath(); ctx.arc(p[1], p[2], 7 * u, 0, 7); ctx.fill();
      });
    }
    if (S.coop && S.coop.van) {
      ctx.fillStyle = "#2fbf71"; ctx.beginPath(); ctx.arc(S.coop.van[0], S.coop.van[1], 9 * u, 0, 7); ctx.fill();
      ctx.font = (11 * u) + "px system-ui"; ctx.fillStyle = "#fff"; ctx.fillText("💰", S.coop.van[0], S.coop.van[1]);
    }
  }
  if (FC.hud && FC.hud.addMapLayer) FC.hud.addMapLayer(onMap);

  /* ---- старт у флажка: E в машине; ближний флажок — столбом света --------------------------------------- */
  var flagId = null;
  function nearestStart(P) {
    var best = null, bd = 1e18;
    S.tracks.forEach(function (t) { var d = FC.dist2(P.x, P.z, t.cps[0][0], t.cps[0][1]); if (d < bd) { bd = d; best = t; } });
    return best ? { t: best, d: Math.sqrt(bd) } : null;
  }
  function flagUpdate() {
    var P = FC.player; if (!P || !FC.markers) return;
    var n = S.race || S.room && S.room.phase === "run" ? null : nearestStart(P);
    var want = n && n.d < 160 ? n.t.id : null;
    if (want === flagId) return;
    if (flagId) FC.markers.remove("race-flag");
    flagId = want;
    if (want) FC.markers.add({ id: "race-flag", x: n.t.cps[0][0], z: n.t.cps[0][1], color: "#ff8a3d", ring: 6, icon: "🏁", blip: false });
  }
  function provider(px, pz, room) {
    var P = FC.player;
    if (room != null || !P || S.race) return null;
    var out = [];
    S.tracks.forEach(function (t) {
      var p = t.cps[0];
      if (FC.dist2(px, pz, p[0], p[1]) < 14 * 14) {
        out.push({ id: "race-" + t.id, x: p[0], z: p[1], r: 14, key: "use", mode: "car",
          label: "🏁 Гонка «" + t.name + "» · " + (t.len / 1000).toFixed(1) + " км" + (t.id === S.weekly ? " · трасса недели" : ""),
          act: function () { startRace(t.id); } });
      }
    });
    // совместный налёт: мешки у фургона — пешком
    if (S.coop && S.coop.step === "loot" && S.coop.van && P.mode === "foot" && FC.dist2(px, pz, S.coop.van[0], S.coop.van[1]) < 16) {
      out.push({ id: "coop-bag", x: S.coop.van[0], z: S.coop.van[1], r: 4.5, key: "use", label: "💰 Взять мешок (" + (S.coop.bags || 0) + ")",
        act: function () { MP().send({ t: "coop", a: "bag" }); } });
    }
    return out;
  }
  var providerOn = false;
  function bindProvider() { if (!providerOn && FC.interact) { providerOn = true; FC.interact.provider(provider); } }

  /* ---- комнаты: приглашения, состояние, раунды -------------------------------------------------------------- */
  var invEl = null;
  function showInvite(m) {
    if (S.room || !FC.hud) return;
    if (invEl) invEl.remove();
    invEl = document.createElement("div"); invEl.className = "fm-inv ui";
    invEl.innerHTML = "<b>" + (m.kind === "cvt" ? "🚓 Коп против вора" : "💰 Совместный налёт") + "</b><p>" + esc(m.host) + " зовёт в " +
      (m.kind === "cvt" ? "раунд погони" : "налёт на инкассатора") + "</p><button type='button' class='y'>Вступить</button><button type='button' class='n'>Нет</button>";
    document.body.appendChild(invEl);
    var el = invEl;
    el.querySelector(".y").addEventListener("click", function () { MP().send({ t: "room", a: "join", room: m.room }); el.remove(); });
    el.querySelector(".n").addEventListener("click", function () { el.remove(); });
    setTimeout(function () { el.remove(); }, 20000);
    if (FC.audio) FC.audio.play("note");
  }
  function myRole() { return S.room && S.room.players ? (S.room.players.filter(function (p) { return p.id === MP().id; })[0] || {}).role : null; }
  FC.on("mp:room", function (m) {
    var me = MP().id;
    if (m.e === "invite") showInvite(m);
    else if (m.e === "state") {
      var wasRun = S.room && S.room.phase === "run";
      S.room = m.players && m.players.some(function (p) { return p.id === me; }) ? m : null;
      if (wasRun && (!S.room || S.room.phase !== "run")) cleanupRun();
    } else if (m.e === "left") { S.room = null; cleanupRun(); }
    else if (m.e === "gone") { if (FC.hud) FC.hud.toast(m.why || "Комната закрыта", "bad", 3); }
    else if (m.e === "start" && m.kind === "cvt") {
      S.cvt = { roles: m.roles, caught: [], head: m.head };
      if (S.room) S.room.phase = "run";
      var thief = m.roles[me] === "thief";
      if (FC.police) FC.police.clear();
      if (FC.hud) {
        FC.hud.big(thief ? "ТЫ — ВОР" : "ТЫ — КОП", thief ? "Уйди от копов " + Math.round(m.round / 60) + " мин. Фора " + m.head + " с" :
          "Поймай вора: коснись машиной или стой рядом 3 с. Вор мигает на карте", thief ? "#ff6b7a" : "#6bb8ff", 4);
        FC.hud.timer(m.round, "раунд", null);
        FC.hud.objective(thief ? "Ты <b>вор</b> — не дай себя поймать" : "Ты <b>коп</b> — поймай <em>вора</em> (красный на карте)");
      }
    } else if (m.e === "start" && m.kind === "coop") {
      S.coop = { step: "chase", van: m.van, target: m.van.slice(), drop: m.drop, vhp: 100, bags: 0, carry: {}, policed: false };
      if (S.room) S.room.phase = "run";
      makeVan();
      if (FC.hud) {
        FC.hud.big("НАЛЁТ НА ИНКАССАТОРА", "Протараньте фургон, вскройте двери, унесите мешки в схрон", "#2fbf71", 4);
        FC.hud.timer(m.limit, "налёт", null);
        FC.hud.objective("Догоните <b>фургон</b> 💰 и тараньте, пока не встанет");
      }
    } else if (m.e === "pos") {
      S.roomPos = m.ps;
      if (S.cvt) { S.cvt.caught = m.caught || []; }
      if (S.coop) {
        S.coop.target = m.van; S.coop.vhp = m.vhp; S.coop.step = m.step; S.coop.open = m.open; S.coop.bags = m.bags; S.coop.drop = m.drop;
        coopCarry(m.carry || {});
        if (m.step === "doors" && FC.hud) FC.hud.objective("Вскрываем двери: " + Math.min(100, Math.round((m.open || 0) / 6 * 100)) + "% — стой у фургона пешком" +
          (myRole() === "hacker" ? " (хакер — быстрее)" : ""));
      }
    } else if (m.e === "catch") {
      if (S.cvt) S.cvt.caught.push(m.thief);
      if (m.thief === me) { if (FC.hud) FC.hud.big("ТЕБЯ ПОЙМАЛИ", "Раунд для тебя окончен", "#6bb8ff", 3); }
      else if (FC.hud) FC.hud.toast("🚓 Вор пойман!", "ok", 2.5);
      if (FC.fx) FC.fx.haptic("heavy");
    } else if (m.e === "end") {
      var pay = (m.pay && m.pay[String(me)]) || 0;
      if (pay > 0) FC.money(pay, m.kind === "cvt" ? "онлайн: коп против вора" : "налёт: инкассатор (группа)");
      if (FC.hud) {
        var title = m.kind === "cvt" ? (m.win === "cops" ? "КОПЫ ПОБЕДИЛИ" : "ВОРЫ УШЛИ") : (m.how === "win" ? "НАЛЁТ УДАЛСЯ" : "НАЛЁТ СОРВАН");
        FC.hud.big(title, pay ? "+" + FC.fmtMoney(pay) : "", "#ffcf7a", 4);
      }
      if (FC.fx && pay) FC.fx.burst(FC.player.x, 2, FC.player.z, "cash", 30);
      cleanupRun();
    }
  });
  FC.on("mp:coop", function (m) {
    var c = S.coop; if (!c) return;
    if (m.e === "van") { c.target = m.van; c.vhp = m.vhp; }
    else if (m.e === "phase") {
      var was = c.step;
      c.step = m.step;
      if (m.bags != null) c.bags = m.bags;
      if (m.drop) c.drop = m.drop;
      if (m.carry) coopCarry(m.carry);
      if (was !== m.step && FC.hud) {
        if (m.step === "doors") { FC.hud.big("ФУРГОН ВСТАЛ", "Выходите — вскрываем задние двери", "#2fbf71", 2.5); if (FC.fx) FC.fx.hitstop(0.2, 0.2); }
        if (m.step === "loot") {
          FC.hud.objective("Хватайте <b>мешки</b>: E у фургона (грузчик несёт два)");
          if (!c.policed && FC.police && FC.police.add) { c.policed = true; FC.police.add(3); }
        }
        if (m.step === "escape") {
          FC.hud.objective("Несите мешки в <b>схрон</b> — уходите от погони");
          if (FC.markers && c.drop) FC.markers.add({ id: "coop-drop", x: c.drop[0], z: c.drop[1], color: "#2fbf71", ring: 12, route: true, icon: "💰" });
        }
      }
    }
  });
  function coopCarry(carry) {
    var c = S.coop; if (!c) return;
    c.carry = carry;
    var n = carry[String(MP().id)] || 0, P = FC.player;
    if (P) P.speedMul = n ? Math.max(0.6, 1 - 0.15 * n) : 1;       // мешки тяжёлые
  }
  var vanObj = null;
  function makeVan() {
    if (vanObj || !FC.cars || typeof FC.cars.visual !== "function" || !FC.gfx) return;
    try { var v = FC.cars.visual("van", 0x2e7d32); vanObj = v && (v.isObject3D ? v : v.obj); } catch (e) { vanObj = null; }
    if (vanObj) FC.gfx.scene.add(vanObj);
  }
  function cleanupRun() {
    if (vanObj && vanObj.parent) vanObj.parent.remove(vanObj);
    vanObj = null;
    if (S.coop && FC.player) FC.player.speedMul = 1;
    S.cvt = null; S.coop = null; S.roomPos = null;
    if (FC.markers) FC.markers.remove("coop-drop");
    if (FC.hud) { FC.hud.objective(""); FC.hud.timer(null); }
  }
  var lastHit = 0;
  function coopUpdate(dt) {
    var c = S.coop; if (!c || !c.target) return;
    if (!c.van) c.van = c.target.slice();
    var dx = c.target[0] - c.van[0], dz = c.target[1] - c.van[1], d = Math.hypot(dx, dz);
    if (d > 40) { c.van = c.target.slice(); } else { var k = 1 - Math.exp(-6 * dt); c.van[0] += dx * k; c.van[1] += dz * k; }
    if (vanObj) {
      vanObj.position.set(c.van[0], 0, c.van[1]);
      if (d > 0.2) vanObj.rotation.y = FC.angDamp(vanObj.rotation.y, Math.atan2(dx, dz), 5, dt);
      vanObj.visible = !(FC.inside && FC.inside.active);
    }
    // таран: своя машина у фургона на скорости — удар (сервер проверит расстояние и режим)
    var P = FC.player, car = P && P.mode === "car" && P.car;
    if (c.step === "chase" && car) {
      var vd = Math.hypot(car.x - c.van[0], car.z - c.van[1]);
      if (vd < 4.2) {
        var rel = Math.hypot(car.vx || 0, car.vz || 0);
        var now = performance.now();
        if (rel > 3 && now - lastHit > 300) {
          lastHit = now;
          MP().send({ t: "coop", a: "hit", p: Math.min(30, rel * 1.6) });
          if (FC.fx) { FC.fx.burst((car.x + c.van[0]) / 2, 1, (car.z + c.van[1]) / 2, "sparks", 18); FC.fx.haptic("medium"); }
          if (FC.cam && FC.cam.shake) FC.cam.shake(0.3);
          var nx = (car.x - c.van[0]) / (vd || 1), nz = (car.z - c.van[1]) / (vd || 1);
          car.vx = nx * rel * 0.35; car.vz = nz * rel * 0.35;                 // отскок, а не проезд сквозь
        }
      }
    }
    if (c.step === "chase" && FC.hud && (performance.now() / 1000 | 0) % 2 === 0) FC.hud.objective("Тараньте <b>фургон</b>: прочность " + Math.max(0, c.vhp) + "%");
  }

  /* ---- рейтинг районов и бонус лидеру ------------------------------------------------------------------ */
  function myDistrict() { var h = FC.me && FC.me.home; return h && h.dist; }
  function refreshDistricts() {
    return getJSON("/g/districts").then(function (d) {
      S.dist = d;
      S.bonus = d && d.leader && d.leader === myDistrict() && !MP().guest ? (d.bonus || 0) : 0;
      return d;
    });
  }
  var money0 = FC.money;
  FC.money = function (delta, why) {
    var r = money0(delta, why);
    if (r !== false && S.bonus > 0 && delta > 0 && !/бонус района/.test(why || "")) money0(Math.round(delta * S.bonus), "бонус района");
    return r;
  };

  /* ---- телефон: «Гонки» и раздел режимов в «Онлайн» --------------------------------------------------------- */
  function renderRaces(b, ctx) {
    var bests = FC.save.races || {};
    if (FC.city === "minsk") {                       // трассы недели проложены по Флейм-Сити (сервер тоже не стартует их в Минске)
      b.innerHTML = "<div class='list'><div class='card'><b>🏁 Гонки недели — во Флейм-Сити</b><p>Трассы и таблица рекордов пока " +
        "только там. Минские трассы по проспектам — следом.</p><button type='button' data-city='flame'>Во Флейм-Сити</button></div></div>";
      b.querySelector("[data-city]").addEventListener("click", function () {
        try { global.localStorage.setItem("fc.city", "flame"); } catch (e) { /* приватное окно */ }
        if (FC.saveNow) FC.saveNow();
        var u = new URL(global.location.href); u.searchParams.set("city", "flame"); global.location.href = u.toString();
      });
      return;
    }
    function draw() {
      var wk = S.weekly, boards = S.boards && S.boards.boards;
      var html = "<div class='list'>";
      if (S.boards) {
        var t = S.byId[wk], days = Math.floor((S.boards.ends_in || 0) / 86400), hrs = Math.floor(((S.boards.ends_in || 0) % 86400) / 3600);
        if (t) {
          html += "<div class='card'><b>🏆 Трасса недели: " + esc(t.emoji + " " + t.name) + "</b><p>до конца недели " + days + " д " + hrs + " ч · " +
            (t.len / 1000).toFixed(1) + " км. Тройка недели — в «Зале славы» до следующей трассы.</p>" + table(boards && boards[wk]) +
            "<button type='button' data-go='" + t.id + "' style='margin-top:6px'>Маршрут к старту</button></div>";
        }
        if (S.boards.last && S.boards.last.length) {
          html += "<div class='card'><b>Прошлая неделя</b>" + S.boards.last.map(function (x) {
            return "<p>" + ["", "🥇", "🥈", "🥉"][x.place] + " " + esc(x.name || creatureName(x.creature)) + " — " + fmtMs(x.ms) + "</p>";
          }).join("") + "</div>";
        }
      } else html += "<div class='card'><b>Таблица рекордов</b><p>" + (http() ? "загружаю…" : "онлайн выключен") + "</p></div>";
      html += S.tracks.map(function (t) {
        var md = t.medals, my = bests[t.id], medal = my == null ? "" : my / 1000 <= md[0] ? "🥇" : my / 1000 <= md[1] ? "🥈" : my / 1000 <= md[2] ? "🥉" : "🏁";
        return "<div class='card'><b>" + esc(t.emoji + " " + t.name) + (t.id === wk ? " · неделя" : "") + "</b><p>" + (t.len / 1000).toFixed(1) + " км · " +
          (t.loop ? "круг" : "спринт") + " · золото " + fmtMs(md[0] * 1000) + (my != null ? " · мой рекорд " + medal + " " + fmtMs(my) : "") + "</p>" +
          "<button type='button' data-go='" + t.id + "'>Маршрут к старту</button>" + (boards && boards[t.id] && boards[t.id].length ?
          " <button type='button' class='ghost' data-b='" + t.id + "'>Рекорды</button>" : "") + "<div class='fm-b' data-bb='" + t.id + "'></div></div>";
      }).join("") + "</div>";
      b.innerHTML = html;
      b.querySelectorAll("[data-go]").forEach(function (x) {
        x.addEventListener("click", function () {
          var t = S.byId[x.dataset.go];
          if (t) { mark("race-start", t.cps[0], "#ff8a3d", 10, true); FC.hud.toast("🏁 Маршрут к старту «" + t.name + "». Подъедь на машине и жми E", "ok", 4); ctx.close(); }
        });
      });
      b.querySelectorAll("[data-b]").forEach(function (x) {
        x.addEventListener("click", function () { var el = b.querySelector("[data-bb='" + x.dataset.b + "']"); if (el) el.innerHTML = table(boards[x.dataset.b]); });
      });
    }
    function table(rows) {
      if (!rows || !rows.length) return "<p class='quiet'>Пока никто не проехал — стань первым.</p>";
      return "<table class='fm-tbl'>" + rows.map(function (r, i) {
        return "<tr><td>" + (i + 1) + ".</td><td>" + esc(r.name || creatureName(r.creature)) + "</td><td style='text-align:right'>" + fmtMs(r.ms) + "</td></tr>";
      }).join("") + "</table>";
    }
    draw();
    refreshBoards().then(draw).catch(function () { /* без сервера — только свои рекорды */ });
  }
  if (FC.hud) FC.hud.addApp({ id: "races", icon: "🏁", name: "Гонки", color: "#d9480f", order: 5, render: renderRaces });

  function renderOnline(el, ctx) {
    if (!el) return;
    function draw() {
      var me = MP().id, html = "";
      if (!online()) { el.innerHTML = "<div class='card'><b>Режимы онлайна</b><p>Нужна связь с сервером онлайна.</p></div>"; return; }
      var d = S.dist, my = myDistrict();
      html += "<div class='card'><b>🗺️ Рейтинг районов — неделя</b>" + (d ? "<table class='fm-tbl'>" + d.table.map(function (x, i) {
        return "<tr class='" + (x.d === my ? "me" : "") + "'><td>" + (i + 1) + ".</td><td>" + esc(x.name) + "</td><td style='text-align:right'>" + x.pts + "</td></tr>";
      }).join("") + "</table><p class='quiet'>Твой район — по дому" + (my && d.table ? ": " + esc((d.table.filter(function (x) { return x.d === my; })[0] || {}).name || "") : "") +
        ". Заработок, гонки, раунды и налёты приносят очки. Победитель недели — +10% к доходу всем его жителям." +
        (S.bonus ? " <b style='color:#9dffbf'>Твой район — лидер прошлой недели: +10%!</b>" : "") + "</p>" : "<p>загружаю…</p>") + "</div>";
      var R = S.room;
      if (R) {
        var host = R.host === me;
        html += "<div class='card'><b>" + (R.kind === "cvt" ? "🚓 Коп против вора" : "💰 Налёт на инкассатора") + " · " + (R.phase === "run" ? "идёт" : "сбор") +
          "</b>" + R.players.map(function (p) {
            var role = p.role ? { driver: "водитель", hacker: "хакер", loader: "грузчик", cop: "коп", thief: "вор" }[p.role] || p.role : "";
            return "<p>" + (p.id === R.host ? "👑 " : "") + esc(p.name || creatureName(p.creature)) + (p.id === me ? " (ты)" : "") + (role ? " · " + role : "") + "</p>";
          }).join("");
        if (R.kind === "coop" && R.phase === "lobby") {
          html += "<div class='fm-roles'>" + ["driver", "hacker", "loader"].map(function (r) {
            return "<button type='button' class='ghost' data-role='" + r + "'>" + { driver: "🚗 водитель", hacker: "💻 хакер", loader: "💪 грузчик" }[r] + "</button>";
          }).join("") + "</div>";
        }
        if (host && R.phase === "lobby") html += "<button type='button' data-start='1' style='margin-top:6px'" + (R.players.length < 2 ? " disabled" : "") + ">Старт (" + R.players.length + "/" + R.max + ")</button> ";
        html += "<button type='button' class='ghost' data-leave='1' style='margin-top:6px'>Выйти</button></div>";
      } else {
        html += "<div class='card'><b>Режимы с игроками рядом</b><p>Позови тех, кто в радиусе 350 м: им придёт приглашение.</p>" +
          "<button type='button' data-create='cvt'>🚓 Коп против вора</button>" +
          (FC.city === "minsk" ? "" : " <button type='button' data-create='coop'>💰 Налёт вместе</button>") + "</div>";
      }
      el.innerHTML = html;
      el.querySelectorAll("[data-create]").forEach(function (x) {
        x.addEventListener("click", function () { MP().send({ t: "room", a: "create", kind: x.dataset.create }); setTimeout(draw, 400); });
      });
      el.querySelectorAll("[data-role]").forEach(function (x) { x.addEventListener("click", function () { MP().send({ t: "room", a: "role", role: x.dataset.role }); setTimeout(draw, 300); }); });
      el.querySelectorAll("[data-start]").forEach(function (x) { x.addEventListener("click", function () { MP().send({ t: "room", a: "start" }); ctx.close(); }); });
      el.querySelectorAll("[data-leave]").forEach(function (x) {
        x.addEventListener("click", function () { MP().send({ t: "room", a: "leave" }); S.room = null; cleanupRun(); draw(); });
      });
    }
    draw();
    refreshDistricts().then(draw).catch(function () { /* сервер без режимов */ });
  }

  /* ---- кадр ---------------------------------------------------------------------------------------------- */
  var slowT = 0;
  FC.addSystem({
    name: "modes", order: 86,
    init: bindProvider,
    update: function (dt) {
      if (!FC.started) return;
      bindProvider();
      raceUpdate();
      coopUpdate(dt);
      slowT -= dt;
      if (slowT <= 0) { slowT = 0.5; flagUpdate(); }
    }
  });
  FC.on("mp:on", function (m) {
    if (!m.modes) return;
    refreshDistricts().catch(function () { /* потом */ });
    refreshBoards().catch(function () { /* потом */ });
  });
  setInterval(function () { if (online()) refreshDistricts().catch(function () { /* потом */ }); }, 300000);

  FC.modes = { tracks: S.tracks, byId: S.byId, startRace: startRace, quitRace: quitRace, renderOnline: renderOnline, state: S };
})(window);
