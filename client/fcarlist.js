/* Флейм-Сити — машины города: марки-пародии, классы, характер (FC.carList) — один источник правды для игры и сборки
 * моделей (tools/fc-cars-build.cjs читает этот файл и берёт отсюда размеры).
 *
 * Право: ни одной настоящей марки, модели, эмблемы и решётки-«знака» — только свои марки-пародии,
 * узнаётся класс и силуэт. Не вписывать настоящие названия ни сюда, ни в модели, ни в комментарии: файл виден всем.
 *
 * Поля типа: brand + model — имя в интерфейсе; cls — класс (CLS); vtop — максималка, м/с (км/ч = ×3,6); accel — тяга
 * у места, м/с²; brake; grip/gripDrift — боковое сцепление в сцепке и в заносе; steer — руль, °; aLat — предел
 * бокового ускорения; drive — привод: f передний (недостаточная поворачиваемость, прощает), r задний (занос на газу),
 * a полный (липнет), rr — мотор сзади (лёгкий нос, сброс газа в повороте закручивает); ovs — склонность к заносу на газу,
 * spin — пробуксовка со старта, resp — отзывчивость руля (тяжёлые < 1), roll — крен кузова, mass — кг (удары);
 * L/W/wb/wr/fo — длина, ширина, база, радиус колеса, передний свес; snd — голос мотора {k, p, v}; price — автосалон;
 * lod — силуэт дальнего плана; fb — форма-заглушка до загрузки моделей; colors — палитра трафика.
 */
