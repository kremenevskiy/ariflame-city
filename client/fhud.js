/* Флейм-Сити — интерфейс: миникарта (метки, маршрут, слои других модулей), деньги, розыск, здоровье, часы,
 * подсказки действий, взаимодействия, метки целей в мире, тосты, большие надписи, диалоги, уведомления, телефон с
 * приложениями (их добавляют модули: FC.hud.addApp), большая карта с точкой назначения, пауза.
 *
 * Взаимодействия: FC.interact.add({id, x, z, r, label, key: "use"|"car", act, when, room}) — постоянные;
 * FC.interact.provider(fn(px, pz) → [..]) — вычисляемые (двери ближайших зданий). Ближайшее в радиусе
 * показывается подсказкой «E — …» (на телефоне — подписью кнопки ✋), нажатие зовёт act().
 * Метки: FC.markers.add({id, x, z, color, icon, label, ring: радиус|0, route: true}) — столб света в мире,
 * значок на миникарте, у route — линия маршрута по дорогам.
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE, M = FC.map, G = FC.gfx;
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  var H = {};
  var hud = $("hud");

  /* ---- верхний правый угол: деньги, розыск, часы ------------------------------------------------------------- */
  var topR = el("div", "ui topr");
  var moneyEl = el("div", "money", "$0"), deltaEl = el("div", "mdelta"), starsEl = el("div", "stars"), clockEl = el("div", "clock");
  topR.appendChild(moneyEl); topR.appendChild(deltaEl); topR.appendChild(starsEl); topR.appendChild(clockEl);
  hud.appendChild(topR);
  var shownMoney = 0;
  function setStars(n, flash, hollow) {
    var s = "";
    for (var i = 0; i < 5; i++) s += '<i class="' + (i < n ? (hollow ? "on hollow" : "on") : "") + '">★</i>';
    starsEl.innerHTML = n ? s : "";
    starsEl.classList.toggle("flash", !!flash && n > 0);
  }
  FC.on("money", function (m) {
    deltaEl.textContent = (m.delta > 0 ? "+" : "−") + FC.fmtMoney(Math.abs(m.delta)).replace("$", "$");
    deltaEl.className = "mdelta show " + (m.delta > 0 ? "plus" : "minus");
    clearTimeout(deltaEl._t); deltaEl._t = setTimeout(function () { deltaEl.className = "mdelta"; }, 1800);
  });

  /* ---- левый верх: подсказка (help box) ------------------------------------------------------------------- */
  var helpEl = el("div", "ui help"); hud.appendChild(helpEl);
  var helpUntil = 0;
  function help(html, sec) { helpEl.innerHTML = html; helpEl.classList.add("on"); helpUntil = performance.now() + (sec || 7) * 1000; }

  /* ---- полоса уведомлений (24.11: «на телефоне всё вылазит по центру — пусть сверху приходит как уведомление»): на
     телефоне плашка района, достижение (fach.js), сообщение и короткие плашки — одной стопкой сверху, как пуш на iPhone,
     середина экрана свободна. На компьютере полоса «прозрачна» (display:contents) — у каждого своё место. */
  var lane = el("div", "lane"); hud.appendChild(lane);

  /* ---- плашка района: крупное имя места на 3 с при входе в район (стиль — табличка-указатель и огонь) ----------------- */
  var areaEl = el("div", "ui areacard"); lane.appendChild(areaEl);
  var areaT = 0;
  function areaCard(name, sub) {
    if (!name) return;
    areaEl.innerHTML = "<b>" + esc(name) + "</b>" + (sub ? "<span>" + esc(sub) + "</span>" : "");
    areaEl.classList.remove("on"); void areaEl.offsetWidth; areaEl.classList.add("on");
    clearTimeout(areaT); areaT = setTimeout(function () { areaEl.classList.remove("on"); }, 3400);
  }

  /* ---- низ: цель, подсказка действия, таймер ----------------------------------------------------------------- */
  var objEl = el("div", "ui objective"); hud.appendChild(objEl);
  function objective(html) { objEl.innerHTML = html || ""; objEl.classList.toggle("on", !!html); }
  var promptEl = el("div", "ui prompt"); hud.appendChild(promptEl);
  // на телефоне подсказка — сама кнопка: «Сесть», «Открыть», «Взять» с иконкой; тап = то же, что кнопка действия
  promptEl.addEventListener("touchstart", function (e) {
    e.preventDefault(); e.stopPropagation();
    if (!current) return;
    FC.input.tap(current.key === "car" ? "car" : "use");
    if (FC.fx) FC.fx.haptic("light");
  }, { passive: false });
  var timerEl = el("div", "ui timer"); hud.appendChild(timerEl);
  var timer = null;
  function setTimer(sec, label, onEnd) { timer = sec == null ? null : { left: sec, label: label || "", end: onEnd }; timerEl.classList.toggle("on", !!timer); }

  /* ---- тосты и большие надписи ------------------------------------------------------------------------------- */
  var toastBox = el("div", "ui toasts"); lane.appendChild(toastBox);
  function toast(text, cls, sec) {
    // тот же текст уже на экране — не дублируем стопкой одинаковых строк
    for (var k = 0; k < toastBox.children.length; k++) { var o = toastBox.children[k]; if (o._txt === text && !o.classList.contains("bye")) return; }
    var t = el("div", "toast " + (cls || ""), esc(text)); t._txt = text; toastBox.appendChild(t);
    setTimeout(function () { t.classList.add("bye"); }, (sec || 3) * 1000);
    setTimeout(function () { t.remove(); }, (sec || 3) * 1000 + 500);
  }
  var bigEl = el("div", "big"); hud.appendChild(bigEl);
  function big(title, sub, color, sec) {
    bigEl.innerHTML = "<b style='color:" + (color || "#ffcf7a") + "'>" + esc(title) + "</b>" + (sub ? "<span>" + esc(sub) + "</span>" : "");
    bigEl.classList.remove("on"); void bigEl.offsetWidth; bigEl.classList.add("on");
    clearTimeout(bigEl._t); bigEl._t = setTimeout(function () { bigEl.classList.remove("on"); }, (sec || 3.2) * 1000);
  }

  /* ---- уведомление «сообщение на телефон» ---------------------------------------------------------------------- */
  var noteBox = el("div", "ui notes"); lane.appendChild(noteBox);
  function notify(from, text, icon, sec) {
    var n = el("div", "note", "<div class='ni'>" + (icon || "💬") + "</div><div><b>" + esc(from) + "</b><p>" + esc(text) + "</p></div>");
    noteBox.prepend(n);
    if (FC.audio) FC.audio.play("note");
    // на телефоне пуш сверху закрывает миникарту и деньги — держим не дольше 6 с, тап — убрать сразу
    var dur = (sec || 6) * 1000; if (FC.input && FC.input.touch) dur = Math.min(dur, 6000);
    var bye = function () { n.classList.add("bye"); setTimeout(function () { n.remove(); }, 450); };
    n.addEventListener("click", bye);
    setTimeout(bye, dur);
    FC.emit("notify", { from: from, text: text });
  }

  /* ---- диалог: портрет, имя, текст; дальше — тап, E, Enter, пробел ---------------------------------------------- */
  var dlg = el("div", "dlg"); dlg.id = "dlg"; hud.appendChild(dlg);
  var dq = null;
  function dialog(lines, done) {
    dq = { lines: lines.slice(), done: done };
    FC.input.enable(false);
    document.body.classList.add("indlg");
    nextLine();
  }
  function face(f) {
    if (f === "mascot") return "<img src='" + FC.MASCOT.img + "' alt=''>";
    if (f && f.cell != null) return "<span class='fc' style='" + atlasStyle(f.cell) + "'></span>";
    return "<span class='fe'>" + (f || "💬") + "</span>";
  }
  function atlasStyle(cell) {
    var cx = cell % 16, cy = Math.floor(cell / 16);
    var S = global.FC_SPECIES;                         // атлас видов — необязательный набор (docs/ARCHITECTURE.md «Виды»)
    if (!S || !S.atlas) return "background:radial-gradient(circle at 50% 55%,#ffcf7a,#ff8a3d 60%,transparent 62%)";
    return "background-image:url(" + S.atlas + ");background-size:1600% 1600%;background-position:" + (cx / 15 * 100) + "% " + (cy / 15 * 100) + "%";
  }
  function nextLine() {
    if (!dq) return;
    var l = dq.lines.shift();
    if (!l) { var d = dq.done; dq = null; dlg.classList.remove("on"); document.body.classList.remove("indlg"); FC.input.enable(true); if (d) d(); return; }
    if (typeof l === "string") l = { who: FC.MASCOT.name, text: l, face: "mascot" };
    dlg.innerHTML = "<div class='df'>" + face(l.face) + "</div><div class='dt'><b>" + esc(l.who) + "</b><p>" + esc(l.text) +
      "</p><i>" + (FC.input.touch ? "нажми, чтобы продолжить" : "E — дальше · WASD — пропустить и идти") + "</i></div>";
    dlg.classList.add("on");
    if (FC.audio) FC.audio.play("blip");
  }
  dlg.addEventListener("click", nextLine);
  global.addEventListener("keydown", function (e) {
    if (!dq) return;
    // жмут движение, пока открыт диалог, — значит, хотят идти: диалог закрывается (остаток реплик пропускаем), управление
    // сразу у игрока; продолжение (шаг задания) идёт как после последней реплики
    if (/^(KeyW|KeyA|KeyS|KeyD|Arrow(Up|Down|Left|Right))$/.test(e.code) && !e.repeat) { dq.lines.length = 0; nextLine(); return; }
    if (e.code === "KeyE" || e.code === "Enter" || e.code === "Space") { e.preventDefault(); nextLine(); }
  });

  /* ---- миникарта ------------------------------------------------------------------------------------------------ */
  // Подложка: Флейм-Сити — квадрат ±EDGE; Минск 1:1 — границы данных и своя роспись (FC.map.paintBase, fmapx.js)
  var MB = M.mapBounds || [-M.EDGE, -M.EDGE, M.EDGE, M.EDGE];
  var SCALE = M.mapScale || 0.6;          // пикселей на метр в подложке
  var MAPW = Math.ceil((MB[2] - MB[0]) * SCALE), KMIN = M.minsk ? 0.012 : 0.12;
  var base = document.createElement("canvas"); base.width = MAPW; base.height = Math.ceil((MB[3] - MB[1]) * SCALE);
  function paint() {
    var x = base.getContext("2d");
    if (M.paintBase) { M.paintBase(x, SCALE); return; }
    function X(v) { return (v + M.EDGE) * SCALE; }
    x.fillStyle = "#1d3b2c"; x.fillRect(0, 0, MAPW, MAPW);
    x.fillStyle = "#123a55"; x.fillRect(0, X(M.SEA_LINE), MAPW, MAPW);
    x.fillStyle = "#c9b27a"; x.fillRect(0, X(M.BEACH_Z0), MAPW, X(M.SEA_LINE) - X(M.BEACH_Z0));
    M.blocks.forEach(function (b) {
      x.fillStyle = b.kind === "water" ? "#123a55" : b.kind === "park" || b.kind === "shore" ? "#2d5a3a" : b.kind === "plaza" ? "#6a5a3a" : "#3a404a";
      x.fillRect(X(b.x0), X(b.z0), (b.x1 - b.x0) * SCALE, (b.z1 - b.z0) * SCALE);
    });
    // река и озеро — по кривой, как в мире
    x.strokeStyle = "#123a55"; x.lineWidth = M.RIVER_W * SCALE; x.lineCap = "round"; x.lineJoin = "round";
    x.beginPath(); M.RIVER.forEach(function (p, i) { if (i) x.lineTo(X(p[0]), X(p[1])); else x.moveTo(X(p[0]), X(p[1])); }); x.stroke();
    x.fillStyle = "#123a55"; x.beginPath(); x.arc(X(M.LAKE.x), X(M.LAKE.z), M.LAKE.r * SCALE, 0, 7); x.fill();
    M.buildings.forEach(function (B) {
      x.fillStyle = B.title ? B.color : B.h > 70 ? "#5b6676" : "#4b525e";
      x.fillRect(X(B.x - B.w / 2), X(B.z - B.d / 2), B.w * SCALE, B.d * SCALE);
    });
    x.fillStyle = "#8a8f98";
    M.edges.forEach(function (e) {
      var a = M.nodes[e.a], b = M.nodes[e.b], hw = e.w / 2;
      x.fillStyle = e.kind === "hw" ? "#b7a36a" : e.kind === "av" ? "#9aa0a8" : "#7c828b";
      if (e.axis === "z") x.fillRect(X(a.x - hw), X(a.z), e.w * SCALE, (b.z - a.z) * SCALE);
      else x.fillRect(X(a.x), X(a.z - hw), (b.x - a.x) * SCALE, e.w * SCALE);
    });
  }
  paint();
  if (M.paintBase) FC.on("map:base", paint);

  var mini = el("canvas", "ui minimap"); var mctx = mini.getContext("2d");
  var miniWrap = el("div", "ui miniwrap"); miniWrap.appendChild(mini);
  var hpBar = el("div", "hpbar", "<i></i>"); miniWrap.appendChild(hpBar);
  var zoneEl = el("div", "zonename"); miniWrap.appendChild(zoneEl);
  hud.appendChild(miniWrap);
  miniWrap.addEventListener("click", function () { openMap(); });
  var mapLayers = [];
  function addMapLayer(fn) { mapLayers.push(fn); }

  var markers = {};
  var beamGeo = new T.CylinderGeometry(0.9, 0.9, 60, 16, 1, true).translate(0, 30, 0);
  var ringGeo = new T.RingGeometry(0.75, 1, 40).rotateX(-Math.PI / 2);
  function addMarker(m) {
    removeMarker(m.id);
    m.color = m.color || "#ffcf7a";
    if (m.beam !== false || m.ring) {
      var g = new T.Group();
      if (m.beam !== false) g.add(new T.Mesh(beamGeo, new T.MeshBasicMaterial({ color: m.color, transparent: true, opacity: 0.22, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false })));
      if (m.ring) {
        var ring = new T.Mesh(ringGeo, new T.MeshBasicMaterial({ color: m.color, transparent: true, opacity: 0.8, depthWrite: false }));
        ring.scale.setScalar(m.ring); ring.position.y = 0.25; g.add(ring); m.ringMesh = ring;
      }
      g.position.set(m.x, m.y || 0, m.z);
      G.add(g); m.obj = g;
    }
    if (m.route) m.path = M.roadRoute(FC.player ? FC.player.x : 0, FC.player ? FC.player.z : 0, m.x, m.z);
    markers[m.id] = m;
    return m;
  }
  function removeMarker(id) {
    var m = markers[id]; if (!m) return;
    if (m.obj) G.scene.remove(m.obj);
    delete markers[id];
  }
  var routeT = 0;
  /* Миникарта отдаляется на скорости, как в GTA (задача: «когда едешь быстро — чтобы карта отдалялась, больше пространства
     видно; когда останавливаешься, медленнее идёшь — приближалась»). Пешком и бегом — как было (~84 м до края круга),
     город на машине ~50 км/ч — в 1,55 раза дальше, быстрая машина и самолёт — в 2,3 (телефон — в 2: круг там меньше).
     Отдаляется за ~0,7 с, приближается мягче, за ~1,6 с: торможение у светофора и удар не дёргают карту. Метки, маршрут,
     слои модулей и стрелка считаются от того же zoom — масштаб и места у них верные; большой карты это не касается. */
  var mzF = 1, MZ_V = [0, 9, 14, 22, 32, 45], MZ_U = [0, 0, 0.42, 0.69, 0.92, 1];
  function miniTarget(P) {
    var o = P.mode === "car" && P.car ? P.car : P.mode === "air" && P.air ? P.air : P;
    var v = Math.hypot(o.vx || 0, o.vz || 0), u = 1;
    for (var i = 1; i < MZ_V.length; i++) if (v < MZ_V[i]) { u = MZ_U[i - 1] + (MZ_U[i] - MZ_U[i - 1]) * (v - MZ_V[i - 1]) / (MZ_V[i] - MZ_V[i - 1]); break; }
    var top = FC.mobile ? 2 : 2.3, f = 1 + (top - 1) * u;
    if (P.mode === "car") f = Math.max(f, 1.2);                     // за рулём и стоя — чуть шире, чем пешком
    else if (P.mode === "air" || P.mode === "chute") f = Math.max(f, 1.3 + (top - 1.3) * FC.clamp(((P.air && P.air.y) || P.y || 0) / 300, 0, 1));
    return f;
  }
  function drawMini(dt) {
    var P = FC.player; if (!P) return;
    var size = mini.clientWidth || 160, dpr = Math.min(global.devicePixelRatio || 1, 2);
    if (mini.width !== size * dpr) { mini.width = mini.height = size * dpr; }
    var c = mctx, W2 = mini.width / 2;
    var mzT = miniTarget(P);
    mzF += (mzT - mzF) * (1 - Math.exp(-Math.min(dt, 0.25) / (mzT > mzF ? 0.7 : 1.6)));
    var zoom = 0.95 / mzF * dpr / SCALE * (size / 160);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = "#0b1020"; c.fillRect(0, 0, mini.width, mini.height);
    var yaw = FC.cam ? FC.cam.yaw : 0;
    c.save();
    c.translate(W2, W2);
    c.rotate(yaw);
    c.scale(zoom * SCALE, zoom * SCALE);
    c.translate(-P.x, -P.z);
    // только кусок подложки вокруг игрока (радиус вида с запасом на поворот): у Минска подложка — десятки км, рисовать её
    // целиком каждый кадр — главная статья расхода HUD (замер 22.11: HUD 6,4 мс/кадр на телефонном процессоре)
    var vr = W2 * 1.45 / (zoom * SCALE), sx0 = Math.max(MB[0], P.x - vr), sz0 = Math.max(MB[1], P.z - vr);
    var sx1 = Math.min(MB[2], P.x + vr), sz1 = Math.min(MB[3], P.z + vr);
    if (sx1 > sx0 && sz1 > sz0) {
      c.drawImage(base, (sx0 - MB[0]) * SCALE, (sz0 - MB[1]) * SCALE, (sx1 - sx0) * SCALE, (sz1 - sz0) * SCALE, sx0, sz0, sx1 - sx0, sz1 - sz0);
    }
    if (M.mapDetail) M.mapDetail(c, zoom * SCALE, "mini");
    // маршрут к меткам
    routeT -= dt;
    Object.keys(markers).forEach(function (k) {
      var m = markers[k];
      if (m.route && routeT <= 0 && (!m.path || m.px == null || Math.hypot(P.x - m.px, P.z - m.pz) > 30 || m.mx !== m.x || m.mz !== m.z)) {
        m.path = M.roadRoute(P.x, P.z, m.x, m.z); m.px = P.x; m.pz = P.z; m.mx = m.x; m.mz = m.z;    // поиск пути по графу — дорогой
      }
      if (m.route && m.path && m.path.length) {
        c.strokeStyle = m.color; c.lineWidth = 5 / zoom / SCALE * dpr; c.lineJoin = "round"; c.globalAlpha = 0.85;
        c.beginPath(); c.moveTo(P.x, P.z);
        m.path.forEach(function (p) { c.lineTo(p.x, p.z); });
        c.lineTo(m.x, m.z); c.stroke(); c.globalAlpha = 1;
      }
    });
    if (routeT <= 0) routeT = 1.5;
    mapLayers.forEach(function (fn) { try { fn(c, zoom * SCALE, "mini"); } catch (e) { /* слой модуля не должен ронять карту */ } });
    c.restore();
    // значки меток — по краю, если за пределами
    var R2 = W2 - 10 * dpr;
    Object.keys(markers).forEach(function (k) {
      var m = markers[k]; if (m.blip === false) return;
      var dx = (m.x - P.x) * zoom * SCALE, dz = (m.z - P.z) * zoom * SCALE;
      var cs = Math.cos(yaw), sn = Math.sin(yaw);
      var sx = dx * cs - dz * sn, sz = dx * sn + dz * cs, d = Math.hypot(sx, sz);
      if (d > R2) { sx *= R2 / d; sz *= R2 / d; }
      c.fillStyle = m.color; c.beginPath(); c.arc(W2 + sx, W2 + sz, 7 * dpr, 0, 7); c.fill();
      c.font = (11 * dpr) + "px system-ui"; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(m.icon || "", W2 + sx, W2 + sz + 0.5);
    });
    // игроки онлайн рядом (кто в радиусе сервера) — голубые точки, у края — прижаты к кругу
    if (FC.mp && FC.mp.remotes) {
      var csY = Math.cos(yaw), snY = Math.sin(yaw);
      Object.keys(FC.mp.remotes).forEach(function (id) {
        var r = FC.mp.remotes[id], ch = r && r.ch; if (!ch) return;
        var ddx = (ch.x - P.x) * zoom * SCALE, ddz = (ch.z - P.z) * zoom * SCALE;
        var qx = ddx * csY - ddz * snY, qz = ddx * snY + ddz * csY, dd = Math.hypot(qx, qz);
        if (dd > R2) { qx *= R2 / dd; qz *= R2 / dd; }
        c.fillStyle = "#4fc3ff"; c.strokeStyle = "#fff"; c.lineWidth = 1.5 * dpr;
        c.beginPath(); c.arc(W2 + qx, W2 + qz, 5 * dpr, 0, 7); c.fill(); c.stroke();
      });
    }
    // игрок — стрелка по направлению взгляда/машины (крупная, золотая)
    var h = P.heading - yaw;
    c.save(); c.translate(W2, W2); c.rotate(-h + Math.PI);
    c.fillStyle = "#ffcf7a"; c.strokeStyle = "#000"; c.lineWidth = 2 * dpr;
    c.beginPath(); c.moveTo(0, -12 * dpr); c.lineTo(8.5 * dpr, 9 * dpr); c.lineTo(0, 4 * dpr); c.lineTo(-8.5 * dpr, 9 * dpr); c.closePath(); c.fill(); c.stroke();
    c.restore();
    // север
    c.save(); c.translate(W2, W2); c.rotate(yaw); c.fillStyle = "#ffcf7a"; c.font = "700 " + (11 * dpr) + "px system-ui"; c.textAlign = "center";
    c.fillText("С", 0, -R2 + 2 * dpr); c.restore();
  }

  /* ---- большая карта: перетаскивание, масштаб, тап — точка назначения ------------------------------------------ */
  var bm = el("div", "bigmap"); bm.id = "bigmap";
  bm.innerHTML = "<canvas></canvas><div class='bmbar'><b>" + esc(M.title || "Карта Флейм-Сити") + "</b><span>тап — проложить маршрут" +
    (M.attribution ? " · " + esc(M.attribution) : "") + "</span><button type='button' class='x'>✕</button></div><div class='legend'></div>";
  hud.appendChild(bm);
  var bmc = bm.querySelector("canvas"), bctx = bmc.getContext("2d");
  // Минск: куда «сразу» (задача: «возле библиотеки, Маяк Минска, Минск-Мир, Немига»)
  var QUICK_MINSK = [["📚 Нацбиблиотека", 4337, -3447], ["🗼 Маяк Минска", 4795, -3389], ["🏙 Минск-Мир", -2372, 3865],
    ["🌉 Немига", -2126, -164], ["⛪ Верхний город", -1562, -449], ["🏘 Троицкое", -1539, -927], ["🏛 Октябрьская", -1226, -306],
    ["🗽 Пл. Победы", -322, -958], ["🏬 Пл. Независимости", -2159, 488], ["🚪 Ворота Минска", -1867, 889], ["🛒 Комаровка", -173, -2187],
    ["🏟 Минск-Арена", -6453, -3985], ["🚇 Уручье", 7078, -5016], ["🎨 Октябрьская ул.", -617, 964]];
  var view = { x: 0, z: 0, k: 0.35 };
  function openMap() {
    if (!FC.player) return;
    view.x = FC.player.x; view.z = FC.player.z;
    if (M.minsk && view.k > 0.16) view.k = 0.14;                  // Минск большой: открываем шире (~3 км в кадре)
    bm.classList.add("on"); FC.input.enable(false); FC.input.unlock();
    if (FC.gfx.hold) FC.gfx.hold("map", true);                    // карта непрозрачная: город под ней не перерисовываем
    // на телефоне низ закрывают кнопки мест — ставим игрока по центру видимой части над ними
    var legH = (bm.querySelector(".legend") || {}).offsetHeight || 0;
    view.z = FC.player.z + Math.min(legH, bm.clientHeight * 0.4) / 2 / view.k;
    drawBig(); bigLive();
    var leg = bm.querySelector(".legend");
    // районы — тап переносит туда; ниже — игроки онлайн (если сервер ответил)
    // быстрые места (Минск — узнаваемые точки; координаты — ресёрч minsk-landmarks-coords.json), потом районы
    var quick = M.minsk ? QUICK_MINSK : (M.hq ? [["🔥 Башня Флейм", M.hq.x, M.hq.z]] : []);
    // одна строка с прокруткой: быстрые места; районы — по кнопке «Районы» (раньше 3–4 ряда кнопок закрывали полкарты)
    leg.classList.remove("all");
    leg.innerHTML = (M.districts.length ? "<button type='button' class='lgo lmore'>⚡ Районы ▾</button>" : "") +
      quick.map(function (q) { return "<button type='button' class='lgo lq' data-x='" + Math.round(q[1]) + "' data-z='" + Math.round(q[2]) + "'>" + esc(q[0]) + "</button>"; }).join("") +
      M.districts.map(function (d) { return "<button type='button' class='lgo ld' data-x='" + Math.round(d.x) + "' data-z='" + Math.round(d.z) + "'>⚡ " + esc(d.name) + "</button>"; }).join("") +
      (FC.me && FC.me.home ? "<button type='button' class='lgo' data-x='" + Math.round(FC.me.home.x) + "' data-z='" + Math.round(FC.me.home.z) + "'>🏠 Домой</button>" : "") +
      "<span class='lpl'></span>";
    leg.querySelectorAll(".lgo[data-x]").forEach(function (b) { b.addEventListener("click", function (e) { e.stopPropagation(); teleport(+b.dataset.x, +b.dataset.z, true); }); });
    var more = leg.querySelector(".lmore");
    if (more) more.addEventListener("click", function (e) { e.stopPropagation(); var on = leg.classList.toggle("all"); more.textContent = on ? "⚡ Районы ▴" : "⚡ Районы ▾"; });
    FC.emit("map:open", { legend: leg });                          // свои кнопки в строку мест (fcrowd: «👥 К игрокам»)
    if (FC.mp && FC.mp.online) FC.mp.online().then(function (list) {
      var box = leg.querySelector(".lpl"); if (!box || !list || !list.length) return;
      box.innerHTML = list.slice(0, 12).map(function (p) {
        return "<button type='button' class='lgo pl' data-id='" + esc(p.id) + "'>🌐 " + esc(p.creatureName || p.creature || "Игрок") + (p.friend ? " ⭐" : "") + "</button>";
      }).join("");
      box.querySelectorAll(".pl").forEach(function (b) { b.addEventListener("click", function (e) { e.stopPropagation(); toPlayer(b.dataset.id); }); });
      bigPlayers = list; drawBig();
    }).catch(function () { /* онлайн недоступен — без игроков */ });
  }
  function closeMap() { bm.classList.remove("on"); FC.input.enable(true); if (FC.gfx.hold) FC.gfx.hold("map", false); if (sheet) sheet.remove(); sheet = null; if (bigTimer) { clearInterval(bigTimer); bigTimer = null; } }
  var bigTimer = null, bigWho = 0;
  function bigLive() {
    if (bigTimer) clearInterval(bigTimer);
    bigTimer = setInterval(function () {
      if (!bm.classList.contains("on")) { clearInterval(bigTimer); bigTimer = null; return; }
      if (++bigWho % 25 === 0 && FC.mp && FC.mp.online) FC.mp.online().then(function (list) { if (list) bigPlayers = list; }).catch(function () {});
      drawBig();
    }, 200);
  }
  var sheet = null, bigPlayers = [];
  /* Тап по большой карте: маршрут или перемещение (как такси в GTA: мгновенно, но не в розыске и не на задании). */
  function mapSheet(wx, wz, sx, sy) {
    if (sheet) sheet.remove();
    var D = M.district(wx, wz);
    var B = M.buildingAt(wx, wz, 2);
    sheet = el("div", "msheet", "<b>" + esc(B && B.name ? B.name : D.name) + "</b>" +
      "<button type='button' data-a='route'>📍 Проложить маршрут</button>" +
      "<button type='button' data-a='go'>⚡ Переместиться сюда</button>" +
      (B && B.doors ? "<button type='button' data-a='enter'>🚪 К двери: " + esc(B.name) + "</button>" : ""));
    sheet.style.left = Math.min(sx, bm.clientWidth - 230) + "px"; sheet.style.top = Math.min(sy, bm.clientHeight - 170) + "px";
    bm.appendChild(sheet);
    var own = sheet;                                             // перемещение закрывает карту (closeMap) и уже убирает лист
    own.addEventListener("click", function (e) {
      var a = e.target.dataset && e.target.dataset.a; if (!a) return;
      e.stopPropagation();
      if (a === "route") { addMarker({ id: "wp", x: wx, z: wz, color: "#c86bff", icon: "📍", route: true, ring: 0 }); toast("Маршрут проложен", "ok", 2); drawBig(); }
      else if (a === "go") teleport(wx, wz, true);
      else if (a === "enter") { var d = B.doors[0]; teleport(d.x + d.nx * 2.5, d.z + d.nz * 2.5, true); }
      own.remove(); if (sheet === own) sheet = null;
    });
  }
  function canTravel() {
    // одна звезда — мелочь за рулём (красный, скорость): перемещение её снимает; от двух — как в GTA, нельзя
    // (задача: «кнопка переместиться, когда в машине еду, не работает» — за рулём ловилась звезда)
    // Минск — пока можно всегда, даже в погоне (задача): перемещение сбрасывает розыск
    if (M.minsk && FC.police && FC.police.stars > 0 && FC.police.clear) { FC.police.clear(true); toast("Ушёл от погони — патруль потерял след", "", 2.2); }
    else if (FC.police && FC.police.stars >= 2) { toast("В розыске (★★) перемещаться нельзя — сначала оторвись", "bad", 3); return false; }
    else if (FC.police && FC.police.stars > 0 && FC.police.clear) { FC.police.clear(true); toast("Мелкое нарушение забыто", "", 1.8); }
    if (FC.heist && FC.heist.busy && FC.heist.busy()) { toast("Во время дела — нельзя", "bad", 3); return false; }
    return true;
  }
  /* Перемещение: выйти из машины/здания, найти ближайший свободный тротуар, затемнение и «вжух». */
  // ближайшая полоса к точке (у ориентира дорога бывает дальше 40 м — ищем кольцами)
  function laneNear(x, z) {
    if (!M.nearestLane) return null;
    var l = M.nearestLane(x, z); if (l) return l;
    for (var r = 45; r <= 225; r += 45) {
      for (var a = 0; a < 8; a++) { l = M.nearestLane(x + Math.cos(a * 0.785) * r, z + Math.sin(a * 0.785) * r); if (l) return l; }
    }
    return null;
  }
  // за рулём — переносимся вместе с машиной на ближайшую полосу у цели, лицом по ходу
  function teleportCar(x, z, fromMap) {
    var P = FC.player, car = P.car, ln = laneNear(x, z);
    if (!ln) return false;
    document.body.classList.add("warp");
    setTimeout(function () {
      if (P.car !== car) { document.body.classList.remove("warp"); return; }
      if (FC.cars && FC.cars.list) FC.cars.list.slice().forEach(function (c) {        // освободить место: трафик рядом — убрать
        if (c !== car && c.driver !== "player" && !c.owned && Math.hypot(c.x - ln.x, c.z - ln.z) < 9 && FC.cars.remove) FC.cars.remove(c);
      });
      car.x = ln.x; car.z = ln.z; car.heading = Math.atan2(ln.dx, ln.dz);
      car.vx = car.vz = 0; car.w = 0; car.vF = 0; car.steer = 0;
      P.x = car.x; P.z = car.z; P.heading = car.heading;
      if (FC.cam) { FC.cam.yaw = car.heading + Math.PI; FC.cam.snap = true; }
      if (FC.fx) { FC.fx.burst(car.x, 0.8, car.z, "sparks", 28); FC.fx.flash("#ffcf7a", 0.35); }
      document.body.classList.remove("warp");
      FC.emit("travel", { x: car.x, z: car.z, car: car });
    }, 260);
    if (fromMap) closeMap();
    toast("⚡ " + M.district(ln.x, ln.z).name + " · на машине", "ok", 2);
    return true;
  }
  function teleport(x, z, fromMap) {
    var P = FC.player; if (!P || !canTravel()) return false;
    if (FC.inside && FC.inside.active) FC.inside.exit(true);
    if (P.mode === "car" && P.car && !P.car.wrecked && teleportCar(x, z, fromMap)) return true;
    if (P.mode === "car" && FC.cars) FC.cars.exit(true);
    if (P.mode === "air" && FC.air) FC.air.exit(true);
    if (FC.inside && FC.inside.active) FC.inside.exit(true);
    var spot = { x: x, z: z };
    if (M.buildingAt(x, z, 1) || M.water(x, z)) {
      var sp = M.sidewalkPoint(FC.rng(FC.hash(x + ":" + z)), x, z, 60);
      if (sp) spot = sp;
    }
    document.body.classList.add("warp");
    setTimeout(function () {
      P.teleport(spot.x, spot.z);
      if (FC.fx) { FC.fx.burst(spot.x, 0.5, spot.z, "sparks", 24); FC.fx.flash("#ffcf7a", 0.35); }
      document.body.classList.remove("warp");
      FC.emit("travel", { x: spot.x, z: spot.z });
    }, 260);
    if (fromMap) closeMap();
    toast("⚡ " + M.district(spot.x, spot.z).name, "ok", 2);
    return true;
  }
  function toPlayer(id) {
    if (!FC.mp || !FC.mp.locate) return;
    FC.mp.locate(id).then(function (p) {
      if (!p) { toast("Игрок уже не в сети", "bad", 2); return; }
      if (p.city) { toast("Друг играет " + (p.city === "minsk" ? "в Минске" : "во Флейм-Сити") + " — смени город в настройках", "", 3.5); return; }
      teleport(p.x + 2.5, p.z + 2.5, true);
    }).catch(function () { toast("Не нашёл игрока", "bad", 2); });
  }
  bm.querySelector(".x").addEventListener("click", function (e) { e.stopPropagation(); closeMap(); });
  function drawBig() {
    var w = bm.clientWidth, h = bm.clientHeight, dpr = Math.min(global.devicePixelRatio || 1, 2);
    bmc.width = w * dpr; bmc.height = h * dpr;
    var c = bctx; c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = "#0b1020"; c.fillRect(0, 0, w, h);
    c.save(); c.translate(w / 2, h / 2); c.scale(view.k, view.k); c.translate(-view.x, -view.z);
    c.drawImage(base, MB[0], MB[1], MB[2] - MB[0], MB[3] - MB[1]);
    if (M.mapDetail) M.mapDetail(c, view.k, "big", view);
    // Подписи и значки без наложений: каждая надпись слоя проверяется по уже занятым местам экрана, занято — не рисуем.
    // Порядок — по важности: ты и метки (место держим заранее) → слои игры (задания, места, метро) → точки города →
    // названия станций и ориентиров. Мелочь включается с приближением (k — пикселей на метр).
    var occ = [], dprK = dpr, tr = function (x, z) { return [((x - view.x) * view.k + w / 2) * dprK, ((z - view.z) * view.k + h / 2) * dprK]; };
    var pS = tr(FC.player.x, FC.player.z); occ.push([pS[0] - 34 * dpr, pS[1] - 30 * dpr, pS[0] + 34 * dpr, pS[1] + 40 * dpr]);
    Object.keys(markers).forEach(function (k) { var m = markers[k], q = tr(m.x, m.z); occ.push([q[0] - 16 * dpr, q[1] - 16 * dpr, q[0] + 16 * dpr, q[1] + 16 * dpr]); });
    var own = null, lastKey = null, lastOk = false, origFill = c.fillText, origStroke = c.strokeText;
    function fits(t, x, y) {
      var key = t + "|" + x + "|" + y;
      if (key === lastKey) return lastOk;
      var m = c.getTransform(), sx = m.a * x + m.c * y + m.e, sy = m.b * x + m.d * y + m.f, sc = Math.hypot(m.a, m.b);
      var px = (/(\d+(?:\.\d+)?)px/.exec(c.font) || [0, 12])[1] * sc, tw = c.measureText(t).width * sc, th = px * 1.15;
      var x0 = c.textAlign === "center" ? sx - tw / 2 : c.textAlign === "right" || c.textAlign === "end" ? sx - tw : sx;
      var y0 = c.textBaseline === "middle" ? sy - th / 2 : c.textBaseline === "top" ? sy : sy - th * 0.85;
      var r = [x0 - 3 * dpr, y0 - 2 * dpr, x0 + tw + 3 * dpr, y0 + th + 2 * dpr], ok = true;
      for (var i = 0; i < occ.length && ok; i++) { var o = occ[i]; if (o !== own && r[0] < o[2] && r[2] > o[0] && r[1] < o[3] && r[3] > o[1]) ok = false; }
      if (ok) occ.push(r);
      lastKey = key; lastOk = ok; return ok;
    }
    // значок-кружок слоя (r — в метрах мира): занято — слой его пропускает
    c.spot = function (x, z, r) {
      var q = tr(x, z), rr = r * view.k * dpr, b = [q[0] - rr, q[1] - rr, q[0] + rr, q[1] + rr];
      for (var i = 0; i < occ.length; i++) { var o = occ[i]; if (b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]) return false; }
      occ.push(b); own = b; lastKey = null; return true;
    };
    function districtNames(t) {
      var list = (M.places && M.places.length ? M.places : M.districts.map(function (d) { return { name: d.name, x: d.x, z: d.z, rank: 3 }; }))
        .filter(function (d) { return (d.rank || 3) >= (t === 2 ? 1 : 2); })
        .sort(function (a, b) { return (b.rank || 3) - (a.rank || 3); });
      c.textAlign = "center"; c.textBaseline = "middle"; c.lineWidth = 3 / view.k; c.strokeStyle = "rgba(8,12,24,.55)";
      var seen = {};                                             // у района бывает несколько точек («Сухарево») — одна подпись
      list.forEach(function (d) {
        if (seen[d.name]) return; seen[d.name] = 1;
        var big = (d.rank || 3) >= 3, px = t === 2 ? 12 : big ? 15 : d.rank === 1 ? 11 : 13;
        c.font = (big ? "800 " : "700 ") + (px / view.k) + "px system-ui";
        c.fillStyle = t === 2 ? "rgba(255,255,255,.38)" : big ? "rgba(255,255,255,.82)" : "rgba(255,255,255,.62)";
        if (t < 2) c.strokeText(d.name.toUpperCase(), d.x, d.z);  // та же надпись — место уже проверено (fits помнит)
        c.fillText(d.name.toUpperCase(), d.x, d.z);
      });
    }
    c.fillText = function (t, x, y, mw) { if (fits(t, x, y)) origFill.call(c, t, x, y, mw); };
    c.strokeText = function (t, x, y, mw) { if (fits(t, x, y)) origStroke.call(c, t, x, y, mw); };
    // районы на обзоре — главное, пишем раньше значков слоёв (во Флейм-Сити районов мало — и на среднем зуме)
    var tier = H.mapTier(view.k), namesFirst = tier === 0 || (!M.minsk && tier === 1);
    if (namesFirst) districtNames(tier);
    mapLayers.forEach(function (fn) { own = null; try { fn(c, view.k, "big"); } catch (e) { /* слой */ } });
    own = null;
    if (tier === 1 && !namesFirst) districtNames(tier);
    // значки точек: издалека — только больницы и полиция, ближе — все (без наложений)
    c.textAlign = "center"; c.textBaseline = "middle";
    var fs = Math.max(10, 16 / view.k);
    c.font = fs + "px system-ui";
    var allPois = tier === 2;
    if (tier > 0) {                                              // весь город — без мелких значков: районы, метро, места, ты
      M.pois.forEach(function (B) { if (allPois || B.poi === "hospital" || B.poi === "police") c.fillText(B.emoji || "•", B.x, B.z); });
      Object.keys(M.zones).forEach(function (k) { var B = M.zones[k]; c.fillText(B.emoji, B.x, B.z); });
    }
    if (M.hq) c.fillText("🔥", M.hq.x, M.hq.z);
    if (FC.me && FC.me.home) c.fillText("🏠", FC.me.home.x, FC.me.home.z);
    if (M.mapLabels) M.mapLabels(c, view.k, view);               // названия станций и ориентиров — последними
    if (tier === 2) districtNames(tier);                         // вблизи районы — тише всех, где осталось место
    delete c.fillText; delete c.strokeText; delete c.spot;       // дальше — снова обычные методы холста
    Object.keys(markers).forEach(function (k) { var m = markers[k]; c.fillStyle = m.color; c.beginPath(); c.arc(m.x, m.z, 9 / view.k, 0, 7); c.fill(); c.fillStyle = "#000"; c.fillText(m.icon || "", m.x, m.z); });
    c.restore();
    // игроки онлайн и ты — в экранных пикселях (не зависят от масштаба: на весь Минск точка в 8 «метров карты» терялась),
    // с подписями; задача: «чтобы я на карте больше был и показывался, и те, кто онлайн»
    var toS = function (x, z) { return [(x - view.x) * view.k + w / 2, (z - view.z) * view.k + h / 2]; };
    c.font = "700 12px system-ui"; c.textAlign = "center"; c.textBaseline = "middle"; c.lineJoin = "round";
    var legEl = bm.querySelector(".legend"), botY = h - Math.min((legEl && legEl.offsetHeight) || 0, h * 0.42) - 14;
    bigPlayers.forEach(function (p) {
      if (p.x == null) return;
      var s = toS(p.x, p.z), col = p.friend ? "#ffcf7a" : "#4fc3ff";
      // за краем — прижать к краю видимой части со стрелкой «туда»
      var cx = FC.clamp(s[0], 26, w - 26), cy = FC.clamp(s[1], 74, botY);
      if (cx !== s[0] || cy !== s[1]) {
        var ang = Math.atan2(s[1] - cy, s[0] - cx);
        c.save(); c.translate(cx, cy); c.rotate(ang); c.fillStyle = col; c.strokeStyle = "#fff"; c.lineWidth = 2;
        c.beginPath(); c.moveTo(14, 0); c.lineTo(-6, -8); c.lineTo(-6, 8); c.closePath(); c.fill(); c.stroke(); c.restore();
        var nm0 = (p.friend ? "⭐ " : "") + (p.creatureName || "Игрок") + " · " + Math.round(Math.hypot(p.x - FC.player.x, p.z - FC.player.z) / 100) / 10 + " км";
        c.lineWidth = 3.5; c.strokeStyle = "rgba(0,0,0,.75)"; c.strokeText(nm0, FC.clamp(cx, 60, w - 60), cy + (cy > h / 2 ? -18 : 18));
        c.fillStyle = col; c.fillText(nm0, FC.clamp(cx, 60, w - 60), cy + (cy > h / 2 ? -18 : 18));
        return;
      }
      c.fillStyle = "rgba(0,0,0,.55)"; c.beginPath(); c.arc(s[0], s[1], 10, 0, 7); c.fill();
      c.fillStyle = col; c.beginPath(); c.arc(s[0], s[1], 7.5, 0, 7); c.fill();
      c.strokeStyle = "#fff"; c.lineWidth = 2; c.stroke();
      var nm = (p.friend ? "⭐ " : "") + (p.creatureName || "Игрок");
      c.lineWidth = 3.5; c.strokeStyle = "rgba(0,0,0,.75)"; c.strokeText(nm, s[0], s[1] - 18); c.fillStyle = col; c.fillText(nm, s[0], s[1] - 18);
    });
    var P = FC.player, ps = toS(P.x, P.z), pulse = 1 + 0.35 * Math.abs(Math.sin(performance.now() / 380));
    c.strokeStyle = "rgba(255,207,122,.85)"; c.lineWidth = 3; c.beginPath(); c.arc(ps[0], ps[1], 19 * pulse, 0, 7); c.stroke();
    c.save(); c.translate(ps[0], ps[1]); c.rotate(-(P.heading || 0) + Math.PI);
    c.fillStyle = "#ffcf7a"; c.strokeStyle = "#1a1206"; c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(0, -15); c.lineTo(11, 11); c.lineTo(0, 5); c.lineTo(-11, 11); c.closePath(); c.fill(); c.stroke();
    c.restore();
    c.font = "800 13px system-ui"; c.lineWidth = 4; c.strokeStyle = "rgba(0,0,0,.8)"; var me0 = FC.nick && FC.nick.name(), meL = me0 ? "Ты · " + me0 : "Ты";   // свой ник — как его видят другие
    c.strokeText(meL, ps[0], ps[1] + 26); c.fillStyle = "#ffcf7a"; c.fillText(meL, ps[0], ps[1] + 26);
  }
  (function bindBig() {
    var drag = null, moved = 0, pinch = null;
    bmc.addEventListener("pointerdown", function (e) { drag = { x: e.clientX, y: e.clientY }; moved = 0; bmc.setPointerCapture(e.pointerId); });
    bmc.addEventListener("pointermove", function (e) {
      if (!drag || pinch) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y; moved += Math.abs(dx) + Math.abs(dy);
      view.x -= dx / view.k; view.z -= dy / view.k; drag = { x: e.clientX, y: e.clientY }; drawBig();
    });
    bmc.addEventListener("pointerup", function (e) {
      if (drag && moved < 8) {
        var r = bmc.getBoundingClientRect();
        var wx = view.x + (e.clientX - r.left - r.width / 2) / view.k, wz = view.z + (e.clientY - r.top - r.height / 2) / view.k;
        mapSheet(wx, wz, e.clientX - r.left, e.clientY - r.top);
      }
      drag = null;
    });
    bmc.addEventListener("wheel", function (e) { view.k = FC.clamp(view.k * (e.deltaY > 0 ? 0.85 : 1.18), KMIN, 2.5); drawBig(); }, { passive: true });
    bmc.addEventListener("touchstart", function (e) { if (e.touches.length === 2) pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }, { passive: true });
    bmc.addEventListener("touchmove", function (e) {
      if (e.touches.length === 2 && pinch) {
        var d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        view.k = FC.clamp(view.k * d / pinch, KMIN, 2.5); pinch = d; drawBig();
      }
    }, { passive: true });
    bmc.addEventListener("touchend", function () { pinch = null; }, { passive: true });
  })();

  /* ---- телефон: сетка приложений, экран приложения ----------------------------------------------------------- */
  var apps = [];
  var phone = el("div", "phone"); phone.id = "phone";
  phone.innerHTML = "<div class='pscreen'><div class='pbar'><span class='ptime'></span><span>" + FC.cityName + "</span><span>🔋</span></div><div class='pbody'></div></div><button type='button' class='phome'>⌂</button>";
  hud.appendChild(phone);
  var pbody = phone.querySelector(".pbody");
  function addApp(a) { apps.push(a); apps.sort(function (p, q) { return (p.order || 50) - (q.order || 50); }); }
  function phoneHome() {
    pbody.innerHTML = "<div class='apps'>" + apps.map(function (a, i) {
      return "<button type='button' data-i='" + i + "' class='app'><span style='background:" + (a.color || "#334") + "'>" + a.icon + "</span><i>" + esc(a.name) + "</i>" + (a.badge && a.badge() ? "<em>" + a.badge() + "</em>" : "") + "</button>";
    }).join("") + "</div>";
    pbody.querySelectorAll(".app").forEach(function (b) {
      b.addEventListener("click", function () { openApp(apps[+b.dataset.i]); });
    });
  }
  function openApp(a) {
    if (a.direct) { closePhone(); a.direct(); return; }
    pbody.innerHTML = "<div class='apphead'><button type='button' class='back'>‹</button><b>" + a.icon + " " + esc(a.name) + "</b></div><div class='appbody'></div>";
    pbody.querySelector(".back").addEventListener("click", phoneHome);
    a.render(pbody.querySelector(".appbody"), { close: closePhone, refresh: function () { openApp(a); } });
  }
  function openPhone(appId) {
    phone.classList.add("on"); FC.input.enable(false); FC.input.unlock();
    var a = appId && apps.filter(function (x) { return x.id === appId; })[0];
    if (a) openApp(a); else phoneHome();
    if (FC.audio) FC.audio.play("blip");
  }
  function closePhone() { phone.classList.remove("on"); FC.input.enable(true); }
  phone.querySelector(".phome").addEventListener("click", function () { if (pbody.querySelector(".apps")) closePhone(); else phoneHome(); });
  addApp({ id: "map", icon: "🗺️", name: "Карта", color: "#2a6f97", order: 1, direct: openMap });
  addApp({ id: "settings", icon: "⚙️", name: "Настройки", color: "#495057", order: 99, render: function (b) {
    b.innerHTML = "<div class='list'>" +
      "<div class='row'><span>Графика</span><select id='q-sel'><option value='low'>низкая</option><option value='mid'>средняя</option><option value='high'>высокая</option></select></div>" +
      "<div class='row'><span>Звук</span><button type='button' id='snd'>" + (FC.audio && FC.audio.muted ? "выкл" : "вкл") + "</button></div>" +
      "<div class='row'><span>Время</span><button type='button' id='skip'>промотать 3 часа</button></div>" +
      "<div class='row'><span>Управление</span><p class='quiet'>WASD — идти, Shift — бег, пробел — прыжок/ручник, E — войти/действие, F — сесть в машину, ЛКМ/Q — удар, M — карта, P/Tab — телефон, H — гудок, C — камера</p></div>" +
      "<div class='row'><span>Город</span><select id='city-sel'><option value='flame'>Флейм-Сити</option><option value='minsk'>Минск 1:1</option></select></div>" +
      (M.attribution ? "<div class='row'><span>Карта</span><p class='quiet'>Минск 1:1 — данные " + esc(M.attribution) + " (ODbL)</p></div>" : "") +
      (FC.humans && FC.humans.credits ? "<div class='row'><span>Люди</span><p class='quiet'>" + esc(FC.humans.credits) + "</p></div>" : "") +
      "<div class='row'><span>Карта Минска</span><p class='quiet'>© участники OpenStreetMap, данные — лицензия ODbL 1.0</p></div>" +
      "<div class='row'><span>Движок</span><p class='quiet'>three.js r160, лицензия MIT · игра — открытый код, FSL-1.1-MIT</p></div>" +
      "<div class='row'><span>Прогресс</span><button type='button' id='reset' class='danger'>начать заново</button></div></div>";
    var sel = b.querySelector("#q-sel"); sel.value = G.Q.level;
    var cs = b.querySelector("#city-sel"); cs.value = FC.city || "flame";
    cs.addEventListener("change", function () {
      try { global.localStorage.setItem("fc.city", cs.value); } catch (e) { /* приватное окно */ }
      if (FC.saveNow) FC.saveNow();
      var u = new URL(global.location.href); u.searchParams.set("city", cs.value); global.location.href = u.toString();
    });
    sel.addEventListener("change", function () { G.setQuality(sel.value); });
    b.querySelector("#snd").addEventListener("click", function (e) { if (FC.audio) { FC.audio.setMuted(!FC.audio.muted); e.target.textContent = FC.audio.muted ? "выкл" : "вкл"; } });
    b.querySelector("#skip").addEventListener("click", function () { FC.setHour(FC.clock.hour + 3); toast("⏩ +3 часа", "", 1.5); });
    b.querySelector("#reset").addEventListener("click", function () { if (confirm("Стереть прогресс и начать сначала?")) { FC.resetSave(); location.reload(); } });
    FC.emit("phone:settings", b.querySelector(".list"));          // модули добавляют свои строки (fnick.js — ник)
  } });

  /* ---- взаимодействия ---------------------------------------------------------------------------------------- */
  var fixed = [], providers = [];
  var current = null;
  FC.interact = {
    add: function (it) { FC.interact.remove(it.id); fixed.push(it); return it; },
    remove: function (id) { for (var i = fixed.length - 1; i >= 0; i--) if (fixed[i].id === id) fixed.splice(i, 1); },
    provider: function (fn) { providers.push(fn); },
    current: function () { return current; }
  };
  var pickT = 0, miniT = 1, miniDt = 0, lastMoneyT = "", lastClockT = "", lastHpW = -1, lastPromptH = "", ptimeEl = null;
  function pickInteraction() {
    var P = FC.player; if (!P || P.busy) return null;
    // на крыше (fmain: P.roof) — своё «место» "roof": двери, машины и люди внизу на улице отсюда недоступны
    var room = FC.inside && FC.inside.active ? FC.inside.building.id : P.roof && P.mode === "foot" ? "roof" : null;
    var list = fixed.slice();
    providers.forEach(function (fn) { var r = fn(P.x, P.z, room); if (r) list = list.concat(r); });
    var best = null, bd = 1e18;
    list.forEach(function (it) {
      if ((it.room == null ? null : it.room) !== room && it.room !== "*") return;
      if (it.when && !it.when()) return;
      if (it.mode && it.mode !== P.mode) return;
      var d = FC.dist2(it.x, it.z, P.x, P.z), r = it.r || 2;
      if (d < r * r && d < bd) { bd = d; best = it; }
    });
    return best;
  }

  /* ---- пауза ---------------------------------------------------------------------------------------------------- */
  var pause = el("div", "pause"); hud.appendChild(pause);
  function togglePause(on) {
    on = on == null ? !pause.classList.contains("on") : on;
    pause.classList.toggle("on", on); FC.paused = on; FC.input.enable(!on);
    if (FC.gfx.hold) FC.gfx.hold("pause", on);                    // на паузе город стоит — кадр рисуется один раз
    if (on) {
      var s = FC.save.stats;
      pause.innerHTML = "<div class='pcard'><h2>Пауза</h2><p>" + esc(FC.me ? FC.me.label : "") + "</p><div class='nums'>" +
        "<div><b>" + FC.fmtMoney(FC.save.money) + "</b>наличные</div><div><b>" + s.jobs + "</b>работ</div><div><b>" + Math.round(s.playMin) + "</b>минут</div></div>" +
        "<button type='button' class='main' id='resume'>Играть</button><button type='button' class='sec' id='ph'>Телефон</button></div>";
      pause.querySelector("#resume").addEventListener("click", function () { togglePause(false); });
      pause.querySelector("#ph").addEventListener("click", function () { togglePause(false); openPhone(); });
      FC.emit("pause:open", pause.querySelector(".pcard"));       // модули дописывают своё (fnick.js — ник)
      FC.input.unlock();
    }
  }

  /* ---- кнопки HUD для тача: телефон, карта, пауза ---------------------------------------------------------------- */
  // иконки — одного набора с кнопками действий (FC.icons, finput.js); на телефоне — ещё «повернуть экран»
  var ic = FC.icons || function () { return ""; };
  var corner = el("div", "ui corner", "<button type='button' data-a='phone' aria-label='Телефон'>" + ic("phone") + "</button>" +
    "<button type='button' data-a='map' aria-label='Карта'>" + ic("map") + "</button><button type='button' data-a='pause' aria-label='Пауза'>" + ic("pause") + "</button>" +
    (FC.input.canFullscreen ? "<button type='button' data-a='full' aria-label='Во весь экран'>" + ic("full") + "</button>" : "") +
    "<button type='button' data-a='rotate' class='only-touch' aria-label='Повернуть экран'>" + ic("rotate") + "</button>");
  hud.appendChild(corner);
  corner.querySelectorAll("button").forEach(function (b) {
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      if (b.dataset.a === "phone") openPhone(); else if (b.dataset.a === "map") openMap();
      else if (b.dataset.a === "full") FC.input.fullscreen();
      else if (b.dataset.a === "rotate") { if (FC.input.landscape() === "rotate") rotateHint(); }
      else togglePause(true);
    });
  });
  /* Поверни телефон (iPhone в Safari замка ориентации нет; Telegram закрепляет только текущий поворот): экран с
     поворачивающимся телефоном, сам уходит, когда телефон повернули, по тапу или через 7 с. Игра не на паузе. */
  var rotEl = null, rotT = 0;
  function rotateHint() {
    var land = global.innerWidth > global.innerHeight;
    if (!rotEl) {
      rotEl = el("div", "ui rotlay");
      rotEl.addEventListener("click", hideRot);
      rotEl.addEventListener("touchstart", function (e) { e.preventDefault(); hideRot(); }, { passive: false });
      document.body.appendChild(rotEl);
    }
    rotEl.className = "ui rotlay" + (land ? " back" : "");
    rotEl.innerHTML = "<div class='rot-ph'><i></i></div><b>" + (land ? "Поверни телефон вертикально" : "Поверни телефон горизонтально") + "</b>" +
      "<span>Не поворачивается — выключи блокировку поворота в Пункте управления</span>";
    rotEl.dataset.land = land ? "1" : "0";
    void rotEl.offsetWidth; rotEl.classList.add("on");
    clearTimeout(rotT); rotT = setTimeout(hideRot, 7000);
  }
  function hideRot() { if (rotEl) rotEl.classList.remove("on"); clearTimeout(rotT); }
  global.addEventListener("resize", function () {
    if (rotEl && rotEl.classList.contains("on") && (global.innerWidth > global.innerHeight ? "1" : "0") !== rotEl.dataset.land) hideRot();
  });
  FC.on("input:rotate-hint", rotateHint);

  /* ---- кадр ----------------------------------------------------------------------------------------------------- */
  FC.addSystem({
    name: "hud", order: 90,
    update: function (dt) {
      var P = FC.player; if (!P) return;
      var I = FC.input;
      // деньги — бегущий счётчик
      var target = FC.save.money;
      shownMoney = Math.abs(target - shownMoney) < 1 ? target : FC.damp(shownMoney, target, 8, dt);
      // DOM трогаем только при изменении: запись текста/стиля каждый кадр — пересчёт стилей и раскладки на телефоне
      var mt = FC.fmtMoney(shownMoney); if (mt !== lastMoneyT) { moneyEl.textContent = mt; lastMoneyT = mt; }
      var cl = FC.clock;
      var ct = (cl.hour < 10 ? "0" : "") + cl.hour + ":" + (cl.minute < 10 ? "0" : "") + cl.minute + (G.weather.target > 0.5 ? " 🌧" : "");
      if (ct !== lastClockT) { clockEl.textContent = ct; lastClockT = ct; if (!ptimeEl) ptimeEl = phone.querySelector(".ptime"); if (ptimeEl) ptimeEl.textContent = ct; }
      var hpK = P.hp / (P.maxHp || 100), hpW = Math.round(FC.clamp(hpK * 100, 0, 100));
      if (hpW !== lastHpW) { hpBar.firstChild.style.width = hpW + "%"; hpBar.classList.toggle("low", hpK < 0.25); lastHpW = hpW; }
      if (helpUntil && performance.now() > helpUntil) { helpEl.classList.remove("on"); helpUntil = 0; }
      // район и улица
      var D = M.district(P.x, P.z);
      var zn = FC.inside && FC.inside.active ? FC.inside.label() : D.name;
      if (zoneEl.textContent !== zn) zoneEl.textContent = zn;
      // таймер
      if (timer) {
        timer.left -= dt;
        var t = Math.max(0, timer.left);
        timerEl.textContent = (timer.label ? timer.label + " " : "") + Math.floor(t / 60) + ":" + ("0" + Math.floor(t % 60)).slice(-2);
        timerEl.classList.toggle("hurry", t < 10);
        if (timer.left <= 0) { var end = timer.end; timer = null; timerEl.classList.remove("on"); if (end) end(); }
      }
      // взаимодействие
      // что можно сделать рядом — опрос всех модулей 10 раз в секунду (а не каждый кадр); нажатие ловим каждый кадр
      pickT -= dt;
      if (pickT <= 0) { pickT = 0.1; current = pickInteraction(); }
      if (current) {
        var key = current.key === "car" ? "F" : "E";
        var ph = (I.touch ? FC.icons(current.key === "car" ? "car" : "use") : "<kbd>" + key + "</kbd> ") + "<span>" + esc(current.label) + "</span>";
        if (ph !== lastPromptH) { promptEl.innerHTML = ph; lastPromptH = ph; }
        promptEl.classList.add("on");
        I.setButton(current.key === "car" ? "car" : "use", { hot: true });
        if ((current.key === "car" ? I.pressed("car") : I.pressed("use"))) {
          I.consume(current.key === "car" ? "car" : "use");
          var it = current; pickT = 0;
          try { it.act(it); } catch (e) { if (global.console) console.error(e); }
        }
      } else { if (lastPromptH) { promptEl.classList.remove("on"); lastPromptH = ""; } I.setButton("use", { hot: false }); }
      I.setButton("car", { hot: !!(current && current.key === "car") || P.mode === "car" });
      if (I.pressed("map")) { if (bm.classList.contains("on")) closeMap(); else openMap(); }
      if (I.pressed("phone")) { if (phone.classList.contains("on")) closePhone(); else openPhone(); }
      if (I.pressed("pause")) togglePause();
      // кольца меток пульсируют
      var tt = performance.now() / 1000;
      Object.keys(markers).forEach(function (k) {
        var m = markers[k];
        if (m.ringMesh) m.ringMesh.material.opacity = 0.55 + Math.sin(tt * 4) * 0.25;
        if (m.obj) m.obj.visible = !(FC.inside && FC.inside.active) || m.room != null;
      });
      miniT += dt; miniDt += dt;
      if (miniT >= (G.Q.level === "low" ? 0.05 : 0.033)) { miniT = 0; drawMini(miniDt); miniDt = 0; }    // 20–30 Гц хватает глазу
    }
  });
  // большая карта и телефон закрываются Esc / M / P сами (ввод выключен, ловим клавиши напрямую)
  global.addEventListener("keydown", function (e) {
    if (bm.classList.contains("on") && (e.code === "Escape" || e.code === "KeyM")) closeMap();
    else if (phone.classList.contains("on") && (e.code === "Escape" || e.code === "KeyP" || e.code === "Tab")) { e.preventDefault(); closePhone(); }
    else if (pause.classList.contains("on") && e.code === "Escape") togglePause(false);
  });

  H.setStars = setStars; H.help = help; H.objective = objective; H.timer = setTimer; H.toast = toast; H.big = big;
  H.notify = notify; H.dialog = dialog; H.addApp = addApp; H.openPhone = openPhone; H.closePhone = closePhone;
  // уровень подробности большой карты: 0 — весь город, 1 — район, 2 — улицы (k — пикселей на метр; Флейм-Сити меньше —
  // его пороги крупнее). Все слои спрашивают уровень здесь, а не свои числа: одна шкала на оба города.
  H.mapTier = function (k) { return M.minsk ? (k < 0.05 ? 0 : k < 0.2 ? 1 : 2) : (k < 0.2 ? 0 : k < 0.5 ? 1 : 2); };
  H.areaCard = areaCard;
  // миникарта: во сколько раз она сейчас отдалена от пешей (1 — пешком), куда стремится и сколько метров до края круга
  H.miniZoom = function () { return { f: mzF, target: FC.player ? miniTarget(FC.player) : 1, r: 80 * mzF / 0.95 }; };
  H.openMap = openMap; H.teleport = teleport; H.addMapLayer = addMapLayer; H.pause = togglePause; H.atlasStyle = atlasStyle; H.esc = esc;
  H.inDialog = function () { return !!dq; };
  FC.hud = H;
  FC.markers = { add: addMarker, remove: removeMarker, all: markers };
})(window);
