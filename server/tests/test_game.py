"""Игровой сервер Флейм-Сити (server/app.py): рукопожатие, видимость по радиусу и зданию, лимиты, тишина,
вторая вкладка, сохранение в своей SQLite.

Без сети и без Postgres: мир подменён (FC_WORLD=fake — токен «tok-<rid>» = rid), база — файл во временной папке.
Состояние соседей проверяем по серверу (clients[...].vis): ждать кадр, которого нет, — значит повесить тест.

    python -m pytest server/tests -q
"""
from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import time
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
os.environ["FC_DB"] = os.path.join(tempfile.mkdtemp(prefix="fcg-test-"), "game.db")
os.environ["FC_WORLD"] = "fake"
os.environ["FC_ORIGINS"] = "https://game.example.org"

_spec = importlib.util.spec_from_file_location("fcg_app", GAME / "app.py")
fcg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fcg)

from fastapi.testclient import TestClient  # noqa: E402
from starlette.websockets import WebSocketDisconnect  # noqa: E402

ORIGIN = {"origin": "https://game.example.org"}


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(fcg, "TICK", 0.03)
    fcg._tok.clear()
    fcg._saved_at.clear()
    with TestClient(fcg.app) as c:
        yield c
    assert not fcg.clients, "соединения не закрылись"


def hello(ws, **kw):
    ws.send_json(dict({"t": "hi", "creature": "lis", "v": 1}, **kw))
    w = ws.receive_json()
    assert w["t"] == "welcome"
    return w


def wait(cond, sec=2.0):
    end = time.time() + sec
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.02)
    return False


def closed_code(ws, tries=200):
    for _ in range(tries):
        try:
            ws.receive_json()
        except WebSocketDisconnect as e:
            return e.code
    return None


def test_handshake_token_and_guest(client):
    with client.websocket_connect("/g/ws", headers=ORIGIN) as a, client.websocket_connect("/g/ws", headers=ORIGIN) as b:
        wa = hello(a, token="tok-0000aaaa")
        wb = hello(b, token="плохой")                           # мир не признал — играет гостем, а не вылетает
        assert wa["guest"] is False and wb["guest"] is True
        assert wa["id"] != wb["id"] and wb["online"] == 2 and len(wa["emo"]) == len(fcg.EMO)
        ca = fcg.clients[wa["id"]]
        assert ca.rid == "0000aaaa" and ca.nick == "Игрок"
        assert fcg.clients[wb["id"]].rid.startswith("g-")


