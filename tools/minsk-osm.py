#!/usr/bin/env python3
"""Минск 1:1 для Флейм-Сити: OpenStreetMap → данные карты игры (client/minsk/).

Задача: «все здания в Минске должны быть узнаваемыми, проспекты, Минск почти полный; на карте
тыкнуть и оказаться там». Данные — OpenStreetMap (ODbL): в игре обязательна подпись «© участники OpenStreetMap»,
производная база публикуется под той же лицензией.

Вход — срез OSM .osm.pbf (BBBike Minsk, нужен pyosmium) или кэш разбора (--cache, pickle от прошлого прогона).
Выход (папка --out):
  meta.js            window.MINSK = {...} — грузится синхронно до модулей игры: граф машинных дорог (узлы, рёбра
                     с ломаными, класс, полосы, одностороннее, мост, имя), светофоры с фазами, районы, важные дома
                     (зоны агентов, точки, дома жителей, штаб — с контурами), кандидаты точек, тихие зоны (мемориалы),
                     фон (госздания), открытые места (парки, площади), аэродром, старт, река, список суперкусков
  map.json           подложка большой карты: застройка, вода, зелень (упрощённые многоугольники) — грузится лениво
  s_<sx>_<sz>.json   суперкуски 1 км: дома (контур, высота, подножие, вид, цвет стен и крыши, форма крыши, фасад),
                     дороги и дорожки (ленты), вода, зелень, рельсы — всё обрезано по краю куска

Координаты — метры от начала (LAT0, LON0): x — восток, z — юг (север — к −z, как в остальном мире игры); в файлах —
целые дециметры. Имена — по-русски (name:ru), бренды заменены нейтральными (NEUTRAL), госздания — без имён.

  tools/minsk-osm.py ~/osm/Minsk.osm.pbf [--cache els.pkl] [--out …/minsk] [--preview картинка.png]
"""
import argparse
import glob
import hashlib
import json
import math
import os
import pickle
import re
import sys
import time
from collections import defaultdict

from minsk_osm_geo import (LAT0, LON0, SUP, Grid, area, bbox, clip_line, clip_poly, dm, flat, flat_d, num, obb_wl,  # noqa: E402
                           pip, seg_d, simplify, sup_key, sup_keys_box, xz, yard_trees)
BBOX = (53.825, 27.385, 53.975, 27.760)     # Минск внутри МКАД с запасом: юг, запад, север, восток


# ---- имена: по-русски, без брендов ------------------------------------------------------------------------------
NEUTRAL = [   # (образец, замена) — юридически: в игре никаких брендов; названия улиц и станций метро можно
    (r"Минск[ -]?Мир|Мінск[ -]?Мір|Minsk ?Mir", "Мир-Сити"),
    (r"^ГУМ$|\bГУМ\b", "Универмаг на Независимости"),
    (r"^ЦУМ$|\bЦУМ\b", "Центральный универмаг"),
    (r"Чижовка[- ]?Арена|Чыжоўка[- ]?Арэна", "Арена Чижовка"),
    (r"Минск[- ]?Арена|Мінск[- ]?Арэна", "Арена"),
    (r"Royal ?Plaza|Роял ?Плаза|Рояль? ?Плаза", "Башни на Победителей"),
    (r"Dana ?Mall|Дана ?Молл", "Торговый центр у Дражни"),
    (r"Газпром|Gazprom", "Бизнес-центр"),
    (r"^Галерея|^Galleria|Галерэя Мінск", "Торговая галерея"),
]
GOV_RE = re.compile(r"Дом [Пп]равительства|Дом Ураду|Дворец Независимости|Палац Незалежнасці|КГБ|Камітэт дзяржаўнай|"
                    r"Комитет государственной безопасности|Администрация Президента|Адміністрацыя Прэзідэнта|"
                    r"Министерств|Міністэрств|Совет Министров|Савет Міністраў|Палата представителей|Генеральная прокуратура|"
                    r"Верховный суд|Национальное собрание", re.I)
KEEP_NAME_RE = re.compile(r"Двор[еа]ц|Палац|Театр|Тэатр|Музей|Музэй|Собор|Сабор|Кост[её]л|Касцёл|Церк|Царк|Храм|Капліц|Часовн|"
                          r"Библиотек|Бібліятэк|Вокзал|Вакзал|Ратуш|Университет|Універсітэт|Академ|Цирк|Цырк|Стадион|Стадыён|"
                          r"Филармон|Філармон|Опер|Ворота|Вароты|Башн|Вежа|Арена|Мир-Сити|Универмаг|Галере|Монумент|Манумент|"
                          r"Мемориал|Мемарыял|Обелиск|Абеліск|Маяк|Бизнес-центр|Кинотеатр|Кінатэатр|Синагог|Мечеть|Костел", re.I)


def name_of(t):
    n = t.get("name:ru") or t.get("name") or ""
    for pat, rep in NEUTRAL:
        if re.search(pat, n, re.I):
            return rep
    return n


def is_gov(t, name):
    return bool(t.get("office") == "government" or t.get("government") or t.get("building") == "government"
                or t.get("amenity") in ("townhall", "courthouse") or GOV_RE.search(name or "") or GOV_RE.search(t.get("name") or ""))


# ---- дома ----------------------------------------------------------------------------------------------------
KIND = {  # building → вид в игре
    "apartments": "res", "residential": "res", "house": "house", "detached": "house", "semidetached_house": "house",
    "dormitory": "res", "terrace": "res", "commercial": "office", "office": "office", "retail": "shop", "supermarket": "shop",
    "kiosk": "kiosk", "industrial": "industrial", "warehouse": "industrial", "factory": "industrial", "garage": "garage",
    "garages": "garage", "church": "church", "cathedral": "church", "chapel": "church", "temple": "church", "synagogue": "church",
    "mosque": "church", "university": "public", "school": "public", "kindergarten": "public", "college": "public",
    "hospital": "public", "public": "public", "civic": "public", "government": "public", "train_station": "public",
    "hotel": "office", "stadium": "public", "sports_hall": "public", "roof": "roof", "construction": "construction",
    "service": "garage", "shed": "garage", "transportation": "public", "tower": "tower", "library": "public",
}
DEF_LEVELS = {"res": 9, "house": 2, "office": 6, "shop": 2, "kiosk": 1, "industrial": 2, "garage": 1, "church": 3,
              "public": 4, "roof": 1, "construction": 5, "tower": 10, "yes": 5}
SHAPES = {"flat": 0, "gabled": 1, "hipped": 2, "half-hipped": 2, "dome": 3, "onion": 4, "pyramidal": 5, "skillion": 6,
          "round": 7, "gambrel": 1, "mansard": 2, "cone": 5, "saltbox": 1}
MATERIAL = {"brick": 1, "concrete": 2, "panel": 2, "glass": 3, "plaster": 4, "stone": 4, "wood": 5, "metal": 6}
CSS = {"white": 0xf4f4f0, "black": 0x2a2a2a, "gray": 0x8d8f93, "grey": 0x8d8f93, "silver": 0xc0c3c8, "red": 0xb0453a,
       "maroon": 0x7a2e2a, "brown": 0x7d5a44, "yellow": 0xe8cf7a, "beige": 0xe2d3b0, "orange": 0xd9853b, "green": 0x4f7d4a,
       "darkgreen": 0x2f5a35, "lightgreen": 0x9cc48a, "blue": 0x4a6fa5, "lightblue": 0x9fc3df, "darkblue": 0x2c3e66,
       "pink": 0xe3a3b0, "purple": 0x7b5a8f, "cream": 0xf1e6c8, "ivory": 0xf6f1df, "tan": 0xc9ad85, "khaki": 0xc8bb8a,
       "lightgray": 0xc8c9cc, "lightgrey": 0xc8c9cc, "darkgray": 0x5b5e63, "darkgrey": 0x5b5e63, "gold": 0xd8b04a,
       "golden": 0xd8b04a, "turquoise": 0x48b5a8, "teal": 0x2e7f7a, "olive": 0x7d7a3a, "navy": 0x2a3557, "salmon": 0xe08a72,
       "peach": 0xf0c19e, "coral": 0xe07a5f, "copper": 0xb0703a, "bronze": 0x9a7340}


def colour(s):
    if not s:
        return -1
    s = str(s).strip().lower().split(";")[0].replace(" ", "")
    if s.startswith("#"):
        h = s[1:]
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        try:
            return int(h[:6], 16)
        except ValueError:
            return -1
    return CSS.get(s, -1)


def height_of(t, kind):
    h = num(t.get("height"))
    rl = num(t.get("roof:levels")) or 0
    lv = num(t.get("building:levels"))
    if h is None and lv is not None:
        h = lv * 3.2 + rl * 2.4 + (0.5 if kind != "roof" else 0)
    if h is None:
        h = DEF_LEVELS.get(kind, 5) * 3.2
    mh = num(t.get("min_height"))
    if mh is None:
        ml = num(t.get("building:min_level"))
        mh = ml * 3.2 if ml is not None else 0.0
    if kind == "roof":
        mh = max(mh, 3.0)
    h = max(2.5, min(h, 400.0))
    return h, max(0.0, min(mh, h - 0.5)), lv


# ---- дороги -----------------------------------------------------------------------------------------------------
ROAD = {  # класс → (полос в сторону по умолчанию, ездят ли машины, ширина пешеходной)
    "motorway": (3, 1, 0), "trunk": (3, 1, 0), "primary": (2, 1, 0), "secondary": (2, 1, 0), "tertiary": (1, 1, 0),
    "motorway_link": (1, 1, 0), "trunk_link": (1, 1, 0), "primary_link": (1, 1, 0), "secondary_link": (1, 1, 0),
    "tertiary_link": (1, 1, 0), "residential": (1, 1, 0), "unclassified": (1, 1, 0), "living_street": (1, 1, 0),
    "service": (1, 1, 0), "pedestrian": (0, 0, 8), "footway": (0, 0, 2.6), "path": (0, 0, 2), "cycleway": (0, 0, 2.4),
    "steps": (0, 0, 3), "track": (0, 0, 3.5),
}
GRAPH = {"motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link", "primary_link",
         "secondary_link", "tertiary_link", "residential", "unclassified", "living_street"}
