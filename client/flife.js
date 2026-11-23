/* Флейм-Сити — жизнь внутри зданий (FC.life): кто на этаже, где стоит игрок, и чем занят.
 *
 * Задача: «в любое здание можно зайти — там движ, агенты других людей сидят внутри, лестницы».
 * finside.js строит этаж и зовёт FC.life.populate(B, f, ctx, S) — здесь решается, кто на этаже:
 *   • живые агенты внешней ленты жителей (FC.people.setCitizens; в этой сборке не подключена), приписанные к зданию: работа — здание-зона, «дома» — свой жилой дом,
 *     «недавно работал» — кафе и лобби рядом с зоной (fpeople agentGoal). Этаж — по хэшу агента; на этаже игрока они
 *     сидят за столом / на диване / у кофемашины, на остальных — счётчик «👥 N» в панели лифта (floorCount);
 *   • сотрудники и гости — существа и 3D-человечки с рутинами по «умным предметам» (модель Sims: предмет рекламирует,
 *     какую нужду закрывает; NPC берёт случайный из лучших трёх по нужда × реклама / расстояние): стол → кофемашина →
 *     кулер → переговорная → принтер → окно → туалет → обратно; роли — менеджер обходит столы, курьер приезжает на
 *     лифте с коробкой, уборщица метёт, ресепшн встречает игрока, охрана обходит лобби;
 *   • разговорные кучки по 2–4 (говорящий меняется, кивает), события этажа: совещание, день рождения с конфетти,
 *     пицца, «релиз горит», стендап; лифт возит людей между этажами, по лестнице ходят;
 *   • детали: мониторы мерцают, свет включается по очереди, когда игрок входит, люди рядом поворачиваются к нему.
 * Полная симуляция — только на этаже игрока; путь по этажу — A* по сетке 0,5 м из столкновений finside.
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE;
  var CELL = 0.5;
  var L = { S: null, B: null, f: 0, g: null, nx: 0, nz: 0, x0: 0, z0: 0, pois: [], npcs: [], clusters: [], event: null,
    r: null, elevT: 10, stairT: 18, flickT: 0, lightOn: null, glow0: null, monitors: [], ceilings: [], pending: [], riders: [], t: 0 };

  /* ---- фразы ------------------------------------------------------------------------------------------------ */
  var TALK = {
    office: [["Видел новый эффект?", "Агент уже сделал рилс!"], ["Кто пьёт мой йогурт?", "Не я!"], ["Созвон перенесли.", "Опять?!"],
      ["Агент собрал отчёт за минуту.", "А я три дня делал…"], ["Пятница!", "Пиццу заказываем?"], ["Релиз в пятницу?", "Никаких релизов в пятницу!"],
      ["Уголёк сегодня в духе.", "Видел его на 64-м?"], ["Твой агент спит?", "Агенты не спят 😄"], ["Кто взял степлер?", "Он у бухгалтерии."],
      ["Отпуск скоро!", "Агент забронировал отель."], ["Презентация к утру?", "Агент соберёт за ночь."]],
    res: [["Кто опять сверлит?", "Сосед с пятого."], ["Агент напомнил про коммуналку.", "Удобно!"], ["Пойдём гулять?", "После сериала."],
      ["Что на ужин?", "Агент нашёл рецепт."], ["Лифт опять сломан?", "Работает, я проверил."]],
    zone: [["Очередь сегодня большая.", "Люди любят рилсы!"], ["Где исходники?", "В облаке, как всегда."], ["Субтитры готовы?", "Почти!"],
      ["Свет левее!", "Так лучше?"], ["Рендер проявился?", "Ещё минутка."], ["Клиент доволен!", "🔥"]],
    lobby: [["Вы к кому?", "В «Пиксель», на пятый."], ["Пропуск забыл…", "Скажи на ресепшене."], ["Курьер приехал!", "Пусть поднимается."]],
    hq: [["Уголёк собрал всех на 64-м.", "Опять мотивирует 😄"], ["Новый эффект в цеху!", "Видел, огонь!"], ["Агентов уже сотни.", "И все работают!"]],
    party: [["С днём рождения! 🎂", "Ура!"], ["Загадывай желание!", "Уже загадал 😏"], ["Торт где?", "Режем!"], ["Танцуем!", "🎵"]],
    pizza: [["🍕 Налетай!", "Кто заказал ананасы?!"], ["Последний кусок мой.", "Нет, мой!"]],
    release: [["🔥 Релиз горит!", "Деплой через 5 минут!"], ["Кто сломал прод?!", "Это не я!"], ["Откатываем?", "Чиним вперёд!"]],
    standup: [["Что сделал вчера?", "Закрыл три задачи."], ["Есть блокеры?", "Кофемашина сломалась!"], ["Сегодня — релиз.", "🔥"]],
    meet: [["📊 Итоги недели", "Рост на 20%!"], ["Вопросы есть?", "Когда обед?"], ["Записываю.", "Агент уже ведёт протокол."]]
  };
  var USE_SAY = { coffee: ["☕", "Кофе!", "Третья чашка…", "Капучино, пожалуйста"], cooler: ["💧", "Жарко сегодня."], printer: ["🖨️ печатаю…", "Опять зажевал!"],
    window: ["🌆", "Какой вид!"], storage: ["📦"], server: ["💾 перезагружу…"], meet: ["📊", "Записываю."], tv: ["📺"], sofa: ["😌"], shelf: ["🛒", "Где молоко?"] };
  function pick(a, r) { return a[Math.floor((r ? r() : Math.random()) * a.length)]; }
  function say(ch, text, sec, cls) { if (FC.people && text) FC.people.say(ch, text, sec || 2.8, cls || ""); }

  /* ---- координаты: план этажа (локальные) ↔ мир ------------------------------------------------------------- */
  function W(lx, lz) { return FC.inside.toWorld(lx, lz); }
  function Lc(wx, wz) { return FC.inside.toLocal(wx, wz); }

  /* ---- сетка проходимости из столкновений этажа ------------------------------------------------------------ */
  function buildGrid(S) {
    var nx = Math.ceil(S.W / CELL), nz = Math.ceil(S.D / CELL), g = new Uint8Array(nx * nz), x0 = -S.W / 2, z0 = -S.D / 2, pad = 0.3;
    function mark(a0, a1, b0, b1) {
      var i0 = Math.max(0, Math.floor((a0 - pad - x0) / CELL)), i1 = Math.min(nx - 1, Math.floor((a1 + pad - x0) / CELL));
      var j0 = Math.max(0, Math.floor((b0 - pad - z0) / CELL)), j1 = Math.min(nz - 1, Math.floor((b1 + pad - z0) / CELL));
      for (var j = j0; j <= j1; j++) for (var i = i0; i <= i1; i++) g[j * nx + i] = 1;
    }
    S.colliders.forEach(function (c) { mark(c[0], c[1], c[2], c[3]); });
    if (S.stair) mark(S.stair.x0, S.stair.x1, S.stair.z0 + 0.2, S.stair.z1);   // по лестнице ходят своим путём
    for (var i = 0; i < nx; i++) { g[i] = 1; g[(nz - 1) * nx + i] = 1; }
    for (var j = 0; j < nz; j++) { g[j * nx] = 1; g[j * nx + nx - 1] = 1; }
    L.g = g; L.nx = nx; L.nz = nz; L.x0 = x0; L.z0 = z0;
  }
  function idx(lx, lz) {
    var i = FC.clamp(Math.floor((lx - L.x0) / CELL), 0, L.nx - 1), j = FC.clamp(Math.floor((lz - L.z0) / CELL), 0, L.nz - 1);
    return j * L.nx + i;
  }
  function cx(k) { return L.x0 + (k % L.nx + 0.5) * CELL; }
  function cz(k) { return L.z0 + (Math.floor(k / L.nx) + 0.5) * CELL; }
  function nearFree(lx, lz, R) {
    var k0 = idx(lx, lz);
    if (!L.g[k0]) return k0;
    var i0 = k0 % L.nx, j0 = Math.floor(k0 / L.nx);
    for (var rr = 1; rr <= (R || 8); rr++) {
      for (var dj = -rr; dj <= rr; dj++) for (var di = -rr; di <= rr; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== rr) continue;
        var i = i0 + di, j = j0 + dj;
        if (i < 0 || j < 0 || i >= L.nx || j >= L.nz) continue;
        if (!L.g[j * L.nx + i]) return j * L.nx + i;
      }
    }
    return -1;
  }
  // A* по 8 соседям; двоичная куча на массивах
  var gS = null, came = null, closed = null, heap = [], hf = [];
  function hpush(k, f) { heap.push(k); hf.push(f); var i = heap.length - 1; while (i > 0) { var p = (i - 1) >> 1; if (hf[p] <= hf[i]) break; swap(i, p); i = p; } }
  function swap(a, b) { var t = heap[a]; heap[a] = heap[b]; heap[b] = t; t = hf[a]; hf[a] = hf[b]; hf[b] = t; }
  function hpop() {
    var top = heap[0], last = heap.pop(), lf = hf.pop();
    if (heap.length) {
      heap[0] = last; hf[0] = lf; var i = 0;
      for (;;) { var l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && hf[l] < hf[m]) m = l; if (r < heap.length && hf[r] < hf[m]) m = r; if (m === i) break; swap(i, m); i = m; }
    }
    return top;
  }
  function astar(sk, gk) {
    var N = L.nx * L.nz;
    if (!gS || gS.length !== N) { gS = new Float32Array(N); came = new Int32Array(N); closed = new Uint8Array(N); }
    gS.fill(1e9); closed.fill(0); heap.length = 0; hf.length = 0;
    var gx = gk % L.nx, gz = Math.floor(gk / L.nx);
    gS[sk] = 0; came[sk] = -1; hpush(sk, 0);
    var n = 0;
    while (heap.length && n++ < 5000) {
      var k = hpop();
      if (k === gk) break;
      if (closed[k]) continue;
      closed[k] = 1;
      var i = k % L.nx, j = Math.floor(k / L.nx);
      for (var dj = -1; dj <= 1; dj++) for (var di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        var ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= L.nx || nj >= L.nz) continue;
        var nk = nj * L.nx + ni;
        if (L.g[nk] || closed[nk]) continue;
        if (di && dj && (L.g[j * L.nx + ni] || L.g[nj * L.nx + i])) continue;     // не срезаем углы
        var c = gS[k] + (di && dj ? 1.414 : 1);
        if (c < gS[nk]) {
          gS[nk] = c; came[nk] = k;
          var hx = Math.abs(ni - gx), hz = Math.abs(nj - gz);
          hpush(nk, c + Math.max(hx, hz) + 0.414 * Math.min(hx, hz));
        }
      }
    }
    if (gS[gk] >= 1e9) return null;
    var out = [], q = gk, guard = 0;
    while (q !== -1 && guard++ < 4000) { out.push(q); q = came[q]; }
    return out.reverse();
  }
  function seeLine(ax, az, bx, bz) {
    var d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / 0.25);
    for (var s = 1; s < n; s++) { if (L.g[idx(ax + (bx - ax) * s / n, az + (bz - az) * s / n)]) return false; }
    return true;
  }
  // путь в локальных точках, «натянутый» по прямой видимости; конечная точка — сама цель (стул у стола)
  function route(ax, az, bx, bz) {
    var sk = nearFree(ax, az, 4), gk = nearFree(bx, bz, 6);
    if (sk < 0 || gk < 0) return null;
    var cells = astar(sk, gk);
    if (!cells) return null;
    var pts = cells.map(function (k) { return { x: cx(k), z: cz(k) }; });
    var out = [], cur = { x: ax, z: az }, i = 0;
    while (i < pts.length - 1) {
      var j = i + 1;
      while (j + 1 < pts.length && j - i < 24 && seeLine(cur.x, cur.z, pts[j + 1].x, pts[j + 1].z)) j++;
      out.push(pts[j]); cur = pts[j]; i = j;
    }
    out.push({ x: bx, z: bz });
    return out;
  }

  /* ---- умные предметы этажа -------------------------------------------------------------------------------- */
  var ROOM_POI = { kitchen: ["coffee", 2], kitchenres: ["coffee", 1], cafe: ["coffee", 3], wc: ["wc", 1], bath: ["wc", 1], server: ["server", 1],
    storage: ["storage", 1], mail: ["storage", 1], living: ["tv", 1] };
  function roomAt(lx, lz) {
    var R = L.S.plan.rooms;
    for (var i = 0; i < R.length; i++) { var o = R[i]; if (lx >= o.x0 && lx <= o.x1 && lz >= o.z0 && lz <= o.z1) return o; }
    return null;
  }
  function addPoi(kind, lx, lz, opt) {
    var p = Object.assign({ kind: kind, x: lx, z: lz, users: 0, cap: 1 }, opt || {});
    L.pois.push(p); return p;
  }
  function freePoint(o, r) {
    for (var t = 0; t < 12; t++) {
      var lx = r.range(o.x0 + 0.8, o.x1 - 0.8), lz = r.range(o.z0 + 0.8, o.z1 - 0.8);
      if (o.x1 - o.x0 < 1.8 || o.z1 - o.z0 < 1.8) return null;
      if (!L.g[idx(lx, lz)]) return { x: lx, z: lz };
    }
    return null;
  }
  function buildPois(ctx, S, r) {
    L.pois = [];
    ctx.seats.forEach(function (s) {
      if (S.stair && s.x > S.stair.x0 - 0.5 && s.x < S.stair.x1 + 0.5 && s.z > S.stair.z0 - 0.5 && s.z < S.stair.z1 + 0.5) return;
      var o = roomAt(s.x, s.z), kind = s.kind === "desk" ? "desk" : s.kind === "bed" ? "bed" : s.kind === "stand" ? "stand" : "sit";
      if (kind === "sit" && o && o.type === "meeting") kind = "meet";
      if (kind === "sit" && o && o.type === "living") kind = "sofa";
      addPoi(kind, s.x, s.z, { face: s.face, room: o, seat: true, taken: !!s.taken });
    });
    S.plan.rooms.forEach(function (o) {
      var rp = ROOM_POI[o.type];
      if (rp) for (var i = 0; i < rp[1]; i++) { var p = freePoint(o, r); if (p) addPoi(rp[0], p.x, p.z, { room: o, cap: rp[0] === "wc" ? 1 : 2 }); }
      var area = (o.x1 - o.x0) * (o.z1 - o.z0);
      if (/^(open|team|office|lobby|lobbyhq|skylobby|cafe)$/.test(o.type) && area > 30) {
        var c = freePoint(o, r); if (c) addPoi("cooler", c.x, c.z, { room: o, cap: 3 });
        var pr = freePoint(o, r); if (pr && o.type !== "lobby" && o.type !== "lobbyhq") addPoi("printer", pr.x, pr.z, { room: o });
      }
      if (/^(store|biz:|z:)/.test(o.type) || o.type === "store" || o.type === "gas") { for (var k = 0; k < 3; k++) { var sp = freePoint(o, r); if (sp) addPoi("shelf", sp.x, sp.z, { room: o, cap: 2 }); } }
      // окна: точки у наружных стен комнаты
      [["x0", 1], ["x1", -1], ["z0", 1], ["z1", -1]].forEach(function (e) {
        var ext = Math.abs(o[e[0]]) > (e[0][0] === "x" ? S.W : S.D) / 2 - 0.6;
        if (!ext || r() > 0.5 || area < 9) return;
        var lx = e[0][0] === "x" ? o[e[0]] + e[1] * 0.7 : r.range(o.x0 + 1, o.x1 - 1), lz = e[0][0] === "z" ? o[e[0]] + e[1] * 0.7 : r.range(o.z0 + 1, o.z1 - 1);
        if (!L.g[idx(lx, lz)]) addPoi("window", lx, lz, { room: o, cap: 2 });
      });
      // точки «просто побродить»
      for (var w = 0; w < (area > 60 ? 3 : 1); w++) { var wp = freePoint(o, r); if (wp) addPoi("wander", wp.x, wp.z, { room: o, cap: 3 }); }
    });
    S.plan.corr.forEach(function (c) { var p = freePoint(c, r); if (p) addPoi("wander", p.x, p.z, { cap: 3, corr: true }); });
  }
  // выбор предмета: нужда × реклама / расстояние, случайный из трёх лучших (идеальный выбор выглядит неживым)
  var ADV = { desk: "work", coffee: "energy", cooler: "social", meet: "social", printer: "work", window: "fun", wc: "bladder", sofa: "rest",
    sit: "rest", tv: "fun", storage: "work", server: "work", wander: "fun", shelf: "shop", stand: "work", bed: "rest" };
  function choose(ch, kinds) {
    var lf = ch.life, list = [];
    L.pois.forEach(function (p) {
      if (kinds.indexOf(p.kind) < 0 || p.users >= p.cap || p === lf.at || (p.seat && p.taken && p !== lf.home)) return;
      var need = lf.needs[ADV[p.kind]] || 0.05, d = Math.hypot(p.x - ch.lx, p.z - ch.lz);
      list.push([need * (0.7 + Math.random() * 0.6) / (1 + d / 7), p]);
    });
    if (!list.length) return null;
    list.sort(function (a, b) { return b[0] - a[0]; });
    return list[Math.floor(Math.random() * Math.min(3, list.length))][1];
  }

  /* ---- роли ------------------------------------------------------------------------------------------------ */
  var ROLE = {
    worker: { speed: 1.35, errands: ["coffee", "cooler", "printer", "window", "wc", "meet", "storage", "server"], sit: [10, 26], needs: { energy: 0.5, social: 0.4, work: 0.3, bladder: 0.25, fun: 0.3 } },
    visitor: { speed: 1.2, errands: ["sofa", "sit", "window", "cooler", "coffee", "wander", "shelf"], sit: [5, 12], needs: { rest: 0.5, fun: 0.5, social: 0.4, energy: 0.3, shop: 0.6 } },
    resident: { speed: 1.05, errands: ["sofa", "tv", "coffee", "window", "wc", "bed", "wander"], sit: [8, 20], needs: { rest: 0.6, fun: 0.5, energy: 0.4, bladder: 0.2 } },
    customer: { speed: 1.1, errands: ["shelf", "wander", "shelf", "window"], sit: [3, 7], needs: { shop: 0.9, fun: 0.2 } },
    manager: { speed: 1.25 }, courier: { speed: 2.4 }, cleaner: { speed: 0.7 }, guard: { speed: 1.0 }, doctor: { speed: 1.45 }
  };
  function cellFor(kind, r) {
    var SP = FC.people.SPECIAL;
    if (kind === "guard") return SP.guard;
    if (kind === "doctor") return SP.medic;
    if (kind === "cop") return SP.cop;
    return FC.people.randomCell(r);
  }
  function spawn(role, lx, lz, opt) {
    opt = opt || {};
    var w = W(lx, lz), cell = opt.cell != null ? opt.cell : cellFor(role, L.r);
    if (FC.player && FC.player.ch && cell === FC.player.ch.cell) cell = FC.people.randomCell();   // не путать с игроком
    var ch = FC.people.make("npc", cell, w.x, w.z, { room: L.B.id, y: L.S.y0, ground: L.S.y0, scale: opt.scale || 1.8, alpha: opt.fade ? 0 : 1 });
    var R = ROLE[role] || ROLE.visitor;
    ch.life = { role: role, state: "idle", t: 0.5 + Math.random() * 2, path: null, pi: 0, speed: R.speed * (0.9 + Math.random() * 0.25),
      needs: Object.assign({}, R.needs || {}), home: null, at: null, says: opt.says || null };
    ch.lx = lx; ch.lz = lz;
    ch.update = update;
    if (opt.line) ch.line = opt.line;
    L.S.npcs.push(ch); L.npcs.push(ch);
    return ch;
  }
  function despawn(ch) {
    if (ch.life && ch.life.at) ch.life.at.users = Math.max(0, ch.life.at.users - 1);
    FC.people.remove(ch);
    var i = L.S.npcs.indexOf(ch); if (i >= 0) L.S.npcs.splice(i, 1);
    i = L.npcs.indexOf(ch); if (i >= 0) L.npcs.splice(i, 1);
  }
  function occupy(ch, p) {
    var lf = ch.life;
    if (lf.at) lf.at.users = Math.max(0, lf.at.users - 1);
    lf.at = p; if (p) p.users++;
  }
  function goTo(ch, lx, lz, then) {
    if (L.budget <= 0) { occupy(ch, null); ch.life.state = "idle"; ch.life.t = 0.1 + Math.random() * 0.4; return true; }   // решит заново в следующем кадре
    L.budget--;
    var p = route(ch.lx, ch.lz, lx, lz);
    if (!p) return false;
    var lf = ch.life; lf.path = p; lf.pi = 0; lf.state = "walk"; lf.then = then; ch.sit = false;
    return true;
  }
  function setPos(ch, lx, lz, dt) {
    var w = W(lx, lz);
    if (dt > 0) { ch.vx = (w.x - ch.x) / dt; ch.vz = (w.z - ch.z) / dt; }
    ch.lx = lx; ch.lz = lz; ch.x = w.x; ch.z = w.z;
  }

  /* ---- рутина NPC (зовёт fpeople каждый кадр: ch.update) ----------------------------------------------------- */
  function update(ch, dt) {
    var lf = ch.life; if (!lf || !L.S) return;
    var t = performance.now() / 1000;
    ch.alpha = Math.min(1, (ch.alpha || 0) + dt * 2.5);
    if (lf.hidden) { lf.hidden -= dt; ch.visible = lf.hidden <= 0; if (lf.hidden <= 0) { lf.hidden = 0; lf.t = 0; } return; }
    if (lf.state === "walk") return walkStep(ch, dt);
    if (lf.state === "stairs") return stairStep(ch, dt);
    ch.vx = ch.vz = 0; ch.speed = 0;
    ch.y = L.S.y0 + (lf.dance ? Math.abs(Math.sin(t * 6.3 + ch.phase)) * 0.22 : 0);
    ch.lean = lf.typing ? Math.sin(t * 9 + ch.phase) * 0.025 : lf.dance ? Math.sin(t * 4 + ch.phase) * 0.22 : lf.nod ? Math.sin(t * 9) * 0.06 : 0;
    if (lf.cluster) return;                               // кучкой правит clusterTick
    lf.t -= dt;
    if (lf.t > 0) return;
    next(ch);
  }
  function walkStep(ch, dt) {
    var lf = ch.life, p = lf.path[lf.pi];
    var sp = lf.speed * (L.event && L.event.kind === "release" ? 1.8 : 1);
    var dx = p.x - ch.lx, dz = p.z - ch.lz, d = Math.hypot(dx, dz);
    if (d < 0.12) {
      lf.pi++;
      if (lf.pi >= lf.path.length) { lf.path = null; lf.state = "idle"; ch.vx = ch.vz = 0; ch.speed = 0; var th = lf.then; lf.then = null; if (th) th(ch); else lf.t = 1; }
      return;
    }
    var k = Math.min(1, sp * dt / d);
    setPos(ch, ch.lx + dx * k, ch.lz + dz * k, dt);
    ch.speed = sp; ch.sit = false; ch.lean = 0; ch.y = L.S.y0;
  }
  // что дальше: роль решает
  function next(ch) {
    var lf = ch.life, r = ROLE[lf.role] || ROLE.visitor;
    lf.typing = false; lf.nod = false;
    if (lf.role === "worker" || lf.role === "visitor" || lf.role === "resident" || lf.role === "customer") {
      // сидел дома (за столом) — идём по делу; был по делу — возвращаемся
      if (lf.home && lf.at !== lf.home && Math.random() < 0.65) return goHome(ch);
      var p = choose(ch, r.errands);
      if (!p) { lf.t = 3; return; }
      occupy(ch, p);
      if (!goTo(ch, p.x, p.z, arrive)) { occupy(ch, null); lf.t = 2; }
      return;
    }
    if (lf.role === "manager") {
      var desks = L.npcs.filter(function (c) { return c !== ch && c.life && c.life.typing; });
      var tgt = desks.length ? pick(desks) : null;
      if (tgt && goTo(ch, tgt.lx + 0.7, tgt.lz + 0.7, function (m) {
        m.life.t = 3 + Math.random() * 2; say(m, pick(["Как там отчёт?", "Успеваем к пятнице?", "Отличная работа!", "Нужна помощь?"]), 2.6);
        setTimeout(function () { if (tgt.life) say(tgt, pick(["Почти готово!", "Агент уже доделывает.", "Успеваем!", "Спасибо 🙂"]), 2.4); }, 1300);
      })) return;
      lf.t = 3; return;
    }
    if (lf.role === "cleaner") {
      var w = choose(ch, ["wander", "window"]) || null;
      if (w && goTo(ch, w.x, w.z, function (c) { c.life.t = 3 + Math.random() * 3; c.life.nod = true; if (Math.random() < 0.3) say(c, pick(["🧹 Осторожно, мокрый пол!", "🧹", "Ноги вытирайте!"]), 2.5); })) return;
      lf.t = 2; return;
    }
    if (lf.role === "guard") {
      var spots = lf.patrol || [];
      lf.pk = ((lf.pk || 0) + 1) % Math.max(1, spots.length);
      var s = spots[lf.pk];
      if (s && goTo(ch, s.x, s.z, function (c) { c.life.t = 4 + Math.random() * 5; })) return;
      lf.t = 4; return;
    }
    if (lf.role === "doctor") {
      var bed = choose(ch, ["bed", "sit", "wander"]);
      if (bed && goTo(ch, bed.x + 0.6, bed.z, function (c) { c.life.t = 3 + Math.random() * 3; if (Math.random() < 0.4) say(c, pick(["Как самочувствие?", "Давление в норме.", "Выпишем к пятнице."]), 2.5); })) return;
      lf.t = 3; return;
    }
    if (lf.role === "courier") return courierNext(ch);
    lf.t = 5;
  }
  function goHome(ch) {
    var lf = ch.life, h = lf.home;
    occupy(ch, h);
    if (!goTo(ch, h.x, h.z, function (c) { sitAt(c, h); })) { sitAt(ch, h); setPos(ch, h.x, h.z, 0); }
  }
  function sitAt(ch, p) {
    var lf = ch.life, R = ROLE[lf.role] || ROLE.visitor;
    setPos(ch, p.x, p.z, 0);
    var sitting = p.kind === "desk" || p.kind === "sit" || p.kind === "sofa" || p.kind === "meet" || p.kind === "bed";
    ch.sit = sitting; lf.typing = p.kind === "desk";
    // лицом к столу (face: 1 — сидит со стороны +z комнаты и смотрит к −z): людям (fhumans) важно, куда сели
    if (sitting && p.face) { var w0 = W(p.x, p.z), w1 = W(p.x, p.z - p.face); ch._yaw = Math.atan2(w1.x - w0.x, w1.z - w0.z); }
    lf.t = (R.sit ? R.sit[0] + Math.random() * (R.sit[1] - R.sit[0]) : 8);
  }
  function arrive(ch) {
    var lf = ch.life, p = lf.at;
    if (!p) { lf.t = 2; return; }
    if (p.kind === "wc") { lf.hidden = 5 + Math.random() * 4; ch.visible = false; lf.t = 0; return; }
    if (p.seat) { sitAt(ch, p); lf.t = Math.min(lf.t, 6 + Math.random() * 8); }
    else { lf.t = 3 + Math.random() * 5; ch.sit = false; }
    var lines = USE_SAY[p.kind];
    if (lines && Math.random() < 0.45 && near(ch, 16)) say(ch, pick(lines), 2.4);
    // у кулера/кофемашины уже кто-то есть — болтают
    if ((p.kind === "cooler" || p.kind === "coffee") && p.users >= 2 && Math.random() < 0.6) {
      var other = L.npcs.filter(function (c) { return c !== ch && c.life && c.life.at === p && c.life.state !== "walk"; })[0];
      if (other) { var pair = pick(talkSet()); setTimeout(function () { if (ch.life) say(ch, pair[0], 2.6); }, 300); setTimeout(function () { if (other.life) say(other, pair[1], 2.6); }, 1900); lf.t += 3; }
    }
  }
  function near(ch, r) { var P = FC.player; return P && FC.dist2(ch.x, ch.z, P.x, P.z) < r * r; }
  function talkSet() {
    var B = L.B;
    if (L.event && TALK[L.event.kind]) return TALK[L.event.kind];
    if (B.type === "hq") return TALK.hq;
    if (B.type === "res") return TALK.res;
    if (B.zone) return TALK.zone;
    if (L.S.info && /lobby/.test(L.S.info.role || "")) return TALK.lobby;
    return TALK.office;
  }

  /* ---- курьер: приезжает на лифте, несёт коробку к столу, уезжает ------------------------------------------- */
  function courierNext(ch) {
    var lf = ch.life;
    if (!lf.delivered) {
      var desks = L.pois.filter(function (p) { return p.kind === "desk"; });
      var d = desks.length ? pick(desks) : null;
      if (d && goTo(ch, d.x + 0.6, d.z + 0.6, function (c) { c.life.delivered = true; c.life.t = 3; say(c, pick(["📦 Распишитесь!", "📦 Доставка!", "📦 Это вам."]), 2.6); })) return;
      lf.delivered = true;
    }
    leave(ch);
  }
  function elevPoint() { var e = L.S.plan.elev; return e ? { x: e.x, z: e.z } : null; }
  function leave(ch) {
    var e = elevPoint(); if (!e) { despawn(ch); return; }
    occupy(ch, null);
    if (!goTo(ch, e.x, e.z, function (c) { ding(); despawn(c); })) despawn(ch);
  }
  function ding() {
    var e = elevPoint(); if (!e) return;
    var w = W(e.x, e.z), P = FC.player, d = Math.hypot(w.x - P.x, w.z - P.z);
    if (FC.audio && d < 16) FC.audio.play("elevator", { vol: 0.5 * (1 - d / 16) });
    flashElevator();
  }
  function flashElevator() {
    var S = L.S, e = S.plan.elev; if (!e || !S.glowMesh || !L.glow0) return;
    // табло над лифтом вспыхивает — это ближайший к двери лифта светящийся элемент
    var best = -1, bd = 1e9;
    S.glowList.forEach(function (g, i) { var d = Math.hypot(g[0] - e.door.x, g[2] - e.door.z) + Math.abs(g[1] - 2.35); if (d < bd) { bd = d; best = i; } });
    if (best >= 0 && bd < 0.8) L.flash = { i: best, t: 1.2 };
  }
  // приехал на лифте: из двери на этаж
  // люди не стоят друг в друге: стоящих и идущих мягко расталкиваем (сидящие за столами и на лестнице — на месте)
  function separate(dt) {
    var A = L.npcs, R = 0.62, k = Math.min(1, dt * 6);
    for (var i = 0; i < A.length; i++) {
      var a = A[i]; if (!a.life || a.sit || a.life.state === "stairs" || a.life.hidden || a.lx == null) continue;
      for (var j = i + 1; j < A.length; j++) {
        var b = A[j]; if (!b.life || b.sit || b.life.state === "stairs" || b.life.hidden || b.lx == null) continue;
        var dx = b.lx - a.lx, dz = b.lz - a.lz, d = Math.hypot(dx, dz);
        if (d >= R) continue;
        if (d < 1e-3) { dx = Math.cos(i * 2.4); dz = Math.sin(i * 2.4); d = 1; }
        var push = (R - d) * 0.5 * k, ux = dx / d * push, uz = dz / d * push;
        var aFix = a.life.cluster || a.life.role === "guard", bFix = b.life.cluster || b.life.role === "guard";
        if (!aFix) nudge(a, a.lx - ux * (bFix ? 2 : 1), a.lz - uz * (bFix ? 2 : 1));
        if (!bFix) nudge(b, b.lx + ux * (aFix ? 2 : 1), b.lz + uz * (aFix ? 2 : 1));
      }
    }
  }
  function nudge(ch, lx, lz) {                                           // сдвиг без захода в стены и мебель
    var w = W(lx, lz), c = FC.inside.collide ? FC.inside.collide(w.x, w.z, 0.3) : w, l = FC.inside.toLocal(c.x, c.z);
    setPosC(ch, l.x, l.z);
  }
  var arrN = 0;
  function arrival(role, opt) {
    var e = elevPoint(); if (!e) return null;
    var off = ((arrN++ % 3) - 1) * 0.7;                                  // приехали вместе — встают в ряд, а не в одну точку
    var ch = spawn(role, e.x + off, e.z - 0.1 - Math.abs(off) * 0.3, Object.assign({ fade: true }, opt || {}));
    ding();
    ch.life.t = 0.2;
    return ch;
  }

  /* ---- лестница: NPC поднимаются и спускаются по маршам ------------------------------------------------------- */
  function stairPath(g, upward) {
    var a0 = g.z0 + g.Lf, a1 = g.z1 - g.Lb, FH = g.FH, xa = (g.x0 + g.sm) / 2, xb = (g.sm + g.x1) / 2;
    var pts = [{ x: xa, z: g.z0 - 0.5, h: 0 }, { x: xa, z: a0, h: 0 }, { x: xa, z: a1, h: FH / 2 }, { x: (g.x0 + g.x1) / 2, z: a1 + g.Lb / 2, h: FH / 2 },
      { x: xb, z: a1, h: FH / 2 }, { x: xb, z: a0 - 0.1, h: FH }];
    return upward ? pts : pts.reverse();
  }
  function stairStep(ch, dt) {
    var lf = ch.life, P = lf.spath, i = lf.pi, p = P[i];
    if (!p) { var done = lf.sdone; lf.state = "idle"; if (done) done(ch); return; }
    var dx = p.x - ch.lx, dz = p.z - ch.lz, d = Math.hypot(dx, dz), sp = 1.25;
    if (d < 0.08) { lf.pi++; return; }
    var k = Math.min(1, sp * dt / d), prev = P[i - 1] || p;
    setPos(ch, ch.lx + dx * k, ch.lz + dz * k, dt);
    var seg = Math.hypot(p.x - prev.x, p.z - prev.z) || 1, rest = Math.hypot(p.x - ch.lx, p.z - ch.lz);
    ch.y = L.S.y0 + prev.h + (p.h - prev.h) * (1 - rest / seg);
    ch.speed = sp; ch.sit = false;
  }
  function stairTraffic() {
    var g = L.S.stair; if (!g) return;
    if (g.up && Math.random() < 0.5) {
      // кто-то уходит наверх
      var cand = L.npcs.filter(function (c) { return c.life && (c.life.role === "visitor" || c.life.role === "worker") && c.life.state === "idle" && !c.life.cluster && !c.life.event; });
      var c0 = cand.length ? pick(cand) : null;
      if (c0) {
        var sp0 = stairPath(g, true);
        occupy(c0, null);
        goTo(c0, sp0[0].x, sp0[0].z, function (c) { c.life.state = "stairs"; c.life.spath = sp0; c.life.pi = 1; c.life.sdone = despawn; });
        return;
      }
    }
    // кто-то спускается сверху (или поднимается снизу) и идёт по делам
    var from = g.up ? stairPath(g, false) : null;
    if (!from) return;
    var ch = spawn(Math.random() < 0.7 ? "worker" : "visitor", from[0].x, from[0].z, { fade: true });
    ch.y = L.S.y0 + from[0].h;
    ch.life.state = "stairs"; ch.life.spath = from; ch.life.pi = 1;
    ch.life.sdone = function (c) { c.life.t = 0.1; };
    if (ch.life.role === "worker") { var d = freeDesk(); if (d) ch.life.home = d; }
  }
  function freeDesk() {
    var d = L.pois.filter(function (p) { return p.kind === "desk" && !p.taken && p.users === 0; });
    if (!d.length) return null;
    var p = pick(d); p.taken = true; return p;
  }

  /* ---- разговорные кучки ------------------------------------------------------------------------------------ */
  function makeCluster(lx, lz, n, kind) {
    var cl = { x: lx, z: lz, members: [], speaker: 0, t: 1 + Math.random(), lines: kind ? TALK[kind] : null };
    for (var i = 0; i < n; i++) {
      var a = i / n * Math.PI * 2 + Math.random() * 0.3, rr = 0.75 + n * 0.1;
      var px = lx + Math.cos(a) * rr, pz = lz + Math.sin(a) * rr;
      if (L.g[idx(px, pz)]) { var k = nearFree(px, pz, 3); if (k < 0) continue; px = cx(k); pz = cz(k); }
      var ch = spawn(kind === "party" ? "visitor" : "worker", px, pz);
      ch.life.cluster = cl; ch.cluster = true; ch.life.state = "talk";
      var w = W(lx, lz); ch._yaw = Math.atan2(w.x - ch.x, w.z - ch.z);
      cl.members.push(ch);
    }
    if (cl.members.length >= 2) L.clusters.push(cl);
    return cl;
  }
  function clusterTick(dt) {
    var t = performance.now() / 1000;
    L.clusters.forEach(function (cl) {
      cl.members = cl.members.filter(function (c) { return c.life; });
      if (cl.members.length < 2) return;
      cl.t -= dt;
      cl.members.forEach(function (c, i) {
        c.life.nod = i === cl.speaker;
        c.scale = 1.8 * (i === cl.speaker ? 1 + Math.sin(t * 28) * 0.015 : 1);   // говорящий чуть пульсирует
      });
      if (cl.t > 0) return;
      cl.t = 2 + Math.random() * 2;
      cl.speaker = (cl.speaker + 1 + Math.floor(Math.random() * (cl.members.length - 1))) % cl.members.length;
      if (!near(cl.members[0], 18)) return;
      var set = cl.lines || talkSet(), pair = pick(set), sp = cl.members[cl.speaker];
      say(sp, cl.pairStep ? pair[1] : pair[0], 2.5);
      cl.pairStep = !cl.pairStep;
      if (cl.event && cl.event.kind === "party" || cl.event && cl.event.kind === "birthday") confetti(cl.x, cl.z, 22);
    });
  }
  function confetti(lx, lz, n) {
    if (!FC.fx || !FC.fx.burst) return;
    var w = W(lx, lz);
    try { FC.fx.burst(w.x, L.S.y0 + 2.0, w.z, "confetti", n || 30); } catch (e) { /* эффект необязателен */ }
  }

  /* ---- события этажа ---------------------------------------------------------------------------------------- */
  var EV_NAME = { meeting: "📊 На этаже совещание", birthday: "🎂 На этаже день рождения!", pizza: "🍕 На этаже пицца-пати", release: "🔥 Аврал: «релиз горит»",
    standup: "🧍 Утренний стендап", party: "🎵 У соседей вечеринка" };
  function pickEvent(B, f, info) {
    var r = FC.rng(FC.hash(B.id + "|" + f + "|" + FC.clock.day + "|" + Math.floor(FC.clock.hour / 3), 5));
    if (info.hero === "party" || info.hero === "empty" || info.hero === "renovation") return null;
    var role = info.role || "";
    if (role === "apartments") return r() < 0.15 ? "party" : null;
    if (B.type === "hq" && role === "team") return r() < 0.5 ? pick(["standup", "release", "birthday", "pizza"], r) : null;
    if (/^(typical|office|team|zoneup)$/.test(role) || (B.zone && role === "hall")) {
      if (r() > 0.42) return null;
      var hasMeet = L.pois.filter(function (p) { return p.kind === "meet"; }).length >= 3;
      return pick(hasMeet ? ["meeting", "meeting", "birthday", "pizza", "release"] : ["birthday", "pizza", "release"], r);
    }
    return null;
  }
  function openSpot() {
    // самая просторная свободная точка: середина самой большой комнаты/зала
    var best = null, ba = 0;
    L.S.plan.rooms.forEach(function (o) { var a = (o.x1 - o.x0) * (o.z1 - o.z0); if (a > ba && o.type !== "wc" && o.type !== "storage") { ba = a; best = o; } });
    if (!best) return { x: 0, z: 0 };
    var k = nearFree((best.x0 + best.x1) / 2, (best.z0 + best.z1) / 2, 10);
    return k >= 0 ? { x: cx(k), z: cz(k) } : { x: (best.x0 + best.x1) / 2, z: (best.z0 + best.z1) / 2 };
  }
  var T3 = { cyl: new T.CylinderGeometry(1, 1, 1, 16), box: new T.BoxGeometry(1, 1, 1), sph: new T.SphereGeometry(1, 10, 8) };
  var M3 = {};
  function mat(hex, glow) { var k = hex + (glow ? "g" : ""); return M3[k] || (M3[k] = new T.MeshBasicMaterial({ color: hex })); }
  function prop(geo, hex, lx, y, lz, sx, sy, sz) {
    var w = W(lx, lz), m = new T.Mesh(geo, mat(hex));
    m.position.set(w.x, L.S.y0 + y, w.z); m.scale.set(sx, sy, sz);
    m.userData.life = true;
    if (L.S.group) L.S.group.parent.add(m);
    L.props.push(m);
    return m;
  }
  function startEvent(kind) {
    var sp = openSpot();
    L.event = { kind: kind, x: sp.x, z: sp.z, t: 0 };
    if (kind === "meeting") {
      var seats = L.pois.filter(function (p) { return p.kind === "meet"; }).slice(0, 7);
      seats.forEach(function (p) {
        var ch = spawn("worker", p.x, p.z); p.users++; ch.life.at = p; sitAt(ch, p); ch.life.t = 40 + Math.random() * 30; ch.life.event = true; ch.mute = true;
      });
      var room = seats[0] && seats[0].room;
      if (room) { var pr = spawn("manager", (room.x0 + room.x1) / 2, room.z0 + 0.9); pr.life.t = 1e9; pr.life.event = true; L.event.presenter = pr; }
      L.event.x = room ? (room.x0 + room.x1) / 2 : sp.x; L.event.z = room ? (room.z0 + room.z1) / 2 : sp.z;
    } else if (kind === "birthday" || kind === "party") {
      var cl = makeCluster(sp.x, sp.z, kind === "party" ? 5 : 6, "party"); cl.event = L.event;
      cl.members.forEach(function (c) { c.life.dance = kind === "party" || Math.random() < 0.4; });
      prop(T3.cyl, "#f4e1c1", sp.x, 0.8, sp.z, 0.35, 0.3, 0.35);           // торт
      prop(T3.cyl, "#ff6b9a", sp.x, 0.97, sp.z, 0.36, 0.04, 0.36);
      prop(T3.box, "#ffd23f", sp.x, 1.1, sp.z, 0.03, 0.18, 0.03);
      prop(T3.cyl, "#8a6a4a", sp.x, 0.33, sp.z, 0.5, 0.66, 0.5);          // столик
      ["#ff4d6d", "#4cc9f0", "#ffd23f", "#7dffb0", "#c86bff"].forEach(function (c, i) {   // шарики
        var a = i * 1.3; prop(T3.sph, c, sp.x + Math.cos(a) * 1.6, 2.2 + (i % 2) * 0.3, sp.z + Math.sin(a) * 1.6, 0.22, 0.27, 0.22);
      });
      L.event.party = true;
    } else if (kind === "pizza") {
      prop(T3.box, "#8a6a4a", sp.x, 0.37, sp.z, 1.8, 0.74, 0.9);
      for (var i = 0; i < 4; i++) prop(T3.box, i % 2 ? "#c9a46a" : "#e8c48a", sp.x - 0.6 + i * 0.4, 0.78 + (i % 2) * 0.05, sp.z, 0.36, 0.05, 0.36);
      var cp = makeCluster(sp.x, sp.z + 0.2, 5, "pizza"); cp.event = L.event;
    } else if (kind === "release") {
      L.event.red = true;
      for (var k = 0; k < 3; k++) { var c = spawn("manager", sp.x, sp.z); c.life.t = Math.random(); c.life.says = TALK.release; }
    } else if (kind === "standup") {
      var cs = makeCluster(sp.x, sp.z, 7, "standup"); cs.event = L.event;
    }
  }

  /* ---- живые агенты людей: где и на каком этаже -------------------------------------------------------------- */
  function assigned(B) {
    var list = FC.people && FC.people.insideOf ? FC.people.insideOf(B).slice() : [];
    list.sort(function (a, b) { return a.aid < b.aid ? -1 : 1; });
    var top = Math.max(1, B.floors);
    return list.map(function (ch, i) {
      var f;
      if (B.type === "res") f = top > 1 ? 1 + FC.hash(ch.aid, 17) % (top - 1) : 0;     // свой сид: дом выбран тем же хэшем
      else if (B.zone) f = Math.min(top - 1, Math.floor(i / 14));                  // зона: сначала зал первого этажа
      else f = FC.hash(ch.aid, 3) % Math.min(top, 3);                               // кафе и лобби рядом с зоной
      return { ch: ch, f: f };
    });
  }
  function floorCount(B, f) { return assigned(B).filter(function (a) { return a.f === f; }).length; }
  function seatReal(ch, S, walkIn) {
    var spot = ch.spot || (ch.state === "work" ? "work" : ch.state === "wait" ? "wait" : ch.state === "home" ? "home" : "lounge");
    var night = FC.clock.night > 0.6;
    var prefer = spot === "work" ? ["desk", "stand"] : spot === "wait" ? ["stand", "sit", "desk"] :
      spot === "home" ? (night ? ["bed", "sofa", "sit"] : ["sofa", "tv", "coffee", "sit", "bed"]) : ["coffee", "cooler", "sofa", "sit", "window"];
    var p = null;
    for (var i = 0; i < prefer.length && !p; i++) {
      var cands = L.pois.filter(function (q) { return q.kind === prefer[i] && q.users < q.cap && !(q.seat && q.taken); });
      if (cands.length) p = cands[FC.hash(ch.aid, i) % cands.length];
    }
    var lx, lz;
    if (p) { lx = p.x; lz = p.z; p.users++; if (p.seat) p.taken = true; }
    else { var o = openSpot(), k = nearFree(o.x + (FC.hash(ch.aid) % 5) - 2, o.z, 8); lx = k >= 0 ? cx(k) : o.x; lz = k >= 0 ? cz(k) : o.z; }
    FC.inside._seat(ch, W(lx, lz), true);
    S.seated.push(ch);
    ch.lx = lx; ch.lz = lz;
    ch.sit = !!(p && (p.kind === "desk" || p.kind === "sofa" || p.kind === "sit" || p.kind === "bed"));
    var typing = !!(p && p.kind === "desk");
    var base = ch.update, sitWant = ch.sit;
    // пришёл «на работу», пока игрок здесь: появляется из лифта (на первом этаже — с улицы) и идёт к своему месту
    if (walkIn) {
      var e = L.f === 0 && S.plan.exits.length ? S.plan.exits[0] : elevPoint();
      if (e) {
        var path = route(e.x, e.z + (e === S.plan.exits[0] ? 0.8 : 0), lx, lz);
        if (path) {
          ch.walkIn = path; ch.wi = 0; ch.sit = false; ch.alpha = 0;
          setPosC(ch, e.x, e.z);
          if (e !== S.plan.exits[0]) ding();
          if (near(ch, 18)) say(ch, ch.spot === "work" ? (FC.people.ICON[ch.zone] || "✨") + " Привет! За работу" : "👋 Привет!", 2.6, "busy");
        }
      }
    }
    ch.update = function (c, dt) {
      if (c.walkIn) {
        var q = c.walkIn[c.wi], dx = q.x - c.lx, dz = q.z - c.lz, d = Math.hypot(dx, dz);
        c.alpha = Math.min(1, (c.alpha || 0) + dt * 2.5);
        if (d < 0.12) { c.wi++; if (c.wi >= c.walkIn.length) { c.walkIn = null; c.sit = sitWant; } return; }
        var k = Math.min(1, 1.4 * dt / d), w0x = c.x, w0z = c.z;
        setPosC(c, c.lx + dx * k, c.lz + dz * k);
        c.vx = (c.x - w0x) / Math.max(dt, 1e-3); c.vz = (c.z - w0z) / Math.max(dt, 1e-3); c.speed = 1.4; c.y = S.y0;
        return;
      }
      if (c.walkOut) return walkOut(c, dt);
      base(c, dt);
      var t = performance.now() / 1000;
      c.lean = typing ? Math.sin(t * 9 + c.phase) * 0.025 : Math.sin(t * 1.4 + c.phase) * 0.02;
      faceNear(c, dt);
    };
  }
  function setPosC(c, lx, lz) { var w = W(lx, lz); c.lx = lx; c.lz = lz; c.x = w.x; c.z = w.z; }
  /* Настоящий агент закончил дело (сменилось состояние в ленте жителей) — встаёт и уходит в лифт (с первого — на улицу),
     дальше его ведёт fpeople: выходит из двери здания и идёт по своему новому делу. */
  function departReal(ch) {
    var S = L.S, e = L.f === 0 && S.plan.exits.length ? S.plan.exits[0] : elevPoint();
    ch.leaving = true; ch.sit = false;
    if (near(ch, 18)) say(ch, ch.nextGoal && ch.nextGoal.spot === "home" ? "🏠 Всё, я домой!" : ch.nextGoal && ch.nextGoal.spot === "lounge" ? "☕ Перерыв!" : "👋 Пока!", 2.6, "busy");
    var path = e ? route(ch.lx, ch.lz, e.x, e.z) : null;
    if (!path) { freeReal(ch); return; }
    ch.walkOut = path; ch.wo = 0; ch.outElev = e !== S.plan.exits[0];
  }
  function walkOut(c, dt) {
    var q = c.walkOut[c.wo], dx = q.x - c.lx, dz = q.z - c.lz, d = Math.hypot(dx, dz);
    if (d < 0.12) { c.wo++; if (c.wo >= c.walkOut.length) { if (c.outElev) ding(); freeReal(c); } return; }
    var k = Math.min(1, 1.5 * dt / d), w0x = c.x, w0z = c.z;
    setPosC(c, c.lx + dx * k, c.lz + dz * k);
    c.vx = (c.x - w0x) / Math.max(dt, 1e-3); c.vz = (c.z - w0z) / Math.max(dt, 1e-3); c.speed = 1.5; c.y = L.S.y0;
  }
  function freeReal(ch) {
    var S = L.S, i = S.seated.indexOf(ch);
    if (i >= 0) S.seated.splice(i, 1);
    if (ch._was) { ch.kind = ch._was.kind; ch.update = ch._was.update; delete ch._was; }
    ch.room = null; ch.seatAt = null; ch.y = 0.15; ch.ground = undefined; ch.realAgent = false; ch.sit = false; ch.lean = 0;
    ch.walkOut = null; ch.walkIn = null; ch.leaving = false;
    var g = ch.nextGoal; ch.nextGoal = null;
    if (g && FC.people.applyGoal) FC.people.applyGoal(ch, g, false);     // без нового дела — просто на другой этаж (остаётся внутри)
  }
  // кто из настоящих агентов должен быть на этом этаже: пришедших — из лифта, ушедших — в лифт
  function syncReal() {
    var S = L.S, B = L.B;
    if (!S || !B) return;
    var want = assigned(B).filter(function (a) {
      var g = a.ch.nextGoal;
      return a.f === L.f && !(g && (g.B !== B || g.mode !== "inside"));
    }).map(function (a) { return a.ch; });
    want.forEach(function (ch) { if (S.seated.indexOf(ch) < 0 && ch.room == null && ch.kind === "agent") seatReal(ch, S, true); });
    S.seated.slice().forEach(function (ch) { if (want.indexOf(ch) < 0 && !ch.leaving) departReal(ch); });
  }
  function faceNear(c, dt) {
    var P = FC.player; if (!P || c.speed > 0.2) return;
    var d2 = FC.dist2(c.x, c.z, P.x, P.z);
    if (d2 < 16) c._yaw = FC.angDamp(c._yaw || 0, Math.atan2(P.x - c.x, P.z - c.z), 4, dt);
  }

  /* ---- заселение этажа --------------------------------------------------------------------------------------- */
  function clearOwn() {
    (L.props || []).forEach(function (m) { if (m.parent) m.parent.remove(m); });
    L.props = []; L.npcs = []; L.clusters = []; L.event = null; L.flash = null; L.reception = null;
  }
  // свои люди здания от других модулей (fbiz.js: сотрудники бизнеса игрока): fn(B, f, api) → сколько заселил
  var hooks = [];
  var hookApi = {
    spawn: function (role, lx, lz, opt) { return spawn(role, lx, lz, opt); },
    seat: function (ch, p) { p.taken = true; ch.life.home = p; occupy(ch, p); sitAt(ch, p); },
    pois: function (kinds) { return L.pois.filter(function (p) { return kinds.indexOf(p.kind) >= 0 && !p.taken && p.users < p.cap; }); },
    near: function (lx, lz, R) { var k = nearFree(lx, lz, R || 6); return k >= 0 ? { x: cx(k), z: cz(k) } : null; },
    spot: function () { return openSpot(); }
  };
  function populate(B, f, ctx, S) {
    clearOwn();
    L.S = S; L.B = B; L.f = f; L.r = FC.rng(FC.hash(B.id + "~" + f, 9)); L.t = 0;
    var r = L.r, info = S.info || {}, role = info.role || "";
    buildGrid(S);
    buildPois(ctx, S, r);
    // 1) живые агенты этого этажа
    assigned(B).forEach(function (a) { if (a.f === f) seatReal(a.ch, S); });
    // 2) сотрудники из набора мебели (кассир, коп, медик, танцоры) — как задумал набор
    ctx.npcs.forEach(function (n) {
      var w = W(n.x, n.z), ch = FC.inside._spawn(n.cell != null ? n.cell : FC.people.randomCell(r), w, n);
      ch.lx = n.x; ch.lz = n.z;
      var base = ch.update;
      ch.update = function (c, dt) { base(c, dt); faceNear(c, dt); };
    });
    var extra = 0;
    hooks.forEach(function (fn) { try { extra += fn(B, f, hookApi) || 0; } catch (e) { if (global.console) console.error("FC.life hook", e); } });
    if (info.hero === "empty" || role === "vault") { lightsOn(S); return; }
    // 3) сколько ещё людей: по площади и типу этажа
    var area = S.W * S.D, have = S.seated.length + ctx.npcs.length + extra;
    var dens = role === "apartments" ? 46 : role === "roof" ? 120 : /hall/.test(role) && !B.zone ? 40 : 32;
    var lo = role === "roof" ? 2 : role === "apartments" ? 4 : 8, hi = role === "apartments" ? 14 : 25;
    var want = FC.clamp(Math.round(area / dens), lo, hi) - have;
    if (info.hero === "blackout") want = Math.min(want, 4);
    var mainRole = role === "apartments" || role === "lobbyres" ? "resident" : B.poi === "store" || B.poi === "gas" || B.biz ? "customer" :
      role === "wards" ? "visitor" : role === "roof" ? "visitor" : "worker";
    // ресепшн и охрана в лобби, у банка и штаба
    if (/^(lobby|lobbyhq|hall)$/.test(role) && f === 0 && (B.type === "office" || B.type === "hq" || B.poi === "bank" || B.poi === "hotel")) {
      var ex = S.plan.exits[0];
      if (ex) {
        var rk = nearFree(ex.x + 2.2, ex.z + 2.6, 5);
        if (rk >= 0) { var rc = spawn("visitor", cx(rk), cz(rk)); rc.life.t = 1e9; rc.line = ["Добро пожаловать!", "Лифт — прямо по коридору.", "Вам на какой этаж?"]; L.reception = rc; want--; }
        var gd = spawn("guard", ex.x - 1.8, ex.z + 2.0); gd.line = ["Пропуск, пожалуйста.", "Проходите.", "Всё спокойно."];
        gd.life.patrol = [{ x: ex.x - 1.8, z: ex.z + 2.0 }];
        if (S.plan.elev) gd.life.patrol.push({ x: S.plan.elev.x + 1.2, z: S.plan.elev.z - 0.5 });
        var po = openSpot(); gd.life.patrol.push(po);
        want--;
      }
    }
    if (role === "wards") { for (var dct = 0; dct < 2; dct++) { var dsp = openSpot(); spawn("doctor", dsp.x, dsp.z).line = ["Следующий!", "Не волнуйтесь."]; want--; } }
    // 4) люди с рутинами: сидят ~60%, ходят ~25%, кучки ~15%
    var desks = L.pois.filter(function (p) { return (p.kind === "desk" || (mainRole === "resident" && (p.kind === "sofa" || p.kind === "sit"))) && !p.taken; });
    var nClusterPeople = want >= 6 ? Math.round(want * 0.16) : 0;
    var nSit = Math.min(desks.length, Math.round((want - nClusterPeople) * 0.68));
    for (var i = 0; i < nSit; i++) {
      var d = desks.splice(Math.floor(r() * desks.length), 1)[0]; if (!d) break;
      d.taken = true;
      var ch = spawn(mainRole, d.x, d.z); ch.life.home = d; occupy(ch, d); sitAt(ch, d); ch.life.t = r() * 18 + 2;
    }
    var walkers = want - nSit - nClusterPeople;
    var wp = L.pois.filter(function (p) { return p.kind === "wander" || p.kind === "window" || p.kind === "shelf"; });
    for (var k = 0; k < walkers; k++) {
      var s0 = wp.length ? wp.splice(Math.floor(r() * wp.length), 1)[0] : openSpot();   // у каждого своя точка
      var rl = mainRole === "worker" ? (k === 0 && area > 250 ? "manager" : k === 1 && S.plan.corr.length && r() < 0.6 ? "cleaner" : "visitor") : mainRole;
      var cw = spawn(rl, s0.x, s0.z); cw.life.t = r() * 4;
      if (rl === "cleaner") { cw.line = ["🧹"]; }
    }
    if (nClusterPeople >= 2) {
      var sizes = nClusterPeople >= 6 ? [3, nClusterPeople - 3] : [nClusterPeople];
      sizes.forEach(function (n) {
        var spots = L.pois.filter(function (p) { return p.kind === "cooler" || p.kind === "coffee" || p.kind === "wander" || p.kind === "window"; });
        var s1 = spots.length ? spots[Math.floor(r() * spots.length)] : openSpot();
        makeCluster(s1.x, s1.z, Math.max(2, Math.min(4, n)));
      });
    }
    // 5) событие этажа
    var ev = pickEvent(B, f, info);
    if (ev) { startEvent(ev); setTimeout(function () { if (L.B === B && L.f === f && FC.hud) FC.hud.toast(EV_NAME[ev], "ok", 2.6); }, 900); }
    // 6) ресепшн встречает игрока
    var rc0 = L.reception;
    if (rc0) setTimeout(function () { if (L.B === B && L.f === f && L.npcs.indexOf(rc0) >= 0) say(rc0, "Добро пожаловать в «" + B.name.replace(/[«»]/g, "") + "»! 👋", 3.2); }, 700);
    L.elevT = 4 + r() * 6; L.stairT = 8 + r() * 10;
    lightsOn(S);
  }

  /* ---- свет: включается по очереди от игрока; мониторы мерцают; на вечеринке — цветной ---------------------- */
  function lightsOn(S) {
    L.glow0 = null; L.monitors = []; L.ceilings = []; L.lightT = 0;
    if (!S.glowMesh || !S.glowMesh.instanceColor) return;
    L.glow0 = Float32Array.from(S.glowMesh.instanceColor.array);
    var P = FC.player, pl = P ? Lc(P.x, P.z) : { x: 0, z: 0 };
    S.glowList.forEach(function (g, i) {
      if (g[4] <= 0.06 && g[1] > (S.ceil || 3) - 0.3 && S.ceil < 10) L.ceilings.push({ i: i, d: Math.hypot(g[0] - pl.x, g[2] - pl.z) });
      else if (g[4] > 0.2 && g[4] < 2.0 && g[1] > 0.6 && g[1] < 1.4) L.monitors.push(i);
    });
    L.ceilings.forEach(function (c) { setGlow(c.i, 0.08); });
    S.glowMesh.instanceColor.needsUpdate = true;
  }
  function setGlow(i, k, tint) {
    var a = L.S.glowMesh.instanceColor.array, b = L.glow0;
    a[i * 3] = b[i * 3] * k * (tint ? tint[0] : 1); a[i * 3 + 1] = b[i * 3 + 1] * k * (tint ? tint[1] : 1); a[i * 3 + 2] = b[i * 3 + 2] * k * (tint ? tint[2] : 1);
  }
  var hueC = new T.Color();
  function glowTick(dt) {
    var S = L.S; if (!S.glowMesh || !L.glow0 || !S.glowMesh.instanceColor) return;
    var dirty = false, t = performance.now() / 1000;
    L.lightT += dt;
    // «щёлк-щёлк»: светильники зажигаются волной от игрока, 7 м в секунду
    L.ceilings.forEach(function (c) {
      if (c.on) return;
      if (L.lightT * 7 > c.d) { c.on = true; setGlow(c.i, 1); dirty = true; if (c.d < 6 && FC.audio && Math.random() < 0.3) FC.audio.play("blip", { vol: 0.12 }); }
    });
    if (L.event && L.event.party && L.lightT > 2) {
      L.ceilings.forEach(function (c, k) { hueC.setHSL((t * 0.25 + k * 0.13) % 1, 0.9, 0.6); setGlow(c.i, 1.2, [hueC.r * 1.6, hueC.g * 1.6, hueC.b * 1.6]); });
      dirty = true;
    }
    L.flickT -= dt;
    if (L.flickT <= 0 && L.monitors.length) {
      L.flickT = 0.12;
      for (var n = 0; n < Math.min(5, L.monitors.length); n++) {
        var i = L.monitors[Math.floor(Math.random() * L.monitors.length)];
        if (L.event && L.event.red) setGlow(i, 0.8 + Math.random() * 0.5, Math.random() < 0.5 ? [2.2, 0.35, 0.3] : null);
        else setGlow(i, 0.6 + Math.random() * 0.55);
      }
      dirty = true;
    }
    if (L.flash) {
      L.flash.t -= dt;
      setGlow(L.flash.i, L.flash.t > 0 ? 1 + 1.5 * Math.abs(Math.sin(L.flash.t * 9)) : 1, L.flash.t > 0 ? [1.2, 1.6, 0.6] : null);
      if (L.flash.t <= 0) L.flash = null;
      dirty = true;
    }
    if (dirty) S.glowMesh.instanceColor.needsUpdate = true;
  }

  /* ---- лифт: попутчики игрока ------------------------------------------------------------------------------- */
  function boardElevator() {
    if (!L.S || !FC.inside.active) return [];
    var e = elevPoint(); if (!e) return [];
    var Wc = global.FC_SPECIES, out = [];
    var near = L.npcs.filter(function (c) { return c.life && !c.life.cluster && !c.life.event && Math.hypot(c.lx - e.x, c.lz - e.z) < 6 && c.life.role !== "guard"; });
    var extra = Math.floor(Math.random() * 3);
    var riders = near.slice(0, 3);
    L.riders = [];
    riders.forEach(function (c) { L.riders.push(c.cell); despawn(c); });
    for (var i = 0; i < extra && L.riders.length < 4; i++) L.riders.push(FC.people.randomCell(L.r));
    L.riders.forEach(function (cell) {
      var code = Wc && cell >= 0 && cell < 900 ? Wc.CRE[cell + 1] : null, m = code && Wc.META[code];
      out.push(m ? m[0] : "сосед");
    });
    return out;
  }
  function arriveElevator() {
    var cells = L.riders || []; L.riders = [];
    // половина выходит с игроком на этот этаж, остальные «поехали дальше»
    cells.forEach(function (cell, i) {
      if (i % 2) return;
      var ch = arrival(Math.random() < 0.6 ? "worker" : "visitor", { cell: cell });
      if (ch && ch.life.role === "worker") { var d = freeDesk(); if (d) ch.life.home = d; }
    });
  }

  /* ---- кадр ------------------------------------------------------------------------------------------------- */
  FC.addSystem({
    name: "life", order: 46,
    update: function (dt) {
      L.budget = 3;
      if (!FC.inside || !FC.inside.active || !L.S || !L.S.group || L.B !== FC.inside.building) return;
      L.t += dt;
      L.syncT = (L.syncT || 0) - dt;
      if (L.syncT <= 0) { L.syncT = 1.5; syncReal(); }
      clusterTick(dt);
      glowTick(dt);
      // лифт возит людей: кто-то уезжает, кто-то приезжает
      if (L.S.plan.elev && !L.S.plan.roof) {
        L.elevT -= dt;
        if (L.elevT <= 0) {
          L.elevT = 9 + Math.random() * 12;
          var idle = L.npcs.filter(function (c) { return c.life && c.life.state === "idle" && !c.life.cluster && !c.life.event && c.life.role !== "guard" && c.life.role !== "cleaner"; });
          if (idle.length > 5 && Math.random() < 0.5) leave(pick(idle));
          else if (L.npcs.length < 30) {
            var role = Math.random() < 0.22 ? "courier" : Math.random() < 0.5 ? "visitor" : "worker";
            var ch = arrival(role);
            if (ch && role === "courier") say(ch, "📦 Доставка!", 2.4);
            if (ch && role === "worker") { var d = freeDesk(); if (d) ch.life.home = d; }
          }
        }
      }
      if (L.S.stair) { L.stairT -= dt; if (L.stairT <= 0) { L.stairT = 16 + Math.random() * 18; stairTraffic(); } }
      // совещание: докладчик говорит
      if (L.event && L.event.presenter && L.event.presenter.life) {
        L.event.t -= dt;
        if (L.event.t <= 0) { L.event.t = 4 + Math.random() * 3; if (near(L.event.presenter, 18)) say(L.event.presenter, pick(TALK.meet)[Math.floor(Math.random() * 2)], 3); }
      }
      if (L.event && L.event.kind === "release") {
        L.event.t -= dt;
        if (L.event.t <= 0) { L.event.t = 3; var c = pick(L.npcs.filter(function (q) { return q.life && q.life.state === "walk"; }).concat([null])); if (c && near(c, 18)) say(c, pick(pick(TALK.release)), 2.2); }
      }
      // охрана и сотрудники у игрока поворачиваются к нему
      L.npcs.forEach(function (c) { if (c.life && c.life.state !== "walk") faceNear(c, dt); });
      separate(dt);
    }
  });
  FC.on("inside:exit", function () { clearOwn(); L.S = null; L.B = null; });

  FC.life = { populate: populate, floorCount: floorCount, boardElevator: boardElevator, arriveElevator: arriveElevator,
    // событие этажа по просьбе (сюжет, отладка): meeting | birthday | pizza | release | standup | party
    event: function (kind) { if (L.S && EV_NAME[kind]) { startEvent(kind); if (FC.hud) FC.hud.toast(EV_NAME[kind], "ok", 2.4); } },
    debug: function () { return { npcs: L.npcs.length, clusters: L.clusters.length, event: L.event && L.event.kind, pois: L.pois.length, grid: [L.nx, L.nz] }; } };
  FC.life.onPopulate = function (fn) { hooks.push(fn); };
})(window);
