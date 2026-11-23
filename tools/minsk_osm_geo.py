"""Минск 1:1 — геометрия и общие помощники конвертера tools/minsk-osm.py (вынесено 22.11.2026: файл перерос 1500 строк).
Координаты — метры от (LAT0, LON0): x — восток, z — юг; в файлах — целые дециметры. Деревья во дворах — shapely."""
import math
import sys
import time
from collections import defaultdict

LAT0, LON0 = 53.900, 27.580
SUP = 1000.0
KX = math.cos(math.radians(LAT0)) * 111320.0
KZ = 110540.0


def xz(lat, lon):
    return ((lon - LON0) * KX, -(lat - LAT0) * KZ)


def dm(v):
    return int(round(v * 10))


def flat(pts):
    out = []
    for x, z in pts:
        out += [dm(x), dm(z)]
    return out


def flat_d(pts):
    """Ломаная/контур в куске: первая точка — дециметры, дальше — приращения (короче в JSON и лучше жмётся)."""
    out, px, pz = [], 0, 0
    for i, (x, z) in enumerate(pts):
        ix, iz = dm(x), dm(z)
        out += [ix, iz] if i == 0 else [ix - px, iz - pz]
        px, pz = ix, iz
    return out


def num(s):
    try:
        return float(str(s).replace(",", ".").replace("m", "").strip().split(";")[0])
    except (TypeError, ValueError):
        return None


def area(pts):
    s = 0.0
    for i in range(len(pts)):
        x1, z1 = pts[i]
        x2, z2 = pts[(i + 1) % len(pts)]
        s += x1 * z2 - x2 * z1
    return s / 2.0


def simplify(pts, eps):
    """Дуглас–Пейкер (итеративно); замкнутое кольцо — двумя дугами через самую дальнюю от начала точку."""
    if len(pts) < 4:
        return pts

    def rdp(a, b):
        keep = {a, b}
        st = [(a, b)]
        while st:
            i0, i1 = st.pop()
            ax, az = pts[i0]; bx, bz = pts[i1]
            dx, dz = bx - ax, bz - az; L = math.hypot(dx, dz) or 1e-9
            best, bi = 0.0, -1
            for i in range(i0 + 1, i1):
                px, pz = pts[i]
                d = abs(dz * px - dx * pz + bx * az - bz * ax) / L
                if d > best:
                    best, bi = d, i
            if best > eps:
                keep.add(bi); st.append((i0, bi)); st.append((bi, i1))
        return [pts[i] for i in sorted(keep)]
    x0, z0 = pts[0]
    if math.hypot(pts[-1][0] - x0, pts[-1][1] - z0) < 1e-6:
        k = max(range(1, len(pts) - 1), key=lambda i: math.hypot(pts[i][0] - x0, pts[i][1] - z0))
        return rdp(0, k)[:-1] + rdp(k, len(pts) - 1)
    return rdp(0, len(pts) - 1)


def pip(x, z, p):
    inside = False
    j = len(p) - 1
    for i in range(len(p)):
        xi, zi = p[i]; xj, zj = p[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
            inside = not inside
        j = i
    return inside


def clip_poly(p, x0, z0, x1, z1):
    """Сазерленд–Ходжмен по прямоугольнику."""
    def cut(pts, inside, inter):
        out = []
        for i in range(len(pts)):
            a, b = pts[i - 1], pts[i]
            ia, ib = inside(a), inside(b)
            if ib:
                if not ia:
                    out.append(inter(a, b))
                out.append(b)
            elif ia:
                out.append(inter(a, b))
        return out

    def ix(v):
        return lambda a, b: (v, a[1] + (b[1] - a[1]) * (v - a[0]) / ((b[0] - a[0]) or 1e-12))

    def iz(v):
        return lambda a, b: (a[0] + (b[0] - a[0]) * (v - a[1]) / ((b[1] - a[1]) or 1e-12), v)
    for ins, inter in ((lambda q: q[0] >= x0, ix(x0)), (lambda q: q[0] <= x1, ix(x1)),
                       (lambda q: q[1] >= z0, iz(z0)), (lambda q: q[1] <= z1, iz(z1))):
        p = cut(p, ins, inter)
        if len(p) < 3:
            return []
    return p


def clip_line(p, x0, z0, x1, z1):
    """Ломаная → куски внутри прямоугольника (Лян–Барски по отрезкам)."""
    runs, cur = [], []
    for i in range(1, len(p)):
        (ax, az), (bx, bz) = p[i - 1], p[i]
        dx, dz = bx - ax, bz - az
        t0, t1, ok = 0.0, 1.0, True
        for pp, qq in ((-dx, ax - x0), (dx, x1 - ax), (-dz, az - z0), (dz, z1 - az)):
            if pp == 0:
                if qq < 0:
                    ok = False
                    break
            else:
                r = qq / pp
                if pp < 0:
                    t0 = max(t0, r)
                else:
                    t1 = min(t1, r)
        if not ok or t0 > t1:
            if cur:
                runs.append(cur); cur = []
            continue
        a = (ax + dx * t0, az + dz * t0); b = (ax + dx * t1, az + dz * t1)
        if not cur:
            cur = [a]
        cur.append(b)
        if t1 < 1.0:
            runs.append(cur); cur = []
    if cur:
        runs.append(cur)
    return [r for r in runs if len(r) >= 2]


def sup_key(x, z):
    return (int(math.floor(x / SUP)), int(math.floor(z / SUP)))


def sup_keys_box(x0, z0, x1, z1):
    for sx in range(int(math.floor(x0 / SUP)), int(math.floor(x1 / SUP)) + 1):
        for sz in range(int(math.floor(z0 / SUP)), int(math.floor(z1 / SUP)) + 1):
            yield (sx, sz)


def bbox(pts):
    xs = [p[0] for p in pts]; zs = [p[1] for p in pts]
    return min(xs), min(zs), max(xs), max(zs)


class Grid:
    """Сетка для поиска по прямоугольникам (дома, рёбра, узлы)."""
    def __init__(self, cell):
        self.c = cell
        self.g = defaultdict(list)

    def add(self, item, x0, z0, x1, z1):
        c = self.c
        for gx in range(int(math.floor(x0 / c)), int(math.floor(x1 / c)) + 1):
            for gz in range(int(math.floor(z0 / c)), int(math.floor(z1 / c)) + 1):
                self.g[(gx, gz)].append(item)

    def query(self, x0, z0, x1, z1):
        c = self.c
        seen = set()
        for gx in range(int(math.floor(x0 / c)), int(math.floor(x1 / c)) + 1):
            for gz in range(int(math.floor(z0 / c)), int(math.floor(z1 / c)) + 1):
                for it in self.g.get((gx, gz), ()):
                    k = it if isinstance(it, int) else id(it)
                    if k not in seen:
                        seen.add(k)
                        yield it


def seg_d(px, pz, ax, az, bx, bz):
    dx, dz = bx - ax, bz - az
    L = dx * dx + dz * dz
    t = 0 if L == 0 else max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / L))
    return math.hypot(ax + dx * t - px, az + dz * t - pz)


