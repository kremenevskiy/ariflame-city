"""Режимы онлайна Флейм-Сити (server/modes.py): гонка по серверному времени и её дисквалификации, итоги
недели и админ-ручка, честность сохранений и топ, «коп против вора», совместный налёт, рейтинг районов.

Логику гоняем напрямую (часы режимов подменены — MODES.now), без сокета: 400 позиций гонки через сокет упёрлись бы в
лимит сообщений в секунду. Сокет и HTTP — только там, где проверяем подключение к app.py.

    python -m pytest server/tests/test_modes.py -q
"""
from __future__ import annotations

import asyncio
import importlib.util
import math
import os
import sys
import tempfile
import time
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
os.environ.setdefault("FC_DB", os.path.join(tempfile.mkdtemp(prefix="fcg-test-"), "game.db"))
os.environ["FC_WORLD"] = "fake"
os.environ["FC_ORIGINS"] = "https://game.example.org"
os.environ["FC_ADMIN_KEY"] = "test-admin-key"

_spec = importlib.util.spec_from_file_location("fcg_app_modes", GAME / "app.py")
fcg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fcg)
M = fcg.fcmodes

from fastapi.testclient import TestClient  # noqa: E402


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


class Fake:
    """Игрок без сокета: то же, что Client, в части, которую читают режимы."""
    _n = 100

    def __init__(self, rid="0000aaaa", guest=False, x=0.0, z=0.0, m=1):
        Fake._n += 1
        self.id, self.rid, self.guest, self.creature, self.nick = Fake._n, rid, guest, "lis", "Лис"
        self.state = [x, 0.0, z, 0.0, m, "sport" if m == 1 else "", 0, None, 0, 0]
        self.vis = set()


@pytest.fixture()
def env():
    sent = []

    async def send(c, msg):
        sent.append((c.id, msg))
        return True
    clients = {}
    md = M.Modes(fcg.db, send, clients)
    clk = Clock()
    md.now = clk
    md.db()
    with fcg.db().lock:
        for t in ("races", "weekly_winners", "honest", "districts", "district_week"):
            fcg.db().db.execute(f"DELETE FROM {t}")
    return md, clk, sent, clients


def ev(sent, cid, t=None, e=None):
    return [m for i, m in sent if i == cid and (t is None or m.get("t") == t) and (e is None or m.get("e") == e)]


def move(md, clk, c, x, z, m=1, dt=0.1):
    clk.t += dt
    c.state[0], c.state[2], c.state[4] = x, z, m
    md.on_pos(c)


def drive(md, clk, c, pts, v=30.0, dt=0.1):
    """Провести игрока по ломаной со скоростью v (м/с), позиции каждые dt."""
    for i in range(1, len(pts)):
        ax, az = pts[i - 1]
        bx, bz = pts[i]
        L = math.hypot(bx - ax, bz - az)
        n = max(1, int(L / (v * dt)))
        for k in range(1, n + 1):
            move(md, clk, c, ax + (bx - ax) * k / n, az + (bz - az) * k / n, dt=L / n / v)


def run(coro_fn):
    async def wrap():
        await coro_fn()
        await asyncio.sleep(0.05)                    # дать отработать задачам, которые ставит on_pos
    asyncio.run(wrap())


TR = M.BY_ID["minsk"]


def test_tracks_loaded_and_on_both_sides():
    assert len(M.TRACKS["tracks"]) >= 8
    assert all(len(t["cps"]) >= 3 and t["len"] > 500 for t in M.TRACKS["tracks"])
    assert M.week_track(M.week_of())["id"] in M.BY_ID


def test_honest_race_counts_server_time(env):
    md, clk, sent, clients = env
    sx, sz = TR["cps"][0]
    c = Fake(x=sx, z=sz)
    clients[c.id] = c

    async def go():
        for _ in range(8):                           # постоять на старте — скорость ~0
            move(md, clk, c, sx, sz)
        assert await md.race_start(c, "minsk")
        assert ev(sent, c.id, "race", "go")
        drive(md, clk, c, TR["cps"], v=30)
        await asyncio.sleep(0.05)
    run(go)
    done = ev(sent, c.id, "race", "done")
    assert done, [m for _, m in sent]
    ms = done[0]["ms"]
    assert abs(ms - TR["len"] / 30 * 1000) < 2500                # время — по часам сервера, а не клиента
    assert done[0]["best"] == ms and done[0]["rank"] == 1
    assert md.board("minsk", done[0]["weekly"])[0]["ms"] == ms


