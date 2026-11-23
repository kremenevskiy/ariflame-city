"""Кланы (crews.py) и война за районы (war.py): состав, роли, чат с фильтром, общак, штаб, помощь, цели, районы.

Без сети и Postgres: мир подменён (FC_WORLD=fake — токен «tok-<rid>» = rid), база — файл во временной папке.
Время окон войны — параметр now у функций модулей.

    python -m pytest server/tests/test_crews.py -q
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import time
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
os.environ.setdefault("FC_DB", os.path.join(tempfile.mkdtemp(prefix="fcg-crews-"), "game.db"))
os.environ["FC_WORLD"] = "fake"
os.environ.setdefault("FC_ORIGINS", "https://game.example.org")

_spec = importlib.util.spec_from_file_location("fcg_app_crews", GAME / "app.py")
fcg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fcg)
import crews as C  # noqa: E402
import progress as PG  # noqa: E402
import realty as R  # noqa: E402
import season as S  # noqa: E402
import war as W  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

TOK = {n: f"tok-{n}" for n in ("aaaa0001", "bbbb0002", "cccc0003", "dddd0004")}
RA, RB, RC, RD = "aaaa0001", "bbbb0002", "cccc0003", "dddd0004"
TABLES = ("props", "biz", "season_team", "season_pts", "season_me", "season_hold", "credit", "honest", "prog", "prog_city",
          "prog_week", "biz_week", "biz_total", "infl_me", "ach", "crews", "crew_mem", "crew_req", "crew_chat",
          "crew_help", "crew_goal", "crew_claim", "crew_left", "war_pts", "war_me", "war_hold", "war_log", "war_eval")
SAT = W.windows(W.week_of(1_800_000_000))[0]                    # окно войны субботы недели 1.8e9


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(R, "EVERY", 0.0)
    monkeypatch.setattr(R, "ACT_EVERY", 0.0)
    monkeypatch.setattr(C, "ACT_EVERY", 0.0)
    monkeypatch.setattr(C, "SAY_EVERY", 0.0)
    fcg._tok.clear()
    R._acted.clear()
    C._say.clear()
    W._hold_t.clear()
    W._cache.clear()
    PG._cache.clear()
    fcg.by_rid.clear()
    with TestClient(fcg.app) as c:
        st = fcg.db()
        C.ensure(st)
        fcg.MODES.db()
        with st.lock:
            for t in TABLES:
                st.db.execute(f"DELETE FROM {t}")
        yield c


def st():
    return fcg.db()


def lvl(rid, n):
    s = st()
    with s.lock:
        PG.row_of(s.db, rid)
        s.db.execute("UPDATE prog SET xp = ?, lvl = ? WHERE rid = ?", (PG.need(n), n, rid))


def fid(rid):
    s = st()
    with s.lock:
        return PG.row_of(s.db, rid)["fid"]


def make_crew(c, rid=RA, tag="ОГН", mode="open"):
    lvl(rid, 6)
    r = c.post("/g/crew/create", json={"token": TOK[rid], "tag": tag, "name": "Огненные", "color": 2, "emblem": 1, "mode": mode})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def prop(rid, key, dist, city="flame", cls="com", landmark=1, x=0.0, z=0.0, addr="Башня Огня"):
    s = st()
    with s.lock:
        s.db.execute("""INSERT INTO props (city, bkey, owner_rid, cls, kind, price, bought_at, x, z, dist, landmark, addr)
                        VALUES (?, ?, ?, ?, 'biz', 100000, 0, ?, ?, ?, ?, ?)""", (city, key, rid, cls, x, z, dist, landmark, addr))


# ------------------------------------------------------------------ фильтр
def test_clean_filter():
    for bad in ("ХУЙ", "х у й", "xyй", "п1зда".replace("1", "и"), "блядь", "Bl yat".replace(" ", ""), "сука", "fuck you",
                "заходи t.me/abc", "звони +375 29 123 45 67", "@spammer", "жыве беларусь", "лукашенко", "1488"):
        assert C.clean(bad), bad
    for ok in ("Огненные", "Небо над городом", "ребята, все в штаб", "корабль", "Погоня за районом", "Хлеба и зрелищ",
               "BOSS"):
        assert C.clean(ok) is None, ok


# ------------------------------------------------------------------ создание, вступление, роли
def test_create_rules(client):
    lvl(RA, 3)
    r = client.post("/g/crew/create", json={"token": TOK[RA], "tag": "AB", "name": "Тест клан"})
    assert r.status_code == 403                                 # уровень
    cid = make_crew(client)
    assert client.post("/g/crew/create", json={"token": TOK[RA], "tag": "XY", "name": "Второй"}).status_code == 409
    lvl(RB, 6)
    assert client.post("/g/crew/create", json={"token": TOK[RB], "tag": "огн", "name": "Копия"}).status_code == 409
    assert client.post("/g/crew/create", json={"token": TOK[RB], "tag": "СУКА", "name": "Норм"}).status_code == 400
    assert client.post("/g/crew/create", json={"token": TOK[RB], "tag": "A", "name": "Норм"}).status_code == 400
    me = client.post("/g/crew/me", json={"token": TOK[RA]}).json()
    assert me["crew"]["id"] == cid and me["role"] == "leader" and me["crew"]["tag"] == "ОГН"
    assert len(me["goals"]) == 3
    s = st()
    with s.lock:
        assert "founder" in json.loads(s.db.execute("SELECT titles FROM prog WHERE rid = ?", (RA,)).fetchone()["titles"])


def test_join_modes_roles_kick_leave(client):
    cid = make_crew(client, mode="req")
    r = client.post("/g/crew/join", json={"token": TOK[RB], "id": cid}).json()
    assert r["asked"] and not r["joined"]
    me = client.post("/g/crew/me", json={"token": TOK[RA]}).json()
    assert [a["fid"] for a in me["asks"]] == [fid(RB)]
    assert client.post("/g/crew/decide", json={"token": TOK[RA], "fid": fid(RB), "yes": True}).status_code == 200
    # приглашение
    client.post("/g/crew/invite", json={"token": TOK[RA], "fid": fid(RC)})
    inv = client.post("/g/crew/me", json={"token": TOK[RC]}).json()
    assert inv["crew"] is None and inv["invites"][0]["id"] == cid
    assert client.post("/g/crew/answer", json={"token": TOK[RC], "id": cid, "yes": True}).json()["joined"]
    # роли: заместитель может исключить участника, но не заместителя
    assert client.post("/g/crew/role", json={"token": TOK[RA], "fid": fid(RB), "role": "deputy"}).status_code == 200
    assert client.post("/g/crew/role", json={"token": TOK[RB], "fid": fid(RC), "role": "deputy"}).status_code == 403
    assert client.post("/g/crew/kick", json={"token": TOK[RC], "fid": fid(RB)}).status_code == 403
    assert client.post("/g/crew/kick", json={"token": TOK[RB], "fid": fid(RC)}).status_code == 200
    # исключённый — пауза до другого клана
    lvl(RD, 6)
    cid2 = client.post("/g/crew/create", json={"token": TOK[RD], "tag": "ZZ", "name": "Другие", "mode": "open"}).json()["id"]
    assert client.post("/g/crew/join", json={"token": TOK[RC], "id": cid2}).status_code == 429
    # лидер уходит — клан ведёт заместитель
    assert client.post("/g/crew/leave", json={"token": TOK[RA]}).json()["disbanded"] is False
    me = client.post("/g/crew/me", json={"token": TOK[RB]}).json()
    assert me["role"] == "leader"
    assert client.post("/g/crew/leave", json={"token": TOK[RB]}).json()["disbanded"] is True
    assert client.get("/g/crew", params={"id": cid}).status_code == 404


def test_cap_30(client, monkeypatch):
    monkeypatch.setattr(C, "CREW_MAX", 2)
    cid = make_crew(client)
    assert client.post("/g/crew/join", json={"token": TOK[RB], "id": cid}).json()["joined"]
    assert client.post("/g/crew/join", json={"token": TOK[RC], "id": cid}).status_code == 403


# ------------------------------------------------------------------ чат
def test_chat_presets_text_filter_rate(client, monkeypatch):
    make_crew(client)
    assert client.post("/g/crew/say", json={"token": TOK[RA], "k": "p", "v": 1}).json()["msg"]["v"] == C.PRESETS[1]
    assert client.post("/g/crew/say", json={"token": TOK[RA], "k": "e", "v": 0}).status_code == 200
    assert client.post("/g/crew/say", json={"token": TOK[RA], "k": "t", "v": "Сбор у штаба в 19:00"}).status_code == 200
    assert client.post("/g/crew/say", json={"token": TOK[RA], "k": "t", "v": "иди на хуй"}).status_code == 400
    assert client.post("/g/crew/say", json={"token": TOK[RA], "k": "t", "v": "x" * 121}).status_code == 400
    assert client.post("/g/crew/say", json={"token": TOK[RB], "k": "p", "v": 0}).status_code == 404     # не в клане
    monkeypatch.setattr(C, "SAY_EVERY", 3.0)
    C._say.clear()
    client.post("/g/crew/say", json={"token": TOK[RA], "k": "p", "v": 0})
    assert client.post("/g/crew/say", json={"token": TOK[RA], "k": "p", "v": 0}).status_code == 429
    chat = client.post("/g/crew/chat", json={"token": TOK[RA]}).json()["chat"]
    assert any(m["v"] == "Сбор у штаба в 19:00" and m["nick"] for m in chat)
    assert RA not in json.dumps(chat)


# ------------------------------------------------------------------ общак и штаб
def test_bank_and_hq(client):
    cid = make_crew(client)
    s = st()
    with s.lock:
        s.db.execute("INSERT INTO honest (rid, earned, playmin, wall, budget, cheat, save) VALUES (?, 0, 0, 0, 0, 0, ?)",
                     (RA, json.dumps({"money": 60000})))
    assert client.post("/g/crew/give", json={"token": TOK[RA], "amount": 90000}).status_code == 402
    r = client.post("/g/crew/give", json={"token": TOK[RA], "amount": 50000}).json()
    assert r["bank"] == 50000
    assert client.post("/g/crew/give", json={"token": TOK[RA], "amount": 50}).status_code == 400
    # штаб: только нежилой ориентир соклановца, не храм
    prop(RA, "10", "msk", cls="res", landmark=0)
    prop(RA, "11", "msk", cls="com", landmark=1, addr="Собор Святого Духа")
    prop(RA, "12", "msk", cls="com", landmark=1, addr="Бизнес-центр «Пик»")
    prop(RB, "13", "msk", cls="com", landmark=1)
    assert client.post("/g/crew/hq", json={"token": TOK[RA], "city": "flame", "key": "10"}).status_code == 403
    assert client.post("/g/crew/hq", json={"token": TOK[RA], "city": "flame", "key": "11"}).status_code == 403
    assert client.post("/g/crew/hq", json={"token": TOK[RA], "city": "flame", "key": "13"}).status_code == 404
    assert client.post("/g/crew/hq", json={"token": TOK[RA], "city": "flame", "key": "12"}).status_code == 200
    me = client.post("/g/crew/me", json={"token": TOK[RA]}).json()
    assert me["crew"]["hq"]["dist"] == "msk" and me["crew"]["hq"]["lvl"] == 1
    assert client.post("/g/crew/hqup", json={"token": TOK[RA]}).status_code == 402        # общак 50k < 150k
    with s.lock:
        s.db.execute("UPDATE crews SET bank = 200000 WHERE id = ?", (cid,))
    assert client.post("/g/crew/hqup", json={"token": TOK[RA]}).json()["lvl"] == 2


# ------------------------------------------------------------------ помощь: таймер бизнеса вперёд
def test_help_advances_business(client):
    cid = make_crew(client)
    client.post("/g/crew/join", json={"token": TOK[RB], "id": cid})
    client.post("/g/crew/join", json={"token": TOK[RC], "id": cid})
    prop(RA, "20", "center", x=5, z=5)
    assert client.post("/g/biz/open", json={"token": TOK[RA], "city": "flame", "key": "20", "type": "cafe", "word": 0}).status_code == 200
    s = st()
    now = time.time()
    with s.lock:
        s.db.execute("UPDATE biz SET sim_at = ?, stock = 50 WHERE bkey = '20'", (now,))
    hid = client.post("/g/crew/help/ask", json={"token": TOK[RA], "city": "flame", "key": "20"}).json()["id"]
    assert client.post("/g/crew/help/ask", json={"token": TOK[RA], "city": "flame", "key": "20"}).status_code == 409
    assert client.post("/g/crew/help/give", json={"token": TOK[RA], "id": hid}).status_code == 403   # себе нельзя
    r = client.post("/g/crew/help/give", json={"token": TOK[RB], "id": hid}).json()
    assert r["got"] == 1 and r["xp"] == PG.SRC["help"][0]
    assert client.post("/g/crew/help/give", json={"token": TOK[RB], "id": hid}).status_code == 409   # второй раз
    with s.lock:
        b = s.db.execute("SELECT sim_at, stock FROM biz WHERE bkey = '20'").fetchone()
    assert b["sim_at"] <= time.time() - C.HELP_SEC + 1 and b["stock"] >= 50 + C.HELP_STOCK - 1
    st_b = client.post("/g/biz/state", json={"token": TOK[RA], "city": "flame", "key": "20"}).json()
    assert st_b["biz"]["till"] > 0                                  # 3 минуты выработки уже в кассе
    goals = client.post("/g/crew/me", json={"token": TOK[RB]}).json()["goals"]
    assert all(g["id"] != "help" or g["prog"] == 1 for g in goals)


# ------------------------------------------------------------------ цели недели и награды
def test_goals_claim(client):
    cid = make_crew(client)
    now = time.time()
    s = st()
    with s.lock:
        goals = C._goals(s.db, cid, C.week_of(now))
        g = goals[0]
        C.goal_add(s.db, RA, g["goal"], g["need"], now)
    r = client.post("/g/crew/claim", json={"token": TOK[RA], "what": "goal:" + g["goal"]})
    assert r.status_code == 200 and r.json()["paid"] == C.GOAL_PAY
    assert client.post("/g/crew/claim", json={"token": TOK[RA], "what": "goal:" + g["goal"]}).status_code == 409
    assert client.post("/g/crew/claim", json={"token": TOK[RA], "what": "all"}).status_code == 403
    client.post("/g/crew/join", json={"token": TOK[RB], "id": cid})                 # пришёл после выполнения
    with s.lock:
        s.db.execute("UPDATE crew_mem SET joined = joined + 100 WHERE rid = ?", (RB,))
    assert client.post("/g/crew/claim", json={"token": TOK[RB], "what": "goal:" + g["goal"]}).status_code == 403


# ------------------------------------------------------------------ война за районы
def test_windows_and_theme():
    a, b = SAT
    assert time.gmtime(a).tm_wday == 5 and time.gmtime(a).tm_hour == W.WAR_H and b - a == W.WAR_LEN
    assert W.active(a + 10) and not W.active(a - 10) and not W.active(b + 1)
    assert W.theme(a)[0] == "war" and W.theme(a - 5 * 86400)[0] == "run"
    assert W.next_window(a - 100)[0] == a


def test_influence_adjacent_only_and_flip(client):
    cid = make_crew(client)
    lvl(RB, 6)
    cid2 = client.post("/g/crew/create", json={"token": TOK[RB], "tag": "ВТР", "name": "Вторые", "mode": "open"}).json()["id"]
    prop(RA, "30", "msk")                                       # корень клана A — Москва
    t = SAT[0] - 3 * 86400                                       # среда — подготовка
    s = st()
    far = [d for d in S.ADJ["flame"] if d not in S.ADJ["flame"]["msk"] and d != "msk"]
    with s.lock:
        W.settle(s.db, "flame", t - 10)                          # первая отметка окон
        assert W.add(s.db, RA, "flame", "msk", 100, t) == 100
        for d in far:                                            # не сосед — не набрать
            assert W.add(s.db, RA, "flame", d, 100, t) == 0
        assert W.add(s.db, RB, "flame", "msk", 100, t) == 0      # у клана B нет корней
        W.add(s.db, RA, "flame", "msk", 300, t)
    # окно войны: ×2
    with s.lock:
        assert W.add(s.db, RA, "flame", "msk", 50, SAT[0] + 60) == 100
    # конец окна — район переходит к клану A
    d = W.state(s, "flame", now=SAT[1] + 5)
    msk = next(x for x in d["dists"] if x["d"] == "msk")
    assert msk["holder"]["id"] == cid and d["log"][0]["crew"]["id"] == cid
    with s.lock:
        assert W.crew_bonus(s.db, RA, "flame", "msk") == W.HOLD_BONUS
        assert W.held_by(s.db, cid) == [("flame", "msk")]
    # клан распущен — район ничей
    client.post("/g/crew/leave", json={"token": TOK[RA]})
    with s.lock:
        assert W.held_by(s.db, cid) == []
    assert cid2


def test_hold_flag_needs_window_and_position(client):
    make_crew(client)
    prop(RA, "31", "msk")
    s = st()
    x, z = W.dist_xz("flame", "msk")
    with pytest.raises(Exception) as e:
        W.hold(s, RA, "flame", "msk", ("flame", x, z), now=SAT[0] - 100)
    assert e.value.status_code == 403
    with pytest.raises(Exception) as e:
        W.hold(s, RA, "flame", "msk", ("flame", x + 500, z), now=SAT[0] + 100)
    assert e.value.status_code == 409
    r = W.hold(s, RA, "flame", "msk", ("flame", x + 20, z), now=SAT[0] + 100)
    assert r["pts"] == W.HOLD_PTS * W.WAR_K and r["xp"] == PG.SRC["war"][0]
    with pytest.raises(Exception) as e:
        W.hold(s, RA, "flame", "msk", ("flame", x, z), now=SAT[0] + 110)
    assert e.value.status_code == 429


def test_season_team_backward_compat(client):
    """Старый «Передел»: банда и её очки — как были; клан добавляется сверху."""
    make_crew(client)
    prop(RA, "40", "msk", x=-481, z=-481)
    assert client.post("/g/season/team", json={"token": TOK[RA], "city": "flame", "team": "msk"}).status_code == 200
    r = client.post("/g/season/act", json={"token": TOK[RA], "city": "flame", "kind": "capture", "x": -481, "z": -481}).json()
    assert r["pts"] > 0 and r["xp"] == PG.SRC["district"][0]
    d = client.get("/g/season", params={"city": "flame"}).json()
    assert {"dists", "teams", "top", "bonus"} <= set(d)
    msk = next(x for x in d["dists"] if x["d"] == "msk")
    assert msk["pts"]["msk"] == S.ACT_PTS["capture"]
    s = st()
    with s.lock:
        wp = s.db.execute("SELECT sum(pts) AS p FROM war_pts").fetchone()["p"]
        im = s.db.execute("SELECT pts FROM infl_me WHERE rid = ?", (RA,)).fetchone()["pts"]
    assert wp > 0 and im >= S.ACT_PTS["capture"]
    w = client.get("/g/war", params={"city": "flame"}).json()
    assert w["theme"]["name"] and len(w["dists"]) == len(S.DISTS["flame"])


def test_crew_board_and_tag_in_meta(client):
    cid = make_crew(client)
    PG._cache.clear()
    b = client.get("/g/ranks", params={"board": "crew", "scope": "all", "city": "all"}).json()
    assert b["rows"][0]["id"] == cid and b["rows"][0]["tag"] == "ОГН"
    m = PG.meta_of(st(), RA)
    assert m["tag"] == "ОГН" and m["ccol"].startswith("#")
    lst = client.get("/g/crews", params={"q": "ог"}).json()["crews"]
    assert lst and lst[0]["id"] == cid
