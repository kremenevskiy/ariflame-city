"""Флейм-Сити, люди — конвейер ассетов, шаг 3 из 4: атласы (Python 3 + Pillow + numpy, cwebp).

    python3 tools/fc-humans/tex.py <рабочая папка> <папка игры people/>

На вход — <id>.uv.json от build.py (пути к TGA Rocketbox, треугольники тела с высотами, заплатки). На выход —
people/<id>.webp 1024×512: тело 512² слева, справа голова, волосы (с прозрачностью), снаряжение по 256².
Альфа тела — маска перекраски одежды: 255 — кожа, обувь и всё, что не красим; 160 — верх (выше пояса по средней
высоте острова UV), 96 — низ. Кожа — по цвету кистей с той же текстуры (YCbCr). Не 0: браузеры домножают цвет на
альфу при декоде, нулевая альфа съела бы цвет. Средняя яркость верха и низа — в tex.json (шейдер нормирует перекраску).
Заплатки (assets.json «patch») закрывают флаги, гербы, надписи формы тканью рядом: в игре форма без символики.
"""
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

WORK, OUT = sys.argv[1], sys.argv[2]
ONLY = set(sys.argv[3:])
os.makedirs(OUT, exist_ok=True)
AW, AH = 1024, 512
SLOT = {"body": (0, 0, 512, 512), "head": (512, 0, 256, 256), "opacity": (768, 0, 256, 256), "equip": (512, 256, 256, 256)}


def load(path, rgba=False):
    im = Image.open(path)
    return im.convert("RGBA" if rgba else "RGB")


def patch(im, rect, frm):
    """Заплатка: прямоугольник закрывается тканью со сдвигом frm, края — мягкие (косинус 10 px)."""
    a = np.asarray(im).astype(np.float32)
    x0, y0, x1, y1 = rect
    dx, dy = frm
    src = a[y0 + dy:y1 + dy, x0 + dx:x1 + dx].copy()
    h, w = y1 - y0, x1 - x0
    yy, xx = np.mgrid[0:h, 0:w]
    edge = np.minimum(np.minimum(xx, w - 1 - xx), np.minimum(yy, h - 1 - yy)).astype(np.float32)
    k = np.clip(edge / 10.0, 0, 1)
    k = (0.5 - 0.5 * np.cos(k * np.pi))[..., None]
    a[y0:y1, x0:x1] = a[y0:y1, x0:x1] * (1 - k) + src * k
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).convert(im.mode)


def bleed(rgba):
    """Цвет волос растекается в прозрачное (иначе на мипах — чёрная кайма)."""
    a = np.asarray(rgba).astype(np.float32) / 255.0
    al = a[..., 3:4]
    known = (al > 0.5).astype(np.float32)
    out = a[..., :3] * known

    def blur(x, r):
        im = Image.fromarray(np.clip(x * 255, 0, 255).astype(np.uint8))
        return np.asarray(im.filter(ImageFilter.GaussianBlur(r))).astype(np.float32) / 255.0
    for r in (2, 4, 8, 16, 32):
        pb = blur(out * known, r)
        kb = blur(known[..., 0], r)[..., None]
        need = (known < 0.5) & (kb > 0.004)
        out = np.where(need, pb / np.maximum(kb, 0.004), out)
        known = np.where(need, 1.0, known)
    res = np.concatenate([np.clip(out, 0, 1), al], axis=2)
    return Image.fromarray((res * 255).astype(np.uint8))


def fill_bg(rgb, used):
    """Пустые места атласа (чёрный фон развёртки) заливаем цветом соседних островов: на дальних мипах фон
    подмешивался к одежде, и толпа вдали выходила чёрной."""
    a = np.asarray(rgb).astype(np.float32) / 255.0
    known = used.astype(np.float32)[..., None]
    out = a * known

    def blur(x, r):
        im = Image.fromarray(np.clip(x * 255, 0, 255).astype(np.uint8))
        return np.asarray(im.filter(ImageFilter.GaussianBlur(r))).astype(np.float32) / 255.0
    for r in (1, 2, 4, 8, 16, 32, 64):
        pb = blur(out * known, r)
        kb = blur(known[..., 0], r)[..., None]
        need = (known < 0.5) & (kb > 0.004)
        out = np.where(need, pb / np.maximum(kb, 0.004), out)
        known = np.where(need, 1.0, known)
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8))


def coverage(tris, S):
    """Где на развёртке тела есть треугольники (с запасом в 2 пикселя)."""
    m = Image.new("L", (S, S), 0)
    dr = ImageDraw.Draw(m)
    for t in tris:
        dr.polygon([(u * S, (1 - v) * S) for u, v, _ in t], fill=255)
    return np.asarray(m.filter(ImageFilter.MaxFilter(5))) > 0


