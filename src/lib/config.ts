// Общие константы сайта
export const SITE = 'https://erazahan.info';
export const SITE_NAME = 'Երազահան';

// Индексация разрешена только когда явно задана PUBLIC_ALLOW_INDEXING=true
// (выставляется в переменных окружения production-деплоя на erazahan.info).
// По умолчанию (pages.dev, preview-деплои, локальная разработка) индексация запрещена.
export const ALLOW_INDEXING = import.meta.env.PUBLIC_ALLOW_INDEXING === 'true';
