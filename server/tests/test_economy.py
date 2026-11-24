"""Экономика без бесконечных денег (аудит H-2, 24.11.2026): покупка за наличные — «долг» (modes.debit), продажа и
выручка не дают кредита честности, пока сохранения не покажут, что покупку оплатили.

Дыра была такая: здание и «наличные» бизнеса сервер не списывал (деньги живут у клиента), а 70% цены при продаже
выдавал кредитом — клиент мог не платить, продать и сохранить «заработанное». Здесь — эта петля (должна не проходить)
и честные покупка → продажа, которые обязаны работать как раньше. Всё — через ручки и /g/save, как у игрока.

    python -m pytest server/tests/test_economy.py -q
"""
from __future__ import annotations

import importlib.util
import os
import tempfile
import time
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
os.environ.setdefault("FC_DB", os.path.join(tempfile.mkdtemp(prefix="fcg-econ-"), "game.db"))
os.environ["FC_WORLD"] = "fake"
os.environ.setdefault("FC_ORIGINS", "https://game.example.org")

_spec = importlib.util.spec_from_file_location("fcg_app_econ", GAME / "app.py")
fcg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fcg)
import homes  # noqa: E402  — app.py кладёт папку службы в sys.path
import realty as R  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

A, RA = "tok-aaaa0001", "aaaa0001"
MAXF = {"area": 40000, "floors": 120, "tier": 1, "style": "glass", "landmark": True}   # самое дорогое здание
CLUB = {"area": 900, "floors": 6, "tier": 2, "style": "modern", "landmark": False}


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(R, "EVERY", 0.0)
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
            for t in ("homes", "props", "biz", "credit", "debit", "honest"):
                st.db.execute(f"DELETE FROM {t}")
        yield c


class Player:
    """Сохранение игрока как у клиента: FC.money — деньги и «заработано» (только приход), playMin растёт."""

    def __init__(self, c, money=0, earned=0, pm=300.0):
        self.c, self.money, self.earned, self.pm = c, money, earned, pm

    def pay(self, n):
        self.money -= n

    def got(self, n):
        self.money += n
        self.earned += n

    def save(self):
        self.pm += 0.1
        fcg._saved_at.clear()                                       # не ждём 10 с между сохранениями
        r = self.c.post("/g/save", json={"token": A, "save": {"v": 1, "money": self.money, "bank": 0,
                                                              "stats": {"earned": self.earned, "playMin": self.pm}}})
        assert r.status_code == 200, r.text
        return r.json()


