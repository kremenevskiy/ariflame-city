/* Флейм-Сити — рейтинги и профиль игрока (FC.ranks): приложение «Рейтинг», карточка игрока, «мой рейтинг».
 *
 * Задача: «рейтинги, лидерборды, захваты, рейтинг игроков, как в Rise of Kingdoms». Ресёрч: рейтинги
 * силы и альянсов RoK, лидерборды СНГ-RP, Steam-редкость достижений. Сервер — server/progress.py:
 *   GET /g/ranks?board=level|worth|biz|infl|race|crew&scope=week|all&city=flame|minsk|all   (кэш 30 с, у нас — 60 с)
 *   POST /g/prog/me — свой профиль и места во всех рейтингах; GET /g/profile?fid= — карточка другого игрока.
 * Наружу — вид существа и ник из списка слов (никаких имён агентов и rid). Карточку игрока открывают: строка рейтинга,
 * «Онлайн» (рядом / все в городе), чат и состав клана, а в мире — «E — профиль игрока» рядом с другим игроком.
 *   FC.ranks.show(fid) — открыть телефон на карточке; FC.ranks.board(b, scope, city) → Promise.
 */
(function (global) {
  "use strict";
  var FC = global.FC;
  var BOARDS = [
    { id: "level", name: "Уровень", icon: "⭐", unit: "опыта" },
    { id: "worth", name: "Состояние", icon: "💎", money: true, noWeek: true },
    { id: "biz", name: "Бизнес", icon: "🏪", money: true },
    { id: "infl", name: "Влияние", icon: "⚔️", unit: "влияния" },
    { id: "race", name: "Гонки", icon: "🏁" },
    { id: "crew", name: "Кланы", icon: "🛡️", unit: "силы" }
  ];
  var S = { tab: "me", board: "level", scope: "week", city: FC.city || "flame", cache: {}, prof: {}, view: null };

  FC.css([
    ".rk-chips{display:flex;gap:4px;margin:0 0 6px;flex-wrap:wrap}.rk-chips button{flex:1 1 auto;padding:5px 6px!important;font-size:11px!important}",
    ".rk-row{display:flex;align-items:center;gap:7px;padding:6px 8px;border-radius:12px;background:rgba(255,255,255,.06);margin-bottom:4px;cursor:pointer}",
    ".rk-row.me{background:rgba(255,207,122,.18);outline:1px solid rgba(255,207,122,.45)}",
    ".rk-row .n{width:24px;text-align:center;font:800 13px system-ui;color:rgba(255,255,255,.7)}.rk-row .n.m1{color:#ffd166}.rk-row .n.m2{color:#cfd8e3}.rk-row .n.m3{color:#e0a070}",
    ".rk-row .fc{width:28px;height:28px;border-radius:8px;flex:none;display:grid;place-items:center;font-size:18px;background:rgba(255,255,255,.08)}",
    ".rk-row .t{flex:1;min-width:0}.rk-row .t b{display:block;font:700 12.5px system-ui;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".rk-row .t i{font:600 10.5px system-ui;font-style:normal;color:rgba(255,255,255,.55)}.rk-row .v{font:800 12px system-ui;color:#ffcf7a;text-align:right}",
    ".rk-tag{display:inline-block;padding:0 5px;border-radius:6px;font:800 10px system-ui;color:#111;margin-right:4px;vertical-align:1px}",
    ".rk-head{display:flex;gap:10px;align-items:center}.rk-head .fc{width:54px;height:54px;border-radius:14px;flex:none;display:grid;place-items:center;font-size:30px;background:rgba(255,255,255,.08)}",
    ".rk-head b{font:800 16px system-ui}.rk-head p{margin:2px 0 0}",
    ".rk-xp{height:7px;border-radius:4px;background:rgba(255,255,255,.12);overflow:hidden;margin:8px 0 2px}.rk-xp i{display:block;height:100%;background:linear-gradient(90deg,#ffcf7a,#ff9b4a)}",
    ".rk-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;margin-top:8px}.rk-grid div{background:rgba(255,255,255,.07);border-radius:10px;padding:6px;font-size:10.5px;color:rgba(255,255,255,.6)}",
    ".rk-grid b{display:block;font:800 13px system-ui;color:#fff}",
    ".rk-pos{display:grid;grid-template-columns:1.3fr 1fr 1fr;gap:3px 6px;font-size:11.5px}.rk-pos b{font-weight:800;color:#ffcf7a}.rk-pos span{color:rgba(255,255,255,.7)}"
  ].join("\n"));

  function esc(s) { return FC.hud.esc(s); }
  function token() { return FC.net && FC.net.token; }
  function num(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " "); }
  function cityLabel(c) { return c === "minsk" ? "Минск" : c === "flame" ? "Флейм-Сити" : "весь мир"; }
  function face(cre) {
    var cell = cre && FC.people ? FC.people.cellOf(cre) : -1;
    return cell >= 0 ? "<span class='fc' style='" + FC.hud.atlasStyle(cell) + "'></span>" : "<span class='fc'>🥚</span>";
  }
  function tagChip(tag, col) { return tag ? "<span class='rk-tag' style='background:" + esc(col || "#ffcf7a") + "'>" + esc(tag) + "</span>" : ""; }
  function fmtVal(b, v, asc) {
    var B = BOARDS.filter(function (x) { return x.id === b; })[0] || {};
    if (b === "race") return asc ? (v / 1000).toFixed(2) + " с" : num(v) + " медал.";
    return B.money ? FC.fmtMoney(v) : num(v) + (B.unit ? " " + B.unit : "");
  }
  function getJSON(url) { return FC.gfetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }

  function board(b, scope, city) {
    var k = b + ":" + scope + ":" + city, hit = S.cache[k];
    if (hit && Date.now() - hit.at < 60000) return Promise.resolve(hit.d);
    return getJSON("/g/ranks?board=" + b + "&scope=" + scope + "&city=" + city + "&n=50").then(function (d) {
      S.cache[k] = { at: Date.now(), d: d }; return d;
    });
  }
  function profile(fid) {
    var hit = S.prof[fid];
    if (hit && Date.now() - hit.at < 60000) return Promise.resolve(hit.d);
    return getJSON("/g/profile?fid=" + encodeURIComponent(fid)).then(function (d) { S.prof[fid] = { at: Date.now(), d: d }; return d; });
  }

  /* ---- карточка игрока ------------------------------------------------------------------------------------------- */
  function cardHtml(p, mine) {
    var lv = p.lvl, cur = p.cur, nx = p.next, pct = Math.max(0, Math.min(100, (p.xp - cur) / Math.max(1, nx - cur) * 100));
    var m = p.medals || {};
    var cr = p.crew;
    return "<div class='card'><div class='rk-head'>" + face(p.cre) + "<div><b>" + (cr ? tagChip(cr.tag, cr.color) : "") + esc(p.nick) + "</b>" +
      "<p>⭐ " + lv + " · " + esc(p.title) + (cr ? " · " + cr.emblem + " " + esc(cr.name) : "") + "</p></div></div>" +
      "<div class='rk-xp'><i style='width:" + pct.toFixed(1) + "%'></i></div><p>" + num(p.xp - cur) + " / " + num(nx - cur) + " опыта до " + (lv + 1) + "-го" +
      (mine && p.today ? " · сегодня " + num(p.today.xp) + " из " + num(p.today.cap) : "") + "</p>" +
      "<div class='rk-grid'><div><b>" + FC.fmtMoney(p.worth) + "</b>состояние</div><div><b>" + FC.fmtMoney(p.biz_week) + "</b>бизнес за неделю</div>" +
      "<div><b>" + num(p.infl_week) + "</b>влияние недели</div><div><b>" + p.props_n + " · " + p.biz_n + "</b>зданий · бизнесов</div>" +
      "<div><b>🥇" + (m.gold || 0) + " 🥈" + (m.silver || 0) + " 🥉" + (m.bronze || 0) + "</b>медали гонок · " + (m.races || 0) + "</div>" +
      "<div><b>🏅 " + p.ach_n + "</b>достижений</div></div></div>";
  }
  function renderProfile(b, ctl, fid) {
    b.innerHTML = "<div class='list'><div class='row'><button type='button' class='ghost' data-rk-back='1'>‹ Назад</button></div><div class='rk-p card'><p>Загружаю…</p></div></div>";
    b.querySelector("[data-rk-back]").addEventListener("click", function () { S.view = null; ctl.refresh(); });
    profile(fid).then(function (p) {
      var el = b.querySelector(".rk-p"); if (!el) return;
      var me = FC.progress && FC.progress.me(), isMe = me && me.fid === fid;
      var acts = "";
      if (!isMe && FC.crews && FC.crews.canInvite && FC.crews.canInvite() && !p.crew) acts += "<button type='button' data-rk-inv='1'>🛡️ Позвать в клан</button>";
      if (!isMe && p.crew && FC.crews) acts += " <button type='button' class='ghost' data-rk-crew='" + p.crew.id + "'>Клан " + esc(p.crew.tag) + "</button>";
      el.outerHTML = cardHtml(p, false) + (acts ? "<div class='row'>" + acts + "</div>" : "") +
        "<p class='jb-note'>Игроки видны видом агента и ником из игры — имён и адресов в игре нет.</p>";
      var inv = b.querySelector("[data-rk-inv]");
      if (inv) inv.addEventListener("click", function () { FC.crews.invite(fid).then(function (ok) { if (ok) inv.disabled = true; }); });
      var cb = b.querySelector("[data-rk-crew]");
      if (cb) cb.addEventListener("click", function () { FC.crews.showCrew(+cb.dataset.rkCrew); });
    }).catch(function () { var el = b.querySelector(".rk-p"); if (el) el.innerHTML = "<p>Игрок не найден или сервер не ответил.</p>"; });
  }

  /* ---- вкладка «Я» -------------------------------------------------------------------------------------------------- */
  function renderMe(b, ctl) {
    var G = FC.progress;
    if (!token()) {
      var l = G.lvl();
      b.innerHTML = "<div class='list'><div class='card'><b>⭐ Уровень " + l + " · " + esc(G.title(l)) + "</b><p>Опыт копится и у гостя, но рейтинг, клан и награды за вход — после входа в аккаунт. " + esc(FC.net.loginHint()) + "</p></div></div>";
      return;
    }
    var me = G.me();
    if (!me) { b.innerHTML = "<div class='card'><p>Загружаю профиль…</p></div>"; G.refresh(true).then(function () { if (b.isConnected) ctl.refresh(); }); return; }
    if (!G.fresh()) G.refresh(true).then(function () { if (b.isConnected && S.tab === "me" && !S.view) ctl.refresh(); });
    var html = cardHtml(me, true);
    var D = G.daily && G.daily();
    if (D && D.can) html += "<div class='row'><span>🔥 Награда за вход: день " + D.day + " из 7</span><button type='button' data-rk-day='1'>Забрать</button></div>";
    else if (D) html += "<div class='row'><span>🔥 Серия входа: " + D.streak + " дн. (рекорд " + D.best + ")</span><span class='quiet'>завтра — день " + (D.streak % 7 + 1) + "</span></div>";
    // места: доска × (неделя, всё время) по этому городу и по миру
    var R = me.ranks || {}, c = FC.city || "flame";
    html += "<h4>Мой рейтинг</h4><div class='card rk-pos'><span></span><span>неделя</span><span>всё время</span>";
    BOARDS.forEach(function (B) {
      var r = R[B.id]; if (!r) return;
      function cell(sc) {
        var x = r[sc]; if (!x) return "<span>—</span>";
        var a = x[c] || {}, w = x.all || {};
        return "<span>" + (a.pos ? "<b>#" + a.pos + "</b>" : "—") + " / " + (w.pos ? "<b>#" + w.pos + "</b>" : "—") + "</span>";
      }
      html += "<span>" + B.icon + " " + B.name + "</span>" + cell("week") + cell("all");
    });
    html += "</div><p class='quiet'>Место в городе / в мире. Рейтинги обновляются раз в минуту.</p>";
    // титул и ник
    var got = (me.titles || []).filter(function (t) { return t.got; });
    html += "<div class='row'><span>Титул</span><select data-rk-title='1'><option value=''>по уровню</option>" + got.map(function (t) {
      return "<option value='" + esc(t.id) + "'" + (me.title_id === t.id ? " selected" : "") + ">" + esc(t.name) + "</option>";
    }).join("") + "</select></div>";
    var locked = (me.titles || []).filter(function (t) { return !t.got; }).slice(0, 6);
    if (locked.length) html += "<p class='quiet'>Ещё не открыты: " + locked.map(function (t) { return esc(t.name) + (t.lvl ? " (" + t.lvl + ")" : ""); }).join(", ") + "</p>";
    html += "<div class='row'><span>Ник: <b>" + esc(me.nick) + "</b></span><button type='button' class='ghost' data-rk-nick='1'>сменить</button></div>";
    // что откроется дальше
    var next = [];
    for (var l = me.lvl + 1; l <= me.lvl + 30 && next.length < 4; l++) G.unlocks(l).forEach(function (u) { if (next.length < 4) next.push("ур. " + l + " — " + u.icon + " " + u.text); });
    if (next.length) html += "<h4>Дальше откроется</h4><div class='card'>" + next.map(function (t) { return "<p>" + esc(t) + "</p>"; }).join("") + "</div>";
    html += "<p class='jb-note'>Опыт — за любое дело: смены, задания, налёты, гонки, бизнес, районы, помощь клану, достижения. В сутки — не больше " + num(15000) + ". Призы — только игровые.</p>";
    b.innerHTML = "<div class='list'>" + html + "</div>";
    var bd = b.querySelector("[data-rk-day]");
    if (bd) bd.addEventListener("click", function () { ctl.close(); G.dailyCard(); });
    var ts = b.querySelector("[data-rk-title]");
    if (ts) ts.addEventListener("change", function () {
      FC.prop.post("/g/prog/title", { token: token(), title: ts.value }).then(function (d) { FC.hud.toast("Титул: " + d.title, "ok", 2); G.refresh(true).then(ctl.refresh); })
        .catch(function (e) { FC.hud.toast(e.message, "bad", 3); });
    });
    b.querySelector("[data-rk-nick]").addEventListener("click", function () { S.tab = "nick"; ctl.refresh(); });
  }
  var NICKS = ["Комета", "Искра", "Вектор", "Сокол", "Байт", "Гром", "Вираж", "Неон", "Турбо", "Зубр", "Барс", "Рысь", "Кедр",
    "Янтарь", "Метеор", "Призрак", "Тайфун", "Форсаж", "Драйв", "Кадр", "Ритм", "Пиксель", "Шторм", "Ветер", "Факел", "Дрифт",
    "Сигнал", "Радар", "Компас", "Маяк", "Пилот", "Штурман", "Север", "Орбита", "Импульс", "Квант", "Гранит", "Сапсан", "Беркут", "Кречет"];
  function renderNick(b, ctl) {
    var me = FC.progress.me() || {};
    var w = me.nick_w >= 0 ? me.nick_w : 0, n = me.nick_n || 10;
    b.innerHTML = "<div class='list'><div class='card'><b>Ник в игре</b><p>Слово из списка и число — так тебя видят в рейтингах, клане и над головой. Менять — раз в сутки.</p></div>" +
      "<div class='row'><select data-nw='1'>" + NICKS.map(function (x, i) { return "<option value='" + i + "'" + (i === w ? " selected" : "") + ">" + x + "</option>"; }).join("") +
      "</select><input data-nn='1' type='number' min='1' max='99' value='" + n + "' style='width:64px;border-radius:10px;border:0;padding:6px;background:rgba(255,255,255,.12);color:#fff'></div>" +
      "<div class='row'><button type='button' class='ghost' data-nb='1'>‹ Назад</button><button type='button' data-ns='1'>Сохранить</button></div></div>";
    b.querySelector("[data-nb]").addEventListener("click", function () { S.tab = "me"; ctl.refresh(); });
    b.querySelector("[data-ns]").addEventListener("click", function () {
      var ww = +b.querySelector("[data-nw]").value, nn = Math.max(1, Math.min(99, Math.round(+b.querySelector("[data-nn]").value || 1)));
      FC.prop.post("/g/prog/nick", { token: token(), w: ww, n: nn }).then(function (d) {
        FC.hud.toast("Теперь ты — " + d.nick, "ok", 2.5); S.tab = "me"; FC.progress.refresh(true).then(ctl.refresh);
      }).catch(function (e) { FC.hud.toast(e.message, "bad", 3); });
    });
  }

  /* ---- вкладка «Топ» ------------------------------------------------------------------------------------------------- */
  function renderTop(b, ctl) {
    var B = BOARDS.filter(function (x) { return x.id === S.board; })[0];
    if (B.noWeek) S.scope = "all";
    var html = "<div class='rk-chips'>" + BOARDS.map(function (x) {
      return "<button type='button' class='" + (x.id === S.board ? "" : "ghost") + "' data-rkb='" + x.id + "'>" + x.icon + " " + x.name + "</button>";
    }).join("") + "</div><div class='rk-chips'>" +
      (B.noWeek ? "" : [["week", "Неделя"], ["all", "Всё время"]].map(function (x) {
        return "<button type='button' class='" + (x[0] === S.scope ? "" : "ghost") + "' data-rks='" + x[0] + "'>" + x[1] + "</button>";
      }).join("")) +
      (S.board === "race" ? "" : [[FC.city || "flame", FC.city === "minsk" ? "Минск" : "Флейм-Сити"], ["all", "Весь мир"]].map(function (x) {
        return "<button type='button' class='" + (x[0] === S.city ? "" : "ghost") + "' data-rkc='" + x[0] + "'>" + x[1] + "</button>";
      }).join("")) + "</div><div class='rk-list'><p class='quiet'>Загружаю…</p></div>";
    if (S.board === "race") html += "<div class='row'><span>Трасса недели и таблицы трасс</span><button type='button' class='ghost' data-rk-races='1'>🏁 Гонки</button></div>";
    b.innerHTML = html;
    b.querySelectorAll("[data-rkb]").forEach(function (x) { x.addEventListener("click", function () { S.board = x.dataset.rkb; ctl.refresh(); }); });
    b.querySelectorAll("[data-rks]").forEach(function (x) { x.addEventListener("click", function () { S.scope = x.dataset.rks; ctl.refresh(); }); });
    b.querySelectorAll("[data-rkc]").forEach(function (x) { x.addEventListener("click", function () { S.city = x.dataset.rkc; ctl.refresh(); }); });
    var rb = b.querySelector("[data-rk-races]");
    if (rb) rb.addEventListener("click", function () { FC.hud.openPhone("races"); });
    var city = S.board === "race" ? "all" : S.city;
    board(S.board, S.scope, city).then(function (d) {
      var el = b.querySelector(".rk-list"); if (!el) return;
      var me = FC.progress.me(), myFid = me && me.fid, myCrew = me && me.crew && me.crew.id;
      if (!d.rows.length) { el.innerHTML = "<div class='card'><p>Пока пусто — стань первым " + (S.scope === "week" ? "на этой неделе" : "") + ".</p></div>"; return; }
      el.innerHTML = d.rows.map(function (r) {
        var cls = r.pos <= 3 ? " m" + r.pos : "";
        if (S.board === "crew") {
          return "<div class='rk-row" + (r.id === myCrew ? " me" : "") + "' data-rk-cid='" + r.id + "'><span class='n" + cls + "'>" + r.pos + "</span><span class='fc' style='background:" + esc(r.color) + "33'>" + esc(r.emblem) +
            "</span><span class='t'><b>" + tagChip(r.tag, r.color) + esc(r.name) + "</b><i>" + r.n + " чел. · районов " + r.held + "</i></span><span class='v'>" + fmtVal("crew", r.val) + "</span></div>";
        }
        return "<div class='rk-row" + (r.fid === myFid ? " me" : "") + "' data-rk-fid='" + esc(r.fid) + "'><span class='n" + cls + "'>" + r.pos + "</span>" + face(r.cre) +
          "<span class='t'><b>" + tagChip(r.tag, r.ccol) + esc(r.nick) + "</b><i>⭐ " + r.lvl + "</i></span><span class='v'>" + fmtVal(S.board, r.val, d.asc) + "</span></div>";
      }).join("") + "<p class='quiet'>Всего в рейтинге: " + d.total + " · " + cityLabel(city) + "</p>";
      el.querySelectorAll("[data-rk-fid]").forEach(function (x) { x.addEventListener("click", function () { S.view = x.dataset.rkFid; ctl.refresh(); }); });
      el.querySelectorAll("[data-rk-cid]").forEach(function (x) { x.addEventListener("click", function () { if (FC.crews) FC.crews.showCrew(+x.dataset.rkCid); }); });
      var top10 = d.rows.slice(0, 10).some(function (r) { return r.fid === myFid; });
      if (top10 && FC.ach) FC.ach.unlock("top10");
    }).catch(function () { var el = b.querySelector(".rk-list"); if (el) el.innerHTML = "<div class='card'><p>Сервер рейтинга не ответил — попробуй позже.</p></div>"; });
  }

  function render(b, ctl) {
    if (S.view) { renderProfile(b, ctl, S.view); return; }
    if (S.tab === "nick") { renderNick(b, ctl); return; }
    var head = "<div class='rk-chips'>" + [["me", "👤 Я"], ["top", "🏆 Топ"]].map(function (x) {
      return "<button type='button' class='" + (S.tab === x[0] ? "" : "ghost") + "' data-rkt='" + x[0] + "'>" + x[1] + "</button>";
    }).join("") + "<button type='button' class='ghost' data-rk-ach='1'>🏅 Достижения</button></div><div class='rk-body'></div>";
    b.innerHTML = head;
    b.querySelectorAll("[data-rkt]").forEach(function (x) { x.addEventListener("click", function () { S.tab = x.dataset.rkt; ctl.refresh(); }); });
    b.querySelector("[data-rk-ach]").addEventListener("click", function () { FC.hud.openPhone("ach"); });
    var body = b.querySelector(".rk-body");
    if (S.tab === "top") renderTop(body, ctl); else renderMe(body, ctl);
  }
  FC.hud.addApp({ id: "ranks", icon: "🏆", name: "Рейтинг", color: "#b8860b", order: 7, render: render,
    badge: function () { var D = FC.progress && FC.progress.daily && FC.progress.daily(); return D && D.can ? "1" : ""; } });

  function show(fid) { if (!fid) return; S.view = fid; FC.hud.openPhone("ranks"); }

  /* ---- в мире: рядом с другим игроком — «профиль игрока» (без выделений памяти на кадр) ----------------------------- */
  var near = { id: "mp-profile", x: 0, z: 0, r: 2.4, key: "use", mode: "foot", label: "", act: function () { show(near.fid); }, fid: null };
  var nearList = [near];
  FC.interact.provider(function (px, pz, room) {
    var MP = FC.mp; if (!MP || !MP.remotes || room != null) return null;
    var best = null, bd = 2.4 * 2.4;
    for (var id in MP.remotes) {
      var r = MP.remotes[id], ch = r.ch;
      if (!ch || !ch.visible || !r.meta || !r.meta.fid) continue;
      var dx = ch.x - px, dz = ch.z - pz, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = r; }
    }
    if (!best) return null;
    near.x = best.ch.x; near.z = best.ch.z; near.fid = best.meta.fid;
    var lab = "Профиль: " + (best.meta.tag ? "[" + best.meta.tag + "] " : "") + (best.meta.pn || "игрок") + (best.meta.lvl ? " · ⭐ " + best.meta.lvl : "");
    if (near.label !== lab) near.label = lab;
    return nearList;
  });

  FC.on("me", function () { S.cache = {}; S.prof = {}; });
  FC.ranks = { show: show, board: board, profile: profile, BOARDS: BOARDS };
})(window);
