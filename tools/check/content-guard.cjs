#!/usr/bin/env node
/* Сторож содержания pull request: смотрит только то, что PR добавляет (дифф против базы), и делит находки на две кучи:
 *   block  — PR не вливается, пока не исправят (политика, оскорбления, чужие адреса в клиенте, опасный код, тяжёлые
 *            файлы, рост файла за 1500 строк);
 *   review — можно, но мейнтейнер смотрит глазами (зависимости, CI, сгенерированные данные, ассеты без ASSETS.md,
 *            грубые слова, подозрительные приёмы в коде).
 *
 *   node tools/check/content-guard.cjs [база]      база — git-ссылка, по умолчанию origin/main
 *   node tools/check/content-guard.cjs --all       весь репозиторий (сверка списков: на текущем коде — ноль блоков)
 *   GUARD_JSON=out.json …                          ещё и итог в JSON (для меток и комментария в PR)
 *
 * В CI запускается версия этого файла из базовой ветки, а не из PR (PR не может ослабить сторожа под себя).
 * Списки слов — tools/check/words.cjs («слово$» — только целое слово). Они закодированы base64: в поиске по репозиторию игры не всплывают имена и лозунги — это список запретов,
 * а не содержание игры. Добавить слово: node -e 'console.log(Buffer.from(JSON.stringify([...]),"utf8").toString("base64"))'.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");

const BASE = process.argv[2] || process.env.GUARD_BASE || "origin/main";
const W = require("./words.cjs");                     // списки запретных слов — общие со страницей статуса

// Адреса, на которые клиенту можно ссылаться (всё остальное в client/ — чужой хост: блок).
const HOSTS_OK = ["localhost", "127.0.0.1", "t.me", "telegram.org", "raw.githubusercontent.com", "api.github.com", "avatars.githubusercontent.com", "openstreetmap.org", "www.openstreetmap.org", "osm.org",
  "github.com", "ariflame.com", "city.ariflame.com", "example.org", "game.example.org", "id.example.org", "www.w3.org", "host"];
const MAX_LINES = 1500, MAX_BIN = 2 * 1024 * 1024;
const ASSET_EXT = /\.(png|jpe?g|webp|gif|glb|gltf|bin|ogg|mp3|wav|m4a|ttf|otf|woff2?)$/i;
const BIN_EXT = /\.(png|jpe?g|webp|gif|glb|bin|ogg|mp3|wav|m4a|ttf|otf|woff2?|zip|mp4|webm)$/i;
const SELF = ["tools/check/content-guard.cjs", "tools/check/words.cjs", "tools/check/only-better.cjs"];
const GENERATED = [/^client\/minsk\/s_[-\d]+_[-\d]+\.json$/, /^client\/minsk\/(map|addr)\.json$/, /^client\/vendor\//, /^client\/tracks\.json$/];

function git(args) { return execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }); }
const ALL = BASE === "--all", EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const range = ALL ? [EMPTY_TREE] : [BASE + "...HEAD"];   // --all — рабочее дерево целиком
const changed = git(["diff", "--name-status", "--diff-filter=AMR"].concat(range)).trim().split("\n").filter(Boolean)
  .map((l) => { const p = l.split("\t"); return { st: p[0][0], file: p[p.length - 1] }; });
// --text и без внешних diff/textconv: .gitattributes из PR («* -diff») не прячет строки от сторожа (аудит 24.11.2026)
const diff = git(["-c", "core.quotePath=false", "diff", "-U0", "--no-color", "--text", "--no-ext-diff", "--no-textconv"].concat(range));
const summary = git(["diff", "--summary"].concat(range));

const block = [], review = [];
const add = (list, file, line, why) => list.push({ file, line, why });

// добавленные строки по файлам. Строки ханка считаем по его заголовку (@@ … +c,d @@): добавленная строка кода «++ i;»
// в диффе выглядит как «+++ i;» — раньше её принимали за заголовок нового файла, и всё ниже уходило мимо проверок
// (аудит 24.11.2026). Заголовки «diff --git» / «+++» читаем только между ханками.
const added = {};
let cur = null, ln = 0, left = 0;
diff.split("\n").forEach((l) => {
  if (left > 0) {
    if (l.startsWith("+")) { if (cur) added[cur].push([ln, l.slice(1)]); ln++; left--; return; }
    if (l.startsWith(" ")) { ln++; left--; return; }
    if (l.startsWith("-") || l.startsWith("\\")) return;
    left = 0;
  }
  const g = /^diff --git a\/.* b\/(.*)$/.exec(l); if (g) { cur = g[1]; added[cur] = added[cur] || []; return; }
  if (l.startsWith("+++ ")) { const f = l.slice(4); if (f !== "/dev/null") { cur = f.replace(/^b\//, ""); added[cur] = added[cur] || []; } return; }
  const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(l); if (h) { ln = +h[1]; left = h[2] == null ? 1 : +h[2]; }
});
// символические ссылки: сборка и превью PR пошли бы по ссылке на чужой файл (/proc/self/environ и т. п.)
summary.split("\n").forEach((l) => { const m = /^\s*create mode 120000 (.+)$/.exec(l) || /^\s*mode change \d+ => 120000 (.+)$/.exec(l); if (m) add(block, m[1], 0, "символическая ссылка — в репозитории только обычные файлы"); });

const norm = W.norm, POL = W.POL, SL = W.SL, RU = W.RU;
const isGen = (f) => GENERATED.some((r) => r.test(f));

Object.keys(added).forEach((file) => {
  if (SELF.includes(file) || file === "/dev/null" || BIN_EXT.test(file) || ASSET_EXT.test(file)) return;   // картинки и модели — не текст (их размер — ниже)
  const gen = isGen(file), lines = added[file];
  if (gen) { if (lines.length && !ALL) add(review, file, 0, "сгенерированные данные изменены — пересобраны тулом или руками?"); return; }
  const client = file.startsWith("client/") && /\.(js|html|json|css)$/.test(file);
  lines.forEach(([n, text]) => {
    const t = norm(text);
    // строка-фильтр (списки запретных слов в коде модерации) помечена «guard:allow» — не блок, а на глаза мейнтейнеру
    const hard = /guard:allow/.test(text) ? review : block;
    if (POL.some((r) => r.test(t))) add(hard, file, n, "политика (флаги, символы, лозунги, имена) — в игре её нет ни с какой стороны");
    if (SL.some((r) => r.test(t))) add(hard, file, n, "оскорбление");
    if (RU.some((r) => r.test(t))) add(review, file, n, "грубое слово");
    if (client) {
      // адреса: http(s), ws(s) и «//хост.зона» в строке; «*.host» не пропускаем — только точные имена и их поддомены
      ((text.match(/(?:https?|wss?):\/\/[a-z0-9.-]+/gi) || []).concat((text.match(/["'`]\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi) || [])))
        .forEach((u) => {
          const host = u.replace(/^(?:["'`]|(?:https?|wss?):)\/\//i, "").toLowerCase();
          if (!HOSTS_OK.some((h) => host === h || (h.includes(".") && host.endsWith("." + h)))) add(block, file, n, "чужой адрес в клиенте: " + host);
        });
      if (/\beval\s*\(|\bFunction\s*\(|importScripts\s*\(|constructor\s*\.\s*constructor|constructor\s*\[\s*["'`]constructor/.test(text)) add(block, file, n, "eval / Function / importScripts");
      if (/document\.cookie|coinhive|cryptonight|webminer|\bminer\b/i.test(text)) add(block, file, n, "cookie или майнер");
      if (/navigator\.sendBeacon/.test(text)) add(review, file, n, "sendBeacon — куда и что отправляется?");
      if (/atob\s*\(\s*["'][A-Za-z0-9+/=]{80,}/.test(text) || /\\x[0-9a-f]{2}(\\x[0-9a-f]{2}){20,}/i.test(text)) add(block, file, n, "закодированная строка — похоже на спрятанный код");
      if (/<script[^>]+src=["']https?:/i.test(text)) add(review, file, n, "внешний скрипт (хост — в списке разрешённых?)");
      if (/localStorage\.(getItem|key)\s*\(/.test(text) && /fetch|XMLHttpRequest|WebSocket/.test(text)) add(review, file, n, "чтение localStorage рядом с сетью");
    }
  });
});

changed.forEach(({ file }) => {
  if (!fs.existsSync(file)) return;
  const size = fs.statSync(file).size;
  if (BIN_EXT.test(file) && size > MAX_BIN) add(block, file, 0, "файл " + (size / 1048576).toFixed(1) + " МБ — больше 2 МБ (сожмите: WebP, meshopt GLB)");
  if (/^client\/[^/]+\.js$/.test(file)) {
    const n = fs.readFileSync(file, "utf8").split("\n").length;
    let before = 0;
    if (!ALL) try { before = execFileSync("git", ["show", BASE + ":" + file], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 }).split("\n").length; } catch (e) { before = 0; }
    if (!ALL && n > MAX_LINES && n > before) add(block, file, 0, "файл " + n + " строк (> " + MAX_LINES + ") и растёт — вынесите часть в новый модуль");
  }
  if (/^package(-lock)?\.json$|requirements[^/]*\.txt$|^client\/vendor\//.test(file)) add(review, file, 0, "зависимости или движок — только с согласия мейнтейнера");
  if (/^\.github\//.test(file) || /^tools\/check\//.test(file)) add(review, file, 0, "CI или проверки — смотрит мейнтейнер");
});
const assets = changed.filter((c) => c.st === "A" && ASSET_EXT.test(c.file) && !isGen(c.file));
if (assets.length && !changed.some((c) => c.file === "ASSETS.md")) assets.forEach((a) => add(review, a.file, 0, "новый ассет без строки в ASSETS.md (источник и лицензия)"));

// правило «только лучше» (only-better.cjs): сносы кода и механик — мейнтейнер смотрит глазами (правка с сайта такие не пропускает)
if (!ALL) try { require("./only-better.cjs").check(BASE).forEach((x) => add(review, x.file, x.line, x.why)); } catch (e) { /* нет файла рядом — старая база */ }
const fmt = (x) => "- `" + x.file + (x.line ? ":" + x.line : "") + "` — " + x.why;
const out = ["## Сторож содержания", "",
  block.length ? "**Нужно исправить (" + block.length + "):**" : "Блокирующих находок нет.", ...block.slice(0, 60).map(fmt), "",
  review.length ? "**Посмотрит мейнтейнер (" + review.length + "):**" : "", ...review.slice(0, 60).map(fmt), "",
  "Правила — AGENTS.md «Правила содержания». Ошибся сторож — напишите в PR, мейнтейнер поправит список."].join("\n");
console.log(out);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, out + "\n");
if (process.env.GUARD_JSON) fs.writeFileSync(process.env.GUARD_JSON, JSON.stringify({ block, review }, null, 1));
process.exit(block.length ? 1 : 0);
