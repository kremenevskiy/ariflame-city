"""Флейм-Сити онлайн — «кататься вместе» (25.11.2026): пассажиры в машине, вертолёте и самолёте другого игрока.

Задача владельца: «чтобы в машину можно было сесть вдвоём, втроём — вместе кататься в машинах»; «если я вызвал
вертолёт, любой игрок должен в него сесть — или мы вместе в нём летим».

Места решает сервер. Клиент только просит «сесть к игроку id»; сервер проверяет город, что тот за рулём (m 1) или за
штурвалом (m 3), что просящий пешком и рядом (BOARD_R, по высоте BOARD_DY — вертолёт может висеть низко), что машина
почти стоит (BOARD_V), свободное место (SEATS по типу: мотоцикл — 1, седан — 3, вертолёт — 3) и бан после «высадить»
(BAN с). Дальше позицию пассажира ведёт сам сервер: в каждом кадре рассылки (app.tick) состояние пассажира — копия
состояния водителя с m 5 и номером места в a. Свои координаты пассажира сервер не берёт — все рядом видят его ровно в
машине водителя, без отставания и без возможности «прокатиться» сквозь стены.

Пассажир выходит сам (out) или его высаживают: водитель (kick — бан на минуту этому пассажиру к этому водителю), уход
водителя из игры, выход водителя из машины, смена машины или вход в здание, скачок водителя дальше TP_M + TP_V·dt
(перемещение по карте). Куда встать — решает клиент пассажира: рядом с машиной на проходимом месте, в воздухе — парашют.

Протокол (кадры WebSocket, t = "ride"; сервер с поездками пишет в welcome ride: 1):
  клиент → ride {a: in, id}     — сесть к игроку id;
           ride {a: out}        — выйти;
           ride {a: kick, id?}  — водитель высаживает пассажира id или всех.
  сервер → ride {e: seat, id, seat, m, c, max, p, nick} — ты сел к id на место seat (p — где машина сейчас);
           ride {e: no, id, why}                         — отказ, why — коротко по-русски для подсказки;
           ride {e: out, id, why}                        — ты больше не в машине id: exit | kick | drv_out | drv_left | tp | self;
           ride {e: car, id, m, c, max, ps: [[id, место, ник], …]} — кто в машине id: водителю, пассажирам и ближним;
           ride {e: pos, p: [x, y, z, h], ts?}           — положение машины пассажирам — сразу, как пришёл кадр водителя
                                                           (ts — часы водителя в мс: по ним пассажир сглаживает езду).
  Строка пассажира в кадре w: m 5, c и k — машина водителя, a — номер места. Наружу — только номера соединений, rid нет.
"""
from __future__ import annotations

import json
import math
import time

SEATS_MAX = 3
# Сколько пассажиров (без водителя). Нет в списке — SEATS_MAX. Клиент (fride.js) держит ту же таблицу только для подписи.
SEATS = {
    "moto": 1, "moto_c": 1, "tuk": 2, "truck": 2,
    # двухместные: родстер, суперкары, гиперкары
    "kaze_rd": 1, "tauro": 1, "tauro_v": 1, "corsaro": 1, "hyper": 1, "hyper500": 1, "ev_hyper": 1,
    # воздух (fair.js SPEC): вертолёты — 3, «Кукурузник» — 3, «Искра-Джет» — учебная спарка, 1
    "heli_light": 3, "heli_police": 3, "heli_news": 3, "heli_med": 3, "plane_prop": 3, "plane_jet": 1,
}
BOARD_R = {1: 8.0, 3: 12.0}     # м от центра машины / вертолёта до пассажира (винт «Шмеля» — 10 м в размахе)
BOARD_DY = 6.0                  # по высоте: вертолёт, зависший над землёй
BOARD_V = 6.0                   # м/с — на ходу не садятся (как у своих машин: fcars carProvider)
ASK_EVERY = 0.5                 # «сесть» / «высадить» — не чаще (лишнее молча пропускаем)
BAN = 60.0                      # высаженный не сядет к тому же водителю столько секунд
TP_M, TP_V = 40.0, 160.0        # скачок водителя дальше TP_M + TP_V·dt — перемещение по карте: пассажиры выходят


def seats_of(car: str | None) -> int:
    return SEATS.get(car or "", SEATS_MAX)


def name_of(c) -> str:
    """Имя для подписи «Ник сел к тебе»: свой ник (nicks.py), ник из рейтинга, иначе «Гость»/«Игрок»."""
    return getattr(c, "name", None) or getattr(c, "pnick", None) or getattr(c, "nick", None) or "Игрок"


