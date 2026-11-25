#!/usr/bin/env node
/* Журнал изменений города (changes.json) — что добавилось, коротко, когда и кем. 25.11.2026, слово владельца: «чтобы
 * после перезагрузки показывало, что поменялось, и на странице правок — что недавно добавилось, описание, когда и кем».
 *
 *   node tools/status/build-changes.cjs dist/changes.json     (это делает npm run build — tools/build.cjs)
 *
 * Источник — история main (только первая линия: слияние — одна запись, а не все коммиты ветки). Заголовок — первая
 * строка коммита, описание — первый абзац тела (≤ 280 знаков). Правка с сайта (contrib-intake) — автор «ник (через
 * сайт)» → who: ник, site: true. PR — из «(#12)» в конце заголовка или «Merge pull request #12». Тексты проходят те же
 * списки слов, что и страница статуса. Читают: client/fupdate.js (плашка «новая правка» и «что нового»),
 * contribute.html и status.html (лента). Пишет только публичное: ник/логин, заголовок, описание, ссылки.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const W = require("../check/words.cjs");

const OUT = process.argv[2] || "changes.json";
const REPO = process.env.GITHUB_REPOSITORY || "kremenevskiy/ariflame-city";
const N = 80;
const TECH = /^(CI|Тесты|Доки|Docs|Сборка|Проверки|Release|Выпуск)\b[:\s]/i;   // служебное — в «что нового» не показываем

function git(args) { try { return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 16 << 20 }); } catch (e) { return ""; } }
const clean = (t) => (W.bad(t) ? "" : t);

function para(body) {
  const lines = String(body || "").split("\n").filter((l) => !/^(Co-Authored-By|Signed-off-by|Reviewed-by):/i.test(l.trim()));
  const first = lines.join("\n").trim().split(/\n\s*\n/)[0] || "";
  const t = first.replace(/\s*\n\s*/g, " ").trim();
  return t.length > 280 ? t.slice(0, 277).replace(/\s+\S*$/, "") + "…" : t;
}

function build() {
  const log = git(["log", "--first-parent", "-n", String(N), "--format=%H%x1f%h%x1f%aI%x1f%an%x1f%s%x1f%b%x1e", "HEAD"]);
  const items = log.split("\x1e").map((r) => r.replace(/^\n/, "")).filter(Boolean).map((r) => {
    const [sha, short, at, author, subject, body] = r.split("\x1f");
    let title = subject || "", pr = null, m;
    if ((m = /^Merge pull request #(\d+) from \S+/.exec(title))) { pr = +m[1]; title = (body || "").split("\n")[0] || title; }
    else if ((m = /\s*\(#(\d+)\)$/.exec(title))) { pr = +m[1]; title = title.slice(0, m.index); }
    const site = / \(через сайт\)$/.exec(author || "");
    const who = site ? author.slice(0, site.index) : author;
    return {
      sha: short, at, who: clean(who) || "игрок", site: !!site, pr, title: clean(title) || "Правка (текст скрыт модерацией)",
      text: clean(para(pr && /^Merge pull request/.test(subject) ? (body || "").split("\n").slice(1).join("\n") : body)),
      tech: TECH.test(title) || undefined,
      url: pr ? `https://github.com/${REPO}/pull/${pr}` : `https://github.com/${REPO}/commit/${sha}`,
    };
  });
  return { v: 1, repo: REPO, head: items.length ? items[0].sha : null, generated: new Date().toISOString(), items };
}

if (require.main === module) {
  const out = build();
  fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log("changes →", OUT, "записей:", out.items.length);
}
module.exports = { build, para };
