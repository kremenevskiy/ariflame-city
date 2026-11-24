"""Уровни и опыт, вход по дням, достижения, профиль, рейтинги (server/progress.py).

Без сети и Postgres: мир подменён (FC_WORLD=fake — токен «tok-<rid>» = rid), база — файл во временной папке.

    python -m pytest server/tests/test_progress.py -q
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
os.environ.setdefault("FC_DB", os.path.join(tempfile.mkdtemp(prefix="fcg-prog-"), "game.db"))
os.environ["FC_WORLD"] = "fake"
os.environ.setdefault("FC_ORIGINS", "https://game.example.org")

_spec = importlib.util.spec_from_file_location("fcg_app_prog", GAME / "app.py")
fcg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fcg)
import crews as C  # noqa: E402
import progress as PG  # noqa: E402
import realty as R  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

A, B = "tok-aaaa0001", "tok-bbbb0002"
RA, RB = "aaaa0001", "bbbb0002"
TABLES = ("props", "biz", "season_team", "season_pts", "season_me", "season_hold", "credit", "debit", "honest", "prog",
          "prog_city", "prog_week", "biz_week", "biz_total", "infl_me", "ach", "crews", "crew_mem", "crew_req", "crew_chat",
          "crew_help", "crew_goal", "crew_claim", "crew_left", "war_pts", "war_me", "war_hold", "war_log", "war_eval",
          "races", "weekly_winners")


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(R, "EVERY", 0.0)
    monkeypatch.setattr(R, "ACT_EVERY", 0.0)
    monkeypatch.setattr(PG, "SYNC_EVERY", 0.0)
    monkeypatch.setattr(C, "ACT_EVERY", 0.0)
    fcg._tok.clear()
    R._acted.clear()
    PG._cache.clear()
    PG._sync_t.clear()
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


def give_xp(rid, amount, src="crew"):
    s = st()
    with s.lock:
        return PG.xp(s.db, rid, src, "flame", amount=amount)


def set_xp(rid, total):
    s = st()
    with s.lock:
        PG.row_of(s.db, rid)
        s.db.execute("UPDATE prog SET xp = ?, lvl = ? WHERE rid = ?", (total, PG.lvl_of(total), rid))


# ------------------------------------------------------------------ кривая уровней
def test_curve_monotonic_and_known_points():
    assert PG.need(1) == 0 and PG.need(2) == 310 and PG.need(10) == 7110 and PG.need(100) == 612810
    prev = 0
    for lv in range(2, 200):
        assert PG.need(lv) > prev
        prev = PG.need(lv)
        assert PG.lvl_of(PG.need(lv)) == lv
        assert PG.lvl_of(PG.need(lv) - 1) == lv - 1
    assert PG.lvl_of(0) == 1 and PG.lvl_of(-5) == 1 and PG.lvl_of(1e12) == PG.MAX_LVL


# ------------------------------------------------------------------ опыт от клиента: частота, потолки, чужие источники
def test_sync_gains_rate_and_caps(client):
    r = client.post("/g/prog/sync", json={"token": A, "city": "minsk", "gains": {"job": 3, "biz": 50, "hack": 9, "photo": -1}})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["gained"] == {"job": 105}                       # первый раз — сколько прислал (до 50), biz сервер считает сам
    assert d["xp"] == 105 and d["lvl"] == 1
    r = client.post("/g/prog/sync", json={"token": A, "city": "minsk", "gains": {"job": 10}}).json()
    assert r["gained"].get("job", 0) <= 35                    # через миг — не больше одного раза
    s = st()
    with s.lock:                                              # дневной потолок источника
        for _ in range(200):
            PG.xp(s.db, RA, "stunt", "flame")
        row = s.db.execute("SELECT day_xp FROM prog WHERE rid = ?", (RA,)).fetchone()
    assert json.loads(row["day_xp"])["stunt"] == PG.SRC["stunt"][2]
    assert client.post("/g/prog/sync", json={"gains": {"job": 1}}).status_code == 401


def test_day_cap_total(client):
    for src in ("crew", "login", "ach", "biz", "run", "race", "district", "war", "mission", "heist", "job"):
        give_xp(RA, 100000, src)
    s = st()
    with s.lock:
        r = s.db.execute("SELECT xp FROM prog WHERE rid = ?", (RA,)).fetchone()
    assert r["xp"] == PG.DAY_CAP


def test_seed_from_honest_capped(client):
    s = st()
    with s.lock:
        s.db.execute("INSERT INTO honest (rid, earned, playmin, wall, budget, cheat, save) VALUES (?, ?, ?, ?, ?, 0, ?)",
                     (RA, 50_000_000, 6000, time.time(), 0, json.dumps({"money": 1000})))
        s.db.execute("INSERT INTO honest (rid, earned, playmin, wall, budget, cheat, save) VALUES (?, ?, ?, ?, ?, 0, ?)",
                     (RB, 40_000, 60, time.time(), 0, "{}"))
        a = PG.row_of(s.db, RA)
        b = PG.row_of(s.db, RB)
    assert a["xp"] == PG.need(PG.SEED_LVL)                     # старым игрокам — не выше SEED_LVL
    assert b["xp"] == 40_000 // 40 + 60 * 15


# ------------------------------------------------------------------ вход по дням
def test_daily_streak(client):
    s = st()
    day = 86400
    t0 = 1_800_000_000.0
    d1 = PG.claim_daily(s, RA, now=t0, credit=fcg.MODES.credit)
    assert d1["ok"] and d1["streak"] == 1 and d1["paid"] == PG.DAILY[0][0]
    assert PG.claim_daily(s, RA, now=t0 + 60)["already"]
    for i in range(2, 8):
        d = PG.claim_daily(s, RA, now=t0 + (i - 1) * day)
        assert d["streak"] == i and d["paid"] == PG.DAILY[i - 1][0]
    with s.lock:
        t = json.loads(s.db.execute("SELECT titles FROM prog WHERE rid = ?", (RA,)).fetchone()["titles"])
    assert "streak7" in t
    d = PG.claim_daily(s, RA, now=t0 + 9 * day)                # пропуск дня — серия заново
    assert d["streak"] == 1
    assert fcg.MODES.credit_of(RA) > 0                          # деньги — кредитом честности


def test_daily_endpoint(client):
    r = client.post("/g/prog/daily", json={"token": A}).json()
    assert r["ok"] and r["paid"] == 1000
    assert client.post("/g/prog/daily", json={"token": A}).json()["already"]


# ------------------------------------------------------------------ достижения
def test_achievements_xp_and_stats(client):
    r = client.post("/g/prog/sync", json={"token": A, "ach": [["first_job", "common"], ["lvl_100", "legend"], ["Bad id", "x"],
                                                               ["first_job", "common"]]}).json()
    assert r["ach_xp"] == 25 + 250 and r["ach_ok"] == ["first_job", "lvl_100", "first_job"]
    r2 = client.post("/g/prog/sync", json={"token": A, "ach": [["first_job", "legend"]]}).json()
    assert r2["ach_xp"] == 0                                    # повтор — без опыта
    client.post("/g/prog/sync", json={"token": B, "ach": [["first_job", "common"]]})
    PG._cache.clear()
    d = client.get("/g/ach/stats").json()
    assert d["share"]["first_job"] == 100.0 and d["share"]["lvl_100"] == 50.0


# ------------------------------------------------------------------ профиль и табличка
def test_profile_public_no_rid(client):
    set_xp(RA, 8000)
    me = client.post("/g/prog/me", json={"token": A}).json()
    assert me["lvl"] == PG.lvl_of(8000) and me["fid"] and "titles" in me and me["daily"]["can"]
    assert me["ranks"]["level"]["all"]["all"]["pos"] == 1
    p = client.get("/g/profile", params={"fid": me["fid"]}).json()
    assert p["nick"] == me["nick"] and p["lvl"] == me["lvl"]
    assert RA not in json.dumps(p)                               # rid наружу — никогда
    assert client.get("/g/profile", params={"fid": "0" * 12}).status_code == 404
    assert client.get("/g/profile", params={"fid": "x"}).status_code == 400


def test_title_and_nick(client):
    set_xp(RA, PG.need(10))
    assert client.post("/g/prog/title", json={"token": A, "title": "dealer"}).json()["title"] == "Делец"
    assert client.post("/g/prog/title", json={"token": A, "title": "icon"}).status_code == 403
    r = client.post("/g/prog/nick", json={"token": A, "w": 2, "n": 42}).json()
    assert r["nick"] == PG.NICKS[2] + "-42"
    assert client.post("/g/prog/nick", json={"token": A, "w": 3, "n": 7}).status_code == 429
    assert client.post("/g/prog/nick", json={"token": A, "w": 999, "n": 7}).status_code == 400


# ------------------------------------------------------------------ рейтинги
def test_boards_level_city_week_and_cheaters(client):
    s = st()
    with s.lock:
        PG.xp(s.db, RA, "crew", "minsk", amount=500)
        PG.xp(s.db, RB, "crew", "flame", amount=900)
        PG.xp(s.db, "cccc0003", "crew", "flame", amount=2000)
        s.db.execute("INSERT INTO honest (rid, earned, playmin, wall, budget, cheat) VALUES ('cccc0003', 0, 0, 0, 0, 5)")
    PG._cache.clear()
    allb = client.get("/g/ranks", params={"board": "level", "scope": "all", "city": "all"}).json()
    assert [r["val"] for r in allb["rows"]] == [900, 500]          # читер выкинут
    mins = client.get("/g/ranks", params={"board": "level", "scope": "week", "city": "minsk"}).json()
    assert len(mins["rows"]) == 1 and mins["rows"][0]["val"] == 500
    assert client.get("/g/ranks", params={"board": "nope"}).status_code == 400


def test_biz_income_board_and_worth(client):
    s = st()
    with s.lock:
        s.db.execute("""INSERT INTO props (city, bkey, owner_rid, cls, kind, price, bought_at, x, z, dist)
                        VALUES ('flame', '42', ?, 'com', 'biz', 120000, 0, 10, 10, 'center')""", (RA,))
    b = client.post("/g/biz/open", json={"token": A, "city": "flame", "key": "42", "type": "cafe", "word": 1})
    assert b.status_code == 200, b.text
    with s.lock:
        s.db.execute("UPDATE biz SET till = 5000 WHERE city = 'flame' AND bkey = '42'")
    r = client.post("/g/biz/collect", json={"token": A, "city": "flame", "key": "42"}).json()
    assert r["paid"] >= 5000 and r["xp"] > 0
    PG._cache.clear()
    w = client.get("/g/ranks", params={"board": "biz", "scope": "week", "city": "flame"}).json()
    assert w["rows"][0]["val"] == r["paid"]
    PG.on_save(s, RA, {"money": 1000, "bank": 500})
    with s.lock:
        worth = s.db.execute("SELECT worth FROM prog WHERE rid = ?", (RA,)).fetchone()["worth"]
    assert worth == 1500 + 120000 + R.TYPES["cafe"]["equip"]


def test_save_updates_worth(client):
    data = {"v": 1, "money": 700, "bank": 0, "stats": {"earned": 900, "playMin": 3}}
    r = client.post("/g/save", json={"token": A, "save": data})
    assert r.json()["ok"]
    s = st()
    with s.lock:
        assert s.db.execute("SELECT worth FROM prog WHERE rid = ?", (RA,)).fetchone()["worth"] == 700


def test_race_hook_xp(client):
    PG.on_race(st(), RA, True, 1)
    s = st()
    with s.lock:
        assert s.db.execute("SELECT xp FROM prog WHERE rid = ?", (RA,)).fetchone()["xp"] == 100 + 60 + 60


def test_ws_meta_has_level_and_fid(client):
    set_xp(RA, PG.need(7))
    with client.websocket_connect("/g/ws", headers={"origin": "https://game.example.org"}) as ws:
        ws.send_text(json.dumps({"t": "hi", "token": A, "creature": "lis", "v": 1}))
        w = json.loads(ws.receive_text())
        assert w["t"] == "welcome" and w["lvl"] == 7 and len(w["fid"]) == 12
        c = fcg.by_rid[RA]
        m = c.meta()
        assert m["lvl"] == 7 and m["pn"] and "rid" not in m
