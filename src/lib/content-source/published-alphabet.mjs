import { allowedAlphabetKeys, canonicalAlphabetRouteKey } from '../content-schema/locale-alphabet.mjs';
import { listPublishedLocaleEntries } from './published-content.mjs';

function compareCodePoints(left, right) {
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  const count = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < count; index += 1) {
    if (leftPoints[index] < rightPoints[index]) return -1;
    if (leftPoints[index] > rightPoints[index]) return 1;
  }
  return leftPoints.length - rightPoints.length;
}

function entryComparator(locale) {
  const collator = new Intl.Collator(locale === 'ru' ? 'ru' : 'en', {
    usage: 'sort', sensitivity: 'base', numeric: true,
  });
  return (left, right) => collator.compare(left.title, right.title)
    || compareCodePoints(left.title.normalize('NFC'), right.title.normalize('NFC'))
    || compareCodePoints(left.content_id, right.content_id);
}

// This projection intentionally consumes only Stage 12D's published resolver.
// It creates no routes and never falls back across locales.
export function listPublishedAlphabetGroups(repository, locale) {
  const keys = allowedAlphabetKeys(locale);
  const groups = new Map();
  for (const entry of listPublishedLocaleEntries(repository, locale)) {
    const alphabetKey = entry.published.alphabet_key;
    if (alphabetKey === null) continue;
    if (!keys.includes(alphabetKey)) {
      throw new TypeError(`Published alphabet projection received unsupported ${locale} key ${JSON.stringify(alphabetKey)}`);
    }
    const entries = groups.get(alphabetKey) ?? [];
    entries.push(Object.freeze({
      content_id: entry.content_id,
      slug: entry.slug,
      title: entry.published.title,
      alphabet_key: alphabetKey,
    }));
    groups.set(alphabetKey, entries);
  }
  const compareEntries = entryComparator(locale);
  return Object.freeze(keys.filter((key) => groups.has(key)).map((alphabetKey) => Object.freeze({
    locale,
    alphabet_key: alphabetKey,
    route_key: canonicalAlphabetRouteKey(locale, alphabetKey),
    entries: Object.freeze(groups.get(alphabetKey).sort(compareEntries)),
  })));
}
