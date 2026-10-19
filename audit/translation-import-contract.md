# Translation Editor import contract

`Import Translation` accepts one JSON object, either as plain JSON or inside a standard `json` fenced code block. It is parsed as JSON; fields are never extracted from arbitrary prose.

```json
{
  "slug": "сонник-есть-мясо-утки",
  "title": "Есть мясо утки во сне — к чему снится | Сонник",
  "description": "К чему снится есть мясо утки? Сонник толкует утиное мясо во сне как знак любовной радости. Узнайте значение сна, его психологию и приятную тайну.",
  "content": "## Сонник: есть мясо утки во сне\n\n### Традиционное толкование\n\nЕсть мясо утки во сне — к любовной радости.",
  "image_alts": {},
  "tags": [],
  "alphabet_key": "У"
}
```

The example is a real excerpt from the published RU document for `сонник-есть-мясо-утки`; it is a format example, not a request to overwrite that document. All seven fields are required and no extra fields are accepted. `description` and `alphabet_key` may be `null`; all tags and all `image_alts` values must be strings. Keep existing `content://UUID` and `asset://UUID` references unchanged when they are present. RU slugs must be canonical lowercase Russian Cyrillic, digits, and single hyphen separators; transliterated Latin slugs are rejected. The editor applies the validated object to its local form only after preview and confirmation. Import never calls a write API, saves, publishes, creates assets, or changes HY provenance. Locale-specific slug/alphabet validation and published-slug locking still apply before the form is updated.
