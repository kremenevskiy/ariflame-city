# Лицензии данных и ассетов / Third-party data & asset licenses

Код проекта и собственные ассеты — **FSL-1.1-MIT** ([LICENSE](LICENSE): пользоваться, менять и присылать правки можно; выпускать конкурирующий коммерческий продукт — нет; каждая версия через 2 года становится MIT). Название, логотип и бренд — не лицензируются ([TRADEMARKS.md](TRADEMARKS.md)). Ниже — всё, что под другими условиями или требует
указания авторов. В игре эти подписи показаны на заставке «Минска 1:1», в карте, на снимках фоторежима и в «Настройки →
Авторы»; при доработках их нельзя убирать.

| что | где | лицензия | правообладатель / источник |
|---|---|---|---|
| Данные Минска: дома, улицы, адреса, деревья, переходы, фонари, остановки, ориентиры | `client/minsk/*`, `client/tex/minsk-landmarks.json` | **ODbL 1.0 — не лицензия проекта** | © участники OpenStreetMap, https://www.openstreetmap.org/copyright |
| Люди: модели, текстуры, анимации Rocketbox | `client/people/*` | MIT | Copyright (c) 2020 Microsoft — Microsoft Rocketbox Avatar Library, https://github.com/microsoft/Microsoft-Rocketbox |
| Анимации Quaternius Universal Animation Library (Standard) | `client/people/anims_*.glb` (часть клипов) | CC0 1.0 | Quaternius, https://quaternius.com |
| Движок three.js r160 (урезанная сборка) | `client/vendor/three-r160.js` | MIT | Copyright © 2010–2024 three.js authors, https://github.com/mrdoob/three.js; текст лицензии — `client/vendor/LICENSE-three.txt` |
| Машины (параметрические модели) | `client/cars/*` | FSL-1.1-MIT (свои) | авторы проекта, генератор `tools/lib/fc-cargen.cjs` |
| Атлас фасадов | `client/tex/facades.webp` | FSL-1.1-MIT (свой) | сгенерирован моделью изображений по текстовым описаниям, права — у авторов проекта (`client/tex/CREDITS.md`) |
| Логотип-огонёк; значок «Ф» (вкладка, телефон) | `client/brand/mascot.*`, `client/brand/icon-*`, `favicon-32.png`, `apple-touch-icon.png`, `client/favicon.ico` | **не лицензируются** — знак проекта ([TRADEMARKS.md](TRADEMARKS.md)) | авторы проекта |
| Портрет Макса (рассказчик) | `client/brand/max.webp` | FSL-1.1-MIT — кадр из игры с моделью Microsoft Rocketbox (MIT, © 2020 Microsoft) | авторы проекта |
| Картинки экрана загрузки (12 сцен × 2 ориентации: 3 Флейм-Сити, 9 Минска) | `client/loader/*.webp` | FSL-1.1-MIT (свои) | сгенерированы моделью изображений (Nano Banana Pro через kie.ai, 22.11.2026) по текстовым описаниям; узнаваемые здания Минска — общественные архитектурные объекты, без логотипов и госсимволики |
| Карточки районов Минска для «Где начнёшь?» | `client/places/minsk/*.webp` | FSL-1.1-MIT (свои) | сгенерированы моделью изображений (Nano Banana Pro через kie.ai, 22.11.2026) по текстовым описаниям; общественные архитектурные объекты, без логотипов |
| Скриншоты игры | `docs/img/*.png` | FSL-1.1-MIT (свои); кадры Минска — произведённые работы по данным OSM | © участники OpenStreetMap (данные карты), https://www.openstreetmap.org/copyright |
| Шрифт Oswald (400, 600; кириллица и латиница) | `client/fonts/*` | **SIL OFL 1.1 — не лицензия проекта** | © The Oswald Project Authors, https://github.com/googlefonts/OswaldFont; текст лицензии — `client/fonts/OFL-Oswald.txt` |
| Telegram Mini App SDK | грузится с telegram.org только внутри Telegram | условия Telegram | в репозитории не хранится |

## OpenStreetMap и ODbL — важно

Данные `client/minsk/` и `client/tex/minsk-landmarks.json` — **производная база данных** OpenStreetMap. Они
распространяются по **Open Database License 1.0** (https://opendatacommons.org/licenses/odbl/1-0/), а не по лицензии проекта:

- подпись «© участники OpenStreetMap» (или «© OpenStreetMap contributors») обязательна там, где показываются данные;
- изменённую базу (например, пересобранную `tools/minsk-osm.py` с другими правилами) нужно публиковать под ODbL 1.0 и
  отдавать по запросу — в машиночитаемом виде (этот репозиторий годится);
- «произведённая работа» (картинка, скриншот, видео игры) может иметь любую лицензию, но с той же подписью OSM.

Конвертер `tools/minsk-osm.py` — код проекта (FSL-1.1-MIT). Исходный срез `.osm.pbf` в репозиторий не входит.

## Microsoft Rocketbox — текст лицензии

Полный текст MIT с копирайтом Microsoft и список изменений — `client/people/CREDITS.md` (его нужно сохранять вместе с
файлами моделей).

## Чего в репозитории нет

Музыки (радио играет процедурный синтез; свои треки подключаются через `config.js`), настоящих марок, логотипов, эмблем,
госсимволики и фото третьих лиц.

---

**English summary.** Code and own assets are FSL-1.1-MIT (use, modify and contribute freely; no competing commercial product; each version becomes MIT after two years). Minsk map data (`client/minsk/`, `client/tex/minsk-landmarks.json`)
is derived from OpenStreetMap and licensed under **ODbL 1.0, not the project license** — keep the "© OpenStreetMap contributors"
attribution and share derived databases under ODbL. Character models and animations: Microsoft Rocketbox (MIT,
© 2020 Microsoft) and Quaternius UAL (CC0). three.js (MIT). Cars, facade atlas and loading art are the project's own (FSL-1.1-MIT); the name, logo and brand are not licensed (TRADEMARKS.md).