(function (global) {
  "use strict";
  var FC = global.FC || (global.FC = {});

  var BRANDS = {
    stavr: "Ставр", hanul: "Ханыль", bremer: "Бремер", vltava: "Влтава", ingwald: "Ингвальд", xindao: "Синьдао",
    kaze: "Казэ", yamaki: "Ямаки", kronwald: "Кронвальд", rheinmark: "Рейнмарк", ashbury: "Эшбери", crewford: "Крюфорд",
    pfeil: "Пфайль", riverton: "Ривертон", aether: "Эфир", tauro: "Тауро", corsaro: "Корсаро", veterok: "Ветерок",
    svisloch: "Свислочь", pchela: "Пчела", shield: "Патруль «Щит»", volt: "Вольт"
  };
  var CLS = {
    eco: { name: "эконом", icon: "🚗" }, compact: { name: "компакт", icon: "🚗" }, cross: { name: "кроссовер", icon: "🚙" },
    biz: { name: "бизнес", icon: "🚘" }, lux: { name: "люкс", icon: "🎩" }, gt: { name: "гран-туризмо", icon: "🏁" },
    suv: { name: "внедорожник", icon: "🚙" }, sport: { name: "спорткар", icon: "🏎️" }, muscle: { name: "маслкар", icon: "🏎️" },
    ev: { name: "электро", icon: "⚡" }, super: { name: "суперкар", icon: "🏎️" }, hyper: { name: "гиперкар", icon: "🚀" },
    van: { name: "фургон", icon: "🚐" }, minibus: { name: "маршрутка", icon: "🚐" }, bus: { name: "автобус", icon: "🚌" },
    troll: { name: "троллейбус", icon: "🚎" }, truck: { name: "грузовик", icon: "🚚" }, service: { name: "служба", icon: "🚨" },
    moto: { name: "мотоцикл", icon: "🏍️" }, tuk: { name: "тук-тук", icon: "🛺" }
  };
  // общие палитры (sRGB): простые машины — любые, дорогие — сдержанные, такси/службы — свои
  var P = {
    any: [0xd7263d, 0xf46036, 0x2e294e, 0x1b998b, 0xe8e8e8, 0x1d1d1f, 0x3a86ff, 0x8338ec, 0xadb5bd, 0x6c757d, 0x264653,
      0x2a9d8f, 0xe9c46a, 0x457b9d, 0x5f0f40, 0x0b6e4f, 0xf1faee, 0x9b2226, 0x8d99ae, 0xbcb8b1],
    city: [0xe8e8e8, 0xf4f4f2, 0x1d1d1f, 0x2b2d31, 0x8d99ae, 0xadb5bd, 0x6c757d, 0x9b2226, 0x264653, 0x457b9d, 0x3a3f58, 0x7d4e24, 0xbcb8b1, 0x0b6e4f],
    rich: [0x0e0f12, 0x1d1d1f, 0xe9e9ea, 0xf4f4f2, 0x5c6066, 0x8d99ae, 0x1f2a44, 0x3b0d11, 0x2f3e46, 0x7a6a55],
    loud: [0xffc21a, 0xff6a00, 0xd7263d, 0x00a6ed, 0x7cfc00, 0x8338ec, 0xff006e, 0xf1faee, 0x1d1d1f, 0x00c49a, 0xe9c46a],
    bus: [0x2f6fd6, 0xd62839, 0x2a9d8f, 0xf4f4f2, 0x3a86ff],
    work: [0xf4f4f2, 0xe9ecef, 0x3a86ff, 0xd62839, 0x2a9d8f, 0xffc21a, 0x6c757d]
  };

  function T(o) { return o; }
  var TYPES = {
    /* ---- эконом и компакт -------------------------------------------------------------------------------- */
    stavr7: T({ brand: "stavr", model: "Кубик", cls: "eco", vtop: 38, accel: 6.2, brake: 10.5, grip: 6.6, gripDrift: 1.6, steer: 34, aLat: 9.4,
      mass: 1050, drive: "r", ovs: 0.5, spin: 0.3, roll: 1.65, resp: 1.05, drifty: true, L: 4.13, W: 1.62, wb: 2.42, wr: 0.3, fo: 0.78,
      snd: { k: "i4old", p: 1.02, v: 0.85 }, price: 1800, lod: "sedan", fb: "sedan", colors: P.city.concat([0xe9c46a, 0x6b8f71, 0xc2b280]), armor: 0.9 }),
    stavr: T({ brand: "stavr", model: "Грань", cls: "eco", vtop: 43, accel: 7.3, brake: 12, grip: 7.4, gripDrift: 2.0, steer: 33, aLat: 10.4,
      mass: 1100, drive: "f", roll: 1.3, resp: 1.0, L: 4.27, W: 1.7, wb: 2.48, wr: 0.3, fo: 0.82, snd: { k: "i4", p: 1.1, v: 0.8 },
      price: 2600, lod: "sedan", fb: "sedan", colors: P.city }),
    hanul: T({ brand: "hanul", model: "Солар", cls: "eco", vtop: 45, accel: 7.8, brake: 12.5, grip: 7.8, gripDrift: 2.0, steer: 33, aLat: 10.9,
      mass: 1150, drive: "f", roll: 1.2, resp: 1.0, L: 4.4, W: 1.73, wb: 2.6, wr: 0.31, fo: 0.84, snd: { k: "i4", p: 1.14, v: 0.78 },
      price: 3200, lod: "sedan", fb: "sedan", colors: P.city }),
    bremer: T({ brand: "bremer", model: "Кляйн", cls: "compact", vtop: 46, accel: 8.2, brake: 13, grip: 8.1, gripDrift: 2.1, steer: 33, aLat: 11.5,
      mass: 1150, drive: "f", roll: 1.1, resp: 1.06, L: 4.05, W: 1.75, wb: 2.55, wr: 0.31, fo: 0.8, snd: { k: "i4", p: 1.18, v: 0.78 },
      price: 3800, lod: "hatch", fb: "sedan", colors: P.any }),
    sedan: T({ brand: "ingwald", model: "Классик", cls: "compact", vtop: 47, accel: 8.2, brake: 12.5, grip: 7.8, gripDrift: 2.0, steer: 32, aLat: 11,
      mass: 1250, drive: "f", roll: 1.15, resp: 1.0, armor: 0.8, L: 4.55, W: 1.74, wb: 2.62, wr: 0.31, fo: 0.9, snd: { k: "i4old", p: 0.96, v: 0.85 },
      price: 3000, lod: "sedan", fb: "sedan", colors: P.city }),
    vltava: T({ brand: "vltava", model: "Стрела", cls: "compact", vtop: 51, accel: 8.9, brake: 13.5, grip: 8.2, gripDrift: 2.1, steer: 32, aLat: 11.8,
      mass: 1300, drive: "f", roll: 1.05, resp: 1.0, L: 4.69, W: 1.83, wb: 2.69, wr: 0.32, fo: 0.92, snd: { k: "i4", p: 1.05, v: 0.8 },
      price: 5200, lod: "sedan", fb: "sedan", colors: P.city }),
    xd_gr: T({ brand: "xindao", model: "Гранд", cls: "compact", vtop: 50, accel: 8.5, brake: 13, grip: 7.9, gripDrift: 2.0, steer: 32, aLat: 11.2,
      mass: 1300, drive: "f", roll: 1.1, resp: 1.0, L: 4.64, W: 1.82, wb: 2.65, wr: 0.32, fo: 0.92, snd: { k: "i4", p: 1.08, v: 0.75 },
      price: 4600, lod: "sedan", fb: "sedan", colors: P.city }),
    kaze3: T({ brand: "kaze", model: "Три", cls: "compact", vtop: 54, accel: 9.7, brake: 14.5, grip: 8.9, gripDrift: 2.2, steer: 33, aLat: 12.6,
      mass: 1300, drive: "f", roll: 0.95, resp: 1.14, L: 4.46, W: 1.8, wb: 2.73, wr: 0.33, fo: 0.85, snd: { k: "i4", p: 1.2, v: 0.85 },
      price: 7400, lod: "hatch", fb: "sedan", colors: P.any }),
    /* ---- кроссоверы и внедорожники -------------------------------------------------------------------------- */
    xd_cool: T({ brand: "xindao", model: "Кул", cls: "cross", vtop: 50, accel: 8.8, brake: 13, grip: 7.6, gripDrift: 2.0, steer: 32, aLat: 10.6,
      mass: 1400, drive: "f", roll: 1.45, resp: 0.95, L: 4.33, W: 1.8, wb: 2.6, wr: 0.34, fo: 0.86, snd: { k: "i4", p: 1.12, v: 0.8 },
      price: 6200, lod: "cross", fb: "ev", colors: P.city, camDist: 8.8, camH: 1.85 }),
    xd_atl: T({ brand: "xindao", model: "Атлант", cls: "cross", vtop: 53, accel: 8.9, brake: 13.5, grip: 7.9, gripDrift: 2.0, steer: 32, aLat: 10.8,
      mass: 1650, drive: "a", roll: 1.4, resp: 0.9, L: 4.77, W: 1.9, wb: 2.85, wr: 0.36, fo: 0.92, snd: { k: "i4", p: 1.0, v: 0.85 },
      price: 8800, lod: "cross", fb: "ev", colors: P.city, camDist: 9, camH: 1.9 }),
    tundrus: T({ brand: "yamaki", model: "Тундрус", cls: "suv", vtop: 52, accel: 8.8, brake: 13, grip: 7.4, gripDrift: 1.9, steer: 33, aLat: 9.8,
      mass: 2600, drive: "a", roll: 1.6, resp: 0.72, armor: 0.6, L: 4.98, W: 1.98, wb: 2.85, wr: 0.39, fo: 0.95, snd: { k: "diesel", p: 1.2, v: 0.95 },
      price: 34000, lod: "suv", fb: "van", colors: P.rich.concat([0x6b705c, 0xe8e8e8]), camDist: 9.4, camH: 2.1 }),
    rhein_f: T({ brand: "rheinmark", model: "Фельд", cls: "suv", vtop: 62, accel: 11.8, brake: 15.5, grip: 8.5, gripDrift: 2.1, steer: 32, aLat: 12,
      mass: 2200, drive: "a", roll: 1.1, resp: 0.86, armor: 0.75, L: 4.92, W: 2.0, wb: 2.98, wr: 0.38, fo: 0.88, snd: { k: "v6", p: 0.95, v: 0.95 },
      price: 41000, lod: "suv", fb: "ev", colors: P.rich, camDist: 9.2, camH: 2.0 }),
    /* ---- бизнес и люкс -------------------------------------------------------------------------------------- */
    yamaki: T({ brand: "yamaki", model: "Сэйрю", cls: "biz", vtop: 56, accel: 9.9, brake: 14.5, grip: 8.3, gripDrift: 2.1, steer: 32, aLat: 12,
      mass: 1550, drive: "f", roll: 1.05, resp: 0.93, L: 4.88, W: 1.84, wb: 2.83, wr: 0.33, fo: 0.96, snd: { k: "v6", p: 1.08, v: 0.7 },
      price: 11500, lod: "biz", fb: "sedan", colors: P.city }),
    kronw: T({ brand: "kronwald", model: "Регент", cls: "biz", vtop: 60, accel: 11.2, brake: 15.5, grip: 8.8, gripDrift: 2.1, steer: 31, aLat: 12.8,
      mass: 1750, drive: "r", ovs: 0.3, roll: 0.9, resp: 0.92, L: 4.92, W: 1.85, wb: 2.94, wr: 0.34, fo: 0.86, snd: { k: "v6", p: 0.98, v: 0.75 },
      price: 19500, lod: "biz", fb: "sedan", colors: P.rich }),
    rhein: T({ brand: "rheinmark", model: "Штрих", cls: "biz", vtop: 63, accel: 12.2, brake: 16, grip: 9.0, gripDrift: 1.9, steer: 31, aLat: 13.4,
      mass: 1700, drive: "r", ovs: 0.55, spin: 0.3, roll: 0.85, resp: 1.03, L: 4.96, W: 1.87, wb: 2.98, wr: 0.34, fo: 0.84, snd: { k: "v6", p: 1.04, v: 0.85 },
      price: 23000, lod: "biz", fb: "sedan", colors: P.rich.concat([0x1f4e9c, 0xe8e8e8]) }),
    ingw: T({ brand: "ingwald", model: "Вега", cls: "biz", vtop: 58, accel: 10.8, brake: 15, grip: 9.2, gripDrift: 2.4, steer: 32, aLat: 13,
      mass: 1550, drive: "a", roll: 0.9, resp: 1.0, L: 4.76, W: 1.84, wb: 2.82, wr: 0.33, fo: 0.88, snd: { k: "i4", p: 0.98, v: 0.8 },
      price: 16000, lod: "biz", fb: "sedan", colors: P.rich.concat([0x1f4e9c]) }),
    ingw_st: T({ brand: "ingwald", model: "Штурм", cls: "sport", vtop: 70, accel: 15.6, brake: 18.5, grip: 10.8, gripDrift: 2.7, steer: 30, aLat: 15.4,
      mass: 2000, drive: "a", roll: 0.6, resp: 1.0, L: 5.01, W: 1.95, wb: 2.93, wr: 0.35, fo: 0.95, snd: { k: "v8", p: 1.12, v: 1.0 },
      price: 68000, lod: "biz", fb: "sport", colors: P.rich.concat([0x5b6770, 0x1f4e9c, 0x3d5a40]) }),
    kronw_i: T({ brand: "kronwald", model: "Империал", cls: "lux", vtop: 62, accel: 11.8, brake: 16, grip: 8.8, gripDrift: 2.2, steer: 30, aLat: 11.6,
      mass: 2100, drive: "r", ovs: 0.2, roll: 0.85, resp: 0.76, armor: 0.8, L: 5.18, W: 1.92, wb: 3.1, wr: 0.35, fo: 0.92, snd: { k: "v8", p: 0.9, v: 0.55 },
      price: 52000, lod: "biz", fb: "sedan", colors: P.rich }),
    ashbury: T({ brand: "ashbury", model: "Монарх", cls: "lux", vtop: 60, accel: 10.8, brake: 14.5, grip: 8.6, gripDrift: 2.2, steer: 30, aLat: 10.4,
      mass: 2650, drive: "r", ovs: 0.15, roll: 0.8, resp: 0.62, armor: 0.55, L: 5.76, W: 2.02, wb: 3.55, wr: 0.4, fo: 0.95, snd: { k: "v12", p: 0.8, v: 0.45 },
      price: 95000, lod: "limo", fb: "sedan", colors: [0x0e0f12, 0xf4f4f2, 0x1f2a44, 0x3b0d11, 0x5c6066, 0xd8d2c4], camDist: 9.4, camH: 1.85 }),
    crewf: T({ brand: "crewford", model: "GT", cls: "gt", vtop: 74, accel: 15.2, brake: 18, grip: 10.2, gripDrift: 2.5, steer: 30, aLat: 15,
      mass: 2300, drive: "a", roll: 0.6, resp: 0.86, armor: 0.75, L: 4.85, W: 1.97, wb: 2.85, wr: 0.36, fo: 0.88, snd: { k: "v12", p: 0.95, v: 0.9 },
      price: 88000, lod: "coupe", fb: "sport", colors: P.rich.concat([0x1e3d33, 0x4a1c2c]) }),
    /* ---- спорт, маслкар, электро ------------------------------------------------------------------------------- */
    kaze_rd: T({ brand: "kaze", model: "Родстер", cls: "sport", vtop: 58, accel: 10.8, brake: 16, grip: 9.6, gripDrift: 2.1, steer: 33, aLat: 14,
      mass: 1050, drive: "r", ovs: 0.65, roll: 0.75, resp: 1.24, L: 3.92, W: 1.73, wb: 2.31, wr: 0.31, fo: 0.78, snd: { k: "i4", p: 1.3, v: 0.95 },
      price: 14500, lod: "coupe", fb: "sport", colors: P.loud.concat([0x9b2226, 0x1d1d1f]), camDist: 7.6, camH: 1.4 }),
    sport: T({ brand: "pfeil", model: "9", cls: "sport", vtop: 74, accel: 16, brake: 19.5, grip: 10.8, gripDrift: 2.4, steer: 31, aLat: 15.8,
      mass: 1500, drive: "rr", ovs: 0.55, spin: 0.2, roll: 0.5, resp: 1.16, L: 4.52, W: 1.85, wb: 2.45, wr: 0.34, fo: 0.98, snd: { k: "flat6", p: 1.15, v: 1.0 },
      price: 64000, lod: "coupe", fb: "sport", colors: P.loud.concat(P.rich), camDist: 7.8, camH: 1.45 }),
    muscle: T({ brand: "riverton", model: "Гром", cls: "muscle", vtop: 66, accel: 14, brake: 14, grip: 7.0, gripDrift: 1.35, steer: 31, aLat: 12.4,
      mass: 1750, drive: "r", ovs: 1, spin: 1, roll: 1.2, resp: 0.95, drifty: true, armor: 0.85, L: 4.9, W: 1.93, wb: 2.95, wr: 0.36, fo: 0.95,
      snd: { k: "v8", p: 0.72, v: 1.15 }, price: 27000, lod: "coupe", fb: "muscle", colors: P.loud.concat([0x1d1d1f, 0x0b3d91]), shake: 1.25 }),
    ev: T({ brand: "aether", model: "Линия", cls: "ev", vtop: 60, accel: 13.5, brake: 17, grip: 9.4, gripDrift: 2.3, steer: 31, aLat: 13,
      mass: 1750, drive: "a", roll: 0.65, resp: 1.0, flat: true, L: 4.7, W: 1.85, wb: 2.88, wr: 0.34, fo: 0.86, snd: { k: "ev", p: 1.0, v: 0.5 },
      price: 26000, lod: "biz", fb: "ev", colors: P.rich.concat([0xd7263d, 0x3a86ff]), shake: 0.7 }),
    /* ---- электрички (задача: «машины-электрички, много, очень быстро разгоняются»): тяга у места огромная,
       кривая «flat» — электромотор тянет почти до максималки ---------------------------------------------------------- */
    ev_cube: T({ brand: "volt", model: "Кубик-Э", cls: "ev", vtop: 47, accel: 14.5, brake: 15, grip: 8.6, gripDrift: 2.2, steer: 34, aLat: 12,
      mass: 1300, drive: "f", roll: 1.0, resp: 1.12, flat: true, L: 3.95, W: 1.76, wb: 2.6, wr: 0.31, fo: 0.74, snd: { k: "ev", p: 1.25, v: 0.45 },
      price: 9500, lod: "hatch", fb: "ev", colors: P.loud.concat(P.city), shake: 0.7 }),
    xd_ev: T({ brand: "xindao", model: "Электро", cls: "ev", vtop: 58, accel: 17.5, brake: 16, grip: 8.8, gripDrift: 2.2, steer: 32, aLat: 12.2,
      mass: 2100, drive: "a", roll: 1.0, resp: 0.98, flat: true, L: 4.6, W: 1.9, wb: 2.9, wr: 0.36, fo: 0.86, snd: { k: "ev", p: 0.95, v: 0.5 },
      price: 19500, lod: "cross", fb: "ev", colors: P.city.concat([0x3a86ff, 0x1b998b]), camDist: 8.8, camH: 1.85, shake: 0.7 }),
    ev_x: T({ brand: "aether", model: "Икс", cls: "ev", vtop: 70, accel: 21, brake: 18, grip: 9.4, gripDrift: 2.3, steer: 31, aLat: 13.2,
      mass: 2450, drive: "a", roll: 0.85, resp: 0.98, flat: true, L: 5.0, W: 2.0, wb: 2.97, wr: 0.38, fo: 0.9, snd: { k: "ev", p: 0.85, v: 0.55 },
      price: 52000, lod: "suv", fb: "ev", colors: P.rich.concat([0xe9e9ea, 0x1f4e9c]), camDist: 9.2, camH: 2.0, shake: 0.7 }),
    ev_bolt: T({ brand: "aether", model: "Молния", cls: "ev", vtop: 90, accel: 27, brake: 22, grip: 11.2, gripDrift: 2.5, steer: 30, aLat: 16.5,
      mass: 2150, drive: "a", roll: 0.45, resp: 1.12, flat: true, L: 4.97, W: 1.96, wb: 2.96, wr: 0.36, fo: 0.88, snd: { k: "ev", p: 1.1, v: 0.6 },
      price: 89000, lod: "biz", fb: "ev", colors: P.rich.concat([0xd7263d, 0x3a86ff]), camDist: 8.2, shake: 0.6 }),
    ev_hyper: T({ brand: "rheinmark", model: "Е-Ракета", cls: "hyper", vtop: 115, accel: 31, brake: 27, grip: 12.6, gripDrift: 2.6, steer: 28, aLat: 19.5,
      mass: 1950, drive: "a", roll: 0.25, resp: 1.15, flat: true, L: 4.75, W: 2.0, wb: 2.75, wr: 0.36, fo: 1.0, snd: { k: "ev", p: 1.35, v: 0.75 },
      price: 480000, lod: "super", fb: "sport", colors: [0x0e0f12, 0x00a6ed, 0xe9e9ea, 0x7cfc00, 0x5c6066], camDist: 7.6, camH: 1.3, shake: 0.6 }),
    /* ---- суперкары и гиперкар ------------------------------------------------------------------------------- */
    tauro: T({ brand: "tauro", model: "Торо-V", cls: "super", vtop: 83, accel: 19.5, brake: 22, grip: 11.8, gripDrift: 2.7, steer: 29, aLat: 17.5,
      mass: 1450, drive: "a", roll: 0.35, resp: 1.18, L: 4.52, W: 1.93, wb: 2.62, wr: 0.35, fo: 1.0, snd: { k: "v10", p: 1.1, v: 1.1 },
      price: 145000, lod: "super", fb: "sport", colors: P.loud, camDist: 7.4, camH: 1.3, shake: 0.8 }),
    corsaro: T({ brand: "corsaro", model: "Россо", cls: "super", vtop: 84, accel: 19.5, brake: 22, grip: 11.2, gripDrift: 2.2, steer: 29, aLat: 17.2,
      mass: 1400, drive: "r", ovs: 0.6, spin: 0.4, roll: 0.35, resp: 1.26, L: 4.61, W: 1.98, wb: 2.65, wr: 0.35, fo: 1.02, snd: { k: "v8", p: 1.32, v: 1.05 },
      price: 150000, lod: "super", fb: "sport", colors: [0xc8102e, 0xffc21a, 0x1d1d1f, 0xf4f4f2, 0x1f4e9c, 0x9b2226], camDist: 7.4, camH: 1.3, shake: 0.8 }),
    hyper: T({ brand: "aether", model: "Гиперион", cls: "hyper", vtop: 94, accel: 24, brake: 25, grip: 12.2, gripDrift: 2.6, steer: 28, aLat: 18.8,
      mass: 1950, drive: "a", roll: 0.3, resp: 1.12, flat: true, L: 4.6, W: 2.04, wb: 2.75, wr: 0.36, fo: 1.0, snd: { k: "hyper", p: 1.0, v: 0.85 },
      price: 320000, lod: "super", fb: "sport", colors: [0x0e0f12, 0x1f4e9c, 0xe9e9ea, 0x00a6ed, 0xff6a00, 0x5c6066], camDist: 7.6, camH: 1.3, shake: 0.7 }),
    // самые быстрые (задача: «машины быстрые, где скорость до 500 км/ч»)
    tauro_v: T({ brand: "tauro", model: "Вихрь", cls: "hyper", vtop: 122, accel: 27, brake: 27, grip: 12.4, gripDrift: 2.5, steer: 27, aLat: 19.2,
      mass: 1550, drive: "a", roll: 0.25, resp: 1.14, L: 4.7, W: 2.03, wb: 2.7, wr: 0.36, fo: 1.0, snd: { k: "v10", p: 1.25, v: 1.15 },
      price: 620000, lod: "super", fb: "sport", colors: [0xffc21a, 0xff6a00, 0x7cfc00, 0x1d1d1f, 0xf4f4f2], camDist: 7.6, camH: 1.3, shake: 0.6 }),
    hyper500: T({ brand: "corsaro", model: "Ураган 500", cls: "hyper", vtop: 139, accel: 28, brake: 28, grip: 12.6, gripDrift: 2.4, steer: 26, aLat: 19.5,
      mass: 1500, drive: "a", roll: 0.2, resp: 1.1, L: 4.8, W: 2.05, wb: 2.75, wr: 0.36, fo: 1.05, snd: { k: "hyper", p: 1.2, v: 1.0 },
      price: 950000, lod: "super", fb: "sport", colors: [0x0e0f12, 0xc8102e, 0x1f4e9c, 0xe9e9ea, 0xff6a00], camDist: 7.8, camH: 1.3, shake: 0.55 }),
    /* ---- работа и общественный транспорт ------------------------------------------------------------------------ */
    van: T({ brand: "bremer", model: "Кастен", cls: "van", vtop: 40, accel: 6.8, brake: 10.5, grip: 6.2, gripDrift: 1.7, steer: 31, aLat: 8.2,
      mass: 1900, drive: "f", roll: 1.8, resp: 0.78, armor: 0.7, L: 4.9, W: 1.9, wb: 3.0, wr: 0.35, fo: 0.82, snd: { k: "diesel", p: 1.35, v: 0.85 },
      price: 5000, lod: "van", fb: "van", colors: P.work, camDist: 9.5, camH: 2.2, shake: 1.3 }),
    marsh: T({ brand: "veterok", model: "Пчёлка", cls: "minibus", vtop: 36, accel: 5.7, brake: 9.5, grip: 5.8, gripDrift: 1.6, steer: 33, aLat: 7.2,
      mass: 3300, drive: "r", roll: 2.0, resp: 0.62, armor: 0.6, L: 5.93, W: 2.02, wb: 3.66, wr: 0.37, fo: 0.92, snd: { k: "diesel", p: 1.15, v: 0.9 },
      price: 9500, lod: "marsh", fb: "van", colors: [0xffc21a, 0xf4f4f2, 0xf4f4f2, 0xffd23f, 0xe9ecef], camDist: 10.5, camH: 2.6, shake: 1.35, bus: true }),
    bus: T({ brand: "svisloch", model: "А-12", cls: "bus", vtop: 24, accel: 2.6, brake: 7, grip: 5, gripDrift: 1.5, steer: 40, aLat: 5,
      mass: 11000, drive: "r", roll: 1.3, resp: 0.45, armor: 0.3, L: 12, W: 2.55, wb: 5.9, wr: 0.5, fo: 2.6, snd: { k: "bus", p: 1.0, v: 1.0 },
      price: 14000, lod: "bus", fb: "bus", colors: P.bus, camDist: 16, camH: 4, shake: 1.5, bus: true }),
    ebus: T({ brand: "svisloch", model: "Э-12", cls: "bus", vtop: 23, accel: 3.0, brake: 7, grip: 5, gripDrift: 1.5, steer: 40, aLat: 5,
      mass: 12000, drive: "r", roll: 1.2, resp: 0.45, armor: 0.3, flat: true, L: 12, W: 2.55, wb: 5.9, wr: 0.5, fo: 2.6, snd: { k: "troll", p: 1.1, v: 0.6 },
      price: 18000, lod: "bus", fb: "bus", colors: [0x2a9d8f, 0x3a86ff, 0xf4f4f2, 0x7cb518], camDist: 16, camH: 4, shake: 1.4, bus: true }),
    troll: T({ brand: "svisloch", model: "Т-32", cls: "troll", vtop: 20, accel: 2.8, brake: 7, grip: 5, gripDrift: 1.5, steer: 40, aLat: 4.8,
      mass: 11500, drive: "r", roll: 1.3, resp: 0.42, armor: 0.3, flat: true, L: 12, W: 2.55, wb: 6.0, wr: 0.5, fo: 2.6, snd: { k: "troll", p: 0.9, v: 0.75 },
      price: 16000, lod: "bus", fb: "bus", colors: [0x2f6fd6, 0x2a9d8f, 0xd62839, 0xf4f4f2], camDist: 16, camH: 4.2, shake: 1.4, bus: true, poles: true }),
    truck: T({ brand: "svisloch", model: "Грузовой", cls: "truck", vtop: 31, accel: 4.8, brake: 8, grip: 6, gripDrift: 1.7, steer: 36, aLat: 5.5,
      mass: 9000, drive: "r", roll: 1.4, resp: 0.5, armor: 0.3, L: 8.6, W: 2.5, wb: 5.0, wr: 0.52, fo: 1.35, snd: { k: "bus", p: 1.1, v: 1.1 },
      price: 12000, lod: "truck", fb: "truck", colors: [0xf4f4f2, 0x2f6fd6, 0xd62839, 0x2a9d8f, 0xffc21a, 0x6c757d], camDist: 14, camH: 3.6, shake: 1.6 }),
    /* ---- службы: такси, патруль, скорая, пожарная ---------------------------------------------------------------- */
    taxi: T({ brand: "hanul", model: "Солар · такси", cls: "eco", vtop: 45, accel: 7.8, brake: 12.5, grip: 7.8, gripDrift: 2.0, steer: 33, aLat: 10.9,
      mass: 1150, drive: "f", roll: 1.2, resp: 1.0, L: 4.4, W: 1.73, wb: 2.6, wr: 0.31, fo: 0.84, snd: { k: "i4", p: 1.1, v: 0.78 },
      price: 3500, lod: "sedan", fb: "taxi", colors: [0xffc21a] }),
    police: T({ brand: "shield", model: "", name: "патруль «Щит»", cls: "service", vtop: 62, accel: 12.5, brake: 16, grip: 9, gripDrift: 2.2, steer: 32, aLat: 12.5,
      mass: 1600, drive: "r", ovs: 0.25, roll: 0.9, resp: 1.0, armor: 0.55, L: 4.88, W: 1.84, wb: 2.83, wr: 0.33, fo: 0.96, snd: { k: "v6", p: 1.05, v: 0.9 },
      lod: "biz", fb: "police", colors: [0xf1f3f6] }),
    ambulance: T({ brand: "veterok", model: "Скорая", cls: "service", vtop: 44, accel: 8.0, brake: 12, grip: 7, gripDrift: 1.8, steer: 33, aLat: 9,
      mass: 3000, drive: "r", roll: 1.6, resp: 0.7, armor: 0.6, emergency: true, L: 5.93, W: 2.02, wb: 3.66, wr: 0.37, fo: 0.92, snd: { k: "diesel", p: 1.2, v: 0.9 },
      lod: "marsh", fb: "ambulance", colors: [0xf4f4f4], camDist: 10.5, camH: 2.6, shake: 1.3 }),
    fire: T({ brand: "svisloch", model: "Пожарная", cls: "service", vtop: 34, accel: 5.2, brake: 9, grip: 6, gripDrift: 1.6, steer: 36, aLat: 5.5,
      mass: 12000, drive: "r", roll: 1.4, resp: 0.5, armor: 0.3, emergency: true, L: 9.2, W: 2.55, wb: 5.2, wr: 0.55, fo: 1.4, snd: { k: "bus", p: 1.05, v: 1.1 },
      lod: "truck", fb: "fire", colors: [0xc1121f], camDist: 15, camH: 3.8, shake: 1.6 }),
    /* ---- двухколёсные и тук-тук -------------------------------------------------------------------------------- */
    moto: T({ brand: "kaze", model: "Цуруги", cls: "moto", vtop: 72, accel: 16, brake: 17, grip: 9.5, gripDrift: 2.4, steer: 34, aLat: 15,
      mass: 240, drive: "r", roll: 0, resp: 1.2, moto: true, armor: 1.1, L: 2.1, W: 0.8, wb: 1.42, wr: 0.31, fo: 0.34, snd: { k: "moto", p: 1.0, v: 0.8 },
      price: 18000, lod: "moto", fb: "moto", colors: P.loud, camDist: 6.4, camH: 1.4, shake: 0.9 }),
    moto_c: T({ brand: "stavr", model: "Кулик", cls: "moto", vtop: 38, accel: 9, brake: 12, grip: 8, gripDrift: 2.2, steer: 36, aLat: 11,
      mass: 200, drive: "r", roll: 0, resp: 1.1, moto: true, armor: 1.1, L: 2.15, W: 0.85, wb: 1.38, wr: 0.33, fo: 0.38, snd: { k: "moto1", p: 1.0, v: 0.8 },
      price: 4200, lod: "moto", fb: "moto", colors: [0x9b2226, 0x264653, 0x1d1d1f, 0x0b6e4f, 0x6c757d], camDist: 6.4, camH: 1.4, shake: 1.1 }),
    tuk: T({ brand: "pchela", model: "Тук-тук", cls: "tuk", vtop: 24, accel: 6.5, brake: 12, grip: 7, gripDrift: 2.2, steer: 38, aLat: 9,
      mass: 450, drive: "r", roll: 2.0, resp: 1.0, armor: 1.1, L: 2.8, W: 1.4, wb: 1.9, wr: 0.28, fo: 0.45, snd: { k: "tuk", p: 1.0, v: 0.6 },
      price: 1500, lod: "tuk", fb: "tuk", colors: [0x2a9d8f, 0xffc21a, 0xd62839, 0x3a86ff, 0x7cb518], camDist: 6.8, camH: 1.6 })
  };
  Object.keys(TYPES).forEach(function (k) {
    var t = TYPES[k];
    t.key = k;
    if (!t.name) t.name = BRANDS[t.brand] + (t.model ? " " + t.model : "");
  });

  /* ---- смесь трафика ------------------------------------------------------------------------------------------ */
  // Минск: много кроссоверов и компактов, старые седаны, маршрутки, автобусы и троллейбусы по проспектам;
  // дорогие — реже, в центре чаще. Флейм-Сити: районы-города — Москва богаче, Алматы — тук-туки и маслкары.
  var MIX = {
    minsk: { xd_cool: 10, xd_atl: 6, xd_gr: 7, hanul: 8, bremer: 7, vltava: 7, sedan: 7, stavr: 6, stavr7: 3, kaze3: 3, yamaki: 4,
      kronw: 2, rhein: 2, ingw: 2, tundrus: 1.5, rhein_f: 1.2, kronw_i: 0.6, ev: 1.2, van: 4, taxi: 6, moto_c: 1, moto: 0.8, police: 3,
      xd_ev: 6, ev_cube: 3, ev_x: 1.5, ev_bolt: 1 },
    flame: { sedan: 8, hanul: 5, bremer: 5, vltava: 4, xd_cool: 5, xd_atl: 3, kaze3: 4, yamaki: 5, kronw: 3, rhein: 3, ingw: 3,
      ev: 5, muscle: 4, sport: 2, rhein_f: 2, tundrus: 2, kaze_rd: 1.5, van: 5, taxi: 8, moto: 4, moto_c: 1.5, police: 6,
      xd_ev: 3, ev_cube: 3, ev_x: 2, ev_bolt: 1.5 },
    // по району (Флейм-Сити): множители к базе; новых в базе нет — добавляются с этим весом
    dist: {
      center: { kronw_i: 4, ashbury: 1.2, crewf: 1.2, sport: 2, tauro: 0.5, corsaro: 0.5, hyper: 0.15, ingw_st: 1.2, rhein_f: 2, taxi: 1.3,
        ev_bolt: 2, ev_x: 1.5, ev_hyper: 0.12, tauro_v: 0.1, hyper500: 0.06 },
      msk: { kronw_i: 2.5, ashbury: 0.6, crewf: 0.8, tauro: 0.3, corsaro: 0.3, ingw_st: 1, sport: 1.6, ev: 1.6, stavr7: 0.3 },
      ala: { tuk: 7, muscle: 2, stavr7: 2, moto: 1.5, kronw_i: 0.3 },
      minsk: { stavr7: 1.5, stavr: 1.3 }
    },
    // Минск 1:1: центр — дороже, окраины («Север и юг») — старее
    distM: {
      center: { kronw_i: 2.5, kronw: 1.6, rhein: 1.6, rhein_f: 2, tundrus: 1.6, ashbury: 0.15, crewf: 0.15, ingw_st: 0.3, sport: 0.2, stavr7: 0.5, taxi: 1.4,
        ev_bolt: 1.8, ev_x: 1.5, ev_hyper: 0.08, tauro_v: 0.06, hyper500: 0.04 },
      minsk: { stavr7: 1.6, stavr: 1.3, sedan: 1.3, kronw: 0.6, rhein: 0.6 }
    },
    // по дороге: на проспектах и шоссе — автобусы, троллейбусы, маршрутки, грузовики
    road: {
      st: { marsh: 1, truck: 0.3 },
      av: { bus: 3, ebus: 1.5, troll: 3, marsh: 4, truck: 2 },
      hw: { bus: 1.5, marsh: 2, truck: 5, van: 3 }
    }
  };
  function pickTraffic(kind, dk, city, rnd) {
    rnd = rnd || Math.random;
    var mn = city === "minsk", base = MIX[mn ? "minsk" : "flame"], dm = (mn ? MIX.distM : MIX.dist)[dk] || {}, rm = MIX.road[kind] || {}, w = {}, tot = 0, k;
    for (k in base) w[k] = base[k] * (dm[k] != null ? dm[k] : 1);
    for (k in dm) if (w[k] == null && dm[k] > 0 && TYPES[k]) w[k] = dm[k];
    for (k in rm) w[k] = (w[k] || 0) + rm[k] * (mn ? 1.4 : 0.6);
    if (!mn) { delete w.troll; delete w.ebus; }
    for (k in w) tot += w[k];
    var r = rnd() * tot;
    for (k in w) { r -= w[k]; if (r <= 0) return k; }
    return "sedan";
  }
  // припаркованные: без автобусов, служб и грузовиков
  function pickParked(dk, city, rnd) {
    var t;
    for (var i = 0; i < 6; i++) {
      t = pickTraffic("st", dk, city, rnd);
      if (!/^(bus|ebus|troll|marsh|truck|police|ambulance|fire)$/.test(t)) return t;
    }
    return "sedan";
  }

  // автосалон: всё, у чего есть цена, по возрастанию
  function shop() {
    return Object.keys(TYPES).filter(function (k) { return TYPES[k].price && k !== "taxi"; })
      .sort(function (a, b) { return TYPES[a].price - TYPES[b].price; });
  }

  FC.carList = { TYPES: TYPES, BRANDS: BRANDS, CLS: CLS, PALETTES: P, MIX: MIX, pickTraffic: pickTraffic, pickParked: pickParked, shop: shop };
  if (FC.cars && FC.cars.define) FC.cars.define(TYPES);
})(typeof window !== "undefined" ? window : globalThis);
