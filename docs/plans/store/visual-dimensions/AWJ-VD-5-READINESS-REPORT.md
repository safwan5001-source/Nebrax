# AWJ-VD-5 — Readiness Report (final browser QA of the visual dimensions)

STATUS: **READY TO START — waiting for the owner's go-ahead.** VD-5 has not started.
DATE: 2026-10-15
HORIZON: AWJ-COMMERCE-VISUAL-DIMENSIONS-H1 · slice VD-5 (H1-5)
AUTHORITY: the owner asked on 2026-10-15 for this report after VD-3, VD-4b and VD-4c, and before any final test. Nothing in this report starts VD-5, deploys, or changes code.

## 1. Where the horizon stands

| Slice | What it delivered | PR | Merge SHA | Post-merge CI |
|---|---|---|---|---|
| VD-0 | Evidence, architecture, decisions | — | `d5dfa16` | PASS |
| VD-1a | Visual contract: normalizer, resolver, registry (PHP + two TS twins) | — | `8801af9` | PASS |
| VD-2 | Shape engine, `FacetVisualTile`, `IconPicker` | #1482 | `d568bf6` | PASS |
| VD-4a | Discovery display keys and 7 templates | #1490 | `c57f4be` | PASS |
| VD-1b | Storage and admin API (versioned, `expected_version`) | #1491 | `5a10930` | PASS |
| VD-1c | Public `meta.facets` visual, guarded image route, proxy, N1–N19 | #1499 | `b1b7988` | PASS |
| VD-4c | Builder controls for the discovery section | #1507 | `2b77747` | PASS |
| VD-4b | Storefront discovery renderer (5 layouts) | #1508 | `f1e309e` | PASS |
| VD-3 | Admin visual editor | #1509 | `d628288` | __PMR__ |

Every slice was reviewed by a separate reviewer before merge. The three UI slices (VD-3, VD-4b, VD-4c) changed no API, database, permission, security or tenant behaviour. BL-001 (a known pgsql row-order flake in `VatAdjustmentRoutingTest`) is recorded outside the horizon; it failed once on #1499's first head (the next commit passed) and once on #1508 (the job passed on its single re-run), with no product defect.

## 2. What is already proven, and by what

| Area | Proven by | Where the proof stops |
|---|---|---|
| Contract and inheritance (D-08) | Shared fixtures run by PHP, web and storefront; resolver tests | Logic only, not a rendered page |
| Admin API, versions, isolation | PHP feature tests on SQLite and pgsql, two-process pgsql races (VD-1b) | Real signed thumbnails were not loaded in a browser |
| Public projection and image route | N1–N19, tenant and sales-channel isolation, mutation checks (VD-1c) | The route was exercised through Laravel's test client, not through the real Next proxy |
| Storefront renderer | 280 Chromium captures of a harness: 35 cases × 390/768/1280/1440 × ar/en (VD-4b) | A harness that stubbed the server modules, not a hydrated Next page |
| Admin editor | 304 captures against a stubbed `fetch`; permission matrix and 409/428/422 paths in tests (VD-3) | No real Laravel API, no real signed URLs, no physical iOS safe area |
| Builder controls | Captures at 390/768/1280, ar/en, light/dark (VD-4c) | The panel preview follows VD-4b's rules by reading its code, not by comparing renders |
| Whole web suite with all three UI slices | 627 files, 7155 tests passed on `main` + VD-3 | Unit and component level |

**The common gap:** each slice was verified in isolation with stubs. VD-5 is the first time the whole chain runs together — admin editor → API → public meta → proxy → storefront page — in a real browser.

## 3. Proposed VD-5 scope

### 3.1 Environment (reusing the method of `AWJ-STORE-CTX-3-QA-REPORT.md`)
- A local stack: Laravel 11 from `setup.sh`, a throwaway SQLite database in a temp folder, `next dev` for `web/` and `storefront/`, Chromium. No production data, no deployment.
- Seeding through the public API only (register, enable applications, create stores, facets, values, products, listings, uploads through the real media endpoint), as CTX-3 did. No direct database writes except to inject a corrupt state on purpose (a soft-deleted media row, a foreign `mediaId`).
- A second run of the guarded-route and meta checks against pgsql, which is available locally.

