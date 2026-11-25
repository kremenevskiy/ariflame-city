"""Правки без GitHub (server/contrib.py): приём правки с сайта, статус по ссылке, очередь для contrib-intake.yml;
необязательная почта и письма о статусе (server/contribmail.py).

Без сети: база и папка очереди — во временной папке, ключи очереди и админки — тестовые.

    python -m pytest server/tests/test_contrib.py -q
"""
from __future__ import annotations

import base64
import importlib.util
import io
import json
import os
import tempfile
import zipfile
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
_tmp = tempfile.mkdtemp(prefix="fcg-contrib-")
os.environ.setdefault("FC_DB", os.path.join(_tmp, "game.db"))
os.environ["FC_WORLD"] = "fake"
os.environ["FC_CONTRIB"] = os.path.join(_tmp, "contrib")

_spec = importlib.util.spec_from_file_location("fcg_app_contrib", GAME / "app.py")
fcg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fcg)
import contrib  # noqa: E402  — app.py кладёт папку службы в sys.path
import contribmail  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

KEY = "test-contrib-key-0123456789"
ADMIN_KEY = "test-admin-key-contrib-mail"
H = {"X-Contrib-Key": KEY}
ADMIN = {"X-Admin-Key": ADMIN_KEY}
EMAIL = "vasya.pupkin+city@gmail.com"
PR_URL = "https://github.com/kremenevskiy/ariflame-city/pull/7"
PATCH = """diff --git a/client/fstory.js b/client/fstory.js
--- a/client/fstory.js
+++ b/client/fstory.js
@@ -1,3 +1,3 @@
-var a = 1;
+var a = 2;
"""


def base(**kw) -> dict:
    d = {"title": "Скамейки на бульваре", "idea": "На Маяке негде присесть — добавил скамейки вдоль бульвара.",
         "author": "vasya", "contact": "@vasya_tg", "tool": "ChatGPT", "agree": True}
    d.update(kw)
    return d


def zipb64(files: dict[str, str | bytes]) -> str:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in files.items():
            z.writestr(name, data)
    return base64.b64encode(buf.getvalue()).decode()


@pytest.fixture()
def client(monkeypatch):
    contrib._hits.clear()
    contrib._total.clear()
    contribmail._mail_hits.clear()
    monkeypatch.setenv("FC_CONTRIB_KEY", KEY)
    monkeypatch.setenv("FC_ADMIN_KEY", ADMIN_KEY)
    monkeypatch.delenv("FC_SITE", raising=False)
    with TestClient(fcg.app) as c:
        yield c


def test_patch_goes_to_queue_and_status_hides_contact(client):
    r = client.post("/g/contrib", json=base(patch=PATCH))
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    assert r.json()["files"] == ["client/fstory.js"]
    st = client.get(f"/g/contrib/{cid}").json()
    assert st["status"] == "pending" and st["title"] == "Скамейки на бульваре"
    assert "contact" not in st and "author" not in st and "patch" not in st
    q = client.get("/g/contrib/pending", headers={"X-Contrib-Key": KEY}).json()["items"]
    mine = [d for d in q if d["id"] == cid][0]
    assert mine["patch"] == PATCH and "contact" not in mine


def test_queue_needs_key(client, monkeypatch):
    assert client.get("/g/contrib/pending").status_code == 404
    assert client.get("/g/contrib/pending", headers={"X-Contrib-Key": "wrong"}).status_code == 404
    monkeypatch.setenv("FC_CONTRIB_KEY", "")
    assert client.get("/g/contrib/pending", headers={"X-Contrib-Key": ""}).status_code == 404   # ключ не задан — выключено


