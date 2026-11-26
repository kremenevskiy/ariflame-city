/* Флейм-Сити — аэропорт (FC.airport): самолёты на стоянке аэродрома угоняют, подойдя к борту, — и сразу на полосу.
 *
 * Задача (25.11.2026): «чтобы можно было на самолётах кататься и угонять их — люди писали в комментариях, что приехали
 * в аэропорт, а самолёты не работают». Летать самолёты умели (fair.js), не работал вход: у самого борта подсказки не
 * было. fair.js пускает в судно на палубе аэродрома только с двух точек у мостика (FC.air.board): во Флейм-Сити палуба
 * над морем и пешком до бортов не дойти, а его общий вход (airProvider) суда на палубе пропускает. В Минске та же палуба
 * лежит на земле Минска-1 (Мир-Сити): игрок доходит до самолёта — и ничего; а у мостика, где посадка, стоит старт
 * миссии «Прыжок» — её подсказка ближе и закрывает собой «Сесть в самолёт».
 *
 * Здесь, не трогая fair.js (только его API FC.air):
 *  - у самолёта на палубе — «F/🚗 — Угнать самолёт «…»» (свой или уже угнанный — «Сесть в самолёт»); вход — FC.air.enter:
 *    за угон +1★, строка в ленте, вертолёт патруля за летящим — как у всей авиации;
 *  - стоянки: у каждого самолёта своя дорожка разбега на запад — восточнее стоит, ближе к полосе; держи газ — взлетишь,
 *    никого не задев (раньше все три стояли в одну линию, и джет разбегался сквозь «Кукурузник»);
 *  - Минск: палуба — пол для героя и машин (FC.places.surfaceAt; раньше ноги по щиколотку в бетоне), деревья OSM с неё
 *    убраны (FC.places.keepClear; росли прямо на полосе), припаркованные машины дворов — с палубы за её край; вышел из
 *    самолёта на палубе — рядом с ним, а не у мостика;
 *  - телефон: в самолёте кнопка «газ меньше» снова ⏬ (fguns при выходе из режима «пешком» ставил на неё 👊), панель
 *    полёта на узком экране — в две строки (обрезалась с обоих краёв);
 *  - карта: самолёты — значки на миникарте и большой карте.
 * Палуба Флейм-Сити над морем — там по-прежнему садятся с мостика (вход fair.js).
 */
