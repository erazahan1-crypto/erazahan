const ERROR_CODE_RE = /^[A-Z][A-Z0-9_]{0,79}$/;
const ACTIONABLE_MESSAGE_CODES = new Set(['DRAFT_INVALID', 'PUBLISH_INVALID']);

function safeErrorCode(value) {
  return typeof value === 'string' && ERROR_CODE_RE.test(value) ? value : null;
}

function safeActionableMessage(code, value) {
  if (!code || !ACTIONABLE_MESSAGE_CODES.has(code) || typeof value !== 'string') return null;
  const message = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return message ? message.slice(0, 500) : null;
}

// This helper deliberately makes one request exactly once. It never retries a
// mutation because a transport failure can leave the server-side outcome unknown.
export async function requestTranslationWrite(request) {
  let response;
  try {
    response = await request();
  } catch {
    return { kind: 'network_error' };
  }

  const status = response.status;
  let body;
  try {
    const text = await response.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    return { kind: 'non_json', status };
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) return { kind: 'invalid_json', status };
  if (response.ok && body.ok === true) return { kind: 'success', body };

  return {
    kind: 'server_rejection',
    status,
    code: safeErrorCode(body.code),
    message: safeActionableMessage(safeErrorCode(body.code), body.message),
  };
}

export function formatTranslationWriteFailure(outcome, fallbackMessage) {
  if (outcome.kind === 'network_error') return 'Network error — the translation server could not be reached. Your unsaved text remains in this browser.';
  if (outcome.kind === 'non_json') return `HTTP ${outcome.status} — the server returned a non-JSON response. Your unsaved text remains in this browser.`;
  if (outcome.kind === 'invalid_json') return `HTTP ${outcome.status} — the server returned an invalid JSON response. Your unsaved text remains in this browser.`;
  const label = outcome.code ?? 'The server rejected the translation write.';
  const detail = outcome.message ?? fallbackMessage;
  const punctuation = detail && /[.!?]$/.test(detail) ? '' : '.';
  return `HTTP ${outcome.status} — ${label}${detail ? `: ${detail}` : ''}${punctuation} Your unsaved text remains in this browser.`;
}

export function ambiguousTranslationWriteMessage(action) {
  const messages = {
    save_draft: 'Draft status is uncertain. Reload to reconcile the latest server state before saving again.',
    publish: 'Publication status is uncertain. Reload to reconcile the latest server state before trying again.',
    discard: 'Discard status is uncertain. Reload to reconcile the latest server state before editing again.',
    rebase: 'Review status is uncertain. Reload to reconcile the latest server state before editing again.',
    begin_edit: 'Editing status is uncertain. Reload to reconcile the latest server state before making changes.',
  };
  return messages[action];
}
