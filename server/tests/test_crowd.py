"""«Рядом с игроками» (server/crowd.py, GET /g/crowd): самая людная кучка города — для старта и «К игрокам».

Главное — приватность (аудит L-4): наружу только центр на клетке «who» (20 м) и число, без номеров, ников и списка.
Соединения — подставные (без сокета): ручка читает те же поля, что у Client в app.py.

    python -m pytest server/tests/test_crowd.py -q
"""
from __future__ import annotations

import importlib.util
import os
import tempfile
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
os.environ.setdefault("FC_DB", os.path.join(tempfile.mkdtemp(prefix="fcg-crowd-"), "game.db"))
os.environ["FC_WORLD"] = "fake"
os.environ.setdefault("FC_ORIGINS", "https://game.example.org")

_spec = importlib.util.spec_from_file_location("fcg_app_crowd", GAME / "app.py")
fcg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fcg)
import crowd  # noqa: E402  — app.py кладёт папку службы в sys.path

from fastapi.testclient import TestClient  # noqa: E402

api = TestClient(fcg.app)


class Fake:
    """Соединение без сокета: id, город, состояние [x, y, z, h, m, c, k, b, a, w] — как Client в app.py."""
    _n = 500

    def __init__(self, x, z, city="minsk", m=0, b=None, closed=False):
        Fake._n += 1
        self.id, self.city, self.closed = Fake._n, city, closed
        self.rid, self.guest, self.creature, self.nick = "%08x" % Fake._n, False, "lis", "Лис"
        self.state = [x, 0.0, z, 0.0, m, "", 0, b, 0, 0]


@pytest.fixture()
def online():
    crowd.reset()
    fcg.clients.clear()

    def add(*ps):
        for p in ps:
            fcg.clients[p.id] = p
        return ps
    yield add
    fcg.clients.clear()
    crowd.reset()


def get(qs="city=minsk"):
    return api.get("/g/crowd?" + qs)


def test_empty_city_no_point(online):
    online(Fake(10.0, 10.0, city="flame"))                         # другой город — не в счёт
    r = get()
    assert r.status_code == 200
    assert r.json() == {"city": "minsk", "online": 0, "n": 0}
    assert r.headers["cache-control"] == "no-store"


def test_single_player_only_on_who_grid(online):
    """Один игрок — рядом с ним, но не точнее клетки 20 м, что и так отдаёт «who»; ни номера, ни ника, ни fid."""
    p, = online(Fake(1234.4, -567.8, b=4321))                       # даже внутри здания — только клетка, без здания
    j = get().json()
    assert j == {"city": "minsk", "online": 1, "n": 1, "x": 1240, "z": -560}
    t = get().text
    assert "Лис" not in t and p.rid not in t and "4321" not in t                 # ключи ответа — ровно эти пять


def test_densest_cluster_wins(online):
    online(Fake(500.0, 500.0), Fake(560.0, 470.0), Fake(470.0, 590.0),     # трое в ~100 м друг от друга
           Fake(-3000.0, 2000.0), Fake(-2990.0, 2010.0),                   # двое далеко
           Fake(520.0, 520.0, city="flame"))                               # Флейм-Сити — не в счёт
    j = get().json()
    assert j["online"] == 5 and j["n"] == 3
    assert abs(j["x"] - 510) <= 20 and abs(j["z"] - 520) <= 20
    assert j["x"] % 20 == 0 and j["z"] % 20 == 0


def test_cluster_radius_150(online):
    """Кучка — в радиусе ~150 м: четверо, растянутые на 600 м, не «кучка из четырёх»; трое рядом — да."""
    online(Fake(0.0, 0.0), Fake(200.0, 0.0), Fake(400.0, 0.0), Fake(600.0, 0.0),
           Fake(5000.0, 5000.0), Fake(5040.0, 5000.0), Fake(5000.0, 5060.0))
    j = get().json()
    assert j["n"] == 3 and abs(j["x"] - 5013) <= 20 and abs(j["z"] - 5020) <= 20


