/* Флейм-Сити — «кататься вместе» (25.11.2026): сесть пассажиром в машину, вертолёт или самолёт другого игрока.
 *
 * Задача владельца: «чтобы в машину можно было сесть вдвоём, втроём — вместе кататься в машинах»; «если я вызвал
 * вертолёт, любой игрок должен в него сесть — или мы вместе в нём летим».
 *
 * Пешком у чужой машины (водитель в сети, m 1) или вертолёта/самолёта (пилот, m 3) — подсказка «Сесть пассажиром · ник»
 * на той же кнопке, что «сесть в машину» (F / 🚗). Места решает сервер (server/ride.py): мотоцикл — 1 пассажир, седан —
 * 3, вертолёт — 3. Пассажир — режим игрока P.mode = "ride": fmain его не двигает, здесь он сидит на своём месте в машине
 * водителя; камера — за машиной, обзор крутится как обычно, F / 🚪 — выйти рядом с машиной на проходимое место. В
 * воздухе — как у пилота (fair.js exitCur): высоко — прыжок с парашютом (FC.air.openChute), низко — «пусть сначала сядет».
 *
 * Плавность: водитель с пассажирами шлёт состояние ровно 10 Гц со своим временем кадра (fmp: MP.rideStamp → ts), сервер
 * сразу пересылает его пассажирам (ride {e: pos}). Пассажир переводит часы водителя в свои по самому быстрому кадру за
 * последние секунды (наименьшая задержка сети), рисует машину на delay мс в прошлом (delay — по разбросу задержки) и
 * ведёт её сплайном Эрмита по кадрам: ни сеть, ни несовпадение такта рассылки сервера с тактом водителя не дают рывков.
 * Модель машины водителя (fmp), сам пассажир, соседи по салону и таблички — по одной этой позе в кадре.
 *
 * Водитель видит «Ник сел к тебе» и подсказку E / ✋ «Высадить» (высаженный минуту не сядет к нему снова). Все рядом
 * видят пассажиров: строка пассажира в кадре w — m 5 (копия водителя, a — место); в открытых (мотоцикл, тук-тук) —
 * фигура в седле, в закрытых и в вертолёте — табличка с 💺 над табличкой водителя (стопкой по местам).
 * Выход по любой причине (водитель вышел, ушёл из игры, переместился, высадил, связь пропала, вырубился) — на
 * проходимую точку у машины: не в здание и не в воду; с высоты — парашют.
 *
 * FC.ride: {state(), board(id), exit(), kick(), passengers()} — для проверок и других модулей; события шины
 * «ride:in», «ride:out».
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE, M = FC.map;
  var DELAY0 = 150, EXTRA = 250, SNAP = 80;

  FC.css([
    ".mp-tag.ride{background:rgba(255,138,61,.88)}.mp-tag.ride:before{content:'💺 '}"
  ].join(""));

  var ON = false;            // сервер умеет поездки (welcome.ride)
  var S = null;              // я пассажир: {id водителя, seat, m, c, air, buf, …}
  var asking = null;         // жду ответа «сесть»: {id, t}
  var mine = [], myPass = {}, mineT = 0;   // я водитель: [[id, место, ник]], id → место, когда кто-то сел
  // Сколько пассажиров (как server/ride.py SEATS — решает сервер; здесь — только подпись «мест нет»)
  var SEATS = { moto: 1, moto_c: 1, tuk: 2, truck: 2, kaze_rd: 1, tauro: 1, tauro_v: 1, corsaro: 1, hyper: 1, hyper500: 1,
    ev_hyper: 1, plane_jet: 1 };

  function mp() { return FC.mp; }
  function seatsOf(c) { return SEATS[c] || 3; }
  function airSpec(c) { return FC.air && FC.air.SPEC && FC.air.SPEC[c]; }
  function carSpec(c) { var TY = FC.cars && FC.cars.TYPES; return TY ? TY[c] || TY.sedan : null; }
  function openSeat(c) { var sp = !airSpec(c) && carSpec(c); return !!sp && (!!sp.moto || sp.fb === "tuk"); }
  // пилот в состоянии сервера — на метр выше корпуса (fair.js sync): модель ставим на корпус, а не над ним
  function airLift(c) { var a = airSpec(c); return a && a.kind === "plane" ? 1.2 : 1.0; }
  // «Сесть пассажиром» / «Сесть в вертолёт» / «Сесть на мотоцикл» — подпись подсказки по машине водителя
  function phrase(c, m) {
    var a = m === 3 && airSpec(c);
    if (a) return a.kind === "heli" ? "Сесть в вертолёт" : "Сесть в самолёт";
    var sp = carSpec(c);
    return sp && sp.moto ? "Сесть на мотоцикл" : sp && sp.fb === "tuk" ? "Сесть в тук-тук" : "Сесть пассажиром";
  }
  // высота таблички над корпусом — как у fmp (там от высоты игрока: в машине 0,6 + 2,3, пилот — корпус + 1 + 4); над своей
  // машиной (я за рулём или в ней) камера близко — табличка над самой крышей, иначе висит высоко над машиной
  function tagY(c, base, own) { return base + (airSpec(c) ? (own ? 3.4 : airLift(c) + 4) : own ? 1.9 : 2.9); }
  function nick(r) { var m = r && r.meta; return (m && (m.name || m.pn || m.nick)) || "Игрок"; }   // как табличка fmp: свой ник (fnick) первым
  function toast(t, k, s) { if (FC.hud) FC.hud.toast(t, k || "", s || 2.5); }
  function walkable(x, z) { return !M.buildingAt(x, z, 0.35) && !(M.water(x, z) && !M.onRoad(x, z)); }

  /* ---- места в машине: смещение от центра (вправо, вверх, вперёд) ---------------------------------------------------- */
  // водитель сидит слева (fcars exit: дверь водителя слева), место 0 — он сам (седок мотоцикла и тук-тука у чужих)
  var SL = { x: 0, y: 0, z: 0 };
  function seatLocal(c, seat) {
    var a = airSpec(c), sp = a ? null : carSpec(c);
    SL.y = 0;
    if (a) { SL.x = seat === 2 ? -0.55 : 0.55; SL.z = seat <= 1 ? 0.7 : -0.6; }
    else if (sp && sp.moto) { SL.x = 0; SL.z = seat ? -0.78 : -0.28; SL.y = seat ? 0.5 : 0.44; }
    else if (sp && sp.fb === "tuk") { SL.x = seat ? (seat === 1 ? -0.32 : 0.32) : 0; SL.z = seat ? -0.5 : 0.2; SL.y = seat ? 0.3 : 0.36; }
    else { var L = (sp && sp.L) || 4.6; SL.x = seat === 2 || !seat ? -0.42 : 0.42; SL.z = seat <= 1 ? 0.1 : -Math.min(1.1, L * 0.2); }
    return SL;
  }
  var SW = { x: 0, z: 0 };
  function seatWorld(c, seat, x, z, h) {
    var o = seatLocal(c, seat), fx = Math.sin(h), fz = Math.cos(h);     // вперёд (sin h, cos h), вправо (−cos h, sin h)
    SW.x = x + fx * o.z - fz * o.x; SW.z = z + fz * o.z + fx * o.x;
    return SW;
  }

  /* ---- таблички над машиной: водитель, под ним пассажиры по местам ------------------------------------------------- */
  var tv = null;
  function tagAt(r, x, y, z, lift) {
    if (!r.tag) return;
    var cam = FC.gfx && FC.gfx.camera;
    if (!cam || !T) return;
    tv = tv || new T.Vector3();
    tv.set(x, y, z).project(cam);
    if (tv.z > 1 || FC.dist2(x, z, cam.position.x, cam.position.z) > 70 * 70 || (FC.inside && FC.inside.active)) { r.tag.style.display = "none"; return; }
    r.tag.style.display = "";
    r.tag.style.transform = "translate(" + ((tv.x + 1) / 2 * global.innerWidth) + "px," + ((1 - tv.y) / 2 * global.innerHeight - lift) + "px) translate(-50%,-100%)";
  }
  // фигура в седле (открытые) или спрятана в салоне; r._sat — чтобы вернуть, когда он выйдет
  function sit(ch, show, x, y, z, h) {
    ch.x = x; ch.z = z; ch.vx = ch.vz = 0; ch.speed = 0; ch.visible = show;
    if (show) {
      if (ch._rideSc == null) ch._rideSc = ch.scale;
      ch.scale = ch._rideSc * 0.82; ch.sit = true; ch.y = y; ch._yaw = h; ch.look = null;
    }
  }
  function unsit(ch) {
    ch.sit = false;
    if (ch._rideSc != null) { ch.scale = ch._rideSc; ch._rideSc = null; }
  }
  // F.y — низ корпуса (машина — 0, вертолёт — его высота)
  function placeRemote(r, F, seat) {
    var o = seatWorld(F.c, seat, F.x, F.z, F.h);
    sit(r.ch, openSeat(F.c), o.x, F.y + seatLocal(F.c, seat).y, o.z, F.h);
    if (!r._sat) { r._sat = true; if (seat && r.tag) r.tag.classList.add("ride"); }
  }
  function freeRemote(r) {
    if (!r._sat) return;
    r._sat = false; unsit(r.ch);
    if (r.tag) r.tag.classList.remove("ride");
  }

  /* ---- поза машины для пассажира: часы водителя → свои, сплайн Эрмита по кадрам ---------------------------------- */
  var pose = { x: 0, y: 0, z: 0, h: 0, vx: 0, vz: 0, ok: false }, raw = { x: 0, y: 0, z: 0, h: 0, vx: 0, vz: 0 };
  function lerpAng(a, b, t) { var d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; }
  function onPos(m) {
    if (!S || !m.p || typeof m.ts !== "number") return;      // без времени водителя — ведёт строка fmp (r.s)
    var now = performance.now(), o = now - m.ts, b = S.buf;
    S.offs.push(o); if (S.offs.length > 40) S.offs.shift();
    var srt = S.offs.slice().sort(function (a, c) { return a - c; });
    S.offMin = srt[0]; S.jit = srt[Math.floor(srt.length * 0.9)] - srt[0];
    if (S.off == null) S.off = S.offMin;
    var last = b[b.length - 1];
    if (last && m.ts <= last.ts) return;                      // запоздавший кадр — у нас уже новее
    if (last && Math.hypot(m.p[0] - last.x, m.p[2] - last.z) > SNAP) b.length = 0;   // скачок — без «полёта»
    b.push({ ts: m.ts, x: m.p[0], y: m.p[1], z: m.p[2], h: m.p[3] });
    if (b.length > 24) b.shift();
  }
  function fromBuf(now) {
    var b = S.buf, n = b.length;
    if (n < 2 || S.off == null) return false;
    var t = now - S.off - S.delay;
    var i = n - 2;
    while (i > 0 && b[i].ts > t) i--;
    var A = b[i], B = b[i + 1], d = Math.max(1, B.ts - A.ts), u = (t - A.ts) / d;
    var P0 = b[i - 1] || A, P3 = b[i + 2] || B;
    var dA = Math.max(1, B.ts - P0.ts), dB = Math.max(1, P3.ts - A.ts);
    raw.vx = (B.x - A.x) / d * 1000; raw.vz = (B.z - A.z) / d * 1000;
    if (u > 1) {                                               // кадр запоздал — недолго ведём по скорости
      var e = Math.min(t - B.ts, EXTRA) / 1000;
      raw.x = B.x + raw.vx * e; raw.z = B.z + raw.vz * e; raw.y = B.y; raw.h = B.h;
      return true;
    }
    if (u < 0) u = 0;
    var u2 = u * u, u3 = u2 * u;
    var h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    raw.x = h00 * A.x + h10 * d * (B.x - P0.x) / dA + h01 * B.x + h11 * d * (P3.x - A.x) / dB;
    raw.z = h00 * A.z + h10 * d * (B.z - P0.z) / dA + h01 * B.z + h11 * d * (P3.z - A.z) / dB;
    raw.y = h00 * A.y + h10 * d * (B.y - P0.y) / dA + h01 * B.y + h11 * d * (P3.y - A.y) / dB;
    raw.h = lerpAng(A.h, B.h, u);
    return true;
  }
  function fromRow() {
    var r = mp() && mp().remotes[S.id], s = r && r.s;
    if (!s) return false;
    raw.x = s.x; raw.y = s.y; raw.z = s.z; raw.h = s.h; raw.vx = r.ch ? r.ch.vx || 0 : 0; raw.vz = r.ch ? r.ch.vz || 0 : 0;
    return true;
  }
  function stepPose(now, dt) {
    S.off = S.off == null ? null : FC.damp(S.off, S.offMin, 1.5, dt);
    S.delay = FC.damp(S.delay, FC.clamp(125 + S.jit, DELAY0, 450), 1, dt);
    var src = fromBuf(now) ? "buf" : fromRow() ? "row" : "p0";
    if (src === "p0") { raw.x = S.p0[0]; raw.y = S.p0[1]; raw.z = S.p0[2]; raw.h = S.p0[3]; raw.vx = raw.vz = 0; }
    // источник сменился (строка fmp → свой поток) — разницу не прыгаем, а гасим за ~0,3 с
    if (S.src && src !== S.src && pose.ok && Math.hypot(pose.x - raw.x, pose.z - raw.z) < SNAP) {
      S.ex = pose.x - raw.x; S.ey = pose.y - raw.y; S.ez = pose.z - raw.z;
    }
    S.src = src;
    var k = Math.exp(-dt * 6);
    S.ex *= k; S.ey *= k; S.ez *= k;
    pose.x = raw.x + S.ex; pose.y = raw.y + S.ey; pose.z = raw.z + S.ez; pose.h = raw.h; pose.vx = raw.vx; pose.vz = raw.vz; pose.ok = true;
  }

  /* ---- поездка: сесть, ехать, выйти ---------------------------------------------------------------------------- */
  var I = FC.input;
  function buttons(on) {
    if (!I || !I.setButton) return;
    I.setButton("car", { label: on ? "🚪" : "🚗" });
    ["punch", "jump", "roll"].forEach(function (b) { I.setButton(b, { show: !on }); });
  }
  function board(id) {
    var P = FC.player;
    if (!ON || S || asking || !P || P.mode !== "foot" || !mp() || !mp().send({ t: "ride", a: "in", id: +id })) return false;
    asking = { id: +id, t: performance.now() };
    return true;
  }
  function onSeat(m) {
    asking = null;
    var P = FC.player;
    if (S || !P || P.mode !== "foot" || P.dead || (FC.inside && FC.inside.active)) { mp().send({ t: "ride", a: "out" }); return; }
    var a = m.m === 3 && airSpec(m.c);
    S = { id: m.id, seat: m.seat || 1, m: m.m, c: m.c, max: m.max, nick: m.nick || "Игрок", air: !!a, plane: !!(a && a.kind === "plane"),
      buf: [], offs: [], off: null, offMin: 0, jit: 0, delay: DELAY0, p0: m.p || [P.x, 0.6, P.z, 0], src: "", ex: 0, ey: 0, ez: 0,
      mates: {}, lx: null, lz: null, dist: a ? a.dist || 15 : (carSpec(m.c) || {}).camDist || 8.5 };
    pose.ok = false;
    P.mode = "ride"; P.ride = S; P.vx = P.vz = P.vy = 0; P.onGround = true;
    buttons(true);
    if (FC.audio) FC.audio.play("door");
    toast(S.air ? "🚁 Летишь с " + S.nick : "🚗 Едешь с " + S.nick, "ok", 2.5);
    if (FC.hud) FC.hud.help((I && I.touch ? "🚪" : "<b>F</b>") + " — выйти · обзор — " + (I && I.touch ? "правым пальцем" : "мышью"), 5);
    FC.emit("ride:in", { id: S.id, seat: S.seat, c: S.c, air: S.air });
  }
  var OUT = { kick: "Водитель тебя высадил", drv_out: "Водитель вышел — приехали", drv_left: "Водитель вышел из игры",
    tp: "Водитель переместился — ты остался здесь", net: "Связь с онлайном пропала — ты вышел", hurt: "" };
  // drop: false — игрока уже переместил кто-то другой (карта, больница), ставить у машины не надо
  function leave(why, send, drop) {
    if (!S) return;
    var s = S, P = FC.player;
    S = null; P.ride = null;
    if (send && mp()) mp().send({ t: "ride", a: "out" });
    buttons(false);
    if (P.ch) { unsit(P.ch); P.ch.visible = true; }
    if (FC.audio && FC.audio.loop) { FC.audio.loop("engine", false); FC.audio.loop("heli", false); }
    if (P.mode === "ride") { P.mode = "foot"; if (drop !== false) dropOut(s); }
    if (OUT[why]) toast(OUT[why], why === "kick" ? "bad" : "", 3);
    else if (why === "exit" && FC.audio) FC.audio.play("door");
    FC.emit("ride:out", { why: why, id: s.id });
  }
  function setPos(x, z, h) { var P = FC.player; P.x = x; P.z = z; P.y = 0.2; P.vy = 0; P.heading = h; P.onGround = true; }
  /* Куда встать: в воздухе выше 4 м — парашют; на крыше — к двери этого здания внизу; на палубе аэродрома — на пляж;
     на земле — пассажирская дверь (справа), потом слева, сзади, спереди, дальше; всё занято — ближайшая полоса дороги. */
  function dropOut(s) {
    var P = FC.player, x = pose.ok ? pose.x : P.x, z = pose.ok ? pose.z : P.z, h = pose.ok ? pose.h : P.heading;
    P.vx = P.vz = 0;
    if (s.air && FC.air && FC.air.ground) {
      var gr = FC.air.ground(x, z), agl = pose.y - airLift(s.c) - gr.h;
      if (agl > 4 && FC.air.openChute) {
        P.x = x; P.z = z; P.y = pose.y - 1.5; P.vy = 0;
        FC.air.openChute(pose.vx * 0.5, pose.vz * 0.5);
        toast("🪂 Прыжок! Джойстик/WASD — рулить куполом", "", 3);
        return;
      }
      var d = gr.B && gr.B.doors && gr.B.doors[0];
      if (d) { setPos(d.x + d.nx * 2.5, d.z + d.nz * 2.5, h); return; }
      if (gr.deck && FC.air.board) { setPos(FC.air.board.x, FC.air.board.z, h); return; }
    }
    var sp = s.air ? null : carSpec(s.c), W = sp ? sp.W / 2 + 0.9 : 4, L = sp ? sp.L / 2 + 1.1 : 6.5;
    var fx = Math.sin(h), fz = Math.cos(h);
    var opts = [[-fz * W, fx * W], [fz * W, -fx * W], [-fx * L, -fz * L], [fx * L, fz * L], [-fz * W * 2.2, fx * W * 2.2], [fz * W * 2.2, -fx * W * 2.2]];
    for (var i = 0; i < opts.length; i++) {
      var tx = x + opts[i][0], tz = z + opts[i][1];
      if (!walkable(tx, tz)) continue;
      var c = M.collide(tx, tz, 0.4);
      if (walkable(c.x, c.z)) { setPos(c.x, c.z, h); return; }
    }
    var ln = M.nearestLane && M.nearestLane(x, z);
    if (ln && walkable(ln.x, ln.z)) { setPos(ln.x, ln.z, h); return; }
    var sw = M.sidewalkPoint && M.sidewalkPoint(FC.rng(FC.hash(Math.round(x) + ":" + Math.round(z))), x, z, 80);
    if (sw && walkable(sw.x, sw.z)) { setPos(sw.x, sw.z, h); return; }
    setPos(x, z, h);
  }
  function agl() {
    if (!S || !S.air || !pose.ok || !(FC.air && FC.air.ground)) return 0;
    return pose.y - airLift(S.c) - FC.air.ground(pose.x, pose.z).h;
  }
  // выход по кнопке: как у пилота — в воздухе высоко прыжок с парашютом, низко — ждать посадки
  function exit() {
    if (!S) return false;
    var a = agl();
    if (a > 2.5 && a <= 18) { toast("Пусть пилот сначала сядет — или поднимется выше для прыжка с парашютом", "", 2.5); return false; }
    leave(a > 18 ? "jump" : "exit", true);
    return true;
  }
  function stepRide(dt, now) {
    var P = FC.player;
    if (P.mode !== "ride" || P.dead) { leave("hurt", true, false); return; }
    // кто-то переместил игрока (карта, больница, сюжет) — значит, он уже не в машине
    if (S.lx != null && Math.hypot(P.x - S.lx, P.z - S.lz) > 4) { leave("moved", true, false); return; }
    stepPose(now, dt);
    // выход — кнопкой 🚪 / F, как у водителя (fcars), без подсказки посреди экрана; в воздухе высоко кнопка — 🪂
    var hi = agl() > 18;
    if (hi !== S.hi) {
      S.hi = hi;
      if (I && I.setButton) I.setButton("car", { label: hi ? "🪂" : "🚪" });
      if (hi && FC.hud) FC.hud.help((I && I.touch ? "🪂" : "<b>F</b>") + " — прыгнуть с парашютом", 4);
    }
    if (I && I.pressed("car")) { I.consume("car"); exit(); if (!S) return; }
    var o = seatWorld(S.c, S.seat, pose.x, pose.z, pose.h), open = openSeat(S.c);
    P.x = o.x; P.z = o.z; P.y = pose.y; P.heading = pose.h; P.vx = pose.vx; P.vz = pose.vz; P.vy = 0; P.onGround = true;
    S.lx = P.x; S.lz = P.z;
    if (P.ch) { P.ch.y = P.y; sit(P.ch, open, o.x, (S.air ? pose.y - airLift(S.c) : 0) + seatLocal(S.c, S.seat).y, o.z, pose.h); }
    var r = mp() && mp().remotes[S.id];                        // седок мотоцикла водителя — в седле
    if (r && r.ch && open) { var od = seatWorld(S.c, 0, pose.x, pose.z, pose.h); sit(r.ch, true, od.x, seatLocal(S.c, 0).y, od.z, pose.h); r._sat = true; }
    if (FC.audio && FC.audio.loop) {
      var spd = Math.hypot(pose.vx, pose.vz);
      if (S.air && !S.plane) FC.audio.loop("heli", true, { vol: 0.55 });
      else {
        var cs = S.air ? null : carSpec(S.c), vmax = cs ? cs.vmax || 40 : 60, snd = cs && cs.snd ? cs.snd : [1, 0.8];
        FC.audio.loop("engine", true, { rate: (0.55 + Math.min(1, spd / vmax) * 0.8) * snd[0], vol: (0.22 + Math.min(0.3, spd / vmax * 0.3)) * snd[1], kind: snd[2] });
      }
    }
  }

  /* ---- все остальные: пассажиры по местам, седоки мотоциклов, вертолёты на корпусе --------------------------------- */
  function localFrame() {
    var P = FC.player;
    if (P.mode === "car" && P.car) { LF.x = P.car.x; LF.y = P.car.y || 0; LF.z = P.car.z; LF.h = P.car.heading; LF.c = P.car.type; return LF; }
    if (P.mode === "air" && P.air) { LF.x = P.air.x; LF.y = P.air.y; LF.z = P.air.z; LF.h = P.heading; LF.c = P.air.type; return LF; }
    return null;
  }
  var LF = { x: 0, y: 0, z: 0, h: 0, c: "" }, RF = { x: 0, y: 0, z: 0, h: 0, c: "" };
  // в какой машине сидит пассажир n: в моей (я за рулём), в той же, что я (сглаженная поза), или по его строке
  function frameOf(n, s, lf) {
    if (lf && myPass[n]) return lf;
    if (S && S.mates[n] && pose.ok) { RF.c = S.c; RF.x = pose.x; RF.y = S.air ? pose.y - airLift(S.c) : 0; RF.z = pose.z; RF.h = pose.h; return RF; }
    RF.c = s.c; RF.x = s.x; RF.y = airSpec(s.c) ? s.y - airLift(s.c) : 0; RF.z = s.z; RF.h = s.h;
    return RF;
  }
  /* Фигуры — до отрисовки людей (fpeople, order 30): позиции пассажиров, седоков мотоциклов. Строки — с прошлого кадра
     fmp (как у всех чужих фигур). Таблички и модели машин fmp ставит позже (85) — их правим в tagsAndCars. */
  function decorate() {
    var all = mp() && mp().remotes; if (!all) return;
    var lf = mine.length ? localFrame() : null;
    for (var id in all) {
      var r = all[id], s = r.s, n = +id;
      if (!s || !r.ch || (S && n === S.id)) continue;         // водитель моей машины — в stepRide
      if (s.m === 5) { placeRemote(r, frameOf(n, s, lf), s.a || 1); continue; }
      if (s.m === 1 && openSeat(s.c)) {                       // седок чужого мотоцикла (модель fmp — только сама машина)
        var o = seatWorld(s.c, 0, s.x, s.z, s.h);
        sit(r.ch, true, o.x, seatLocal(s.c, 0).y, o.z, s.h);
        r._sat = true;
        continue;
      }
      freeRemote(r);
    }
  }
  // после fmp (85): модель машины моего водителя — по моей позе, вертолёты — на корпус, таблички пассажиров — стопкой
  function tagsAndCars() {
    var all = mp() && mp().remotes; if (!all) return;
    var lf = mine.length ? localFrame() : null;
    for (var id in all) {
      var r = all[id], s = r.s, n = +id;
      if (!s || !r.ch) continue;
      if (S && n === S.id && pose.ok) {                       // машина водителя и его табличка — по той же позе, что и мы
        var cv = r.car && (r.car.isObject3D ? r.car : r.car.obj), y0 = S.air ? pose.y - airLift(S.c) : 0;
        if (cv) { cv.position.set(pose.x, y0, pose.z); cv.rotation.y = pose.h; }
        tagAt(r, pose.x, tagY(S.c, y0, true), pose.z, 0);
        continue;
      }
      if (s.m === 5) { var F = frameOf(n, s, lf); tagAt(r, F.x, tagY(F.c, F.y, F !== RF || (S && S.mates[n])), F.z, (s.a || 1) * 20); continue; }
      if (s.m === 3 && r.car && r.car.isObject3D) r.car.position.y = s.y - airLift(s.c);
    }
  }

  /* ---- кадры сервера ------------------------------------------------------------------------------------------- */
  function onCar(m) {
    var me = mp() && mp().id;
    if (m.id === me) {
      var was = {}, now = {};
      mine.forEach(function (p) { was[p[0]] = p; });
      (m.ps || []).forEach(function (p) {
        now[p[0]] = 1;
        if (!was[p[0]]) { toast("💺 " + p[2] + " сел к тебе", "ok", 3); mineT = performance.now(); if (FC.audio) FC.audio.play("door"); }
      });
      mine.forEach(function (p) { if (!now[p[0]]) toast(p[2] + " вышел", "", 2); });
      mine = m.ps || []; myPass = {};
      mine.forEach(function (p) { myPass[p[0]] = p[1]; });
      if (mp()) mp().rideStamp = mine.length > 0;
    }
    if (S && m.id === S.id) {
      S.mates = {}; S.max = m.max;
      (m.ps || []).forEach(function (p) { if (p[0] !== me) S.mates[p[0]] = p[1]; });
    }
  }
  FC.on("mp:ride", function (m) {
    if (m.e === "pos") onPos(m);
    else if (m.e === "seat") onSeat(m);
    else if (m.e === "car") onCar(m);
    else if (m.e === "out") { if (S && m.id === S.id) leave(m.why, false); }
    else if (m.e === "no") { asking = null; toast(m.why || "Не получилось сесть", "bad", 2.5); }
  });
  FC.on("mp:on", function (m) { ON = !!(m && m.ride); });
  FC.on("mp:off", function () {
    ON = false; asking = null;
    if (S) leave("net", false);
    mine = []; myPass = {};
    if (mp()) mp().rideStamp = false;
  });
  FC.on("wasted", function () { if (S) leave("hurt", true); });
  FC.on("busted", function () { if (S) leave("hurt", true); });

  /* ---- подсказки: сесть к игроку, выйти, высадить ------------------------------------------------------------------ */
  function passengersOf(r) {
    var all = mp().remotes, n = 0;
    for (var id in all) { var q = all[id].s; if (q && q.m === 5 && Math.abs(q.x - r.s.x) < 1 && Math.abs(q.z - r.s.z) < 1) n++; }
    return n;
  }
  function moving(r) {
    var b = r.buf, n = b.length;
    if (n < 2) return false;
    var A = b[n - 2], B = b[n - 1];
    return Math.hypot(B.x - A.x, B.z - A.z) / Math.max(0.05, (B.t - A.t) / 1000) > 6;
  }
  // от игрока до кузова: машина — до прямоугольника (как fcars carProvider), вертолёт и самолёт — до корпуса по кругу
  function bodyDist(s, px, pz) {
    var dx = px - s.x, dz = pz - s.z;
    if (s.m === 3) { var a = airSpec(s.c); return Math.max(0, Math.hypot(dx, dz) - (a && a.kind === "plane" ? 6.5 : 5)); }   // винт «Шмеля» ~5 м
    var sp = carSpec(s.c), W = sp ? sp.W / 2 : 0.95, L = sp ? sp.L / 2 : 2.3, fx = Math.sin(s.h), fz = Math.cos(s.h);
    var lz = dx * fx + dz * fz, lx = -dx * fz + dz * fx;
    return Math.hypot(lx - FC.clamp(lx, -W, W), lz - FC.clamp(lz, -L, L));
  }
  function localNearer(px, pz, d) {
    var L = FC.cars && FC.cars.list;
    for (var i = 0; L && i < L.length; i++) {
      var c = L[i];
      if (c.wrecked || c.driver === "player" || Math.abs(c.x - px) > 8 || Math.abs(c.z - pz) > 8 || Math.hypot(c.vx, c.vz) >= 6) continue;
      if (bodyDist({ m: 1, c: c.type, x: c.x, z: c.z, h: c.heading }, px, pz) < Math.min(d, 2.2)) return true;
    }
    return false;
  }
  function provider(px, pz, room) {
    var P = FC.player;
    if (!ON || room != null || !P || P.dead || !mp()) return null;
    if ((P.mode === "car" || P.mode === "air") && mine.length) {
      var car = P.car, A = P.air;
      var slow = car ? Math.hypot(car.vx, car.vz) < 3 : A ? A.onGround : false;
      if (!slow && performance.now() - mineT > 10000) return null;
      // чуть в стороне: подсказки рядом (гонка, перекраска) ближе — они и важнее
      return [{ id: "ride_kick", x: px + 3.9, z: pz, r: 4, key: "use", mode: P.mode,
        label: mine.length === 1 ? "Высадить · " + mine[0][2] : "Высадить пассажиров (" + mine.length + ")", act: function () { kick(); } }];
    }
    if (P.mode !== "foot" || asking) return null;
    var all = mp().remotes, best = null, bd = 1e9;
    for (var id in all) {
      var r = all[id], s = r.s;
      if (!s || (s.m !== 1 && s.m !== 3) || !r.ch) continue;
      var d = bodyDist(s, px, pz);
      if (d > 2.5 || d >= bd || Math.hypot(s.x - px, s.z - pz) > (s.m === 3 ? 10 : 7.5) || Math.abs((s.m === 3 ? s.y - airLift(s.c) : 0) - (P.y || 0)) > 5 || moving(r)) continue;
      best = r; bd = d;
    }
    // своя машина или вертолёт ближе чужой — подсказка их (fcars/fair), иначе — наша (провайдер раньше их: ничья — за нами)
    if (!best || localNearer(px, pz, bd)) return null;
    var b = best, bs = b.s, full = passengersOf(b) >= seatsOf(bs.c);
    var label = (full ? "Мест нет" : phrase(bs.c, bs.m)) + " · " + nick(b);
    return [{ id: "ride_" + b.id, x: px, z: pz, r: 1, key: "car", mode: "foot", label: label,
      act: function () { if (full) toast("Мест нет", "", 2); else board(b.id); } }];
  }
  function kick(id) {
    if (!mine.length || !mp()) return false;
    return mp().send(id != null ? { t: "ride", a: "kick", id: +id } : { t: "ride", a: "kick" });
  }

  /* ---- камера пассажира: за машиной, если обзор не крутят 1,2 с (как fcars/fair) ---------------------------------- */
  var camIdle = 2;
  function wrapCamera() {
    var sys = FC.systems.filter(function (s) { return s.name === "camera"; })[0];
    if (!sys || sys._rideWrap) return;
    var orig = sys.update; sys._rideWrap = true;
    sys.update = function (dt) {
      var P = FC.player, cam = FC.cam;
      if (!S || !P || P.mode !== "ride" || !cam) { camIdle = 2; orig(dt); return; }
      var saved = cam.want;
      cam.want = S.dist;
      if (camIdle > 1.2) {
        cam.yaw = FC.angDamp(cam.yaw, pose.h + Math.PI, S.air ? 2.2 : 3.2, dt);
        cam.pitch = FC.damp(cam.pitch, S.air ? 0.3 : 0.22, 2, dt);
      }
      cam.idle = 0;
      orig(dt);
      camIdle = cam.idle > 0 ? camIdle + dt : 0;
      cam.want = saved;
    };
  }

  // поза и фигуры — после машин (20) и до отрисовки людей (30); модели машин и таблички — после fmp (85), до камеры (95)
  FC.addSystem({
    name: "ride", order: 25, init: wrapCamera,
    update: function (dt) {
      if (!FC.started) return;
      var now = performance.now();
      if (asking && now - asking.t > 3500) asking = null;
      if (S) stepRide(dt, now);
      decorate();
    }
  });
  FC.addSystem({ name: "ride-tags", order: 86, update: function () { if (FC.started) tagsAndCars(); } });

  // провайдер — сразу при загрузке, до fcars/fair (их — в init): у чужой машины ближе своей ничья за «сесть пассажиром»
  FC.interact.provider(provider);

  FC.ride = {
    state: function () { return S ? { id: S.id, seat: S.seat, c: S.c, air: S.air, nick: S.nick, src: S.src, delay: Math.round(S.delay), pose: pose.ok ? { x: pose.x, y: pose.y, z: pose.z, h: pose.h } : null } : null; },
    board: board, exit: exit, kick: kick,
    passengers: function () { return mine.map(function (p) { return { id: p[0], seat: p[1], nick: p[2] }; }); }
  };
})(window);
