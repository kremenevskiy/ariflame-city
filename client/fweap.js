/* Флейм-Сити — арсенал: оружие (таблица характеристик), магазин и запас патронов, находки, броня, Оружейная
 * «Искромёт», ответ патруля (FC.weap). Стрельба, отдача, прицел, звук и колесо оружия — fguns.js (FC.guns).
 *
 * Задача: «добавь оружие: деньги можно где-то найти, за них купить оружие, жизни и т.д.»; v3 (22.11,
 * ночь): «реализм близкий к GTA — чтобы стримили и клипали». Поэтому оружие — настоящего вида и поведения (пистолет,
 * револьвер, пистолет-пулемёт, дробовик, автомат, снайперская винтовка, граната, «Факел», шокер, бита, кастет), имена —
 * вымышленные (без марок производителей). Крови нет: люди «вырубаются» и встают (FC.people.hit), машины получают урон.
 *
 * Патроны: в магазине (mag) и запас (ammo); перезарядка переносит из запаса в магазин. Цены и открытие — по
 * заработанному за всё время (stats.earned), скидка недели — FC.events.discount("guns"|"ammo"|"armor") (fevents.js).
 * Находки: деньги, аптечки, броня, энергетики, патроны — вокруг игрока, с респауном; тайники за домами и на крышах.
 * Броня поглощает 70% урона. Патруль при 2★+ отвечает шокерами, спецгруппа — сеткой (обездвиживает).
 * Сохранение — FC.save.arsenal: {v: 2, owned, ammo (запас), mag (в магазине), cur, prev, armor, stashes, stashMap}.
 * Сохранения v1 (мультяшное оружие) переводятся: пейнтбол → пистолет, Искромёт → ПП, базука → гранаты, шокер → шокер.
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE, M = FC.map, G = FC.gfx;

  /* ---- оружие: характеристики -------------------------------------------------------------------------------
     dmg — урон по человеку за попадание (запас прохожего 100, патрульного 130, спецгруппы 180); rof — выстрелов в
     секунду; mag — магазин; reload — секунды; range — [полный урон до, дальше не долетает] м (между — падение до 40%);
     spread — разброс от бедра и в прицеле (рад); bloom — прирост разброса за выстрел; kick — отдача камеры (рад);
     pellets — дробинок; head — множитель в голову; power — сила отброса при отключке; car — урон машине; loud — слышно
     на (м) — столько свидетелей зовут патруль; heavy — тяжёлое (розыск выше); unlock — открывается при заработке $.  */
  var WEAPONS = [
    { id: "fist", name: "Кулаки", icon: "👊", cls: "melee", slot: 0, sub: "всегда с тобой", melee: true },
    { id: "knuck", name: "Кастет", icon: "🥊", cls: "melee", slot: 0, sub: "быстрые удары, тише биты", melee: true, dmg: 45, rof: 2.4, range: [1.8, 1.8], power: 6, car: 1, price: 150, unlock: 0 },
    { id: "bat", name: "Бита", icon: "🏏", cls: "melee", slot: 0, sub: "удар с размаху, сбивает с ног", melee: true, dmg: 80, rof: 1.5, range: [2.5, 2.5], power: 11, car: 6, price: 250, unlock: 0 },
    { id: "taser", name: "Шокер «Разряд»", icon: "⚡", cls: "taser", slot: 7, sub: "две иглы на 9 м: отключка без вреда, после — перезаряд", dmg: 0, rof: 0.7, mag: 1, reload: 1.6, range: [9, 9], spread: [0.02, 0.01], kick: 0.02, car: 0, loud: 8, maxAmmo: 30, ammoPack: 10, price: 450, ammoPrice: 60, unlock: 0 },
    { id: "pistol", name: "Пистолет «Сокол-9»", icon: "🔫", cls: "pistol", slot: 1, sub: "точный и быстрый, 15 в магазине", dmg: 34, rof: 5, semi: true, mag: 15, reload: 1.3, range: [25, 70], spread: [0.03, 0.01], bloom: 0.012, kick: 0.035, head: 2, power: 5, car: 2.5, loud: 45, maxAmmo: 240, ammoPack: 45, price: 900, ammoPrice: 90, unlock: 0 },
    { id: "revolver", name: "Револьвер «Гром .44»", icon: "🤠", cls: "revolver", slot: 1, sub: "шесть громких выстрелов, валит с двух", dmg: 78, rof: 1.5, semi: true, mag: 6, reload: 2.4, range: [40, 95], spread: [0.028, 0.006], bloom: 0.03, kick: 0.11, head: 2.2, power: 9, car: 6, loud: 60, maxAmmo: 72, ammoPack: 18, price: 2200, ammoPrice: 120, unlock: 3000 },
    { id: "smg", name: "ПП «Шмель»", icon: "🐝", cls: "smg", slot: 2, sub: "800 выстрелов в минуту, 32 в магазине", dmg: 17, rof: 13, auto: true, mag: 32, reload: 1.8, range: [18, 50], spread: [0.055, 0.03], bloom: 0.008, bloomMax: 0.09, kick: 0.018, head: 1.5, power: 5, car: 1.8, loud: 50, maxAmmo: 480, ammoPack: 96, price: 3500, ammoPrice: 150, unlock: 8000 },
    { id: "shotgun", name: "Дробовик «Тайфун»", icon: "💥", cls: "shotgun", slot: 3, sub: "9 дробин, отбрасывает; заряжается по патрону", dmg: 15, rof: 1.1, semi: true, mag: 7, reload: 0.5, perShell: true, range: [10, 32], spread: [0.1, 0.085], pellets: 9, kick: 0.15, head: 1.3, power: 14, car: 1.4, loud: 60, heavy: true, maxAmmo: 84, ammoPack: 21, price: 4200, ammoPrice: 140, unlock: 12000 },
    { id: "rifle", name: "Автомат «Буря»", icon: "🪖", cls: "rifle", slot: 4, sub: "короткий тап — очередь по 3, держишь — авто", dmg: 30, rof: 10, auto: true, burst: 3, mag: 30, reload: 2.2, range: [45, 130], spread: [0.04, 0.009], bloom: 0.007, bloomMax: 0.07, kick: 0.028, head: 2, power: 8, car: 3.5, loud: 75, heavy: true, maxAmmo: 450, ammoPack: 90, price: 7000, ammoPrice: 220, unlock: 25000 },
    { id: "sniper", name: "Винтовка «Ястреб»", icon: "🎯", cls: "sniper", slot: 5, sub: "оптика ×6, валит с одного, затвор после выстрела", dmg: 160, rof: 0.75, semi: true, bolt: true, scope: 6, mag: 5, reload: 3, range: [160, 340], spread: [0.09, 0.0012], kick: 0.2, head: 3, power: 12, car: 14, loud: 95, heavy: true, maxAmmo: 60, ammoPack: 10, price: 12000, ammoPrice: 300, unlock: 50000 },
    { id: "grenade", name: "Граната «Хлопушка»", icon: "🧨", cls: "throw", slot: 6, sub: "держи — прицел дугой, отпусти — бросок; взрыв через 2 с", throw: true, fuse: 2.2, splash: 7, dmg: 140, power: 16, car: 70, loud: 120, heavy: true, maxAmmo: 10, ammoPack: 3, price: 2500, ammoPrice: 600, unlock: 15000 },
    { id: "molotov", name: "Коктейль «Факел»", icon: "🍾", cls: "throw", slot: 6, sub: "разбивается — 7 с огня на 3,5 м, машины горят", throw: true, fire: 7, splash: 3.5, dmg: 18, power: 4, car: 9, loud: 50, heavy: true, maxAmmo: 10, ammoPack: 3, price: 1800, ammoPrice: 450, unlock: 10000 }
  ];
  var W = {}; WEAPONS.forEach(function (w) { W[w.id] = w; });
  // перевод сохранений v1 (мультяшный арсенал до 22.11 ночи)
  var LEGACY = { paint: "pistol", spark: "smg", confetti: "grenade", shock: "taser", water: null };
  var EXTRAS = [
    { id: "armor", name: "Бронежилет", icon: "🦺", sub: "+100 брони: поглощает 70% урона", price: 250, sale: "armor" },
    { id: "medkit", name: "Аптечка", icon: "🩹", sub: "+80 здоровья сразу", price: 100, sale: "armor" },
    { id: "map", name: "Карта тайников", icon: "🗺️", sub: "все тайники 💰 на карте города", price: 300 }
  ];
  var CATS = [["Ближний бой", ["melee"]], ["Нелетальное", ["taser"]], ["Пистолеты", ["pistol", "revolver"]], ["Автоматическое", ["smg", "rifle"]],
    ["Дробовики", ["shotgun"]], ["Винтовки", ["sniper"]], ["Метательное", ["throw"]]];

  function A() {
    var S = FC.save;
    if (!S.arsenal) S.arsenal = { v: 2, owned: { fist: true }, ammo: {}, mag: {}, cur: "fist", prev: "fist", armor: 0, stashes: {}, stashMap: false };
    var a = S.arsenal;
    if (a.v !== 2) {                                   // v1 → v2: мультяшное — в настоящее, патроны — в запас
      var owned = { fist: true }, ammo = {};
      Object.keys(a.owned || {}).forEach(function (k) {
        var to = Object.prototype.hasOwnProperty.call(LEGACY, k) ? LEGACY[k] : k;
        if (to && W[to]) { owned[to] = true; if (W[to].ammoPack) ammo[to] = Math.min(W[to].maxAmmo, (ammo[to] || 0) + W[to].ammoPack * 2); }
      });
      a.owned = owned; a.ammo = ammo; a.mag = {}; a.v = 2;
      a.cur = owned[LEGACY[a.cur]] ? LEGACY[a.cur] : owned[a.cur] ? a.cur : "fist"; a.prev = "fist";
    }
    if (!a.mag) a.mag = {};
    if (!a.ammo) a.ammo = {};
    return a;
  }
  function owned() { return WEAPONS.filter(function (w) { return A().owned[w.id]; }); }
  function cur() { return W[A().cur] || W.fist; }
  function snd(n, o) { if (FC.audio) FC.audio.play(n, o); }
  function maxHp() { return (FC.player && FC.player.maxHp) || 100; }
  function heal(n) { var P = FC.player; P.hp = Math.min(maxHp(), P.hp + n); }
  function fx(kind, x, y, z, n) { if (FC.fx && FC.fx.burst) FC.fx.burst(x, y, z, kind, n); }
  function popup(t, o) { if (FC.hud.popup) FC.hud.popup(t, o); else FC.hud.toast(t, "ok", 1.6); }
  function earned() { return (FC.save.stats && FC.save.stats.earned) || 0; }
  // открыто: заработок за всё время и уровень игрока (fprogress.js: GATES.weapon) — купленное остаётся всегда
  function lvlGate(w) { return FC.progress ? FC.progress.gate("weapon", w.id) : 0; }
  function unlocked(w) { return A().owned[w.id] || ((!w.unlock || earned() >= w.unlock) && !lvlGate(w)); }
  // скидка недели (fevents.js): множитель цены 0..1
  function priceMul(kind) { return FC.events && FC.events.discount ? FC.events.discount(kind) : 1; }
  function price(w) { return Math.round(w.price * priceMul("guns")); }
  function ammoPrice(w) { return Math.round(w.ammoPrice * priceMul("ammo")); }
  // патроны: в магазине и в запасе; «всего» — для плашки и магазина
  function magOf(w) { var a = A(); return w.mag ? (a.mag[w.id] || 0) : 0; }
  function resOf(w) { return A().ammo[w.id] || 0; }
  function addAmmo(id, n) {
    var w = W[id], a = A(); if (!w || !w.maxAmmo) return 0;
    var cap = w.maxAmmo - (a.ammo[id] || 0) - (w.mag ? (a.mag[id] || 0) : 0);
    var add = Math.max(0, Math.min(n, cap));
    a.ammo[id] = (a.ammo[id] || 0) + add; FC.dirty(); drawPill();
    return add;
  }

  /* ---- стили и HUD: плашка оружия, броня, витрина ------------------------------------------------------------ */
  FC.css([
    ".wpill{position:fixed;right:14px;top:calc(86px + env(safe-area-inset-top));display:flex;align-items:center;gap:7px;padding:5px 11px 5px 7px;",
    " background:rgba(12,16,32,.74);border:1px solid rgba(255,207,122,.3);border-radius:14px;font:700 13px system-ui;color:#fff;cursor:pointer;",
    " pointer-events:auto;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);z-index:6;transition:transform .15s}",
    ".wpill b{font-size:20px}.wpill i{font-style:normal;color:#9dffbf;font-weight:800;font-variant-numeric:tabular-nums}.wpill i small{color:rgba(255,255,255,.55);font-weight:600}",
    ".wpill.empty i{color:#ff6b7a}.wpill.swap{transform:scale(1.12)}",
    ".armorbar{height:5px;margin:4px 12px 0;background:rgba(0,0,0,.5);border-radius:3px;overflow:hidden;border:1px solid rgba(255,255,255,.12)}",
    ".armorbar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#4dabf7,#a5d8ff);transition:width .3s}",
    "body.stunned #cv{filter:saturate(.4) hue-rotate(190deg) brightness(1.15)}",
    ".wshop{position:fixed;inset:0;z-index:9;display:none;align-items:center;justify-content:center;background:rgba(5,8,18,.62);",
    " backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);pointer-events:auto}",
    ".wshop.on{display:flex}.wsbox{width:min(760px,94vw);max-height:88vh;overflow:auto;background:rgba(14,18,36,.96);",
    " border:1px solid rgba(255,207,122,.35);border-radius:22px;padding:16px 16px 12px}",
    ".wshead{display:flex;align-items:center;gap:10px;margin-bottom:6px}.wshead h2{margin:0;font:800 italic 24px Georgia,serif;color:#fff;flex:1}",
    ".wshead .cash{font:800 18px system-ui;color:#9dffbf}.wshead button{background:none;border:0;color:#fff;font-size:22px;cursor:pointer}",
    ".wssale{margin:0 0 8px;padding:6px 10px;border-radius:10px;background:rgba(255,93,143,.16);border:1px solid rgba(255,93,143,.4);font:700 12px system-ui;color:#ffd1e0}",
    ".wscat{margin:10px 2px 6px;font:700 11px system-ui;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,207,122,.75)}",
    ".wsgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}",
    ".wscard{background:linear-gradient(160deg,rgba(255,255,255,.07),rgba(255,255,255,.02));border:1px solid rgba(255,255,255,.1);",
    " border-radius:16px;padding:11px;display:flex;flex-direction:column;gap:6px}",
    ".wscard.locked{opacity:.55}.wscard .ti{display:flex;align-items:center;gap:8px}.wscard .ti b{font-size:28px}.wscard .ti span{font:700 14px system-ui;color:#fff}",
    ".wscard p{margin:0;font-size:12px;color:rgba(255,245,230,.7);flex:1}",
    ".wsst{display:grid;grid-template-columns:auto 1fr;gap:2px 8px;font:600 10.5px system-ui;color:rgba(255,245,230,.6);align-items:center}",
    ".wsst i{display:block;height:5px;border-radius:3px;background:rgba(255,255,255,.1);overflow:hidden}.wsst i b{display:block;height:100%;background:linear-gradient(90deg,#ffcf7a,#ff6b3d)}",
    ".wscard .row{display:flex;gap:6px}.wscard button{flex:1;border:0;border-radius:10px;padding:8px;font:700 13px system-ui;cursor:pointer;",
    " background:linear-gradient(90deg,#ffcf7a,#ff9b4a);color:#2a1205}.wscard button.ghost{background:rgba(255,255,255,.12);color:#fff}",
    ".wscard button:disabled{opacity:.4;cursor:default}.wscard s{opacity:.6;font-weight:600}",
    "@media (max-width:560px){.wpill{top:calc(80px + env(safe-area-inset-top))}}"
  ].join(""));
  var pill = document.createElement("div"); pill.className = "wpill ui";
  document.getElementById("hud").appendChild(pill);
  var armorBar = document.createElement("div"); armorBar.className = "armorbar"; armorBar.innerHTML = "<i></i>";
  var hpEl = document.querySelector(".hpbar");
  if (hpEl && hpEl.parentNode) hpEl.parentNode.insertBefore(armorBar, hpEl.nextSibling);
  var pillKey = "";
  var armorD = null, armorW = -1;
  var pillW = null, pillMg = -1, pillRs = -1, pillN = -1;
  function ownedN() { var a = A(), k = 0; for (var i = 0; i < WEAPONS.length; i++) if (a.owned[WEAPONS[i].id]) k++; return k; }
  function drawPill() {
    var w = cur();
    // каждый кадр: оружие, патроны и число стволов те же, плашку не сбрасывали (pillKey) — выходим без строк и owned()
    var mg = magOf(w), rs = resOf(w), on = ownedN();
    if (pillKey && w.id === pillW && mg === pillMg && rs === pillRs && on === pillN) return;
    pillW = w.id; pillMg = mg; pillRs = rs; pillN = on;
    var txt = w.mag ? magOf(w) + "<small>/" + resOf(w) + "</small>" : w.maxAmmo ? String(resOf(w)) : "";
    var key = w.id + "|" + txt + "|" + owned().length;
    if (key === pillKey) return;
    pillKey = key;
    pill.innerHTML = "<b>" + w.icon + "</b>" + w.name.replace(/ «.*»/, "") + (txt ? " <i>" + txt + "</i>" : "");
    pill.classList.toggle("empty", !!w.maxAmmo && magOf(w) + resOf(w) === 0);
    pill.style.display = owned().length > 1 || w.id !== "fist" ? "" : "none";
  }
  // клик по плашке — следующее оружие (колесо на тач — кнопка 🔫, fguns.js)
  pill.addEventListener("click", function (e) { e.stopPropagation(); cycle(1); });

  function select(id, quiet) {
    var a = A();
    if (!a.owned[id] || a.cur === id) return;
    if (a.cur !== id) a.prev = a.cur;
    a.cur = id; FC.dirty(); drawPill();
    pill.classList.add("swap"); setTimeout(function () { pill.classList.remove("swap"); }, 160);
    if (!quiet) snd("blip", { vol: 0.5 });
    FC.emit("weapon:equip", { id: id, cls: W[id].cls });
  }
  function cycle(d) {
    var l = owned(), i = l.indexOf(cur());
    select(l[(i + d + l.length) % l.length].id);
  }
  function swapPrev() { var a = A(); if (a.prev && a.owned[a.prev] && a.prev !== a.cur) select(a.prev); else cycle(1); }
  global.addEventListener("keydown", function (e) {
    if (!FC.input.enabled || e.repeat) return;
    if (e.code === "KeyZ") cycle(-1);
    if (e.code === "KeyX") cycle(1);
  });

  /* ---- находки -------------------------------------------------------------------------------------------- */
  var o3 = new T.Object3D(), col = new T.Color();
  var KINDS = {
    cash: { w: 25, col: 0x3fbf5f, size: [0.55, 0.14, 0.32], label: function (v) { return "+" + FC.fmtMoney(v); } },
    wallet: { w: 12, col: 0x8b5a2b, size: [0.42, 0.12, 0.32], label: function (v) { return "Кошелёк +" + FC.fmtMoney(v); } },
    medkit: { w: 12, col: 0xf1f3f5, size: [0.5, 0.34, 0.5], label: function () { return "+80 ❤️"; } },
    armor: { w: 8, col: 0x2f5fd0, size: [0.55, 0.62, 0.18], label: function () { return "+50 🦺"; } },
    energy: { w: 9, col: 0xffd23f, size: [0.16, 0.36, 0.16], label: function () { return "Энергетик ⚡ бег быстрее"; } },
    ammo: { w: 14, col: 0x6b7d3a, size: [0.5, 0.32, 0.34], label: function (v, wn) { return wn ? "Патроны: " + wn : "+" + FC.fmtMoney(v); } },
    stash: { w: 0, col: 0xffc83a, size: [0.9, 0.7, 0.7], label: function (v) { return "ТАЙНИК 💰 +" + FC.fmtMoney(v); } }
  };
  var KLIST = Object.keys(KINDS).filter(function (k) { return KINDS[k].w > 0; });
  var KSUM = KLIST.reduce(function (s, k) { return s + KINDS[k].w; }, 0);
  var picks = [], R = FC.rng((Date.now() & 0xffffff) + 7);
  var IMAX = 90;
  var iMesh = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.15, emissive: 0x222222 }), IMAX);
  iMesh.instanceMatrix.setUsage(T.DynamicDrawUsage); iMesh.count = 0; iMesh.frustumCulled = false; iMesh.castShadow = false;
  G.add(iMesh);
  var gMesh = new T.InstancedMesh(new T.RingGeometry(0.55, 0.95, 24).rotateX(-Math.PI / 2),
    new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, blending: T.AdditiveBlending, depthWrite: false }), IMAX);
  gMesh.count = 0; gMesh.frustumCulled = false; gMesh.renderOrder = 2;
  G.add(gMesh);
  function pickKind() { var r = R() * KSUM; for (var i = 0; i < KLIST.length; i++) { r -= KINDS[KLIST[i]].w; if (r <= 0) return KLIST[i]; } return "cash"; }
  function spawnPick(px, pz) {
    var sp = null;
    if (R() < 0.3) {                                        // парк или двор — поглубже от дороги
      var b = M.blockAt(px + R.range(-150, 150), pz + R.range(-150, 150));
      if (b && (b.kind === "park" || b.kind === "shore" || b.kind === "city")) {
        var x = R.range(b.x0 + 6, b.x1 - 6), z = R.range(b.z0 + 6, b.z1 - 6);
        if (!M.buildingAt(x, z, 1) && !M.water(x, z)) sp = { x: x, z: z };
      }
    }
    if (!sp) sp = M.sidewalkPoint(R, px, pz, 150);
    if (!sp || FC.dist2(sp.x, sp.z, px, pz) < 25 * 25) return;
    var k = pickKind();
    var v = k === "cash" ? R.int(2, 12) * 10 : k === "wallet" ? R.int(4, 20) * 10 : 0;
    picks.push({ k: k, x: sp.x, y: 0.75, z: sp.z, v: v, ph: R() * 6 });
  }
  // тайники: сид-места — за домами (у задней стены) и на крышах средних домов; одноразовые
  var STASH = (function () {
    var r = FC.rng(5150), out = [], tries = 0;
    var bs = M.buildings.filter(function (B) { return !B.zone && !B.poi && B.h > 8 && B.h < 60 && B.doors && B.doors.length; });
    while (bs.length && out.length < 14 && tries++ < 400) {
      var B = bs[(r() * bs.length) | 0], roof = out.length % 2 === 1;
      var d = B.doors[0], x, z, y;
      if (roof) { x = B.x + r.range(-B.w / 4, B.w / 4); z = B.z + r.range(-B.d / 4, B.d / 4); y = B.h + 0.9; }
      else { x = B.x - d.nx * (B.w / 2 + 1.6); z = B.z - d.nz * (B.d / 2 + 1.6); y = 0.85; if (M.buildingAt(x, z, 0.6) || M.water(x, z) || M.onRoad(x, z)) continue; }
      out.push({ id: "s" + out.length, x: x, y: y, z: z, v: r.int(5, 15) * 100, roof: roof, B: B });
    }
    return out;
  })();
  function collect(p) {
    var P = FC.player, K = KINDS[p.k], a = A(), wn = null;
    if (p.k === "cash" || p.k === "wallet" || p.k === "stash") { FC.money(p.v, p.k === "stash" ? "тайник" : "находка"); snd("cash"); }
    else if (p.k === "medkit") { if (P.hp >= maxHp()) return false; heal(80); snd("note"); }
    else if (p.k === "armor") { if (a.armor >= 100) return false; a.armor = Math.min(100, a.armor + 50); snd("door", { vol: 0.6 }); }
    else if (p.k === "energy") { if (FC.jobs && FC.jobs.boost) FC.jobs.boost(45); snd("blip"); }
    else if (p.k === "ammo") {
      var rng = owned().filter(function (w) { return w.maxAmmo && resOf(w) + magOf(w) < w.maxAmmo; });
      if (rng.length) { var w = rng[(Math.random() * rng.length) | 0]; addAmmo(w.id, Math.ceil(w.ammoPack * 0.6)); wn = w.icon + " " + w.name.replace(/ «.*»/, ""); snd("blip"); }
      else { p.v = 50; FC.money(50, "находка"); snd("cash"); }
    }
    if (p.k === "stash") { a.stashes[p.id] = 1; FC.hud.big("ТАЙНИК НАЙДЕН", "+" + FC.fmtMoney(p.v), "#ffc83a", 2.4); }
    // задания дня (fdaily.js) и другие слушают шину; кошелёк — тоже «cash»
    FC.emit("pickup", { kind: p.k === "wallet" ? "cash" : p.k, value: p.v || 0 });
    popup(K.label(p.v, wn), { color: p.k === "medkit" ? "#ff8a8a" : p.k === "armor" ? "#8fc5ff" : "#9dffbf" });
    fx(p.k === "stash" ? "confetti" : "sparks", p.x, p.y, p.z, p.k === "stash" ? 60 : 10);
    FC.dirty();
    return true;
  }
  function room() { return FC.inside && FC.inside.active ? FC.inside.building.id : null; }
  var spawnT = 0;
  function stepPicks(dt) {
    var P = FC.player; if (!P) return;
    var inside = room() != null;
    spawnT -= dt;
    if (spawnT <= 0 && !inside) {
      spawnT = 0.4;
      for (var i = picks.length - 1; i >= 0; i--) if (FC.dist2(picks[i].x, picks[i].z, P.x, P.z) > 230 * 230) picks.splice(i, 1);
      if (picks.length < (G.Q.level === "low" ? 16 : 26)) spawnPick(P.x, P.z);
    }
    // находки и не найденные тайники — в готовый массив (было concat + filter + map: три массива и две функции на кадр);
    // это копия на кадр, как раньше: подбор (splice из picks) не сбивает обход
    var a = A(), list = pickList, nl = 0;
    for (var pi = 0; pi < picks.length; pi++) list[nl++] = picks[pi];
    for (var si = 0; si < STASH.length; si++) { var st = STASH[si]; if (!a.stashes[st.id]) { st.k = "stash"; list[nl++] = st; } }
    for (var pj = nl; pj < pickListN; pj++) list[pj] = null;     // не держать подобранные
    pickListN = nl;
    var t = performance.now() / 1000, n = 0;
    for (var j = 0; j < nl; j++) {
      var p = list[j];
      var dx = P.x - p.x, dz = P.z - p.z, d = Math.sqrt(dx * dx + dz * dz), dy = Math.abs((P.y || 0) + 0.8 - p.y);
      if (!inside && P.mode === "foot" && !P.dead && dy < 2.6) {
        if (d < 3 && d > 0.2 && p.k !== "stash") { p.x += dx / d * Math.min(d, 6 * dt); p.z += dz / d * Math.min(d, 6 * dt); }
        if (d < 1.5 && collect(p)) {
          if (p.k !== "stash") picks.splice(picks.indexOf(p), 1);
          continue;
        }
      }
      if (n >= IMAX || inside) continue;
      if (FC.dist2(p.x, p.z, G.camera.position.x, G.camera.position.z) > 160 * 160) continue;
      var K = KINDS[p.k], bob = Math.sin(t * 2.4 + (p.ph || 0)) * 0.15;
      o3.position.set(p.x, p.y + bob, p.z); o3.rotation.set(0, t * 1.6 + (p.ph || 0), 0); o3.scale.set(K.size[0], K.size[1], K.size[2]); o3.updateMatrix();
      iMesh.setMatrixAt(n, o3.matrix); iMesh.setColorAt(n, col.setHex(K.col));
      var gs = p.k === "stash" ? 2.2 : 1 + Math.sin(t * 3 + (p.ph || 0)) * 0.12;
      o3.position.set(p.x, (p.roof ? p.y - 0.8 : 0.22), p.z); o3.rotation.set(0, 0, 0); o3.scale.set(gs, 1, gs); o3.updateMatrix();
      gMesh.setMatrixAt(n, o3.matrix); gMesh.setColorAt(n, col.setHex(K.col));
      n++;
    }
    iMesh.count = n; gMesh.count = n;
    // в видеокарту — только n нарисованных (было: все IMAX каждый кадр, и при n = 0 тоже)
    if (n) {
      upd(iMesh.instanceMatrix, n); upd(gMesh.instanceMatrix, n);
      if (iMesh.instanceColor) upd(iMesh.instanceColor, n);
      if (gMesh.instanceColor) upd(gMesh.instanceColor, n);
    }
  }
  function upd(a, n) { a.needsUpdate = true; if (a.clearUpdateRanges) { a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); } }
  var pickList = [], pickListN = 0;
  // тайники на карте — после покупки «Карты тайников»
  FC.hud.addMapLayer(function (c, k) {
    var a = A(); if (!a.stashMap) return;
    c.textAlign = "center"; c.textBaseline = "middle"; c.font = Math.max(10, 15 / k) + "px system-ui";
    STASH.forEach(function (s) { if (!a.stashes[s.id]) c.fillText(s.roof ? "💰⬆" : "💰", s.x, s.z); });
  });

  /* ---- броня: поглощает 70% урона, пока не кончится ------------------------------------------------------- */
  function wrapDamage() {
    var P = FC.player; if (!P || P._armorWrap) return;
    var orig = P.damage;
    P._armorWrap = true;
    P.damage = function (n, why) {
      var a = A();
      if (a.armor > 0 && why !== "busted" && n > 0) {
        var take = Math.min(a.armor, n * 0.7);
        a.armor -= take; n -= take; FC.dirty();
        if (a.armor <= 0) FC.hud.toast("Броня пробита 🦺", "bad", 1.6);
      }
      return orig.call(P, n, why);
    };
  }

  /* ---- патруль отвечает: шокеры при 2★+, у спецгруппы — сетка; после тяжёлого оружия — дальше и чаще ---------- */
  var stunT = 0, bolts = [];
  var boltGeo = new T.BoxGeometry(0.05, 0.05, 1).translate(0, 0, 0.5);
  var boltMat = new T.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.9, blending: T.AdditiveBlending, depthWrite: false });
  var netMat = new T.MeshBasicMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.8 });
  function bolt(ax, ay, az, bx, by, bz, net) {
    var m = new T.Mesh(boltGeo, net ? netMat : boltMat);
    m.position.set(ax, ay, az); m.lookAt(bx, by, bz);
    var d = Math.hypot(bx - ax, by - ay, bz - az); m.scale.set(net ? 6 : 1, net ? 6 : 1, d);
    G.add(m); bolts.push({ m: m, t: net ? 0.35 : 0.15 });
  }
  function stun(sec, net) {
    stunT = Math.max(stunT, sec);
    document.body.classList.add("stunned");
    if (net) FC.hud.toast("Сетка спецгруппы! Не двинуться " + sec.toFixed(1) + " с", "bad", 1.6);
  }
  function clearLine(ax, az, bx, bz) {
    for (var s = 1; s < 4; s++) { var t = s / 4; if (M.buildingAt(ax + (bx - ax) * t, az + (bz - az) * t)) return false; }
    return true;
  }
  function copsFire(dt) {
    var P = FC.player, stars = FC.police ? FC.police.stars : 0;
    if (!P || P.dead || stars < 2 || P.mode !== "foot" || room() != null) return;
    var hot = FC.guns && FC.guns.heat ? FC.guns.heat() : 0;       // недавно стрелял из тяжёлого — патруль злее
    var reach = 13 + hot * 6;
    FC.people.all.forEach(function (c) {
      if (c.kind !== "cop" || c.knocked > 0 || c.inside != null) return;
      var d = Math.hypot(c.x - P.x, c.z - P.z);
      c._tz = (c._tz == null ? 1 + Math.random() * 1.5 : c._tz) - dt;
      if (d > reach || d < 1.2 || c._tz > 0) return;
      if (!clearLine(c.x, c.z, P.x, P.z)) return;
      var omon = c.cell === FC.people.SPECIAL.cop2;
      c._tz = (omon ? 4.5 : 2.2 + Math.random() * 1.3) * (1 - hot * 0.3);
      var sp = Math.hypot(P.vx, P.vz), chance = 0.75 - Math.min(0.45, sp * 0.06) - d * 0.015;
      bolt(c.x, c.y + 1.2, c.z, P.x, (P.y || 0) + 1, P.z, omon);
      FC.people.say(c, omon ? "Сетку!" : "Стоять! ⚡", 1.4, "cop");
      if (Math.random() < chance) {
        P.damage(omon ? 9 : 12, "taser");
        stun(omon ? 1.5 : 0.55, omon);
        snd("pop"); FC.cam.shake(0.25);
        fx("sparks", P.x, (P.y || 0) + 1, P.z, 14);
        if (FC.fx && FC.fx.haptic) FC.fx.haptic("medium");
      } else snd("whoosh", { vol: 0.5 });
    });
  }

  /* ---- Оружейная: у входа и внутри --------------------------------------------------------------------- */
  var shopEl = document.createElement("div"); shopEl.className = "wshop"; document.body.appendChild(shopEl);
  var shopB = null;
  function openShop(B) {
    shopB = B; renderShop();
    shopEl.classList.add("on"); FC.input.enable(false); FC.input.unlock();
    snd("door");
  }
  function closeShop() { shopEl.classList.remove("on"); FC.input.enable(true); shopB = null; }
  function bar(label, k) { return "<span>" + label + "</span><i><b style='width:" + Math.round(FC.clamp(k, 0.04, 1) * 100) + "%'></b></i>"; }
  function stats(w) {
    if (w.throw) return "<div class='wsst'>" + bar("Радиус", w.splash / 7) + bar("Урон", w.dmg / 140) + "</div>";
    if (w.melee) return "<div class='wsst'>" + bar("Урон", w.dmg / 100) + bar("Скорость", w.rof / 2.5) + "</div>";
    var dps = w.dmg * (w.pellets || 1) * w.rof;
    return "<div class='wsst'>" + bar("Урон", w.dmg * (w.pellets || 1) / 160) + bar("Темп", Math.min(1, w.rof / 13)) + bar("Дальность", w.range[1] / 340) +
      bar("Точность", 1 - w.spread[1] / 0.09) + bar("Огонь/с", dps / 300) + "</div>";
  }
  function moneyTag(base, now) { return now < base ? "<s>" + FC.fmtMoney(base) + "</s> " + FC.fmtMoney(now) : FC.fmtMoney(now); }
  function card(w, a, m) {
    var lock = !unlocked(w), b = "";
    if (lock) b = "<button type='button' disabled>🔒 " + (lvlGate(w) && (!w.unlock || earned() >= w.unlock) ? "С " + lvlGate(w) + "-го уровня" : "Откроется с заработком " + FC.fmtMoney(w.unlock) + (lvlGate(w) ? " и " + lvlGate(w) + "-го уровня" : "")) + "</button>";
    else if (!a.owned[w.id]) b = "<button type='button' data-buy='" + w.id + "'" + (m < price(w) ? " disabled" : "") + ">Купить " + moneyTag(w.price, price(w)) + "</button>";
    else b = "<button type='button' class='ghost' data-sel='" + w.id + "'>" + (a.cur === w.id ? "В руках ✓" : "Взять") + "</button>";
    if (w.maxAmmo && a.owned[w.id]) {
      var full = resOf(w) + magOf(w) >= w.maxAmmo;
      b += "<button type='button' data-ammo='" + w.id + "'" + (m < ammoPrice(w) || full ? " disabled" : "") + ">" + (full ? "Запас полон" : "+" + w.ammoPack + " за " + moneyTag(w.ammoPrice, ammoPrice(w))) + "</button>";
    }
    var have = w.maxAmmo && a.owned[w.id] ? " · " + (w.mag ? magOf(w) + "/" : "") + resOf(w) : "";
    return "<div class='wscard" + (lock ? " locked" : "") + "'><div class='ti'><b>" + w.icon + "</b><span>" + FC.hud.esc(w.name + have) + "</span></div><p>" +
      FC.hud.esc(w.sub) + (w.mag ? " · перезарядка " + String(w.perShell ? w.reload + " с/патрон" : w.reload + " с").replace(".", ",") : "") + "</p>" + stats(w) + "<div class='row'>" + b + "</div></div>";
  }
  function renderShop() {
    var a = A(), m = FC.save.money;
    var sale = FC.events && FC.events.saleLine ? FC.events.saleLine() : "";
    var h = "<div class='wsbox'><div class='wshead'><h2>🎯 " + FC.hud.esc(shopB ? shopB.name : "Оружейная") + "</h2><span class='cash'>" + FC.fmtMoney(m) +
      "</span><button type='button' data-x='1'>✕</button></div>" + (sale ? "<div class='wssale'>🏷️ " + FC.hud.esc(sale) + "</div>" : "");
    CATS.forEach(function (c) {
      var list = WEAPONS.filter(function (w) { return w.id !== "fist" && c[1].indexOf(w.cls) >= 0; });
      if (!list.length) return;
      h += "<div class='wscat'>" + c[0] + "</div><div class='wsgrid'>" + list.map(function (w) { return card(w, a, m); }).join("") + "</div>";
    });
    h += "<div class='wscat'>Снаряжение</div><div class='wsgrid'>";
    EXTRAS.forEach(function (x) {
      var pr = Math.round(x.price * (x.sale ? priceMul(x.sale) : 1));
      var dis = m < pr || (x.id === "armor" && a.armor >= 100) || (x.id === "map" && a.stashMap) || (x.id === "medkit" && FC.player.hp >= maxHp());
      var label = x.id === "map" && a.stashMap ? "Уже есть ✓" : "Купить " + moneyTag(x.price, pr);
      var sub = x.sub + (x.id === "armor" ? " · сейчас " + Math.round(a.armor) : x.id === "map" ? " · найдено " + Object.keys(a.stashes).length + "/" + STASH.length : "");
      h += "<div class='wscard'><div class='ti'><b>" + x.icon + "</b><span>" + FC.hud.esc(x.name) + "</span></div><p>" + FC.hud.esc(sub) + "</p><div class='row'><button type='button' data-extra='" + x.id + "'" + (dis ? " disabled" : "") + ">" + label + "</button></div></div>";
    });
    h += "</div><p style='margin:10px 2px 0;font-size:12px;color:rgba(255,245,230,.55)'>Крови нет: сбитые встают. Выстрел слышно далеко — свидетели зовут патруль, тяжёлое оружие — розыск выше. " +
      (FC.input.touch ? "Зажми 🔫 — колесо оружия, ⟳ — перезарядка." : "1–9 / Z X — сменить, T — колесо, ЛКМ — огонь, ПКМ — прицел, R — перезарядка.") + "</p></div>";
    shopEl.innerHTML = h;
  }
  shopEl.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) { if (e.target === shopEl) closeShop(); return; }
    var a = A();
    if (b.dataset.x) { closeShop(); return; }
    if (b.dataset.buy) {
      var w = W[b.dataset.buy];
      if (!unlocked(w)) return;
      if (FC.money(-price(w), "оружейная: " + w.name) === false) { FC.hud.toast("Не хватает денег", "bad", 1.6); return; }
      a.owned[w.id] = true;
      if (w.maxAmmo) { addAmmo(w.id, w.ammoPack); if (w.mag) { var put = Math.min(w.mag, resOf(w)); a.mag[w.id] = put; a.ammo[w.id] -= put; } }
      select(w.id, true); snd("cash"); popup(w.icon + " " + w.name.replace(/ «.*»/, "") + " — твоё!", { color: "#ffcf7a", big: true });
      FC.emit("weapon:buy", { id: w.id });
    } else if (b.dataset.sel) select(b.dataset.sel);
    else if (b.dataset.ammo) {
      var wa = W[b.dataset.ammo];
      if (FC.money(-ammoPrice(wa), "оружейная: патроны " + wa.name) === false) { FC.hud.toast("Не хватает денег", "bad", 1.6); return; }
      addAmmo(wa.id, wa.ammoPack); snd("blip");
    } else if (b.dataset.extra) {
      var x = EXTRAS.filter(function (q) { return q.id === b.dataset.extra; })[0];
      var pr = Math.round(x.price * (x.sale ? priceMul(x.sale) : 1));
      if (FC.money(-pr, "оружейная: " + x.name) === false) { FC.hud.toast("Не хватает денег", "bad", 1.6); return; }
      if (x.id === "armor") a.armor = 100;
      if (x.id === "medkit") heal(80);
      if (x.id === "map") { a.stashMap = true; FC.hud.toast("Тайники 💰 отмечены на карте", "ok", 2.5); }
      snd("cash");
    }
    FC.dirty(); renderShop();
  });
  global.addEventListener("keydown", function (e) { if (shopEl.classList.contains("on") && e.code === "Escape") closeShop(); });

  var GUNS = M.pois.filter(function (B) { return B.poi === "guns"; });
  var HOSP = M.pois.filter(function (B) { return B.poi === "hospital"; });
  function sideSpot(B, k) {
    var d = B.doors[0], tx = -d.nz, tz = d.nx;                // вдоль фасада, в 2,6 м от двери
    return { x: d.x + tx * 2.6 * (k || 1), z: d.z + tz * 2.6 * (k || 1) };
  }
  function provider(px, pz, rm) {
    var P = FC.player; if (!P || P.mode !== "foot") return null;
    var out = [];
    if (rm == null) {
      GUNS.forEach(function (B) {
        var s = sideSpot(B, 1);
        if (FC.dist2(s.x, s.z, px, pz) < 36) out.push({ id: "guns" + B.id, x: s.x, z: s.z, r: 2.2, key: "use", label: "🎯 Оружейная: оружие, патроны, броня", act: function () { openShop(B); } });
      });
      HOSP.forEach(function (B) {
        var s = sideSpot(B, -1);
        if (P.hp < maxHp() && FC.dist2(s.x, s.z, px, pz) < 36) out.push({ id: "heal" + B.id, x: s.x, z: s.z, r: 2.2, key: "use", label: "🏥 Подлечиться — $50", act: function () {
          if (FC.money(-50, "больница") === false) { FC.hud.toast("Не хватает $50", "bad", 1.6); return; }
          P.hp = maxHp(); snd("note"); popup("Здоров ❤️", { color: "#ff8a8a" });
        } });
      });
    } else {
      // внутри Оружейной: витрина у входа (интерьер строится на месте здания — координаты мира)
      GUNS.forEach(function (B) {
        if (B.id !== rm) return;
        var d = B.doors[0], x = d.x - d.nx * 4.5, z = d.z - d.nz * 4.5;
        out.push({ id: "gunsin" + B.id, x: x, z: z, r: 3, room: B.id, key: "use", label: "🎯 Витрина: оружие, броня, патроны", act: function () { openShop(B); } });
      });
    }
    return out;
  }

  /* ---- телефон: «Арсенал» ------------------------------------------------------------------------------- */
  FC.hud.addApp({ id: "arsenal", icon: "🎯", name: "Арсенал", color: "#c92a2a", order: 46, render: function (b, api) {
    var a = A();
    var h = "<div class='list'><div class='card'><b>❤️ " + Math.round(FC.player.hp) + "/" + maxHp() + " · 🦺 " + Math.round(a.armor) + "</b><p>Тайники: " + Object.keys(a.stashes).length + " из " + STASH.length +
      (a.stashMap ? " — отмечены на карте" : " — карта в Оружейной") + "</p></div>";
    owned().forEach(function (w) {
      var am = w.maxAmmo ? " · " + (w.mag ? magOf(w) + "/" : "") + resOf(w) : "";
      h += "<div class='row'><span>" + w.icon + " " + FC.hud.esc(w.name) + am + "</span><button type='button' class='" + (a.cur === w.id ? "ghost" : "") + "' data-w='" + w.id + "'>" + (a.cur === w.id ? "в руках" : "взять") + "</button></div>";
    });
    h += "<button type='button' data-near='1'>📍 Ближайшая Оружейная</button></div>";
    b.innerHTML = h;
    b.querySelectorAll("[data-w]").forEach(function (x) { x.addEventListener("click", function () { select(x.dataset.w); api.refresh(); }); });
    b.querySelector("[data-near]").addEventListener("click", function () {
      var P = FC.player, B = GUNS.slice().sort(function (p, q) { return FC.dist2(p.x, p.z, P.x, P.z) - FC.dist2(q.x, q.z, P.x, P.z); })[0];
      if (B) { var s = sideSpot(B, 1); FC.markers.add({ id: "guns", x: s.x, z: s.z, color: "#e63946", icon: "🎯", route: true, ring: 2 }); FC.hud.toast("Маршрут к Оружейной", "ok", 2); }
      api.close();
    });
  } });

  /* ---- арест и смерть: что теряется ---------------------------------------------------------------------- */
  FC.on("busted", function () {
    var a = A(), lost = false;
    Object.keys(a.ammo).forEach(function (k) { if (a.ammo[k] > 0) { a.ammo[k] = 0; lost = true; } });
    Object.keys(a.mag).forEach(function (k) { if (a.mag[k] > 0) { a.mag[k] = 0; lost = true; } });
    if (a.cur !== "fist") a.cur = "fist";
    if (lost) setTimeout(function () { FC.hud.toast("Боеприпасы изъяты при задержании", "bad", 3); }, 3800);
    FC.dirty(); drawPill();
  });
  FC.on("wasted", function () { A().armor = 0; FC.dirty(); });
  FC.on("save:load", function () { A(); pillKey = ""; drawPill(); });

  /* ---- кадр: находки, патруль, броня, оглушение. Атака — fguns.js (система «guns», order 9) ----------------- */
  FC.addSystem({
    name: "weap", order: 8,
    init: function () { wrapDamage(); FC.interact.provider(provider); drawPill(); },
    update: function (dt) {
      var P = FC.player; if (!P || !FC.started) return;
      var I = FC.input;
      // оглушение: стоим (ось движения в ноль до системы игрока)
      if (stunT > 0) {
        stunT -= dt; I.mx = 0; I.mz = 0; I.consume("jump"); I.consume("punch");
        if (stunT <= 0) document.body.classList.remove("stunned");
      }
      stepPicks(dt);
      copsFire(dt);
      for (var b = bolts.length - 1; b >= 0; b--) {
        bolts[b].t -= dt;
        if (bolts[b].t <= 0) { G.scene.remove(bolts[b].m); bolts.splice(b, 1); }
      }
      // броня: стиль — только при изменении (писался каждый кадр: пересчёт стилей и раскладки перед миникартой)
      var arm = A().armor, armD = arm > 0 ? "" : "none", armW = Math.max(0, Math.min(100, arm));
      if (armD !== armorD) { armorD = armD; armorBar.style.display = armD; }
      if (armW !== armorW) { armorW = armW; armorBar.firstChild.style.width = armW + "%"; }
      drawPill();
    }
  });

  FC.weap = {
    WEAPONS: WEAPONS, W: W, A: A, cur: cur, owned: owned, select: select, cycle: cycle, swapPrev: swapPrev, unlocked: unlocked,
    mag: magOf, reserve: resOf, addAmmo: addAmmo, drawPill: function () { pillKey = ""; drawPill(); },
    openShop: openShop, closeShop: closeShop, stun: stun, stunned: function () { return stunT > 0; }, stashes: STASH,
    give: function (id, ammo) { var a = A(); if (!W[id]) return; a.owned[id] = true; if (ammo) addAmmo(id, ammo); FC.dirty(); pillKey = ""; drawPill(); },
    picks: function () { return picks; }
  };
})(window);
