/* Флейм-Сити — кланы игроков (FC.crews): приложение «Клан» — состав и роли, чат, общак, штаб, помощь, цели недели, война.
 *
 * Задача: «как в Rise of Kingdoms — почему там это популярно; всё из ресёрча». Ресёрч: альянс с ролями
 * и общей целью, кнопка «Помоги» (ускорить таймер соклановца), штаб в нежилом ориентире, цели недели с общей наградой,
 * война за районы по расписанию (fwar.js), «семьи» СНГ-RP. Ничего за настоящие деньги.
 * Сервер — server/crews.py (README службы). Обновления без опроса: сервер шлёт кадры «crew» по сокету онлайна
 * (fmp.js → событие шины «mp:crew»): чат, просьба о помощи, «тебе помогли», приглашение, состав. Без сокета — состояние
 * берётся при открытии приложения (кэш 20 с).
 *   FC.crews.id() / state() / load(force) / open(tab) / invite(fid) / canInvite() / showCrew(id) / say(k, v)
 * Тег клана виден над головой соклановцев в онлайне (fmp.js: табличка «[ТЕГ] ник · ⭐ уровень»).
 */
(function (global) {
  "use strict";
  var FC = global.FC;
  var C = { st: null, at: 0, tab: "home", unread: 0, list: null, listAt: 0, q: "", view: null, form: { tag: "", name: "", color: 0, emblem: 0, mode: "req" } };

  FC.css([
    ".cr-head{display:flex;gap:10px;align-items:center}.cr-em{width:48px;height:48px;border-radius:14px;display:grid;place-items:center;font-size:26px;flex:none}",
    ".cr-head b{font:800 16px system-ui}.cr-tabs{display:flex;gap:4px;margin:0 0 8px;flex-wrap:wrap}.cr-tabs button{flex:1 1 auto;padding:5px 4px!important;font-size:11px!important;position:relative}",
    ".cr-tabs em{position:absolute;top:-4px;right:-2px;background:#ff5d6c;color:#fff;border-radius:8px;font:700 9px system-ui;padding:0 4px;font-style:normal}",
    ".cr-m{display:flex;align-items:center;gap:7px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.06)}.cr-m:last-child{border:0}",
    ".cr-m .fc{width:28px;height:28px;border-radius:8px;flex:none;display:grid;place-items:center;background:rgba(255,255,255,.08)}",
    ".cr-m .t{flex:1;min-width:0;cursor:pointer}.cr-m .t b{display:block;font:700 12px system-ui}.cr-m .t i{font:600 10px system-ui;font-style:normal;color:rgba(255,255,255,.55)}",
    ".cr-m button{padding:3px 7px!important;font-size:11px!important}",
    ".cr-chat{max-height:240px;overflow:auto;display:flex;flex-direction:column;gap:4px}",
    ".cr-msg{background:rgba(255,255,255,.07);border-radius:10px;padding:5px 8px;font-size:12px}.cr-msg b{font-size:11px;color:#ffcf7a;cursor:pointer}",
    ".cr-msg.s{background:transparent;color:rgba(255,255,255,.55);font-size:11px;padding:2px 4px}.cr-msg.e{font-size:22px;background:transparent;padding:0 4px}",
    ".cr-pre{display:flex;flex-wrap:wrap;gap:4px}.cr-pre button{padding:4px 7px!important;font-size:11px!important}",
    ".cr-in{display:flex;gap:5px;margin-top:6px}.cr-in input{flex:1;min-width:0;border:0;border-radius:10px;padding:7px 9px;background:rgba(255,255,255,.12);color:#fff;font:13px system-ui}",
    ".cr-bar{height:6px;border-radius:4px;background:rgba(255,255,255,.12);overflow:hidden;margin:5px 0 3px}.cr-bar i{display:block;height:100%;background:#2fbf71}",
    ".cr-sw{display:flex;flex-wrap:wrap;gap:5px;margin:4px 0}.cr-sw button{width:28px;height:28px;border-radius:8px;padding:0!important;border:2px solid transparent!important}",
    ".cr-sw button.on{border-color:#fff!important}.cr-f input{width:100%;border:0;border-radius:10px;padding:7px 9px;background:rgba(255,255,255,.12);color:#fff;font:13px system-ui;margin:3px 0}"
  ].join("\n"));

  function esc(s) { return FC.hud.esc(s); }
  function token() { return FC.net && FC.net.token; }
  function post(p, b) { b.token = token(); return FC.prop.post(p, b); }
  function money(n) { return FC.fmtMoney(n); }
  function toast(t, c, s) { FC.hud.toast(t, c || "", s || 2.6); }
  function fail(e) { toast(e && e.message ? e.message : "Не получилось", "bad", 3); }
  function face(cre) {
    var cell = cre && FC.people ? FC.people.cellOf(cre) : -1;
    return cell >= 0 ? "<span class='fc' style='" + FC.hud.atlasStyle(cell) + "'></span>" : "<span class='fc'>🥚</span>";
  }
  function ago(ts) { var s = Date.now() / 1000 - ts; return s < 60 ? "сейчас" : s < 3600 ? Math.round(s / 60) + " мин" : s < 86400 ? Math.round(s / 3600) + " ч" : Math.round(s / 86400) + " дн"; }
  var ROLE = { leader: "👑 лидер", deputy: "⭐ заместитель", member: "участник" };

  function load(force) {
    if (!token()) { C.st = null; return Promise.resolve(null); }
    if (!force && C.st && Date.now() - C.at < 20000) return Promise.resolve(C.st);
    return post("/g/crew/me", {}).then(function (d) {
      var was = C.st && C.st.crew && C.st.crew.id, now = d.crew && d.crew.id;
      C.st = d; C.at = Date.now();
      if (was !== now) FC.emit("crew:changed", { id: now });
      if (now && FC.ach) FC.ach.unlock("crew_join");
      return d;
    }).catch(function () { return C.st; });
  }
  function id() { return C.st && C.st.crew ? C.st.crew.id : null; }
  function canInvite() { return !!(C.st && C.st.crew && (C.st.role === "leader" || C.st.role === "deputy")); }
  function act(path, body, okText) {
    return post(path, body || {}).then(function (d) { if (okText) toast(okText, "ok"); C.at = 0; return load(true).then(function () { return d; }); }).catch(function (e) { fail(e); return null; });
  }
  function invite(fid) { return act("/g/crew/invite", { fid: fid }, "Приглашение отправлено").then(function (d) { return !!d; }); }

  /* ---- без клана: приглашения, поиск, создание ---------------------------------------------------------------- */
  function browse(q) {
    if (!q && C.list && Date.now() - C.listAt < 30000) return Promise.resolve(C.list);
    return FC.gfetch("/g/crews?q=" + encodeURIComponent(q || "")).then(function (r) { return r.json(); }).then(function (d) {
      if (!q) { C.list = d.crews; C.listAt = Date.now(); } return d.crews;
    });
  }
  function crewRow(c, btn) {
    return "<div class='cr-m'><span class='fc' style='background:" + esc(c.color) + "33'>" + esc(c.emblem) + "</span><span class='t' data-cr-view='" + c.id + "'><b>[" + esc(c.tag) + "] " + esc(c.name) + "</b><i>" +
      c.n + "/30 · районов " + c.held + (c.power != null ? " · сила " + c.power : "") + " · " + (c.mode === "open" ? "открыт" : c.mode === "req" ? "по заявке" : "по приглашению") + "</i></span>" + (btn || "") + "</div>";
  }
  function renderNone(b, ctl, st) {
    var html = "<div class='card'><b>🛡️ Клан — своя семья в городе</b><p>Вместе держите районы в войне за район, помогаете бизнесам друг друга, копите общак на штаб и закрываете цели недели — награда каждому. До 30 человек.</p></div>";
    if (st.wait) html += "<div class='card'><p>После ухода из клана — пауза: ещё " + Math.ceil(st.wait / 3600) + " ч.</p></div>";
    if (st.invites && st.invites.length) html += "<h4>Тебя зовут</h4><div class='card'>" + st.invites.map(function (c) {
      return crewRow(c, "<button type='button' data-cr-yes='" + c.id + "'>Да</button><button type='button' class='ghost' data-cr-no='" + c.id + "'>✕</button>");
    }).join("") + "</div>";
    html += "<div class='row'><input class='cr-q' placeholder='Тег или название' value='" + esc(C.q) + "' style='flex:1;border:0;border-radius:10px;padding:6px 8px;background:rgba(255,255,255,.12);color:#fff'><button type='button' data-cr-find='1'>Найти</button></div>";
    html += "<div class='card cr-list'><p>Загружаю кланы…</p></div>";
    var F = C.form, lv = st.lvl;
    html += "<h4>Создать свой</h4><div class='card cr-f'>" + (lv < st.create_lvl ? "<p>Создать клан можно с " + st.create_lvl + "-го уровня (у тебя " + lv + "). Пока — вступи в чужой.</p>" :
      "<input data-crf='tag' maxlength='4' placeholder='Тег: 2–4 буквы или цифры' value='" + esc(F.tag) + "'><input data-crf='name' maxlength='24' placeholder='Название: 3–24 знака' value='" + esc(F.name) + "'>" +
      "<div class='cr-sw'>" + st.colors.map(function (c, i) { return "<button type='button' data-crc='" + i + "' class='" + (F.color === i ? "on" : "") + "' style='background:" + c + "'></button>"; }).join("") + "</div>" +
      "<div class='cr-sw'>" + st.emblems.map(function (e, i) { return "<button type='button' data-cre='" + i + "' class='" + (F.emblem === i ? "on" : "") + "' style='background:rgba(255,255,255,.1)'>" + e + "</button>"; }).join("") + "</div>" +
      "<div class='row'><select data-crf='mode'><option value='open'" + (F.mode === "open" ? " selected" : "") + ">вступают сразу</option><option value='req'" + (F.mode === "req" ? " selected" : "") +
      ">по заявке</option><option value='closed'" + (F.mode === "closed" ? " selected" : "") + ">только приглашения</option></select>" +
      "<button type='button' data-cr-make='1'" + (FC.save.money < st.create_cost ? " disabled" : "") + ">Создать за " + money(st.create_cost) + "</button></div>" +
      "<p>Без мата, политики и ссылок — сервер проверит.</p>") + "</div>";
    b.innerHTML = "<div class='list'>" + html + "</div>";
    function fill(list) {
      var el = b.querySelector(".cr-list"); if (!el) return;
      el.innerHTML = list && list.length ? list.slice(0, 20).map(function (c) {
        var asked = st.asked && st.asked.indexOf(c.id) >= 0;
        return crewRow(c, c.mode === "closed" ? "" : "<button type='button' data-cr-join='" + c.id + "'" + (asked || st.wait ? " disabled" : "") + ">" + (asked ? "заявка" : c.mode === "open" ? "Вступить" : "Заявка") + "</button>");
      }).join("") : "<p>Кланов пока нет — создай первый.</p>";
      el.querySelectorAll("[data-cr-join]").forEach(function (x) {
        x.addEventListener("click", function () {
          act("/g/crew/join", { id: +x.dataset.crJoin }).then(function (d) { if (d) toast(d.joined ? "Ты в клане!" : "Заявка отправлена — ждём лидера", "ok", 3); ctl.refresh(); });
        });
      });
      el.querySelectorAll("[data-cr-view]").forEach(function (x) { x.addEventListener("click", function () { showCrew(+x.dataset.crView); }); });
    }
    browse(C.q).then(fill).catch(function () { fill([]); });
    b.querySelectorAll("[data-cr-yes]").forEach(function (x) { x.addEventListener("click", function () { act("/g/crew/answer", { id: +x.dataset.crYes, yes: true }, "Ты в клане!").then(ctl.refresh); }); });
    b.querySelectorAll("[data-cr-no]").forEach(function (x) { x.addEventListener("click", function () { act("/g/crew/answer", { id: +x.dataset.crNo, yes: false }).then(ctl.refresh); }); });
    var fb = b.querySelector("[data-cr-find]");
    fb.addEventListener("click", function () { C.q = b.querySelector(".cr-q").value.trim().slice(0, 24); browse(C.q).then(fill); });
    b.querySelectorAll("[data-crf]").forEach(function (x) { x.addEventListener("input", function () { C.form[x.dataset.crf] = x.value; }); x.addEventListener("change", function () { C.form[x.dataset.crf] = x.value; }); });
    b.querySelectorAll("[data-crc]").forEach(function (x) { x.addEventListener("click", function () { C.form.color = +x.dataset.crc; ctl.refresh(); }); });
    b.querySelectorAll("[data-cre]").forEach(function (x) { x.addEventListener("click", function () { C.form.emblem = +x.dataset.cre; ctl.refresh(); }); });
    var mk = b.querySelector("[data-cr-make]");
    if (mk) mk.addEventListener("click", function () {
      if (FC.save.money < st.create_cost) { toast("Не хватает наличных", "bad"); return; }
      mk.disabled = true;
      post("/g/crew/create", { tag: F.tag, name: F.name, color: F.color, emblem: F.emblem, mode: F.mode }).then(function (d) {
        FC.money(-d.cost, "клан: основание");
        if (FC.ach) FC.ach.unlock("crew_found");
        FC.hud.big("КЛАН ОСНОВАН", "[" + F.tag.toUpperCase() + "] " + F.name, "#ffcf7a", 3);
        C.form = { tag: "", name: "", color: 0, emblem: 0, mode: "req" };
        return load(true);
      }).then(function () { ctl.refresh(); }).catch(function (e) { mk.disabled = false; fail(e); });
    });
  }

  /* ---- свой клан ------------------------------------------------------------------------------------------------ */
  function memberRow(m, st) {
    var me = st.role, boss = me === "leader" || (me === "deputy" && m.role === "member");
    var btn = "";
    if (!m.me && boss) btn += "<button type='button' class='ghost' data-cr-kick='" + esc(m.fid) + "'>✕</button>";
    if (!m.me && me === "leader") btn = "<select data-cr-role='" + esc(m.fid) + "' style='padding:3px 4px'><option value=''>роль</option><option value='deputy'>заместитель</option><option value='member'>участник</option><option value='leader'>передать лидера</option></select>" + btn;
    return "<div class='cr-m'>" + face(m.cre) + "<span class='t' data-cr-fid='" + esc(m.fid) + "'><b>" + (m.online ? "🟢 " : "") + esc(m.nick) + (m.me ? " (ты)" : "") + "</b><i>" +
      ROLE[m.role] + " · ⭐ " + m.lvl + " · в общак " + money(m.given) + " · помог " + m.helps + (m.online || !m.seen ? "" : " · был " + ago(m.seen)) + "</i></span>" + btn + "</div>";
  }
  function tabs(st) {
    var T = [["home", "🛡️ Клан"], ["chat", "💬 Чат"], ["help", "🤝 Помощь"], ["goals", "🎯 Цели"], ["war", "⚔️ Война"], ["team", "👥 Состав"]];
    var badge = { chat: C.unread, help: st.helps.filter(function (h) { return !h.mine && !h.helped; }).length, goals: st.goals.filter(function (g) { return g.done && g.can && !g.claimed; }).length,
      team: st.asks.length };
    return "<div class='cr-tabs'>" + T.map(function (t) {
      return "<button type='button' class='" + (C.tab === t[0] ? "" : "ghost") + "' data-cr-tab='" + t[0] + "'>" + t[1] + (badge[t[0]] ? "<em>" + badge[t[0]] + "</em>" : "") + "</button>";
    }).join("") + "</div>";
  }
  function renderHome(st) {
    var c = st.crew, hq = c.hq;
    var html = "<div class='card'><div class='cr-head'><span class='cr-em' style='background:" + esc(c.color) + "44'>" + esc(c.emblem) + "</span><div><b>[" + esc(c.tag) + "] " + esc(c.name) + "</b>" +
      "<p>" + c.n + "/" + st.max + " · сила " + c.power + " · районов " + st.held.length + " · ты — " + ROLE[st.role] + "</p></div></div></div>";
    html += "<div class='row'><span>🏦 Общак: <b>" + money(c.bank) + "</b></span><span class='quiet'>сегодня ты внёс " + money(st.give_today) + " из " + money(st.give_day) + "</span>" +
      "<div class='cr-pre'>" + [1000, 5000, 25000].map(function (v) { return "<button type='button' data-cr-give='" + v + "'" + (FC.save.money < v ? " disabled" : "") + ">+" + money(v) + "</button>"; }).join("") + "</div></div>";
    html += "<div class='card'><b>🏢 Штаб" + (hq ? " · уровень " + hq.lvl : "") + "</b>" + (hq ?
      "<p>" + esc(hq.addr || "здание " + hq.key) + (hq.city !== FC.city ? " · " + (hq.city === "minsk" ? "Минск" : "Флейм-Сити") : "") + "</p><p>От штаба клан расширяется в войне за район; влияние в его районе +" + (10 * hq.lvl) + "%.</p>" :
      "<p>Штаб — нежилой ориентир соклановца (высотка, известное здание; не госучреждения, храмы и мемориалы). От него клан расширяется в войне за район.</p>") +
      "<div class='hm-row'>" + (hq && hq.city === FC.city ? "<button type='button' data-cr-go='1'>📍 В штаб</button>" : "") +
      (st.role !== "member" ? "<button type='button' class='ghost' data-cr-hqpick='1'>" + (hq ? "сменить" : "поставить") + "</button>" : "") +
      (hq && st.role === "leader" && st.hq_cost[hq.lvl + 1] ? "<button type='button' class='ghost' data-cr-hqup='1'>улучшить за " + money(st.hq_cost[hq.lvl + 1]) + " из общака</button>" : "") + "</div></div>";
    if (st.held.length) html += "<div class='row'><span>🏴 Клан держит районов: " + st.held.length + " — награда недели " + money(st.hold_pay) + "</span>" +
      "<button type='button' data-cr-claim='hold'" + (st.hold_claimed ? " disabled" : "") + ">" + (st.hold_claimed ? "забрано" : "Забрать") + "</button></div>";
    if (st.role === "leader") html += "<div class='row'><span>Вступление</span><select data-cr-mode='1'><option value='open'" + (c.mode === "open" ? " selected" : "") + ">сразу</option><option value='req'" +
      (c.mode === "req" ? " selected" : "") + ">по заявке</option><option value='closed'" + (c.mode === "closed" ? " selected" : "") + ">приглашения</option></select></div>";
    html += "<div class='row'><button type='button' class='ghost' data-cr-leave='1'>Выйти из клана</button>" + (st.role === "leader" ? "<button type='button' class='danger' data-cr-disband='1'>Распустить</button>" : "") + "</div>";
    return html;
  }
  function renderChat(st) {
    C.unread = 0;
    var me = FC.progress && FC.progress.me(), myFid = me && me.fid;
    return "<div class='card'><div class='cr-chat'>" + (st.chat.length ? st.chat.map(function (m) {
      if (m.k === "s") return "<div class='cr-msg s'>" + esc(m.v) + "</div>";
      return "<div class='cr-msg" + (m.k === "e" ? " e" : "") + "'>" + (m.k === "e" ? "" : "<b data-cr-fid='" + esc(m.fid) + "'>" + esc(m.nick) + (m.fid === myFid ? " (ты)" : "") + "</b> ") +
        (m.k === "e" ? "<small style='font-size:10px;color:#ffcf7a'>" + esc(m.nick) + "</small> " : "") + esc(m.v) + "</div>";
    }).join("") : "<p class='quiet'>Тишина. Напиши первым.</p>") + "</div></div>" +
      "<div class='cr-pre'>" + st.presets.map(function (p, i) { return "<button type='button' class='ghost' data-cr-p='" + i + "'>" + esc(p) + "</button>"; }).join("") + "</div>" +
      "<div class='cr-pre' style='margin-top:4px'>" + st.emotes.map(function (e, i) { return "<button type='button' class='ghost' data-cr-e='" + i + "'>" + e + "</button>"; }).join("") + "</div>" +
      "<div class='cr-in'><input class='cr-t' maxlength='" + st.text_max + "' placeholder='Коротко, без мата и ссылок'><button type='button' data-cr-send='1'>➤</button></div>";
  }
  function renderHelp(st) {
    var html = "<div class='card'><b>🤝 Помощь</b><p>Попроси клан помочь бизнесу — каждый соклановец один раз жмёт «Помочь»: +3 минуты выработки в кассу и +3% сырья. " +
      "Помогать — до " + st.help_day + " раз в сутки (сегодня " + st.help_today + "), за помощь — опыт.</p></div>";
    var others = st.helps.filter(function (h) { return !h.mine; });
    html += others.length ? others.map(function (h) {
      return "<div class='row'><span>" + esc(h.nick) + " · " + esc(h.name) + "<br><span class='quiet'>" + h.got + "/" + h.need + " · " + ago(h.at) + " назад</span></span>" +
        "<button type='button' data-cr-help='" + h.id + "'" + (h.helped || st.help_today >= st.help_day ? " disabled" : "") + ">" + (h.helped ? "помог ✓" : "Помочь") + "</button></div>";
    }).join("") : "<div class='card'><p>Просьб пока нет.</p></div>";
    var mine = (FC.biz && FC.biz.list ? FC.biz.list() : []) || [];
    var open = {}; st.helps.forEach(function (h) { if (h.mine) open[h.city + ":" + h.key] = h; });
    if (mine.length) html += "<h4>Мои бизнесы</h4>" + mine.map(function (v) {
      var k = (v.city || FC.city) + ":" + v.key, h = open[k];
      return "<div class='row'><span>" + esc(v.name || "Бизнес") + (h ? "<br><span class='quiet'>помогли " + h.got + "/" + h.need + "</span>" : "") + "</span>" +
        (h ? "<span class='quiet'>ждём</span>" : "<button type='button' class='ghost' data-cr-ask='" + esc(k) + "'>Попросить</button>") + "</div>";
    }).join("");
    else html += "<p class='quiet'>У тебя нет бизнеса — открой его в нежилом здании («Недвижимость» → «Бизнес»), и клан поможет ему расти.</p>";
    return html;
  }
  function renderGoals(st) {
    var html = "<div class='card'><b>🎯 Цели недели</b><p>Три общие цели — каждая выполненная даёт " + money(st.goal_pay) + " и опыт каждому, кто был в клане к выполнению; все три — ещё " + money(st.all_pay) + ".</p></div>";
    st.goals.forEach(function (g) {
      var pct = Math.min(100, Math.round(g.prog / Math.max(1, g.need) * 100)), isMoney = g.id === "biz" || g.id === "bank";
      html += "<div class='card'><b>" + g.icon + " " + esc(g.name) + "</b><div class='cr-bar'><i style='width:" + pct + "%'></i></div><p>" +
        (isMoney ? money(g.prog) + " из " + money(g.need) : g.prog + " из " + g.need) + (g.done ? " · ✓ выполнено" : "") + "</p>" +
        (g.done && g.can ? "<div class='hm-row'><button type='button' data-cr-claim='goal:" + g.id + "'" + (g.claimed ? " disabled" : "") + ">" + (g.claimed ? "забрано" : "Забрать " + money(st.goal_pay)) + "</button></div>" : "") + "</div>";
    });
    var all = st.goals.length === 3 && st.goals.every(function (g) { return g.done; });
    html += "<div class='row'><span>Все три цели</span><button type='button' data-cr-claim='all'" + (!all || st.all_claimed ? " disabled" : "") + ">" + (st.all_claimed ? "забрано" : "Бонус " + money(st.all_pay)) + "</button></div>";
    return html;
  }
  function renderTeam(st) {
    var html = "";
    if (st.asks.length) html += "<h4>Заявки</h4><div class='card'>" + st.asks.map(function (a) {
      return "<div class='cr-m'>" + face(a.cre) + "<span class='t' data-cr-fid='" + esc(a.fid) + "'><b>" + esc(a.nick) + "</b><i>⭐ " + a.lvl + "</i></span><button type='button' data-cr-ok='" + esc(a.fid) +
        "'>Принять</button><button type='button' class='ghost' data-cr-deny='" + esc(a.fid) + "'>✕</button></div>";
    }).join("") + "</div>";
    html += "<h4>Состав " + st.members.length + "/" + st.max + "</h4><div class='card'>" + st.members.map(function (m) { return memberRow(m, st); }).join("") + "</div>";
    if (st.role !== "member") html += "<p class='quiet'>Позвать игрока — из «Рейтинга» или «Онлайна»: открой его карточку → «Позвать в клан».</p>";
    return html;
  }

  function render(b, ctl) {
    if (C.view) { renderCrew(b, ctl, C.view); return; }
    if (!token()) { b.innerHTML = "<div class='card'><b>Клан держится за агентом</b><p>" + FC.hud.esc(FC.net.loginHint()) + " Тогда можно вступать в клан или создавать свой.</p></div>"; return; }
    var st = C.st;
    if (!st) { b.innerHTML = "<div class='card'><p>Загружаю…</p></div>"; load(true).then(function () { if (b.isConnected) ctl.refresh(); }); return; }
    if (Date.now() - C.at > 20000) load(true).then(function () { if (b.isConnected && !document.activeElement.closest(".cr-in,.cr-f")) ctl.refresh(); });
    if (!st.crew) { renderNone(b, ctl, st); return; }
    var body = C.tab === "chat" ? renderChat(st) : C.tab === "help" ? renderHelp(st) : C.tab === "goals" ? renderGoals(st) :
      C.tab === "team" ? renderTeam(st) : C.tab === "war" ? (FC.war ? FC.war.block(true) : "") : renderHome(st);
    b.innerHTML = tabs(st) + "<div class='list'>" + body + "</div>";
    if (C.tab === "war" && FC.war) { FC.war.loadMe().then(function () { if (b.isConnected && C.tab === "war" && !b._w) { b._w = 1; render(b, ctl); } }); }
    var ch = b.querySelector(".cr-chat"); if (ch) ch.scrollTop = ch.scrollHeight;
    function on(sel, fn) { b.querySelectorAll(sel).forEach(function (x) { x.addEventListener("click", function (e) { fn(x, e); }); }); }
    on("[data-cr-tab]", function (x) { C.tab = x.dataset.crTab; ctl.refresh(); });
    on("[data-cr-fid]", function (x) { if (x.dataset.crFid && FC.ranks) FC.ranks.show(x.dataset.crFid); });
    on("[data-cr-give]", function (x) {
      var v = +x.dataset.crGive;
      if (FC.save.money < v) { toast("Не хватает наличных", "bad"); return; }
      post("/g/crew/give", { amount: v }).then(function () { FC.money(-v, "клан: общак"); toast("+" + money(v) + " в общак", "ok"); return load(true); }).then(ctl.refresh).catch(fail);
    });
    on("[data-cr-go]", function () { var h = st.crew.hq; if (h && FC.hud.teleport(h.x, h.z)) ctl.close(); else toast("Сейчас перемещаться нельзя", "bad"); });
    on("[data-cr-hqpick]", function () { pickHq(b, ctl, st); });
    on("[data-cr-hqup]", function () { act("/g/crew/hqup", {}, "Штаб улучшен").then(ctl.refresh); });
    on("[data-cr-claim]", function (x) {
      post("/g/crew/claim", { what: x.dataset.crClaim }).then(function (d) {
        FC.money(d.paid, "клан: награда"); toast("+" + money(d.paid) + " · награда клана", "ok", 3);
        if (FC.progress && d.xp) FC.progress.shown(d.xp);
        return load(true);
      }).then(ctl.refresh).catch(fail);
    });
    on("[data-cr-leave]", function () { if (confirm("Выйти из клана? Вступить в другой можно будет через 12 часов.")) act("/g/crew/leave", {}, "Ты вышел из клана").then(ctl.refresh); });
    on("[data-cr-disband]", function () { if (confirm("Распустить клан? Районы станут ничьими, общак сгорит.")) act("/g/crew/disband", {}, "Клан распущен").then(ctl.refresh); });
    on("[data-cr-p]", function (x) { say("p", +x.dataset.crP).then(ctl.refresh); });
    on("[data-cr-e]", function (x) { say("e", +x.dataset.crE).then(ctl.refresh); });
    var inp = b.querySelector(".cr-t");
    function sendText() { var v = inp.value.trim(); if (!v) return; say("t", v).then(function (ok) { if (ok) ctl.refresh(); }); }
    on("[data-cr-send]", sendText);
    if (inp) inp.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") sendText(); });
    on("[data-cr-help]", function (x) {
      x.disabled = true;
      post("/g/crew/help/give", { id: +x.dataset.crHelp }).then(function (d) {
        toast("🤝 Помог: " + d.got + "/" + d.need, "ok"); if (FC.progress && d.xp) FC.progress.shown(d.xp);
        if (FC.ach) FC.ach.add("crew_help_30");
        return load(true);
      }).then(ctl.refresh).catch(function (e) { x.disabled = false; fail(e); });
    });
    on("[data-cr-ask]", function (x) { var p = x.dataset.crAsk.split(":"); act("/g/crew/help/ask", { city: p[0], key: p.slice(1).join(":") }, "Клан увидит просьбу").then(ctl.refresh); });
    on("[data-cr-ok]", function (x) { act("/g/crew/decide", { fid: x.dataset.crOk, yes: true }, "Принят").then(ctl.refresh); });
    on("[data-cr-deny]", function (x) { act("/g/crew/decide", { fid: x.dataset.crDeny, yes: false }).then(ctl.refresh); });
    on("[data-cr-kick]", function (x) { if (confirm("Исключить из клана?")) act("/g/crew/kick", { fid: x.dataset.crKick }, "Исключён").then(ctl.refresh); });
    b.querySelectorAll("[data-cr-role]").forEach(function (x) {
      x.addEventListener("change", function () {
        if (!x.value) return;
        if (x.value === "leader" && !confirm("Передать лидерство? Ты станешь заместителем.")) { x.value = ""; return; }
        act("/g/crew/role", { fid: x.dataset.crRole, role: x.value }, "Готово").then(ctl.refresh);
      });
    });
    var md = b.querySelector("[data-cr-mode]");
    if (md) md.addEventListener("change", function () { act("/g/crew/edit", { mode: md.value }, "Сохранено"); });
  }
  function pickHq(b, ctl, st) {
    var mine = (FC.prop && FC.prop.mine ? FC.prop.mine("com") : []).filter(function (p) { return p.landmark; });
    b.innerHTML = "<div class='list'><div class='card'><b>🏢 Штаб клана</b><p>Только нежилой ориентир (высотка, известное здание) — твой или соклановца. Госучреждения, храмы, мемориалы, школы и больницы — нельзя.</p></div>" +
      (mine.length ? mine.map(function (p) {
        return "<div class='row'><span>" + esc(p.addr || "здание " + p.key) + "<br><span class='quiet'>" + (p.city === "minsk" ? "Минск" : "Флейм-Сити") + "</span></span><button type='button' data-hq='" + esc(p.city + ":" + p.key) + "'>Сюда</button></div>";
      }).join("") : "<div class='card'><p>У тебя нет нежилого ориентира. Купить — «Недвижимость» → «Купить» → «под бизнес» (с 8-го уровня).</p></div>") +
      (st.crew.hq ? "<div class='row'><span>Убрать штаб</span><button type='button' class='ghost' data-hq-clear='1'>убрать</button></div>" : "") +
      "<div class='row'><button type='button' class='ghost' data-hq-back='1'>‹ Назад</button></div></div>";
    b.querySelectorAll("[data-hq]").forEach(function (x) {
      x.addEventListener("click", function () { var p = x.dataset.hq.split(":"); act("/g/crew/hq", { city: p[0], key: p.slice(1).join(":") }, "Штаб поставлен").then(ctl.refresh); });
    });
    var cl = b.querySelector("[data-hq-clear]");
    if (cl) cl.addEventListener("click", function () { act("/g/crew/hq", { clear: true }, "Штаб убран").then(ctl.refresh); });
    b.querySelector("[data-hq-back]").addEventListener("click", ctl.refresh);
  }
  function say(k, v) {
    return post("/g/crew/say", { k: k, v: v }).then(function (d) {
      if (C.st && C.st.chat && !C.st.chat.some(function (m) { return m.id === d.msg.id; })) C.st.chat.push(d.msg);
      return true;
    }).catch(function (e) { fail(e); return false; });
  }

  /* ---- чужой клан (из рейтинга и поиска) ------------------------------------------------------------------------ */
  function renderCrew(b, ctl, cid) {
    b.innerHTML = "<div class='list'><div class='row'><button type='button' class='ghost' data-crv-back='1'>‹ Назад</button></div><div class='crv card'><p>Загружаю…</p></div></div>";
    b.querySelector("[data-crv-back]").addEventListener("click", function () { C.view = null; ctl.refresh(); });
    FC.gfetch("/g/crew?id=" + cid).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (c) {
      var el = b.querySelector(".crv"); if (!el) return;
      var mine = C.st && C.st.crew;
      el.outerHTML = "<div class='card'><div class='cr-head'><span class='cr-em' style='background:" + esc(c.color) + "44'>" + esc(c.emblem) + "</span><div><b>[" + esc(c.tag) + "] " + esc(c.name) + "</b><p>" +
        c.n + "/30 · сила " + c.power + " · районов " + c.held + (c.hq_dist ? " · штаб есть" : "") + "</p></div></div></div>" +
        (!mine && c.mode !== "closed" && token() ? "<div class='row'><span>" + (c.mode === "open" ? "Вступают сразу" : "По заявке") + "</span><button type='button' data-crv-join='1'>" + (c.mode === "open" ? "Вступить" : "Заявка") + "</button></div>" : "") +
        "<div class='card'>" + c.members.map(function (m) {
          return "<div class='cr-m'>" + face(m.cre) + "<span class='t' data-crv-fid='" + esc(m.fid) + "'><b>" + (m.online ? "🟢 " : "") + esc(m.nick) + "</b><i>" + ROLE[m.role] + " · ⭐ " + m.lvl + "</i></span></div>";
        }).join("") + "</div>";
      var j = b.querySelector("[data-crv-join]");
      if (j) j.addEventListener("click", function () { act("/g/crew/join", { id: cid }).then(function (d) { if (d) { toast(d.joined ? "Ты в клане!" : "Заявка отправлена", "ok"); C.view = null; ctl.refresh(); } }); });
      b.querySelectorAll("[data-crv-fid]").forEach(function (x) { x.addEventListener("click", function () { FC.ranks.show(x.dataset.crvFid); }); });
    }).catch(function () { var el = b.querySelector(".crv"); if (el) el.innerHTML = "<p>Клан не найден.</p>"; });
  }
  function showCrew(cid) { C.view = cid; FC.hud.openPhone("crew"); }
  function open(tab) { if (tab) C.tab = tab; C.view = null; FC.hud.openPhone("crew"); }

  FC.hud.addApp({ id: "crew", icon: "🛡️", name: "Клан", color: "#1d4e89", order: 8, render: render,
    badge: function () {
      var st = C.st; if (!st) return "";
      if (!st.crew) return st.invites && st.invites.length ? st.invites.length : "";
      var n = C.unread + st.helps.filter(function (h) { return !h.mine && !h.helped; }).length + st.asks.length;
      return n || "";
    } });

  /* ---- кадры сервера по сокету онлайна ---------------------------------------------------------------------------- */
  FC.on("mp:crew", function (m) {
    if (m.e === "chat" && m.m) {
      if (C.st && C.st.chat && !C.st.chat.some(function (x) { return x.id === m.m.id; })) {
        C.st.chat.push(m.m); if (C.st.chat.length > 80) C.st.chat.shift();
        var me = FC.progress && FC.progress.me();
        if (!(me && me.fid === m.m.fid)) { C.unread++; if (m.m.k !== "s" && FC.hud.notify && C.tab !== "chat") FC.hud.notify("Клан · " + (m.m.nick || ""), m.m.v, "🛡️", 4); }
      }
      return;
    }
    if (m.e === "helped") { toast("🤝 " + (m.nick || "Соклановец") + " помог твоему бизнесу: " + m.got + "/" + m.need, "ok", 3); return; }
    if (m.e === "help") { C.at = 0; load(true).then(function (st) { if (st && st.helps && st.helps.length && FC.hud.notify) FC.hud.notify("Клан", "Соклановец просит помочь бизнесу — «Клан» → «Помощь»", "🤝", 5); }); return; }
    if (m.e === "invite") { C.at = 0; load(true).then(function () { if (FC.hud.notify) FC.hud.notify("Клан", "Тебя зовут в клан — открой «Клан» в телефоне", "🛡️", 6); }); return; }
    if (m.e === "gone") { toast("Клан распущен", "bad", 3); }
    C.at = 0; load(true);
  });
  FC.on("me", function () { C.st = null; C.at = 0; if (token()) setTimeout(function () { load(true); }, 3000); });

  FC.crews = { id: id, state: function () { return C.st; }, load: load, open: open, invite: invite, canInvite: canInvite, showCrew: showCrew, say: say };
})(window);
