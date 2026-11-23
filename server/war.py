"""«Война за район» — кланы игроков делят районы «Передела» по недельному календарю (лёгкий KvK из Rise of Kingdoms).

Ресёрч (territory_ownership_business_mechanics.md, п. 1, 2, 4, 5, 7; раздел 4): держит календарь с фиксированным окном
войны (главная жалоба Last War — «нельзя отлучиться»), расширение только по соседству от своей территории (флаги RoK),
неотчуждаемый бафф хозяину вместо отъёма чужого дохода, тема дня как «Дуэль альянсов». PvP нет: соревнуются доставками,
кассой бизнесов, делами в районе и удержанием флага (стоять у флага района в окно войны — сервер сверяет по позиции из
онлайна, app.where). Призы — только игровые.

Неделя (UTC, понедельник — та же, что у гонок и «Передела», modes.week_of):
  пн–пт — подготовка: влияние клана копится обычным темпом, у каждого дня своя тема ×1,5–×2 (THEMES);
  сб и вс 19:00–21:00 по Минску (16–18 UTC) — окно войны: влияние клана ×2, флаги районов держатся стоянием;
  конец каждого окна — итог: в районе, где клан набрал за неделю больше всех (не меньше FLIP_MIN и на FLIP_K больше
  хозяина), район переходит к нему. Хозяин держит район, пока его не перебьют (новая неделя — новое влияние).
Где клан может набирать влияние: «корни» — свои районы, район штаба, районы зданий соклановцев в этом городе — и их
соседи (season.ADJ). Хозяину района: +10% к кассе бизнесов соклановцев в нём (season._hold_bonus), цвет и флаг клана
на карте, титул «Знаменосец» / «Владыка города» (половина районов), недельная награда (crews.claim «hold»).

Связь со старым «Переделом» (season.py): банды (команды) и их очки живут как были — /g/season для старых клиентов не
изменился. Каждое очко влияния игрока (_add_pts) идёт и в банду (как раньше), и в его клан (сюда), если он в клане.

Таблицы: war_pts (неделя, город, район, клан → очки), war_me (вклад игрока за неделю и за сутки), war_hold (кто держит
район сейчас), war_log (смены хозяев — для «Ленты»), war_eval (до какого момента подведены окна).
HTTP: GET /g/war?city= (районы, хозяева-кланы, лучшие кланы района, окна, тема дня, последние смены — кэш 20 с);
      POST /g/war/me {token, city} (мои районы для влияния, вклад); POST /g/war/hold {token, city, d} (флаг в окно).
"""
from __future__ import annotations

import asyncio
import math
import time

from fastapi import APIRouter, HTTPException, Request, Response

from season import ADJ, CITIES, DISTS

WEEK0 = 345600                # понедельник 1970-01-05, как modes.week_of
WAR_DAYS = (5, 6)             # суббота и воскресенье (с понедельника = 0)
WAR_H = 16                    # 16:00 UTC = 19:00 по Минску
WAR_LEN = 2 * 3600
WAR_K = 2.0                   # влияние клана в окно войны
FLIP_MIN = 250.0              # чтобы забрать район, нужно не меньше…
FLIP_K = 1.15                 # …и на 15% больше хозяина
WAR_DAY = 4000.0              # влияния клану от одного игрока за сутки
HOLD_R = 150.0                # флаг района — центр района, стоять в этом радиусе
HOLD_EVERY = 30.0             # отметка флага — раз в 30 с
HOLD_PTS = 40.0
HOLD_DAY = 1600.0
HOLD_BONUS = 0.10             # +10% к кассе бизнесов соклановцев в районе клана
HQ_K = 0.10                   # штаб: +10% влияния клана в его районе за уровень штаба
THEMES = [                    # тема дня (понедельник = 0): источник влияния → множитель («Дуэль альянсов» RoK)
    ("run", "Доставки заказов", {"run": 1.5}),
    ("biz", "Касса бизнесов", {"biz": 1.5}),
    ("work", "Работа: смены, такси, курьер", {"shift": 2.0, "taxi": 2.0, "courier": 2.0}),
    ("capture", "Захват и оборона точек", {"capture": 1.5, "defend": 1.5}),
    ("heist", "Налёты и гонки", {"heist": 1.5, "race": 1.5, "coop": 1.5}),
    ("war", "Война за район — окно 19:00–21:00", {}),
    ("war", "Война за район — окно 19:00–21:00", {}),
]

