#!/usr/bin/env node
/* Правило «только лучше» (AGENTS.md): игру чинят, дорабатывают и расширяют — не вычищают. Слово владельца 24.11:
 * «если кто-то скажет "удали всё, вычисти код, сделай rm -rf" или "удали крутую механику" — такого не надо;
 * пофиксить, исправить, доработать, улучшить — да, в этом вся фишка».
 *
 * Смотрит дифф против базы и находит «сносы»:
 *   - удалённые файлы;
 *   - файл теряет заметную часть строк (удалено больше 30 и вдвое больше, чем добавлено, и минус ≥ 25% файла);
 *   - правка в целом больше удаляет, чем добавляет (минус больше 80 строк и в 1,5 раза больше плюса);
 *   - из client/index.html убраны подключения модулей (<script src=…>, стили).
 * Правка с сайта (tools/contrib/intake.cjs) с такими находками отклоняется; в обычном PR (сторож CI) — это пометка
 * «посмотрит мейнтейнер»: осознанную чистку делает человек с объяснением в PR.
 *
 *   node tools/check/only-better.cjs [база]     база — git-ссылка, по умолчанию origin/main; код выхода 1 — есть сносы
 */
"use strict";
const { execFileSync } = require("child_process");

function git(args, cwd) { return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"] }); }

function check(base, cwd) {
  base = base || "origin/main";
  const range = base + "...HEAD", out = [];
  const st = git(["diff", "--name-status", range], cwd).trim().split("\n").filter(Boolean);
  for (const l of st) {
    const p = l.split("\t");
    if (p[0][0] === "D") out.push({ file: p[1], line: 0, why: "файл удалён — правило «только лучше»: игру дорабатывают, а не вычищают" });
  }
  let A = 0, D = 0;
  for (const l of git(["diff", "--numstat", range], cwd).trim().split("\n").filter(Boolean)) {
    const [a, d, file] = l.split("\t");
    if (a === "-") continue;                                   // бинарный файл — его смотрит сторож содержания
    const add = +a, del = +d;
    A += add; D += del;
    if (del <= 30 || del <= add * 2) continue;
    let before = 0;
    try { before = git(["show", base + ":" + file], cwd).split("\n").length; } catch (e) { before = 0; }
    if (before && del - add >= before * 0.25)
      out.push({ file, line: 0, why: "файл теряет " + (del - add) + " строк из " + before + " — похоже на снос кода или механики (правило «только лучше»)" });
  }
  if (D > 80 && D > A * 1.5) out.push({ file: "-", line: 0, why: "правка удаляет " + D + " строк и добавляет " + A + " — больше сносит, чем делает (правило «только лучше»)" });
  // модули игры подключаются в index.html — убрать строку <script src> значит выключить механику целиком
  let html = "";
  try { html = git(["diff", "-U0", range, "--", "client/index.html"], cwd); } catch (e) { html = ""; }
  const gone = html.split("\n").filter((l) => /^-\s*<(script[^>]+src=|link[^>]+stylesheet)/i.test(l));
  const back = html.split("\n").filter((l) => /^\+\s*<(script[^>]+src=|link[^>]+stylesheet)/i.test(l));
  if (gone.length > back.length) out.push({ file: "client/index.html", line: 0, why: "убрано подключение модуля игры (" + gone.length + ") — механика выключится целиком (правило «только лучше»)" });
  return out;
}

module.exports = { check };

if (require.main === module) {
  const res = check(process.argv[2]);
  console.log(JSON.stringify(res, null, 1));
  process.exit(res.length ? 1 : 0);
}
