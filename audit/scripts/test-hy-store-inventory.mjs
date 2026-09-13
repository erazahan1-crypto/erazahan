import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { canonicalCheckoutBytes, physicalInventory } from './verify-hy-store.mjs';

function write(root, file, content) {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function fixture(eol = '\n', itemKind = 'item') {
  const root = mkdtempSync(path.join(tmpdir(), 'erazahan-hy-store-inventory-'));
  write(root, '00/record/item.json', `{${eol}  "kind": ${JSON.stringify(itemKind)}${eol}}${eol}`);
  write(root, '00/record/hy.json', `{${eol}  "kind": "hy"${eol}}${eol}`);
  return root;
}

function rawFixtureBytes(root) {
  return ['00/record/item.json', '00/record/hy.json']
    .reduce((total, file) => total + readFileSync(path.join(root, file)).length, 0);
}

const roots = [];
try {
  const lfRoot = fixture('\n');
  const crlfRoot = fixture('\r\n');
  roots.push(lfRoot, crlfRoot);
  const lfInventory = physicalInventory(lfRoot);
  const crlfInventory = physicalInventory(crlfRoot);
  assert.notEqual(rawFixtureBytes(lfRoot), rawFixtureBytes(crlfRoot), 'physical LF and CRLF checkout byte lengths differ');
  assert.equal(lfInventory.sha256, crlfInventory.sha256, 'LF and CRLF checkout representations have one canonical checksum');
  assert.equal(lfInventory.total_bytes, crlfInventory.total_bytes, 'canonical inventory total byte size is checkout-independent');
  assert.deepEqual(
    lfInventory.files.map(({ path: file, size }) => ({ path: file, size })),
    crlfInventory.files.map(({ path: file, size }) => ({ path: file, size })),
    'each canonical inventory record size is checkout-independent',
  );

  const escapedCrLf = 'line1\r\nline2';
  const escapedLf = 'line1\nline2';
  const escapedLfRoot = fixture('\n', escapedCrLf);
  const escapedCrLfRoot = fixture('\r\n', escapedCrLf);
  const escapedAlternativeRoot = fixture('\n', escapedLf);
  roots.push(escapedLfRoot, escapedCrLfRoot, escapedAlternativeRoot);
  const escapedLfBytes = readFileSync(path.join(escapedLfRoot, '00/record/item.json'));
  const escapedCrLfBytes = readFileSync(path.join(escapedCrLfRoot, '00/record/item.json'));
  const escapedCrLfLiteral = Buffer.from('line1\\r\\nline2', 'utf8');
  const escapedLfLiteral = Buffer.from('line1\\nline2', 'utf8');
  assert.ok(canonicalCheckoutBytes(escapedLfBytes).includes(escapedCrLfLiteral), 'canonicalization preserves escaped CRLF JSON string data');
  assert.ok(canonicalCheckoutBytes(escapedCrLfBytes).includes(escapedCrLfLiteral), 'canonicalization only changes physical CRLF bytes');
  assert.equal(canonicalCheckoutBytes(escapedLfBytes).includes(escapedLfLiteral), false, 'escaped CRLF JSON string data remains distinct from escaped LF');
  assert.equal(physicalInventory(escapedLfRoot).sha256, physicalInventory(escapedCrLfRoot).sha256, 'physical EOL conversion preserves escaped CRLF inventory identity');
  assert.notEqual(physicalInventory(escapedLfRoot).sha256, physicalInventory(escapedAlternativeRoot).sha256, 'escaped CRLF JSON string data differs from escaped LF data');

  const changedRoot = fixture();
  roots.push(changedRoot);
  const baseline = physicalInventory(changedRoot).sha256;
  write(changedRoot, '00/record/item.json', '{\n  "kind": "changed"\n}\n');
  assert.notEqual(physicalInventory(changedRoot).sha256, baseline, 'changed content changes the checksum');

  const addedRoot = fixture();
  roots.push(addedRoot);
  const addedBaseline = physicalInventory(addedRoot).sha256;
  write(addedRoot, '00/record/extra.json', '{}\n');
  assert.notEqual(physicalInventory(addedRoot).sha256, addedBaseline, 'added file changes the checksum');

  const removedRoot = fixture();
  roots.push(removedRoot);
  const removedBaseline = physicalInventory(removedRoot).sha256;
  unlinkSync(path.join(removedRoot, '00/record/hy.json'));
  assert.notEqual(physicalInventory(removedRoot).sha256, removedBaseline, 'removed file changes the checksum');

  const renamedRoot = fixture();
  roots.push(renamedRoot);
  const renamedBaseline = physicalInventory(renamedRoot).sha256;
  renameSync(path.join(renamedRoot, '00/record/item.json'), path.join(renamedRoot, '00/record/renamed.json'));
  assert.notEqual(physicalInventory(renamedRoot).sha256, renamedBaseline, 'path changes the checksum');

  console.log('HY STORE INVENTORY PASS');
  console.log(JSON.stringify({
    lf_crlf_platform_independence: true,
    canonical_record_sizes: true,
    escaped_newline_semantics_preserved: true,
    changed_content_detected: true,
    added_file_detected: true,
    removed_file_detected: true,
    path_change_detected: true,
  }, null, 2));
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}
