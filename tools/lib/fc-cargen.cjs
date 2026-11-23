/* Генератор кузовов машин Флейм-Сити — параметрические модели (своя работа, без чужих моделей и брендов).
 *
 * Кузов — «лофт»: сечения поперёк машины (станции по длине), у каждого сечения 15 точек половины контура — днище,
 * колёсная арка, борт с «линией характера», плечо, стекло с завалом внутрь, крыша. Высоты и ширины по длине — гладкие
 * кривые из параметров рецепта (капот, лобовое, крыша, заднее стекло, багажник). Фары, решётка, фонари, номера —
 * «наклейки» по поверхности носа и кормы (обходят скруглённые углы), зеркала, спойлеры, рейлинги, штанги — коробки.
 *
 * На выходе — треугольники с атрибутами: позиция, нормаль (гладкая, с изломом на рёбрах > 35°), цвет и «вид»
 * поверхности (K): краска красится цветом экземпляра, стекло блестит, фары и фонари светятся ночью, хром — металл.
 * Ось машины: +z — вперёд, y — вверх, x — влево; земля y = 0, центр кузова по длине — z = 0.
 */
"use strict";

const K = { TRIM: 0, PAINT: 1, GLASS: 2, CHROME: 3, HEAD: 4, TAIL: 5, RUBBER: 6, SIGN: 7, AMBER: 8, RIM: 9 };

/* ---- цвета: sRGB hex → линейные (вершинные цвета glTF — линейные) ---------------------------------------------- */
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function rgb(hex) { return [lin((hex >> 16) & 255), lin((hex >> 8) & 255), lin(hex & 255)]; }
const C = {
  white: rgb(0xffffff), dark: rgb(0x16181b), black: rgb(0x0b0c0e), plastic: rgb(0x26282c), chrome: rgb(0xc9cfd6),
  glass: rgb(0x18222c), head: rgb(0xfff3dc), headLens: rgb(0x2a3038), tail: rgb(0xd5141a), tailDark: rgb(0x5a0a0d),
  amber: rgb(0xff9a1f), plate: rgb(0xe9ecef), rubber: rgb(0x101112), grille: rgb(0x111316), rev: rgb(0xd9dde2)
};
function col(v) { return typeof v === "number" ? rgb(v) : v; }

/* ---- накопитель треугольников ----------------------------------------------------------------------------- */
class Mesh {
  constructor() { this.p = []; this.n = []; this.c = []; this.k = []; }
  vert(p, n, c, k) { this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.c.push(c[0], c[1], c[2]); this.k.push(k); }
  tri(a, b, c, na, nb, nc, color, kind) {
    const fn = faceN(a, b, c);
    if (!fn) return;
    this.vert(a, na || fn, color, kind); this.vert(b, nb || fn, color, kind); this.vert(c, nc || fn, color, kind);
  }
  quad(a, b, c, d, color, kind, na, nb, nc, nd) { this.tri(a, b, c, na, nb, nc, color, kind); this.tri(a, c, d, na, nc, nd, color, kind); }
  add(m) { this.p.push(...m.p); this.n.push(...m.n); this.c.push(...m.c); this.k.push(...m.k); }
  // грань, развёрнутая наружу по подсказке направления (dir — вектор, куда должна смотреть нормаль)
  quadDir(a, b, c, d, dir, color, kind, na, nb, nc, nd) {
    const fn = faceN(a, b, c) || faceN(a, c, d);
    if (!fn) return;
    if (dot(fn, dir) >= 0) this.quad(a, b, c, d, color, kind, na, nb, nc, nd);
    else this.quad(a, d, c, b, color, kind, na, nd, nc, nb);
  }
  triDir(a, b, c, dir, color, kind) {
    const fn = faceN(a, b, c);
    if (!fn) return;
    if (dot(fn, dir) >= 0) this.tri(a, b, c, null, null, null, color, kind); else this.tri(a, c, b, null, null, null, color, kind);
  }
  get tris() { return this.p.length / 9; }
}
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(v) { const l = Math.hypot(v[0], v[1], v[2]); return l < 1e-12 ? null : [v[0] / l, v[1] / l, v[2] / l]; }
function faceN(a, b, c) { return norm(cross(sub(b, a), sub(c, a))); }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

