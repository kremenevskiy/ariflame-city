/* Флейм-Сити — недвижимость, мебель, гараж и тюнинг (FC.home).
 *
 * Задача: «можно выбрать, найти свой дом на карте, и его больше не могут другие занять; купить
 * или продать; свой дом и гараж: мебель, тюнинг (цвет, нитро, броня…), квартиры в разных районах как точки сохранения».
 * С 22.11 (владение настоящими зданиями) купить/продать, ключи зданий обоих городов, цены, двери, карта и вкладки «Мои» и
 * «Купить» — FC.prop (fprop.js, сервер server/realty.py); здесь — дом как место жизни: главный дом, мебель,
 * гараж и тюнинг, оболочка приложения «Недвижимость». Гостю дом не закрепить — «войди своим агентом».
 *
 * Свой дом: главный (kind home) — FC.me.home (табличка «ТВОЙ ДОМ» и кровать «Поспать» в интерьере ставит ffurn), остальные
 * квартиры — точки сохранения («Такси сюда»). Мебель покупается в приложении и появляется в гостиной своей квартиры
 * (этаж квартиры — тот же, что у ffurn: сид по rid). Гараж — FC.save.garage (его ведёт fjobs: автосалон); тюнинг —
 * FC.save.tune[id], на машине — car.tune и своя копия car.spec (скорость, разгон, броня, сцепление, нитро).
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE, M = FC.map;

  // свои дома — FC.prop (fprop.js): тот же список, что на сервере; здесь — только «дом как место жизни»
  var H = { loaded: false };

  FC.css([
    ".hm-tabs{display:flex;gap:6px;margin:0 0 8px}.hm-tabs button{flex:1;background:rgba(255,255,255,.1)!important;color:#fff!important;padding:6px 4px!important;font-size:12px}",
    ".hm-tabs button.on{background:var(--gold)!important;color:#2a1205!important}",
    ".hm-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.hm-row button{font-size:12px}",
    ".hm-pill{display:inline-block;font:700 11px system-ui;padding:1px 7px;border-radius:9px;background:rgba(255,255,255,.14);margin-left:4px}",
    ".hm-pill.ok{background:#2fbf71;color:#04210f}.hm-pill.bad{background:#ff5d6c;color:#fff}",
    ".hm-tune{display:grid;grid-template-columns:1fr auto;gap:4px 8px;align-items:center;margin-top:6px;font-size:12px}",
    ".hm-sw{display:flex;gap:4px;flex-wrap:wrap}.hm-sw i{width:22px;height:22px;border-radius:6px;display:inline-block;cursor:pointer;border:2px solid rgba(255,255,255,.3)}"
  ].join("\n"));

  function PR() { return FC.prop; }
  function creatureName(code) { var W = global.FC_SPECIES; return code && W && W.META[code] ? W.META[code][0] : ""; }
  function mineB(B) { return B && PR() ? PR().mineOf(B) : null; }
  function primary() { return PR() ? PR().home() : null; }
  function money(n) { return FC.fmtMoney(n); }
  function toast(t, c, s) { if (FC.hud) FC.hud.toast(t, c || "", s || 2.4); }

  // главный купленный дом — дом игрока: табличка, кровать, гараж, респаун (Минск: пока кусок не загружен — null, ждём)
  var defaultHome = null;
  function applyHome() {
    if (!FC.me) return;
    if (defaultHome === null) defaultHome = FC.me.home || false;
    var p = primary(), B = p && PR().resolve(p);
    FC.me.home = B || (p ? null : (defaultHome || null));
    FC.me.ownsHome = !!p;
  }
  FC.on("prop:mine", function () { H.loaded = true; applyHome(); });

  /* ---- мебель: каталог, покупка, появление в гостиной своей квартиры ---------------------------------------- */
  var FURN = [
    { id: "sofa", name: "Диван", icon: "🛋️", price: 1200 },
    { id: "tv", name: "Телевизор «Флейм ТВ»", icon: "📺", price: 1800 },
    { id: "rug", name: "Ковёр", icon: "🟫", price: 400 },
    { id: "plant", name: "Монстера", icon: "🪴", price: 300 },
    { id: "aquarium", name: "Аквариум", icon: "🐠", price: 3500 },
    { id: "neon", name: "Неоновая вывеска", icon: "💡", price: 2200 },
    { id: "posters", name: "Постеры города", icon: "🖼️", price: 600 },
    { id: "console", name: "Игровая приставка", icon: "🎮", price: 2500 },
    { id: "fridge", name: "Холодильник с едой", icon: "🧊", price: 1500 },
    { id: "luxbed", name: "Кровать-люкс", icon: "🛏️", price: 6000 }
  ];
  function furnOwned(id) { return (FC.save.furniture || []).indexOf(id) >= 0; }
  function buyFurn(f) {
    if (!primary()) { toast("Сначала купи дом", "bad"); return; }
    if (furnOwned(f.id)) return;
    if (FC.money(-f.price, "мебель: " + f.name) === false) { toast("Не хватает денег", "bad"); return; }
    (FC.save.furniture = FC.save.furniture || []).push(f.id); FC.dirty();
    if (FC.audio) FC.audio.play("cash");
    toast(f.icon + " " + f.name + " — уже стоит в гостиной", "ok", 2.6);
    if (inMyFlat()) placeFurniture();
  }
  function homeFloor(B) { return B.floors > 1 ? 1 + (FC.hash(FC.me ? FC.me.rid : "g") % (B.floors - 1)) : 0; }
  // этаж своей квартиры: событие inside:floor приходит раньше, чем FC.inside.floor обновится, — берём из события
  var flat = { b: null, f: null };
  function inMyFlat() { var I = FC.inside; return !!(I && I.active && flat.b && mineB(flat.b) && flat.f === homeFloor(flat.b)); }

  var fgroup = null, fishes = [], tvTex = null, tvCtx = null, tvT = 0, acts = [];
  function clearFurniture() {
    acts.forEach(function (id) { FC.interact.remove(id); }); acts = [];
    if (fgroup) {
      FC.gfx.scene.remove(fgroup);
      fgroup.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.map && o.material.map !== tvTex) o.material.map.dispose(); if (o.material) o.material.dispose(); });
      fgroup = null;
    }
    fishes = [];
  }
  function mat(hex, opt) { return new T.MeshStandardMaterial(Object.assign({ color: hex, roughness: 0.7 }, opt || {})); }
  function bx(g, x, y, z, w, h, d, m) { var o = new T.Mesh(new T.BoxGeometry(w, h, d), m); o.position.set(x, y + h / 2, z); g.add(o); return o; }
  function canvasMat(w, h, draw, emissive) {
    var t = FC.gfx.tex.canvas(w, h, draw);
    return new T.MeshStandardMaterial({ map: t, emissiveMap: emissive ? t : null, emissive: emissive ? 0xffffff : 0x000000, emissiveIntensity: emissive ? 1.1 : 0, roughness: 0.5 });
  }
  function placeFurniture() {
    clearFurniture();
    var S = FC.inside.debug && FC.inside.debug();
    if (!S || !S.plan || !S.plan.rooms) return;
    var have = FC.save.furniture || [];
    if (!have.length) return;
    // гостиная своей квартиры: самая большая «living»; на этаже-студии — левая половина (её так делит ffurn K.studioapt)
    var rooms = S.plan.rooms;
    var area = function (o) { return (o.x1 - o.x0) * (o.z1 - o.z0); };
    var liv = rooms.filter(function (o) { return o.type === "living"; }).sort(function (a, b) { return area(b) - area(a); })[0];
    var bedr = null, studio = rooms.filter(function (o) { return o.type === "studioapt"; })[0];
    if (!liv && studio) {
      var mid = (studio.x0 + studio.x1) / 2;
      liv = { x0: studio.x0, x1: mid, z0: studio.z0, z1: studio.z1 };
      bedr = { x0: mid, x1: studio.x1, z0: studio.z0, z1: studio.z1 };
    }
    if (!liv) liv = rooms.slice().sort(function (a, b) { return area(b) - area(a); })[0];
    if (!liv) return;
    if (!bedr) {
      var lc = { x: (liv.x0 + liv.x1) / 2, z: (liv.z0 + liv.z1) / 2 };
      bedr = rooms.filter(function (o) { return o.type === "bedroom"; })
        .sort(function (a, b) { return FC.dist2((a.x0 + a.x1) / 2, (a.z0 + a.z1) / 2, lc.x, lc.z) - FC.dist2((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, lc.x, lc.z); })[0] || null;
    }
    fgroup = new T.Group();
    fgroup.position.set(S.ox, S.y0, S.oz); fgroup.rotation.y = Math.atan2(S.s, S.c);
    FC.gfx.scene.add(fgroup);
    // базовый набор ffurn: ковёр и журнальный столик в центре, диван у дальней стены, тумба ТВ у стены z0, полка в углу
    // x1·z1, растение в углу x0·z1 — своё ставим вдоль боковых стен и в свободные углы
    var I = { x0: liv.x0 + 0.45, x1: liv.x1 - 0.45, z0: liv.z0 + 0.45, z1: liv.z1 - 0.45 };
    var cx = (I.x0 + I.x1) / 2, cz = (I.z0 + I.z1) / 2, W = I.x1 - I.x0, D = I.z1 - I.z0;
    var room = FC.inside.building.id;
    function act(id, lx, lz, label, fn) {
      var w = FC.inside.toWorld(lx, lz), key = "hmf_" + id;
      FC.interact.add({ id: key, x: w.x, z: w.z, r: 1.6, room: room, key: "use", label: label, act: fn }); acts.push(key);
    }
    if (have.indexOf("rug") >= 0) {
      var rug = new T.Mesh(new T.PlaneGeometry(Math.max(1.5, W - 1.4), Math.max(1.5, D - 1.4)), canvasMat(256, 160, function (x, w, h) {
        x.fillStyle = "#7a2e3a"; x.fillRect(0, 0, w, h); x.strokeStyle = "#e9c46a"; x.lineWidth = 8; x.strokeRect(10, 10, w - 20, h - 20);
        x.fillStyle = "#e9c46a"; for (var i = 0; i < 5; i++) { x.beginPath(); x.arc(w / 2, h / 2, 12 + i * 12, 0, 7); x.globalAlpha = 0.25; x.fill(); }
      }));
      rug.rotation.x = -Math.PI / 2; rug.position.set(cx, 0.012, cz); fgroup.add(rug);
    }
    if (have.indexOf("sofa") >= 0) {                     // угловой диван вдоль стены x0, лицом к +x
      var sm = mat(0x3d5a80), sl = Math.min(2.4, D - 0.8), sx = I.x0 + 0.45;
      bx(fgroup, sx, 0, cz, 0.9, 0.45, sl, sm); bx(fgroup, I.x0 + 0.1, 0.45, cz, 0.2, 0.5, sl, sm);
      bx(fgroup, sx, 0.45, cz - sl / 2 + 0.09, 0.9, 0.25, 0.18, sm); bx(fgroup, sx, 0.45, cz + sl / 2 - 0.09, 0.9, 0.25, 0.18, sm);
      act("sofa", sx + 0.9, cz, "Посидеть на диване (+40 ❤, +1 час)", function () { FC.player.heal(40); FC.setHour(FC.clock.hour + 1); toast("Отдохнул: +40 ❤", "ok"); });
    }
    if (have.indexOf("posters") >= 0) {
      var ads = (FC.deco && FC.deco.ads) || [["Флейм-Сити", "город, который не спит", "#ff8a3d", "🔥"]];
      [0, 1].forEach(function (k) {
        var a = ads[k % ads.length];
        var p = new T.Mesh(new T.PlaneGeometry(0.9, 1.25), canvasMat(180, 250, function (x, w, h) {
          x.fillStyle = a[2]; x.fillRect(0, 0, w, h); x.font = "90px system-ui"; x.textAlign = "center"; x.fillText(a[3], w / 2, 110);
          x.fillStyle = "#fff"; x.font = "800 20px system-ui"; x.fillText(a[0], w / 2, 175); x.font = "600 13px system-ui"; x.fillText(a[1].slice(0, 26), w / 2, 205);
        }));
        p.position.set(liv.x0 + 0.03, 1.75, cz - 0.65 + k * 1.3); p.rotation.y = Math.PI / 2; fgroup.add(p);
      });
    }
    if (have.indexOf("tv") >= 0) {                       // большой телевизор на стене x1, лицом к дивану
      tvTex = FC.gfx.tex.canvas(256, 144, function () {}); tvCtx = tvTex.image.getContext("2d");
      bx(fgroup, liv.x1 - 0.06, 0.75, cz, 0.06, 1.2, 2.1, mat(0x111111));
      if (studio) bx(fgroup, liv.x1 - 0.06, 0, cz, 0.35, 0.75, 0.6, mat(0x2b2d33));     // в студии стены нет — стойка
      var scr = new T.Mesh(new T.PlaneGeometry(1.95, 1.1), new T.MeshStandardMaterial({ map: tvTex, emissiveMap: tvTex, emissive: 0xffffff, emissiveIntensity: 1.2 }));
      scr.position.set(liv.x1 - 0.1, 1.35, cz); scr.rotation.y = -Math.PI / 2; fgroup.add(scr);
      act("tv", I.x1 - 1.0, cz, "📺 «Флейм ТВ» — что делают агенты", function () { if (FC.hud && FC.hud.openPhone) FC.hud.openPhone("feed"); });
    }
    if (have.indexOf("console") >= 0) {
      bx(fgroup, I.x1 - 0.2, 0, cz, 0.4, 0.45, 1.4, mat(0x2b2d33));
      bx(fgroup, I.x1 - 0.2, 0.45, cz + 0.3, 0.3, 0.07, 0.4, mat(0xf2f2f2));
      act("console", I.x1 - 1.0, cz + 0.9, "🎮 Поиграть на приставке", function () {
        if (!FC.games || !FC.games.run) { toast("Приставка грузится…", ""); return; }
        FC.games.run("hack", { title: "Приставка: «Провода»" }).then(function (r) { if (r && r.ok) toast("Рекорд дня! Настроение отличное", "ok"); });
      });
    }
    if (have.indexOf("plant") >= 0) {
      bx(fgroup, I.x0 + 0.3, 0, I.z0 + 0.3, 0.45, 0.45, 0.45, mat(0xb5651d));
      var leaf = new T.Mesh(new T.IcosahedronGeometry(0.55, 0), mat(0x2f8f46, { flatShading: true })); leaf.position.set(I.x0 + 0.3, 1.0, I.z0 + 0.3); fgroup.add(leaf);
    }
    if (have.indexOf("fridge") >= 0) {
      bx(fgroup, I.x1 - 0.35, 0, I.z0 + 0.35, 0.65, 1.8, 0.65, mat(0xeef1f4, { roughness: 0.3 }));
      act("fridge", I.x1 - 0.4, I.z0 + 1.2, "🧊 Перекусить (+60 ❤)", function () { FC.player.heal(60); if (FC.audio) FC.audio.play("blip"); toast("Вкусно! +60 ❤", "ok"); });
    }
    if (have.indexOf("aquarium") >= 0) {                 // у стены z0, левее тумбы ТВ базового набора
      var ax = Math.max(I.x0 + 1.4, cx - 1.9), az = I.z0 + 0.3;
      bx(fgroup, ax, 0, az, 1.4, 0.8, 0.5, mat(0x2b2d33));
      var glass = new T.Mesh(new T.BoxGeometry(1.4, 0.75, 0.5), new T.MeshStandardMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.35, roughness: 0.05, emissive: 0x2a6f97, emissiveIntensity: 0.4 }));
      glass.position.set(ax, 0.8 + 0.375, az); fgroup.add(glass);
      for (var f = 0; f < 5; f++) {
        var fish = new T.Mesh(new T.BoxGeometry(0.12, 0.07, 0.04), mat([0xff8a3d, 0xffd23f, 0xff4d6d, 0x41e0c8, 0xa77bff][f], { emissive: 0x331100, emissiveIntensity: 0.3 }));
        fish.position.set(ax, 0.95 + f * 0.1, az); fgroup.add(fish); fishes.push({ m: fish, ph: f * 1.3, cx: ax, cz: az, alongX: true });
      }
      act("aquarium", ax, az + 1.0, "🐠 Покормить рыбок (+15 ❤)", function () { FC.player.heal(15); toast("Рыбки довольны. И ты тоже", "ok"); });
    }
    if (have.indexOf("neon") >= 0) {                     // над диваном базового набора, на стене z1
      var neon = new T.Mesh(new T.PlaneGeometry(1.8, 0.6), canvasMat(360, 120, function (x, w, h) {
        x.fillStyle = "#12051a"; x.fillRect(0, 0, w, h); x.shadowColor = "#ff3df0"; x.shadowBlur = 18; x.fillStyle = "#ff7ae6";
        x.font = "800 60px system-ui"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("🔥 FLAME", w / 2, h / 2 + 4);
      }, true));
      neon.position.set(cx, 2.1, liv.z1 - 0.04); neon.rotation.y = Math.PI; fgroup.add(neon);
    }
    if (have.indexOf("luxbed") >= 0) {
      var R = bedr || liv, bcx = (R.x0 + R.x1) / 2, bz = R.z0 + 1.6;     // у стены z0 спальни (кровать базы — у z1)
      var gold = mat(0xd9b45a, { metalness: 0.7, roughness: 0.3 });
      bx(fgroup, bcx, 0, bz, 2.0, 0.5, 2.2, mat(0x7a1f3d)); bx(fgroup, bcx, 0, R.z0 + 0.5, 2.2, 1.3, 0.12, gold);
      bx(fgroup, bcx, 0.5, bz - 0.7, 1.7, 0.14, 0.45, mat(0xf5efe6));
      act("luxbed", bcx, bz + 1.6, "🛏️ Выспаться в люксе (сохранить, полное ❤)", function () {
        FC.setHour(FC.clock.hour + 8); FC.player.heal(9999); FC.saveNow();
        if (FC.hud) FC.hud.big("ВЫСПАЛСЯ КАК КОРОЛЬ", "Прогресс сохранён · +8 часов", "#ffcf7a", 2.6);
      });
    }
  }
  function tickFurniture(dt) {
    if (!fgroup) return;
    var t = performance.now() / 1000;
    fishes.forEach(function (f, i) {
      f.m.position.x = f.cx + Math.sin(t * 0.7 + f.ph) * 0.5; f.m.position.z = f.cz + Math.sin(t * 1.3 + i) * 0.1;
      f.m.rotation.y = Math.cos(t * 0.7 + f.ph) > 0 ? Math.PI / 2 : -Math.PI / 2;
    });
    tvT -= dt;
    if (tvCtx && tvT <= 0) {
      tvT = 2.5;
      var x = tvCtx, list = (FC.net && FC.net.citizens || []).filter(function (a) { return a.state === "work" && a.doing; });
      x.fillStyle = "#0b1020"; x.fillRect(0, 0, 256, 144);
      x.fillStyle = "#ff8a3d"; x.font = "800 16px system-ui"; x.fillText("ФЛЕЙМ ТВ · ПРЯМОЙ ЭФИР", 10, 22);
      x.fillStyle = "#fff"; x.font = "600 13px system-ui";
      var pick = list.length ? list[Math.floor(Math.random() * list.length)] : null;
      var lines = pick ? ["Агент «" + (creatureName(pick.creature) || "агент") + "»", "прямо сейчас: " + pick.doing.slice(0, 28)] : ["Город отдыхает.", "Скоро новые дела агентов!"];
      lines.forEach(function (l, i) { x.fillText(l, 10, 56 + i * 22); });
      x.fillStyle = "rgba(255,138,61,.5)"; x.fillRect(0, 128, 256 * ((t % 10) / 10), 4);
      tvTex.needsUpdate = true;
    }
  }

  /* ---- гараж и тюнинг -------------------------------------------------------------------------------------- */
  var TUNE = {
    engine: { name: "Мотор", lv: ["стоковый", "спорт", "гонка", "огонь"], price: [0, 1200, 2500, 5000] },
    nitro: { name: "Нитро", lv: ["бак ×1", "бак ×1,35", "бак ×1,7", "бак ×2"], price: [0, 1500, 3000, 6000] },
    armor: { name: "Броня", lv: ["нет", "лёгкая", "усиленная", "танк"], price: [0, 2000, 4000, 8000] },
    lower: { name: "Подвеска", lv: ["стоковая", "занижена"], price: [0, 800] }
  };
  var COLORS = [0xd7263d, 0xf46036, 0xffc21a, 0x1b998b, 0x3a86ff, 0x8338ec, 0xff006e, 0xe8e8e8, 0x1d1d1f, 0x2fbf71, 0xd9b45a, 0x00e5ff];
  function garage() { var g = FC.save.garage || (FC.save.garage = []); g.forEach(function (c, i) { if (c.type === "sports") c.type = "sport"; if (!c.id) c.id = "g" + FC.hash(c.type + ":" + i + ":" + (c.color || 0) + ":" + Date.now()).toString(36); }); return g; }
  // строка машины в гараже: класс и максималка из ростера (fcarlist.js)
  function carLine(c) { var i = FC.cars && FC.cars.info ? FC.cars.info(c.type) : null; return i ? " <span class='hm-pill'>" + i.cls + " · " + i.kmh + " км/ч</span>" : ""; }
  function tuneOf(id) { var t = FC.save.tune || (FC.save.tune = {}); return t[id] || (t[id] = { engine: 0, nitro: 0, armor: 0, lower: 0, color: null }); }
  function applyTune(car, id) {
    if (!car || !car.spec) return;
    var t = tuneOf(id), base = car.baseSpec || car.spec;
    car.baseSpec = base; car.garageId = id; car.owned = true;
    car.spec = Object.assign({}, base, {
      vmax: base.vmax * (1 + 0.07 * t.engine), accel: base.accel * (1 + 0.12 * t.engine),
      armor: (base.armor || 1) * (1 - 0.18 * t.armor), grip: base.grip * (1 + 0.08 * t.lower), roll: (base.roll || 1) * (t.lower ? 0.55 : 1)
    });
    car.tune = { nitroMul: 1 + 0.35 * t.nitro, armorMul: 1 - 0.18 * t.armor, color: t.color, lower: !!t.lower };
    if (t.color != null && FC.cars && FC.cars.setColor) FC.cars.setColor(car, t.color);
  }
  // нитро: модуль машин сжигает бак за 3 с — для тюнинга возвращаем часть и усиливаем буст (обёртка, fcars2 не трогаем)
  function wrapNitro() {
    var C = FC.cars; if (!C || !C.mod || C.mod._hm) return;
    var orig = C.mod;
    C.mod = function (car, inp, dt) {
      orig(car, inp, dt);
      if (car.tune && car.nitro && C.nitro) {
        var k = car.tune.nitroMul || 1;
        C.nitro.tank = Math.min(1, C.nitro.tank + dt / 3 * (1 - 1 / k));
        if (inp.boost) inp.boost *= 1 + 0.04 * (k - 1) / 0.35;
      }
    };
    C.mod._hm = true;
  }
  function nearTuneSpot() {
    var P = FC.player, p = M.poi("paint", P.x, P.z), h = FC.me && FC.me.ownsHome && FC.me.home;
    if (p && Math.hypot(p.x - P.x, p.z - P.z) < 40) return "Перекраска";
    if (h && Math.hypot(h.x - P.x, h.z - P.z) < 45) return "свой гараж";
    return null;
  }
  function carById(id) { return FC.cars && FC.cars.list ? FC.cars.list.filter(function (c) { return c.garageId === id && !c.dead; })[0] : null; }
  function buyTune(id, key, lv) {
    var t = tuneOf(id), cost = TUNE[key].price[lv];
    if (!nearTuneSpot()) { toast("Тюнинг — в Перекраске или у своего гаража", "bad", 2.6); return false; }
    if (lv <= t[key]) return false;
    if (FC.money(-cost, "тюнинг: " + TUNE[key].name) === false) { toast("Не хватает денег", "bad"); return false; }
    t[key] = lv; FC.dirty();
    var car = carById(id); if (car) applyTune(car, id);
    if (FC.audio) FC.audio.play("spray"); if (FC.fx) FC.fx.burst(FC.player.x, 1, FC.player.z, "sparks", 18);
    toast("🔧 " + TUNE[key].name + ": " + TUNE[key].lv[lv], "ok");
    return true;
  }
  function paint(id, hex) {
    if (!nearTuneSpot()) { toast("Покраска — в Перекраске или у своего гаража", "bad", 2.6); return false; }
    if (FC.money(-200, "тюнинг: цвет") === false) { toast("Не хватает денег", "bad"); return false; }
    tuneOf(id).color = hex; FC.dirty();
    var g = garage().filter(function (c) { return c.id === id; })[0]; if (g) g.color = hex;
    var car = carById(id); if (car) applyTune(car, id);
    if (FC.audio) FC.audio.play("spray");
    return true;
  }
  function deliverHome(i) {
    var c = garage()[i], B = FC.me && FC.me.home;
    if (!c || !FC.cars || !FC.cars.spawn) return;
    if (!B || !FC.me.ownsHome) { toast("Подать к дому можно, когда есть свой дом", ""); return; }
    var d = B.doors[0], L = M.nearestLane(d.x + d.nx * 8, d.z + d.nz * 8);
    if (!L) return;
    var old = carById(c.id); if (old && FC.cars.remove && FC.player.car !== old) FC.cars.remove(old);
    var car = FC.cars.spawn(c.type, L.x, L.z, Math.atan2(L.dx, L.dz), { owned: true, color: c.color });
    applyTune(car, c.id);
    FC.markers.add({ id: "hmcar", x: L.x, z: L.z, color: "#7dffb0", icon: "🚗", ring: 0, route: true });
    setTimeout(function () { FC.markers.remove("hmcar"); }, 40000);
    toast("🚗 " + (c.name || c.type) + " у твоего дома", "ok", 3);
  }
  // машины из автосалона (fjobs.deliverCar) — тоже с тюнингом: ищем запись гаража по типу и цвету
  FC.on("car:delivered", function (e) {
    if (!e || !e.car) return;
    var g = garage().filter(function (c) { return c.type === e.type && (c.color === e.car.color || c.color == null); })[0];
    if (g) applyTune(e.car, g.id);
  });
  FC.on("car:enter", function (e) {
    var car = e && e.car; if (!car || car.tune) return;
    if (car.garageId) applyTune(car, car.garageId);
  });
  function adoptCar() {
    var P = FC.player, car = P.car;
    if (!car || P.mode !== "car") { toast("Заезжай на машине", ""); return; }
    if (car.garageId) { toast("Эта машина уже в гараже", "ok"); return; }
    if (FC.police && FC.police.stars > 0) { toast("С розыском документы не оформят", "bad"); return; }
    if (garage().length >= 8) { toast("В гараже 8 мест — продай или отдай одну", "bad"); return; }
    if (FC.money(-800, "гараж: оформление") === false) { toast("Оформление стоит $800", "bad"); return; }
    var entry = { type: car.type, color: car.color, name: (car.spec && car.spec.name) || car.type };
    garage().push(entry); garage();
    applyTune(car, entry.id); FC.dirty();
    toast("📄 Документы готовы — машина твоя и в гараже", "ok", 3);
  }

  /* ---- точки тюнинга у Перекраски ------------------------------------------------------------------------- */
  function tuneProvider(px, pz, room) {
    if (room != null) return null;
    var out = [];
    M.pois.forEach(function (B) {
      if (B.poi !== "paint" || Math.abs(B.x - px) > 40 || Math.abs(B.z - pz) > 40) return;
      var d = B.doors[0], x = d.x + d.nz * 4.5 + d.nx * 3, z = d.z - d.nx * 4.5 + d.nz * 3;
      out.push({ id: "tune" + B.id, x: x, z: z, r: FC.player.mode === "car" ? 5 : 2, key: "use",
        label: FC.player.mode === "car" ? "🔧 Тюнинг-мастерская (своя машина) / оформить в гараж" : "🔧 Тюнинг-мастерская",
        act: function () {
          if (FC.player.mode === "car" && FC.player.car && !FC.player.car.garageId) adoptCar();
          openApp("garage");
        } });
    });
    return out;
  }

  /* ---- приложение «Недвижимость» ------------------------------------------------------------------------- */
  var tab = "mine";
  function openApp(t) { tab = t || tab; if (FC.hud && FC.hud.openPhone) FC.hud.openPhone("realty"); }
  function render(b, ctl) {
    var esc = FC.hud.esc;
    var tabs = [["mine", "Мои"], ["buy", "Купить"], ["furn", "Мебель"], ["garage", "Гараж"]];
    var html = "<div class='hm-tabs'>" + tabs.map(function (t) { return "<button type='button' data-tab='" + t[0] + "' class='" + (tab === t[0] ? "on" : "") + "'>" + t[1] + "</button>"; }).join("") + "</div><div class='list'>";
    // «Мои» и «Купить» (дома и нежилые обоих городов) рисует FC.prop (fprop.js) в свой блок
    if (tab === "mine" || tab === "buy") html += "<div id='hm-prop'></div>";
    else if (tab === "furn") {
      if (!primary()) html += "<div class='card'><b>Мебель — в свой дом</b><p>Сначала купи дом: мебель встанет в гостиной главной квартиры.</p></div>";
      FURN.forEach(function (f) {
        var own = furnOwned(f.id);
        html += "<div class='row'><span>" + f.icon + " " + esc(f.name) + "</span>" + (own ? "<span class='hm-pill ok'>дома</span>" :
          "<button type='button' data-furn='" + f.id + "'" + (!primary() || FC.save.money < f.price ? " disabled" : "") + ">" + money(f.price) + "</button>") + "</div>";
      });
    } else if (tab === "garage") {
      var where = nearTuneSpot();
      html += "<div class='card'><b>🔧 Тюнинг " + (where ? "<span class='hm-pill ok'>" + where + "</span>" : "<span class='hm-pill'>в Перекраске или у гаража</span>") + "</b><p>Мотор, нитро, броня, подвеска и цвет — на машину из гаража. Угнанную можно оформить в гараж в Перекраске за $800 (без розыска).</p></div>";
      var g = garage();
      if (!g.length) html += "<div class='card'><b>Гараж пуст</b><p>Купи машину в автосалоне «Искра Моторс» или оформи угнанную в Перекраске.</p></div>";
      g.forEach(function (c, i) {
        var t = tuneOf(c.id);
        html += "<div class='card'><b>🚗 " + esc(c.name || c.type) + carLine(c) + "</b><div class='hm-tune'>" +
          Object.keys(TUNE).map(function (k) {
            var lv = t[k], nx = lv + 1 < TUNE[k].lv.length ? lv + 1 : null;
            return "<span>" + TUNE[k].name + ": " + TUNE[k].lv[lv] + "</span>" + (nx != null ? "<button type='button' data-tune='" + c.id + ":" + k + ":" + nx + "'" + (!where ? " disabled" : "") + ">" + TUNE[k].lv[nx] + " · " + money(TUNE[k].price[nx]) + "</button>" : "<span class='hm-pill ok'>макс.</span>");
          }).join("") + "<span>Цвет · $200</span><span class='hm-sw'>" + COLORS.map(function (hex) {
            return "<i data-col='" + c.id + ":" + hex + "' style='background:#" + ("00000" + hex.toString(16)).slice(-6) + (t.color === hex ? ";border-color:#fff" : "") + "'></i>";
          }).join("") + "</span></div><div class='hm-row'><button type='button' data-home='" + i + "'>К дому</button><button type='button' class='ghost' data-here='" + i + "'>Сюда</button></div></div>";
      });
    }
    b.innerHTML = html + "</div>";
    function on(sel, fn) { b.querySelectorAll(sel).forEach(function (el) { el.addEventListener("click", function () { fn(el); }); }); }
    on("[data-tab]", function (el) { tab = el.dataset.tab; ctl.refresh(); });
    var pr = b.querySelector("#hm-prop"); if (pr && PR()) PR().renderTab(tab, pr, ctl);
    on("[data-furn]", function (el) { var f = FURN.filter(function (x) { return x.id === el.dataset.furn; })[0]; if (f) { buyFurn(f); ctl.refresh(); } });
    on("[data-tune]", function (el) { var p = el.dataset.tune.split(":"); if (buyTune(p[0], p[1], +p[2])) ctl.refresh(); });
    on("[data-col]", function (el) { var p = el.dataset.col.split(":"); if (paint(p[0], +p[1])) ctl.refresh(); });
    on("[data-home]", function (el) { ctl.close(); deliverHome(+el.dataset.home); });
    on("[data-here]", function (el) { ctl.close(); if (FC.jobs && FC.jobs.deliverCar) FC.jobs.deliverCar(+el.dataset.here); });
  }

  /* ---- жизнь модуля: вход, своё здание в интерьере, мебель -------------------------------------------- */
  // любой свой дом в интерьере — «мой» (ffurn ставит табличку и кровать на FC.me.home): подменяем на время визита
  function wrapInside() {
    var I = FC.inside; if (!I || !I.enter || I.enter._hm) return;
    var orig = I.enter;
    I.enter = function (B) {
      if (B && mineB(B) && PR().classOf(B) && PR().classOf(B).cls === "res" && FC.me) { FC.me.home = B; }
      return orig.apply(I, arguments);
    };
    I.enter._hm = true;
  }
  FC.on("inside:floor", function (e) {
    flat.b = e && e.building; flat.f = e ? e.floor : null;
    // интерьер достраивается в этом же кадре — ставим мебель следующим, когда FC.inside уже на новом этаже
    clearFurniture();
    if (inMyFlat()) setTimeout(function () { if (inMyFlat()) placeFurniture(); }, 0);
  });
  FC.on("inside:exit", function () { flat.b = null; clearFurniture(); applyHome(); });
  FC.on("me", function () { defaultHome = null; });          // свои дома запрашивает FC.prop, ответ — событие prop:mine
  FC.on("start", function () {
    wrapInside(); wrapNitro();
    // появиться у своего главного дома (если включено и дом есть): ждём, пока сервер ответит про дома
    var tries = 0, iv = setInterval(function () {
      if (++tries > 20 || H.loaded) clearInterval(iv);
      if (!H.loaded) return;
      var p = primary();
      if (p && FC.save.flags.homeSpawn !== false && !FC.save.tutorial && FC.player && FC.player.mode === "foot" && !(FC.inside && FC.inside.active)) {
        var d = PR().door(p); if (!d) return;
        FC.player.teleport(d.x, d.z, d.h);
        toast("🏠 С возвращением домой", "ok");
      }
    }, 500);
  });
  var homeT = 2;
  FC.addSystem({
    name: "home", order: 58,
    init: function () {
      if (FC.interact) FC.interact.provider(tuneProvider);    // двери своих и продающихся домов — FC.prop
    },
    update: function (dt) {
      tickFurniture(dt);
      // Минск: главный дом найдётся, когда загрузится его кусок города
      homeT -= dt;
      if (homeT <= 0) { homeT = 2; if (FC.me && FC.me.ownsHome && !FC.me.home) applyHome(); }
    }
  });
  if (FC.hud) {
    FC.hud.addApp({ id: "realty", icon: "🏠", name: "Недвижимость", color: "#2f9e6e", order: 12, render: render });
  }

  FC.home = {
    priceOf: function (B) { return PR().priceOf(B, "res"); }, buy: function (B) { return PR().buy(B); }, sell: function (p) { return PR().sell(p); },
    taken: function () { return PR().taken(); }, mine: function () { return PR().mine("res"); },
    primary: primary, refresh: function () { return PR().refresh(); }, open: openApp,
    applyTune: applyTune, tuneOf: tuneOf, garage: garage, deliverHome: deliverHome, adopt: adoptCar, FURN: FURN, TUNE: TUNE, _state: H,
    furnitureCount: function () { return fgroup ? fgroup.children.length : 0; },
    _debug: function () { return { flat: flat.b && flat.b.id, f: flat.f, home: flat.b && homeFloor(flat.b), my: inMyFlat(), act: FC.inside.active }; },
    _place: function () { placeFurniture(); }
  };
})(window);
