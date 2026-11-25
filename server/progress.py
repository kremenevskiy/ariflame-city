"""Уровни и опыт, профиль игрока, рейтинги (город и весь мир, неделя и всё время), вход по дням, достижения.

Задача: «рейтинги, лидерборды, захваты, рейтинг игроков, как в Rise of Kingdoms — почему там это
популярно; всё из ресёрча добавь». Ресёрч механик: GTA Online — ранг по RP
за любое дело, открытия по рангу (gta_mechanics_and_retention.md); RoK — рейтинги силы и альянсов, недельный ритм
(territory_ownership_business_mechanics.md, п. 4, 5); СНГ-RP — долгая лестница статуса, лидерборды
(cis_rp_games_and_virality.md). Ничего за настоящие деньги: награды — игровые деньги (кредитом честности modes.credit)
и опыт.

Честность. Опыт выдаёт сервер, клиент только называет, ЧТО он сделал: {источник: сколько раз}. Сервер сам знает, сколько
опыта стоит раз (SRC), режет частоту (не чаще раза в N секунд на источник), потолок источника за сутки и общий потолок
DAY_CAP. Касса и доставки бизнесов, гонки (время по серверу), дела в районах, помощь клану, флаг в войну, вход по дням —
сервер начисляет сам (зовут realty.py, modes.py, season.py, crews.py, war.py). Первый раз опыт заводится из честного
заработка (таблица honest, modes.check_save) — не выше SEED_LVL, чтобы старые игроки не начинали с первого уровня.

Наружу — непрозрачный fid (тот же хэш, что у друзей modes.fid), ник (свой — nicks.py, нет своего — слово из списка + число),
вид существа, уровень, тег клана. Ни rid, ни имени агента. Читеры (honest.cheat ≥ modes.CHEAT_TOP) в рейтинги не попадают.

Таблицы (своя SQLite, CREATE IF NOT EXISTS; старые не меняются): prog (опыт, уровень, ник, титулы, сутки, серия,
состояние), prog_city (опыт по городам), prog_week (опыт за неделю по городам), biz_week / biz_total (выручка бизнесов),
infl_me (влияние игрока за неделю — max вклада в банду «Передела» и в клан), ach (открытые достижения).
Миграция при старте (идемпотентно): biz_total ← biz.earned, infl_me ← season_me.

HTTP:
  POST /g/prog/sync  {token, city, gains: {src: n}, ach: [[id, rarity]]}   опыт клиента и достижения, раз в 15 с
  POST /g/prog/me    {token, city?}       свой профиль, места в рейтингах, серия входа, титулы
  POST /g/prog/daily {token}              награда за вход (серия 7 дней)
  POST /g/prog/title {token, title}       выбрать титул из открытых
  POST /g/prog/nick  {token, w, n}        ник: слово из списка NICKS + число 1–99 (раз в сутки)
  GET  /g/profile?fid=                    карточка игрока (публично, кэш 30 с)
  GET  /g/ranks?board=&scope=&city=&n=    рейтинг: level | worth | biz | infl | race | crew; week | all; flame | minsk | all
  GET  /g/ach/stats                       доля игроков с каждым достижением (кэш 10 мин)
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import math
import re
import time

from fastapi import APIRouter, HTTPException, Request, Response

CITIES = ("flame", "minsk")
TZ = 3 * 3600                 # сутки, серия входа и потолки — по Минску/Москве (UTC+3)
DAY_CAP = 15000               # опыта за сутки всего
MAX_LVL = 500
SEED_LVL = 25                 # опыт из прошлого заработка — не выше этого уровня
SYNC_EVERY = 15.0             # /g/prog/sync — не чаще (клиент шлёт раз в 30 с)
CACHE_S = 45.0                # рейтинги в памяти
TOP_MAX = 5000                # мест в рейтинге считаем (дальше «5000+»)

# источник → (опыт за раз, не чаще раза в N секунд, потолок источника за сутки, сообщает клиент)
SRC = {
    "job": (35, 12, 2500, True),        # смена, такси, курьер, работа
    "mission": (120, 40, 3000, True),   # задание сюжета, миссия
    "event": (60, 25, 1500, True),      # событие города, мини-игра
    "heist": (200, 90, 2400, True),     # налёт
    "photo": (25, 45, 300, True),       # кадр в сторис / другу
    "daily": (100, 30, 600, True),      # задание дня
    "stunt": (8, 4, 400, True),         # трюк
    "secret": (40, 15, 1200, True),     # находка, секрет (fsecrets.js)
    "biz": (0, 0, 3000, False),         # касса бизнеса: 10 + выручка/400, ≤ 150 (realty.collect)
    "run": (80, 0, 1500, False),        # доставка заказа (realty.run)
    "race": (100, 0, 2000, False),      # гонка до финиша по серверу (modes)
    "district": (20, 0, 1500, False),   # дело в районе «Передела» (season.act)
    "help": (12, 0, 300, False),        # помощь соклановцу (crews)
    "war": (40, 0, 1600, False),        # флаг района в окно войны (war)
    "ach": (0, 0, 1500, False),         # достижение — по редкости
    "login": (0, 0, 1000, False),       # вход по дням
    "crew": (0, 0, 3000, False),        # цели клана недели
}
ACH_XP = {"common": 25, "rare": 60, "epic": 120, "legend": 250}
ACH_RE = re.compile(r"[a-z0-9_]{2,40}")
ACH_MAX = 400

# GTA-подобная кривая: до уровня L нужно 250·(L−1) + 60·(L−1)² опыта (10-й — 7 110, 50-й — 156 310, 100-й — 612 810)
def need(lvl: int) -> int:
    k = max(0, int(lvl) - 1)
    return 250 * k + 60 * k * k


def lvl_of(xp: float) -> int:
    xp = max(0.0, float(xp))
    k = int((-250 + math.sqrt(250 * 250 + 240 * xp)) / 120)
    while need(k + 2) <= xp:
        k += 1
    while k > 0 and need(k + 1) > xp:
        k -= 1
    return max(1, min(MAX_LVL, k + 1))


# титулы: по уровню (сами) и особые (выдаёт сервер или считаются на лету)
TITLES_LVL = [(1, "novice", "Новичок"), (3, "local", "Местный"), (5, "regular", "Свой человек"), (10, "dealer", "Делец"),
              (15, "fixer", "Решала"), (20, "boss", "Деловой"), (30, "auth", "Авторитет"), (40, "magnate", "Магнат"),
              (50, "legend", "Легенда района"), (75, "master", "Хозяин города"), (100, "icon", "Икона города"),
              (150, "myth", "Миф")]
TITLES_SPECIAL = {"streak7": "Завсегдатай", "streak30": "Старожил", "founder": "Основатель клана",
                  "flag": "Знаменосец", "lord": "Владыка города", "weekstar": "Звезда недели",
                  "millionaire": "Миллионер", "helper": "Плечо клана"}
NICKS = ["Комета", "Искра", "Вектор", "Сокол", "Байт", "Гром", "Вираж", "Неон", "Турбо", "Зубр", "Барс", "Рысь", "Кедр",
         "Янтарь", "Метеор", "Призрак", "Тайфун", "Форсаж", "Драйв", "Кадр", "Ритм", "Пиксель", "Шторм", "Ветер",
         "Факел", "Дрифт", "Сигнал", "Радар", "Компас", "Маяк", "Пилот", "Штурман", "Север", "Орбита", "Импульс",
         "Квант", "Гранит", "Сапсан", "Беркут", "Кречет"]
NICK_EVERY = 86400
# вход по дням: (игровые $, опыт) — 7 дней по кругу, на седьмой ещё и титул «Завсегдатай»
DAILY = [(1000, 50), (1500, 75), (2500, 100), (3000, 150), (4000, 200), (6000, 250), (10000, 400)]

SCHEMA = """
CREATE TABLE IF NOT EXISTS prog (
    rid TEXT PRIMARY KEY, fid TEXT NOT NULL, xp INTEGER NOT NULL DEFAULT 0, lvl INTEGER NOT NULL DEFAULT 1,
    nick_w INTEGER NOT NULL DEFAULT -1, nick_n INTEGER NOT NULL DEFAULT 0, nick_at INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL DEFAULT '', titles TEXT NOT NULL DEFAULT '[]',
    day INTEGER NOT NULL DEFAULT 0, day_xp TEXT NOT NULL DEFAULT '{}', last TEXT NOT NULL DEFAULT '{}',
    streak INTEGER NOT NULL DEFAULT 0, streak_day INTEGER NOT NULL DEFAULT 0, streak_best INTEGER NOT NULL DEFAULT 0,
    ach_n INTEGER NOT NULL DEFAULT 0, worth INTEGER NOT NULL DEFAULT 0, seeded INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS prog_fid ON prog (fid);
CREATE INDEX IF NOT EXISTS prog_xp ON prog (xp DESC);
CREATE INDEX IF NOT EXISTS prog_worth ON prog (worth DESC);
CREATE TABLE IF NOT EXISTS prog_city (rid TEXT NOT NULL, city TEXT NOT NULL, xp INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (rid, city));
CREATE TABLE IF NOT EXISTS prog_week (week INTEGER NOT NULL, rid TEXT NOT NULL, city TEXT NOT NULL,
    xp INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (week, rid, city));
CREATE TABLE IF NOT EXISTS biz_week (week INTEGER NOT NULL, rid TEXT NOT NULL, city TEXT NOT NULL,
    paid INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (week, rid, city));
CREATE TABLE IF NOT EXISTS biz_total (rid TEXT NOT NULL, city TEXT NOT NULL, paid INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (rid, city));
CREATE TABLE IF NOT EXISTS infl_me (week INTEGER NOT NULL, city TEXT NOT NULL, rid TEXT NOT NULL,
    pts REAL NOT NULL DEFAULT 0, PRIMARY KEY (week, city, rid));
CREATE TABLE IF NOT EXISTS ach (rid TEXT NOT NULL, id TEXT NOT NULL, rarity TEXT NOT NULL DEFAULT 'common',
    at INTEGER NOT NULL, PRIMARY KEY (rid, id));
CREATE INDEX IF NOT EXISTS ach_id ON ach (id);
"""

_ready: set[int] = set()
_sync_t: dict[str, float] = {}
_cache: dict[tuple, tuple[float, object]] = {}
on_level = []                 # app.py: обновить табличку игрока в онлайне (уровень над головой) — fn(rid)


def ensure(store) -> None:
    if id(store) in _ready:
        return
    import realty                                   # props/biz/season_* — их схема нужна для миграции
    realty.ensure(store)
    with store.lock:
        store.db.executescript(SCHEMA)
        import nicks
        nicks.ensure(store.db)
        store.db.execute("""INSERT OR IGNORE INTO biz_total (rid, city, paid)
                            SELECT owner_rid, city, sum(earned) FROM biz GROUP BY owner_rid, city""")
        store.db.execute("""INSERT OR IGNORE INTO infl_me (week, city, rid, pts)
                            SELECT week, city, rid, pts FROM season_me""")
    _ready.add(id(store))


def day_of(now: float) -> int:
    return int((now + TZ) // 86400)


def week_of(now: float | None = None) -> int:
    import modes
    return modes.week_of(now)


def fid_of(rid: str) -> str:
    import modes                                    # тот же хэш, что у друзей (modes.Modes.fid): соль — ключ админки
    return hashlib.sha256((modes.admin_key() + ":" + rid).encode()).hexdigest()[:12]


def nick_of(row, db=None) -> str:
    """Ник игрока для других. С db — свой ник (nicks.py), если игрок его выбрал; без db или без своего — слово + число."""
    if db is not None:
        import nicks
        own = nicks.get(db, row["rid"])
        if own:
            return own
    w, n = int(row["nick_w"]), int(row["nick_n"])
    if w < 0:
        h = int(row["fid"][:8], 16)
        w, n = h % len(NICKS), 10 + (h >> 8) % 90
    return f"{NICKS[w % len(NICKS)]}-{n}"


def _js(v, d):
    try:
        x = json.loads(v) if v else d
        return x if isinstance(x, type(d)) else d
    except ValueError:
        return d


# ---------------------------------------------------------------------------------------------------------------
# строка игрока, опыт (все функции с db — под store.lock у вызывающего)
# ---------------------------------------------------------------------------------------------------------------
def row_of(db, rid: str, now: float | None = None):
    """Строка prog; нет — заводим и заводим опыт из честного прошлого (honest: заработок и минуты игры)."""
    r = db.execute("SELECT * FROM prog WHERE rid = ?", (rid,)).fetchone()
    if r:
        return r
    now = time.time() if now is None else now
    seed = 0
    try:
        h = db.execute("SELECT earned, playmin, cheat FROM honest WHERE rid = ?", (rid,)).fetchone()
    except Exception:                               # noqa: BLE001 — таблицы режимов ещё нет (тесты без modes.db)
        h = None
    if h and int(h["cheat"] or 0) < 3:
        seed = int(min(need(SEED_LVL), float(h["earned"] or 0) / 40.0 + float(h["playmin"] or 0) * 15.0))
    db.execute("""INSERT OR IGNORE INTO prog (rid, fid, xp, lvl, seeded, created_at, updated_at)
                  VALUES (?, ?, ?, ?, 1, ?, ?)""", (rid, fid_of(rid), seed, lvl_of(seed), int(now), int(now)))
    return db.execute("SELECT * FROM prog WHERE rid = ?", (rid,)).fetchone()


def xp(db, rid: str, src: str, city: str | None, now: float | None = None, amount: float | None = None,
       times: int = 1) -> int:
    """Начислить опыт источника (сервер решает сколько). Возвращает начисленное (0 — потолок)."""
    if src not in SRC or not rid or rid.startswith("g-"):
        return 0
    now = time.time() if now is None else now
    ensure_tables(db)
    r = row_of(db, rid, now)
    per, _every, cap, _client = SRC[src]
    want = float(amount) if amount is not None else float(per) * max(0, int(times))
    if want <= 0:
        return 0
    day = day_of(now)
    dx = _js(r["day_xp"], {}) if int(r["day"]) == day else {}
    used_src, used_all = float(dx.get(src, 0)), float(dx.get("_", 0))
    got = int(max(0.0, min(want, cap - used_src, DAY_CAP - used_all)))
    if got <= 0:
        return 0
    dx[src] = used_src + got
    dx["_"] = used_all + got
    total = int(r["xp"]) + got
    lvl = lvl_of(total)
    db.execute("UPDATE prog SET xp = ?, lvl = ?, day = ?, day_xp = ?, updated_at = ? WHERE rid = ?",
               (total, lvl, day, json.dumps(dx, separators=(",", ":")), int(now), rid))
    c = city if city in CITIES else "flame"
    db.execute("""INSERT INTO prog_city (rid, city, xp) VALUES (?, ?, ?)
                  ON CONFLICT(rid, city) DO UPDATE SET xp = prog_city.xp + excluded.xp""", (rid, c, got))
    db.execute("""INSERT INTO prog_week (week, rid, city, xp) VALUES (?, ?, ?, ?)
                  ON CONFLICT(week, rid, city) DO UPDATE SET xp = prog_week.xp + excluded.xp""", (week_of(now), rid, c, got))
    if src != "crew":
        import crews                                 # цель клана «опыт вместе»
        crews.goal_add(db, rid, "xp", got, now)
    if lvl != int(r["lvl"]):
        _changed.add(rid)
    return got


_changed: set[str] = set()                           # у кого сменился уровень — app.py обновит табличку в онлайне


def take_changed() -> list[str]:
    out = list(_changed)
    _changed.clear()
    return out


def client_gains(db, rid: str, gains: dict, city: str, now: float) -> dict:
    """Опыт от клиента: {источник: сколько раз} → сколько раз засчитали по частоте источника → опыт с потолками."""
    r = row_of(db, rid, now)
    last = _js(r["last"], {})
    out = {}
    for src, n in list(gains.items())[:16]:
        if src not in SRC or not SRC[src][3] or not isinstance(n, int) or isinstance(n, bool) or n <= 0:
            continue
        every = SRC[src][1]
        since = now - float(last.get(src, 0))
        allowed = max(1, int(since // every)) if every else n
        times = min(n, allowed, 50)
        got = xp(db, rid, src, city, now, times=times)
        last[src] = now
        if got:
            out[src] = got
    db.execute("UPDATE prog SET last = ? WHERE rid = ?", (json.dumps({k: int(v) for k, v in last.items()}), rid))
    return out


def add_ach(db, rid: str, items: list, city: str, now: float) -> tuple[int, list[str]]:
    """Достижения от клиента: id по шаблону, редкость → опыт (потолок «ach» за сутки), не больше ACH_MAX на игрока."""
    have = int(db.execute("SELECT count(*) AS n FROM ach WHERE rid = ?", (rid,)).fetchone()["n"])
    got_xp, ok = 0, []
    for it in items[:40]:
        if not (isinstance(it, list) and len(it) == 2 and isinstance(it[0], str) and ACH_RE.fullmatch(it[0])):
            continue
        aid, rar = it[0], it[1] if it[1] in ACH_XP else "common"
        if have >= ACH_MAX:
            break
        cur = db.execute("INSERT OR IGNORE INTO ach (rid, id, rarity, at) VALUES (?, ?, ?, ?)", (rid, aid, rar, int(now)))
        ok.append(aid)
        if cur.rowcount:
            have += 1
            got_xp += xp(db, rid, "ach", city, now, amount=ACH_XP[rar])
    db.execute("UPDATE prog SET ach_n = ? WHERE rid = ?", (have, rid))
    return got_xp, ok


# ---------------------------------------------------------------------------------------------------------------
# крючки других модулей (вызывающий держит store.lock)
# ---------------------------------------------------------------------------------------------------------------
def on_income(db, rid: str, city: str, paid: int, kind: str, now: float | None = None) -> int:
    """Касса или доставка бизнеса (realty.py): выручка недели/всего, опыт, цель клана."""
    if paid <= 0:
        return 0
    now = time.time() if now is None else now
    ensure_tables(db)
    db.execute("""INSERT INTO biz_week (week, rid, city, paid) VALUES (?, ?, ?, ?)
                  ON CONFLICT(week, rid, city) DO UPDATE SET paid = biz_week.paid + excluded.paid""",
               (week_of(now), rid, city, int(paid)))
    db.execute("""INSERT INTO biz_total (rid, city, paid) VALUES (?, ?, ?)
                  ON CONFLICT(rid, city) DO UPDATE SET paid = biz_total.paid + excluded.paid""", (rid, city, int(paid)))
    import crews
    crews.goal_add(db, rid, "biz", paid, now)
    if kind == "run":
        return xp(db, rid, "run", city, now)
    return xp(db, rid, "biz", city, now, amount=min(150.0, 10.0 + paid / 400.0))


def on_infl(db, rid: str, city: str, pts: float, now: float) -> None:
    """Влияние игрока (season._add_pts: max вклада в банду и в клан) — рейтинг «Влияние»."""
    if pts <= 0:
        return
    ensure_tables(db)
    db.execute("""INSERT INTO infl_me (week, city, rid, pts) VALUES (?, ?, ?, ?)
                  ON CONFLICT(week, city, rid) DO UPDATE SET pts = infl_me.pts + excluded.pts""",
               (week_of(now), city, rid, float(pts)))


def on_race(store, rid: str, weekly: bool, rank: int | None) -> None:
    """Гонка до финиша (modes._race_done, время по серверу): опыт; призовое место недели — больше."""
    now = time.time()
    ensure(store)
    with store.lock:
        bonus = 60 if weekly else 0
        if rank and rank <= 3:
            bonus += 60
        xp(store.db, rid, "race", "flame", now, amount=SRC["race"][0] + bonus)
        import crews
        crews.goal_add(store.db, rid, "race", 1, now)


_tables_ok: set[int] = set()


def ensure_tables(db) -> None:
    """Таблицы прогресса для крючков, которые зовут с чужой блокировкой (без realty.ensure — он берёт lock)."""
    if id(db) in _tables_ok:
        return
    db.executescript(SCHEMA)
    _tables_ok.add(id(db))


def worth_of(db, rid: str, data: dict | None = None) -> int:
    """Состояние: наличные + банк (последнее честное сохранение) + цена зданий + вложенное в бизнесы."""
    money = 0.0
    if data is None:
        h = db.execute("SELECT save FROM honest WHERE rid = ?", (rid,)).fetchone()
        data = _js(h["save"], {}) if h else {}
    for k in ("money", "bank"):
        v = data.get(k)
        if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v > 0:
            money += v
    props = db.execute("SELECT COALESCE(sum(price), 0) AS s FROM props WHERE owner_rid = ?", (rid,)).fetchone()["s"]
    inv = db.execute("SELECT COALESCE(sum(invested), 0) AS s FROM biz WHERE owner_rid = ?", (rid,)).fetchone()["s"]
    return int(min(2_000_000_000, money + float(props) + float(inv)))


def on_save(store, rid: str, data: dict) -> None:
    """Принятое честное сохранение (app.save): пересчитать состояние для рейтинга."""
    ensure(store)
    with store.lock:
        row_of(store.db, rid)
        store.db.execute("UPDATE prog SET worth = ? WHERE rid = ?", (worth_of(store.db, rid, data), rid))


# ---------------------------------------------------------------------------------------------------------------
# вход по дням, титулы, ник
# ---------------------------------------------------------------------------------------------------------------
def daily_state(r, now: float) -> dict:
    day = day_of(now)
    last, streak = int(r["streak_day"]), int(r["streak"])
    can = last != day
    nxt = (streak + 1) if last == day - 1 else 1
    if not can:
        nxt = streak
    i = (nxt - 1) % 7
    return {"can": can, "streak": streak if not can else (streak if last == day - 1 else 0), "next": nxt,
            "day": i + 1, "money": DAILY[i][0], "xp": DAILY[i][1], "table": DAILY, "best": int(r["streak_best"])}


def claim_daily(store, rid: str, now: float | None = None, credit=None) -> dict:
    now = time.time() if now is None else now
    ensure(store)
    with store.lock:
        db = store.db
        r = row_of(db, rid, now)
        day = day_of(now)
        if int(r["streak_day"]) == day:
            return {"ok": False, "already": True, "daily": daily_state(r, now)}
        streak = int(r["streak"]) + 1 if int(r["streak_day"]) == day - 1 else 1
        i = (streak - 1) % 7
        money, x = DAILY[i]
        titles = _js(r["titles"], [])
        if streak >= 7 and "streak7" not in titles:
            titles.append("streak7")
        if streak >= 30 and "streak30" not in titles:
            titles.append("streak30")
        db.execute("UPDATE prog SET streak = ?, streak_day = ?, streak_best = max(streak_best, ?), titles = ? WHERE rid = ?",
                   (streak, day, streak, json.dumps(titles), rid))
        got = xp(db, rid, "login", None, now, amount=x)
        r = db.execute("SELECT * FROM prog WHERE rid = ?", (rid,)).fetchone()
    if credit:
        credit(rid, money)
    return {"ok": True, "streak": streak, "day": i + 1, "paid": money, "xp": got, "daily": daily_state(r, now)}


def titles_of(db, r, now: float) -> list[dict]:
    lvl = int(r["lvl"])
    out = [{"id": tid, "name": name, "lvl": need_l, "got": lvl >= need_l} for need_l, tid, name in TITLES_LVL]
    have = set(_js(r["titles"], []))
    import crews
    import war
    cr = crews.crew_of(db, r["rid"])
    if cr:
        held = war.held_by(db, cr["id"])
        if held:
            have.add("flag")
        for c in CITIES:
            n_c = sum(1 for h in held if h[0] == c)
            if n_c and n_c * 2 >= war.n_dists(c):
                have.add("lord")
    if int(r["worth"]) >= 1_000_000:
        have.add("millionaire")
    wk = week_of(now) - 1
    top = db.execute("""SELECT rid FROM prog_week WHERE week = ? GROUP BY rid ORDER BY sum(xp) DESC LIMIT 10""",
                     (wk,)).fetchall()
    if any(x["rid"] == r["rid"] for x in top):
        have.add("weekstar")
    for k, name in TITLES_SPECIAL.items():
        out.append({"id": k, "name": name, "special": True, "got": k in have})
    return out


def title_name(db, r, now: float) -> str:
    t = r["title"]
    if t:
        for x in titles_of(db, r, now):
            if x["id"] == t and x["got"]:
                return x["name"]
    lvl = int(r["lvl"])
    name = TITLES_LVL[0][2]
    for need_l, _tid, n in TITLES_LVL:
        if lvl >= need_l:
            name = n
    return name


# ---------------------------------------------------------------------------------------------------------------
# профиль
# ---------------------------------------------------------------------------------------------------------------
def _medals(db, rid: str) -> dict:
    try:
        rows = db.execute("SELECT place, count(*) AS n FROM weekly_winners WHERE rid = ? AND place > 0 GROUP BY place",
                          (rid,)).fetchall()
    except Exception:                               # noqa: BLE001 — таблицы гонок ещё нет
        rows = []
    m = {int(x["place"]): int(x["n"]) for x in rows}
    try:
        races = int(db.execute("SELECT count(*) AS n FROM races WHERE rid = ?", (rid,)).fetchone()["n"])
    except Exception:                               # noqa: BLE001
        races = 0
    return {"gold": m.get(1, 0), "silver": m.get(2, 0), "bronze": m.get(3, 0), "races": races}


def public(db, r, now: float, full: bool = False) -> dict:
    rid = r["rid"]
    wk = week_of(now)
    cre = db.execute("SELECT creature FROM players WHERE rid = ?", (rid,)).fetchone()
    bw = db.execute("SELECT COALESCE(sum(paid), 0) AS s FROM biz_week WHERE rid = ? AND week = ?", (rid, wk)).fetchone()["s"]
    bt = db.execute("SELECT COALESCE(sum(paid), 0) AS s FROM biz_total WHERE rid = ?", (rid,)).fetchone()["s"]
    iw = db.execute("SELECT COALESCE(sum(pts), 0) AS s FROM infl_me WHERE rid = ? AND week = ?", (rid, wk)).fetchone()["s"]
    ia = db.execute("SELECT COALESCE(sum(pts), 0) AS s FROM infl_me WHERE rid = ?", (rid,)).fetchone()["s"]
    nb = db.execute("SELECT count(*) AS n FROM biz WHERE owner_rid = ?", (rid,)).fetchone()["n"]
    npr = db.execute("SELECT count(*) AS n FROM props WHERE owner_rid = ?", (rid,)).fetchone()["n"]
    lvl, x = int(r["lvl"]), int(r["xp"])
    import crews
    cr = crews.crew_of(db, rid)
    out = {"fid": r["fid"], "nick": nick_of(r, db), "cre": cre["creature"] if cre else None, "lvl": lvl, "xp": x,
           "cur": need(lvl), "next": need(lvl + 1), "title": title_name(db, r, now), "worth": int(r["worth"]),
           "biz_week": int(bw), "biz_all": int(bt), "biz_n": int(nb), "props_n": int(npr),
           "infl_week": round(float(iw)), "infl_all": round(float(ia)), "medals": _medals(db, rid),
           "ach_n": int(r["ach_n"]), "streak_best": int(r["streak_best"]), "since": int(r["created_at"]),
           "crew": ({"id": cr["id"], "tag": cr["tag"], "name": cr["name"], "color": cr["color"], "emblem": cr["emblem"],
                     "role": cr["role"]} if cr else None)}
    if full:
        out["titles"] = titles_of(db, r, now)
        out["title_id"] = r["title"]
        out["daily"] = daily_state(r, now)
        dx = _js(r["day_xp"], {}) if int(r["day"]) == day_of(now) else {}
        out["today"] = {"xp": int(dx.get("_", 0)), "cap": DAY_CAP}
        out["ach"] = [x["id"] for x in db.execute("SELECT id FROM ach WHERE rid = ? ORDER BY at DESC LIMIT 400", (rid,))]
        out["nick_w"], out["nick_n"] = int(r["nick_w"]), int(r["nick_n"])
        import nicks
        out["name"] = nicks.get(db, rid)                         # свой ник (есть — слово из списка не показывается)
    return out


def me(store, rid: str, now: float | None = None) -> dict:
    now = time.time() if now is None else now
    ensure(store)
    with store.lock:
        r = row_of(store.db, rid, now)
        out = public(store.db, r, now, full=True)
    out["ranks"] = my_ranks(store, rid)
    return out


def profile(store, fid: str, now: float | None = None) -> dict | None:
    now = time.time() if now is None else now
    ensure(store)
    with store.lock:
        r = store.db.execute("SELECT * FROM prog WHERE fid = ?", (fid,)).fetchone()
        if not r:
            return None
        return public(store.db, r, now)


def meta_of(store, rid: str) -> dict:
    """Для таблички над головой в онлайне: fid, уровень, ник, тег и цвет клана."""
    ensure(store)
    with store.lock:
        r = row_of(store.db, rid)
        nick = nick_of(r, store.db)
        import crews
        cr = crews.crew_of(store.db, rid)
    return {"fid": r["fid"], "lvl": int(r["lvl"]), "nick": nick, "tag": cr["tag"] if cr else None,
            "ccol": cr["color"] if cr else None}


# ---------------------------------------------------------------------------------------------------------------
# рейтинги
# ---------------------------------------------------------------------------------------------------------------
BOARDS = ("level", "worth", "biz", "infl", "race", "crew")


def _honest_cut() -> str:
    import modes
    return f"NOT IN (SELECT rid FROM honest WHERE cheat >= {int(modes.CHEAT_TOP)})"


def _board_rows(db, board: str, scope: str, city: str, now: float) -> list[tuple]:
    """[(ключ, значение)] по убыванию (гонка недели — время по возрастанию). Ключ — rid, у кланов — id клана."""
    wk = week_of(now)
    cut = _honest_cut()
    cw = "" if city == "all" else " AND city = ?"
    ca = () if city == "all" else (city,)
    if board == "level":
        if scope == "week":
            q = f"SELECT rid, sum(xp) AS v FROM prog_week WHERE week = ?{cw} AND rid {cut} GROUP BY rid"
            args = (wk,) + ca
        elif city == "all":
            q, args = f"SELECT rid, xp AS v FROM prog WHERE xp > 0 AND rid {cut}", ()
        else:
            q, args = f"SELECT rid, xp AS v FROM prog_city WHERE city = ? AND rid {cut}", (city,)
    elif board == "worth":
        if city == "all":
            q, args = f"SELECT rid, worth AS v FROM prog WHERE worth > 0 AND rid {cut}", ()
        else:
            q = f"SELECT p.rid, p.worth AS v FROM prog p JOIN prog_city c ON c.rid = p.rid AND c.city = ? WHERE p.worth > 0 AND p.rid {cut}"
            args = (city,)
    elif board == "biz":
        if scope == "week":
            q, args = f"SELECT rid, sum(paid) AS v FROM biz_week WHERE week = ?{cw} AND rid {cut} GROUP BY rid", (wk,) + ca
        else:
            q, args = f"SELECT rid, sum(paid) AS v FROM biz_total WHERE 1 = 1{cw} AND rid {cut} GROUP BY rid", ca
    elif board == "infl":
        if scope == "week":
            q, args = f"SELECT rid, sum(pts) AS v FROM infl_me WHERE week = ?{cw} AND rid {cut} GROUP BY rid", (wk,) + ca
        else:
            q, args = f"SELECT rid, sum(pts) AS v FROM infl_me WHERE 1 = 1{cw} AND rid {cut} GROUP BY rid", ca
    elif board == "race":
        try:
            if scope == "week":
                import modes
                t = modes.week_track(wk)
                if not t:
                    return []
                rows = db.execute(f"""SELECT rid, min(ms) AS v FROM races WHERE track = ? AND week = ? AND rid {cut}
                                      GROUP BY rid ORDER BY v LIMIT ?""", (t["id"], wk, TOP_MAX)).fetchall()
                return [(x["rid"], int(x["v"])) for x in rows]
            q = f"""SELECT rid, sum(CASE place WHEN 1 THEN 3 WHEN 2 THEN 2 ELSE 1 END) AS v FROM weekly_winners
                    WHERE place > 0 AND rid IS NOT NULL AND rid {cut} GROUP BY rid"""
            args = ()
        except Exception:                           # noqa: BLE001 — таблиц гонок ещё нет
            return []
    elif board == "crew":
        import crews
        return crews.power_rows(db, scope, city, now)
    else:
        return []
    try:
        rows = db.execute(q + " ORDER BY v DESC LIMIT ?", args + (TOP_MAX,)).fetchall()
    except Exception:                               # noqa: BLE001 — таблицы гонок/honest ещё нет
        return []
    return [(x["rid"], x["v"]) for x in rows if x["v"] and x["v"] > 0]


def _cached(store, board: str, scope: str, city: str) -> tuple[list, dict]:
    key = (id(store), board, scope, city)
    now = time.time()
    hit = _cache.get(key)
    if hit and now - hit[0] < CACHE_S:
        return hit[1]
    with store.lock:
        rows = _board_rows(store.db, board, scope, city, now)
    pos = {k: i + 1 for i, (k, _v) in enumerate(rows)}
    _cache[key] = (now, (rows, pos))
    if len(_cache) > 200:
        _cache.clear()
    return rows, pos


def board_of(store, board_id: str, scope: str, city: str, n: int = 50) -> dict:
    ensure(store)
    rows, _pos = _cached(store, board_id, scope, city)
    top = rows[:max(1, min(100, n))]
    now = time.time()
    out = []
    with store.lock:
        db = store.db
        if board_id == "crew":
            import crews
            for i, (cid, v) in enumerate(top):
                c = crews.card(db, cid)
                if c:
                    out.append(dict(c, pos=i + 1, val=round(v)))
        else:
            for i, (rid, v) in enumerate(top):
                r = db.execute("SELECT p.*, pl.creature FROM prog p LEFT JOIN players pl ON pl.rid = p.rid WHERE p.rid = ?",
                               (rid,)).fetchone()
                if not r:
                    continue
                import crews
                cr = crews.crew_of(db, rid)
                out.append({"pos": i + 1, "fid": r["fid"], "nick": nick_of(r, db), "cre": r["creature"], "lvl": int(r["lvl"]),
                            "tag": cr["tag"] if cr else None, "ccol": cr["color"] if cr else None, "val": round(v)})
    return {"board": board_id, "scope": scope, "city": city, "rows": out, "total": len(rows), "week": week_of(now),
            "asc": board_id == "race" and scope == "week"}


def my_ranks(store, rid: str) -> dict:
    """Мои места: {доска: {week|all: {city: место}}} — по кэшу рейтингов (обновляется раз в CACHE_S)."""
    import crews
    with store.lock:
        cr = crews.crew_of(store.db, rid)
    out = {}
    for b in BOARDS:
        key = cr["id"] if (b == "crew" and cr) else rid
        if b == "crew" and not cr:
            continue
        out[b] = {}
        for sc in ("week", "all"):
            if b == "worth" and sc == "week":
                continue
            out[b][sc] = {}
            for c in ("all",) + CITIES:
                rows, pos = _cached(store, b, sc, c)
                p = pos.get(key)
                out[b][sc][c] = {"pos": p, "of": len(rows), "val": round(rows[p - 1][1]) if p else 0}
    return out


def ach_stats(store) -> dict:
    key = (id(store), "ach")
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < 600:
        return hit[1]
    ensure(store)
    with store.lock:
        n = int(store.db.execute("SELECT count(*) AS n FROM prog WHERE xp > 0 OR ach_n > 0").fetchone()["n"])
        rows = store.db.execute("SELECT id, count(*) AS c FROM ach GROUP BY id").fetchall()
    d = {"players": n, "share": {x["id"]: round(100.0 * x["c"] / max(1, n), 1) for x in rows}}
    _cache[key] = (time.time(), d)
    return d


# ---------------------------------------------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------------------------------------------
def make_router(get_store, verify, read_body, modes_obj=None, changed=None) -> APIRouter:
    """changed(rids) — async: уровень сменился, обновить табличку в онлайне (app.refresh_meta)."""
    r = APIRouter()
    credit = getattr(modes_obj, "credit", None)

    async def who(body: dict) -> str:
        rid = await verify(body.get("token") or "")
        if not rid:
            raise HTTPException(401, "войди своим агентом — опыт и рейтинг хранятся за ним")
        return rid

    async def notify():
        ch = take_changed()
        if ch and changed:
            await changed(ch)

    @r.post("/g/prog/sync")
    async def sync(request: Request):
        body = await read_body(request)
        rid = await who(body)
        city = body.get("city") if body.get("city") in CITIES else "flame"
        now = time.time()
        if now - _sync_t.get(rid, -1e9) < SYNC_EVERY:
            raise HTTPException(429, "не чаще раза в 15 секунд")
        _sync_t[rid] = now
        if len(_sync_t) > 50000:
            _sync_t.clear()
        gains = body.get("gains") if isinstance(body.get("gains"), dict) else {}
        items = body.get("ach") if isinstance(body.get("ach"), list) else []
        st = get_store()

        def run():
            ensure(st)
            with st.lock:
                got = client_gains(st.db, rid, gains, city, now)
                ax, ok = add_ach(st.db, rid, items, city, now) if items else (0, [])
                rr = st.db.execute("SELECT * FROM prog WHERE rid = ?", (rid,)).fetchone()
                dx = _js(rr["day_xp"], {}) if int(rr["day"]) == day_of(now) else {}
                return {"ok": True, "gained": got, "ach_xp": ax, "ach_ok": ok, "xp": int(rr["xp"]), "lvl": int(rr["lvl"]),
                        "cur": need(int(rr["lvl"])), "next": need(int(rr["lvl"]) + 1), "today": int(dx.get("_", 0)),
                        "cap": DAY_CAP, "daily": daily_state(rr, now)}
        out = await asyncio.to_thread(run)
        await notify()
        return out

    @r.post("/g/prog/me")
    async def prog_me(request: Request):
        body = await read_body(request)
        rid = await who(body)
        out = await asyncio.to_thread(me, get_store(), rid)
        await notify()
        return out

    @r.post("/g/prog/daily")
    async def prog_daily(request: Request):
        body = await read_body(request)
        rid = await who(body)
        out = await asyncio.to_thread(claim_daily, get_store(), rid, None, credit)
        await notify()
        return out

    @r.post("/g/prog/title")
    async def prog_title(request: Request):
        body = await read_body(request)
        rid = await who(body)
        t = body.get("title")
        if not isinstance(t, str) or len(t) > 16:
            raise HTTPException(400, "title — id титула")
        st = get_store()

        def run():
            ensure(st)
            with st.lock:
                rr = row_of(st.db, rid)
                if t and not any(x["id"] == t and x["got"] for x in titles_of(st.db, rr, time.time())):
                    raise HTTPException(403, "этот титул ещё не открыт")
                st.db.execute("UPDATE prog SET title = ? WHERE rid = ?", (t, rid))
                rr = row_of(st.db, rid)
                return {"ok": True, "title": title_name(st.db, rr, time.time())}
        return await asyncio.to_thread(run)

    @r.post("/g/prog/nick")
    async def prog_nick(request: Request):
        body = await read_body(request)
        rid = await who(body)
        w, n = body.get("w"), body.get("n")
        if not (isinstance(w, int) and 0 <= w < len(NICKS) and isinstance(n, int) and 1 <= n <= 99):
            raise HTTPException(400, "ник — слово из списка и число 1–99")
        st = get_store()

        def run():
            ensure(st)
            with st.lock:
                rr = row_of(st.db, rid)
                if time.time() - int(rr["nick_at"]) < NICK_EVERY:
                    raise HTTPException(429, "ник можно менять раз в сутки")
                st.db.execute("UPDATE prog SET nick_w = ?, nick_n = ?, nick_at = ? WHERE rid = ?", (w, n, int(time.time()), rid))
                _changed.add(rid)
                return {"ok": True, "nick": nick_of(row_of(st.db, rid))}
        out = await asyncio.to_thread(run)
        await notify()
        return out

    @r.get("/g/profile")
    async def prof(resp: Response, fid: str = ""):
        if not re.fullmatch(r"[0-9a-f]{12}", fid or ""):
            raise HTTPException(400, "fid — 12 знаков")
        p = await asyncio.to_thread(profile, get_store(), fid)
        if not p:
            raise HTTPException(404, "такого игрока нет")
        resp.headers["Cache-Control"] = "public, max-age=30"
        return p

    @r.get("/g/ranks")
    async def ranks(resp: Response, board: str = "level", scope: str = "all", city: str = "all", n: int = 50):
        if board not in BOARDS or scope not in ("week", "all") or city not in ("all",) + CITIES:
            raise HTTPException(400, "board/scope/city — из списка")
        resp.headers["Cache-Control"] = "public, max-age=30"
        return await asyncio.to_thread(board_of, get_store(), board, scope, city, n)

    @r.get("/g/ach/stats")
    async def achs(resp: Response):
        resp.headers["Cache-Control"] = "public, max-age=600"
        return await asyncio.to_thread(ach_stats, get_store())

    return r
