const RU_ALPHABET = Object.freeze([
  'А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ё', 'Ж', 'З', 'И', 'Й', 'К', 'Л', 'М', 'Н', 'О', 'П', 'Р', 'С', 'Т', 'У', 'Ф', 'Х', 'Ц', 'Ч', 'Ш', 'Щ', 'Ъ', 'Ы', 'Ь', 'Э', 'Ю', 'Я',
]);
const EN_ALPHABET = Object.freeze(Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index)));
const ALPHABETS = Object.freeze({ ru: RU_ALPHABET, en: EN_ALPHABET });
const RESERVED_DREAM_SLUGS = Object.freeze({
  ru: Object.freeze(['search', 'letter']),
  en: Object.freeze(['search', 'letter', 'search-index.json']),
});

function fail(message) {
  throw new TypeError(`Locale alphabet contract: ${message}`);
}

function assertAlphabetLocale(locale) {
  if (!Object.hasOwn(ALPHABETS, locale)) fail(`unsupported locale ${JSON.stringify(locale)}`);
  return locale;
}

export function allowedAlphabetKeys(locale) {
  assertAlphabetLocale(locale);
  return ALPHABETS[locale];
}

export function reservedLocalizedDreamSlugs(locale) {
  assertAlphabetLocale(locale);
  return RESERVED_DREAM_SLUGS[locale];
}

export function classifyAlphabetKey(locale, title) {
  assertAlphabetLocale(locale);
  if (typeof title !== 'string') fail('title must be a string');
  const normalized = title.trim().normalize('NFC');
  const first = Array.from(normalized).find((character) => !/[\p{White_Space}\p{P}]/u.test(character));
  if (!first) return null;

  if (locale === 'ru') {
    if (first === 'ё' || first === 'Ё') return 'Ё';
    return /^[А-Яа-я]$/u.test(first) ? first.toUpperCase() : null;
  }

  if (/^[A-Za-z]$/.test(first)) return first.toUpperCase();
  const base = first.normalize('NFKD').replace(/\p{M}/gu, '');
  return /^[A-Za-z]$/.test(base) ? base.toUpperCase() : null;
}

// The title-derived value is only an authoring suggestion. A published stored
// key remains authoritative so editors can deliberately override it.
export function validateStoredAlphabetKey(locale, _title, alphabetKey) {
  assertAlphabetLocale(locale);
  if (alphabetKey === null) return alphabetKey;
  if (typeof alphabetKey !== 'string' || !allowedAlphabetKeys(locale).includes(alphabetKey)) {
    fail(`stored alphabet_key must be null or an exact canonical ${locale} alphabet key`);
  }
  return alphabetKey;
}

export function canonicalAlphabetRouteKey(locale, alphabetKey) {
  assertAlphabetLocale(locale);
  if (!allowedAlphabetKeys(locale).includes(alphabetKey)) {
    fail(`unsupported stored alphabet key ${JSON.stringify(alphabetKey)} for ${locale}`);
  }
  return locale === 'ru' ? alphabetKey.toLowerCase().replace(/ё/u, 'ё') : alphabetKey.toLowerCase();
}
