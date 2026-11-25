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
// служебное — в «что нового» не показываем (без \b: в JS он не видит границу после кириллицы)
const TECH = /^(CI|Тесты|Доки|Документы|Docs|Сборка|Проверки|Release|Выпуск)(?=[:\s])/i;

function git(args) { try { return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 16 << 20 }); } catch (e) { return ""; } }
const clean = (t) => (W.bad(t) ? "" : t);

function para(body) {
  // без служебных строк: подписи соавторов и «# Conflicts» из сообщения слияния
  const lines = String(body || "").split("\n").filter((l) => !/^(Co-Authored-By|Signed-off-by|Reviewed-by):/i.test(l.trim()) && !/^\s*#/.test(l));
  const first = lines.join("\n").trim().split(/\n\s*\n/)[0] || "";
  const t = first.replace(/\s*\n\s*/g, " ").trim();
  return t.length > 280 ? t.slice(0, 277).replace(/\s+\S*$/, "") + "…" : t;
}

// слияние ветки без своего текста: описание — из коммитов ветки (самый свежий не служебный), остальные — «Ещё: …»;
// автор — автор ветки (кто делал), а не тот, кто сливал
function branchInfo(p1, p2) {
  const log = git(["log", "--format=%an%x1f%s%x1f%b%x1e", p1 + ".." + p2]);
  const cs = log.split("\x1e").map((r) => r.replace(/^\n/, "")).filter(Boolean).map((r) => { const [an, s, b] = r.split("\x1f"); return { an, s, b }; })
    .filter((c) => !TECH.test(c.s) && !/^Merge /.test(c.s));
  if (!cs.length) return null;
  let text = para(cs[0].b);
  const more = cs.slice(1).map((c) => c.s.replace(/[.:].*$/, "")).filter(Boolean);
  if (more.length) text = (text ? text + " " : "") + "Ещё: " + more.join("; ") + ".";
  return { text: text.length > 280 ? text.slice(0, 277).replace(/\s+\S*$/, "") + "…" : text, author: cs[cs.length - 1].an };
}

function build() {
  const log = git(["log", "--first-parent", "-n", String(N), "--format=%H%x1f%h%x1f%aI%x1f%an%x1f%s%x1f%P%x1f%b%x1e", "HEAD"]);
  const items = log.split("\x1e").map((r) => r.replace(/^\n/, "")).filter(Boolean).map((r) => {
    const [sha, short, at, author0, subject, parents, body0] = r.split("\x1f");
    let author = author0, body = body0;
    const ps = (parents || "").split(" ").filter(Boolean);
    if (ps.length === 2 && !para(body)) { const bi = branchInfo(ps[0], ps[1]); if (bi) { body = bi.text; author = bi.author || author; } }
    let title = (subject || "").replace(/^Слияние:\s*/, ""), pr = null, m;
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
  // тексты для игроков поверх коммитов (changes-notes.json): заголовок и описание по-человечески, служебное — скрыть
  let notes = {};
  try { notes = JSON.parse(fs.readFileSync(path.join(__dirname, "changes-notes.json"), "utf8")).notes || {}; } catch (e) { /* без заметок */ }
  items.forEach((it) => {
    const k = Object.keys(notes).find((n) => it.sha.startsWith(n) || n.startsWith(it.sha));
    if (!k) return;
    const n = notes[k];
    if (n.title) it.title = clean(n.title) || it.title;
    if (n.text != null) it.text = clean(n.text);
    if (n.tech) it.tech = true;
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