RANK = {"motorway": 9, "trunk": 8, "primary": 7, "secondary": 6, "tertiary": 5, "motorway_link": 4, "trunk_link": 4,
        "primary_link": 4, "secondary_link": 3, "tertiary_link": 3, "unclassified": 2, "residential": 2, "living_street": 1}
LANE = 3.5
GREEN = {"park", "garden", "grass", "meadow", "village_green", "forest", "wood", "scrub", "grassland", "recreation_ground",
         "pitch", "playground", "cemetery", "allotments", "orchard", "heath"}

# ---- семейства домов: классификатор по тегам OSM и форме контура (по исследованию облика районов) ----
# Код семейства (20+) уходит в шейдер фасада (fgfx.js, ветка «Минск»): шаг окон, высота этажа, цоколь, балконы и лоджии,
# палитра; крыша по семейству — в fosm.js. Порядок правил важен: первое совпавшее побеждает.
FAM = {"generic": 20, "stalin": 21, "postwar": 22, "khr": 23, "khr335": 24, "panel": 25, "tower": 26, "sect": 27, "new": 28,
       "high": 29, "glass": 30, "hist": 31, "ind": 32, "house": 33, "public": 34, "church": 35, "util": 36, "office": 37}
# высота: (этаж, цоколь+низ, парапет/карниз) в метрах — первый этаж сталинки выше (+1,5 м)
FLOORS = {20: (3.2, 0.6, 0.8), 21: (3.6, 2.1, 1.6), 22: (3.3, 0.8, 0.9), 23: (2.8, 0.9, 0.6), 24: (2.8, 0.9, 0.5),
          25: (2.8, 0.9, 1.3), 26: (2.8, 1.0, 2.4), 27: (2.9, 0.9, 1.2), 28: (3.0, 1.4, 1.6), 29: (3.1, 1.6, 2.2),
          30: (3.7, 0.8, 1.2), 31: (3.8, 0.6, 0.8), 32: (5.0, 0.3, 0.8), 33: (3.0, 0.5, 0.2), 34: (3.4, 0.8, 0.8),
          35: (4.5, 0.6, 0.6), 36: (2.8, 0.0, 0.3), 37: (3.6, 0.8, 1.0)}
UTIL_B = {"garages", "garage", "service", "shed", "roof", "kiosk", "carport", "hut", "cabin", "container", "transformer_tower",
          "toilets", "greenhouse", "bunker", "ruins", "storage_tank", "barn", "sty", "stable", "cowshed", "gatehouse", "parking"}
IND_B = {"industrial", "warehouse", "hangar", "factory", "manufacture", "depot", "silo", "boathouse", "farm_auxiliary"}
HOUSE_B = {"house", "detached", "semidetached_house", "bungalow", "farm", "allotment_house", "villa"}
PUBLIC_B = {"school", "kindergarten", "hospital", "university", "college", "clinic", "public", "civic", "library",
            "sports_hall", "train_station", "transportation", "government", "museum"}
CHURCH_B = {"church", "cathedral", "chapel", "temple", "synagogue", "mosque", "monastery", "shrine"}
# новые районы (КПД 2000-х и позже: эркеры, белая основа и пёстрые акценты) — x0, z0, x1, z1 в метрах игры
NEW_ZONES = [(-12500, -4800, -8600, -400), (-9600, 600, -6400, 3600), (-10200, 3600, -6400, 7800), (-2600, 5400, 1600, 8600),
             (-3600, 2880, -1300, 4530), (4450, -3700, 5200, -2850), (7700, -6600, 11000, -4300), (2400, -8400, 6200, -5800)]
# ---- первые этажи: точки OSM внутри дома → вывеска категории (без брендов) ----
SHOP_AMENITY = {"cafe", "restaurant", "fast_food", "pharmacy", "bank", "bar", "pub", "post_office", "dentist", "clinic",
                "bureau_de_change", "ice_cream", "nightclub", "veterinary", "library"}
SIGNS = ["ПРОДУКТЫ", "АПТЕКА", "КАФЕ", "РЕСТОРАН", "БАР", "САЛОН КРАСОТЫ", "ЦВЕТЫ", "ОБМЕН ВАЛЮТ", "ОДЕЖДА", "ХЛЕБ",
         "ПУНКТ ВЫДАЧИ", "МАГАЗИН", "ПОЧТА", "РЕМОНТ ОБУВИ", "ОПТИКА", "КНИГИ", "ФАСТФУД", "ПРЕССА", "СТОМАТОЛОГИЯ", "ЗООТОВАРЫ",
         "ТЕХНИКА", "СТРОЙТОВАРЫ", "ПАРИКМАХЕРСКАЯ", "АЛКОГОЛЬ", "МЕБЕЛЬ", "ДЕТСКИЙ МИР"]


def sign_of(t):
    s, a = t.get("shop"), t.get("amenity")
    if a == "pharmacy":
        return 1
    if a in ("cafe", "ice_cream"):
        return 2
    if a == "restaurant":
        return 3
    if a in ("bar", "pub", "nightclub"):
        return 4
    if a == "fast_food":
        return 16
    if a in ("bank", "bureau_de_change"):
        return 7
    if a == "post_office":
        return 12
    if a in ("dentist", "clinic"):
        return 18
    if a == "veterinary":
        return 19
    if t.get("craft") == "shoemaker" or s == "shoe_repair":
        return 13
    if s in ("convenience", "supermarket", "greengrocer", "butcher", "deli", "farm", "frozen_food", "dairy", "general", "food"):
        return 0
    if s in ("hairdresser",):
        return 22
    if s in ("beauty", "cosmetics", "perfumery", "massage", "tattoo", "nail_salon"):
        return 5
    if s == "florist":
        return 6
    if s in ("clothes", "shoes", "boutique", "fashion", "bag", "fabric", "underwear"):
        return 8
    if s in ("bakery", "pastry", "confectionery"):
        return 9
    if s in ("outpost", "parcel_pickup"):
        return 10
    if s == "optician":
        return 14
    if s in ("books", "stationery"):
        return 15
    if s in ("newsagent", "kiosk", "tobacco"):
        return 17
    if s in ("pet", "pet_grooming"):
        return 19
    if s in ("electronics", "mobile_phone", "computer", "appliance"):
        return 20
    if s in ("hardware", "doityourself", "paint", "building_materials"):
        return 21
    if s in ("alcohol", "beverages", "wine"):
        return 23
    if s in ("furniture", "interior_decoration"):
        return 24
    if s in ("toys", "baby_goods"):
        return 25
    if s:
        return 11
    if a == "pharmacy":
        return 1
    return -1


# ---- улицы: сокращения для адресных табличек и поиска ---------------------------------------------------------------
STREET_ABBR = [(r"^улица |\s+улица$", "ул. "), (r"^проспект |\s+проспект$", "пр-т "), (r"^переулок |\s+переулок$", "пер. "),
               (r"^бульвар |\s+бульвар$", "б-р "), (r"^площадь |\s+площадь$", "пл. "), (r"^проезд |\s+проезд$", "пр. "),
               (r"^шоссе |\s+шоссе$", "ш. "), (r"^тупик |\s+тупик$", "туп. ")]


def street_short(n):
    for pat, rep in STREET_ABBR:
        if re.search(pat, n):
            return (rep + re.sub(pat, "", n)).strip()
    return n


def load_pbf(path, bbox_=BBOX):
    """Срез OSM (.osm.pbf) → элементы в формате Overpass `out tags geom`. Площади (дома, вода, зелень) собирает osmium —
    и из замкнутых линий, и из мультиполигонов; линии (дороги, рельсы, реки) — как есть."""
    import osmium
    s, w, n, e = bbox_
    AREA_KEYS = ("building", "building:part", "natural", "landuse", "leisure", "water", "amenity", "place", "aeroway")
    out = []

    def inside(lat, lon):
        return s <= lat <= n and w <= lon <= e

    class H(osmium.SimpleHandler):
        def node(self, nd):
            t = dict(nd.tags)
            if not t or not nd.location.valid():
                return
            keep = (t.get("name") and (t.get("amenity") or t.get("shop") or t.get("tourism") or t.get("historic") or t.get("railway")
                                       or t.get("place") or t.get("leisure") or t.get("craft") or t.get("office")))
            # улица и первые этажи (22.11, «Минск узнаваемый»): подъезды, магазины в домах, переходы, фонари, остановки,
            # входы в метро, деревья, адресные точки
            street = ("entrance" in t or t.get("shop") or t.get("amenity") in SHOP_AMENITY or t.get("craft") == "shoemaker"
                      or t.get("highway") in ("crossing", "street_lamp", "bus_stop") or t.get("railway") == "subway_entrance"
                      or t.get("natural") == "tree" or (t.get("public_transport") == "platform" and (t.get("bus") or t.get("trolleybus")))
                      or ("addr:housenumber" in t and "addr:street" in t))
            if not (keep or street or t.get("highway") == "traffic_signals" or t.get("amenity") in ("police", "fuel", "hospital", "bank")):
                return
            if inside(nd.location.lat, nd.location.lon):
                out.append({"type": "node", "id": nd.id, "lat": nd.location.lat, "lon": nd.location.lon, "tags": t})

        def way(self, wy):
            t = dict(wy.tags)
            if not t:
                return
            if wy.is_closed() and any(k in t for k in AREA_KEYS) and "highway" not in t and "railway" not in t:
                return
            if not ("highway" in t or "railway" in t or "waterway" in t or t.get("aeroway") in ("runway", "taxiway")
                    or t.get("natural") == "tree_row"):
                return
            try:
                g = [{"lat": nd.location.lat, "lon": nd.location.lon} for nd in wy.nodes]
            except osmium.InvalidLocationError:
                return
            if g and any(inside(p["lat"], p["lon"]) for p in g):
                out.append({"type": "way", "id": wy.id, "tags": t, "geometry": g})

        def area(self, a):
            t = dict(a.tags)
            if not any(k in t for k in AREA_KEYS):
                return
            members = []
            try:
                for ring in a.outer_rings():
                    g = [{"lat": nd.lat, "lon": nd.lon} for nd in ring]
                    if g and inside(g[0]["lat"], g[0]["lon"]):
                        members.append({"role": "outer", "geometry": g})
            except osmium.InvalidLocationError:
                return
            if members:
                oid = a.orig_id()
                out.append({"type": "relation", "id": oid if a.from_way() else 10 ** 12 + oid, "tags": t, "members": members})

    H().apply_file(path, locations=True)
    return out


