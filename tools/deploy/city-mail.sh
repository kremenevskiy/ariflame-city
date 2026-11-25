#!/bin/sh
# Письма авторам правок с сайта (server/contribmail.py): игровой сервер только складывает их в очередь — у контейнера
# игры нет интернета, — а этот скрипт на хосте забирает очередь, отправляет через Resend (HTTP API) и отмечает
# отправленным. Ставится в тот же таймер, что и автовыкатка, см. docs/DEPLOY.md «Письма авторам правок».
#
#   ENV_FILE  настройки (/etc/city-mail.env, права 0600, владелец root). Нет файла или ключа — тихо выходим (0):
#               RESEND_API_KEY=re_…                              ключ Resend (только отправка)
#               MAIL_FROM='Флейм-Сити <city@example.org>'       отправитель на подтверждённом в Resend домене
#               MAIL_REPLY_TO=…                                  (необязательно) куда пойдут ответы
#   CT        контейнер Incus игрового сервера   (city)
#   KEYFILE   ключ /g/admin/* внутри контейнера  (/var/lib/fcg/admin.key — рядом с базой)
#   FCG       адрес игрового сервера в контейнере (http://127.0.0.1:8091)
#   MAX       писем за один запуск              (20)
#   RESEND_URL  адрес API отправки — только для проверки с заглушкой (https://api.resend.com/emails)
#
# Ни адресов, ни ключей в выводе (он уходит в журнал systemd): адрес — маской v***@gmail.com, ключ админки читается и
# подставляется внутри контейнера (не попадает ни в аргументы процессов, ни на хост), ключ Resend — из файла заголовков
# во временной папке 0700. Повторы безопасны: у письма постоянный Idempotency-Key — если отправили, а отметить не
# успели, Resend при повторе (в течение суток) не пошлёт второе.
set -eu
ENV_FILE=${ENV_FILE:-/etc/city-mail.env}
UA="FlameCity-Mail/1.0"
[ -f "$ENV_FILE" ] || exit 0
[ -r "$ENV_FILE" ] || { echo "city-mail: нет прав читать $ENV_FILE" >&2; exit 0; }
# файл с ключом — только владельцу (как admin.key у сервера): права шире — закрываем
case "$(ls -ln "$ENV_FILE" | cut -c5-10)" in ------) ;; *) chmod 600 "$ENV_FILE" 2>/dev/null || true ;; esac

