"""«Передел» — недельный сезон районов Флейм-Сити и Минска 1:1: банды игроков набирают влияние, район — за сильнейшей.

Ресёрч (territory_ownership_business_mechanics.md, п. 1, 2, 7): сезон по расписанию, расширяться — только в соседние районы
от своих (правило флагов Rise of Kingdoms), владение районом — неотчуждаемый бафф (+10% к кассе бизнесов банды в нём),
а не отъём чужого дохода; призы — только игровые. Банды — те же три, что в fgang.js. Таблицы season_* создаёт
realty.ensure (одна схема с props/biz); ручки /g/season* — в realty.make_router, клиент — client/fseason.js.
Влияние: касса и доставки бизнесов (realty.py зовёт _add_pts), дела от клиента (act: частота и дневной потолок).
Итоги недели — лениво (_holders): первый запрос новой недели подводит прошлую.
"""
from __future__ import annotations

import time

from fastapi import HTTPException

CITIES = ("flame", "minsk")


def _ensure(store) -> None:
    import realty                                     # схема — общая с props/biz (без цикла импорта на уровне модуля)
    realty.ensure(store)


# ---------------------------------------------------------------------------------------------------------------
# «Передел»: районы сезона, соседство, банды
# ---------------------------------------------------------------------------------------------------------------
TEAMS = {"msk": "Красные Звёзды", "minsk": "Зубры", "ala": "Снежные Барсы"}       # те же, что fgang.js
DISTS = {
    "flame": [("center", "Центр", 0, 0), ("msk", "Москва", -481, -481), ("ala", "Алматы", 616, -287),
              ("minsk", "Минск", -118, 670)],
    "minsk": [("center", "Центр", -1300, -450), ("komar", "Комаровка", -300, -2700), ("pobed", "Победителей", -3600, -1300),
              ("kgorka", "Каменная Горка", -9300, -1500), ("sukh", "Сухарево", -8200, 2200),
              ("malin", "Малиновка", -6800, 5000), ("mir", "Мир-Сити", -2600, 4200), ("serebr", "Серебрянка", 1200, 4200),
              ("chizh", "Чижовка", 4500, 6400), ("traktor", "Тракторный", 3000, 1000), ("angar", "Ангарская", 6800, 2000),
              ("vostok", "Восток", 4700, -3600), ("uruch", "Уручье", 8000, -4500), ("zlug", "Зелёный Луг", 1400, -6300)],
}
HOME = {"flame": {"msk": "msk", "minsk": "minsk", "ala": "ala"},
        "minsk": {"msk": "kgorka", "minsk": "chizh", "ala": "uruch"}}
ACT_PTS = {"capture": 25, "defend": 15, "heist": 40, "race": 20, "shift": 3, "taxi": 3, "courier": 3, "coop": 30}
ACT_EVERY = 8.0                                     # дела — не чаще раза в 8 с
ACT_DAY = 600.0                                     # и не больше 600 очков за сутки на игрока
HOLD_BONUS = 0.10                                   # хозяин района: +10% к выручке бизнесов банды в нём
TEAM_EVERY = 7 * 86400


def dist_of(city: str, x: float, z: float) -> str:
    if city == "flame" and x * x + z * z < 260 * 260:
        return "center"                              # как fmap.district: центр — круг 260 м
    best, bd = DISTS[city][0][0], 1e18
    for k, _n, dx, dz in DISTS[city]:
        if city == "flame" and k == "center":
            continue
        d = (x - dx) ** 2 + (z - dz) ** 2
        if d < bd:
            best, bd = k, d
    return best


def _nearest(city: str, x: float, z: float) -> str:
    best, bd = None, 1e18
    for k, _n, dx, dz in DISTS[city]:
        d = (x - dx) ** 2 + (z - dz) ** 2
        if d < bd:
            best, bd = k, d
    return best


def _adjacency(city: str) -> dict[str, list[str]]:
    """Соседи — по граням ячеек Вороного (граф Габриэля): середина отрезка ближе всего к одному из двух концов."""
    out: dict[str, list[str]] = {k: [] for k, *_ in DISTS[city]}
    L = DISTS[city]
    for i, (a, _na, ax, az) in enumerate(L):
        for b, _nb, bx, bz in L[i + 1:]:
            if _nearest(city, (ax + bx) / 2, (az + bz) / 2) in (a, b):
                out[a].append(b)
                out[b].append(a)
    return out


ADJ = {c: _adjacency(c) for c in CITIES}


def week_of(ts: float | None = None) -> int:
    import modes                                      # одна неделя с гонками и рейтингом районов (UTC, понедельник)
    return modes.week_of(ts)


