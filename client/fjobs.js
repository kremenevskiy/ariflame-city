/* Флейм-Сити — работы, бизнесы, магазины, автосалон, банк (FC.jobs) и их приложения в телефоне.
 *
 * Концепция: игрок — ИИ-агент, и зарабатывает он тем же, чем агенты города: смены в зданиях-зонах — это
 * заявки людей на умения агента (мини-игры FC.games), плюс уличные работы — такси и курьер.
 *
 *   FC.jobs.work(B, ctx)  → Promise   смена за столом в здании B (зовёт интерьер; без интерьеров — точка «Поработать» у входа)
 *   FC.jobs.shop(B) / carshop(B) / atm()   магазин 24/7, автосалон, банкомат (зовёт интерьер; банкоматы есть и на улице)
 *   FC.jobs.startTaxi() / startCourier() / stop()   уличные работы (приложение «Работа» в телефоне)
 *   FC.jobs.buy(B) / collect(B)   бизнесы (точки FC.map.pois с poi === "biz", B.biz {id, price, income})
 *   FC.jobs.level(id), perk(bizId), active()
 * Деньги — только FC.money. Прогресс — FC.save: jobs {id: {xp}}, biz {id: {safe}}, garage [{type, color}], bank.
 * Доход бизнеса — каждый игровой час (событие «hour») в сейф точки, потолок — 8 часов дохода.
 * Машины — по интерфейсу модуля машин: FC.cars {spawn(type, x, z, heading, opt)}, FC.player.car {vx, vz}, события
 * car:enter, car:exit, car:crash {power}. Без FC.cars такси и гараж честно говорят «машин пока нет».
 */
