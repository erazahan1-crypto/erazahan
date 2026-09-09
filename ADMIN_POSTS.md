# Редактор основных статей

Раздел `/admin/posts/` показывает 5 800 статей из `src/data/posts.json`. Страница списка получает только компактный индекс, а полный текст загружается отдельно для выбранной статьи. Все URL под `/admin/` и API под `/api/admin/` защищены существующими Cloudflare Access middleware.

Без GitHub-настройки редактор работает в read-only режиме на данных последней сборки. Для сохранения нужно добавить в Cloudflare Pages:

- secret `GITHUB_TOKEN` — fine-grained token с доступом к этому репозиторию и разрешением **Contents: Read and write**;
- variable `ADMIN_GITHUB_REPO=erazahan1-crypto/erazahan`;
- optional variable `ADMIN_GITHUB_BRANCH=main` (по умолчанию `main`).

Токен используется только в Pages Function и не попадает в браузер. API принимает числовой id, никогда не принимает filesystem path, и всегда работает только с жёстко заданным `src/data/posts.json`.

Перед commit API повторно загружает Git blob, проверяет переданный blob SHA, исходный slug и уникальность нового slug. При изменившейся версии возвращается HTTP 409; автоматического слияния или перезаписи нет. Неизвестные поля объекта и `comments` сохраняются без изменений.