def obb_wl(pts):
    """Короткая и длинная стороны минимального повёрнутого прямоугольника контура."""
    best = None
    n = len(pts)
    for i in range(n):
        ax, az = pts[i]; bx, bz = pts[(i + 1) % n]
        dx, dz = bx - ax, bz - az; ln = math.hypot(dx, dz)
        if ln < 0.5:
            continue
        ux, uz = dx / ln, dz / ln
        a = [p[0] * ux + p[1] * uz for p in pts]; b = [-p[0] * uz + p[1] * ux for p in pts]
        da, db = max(a) - min(a), max(b) - min(b)
        if best is None or da * db < best[0]:
            best = (da * db, min(da, db), max(da, db))
    return (best[1], best[2]) if best else (0.0, 0.0)


def yard_trees(sup, land_polys, bgrid, road_runs, water_polys):
    try:
        from shapely.geometry import Polygon, LineString, Point, box as sbox
        from shapely.ops import unary_union
        from shapely.prepared import prep
    except ImportError:
        print("нет shapely — деревья во дворах пропущены", file=sys.stderr)
        return
    T0 = time.time()
    res = []
    for lu, pts in land_polys:
        if lu == "residential" and len(pts) >= 4:
            try:
                pg = Polygon(pts).buffer(0)
            except Exception:
                continue
            if not pg.is_empty:
                res.append((pg, bbox(pts)))
    wat = []
    for p in water_polys:
        if len(p) >= 4:
            try:
                wat.append(Polygon(p).buffer(2))
            except Exception:
                pass
    n_all = 0
    for k in list(sup.keys()):
        x0, z0 = k[0] * SUP, k[1] * SUP
        cell = sbox(x0, z0, x0 + SUP, z0 + SUP)
        R = [pg.intersection(cell) for pg, bb in res if bb[0] < x0 + SUP and bb[2] > x0 and bb[1] < z0 + SUP and bb[3] > z0]
        R = [g for g in R if not g.is_empty]
        if not R:
            continue
        area_ = unary_union(R)
        cut = []
        for b in bgrid.query(x0 - 20, z0 - 20, x0 + SUP + 20, z0 + SUP + 20):
            try:
                cut.append(Polygon(b["pts"]).buffer(4.5 if b["h"] > 6 else 2.5, join_style=2))
            except Exception:
                pass
        for run, w in road_runs.get(k, ()):
            if len(run) >= 2:
                cut.append(LineString(run).buffer(w / 2 + (3.0 if w > 4 else 1.2), cap_style=2))
        cut += [g for g in wat if g.bounds[0] < x0 + SUP and g.bounds[2] > x0 and g.bounds[1] < z0 + SUP and g.bounds[3] > z0]
        if cut:
            area_ = area_.difference(unary_union(cut))
        if area_.is_empty:
            continue
        pa = prep(area_)
        rnd = (k[0] * 73856093) ^ (k[1] * 19349663)
        S = 10.5
        minx, minz, maxx, maxz = area_.bounds
        gx = math.floor(minx / S)
        while gx * S < maxx:
            gz = math.floor(minz / S)
            while gz * S < maxz:
                rnd = (rnd * 1103515245 + 12345) & 0x7fffffff
                r1 = (rnd % 1000) / 1000.0
                rnd = (rnd * 1103515245 + 12345) & 0x7fffffff
                r2 = (rnd % 1000) / 1000.0
                rnd = (rnd * 1103515245 + 12345) & 0x7fffffff
                keep = (rnd % 100) < 58
                x, z = (gx + 0.15 + r1 * 0.7) * S, (gz + 0.15 + r2 * 0.7) * S
                if keep and pa.contains(Point(x, z)):
                    sup[k]["ty"].append((x, z))
                    n_all += 1
                gz += 1
            gx += 1
    print("деревья во дворах:", n_all, "%.0f с" % (time.time() - T0))
