import { execFileSync } from 'node:child_process';
import path from 'node:path';
import {
  BASELINE_DIR,
  BASELINE_TYPE,
  GENERATOR_VERSION,
  ROOT,
  SCHEMA_VERSION,
  collectArtifacts,
  firstDifference,
  readJson,
} from './baseline-lib.mjs';

const BASELINE_ARTIFACT_COMMIT = '0e9a299e6f714e264b8653d875e402501a5ea7b4';

function requireAncestor(ancestor, commit, label) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, commit], { cwd: ROOT, stdio: 'ignore' });
  } catch {
    throw new Error(`${label} ${ancestor} is not an ancestor of HEAD ${commit}`);
  }
}

function fail(message) {
  console.error(`BASELINE VERIFY FAILED: ${message}`);
  process.exitCode = 1;
}

try {
  const metadata = readJson(path.join(BASELINE_DIR, 'metadata.json'));
  const expected = {
    dictionary: readJson(path.join(BASELINE_DIR, 'dictionary-routes.json')),
    search: readJson(path.join(BASELINE_DIR, 'search.json')),
    dream: readJson(path.join(BASELINE_DIR, 'dream-content-index.json')),
    sitemap: readJson(path.join(BASELINE_DIR, 'sitemap.json')),
    nonDictionary: readJson(path.join(BASELINE_DIR, 'non-dictionary-routes.json')),
    build: readJson(path.join(BASELINE_DIR, 'build.json')),
    outputFiles: readJson(path.join(BASELINE_DIR, 'output-files.json')),
  };
  if (metadata.schema_version !== SCHEMA_VERSION) throw new Error(`metadata schema_version is ${metadata.schema_version}, expected ${SCHEMA_VERSION}`);
  if (metadata.baseline_type !== BASELINE_TYPE) throw new Error(`metadata baseline_type is ${metadata.baseline_type}, expected ${BASELINE_TYPE}`);
  if (metadata.generator_version !== GENERATOR_VERSION) throw new Error(`metadata generator_version is ${metadata.generator_version}, expected ${GENERATOR_VERSION}`);
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: ROOT, encoding: 'utf8' }).trim();
  requireAncestor(metadata.source_commit, commit, 'baseline source_commit');
  requireAncestor(BASELINE_ARTIFACT_COMMIT, commit, 'baseline artifact commit');
  if (metadata.branch !== branch) throw new Error(`branch ${branch} differs from baseline branch ${metadata.branch}`);

  const actual = collectArtifacts({ buildDurationMs: expected.build.build_duration_ms });
  if (metadata.source_posts_sha256 !== actual.posts_sha256) {
    throw new Error(`src/data/posts.json SHA-256 ${actual.posts_sha256} differs from baseline ${metadata.source_posts_sha256}`);
  }
  if (metadata.source_post_count !== actual.post_count) {
    throw new Error(`source post count ${actual.post_count} differs from baseline ${metadata.source_post_count}`);
  }
  if (metadata.dictionary_route_count !== actual.dictionary.route_count) {
    throw new Error(`dictionary route count ${actual.dictionary.route_count} differs from baseline ${metadata.dictionary_route_count}`);
  }
  for (const name of Object.keys(expected)) {
    const diff = firstDifference(expected[name], actual[name]);
    if (diff) {
      fail(`${name} differs at ${diff.path}: expected ${JSON.stringify(diff.expected)}, actual ${JSON.stringify(diff.actual)}`);
      break;
    }
  }
  if (!process.exitCode) {
    console.log('HY BASELINE VERIFY PASS');
    console.log(JSON.stringify({
      source_commit: metadata.source_commit,
      dictionary_routes: actual.dictionary.route_count,
      search_entries: actual.search.entry_count,
      dream_content_entries: actual.dream.entry_count,
      sitemap_entries: actual.sitemap.entry_count,
      output_files: actual.outputFiles.file_count,
      output_bytes: actual.outputFiles.total_bytes,
    }, null, 2));
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