### 3.2 Scenarios
- **Round trip:** create a dimension and values in the admin editor, upload images, pick shapes, save, then see them on the storefront with the chosen section template.
- **The 12 shapes × image/icon/text** on the real storefront page.
- **Legacy data:** an existing store with no visuals and no display keys renders exactly as before.
- **Failure and fallback:** media not ready, soft-deleted media, an image that fails to load, a value with no products, a deactivated value or dimension, an unpublished product — each in the browser, with the cache window in mind.
- **Long Arabic names** (40 characters and more) in the editor list, the editor, the storefront and the builder preview.
- **Roles:** owner, accountant (`products.manage` without `commerce.manage`), a read-only user, `self_service`; in each, what the editor shows and which requests are made.
- **Two stores of one tenant:** a value visible on store A only must not appear, nor its image load, through store B.
- **Concurrency in the UI:** two browser tabs editing the same value (409/428 message and reload).
- **Cache window:** an image served through the proxy, withdrawn at the origin, and observed for the 300-second window; a conditional request after it must get the 404.

### 3.3 Matrix
- Widths 390 / 768 / 1280 / 1440; Arabic RTL and English LTR.
- Admin in light and dark; the storefront in light only (storefront dark mode is out of scope, D-13).
- A keyboard-only pass over the editor, the builder panel and the storefront discovery section. A real screen-reader pass is not available in this environment and is listed as not done unless the owner provides one.

### 3.4 Cross-slice parity checks (the ones no slice could do alone)
- The builder panel preview against the real storefront render, for each layout and template.
- The admin editor preview against the storefront tile for the same document.
- The owner's reference concept images (circles, arches, rounded squares) against what is rendered.

### 3.5 Items carried over from the slices
- Overlay captions on 56px (`sm`) frames clamp to two lines (VD-4b).
- `valueSort: count` ranks only within the first 40 values (VD-4b).
- The signed admin preview link lives 20 minutes; an editor left open longer shows "failed to load" (VD-3).
- Choosing "inherit" on a value removes its image and icon on save, with no per-choice undo (VD-3).
- "Reset all" in the builder is one click and relies on builder undo (VD-4c).
- The builder preview follows the admin language for text direction because the builder exposes no store direction (VD-4c).
- Hydration behaviour of the discovery section on real Next (VD-4b).
- A physical iOS safe-area check (VD-3) — cannot be done here; will be reported as not verified.

## 4. Entry criteria

| Criterion | State |
|---|---|
| VD-3, VD-4b, VD-4c merged on `main` | Yes |
| Post-merge CI on `main` (PHP sqlite + pgsql, Web CI, Storefront CI) | __PMR_DETAIL__ |
| No open review thread or blocking finding on any slice | Yes |
| Environment can run Laravel, Next and Chromium | Yes, as in CTX-3 |
| Any API, database, permission or security change needed | None known; if VD-5 finds one it stops at a Decision Gate |

## 5. Method, outputs and rules for VD-5
- A QA report in the style of `AWJ-STORE-CTX-3-QA-REPORT.md`: tested commit, environment, matrix with pass/fail per row, network inspection (which store and tenant each request carried), defects with severity, and what stayed unverified. Screenshots go to an evidence folder next to it.
- Defects are fixed only inside the existing UI slices' scope, in small separate PRs with regression tests that fail before the fix. A defect that needs an API, database, permission or security change is reported and waits for the owner.
- No production deployment, and no change to accounting.

## 6. Risks
- **Environment drift:** the stack is local and seeded by the public API, so it can miss production-only behaviour (CDN, real R2 signed URLs, custom domains). The report will say so; a staging pass is the owner's call.
- **Image bytes:** the first real image load goes through the media service and R2 mocks or a local disk driver; real R2 latency is not covered.
- **Scope creep:** the visual review will surface taste issues. They are logged as improvements, not defects, unless they break the owner's accepted contract or an accessibility requirement.

## 7. Decisions requested from the owner
1. **Go-ahead** to start VD-5 as described.
2. **Committed automated tests:** `web/e2e` and `storefront/e2e` already hold Playwright specs. Should VD-5 commit a small, deterministic Playwright spec for the round trip and the image-withdrawal case, or deliver evidence and the report only? Recommended: commit one focused spec per app, because the chain has no end-to-end test today.
3. **Staging:** whether a staging pass on real infrastructure should follow VD-5 before any release (a separate decision; VD-5 does not deploy).
4. **BL-001:** whether to fix `VatAdjustmentRoutingTest` in a separate, approved accounting-test PR before the final CI of this horizon, or leave it in the backlog.
