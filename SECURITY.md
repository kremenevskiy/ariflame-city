# Безопасность / Security

## Как сообщить об уязвимости

**Не создавайте публичный issue.** Сообщите приватно через GitHub: вкладка **Security → Report a vulnerability**
(private vulnerability reporting) этого репозитория. Опишите, что затронуто (клиент, игровой сервер, конфигурация
выкладки), как воспроизвести и чем грозит. Мы ответим в течение 7 дней и договоримся о сроках раскрытия.

Особенно интересно: обход проверок сервера (деньги, опыт, время гонок, владение зданиями), подмена личности (вебхук
`FC_WORLD`, токены), XSS через ники/названия/чат клана, отказ в обслуживании сокета, загрузка кадров `/g/photo`.

Чит в одиночной игре (правка `localStorage`, консоль) уязвимостью не считается — сервер не доверяет клиенту.

## Supported versions

Only the latest `main` is supported. Please report privately via **Security → Report a vulnerability** on GitHub;
do not open public issues for security problems.
