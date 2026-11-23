# Вход игрока

По умолчанию вход не нужен: каждый — **гость** (`g-…`, id в `localStorage` устройства). Гости играют онлайн и видят
друг друга; прогресс хранится на устройстве. Сохранение на сервере, здания, бизнесы, кланы и рейтинги — для вошедших.

Вход устроен так, что у игрового сервера нет ни паролей, ни ключей: токен выдаёт **внешний сервис аккаунтов**, клиент
передаёт его серверу, сервер один раз спрашивает у того же сервиса, чей это токен (вебхук), и кэширует ответ на 10 минут.

```
клиент ──(1) получить токен──▶ сервис аккаунтов           (Telegram initData → токен, или сайт по куке → токен)
клиент ──(2) профиль, rid────▶ сервис аккаунтов           (необязательно: имя для «Паузы», дом)
клиент ──(3) token───────────▶ игровой сервер ──(4) POST {FC_WORLD}/w/me {token} ──▶ сервис аккаунтов → {rid}
```

## Клиент: `config.js`

```js
window.FC_CONFIG = {
  auth: {
    provider: "external",
    label: "Example ID",                                   // в подсказках: «Войди через Example ID»
    api: "https://id.example.org",                         // база для tgSession, profile, me
    tgSession: "/v1/session/telegram",                     // в Telegram: POST {initData} → {token}
    site: "https://example.org",
    siteToken: "/api/token",                               // в браузере: GET с куками (credentials: include) → {token}
    profile: "/v1/profile",                                // необязательно: POST {token} → {name?, level?}
    me: "/w/me",                                           // POST {token} → {rid, house?} — тот же ответ, что видит сервер
    login: "https://example.org/login",                    // кнопка «Войти» в браузере (необязательно)
    tgLogin: "https://t.me/example_bot?start=game"         // кнопка «Войти» внутри Telegram (необязательно)
  }
};
```

Порядок (`client/fnet.js`): внутри Telegram (есть `initData`) и задан `tgSession` — обмен подписи на токен; иначе, если
задан `siteToken`, — запрос к сайту с куками; токена нет, сервис молчит дольше 6 с или `me` не вернул `rid` — гость.
Пути могут быть полными адресами (`https://…`). Имя (`name`) видит только сам игрок.

## Сервер: вебхук

`FC_WORLD=https://id.example.org` → сервер шлёт `POST https://id.example.org/w/me` с телом `{"token": "…"}` и
`User-Agent: FlameCity-GameServer/1.0` (`FC_WORLD_UA`). Ждёт `200 {"rid": "<8–32 hex>"}`; любой другой ответ — токен не
принят. rid — постоянный непрозрачный id игрока (хэш вашего user id, не сам id): по нему хранятся сохранения и здания.

## Что нужно от сервиса аккаунтов, если игра на другом адресе

Если игра (`https://game.example.org`) и сервис (`https://id.example.org`, `https://example.org`) — разные источники:

- **CORS** для источника игры на `tgSession`, `profile`, `me` (POST с `Content-Type: application/json` → браузер шлёт
  preflight `OPTIONS`): `Access-Control-Allow-Origin: https://game.example.org`, `Allow-Methods: POST, OPTIONS`,
  `Allow-Headers: content-type`. Куки здесь не нужны — токен в теле.
- **`siteToken` с куками**: ответ должен нести `Access-Control-Allow-Origin: https://game.example.org` (не `*`) и
  `Access-Control-Allow-Credentials: true`. Кука сессии отправится, только если браузер считает запрос допустимым:
  если игра и сайт на поддоменах одного домена (`game.example.org` и `example.org` — один «сайт»), кука `SameSite=Lax`
  уходит и без `Domain=`; с разными доменами нужна `SameSite=None; Secure`, а Safari и браузеры с блокировкой сторонних
  кук её всё равно не отправят — тогда лучше вход редиректом с передачей токена.
- **Telegram**: подпись `initData` проверяется ключом того бота, который открыл мини-аппу — значит, игру должен открывать
  бот вашего сервиса (кнопка Web App с адресом игры), а не другой.
- **Узкий токен**: выдавайте игре токен, который годится только для `me`/`profile` (и вебхука), а не полный токен
  приложения — код игры открыт, и всё, что он держит в памяти, видят расширения браузера.
