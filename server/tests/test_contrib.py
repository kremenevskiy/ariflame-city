"""Правки без GitHub (server/contrib.py): приём правки с сайта, статус по ссылке, очередь для contrib-intake.yml.

Без сети: база и папка очереди — во временной папке, ключ очереди — тестовый.

    python -m pytest server/tests/test_contrib.py -q
"""
from __future__ import annotations

import base64
import importlib.util
import io
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

from fastapi.testclient import TestClient  # noqa: E402

KEY = "test-contrib-key-0123456789"
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
    monkeypatch.setenv("FC_CONTRIB_KEY", KEY)
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
