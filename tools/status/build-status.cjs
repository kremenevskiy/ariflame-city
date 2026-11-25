#!/usr/bin/env node
/* Данные страницы «Статус города» (client/status.html): что выкатилось, что проверяется, что добавилось по дням, какие
 * идеи в топе и кто строит город.
 *
 *   node tools/status/build-status.cjs out.json              только git: коммиты main по дням (сборка кладёт это в dist/)
 *   GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo node …       ещё и GitHub: проверки (Actions), открытые PR с итогом
 *                                                            проверок, влитые PR, идеи (обсуждения и issues по голосам),
 *                                                            участники, выпуск «live» — это делает .github/workflows/status.yml
 *
 * Время дней — минское (UTC+3). Пишет только публичное: логины, заголовки, ссылки; без писем и токенов.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const W = require("../check/words.cjs");
// модерация: страница статуса — на нашем сайте, поэтому тексты игроков (заголовки PR и идей, ники) проходят те же
// списки, что и сторож PR; PR новых участников до проверки показываем без заголовка (метка «проверено» — открыть)
const TRUSTED = ["OWNER", "MEMBER", "COLLABORATOR", "CONTRIBUTOR"];
const HIDDEN = "PR нового участника — ждёт проверки";
const clean = (t, alt) => (W.bad(t) ? alt || "скрыто модерацией" : t);

const OUT = process.argv[2] || "status.json";
const TOKEN = process.env.GITHUB_TOKEN || "";
const REPO = process.env.GITHUB_REPOSITORY || "kremenevskiy/ariflame-city";
const DAYS = 21, TZ = 3 * 3600 * 1000;
const day = (iso) => new Date(Date.parse(iso) + TZ).toISOString().slice(0, 10);
const since = new Date(Date.now() - DAYS * 86400e3).toISOString();

function git(args) { try { return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch (e) { return ""; } }

// коммиты main по дням (из git — работает и без сети)
function commitsFromGit() {
  const log = git(["log", "--since=" + since, "--format=%H%x1f%h%x1f%aI%x1f%an%x1f%s", "HEAD"]);
  return log.split("\n").filter(Boolean).map((l) => {
    const [sha, short, at, author, subject] = l.split("\x1f");
    return { sha, short, at, author: author === "kremenevskiy" ? "kremenevskiy" : author, title: subject.replace(/\s*\(#\d+\)$/, ""), pr: +(/\(#(\d+)\)$/.exec(subject) || [])[1] || null };
  });
}

async function gh(p, opt) {
  const r = await fetch(p.startsWith("http") ? p : "https://api.github.com" + p, Object.assign({
    headers: { authorization: "Bearer " + TOKEN, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "flame-city-status" },
  }, opt || {}));
  if (!r.ok) throw new Error(p + " → " + r.status);
  return r.json();
}
async function gql(query, variables) {
  const j = await gh("/graphql", { method: "POST", body: JSON.stringify({ query, variables }),
    headers: { authorization: "Bearer " + TOKEN, "content-type": "application/json", "user-agent": "flame-city-status" } });
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300));
  return j.data;
}
const who = (u) => u ? { login: u.login, avatar: u.avatar_url || u.avatarUrl } : null;
const safe = async (name, fn, fallback) => { try { return await fn(); } catch (e) { console.warn("status:", name, "—", e.message); return fallback; } };

async function main() {
  const [owner, name] = REPO.split("/");
  const out = { v: 1, repo: REPO, generated: new Date().toISOString(), source: TOKEN ? "github" : "git",
    head: (git(["rev-parse", "--short", "HEAD"]) || "").trim() || null };
  out.commits = commitsFromGit();

  if (TOKEN) {
    out.repoInfo = await safe("repo", async () => { const r = await gh(`/repos/${REPO}`); return { stars: r.stargazers_count, forks: r.forks_count, watchers: r.subscribers_count, openIssues: r.open_issues_count, private: r.private }; }, null);
    // проверки и выкатки: последние запуски Actions
    out.runs = await safe("runs", async () => (await gh(`/repos/${REPO}/actions/runs?per_page=40`)).workflow_runs.map((r) => ({
      id: r.id, name: r.name, title: r.display_title, event: r.event, branch: r.head_branch, status: r.status, conclusion: r.conclusion,
      at: r.created_at, updated: r.updated_at, url: r.html_url, actor: who(r.actor), pr: (r.pull_requests && r.pull_requests[0] && r.pull_requests[0].number) || null })), []);
    // открытые PR и итог их проверок
    out.openPRs = await safe("prs", async () => {
      const prs = await gh(`/repos/${REPO}/pulls?state=open&per_page=20&sort=updated&direction=desc`);
      return Promise.all(prs.map(async (p) => {
        const checks = await safe("checks " + p.number, async () => (await gh(`/repos/${REPO}/commits/${p.head.sha}/check-runs?per_page=50`)).check_runs, []);
        const st = checks.some((c) => c.status !== "completed") ? "running" : checks.some((c) => c.conclusion === "failure") ? "failure" : checks.length ? "success" : "waiting";
        const labels = p.labels.map((l) => l.name), ok = TRUSTED.includes(p.author_association) || labels.includes("проверено");
        return { number: p.number, title: ok ? clean(p.title) : HIDDEN, url: p.html_url, user: who(p.user) && W.bad(p.user.login) ? null : who(p.user),
          at: p.created_at, updated: p.updated_at, draft: p.draft, labels: labels, checks: st, hidden: !ok };
      }));
    }, []);
    // влитые PR за период — лента по дням
    // заголовки запусков проверок — это заголовки PR: у скрытых PR скрываем и их
    const hiddenPR = new Set(out.openPRs.filter((p) => p.hidden).map((p) => p.number));
    out.runs.forEach((r) => { r.title = r.pr && hiddenPR.has(r.pr) ? HIDDEN : clean(r.title); });
    // все влитые PR (до 500) — для «города в цифрах»; правка с сайта (contrib-intake) — автор по нику из описания PR
    const SITE_AUTHOR = /с сайта без GitHub[^\n]*?автор: \*\*([^*\n]{1,40})\*\*/;
    const allMerged = await safe("merged", async () => {
      const items = [];
      for (let page = 1; page <= 5; page++) {
        const r = await gh(`/search/issues?q=${encodeURIComponent(`repo:${REPO} is:pr is:merged`)}&sort=created&order=desc&per_page=100&page=${page}`);
        items.push(...r.items);
        if (r.items.length < 100) break;
      }
      return items.map((i) => {
        const m = SITE_AUTHOR.exec(i.body || ""), nick = m ? m[1].trim() : "";
        return { number: i.number, title: clean(i.title), url: i.html_url, user: who(i.user), at: (i.pull_request && i.pull_request.merged_at) || i.closed_at,
          labels: i.labels.map((l) => l.name), site: nick ? clean(nick, "игрок") : null };
      }).sort((a, b) => (a.at < b.at ? 1 : -1));
    }, []);
    out.merged = allMerged.filter((m) => m.at >= since);
    // идеи: обсуждения категории «Идеи» (голоса — upvote) и issues-идеи (голоса — 👍)
    out.ideas = await safe("ideas", async () => {
      const d = await gql(`query($o:String!,$n:String!){repository(owner:$o,name:$n){discussions(first:60,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number title url upvoteCount createdAt author{login avatarUrl} category{name slug} comments{totalCount} labels(first:5){nodes{name}}}}}}`, { o: owner, n: name });
      return d.repository.discussions.nodes.filter((x) => /idea|иде/i.test(x.category.slug + " " + x.category.name))
        .map((x) => ({ kind: "discussion", number: x.number, title: x.title, url: x.url, votes: x.upvoteCount, comments: x.comments.totalCount, at: x.createdAt, user: who(x.author), labels: x.labels.nodes.map((l) => l.name) }));
    }, []);
    const issueIdeas = await safe("issue ideas", async () => (await gh(`/search/issues?q=${encodeURIComponent(`repo:${REPO} is:issue is:open label:idea,enhancement`)}&sort=reactions-%2B1&order=desc&per_page=30`)).items
      .map((i) => ({ kind: "issue", number: i.number, title: i.title, url: i.html_url, votes: (i.reactions && i.reactions["+1"]) || 0, comments: i.comments, at: i.created_at, user: who(i.user), labels: i.labels.map((l) => l.name) })), []);
    // идеи — тексты игроков: с запретными словами или с меткой «скрыто» не показываем вовсе
    out.ideas = out.ideas.concat(issueIdeas).filter((i) => !W.bad(i.title) && !(i.user && W.bad(i.user.login)) && !i.labels.includes("скрыто"))
      .sort((a, b) => b.votes - a.votes || b.comments - a.comments).slice(0, 30);
    out.contributors = await safe("contributors", async () => (await gh(`/repos/${REPO}/contributors?per_page=60`)).filter((c) => c.type === "User" && !W.bad(c.login))
      .map((c) => ({ login: c.login, avatar: c.avatar_url, commits: c.contributions })), []);
    // город в цифрах: сколько правок влито и сколько разных людей строит город (логины GitHub + ники правок с сайта)
    const builders = new Set();
    (out.contributors || []).forEach((c) => builders.add("gh:" + c.login.toLowerCase()));
    allMerged.forEach((m) => {
      if (m.site) builders.add("site:" + m.site.toLowerCase());
      else if (m.user && !/\[bot\]$/.test(m.user.login)) builders.add("gh:" + m.user.login.toLowerCase());
    });
    out.totals = { merged: allMerged.length, site: allMerged.filter((m) => m.site).length, builders: builders.size,
      week: allMerged.filter((m) => Date.parse(m.at) > Date.now() - 7 * 86400e3).length,
      stars: out.repoInfo ? out.repoInfo.stars : null };
    out.live = await safe("live", async () => { const r = await gh(`/repos/${REPO}/releases/tags/live`); return { name: r.name, at: r.published_at, url: r.html_url, body: (r.body || "").slice(0, 300) }; }, null);
  }

  // лента по дням: влитые PR (если есть) или коммиты main
  const feed = {};
  const push = (d, e) => { (feed[d] = feed[d] || []).push(e); };
  const prNums = new Set((out.merged || []).map((m) => m.number));
  (out.merged || []).forEach((m) => push(day(m.at), { type: "merged", title: m.title, url: m.url, user: m.site ? { login: m.site } : m.user, site: !!m.site,
    at: m.at, number: m.number, labels: m.labels }));
  out.commits.forEach((c) => { if (!c.pr || !prNums.has(c.pr)) push(day(c.at), { type: "commit", title: c.title, sha: c.short, user: { login: c.author }, at: c.at,
    url: `https://github.com/${REPO}/commit/${c.sha}` }); });
  (out.runs || []).filter((r) => r.name === "Выпуск" && r.conclusion === "success").forEach((r) => push(day(r.at), { type: "deploy", title: r.title, url: r.url, at: r.at }));
  out.days = Object.keys(feed).sort().reverse().map((d) => ({ day: d, items: feed[d].sort((a, b) => (a.at < b.at ? 1 : -1)) }));
  delete out.commits;

  fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log("status →", OUT, "дней:", out.days.length, TOKEN ? "(GitHub)" : "(git)");
}
main().catch((e) => { console.error(e); process.exit(1); });