def buy(c, key, facts=MAXF, cls="com", x=None, z=None):
    n = abs(hash(key)) % 5000
    body = {"token": A, "city": "minsk", "key": key, "cls": cls, "facts": facts, "addr": "улица " + key,
            "x": 100.0 + n if x is None else x, "z": -200.0 - n if z is None else z, "dx": 1.0, "dz": 1.0}
    r = c.post("/g/prop/claim", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def sell(c, key):
    r = c.post("/g/prop/sell", json={"token": A, "city": "minsk", "key": key})
    assert r.status_code == 200, r.text
    return r.json()["refund"]


# ---------------------------------------------------------------- дыра: купить не заплатив → продать → сохранить

def test_claim_sell_loop_without_paying_is_rejected(client):
    p = Player(client, money=0, earned=0, pm=1.0)                  # как в аудите: на счету $0
    assert p.save()["ok"] is True
    refunds = 0
    for i in range(3):
        price = buy(client, f"m{9000 + i}_{9000 + i}")["price"]
        assert price > 1_000_000                                   # клиент не списал цену — сервер не может знать
        refunds += sell(client, f"m{9000 + i}_{9000 + i}")
    assert fcg.MODES.debit_of(RA) > refunds                        # долг за три покупки больше трёх возвратов
    p.got(refunds)
    r = p.save()
    assert r["ok"] is False and "заработок" in r["why"]            # «заработанное» продажей не принято
    assert r["rolled"] is True and r["save"]["money"] == 0         # вернули последнее честное
    assert fcg.MODES.credit_of(RA) > 0                             # кредит лежит, но не засчитан против долга
    # клиент взял честное сохранение — и одна петля тоже не проходит
    p.money, p.earned = 0, 0
    buy(client, "m9100_9100")
    p.got(sell(client, "m9100_9100"))
    assert p.save()["ok"] is False


def test_cash_business_payments_without_paying_are_rejected(client):
    p = Player(client, money=0, earned=0, pm=1.0)
    assert p.save()["ok"] is True
    buy(client, "m50_50", facts=CLUB, x=50.0, z=50.0)
    assert client.post("/g/biz/open", json={"token": A, "city": "minsk", "key": "m50_50", "type": "club"}).status_code == 200
    for _ in range(4):                                              # 1 → 5 «наличными», которые клиент не платил
        r = client.post("/g/biz/upgrade", json={"token": A, "city": "minsk", "key": "m50_50", "pay": "cash"})
        assert r.status_code == 200 and r.json()["paid"] == "cash"
        with fcg.db().lock:
            fcg.db().db.execute("UPDATE biz SET cool = '{}' WHERE bkey = 'm50_50'")   # пауза улучшений — не тема теста
    refund = sell(client, "m50_50")
    assert refund > 300_000                                         # половина «вложенного» — большая сумма
    p.got(refund)
    assert p.save()["ok"] is False


def test_legacy_home_claim_without_paying_is_rejected(client):
    p = Player(client, money=0, earned=0, pm=1.0)
    assert p.save()["ok"] is True
    r = client.post("/g/home/claim", json={"token": A, "building": 77, "price": 2_000_000})
    assert r.status_code == 200 and fcg.MODES.debit_of(RA) == 2_000_000
    refund = client.post("/g/home/sell", json={"token": A, "building": 77}).json()["refund"]
    p.got(refund)
    assert p.save()["ok"] is False


def test_reset_does_not_forgive_debt(client):
    p = Player(client, money=5000, earned=100_000, pm=30.0)
    assert p.save()["ok"] is True
    buy(client, "m60_60", x=60.0, z=60.0)                           # не заплатил
    fresh = Player(client, money=500, earned=0, pm=0.0)             # «начать заново»
    assert fresh.save()["ok"] is True
    assert fcg.MODES.debit_of(RA) > 0
    fresh.got(sell(client, "m60_60"))
    assert fresh.save()["ok"] is False


# ---------------------------------------------------------------- честная игра — как раньше

def test_honest_buy_save_sell_save(client):
    p = Player(client, money=2_000_000, earned=2_000_000)
    assert p.save()["ok"] is True
    price = buy(client, "m70_70", x=70.0, z=70.0)["price"]
    p.pay(price)                                                    # fprop.js: FC.money(-paid) после ответа
    assert p.save()["ok"] is True
    assert fcg.MODES.debit_of(RA) == 0                              # трата видна — долг погашен
    refund = sell(client, "m70_70")
    assert refund == round(price * 0.7)
    p.got(refund)
    r = p.save()
    assert r["ok"] is True, r
    assert fcg.MODES.credit_of(RA) == 0                             # кредит за продажу ушёл на «заработано»
    assert fcg.MODES.cheat_of(RA) == 0


def test_honest_buy_and_sell_between_two_saves(client):
    p = Player(client, money=2_000_000, earned=2_000_000)
    assert p.save()["ok"] is True
    for i in range(3):                                              # три раза «купил — передумал — продал»
        price = buy(client, f"m{80 + i}_{80 + i}", x=80.0 + i * 10, z=80.0)["price"]
        p.pay(price)
        p.got(sell(client, f"m{80 + i}_{80 + i}"))
    r = p.save()
    assert r["ok"] is True, r
    assert fcg.MODES.debit_of(RA) == 0 and fcg.MODES.credit_of(RA) == 0


def test_honest_business_paid_in_cash_then_sold(client):
    p = Player(client, money=2_000_000, earned=2_000_000)
    assert p.save()["ok"] is True
    p.pay(buy(client, "m90_90", facts=CLUB, x=90.0, z=90.0)["price"])
    p.pay(client.post("/g/biz/open", json={"token": A, "city": "minsk", "key": "m90_90", "type": "club"}).json()["cost"])
    assert p.save()["ok"] is True                                   # сохранение посреди покупок — не мешает
    for _ in range(2):
        d = client.post("/g/biz/upgrade", json={"token": A, "city": "minsk", "key": "m90_90", "pay": "cash"}).json()
        p.pay(d["cost"])                                            # fbiz.js act(): paid === "cash" → FC.money(-cost)
        with fcg.db().lock:
            fcg.db().db.execute("UPDATE biz SET cool = '{}' WHERE bkey = 'm90_90'")
    d = client.post("/g/biz/manager", json={"token": A, "city": "minsk", "key": "m90_90", "on": True}).json()
    p.pay(d["cost"])
    p.got(sell(client, "m90_90"))
    r = p.save()
    assert r["ok"] is True, r
    assert fcg.MODES.debit_of(RA) == 0


def test_client_could_not_pay_and_gave_building_back(client):
    """fprop.js: денег не хватило после ответа — клиент продаёт здание обратно и денег себе не добавляет."""
    p = Player(client, money=10_000, earned=50_000, pm=30.0)
    assert p.save()["ok"] is True
    buy(client, "m95_95", x=95.0, z=95.0)
    sell(client, "m95_95")
    assert p.save()["ok"] is True                                   # ни отката, ни «чита»
    assert fcg.MODES.cheat_of(RA) == 0


def test_buildings_bought_before_the_fix_sell_as_before(client):
    """Миграция: здания, купленные до долгов, — оплаченные (долга нет), продажа даёт кредит как раньше."""
    p = Player(client, money=100_000, earned=1_500_000)
    assert p.save()["ok"] is True
    s = fcg.db()
    with s.lock:
        s.db.execute("""INSERT INTO props (city, bkey, owner_rid, cls, kind, price, bought_at, addr, x, z)
                        VALUES ('minsk', 'm5_5', ?, 'com', 'biz', 1000000, ?, 'улица', 5, 5)""", (RA, int(time.time()) - 86400))
    refund = sell(client, "m5_5")
    assert refund == 700_000
    p.got(refund)
    assert p.save()["ok"] is True