(function (global) {
  "use strict";
  var FC = global.FC, M = FC.map;
  function H() { return FC.hud; }
  function esc(s) { return FC.hud && FC.hud.esc ? FC.hud.esc(s) : String(s); }
  function snd(n) { if (FC.audio && FC.audio.play) FC.audio.play(n); }
  function money(n) { return FC.fmtMoney(n); }

  FC.css([
    ".jb .mg-body{overflow:auto;max-height:66vh}",
    ".jb-list{display:flex;flex-direction:column;gap:8px}",
    ".jb-row{display:flex;align-items:center;gap:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:10px 12px}",
    ".jb-row .ji{width:46px;height:46px;border-radius:14px;display:grid;place-items:center;font-size:26px;background:rgba(255,255,255,.08);flex:none}",
    ".jb-row .jt{flex:1;min-width:0}.jb-row .jt b{display:block;font-size:15px;color:#fff}.jb-row .jt i{font-style:normal;font-size:12px;color:rgba(255,240,215,.6)}",
    ".jb-row .jp{font:800 15px system-ui;color:#9dffbf;white-space:nowrap}",
    ".jb-row .jr{display:flex;align-items:center;gap:10px;flex:none}",
    ".appbody .jb-row{gap:9px;padding:9px 10px;border-radius:14px}.appbody .jb-row .jr{flex-direction:column;align-items:flex-end;gap:4px}",
    ".appbody .jb-row .jt b{font-size:13px}.appbody .jb-row .jt i{font-size:11px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
    ".appbody .jb-row .jp{font-size:13px}.appbody .jb-btn{padding:6px 10px;font-size:12px;border-radius:10px}",
    ".jb-btn{border:0;border-radius:12px;padding:9px 14px;font:700 14px system-ui;background:linear-gradient(90deg,#ffcf7a,#ff9b4a);color:#2a1205;cursor:pointer;white-space:nowrap}",
    ".jb-btn.ghost{background:rgba(255,255,255,.1);color:#fff}.jb-btn:disabled{opacity:.35;cursor:default}",
    ".jb-sum{display:flex;gap:8px;margin-bottom:10px}.jb-sum div{flex:1;background:rgba(255,255,255,.06);border-radius:14px;padding:10px;font-size:11px;color:rgba(255,245,230,.6)}.jb-sum b{display:block;font:800 20px system-ui;color:#fff}",
    ".jb-sw{display:flex;gap:6px;margin:8px 0 2px}.jb-sw button{width:30px;height:30px;border-radius:50%;border:2px solid rgba(255,255,255,.25);cursor:pointer}.jb-sw button.on{border-color:#fff;box-shadow:0 0 0 2px #ffcf7a}",
    ".jb-note{font-size:12px;color:rgba(255,240,215,.55);margin:10px 2px 0}",
    ".appbody .jb-row{background:rgba(255,255,255,.08)}.appbody .jb-row .ji{width:36px;height:36px;font-size:20px;border-radius:11px}.appbody .jb-sum{gap:6px}.appbody .jb-sum div{padding:8px;border-radius:12px}.appbody .jb-sum b{font-size:15px}",
    ".appbody h4{margin:12px 2px 6px;font:700 12px system-ui;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,240,215,.55)}",
    ".jb-lv{height:5px;border-radius:3px;background:rgba(255,255,255,.1);margin-top:4px;overflow:hidden}.jb-lv i{display:block;height:100%;background:#7dffb0}"
  ].join("\n"));

  /* ---- прогресс --------------------------------------------------------------------------------------------- */
  function S() {
    var s = FC.save;
    if (!s.jobs) s.jobs = {};
    if (!s.biz) s.biz = {};
    if (!s.garage) s.garage = [];
    if (s.bank == null) s.bank = 0;
    return s;
  }
  var JOB = { desk: "Офисные смены", taxi: "Такси", courier: "Курьер" };
  function xpOf(id) { return (S().jobs[id] && S().jobs[id].xp) || 0; }
  function level(id) { return Math.min(10, 1 + Math.floor(xpOf(id) / 3)); }
  function addXp(id) {
    var before = level(id);
    var j = S().jobs[id] || (S().jobs[id] = { xp: 0 });
    j.xp++;
    S().stats.jobs = (S().stats.jobs || 0) + 1;
    FC.dirty();
    if (level(id) > before && H()) { H().toast("⬆ " + JOB[id] + ": уровень " + level(id) + " — оплата выше", "ok", 3.5); snd("mission"); }
  }
  function lvlMult(id) { return 1 + (level(id) - 1) * 0.15; }
  function perk(bizId) { return !!S().biz[bizId]; }
  function pay(n, why) { n = Math.round(n); if (n > 0) FC.money(n, why); return n; }

  /* ---- смена за столом -------------------------------------------------------------------------------------- */
  var deskBusy = false;
  var MONTAGE = { cut: 1, reels: 1, effects: 1 };
  var PHOTO = { shoot: 1, photoshoot: 1, foto34: 1, restore: 1, retouch: 1, interior: 1, salon: 1, art: 1, view: 1, stickers: 1, toys: 1 };
  function gameFor(B) {
    var z = B.zone || "";
    if (MONTAGE[z]) return { id: "montage" };
    if (PHOTO[z]) return { id: "photo" };
    if (z === "news") return { id: "type", variant: "news" };
    if (z === "translate" || z === "voice") return { id: "type", variant: "translate" };
    return { id: "tasks", zone: z || null };
  }
  function work(B, ctx) {
    if (deskBusy || !FC.games || !B) return Promise.resolve(null);
    if (FC.police && FC.police.stars > 0) { if (H()) H().toast("С розыском на работу не пускают", "bad"); return Promise.resolve(null); }
    deskBusy = true;
    var g = gameFor(B), L = level("desk");
    var base = B.type === "hq" ? 260 : B.zone ? 180 : B.style === "glass" ? 150 : 120;
    base *= lvlMult("desk");
    if (g.id === "montage" && perk("studio")) base *= 1.25;
    if (perk("nightclub")) base *= 1.05;
    base = FC.clamp(Math.round(base), 80, 400);
    var opt = { pay: base, level: L, variant: g.variant, zone: g.zone };
    if (g.id === "tasks") opt.sub = "Смена: " + B.name;
    else opt.sub = B.name + (B.sub ? " — " + B.sub : "");
    FC.emit("job:start", { id: "desk", B: B, ctx: ctx || null });
    return FC.games.run(g.id, opt).then(function (res) {
      deskBusy = false;
      if (res && res.ok && res.pay) {
        pay(res.pay, "смена: " + B.name);
        addXp("desk");
        H().big("СМЕНА ЗАКРЫТА", "+" + money(res.pay) + " · " + B.name, "#9dffbf", 3);
        snd("cash");
        FC.emit("job:done", { id: "desk", B: B, pay: res.pay, res: res });
      } else if (res && !res.quit) H().toast("Смена не задалась — без оплаты", "bad");
      return res;
    });
  }

  /* ---- уличные работы: такси и курьер ------------------------------------------------------------------------ */
  var job = null;
  var R = FC.rng(Date.now() & 0xfffff);
  function P() { return FC.player; }
  function speedOfCar() { var c = P() && P().car; return c ? Math.hypot(c.vx || 0, c.vz || 0) : 0; }
  function dist(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
  function doorPt(B, off) { var d = B.doors[0]; return { x: d.x + d.nx * (off || 0), z: d.z + d.nz * (off || 0) }; }
  function places() {
    var out = [];
    if (M.zones) Object.keys(M.zones).forEach(function (k) { out.push(M.zones[k]); });
    (M.pois || []).forEach(function (B) { out.push(B); });
    if (M.hq) out.push(M.hq);
    return out;
  }
  function pickPlace(x, z, dmin, dmax, not) {
    var cand = places().filter(function (B) { var d = dist(B.x, B.z, x, z); return B !== not && d > dmin && d < dmax; });
    if (!cand.length) cand = places().filter(function (B) { return B !== not; });
    return cand[Math.floor(R() * cand.length)];
  }
  function clearJobUI() {
    FC.markers.remove("job");
    H().objective(""); H().timer(null);
  }
  function stop(silent) {
    if (!job) return;
    if (job.pax) { FC.people.remove(job.pax); job.pax = null; }
    clearJobUI();
    if (!silent) H().toast(JOB[job.kind] + ": работа закончена" + (job.earned ? " · заработано " + money(job.earned) : ""), "", 3);
    FC.emit("job:stop", { id: job.kind });
    job = null;
  }

  var FARE_LINES = ["Мне в %s, и побыстрее!", "Отвезите в %s — опаздываю!", "В %s, пожалуйста. Агент ждёт с результатом",
    "%s! Там мой заказ готов 🔥", "Подбросите до %s? Плачу щедро", "К %s, только не гоните, я с кофе ☕"];
  function startTaxi() {
    if (job) stop(true);
    if (!FC.cars) { H().toast("Машины в городе ещё не завели — такси позже", "bad", 3); return; }
    job = { kind: "taxi", stage: "car", series: 0, earned: 0 };
    FC.emit("job:start", { id: "taxi" });
    snd("blip");
    if (P().mode !== "car") H().objective("Такси: сядь в машину — подойди и нажми <b>" + (FC.input.touch ? "🚗" : "F") + "</b>");
    else spawnFare();
  }
  function spawnFare() {
    if (!job || job.kind !== "taxi") return;
    var p = P(), sp = null;
    for (var i = 0; i < 40 && !sp; i++) {
      var c = M.sidewalkPoint(R, p.x, p.z, 340);
      if (c && dist(c.x, c.z, p.x, p.z) > 70) sp = c;
    }
    if (!sp) sp = M.sidewalkPoint(R);
    var pax = FC.people.make("npc", FC.people.randomCell(R), sp.x, sp.z, { scale: 1.8, alpha: 1 });
    pax.update = function (ch) { ch.speed = 0; ch.lean = Math.sin(performance.now() / 160) * 0.12; };
    job.pax = pax; job.stage = "pickup"; job.waitT = 150; job.crashes = 0;
    FC.markers.add({ id: "job", x: sp.x, z: sp.z, color: "#ffd23f", icon: "🙋", ring: 3.5, route: true });
    H().objective("Такси: забери пассажира — <b>🙋 на карте</b>" + (job.series ? " · серия " + job.series : ""));
    FC.people.say(pax, "Такси! 🙋", 4);
  }
  function boardFare() {
    var pax = job.pax;
    var B = pickPlace(pax.x, pax.z, 260, 900);
    var dp = doorPt(B, 4);
    var d = dist(pax.x, pax.z, dp.x, dp.z);
    var reason = B.zone && FC.games && FC.games.requests && FC.games.requests[B.zone];
    var line = FARE_LINES[Math.floor(R() * FARE_LINES.length)].replace("%s", q(B.name)) + (reason && R() < 0.5 ? " — «" + reason[0] + "»" : "");
    FC.people.remove(pax); job.pax = null;
    job.dest = B; job.dp = dp; job.dist = d; job.stage = "ride"; job.crashes = 0; job.outT = 0;
    var T = Math.round(d / 10 + 28);
    job.T = T;
    FC.markers.add({ id: "job", x: dp.x, z: dp.z, color: "#ffd23f", icon: "🏁", ring: 5, route: true });
    H().objective("Такси: отвези в <b>" + esc(q(B.name)) + "</b> · " + Math.round(d) + " м");
    H().notify("Пассажир", line, "🧳", 5);
    H().timer(T, "🚕", function () {
      if (!job || job.stage !== "ride") return;
      H().toast("Пассажир вышел, не заплатив — слишком долго", "bad", 3); snd("fail");
      job.series = 0; FC.markers.remove("job"); job.stage = "next"; setTimeout(spawnFare, 1200);
    });
    snd("door");
  }
  function arriveFare() {
    H().timer(null);
    var base = (40 + job.dist * 0.11) * lvlMult("taxi") * Math.min(1.5, 1 + job.series * 0.1);
    if (perk("taxi")) base *= 1.2;
    var fast = (job.T - job.elapsed) / job.T;
    var bonus = fast > 0.3 ? 0.25 : 0;
    var dmg = Math.max(0.4, 1 - job.crashes * 0.08);
    var tip = perk("flowers") ? 20 : 0;
    var total = pay(base * (1 + bonus) * dmg + tip, "такси");
    job.earned += total; job.series++;
    addXp("taxi");
    H().big("ПОЕЗДКА ОПЛАЧЕНА", "+" + money(total) + (bonus ? " · чаевые за скорость" : "") + (job.crashes ? " · −" + Math.round((1 - dmg) * 100) + "% за удары" : ""), "#ffd23f", 3);
    H().toast(["Спасибо! ⭐⭐⭐⭐⭐", "Огонь, а не водитель 🔥", "Успели! Держите сверху", "Мягко довезли, спасибо"][Math.floor(R() * 4)], "ok", 2.5);
    snd("cash");
    FC.markers.remove("job"); job.stage = "next";
    FC.emit("job:done", { id: "taxi", pay: total });
    setTimeout(spawnFare, 1800);
  }

  var PARCELS = ["флешку с исходниками ролика", "папку с договором", "коробку с 3D-фигуркой", "стопку пригласительных",
    "жёсткий диск с фотосессией", "пакет стикеров", "QR-коды для меню", "плёнку для реставрации"];
  function startCourier() {
    if (job) stop(true);
    var p = P();
    var B1 = pickPlace(p.x, p.z, 100, 600);
    var dp = doorPt(B1, 1.2);
    job = { kind: "courier", stage: "get", from: B1, dp: dp, earned: 0 };
    FC.emit("job:start", { id: "courier" });
    FC.markers.add({ id: "job", x: dp.x, z: dp.z, color: "#41e08c", icon: "📦", ring: 2.5, route: true });
    H().objective("Курьер: забери посылку в <b>" + esc(q(B1.name)) + "</b>");
    snd("blip");
  }
  function gotParcel() {
    var B1 = job.from, B2 = pickPlace(B1.x, B1.z, 250, 900, B1), dp = doorPt(B2, 1.2);
    var d = dist(job.dp.x, job.dp.z, dp.x, dp.z), what = PARCELS[Math.floor(R() * PARCELS.length)];
    job.stage = "deliver"; job.to = B2; job.dp = dp; job.dist = d; job.what = what;
    var T = Math.round(d / (P().mode === "car" ? 9 : 5.5) + 35);
    FC.markers.add({ id: "job", x: dp.x, z: dp.z, color: "#41e08c", icon: "🏁", ring: 2.5, route: true });
    H().objective("Курьер: доставь " + esc(what) + " в <b>" + esc(q(B2.name)) + "</b>");
    H().notify("Курьерская служба", "Забрал " + what + ". Адрес: " + q(B2.name) + ", " + (B2.addr || ""), "📦", 5);
    H().timer(T, "📦", function () {
      if (!job || job.kind !== "courier") return;
      H().toast("Посылка опоздала — заказ отменён", "bad", 3); snd("fail"); stop(true);
    });
    snd("blip");
  }
  function deliverParcel() {
    H().timer(null);
    var total = pay((60 + job.dist * 0.09) * lvlMult("courier"), "курьер");
    job.earned += total;
    addXp("courier");
    H().big("ДОСТАВЛЕНО", "+" + money(total) + " · " + job.to.name, "#41e08c", 3);
    snd("cash");
    FC.emit("job:done", { id: "courier", pay: total });
    var earned = job.earned;
    clearJobUI(); job = null;
    setTimeout(function () {
      if (job) return;
      startCourier(); if (job) job.earned = earned;
    }, 1600);
  }

  function updateJob(dt) {
    if (!job) return;
    var p = P();
    if (job.kind === "taxi") {
      if (job.stage === "pickup" && job.pax) {
        job.waitT -= dt;
        var d = dist(p.x, p.z, job.pax.x, job.pax.z);
        if (p.mode === "car" && d < 9) {
          if (speedOfCar() < 3) boardFare();
          else if (!job.slowHint) { job.slowHint = true; H().toast("Притормози у пассажира", "", 2); }
        }
        if (job.waitT <= 0) { H().toast("Пассажир уехал на другом такси", "bad"); FC.people.remove(job.pax); job.pax = null; job.series = 0; spawnFare(); }
      } else if (job.stage === "ride") {
        job.elapsed = (job.elapsed || 0) + dt;
        if (p.mode !== "car") {
          job.outT += dt;
          if (job.outT > 15) { H().toast("Пассажир не дождался и ушёл", "bad"); H().timer(null); FC.markers.remove("job"); job.series = 0; job.stage = "next"; setTimeout(spawnFare, 1500); }
        } else job.outT = 0;
        if (p.mode === "car" && dist(p.x, p.z, job.dp.x, job.dp.z) < 10 && speedOfCar() < 3.5) { job.elapsed = job.elapsed || 0; arriveFare(); }
      }
    } else if (job.kind === "courier") {
      var r = p.mode === "car" ? 7 : 3.2;
      if (dist(p.x, p.z, job.dp.x, job.dp.z) < r && !(FC.inside && FC.inside.active)) {
        if (job.stage === "get") gotParcel(); else if (job.stage === "deliver") deliverParcel();
      }
    }
  }

  /* ---- модальные окна: магазин, автосалон, банкомат, покупка бизнеса ------------------------------------------ */
  var modalOpen = null;
  function modal(icon, title, sub, render) {
    closeModal();
    var root = document.createElement("div"); root.className = "mg";
    root.innerHTML = "<div class='mg-card jb'><div class='mg-head'><span class='mg-ico'>" + icon + "</span><div><b>" + esc(title) + "</b><i>" + esc(sub || "") +
      "</i></div><button type='button' class='mg-x' aria-label='Закрыть'>✕</button></div><div class='mg-body' style='margin-top:12px'></div></div>";
    document.body.appendChild(root);
    var wasBusy = P() ? P().busy : false;
    if (FC.input) { FC.input.enable(false); FC.input.unlock(); }
    if (P()) P().busy = true;
    var body = root.querySelector(".mg-body");
    function onKey(e) { if (e.code === "Escape") { e.preventDefault(); closeModal(); } }
    modalOpen = { root: root, close: function () {
      global.removeEventListener("keydown", onKey, true);
      root.remove(); modalOpen = null;
      if (FC.input) FC.input.enable(true);
      if (P()) P().busy = wasBusy;
    } };
    root.querySelector(".mg-x").addEventListener("click", closeModal);
    root.addEventListener("click", function (e) { if (e.target === root) closeModal(); });
    global.addEventListener("keydown", onKey, true);
    function draw() { render(body, draw); }
    draw();
    snd("blip");
  }
  function closeModal() { if (modalOpen) modalOpen.close(); }
  function row(icon, title, sub, right, btn, attrs) {
    var side = (right ? "<div class='jp'>" + right + "</div>" : "") + (btn ? "<button type='button' class='jb-btn' " + (attrs || "") + ">" + esc(btn) + "</button>" : "");
    return "<div class='jb-row'><div class='ji'>" + icon + "</div><div class='jt'><b>" + esc(title) + "</b><i>" + esc(sub || "") + "</i></div>" +
      (side ? "<div class='jr'>" + side + "</div>" : "") + "</div>";
  }
  // «Шаурма «У Огонька»» → название уже в кавычках — вторые не нужны
  function q(name) { return /[«"]/.test(name) ? name : "«" + name + "»"; }

  // бодрость: +40% к бегу пешком — своим сдвигом поверх шага игрока (fmain держит скорость у себя)
  var boostUntil = 0;
  function boost(sec) {
    boostUntil = Math.max(boostUntil, performance.now()) + sec * 1000;
    H().toast("⚡ Бодрость " + sec + " с — бег быстрее", "ok", 2.5);
    FC.emit("buff", { id: "run", sec: sec });
  }
  var SHOP = [
    { id: "shawarma", icon: "🌯", name: "Шаурма", sub: "+35 здоровья", price: 15, act: function () { P().heal(35); } },
    { id: "coffee", icon: "☕", name: "Кофе", sub: "+10 здоровья и бодрость 30 с", price: 6, act: function () { P().heal(10); boost(30); } },
    { id: "energy", icon: "⚡", name: "Энергетик «Искра»", sub: "бег быстрее 60 с", price: 20, act: function () { boost(60); } },
    { id: "aid", icon: "🩹", name: "Аптечка", sub: "здоровье до максимума", price: 60, act: function () { P().heal(100); } },
    { id: "lotto", icon: "🎟️", name: "Лотерея «Огонёк»", sub: "выигрыш до $3 000", price: 25, act: lotto }
  ];
  function lotto() {
    var r = Math.random(), win = r < 0.015 ? 3000 : r < 0.2 ? 60 + Math.round(Math.random() * 34) * 10 : 0;
    if (win) { pay(win, "лотерея"); H().big(win >= 3000 ? "ДЖЕКПОТ!" : "ВЫИГРЫШ", "+" + money(win), "#ffd23f", 2.6); snd("cash"); }
    else H().toast("Пусто. Повезёт в другой раз 🎟️", "", 2);
  }
  function price(it) {
    var p = it.price;
    if (it.id === "shawarma" && perk("shawarma")) return 0;
    if (perk("barber")) p = Math.round(p * 0.8);
    return p;
  }
  function shop(B) {
    modal("🛒", (B && B.name) || "Магазин 24/7", "Еда, бодрость, лотерея", function (body, redraw) {
      body.innerHTML = "<div class='jb-list'>" + SHOP.map(function (it, i) {
        var p = price(it);
        return row(it.icon, it.name, it.sub, p ? money(p) : "даром", "Купить", "data-i='" + i + "'" + (FC.save.money < p ? " disabled" : ""));
      }).join("") + "</div><p class='jb-note'>Наличные: " + money(FC.save.money) + (perk("barber") ? " · скидка 20% как владельцу барбершопа" : "") +
        (perk("shawarma") ? " · шаурма за счёт заведения" : "") + "</p>";
      body.querySelectorAll(".jb-btn").forEach(function (b) {
        b.addEventListener("click", function () {
          var it = SHOP[+b.dataset.i], p = price(it);
          if (p && FC.money(-p, "магазин: " + it.name) === false) { H().toast("Не хватает наличных", "bad"); return; }
          snd("cash"); it.act(); redraw();
        });
      });
    });
  }

  // автосалон — весь ростер с ценой (fcarlist.js, FC.cars.info): марка-пародия, класс, максималка, разгон
  var CARS = [
    { type: "sedan", name: "Седан «Волна»", icon: "🚗", price: 2500, sub: "надёжный, для такси сойдёт" },
    { type: "taxi", name: "Такси «Шашки»", icon: "🚕", price: 3500, sub: "пассажиры садятся охотнее" },
    { type: "van", name: "Фургон «Курьер»", icon: "🚐", price: 5000, sub: "крепкий, держит удары" },
    { type: "bus", name: "Автобус «Агент-экспресс»", icon: "🚌", price: 14000, sub: "медленный, но огромный" },
    { type: "sport", name: "Спорткар «Искра GT»", icon: "🏎️", price: 22000, sub: "самый быстрый в городе" }
  ];
  function carsList() {
    if (!(FC.carList && FC.cars && FC.cars.info)) return CARS;
    var bar = function (v) { var n = Math.round(v * 5); return "▰▰▰▰▰".slice(0, n) + "▱▱▱▱▱".slice(0, 5 - n); };
    return FC.carList.shop().map(function (k) {
      var i = FC.cars.info(k);
      return { type: k, name: i.name, icon: i.icon, price: i.price, sub: i.cls + " · " + i.kmh + " км/ч · разгон " + bar(i.accel) + " · руль " + bar(i.handling) };
    });
  }
  var COLORS = ["#e63946", "#f1faee", "#1d3557", "#ffb703", "#2a9d8f", "#111111", "#c86bff", "#ff7a2f"];
  function carshop(B) {
    var color = COLORS[0], CARS = carsList();
    modal("🏎️", (B && B.name) || "Автосалон", "Купленная машина ждёт в гараже — подать из телефона", function (body, redraw) {
      body.innerHTML = "<div class='jb-sw'>" + COLORS.map(function (c) { return "<button type='button' data-c='" + c + "' style='background:" + c + "'" + (c === color ? " class='on'" : "") + "></button>"; }).join("") +
        "</div><div class='jb-list' style='margin-top:8px'>" + CARS.map(function (c, i) {
          var lv = FC.progress ? FC.progress.gate("car", c.price) : 0;          // уровень игрока (fprogress.js)
          return row(c.icon, c.name, c.sub, money(c.price), lv ? "🔒 ур. " + lv : "Купить", "data-i='" + i + "'" + (FC.save.money < c.price || lv ? " disabled" : ""));
        }).join("") + "</div><p class='jb-note'>В гараже: " + S().garage.length + " · наличные " + money(FC.save.money) + "</p>";
      body.querySelectorAll(".jb-sw button").forEach(function (b) { b.addEventListener("click", function () { color = b.dataset.c; redraw(); }); });
      body.querySelectorAll(".jb-list .jb-btn").forEach(function (b) {
        b.addEventListener("click", function () {
          var c = CARS[+b.dataset.i];
          if (FC.progress && FC.progress.gate("car", c.price)) { H().toast("Откроется с " + FC.progress.gate("car", c.price) + "-го уровня", "bad"); return; }
          if (FC.money(-c.price, "автосалон: " + c.name) === false) { H().toast("Не хватает наличных", "bad"); return; }
          S().garage.push({ type: c.type, color: color, name: c.name }); FC.dirty();
          snd("cash"); H().big("НОВАЯ МАШИНА", c.name, "#ffcf7a", 2.6);
          FC.emit("car:bought", { type: c.type, color: color });
          redraw();
        });
      });
    });
  }
  function deliverCar(i) {
    var c = S().garage[i];
    if (!c) return false;
    if (!FC.cars || !FC.cars.spawn) { H().toast("Машины в городе ещё не завели", "bad"); return false; }
    if (FC.inside && FC.inside.active) { H().toast("Выйди на улицу — машину подадут к тротуару", ""); return false; }
    var p = P(), L = M.nearestLane(p.x, p.z);
    if (!L) return false;
    var car = FC.cars.spawn(c.type, L.x, L.z, Math.atan2(L.dx, L.dz), { owned: true, color: c.color });
    FC.markers.add({ id: "mycar", x: L.x, z: L.z, color: "#7dffb0", icon: "🚗", ring: 0, route: false });
    setTimeout(function () { FC.markers.remove("mycar"); }, 25000);
    H().toast("🚗 " + c.name + " ждёт у тротуара", "ok", 3);
    FC.emit("car:delivered", { car: car || null, type: c.type });
    return true;
  }

  function bankBody(body, redraw) {
    var s = S();
    body.innerHTML = "<div class='jb-sum'><div><b>" + money(s.money) + "</b>наличные</div><div><b>" + money(s.bank) + "</b>на счёте</div></div>" +
      "<div class='jb-list'>" +
      row("⬇️", "Положить на счёт", "при задержании теряются только наличные", "", null) +
      "<div class='jb-row' style='justify-content:flex-end;gap:6px;flex-wrap:wrap'>" +
      [100, 1000, "all"].map(function (v) { return "<button type='button' class='jb-btn' data-dep='" + v + "'>" + (v === "all" ? "Всё" : money(v)) + "</button>"; }).join("") + "</div>" +
      row("⬆️", "Снять наличными", "", "", null) +
      "<div class='jb-row' style='justify-content:flex-end;gap:6px;flex-wrap:wrap'>" +
      [100, 1000, "all"].map(function (v) { return "<button type='button' class='jb-btn ghost' data-wd='" + v + "'>" + (v === "all" ? "Всё" : money(v)) + "</button>"; }).join("") + "</div></div>" +
      "<p class='jb-note'>Флейм-Банк: без комиссий, деньги на счёте в безопасности.</p>";
    body.querySelectorAll("[data-dep]").forEach(function (b) {
      b.addEventListener("click", function () {
        var v = b.dataset.dep === "all" ? FC.save.money : Math.min(+b.dataset.dep, FC.save.money);
        if (v <= 0) return;
        FC.money(-v, "на счёт"); S().bank += v; FC.dirty(); snd("cash"); redraw();
      });
    });
    body.querySelectorAll("[data-wd]").forEach(function (b) {
      b.addEventListener("click", function () {
        var v = b.dataset.wd === "all" ? S().bank : Math.min(+b.dataset.wd, S().bank);
        if (v <= 0) return;
        S().bank -= v; FC.money(v, "со счёта"); S().stats.earned -= v; FC.dirty(); snd("cash"); redraw();
      });
    });
  }
  function atm() { modal("🏧", "Банкомат Флейм-Банка", "Наличные и счёт", bankBody); }

  /* ---- бизнесы ------------------------------------------------------------------------------------------------ */
  var PERK = { shawarma: "шаурма в магазинах даром", carwash: "скидка в Перекраске", flowers: "+$20 чаевых в такси",
    barber: "−20% в магазинах", coffee: "+5 здоровья в час", studio: "+25% за смены в Монтажной", taxi: "+20% за такси", nightclub: "+5% за все смены" };
  function bizList() { return (M.pois || []).filter(function (B) { return B.poi === "biz" && B.biz; }); }
  function ownedOf(B) { return S().biz[B.biz.id] || null; }
  function cap(B) { return B.biz.income * 8; }
  function buy(B) {
    if (ownedOf(B)) return;
    if (FC.money(-B.biz.price, "покупка: " + B.name) === false) { H().toast("Нужно " + money(B.biz.price) + " наличными (есть банк — сними в банкомате)", "bad", 3.5); return; }
    S().biz[B.biz.id] = { safe: 0 }; FC.dirty();
    H().big("БИЗНЕС ТВОЙ", B.name + " · " + money(B.biz.income) + "/час", "#c86bff", 3.2);
    snd("mission");
    FC.emit("biz:buy", { B: B });
  }
  function collect(B) {
    var o = ownedOf(B); if (!o) return 0;
    var n = Math.floor(o.safe);
    if (n <= 0) { H().toast("Сейф пока пуст — доход каждый час", "", 2); return 0; }
    o.safe = 0; FC.dirty();
    pay(n, "выручка: " + B.name); snd("cash");
    H().toast("💰 " + B.name + ": +" + money(n), "ok", 2.5);
    return n;
  }
  function confirmBuy(B) {
    modal(B.emoji || "💼", B.name, "Продаётся · " + (B.addr || ""), function (body) {
      var o = ownedOf(B);
      body.innerHTML = "<div class='jb-sum'><div><b>" + money(B.biz.price) + "</b>цена</div><div><b>" + money(B.biz.income) + "</b>доход в час</div><div><b>" +
        Math.round(B.biz.price / B.biz.income) + " ч</b>окупаемость</div></div>" +
        "<div class='jb-list'>" + row("🎁", "Бонус владельцу", PERK[B.biz.id] || "", "", null) + row("🔒", "Сейф", "копит до 8 часов дохода — заходи забирать", "", null) + "</div>" +
        "<div style='text-align:center;margin-top:14px'>" + (o ? "<b>Уже твой</b>" : "<button type='button' class='mg-go' id='jb-buy'" + (FC.save.money < B.biz.price ? " disabled" : "") + ">Купить за " + money(B.biz.price) + "</button>") + "</div>" +
        "<p class='jb-note' style='text-align:center'>Наличные: " + money(FC.save.money) + "</p>";
      var b = body.querySelector("#jb-buy");
      if (b) b.addEventListener("click", function () { buy(B); closeModal(); });
    });
  }

  /* ---- точки на улице: бизнесы, банкоматы, (без интерьеров) магазин, автосалон, «Поработать» ----------------- */
  function sidePt(B, side, k) {
    var d = B.doors[k || 0];
    var lx = -d.nz, lz = d.nx;
    return { x: d.x + lx * 3.4 * side + d.nx * 0.3, z: d.z + lz * 3.4 * side + d.nz * 0.3 };
  }
  function noInterior() { return !(FC.inside && FC.inside.enter); }
  function registerPoints() {
    bizList().forEach(function (B) {
      var p = sidePt(B, 1);
      FC.interact.add({ id: "biz_" + B.biz.id, x: p.x, z: p.z, r: 2.3, key: "use", label: "",
        when: function () {
          var o = ownedOf(B);
          this.label = o ? "Сейф " + q(B.name) + ": забрать " + money(Math.floor(o.safe)) : "Купить " + q(B.name) + " за " + money(B.biz.price);
          return P().mode === "foot";
        },
        act: function () { if (ownedOf(B)) collect(B); else confirmBuy(B); } });
    });
    var atmAt = (M.pois || []).filter(function (B) { return B.poi === "bank" || B.poi === "store" || B.poi === "hotel"; });
    if (M.hq) atmAt.push(M.hq);
    atmAt.forEach(function (B, i) {
      var p = sidePt(B, -1);
      FC.interact.add({ id: "atm_" + i, x: p.x, z: p.z, r: 2, key: "use", label: "Банкомат", when: function () { return P().mode === "foot"; }, act: atm });
    });
    (M.pois || []).forEach(function (B, i) {
      if (B.poi === "store") {
        var p = sidePt(B, 1);
        FC.interact.add({ id: "shop_" + i, x: p.x, z: p.z, r: 2.2, key: "use", label: "Магазин 24/7: купить", when: function () { return noInterior() && P().mode === "foot"; }, act: function () { shop(B); } });
      }
      if (B.poi === "cars") {
        var q = sidePt(B, 1);
        FC.interact.add({ id: "cars_" + i, x: q.x, z: q.z, r: 2.4, key: "use", label: "Автосалон: выбрать машину", when: function () { return noInterior() && P().mode === "foot"; }, act: function () { carshop(B); } });
      }
    });
    var workAt = [];
    if (M.zones) Object.keys(M.zones).forEach(function (k) { if (k !== "queue") workAt.push(M.zones[k]); });
    if (M.hq) workAt.push(M.hq);
    workAt.forEach(function (B) {
      var p = sidePt(B, 1);
      FC.interact.add({ id: "work_" + B.id, x: p.x, z: p.z, r: 2.2, key: "use", label: "Поработать: " + B.name,
        when: function () { return noInterior() && P().mode === "foot" && !job; }, act: function () { work(B, { outside: true }); } });
    });
  }

  /* ---- телефон ----------------------------------------------------------------------------------------------- */
  function routeTo(B, color, icon) {
    var dp = doorPt(B, 2);
    FC.markers.add({ id: "wp", x: dp.x, z: dp.z, color: color || "#c86bff", icon: icon || "📍", route: true, ring: 0 });
    H().closePhone(); H().toast("Маршрут: " + q(B.name), "ok", 2);
  }
  function nearestWork() {
    var p = P(), best = null, bd = 1e18;
    if (M.zones) Object.keys(M.zones).forEach(function (k) { var B = M.zones[k], d = dist(B.x, B.z, p.x, p.z); if (k !== "queue" && d < bd) { bd = d; best = B; } });
    return best || M.hq;
  }
  function lvlRow(id, icon) {
    var x = xpOf(id), L = level(id), into = x - (L - 1) * 3;
    return "<div class='jb-row'><div class='ji'>" + icon + "</div><div class='jt'><b>" + JOB[id] + " · ур. " + L + "</b><i>оплата ×" + lvlMult(id).toFixed(2) +
      (L < 10 ? " · до уровня " + (3 - into) : " · максимум") + "</i><div class='jb-lv'><i style='width:" + (L >= 10 ? 100 : into / 3 * 100) + "%'></i></div></div></div>";
  }
  function appWork(b, ctl) {
    var cur = job ? "<div class='jb-row'><div class='ji'>" + (job.kind === "taxi" ? "🚕" : "📦") + "</div><div class='jt'><b>Сейчас: " + JOB[job.kind] + "</b><i>заработано " + money(job.earned || 0) +
      (job.series ? " · серия " + job.series : "") + "</i></div><button type='button' class='jb-btn ghost' id='w-stop'>Закончить</button></div>" : "";
    b.innerHTML = cur + "<h4>Работы</h4><div class='jb-list'>" +
      row("🗂️", "Смена агента", "заявки людей в зданиях-зонах: монтаж, фото, переводы", "", "Куда идти", "id='w-desk'") +
      row("🚕", "Такси", "нужна машина · серия поездок — ставка выше" + (perk("taxi") ? " · +20%" : ""), "", job && job.kind === "taxi" ? null : "Начать", "id='w-taxi'") +
      row("📦", "Курьер", "пешком или на колёсах, на время", "", job && job.kind === "courier" ? null : "Начать", "id='w-cour'") +
      "</div><h4>Уровни</h4><div class='jb-list'>" + lvlRow("desk", "🗂️") + lvlRow("taxi", "🚕") + lvlRow("courier", "📦") + "</div>";
    var s = b.querySelector("#w-stop"); if (s) s.addEventListener("click", function () { stop(); ctl.refresh(); });
    var d = b.querySelector("#w-desk"); if (d) d.addEventListener("click", function () { var B = nearestWork(); if (B) routeTo(B, "#ffcf7a", B.emoji); });
    var t = b.querySelector("#w-taxi"); if (t) t.addEventListener("click", function () { ctl.close(); startTaxi(); });
    var c = b.querySelector("#w-cour"); if (c) c.addEventListener("click", function () { ctl.close(); startCourier(); });
  }
  function appBiz(b, ctl) {
    var list = bizList(), own = list.filter(ownedOf);
    var perHour = own.reduce(function (a, B) { return a + B.biz.income; }, 0);
    var inSafes = own.reduce(function (a, B) { return a + Math.floor(ownedOf(B).safe); }, 0);
    b.innerHTML = "<div class='jb-sum'><div><b>" + own.length + "/" + list.length + "</b>точек</div><div><b>" + money(perHour) + "</b>в час</div><div><b>" + money(inSafes) + "</b>в сейфах</div></div>" +
      (inSafes > 0 ? "<button type='button' class='jb-btn' id='b-all' style='width:100%;margin-bottom:8px'>Забрать всё " + money(inSafes) + "</button>" : "") +
      "<div class='jb-list'>" + list.map(function (B, i) {
        var o = ownedOf(B);
        return o ? row(B.emoji, B.name, "сейф " + money(Math.floor(o.safe)) + " из " + money(cap(B)) + " · " + (PERK[B.biz.id] || ""), "", "Забрать", "data-c='" + i + "'" + (o.safe < 1 ? " disabled" : ""))
          : row(B.emoji, B.name, money(B.biz.income) + "/час · " + (PERK[B.biz.id] || ""), money(B.biz.price), "На карте", "data-m='" + i + "'");
      }).join("") + "</div><p class='jb-note'>Купить — у входа в бизнес (✋). Сейф копит до 8 часов дохода.</p>";
    var all = b.querySelector("#b-all");
    if (all) all.addEventListener("click", function () { own.forEach(function (B) { if (ownedOf(B).safe >= 1) collect(B); }); ctl.refresh(); });
    b.querySelectorAll("[data-c]").forEach(function (x) { x.addEventListener("click", function () { collect(list[+x.dataset.c]); ctl.refresh(); }); });
    b.querySelectorAll("[data-m]").forEach(function (x) { x.addEventListener("click", function () { routeTo(list[+x.dataset.m], "#c86bff", list[+x.dataset.m].emoji); }); });
  }
  function appBank(b) { bankBody(b, function () { appBank(b); }); }
  function appGarage(b, ctl) {
    var g = S().garage;
    b.innerHTML = (g.length ? "<div class='jb-list'>" + g.map(function (c, i) {
      var meta = CARS.filter(function (x) { return x.type === c.type; })[0] || {};
      return "<div class='jb-row'><div class='ji' style='background:" + c.color + "'>" + (meta.icon || "🚗") + "</div><div class='jt'><b>" + esc(c.name || meta.name || c.type) + "</b><i>в гараже</i></div><button type='button' class='jb-btn' data-i='" + i + "'>Подать</button></div>";
    }).join("") + "</div>" : "<p class='jb-note'>Гараж пуст. Машину можно купить в автосалоне «Искра Моторс» (Москва) — или просто угнать 😉</p>") +
      "<button type='button' class='jb-btn ghost' id='g-shop' style='width:100%;margin-top:10px'>Автосалон на карте</button>";
    b.querySelectorAll("[data-i]").forEach(function (x) { x.addEventListener("click", function () { if (deliverCar(+x.dataset.i)) ctl.close(); }); });
    b.querySelector("#g-shop").addEventListener("click", function () { var B = M.poi("cars"); if (B) routeTo(B, "#ff7a2f", "🏎️"); });
  }

  /* ---- карта: бизнесы (свои — зелёным) -------------------------------------------------------------------- */
  function mapLayer(c, k, mode) {
    bizList().forEach(function (B) {
      var o = ownedOf(B);
      c.strokeStyle = o ? "#7dffb0" : "#c86bff"; c.lineWidth = (mode === "big" ? 3 : 2.5) / k;
      c.beginPath(); c.arc(B.x, B.z, (mode === "big" ? 16 : 9) / k, 0, 7); c.stroke();
      if (mode === "big") {
        c.fillStyle = o ? "#7dffb0" : "#ffcf7a"; c.font = "700 " + (12 / k) + "px system-ui"; c.textAlign = "center";
        c.fillText(o ? "твой" : money(B.biz.price), B.x, B.z + 26 / k);
      }
    });
  }

  /* ---- система ------------------------------------------------------------------------------------------------ */
  FC.addSystem({
    name: "jobs", order: 50,
    init: function () {
      registerPoints();
      H().addApp({ id: "work", icon: "💼", name: "Работа", color: "#1d6f42", order: 10, render: appWork, badge: function () { return job ? "1" : ""; } });
      // приложение «Бизнес» с 22.11 — fbiz.js (бизнесы в своих зданиях; франшизы города — его раздел), здесь — без него
      if (!FC.biz) H().addApp({ id: "biz", icon: "🏪", name: "Бизнес", color: "#7c3aed", order: 11, render: appBiz,
        badge: function () { var n = bizList().filter(function (B) { var o = ownedOf(B); return o && o.safe >= B.biz.income; }).length; return n ? String(n) : ""; } });
      H().addApp({ id: "bank", icon: "🏦", name: "Банк", color: "#0f766e", order: 12, render: appBank });
      H().addApp({ id: "garage", icon: "🚗", name: "Гараж", color: "#b45309", order: 13, render: appGarage });
      H().addMapLayer(mapLayer);
    },
    update: function (dt) {
      updateJob(dt);
      // бодрость: добавочный шаг поверх движения игрока
      var p = P();
      if (p && boostUntil > performance.now() && p.mode === "foot" && !p.busy) {
        var nx = p.x + p.vx * dt * 0.4, nz = p.z + p.vz * dt * 0.4;
        var c = FC.inside && FC.inside.active && FC.inside.collide ? FC.inside.collide(nx, nz, 0.35) : M.collide(nx, nz, 0.35, { prev: p });
        p.x = c.x; p.z = c.z;
      }
    }
  });
  FC.on("hour", function () {
    var any = false;
    bizList().forEach(function (B) {
      var o = ownedOf(B); if (!o) return;
      o.safe = Math.min(cap(B), (o.safe || 0) + B.biz.income); any = true;
    });
    if (perk("coffee") && P()) P().heal(5);
    if (any) FC.dirty();
  });
  FC.on("car:enter", function () {
    if (job && job.kind === "taxi" && job.stage === "car") spawnFare();
  });
  FC.on("car:crash", function (e) {
    if (job && job.kind === "taxi" && job.stage === "ride" && (!e || (e.power || 0) > 2.5)) {
      job.crashes++;
      if (job.crashes === 1 || job.crashes % 3 === 0) H().toast("Пассажир: «Аккуратнее!» −8% к оплате", "bad", 2);
    }
  });
  function abort(why) { if (job) { H().toast(why, "bad", 3); stop(true); } closeModal(); }
  FC.on("busted", function () { abort("Работа сорвана — задержание"); });
  FC.on("wasted", function () { abort("Работа сорвана"); });

  FC.jobs = {
    work: work, shop: shop, carshop: carshop, atm: atm, startTaxi: startTaxi, startCourier: startCourier, stop: stop,
    buy: buy, collect: collect, confirmBuy: confirmBuy, deliverCar: deliverCar, boost: boost,
    level: level, perk: perk, active: function () { return job ? job.kind : null; }, gameFor: gameFor, businesses: bizList
  };
})(window);