/* Монотонная кубическая кривая по точкам [[x, y, "k"?], ...]: "k" — излом (касательные слева и справа свои). */
function curve(pts) {
  pts = pts.slice().sort((a, b) => a[0] - b[0]);
  const P = [];
  pts.forEach((p) => { if (P.length && Math.abs(P[P.length - 1][0] - p[0]) < 1e-4) P[P.length - 1] = p; else P.push(p); });
  const n = P.length, xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
  if (n === 1) return () => ys[0];
  const d = [], mL = new Array(n), mR = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  mL[0] = mR[0] = d[0]; mL[n - 1] = mR[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (P[i][2] === "k") { mL[i] = d[i - 1]; mR[i] = d[i]; continue; }
    const m = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    mL[i] = mR[i] = m;
  }
  for (let i = 0; i < n - 1; i++) {        // Фрич — Карлсон: без перелётов
    if (Math.abs(d[i]) < 1e-9) { mR[i] = 0; mL[i + 1] = 0; continue; }
    const a = mR[i] / d[i], b = mL[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); mR[i] = t * a * d[i]; mL[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * mR[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * mL[i + 1];
  };
}

/* ================================================================================================================
 * Кузов-лофт. Рецепт (все длины в метрах, d — расстояние от переднего края):
 *   L, W, wb, wr, fo (передний свес до оси), clear (просвет), noseY/hoodY/cowl/ws/roof/rw/deckY/tailY/H — профиль,
 *   noseR/tailR — скругление углов в плане, tumble — завал стёкол, win — проёмы боковых окон [[d0, d1], ...].
 * ================================================================================================================ */
const RING = 15;      // точек в половине сечения
function bodyFns(R) {
  const L = R.L, W = R.W;
  const rwBase = R.cowl + R.ws + R.roof + R.rw;           // низ заднего стекла
  const topPts = [
    [0, R.noseY], [R.noseR * 0.3, R.noseY + (R.hoodF - R.noseY) * 0.55], [R.noseR, R.hoodF],
    [R.cowl, R.hoodY, "k"], [R.cowl + R.ws * 0.55, lerp(R.hoodY, R.H, 0.72)], [R.cowl + R.ws, R.H],
    [R.cowl + R.ws + R.roof * 0.5, R.H + R.roofBow], [R.cowl + R.ws + R.roof, R.H - R.roofDrop],
    [rwBase, R.deckY, R.rwKink ? "k" : undefined]
  ];
  if (rwBase < L - 0.12) topPts.push([lerp(rwBase, L, 0.6), lerp(R.deckY, R.tailY, 0.35) + R.deckBow], [L - R.tailR * 0.3, R.tailY + 0.02]);
  topPts.push([L, R.tailY]);
  (R.topExtra || []).forEach((p) => topPts.push(p));
  const top = curve(topPts);
  const botF = R.bumpF, botR = R.bumpR;
  const bot = curve([[0, R.clear + botF], [R.noseR * 0.5, R.clear + botF * 0.35], [R.noseR * 1.4, R.clear],
    [L - R.tailR * 1.4, R.clear], [L - R.tailR * 0.5, R.clear + botR * 0.35], [L, R.clear + botR]]);
  // пояс (низ боковых стёкол): от лобового к заднему стеклу, на капоте и багажнике — по поверхности
  const beltG = curve(R.belt || [[R.cowl, R.hoodY - R.crown], [rwBase, R.deckY - R.crown + R.beltRise]]);
  const belt = (d) => {
    const t = top(d) - R.crown;
    if (d <= R.cowl || d >= rwBase) return t;
    return Math.min(t, beltG(d));
  };
  // половина ширины в плане: скруглённые углы носа и кормы, лёгкое сужение к носу
  const hw = (d) => {
    let h = W / 2;
    if (d < R.noseR) { const u = R.noseR - d; h = W / 2 - R.noseR + Math.sqrt(Math.max(0, R.noseR * R.noseR - u * u)); }
    else if (d > L - R.tailR) { const u = d - (L - R.tailR); h = W / 2 - R.tailR + Math.sqrt(Math.max(0, R.tailR * R.tailR - u * u)); }
    h *= 1 - R.taper * (1 - d / L);
    if (R.hips) { const u = (d - (L - R.fo - R.wb + (R.hips.at || 0))) / (R.hips.len || 1.1); if (Math.abs(u) < 1) h += R.hips.w * (1 - u * u) * (1 - u * u); }
    if (R.fenders) { const u = (d - R.fo) / (R.fenders.len || 0.9); if (Math.abs(u) < 1) h += R.fenders.w * (1 - u * u) * (1 - u * u); }
    return h;
  };
  const zf = L / 2 - R.fo, zr = zf - R.wb;                 // оси (z)
  const archR = R.wr + R.archGap;
  const arch = (d) => {
    const z = L / 2 - d;
    let y = 0;
    [zf, zr].forEach((za, i) => {
      if (i === 1 && R.dually) za = [zr, zr + R.dually];
      [].concat(za).forEach((q) => {
        const dz = Math.abs(z - q);
        if (dz < archR) y = Math.max(y, R.wr * R.archLift + Math.sqrt(archR * archR - dz * dz));
      });
    });
    return y;
  };
  return { top, bot, belt, hw, arch, rwBase, zf, zr, archR };
}

// сечение на расстоянии d: 15 точек [x, y] от низа по центру до центра крыши + сведения для раскраски
function ringAt(R, F, d) {
  const yB = F.bot(d), yBt = F.belt(d), yT = F.top(d), h = F.hw(d), yA = Math.max(yB, Math.min(F.arch(d), yBt - 0.12));
  const gh = clamp((yT - R.crown - yBt - 0.02) / 0.18, 0, 1);
  const rb = Math.min(R.rb, (yBt - yA) * 0.3), sh = Math.min(R.sh, (yBt - yA) * 0.25);
  const xin = Math.max(0.05, Math.min(h - R.wellW, h * 0.62));
  const bulge = R.bulge * smooth((yBt - yA) / 0.4);
  const yMid = yA + (yBt - yA) * R.charY;
  const xs = h - sh * 0.6;                                 // плечо
  const ghH = Math.max(0, yT - R.crown - yBt);
  const xg0 = xs - R.sill;                                 // низ стекла
  const xg1 = xg0 - R.tumble * ghH;                        // верх стекла
  const rr = Math.min(R.rr, ghH * 0.35);
  const xr = Math.max(0.1, xg1 - rr);                      // край крыши
  const hoodEdge = Math.max(0.1, xs - Math.max(0.06, sh));
  const p = [];
  p[0] = [0, yB];
  p[1] = [xin, yB];
  p[2] = [xin, yA];
  p[3] = [h - rb, yA];
  p[4] = [h - rb * 0.29, yA + rb * 0.29];
  p[5] = [h, yA + rb];
  p[6] = [h + bulge, yMid];
  p[7] = [h + bulge * 0.35, yBt - sh];
  p[8] = [xs, yBt];
  const x9 = lerp(xs - 0.01, xg0, gh), y9 = yBt + 0.004 + 0.01 * gh;
  p[9] = [x9, y9];
  p[10] = [lerp(x9 - 0.005, xg1, gh), lerp(y9 + 0.002, yT - R.crown - rr, gh)];
  p[11] = [lerp(x9 - 0.01, xr + rr * 0.32, gh), lerp(y9 + 0.004, yT - R.crown - rr * 0.3, gh)];
  const x12 = lerp(hoodEdge - 0.02, xr, gh);
  p[12] = [Math.min(x12, p[11][0] - 0.003), lerp(yBt + 0.01, yT - R.crown, gh)];
  p[13] = [p[12][0] * 0.52, yT - (yT - p[12][1]) * 0.28];
  p[14] = [0, yT];
  return { p, gh, yB, yA, yBt, yT, h, arch: yA > yB + 0.01 };
}

// точка на поверхности борта/носа: x на высоте y в сечении (внешнее пересечение) + нормаль в сечении
function xAtY(ring, y) {
  const p = ring.p;
  let best = null;
  for (let i = 3; i < RING - 1; i++) {
    const a = p[i], b = p[i + 1];
    if ((a[1] - y) * (b[1] - y) > 0 || Math.abs(b[1] - a[1]) < 1e-6) continue;
    const t = (y - a[1]) / (b[1] - a[1]), x = lerp(a[0], b[0], t);
    if (!best || x > best.x) best = { x, nx: b[1] - a[1], ny: -(b[0] - a[0]) };
  }
  if (best) { const l = Math.hypot(best.nx, best.ny) || 1; best.nx /= l; best.ny /= l; }
  return best;
}

/* ---- станции по длине ------------------------------------------------------------------------------------- */
function stations(R, F, lod) {
  const L = R.L, ds = new Set();
  const add = (d) => { if (d >= 0 && d <= L) ds.add(+d.toFixed(4)); };
  const nr = lod ? [0, 0.3, 0.65, 1] : [0, 0.04, 0.12, 0.25, 0.42, 0.62, 0.82, 1];
  nr.forEach((t) => { add(R.noseR * t * t * 0.9 + R.noseR * t * 0.1); add(L - R.tailR * (t * t * 0.9 + t * 0.1)); });
  add(0.012); add(L - 0.012);
  [L / 2 - F.zf, L / 2 - F.zr].concat(R.dually ? [L / 2 - (F.zr + R.dually)] : []).forEach((da) => {
    const n = lod ? 4 : 9;
    for (let i = 0; i <= n; i++) add(da + F.archR * Math.cos(Math.PI * i / n));
    add(da - F.archR - 0.012); add(da + F.archR + 0.012);
  });
  const key = [R.cowl - 0.03, R.cowl, R.cowl + R.ws * 0.3, R.cowl + R.ws * 0.6, R.cowl + R.ws, R.cowl + R.ws + R.roof * 0.5,
    R.cowl + R.ws + R.roof, R.cowl + R.ws + R.roof + R.rw * 0.5, F.rwBase, F.rwBase + 0.03];
  key.forEach(add);
  if (!lod) {
    (R.win || []).forEach((w) => { add(w[0]); add(w[1]); });
    (R.seams || []).forEach((s) => { add(s - 0.012); add(s + 0.012); });
    (R.extraSt || []).forEach(add);
    if (R.checker) for (let d = R.checker[0]; d <= R.checker[1] + 1e-6; d += R.checker[2]) add(d);
    (R.sideBands || []).forEach((b) => { add(b.d0); add(b.d1); });
    if (R.light && R.light.dF) add(R.light.dF);
    if (R.light && R.light.dR) add(L - R.light.dR);
  }
  let arr = [...ds].sort((a, b) => a - b);
  // промежутки больше шага — досыпаем
  const step = lod ? 0.9 : 0.32, out = [];
  for (let i = 0; i < arr.length; i++) {
    if (i) { const g = arr[i] - arr[i - 1], n = Math.floor(g / step); for (let k = 1; k <= n; k++) out.push(arr[i - 1] + g * k / (n + 1)); }
    out.push(arr[i]);
  }
  arr = out.sort((a, b) => a - b).filter((d, i, a) => !i || d - a[i - 1] > (lod ? 0.05 : 0.008));
  return arr;
}

/* ---- раскраска граней лофта ------------------------------------------------------------------------------- */
function faceStyle(R, F, seg, dm, rg, ym) {
  const paint = R.paintCol ? [col(R.paintCol), K.TRIM] : [C.white, K.PAINT];
  const lower = R.lowerCol != null ? [col(R.lowerCol), K.TRIM] : paint;
  const L = R.L;
  if (seg <= 2) return [C.dark, K.TRIM];                       // днище и колёсные ниши
  // бамперы другого цвета (пластик) — по зонам носа и кормы
  const inBumpF = dm < R.bumpZoneF && ym < R.bumpTopF, inBumpR = dm > L - R.bumpZoneR && ym < R.bumpTopR;
  if (seg <= 4) return (inBumpF || inBumpR) && R.bumperCol != null ? [col(R.bumperCol), K.TRIM] : lower;
  if (seg <= 7) {
    for (const s of R.seams || []) if (Math.abs(dm - s) < 0.012 && ym > rg.yA + 0.05) return [C.dark, K.TRIM];
    for (const b of R.sideBands || []) {
      if (dm < b.d0 || dm > b.d1 || ym < b.y0 || ym > b.y1) continue;
      if (b.checker) { const i = Math.floor((dm - b.d0) / b.checker); return [col(i % 2 ? b.color2 : b.color), K.TRIM]; }
      return [col(b.color), b.kind != null ? b.kind : K.TRIM];
    }
    if ((inBumpF || inBumpR) && R.bumperCol != null) return [col(R.bumperCol), K.TRIM];
    if (seg === 5 && R.lowerCol != null && ym < rg.yA + R.claddingH) return lower;
    return paint;
  }
  const gh = rg.gh;
  if (seg === 8) return gh > 0.3 ? (R.chromeBelt ? [C.chrome, K.CHROME] : [C.black, K.TRIM]) : paint;
  if (seg === 9) {
    if (gh > 0.3 && inWin(R, dm)) return [C.glass, K.GLASS];
    return gh > 0.3 ? pillar(R, paint) : paint;
  }
  if (seg <= 11) return gh > 0.5 && R.roofCol != null ? [col(R.roofCol), K.TRIM] : (gh > 0.3 && R.blackPillars === "all" ? [C.black, K.TRIM] : paint);
  // крыша, лобовое, заднее стекло, капот, багажник
  if (R.wsGlass !== false && dm > R.cowl + 0.025 && dm < R.cowl + R.ws - 0.02) return [C.glass, K.GLASS];
  const re = R.cowl + R.ws + R.roof;
  if (R.rwGlass !== false && dm > re + 0.02 && dm < Math.min(F.rwBase - 0.025, re + R.rw * (R.rwGlassFrac || 1))) return [C.glass, K.GLASS];
  if (dm >= R.cowl + R.ws - 0.02 && dm <= re + 0.02) {
    if (R.roofCol === "glass" || (R.panorama && seg === 13 && dm > R.cowl + R.ws + 0.08 && dm < re - 0.1)) return [C.glass, K.GLASS];
    if (R.roofCol != null && R.roofCol !== "glass") return [col(R.roofCol), K.TRIM];
    return paint;
  }
  for (const v of R.vents || []) if (dm > v[0] && dm < v[1] && (seg === 13 || v[2])) return [C.black, K.TRIM];
  return paint;
}
function inWin(R, d) { for (const w of R.win || []) if (d > w[0] && d < w[1]) return true; return false; }
function pillar(R, paint) { return R.blackPillars ? [C.black, K.TRIM] : paint; }

/* ---- лофт: сетка станций × точек сечения, обе половины, торцы ----------------------------------------------- */
function loft(R, lod) {
  const F = bodyFns(R), L = R.L;
  const D = stations(R, F, lod);
  const keep = lod ? [0, 1, 2, 3, 5, 6, 8, 9, 10, 12, 14] : null;
  const rings = D.map((d) => {
    const rg = ringAt(R, F, d);
    if (keep) rg.p = keep.map((i) => rg.p[i]);
    rg.d = d; rg.z = L / 2 - d;
    return rg;
  });
  const NR = rings[0].p.length, segOf = keep ? keep.slice(0, -1) : null;
  const P = rings.map((rg) => rg.p.map((q) => [q[0], q[1], rg.z]));
  // гладкие нормали по сетке (одна половина; на оси x = 0 — без бокового наклона)
  const Nacc = P.map((row) => row.map(() => [0, 0, 0]));
  for (let s = 0; s < P.length - 1; s++) for (let r = 0; r < NR - 1; r++) {
    const a = P[s][r], b = P[s][r + 1], c = P[s + 1][r + 1], d = P[s + 1][r];
    const n1 = cross(sub(b, a), sub(c, a)), n2 = cross(sub(c, a), sub(d, a));
    [[s, r], [s, r + 1], [s + 1, r + 1], [s + 1, r]].forEach(([i, j]) => { const q = Nacc[i][j]; q[0] += n1[0] + n2[0]; q[1] += n1[1] + n2[1]; q[2] += n1[2] + n2[2]; });
  }
  const N = Nacc.map((row) => row.map((v, j) => { if (j === 0 || j === NR - 1) v[0] = 0; const q = norm(v); return q ? [-q[0], -q[1], -q[2]] : [0, 1, 0]; }));
  const m = new Mesh(), cosC = Math.cos(36 * Math.PI / 180);
  function emitQuad(a, b, c, d, na, nb, nc, nd, color, kind, mirror) {
    const fl = (q) => [-q[0], q[1], q[2]];
    if (mirror) { a = fl(a); b = fl(b); c = fl(c); d = fl(d); na = fl(na); nb = fl(nb); nc = fl(nc); nd = fl(nd); }
    const fn = mirror ? (faceN(a, d, c) || faceN(a, c, b)) : (faceN(a, b, c) || faceN(a, c, d));
    if (!fn) return;
    const pick = (n) => (dot(n, fn) < cosC ? fn : n);
    if (mirror) { m.quad(a, d, c, b, color, kind, pick(na), pick(nd), pick(nc), pick(nb)); }
    else m.quad(a, b, c, d, color, kind, pick(na), pick(nb), pick(nc), pick(nd));
  }
  for (let s = 0; s < P.length - 1; s++) {
    const dm = (rings[s].d + rings[s + 1].d) / 2, rg = rings[s].gh > rings[s + 1].gh ? rings[s] : rings[s + 1];
    for (let r = 0; r < NR - 1; r++) {
      const a = P[s][r], b = P[s][r + 1], c = P[s + 1][r + 1], d = P[s + 1][r];
      const seg = segOf ? segOf[r] : r, ym = (a[1] + b[1] + c[1] + d[1]) / 4;
      const st = faceStyle(R, F, seg, dm, rg, ym);
      // станции идут спереди назад (z убывает): порядок вершин — наружу
      emitQuad(a, d, c, b, N[s][r], N[s + 1][r], N[s + 1][r + 1], N[s][r + 1], st[0], st[1], false);
      emitQuad(a, d, c, b, N[s][r], N[s + 1][r], N[s + 1][r + 1], N[s][r + 1], st[0], st[1], true);
    }
  }
  // торцы: веер из середины
  [[0, 1], [P.length - 1, -1]].forEach(([s, dir]) => {
    const row = P[s], z = row[0][2], cy = (row[0][1] + row[NR - 1][1]) / 2, ctr = [0, cy, z], n = [0, 0, dir];
    const st = R.capCol != null ? [col(R.capCol), K.TRIM] : (R.paintCol ? [col(R.paintCol), K.TRIM] : [C.white, K.PAINT]);
    const bc = dir > 0 ? (R.bumperCol != null ? col(R.bumperCol) : null) : (R.bumperCol != null ? col(R.bumperCol) : null);
    for (let r = 0; r < NR - 1; r++) {
      const a = row[r], b = row[r + 1];
      const ym = (a[1] + b[1]) / 2, low = ym < (dir > 0 ? R.bumpTopF : R.bumpTopR) && bc;
      const cc = low ? [bc, K.TRIM] : st;
      if (dir > 0) { m.tri(ctr, a, b, n, n, n, cc[0], cc[1]); m.tri(ctr, [-b[0], b[1], b[2]], [-a[0], a[1], a[2]], n, n, n, cc[0], cc[1]); }
      else { m.tri(ctr, b, a, n, n, n, cc[0], cc[1]); m.tri(ctr, [-a[0], a[1], a[2]], [-b[0], b[1], b[2]], n, n, n, cc[0], cc[1]); }
    }
  });
  return { m, F, rings, D };
}

/* ---- наклейки на носу и корме: параметр (s — путь по контуру от центра, y — высота) ------------------------- */
function endSurface(R, F, end) {
  // end = +1 — нос (d от 0), −1 — корма
  const L = R.L, cache = new Map();
  function outline(y) {
    const key = y.toFixed(3);
    if (cache.has(key)) return cache.get(key);
    const pts = [];
    const dEnd = end > 0 ? 0 : L;
    const r0 = ringAt(R, F, dEnd), q0 = xAtY(r0, y);
    if (q0) { pts.push({ x: 0, z: end * L / 2, nx: 0, nz: end }); pts.push({ x: q0.x, z: end * L / 2, nx: 0, nz: end }); }
    const lim = Math.min(L * 0.45, (end > 0 ? R.noseR : R.tailR) + 0.9);
    for (let t = 0.004; t <= lim; t += t < 0.6 ? 0.025 : 0.08) {
      const d = end > 0 ? t : L - t, q = xAtY(ringAt(R, F, d), y);
      if (!q) { if (pts.length) break; else continue; }
      pts.push({ x: q.x, z: L / 2 - d, nx: q.nx, nz: 0 });
    }
    // нормали в плане по соседям
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1;
      const nx = -tz / l * end, nz = tx / l * end;
      b.pnx = nx; b.pnz = nz; if (i === 1) { a.pnx = 0; a.pnz = end; }
    }
    let s = 0; pts.forEach((p, i) => { if (i) s += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z); p.s = s; });
    cache.set(key, pts);
    return pts;
  }
  function at(s, y, off) {
    if (s < 0) { const q = at(-s, y, off); if (q) { q.p[0] = -q.p[0]; q.n[0] = -q.n[0]; } return q; }
    const pts = outline(y);
    if (pts.length < 2) return null;
    let i = 1; while (i < pts.length - 1 && pts[i].s < s) i++;
    const a = pts[i - 1], b = pts[i], t = clamp((s - a.s) / Math.max(1e-6, b.s - a.s), 0, 1);
    const nx = lerp(a.pnx, b.pnx, t), nz = lerp(a.pnz, b.pnz, t), nl = Math.hypot(nx, nz) || 1;
    return { p: [lerp(a.x, b.x, t) + nx / nl * off, y, lerp(a.z, b.z, t) + nz / nl * off], n: [nx / nl, 0, nz / nl], max: pts[pts.length - 1].s };
  }
  return { at, outline };
}
// наклейка: строки по y, в каждой — отрезок [s0(y), s1(y)]; зеркально по обе стороны (mirror) или через центр (span)
function decal(m, S, o) {
  const rows = o.rows || 4, cols = o.cols || 6, off = o.off || 0.006, out = [];
  if (S.yr) { o = Object.assign({}, o, { y0: clamp(o.y0, S.yr[0], S.yr[1]), y1: clamp(o.y1, S.yr[0], S.yr[1]) }); if (o.y1 - o.y0 < 0.01) return 0; }
  for (let i = 0; i <= rows; i++) {
    const v = i / rows, y = lerp(o.y0, o.y1, v), rg = o.shape ? o.shape(v) : [0, 1];
    const s0 = lerp(o.s0, o.s1, rg[0]), s1 = lerp(o.s0, o.s1, rg[1]), row = [];
    for (let j = 0; j <= cols; j++) {
      const q = S.at(lerp(s0, s1, j / cols), y, off);
      if (!q) return 0;
      row.push(q);
    }
    out.push(row);
  }
  const c = col(o.color), k = o.kind;
  const sides = o.mirror === false ? [1] : [1, -1];
  sides.forEach((sx) => {
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const a = out[i][j], b = out[i][j + 1], cc = out[i + 1][j + 1], d = out[i + 1][j];
      const f = (q) => [q.p[0] * sx, q.p[1], q.p[2]], fn = (q) => [q.n[0] * sx, q.n[1], q.n[2]];
      const flip = (S.end > 0) === (sx > 0);
      if (flip) m.quad(f(a), f(b), f(cc), f(d), c, k, fn(a), fn(b), fn(cc), fn(d));
      else m.quad(f(a), f(d), f(cc), f(b), c, k, fn(a), fn(d), fn(cc), fn(b));
    }
  });
  return 1;
}
// верх кузова: y на заданном x в сечении (капот, крылья, крыша)
function yAtX(ring, x) {
  const p = ring.p;
  if (x >= p[8][0]) return p[8][1];
  for (let i = 8; i < RING - 1; i++) {
    const a = p[i], b = p[i + 1];
    if ((a[0] - x) * (b[0] - x) <= 0 && Math.abs(a[0] - b[0]) > 1e-6) return lerp(a[1], b[1], (x - a[0]) / (b[0] - a[0]));
  }
  return p[RING - 1][1];
}
function topDecal(m, R, F, o) {
  const rows = o.rows || 5, cols = o.cols || 6, off = o.off || 0.008, L = R.L, c = col(o.color), k = o.kind;
  const P = (d, x) => [x, yAtX(ringAt(R, F, d), Math.abs(x)), L / 2 - d];
  const grid = [];
  for (let i = 0; i <= rows; i++) {
    const v = i / rows, d = lerp(o.d0, o.d1, v), rg = o.shape ? o.shape(v) : [0, 1], row = [];
    for (let j = 0; j <= cols; j++) {
      const x = lerp(lerp(o.x0, o.x1, rg[0]), lerp(o.x0, o.x1, rg[1]), j / cols), e = 0.01;
      const a = P(d, x), n = norm(cross(sub(P(d, x - e), P(d, x + e)), sub(P(d - e, x), P(d + e, x)))) || [0, 1, 0];
      if (n[1] < 0) { n[0] = -n[0]; n[1] = -n[1]; n[2] = -n[2]; }
      row.push({ p: [a[0] + n[0] * off, a[1] + n[1] * off, a[2] + n[2] * off], n });
    }
    grid.push(row);
  }
  (o.mirror === false ? [1] : [1, -1]).forEach((sx) => {
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const q = [grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]];
      const pp = q.map((t) => [t.p[0] * sx, t.p[1], t.p[2]]), nn = q.map((t) => [t.n[0] * sx, t.n[1], t.n[2]]);
      m.quadDir(pp[0], pp[1], pp[2], pp[3], nn[0], c, k, nn[0], nn[1], nn[2], nn[3]);
    }
  });
}
const SHAPES = {
  rect: () => [0, 1],
  round: (v) => { const t = Math.sqrt(Math.max(0, 1 - Math.pow(2 * v - 1, 2))); return [0.5 - t / 2, 0.5 + t / 2]; },
  pill: (v) => { const e = Math.min(v, 1 - v) * 2, t = Math.sqrt(Math.max(0, 1 - Math.pow(1 - Math.min(1, e * 2.2), 2))); return [0.5 - t / 2 * 1, 0.5 + t / 2]; },
  swoop: (v) => [lerp(0.25, 0, v), lerp(0.85, 1, v)],          // фара «стрелой»: шире кверху
  wedge: (v) => [lerp(0, 0.35, v), 1],
  trap: (v) => [lerp(0.12, 0, v), lerp(0.88, 1, v)]
};

