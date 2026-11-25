"""«Кататься вместе» (server/ride.py): места решает сервер — сесть к водителю, копия его состояния для всех рядом,
поток позиций пассажирам, высадить и бан, выход водителя, уход из игры, перемещение, вертолёт и места по типу.

Сокет — через app.py (как в test_game.py), тонкие случаи (скорость, бан, скачок) — напрямую с подменёнными часами.

    python -m pytest server/tests/test_ride.py -q
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import tempfile
import time
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
os.environ.setdefault("FC_DB", os.path.join(tempfile.mkdtemp(prefix="fcg-test-"), "game.db"))
os.environ["FC_WORLD"] = "fake"
os.environ["FC_ORIGINS"] = "https://game.example.org"

_spec = importlib.util.spec_from_file_location("fcg_app_ride", GAME / "app.py")
fcg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fcg)
R = fcg.fcride

from fastapi.testclient import TestClient  # noqa: E402

ORIGIN = {"origin": "https://game.example.org"}


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(fcg, "TICK", 0.03)
    monkeypatch.setattr(R, "ASK_EVERY", 0.0)
    fcg._tok.clear()
    fcg.RIDE.ban.clear()
    with TestClient(fcg.app) as c:
        yield c
    assert not fcg.clients, "соединения не закрылись"
    assert not fcg.RIDE.cars and not fcg.RIDE.seat_of, "места не освободились"


def hello(ws, **kw):
    ws.send_json(dict({"t": "hi", "creature": "lis", "v": 1}, **kw))
    w = ws.receive_json()
    assert w["t"] == "welcome" and w["ride"] == 1
    return w["id"]


def wait(cond, sec=2.0):
    end = time.time() + sec
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.02)
    return False


def until(ws, t, e=None, n=300):
    """Следующий кадр типа t (и события e); остальные (w, online) пропускаем. Ждём только то, что точно придёт."""
    for _ in range(n):
        m = ws.receive_json()
        if m.get("t") == t and (e is None or m.get("e") == e):
            return m
    raise AssertionError(f"нет кадра {t}/{e}")


def car_with(ws, n):
    """Кадр «кто в машине» с n пассажирами (прежние кадры — посадки — пропускаем)."""
    for _ in range(10):
        car = until(ws, "ride", "car")
        if len(car["ps"]) == n:
            return car
    raise AssertionError(f"нет кадра car с {n} пассажирами")


def st(ws, x, z, m=0, c=None, y=0.2, h=0.0, **kw):
    msg = {"t": "s", "p": [x, y, z, h], "m": m}
    if c:
        msg["c"] = c
    msg.update(kw)
    ws.send_json(msg)


class Socks:
    def __init__(self, client, n):
        self.cm = [client.websocket_connect("/g/ws", headers=ORIGIN) for _ in range(n)]

    def __enter__(self):
        return [s.__enter__() for s in self.cm]

    def __exit__(self, *a):
        for s in self.cm:
            s.__exit__(None, None, None)


def test_board_copy_forward_and_others_see(client):
    with Socks(client, 3) as (a, b, c):
        ia, ib, ic = hello(a, guest="g-ridea"), hello(b, guest="g-rideb"), hello(c, guest="g-ridec")
        A, B, C = (fcg.clients[i] for i in (ia, ib, ic))
        st(a, 0, 0, m=1, c="sedan", k=0xff0000, h=1.2)
        st(b, 3, 1)
        st(c, 30, 0)
        assert wait(lambda: A.state and B.state and C.state and ib in A.vis and ic in A.vis)
        b.send_json({"t": "ride", "a": "in", "id": ia})
        seat = until(b, "ride", "seat")
        assert seat["id"] == ia and seat["seat"] == 1 and seat["m"] == 1 and seat["c"] == "sedan" and seat["max"] == 3
        assert seat["p"][0] == 0 and seat["nick"]
        car = until(a, "ride", "car")                         # водителю — кто сел (для «Гость сел к тебе»)
        assert car["id"] == ia and car["ps"][0][:2] == [ib, 1]
        assert until(c, "ride", "car")["ps"][0][0] == ib      # и тем, кто рядом
        # C видит B в машине A: строка m 5, тип и цвет машины водителя, место в a, координаты водителя
        for _ in range(100):
            w = until(c, "w")
            row = next((r for r in w["ps"] if r[0] == ib), None)
            if row and row[5] == 5:
                break
        assert row[1:4] == [0, 0.2, 0] and row[6] == "sedan" and row[7] == 0xff0000 and row[9] == 1
        # свои координаты пассажира сервер не берёт
        st(b, 500, 500)
        st(a, 12, 0, m=1, c="sedan", k=0xff0000, ts=123456)
        pos = until(b, "ride", "pos")                         # позиция машины — пассажиру сразу, со временем водителя
        assert pos["p"][0] == 12 and pos["ts"] == 123456
        assert wait(lambda: B.state[0] == 12 and B.state[4] == 5)
        txt = str(seat) + str(car) + str(pos)
        assert A.rid not in txt and B.rid not in txt and "'rid'" not in txt    # наружу — только номера соединений
        # пассажир выходит сам
        b.send_json({"t": "ride", "a": "out"})
        assert until(b, "ride", "out")["why"] == "exit"
        assert car_with(a, 0)["ps"] == []
        assert wait(lambda: B.state[4] == 0)
        st(b, 15, 2)
        assert wait(lambda: B.state[0] == 15)


def test_refusals_distance_mode_and_full(client):
    with Socks(client, 3) as (a, b, c):
        ia, ib, ic = hello(a, guest="g-refa"), hello(b, guest="g-refb"), hello(c, guest="g-refc")
        A, B, C = (fcg.clients[i] for i in (ia, ib, ic))
        st(a, 0, 0)                                           # водитель пешком
        st(b, 60, 0)
        st(c, 2, 2)
        assert wait(lambda: A.state and B.state and C.state)
        b.send_json({"t": "ride", "a": "in", "id": ia})
        assert until(b, "ride", "no")["why"] == "Он сейчас не за рулём"
        st(a, 0, 0, m=1, c="moto")
        assert wait(lambda: A.state[4] == 1)
        b.send_json({"t": "ride", "a": "in", "id": ia})
        assert until(b, "ride", "no")["why"] == "Подойди ближе"
        b.send_json({"t": "ride", "a": "in", "id": ib})       # к себе
        assert until(b, "ride", "no")["why"] == "Игрок уже уехал"
        st(b, 1, 1)
        assert wait(lambda: B.state[0] == 1)
        b.send_json({"t": "ride", "a": "in", "id": ia})
        assert until(b, "ride", "seat")["seat"] == 1
        c.send_json({"t": "ride", "a": "in", "id": ia})       # мотоцикл везёт одного
        assert until(c, "ride", "no")["why"] == "Мест нет"
        c.send_json({"t": "ride", "a": "in", "id": ib})       # к пассажиру — нельзя
        assert until(c, "ride", "no")["why"] == "Он сейчас не за рулём"
        bad = C.bad
        c.send_json({"t": "ride", "a": "in", "id": "x"})       # мусор — нарушение
        c.send_json({"t": "ride", "a": "fly"})
        assert wait(lambda: C.bad == bad + 2)


def test_kick_bans_for_a_minute(client):
    with Socks(client, 2) as (a, b):
        ia, ib = hello(a, guest="g-kicka"), hello(b, guest="g-kickb")
        A, B = fcg.clients[ia], fcg.clients[ib]
        st(a, 0, 0, m=1, c="taxi")
        st(b, 2, 0)
        assert wait(lambda: A.state and B.state)
        b.send_json({"t": "ride", "a": "in", "id": ia})
        until(b, "ride", "seat")
        a.send_json({"t": "ride", "a": "kick"})
        assert until(b, "ride", "out")["why"] == "kick"
        assert car_with(a, 0)["ps"] == []
        b.send_json({"t": "ride", "a": "in", "id": ia})
        assert "подожди" in until(b, "ride", "no")["why"]
        assert fcg.RIDE.ban[(ia, ib)] > time.monotonic() + 50


def test_driver_exit_disconnect_and_teleport_drop_passengers(client):
    with Socks(client, 2) as (a, b):
        ia, ib = hello(a, guest="g-dra"), hello(b, guest="g-drb")
        A, B = fcg.clients[ia], fcg.clients[ib]
        st(a, 0, 0, m=1, c="sedan")
        st(b, 2, 0)
        assert wait(lambda: A.state and B.state)
        b.send_json({"t": "ride", "a": "in", "id": ia})
        until(b, "ride", "seat")
        st(a, 2, 0, m=0)                                      # водитель вышел из машины (или она сгорела)
        assert until(b, "ride", "out")["why"] == "drv_out"
        st(a, 0, 0, m=1, c="sedan")
        assert wait(lambda: A.state[4] == 1)
        time.sleep(0.1)
        b.send_json({"t": "ride", "a": "in", "id": ia})
        until(b, "ride", "seat")
        st(a, 900, 0, m=1, c="sedan")                         # перемещение по карте за рулём
        assert until(b, "ride", "out")["why"] == "tp"
        assert wait(lambda: B.state[4] == 0 and B.state[0] < 10)   # пассажир остался на месте, пешком
        st(b, 2, 2)
        st(a, 0, 0, m=1, c="sedan")
        assert wait(lambda: A.state[0] == 0 and B.state[0] == 2)
        time.sleep(0.1)
        b.send_json({"t": "ride", "a": "in", "id": ia})
        until(b, "ride", "seat")
    # сокеты закрыты разом: в фикстуре проверяем, что места освободились
    with Socks(client, 2) as (a, b):
        ia, ib = hello(a, guest="g-dra2"), hello(b, guest="g-drb2")
        A, B = fcg.clients[ia], fcg.clients[ib]
        st(a, 0, 0, m=1, c="sedan")
        st(b, 2, 0)
        assert wait(lambda: A.state and B.state)
        b.send_json({"t": "ride", "a": "in", "id": ia})
        until(b, "ride", "seat")
        a.close()                                             # водитель вышел из игры
        assert until(b, "ride", "out")["why"] == "drv_left"
        assert wait(lambda: not fcg.RIDE.cars and B.state[4] == 0)


def test_passenger_leaves_and_switches_mode(client):
    with Socks(client, 3) as (a, b, c):
        ia, ib, ic = hello(a, guest="g-pla"), hello(b, guest="g-plb"), hello(c, guest="g-plc")
        A, B = fcg.clients[ia], fcg.clients[ib]
        st(a, 0, 0, m=1, c="van")
        st(b, 2, 0)
        st(c, -2, 0)
        assert wait(lambda: A.state and B.state and fcg.clients[ic].state)
        b.send_json({"t": "ride", "a": "in", "id": ia})
        until(b, "ride", "seat")
        c.send_json({"t": "ride", "a": "in", "id": ia})
        assert until(c, "ride", "seat")["seat"] == 2
        st(b, 2, 0, m=1, c="sport")                           # пассажир сел в свою машину — место свободно
        assert until(b, "ride", "out")["why"] == "self"
        c.close()                                             # второй пассажир вышел из игры
        assert car_with(a, 0)["ps"] == [] and not fcg.RIDE.cars
        assert B.state[4] == 0                                # своё состояние пассажира снова принимается


def test_helicopter_three_seats_and_altitude(client):
    with Socks(client, 5) as socks:
        ids = [hello(s, guest="g-heli%d" % i) for i, s in enumerate(socks)]
        a, ps = socks[0], socks[1:]
        A = fcg.clients[ids[0]]
        st(a, 0, 0, m=3, c="heli_light", y=1.2)               # вертолёт сел: пилот на высоте корпуса
        for i, s in enumerate(ps):
            st(s, 7 + i * 0.5, 3)
        assert wait(lambda: all(fcg.clients[i].state for i in ids))
        for s in ps[:3]:
            s.send_json({"t": "ride", "a": "in", "id": ids[0]})
        assert [until(s, "ride", "seat")["seat"] for s in ps[:3]] == [1, 2, 3]
        ps[3].send_json({"t": "ride", "a": "in", "id": ids[0]})
        assert until(ps[3], "ride", "no")["why"] == "Мест нет"
        # взлетели: пассажиры на высоте вертолёта (m 5), а пешеход внизу сесть уже не может
        st(a, 5, 0, m=3, c="heli_light", y=80)
        assert wait(lambda: all(fcg.clients[i].state[1] == 80 and fcg.clients[i].state[4] == 5 for i in ids[1:4]))
        # прыжок с парашютом: выход и кадр m 4 с высоты — сервер принимает
        ps[0].send_json({"t": "ride", "a": "out"})
        until(ps[0], "ride", "out")
        st(ps[0], 5, 0, m=4, y=78)
        P = fcg.clients[ids[1]]
        assert wait(lambda: P.state[4] == 4 and P.state[1] == 78)
        assert P.bad == 0


def test_seats_table_and_far_air():
    assert R.seats_of("moto") == 1 and R.seats_of("sedan") == 3 and R.seats_of("bus") == 3
    assert R.seats_of("heli_light") == 3 and R.seats_of("plane_jet") == 1 and R.seats_of(None) == 3


class Fake:
    _n = 900

    def __init__(self, x=0.0, z=0.0, m=0, car="", y=0.2):
        Fake._n += 1
        self.id, self.nick, self.closed, self.city = Fake._n, "Гость", False, "flame"
        self.state = [x, y, z, 0.0, m, car, 0, None, 0, 0]
        self.vis = set()


def test_speed_city_and_teleport_window():
    sent = []

    async def send(c, msg):
        sent.append((c.id, msg))
        return True
    clients, speed = {}, {"v": 0.0}
    rd = R.Ride(clients, send, lambda cid: speed["v"])
    t = [100.0]
    rd.now = lambda: t[0]
    d, p, q = Fake(m=1, car="sedan"), Fake(x=3), Fake(x=-3)
    for o in (d, p, q):
        clients[o.id] = o

    def run(coro):
        return asyncio.run(coro)

    def last(cid):
        m = [m for i, m in sent if i == cid][-1]
        return json.loads(m) if isinstance(m, str) else m
    speed["v"] = 12.0
    run(rd.msg(p, {"t": "ride", "a": "in", "id": d.id}))
    assert "На ходу" in last(p.id)["why"]
    speed["v"] = 0.0
    q.city = "minsk"
    t[0] += 1
    run(rd.msg(q, {"t": "ride", "a": "in", "id": d.id}))
    assert last(q.id)["why"] == "Игрок в другом городе"
    run(rd.msg(p, {"t": "ride", "a": "in", "id": d.id}))
    assert [m for i, m in sent if i == p.id and isinstance(m, dict) and m.get("e") == "seat"] and rd.riding(p)
    # частые просьбы — молча (не нарушение)
    n = len(sent)
    assert run(rd.msg(p, {"t": "ride", "a": "in", "id": d.id})) is True and len(sent) == n
    # 50 м за 0,5 с — быстро, но не перемещение (40 + 160·0,5 = 120 м); 300 м за 0,1 с — перемещение
    prev = list(d.state)
    t[0] += 0.5
    d.state = [50.0] + d.state[1:]
    run(rd.after_state(d, prev, {"ts": 5}))
    assert last(p.id) == {"t": "ride", "e": "pos", "p": [50.0, 0.2, 0.0, 0.0], "ts": 5}
    assert rd.riding(p)
    prev = list(d.state)
    t[0] += 0.1
    d.state = [350.0] + d.state[1:]
    run(rd.after_state(d, prev, {}))
    assert not rd.riding(p) and last(p.id)["why"] == "tp"
