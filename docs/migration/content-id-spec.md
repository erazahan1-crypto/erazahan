# Permanent content identity specification

Status: Stage 3 design contract  
Specification version: 1  
Applies to: the existing 5,800 Armenian records and future logical content items  
Does not perform: registry generation, data migration, route migration, or runtime integration

## 1. Identity contract

`content_id` is the permanent identifier for one logical dream item across all locales.

- It is immutable and opaque.
- It is assigned once and is never recalculated during normal runtime.
- It is never derived at runtime from a slug, title, array index, locale, content, or date.
- It never changes after assignment and is never reused.
- HY, RU, and EN representations of the same logical item share one `content_id`.
- It is not a public slug and must not be presented as the normal public address.

In short:

```text
content_id = identity
slug       = address
```

## 2. Current identity audit

The current post model has no permanent post-level ID. Every `src/data/posts.json` record has exactly these common fields: `slug`, `title`, `date`, `letter`, `categories`, `content`, `sourceUrl`, and `comments`. The `id` values nested under comments identify comments, not posts.

Current behavior:

- `src/lib/site.ts` builds `postBySlug`, and the catch-all route resolves posts by slug.
- Static post routes are generated from `post.slug`.
- Related-post lookup and internal post links use slug.
- The image fallback checks `<slug>.webp` and `<slug>-1.webp`; image naming is therefore slug-coupled.
- Static admin post endpoints expose the array index as a string `id`.
- The writable admin API parses that `id` as an array index and updates `posts[id]`.
- `sourceUrl` is used by historical import/synchronization tooling, but is not a permanent runtime post ID.

Observed legacy-source invariants on the Stage 3 input:

```text
records                         5800
unique slugs                    5800
unique sourceUrl values         5800
missing/invalid sourceUrl       0
sourceUrl with query or hash    0
sourceUrl origin                https://erazahan.info (5800)
sourceUrl path equals /<slug>/  5800
```

The array index is migration provenance only. It must cease to be an identity after the later admin migration.

## 3. Existing-record assignment (legacy migration v1)

The one-time assignment algorithm is UUIDv5 as defined by RFC 9562.

### Fixed project namespace

```text
ebb2a826-eae8-511a-af05-0acf27425d75
```

This value was deterministically derived once as:

```text
UUIDv5(namespace = RFC DNS namespace, name = "erazahan.info")
```

The committed UUID value above is authoritative. Its derivation is documentation, not an instruction to create a replacement namespace. The namespace is public, version-controlled, non-secret, and permanent for legacy migration v1.

### Seed rule

```text
legacy:v1:<exact original_source_url string as stored in canonical posts.json>
```

For example, the conceptual operation is:

```text
content_id = UUIDv5(
  namespace = ebb2a826-eae8-511a-af05-0acf27425d75,
  name = "legacy:v1:" + exact_original_source_url
)
```

The identity input contract is:

1. Read `sourceUrl` exactly as stored in the canonical `posts.json` record.
2. Validate separately that it is a non-empty, parseable absolute URL using HTTPS on the `https://erazahan.info` origin and has no credentials, query, or fragment.
3. Validation must not transform the value passed to UUIDv5.
4. Do not trim, lowercase, normalize Unicode, decode or canonicalize percent escapes, reserialize the URL, convert backslashes, or normalize trailing slashes.
5. Concatenate the exact stored string after the fixed `legacy:v1:` prefix.

The current 5,800 values already satisfy the validation invariants and are unique. In particular, lower- and uppercase percent-escape spellings remain distinct historical strings and therefore produce different seeds. A duplicate exact seed is a migration error and must stop the dry-run.

The seed does not include array index, current slug as a separate field, title, content, date, category, or locale. Although all current `sourceUrl` paths match the current HY slug, `sourceUrl` is the historical input. Once an ID is written to the registry, the registry is authoritative and the ID must never be recomputed because a URL or slug changed.

## 4. New-item assignment

New logical items created after migration receive UUIDv7 as defined by RFC 9562.

Rationale:

- UUIDv7 is opaque and locale/slug independent.
- Its time-ordered layout is friendlier to indexes than fully random UUIDv4.
- Node's cryptographic random bytes are sufficient to implement the standard layout without a new dependency.
- UUIDv4 remains a technically safe fallback, but is not the selected project policy.

Creation policy:

1. Generate UUIDv7 only when creating a genuinely new logical item.
2. Check the complete immutable assignment registry and the separate lifecycle/tombstone records for collision.
3. On the extremely unlikely collision, generate a new UUIDv7; never reuse or overwrite the existing record.
4. Create locale representations under the already assigned `content_id`.

Time ordering is an operational property, not identity semantics. Changing timestamps or clocks must never modify an assigned ID.

## 5. Permanent registry

Proposed repository path:

```text
src/data/migrations/content-id-registry.v1.json
```

Files under `src/data` are not copied to `dist` automatically. The registry must remain unimported by public/runtime modules unless a later reviewed architecture explicitly requires it. Migration and audit tooling may read it directly from the repository.

Proposed shape:

```json
{
  "schema_version": 1,
  "migration_version": 1,
  "registry_kind": "content-id",
  "project": "erazahan.info",
  "namespace": "ebb2a826-eae8-511a-af05-0acf27425d75",
  "namespace_derivation": "uuidv5(rfc-dns-namespace, erazahan.info)",
  "id_algorithm": "uuidv5",
  "seed_rule": "legacy:v1:<exact original_source_url string>",
  "entries": [
    {
      "content_id": "00000000-0000-5000-8000-000000000000",
      "legacy": {
        "original_array_index": 0,
        "original_hy_slug": "example",
        "original_source_url": "https://erazahan.info/example/"
      },
      "migration": {
        "version": 1
      }
    }
  ]
}
```

The placeholder UUID and entry above demonstrate schema only; they are not registry data and must not be copied into the generated registry.

Required immutable fields are `content_id`, every `legacy` value, and `migration.version`. No mutable lifecycle status, normalized URL, current title, content, date, categories, current locale slugs, derived routes, or hashes belong in this registry.

After registry v1 is generated and accepted, its namespace, seed rule, and assigned IDs are frozen. A materially different future migration requires a new explicit registry/specification version, never a silent rewrite of v1.

## 6. Lifecycle and tombstones

The permanent assignment registry is immutable and retains every assigned `content_id` forever. Operational lifecycle state is stored separately, keyed by `content_id`, and may include:

```text
status = active | tombstoned
```

Allowed transition:

```text
active -> tombstoned
```

The reverse transition requires a separate exceptional recovery policy; it is not a normal content operation. Lifecycle changes never rewrite the immutable assignment registry.

When a logical item is deleted:

- its immutable assignment record remains;
- its `content_id` remains reserved forever;
- a new item never receives that ID;
- every previously published locale slug remains permanently reserved for that same `content_id`;
- route retirement/redirect behavior is governed separately.

Keeping lifecycle/tombstone state separately preserves operational history without mutating the historical assignment map. Collision checks must consult both stores.

## 7. Slugs and aliases

The existing 5,800 HY public URLs remain unchanged during migration. `legacy.original_hy_slug` records their provenance.

Each locale has its own slug/address attached to the same logical `content_id`. After a locale slug is first published, it is stable by default.

Once a locale slug has ever been published for a `content_id`, the pair `(locale, slug)` is permanently reserved for that same `content_id`. It may later be the current canonical slug, a redirect alias, or tombstoned, but it may never be assigned to a different `content_id`. A `content_id` is never reused.

If a published slug changes:

- the `content_id` does not change;
- the previous path becomes a 301 alias;
- the alias points directly to the final canonical path;
- redirect chains are forbidden;
- alias uniqueness and permanent retired-slug reservation are validated independently of content identity.

Image filenames may remain slug-coupled during an intermediate migration, but that coupling never gives a slug identity semantics. A later image migration must preserve references independently.

## 8. `sourceUrl` after migration

For legacy records, `sourceUrl` is historical provenance and the one-time migration-v1 seed source. It is not runtime identity.

- Preserve `original_source_url` exactly in the registry.
- Do not store a normalized form in the immutable assignment registry. Canonicalization diagnostics may appear in a future dry-run report only.
- Existing `posts.json` remains unchanged during Stage 3.
- New content needs a source URL only when genuine provenance exists; a synthetic URL must not be created to generate its ID.
- New content uses UUIDv7, not the legacy UUIDv5 rule.

## 9. Next dry-run invariants

The next stage may generate an uncommitted candidate mapping, but must not mutate `posts.json` or the public build while validating it.

Required checks:

```text
source records                         = 5800
records with sourceUrl                 = 5800
valid exact legacy seeds               = 5800
unique exact legacy seeds              = 5800
duplicate legacy sourceUrl             = 0
unique original HY slugs               = 5800
generated IDs                          = 5800
valid UUIDv5 IDs                       = 5800
unique generated IDs                   = 5800
duplicate generated IDs                = 0
missing IDs                            = 0
collision with assigned/tombstoned IDs = 0
```

Behavioral checks:

- Two runs over identical records produce byte-identical `(sourceUrl, content_id)` mappings.
- Reversing or otherwise reordering the input array does not alter any source-to-ID pair.
- The same exact stored `sourceUrl` always produces the same UUIDv5.
- Mutating title, content, date, category, locale, or array position does not alter the candidate ID while historical `sourceUrl` remains unchanged.
- Every registry entry preserves the original array index, original HY slug, and original `sourceUrl` exactly.
- No generated ID occurs in the immutable assignment registry or separate lifecycle/tombstone records.
- Registry serialization has stable key and entry ordering defined by the dry-run tool.
- The HY baseline verifier passes before and after the dry-run.

Any failed invariant stops the migration. The tool must report the conflicting records and must not repair, deduplicate, or renumber them automatically.

## 10. Stage boundaries

Stage 3 adds only this specification and isolated ID primitives/tests. It does not:

- assign IDs to the 5,800 posts;
- create the permanent registry;
- add `content_id` to `posts.json`;
- change admin identity;
- create locale stores or RU/EN content;
- change routes, images, search, sitemap, HTML, or other public output.