@pytest.mark.parametrize("cheat,why", [
    ("teleport", "телепорт"), ("fast", "скорость"), ("foot", "вышел из машины")])
def test_race_disqualified(env, cheat, why):
    md, clk, sent, clients = env
    sx, sz = TR["cps"][0]
    c = Fake(x=sx, z=sz)
    clients[c.id] = c

    async def go():
        for _ in range(8):
            move(md, clk, c, sx, sz)
        await md.race_start(c, "minsk")
        drive(md, clk, c, TR["cps"][:2], v=25)
        if cheat == "teleport":
            move(md, clk, c, TR["cps"][-1][0], TR["cps"][-1][1])
        elif cheat == "fast":
            drive(md, clk, c, TR["cps"][1:], v=160)
        else:
            move(md, clk, c, c.state[0] + 1, c.state[2], m=0)
        await asyncio.sleep(0.05)
    run(go)
    dq = ev(sent, c.id, "race", "dq")
    assert dq and why in dq[-1]["why"]
    assert not ev(sent, c.id, "race", "done")
    assert c.id not in md.races


def test_start_rules(env):
    md, clk, sent, clients = env
    sx, sz = TR["cps"][0]
    far = Fake(x=sx + 200, z=sz)
    onfoot = Fake(x=sx, z=sz, m=0)
    rolling = Fake(x=sx, z=sz)

    async def go():
        await md.race_start(far, "minsk")
        await md.race_start(onfoot, "minsk")
        for i in range(8):
            move(md, clk, rolling, sx + i * 2.0, sz)       # 20 м/с — разгон до старта не в зачёт
        await md.race_start(rolling, "minsk")
        assert not await md.race_start(far, "нет-такой")
    run(go)
    assert "флажку" in ev(sent, far.id, "race", "dq")[0]["why"]
    assert "машин" in ev(sent, onfoot.id, "race", "dq")[0]["why"]
    assert "остановись" in ev(sent, rolling.id, "race", "dq")[0]["why"]
    assert not md.races


def test_weekly_winners_and_admin(env):
    md, clk, sent, clients = env
    w = M.week_of() - 1
    tid = M.week_track(w)["id"]
    with fcg.db().lock:
        for rid, ms in (("000000a1", 90000), ("000000a2", 80000), ("000000a3", 99000), ("000000a4", 120000), ("000000a2", 85000)):
            fcg.db().db.execute("INSERT INTO races (rid, track, week, ms, creature, at) VALUES (?, ?, ?, ?, 'lis', 0)", (rid, tid, w, ms))
    md.close_weeks()
    rows = md.q("SELECT place, rid, ms FROM weekly_winners WHERE week = ? AND place > 0 ORDER BY place", (w,))
    assert [(r["rid"], r["ms"]) for r in rows] == [("000000a2", 80000), ("000000a1", 90000), ("000000a3", 99000)]
    md.close_weeks()                                    # повтор не дублирует
    assert len(md.q("SELECT 1 FROM weekly_winners WHERE week = ? AND place > 0", (w,))) == 3
    fcg.MODES.schema_ready = True
    with TestClient(fcg.app) as tc:
        assert tc.get("/g/admin/winners").status_code == 404
        assert tc.get("/g/admin/winners", headers={"x-admin-key": "wrong-key"}).status_code == 404
        r = tc.get("/g/admin/winners", headers={"x-admin-key": "test-admin-key"})
        assert r.status_code == 200 and any(x["rid"] == "000000a2" and x["place"] == 1 for x in r.json()["winners"])
        rr = tc.get("/g/races").json()
        assert rr["weekly"] in M.BY_ID and set(rr["boards"]) == set(M.BY_ID) and rr["last"][0]["place"] == 1
        assert "000000a2" not in str(rr)                # публично — без rid


def save(earned, pm, money=500, bank=0):
    return {"v": 1, "money": money, "bank": bank, "stats": {"earned": earned, "playMin": pm}}