def test_me_not_counted(online):
    me, other = online(Fake(100.0, 100.0), Fake(-800.0, 300.0))
    j = get("city=minsk&me=%d" % me.id).json()
    assert j["online"] == 1 and j["n"] == 1 and (j["x"], j["z"]) == (-800, 300)   # не к самому себе
    fcg.clients.pop(other.id)
    crowd.reset()                                                    # ответ живёт CROWD_TTL — сбросить кэш
    assert get("city=minsk&me=%d" % me.id).json() == {"city": "minsk", "online": 0, "n": 0}


def test_air_only_when_nobody_on_ground(online):
    a1, a2, g = online(Fake(0.0, 0.0, m=3), Fake(20.0, 0.0, m=4), Fake(800.0, 800.0, m=1))
    j = get().json()
    assert j["online"] == 3 and j["n"] == 1 and (j["x"], j["z"]) == (800, 800)     # самолёты над районом — не «рядом»
    fcg.clients.pop(g.id)
    crowd.reset()
    j = get().json()
    assert j["n"] == 2 and j["online"] == 2                                         # на земле никого — хоть к ним


def test_skips_closed_and_silent(online):
    s = Fake(0.0, 0.0)
    s.state = None                                                   # сокет без состояния (ещё не в игре)
    online(s, Fake(40.0, 40.0, closed=True))
    assert get().json()["online"] == 0


def test_bad_params(online):
    assert get("city=moon").status_code == 400
    assert get("city=minsk&me=abc").status_code == 400
    assert get("city=minsk&me=-1").status_code == 400
    assert get("").json()["city"] == "flame"                         # без города — Флейм-Сити


def test_rate_limit_per_address(online):
    online(Fake(0.0, 0.0))
    codes = [get().status_code for _ in range(crowd.CROWD_IP_N + 3)]
    assert codes[:crowd.CROWD_IP_N] == [200] * crowd.CROWD_IP_N
    assert codes[-1] == 429


def test_short_cache_and_global_cap(online, monkeypatch):
    """Ответ на (город, me) живёт CROWD_TTL: частый опрос не пересчитывает кучку; пересчётов на сервер — не больше
    CROWD_ALL_N в секунду (разные me — разные пересчёты)."""
    a, = online(Fake(0.0, 0.0))
    assert get().json()["n"] == 1
    online(Fake(3000.0, 3000.0), Fake(3020.0, 3000.0))
    assert get().json()["n"] == 1                                    # тот же ответ — из кэша
    calls = []
    real = crowd.busiest
    monkeypatch.setattr(crowd, "busiest", lambda cells, r=crowd.CROWD_R: calls.append(1) or real(cells, r))
    codes = [get("city=minsk&me=%d" % (900000 + i)).status_code for i in range(crowd.CROWD_ALL_N + 5)]
    assert 429 in codes and len(calls) <= crowd.CROWD_ALL_N


def test_big_crowd_counts_in_thread(online):
    """300 игроков в одном квартале (больше 64 клеток) — пересчёт в потоке, ответ тот же по смыслу."""
    ps = [Fake(float((i % 15) * 20), float((i // 15) * 20)) for i in range(300)]
    online(*ps)
    j = get().json()
    assert j["online"] == 300 and j["n"] > 100 and j["x"] % 20 == 0 and j["z"] % 20 == 0


def test_busiest_ties_do_not_depend_on_order():
    a = {(0, 0): 1, (2000, 0): 1}
    b = {(2000, 0): 1, (0, 0): 1}
    assert crowd.busiest(a) == crowd.busiest(b) == (0, 0, 1)
    assert crowd.busiest({}) is None
    # при равном числе — где кучнее: двое в 20 м, а не двое в 140 м
    x, z, n = crowd.busiest({(0, 0): 1, (140, 0): 1, (3000, 0): 1, (3020, 0): 1})
    assert n == 2 and 3000 <= x <= 3020 and z == 0
