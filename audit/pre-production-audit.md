# Pre-Production Audit — erazahan-astro → erazahan.info

**Date:** 2026-09-07
**Scope:** New Astro site only (old WordPress historical junk is explicitly out of scope per instructions). Nothing was committed, pushed, or auto-fixed. This is a read-only audit.

**Method:** Two full production builds were run locally (`npm run build`), once with default env (indexing disabled) and once with `PUBLIC_ALLOW_INDEXING=true` (indexing enabled). Both `dist/` outputs were archived to `_buildcheck/default` and `_buildcheck/allow` and scanned with a purpose-built Node.js scanner ([audit/scripts/audit-dist.mjs](scripts/audit-dist.mjs)) that walked all 5,922 generated HTML files. Raw data backing this report is in [audit/audit-summary.json](audit-summary.json), [audit/broken-links.csv](broken-links.csv), [audit/external-domains.csv](external-domains.csv), [audit/suspicious-content.csv](suspicious-content.csv).

---

## 1. Build & Routes — PASS

- `npm run build` (default, indexing disabled): **exit code 0**, **5,922 pages built** in ~40s.
- `npm run build` with `PUBLIC_ALLOW_INDEXING=true`: **exit code 0**, **5,922 pages built** in ~48s.
- Only one build message, a `[WARN]`, no errors:
  > `Skipping src/pages/search-index.json.ts because a file with the same name exists in the public folder: search-index.json`
  See §12 for why this matters.
- Route spot-check, all present in both builds:
  - `/` (home) ✅
  - Dream posts, e.g. `/erazahan-abba/`, `/erazahan-achq/`, `/erazahan-tsov/` ✅
  - Letter pages, e.g. `/ա/`, `/բ/`, `/գ/` (single-Armenian-letter directories) ✅
  - `/erazahan-online/` and its ~30 sub-letter pages (`/erazahan-online/erazahan-a-tar/`, etc.) ✅
  - Static pages: `/about/`, `/karevor-taretver/`, etc. ✅
  - `/search/` ✅
  - `/404.html` (custom 404, verified content) ✅
  - `/robots.txt`, `/sitemap.xml`, `/search-index.json` ✅

**Verdict: PASS.** No build errors. One non-blocking warning (see §12, MEDIUM).

---

## 2. Internal Links — PASS (after correcting scanner false positives)

Scanned all `href`/`src` attributes in all 5,922 HTML files (excluding `<script>` block contents, which produced initial false positives from a client-side search-page template literal).

- **Broken internal links: 0 real.** One flagged item is cosmetic only: the 404 page's `<link rel="canonical">` / `og:url` point to `https://erazahan.info/404/` (trailing-slash style), while the file is served as bare `/404.html`. Canonical tags on error pages have no SEO effect (404 pages aren't indexed), so this is **LOW**, not a real broken link.
- **WordPress technical URLs found in dist output: 0** (`/feed/`, `/tag/`, `/wp-*`, attachment URLs) — none of the new site's own links point to these.
- **Links to pages.dev: 0.**
- **`javascript:` / suspicious URLs: 0.**
- `/search/` is intentionally not part of internal content-link graph issues — it's a utility page, not a broken link.

**Verdict: PASS.**

---

## 3. Security / Hack Residue — 1 CRITICAL, 1 HIGH found

This is the most important section given the domain's WordPress compromise history. Full source (not just rendered HTML) was also grepped for `<script>`, `eval(`, `atob(`, event handlers, etc.

### CRITICAL — Live leftover Google AdSense script embedded in one post's content, and it corrupts that page's meta description
File: `src/data/posts/Երազահան-Ծով-Erazahan-Cov.json` → renders at **`/erazahan-tsov/`**.

The imported WordPress content field contains a raw, still-active ad snippet:
```html
<script async src="//pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script>
<ins class="adsbygoogle" data-ad-client="ca-pub-5643826611292152" data-ad-slot="1162807933"></ins>
<script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
```
Because post content is injected via `set:html` in [src/pages/[...path].astro](../src/pages/[...path].astro) with no sanitization, **this script tag will execute in visitors' browsers on the live erazahan.info domain**, pulling a third-party ad script tied to an old, no-longer-controlled AdSense publisher ID (`ca-pub-5643826611292152`).