/* ---- коробки и цилиндры (зеркала, спойлеры, рейлинги, выхлопы) ------------------------------------------------ */
function boxM(m, cx, cy, cz, sx, sy, sz, color, kind, rot) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2, c = col(color);
  const V = [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz], [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]].map((v) => {
    let [x, y, z] = v;
    if (rot && rot.x) { const cs = Math.cos(rot.x), sn = Math.sin(rot.x); [y, z] = [y * cs - z * sn, y * sn + z * cs]; }
    if (rot && rot.y) { const cs = Math.cos(rot.y), sn = Math.sin(rot.y); [x, z] = [x * cs + z * sn, -x * sn + z * cs]; }
    if (rot && rot.z) { const cs = Math.cos(rot.z), sn = Math.sin(rot.z); [x, y] = [x * cs - y * sn, x * sn + y * cs]; }
    return [x + cx, y + cy, z + cz];
  });
  const ctr = [cx, cy, cz];
  [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]].forEach((f) => {
    const fc = [0, 1, 2].map((i) => (V[f[0]][i] + V[f[1]][i] + V[f[2]][i] + V[f[3]][i]) / 4);
    m.quadDir(V[f[0]], V[f[1]], V[f[2]], V[f[3]], sub(fc, ctr), c, kind);
  });
}
function cylM(m, cx, cy, cz, r, len, axis, color, kind, seg) {
  seg = seg || 10; const c = col(color), pts = [];
  for (let i = 0; i < seg; i++) { const a = i / seg * Math.PI * 2; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
  const P = (u, v, w) => axis === "z" ? [cx + u, cy + v, cz + w] : axis === "x" ? [cx + w, cy + v, cz + u] : [cx + u, cy + w, cz + v];
  for (let i = 0; i < seg; i++) {
    const a = pts[i], b = pts[(i + 1) % seg];
    const na = axis === "z" ? [a[0] / r, a[1] / r, 0] : axis === "x" ? [0, a[1] / r, a[0] / r] : [a[0] / r, 0, a[1] / r];
    const nb = axis === "z" ? [b[0] / r, b[1] / r, 0] : axis === "x" ? [0, b[1] / r, b[0] / r] : [b[0] / r, 0, b[1] / r];
    const mid = [(na[0] + nb[0]) / 2, (na[1] + nb[1]) / 2, (na[2] + nb[2]) / 2], ax = sub(P(0, 0, 1), P(0, 0, 0));
    m.quadDir(P(a[0], a[1], -len / 2), P(b[0], b[1], -len / 2), P(b[0], b[1], len / 2), P(a[0], a[1], len / 2), mid, c, kind);
    m.triDir(P(0, 0, len / 2), P(a[0], a[1], len / 2), P(b[0], b[1], len / 2), ax, c, kind);
    m.triDir(P(0, 0, -len / 2), P(b[0], b[1], -len / 2), P(a[0], a[1], -len / 2), [-ax[0], -ax[1], -ax[2]], c, kind);
  }
}

/* ================================================================================================================
 * Рецепт → модель: кузов, лицо, корма, навесное. Возвращает меш и сведения для игры (колёса, маячки, посадка).
 * ================================================================================================================ */
const DEF = {
  clear: 0.16, noseR: 0.32, tailR: 0.28, bumpF: 0.16, bumpR: 0.14, taper: 0.03, crown: 0.035, roofBow: 0.02, roofDrop: 0.04,
  deckBow: 0.01, beltRise: 0.04, rb: 0.1, sh: 0.06, sill: 0.05, tumble: 0.33, rr: 0.07, bulge: 0.035, charY: 0.55,
  wellW: 0.36, archGap: 0.07, archLift: 1, claddingH: 0.14, bumpZoneF: 0.32, bumpZoneR: 0.3, bumpTopF: 0.62, bumpTopR: 0.62,
  hoodF: null, rwKink: true, tireW: 0.22
};
function prep(base) {
  const R = Object.assign({}, DEF, base);
  if (R.hoodF == null) R.hoodF = lerp(R.noseY, R.hoodY, 0.42);
  R.fo = R.fo != null ? R.fo : (R.L - R.wb) / 2;
  return R;
}

function front(m, R, F, lod) {
  const S = endSurface(R, F, 1); S.end = 1;
  const fr = R.front || {}, ring0 = ringAt(R, F, 0), capHW = (xAtY(ring0, (ring0.yB + ring0.yT) / 2) || { x: 0.5 }).x;
  S.yr = [ring0.yB + 0.006, ring0.yT - 0.006];
  // решётка
  (fr.grille ? [].concat(fr.grille) : []).forEach((g) => {
    decal(m, S, { s0: -g.w / 2, s1: g.w / 2, y0: g.y0, y1: g.y1, rows: lod ? 1 : 3, cols: lod ? 2 : 6, color: g.color != null ? g.color : C.grille,
      kind: g.kind != null ? g.kind : K.TRIM, mirror: false, shape: SHAPES[g.shape || "rect"], off: 0.005 });
    if (!lod && g.frame) decal(m, S, { s0: -g.w / 2 - 0.025, s1: g.w / 2 + 0.025, y0: g.y0 - 0.025, y1: g.y1 + 0.025, rows: 3, cols: 6, color: g.frame,
      kind: K.CHROME, mirror: false, shape: SHAPES[g.shape || "rect"], off: 0.003 });
    if (!lod && g.slats) for (let i = 1; i <= g.slats; i++) {
      const y = lerp(g.y0, g.y1, i / (g.slats + 1));
      decal(m, S, { s0: -g.w / 2 + 0.02, s1: g.w / 2 - 0.02, y0: y - 0.007, y1: y + 0.007, rows: 1, cols: 4, color: g.slatCol || C.chrome, kind: K.CHROME, mirror: false, off: 0.008 });
    }
    if (!lod && g.bars) for (let i = 1; i <= g.bars; i++) {
      const s = lerp(-g.w / 2, g.w / 2, i / (g.bars + 1));
      decal(m, S, { s0: s - 0.007, s1: s + 0.007, y0: g.y0 + 0.01, y1: g.y1 - 0.01, rows: 2, cols: 1, color: g.slatCol || C.chrome, kind: K.CHROME, mirror: false, off: 0.008 });
    }
  });
  // нижние воздухозаборники, противотуманки
  (fr.intakes || []).forEach((g) => decal(m, S, { s0: g.s0, s1: g.s1, y0: g.y0, y1: g.y1, rows: 2, cols: 4, color: C.black, kind: K.TRIM, shape: SHAPES[g.shape || "rect"], off: 0.004 }));
  // фары: корпус (тёмное стекло) + светящаяся часть
  const hl = fr.lights;
  if (hl) {
    const s0 = hl.s0 != null ? hl.s0 : capHW - hl.w * 0.55, s1 = s0 + hl.w;
    decal(m, S, { s0, s1, y0: hl.y0, y1: hl.y1, rows: lod ? 1 : 4, cols: lod ? 2 : 8, color: hl.housing || C.headLens, kind: K.GLASS, shape: SHAPES[hl.shape || "rect"], off: 0.006 });
    const lamps = hl.lamps || [{ a: 0.1, b: 0.9, v0: 0.2, v1: 0.8 }];
    lamps.forEach((lp) => decal(m, S, { s0: lerp(s0, s1, lp.a), s1: lerp(s0, s1, lp.b), y0: lerp(hl.y0, hl.y1, lp.v0), y1: lerp(hl.y0, hl.y1, lp.v1),
      rows: lod ? 1 : (lp.round ? 4 : 2), cols: lod ? 1 : (lp.round ? 6 : 4), color: C.head, kind: K.HEAD, shape: SHAPES[lp.round ? "round" : (lp.shape || "rect")], off: 0.009 }));
    if (hl.drl && !lod) decal(m, S, { s0: lerp(s0, s1, hl.drl[0]), s1: lerp(s0, s1, hl.drl[1]), y0: lerp(hl.y0, hl.y1, hl.drl[2]), y1: lerp(hl.y0, hl.y1, hl.drl[3]),
      rows: 1, cols: 6, color: C.head, kind: K.HEAD, off: 0.01 });
    if (hl.amber && !lod) decal(m, S, { s0: lerp(s0, s1, hl.amber[0]), s1: lerp(s0, s1, hl.amber[1]), y0: lerp(hl.y0, hl.y1, hl.amber[2]), y1: lerp(hl.y0, hl.y1, hl.amber[3]),
      rows: 1, cols: 2, color: C.amber, kind: K.AMBER, off: 0.01 });
  }
  (fr.topLamps || []).forEach((t) => {
    topDecal(m, R, F, { d0: t.d0, d1: t.d1, x0: t.x - t.w / 2, x1: t.x + t.w / 2, shape: SHAPES.round, rows: lod ? 2 : 6, cols: lod ? 2 : 8, color: t.housing || C.headLens, kind: K.GLASS, off: 0.006 });
    topDecal(m, R, F, { d0: lerp(t.d0, t.d1, 0.15), d1: lerp(t.d0, t.d1, 0.85), x0: t.x - t.w * 0.35, x1: t.x + t.w * 0.35, shape: SHAPES.round, rows: lod ? 1 : 5, cols: lod ? 2 : 6, color: C.head, kind: K.HEAD, off: 0.011 });
  });
  if (fr.fog && !lod) decal(m, S, { s0: fr.fog.s, s1: fr.fog.s + fr.fog.r * 2, y0: fr.fog.y, y1: fr.fog.y + fr.fog.r * 2, rows: 3, cols: 5, color: C.head, kind: K.HEAD, shape: SHAPES.round, off: 0.006 });
  if (fr.plate !== false && !lod) {
    const py = fr.plateY != null ? fr.plateY : R.clear + R.bumpF + 0.08;
    decal(m, S, { s0: -0.26, s1: 0.26, y0: py, y1: py + 0.11, rows: 1, cols: 2, color: C.plate, kind: K.TRIM, mirror: false, off: 0.011 });
  }
  if (fr.windshield) {       // автобус, маршрутка: лобовое на торце
    const w = fr.windshield;
    decal(m, S, { s0: -w.w / 2, s1: w.w / 2, y0: w.y0, y1: w.y1, rows: lod ? 1 : 3, cols: lod ? 2 : 6, color: C.glass, kind: K.GLASS, mirror: false, off: 0.005 });
  }
  if (fr.sign && !lod) {     // табло маршрута
    const g = fr.sign;
    decal(m, S, { s0: -g.w / 2, s1: g.w / 2, y0: g.y0, y1: g.y1, rows: 1, cols: 3, color: rgb(0xffa21a), kind: K.SIGN, mirror: false, off: 0.009 });
  }
}

function rear(m, R, F, lod) {
  const S = endSurface(R, F, -1); S.end = -1;
  const rr = R.rear || {}, ringE = ringAt(R, F, R.L), capHW = (xAtY(ringE, (ringE.yB + ringE.yT) / 2) || { x: 0.5 }).x;
  S.yr = [ringE.yB + 0.006, ringE.yT - 0.006];
  const tl = rr.lights;
  if (tl) {
    const s0 = tl.s0 != null ? tl.s0 : capHW - tl.w * 0.5, s1 = s0 + tl.w;
    decal(m, S, { s0, s1, y0: tl.y0, y1: tl.y1, rows: lod ? 1 : 3, cols: lod ? 2 : 8, color: C.tailDark, kind: K.TAIL, shape: SHAPES[tl.shape || "rect"], off: 0.006 });
    const lamps = tl.lamps || [{ a: 0.06, b: 0.94, v0: 0.18, v1: 0.82 }];
    lamps.forEach((lp) => decal(m, S, { s0: lerp(s0, s1, lp.a), s1: lerp(s0, s1, lp.b), y0: lerp(tl.y0, tl.y1, lp.v0), y1: lerp(tl.y0, tl.y1, lp.v1),
      rows: lod ? 1 : (lp.round ? 4 : 2), cols: lod ? 1 : (lp.round ? 6 : 5), color: C.tail, kind: K.TAIL, shape: SHAPES[lp.round ? "round" : "rect"], off: 0.009 }));
    if (tl.rev && !lod) decal(m, S, { s0: lerp(s0, s1, tl.rev[0]), s1: lerp(s0, s1, tl.rev[1]), y0: lerp(tl.y0, tl.y1, tl.rev[2]), y1: lerp(tl.y0, tl.y1, tl.rev[3]),
      rows: 1, cols: 2, color: C.rev, kind: K.TRIM, off: 0.011 });
  }
  if (rr.bar && !lod) {       // световая полоса через всю корму
    decal(m, S, { s0: -capHW + 0.02, s1: capHW - 0.02, y0: rr.bar.y0, y1: rr.bar.y1, rows: 1, cols: 8, color: C.tail, kind: K.TAIL, mirror: false, off: 0.008 });
  }
  if (rr.plate !== false && !lod) {
    const py = rr.plateY != null ? rr.plateY : R.clear + R.bumpR + 0.14;
    decal(m, S, { s0: -0.26, s1: 0.26, y0: py, y1: py + 0.11, rows: 1, cols: 2, color: C.plate, kind: K.TRIM, mirror: false, off: 0.011 });
  }
  if (rr.diffuser && !lod) decal(m, S, { s0: -capHW * 0.75, s1: capHW * 0.75, y0: R.clear + 0.02, y1: R.clear + rr.diffuser, rows: 1, cols: 6, color: C.black, kind: K.TRIM, mirror: false, off: 0.004 });
  if (rr.window) {
    const w = rr.window;
    decal(m, S, { s0: -w.w / 2, s1: w.w / 2, y0: w.y0, y1: w.y1, rows: lod ? 1 : 2, cols: lod ? 2 : 5, color: C.glass, kind: K.GLASS, mirror: false, off: 0.005 });
  }
  // выхлопные трубы: кружки под бампером
  if (rr.exhaust && !lod) {
    const e = rr.exhaust, r = e.r || 0.045, z = -R.L / 2 + 0.02;
    (e.x || [capHW * 0.6]).forEach((x) => [x, -x].forEach((xx) => {
      cylM(m, xx, e.y || R.clear + 0.1, z, r, 0.12, "z", e.color || C.chrome, K.CHROME, 10);
      cylM(m, xx, e.y || R.clear + 0.1, z - 0.005, r * 0.7, 0.12, "z", C.black, K.TRIM, 10);
    }));
  }
}

// навесное: зеркала, спойлеры, рейлинги, шашечки, мигалки, штанги, батареи
function extras(m, R, F, lod, meta) {
  const L = R.L, z = (d) => L / 2 - d, X = R.extras || {};
  const paint = R.paintCol ? [col(R.paintCol), K.TRIM] : [C.white, K.PAINT];
  if (X.mirrors !== false && !lod) {
    const d = R.cowl + 0.16, y = F.belt(d) + 0.06, h = ringAt(R, F, d).p[8][0];
    [1, -1].forEach((s) => {
      boxM(m, s * (h + 0.1), y, z(d), 0.15, 0.085, 0.06, X.mirrorCol != null ? X.mirrorCol : (R.paintCol || 0xffffff), X.mirrorCol != null ? K.TRIM : (R.paintCol ? K.TRIM : K.PAINT), { y: s * 0.25 });
      boxM(m, s * (h + 0.03), y - 0.015, z(d) + 0.015, 0.07, 0.035, 0.04, C.black, K.TRIM);
    });
  }
  if (X.wing) {          // антикрыло на стойках
    const w = X.wing, d = L - w.d, y = F.top(d) + w.h;
    boxM(m, 0, y, z(d), R.W * w.span, 0.04, w.chord || 0.32, w.color != null ? w.color : paint[0], w.color != null ? K.TRIM : paint[1], { x: -0.08 });
    if (!lod) [1, -1].forEach((s) => boxM(m, s * R.W * w.span * 0.32, y - w.h / 2, z(d), 0.04, w.h, 0.1, C.black, K.TRIM));
    if (!lod) [1, -1].forEach((s) => boxM(m, s * R.W * w.span / 2, y + 0.02, z(d), 0.02, 0.12, (w.chord || 0.32) + 0.04, C.black, K.TRIM));
  }
  if (X.lip && !lod) { const d = L - 0.06; boxM(m, 0, F.top(d) + 0.02, z(d), R.W * 0.8, 0.035, 0.12, paint[0], paint[1], { x: -0.25 }); }
  (X.stripes && !lod ? X.stripes : []).forEach((st) => topDecal(m, R, F, { d0: st.d0, d1: st.d1, x0: st.x0, x1: st.x1, rows: 10, cols: 1, color: st.color, kind: K.TRIM, off: 0.004 }));
  if (X.rails) {
    const d0 = R.cowl + R.ws + 0.1, d1 = R.cowl + R.ws + R.roof - 0.05, dm = (d0 + d1) / 2, rg = ringAt(R, F, dm);
    [1, -1].forEach((s) => boxM(m, s * (rg.p[12][0] - 0.06), F.top(dm) - R.crown + 0.04, z(dm), 0.05, 0.05, d1 - d0, X.rails, K.TRIM));
  }
  if (X.scoop && !lod) { const d = R.cowl * 0.55; boxM(m, 0, F.top(d) + 0.04, z(d), 0.5, 0.08, 0.55, C.black, K.TRIM, { x: 0.05 }); }
  if (X.taxi) {
    const d = R.cowl + R.ws + R.roof * 0.45;
    boxM(m, 0, F.top(d) + 0.1, z(d), 0.62, 0.17, 0.26, rgb(0xffd23f), K.SIGN);
    if (!lod) for (let i = 0; i < 6; i++) boxM(m, -0.25 + i * 0.1, F.top(d) + 0.1, z(d) + 0.135, 0.1, 0.06, 0.01, i % 2 ? C.black : C.white, K.TRIM);
  }
  if (X.lightbar) {
    const d = R.cowl + R.ws + R.roof * 0.35, y = F.top(d) + 0.06;
    boxM(m, 0, y, z(d), R.W * 0.62, 0.08, 0.26, C.black, K.TRIM);
    meta.beacons = [[R.W * 0.2, y + 0.07, z(d)], [-R.W * 0.2, y + 0.07, z(d)]];
  }
  if (X.beacons) meta.beacons = X.beacons.map((b) => [b[0], b[1], z(b[2])]);
  if (X.poles) {         // штанги троллейбуса: от крыши назад и вверх
    const d0 = X.poles.d, y0 = F.top(d0) + 0.32;
    boxM(m, 0, F.top(d0) + 0.16, z(d0), 1.4, 0.28, 1.6, C.plastic, K.TRIM);
    if (!lod) [0.25, -0.25].forEach((x) => {
      const len = 6.2, ang = 0.38, cz = z(d0) - Math.cos(ang) * len / 2, cy = y0 + Math.sin(ang) * len / 2;
      boxM(m, x, cy, cz, 0.06, 0.06, len, C.dark, K.TRIM, { x: ang });
      const tz = z(d0) - Math.cos(ang) * len, ty = y0 + Math.sin(ang) * len;
      boxM(m, x, ty, tz, 0.09, 0.07, 0.3, C.chrome, K.CHROME);
    });
  }
  if (X.batteries) {
    const n = X.batteries.n || 3;
    for (let i = 0; i < n; i++) { const d = X.batteries.d + i * 1.6; boxM(m, 0, F.top(d) + 0.13, z(d), R.W * 0.72, 0.26, 1.3, C.plastic, K.TRIM); }
  }
  if (X.cargo) {         // кузов-фургон грузовика / отсек пожарной
    const c = X.cargo, d0 = c.d0, d1 = L - 0.05, zc = z((d0 + d1) / 2), len = d1 - d0;
    boxM(m, 0, c.y0 + c.h / 2, zc, c.w, c.h, len, c.color != null ? c.color : C.white, c.kind != null ? c.kind : K.TRIM);
    if (!lod) {
      boxM(m, 0, c.y0 + c.h + 0.02, zc, c.w + 0.04, 0.05, len + 0.04, C.plastic, K.TRIM);
      boxM(m, 0, c.y0 - 0.06, zc, c.w - 0.3, 0.14, len, C.dark, K.TRIM);
      if (c.stripe) [1, -1].forEach((s) => boxM(m, s * (c.w / 2 + 0.004), c.y0 + c.h * 0.35, zc, 0.01, 0.16, len - 0.2, c.stripe, K.TRIM));
      if (c.doors) for (let i = 0; i < c.doors; i++) [1, -1].forEach((s) => boxM(m, s * (c.w / 2 + 0.006), c.y0 + c.h * 0.5, z(d0 + 0.5 + i * (len - 1) / Math.max(1, c.doors - 1)), 0.012, c.h * 0.8, 0.03, C.dark, K.TRIM));
      // задние огни на кузове
      [1, -1].forEach((s) => boxM(m, s * (c.w / 2 - 0.2), c.y0 + 0.25, z(d1) - 0.015, 0.22, 0.2, 0.03, C.tail, K.TAIL));
      boxM(m, 0, c.y0 + 0.4, z(d1) - 0.012, 0.5, 0.11, 0.02, C.plate, K.TRIM);
    }
    if (c.ladder && !lod) {
      [0.35, -0.35].forEach((x) => boxM(m, x, c.y0 + c.h + 0.18, zc + 0.6, 0.06, 0.06, len + 1.6, C.chrome, K.CHROME));
      for (let i = 0; i < 12; i++) boxM(m, 0, c.y0 + c.h + 0.18, zc - len / 2 + 0.3 + i * (len + 1) / 12, 0.7, 0.04, 0.04, C.chrome, K.CHROME);
      boxM(m, 0, c.y0 + c.h + 0.07, z(d1) - 0.6, 0.9, 0.14, 0.9, C.chrome, K.CHROME);
    }
  }
  if (X.boxes) X.boxes.forEach((b) => boxM(m, b[0], b[1], z(b[2]), b[3], b[4], b[5], b[6], b[7] != null ? b[7] : K.TRIM));
}

/* ---- колёса: одна единичная модель на стиль (радиус 1, ширина 1, ось — x, лицом диска к +x) ------------------- */
function wheelModel(style, lod) {
  const m = new Mesh(), seg = lod ? 8 : 18, tire = C.rubber;
  if (lod) {             // дальний план: восьмигранник с тёмным диском
    for (let i = 0; i < 8; i++) {
      const a0 = i / 8 * Math.PI * 2, a1 = (i + 1) / 8 * Math.PI * 2, am = (a0 + a1) / 2;
      const Q = (x, a, r) => [x, Math.cos(a) * r, Math.sin(a) * r];
      m.quadDir(Q(-0.5, a0, 1), Q(0.5, a0, 1), Q(0.5, a1, 1), Q(-0.5, a1, 1), [0, Math.cos(am), Math.sin(am)], tire, K.RUBBER);
      m.triDir(Q(0.5, 0, 0), Q(0.5, a0, 1), Q(0.5, a1, 1), [1, 0, 0], rgb(0x6b7078), K.TRIM);
    }
    return m;
  }
  const prof = style === "truck" ? [[0.62, -0.5], [0.92, -0.5], [1, -0.4], [1, 0.4], [0.92, 0.5], [0.62, 0.5]]
    : [[0.66, -0.5], [0.9, -0.5], [0.99, -0.38], [1, 0], [0.99, 0.38], [0.9, 0.5], [0.66, 0.5]];
  const P = (r, x, a) => [x, Math.cos(a) * r, Math.sin(a) * r];
  const rad = (a) => [0, Math.cos(a), Math.sin(a)];
  // шина: тело вращения, нормаль — от оси и от середины по ширине
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2, am = (a0 + a1) / 2;
    for (let j = 0; j < prof.length - 1; j++) {
      const p = prof[j], q = prof[j + 1], xm = (p[1] + q[1]) / 2, rm = (p[0] + q[0]) / 2;
      const dir = [xm * 2, Math.cos(am) * (rm - 0.6), Math.sin(am) * (rm - 0.6)];
      m.quadDir(P(p[0], p[1], a0), P(q[0], q[1], a0), P(q[0], q[1], a1), P(p[0], p[1], a1), dir, tire, K.RUBBER);
    }
  }
  const rimC = style === "steel" || style === "truck" ? rgb(0x9aa0a8) : rgb(0xc9cfd6), dark = rgb(0x1e2125);
  const face = 0.46, rimR = style === "truck" ? 0.62 : 0.66, X = [1, 0, 0];
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2, am = (a0 + a1) / 2, r = rad(am), inw = [0, -r[1], -r[2]];
    m.quadDir(P(rimR, 0.5, a0), P(rimR, 0.5, a1), P(rimR, face, a1), P(rimR, face, a0), inw, rimC, K.TRIM);        // закраина обода
    m.quadDir(P(rimR, face, a0), P(rimR, face, a1), P(rimR * 0.92, face - 0.02, a1), P(rimR * 0.92, face - 0.02, a0), X, rimC, K.RIM);
    m.triDir(P(0, face - 0.25, a0), P(rimR * 0.92, face - 0.02, a1), P(rimR * 0.92, face - 0.02, a0), X, dark, K.TRIM);   // тарелка
  }
  if (lod) return m;
  const spokes = { alloy: 5, sport: 10, multi: 14, steel: 0, truck: 0, moto: 6 }[style] || 5;
  for (let i = 0; i < spokes; i++) {
    const a = i / spokes * Math.PI * 2, w = style === "multi" ? 0.06 : style === "sport" ? 0.07 : 0.16;
    const a0 = a - w, a1 = a + w, b0 = a - w * 0.55, b1 = a + w * 0.55;
    m.quadDir(P(0.2, face, a0), P(0.2, face, a1), P(rimR * 0.9, face - 0.01, b1), P(rimR * 0.9, face - 0.01, b0), X, rimC, K.RIM);
  }
  if (spokes === 0) {      // штампованный диск: сплошная тарелка
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
      m.quadDir(P(0.22, face - 0.01, a0), P(0.22, face - 0.01, a1), P(rimR * 0.9, face - 0.03, a1), P(rimR * 0.9, face - 0.03, a0), X, rimC, K.RIM);
    }
  }
  for (let i = 0; i < 8; i++) {          // ступица
    const a0 = i / 8 * Math.PI * 2, a1 = (i + 1) / 8 * Math.PI * 2;
    m.triDir(P(0, face + 0.03, a0), P(0.2, face + 0.005, a0), P(0.2, face + 0.005, a1), X, style === "steel" ? rgb(0xb5bac0) : dark, K.CHROME);
  }
  return m;
}

