import assert from 'node:assert/strict';
import { AdminAtomicHyWriteError } from '../../functions/_lib/admin-atomic-hy-write.mjs';
import { classifyAdminHyWriteError } from '../../functions/_lib/admin-hy-error-classification.mjs';
import { GitHubTransactionError } from '../../functions/_lib/github-multifile.mjs';
import { HyWriteProjectionError } from '../../src/lib/content-write/project-hy-post.mjs';

const classified = (error) => classifyAdminHyWriteError(error);
assert.deepEqual(classified(new AdminAtomicHyWriteError('INVALID_WRITE_MODE', 'private mode detail')), { kind: 'configuration', status: 503, code: 'SERVICE_UNAVAILABLE' });
assert.deepEqual(classified(new HyWriteProjectionError('INVALID_EDIT', 'invalid client field')), { kind: 'validation', status: 400 });
assert.deepEqual(classified(new HyWriteProjectionError('REGISTRY_IDENTITY_MISSING', 'private repository identity')), { kind: 'integrity', status: 503, code: 'REPOSITORY_INTEGRITY' });
assert.deepEqual(classified(new AdminAtomicHyWriteError('REGISTRY_POST_COUNT_MISMATCH', 'private registry count')), { kind: 'integrity', status: 503, code: 'REPOSITORY_INTEGRITY' });
assert.deepEqual(classified(new GitHubTransactionError('REF_LOOKUP_FAILURE', 'private upstream detail')), { kind: 'upstream', status: 502, code: 'UPSTREAM_FAILURE' });
assert.deepEqual(classified(new GitHubTransactionError('BRANCH_REF_CONFLICT', 'branch advanced')), { kind: 'conflict', status: 409 });
assert.deepEqual(classified(new GitHubTransactionError('BRANCH_REF_UPDATE_FAILURE', 'ambiguous commit outcome')), { kind: 'commit_outcome_unknown', status: 502 });
assert.equal(classified(new Error('unclassified')), null);

console.log('ADMIN HY ERROR CLASSIFICATION PASS');