# ---- места, о которых знает игра (координаты — из OSM, проверены 22.11.2026) -------------------------------------
QUIET = [  # мемориалы: тихие зоны — без ограблений, банд, трамплинов, заданий; трафик идёт
    (-300, -980, 170, "Площадь Победы"), (-1565, -818, 110, "Остров слёз"), (-2658, -1680, 150, "Музей истории ВОВ"),
    (-2749, -1757, 110, "Стела «Минск — город-герой»"), (-2438, -1073, 70, "Мемориал «Яма»"), (8297, 5272, 220, "Тростенец"),
]
GOV = [  # госздания: только фон (без точек, заданий, банд, участков)
    (-2288, 448, 110, "Дом Правительства"), (-4265, -3316, 300, "Дворец Независимости"), (-1280, 55, 70, "КГБ"),
    (-1660, -144, 80, "Администрация Президента"),
]
DISTRICTS_EXTRA = [  # районы, которых нет в place=*, или с именем для игры
    ("Центр", -800, -350, 3), ("Немига", -1726, -619, 3), ("Верхний город", -1549, -480, 3), ("Проспект Победителей", -3000, -950, 3),
    ("Проспект Независимости", 1300, -2100, 3), ("Мир-Сити", -2200, 3700, 3), ("Маяк Минска", 4811, -3388, 3),
    ("Октябрьская", -900, -150, 2), ("Вокзал", -1950, 1000, 2), ("Комаровка", -300, -2600, 2), ("Тракторный завод", 2740, 865, 2),
]
START = (4250, -3560)          # у Национальной библиотеки (Площадь Победы — мемориал, сюжет там не начинаем)
HQ_TARGET = (4880, -3160)      # «башня-маяк» Маяка Минска — не построена; ставим Башню Флейм
MIR = (-3600, 2880, -1300, 4530)   # Мир-Сити: бывший аэропорт Минск-1 (x0, z0, x1, z1)
ANCHORS = {  # зона → (x, z, радиус поиска, предпочтение)
    "library": (4334, -3448, 60, "tall"), "scout": (4880, -3300, 260, "tallres"), "forge": (2740, 865, 700, "big"),
    "film": (3298, -3006, 120, "big"),
}


