#!/bin/sh
# Автовыкатка: сервер сам забирает выпуск «live» с GitHub (его делает workflow «Выпуск» после зелёных проверок main) —
# ключей от сервера в GitHub нет. Ставится таймером (раз в минуту, systemd), см. docs/DEPLOY.md «Автовыкатка».
#
#   REPO     owner/repo                         (kremenevskiy/ariflame-city)
#   DEST     ссылка, которую отдаёт веб-сервер  (/var/www/city — символическая ссылка на текущий выпуск)
#   ROOT     где лежат выпуски                  (/var/www/city-releases)
#   OVERLAY  свои файлы поверх выпуска: config.js, music/, places/partners/ — то, чего нет в открытом репо
#   KEEP     сколько выпусков хранить           (5)
#   CT       контейнер Incus игрового сервера   (пусто — сервер не трогаем; на ea-01 — city)
#
# Статика: сверяет sha256, раскладывает в новую папку и атомарно переключает ссылку — сайт не бывает «наполовину
# выложен». Сервер (если в выпуске есть server-<sha>.tgz и задан CT): код меняется, только если он правда другой
# (сумма файлов); requirements.txt поменялся — pip в venv; рестарт fcg и проверка /g/health; не поднялся — откат на
# прежний код. Распаковка безопасная (аудит 24.11): без владельцев и прав из архива, ссылки и не-файлы выкидываются.
set -eu
REPO=${REPO:-kremenevskiy/ariflame-city}
DEST=${DEST:-/var/www/city}
ROOT=${ROOT:-/var/www/city-releases}
OVERLAY=${OVERLAY:-/srv/city-overlay}
KEEP=${KEEP:-5}
CT=${CT:-}
UA="FlameCity-PullLive/1.0"

json=$(curl -fsS -A "$UA" "https://api.github.com/repos/$REPO/releases/tags/live") || exit 0
assets=$(printf '%s' "$json" | python3 -c 'import json,sys; print(" ".join(x["name"] for x in json.load(sys.stdin).get("assets",[])))')
name=""; srv=""
for a in $assets; do case "$a" in dist-*.tgz) name=$a ;; server-*.tgz) srv=$a ;; esac; done
[ -n "$name" ] || exit 0
sha=${name#dist-}; sha=${sha%.tgz}
case "$sha" in *[!0-9a-f]*|"") echo "city: странное имя выпуска $name" >&2; exit 1 ;; esac

base="https://github.com/$REPO/releases/download/live"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
fetch() {   # fetch <имя> — архив и его сумма, сверка
  curl -fsSL -A "$UA" "$base/$1" -o "$tmp/$1"
  curl -fsSL -A "$UA" "$base/$1.sha256" -o "$tmp/$1.sha256"
  (cd "$tmp" && sha256sum -c "$1.sha256" >/dev/null)
}
unpack() {  # unpack <архив> <папка> — без владельцев/прав из архива; ссылки, устройства и прочие не-файлы — вон
  mkdir -p "$2"
  tar -xzf "$1" -C "$2" --no-same-owner --no-same-permissions --no-overwrite-dir
  find "$2" ! -type f ! -type d -exec rm -f {} +
}

# ---- статика -------------------------------------------------------------------------------------------------------
if [ "$(readlink "$DEST" 2>/dev/null || true)" != "$ROOT/$sha" ]; then
  fetch "$name"
  mkdir -p "$ROOT"
  new="$ROOT/$sha.new"
  rm -rf "$new"
  unpack "$tmp/$name" "$new"
  [ -d "$OVERLAY" ] && cp -R "$OVERLAY"/. "$new"/
  echo "$sha" > "$new/version.txt"
  chmod -R u=rwX,go=rX "$new"
  rm -rf "${ROOT:?}/$sha" && mv "$new" "$ROOT/$sha"
  ln -sfn "$ROOT/$sha" "$DEST.next" && mv -T "$DEST.next" "$DEST"
  ls -1dt "$ROOT"/*/ 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r d; do rm -rf "$d"; done
  echo "city: статика $sha на сайте"
fi

# ---- игровой сервер (контейнер CT) ----------------------------------------------------------------------------------
[ -n "$CT" ] && [ -n "$srv" ] || exit 0
command -v incus >/dev/null || { echo "city: нет incus — сервер не обновляю" >&2; exit 0; }
fetch "$srv"
unpack "$tmp/$srv" "$tmp/srv"
# только то, что нужно серверу: *.py, requirements.txt, tracks.json — и только плоско
[ -f "$tmp/srv/requirements.txt" ] && ls "$tmp/srv"/*.py >/dev/null 2>&1 || { echo "city: в $srv нет кода сервера" >&2; exit 1; }
want=$(cd "$tmp/srv" && cat requirements.txt tracks.json *.py 2>/dev/null | sha256sum | cut -c1-16)
have=$(incus exec "$CT" -- cat /opt/fcg/code.sum 2>/dev/null || true)
[ "$want" = "$have" ] && exit 0

incus exec "$CT" -- rm -rf /tmp/fcg-new
incus exec "$CT" -- mkdir -p /tmp/fcg-new/app
for f in "$tmp/srv"/*.py "$tmp/srv/tracks.json"; do [ -f "$f" ] && incus file push "$f" "$CT/tmp/fcg-new/app/"; done
incus file push "$tmp/srv/requirements.txt" "$CT/tmp/fcg-new/requirements.txt"
incus exec "$CT" -- sh -s "$want" <<'IN'
set -eu
S=/tmp/fcg-new
if [ ! -x /opt/fcg/venv/bin/uvicorn ] || ! cmp -s "$S/requirements.txt" /opt/fcg/requirements.txt; then
  /opt/fcg/venv/bin/pip install -q -r "$S/requirements.txt" && cp "$S/requirements.txt" /opt/fcg/requirements.txt
fi
rm -rf /opt/fcg/app.old; [ -d /opt/fcg/app ] && mv /opt/fcg/app /opt/fcg/app.old
cp -r "$S/app" /opt/fcg/app && chmod -R a+rX /opt/fcg/app
systemctl restart fcg
for i in $(seq 1 40); do
  if curl -fsS -m 2 http://127.0.0.1:8091/g/health >/dev/null 2>&1; then echo "$1" > /opt/fcg/code.sum; rm -rf "$S"; echo "fcg: новый код поднялся"; exit 0; fi
  sleep 0.5
done
echo "fcg: новый код не поднялся — откат" >&2
rm -rf /opt/fcg/app && mv /opt/fcg/app.old /opt/fcg/app && systemctl restart fcg
exit 1
IN
echo "city: сервер $sha ($want)"
