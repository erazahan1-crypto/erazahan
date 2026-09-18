export const ADMIN_DEPLOYMENT_CLASS_ENV = 'ERAZAHAN_ADMIN_DEPLOYMENT_CLASS';
export const ADMIN_DEPLOYMENT_CLASSES = Object.freeze(['production', 'preview']);

export class AdminWriteEnvironmentGuardError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AdminWriteEnvironmentGuardError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new AdminWriteEnvironmentGuardError(code, message);
}

function requiredBranch(env, name) {
  const value = env?.[name];
  if (typeof value !== 'string' || !value.trim()) {
    fail('INVALID_ATOMIC_BRANCH_CONFIRMATION', `${name} must be explicitly configured for atomic writes`);
  }
  const branch = value.trim();
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes('..')) {
    fail('INVALID_ATOMIC_BRANCH_CONFIRMATION', `${name} must be a valid GitHub branch name`);
  }
  return branch;
}

// Repository writes require both an explicit writer-specific branch confirmation
// and a deployment class selected by the Pages production/preview environment.
// There is intentionally no fallback deployment class or target branch.
export function resolveAdminWriteBranch(env, confirmationEnvironmentVariable) {
  if (typeof confirmationEnvironmentVariable !== 'string' || !confirmationEnvironmentVariable) {
    fail('INVALID_ATOMIC_BRANCH_CONFIRMATION', 'Writer branch confirmation variable is invalid');
  }
  const target = requiredBranch(env, 'ADMIN_GITHUB_BRANCH');
  const confirmed = requiredBranch(env, confirmationEnvironmentVariable);
  if (target !== confirmed) {
    fail('INVALID_ATOMIC_BRANCH_CONFIRMATION', `ADMIN_GITHUB_BRANCH must match ${confirmationEnvironmentVariable} for atomic writes`);
  }

  const deploymentClass = env?.[ADMIN_DEPLOYMENT_CLASS_ENV];
  if (deploymentClass === 'production') {
    if (target !== 'main') fail('INVALID_WRITE_ENVIRONMENT', 'Production admin writes may target only main');
    return 'main';
  }
  if (deploymentClass === 'preview') {
    if (target === 'main') fail('INVALID_WRITE_ENVIRONMENT', 'Preview admin writes must not target main');
    return target;
  }
  fail('INVALID_WRITE_ENVIRONMENT', `${ADMIN_DEPLOYMENT_CLASS_ENV} must be production or preview`);
}
