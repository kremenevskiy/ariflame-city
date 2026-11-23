#!/usr/bin/env node
/* Сводка дня для Telegram (workflow «Сводка дня», 21:00 по Минску): что добавилось в город за сутки, сколько проверок,
 * топ идей и кто строил. Берёт status.json (ветка status-data — тексты там уже прошли модерацию build-status.cjs).
 *   STATUS_URL=… [TG_BOT_TOKEN=… TG_CHAT=…] node tools/status/digest.cjs
 * Без TG_* — только печатает сводку. */
const URL_ = process.env.STATUS_URL || "https://raw.githubusercontent.com/kremenevskiy/ariflame-city/status-data/status.json";
const SITE = process.env.SITE || "https://city.ariflame.com";
const esc = (s) => String(s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const plural = (n, a, b, c) => (n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c);

async function main() {
  const r = await fetch(URL_, { cache: "no-store" });
  if (!r.ok) { console.log("status.json недоступен (" + r.status + ") — сводки нет"); return; }
  const S = await r.json(), since = Date.now() - 24 * 3600e3;
  const items = (S.days || []).flatMap((d) => d.items).filter((e) => Date.parse(e.at) > since);
  const changes = items.filter((e) => e.type !== "deploy"), deploys = items.filter((e) => e.type === "deploy").length;
  const ci = (S.runs || []).filter((x) => x.name === "CI" && Date.parse(x.at) > since && x.status === "completed");
  const green = ci.filter((x) => x.conclusion === "success").length;
  const builders = [...new Set(changes.map((e) => e.user && e.user.login).filter(Boolean))];
  if (!changes.length && !ci.length) { console.log("за сутки тихо — сводку не шлём"); return; }
  const lines = ["🏙 <b>Флейм-Сити — что нового за день</b>", ""];
  changes.slice(0, 8).forEach((e) => lines.push((e.type === "merged" ? "🧩 " : "🔧 ") + esc(e.title) + (e.user && e.user.login ? " — " + esc(e.user.login) : "")));
  if (changes.length > 8) lines.push("…и ещё " + (changes.length - 8));
  lines.push("", "✅ Проверок: " + ci.length + " (зелёных " + green + ")" + (deploys ? " · 🚀 выкаток: " + deploys : ""));
  if (builders.length) lines.push("👷 Строили: " + builders.map(esc).join(", "));
  const top = (S.ideas || []).slice(0, 3);
  if (top.length) { lines.push("", "🗳 <b>Город хочет</b>"); top.forEach((i) => lines.push("• " + esc(i.title) + " — " + i.votes + " " + plural(i.votes, "голос", "голоса", "голосов"))); }
  lines.push("", "Статус стройки: " + SITE + "/status.html", "Предложить идею или сделать своё: https://github.com/" + (S.repo || "kremenevskiy/ariflame-city"));
  const text = lines.join("\n");
  console.log(text);
  const tok = process.env.TG_BOT_TOKEN, chat = process.env.TG_CHAT;
  if (!tok || !chat) { console.log("\n(TG_BOT_TOKEN/TG_CHAT не заданы — только журнал)"); return; }
  const s = await fetch("https://api.telegram.org/bot" + tok + "/sendMessage", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } }) });
  if (!s.ok) { console.error("Telegram ответил " + s.status + ": " + (await s.text()).slice(0, 200)); process.exit(1); }
  console.log("\nотправлено");
}
main().catch((e) => { console.error(e); process.exit(1); });
