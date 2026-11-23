#!/bin/sh
# Сайт сам забирает выпуск «live» с GitHub (его делает workflow «Выпуск» после зелёных проверок main) — ключей от
# сервера в GitHub нет. Ставится на сервер таймером (раз в минуту, systemd/cron), см. docs/DEPLOY.md «Автовыкатка».
#   REPO     owner/repo                         (kremenevskiy/ariflame-city)
#   DEST     ссылка, которую отдаёт веб-сервер  (/var/www/city — должна быть символической ссылкой)
#   ROOT     где лежат выпуски                  (/var/www/city-releases)
#   OVERLAY  свои файлы поверх выпуска: config.js, music/, places/partners/ — то, чего нет в открытом репо
#   KEEP     сколько выпусков хранить           (5)
# Сверяет sha256, раскладывает в новую папку и атомарно переключает ссылку: сайт не бывает «наполовину выложен».
set -eu
REPO=${REPO:-kremenevskiy/ariflame-city}
DEST=${DEST:-/var/www/city}
ROOT=${ROOT:-/var/www/city-releases}
OVERLAY=${OVERLAY:-/srv/city-overlay}
KEEP=${KEEP:-5}

json=$(curl -fsS "https://api.github.com/repos/$REPO/releases/tags/live") || exit 0
name=$(printf '%s' "$json" | python3 -c 'import json,sys; a=[x["name"] for x in json.load(sys.stdin).get("assets",[]) if x["name"].endswith(".tgz")]; print(a[0] if a else "")')
[ -n "$name" ] || exit 0
sha=${name#dist-}; sha=${sha%.tgz}
case "$sha" in *[!0-9a-f]*|"") echo "city: странное имя выпуска $name" >&2; exit 1 ;; esac
[ "$(readlink "$DEST" 2>/dev/null || true)" = "$ROOT/$sha" ] && exit 0

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
base="https://github.com/$REPO/releases/download/live"
curl -fsSL "$base/$name" -o "$tmp/$name"
curl -fsSL "$base/$name.sha256" -o "$tmp/$name.sha256"
(cd "$tmp" && sha256sum -c "$name.sha256" >/dev/null)

mkdir -p "$ROOT"
new="$ROOT/$sha.new"
rm -rf "$new" && mkdir -p "$new"
tar -xzf "$tmp/$name" -C "$new"
[ -d "$OVERLAY" ] && cp -R "$OVERLAY"/. "$new"/
echo "$sha" > "$new/version.txt"
chmod -R a+rX "$new"
rm -rf "$ROOT/$sha" && mv "$new" "$ROOT/$sha"
ln -sfn "$ROOT/$sha" "$DEST.next" && mv -T "$DEST.next" "$DEST"
# старые выпуски — кроме KEEP последних
ls -1dt "$ROOT"/*/ 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r d; do rm -rf "$d"; done
echo "city: на сайте $sha"
