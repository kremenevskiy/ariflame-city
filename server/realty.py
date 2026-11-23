"""Владение настоящими зданиями, бизнесы с сотрудниками-агентами и сезон «Передел» — Флейм-Сити и Минск 1:1.

Задача: «можно здание, которое существует, купить за какие-то деньги, захватить, бизнес сделать,
построить, потом кого-то нанять на работу или уволить; механики как в Rise of Kingdoms, чтобы люди оставались».
Ресёрч механик (территории и бизнес в RoK/GTA Online, СНГ-RP): territory_ownership_business_mechanics (сезоны районов,
соседние районы, черты и мораль сотрудников, менеджер для пассивного дохода, без лутбоксов и вывода денег),
gta_mechanics_and_retention.md (купил → сырьё → производство по таймеру → доставка), cis_rp_games_and_virality.md
(собственность с обязанностями, бизнес требует активности; наружу — только вид агента-владельца).

Здание — (город, ключ). Флейм-Сити: номер здания плана (fmap.js, «123»). Минск: «m<x>_<z>» — округлённый до метра
центр вершин контура OSM (номера контуров меняются при пересборке данных, место — нет); вдобавок храним x/z и дверь,
и клиент находит здание по точке, даже если кусок города ещё не загружен. Наружу — вид существа владельца, ни rid, ни
имени агента (как у homes.py).

Деньги игрока живут у клиента (FC.save): покупки клиент списывает сам. Сервер держит то, что дёшево проверить, — кто
владеет зданием, цену по формуле (та же в fprop.js), уровень бизнеса, сотрудников (кандидатов выдаёт сервер), сырьё,
кассу и метки времени. Выручку считает сервер (ленивая симуляция по часам) и выдаёт её «кредитом» честности
(modes.credit): прирост заработка от бизнеса не принимается за чит.

Таблицы (своя SQLite fcg; схема — CREATE IF NOT EXISTS, старые таблицы не трогаем):
  props (city, bkey PK) — здание: владелец, класс res|com, вид home|flat|biz, цена, адрес, x/z, дверь, площадь, этажи;
  biz (city, bkey PK) — бизнес в своём нежилом здании: тип, уровень, сырьё, касса, сотрудники JSON, менеджер, рейс;
  season_team, season_pts, season_me, season_hold — «Передел»: банда игрока в городе, очки банд по районам за неделю,
  вклад игрока, хозяин района на неделю.
Миграция: homes (Флейм-Сити, v2) копируется в props при старте (INSERT OR IGNORE — идемпотентно), и каждая
покупка/продажа здания Флейм-Сити зеркалится в homes — откат сервера на старую версию не теряет владельцев.

HTTP (тело — JSON, token — токен мира):
  GET  /g/props?city=                  все занятые здания города: [{k, cls, kind, cre, biz, lvl, name, x, z}] (кэш 15 с)
  POST /g/prop/mine   {token, city?}   свои здания (+ бизнес кратко)
  POST /g/prop/claim  {token, city, key, cls, facts{area, floors, tier, style, landmark}, addr, x, z, dx, dz, primary?}
                                       купить: 200 {price, kind} / 401 / 409 занято / 403 лимит / 400 / 429
  POST /g/prop/sell   {token, city, key}            продать: 200 {refund} (70% цены + 50% вложенного + касса)
  POST /g/prop/info   {token, city, key, addr, x, z, dx, dz}   дописать адрес старой записи (после миграции)
  POST /g/biz/open    {token, city, key, type, word}  открыть бизнес в своём нежилом здании
  POST /g/biz/state   {token, city, key}            состояние (досчитанное до «сейчас»)
  POST /g/biz/mine    {token, city?}                все свои бизнесы
  POST /g/biz/collect {token, city, key}            забрать кассу: у здания или через менеджера (−10%)
  POST /g/biz/upgrade|supply {token, city, key, pay: till|cash}
  POST /g/biz/hire {…, cand}  /fire {…, emp}  /bonus {…, emp, pay}  /raise {…, emp}  /manager {…, on}
  POST /g/biz/run {token, city, key, kind: sell|supply, a: start|done|fail, dist?}   рейсы-миссии
  GET  /g/season?city=                 «Передел»: районы, хозяева, очки банд, соседство, лучшие (вид, без rid)
  POST /g/season/team {token, city, team}   банда игрока в городе (менять — раз в неделю)
  POST /g/season/act  {token, city, kind, x, z}   очки влияния за дела (захват точки, налёт, гонка…), с лимитами

Подключает app.py: `app.include_router(realty.make_router(db, verify, _body, where, MODES))`.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import math
import re
import time

from fastapi import APIRouter, HTTPException, Request, Response

from season import (ACT_DAY, ACT_EVERY, ACT_PTS, ADJ, CITIES, DISTS, HOLD_BONUS, HOME, TEAMS, _add_pts,  # noqa: F401
                    _hold_bonus, _holders, act, contestable, dist_of, my_team, season, set_team, week_of)

# ---------------------------------------------------------------------------------------------------------------
# города, ключи, лимиты
# ---------------------------------------------------------------------------------------------------------------
KEY_RE = {"flame": re.compile(r"\d{1,5}"), "minsk": re.compile(r"m-?\d{1,6}_-?\d{1,6}")}
FLAME_MAX = 20000                     # номер здания плана Флейм-Сити (сейчас ~2300) — как BUILDING_MAX у homes.py
CITY_XZ = {"flame": 1300.0, "minsk": 18500.0}
LIMIT = {"res": 3, "com": 3}          # на игрока в каждом городе: 3 дома + 3 нежилых здания
EVERY = 0.8                           # пауза между записями одного игрока (тесты ставят 0)
NEAR_M = 90.0                         # «у здания»: если игрок в онлайне, касса — только рядом
SELL_BACK = 0.7                       # продажа здания: 70% цены
INVEST_BACK = 0.5                     # и половина вложенного в бизнес

# ---------------------------------------------------------------------------------------------------------------
# цена здания: город × район × площадь × этажность × стиль × ориентир × класс. Та же формула — fprop.js priceOf
# (Флейм-Сити, жилые — ровно прежняя fhome.priceOf: цены старых домов не поменялись)
# ---------------------------------------------------------------------------------------------------------------
BASE = {"flame": {1: 90000, 2: 60000, 3: 38000, 4: 30000},       # центр, Москва, Минск, Алматы
        "minsk": {1: 70000, 2: 45000, 3: 30000, 4: 22000}}      # центр, ближе 5,5 км, ближе 9 км, окраины
STYLE_K = {"glass": 1.5, "stalin": 1.3, "modern": 1.15, "brick": 1.05, "panel": 0.9, "house": 0.8, "studio": 1.0}
LANDMARK_K = 2.5
COM_K = 1.2
PRICE_MIN, PRICE_MAX = 8000, 3_000_000


def _jsround(v: float) -> int:
    """Math.round из JS (половина — вверх), чтобы цена сервера совпадала с ценой в телефоне."""
    return int(math.floor(v + 0.5))


def price_of(city: str, cls: str, area: float, floors: int, tier: int, style: str, landmark: bool) -> int:
    area_k = min(2.2, max(0.6, area / 700.0))
    fl = 0.7 + min(floors, 30) / 20.0
    p = BASE[city].get(tier, BASE[city][4]) * area_k * fl * STYLE_K.get(style, 1.0)
    if landmark:
        p *= LANDMARK_K
    if cls == "com":
        p *= COM_K
    return max(PRICE_MIN, _jsround(p / 500.0) * 500)


# ---------------------------------------------------------------------------------------------------------------
# бизнесы: типы, уровни, сырьё, сотрудники
# ---------------------------------------------------------------------------------------------------------------
# rate — $ выручки в реальный час на 1-м уровне при полном штате и сырье; equip — оборудование (открытие);
# area — минимальная площадь здания (м², как в facts); kit — интерьер (ffurn / fbiz.js)
TYPES = {
    "cafe": {"name": "Кафе", "emoji": "☕", "rate": 3000, "equip": 15000, "area": 80, "kit": "coffee"},
    "shawarma": {"name": "Шаурма", "emoji": "🌯", "rate": 2200, "equip": 8000, "area": 40, "kit": "shawarma"},
    "tires": {"name": "Шиномонтаж", "emoji": "🛞", "rate": 2600, "equip": 12000, "area": 100, "kit": "carwash"},
    "carshow": {"name": "Автосалон", "emoji": "🏎️", "rate": 5800, "equip": 60000, "area": 450, "kit": "cars"},
    "beauty": {"name": "Салон красоты", "emoji": "💅", "rate": 3200, "equip": 18000, "area": 60, "kit": "barber"},
    "it": {"name": "IT-студия", "emoji": "💻", "rate": 5200, "equip": 30000, "area": 120, "kit": "it"},
    "corner": {"name": "Магазин у дома", "emoji": "🛒", "rate": 2400, "equip": 10000, "area": 60, "kit": "store"},
    "club": {"name": "Клуб", "emoji": "🪩", "rate": 6400, "equip": 70000, "area": 300, "kit": "club"},
    "fitness": {"name": "Фитнес", "emoji": "🏋️", "rate": 4000, "equip": 25000, "area": 200, "kit": "gym"},
    "carwash": {"name": "Автомойка", "emoji": "🧽", "rate": 2700, "equip": 14000, "area": 100, "kit": "carwash"},
    "print": {"name": "Типография", "emoji": "🖨️", "rate": 3400, "equip": 20000, "area": 100, "kit": "print"},
    "bakery": {"name": "Пекарня", "emoji": "🥐", "rate": 2500, "equip": 11000, "area": 60, "kit": "cafe"},
}
# название — тип + слово из списка (свободного текста нет: мат и реклама невозможны по построению)
WORDS = ["Огонёк", "Искра", "Улей", "Байт", "Вектор", "Сокол", "Лён", "Зубр", "Янтарь", "Комета", "Пчёлка", "Кедр",
         "Неон", "Пиксель", "Восход", "Ромашка", "Маяк", "Орбита", "Капля", "Берёзка", "Сова", "Лис", "Прилив", "Север"]
MAX_LVL = 5
UPG = {2: 0.6, 3: 1.2, 4: 2.2, 5: 3.6}            # улучшение до уровня — доля оборудования
SUPPLY_SHARE = 0.3                                 # сырьё — 30% выручки, которую оно даст
TAX = 0.05                                         # в казну города (сжигание денег, ресёрч п. 7)
MGR_SHARE = 0.08                                   # менеджер берёт 8% выручки
MGR_FEE = 3000                                     # нанять менеджера: $3000 × уровень (наличными)
REMOTE_FEE = 0.10                                  # забрать кассу не у здания (через менеджера)
RUN_MAX = 12 * 60                                  # рейс — не дольше 12 минут
RUN_EVERY = {"sell": 300, "supply": 1200}          # пауза между рейсами одного бизнеса
RUN_BONUS = 1.35                                   # доставка заказа: ×1,35 к товару
SUPPLY_RUN = 60.0                                  # подвёз сырьё сам: +60%
SIM_STEPS = 96                                     # досчёт — не больше 96 часовых шагов (дальше — один шаг)


def lvl_k(level: int) -> float:
    return 1.0 + 0.4 * (level - 1)


def slots(level: int) -> int:
    return 1 + level


def supply_h(level: int) -> float:
    return 4.0 + 0.5 * (level - 1)


def cap_h(level: int, manager: bool) -> float:
    """Касса копит столько часов выручки: без менеджера — 2–4 ч (повод заглянуть), с менеджером — 7–11 ч."""
    return (6.0 + level) if manager else (2.0 + 0.5 * (level - 1))


def upgrade_cost(t: str, level: int) -> int | None:
    return None if level >= MAX_LVL else int(TYPES[t]["equip"] * UPG[level + 1])


def full_rate(t: str, level: int) -> float:
    return TYPES[t]["rate"] * lvl_k(level)


def supply_cost(t: str, level: int, stock: float) -> int:
    need = max(0.0, 100.0 - stock) / 100.0
    return int(round(full_rate(t, level) * supply_h(level) * SUPPLY_SHARE * need))


# черты сотрудника (до 5; у кандидата 1–3): out — выработка, wage — к ставке, quit — к шансу уйти, soc — мораль соседям,
# supply — расход сырья, sell — к доставке, greedy — мораль сильнее от ставки, cheap — низкая ставка не злит, learn — учится
TRAITS = {
    "hard": {"name": "Трудоголик", "out": 0.15},
    "lazy": {"name": "Лентяй", "out": -0.2, "wage": -0.15},
    "cheap": {"name": "Работает за копейки", "wage": -0.3, "cheap": True},
    "soul": {"name": "Душа компании", "soc": 6},
    "grump": {"name": "Ворчун", "soc": -5},
    "fast": {"name": "Шустрый", "out": 0.1},
    "perfect": {"name": "Перфекционист", "sell": 0.1},
    "thrifty": {"name": "Экономный", "supply": -0.1},
    "loyal": {"name": "Верный", "quit": 0.3},
    "flighty": {"name": "Летун", "quit": 2.5},
    "greedy": {"name": "Любит деньги", "greedy": True},
    "star": {"name": "Звезда района", "out": 0.08, "wage": 0.3},
    "learner": {"name": "Быстро учится", "learn": True},
}
CLASH = [("hard", "lazy"), ("loyal", "flighty"), ("soul", "grump"), ("cheap", "greedy"), ("cheap", "star")]
NAMES = ["Аня", "Ника", "Тимур", "Костя", "Даша", "Лёша", "Марк", "Ева", "Вика", "Илья", "Соня", "Глеб", "Алиса", "Яна",
         "Олег", "Миша", "Кира", "Макс", "Лиза", "Рома", "Тоня", "Стас", "Вера", "Зоя", "Артём", "Полина", "Денис", "Мила"]
CAND_N = 4
CAND_WINDOW = 6 * 3600                              # новые кандидаты — раз в 6 часов
FIRE_HIT, FIRE_SOUL_HIT, QUIT_HIT = 8.0, 14.0, 4.0


def market_wage(skill: float) -> float:
    return 25.0 + 1.2 * skill                         # $ в час


def _rand(*parts) -> float:
    h = hashlib.sha256(("fcg-biz-v1|" + "|".join(str(p) for p in parts)).encode()).digest()
    return int.from_bytes(h[:8], "big") / 2 ** 64


# Коды облика сотрудников (клиент рисует по ним людей или фигурки необязательного набора видов) — постоянный список:
# кандидаты детерминированы по сиду, смена списка поменяла бы уже нанятых.
CREATURE_CODES = ["lis", "sova", "enot", "yozh", "barsuk", "kot", "zayac", "volk"]


def candidates(rid: str, city: str, key: str, level: int, window: int) -> list[dict]:
    """Кандидаты окна: детерминированно (rid, здание, окно) — одинаковые при каждом запросе, подделать нельзя."""
    out = []
    lo, hi = 22 + 7 * (level - 1), 62 + 8 * (level - 1)
    for i in range(CAND_N):
        r = lambda k: _rand(rid, city, key, window, i, k)  # noqa: E731
        skill = round(lo + (hi - lo) * r("s"))
        n_tr = 1 + int(r("n") * 3)
        traits: list[str] = []
        pool = sorted(TRAITS)
        j = 0
        while len(traits) < n_tr and j < 20:
            t = pool[int(r("t%d" % j) * len(pool))]
            j += 1
            if t in traits or any((t == a and b in traits) or (t == b and a in traits) for a, b in CLASH):
                continue
            traits.append(t)
        wage = market_wage(skill) * (1 + sum(TRAITS[t].get("wage", 0.0) for t in traits)) * (0.9 + 0.2 * r("w"))
        out.append({"id": "c%d_%d" % (window, i), "n": NAMES[int(r("nm") * len(NAMES))],
                    "cre": CREATURE_CODES[int(r("c") * len(CREATURE_CODES))], "tr": traits, "sk": skill,
                    "w": int(round(wage)), "m": round(62 + 18 * r("m"))})
    return out


def _trait_sum(e: dict, k: str) -> float:
    return sum(TRAITS.get(t, {}).get(k, 0.0) for t in e.get("tr", []))


def _has(e: dict, k: str) -> bool:
    return any(TRAITS.get(t, {}).get(k) for t in e.get("tr", []))


def quit_risk(e: dict) -> float:
    """Шанс уйти за час при нынешней морали (0, пока мораль ≥ 30)."""
    m = e.get("m", 60.0)
    if m >= 30:
        return 0.0
    k = 1.0
    for t in e.get("tr", []):
        k *= TRAITS.get(t, {}).get("quit", 1.0)
    return min(0.9, 0.06 * (30 - m) / 30 * k + 0.02 * k)


def morale_target(e: dict, staff: list[dict], level: int, idle: bool) -> float:
    ratio = e["w"] / max(1.0, market_wage(e["sk"]))
    wage_eff = 40.0 * (ratio - 1.0)
    if _has(e, "cheap"):
        wage_eff = max(wage_eff, 0.0) + 5.0
    if _has(e, "greedy"):
        wage_eff *= 2.0
    soc = sum(_trait_sum(o, "soc") for o in staff if o is not e)
    t = 60.0 + wage_eff + max(-15.0, min(15.0, soc)) + 2.0 * level
    if idle:
        t -= 8.0                                       # простой: скучно, но не уходят
    if len(staff) < slots(level) / 2:
        t -= 5.0                                       # мало людей — тяжело
    return max(0.0, min(100.0, t))


def staff_k(staff: list[dict], level: int) -> float:
    units = sum((0.6 + e["sk"] / 250.0) * (1.0 + _trait_sum(e, "out")) for e in staff)
    return max(0.15, min(1.25, units / slots(level))) if staff else 0.15


def morale_k(staff: list[dict]) -> float:
    if not staff:
        return 0.8
    return 0.6 + 0.4 * (sum(e["m"] for e in staff) / len(staff)) / 100.0


def gross_rate(b: dict) -> float:
    """Выручка в час сейчас: тип × уровень × штат × мораль (до налога, зарплат и менеджера)."""
    return full_rate(b["type"], b["level"]) * staff_k(b["staff"], b["level"]) * morale_k(b["staff"])


# ---------------------------------------------------------------------------------------------------------------
# схема и миграция
# ---------------------------------------------------------------------------------------------------------------
SCHEMA = """
CREATE TABLE IF NOT EXISTS homes (
    building INTEGER PRIMARY KEY,
    owner_rid TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'flat',
    price INTEGER NOT NULL,
    bought_at INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS homes_owner ON homes (owner_rid);
CREATE TABLE IF NOT EXISTS props (
    city TEXT NOT NULL,
    bkey TEXT NOT NULL,
    owner_rid TEXT NOT NULL,
    cls TEXT NOT NULL DEFAULT 'res',
    kind TEXT NOT NULL DEFAULT 'flat',
    price INTEGER NOT NULL,
    bought_at INTEGER NOT NULL,
    addr TEXT NOT NULL DEFAULT '',
    x REAL, z REAL, dx REAL, dz REAL,
    area REAL NOT NULL DEFAULT 0,
    floors INTEGER NOT NULL DEFAULT 1,
    landmark INTEGER NOT NULL DEFAULT 0,
    dist TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (city, bkey)
);
CREATE INDEX IF NOT EXISTS props_owner ON props (owner_rid, city);
CREATE TABLE IF NOT EXISTS biz (
    city TEXT NOT NULL,
    bkey TEXT NOT NULL,
    owner_rid TEXT NOT NULL,
    type TEXT NOT NULL,
    level INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL DEFAULT '',
    stock REAL NOT NULL DEFAULT 0,
    till REAL NOT NULL DEFAULT 0,
    sim_at REAL NOT NULL,
    opened_at INTEGER NOT NULL,
    collected_at INTEGER NOT NULL DEFAULT 0,
    manager INTEGER NOT NULL DEFAULT 0,
    staff TEXT NOT NULL DEFAULT '[]',
    hist TEXT NOT NULL DEFAULT '[]',
    taken TEXT NOT NULL DEFAULT '[]',
    run TEXT,
    cool TEXT NOT NULL DEFAULT '{}',
    seq INTEGER NOT NULL DEFAULT 0,
    earned INTEGER NOT NULL DEFAULT 0,
    invested INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (city, bkey)
);
CREATE INDEX IF NOT EXISTS biz_owner ON biz (owner_rid);
CREATE TABLE IF NOT EXISTS season_team (
    rid TEXT NOT NULL, city TEXT NOT NULL, team TEXT NOT NULL, since INTEGER NOT NULL, PRIMARY KEY (rid, city));
CREATE TABLE IF NOT EXISTS season_pts (
    week INTEGER NOT NULL, city TEXT NOT NULL, dist TEXT NOT NULL, team TEXT NOT NULL, pts REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (week, city, dist, team));
CREATE TABLE IF NOT EXISTS season_me (
    week INTEGER NOT NULL, city TEXT NOT NULL, rid TEXT NOT NULL, team TEXT NOT NULL, pts REAL NOT NULL DEFAULT 0,
    day INTEGER NOT NULL DEFAULT 0, day_pts REAL NOT NULL DEFAULT 0, PRIMARY KEY (week, city, rid));
CREATE TABLE IF NOT EXISTS season_hold (
    week INTEGER NOT NULL, city TEXT NOT NULL, dist TEXT NOT NULL, team TEXT, PRIMARY KEY (week, city, dist));
"""

_ready: set[int] = set()
_acted: dict[str, float] = {}


def ensure(store) -> None:
    """Таблицы — в той же базе, что players/homes; старые дома Флейм-Сити — в props (идемпотентно, каждый старт)."""
    if id(store) in _ready:
        return
    with store.lock:
        store.db.executescript(SCHEMA)
        store.db.execute("""INSERT OR IGNORE INTO props (city, bkey, owner_rid, cls, kind, price, bought_at, name)
                            SELECT 'flame', CAST(building AS TEXT), owner_rid, 'res', kind, price, bought_at, name
                            FROM homes""")
    _ready.add(id(store))


def _flame_int(city: str, key: str) -> int | None:
    if city != "flame":
        return None
    n = int(key)
    return n if n < FLAME_MAX else None


# ---------------------------------------------------------------------------------------------------------------
# здания: занятые, свои, купить, продать
# ---------------------------------------------------------------------------------------------------------------
def _pub(row) -> dict:
    out = {"k": row["bkey"], "cls": row["cls"], "kind": row["kind"], "cre": row["creature"],
           "x": row["x"], "z": row["z"]}
    if row["btype"]:
        out.update({"biz": row["btype"], "lvl": int(row["blevel"]), "name": row["bname"]})
    return out


def taken(store, city: str) -> list[dict]:
    ensure(store)
    with store.lock:
        rows = store.db.execute("""SELECT p.bkey, p.cls, p.kind, p.x, p.z, pl.creature,
                                          b.type AS btype, b.level AS blevel, b.name AS bname
                                   FROM props p LEFT JOIN players pl ON pl.rid = p.owner_rid
                                   LEFT JOIN biz b ON b.city = p.city AND b.bkey = p.bkey
                                   WHERE p.city = ? ORDER BY p.bkey""", (city,)).fetchall()
    return [_pub(r) for r in rows]


def _prop_dict(r) -> dict:
    return {"city": r["city"], "key": r["bkey"], "cls": r["cls"], "kind": r["kind"], "price": int(r["price"]),
            "bought_at": int(r["bought_at"]), "addr": r["addr"], "x": r["x"], "z": r["z"], "dx": r["dx"], "dz": r["dz"],
            "area": r["area"], "floors": int(r["floors"]), "landmark": bool(r["landmark"]), "dist": r["dist"],
            "name": r["name"]}


def mine(store, rid: str, city: str | None = None) -> list[dict]:
    ensure(store)
    with store.lock:
        sql = "SELECT * FROM props WHERE owner_rid = ?" + (" AND city = ?" if city else "") + " ORDER BY bought_at"
        rows = store.db.execute(sql, (rid, city) if city else (rid,)).fetchall()
        bz = {(b["city"], b["bkey"]): b for b in store.db.execute("SELECT city, bkey, type, level, name FROM biz WHERE owner_rid = ?",
                                                                    (rid,)).fetchall()}
    out = []
    for r in rows:
        d = _prop_dict(r)
        b = bz.get((r["city"], r["bkey"]))
        d["biz"] = {"type": b["type"], "level": int(b["level"]), "name": b["name"]} if b else None
        out.append(d)
    return out


def _mirror_home(db, city: str, key: str, rid: str, kind: str, price: int, now: int) -> None:
    n = _flame_int(city, key)
    if n is not None:
        db.execute("INSERT OR REPLACE INTO homes (building, owner_rid, kind, price, bought_at) VALUES (?, ?, ?, ?, ?)",
                   (n, rid, "home" if kind == "home" else "flat", price, now))


def claim(store, rid: str, city: str, key: str, cls: str, price: int, info: dict, primary: bool = False) -> dict:
    """Атомарно: занятость, лимит и вставка — под одной блокировкой и в одной транзакции (второй покупатель — 409)."""
    ensure(store)
    now = int(time.time())
    with store.lock:
        db = store.db
        db.execute("BEGIN IMMEDIATE")
        try:
            row = db.execute("SELECT owner_rid, price, kind, addr FROM props WHERE city = ? AND bkey = ?",
                             (city, key)).fetchone()
            if row:
                if row["owner_rid"] == rid:
                    if not row["addr"] and info.get("addr"):        # старая запись (миграция) — дописать адрес
                        _set_info(db, city, key, info)
                    db.execute("COMMIT")
                    return {"ok": True, "already": True, "price": int(row["price"]), "kind": row["kind"]}
                db.execute("ROLLBACK")
                raise HTTPException(409, "это здание уже чьё-то — выбери другое")
            # то же здание под другим ключом (данные Минска пересобрали — центр контура сдвинулся): 2 м — одно здание
            if info.get("x") is not None:
                twin = db.execute("""SELECT owner_rid FROM props WHERE city = ? AND abs(x - ?) < 2 AND abs(z - ?) < 2
                                     LIMIT 1""", (city, info["x"], info["z"])).fetchone()
                if twin and twin["owner_rid"] != rid:
                    db.execute("ROLLBACK")
                    raise HTTPException(409, "это здание уже чьё-то — выбери другое")
            n = db.execute("SELECT count(*) AS n FROM props WHERE owner_rid = ? AND city = ? AND cls = ?",
                           (rid, city, cls)).fetchone()["n"]
            if n >= LIMIT[cls]:
                db.execute("ROLLBACK")
                what = "домов" if cls == "res" else "нежилых зданий"
                raise HTTPException(403, f"не больше {LIMIT[cls]} {what} в городе — продай одно, чтобы купить новое")
            if cls == "res":
                has_home = db.execute("""SELECT 1 FROM props WHERE owner_rid = ? AND city = ? AND kind = 'home'""",
                                      (rid, city)).fetchone()
                kind = "home" if (not has_home or primary) else "flat"
                if primary and has_home:
                    db.execute("UPDATE props SET kind = 'flat' WHERE owner_rid = ? AND city = ? AND kind = 'home'",
                               (rid, city))
            else:
                kind = "biz"
            db.execute("""INSERT INTO props (city, bkey, owner_rid, cls, kind, price, bought_at, addr, x, z, dx, dz, area,
                                             floors, landmark, dist)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                       (city, key, rid, cls, kind, price, now, info.get("addr", ""), info.get("x"), info.get("z"),
                        info.get("dx"), info.get("dz"), info.get("area", 0.0), info.get("floors", 1),
                        int(bool(info.get("landmark"))),
                        dist_of(city, info["x"], info["z"]) if info.get("x") is not None else ""))
            _mirror_home(db, city, key, rid, kind, price, now)
            # игрок без строки players (купил до первого /g/save) — заводим, чтобы на карте был виден вид владельца
            db.execute("""INSERT INTO players (rid, created_at, updated_at) VALUES (?, ?, ?)
                          ON CONFLICT(rid) DO NOTHING""", (rid, now, now))
            db.execute("COMMIT")
        except HTTPException:
            raise
        except Exception:
            db.execute("ROLLBACK")
            raise
    return {"ok": True, "already": False, "price": price, "kind": kind}