def test_result_moves_status_and_checks_pr_url(client):
    cid = client.post("/g/contrib", json=base(patch=PATCH)).json()["id"]
    h = {"X-Contrib-Key": KEY}
    assert client.post(f"/g/contrib/{cid}/result", json={"status": "pr", "pr_url": "https://evil.example/x"}, headers=h).status_code == 400
    assert client.post(f"/g/contrib/{cid}/result", json={"status": "pr"}).status_code == 404       # без ключа
    r = client.post(f"/g/contrib/{cid}/result", json={"status": "pr", "pr_url": "https://github.com/kremenevskiy/ariflame-city/pull/7"}, headers=h)
    assert r.status_code == 200 and r.json()["pr_url"].endswith("/pull/7")
    assert cid not in [d["id"] for d in client.get("/g/contrib/pending", headers=h).json()["items"]]
    r = client.post(f"/g/contrib/{cid}/result", json={"status": "rejected", "reason": "патч не накладывается"}, headers=h)
    assert client.get(f"/g/contrib/{cid}").json()["reason"] == "патч не накладывается"


def test_zip_strips_top_folder_and_takes_note(client):
    z = zipb64({"flame-change/client/fbench.js": "// скамейки\n", "flame-change/CHANGE.md": "# Скамейки\nкак проверить: …",
                "__MACOSX/._x": b"\x00\x01", "flame-change/.DS_Store": b"\x00"})
    r = client.post("/g/contrib", json=base(zip=z))
    assert r.status_code == 200, r.text
    assert r.json()["files"] == ["client/fbench.js"]
    q = client.get("/g/contrib/pending", headers={"X-Contrib-Key": KEY}).json()["items"]
    d = [x for x in q if x["id"] == r.json()["id"]][0]
    assert d["files"][0]["path"] == "client/fbench.js" and "как проверить" in d["note"]


@pytest.mark.parametrize("bad", ["../client/x.js", "client/../server/app.py", "server/app.py", ".github/workflows/ci.yml",
                                 "client/vendor/three-r160.js", "client/config.js", "client/minsk/map.json", "client/x.png",
                                 "/etc/passwd", "client/a//b.js"])
def test_bad_paths_rejected(client, bad):
    r = client.post("/g/contrib", json=base(files=[{"path": bad, "content": "x"}]))
    assert r.status_code == 400, (bad, r.text)


def test_patch_checks(client):
    assert client.post("/g/contrib", json=base(patch="просто текст")).status_code == 400
    bad = PATCH.replace("client/fstory.js", "server/app.py")
    assert client.post("/g/contrib", json=base(patch=bad)).status_code == 400
    binp = PATCH + "GIT binary patch\nliteral 3\n"
    assert client.post("/g/contrib", json=base(patch=binp)).status_code == 400
    assert client.post("/g/contrib", json=base(patch=PATCH, agree=False)).status_code == 400          # нет согласия
    assert client.post("/g/contrib", json=base(patch=PATCH, files=[{"path": "client/a.js", "content": "1"}])).status_code == 400
    assert client.post("/g/contrib", json=base(patch=PATCH, title="")).status_code == 400


@pytest.mark.parametrize("extra", [
    "diff --git a/.gitattributes b/.gitattributes\nnew file mode 100644\n@@ -0,0 +1 @@\n+* -diff\n",              # без ---/+++
    "diff --git a/client/a.js b/client/b.js\nsimilarity index 90%\nrename from client/a.js\nrename to client/b.js\n",
    "diff --git a/client/x.js b/client/x.js\nold mode 100644\nnew mode 100755\n",
    "diff --git a/client/l.js b/client/l.js\nnew file mode 120000\n--- /dev/null\n+++ b/client/l.js\n@@ -0,0 +1 @@\n+/proc/self/environ\n",
    "diff --git a/client/./vendor/three-r160.js b/client/./vendor/three-r160.js\n--- a/client/./vendor/three-r160.js\n+++ b/client/./vendor/three-r160.js\n@@ -1 +1 @@\n-a\n+b\n",
])
def test_patch_tricks_rejected(client, extra):
    r = client.post("/g/contrib", json=base(patch=PATCH + extra))
    assert r.status_code == 400, (extra, r.text)


def test_deleting_files_rejected(client):
    rm = "diff --git a/client/fstory.js b/client/fstory.js\ndeleted file mode 100644\n--- a/client/fstory.js\n+++ /dev/null\n@@ -1 +0,0 @@\n-var a = 1;\n"
    r = client.post("/g/contrib", json=base(patch=rm))
    assert r.status_code == 400 and "улучшают" in r.text


