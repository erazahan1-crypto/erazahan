import path from 'node:path';
import { assertSupportedLocale } from '../content-schema/multilingual-contract.mjs';
import { listPublishedLocaleEntries } from './published-content.mjs';
import { scanContentStore } from './multilingual-store.mjs';

const CONTENT_STORE_ROOT = path.resolve(process.cwd(), 'src/data/content/dreams');
const availabilityByLocale = new Map();
let repository = null;

function assertLocalizedLocale(locale) {
  assertSupportedLocale(locale);
  if (locale === 'hy') throw new TypeError('Published locale availability supports ru and en only');
}

// Visibility is selected only by the existing published-content projection:
// draft-only documents do not count, while retained published snapshots remain available.
export function publishedLocaleAvailability(repository, locale) {
  assertLocalizedLocale(locale);
  const entries = listPublishedLocaleEntries(repository, locale);
  return Object.freeze({ available: entries.length > 0, entries });
}

// Home and footer share this process-local cache, avoiding repeat full-store scans.
export function loadPublishedLocaleAvailability(locale) {
  assertLocalizedLocale(locale);
  if (availabilityByLocale.has(locale)) return availabilityByLocale.get(locale);
  if (!repository) repository = scanContentStore(CONTENT_STORE_ROOT);
  const availability = publishedLocaleAvailability(repository, locale);
  availabilityByLocale.set(locale, availability);
  return availability;
}