def _set_info(db, city: str, key: str, info: dict) -> None:
    db.execute("""UPDATE props SET addr = ?, x = ?, z = ?, dx = ?, dz = ?,
                    area = CASE WHEN area > 0 THEN area ELSE ? END,
                    floors = CASE WHEN area > 0 THEN floors ELSE ? END,
                    dist = ? WHERE city = ? AND bkey = ?""",
               (info.get("addr", ""), info.get("x"), info.get("z"), info.get("dx"), info.get("dz"),
                info.get("area", 0.0), info.get("floors", 1),
                dist_of(city, info["x"], info["z"]) if info.get("x") is not None else "", city, key))


def set_info(store, rid: str, city: str, key: str, info: dict) -> dict:
    ensure(store)
    with store.lock:
        row = store.db.execute("SELECT addr FROM props WHERE city = ? AND bkey = ? AND owner_rid = ?",
                               (city, key, rid)).fetchone()
        if not row:
            raise HTTPException(404, "это не твоё здание")
        if row["addr"]:
            return {"ok": True, "changed": False}
        _set_info(store.db, city, key, info)
    return {"ok": True, "changed": True}


def set_primary(store, rid: str, city: str, key: str) -> dict:
    ensure(store)
    with store.lock:
        db = store.db
        row = db.execute("SELECT cls FROM props WHERE city = ? AND bkey = ? AND owner_rid = ?", (city, key, rid)).fetchone()
        if not row or row["cls"] != "res":
            raise HTTPException(404, "это не твой дом")
        db.execute("UPDATE props SET kind = 'flat' WHERE owner_rid = ? AND city = ? AND kind = 'home'", (rid, city))
        db.execute("UPDATE props SET kind = 'home' WHERE city = ? AND bkey = ?", (city, key))
        for r in db.execute("SELECT bkey, kind FROM props WHERE owner_rid = ? AND city = ? AND cls = 'res'", (rid, city)).fetchall():
            n = _flame_int(city, r["bkey"])
            if n is not None:
                db.execute("UPDATE homes SET kind = ? WHERE building = ? AND owner_rid = ?", (r["kind"], n, rid))
    return {"ok": True}


