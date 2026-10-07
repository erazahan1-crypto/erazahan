export class WorkspaceLoadError extends Error {}

const SAFE_CODES = new Set(['INVALID_REQUEST', 'CONTENT_NOT_FOUND', 'SERVICE_UNAVAILABLE', 'REPOSITORY_INTEGRITY', 'UPSTREAM_FAILURE', 'INTERNAL_ERROR']);

export async function readWorkspaceResponse(response) {
  let body;
  try { body = await response.json(); } catch {
    throw new WorkspaceLoadError(`Workspace could not be loaded. HTTP ${response.status}.`);
  }
  if (!response.ok || body?.ok !== true) {
    const code = SAFE_CODES.has(body?.code) ? body.code : null;
    const message = code === 'REPOSITORY_INTEGRITY' ? 'Workspace data is inconsistent.' : 'Workspace could not be loaded.';
    throw new WorkspaceLoadError(`${message} HTTP ${response.status}.${code ? ` Code: ${code}` : ''}`);
  }
  return body;
}