conf() {    # conf <ИМЯ> — значение из ENV_FILE (последняя строка ИМЯ=…, кавычки по краям снимаем); файл не исполняем
  sed -n "s/^[[:space:]]*$1=//p" "$ENV_FILE" | tail -n 1 | sed "s/^[\"']//; s/[\"'][[:space:]]*\$//; s/[[:space:]]*\$//"
}
RESEND_API_KEY=$(conf RESEND_API_KEY)
MAIL_FROM=$(conf MAIL_FROM)
MAIL_REPLY_TO=$(conf MAIL_REPLY_TO)
[ -n "$RESEND_API_KEY" ] && [ -n "$MAIL_FROM" ] || exit 0
CT=${CT:-$(conf CT)}; CT=${CT:-city}
KEYFILE=${KEYFILE:-/var/lib/fcg/admin.key}
FCG=${FCG:-http://127.0.0.1:8091}
MAX=${MAX:-20}
command -v incus >/dev/null || { echo "city-mail: нет incus — письма не отправляю" >&2; exit 0; }
command -v python3 >/dev/null || { echo "city-mail: нет python3" >&2; exit 0; }
# два запуска сразу (таймер + руками) не мешают друг другу, но и не нужны
if command -v flock >/dev/null; then exec 9>"${LOCK:-/run/city-mail.lock}"; flock -n 9 || exit 0; fi

umask 077
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
printf 'Authorization: Bearer %s\n' "$RESEND_API_KEY" > "$tmp/auth"     # printf — встроенная: ключ не в аргументах
RESEND_API_KEY=""

# ручки игрового сервера — изнутри контейнера: ключ читает и подставляет сам контейнер (curl -H @- — заголовок из stdin).
# </dev/null: incus exec иначе съест stdin цикла ниже (список писем)
fcg_get() {     # fcg_get <путь>
  incus exec "$CT" -- sh -c 'printf "X-Admin-Key: %s\n" "$(cat "$1")" | curl -fsS -m 15 -H @- "$2$3"' sh "$KEYFILE" "$FCG" "$1" </dev/null
}
fcg_post() {    # fcg_post <путь> <json>
  incus exec "$CT" -- sh -c 'printf "X-Admin-Key: %s\n" "$(cat "$1")" | curl -fsS -m 15 -H @- -H "Content-Type: application/json" --data "$4" "$2$3" >/dev/null' \
    sh "$KEYFILE" "$FCG" "$1" "$2" </dev/null
}

fcg_get /g/admin/contrib/outbox > "$tmp/outbox.json" 2>"$tmp/err" || {
  echo "city-mail: очередь писем не прочитать (сервер перезапускается или старая версия) — в следующий раз" >&2; exit 0; }

# разобрать очередь: на каждое письмо — тело запроса к Resend ($tmp/m<mid>.json) и строка «mid статус idem маска»
MAIL_FROM="$MAIL_FROM" MAIL_REPLY_TO="$MAIL_REPLY_TO" MAX="$MAX" python3 -I - "$tmp" <<'PY'
import json, os, re, sys
tmp = sys.argv[1]
items = json.load(open(os.path.join(tmp, "outbox.json"), encoding="utf-8")).get("items") or []
lines = []
for it in items[: int(os.environ.get("MAX") or 20)]:
    mid, cid, st, to = it.get("mid"), str(it.get("cid") or ""), str(it.get("status") or ""), str(it.get("to") or "")
    # то же, что проверил сервер; не похоже — не шлём (вдруг база испорчена), пусть письмо истечёт само
    if not isinstance(mid, int) or not re.fullmatch(r"[A-Za-z0-9_-]{12}", cid) or not re.fullmatch(r"[a-z]{2,8}", st) \
            or len(to) > 120 or not re.fullmatch(r"[a-z0-9_][a-z0-9._+-]*@[a-z0-9.-]+\.[a-z0-9-]{2,63}", to):
        continue
    subj, text, html = (str(it.get(k) or "") for k in ("subject", "text", "html"))
    if not subj or not text:
        continue
    msg = {"from": os.environ["MAIL_FROM"], "to": [to], "subject": subj, "text": text}
    if html:
        msg["html"] = html
    if os.environ.get("MAIL_REPLY_TO"):
        msg["reply_to"] = os.environ["MAIL_REPLY_TO"]
    with open(os.path.join(tmp, f"m{mid}.json"), "w", encoding="utf-8") as f:
        json.dump(msg, f, ensure_ascii=False)
    local, _, dom = to.partition("@")
    lines.append(f"{mid} {st} city-{cid}-{st} {local[:1]}***@{dom}")
open(os.path.join(tmp, "list"), "w").write("".join(l + "\n" for l in lines))
PY

n=0
while read -r mid st idem masked; do
  [ -n "$mid" ] || continue
  code=$(curl -sS -m 20 -o "$tmp/resp" -w '%{http_code}' -A "$UA" -H @"$tmp/auth" -H "Content-Type: application/json" \
    -H "Idempotency-Key: $idem" --data-binary @"$tmp/m$mid.json" "${RESEND_URL:-https://api.resend.com/emails}" 2>"$tmp/err" </dev/null) || code=000
  # имя ошибки Resend — без текста (в нём может быть адрес)
  name=$(python3 -I -c 'import json,re,sys
try: print(re.sub(r"[^a-z_]", "", str(json.load(open(sys.argv[1])).get("name", "")))[:40])
except Exception: print("")' "$tmp/resp" </dev/null)
  case "$code" in
    200|201) res=sent ;;
    400|422)
      case "$name" in
        invalid_from_address|invalid_access|missing_api_key|invalid_api_key|invalid_idempotency_key)
          echo "city-mail: Resend не принял настройки ($code $name) — проверьте MAIL_FROM и ключ" >&2; exit 1 ;;
      esac
      res=bounced ;;                       # адрес не принимается — письмо снимаем, адрес сервер сотрёт
    401|403) echo "city-mail: Resend: ключ не принят или домен не подтверждён ($code $name)" >&2; exit 1 ;;
    409) echo "city-mail: #$mid ($st) → $masked: Resend ещё обрабатывает прошлую попытку — в следующий раз"; continue ;;
    *) echo "city-mail: Resend ответил $code $name — остальные письма в следующий раз" >&2; exit 0 ;;
  esac
  if fcg_post "/g/admin/contrib/outbox/$mid/sent" "{\"result\":\"$res\"}" 2>"$tmp/err"; then
    echo "city-mail: #$mid ($st) → $masked: $res"
  else
    echo "city-mail: #$mid ($st) → $masked: $res, но отметить не вышло — повтор не задвоит письмо (Idempotency-Key)" >&2
  fi
  n=$((n + 1))
  sleep 1                                  # Resend по умолчанию — 2 запроса в секунду
done < "$tmp/list"
[ "$n" -eq 0 ] || echo "city-mail: писем обработано: $n"