def test_save_honesty_rollback_and_top(env):
    md, clk, sent, clients = env
    t = 1_800_000_000.0
    ok, back, why = md.check_save("0000c0de", save(1000, 2), now=t)
    assert ok
    ok, back, why = md.check_save("0000c0de", save(9000, 4), now=t + 130)          # 2 мин игры — $8000: честно
    assert ok, why
    ok, back, why = md.check_save("0000c0de", save(5_000_000, 5, money=4_000_000), now=t + 200)
    assert not ok and back["stats"]["earned"] == 9000 and "заработ" in why
    ok, back, why = md.check_save("0000c0de", save(20000, 60), now=t + 260)          # время игры быстрее часов
    assert not ok and "часов" in why
    ok, back, why = md.check_save("0000c0de", save(9000, 6, money=50000), now=t + 400)
    assert not ok and "больше, чем заработано" in why
    assert md.cheat_of("0000c0de") == 3
    ok, back, why = md.check_save("0000c0de", save(0, 0), now=t + 500)              # «начать заново» — честный сброс
    assert ok
    ok, back, why = md.check_save("0000beef", save(10_000_000, 1), now=t)           # первое сохранение без базы
    assert not ok and back is None
    # топ — только честные
    fcg.db().save("0000c0de", "lis", "{}", 999999, 10)
    fcg.db().save("0000f00d", "kot", "{}", 1000, 10)
    names = [x["creature"] for x in fcg.db().top(20)]
    assert "kot" in names and "lis" not in names


def test_save_endpoint_rolls_back(env):
    md, clk, sent, clients = env
    fcg.MODES.schema_ready = True
    with fcg.db().lock:
        fcg.db().db.execute("DELETE FROM honest")
    fcg._saved_at.clear()
    with TestClient(fcg.app) as tc:
        assert tc.post("/g/save", json={"token": "tok-00000abc", "save": save(1000, 3)}).json()["ok"] is True
        fcg._saved_at.clear()
        r = tc.post("/g/save", json={"token": "tok-00000abc", "save": save(90_000_000, 3.1, money=1000)}).json()
        assert r["ok"] is False and r["rolled"] is True and r["save"]["stats"]["earned"] == 1000


def two_rooms(md, kind, n):
    cs = [Fake(rid=f"0000aa{i:02d}", x=i * 10.0, z=0.0, m=1) for i in range(n)]
    for c in cs:
        md.clients[c.id] = c
    for c in cs:
        c.vis = {o.id for o in cs if o is not c}
    return cs


def test_cop_vs_thief(env, monkeypatch):
    md, clk, sent, clients = env
    cs = two_rooms(md, "cvt", 3)

    async def go():
        assert await md.room_msg(cs[0], {"a": "create", "kind": "cvt"})
        room = md.room_of[cs[0].id]
        assert ev(sent, cs[1].id, "room", "invite")[0]["room"] == room
        for c in cs[1:]:
            await md.room_msg(c, {"a": "join", "room": room})
        monkeypatch.setattr(M.random, "sample", lambda pop, k: [cs[2].id])
        await md.room_msg(cs[1], {"a": "start"})                      # не хозяин — нельзя
        assert md.rooms[room]["phase"] == "lobby"
        await md.room_msg(cs[0], {"a": "start"})
        R = md.rooms[room]
        assert R["phase"] == "run" and R["roles"][cs[2].id] == "thief"
        cs[0].state[0], cs[0].state[2] = cs[2].state[0] + 2, cs[2].state[2]   # коп в машине вплотную — но фора
        clk.t += 5
        await md.tick(clk.t)
        assert not R["caught"]
        clk.t += 20
        await md.tick(clk.t)
        assert cs[2].id in R.get("caught", set()) or R["phase"] == "lobby"
    run(go)
    end = ev(sent, cs[0].id, "room", "end")
    assert end and end[0]["win"] == "cops" and int(end[0]["pay"][str(cs[0].id)]) > 0
    assert ev(sent, cs[1].id, "room", "catch")[0]["thief"] == cs[2].id


def test_thieves_win_on_time(env, monkeypatch):
    md, clk, sent, clients = env
    cs = two_rooms(md, "cvt", 2)
    cs[1].state[0] = 900.0                                               # вор далеко

    async def go():
        await md.room_msg(cs[0], {"a": "create", "kind": "cvt"})
        room = md.room_of[cs[0].id]
        cs[1].state[0] = 30.0
        await md.room_msg(cs[1], {"a": "join", "room": room})
        cs[1].state[0] = 900.0
        monkeypatch.setattr(M.random, "sample", lambda pop, k: [cs[1].id])
        await md.room_msg(cs[0], {"a": "start"})
        clk.t += M.ROUND + 1
        await md.tick(clk.t)
    run(go)
    end = ev(sent, cs[1].id, "room", "end")[0]
    assert end["win"] == "thieves" and end["pay"][str(cs[1].id)] > end["pay"][str(cs[0].id)]