SCHEMA = """
CREATE TABLE IF NOT EXISTS war_pts (week INTEGER NOT NULL, city TEXT NOT NULL, dist TEXT NOT NULL, crew INTEGER NOT NULL,
    pts REAL NOT NULL DEFAULT 0, PRIMARY KEY (week, city, dist, crew));
CREATE TABLE IF NOT EXISTS war_me (week INTEGER NOT NULL, city TEXT NOT NULL, rid TEXT NOT NULL, crew INTEGER NOT NULL,
    pts REAL NOT NULL DEFAULT 0, day INTEGER NOT NULL DEFAULT 0, day_pts REAL NOT NULL DEFAULT 0,
    hold_day REAL NOT NULL DEFAULT 0, PRIMARY KEY (week, city, rid));
CREATE TABLE IF NOT EXISTS war_hold (city TEXT NOT NULL, dist TEXT NOT NULL, crew INTEGER, since INTEGER NOT NULL,
    PRIMARY KEY (city, dist));
CREATE TABLE IF NOT EXISTS war_log (id INTEGER PRIMARY KEY AUTOINCREMENT, city TEXT NOT NULL, dist TEXT NOT NULL,
    crew INTEGER, prev INTEGER, pts REAL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS war_eval (city TEXT PRIMARY KEY, last INTEGER NOT NULL);
"""
_ok: set[int] = set()
_hold_t: dict[str, float] = {}
_cache: dict[tuple, tuple[float, dict]] = {}


def ensure_tables(db) -> None:
    if id(db) in _ok:
        return
    db.executescript(SCHEMA)
    _ok.add(id(db))


