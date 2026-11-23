/* Флейм-Сити — наборы мебели для интерьеров (finside.js): по типу комнаты — что стоит, где сидят люди, что можно
 * сделать. Всё из коробок и цилиндров (ctx.box / ctx.cyl / ctx.glow — светящееся), места для людей (ctx.seat),
 * сотрудники (ctx.npc), взаимодействия (ctx.act), вывески (ctx.sign). Координаты — план этажа: вход к -z.
 *
 * Здания-зоны мира агентов (z:<зона>) — свой интерьер под то, что агенты там делают: павильон со светом для
 * «Съёмочной», монтажные с таймлайнами, рилс-студия с кольцевыми лампами, проявочная с экранами прогресса… и стойка
 * возможности — что здесь делают и «Поработать здесь».
 */
(function (global) {
  "use strict";
  var FC = global.FC;
  var SP = function () { return FC.people.SPECIAL; };

  /* ---- помощники ---------------------------------------------------------------------------------------- */
  function inner(o, m) { return { x0: o.x0 + m, x1: o.x1 - m, z0: o.z0 + m, z1: o.z1 - m, w: o.x1 - o.x0 - 2 * m, d: o.z1 - o.z0 - 2 * m, cx: (o.x0 + o.x1) / 2, cz: (o.z0 + o.z1) / 2 }; }
  function shade(hex, k) { return FC.gfx.tex.shade(hex, k); }
  // стол со стулом; face: 1 — человек сидит со стороны +z (смотрит к -z), -1 — со стороны -z
  function desk(ctx, x, z, face, opt) {
    opt = opt || {};
    if (!ctx.box(x, z, 1.5, 0.75, 0.05, 0.72, opt.top || "#d9d2c3")) return false;
    ctx.box(x, z - face * 0.3, 1.4, 0.05, 0.7, 0, opt.leg || "#8a8f96", { solid: false });
    var mz = z - face * 0.22;
    ctx.glow(x - (opt.dual ? 0.3 : 0), mz, 0.52, 0.03, 0.32, 0.86, opt.screen || "#9fd3ff");
    if (opt.dual) ctx.glow(x + 0.3, mz, 0.52, 0.03, 0.32, 0.86, opt.screen2 || "#ffb35c");
    ctx.box(x, mz + face * 0.02, 0.08, 0.06, 0.14, 0.77, "#30343a", { solid: false });
    var cz = z + face * 0.75;
    ctx.cyl(x, cz, 0.26, 0.08, 0.42, opt.chair || "#30343a", { solid: false });
    ctx.box(x, cz + face * 0.3, 0.44, 0.06, 0.26, 0.5, opt.chair || "#30343a", { solid: false });   // низкая спинка — не закрывает сидящего
    ctx.seat(x, cz, face, "desk");
    return true;
  }
  // сетка столов парами «спина к спине» по всей комнате
  function pods(ctx, o, opt) {
    opt = opt || {};
    var I = inner(o, 1.3), n = 0;
    var pitchX = 1.75, pitchZ = 3.4;
    for (var z = I.z0 + 1.2; z < I.z1 - 0.8; z += pitchZ) {
      for (var x = I.x0 + 0.8; x < I.x1 - 0.7; x += pitchX) {
        if (desk(ctx, x, z, -1, opt)) n++;
        if (z + 0.8 < I.z1 - 0.5 && desk(ctx, x, z + 0.8, 1, opt)) n++;
      }
      if (opt.accent) ctx.glow(I.cx, z + 0.4, Math.max(0, I.w - 1), 0.05, 0.03, 0.02, opt.accent);
    }
    return n;
  }
  function plant(ctx, x, z, big) {
    var k = big ? 1.4 : 1;
    if (!ctx.cyl(x, z, 0.28 * k, 0.45 * k, 0, "#6d5a4a")) return;
    ctx.cyl(x, z, 0.42 * k, 0.9 * k, 0.45 * k, "#3f7f45", { solid: false });
    ctx.cyl(x, z, 0.3 * k, 0.4 * k, 1.3 * k, "#4f9a52", { solid: false });
  }
  function sofa(ctx, x, z, rot, color) {
    color = color || "#5a6b8c";
    if (!ctx.box(x, z, 2.0, 0.9, 0.42, 0, color, { rot: rot })) return;
    if (rot) ctx.box(x + 0.38 * (rot > 0 ? 1 : -1), z, 0.16, 2.0, 0.42, 0.42, shade(color, -0.2), { solid: false });
    else ctx.box(x, z + 0.38, 2.0, 0.16, 0.42, 0.42, shade(color, -0.2), { solid: false });
    ctx.seat(x, z, 0, "chair");
  }
  function table(ctx, x, z, w, d, color) { return ctx.box(x, z, w, d, 0.74, 0, color || "#a0764f"); }
  function chairsAround(ctx, x, z, w, d) {
    for (var i = 0; i < Math.floor(w / 0.8); i++) {
      var cx = x - w / 2 + 0.4 + i * 0.8;
      ctx.cyl(cx, z - d / 2 - 0.4, 0.22, 0.45, 0, "#3a3f47", { solid: false }); ctx.seat(cx, z - d / 2 - 0.4, 1, "chair");
      ctx.cyl(cx, z + d / 2 + 0.4, 0.22, 0.45, 0, "#3a3f47", { solid: false }); ctx.seat(cx, z + d / 2 + 0.4, -1, "chair");
    }
  }
  function tvWall(ctx, o, color) {
    // экран на дальней от входа стене комнаты
    var I = inner(o, 0.25);
    ctx.box(I.cx, I.z1 - 0.06, Math.min(3.2, I.w * 0.6), 0.08, 1.8, 0.9, "#111", { solid: false });
    ctx.glow(I.cx, I.z1 - 0.12, Math.min(3.0, I.w * 0.56), 0.02, 1.6, 1.0, color || "#3b6fd6");
  }
  function shelfRow(ctx, x0, x1, z, colorful) {
    for (var x = x0; x < x1 - 0.85; x += 0.95) {
      if (!ctx.box(x + 0.45, z, 0.9, 0.38, 2.0, 0, "#7a6048")) continue;
      for (var k = 0; k < 4; k++) ctx.box(x + 0.45, z, 0.8, 0.3, 0.32, 0.12 + k * 0.48, colorful ? FC.rng(x * 100 + k)() < 0.5 ? "#c0392b" : "#2e86de" : "#d8c9a6", { solid: false });
    }
  }
  function vending(ctx, x, z) {
    if (!ctx.box(x, z, 1.0, 0.8, 1.9, 0, "#c0392b")) return false;
    ctx.glow(x, z - 0.41, 0.7, 0.02, 1.2, 0.5, "#ffe3b0");
    ctx.act(x, z - 1.0, "Автомат: перекус — $5", function () {
      if (FC.money(-5, "перекус") === false) { FC.hud.toast("Не хватает денег", "bad", 2); return; }
      FC.player.heal(20); FC.hud.toast("🥤 +20 здоровья", "ok", 2); if (FC.audio) FC.audio.play("cash");
    }, 1.4);
    return true;
  }
  function atm(ctx, x, z) {
    if (!ctx.box(x, z, 0.75, 0.6, 1.6, 0, "#3a4a5a")) return;
    ctx.glow(x, z - 0.31, 0.45, 0.02, 0.32, 1.05, "#7dffb0");
    ctx.act(x, z - 0.9, "Банкомат", function () { if (FC.jobs && FC.jobs.atm) FC.jobs.atm(); else FC.hud.toast("Банкомат пока не работает", "", 2); }, 1.3);
  }
  function counter(ctx, x, z, w, color, label, fn, npcCell, npcOpt) {
    if (!ctx.box(x, z, w, 0.7, 1.05, 0, color || "#8b5e3c", { force: true })) return;
    ctx.box(x, z, w + 0.1, 0.8, 0.05, 1.05, shade(color || "#8b5e3c", 0.35), { solid: false });
    if (npcCell != null) ctx.npc(x, z + 0.9, npcCell, npcOpt || {});
    if (label) ctx.act(x, z - 1.0, label, fn, 1.6);
  }
  function shopAct(B) { return function () { if (FC.jobs && FC.jobs.shop) FC.jobs.shop(B); else FC.hud.toast("Касса скоро откроется", "", 2); }; }
  function rnd(ctx) { return FC.people.randomCell(ctx.r); }
  function bed(ctx, x, z, w, color, act) {
    if (!ctx.box(x, z, w, 2.0, 0.35, 0, "#6b4a33")) return;
    ctx.box(x, z + 0.1, w - 0.08, 1.75, 0.18, 0.35, "#f4f1ea", { solid: false });
    ctx.box(x, z + 0.45, w - 0.12, 1.0, 0.06, 0.53, color || "#4f6fa8", { solid: false });
    ctx.box(x, z - 0.75, w - 0.3, 0.35, 0.12, 0.53, "#ffffff", { solid: false });
    ctx.box(x, z - 1.02, w, 0.08, 0.9, 0, "#5b3e2b", { solid: false });
    ctx.seat(x, z, 0, "bed");
    if (act) ctx.act(x, z - 1.4, act[0], act[1], 1.6);
  }
  function sleep(price) {
    return function () {
      if (price && FC.money(-price, "отель") === false) { FC.hud.toast("Не хватает денег", "bad", 2); return; }
      FC.setHour(FC.clock.hour + 8); FC.player.heal(100); FC.save.lastSleep = { b: FC.inside.building.id };
      FC.saveNow(); FC.hud.big("ВЫСПАЛСЯ", "Прогресс сохранён · +8 часов", "#ffcf7a", 2.6);
    };
  }
  function homeFloor(B) { return B.floors > 1 ? 1 + (FC.hash(FC.me ? FC.me.rid : "g") % (B.floors - 1)) : 0; }
  function isMyHome(ctx) { return FC.me && FC.me.home === ctx.B && ctx.f === homeFloor(ctx.B); }
  function lineSet(name) { return FC.inside.LINES[name]; }

  /* ---- комнаты офиса ------------------------------------------------------------------------------------- */
  var K = {};
  K.open = function (o, ctx) {
    var col = ctx.info.color || "#5b8cff";
    pods(ctx, o, { accent: col, screen: "#9fd3ff" });
    var I = inner(o, 0.6);
    plant(ctx, I.x0 + 0.2, I.z0 + 0.2); plant(ctx, I.x1 - 0.2, I.z1 - 0.2);
  };
  K.office = function (o, ctx) {
    var I = inner(o, 0.9);
    if (I.w < 1.5 || I.d < 1.5) return;
    var n = I.w > 4 ? 2 : 1;
    for (var i = 0; i < n; i++) desk(ctx, I.x0 + (i + 0.5) * I.w / n, I.cz - 0.3, 1, { top: "#c8b08a" });
    shelfRow(ctx, I.x0, Math.min(I.x1, I.x0 + 2), I.z1 - 0.1, true);
    plant(ctx, I.x1 - 0.2, I.z1 - 0.2);
  };
  K.meeting = function (o, ctx) {
    var I = inner(o, 1.1);
    var w = Math.min(4.2, I.w - 0.4), d = Math.min(1.3, I.d - 1.6);
    if (w < 1.2 || d < 0.7) return K.office(o, ctx);
    table(ctx, I.cx, I.cz, w, d, "#3d3a36");
    chairsAround(ctx, I.cx, I.cz, w, d);
    tvWall(ctx, o, "#2a59b8");
  };
  K.kitchen = function (o, ctx) {
    var I = inner(o, 0.4);
    for (var x = I.x0 + 0.4; x < I.x1 - 0.5; x += 0.62) ctx.box(x + 0.3, I.z1 - 0.32, 0.6, 0.6, 0.9, 0, "#e9e4da");
    ctx.box(I.x0 + 0.7, I.z1 - 0.38, 0.4, 0.35, 0.45, 0.9, "#222", { solid: false });
    ctx.glow(I.x0 + 0.7, I.z1 - 0.56, 0.1, 0.02, 0.06, 1.2, "#ff3b3b");
    if (!vending(ctx, I.x1 - 0.6, I.z0 + 0.5 + 0.8)) vending(ctx, I.cx, I.cz);
    if (I.d > 3) { ctx.cyl(I.cx - 0.6, I.cz - 0.3, 0.45, 0.74, 0, "#ffffff"); ctx.seat(I.cx - 0.6, I.cz + 0.4, 0, "chair"); }
  };
  K.server = function (o, ctx) {
    var I = inner(o, 0.8);
    for (var z = I.z0 + 0.6; z < I.z1 - 0.4; z += 2.0) {
      for (var x = I.x0 + 0.3; x < I.x1 - 0.3; x += 0.62) {
        if (ctx.box(x + 0.3, z, 0.6, 1.0, 2.0, 0, "#1c1f24")) ctx.glow(x + 0.3, z - 0.51, 0.4, 0.02, 0.06, 0.4 + FC.rng(x * 7 + z)() * 1.3, FC.rng(x + z * 3)() < 0.7 ? "#2bff6a" : "#ffb02e");
      }
    }
  };
  K.wc = function (o, ctx) {
    var I = inner(o, 0.3);
    for (var x = I.x0 + 0.6; x < I.x1 - 0.5; x += 1.1) {
      ctx.cyl(x, I.z1 - 0.4, 0.22, 0.42, 0, "#ffffff");
      ctx.box(x + 0.55, I.z1 - 0.7, 0.05, 1.4, 1.9, 0, "#9aa7b4", { solid: false });
    }
    ctx.box(I.cx, I.z0 + 0.35, Math.min(2.4, I.w - 0.4), 0.5, 0.85, 0, "#eef2f5");
    ctx.glow(I.cx, I.z0 + 0.06, Math.min(2.2, I.w - 0.5), 0.02, 0.8, 1.2, "#cfe8ff");
  };
  K.storage = function (o, ctx) {
    var I = inner(o, 0.3);
    shelfRow(ctx, I.x0, I.x1, I.z1 - 0.25, false);
    for (var i = 0; i < 5; i++) ctx.box(I.x0 + 0.5 + ctx.r() * Math.max(0.1, I.w - 1), I.z0 + 0.6 + ctx.r() * Math.max(0.1, I.d - 2), 0.6, 0.5, 0.5, 0, "#b08a5a");
  };
  K.mail = function (o, ctx) {
    var I = inner(o, 0.25);
    for (var r = 0; r < 4; r++) for (var c = 0; c < Math.min(8, Math.floor(I.w / 0.4)); c++) ctx.box(I.x0 + 0.25 + c * 0.4, I.z1 - 0.15, 0.36, 0.22, 0.28, 0.6 + r * 0.32, "#8f9aa5", { solid: false });
    ctx.box(I.cx, I.z1 - 0.15, Math.min(3.2, I.w), 0.24, 1.3, 0.55, "#5d666f");
  };
  K.cafe = function (o, ctx) {
    var I = inner(o, 0.8);
    counter(ctx, I.cx, I.z1 - 0.9, Math.min(3.2, I.w - 0.5), "#6b3f22", "Кафе: перекусить", shopAct(ctx.B), rnd(ctx), { line: lineSet("shop") });
    for (var x = I.x0 + 0.8; x < I.x1 - 0.6; x += 1.8) for (var z = I.z0 + 0.8; z < I.z1 - 2.4; z += 1.8) {
      if (ctx.cyl(x, z, 0.4, 0.74, 0, "#e9e4da")) { ctx.cyl(x + 0.62, z, 0.2, 0.45, 0, "#3a3f47", { solid: false }); ctx.seat(x + 0.62, z, 0, "chair"); }
    }
  };

  /* ---- лобби ------------------------------------------------------------------------------------------- */
  K.lobby = function (o, ctx) {
    var I = inner(o, 1.0), B = ctx.B;
    // стойка ресепшн лицом ко входу, за ней — стена с названием
    var rz = Math.min(I.z1 - 1.4, I.z0 + Math.max(4.5, I.d * 0.55));
    counter(ctx, I.cx + (I.w > 10 ? 3 : 0), rz, 3.0, "#2f3a48", null, null, rnd(ctx), { line: ["Добрый день!", "Вам на какой этаж?", "Распишитесь, пожалуйста."] });
    ctx.sign(I.cx + (I.w > 10 ? 3 : 0), rz + 1.5, 2.6, 4.2, Math.PI, B.name.slice(0, 22), "🏢", "#3a4f6a");
    sofa(ctx, I.x0 + 1.6, I.z0 + 3.2, 0, "#7a5c45"); sofa(ctx, I.x0 + 1.6, I.z0 + 6.0, 0, "#7a5c45");
    ctx.box(I.x0 + 1.6, I.z0 + 4.6, 1.2, 0.7, 0.42, 0, "#3b332c");
    plant(ctx, I.x0 + 0.3, I.z0 + 0.4, true); plant(ctx, I.x1 - 0.3, I.z0 + 0.4, true);
    atm(ctx, I.x1 - 0.5, I.z0 + 3.5);
    // турникеты
    for (var k = -1; k <= 1; k++) ctx.box(I.cx + k * 1.1 - (I.w > 10 ? 3 : 0), rz + 1.8, 0.2, 1.0, 1.0, 0, "#9aa5b1");
  };
  K.lobbyres = function (o, ctx) {
    var I = inner(o, 0.6);
    K.mail({ x0: I.x0, x1: Math.min(I.x1, I.x0 + 3.6), z0: I.z0, z1: I.z1 }, ctx);
    ctx.box(I.x1 - 1.2, I.cz, 1.6, 0.6, 0.45, 0, "#7a5c45");
    plant(ctx, I.x1 - 0.4, I.z1 - 0.4);
    if (I.w > 5) counter(ctx, I.cx, I.z0 + 2.2, 1.6, "#5a4a3a", null, null, rnd(ctx), { line: ["Вы к кому?", "Лифт справа.", "Тапочки не забудьте."] });
  };

  /* ---- квартиры ----------------------------------------------------------------------------------------- */
  K.living = function (o, ctx) {
    var I = inner(o, 0.5);
    if (I.w < 1.6 || I.d < 1.6) return;
    ctx.box(I.cx, I.cz, Math.min(2.6, I.w - 0.6), Math.min(1.8, I.d - 0.8), 0.02, 0.0, ["#7a3f3f", "#3f5a7a", "#6a7a3f"][ctx.r.int(0, 2)], { solid: false });
    sofa(ctx, I.cx, I.cz + Math.min(1.1, I.d / 2 - 0.5), 0, ["#5a6b8c", "#8c5a5a", "#6b8c5a"][ctx.r.int(0, 2)]);
    ctx.box(I.cx, I.cz - 0.1, 0.9, 0.5, 0.4, 0, "#3b332c");
    ctx.box(I.cx, I.z0 + 0.2, 1.6, 0.4, 0.5, 0, "#2e2a26");
    ctx.glow(I.cx, I.z0 + 0.2, 1.3, 0.04, 0.75, 0.55, "#4d7fd6");
    shelfRow(ctx, I.x1 - 1.0, I.x1, I.z1 - 0.2, true);
    plant(ctx, I.x0 + 0.25, I.z1 - 0.25);
    if (ctx.r() < 0.5) ctx.npc(I.cx + 0.4, I.cz + Math.min(1.1, I.d / 2 - 0.5), rnd(ctx), { line: lineSet("res") });
  };
  K.bedroom = function (o, ctx) {
    var I = inner(o, 0.4);
    if (I.w < 2 || I.d < 2.3) return K.storage(o, ctx);
    var mine = isMyHome(ctx);
    bed(ctx, I.cx, I.z1 - 1.05, Math.min(1.6, I.w - 1.2), mine ? "#ff9b4a" : null, mine ? ["Поспать дома (сохранить)", sleep(0)] : null);
    ctx.box(I.cx - Math.min(1.6, I.w - 1.2) / 2 - 0.3, I.z1 - 0.3, 0.45, 0.4, 0.5, 0, "#6b4a33");
    ctx.glow(I.cx - Math.min(1.6, I.w - 1.2) / 2 - 0.3, I.z1 - 0.3, 0.2, 0.2, 0.25, 0.55, "#ffd9a0");
    ctx.box(I.x0 + 0.35, I.z0 + 0.9, 0.6, 1.2, 2.1, 0, "#8a6a4a");
    if (mine) ctx.sign(I.cx, I.z1 - 0.08, 2.1, 1.8, Math.PI, "ТВОЙ ДОМ", "🏠", "#ff8a3d");
  };
  K.kitchenres = function (o, ctx) {
    var I = inner(o, 0.35);
    for (var x = I.x0 + 0.3; x < I.x1 - 0.4; x += 0.62) ctx.box(x + 0.3, I.z1 - 0.3, 0.6, 0.6, 0.9, 0, "#efe9df");
    ctx.box(I.x0 + 0.4, I.z1 - 0.35, 0.7, 0.7, 1.85, 0, "#f7f7f7");
    ctx.glow(I.cx, I.z1 - 0.3, 0.5, 0.4, 0.01, 0.91, "#ff5a2a");
    table(ctx, I.cx, I.cz - 0.3, Math.min(1.2, I.w - 1), 0.8, "#c8a87a");
    ctx.cyl(I.cx - 0.6, I.cz - 0.3, 0.2, 0.45, 0, "#6b4a33", { solid: false }); ctx.seat(I.cx - 0.6, I.cz - 0.3, 0, "chair");
  };
  K.bath = function (o, ctx) {
    var I = inner(o, 0.25);
    ctx.box(I.x0 + 0.85, I.z1 - 0.4, 1.6, 0.7, 0.55, 0, "#ffffff");
    ctx.glow(I.x0 + 0.85, I.z1 - 0.4, 1.4, 0.5, 0.01, 0.56, "#9fd3ff");
    ctx.cyl(I.x1 - 0.35, I.z1 - 0.35, 0.22, 0.42, 0, "#ffffff");
    ctx.box(I.x1 - 0.35, I.z0 + 0.4, 0.55, 0.45, 0.85, 0, "#eef2f5");
  };
  K.studioapt = function (o, ctx) {
    var I = inner(o, 0.6);
    var half = { x0: o.x0, x1: (o.x0 + o.x1) / 2, z0: o.z0, z1: o.z1 }, half2 = { x0: (o.x0 + o.x1) / 2, x1: o.x1, z0: o.z0, z1: o.z1 };
    K.living(half, ctx); K.bedroom(half2, ctx);
    if (I.d > 6) K.kitchenres({ x0: o.x0, x1: half.x1, z0: o.z1 - 3, z1: o.z1 }, ctx);
  };
  K.hotel = function (o, ctx) {
    var I = inner(o, 0.4);
    if (I.w < 2 || I.d < 2.3) return K.storage(o, ctx);
    bed(ctx, I.cx, I.z1 - 1.05, Math.min(1.6, I.w - 1.0), "#7a3f3f", ["Снять номер и поспать — $80", sleep(80)]);
    ctx.box(I.x1 - 0.4, I.z0 + 0.8, 0.6, 1.0, 0.75, 0, "#5b3e2b");
    ctx.glow(I.x0 + 0.2, I.cz, 0.05, 1.0, 0.6, 1.1, "#4d7fd6");
  };

  /* ---- больница, участок ---------------------------------------------------------------------------- */
  K.ward = function (o, ctx) {
    var I = inner(o, 0.5);
    for (var x = I.x0 + 0.6; x < I.x1 - 0.5; x += 1.7) {
      if (!ctx.box(x, I.z1 - 1.0, 0.95, 2.0, 0.6, 0, "#e0e6ea")) continue;
      ctx.box(x, I.z1 - 1.0, 0.9, 1.9, 0.12, 0.6, "#ffffff", { solid: false });
      ctx.glow(x + 0.55, I.z1 - 0.15, 0.3, 0.05, 0.22, 1.3, "#2bff6a");
      ctx.box(x + 0.85, I.z1 - 1.0, 0.03, 1.8, 2.0, 0, "#9fd8c8", { solid: false });
      if (ctx.r() < 0.4) ctx.npc(x, I.z1 - 1.0, rnd(ctx), { line: ["Ой…", "Когда выпишут?", "Чай принесите."] });
    }
  };
  K.nurse = function (o, ctx) {
    var I = inner(o, 0.8);
    counter(ctx, I.cx, I.cz, Math.min(2.6, I.w - 0.4), "#d7e6e1", "Лечение — $50", heal(50), SP().medic, { line: lineSet("medic") });
  };
  function heal(price) {
    return function () {
      if (FC.player.hp >= 99) { FC.hud.toast("Ты и так здоров", "", 2); return; }
      if (FC.money(-price, "лечение") === false) { FC.hud.toast("Не хватает денег", "bad", 2); return; }
      FC.player.heal(100); FC.hud.toast("🩹 Здоровье восстановлено", "ok", 2);
    };
  }
  K.cell = function (o, ctx) {
    var I = inner(o, 0.2);
    // решётка на стороне входа (коридор — к центру этажа, у полосы это внутренний край)
    for (var x = I.x0 + 0.1; x < I.x1; x += 0.14) ctx.cyl(x, I.cz, 0.02, 2.4, 0, "#5a6068", { solid: false });
    ctx.box(I.cx, I.z1 - 0.35, Math.min(1.8, I.w - 0.4), 0.55, 0.45, 0, "#6b6f75");
    if (ctx.r() < 0.5) ctx.npc(I.cx, I.z1 - 0.6, rnd(ctx), { line: ["Я ни при чём!", "Позовите адвоката.", "Это не моя машина."] });
  };
  K.interrogation = function (o, ctx) {
    var I = inner(o, 0.8);
    table(ctx, I.cx, I.cz, 1.4, 0.8, "#55595f");
    ctx.cyl(I.cx, I.cz - 0.8, 0.22, 0.45, 0, "#3a3f47", { solid: false }); ctx.cyl(I.cx, I.cz + 0.8, 0.22, 0.45, 0, "#3a3f47", { solid: false });
    ctx.glow(I.cx, I.cz, 0.3, 0.3, 0.05, 2.6, "#fff4dc");
    ctx.glow(I.x0 + 0.05, I.cz, 0.02, Math.min(2.4, I.d - 0.4), 1.2, 1.0, "#1b2230");
    ctx.npc(I.cx, I.cz + 0.8, SP().cop, { title: "cop", line: lineSet("cop") });
  };
  K.bullpen = function (o, ctx) {
    pods(ctx, o, { top: "#b7c2cf", accent: "#2f6fd6" });
    var I = inner(o, 0.8);
    ctx.npc(I.cx, I.cz, SP().cop, { title: "cop", line: lineSet("cop") });
  };

  /* ---- точки города (залы на 1-м этаже) --------------------------------------------------------------- */
  K.store = function (o, ctx) {
    var I = inner(o, 0.9), B = ctx.B;
    counter(ctx, I.x0 + 1.6, I.z0 + 2.0, 2.4, "#3a6a4a", "Касса: купить", shopAct(B), rnd(ctx), { line: lineSet("shop") });
    for (var x = I.x0 + 4; x < I.x1 - 1; x += 2.2) {
      for (var z = I.z0 + 1.5; z < I.z1 - 2.2; z += 2.6) {
        if (!ctx.box(x, z, 1.2, 1.8, 1.5, 0, "#e9e9e4", { rot: 0 })) continue;
        for (var k = 0; k < 3; k++) ctx.box(x, z, 1.24, 1.84, 0.12, 0.35 + k * 0.42, ["#e74c3c", "#f1c40f", "#3498db", "#2ecc71"][(k + Math.floor(x)) % 4], { solid: false });
      }
    }
    for (var fx = I.x0 + 0.5; fx < I.x1 - 0.5; fx += 1.0) {
      if (ctx.box(fx + 0.45, I.z1 - 0.4, 0.95, 0.7, 2.0, 0, "#cfd8e0")) ctx.glow(fx + 0.45, I.z1 - 0.76, 0.85, 0.02, 1.7, 0.2, "#dff3ff");
    }
    atm(ctx, I.x0 + 0.5, I.z0 + 4.2);
  };
  K.gas = K.store;
  K.bank = function (o, ctx) {
    var I = inner(o, 0.9), B = ctx.B;
    var tz = I.z0 + Math.max(4, I.d * 0.55);
    for (var x = I.x0 + 1.5; x < I.x1 - 1.4; x += 2.4) {
      ctx.box(x, tz, 2.2, 0.8, 1.1, 0, "#c9b48a", { force: true });
      ctx.box(x, tz, 2.2, 0.05, 1.1, 1.1, "#bfe0f0", { solid: false });
      ctx.npc(x, tz + 0.9, rnd(ctx), { line: ["Следующий!", "Ваш паспорт?", "Курс сегодня отличный."] });
    }
    columns(ctx, I.x0, I.x1, tz);
    for (var q = 0; q < 4; q++) ctx.cyl(I.cx - 1.5 + q, tz - 2.0, 0.06, 1.0, 0, "#c9a14a", { solid: false });
    ctx.act(I.cx, tz - 1.0, "Окошко банка", shopAct(B), 1.8);
    atm(ctx, I.x0 + 0.5, I.z0 + 1.6); atm(ctx, I.x1 - 0.5, I.z0 + 1.6);
    plant(ctx, I.x0 + 0.3, I.z1 - 0.3, true); plant(ctx, I.x1 - 0.3, I.z1 - 0.3, true);
    ctx.sign(I.cx, I.z1 - 0.1, 3.0, 5, Math.PI, "ФЛЕЙМ-БАНК", "💰", "#2fbf71");
  };
  function columns(ctx, x0, x1, z) { for (var x = x0 + 0.3; x < x1; x += 4.8) ctx.cyl(x, z + 2.2, 0.35, ctx.hc, 0, "#e9e1cf"); }
  K.vault = function (o, ctx) {
    var I = inner(o, 0.4), B = ctx.B;
    for (var x = I.x0 + 0.2; x < I.x1 - 0.2; x += 0.34) for (var r = 0; r < 6; r++) ctx.box(x + 0.17, I.z1 - 0.12, 0.3, 0.2, 0.3, 0.2 + r * 0.34, "#a9b0b8", { solid: false });
    ctx.box(I.cx, I.z1 - 0.2, I.w, 0.3, 2.2, 0, "#7d848c", { force: true });
    // круглая дверь сейфа — диск из цилиндров, «ось» вдоль z имитируем коробками
    ctx.box(I.cx, I.cz + 1.5, 2.6, 0.6, 2.6, 0, "#c0c6cc", { force: true });
    ctx.glow(I.cx, I.cz + 1.18, 0.12, 0.02, 2.2, 0.2, "#2bff6a"); ctx.glow(I.cx, I.cz + 1.18, 2.2, 0.02, 0.12, 1.25, "#2bff6a");
    ctx.act(I.cx, I.cz + 0.4, "Сейф хранилища", function () {
      FC.emit("inside:safe", { building: B });
      if (!(FC.story && FC.story.active)) FC.hud.toast("🔐 Сейф заперт. Без плана сюда не попасть.", "", 3);
    }, 1.8);
    for (var k = 0; k < 5; k++) { var px = I.x0 + 1 + k * 1.4; if (px < I.x1 - 0.8) { ctx.box(px, I.z0 + 1.2, 1.0, 1.0, 0.8, 0, "#3f8f4f"); ctx.box(px, I.z0 + 1.2, 0.4, 0.2, 0.12, 0.8, "#ffd23f", { solid: false }); } }
    ctx.glow(I.cx, I.z0 + 3.0, I.w - 0.4, 0.02, 0.02, 0.6, "#ff2a2a"); ctx.glow(I.cx, I.z0 + 3.0, I.w - 0.4, 0.02, 0.02, 1.2, "#ff2a2a");
    ctx.mark("safe", I.cx, I.cz + 0.4);
  };
  K.police = function (o, ctx) {
    var I = inner(o, 0.9);
    counter(ctx, I.cx, I.z0 + 3.2, 3.0, "#2f4a7a", "Дежурная часть: оплатить штраф", payFine, SP().cop, { title: "cop", line: lineSet("cop") });
    for (var x = I.x0 + 0.8; x < I.x1 - 0.5; x += 0.7) { ctx.cyl(x, I.z0 + 0.6, 0.22, 0.45, 0, "#3a4a6a", { solid: false }); }
    var back = { x0: o.x0, x1: o.x1, z0: I.z0 + 5, z1: o.z1 };
    if (back.z1 - back.z0 > 4) pods(ctx, back, { top: "#b7c2cf", accent: "#2f6fd6" });
    ctx.sign(I.cx, I.z0 + 4.2, 2.6, 3.6, Math.PI, "ПАТРУЛЬ «ЩИТ»", "🚓", "#2f6fd6");
  };
  function payFine() {
    var st = FC.police ? FC.police.stars || 0 : 0;
    if (!st) { FC.hud.toast("Претензий к тебе нет. Пока.", "", 2.4); return; }
    var price = 250 * st;
    if (FC.money(-price, "штраф") === false) { FC.hud.toast("Штраф " + FC.fmtMoney(price) + " — не хватает денег", "bad", 2.5); return; }
    FC.police.clear(); FC.hud.toast("Штраф оплачен: розыск снят", "ok", 2.5);
  }
  K.hospital = function (o, ctx) {
    var I = inner(o, 0.9);
    counter(ctx, I.cx, I.z0 + 3, 3, "#d7e6e1", "Регистратура: лечение — $50", heal(50), SP().medic, { line: lineSet("medic") });
    for (var r = 0; r < 3; r++) for (var x = I.x0 + 0.8; x < I.cx - 2; x += 0.7) { ctx.cyl(x, I.z0 + 0.8 + r * 1.2, 0.22, 0.45, 0, "#3fa99b", { solid: false }); ctx.seat(x, I.z0 + 0.8 + r * 1.2, 0, "chair"); }
    var back = { x0: o.x0, x1: o.x1, z0: I.z0 + 5, z1: o.z1 };
    if (back.z1 - back.z0 > 3) K.ward(back, ctx);
    ctx.sign(I.cx, I.z0 + 4.0, 2.6, 3.6, Math.PI, "БОЛЬНИЦА", "🏥", "#ff4d6d");
  };
  K.club = function (o, ctx) {
    var I = inner(o, 0.8), B = ctx.B;
    counter(ctx, I.cx, I.z1 - 1.2, Math.min(6, I.w - 1), "#2a1b3a", "Бар", shopAct(B), rnd(ctx), { line: lineSet("club") });
    for (var b = 0; b < 10; b++) ctx.glow(I.cx - 2.6 + b * 0.55, I.z1 - 0.25, 0.1, 0.1, 0.3, 1.3, ["#ff006e", "#ffbe0b", "#3a86ff", "#8338ec"][b % 4]);
    ctx.box(I.x0 + 1.4, I.cz, 1.8, 1.2, 1.1, 0, "#151018");
    ctx.glow(I.x0 + 1.4, I.cz, 1.6, 1.0, 0.05, 1.1, "#c86bff");
    ctx.box(I.x0 + 0.5, I.cz - 2.2, 0.8, 0.8, 2.2, 0, "#0e0a12"); ctx.box(I.x0 + 0.5, I.cz + 2.2, 0.8, 0.8, 2.2, 0, "#0e0a12");
    ctx.npc(I.x0 + 1.4, I.cz + 0.9, rnd(ctx), { line: ["Следующий трек — бомба!", "Руки вверх!"] });
    for (var i = 0; i < 12; i++) ctx.npc(I.cx - 2 + (i % 4) * 1.4 + ctx.r() * 0.5, I.cz - 1.5 + Math.floor(i / 4) * 1.3, rnd(ctx), { dance: true, line: lineSet("club") });
    for (var k = 0; k < 6; k++) ctx.glow(I.x0 + 2 + k * (I.w - 3) / 6, I.cz, 0.08, 0.08, 0.08, ctx.hc - 0.4, ["#ff006e", "#3a86ff", "#ffbe0b"][k % 3]);
  };
  K.gym = function (o, ctx) {
    var I = inner(o, 0.8), B = ctx.B;
    for (var x = I.x0 + 0.6; x < I.x1 - 0.6; x += 1.3) {
      if (ctx.box(x, I.z1 - 1.2, 0.8, 1.9, 0.25, 0, "#2c2f35")) ctx.glow(x, I.z1 - 0.3, 0.6, 0.1, 0.3, 1.2, "#41e0c8");
    }
    for (var k = 0; k < 3; k++) { ctx.box(I.x0 + 1.5 + k * 2.6, I.cz, 0.5, 1.4, 0.45, 0, "#3a3f47"); ctx.cyl(I.x0 + 1.5 + k * 2.6, I.cz - 0.9, 0.25, 0.08, 1.1, "#222", { solid: false }); }
    ctx.glow(I.x0 + 0.08, I.cz, 0.02, Math.min(8, I.d - 1), 2.0, 0.3, "#c9d6e2");
    ctx.act(I.cx, I.cz + 1.2, "Тренировка", function () {
      if (FC.jobs && FC.jobs.work) FC.jobs.work(B, { kind: "gym" });
      else { FC.player.heal(30); FC.hud.toast("💪 Отличная тренировка! +30 здоровья", "ok", 2.4); }
    }, 1.8);
    for (var n = 0; n < 4; n++) ctx.npc(I.x0 + 0.6 + n * 2.6, I.z1 - 1.2, rnd(ctx), { line: lineSet("gym") });
  };
  K.hotellobby = function (o, ctx) {
    var I = inner(o, 0.9);
    counter(ctx, I.cx, I.z0 + 3.5, 3.2, "#6b3f22", "Снять номер — $80 (сон и сохранение)", sleep(80), rnd(ctx), { line: ["Добро пожаловать в «Флейм»!", "Номер с видом на город?"] });
    sofa(ctx, I.x0 + 1.6, I.cz + 1, 0, "#8c5a5a"); sofa(ctx, I.x1 - 1.6, I.cz + 1, 0, "#8c5a5a");
    plant(ctx, I.x0 + 0.3, I.z0 + 0.3, true); plant(ctx, I.x1 - 0.3, I.z0 + 0.3, true);
    ctx.sign(I.cx, I.z0 + 4.4, 2.6, 3.4, Math.PI, "ОТЕЛЬ ФЛЕЙМ", "🏨", "#e9c46a");
  };
  function carShape(ctx, x, z, color, rot) {
    var w = rot ? 1.9 : 4.4, d = rot ? 4.4 : 1.9;
    if (!ctx.box(x, z, w, d, 0.75, 0.3, color)) return;
    ctx.box(x, z, rot ? 1.6 : 2.2, rot ? 2.2 : 1.6, 0.55, 1.05, shade(color, -0.25), { solid: false });
    ctx.glow(x, z, rot ? 1.5 : 2.0, rot ? 2.0 : 1.5, 0.45, 1.1, "#1b2533");
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (q) {
      var wx = rot ? x + q[0] * 0.85 : x + q[1] * 1.4, wz = rot ? z + q[1] * 1.4 : z + q[0] * 0.85;
      ctx.cyl(wx, wz, 0.36, 0.25, 0.0, "#15171a", { solid: false });
    });
  }
  K.cars = function (o, ctx) {
    var I = inner(o, 1.0), B = ctx.B, cols = ["#e63946", "#ffd23f", "#2a9d8f", "#3a86ff", "#f4f4f4", "#111111"];
    var k = 0;
    for (var x = I.x0 + 3; x < I.x1 - 2.5; x += 6.5) for (var z = I.z0 + 4; z < I.z1 - 2.5; z += 6) {
      if (ctx.cyl(x, z, 2.8, 0.2, 0, "#d8d8d8", { solid: false })) { carShape(ctx, x, z, cols[k++ % cols.length], 0); ctx.glow(x, z, 0.1, 0.1, 0.1, ctx.hc - 0.3, "#ffffff"); }
    }
    counter(ctx, I.x0 + 1.6, I.z0 + 1.6, 2.2, "#ff7a2f", "Автосалон: купить машину", shopAct(B), rnd(ctx), { line: ["Эта ласточка — огонь!", "Тест-драйв?"] });
  };
  K.paint = function (o, ctx) {
    var I = inner(o, 1.0), B = ctx.B;
    ctx.box(I.cx, I.cz + 1, 0.1, 6.5, 3.0, 0, "#cfd3d6", { solid: false });
    for (var g = -1; g <= 1; g += 2) ctx.glow(I.cx + g * 3, I.cz + 1, 0.06, 6, 0.06, 2.6, "#fff4dc");
    carShape(ctx, I.cx, I.cz + 1, ["#ff006e", "#3a86ff", "#ffbe0b"][ctx.r.int(0, 2)], 1);
    counter(ctx, I.x0 + 1.6, I.z0 + 1.6, 2.2, "#ffb02e", "Перекраска", shopAct(B), rnd(ctx), { line: ["Какой цвет?", "Никто не узнает."] });
  };

  /* ---- бизнесы ------------------------------------------------------------------------------------------ */
  var BIZ = {
    shawarma: function (o, ctx, I) {
      counter(ctx, I.cx, I.z0 + 2.4, 3, "#a0522d", "Шаурма: купить / бизнес", shopAct(ctx.B), rnd(ctx), { line: ["Вам с чем?", "Острая — фирменная!"] });
      ctx.cyl(I.cx + 1.6, I.z0 + 3.2, 0.3, 1.0, 0.95, "#a0522d", { solid: false }); ctx.glow(I.cx + 2.0, I.z0 + 3.2, 0.05, 0.6, 1.0, 0.95, "#ff5a2a");
      ctx.glow(I.cx, I.z0 + 3.8, 2.4, 0.02, 0.6, 2.0, "#ffd23f");
    },
    carwash: function (o, ctx, I) {
      for (var k = -1; k <= 1; k += 2) ctx.cyl(I.cx + k * 2.4, I.cz + 1, 0.45, 2.2, 0, "#3a86ff");
      carShape(ctx, I.cx, I.cz + 1, "#e9e9e9", 1);
      counter(ctx, I.x0 + 1.6, I.z0 + 1.6, 2.2, "#4cc9f0", "Автомойка: оплатить / бизнес", shopAct(ctx.B), rnd(ctx), { line: ["Блестит!", "Воск в подарок."] });
    },
    flowers: function (o, ctx, I) {
      for (var x = I.x0 + 0.6; x < I.x1 - 0.5; x += 0.8) for (var r = 0; r < 3; r++) {
        var z = I.z1 - 0.4 - r * 0.5;
        if (ctx.cyl(x, z, 0.18, 0.4 + r * 0.25, 0, "#5a6068")) ctx.cyl(x, z, 0.22, 0.25, 0.4 + r * 0.25, ["#ff70a6", "#ffd23f", "#ff595e", "#c86bff", "#ffffff"][(Math.floor(x * 3) + r) % 5], { solid: false });
      }
      counter(ctx, I.cx, I.z0 + 2, 2.2, "#7a9a5a", "Цветы: купить / бизнес", shopAct(ctx.B), rnd(ctx), { line: ["Букет для кого?", "Розы сегодня свежие."] });
    },
    barber: function (o, ctx, I) {
      for (var x = I.x0 + 1; x < I.x1 - 0.8; x += 1.5) { ctx.cyl(x, I.z1 - 1.3, 0.32, 0.55, 0, "#1d1d1d"); ctx.seat(x, I.z1 - 1.3, 0, "chair"); }
      ctx.glow(I.cx, I.z1 - 0.08, I.w - 0.6, 0.02, 1.3, 0.9, "#cfe3ff");
      for (var s = 0; s < 6; s++) ctx.cyl(I.x0 + 0.3, I.z0 + 0.3, 0.12, 0.25, 0.4 + s * 0.25, s % 2 ? "#ffffff" : "#e63946", { solid: false });
      counter(ctx, I.x0 + 1.6, I.z0 + 2, 1.8, "#3a2a2a", "Барбершоп: стрижка / бизнес", shopAct(ctx.B), rnd(ctx), { line: ["Как обычно?", "Бороду поправим?"] });
    },
    coffee: function (o, ctx, I) {
      counter(ctx, I.cx, I.z1 - 1.2, Math.min(4, I.w - 1), "#5a3a22", "Кофейня: заказ / бизнес", shopAct(ctx.B), rnd(ctx), { line: ["Капучино?", "Овсяное молоко есть."] });
      ctx.box(I.cx - 1, I.z1 - 0.95, 0.6, 0.5, 0.45, 1.05, "#c0c6cc", { solid: false });
      for (var x = I.x0 + 0.9; x < I.x1 - 0.7; x += 1.8) for (var z = I.z0 + 0.9; z < I.z1 - 3; z += 1.8) {
        if (ctx.cyl(x, z, 0.38, 0.74, 0, "#e9e4da")) { ctx.cyl(x + 0.6, z, 0.2, 0.45, 0, "#5a3a22", { solid: false }); ctx.seat(x + 0.6, z, 0, "chair"); }
      }
    },
    studio: function (o, ctx, I) {
      ctx.box(I.cx, I.cz, 3, 1, 0.9, 0, "#2a2a2a");
      for (var k = 0; k < 8; k++) ctx.glow(I.cx - 1.3 + k * 0.37, I.cz - 0.2, 0.2, 0.4, 0.02, 0.91, ["#41e0c8", "#ffbe0b", "#ff006e"][k % 3]);
      ctx.box(I.cx, I.cz + 2, I.w - 1, 0.06, 2.4, 0, "#9fc4dd", { solid: false });
      for (var m = 0; m < 3; m++) ctx.cyl(I.cx - 1.5 + m * 1.5, I.cz + 3.5, 0.03, 1.6, 0, "#bbbbbb", { solid: false });
      ctx.glow(I.cx, I.z1 - 0.1, 1.6, 0.02, 0.4, 2.2, "#ff2a2a");
      ctx.act(I.cx, I.cz - 1.2, "Студия звука: запись / бизнес", shopAct(ctx.B), 1.6);
      ctx.npc(I.cx, I.cz + 0.8, rnd(ctx), { line: ["Ещё дубль!", "Громче в припеве."] });
    },
    taxi: function (o, ctx, I) {
      for (var x = I.x0 + 3; x < I.x1 - 2.5; x += 5) carShape(ctx, x, I.cz + 2, "#ffd23f", 1);
      counter(ctx, I.x0 + 1.6, I.z0 + 1.6, 2.4, "#2a2a2a", "Такси-парк: смена / бизнес", shopAct(ctx.B), rnd(ctx), { line: ["Заказов полно!", "Машина свободна."] });
    }
  };
  K.biz = function (o, ctx, id) {
    var I = inner(o, 0.8);
    if (id === "nightclub") return K.club(o, ctx);
    var fn = BIZ[id];
    if (fn) fn(o, ctx, I);
    else counter(ctx, I.cx, I.z0 + 2, 2.4, ctx.B.color || "#8b5e3c", "Касса", shopAct(ctx.B), rnd(ctx), { line: lineSet("shop") });
    ctx.sign(I.cx, I.z0 + 0.15, 2.7, Math.min(4, I.w), 0, ctx.B.title || ctx.B.name, ctx.B.emoji || "", ctx.B.color || "#ffcf7a");
  };

  /* ---- штаб «Башня Флейм» ------------------------------------------------------------------------- */
  K.lobbyhq = function (o, ctx) {
    var I = inner(o, 1.2), R2 = Math.min(4.5, I.w * 0.22);
    // огонёк на постаменте посреди лобби, светящееся кольцо на полу
    ctx.cyl(I.cx, I.cz, 1.4, 0.9, 0, "#2b3042", { force: true });
    ctx.cyl(I.cx, I.cz, 1.5, 0.06, 0.9, "#ff9a3c", { solid: false });
    ctx.image(I.cx, I.cz, 2.4, 2.6, Math.PI, FC.MASCOT.img);
    [[0, -R2, 2 * R2, 0.08], [0, R2, 2 * R2, 0.08], [-R2, 0, 0.08, 2 * R2], [R2, 0, 0.08, 2 * R2]].forEach(function (q) { ctx.glow(I.cx + q[0], I.cz + q[1], q[2], q[3], 0.01, 0.01, "#ff8a3d"); });
    ctx.sign(I.cx, I.z1 - 0.1, 2.9, 7, Math.PI, "FLAME", "🔥", "#ff8a3d");
    counter(ctx, I.x0 + Math.min(4, I.w * 0.25), I.z0 + Math.min(6, I.d * 0.3), 4, "#151926", "Ресепшн Флейм", function () { hqTalk(false); }, rnd(ctx), { line: lineSet("hq") });
    for (var k = 0; k < 4; k++) ctx.glow(I.x1 - 0.1, I.cz - 3 + k * 2, 0.02, 1.8, 1.0, 1.1, ["#ff5d8f", "#41e0c8", "#ffbe0b", "#7c5cff"][k]);
    sofa(ctx, I.x0 + 1.8, I.cz - 2, 0, "#3a3f55"); sofa(ctx, I.x0 + 1.8, I.cz + 2, 0, "#3a3f55");
    plant(ctx, I.x0 + 0.4, I.z0 + 0.4, true); plant(ctx, I.x1 - 0.4, I.z0 + 0.4, true);
    atm(ctx, I.x0 + 0.6, I.z1 - 1.2);
  };
  K.team = function (o, ctx) {
    var col = ctx.info.color || "#ff8a3d";
    pods(ctx, o, { accent: col, top: "#e9e4da", screen: col });
    var I = inner(o, 0.4);
    ctx.glow(I.cx, I.z0 + 0.05, Math.min(6, I.w - 1), 0.02, 0.6, 2.4, col);
  };
  K.skylobby = function (o, ctx) {
    var I = inner(o, 1.5);
    for (var x = I.x0 + 0.5; x < I.x1; x += 3) { plant(ctx, x, I.z0 + 0.3, true); plant(ctx, x, I.z1 - 0.3, true); }
    K.cafe({ x0: o.x0, x1: o.x1, z0: o.z0 + 3, z1: o.z1 - 3 }, ctx);
  };
  K.boss = function (o, ctx) {
    var I = inner(o, 1.6);
    ctx.box(I.cx, I.cz + 2, 3.2, 1.3, 0.78, 0, "#1d140c");
    ctx.glow(I.cx, I.cz + 2, 3.0, 1.1, 0.02, 0.79, "#ff9a3c");
    ctx.npc(I.cx, I.cz + 3.2, SP().guide, { title: "mascot", scale: 1.6, line: ["Весь город работает на людей.", "Каждый агент — чей-то помощник.", "Заходи ещё!"] });
    ctx.act(I.cx, I.cz + 0.6, "Поговорить с Угольком", function () { hqTalk(true); }, 2.0);
    sofa(ctx, I.x0 + 2, I.cz - 2, 0, "#3a2a1a"); sofa(ctx, I.x1 - 2, I.cz - 2, 0, "#3a2a1a");
    ctx.box(I.cx, I.cz - 3, 1.4, 0.8, 0.4, 0, "#2b3042");
    plant(ctx, I.x0 + 0.3, I.z1 - 0.3, true); plant(ctx, I.x1 - 0.3, I.z1 - 0.3, true);
    ctx.sign(I.cx, I.z1 - 0.1, 2.8, 5, Math.PI, "УГОЛЁК", "🔥", "#ffcf7a");
    ctx.mark("boss", I.cx, I.cz + 0.6);
  };
  function hqTalk(boss) {
    FC.emit("inside:talk", { who: boss ? "mascot" : "reception", building: FC.inside.building });
    if (FC.story && FC.story.talk && FC.story.talk(boss ? "mascot" : "reception")) return;
    if (!FC.hud) return;
    if (boss) FC.hud.dialog([
      "Привет! Я Уголёк. Это мой город — " + FC.cityName + ".",
      "Каждое существо, которое ты видишь, — агент живого человека. Они сейчас монтируют ролики, ищут клиентов, делают сайты.",
      "Зайди в любое здание с вывеской — там работают агенты. А потом заведи своего — он будет работать на тебя."
    ]);
    else FC.hud.dialog([{ who: "Ресепшн", text: "Добро пожаловать в Башню Флейм! Огонёк — на 64-м этаже, лифт прямо.", face: "🛎️" }]);
  }

  /* ---- здания-зоны мира агентов -------------------------------------------------------------------------- */
  var ZONE_KIT = {
    shoot: function (o, ctx, I, col) {
      ctx.box(I.cx, I.z1 - 0.3, I.w - 1, 0.4, ctx.hc - 0.3, 0, "#f4f4f2", { force: true });
      ctx.box(I.cx, I.z1 - 2.5, I.w - 1, 4, 0.02, 0, "#f4f4f2", { solid: false });
      for (var k = 0; k < 4; k++) {
        var x = I.x0 + 1.5 + k * (I.w - 3) / 3, z = I.z1 - 5.5;
        ctx.cyl(x, z, 0.04, 2.4, 0, "#333", { solid: false });
        ctx.box(x, z, 1.0, 0.2, 0.8, 2.0, "#222", { solid: false });
        ctx.glow(x, z - 0.12, 0.9, 0.02, 0.7, 2.05, "#fff4dc");
        ctx.seat(x + 0.8, z - 1.2, 0, "stand");
      }
      ctx.box(I.cx, I.cz - 1, 0.5, 0.4, 0.3, 1.4, "#151515", { solid: false }); ctx.cyl(I.cx, I.cz - 1, 0.05, 1.4, 0, "#444", { solid: false });
      ctx.glow(I.cx, I.cz - 0.8, 0.12, 0.02, 0.12, 1.55, "#ff2a2a");
      pods(ctx, { x0: o.x0, x1: o.x1, z0: o.z0, z1: I.cz - 2 }, { accent: col });
    },
    cut: function (o, ctx, I) {
      ctx.glow(I.cx, I.z1 - 0.1, Math.min(10, I.w - 2), 0.02, 1.6, 1.0, "#1b2233");
      for (var t = 0; t < 4; t++) ctx.glow(I.cx - 3 + t * 1.6, I.z1 - 0.12, 1.4, 0.02, 0.18, 1.3 + t * 0.3, ["#ff5d8f", "#41e0c8", "#ffbe0b", "#7c5cff"][t]);
      pods(ctx, { x0: o.x0, x1: o.x1, z0: o.z0, z1: o.z1 - 1.5 }, { dual: true, top: "#2a2d33", screen: "#3b6fd6", screen2: "#ff5d8f", chair: "#151515", accent: "#ff5d8f" });
    },
    reels: function (o, ctx, I) {
      for (var k = 0; k < 4; k++) {
        var x = I.x0 + 1.5 + k * (I.w - 3) / 3, z = I.z1 - 2;
        ctx.cyl(x, z, 0.03, 1.6, 0, "#444", { solid: false });
        ctx.glow(x, z, 0.7, 0.05, 0.7, 1.4, "#fff2c8");
        ctx.glow(x, z - 0.05, 0.22, 0.02, 0.4, 1.55, "#111");
        ctx.seat(x, z - 1.4, 0, "stand");
      }
      ctx.glow(I.x0 + 0.1, I.cz, 0.02, Math.min(6, I.d - 1), 0.4, 2.2, "#ff006e");
      pods(ctx, { x0: o.x0, x1: o.x1, z0: o.z0, z1: I.z1 - 4 }, { screen: "#a77bff", accent: "#a77bff" });
    },
    queue: function (o, ctx, I) {
      for (var k = 0; k < 5; k++) {
        var x = I.x0 + 1 + k * (I.w - 2) / 4, frac = 0.2 + ctx.r() * 0.75;
        ctx.box(x, I.z1 - 0.15, 1.6, 0.06, 0.5, 1.6, "#0d1018", { solid: false });
        ctx.glow(x - 0.8 + 0.8 * frac, I.z1 - 0.2, 1.6 * frac, 0.02, 0.3, 1.7, "#41e0c8");
      }
      for (var r = 0; r < 3; r++) for (var x2 = I.x0 + 1; x2 < I.x1 - 0.5; x2 += 0.8) {
        if (ctx.cyl(x2, I.cz - 1 + r * 1.6, 0.24, 0.45, 0, "#2f6f6a")) ctx.seat(x2, I.cz - 1 + r * 1.6, 0, "stand");
      }
    },
    view: function (o, ctx, I) {
      ctx.glow(I.cx, I.z1 - 0.15, Math.min(12, I.w - 1), 0.02, Math.min(4, ctx.hc - 1), 0.8, "#cfe8ff");
      for (var r = 0; r < 5; r++) for (var x = I.x0 + 1; x < I.x1 - 0.6; x += 0.75) {
        if (ctx.cyl(x, I.z0 + 1.5 + r * 1.3, 0.26, 0.45, 0, "#7a1f2a")) ctx.seat(x, I.z0 + 1.5 + r * 1.3, 0, "stand");
      }
    },
    memory: function (o, ctx, I) {
      for (var z = I.z0 + 2; z < I.z1 - 0.6; z += 1.9) shelfRow(ctx, I.x0 + 0.5, I.x1 - 2.5, z, false);
      desk(ctx, I.x1 - 1.4, I.z0 + 1.6, 1, { top: "#7a5a3a" });
    },
    library: function (o, ctx, I) {
      for (var z = I.cz; z < I.z1 - 0.6; z += 1.9) shelfRow(ctx, I.x0 + 0.5, I.x1 - 0.5, z, true);
      for (var x = I.x0 + 1.2; x < I.x1 - 1; x += 3) {
        if (table(ctx, x, I.z0 + 2.2, 2.2, 1.0, "#6b4a33")) {
          ctx.glow(x, I.z0 + 2.2, 0.2, 0.2, 0.25, 0.76, "#ffd9a0");
          ctx.cyl(x - 0.6, I.z0 + 1.3, 0.22, 0.45, 0, "#3a2a1a", { solid: false }); ctx.seat(x - 0.6, I.z0 + 1.3, 1, "desk");
          ctx.cyl(x + 0.6, I.z0 + 1.3, 0.22, 0.45, 0, "#3a2a1a", { solid: false }); ctx.seat(x + 0.6, I.z0 + 1.3, 1, "desk");
        }
      }
    },
    scout: function (o, ctx, I) {
      ctx.box(I.cx, I.cz, Math.min(5, I.w - 3), Math.min(3, I.d - 3), 0.9, 0, "#1b2233");
      ctx.glow(I.cx, I.cz, Math.min(4.8, I.w - 3.2), Math.min(2.8, I.d - 3.2), 0.02, 0.91, "#2a9d8f");
      for (var r = 0; r < 2; r++) for (var c = 0; c < 6; c++) ctx.glow(I.x0 + 1 + c * (I.w - 2) / 5, I.z1 - 0.1, (I.w - 2) / 6.5, 0.02, 0.8, 1.0 + r * 0.95, ["#ff4a4a", "#41e0c8", "#ffbe0b"][(r + c) % 3]);
      for (var k = 0; k < 4; k++) { var a = k * Math.PI / 2, sx = I.cx + Math.cos(a) * 3.4, sz = I.cz + Math.sin(a) * 2.6; ctx.seat(sx, sz, 0, "stand"); }
      pods(ctx, { x0: o.x0, x1: o.x1, z0: o.z0, z1: I.cz - 3 }, { accent: "#ff4a4a" });
    },
    forge: function (o, ctx, I) {
      for (var x = I.x0 + 1.2; x < I.x1 - 1; x += 2.6) {
        if (ctx.box(x, I.z1 - 1, 2.2, 0.9, 0.9, 0, "#5a4a3a")) { ctx.glow(x, I.z1 - 1.2, 0.5, 0.03, 0.3, 1.0, "#ff7a2f"); ctx.seat(x, I.z1 - 2.0, 0, "stand"); }
        ctx.box(x, I.z1 - 0.1, 2.2, 0.05, 1.2, 1.2, "#7d6a55", { solid: false });
      }
      for (var p = 0; p < 3; p++) if (ctx.box(I.x0 + 1 + p * 1.4, I.z0 + 1.2, 0.9, 0.9, 1.0, 0, "#cfd3d6")) ctx.glow(I.x0 + 1 + p * 1.4, I.z0 + 0.74, 0.5, 0.02, 0.3, 0.6, "#41e0c8");
      pods(ctx, { x0: o.x0, x1: o.x1, z0: o.z0 + 3, z1: I.z1 - 2.5 }, { screen: "#9dff8a" });
    },
    news: function (o, ctx, I) {
      for (var c = 0; c < 6; c++) ctx.glow(I.x0 + 1 + c * (I.w - 2) / 5, I.z1 - 0.1, (I.w - 2) / 6.5, 0.02, 0.9, 1.2, ["#e42313", "#1b2233", "#3b6fd6"][c % 3]);
      ctx.box(I.cx, I.z1 - 2.2, 3, 0.9, 0.9, 0, "#e42313");
      pods(ctx, { x0: o.x0, x1: o.x1, z0: o.z0, z1: I.z1 - 3.5 }, { accent: "#e42313" });
    },
    school: function (o, ctx, I) {
      ctx.glow(I.cx, I.z1 - 0.1, Math.min(6, I.w - 2), 0.02, 1.4, 1.0, "#1f4d2e");
      for (var z = I.z0 + 1.2; z < I.z1 - 2.5; z += 1.6) for (var x = I.x0 + 1; x < I.x1 - 0.6; x += 1.4) {
        if (ctx.box(x, z, 0.8, 0.55, 0.7, 0, "#c8a87a")) { ctx.cyl(x, z - 0.55, 0.2, 0.42, 0, "#4285f4", { solid: false }); ctx.seat(x, z - 0.55, 1, "desk"); }
      }
    },
    lab: function (o, ctx, I) {
      for (var z = I.z0 + 2; z < I.z1 - 1; z += 3) {
        if (!ctx.box(I.cx, z, Math.min(8, I.w - 2), 0.9, 0.9, 0, "#e8eef0")) continue;
        for (var k = 0; k < 8; k++) ctx.glow(I.cx - 3 + k * 0.8, z, 0.12, 0.12, 0.3, 0.9, ["#41e08c", "#ff70a6", "#4cc9f0"][k % 3]);
        ctx.seat(I.cx - 2, z - 1.0, 1, "stand"); ctx.seat(I.cx + 2, z - 1.0, 1, "stand");
      }
      ctx.box(I.x1 - 0.6, I.cz, 1.0, 2.0, 2.2, 0, "#cfd8e0");
    },
    print: function (o, ctx, I) {
      for (var x = I.x0 + 1.5; x < I.x1 - 1.5; x += 3) if (ctx.box(x, I.z1 - 1.2, 2.2, 1.4, 1.3, 0, "#4a4a55")) { ctx.glow(x, I.z1 - 1.92, 1.6, 0.02, 0.2, 1.0, "#7c5cff"); ctx.seat(x, I.z1 - 2.6, 0, "stand"); }
      table(ctx, I.cx, I.cz - 1, Math.min(4, I.w - 2), 1.4, "#e9e4da");
    },
    voice: function (o, ctx, I) {
      ctx.glow(I.cx, I.z1 - 0.1, 2, 0.02, 0.5, 2.3, "#ff2a2a");
      ctx.sign(I.cx, I.z1 - 0.12, 1.6, 2.4, Math.PI, "ON AIR", "🎙️", "#ff4a4a");
      ctx.box(I.cx, I.cz, 3, 1.2, 0.85, 0, "#2a2a2a");
      for (var m = 0; m < 3; m++) { ctx.cyl(I.cx - 1 + m, I.cz + 0.9, 0.03, 1.5, 0, "#bbbbbb", { solid: false }); ctx.seat(I.cx - 1 + m, I.cz + 1.4, 0, "stand"); }
    }
  };
  ["photoshoot", "foto34", "restore", "retouch"].forEach(function (k) { ZONE_KIT[k] = ZONE_KIT.shoot; });
  K.zone = function (o, ctx, key, up) {
    var B = ctx.B, I = inner(o, 0.9), col = B.color || "#ffcf7a";
    var fn = !up && ZONE_KIT[key];
    if (fn) fn(o, ctx, I, col);
    else pods(ctx, o, { accent: col, screen: col, top: "#e9e4da" });
    // стойка возможности у входа и экран «агенты сейчас»
    ctx.act(I.x0 + 1.2, I.z0 + 1.6, "Стойка: " + B.name, function () { FC.inside.capabilityStand(B); }, 1.8);
    ctx.box(I.x0 + 1.2, I.z0 + 2.3, 1.2, 0.5, 1.1, 0, shade(col, -0.4), { force: true });
    ctx.glow(I.x0 + 1.2, I.z0 + 2.04, 1.0, 0.02, 0.5, 0.95, col);
    ctx.glow(I.x1 - 0.3, I.z0 + 2.2, 0.02, 1.8, 1.0, 1.0, "#3b6fd6");
    ctx.sign(I.cx, I.z0 + 0.12, 2.6, Math.min(6, I.w * 0.6), 0, B.title || B.name, B.emoji || "", col);
  };

  /* ---- «геройские» этажи ------------------------------------------------------------------------------- */
  K.party = function (o, ctx) {
    var I = inner(o, 1);
    for (var i = 0; i < 14; i++) ctx.cyl(I.x0 + ctx.r() * I.w, I.z0 + ctx.r() * I.d, 0.25, 0.5, 1.6 + ctx.r() * 0.8, ["#ff006e", "#ffbe0b", "#3a86ff", "#8338ec", "#2bff6a"][i % 5], { solid: false });
    table(ctx, I.cx, I.z1 - 1, Math.min(4, I.w - 1), 0.9, "#f4f4f4");
    for (var k = 0; k < 8; k++) ctx.npc(I.cx - 2 + (k % 4) * 1.4, I.cz - 0.5 + Math.floor(k / 4) * 1.4, rnd(ctx), { dance: true, line: ["С днём рождения!", "Торт где?", "Танцуем!"] });
    ctx.glow(I.cx, I.cz, 0.4, 0.4, 0.4, ctx.hc - 0.6, "#ff006e");
  };
  K.renovation = function (o, ctx) {
    var I = inner(o, 1);
    for (var i = 0; i < 6; i++) ctx.box(I.x0 + ctx.r() * I.w, I.z0 + ctx.r() * I.d, 1.2, 1.2, 0.6 + ctx.r(), 0, "#d8d2c0");
    for (var k = 0; k < 3; k++) { var x = I.x0 + 1 + k * 3; ctx.box(x, I.z1 - 1, 0.6, 0.08, 2.2, 0, "#c9a14a", { solid: false }); ctx.cyl(x + 1, I.z1 - 1, 0.18, 0.3, 0, "#3a86ff"); }
    ctx.npc(I.cx, I.cz, rnd(ctx), { line: ["Ремонт до понедельника.", "Каска где?"] });
  };
  K.empty = function (o, ctx) {
    var I = inner(o, 1);
    ctx.sign(I.cx, I.z1 - 0.1, 2, 4, Math.PI, "СДАЁТСЯ", "🔑", "#e9c46a");
    for (var i = 0; i < 3; i++) ctx.box(I.x0 + 1 + i * 1.3, I.z0 + 1.2, 0.8, 0.6, 0.6, 0, "#b08a5a");
  };
  K.blackout = function (o, ctx) {
    pods(ctx, o, { screen: "#101418", accent: null });
    ctx.glow(inner(o, 0.3).x0, inner(o, 0.3).z0, 0.2, 0.2, 0.2, 2.2, "#ff2a2a");
  };

  /* ---- на каждый этаж — растения у лифта и хотя бы одно «геройское» действие ---------------------------- */
  function floorDecor(ctx) {
    var P = ctx.plan;
    if (P.elev && !P.small) { plant(ctx, P.elev.x - 1.6, P.elev.z - 0.2); plant(ctx, P.stairs.x + 1.6, P.stairs.z - 0.2); }
    if (!ctx.acts.length && ctx.info.role !== "apartments" && ctx.info.role !== "vault") {
      var room = P.rooms[0], I = inner(room, 0.8);
      if (!vending(ctx, I.x1 - 0.6, I.z0 + 1.2)) vending(ctx, I.x0 + 0.6, I.z1 - 1.2);
    }
  }

  function kit(type) {
    if (!type) return null;
    if (type.indexOf("z:") === 0) { var p = type.split(":"); return function (o, ctx) { K.zone(o, ctx, p[1], p[2] === "up"); }; }
    if (type.indexOf("biz:") === 0) { var id = type.slice(4); return function (o, ctx) { K.biz(o, ctx, id); }; }
    return K[type] || null;
  }
  FC.furn = { kit: kit, floorDecor: floorDecor, K: K };
})(window);