def test_coop_van_heist(env):
    md, clk, sent, clients = env
    cs = two_rooms(md, "coop", 3)

    async def go():
        await md.room_msg(cs[0], {"a": "create", "kind": "coop"})
        room = md.room_of[cs[0].id]
        for c in cs[1:]:
            await md.room_msg(c, {"a": "join", "room": room})
        R = md.rooms[room]
        assert sorted(R["roles"].values()) == ["driver", "hacker", "loader"]
        await md.room_msg(cs[0], {"a": "start"})
        v0 = list(R["van"])
        clk.t += 1.0
        await md.tick(clk.t)
        assert R["van"] != v0                                         # фургон едет сам
        far = Fake(x=R["van"][0] + 300, z=R["van"][1])
        md.clients[far.id] = far
        md.room_of[far.id] = room
        R["members"].append(far.id)
        assert await md.coop_msg(far, {"a": "hit", "p": 30})          # далеко — удар не засчитан
        assert R["vhp"] == M.VAN_HP
        for c in cs:
            c.state[0], c.state[2], c.state[4] = R["van"][0] + 2, R["van"][1], 1
        for _ in range(6):
            for c in cs:
                clk.t += 0.3
                await md.coop_msg(c, {"a": "hit", "p": 30})
        assert R["step"] == "doors"
        for c in cs:
            c.state[4] = 0
        for _ in range(50):
            clk.t += 0.2
            await md.tick(clk.t)
        assert R["step"] == "loot" and R["bags"] == M.BAGS
        for _ in range(3):
            for c in cs:
                await md.coop_msg(c, {"a": "bag"})
        assert R["bags"] == M.BAGS - 4 or R["step"] == "escape"       # хакер 1, водитель 1, грузчик 2 мешка
        R["members"].remove(far.id)
        md.room_of.pop(far.id, None)
        R["bags"] = 0
        R["step"] = "escape"
        dx, dz = R["drop"]
        for c in cs:
            c.state[0], c.state[2] = dx + 1, dz
        await md.tick(clk.t + 0.1)
    run(go)
    end = [m for _, m in sent if m.get("t") == "room" and m.get("e") == "end"]
    assert end and end[0]["how"] == "win" and end[0]["total"] == 4 * M.BAG_PAY
    assert len({v for v in end[0]["pay"].values()}) == 1                # поровну


def test_districts_and_bonus(env):
    md, clk, sent, clients = env
    assert md.set_district("0000d001", "msk") and md.set_district("0000d002", "ala")
    assert not md.set_district("0000d001", "ala")                       # раз в неделю
    assert not md.set_district("0000d003", "Луна")
    md.add_points("0000d001", 300)
    md.add_points("0000d002", 100)
    md.add_points_week(M.week_of() - 1, "minsk", 50)
    d = md.districts()
    assert d["table"][0]["d"] == "msk" and d["leader"] == "minsk" and d["bonus"] == 0.1


def test_socket_frames_accepted(env):
    fcg.MODES.schema_ready = True
    with TestClient(fcg.app) as tc:
        with tc.websocket_connect("/g/ws", headers={"origin": "https://game.example.org"}) as ws:
            ws.send_json({"t": "hi", "token": "tok-0000e001", "creature": "lis", "v": 1, "d": "msk"})
            w = ws.receive_json()
            assert w["t"] == "welcome" and w["modes"] == 1
            ws.send_json({"t": "s", "p": [0, 0, 0, 0], "m": 1, "c": "sport"})
            ws.send_json({"t": "race", "a": "start", "id": "minsk"})
            got = None
            for _ in range(50):
                m = ws.receive_json()
                if m.get("t") == "race":
                    got = m
                    break
            assert got and got["e"] == "dq" and "флажку" in got["why"]
            ws.send_json({"t": "room", "a": "create", "kind": "cvt"})
            for _ in range(50):
                m = ws.receive_json()
                if m.get("t") == "room":
                    assert m["e"] == "state" and m["kind"] == "cvt"
                    break
        time.sleep(0.05)
    assert fcg.MODES.q("SELECT d FROM districts WHERE rid = '0000e001'", one=True)["d"] == "msk"


