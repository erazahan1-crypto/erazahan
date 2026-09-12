# Multilingual content schema v1

Status: internal migration foundation. This version defines validators and state helpers only. It does not import content, change the public reader, create locale routes, or alter admin behavior.

## 1. Current-data constraints

The canonical HY corpus contains 5,800 records. Every record has `slug`, `title`, `date`, `letter`, `categories`, `content`, `sourceUrl`, and `comments`. All titles and content values are non-empty. `letter` is populated for 4,215 records, categories contain one or two localized labels, and there are no explicit descriptions or cover fields in the canonical corpus.

The current reader derives routes from `slug`, descriptions from content when absent, and covers from an optional legacy field or slug-matched files. There is no language-neutral taxonomy or asset registry. Consequently, schema v1 does not invent shared taxonomy IDs, asset IDs, or shared timestamps.

## 2. Logical model

One logical article consists of:

```text
ContentItem
  + LocaleDocument(hy)
  + LocaleDocument(ru), when created
  + LocaleDocument(en), when created
```

`content_id` is the immutable relation key. Legacy items use their saved UUIDv5; future items may use UUIDv7. Slugs and array positions are never identity keys.

Supported locales are exactly `hy`, `ru`, and `en`. The source locale is exactly `hy`.

## 3. ContentItem v1

```json
{
  "schema_version": 1,
  "content_id": "efa61838-86c8-56b8-815c-0a38b0a83242",
  "type": "dream_dictionary",
  "source_locale": "hy",
  "source_revision": 1,
  "source_fingerprint": "64 lower-case hex characters",
  "fingerprint_spec_version": 1
}
```

Only identity and source-version state are shared. `source_revision = 0` requires `source_fingerprint = null` and represents an item without a published HY source. A positive revision requires a valid fingerprint.

The following are intentionally not shared:

- locale slug, title, description, content, ALT text, tags, and alphabet key;
- localized publication state or timestamps;
- current Armenian category labels;
- cover/image references before an asset identity model exists.

## 4. LocaleDocument v1

```json
{
  "schema_version": 1,
  "content_id": "efa61838-86c8-56b8-815c-0a38b0a83242",
  "locale": "hy",
  "draft": null,
  "published": null
}
```

`draft` and `published` are independent nullable snapshots. Both null is valid but equivalent to content not created for that locale. Draft-only and published-only documents are valid. Keeping an old published snapshot while editing a new draft is the normal editing model.

Publishing creates or replaces the published snapshot. Editing or deleting a draft does not mutate the published snapshot.

## 5. Localized payload v1

The draft payload contains:

```json
{
  "slug": "locale-specific-slug",
  "title": "Localized title",
  "description": null,
  "content": "Localized HTML, Markdown, or mixed source",
  "image_alts": {},
  "tags": [],
  "alphabet_key": null,
  "based_on_source_revision": null,
  "based_on_source_fingerprint": null,
  "updated_at": "2026-09-12T20:00:00Z",
  "generation": {
    "kind": "human"
  }
}
```

`description` is required but nullable so the current HY fallback behavior can be represented without editorial invention. `image_alts` maps stable asset references to locale-specific ALT strings and may be empty. Until asset identity is designed, the schema does not prescribe those references. `tags` are localized labels; current HY categories can later be mapped without declaring their Armenian text language-neutral. `alphabet_key` is locale-specific navigation metadata.

`updated_at` and `generation` are optional. `updated_at` means the last persisted editorial modification of that snapshot and, when present, is an RFC 3339 instant. Optional generation metadata records provenance only. Its supported keys are `kind`, `provider`, `model`, `prompt_version`, and `generated_at`; no AI execution exists in schema v1.

For HY, both `based_on_source_*` fields are null because the source does not derive from itself. RU and EN payloads require the revision and fingerprint of the published HY source used to create them. RU and EN always derive directly from HY; EN never derives from RU and RU never derives from EN.

## 6. Published payload v1

A published snapshot contains every localized payload field plus:

```json
{
  "version": 1,
  "published_at": "2026-09-12"
}
```

`version` is an integer starting at one and increments when that locale is published again. `published_at` records publication timing. A legacy import may preserve an ISO calendar date because the current corpus has date-only values; new publication operations should write an RFC 3339 instant.

## 7. Draft exclusion from public output

Future public selectors may consume only `LocaleDocument.published`. Draft data must produce no route, sitemap entry, search entry, hreflang entry, or public API representation. This is a build invariant, not a UI convention. The v1 `selectPublishedLocale` helper returns only the saved published snapshot and returns null for draft-only documents.

Stage 6 does not connect this selector to the production build.

## 8. HY source revision

HY draft edits do not change `source_revision` or `source_fingerprint`. On HY publish:

1. Compute fingerprint v1 from the published semantic HY payload.
2. If it equals the saved source fingerprint, keep the revision unchanged.
3. If it differs, increment the revision once and save the new fingerprint.

Publishing RU or EN never changes HY source state.

## 9. Source fingerprint v1

Fingerprint spec version: `1`

Hash algorithm: SHA-256 over UTF-8 canonical JSON.

Included fields:

- `title`;
- `description`;
- `content`;
- `image_alts`;
- `tags`.

Excluded fields:

- slug and alphabet key, because route/navigation changes do not change translation meaning;
- content ID, locale, source revision, and source fingerprint;
- draft/published state, publication version, and timestamps;
- generation kind, provider, model, prompt version, and generation timestamp;
- build and other technical metadata.

Serialization selects only the five included fields, sorts every object key lexicographically, treats tags as an order-insensitive collection by sorting them with the JavaScript default code-unit order, preserves string bytes/code points without Unicode normalization, and serializes with `JSON.stringify` without added whitespace. A semantic change to title, description, content, a tag, or ALT changes the fingerprint.

## 10. Translation state

The compact derived state is:

```text
no draft and no published -> NOT_CREATED
draft and no published    -> DRAFT
published basis matches   -> CURRENT
published basis differs   -> OUTDATED
```

Publication and synchronization are also returned as separate axes so a published snapshot plus a newer draft does not lose information:

```text
publication_state:
  NOT_CREATED | DRAFT | PUBLISHED | PUBLISHED_WITH_DRAFT

draft_synchronization:
  NOT_CREATED | CURRENT | OUTDATED

published_synchronization:
  NOT_CREATED | CURRENT | OUTDATED
```

Synchronization is `CURRENT` only when both `based_on_source_revision` and `based_on_source_fingerprint` match the current published HY source. State is derived, never stored as `outdated: true`. RU and EN states are computed independently.

## 11. Validation and relation rules

Validators reject unknown schema fields and enforce:

- schema version 1 and content type `dream_dictionary`;
- UUIDv5 or UUIDv7 content IDs with the RFC variant;
- exact source locale and supported locale set;
- coherent source revision/fingerprint pairs;
- localized and published payload shapes;
- translation basis for RU and EN;
- matching `ContentItem.content_id` and `LocaleDocument.content_id`.

Registry integrity remains the responsibility of the separate permanent registry validator. Runtime schema is not coupled to a legacy array index or slug.

## 12. Schema migration policy

Schema version 1 becomes stable before HY import. Additive optional fields require review and updated validators. Any incompatible field, meaning, or validation change after data import requires an explicit versioned migration; existing records must never be silently reinterpreted or bulk-rewritten under the same schema version.

This stage creates no item or locale records and no RU/EN content.
