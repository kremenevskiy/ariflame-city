/* Флейм-Сити — банды районов и захват территорий (FC.gang).
 *
 * Задача: «банды районов: Москва, Минск, Алматы — у каждого района своя команда агентов,
 * захватываешь точки и получаешь доход». Три команды: «Красные Звёзды» (Москва), «Зубры» (Минск), «Снежные Барсы»
 * (Алматы). В каждом районе 10 точек (двор, гаражи, рынок, набережная…): флаг и круг цвета хозяина. Встал в круг
 * чужой точки — выходят защитники (существа с банданой своей команды); раскидал всех и простоял в круге 10 с —
 * точка твоя. Твои точки дают доход раз в игровой час в сейф (приложение «Районы»); соперники контратакуют — на
 * защиту 3 минуты, не успел — точка уходит назад. Весь район твой — большой бонус и доход ×1,5.
 * Оружие мультяшное: защитники «вырубаются» (FC.people.hit) и потом уходят. Деньги — только игровые.
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE, M = FC.map, G = FC.gfx;

  var TEAMS = {
    msk: { key: "msk", name: "Красные Звёзды", short: "Звёзды", emoji: "⭐", color: "#e63946", hex: 0xe63946 },
    minsk: { key: "minsk", name: "Зубры", short: "Зубры", emoji: "🦬", color: "#2fbf71", hex: 0x2fbf71 },
    ala: { key: "ala", name: "Снежные Барсы", short: "Барсы", emoji: "🐆", color: "#4cc9f0", hex: 0x4cc9f0 }
  };
  var KEYS = ["msk", "minsk", "ala"];
  var R_CAP = 12, CAP_SEC = 10, DEF_SEC = 180;

  /* ---- точки захвата: детерминированно по кварталам района, не ближе 140 м друг к другу ------------------ */
  var KINDS = [["Двор", "🏘️"], ["Гаражи", "🔧"], ["Рынок", "🍉"], ["Стоянка", "🅿️"], ["Подворотня", "🧱"], ["Спортплощадка", "🏀"]];
  var POINTS = [];
  (function pickPoints() {
    KEYS.forEach(function (dk) {
      var cand = [];
      M.blocks.forEach(function (b) {
        if (b.dist.key !== dk || (b.kind !== "city" && b.kind !== "park" && b.kind !== "shore")) return;
        var W = M.WALK + 4, spots = [[b.cx, b.cz], [b.x0 + W, b.z0 + W], [b.x1 - W, b.z1 - W], [b.x0 + W, b.z1 - W], [b.x1 - W, b.z0 + W]];
        for (var i = 0; i < spots.length; i++) {
          var x = spots[i][0], z = spots[i][1];
          if (M.buildingAt(x, z, 4) || M.water(x, z) || M.onRoad(x, z) || M.field(x, z) < 8) continue;
          cand.push({ x: x, z: z, b: b, h: FC.hash("gang" + b.i + "_" + i) });
          break;
        }
      });
      cand.sort(function (a, c) { return a.h - c.h; });
      var got = [];
      for (var k = 0; k < cand.length && got.length < 10; k++) {
        var c = cand[k], ok = true;
        for (var j = 0; j < got.length; j++) if (FC.dist2(c.x, c.z, got[j].x, got[j].z) < 140 * 140) { ok = false; break; }
        if (ok) got.push(c);
      }
      got.forEach(function (c, n) {
        var kind = c.b.kind === "park" ? ["Парк", "🌳"] : c.b.kind === "shore" ? ["Набережная", "🌊"] : KINDS[c.h % KINDS.length];
        POINTS.push({ id: dk + n, dist: dk, x: c.x, z: c.z, kind: kind[0], icon: kind[1], name: kind[0], income: 140 + (c.h % 9) * 15 });
      });
    });
  })();
  function nameOf(p) {
    if (p.label) return p.label;
    var st = FC.story && FC.story.streetAt ? FC.story.streetAt(p.x, p.z) : "";
    p.label = p.kind + (st ? " на " + st : "");
    return p.label;
  }

  /* ---- сохранение ------------------------------------------------------------------------------------- */
  function S() {
    var s = FC.save;
    if (!s.gang) s.gang = { team: null, own: {}, safe: 0, won: [], caps: 0, defs: 0 };
    return s.gang;
  }
  function owner(p) { var o = S().own[p.id]; return o ? o.team : p.dist; }
  function mine(p) { var o = S().own[p.id]; return !!(o && o.mine); }
  function team() {
    var g = S();
    if (!g.team) {
      var h = FC.me && FC.me.home ? M.district(FC.me.home.x, FC.me.home.z).key : "msk";
      g.team = TEAMS[h] ? h : "msk";
    }
    return g.team;
  }

  /* ---- флаги и круги на точках ------------------------------------------------------------------------------ */
  var flagGeo = new T.PlaneGeometry(2.2, 1.3).translate(1.1, 0, 0), poleGeo = new T.CylinderGeometry(0.07, 0.09, 6, 5, 1, true);
  var ringGeo = new T.RingGeometry(R_CAP - 0.6, R_CAP, 48).rotateX(-Math.PI / 2);
  var poleMat = G.mat.std(0x2c3035, 0.5, 0.6);
  var vis = POINTS.map(function (p) {
    var g = new T.Group();
    var pole = new T.Mesh(poleGeo, poleMat); pole.position.y = 3; g.add(pole);
    var fm = new T.MeshStandardMaterial({ color: 0xffffff, side: T.DoubleSide, roughness: 0.7, emissive: 0x000000 });
    var flag = new T.Mesh(flagGeo, fm); flag.position.y = 5.2; g.add(flag);
    var rm = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
    var ring = new T.Mesh(ringGeo, rm); ring.position.y = 0.22; g.add(ring);
    g.position.set(p.x, 0.15, p.z);
    G.add(g);
    M.addProp(p.x + 0.0, p.z, 0.15, "flag");
    return { g: g, flag: flag, fm: fm, ring: ring, rm: rm };
  });
  function paint(i) {
    var p = POINTS[i], t = TEAMS[owner(p)], v = vis[i];
    v.fm.color.setHex(t.hex); v.fm.emissive.setHex(t.hex); v.fm.emissiveIntensity = 0.25;
    v.rm.color.setHex(mine(p) ? 0xffcf7a : t.hex);
  }

  /* ---- бойцы банд: существа с банданой ---------------------------------------------------------------------- */
  var crew = [];                 // {ch, team, p (точка), role: def|idle|raid, band}
  var bandGeo = new T.TorusGeometry(0.42, 0.11, 6, 14).rotateX(Math.PI / 2);
  var bandMats = {};
  KEYS.forEach(function (k) { bandMats[k] = new T.MeshBasicMaterial({ color: TEAMS[k].hex }); });
  function spawnCrew(p, tm, role, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, r = 4 + Math.random() * (R_CAP - 3);
      var x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      var c = M.collide(x, z, 0.4);
      var ch = FC.people.make("npc", FC.people.randomCell(), c.x, c.z, { scale: 1.8, walk: 3.2, gang: tm, hp: 100, update: brain });
      ch.alpha = 0;
      var band = new T.Mesh(bandGeo, bandMats[tm]); G.add(band);
      var m = { ch: ch, team: tm, p: p, role: role, band: band, cd: 1 + Math.random(), wander: 0 };
      ch.crew = m;
      crew.push(m);
      if (Math.random() < 0.5) FC.people.say(ch, TEAMS[tm].emoji + " " + pickLine(role), 2.5);
    }
  }
  var LINES = {
    def: ["Это наша точка!", "Вали отсюда!", "Пацаны, к бою!", "Ты не с нашего района", "Сейчас объясним"],
    idle: ["Тихо у нас сегодня", "Кто там идёт?", "Район под контролем", "Чё надо?"],
    raid: ["Забираем точку!", "Ваше время вышло!", "Это теперь наше!"]
  };
  function pickLine(role) { var l = LINES[role] || LINES.idle; return l[Math.floor(Math.random() * l.length)]; }
  function hostile(m) { return m.role !== "idle" || m.angry; }
  // мозг бойца: держится у точки, на врага — бежит и бьёт (урон умеренный: погоня не кончается за секунды)
  function brain(ch, dt) {
    var m = ch.crew; if (!m) return;
    var P = FC.player;
    var dx = P.x - ch.x, dz = P.z - ch.z, d = Math.hypot(dx, dz);
    var px = m.p.x, pz = m.p.z;
    var target = null;
    if (hostile(m) && P.mode === "foot" && !P.dead && d < 32 && ch.room == null && !(FC.inside && FC.inside.active)) target = { x: P.x, z: P.z };
    if (target) {
      if (d > 1.3) {
        var sp = m.ch.walk * 1.25;
        var c = M.collide(ch.x + dx / d * sp * dt, ch.z + dz / d * sp * dt, 0.35, { prev: ch, noProps: true });
        ch.vx = (c.x - ch.x) / Math.max(dt, 1e-3); ch.vz = (c.z - ch.z) / Math.max(dt, 1e-3); ch.x = c.x; ch.z = c.z; ch.speed = sp;
      } else { ch.vx = ch.vz = 0; ch.speed = 0; }
      m.cd -= dt;
      if (d < 1.6 && m.cd <= 0) {
        m.cd = 1.1 + Math.random() * 0.6;
        ch.lean = -0.4 * ch.face; setTimeout(function () { ch.lean = 0; }, 160);
        P.damage(6 + Math.floor(Math.random() * 5), "gang");
        if (FC.audio) FC.audio.play("punch", { vol: 0.6 });
        if (FC.cam) FC.cam.shake(0.12);
      }
      return;
    }
    // у точки: бродит в круге
    m.wander -= dt;
    if (m.wander <= 0 || !m.wx) {
      var a = Math.random() * Math.PI * 2, r = 2 + Math.random() * (R_CAP - 2);
      m.wx = px + Math.cos(a) * r; m.wz = pz + Math.sin(a) * r; m.wander = 3 + Math.random() * 4;
    }
    var wx = m.wx - ch.x, wz = m.wz - ch.z, wd = Math.hypot(wx, wz);
    if (wd > 0.6) { ch.vx = wx / wd * 1.2; ch.vz = wz / wd * 1.2; ch.x += ch.vx * dt; ch.z += ch.vz * dt; ch.speed = 1.2; }
    else { ch.vx = ch.vz = 0; ch.speed = 0; }
  }
  function dropCrew(m) {
    FC.people.remove(m.ch); G.scene.remove(m.band);
    var i = crew.indexOf(m); if (i >= 0) crew.splice(i, 1);
  }
  function down(m) { return m.ch.knocked > 0 || m.downed; }

  /* ---- захват ------------------------------------------------------------------------------------------------ */
  var cap = null;          // {i, prog, defs:[...]}
  var raid = null;         // контратака: {i, left, spawned}
  var bar = document.createElement("div"); bar.className = "gang-bar"; bar.innerHTML = "<b></b><i><u></u></i><small></small>";
  document.body.appendChild(bar);
  FC.css([
    ".gang-bar{position:fixed;left:50%;top:calc(96px + env(safe-area-inset-top));transform:translateX(-50%);width:min(320px,80vw);",
    "  background:rgba(12,16,32,.82);border:1px solid rgba(255,207,122,.35);border-radius:14px;padding:8px 12px;z-index:6;display:none;",
    "  text-align:center;color:#fff;font:600 13px system-ui;pointer-events:none;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}",
    ".gang-bar.on{display:block}.gang-bar b{display:block;font-size:14px;margin-bottom:5px}",
    ".gang-bar i{display:block;height:8px;border-radius:5px;background:rgba(255,255,255,.12);overflow:hidden}",
    ".gang-bar u{display:block;height:100%;width:0;background:linear-gradient(90deg,#ffcf7a,#ff6b3d);transition:width .15s}",
    ".gang-bar small{display:block;margin-top:4px;color:rgba(255,255,255,.7);font-size:12px}",
    ".gtag{display:inline-block;padding:1px 7px;border-radius:8px;color:#fff;font-weight:700;font-size:11px}"
  ].join("\n"));
  function showBar(title, k, sub) {
    bar.classList.add("on");
    bar.children[0].textContent = title; bar.children[1].firstChild.style.width = Math.round(FC.clamp(k, 0, 1) * 100) + "%";
    bar.children[2].textContent = sub || "";
  }
  function hideBar() { bar.classList.remove("on"); }

  function startCap(i) {
    var p = POINTS[i], tm = owner(p);
    var lvl = 2 + Math.min(4, Math.floor((S().caps || 0) / 3)) + (p.dist === tm ? 1 : 0);
    cap = { i: i, prog: 0, t0: performance.now() };
    spawnCrew(p, tm, "def", lvl);
    FC.hud.toast(TEAMS[tm].emoji + " «" + TEAMS[tm].name + "» защищают точку — раскидай их и держи круг", "", 3.5);
    if (FC.audio) FC.audio.play("wanted");
  }
  function endCap(won) {
    var i = cap.i, p = POINTS[i];
    // защитники уходят: проиграли — сразу, ушёл игрок — успокоились (появятся снова, когда вернётся)
    crew.slice().forEach(function (m) { if (m.p === p && m.role === "def") { m.role = "gone"; setTimeout(function () { dropCrew(m); }, 4000); } });
    cap = null; hideBar();
    if (!won) return;
    var g = S(), was = owner(p);
    g.own[p.id] = { team: team(), mine: true, at: Date.now() };
    g.caps = (g.caps || 0) + 1;
    paint(i);
    var reward = 400 + p.income;
    FC.money(reward, "захват: " + nameOf(p));
    FC.hud.popup("ТОЧКА ЗАХВАЧЕНА", { color: TEAMS[team()].color, big: true });
    FC.hud.toast(p.icon + " " + nameOf(p) + " — теперь «" + TEAMS[team()].name + "». +" + FC.fmtMoney(reward) + ", доход " + FC.fmtMoney(p.income) + "/час", "ok", 4);
    if (FC.fx) { FC.fx.burst(p.x, 1.2, p.z, "confetti", 50); FC.fx.haptic("heavy"); }
    if (FC.audio) FC.audio.play("mission");
    FC.emit("gang:capture", { point: p.id, name: nameOf(p), from: was, to: team(), x: p.x, z: p.z });
    // весь район твой?
    var dk = p.dist;
    if (dk !== team() && POINTS.filter(function (q) { return q.dist === dk; }).every(function (q) { return owner(q) === team(); }) && g.won.indexOf(dk) < 0) {
      g.won.push(dk);
      FC.money(10000, "район: " + M.DIST[dk].name);
      FC.hud.big(M.DIST[dk].name.toUpperCase() + " — ТВОЙ РАЙОН", "«" + TEAMS[dk].name + "» сдались · +$10 000 · доход района ×1,5", TEAMS[team()].color, 4.5);
      FC.emit("gang:district", { dist: dk, team: team() });
    }
    FC.dirty();
  }

  /* ---- контратаки ------------------------------------------------------------------------------------------- */
  var raidT = 240 + Math.random() * 120;
  function startRaid() {
    var mineList = POINTS.map(function (p, i) { return i; }).filter(function (i) { return mine(POINTS[i]); });
    if (!mineList.length) return;
    var i = mineList[Math.floor(Math.random() * mineList.length)], p = POINTS[i];
    var att = p.dist !== team() ? p.dist : KEYS.filter(function (k) { return k !== team(); })[Math.floor(Math.random() * 2)];
    raid = { i: i, left: DEF_SEC, team: att, spawned: false };
    FC.markers.add({ id: "gang-raid", x: p.x, z: p.z, color: TEAMS[att].color, icon: "⚔️", label: "Защити точку", route: true, ring: R_CAP });
    FC.hud.notify(TEAMS[att].emoji + " " + TEAMS[att].name, "Налёт на твою точку «" + nameOf(p) + "»! 3 минуты, чтобы отбить.", "⚔️", 7);
    if (FC.audio) FC.audio.play("wanted");
  }
  function endRaid(kept) {
    var p = POINTS[raid.i];
    FC.markers.remove("gang-raid");
    crew.slice().forEach(function (m) { if (m.role === "raid") { m.role = "gone"; setTimeout(function () { dropCrew(m); }, 3000); } });
    if (kept) {
      S().defs = (S().defs || 0) + 1;
      FC.money(600, "оборона точки");
      FC.hud.popup("ТОЧКА ОТБИТА", { color: "#9dffbf", big: true });
      FC.emit("gang:defend", { point: p.id, x: p.x, z: p.z });
    } else {
      delete S().own[p.id];
      paint(raid.i);
      FC.hud.toast("«" + TEAMS[raid.team].name + "» забрали «" + nameOf(p) + "». Можно вернуть", "bad", 4);
      FC.emit("gang:lost", { point: p.id });
    }
    raid = null; hideBar(); FC.dirty();
  }

  /* ---- доход раз в игровой час ----------------------------------------------------------------------------- */
  FC.on("hour", function () {
    if (!FC.started) return;
    var g = S(), sum = 0;
    POINTS.forEach(function (p) {
      if (!mine(p)) return;
      sum += Math.round(p.income * (g.won.indexOf(p.dist) >= 0 ? 1.5 : 1));
    });
    if (!sum) return;
    var cap8 = sum * 8;
    g.safe = Math.min(cap8, (g.safe || 0) + sum);
    FC.dirty();
  });

  /* ---- кадр ------------------------------------------------------------------------------------------------- */
  var idleT = 0;
  FC.addSystem({
    name: "gang", order: 31,
    init: function () { POINTS.forEach(function (p, i) { paint(i); }); team(); },
    update: function (dt) {
      var P = FC.player; if (!P || !FC.started) return;
      var t = performance.now() / 1000;
      // флаги колышутся, ленты на бойцах
      for (var i = 0; i < vis.length; i++) {
        var v = vis[i];
        if (FC.dist2(POINTS[i].x, POINTS[i].z, P.x, P.z) > 300 * 300) { v.g.visible = false; continue; }
        v.g.visible = !(FC.inside && FC.inside.active);
        v.flag.rotation.y = Math.sin(t * 1.7 + i) * 0.25;
        v.rm.opacity = (cap && cap.i === i) ? 0.55 + Math.sin(t * 6) * 0.3 : 0.4;
      }
      for (var k = crew.length - 1; k >= 0; k--) {
        var m = crew[k];
        m.band.visible = m.ch.shown !== false && !m.ch.knocked;
        m.band.position.set(m.ch.x, (m.ch.y || 0.15) + m.ch.scale * 1.02, m.ch.z);
        if (m.ch.knocked > 0) m.downed = true;
        if (m.downed && !m.ch.knocked && m.role !== "gone") { m.role = "gone"; FC.people.say(m.ch, "Ладно-ладно, ухожу…", 2); }
        if (m.role === "gone" && !m.ch.knocked) {
          // уходит из круга и исчезает
          var ax = m.ch.x - m.p.x, az = m.ch.z - m.p.z, ad = Math.hypot(ax, az) || 1;
          m.ch.x += ax / ad * 2.5 * dt; m.ch.z += az / ad * 2.5 * dt; m.ch.vx = ax / ad * 2.5; m.ch.vz = az / ad * 2.5; m.ch.speed = 2.5;
          m.ch.update = null;
          if (ad > 30) dropCrew(m);
        }
      }
      // кто рядом: захват чужой точки
      var near = -1, nd = 1e9;
      for (var j = 0; j < POINTS.length; j++) {
        var d2 = FC.dist2(POINTS[j].x, POINTS[j].z, P.x, P.z);
        if (d2 < nd) { nd = d2; near = j; }
      }
      var inside = FC.inside && FC.inside.active;
      if (cap) {
        var p = POINTS[cap.i], d = Math.sqrt(FC.dist2(p.x, p.z, P.x, P.z));
        var alive = crew.filter(function (m) { return m.p === p && m.role === "def" && !down(m); }).length;
        if (d > 45 || P.dead || inside) { FC.hud.toast("Захват сорван — ушёл с точки", "bad", 2.5); endCap(false); }
        else {
          var inCircle = d < R_CAP && P.mode === "foot";
          if (inCircle && !alive) cap.prog += dt / CAP_SEC;
          else if (!inCircle) cap.prog = Math.max(0, cap.prog - dt / (CAP_SEC * 2));
          showBar(p.icon + " Захват: " + nameOf(p), cap.prog, alive ? "Защитников на ногах: " + alive : inCircle ? "Держи круг!" : "Вернись в круг (пешком)");
          if (cap.prog >= 1) endCap(true);
        }
      } else if (!raid && near >= 0 && nd < R_CAP * R_CAP && P.mode === "foot" && !inside && owner(POINTS[near]) !== team() && !P.dead) {
        startCap(near);
      }
      // контратака
      if (raid) {
        raid.left -= dt;
        var rp = POINTS[raid.i], rd = Math.sqrt(FC.dist2(rp.x, rp.z, P.x, P.z));
        if (!raid.spawned && rd < 90) { raid.spawned = true; spawnCrew(rp, raid.team, "raid", 3 + Math.min(3, Math.floor((S().defs || 0) / 2))); }
        if (raid.spawned) {
          var up = crew.filter(function (m) { return m.p === rp && m.role === "raid" && !down(m); }).length;
          showBar("⚔️ Оборона: " + nameOf(rp), 1 - raid.left / DEF_SEC, up ? "Нападающих: " + up + " · " + Math.ceil(raid.left) + " с" : "Отбито!");
          if (!up) endRaid(true);
        } else if (rd < 400) showBar("⚔️ Налёт на «" + nameOf(rp) + "»", 1 - raid.left / DEF_SEC, "Осталось " + Math.ceil(raid.left) + " с");
        if (raid && raid.left <= 0) endRaid(false);
      } else {
        raidT -= dt;
        if (raidT <= 0) { raidT = 240 + Math.random() * 180; if (!cap && !(FC.story && FC.story.busy && FC.story.busy())) startRaid(); }
      }
      // у своих и чужих точек рядом тусуются по двое (мирно, пока не тронешь)
      idleT -= dt;
      if (idleT <= 0) {
        idleT = 2;
        for (var q = 0; q < POINTS.length; q++) {
          var pp = POINTS[q], dd = FC.dist2(pp.x, pp.z, P.x, P.z);
          var have = crew.filter(function (m) { return m.p === pp; }).length;
          if (dd < 70 * 70 && !have && !(cap && cap.i === q) && !inside) spawnCrew(pp, owner(pp), "idle", 2);
          if (dd > 140 * 140) crew.filter(function (m) { return m.p === pp && m.role === "idle"; }).forEach(dropCrew);
        }
      }
      if (!cap && !raid) hideBar();
    }
  });
  // тронул мирного бойца — его банда злится
  FC.on("ped:hit", function (e) {
    var m = e && e.ch && e.ch.crew; if (!m) return;
    crew.forEach(function (o) { if (o.p === m.p) o.angry = true; });
  });

  /* ---- карта: точки цветом хозяина ------------------------------------------------------------------------- */
  FC.hud.addMapLayer(function (c, k, mode) {
    var tier = mode === "big" && FC.hud.mapTier ? FC.hud.mapTier(k) : 2;
    if (tier === 0) return;
    var r = (mode === "big" ? (tier === 2 ? 8 : 4) : 5) / k;
    for (var i = 0; i < POINTS.length; i++) {
      var p = POINTS[i], t = TEAMS[owner(p)];
      if (mode === "big" && c.spot && !c.spot(p.x, p.z, r)) continue;
      c.globalAlpha = mode === "big" ? 0.85 : 0.75;
      c.fillStyle = t.color; c.beginPath(); c.arc(p.x, p.z, r, 0, 7); c.fill();
      if (mine(p)) { c.strokeStyle = "#ffcf7a"; c.lineWidth = 2 / k; c.stroke(); }
      if (mode === "big" && tier === 2) { c.globalAlpha = 1; c.fillStyle = "#fff"; c.font = (11 / k) + "px system-ui"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(p.icon, p.x, p.z); }
    }
    c.globalAlpha = 1;
  });

  /* ---- приложение «Районы» ---------------------------------------------------------------------------------- */
  FC.hud.addApp({
    id: "gang", icon: "🏴", name: "Районы", color: "#7a1f2b", order: 8,
    badge: function () { var g = FC.save && FC.save.gang; return g && g.safe > 0 ? "$" : ""; },
    render: function (b, api) {
      var g = S(), me = team(), esc = FC.hud.esc;
      var html = "<div class='list'><div class='card'><b>Твоя команда: <span class='gtag' style='background:" + TEAMS[me].color + "'>" + TEAMS[me].emoji + " " + esc(TEAMS[me].name) + "</span></b>" +
        "<p>Встань в круг чужой точки, раскидай защитников и держи круг 10 с. Твои точки приносят деньги раз в игровой час.</p></div>";
      html += "<div class='card'><b>💰 Сейф районов: " + FC.fmtMoney(g.safe || 0) + "</b><p>Потолок — 8 часов дохода.</p>" +
        "<button type='button' data-act='collect'" + (g.safe ? "" : " disabled") + ">Забрать</button></div>";
      KEYS.forEach(function (dk) {
        var list = POINTS.filter(function (p) { return p.dist === dk; });
        var my = list.filter(mine).length, ours = list.filter(function (p) { return owner(p) === me; }).length;
        html += "<div class='card'><b>" + esc(M.DIST[dk].name) + " · <span class='gtag' style='background:" + TEAMS[dk].color + "'>" + TEAMS[dk].emoji + " " + esc(TEAMS[dk].short) + "</span></b>" +
          "<p>Наших точек: " + ours + " из " + list.length + (my ? " · захвачено тобой: " + my : "") + (g.won.indexOf(dk) >= 0 ? " · 👑 район твой" : "") + "</p>" +
          "<button type='button' class='ghost' data-act='near' data-d='" + dk + "'>Ближайшая чужая точка</button></div>";
      });
      html += "<div class='card'><b>Сменить команду</b><p>Захваченные точки остаются твоими.</p>" + KEYS.map(function (k) {
        return "<button type='button' class='ghost' data-act='join' data-k='" + k + "'" + (k === me ? " disabled" : "") + ">" + TEAMS[k].emoji + " " + esc(TEAMS[k].short) + "</button> ";
      }).join("") + "</div>";
      html += "<div class='card'><p class='quiet'>Захвачено: " + (g.caps || 0) + " · отбито налётов: " + (g.defs || 0) + "</p></div></div>";
      b.innerHTML = html;
      b.onclick = function (e) {
        var t = e.target.closest("button"); if (!t) return;
        var act = t.dataset.act;
        if (act === "collect" && g.safe) { FC.money(g.safe, "сейф районов"); g.safe = 0; FC.dirty(); api.refresh(); }
        if (act === "join") { g.team = t.dataset.k; FC.dirty(); POINTS.forEach(function (p, i) { paint(i); }); FC.hud.toast("Теперь ты в «" + TEAMS[g.team].name + "»", "ok", 2.5); api.refresh(); }
        if (act === "near") {
          var P = FC.player, best = null, bd = 1e18;
          POINTS.forEach(function (p) { if (p.dist === t.dataset.d && owner(p) !== me) { var d = FC.dist2(p.x, p.z, P.x, P.z); if (d < bd) { bd = d; best = p; } } });
          if (!best) { FC.hud.toast("Весь район уже твой", "ok", 2); return; }
          FC.markers.add({ id: "gang", x: best.x, z: best.z, color: TEAMS[owner(best)].color, icon: best.icon, route: true, ring: R_CAP });
          FC.hud.toast("📍 " + nameOf(best), "ok", 2); api.close();
        }
      };
    }
  });
  FC.on("gang:capture", function () { FC.markers.remove("gang"); });

  FC.gang = { TEAMS: TEAMS, POINTS: POINTS, team: team, owner: owner, mine: mine, nameOf: nameOf,
    raid: function () { if (!raid) startRaid(); return !!raid; } };
})(window);
