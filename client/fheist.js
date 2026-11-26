/* Флейм-Сити — ограбления (FC.heist): кассы 24/7 и заправок, ювелирный павильон «Огранка», уличные банкоматы,
 * инкассаторский фургон и БОЛЬШОЙ НАЛЁТ на Флейм-Банк (подготовки, подход, охрана с конусами взгляда, заложники,
 * дрель хранилища, мешки, погоня 4★, укрытие). Задача: «ограбления чтобы были — банки и т.д.».
 *
 * Оружие мультяшное (решение главной сессии): охрана «вырубается», крови нет.
 * Добыча — «грязные» деньги: пока не спрятал дома (FC.me.home) или не отмыл через свой бизнес, при аресте пропадает.
 * Деньги — только FC.money(сумма, "ограбление: …" | "налёт: …") (задание «заработай честно» их не считает).
 * События наружу: heist:done {kind: store|atm|jewelry|van|bank, take}, heist:start {kind}.
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE, M = FC.map, G = FC.gfx;

  /* ---- общее ------------------------------------------------------------------------------------------------ */
  function H() {
    var S = FC.save;
    if (!S.heist) S.heist = { dirty: 0, bounty: 0, cd: {}, total: 0, count: 0, tip: 0,
      bank: { prep: { car: false, card: false, scout: 0 }, approach: "quiet", level: 0, lastDay: -99, getaway: null } };
    return S.heist;
  }
  function P() { return FC.player; }
  function day() { return FC.clock.day; }
  function money(n) { return FC.fmtMoney(n); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(l) { return l[Math.floor(Math.random() * l.length)]; }
  function d2(a, b) { return FC.dist2(a.x, a.z, b.x, b.z); }
  function doorPt(B, out) { var d = B.doors[0]; out = out || 2.5; return { x: d.x + d.nx * out, z: d.z + d.nz * out, nx: d.nx, nz: d.nz }; }
  function stars() { return FC.police ? FC.police.stars : 0; }
  function addStars(n) {
    if (!FC.police || !n) return;
    var need = n - stars();
    if (need > 0) FC.police.add(need);
  }
  function snd(n, o) { if (FC.audio) FC.audio.play(n, o); }
  function fx(fn) { if (FC.fx && FC.fx[fn]) FC.fx[fn].apply(null, [].slice.call(arguments, 1)); }
  function pop(t, c, big) { if (FC.hud.popup) FC.hud.popup(t, { color: c, big: big }); else FC.hud.toast(t, "ok", 2); }
  function armed() {
    var a = FC.save.arsenal;
    return !!(a && a.cur && a.cur !== "fist");
  }
  function post(text, who) {
    if (FC.story && FC.story.post) FC.story.post({ id: "heist" + Date.now() + Math.random(), kind: "crime", cell: FC.people.SPECIAL.cop, who: who || "Флейм-Новости", text: text });
  }
  function street(x, z) { return FC.story && FC.story.streetAt ? FC.story.streetAt(x, z) : M.district(x, z).name; }
  function homeB() { return (FC.me && FC.me.home) || M.hq; }
  function cdOk(key) { var c = H().cd[key]; return c == null || day() > c; }
  function setCd(key) { H().cd[key] = day(); FC.dirty(); }

  FC.css([
    ".fh-pill{position:fixed;right:14px;top:calc(122px + env(safe-area-inset-top));background:rgba(40,12,24,.82);border:1px solid rgba(255,120,150,.45);",
    "  color:#ffd1dc;border-radius:12px;padding:4px 10px;font:700 13px system-ui;display:none;z-index:5;pointer-events:none;text-shadow:0 1px 2px #000}",
    ".fh-pill b{color:#fff}",
    ".fh-hold{position:fixed;left:50%;bottom:calc(110px + env(safe-area-inset-bottom));transform:translateX(-50%);width:min(320px,80vw);",
    "  background:rgba(12,16,32,.86);border:1px solid rgba(255,207,122,.35);border-radius:14px;padding:8px 12px;display:none;z-index:6;",
    "  font:700 13px system-ui;color:#fff;text-align:center;pointer-events:none}",
    ".fh-hold i{display:block;height:8px;margin-top:6px;border-radius:5px;background:rgba(255,255,255,.12);overflow:hidden}",
    ".fh-hold i b{display:block;height:100%;width:0;background:linear-gradient(90deg,#ffcf7a,#ff6b3d)}",
    ".fh-mg{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(5,8,18,.45);z-index:9;touch-action:none}",
    ".fh-mg.on{display:flex}",
    ".fh-card{width:min(420px,92vw);background:rgba(14,18,36,.96);border:1px solid rgba(255,207,122,.35);border-radius:20px;padding:16px;color:#fff;text-align:center;",
    "  font:600 14px system-ui;box-shadow:0 20px 60px rgba(0,0,0,.6)}",
    ".fh-card h3{margin:0 0 4px;font:800 20px Georgia,serif;color:#ffcf7a}.fh-card p{margin:0 0 10px;color:rgba(255,245,230,.75);font-size:13px}",
    ".fh-bar{position:relative;height:26px;border-radius:13px;background:rgba(255,255,255,.08);overflow:hidden;margin:10px 0}",
    ".fh-zone{position:absolute;top:0;bottom:0;background:rgba(80,255,150,.45)}",
    ".fh-needle{position:absolute;top:-2px;bottom:-2px;width:4px;margin-left:-2px;background:#fff;box-shadow:0 0 8px #fff}",
    ".fh-dots{font-size:22px;letter-spacing:6px;margin:4px 0}",
    ".fh-drill{width:150px;height:150px;margin:6px auto;border-radius:50%;display:grid;place-items:center;font:900 30px system-ui}",
    ".fh-heat{height:12px;border-radius:6px;background:rgba(255,255,255,.1);overflow:hidden;margin:8px 0}",
    ".fh-heat b{display:block;height:100%;width:0;background:linear-gradient(90deg,#41e08c,#ffd23f,#ff4d4d)}",
    ".fh-btn{display:block;width:100%;margin-top:8px;border:0;border-radius:14px;padding:13px;font:800 16px system-ui;cursor:pointer;",
    "  background:linear-gradient(90deg,#ffcf7a,#ff9b4a);color:#2a1205;touch-action:none;user-select:none;-webkit-user-select:none}",
    ".fh-btn.ghost{background:rgba(255,255,255,.1);color:#fff;font-size:13px;padding:9px}",
    ".fh-shake{animation:fhshake .3s}@keyframes fhshake{25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}",
    ".fh-board .card{margin-bottom:8px}.fh-board .ok{color:#7dffb0}.fh-board .no{color:#ff9aa8}",
    ".fh-board .row button{margin-left:6px}"
  ].join("\n"));

  /* ---- грязные деньги: пилюля в HUD, спрятать дома, отмыть через свой бизнес, потеря при аресте ------------------ */
  var pill = document.createElement("div"); pill.className = "fh-pill"; document.body.appendChild(pill);
  var pillTxt = "";
  function drawPill() {
    var h = H(), loot = run ? run.take : 0, sum = h.dirty + loot;
    var txt = sum > 0 ? "💼 грязные <b>" + money(sum) + "</b>" + (run && run.bags ? " · мешков " + run.bags : "") : "";
    if (txt === pillTxt) return;
    pillTxt = txt;
    pill.style.display = txt ? "" : "none";
    pill.innerHTML = txt;
  }
  function addDirty(n, kind) {
    n = Math.round(n);
    H().dirty += n; H().bounty += Math.round(n * 0.08); FC.dirty();
    pop("+" + money(n) + " в пакет", "#ff9ec0");
    snd("cash");
    drawPill();
    FC.emit("heist:loot", { kind: kind, n: n });
  }
  function stash(why) {
    var h = H(), n = h.dirty;
    if (!n) return;
    h.dirty = 0; FC.dirty();
    FC.money(n, "ограбление: " + (why || "добыча спрятана в укрытии"));
    FC.hud.big("ДОБЫЧА В УКРЫТИИ", "+" + money(n), "#7dffb0", 2.6);
    drawPill();
  }
  function launder(B) {
    var h = H(), n = h.dirty;
    if (!n) return;
    var fee = Math.round(n * 0.15);
    h.dirty = 0; FC.dirty();
    FC.money(n - fee, "ограбление: отмыто через «" + B.name.replace(/«|»/g, "") + "»");
    FC.hud.toast("🧺 Отмыто через бизнес: +" + money(n - fee) + " (комиссия " + money(fee) + ")", "ok", 3.5);
    drawPill();
  }
  FC.on("busted", function () {
    var h = H(), lost = h.dirty + (run ? run.take : 0);
    h.dirty = 0; FC.dirty();
    if (run) failRun("Задержан с добычей");
    if (lost) FC.hud.toast("🚓 Добыча " + money(lost) + " изъята", "bad", 3.5);
    drawPill();
  });
  FC.on("wasted", function () {
    var h = H(), lost = Math.round(h.dirty / 2);
    h.dirty -= lost; FC.dirty();
    if (run) failRun("Ты вырубился — мешки растащили");
    if (lost) FC.hud.toast("💸 Пока ты лежал, половину пакета растащили: −" + money(lost), "bad", 3.5);
    drawPill();
  });

  /* ---- действие с удержанием: прогресс, пока стоишь рядом ------------------------------------------------------ */
  var holdEl = document.createElement("div"); holdEl.className = "fh-hold"; holdEl.innerHTML = "<span></span><i><b></b></i>";
  document.body.appendChild(holdEl);
  var hold = null;
  function startHold(label, sec, at, r, done, opt) {
    hold = { label: label, t: 0, sec: sec, x: at.x, z: at.z, r: r || 3.2, done: done, opt: opt || {} };
    holdEl.querySelector("span").textContent = label;
    holdEl.style.display = "block";
  }
  function stepHold(dt) {
    if (!hold) return;
    var p = P();
    if (FC.dist2(p.x, p.z, hold.x, hold.z) > hold.r * hold.r || p.dead) {
      FC.hud.toast("Отошёл — не вышло", "bad", 1.6); hold = null; holdEl.style.display = "none";
      return;
    }
    hold.t += dt;
    holdEl.querySelector("b").style.width = Math.min(100, hold.t / hold.sec * 100) + "%";
    if (hold.opt.tick) hold.opt.tick(hold.t / hold.sec);
    if (hold.t >= hold.sec) { var h = hold; hold = null; holdEl.style.display = "none"; h.done(); }
  }

  /* ---- мини-игры без паузы мира (погоня продолжается!) -------------------------------------------------------- */
  var mg = document.createElement("div"); mg.className = "fh-mg"; document.body.appendChild(mg);
  var game = null;
  function openGame(html) {
    mg.innerHTML = "<div class='fh-card'>" + html + "</div>"; mg.classList.add("on");
    FC.input.enable(false); FC.input.unlock(); P().busy = true;
  }
  function closeGame() {
    mg.classList.remove("on"); mg.innerHTML = "";
    FC.input.enable(true); P().busy = false; game = null;
  }
  // «Вскрыть кассу»: стрелка ходит туда-сюда — жми, когда она в зелёной зоне; 3 попадания, 3 промаха — провал
  function gameRegister() {
    return new Promise(function (resolve) {
      openGame("<h3>💰 Вскрыть кассу</h3><p>Жми, когда стрелка в зелёном (пробел / E / кнопка)</p><div class='fh-dots'>○○○</div>" +
        "<div class='fh-bar'><div class='fh-zone'></div><div class='fh-needle'></div></div><button type='button' class='fh-btn'>ЖМИ</button>" +
        "<button type='button' class='fh-btn ghost'>бросить</button>");
      var zone = mg.querySelector(".fh-zone"), needle = mg.querySelector(".fh-needle"), dots = mg.querySelector(".fh-dots"), bar = mg.querySelector(".fh-bar");
      var g = { x: 0, dir: 1, sp: 0.75, hits: 0, miss: 0, z0: 0, zw: 0.2, t: 0 };
      function newZone() { g.zw = Math.max(0.11, 0.22 - g.hits * 0.04); g.z0 = rnd(0.08, 0.92 - g.zw); zone.style.left = g.z0 * 100 + "%"; zone.style.width = g.zw * 100 + "%"; }
      newZone();
      function press() {
        if (g.x >= g.z0 && g.x <= g.z0 + g.zw) { g.hits++; g.sp *= 1.25; snd("blip"); fx("haptic", "light"); newZone(); }
        else { g.miss++; snd("fail"); bar.classList.remove("fh-shake"); void bar.offsetWidth; bar.classList.add("fh-shake"); fx("haptic", "medium"); }
        dots.textContent = "●●●".slice(0, g.hits) + "○○○".slice(g.hits) + (g.miss ? "  ✗" + g.miss : "");
        if (g.hits >= 3) end(true); else if (g.miss >= 3) end(false);
      }
      function key(e) { if (e.code === "Space" || e.code === "KeyE" || e.code === "Enter") { e.preventDefault(); press(); } if (e.code === "Escape") end(false); }
      function end(ok) {
        if (g.done) return; g.done = true;
        global.removeEventListener("keydown", key); closeGame(); resolve({ ok: ok, ratio: ok ? Math.max(0.5, 1 - g.miss * 0.2 - g.t / 40) : 0 });
      }
      mg.querySelector(".fh-btn").addEventListener("pointerdown", function (e) { e.preventDefault(); press(); });
      mg.querySelector(".fh-btn.ghost").addEventListener("click", function () { end(false); });
      global.addEventListener("keydown", key);
      game = { step: function (dt) {
        g.t += dt; g.x += g.dir * g.sp * dt;
        if (g.x > 1) { g.x = 1; g.dir = -1; } if (g.x < 0) { g.x = 0; g.dir = 1; }
        needle.style.left = g.x * 100 + "%";
        if (g.t > 14) end(false);
      } };
    });
  }
  // «Дрель хранилища»: держи — сверлит и греется; перегрел — заклинило; отпусти — остывает
  function gameDrill(sec) {
    return new Promise(function (resolve) {
      openGame("<h3>🔩 Дрель хранилища</h3><p>Держи кнопку (или пробел) — сверлит. Красная полоса — перегрев: отпускай, чтобы остыла.</p>" +
        "<div class='fh-drill'>0%</div><div class='fh-heat'><b></b></div><div class='fh-st' style='min-height:18px;font-size:12px;color:#ffcf7a'></div>" +
        "<button type='button' class='fh-btn'>СВЕРЛИТЬ</button><button type='button' class='fh-btn ghost'>бросить</button>");
      var ring = mg.querySelector(".fh-drill"), heat = mg.querySelector(".fh-heat b"), st = mg.querySelector(".fh-st"), btn = mg.querySelector(".fh-btn");
      var g = { p: 0, h: 0, jam: 0, on: false, t: 0, sh: 0 };
      function setOn(v) { g.on = v; }
      function key(e) { if (e.code === "Space" || e.code === "KeyE") { e.preventDefault(); setOn(e.type === "keydown"); } if (e.code === "Escape") end(false); }
      function end(ok) {
        if (g.done) return; g.done = true;
        global.removeEventListener("keydown", key); global.removeEventListener("keyup", key);
        if (FC.audio) FC.audio.loop("skid", false);
        closeGame(); resolve({ ok: ok });
      }
      btn.addEventListener("pointerdown", function (e) { e.preventDefault(); setOn(true); });
      ["pointerup", "pointerleave", "pointercancel"].forEach(function (ev) { btn.addEventListener(ev, function () { setOn(false); }); });
      mg.querySelector(".fh-btn.ghost").addEventListener("click", function () { end(false); });
      global.addEventListener("keydown", key); global.addEventListener("keyup", key);
      game = { step: function (dt) {
        g.t += dt;
        if (g.jam > 0) { g.jam -= dt; st.textContent = "🔥 Заклинило! " + g.jam.toFixed(1) + " с"; g.h = Math.max(0.55, g.h - dt * 0.15); }
        else if (g.on) {
          g.p += dt / sec; g.h += dt * 0.42;
          if (g.h >= 1) { g.jam = 2.6; g.h = 1; snd("crash", { vol: 0.4 }); fx("haptic", "heavy"); }
          st.textContent = g.h > 0.75 ? "⚠ Горячо — отпусти!" : "Сверлю…";
          if ((g.sh -= dt) <= 0) { g.sh = 0.12; fx("haptic", "light"); }
        } else { g.h = Math.max(0, g.h - dt * 0.65); st.textContent = "Остывает"; }
        if (FC.audio) FC.audio.loop("skid", g.on && g.jam <= 0, { vol: 0.25 });
        var pc = Math.min(100, Math.round(g.p * 100));
        ring.textContent = pc + "%";
        ring.style.background = "conic-gradient(#ffcf7a " + pc * 3.6 + "deg, rgba(255,255,255,.08) 0)";
        heat.style.width = g.h * 100 + "%";
        if (g.p >= 1) end(true);
      } };
    });
  }

  /* ---- 1. кассы 24/7 и заправок: внутри, у продавца --------------------------------------------------------- */
  function robStore(B, cashier) {
    if (!cdOk("store" + B.id)) { FC.hud.toast("Касса пустая — инкассация уже была. Загляни завтра.", "", 2.5); return; }
    if (cashier && FC.guns_handsUp) FC.guns_handsUp(cashier, 6);             // продавец поднимает руки (поза у людей)
    var base = B.poi === "gas" ? rnd(120, 400) : rnd(180, 600);
    FC.emit("heist:start", { kind: "store" });
    function payout(ratio) {
      var take = Math.round(base * ratio);
      setCd("store" + B.id);
      addDirty(take, "store");
      FC.emit("crime", { type: "robbery", x: P().x, z: P().z });
      FC.hud.toast("🚨 Продавец жмёт тревожную кнопку — патруль через несколько секунд!", "bad", 3);
      setTimeout(function () { addStars(2); }, 5000);
      post("💰 Ограблена касса «" + B.name + "» на " + street(B.x, B.z) + ". Унесли " + money(take) + ".");
      FC.emit("heist:done", { kind: "store", take: take });
      H().count++;
    }
    if (armed()) {
      if (cashier) { FC.people.say(cashier, pick(["Не надо! Берите всё!", "Всё отдам, только без конфетти!", "Касса ваша, касса ваша!"]), 3); cashier.lean = 0.25; }
      startHold("💰 Деньги в пакет… стой рядом", 3.5, P(), 4, function () { if (cashier) cashier.lean = 0; payout(1); });
    } else {
      if (cashier) FC.people.say(cashier, "Эй, ты что делаешь?!", 2.5);
      gameRegister().then(function (r) {
        if (r.ok) payout(r.ratio);
        else { FC.hud.toast("Касса не поддалась — продавец вызывает патруль", "bad", 2.5); FC.emit("crime", { type: "assault", x: P().x, z: P().z }); addStars(1); }
      });
    }
  }

  /* ---- 2. ювелирный павильон «Огранка»: витрины на тротуаре ------------------------------------------------ */
  var JEWELS = [];
  (function placeJewels() {
    var cand = M.buildings.filter(function (B) { return B.shop && !B.poi && !B.zone && !B.title && (B.dist === "center" || B.dist === "msk" || B.dist === "ala") && B.w > 18; });
    cand.sort(function (a, b) { return FC.hash("jw" + a.id) - FC.hash("jw" + b.id); });
    var used = [];
    for (var i = 0; i < cand.length && JEWELS.length < 3; i++) {
      var B = cand[i];
      if (used.some(function (u) { return FC.dist2(u.x, u.z, B.x, B.z) < 400 * 400; })) continue;
      used.push(B);
      var d = B.doors[0], tx = -d.nz, tz = d.nx, cases = [];
      [-6.5, -4, 4, 6.5].forEach(function (off, k) {
        var x = d.x + d.nx * 0.6 + tx * off, z = d.z + d.nz * 0.6 + tz * off;
        if (M.onRoad(x, z)) return;
        cases.push({ x: x, z: z, k: k, broken: false });
      });
      JEWELS.push({ B: B, cases: cases, door: d });
    }
  })();
  var jewelGroup = new T.Group(); G.add(jewelGroup);
  (function buildJewels() {
    var glass = new T.MeshStandardMaterial({ color: 0xcfeaff, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.4 });
    var baseM = G.mat.std(0x2a2440, 0.4, 0.4);
    var gem = new T.MeshStandardMaterial({ color: 0x9ff3ff, emissive: 0x6bd5ff, emissiveIntensity: 1.2, roughness: 0.1 });
    var gold = new T.MeshStandardMaterial({ color: 0xffd36b, emissive: 0xffb02e, emissiveIntensity: 0.6, roughness: 0.2, metalness: 0.8 });
    JEWELS.forEach(function (J) {
      var ry = Math.atan2(J.door.nx, J.door.nz);
      J.cases.forEach(function (c) {
        var g = new T.Group();
        var b = new T.Mesh(new T.BoxGeometry(1.3, 0.9, 0.8), baseM); b.position.y = 0.6; g.add(b);
        var gl = new T.Mesh(new T.BoxGeometry(1.3, 0.6, 0.8), glass); gl.position.y = 1.35; g.add(gl);
        var item = new T.Mesh(c.k % 2 ? new T.OctahedronGeometry(0.16, 0) : new T.TorusGeometry(0.13, 0.04, 6, 14), c.k % 2 ? gem : gold);
        item.position.y = 1.3; g.add(item);
        g.position.set(c.x, 0.15, c.z); g.rotation.y = ry;
        c.mesh = g; c.glass = gl; c.item = item;
        jewelGroup.add(g);
        M.addProp(c.x, c.z, 0.7, "jewel");
      });
      var sign = new T.Mesh(new T.PlaneGeometry(9, 2.25), new T.MeshBasicMaterial({ map: G.tex.sign("ЮВЕЛИРНЫЙ «ОГРАНКА»", "💎", "#7b5cff") }));
      sign.position.set(J.door.x - J.door.nx * 0.7, 6.6, J.door.z - J.door.nz * 0.7); sign.rotation.y = ry;
      jewelGroup.add(sign);
    });
  })();
  function smash(J, c) {
    var first = !J.alarm;
    c.broken = true; c.glass.visible = false; c.item.visible = false;
    fx("burst", c.x, 1.3, c.z, "sparks", 18); fx("burst", c.x, 1.2, c.z, "debris", 10); fx("hitstop", 0.06, 0.1); fx("haptic", "medium");
    snd("crash", { vol: 0.6 });
    FC.cam.shake(0.25);
    var take = Math.round(rnd(320, 950));
    addDirty(take, "jewelry");
    J.take = (J.take || 0) + take;
    if (first) {
      J.alarm = true; setCd("jewel" + J.B.id);
      FC.emit("heist:start", { kind: "jewelry" });
      FC.emit("crime", { type: "robbery", x: c.x, z: c.z });
      FC.hud.big("СИГНАЛИЗАЦИЯ!", "Патруль будет через 45 секунд", "#ff5d6c", 2.4);
      FC.people.panic(c.x, c.z, 30, "punch");
      FC.hud.timer(45, "🚨", function () {
        addStars(FC.dist2(P().x, P().z, c.x, c.z) < 300 * 300 ? 3 : 2);
        finishJewel(J);
      });
    }
    if (J.cases.every(function (q) { return q.broken; })) { finishJewel(J); FC.hud.toast("Всё собрано — уходи, пока не приехал патруль!", "ok", 2.5); }
  }
  function finishJewel(J) {
    if (J.done) return;
    J.done = true;
    post("💎 Налёт на ювелирный «Огранка» (" + street(J.B.x, J.B.z) + "): разбиты витрины, ущерб " + money(J.take || 0) + ".");
    FC.emit("heist:done", { kind: "jewelry", take: J.take || 0 });
    H().count++;
  }
  FC.on("day", function () {
    JEWELS.forEach(function (J) { J.alarm = false; J.done = false; J.take = 0; J.cases.forEach(function (c) { c.broken = false; c.glass.visible = true; c.item.visible = true; }); });
  });

  /* ---- 3. уличные банкоматы у магазинов, заправок, банка, отеля ------------------------------------------- */
  var ATMS = [];
  (function placeAtms() {
    var body = G.mat.std(0x3a3f47, 0.5, 0.5), scr = new T.MeshStandardMaterial({ color: 0x2aabee, emissive: 0x2aabee, emissiveIntensity: 0.9 });
    var logo = new T.MeshStandardMaterial({ color: 0x2fbf71, emissive: 0x2fbf71, emissiveIntensity: 0.6 });
    M.pois.filter(function (B) { return ["store", "gas", "bank", "hotel", "hospital", "club"].indexOf(B.poi) >= 0; }).forEach(function (B, i) {
      var d = B.doors[0], tx = -d.nz, tz = d.nx, off = (i % 2 ? 3.4 : -3.4);
      var x = d.x - d.nx * 0.35 + tx * off, z = d.z - d.nz * 0.35 + tz * off;
      if (M.onRoad(x, z)) return;
      var g = new T.Group();
      var b = new T.Mesh(new T.BoxGeometry(0.8, 1.7, 0.55), body); b.position.y = 0.85; g.add(b);
      var s = new T.Mesh(new T.PlaneGeometry(0.5, 0.36), scr); s.position.set(0, 1.25, 0.28); g.add(s);
      var l = new T.Mesh(new T.BoxGeometry(0.8, 0.18, 0.56), logo); l.position.y = 1.72; g.add(l);
      g.position.set(x, 0.15, z); g.rotation.y = Math.atan2(d.nx, d.nz);
      jewelGroup.add(g);
      M.addProp(x, z, 0.45, "atm");
      ATMS.push({ id: "atm" + B.id, x: x + d.nx * 0.9, z: z + d.nz * 0.9, B: B, screen: s });
    });
  })();
  // витрины, вывески и банкоматы неподвижны (меняется только видимость стекла и камня): без автообновления матриц —
  // иначе three пересчитывал их ~120 матриц каждый кадр
  jewelGroup.traverse(function (o) { o.matrixAutoUpdate = false; o.updateMatrix(); });
  function hackAtm(A) {
    if (!cdOk(A.id)) { FC.hud.toast("Этот банкомат уже пустой. Завтра наполнят.", "", 2.2); return; }
    if (!FC.games) return;
    FC.emit("heist:start", { kind: "atm" });
    FC.games.run("hack", { title: "Взлом банкомата", sub: "Перекинь провода, пока не сработала защита" }).then(function (r) {
      if (!r || !r.ok) { FC.hud.toast("Банкомат пискнул и заблокировался", "bad", 2); if (Math.random() < 0.5) addStars(1); return; }
      var take = Math.round(rnd(200, 800) * Math.max(0.5, r.ratio || 1));
      setCd(A.id);
      fx("burst", A.x, 1.4, A.z, "cash", 26);
      addDirty(take, "atm");
      FC.emit("crime", { type: "atm_hack", x: A.x, z: A.z });
      if (Math.random() < 0.35) { FC.hud.toast("📡 Банкомат отправил тихий сигнал", "bad", 2.2); addStars(1); }
      FC.emit("heist:done", { kind: "atm", take: take });
      H().count++;
    });
  }

  /* ---- 4. инкассаторский фургон -------------------------------------------------------------------------- */
  var van = null;      // {car, born, stopped, opened, guards:[], bags:[], marker}
  var BANK = M.poi("bank");
  function spawnVan() {
    if (van || !FC.cars || !BANK) return;
    var dp = doorPt(BANK, 9), nl = M.nearestLane(dp.x, dp.z);
    if (!nl) return;
    var car = FC.cars.spawn("van", nl.x, nl.z, Math.atan2(nl.dx, nl.dz), { driver: "ai", color: 0x46523d });
    car.keep = true; car.armoredVan = true; car.hp = 140;
    if (FC.cars.toLane) FC.cars.toLane(car);
    van = { car: car, born: FC.clock.day * 24 + FC.clock.hour, hits: 0, stopped: false, opened: false, guards: [], bags: [], take: 0 };
    if (H().tip > 0) tipMarker();
  }
  function tipMarker() {
    if (!van || !FC.markers) return;
    van.marker = FC.markers.add({ id: "fh-van", x: van.car.x, z: van.car.z, color: "#ff9f1c", icon: "🚚", ring: 0, route: true });
  }
  function dropVan() {
    if (!van) return;
    if (FC.markers) FC.markers.remove("fh-van");
    van.guards.forEach(function (g) { FC.people.remove(g); });
    van.bags.forEach(function (b) { removePick(b); });
    if (!van.opened && van.car && !van.car.dead && FC.cars.remove) van.car.keep = false;
    van = null;
  }
  FC.on("hour", function (h) {
    if (!van && h % 4 === 2) spawnVan();
    if (van && !van.stopped && FC.clock.day * 24 + h - van.born > 5) dropVan();
  });
  FC.on("car:crash", function (e) {
    if (!van || van.stopped || !e) return;
    var c = van.car, pc = P().car;
    if (!pc || (e.car !== c && e.other !== c) || (e.car !== pc && e.other !== pc)) return;
    van.hits++;
    if (FC.cars.damage) FC.cars.damage(c, 6);
    fx("burst", c.x, 1, c.z, "sparks", 12);
    pop(van.hits < 3 ? "ТАРАН " + van.hits + "/3" : "ФУРГОН ВСТАЛ!", "#ff9f1c", van.hits >= 3);
    if (van.hits >= 3 || c.hp < 60) stopVan();
  });
  function stopVan() {
    var c = van.car;
    van.stopped = true;
    c.ai = null; c.driver = "none"; c.v = 0; c.vx = 0; c.vz = 0;
    FC.emit("heist:start", { kind: "van" });
    FC.emit("crime", { type: "robbery", x: c.x, z: c.z });
    FC.hud.objective("Вырубай охрану и вскрой <b>задние двери</b> фургона");
    var f = FC.cars.fwd ? FC.cars.fwd(c.heading) : { x: Math.sin(c.heading), z: Math.cos(c.heading) };
    [-1, 1].forEach(function (s) {
      var g = guard(c.x - f.z * s * 2.2, c.z + f.x * s * 2.2, null, null, true);
      FC.people.say(g, pick(["Стоять! Охрана!", "Руки от фургона!", "Это инкассация, отойди!"]), 2.5);
      van.guards.push(g);
    });
  }
  function openVan() {
    var c = van.car;
    van.opened = true;
    var f = FC.cars.fwd ? FC.cars.fwd(c.heading) : { x: Math.sin(c.heading), z: Math.cos(c.heading) };
    var bx = c.x - f.x * 3.6, bz = c.z - f.z * 3.6;
    fx("burst", bx, 1.2, bz, "cash", 30);
    addStars(3);
    for (var i = 0; i < 3; i++) {
      (function (k) {
        var val = Math.round(rnd(800, 1800));
        van.bags.push(addPick({ x: bx + (k - 1) * 1.1, z: bz + (k % 2) * 0.6, label: "💰 Мешок инкассации (" + money(val) + ")", act: function (pk) {
          removePick(pk); van.bags.splice(van.bags.indexOf(pk), 1); van.take += val; addDirty(val, "van");
          if (!van.bags.length) {
            post("🚚 Ограблен инкассаторский фургон на " + street(c.x, c.z) + ": похищено " + money(van.take) + ".");
            FC.emit("heist:done", { kind: "van", take: van.take });
            H().count++; H().tip = 0;
            FC.hud.objective("Оторвись от патруля и спрячь добычу дома 🏠");
            van.car.keep = false; if (FC.markers) FC.markers.remove("fh-van");
            var gs = van.guards;
            gs.forEach(function (g) { g.update = null; });
            setTimeout(function () { gs.forEach(function (g) { FC.people.remove(g); }); }, 30000);
            van = null;
          }
        } }));
      })(i);
    }
    FC.hud.objective("Хватай <b>мешки</b>!");
  }

  /* ---- охрана: патруль, конус взгляда, погоня, шокер ------------------------------------------------------- */
  var coneGeo = new T.CircleGeometry(8, 18, -Math.PI / 6, Math.PI / 3).rotateX(-Math.PI / 2);
  var coneMat = new T.MeshBasicMaterial({ color: 0xff3040, transparent: true, opacity: 0.18, depthWrite: false, side: T.DoubleSide });
  function guard(x, z, room, floor, hostile, wps) {
    var y = room != null && FC.inside.active ? FC.inside.floorY() : 0.15;
    var g = FC.people.make("npc", FC.people.SPECIAL.guard, x, z, { scale: 1.85, walk: 1.4, room: room, y: y, ground: y, alpha: 1,
      heistGuard: true, floor: floor, hostile: !!hostile, wps: wps || null, wi: 0, sus: 0, atkT: 0, heading: Math.random() * 6.28 });
    g.update = guardUpdate;
    if (room != null && run && run.quiet && !hostile) {
      g.cone = new T.Mesh(coneGeo, coneMat); G.add(g.cone);
    }
    return g;
  }
  function guardUpdate(g, dt) {
    var p = P();
    if (g.room != null) {                                  // внутри банка: живёт только на своём этаже
      var here = FC.inside.active && FC.inside.building && FC.inside.building.id === g.room && FC.inside.floor === g.floor;
      g.visible = here;
      if (g.cone) g.cone.visible = here && !g.down && !g.hostile && run && run.quiet && !run.alarm;
      if (!here) return;
    }
    // внутри «вырублен» — своё состояние: физика сбитых (fpeople) толкала бы охранника по стенам города
    if (g.down) { g.vx = g.vz = 0; g.speed = 0; return; }
    if (g.knocked > 0) return;
    var dx = p.x - g.x, dz = p.z - g.z, d = Math.hypot(dx, dz);
    if (g.hostile) {
      var sp = d > 1.4 ? 4.3 : 0;
      move(g, dx / (d || 1) * sp, dz / (d || 1) * sp, dt);
      g.heading = Math.atan2(dx, dz);
      g.atkT -= dt;
      if (d < 1.7 && g.atkT <= 0 && p.mode === "foot") {
        g.atkT = 1.25;
        p.damage(11, "shock");
        fx("flash", "rgba(120,180,255,.6)", 0.35); fx("haptic", "medium"); snd("punch");
        FC.people.say(g, pick(["Стоять!", "Ложись!", "Получай!", "Не уйдёшь!"]), 1.2);
      }
      return;
    }
    // патруль по точкам
    if (g.wps && g.wps.length) {
      var w = g.wps[g.wi % g.wps.length], wx = w.x - g.x, wz = w.z - g.z, wd = Math.hypot(wx, wz);
      if (wd < 0.8) { g.wi++; g.pause = rnd(1, 3); }
      if (g.pause > 0) { g.pause -= dt; g.vx = g.vz = 0; g.speed = 0; }
      else { move(g, wx / wd * 1.3, wz / wd * 1.3, dt); g.heading = FC.angDamp(g.heading, Math.atan2(wx, wz), 4, dt); }
    }
    // конус взгляда (только тихий налёт до тревоги)
    if (g.cone) { g.cone.position.set(g.x, g.y + 0.06, g.z); g.cone.rotation.y = g.heading; }
    if (run && run.quiet && !run.alarm && p.mode === "foot") {
      var ang = Math.abs(FC.angWrap(Math.atan2(dx, dz) - g.heading));
      if (d < 8 && ang < Math.PI / 6) {
        g.sus += dt * (d < 3 ? 2.4 : 1.2);
        if (g.sus > 0.35 && !g.saidQ) { g.saidQ = true; FC.people.say(g, "❓ Кто здесь?", 1.5); }
        if (g.sus >= 1) { FC.people.say(g, "❗ Тревога!", 2); raiseAlarm("Тебя заметила охрана"); }
      } else g.sus = Math.max(0, g.sus - dt * 0.6);
    }
  }
  function move(c, vx, vz, dt) {
    var nx = c.x + vx * dt, nz = c.z + vz * dt;
    var col = c.room != null && FC.inside.active ? FC.inside.collide(nx, nz, 0.35) : M.collide(nx, nz, 0.35, { prev: c, noProps: true });
    c.x = col.x; c.z = col.z; c.vx = vx; c.vz = vz; c.speed = Math.hypot(vx, vz);
  }

  /* ---- находки (мешки, ключ-карта): мешок на земле + взаимодействие ----------------------------------------- */
  var bagGeo = new T.SphereGeometry(0.38, 10, 8).scale(1, 0.85, 1), bagMat = G.mat.std(0x7d6a4a, 0.9);
  var picks = [], pseq = 0;
  function addPick(o) {
    o.id = "fh-pick" + (pseq++);
    o.y = o.room != null && FC.inside.active ? FC.inside.floorY() : 0.2;
    o.mesh = new T.Mesh(o.icon === "card" ? new T.BoxGeometry(0.4, 0.04, 0.26) : bagGeo, o.icon === "card" ? new T.MeshBasicMaterial({ color: 0x2aabee }) : bagMat);
    o.mesh.position.set(o.x, o.y + 0.32, o.z); G.add(o.mesh);
    o.floor = o.room != null && FC.inside.active ? FC.inside.floor : null;
    FC.interact.add({ id: o.id, x: o.x, z: o.z, r: 1.8, key: "use", label: o.label, room: o.room == null ? null : o.room, act: function () { o.act(o); },
      when: function () { return o.floor == null || FC.inside.floor === o.floor; } });
    picks.push(o);
    return o;
  }
  function removePick(o) {
    FC.interact.remove(o.id);
    if (o.mesh) G.scene.remove(o.mesh);
    var i = picks.indexOf(o); if (i >= 0) picks.splice(i, 1);
  }

  /* ---- 5. налёт на Флейм-Банк: подготовки --------------------------------------------------------------------- */
  var prep = null;        // текущая подготовка
  function prepStart(kind) {
    if (prep || run) { FC.hud.toast("Сначала закончи текущее дело", "bad", 2); return; }
    if (!BANK) return;
    var hb = H().bank;
    if (kind === "car") {
      var p = P(), a = Math.random() * 6.28, pt = { x: p.x + Math.cos(a) * 420, z: p.z + Math.sin(a) * 420 };
      pt.x = FC.clamp(pt.x, -1000, 1000); pt.z = FC.clamp(pt.z, -1000, 1000);
      var nl = M.nearestLane(pt.x, pt.z);
      var type = pick(["sport", "muscle", "sport"]);
      var car = FC.cars.spawn(type, nl.x, nl.z, Math.atan2(nl.dx, nl.dz), { parked: true, color: 0x101215 });
      car.keep = true;
      var gar = garagePt();
      prep = { kind: "car", car: car, gar: gar, stage: 0 };
      FC.markers.add({ id: "fh-prep", x: car.x, z: car.z, color: "#ffcf7a", icon: "🚗", ring: 3, route: true });
      FC.hud.objective("Подготовка: угони <b>чёрный " + (type === "muscle" ? "маслкар" : "спорткар") + "</b> для отхода");
      FC.hud.notify("Налётчик Шуруп", "Нам нужна быстрая тачка. Чёрная, без номеров — метка на карте.", "🕶️");
    } else if (kind === "card") {
      var dp = doorPt(BANK, 3), cafe = M.poi("store", BANK.x, BANK.z) || BANK;
      var mgr = FC.people.make("npc", FC.people.randomCell(), dp.x, dp.z, { scale: 1.8, walk: 1.5, alpha: 1 });
      mgr.update = managerUpdate; mgr.legs = [doorPt(BANK, 3), doorPt(cafe, 3)]; mgr.leg = 1; mgr.path = M.walkRoute(mgr.x, mgr.z, mgr.legs[1].x, mgr.legs[1].z);
      prep = { kind: "card", mgr: mgr };
      FC.markers.add({ id: "fh-prep", x: mgr.x, z: mgr.z, color: "#ffcf7a", icon: "💼", ring: 0, route: true });
      FC.hud.objective("Подготовка: проследи за <b>управляющим банка</b> и вырубить его — ключ-карта у него");
      FC.hud.notify("Налётчик Шуруп", "Управляющий ходит за кофе. Тихо догони и выруби — нужна его ключ-карта.", "🕶️");
      FC.people.say(mgr, "☕ Пора за кофе…", 3);
    } else if (kind === "scout") {
      prep = { kind: "scout", shots: {} };
      hb.prep.scout = 0; FC.dirty();
      FC.markers.add({ id: "fh-prep", x: doorPt(BANK).x, z: doorPt(BANK).z, color: "#ffcf7a", icon: "📷", ring: 3, route: true });
      FC.hud.objective("Подготовка: зайди во <b>Флейм-Банк</b> и сфотографируй камеру, пост охраны и хранилище (этаж −1)");
      FC.hud.notify("Налётчик Шуруп", "Сходи в банк как клиент. Три фото: камера у входа, охрана у лифта и дверь хранилища в подвале.", "🕶️");
    }
  }
  function prepDone(kind, text) {
    var hb = H().bank;
    if (kind === "scout") hb.prep.scout = 3; else hb.prep[kind] = true;
    FC.dirty();
    FC.markers.remove("fh-prep");
    clearScout();
    prep = null;
    FC.hud.objective("");
    FC.hud.big("ПОДГОТОВКА ГОТОВА", text, "#7dffb0", 2.6);
    snd("mission");
    if (prepReady()) FC.hud.notify("Налётчик Шуруп", "Всё готово. Выбирай подход в «Налётах» и начинаем.", "🕶️");
  }
  function prepReady() { var p = H().bank.prep; return p.car && p.card && p.scout >= 3; }
  function garagePt() {
    var best = null;
    M.near(BANK.x, BANK.z, 140).forEach(function (B) {
      if (B.prop || B.poi || B.zone || !B.doors) return;
      var dd = Math.hypot(B.x - BANK.x, B.z - BANK.z);
      if (dd > 50 && (!best || dd < best.d)) best = { B: B, d: dd };
    });
    var B = best ? best.B : BANK, dp = doorPt(B, 4);
    var nl = M.nearestLane(dp.x, dp.z);
    return nl ? { x: nl.x, z: nl.z } : dp;
  }
  // Пока сбитый лежит, fpeople не зовёт его update — удар ловим событием ped:hit
  FC.on("ped:hit", function (e) {
    var ch = e && e.ch;
    if (!ch) return;
    if (prep && prep.kind === "card" && prep.mgr === ch && !ch.dropped) {
      ch.dropped = true; ch.knocked = 60;
      FC.markers.remove("fh-prep");
      setTimeout(function () {
        addPick({ x: ch.x + 0.8, z: ch.z, icon: "card", label: "💳 Забрать ключ-карту управляющего", act: function (pk) {
          removePick(pk); FC.people.remove(ch); prepDone("card", "Ключ-карта хранилища у тебя");
        } });
      }, 600);
      FC.hud.objective("Подбери <b>ключ-карту</b>");
    }
    if (ch.heistGuard && ch.room == null && !ch.downLong) {            // охрана фургона лежит долго
      ch.downLong = true; ch.knocked = 40;
      if (run) run.knocked++;
      pop("ОХРАНА ВЫРУБЛЕНА", "#ffcf7a");
    }
  });
  function managerUpdate(ch, dt) {
    if (ch.knocked > 0) return;
    if (!ch.path || !ch.path.length) {
      ch.leg = 1 - ch.leg; ch.path = M.walkRoute(ch.x, ch.z, ch.legs[ch.leg].x, ch.legs[ch.leg].z);
      FC.people.say(ch, ch.leg ? "☕ За кофе…" : "📊 Обратно к отчётам", 2.5);
      return;
    }
    var t = ch.path[0], dx = t.x - ch.x, dz = t.z - ch.z, d = Math.hypot(dx, dz);
    if (d < 0.8) { ch.path.shift(); return; }
    move(ch, dx / d * 1.5, dz / d * 1.5, dt);
    var m = FC.markers.all["fh-prep"];
    if (m) { m.x = ch.x; m.z = ch.z; if (m.obj) m.obj.position.set(ch.x, 0, ch.z); }
  }
  // разведка: точки фото на этажах банка
  var scoutIds = [];
  function clearScout() { scoutIds.forEach(function (id) { FC.interact.remove(id); }); scoutIds = []; }
  function scoutFloor(B, floor, spots) {
    clearScout();
    if (!prep || prep.kind !== "scout" || !spots) return;
    var pts = [];
    if (floor === 0) {
      if (spots.exits && spots.exits[0]) pts.push(["cam", "📷 Сфотографировать камеру у входа", spots.exits[0]]);
      if (spots.elevator) pts.push(["guard", "📷 Сфотографировать пост охраны", spots.elevator]);
    } else if (floor === -1 && spots.marks && spots.marks.safe) pts.push(["vault", "📷 Сфотографировать дверь хранилища", spots.marks.safe]);
    pts.forEach(function (q) {
      if (prep.shots[q[0]]) return;
      var id = "fh-scout-" + q[0];
      scoutIds.push(id);
      FC.interact.add({ id: id, x: q[2].x + 1.2, z: q[2].z + 1.2, r: 3.2, key: "use", label: q[1], room: B.id, act: function () {
        prep.shots[q[0]] = true; FC.interact.remove(id);
        fx("flash", "#fff", 0.7); snd("blip");
        var n = Object.keys(prep.shots).length;
        H().bank.prep.scout = n; FC.dirty();
        pop("📷 " + n + "/3", "#ffcf7a");
        if (n >= 3) prepDone("scout", "Охрана и камеры на снимках");
      } });
    });
  }

  /* ---- 5. налёт на Флейм-Банк: сам налёт -------------------------------------------------------------------- */
  var run = null;          // {stage, quiet, alarm, bags, take, knocked, guardsBy:{floor:[]}, getaway}
  function canStart() {
    var hb = H().bank;
    if (run || prep) return "Сначала закончи текущее дело";
    if (!prepReady()) return "Не все подготовки готовы";
    if (day() <= hb.lastDay) return "Банк ещё на усиленной охране — завтра";
    if (stars() > 0) return "Сначала оторвись от патруля";
    return null;
  }
  function startRun(approach) {
    var why = canStart();
    if (why) { FC.hud.toast(why, "bad", 2.5); return; }
    var hb = H().bank;
    hb.approach = approach; FC.dirty();
    run = { stage: "go", quiet: approach === "quiet", alarm: false, bags: 0, take: 0, knocked: 0, guardsBy: {}, spotted: false, vaultOpen: false };
    // машина для отхода — у банка
    var dp = doorPt(BANK, 9), nl = M.nearestLane(dp.x, dp.z), gw = hb.getaway || { type: "sport", color: 0x101215 };
    if (nl) { run.getaway = FC.cars.spawn(gw.type, nl.x, nl.z, Math.atan2(nl.dx, nl.dz), { owned: true, color: gw.color }); run.getaway.keep = true; }
    FC.markers.add({ id: "fh-run", x: doorPt(BANK).x, z: doorPt(BANK).z, color: "#ff5d6c", icon: "🏦", ring: 3, route: true });
    FC.hud.big("НАЛЁТ: ФЛЕЙМ-БАНК", run.quiet ? "Тихо: не попадайся охране" : "Громко: время пошло", "#ff9f1c", 3);
    FC.hud.objective("Войди во <b>Флейм-Банк</b>" + (run.quiet ? " — тихо, обходи красные конусы охраны" : ""));
    FC.emit("heist:start", { kind: "bank" });
    snd("mission");
  }
  function guardsForFloor(B, floor, spots) {
    if (run.guardsBy[floor]) return;
    var lvl = H().bank.level, n = floor < 0 ? Math.min(3, 1 + lvl) : Math.min(5, 2 + lvl);
    var pts = [];
    if (spots) {
      (spots.exits || []).forEach(function (e) { pts.push({ x: e.x, z: e.z }); });
      if (spots.elevator) pts.push({ x: spots.elevator.x, z: spots.elevator.z });
      (spots.seats || []).slice(0, 8).forEach(function (s) { pts.push({ x: s.x, z: s.z }); });
      if (spots.marks && spots.marks.safe) pts.push({ x: spots.marks.safe.x, z: spots.marks.safe.z });
    }
    if (pts.length < 2) pts = [{ x: B.x - B.w / 4, z: B.z }, { x: B.x + B.w / 4, z: B.z }, { x: B.x, z: B.z - B.d / 4 }];
    var list = [];
    for (var i = 0; i < n; i++) {
      var wps = [pts[i % pts.length], pts[(i * 3 + 1) % pts.length], pts[(i * 5 + 2) % pts.length]].map(function (q) { return { x: q.x + rnd(-1.2, 1.2), z: q.z + rnd(-1.2, 1.2) }; });
      var g = guard(wps[0].x, wps[0].z, B.id, floor, !run.quiet || run.alarm, wps);
      list.push(g);
    }
    run.guardsBy[floor] = list;
  }
  function hostagesDown(B) {
    FC.people.all.forEach(function (c) {
      if (c.room !== B.id || c.heistGuard || c.kind === "player" || c.hostage) return;
      c.hostage = true; c.lean = (c.face || 1) * 1.45; c.sit = true;     // фигурки пригибаются (lean), 3D-человечки садятся (sit)
      if (Math.random() < 0.4) FC.people.say(c, pick(["😱 Не трогайте нас!", "Лежу, лежу!", "Только без конфетти!", "Мама…"]), 2.5);
    });
  }
  function raiseAlarm(why) {
    if (!run || run.alarm) return;
    run.alarm = true;
    if (why) run.spotted = true;
    FC.hud.big("ТРЕВОГА!", why || "Сигнализация банка", "#ff5d6c", 2.4);
    fx("flash", "rgba(255,40,60,.45)", 0.5); fx("haptic", "heavy");
    snd("wanted");
    Object.keys(run.guardsBy).forEach(function (f) { run.guardsBy[f].forEach(function (g) { g.hostile = true; if (g.cone) g.cone.visible = false; }); });
    if (FC.inside.active && FC.inside.building === BANK) hostagesDown(BANK);
    addStars(2);
  }
  FC.on("inside:floor", function (e) {
    if (!e || !BANK || e.building !== BANK) return;
    scoutFloor(e.building, e.floor, e.spots);
    if (!run) return;
    guardsForFloor(e.building, e.floor, e.spots);
    if (e.floor === 0 && run.stage === "go") {
      run.stage = "inside";
      FC.markers.remove("fh-run");
      if (!run.quiet) {
        FC.hud.big("ВСЕ НА ПОЛ!", "Это ограбление!", "#ff9f1c", 2.4);
        fx("hitstop", 0.12, 0.1);
        raiseAlarm(null);
      } else hostagesDown(BANK);
      FC.hud.objective("Спустись в <b>хранилище</b>: лифт или лестница, этаж −1" + (run.quiet ? " · обходи конусы и вырубай охрану сзади (E)" : ""));
    }
    if (e.floor === -1 && run.stage === "inside") {
      run.stage = "vault";
      FC.hud.objective(run.quiet ? "Ключ-карта управляющего готова — вскрой <b>сейф</b> (E у двери хранилища)" : "Вскрой <b>сейф</b> дрелью (E у двери хранилища)");
    }
  });
  FC.on("inside:safe", function (e) {
    if (!run || !e || e.building !== BANK || run.vaultOpen || run.drilling) return;
    run.drilling = true;
    if (run.quiet) FC.hud.toast("💳 Ключ-карта приложена — осталась механическая защита", "ok", 2.5);
    gameDrill(run.quiet ? 12 : 16).then(function (r) {
      run.drilling = false;
      if (!r.ok) { FC.hud.toast("Дрель брошена — сейф ещё закрыт", "bad", 2); return; }
      openVault();
    });
  });
  function openVault() {
    run.vaultOpen = true;
    var sp = FC.inside.spots, at = sp && sp.marks && sp.marks.safe ? sp.marks.safe : { x: P().x, z: P().z };
    fx("burst", at.x, FC.inside.floorY() + 1.2, at.z, "cash", 40); fx("hitstop", 0.15, 0.15); FC.cam.shake(0.4);
    FC.hud.big("ХРАНИЛИЩЕ ОТКРЫТО", "Хватай мешки — каждый замедляет бег", "#7dffb0", 2.6);
    if (!run.alarm) raiseAlarm(null);                   // хранилище всегда поднимает тревогу; «тишина» — если до этого не заметили
    var lvl = H().bank.level, n = Math.min(6, 4 + lvl);
    for (var i = 0; i < n; i++) {
      (function (k) {
        var val = Math.round(rnd(5500, 9000) * (1 + lvl * 0.2));
        var a = k / n * Math.PI - Math.PI / 2;
        addPick({ x: at.x + Math.cos(a) * 2.2, z: at.z - 1.6 + Math.sin(a) * 1.2, room: BANK.id, label: "💰 Мешок хранилища (" + money(val) + ")", act: function (pk) {
          if (run.bags >= 4) { FC.hud.toast("Больше 4 мешков не унести", "bad", 2); return; }
          removePick(pk);
          run.bags++; run.take += val;
          P().speedMul = Math.max(0.55, 1 - run.bags * 0.11);
          pop("+1 мешок · " + money(run.take), "#7dffb0");
          snd("cash"); fx("haptic", "light");
          drawPill();
        } });
      })(i);
    }
    run.stage = "loot";
    FC.hud.objective("Хватай <b>мешки</b> (до 4) и уходи к машине 🚗");
  }
  FC.on("inside:exit", function (e) {
    clearScout();
    if (!run || !e || e.building !== BANK) return;
    if (run.bags > 0 && run.stage === "loot") {
      run.stage = "escape";
      addStars(4);
      picks.slice().forEach(function (pk) { if (pk.room === BANK.id) removePick(pk); });
      if (run.getaway) FC.markers.add({ id: "fh-car", x: run.getaway.x, z: run.getaway.z, color: "#ffcf7a", icon: "🚗", ring: 2.5 });
      var hd = doorPt(homeB());
      FC.markers.add({ id: "fh-home", x: hd.x, z: hd.z, color: "#7dffb0", icon: "🏠", ring: 4, route: true });
      FC.hud.objective("Оторвись от патруля и довези мешки в <b>укрытие 🏠</b>");
      post("🏦 Налёт на Флейм-Банк! Грабители вынесли " + run.bags + " мешков. Патруль перекрывает Центр.");
    }
  });
  function finishRun() {
    var hb = H().bank, base = run.take;
    var quietB = run.quiet && !run.spotted ? Math.round(base * 0.25) : 0;
    var koB = run.knocked * 400;
    var total = base + quietB + koB;
    FC.money(total, "налёт: Флейм-Банк");
    hb.level++; hb.lastDay = day(); hb.prep.card = false; hb.prep.scout = 0; FC.dirty();
    H().total += total; H().count++; H().bounty += Math.round(total * 0.05);
    FC.hud.big("НАЛЁТ ЗАВЕРШЁН", "+" + money(total), "#7dffb0", 4);
    FC.hud.dialog([
      { who: "Налётчик Шуруп", face: "🕶️", text: "Мешки: " + money(base) + (quietB ? " · бонус за тишину: +" + money(quietB) : "") + (koB ? " · охрана вырублена ×" + run.knocked + ": +" + money(koB) : "") + "." },
      { who: "Налётчик Шуруп", face: "🕶️", text: "Итого " + money(total) + ". Банк усилит охрану — следующий налёт сложнее, но жирнее. Ключ-карту и разведку придётся добыть заново." }
    ]);
    fx("burst", P().x, 1.5, P().z, "confetti", 70);
    post("🕶️ Банда налётчиков снова на свободе: «дело века» во Флейм-Банке так и не раскрыто.");
    FC.emit("heist:done", { kind: "bank", take: total });
    endRun();
  }
  function failRun(why) {
    if (!run) return;
    FC.hud.big("НАЛЁТ ПРОВАЛЕН", why || "", "#ff5d6c", 3);
    endRun();
  }
  function endRun() {
    if (!run) return;
    Object.keys(run.guardsBy).forEach(function (f) { run.guardsBy[f].forEach(function (g) { if (g.cone) G.scene.remove(g.cone); FC.people.remove(g); }); });
    picks.slice().forEach(function (pk) { if (pk.room === BANK.id) removePick(pk); });
    ["fh-run", "fh-car", "fh-home"].forEach(function (id) { FC.markers.remove(id); });
    if (run.getaway) run.getaway.keep = false;
    FC.people.all.forEach(function (c) { if (c.hostage) { c.hostage = false; c.lean = 0; c.sit = false; } });
    P().speedMul = 1;
    FC.hud.objective("");
    run = null;
    drawPill();
  }

  /* ---- взаимодействия: касса, витрины, банкоматы, фургон, охрана, укрытие, отмыв --------------------------------- */
  FC.on("start", function () {
    FC.interact.provider(function (px, pz, room) {
      var out = [], p = P();
      if (p.busy) return null;
      // касса 24/7 / заправки — внутри, у ближайшего продавца
      if (room != null && FC.inside.active) {
        var B = FC.inside.building;
        if ((B.poi === "store" || B.poi === "gas") && FC.inside.floor === 0) {
          var best = null, bd = 3.4 * 3.4;
          FC.people.all.forEach(function (c) { if (c.room === B.id && c.kind !== "player" && !c.heistGuard && !c.realAgent) { var d = FC.dist2(c.x, c.z, px, pz); if (d < bd) { bd = d; best = c; } } });
          var arm = armed();
          if (best && (arm || bd < 2.2 * 2.2)) out.push({ id: "fh-store", x: arm ? px : best.x, z: arm ? pz : best.z, r: 3.4, room: room, key: "use",
            label: (armed() ? "🎯 Ограбить кассу (оружие в руках)" : "💰 Вскрыть кассу") + (cdOk("store" + B.id) ? "" : " · пусто"), act: function () { robStore(B, best); } });
        }
        // охрана банка: вырубить сзади (тихо) или в лоб (громко)
        if (run && B === BANK) {
          (run.guardsBy[FC.inside.floor] || []).forEach(function (g) {
            if (g.down || g.knocked > 0 || FC.dist2(g.x, g.z, px, pz) > 1.8 * 1.8) return;
            out.push({ id: "fh-ko-" + g.id, x: g.x, z: g.z, r: 1.8, room: room, key: "use", label: "🤜 Вырубить охранника", act: function () { takedown(g); } });
          });
        }
        return out;
      }
      if (room != null) return null;
      // витрины ювелирного
      JEWELS.forEach(function (J) {
        J.cases.forEach(function (c) {
          if (c.broken || FC.dist2(c.x, c.z, px, pz) > 2.2 * 2.2) return;
          if (!cdOk("jewel" + J.B.id) && !J.alarm) return;
          out.push({ id: "fh-jw" + J.B.id + "_" + c.k, x: c.x, z: c.z, r: 2.2, key: "use", label: "💎 Разбить витрину", act: function () { smash(J, c); } });
        });
      });
      // банкоматы
      ATMS.forEach(function (A) {
        if (FC.dist2(A.x, A.z, px, pz) > 1.9 * 1.9) return;
        out.push({ id: "fh-" + A.id, x: A.x, z: A.z, r: 1.9, key: "use", label: "🏧 Взломать банкомат" + (cdOk(A.id) ? "" : " · пусто"), act: function () { hackAtm(A); } });
      });
      // фургон: двери и охрана
      if (van && van.stopped && !van.opened && p.mode === "foot") {
        var c = van.car, f = FC.cars.fwd ? FC.cars.fwd(c.heading) : { x: Math.sin(c.heading), z: Math.cos(c.heading) };
        var rx = c.x - f.x * 3.2, rz = c.z - f.z * 3.2;
        if (FC.dist2(rx, rz, px, pz) < 2.6 * 2.6) {
          var up = van.guards.filter(function (g) { return !(g.knocked > 0); }).length;
          out.push({ id: "fh-vandoor", x: rx, z: rz, r: 2.6, key: "use", label: up ? "🔒 Двери: сначала вырубай охрану (" + up + ")" : "🔓 Вскрыть задние двери",
            act: function () { if (!up) startHold("🔓 Вскрываю двери…", armed() ? 2.5 : 4, { x: rx, z: rz }, 3, openVan, { tick: function () { if (Math.random() < 0.1) fx("burst", rx, 1.2, rz, "sparks", 3); } }); } });
        }
      }
      // укрытие: дом игрока; отмыв: свои бизнесы
      var hb = homeB(), hd = hb && doorPt(hb, 1);
      if (hd && FC.dist2(hd.x, hd.z, px, pz) < 3.5 * 3.5) {
        if (run && run.stage === "escape") out.push({ id: "fh-homerun", x: hd.x, z: hd.z, r: 3.5, key: "use", label: stars() ? "🏠 Сначала оторвись от патруля" : "🏠 Сложить мешки в укрытие", act: function () { if (!stars()) finishRun(); } });
        else if (H().dirty > 0) out.push({ id: "fh-stash", x: hd.x, z: hd.z, r: 3.5, key: "use", label: stars() ? "🏠 Спрятать добычу — сначала оторвись" : "🏠 Спрятать добычу (" + money(H().dirty) + ")", act: function () { if (!stars()) stash(); } });
      }
      if (H().dirty > 0 && FC.save.biz) {
        M.pois.forEach(function (B) {
          if (B.poi !== "biz" || !B.biz || !FC.save.biz[B.biz.id]) return;
          var d = doorPt(B, 1);
          if (FC.dist2(d.x, d.z, px, pz) > 3 * 3) return;
          out.push({ id: "fh-lnd" + B.id, x: d.x, z: d.z, r: 3, key: "use", label: "🧺 Отмыть добычу через «" + B.name.replace(/«|»/g, "") + "» (−15%)", act: function () { if (stars()) FC.hud.toast("Сначала оторвись от патруля", "bad", 2); else launder(B); } });
        });
      }
      return out;
    });
  });
  function takedown(g) {
    if (run && run.quiet && !run.alarm && !g.hostile) {
      var p = P(), ang = Math.abs(FC.angWrap(Math.atan2(p.x - g.x, p.z - g.z) - g.heading));
      if (ang < Math.PI / 3 && g.sus > 0.4) { raiseAlarm("Охранник успел заметить"); return; }
    }
    if (g.room != null) { g.down = true; g.sit = true; g.lean = (g.face || 1) * 1.5; if (g.cone) g.cone.visible = false; if (run) run.knocked++; FC.people.say(g, "💫", 3); }
    else FC.people.hit(g, Math.sin(P().heading) * 4, Math.cos(P().heading) * 4, 6);
    fx("hitstop", 0.09, 0.05); fx("haptic", "medium"); fx("burst", g.x, g.y + 1.2, g.z, "sparks", 10);
    snd("punch"); FC.cam.shake(0.25);
    pop("ОХРАНА ВЫРУБЛЕНА", "#ffcf7a");
  }

  /* ---- подготовка «машина»: посадка и гараж ------------------------------------------------------------------- */
  FC.on("car:enter", function (e) {
    if (prep && prep.kind === "car" && e && e.car === prep.car && prep.stage === 0) {
      prep.stage = 1;
      FC.markers.add({ id: "fh-prep", x: prep.gar.x, z: prep.gar.z, color: "#ffcf7a", icon: "🅿️", ring: 4, route: true });
      FC.hud.objective("Отгони машину в <b>гараж у банка</b>" + (stars() ? " — и не притащи хвост" : ""));
    }
  });

  /* ---- кадр --------------------------------------------------------------------------------------------------- */
  var t1 = 0;
  FC.addSystem({
    name: "heist", order: 56,
    update: function (dt) {
      if (game) game.step(dt);
      stepHold(dt);
      var p = P(); if (!p) return;
      t1 -= dt;
      // метка фургона едет за ним
      if (van) {
        var m = FC.markers.all["fh-van"];
        if (m) { m.x = van.car.x; m.z = van.car.z; if (m.obj) m.obj.position.set(van.car.x, 0, van.car.z); }
        if (van.car.dead || van.car.wrecked) { if (!van.opened) FC.hud.toast("🔥 Фургон сгорел вместе с деньгами", "bad", 2.5); dropVan(); }
      }
      // подготовка «машина»: в гараже
      if (prep && prep.kind === "car") {
        var c = prep.car;
        if (c.dead || c.wrecked) { FC.hud.toast("Машину разбили — подготовка сорвалась", "bad", 2.5); FC.markers.remove("fh-prep"); prep = null; FC.hud.objective(""); }
        else if (prep.stage === 0) { var mk = FC.markers.all["fh-prep"]; if (mk) { mk.x = c.x; mk.z = c.z; } }
        else if (p.mode === "car" && p.car === c && FC.dist2(c.x, c.z, prep.gar.x, prep.gar.z) < 8 * 8 && Math.hypot(c.vx, c.vz) < 3) {
          if (stars() > 0) { if (t1 <= 0) { t1 = 3; FC.hud.toast("Хвост! Оторвись — гараж не должен засветиться", "bad", 2); } }
          else {
            H().bank.getaway = { type: c.type, color: c.color };
            FC.cars.exit(true); c.keep = false; if (FC.cars.remove) FC.cars.remove(c);
            prepDone("car", "Машина для отхода ждёт в гараже");
          }
        }
      }
      // налёт: машина для отхода — метка следует, отрыв — подсказка
      if (run) {
        if (run.getaway) { var mc = FC.markers.all["fh-car"]; if (mc) { mc.x = run.getaway.x; mc.z = run.getaway.z; if (mc.obj) mc.obj.position.set(mc.x, 0, mc.z); } if (p.mode === "car") FC.markers.remove("fh-car"); }
        if (run.stage === "escape" && t1 <= 0) { t1 = 6; if (stars()) FC.hud.toast("🚨 На хвосте " + stars() + "★ — уходи переулками, меняй машину", "", 2.2); }
      }
      drawPill();
    }
  });

  /* ---- 6–7. приложение «Налёты» и карта ----------------------------------------------------------------------- */
  function boardHTML() {
    var h = H(), hb = h.bank, p = hb.prep;
    function row(ok, text, act, btn) {
      return "<div class='row'><span class='" + (ok ? "ok" : "") + "'>" + (ok ? "✓ " : "• ") + text + "</span>" +
        (!ok && act ? "<button type='button' data-a='" + act + "'>" + (btn || "Начать") + "</button>" : "") + "</div>";
    }
    var nextVan = van ? (van.stopped ? "стоит, вскрывай!" : "в пути") : "выезжает каждые 4 часа";
    var why = canStart();
    return "<div class='list fh-board'>" +
      "<div class='card'><b>💼 Грязные деньги: " + money(h.dirty) + "</b><p>Спрячь дома 🏠 или отмой через свой бизнес. При аресте — изымут.</p>" +
      "<p>Награда за твою голову: <b>" + money(h.bounty) + "</b> · дел: " + h.count + " · всего вынесено: " + money(h.total) + "</p></div>" +
      "<div class='card'><b>🏦 Большое дело: Флейм-Банк</b><p>Уровень охраны " + (hb.level + 1) + ". Подготовка:</p>" +
      row(p.car, "Машина для отхода", "car") + row(p.card, "Ключ-карта управляющего", "card") + row(p.scout >= 3, "Разведка: фото охраны и камер (" + p.scout + "/3)", "scout") +
      "<div class='row'><span>Подход</span><span><button type='button' class='" + (hb.approach === "quiet" ? "" : "ghost") + "' data-ap='quiet'>🤫 Тихо</button>" +
      "<button type='button' class='" + (hb.approach === "loud" ? "" : "ghost") + "' data-ap='loud'>💥 Громко</button></span></div>" +
      "<p class='quiet'>" + (hb.approach === "quiet" ? "Тихо: конусы охраны, вырубай сзади, +25% за тишину." : "Громко: все на пол, охрана с шокерами, 2★ сразу. Нужно оружие.") + "</p>" +
      "<button type='button' data-a='run' " + (why ? "disabled" : "") + ">" + (run ? "Налёт идёт" : why ? why : "▶ Начать налёт") + "</button></div>" +
      "<div class='card'><b>🚚 Инкассатор</b><p>Фургон " + nextVan + ". Протарань 3 раза, вырубай охрану, вскрой двери.</p>" +
      (h.tip > 0 ? "<p class='ok'>Наводка куплена — фургон на карте 🚚</p>" : "<button type='button' data-a='tip'>Купить наводку — $150</button>") + "</div>" +
      "<div class='card'><b>💎 Ювелирный «Огранка» · 🏧 банкоматы · 🛒 кассы</b><p>Витрины на тротуаре: разбил первую — 45 с до патруля. Банкоматы у магазинов и банка. Кассы — внутри 24/7 и заправок (с оружием быстрее).</p>" +
      "<button type='button' class='ghost' data-a='jw'>Метка на ближайший ювелирный</button></div></div>";
  }
  FC.hud.addApp({ id: "heist", icon: "🕶️", name: "Налёты", color: "#3a1f4f", order: 34,
    badge: function () { return prepReady() && !run && !canStart() ? "!" : ""; },
    render: function (el, api) {
      el.innerHTML = boardHTML();
      el.querySelectorAll("[data-ap]").forEach(function (b) { b.addEventListener("click", function () { H().bank.approach = b.dataset.ap; FC.dirty(); api.refresh(); }); });
      el.querySelectorAll("[data-a]").forEach(function (b) {
        b.addEventListener("click", function () {
          var a = b.dataset.a;
          if (a === "car" || a === "card" || a === "scout") { api.close(); prepStart(a); }
          else if (a === "run") { api.close(); startRun(H().bank.approach); }
          else if (a === "tip") {
            if (FC.money(-150, "наводка на инкассатора") === false) { FC.hud.toast("Не хватает денег", "bad", 2); return; }
            H().tip = 1; FC.dirty();
            if (!van) spawnVan(); else tipMarker();
            api.close(); FC.hud.toast("🚚 Фургон на карте. Протарань его 3 раза.", "ok", 3);
          } else if (a === "jw") {
            var p = P(), best = null;
            JEWELS.forEach(function (J) { if (!best || d2(J.B, p) < d2(best.B, p)) best = J; });
            if (best) { var dp = doorPt(best.B); FC.markers.add({ id: "wp", x: dp.x, z: dp.z, color: "#c86bff", icon: "💎", route: true, ring: 0 }); }
            api.close();
          }
        });
      });
    } });
  FC.hud.addMapLayer(function (c, k, mode) {
    if (mode !== "big") return;
    c.textAlign = "center"; c.textBaseline = "middle"; c.font = Math.max(10, 15 / k) + "px system-ui";
    if (BANK) c.fillText("🏦", BANK.x, BANK.z);
    if (FC.hud.mapTier(k) < 2) return;                      // ювелирки и банкоматы — с приближения, издалека только банк
    JEWELS.forEach(function (J) { c.fillText("💎", J.B.x, J.B.z); });
    ATMS.forEach(function (A) { c.fillText("🏧", A.x, A.z); });
  });

  FC.heist = {
    get run() { return run; }, get prep() { return prep; }, state: H, stash: stash, startRun: startRun, prepStart: prepStart,
    spawnVan: spawnVan, jewels: JEWELS, atms: ATMS, robStore: robStore, smash: smash,
    get van() { return van; },
    debug: { game: function () { return game; }, picks: function () { return picks; }, openVault: function () { openVault(); }, stopVan: function () { stopVan(); }, openVan: function () { openVan(); }, finish: function () { finishRun(); } }
  };
})(window);
