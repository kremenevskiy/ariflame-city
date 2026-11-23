/* Флейм-Сити — метро Минска (FC.metro): спуск на станцию, поезда по расписанию, поездка в вагоне по настоящей линии.
 *
 * Три линии в настоящем порядке станций (Московская, Автозаводская, Зеленолужская с продлением к «Минск-Миру»),
 * координаты станций и входы «М» — из данных Минска (flandmarks: FC.metroData). Вход у павильона «М» — «Спуститься»
 * (жетон $5): островная платформа под землёй, на путевых стенах — название по-белорусски и латиницей, цвет линии;
 * поезда в обе стороны раз в ~30 с: подходят, двери открываются, стоят, уходят в тоннель. Сел — вагон, тоннель с огнями
 * за окнами, объявления как в минском метро («Асцярожна, дзверы зачыняюцца. Наступная станцыя — …»), время в пути — по
 * расстоянию между станциями. Приехал — выходишь на платформу или едешь дальше; пересадки на трёх пересадочных узлах;
 * «Выйти в город» — к настоящему выходу этой станции.
 *
 * Под землёй игра — как внутри здания: модуль подменяет FC.inside своим (active, floorY, collide, clampCam, exit), поэтому
 * ходьба, камера и взаимодействия работают без особых случаев. Станция строится на глубине −40 м под своей точкой.
 * FC.metro: {active, enter(station|entrance), leave(), lines, stations}
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE, G = FC && FC.gfx;
  if (!FC || !T || !G || global.FC_CITY !== "minsk") return;

  /* ---- линии: порядок станций (как в метро), белорусские имена, пересадки ------------------------------------------ */
  var LINES = {
    blue: ["Малиновка", "Петровщина", "Михалово", "Грушевка", "Институт Культуры", "Площадь Ленина", "Октябрьская", "Площадь Победы",
      "Площадь Якуба Коласа", "Академия наук", "Парк Челюскинцев", "Московская", "Восток", "Борисовский тракт", "Уручье"],
    red: ["Каменная Горка", "Кунцевщина", "Спортивная", "Пушкинская", "Молодёжная", "Фрунзенская", "Немига", "Купаловская",
      "Первомайская", "Пролетарская", "Тракторный завод", "Партизанская", "Автозаводская", "Могилёвская"],
    green: ["Слуцкий Гостинец", "Неморшанский Сад", "Аэродромная", "Ковальская Слобода", "Вокзальная", "Площадь Франтишка Богушевича",
      "Юбилейная площадь"]
  };
  var LINE_NAME = { blue: "Маскоўская лінія", red: "Аўтазаводская лінія", green: "Зеленалужская лінія" };
  var HEX = { blue: "#2f6fd6", red: "#d9363e", green: "#2f9e5a" };
  var BY = {
    "Малиновка": "Малінаўка", "Петровщина": "Пятроўшчына", "Михалово": "Міхалова", "Грушевка": "Грушаўка", "Институт Культуры": "Інстытут культуры",
    "Площадь Ленина": "Плошча Леніна", "Октябрьская": "Кастрычніцкая", "Площадь Победы": "Плошча Перамогі", "Площадь Якуба Коласа": "Плошча Якуба Коласа",
    "Академия наук": "Акадэмія навук", "Парк Челюскинцев": "Парк Чалюскінцаў", "Московская": "Маскоўская", "Восток": "Усход",
    "Борисовский тракт": "Барысаўскі тракт", "Уручье": "Уручча", "Каменная Горка": "Каменная Горка", "Кунцевщина": "Кунцаўшчына",
    "Спортивная": "Спартыўная", "Пушкинская": "Пушкінская", "Молодёжная": "Маладзёжная", "Фрунзенская": "Фрунзенская", "Немига": "Няміга",
    "Купаловская": "Купалаўская", "Первомайская": "Першамайская", "Пролетарская": "Пралетарская", "Тракторный завод": "Трактарны завод",
    "Партизанская": "Партызанская", "Автозаводская": "Аўтазаводская", "Могилёвская": "Магілёўская", "Слуцкий Гостинец": "Слуцкі гасцінец",
    "Неморшанский Сад": "Немаршанскі сад", "Аэродромная": "Аэрадромная", "Ковальская Слобода": "Кавальская Слабада", "Вокзальная": "Вакзальная",
    "Площадь Франтишка Богушевича": "Плошча Францішка Багушэвіча", "Юбилейная площадь": "Юбілейная плошча"
  };
  var LAT = {
    "Малиновка": "Malinaŭka", "Петровщина": "Piatroŭščyna", "Михалово": "Michalova", "Грушевка": "Hruŝaŭka", "Институт Культуры": "Instytut kultury",
    "Площадь Ленина": "Plošča Lienina", "Октябрьская": "Kastryčnickaja", "Площадь Победы": "Plošča Pieramohi", "Площадь Якуба Коласа": "Plošča Jakuba Kolasa",
    "Академия наук": "Akademija navuk", "Парк Челюскинцев": "Park Čaliuskincaŭ", "Московская": "Maskoŭskaja", "Восток": "Uschod",
    "Борисовский тракт": "Barysaŭski trakt", "Уручье": "Uručča", "Каменная Горка": "Kamiennaja Horka", "Кунцевщина": "Kuncaŭščyna",
    "Спортивная": "Spartyŭnaja", "Пушкинская": "Puškinskaja", "Молодёжная": "Maladziožnaja", "Фрунзенская": "Frunzienskaja", "Немига": "Niamiha",
    "Купаловская": "Kupalaŭskaja", "Первомайская": "Pieršamajskaja", "Пролетарская": "Pralietarskaja", "Тракторный завод": "Traktarny zavod",
    "Партизанская": "Partyzanskaja", "Автозаводская": "Aŭtazavodskaja", "Могилёвская": "Mahilioŭskaja", "Слуцкий Гостинец": "Slucki hascinec",
    "Неморшанский Сад": "Niemaršanski sad", "Аэродромная": "Aeradromnaja", "Ковальская Слобода": "Kavaĺskaja Slabada", "Вокзальная": "Vakzaĺnaja",
    "Площадь Франтишка Богушевича": "Plošča Franciška Bahuševiča", "Юбилейная площадь": "Jubilejnaja plošča"
  };
  var XFER = { "Купаловская": "Октябрьская", "Октябрьская": "Купаловская", "Фрунзенская": "Юбилейная площадь", "Юбилейная площадь": "Фрунзенская",
    "Площадь Ленина": "Вокзальная", "Вокзальная": "Площадь Ленина" };
  function by(n) { return BY[n] || n; }

  var STN = {}, ready = false;
  function prep() {
    if (ready) return true;
    var d = FC.metroData && FC.metroData();
    if (!d || !d.st || !d.st.length) return false;
    d.st.forEach(function (s) { STN[s.name] = { name: s.name, x: s.x, z: s.z, ents: s.ents || [] }; });
    Object.keys(LINES).forEach(function (ln) {
      LINES[ln] = LINES[ln].filter(function (n) { return STN[n]; });       // станции, которых нет в данных, пропускаем
      LINES[ln].forEach(function (n, i) { STN[n].line = ln; STN[n].i = i; });
    });
    ready = true; return true;
  }
  function neighbor(st, dir) { var L = LINES[st.line], j = st.i + dir; return j >= 0 && j < L.length ? STN[L[j]] : null; }
  function terminal(st, dir) { var L = LINES[st.line]; return STN[dir > 0 ? L[L.length - 1] : L[0]]; }

  /* ---- сцена станции -------------------------------------------------------------------------------------------- */
  var Y0 = -40, PW = 5, TRK = 7.25, WALL = 10.2, HALF = 52, HC = 6.4;   // полуширина платформы, ось пути, стена, полудлина, свод
  var BED = 1.15, TUN = 170;                                           // пути ниже платформы на 1,15 м; тоннель за торцами
  var S = { active: false, mode: null, st: null, grp: null, ox: 0, oz: 0, c: 1, s: 0, cols: [], trains: [], acts: [], t: 0,
    ride: null, real: null, from: null, strip: null };
  function toW(lx, lz) { return { x: S.ox + lx * S.c + lz * S.s, z: S.oz - lx * S.s + lz * S.c }; }
  function toL(wx, wz) { var dx = wx - S.ox, dz = wz - S.oz; return { x: dx * S.c - dz * S.s, z: dx * S.s + dz * S.c }; }
  var MATS = {};
  function mat(hex, em, opt) {
    var k = hex + ":" + (em || 0) + (opt ? JSON.stringify(opt) : "");
    if (!MATS[k]) {
      // под землёй тумана города нет, свет станции свой — не от солнца (днём и ночью одинаково)
      var m = new T.MeshStandardMaterial(Object.assign({ color: hex, roughness: 0.7, metalness: 0.05, fog: false }, opt || {}));
      m.emissive = new T.Color(hex); m.emissiveIntensity = (em == null ? 0.45 : em) * 0.6;
      MATS[k] = m;
    }
    return MATS[k];
  }
  function box(g, w, h, d, x, y, z, m) {
    var o = new T.Mesh(new T.BoxGeometry(w, h, d), m); o.position.set(x, y + h / 2, z); o.castShadow = o.receiveShadow = false; g.add(o); return o;
  }
  function textTex(lines, bg, w, h) {
    var cv = document.createElement("canvas"); cv.width = w; cv.height = h; var c = cv.getContext("2d");
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    lines.forEach(function (L) { c.fillStyle = L.c || "#fff"; c.font = L.f; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(L.t, w / 2, L.y * h); });
    var t = new T.CanvasTexture(cv); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; return t;
  }
  function plane(g, w, h, x, y, z, ry, tex) {
    var m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: tex, toneMapped: false, fog: false }));
    m.position.set(x, y, z); m.rotation.y = ry; g.add(m); return m;
  }
  // облик станции: у каждой свой оттенок стен и колонн (по имени), цвет линии — полосы и знаки
  function look(st) {
    var h = FC.hash(st.name), pal = [["#d9d2c3", "#8c7a5b"], ["#e3e0da", "#5b6470"], ["#cfc6b6", "#7a5d48"], ["#dfe6ea", "#3e5566"], ["#e8dcc8", "#9a6b3f"], ["#d7dcd2", "#4f6b4f"]];
    var p = pal[h % pal.length];
    return { wall: p[0], col: p[1], floor: h % 2 ? "#8d8b86" : "#9a9184", line: HEX[st.line], round: h % 3 === 0 };
  }
  function buildStation(st) {
    var g = new T.Group(), L = look(st), line = HEX[st.line];
    var nb = neighbor(st, 1) || neighbor(st, -1), ang = 0;
    if (nb) { var dx = nb.x - st.x, dz = nb.z - st.z; ang = Math.atan2(dx, dz); if (!neighbor(st, 1)) ang += Math.PI; }
    S.ox = st.x; S.oz = st.z; S.c = Math.cos(ang); S.s = Math.sin(ang);
    g.position.set(st.x, Y0, st.z); g.rotation.y = ang;
    // платформа, пути, стены, свод
    box(g, PW * 2, 0.02, HALF * 2, 0, 0, 0, mat(L.floor, 0.35));
    box(g, 0.25, 0.03, HALF * 2, -PW + 0.3, 0.005, 0, mat("#e8c547", 0.6));     // жёлтая линия у края
    box(g, 0.25, 0.03, HALF * 2, PW - 0.3, 0.005, 0, mat("#e8c547", 0.6));
    [-1, 1].forEach(function (sd) {
      box(g, WALL - PW, 0.02, (HALF + TUN) * 2, sd * (PW + WALL) / 2, -1.15, 0, mat("#3a3631", 0.2));     // путевое ложе (и в тоннель)
      // тоннель за торцами станции: стены, низкий свод, кабели и редкие лампы — по нему можно пройти (и встретить поезд)
      [-1, 1].forEach(function (e) {
        var zc = e * (HALF + TUN / 2);
        box(g, 0.3, 4.6, TUN, sd * WALL, -1.15, zc, mat("#4a4640", 0.25));
        box(g, 0.3, 4.6, TUN, sd * (PW - 0.15), -1.15, zc, mat("#4a4640", 0.25));
        box(g, WALL - PW + 0.3, 0.3, TUN, sd * (PW + WALL) / 2, 3.45, zc, mat("#3d3a35", 0.2));
        box(g, 0.12, 0.1, TUN, sd * (WALL - 0.25), 1.6, zc, mat("#222", 0.1));
        box(g, 0.12, 0.1, TUN, sd * (WALL - 0.25), 1.9, zc, mat("#222", 0.1));
        for (var tz = HALF + 8; tz < HALF + TUN; tz += 14) box(g, 0.1, 0.18, 0.4, sd * (WALL - 0.3), 2.4, e * tz, mat("#ffe2a8", 2.4));
      });
      box(g, 0.1, 1.15, HALF * 2, sd * (PW + 0.05), -1.15, 0, mat("#5a5650", 0.3));                       // край платформы
      [-0.76, 0.76].forEach(function (r) { box(g, 0.08, 0.16, (HALF + TUN) * 2, sd * TRK + r, -1.13, 0, mat("#9a9a9a", 0.25, { metalness: 0.8 })); });
      box(g, 0.22, 0.12, (HALF + TUN) * 2, sd * (TRK + 1.55), -1.05, 0, mat("#6b5a3a", 0.25));          // контактный рельс
      box(g, 0.3, HC + 1.2, HALF * 2, sd * WALL, -1.15, 0, mat(L.wall, 0.5));                              // путевая стена
      box(g, 0.08, 0.55, HALF * 2, sd * (WALL - 0.17), 2.2, 0, mat(line, 0.7));                            // полоса линии
      // название станции на путевой стене — по-белорусски и латиницей, каждые 20 м
      var tex = textTex([{ t: by(st.name), f: "700 92px Oswald, 'Arial Narrow', sans-serif", y: 0.42 }, { t: LAT[st.name] || "", f: "500 40px system-ui, sans-serif", y: 0.82, c: "#e9eef5" }], line, 1024, 220);
      for (var z = -40; z <= 40; z += 20) plane(g, 6.2, 1.33, sd * (WALL - 0.2), 3.6, z, sd > 0 ? -Math.PI / 2 : Math.PI / 2, tex);
    });
    box(g, WALL * 2 + 0.4, 0.3, HALF * 2, 0, HC, 0, mat(L.wall, 0.45));                                      // потолок
    // колонны и светильники
    for (var z2 = -45; z2 <= 45; z2 += 6) [-1, 1].forEach(function (sd) {
      var c = L.round ? new T.Mesh(new T.CylinderGeometry(0.42, 0.42, HC, 14), mat(L.col, 0.45)) : null;
      if (c) { c.position.set(sd * 3.1, HC / 2, z2); g.add(c); } else box(g, 0.8, HC, 0.8, sd * 3.1, 0, z2, mat(L.col, 0.45));
      box(g, 1.6, 0.08, 0.5, sd * 1.4, HC - 0.4, z2 + 3, mat("#fff6e0", 2.6));
      box(g, 0.12, 0.12, 3.2, sd * (WALL - 0.4), HC - 0.9, z2 + 3, mat("#ffe8c0", 2.2));
      S.cols.push([sd * 3.1, z2, 0.55]);
    });
    // торцы: выход в город (лестница вверх) и тупик / переход
    box(g, PW * 2, HC, 0.4, 0, 0, -HALF, mat(L.wall, 0.4));
    box(g, PW * 2, HC, 0.4, 0, 0, HALF, mat(L.wall, 0.4));
    for (var k = 0; k < 9; k++) box(g, 4.6, 0.32 * (k + 1), 0.5, 0, 0, -HALF + 1.2 + k * 0.5, mat("#77736c", 0.35));   // ступени выхода
    var exitT = textTex([{ t: "Выхад у горад", f: "700 64px Oswald, 'Arial Narrow', sans-serif", y: 0.38 }, { t: "Выход в город · Exit", f: "500 36px system-ui", y: 0.78 }], "#1d2a3a", 768, 180);
    plane(g, 3.6, 0.85, 0, 4.4, -HALF + 0.3, 0, exitT);
    var x = XFER[st.name];
    if (x && STN[x]) {
      var xt = textTex([{ t: "Пераход на «" + by(x) + "»", f: "700 54px Oswald, 'Arial Narrow', sans-serif", y: 0.42 }, { t: LINE_NAME[STN[x].line], f: "500 34px system-ui", y: 0.8 }], HEX[STN[x].line], 900, 180);
      plane(g, 4.2, 0.84, 0, 4.4, HALF - 0.3, Math.PI, xt);
      for (var k2 = 0; k2 < 9; k2++) box(g, 4.6, 0.32 * (k2 + 1), 0.5, 0, 0, HALF - 1.2 - k2 * 0.5, mat("#77736c", 0.35));
    }
    // указатели над платформой: куда идут поезда с каждого пути
    [-1, 1].forEach(function (sd) {
      var dir = sd > 0 ? 1 : -1, nx = neighbor(st, dir), tm = terminal(st, dir);
      if (!nx) return;
      var tt = textTex([{ t: "→ " + by(tm.name), f: "700 60px Oswald, 'Arial Narrow', sans-serif", y: 0.4 }, { t: "наступная: " + by(nx.name), f: "500 34px system-ui", y: 0.8, c: "#dfe7f2" }], "#18202c", 900, 170);
      [-20, 20].forEach(function (zz) { plane(g, 3.4, 0.64, sd * 2.2, 4.8, zz, sd > 0 ? -Math.PI / 2 : Math.PI / 2, tt); });
    });
    // часы-интервалы над тоннелями, как в минском метро: красные цифры — время и сколько прошло с последнего поезда
    S.clocks = [];
    [-1, 1].forEach(function (e) {
      var cv = document.createElement("canvas"); cv.width = 512; cv.height = 128;
      var tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace;
      var m = new T.Mesh(new T.PlaneGeometry(2.6, 0.65), new T.MeshBasicMaterial({ map: tex, toneMapped: false, fog: false }));
      m.position.set(0, HC - 1.0, e * (HALF - 0.6)); m.rotation.y = e > 0 ? Math.PI : 0; g.add(m);
      S.clocks.push({ cv: cv, tex: tex, end: e });
    });
    G.add(g);
    return g;
  }
  var clockT = 0;
  function drawClocks(dt) {
    clockT -= dt; if (clockT > 0 || !S.clocks) return; clockT = 0.5;
    var h = FC.clock ? FC.clock.hour : 12, mm = FC.clock && FC.clock.minute != null ? FC.clock.minute : Math.floor((h % 1) * 60);
    S.clocks.forEach(function (ck) {
      // интервал — по поезду, который уходит в сторону этого торца
      var tr = S.trains.filter(function (t) { return t.dir === ck.end; })[0], since = 0;
      if (tr) { var ph = ((S.t + tr.off) % INTERVAL + INTERVAL) % INTERVAL; since = ph < APPROACH + DWELL ? ph + INTERVAL - APPROACH - DWELL : ph - APPROACH - DWELL; }
      var c = ck.cv.getContext("2d"); c.fillStyle = "#0b0b0d"; c.fillRect(0, 0, 512, 128);
      c.font = "700 84px 'Courier New', monospace"; c.textBaseline = "middle"; c.fillStyle = "#ff2a1a"; c.shadowColor = "#ff2a1a"; c.shadowBlur = 14;
      var hh = String(Math.floor(h) % 24).padStart(2, "0"), m2 = String(Math.floor(mm) % 60).padStart(2, "0");
      c.textAlign = "left"; c.fillText(hh + ":" + m2, 20, 68);
      c.textAlign = "right"; c.fillText("0:" + String(Math.floor(since * 2) % 60).padStart(2, "0"), 492, 68);
      ck.tex.needsUpdate = true;
    });
  }

  /* ---- поезда ----------------------------------------------------------------------------------------------------- */
  var CAR = 19.2, NCAR = 4, TL = CAR * NCAR, INTERVAL = 30, APPROACH = 7, DWELL = 13, LEAVE = 7;
  function buildTrain(line) {
    // минские поезда — синие: кузов синий, светлая полоса под окнами, тонкая полоса цвета линии
    var g = new T.Group(), body = mat("#2a5aa8", 0.4, { metalness: 0.35, roughness: 0.45 }), stripe = mat("#e8eef6", 0.6), glass = mat("#141c2a", 0.25);
    var lineM = mat(HEX[line], 0.8);
    var doors = [];
    for (var i = 0; i < NCAR; i++) {
      var cz = -TL / 2 + CAR / 2 + i * CAR;
      box(g, 2.7, 3.0, CAR - 0.4, 0, -0.9, cz, body);
      box(g, 2.72, 0.32, CAR - 0.4, 0, 0.05, cz, stripe);
      box(g, 2.74, 0.08, CAR - 0.4, 0, -0.5, cz, lineM);
      box(g, 2.74, 0.85, CAR - 1.2, 0, 0.75, cz, glass);
      box(g, 2.6, 0.05, CAR - 1.0, 0, 1.75, cz, mat("#fff1d6", 1.6));          // свет в салоне виден в окнах
      for (var d = 0; d < 4; d++) {
        var dz = cz - CAR / 2 + 2.6 + d * ((CAR - 5.2) / 3);
        [-1, 1].forEach(function (sd) {
          var dl = box(g, 0.06, 1.95, 0.65, sd * 1.37, -0.85, dz - 0.33, mat("#24508f", 0.45)), dr = box(g, 0.06, 1.95, 0.65, sd * 1.37, -0.85, dz + 0.33, mat("#24508f", 0.45));
          doors.push({ l: dl, r: dr, z: dz, sd: sd });
        });
      }
    }
    // кабины: тёмное лобовое стекло и фары
    [-1, 1].forEach(function (e) {
      box(g, 2.6, 1.1, 0.1, 0, 0.5, e * (TL / 2 - 0.15), mat("#0d1118", 0.2));
      [-0.9, 0.9].forEach(function (hx) { box(g, 0.3, 0.18, 0.06, hx, -0.4, e * (TL / 2 - 0.12), mat("#fffbe8", 2.2)); });
    });
    g.userData.doors = doors;
    return g;
  }
  function trainAt(tr, t) {
    // фаза цикла: подход (тормозит к z=0), стоянка, уход (разгон); вне цикла — поезда нет
    var ph = ((t + tr.off) % INTERVAL + INTERVAL) % INTERVAL, dir = tr.dir, z, open = 0, vis = true;
    if (ph < APPROACH) { var k = 1 - ph / APPROACH; z = -dir * 160 * k * k; }
    else if (ph < APPROACH + DWELL) { z = 0; var q = ph - APPROACH; open = Math.min(1, q / 1.2, (DWELL - q) / 1.2); }
    else if (ph < APPROACH + DWELL + LEAVE) { var u = (ph - APPROACH - DWELL) / LEAVE; z = dir * 170 * u * u; }
    else { vis = false; z = dir * 400; }
    return { z: z, open: Math.max(0, open), vis: vis, dwell: ph >= APPROACH && ph < APPROACH + DWELL, left: APPROACH + DWELL - ph };
  }
  function placeTrain(tr, st) {
    tr.g.visible = st.vis; tr.g.position.set(tr.x, Y0, st.z);
    tr.g.userData.doors.forEach(function (d) {
      if (d.sd * tr.x < 0) { d.l.position.z = d.z - 0.33 - st.open * 0.62; d.r.position.z = d.z + 0.33 + st.open * 0.62; }   // открываются к платформе
    });
  }

  /* ---- вход, платформа, поездка ----------------------------------------------------------------------------------- */
  var shim = {
    active: true, building: { id: "metro", name: "Метро" }, floor: 0, spots: null,
    floorY: function () {
      if (S.mode === "ride" || !FC.player) return Y0;
      var p = toL(FC.player.x, FC.player.z);
      return onPlatform(p.x, p.z) ? Y0 : Y0 - BED;
    },
    collide: function (wx, wz, r) {
      var p = toL(wx, wz), x = p.x, z = p.z, hit = false, P = FC.player;
      var low = P && P.y < Y0 - 0.3, zEnd = HALF - (XFER[S.st && S.st.name] ? 6.2 : 1.0);
      if (!low || P.y >= Y0 - 0.15) {
        // на платформе (или запрыгиваешь на неё): стены, торцы; через край — можно, упадёшь на пути
        x = FC.clamp(x, -(WALL - 0.4), WALL - 0.4);
        if (Math.abs(x) < PW) { if (z < -HALF + 6.2) { z = -HALF + 6.2; hit = true; } if (z > zEnd) { z = zEnd; hit = true; } }
        else if (Math.abs(z) > HALF + TUN - 2) { z = FC.clamp(z, -(HALF + TUN - 2), HALF + TUN - 2); hit = true; }
        if (Math.abs(x) < PW) for (var i = 0; i < S.cols.length; i++) {
          var c = S.cols[i], ex = x - c[0], ez = z - c[1], e = Math.hypot(ex, ez), R = c[2] + r;
          if (e < R && e > 1e-4) { x = c[0] + ex / e * R; z = c[1] + ez / e * R; hit = true; }
        }
      } else {
        // на путях: стена тоннеля и край платформы (выше пояса — только прыжком), вдоль — до конца тоннеля
        var sd = x >= 0 ? 1 : -1, ax = Math.abs(x);
        if (ax < PW + r) { ax = PW + r; hit = true; }
        if (ax > WALL - 0.4) { ax = WALL - 0.4; hit = true; }
        x = sd * ax;
        if (Math.abs(z) > HALF + TUN - 2) { z = FC.clamp(z, -(HALF + TUN - 2), HALF + TUN - 2); hit = true; }
      }
      var w = toW(x, z); return { x: w.x, z: w.z, hit: hit };
    },
    clampCam: function (fx, fy, fz, tx, ty, tz) {
      var p = toL(tx, tz), ride = S.mode === "ride";
      var x = ride ? FC.clamp(p.x, -1.1, 1.1) : FC.clamp(p.x, -WALL + 0.6, WALL - 0.6), z = ride ? FC.clamp(p.z, -8.6, 8.6) : FC.clamp(p.z, -(HALF + TUN - 1), HALF + TUN - 1);
      if (!ride && Math.abs(z) > HALF - 0.8 && Math.abs(x) < PW) x = (x >= 0 ? 1 : -1) * PW;             // в тоннеле — над путём
      var w = toW(x, z);
      var fl = shim.floorY(), top = ride ? Y0 + 2.05 : Math.abs(p.z) > HALF ? Y0 + 3.2 : Y0 + HC - 0.4;
      return { x: w.x, y: FC.clamp(ty, fl + 0.8, top), z: w.z };
    },
    exit: function () { leave(); }, enter: function () {}, go: function () {}, label: function () { return S.st ? "Метро «" + S.st.name + "»" : "Метро"; }
  };
  function stripHtml(st, next) {
    var L = LINES[st.line], line = HEX[st.line];
    return "<div class='mt-line' style='--ln:" + line + "'><b>" + LINE_NAME[st.line] + "</b><span>" +
      L.map(function (n) { return "<i class='" + (n === st.name ? "here" : next && n === next.name ? "next" : "") + "' title='" + by(n) + "'></i>"; }).join("") +
      "</span><em>" + (next ? "Наступная: «" + by(next.name) + "»" : "Станцыя «" + by(st.name) + "»") + "</em></div>";
  }
  var CSS = ".mt-line{position:fixed;left:50%;top:calc(10px + var(--safe-t,0px));transform:translateX(-50%);z-index:9;background:rgba(12,16,26,.82);" +
    "border:1px solid rgba(255,255,255,.18);border-radius:12px;padding:7px 12px;color:#fff;font:600 13px system-ui;text-align:center;pointer-events:none;max-width:92vw}" +
    ".mt-line b{display:block;font:600 12px system-ui;opacity:.8}.mt-line span{display:flex;gap:3px;justify-content:center;margin:5px 0 4px;flex-wrap:wrap}" +
    ".mt-line i{width:12px;height:6px;border-radius:3px;background:var(--ln);opacity:.35}.mt-line i.here{opacity:1;width:20px;box-shadow:0 0 8px var(--ln)}" +
    ".mt-line i.next{opacity:.8;outline:1px solid #fff}.mt-line em{font-style:normal;font-size:14px}";
  var cssOn = false;
  function strip(next) {
    if (!cssOn) { var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st); cssOn = true; }
    if (!S.strip) { S.strip = document.createElement("div"); document.body.appendChild(S.strip); }
    S.strip.innerHTML = stripHtml(S.st, next);
  }
  function say(be, ru, sec) { if (FC.hud) FC.hud.toast("🔊 " + be + (ru ? " — " + ru : ""), "", sec || 4); if (FC.audio) FC.audio.play("note", { vol: 0.7 }); }
  function drop(o) {
    if (!o) return;
    if (o.parent) o.parent.remove(o);
    o.traverse(function (q) { if (q.geometry) q.geometry.dispose(); if (q.material && q.material.map) q.material.map.dispose(); });
  }
  function clearScene() {
    drop(S.grp);
    S.trains.forEach(function (tr) { drop(tr.holder); });
    S.grp = null; S.trains = []; S.cols = []; tunnelLights = null;
  }
  // поставить игрока точно в точку станции (P.teleport сдвигает от домов наверху — под землёй это не нужно)
  function put(x, z, h) {
    var P = FC.player; P.teleport(x, z, h); P.x = x; P.z = z; P.y = Y0; P.vx = P.vz = 0;
  }
  function openStation(st, arriving) {
    clearScene();
    S.st = st; S.mode = "station"; shim.building.name = "Метро «" + st.name + "»";
    S.grp = buildStation(st);
    [-1, 1].forEach(function (sd) {
      var dir = sd > 0 ? 1 : -1; if (!neighbor(st, dir)) return;
      var g = buildTrain(st.line); g.position.set(sd * TRK, Y0, 0);
      var holder = new T.Group(); holder.position.set(st.x, 0, st.z); holder.rotation.y = Math.atan2(S.s, S.c); holder.add(g); G.add(holder);
      S.trains.push({ g: g, holder: holder, x: sd * TRK, dir: dir, off: sd > 0 ? 0 : INTERVAL / 2 });
    });
    // переносим holder-ы в общий список для очистки
    strip(null);
    if (arriving) {
      // приехали: поезд стоит у платформы с открытыми дверями, игрок выходит у двери
      var tr = S.trains.filter(function (t) { return t.dir === arriving.dir; })[0];
      if (tr) tr.off = APPROACH + 1.5 - S.t;                       // фаза «двери открываются» — прямо сейчас
      var spot = toW(arriving.dir > 0 ? PW - 1.2 : -PW + 1.2, 0);
      put(spot.x, spot.z, Math.atan2(S.s, S.c) + (arriving.dir > 0 ? -Math.PI / 2 : Math.PI / 2));
      say("Станцыя «" + by(st.name) + "».", XFER[st.name] ? "Пераход на станцыю «" + by(XFER[st.name]) + "»" : "", 4);
    } else {
      var p = toW(0, -HALF + 7.5);
      put(p.x, p.z, Math.atan2(S.s, S.c));
    }
  }
  function enter(target) {
    if (!prep()) { if (FC.hud) FC.hud.toast("Метро ещё не готово — попробуй через пару секунд", "bad", 2); return; }
    var name = target.st ? target.st.name : target.name, st = STN[name];
    if (!st || !st.line) { if (FC.hud) FC.hud.toast("Эта станция пока закрыта", "bad", 2); return; }
    if (FC.save && FC.save.money < 5) { if (FC.hud) FC.hud.toast("Жетон стоит $5 — не хватает денег", "bad", 3); return; }
    var P = FC.player; if (!P || P.mode !== "foot") return;
    FC.money(-5, "метро: жетон");
    S.from = { x: P.x, z: P.z };
    document.body.classList.add("warp");
    setTimeout(function () {
      if (FC.inside && FC.inside.active && FC.inside !== shim) FC.inside.exit(true);
      S.real = FC.inside; FC.inside = shim; S.active = true;
      openStation(st, null);
      if (FC.cam) FC.cam.snap = true;
      document.body.classList.remove("warp");
      say("Станцыя «" + by(st.name) + "»", "Поезд в обе стороны — раз в полминуты. Подойди к дверям, когда откроются (E)", 5);
      FC.emit("metro:enter", { st: st.name });
    }, 260);
  }
  function leave(toSurface) {
    if (!S.active) return;
    var st = S.st, P = FC.player;
    clearScene();
    if (S.strip) { S.strip.remove(); S.strip = null; }
    FC.inside = S.real || FC.inside; S.active = false; S.mode = null; S.ride = null;
    var e = st && st.ents && st.ents.length ? st.ents[Math.floor(Math.random() * st.ents.length)] : st;
    var dx = e.x - st.x, dz = e.z - st.z, dl = Math.hypot(dx, dz) || 1;
    var x = e.x + dx / dl * 6, z = e.z + dz / dl * 6;
    P.teleport(x, z, Math.atan2(dx, dz)); P.y = 0.2;
    if (FC.cam) FC.cam.snap = true;
    if (toSurface !== false && FC.hud) FC.hud.toast("🚇 Выход — «" + st.name + "»", "ok", 2.5);
    FC.emit("metro:exit", { st: st.name });
  }
  function board(tr) {
    var nx = neighbor(S.st, tr.dir); if (!nx) return;
    var d = Math.hypot(nx.x - S.st.x, nx.z - S.st.z), dur = FC.clamp(d / 26, 14, 40);
    S.mode = "ride"; S.ride = { dir: tr.dir, to: nx, t: 0, dur: dur, said: false };
    clearScene();
    S.grp = buildCarriage(S.st.line);
    var p = toW(0, 0); put(p.x, p.z, Math.atan2(S.s, S.c));
    strip(nx);
    say("Асцярожна, дзверы зачыняюцца. Наступная станцыя — «" + by(nx.name) + "».", "Осторожно, двери закрываются. Следующая — «" + nx.name + "»", 5);
    FC.emit("metro:ride", { from: S.st.name, to: nx.name });
  }
  // вагон изнутри: сиденья вдоль бортов, поручни, свет; за окнами — тоннель с огнями
  var tunnelLights = null;
  function buildCarriage(line) {
    var g = new T.Group(), W2 = 1.3, L2 = 9;
    g.position.set(S.ox, Y0, S.oz); g.rotation.y = Math.atan2(S.s, S.c);
    box(g, W2 * 2, 0.02, L2 * 2, 0, 0, 0, mat("#5d5a55", 0.3));
    box(g, W2 * 2, 0.1, L2 * 2, 0, 2.25, 0, mat("#eef0f2", 0.7));
    box(g, 2.2, 0.04, L2 * 2 - 1, 0, 2.2, 0, mat("#fff4dc", 1.5));
    [-1, 1].forEach(function (sd) {
      box(g, 0.08, 0.95, L2 * 2, sd * W2, 0, 0, mat("#c8ccd2", 0.45));
      box(g, 0.08, 0.35, L2 * 2, sd * W2, 1.85, 0, mat("#c8ccd2", 0.45));
      box(g, 0.02, 0.9, L2 * 2, sd * (W2 + 0.02), 0.95, 0, mat("#05070b", 0.05));              // окна: темнота тоннеля
      box(g, 0.5, 0.45, L2 * 2 - 3, sd * (W2 - 0.3), 0, 0, mat(line, 0.35));                     // сиденья в цвет линии
      box(g, 0.06, 0.5, L2 * 2 - 3, sd * (W2 - 0.05), 0.45, 0, mat(line, 0.3));
    });
    for (var z = -L2 + 1.5; z < L2; z += 3) [-0.55, 0.55].forEach(function (x) { var p = new T.Mesh(new T.CylinderGeometry(0.025, 0.025, 2.25, 6), mat("#d9dde2", 0.5, { metalness: 0.8 })); p.position.set(x, 1.12, z); g.add(p); });
    box(g, W2 * 2, 2.3, 0.1, 0, 0, -L2, mat("#c8ccd2", 0.45)); box(g, W2 * 2, 2.3, 0.1, 0, 0, L2, mat("#c8ccd2", 0.45));
    // огни тоннеля за окнами: бегут назад
    var lg = new T.InstancedMesh(new T.BoxGeometry(0.06, 0.12, 0.5), mat("#ffe2a8", 2.5), 40);
    for (var i = 0; i < 40; i++) { tmpM.makeTranslation((i % 2 ? 1 : -1) * (W2 + 0.9), 1.25 + (i % 3) * 0.1, -L2 + (i / 2 | 0) * 2.2); lg.setMatrixAt(i, tmpM); }
    g.add(lg); tunnelLights = lg;
    S.cols = [];
    G.add(g);
    return g;
  }
  var tmpM = new T.Matrix4();
  function rideStep(dt) {
    var R = S.ride; R.t += dt;
    var v = Math.min(1, R.t / 5, (R.dur - R.t) / 5) * 22;
    if (tunnelLights) {
      for (var i = 0; i < 40; i++) {
        var z = (((-9 + (i / 2 | 0) * 2.2) - R.t * v) % 44 + 44) % 44 - 22;
        tmpM.makeTranslation((i % 2 ? 1 : -1) * 2.2, 1.25 + (i % 3) * 0.1, z); tunnelLights.setMatrixAt(i, tmpM);
      }
      tunnelLights.instanceMatrix.needsUpdate = true;
    }
    if (FC.cam && v > 4) FC.cam.shakeA = Math.max(FC.cam.shakeA || 0, 0.06);
    if (!R.said && R.t > R.dur - 4) { R.said = true; say("Станцыя «" + by(R.to.name) + "».", "Станция «" + R.to.name + "»", 3); }
    if (R.t >= R.dur) { var arr = { dir: R.dir }; S.ride = null; openStation(R.to, arr); }
  }
  // в вагоне — внутри вагона, на станции — на платформе
  var shimCollideStation = shim.collide;
  shim.collide = function (wx, wz, r) {
    if (S.mode !== "ride") return shimCollideStation(wx, wz, r);
    var p = toL(wx, wz), x = FC.clamp(p.x, -1.0, 1.0), z = FC.clamp(p.z, -8.5, 8.5), w = toW(x, z);
    return { x: w.x, z: w.z, hit: x !== p.x || z !== p.z };
  };

  /* ---- кадр: поезда, двери, что можно сделать рядом ----------------------------------------------------------------- */
  FC.addSystem({
    name: "metro", order: 96,
    update: function (dt) {
      if (!S.active) return;
      S.t += dt;
      if (S.mode === "ride") { if (FC.player) FC.player.y = Y0; rideStep(dt); return; }
      S.trains.forEach(function (tr) { tr.state = trainAt(tr, S.t); placeTrain(tr, tr.state); });
      drawClocks(dt);
      danger(dt);
    }
  });
  function onPlatform(x, z) { return Math.abs(x) < PW && z > -HALF && z < HALF; }
  // человек на путях: поезд гудит и сбивает (тоннель тоже); контактный рельс бьёт током
  var hornT = 0, zapT = 0;
  function danger(dt) {
    var P = FC.player; if (!P || P.dead) return;
    hornT -= dt; zapT -= dt;
    var p = toL(P.x, P.z);
    if (P.y > Y0 - 0.4) return;
    S.trains.forEach(function (tr) {
      var st = tr.state; if (!st || !st.vis) return;
      if (Math.abs(p.x - tr.x) > 1.75) return;
      var dz = (p.z - st.z) * tr.dir;                                   // > 0 — человек впереди по ходу поезда
      if (Math.abs(p.z - st.z) < TL / 2 + 0.4) {
        if (FC.fx) { FC.fx.flash("#ffffff", 0.6); FC.fx.burst(P.x, P.y + 1, P.z, "sparks", 30); }
        if (FC.audio) FC.audio.play("crash", { vol: 1 });
        if (FC.cam) FC.cam.shakeA = 1.2;
        P.vy = 6; P.vx = 0; P.vz = 0;
        P.damage(9999, "train");
        if (FC.hud) FC.hud.toast("🚇 Сбил поезд. Не ходи по путям", "bad", 4);
        return;
      }
      if (dz > 0 && dz < TL / 2 + 70 && hornT <= 0 && !st.dwell) {
        hornT = 1.1;
        if (FC.audio) FC.audio.play("horn", { vol: 1 });
        if (FC.hud) FC.hud.toast("🚨 Поезд! Запрыгни на платформу (пробел) или к стене", "bad", 1.2);
      }
    });
    // контактный рельс — у стены, ступил — удар током
    if (Math.abs(Math.abs(p.x) - (TRK + 1.55)) < 0.25 && zapT <= 0) {
      zapT = 1.0; P.damage(45, "rail");
      if (FC.fx) FC.fx.burst(P.x, P.y + 0.3, P.z, "sparks", 18);
      if (FC.audio) FC.audio.play("crash", { vol: 0.35 });
      if (FC.hud) FC.hud.toast("⚡ Контактный рельс — 825 вольт", "bad", 2);
    }
  }
  function acts(px, pz) {
    var out = [], p = toL(px, pz), st = S.st;
    if (S.mode === "ride") return out;
    if (p.z < -HALF + 8.5) out.push({ id: "metro_exit", room: "metro", x: px, z: pz, r: 3, key: "use", label: "⬆️ Выйти в город — «" + st.name + "»", act: function () { leave(); } });
    var x = XFER[st.name];
    if (x && STN[x] && p.z > HALF - 8.5) out.push({ id: "metro_xfer", room: "metro", x: px, z: pz, r: 3, key: "use", label: "↔️ Пересадка на «" + x + "»", act: function () {
      openStation(STN[x], null); var q = toW(0, HALF - 9); put(q.x, q.z, Math.atan2(-S.s, -S.c)); strip(null);
      say("Пераход на станцыю «" + by(x) + "»", LINE_NAME[STN[x].line], 3);
    } });
    S.trains.forEach(function (tr) {
      var s = tr.state; if (!s || !s.dwell || s.open < 0.6 || s.left < 1.5) return;
      if (Math.abs(p.x - (tr.x > 0 ? PW : -PW)) > 1.8) return;
      var nx = neighbor(st, tr.dir), tm = terminal(st, tr.dir);
      out.push({ id: "metro_board_" + tr.dir, room: "metro", x: px, z: pz, r: 3, key: "use", label: "🚇 Сесть: в сторону «" + tm.name + "» (следующая «" + nx.name + "»)", act: function () { board(tr); } });
    });
    return out;
  }
  function hook() {
    if (!FC.interact || !FC.interact.provider) { setTimeout(hook, 200); return; }
    FC.interact.provider(function (px, pz, room) { return room === "metro" && S.active ? acts(px, pz) : null; });
  }
  hook();

  function mapLayer(c, k, mode) {
    if (!prep()) return;
    var px = 1 / k;
    Object.keys(LINES).forEach(function (ln) {
      var L = LINES[ln]; if (L.length < 2) return;
      c.strokeStyle = HEX[ln]; c.globalAlpha = mode === "big" ? 0.85 : 0.6; c.lineWidth = (mode === "big" ? 4 : 3) * px; c.lineJoin = "round"; c.lineCap = "round";
      c.beginPath(); L.forEach(function (n, i) { var s = STN[n]; if (i) c.lineTo(s.x, s.z); else c.moveTo(s.x, s.z); }); c.stroke();
      c.globalAlpha = 1;
      L.forEach(function (n) {
        var s = STN[n], r = (XFER[n] ? 5 : 3.6) * px;
        c.fillStyle = "#fff"; c.beginPath(); c.arc(s.x, s.z, r, 0, 7); c.fill();
        c.lineWidth = 1.8 * px; c.strokeStyle = HEX[ln]; c.stroke();
        if (mode === "big" && k > 0.22) {
          c.font = "600 " + (11 * px) + "px system-ui"; c.textAlign = "left"; c.textBaseline = "middle";
          c.lineWidth = 3 * px; c.strokeStyle = "rgba(0,0,0,.7)"; c.strokeText(n, s.x + r + 3 * px, s.z); c.fillStyle = "#fff"; c.fillText(n, s.x + r + 3 * px, s.z);
        }
      });
    });
  }
  (function hookMap() { if (FC.hud && FC.hud.addMapLayer) FC.hud.addMapLayer(mapLayer); else setTimeout(hookMap, 200); })();

  FC.metro = { enter: enter, leave: leave, lines: LINES, stations: STN, by: by, get active() { return S.active; }, debug: { S: S, board: board, acts: acts } };
})(window);
