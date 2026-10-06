import { partitionManagedImageDeletes } from './managed-asset-references.mjs';

export function uploadedImageCleanupKeys(commitOutcome, keys) {
  if (!Array.isArray(keys)) throw new TypeError('Uploaded image keys must be an array');
  return commitOutcome === 'not_committed' ? [...keys] : [];
}

export function committedImageDeletionPlan(commitOutcome, references, keys) {
  if (commitOutcome !== 'committed') return Object.freeze({ safe: Object.freeze([]), retained: Object.freeze([]) });
  return partitionManagedImageDeletes(references, keys);
}

export async function deleteCommittedImageKeys(bucket, keys) {
  const deleted = [];
  const failed = [];
  for (const key of keys) {
    try {
      await bucket.delete(key);
      deleted.push(key);
    } catch (error) {
      console.error('R2 delete after confirmed GitHub save failed', key, error);
      failed.push(key);
    }
  }
  return Object.freeze({ deleted: Object.freeze(deleted), failed: Object.freeze(failed) });
}
