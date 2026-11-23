#!/bin/sh
# Разовая настройка репозитория под приём вкладов. Запускает владелец под своим входом: gh auth login, потом
#   sh tools/github/setup.sh [owner/repo]
# Что делает (каждый шаг можно повторять): обсуждения, метки, слияние «сжатием», правило для main (PR, проверки, ревью
# владельца), проверки чужих форков — только после одобрения, лимит открытых PR внешнего автора, приватные отчёты об
# уязвимостях. Чего API не умеет — печатает в конце списком «руками».
set -eu
R=${1:-kremenevskiy/ariflame-city}
say() { printf '\n== %s\n' "$1"; }

say "репозиторий: обсуждения, issues, слияние сжатием, удаление веток после слияния"
gh repo edit "$R" --enable-discussions --enable-issues --enable-squash-merge --enable-merge-commit=false \
  --enable-rebase-merge=false --delete-branch-on-merge --enable-auto-merge=false

say "метки"
lbl() { gh label create "$1" --repo "$R" --color "$2" --description "$3" --force >/dev/null && echo "  $1"; }
lbl "идея" "ffb347" "Идея игрока"
lbl "idea" "ffb347" "Задача по идее"
lbl "в работе" "1b6fc6" "Кто-то делает"
lbl "сделано" "2ea44f" "Вышло в игре"
lbl "место" "0d56a3" "Место в Минске"
lbl "good first issue" "7057ff" "Хорошо для первого PR"
lbl "нужно исправить" "d73a4a" "Сторож содержания нашёл проблему"
lbl "смотрит мейнтейнер" "fbca04" "Нужен взгляд владельца"
lbl "проверено" "2ea44f" "PR нового участника проверен — заголовок можно показывать"
lbl "скрыто" "6a737d" "Не показывать на странице статуса"

say "правило для main: только через PR, зелёные проверки, ревью владельца"
gh api -X POST "repos/$R/rulesets" --input - >/dev/null <<JSON && echo "  готово" || echo "  (уже есть или нет прав — проверь Settings → Rules)"
{
  "name": "main: проверки и ревью",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [ { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" } ],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": { "required_approving_review_count": 1, "dismiss_stale_reviews_on_push": true,
      "require_code_owner_review": true, "require_last_push_approval": true, "required_review_thread_resolution": false } },
    { "type": "required_status_checks", "parameters": { "strict_required_status_checks_policy": false, "required_status_checks": [
      { "context": "Линтер и сборка" }, { "context": "Тесты сервера" }, { "context": "Игра в браузере (оба города и телефон)" },
      { "context": "Сторож содержания" } ] } }
  ]
}
JSON

say "проверки PR из чужих форков — только после одобрения владельца"
gh api -X PUT "repos/$R/actions/permissions/fork-pr-contributor-approval" -f approval_policy=all_external_contributors >/dev/null \
  && echo "  готово" || echo "  (не вышло — Settings → Actions → General → Approval for running fork pull request workflows)"

say "приватные отчёты об уязвимостях"
gh api -X PUT "repos/$R/private-vulnerability-reporting" >/dev/null && echo "  готово" || echo "  (не вышло)"

cat <<'TXT'

== руками (API этого не умеет), Settings репозитория:
  1. Discussions → категории: создать «Ideas» (slug ideas, формат Open-ended + голосование), «Вопросы», «Показать своё».
  2. Settings → General → Pull Requests → лимит открытых PR для внешних авторов: 3.
  3. Установить приложения: CLA Assistant (cla-assistant.io, документ — CLA.md), Claude (claude /install-github-app),
     по желанию CodeRabbit (бесплатно для открытых репо).
  4. Секреты (Settings → Secrets → Actions):
       CLAUDE_CODE_OAUTH_TOKEN — claude setup-token (бот @claude для владельца)
       CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID — превью PR (Pages: проект flame-city-preview)
       TG_BOT_TOKEN, TG_CHAT — сводка дня в Telegram-канал
  5. Сервер: автовыкатка — docs/DEPLOY.md «Автовыкатка» (tools/deploy/pull-live.sh по таймеру).
  6. Открыть репозиторий: Settings → General → Danger Zone → Change visibility → Public.
TXT