def test_binary_in_zip_rejected(client):
    r = client.post("/g/contrib", json=base(zip=zipb64({"client/tex.js": b"\xff\xfe\x00bad"})))
    assert r.status_code == 400


def test_rate_limit_per_ip(client):
    for _ in range(contrib.IP_N):
        assert client.post("/g/contrib", json=base(patch=PATCH)).status_code == 200
    assert client.post("/g/contrib", json=base(patch=PATCH)).status_code == 429


def test_rate_limit_ignores_spoofed_forwarded_for(client):
    """Аудит M-2: левый X-Forwarded-For пишет сам клиент — новый адрес в заголовке не даёт нового лимита."""
    for i in range(contrib.IP_N):
        r = client.post("/g/contrib", json=base(patch=PATCH), headers={"x-forwarded-for": f"203.0.113.{i}"})
        assert r.status_code == 200
    r = client.post("/g/contrib", json=base(patch=PATCH), headers={"x-forwarded-for": "198.51.100.77"})
    assert r.status_code == 429


def test_unknown_id_404(client):
    assert client.get("/g/contrib/AAAAAAAAAAAA").status_code == 404
    assert client.get("/g/contrib/..%2F..%2Fgame").status_code == 404


# ---- почта и письма о статусе (contribmail.py) -----------------------------------------------------------------------

def send(client, **kw) -> str:
    r = client.post("/g/contrib", json=base(patch=PATCH, **kw))
    assert r.status_code == 200, r.text
    return r.json()["id"]


def move(client, cid, status, **kw):
    return client.post(f"/g/contrib/{cid}/result", json={"status": status, **kw}, headers=H)


def mails(client, cid) -> list[dict]:
    r = client.get("/g/admin/contrib/outbox", headers=ADMIN)
    assert r.status_code == 200, r.text
    return [m for m in r.json()["items"] if m["cid"] == cid]


def mail_row(cid):
    st = fcg.db()
    with st.lock:
        return st.db.execute("SELECT email FROM contrib_mail WHERE cid = ?", (cid,)).fetchone()


def test_email_stays_on_server(client):
    """Почта не уходит ни в статус, ни в очередь для GitHub Actions, ни в файл очереди, ни в список для сверки PR."""
    r = client.post("/g/contrib", json=base(patch=PATCH, email="  Vasya.Pupkin+City@Gmail.COM "))
    assert r.status_code == 200 and r.json()["notify"] is True
    cid = r.json()["id"]
    assert mail_row(cid)["email"] == EMAIL                                    # строчными, без пробелов
    assert EMAIL not in client.get(f"/g/contrib/{cid}").text
    assert EMAIL not in client.get("/g/contrib/pending", headers=H).text
    with open(os.path.join(os.environ["FC_CONTRIB"], cid + ".json"), encoding="utf-8") as f:
        assert EMAIL not in f.read()
    assert move(client, cid, "pr", pr_url=PR_URL).status_code == 200
    w = client.get("/g/contrib/watch", headers=H).text
    assert cid in w and EMAIL not in w and "vasya" not in w                   # ни почты, ни автора


@pytest.mark.parametrize("bad", ["vasya", "a@b", "a b@c.com", "a@b.com,c@d.com", "a@b.com\nbcc: z@w.com", "<a@b.com>",
                                 "a..b@c.com", ".a@c.com", "a.@c.com", "a%b@c.com", "вася@почта.рф", "a@-b.com",
                                 "x" * 110 + "@gmail.com", "a@" + "b" * 60 + "." + "c" * 60 + ".com", 12345, ["a@b.com"]])
def test_bad_email_rejected(client, bad):
    r = client.post("/g/contrib", json=base(patch=PATCH, email=bad))
    assert r.status_code == 400, (bad, r.text)


def test_no_email_no_mail(client):
    r = client.post("/g/contrib", json=base(patch=PATCH, email=""))
    assert r.json()["notify"] is False
    cid = r.json()["id"]
    assert move(client, cid, "pr", pr_url=PR_URL).status_code == 200
    assert move(client, cid, "live").status_code == 200
    assert mails(client, cid) == [] and mail_row(cid) is None


