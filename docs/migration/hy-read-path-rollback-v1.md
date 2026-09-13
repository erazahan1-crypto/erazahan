# HY read-path rollback contract v1

## Scope

This contract covers the reversible HY dictionary read-path selector introduced before any production cutover. It does not migrate admin writes, create RU/EN content, change URLs, or remove the legacy source.

## Selector contract

The single build-time selector is `ERAZAHAN_HY_CONTENT_SOURCE`.

- Unset: `legacy` (the version-controlled default).
- `legacy`: read HY dictionary posts from `src/data/posts.json`.
- `new`: read `ContentItem` plus published `hy.json` from `src/data/content/dreams/` through the legacy-compatible adapter.
- Any other value, including an empty string: fail the build.

Every public consumer receives the same selected `posts` array from `src/lib/site.ts`. Routes, `postBySlug`, related posts, internal links, search, sitemap, visitor indexes, and server-generated admin helper indexes therefore cannot select different HY sources inside one build. Admin data endpoints and writes continue to use `posts.json` directly.

An override must be set intentionally in the local build command, CI job, or Cloudflare build environment and recorded in deployment logs. Production remains unset/`legacy` until a separately approved cutover.

## Compatibility adapter

In `new` mode, content fields come from the published HY locale document: `slug`, `title`, `published_at` as `date`, `alphabet_key` as `letter`, `tags` as `categories`, `content`, and a non-null `description` when present.

The registry supplies historical `sourceUrl`; it is never reconstructed from a slug. The only fields NEW mode reads from legacy `posts.json` are `comments` (joined read-only by registry source URL) and an explicitly present `cover`. Comments are not copied into the new store. The bridge is deterministic because registry order, historical source URL, and legacy slug are checked for every record; it is read-only and parity-preserving. If no explicit legacy `cover` exists, the current slug plus `images.json` resolution remains unchanged. Existing related-post and internal-link algorithms are not replaced. NEW is therefore not a fully independent source during Stage 10A.

## Rollback operation

Rollback from NEW to OLD consists of:

1. Set `ERAZAHAN_HY_CONTENT_SOURCE=legacy` (or remove the override so the default applies).
2. Run a clean production build.
3. Run `node audit/scripts/verify-baseline.mjs` and the store/registry validators.
4. Deploy the verified OLD build through the normal provider workflow.

Rollback does not require restoring a backup, deleting or rewriting the new store, regenerating `content_id`, changing routes, reverting content files, or reconstructing data. The new store, registry, and `posts.json` remain intact. The selector change and validation should take less than ten minutes after the decision, excluding provider build/deploy queues.

Rollback succeeds only when OLD returns to full baseline parity, all protected data hashes remain unchanged, no content is deleted, and no manual data reconstruction is needed.

## Editorial-write risk during the rollback window

The current admin write target remains `src/data/posts.json`. The permanent HY store is a static snapshot and does not update after an admin edit.

If NEW is active, an editor changes HY through the old admin, and rollback then occurs, the edit exists in `posts.json` and becomes visible after rollback but was absent from NEW while NEW was active. A later switch back to the unchanged store would hide that edit again. This is a production-cutover blocker until an explicit write policy is approved.

Recommended pre-cutover policy: freeze HY editorial writes for the entire preview/cutover/rollback observation window. This is the smallest auditable option and avoids implementing unreviewed dual-write behavior. If continuous editing is required, design and validate a controlled old-to-new sync/export after every admin edit before approving production NEW mode. Dual-write requires its own failure and reconciliation design and is not part of this stage.

## First production cutover: editorial freeze and final-sync contract

The approved policy for the first production read-path cutover is **editorial freeze plus final sync**. It is a release-control policy, not a new admin feature and not a dual-write implementation.

### Why the freeze is required

The current HY editor reads and commits only `src/data/posts.json`. Its GitHub write transaction has no write target, acknowledgement, or revision coordination for `src/data/content/dreams/`. The permanent store is therefore a static migration snapshot until a separately controlled import/sync is run.

The following sequence is unsafe without a freeze:

1. The store is synchronized and the NEW reader is enabled.
2. An editor changes a HY entry through the current admin.
3. The edit is committed to `posts.json`, while the permanent store remains at its previous snapshot.

Consequences are reader-dependent:

- **NEW reader:** continues to serve the old store value, so the editorial change is temporarily invisible.
- **Rollback to LEGACY:** reads `posts.json`; the edit becomes visible again.
- **A later NEW deploy without another controlled sync:** serves the old store value again, hiding the edit once more.
- **`source_revision` and fingerprint assumptions:** they describe the synchronized store record, not the later legacy-only edit. Treating them as evidence of current parity after such an edit would be incorrect.

This is not physical data loss while the GitHub commit containing the edit remains available in `posts.json`. It is an operational visibility/staleness risk: the same editorial state can appear, disappear, and reappear as the selected reader changes. It becomes a practical lost-work risk if an editor expects the NEW reader to publish the change, if a later sync is omitted or incorrectly scoped, or if an unsynchronized legacy edit is overwritten during future migration work.

### Cutover procedure and gates

Before the first NEW production deployment:

1. Ensure the required tracked tree state is known and clean for the release process; record all approved Stage 10 changes.
2. Start a HY editorial freeze and communicate that no HY admin saves are permitted.
3. Confirm there are no in-flight, queued, or unresolved admin writes; capture the final `posts.json` state and its approved SHA-256.
4. Run the controlled, one-way `posts.json` to permanent-HY-store sync/import. This sync is not implemented by this contract; it must have its own reviewed procedure, source revision/fingerprint rules, and failure handling.
5. Verify exact parity of the final source and store, including the registry/store/schema validators and old/new parity harness.
6. Build NEW with an explicit selector and require baseline/output parity, including HY routes, search, and sitemap.
7. Verify the LEGACY rollback path from the same final source state before deployment.
8. Enable NEW only through the approved production release workflow, then perform production validation of representative HY routes, search, sitemap, and error/output telemetry.

The freeze begins before the final source capture and stays active through the entire final sync, validation, deployment, and rollback observation window. No HY edit may be accepted during that interval.

### Freeze release condition

The freeze cannot end merely because NEW was deployed. Before any release decision, all of the following must be true:

- the NEW production deployment is healthy;
- representative HY routes, search, and sitemap are healthy;
- there are no unexpected output differences or production errors;
- the rollback observation window has ended and its decision is recorded; and
- a separately approved write-synchronization/admin-migration architecture is active and operationally validated.

The last condition is mandatory. While the current admin writes only `posts.json`, it is **not safe** to end the editorial freeze and keep the NEW reader in continuous production operation. NEW may be exercised briefly under the freeze for the controlled cutover and rollback window, but continued legacy-admin editing with NEW active is not approved.

### Why dual-write is not a Stage 10C remedy

Adding dual-write immediately before cutover would introduce two write targets and a new consistency protocol at the highest-risk point of the release. It would require, at minimum:

- atomicity or explicit reconciliation for partial write failures;
- defined ordering and conflict handling between `posts.json` and the store;
- coordinated `source_revision` and fingerprint updates;
- a durable retry/idempotency model and audit trail;
- rollback semantics that cannot expose conflicting versions; and
- production validation of all of the above.

Those requirements are a dedicated write-path migration, not an incidental cutover patch. The freeze plus controlled final sync is the smallest safe first-cutover policy.

### Readiness distinction

- **Read-path cutover technically ready:** yes, under the editorial freeze and the gates above. The OLD → NEW → OLD build drill established byte-identical baseline output and a tested rollback selector.
- **Continuous editorial operation on NEW:** not yet ready. It remains blocked on the next architecture stage: a reviewed, observable, recoverable write synchronization/admin migration that makes the permanent HY store current after every accepted HY edit.

## Local drill

The required drill is:

1. Explicit OLD clean build and baseline verification.
2. Explicit NEW clean build and byte-for-byte baseline verification.
3. Explicit OLD clean build and baseline verification again.

No NEW artifact from this drill is deployed. The repository default remains `legacy`.
