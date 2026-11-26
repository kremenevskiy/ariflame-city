/* Флейм-Сити — динамика машин поверх fcars: нитро, трюки с цепочкой и множителем (дрифт, впритирку, встречка, полёт,
 * вилли, «на волоске от копа»), трамплины в парках, спецмашины с сиренами (им уступают дорогу), стоп-кадр и искры на
 * авариях, полоска нитро и счётчик комбо.
 *
 * Формулы — разбор «game feel»: впритирку < 1,2 м при относительной > 14 м/с — 100 очков (×2 при < 0,5 м);
 * встречка 50/с; дрифт: угол > 15° и скорость > 11 м/с, очки/с = скорость × угол°/10, конец — 0,5 с при угле < 10°;
 * полёт > 0,5 с — 10 очков за 0,1 с, чистое приземление ×1,5. Цепочка: новый вид трюка +1 к множителю (до ×10), окно
 * 2,5 с, в конце — деньги (очки / 5); авария сжигает непробанкованное. Нитро 3 с: +40% разгона, +20% скорости,
 * заряжается трюками; мини-турбо после дрифта 1/2/3 с → буст 0,62/1,67/2,63 с.
 * На каждый засчитанный трюк — FC.emit("stunt", {kind, score}) (задания дня).
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE, M = FC.map, G = FC.gfx, I = FC.input, C = FC.cars;
  var D2R = Math.PI / 180;

  FC.css([
    ".fc-nitro{position:fixed;left:194px;bottom:calc(26px + env(safe-area-inset-bottom));width:13px;height:128px;border-radius:8px;",
    "background:rgba(10,14,28,.7);border:1px solid rgba(255,207,122,.35);overflow:hidden;display:none;pointer-events:none}",
    ".fc-nitro i{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(0deg,#ff6a00,#ffcf3f 60%,#7fd4ff);transition:height .1s}",
    ".fc-nitro.on i{background:linear-gradient(0deg,#3fa9ff,#c6f1ff);box-shadow:0 0 14px #6cf}",
    ".fc-nitro b{position:absolute;left:-3px;top:-22px;font-size:15px}",
    "body.fc-incar .fc-nitro{display:block}",
    "body.touch .fc-nitro{left:150px;height:100px}",
    ".fc-live{position:fixed;left:50%;top:calc(22% + env(safe-area-inset-top));transform:translateX(-50%);text-align:center;pointer-events:none;",
    "font:800 italic 26px/1.1 Georgia,serif;color:#ffcf7a;text-shadow:0 3px 0 rgba(0,0,0,.55),0 0 18px rgba(255,150,40,.5);opacity:0;transition:opacity .2s}",
    ".fc-live.on{opacity:1}.fc-live small{display:block;font:700 14px system-ui;color:#fff;letter-spacing:.06em;margin-top:3px}",
    ".fc-live .m{color:#7fd4ff}",
    ".fc-pop{position:fixed;left:50%;top:calc(30% + env(safe-area-inset-top));transform:translateX(-50%);pointer-events:none;",
    "font:800 italic 30px Georgia,serif;color:#9dffbf;text-shadow:0 3px 0 rgba(0,0,0,.6);animation:fcpop 1.6s ease forwards;white-space:nowrap}",
    "@keyframes fcpop{0%{opacity:0;transform:translate(-50%,10px) scale(1.4)}15%{opacity:1;transform:translate(-50%,0) scale(1)}80%{opacity:1}100%{opacity:0;transform:translate(-50%,-30px)}}",
    // спидометр: км/ч и имя машины у полоски нитро
    ".fc-speedo{position:fixed;left:214px;bottom:calc(26px + env(safe-area-inset-bottom));pointer-events:none;display:none;",
    "font:800 italic 30px/1 Georgia,serif;color:#fff;text-shadow:0 2px 0 rgba(0,0,0,.6)}",
    ".fc-speedo small{font:700 11px system-ui;letter-spacing:.06em;color:#ffcf7a;margin-left:4px}",
    ".fc-speedo i{display:block;font:600 12px system-ui;color:rgba(255,255,255,.75);margin-top:3px;font-style:normal}",
    "body.fc-incar .fc-speedo{display:block}",
    "body.touch .fc-speedo{left:calc(22px + env(safe-area-inset-left));bottom:calc(152px + env(safe-area-inset-bottom));font-size:24px}",   // над джойстиком — не под дугой кнопок
    "@media (orientation:landscape) and (max-height:540px){body.touch .fc-speedo{left:calc(160px + env(safe-area-inset-left));bottom:calc(16px + env(safe-area-inset-bottom))}}"
  ].join(""));
  var bar = document.createElement("div"); bar.className = "fc-nitro"; bar.innerHTML = "<b>🔥</b><i></i>";
  var live = document.createElement("div"); live.className = "fc-live";
  var speedo = document.createElement("div"); speedo.className = "fc-speedo";
  document.body.appendChild(bar); document.body.appendChild(live); document.body.appendChild(speedo);
  /* Спидометр: разметка «число<small>КМ/Ч</small><i>имя</i>» собирается раз на машину, дальше на каждый км/ч меняется
     только текст числа. Раньше на каждый км/ч (на ходу — почти каждый кадр) — innerHTML целиком (разбор HTML, новые
     узлы) и C.info() (новый объект). Вид тот же. */
  var speedoCar = null, speedoKmh = -1, speedoNum = null;
  function speedoTick(car) {
    var vx = car.vx, vz = car.vz, kmh = Math.round(Math.sqrt(vx * vx + vz * vz) * 3.6);
    if (car !== speedoCar) {
      speedoCar = car; speedoKmh = -1;
      var inf = C.info ? C.info(car.type) : null;
      speedo.innerHTML = "<small>КМ/Ч</small><i>" + (inf ? inf.name : car.spec.name) + "</i>";
      speedoNum = document.createTextNode(""); speedo.insertBefore(speedoNum, speedo.firstChild);
    }
    if (kmh === speedoKmh) return;
    speedoKmh = kmh;
    speedoNum.data = String(kmh);
  }
  // сел — имя, класс и максималка; у каждой машины свой характер (fcarlist.js)
  FC.on("car:enter", function (e) {
    var car = e && e.car, inf = car && C.info ? C.info(car.type) : null;
    if (!inf || !FC.hud || !FC.hud.toast) return;
    FC.hud.toast(inf.icon + " " + inf.name + " · " + inf.cls + " · до " + inf.kmh + " км/ч", "", 2.4);
  });

  var POPS = [];
  function pop(text, opt) {
    opt = opt || {};
    if (FC.hud && FC.hud.popup) { FC.hud.popup(text, opt); return; }
    // каждой надписи — своя строка (раньше все в одной точке и налезали друг на друга); больше трёх — старая уходит
    var slot = 0; while (POPS[slot]) slot++;
    if (slot > 2) { slot = 0; POPS.forEach(function (q) { if (q) q.remove(); }); POPS.length = 0; }
    var e = document.createElement("div"); e.className = "fc-pop"; e.textContent = text;
    e.style.top = "calc(30% + " + (slot * 38) + "px + env(safe-area-inset-top))";
    if (opt.color) e.style.color = opt.color;
    if (opt.big) e.style.fontSize = "40px";
    POPS[slot] = e;
    document.body.appendChild(e); setTimeout(function () { e.remove(); if (POPS[slot] === e) POPS[slot] = null; }, 1700);
  }
  function fx(name) { return FC.fx && FC.fx[name] ? FC.fx[name] : null; }
  function stats() { var s = FC.save.stats; ["bestCombo", "bestAir", "bestDrift", "stuntMoney", "nearMiss"].forEach(function (k) { if (s[k] == null) s[k] = 0; }); return s; }

  /* ---- нитро ------------------------------------------------------------------------------------------------- */
  var N = { tank: 1, on: false, turbo: 0 };
  function runHeld() { return I.held("run") || !!I.runToggle; }
  function releaseToggle() {
    if (!I.runToggle) return;
    I.runToggle = false;
    var b = document.querySelector(".tbtn.b-run"); if (b) b.classList.remove("on");
  }
  C.mod = function (car, inp, dt) {
    var want = runHeld() && (inp.throttle || 0) > 0 && !car.wrecked && !car.air;
    var boosting = false;
    if (N.turbo > 0) N.turbo -= dt;
    var nm = (car.tune && car.tune.nitroMul) || 1;      // гараж: бак дольше и толчок сильнее
    if (N.turbo > 0) boosting = true;
    else if (want && N.tank > 0.01) { N.tank = Math.max(0, N.tank - dt / (3 * nm)); boosting = true; if (N.tank <= 0.01) releaseToggle(); }
    if (boosting && !N.on) {
      N.on = true;
      if (FC.audio) FC.audio.play("whoosh", { vol: 1 });
      if (FC.cam) FC.cam.dist += 0.5;                    // камера отъезжает и пружинит обратно (fmain тянет dist к want)
      if (fx("haptic")) fx("haptic")("medium");
    }
    if (!boosting) N.on = false;
    car.nitro = boosting;
    if (boosting) { inp.boost = 1 + 0.2 * nm; inp.accelK = 1 + 0.4 * nm; inp.throttle = Math.max(inp.throttle || 0, 1); }
    else N.tank = Math.min(1, N.tank + dt / 120);       // заметно — только трюками; совсем пустым бак не остаётся
    // в воздухе машина не рулится и не газует
    if (car.air) { inp.steer = (inp.steer || 0) * 0.15; inp.throttle = 0; inp.hb = false; }
  };
  function charge(v) { N.tank = Math.min(1, N.tank + v); }

  /* ---- цепочка трюков ------------------------------------------------------------------------------------------ */
  var NAMES = { drift: "ДРИФТ", near: "ВПРИТИРКУ", air: "ПОЛЁТ", oncoming: "ВСТРЕЧКА", wheelie: "ВИЛЛИ", cop: "НА ВОЛОСКЕ ОТ КОПА" };
  var ch = { pts: 0, mult: 1, kinds: {}, last: 0, label: "" };
  var cur = { drift: 0, driftT: 0, driftOff: 0, opp: 0, oppT: 0, oppOff: 0, wheel: 0, wheelT: 0 };
  function addKind(kind) {
    if (!ch.kinds[kind]) { ch.kinds[kind] = 1; if (Object.keys(ch.kinds).length > 1) ch.mult = Math.min(10, ch.mult + 1); }
    ch.last = performance.now();
  }
  // трюк засчитан: очки в цепочку, событие для заданий дня
  function trick(kind, score, text) {
    score = Math.round(score);
    if (score <= 0) return;
    addKind(kind);
    ch.pts += score;
    ch.label = text || NAMES[kind];
    FC.emit("stunt", { kind: kind === "cop" ? "near" : kind, score: score });
    pop(ch.label + " +" + score, { color: kind === "cop" ? "#7fd4ff" : "#ffcf7a" });
  }
  function bankChain() {
    if (ch.pts <= 0) { resetChain(); return; }
    var money = Math.round(ch.pts * ch.mult / 5), st = stats();
    FC.money(money, "трюки");
    st.stuntMoney += money;
    var rec = ch.pts * ch.mult > st.bestCombo;
    if (rec) st.bestCombo = ch.pts * ch.mult;
    FC.dirty();
    pop((ch.mult > 1 ? "КОМБО ×" + ch.mult + " · " : "") + (ch.pts * ch.mult) + " очков  +$" + money + (rec ? "  РЕКОРД!" : ""), { color: "#9dffbf", big: money > 150 });
    if (FC.audio) FC.audio.play("cash", { vol: 0.8 });
    resetChain();
  }
  function burnChain() {
    if (ch.pts > 0) pop("СОРВАЛОСЬ · −" + ch.pts * ch.mult, { color: "#ff6b7a" });
    resetChain();
    cur.drift = 0; cur.driftT = 0; cur.opp = 0; cur.oppT = 0; cur.wheel = 0; cur.wheelT = 0;
  }
  function resetChain() { ch.pts = 0; ch.mult = 1; ch.kinds = {}; ch.label = ""; }
  function busy() { return cur.driftT > 0 || cur.oppT > 0 || cur.wheelT > 0 || air.on; }

  /* ---- трамплины: в парках вдоль дорожек-крестов (там нет деревьев) ------------------------------------------ */
  var RAMP_L = 7.5, RAMP_W = 4.6, RAMP_H = 1.7;
  var ramps = [];
  // коридор разгона (40 м до) и приземления (30 м после) свободен от столбов, деревьев, домов и воды
  function clear(x, z, fx, fz) {
    for (var d = -40; d <= 30; d += 2) {
      var px = x + fx * d, pz = z + fz * d;
      if (M.water(px, pz) || M.buildingAt(px, pz, 1.6)) return false;
      var near = M.near(px, pz, 3);
      for (var i = 0; i < near.length; i++) {
        var o = near[i]; if (!o.prop) continue;
        var lat = Math.abs((o.x - px) * fz - (o.z - pz) * fx);
        if (lat < 2.4 + o.r && Math.abs((o.x - px) * fx + (o.z - pz) * fz) < 2.2) return false;
      }
    }
    return true;
  }
  // ставим по событию start: к нему все модули загружены и всё своё на карте расставили (флаги банд — в центрах парков)
  function placeRamps() {
  M.blocks.filter(function (b) { return b.kind === "park" || b.kind === "plaza"; })
    .sort(function (a, b) { return FC.hash("ramp" + a.i) - FC.hash("ramp" + b.i); })
    .forEach(function (b) {
      if (ramps.length >= 12) return;
      var hs = [Math.PI / 2, -Math.PI / 2, 0, Math.PI];
      var start = FC.hash("rs" + b.i) % 4;
      for (var k = 0; k < 4; k++) {
        var h = hs[(start + k) % 4], fx = Math.sin(h), fz = Math.cos(h);
        var x = b.kind === "plaza" ? b.cx + 30 : b.cx, z = b.kind === "plaza" ? b.cz + 30 : b.cz;
        if (clear(x, z, fx, fz)) { ramps.push({ x: x, z: z, h: h, fx: fx, fz: fz }); return; }
      }
    });
    rampMeshes();
  }
  FC.on("start", placeRamps);
  function rampMeshes() {
    var tex = G.tex.canvas(128, 256, function (x, w, hh) {
      x.fillStyle = "#1d1d1f"; x.fillRect(0, 0, w, hh);
      x.fillStyle = "#ffc21a";
      for (var k = -4; k < 12; k++) { x.beginPath(); x.moveTo(0, k * 32); x.lineTo(w, k * 32 - 48); x.lineTo(w, k * 32 - 32); x.lineTo(0, k * 32 + 16); x.fill(); }
    });
    // клин: низ у z = −L/2, верх (высота H) у z = +L/2
    var L = RAMP_L, W = RAMP_W, H = RAMP_H, p = [], uv = [];
    function tri(a, b, c, ua, ub, uc) { p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]); }
    var A = [-W / 2, 0, -L / 2], B = [W / 2, 0, -L / 2], Cc = [W / 2, H, L / 2], D = [-W / 2, H, L / 2], E = [W / 2, 0, L / 2], F = [-W / 2, 0, L / 2];
    tri(A, Cc, B, [0, 0], [1, 1], [1, 0]); tri(A, D, Cc, [0, 0], [0, 1], [1, 1]);       // скат
    tri(B, Cc, E, [0, 0], [0, 0], [0, 0]); tri(F, D, A, [0, 0], [0, 0], [0, 0]);         // бока
    tri(E, Cc, D, [0, 0], [0, 0], [0, 0]); tri(E, D, F, [0, 0], [0, 0], [0, 0]);         // задняя стенка
    var g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(p, 3)); g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    var mat = new T.MeshStandardMaterial({ map: tex, roughness: 0.7, side: T.DoubleSide });
    var im = new T.InstancedMesh(g, mat, Math.max(1, ramps.length)), o = new T.Object3D();
    ramps.forEach(function (r, i) { o.position.set(r.x, 0.18, r.z); o.rotation.set(0, r.h, 0); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
    im.count = ramps.length; im.castShadow = G.Q.shadows; im.receiveShadow = G.Q.shadows;
    FC.build.root.add(im);
  }
  if (FC.hud && FC.hud.addMapLayer) {
    FC.hud.addMapLayer(function (c, k, mode) {
      if (mode === "big" && FC.hud.mapTier(k) < 2) return;      // трамплины — с приближения
      c.fillStyle = "#ffc21a";
      var s = Math.max(4, 7 / k);
      ramps.forEach(function (r) {
        c.save(); c.translate(r.x, r.z); c.rotate(-r.h);
        c.beginPath(); c.moveTo(0, s); c.lineTo(s * 0.8, -s); c.lineTo(-s * 0.8, -s); c.closePath(); c.fill(); c.restore();
      });
    });
  }

  /* ---- полёт: заезд на трамплин поднимает машину, с края — в воздух ------------------------------------------ */
  var air = { on: false, t: 0, x0: 0, z0: 0 };
  function rampTick(car, dt) {
    var onRamp = null, ry = 0;
    if (!car.air) {
      for (var i = 0; i < ramps.length; i++) {
        var r = ramps[i], dx = car.x - r.x, dz = car.z - r.z;
        if (Math.abs(dx) > 9 || Math.abs(dz) > 9) continue;
        var lz = dx * r.fx + dz * r.fz, lx = dx * r.fz - dz * r.fx;
        if (Math.abs(lx) > RAMP_W / 2 + 0.3 || lz < -RAMP_L / 2 || lz > RAMP_L / 2 + 0.6) continue;
        var along = car.vx * r.fx + car.vz * r.fz;
        if (along < 3) continue;
        onRamp = r; ry = RAMP_H * FC.clamp((lz + RAMP_L / 2) / RAMP_L, 0, 1);
        // с края — в воздух: скорость вверх от скорости вдоль трамплина
        if (lz >= RAMP_L / 2 - 0.15 && along > 8) {
          car.air = { vy: along * (RAMP_H / RAMP_L) * 1.25 + 1.5 }; car.y = RAMP_H;
          air.on = true; air.t = 0; air.x0 = car.x; air.z0 = car.z;
          if (FC.audio) FC.audio.play("whoosh", { vol: 0.8 });
          return;
        }
        break;
      }
      car.y = onRamp ? ry : 0;
      car.airPitch = onRamp ? -Math.atan(RAMP_H / RAMP_L) : FC.damp(car.airPitch || 0, 0, 10, dt);
      return;
    }
    // в воздухе
    car.air.vy -= 18 * dt;
    car.y += car.air.vy * dt;
    air.t += dt;
    car.airPitch = FC.clamp(-car.air.vy * 0.035, -0.4, 0.45);
    if (car.y <= 0) {
      var hit = -car.air.vy, clean = Math.abs(car.roll) < 20 * D2R && Math.abs(car.airPitch) < 20 * D2R;
      car.y = 0; car.air = null; air.on = false; car.airPitch = 0.12;
      if (FC.cam) FC.cam.shake(Math.min(0.5, hit / 30));
      if (fx("burst")) fx("burst")(car.x, 0.3, car.z, "dust", 18);
      if (hit > 11) C.damage(car, (hit - 11) * 2 * car.spec.armor);
      if (air.t > 0.5) {
        var dist = Math.hypot(car.x - air.x0, car.z - air.z0), sc = air.t * 100 * (clean ? 1.5 : 1), st = stats();
        if (air.t > st.bestAir) { st.bestAir = +air.t.toFixed(2); FC.dirty(); }
        trick("air", sc, "ПОЛЁТ " + air.t.toFixed(1) + " с · " + Math.round(dist) + " м" + (clean ? " · ЧИСТО" : ""));
        charge(0.25);
      }
      if (FC.audio) FC.audio.play("thud", { vol: Math.min(1, hit / 12) });
      if (fx("haptic")) fx("haptic")(hit > 9 ? "heavy" : "medium");
    }
  }

  /* ---- трюки за кадр -------------------------------------------------------------------------------------------- */
  var nearLane = null, laneT = 0;
  function stuntTick(car, dt) {
    var spd = Math.hypot(car.vx, car.vz), now = performance.now();
    var fwx = Math.sin(car.heading), fwz = Math.cos(car.heading);
    // дрифт
    var angDeg = Math.abs(car.slip || 0) / D2R;
    if (!car.air && spd > 11 && angDeg > 15) {
      cur.driftT += dt; cur.driftOff = 0;
      cur.drift += spd * Math.min(angDeg, 70) / 10 * dt;
      addKind("drift"); charge(dt * 0.07);
    } else if (cur.driftT > 0) {
      cur.driftOff += dt;
      if ((angDeg < 10 && cur.driftOff > 0.5) || cur.driftOff > 1.2) {
        var dT = cur.driftT, st = stats();
        if (cur.drift > st.bestDrift) { st.bestDrift = Math.round(cur.drift); FC.dirty(); }
        if (dT > 0.6 && cur.drift >= 20) trick("drift", cur.drift, "ДРИФТ " + dT.toFixed(1) + " с");
        // мини-турбо после дрифта
        N.turbo = dT >= 3 ? 2.63 : dT >= 2 ? 1.67 : dT >= 1 ? 0.62 : 0;
        if (N.turbo) pop("ТУРБО " + N.turbo.toFixed(1) + " с", { color: "#7fd4ff" });
        cur.drift = 0; cur.driftT = 0;
      }
    }
    // встречка: ближайшая полоса направлена против нас
    laneT -= dt;
    if (laneT <= 0) { laneT = 0.15; nearLane = M.onRoad(car.x, car.z) ? M.nearestLane(car.x, car.z) : null; }
    var against = nearLane && Math.hypot(nearLane.x - car.x, nearLane.z - car.z) < 2.6 && spd > 14 &&
      (car.vx * nearLane.dx + car.vz * nearLane.dz) < -0.6 * spd;
    if (against && !car.air) { cur.oppT += dt; cur.opp += 50 * dt; cur.oppOff = 0; addKind("oncoming"); charge(dt * 0.05); }
    else if (cur.oppT > 0) {
      cur.oppOff += dt;
      if (cur.oppOff > 0.5) { if (cur.oppT > 0.8) trick("oncoming", cur.opp, "ВСТРЕЧКА " + cur.oppT.toFixed(1) + " с"); cur.opp = 0; cur.oppT = 0; }
    }
    // вилли (мотоцикл)
    if (car.spec.moto && (car.wheelie || 0) > 0.3 && spd > 4) { cur.wheelT += dt; cur.wheel += 40 * dt; addKind("wheelie"); }
    else if (cur.wheelT > 0) { if (cur.wheelT > 1) trick("wheelie", cur.wheel, "ВИЛЛИ " + cur.wheelT.toFixed(1) + " с"); cur.wheel = 0; cur.wheelT = 0; }
    // впритирку
    if (spd > 12) {
      var list = C.list, wanted = FC.police && FC.police.stars > 0;
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (o === car || o.dead || o.wrecked) continue;
        var dx = o.x - car.x, dz = o.z - car.z;
        if (Math.abs(dx) > 12 || Math.abs(dz) > 12) continue;
        if (now - (o.nearAt || 0) < 3000) continue;
        var lz = dx * fwx + dz * fwz, lx = Math.abs(dx * fwz - dz * fwx);
        if (Math.abs(lz) > (car.spec.L + o.spec.L) / 2 * 0.8) continue;
        var gap = lx - (car.spec.W + o.spec.W) / 2;
        var rel = Math.hypot(car.vx - o.vx, car.vz - o.vz);
        if (gap > 0.05 && gap < 1.2 && rel > 14) {
          o.nearAt = now;
          var cop = o.police && wanted;
          var sc = (gap < 0.5 ? 200 : 100) * (cop ? 2 : 1);
          stats().nearMiss++;
          trick(cop ? "cop" : "near", sc, cop ? NAMES.cop : gap < 0.5 ? "ВПРИТИРКУ ×2" : NAMES.near);
          charge(0.12);
          if (fx("haptic")) fx("haptic")("light");
        }
      }
    }
    // окно цепочки: 2,5 с без трюков — в банк
    if (ch.pts > 0 && !busy() && now - ch.last > 2500) bankChain();
    // живой счётчик
    var liveTxt = "";
    if (cur.driftT > 0.3) liveTxt = "ДРИФТ " + Math.round(cur.drift);
    else if (cur.oppT > 0.3) liveTxt = "ВСТРЕЧКА " + Math.round(cur.opp);
    else if (cur.wheelT > 0.3) liveTxt = "ВИЛЛИ " + Math.round(cur.wheel);
    else if (air.on && air.t > 0.3) liveTxt = "ПОЛЁТ " + air.t.toFixed(1) + " с";
    if (liveTxt || ch.pts > 0) {
      live.innerHTML = (liveTxt || ch.label) + (ch.pts > 0 ? "<small>цепочка " + ch.pts + " · <span class='m'>×" + ch.mult + "</span></small>" : "");
      live.classList.add("on");
    } else live.classList.remove("on");
  }

  /* ---- аварии: стоп-кадр, искры, обломки; авария сжигает цепочку --------------------------------------------- */
  FC.on("car:crash", function (ev) {
    var car = ev.car, p = ev.power;
    if (!car || car.driver !== "player") return;
    if (p > 3 && fx("burst")) fx("burst")(car.x, 0.8, car.z, "sparks", Math.min(40, Math.round(p * 2)));
    if (p > 14 && fx("burst")) fx("burst")(car.x, 1, car.z, "debris", Math.min(24, Math.round(p)));
    if (p > 20 && fx("hitstop")) fx("hitstop")(0.6, 0.3);          // большая авария — замедление
    else if (p > 14 && fx("hitstop")) fx("hitstop")(0.12, 0.02);   // тяжёлый стоп-кадр
    else if (p > 8 && fx("hitstop")) fx("hitstop")(0.06, 0.05);    // лёгкий
    if (p > 8) burnChain();
  });
  FC.on("car:explode", function (ev) {
    if (ev.car && fx("burst")) { fx("burst")(ev.car.x, 1, ev.car.z, "flame", 30); fx("burst")(ev.car.x, 1, ev.car.z, "debris", 26); }
    if (fx("flash")) fx("flash")("#ffb347", 0.6);
    if (FC.cam) FC.cam.shake(0.8);
  });
  FC.on("car:exit", function () { cur.drift = 0; cur.driftT = 0; cur.opp = 0; cur.oppT = 0; if (ch.pts > 0) bankChain(); N.on = false; N.turbo = 0; air.on = false; });

  /* ---- спецмашины: скорая и пожарная с сиренами раз в 1–2 минуты; машины впереди прижимаются вправо ---------- */
  var emT = 40 + Math.random() * 40;
  function spawnEmergency() {
    var P = FC.player;
    for (var tries = 0; tries < 8; tries++) {
      var a = Math.random() * Math.PI * 2, r = 120 + Math.random() * 50;
      var node = M.nodes[M.nearestNode(P.x + Math.cos(a) * r, P.z + Math.sin(a) * r)];
      var e = M.edges[node.edges[Math.floor(Math.random() * node.edges.length)]];
      if (e.kind === "st" || e.bridge) continue;
      var from = e.oneway || Math.random() < 0.5 ? e.a : e.b, t = 0.2 + Math.random() * 0.5, lp = M.lanePoint(e, from, 0, t);
      if (Math.hypot(lp.x - P.x, lp.z - P.z) < 100) continue;
      var type = Math.random() < 0.65 ? "ambulance" : "fire";
      var car = C.spawn(type, lp.x, lp.z, Math.atan2(lp.dx, lp.dz), { driver: "ai", siren: true, color: type === "fire" ? 0xc1121f : 0xf4f4f4 });
      car.ai = C._lane(e.i, from, 0, t * e.len, { emergency: true });
      car.v = 14;
      return car;
    }
    return null;
  }
  function yieldTick() {
    var list = C.list;
    for (var i = 0; i < list.length; i++) {
      var em = list[i];
      if (!em.siren || em.dead || em.wrecked || !em.ai || em.ai.mode !== "lane") continue;
      var fx2 = Math.sin(em.heading), fz2 = Math.cos(em.heading);
      for (var j = 0; j < list.length; j++) {
        var o = list[j];
        if (o === em || !o.ai || o.ai.mode !== "lane" || o.siren) continue;
        var dx = o.x - em.x, dz = o.z - em.z, f = dx * fx2 + dz * fz2;
        if (f < 0 || f > 45 || Math.abs(dx * fz2 - dz * fx2) > 4) continue;
        if (Math.sin(o.heading) * fx2 + Math.cos(o.heading) * fz2 < 0.6) continue;
        o.ai.yieldT = 1.6;
      }
    }
  }

  /* ---- кадр ------------------------------------------------------------------------------------------------------- */
  var yT = 0, inCarCls = null, barH = -1, barOn = null;
  FC.addSystem({
    name: "cars2", order: 21,
    update: function (dt) {
      var P = FC.player; if (!P || !FC.started) return;
      var car = P.mode === "car" ? P.car : null;
      // DOM — только при изменении (класс body и высота шкалы нитро писались каждый кадр)
      if (inCarCls !== !!car) { inCarCls = !!car; document.body.classList.toggle("fc-incar", inCarCls); }
      if (car) {
        rampTick(car, dt);
        stuntTick(car, dt);
        var tankH = Math.round(N.tank * 100);
        if (tankH !== barH) { barH = tankH; bar.firstChild.nextSibling.style.height = tankH + "%"; }
        speedoTick(car);
        if (barOn !== !!N.on) { barOn = !!N.on; bar.classList.toggle("on", barOn); }
        var spd = Math.sqrt(car.vx * car.vx + car.vz * car.vz);
        if (fx("speed")) fx("speed")(N.on ? 1 : FC.clamp((spd - 24) / 30, 0, 0.6));
        // пламя из выхлопа на нитро
        if (N.on) {
          var fwx = Math.sin(car.heading), fwz = Math.cos(car.heading), ex = car.x - fwx * (car.spec.L / 2 + 0.2), ez = car.z - fwz * (car.spec.L / 2 + 0.2);
          for (var k = 0; k < 2; k++) {
            C._fx.emit(C._fx.FIRE, ex, 0.45 + (car.y || 0), ez, -fwx * 6 + car.vx * 0.6 + (Math.random() - 0.5), 0.3, -fwz * 6 + car.vz * 0.6 + (Math.random() - 0.5),
              0.25, 0.7, 0.2, 0.9, k ? 0.45 : 1, k ? 0.7 : 0.55, k ? 1 : 0.15);
          }
        }
      } else {
        live.classList.remove("on");
        if (fx("speed")) fx("speed")(0);
      }
      // машины, оставшиеся в воздухе без игрока, — на землю (циклом, а не forEach с новой функцией на каждый кадр)
      for (var li = 0, cl = C.list; li < cl.length; li++) {
        var c = cl[li];
        if (c !== car && (c.y || c.air)) { c.y = Math.max(0, (c.y || 0) - dt * 6); if (!c.y) { c.air = null; c.airPitch = 0; } }
      }
      // спецмашины
      emT -= dt;
      if (emT <= 0) {
        emT = 70 + Math.random() * 50;
        var alive = C.list.some(function (c) { return c.spec.emergency && !c.dead; });
        if (!alive && !(FC.inside && FC.inside.active)) spawnEmergency();
      }
      yT -= dt; if (yT <= 0) { yT = 0.25; yieldTick(); }
    }
  });

  C.nitro = N; C.ramps = ramps; C.chain = ch; C.spawnEmergency = spawnEmergency;
})(window);