/* ---- мотоциклы и тук-тук: свои модели из примитивов ------------------------------------------------------------ */
function bikeModel(R, lod) {
  const m = new Mesh(), paint = [C.white, K.PAINT], sport = R.style === "sportbike";
  const wr = R.wr, wb = R.wb;
  if (sport) {
    boxM(m, 0, 0.86, 0.12, 0.34, 0.24, 0.62, paint[0], paint[1], { x: 0.08 });               // бак
    boxM(m, 0, 0.8, 0.6, 0.42, 0.42, 0.5, paint[0], paint[1], { x: -0.45 });                 // обтекатель
    boxM(m, 0, 0.6, 0.35, 0.44, 0.36, 0.6, paint[0], paint[1]);                              // боковины
    boxM(m, 0, 0.84, -0.6, 0.24, 0.12, 0.58, paint[0], paint[1], { x: 0.3 });                 // хвост
    boxM(m, 0, 1.02, 0.78, 0.3, 0.2, 0.03, C.glass, K.GLASS, { x: -0.7 });                    // ветровое
    boxM(m, 0, 0.82, 0.86, 0.2, 0.08, 0.04, C.head, K.HEAD);
  } else {
    boxM(m, 0, 0.86, 0.15, 0.32, 0.22, 0.55, paint[0], paint[1]);
    cylM(m, 0, 1.0, 0.68, 0.11, 0.08, "z", C.chrome, K.CHROME, 10);
    boxM(m, 0, 1.0, 0.73, 0.12, 0.12, 0.02, C.head, K.HEAD);
    boxM(m, 0, 0.7, -0.62, 0.3, 0.06, 0.5, paint[0], paint[1]);                              // крыло
    boxM(m, 0.18, 0.55, -0.25, 0.12, 0.25, 0.35, C.plastic, K.TRIM);
  }
  boxM(m, 0, 0.92, -0.25, 0.28, 0.08, 0.55, C.black, K.TRIM);                                // седло
  boxM(m, 0, 0.45, 0.0, 0.26, 0.32, 0.6, C.dark, K.TRIM);                                    // мотор
  boxM(m, 0.1, 0.62, 0.55, 0.05, 0.75, 0.05, C.chrome, K.CHROME, { x: -0.38 });
  boxM(m, -0.1, 0.62, 0.55, 0.05, 0.75, 0.05, C.chrome, K.CHROME, { x: -0.38 });
  boxM(m, 0, 1.06, 0.48, 0.72, 0.035, 0.035, C.dark, K.TRIM);                                // руль
  cylM(m, 0.18, 0.42, -0.42, 0.05, 0.7, "z", C.chrome, K.CHROME, 8);                         // выхлоп
  boxM(m, 0, 0.78, -0.92, 0.16, 0.06, 0.03, C.tail, K.TAIL);
  return { m, wheels: [[0, wr, wb / 2, 1], [0, wr, -wb / 2, 0]], seat: [0.86, -0.25] };
}
function tukModel(R, lod) {
  const m = new Mesh(), W = R.W, L = R.L, f = L / 2, r = -L / 2;
  boxM(m, 0, 0.62, -0.1, W, 0.62, L - 0.6, C.white, K.PAINT);
  boxM(m, 0, 0.75, f - 0.35, W * 0.7, 0.8, 0.5, C.white, K.PAINT, { x: -0.25 });
  boxM(m, 0, 2.02, -0.05, W + 0.12, 0.09, L - 0.4, C.white, K.PAINT);
  [[W / 2 - 0.07, f - 0.6], [-W / 2 + 0.07, f - 0.6], [W / 2 - 0.07, r + 0.25], [-W / 2 + 0.07, r + 0.25]].forEach((q) => boxM(m, q[0], 1.5, q[1], 0.06, 1.0, 0.06, C.dark, K.TRIM));
  boxM(m, 0, 1.38, f - 0.58, W - 0.25, 0.62, 0.04, C.glass, K.GLASS);
  boxM(m, 0, 1.08, r + 0.5, W - 0.2, 0.08, 0.55, rgb(0x8a5a3b), K.TRIM);
  boxM(m, 0, 0.82, f + 0.0, 0.22, 0.16, 0.04, C.head, K.HEAD);
  [1, -1].forEach((s) => boxM(m, s * (W / 2 - 0.12), 0.7, r - 0.02, 0.14, 0.14, 0.03, C.tail, K.TAIL));
  return { m, wheels: [[0, R.wr, R.wb / 2, 1], [W / 2 - 0.1, R.wr, -R.wb / 2, 0], [-W / 2 + 0.1, R.wr, -R.wb / 2, 0]], seat: [0.82, 0.2] };
}

