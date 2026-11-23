# Выкладка: свой сервер

Игра — две части: **статика** `client/` (любой веб-сервер или CDN) и **игровой сервер** `server/` (uvicorn + SQLite).
Проще всего — один домен: статика в корне, `/g/*` проксируется на игровой сервер. Тогда в `client/config.js` ничего
менять не нужно (`server: ""` — тот же адрес).

```
браузер ──https──▶ обратный прокси (nginx / Caddy)
                     ├── /            → файлы client/
                     └── /g/*         → http://127.0.0.1:8091  (WebSocket /g/ws, тело /g/photo до 2 МБ)
```

## 1. Статика

Скопируйте `client/` как есть (например в `/srv/flame-city/www/`). Сборка не обязательна; `npm run build` кладёт в
`dist/` копию с ужатыми модулями. Кэш: `minsk/*`, `people/*`, `cars/*`, `tex/*`, `vendor/*` — надолго (в именах и
запросах есть версии), `index.html`, `config.js` и `f*.js` — короткий или `no-cache`. Типы: `.glb` → `model/gltf-binary`,
`.webp` → `image/webp`. Включите gzip/brotli для `.js` и `.json` (куски Минска жмутся в 3–4 раза).

Свой `config.js` — рядом с `index.html` (адрес сервера, вход, ссылки «поделиться», бот Telegram, музыка). Без него игра
работает гостями на том же адресе.

**Свои места** (необязательно): заведения с логотипами, свои здания на настоящих контурах, интерьеры по этажам, названия на
вывесках, районы для старта — пакеты JSON, формат в `client/places/README.md`. Положить рядом со статикой и перечислить в
`config.js`: `places: ["places/partners/minsk.json"]`. Логотипы и названия чужих заведений — только с их разрешения;
в этот репозиторий такие пакеты не кладём.

## 2. Игровой сервер

```bash
sudo useradd --system --home /srv/flame-city --shell /usr/sbin/nologin fcg
sudo -u fcg python3 -m venv /srv/flame-city/venv
sudo -u fcg /srv/flame-city/venv/bin/pip install -r /srv/flame-city/app/server/requirements.txt
```

`/etc/systemd/system/fcg.service` (пример):

```ini
[Unit]
Description=Flame City game server
After=network.target

[Service]
User=fcg
WorkingDirectory=/srv/flame-city/app/server
Environment=FC_DB=/var/lib/fcg/game.db
Environment=FC_ORIGINS=https://game.example.org
Environment=FC_PUBLIC=https://game.example.org
# Environment=FC_WORLD=https://id.example.org        # вход через внешний аккаунт — docs/AUTH.md
ExecStart=/srv/flame-city/venv/bin/uvicorn app:app --host 127.0.0.1 --port 8091 --ws websockets --proxy-headers --forwarded-allow-ips=127.0.0.1 --log-level warning
Restart=always
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
StateDirectory=fcg

[Install]
WantedBy=multi-user.target
```

Один процесс (`--workers 1`): положения игроков и комнаты режимов живут в памяти процесса. 300 игроков онлайн — меньше
одного ядра и ~150 МБ памяти.