def test_flow_to_live_sends_three_mails_then_erases(client):
    cid = send(client, email=EMAIL)
    assert move(client, cid, "taken").status_code == 200
    assert mails(client, cid) == []                                          # «забрали» — без письма
    assert move(client, cid, "pr", pr_url=PR_URL).status_code == 200
    assert move(client, cid, "pr", pr_url=PR_URL).status_code == 200          # повтор отчёта — письмо не задваивается
    assert move(client, cid, "merged").status_code == 200
    assert move(client, cid, "live").status_code == 200
    assert client.get(f"/g/contrib/{cid}").json()["status"] == "live"
    ms = mails(client, cid)
    assert [m["status"] for m in ms] == ["pr", "merged", "live"] and all(m["to"] == EMAIL for m in ms)
    live = ms[-1]
    assert live["subject"] == "Флейм-Сити: твоя правка «Скамейки на бульваре» в городе"
    assert "Привет, vasya!" in live["text"] and "https://city.ariflame.com/" in live["text"] and PR_URL in live["text"]
    assert "<a href=" in live["html"] and "<script" not in live["html"]
    assert "@vasya_tg" not in json.dumps(ms)                                  # контакт — не в письма
    assert client.get("/g/admin/contrib/outbox").status_code == 404           # без ключа админки
    assert client.post(f"/g/admin/contrib/outbox/{ms[0]['mid']}/sent", headers={"X-Admin-Key": "nope"}).status_code == 404
    # письмо о PR ушло — адрес правки ещё нужен; ушло письмо об окончательном статусе — стёрт
    assert client.post(f"/g/admin/contrib/outbox/{ms[0]['mid']}/sent", headers=ADMIN).json() == {"ok": True, "erased": False}
    assert mail_row(cid) is not None
    assert client.post(f"/g/admin/contrib/outbox/{ms[1]['mid']}/sent", headers=ADMIN).json()["erased"] is False
    assert client.post(f"/g/admin/contrib/outbox/{live['mid']}/sent", json={"result": "sent"}, headers=ADMIN).json()["erased"] is True
    assert mail_row(cid) is None and mails(client, cid) == []
    again = client.post(f"/g/admin/contrib/outbox/{live['mid']}/sent", headers=ADMIN).json()
    assert again["already"] is True                                           # повтор отметки — не ошибка
    st = fcg.db()
    with st.lock:
        rows = st.db.execute("SELECT rcpt FROM contrib_outbox WHERE cid = ?", (cid,)).fetchall()
    assert rows and all(r["rcpt"] is None for r in rows)                      # у отправленных адреса нет
    assert client.post("/g/admin/contrib/outbox/999999/sent", headers=ADMIN).status_code == 404


def test_live_straight_from_pr_is_one_mail(client):
    """Влили и выкатили между двумя обходами intake — одно письмо «в городе», без «приняли»."""
    cid = send(client, email=EMAIL)
    move(client, cid, "pr", pr_url=PR_URL)
    assert move(client, cid, "live").status_code == 200
    assert [m["status"] for m in mails(client, cid)] == ["pr", "live"]


def test_rejected_and_closed_mails_carry_reason(client):
    cid = send(client, email=EMAIL)
    assert move(client, cid, "rejected", reason="правка (git diff) не накладывается на свежую версию игры.").status_code == 200
    m = mails(client, cid)[0]
    assert "не прошла проверку" in m["subject"] and "Почему: правка (git diff) не накладывается на свежую версию игры." in m["text"]
    assert "contribute.html" in m["text"]
    cid2 = send(client, email=EMAIL)
    move(client, cid2, "pr", pr_url=PR_URL)
    assert move(client, cid2, "closed", reason="Уже есть похожая правка #5").status_code == 200
    m2 = mails(client, cid2)[-1]
    assert m2["status"] == "closed" and "пока не взяли" in m2["subject"] and "Уже есть похожая правка #5" in m2["text"]
    assert client.get(f"/g/contrib/{cid2}").json()["reason"] == "Уже есть похожая правка #5"


