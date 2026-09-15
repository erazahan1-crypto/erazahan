const RAW_SLUG_ERROR = 'search result slug must be a raw URL segment';

export function resultHref(resultPathPrefix, slug) {
  if (!slug || /[\\/\\?#%\u0000-\u001f\u007f\s]/.test(slug)) throw new TypeError(RAW_SLUG_ERROR);
  return `${resultPathPrefix}${slug}/`;
}

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderSearchResult(item, resultPathPrefix) {
  let href;
  try {
    href = resultHref(resultPathPrefix, item.slug);
  } catch (error) {
    if (error instanceof TypeError && error.message === RAW_SLUG_ERROR) return '';
    throw error;
  }
  return `<a href="${href}" class="mb-3 block rounded-xl border border-white/10 bg-white/5 p-4 transition hover:border-violet-400/40 hover:bg-white/10"><div class="font-semibold text-white">${escapeHtml(item.title)}</div>${item.text ? `<div class="mt-1 text-sm text-slate-400">${escapeHtml(item.text)}</div>` : ''}</a>`;
}