def test_who_friends_locate(env):
    md, clk, sent, clients = env
    with fcg.db().lock:
        fcg.db().db.execute("DELETE FROM friends")
        fcg.db().db.execute("DELETE FROM friend_req")
    a, b, g = Fake(rid="0000f0a1", x=103.0, z=-47.0, m=0), Fake(rid="0000f0b2", x=900.0, z=900.0, m=3), Fake(rid="g-guest1", guest=True)
    b.creature = "kot"
    for c in (a, b, g):
        clients[c.id] = c
    fcg.db().touch("0000f0a1", "lis")
    fcg.db().touch("0000f0b2", "kot")

    async def go():
        await md.social(a, {"t": "who", "q": 7})
        await md.social(a, {"t": "who", "q": 8})                      # чаще раза в 3 с — «подожди»
        await md.social(a, {"t": "friend", "a": "add", "id": b.id})
        clk.t += 2
        await md.social(g, {"t": "friend", "a": "add", "id": a.id})   # гость дружить не может
        await md.social(b, {"t": "friends", "q": 1})
        await md.social(b, {"t": "friend", "a": "accept", "id": a.id})
        clk.t += 2
        await md.social(a, {"t": "friends", "q": 2})
        clk.t += 4
        await md.social(a, {"t": "who", "q": 9})
        await md.social(a, {"t": "locate", "q": 3, "id": b.id})
        await md.social(a, {"t": "locate", "q": 4, "id": b.id})       # чаще раза в секунду — отказ
        clk.t += 2
        await md.social(a, {"t": "locate", "q": 5, "id": 999999})
    run(go)
    who = [m for i, m in sent if i == a.id and m.get("t") == "who"]
    ps = {p["id"]: p for p in who[0]["ps"]}
    assert ps[a.id]["me"] and ps[a.id]["x"] == 100 and ps[a.id]["z"] == -40          # огрублено до 20 м
    assert ps[b.id]["m"] == 3 and not ps[b.id]["friend"] and "rid" not in str(who[0])
    assert "wait" in who[1]
    assert {p["id"]: p for p in who[2]["ps"]}[b.id]["friend"] is True
    req = [m for i, m in sent if i == b.id and m.get("t") == "friend" and m.get("e") == "req"]
    assert req and req[0]["id"] == a.id and "0000f0a1" not in str(req)
    fb = [m for i, m in sent if i == b.id and m.get("t") == "friends"][0]
    assert fb["req"] and fb["req"][0]["creature"] == "lis"
    assert [m for i, m in sent if i == g.id and m.get("e") == "err"]
    fa = [m for i, m in sent if i == a.id and m.get("t") == "friends"][0]
    assert len(fa["ps"]) == 1 and fa["ps"][0]["online"] and fa["ps"][0]["id"] == b.id and fa["ps"][0]["creature"] == "kot"
    loc = [m for i, m in sent if i == a.id and m.get("t") == "locate"]
    assert loc[0]["ok"] and loc[0]["x"] == 900 and loc[0]["z"] == 900
    assert loc[1]["ok"] is False and loc[2]["ok"] is False

    async def rm():
        clk.t += 2
        await md.social(a, {"t": "friend", "a": "remove", "fid": fa["ps"][0]["fid"]})
    run(rm)
    assert not md.friend_rids("0000f0a1") and not md.friend_rids("0000f0b2")


def test_counter_request_makes_friends(env):
    md, clk, sent, clients = env
    with fcg.db().lock:
        fcg.db().db.execute("DELETE FROM friends")
        fcg.db().db.execute("DELETE FROM friend_req")
    a, b = Fake(rid="0000f1a1"), Fake(rid="0000f1b2")
    clients[a.id] = a
    clients[b.id] = b

    async def go():
        await md.social(a, {"t": "friend", "a": "add", "id": b.id})
        await md.social(b, {"t": "friend", "a": "add", "id": a.id})   # встречный запрос — сразу дружба
    run(go)
    assert md.friend_rids("0000f1a1") == ["0000f1b2"] and md.friend_rids("0000f1b2") == ["0000f1a1"]
    assert [m for i, m in sent if i == a.id and m.get("e") == "added"]


def test_air_states_over_socket(env):
    fcg.MODES.schema_ready = True
    with TestClient(fcg.app) as tc:
        with tc.websocket_connect("/g/ws", headers={"origin": "https://game.example.org"}) as ws:
            ws.send_json({"t": "hi", "token": "tok-0000a1a1", "creature": "lis", "v": 1})
            w = ws.receive_json()
            ws.send_json({"t": "s", "p": [2000, 700, -1900, 1.0], "m": 3, "c": "plane_jet"})
            time.sleep(0.15)
            c = fcg.clients[w["id"]]
            assert c.state[4] == 3 and c.state[5] == "plane_jet" and c.state[1] == 700
            bad0 = c.bad
            ws.send_json({"t": "s", "p": [2000, 0, -1900, 1.0], "m": 0})      # пешком за городом — мимо
            ws.send_json({"t": "s", "p": [100, 0, 100, 0], "m": 4})
            time.sleep(0.15)
            assert c.bad == bad0 + 1 and c.state[4] == 4