def classify(blds, parts, land_polys):
    """Семейство, этажность и высота каждого дома (правила исследования облика районов; пропуски этажности — по виду, площади,
    форме, landuse и медиане соседей). Пишет b["fam"], b["levels"], b["h"], b["shape"] (крыша по семейству, если в OSM нет)."""
    LU = Grid(400)
    for lu, pts in land_polys:
        LU.add((lu, pts, bbox(pts)), *bbox(pts))

    def landuse(x, z):
        for lu, pts, bb in LU.query(x, z, x, z):
            if bb[0] <= x <= bb[2] and bb[1] <= z <= bb[3] and pip(x, z, pts):
                return lu
        return None
    p_core, p_c = xz(53.9050, 27.5575), xz(53.90277, 27.56131)
    axis = [xz(53.8945, 27.5465), xz(53.9160, 27.5840), xz(53.9203, 27.5984)]

    def d_axis(x, z):
        return min(seg_d(x, z, axis[i][0], axis[i][1], axis[i + 1][0], axis[i + 1][1]) for i in range(len(axis) - 1))

    def in_new(x, z):
        return any(q[0] <= x <= q[2] and q[1] <= z <= q[3] for q in NEW_ZONES)
    known = Grid(120)
    for b in blds:
        t = b["t"]
        b["W"], b["L"] = obb_wl(b["pts"])
        b["lu"] = landuse(b["cx"], b["cz"])
        lv = num(t.get("building:levels"))
        if lv is None and num(t.get("height")):
            lv = max(1, round(num(t.get("height")) / 3.0))
        b["lv0"] = lv
        if lv and t.get("building") in ("apartments", "residential", "yes", "dormitory") and lv >= 2:
            known.add(b, b["cx"], b["cz"], b["cx"], b["cz"])

    def nb_median(b):
        ls = sorted(q["lv0"] for q in known.query(b["cx"] - 120, b["cz"] - 120, b["cx"] + 120, b["cz"] + 120)
                    if q is not b and abs(q["A"] - b["A"]) < max(300, b["A"] * 0.8))
        return ls[len(ls) // 2] if len(ls) >= 3 else None

    for b in blds:
        t = b["t"]
        bk = t.get("building") or "yes"
        A, W, L, lv = b["A"], b["W"], b["L"], b["lv0"]
        x, z = b["cx"], b["cz"]
        year = b["year"] if b["year"] and 1000 < b["year"] < 2100 else None
        roof = t.get("roof:shape")
        amen = t.get("amenity")
        res = bk in ("apartments", "residential", "dormitory") or (bk == "yes" and (lv or 0) >= 5 and b["lu"] == "residential")
        dc = math.hypot(x - p_c[0], z - p_c[1])
        fam = None
        if bk in CHURCH_B or amen == "place_of_worship":
            fam = "church"
        elif bk in UTIL_B:
            fam = "util"
        elif bk in IND_B or (bk == "yes" and lv is None and b["lu"] in ("industrial", "railway", "garages")):
            fam = "ind" if not (b["lu"] == "garages" and A < 600) else "util"
        elif bk in HOUSE_B or (bk == "yes" and A < 250 and t.get("addr:housenumber") and (lv or 1) <= 2):
            fam = "house"
        elif t.get("building:architecture") == "stalinist_neoclassicism":
            fam = "stalin"
        if lv is None:                                   # этажности нет — оцениваем
            if fam == "util" or (bk == "yes" and A < 250 and not t.get("addr:housenumber")):
                lv, fam = 1, fam or "util"
            elif fam == "house":
                lv = 1 if A < 90 else 2
            elif fam == "ind":
                lv = 1 if A > 1500 else 2
            elif fam == "church":
                lv = 3
            elif (res or bk == "yes") and 11 <= W <= 16.5 and L > 40:
                lv = 5 if dc < 4000 else 9
            elif bk == "kindergarten" or amen == "kindergarten":
                lv = 2
            elif bk == "school" or amen == "school":
                lv = 3
            else:
                lv = nb_median(b) or (3 if b["lu"] == "residential" else 2)
        if fam is None:
            hh = num(t.get("height")) or 0
            off = bk in ("office", "commercial", "retail", "hotel") or t.get("office") or t.get("shop")
            if lv >= 20 or hh >= 60:
                fam = "glass" if off else "high"
            elif off and lv >= 6 and (year is None or year >= 1995):
                fam = "glass"
            elif math.hypot(x - p_core[0], z - p_core[1]) < 520 and lv <= 4:
                fam = "hist"
            elif (year and 1944 <= year <= 1957) or (3 <= lv <= 7 and d_axis(x, z) < 180):
                fam = "stalin"
            elif 2 <= lv <= 4 and roof in ("hipped", "gabled", "half-hipped") and (res or bk == "yes"):
                fam = "postwar"
            elif 3 <= lv <= 7 and dc < 2500 and roof in (None, "hipped") and len(b["pts"]) >= 8 and (res or bk == "yes"):
                fam = "stalin"
            elif bk in PUBLIC_B or amen in ("school", "kindergarten", "hospital", "university", "college", "clinic"):
                fam = "public"
            elif lv == 5 and 10.5 <= W <= 15.5 and L >= 30:
                fam = "khr335" if roof == "hipped" else "khr"
            elif 9 <= lv <= 12 and 10.5 <= W <= 16.5:
                fam = "new" if ((year and year >= 1998) or (in_new(x, z) and lv >= 10)) else "panel"
            elif 13 <= lv <= 19 and L / max(W, 1) < 1.45:
                fam = "new" if ((year and year >= 1998) or in_new(x, z)) else "tower"
            elif 9 <= lv <= 19:
                fam = "new" if ((year and year >= 1998) or in_new(x, z)) else "sect"
            elif off:
                fam = "office"
            elif res and lv <= 4:
                fam = "postwar" if dc < 7000 else ("house" if lv <= 2 else "postwar")
            elif res:
                fam = "sect" if lv >= 5 else "postwar"
            elif lv <= 2 and A < 400:
                fam = "util" if not t.get("addr:housenumber") else "house"
            else:
                fam = "generic"
        f = FAM[fam]
        b["fam"], b["levels"] = f, int(lv)
        if num(t.get("height")) is None:                 # высота по семейству: цоколь + этажи + парапет/карниз
            fh, base, par = FLOORS[f]
            rl = num(t.get("roof:levels")) or 0
            hc = base + lv * fh + par + rl * 2.6
            b["h"] = round(max(b["h"], hc) if b["flags"] == 2 else hc, 1)      # контур с частями — не ниже частей
        if not b["shape"] and not t.get("roof:shape"):   # крыша по семейству
            if f in (21, 22):
                b["shape"] = 2
            elif f == 31:
                b["shape"] = 1
            elif f == 33:
                b["shape"] = 1 if (b["osm"] % 3) else 2
    for p in parts:
        par = p.get("parent")
        t = p["t"]
        lv = num(t.get("building:levels"))
        p["fam"] = par["fam"] if par else (FAM["church"] if (t.get("building:part") in CHURCH_B or t.get("building") in CHURCH_B) else FAM["generic"])
        p["levels"] = int(lv) if lv else max(1, int(round((p["h"] - p["mh"]) / 3.4)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src", nargs="?", help="срез .osm.pbf")
    ap.add_argument("--cache", help="pickle разобранных элементов (читать, если есть; писать, если нет)")
    ap.add_argument("--out", default="client/minsk")
    ap.add_argument("--preview")
    args = ap.parse_args()
    T0 = time.time()
    if args.cache and os.path.exists(args.cache):
        els = pickle.load(open(args.cache, "rb"))
    else:
        els = load_pbf(args.src)
        if args.cache:
            pickle.dump(els, open(args.cache, "wb"))
    print("элементов:", len(els), "%.0f с" % (time.time() - T0))

    sup = defaultdict(lambda: {"b": [], "r": [], "w": [], "g": [], "l": [], "x": [], "lp": [], "sp": [], "me": [], "t": [], "ty": [], "tw": []})
    blds, parts, nodes_pt, car_ways, signals_pt = [], [], [], [], []
    water_polys, green_polys, land_polys, water_lines, rail_lines, river_lines, open_spots = [], [], [], [], [], [], []
    gov = [list(g) for g in GOV]
    wires, tree_lines, street_ru, road_runs = [], [], {}, defaultdict(list)
    gid = 0

    # ---- разбор ----
    for e in els:
        t = e.get("tags") or {}
        if e["type"] == "node":
            x, z = xz(e["lat"], e["lon"])
            if t.get("highway") == "traffic_signals":
                signals_pt.append((x, z))
            else:
                nodes_pt.append((x, z, t))
            continue
        if e["type"] == "relation":
            polys = [[xz(p["lat"], p["lon"]) for p in m["geometry"] if p] for m in (e.get("members") or [])
                     if m.get("role") == "outer" and m.get("geometry")]
        else:
            polys = [[xz(p["lat"], p["lon"]) for p in (e.get("geometry") or []) if p]]

        if "building" in t or "building:part" in t:
            bk = t.get("building") or t.get("building:part") or "yes"
            lvl = num(t.get("building:levels"))
            kind = KIND.get(bk, ("res" if lvl and lvl >= 5 else "office") if bk in ("yes", "true") else "res")
            if t.get("amenity") == "place_of_worship" and t.get("building") in ("yes", None):
                kind = "church"
            h, mh, levels = height_of(t, kind)
            name = name_of(t)
            g = is_gov(t, name)
            if not (KEEP_NAME_RE.search(name or "") or kind == "church" or t.get("tourism") or t.get("historic")
                    or t.get("amenity") in ("theatre", "library", "university", "college", "cinema", "arts_centre")):
                name = ""
            if g:
                name = ""
            shape = SHAPES.get(t.get("roof:shape", ""), 0)
            rh = num(t.get("roof:height"))
            if rh is None and t.get("roof:levels"):
                rh = (num(t.get("roof:levels")) or 0) * 2.5
            for pts in polys:
                if len(pts) < 4:
                    continue
                if math.hypot(pts[0][0] - pts[-1][0], pts[0][1] - pts[-1][1]) < 0.5:
                    pts = pts[:-1]
                if abs(area(pts)) < 12:
                    continue
                if area(pts) > 0:                 # обход против часовой в плоскости x-z (север = −z)
                    pts = pts[::-1]
                pts = simplify(pts + [pts[0]], 0.35)[:-1]
                if len(pts) < 3:
                    continue
                A = abs(area(pts))
                cx = sum(p[0] for p in pts) / len(pts); cz = sum(p[1] for p in pts) / len(pts)
                b = {"id": gid, "osm": e["id"], "h": h, "mh": mh, "kind": kind, "pts": pts, "name": name, "part": "building" not in t,
                     "wall": colour(t.get("building:colour")), "roof": colour(t.get("roof:colour")), "shape": shape,
                     "rh": rh, "mat": MATERIAL.get(t.get("building:material") or t.get("building:facade:material") or "", 0),
                     "levels": levels, "cx": cx, "cz": cz, "A": A, "bb": bbox(pts), "gov": g, "t": t, "flags": 3, "pi": -1,
                     "year": num(str(t.get("start_date") or t.get("building:start_date") or "")[:4])}
                gid += 1
                (parts if b["part"] else blds).append(b)
                if g:
                    gov.append([round(cx), round(cz), round(min(160, 10 + math.sqrt(A) * 0.8)), name])
            continue

        hw = t.get("highway")
        if hw in ROAD and e["type"] == "way":
            pts = polys[0]
            if len(pts) < 2 or t.get("tunnel") in ("yes", "building_passage", "culvert") or t.get("area") == "yes":
                continue
            if t.get("footway") in ("sidewalk", "crossing") or t.get("indoor") == "yes":
                continue
            dl, car, w0 = ROAD[hw]
            one = t.get("oneway") in ("yes", "1", "true", "-1") or t.get("junction") in ("roundabout", "circular") or hw == "motorway"
            if t.get("oneway") == "-1":
                pts = pts[::-1]
            if t.get("oneway") == "no":
                one = False
            lanes = dl
            ln = num(t.get("lanes"))
            if car and ln and ln > 0:
                lanes = int(ln) if one else max(1, int(ln) // 2)
            if car:
                w = lanes * LANE * (1 if one else 2) + (1.0 if not one and RANK.get(hw, 0) >= 6 else 0.4)
                if hw == "service":
                    w = 5.0 if not one else 3.6
                if hw in ("residential", "living_street", "unclassified") and not ln:
                    w = 7.5 if not one else 4.5
            else:
                w = w0
            name = t.get("name:ru") or t.get("name") or ""
            if t.get("name") and t.get("name:ru"):
                street_ru[t["name"]] = t["name:ru"]
            br = 1 if t.get("bridge") not in (None, "no") else 0
            layer = int(num(t.get("layer")) or 0)
            spts = simplify(pts, 0.5 if car else 1.0)
            svc = t.get("service")
            row = (hw, round(w, 1), lanes if car else 0, (1 if one else 0) | (2 if br else 0) | (4 if car else 0)
                   | (8 if svc == "parking_aisle" else 0) | (16 if svc == "driveway" else 0), layer)
            # троллейбусная контактная сеть (trolley_wire=yes ≈ 369 км; в центре Независимости проводов нет — так и в OSM)
            tw, twf, twb = t.get("trolley_wire"), t.get("trolley_wire:forward"), t.get("trolley_wire:backward")
            if car and "yes" in (tw, twf, twb) and not br:
                fw, bw = (tw == "yes" or twf == "yes"), (not one and (tw == "yes" or twb == "yes"))
                if t.get("oneway") == "-1":
                    fw, bw = bw, fw
                wires.append((spts, w, one, 1 if fw else 0, 1 if bw else 0))
            x0_, z0_, x1_, z1_ = bbox(spts)
            for k in sup_keys_box(x0_, z0_, x1_, z1_):
                for run in clip_line(spts, k[0] * SUP, k[1] * SUP, (k[0] + 1) * SUP, (k[1] + 1) * SUP):
                    sup[k]["r"].append(list(row) + [flat_d(run)])
                    road_runs[k].append((run, w))
            if hw in GRAPH:
                car_ways.append({"pts": pts, "cls": hw, "lanes": max(1, lanes), "one": one, "br": br, "name": name, "w": w})
            continue

        if t.get("natural") == "tree_row" and e["type"] == "way":
            if len(polys[0]) >= 2:
                tree_lines.append(polys[0])
            continue
        if t.get("railway") in ("rail", "tram", "light_rail") and e["type"] == "way" and t.get("tunnel") != "yes":
            pts = simplify(polys[0], 0.8)
            if len(pts) >= 2:
                rail_lines.append((t["railway"], pts))
            continue
        if t.get("natural") == "water" or t.get("waterway") == "riverbank" or t.get("water") or t.get("landuse") in ("reservoir", "basin"):
            for pts in polys:
                if len(pts) >= 4 and abs(area(pts)) > 40:
                    water_polys.append(simplify(pts, 1.0))
            continue
        if t.get("waterway") in ("river", "canal", "stream") and e["type"] == "way":
            pts = simplify(polys[0], 1.0)
            if len(pts) >= 2:
                water_lines.append((pts, 16 if t["waterway"] == "river" else 7 if t["waterway"] == "canal" else 4))
                if t["waterway"] == "river" and re.search(r"Свіслач|Свислочь", (t.get("name") or "") + (t.get("name:ru") or "")):
                    river_lines.append(pts)
            continue
        g = t.get("leisure") or t.get("landuse") or t.get("natural")
        if g in GREEN or t.get("amenity") == "parking" or t.get("place") == "square" or t.get("highway") == "pedestrian":
            kind = "park" if g in GREEN else ("parking" if t.get("amenity") == "parking" else "square")
            for pts in polys:
                A = abs(area(pts)) if len(pts) >= 4 else 0
                if A > 80:
                    green_polys.append((kind, simplify(pts, 1.5)))
                if A > 2500 and kind in ("park", "square") and g not in ("forest", "wood", "cemetery", "allotments", "scrub"):
                    open_spots.append((kind, pts, A, name_of(t)))
            continue
        lu = t.get("landuse")
        if lu in ("residential", "commercial", "retail", "industrial", "construction", "railway", "garages"):
            for pts in polys:
                if len(pts) >= 4 and abs(area(pts)) > 400:
                    land_polys.append((lu, simplify(pts, 4.0)))
        if t.get("amenity") in ("police", "hospital", "fuel", "bank", "car_wash", "cinema", "theatre") or t.get("shop") in ("supermarket", "car", "florist", "hairdresser"):
            for pts in polys:
                if len(pts) >= 3:
                    cx = sum(p[0] for p in pts) / len(pts); cz = sum(p[1] for p in pts) / len(pts)
                    nodes_pt.append((cx, cz, t))
    print("домов:", len(blds), "частей:", len(parts), "машинных линий:", len(car_ways), "%.0f с" % (time.time() - T0))

    # ---- части домов: контур с частями не рисуем (рисуем части), высота контура — по самой высокой части ----
    og = Grid(60)
    for b in blds:
        og.add(b, *b["bb"])
    for p in parts:
        hit = False
        for b in og.query(p["cx"], p["cz"], p["cx"], p["cz"]):
            if b["bb"][0] <= p["cx"] <= b["bb"][2] and b["bb"][1] <= p["cz"] <= b["bb"][3] and pip(p["cx"], p["cz"], b["pts"]):
                b["flags"] = 2                      # только столкновения
                b["h"] = max(b["h"], p["h"])
                p["parent"] = b
                hit = True
        p["flags"] = 1 if (hit or p["mh"] > 2.5) else 3     # часть внутри контура — только рисуем
    allb = blds + parts
    bgrid = Grid(50)
    for b in allb:
        if b["flags"] & 2:
            bgrid.add(b, *b["bb"])

    classify(blds, parts, land_polys)
    print("семейства:", sorted(((k, sum(1 for b in allb if b["fam"] == v)) for k, v in FAM.items()), key=lambda q: -q[1]),
          "%.0f с" % (time.time() - T0))

    def building_at(x, z, pad=0.0):
        for b in bgrid.query(x - pad, z - pad, x + pad, z + pad):
            x0, z0, x1, z1 = b["bb"]
            if x0 - pad <= x <= x1 + pad and z0 - pad <= z <= z1 + pad and (pad > 0 or pip(x, z, b["pts"])):
                return b
        return None

    def in_list(x, z, lst):
        for q in lst:
            if math.hypot(x - q[0], z - q[1]) < q[2]:
                return q
        return None

    # ---- граф машинных дорог ----
    def key(p):
        return (round(p[0], 1), round(p[1], 1))
    use = defaultdict(int)
    for w in car_ways:
        ks = [key(p) for p in w["pts"]]
        w["ks"] = ks
        for k in ks:
            use[k] += 1
        use[ks[0]] += 2; use[ks[-1]] += 2
    node_id, nodes = {}, []
    edges = []

    def nid(k):
        if k not in node_id:
            node_id[k] = len(nodes)
            nodes.append({"x": k[0], "z": k[1], "e": []})
        return node_id[k]
    for w in car_ways:
        ks, pts = w["ks"], w["pts"]
        start = 0
        for i in range(1, len(ks)):
            if use[ks[i]] >= 2 or i == len(ks) - 1:
                seg = pts[start:i + 1]
                if len(seg) >= 2 and ks[start] != ks[i]:
                    a, b = nid(ks[start]), nid(ks[i])
                    E = {"a": a, "b": b, "pts": seg, "cls": w["cls"], "lanes": w["lanes"], "one": w["one"], "br": w["br"],
                         "name": w["name"], "w": w["w"], "dead": False}
                    edges.append(E); nodes[a]["e"].append(E); nodes[b]["e"].append(E)
                start = i

    def same(e1, e2):
        return (e1["cls"] == e2["cls"] and e1["lanes"] == e2["lanes"] and e1["one"] == e2["one"] and e1["br"] == e2["br"]
                and e1["name"] == e2["name"])
    merged = 0
    for ni, n in enumerate(nodes):          # склейка цепочек: узел ровно с двумя одинаковыми рёбрами исчезает
        es = [e for e in n["e"] if not e["dead"]]
        if len(es) != 2 or es[0] is es[1] or not same(es[0], es[1]):
            continue
        e1, e2 = es
        if e1["one"]:
            if e1["a"] == ni and e2["b"] == ni:
                e1, e2 = e2, e1
            if not (e1["b"] == ni and e2["a"] == ni):
                continue
        p1 = e1["pts"] if e1["b"] == ni else e1["pts"][::-1]
        p2 = e2["pts"] if e2["a"] == ni else e2["pts"][::-1]
        A = e1["a"] if e1["b"] == ni else e1["b"]
        B = e2["b"] if e2["a"] == ni else e2["a"]
        if A == B:
            continue
        NE = dict(e1)
        NE.update({"a": A, "b": B, "pts": p1 + p2[1:], "dead": False})
        e1["dead"] = e2["dead"] = True
        edges.append(NE)
        for x in (A, B):
            nodes[x]["e"] = [q for q in nodes[x]["e"] if q is not e1 and q is not e2] + [NE]
        n["e"] = []
        merged += 1
    edges = [e for e in edges if not e["dead"]]
    par = list(range(len(nodes)))           # связность: машина не должна застрять на отрезанном кусочке

    def find(i):
        while par[i] != i:
            par[i] = par[par[i]]; i = par[i]
        return i
    for e in edges:
        ra, rb = find(e["a"]), find(e["b"])
        if ra != rb:
            par[ra] = rb
    clen = defaultdict(float)
    for e in edges:
        e["len"] = sum(math.hypot(e["pts"][i][0] - e["pts"][i - 1][0], e["pts"][i][1] - e["pts"][i - 1][1]) for i in range(1, len(e["pts"])))
        clen[find(e["a"])] += e["len"]
    edges = [e for e in edges if clen[find(e["a"])] > 1500]
    used = sorted({e["a"] for e in edges} | {e["b"] for e in edges})
    remap = {o: i for i, o in enumerate(used)}
    nodes = [nodes[o] for o in used]
    for n in nodes:
        n["e"] = []
    for e in edges:
        e["a"], e["b"] = remap[e["a"]], remap[e["b"]]
        nodes[e["a"]]["e"].append(e); nodes[e["b"]]["e"].append(e)
        e["pts"] = simplify(e["pts"], 0.6)
    ngrid = Grid(40)
    for i, n in enumerate(nodes):
        ngrid.add(i, n["x"], n["z"], n["x"], n["z"])
    sig = set()                             # светофоры: перекрёсток (3+ ребра) в 30 м от точки светофора
    for (sx, sz) in signals_pt:
        for i in ngrid.query(sx - 30, sz - 30, sx + 30, sz + 30):
            n = nodes[i]
            if len(n["e"]) >= 3 and math.hypot(n["x"] - sx, n["z"] - sz) < 30:
                sig.add(i)
    sp = {i: i for i in sig}                # фазы: светофоры ближе 45 м — один перекрёсток (общий сдвиг цикла и ось)

    def sfind(i):
        while sp[i] != i:
            sp[i] = sp[sp[i]]; i = sp[i]
        return i
    for i in sig:
        n = nodes[i]
        for j in ngrid.query(n["x"] - 45, n["z"] - 45, n["x"] + 45, n["z"] + 45):
            if j in sig and j != i and math.hypot(nodes[j]["x"] - n["x"], nodes[j]["z"] - n["z"]) < 45:
                ra, rb = sfind(i), sfind(j)
                if ra != rb:
                    sp[ra] = rb
    cl_axis = {}
    for i in sig:
        r = sfind(i)
        for e in nodes[i]["e"]:
            p = e["pts"] if e["a"] == i else e["pts"][::-1]
            ang = math.degrees(math.atan2(p[1][1] - p[0][1], p[1][0] - p[0][0])) % 180
            sc = RANK.get(e["cls"], 0) * 1e6 + e["len"]
            if r not in cl_axis or sc > cl_axis[r][0]:
                cl_axis[r] = (sc, ang)
    names, name_i = [], {}

    def nmi(s):
        if not s:
            return -1
        if s not in name_i:
            name_i[s] = len(names); names.append(s)
        return name_i[s]
    CLS = ["motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link", "primary_link",
           "secondary_link", "tertiary_link", "unclassified", "residential", "living_street"]
    meta_nodes = []
    for i, n in enumerate(nodes):
        if i in sig:
            r = sfind(i)
            meta_nodes += [dm(n["x"]), dm(n["z"]), 1, round(cl_axis[r][1]), (r * 7) % 26]
        else:
            meta_nodes += [dm(n["x"]), dm(n["z"]), 0, -1, 0]
    meta_edges = []
    for e in edges:
        meta_edges.append([e["a"], e["b"], CLS.index(e["cls"]), e["lanes"], (1 if e["one"] else 0) | (2 if e["br"] else 0),
                           round(e["w"] * 10), nmi(e["name"])] + flat_d(e["pts"]))
    print("граф: узлов", len(nodes), "рёбер", len(edges), "склеено", merged, "светофоров", len(sig), "%.0f с" % (time.time() - T0))
    egrid = Grid(60)
    for e in edges:
        egrid.add(e, *bbox(e["pts"]))

    def near_edge(x, z, r=80):
        best, bd = None, 1e9
        for e in egrid.query(x - r, z - r, x + r, z + r):
            p = e["pts"]
            for i in range(1, len(p)):
                d = seg_d(x, z, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]) - e["w"] / 2
                if d < bd:
                    bd, best = d, e
        return best, bd

    # ---- подъезды, магазины первых этажей, адреса (ресёрч «per_building_realism»: подъезды у 6,7 тыс. многоэтажек,
    #      7,4 тыс. точек магазинов внутри 2,4 тыс. домов, адрес у 99 % многоэтажек) ----
    def edge_near(b, x, z, tol):
        p = b["pts"]
        for i in range(len(p)):
            a, c = p[i], p[(i + 1) % len(p)]
            if seg_d(x, z, a[0], a[1], c[0], c[1]) < tol:
                return True
        return False
    n_ent = n_shop = 0
    for (x, z, t) in nodes_pt:
        if "entrance" in t:
            for b in bgrid.query(x - 1.5, z - 1.5, x + 1.5, z + 1.5):
                if b["part"] or not edge_near(b, x, z, 1.2):
                    continue
                ref = t.get("ref") or ""
                rf = int(ref) if ref.isdigit() and int(ref) < 100 else 0
                kind = 2 if t.get("entrance") in ("main", "shop") else 1
                b.setdefault("ents", []).append((x, z, rf, kind)); n_ent += 1
                break
            continue
        sg = sign_of(t)
        if sg >= 0:
            for b in bgrid.query(x, z, x, z):
                if b["part"] or not pip(x, z, b["pts"]):
                    continue
                L = b.setdefault("shops", [])
                if len(L) < 10 and not any(q[2] == sg and math.hypot(q[0] - x, q[1] - z) < 6 for q in L):
                    L.append((x, z, sg)); n_shop += 1
                break
    # адреса: дом → «улица, номер» (по-русски для табличек; поиск — и по-белорусски)
    addr_idx = defaultdict(list)

    def ru_street(be):
        return street_ru.get(be) or be
    for (x, z, t) in nodes_pt:                       # адресные точки без своего дома — дому, в котором стоят
        if "addr:housenumber" in t and "addr:street" in t and not t.get("shop") and not t.get("amenity"):
            for b in bgrid.query(x, z, x, z):
                if not b["part"] and not b["t"].get("addr:housenumber") and pip(x, z, b["pts"]):
                    b["t"] = dict(b["t"]); b["t"]["addr:housenumber"] = t["addr:housenumber"]; b["t"]["addr:street"] = t["addr:street"]
                    break
    for b in blds:
        t = b["t"]
        hn, st_be = t.get("addr:housenumber"), t.get("addr:street")
        if not hn or not st_be or b["gov"]:
            continue
        st_ru = ru_street(st_be)
        hn = hn.strip()[:12]
        b["addr"] = street_short(st_ru) + ", " + hn
        # точка «у входа»: главный подъезд, иначе — точка контура ближе всего к улице, на 3 м наружу
        px, pz = b["cx"], b["cz"]
        ents = b.get("ents") or []
        if ents:
            e0 = sorted(ents, key=lambda q: (-q[3], q[2] or 99))[0]
            px, pz = e0[0], e0[1]
        else:
            e, d = near_edge(b["cx"], b["cz"], 120)
            if e:
                best, bd = None, 1e9
                for i in range(1, len(e["pts"])):
                    ax_, az_ = e["pts"][i - 1]; bx_, bz_ = e["pts"][i]
                    dd = seg_d(b["cx"], b["cz"], ax_, az_, bx_, bz_)
                    if dd < bd:
                        bd, best = dd, (ax_, az_, bx_, bz_)
                ax_, az_, bx_, bz_ = best
                dx, dz = bx_ - ax_, bz_ - az_; L2 = dx * dx + dz * dz or 1e-9
                tt = max(0.0, min(1.0, ((b["cx"] - ax_) * dx + (b["cz"] - az_) * dz) / L2))
                qx, qz = ax_ + dx * tt, az_ + dz * tt
                # от центра к улице: последняя точка внутри контура
                vx, vz = qx - b["cx"], qz - b["cz"]; vl = math.hypot(vx, vz) or 1
                k = 0.0
                while k < vl and pip(b["cx"] + vx / vl * k, b["cz"] + vz / vl * k, b["pts"]):
                    k += 0.5
                px, pz = b["cx"] + vx / vl * (k + 2.5), b["cz"] + vz / vl * (k + 2.5)
        addr_idx[(st_ru, st_be)].append((hn, dm(px), dm(pz), b["id"], b.get("levels") or 0))
    print("подъездов", n_ent, "магазинов в домах", n_shop, "адресов", sum(len(v) for v in addr_idx.values()),
          "улиц", len(addr_idx), "%.0f с" % (time.time() - T0))

    # ---- улица: переходы, фонари, остановки, входы в метро, деревья (ресёрч: 9,2 тыс. переходов, 16,3 тыс. фонарей,
    #      ~2,2 тыс. остановок, 244 входа в метро) — точки в суперкуски ----
    def road_dir(x, z, r=30):
        """Ближайшее ребро графа: (угол вдоль дороги в градусах, расстояние до оси, ширина, сторона −1/1)."""
        best, bd, seg = None, 1e9, None
        for e in egrid.query(x - r, z - r, x + r, z + r):
            p = e["pts"]
            for i in range(1, len(p)):
                d = seg_d(x, z, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1])
                if d < bd:
                    bd, best, seg = d, e, (p[i - 1], p[i])
        if not best or bd > r:
            return None
        (ax_, az_), (bx_, bz_) = seg
        ang = math.degrees(math.atan2(bz_ - az_, bx_ - ax_))
        side = 1 if ((x - ax_) * -(bz_ - az_) + (z - az_) * (bx_ - ax_)) >= 0 else -1
        return ang, bd, best["w"], side
    pts_seen = set()
    for (x, z, t) in nodes_pt:
        k = sup_key(x, z)
        hw = t.get("highway")
        if hw == "crossing":
            if t.get("crossing") in ("unmarked", "no", "informal") or t.get("crossing:markings") == "no":
                continue
            rd = road_dir(x, z, 12)
            if rd and rd[2] >= 5:
                sup[k]["x"].append([dm(x), dm(z), round(rd[0]) % 360, dm(rd[2])])
        elif hw == "street_lamp":
            rd = road_dir(x, z, 30)
            # фонарь смотрит на дорогу: угол «к оси» = вдоль ± 90°
            sup[k]["lp"].append([dm(x), dm(z), (round(rd[0] + (90 if rd[3] < 0 else -90)) % 360) if rd else -1])
        elif hw == "bus_stop" or (t.get("public_transport") == "platform" and (t.get("bus") or t.get("trolleybus"))):
            q = (round(x / 15), round(z / 15))
            if q in pts_seen:
                continue
            pts_seen.add(q)
            rd = road_dir(x, z, 30)
            if not rd:
                continue
            fl = (1 if t.get("shelter") != "no" else 0) | (2 if t.get("trolleybus") == "yes" or "трол" in (t.get("route_ref") or "") else 0) \
                | (4 if t.get("bench") != "no" else 0)
            sup[k]["sp"].append([dm(x), dm(z), round(rd[0]) % 360, rd[3], fl])
        elif t.get("railway") == "subway_entrance":
            rd = road_dir(x, z, 60)
            sup[k]["me"].append([dm(x), dm(z), (round(rd[0]) % 360) if rd else 0])
        elif t.get("natural") == "tree":
            sup[k]["t"].append((x, z))
    for p in tree_lines:                              # аллеи: дерево каждые 7 м
        for i in range(1, len(p)):
            (ax_, az_), (bx_, bz_) = p[i - 1], p[i]
            L = math.hypot(bx_ - ax_, bz_ - az_)
            n = max(1, int(L / 7))
            for j in range(n):
                x, z = ax_ + (bx_ - ax_) * j / n, az_ + (bz_ - az_) * j / n
                sup[sup_key(x, z)]["t"].append((x, z))
    for (pts_, w, one, fw, bw) in wires:
        fl = (1 if one else 0) | (2 if fw else 0) | (4 if bw else 0)
        for k in sup_keys_box(*bbox(pts_)):
            for run in clip_line(pts_, k[0] * SUP, k[1] * SUP, (k[0] + 1) * SUP, (k[1] + 1) * SUP):
                sup[k]["tw"].append([fl, dm(w), flat_d(run)])

    # ---- районы ----
    dists = []
    PR = {"suburb": 2, "quarter": 1, "neighbourhood": 1}
    for (x, z, t) in nodes_pt:
        if t.get("place") in PR and (t.get("name:ru") or t.get("name")):
            dists.append([name_of(t), round(x), round(z), PR[t["place"]]])
    for d in DISTRICTS_EXTRA:
        dists = [q for q in dists if not (q[0] == d[0] or math.hypot(q[1] - d[1], q[2] - d[2]) < 250)]
        dists.append(list(d))
    quiet = [list(q) for q in QUIET]

    def bad_spot(x, z):
        return in_list(x, z, quiet) or in_list(x, z, gov)

    # ---- важные дома: зоны, точки, дома жителей, штаб ----
    persist = []

    def keep(b, role):
        if b["pi"] < 0:
            b["pi"] = len(persist)
            persist.append(b)
            b["roles"] = []
        b["roles"].append(role)
        return b["pi"]
    cand = defaultdict(list)

    def ok_b(b, minA=120, maxH=400):
        return bool(b and b["flags"] & 2 and not b["gov"] and not bad_spot(b["cx"], b["cz"]) and b["A"] >= minA and b["h"] <= maxH
                    and b["mh"] < 2.5)

    def at_point(x, z, r=35, minA=80):
        for q in bgrid.query(x, z, x, z):
            if pip(x, z, q["pts"]) and ok_b(q, minA):
                return q
        best, bd = None, r
        for q in bgrid.query(x - r, z - r, x + r, z + r):
            d = math.hypot(q["cx"] - x, q["cz"] - z)
            if d < bd and ok_b(q, minA):
                best, bd = q, d
        return best
    KINDS = [("police", lambda t: t.get("amenity") == "police"), ("hospital", lambda t: t.get("amenity") == "hospital"),
             ("fuel", lambda t: t.get("amenity") == "fuel"), ("bank", lambda t: t.get("amenity") == "bank"),
             ("store", lambda t: t.get("shop") == "supermarket"), ("cafe", lambda t: t.get("amenity") == "cafe"),
             ("bar", lambda t: t.get("amenity") in ("bar", "pub", "nightclub")), ("gym", lambda t: t.get("leisure") == "fitness_centre"),
             ("hotel", lambda t: t.get("tourism") == "hotel"), ("carwash", lambda t: t.get("amenity") == "car_wash"),
             ("florist", lambda t: t.get("shop") == "florist"), ("barber", lambda t: t.get("shop") == "hairdresser"),
             ("cars", lambda t: t.get("shop") == "car"), ("cinema", lambda t: t.get("amenity") == "cinema"),
             ("fastfood", lambda t: t.get("amenity") == "fast_food")]
    LIM = {"police": 30, "hospital": 24, "fuel": 30, "bank": 30, "store": 40, "cafe": 40, "bar": 30, "gym": 14, "hotel": 14,
           "carwash": 12, "florist": 12, "barber": 12, "cars": 10, "cinema": 10, "fastfood": 20}
    seenb = defaultdict(set)
    pois_meta = []
    for (x, z, t) in sorted(nodes_pt, key=lambda q: abs(q[0] + 800) + abs(q[1] + 400)):
        for k, f in KINDS:
            if not f(t):
                continue
            zyb = 1 if k == "bar" and math.hypot(x + 1608, z + 608) < 260 else 0
            pois_meta.append([k, dm(x), dm(z), zyb])
            ck = "zyb" if zyb else k
            if len(cand[ck]) >= LIM[k]:
                continue
            b = at_point(x, z, 45 if k == "fuel" else 30, 40 if k == "fuel" else 100)
            if b and b["id"] not in seenb[ck]:
                seenb[ck].add(b["id"])
                cand[ck].append(keep(b, ck))
    metro = []
    for (x, z, t) in nodes_pt:
        if t.get("station") == "subway" or (t.get("railway") == "station" and t.get("subway") == "yes"):
            if not any(m[0] == name_of(t) for m in metro):
                metro.append([name_of(t), round(x), round(z)])
    marks = []
    for b in allb:
        if b["name"] and (b["h"] > 30 or b["t"].get("tourism") or b["t"].get("historic") or b["kind"] in ("church", "public")) and b["A"] > 150:
            if not any(m[0] == b["name"] and math.hypot(m[1] - b["cx"], m[2] - b["cz"]) < 300 for m in marks):
                marks.append([b["name"], round(b["cx"]), round(b["cz"]), round(b["h"])])
    for (x, z, t) in nodes_pt:
        if (t.get("tourism") in ("museum", "attraction") or t.get("historic") in ("monument", "memorial")) and (t.get("name:ru") or t.get("name")):
            nm = name_of(t)
            if not any(m[0] == nm for m in marks) and not in_list(x, z, gov):
                marks.append([nm, round(x), round(z), 0])
    marks.sort(key=lambda m: -m[3])
    marks = marks[:500]
    anchors = {}
    for zk, (ax, az, r, pref) in ANCHORS.items():
        best, bs = None, -1e18
        for q in bgrid.query(ax - r, az - r, ax + r, az + r):
            if not ok_b(q, 200) or math.hypot(q["cx"] - ax, q["cz"] - az) > r:
                continue
            if pref == "tallres" and q["kind"] != "res":
                continue
            s = (q["h"] if pref in ("tall", "tallres") else q["A"]) - math.hypot(q["cx"] - ax, q["cz"] - az) * 0.05
            if s > bs:
                best, bs = q, s
        if best:
            anchors[zk] = keep(best, "zone")

    def pool(name, pred, cell, per, lim):        # пул равномерно по сетке: из каждой клетки — несколько крупных
        buckets = defaultdict(list)
        for b in allb:
            if pred(b) and ok_b(b, 250):
                buckets[(int(b["cx"] // cell), int(b["cz"] // cell))].append(b)
        out = []
        for k in sorted(buckets, key=lambda k: (abs(k[0] * cell + cell / 2 + 800) + abs(k[1] * cell + cell / 2 + 400))):
            for b in sorted(buckets[k], key=lambda b: -b["A"])[:per]:
                out.append(keep(b, name))
            if len(out) >= lim:
                break
        cand[name] = out[:lim]
    pool("office", lambda b: b["kind"] == "office" and 12 <= b["h"] <= 110, 600, 2, 160)
    pool("shop", lambda b: b["kind"] in ("shop", "office") and b["h"] <= 24 and 300 <= b["A"] <= 4000, 700, 1, 160)
    pool("res", lambda b: b["kind"] == "res" and 9 <= b["h"] <= 80 and 250 <= b["A"] <= 3000, 900, 1, 320)

    # ---- открытые места (парки, площади) → «кварталы» для банд, трамплинов, находок ----
    spots = []
    for kind, pts, A, nm in sorted(open_spots, key=lambda s: -s[2]):
        x0, z0, x1, z1 = bbox(pts)
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        if not pip(cx, cz, pts) or bad_spot(cx, cz):
            continue
        k = 0.5
        while k > 0.12:
            hx, hz = (x1 - x0) * k / 2, (z1 - z0) * k / 2
            if all(pip(cx + sx * hx, cz + sz * hz, pts) for sx in (-1, 1) for sz in (-1, 1)):
                break
            k -= 0.08
        hx, hz = (x1 - x0) * k / 2, (z1 - z0) * k / 2
        if hx < 18 or hz < 18:
            continue
        spots.append([kind, round(cx - hx), round(cz - hz), round(cx + hx), round(cz + hz), nm])
        if len(spots) >= 900:
            break

    # ---- Башня Флейм: свободный квадрат 38×38 у «башни-маяка» ----
    def free(x, z, half, road_gap=7):
        for q in bgrid.query(x - half - 4, z - half - 4, x + half + 4, z + half + 4):
            bx0, bz0, bx1, bz1 = q["bb"]
            if bx1 > x - half - 3 and bx0 < x + half + 3 and bz1 > z - half - 3 and bz0 < z + half + 3:
                return False
        e, d = near_edge(x, z, half + road_gap + 30)
        return not (e and d < half + road_gap)
    hq = None
    for r in range(0, 700, 10):
        n = max(1, r // 5)
        for k in range(n):
            ang = k * 2 * math.pi / n
            x, z = HQ_TARGET[0] + r * math.cos(ang), HQ_TARGET[1] + r * math.sin(ang)
            if free(x, z, 19):
                hq = (round(x), round(z))
                break
        if hq:
            break
    hq = hq or HQ_TARGET
    hp = [(hq[0] - 18, hq[1] - 18), (hq[0] + 18, hq[1] - 18), (hq[0] + 18, hq[1] + 18), (hq[0] - 18, hq[1] + 18)]
    if area(hp) > 0:
        hp = hp[::-1]
    hq_b = {"id": gid, "osm": 0, "h": 64 * 3.5, "mh": 0.0, "kind": "office", "pts": hp, "name": "Башня Флейм", "part": False, "fam": FAM["glass"],
            "wall": -1, "roof": -1, "shape": 0, "rh": None, "mat": 3, "levels": 64, "cx": hq[0], "cz": hq[1], "A": 36 * 36,
            "bb": (hq[0] - 18, hq[1] - 18, hq[0] + 18, hq[1] + 18), "gov": False, "t": {}, "flags": 3, "pi": -1, "year": None}
    gid += 1
    allb.append(hq_b)
    bgrid.add(hq_b, *hq_b["bb"])
    hq_pi = keep(hq_b, "hq")

    # ---- аэродром: полоса 1190×84 вдоль x на месте Минска-1 (Мир-Сити), где меньше всего домов и дорог ----
    best_af, bs = None, 1e18
    for x0 in range(int(MIR[0]) - 400, int(MIR[2]) - 1190 + 400, 20):
        for z0 in range(int(MIR[1]) - 300, int(MIR[3]) - 84 + 300, 15):
            s = 0.0
            for q in bgrid.query(x0, z0, x0 + 1190, z0 + 84):
                bx0, bz0, bx1, bz1 = q["bb"]
                if bx1 > x0 and bx0 < x0 + 1190 and bz1 > z0 and bz0 < z0 + 84:
                    s += q["A"] + 400 + (1e7 if q["pi"] >= 0 else 0)
            for e in egrid.query(x0, z0, x0 + 1190, z0 + 84):
                for p in e["pts"]:
                    if x0 < p[0] < x0 + 1190 and z0 < p[1] < z0 + 84:
                        s += 2500 if RANK[e["cls"]] >= 5 else 600
                        break
            s += abs(x0 + 595 - (MIR[0] + MIR[2]) / 2) * 0.5
            if s < bs:
                bs, best_af = s, (x0, z0)
    af = {"x0": best_af[0], "z0": best_af[1], "x1": best_af[0] + 1190, "z1": best_af[1] + 84, "score": round(bs)}
    dropped = 0
    for b in allb:
        x0, z0, x1, z1 = b["bb"]
        if x1 > af["x0"] - 4 and x0 < af["x1"] + 4 and z1 > af["z0"] - 4 and z0 < af["z1"] + 4 and b["pi"] < 0:
            b["flags"] = 0
            dropped += 1
    print("штаб", hq, "аэродром", af, "убрано домов под полосой", dropped)

    st = START                              # старт: свободная точка у библиотеки
    for r in range(0, 200, 4):
        ok = None
        for k in range(12):
            x, z = START[0] + r * math.cos(k * 0.52), START[1] + r * math.sin(k * 0.52)
            if not building_at(x, z, 4):
                e, d = near_edge(x, z, 40)
                if not e or d > 6:
                    ok = (round(x), round(z))
                    break
        if ok:
            st = ok
            break

    # ---- стиль: семейство (шейдер фасада) и «старый» стиль 0–6 для интерьеров (fmapx: стекло, панель, кирпич, сталинка,
    #      модерн, ангар, частный дом) ----
    LEGACY = {20: 4, 21: 3, 22: 2, 23: 1, 24: 1, 25: 1, 26: 1, 27: 1, 28: 4, 29: 4, 30: 0, 31: 3, 32: 5, 33: 6, 34: 3, 35: 3,
              36: 5, 37: 4}
    for b in allb:
        f = FAM["glass"] if b is hq_b else b.get("fam", FAM["generic"])
        b["st"], b["tx"] = LEGACY.get(f, 4), f

    # ---- суперкуски ----
    # ряд дома: [id, h, mh, вид, контур (Δ), имя, флаги, стена, крыша, форма крыши, высота крыши, стиль, семейство, важный,
    #            этажей, подъезды [x, z, номер, главный]…, магазины [x, z, вывеска]…, адрес «ул. X, 5»]
    for b in allb:
        if not b["flags"]:
            continue
        rh = b["rh"]
        ents = []
        for (x, z, rf, kd) in (b.get("ents") or [])[:24]:
            ents += [dm(x), dm(z), rf, kd]
        shops = []
        for (x, z, sg) in (b.get("shops") or []):
            shops += [dm(x), dm(z), sg]
        sup[sup_key(b["cx"], b["cz"])]["b"].append([b["id"], round(b["h"], 1), round(b["mh"], 1), b["kind"], flat_d(b["pts"]), b["name"][:60],
                                                    b["flags"], b["wall"], b["roof"], b["shape"], round(rh, 1) if rh else 0, b["st"],
                                                    b["tx"], b["pi"], int(b["levels"] or 0), ents, shops, b.get("addr", "")])
    for p in water_polys:
        for k in sup_keys_box(*bbox(p)):
            c = clip_poly(p, k[0] * SUP, k[1] * SUP, (k[0] + 1) * SUP, (k[1] + 1) * SUP)
            if len(c) >= 3:
                sup[k]["w"].append([flat_d(c)])
    for p, w in water_lines:
        for k in sup_keys_box(*bbox(p)):
            for run in clip_line(p, k[0] * SUP, k[1] * SUP, (k[0] + 1) * SUP, (k[1] + 1) * SUP):
                sup[k]["w"].append([flat_d(run), w])
    for kind, p in green_polys:
        for k in sup_keys_box(*bbox(p)):
            c = clip_poly(p, k[0] * SUP, k[1] * SUP, (k[0] + 1) * SUP, (k[1] + 1) * SUP)
            if len(c) >= 3 and abs(area(c)) > 60:
                sup[k]["g"].append([kind, flat_d(c)])
    for kind, p in rail_lines:
        for k in sup_keys_box(*bbox(p)):
            for run in clip_line(p, k[0] * SUP, k[1] * SUP, (k[0] + 1) * SUP, (k[1] + 1) * SUP):
                sup[k]["l"].append([kind, flat_d(run)])

    # ---- деревья во дворах: взрослые берёзы, липы, клёны, тополя выше пятиэтажек (ресёрч: «во дворах деревьев больше,
    #      чем дома видно») — жилая застройка минус дома, дороги и вода, сетка с разбросом ----
    yard_trees(sup, land_polys, bgrid, road_runs, water_polys)

    for c in sup.values():                           # деревья — одной ломаной с приращениями (меньше JSON)
        for key_ in ("t", "ty"):
            c[key_] = flat_d(sorted(c[key_], key=lambda q: (round(q[1] / 25), q[0])))

    os.makedirs(args.out, exist_ok=True)
    for f in glob.glob(os.path.join(args.out, "c_*.json")) + glob.glob(os.path.join(args.out, "s_*.json")) + glob.glob(os.path.join(args.out, "meta.json")):
        os.remove(f)
    total, biggest, sl = 0, 0, []
    hh = hashlib.md5()
    for k in sorted(sup):
        s = json.dumps(sup[k], ensure_ascii=False, separators=(",", ":"))
        open(os.path.join(args.out, "s_%d_%d.json" % k), "w").write(s)
        total += len(s); biggest = max(biggest, len(s)); hh.update(s.encode())
        sl.append([k[0], k[1], len(sup[k]["b"]), len(s) // 1024])
    # подложка карты: метры с приращениями, упрощение под масштаб карты (быстрее старт: файл в ~3 раза меньше)
    def fm(pts):
        out, px, pz = [], 0, 0
        for i, (x, z) in enumerate(pts):
            ix, iz = int(round(x)), int(round(z))
            out += [ix, iz] if i == 0 else [ix - px, iz - pz]
            px, pz = ix, iz
        return out
    mp = {"fmt": 2,
          "land": [[k, fm(simplify(p, 12.0))] for k, p in land_polys if abs(area(p)) > 2500],
          "water": [fm(simplify(p, 8.0)) for p in water_polys if abs(area(p)) > 1500],
          "wline": [[fm(simplify(p, 8.0)), w] for p, w in water_lines if w >= 7],
          "green": [fm(simplify(p, 10.0)) for k, p in green_polys if abs(area(p)) > 4000 and k == "park"],
          "rail": [fm(simplify(p, 10.0)) for k, p in rail_lines if k == "rail"]}
    ms = json.dumps(mp, ensure_ascii=False, separators=(",", ":"))
    open(os.path.join(args.out, "map.json"), "w").write(ms)
    # «Найди свой дом»: улица (по-русски и по-белорусски) → дома [номер, x, z (метры, у входа), этажей]; грузится по запросу
    streets = []
    for (ru, be), lst in sorted(addr_idx.items(), key=lambda kv: kv[0][0]):
        seen_n = set()
        rows = []
        for q in sorted(lst, key=lambda q: (int(re.match(r"\d*", q[0]).group() or 0), q[0])):
            if q[0] in seen_n:
                continue
            seen_n.add(q[0])
            rows.append([q[0], round(q[1] / 10), round(q[2] / 10), q[4]])
        streets.append([ru, be if be != ru else "", rows])
    ad = json.dumps({"about": "© участники OpenStreetMap (ODbL)", "s": streets}, ensure_ascii=False, separators=(",", ":"))
    open(os.path.join(args.out, "addr.json"), "w").write(ad)
    print("адреса: улиц", len(streets), "домов", sum(len(q[2]) for q in streets), "addr.json %.0f КБ" % (len(ad) / 1024))
    river = [flat(simplify(p, 12.0)) for p in sorted(river_lines, key=lambda p: -len(p))]
    meta = {
        "about": "Минск 1:1 — данные © участники OpenStreetMap (ODbL), конвертер tools/minsk-osm.py",
        "attribution": "© участники OpenStreetMap", "v": hh.hexdigest()[:10], "origin": [LAT0, LON0], "sup": SUP,
        "bounds": [round(min(k[0] for k in sup) * SUP), round(min(k[1] for k in sup) * SUP),
                   round((max(k[0] for k in sup) + 1) * SUP), round((max(k[1] for k in sup) + 1) * SUP)],
        "supers": sl, "cls": CLS, "names": names, "nodes": meta_nodes, "edges": meta_edges,
        "districts": dists, "quiet": quiet, "gov": [[round(g[0]), round(g[1]), round(g[2])] for g in gov],
        "persist": [[b["id"], dm(b["cx"]), dm(b["cz"]), round(b["h"], 1), b["kind"], int(b["levels"] or 0), b["name"][:60], b["st"],
                     ",".join(b["roles"]), flat_d(b["pts"])] for b in persist],
        "cand": cand, "anchors": anchors, "hq": hq_pi, "metro": metro, "marks": marks, "spots": spots,
        "airfield": af, "start": list(st), "river": river, "fmt": 2, "signs": SIGNS, "fam": FAM,
    }
    js = "/* Минск 1:1 — © участники OpenStreetMap (ODbL). Собрано tools/minsk-osm.py, не править руками. */\nwindow.MINSK=" + \
        json.dumps(meta, ensure_ascii=False, separators=(",", ":")) + ";\n"
    open(os.path.join(args.out, "meta.js"), "w").write(js)
    print("суперкусков:", len(sup), "вес: %.1f МБ (самый большой %.0f КБ)" % (total / 1e6, biggest / 1024),
          "meta.js %.0f КБ" % (len(js) / 1024), "map.json %.0f КБ" % (len(ms) / 1024),
          "важных домов", len(persist), "· %.0f с" % (time.time() - T0))
    if args.preview:
        preview(sup, args.preview, meta)


def preview(sup, out, meta):
    """Картинка сверху: дома по высоте, вода, зелень, граф, аэродром — проверить глазами, что это Минск."""
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        print("нет Pillow — превью пропущено", file=sys.stderr)
        return
    x0, z0, x1, z1 = meta["bounds"]
    S = float(os.environ.get("PREVIEW_SCALE", "0.06"))
    W, H = int((x1 - x0) * S), int((z1 - z0) * S)
    im = Image.new("RGB", (W, H), (28, 34, 30))
    d = ImageDraw.Draw(im)

    def P(arr):
        return [((arr[i] / 10 - x0) * S, (arr[i + 1] / 10 - z0) * S) for i in range(0, len(arr), 2)]

    def PD(arr):                                    # контур с приращениями
        out, cx, cz = [], 0, 0
        for i in range(0, len(arr), 2):
            cx, cz = (arr[i], arr[i + 1]) if i == 0 else (cx + arr[i], cz + arr[i + 1])
            out.append(((cx / 10 - x0) * S, (cz / 10 - z0) * S))
        return out
    for c in sup.values():
        for g in c["g"]:
            d.polygon(PD(g[1]), fill=(52, 92, 58) if g[0] == "park" else (40, 44, 48))
        for w in c["w"]:
            if len(w) == 1:
                d.polygon(PD(w[0]), fill=(40, 90, 140))
            else:
                d.line(PD(w[0]), fill=(40, 90, 140), width=max(1, int(w[1] * S)))
    for c in sup.values():
        for b in c["b"]:
            if b[6] & 1:
                v = int(min(255, 90 + b[1] * 2.2))
                d.polygon(PD(b[4]), fill=(v, int(v * 0.85), int(v * 0.75)) if b[3] != "church" else (220, 80, 80))
    for e in meta["edges"]:
        d.line(PD(e[7:]), fill=(230, 200, 120) if e[2] <= 2 else (190, 190, 190), width=1)
    af = meta["airfield"]
    d.rectangle([(af["x0"] - x0) * S, (af["z0"] - z0) * S, (af["x1"] - x0) * S, (af["z1"] - z0) * S], outline=(255, 80, 80))
    im.save(out)
    print("превью:", out, W, "x", H)


if __name__ == "__main__":
    main()
