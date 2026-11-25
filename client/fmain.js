/* Флейм-Сити — вход и цикл: игрок пешком (ходьба, бег, прыжок, удар, столкновения, крыши), камера третьего лица
 * (обзор мышью/пальцем, столкновение со зданиями, тряска, расширение поля зрения на скорости), двери зданий,
 * смерть и арест (респаун в больнице или участке), запуск всех систем по порядку.
 *
 * Крыши: земля под ногами — самая высокая поверхность не выше ног + ступенька (FC.map.roofAt: крыша дома или улица);
 * стена — только дом выше ног (FC.map.collide с opt.y). С улицы на крышу не зайти; с крыши шагнул за край — падаешь,
 * с высоты больше 6 м — ушиб (P.damage). На крыше — «Сесть» в вертолёт рядом и люк «Спуститься» на верхний этаж.
 *
 * FC.player: {x, y, z, heading, mode: foot|car|inside, car, hp, ch (спрайт), busy, roof (на крыше или высоко над
 *   улицей — уличные действия скрыты), teleport(x, z), respawn(где)}
 * FC.cam: {yaw, pitch, dist, shake(сила)} — машина (fcars) ставит mode="car" и двигает игрока сама.
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE, M = FC.map, G = FC.gfx, I = FC.input;

  I.bindCanvas(G.renderer.domElement);

  /* ---- игрок ------------------------------------------------------------------------------------------------ */
  var start = M.plaza;
  var P = {
    x: (start.x0 + start.x1) / 2 + 22, y: 0.2, z: (start.z0 + start.z1) / 2 + 18, vx: 0, vz: 0, vy: 0, heading: Math.PI,
    mode: "foot", car: null, hp: 250, maxHp: 250, busy: false, onGround: true, punchT: 0, ground: 0.2, lastHit: 0
  };
  P.ch = FC.people.make("player", FC.people.SPECIAL.civ, P.x, P.z, { scale: 1.9, alpha: 1 });
  // перемещение через карту в Минске: пока вокруг достраиваются кварталы, экран коротко гаснет — вместо мелькания
  // пустого поля и рывков первых кадров (fosm строит куски по очереди)
  var veil = document.createElement("div"); veil.id = "tp-veil"; veil.innerHTML = "<span>Строим район…</span>";
  var vst = document.createElement("style");
  vst.textContent = "#tp-veil{position:fixed;inset:0;background:#0b0f16;opacity:0;pointer-events:none;transition:opacity .25s;z-index:14;display:flex;align-items:center;justify-content:center}" +
    "#tp-veil.on{opacity:1}#tp-veil span{font:600 15px system-ui;color:rgba(255,255,255,.75);letter-spacing:.04em}";
  document.head.appendChild(vst); document.body.appendChild(veil);
  var veilT = -1;
  FC.addSystem({ name: "tpveil", order: 99, update: function (dt) {
    if (veilT < 0) return;
    veilT += dt;
    if (veilT > 0.4 && (!FC.osm || !FC.osm.busy || !FC.osm.busy() || veilT > 2.5)) { veil.classList.remove("on"); veilT = -1; }
  } });
  // после старта и дальнего перемещения 3 с город заполняется и рядом (машины, люди) — экран в это время закрыт
  FC.fillUntil = 0;
  P.teleport = function (x, z, heading) {
    if (Math.hypot(x - P.x, z - P.z) > 150) FC.fillUntil = performance.now() + 3000;
    if (FC.started && FC.osm && Math.hypot(x - P.x, z - P.z) > 150) { veil.classList.add("on"); veilT = 0; }
    var c = M.collide(x, z, 0.4);
    P.x = c.x; P.z = c.z; P.vx = P.vz = P.vy = 0; P.y = 0.2; fallFrom = null;   // перенос — не падение (без ушиба)
    if (heading != null) { P.heading = heading; cam.yaw = heading + Math.PI; }   // камера — за спиной (было «в лицо»)
    cam.snap = true;
  };
  P.setCreature = function (code) { var c = FC.people.cellOf(code); P.ch.cell = c >= 0 ? c : FC.people.SPECIAL.civ; };
  P.damage = function (n, why) {
    if (P.dead || (P.invuln > 0 && why !== "busted")) return;
    P.hp = Math.max(0, P.hp - n);
    P.lastHit = performance.now();
    document.body.classList.add("hurt"); setTimeout(function () { document.body.classList.remove("hurt"); }, 220);
    if (P.hp <= 0) P.die(why || "hurt");
  };
  P.heal = function (n) { P.hp = Math.min(P.maxHp, P.hp + n); };   // задача: «больше жизни» — максимум 250
  /* Вырубился → больница; задержан → участок. Деньги теряются частью — как в GTA, но мягче. */
  P.die = function (why) {
    if (P.dead) return;
    P.dead = true;
    var busted = why === "busted";
    FC.emit(busted ? "busted" : "wasted", {});
    if (P.mode === "car" && FC.cars) FC.cars.exit(true);
    if (FC.inside && FC.inside.active) FC.inside.exit(true);
    var fee = busted ? Math.min(FC.save.money, Math.max(100, Math.round(FC.save.money * 0.1))) : Math.min(FC.save.money, 200);
    document.body.classList.add(busted ? "busted" : "wasted");
    FC.hud.big(busted ? "ЗАДЕРЖАН" : "ВЫРУБИЛСЯ", busted ? "Штраф и ночь в участке" : "Очнулся в больнице", busted ? "#6bd5ff" : "#ff5d6c", 3.5);
    FC.clock.speed = 15;
    setTimeout(function () {
      FC.clock.speed = 60;
      document.body.classList.remove("busted", "wasted");
      if (fee) FC.money(-fee, busted ? "штраф" : "больница");
      FC.save.stats[busted ? "busted" : "wasted"]++;
      if (FC.police) FC.police.clear();
      P.respawn(busted ? "police" : "hospital");
      P.hp = P.maxHp; P.dead = false;
      FC.hud.toast(busted ? "−" + FC.fmtMoney(fee) + " штраф" : "−" + FC.fmtMoney(fee) + " за лечение", "bad", 3);
    }, 3500);
  };
  P.respawn = function (where) {
    var B = where === "home" ? (FC.me && FC.me.home) : M.poi(where === "police" ? "police" : "hospital", P.x, P.z);
    if (!B) B = M.hq;
    var d = B.doors[0];
    P.teleport(d.x + d.nx * 3, d.z + d.nz * 3, Math.atan2(d.nx, d.nz));
  };
  P.punch = function () { if (P.punchT <= 0 && P.mode === "foot" && !P.dead) punch(); };   // «Дать в нос» из разговора (ftalk)
  FC.player = P;

  /* ---- камера ------------------------------------------------------------------------------------------------ */
  // на узком (вертикальном) экране камера дальше — иначе герой занимает полэкрана
  var narrow = global.innerWidth < global.innerHeight;
  // повернули телефон — камера подстраивается: вертикально дальше и шире обзор, горизонтально — ближе (23.11)
  global.addEventListener("resize", function () {
    var n = global.innerWidth < global.innerHeight; if (n === narrow) return;
    narrow = n; cam.want = FC.clamp(cam.want + (n ? 2.5 : -2.5), 3.5, 16);
  });
  var cam = { yaw: Math.PI, pitch: 0.32, dist: narrow ? 9.5 : 7, want: narrow ? 9.5 : 7, shakeA: 0, fov: 62, snap: true, idle: 0 };
  // вертикальный угол, при котором горизонтальный обзор не шире 95°: ПК 16:9 — те же 62°, телефон лёжа (19.5:9) — ~53°
  var H95 = Math.tan(95 / 2 * Math.PI / 180);
  function baseFov() {
    if (narrow) return 76;
    var a = G.camera.aspect || 1.6;
    return Math.min(62, 2 * Math.atan(H95 / a) * 180 / Math.PI);
  }
  cam.shake = function (a) { cam.shakeA = Math.min(1.2, cam.shakeA + a); };
  FC.cam = cam;
  FC.on("input:zoom", function (d) { cam.want = FC.clamp(cam.want + d * 1.2, 3.5, 16); });
  var camPos = new T.Vector3(), look = new T.Vector3(), tmp = new T.Vector3();
  function blocked(x, y, z) {
    if (P.y > 2 && M.roofAt) {
      // игрок наверху (крыша): мешают крыши как они есть — скаты, ступени башни, части дома ниже B.h; запас 0,4 м от стен
      var r = Math.max(M.roofAt(x, z, 1e9), M.roofAt(x + 0.4, z, 1e9), M.roofAt(x - 0.4, z, 1e9), M.roofAt(x, z + 0.4, 1e9), M.roofAt(x, z - 0.4, 1e9));
      return r > -1e8 && y < r + 0.8;
    }
    var B = M.buildingAt(x, z, 0.4);
    return B && y < B.h + 1;
  }
  function updateCamera(dt) {
    var L = I.takeLook();
    var sens = I.touch ? 0.0042 : 0.0026;
    if (L.x || L.y) cam.idle = 0; else cam.idle += dt;
    cam.yaw -= L.x * sens;
    cam.pitch = FC.clamp(cam.pitch + L.y * sens, -0.15, 1.2);
    if (I.pressed("cam")) cam.want = cam.want > 9 ? 5 : cam.want + 4;
    var car = P.mode === "car" && P.car;
    var focusH = 1.5, want = cam.want;
    if (car) {
      want = car.spec.camDist || 9; focusH = car.spec.camH || 1.6;
      // за машиной, если игрок не крутит обзор сам 1,2 с; при дрифте — по скорости, а не по носу
      if (cam.idle > 1.2) {
        var sp = Math.hypot(car.vx, car.vz);
        var dirYaw = sp > 5 ? Math.atan2(-car.vx, -car.vz) : car.heading + Math.PI;
        cam.yaw = FC.angDamp(cam.yaw, dirYaw, 4.2, dt);       // dirYaw уже «за машиной» (fcars оборачивает камеру так же)
        cam.pitch = FC.damp(cam.pitch, 0.22, 2, dt);
      }
    } else if (FC.inside && FC.inside.active) {
      // внутри: ближе и сверху — над перегородками тесных квартир, а не из-за стены
      want = Math.min(want, 4.6);
      if (cam.pitch < 0.62) cam.pitch = FC.damp(cam.pitch, 0.62, 4, dt);
    }
    else if (I.touch && cam.idle > 0.7 && Math.hypot(P.vx, P.vz) > 1.5) {
      // телефон: пока палец не крутит обзор, камера сама плавно заходит за спину — как в мобильных GTA
      cam.yaw = FC.angDamp(cam.yaw, P.heading + Math.PI, 1.6, dt);
    }
    cam.dist = FC.damp(cam.dist, want, 4, dt);
    // поле зрения шире на скорости
    var speed = car ? Math.hypot(car.vx, car.vz) : Math.hypot(P.vx, P.vz);
    var vmax = car ? car.spec.vmax : 9;
    var fov = baseFov() + (car ? 16 : 10) * Math.pow(Math.min(speed / vmax, 1), 2);
    if (!car && speed > 6.5) want += 0.6;                    // спринт: камера чуть отъезжает — скорость читается сильнее
    cam.fov = FC.damp(cam.fov, fov, 3, dt);
    if (Math.abs(G.camera.fov - cam.fov) > 0.05) { G.camera.fov = cam.fov; G.camera.updateProjectionMatrix(); }
    var fx = P.x, fy = (P.y || 0) + focusH, fz = P.z;
    look.set(fx, fy, fz);
    var cp = Math.cos(cam.pitch), d = cam.dist;
    var tx = fx + Math.sin(cam.yaw) * cp * d, tz = fz + Math.cos(cam.yaw) * cp * d, ty = fy + Math.sin(cam.pitch) * d + 0.6;
    // столкновение камеры со зданиями: ближе к игроку, пока луч не свободен
    if (!(FC.inside && FC.inside.active)) {
      for (var k = 1; k <= 12; k++) {
        var f = k / 12, sx = fx + (tx - fx) * f, sy = fy + (ty - fy) * f, sz = fz + (tz - fz) * f;
        if (blocked(sx, sy, sz)) { var f2 = Math.max(0.15, f - 0.12); tx = fx + (tx - fx) * f2; ty = fy + (ty - fy) * f2 + 0.4; tz = fz + (tz - fz) * f2; break; }
      }
    } else if (FC.inside.clampCam) {
      var cc = FC.inside.clampCam(fx, fy, fz, tx, ty, tz); tx = cc.x; ty = cc.y; tz = cc.z;
    }
    ty = Math.max(ty, (FC.inside && FC.inside.active ? FC.inside.floorY() : 0) + 0.6);
    tmp.set(tx, ty, tz);
    if (cam.snap) { camPos.copy(tmp); cam.snap = false; } else camPos.lerp(tmp, 1 - Math.exp(-(car ? 9 : 14) * dt));
    G.camera.position.copy(camPos);
    if (cam.shakeA > 0.001) {
      var a = cam.shakeA * cam.shakeA * 0.5, t = performance.now() / 1000;
      G.camera.position.x += Math.sin(t * 61) * a; G.camera.position.y += Math.sin(t * 47 + 1) * a; G.camera.position.z += Math.sin(t * 53 + 2) * a;
      cam.shakeA = Math.max(0, cam.shakeA - dt * 1.6);
    }
    if (intro && introStep(dt, L)) return;
    G.camera.lookAt(look);
    G.focus = look;
  }
  /* Пролёт на старте (ресёрч «первые 5 секунд», 23.11): камера с высоты над районом опускается за спину героя за 2,6 с —
     человек сразу видит, где он (ориентир, улицы, люди), а не асфальт под ногами. Любое движение или поворот обзора —
     сразу в игру. Вернувшимся без нового района — без пролёта. */
  var intro = null, introLook = new T.Vector3();
  function startIntro() {
    if (global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches) return;   // просят меньше движения — без пролёта
    intro = { t: 0, dur: 2.6, from: null, fromLook: null };
  }
  function introStep(dt, L) {
    intro.t += dt;
    if (Math.hypot(P.vx, P.vz) > 0.5 || L.x || L.y) intro.t = Math.max(intro.t, intro.dur - 0.3);
    if (!intro.from) {
      var sx = Math.sin(cam.yaw), sz = Math.cos(cam.yaw);
      intro.from = new T.Vector3(P.x + sx * 90, 62, P.z + sz * 90);
      intro.fromLook = new T.Vector3(P.x - sx * 70, 8, P.z - sz * 70);
    }
    var u = Math.min(1, intro.t / intro.dur), k = u * u * (3 - 2 * u);
    G.camera.position.lerpVectors(intro.from, camPos, k);
    introLook.lerpVectors(intro.fromLook, look, k);
    G.camera.lookAt(introLook);
    G.focus = look;
    if (u >= 1) intro = null;
    return true;
  }

  /* ---- пешком ----------------------------------------------------------------------------------------------- */
  /* Пешком — по-аркадному (задача: «персонажи медленные, не хватает динамики»): бег по умолчанию
     5,6 м/с, спринт 9 м/с (Shift / 🏃 / джойстик до упора) с линиями скорости; разгон ~0,12 с, торможение ~0,15 с;
     прыжок с «запасом» 0,12 с после края и буфером нажатия 0,12 с, приземление сплющивает фигурку и поднимает пыль;
     кувырок (V / Ctrl / ⤾ на тач) — 5 м за 0,4 с, неуязвимость, перезарядка 0,7 с. */
  var JOG = 5.6, SPRINT = 9.0, WALK_IN = 4.2;
  var coyote = 0, jumpBuf = 0, roll = 0, rollCd = 0, rollDir = { x: 0, z: 0 }, stepT = 0, airT = 0;
  // крыши: ступенька (выше — стена), откуда падаем (высота последней опоры на улице или крыше; null — не считаем ушиб)
  var STEP = 0.5, fallFrom = null, gRoof = false;
  var colOpt = { prev: P, water: false, y: 0 };                    // один объект на кадр — без выделений памяти
  function updateFoot(dt) {
    if (P.dead) { P.vx = P.vz = 0; return; }
    var mx = I.mx, mz = I.mz;
    var s = Math.sin(cam.yaw), c = Math.cos(cam.yaw);
    var wx = -s * mz + c * mx, wz = -c * mz - s * mx;
    var m = Math.hypot(wx, wz);
    var inside = FC.inside && FC.inside.active;
    // вода (23.11: «в воде плавать»): заходишь — плывёшь по грудь в воде, медленнее, без прыжка и кувырка
    var swim = !inside && P.y < 2 && M.water(P.x, P.z) && !M.onRoad(P.x, P.z);   // на крыше над водой — не плывёт
    if (swim !== !!P.swim) {
      P.swim = swim; if (P.ch) P.ch.swim = swim;
      if (FC.fx && FC.fx.burst) FC.fx.burst(P.x, 0.05, P.z, "water", swim ? 22 : 8);
      if (swim && FC.audio) FC.audio.play("splash");
    }
    var top = inside ? (I.run ? 6 : WALK_IN) : swim ? (I.run ? 3.4 : 2.4) : (I.run ? SPRINT : JOG);
    top *= P.speedMul || 1;
    // джойстик: скорость не линейна наклону — уже на трети хода почти бег (на телефоне палец редко держат до упора,
    // и «персонаж плетётся»), до упора — спринт (finput)
    var sp = top * (m < 0.05 ? 0 : Math.min(1, 0.45 + 0.75 * m));
    var tvx = m > 0.01 ? wx / m * sp : 0, tvz = m > 0.01 ? wz / m * sp : 0;
    rollCd -= dt;
    if ((I.pressed("roll")) && roll <= 0 && rollCd <= 0 && P.onGround && !swim) {
      roll = 0.4; rollCd = 0.75; P.invuln = 0.4;
      if (FC.humans) FC.humans.play(P.ch, "roll", { rate: 2.6, prio: 2 });
      var hx = m > 0.05 ? wx / m : Math.sin(P.heading), hz = m > 0.05 ? wz / m : Math.cos(P.heading);
      rollDir.x = hx; rollDir.z = hz;
      if (FC.audio) FC.audio.play("whoosh");
      if (FC.fx) FC.fx.burst(P.x, 0.2, P.z, "dust", 8);
    }
    if (roll > 0) {
      roll -= dt; P.invuln = Math.max(0, roll);
      tvx = rollDir.x * 12.5; tvz = rollDir.z * 12.5;
      P.vx = tvx; P.vz = tvz;
      P.ch.tilt = (1 - roll / 0.4) * Math.PI * 2 * -P.ch.face; P.ch.lean = P.ch.tilt;
      if (roll <= 0) { P.ch.lean = 0; P.ch.tilt = 0; }
    } else {
      var acc = P.onGround ? (m > 0.05 ? 22 : 16) : 5.5;
      P.vx = FC.damp(P.vx, tvx, acc, dt); P.vz = FC.damp(P.vz, tvz, acc, dt);
    }
    if (m > 0.05) P.heading = FC.angDamp(P.heading, Math.atan2(wx, wz), 16, dt);
    // прыжок: запас времени после края и буфер нажатия
    coyote = P.onGround ? 0.12 : coyote - dt;
    jumpBuf = I.pressed("jump") ? 0.12 : jumpBuf - dt;
    if (jumpBuf > 0 && coyote > 0 && !swim) {
      P.vy = 7.4; P.onGround = false; coyote = 0; jumpBuf = 0;
      if (FC.audio) FC.audio.play("jump");
    }
    P.vy -= (P.vy > 0 && I.held("jump") ? 19 : 28) * dt;          // держишь — выше, отпустил — короче
    if (P.vy < -45) P.vy = -45;                                     // предельная скорость падения (с крыши высотки)
    var y0 = P.y;
    P.y += P.vy * dt;
    var gy = groundY(P.x, P.z, y0);                                 // по высоте до шага: крышу не «проскочить» за кадр
    P.roof = !inside && (gRoof || P.y > gy + 2);
    if (!P.onGround) airT += dt;
    if (P.y <= gy) {
      if (!P.onGround && airT > 0.25) {                               // приземление: сплющиться, пыль, тряска
        P.ch.land = Math.min(0.35, airT * 0.4);
        if (FC.fx) FC.fx.burst(P.x, gy + 0.1, P.z, "dust", 10);
        cam.shake(Math.min(0.25, airT * 0.2));
        if (FC.fx) FC.fx.haptic("light");
        fallHurt(gy, inside);
      }
      P.y = gy; P.vy = 0; P.onGround = true; airT = 0;
    } else if (P.onGround && gRoof && P.vy <= 0 && P.y - gy < 0.4) { P.y = gy; P.vy = 0; }   // вниз по скату — не подпрыгивая
    else if (P.onGround && P.y > gy + 1.5) P.onGround = false;       // шагнул с края крыши — падаешь (прыжок ещё 0,12 с)
    if (P.onGround) fallFrom = inside ? null : gy;
    if (P.ch.land) P.ch.land = Math.max(0, P.ch.land - dt * 1.6);
    var nx = P.x + P.vx * dt, nz = P.z + P.vz * dt;
    colOpt.y = P.y;                                                  // стена — только дом выше ног (на крыше свой дом не держит)
    var col = inside ? FC.inside.collide(nx, nz, 0.35) : M.collide(nx, nz, 0.35, colOpt);
    P.x = col.x; P.z = col.z;
    // машины выталкивают на улице; на крыше и в полёте над ними — нет (иначе столкнёт с края)
    if (FC.cars && FC.cars.pushOut && P.y < 2.5) { var po = FC.cars.pushOut(P.x, P.z, 0.4); if (po) { P.x = po.x; P.z = po.z; } }
    // спринт: линии скорости, шире обзор (в updateCamera), пыль из-под ног
    var v = Math.hypot(P.vx, P.vz);
    if (FC.fx && v > JOG + 1 && !inside) FC.fx.speed((v - JOG) / (SPRINT - JOG) * 0.45);
    stepT -= dt * v;
    if (swim && stepT <= 0 && v > 0.5) { stepT = 1.6; if (FC.fx && FC.fx.burst) FC.fx.burst(P.x, 0.05, P.z, "water", 3); }
    else if (stepT <= 0 && P.onGround && v > 1) {
      stepT = 2.2;
      if (FC.audio) FC.audio.play("step", { vol: Math.min(1, v / 6) });
      if (FC.fx && v > JOG + 1 && !inside) FC.fx.burst(P.x, 0.18, P.z, "dust", 2);
    }
    P.punchT -= dt;
    if (I.pressed("punch") && P.punchT <= 0) punch();
  }
  // y — высота ног (без неё — улица, как раньше): крыша под ногами не выше ног + ступенька; с улицы её не достать
  function groundY(x, z, y) {
    gRoof = false;
    if (FC.inside && FC.inside.active) return FC.inside.floorY();
    if (y > 1 && M.roofAt) { var r = M.roofAt(x, z, y + STEP); if (r > 0.5) { gRoof = true; return r; } }
    if (M.onRoad(x, z)) return 0.04;
    if (M.water(x, z)) return -1.05;                               // плывёт: над водой голова и плечи
    var sf = FC.places && FC.places.surfaceAt ? FC.places.surfaceAt(x, z) : null;
    if (sf != null) return sf;                                     // мощение бульвара мест — 0,25 м
    if (z > M.BEACH_Z0 && z < M.SEA_LINE) return 0.06;
    return 0.16;
  }
  /* Ушиб от падения: считаем от опоры, с которой шагнул или прыгнул (улица/крыша), до места приземления. До 6 м
     (два этажа) — без вреда, дальше — 5 за метр: с 9-этажки — половина здоровья, с высотки — больница. В воду — мягко;
     кувырок в момент касания (неуязвимость) спасает. Внутри здания и после переноса — не считаем. */
  function fallHurt(gy, inside) {
    var drop = fallFrom == null || inside || gy < -0.5 ? 0 : fallFrom - gy;
    if (drop < 6) return;
    P.damage(Math.round((drop - 6) * 5), "fall");
    cam.shake(Math.min(1, 0.35 + drop * 0.015));
    if (FC.fx) FC.fx.haptic("heavy");
    if (FC.audio) FC.audio.play("thud");
  }
  var punchN = 0;
  function punch() {
    P.punchT = 0.45;
    P.ch.lean = -0.35 * P.ch.face; setTimeout(function () { P.ch.lean = 0; }, 160);
    if (FC.audio) FC.audio.play("whoosh");
    var fx = P.x + Math.sin(P.heading) * 1.1, fz = P.z + Math.cos(P.heading) * 1.1;
    var t = FC.people.near(fx, fz, 1.3);
    if (t && Math.abs((t.y || 0) - P.y) > 2.5) t = null;                   // на крыше — прохожий внизу не достаётся
    if (t && t.kind !== "remote") P.heading = Math.atan2(t.x - P.x, t.z - P.z);     // доводка на цель: кулак в нос, а не мимо
    // человеком (fhumans): прямой и джеб по очереди, быстрее клипа — удар в игре мгновенный
    if (FC.humans) FC.humans.play(P.ch, punchN++ % 2 ? "jab" : "punch", { rate: 1.8, prio: 2 });
    if (t && t.kind !== "remote") {
      if (FC.people.punch) FC.people.punch(t, Math.sin(P.heading), Math.cos(P.heading));
      else FC.people.hit(t, Math.sin(P.heading) * 5, Math.cos(P.heading) * 5, 6);
      if (FC.audio) FC.audio.play("punch");
      cam.shake(0.25);
      if (FC.fx) { FC.fx.hitstop(0.07, 0.05); FC.fx.haptic("medium"); FC.fx.burst(fx, 1.1, fz, "sparks", 10); }
      FC.emit("crime", { type: t.kind === "cop" ? "assault_cop" : "assault", x: P.x, z: P.z });
      FC.people.panic(P.x, P.z, 18, "punch");
    }
  }

  /* ---- двери: ближайшие здания дают «Войти» ------------------------------------------------------------------ */
  FC.interact.provider(function (px, pz, room) {
    if (room != null || P.mode !== "foot") return null;
    var out = [];
    M.near(px, pz, 6).forEach(function (B) {
      if (B.prop || !B.doors) return;
      B.doors.forEach(function (d, i) {
        out.push({ id: "door" + B.id + "_" + i, x: d.x, z: d.z, r: 2.4, key: "use",
          label: "Войти: " + B.name + (B.floors > 1 ? " · " + B.floors + " эт." : ""),
          act: function () { if (FC.inside) FC.inside.enter(B, i); } });
      });
    });
    return out;
  });

  /* ---- крыша: вертолёт рядом — «Сесть»; люк над главным входом (кольцо) — «Спуститься» на верхний этаж, как раньше
     давал выход из вертолёта на крыше. Одно действие за раз и только у люка: тап по экрану на телефоне — тоже «✋». */
  var roofIt = { id: "roof_air", x: 0, z: 0, r: 5.5, room: "roof", key: "car", label: "", act: null };
  var roofAir = null, hatch = { B: null, x: 0, z: 0, y: 0 };
  function roofBoard() { if (roofAir && !roofAir.wrecked && FC.air) FC.air.enter(roofAir); }
  function roofDown() {
    var B = hatch.B; if (!B || !FC.inside || !FC.inside.enter) return;
    var top = Math.max(0, (B.floors || 1) - 1);
    if (top) {                                                       // лифтом наверх, когда интерьер откроется (как fair.js goTop)
      var off = FC.on("inside:enter", function (e) {
        if (!e || e.building !== B) return;
        off();
        var tries = 0, again = function () {
          if (!FC.inside.active || FC.inside.building !== B || FC.inside.floor === top || tries++ > 8) return;
          FC.inside.go(top); setTimeout(again, 900);
        };
        setTimeout(again, 80);
      });
      setTimeout(off, 15000);
    }
    FC.inside.enter(B, 0);
  }
  function setHatch(B) {
    if (hatch.B === B) return;
    hatch.B = null;
    if (FC.markers) FC.markers.remove("roof_hatch");
    if (!B || !B.doors || !B.doors.length || !FC.inside) return;
    var d = B.doors[0], x = d.x - d.nx * 3.4, z = d.z - d.nz * 3.4, y = M.roofAt(x, z, P.y + STEP);   // над входом, 2,5 м от стены
    if (!(y > P.y - 1.5)) { x = B.x; z = B.z; y = M.roofAt(x, z, P.y + STEP); }
    if (!(y > P.y - 1.5)) return;
    hatch.B = B; hatch.x = x; hatch.z = z; hatch.y = y;
    if (FC.markers) FC.markers.add({ id: "roof_hatch", x: x, z: z, y: y, color: "#ffcf7a", ring: 1.1, beam: false, blip: false });
  }
  FC.interact.provider(function (px, pz, room) {
    if (room !== "roof" || P.mode !== "foot" || P.dead) { if (hatch.B) setHatch(null); return null; }
    if (!P.onGround) return null;
    var L = FC.air ? FC.air.list : [], A = null, bd = 5.5 * 5.5;
    for (var i = 0; i < L.length; i++) {
      var a = L[i], d = FC.dist2(a.x, a.z, px, pz);
      if (a.ai || a.wrecked || a.player || a.kind !== "heli" || Math.abs(a.y - P.y) > 2.5 || d >= bd) continue;
      bd = d; A = a;
    }
    setHatch(M.buildingAt(px, pz, 0));
    if (A) {
      roofAir = A; roofIt.id = "roof_air"; roofIt.x = A.x; roofIt.z = A.z; roofIt.r = 5.5; roofIt.key = "car"; roofIt.act = roofBoard;
      roofIt.label = (A.spec.police ? "Угнать " : "Сесть: ") + A.spec.name;
      return [roofIt];
    }
    if (!hatch.B) return null;
    roofIt.id = "roof_down"; roofIt.x = hatch.x; roofIt.z = hatch.z; roofIt.r = 2; roofIt.key = "use"; roofIt.act = roofDown;
    roofIt.label = "🚪 Спуститься на " + Math.max(1, hatch.B.floors || 1) + "-й этаж";
    return [roofIt];
  });

  /* ---- вход: профиль, сохранение, старт --------------------------------------------------------------------- */
  var loader = document.getElementById("loader");
  function begin(spot) {
    try { global.performance.mark("fc:begin"); } catch (e) { /* старый браузер */ }
    var S = FC.save;
    if (spot) {                                                       // выбранный район (FC.places): лицом к месту, камера — за спиной
      P.teleport(spot.x, spot.z, spot.h != null ? spot.h : Math.PI * 0.85);
      if (spot.h != null) { P.heading = spot.h; cam.yaw = spot.h + Math.PI; cam.snap = true; }
    }
    else if (S.pos && !S.tutorial) P.teleport(S.pos.x, S.pos.z, S.pos.h + Math.PI);   // в сохранении — поворот камеры
    else P.teleport(P.x, P.z, Math.PI * 0.85);
    // вход в игру — всегда днём: сохранённый час берём, только если он светлый (раньше после вечерней игры заходили в ночь)
    FC.setHour(S.hour != null && S.hour >= 8 && S.hour < 18 ? S.hour : 11);
    P.hp = Math.min(P.maxHp, S.hp > 100 ? S.hp : P.maxHp);   // старые сохранения (максимум 100) — полное здоровье
    FC.systems.forEach(function (s) { if (s.init) { try { s.init(); } catch (e) { if (global.console) console.error("init " + s.name, e); } } });
    // экран загрузки уходит, когда шейдеры собраны и первые кварталы достроены: замер 22.11 — все рывки (до 0,2 с на
    // «телефонной» скорости) приходились на первые ~1,3 с после старта (достройка кусков Минска, сборка шейдеров, мусор);
    // дальше ходьба и езда без кадров > 50 мс. Игра под заставкой уже идёт; ждём не дольше 4 с
    var warmed = !G.warm, t0 = performance.now();
    var hideLoader = function () {
      if (global.FCL) { global.FCL.done(); return; }                 // экран загрузки floader.js: «0 км» и въезд в город
      if (loader && !loader.classList.contains("done")) { loader.classList.add("done"); setTimeout(function () { loader.remove(); }, 1000); }
    };
    if (global.FCL) global.FCL.stage("start");
    if (G.warm) G.warm(G.scene, function () { warmed = true; });
    (function waitCity() {
      var busy = FC.osm && FC.osm.busy && FC.osm.busy();
      if ((warmed && !busy && performance.now() - t0 > 300) || performance.now() - t0 > 4000) hideLoader(); else setTimeout(waitCity, 100);
    })();
    FC.started = true; FC.startedAt = performance.now();
    FC.emit("start", {});
    // первый заход — лучший кадр: ясное солнце, без дождя; в районе — камера ниже (ориентир в кадре), пролёт и плашка района
    if (M.minsk && FC.save.tutorial) { if (G.preset) G.preset("summer"); if (G.calm) G.calm(300); }
    var sa = FC.places && FC.places.spawnAt;
    if (sa) {
      cam.pitch = 0.14; cam.want = cam.dist = narrow ? 10 : 8.5;
      startIntro();
      if (FC.hud.areaCard) setTimeout(function () { FC.hud.areaCard(sa.name, sa.about || (FC.places.districts.filter(function (d) { return d.id === sa.id; })[0] || {}).about); }, 1600);
    }
    if (!FC.mobile) FC.hud.help("<b>WASD</b> — идти · клик и мышь — смотреть", 8);
    else FC.hud.help("Левый палец — идти · правый — смотреть", 7);
    // подсказка гаснет, когда человек пошёл: прочитал — и не мешает
    (function () { var x0 = P.x, z0 = P.z, t1 = performance.now();
      (function w() { if (performance.now() - t1 > 9000) return; if (Math.hypot(P.x - x0, P.z - z0) > 6) { setTimeout(function () { FC.hud.help("", 0.01); }, 1500); return; } setTimeout(w, 300); })(); })();
  }
  var beginQueued = false;
  FC.on("me", function (me) {
    if (me.creature) P.setCreature(me.creature);
    if (FC.started || beginQueued) return;
    beginQueued = true;
    // сначала кадр заставки с картинкой (floader.js afterPaint, ≤ 1,2 с), потом пакеты мест и выбор района («Где начнёшь?»,
    // FC.places — город строится сразу там), потом тяжёлая стройка города
    // после выбора района — «Как тебя зовут?» (fnick.js gate: ника нет — спросит, есть — сразу дальше), потом город
    function named(spot) { if (FC.nick && FC.nick.gate) FC.nick.gate(function () { begin(spot); }); else begin(spot); }
    function go() {
      var PL = FC.places;
      if (!PL) { named(); return; }
      PL.ready(function () {
        if (!PL.wantPick()) { named(); return; }
        var S = FC.save, last = S.pos && !S.tutorial ? { name: FC.map.district ? FC.map.district(S.pos.x, S.pos.z).name : "" } : null;
        PL.pickSpawn(named, last);
      });
    }
    if (global.FCL && global.FCL.afterPaint) global.FCL.afterPaint(go); else go();
  });
  // сохраняем позицию раз в 5 с
  var saveT = 0;
  FC.addSystem({
    name: "player", order: 10,
    update: function (dt) {
      if (!FC.started) return;
      if (P.mode === "foot") updateFoot(dt);
      var ch = P.ch;
      ch.x = P.x; ch.z = P.z; ch.y = P.y; ch.vx = P.vx; ch.vz = P.vz;
      if (P.mode !== "foot") { P.roof = false; fallFrom = null; }   // за штурвалом, в машине, под куполом — не падение пешком
      ch.speed = Math.hypot(P.vx, P.vz); ch.ground = groundY(P.x, P.z, P.y);   // тень — на крыше, если она под ногами
      ch.air = P.mode === "foot" && !P.onGround && P.y > ch.ground + 0.35;     // человек в прыжке — поза полёта
      ch.visible = P.mode !== "car";
      ch.room = FC.inside && FC.inside.active ? FC.inside.building.id : null;
      // регенерация здоровья вне боя
      if (P.hp < P.maxHp && performance.now() - P.lastHit > 6000) P.heal(dt * 6);
      saveT -= dt;
      if (saveT <= 0 && !(FC.inside && FC.inside.active)) {
        saveT = 5;
        FC.save.pos = { x: Math.round(P.x), z: Math.round(P.z), h: +cam.yaw.toFixed(2) };
        FC.save.hp = Math.round(P.hp);
        FC.dirty();
      }
    }
  });
  FC.addSystem({ name: "camera", order: 95, update: updateCamera });

  /* ---- цикл ------------------------------------------------------------------------------------------------- */
  var last = performance.now();
  function loop(now) {
    requestAnimationFrame(loop);
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (FC.fx) dt *= FC.fx.timeScale();                       // стоп-кадр и замедление на больших ударах
    if (document.hidden || FC.tgPaused) { last = now; return; }
    // до старта сцену закрывает экран загрузки: не считаем и не рисуем — видеокарта и поток нужны заставке (её картинка
    // иначе декодировалась секунды) и стройке города в begin()
    if (!FC.started) { last = now; return; }
    I.poll();
    if (!FC.paused) {
      for (var i = 0; i < FC.systems.length; i++) {
        var s = FC.systems[i];
        try { s.update(dt); } catch (e) { if (!s._err) { s._err = 1; if (global.console) console.error("system " + s.name, e); } }
      }
    }
    G.frame(FC.paused ? 0 : dt);
    I.endFrame();
  }
  requestAnimationFrame(loop);

  // отладка в консоли: FC.debug.tp(x, z), FC.debug.hour(h), FC.debug.rain()
  FC.debug = {
    tp: function (x, z) { P.teleport(x, z); }, hour: function (h) { FC.setHour(h); },
    rain: function (on) { G.weather.target = on === false ? 0 : 1; }, money: function (n) { FC.money(n || 10000, "debug"); },
    info: function () { return G.renderer.info.render; }
  };
})(window);
