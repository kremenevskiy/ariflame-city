/* Флейм-Сити — жители: все существа (игрок, прохожие, агенты людей, копы, другие игроки) — ОДИН InstancedMesh
 * из атласа видов (необязательный набор FC_SPECIES: atlas, клетка = индекс вида в CRE минус один) плюс второй
 * атлас «служебных» фигур, нарисованный холстом (коп, медик, талисман-гид). Билборд вокруг оси Y считает шейдер.
 *
 * Персонаж (ch): {id, kind: player|ped|agent|cop|remote|npc, cell, x, y, z, vx, vz, face (1/-1), speed, phase,
 *   knocked, spin, hp, flee, alpha, scale, inside (здание), bubble}
 * Агенты внешней ленты жителей (FC.people.setCitizens; в этой сборке лента не подключена): работа — внутри своего здания-зоны (видны в интерьере), linger — у входа, wait — в
 * Проявочной, home — у своего дома. Имён нет: публичная ручка их не отдаёт.
 * Люди (22.11, fhumans.js): прохожие, офисные, копы, игрок рисуются сригованными людьми; здесь — их поведение: кружки
 * болтающих (ch.group, ch.talk — клип), снимают на телефон (ch.filming), прячутся (ch.cower), смотрят (ch.look),
 * удар человека — падение клипом без кувырков и «встал» (событие human:up) вместо исчезновения; первый удар рукой
 * мирного прохожего — только пошатнуться (punch → событие ped:slap). Свой ход персонажа — ch.brain(ch, dt) → true.
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE, M = FC.map, G = FC.gfx;
  var W = global.FC_SPECIES;

  var MAX = 520;
  var CELLS = {};                           // код вида → клетка атласа
  if (W) W.CRE.forEach(function (code, i) { if (code) CELLS[code] = i - 1; });
  var CODES = W ? W.CRE.slice(1) : [];
  var SPECIAL = { cop: 1000, cop2: 1001, medic: 1002, guide: 1003, guard: 1004, civ: 1005 };   // civ — прохожий-заглушка, пока грузится модель человека

  /* ---- второй атлас: служебные фигуры холстом (4×2 клетки по 128) ------------------------------------------- */
  function drawFigure(x, cx, cy, body, cap, badge, face) {
    x.save(); x.translate(cx, cy);
    x.fillStyle = "rgba(0,0,0,0)";
    // ноги
    x.fillStyle = "#1e2533"; x.fillRect(-18, 34, 14, 26); x.fillRect(4, 34, 14, 26);
    // тело
    x.fillStyle = body; x.beginPath(); x.moveTo(-26, 40); x.quadraticCurveTo(-30, -6, 0, -10); x.quadraticCurveTo(30, -6, 26, 40); x.closePath(); x.fill();
    // голова
    x.fillStyle = face || "#ffd8b0"; x.beginPath(); x.arc(0, -28, 20, 0, Math.PI * 2); x.fill();
    x.fillStyle = "#222"; x.beginPath(); x.arc(-7, -29, 3, 0, 7); x.arc(7, -29, 3, 0, 7); x.fill();
    if (cap) {
      x.fillStyle = cap; x.beginPath(); x.ellipse(0, -44, 24, 9, 0, 0, Math.PI * 2); x.fill();
      x.fillRect(-18, -58, 36, 14);
      x.fillStyle = "#ffd23f"; x.fillRect(-5, -55, 10, 7);
    }
    if (badge) { x.fillStyle = badge; x.beginPath(); x.arc(-11, 6, 6, 0, 7); x.fill(); }
    x.restore();
  }
  var spTex = G.tex.canvas(512, 256, function (x) {
    drawFigure(x, 64, 64, "#2f5fd0", "#1b2a5a", "#ffd23f");          // коп
    drawFigure(x, 192, 64, "#3a4a6a", "#2a2f3a", "#c0c6d0");         // коп-2 (спецгруппа)
    drawFigure(x, 320, 64, "#f2f5f7", null, "#ff3b3b");              // медик
    // талисман-гид: пламя
    x.save(); x.translate(448, 70);
    var g = x.createRadialGradient(0, 10, 4, 0, 0, 56); g.addColorStop(0, "#fff6c0"); g.addColorStop(0.4, "#ffb23a"); g.addColorStop(1, "rgba(255,80,20,0)");
    x.fillStyle = g; x.beginPath(); x.moveTo(0, -56); x.bezierCurveTo(40, -10, 40, 50, 0, 56); x.bezierCurveTo(-40, 50, -40, -10, 0, -56); x.fill();
    x.fillStyle = "#3a1a00"; x.beginPath(); x.arc(-10, 12, 5, 0, 7); x.arc(10, 12, 5, 0, 7); x.fill();
    x.restore();
    drawFigure(x, 64, 192, "#2a2a2a", "#111", "#e0e0e0");            // охранник
    drawFigure(x, 192, 192, "#d2553a", null, null);                  // прохожий (заглушка до модели человека)
  });

  /* ---- меш: квад 1×1 от ног, атрибуты на экземпляр ---------------------------------------------------------- */
  // InstancedMesh с единичными матрицами: всё нужное — в своих атрибутах на экземпляр (квад-билборд, шейдер считает поворот)
  var ig = new T.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  function attr(n) { var a = new T.InstancedBufferAttribute(new Float32Array(MAX * n), n); a.setUsage(T.DynamicDrawUsage); return a; }
  var aPos = attr(4), aAnim = attr(4), aCell = attr(2);   // pos: x y z scale; anim: flip, squash, tilt, alpha; cell: клетка, яркость
  ig.setAttribute("aPos", aPos); ig.setAttribute("aAnim", aAnim); ig.setAttribute("aCell", aCell);
  var U = {
    uAtlas: { value: null }, uSpecial: { value: spTex }, uHas: { value: 0 },
    uFogColor: { value: new T.Color() }, uFogNear: { value: 100 }, uFogFar: { value: 900 }, uLight: { value: 1 }
  };
  var mat = new T.ShaderMaterial({
    uniforms: U, transparent: false, alphaTest: 0.5,
    vertexShader: [
      "attribute vec4 aPos; attribute vec4 aAnim; attribute vec2 aCell;",
      "varying vec2 vUv; varying float vCell; varying float vFog; varying float vBright; varying float vAlpha;",
      "uniform float uFogNear, uFogFar;",
      "void main(){",
      "  vec3 c = aPos.xyz; float s = aPos.w;",
      "  vec3 toCam = cameraPosition - c; toCam.y = 0.0; toCam = normalize(toCam + vec3(1e-4, 0.0, 0.0));",
      "  vec3 right = vec3(toCam.z, 0.0, -toCam.x);",
      "  float sx = s * (1.0 + aAnim.y * 0.5), sy = s * (1.0 - aAnim.y);",
      "  float px = position.x * aAnim.x * sx, py = position.y * sy;",
      "  float tl = aAnim.z;",                                   // наклон (бег, удар, полёт)
      "  vec3 p = c + right * (px * cos(tl) - py * sin(tl)) + vec3(0.0, px * sin(tl) + py * cos(tl), 0.0);",
      "  vec4 mv = viewMatrix * vec4(p, 1.0);",
      "  gl_Position = projectionMatrix * mv;",
      "  vUv = uv; vCell = aCell.x; vBright = aCell.y; vAlpha = aAnim.w;",
      "  vFog = smoothstep(uFogNear, uFogFar, -mv.z);",
      "}"].join("\n"),
    fragmentShader: [
      "uniform sampler2D uAtlas, uSpecial; uniform float uHas; uniform vec3 uFogColor; uniform float uLight;",
      "varying vec2 vUv; varying float vCell; varying float vFog; varying float vBright; varying float vAlpha;",
      "void main(){",
      "  vec4 col;",
      "  if (vCell >= 999.5) { float k = vCell - 1000.0; vec2 cell = vec2(mod(k, 4.0), floor(k / 4.0));",
      "    col = texture2D(uSpecial, vec2((cell.x + vUv.x) / 4.0, 1.0 - (cell.y + 1.0 - vUv.y) / 2.0));",
      "  } else if (uHas > 0.5) { vec2 cell = vec2(mod(vCell, 16.0), floor(vCell / 16.0));",
      "    col = texture2D(uAtlas, vec2((cell.x + vUv.x) / 16.0, 1.0 - (cell.y + 1.0 - vUv.y) / 16.0));",
      "  } else { float d = length(vUv - vec2(0.5, 0.45)); col = vec4(1.0, 0.8, 0.5, step(d, 0.38)); }",
      "  if (col.a < 0.5 || vAlpha < 0.02) discard;",
      // дизеринг для растворения (появление/исчезновение) без прозрачности и сортировки
      "  float dth = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);",
      "  if (dth > vAlpha) discard;",
      "  vec3 c = col.rgb * uLight * vBright;",
      "  gl_FragColor = vec4(mix(c, uFogColor, vFog), 1.0);",
      "  #include <colorspace_fragment>",
      "}"].join("\n")
  });
  var mesh = new T.InstancedMesh(ig, mat, MAX);
  mesh.count = 0;
  mesh.frustumCulled = false;
  G.add(mesh);
  // атлас видов — только если подключён набор FC_SPECIES (по умолчанию нет: люди — fhumans, служебные — второй атлас)
  if (W && W.atlas) new T.TextureLoader().load(W.atlas, function (t) {
    t.colorSpace = T.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = T.LinearMipmapLinearFilter; t.anisotropy = 4;
    U.uAtlas.value = t; U.uHas.value = 1;
  });
  spTex.colorSpace = T.SRGBColorSpace;

  // тени-пятна
  var blobGeo = new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  var blobs = new T.InstancedMesh(blobGeo, new T.MeshBasicMaterial({ map: G.tex.blob, transparent: true, depthWrite: false }), MAX);
  blobs.instanceMatrix.setUsage(T.DynamicDrawUsage); blobs.frustumCulled = false; blobs.count = 0; blobs.renderOrder = 1;
  G.add(blobs);

  /* ---- персонажи ------------------------------------------------------------------------------------------ */
  var all = [];
  var seq = 0;
  function make(kind, cell, x, z, opt) {
    var ch = Object.assign({ id: kind + (seq++), kind: kind, cell: cell, x: x, y: 0.15, z: z, vx: 0, vz: 0, vy: 0, face: 1,
      speed: 0, phase: Math.random() * 6, knocked: 0, spin: 0, tilt: 0, hp: 100, flee: 0, alpha: 0, scale: 1.75, bright: 1,
      inside: null, walk: 1.3, goal: null, path: null, bubble: null, visible: true }, opt || {});
    all.push(ch);
    return ch;
  }
  function remove(ch) { var i = all.indexOf(ch); if (i >= 0) all.splice(i, 1); hideBubble(ch); }
  function cellOf(code) { return CELLS[code] != null ? CELLS[code] : -1; }
  function randomCell(r) { var c = CODES[Math.floor((r ? r() : Math.random()) * CODES.length)]; return cellOf(c); }

  /* ---- пузыри над головой: DOM, проекция каждый кадр -------------------------------------------------------- */
  var bubbleLayer = document.getElementById("bubbles");
  var tmpV = new T.Vector3();
  function say(ch, text, sec, cls) {
    if (!bubbleLayer) return;
    if (!ch.bubble) { ch.bubble = document.createElement("div"); bubbleLayer.appendChild(ch.bubble); }
    ch.bubble.className = "say " + (cls || "");
    ch.bubble.textContent = text;
    ch.bubbleUntil = performance.now() + (sec || 3.5) * 1000;
  }
  function hideBubble(ch) { if (ch.bubble) { ch.bubble.remove(); ch.bubble = null; } }
  function placeBubbles() {
    var now = performance.now(), cam = G.camera, w = global.innerWidth, h = global.innerHeight;
    for (var i = 0; i < all.length; i++) {
      var ch = all[i];
      if (!ch.bubble) continue;
      if (now > ch.bubbleUntil || !ch.shown) { hideBubble(ch); continue; }
      tmpV.set(ch.x, ch.y + ch.scale * 1.15, ch.z).project(cam);
      if (tmpV.z > 1) { ch.bubble.style.display = "none"; continue; }
      ch.bubble.style.display = "";
      ch.bubble.style.transform = "translate(" + ((tmpV.x + 1) / 2 * w) + "px," + ((1 - tmpV.y) / 2 * h) + "px) translate(-50%,-100%)";
    }
  }

  /* ---- прохожие: обход квартала по тротуару, переход на соседний, паника ------------------------------------- */
  var peds = [];
  var R = FC.rng(Date.now() & 0xffff);
  // Минск 1:1: «квартал» — полоса тротуара вдоль улицы (b.per с ломаной pts): ходят туда-обратно между перекрёстками
  function perimeter(b) {
    if (b.per) return b.per;
    var x0 = b.x0 + 1.6, x1 = b.x1 - 1.6, z0 = b.z0 + 1.6, z1 = b.z1 - 1.6;
    return { x0: x0, x1: x1, z0: z0, z1: z1, L: 2 * (x1 - x0) + 2 * (z1 - z0) };
  }
  function perimPoint(p, s) {
    if (p.pts) {
      var a = p.s0 || 0, L = (p.s1 || p.L) - a;
      if (L <= 0.5) return M.polyAt(p, a);
      var u = ((s % (2 * L)) + 2 * L) % (2 * L);
      return M.polyAt(p, a + (u > L ? 2 * L - u : u));
    }
    var w = p.x1 - p.x0, d = p.z1 - p.z0;
    s = ((s % p.L) + p.L) % p.L;
    if (s < w) return [p.x0 + s, p.z0];
    s -= w; if (s < d) return [p.x1, p.z0 + s];
    s -= d; if (s < w) return [p.x1 - s, p.z1];
    s -= w; return [p.x0, p.z1 - s];
  }
  function spawnPed(nearX, nearZ, fill) {
    // на скорости новых ставим впереди по ходу (иначе впереди пустая улица — всех появившихся оставили позади)
    var P = FC.player, pv = P ? Math.hypot(P.vx, P.vz) : 0, cx = nearX, cz = nearZ, rad = 150;
    if (!fill && pv > 8) { cx = nearX + P.vx / pv * 140; cz = nearZ + P.vz / pv * 140; rad = 70; }
    var sp = M.sidewalkPoint(R, cx, cz, rad);
    if (!sp || sp.block.kind === "water") return null;
    var d2 = FC.dist2(sp.x, sp.z, nearX, nearZ);
    if (d2 < 45 * 45 || d2 > 215 * 215) return null;
    // на глазах не возникают: в кадре — только дальше 140 м (там маленькие и проявляются за треть секунды)
    if (!fill && d2 < 140 * 140 && G.inView && G.inView(sp.x, 1, sp.z)) return null;
    var ch = make("ped", randomCell(R), sp.x, sp.z, { walk: R.range(1.1, 1.7) });
    // место на маршруте вокруг квартала — там же, где появился (было случайное: человек «ехал» к нему десятки метров)
    ch.block = sp.block; ch.per = perimeter(sp.block); ch.s = nearestS(ch.per, sp.x, sp.z); ch.dir = R.chance(0.5) ? 1 : -1;
    ch.lane = R.range(-0.7, 0.7);
    var p0 = perimPoint(ch.per, ch.s), p1 = perimPoint(ch.per, ch.s + ch.dir * 0.5), dl0 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
    ch.x = p0[0] - (p1[1] - p0[1]) / dl0 * ch.lane; ch.z = p0[1] + (p1[0] - p0[0]) / dl0 * ch.lane;
    if (R.chance(0.2)) ch.phone = true;
    peds.push(ch);
    if (FC.humans && FC.humans.ready && R.chance(0.12)) group(ch);
    return ch;
  }
  /* ---- гуляющие у ориентиров: на бульварах и площадях нет «кварталов» с тротуаром — прохожие туда не заходили, и место
   * старта выглядело пустым (23.11: «на Маяке на бульваре нет людей»). Якорь {x, z, r, n}: гуляющие ходят от точки к точке
   * в круге r (мимо домов, воды и проезжей части), стоят, смотрят по сторонам, кто-то в телефоне. Подходишь к якорю —
   * народ добирается (не на глазах: в кадре — только при старте и после перемещения, когда экран закрыт). */
  var anchors = [];
  function strollPoint(A, near) {
    for (var k = 0; k < 14; k++) {
      var a = R.range(0, 6.283), d = Math.sqrt(R()) * (near ? Math.min(14, A.r) : A.r);
      var x = (near ? near.x : A.x) + Math.cos(a) * d, z = (near ? near.z : A.z) + Math.sin(a) * d;
      if (FC.dist2(x, z, A.x, A.z) > A.r * A.r || M.water(x, z) || M.onRoad(x, z) || M.buildingAt(x, z, 1.5)) continue;
      if (M.collide(x, z, 0.45, { noProps: true }).hit) continue;
      return { x: x, z: z };
    }
    return null;
  }
  function strollBrain(ch, dt) {
    if (ch.flee > 0 || ch.group) return false;                     // паника и драка — как у всех прохожих
    var A = ch.anchor;
    if (ch.wait > 0) { ch.wait -= dt; ch.vx = ch.vz = 0; ch.speed = 0; return true; }
    if (!ch.goal2 || FC.dist2(ch.x, ch.z, ch.goal2.x, ch.goal2.z) < 1.5) {
      ch.goal2 = strollPoint(A, R.chance(0.6) ? ch : null);
      if (R.chance(0.35)) { ch.wait = R.range(2, 9); return true; }   // постоять: посмотреть, позвонить
      if (!ch.goal2) { ch.wait = 3; return true; }
    }
    var dx = ch.goal2.x - ch.x, dz = ch.goal2.z - ch.z, dl = Math.hypot(dx, dz) || 1, v = ch.walk;
    var c = M.collide(ch.x + dx / dl * v * dt, ch.z + dz / dl * v * dt, 0.35, { prev: ch });
    if (c.hit) ch.goal2 = null;
    ch.vx = (c.x - ch.x) / dt; ch.vz = (c.z - ch.z) / dt; ch.x = c.x; ch.z = c.z; ch.speed = v;
    return true;
  }
  function strollAdd(A, inView) {
    var at = strollPoint(A); if (!at) return null;
    if (!inView && G.inView && G.inView(at.x, 1, at.z)) return null;
    var ch = make("ped", randomCell(R), at.x, at.z, { walk: R.range(1.0, 1.45) });
    ch.anchor = A; ch.brain = strollBrain; ch.wait = R.chance(0.4) ? R.range(0, 6) : 0;
    if (R.chance(0.3)) ch.phone = true;
    peds.push(ch);
    return ch;
  }
  function stroll(x, z, r, n) {
    var A = { x: x, z: z, r: r || 45, n: n || 14 };
    anchors.push(A);
    return A;
  }
  function strollTick(px, pz, fillP) {
    for (var i = 0; i < anchors.length; i++) {
      var A = anchors[i], d2 = FC.dist2(px, pz, A.x, A.z);
      if (d2 > 220 * 220) continue;
      var have = 0;
      for (var k = 0; k < peds.length; k++) if (peds[k].anchor === A) have++;
      for (var j = 0; j < Math.min(fillP ? A.n : 1, A.n - have); j++) strollAdd(A, fillP);
    }
  }

  // якоря — у каждого района старта (FC.places): толпа чуть впереди точки, туда, куда смотрит камера
  FC.on("start", function () {
    var ds = (FC.places && FC.places.districts) || [], n = G.Q.level === "low" ? 7 : 12;
    ds.forEach(function (d) {
      if (d.x == null) return;
      var h = d.h != null ? d.h * Math.PI / 180 : 0;
      stroll(d.x + Math.sin(h) * 22, d.z + Math.cos(h) * 22, 42, n);
    });
  });

  /* Кружок болтающих: 2–3 человека стоят лицом друг к другу, говорят по очереди (клипы talk/listen, иногда смех),
     через 20–70 с расходятся по своим делам. */
  function group(first) {
    var n = R.chance(0.6) ? 2 : 3, a0 = R.range(0, 6.28), now = performance.now();
    var g = { x: first.x, z: first.z, until: now + R.range(20000, 70000), next: 0, speaker: null, members: [] };
    for (var i = 0; i < n; i++) {
      var ch = i ? make("ped", randomCell(R), first.x, first.z, { walk: R.range(1.1, 1.6) }) : first;
      if (i) { ch.block = first.block; ch.per = first.per; ch.dir = R.chance(0.5) ? 1 : -1; ch.lane = R.range(-0.7, 0.7); peds.push(ch); }
      var a = a0 + i * 6.28 / n, c = M.collide(g.x + Math.cos(a) * 0.75, g.z + Math.sin(a) * 0.75, 0.3, { noProps: true });
      ch.x = c.x; ch.z = c.z; ch.group = g; ch.look = g;
      g.members.push(ch);
    }
    return g;
  }
  function groupStep(ch, dt) {
    var g = ch.group, now = performance.now();
    ch.vx = ch.vz = 0; ch.speed = 0;
    if (now > g.until || g.members.length < 2) {
      ch.group = null; ch.talk = null; ch.look = null; ch.s = nearestS(ch.per, ch.x, ch.z);
      var k = g.members.indexOf(ch); if (k >= 0) g.members.splice(k, 1);
      return;
    }
    if (now > g.next) {                                 // слово переходит к другому
      g.next = now + R.range(2500, 5500);
      var prev = g.speaker;
      g.speaker = g.members[Math.floor(Math.random() * g.members.length)];
      g.members.forEach(function (m) {
        m.talk = m === g.speaker ? (Math.random() < 0.3 ? "talk2" : "talk") : "listen";
        if (m !== g.speaker && m === prev && Math.random() < 0.3 && FC.humans) FC.humans.play(m, Math.random() < 0.6 ? "laugh" : "shrug", { rate: 1.2 });
      });
      if (FC.talk && FC.talk.chatter && Math.random() < 0.25) FC.talk.chatter(g.speaker);
    }
  }
  function updatePed(ch, dt) {
    if (ch.knocked > 0) return;
    if (ch.brain && ch.brain(ch, dt)) return;           // свой ход (ftalk: драка, ответный удар)
    if (ch.filming > 0) ch.filming -= dt;
    if (ch.cower > 0) ch.cower -= dt;
    if (!ch.per) {                                  // прохожий, созданный чужим модулем без квартала, — привязываем к ближайшему
      var bb = M.blockAt(ch.x, ch.z);
      if (!bb || bb.kind === "water") { ch.vx = ch.vz = 0; ch.speed = 0; return; }
      ch.block = bb; ch.per = perimeter(bb); ch.s = nearestS(ch.per, ch.x, ch.z); ch.dir = ch.dir || 1; ch.lane = ch.lane || 0; ch.walk = ch.walk || 1.3;
    }
    if (ch.group && !(ch.flee > 0)) return groupStep(ch, dt);
    if (ch.flee > 0) {
      ch.flee -= dt;
      var sp = 4.8;
      var nx = ch.x + ch.fx * sp * dt, nz = ch.z + ch.fz * sp * dt;
      var c = M.collide(nx, nz, 0.35, { prev: ch });
      if (c.hit) { var tf = ch.fx; ch.fx = -ch.fz; ch.fz = tf; }
      ch.vx = (c.x - ch.x) / dt; ch.vz = (c.z - ch.z) / dt; ch.x = c.x; ch.z = c.z; ch.speed = sp;
      if (ch.flee <= 0) { var b = M.blockAt(ch.x, ch.z); if (b && b.kind !== "water") { ch.block = b; ch.per = perimeter(b); ch.s = nearestS(ch.per, ch.x, ch.z); } }
      return;
    }
    // игрок несётся прямо на прохожего — отскок в сторону с репликой (не стена, а живой человек)
    var P = FC.player;
    if (P && P.mode === "foot" && !ch.dodge) {
      var dx0 = ch.x - P.x, dz0 = ch.z - P.z, d0 = Math.hypot(dx0, dz0), pv = Math.hypot(P.vx, P.vz);
      if (d0 < 2.6 && pv > 5 && (P.vx * dx0 + P.vz * dz0) / (d0 * pv + 1e-6) > 0.6) {
        var side = (P.vx * dz0 - P.vz * dx0) > 0 ? 1 : -1;
        ch.dodge = 0.45; ch.dvx = -P.vz / pv * side * 5; ch.dvz = P.vx / pv * side * 5;
        if (Math.random() < 0.5) say(ch, ["Эй!", "Осторожнее!", "Куда летишь?!", "Ой!", "Смотри куда бежишь!"][Math.floor(Math.random() * 5)], 1.6);
      }
    }
    if (ch.dodge) {
      ch.dodge -= dt;
      var cd = M.collide(ch.x + ch.dvx * dt, ch.z + ch.dvz * dt, 0.35, { prev: ch, noProps: true });
      ch.vx = ch.dvx; ch.vz = ch.dvz; ch.x = cd.x; ch.z = cd.z; ch.speed = 5;
      if (ch.dodge <= 0) { ch.dodge = 0; ch.s = nearestS(ch.per, ch.x, ch.z); }
      return;
    }
    if (ch.pause > 0) { ch.pause -= dt; ch.vx = ch.vz = 0; ch.speed = 0; return; }
    ch.s += ch.dir * ch.walk * dt;
    var p = perimPoint(ch.per, ch.s), q = perimPoint(ch.per, ch.s + ch.dir * 0.5);
    var dx = q[0] - p[0], dz = q[1] - p[1], dl = Math.hypot(dx, dz) || 1;
    var tx = p[0] - dz / dl * ch.lane, tz = p[1] + dx / dl * ch.lane;
    ch.vx = (tx - ch.x) / Math.max(dt, 1e-3); ch.vz = (tz - ch.z) / Math.max(dt, 1e-3);
    // сглаживаем, чтобы на углах не дёргало
    ch.x = FC.damp(ch.x, tx, 10, dt); ch.z = FC.damp(ch.z, tz, 10, dt);
    ch.speed = ch.walk;
    if (Math.random() < dt * 0.02) ch.pause = R.range(1, 4);
    if (Math.random() < dt * 0.01) ch.dir = -ch.dir;
  }
  function nearestS(p, x, z) {
    var best = 0, bd = 1e18;
    for (var s = 0; s < p.L; s += 2) { var q = perimPoint(p, s), d = FC.dist2(q[0], q[1], x, z); if (d < bd) { bd = d; best = s; } }
    return best;
  }
  /* Паника вокруг точки: прохожие разбегаются (и кричат), часть снимает на телефон. */
  function panic(x, z, r, why) {
    for (var i = 0; i < peds.length; i++) {
      var ch = peds[i], d = Math.hypot(ch.x - x, ch.z - z);
      if (d > r || ch.knocked > 0 || ch.brain) continue;
      if (ch.group) { var gk = ch.group.members.indexOf(ch); if (gk >= 0) ch.group.members.splice(gk, 1); ch.group = null; ch.talk = null; }
      if (Math.random() < 0.25 && why !== "car") {
        ch.pause = 3.5; ch.filming = 3.5; ch.look = { x: x, z: z };
        say(ch, ["📱 снимаю!", "📱 это в рилс!", "📱 ну всё, ты в сторис"][Math.floor(Math.random() * 3)], 2.5);
        continue;
      }
      if (Math.random() < 0.12 && d < r * 0.6) { ch.pause = 2.6; ch.cower = 2.6; ch.look = null; say(ch, "😱", 1.5); continue; }
      ch.flee = 4 + Math.random() * 4;
      ch.fx = (ch.x - x) / (d || 1); ch.fz = (ch.z - z) / (d || 1);
      if (Math.random() < 0.3) say(ch, ["Аааа!", "Помогите!", "Осторожно!", "Ты что творишь?!", "Патруль!"][Math.floor(Math.random() * 5)], 2);
    }
  }

  /* Удар машиной или рукой: отлетает, крутится, лежит, потом встаёт (или исчезает, если прохожий). */
  function hit(ch, vx, vz, power) {
    if (ch.knocked > 0 || ch.kind === "player" || ch.kind === "remote") return false;
    var p = power || 0;
    if (ch._hs) {
      // человек (fhumans): падает навзничь клипом, лежит, встаёт; от машины ещё и отлетает — без кувырков спрайта
      ch.knocked = 4.6 + Math.random() * 2.2 + (p > 9 ? 1.5 : 0);
      ch.vx = vx * (p > 9 ? 0.9 : 0.35); ch.vz = vz * (p > 9 ? 0.9 : 0.35); ch.vy = p > 9 ? 1.5 + p * 0.12 : 0;
      ch.spin = 0; ch.tilt = 0; ch._yaw = Math.atan2(-vx, -vz);       // лицом к удару — валится от обидчика
      ch.hurtAt = performance.now(); ch.flee = 0; ch.dodge = 0; ch.pause = 0; ch.talk = null; ch.filming = 0; ch.cower = 0;
      ch.brain = null; ch.look = null;
      if (ch.group) { var gi = ch.group.members.indexOf(ch); if (gi >= 0) ch.group.members.splice(gi, 1); ch.group = null; }
    } else {
      ch.knocked = 6 + Math.random() * 3;
      ch.vx = vx * 1.1; ch.vz = vz * 1.1; ch.vy = 2 + p * 0.15;
      ch.spin = (Math.random() < 0.5 ? -1 : 1) * (5 + p * 0.3);
    }
    hideBubble(ch);
    FC.emit("ped:hit", { ch: ch, power: p });
    return true;
  }
  /* Удар игрока рукой (fmain, ftalk). Мирный прохожий-человек с первого раза чаще только шатается (клип hit) и решает,
     что делать (ftalk: огрызнуться, дать сдачи, звонить, убежать); второй удар за 6 с — с ног. Охрана, банды, копы,
     существа — сразу с ног, как было (на это завязаны налёты и банды). */
  function punch(t, dx, dz) {
    var now = performance.now();
    var soft = t._hs && FC.humans && (t.kind === "ped" || (t.kind === "npc" && !t.gang && t.cell !== SPECIAL.guard && !t.crew));
    if (soft && !(t.hurtAt && now - t.hurtAt < 6000) && Math.random() < 0.7 && !(t.knocked > 0)) {
      t.hurtAt = now; t._yaw = Math.atan2(-dx, -dz);
      if (t.kind === "ped") { t.dodge = 0.22; t.dvx = dx * 2.4; t.dvz = dz * 2.4; }
      if (t.group) { var gi = t.group.members.indexOf(t); if (gi >= 0) t.group.members.splice(gi, 1); t.group = null; t.talk = null; }
      FC.humans.play(t, Math.random() < 0.5 ? "hit" : "hit2", { prio: 2 });
      FC.emit("ped:slap", { ch: t });
      return "slap";
    }
    return hit(t, dx * 5, dz * 5, 6) ? "knock" : null;
  }
  function physics(ch, dt) {
    // полёт после удара
    if (ch.knocked > 0) {
      ch.knocked -= dt;
      ch.vy -= 20 * dt;
      var ny = ch.y + ch.vy * dt;
      var floor = ch.room != null && FC.inside && FC.inside.active ? FC.inside.floorY() : 0.15;
      if (ny <= floor) { ny = floor; ch.vy = 0; var f = Math.exp(-8 * dt); ch.vx *= f; ch.vz *= f; ch.spin *= f; }
      // внутри здания — стены этажа (FC.inside.collide), иначе удар выносил NPC сквозь стену городской физикой
      var inRoom = ch.room != null && FC.inside && FC.inside.active && FC.inside.building && FC.inside.building.id === ch.room;
      var c = inRoom ? FC.inside.collide(ch.x + ch.vx * dt, ch.z + ch.vz * dt, 0.35) : M.collide(ch.x + ch.vx * dt, ch.z + ch.vz * dt, 0.35, { prev: ch });
      if (c.hit) { ch.vx *= -0.3; ch.vz *= -0.3; }
      ch.x = c.x; ch.z = c.z; ch.y = inRoom ? Math.max(ny, FC.inside.floorY()) : ny;
      if (!ch._hs) {
        ch.tilt += ch.spin * dt;
        if (ch.y <= floor + 0.01 && Math.abs(ch.spin) < 0.5) ch.tilt = FC.damp(ch.tilt, Math.PI / 2 * Math.sign(ch.tilt || 1), 6, dt);
      }
      if (ch.knocked <= 0) {
        ch.tilt = 0; ch.y = floor; ch.vx = ch.vz = 0;
        if (ch._hs) { if (ch.kind === "ped" && ch.per) ch.s = nearestS(ch.per, ch.x, ch.z); FC.emit("human:up", { ch: ch }); }
        else if (ch.kind === "ped" && ch.room == null) ch.despawn = true;
      }
      return true;
    }
    return false;
  }

  /* ---- агенты людей ------------------------------------------------------------------------------------------ */
  var agents = {};                 // id → ch
  var ICON = { shoot: "🎥", cut: "🎬", reels: "📱", queue: "⏳", view: "🎡", mail: "📧", gallery: "📸", chat: "✈️", web: "🌐",
    notes: "📝", deck: "📊", office: "🗂️", memory: "🗄️", library: "📚", scout: "🛰️", forge: "🛠️" };
  /* Где агент (задача: «агенты других людей сидят в зданиях»): работа и ожидание — в своём здании-зоне;
     «недавно работал» — в кафе, лобби и офисах рядом с зоной (часть — у входа, на перекуре); «дома» — в своём жилом
     доме (ночью почти все, днём часть гуляет у подъезда). Дом по умолчанию — один из 144 домов по хэшу id:
     так в доме живёт несколько агентов, а не по одному на весь город. Этаж внутри решает flife.js. */
  var lingerCache = {};
  function lingerHost(zoneB, id) {
    var list = lingerCache[zoneB.id];
    if (!list) {
      list = [zoneB];
      M.buildings.forEach(function (B) {
        if (B === zoneB || B.type === "res" || B.zone || !B.doors || !B.doors.length) return;
        if (B.poi && B.poi !== "biz" && B.poi !== "hotel" && B.poi !== "store") return;
        if (FC.dist2(B.x, B.z, zoneB.x, zoneB.z) < 160 * 160) list.push(B);
      });
      list.sort(function (p, q) { return FC.dist2(p.x, p.z, zoneB.x, zoneB.z) - FC.dist2(q.x, q.z, zoneB.x, zoneB.z); });
      list = lingerCache[zoneB.id] = list.slice(0, 7);
    }
    return list[FC.hash(id, 4) % list.length];
  }
  function agentGoal(a) {
    var r = (FC.hash(a.id, 2) % 1000) / 1000;
    if ((a.state === "work" || a.state === "wait") && a.zone) {
      var Bz = M.zones[a.state === "wait" ? "queue" : a.zone] || M.zones[a.zone];
      if (Bz) return { B: Bz, mode: "inside", spot: a.state === "wait" ? "wait" : "work" };
    }
    if (a.state === "linger" && a.zone && M.zones[a.zone]) return { B: lingerHost(M.zones[a.zone], a.id), mode: r < 0.6 ? "inside" : "near", spot: "lounge" };
    var home = M.homeOf(a.house != null ? a.house : FC.hash(a.id) % 144);
    var outside = FC.clock && FC.clock.night > 0.5 ? 0.1 : 0.3;
    return { B: home, mode: r < outside ? "near" : "inside", spot: "home" };
  }
  /* Видимый цикл (задача): агент идёт по улице к своему зданию → у двери короткий вход (искры, тает) →
     внутри — на своём этаже за работой (flife.js); сменилось состояние в ленте — выходит из двери старого здания
     и идёт дальше (в кафе, домой, на работу). Сидящих в здании, где сейчас игрок, выпускает flife (через лифт). */
  var EXIT_SAY = { work: "на работу!", lounge: "☕ перерыв!", home: "🏠 домой!", wait: "⏳ жду рендер…" };
  function doorFx(dr) {
    var P = FC.player;
    if (!P || FC.dist2(dr.x, dr.z, P.x, P.z) > 70 * 70 || (FC.inside && FC.inside.active)) return;
    if (FC.fx && FC.fx.burst) { try { FC.fx.burst(dr.x, 1.3, dr.z, "sparks", 9); } catch (e) { /* эффект необязателен */ } }
  }
  function nearPlayer(ch, r) { var P = FC.player; return P && !(FC.inside && FC.inside.active) && FC.dist2(ch.x, ch.z, P.x, P.z) < r * r; }
  function applyGoal(ch, goal, fresh) {
    var P = FC.player, far = FC.dist2(ch.x, ch.z, P ? P.x : 0, P ? P.z : 0) > 380 * 380;
    var oldB = ch.home, wasIn = ch.inside != null, dr = goal.B.doors[0];
    if (wasIn && oldB && (oldB !== goal.B || goal.mode !== "inside")) {
      var od = oldB.doors[0];
      ch.inside = null;
      if (!far) {
        ch.x = od.x + od.nx * 1.3; ch.z = od.z + od.nz * 1.3; ch.alpha = 0;
        doorFx(od);
        if (nearPlayer(ch, 40)) say(ch, (goal.spot === "work" ? (ICON[ch.zone] || "✨") + " " : "") + (EXIT_SAY[goal.spot] || "🚶"), 3);
      }
    }
    ch.mode = goal.mode;
    if (oldB !== goal.B || fresh) {
      ch.home = goal.B;
      if (far || fresh) {
        var r = FC.rng(FC.hash(ch.aid)), ang = r() * 6.28, rad = 3 + r() * 9;
        ch.x = dr.x + dr.nx * 4 + Math.cos(ang) * rad; ch.z = dr.z + dr.nz * 4 + Math.sin(ang) * rad;
        ch.path = null; ch.entering = 0; ch.inside = goal.mode === "inside" ? goal.B.id : null;
      } else ch.path = M.walkRoute(ch.x, ch.z, dr.x + dr.nx * 2, dr.z + dr.nz * 2);
      return;
    }
    if (goal.mode === "inside" && ch.inside == null && !ch.path && !ch.entering) {
      if (far) ch.inside = goal.B.id; else ch.path = [{ x: dr.x + dr.nx * 2, z: dr.z + dr.nz * 2 }];
    }
  }
  function setCitizens(list) {
    var seen = {};
    (list || []).forEach(function (a) {
      if (FC.me && FC.me.rid === a.id) return;        // свой агент — это игрок
      seen[a.id] = 1;
      var ch = agents[a.id], goal = agentGoal(a), fresh = false;
      if (!goal.B) return;
      if (!ch) {
        var dr = goal.B.doors[0];
        ch = make("agent", a.creature ? cellOf(a.creature) : SPECIAL.civ, dr.x, dr.z, { aid: a.id, walk: FC.rng(FC.hash(a.id)).range(1.2, 1.6), scale: 1.85 });
        agents[a.id] = ch; fresh = true;
      }
      ch.creature = a.creature; ch.state = a.state; ch.zone = a.zone; ch.doing = a.doing; ch.ago = a.ago;
      ch.spot = goal.spot;
      if (ch.room != null && ch.kind === "npc") { ch.nextGoal = goal; return; }   // сидит в здании игрока — выпустит flife
      ch.nextGoal = null;
      applyGoal(ch, goal, fresh);
    });
    Object.keys(agents).forEach(function (id) { if (!seen[id]) { remove(agents[id]); delete agents[id]; } });
  }
  function updateAgent(ch, dt) {
    if (ch.knocked > 0) return;
    if (ch.entering > 0) {                           // входит: шаг к двери и тает
      var hd = ch.home && ch.home.doors[0];
      ch.entering -= dt;
      if (hd) { var ex = hd.x + hd.nx * 0.2 - ch.x, ez = hd.z + hd.nz * 0.2 - ch.z, ed = Math.hypot(ex, ez) || 1; ch.vx = ex / ed * 1.2; ch.vz = ez / ed * 1.2; ch.x += ch.vx * dt; ch.z += ch.vz * dt; ch.speed = 1.2; }
      ch.alpha = Math.max(0, ch.entering / 0.7);
      if (ch.entering <= 0) { ch.entering = 0; ch.alpha = 1; ch.inside = ch.home ? ch.home.id : null; if (hd) doorFx(hd); }
      return;
    }
    if (ch.path && ch.path.length) {
      var t = ch.path[0], dx = t.x - ch.x, dz = t.z - ch.z, d = Math.hypot(dx, dz);
      var sp = ch.walk * (ch.mode === "inside" ? 1.5 : 1.15);
      if (d < 0.8) {
        ch.path.shift();
        if (!ch.path.length) {
          ch.path = null;
          if (ch.mode === "inside") {                  // дошёл до двери: короткий вход
            ch.entering = 0.7;
            if (nearPlayer(ch, 40)) say(ch, ch.spot === "work" ? (ICON[ch.zone] || "✨") + " за работу!" : ch.spot === "home" ? "🏠 я дома" : ch.spot === "wait" ? "⏳ проверю рендер" : "☕ на кофе", 2.4);
          }
        }
        return;
      }
      ch.vx = dx / d * sp; ch.vz = dz / d * sp; ch.speed = sp;
      var c = M.collide(ch.x + ch.vx * dt, ch.z + ch.vz * dt, 0.35, { prev: ch, noProps: true });
      ch.x = c.x; ch.z = c.z;
      return;
    }
    // у здания: топчется, пыхтит, говорит, что делает
    var B = ch.home; if (!B) return;
    var dr = B.doors[0];
    if (!ch.wander || ch.wanderT <= 0) {
      var r = Math.random() * 6.28, rad = 2 + Math.random() * 8;
      ch.wander = { x: dr.x + dr.nx * 5 + Math.cos(r) * rad, z: dr.z + dr.nz * 5 + Math.sin(r) * rad };
      ch.wanderT = 3 + Math.random() * 6;
    }
    ch.wanderT -= dt;
    var wx = ch.wander.x - ch.x, wz = ch.wander.z - ch.z, wd = Math.hypot(wx, wz);
    if (wd > 0.6) { ch.vx = wx / wd * 0.9; ch.vz = wz / wd * 0.9; ch.x += ch.vx * dt; ch.z += ch.vz * dt; ch.speed = 0.9; }
    else { ch.vx = ch.vz = 0; ch.speed = 0; }
  }
  function agentLine(ch) {
    var meta = W && W.LINES && W.LINES[ch.creature];
    if (ch.state === "linger" && ch.doing) return "☕ только что: " + ch.doing;
    if (ch.state === "work" && ch.doing) return (ICON[ch.zone] || "✨") + " " + ch.doing;
    if (meta && meta.length) return meta[Math.floor(Math.random() * meta.length)];
    return "🔥";
  }

  /* ---- цикл ------------------------------------------------------------------------------------------------ */
  var spawnT = 0, talkT = 0, DENS = { low: 1.25, mid: 1.8, high: 1.7 };
  var order = [];
  var o3 = new T.Object3D();
  FC.addSystem({
    name: "people", order: 30,
    update: function (dt) {
      var P = FC.player; if (!P) return;
      var px = P.x, pz = P.z, insideNow = FC.inside && FC.inside.active;
      // прохожие вокруг игрока
      spawnT -= dt;
      if (spawnT <= 0 && !insideNow) {
        spawnT = 0.25;
        // далеко до нормы (старт, перемещение по карте) — пачкой: улица оживает за пару секунд, а не за полминуты
        // людьми (fhumans: толпа шейдером) город держит толпу гуще, чем фигурками
        var want = Math.round(G.Q.peds * (FC.humans && FC.humans.ready ? DENS[G.Q.level] || 1 : 1)), gap = want - peds.length;
        var fillP = performance.now() < (FC.fillUntil || 0) || !FC.started;   // старт, перемещение — можно и рядом (экран закрыт)
        for (var sp = 0; sp < Math.min(8, Math.ceil(gap / 10)); sp++) spawnPed(px, pz, fillP);
        strollTick(px, pz, fillP);
      }
      for (var i = peds.length - 1; i >= 0; i--) {
        var ch = peds[i];
        if (ch.despawn || FC.dist2(ch.x, ch.z, px, pz) > 235 * 235) { remove(ch); peds.splice(i, 1); }
      }
      // ход всех
      for (var k = 0; k < all.length; k++) {
        var c = all[k];
        if (c.kind === "player" || c.kind === "remote") continue;
        if (physics(c, dt)) continue;
        if (c.kind === "ped") updatePed(c, dt);
        else if (c.kind === "agent") updateAgent(c, dt);
        else if (c.update) c.update(c, dt);
      }
      // кто-то рядом говорит
      talkT -= dt;
      if (talkT <= 0) {
        talkT = 2.2 + Math.random() * 2;
        var cand = all.filter(function (c) { return c.kind === "agent" && !c.inside && c.shown && FC.dist2(c.x, c.z, px, pz) < 30 * 30; });
        if (cand.length) { var a = cand[Math.floor(Math.random() * cand.length)]; say(a, agentLine(a), 3.5, a.state === "work" ? "busy" : ""); }
      }
      draw(dt);
      placeBubbles();
    }
  });

  function draw(dt) {
    var cam = G.camera, P = FC.player;
    var fog = G.scene.fog;
    U.uFogColor.value.copy(fog.color); U.uFogNear.value = fog.near; U.uFogFar.value = fog.far;
    U.uLight.value = 1 - G.night * 0.45;
    var insideId = FC.inside && FC.inside.active ? FC.inside.building.id : null;
    // кого рисовать: снаружи — ближайшие к камере, внутри — только этого здания (fpeople.inside даёт ребят на этаже)
    order.length = 0;
    for (var i = 0; i < all.length; i++) {
      var ch = all[i];
      ch.shown = false;
      if (!ch.visible) continue;
      if (insideId != null) { if (ch.kind !== "player" && ch.room !== insideId) continue; }
      else if (ch.inside != null || ch.room != null) continue;
      var d = FC.dist2(ch.x, ch.z, cam.position.x, cam.position.z);
      if (d > 320 * 320 && ch.kind !== "player") continue;
      ch._d = d; order.push(ch);
    }
    if (order.length > MAX) { order.sort(function (a, b) { return a._d - b._d; }); order.length = MAX; }
    // правая сторона камеры — для «зеркала» спрайта по направлению шага
    var rx = Math.cos(FC.cam ? FC.cam.yaw : 0), rz = -Math.sin(FC.cam ? FC.cam.yaw : 0);
    var t = performance.now() / 1000;
    // 3D-модели (fmodels.js): рисуют ближних сами и возвращают Set тех, кого взяли; остальных — спрайтами
    var taken = FC.models && FC.models.draw ? FC.models.draw(order, dt) : null;
    var j = 0;
    for (var q = 0; q < order.length; q++) {
      var c = order[q];
      c.shown = true;
      c.alpha = Math.min(1, c.alpha + dt * 3);
      var sp = c.speed || 0;
      c.phase += dt * (sp > 0.2 ? 4 + sp * 2.2 : 1.2);
      var side = c.vx * rx + c.vz * rz;
      if (Math.abs(side) > 0.15) c.face = side > 0 ? 1 : -1;
      if (taken && taken.has(c)) continue;            // общее состояние (alpha, phase, face) обновлено — рисует 3D
      var bob = sp > 0.2 ? Math.abs(Math.sin(c.phase)) * (0.06 + sp * 0.025) * c.scale : Math.sin(t * 2 + c.phase) * 0.012 * c.scale;
      var squash = (sp > 0.2 ? Math.cos(c.phase * 2) * 0.045 : Math.sin(t * 2.4 + c.phase) * 0.025) + (c.land || 0);
      var tilt = c.knocked > 0 ? c.tilt : -c.face * Math.min(sp, 7) * 0.025 + (c.lean || 0);
      aPos.setXYZW(j, c.x, c.y + bob, c.z, c.scale);
      aAnim.setXYZW(j, c.face, squash, tilt, c.alpha);
      aCell.setXY(j, c.cell, c.bright);
      o3.position.set(c.x, (c.ground || 0.17) + 0.01, c.z); o3.scale.set(c.scale * 0.8, 1, c.scale * 0.55); o3.updateMatrix();
      blobs.setMatrixAt(j, o3.matrix);
      j++;
    }
    mesh.count = j; blobs.count = j;
    aPos.needsUpdate = true; aAnim.needsUpdate = true; aCell.needsUpdate = true; blobs.instanceMatrix.needsUpdate = true;
    if (P && P.ch) P.ch.shown = true;
  }

  /* Свидетели: кто видит точку (не в отключке, не внутри, в радиусе; копы видят дальше). */
  function witnesses(x, z, r) {
    return all.filter(function (c) {
      if (c.kind === "player" || c.kind === "remote" || c.knocked > 0 || c.inside != null || c.room != null) return false;
      var rr = c.kind === "cop" ? r * 1.6 : r;
      return FC.dist2(c.x, c.z, x, z) < rr * rr;
    });
  }
  function near(x, z, r, kind) {
    var best = null, bd = r * r;
    for (var i = 0; i < all.length; i++) {
      var c = all[i];
      if (kind && c.kind !== kind) continue;
      if (c.kind === "player" || c.inside != null || c.room != null) continue;
      var d = FC.dist2(c.x, c.z, x, z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  // агенты, которые сейчас внутри здания (для интерьера): работа и ожидание в зоне
  function insideOf(B) {
    return Object.keys(agents).map(function (k) { return agents[k]; }).filter(function (c) { return c.inside === B.id; });
  }

  FC.people = {
    all: all, peds: peds, agents: agents, make: make, remove: remove, spawnPed: spawnPed, stroll: stroll, hit: hit, panic: panic, say: say,
    witnesses: witnesses, near: near, insideOf: insideOf, punch: punch, group: group, setCitizens: setCitizens, applyGoal: applyGoal, cellOf: cellOf, randomCell: randomCell,
    SPECIAL: SPECIAL, CODES: CODES, ICON: ICON, line: agentLine
  };
  // повтор и фоторежим (fphoto.js, 22.11 v3): нарисовать людей по их полям без хода — мир на паузе
  FC.people.draw = function (dt) { draw(dt || 0); placeBubbles(); };
})(window);