def sell(store, rid: str, city: str, key: str, credit=None) -> dict:
    """Продать: 70% цены + половина вложенного в бизнес + остаток кассы. Деньги — кредитом честности (modes.credit)."""
    ensure(store)
    now = time.time()
    with store.lock:
        db = store.db
        row = db.execute("SELECT price, kind, cls FROM props WHERE city = ? AND bkey = ? AND owner_rid = ?",
                         (city, key, rid)).fetchone()
        if not row:
            raise HTTPException(404, "это не твоё здание")
        refund = int(round(int(row["price"]) * SELL_BACK))
        b = _load_biz(db, city, key)
        till = 0
        if b:
            _sim(b, now)
            till = int(b["till"])
            refund += int(round(b["invested"] * INVEST_BACK)) + till
            db.execute("DELETE FROM biz WHERE city = ? AND bkey = ?", (city, key))
        db.execute("DELETE FROM props WHERE city = ? AND bkey = ?", (city, key))
        n = _flame_int(city, key)
        if n is not None:
            db.execute("DELETE FROM homes WHERE building = ? AND owner_rid = ?", (n, rid))
        # продали главный — главным становится самый старый из оставшихся домов
        if row["kind"] == "home":
            nxt = db.execute("""SELECT bkey FROM props WHERE owner_rid = ? AND city = ? AND cls = 'res'
                                ORDER BY bought_at LIMIT 1""", (rid, city)).fetchone()
            if nxt:
                db.execute("UPDATE props SET kind = 'home' WHERE city = ? AND bkey = ?", (city, nxt["bkey"]))
                m = _flame_int(city, nxt["bkey"])
                if m is not None:
                    db.execute("UPDATE homes SET kind = 'home' WHERE building = ?", (m,))
    if credit:
        credit(rid, refund)
    return {"ok": True, "price": int(row["price"]), "refund": refund, "till": till}