Docker (пример):

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server/ ./
COPY client/tracks.json ./tracks.json
ENV FC_DB=/data/game.db
VOLUME /data
EXPOSE 8091
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8091", "--ws", "websockets", "--proxy-headers", "--forwarded-allow-ips=*"]
```

Переменные окружения — [server/README.md](../server/README.md). Резервная копия базы:
`sqlite3 /var/lib/fcg/game.db ".backup /backup/game-$(date +%F).db"`.

## 3. Обратный прокси

Правила для `/g/*`:
- WebSocket `/g/ws`: передать `Upgrade`/`Connection`, таймаут чтения ≥ 60 с (клиент шлёт кадр минимум раз в секунду);
- тело запроса: `/g/photo` — до **2 МБ** (кадр фоторежима ≤ 1,5 МБ), остальные `/g/*` — 128 КБ хватает;
- `X-Forwarded-For`/`X-Forwarded-Proto` — сервер считает лимиты кадров по адресу и строит HTTPS-ссылки.

nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name game.example.org;
    root /srv/flame-city/www;
    gzip on; gzip_types application/javascript application/json text/css image/svg+xml;

    location = /g/ws {
        proxy_pass http://127.0.0.1:8091;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
    }
    location = /g/photo {
        client_max_body_size 2m;
        proxy_pass http://127.0.0.1:8091;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location /g/ {
        client_max_body_size 128k;
        proxy_pass http://127.0.0.1:8091;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location ~* \.(glb|webp|png|json)$ { expires 30d; }
    location / { try_files $uri $uri/ =404; add_header Cache-Control "no-cache"; }
}
```

Caddy:

```caddy
game.example.org {
	encode zstd gzip
	handle /g/photo {
		request_body {
			max_size 2MB
		}
		reverse_proxy 127.0.0.1:8091
	}
	handle /g/* {
		request_body {
			max_size 128KB
		}
		reverse_proxy 127.0.0.1:8091
	}
	handle {
		root * /srv/flame-city/www
		file_server
	}
}
```

Caddy проксирует WebSocket сам. Если перед прокси есть ещё один (CDN, мост), сокет на нём часто требует точного правила
для `/g/ws` — иначе общий `location /` срежет `Upgrade`.

**Игровой сервер на другом адресе** (`https://play-api.example.org`): в `config.js` — `server: "https://play-api.example.org"`,
на сервере — `FC_ORIGINS=https://game.example.org` (CORS для HTTP и проверка Origin у сокета).

## 4. Проверка

```bash
curl -s https://game.example.org/g/health                                   # {"ok":true,"online":0}
curl -s -o /dev/null -w '%{http_code}\n' --http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' https://game.example.org/g/ws   # 101
BASE=https://game.example.org/ npm run check                                # оба города, без ошибок и чужих запросов
```

Остановить онлайн без выкладки — остановить службу: клиент молча играет в одиночку и переподключится сам.

## 5. Telegram Mini App (необязательно)

Игра открывается кнопкой бота как мини-аппа: адрес игры — в BotFather (Menu Button / Web App). SDK Telegram страница
грузит только внутри Telegram. `config.js` → `telegramBot: "имя_бота"` — тогда «поделиться» даёт ссылки
`t.me/<бот>?startapp=fc_<город>_<x>_<z>` (переход в точку). Сторис из фоторежима требуют публичный HTTPS-адрес кадра
(`FC_PUBLIC`).

## Автовыкатка (сайт сам забирает проверенный выпуск)

После слияния в `main` и зелёных проверок workflow «Выпуск» кладёт собранную статику в GitHub-выпуск `live`
(`dist-<коммит>.tgz` + `.sha256`). Сервер раз в минуту забирает его сам — ключей от сервера в GitHub нет:

```bash
# один раз: своё поверх выпуска (то, чего нет в открытом репо) и переход на выпуски-папки со ссылкой
mkdir -p /srv/city-overlay && cp /var/www/city/config.js /srv/city-overlay/      # + music/, places/partners/ — если есть
mv /var/www/city /var/www/city-legacy && mkdir -p /var/www/city-releases
REPO=owner/repo DEST=/var/www/city sh tools/deploy/pull-live.sh                  # первая выкатка создаст ссылку
# таймер (cron): * * * * * REPO=owner/repo sh /opt/city/pull-live.sh >> /var/log/city-pull.log 2>&1
```

Скрипт сверяет sha256, раскладывает выпуск в новую папку, кладёт поверх `OVERLAY`, пишет `version.txt` (его читает
страница статуса) и атомарно переключает ссылку `DEST`; хранит последние 5 выпусков — откат = переключить ссылку.

## ODbL

Если выкладываете «Минск 1:1»: данные `client/minsk/` и `client/tex/minsk-landmarks.json` — производная база OpenStreetMap
под ODbL 1.0. Подпись «© участники OpenStreetMap» уже есть в игре; базу нужно отдавать по запросу под той же лицензией
(достаточно ссылки на этот репозиторий). Подробно — [ASSETS.md](../ASSETS.md).
