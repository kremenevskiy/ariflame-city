"""Недвижимость Флейм-Сити v2 (22.11.2026) — старые ручки домов поверх владения зданиями (realty.py).

Задача: «можно выбрать, найти свой дом на карте, и его больше не могут другие занять; купить или
продать». С владения настоящими зданиями (realty.py, 22.11 вечер) правда — таблица props (город, ключ здания); старые
ручки ниже — для клиентов из кэша Telegram: те же ответы, что раньше, только по props города «flame». Таблица homes
остаётся зеркалом (realty пишет в неё покупки и продажи Флейм-Сити) — откат сервера не теряет владельцев.
Цену здесь присылает клиент (старый fhome.priceOf) — она же уходит «долгом» (modes.debit): продажа вернёт 70% только
той суммы, которую сохранения покажут потраченной (аудит H-2).

  GET  /g/homes                     все занятые здания Флейм-Сити: [{b, kind, creature}] — без rid и имён (кэш 15 с)
  POST /g/home/mine  {token}        свои дома: [{building, kind, price, bought_at}]
  POST /g/home/claim {token, building, price, kind?}   купить: 200 / 401 гость / 409 занято / 403 лимит 3
  POST /g/home/sell  {token, building}                 продать: 200 {price} / 404 не твой

Подключает app.py: `app.include_router(homes.make_router(db, verify, _body, MODES))`.
"""
from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter, HTTPException, Request, Response

import realty

MAX_HOMES = realty.LIMIT["res"]   # на игрока
BUILDING_MAX = realty.FLAME_MAX   # номер здания плана города (сейчас ~2300) — с запасом
PRICE_MIN, PRICE_MAX = 1000, 2_000_000
KINDS = ("home", "flat")
EVERY = 1.5                       # не чаще раза в 1,5 с покупка/продажа на игрока

_acted: dict[str, float] = {}


def ensure(store) -> None:
    realty.ensure(store)


def all_taken(store) -> list[dict]:
    return [{"b": int(p["k"]), "kind": p["kind"] if p["kind"] in KINDS else "flat", "creature": p["cre"]}
            for p in realty.taken(store, "flame")]


def mine(store, rid: str) -> list[dict]:
    return [{"building": int(p["key"]), "kind": p["kind"], "price": p["price"], "bought_at": p["bought_at"],
             "name": p["name"]} for p in realty.mine(store, rid, "flame") if p["cls"] == "res"]


def claim(store, rid: str, building: int, price: int, kind: str) -> dict:
    return realty.claim(store, rid, "flame", str(building), "res", price, {})


def sell(store, rid: str, building: int, credit=None) -> dict:
    return realty.sell(store, rid, "flame", str(building), credit)


def _building(v) -> int:
    if isinstance(v, bool) or not isinstance(v, int) or not 0 <= v < BUILDING_MAX:
        raise HTTPException(400, "building — номер здания")
    return v


def make_router(get_store, verify, read_body, modes_obj=None) -> APIRouter:
    r = APIRouter()
    credit = getattr(modes_obj, "credit", None)
    debit = getattr(modes_obj, "debit", None)

    async def who(body: dict) -> str:
        rid = await verify(body.get("token") or "")
        if not rid:
            raise HTTPException(401, "войди своим агентом — гостю дом не закрепить")
        return rid

    def throttle(rid: str):
        now = time.monotonic()
        if now - _acted.get(rid, -1e9) < EVERY:
            raise HTTPException(429, "не так быстро")
        _acted[rid] = now
        if len(_acted) > 20000:
            _acted.clear()

    @r.get("/g/homes")
    async def homes(resp: Response):
        resp.headers["Cache-Control"] = "public, max-age=15"
        items = await asyncio.to_thread(all_taken, get_store())
        return {"homes": items, "n": len(items)}

    @r.post("/g/home/mine")
    async def home_mine(request: Request):
        rid = await who(await read_body(request))
        return {"homes": await asyncio.to_thread(mine, get_store(), rid), "max": MAX_HOMES}

    @r.post("/g/home/claim")
    async def home_claim(request: Request):
        body = await read_body(request)
        rid = await who(body)
        b = _building(body.get("building"))
        price = body.get("price")
        if isinstance(price, bool) or not isinstance(price, int) or not PRICE_MIN <= price <= PRICE_MAX:
            raise HTTPException(400, "цена вне пределов")
        kind = body.get("kind") if body.get("kind") in KINDS else "flat"
        throttle(rid)
        out = await asyncio.to_thread(claim, get_store(), rid, b, price, kind)
        if debit and not out["already"]:                    # клиент списывает цену сам — до ответа пишем её долгом
            await asyncio.to_thread(debit, rid, out["price"])
        return out

    @r.post("/g/home/sell")
    async def home_sell(request: Request):
        body = await read_body(request)
        rid = await who(body)
        b = _building(body.get("building"))
        throttle(rid)
        return await asyncio.to_thread(sell, get_store(), rid, b, credit)

    return r