def islands(tris):
    """Острова UV: треугольники, связанные общими точками UV."""
    parent = list(range(len(tris)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    seen = {}
    for i, t in enumerate(tris):
        for u, v, _ in t:
            key = (round(u, 4), round(v, 4))
            j = seen.setdefault(key, i)
            if j != i:
                parent[find(i)] = find(j)
    return [find(i) for i in range(len(tris))]


def ycc(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    y = 0.299 * r + 0.587 * g + 0.114 * b
    return y, 128 - 0.168736 * r - 0.331264 * g + 0.5 * b, 128 + 0.5 * r - 0.418688 * g - 0.081312 * b


def skin_ref(head):
    """Цвет кожи — щёки на текстуре головы (лицо в Rocketbox всегда по центру сверху)."""
    a = np.asarray(head.convert("RGB").resize((256, 256), Image.BILINEAR)).astype(np.float32)
    px = np.concatenate([a[87:108, 102:118].reshape(-1, 3), a[87:108, 138:154].reshape(-1, 3)])
    return np.median(px, axis=0)


def body_mask(body, tris, ref):
    """Маска перекраски тела 512²: 160 верх, 96 низ, 255 — кожа, обувь, фон."""
    S = 512
    ids = islands(tris)
    zsum, asum = {}, {}
    for t, i in zip(tris, ids):
        (u0, v0, z0), (u1, v1, z1), (u2, v2, z2) = t
        area = abs((u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)) + 1e-9
        zsum[i] = zsum.get(i, 0) + area * (z0 + z1 + z2) / 3
        asum[i] = asum.get(i, 0) + area
    cls = Image.new("L", (S, S), 0)
    dr = ImageDraw.Draw(cls)
    for t, i in zip(tris, ids):
        z = zsum[i] / asum[i]
        c = 3 if z < 0.13 else 1 if z > 0.9 else 2
        dr.polygon([(u * S, (1 - v) * S) for u, v, _ in t], fill=c)
    cls = cls.filter(ImageFilter.MaxFilter(5))
    C = np.asarray(cls)
    rgb = np.asarray(body).astype(np.float32)
    Y, Cb, Cr = ycc(rgb)
    Y0, Cb0, Cr0 = ycc(ref[None, None, :])
    skin = (np.abs(Cb - Cb0) < 9) & (np.abs(Cr - Cr0) < 11) & (Y > 0.4 * Y0) & (Y < 1.5 * Y0)
    skin = np.asarray(Image.fromarray((skin * 255).astype(np.uint8)).filter(ImageFilter.MedianFilter(3))) > 127
    alpha = np.full((S, S), 255, np.uint8)
    alpha[(C == 1) & ~skin] = 160
    alpha[(C == 2) & ~skin] = 96
    lum = Y / 255.0
    stats = {}
    for name, val in (("top", 160), ("bottom", 96)):
        m = alpha == val
        stats[name] = round(float(lum[m].mean()), 4) if m.any() else 0.5
    return alpha, stats


def build(meta):
    vid = meta["id"]
    atlas = Image.new("RGBA", (AW, AH), (128, 128, 128, 255))
    patches = meta.get("patch", [])
    stats = {"top": 0.5, "bottom": 0.5}
    ref = skin_ref(load(meta["tex"]["head"]))
    for kind, path in meta["tex"].items():
        im = load(path, rgba=(kind == "opacity"))
        for p in patches:
            if p["tex"] == kind or (p["tex"] == "hat" and kind == "equip"):
                im = patch(im, p["rect"], p["from"])
        x, y, w, h = SLOT[kind]
        if kind == "opacity":
            im = bleed(im.convert("RGBa").resize((w, h), Image.LANCZOS).convert("RGBA"))
            atlas.paste(im, (x, y))
            continue
        im = im.resize((w, h), Image.LANCZOS)
        if kind == "body":
            alpha, stats = body_mask(im, meta["tris"], ref)
            im = fill_bg(im, coverage(meta["tris"], w)).convert("RGBA")
            im.putalpha(Image.fromarray(alpha))
        else:
            a = np.asarray(im).astype(np.int32)
            used = np.asarray(Image.fromarray(((a.sum(axis=2) > 24) * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3))) > 0
            im = fill_bg(im, used).convert("RGBA")
        atlas.paste(im, (x, y))
    png = os.path.join(WORK, vid + ".atlas.png")
    atlas.save(png)
    out = os.path.join(OUT, vid + ".webp")
    subprocess.run(["cwebp", "-quiet", "-q", "80", "-m", "6", "-exact", "-alpha_q", "100", "-alpha_filter", "best",
                    png, "-o", out], check=True)
    return {"lum": stats, "kb": round(os.path.getsize(out) / 1024, 1)}


def main():
    res = {}
    tj = os.path.join(WORK, "tex.json")
    if os.path.exists(tj):
        res = json.load(open(tj))
    for f in sorted(os.listdir(WORK)):
        if not f.endswith(".uv.json"):
            continue
        meta = json.load(open(os.path.join(WORK, f)))
        if ONLY and meta["id"] not in ONLY:
            continue
        res[meta["id"]] = build(meta)
        print("[tex]", meta["id"], res[meta["id"]], flush=True)
    json.dump(res, open(tj, "w"), indent=1)


main()
