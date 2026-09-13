import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  EXPECTED_DRY_RUN_SHA256,
  EXPECTED_POSTS,
  EXPECTED_POSTS_SHA256,
  EXPECTED_REGISTRY_SHA256,
  POSTS_PATH,
  REGISTRY_PATH,
  buildImport,
  canonicalSerialization,
  invariant,
  readJsonWithBytes,
  sha256,
} from './dry-run-hy-import.mjs';
import { STORE_ROOT, verifyHyStoreAt } from './verify-hy-store.mjs';

function safeRemoveTemporaryStore(temporaryRoot, parent) {
  if (!temporaryRoot || !existsSync(temporaryRoot)) return;
  const resolvedTemporary = path.resolve(temporaryRoot);
  const resolvedParent = path.resolve(parent);
  invariant(path.dirname(resolvedTemporary) === resolvedParent, 'Refusing to remove temporary store outside intended parent');
  invariant(path.basename(resolvedTemporary).startsWith('.dreams-stage8-'), 'Refusing to remove an unrecognized temporary store');
  rmSync(resolvedTemporary, { recursive: true, force: false });
}

export function createHyStore() {
  invariant(!existsSync(STORE_ROOT), `Refusing to overwrite existing permanent HY store: ${STORE_ROOT}`);
  const postsSource = readJsonWithBytes(POSTS_PATH);
  const registrySource = readJsonWithBytes(REGISTRY_PATH);
  invariant(sha256(postsSource.bytes) === EXPECTED_POSTS_SHA256, 'posts.json SHA-256 changed');
  invariant(sha256(registrySource.bytes) === EXPECTED_REGISTRY_SHA256, 'Registry SHA-256 changed');

  const generated = buildImport(postsSource.value, registrySource.value);
  invariant(generated.sha256 === EXPECTED_DRY_RUN_SHA256, `BLOCKED: Stage 7 logical SHA changed to ${generated.sha256}`);
  invariant(generated.generated.length === EXPECTED_POSTS, `Expected 5800 generated records, found ${generated.generated.length}`);
  invariant(generated.missingRegistrySourceUrls.length === 0, 'Missing registry mapping detected');
  invariant(generated.itemValidationErrors.length === 0, 'ContentItem schema validation failed before write');
  invariant(generated.localeValidationErrors.length === 0, 'HY schema validation failed before write');
  invariant(generated.relationValidationErrors.length === 0, 'Item/HY relation validation failed before write');

  const parent = path.dirname(STORE_ROOT);
  mkdirSync(parent, { recursive: true });
  let temporaryRoot = null;
  try {
    temporaryRoot = mkdtempSync(path.join(parent, '.dreams-stage8-'));
    for (const record of generated.generated) {
      const contentId = record.item.content_id;
      const shard = contentId.slice(0, 2);
      const directory = path.join(temporaryRoot, shard, contentId);
      mkdirSync(directory, { recursive: true });
      writeFileSync(path.join(directory, 'item.json'), canonicalSerialization(record.item), { encoding: 'utf8', flag: 'wx' });
      writeFileSync(path.join(directory, 'hy.json'), canonicalSerialization(record.localeDocument), { encoding: 'utf8', flag: 'wx' });
    }

    const temporaryReport = verifyHyStoreAt(temporaryRoot);
    invariant(temporaryReport.fingerprints.permanent_logical_sha256 === EXPECTED_DRY_RUN_SHA256, 'Temporary store logical SHA mismatch');
    invariant(!existsSync(STORE_ROOT), 'Permanent target appeared during generation; refusing to replace it');
    renameSync(temporaryRoot, STORE_ROOT);
    temporaryRoot = null;
    const permanentReport = verifyHyStoreAt(STORE_ROOT);
    return {
      status: 'PASS',
      store_root: permanentReport.store_root,
      logical_items: permanentReport.counts.logical_items,
      files: permanentReport.counts.total_files,
      bytes: permanentReport.counts.total_bytes,
      logical_sha256: permanentReport.fingerprints.permanent_logical_sha256,
      full_store_sha256: permanentReport.fingerprints.full_permanent_store_sha256,
      generation_strategy: 'validated sibling temp directory followed by same-volume directory rename',
    };
  } catch (error) {
    safeRemoveTemporaryStore(temporaryRoot, parent);
    throw error;
  }
}

const isMain = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    const report = createHyStore();
    console.log('PERMANENT HY STORE CREATE PASS');
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(`PERMANENT HY STORE CREATE FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
