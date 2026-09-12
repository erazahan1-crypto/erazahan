import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  BASELINE_DIR,
  BASELINE_TYPE,
  GENERATOR_VERSION,
  ROOT,
  SCHEMA_VERSION,
  collectArtifacts,
  compareText,
  firstDifference,
  readJson,
  sha256,
  stableStringify,
} from './baseline-lib.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function command(commandName, args = []) {
  return execFileSync(commandName, args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function npmVersion() {
  if (process.platform !== 'win32') return command('npm', ['--version']);
  return command(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm --version']);
}

const durationArgument = argument('--build-duration-ms');
const buildDurationMs = durationArgument === null ? null : Number(durationArgument);
if (durationArgument !== null && (!Number.isFinite(buildDurationMs) || buildDurationMs < 0)) {
  throw new Error('--build-duration-ms must be a non-negative number');
}

const branch = command('git', ['branch', '--show-current']);
const commit = command('git', ['rev-parse', 'HEAD']);
const artifacts = collectArtifacts({ buildDurationMs });

let reference = { checked: false, reason: 'No --reference-manifest argument supplied.' };
const referencePath = argument('--reference-manifest');
if (referencePath) {
  const expected = readJson(path.resolve(referencePath));
  const byPath = (entries) => [...entries].sort((a, b) => compareText(a.path, b.path));
  const diff = firstDifference(byPath(expected), byPath(artifacts.outputFiles.files));
  if (diff) throw new Error(`Current dist differs from determinism reference at ${diff.path}: expected ${JSON.stringify(diff.expected)}, actual ${JSON.stringify(diff.actual)}`);
  const bytes = fs.readFileSync(path.resolve(referencePath));
  reference = {
    checked: true,
    identical: true,
    manifest_sha256: sha256(bytes),
    file_count: expected.length,
  };
}

const astroPackage = readJson(path.join(ROOT, 'node_modules', 'astro', 'package.json'));
const metadata = {
  schema_version: SCHEMA_VERSION,
  baseline_type: BASELINE_TYPE,
  generated_at: new Date().toISOString(),
  commit,
  source_commit: commit,
  branch,
  node_version: process.version,
  npm_version: npmVersion(),
  astro_version: astroPackage.version,
  build_command: 'npm run build',
  build_output_dir: 'dist',
  build_duration_ms: buildDurationMs,
  source_posts_file: 'src/data/posts.json',
  source_posts_sha256: artifacts.posts_sha256,
  source_post_count: artifacts.post_count,
  dictionary_route_count: artifacts.dictionary.route_count,
  generator: 'audit/scripts/create-baseline.mjs',
  generator_version: GENERATOR_VERSION,
  verifier: 'audit/scripts/verify-baseline.mjs',
  public_output_determinism_reference: reference,
};

fs.mkdirSync(BASELINE_DIR, { recursive: true });
const files = new Map([
  ['metadata.json', metadata],
  ['dictionary-routes.json', artifacts.dictionary],
  ['search.json', artifacts.search],
  ['dream-content-index.json', artifacts.dream],
  ['sitemap.json', artifacts.sitemap],
  ['non-dictionary-routes.json', artifacts.nonDictionary],
  ['build.json', artifacts.build],
  ['output-files.json', artifacts.outputFiles],
]);
for (const [name, value] of files) fs.writeFileSync(path.join(BASELINE_DIR, name), stableStringify(value), 'utf8');

console.log(`HY baseline v1 generated at ${BASELINE_DIR}`);
console.log(JSON.stringify({
  source_commit: commit,
  dictionary_routes: artifacts.dictionary.route_count,
  search_entries: artifacts.search.entry_count,
  dream_content_entries: artifacts.dream.entry_count,
  sitemap_entries: artifacts.sitemap.entry_count,
  output_files: artifacts.outputFiles.file_count,
  output_bytes: artifacts.outputFiles.total_bytes,
  reference_identical: reference.identical ?? null,
}, null, 2));
