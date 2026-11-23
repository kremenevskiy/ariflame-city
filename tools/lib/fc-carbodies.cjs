/* Рецепты кузовов машин Флейм-Сити: силуэт класса из долей длины + своё «лицо» и корма у каждой модели.
 * Размеры (L, W, wb, wr, fo) — из ростера client/fcarlist.js. Ни одной настоящей решётки и
 * эмблемы: решётки — свои рисунки (рамка, планки, сетка), фары — свои формы.
 */
"use strict";
const { rgb } = require("./fc-cargen.cjs");

function merge(a, b) {
  const o = Object.assign({}, a);
  for (const k in b) {
    if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k])) o[k] = merge(a[k], b[k]);
    else o[k] = b[k];
  }
  return o;
}
const dims = (T) => ({ L: T.L, W: T.W, wb: T.wb, wr: T.wr, fo: T.fo });

/* ---- силуэты ---------------------------------------------------------------------------------------------- */
// седан: капот, кабина, багажник
function sedan(T, o) {
  const L = T.L, cowl = 0.285 * L, ws = 0.155 * L, roof = 0.235 * L, rw = 0.135 * L, H = o.H || 1.46;
  const b = { ...dims(T), H, noseY: 0.66, hoodY: 0.93, cowl, ws, roof, rw, deckY: 0.99, tailY: 0.95, clear: 0.15,
    noseR: 0.34, tailR: 0.3, tumble: 0.34, beltRise: 0.05,
    win: [[cowl + ws * 0.34, cowl + ws + roof * 0.4 - 0.05], [cowl + ws + roof * 0.4 + 0.05, cowl + ws + roof + rw * 0.3]],
    seams: [cowl + 0.06, cowl + ws + roof * 0.4, cowl + ws + roof + rw * 0.25],
    front: { lights: { w: 0.46, y0: 0.53, y1: 0.64, shape: "swoop", lamps: [{ a: 0.12, b: 0.62, v0: 0.2, v1: 0.8 }, { a: 0.66, b: 0.92, v0: 0.25, v1: 0.75 }] },
      grille: { w: 0.62, y0: 0.42, y1: 0.56, frame: rgb(0xc9cfd6), slats: 2 }, intakes: [{ s0: 0.1, s1: 0.5, y0: 0.27, y1: 0.36 }], plateY: 0.3 },
    rear: { lights: { w: 0.5, y0: 0.78, y1: 0.9, rev: [0.05, 0.25, 0.25, 0.75] }, plateY: 0.52 },
    wheel: "alloy", tireW: 0.21 };
  return merge(b, o);
}
// хэтчбек: кабина до кормы, заднее стекло круто
function hatch(T, o) {
  const L = T.L, cowl = 0.27 * L, ws = 0.17 * L, roof = 0.33 * L, H = o.H || 1.46, rw = L - cowl - ws - roof - 0.05;
  const b = { ...dims(T), H, noseY: 0.66, hoodY: 0.92, cowl, ws, roof, rw, deckY: 1.02, tailY: 1.0, clear: 0.15, noseR: 0.32, tailR: 0.26,
    roofDrop: 0.06, tumble: 0.33, beltRise: 0.08,
    win: [[cowl + ws * 0.36, cowl + ws + roof * 0.42 - 0.05], [cowl + ws + roof * 0.42 + 0.05, cowl + ws + roof * 0.95]],
    seams: [cowl + 0.06, cowl + ws + roof * 0.42, cowl + ws + roof * 0.96],
    front: { lights: { w: 0.44, y0: 0.54, y1: 0.64, shape: "swoop", lamps: [{ a: 0.12, b: 0.7, v0: 0.2, v1: 0.8 }] },
      grille: { w: 0.56, y0: 0.44, y1: 0.55, slats: 1 }, intakes: [{ s0: 0, s1: 0.45, y0: 0.27, y1: 0.37 }], plateY: 0.3 },
    rear: { lights: { w: 0.36, y0: 0.82, y1: 0.97, shape: "wedge" }, plateY: 0.55 },
    wheel: "alloy", tireW: 0.21 };
  return merge(b, o);
}
// лифтбек / фастбек: длинное покатое заднее стекло
function fastback(T, o) {
  const L = T.L, cowl = 0.29 * L, ws = 0.16 * L, roof = 0.17 * L, rw = 0.27 * L, H = o.H || 1.44;
  const b = { ...dims(T), H, noseY: 0.65, hoodY: 0.92, cowl, ws, roof, rw, deckY: 1.0, tailY: 0.97, clear: 0.15, noseR: 0.34, tailR: 0.3,
    tumble: 0.36, beltRise: 0.06,
    win: [[cowl + ws * 0.34, cowl + ws + roof * 0.55 - 0.05], [cowl + ws + roof * 0.55 + 0.05, cowl + ws + roof + rw * 0.32]],
    seams: [cowl + 0.06, cowl + ws + roof * 0.55, cowl + ws + roof + rw * 0.28],
    front: { lights: { w: 0.46, y0: 0.53, y1: 0.63, shape: "swoop", lamps: [{ a: 0.1, b: 0.9, v0: 0.3, v1: 0.7 }] },
      grille: { w: 0.66, y0: 0.38, y1: 0.55 }, intakes: [{ s0: 0.28, s1: 0.6, y0: 0.27, y1: 0.4 }], plateY: 0.29 },
    rear: { lights: { w: 0.5, y0: 0.82, y1: 0.92 }, bar: null, plateY: 0.55 },
    wheel: "alloy", tireW: 0.23 };
  return merge(b, o);
}
// кроссовер: высокий, рейлинги, пластик по низу
function cross(T, o) {
  const L = T.L, cowl = 0.26 * L, ws = 0.15 * L, roof = 0.44 * L, H = o.H || 1.62, rw = L - cowl - ws - roof - 0.04;
  const b = { ...dims(T), H, noseY: 0.82, hoodY: 1.06, cowl, ws, roof, rw, deckY: 1.12, tailY: 1.1, clear: 0.2, noseR: 0.34, tailR: 0.26,
    roofDrop: 0.06, tumble: 0.3, beltRise: 0.06, lowerCol: 0x232427, claddingH: 0.2, archGap: 0.09, bumpF: 0.2, bumpR: 0.18,
    win: [[cowl + ws * 0.32, cowl + ws + roof * 0.4 - 0.05], [cowl + ws + roof * 0.4 + 0.05, cowl + ws + roof * 0.78], [cowl + ws + roof * 0.8, cowl + ws + roof * 0.97]],
    seams: [cowl + 0.06, cowl + ws + roof * 0.4, cowl + ws + roof * 0.79],
    blackPillars: true, extras: { rails: rgb(0x2a2c30) },
    front: { lights: { w: 0.42, y0: 0.7, y1: 0.8, shape: "swoop", lamps: [{ a: 0.15, b: 0.85, v0: 0.3, v1: 0.7 }] },
      grille: { w: 0.78, y0: 0.47, y1: 0.69, slats: 0, bars: 0, frame: rgb(0x9aa1a9) }, intakes: [{ s0: 0.2, s1: 0.6, y0: 0.32, y1: 0.42 }], plateY: 0.36 },
    rear: { lights: { w: 0.4, y0: 0.96, y1: 1.08, shape: "wedge" }, plateY: 0.62 },
    wheel: "alloy", tireW: 0.22 };
  return merge(b, o);
}
// рамный внедорожник: прямоугольный, высокий, вертикальная корма
function suv(T, o) {
  const L = T.L, cowl = 0.27 * L, ws = 0.12 * L, roof = 0.56 * L, H = o.H || 1.9, rw = L - cowl - ws - roof - 0.03;
  const b = { ...dims(T), H, noseY: 1.0, hoodY: 1.2, cowl, ws, roof, rw, deckY: 1.22, tailY: 1.22, clear: 0.26, noseR: 0.24, tailR: 0.2,
    roofDrop: 0.02, roofBow: 0.01, tumble: 0.2, beltRise: 0.02, archGap: 0.1, bumpF: 0.22, bumpR: 0.2, lowerCol: 0x2a2b2e, claddingH: 0.16, bulge: 0.02,
    taper: 0.01, rwKink: true, bumperCol: 0x2a2b2e, bumpTopF: 0.72, bumpTopR: 0.7,
    win: [[cowl + ws * 0.3, cowl + ws + roof * 0.34 - 0.05], [cowl + ws + roof * 0.34 + 0.06, cowl + ws + roof * 0.68], [cowl + ws + roof * 0.7, cowl + ws + roof * 0.98]],
    seams: [cowl + 0.06, cowl + ws + roof * 0.34, cowl + ws + roof * 0.69],
    blackPillars: true, extras: { rails: rgb(0x8f959c) },
    front: { lights: { w: 0.4, y0: 0.82, y1: 0.97, lamps: [{ a: 0.1, b: 0.5, v0: 0.15, v1: 0.85 }, { a: 0.55, b: 0.9, v0: 0.15, v1: 0.85 }] },
      grille: { w: 0.92, y0: 0.66, y1: 0.97, frame: rgb(0xc9cfd6), slats: 4 }, intakes: [{ s0: 0.15, s1: 0.65, y0: 0.38, y1: 0.5 }], plateY: 0.52 },
    rear: { lights: { w: 0.2, s0: null, y0: 0.9, y1: 1.3, shape: "rect" }, window: { w: 1.3, y0: 1.3, y1: 1.72 }, plateY: 0.72 },
    wheel: "multi", tireW: 0.26 };
  return merge(b, o);
}
// купе / гран-туризмо: длинный капот, покатая крыша
function coupe(T, o) {
  const L = T.L, cowl = 0.36 * L, ws = 0.16 * L, roof = 0.13 * L, rw = 0.24 * L, H = o.H || 1.36;
  const b = { ...dims(T), H, noseY: 0.6, hoodY: 0.88, cowl, ws, roof, rw, deckY: 0.96, tailY: 0.93, clear: 0.13, noseR: 0.38, tailR: 0.34,
    roofDrop: 0.05, tumble: 0.42, beltRise: 0.08, bulge: 0.05,
    win: [[cowl + ws * 0.32, cowl + ws + roof + rw * 0.28]], seams: [cowl + 0.07, cowl + ws + roof + 0.05],
    front: { lights: { w: 0.44, y0: 0.5, y1: 0.6, shape: "swoop", lamps: [{ a: 0.1, b: 0.9, v0: 0.28, v1: 0.72 }] },
      grille: { w: 0.7, y0: 0.3, y1: 0.48 }, plateY: 0.2 },
    rear: { lights: { w: 0.44, y0: 0.76, y1: 0.86 }, plateY: 0.48, exhaust: { x: [0.5], y: 0.26 } },
    wheel: "alloy", tireW: 0.25 };
  return merge(b, o);
}
// среднемоторный суперкар: низкий клин, кабина вперёд, крышка мотора
function wedge(T, o) {
  const L = T.L, cowl = 0.3 * L, ws = 0.19 * L, roof = 0.1 * L, rw = 0.3 * L, H = o.H || 1.18;
  const b = { ...dims(T), H, noseY: 0.5, hoodY: 0.78, cowl, ws, roof, rw, deckY: 0.98, tailY: 0.94, clear: 0.11, noseR: 0.42, tailR: 0.32,
    roofDrop: 0.04, tumble: 0.6, beltRise: 0.14, bulge: 0.04, charY: 0.45, sill: 0.08, hoodF: 0.66, bumpF: 0.08, bumpR: 0.1,
    hips: { w: 0.07, len: 1.3 }, fenders: { w: 0.04, len: 0.8 },
    win: [[cowl + ws * 0.4, cowl + ws + roof + rw * 0.12]], seams: [cowl + 0.12],
    sideBands: [{ d0: cowl + ws + roof * 0.6, d1: cowl + ws + roof + rw * 0.5, y0: 0.42, y1: 0.66, color: 0x0b0c0e }],
    blackPillars: "all", roofCol: 0x0e0f12,
    front: { lights: { w: 0.42, y0: 0.42, y1: 0.49, shape: "swoop", lamps: [{ a: 0.05, b: 0.95, v0: 0.35, v1: 0.65 }] },
      grille: { w: 1.1, y0: 0.18, y1: 0.36, color: rgb(0x0b0c0e) }, intakes: [{ s0: 0.5, s1: 0.85, y0: 0.16, y1: 0.4, shape: "trap" }], plate: false },
    rear: { lights: { w: 0.4, y0: 0.82, y1: 0.9 }, diffuser: 0.22, plate: false, exhaust: { x: [0.12], y: 0.42, r: 0.06 } },
    extras: { mirrorCol: 0x0e0f12 },
    wheel: "alloy", tireW: 0.29 };
  return merge(b, o);
}
// фургон: однообъёмник с коротким носом
function van(T, o) {
  const L = T.L, cowl = 0.17 * L, ws = 0.11 * L, roof = L - cowl - ws - 0.06, H = o.H || 1.96;
  const b = { ...dims(T), H, noseY: 0.92, hoodY: 1.08, cowl, ws, roof, rw: 0.03, deckY: H - 0.05, tailY: H - 0.06, clear: 0.18, noseR: 0.3, tailR: 0.14,
    roofDrop: 0.02, roofBow: 0.02, tumble: 0.12, beltRise: 0.0, archGap: 0.08, bumpF: 0.24, bumpR: 0.24, bumperCol: 0x2a2b2e, bumpTopF: 0.68, bumpTopR: 0.62,
    taper: 0.01, bulge: 0.015, rwGlass: false,
    win: [[cowl + ws * 0.3, cowl + ws + 0.85]], seams: [cowl + 0.08, cowl + ws + 0.9, cowl + ws + 1.75],
    blackPillars: true,
    front: { lights: { w: 0.36, y0: 0.82, y1: 0.95, shape: "swoop", lamps: [{ a: 0.1, b: 0.85, v0: 0.2, v1: 0.8 }] },
      grille: { w: 0.8, y0: 0.62, y1: 0.85, slats: 2 }, intakes: [{ s0: 0, s1: 0.5, y0: 0.3, y1: 0.4 }], plateY: 0.46 },
    rear: { lights: { w: 0.16, y0: 0.7, y1: 1.15 }, window: { w: 1.35, y0: 1.35, y1: 1.8 }, plateY: 0.56 },
    wheel: "steel", tireW: 0.22 };
  return merge(b, o);
}
// автобус / троллейбус / электробус: лицо и стекло на торце, окна по всему борту
function bus(T, o) {
  const L = T.L, H = o.H || 3.0;
  const doorsD = o.doors || [0.35, 4.6, 9.2];
  const win = [], dw = 1.25, pil = 0.12;
  for (let d = 0.5; d < L - 0.8; d += dw) {
    const d0 = d + pil / 2, d1 = d + dw - pil / 2;
    if (doorsD.some((q) => d1 > q - 0.05 && d0 < q + 1.25)) continue;
    win.push([d0, Math.min(d1, L - 0.9)]);
  }
  const b = { ...dims(T), H, noseY: H - 0.1, hoodY: H - 0.06, cowl: 0.08, ws: 0.06, roof: L - 0.3, rw: 0.08, deckY: H - 0.1, tailY: H - 0.12,
    clear: 0.3, noseR: 0.2, tailR: 0.16, roofDrop: 0, roofBow: 0, crown: 0.06, tumble: 0.05, sill: 0.03, rr: 0.16, beltRise: 0, bulge: 0.01,
    taper: 0, bumpF: 0.06, bumpR: 0.08, archGap: 0.06, wellW: 0.42, rwGlass: false, wsGlass: false,
    belt: [[0.08, 1.12], [L - 0.2, 1.12]], win,
    sideBands: doorsD.map((q) => ({ d0: q, d1: q + 1.2, y0: 0.4, y1: H - 0.35, color: 0x10161d, kind: 2 })),
    bumperCol: 0x2b2d31, bumpTopF: 0.62, bumpTopR: 0.62, blackPillars: true,
    front: { windshield: { w: T.W - 0.3, y0: 1.05, y1: H - 0.45 }, sign: { w: T.W - 0.6, y0: H - 0.4, y1: H - 0.16 },
      lights: { w: 0.42, y0: 0.42, y1: 0.6, lamps: [{ a: 0.1, b: 0.45, v0: 0.2, v1: 0.8, round: true }, { a: 0.52, b: 0.88, v0: 0.2, v1: 0.8, round: true }] },
      grille: { w: 0.9, y0: 0.66, y1: 0.86, color: rgb(0x2b2d31) }, plateY: 0.45, plate: true },
    rear: { lights: { w: 0.24, y0: 0.55, y1: 1.15 }, window: { w: T.W - 0.5, y0: 1.5, y1: H - 0.5 }, plateY: 0.55 },
    extras: { mirrors: false },
    wheel: "steel", tireW: 0.32, track: T.W - 0.36 };
  return merge(b, o);
}
// грузовик с кабиной над мотором: кабина-лофт + рама; кузов — коробка
function truck(T, o) {
  const H = o.H || 2.95, cab = o.cab || 2.25;
  const b = { ...dims(T), H, noseY: H - 0.12, hoodY: H - 0.08, cowl: 0.06, ws: 0.06, roof: cab - 0.22, rw: 0.06, deckY: 1.22, tailY: 1.22,
    clear: 0.42, noseR: 0.2, tailR: 0.1, roofDrop: 0.02, roofBow: 0, crown: 0.05, tumble: 0.06, sill: 0.03, rr: 0.12, beltRise: 0, bulge: 0.01,
    taper: 0, bumpF: 0.1, bumpR: 0.05, archGap: 0.07, wellW: 0.45, rwGlass: false, wsGlass: false, rwKink: true,
    belt: [[0.06, 1.75], [cab - 0.1, 1.75]], win: [[0.25, cab - 0.5]], seams: [0.2, cab - 0.45],
    topExtra: [[cab - 0.08, H - 0.05, "k"], [cab, 1.22, "k"]],
    bumperCol: 0x2b2d31, bumpTopF: 0.95, bumpTopR: 0.5, blackPillars: true,
    front: { windshield: { w: T.W - 0.3, y0: 1.85, y1: H - 0.25 },
      lights: { w: 0.4, y0: 0.72, y1: 0.9, lamps: [{ a: 0.1, b: 0.6, v0: 0.2, v1: 0.8 }, { a: 0.65, b: 0.9, v0: 0.2, v1: 0.8 }] },
      grille: { w: 1.4, y0: 1.0, y1: 1.6, slats: 5, color: rgb(0x23262a) }, plateY: 0.6 },
    rear: { plate: false },
    extras: { cargo: { d0: cab + 0.25, y0: 1.32, h: 2.4, w: T.W, color: rgb(0xe9ecef), doors: 3 } },
    wheel: "steel", tireW: 0.3, track: T.W - 0.34 };
  return merge(b, o);
}
// мотоциклы и тук-тук — свои модели в генераторе
const BIKE = (T, style) => ({ ...dims(T), style, wheel: "alloy", tireW: style === "sportbike" ? 0.17 : 0.13 });