/* ---- целая машина ---------------------------------------------------------------------------------------------- */
function build(recipe, lod) {
  const R = prep(recipe);
  const meta = { L: R.L, W: R.W, wb: R.wb, wr: R.wr, wheel: R.wheel || "alloy", tireW: R.tireW, rim: R.rim || null };
  let m;
  if (R.style === "sportbike" || R.style === "bike") {
    const b = bikeModel(R, lod); m = b.m; meta.wheels = b.wheels; meta.seat = b.seat; meta.H = 1.2;
  } else if (R.style === "tuk") {
    const b = tukModel(R, lod); m = b.m; meta.wheels = b.wheels; meta.seat = b.seat; meta.H = 2.1;
  } else {
    const lf = loft(R, lod); m = lf.m;
    front(m, R, lf.F, lod); rear(m, R, lf.F, lod); extras(m, R, lf.F, lod, meta);
    const tw = R.track != null ? R.track / 2 : R.W / 2 - R.tireW / 2 - 0.05;
    meta.wheels = [[tw, R.wr, lf.F.zf, 1], [-tw, R.wr, lf.F.zf, 1], [tw, R.wr, lf.F.zr, 0], [-tw, R.wr, lf.F.zr, 0]];
    if (R.dually) meta.wheels.push([tw, R.wr, lf.F.zr + R.dually, 0], [-tw, R.wr, lf.F.zr + R.dually, 0]);
    meta.H = R.H;
    if (lod) {             // дальний план: колёса впечатаны в кузов (неподвижные)
      const w = wheelModel(R.wheel === "truck" ? "truck" : "alloy", 1), from = m.k.length;
      meta.wheels.forEach((q) => {
        const s = q[0] < 0 ? -1 : 1;
        for (let i = 0; i < w.p.length; i += 3) m.vert([q[0] + w.p[i] * R.tireW * s, q[1] + w.p[i + 1] * R.wr, q[2] + w.p[i + 2] * R.wr],
          [w.n[i] * s, w.n[i + 1], w.n[i + 2]], [w.c[i], w.c[i + 1], w.c[i + 2]], w.k[i / 3]);
      });
      // у отражённых колёс порядок вершин перевёрнут — чиним
      fixWinding(m, from);
    }
  }
  return { mesh: m, meta };
}
// после зеркалирования части треугольников смотрят внутрь: сверяем порядок обхода с нормалью
function fixWinding(m, from) {
  for (let i = (from || 0) * 3; i < m.p.length; i += 9) {
    const a = [m.p[i], m.p[i + 1], m.p[i + 2]], b = [m.p[i + 3], m.p[i + 4], m.p[i + 5]], c = [m.p[i + 6], m.p[i + 7], m.p[i + 8]];
    const fn = faceN(a, b, c); if (!fn) continue;
    const n = [m.n[i] + m.n[i + 3] + m.n[i + 6], m.n[i + 1] + m.n[i + 4] + m.n[i + 7], m.n[i + 2] + m.n[i + 5] + m.n[i + 8]];
    if (dot(fn, n) < 0) {
      for (let k = 0; k < 3; k++) { const t = m.p[i + 3 + k]; m.p[i + 3 + k] = m.p[i + 6 + k]; m.p[i + 6 + k] = t; }
      for (let k = 0; k < 3; k++) { const t = m.n[i + 3 + k]; m.n[i + 3 + k] = m.n[i + 6 + k]; m.n[i + 6 + k] = t; }
      const v = i / 3;
      for (let k = 0; k < 3; k++) { const t = m.c[(v + 1) * 3 + k]; m.c[(v + 1) * 3 + k] = m.c[(v + 2) * 3 + k]; m.c[(v + 2) * 3 + k] = t; }
      const t = m.k[v + 1]; m.k[v + 1] = m.k[v + 2]; m.k[v + 2] = t;
    }
  }
}