def test_bounced_erases_address_and_drops_other_mails(client):
    cid = send(client, email=EMAIL)
    move(client, cid, "pr", pr_url=PR_URL)
    move(client, cid, "merged")
    first, second = mails(client, cid)
    r = client.post(f"/g/admin/contrib/outbox/{first['mid']}/sent", json={"result": "bounced"}, headers=ADMIN)
    assert r.json()["erased"] is True
    assert mail_row(cid) is None and mails(client, cid) == []                 # второе письмо на мёртвый адрес — тоже снято
    assert move(client, cid, "live").status_code == 200 and mails(client, cid) == []
    assert client.post(f"/g/admin/contrib/outbox/{second['mid']}/sent", json={"result": "lost"}, headers=ADMIN).status_code == 400


@pytest.mark.parametrize("path", [["pr", "pending"], ["pr", "taken"], ["pending", "merged"], ["pending", "live"],
                                  ["pr", "merged", "closed"], ["pr", "merged", "pr"], ["rejected", "pending"],
                                  ["pr", "live", "merged"], ["pr", "closed", "merged"]])
def test_status_transitions_guarded(client, path):
    cid = send(client)
    for st in path[:-1]:
        assert move(client, cid, st, pr_url=PR_URL).status_code == 200, st
    assert move(client, cid, path[-1], pr_url=PR_URL).status_code == 409


def test_watch_lists_open_and_merged_prs(client):
    assert client.get("/g/contrib/watch").status_code == 404
    a, b, c, d = send(client), send(client), send(client), send(client)
    move(client, a, "pr", pr_url=PR_URL)
    move(client, b, "pr", pr_url=PR_URL.replace("/7", "/8"))
    move(client, b, "merged")
    move(client, c, "pr", pr_url=PR_URL.replace("/7", "/9"))
    move(client, c, "live")
    items = client.get("/g/contrib/watch", headers=H).json()["items"]
    got = {x["id"]: x for x in items}
    assert a in got and b in got and c not in got and d not in got
    assert got[b]["status"] == "merged" and got[b]["pr_url"].endswith("/pull/8")
    assert set(got[a]) == {"id", "title", "status", "pr_url", "updated"}


def test_mail_limit_per_address(client, monkeypatch):
    """Чужую почту не завалить: с одним адресом — не больше MAIL_N правок с письмами в сутки, дальше правка без писем."""
    monkeypatch.setattr(contrib, "IP_N", 100)
    for _ in range(contribmail.MAIL_N):
        assert client.post("/g/contrib", json=base(patch=PATCH, email="limit@example.org")).json()["notify"] is True
    r = client.post("/g/contrib", json=base(patch=PATCH, email="limit@example.org"))
    assert r.status_code == 200 and r.json()["notify"] is False and mail_row(r.json()["id"]) is None


def test_mail_text_has_no_foreign_links(client):
    cid = send(client, email=EMAIL, title="Выигрыш на https://scam.example/win", author="www.spam.example")
    move(client, cid, "pr", pr_url=PR_URL)
    m = mails(client, cid)[0]
    blob = m["subject"] + m["text"] + m["html"]
    assert "scam.example" not in blob and "spam.example" not in blob


def test_sweep_expires_old_mails_and_addresses(client):
    cid = send(client, email=EMAIL)
    move(client, cid, "rejected", reason="не накладывается")
    st = fcg.db()
    with st.lock:
        st.db.execute("UPDATE contrib_outbox SET created = created - ? WHERE cid = ?", (contribmail.OUTBOX_TTL + 10, cid))
    assert mails(client, cid) == []                                          # outbox сам чистит просроченное
    assert mail_row(cid) is None
    cid2 = send(client, email=EMAIL)
    with st.lock:
        st.db.execute("UPDATE contrib_mail SET created = created - ? WHERE cid = ?", (contribmail.MAIL_KEEP + 10, cid2))
    mails(client, cid2)
    assert mail_row(cid2) is None


def test_mail_links_follow_fc_site(client, monkeypatch):
    monkeypatch.setenv("FC_SITE", "https://game.example.org/")
    cid = send(client, email=EMAIL)
    move(client, cid, "pr", pr_url=PR_URL)
    m = mails(client, cid)[0]
    assert "https://game.example.org/contribute.html#" + cid in m["text"] and "city.ariflame.com" not in m["text"]
