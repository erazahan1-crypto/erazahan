// JSON inside a raw HTML script element must not contain parser-significant
// characters. Escaping them as JSON Unicode escapes preserves parsed values.
export function serializeJsonForHtmlScript(value) {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string') throw new TypeError('JSON-LD value must be JSON-serializable');
  return serialized
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