def _id(v) -> int | None:
    return v if isinstance(v, int) and not isinstance(v, bool) else None


class Ride:
    """Все поездки. app.py отдаёт соединения, отправку и скорость по истории позиций (тесты подменяют их так же)."""

    def __init__(self, clients: dict, send_fn, speed_fn=None):
        self.clients, self.send = clients, send_fn
        self.speed = speed_fn or (lambda cid: 0.0)
        self.cars: dict[int, dict] = {}       # водитель → {m, c, t, ps: {пассажир: место}, w: {пассажир: звёзды}}
        self.seat_of: dict[int, int] = {}     # пассажир → водитель
        self.ask_t: dict[int, float] = {}
        self.ban: dict[tuple[int, int], float] = {}
        self.now = time.monotonic             # часы (тесты подменяют)

    def riding(self, c) -> bool:
        return c.id in self.seat_of

    @staticmethod
    def _row(d, seat: int, w: int) -> list:
        s = d.state
        return [s[0], s[1], s[2], s[3], 5, s[5], s[6], None, seat, w]

    # ------------------------------------------------------------------ кадры клиента
    async def msg(self, c, m: dict) -> bool:
        a = m.get("a")
        if a == "out":
            await self._unseat(c.id, "exit")
            return True
        if a not in ("in", "kick"):
            return False
        now = self.now()
        if now - self.ask_t.get(c.id, -1e9) < ASK_EVERY:
            return True                                       # часто — молча, это не нарушение
        self.ask_t[c.id] = now
        if a == "in":
            did = _id(m.get("id"))
            if did is None:
                return False
            return await self._board(c, did, now)
        R = self.cars.get(c.id)
        if not R:
            return True                                       # пассажиров уже нет — не нарушение
        pid = _id(m.get("id"))
        ids = list(R["ps"]) if m.get("id") is None else [pid] if pid in R["ps"] else []
        for p in ids:
            self.ban[(c.id, p)] = now + BAN
            await self._unseat(p, "kick", car=False)
        if ids:
            await self._car(c)
        return True

    def _why_not(self, c, d, now: float) -> str | None:
        if c.id in self.seat_of:
            return "Ты уже в машине"
        if not d or d is c or getattr(d, "closed", False) or not d.state:
            return "Игрок уже уехал"
        if getattr(d, "city", "flame") != getattr(c, "city", "flame"):
            return "Игрок в другом городе"
        s = d.state
        if s[4] not in (1, 3) or s[7] is not None or d.id in self.seat_of:
            return "Он сейчас не за рулём"
        cs = c.state
        if not cs or cs[4] != 0 or cs[7] is not None:
            return "Сесть можно только пешком с улицы"
        if math.hypot(s[0] - cs[0], s[2] - cs[2]) > BOARD_R[s[4]] or abs(s[1] - cs[1]) > BOARD_DY:
            return "Подойди ближе"
        if self.speed(d.id) > BOARD_V:
            return "На ходу не сесть — пусть остановится"
        if self.ban.get((d.id, c.id), 0.0) > now:
            return "Водитель тебя высадил — подожди минуту"
        R = self.cars.get(d.id)
        if R and len(R["ps"]) >= seats_of(s[5]):
            return "Мест нет"
        return None

    async def _board(self, c, did: int, now: float) -> bool:
        d = self.clients.get(did)
        why = self._why_not(c, d, now)
        if why:
            await self.send(c, {"t": "ride", "e": "no", "id": did, "why": why})
            return True
        s = d.state
        R = self.cars.setdefault(d.id, {"m": s[4], "c": s[5], "t": now, "ps": {}, "w": {}})
        taken = set(R["ps"].values())
        seat = next(i for i in range(1, seats_of(R["c"]) + 1) if i not in taken)
        R["ps"][c.id] = seat
        R["w"][c.id] = c.state[9]
        self.seat_of[c.id] = d.id
        c.state = self._row(d, seat, R["w"][c.id])
        await self.send(c, {"t": "ride", "e": "seat", "id": d.id, "seat": seat, "m": R["m"], "c": R["c"],
                            "max": seats_of(R["c"]), "p": [s[0], s[1], s[2], s[3]], "nick": name_of(d)})
        await self._car(d)
        return True

    # ------------------------------------------------------------------ места: высадить, оповестить
    async def _unseat(self, pid: int, why: str, car: bool = True) -> None:
        did = self.seat_of.pop(pid, None)
        if did is None:
            return
        R = self.cars.get(did)
        if R:
            R["ps"].pop(pid, None)
            R["w"].pop(pid, None)
            if not R["ps"]:
                self.cars.pop(did, None)
        p = self.clients.get(pid)
        if p:
            if p.state and p.state[4] == 5:                  # до своего кадра стоит у машины пешком, а не «сидит»
                p.state = p.state[:4] + [0, "", 0, None, 0, p.state[9]]
            await self.send(p, {"t": "ride", "e": "out", "id": did, "why": why})
        d = self.clients.get(did)
        if car and d and not getattr(d, "closed", False):
            await self._car(d)

    async def _empty(self, d, why: str) -> None:
        R = self.cars.get(d.id)
        if not R:
            return
        for pid in list(R["ps"]):
            await self._unseat(pid, why, car=False)
        if not getattr(d, "closed", False):
            await self._car(d)

    async def _car(self, d) -> None:
        """Кто в машине d — ей самой, её пассажирам и тем, кто рядом (их клиенты рисуют пассажиров в салоне)."""
        R = self.cars.get(d.id)
        s = d.state or [0, 0, 0, 0, 0, "", 0, None, 0, 0]
        ps = sorted(R["ps"].items(), key=lambda t: t[1]) if R else []
        msg = {"t": "ride", "e": "car", "id": d.id, "m": s[4], "c": s[5], "max": seats_of(s[5]),
               "ps": [[pid, seat, name_of(self.clients[pid])] for pid, seat in ps if pid in self.clients]}
        text = json.dumps(msg, ensure_ascii=False, separators=(",", ":"))
        to = {d.id} | {pid for pid, _ in ps} | set(getattr(d, "vis", ()))
        for cid in to:
            o = self.clients.get(cid)
            if o:
                await self.send(o, text)

    # ------------------------------------------------------------------ поток позиций (app.py после on_state)
    async def after_state(self, c, prev: list | None, m: dict) -> None:
        if c.id in self.seat_of:
            # клиент пассажира сам сменил режим: сел в свою машину, в воздух, зашёл в здание — место свободно
            if m.get("m") in (1, 3, 4) or m.get("b") is not None:
                await self._unseat(c.id, "self")
            return
        R = self.cars.get(c.id)
        if not R:
            return
        s, now = c.state, self.now()
        dt, R["t"] = now - R["t"], now
        why = None
        if s[4] != R["m"] or s[5] != R["c"] or s[7] is not None:
            why = "drv_out"                                   # вышел, пересел, зашёл в здание
        elif prev and math.hypot(s[0] - prev[0], s[2] - prev[2]) > TP_M + TP_V * dt:
            why = "tp"                                        # перемещение по карте: пассажиры остаются на месте
        if why:
            await self._empty(c, why)
            return
        out = {"t": "ride", "e": "pos", "p": [s[0], s[1], s[2], s[3]]}
        ts = m.get("ts")
        if isinstance(ts, (int, float)) and not isinstance(ts, bool) and math.isfinite(ts) and 0 <= ts < 1e10:
            out["ts"] = int(ts)
        text = json.dumps(out, separators=(",", ":"))
        for pid in list(R["ps"]):
            p = self.clients.get(pid)
            if p:
                await self.send(p, text)

    # ------------------------------------------------------------------ кадр рассылки (app.tick — до сетки ближних)
    async def tick(self) -> None:
        for did, R in list(self.cars.items()):
            d = self.clients.get(did)
            if not d or getattr(d, "closed", False) or not d.state:
                for pid in list(R["ps"]):
                    await self._unseat(pid, "drv_left", car=False)
                self.cars.pop(did, None)
                continue
            for pid, seat in list(R["ps"].items()):
                p = self.clients.get(pid)
                if not p or getattr(p, "closed", False):
                    await self._unseat(pid, "left")
                    continue
                p.state = self._row(d, seat, R["w"].get(pid, 0))
        if len(self.ban) > 2000:
            now = self.now()
            self.ban = {k: t for k, t in self.ban.items() if t > now}

    async def on_leave(self, c) -> None:
        self.ask_t.pop(c.id, None)
        if c.id in self.seat_of:
            await self._unseat(c.id, "left")
        if c.id in self.cars:
            await self._empty(c, "drv_left")
            self.cars.pop(c.id, None)