# ---------------------------------------------------------------------------------------------------------------
# бизнес: загрузка, ленивая симуляция, состояние
# ---------------------------------------------------------------------------------------------------------------
def _load_biz(db, city: str, key: str) -> dict | None:
    r = db.execute("SELECT * FROM biz WHERE city = ? AND bkey = ?", (city, key)).fetchone()
    if not r:
        return None
    b = dict(r)
    for k, d in (("staff", []), ("hist", []), ("taken", []), ("cool", {})):
        try:
            b[k] = json.loads(b[k]) if b[k] else d
        except ValueError:
            b[k] = d
    try:
        b["run"] = json.loads(b["run"]) if b["run"] else None
    except ValueError:
        b["run"] = None
    return b


def _save_biz(db, b: dict) -> None:
    db.execute("""UPDATE biz SET type = ?, level = ?, name = ?, stock = ?, till = ?, sim_at = ?, collected_at = ?,
                    manager = ?, staff = ?, hist = ?, taken = ?, run = ?, cool = ?, seq = ?, earned = ?, invested = ?
                  WHERE city = ? AND bkey = ?""",
               (b["type"], b["level"], b["name"], b["stock"], b["till"], b["sim_at"], b["collected_at"], b["manager"],
                json.dumps(b["staff"], ensure_ascii=False), json.dumps(b["hist"][-14:], ensure_ascii=False),
                json.dumps(b["taken"][-40:]), json.dumps(b["run"]) if b["run"] else None, json.dumps(b["cool"]),
                b["seq"], b["earned"], b["invested"], b["city"], b["bkey"]))


