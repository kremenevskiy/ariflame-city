"""«Рядом с игроками» (25.11.2026): где в городе сейчас больше всего народу — для старта и кнопки «К игрокам».

Задача владельца: «режим спавна — чтобы ты мог спавниться сразу рядом с каким-то игроком, а если их несколько — рядом с
большинством игроков». Сервер отдаёт одну точку, клиент (client/fcrowd.js) сам ставит игрока на тротуар в 15–40 м от неё.

Приватность (аудит 24.11, L-4): точное место — только другу. Здесь — только то, что любой игрок и так видит в «who»
(modes.py): координаты на клетке WHO_GRID (20 м). Наружу — одна точка: центр самой плотной кучки (игроки в радиусе
CROWD_R от самой людной клетки), округлённый до той же клетки, и сколько в ней человек. Ни номеров соединений, ни ников,
ни fid, ни списка: по ответу не узнать, кто там.

    GET /g/crowd?city=minsk[&me=<номер соединения>]
      → 200 {city, online, n, x, z} — online: игроков в городе (кроме me), n: в кучке, x/z — её центр;
      → 200 {city, online: 0, n: 0} — в городе никого; 400 — не тот город или me; 429 — часто.

me — свой номер соединения (welcome.id): себя не считаем, иначе «К игрокам» вело бы к самому себе. Номер соединения и так
приходит соседям в кадрах w; подделка me ничего не открывает — можно лишь не посчитать одного игрока.
Кто в воздухе (m 3, 4), в кучку не входит, пока на земле есть хоть кто-то: самолёт над районом — не «рядом с игроками».
Лимит: CROWD_IP_N запросов за CROWD_IP_WIN с с адреса (clientip.py) — за общим прокси у игроков бывает один адрес, поэтому
с запасом; ответ на (город, me) живёт CROWD_TTL с; пересчётов — не больше CROWD_ALL_N в секунду на сервер. Пересчёт —
O(клеток²) в худшем случае (300 игроков в одном квартале — ~10 мс), поэтому большой — в потоке, а не в цикле рассылки.
"""
from __future__ import annotations

import asyncio
import collections
import math
import re
import time

from fastapi import APIRouter, HTTPException, Request, Response

from clientip import client_ip  # адрес — из прокси-заголовков, разобранных uvicorn, а не левый X-Forwarded-For (M-2)
from modes import WHO_GRID      # та же клетка, что в «who»: точнее, чем там, наружу ничего не уходит

CROWD_R = 150.0                        # радиус кучки, м
CROWD_IP_N, CROWD_IP_WIN = 120, 60.0   # с одного адреса — 2 в секунду: старт и кнопка на карте с большим запасом
CROWD_ALL_N = 30                       # пересчётов в секунду на весь сервер
CROWD_TTL = 2.0                        # ответ на (город, me) — столько секунд
ME_RE = re.compile(r"\d{1,9}")

_hits: dict[str, collections.deque] = {}
_cache: dict[tuple, tuple[float, dict]] = {}


def _allow(key: str, n: int, win: float, now: float) -> bool:
    q = _hits.get(key)
    if q is None:
        if len(_hits) > 50000:
            _hits.clear()
        q = _hits[key] = collections.deque()
    while q and now - q[0] > win:
        q.popleft()
    if len(q) >= n:
        return False
    q.append(now)
    return True


def reset() -> None:
    """Сбросить лимиты и ответы (тесты)."""
    _hits.clear()
    _cache.clear()


def grid(v: float) -> int:
    """Клетка WHO_GRID — так же, как округляет «who»."""
    return int(round(v / WHO_GRID) * WHO_GRID)


def cells_of(clients, city: str, me: int | None = None) -> tuple[collections.Counter, int]:
    """Игроки города на клетке WHO_GRID: Counter{(x, z): сколько} и сколько их всего (без me).
    Клетки — тех, кто на земле; если на земле никого — тех, кто в воздухе."""
    ground: collections.Counter = collections.Counter()
    air: collections.Counter = collections.Counter()
    total = 0
    for c in list(clients.values()):
        s = c.state
        if not s or getattr(c, "closed", False) or getattr(c, "city", "flame") != city or c.id == me:
            continue
        total += 1
        (air if s[4] in (3, 4) else ground)[(grid(s[0]), grid(s[2]))] += 1
    return (ground or air), total


def busiest(cells, r: float = CROWD_R) -> tuple[int, int, int] | None:
    """Центр самой плотной кучки: для каждой занятой клетки — сколько игроков в радиусе r от неё. Лучшая — где больше
    всех; при равенстве — где они кучнее, потом — меньшие x, z (ответ не зависит от порядка соединений). Центр — среднее
    игроков кучки, на клетке WHO_GRID. → (x, z, n) или None."""
    if not cells:
        return None
    buckets: dict[tuple[int, int], list] = {}
    for (x, z), k in cells.items():
        buckets.setdefault((math.floor(x / r), math.floor(z / r)), []).append((x, z, k))
    r2, best = r * r, None
    for (x, z) in cells:
        bx, bz = math.floor(x / r), math.floor(z / r)
        n = sx = sz = spread = 0.0
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                for ox, oz, k in buckets.get((bx + dx, bz + dz), ()):
                    d2 = (ox - x) ** 2 + (oz - z) ** 2
                    if d2 <= r2:
                        n += k
                        sx += ox * k
                        sz += oz * k
                        spread += math.sqrt(d2) * k
        key = (-n, round(spread / n, 3), x, z)
        if best is None or key < best[0]:
            best = (key, sx / n, sz / n, int(n))
    _, cx, cz, n = best
    return grid(cx), grid(cz), n


def make_router(clients_fn, cities) -> APIRouter:
    """clients_fn() → словарь соединений app.py (у каждого id, city, state, closed); cities — города (CITY_LIM)."""
    rt = APIRouter()

    # async: считаем в потоке цикла событий — словарь соединений меняется только там, без гонок с рассылкой
    @rt.get("/g/crowd")
    async def crowd(request: Request, resp: Response):
        city = request.query_params.get("city") or "flame"
        if city not in cities:
            raise HTTPException(400, "город: " + " или ".join(cities))
        me_s = request.query_params.get("me")
        if me_s is not None and not ME_RE.fullmatch(me_s):
            raise HTTPException(400, "me — номер соединения")
        me = int(me_s) if me_s is not None else None
        now = time.monotonic()
        if not _allow("i:" + client_ip(request), CROWD_IP_N, CROWD_IP_WIN, now):
            raise HTTPException(429, "часто — попробуй через минуту")
        resp.headers["Cache-Control"] = "no-store"
        hit = _cache.get((city, me))
        if hit and now - hit[0] < CROWD_TTL:
            return hit[1]
        if not _allow("*", CROWD_ALL_N, 1.0, now):
            raise HTTPException(429, "часто — попробуй через минуту")
        cells, online = cells_of(clients_fn(), city, me)       # снимок — в цикле событий (словарь меняется только там)
        b = busiest(cells) if len(cells) <= 64 else await asyncio.to_thread(busiest, cells)
        out = {"city": city, "online": online, "n": 0}
        if b:
            out.update(n=b[2], x=b[0], z=b[1])
        if len(_cache) > 5000:
            _cache.clear()
        _cache[(city, me)] = (now, out)
        return out

    return rt