It gets worse: `stripHtml()` in [src/lib/site.ts](../src/lib/site.ts) only strips HTML *tags* (`replace(/<[^>]+>/g, ' ')`) and does not remove `<script>` element *content*. As a result the literal JS code `(adsbygoogle = window.adsbygoogle || []).push({});` leaks into:
- the page's `<meta name="description">` (verified in built HTML), and
- `search-index.json` (the site search index — this text is shown to users in on-site search results).

This is exactly the "old WP hack residue" pattern the task asked to watch for (uncontrolled third-party script surviving in imported content). It is isolated to **one post out of 5,921**, but it is live, executing code on a page that will be served on the real domain after migration.
**Fix is trivial** (remove the ad snippet from that one JSON file, and/or make `stripHtml` strip `<script>`/`<style>` element content, not just tags) — flagging as CRITICAL because of "executes 3rd‑party JS + corrupts SEO metadata" combination, not because it's hard to fix.

### HIGH — Outbound "backlink" injected into 69 posts, pointing to an unrelated Russian dream-site over plain HTTP
69 post JSON files under `src/data/posts/` contain content where the brand word "**Երազահան**" itself is hyperlinked to an external, unrelated site:
```html
<h2><a href="http://son-nik.ru/" target="_blank" rel="noopener">Երազահան</a> Ականջօղ Ծախել</h2>
```
- Domain: `son-nik.ru` (a Russian-language "sonnik"/dream-interpretation competitor site), plain **HTTP**, not HTTPS.
- Pattern: every occurrence of the site's own brand name in these 69 posts is wrapped in a link to this outside domain instead of pointing internally — a textbook injected/spam backlink pattern of the kind associated with a compromised WordPress install.
- This is not executing code and is not currently flagged as malware/adult/gambling — the target site itself was not evaluated for current safety and should be treated as untrusted until reviewed.
- Full list of the 69 affected files/pages is in [audit/broken-links.csv](broken-links.csv) is not applicable here (these aren't broken, they're unwanted); see grep results referenced in this audit or re-run: `grep -r "son-nik.ru" src/data/posts/`.

**Recommendation:** strip/replace these 69 `<a href="http://son-nik.ru/">` wrappers (keep the plain text "Երazahan") before or shortly after migration. Not a hard technical blocker (the links aren't broken, they don't execute anything), but they will go live on the real domain carrying a suspicious outbound link pattern the moment DNS cuts over — HIGH priority to fix before or immediately after cutover.

### Everything else checked — PASS
- `eval(`, `new Function(`, `document.write(`, `atob(` / base64 blobs: **0 occurrences** anywhere in dist.
- `<iframe>` anywhere in dist: **0**.
- Inline event handlers (`onclick=`, `onerror=`, `onload=`, etc.) in rendered HTML: **0**.
- Hidden/offscreen elements (`display:none` / `position:absolute` + text) used as SEO-spam containers: **0** (one benign `aria-hidden` decorative emoji on the 404 page, not a spam pattern).
- Gambling/adult/pharma spam text, crypto-mining scripts, unknown analytics/trackers: **0** found.
- Cloudflare Function `functions/api/dreams.ts`: server-side only, calls `formsubmit.co` **only if an operator sets `DREAMS_EMAIL`**, otherwise no outbound call. Reviewed, no issues.

### External domains inventory (all contexts, all 5,922 pages)

| Domain | Count | Context | Assessment |
|---|---|---|---|
| erazahan.info | 5,922 | `<link rel="canonical">` | Trusted — the site itself |
| **son-nik.ru** | 69 | `<a>` in post content | **Suspicious — see HIGH finding above** |
| en.wikipedia.org | 16 | `<a>` in post content | Trusted reference link |
| hy.wikipedia.org | 9 | `<a>` in post content | Trusted reference link |
| hy.wiktionary.org | 9 | `<a>` in post content | Trusted reference link |
| ru.wikipedia.org | 3 | `<a>` in post content | Trusted reference link |
| qahana.am | 1 | `<a>` in post content | Armenian church-related site, low-traffic single reference — requires a quick manual look but no red flags found |

