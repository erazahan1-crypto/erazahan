export interface GitHubPostsEnv {
  GITHUB_TOKEN?: string;
  ADMIN_GITHUB_REPO?: string;
  ADMIN_GITHUB_BRANCH?: string;
}

export interface EditablePost {
  slug: string;
  title: string;
  date: string;
  letter: string | null;
  categories: string[];
  content: string;
  sourceUrl: string;
}

interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

interface GitObject { sha: string }
interface GitRef { object: GitObject }
interface GitCommit { tree: GitObject }
interface TreeEntry { path: string; type: 'blob' | 'tree'; sha: string }
interface GitTree { tree: TreeEntry[] }
interface GitBlob { sha: string; content: string; encoding: string }

export class PostsConfigError extends Error {}
export class PostsConflictError extends Error {}
export class PostsValidationError extends Error {}

const POSTS_PATH = 'src/data/posts.json';

export function getGitHubConfig(env: GitHubPostsEnv): GitHubConfig {
  const token = env.GITHUB_TOKEN?.trim();
  const repoSpec = env.ADMIN_GITHUB_REPO?.trim();
  const branch = env.ADMIN_GITHUB_BRANCH?.trim() || 'main';
  const match = repoSpec?.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!token || !match) {
    throw new PostsConfigError('Сохранение не настроено: нужны GITHUB_TOKEN и ADMIN_GITHUB_REPO.');
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes('..')) {
    throw new PostsConfigError('ADMIN_GITHUB_BRANCH содержит недопустимое значение.');
  }
  return { token, owner: match[1], repo: match[2], branch };
}

export async function loadPostsSnapshot(config: GitHubConfig) {
  const ref = await github<GitRef>(config, `/git/ref/heads/${encodeURIComponent(config.branch)}`);
  const commit = await github<GitCommit>(config, `/git/commits/${ref.object.sha}`);
  const blobSha = await findBlob(config, commit.tree.sha, POSTS_PATH);
  const blob = await github<GitBlob>(config, `/git/blobs/${blobSha}`);
  if (blob.encoding !== 'base64') throw new Error('GitHub вернул неподдерживаемую кодировку файла.');
  const source = decodeBase64(blob.content.replace(/\s/g, ''));
  const posts = JSON.parse(source) as unknown;
  if (!Array.isArray(posts)) throw new Error('src/data/posts.json не содержит массив.');
  return { posts: posts as Array<Record<string, unknown>>, blobSha, commitSha: ref.object.sha, treeSha: commit.tree.sha };
}

export async function commitPosts(
  config: GitHubConfig,
  snapshot: Awaited<ReturnType<typeof loadPostsSnapshot>>,
  posts: Array<Record<string, unknown>>,
) {
  const blob = await github<GitObject>(config, '/git/blobs', {
    method: 'POST',
    body: JSON.stringify({ content: JSON.stringify(posts), encoding: 'utf-8' }),
  });
  const tree = await github<GitObject>(config, '/git/trees', {
    method: 'POST',
    body: JSON.stringify({
      base_tree: snapshot.treeSha,
      tree: [{ path: POSTS_PATH, mode: '100644', type: 'blob', sha: blob.sha }],
    }),
  });
  const commit = await github<GitObject>(config, '/git/commits', {
    method: 'POST',
    body: JSON.stringify({
      message: 'Admin: update dream dictionary article',
      tree: tree.sha,
      parents: [snapshot.commitSha],
    }),
  });

  try {
    await github<GitRef>(config, `/git/refs/heads/${encodeURIComponent(config.branch)}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });
  } catch (error) {
    if (error instanceof GitHubError && (error.status === 409 || error.status === 422)) {
      throw new PostsConflictError('Ветка изменилась во время сохранения. Перезагрузите статью.');
    }
    throw error;
  }
  return { commitSha: commit.sha, blobSha: blob.sha };
}

export function parsePostId(value: string | string[] | undefined): number {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id || !/^(0|[1-9]\d{0,5})$/.test(id)) throw new PostsValidationError('Некорректный id статьи.');
  return Number(id);
}

export function validateEditablePost(value: unknown): EditablePost {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PostsValidationError('Некорректные данные статьи.');
  const input = value as Record<string, unknown>;
  const title = requiredString(input.title, 'Заголовок', 200);
  const slug = requiredString(input.slug, 'Slug', 160).normalize('NFKC');
  if (!/^[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)*$/u.test(slug)) {
    throw new PostsValidationError('Slug может содержать буквы, цифры, дефисы и подчёркивания без пробелов.');
  }
  const date = requiredString(input.date, 'Дата', 32);
  const content = typeof input.content === 'string' ? input.content : null;
  if (content === null || content.length > 2_000_000) throw new PostsValidationError('Основной текст некорректен или слишком велик.');
  const sourceUrl = requiredString(input.sourceUrl, 'Исходный URL', 2_000);
  let parsedUrl: URL;
  try { parsedUrl = new URL(sourceUrl); } catch { throw new PostsValidationError('Исходный URL некорректен.'); }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new PostsValidationError('Исходный URL должен использовать HTTP(S).');
  if (!Array.isArray(input.categories) || input.categories.some((item) => typeof item !== 'string' || !item.trim() || item.length > 200) || input.categories.length > 50) {
    throw new PostsValidationError('Категории должны быть непустым списком строк.');
  }
  const letter = input.letter === null || input.letter === '' ? null : requiredString(input.letter, 'Буква', 8);
  return { title, slug, date, letter, categories: input.categories.map((item) => (item as string).trim()), content, sourceUrl };
}

function requiredString(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new PostsValidationError(`${label}: обязательное поле.`);
  const normalized = value.trim();
  if (normalized.length > max) throw new PostsValidationError(`${label}: слишком длинное значение.`);
  return normalized;
}

async function findBlob(config: GitHubConfig, rootTreeSha: string, filePath: string): Promise<string> {
  const segments = filePath.split('/');
  let treeSha = rootTreeSha;
  for (let index = 0; index < segments.length; index += 1) {
    const tree = await github<GitTree>(config, `/git/trees/${treeSha}`);
    const entry = tree.tree.find((item) => item.path === segments[index]);
    const expected = index === segments.length - 1 ? 'blob' : 'tree';
    if (!entry || entry.type !== expected) throw new Error(`GitHub: не найден ${POSTS_PATH}.`);
    treeSha = entry.sha;
  }
  return treeSha;
}

class GitHubError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function github<T>(config: GitHubConfig, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
      'user-agent': 'erazahan-admin',
      'x-github-api-version': '2022-11-28',
      ...init.headers,
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new GitHubError(response.status, `GitHub API ${response.status}: ${detail.slice(0, 300)}`);
  }
  return response.json() as Promise<T>;
}

function decodeBase64(value: string): string {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}