(function (global) {
  "use strict";
  var FC = global.FC, M = FC.map, AIR = FC.air;
  if (!AIR || !AIR.ground || !AIR.runway) return;

  /* ---- палуба аэродрома: границы fair.js держит у себя — находим края по FC.air.ground от середины полосы ------- */
  function edge(x, z, dx, dz) {
    var lo = 0, hi = 2500;
    for (var i = 0; i < 16; i++) { var m = (lo + hi) / 2; if (AIR.ground(x + dx * m, z + dz * m).deck) lo = m; else hi = m; }
    return lo;
  }
  var DK = (function () {
    var R = AIR.runway, cx = (R.x0 + R.x1) / 2, g = AIR.ground(cx, R.z);
    if (!g.deck) return null;
    return { x0: cx - edge(cx, R.z, -1, 0), x1: cx + edge(cx, R.z, 1, 0), z0: R.z - edge(cx, R.z, 0, -1), z1: R.z + edge(cx, R.z, 0, 1), y: g.h };
  })();
  if (!DK) return;
  // палуба на суше (Минск-1) — по ней ходят; над морем (Флейм-Сити) — нет
  var LAND = !M.water((DK.x0 + DK.x1) / 2, (DK.z0 + DK.z1) / 2);
  function onDeck(x, z, pad) { return x > DK.x0 - pad && x < DK.x1 + pad && z > DK.z0 - pad && z < DK.z1 + pad; }

  /* ---- Минск: палуба — пол, деревья с неё долой ---------------------------------------------------------------- */
  // fosm спрашивает FC.places.keepClear о каждом дереве при пересборке инстансов; герой (fmain) и машины (fcars) берут
  // высоту мощения из FC.places.surfaceAt — оборачиваем оба (сначала дешёвая проверка прямоугольника палубы)
  function wrapPlaces() {
    var Pl = FC.places;
    if (!LAND || !Pl || Pl._airport) return;
    Pl._airport = true;
    var sAt = Pl.surfaceAt, kc = Pl.keepClear;
    if (sAt) Pl.surfaceAt = function (x, z) { return onDeck(x, z, 0) ? DK.y + 0.02 : sAt.call(Pl, x, z); };
    Pl.keepClear = function (x, z) { return onDeck(x, z, 3) || (kc ? kc.call(Pl, x, z) : false); };
    if (FC.osm && FC.osm.propsDirty) FC.osm.propsDirty();
  }
  wrapPlaces();

  /* ---- стоянки: своя дорожка разбега у каждого --------------------------------------------------------------- */
  // fair.js ставит самолёты в линию поперёк палубы носом на запад (stockPlanes, пополняет их же); дорожки разводим по
  // югу: чем восточнее стоянка, тем ближе к полосе, шаг 11 м — больше суммы полуразмахов (5,25 + 4,5 м)
  var stands = [];
  function standOf(A) {
    if (A.kind !== "plane" || !A.home || stands.indexOf(A.home.x) >= 0) return;
    stands.push(A.home.x); stands.sort(function (a, b) { return a - b; });
  }
  function standLane(A) {
    if (A._port || A.kind !== "plane" || !A.home) return;
    A._port = true;
    if (A.player || !A.onGround || Math.abs(A.x - A.home.x) > 0.5 || Math.abs(A.z - A.home.z) > 0.5 || !onDeck(A.x, A.z, 0)) return;
    var z = Math.min(DK.z1 - 6, A.home.z + stands.indexOf(A.home.x) * 11);
    A.z = z; A.home.z = z; A.g.position.z = z; A.g.updateMatrix();
  }

  /* ---- Минск: машины дворов — не на полосе ------------------------------------------------------------------- */
  // fosm ставит припаркованные машины вдоль дворовых проездов Мир-Сити, а они лежат под палубой — машины вставали
  // поперёк дорожек разбега, и самолёт проезжал сквозь них. Такую машину (её место у fosm остаётся занятым, новая не
  // появится) переставляем рядком за северный край палубы, к мостику и вывеске; некуда — оставляем как есть
  function carFree(x, z) {
    if (Math.abs(x - AIR.board.x) < 9 || M.buildingAt(x, z, 1.5) || M.water(x, z)) return false;   // проход с мостика — свободен
    for (var i = 0; i < FC.cars.list.length; i++) { var o = FC.cars.list[i]; if (Math.abs(o.x - x) < 5 && Math.abs(o.z - z) < 3) return false; }
    return true;
  }
  function deckCars() {
    if (!LAND || !FC.cars || !FC.cars.list) return;
    for (var i = 0; i < FC.cars.list.length; i++) {
      var c = FC.cars.list[i];
      if (!c.parked || c.driver !== "none" || c._port || !onDeck(c.x, c.z, 1.5)) continue;
      c._port = true;
      var z = DK.z0 - 4, x = FC.clamp(c.x, DK.x0 + 6, DK.x1 - 6);
      for (var k = 0; k < 16 && !carFree(x, z); k++) x += (k % 2 ? -1 : 1) * 5.5 * (k + 1);    // 0, +5,5, −5,5, +11…
      if (!carFree(x, z)) continue;
      c.x = x; c.z = z; c.heading = Math.PI / 2; c.vx = c.vz = 0;
    }
  }

  /* ---- подойти к самолёту — «Угнать» ------------------------------------------------------------------------- */
  function free(A) {
    return A.kind === "plane" && A.onGround && !A.ai && !A.wrecked && !A.player && !A.mis && !A.abandoned && !A.sinking && !A.delivery;
  }
  // объект взаимодействия — один на самолёт (опрос 10 раз в секунду без выделений)
  function boardIt(A) {
    var it = A._portIt;
    if (!it) {
      it = A._portIt = { id: "airport_" + A.id, x: 0, z: 0, r: 9, key: "car", label: "", own: null,
        act: function () { if (free(A) && FC.player.mode === "foot") AIR.enter(A); } };
    }
    var own = !!(A.mine || A.stolen);
    if (it.own !== own || !it.label) { it.own = own; it.label = (own ? "✈ Сесть в самолёт " : "✈ Угнать самолёт ") + A.spec.name; }
    it.x = A.x; it.z = A.z;
    return it;
  }
  var found = [];
  function provider(px, pz, room) {
    found.length = 0;
    var P = FC.player;
    if (room != null || !P || P.mode !== "foot" || !onDeck(px, pz, 40)) return found;
    for (var i = 0; i < AIR.list.length; i++) {
      var A = AIR.list[i];
      if (!free(A) || !onDeck(A.x, A.z, 0)) continue;              // вне палубы самолёт берёт вход fair.js (airProvider)
      var dx = A.x - px, dz = A.z - pz;
      if (dx * dx + dz * dz < 81) found.push(boardIt(A));
    }
    return found;
  }

  /* ---- выход на палубе Минска — рядом с бортом ---------------------------------------------------------------- */
  // fair.js высаживает с палубы к мостику (во Флейм-Сити — с моря на пляж); на суше переносим к самолёту: у левого
  // борта, за крылом. Тот же кадр, после его перемещения (событие air:exit)
  FC.on("air:exit", function (e) {
    var A = e && e.air, P = FC.player, B = AIR.board;
    if (!LAND || !A || !P || A.kind !== "plane" || A.wrecked || !A.onGround || P.mode !== "foot") return;
    if (!onDeck(A.x, A.z, 0) || Math.abs(P.x - B.x) > 2 || Math.abs(P.z - B.z) > 2) return;
    var fx = Math.sin(A.yaw), fz = Math.cos(A.yaw), s = A.spec.jet ? 5.8 : 6.6;
    var x = A.x + fz * s, z = A.z - fx * s;
    if (!onDeck(x, z, 0)) { x = A.x - fz * s; z = A.z + fx * s; }
    P.x = x; P.z = z; P.y = DK.y + 0.02; P.vx = P.vz = 0; P.heading = A.yaw;
    if (FC.cam) FC.cam.snap = true;
  });

  /* ---- телефон: панель полёта и подписи кнопок ----------------------------------------------------------------- */
  // панель fair.js (#air-hud) — одной строкой ~520 px: на телефоне вертикально обрезалась с обоих краёв (высота и
  // «выйти» за экраном) — на узком экране переносим по частям, по центру
  FC.css("@media (max-width:600px){#air-hud{max-width:calc(100vw - 20px);box-sizing:border-box;flex-wrap:wrap;justify-content:center;" +
    "column-gap:6px;row-gap:1px;white-space:normal;font-size:12px;padding:5px 10px}}");
  // fguns (система 93) при смене «пешком/не пешком» ставит на кнопку удара 👊 — в самолёте это «газ меньше» (⏬),
  // в вертолёте «вниз» (⬇); у обеих иконка down. Сверяем раз в кадр по data-icon, DOM трогаем только при расхождении
  var punchEl = null;
  function touchLabels() {
    var I = FC.input, P = FC.player;
    if (!I.touch || !I.setButton || !P || P.mode !== "air" || !P.air) return;
    if (!punchEl) punchEl = document.querySelector("#pad .tbtn.b-punch");
    if (punchEl && punchEl.dataset.icon !== "down") I.setButton("punch", { label: P.air.kind === "plane" ? "⏬" : "⬇" });
  }

  /* ---- карта: самолёты на земле ------------------------------------------------------------------------------- */
  // миникарта — точка на каждом; большая карта вблизи — значок ✈ на каждом (без проверки «занято»: рядом со стоянкой
  // стоит значок миссии «Прыжок», он прятал бы самолёты); дальше — только ✈ полосы (его рисует fair.js)
  function mapLayer(c, k, mode) {
    var big = mode === "big";
    if (big && FC.hud.mapTier && FC.hud.mapTier(k) < 2) return;
    c.save();
    c.strokeStyle = "rgba(11,16,32,.85)"; c.lineWidth = 1.5 / k;
    c.font = "800 " + (11 / k) + "px system-ui"; c.textAlign = "center"; c.textBaseline = "middle";
    for (var i = 0; i < AIR.list.length; i++) {
      var A = AIR.list[i];
      if (!free(A)) continue;
      c.fillStyle = "#ffcf7a";
      c.beginPath(); c.arc(A.x, A.z, (big ? 8 : 5) / k, 0, 7); c.fill(); c.stroke();
      if (big) { c.fillStyle = "#0b1020"; c.fillText("✈", A.x, A.z); }
    }
    c.restore();
  }

  /* ---- система: после fguns (93) — подписи кнопок; раз в полсекунды — новые самолёты на стоянках ------------------- */
  var started = false, scanT = 0;
  FC.addSystem({
    name: "airport", order: 94,
    init: function () {
      if (started) return; started = true;
      wrapPlaces();                                   // FC.places грузится после fair.js — на случай другого порядка скриптов
      FC.interact.provider(provider);
      FC.hud.addMapLayer(mapLayer);
    },
    update: function (dt) {
      if (!started) return;
      touchLabels();
      scanT -= dt;
      if (scanT > 0) return;
      scanT = 0.5;
      var i;
      for (i = 0; i < AIR.list.length; i++) standOf(AIR.list[i]);      // сначала все стоянки — потом номер дорожки
      for (i = 0; i < AIR.list.length; i++) standLane(AIR.list[i]);
      deckCars();
    }
  });

  FC.airport = { deck: DK, land: LAND, onDeck: onDeck };
})(window);