(Full data: [audit/external-domains.csv](external-domains.csv))

---

## 4. SEO Basics — PASS

Sampled 45 pages across every page type (home, 404, search, static "about", `erazahan-online` hub, 15 dream posts, 10 single-letter pages, 15 "name meaning" pages). For every sampled page:

- **Exactly one `<h1>`** — 45/45 pages. ✅
- **Title present and non-empty** — 45/45. ✅
- **Meta description present and non-empty** — 45/45 (one page's description is polluted by the AdSense leak from §3 — tracked there, not a separate SEO bug). 
- **Canonical present and correctly points to `https://erazahan.info/...`** in the production (`PUBLIC_ALLOW_INDEXING=true`) build — 45/45, including Armenian-letter routes where it's correctly percent-encoded (e.g. `https://erazahan.info/%D5%A1/` for `/ա/`). ✅
- **Canonical never points to pages.dev** — confirmed across all 5,922 pages (0 occurrences of pages.dev anywhere in dist). ✅
- **Canonical is not the same URL for every page** (i.e., not all collapsed to the homepage) — confirmed unique per page. ✅
- **Open Graph `og:url` matches canonical** on every sampled page. ✅
- **`lang="hy"`** set correctly on `<html>` for every page. ✅
- **`robots` meta matches build mode**: absent in the `PUBLIC_ALLOW_INDEXING=true` build, present (`noindex, nofollow`) in the default build — verified on home page and a dream post (`/erazahan-ez/`). ✅

**Verdict: PASS.**

---

## 5. Robots / Sitemap — PASS (with one MEDIUM hygiene item)

**A. Default build (no `PUBLIC_ALLOW_INDEXING`):**
```
User-agent: *
Disallow: /
```
`<meta name="robots" content="noindex, nofollow">` present on every sampled page. ✅

**B. `PUBLIC_ALLOW_INDEXING=true` build:**
```
User-agent: *
Allow: /
Disallow: /keystatic
Disallow: /api/

Sitemap: https://erazahan.info/sitemap.xml
```
`noindex` meta absent. ✅ Sitemap URL correctly targets `erazahan.info`. ✅

**Sitemap content (`/sitemap.xml`, allow-indexing build):**
- **5,987 `<loc>` entries total**, **5,920 unique URLs**.
- Host: **100% `erazahan.info`** — 0 pages.dev, 0 `/feed/`, 0 `/tag/`, 0 `wp-admin`/`wp-json`/`wp-login`, 0 404 URLs. ✅
- **Every sitemap URL resolves to a real file in `dist`** — 0 missing. ✅
- `/search/` is intentionally excluded from the sitemap (it's a utility page, not indexable content) — expected behavior, not a bug.
- **MEDIUM — 67 URLs are listed twice** in the sitemap (5,987 − 5,920 = 67 duplicate `<loc>` entries). Root cause: 67 "male/female names starting with letter X" hub pages (e.g. `/արական-անուններ-սկսվող-բ-տառով/`) exist simultaneously as static entries in `src/data/pages.json` **and** are independently regenerated as `nameLetterPages` in [src/lib/site.ts](../src/lib/site.ts); `src/pages/sitemap.xml.ts` emits both. The page itself builds correctly as a single file (no routing conflict) — this is purely a sitemap-generation duplication, not a broken page. Search engines will silently de-duplicate this, but it should be cleaned up for hygiene (skip `nameLetterPages` paths that also exist in `pages` when building the sitemap, or vice versa).

**Verdict: PASS**, with one MEDIUM item to clean up (67 duplicate sitemap entries).

---

## 6. Assets — MEDIUM (16 broken images), otherwise PASS

- All CSS/JS/font references resolve correctly; the two files under `dist/_astro/` (`Layout.*.css`, `client.*.js`) both exist. ✅
- No `localhost`, `127.0.0.1`, `file://`, or Windows drive-letter (`C:\`) paths anywhere in dist. ✅
- No Vite dev client (`@vite/client`) or `sourceMappingURL` comments in dist. ✅
- No `.js.map` / `.css.map` files shipped. ✅
- **MEDIUM — 16 broken local image references** (`/uploads/2016/...`, `/uploads/2017/...`, `/uploads/2019/...`) — these are `<img>`/inline references to original WordPress media-library files that were never migrated into `public/uploads/`. Full list in [audit/audit-summary.json](audit-summary.json) (`brokenAssets`). These produce real broken `<img>` icons on the affected posts today.
- One additional entry in the same list, `//pagead2.googlesyndication.com/pagead/js/adsbygoogle.js`, is not actually a broken local asset — it's the external AdSense script from the CRITICAL finding in §3 (protocol-relative URL misclassified by the asset-existence check; not a separate issue).

**Verdict: no security issue, but MEDIUM — fix or remove the 16 dangling `/uploads/...` image references before/soon after migration** (either restore the images from the WordPress media export or strip the broken `<img>` tags from the affected post content).

---

## 7. Images — PASS

- Post/dream cover images (`[...path].astro`) correctly use `loading="eager"`, `fetchpriority="high"`, explicit `width`/`height`, and `decoding="async"` — appropriate for above-the-fold LCP images. ✅
- Homepage "popular posts" thumbnail grid uses `loading="lazy"` (correct, they're below the primary hero) but **does not set explicit `width`/`height`** — minor CLS risk. **LOW.**
- `alt` text present on all `<img>` tags checked (post title used as alt). ✅
- No broken images from the *new* site's own template code — the 16 broken images in §6 come from historical `/uploads/...` references inside imported content, not from the Astro templates.

**Verdict: PASS**, with one LOW cosmetic item (missing width/height on homepage thumbnails).

---

## 8. Performance Regressions — PASS

- **Google Fonts:** 0 references to `fonts.googleapis.com` / `fonts.gstatic.com` anywhere in dist. Fonts are self-hosted (`/fonts/noto-*-armenian.woff2`), preloaded with `crossorigin`. ✅
- **Client JS:** only 2 files under `dist/_astro/`: a ~41 KB CSS bundle and a ~187 KB `client.*.js`. The JS file **is not referenced by any of the 5,922 HTML pages** (0 matches when searching for its filename in dist) — it's an unused/orphaned React runtime chunk emitted because `@astrojs/react` is registered in `astro.config.mjs` but no `.astro` file actually uses a `client:*` hydration directive anywhere in `src/`. **It costs visitors nothing today** (never fetched), but it's dead weight in the deployment and a sign the React integration isn't currently needed — **LOW**, safe to leave for now, worth removing later to shrink the deploy artifact.
- **No hydrated interactive components** — confirmed zero `client:load`/`client:idle`/`client:visible`/`client:only` usages in `src/`. ✅
- **No render-blocking external resources** — the only external `<link>`/`<script>` references found are the two Wikipedia/Wiktionary content links (non-blocking `<a>` tags) and the one AdSense script already flagged in §3. ✅
- **No new render-blocking JS/CSS regressions detected** relative to a typical static Astro build.

**Verdict: PASS.**

---

## 9. Old WordPress Residue — PASS (new site's own code is clean)

- `/wp-admin/`, `/wp-login.php`, `/wp-json/`, `/xmlrpc.php`, WordPress `<meta name="generator" content="WordPress ...">`, `wp-content/`/`wp-includes/` paths, WordPress feed `<link rel="alternate" type="application/rss+xml">`, and REST-API discovery links: **0 occurrences anywhere in the 5,922 generated pages.** The new site's own templates and routing carry no WordPress plumbing.
- Cloudflare `wrangler.jsonc` and `functions/api/` show no WordPress-era endpoints.
- The **only** WordPress-era residue found lives *inside imported content*, not in site infrastructure:
  - 1 leftover `[caption id="attachment_19834" ...]...[/caption]` WordPress shortcode, visible as literal text on **one page** (`/aqis-tesnel-erazum/`). **LOW/cosmetic** — no `[gallery]`, `[vc_*]`, `[elementor_*]`, or `<?php` tags found anywhere else in the entire `src/data/posts/` dataset or `posts.json`.
  - The AdSense script (§3, CRITICAL) and the `son-nik.ru` backlinks (§3, HIGH) are also content-residue from the old WordPress export, already covered above.

**Verdict: PASS for site infrastructure.** Content-level residue is limited to the 3 items already called out above (1 CRITICAL, 1 HIGH, 1 LOW) — no broad contamination.

---

## 10. HTTP / Cloudflare Readiness — PASS, informational notes only

- `astro.config.mjs` sets `site: 'https://erazahan.info'` — canonical/OG URLs and sitemap already target the production domain regardless of where it's currently deployed (pages.dev). ✅
- `wrangler.jsonc` is configured with `pages_build_output_dir: "./dist"` and a bound D1 database (`erazahan-dreams`) — consistent with a Cloudflare Pages + Functions deployment. ✅
- Trailing-slash / URL shape is consistent: all content routes build as `.../index.html` directories (trailing-slash style), matching the canonical URLs Astro emits. No mixed trailing-slash inconsistency observed.
- No `_redirects` or `_headers` file present in `public/` — **not a problem today** (no redirect loops, because there are no redirects at all), but note that: (a) no explicit cache-control headers are set (Cloudflare Pages defaults will apply), and (b) if any legacy WordPress URL → new URL redirects are wanted later, they'll need to be added via `public/_redirects`.
- Per instructions, **no** `pages.dev → erazahan.info` 301 redirect exists or was added — correct, since the primary domain isn't attached yet.
- HTTPS: enforced by Cloudflare Pages platform by default; nothing in the app forces `http://` anywhere except the flagged `son-nik.ru` outbound link (§3).

**Verdict: PASS**, nothing here blocks attaching the custom domain.

---

## 11. Content Sanity — PASS (2 known exceptions already tracked above)

Sampled 50+ pages across dream posts, letter pages, name-meaning pages, static pages, and hub pages:
- No empty `<body>` / empty content areas found.
- Armenian text renders correctly (UTF-8 throughout; percent-encoding only appears correctly in URLs, not in on-page text).
- No stray HTML-entity garbage (`&amp;#8217;`-style double-encoding) found beyond normal, correctly-encoded entities.
- No unprocessed WordPress shortcodes except the single `[caption]` instance already flagged in §9.
- No `<?php` tags anywhere in content.
- No hacker/spam content (gambling, pharma, adult, malware droppers) found in any sampled or scanned page.

**Verdict: PASS**, modulo the two already-tracked content issues (§3 AdSense script, §9 `[caption]` shortcode).

---

## 12. Summary of Findings by Severity

### CRITICAL — must fix before switching the domain
1. **Live third-party AdSense script embedded in `/erazahan-tsov/` post content**, executing in visitors' browsers and leaking JS code into that page's `<meta name="description">` and into `search-index.json`. (§3)
   - Fix: remove the `<script>`/`<ins>` ad snippet from `src/data/posts/Երazahan-Ծов-Erazahan-Cov.json`, and harden `stripHtml()` in `src/lib/site.ts` to strip `<script>`/`<style>` element *content*, not just tags (defense in depth against any other undiscovered instance).

### HIGH — should fix before or immediately after migration
2. **69 posts contain an injected outbound link** wrapping the brand name "Երazahan" in `<a href="http://son-nik.ru/">`, pointing to an unrelated third-party (Russian) dream-interpretation site over plain HTTP. Classic backlink-injection pattern. (§3)
   - Fix: strip these `<a>` wrappers (or replace with plain text) across the 69 affected files under `src/data/posts/`.
3. **16 broken image references** (`/uploads/2016/...`, `/uploads/2017/...`, `/uploads/2019/...`) pointing to WordPress media files that were never migrated, causing visibly broken images on the affected posts. (§6)
   - Fix: either recover/copy the missing files into `public/uploads/` from the WordPress export, or strip the broken `<img>` tags from the affected content.

### MEDIUM — can fix shortly after launch
4. **Sitemap.xml lists 67 URLs twice** (name-letter hub pages exist both as static `pages.json` entries and as generated `nameLetterPages`). Doesn't break anything, but should be de-duplicated in `src/pages/sitemap.xml.ts`. (§5)
5. **`search-index.json.ts` endpoint is silently shadowed** by the static `public/search-index.json` file (build warning). Counts currently match (5,800 posts both places), so search works correctly today — but if post content changes without regenerating the static file, search results will silently go stale. Recommend removing the now-dead `src/pages/search-index.json.ts` (or removing the static file and letting the dynamic endpoint own the route) to eliminate the footgun. (§1, §12)

### LOW — cosmetic / optional
6. One leftover WordPress `[caption]...[/caption]` shortcode visible as literal text on `/aqis-tesnel-erazum/`. (§9)
7. 404 page's canonical/OG URL is `https://erazahan.info/404/` while the file is served as `/404.html` — cosmetic only, 404 pages aren't indexed. (§2)
8. Homepage "popular posts" thumbnail images lack explicit `width`/`height` (minor CLS risk; they're correctly `loading="lazy"`). (§7)
9. An unused ~187 KB React client bundle is emitted to `dist/_astro/` (from the `@astrojs/react` integration) but is never referenced by any page — zero runtime cost today, but worth removing the integration later if it stays unused, to shrink the deploy artifact. (§8)
10. No `_headers`/`_redirects` file — fine as-is (no redirects needed yet), but worth adding explicit cache-control headers later. (§10)
11. `qahana.am` external link (1 occurrence) — no red flags found, but wasn't independently verified as currently safe; quick manual check recommended out of an abundance of caution. (§3)

### PASS
- Build (§1), Internal links (§2), SEO basics (§4), Robots/sitemap correctness (§5, aside from the MEDIUM dedup item), Assets other than the 16 images (§6), Image loading strategy (§7), Performance (§8), WordPress infra residue (§9), Cloudflare/HTTP readiness (§10), Content sanity (§11).

---

## Metrics Requested

| Metric | Value |
|---|---|
| `npm run build` (default, indexing off) | **Success**, exit 0, 5,922 pages, 1 non-blocking warning |
| `npm run build` (`PUBLIC_ALLOW_INDEXING=true`) | **Success**, exit 0, 5,922 pages, 1 non-blocking warning |
| Pages checked (HTML files scanned for links/security) | **5,922** (100% of dist) |
| Pages deep-checked for SEO tags (sampled) | **45** |
| Pages spot-checked for content sanity | **50+** |
| Broken internal links | **0** real (1 cosmetic canonical mismatch on 404 page) |
| Suspicious external domains | **1 confirmed suspicious** (`son-nik.ru`), 1 unverified-but-not-flagged (`qahana.am`), out of **7** total external domains |
| WordPress residue patterns found (site infra) | **0** |
| WordPress residue patterns found (imported content) | **3** (AdSense script, son-nik.ru links, 1 `[caption]` shortcode) |
| Sitemap URLs (indexing-enabled build) | **5,987** total / **5,920** unique |
| Sitemap URLs without a matching dist page | **0** |
| Sitemap duplicate URLs | **67** |
| Broken local asset references | **16** (all legacy `/uploads/...` images) |
| `git diff --stat` | *(no output — no tracked files were modified; only new untracked `audit/` and `_buildcheck/` folders were added by this audit)* |

---

## Final Verdict

# NOT READY TO MIGRATE (yet) — but very close

The site is technically solid: build is clean, routing/sitemap/robots/SEO/performance/Cloudflare readiness all pass. The blockers are narrow, content-level, and fast to fix — not architectural.

### Exact blockers to clear before attaching erazahan.info:
1. **[CRITICAL]** Remove the live AdSense `<script>` snippet from the `/erazahan-tsov/` post content (and ideally patch `stripHtml()` to strip script/style content as a safety net).
2. **[HIGH — strongly recommended before cutover]** Strip the 69 `son-nik.ru` outbound links injected into post content.
3. **[HIGH — strongly recommended before cutover]** Fix or remove the 16 broken `/uploads/...` image references.

Everything else (sitemap duplicates, the shadowed search-index endpoint, the cosmetic 404-canonical, missing thumbnail dimensions, the unused React bundle) is MEDIUM/LOW and safe to address on a normal post-launch schedule.

Once items 1–3 are fixed and re-verified, this audit's findings would support a **READY TO MIGRATE** verdict.

---

*No files were modified, committed, or pushed as part of this audit. Awaiting confirmation before making any changes.*