# ---------------------------------------------------------------------------------------------------------------
# «Передел»: хозяева недели (лениво), очки
# ---------------------------------------------------------------------------------------------------------------
def _holders(db, city: str, wk: int) -> dict[str, str | None]:
    rows = db.execute("SELECT dist, team FROM season_hold WHERE week = ? AND city = ?", (wk, city)).fetchall()
    if rows:
        return {r["dist"]: r["team"] for r in rows}
    # недели ещё нет — подводим прошлую: у кого больше очков, тот и хозяин; без очков — прежний хозяин (или родная банда)
    prev_rows = db.execute("""SELECT dist, team FROM season_hold WHERE city = ? AND week =
                                (SELECT max(week) FROM season_hold WHERE city = ? AND week < ?)""",
                           (city, city, wk)).fetchall()
    prev = {r["dist"]: r["team"] for r in prev_rows}
    if not prev:
        prev = {d: t for t, d in HOME[city].items()}
    pts: dict[str, dict[str, float]] = {}
    for r in db.execute("SELECT dist, team, pts FROM season_pts WHERE week = ? AND city = ?", (wk - 1, city)).fetchall():
        pts.setdefault(r["dist"], {})[r["team"]] = float(r["pts"])
    out = {}
    for k, *_ in DISTS[city]:
        p = pts.get(k, {})
        best = max(p.items(), key=lambda kv: (kv[1], kv[0] == prev.get(k)), default=None)
        out[k] = best[0] if best and best[1] > 0 else prev.get(k)
        db.execute("INSERT OR IGNORE INTO season_hold (week, city, dist, team) VALUES (?, ?, ?, ?)", (wk, city, k, out[k]))
    return out


def contestable(city: str, team: str, holders: dict) -> list[str]:
    """Где банда может набирать влияние: родной район, свои районы и их соседи (правило флагов RoK)."""
    own = {d for d, t in holders.items() if t == team} | {HOME[city][team]}
    out = set(own)
    for d in own:
        out.update(ADJ[city][d])
    return sorted(out)


def _team_of(db, rid: str, city: str) -> str | None:
    r = db.execute("SELECT team FROM season_team WHERE rid = ? AND city = ?", (rid, city)).fetchone()
    return r["team"] if r else None


def _add_pts(db, rid: str, city: str, dist: str, pts: float, now: float, from_act: bool = False, src: str = "") -> float:
    """Очки влияния игрока: банде (как раньше) и клану (war.py, 22.11). Возвращает больший из двух вкладов —
    его же пишет рейтинг «Влияние» (progress.on_infl)."""
    team_got = _team_pts(db, rid, city, dist, pts, now, from_act)
    try:                                              # клан и рейтинг — вторичны: их ошибка не ломает кассу и банду
        import progress
        import war
        crew_got = war.add(db, rid, city, dist, pts, now, src) if dist in ADJ.get(city, {}) else 0.0
        got = max(team_got, crew_got)
        progress.on_infl(db, rid, city, got, now)
    except Exception:                                 # noqa: BLE001
        import logging
        logging.getLogger("fcg").exception("влияние клана %s", rid)
        got = team_got
    return got