/* ---- модели ---------------------------------------------------------------------------------------------- */
const RECIPES = {
  // угловатый заднеприводный седан старой школы: хром, прямоугольные фары, плоские борта
  stavr7: (T) => sedan(T, { H: 1.44, noseY: 0.72, hoodY: 0.9, hoodF: 0.8, deckY: 0.95, tailY: 0.93, noseR: 0.12, tailR: 0.1, tumble: 0.18, rr: 0.05,
    bulge: 0.0, roofBow: 0.0, roofDrop: 0.01, crown: 0.02, chromeBelt: true, bumperCol: 0xb8bec6, bumpTopF: 0.48, bumpTopR: 0.5, bumpZoneF: 0.15, bumpZoneR: 0.14,
    clear: 0.17, wheel: "steel", tireW: 0.18,
    front: { lights: { w: 0.4, y0: 0.56, y1: 0.69, shape: "rect", housing: rgb(0x9aa0a6), lamps: [{ a: 0.08, b: 0.46, v0: 0.12, v1: 0.88, round: true }, { a: 0.54, b: 0.92, v0: 0.12, v1: 0.88, round: true }] },
      grille: { w: 0.66, y0: 0.52, y1: 0.69, frame: rgb(0xc9cfd6), slats: 3, color: rgb(0x1b1d20) }, intakes: [], plateY: 0.34 },
    rear: { lights: { w: 0.42, y0: 0.66, y1: 0.82, rev: [0.06, 0.3, 0.2, 0.8] }, plateY: 0.48 } }),
  stavr: (T) => sedan(T, { H: 1.5, noseY: 0.7, hoodY: 0.94, deckY: 1.02, tailY: 0.98, bumperCol: null,
    front: { lights: { w: 0.42, y0: 0.56, y1: 0.68, shape: "swoop" }, grille: { w: 0.5, y0: 0.47, y1: 0.58, slats: 1, frame: rgb(0x9aa1a9) } },
    wheel: "steel" }),
  hanul: (T) => sedan(T, { H: 1.47, front: { lights: { w: 0.5, shape: "swoop" }, grille: { w: 0.6, y0: 0.4, y1: 0.55, frame: null, slats: 3, slatCol: rgb(0x3a3d42) } },
    rear: { lights: { w: 0.56, y0: 0.8, y1: 0.9, shape: "wedge" } } }),
  bremer: (T) => hatch(T, { H: 1.46,
    front: { lights: { w: 0.42, y0: 0.55, y1: 0.64, shape: "rect", lamps: [{ a: 0.08, b: 0.5, v0: 0.2, v1: 0.8, round: true }, { a: 0.55, b: 0.92, v0: 0.2, v1: 0.8, round: true }] },
      grille: { w: 0.66, y0: 0.55, y1: 0.63, slats: 0, color: rgb(0x16181b) }, intakes: [{ s0: 0, s1: 0.48, y0: 0.27, y1: 0.42 }] } }),
  // классический округлый седан 90-х: прочный, хром по поясу
  sedan: (T) => sedan(T, { H: 1.42, noseY: 0.68, hoodY: 0.9, deckY: 0.98, tailY: 0.96, noseR: 0.26, tailR: 0.22, tumble: 0.26, chromeBelt: true,
    bumperCol: 0x3a3c40, bumpTopF: 0.52, bumpTopR: 0.55, wheel: "steel",
    front: { lights: { w: 0.4, y0: 0.53, y1: 0.66, shape: "rect", lamps: [{ a: 0.08, b: 0.92, v0: 0.15, v1: 0.85 }], amber: [0.88, 0.98, 0.2, 0.8] },
      grille: { w: 0.5, y0: 0.53, y1: 0.66, slats: 3, frame: rgb(0xc9cfd6) }, intakes: [], plateY: 0.36 },
    rear: { lights: { w: 0.62, y0: 0.72, y1: 0.86, rev: [0.0, 0.18, 0.2, 0.8] }, plateY: 0.58 } }),
  vltava: (T) => fastback(T, { H: 1.47, roof: 0.2 * T.L, rw: 0.25 * T.L, wheel: "alloy", tireW: 0.22,
    front: { lights: { w: 0.5, y0: 0.54, y1: 0.64, shape: "swoop", lamps: [{ a: 0.1, b: 0.55, v0: 0.2, v1: 0.8 }, { a: 0.6, b: 0.9, v0: 0.2, v1: 0.8 }] },
      grille: { w: 0.7, y0: 0.44, y1: 0.6, frame: rgb(0xc9cfd6), bars: 9, slatCol: rgb(0x3a3d42) } },
    rear: { lights: { w: 0.5, y0: 0.82, y1: 0.93, shape: "wedge" } } }),
  xd_gr: (T) => sedan(T, { H: 1.47, beltRise: 0.07, front: { lights: { w: 0.54, y0: 0.55, y1: 0.64, shape: "swoop", drl: [0.05, 0.95, 0.05, 0.25] },
    grille: { w: 0.78, y0: 0.36, y1: 0.58, frame: rgb(0xc9cfd6), bars: 0, slats: 0, shape: "trap" } },
    rear: { lights: { w: 0.5, y0: 0.82, y1: 0.9 }, bar: { y0: 0.85, y1: 0.87 } } }),
  kaze3: (T) => hatch(T, { H: 1.44, noseY: 0.62, hoodY: 0.9, cowl: 0.3 * T.L, ws: 0.16 * T.L, roof: 0.27 * T.L, bulge: 0.05, beltRise: 0.12, tumble: 0.38,
    rw: T.L - 0.73 * T.L - 0.05, deckY: 1.0, tailY: 0.98, win: [[0.3 * T.L + 0.16 * T.L * 0.36, 0.3 * T.L + 0.16 * T.L + 0.27 * T.L * 0.45 - 0.05], [0.3 * T.L + 0.16 * T.L + 0.27 * T.L * 0.45 + 0.05, 0.3 * T.L + 0.16 * T.L + 0.27 * T.L * 0.98]],
    front: { lights: { w: 0.42, y0: 0.52, y1: 0.6, shape: "swoop", lamps: [{ a: 0.1, b: 0.8, v0: 0.3, v1: 0.7 }] },
      grille: { w: 0.8, y0: 0.3, y1: 0.52, frame: null, color: rgb(0x0e0f11), shape: "trap" }, intakes: [] },
    rear: { lights: { w: 0.42, y0: 0.82, y1: 0.92, lamps: [{ a: 0.08, b: 0.45, v0: 0.15, v1: 0.85, round: true }, { a: 0.52, b: 0.9, v0: 0.15, v1: 0.85, round: true }] } },
    wheel: "alloy", tireW: 0.22 }),
  xd_cool: (T) => cross(T, { H: 1.61, front: { lights: { w: 0.42, y0: 0.74, y1: 0.8, drl: [0.0, 1.0, 0.1, 0.5] },
    grille: { w: 0.84, y0: 0.44, y1: 0.72, frame: rgb(0xc9cfd6), bars: 0, slats: 0, shape: "trap" } }, roofCol: 0x16181b }),
  xd_atl: (T) => cross(T, { H: 1.69, noseY: 0.88, hoodY: 1.1, front: { lights: { w: 0.46, y0: 0.74, y1: 0.86, shape: "swoop" },
    grille: { w: 0.92, y0: 0.44, y1: 0.76, frame: rgb(0xc9cfd6), slats: 5 } }, rear: { bar: { y0: 1.02, y1: 1.04 } } }),
  tundrus: (T) => suv(T, { H: 1.92, front: { grille: { w: 0.98, slats: 3, bars: 0 } } }),
  rhein_f: (T) => suv(T, { H: 1.76, noseY: 0.92, hoodY: 1.12, roofDrop: 0.08, tumble: 0.28, rwKink: false, cowl: 0.29 * T.L, roof: 0.48 * T.L,
    rw: T.L - 0.29 * T.L - 0.12 * T.L - 0.48 * T.L - 0.1, deckY: 1.2, tailY: 1.16, bumperCol: null, lowerCol: 0x1d1e21, noseR: 0.32, tailR: 0.26, rr: 0.07, bulge: 0.035,
    front: { lights: { w: 0.42, y0: 0.82, y1: 0.9, shape: "swoop", lamps: [{ a: 0.1, b: 0.85, v0: 0.25, v1: 0.75 }] },
      grille: { w: 0.66, y0: 0.62, y1: 0.86, frame: rgb(0xc9cfd6), bars: 7, shape: "rect" } },
    rear: { lights: { w: 0.44, y0: 0.98, y1: 1.08, s0: null, shape: "wedge" }, window: null, exhaust: { x: [0.55], y: 0.36 } }, extras: { rails: null }, wheel: "alloy" }),
  yamaki: (T) => sedan(T, { H: 1.45, beltRise: 0.06, front: { lights: { w: 0.5, shape: "swoop", drl: [0.1, 0.9, 0.0, 0.2] },
    grille: { w: 0.9, y0: 0.32, y1: 0.54, shape: "trap", frame: null, slats: 4, slatCol: rgb(0x2a2d31) } }, rear: { lights: { w: 0.6, y0: 0.83, y1: 0.92, shape: "wedge" } } }),
  kronw: (T) => sedan(T, { H: 1.47, noseY: 0.68, hoodY: 0.95, chromeBelt: true, cowl: 0.3 * T.L,
    front: { lights: { w: 0.46, y0: 0.55, y1: 0.65, shape: "swoop", lamps: [{ a: 0.08, b: 0.92, v0: 0.3, v1: 0.7 }] },
      grille: { w: 0.6, y0: 0.4, y1: 0.62, frame: rgb(0xd6dbe1), slats: 2, slatCol: rgb(0xd6dbe1), color: rgb(0x0e0f11) } },
    rear: { lights: { w: 0.52, y0: 0.8, y1: 0.92, shape: "wedge" }, exhaust: { x: [0.55], y: 0.24 } }, wheel: "multi", tireW: 0.23 }),
  rhein: (T) => sedan(T, { H: 1.48, cowl: 0.3 * T.L, ws: 0.16 * T.L, beltRise: 0.08, bulge: 0.045,
    front: { lights: { w: 0.46, y0: 0.55, y1: 0.64, shape: "swoop", lamps: [{ a: 0.1, b: 0.42, v0: 0.15, v1: 0.85, round: true }, { a: 0.5, b: 0.82, v0: 0.15, v1: 0.85, round: true }] },
      grille: [{ w: 0.18, y0: 0.47, y1: 0.63, frame: rgb(0xd6dbe1), shape: "pill" }], intakes: [{ s0: 0.05, s1: 0.75, y0: 0.27, y1: 0.42 }] },
    rear: { lights: { w: 0.52, y0: 0.82, y1: 0.92, shape: "wedge" }, exhaust: { x: [0.5], y: 0.24 } }, wheel: "alloy", tireW: 0.24 }),
  ingw: (T) => sedan(T, { H: 1.43, beltRise: 0.05,
    front: { lights: { w: 0.48, y0: 0.55, y1: 0.63, shape: "swoop", drl: [0.05, 0.9, 0.7, 0.95] },
      grille: { w: 0.66, y0: 0.32, y1: 0.6, frame: rgb(0xc9cfd6), slats: 4, slatCol: rgb(0x34373c), shape: "trap" } },
    rear: { lights: { w: 0.54, y0: 0.82, y1: 0.91 } } }),
  ingw_st: (T) => fastback(T, { H: 1.42, bulge: 0.06, roof: 0.15 * T.L, rw: 0.3 * T.L, tumble: 0.42,
    front: { lights: { w: 0.5, y0: 0.53, y1: 0.61, shape: "swoop", drl: [0.0, 1.0, 0.0, 0.2] },
      grille: { w: 0.86, y0: 0.28, y1: 0.58, color: rgb(0x0b0c0e), frame: rgb(0x2a2d31), shape: "trap" }, intakes: [{ s0: 0.6, s1: 0.85, y0: 0.24, y1: 0.46 }] },
    rear: { lights: { w: 0.5, y0: 0.84, y1: 0.9 }, bar: { y0: 0.86, y1: 0.88 }, diffuser: 0.12, exhaust: { x: [0.55], y: 0.24, r: 0.06 } },
    extras: { lip: true }, wheel: "alloy", tireW: 0.27 }),
  kronw_i: (T) => sedan(T, { H: 1.5, noseY: 0.72, hoodY: 0.98, chromeBelt: true, cowl: 0.29 * T.L, roof: 0.27 * T.L, rw: 0.12 * T.L, tailR: 0.32,
    front: { lights: { w: 0.48, y0: 0.58, y1: 0.68, shape: "swoop", lamps: [{ a: 0.08, b: 0.92, v0: 0.3, v1: 0.7 }] },
      grille: { w: 0.7, y0: 0.4, y1: 0.68, frame: rgb(0xd6dbe1), slats: 4, slatCol: rgb(0xd6dbe1) } },
    rear: { lights: { w: 0.6, y0: 0.84, y1: 0.96, shape: "wedge" }, exhaust: { x: [0.6], y: 0.24, color: rgb(0xd6dbe1) } }, wheel: "multi", tireW: 0.24 }),
  // ультралюкс: высокий вертикальный нос с крупной хромовой решёткой своего рисунка, длинный капот, две краски
  ashbury: (T) => sedan(T, { H: 1.64, noseY: 0.92, hoodY: 1.06, hoodF: 1.0, cowl: 0.33 * T.L, ws: 0.13 * T.L, roof: 0.27 * T.L, rw: 0.1 * T.L, deckY: 1.1, tailY: 1.06,
    noseR: 0.2, tailR: 0.3, crown: 0.02, tumble: 0.2, bulge: 0.02, chromeBelt: true, roofCol: 0x14161a, clear: 0.17, beltRise: 0.02,
    front: { lights: { w: 0.36, y0: 0.74, y1: 0.86, shape: "rect", lamps: [{ a: 0.06, b: 0.94, v0: 0.35, v1: 0.65 }] },
      grille: { w: 0.62, y0: 0.42, y1: 0.9, frame: rgb(0xe3e7ec), bars: 11, slatCol: rgb(0xe3e7ec), color: rgb(0x2a2d31) }, intakes: [{ s0: 0.4, s1: 0.75, y0: 0.32, y1: 0.4 }], plateY: 0.3 },
    rear: { lights: { w: 0.22, y0: 0.72, y1: 1.0, shape: "rect" }, plateY: 0.6, exhaust: { x: [0.55], y: 0.26, color: rgb(0xe3e7ec) } },
    wheel: "multi", tireW: 0.26 }),
  crewf: (T) => coupe(T, { H: 1.4, noseY: 0.66, hoodY: 0.92, bulge: 0.04, chromeBelt: true, hips: { w: 0.06, len: 1.2 },
    front: { lights: { w: 0.4, y0: 0.56, y1: 0.66, lamps: [{ a: 0.06, b: 0.48, v0: 0.1, v1: 0.9, round: true }, { a: 0.54, b: 0.94, v0: 0.1, v1: 0.9, round: true }] },
      grille: { w: 0.66, y0: 0.32, y1: 0.6, frame: rgb(0xd6dbe1), color: rgb(0x1a1c1f), slats: 5, bars: 6, slatCol: rgb(0x8a9099), shape: "pill" } },
    rear: { lights: { w: 0.36, y0: 0.78, y1: 0.88, shape: "pill" }, exhaust: { x: [0.55], y: 0.26, r: 0.06 } }, wheel: "multi", tireW: 0.27 }),
  // заднемоторное купе: круглые фары на крыльях, покатая корма с решёткой мотора, световая полоса сзади
  sport: (T) => coupe(T, { H: 1.3, noseY: 0.56, hoodY: 0.82, hoodF: 0.7, cowl: 0.29 * T.L, ws: 0.17 * T.L, roof: 0.12 * T.L, rw: 0.33 * T.L, deckY: 0.98, tailY: 0.92,
    noseR: 0.42, tailR: 0.38, bulge: 0.04, charY: 0.62, roofDrop: 0.06, rwKink: false, rwGlassFrac: 0.5, hips: { w: 0.07, len: 1.2 }, fenders: { w: 0.03 },
    vents: [[0.29 * T.L + 0.17 * T.L + 0.12 * T.L + 0.33 * T.L * 0.55, 0.29 * T.L + 0.17 * T.L + 0.12 * T.L + 0.33 * T.L * 0.95]],
    win: [[0.29 * T.L + 0.17 * T.L * 0.36, 0.29 * T.L + 0.17 * T.L + 0.12 * T.L + 0.33 * T.L * 0.22]],
    front: { lights: null, topLamps: [{ d0: 0.04, d1: 0.36, x: T.W / 2 - 0.36, w: 0.3 }],
      grille: null, intakes: [{ s0: 0.05, s1: 0.32, y0: 0.22, y1: 0.36 }, { s0: 0.45, s1: 0.72, y0: 0.22, y1: 0.4 }], plateY: 0.36 },
    rear: { lights: { w: 0.42, y0: 0.74, y1: 0.8 }, bar: { y0: 0.765, y1: 0.785 }, exhaust: { x: [0.08], y: 0.24, r: 0.05 }, plateY: 0.44 },
    extras: { lip: true }, wheel: "alloy", tireW: 0.26 }),
  kaze_rd: (T) => coupe(T, { H: 1.24, noseY: 0.6, hoodY: 0.84, cowl: 0.4 * T.L, ws: 0.13 * T.L, roof: 0.08 * T.L, rw: 0.13 * T.L, deckY: 0.9, tailY: 0.9,
    roofCol: 0x16181b, tumble: 0.3, bulge: 0.06,
    win: [[0.4 * T.L + 0.13 * T.L * 0.4, 0.4 * T.L + 0.13 * T.L + 0.08 * T.L + 0.02]],
    front: { lights: { w: 0.34, y0: 0.5, y1: 0.58, shape: "swoop" }, grille: { w: 0.5, y0: 0.3, y1: 0.46, shape: "pill", color: rgb(0x0e0f11) } },
    rear: { lights: { w: 0.34, y0: 0.72, y1: 0.8, lamps: [{ a: 0.1, b: 0.9, v0: 0.15, v1: 0.85, round: true }] } }, wheel: "alloy", tireW: 0.22 }),
  // маслкар: длинный капот, короткая корма, широкая решётка с утопленными фарами, воздухозаборник
  muscle: (T) => coupe(T, { H: 1.38, noseY: 0.76, hoodY: 0.95, hoodF: 0.9, noseR: 0.18, tailR: 0.16, cowl: 0.4 * T.L, ws: 0.15 * T.L, roof: 0.15 * T.L, rw: 0.17 * T.L,
    deckY: 0.98, tailY: 0.96, tumble: 0.3, bulge: 0.05, charY: 0.7, rwKink: true,
    front: { lights: { w: 0.26, s0: 0.5, y0: 0.6, y1: 0.73, shape: "rect", housing: rgb(0x111316), lamps: [{ a: 0.15, b: 0.85, v0: 0.12, v1: 0.88, round: true }] },
      grille: { w: 1.5, y0: 0.56, y1: 0.75, color: rgb(0x0e0f11), frame: null }, intakes: [{ s0: 0.1, s1: 0.6, y0: 0.27, y1: 0.38 }], plateY: 0.42 },
    rear: { lights: { w: 0.66, y0: 0.76, y1: 0.88, lamps: [{ a: 0.04, b: 0.96, v0: 0.2, v1: 0.8 }] }, exhaust: { x: [0.6], y: 0.26, r: 0.055 } },
    extras: { scoop: true, lip: true, stripes: ((c, w, r, rw) => [[0.05, c - 0.03], [c + w + 0.03, c + w + r - 0.02], [c + w + r + rw + 0.03, T.L - 0.04]])(0.4 * T.L, 0.15 * T.L, 0.15 * T.L, 0.17 * T.L)
      .map((q) => ({ d0: q[0], d1: q[1], x0: 0.1, x1: 0.24, color: rgb(0xf1faee) })) },
    hips: { w: 0.04, len: 1.1 }, sideBands: [], wheel: "alloy", tireW: 0.27 }),
  ev: (T) => fastback(T, { H: 1.44, noseY: 0.6, hoodY: 0.88, hoodF: 0.76, cowl: 0.26 * T.L, ws: 0.19 * T.L, roof: 0.19 * T.L, rw: 0.24 * T.L, roofCol: "glass",
    front: { lights: { w: 0.42, y0: 0.56, y1: 0.62, shape: "swoop", lamps: [{ a: 0.05, b: 0.95, v0: 0.3, v1: 0.7 }] }, grille: null,
      intakes: [{ s0: 0.0, s1: 0.4, y0: 0.27, y1: 0.36 }], plateY: 0.36 },
    rear: { lights: { w: 0.4, y0: 0.84, y1: 0.9, shape: "wedge" }, bar: { y0: 0.86, y1: 0.875 } }, wheel: "alloy" }),
  // электрички (22.11): кубик-хэтч, электрокроссовер, большой электро-SUV, лифтбек «Молния», электрогиперкар
  ev_cube: (T) => hatch(T, { H: 1.52, roofCol: 0x16181b,
    front: { lights: { w: 0.44, y0: 0.6, y1: 0.66, shape: "rect", drl: [0.0, 1.0, 0.1, 0.4] }, grille: null, intakes: [{ s0: 0, s1: 0.5, y0: 0.28, y1: 0.36 }] } }),
  xd_ev: (T) => cross(T, { H: 1.6, roofCol: 0x16181b, front: { lights: { w: 0.5, y0: 0.74, y1: 0.78, drl: [0.0, 1.0, 0.0, 0.6] },
    grille: null, intakes: [{ s0: 0.0, s1: 0.6, y0: 0.3, y1: 0.42 }] } }),
  ev_x: (T) => suv(T, { H: 1.74, noseY: 0.9, hoodY: 1.08, roofDrop: 0.1, tumble: 0.3, rwKink: false, roofCol: "glass",
    front: { lights: { w: 0.44, y0: 0.8, y1: 0.86, shape: "swoop", drl: [0.0, 1.0, 0.0, 0.3] }, grille: null } }),
  ev_bolt: (T) => fastback(T, { H: 1.42, noseY: 0.58, hoodY: 0.86, hoodF: 0.74, cowl: 0.26 * T.L, ws: 0.2 * T.L, roof: 0.2 * T.L, rw: 0.25 * T.L, roofCol: "glass",
    front: { lights: { w: 0.42, y0: 0.55, y1: 0.6, shape: "swoop", lamps: [{ a: 0.05, b: 0.95, v0: 0.3, v1: 0.7 }] }, grille: null,
      intakes: [{ s0: 0.0, s1: 0.5, y0: 0.26, y1: 0.34 }], plateY: 0.35 },
    rear: { lights: { w: 0.44, y0: 0.82, y1: 0.88, shape: "wedge" }, bar: { y0: 0.85, y1: 0.865 } }, wheel: "alloy" }),
  ev_hyper: (T) => wedge(T, { H: 1.18, noseY: 0.52, hoodY: 0.78, roofCol: 0x0e0f12, bulge: 0.07, noseR: 0.46, tailR: 0.42,
    front: { lights: { w: 0.42, y0: 0.42, y1: 0.47, shape: "swoop", drl: [0.0, 1.0, 0.0, 0.25] }, grille: null },
    rear: { bar: { y0: 0.8, y1: 0.84 }, lights: { w: 0.5, y0: 0.78, y1: 0.84 }, diffuser: 0.3 },
    extras: { wing: { d: 0.18, h: 0.1, span: 0.8, chord: 0.3, color: 0x0e0f12 } } }),
  // самые быстрые: «Вихрь» (440 км/ч) и «Ураган 500»
  tauro_v: (T) => wedge(T, { H: 1.12, front: { lights: { w: 0.42, y0: 0.38, y1: 0.44, shape: "wedge" } },
    rear: { lights: { w: 0.46, y0: 0.78, y1: 0.84 }, exhaust: { x: [0.1, 0.2], y: 0.48, r: 0.07 } }, extras: { wing: { d: 0.22, h: 0.18, span: 0.86, chord: 0.34 } } }),
  hyper500: (T) => wedge(T, { H: 1.14, noseY: 0.5, hoodY: 0.76, roofCol: 0x0e0f12, bulge: 0.09, noseR: 0.5, tailR: 0.44, blackPillars: true,
    front: { lights: { w: 0.36, y0: 0.42, y1: 0.48, shape: "swoop", drl: [0.0, 1.0, 0.0, 0.3] }, grille: { w: 0.8, y0: 0.16, y1: 0.38, shape: "pill", frame: rgb(0x8a9099) } },
    rear: { bar: { y0: 0.82, y1: 0.86 }, lights: { w: 0.6, y0: 0.8, y1: 0.86 }, diffuser: 0.34, exhaust: { x: [0.0001, 0.12], y: 0.38, r: 0.08 } },
    extras: { wing: { d: 0.3, h: 0.22, span: 0.9, chord: 0.4, color: 0x0e0f12 } } }),
  tauro: (T) => wedge(T, { H: 1.17, front: { lights: { w: 0.44, y0: 0.4, y1: 0.47, shape: "wedge" } },
    rear: { lights: { w: 0.42, y0: 0.8, y1: 0.86 }, exhaust: { x: [0.1], y: 0.5, r: 0.07 } }, extras: { wing: { d: 0.2, h: 0.12, span: 0.82, chord: 0.3 } } }),
  corsaro: (T) => wedge(T, { H: 1.21, noseY: 0.52, roofCol: null, blackPillars: true, tumble: 0.5,
    sideBands: [{ d0: 0.3 * T.L + 0.19 * T.L + 0.1 * T.L * 0.5, d1: 0.3 * T.L + 0.19 * T.L + 0.1 * T.L + 0.3 * T.L * 0.4, y0: 0.4, y1: 0.62, color: 0x0b0c0e }],
    front: { lights: { w: 0.38, y0: 0.44, y1: 0.51, shape: "swoop" }, grille: { w: 0.9, y0: 0.2, y1: 0.36 } },
    rear: { lights: { w: 0.5, y0: 0.78, y1: 0.86, lamps: [{ a: 0.12, b: 0.42, v0: 0.1, v1: 0.9, round: true }, { a: 0.55, b: 0.85, v0: 0.1, v1: 0.9, round: true }] }, exhaust: { x: [0.35], y: 0.36, r: 0.06 } },
    extras: { lip: true } }),
  hyper: (T) => wedge(T, { H: 1.2, noseY: 0.54, hoodY: 0.8, roofCol: 0x0e0f12, bulge: 0.08, noseR: 0.48, tailR: 0.4,
    front: { lights: { w: 0.4, y0: 0.44, y1: 0.5, shape: "swoop", drl: [0.0, 1.0, 0.0, 0.3] }, grille: { w: 0.7, y0: 0.18, y1: 0.4, shape: "pill", frame: rgb(0x8a9099) } },
    rear: { bar: { y0: 0.84, y1: 0.87 }, lights: { w: 0.3, y0: 0.82, y1: 0.89 }, diffuser: 0.28, exhaust: { x: [0.0001], y: 0.4, r: 0.07 } },
    extras: { wing: { d: 0.25, h: 0.16, span: 0.86, chord: 0.36, color: 0x0e0f12 } } }),
  van: (T) => van(T, {}),
  marsh: (T) => van(T, { H: 2.62, noseY: 0.95, hoodY: 1.12, cowl: 0.15 * T.L, ws: 0.1 * T.L, roof: T.L * 0.75 - 0.06, rwGlass: false,
    win: [[0.15 * T.L + 0.1 * T.L * 0.3, 0.15 * T.L + 0.1 * T.L + 0.75], [0.15 * T.L + 0.1 * T.L + 0.85, 0.15 * T.L + 0.1 * T.L + 1.95], [0.15 * T.L + 0.1 * T.L + 2.05, T.L - 0.35]],
    belt: [[0.15 * T.L, 1.12], [T.L - 0.1, 1.2]],
    sideBands: [{ d0: 0.15 * T.L + 0.1 * T.L + 0.8, d1: 0.15 * T.L + 0.1 * T.L + 1.95, y0: 0.45, y1: 2.2, color: 0x10161d, kind: 2 }],
    front: { sign: { w: 1.1, y0: 2.3, y1: 2.5 } }, rear: { window: { w: 1.5, y0: 1.4, y1: 2.3 }, lights: { w: 0.16, y0: 0.62, y1: 1.2 } } }),
  bus: (T) => bus(T, {}),
  ebus: (T) => bus(T, { H: 3.0, extras: { batteries: { d: 3.2, n: 3 } }, front: { grille: { w: 0.9, y0: 0.66, y1: 0.86, color: rgb(0x2a9d8f) } } }),
  troll: (T) => bus(T, { H: 3.05, extras: { poles: { d: 2.4 } }, doors: [0.35, 4.4, 9.0] }),
  truck: (T) => truck(T, {}),
  fire: (T) => truck(T, { H: 3.0, cab: 2.6, win: [[0.25, 2.05]], seams: [0.2, 1.3, 2.1],
    extras: { cargo: { d0: 2.8, y0: 1.32, h: 1.8, w: T.W, color: null, kind: 1, ladder: true, stripe: rgb(0xf1faee), doors: 4 },
      beacons: [[0.7, 3.12, 0.6], [-0.7, 3.12, 0.6]], boxes: [[0, 3.02, 0.6, 1.8, 0.12, 0.3, rgb(0x16181b)]] } }),
  moto: (T) => BIKE(T, "sportbike"),
  moto_c: (T) => BIKE(T, "bike"),
  tuk: (T) => ({ ...dims(T), style: "tuk", wheel: "steel", tireW: 0.16 })
};

