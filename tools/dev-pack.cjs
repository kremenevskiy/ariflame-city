#!/usr/bin/env node
/* Пакет кода для ИИ (dist/dev/) — чтобы любой человек со своим ChatGPT/Claude, даже без GitHub, мог изучить игру и
 * сделать правку (задача 24.11; навык — client/dev/skill.md, приём правок — client/contribute.html → server/contrib.py).
 *
 *   dist/dev/llms.txt               устройство игры, правила и прямые ссылки на каждый файл (ИИ читает первым)
 *   dist/dev/src/<путь>             исходники как в репозитории (не сжатые) — ИИ открывает их по ссылкам
 *   dist/dev/flame-city-src.zip     то же одним архивом — для ИИ, который умеет запускать код
 *   dist/dev/flame-city-skill.zip   навык для Claude (flame-city/SKILL.md) — «Настройки → Навыки → загрузить»
 *   dist/dev/openapi.json           действие «отправить правку» для своего GPT (GPTs → Actions)
 *
 * Берутся только файлы из git (закрытые пакеты мест партнёров, настройки выкладки и данные карты Минска не попадают)
 * и только то, что можно менять правкой с сайта, плюс документы. Сервер не публикуется, пока репозиторий закрыт.
 * Запускает tools/build.cjs; отдельно: node tools/dev-pack.cjs [папка dist].
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SITE = "https://city.ariflame.com";

const INCLUDE = [
  /^(AGENTS|CONTRIBUTING|README|ASSETS|TRADEMARKS|CLA)\.md$/, /^LICENSE$/, /^package\.json$/,
  /^docs\/(?!DEPLOY)[^/]+\.md$/,
  /^client\/[^/]+\.(js|html|json)$/, /^client\/data\/[^/]+\.js$/, /^client\/places\/[^/]+\.(json|md)$/,
  /^client\/dev\/skill\.md$/, /^client\/minsk\/index\.html$/,
];
const EXCLUDE = [/^client\/config\.js$/, /^client\/status\.json$/, /^client\/tracks\.json$/];

function files() {
  const all = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 }).trim().split("\n");
  return all.filter((f) => INCLUDE.some((r) => r.test(f)) && !EXCLUDE.some((r) => r.test(f)) && fs.existsSync(path.join(ROOT, f))).sort();
}

// одна строка о модуле — из его шапки: «/* Флейм-Сити — машины: ростер марок-пародий… » → «машины: ростер марок-пародий…»
function about(f) {
  if (!/\.js$/.test(f)) return "";
  const head = fs.readFileSync(path.join(ROOT, f), "utf8").slice(0, 600);
  const m = head.match(/\/\*\s*(?:Флейм-Сити\s*—\s*)?([\s\S]*?)(\*\/|\n\s*\*\s*\n)/);
  if (!m) return "";
  let s = m[1].replace(/\n\s*\*\s?/g, " ").replace(/\s+/g, " ").trim();
  if (s.length > 150) s = s.slice(0, 147).replace(/\s+\S*$/, "") + "…";
  return s;
}

function llms(list) {
  const url = (f) => SITE + "/dev/src/" + f;
  const mods = list.filter((f) => /^client\/f[a-z0-9]+\.js$/.test(f));
  const other = list.filter((f) => /^client\//.test(f) && !mods.includes(f));
  const docs = list.filter((f) => !/^client\//.test(f));
  const lines = [
    "# Флейм-Сити",
    "",
    "> Браузерная 3D-игра в открытом городе: «Минск 1:1» из OpenStreetMap и вымышленный Флейм-Сити. Играют на " + SITE +
      " (телефон и компьютер, без установки). Город строят игроки: правку может сделать любой — со своим ИИ, даже без GitHub.",
    "",
    "Чистый JavaScript без сборщика: модули-IIFE на window.FC, движок three.js r160 (client/vendor, не меняется), порядок " +
      "загрузки — client/index.html. Онлайн-сервер — FastAPI (в этот пакет не входит).",
    "",
    "## Как сделать правку",
    "",
    "- Навык для ИИ (порядок работы и правила): " + SITE + "/dev/skill.md",
    "- Главное правило — «только лучше»: чинить, дорабатывать, добавлять, ускорять. Удалять код и файлы, выключать или " +
      "убирать механики, места и режимы нельзя — такие правки отклоняются автоматически.",
    "- Весь код одним архивом (для ИИ, который запускает код): " + SITE + "/dev/flame-city-src.zip",
    "- Отправить готовую правку (.zip с файлами по путям client/… и docs/… плюс CHANGE.md, или git diff): " + SITE + "/contribute.html",
    "- Менять с сайта можно текстовые файлы в client/ и docs/, кроме client/vendor/, client/minsk/ и client/config.js.",
    "",
    "## Начни с",
    "",
    "- [AGENTS.md](" + url("AGENTS.md") + "): запуск, проверки, куда что добавлять, правила кода и содержания",
    "- [docs/ARCHITECTURE.md](" + url("docs/ARCHITECTURE.md") + "): модули, шина FC.on/emit, системы, деньги, миссии, грабли рендера",
    "- [client/index.html](" + url("client/index.html") + "): какие модули подключены и в каком порядке, стили интерфейса",
    "- [client/places/README.md](" + url("client/places/README.md") + "): места в Минске без кода (client/places/minsk.json)",
    "",
    "## Модули игры (client/)",
    "",
  ];
  for (const f of mods) lines.push("- [" + f + "](" + url(f) + ")" + (about(f) ? ": " + about(f) : ""));
  lines.push("", "## Данные и страницы", "");
  for (const f of other) lines.push("- [" + f + "](" + url(f) + ")" + (about(f) ? ": " + about(f) : ""));
  lines.push("", "## Документы", "");
  for (const f of docs) lines.push("- [" + f + "](" + url(f) + ")");
  lines.push("", "## Optional", "", "- [Статус города](" + SITE + "/status.html): что выкатилось, что проверяется, идеи игроков", "");
  return lines.join("\n");
}

function zip(cwd, out, what) {
  try { fs.rmSync(out, { force: true }); execFileSync("zip", ["-q", "-r", "-X", out].concat(what), { cwd }); return true; }
  catch (e) { console.warn("dev-pack: zip не собран (" + path.basename(out) + "):", e.message.split("\n")[0]); return false; }
}

function pack(dist) {
  const DEV = path.join(dist, "dev"), SRC = path.join(DEV, "src");
  fs.rmSync(SRC, { recursive: true, force: true });
  const list = files();
  let bytes = 0;
  for (const f of list) {
    const to = path.join(SRC, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), to);
    bytes += fs.statSync(to).size;
  }
  fs.writeFileSync(path.join(DEV, "llms.txt"), llms(list));
  zip(SRC, path.join(DEV, "flame-city-src.zip"), ["."]);
  // навык Claude: тот же текст, что skill.md, плюс шапка навыка (имя и когда включать)
  const skill = fs.readFileSync(path.join(ROOT, "client", "dev", "skill.md"), "utf8");
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "fc-skill-"));
  fs.mkdirSync(path.join(tmp, "flame-city"));
  fs.writeFileSync(path.join(tmp, "flame-city", "SKILL.md"), "---\nname: flame-city\ndescription: " +
    "Помогает сделать правку в браузерную игру «Флейм-Сити» (city.ariflame.com, Минск 1:1): изучает код игры, задаёт вопросы, " +
    "делает аккуратную правку по правилам проекта (только улучшения, без удаления механик) и готовит архив для отправки на " +
    "city.ariflame.com/contribute.html. Используй, когда человек хочет что-то добавить, починить или улучшить во Флейм-Сити.\n---\n\n" + skill);
  zip(tmp, path.join(DEV, "flame-city-skill.zip"), ["flame-city"]);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.writeFileSync(path.join(DEV, "openapi.json"), JSON.stringify(openapi(), null, 1));
  console.log("dist/dev/: " + list.length + " файлов кода для ИИ, " + (bytes / 1024).toFixed(0) + " КБ");
}

// действие «отправить правку» для своего GPT: ChatGPT сам отправит архив/дифф после согласия человека
function openapi() {
  return {
    openapi: "3.1.0",
    info: { title: "Флейм-Сити — правки игроков", version: "1.0.0", description: "Отправить правку игры (правило «только лучше»). Статус — " + SITE + "/contribute.html#<id>." },
    servers: [{ url: SITE }],
    paths: {
      "/g/contrib": {
        post: {
          operationId: "sendEdit",
          summary: "Отправить правку игры: git diff или файлы целиком по путям client/… и docs/…",
          "x-openai-isConsequential": true,
          requestBody: { required: true, content: { "application/json": { schema: {
            type: "object", required: ["title", "idea", "agree"],
            properties: {
              title: { type: "string", minLength: 4, maxLength: 90, description: "Коротко: что меняется" },
              idea: { type: "string", minLength: 10, maxLength: 3000, description: "Что и зачем, как проверить в игре" },
              author: { type: "string", maxLength: 40, description: "Ник автора (будет в PR)" },
              contact: { type: "string", maxLength: 80, description: "Telegram или почта — видит только мейнтейнер" },
              tool: { type: "string", maxLength: 60, description: "Каким ИИ сделано" },
              agree: { type: "boolean", description: "Человек согласен с правилами и лицензией вклада (true)" },
              patch: { type: "string", description: "unified git diff (a/client/… b/client/…)" },
              files: { type: "array", maxItems: 40, items: { type: "object", required: ["path", "content"], properties: { path: { type: "string" }, content: { type: "string" } } } },
            },
          } } } },
          responses: { 200: { description: "Принято: {id, status, files}" }, 400: { description: "Что не так — текстом" }, 429: { description: "Часто" } },
        },
      },
      "/g/contrib/{id}": {
        get: {
          operationId: "editStatus", summary: "Статус правки",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "{id, title, status: pending|taken|pr|rejected, pr_url?, reason?}" } },
        },
      },
    },
  };
}

module.exports = { pack, files };
if (require.main === module) pack(path.resolve(process.argv[2] || path.join(ROOT, "dist")));