def week_of(now: float) -> int:
    return int((now - WEEK0) // 604800)


def week_start(wk: int) -> int:
    return WEEK0 + wk * 604800


def windows(wk: int) -> list[tuple[int, int]]:
    s = week_start(wk)
    return [(s + d * 86400 + WAR_H * 3600, s + d * 86400 + WAR_H * 3600 + WAR_LEN) for d in WAR_DAYS]


def active(now: float) -> tuple[int, int] | None:
    for a, b in windows(week_of(now)):
        if a <= now < b:
            return a, b
    return None


def next_window(now: float) -> tuple[int, int]:
    wk = week_of(now)
    for w in (wk, wk + 1):
        for a, b in windows(w):
            if b > now:
                return a, b
    return windows(wk + 1)[0]


def theme(now: float) -> tuple[str, str, dict]:
    return THEMES[int((now - WEEK0) % 604800 // 86400)]


def n_dists(city: str) -> int:
    return len(DISTS.get(city, []))


def dist_xz(city: str, d: str) -> tuple[float, float] | None:
    for k, _n, x, z in DISTS.get(city, []):
        if k == d:
            return float(x), float(z)
    return None


# ---------------------------------------------------------------------------------------------------------------
# хозяева, корни, итоги окон (db — под store.lock у вызывающего)
# ---------------------------------------------------------------------------------------------------------------
def holders(db, city: str) -> dict[str, int | None]:
    ensure_tables(db)
    return {r["dist"]: r["crew"] for r in db.execute("SELECT dist, crew FROM war_hold WHERE city = ?", (city,))}


def held_by(db, crew: int) -> list[tuple[str, str]]:
    ensure_tables(db)
    return [(r["city"], r["dist"]) for r in db.execute("SELECT city, dist FROM war_hold WHERE crew = ?", (crew,))]


def roots(db, crew: int, city: str) -> set[str]:
    """Откуда клан расширяется: свои районы, район штаба, районы зданий соклановцев в этом городе."""
    out = {d for d, c in holders(db, city).items() if c == crew}
    c = db.execute("SELECT hq_city, hq_dist FROM crews WHERE id = ?", (crew,)).fetchone()
    if c and c["hq_city"] == city and c["hq_dist"]:
        out.add(c["hq_dist"])
    for r in db.execute("""SELECT DISTINCT p.dist FROM props p JOIN crew_mem m ON m.rid = p.owner_rid
                           WHERE m.crew = ? AND p.city = ? AND p.dist != ''""", (crew, city)):
        if r["dist"] in ADJ[city]:
            out.add(r["dist"])
    return out


def contestable(db, crew: int, city: str) -> list[str]:
    rs = roots(db, crew, city)
    out = set(rs)
    for d in rs:
        out.update(ADJ[city].get(d, []))
    return sorted(out)


def settle(db, city: str, now: float) -> list[dict]:
    """Подвести окна войны, закончившиеся с прошлого раза: район — к клану с наибольшим влиянием недели (с запасом)."""
    ensure_tables(db)
    r = db.execute("SELECT last FROM war_eval WHERE city = ?", (city,)).fetchone()
    if not r:
        db.execute("INSERT INTO war_eval (city, last) VALUES (?, ?)", (city, int(now)))
        return []
    last = int(r["last"])
    if now <= last:
        return []
    flips = []
    for wk in range(max(week_of(last), week_of(now) - 2), week_of(now) + 1):
        for _a, end in windows(wk):
            if last < end <= now:
                flips += _flip(db, city, wk, end)
    db.execute("UPDATE war_eval SET last = ? WHERE city = ?", (int(now), city))
    return flips


def _flip(db, city: str, wk: int, at: int) -> list[dict]:
    hold = holders(db, city)
    alive = {x["id"] for x in db.execute("SELECT id FROM crews WHERE gone = 0")}
    pts: dict[str, dict[int, float]] = {}
    for x in db.execute("SELECT dist, crew, pts FROM war_pts WHERE week = ? AND city = ?", (wk, city)):
        if x["crew"] in alive:
            pts.setdefault(x["dist"], {})[x["crew"]] = float(x["pts"])
    out = []
    for d, _n, _x, _z in DISTS[city]:
        p = pts.get(d, {})
        if not p:
            continue
        best, bp = max(p.items(), key=lambda kv: (kv[1], -kv[0]))
        cur = hold.get(d)
        if cur not in alive:
            cur = None
        if best == cur or bp < FLIP_MIN or bp < p.get(cur, 0.0) * FLIP_K + 1:
            continue
        db.execute("""INSERT INTO war_hold (city, dist, crew, since) VALUES (?, ?, ?, ?)
                      ON CONFLICT(city, dist) DO UPDATE SET crew = excluded.crew, since = excluded.since""",
                   (city, d, best, at))
        db.execute("INSERT INTO war_log (city, dist, crew, prev, pts, at) VALUES (?, ?, ?, ?, ?, ?)",
                   (city, d, best, cur, bp, at))
        out.append({"dist": d, "crew": best, "prev": cur, "pts": bp})
    return out


def drop_crew(db, crew: int) -> None:
    """Клан распущен — его районы ничьи (до следующего окна)."""
    ensure_tables(db)
    db.execute("UPDATE war_hold SET crew = NULL WHERE crew = ?", (crew,))


# ---------------------------------------------------------------------------------------------------------------
# влияние клана (зовёт season._add_pts с блокировкой) и бафф хозяина
# ---------------------------------------------------------------------------------------------------------------
def add(db, rid: str, city: str, dist: str, pts: float, now: float, src: str = "") -> float:
    """Очки влияния игрока → его клану (если район клану доступен). Возвращает начисленное клану."""
    import crews
    ensure_tables(db)
    crews.ensure_tables(db)
    if pts <= 0 or dist not in ADJ.get(city, {}):
        return 0.0
    cr = crews.crew_of(db, rid)
    if not cr:
        return 0.0
    settle(db, city, now)
    if dist not in contestable(db, cr["id"], city):
        return 0.0
    k = WAR_K if active(now) else 1.0
    k *= theme(now)[2].get(src, 1.0)
    row = db.execute("SELECT hq_city, hq_dist, hq_lvl FROM crews WHERE id = ?", (cr["id"],)).fetchone()
    if row and row["hq_city"] == city and row["hq_dist"] == dist:
        k *= 1.0 + HQ_K * max(1, int(row["hq_lvl"] or 0))
    wk, day = week_of(now), int(now // 86400)
    me = db.execute("SELECT day, day_pts FROM war_me WHERE week = ? AND city = ? AND rid = ?", (wk, city, rid)).fetchone()
    used = float(me["day_pts"]) if me and int(me["day"]) == day else 0.0
    got = min(pts * k, max(0.0, WAR_DAY - used))
    if got <= 0:
        return 0.0
    db.execute("""INSERT INTO war_pts (week, city, dist, crew, pts) VALUES (?, ?, ?, ?, ?)
                  ON CONFLICT(week, city, dist, crew) DO UPDATE SET pts = war_pts.pts + excluded.pts""",
               (wk, city, dist, cr["id"], got))
    db.execute("""INSERT INTO war_me (week, city, rid, crew, pts, day, day_pts) VALUES (?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(week, city, rid) DO UPDATE SET pts = war_me.pts + excluded.pts, crew = excluded.crew,
                    day_pts = CASE WHEN war_me.day = excluded.day THEN war_me.day_pts + excluded.day_pts
                                   ELSE excluded.day_pts END,
                    hold_day = CASE WHEN war_me.day = excluded.day THEN war_me.hold_day ELSE 0 END,
                    day = excluded.day""",
               (wk, city, rid, cr["id"], got, day, got))
    crews.goal_add(db, rid, "infl", got, now)
    return got


def crew_bonus(db, rid: str, city: str, dist: str) -> float:
    import crews
    if not dist:
        return 0.0
    ensure_tables(db)
    crews.ensure_tables(db)
    cr = crews.crew_of(db, rid)
    if not cr:
        return 0.0
    h = db.execute("SELECT crew FROM war_hold WHERE city = ? AND dist = ?", (city, dist)).fetchone()
    return HOLD_BONUS if h and h["crew"] == cr["id"] else 0.0


# ---------------------------------------------------------------------------------------------------------------
# флаг района в окно войны
# ---------------------------------------------------------------------------------------------------------------
def hold(store, rid: str, city: str, d: str, pos, now: float | None = None) -> dict:
    """Стоять у флага района в окно войны: позиция — из онлайна (сервер её знает), не из запроса."""
    import crews
    import progress
    now = time.time() if now is None else now
    if not active(now):
        raise HTTPException(403, "флаги держат только в окно войны: сб и вс 19:00–21:00 по Минску")
    xz = dist_xz(city, d)
    if not xz:
        raise HTTPException(400, "d — район из списка")
    if not pos or pos[0] != city:
        raise HTTPException(409, "нужно быть в городе онлайн — сервер видит, где ты")
    if math.hypot(pos[1] - xz[0], pos[2] - xz[1]) > HOLD_R:
        raise HTTPException(409, "далеко от флага района")
    tag = rid + ":" + city
    if now - _hold_t.get(tag, -1e9) < HOLD_EVERY - 1:
        raise HTTPException(429, "флаг отмечается раз в 30 секунд")
    with store.lock:
        db = store.db
        ensure_tables(db)
        crews.ensure_tables(db)
        cr = crews.crew_of(db, rid)
        if not cr:
            raise HTTPException(403, "флаг держат кланом — вступи или создай клан")
        if d not in contestable(db, cr["id"], city):
            raise HTTPException(403, "этот район клану пока не сосед — расширяйтесь от своих районов и штаба")
        wk, day = week_of(now), int(now // 86400)
        me = db.execute("SELECT day, hold_day FROM war_me WHERE week = ? AND city = ? AND rid = ?", (wk, city, rid)).fetchone()
        used = float(me["hold_day"]) if me and int(me["day"]) == day else 0.0
        if used >= HOLD_DAY:
            raise HTTPException(429, "на сегодня флагов хватит — завтра снова")
        _hold_t[tag] = now
        got = add(db, rid, city, d, HOLD_PTS, now, "hold")
        db.execute("UPDATE war_me SET hold_day = hold_day + ? WHERE week = ? AND city = ? AND rid = ?", (got, wk, city, rid))
        x = progress.xp(db, rid, "war", city, now)
    return {"ok": True, "pts": round(got, 1), "xp": x}


# ---------------------------------------------------------------------------------------------------------------
# состояние для клиента
# ---------------------------------------------------------------------------------------------------------------
def state(store, city: str, now: float | None = None) -> dict:
    import crews
    now = time.time() if now is None else now
    with store.lock:
        db = store.db
        ensure_tables(db)
        crews.ensure_tables(db)
        settle(db, city, now)
        wk = week_of(now)
        hold_ = holders(db, city)
        pts: dict[str, list] = {}
        for x in db.execute("""SELECT dist, crew, pts FROM war_pts WHERE week = ? AND city = ? ORDER BY pts DESC""",
                            (wk, city)):
            pts.setdefault(x["dist"], []).append((x["crew"], float(x["pts"])))
        ids = {c for c in hold_.values() if c} | {c for v in pts.values() for c, _ in v[:3]}
        cards = {i: crews.card(db, i) for i in ids}
        dists = []
        for k, name, x, z in DISTS[city]:
            h = hold_.get(k)
            top = [dict(cards[c], pts=round(p)) for c, p in pts.get(k, [])[:3] if cards.get(c)]
            dists.append({"d": k, "name": name, "x": x, "z": z, "adj": ADJ[city][k],
                          "holder": cards.get(h) if h else None, "top": top})
        log = []
        for x in db.execute("SELECT * FROM war_log WHERE city = ? ORDER BY id DESC LIMIT 12", (city,)):
            c = cards.get(x["crew"]) or crews.card(db, x["crew"])
            p = crews.card(db, x["prev"]) if x["prev"] else None
            log.append({"id": int(x["id"]), "d": x["dist"], "at": int(x["at"]), "crew": c, "prev": p, "pts": round(x["pts"] or 0)})
    win = active(now)
    nx = next_window(now)
    th = theme(now)
    return {"city": city, "week": wk, "now": int(now), "active": bool(win), "ends": win[1] if win else None,
            "next": nx[0], "next_end": nx[1], "windows": windows(wk), "theme": {"id": th[0], "name": th[1], "k": th[2]},
            "themes": [{"id": t[0], "name": t[1]} for t in THEMES], "dists": dists, "log": log,
            "rules": {"war_k": WAR_K, "flip_min": FLIP_MIN, "flip_k": FLIP_K, "hold_r": HOLD_R, "hold_every": HOLD_EVERY,
                      "hold_pts": HOLD_PTS, "bonus": HOLD_BONUS}}


def mine(store, rid: str, city: str, now: float | None = None) -> dict:
    import crews
    now = time.time() if now is None else now
    with store.lock:
        db = store.db
        ensure_tables(db)
        crews.ensure_tables(db)
        cr = crews.crew_of(db, rid)
        if not cr:
            return {"crew": None}
        wk = week_of(now)
        me = db.execute("SELECT pts, day, day_pts, hold_day FROM war_me WHERE week = ? AND city = ? AND rid = ?",
                        (wk, city, rid)).fetchone()
        today = me and int(me["day"]) == int(now // 86400)
        return {"crew": cr["id"], "can": contestable(db, cr["id"], city), "roots": sorted(roots(db, cr["id"], city)),
                "held": [d for c, d in held_by(db, cr["id"]) if c == city], "pts": round(float(me["pts"])) if me else 0,
                "today": round(float(me["day_pts"])) if today else 0, "day_cap": WAR_DAY,
                "hold_today": round(float(me["hold_day"])) if today else 0, "hold_cap": HOLD_DAY}


def make_router(get_store, verify, read_body, where=None) -> APIRouter:
    r = APIRouter()

    def city_of(v) -> str:
        if v not in CITIES:
            raise HTTPException(400, "city — flame или minsk")
        return v

    async def who(body: dict) -> str:
        rid = await verify(body.get("token") or "")
        if not rid:
            raise HTTPException(401, "войди своим агентом")
        return rid

    @r.get("/g/war")
    async def war_get(resp: Response, city: str = "flame"):
        city_of(city)
        resp.headers["Cache-Control"] = "public, max-age=20"
        key = (id(get_store()), city)
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < 20:
            return hit[1]
        d = await asyncio.to_thread(state, get_store(), city)
        _cache[key] = (time.time(), d)
        return d

    @r.post("/g/war/me")
    async def war_me(request: Request):
        body = await read_body(request)
        rid = await who(body)
        return await asyncio.to_thread(mine, get_store(), rid, city_of(body.get("city")))

    @r.post("/g/war/hold")
    async def war_hold(request: Request):
        body = await read_body(request)
        rid = await who(body)
        city = city_of(body.get("city"))
        d = body.get("d")
        if not isinstance(d, str) or len(d) > 16:
            raise HTTPException(400, "d — район")
        pos = where(rid) if where else None
        return await asyncio.to_thread(hold, get_store(), rid, city, d, pos)

    return r
