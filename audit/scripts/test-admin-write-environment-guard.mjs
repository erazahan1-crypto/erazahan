import assert from 'node:assert/strict';
import {
  AdminWriteEnvironmentGuardError,
  resolveAdminWriteBranch,
} from '../../functions/_lib/admin-write-environment-guard.mjs';
import { resolveAtomicGitHubBranch } from '../../functions/_lib/admin-atomic-hy-write.mjs';

const locale = 'ERAZAHAN_LOCALE_ADMIN_ATOMIC_BRANCH';
const hy = 'ERAZAHAN_HY_ADMIN_ATOMIC_BRANCH';
const environment = (target, confirmation, deploymentClass) => ({
  ADMIN_GITHUB_BRANCH: target,
  [locale]: confirmation,
  ERAZAHAN_ADMIN_DEPLOYMENT_CLASS: deploymentClass,
});

function rejects(code, operation) {
  assert.throws(operation, (error) => error instanceof AdminWriteEnvironmentGuardError && error.code === code);
}

assert.equal(resolveAdminWriteBranch(environment('main', 'main', 'production'), locale), 'main');
assert.equal(resolveAdminWriteBranch(environment('migration/locale-drill', 'migration/locale-drill', 'preview'), locale), 'migration/locale-drill');

for (const [env, code] of [
  [environment('migration/locale-drill', 'migration/locale-drill', 'production'), 'INVALID_WRITE_ENVIRONMENT'],
  [environment('main', 'main', 'preview'), 'INVALID_WRITE_ENVIRONMENT'],
  [environment('main', 'main', undefined), 'INVALID_WRITE_ENVIRONMENT'],
  [environment('main', 'main', 'staging'), 'INVALID_WRITE_ENVIRONMENT'],
  [environment('main', 'main', ' '), 'INVALID_WRITE_ENVIRONMENT'],
  [environment('migration/locale-drill', '', 'preview'), 'INVALID_ATOMIC_BRANCH_CONFIRMATION'],
  [environment('migration/locale-drill', 'other', 'preview'), 'INVALID_ATOMIC_BRANCH_CONFIRMATION'],
  [environment('   ', 'main', 'production'), 'INVALID_ATOMIC_BRANCH_CONFIRMATION'],
  [environment('main', '   ', 'production'), 'INVALID_ATOMIC_BRANCH_CONFIRMATION'],
  [environment('main..bad', 'main..bad', 'production'), 'INVALID_ATOMIC_BRANCH_CONFIRMATION'],
]) rejects(code, () => resolveAdminWriteBranch(env, locale));

assert.equal(resolveAtomicGitHubBranch({
  ADMIN_GITHUB_BRANCH: 'main',
  [hy]: 'main',
  ERAZAHAN_ADMIN_DEPLOYMENT_CLASS: 'production',
}), 'main');
assert.throws(() => resolveAtomicGitHubBranch({
  ADMIN_GITHUB_BRANCH: 'main',
  [hy]: 'main',
  ERAZAHAN_ADMIN_DEPLOYMENT_CLASS: 'preview',
}), (error) => error?.code === 'INVALID_WRITE_ENVIRONMENT');

console.log('ADMIN WRITE ENVIRONMENT GUARD PASS');
