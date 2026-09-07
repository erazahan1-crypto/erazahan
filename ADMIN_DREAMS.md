# Защита админки с Cloudflare Access

Маршруты `/admin/*` и `/api/admin/*` закрыты серверной проверкой Cloudflare Access JWT. Пока обязательные переменные не заданы, middleware отвечает `503`, поэтому случайно опубликовать открытую админку нельзя.

## Настройка Cloudflare

1. В Cloudflare Zero Trust откройте **Access → Applications → Add an application → Self-hosted**.
2. Добавьте два application path для production-домена:
   - `erazahan.info/admin/*`
   - `erazahan.info/api/admin/*`
3. Если используется прямой `*.pages.dev` домен, создайте такие же защищённые пути для него или полностью запретите прямой доступ к нему.
4. Создайте policy типа **Allow**, разрешив вход только email владельца. Не используйте широкое правило `Everyone`.
5. В настройках приложения скопируйте **Application Audience (AUD) Tag**.
6. В **Workers & Pages → erazahan → Settings → Variables and Secrets** добавьте:
   - `CF_ACCESS_TEAM_DOMAIN` — домен команды, например `example.cloudflareaccess.com`;
   - `CF_ACCESS_AUD` — Audience Tag. Несколько тегов можно указать через запятую;
   - `ADMIN_EMAILS` — разрешённый email владельца. Несколько адресов можно указать через запятую.
7. Примените миграцию `0003_add_dream_answers.sql` к production D1 до открытия админки.
8. После deploy проверьте в приватном окне, что оба пути требуют Cloudflare Access, а запрос без Access JWT получает отказ.

JWT проверяется повторно внутри Pages Functions: подпись RS256, issuer, audience, срок действия и email владельца. Клиентского пароля и секретов в репозитории нет.
