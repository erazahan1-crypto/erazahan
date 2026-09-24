import { assertSupportedLocale } from './content-schema/multilingual-contract.mjs';

function isEnabled(value) {
  return value === 'true';
}

const runtimeEnvironment = typeof import.meta.env === 'object' && import.meta.env !== null
  ? import.meta.env
  : {};

export const runtimeIndexingConfig = Object.freeze({
  PUBLIC_ALLOW_INDEXING: runtimeEnvironment.PUBLIC_ALLOW_INDEXING,
  PUBLIC_ALLOW_LOCALIZED_INDEXING: runtimeEnvironment.PUBLIC_ALLOW_LOCALIZED_INDEXING,
});

// Locale indexing is fail-closed. The localized release switch supplements,
// rather than replaces, the established global public-indexing switch.
export function isLocaleIndexingAllowed(locale, config = {}) {
  assertSupportedLocale(locale);
  const globalIndexingAllowed = isEnabled(config.PUBLIC_ALLOW_INDEXING);
  if (locale === 'hy') return globalIndexingAllowed;
  return globalIndexingAllowed && isEnabled(config.PUBLIC_ALLOW_LOCALIZED_INDEXING);
}

export function isRuntimeLocaleIndexingAllowed(locale) {
  return isLocaleIndexingAllowed(locale, runtimeIndexingConfig);
}
