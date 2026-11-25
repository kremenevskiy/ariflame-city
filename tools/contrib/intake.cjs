#!/usr/bin/env node
/* Правки с сайта → pull request (запускает .github/workflows/contrib-intake.yml раз в 15 минут).
 *
 * Человек без GitHub делает правку со своим ИИ и отправляет её на city.ariflame.com/contribute.html → очередь сервера
 * (server/contrib.py). Здесь: забрать новые правки по ключу, каждую наложить на свежий main в ветке contrib/<id>,
 * проверить пути и слова, прогнать сторож содержания (из main — правка не может его ослабить), закоммитить от имени
 * автора-ника, открыть PR и запустить CI на ветке (PR от GITHUB_TOKEN сам CI не запускает — поэтому workflow_dispatch).
 * Не наложилась или сторож против — правка «отклонена» с понятной причиной: человек видит её на странице статуса.
 * Потом — сверка уже открытых PR правок с сайта (GET /contrib/watch): влит → merged, его коммит уже в выпуске live
 * (город обновился) → live, закрыт без слияния → closed с последним комментарием мейнтейнера как причиной. По этим
 * статусам сервер шлёт письма тем, кто оставил почту (server/contribmail.py) — почты здесь нет и не бывает.
 *
 *   CONTRIB_API=https://city.ariflame.com/g CONTRIB_KEY=… GH_TOKEN=… node tools/contrib/intake.cjs
 *   node tools/contrib/intake.cjs --file item.json --dry      проверка на своей машине: наложить и прогнать сторож, без PR
 */
"use strict";
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const API = (process.env.CONTRIB_API || "https://city.ariflame.com/g").replace(/\/$/, "");
const KEY = process.env.CONTRIB_KEY || "";
const SITE = process.env.CONTRIB_SITE || "https://city.ariflame.com";
const DRY = process.argv.includes("--dry");
const FILE = (() => { const i = process.argv.indexOf("--file"); return i > 0 ? process.argv[i + 1] : null; })();
const UA = "FlameCity-Intake/1.0 (+github actions)";
const W = require(path.join(ROOT, "tools", "check", "words.cjs"));

// те же правила путей, что у сервера (server/contrib.py): проверяем ещё раз — очередь могли подложить
const PATH_RE = /^(client|docs)\/[A-Za-z0-9._/-]{1,180}$/;
const EXT_OK = /\.(js|json|html|css|md|txt|svg)$/i;
const DENY = ["client/vendor/", "client/minsk/", "client/config.js"];
function pathOk(p) {
  return typeof p === "string" && PATH_RE.test(p) && !p.split("/").includes("..") && !p.includes("//") && EXT_OK.test(p) &&
    !DENY.some((d) => p === d || p.startsWith(d));
}

