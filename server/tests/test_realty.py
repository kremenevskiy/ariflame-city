"""Владение зданиями, бизнесы, сотрудники и «Передел» (server/realty.py) + старые ручки домов поверх них.

Без сети и Postgres: мир подменён (FC_WORLD=fake — токен «tok-<rid>» = rid), база — файл во временной папке. Время
симуляции бизнеса — параметр now у функций модуля (ручки берут time.time()).

    python -m pytest server/tests/test_realty.py -q
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
os.environ.setdefault("FC_DB", os.path.join(tempfile.mkdtemp(prefix="fcg-realty-"), "game.db"))
os.environ["FC_WORLD"] = "fake"
os.environ.setdefault("FC_ORIGINS", "https://game.example.org")

_spec = importlib.util.spec_from_file_location("fcg_app_realty", GAME / "app.py")
fcg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fcg)
import homes  # noqa: E402  — app.py кладёт папку службы в sys.path
import realty as R  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

A, B = "tok-aaaa0001", "tok-bbbb0002"
RA, RB = "aaaa0001", "bbbb0002"
FACTS = {"area": 900, "floors": 6, "tier": 2, "style": "modern", "landmark": False}


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(R, "EVERY", 0.0)
    monkeypatch.setattr(R, "ACT_EVERY", 0.0)
    monkeypatch.setattr(homes, "EVERY", 0.0)
    fcg._tok.clear()
    R._acted.clear()
    homes._acted.clear()
    fcg.by_rid.clear()
    with TestClient(fcg.app) as c:
        st = fcg.db()
        R.ensure(st)
        fcg.MODES.db()
        with st.lock:
            for t in ("homes", "props", "biz", "season_team", "season_pts", "season_me", "season_hold", "credit", "debit",
                      "honest"):
                st.db.execute(f"DELETE FROM {t}")
        yield c


def buy(c, tok, key, city="minsk", cls="com", x=None, z=None, facts=None, **kw):
    if x is None and city == "minsk":
        n = abs(hash(key)) % 5000
        x, z = 100.0 + n, -200.0 - n
    body = {"token": tok, "city": city, "key": key, "cls": cls, "facts": facts or FACTS, "addr": "улица " + key,
            "x": x, "z": z, "dx": (x or 0) + 3, "dz": (z or 0) + 3}
    body.update(kw)
    return c.post("/g/prop/claim", json=body)


def st():
    return fcg.db()


# ---------------------------------------------------------------- здания: покупка, города, лимиты, миграция

def test_migration_keeps_old_homes_and_mirrors_back(client):
    s = st()
    with s.lock:
        s.db.execute("INSERT INTO homes (building, owner_rid, kind, price, bought_at) VALUES (77, ?, 'home', 50000, 1)", (RA,))
    R._ready.discard(id(s))                                   # как новый старт службы: миграция ещё раз (идемпотентно)
    R.ensure(s)
    R.ensure(s)
    mine = client.post("/g/prop/mine", json={"token": A}).json()["props"]
    assert [(p["city"], p["key"], p["kind"], p["price"]) for p in mine] == [("flame", "77", "home", 50000)]
    assert client.post("/g/home/mine", json={"token": A}).json()["homes"][0]["building"] == 77    # старая ручка видит
    # новая покупка во Флейм-Сити — зеркалится в homes (откат сервера ничего не теряет)
    assert buy(client, A, "88", city="flame", cls="res", x=10.0, z=20.0).status_code == 200
    with s.lock:
        rows = {r["building"]: r["kind"] for r in s.db.execute("SELECT building, kind FROM homes WHERE owner_rid = ?", (RA,))}
    assert rows == {77: "home", 88: "flat"}
    assert client.post("/g/prop/sell", json={"token": A, "city": "flame", "key": "88"}).status_code == 200
    with s.lock:
        assert s.db.execute("SELECT count(*) AS n FROM homes WHERE building = 88").fetchone()["n"] == 0
    # старая запись без адреса — клиент дописывает его один раз
    r = client.post("/g/prop/info", json={"token": A, "city": "flame", "key": "77", "addr": "Тверская, 7", "x": 5.0, "z": 6.0})
    assert r.json()["changed"] is True
    again = client.post("/g/prop/info", json={"token": A, "city": "flame", "key": "77", "addr": "другой", "x": 1.0, "z": 1.0})
    assert again.json()["changed"] is False
    assert client.post("/g/prop/mine", json={"token": A, "city": "flame"}).json()["props"][0]["addr"] == "Тверская, 7"


def test_cities_are_separate(client):
    assert buy(client, A, "12", city="flame", cls="res", x=1.0, z=1.0).status_code == 200
    assert buy(client, B, "12", city="flame", cls="res", x=1.0, z=1.0).status_code == 409
    # тот же «номер» в Минске — другое здание; ключи Минска — по центру контура
    assert buy(client, B, "12", city="minsk").status_code == 400
    assert buy(client, B, "m100_-200", city="minsk", cls="res").status_code == 200
    fl = client.get("/g/props", params={"city": "flame"}).json()["props"]
    mn = client.get("/g/props", params={"city": "minsk"}).json()["props"]
    assert [p["k"] for p in fl] == ["12"] and [p["k"] for p in mn] == ["m100_-200"]
    assert set(fl[0]) == {"k", "cls", "kind", "cre", "x", "z"}            # ни rid, ни имени агента
    assert client.get("/g/homes").json()["homes"][0]["b"] == 12             # старая ручка — только Флейм-Сити
    assert client.get("/g/props", params={"city": "moon"}).status_code == 400


def test_claim_validation_and_limits(client):
    assert buy(client, "", "m1_1").status_code == 401
    assert buy(client, A, "o123").status_code == 400                          # ключ Минска — m<x>_<z>
    assert buy(client, A, "m1_1", cls="villa").status_code == 400
    assert client.post("/g/prop/claim", json={"token": A, "city": "minsk", "key": "m1_1", "cls": "com"}).status_code == 400
    assert buy(client, A, "m1_1", x=99999.0, z=0.0).status_code == 400
    for i in range(3):
        assert buy(client, A, f"m{i}_5", cls="com").status_code == 200
    r = buy(client, A, "m9_5", cls="com")
    assert r.status_code == 403                                                # 3 нежилых в городе
    assert buy(client, A, "m9_6", cls="res").status_code == 200                # дома — свой лимит
    assert buy(client, A, "9", city="flame", cls="com", x=0.0, z=0.0).status_code == 200   # лимит — в каждом городе свой


def test_twin_key_same_building_is_taken(client):
    assert buy(client, A, "m500_500", x=500.0, z=500.0).status_code == 200
    # данные пересобрали — центр контура сдвинулся на метр, ключ другой, а здание то же
    assert buy(client, B, "m501_500", x=500.6, z=500.4).status_code == 409


def test_price_is_servers_formula(client):
    r = buy(client, A, "m10_10", cls="com", facts={"area": 1400, "floors": 9, "tier": 1, "style": "stalin", "landmark": True})
    want = R.price_of("minsk", "com", 1400, 9, 1, "stalin", True)
    assert r.json()["price"] == want
    # та же формула, что у прежнего fhome.priceOf: дом Флейм-Сити в Москве 30×25, 12 этажей, панель
    assert R.price_of("flame", "res", 750, 12, 2, "panel", False) == round(60000 * (750 / 700) * (0.7 + 12 / 20) * 0.9 / 500) * 500
    assert R.price_of("minsk", "res", 10, 1, 4, "house", False) == R.PRICE_MIN          # окраинный домик — нижняя цена


def test_primary_home_and_sell_refund_with_credit(client):
    buy(client, A, "m1_2", cls="res", x=10.0, z=10.0)
    buy(client, A, "m3_4", cls="res", x=30.0, z=30.0)
    kinds = {p["key"]: p["kind"] for p in client.post("/g/prop/mine", json={"token": A}).json()["props"]}
    assert kinds == {"m1_2": "home", "m3_4": "flat"}
    assert client.post("/g/prop/primary", json={"token": A, "city": "minsk", "key": "m3_4"}).status_code == 200
    kinds = {p["key"]: p["kind"] for p in client.post("/g/prop/mine", json={"token": A}).json()["props"]}
    assert kinds == {"m1_2": "flat", "m3_4": "home"}
    price = [p for p in client.post("/g/prop/mine", json={"token": A}).json()["props"] if p["key"] == "m3_4"][0]["price"]
    r = client.post("/g/prop/sell", json={"token": A, "city": "minsk", "key": "m3_4"})
    assert r.json()["refund"] == round(price * 0.7)
    assert fcg.MODES.credit_of(RA) == round(price * 0.7)
    assert client.post("/g/prop/mine", json={"token": A}).json()["props"][0]["kind"] == "home"   # главным стал оставшийся
    assert client.post("/g/prop/sell", json={"token": B, "city": "minsk", "key": "m1_2"}).status_code == 404


# ---------------------------------------------------------------- бизнес: открытие, производство, касса

def opened(c, tok=A, key="m40_40", t="cafe", x=40.0, z=40.0):
    assert buy(c, tok, key, x=x, z=z).status_code == 200
    r = c.post("/g/biz/open", json={"token": tok, "city": "minsk", "key": key, "type": t, "word": 3})
    assert r.status_code == 200, r.text
    return r.json()["biz"]


def test_open_rules(client):
    buy(client, A, "m7_7", cls="res", x=7.0, z=7.0)
    assert client.post("/g/biz/open", json={"token": A, "city": "minsk", "key": "m7_7", "type": "cafe"}).status_code == 400
    buy(client, A, "m8_8", cls="com", x=8.0, z=8.0, facts=dict(FACTS, area=150))
    r = client.post("/g/biz/open", json={"token": A, "city": "minsk", "key": "m8_8", "type": "carshow"})
    assert r.status_code == 400 and "м²" in r.json()["detail"]                 # автосалону мало места
    assert client.post("/g/biz/open", json={"token": A, "city": "minsk", "key": "m8_8", "type": "lootbox"}).status_code == 400
    b = client.post("/g/biz/open", json={"token": A, "city": "minsk", "key": "m8_8", "type": "shawarma", "word": 0}).json()["biz"]
    assert b["name"] == "Шаурма «Огонёк»" and b["level"] == 1 and b["stock"] == 50
    assert client.post("/g/biz/open", json={"token": A, "city": "minsk", "key": "m8_8", "type": "cafe"}).status_code == 409
    assert client.post("/g/biz/state", json={"token": B, "city": "minsk", "key": "m8_8"}).status_code == 404
    pub = client.get("/g/props", params={"city": "minsk"}).json()["props"]
    assert [(p["biz"], p["lvl"]) for p in pub if p["k"] == "m8_8"] == [("shawarma", 1)]


def test_production_caps_and_supplies(client):
    opened(client)
    s, t0 = st(), time.time()
    with s.lock:
        b = R._load_biz(s.db, "minsk", "m40_40")
    c0 = R.candidates(RA, "minsk", "m40_40", 1, int(t0 // R.CAND_WINDOW))
    R._hire(b, c0[0], t0)
    R._hire(b, c0[1], t0)
    b["sim_at"] = t0
    with s.lock:
        R._save_biz(s.db, b)
    one = R.state(s, RA, "minsk", "m40_40", now=t0 + 3600)["biz"]
    assert 0 < one["till"] <= one["cap"] and one["stock"] < 50
    # без менеджера касса копит 2 часа — дальше производство стоит, сырьё не тратится
    much = R.state(s, RA, "minsk", "m40_40", now=t0 + 20 * 3600)["biz"]
    assert much["till"] <= much["cap"] == int(R.full_rate("cafe", 1) * 2)
    later = R.state(s, RA, "minsk", "m40_40", now=t0 + 40 * 3600)["biz"]
    assert later["stock"] == much["stock"] and later["till"] == much["till"]
    # сырьё из кассы
    r = R.supply(s, RA, "minsk", "m40_40", "till", now=t0 + 40 * 3600)
    assert r["paid"] == "till" and r["biz"]["stock"] == 100


def test_collect_near_remote_manager_and_credit(client):
    opened(client)
    s, t0 = st(), time.time()
    with s.lock:
        s.db.execute("UPDATE biz SET till = 5000, sim_at = ? WHERE bkey = 'm40_40'", (t0 + 10,))
    # игрок в онлайне далеко от здания — касса только у здания (или с менеджером)
    fcg.by_rid[RA] = type("C", (), {"closed": False, "state": [3000.0, 0, 3000.0], "city": "minsk"})()
    r = client.post("/g/biz/collect", json={"token": A, "city": "minsk", "key": "m40_40"})
    assert r.status_code == 403
    assert client.post("/g/biz/manager", json={"token": A, "city": "minsk", "key": "m40_40", "on": True}).json()["cost"] == 3000
    r = client.post("/g/biz/collect", json={"token": A, "city": "minsk", "key": "m40_40"}).json()
    assert r["paid"] == 4500 and r["fee"] == 0.1                               # −10% за удалённо
    assert fcg.MODES.credit_of(RA) == 4500
    # у здания — без комиссии
    with s.lock:
        s.db.execute("UPDATE biz SET till = 1000, sim_at = ? WHERE bkey = 'm40_40'", (time.time() + 10,))
    fcg.by_rid[RA].state = [41.0, 0, 39.0]
    assert client.post("/g/biz/collect", json={"token": A, "city": "minsk", "key": "m40_40"}).json()["paid"] == 1000
    # заработок от бизнеса не чит: сохранение с +5500 за минуту игры принимается. Здание, оборудование и управляющего
    # честный клиент оплатил наличными — первое сохранение это показывает (заработано больше, чем осталось денег)
    price = client.post("/g/prop/mine", json={"token": A}).json()["props"][0]["price"]
    spent = price + R.TYPES["cafe"]["equip"] + 3000
    assert fcg.MODES.debit_of(RA) == spent
    ok, _, why = fcg.MODES.check_save(RA, {"money": 100, "bank": 0, "stats": {"earned": spent + 100, "playMin": 1}})
    assert ok, why
    assert fcg.MODES.debit_of(RA) == 0
    ok, _, why = fcg.MODES.check_save(RA, {"money": 5600, "bank": 0,
                                           "stats": {"earned": spent + 5600 + 8000, "playMin": 1.5}},
                                      now=time.time() + 60)
    assert ok, why
    assert fcg.MODES.credit_of(RA) == 0


def test_upgrade_levels_and_payment(client):
    opened(client)
    r = client.post("/g/biz/upgrade", json={"token": A, "city": "minsk", "key": "m40_40", "pay": "till"})
    assert r.status_code == 402                                                # в кассе пусто
    r = client.post("/g/biz/upgrade", json={"token": A, "city": "minsk", "key": "m40_40", "pay": "cash"}).json()
    assert r["cost"] == int(15000 * 0.6) and r["biz"]["level"] == 2 and r["biz"]["slots"] == 3
    s, now = st(), time.time() + 100
    for lv in (3, 4, 5):
        out = R.upgrade(s, RA, "minsk", "m40_40", "cash", now=now)
        assert out["biz"]["level"] == lv
        now += 30
    with pytest.raises(R.HTTPException):
        R.upgrade(s, RA, "minsk", "m40_40", "cash", now=now + 60)
    assert R.state(s, RA, "minsk", "m40_40", now=now + 61)["biz"]["full"] == int(3000 * R.lvl_k(5)) == 7800


# ---------------------------------------------------------------- сотрудники

def test_candidates_hire_fire_and_review(client):
    b = opened(client)
    cands = b["cands"]
    assert len(cands) == R.CAND_N and all(1 <= len(c["tr"]) <= 5 and 20 <= c["sk"] <= 95 for c in cands)
    assert cands == client.post("/g/biz/state", json={"token": A, "city": "minsk", "key": "m40_40"}).json()["biz"]["cands"]
    for c in cands:                                                            # несовместимых черт нет
        assert not any(a in c["tr"] and z in c["tr"] for a, z in R.CLASH)
    h = client.post("/g/biz/hire", json={"token": A, "city": "minsk", "key": "m40_40", "cand": cands[0]["id"]}).json()
    assert h["emp"]["n"] == cands[0]["n"] and cands[0]["id"] not in [c["id"] for c in h["biz"]["cands"]]
    assert client.post("/g/biz/hire", json={"token": A, "city": "minsk", "key": "m40_40", "cand": cands[0]["id"]}).status_code == 404
    client.post("/g/biz/hire", json={"token": A, "city": "minsk", "key": "m40_40", "cand": cands[1]["id"]})
    r = client.post("/g/biz/hire", json={"token": A, "city": "minsk", "key": "m40_40", "cand": cands[2]["id"]})
    assert r.status_code == 403                                                # 2 места на 1-м уровне
    staff = client.post("/g/biz/state", json={"token": A, "city": "minsk", "key": "m40_40"}).json()["biz"]["staff"]
    m_before = staff[1]["m"]
    f = client.post("/g/biz/fire", json={"token": A, "city": "minsk", "key": "m40_40", "emp": staff[0]["id"]}).json()
    assert f["review"]["n"] == staff[0]["n"] and f["review"]["stars"] in (1, 2)
    after = f["biz"]["staff"][0]["m"]
    assert after < m_before or "grump" in staff[0]["tr"]                       # остальным обидно (ворчуна не жалко)
    assert f["biz"]["hist"][-1]["e"] == "fire"


def test_raise_is_a_ratchet_and_bonus_cooldown(client):
    b = opened(client)
    client.post("/g/biz/hire", json={"token": A, "city": "minsk", "key": "m40_40", "cand": b["cands"][0]["id"]})
    e = client.post("/g/biz/state", json={"token": A, "city": "minsk", "key": "m40_40"}).json()["biz"]["staff"][0]
    r = client.post("/g/biz/raise", json={"token": A, "city": "minsk", "key": "m40_40", "emp": e["id"]}).json()
    assert r["wage"] > e["w"]
    assert client.post("/g/biz/bonus", json={"token": A, "city": "minsk", "key": "m40_40", "emp": e["id"]}).status_code == 200
    assert client.post("/g/biz/bonus", json={"token": A, "city": "minsk", "key": "m40_40", "emp": e["id"]}).status_code == 429


def test_low_morale_quits_and_manager_refills(client):
    opened(client)
    # время — постоянное: уходы детерминированы по часу и сотруднику, и от «сейчас» тест зеленел или краснел по 6-часовым
    # окнам кандидатов (3 из 8 окон — краснел). Нужен один сценарий, где уход и замена точно случаются.
    s, t0 = st(), 1_800_000_000.0
    with s.lock:
        b = R._load_biz(s.db, "minsk", "m40_40")
    win = int(t0 // R.CAND_WINDOW)
    for c in R.candidates(RA, "minsk", "m40_40", 1, win)[:2]:
        e = R._hire(b, c, t0)
        e["w"], e["m"] = 1, 5.0                                                # ставка в рубль и мораль на дне
    b["sim_at"], b["stock"], b["manager"], b["till"] = t0, 100.0, 1, 50000.0
    with s.lock:
        R._save_biz(s.db, b)
    out = R.state(s, RA, "minsk", "m40_40", now=t0 + 48 * 3600)
    kinds = [e["e"] for e in out["events"]]
    assert "quit" in kinds and "auto_hire" in kinds
    assert all(e["w"] > 1 for e in out["biz"]["staff"])                       # ушедших заменили новые
    assert R.quit_risk({"m": 80, "tr": []}) == 0 and R.quit_risk({"m": 10, "tr": ["loyal"]}) < R.quit_risk({"m": 10, "tr": ["flighty"]})


def test_traits_and_morale_math():
    e = {"sk": 50.0, "w": int(R.market_wage(50)), "tr": [], "m": 60.0}
    base = R.morale_target(e, [e], 1, False)
    rich = dict(e, w=int(R.market_wage(50) * 1.3))
    assert R.morale_target(rich, [rich], 1, False) > base
    soul = {"sk": 50.0, "w": e["w"], "tr": ["soul"], "m": 60.0}
    assert R.morale_target(e, [e, soul], 1, False) > R.morale_target(e, [e, dict(soul, tr=[])], 1, False)
    assert R.staff_k([], 1) == 0.15
    hard = dict(e, tr=["hard"])
    assert R.staff_k([hard, hard], 1) > R.staff_k([e, e], 1)


# ---------------------------------------------------------------- рейсы

def test_sell_and_supply_runs(client):
    opened(client)
    s = st()
    with s.lock:
        s.db.execute("UPDATE biz SET till = 3000, sim_at = ? WHERE bkey = 'm40_40'", (time.time() + 1e4,))
    t0 = time.time() + 1e4
    r = R.run(s, RA, "minsk", "m40_40", "sell", "start", 1400.0, now=t0)
    assert r["run"]["amount"] == 3000 and r["biz"]["till"] == 0
    with pytest.raises(R.HTTPException):
        R.run(s, RA, "minsk", "m40_40", "sell", "start", 1400.0, now=t0 + 1)            # второй рейс сразу — нельзя
    fast = R.run(s, RA, "minsk", "m40_40", "sell", "done", 0, now=t0 + 5)             # 1,4 км за 5 с — телепорт
    assert fast["ok"] is False and fast["back"] == 2250
    with s.lock:
        s.db.execute("UPDATE biz SET cool = '{}' WHERE bkey = 'm40_40'")
    R.run(s, RA, "minsk", "m40_40", "sell", "start", 1400.0, now=t0 + 10)
    got = []
    good = R.run(s, RA, "minsk", "m40_40", "sell", "done", 0, credit=lambda rid, n: got.append(n), now=t0 + 10 + 60)
    assert good["ok"] and good["paid"] == round(2250 * 1.35) and got == [good["paid"]]
    R.run(s, RA, "minsk", "m40_40", "supply", "start", 900.0, now=t0 + 100)
    sup = R.run(s, RA, "minsk", "m40_40", "supply", "done", 0, now=t0 + 160)
    assert sup["ok"] and sup["biz"]["stock"] >= 50


# ---------------------------------------------------------------- «Передел»

def test_adjacency_is_symmetric_and_connected():
    for city in R.CITIES:
        adj = R.ADJ[city]
        assert all(a in adj[b] for a in adj for b in adj[a])
        seen, todo = set(), [next(iter(adj))]
        while todo:
            d = todo.pop()
            if d not in seen:
                seen.add(d)
                todo += adj[d]
        assert seen == set(adj)
    assert sorted(R.ADJ["flame"]["center"]) == ["ala", "minsk", "msk"] and R.ADJ["flame"]["msk"] == ["center"]


def test_season_team_points_adjacency_and_week_close(client):
    s, now = st(), time.time()
    assert client.post("/g/season/team", json={"token": A, "city": "flame", "team": "msk"}).status_code == 200
    assert client.post("/g/season/team", json={"token": A, "city": "flame", "team": "ala"}).status_code == 403
    assert client.post("/g/season/team", json={"token": A, "city": "minsk", "team": "ala"}).status_code == 200   # свой город
    # Москва — родной район «Звёзд», центр — сосед; Алматы не граничит с районами «Звёзд» — очков нет
    assert R.act(s, RA, "flame", "capture", -481, -481, now=now)["pts"] == 25
    assert R.act(s, RA, "flame", "heist", 0, 0, now=now)["pts"] == 40
    assert R.act(s, RA, "flame", "heist", 616, -287, now=now)["pts"] == 0
    d = client.get("/g/season", params={"city": "flame"}).json()
    center = [x for x in d["dists"] if x["d"] == "center"][0]
    assert center["pts"] == {"msk": 40} and center["holder"] is None
    assert [x for x in d["dists"] if x["d"] == "msk"][0]["holder"] == "msk"
    assert d["top"][0]["pts"] == 65 and "rid" not in d["top"][0]
    # неделя кончилась — центр за «Звёздами», и теперь им открыты Минск и Алматы (соседи центра)
    nxt = now + 7 * 86400
    d2 = R.season(s, "flame", now=nxt)
    assert [x for x in d2["dists"] if x["d"] == "center"][0]["holder"] == "msk"
    assert set([t for t in d2["teams"] if t["team"] == "msk"][0]["can"]) == {"center", "msk", "minsk", "ala"}
    assert R.act(s, RA, "flame", "heist", 616, -287, now=nxt)["pts"] == 40
    # лимит очков за сутки
    for _ in range(30):
        R.act(s, RA, "flame", "heist", 0, 0, now=nxt)
    me = R.my_team(s, RA, "flame")
    assert me["team"] == "msk"
    with s.lock:
        day_pts = s.db.execute("SELECT day_pts FROM season_me WHERE rid = ? AND city = 'flame' AND week = ?",
                               (RA, R.week_of(nxt))).fetchone()["day_pts"]
    assert day_pts == R.ACT_DAY
    assert client.post("/g/season/act", json={"token": A, "city": "flame", "kind": "dance", "x": 0, "z": 0}).status_code == 400


def test_hold_bonus_on_collect(client):
    s, now = st(), time.time()
    client.post("/g/season/team", json={"token": A, "city": "minsk", "team": "msk"})
    # здание в Каменной Горке — родной район «Звёзд», он за ними с начала сезона
    opened(client, key="m-9300_-1500", x=-9300.0, z=-1500.0)
    with s.lock:
        s.db.execute("UPDATE biz SET till = 1000, sim_at = ? WHERE bkey = 'm-9300_-1500'", (now + 50,))
    r = R.collect(s, RA, "minsk", "m-9300_-1500", True, now=now + 50)
    assert r["bonus"] == R.HOLD_BONUS and r["paid"] == 1100 and r["pts"] == 11.0