def _team_pts(db, rid: str, city: str, dist: str, pts: float, now: float, from_act: bool = False) -> float:
    """Очки в район банде игрока, если район ей доступен. Возвращает начисленное (0 — нет банды или не сосед)."""
    team = _team_of(db, rid, city)
    if not team or pts <= 0 or dist not in ADJ[city]:
        return 0.0
    wk = week_of(now)
    if dist not in contestable(city, team, _holders(db, city, wk)):
        return 0.0
    day = int(now // 86400)
    me = db.execute("SELECT day, day_pts FROM season_me WHERE week = ? AND city = ? AND rid = ?", (wk, city, rid)).fetchone()
    if from_act:
        used = float(me["day_pts"]) if me and int(me["day"]) == day else 0.0
        pts = min(pts, max(0.0, ACT_DAY - used))
        if pts <= 0:
            return 0.0
    db.execute("""INSERT INTO season_pts (week, city, dist, team, pts) VALUES (?, ?, ?, ?, ?)
                  ON CONFLICT(week, city, dist, team) DO UPDATE SET pts = season_pts.pts + excluded.pts""",
               (wk, city, dist, team, pts))
    db.execute("""INSERT INTO season_me (week, city, rid, team, pts, day, day_pts) VALUES (?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(week, city, rid) DO UPDATE SET pts = season_me.pts + excluded.pts, team = excluded.team,
                    day_pts = CASE WHEN season_me.day = excluded.day THEN season_me.day_pts + excluded.day_pts
                                   ELSE excluded.day_pts END, day = excluded.day""",
               (wk, city, rid, team, pts, day, pts if from_act else 0.0))
    return pts


def season(store, city: str, now: float | None = None) -> dict:
    _ensure(store)
    import modes
    now = time.time() if now is None else now
    wk = week_of(now)
    with store.lock:
        db = store.db
        holders = _holders(db, city, wk)
        pts: dict[str, dict[str, float]] = {}
        for r in db.execute("SELECT dist, team, pts FROM season_pts WHERE week = ? AND city = ?", (wk, city)).fetchall():
            pts.setdefault(r["dist"], {})[r["team"]] = round(float(r["pts"]))
        top = db.execute("""SELECT m.team, m.pts, p.creature, n.nick FROM season_me m LEFT JOIN players p ON p.rid = m.rid
                            LEFT JOIN nicks n ON n.rid = m.rid
                            WHERE m.week = ? AND m.city = ? ORDER BY m.pts DESC LIMIT 10""", (wk, city)).fetchall()
        members = {r["team"]: int(r["n"]) for r in db.execute(
            "SELECT team, count(*) AS n FROM season_team WHERE city = ? GROUP BY team", (city,)).fetchall()}
    dists = []
    for k, name, x, z in DISTS[city]:
        dists.append({"d": k, "name": name, "x": x, "z": z, "holder": holders.get(k), "pts": pts.get(k, {}),
                      "adj": ADJ[city][k], "home": next((t for t, h in HOME[city].items() if h == k), None)})
    teams = []
    for t, name in TEAMS.items():
        teams.append({"team": t, "name": name, "held": sum(1 for v in holders.values() if v == t),
                      "pts": round(sum(p.get(t, 0) for p in pts.values())), "members": members.get(t, 0),
                      "can": contestable(city, t, holders), "home": HOME[city][t]})
    return {"city": city, "week": wk, "ends_in": modes.week_ends_in(now), "dists": dists, "teams": teams,
            "top": [{"team": r["team"], "pts": round(float(r["pts"])), "creature": r["creature"], "name": r["nick"]} for r in top],
            "bonus": HOLD_BONUS, "acts": ACT_PTS, "day_cap": ACT_DAY}


def set_team(store, rid: str, city: str, team: str, now: float | None = None) -> dict:
    _ensure(store)
    now = time.time() if now is None else now
    with store.lock:
        r = store.db.execute("SELECT team, since FROM season_team WHERE rid = ? AND city = ?", (rid, city)).fetchone()
        if r and r["team"] == team:
            return {"ok": True, "team": team, "since": int(r["since"])}
        if r and now - r["since"] < TEAM_EVERY:
            raise HTTPException(403, "банду в этом городе можно менять раз в неделю")
        store.db.execute("""INSERT INTO season_team (rid, city, team, since) VALUES (?, ?, ?, ?)
                            ON CONFLICT(rid, city) DO UPDATE SET team = excluded.team, since = excluded.since""",
                         (rid, city, team, int(now)))
    return {"ok": True, "team": team, "since": int(now)}


def my_team(store, rid: str, city: str) -> dict:
    _ensure(store)
    with store.lock:
        r = store.db.execute("SELECT team, since FROM season_team WHERE rid = ? AND city = ?", (rid, city)).fetchone()
        wk = week_of()
        me = store.db.execute("SELECT pts FROM season_me WHERE week = ? AND city = ? AND rid = ?", (wk, city, rid)).fetchone()
    return {"team": r["team"] if r else None, "since": int(r["since"]) if r else None,
            "pts": round(float(me["pts"])) if me else 0}


def act(store, rid: str, city: str, kind: str, x: float, z: float, now: float | None = None) -> dict:
    _ensure(store)
    now = time.time() if now is None else now
    d = dist_of(city, x, z)
    import progress
    with store.lock:
        got = _add_pts(store.db, rid, city, d, float(ACT_PTS[kind]), now, from_act=True, src=kind)
        xp = progress.xp(store.db, rid, "district", city, now) if got > 0 else 0
    return {"ok": True, "dist": d, "pts": round(got, 1), "xp": xp}


def _hold_bonus(db, rid: str, city: str, dist: str, now: float) -> float:
    """Бафф хозяина района: банда «Передела» +10% и клан-хозяин из войны за район +10% (war.crew_bonus)."""
    import war
    crew = war.crew_bonus(db, rid, city, dist)
    team = _team_of(db, rid, city)
    if not team or not dist:
        return crew
    return (HOLD_BONUS if _holders(db, city, week_of(now)).get(dist) == team else 0.0) + crew