/* ---- сварка одинаковых вершин → индексы ------------------------------------------------------------------------- */
function weld(m) {
  const map = new Map(), P = [], N = [], Cc = [], Kk = [], I = [];
  const q = (v, s) => Math.round(v * s);
  for (let v = 0; v < m.k.length; v++) {
    const key = [q(m.p[v * 3], 4000), q(m.p[v * 3 + 1], 4000), q(m.p[v * 3 + 2], 4000), q(m.n[v * 3], 200), q(m.n[v * 3 + 1], 200), q(m.n[v * 3 + 2], 200),
      q(m.c[v * 3], 255), q(m.c[v * 3 + 1], 255), q(m.c[v * 3 + 2], 255), m.k[v]].join(",");
    let id = map.get(key);
    if (id == null) {
      id = Kk.length; map.set(key, id);
      P.push(m.p[v * 3], m.p[v * 3 + 1], m.p[v * 3 + 2]); N.push(m.n[v * 3], m.n[v * 3 + 1], m.n[v * 3 + 2]);
      Cc.push(m.c[v * 3], m.c[v * 3 + 1], m.c[v * 3 + 2]); Kk.push(m.k[v]);
    }
    I.push(id);
  }
  return { pos: new Float32Array(P), nor: new Float32Array(N), col: new Float32Array(Cc), kind: new Uint8Array(Kk), idx: new Uint32Array(I) };
}

module.exports = { K, C, rgb, build, wheelModel, weld, Mesh };