// вся работа — в отдельной рабочей копии от свежего main (git worktree): своё дерево и ветки разработчика не трогаем
let WT = ROOT;
function git(args, opt) { return execFileSync("git", args, Object.assign({ cwd: WT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }, opt || {})); }
function tryGit(args, input) { const r = spawnSync("git", args, { cwd: WT, encoding: "utf8", input }); return r.status === 0; }
function gh(args) { return execFileSync("gh", args, { cwd: WT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim(); }

async function api(method, p, body) {
  const r = await fetch(API + p, {
    method, headers: { "X-Contrib-Key": KEY, "Content-Type": "application/json", "User-Agent": UA },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(method + " " + p + " → " + r.status + " " + (await r.text()).slice(0, 200));
  return r.json();
}
const report = (id, status, extra) => DRY || !KEY ? Promise.resolve(console.log("  →", status, JSON.stringify(extra || {}))) :
  api("POST", "/contrib/" + id + "/result", Object.assign({ status }, extra || {}));

// наложить правку: git diff (ИИ часто ошибается в счётчиках строк и пробелах — пробуем мягче) или целые файлы
function apply(item) {
  if (item.patch) {
    const tmp = path.join(os.tmpdir(), "contrib-" + item.id + ".patch");
    fs.writeFileSync(tmp, item.patch.endsWith("\n") ? item.patch : item.patch + "\n");
    const tries = [["--recount"], ["--recount", "--ignore-whitespace"], ["--recount", "--ignore-whitespace", "-C1"], ["--3way"]];
    for (const t of tries) {
      if (tryGit(["apply", "--whitespace=nowarn"].concat(t, [tmp]))) return null;
      tryGit(["reset", "-q", "--hard"]); tryGit(["clean", "-qfd", "client", "docs"]);
    }
    return "правка (git diff) не накладывается на свежую версию игры: попросите ИИ сделать её заново по последним файлам " +
      "(или пришлите целые файлы в .zip — так надёжнее)";
  }
  for (const f of item.files || []) {
    if (!pathOk(f.path)) return "файл " + f.path + " правкой с сайта не меняется";
    const abs = path.join(WT, f.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content);
  }
  return null;
}

function prBody(item, paths, guard) {
  const q = (s) => String(s || "").replace(/</g, "&lt;").replace(/@/g, "@​");   // без @упоминаний и разметки из чужого текста
  const lines = [
    "## Что и зачем / What & why", "", q(item.idea), "",
    item.note ? "<details><summary>Описание от ИИ (CHANGE.md)</summary>\n\n" + q(item.note) + "\n\n</details>\n" : "",
    "## Откуда", "",
    "Правка пришла с сайта без GitHub (" + SITE + "/contribute.html) — автор: **" + q(item.author || "игрок") + "**" +
      (item.tool ? ", сделано с ИИ: **" + q(item.tool) + "**" : "") + ". Номер правки: `" + item.id + "`.", "",
    "Файлы: " + paths.map((p) => "`" + p + "`").join(", "), "",
    "## Для мейнтейнера", "",
    "- [ ] Игра стала **лучше** и ничего не сломалось (правило «только лучше» — AGENTS.md): не медленнее на телефоне, ничего не пропало, баланс и деньги не ломаются",
    "- [ ] Снимки и превью в отчёте CI выглядят как надо (компьютер и телефон)",
    "- [ ] Правила содержания соблюдены (сторож: " + (guard.review.length ? guard.review.length + " на посмотреть" : "чисто") + ")",
    "", "Влить — правка уедет в игру сама, автор увидит это на странице правки (и получит письмо, если оставил почту). " +
      "Закрыть — сначала комментарий с причиной: последний комментарий мейнтейнера автор увидит на странице правки и в письме.",
  ];
  return lines.filter((l) => l !== null).join("\n");
}

// поля из очереди — данные чужого человека: номер — строго формат сервера, в однострочных полях без переводов строк
// (иначе — поддельные «Co-authored-by» в коммите и команды workflow в журнале; аудит 24.11.2026)
const ONE = (v, n) => String(v || "").replace(/[\r\n\u2028\u2029]+/g, " ").replace(/^::/, ": :").slice(0, n);

async function one(item) {
  if (!/^[A-Za-z0-9_-]{12}$/.test(String(item.id))) { console.error("  непонятный номер правки — пропускаю"); return; }
  item.title = ONE(item.title, 90); item.author = ONE(item.author, 40); item.tool = ONE(item.tool, 60);
  console.log("правка", item.id, "—", item.title);
  const text = [item.title, item.idea, item.note, item.author, item.tool].join("\n");
  if (W.bad && W.bad(text)) return report(item.id, "rejected", { reason: "в описании есть запрещённые слова или темы (правила: AGENTS.md «Правила содержания»)" });
  const branch = "contrib/" + item.id;
  git(["checkout", "-q", "-B", branch, "origin/main"]);
  const why = apply(item);
  if (why) return report(item.id, "rejected", { reason: why });
  // всё, что правка оставила в рабочей копии (и неотслеживаемое), — только обычные файлы в client/ и docs/:
  // git apply умеет писать и мимо (заголовок без ---/+++, переименования, ссылки), а лишний .gitattributes ослепил бы сторожа
  const touched = git(["-c", "core.quotePath=false", "status", "--porcelain=v1", "-z", "--untracked-files=all"]).split("\0")
    .filter(Boolean).map((l) => l.slice(3));
  const outside = touched.filter((p) => !pathOk(p) || (() => { try { return !fs.lstatSync(path.join(WT, p)).isFile(); } catch (e) { return false; } })());
  if (outside.length) return report(item.id, "rejected", { reason: "правка трогает то, что с сайта менять нельзя (" + outside.slice(0, 3).join(", ") + ") — только обычные текстовые файлы в client/ и docs/" });
  git(["add", "-A", "client", "docs"]);
  const paths = git(["diff", "--cached", "--name-only"]).trim().split("\n").filter(Boolean);
  if (!paths.length) return report(item.id, "rejected", { reason: "правка ничего не меняет — такие файлы уже как в игре" });
  const bad = paths.filter((p) => !pathOk(p));
  if (bad.length) return report(item.id, "rejected", { reason: "эти файлы правкой с сайта не меняются: " + bad.join(", ") });
  const nick = String(item.author || "Игрок с сайта").replace(/[<>\n]/g, "").slice(0, 40);
  git(["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com",
    "commit", "-q", "--author", nick + " (через сайт) <41898282+github-actions[bot]@users.noreply.github.com>",
    "-m", item.title + "\n\nПравка с сайта без GitHub: " + item.id + (item.tool ? "\nСделано с ИИ: " + item.tool : "")]);
  // «только лучше»: с сайта игру чинят и дорабатывают, а не вычищают — сносы кода, файлов и модулей не принимаются
  const snos = require(path.join(ROOT, "tools", "check", "only-better.cjs")).check("origin/main", WT);
  if (snos.length) return report(item.id, "rejected", { reason: "правка не делает игру лучше, а убирает из неё: " +
    snos.slice(0, 2).map((x) => (x.file !== "-" ? x.file + " — " : "") + x.why.replace(/ ?\(правило «только лучше»\)/, "")).join("; ") +
    ". С сайта принимаются только улучшения: починить, доработать, добавить" });
  // сторож и проверки — из той копии, где запущен этот скрипт (в Actions это main): правка их не трогает, tools/ ей недоступен
  const gj = path.join(os.tmpdir(), "guard-" + item.id + ".json");
  spawnSync(process.execPath, [path.join(ROOT, "tools", "check", "content-guard.cjs"), "origin/main"], { cwd: WT, env: Object.assign({}, process.env, { GUARD_JSON: gj }), stdio: "inherit" });
  let guard = { block: [], review: [] };
  try { guard = JSON.parse(fs.readFileSync(gj, "utf8")); } catch (e) { /* сторож упал — ниже будет блок */ guard.block.push({ file: "-", line: 0, why: "сторож не отработал" }); }
  if (guard.block.length) {
    const why = guard.block.slice(0, 3).map((b) => b.file + ":" + b.line + " — " + b.why).join("; ");
    return report(item.id, "rejected", { reason: "сторож содержания против: " + why });
  }
  if (DRY || !KEY) { console.log("  сухой прогон: наложилось, сторож чист, файлы:", paths.join(", ")); return; }
  await report(item.id, "taken");
  git(["push", "-q", "-f", "origin", branch]);
  const bodyFile = path.join(os.tmpdir(), "pr-" + item.id + ".md");
  fs.writeFileSync(bodyFile, prBody(item, paths, guard));
  const url = gh(["pr", "create", "--base", "main", "--head", branch, "--title", item.title.slice(0, 90), "--body-file", bodyFile]);
  try { gh(["pr", "edit", url, "--add-label", "с сайта"]); } catch (e) { /* метки нет — не страшно */ }
  const num = (url.match(/\/pull\/(\d+)/) || [])[1];
  try { gh(["workflow", "run", "ci.yml", "--ref", branch, "-f", "pr=" + num]); } catch (e) { console.warn("CI не запустился:", e.message); }
  await report(item.id, "pr", { pr_url: url });
  console.log("  PR:", url);
}

// ---- сверка открытых PR: влит → merged, в выпуске live → live, закрыт без слияния → closed ---------------------------
const MAINT = ["OWNER", "MEMBER", "COLLABORATOR"];
const REPO = process.env.GITHUB_REPOSITORY || "";
const ghJson = (args) => JSON.parse(gh(args));

// почему закрыли: последний комментарий мейнтейнера в PR (не бота), одной строкой и коротко — его увидит автор
function closeReason(repo, num) {
  try {
    const cs = ghJson(["api", "repos/" + repo + "/issues/" + num + "/comments?per_page=100"]);
    const m = (Array.isArray(cs) ? cs : []).filter((c) => c && c.user && c.user.type === "User" && MAINT.includes(c.author_association)).pop();
    return m ? String(m.body || "").replace(/<!--[\s\S]*?-->/g, "").replace(/\s+/g, " ").trim().slice(0, 300) : "";
  } catch (e) { return ""; }
}

// коммит слияния уже в том, на что указывает тег выпуска live (его ставит workflow «Выпуск», сервер забирает сам)
function isLive(repo, sha) {
  if (!/^[0-9a-f]{40}$/.test(String(sha || ""))) return false;
  try {
    const st = gh(["api", "repos/" + repo + "/compare/" + sha + "...live", "--jq", ".status"]);
    return st === "ahead" || st === "identical";
  } catch (e) { return false; }     // выпуск как раз пересоздаётся (тега нет) — проверим в следующий раз
}

async function watch() {
  const items = (await api("GET", "/contrib/watch")).items || [];
  console.log("правок с PR на сверке:", items.length);
  for (const it of items) {
    try {
      // поля из очереди — как и у новых правок: номер и ссылку — строго по формату, PR — только из этого репо
      const id = String(it.id || "");
      const m = String(it.pr_url || "").match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)$/);
      if (!/^[A-Za-z0-9_-]{12}$/.test(id) || !m) { console.error("  непонятная запись — пропускаю"); continue; }
      if (REPO && m[1].toLowerCase() !== REPO.toLowerCase()) { console.error("  правка", id, "— PR не из этого репо, пропускаю"); continue; }
      const pr = ghJson(["api", "repos/" + m[1] + "/pulls/" + m[2]]);
      if (pr.merged) {
        // влили и уже выкатили между обходами — сразу live: одно письмо «в городе» вместо двух
        if (isLive(m[1], pr.merge_commit_sha)) { console.log("правка", id, "— в городе"); await report(id, "live"); }
        else if (it.status !== "merged") { console.log("правка", id, "— влита"); await report(id, "merged"); }
      } else if (pr.state === "closed") {
        console.log("правка", id, "— PR закрыт без слияния");
        const why = closeReason(m[1], m[2]);   // нет комментария — без причины: письмо и страница скажут «загляни в PR»
        await report(id, "closed", why ? { reason: why } : {});
      }
    } catch (e) { console.error("  сверка не вышла:", String(e.message).slice(0, 200)); }   // не страшно — через 15 минут снова
  }
}

async function intake(items) {
  tryGit(["fetch", "-q", "origin", "main"]);
  WT = fs.mkdtempSync(path.join(os.tmpdir(), "contrib-wt-"));
  execFileSync("git", ["worktree", "add", "-q", "--detach", WT, "origin/main"], { cwd: ROOT, stdio: "inherit" });
  for (const item of items) {
    try { await one(item); }
    catch (e) {
      console.error("  сбой:", e.message);
      // сбой наш (сеть, git, gh) — правку вернуть в очередь, следующий запуск попробует снова
      try { await report(item.id, "pending"); } catch (e2) { console.error("  и вернуть в очередь не вышло:", e2.message); }
    } finally {
      tryGit(["reset", "-q", "--hard"]); tryGit(["clean", "-qfd", "client", "docs"]);
      tryGit(["checkout", "-q", "--detach", "origin/main"]);
      tryGit(["branch", "-q", "-D", "contrib/" + item.id]);    // ветка уже на GitHub (или правка отклонена) — локальная не нужна
    }
  }
  spawnSync("git", ["worktree", "remove", "--force", WT], { cwd: ROOT });
  WT = ROOT;
}

(async () => {
  let items;
  if (FILE) items = [JSON.parse(fs.readFileSync(FILE, "utf8"))];
  else {
    if (!KEY) { console.log("CONTRIB_KEY не задан — приём правок с сайта выключен"); return; }
    // сначала сверка открытых PR: она не трогает git и не должна зависеть от того, как пройдёт приём новых
    try { await watch(); } catch (e) { console.error("сверка открытых PR не вышла:", String(e.message).slice(0, 200)); }
    items = (await api("GET", "/contrib/pending")).items || [];
  }
  console.log("новых правок:", items.length);
  if (items.length) await intake(items);
})().catch((e) => { console.error(e); process.exit(1); });
