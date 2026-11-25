"""Город в цифрах (25.11.2026, слово владельца: «чтобы было видно, сколько игроков было на сервере, сколько заходило,
сколько онлайн сейчас» — на странице статуса и рядом с «Сделать правку»).

Только счётчики, без людей: ни rid, ни ников наружу не уходит.
  visitors   — каждый, кто хоть раз заходил в онлайн (вошедший или гость со своим постоянным g-id): первый и последний
               заход, число сеансов. Таблица растёт на одну строку на человека; при создании заполняется из sessions
               (их храним 60 дней) и players — история до 25.11 не теряется.
  stat_day   — рекорд онлайна за минский день; stat_kv — рекорд за всё время.
Сеансы по дням считаются по таблице sessions (app.py) — она уже есть.

  GET /g/stats → {online, cities, peak, peak_all, peak_all_at, players_total, visitors_total, today: {visitors, new,
                  sessions, hours, peak}, days: [{day, visitors, sessions, peak}] × 14}

Подключает app.py: `stats.ensure(store)`; `stats.on_join(store, rid, guest, online)` при входе в онлайн;
`stats.snapshot(store, online, cities, peak)` в /g/stats (кэш 15 с — ручка публичная).
"""
from __future__ import annotations

import time

TZ = 3 * 3600          # минское время: «сегодня» — как у страницы статуса
DAYS = 14
CACHE_S = 15.0

SCHEMA = """
CREATE TABLE IF NOT EXISTS visitors (
    rid TEXT PRIMARY KEY, guest INTEGER NOT NULL DEFAULT 0,
    first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, sessions INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS visitors_first ON visitors (first_at);
CREATE TABLE IF NOT EXISTS stat_day (day TEXT PRIMARY KEY, peak INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS stat_kv (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
"""

_ready: set[int] = set()
_cache: dict[int, dict] = {}            # база → {at, data}: цифры кэшируются на CACHE_S
_peak_seen: dict[str, int] = {}          # день → уже записанный рекорд (чтобы не писать в базу на каждом входе)


def day_of(ts: float) -> str:
    return time.strftime("%Y-%m-%d", time.gmtime(ts + TZ))


def day_start(ts: float) -> int:
    return int((ts + TZ) // 86400 * 86400 - TZ)


def ensure(store) -> None:
    if id(store) in _ready:
        return
    with store.lock:
        store.db.executescript(SCHEMA)
        if not store.db.execute("SELECT 1 FROM visitors LIMIT 1").fetchone():
            # первый запуск: все, кто есть в сеансах (60 дней) и среди вошедших игроков
            store.db.execute("""INSERT OR IGNORE INTO visitors (rid, guest, first_at, last_at, sessions)
                                SELECT rid, max(guest), min(started_at), max(started_at), count(*) FROM sessions GROUP BY rid""")
            store.db.execute("""INSERT OR IGNORE INTO visitors (rid, guest, first_at, last_at, sessions)
                                SELECT rid, 0, created_at, updated_at, 0 FROM players""")
    _ready.add(id(store))


def on_join(store, rid: str, guest: bool, online: int) -> None:
    """Вход в онлайн: человек в visitors, рекорд онлайна дня и всех времён. Зовётся из потока (asyncio.to_thread)."""
    ensure(store)
    now = int(time.time())
    d = day_of(now)
    with store.lock:
        store.db.execute("""INSERT INTO visitors (rid, guest, first_at, last_at, sessions) VALUES (?, ?, ?, ?, 1)
                            ON CONFLICT(rid) DO UPDATE SET last_at = excluded.last_at, sessions = visitors.sessions + 1,
                              guest = min(visitors.guest, excluded.guest)""", (rid, int(guest), now, now))
        if online > _peak_seen.get(d, 0):
            store.db.execute("""INSERT INTO stat_day (day, peak) VALUES (?, ?)
                                ON CONFLICT(day) DO UPDATE SET peak = max(stat_day.peak, excluded.peak)""", (d, online))
            _peak_seen.clear()
            _peak_seen[d] = int(store.db.execute("SELECT peak FROM stat_day WHERE day = ?", (d,)).fetchone()[0])
            r = store.db.execute("SELECT v FROM stat_kv WHERE k = 'peak_all'").fetchone()
            if not r or online > r[0]:
                store.db.execute("INSERT OR REPLACE INTO stat_kv (k, v) VALUES ('peak_all', ?)", (online,))
                store.db.execute("INSERT OR REPLACE INTO stat_kv (k, v) VALUES ('peak_all_at', ?)", (now,))


def snapshot(store, online: int, cities: dict, peak: int) -> dict:
    """Цифры для страницы. Тяжёлое (сеансы по дням) — раз в 15 с; онлайн — всегда живой."""
    now = time.time()
    C = _cache.setdefault(id(store), {"at": 0.0, "data": None})
    if C["data"] is None or now - C["at"] > CACHE_S:
        ensure(store)
        t0 = day_start(now)
        since = t0 - (DAYS - 1) * 86400
        with store.lock:
            q = store.db.execute
            total = int(q("SELECT count(*) FROM visitors").fetchone()[0])
            players = int(q("SELECT count(*) FROM players").fetchone()[0])
            new_today = int(q("SELECT count(*) FROM visitors WHERE first_at >= ?", (t0,)).fetchone()[0])
            # часы в городе сегодня; сеанс без конца (сервер перезапускали посреди игры) считаем не длиннее 3 ч
            hours = q("""SELECT sum(min(coalesce(ended_at, started_at + 10800), ?) - max(started_at, ?)) FROM sessions
                         WHERE started_at >= ? AND coalesce(ended_at, started_at + 10800) > ?""",
                      (int(now), t0, t0 - 86400, t0)).fetchone()[0] or 0
            rows = q("""SELECT (started_at + ?) / 86400 AS d, count(DISTINCT rid) AS v, count(*) AS s FROM sessions
                        WHERE started_at >= ? GROUP BY d""", (TZ, since)).fetchall()
            peaks = {r[0]: int(r[1]) for r in q("SELECT day, peak FROM stat_day WHERE day >= ?", (day_of(since),)).fetchall()}
            kv = {r[0]: int(r[1]) for r in q("SELECT k, v FROM stat_kv").fetchall()}
        by = {int(r[0]): (int(r[1]), int(r[2])) for r in rows}
        days = []
        for i in range(DAYS):
            ts = since + i * 86400
            v, s = by.get(int((ts + TZ) // 86400), (0, 0))
            days.append({"day": day_of(ts), "visitors": v, "sessions": s, "peak": peaks.get(day_of(ts), 0)})
        C.update(at=now, data={"players_total": players, "visitors_total": total, "new_today": new_today,
                                    "hours_today": round(max(0, hours) / 3600, 1), "days": days, "kv": kv})
    D = C["data"]
    kv = D["kv"]
    today = D["days"][-1]
    peak_all = max(kv.get("peak_all", 0), online)
    return {
        "online": online, "cities": cities, "peak": peak,
        "peak_all": peak_all, "peak_all_at": kv.get("peak_all_at") if peak_all > online else int(now),
        "players_total": D["players_total"], "visitors_total": max(D["visitors_total"], online),
        "today": {"visitors": today["visitors"], "new": D["new_today"], "sessions": today["sessions"],
                  "hours": D["hours_today"], "peak": max(today["peak"], online)},
        "days": D["days"],
    }