def test_foreign_origin_refused(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/g/ws", headers={"origin": "https://evil.example"}) as ws:
            ws.receive_json()


def test_no_hi_closes(client):
    with client.websocket_connect("/g/ws", headers=ORIGIN) as ws:
        ws.send_json({"t": "s", "p": [0, 0, 0, 0]})
        assert closed_code(ws) == 4002


def test_visibility_radius_and_building(client):
    socks = [client.websocket_connect("/g/ws", headers=ORIGIN) for _ in range(4)]
    a, b, c, d = [s.__enter__() for s in socks]
    try:
        ids = [hello(s, guest="g-test%d" % i)["id"] for i, s in enumerate((a, b, c, d))]
        a.send_json({"t": "s", "p": [0, 0.2, 0, 1.0], "m": 0})
        b.send_json({"t": "s", "p": [100, 0.2, 0, 2.0], "m": 1, "c": "taxi", "k": 0xffd23f})
        c.send_json({"t": "s", "p": [1000, 0.2, 0, 0], "m": 0})
        d.send_json({"t": "s", "p": [5, 0.2, 5, 0], "m": 2, "b": 77})       # внутри здания 77 — снаружи не видно
        A, B, C, D = (fcg.clients[i] for i in ids)
        assert wait(lambda: A.vis == {B.id} and B.vis == {A.id})
        assert C.vis == set() and D.vis == set()
        # кадр соседей приходит с meta (вид существа, без rid и имени) и строкой состояния
        got = None
        for _ in range(50):
            m = a.receive_json()
            if m["t"] == "w":
                got = m
                break
        assert got and got["ps"][0][0] == B.id and got["ps"][0][6] == "taxi"
        assert got["meta"][0] == {"id": B.id, "creature": "lis", "nick": "Гость", "guest": True}
        assert "rid" not in str(got)
        # d заходит в то же здание, что и a
        a.send_json({"t": "s", "p": [3, 0.2, 3, 0], "m": 2, "b": 77})
        assert wait(lambda: A.vis == {D.id} and D.vis == {A.id} and B.vis == set())
    finally:
        for s in socks:
            s.__exit__(None, None, None)


def test_bad_coordinates_and_teleports(client):
    with client.websocket_connect("/g/ws", headers=ORIGIN) as ws:
        cid = hello(ws, guest="g-coords")["id"]
        C = fcg.clients[cid]
        ws.send_json({"t": "s", "p": [5000, 0, 0, 0]})
        ws.send_json({"t": "s", "p": [0, "x", 0, 0]})
        ws.send_text('{"t":"s","p":[NaN,0,0,0]}')
        ws.send_json({"t": "s", "p": [1, 2]})
        assert wait(lambda: C.bad >= 4) and C.state is None
        ws.send_json({"t": "s", "p": [0, 0, 0, 0]})
        assert wait(lambda: C.state is not None)
        # скачки на 1000 м подряд без смены здания — сверх JUMP_FREE за окно отбрасываются
        for i in range(fcg.JUMP_FREE + 1):
            ws.send_json({"t": "s", "p": [1000 if i % 2 == 0 else -1000, 0, 0, 0]})
        assert wait(lambda: C.bad >= 5)
        # а вход в здание (меняется b) — законный скачок, даже сразу после лимита
        ws.send_json({"t": "s", "p": [3, 0, 3, 0], "m": 2, "b": 12})
        assert wait(lambda: C.state and C.state[7] == 12) and C.bad == 5


def test_rate_limit_disconnects(client):
    with client.websocket_connect("/g/ws", headers=ORIGIN) as ws:
        hello(ws, guest="g-spam")
        for _ in range(int(fcg.BURST) + fcg.BAD_LIMIT + 40):
            ws.send_json({"t": "s", "p": [0, 0, 0, 0]})
        assert closed_code(ws) == 4008


def test_oversized_message_counts_as_bad(client):
    with client.websocket_connect("/g/ws", headers=ORIGIN) as ws:
        cid = hello(ws, guest="g-big")["id"]
        ws.send_text('{"t":"s","p":[0,0,0,0],"pad":"' + "x" * 2000 + '"}')
        assert wait(lambda: fcg.clients[cid].bad == 1)


def test_silence_timeout(client, monkeypatch):
    monkeypatch.setattr(fcg, "SILENCE", 0.3)
    with client.websocket_connect("/g/ws", headers=ORIGIN) as ws:
        hello(ws, guest="g-quiet")
        time.sleep(0.8)
        assert closed_code(ws) == 4003


def test_max_connections(client, monkeypatch):
    monkeypatch.setattr(fcg, "MAX_CONN", 1)
    with client.websocket_connect("/g/ws", headers=ORIGIN) as a:
        hello(a, guest="g-first")
        with client.websocket_connect("/g/ws", headers=ORIGIN) as b:
            assert closed_code(b) == 1013


def test_silent_sockets_take_a_place_and_are_closed(client, monkeypatch):
    """Аудит M-4: сокеты без hi раньше не считались в MAX_CONN и висели 10 с."""
    monkeypatch.setattr(fcg, "MAX_CONN", 2)
    monkeypatch.setattr(fcg, "HI_WAIT", 0.4)
    with client.websocket_connect("/g/ws", headers=ORIGIN) as a, client.websocket_connect("/g/ws", headers=ORIGIN) as b:
        assert wait(lambda: fcg._hello[0] == 2)                # оба молчат — оба занимают место
        with client.websocket_connect("/g/ws", headers=ORIGIN) as c:
            assert closed_code(c) == 1013
        assert closed_code(a) == 4002 and closed_code(b) == 4002   # hi не пришёл за HI_WAIT — закрыты
    assert wait(lambda: fcg._hello[0] == 0)
    with client.websocket_connect("/g/ws", headers=ORIGIN) as d:   # место освободилось
        hello(d, guest="g-after")


def test_huge_frame_closes_socket(client):
    with client.websocket_connect("/g/ws", headers=ORIGIN) as ws:
        hello(ws, guest="g-huge")
        ws.send_text("x" * (fcg.FRAME_MAX + 1))
        assert closed_code(ws) == 1009
    with client.websocket_connect("/g/ws", headers=ORIGIN) as ws:
        hello(ws, guest="g-huge2")
        ws.send_bytes(b"x" * (fcg.FRAME_MAX + 1))
        assert closed_code(ws) == 1009


def test_second_tab_replaces_first(client):
    with client.websocket_connect("/g/ws", headers=ORIGIN) as a:
        hello(a, token="tok-0000bbbb")
        with client.websocket_connect("/g/ws", headers=ORIGIN) as b:
            wb = hello(b, token="tok-0000bbbb")
            assert closed_code(a) == 4000
            assert fcg.by_rid["0000bbbb"].id == wb["id"]


def test_emotes_only_from_list(client):
    with client.websocket_connect("/g/ws", headers=ORIGIN) as a, client.websocket_connect("/g/ws", headers=ORIGIN) as b:
        ia = hello(a, guest="g-emoa")["id"]
        hello(b, guest="g-emob")
        a.send_json({"t": "s", "p": [0, 0, 0, 0]})
        b.send_json({"t": "s", "p": [10, 0, 0, 0]})
        assert wait(lambda: fcg.clients[ia].vis)
        a.send_json({"t": "emo", "k": "мат"})
        a.send_json({"t": "emo", "k": 2})
        seen = None
        for _ in range(80):
            m = b.receive_json()
            if m["t"] == "emo":
                seen = m
                break
        assert seen == {"t": "emo", "id": ia, "k": 2}
        assert fcg.clients[ia].bad == 1


def test_save_load_top(client):
    save = {"v": 1, "money": 1200, "stats": {"earned": 5400, "playMin": 33.5}, "biz": {"shawarma": 1}}
    assert client.post("/g/save", json={"token": "плохой", "save": save}).status_code == 401
    r = client.post("/g/save", json={"token": "tok-0000cccc", "save": save, "creature": "sova"})
    assert r.status_code == 200, r.text
    assert client.post("/g/save", json={"token": "tok-0000cccc", "save": save}).status_code == 429
    assert client.post("/g/load", json={"token": "tok-0000cccc"}).json()["save"] == save
    assert client.post("/g/load", json={"token": "tok-0000dddd"}).json()["save"] is None
    big = {"pad": "x" * (fcg.SAVE_MAX + 10)}
    assert client.post("/g/save", json={"token": "tok-0000eeee", "save": big}).status_code == 413
    top = client.get("/g/top").json()["top"]
    assert top[0] == {"creature": "sova", "name": "Игрок", "earned": 5400, "playmin": 34}
    assert "rid" not in str(top) and "0000cccc" not in str(top)
    st = client.get("/g/stats").json()
    assert st["players_total"] >= 1 and st["online"] == 0
    assert client.get("/g/health").json()["ok"] is True


def test_cors_and_beacon_body(client):
    ok = client.options("/g/save", headers={"origin": "https://game.example.org", "access-control-request-method": "POST",
                                             "access-control-request-headers": "content-type"})
    assert ok.status_code == 200 and ok.headers.get("access-control-allow-origin") == "https://game.example.org"
    bad = client.options("/g/save", headers={"origin": "https://evil.example", "access-control-request-method": "POST"})
    assert "access-control-allow-origin" not in bad.headers
    # маяк при закрытии вкладки шлёт text/plain (без preflight) — тело всё равно JSON
    r = client.post("/g/save", content='{"token":"tok-0000ffff","save":{"v":1,"stats":{"earned":7}}}',
                    headers={"content-type": "text/plain;charset=UTF-8"})
    assert r.status_code == 200, r.text
    assert client.post("/g/load", json={"token": "tok-0000ffff"}).json()["save"]["stats"]["earned"] == 7


def test_cities_do_not_mix(client):
    """Минск 1:1 и Флейм-Сити — разные координаты: игроки видят только свой город; у Минска шире граница."""
    socks = [client.websocket_connect("/g/ws", headers=ORIGIN) for _ in range(3)]
    a, b, c = [s.__enter__() for s in socks]
    try:
        ia = hello(a, guest="g-city0", city="minsk")["id"]
        ib = hello(b, guest="g-city1")["id"]
        ic = hello(c, guest="g-city2", city="minsk")["id"]
        A, B, C = (fcg.clients[i] for i in (ia, ib, ic))
        assert (A.city, B.city, C.city) == ("minsk", "flame", "minsk")
        a.send_json({"t": "s", "p": [0, 0.2, 0, 0], "m": 0})
        b.send_json({"t": "s", "p": [5, 0.2, 0, 0], "m": 0})
        c.send_json({"t": "s", "p": [10, 0.2, 0, 0], "m": 0})
        assert wait(lambda: A.vis == {C.id} and C.vis == {A.id})
        assert B.vis == set()
        # координаты Минска за пределами Флейм-Сити — принимаются только от игрока Минска
        a.send_json({"t": "s", "p": [9000, 0.2, -4000, 0], "m": 0})
        assert wait(lambda: A.state and A.state[0] == 9000)
        b.send_json({"t": "s", "p": [9000, 0.2, -4000, 0], "m": 0})
        time.sleep(0.2)
        assert B.state[0] == 5
    finally:
        for s in socks:
            s.__exit__(None, None, None)


def test_city_numbers(client):
    """Город в цифрах (stats.py): кто заходил, сегодня, рекорд онлайна, по городам — без rid и ников наружу."""
    import stats
    stats._cache.clear()
    with client.websocket_connect("/g/ws", headers=ORIGIN) as a, client.websocket_connect("/g/ws", headers=ORIGIN) as b:
        hello(a, guest="g-numa", city="minsk")
        hello(b, token="tok-0000a0a0")
        st = client.get("/g/stats").json()
        assert st["online"] == 2 and st["cities"] == {"minsk": 1, "flame": 1}
        assert st["today"]["peak"] >= 2 and st["peak_all"] >= 2 and st["peak"] >= 2
        assert st["today"]["visitors"] >= 2 and st["today"]["new"] >= 2 and st["visitors_total"] >= 2
        assert len(st["days"]) == 14 and st["days"][-1]["day"] == stats.day_of(time.time())
        assert "g-numa" not in str(st) and "0000a0a0" not in str(st)
    assert wait(lambda: not fcg.clients)
    stats._cache.clear()
    with client.websocket_connect("/g/ws", headers=ORIGIN) as a:     # тот же гость снова — не новый человек
        hello(a, guest="g-numa", city="minsk")
        st2 = client.get("/g/stats").json()
    assert st2["visitors_total"] == st["visitors_total"] and st2["today"]["sessions"] == st["today"]["sessions"] + 1
    assert st2["peak_all"] >= 2 and st2["online"] == 1


def test_announce_update(client, monkeypatch):
    """Новая версия (pull-live.sh → /g/admin/announce): всем в онлайне — «перезагрузка через N с»; без ключа — 404."""
    monkeypatch.setenv("FC_ADMIN_KEY", "test-admin-key")
    with client.websocket_connect("/g/ws", headers=ORIGIN) as a:
        hello(a, guest="g-upda")
        assert client.post("/g/admin/announce", json={"v": "abc1234"}).status_code == 404
        h = {"x-admin-key": "test-admin-key"}
        assert client.post("/g/admin/announce", json={"v": "../x"}, headers=h).status_code == 400
        r = client.post("/g/admin/announce", json={"v": "abc1234", "in": 999, "server": True}, headers=h)
        assert r.status_code == 200 and r.json()["sent"] == 1
        for _ in range(80):
            m = a.receive_json()
            if m["t"] == "upd":
                break
        assert m == {"t": "upd", "v": "abc1234", "in": 60, "server": True}