// раскраски на базе моделей: такси, патруль, скорая
function variants(id, T) {
  if (id === "taxi") {     // шашечки по дверям и фонарь на крыше
    const r = RECIPES.hanul(T), d0 = r.cowl + 0.08, d1 = r.cowl + r.ws + r.roof + 0.1;
    return merge(r, { extras: { taxi: true }, checker: [d0, d1, 0.1],
      sideBands: [{ d0, d1, y0: 0.66, y1: 0.77, color: 0x111111, color2: 0xf2f2f2, checker: 0.1 }] });
  }
  if (id === "police") {
    const r = RECIPES.yamaki(T), d0 = r.cowl - 0.6, d1 = r.cowl + r.ws + r.roof + r.rw;
    return merge(r, { extras: { lightbar: true }, sideBands: [{ d0, d1, y0: 0.56, y1: 0.76, color: 0x1d4ed8 }],
      front: { grille: { w: 0.9, y0: 0.32, y1: 0.54, color: rgb(0x16181b), slats: 0, frame: null, shape: "trap" } } });
  }
  if (id === "ambulance") {
    const r = RECIPES.marsh(T);
    return merge(r, { H: 2.72, sideBands: [{ d0: 0.4, d1: T.L - 0.1, y0: 0.95, y1: 1.12, color: 0xd62828 }, { d0: 0.4, d1: T.L - 0.1, y0: 1.12, y1: 1.2, color: 0xffb703 }],
      extras: { beacons: [[0.7, 2.82, 1.25], [-0.7, 2.82, 1.25]], boxes: [[0, 2.74, 1.25, 1.6, 0.1, 0.28, rgb(0x16181b)]] }, front: { sign: null } });
  }
  return null;
}

function recipe(id, T) {
  const v = variants(id, T);
  if (v) return v;
  const f = RECIPES[id];
  if (!f) throw new Error("нет рецепта кузова: " + id);
  return f(T);
}

// силуэты дальнего плана: тип → какой рецепт берём упрощённым
const LOD_OF = { sedan: "hanul", hatch: "bremer", biz: "yamaki", limo: "kronw_i", coupe: "sport", super: "tauro", cross: "xd_cool", suv: "tundrus",
  van: "van", marsh: "marsh", bus: "bus", truck: "truck", moto: "moto", tuk: "tuk" };

module.exports = { recipe, LOD_OF };
