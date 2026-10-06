// The normalized key sequence behind the legacy HY dream letter pages. The
// legacy page for "Ու" stores U+0552; the public route has always normalized
// it to U+0582, so this is the canonical stored/write form.
export const HY_DREAM_DISPLAY_ALPHABET = Object.freeze([
  '\u0531', '\u0532', '\u0533', '\u0534', '\u0535', '\u0536', '\u0537', '\u0538', '\u0539', '\u053a',
  '\u053b', '\u053c', '\u053d', '\u053e', '\u053f', '\u0540', '\u0541', '\u0542', '\u0543', '\u0544',
  '\u0545', '\u0546', '\u0547', '\u0548', '\u0549', '\u054a', '\u054b', '\u054c', '\u054d', '\u054e',
  '\u054f', '\u0550', '\u0551', '\u0548\u0582', '\u0553', '\u0554', '\u0555', '\u0556',
]);

// Ր has no imported dream letter page, so it remains a display-only glyph and
// is intentionally not accepted as a navigable dream alphabet key.
export const HY_DREAM_ALPHABET_KEYS = Object.freeze(HY_DREAM_DISPLAY_ALPHABET.filter((key) => key !== '\u0550'));

const HY_DREAM_ALPHABET_KEY_SET = new Set(HY_DREAM_ALPHABET_KEYS);

export function normalizeHyDreamAlphabetKey(value) {
  return typeof value === 'string' ? value.replace(/\u0552/g, '\u0582').trim() : value;
}

export function isSupportedHyDreamAlphabetKey(value) {
  return typeof value === 'string' && HY_DREAM_ALPHABET_KEY_SET.has(value);
}

export function validateHyDreamAlphabetKey(value, { required = false } = {}) {
  if (value === null) {
    if (required) throw new TypeError('HY alphabet key is required for native articles');
    return null;
  }
  if (!isSupportedHyDreamAlphabetKey(value)) {
    throw new TypeError('HY alphabet key must be a supported canonical dream letter');
  }
  return value;
}
