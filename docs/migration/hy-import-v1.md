# HY import v1 mapping

Status: Stage 7 dry-run contract. This design creates no permanent content store and does not change the public reader, routes, admin, sitemap, or search.

## Legacy field mapping

| Legacy field | Target | Rule | Disposition |
| --- | --- | --- | --- |
| `slug` | `LocaleDocument(hy).published.slug` | Exact string copy; no normalization or transliteration | Preserved |
| `title` | `LocaleDocument(hy).published.title` | Exact string copy | Preserved |
| `date` | `LocaleDocument(hy).published.published_at` | Exact ISO date copy, interpreted consistently with the current UI and Article JSON-LD as the legacy publication date | Preserved |
| `letter` | `LocaleDocument(hy).published.alphabet_key` | Exact string or null copy | Preserved |
| `categories` | `LocaleDocument(hy).published.tags` | Exact array copy in source order; labels remain localized HY data | Preserved; no taxonomy inference |
| `content` | `LocaleDocument(hy).published.content` | Exact string copy | Preserved |
| `sourceUrl` | `ContentItem.content_id` lookup | Exact URL selects the permanent registry entry; it is not copied into schema v1 because that field does not exist | Used for identity derivation |
| `comments` | None | Visitor data is outside the article/locale model | Intentionally not migrated |

The permanent registry supplies `content_id` and historical `original_array_index`. The index is used only to make dry-run serialization deterministic; it is not a content identity and is not added to schema v1.

## Critical decisions

`description` is `null`. The canonical corpus has no description field. The current public page uses a stored description only when present and otherwise computes an excerpt from content. Schema v1 deliberately requires the key but allows null to represent that fallback without inventing editorial or SEO text. The import fingerprint therefore includes `description: null`, not a generated excerpt.

Legacy `categories` become localized HY `tags` by exact array copy. This does not claim that categories and tags are universally equivalent and does not create language-neutral taxonomy. It is the safe v1 representation of the existing localized labels without editorial cleanup.

`image_alts` is `{}`. Two existing posts contain inline image markup, including its real source and ALT, inside canonical `content`; exact content copying preserves it. Current covers are resolved from an optional legacy `cover` field or by matching `images.json` filenames to slugs, and the rendered cover ALT is the title. Neither mechanism supplies a stable asset identity suitable for `image_alts`. The import does not duplicate inline markup into a second field, invent asset IDs, or freeze the slug-based cover relation into shared state.

Every record starts as HY `published` with `draft: null`, `version: 1`, `source_revision: 1`, and `fingerprint_spec_version: 1`. HY `based_on_source_revision` and `based_on_source_fingerprint` are null because the source locale is not based on itself. `ContentItem.source_fingerprint` is computed with `sourceFingerprintV1` from the published HY semantic payload and must match on recomputation.

`published_at` is the exact legacy `date`. All 5,800 values are valid ISO calendar dates, and the production site currently exposes that field as the visible post date and `Article.datePublished`. No import-time timestamp is introduced. `updated_at` is omitted because the source has no historical update field.

## Dry-run

Run:

```sh
node audit/scripts/dry-run-hy-import.mjs
```

The script reads the canonical corpus, permanent registry, current image inventory, and saved public baseline. It builds and validates 5,800 `ContentItem` plus 5,800 HY `LocaleDocument` objects in memory, writes one process-unique artifact below the operating-system temporary directory, and creates no RU or EN records.

Canonical serialization recursively sorts object keys and orders record arrays by the registry's `legacy.original_array_index`. The script compares two independent runs, repeats the import with the source array reversed, verifies exact slug/title/content/letter/category parity, checks the target route set against both canonical posts and the saved HY baseline, and prints the reference SHA-256.
