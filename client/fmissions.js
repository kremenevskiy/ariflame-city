/* Флейм-Сити — миссии с медалями (FC.mis): движок, приложение «Миссии», метки старта, медали и рекорды, мост достижений.
 *
 * Задача: «придумай классные миссии — чтобы можно было на вертолёте покататься; фичи прикольные скрытые;
 * всё, что нашёл в ресёрче — добавь». Ресёрч механик GTA и удержания: единица контента в Telegram —
 * «вылазка» на 2–5 минут; повод переиграть — медали бронза/серебро/золото по времени или очкам, как испытания GTA.
 *
 * Миссия — данные (fmissions2.js): {id, title, icon, kind, desc, at(): точка старта, plan(): маршрут (детерминированный — у всех
 * одинаковый, рекорды честные), medals(plan): {by: "time"|"score"|"place"|"dist", g, s, b}, pay: база награды, intro: реплики,
 * setup(c), tick(c, dt), done(c, medal)}. Правило GTA III: всё, что миссия создаёт (машины, вертолёты, люди, метки,
 * взаимодействия, слушатели шины, таймеры, меши, DOM, трамплины), регистрируется в контексте c, и ОДНА уборка cleanup()
 * снимает всё на финише, провале и отмене. Транспорт, в котором сидит игрок, остаётся миру (как в GTA) — его уберёт
 * обычная уборка fcars/fair, когда игрок уйдёт. Проверка утечек — FC.mis.debug.leaks().
 *
 * Читы (fsecrets.js, FC.mis.cheat) выключают медали и достижения, пока действуют. Достижения — через FC.ach.unlock(id), если
 * модуль рангов уже на месте; без него — очередь FC.save.flags.achQ и событие «ach:unlock» (реестр — ach-missions.json).
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE, M = FC.map, G = FC.gfx;
  if (!FC.hud || !M || !T) return;
  var H = FC.hud, esc = H.esc, CITY = FC.city || "flame", I = FC.input;
  var MEDAL = { g: "🥇", s: "🥈", b: "🥉" }, MNAME = { g: "золото", s: "серебро", b: "бронза" }, RANK = { g: 3, s: 2, b: 1 };

  /* ---- сохранение: рекорды и медали — у каждого города свои (маршруты разные) ------------------------------ */
  function rec() {
    var s = FC.save;
    if (!s.mis) s.mis = {};
    return s.mis[CITY] || (s.mis[CITY] = { best: {}, runs: 0 });
  }
  function flags() { return FC.save.flags || (FC.save.flags = {}); }

  /* ---- читы: пока действуют — без медалей и достижений ------------------------------------------------------- */
  var cheat = { until: 0, on: {} };
  function cheating() {
    if (performance.now() < cheat.until) return true;
    for (var k in cheat.on) if (cheat.on[k]) return true;
    return false;
  }

  /* ---- достижения: мост к FC.ach (модуль рангов) ------------------------------------------------------------ */
  var ACH = {};
  FC.achDefs = FC.achDefs || [];
  function achLoad() {
    fetch("ach-missions.json").then(function (r) { return r.ok ? r.json() : []; }).then(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (a) { ACH[a.id] = a; });
      FC.achDefs = FC.achDefs.concat(list);
      // в реестр FC.ach (fach.js): у него поля name/icon/rarity common|rare|epic|legend; город — в group
      if (FC.ach && typeof FC.ach.define === "function") {
        var RM = { common: "common", rare: "rare", epic: "epic", legend: "legend", legendary: "legend", uncommon: "rare" };
        try {
          FC.ach.define(list.map(function (a) {
            return { id: a.id, name: a.title || a.name || a.id, desc: a.desc || "", icon: a.icon || (/^sec_|egg|ogon/.test(a.id) ? "🔍" : "🏅"),
              rarity: RM[a.rarity] || "common", hidden: !!a.hidden, need: a.need || 0, group: a.city === "minsk" ? "Минск" : a.city === "flame" ? "Флейм-Сити" : "Миссии" };
          }));
        } catch (e) { /* модуль рангов сам разберётся */ }
      }
      FC.emit("ach:defs", { list: list, src: "missions" });
    }).catch(function () { /* без реестра — достижения всё равно копятся в очереди */ });
  }
  function achUnlock(id) {
    if (cheating()) return false;
    var f = flags(), q = f.achQ || (f.achQ = []);
    if (q.indexOf(id) >= 0) return false;
    q.push(id); FC.dirty();
    if (FC.ach && typeof FC.ach.unlock === "function") { try { FC.ach.unlock(id); } catch (e) { /* модуль рангов */ } }
    else {
      var a = ACH[id];
      H.toast("🏆 Достижение: " + (a ? a.title : id), "ok", 3.5);
      if (FC.audio) FC.audio.play("mission");
    }
    FC.emit("ach:unlock", { id: id, city: CITY });
    return true;
  }

  /* ---- стили: панель миссии, субтитры, карточки ------------------------------------------------------------- */
  FC.css([
    "#mi-hud{position:fixed;right:14px;top:calc(118px + var(--safe-t,0px));z-index:6;pointer-events:none;text-align:right;display:none;",
    "  font:800 22px/1.15 system-ui;color:#fff;text-shadow:0 2px 8px #000}",
    "#mi-hud.on{display:block}#mi-hud small{display:block;font:700 13px/1.3 system-ui;color:#ffcf7a}#mi-hud i{font-style:normal;color:#9dffbf}",
    "#mi-hud .bar{width:150px;height:9px;border-radius:6px;background:rgba(0,0,0,.45);margin:4px 0 0 auto;overflow:hidden}",
    "#mi-hud .bar b{display:block;height:100%;background:linear-gradient(90deg,#ff5d6c,#ffcf7a,#7dffb0);transition:width .2s}",
    "body.touch #mi-hud{top:calc(128px + var(--safe-t,0px));font-size:19px}",
    "#mi-sub{position:fixed;left:50%;top:calc(58px + var(--safe-t,0px));transform:translateX(-50%);max-width:min(560px,92vw);z-index:6;",
    "  pointer-events:none;background:rgba(10,14,28,.78);border:1px solid rgba(255,207,122,.3);border-radius:14px;padding:8px 12px;",
    "  font:600 14px/1.35 system-ui;color:#f6efe2;opacity:0;transition:opacity .3s}#mi-sub.on{opacity:1}#mi-sub b{color:#ffcf7a}",
    ".mi-card{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(380px,92vw);max-height:86vh;overflow:auto;background:rgba(14,18,36,.97);",
    "  border:1px solid rgba(255,207,122,.4);border-radius:20px;padding:16px 18px;z-index:9;pointer-events:auto;box-shadow:0 20px 60px rgba(0,0,0,.6);",
    "  color:#f6efe2;font:500 14px/1.4 system-ui;animation:pop .25s}",
    ".mi-card h3{margin:0 0 2px;font:800 italic 24px Georgia,serif;color:#ffcf7a}.mi-card p{margin:6px 0;color:rgba(255,245,230,.85)}",
    ".mi-card .md{display:flex;gap:6px;justify-content:space-between;margin:10px 0}.mi-card .md span{flex:1;text-align:center;",
    "  background:rgba(255,255,255,.06);border-radius:10px;padding:6px 2px;font-size:12px}.mi-card .md b{display:block;font-size:15px;color:#fff}",
    ".mi-card .big{font-size:64px;text-align:center;line-height:1.1;margin:4px 0}",
    ".mi-card button{display:block;width:100%;margin-top:8px;border-radius:14px;padding:11px;font:700 15px system-ui;cursor:pointer;",
    "  border:1px solid rgba(255,207,122,.35);background:transparent;color:#f6efe2}",
    ".mi-card button.go{border:0;background:linear-gradient(90deg,#ffcf7a,#ff9b4a);color:#2a1205}",
    ".mi-card .warn{color:#ff9aa5;font-size:12px}",
    ".mi-app .mrow{display:flex;align-items:center;gap:8px;padding:8px 4px;border-bottom:1px solid rgba(255,255,255,.07)}",
    ".mi-app .mrow .ic{font-size:22px;width:30px;text-align:center}.mi-app .mrow .tx{flex:1;min-width:0}.mi-app .mrow small{display:block;color:rgba(255,255,255,.6)}",
    ".mi-app .mrow button{flex:none;padding:6px 9px}"
  ].join("\n"));
  var hudEl = document.createElement("div"); hudEl.id = "mi-hud"; document.body.appendChild(hudEl);
  var subEl = document.createElement("div"); subEl.id = "mi-sub"; document.body.appendChild(subEl);
  var subT = 0;
  function sub(who, text, sec) {
    subEl.innerHTML = (who ? "<b>" + esc(who) + ":</b> " : "") + esc(text);
    subEl.classList.add("on"); subT = sec || 6;
    if (FC.audio) FC.audio.play("blip", { vol: 0.5 });
  }

  /* ---- карточка с кнопками (интро, результат, выбор) ------------------------------------------------------- */
  var cardEl = null;
  function card(html, buttons, onClose) {
    closeCard();
    var el = document.createElement("div"); el.className = "mi-card";
    el.innerHTML = html + buttons.map(function (b, i) { return "<button type='button' data-i='" + i + "' class='" + (b.go ? "go" : "") + "'>" + esc(b.label) + "</button>"; }).join("");
    document.body.appendChild(el);
    cardEl = el;
    I.enable(false); if (I.unlock) I.unlock();
    el.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest("button") : null;
      if (!t || t.dataset.i == null) return;
      var b = buttons[+t.dataset.i];
      closeCard();
      if (b && b.act) b.act();
      if (onClose) onClose(b);
    });
    return el;
  }
  function closeCard() { if (cardEl) { cardEl.remove(); cardEl = null; I.enable(true); } }

  /* ---- форматирование ------------------------------------------------------------------------------------ */
  function fmtT(t) { t = Math.max(0, t); var m = Math.floor(t / 60), s = t - m * 60; return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1); }
  function fmtV(by, v) {
    if (v == null) return "—";
    if (by === "time") return fmtT(v);
    if (by === "place") return v + "-е место";
    if (by === "dist") return v.toFixed(1) + " м";
    return String(Math.round(v));
  }
  // лучше ли a, чем b (время, место, промах — меньше лучше; очки — больше)
  function better(by, a, b) { if (b == null) return true; return by === "score" ? a > b : a < b; }
  function medalOf(md, v) {
    if (v == null) return null;
    var ok = function (lim) { return md.by === "score" ? v >= lim : v <= lim; };
    return ok(md.g) ? "g" : ok(md.s) ? "s" : ok(md.b) ? "b" : null;
  }

  /* ---- геометрия: свободное место, полоса, маршрут по дорогам, точки вдоль ломаной -------------------------- */
  function propNear(x, z, r) {
    var l = M.near(x, z, r + 2);
    for (var i = 0; i < l.length; i++) { var o = l[i]; if (o.prop && Math.hypot(o.x - x, o.z - z) < r + o.r) return true; }
    return false;
  }
  function free(x, z, r) { return !M.buildingAt(x, z, r) && !M.water(x, z) && !propNear(x, z, r * 0.6); }
  // ближайшая свободная точка (спираль); в Минске дома известны только в загруженных кусках — звать, когда игрок рядом
  function spot(x, z, rMax, clear) {
    clear = clear || 3;
    if (free(x, z, clear) && !M.onRoad(x, z)) return { x: x, z: z };
    for (var r = 4; r <= (rMax || 120); r += 4) {
      for (var a = 0; a < 16; a++) {
        var px = x + Math.cos(a / 16 * Math.PI * 2 + r) * r, pz = z + Math.sin(a / 16 * Math.PI * 2 + r) * r;
        if (free(px, pz, clear) && !M.onRoad(px, pz)) return { x: px, z: pz };
      }
    }
    return { x: x, z: z };
  }
  function lane(x, z) {
    var l = M.nearestLane(x, z);
    if (!l) return { x: x, z: z, h: 0 };
    return { x: l.x, z: l.z, h: Math.atan2(l.dx, l.dz) };
  }
  function poly(pts) {
    var cum = [0];
    for (var i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    return { pts: pts, cum: cum, L: cum[cum.length - 1] || 0 };
  }
  function polyAt(p, s, out) {
    out = out || {};
    var c = p.cum, n = c.length;
    if (n < 2) { out.x = p.pts[0].x; out.z = p.pts[0].z; out.h = 0; return out; }
    s = s < 0 ? 0 : s > p.L ? p.L : s;
    var lo = 0, hi = n - 2;
    while (lo < hi) { var m = (lo + hi + 1) >> 1; if (c[m] <= s) lo = m; else hi = m - 1; }
    var A = p.pts[lo], B = p.pts[lo + 1], L = (c[lo + 1] - c[lo]) || 1e-6, u = (s - c[lo]) / L;
    out.x = A.x + (B.x - A.x) * u; out.z = A.z + (B.z - A.z) * u; out.h = Math.atan2(B.x - A.x, B.z - A.z);
    return out;
  }
  // маршрут по дорогам от a до b; концы — сами точки (а не ближайшие узлы); выбросы < 2 м схлопываются
  function route(a, b) {
    var r = M.roadRoute(a.x, a.z, b.x, b.z) || [], pts = [{ x: a.x, z: a.z }];
    r.forEach(function (p) { var q = pts[pts.length - 1]; if (Math.hypot(p.x - q.x, p.z - q.z) > 2) pts.push({ x: p.x, z: p.z }); });
    var q = pts[pts.length - 1]; if (Math.hypot(b.x - q.x, b.z - q.z) > 2) pts.push({ x: b.x, z: b.z });
    return poly(pts);
  }
  // контрольные точки через step метров (последняя — финиш)
  function checkpoints(p, step) {
    var out = [], n = Math.max(1, Math.round(p.L / step));
    for (var i = 1; i <= n; i++) { var q = polyAt(p, p.L * i / n); out.push({ x: q.x, z: q.z, h: q.h }); }
    return out;
  }
  // ориентир Минска без госзданий, мемориалов и храмов (как в fevents)
  var BAD = /президент|министер|суд\b|суда|прокурат|комитет|кгб|мвд|омон|милиц|исполком|администрац|мемориал|памятник|музей великой|воинск|войск|храм|собор|костёл|церк|часовн|мечеть|синагог|могил|кладбищ|академия управления|дворец республики|дворец независимости/i;
  function safe(x, z) { return !(M.gov && M.gov(x, z)) && !(M.quiet && M.quiet(x, z)); }
  // кусок OSM под точкой загружен (Минск: дома, деревья и вода известны только в загруженных; Флейм-Сити — всегда)
  var SUPS = null;
  function loaded(x, z) {
    var D = global.MINSK;
    if (!M.minsk || !D || !FC.osm || !FC.osm.debug) return true;
    if (!SUPS) { SUPS = {}; (D.supers || []).forEach(function (q) { SUPS[q[0] + "_" + q[1]] = 1; }); }
    var k = Math.floor(x / (D.sup || 1000)) + "_" + Math.floor(z / (D.sup || 1000));
    return !SUPS[k] || !!FC.osm.debug.loaded[k];
  }
  // реки города ломаными [[x, z], …]: Флейм-Сити — Москва-река; Минск — все линии воды из meta.js (Свислочь — не первая)
  var RIV = null;
  function rivers() {
    if (RIV) return RIV;
    var D = global.MINSK;
    if (M.minsk && D && D.river) RIV = D.river.map(function (L) { var o = []; for (var i = 0; i < L.length; i += 2) o.push([L[i] / 10, L[i + 1] / 10]); return o; });
    else RIV = M.RIVER ? [M.RIVER] : [];
    return RIV;
  }
  function riverNear(x, z) {
    var best = { x: x, z: z }, bd = 1e18;
    rivers().forEach(function (L) { L.forEach(function (p) { var d = Math.hypot(p[0] - x, p[1] - z); if (d < bd) { bd = d; best = { x: p[0], z: p[1] }; } }); });
    return best;
  }

  /* ---- кольца в воздухе: пул из трёх мешей (текущее, следующее, через одно) --------------------------------- */
  var ringGeo = null, ringMat = null, ringMat2 = null;
  function ringPool(c) {
    if (!ringGeo) {
      ringGeo = new T.TorusGeometry(1, 0.07, 8, 40);
      ringMat = new T.MeshBasicMaterial({ color: 0xffcf3f, transparent: true, opacity: 0.9, toneMapped: false, fog: false });
      ringMat2 = new T.MeshBasicMaterial({ color: 0x6bd5ff, transparent: true, opacity: 0.45, toneMapped: false, fog: false, depthWrite: false });
    }
    var pool = [];
    for (var i = 0; i < 3; i++) { var m = new T.Mesh(ringGeo, i ? ringMat2 : ringMat); m.visible = false; c.add(m); pool.push(m); }
    return pool;
  }

  /* ---- контекст миссии: всё созданное — сюда, уборка одна ----------------------------------------------------- */
  var live = { on: 0, timers: 0 };
  function Ctx(m, plan) {
    this.m = m; this.plan = plan; this.t = 0; this.score = 0; this.state = "setup"; this.data = {};
    this.offs = []; this.timers = []; this.objs = []; this.marks = []; this.ints = []; this.cars = []; this.airs = []; this.npcs = [];
    this.els = []; this.ramps = []; this.fns = []; this.cheated = cheating(); this.penalty = 0; this.lastObj = null;
  }
  Ctx.prototype = {
    alive: function () { return cur === this && this.state !== "dead"; },
    on: function (ev, fn) {
      var self = this, off = FC.on(ev, function (d) { if (self.alive()) fn(d); });
      live.on++;
      this.offs.push(function () { off(); live.on--; });
    },
    later: function (sec, fn) {
      var self = this, id = setTimeout(function () { live.timers--; var i = self.timers.indexOf(id); if (i >= 0) self.timers.splice(i, 1); if (self.alive()) fn(); }, sec * 1000);
      live.timers++; this.timers.push(id);
      return id;
    },
    add: function (o) { o.userData.mis = true; G.add(o); this.objs.push(o); return o; },
    mark: function (key, at, opt) {
      var id = "mis-" + key;
      FC.markers.add(Object.assign({ id: id, x: at.x, z: at.z, color: "#ffcf3f", icon: "🏁", ring: 3, route: true }, opt || {}));
      if (this.marks.indexOf(id) < 0) this.marks.push(id);
      return FC.markers.all[id];
    },
    unmark: function (key) { FC.markers.remove("mis-" + key); },
    move: function (key, x, z, y) { var m = FC.markers.all["mis-" + key]; if (m) { m.x = x; m.z = z; if (m.obj) m.obj.position.set(x, y || 0, z); } },
    interact: function (it) { it.id = "mis-" + it.id; FC.interact.add(it); if (this.ints.indexOf(it.id) < 0) this.ints.push(it.id); return it; },
    car: function (type, x, z, h, opt) {
      var car = FC.cars.spawn(type, x, z, h, Object.assign({ owned: true }, opt || {}));
      car.mis = true; this.cars.push(car);
      return car;
    },
    heli: function (type, x, z, yaw, opt) {
      var A = FC.air.spawn(type, x, z, yaw, opt);
      if (!A) return null;
      A.mis = true; this.airs.push(A);
      return A;
    },
    npc: function (cell, x, z, opt) {
      var ch = FC.people.make("npc", cell, x, z, Object.assign({ scale: 1.8, alpha: 1 }, opt || {}));
      ch.mis = true; if (!ch.update) ch.update = function () {};
      this.npcs.push(ch);
      return ch;
    },
    el: function (cls, html) { var e = document.createElement("div"); e.className = cls; e.innerHTML = html || ""; document.body.appendChild(e); this.els.push(e); return e; },
    ramp: function (r) { FC.cars.ramps.push(r); this.ramps.push(r); return r; },
    clean: function (fn) { this.fns.push(fn); },
    obj: function (html) { if (html !== this.lastObj) { this.lastObj = html; H.objective(html); } },
    sub: sub, card: card, spot: spot, lane: lane,
    pass: function (extra) { if (this.alive() && this.state === "run") pass(this, extra); },
    fail: function (why) { if (this.alive() && (this.state === "run" || this.state === "count")) fail(this, why); }
  };
  function cleanup(c) {
    if (!c || c.state === "dead") return;
    c.state = "dead";
    var P = FC.player;
    c.fns.forEach(function (f) { try { f(); } catch (e) { /* уборка миссии */ } });
    c.offs.forEach(function (f) { f(); });
    c.timers.forEach(function (id) { clearTimeout(id); live.timers--; });
    c.marks.forEach(function (id) { FC.markers.remove(id); });
    c.ints.forEach(function (id) { FC.interact.remove(id); });
    c.cars.forEach(function (car) {
      if (P.car === car) { car.mis = false; car.owned = true; return; }      // в своей машине — она остаётся миру
      FC.cars.remove(car);
    });
    c.airs.forEach(function (A) {
      if (P.air === A) { A.mis = false; return; }
      if (FC.air.remove) FC.air.remove(A); else { A.mis = false; A.abandoned = true; }
    });
    c.npcs.forEach(function (ch) { FC.people.remove(ch); });
    c.objs.forEach(function (o) {
      if (o.parent) o.parent.remove(o);
      o.traverse(function (q) { if (q.userData.shared) return; if (q.geometry && q.geometry !== ringGeo) q.geometry.dispose(); });
    });
    c.els.forEach(function (e) { e.remove(); });
    c.ramps.forEach(function (r) { var i = FC.cars.ramps.indexOf(r); if (i >= 0) FC.cars.ramps.splice(i, 1); });
    c.offs = []; c.timers = []; c.marks = []; c.ints = []; c.cars = []; c.airs = []; c.npcs = []; c.objs = []; c.els = []; c.ramps = []; c.fns = [];
    H.objective("");
    hudEl.classList.remove("on");
    subEl.classList.remove("on");
    if (I.enabled === false && !cardEl) I.enable(true);
    if (cur === c) cur = null;
  }

  /* ---- реестр миссий -------------------------------------------------------------------------------------- */
  var LIST = [], BY = {}, cur = null;
  function def(m) {
    if (m.city && m.city !== "both" && m.city !== CITY) return;
    LIST.push(m); BY[m.id] = m;
  }
  function planOf(m) {
    if (m._plan) return m._plan;
    try { m._plan = m.plan ? m.plan(api) : {}; } catch (e) { if (global.console) console.error("mission plan " + m.id, e); m._plan = {}; }
    return m._plan;
  }
  function medalsOf(m) { var p = planOf(m); return m.medals(p); }
  function startAt(m) { var p = planOf(m); return p.start || (m.at ? m.at(p) : { x: 0, z: 0 }); }

  /* ---- запуск: проверка → интро → (перемещение к старту) → подготовка → отсчёт → бег ------------------------- */
  function canStart(quiet) {
    var P = FC.player, why = null;
    if (!P || !FC.started) why = "Игра ещё грузится";
    else if (P.dead) why = "Сначала очнись";
    else if (cur) why = "Уже идёт миссия «" + cur.m.title + "»";
    else if (FC.story && FC.story.active && FC.story.active()) why = "Сначала закончи сюжетное задание";
    else if (FC.heist && FC.heist.run) why = "Во время дела — нельзя";
    else if (FC.police && FC.police.stars > 0) why = "В розыске миссии не берут — оторвись от «Щита»";
    if (why && !quiet) H.toast(why, "bad", 2.5);
    return !why;
  }
  function intro(id) {
    var m = BY[id]; if (!m || !canStart()) return;
    var md = medalsOf(m), b = rec().best[id] || {};
    var html = "<div class='big'>" + m.icon + "</div><h3>" + esc(m.title) + "</h3><p>" + esc(m.desc) + "</p>" +
      "<div class='md'>" + ["g", "s", "b"].map(function (k) { return "<span>" + MEDAL[k] + "<b>" + fmtV(md.by, md[k]) + "</b></span>"; }).join("") + "</div>" +
      "<p>Рекорд: <b>" + (b.v != null ? fmtV(md.by, b.v) + " " + (b.medal ? MEDAL[b.medal] : "") : "—") + "</b></p>" +
      (cheating() ? "<p class='warn'>Читы включены — медаль и достижения не засчитаются.</p>" : "");
    card(html, [{ label: "Поехали", go: true, act: function () { go(id); } }, { label: "Позже" }]);
  }
  function go(id) {
    var m = BY[id]; if (!m || !canStart()) return;
    var P = FC.player, at = startAt(m);
    if (Math.hypot(P.x - at.x, P.z - at.z) > 30) {
      if (!H.teleport(at.x, at.z)) return;
      var tries = 0;
      var wait = function () {
        tries++;
        if (Math.hypot(P.x - at.x, P.z - at.z) > 120 && tries < 30) { setTimeout(wait, 200); return; }
        if (FC.osm && FC.osm.busy && FC.osm.busy() && tries < 40) { setTimeout(wait, 200); return; }
        begin(m);
      };
      setTimeout(wait, 500);
    } else begin(m);
  }
  function begin(m) {
    if (!canStart()) return;
    var P = FC.player;
    if (FC.inside && FC.inside.active) FC.inside.exit(true);
    if (P.mode === "car") FC.cars.exit(true);
    if (P.mode === "air" || P.mode === "chute") FC.air.exit(true);
    var c = new Ctx(m, planOf(m));
    cur = c;
    c.md = medalsOf(m);
    c.limit = c.md.limit || null;
    hideStart();
    try { m.setup(c, api); } catch (e) { if (global.console) console.error("mission setup " + m.id, e); cleanup(c); H.toast("Миссия не запустилась", "bad", 2); return; }
    if (c.state === "dead") return;
    FC.emit("mission:start", { id: m.id });
    var lines = typeof m.intro === "function" ? m.intro(c) : m.intro;
    var count = function () {
      if (!c.alive()) return;
      c.state = "count"; I.enable(false);
      var n = 3;
      var tick = function () {
        if (!c.alive()) return;
        if (n > 0) { H.big(String(n), m.title, "#ffcf7a", 0.9); if (FC.audio) FC.audio.play("blip"); n--; c.later(0.9, tick); return; }
        H.big("ВПЕРЁД!", "", "#7dffb0", 1.2);
        if (FC.audio) FC.audio.play("note");
        c.state = "run"; c.t = 0; c.lastX = P.x; c.lastZ = P.z;
        I.enable(true);
        if (m.go) m.go(c);
      };
      tick();
    };
    // выбор подхода (ограбления GTA: тихо или громко) — карточкой до отсчёта
    var choose = function () {
      if (!c.alive()) return;
      if (!m.choice) { count(); return; }
      card("<h3>" + esc(m.choice.title) + "</h3>", m.choice.opts.map(function (o, i) {
        return { label: o.label, go: i === 0, act: function () { c.data.choice = o.id; count(); } };
      }));
    };
    if (lines && lines.length) H.dialog(lines, choose); else choose();
  }
  // отмена (из телефона или при перемещении): без провала в статистике
  function abort(why) {
    var c = cur; if (!c) return;
    cleanup(c);
    if (why) H.toast("Миссия прервана: " + why, "bad", 2.5);
    FC.emit("mission:abort", { id: c.m.id });
  }
  function fail(c, why) {
    var m = c.m;
    cleanup(c);
    var r = rec(); r.runs++; FC.dirty();
    H.big("ПРОВАЛ", why, "#ff5d6c", 2.6);
    if (FC.audio) FC.audio.play("fail");
    FC.emit("mission:fail", { id: m.id, why: why });
    setTimeout(function () {
      if (cur) return;
      card("<div class='big'>💥</div><h3>Провал</h3><p>" + esc(why) + "</p>",
        [{ label: "Ещё раз", go: true, act: function () { go(m.id); } }, { label: "Выйти" }]);
    }, 1600);
  }
  function pass(c, extra) {
    var m = c.m, md = c.md, by = md.by, P = FC.player;
    var v = by === "time" ? c.t + c.penalty : extra && extra.v != null ? extra.v : c.score;
    var cheated = c.cheated || cheating();
    var medal = cheated ? null : medalOf(md, v);
    if (extra && extra.noMedal) medal = null;
    cleanup(c);
    var r = rec(), b = r.best[m.id] || (r.best[m.id] = {}), first = !b.medal && !b.done;
    var newBest = !cheated && better(by, v, b.v), up = medal && (!b.medal || RANK[medal] > RANK[b.medal]);
    var base = Math.round((m.pay || 1000) * (c.payMul || 1)), reward;
    if (cheated) reward = 0;
    else if (up) reward = Math.round(base * ((medal === "g" ? 2.5 : medal === "s" ? 1.4 : 1) - (b.medal === "g" ? 2.5 : b.medal === "s" ? 1.4 : b.medal === "b" ? 1 : 0)));
    else reward = Math.round(base * (medal ? 0.2 : first ? 0.5 : 0.1));
    if (newBest) b.v = v;
    if (up) b.medal = medal;
    b.done = (b.done || 0) + 1; r.runs++;
    FC.dirty(); FC.saveNow();
    if (reward > 0) FC.money(reward, "миссия «" + m.title + "»");
    if (FC.audio) FC.audio.play("mission");
    if (FC.fx && medal) { FC.fx.burst(P.x, (P.y || 0) + 2, P.z, "confetti", 40); if (FC.fx.haptic) FC.fx.haptic("heavy"); }
    H.big(medal ? MEDAL[medal] + " " + MNAME[medal].toUpperCase() : "МИССИЯ ПРОЙДЕНА", fmtV(by, v), "#ffcf7a", 3);
    FC.emit("mission:pass", { id: m.id, medal: medal, v: v, by: by });
    // достижения
    if (!cheated) {
      if (medal) achUnlock("mis_first_medal");
      if (m.done) { try { m.done(c, medal, v); } catch (e) { /* достижения миссии */ } }
      var all = LIST.every(function (x) { var q = r.best[x.id]; return q && q.medal; });
      var gold = LIST.every(function (x) { var q = r.best[x.id]; return q && q.medal === "g"; });
      if (all) achUnlock("mis_all_" + CITY);
      if (gold) achUnlock("mis_gold_" + CITY);
      if (medal === "g" && FC.social && FC.social.post) FC.social.post("🥇 Золото в миссии «" + m.title + "» — " + fmtV(by, v) + "! Кто быстрее?", 120, { x: P.x, z: P.z });
    }
    setTimeout(function () {
      if (cur) return;
      var html = "<div class='big'>" + (medal ? MEDAL[medal] : m.icon) + "</div><h3>" + esc(m.title) + "</h3>" +
        "<p>" + (medal ? "Медаль: <b>" + MNAME[medal] + "</b>" : cheated ? "Читы — без медали" : "Без медали — попробуй ещё") + " · " + fmtV(by, v) +
        (newBest ? " · <b>новый рекорд!</b>" : "") + "</p>" +
        "<div class='md'>" + ["g", "s", "b"].map(function (k) { return "<span>" + MEDAL[k] + "<b>" + fmtV(by, md[k]) + "</b></span>"; }).join("") + "</div>" +
        (reward > 0 ? "<p>Награда: <b>+" + FC.fmtMoney(reward) + "</b></p>" : "");
      var btns = [{ label: "Ещё раз", go: true, act: function () { go(m.id); } }];
      if (FC.photo && FC.photo.replay) btns.push({ label: "⏪ Повтор момента", act: function () { FC.photo.replay(); } });
      btns.push({ label: "Готово" });
      card(html, btns);
    }, 2200);
  }
  FC.on("busted", function () { if (cur && cur.state !== "dead") fail(cur, "Тебя задержал «Щит»"); });
  FC.on("wasted", function () { if (cur && cur.state !== "dead") fail(cur, "Ты вырубился"); });
  // читы во время миссии — медаль сгорает
  FC.on("cheat", function () { if (cur) cur.cheated = true; });

  /* ---- метки старта: значки на карте всегда, столб света — только рядом --------------------------------------- */
  var nearStart = null, startT = 0;
  function hideStart() { if (nearStart) { FC.markers.remove("mis-start"); FC.interact.remove("mis-start"); nearStart = null; } }
  function startTick(dt) {
    startT -= dt; if (startT > 0) return; startT = 0.3;
    if (cur || !FC.player) { hideStart(); return; }
    // маршруты считаем по одному за тик (Минск: поиск пути по 7 км — десятки мс; разом — заметный рывок после старта)
    for (var j = 0; j < LIST.length; j++) if (!LIST[j]._plan) { planOf(LIST[j]); break; }
    var P = FC.player, best = null, bd = 140;
    for (var i = 0; i < LIST.length; i++) {
      if (!LIST[i]._plan) continue;
      var at = startAt(LIST[i]), d = Math.hypot(at.x - P.x, at.z - P.z);
      if (d < bd) { bd = d; best = LIST[i]; }
    }
    if (best === nearStart) return;
    hideStart();
    if (!best) return;
    nearStart = best;
    var a = startAt(best), md = rec().best[best.id];
    FC.markers.add({ id: "mis-start", x: a.x, z: a.z, color: "#ffcf3f", icon: best.icon, ring: 2.4, route: false });
    FC.interact.add({ id: "mis-start", x: a.x, z: a.z, r: 3.2, label: "🏅 Миссия «" + best.title + "»" + (md && md.medal ? " " + MEDAL[md.medal] : ""),
      when: function () { return !cur && FC.player.mode === "foot"; }, act: function () { intro(best.id); } });
  }
  H.addMapLayer(function (c, k, mode) {
    if (cur) return;
    var s = (mode === "big" ? 15 : 9) / k;
    c.save();
    c.font = s + "px system-ui"; c.textAlign = "center"; c.textBaseline = "middle";
    var r = rec();
    LIST.forEach(function (m) {
      if (!m._plan) return;
      var a = startAt(m), md = r.best[m.id];
      c.fillStyle = md && md.medal === "g" ? "rgba(255,210,63,.95)" : "rgba(20,24,40,.85)";
      c.beginPath(); c.arc(a.x, a.z, s * 0.75, 0, 7); c.fill();
      c.fillStyle = "#fff"; c.fillText(m.icon, a.x, a.z + s * 0.05);
    });
    c.restore();
  });

  /* ---- панель миссии -------------------------------------------------------------------------------------- */
  var hudT = 0;
  function drawHud(c, dt) {
    hudT -= dt; if (hudT > 0) return; hudT = 0.1;
    var md = c.md, m = c.m;
    var main = md.by === "time" || md.by === "place" ? "⏱ " + fmtT(c.t + c.penalty) : md.by === "score" ? "★ " + Math.round(c.score) : "⏱ " + fmtT(c.t);
    var nextMedal = "";
    if (md.by === "time") { var k = c.t + c.penalty <= md.g ? "g" : c.t + c.penalty <= md.s ? "s" : c.t + c.penalty <= md.b ? "b" : null; nextMedal = k ? MEDAL[k] + " до " + fmtT(md[k]) : "без медали"; }
    else if (md.by === "score") { var n = c.score < md.b ? "b" : c.score < md.s ? "s" : c.score < md.g ? "g" : null; nextMedal = n ? MEDAL[n] + " от " + md[n] : MEDAL.g + " есть!"; }
    var extra = m.hud ? m.hud(c) : "";
    hudEl.innerHTML = main + "<small>" + nextMedal + (c.cheated ? " · читы" : "") + "</small>" + (extra || "");
    hudEl.classList.add("on");
  }

  /* ---- кадр ------------------------------------------------------------------------------------------------ */
  FC.addSystem({
    name: "missions", order: 58,
    init: function () { achLoad(); },
    update: function (dt) {
      if (subT > 0) { subT -= dt; if (subT <= 0) subEl.classList.remove("on"); }
      startTick(dt);
      var c = cur; if (!c || c.state === "dead") return;
      if (H.inDialog && H.inDialog()) return;
      var P = FC.player;
      if (c.state === "run") {
        // перемещение с карты посреди миссии — отмена (маршрут и рекорд потеряли бы смысл)
        if (Math.hypot(P.x - c.lastX, P.z - c.lastZ) > 260 && !c.allowJump) { abort("перемещение"); return; }
        c.lastX = P.x; c.lastZ = P.z;
        c.t += dt;
        if (c.limit && c.t > c.limit) { fail(c, c.m.timeout || "Не уложился во время"); return; }
      }
      if (c.m.tick && (c.state === "run" || (c.state === "count" && c.m.tickCount))) {
        try { c.m.tick(c, dt); } catch (e) { if (global.console) console.error("mission tick " + c.m.id, e); fail(c, "Сбой миссии"); return; }
      }
      if (cur === c && c.state === "run") drawHud(c, dt);
    }
  });

  /* ---- «занят» для чужих модулей: события города и сюжет не лезут посреди миссии ------------------------------ */
  if (FC.story && FC.story.busy) {
    var busy0 = FC.story.busy;
    FC.story.busy = function () { return busy0() || !!cur; };
  }

  /* ---- телефон: «Миссии» ---------------------------------------------------------------------------------- */
  H.addApp({ id: "fcmis", icon: "🏅", name: "Миссии", color: "#c2410c", order: 3,
    badge: function () { var r = rec(); return LIST.some(function (m) { return r.best[m.id] && r.best[m.id].done; }) ? "" : "!"; },
    render: function (b, ui) {
      var r = rec(), golds = 0, medals = 0;
      LIST.forEach(function (m) { var q = r.best[m.id]; if (q && q.medal) { medals++; if (q.medal === "g") golds++; } });
      var html = "<div class='list mi-app'><div class='card'><b>Миссии · " + esc(FC.cityName) + "</b><p>Медалей " + medals + " из " + LIST.length +
        " · золото " + golds + (cheating() ? " · <span style='color:#ff9aa5'>читы включены</span>" : "") + "</p></div>";
      if (cur) html += "<div class='row'><span>Сейчас: <b>" + esc(cur.m.title) + "</b></span><button type='button' class='ghost' data-a='stop'>Бросить</button></div>";
      LIST.forEach(function (m) {
        var q = r.best[m.id] || {}, md = medalsOf(m);
        html += "<div class='mrow'><span class='ic'>" + m.icon + "</span><span class='tx'><b>" + esc(m.title) + "</b> " + (q.medal ? MEDAL[q.medal] : "") +
          "<small>" + esc(m.short || m.desc) + "</small><small>Рекорд: " + fmtV(md.by, q.v) + " · " + MEDAL.g + " " + fmtV(md.by, md.g) + "</small></span>" +
          "<button type='button' class='ghost' data-a='wp' data-id='" + m.id + "'>📍</button>" +
          (cur ? "" : "<button type='button' data-a='go' data-id='" + m.id + "'>▶</button>") + "</div>";
      });
      html += "<div class='sec-slot'></div></div>";
      b.innerHTML = html;
      if (FC.secrets && FC.secrets.renderApp) { try { FC.secrets.renderApp(b.querySelector(".sec-slot"), ui); } catch (e) { /* раздел секретов */ } }
      b.addEventListener("click", function (e) {
        var t = e.target.closest ? e.target.closest("button") : null; if (!t) return;
        var a = t.dataset.a, id = t.dataset.id;
        if (a === "stop") { abort("брошена"); ui.refresh(); }
        else if (a === "wp") { var at = startAt(BY[id]); FC.markers.add({ id: "wp", x: at.x, z: at.z, color: "#c86bff", icon: BY[id].icon, route: true, ring: 0 }); ui.close(); H.toast("Маршрут к старту «" + BY[id].title + "»", "", 2); }
        else if (a === "go") { ui.close(); intro(id); }
      });
    } });

  /* ---- API ------------------------------------------------------------------------------------------------- */
  var api = {
    def: def, list: LIST, by: BY, start: go, intro: intro, abort: abort, active: function () { return cur ? cur.m.id : null }, ctx: function () { return cur; },
    rec: rec, medalOf: medalOf, medals: medalsOf, plan: planOf, startAt: startAt, fmtT: fmtT, fmtV: fmtV,
    route: route, poly: poly, polyAt: polyAt, checkpoints: checkpoints, lane: lane, spot: spot, free: free, propNear: propNear, safe: safe, BAD: BAD,
    rivers: rivers, riverNear: riverNear, loaded: loaded,
    ringPool: ringPool, sub: sub, card: card, closeCard: closeCard, ach: achUnlock, achDefs: function () { return ACH; },
    cheating: cheating, cheat: function (name, on, sec) {
      if (on === true || on === false) cheat.on[name] = on;
      cheat.until = Math.max(cheat.until, performance.now() + (sec == null ? 180 : sec) * 1000);
      FC.emit("cheat", { name: name, on: on });
    },
    debug: {
      // утечки после уборки: метки, взаимодействия, транспорт, люди, меши, слушатели, таймеры миссии
      leaks: function () {
        var o = { markers: Object.keys(FC.markers.all).filter(function (k) { return /^mis-/.test(k) && k !== "mis-start"; }),
          cars: FC.cars.list.filter(function (c) { return c.mis; }).length, air: FC.air.list.filter(function (A) { return A.mis; }).length,
          people: FC.people.all.filter(function (c) { return c.mis; }).length, ramps: FC.cars.ramps.filter(function (r) { return r.mis; }).length,
          meshes: 0, listeners: live.on, timers: live.timers, els: document.querySelectorAll(".mi-dash,.mi-mood").length };
        G.scene.traverse(function (q) { if (q.userData && q.userData.mis) o.meshes++; });
        return o;
      },
      pass: function () { if (cur) { cur.state = "run"; pass(cur); } },
      fail: function (why) { if (cur) fail(cur, why || "проверка"); },
      begin: function (id) { var m = BY[id]; if (m) begin(m); return !!cur; }
    }
  };
  FC.mis = api;
})(window);