def _event(b: dict, t: float, e: str, **kw) -> None:
    b["hist"].append(dict({"t": int(t), "e": e}, **kw))
    if len(b["hist"]) > 14:
        del b["hist"][:-14]


def _hire(b: dict, cand: dict, now: float) -> dict:
    b["seq"] += 1
    e = {"id": b["seq"], "n": cand["n"], "cre": cand["cre"], "tr": list(cand["tr"])[:5], "sk": float(cand["sk"]),
         "w": int(cand["w"]), "m": float(cand["m"]), "h": int(now), "d": 0.0, "bt": 0}
    b["staff"].append(e)
    b["taken"].append(cand["id"])
    return e


def _sim(b: dict, now: float) -> list[dict]:
    """Досчитать бизнес часовыми шагами от sim_at до now: выработка (пока есть сырьё и место в кассе), сырьё, налог,
    зарплаты (только за часы работы), менеджер, мораль, уходы (детерминированно), рост навыка."""
    events: list[dict] = []
    t0 = float(b["sim_at"])
    if now <= t0:
        return events
    total = now - t0
    steps = max(1, min(SIM_STEPS, int(math.ceil(total / 3600.0))))
    dt_s = total / steps
    lvl = b["level"]
    for s in range(steps):
        t = t0 + dt_s * (s + 1)
        dh = dt_s / 3600.0
        staff = b["staff"]
        full = full_rate(b["type"], lvl)
        cap = full * cap_h(lvl, bool(b["manager"]))
        gross = full * staff_k(staff, lvl) * morale_k(staff)
        use_k = 1.0 + sum(_trait_sum(e, "supply") for e in staff) / max(1, len(staff))
        use_per_h = 100.0 / supply_h(lvl) * (gross / full) * max(0.5, use_k)
        # менеджер: кончается сырьё — докупает из кассы (110% цены)
        if b["manager"] and b["stock"] < 15:
            cost = supply_cost(b["type"], lvl, b["stock"]) * 1.1
            if b["till"] >= cost:
                b["till"] -= cost
                b["stock"] = 100.0
                if not any(ev["e"] == "auto_supply" for ev in events):
                    events.append({"t": int(t), "e": "auto_supply", "cost": int(cost)})
        room = max(0.0, cap - b["till"])
        frac = 0.0
        if b["stock"] > 0 and room > 0 and gross > 0:
            frac = min(1.0, b["stock"] / max(1e-9, use_per_h * dh))
            frac = min(frac, room / max(1e-9, gross * dh * (1 - TAX - (MGR_SHARE if b["manager"] else 0.0))))
            frac = max(0.0, min(1.0, frac))
        made = gross * dh * frac
        wages = sum(e["w"] for e in staff) * dh * frac
        net = made * (1 - TAX - (MGR_SHARE if b["manager"] else 0.0)) - wages
        b["stock"] = max(0.0, b["stock"] - use_per_h * dh * frac)
        unpaid = False
        if b["till"] + net < 0:
            unpaid = True
            b["till"] = 0.0
        else:
            b["till"] += net
        idle = frac < 0.5
        # мораль: к цели на 15% за час; навык растёт за часы работы
        for e in staff:
            tgt = morale_target(e, staff, lvl, idle) - (30.0 if unpaid else 0.0)
            e["m"] = round(e["m"] + (tgt - e["m"]) * min(1.0, 0.15 * dh), 2)
            e["m"] = max(0.0, min(100.0, e["m"]))
            worked = dh * frac / 24.0
            e["d"] = round(e.get("d", 0.0) + worked, 3)
            e["sk"] = round(min(95.0, e["sk"] + worked * (2.0 if _has(e, "learner") else 0.5)), 2)
        # уходы: мораль ниже 30 — шанс за час (детерминированно по часу и сотруднику)
        hour = int(t // 3600)
        gone = [e for e in staff if quit_risk(e) > 0 and _rand(b["owner_rid"], b["city"], b["bkey"], e["id"], hour)
                < 1 - (1 - quit_risk(e)) ** dh]
        for e in gone:
            staff.remove(e)
            for o in staff:
                o["m"] = max(0.0, o["m"] - QUIT_HIT)
            _event(b, t, "quit", n=e["n"], cre=e["cre"], tr=e["tr"])
            events.append({"t": int(t), "e": "quit", "n": e["n"], "cre": e["cre"], "tr": e["tr"]})
        # менеджер закрывает вакансии лучшим кандидатом окна (навык ≥ 40)
        if gone and b["manager"]:
            win = int(t // CAND_WINDOW)
            pool = [c for c in candidates(b["owner_rid"], b["city"], b["bkey"], lvl, win)
                    if c["id"] not in b["taken"] and c["sk"] >= 40]
            pool.sort(key=lambda c: -c["sk"])
            while pool and len(staff) < slots(lvl):
                e = _hire(b, pool.pop(0), t)
                _event(b, t, "auto_hire", n=e["n"], cre=e["cre"])
                events.append({"t": int(t), "e": "auto_hire", "n": e["n"]})
    b["sim_at"] = now
    return events


def stars(b: dict) -> int:
    """Звёзды бизнеса (1–5): уровень и стаж штата — притягивают кандидатов сильнее (ресёрч: компании Torn)."""
    tenure = sum(min(7.0, e.get("d", 0.0)) for e in b["staff"]) / max(1, slots(b["level"]))
    return max(1, min(5, int(b["level"] * 0.6 + tenure * 0.5 + 0.6)))


def view(b: dict, now: float, rid: str) -> dict:
    lvl = b["level"]
    full = full_rate(b["type"], lvl)
    gross = gross_rate(b)
    wages = sum(e["w"] for e in b["staff"])
    net_h = gross * (1 - TAX - (MGR_SHARE if b["manager"] else 0.0)) - wages
    win = int(now // CAND_WINDOW)
    cands = [c for c in candidates(rid, b["city"], b["bkey"], min(MAX_LVL, lvl + stars(b) // 3), win)
             if c["id"] not in b["taken"]]
    staff = []
    for e in b["staff"]:
        staff.append(dict(e, risk=round(quit_risk(e), 3), market=int(market_wage(e["sk"]))))
    cool = {k: max(0, int(v - now)) for k, v in b["cool"].items() if v > now}
    return {"city": b["city"], "key": b["bkey"], "type": b["type"], "name": b["name"], "level": lvl,
            "stock": round(b["stock"], 1), "till": int(b["till"]), "cap": int(full * cap_h(lvl, bool(b["manager"]))),
            "rate": int(gross), "full": int(full), "net_h": int(net_h), "wages_h": int(wages), "slots": slots(lvl),
            "staff": staff, "cands": cands, "cand_next": int((win + 1) * CAND_WINDOW - now), "manager": bool(b["manager"]),
            "run": b["run"], "cool": cool, "hist": b["hist"][-10:], "stars": stars(b),
            "upgrade": upgrade_cost(b["type"], lvl), "supply": supply_cost(b["type"], lvl, b["stock"]),
            "supply_h": supply_h(lvl), "mgr_fee": MGR_FEE * lvl, "earned": int(b["earned"]), "invested": int(b["invested"]),
            "opened_at": int(b["opened_at"]), "collected_at": int(b["collected_at"])}


# ---------------------------------------------------------------------------------------------------------------
# бизнес: действия владельца (всё — под одной блокировкой, с досчётом до «сейчас»)
# ---------------------------------------------------------------------------------------------------------------
def _own_prop(db, rid: str, city: str, key: str):
    p = db.execute("SELECT * FROM props WHERE city = ? AND bkey = ? AND owner_rid = ?", (city, key, rid)).fetchone()
    if not p:
        raise HTTPException(404, "это не твоё здание")
    return p


def _own_biz(db, rid: str, city: str, key: str, now: float) -> tuple[dict, list[dict]]:
    _own_prop(db, rid, city, key)
    b = _load_biz(db, city, key)
    if not b:
        raise HTTPException(404, "бизнеса в этом здании ещё нет")
    ev = _sim(b, now)
    return b, ev


def open_biz(store, rid: str, city: str, key: str, t: str, word: int, now: float | None = None) -> dict:
    ensure(store)
    now = time.time() if now is None else now
    with store.lock:
        db = store.db
        p = _own_prop(db, rid, city, key)
        if p["cls"] != "com":
            raise HTTPException(400, "бизнес — только в нежилом здании")
        if db.execute("SELECT 1 FROM biz WHERE city = ? AND bkey = ?", (city, key)).fetchone():
            raise HTTPException(409, "бизнес здесь уже есть")
        if float(p["area"] or 0) and float(p["area"]) < TYPES[t]["area"]:
            raise HTTPException(400, f"{TYPES[t]['name']} не поместится: нужно от {TYPES[t]['area']} м²")
        name = TYPES[t]["name"] + " «" + WORDS[word % len(WORDS)] + "»"
        db.execute("""INSERT INTO biz (city, bkey, owner_rid, type, level, name, stock, till, sim_at, opened_at,
                                       invested) VALUES (?, ?, ?, ?, 1, ?, 50, 0, ?, ?, ?)""",
                   (city, key, rid, t, name, now, int(now), TYPES[t]["equip"]))
        b = _load_biz(db, city, key)
        _event(b, now, "open")
        _save_biz(db, b)
        return {"ok": True, "cost": TYPES[t]["equip"], "biz": view(b, now, rid)}


def state(store, rid: str, city: str, key: str, now: float | None = None) -> dict:
    ensure(store)
    now = time.time() if now is None else now
    with store.lock:
        b, ev = _own_biz(store.db, rid, city, key, now)
        _save_biz(store.db, b)
        return {"biz": view(b, now, rid), "events": ev}


def biz_mine(store, rid: str, city: str | None = None, now: float | None = None) -> list[dict]:
    ensure(store)
    now = time.time() if now is None else now
    out = []
    with store.lock:
        db = store.db
        sql = "SELECT city, bkey FROM biz WHERE owner_rid = ?" + (" AND city = ?" if city else "") + " ORDER BY opened_at"
        for r in db.execute(sql, (rid, city) if city else (rid,)).fetchall():
            b = _load_biz(db, r["city"], r["bkey"])
            ev = _sim(b, now)
            _save_biz(db, b)
            v = view(b, now, rid)
            v["events"] = ev
            out.append(v)
    return out


def _income(db, rid: str, city: str, paid: int, kind: str, now: float) -> int:
    """Выручка бизнеса для рейтинга и опыта (progress.py, 22.11): касса и доставки. Ошибка учёта не ломает выплату."""
    try:
        import progress
        return progress.on_income(db, rid, city, paid, kind, now)
    except Exception:                                   # noqa: BLE001 — рейтинг вторичен по отношению к деньгам
        import logging
        logging.getLogger("fcg").exception("учёт выручки %s", rid)
        return 0


def _pay(b: dict, cost: int, how: str) -> str:
    """Оплата из кассы (сервер проверяет) или наличными (их списывает клиент; сервер верит в пределах лимитов)."""
    if how == "till":
        if b["till"] < cost:
            raise HTTPException(402, "в кассе не хватает — заплати наличными или подожди выручку")
        b["till"] -= cost
        return "till"
    return "cash"


def _cool(b: dict, k: str, now: float, sec: float) -> None:
    if b["cool"].get(k, 0) > now:
        raise HTTPException(429, "рано — подожди немного")
    b["cool"][k] = now + sec


def upgrade(store, rid: str, city: str, key: str, how: str, now: float | None = None) -> dict:
    ensure(store)
    now = time.time() if now is None else now
    with store.lock:
        b, _ = _own_biz(store.db, rid, city, key, now)
        cost = upgrade_cost(b["type"], b["level"])
        if cost is None:
            raise HTTPException(400, "уже максимальный уровень")
        _cool(b, "upgrade", now, 20)
        paid = _pay(b, cost, how)
        b["level"] += 1
        b["invested"] += cost
        _event(b, now, "upgrade", lvl=b["level"])
        _save_biz(store.db, b)
        return {"ok": True, "cost": cost, "paid": paid, "biz": view(b, now, rid)}


def supply(store, rid: str, city: str, key: str, how: str, now: float | None = None) -> dict:
    ensure(store)
    now = time.time() if now is None else now
    with store.lock:
        b, _ = _own_biz(store.db, rid, city, key, now)
        cost = supply_cost(b["type"], b["level"], b["stock"])
        if cost <= 0:
            raise HTTPException(400, "склад и так полон")
        _cool(b, "supply", now, 5)
        paid = _pay(b, cost, how)
        b["stock"] = 100.0
        _save_biz(store.db, b)
        return {"ok": True, "cost": cost, "paid": paid, "biz": view(b, now, rid)}


def collect(store, rid: str, city: str, key: str, near: bool | None, credit=None, now: float | None = None) -> dict:
    """Забрать кассу. near: True — у здания, False — далеко (только с менеджером, −10%), None — сервер не знает где."""
    ensure(store)
    now = time.time() if now is None else now
    with store.lock:
        db = store.db
        b, ev = _own_biz(db, rid, city, key, now)
        p = _own_prop(db, rid, city, key)
        fee = 0.0
        if near is False:
            if not b["manager"]:
                raise HTTPException(403, "кассу забирают у здания — или найми менеджера")
            fee = REMOTE_FEE
        till = int(b["till"])
        if till <= 0:
            _save_biz(db, b)
            return {"ok": True, "paid": 0, "biz": view(b, now, rid), "events": ev}
        hb = _hold_bonus(db, rid, city, p["dist"], now)
        paid = int(round(till * (1 - fee) * (1 + hb)))
        b["till"] -= till
        b["earned"] += paid
        b["collected_at"] = int(now)
        _save_biz(db, b)
        pts = _add_pts(db, rid, city, p["dist"], min(300.0, paid / 100.0), now, src="biz")
        xp = _income(db, rid, city, paid, "biz", now)
    if credit:
        credit(rid, paid)
    return {"ok": True, "paid": paid, "fee": fee, "bonus": hb, "pts": round(pts, 1), "xp": xp, "biz": view(b, now, rid),
            "events": ev}


def hire(store, rid: str, city: str, key: str, cid: str, now: float | None = None) -> dict:
    ensure(store)
    now = time.time() if now is None else now
    with store.lock:
        b, _ = _own_biz(store.db, rid, city, key, now)
        if len(b["staff"]) >= slots(b["level"]):
            raise HTTPException(403, "все места заняты — улучши бизнес или уволь кого-то")
        v = view(b, now, rid)
        c = next((c for c in v["cands"] if c["id"] == cid), None)
        if not c:
            raise HTTPException(404, "этого кандидата уже нет — список обновился")
        e = _hire(b, c, now)
        _event(b, now, "hire", n=e["n"], cre=e["cre"])
        _save_biz(store.db, b)
        return {"ok": True, "emp": e, "biz": view(b, now, rid)}


def fire(store, rid: str, city: str, key: str, emp: int, now: float | None = None) -> dict:
    """Уволить: выходное пособие (2 часа ставки из кассы), остальным −8 к морали (−14, если ушла «душа компании»;
    ушёл ворчун — +4). Отзыв бывшего сотрудника в ленту пишет клиент по ответу (review)."""
    ensure(store)
    now = time.time() if now is None else now
    with store.lock:
        b, _ = _own_biz(store.db, rid, city, key, now)
        e = next((x for x in b["staff"] if x["id"] == emp), None)
        if not e:
            raise HTTPException(404, "такого сотрудника нет")
        b["staff"].remove(e)
        sev = min(b["till"], 2.0 * e["w"])
        b["till"] -= sev
        hit = -4.0 if _has(e, "soc") and _trait_sum(e, "soc") < 0 else (FIRE_SOUL_HIT if "soul" in e["tr"] else FIRE_HIT)
        for o in b["staff"]:
            o["m"] = max(0.0, min(100.0, o["m"] - hit))
        _event(b, now, "fire", n=e["n"], cre=e["cre"], tr=e["tr"])
        _save_biz(store.db, b)
        review = {"n": e["n"], "cre": e["cre"], "tr": e["tr"], "m": round(e["m"]), "days": round(e.get("d", 0.0), 1),
                  "stars": 1 if e["m"] < 50 else 2, "biz": b["name"]}
        return {"ok": True, "severance": int(sev), "hit": hit, "review": review, "biz": view(b, now, rid)}


def bonus(store, rid: str, city: str, key: str, emp: int, how: str, now: float | None = None) -> dict:
    ensure(store)
    now = time.time() if now is None else now
    with store.lock:
        b, _ = _own_biz(store.db, rid, city, key, now)
        e = next((x for x in b["staff"] if x["id"] == emp), None)
        if not e:
            raise HTTPException(404, "такого сотрудника нет")
        if e.get("bt", 0) > now:
            raise HTTPException(429, "премию этому сотруднику — не чаще раза в 2 часа")
        cost = int(3 * e["w"])
        paid = _pay(b, cost, how)
        e["m"] = min(100.0, e["m"] + 15.0)
        e["bt"] = int(now + 2 * 3600)
        _save_biz(store.db, b)
        return {"ok": True, "cost": cost, "paid": paid, "biz": view(b, now, rid)}


def raise_wage(store, rid: str, city: str, key: str, emp: int, now: float | None = None) -> dict:
    """Ставка — храповик (Two Point): поднять на 10% можно, снизить нельзя; потолок — двойная рыночная."""
    ensure(store)
    now = time.time() if now is None else now
    with store.lock:
        b, _ = _own_biz(store.db, rid, city, key, now)
        e = next((x for x in b["staff"] if x["id"] == emp), None)
        if not e:
            raise HTTPException(404, "такого сотрудника нет")
        top = int(2 * market_wage(e["sk"]))
        if e["w"] >= top:
            raise HTTPException(400, "ставка и так вдвое выше рынка")
        e["w"] = min(top, int(math.ceil(e["w"] * 1.1)))
        e["m"] = min(100.0, e["m"] + 5.0)
        _save_biz(store.db, b)
        return {"ok": True, "wage": e["w"], "biz": view(b, now, rid)}


def manager(store, rid: str, city: str, key: str, on: bool, now: float | None = None) -> dict:
    ensure(store)
    now = time.time() if now is None else now
    with store.lock:
        b, _ = _own_biz(store.db, rid, city, key, now)
        if bool(b["manager"]) == on:
            return {"ok": True, "cost": 0, "biz": view(b, now, rid)}
        cost = MGR_FEE * b["level"] if on else 0
        if on:
            _cool(b, "manager", now, 60)
        b["manager"] = 1 if on else 0
        _event(b, now, "manager_on" if on else "manager_off")
        _save_biz(store.db, b)
        return {"ok": True, "cost": cost, "biz": view(b, now, rid)}


def run(store, rid: str, city: str, key: str, kind: str, a: str, dist: float, credit=None,
        now: float | None = None) -> dict:
    """Рейсы-миссии (GTA Online): «доставка заказа» — товар из кассы ×1,35 по приезде; «за сырьём» — +60% сырья
    бесплатно. Время рейса — часы сервера: не быстрее расстояния на 35 м/с, не дольше 12 минут."""
    ensure(store)
    now = time.time() if now is None else now
    paid = 0
    with store.lock:
        db = store.db
        b, _ = _own_biz(db, rid, city, key, now)
        p = _own_prop(db, rid, city, key)
        r = b["run"]
        if a == "start":
            if r:
                raise HTTPException(409, "рейс уже идёт")
            if b["cool"].get(kind, 0) > now:
                raise HTTPException(429, "рано: следующий рейс через " + str(int(b["cool"][kind] - now)) + " с")
            dist = max(150.0, min(4000.0, dist))
            amount = 0
            if kind == "sell":
                amount = int(min(b["till"], full_rate(b["type"], b["level"]) * 3))
                if amount < 200:
                    raise HTTPException(400, "в кассе мало товара для доставки")
                b["till"] -= amount
            b["run"] = {"kind": kind, "amount": amount, "t0": now, "dist": dist, "min": max(25.0, dist / 35.0)}
            _save_biz(db, b)
            return {"ok": True, "run": b["run"], "biz": view(b, now, rid)}
        if not r or r["kind"] != kind:
            raise HTTPException(404, "рейса нет")
        took = now - r["t0"]
        ok = a == "done" and r["min"] <= took <= RUN_MAX
        b["run"] = None
        b["cool"][kind] = now + RUN_EVERY[kind]
        res = {"ok": ok, "took": round(took, 1)}
        if kind == "sell":
            if ok:
                perf = min(2, sum(1 for e in b["staff"] if "perfect" in e["tr"]))
                bonus_k = _hold_bonus(db, rid, city, p["dist"], now)
                paid = int(round(r["amount"] * (RUN_BONUS + 0.1 * perf) * (1 + bonus_k)))
                b["earned"] += paid
                res["paid"] = paid
                res["pts"] = round(_add_pts(db, rid, city, p["dist"], min(400.0, paid / 80.0), now, src="run"), 1)
                res["xp"] = _income(db, rid, city, paid, "run", now)
                _event(b, now, "run_sell", paid=paid)
            else:
                back = int(r["amount"] * 0.75)                 # не довёз — товар помялся, вернули в кассу 75%
                b["till"] += back
                res["back"] = back
        else:
            if ok:
                b["stock"] = min(100.0, b["stock"] + SUPPLY_RUN)
                _event(b, now, "run_supply")
        if not ok and a == "done":
            res["why"] = "слишком быстро" if took < r["min"] else "дольше 12 минут"
        _save_biz(db, b)
        res["biz"] = view(b, now, rid)
    if paid and credit:
        credit(rid, paid)
    return res


# ---------------------------------------------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------------------------------------------
def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _city(v) -> str:
    if v not in CITIES:
        raise HTTPException(400, "city — flame или minsk")
    return v


def _key(city: str, v) -> str:
    if not isinstance(v, str) or not KEY_RE[city].fullmatch(v):
        raise HTTPException(400, "key — ключ здания")
    if city == "flame" and int(v) >= FLAME_MAX:
        raise HTTPException(400, "key — номер здания")
    return v


def _info(city: str, body: dict) -> dict:
    lim = CITY_XZ[city]
    out = {}
    for k in ("x", "z", "dx", "dz"):
        v = body.get(k)
        if v is not None:
            if not _num(v) or abs(v) > lim:
                raise HTTPException(400, f"{k} — координата в пределах города")
            out[k] = round(float(v), 1)
    if ("x" in out) != ("z" in out):
        raise HTTPException(400, "x и z — вместе")
    addr = body.get("addr")
    out["addr"] = addr[:80] if isinstance(addr, str) else ""
    f = body.get("facts") if isinstance(body.get("facts"), dict) else {}
    area, floors = f.get("area"), f.get("floors")
    out["area"] = round(float(area), 1) if _num(area) and 0 < area <= 40000 else 0.0
    out["floors"] = int(floors) if _num(floors) and 1 <= floors <= 120 else 1
    out["landmark"] = bool(f.get("landmark") is True)
    out["tier"] = int(f.get("tier")) if _num(f.get("tier")) and f.get("tier") in (1, 2, 3, 4) else 4
    out["style"] = f.get("style") if f.get("style") in STYLE_K else ""
    return out


def make_router(get_store, verify, read_body, where=None, modes_obj=None) -> APIRouter:
    """where(rid) → (город, x, z) игрока в онлайне или None; modes_obj.credit(rid, $) — кредит честности сохранений."""
    r = APIRouter()
    credit = getattr(modes_obj, "credit", None)

    async def who(body: dict) -> str:
        rid = await verify(body.get("token") or "")
        if not rid:
            raise HTTPException(401, "войди своим агентом — гостю здание не закрепить")
        return rid

    def throttle(rid: str, k: str = "w"):
        now = time.monotonic()
        tag = rid + ":" + k
        if now - _acted.get(tag, -1e9) < EVERY:
            raise HTTPException(429, "не так быстро")
        _acted[tag] = now
        if len(_acted) > 40000:
            _acted.clear()

    def near_of(rid: str, city: str, key: str) -> bool | None:
        if not where:
            return None
        w = where(rid)
        if not w or w[0] != city:
            return None
        st = get_store()
        with st.lock:
            p = st.db.execute("SELECT x, z FROM props WHERE city = ? AND bkey = ?", (city, key)).fetchone()
        if not p or p["x"] is None:
            return None
        return math.hypot(w[1] - p["x"], w[2] - p["z"]) <= NEAR_M

    async def ck(request: Request, write: bool = True) -> tuple[dict, str, str, str]:
        body = await read_body(request)
        rid = await who(body)
        city = _city(body.get("city"))
        key = _key(city, body.get("key"))
        if write:
            throttle(rid)
        return body, rid, city, key

    def pay_of(body: dict) -> str:
        return "till" if body.get("pay") == "till" else "cash"

    @r.get("/g/props")
    async def props(resp: Response, city: str = "flame"):
        _city(city)
        resp.headers["Cache-Control"] = "public, max-age=15"
        items = await asyncio.to_thread(taken, get_store(), city)
        return {"city": city, "props": items, "n": len(items)}

    @r.post("/g/prop/mine")
    async def prop_mine(request: Request):
        body = await read_body(request)
        rid = await who(body)
        city = _city(body["city"]) if body.get("city") is not None else None
        return {"props": await asyncio.to_thread(mine, get_store(), rid, city), "limit": LIMIT}

    @r.post("/g/prop/claim")
    async def prop_claim(request: Request):
        body = await read_body(request)
        rid = await who(body)
        city = _city(body.get("city"))
        key = _key(city, body.get("key"))
        cls = body.get("cls")
        if cls not in LIMIT:
            raise HTTPException(400, "cls — res или com")
        info = _info(city, body)
        if info.get("x") is None and city == "minsk":
            raise HTTPException(400, "для Минска нужны x и z здания")
        price = price_of(city, cls, info["area"] or 700.0, info["floors"], info["tier"], info["style"], info["landmark"])
        if not PRICE_MIN <= price <= PRICE_MAX:
            raise HTTPException(400, "цена вне пределов")
        throttle(rid)
        return await asyncio.to_thread(claim, get_store(), rid, city, key, cls, price, info, body.get("primary") is True)

    @r.post("/g/prop/sell")
    async def prop_sell(request: Request):
        _, rid, city, key = await ck(request)
        return await asyncio.to_thread(sell, get_store(), rid, city, key, credit)

    @r.post("/g/prop/info")
    async def prop_info(request: Request):
        body, rid, city, key = await ck(request)
        return await asyncio.to_thread(set_info, get_store(), rid, city, key, _info(city, body))

    @r.post("/g/prop/primary")
    async def prop_primary(request: Request):
        _, rid, city, key = await ck(request)
        return await asyncio.to_thread(set_primary, get_store(), rid, city, key)

    @r.post("/g/biz/open")
    async def biz_open(request: Request):
        body, rid, city, key = await ck(request)
        t = body.get("type")
        if t not in TYPES:
            raise HTTPException(400, "type — вид бизнеса из списка")
        w = body.get("word")
        w = int(w) if _num(w) and 0 <= w < len(WORDS) else 0
        return await asyncio.to_thread(open_biz, get_store(), rid, city, key, t, w)

    @r.post("/g/biz/state")
    async def biz_state(request: Request):
        _, rid, city, key = await ck(request, write=False)
        return await asyncio.to_thread(state, get_store(), rid, city, key)

    @r.post("/g/biz/mine")
    async def biz_list(request: Request):
        body = await read_body(request)
        rid = await who(body)
        city = _city(body["city"]) if body.get("city") is not None else None
        return {"biz": await asyncio.to_thread(biz_mine, get_store(), rid, city)}

    @r.post("/g/biz/collect")
    async def biz_collect(request: Request):
        _, rid, city, key = await ck(request)
        near = await asyncio.to_thread(near_of, rid, city, key)
        return await asyncio.to_thread(collect, get_store(), rid, city, key, near, credit)

    @r.post("/g/biz/upgrade")
    async def biz_upgrade(request: Request):
        body, rid, city, key = await ck(request)
        return await asyncio.to_thread(upgrade, get_store(), rid, city, key, pay_of(body))

    @r.post("/g/biz/supply")
    async def biz_supply(request: Request):
        body, rid, city, key = await ck(request)
        return await asyncio.to_thread(supply, get_store(), rid, city, key, pay_of(body))

    @r.post("/g/biz/hire")
    async def biz_hire(request: Request):
        body, rid, city, key = await ck(request)
        cid = body.get("cand")
        if not isinstance(cid, str) or len(cid) > 32:
            raise HTTPException(400, "cand — номер кандидата")
        return await asyncio.to_thread(hire, get_store(), rid, city, key, cid)

    def emp_of(body: dict) -> int:
        e = body.get("emp")
        if not _num(e) or e != int(e):
            raise HTTPException(400, "emp — номер сотрудника")
        return int(e)

    @r.post("/g/biz/fire")
    async def biz_fire(request: Request):
        body, rid, city, key = await ck(request)
        return await asyncio.to_thread(fire, get_store(), rid, city, key, emp_of(body))

    @r.post("/g/biz/bonus")
    async def biz_bonus(request: Request):
        body, rid, city, key = await ck(request)
        return await asyncio.to_thread(bonus, get_store(), rid, city, key, emp_of(body), pay_of(body))

    @r.post("/g/biz/raise")
    async def biz_raise(request: Request):
        body, rid, city, key = await ck(request)
        return await asyncio.to_thread(raise_wage, get_store(), rid, city, key, emp_of(body))

    @r.post("/g/biz/manager")
    async def biz_manager(request: Request):
        body, rid, city, key = await ck(request)
        return await asyncio.to_thread(manager, get_store(), rid, city, key, body.get("on") is True)

    @r.post("/g/biz/run")
    async def biz_run(request: Request):
        body, rid, city, key = await ck(request)
        kind, a = body.get("kind"), body.get("a")
        if kind not in RUN_EVERY or a not in ("start", "done", "fail"):
            raise HTTPException(400, "kind — sell|supply, a — start|done|fail")
        d = body.get("dist")
        d = float(d) if _num(d) else 600.0
        return await asyncio.to_thread(run, get_store(), rid, city, key, kind, a, d, credit)

    @r.get("/g/season")
    async def season_get(resp: Response, city: str = "flame"):
        _city(city)
        resp.headers["Cache-Control"] = "public, max-age=20"
        return await asyncio.to_thread(season, get_store(), city)

    @r.post("/g/season/me")
    async def season_me(request: Request):
        body = await read_body(request)
        rid = await who(body)
        return await asyncio.to_thread(my_team, get_store(), rid, _city(body.get("city")))

    @r.post("/g/season/team")
    async def season_team(request: Request):
        body = await read_body(request)
        rid = await who(body)
        city = _city(body.get("city"))
        team = body.get("team")
        if team not in TEAMS:
            raise HTTPException(400, "team — msk, minsk или ala")
        throttle(rid, "team")
        return await asyncio.to_thread(set_team, get_store(), rid, city, team)

    @r.post("/g/season/act")
    async def season_act(request: Request):
        body = await read_body(request)
        rid = await who(body)
        city = _city(body.get("city"))
        kind = body.get("kind")
        if kind not in ACT_PTS:
            raise HTTPException(400, "kind — дело из списка")
        x, z = body.get("x"), body.get("z")
        if not (_num(x) and _num(z)) or abs(x) > CITY_XZ[city] or abs(z) > CITY_XZ[city]:
            raise HTTPException(400, "x, z — место дела")
        now = time.monotonic()
        tag = rid + ":act"
        if now - _acted.get(tag, -1e9) < ACT_EVERY:
            raise HTTPException(429, "не так быстро")
        _acted[tag] = now
        return await asyncio.to_thread(act, get_store(), rid, city, kind, float(x), float(z))

    return r
