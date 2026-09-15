import { listPublishedAlphabetGroups } from './published-alphabet.mjs';

// Route generation is deliberately a thin projection over the Stage 12I-B
// published alphabet authority. It has no draft or rendering concerns.
export function listLocaleLetterRouteEntries(repository, locale) {
  return Object.freeze(listPublishedAlphabetGroups(repository, locale).map((group) => Object.freeze({
    locale,
    key: group.route_key,
    path: `/${locale}/letter/${group.route_key}/`,
    group,
  })));
}
