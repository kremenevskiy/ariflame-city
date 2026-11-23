"""Календарь недели Флейм-Сити: бонусы, скидка, гонка недели, событие недели — один на всех игроков.

Задача: «реализм как в GTA, то, что будут стримить и клипать». Ресерч (GTA Online, CoC, Last War):
игроков возвращает общий ритм — еженедельные бонусы ×2, скидки, «гонка недели», события по дням и выходным. Поэтому
календарь считает сервер из сида недели: у всех игроков одинаковый, без базы и без ручного расписания.

  GET /g/events        → {week, iso, starts, ends, next_in, theme, bonuses[], race, days[7], weekend_mult, next}

Неделя — modes.week_of() (понедельник 00:00 UTC, тот же номер, что у гонки недели); сид — sha256("fc-week-<номер>"),
так что календарь детерминирован: одинаков при перезапуске, на любом стенде и в тестах. Клиент (client/fevents.js)
кэширует ответ до конца недели; сервер недоступен — бонусов нет, события города идут и без них.

Подключает app.py: `app.include_router(events.router())`.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import random
import time

from fastapi import APIRouter, Response

import modes as fcmodes

# Работы и за что платят: ключ, «за что» (в подписи), регулярка начала причины FC.money(…, why) у клиента, значок.
JOBS = [
    ("taxi", "такси", "^такси", "🚕"),
    ("courier", "доставку", "^курьер", "📦"),
    ("shift", "смены на работе", "^смена: ", "💼"),
    ("stunts", "трюки на машине", "^трюки", "🤸"),
    ("race", "гонки", "^гонка", "🏁"),
    ("heist", "ограбления", "^(ограбление|налёт)", "💰"),
    ("events", "события города", "^событие", "🎪"),
    ("turf", "районы банд", "^(захват|оборона)", "🚩"),
    ("biz", "выручку бизнесов", "^выручка", "🏪"),
    ("daily", "задания дня", "^(задание дня|все задания дня)", "📅"),
]
JOB = {j[0]: j for j in JOBS}
# Скидки — магазины, цены которых держит клиент (fweap.js: Оружейная «Искромёт»): ключ, что, значок.
SHOPS = [("guns", "оружие в «Искромёте»", "🎯"), ("ammo", "патроны", "📦"), ("armor", "броню и аптечки", "🦺")]
SHOP = {s[0]: s for s in SHOPS}
# События города (fevents.js): ключ, название, значок. Новое событие — в конец (номер не важен, ключ — да).
EVENTS = [
    ("armored", "Инкассатор", "🚚"),
    ("streetrace", "Уличный вызов", "🏎️"),
    ("celebrity", "Звезда в городе", "🌟"),
    ("flashmob", "Флешмоб", "💃"),
    ("tourist", "Потерянный турист", "🧳"),
    ("foodtruck", "Фудтрак-ажиотаж", "🌮"),
]
EVENT = {e[0]: e for e in EVENTS}
# Темы недели: название, значок, строка в «Афише», работы на ×2 (одна из), событие недели.
THEMES = [
    ("Неделя скорости", "🏎️", "Город гоняет: трассы, трюки и уличные вызовы", ["race", "stunts"], "streetrace"),
    ("Неделя стрелка", "🎯", "В «Искромёте» завоз — и патрулю есть чем заняться", ["heist", "turf"], "armored"),
    ("Неделя курьера", "📦", "Заказы рекой: доставка и такси платят больше", ["courier", "taxi"], "foodtruck"),
    ("Звёздная неделя", "🌟", "В городе снимают кино — лови звёзд объективом", ["events", "daily"], "celebrity"),
    ("Неделя улиц", "💃", "Флешмобы у достопримечательностей и вечеринки до утра", ["events", "shift"], "flashmob"),
    ("Неделя гостей", "🧳", "Туристы теряются на каждом углу — проводи и заработай", ["taxi", "events"], "tourist"),
    ("Неделя бизнеса", "🏪", "Касса звенит: выручка бизнесов и смены", ["biz", "shift"], "foodtruck"),
    ("Неделя банд", "🚩", "Районы делят заново — оборона и захват", ["turf", "heist"], "armored"),
]
DAY = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
SALE = [20, 25, 30, 40]
WEEKEND_MULT = 1.5
EPOCH = 345600                       # 1970-01-05 — понедельник; как modes.week_of
WEEK_S = 604800


def _rng(week: int) -> random.Random:
    seed = int.from_bytes(hashlib.sha256(f"fc-week-{week}".encode()).digest()[:8], "big")
    return random.Random(seed)


def _date(ts: float) -> dt.date:
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).date()


def calendar(week: int) -> dict:
    """Календарь недели по номеру — чистая функция (тесты сверяют детерминированность и состав)."""
    r = _rng(week)
    theme = THEMES[r.randrange(len(THEMES))]
    main = JOB[r.choice(theme[3])]
    rest = [j for j in JOBS if j[0] != main[0]]
    second = rest[r.randrange(len(rest))]
    shop = SHOPS[r.randrange(len(SHOPS))]
    pct = r.choice(SALE)
    ev = EVENT[theme[4]]
    start = EPOCH + week * WEEK_S
    bonuses = [
        {"kind": "money", "job": main[0], "mult": 2, "match": main[2], "icon": main[3], "title": f"×2 за {main[1]}"},
        {"kind": "money", "job": second[0], "mult": 1.5, "match": second[2], "icon": second[3],
         "title": f"×1,5 за {second[1]}"},
        {"kind": "sale", "shop": shop[0], "pct": pct, "icon": shop[2], "title": f"−{pct}% на {shop[1]}"},
        {"kind": "event", "event": ev[0], "mult": 2, "icon": ev[2], "title": f"Событие недели «{ev[1]}» — награда ×2"},
    ]
    # дни: каждый день недели чаще идёт своё событие (без повтора подряд), выходные — награды событий ×1,5
    order = [e[0] for e in EVENTS]
    r.shuffle(order)
    days = []
    for d in range(7):
        e = EVENT[order[d % len(order)]]
        days.append({"d": d, "date": _date(start + d * 86400).isoformat(), "event": e[0], "icon": e[2],
                     "title": f"{DAY[d]}: чаще «{e[1]}»" + (" · события ×1,5" if d >= 5 else "")})
    tr = fcmodes.week_track(week)
    iy, iw, _ = _date(start).isocalendar()
    return {"week": week, "iso": f"{iy}-W{iw:02d}", "starts": _date(start).isoformat(),
            "ends": _date(start + 6 * 86400).isoformat(), "theme": {"name": theme[0], "icon": theme[1], "text": theme[2]},
            "bonuses": bonuses, "race": {"id": tr["id"], "name": tr.get("name") or tr["id"]} if tr else None,
            "days": days, "weekend_mult": WEEKEND_MULT}


def router() -> APIRouter:
    rt = APIRouter()

    @rt.get("/g/events")
    def events(resp: Response):
        now = time.time()
        w = fcmodes.week_of(now)
        out = calendar(w)
        out["next_in"] = int(EPOCH + (w + 1) * WEEK_S - now)
        nxt = calendar(w + 1)
        out["next"] = {"theme": nxt["theme"], "titles": [b["title"] for b in nxt["bonuses"]]}
        resp.headers["Cache-Control"] = "public, max-age=300"
        return out

    return rt
