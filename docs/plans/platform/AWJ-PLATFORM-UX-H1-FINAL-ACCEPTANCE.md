# AWJ-PLATFORM-UX-H1 — Final Acceptance & Closure Review

STATUS: FOR OWNER DECISION · DOCUMENTATION ONLY · NO APPLICATION CODE CHANGED · NOT MERGED · NOT DEPLOYED · H1 NOT CLOSED
Date: 2026-10-14 · Reviewer: Claude (implementer of H15-03…H15-11; this review is therefore a self-review plus real-environment evidence, not an independent one)

Base SHA (origin/main reviewed): `22f2ee50bf8ef8592aeab0a352f3bd11b9a1d7b7` (merge of H15-11, PR #1414)
Head SHA: the commit of this documentation PR (recorded in the PR).

## 1. Decision

**READY WITH EXPLICIT WAIVERS REQUIRED.**

- **No BLOCKER** was found: nothing proves a functional, security or accounting failure on `main`. Authentication, platform/tenant separation, money and data integrity behaved correctly in every executed check.
- **One new serious accessibility finding** was found on `main` that earlier slices did not catch (§5 N1) and **one new usability finding** (N2). Neither is a security or accounting defect; both need an owner decision (waive, or fix in a separate slice) before H1 is declared closed.
- Several deferred items remain (§5). None is accepted automatically; each is assessed and needs an explicit waiver or a scheduled follow-up.
- Real screen readers, Firefox, WebKit and the browser's native zoom were **not** verified (not available here). H1 cannot be called fully accessibility-verified without them or an explicit waiver.

It is **not** "READY FOR OWNER ACCEPTANCE" because of N1 and the unverified items, and it is **not** "NOT READY — BLOCKERS" because no proven blocker exists.

## 2. What H1 delivered (all merged on `main`)

H1-1 specification (#1312) · pagination (#1318) · contrast (#1328) · H1-2 shell (#1355) · H1-3 dashboard (#1358) · H1-4A tenants (#1362) · H1-4B tenant detail (#1366) · H1-4C pricing (#1368) · H1-4D integrations (#1372) · H1-4E documents (#1375) · H1-5 verification report (#1377) and its two P1 fixes (#1376: retention dry run, integrations control names).
Follow-ups from the H1-5 findings, all frontend unless noted: H15-05 duplicate price blocked in the UI (#1378) · H15-04 expired session on export (#1379) · H15-10 storage test names its target (#1383, small backend change) · H15-03 tenant picker reaches every tenant (#1386) · H15-08 tenant-detail select name and scroll region (#1391) · H15-07 dashboard `dl` semantics (#1395) · H15-09 text scaling at 200% (#1399) · H15-06 missing application names (#1406) · H15-11 heading order (#1414). The backend `401` without `Accept` was fixed separately in #1392 (R1).

## 3. How this review was done (executed vs not)

Real environment: Laravel built by `setup.sh` from `main` @ `22f2ee50` (SQLite, isolated test data: 2 platform administrators, 8 tenants, 1 test price), Next.js dev server, Chromium via Playwright, axe-core 4.10.2 (not a web dependency). No production system, credential or external provider was touched. Mocked tests are not counted as evidence below unless stated. Two checks used request delaying on a real backend (loading state): marked.

## 4. Acceptance matrix

| # | Area | Result | Evidence (executed on `22f2ee50`) |
|---|---|---|---|
| 1 | Navigation and the 6 console pages + login load | **PASS** | 224 loads (7 routes × AR/EN × light/dark × 320–1920 px): exactly one `h1`, correct `dir`, correct theme, no redirect to login, 0 console errors apart from the known `IntlError` noise (H15-17), **0 page-level horizontal overflow**. 70 landscape loads: same. |
| 2 | Tenants / prices / integrations / documents — read paths and API contract | **PASS** | All pages render real data; tenant list/detail, price list, integrations, document operations load; price create 201; retention dry run `{"dry_run":true,"apply":true}` → 202. |
| 2b | Same pages — UI write flows (plan, trial, contract dialogs, secret saves, exceptions, retention apply) | **NOT RE-VERIFIED today** | Verified in H1-5 and the H15 slices on a real backend; not re-executed on `22f2ee50`. Not counted as a pass for this review. |
| 3 | Authentication, permissions, tenant isolation | **PASS** | 12 real API checks: valid login 200; wrong password 422; inactive admin 403; no token / bad token 401 (JSON, **with and without `Accept`**); tenant token on platform routes 403; platform token on `/partners`, `/invoices`, `/me` 403; platform read with valid token 200. PHP subset (`Platform`, catalogue, application, auth patterns): 278 passed, 2 failed in `StorefrontMedia*` (image-processing environment limit of this container, unrelated; the same suite family is green in CI). |
| 4 | Arabic / English, RTL / LTR | **PASS** | All matrix loads checked for `dir`, theme and a single `h1`; axe run in both languages; AR/EN headings and names verified in H15-06/H15-11 tests. |
| 5a | Accessibility — automated | **FAIL (1 finding)** | axe 4.10.2 (wcag2a/aa, 2.1, 2.2 aa, best-practice) on 48 loads (6 routes × AR/EN × 1280/390 × 100%/200% text): **only** `scrollable-region-focusable` (serious) on `/platform/prices` at 200% text, 1280 px, EN and AR (N1). Login page: 8 combinations, **no violations** (first axe run of the login page; H1-5 had not scanned it). `heading-order`, `label`, `select-name`, `definition-list` are gone. |
| 5b | Accessibility — keyboard | **PASS** | 70 real Tab stops × 6 routes × AR/EN: the skip link is first, **0 stops on headings**, 0 disabled stops, focus rings present (the only ring-less stops are the Next.js dev overlay, dev-only). Dialog trapping and Escape were verified in H1-5 and not repeated. |
| 5c | Accessibility — screen readers | **NOT VERIFIED** | None available. |
| 5d | Firefox / WebKit / native browser zoom | **NOT VERIFIED** | Chromium only; zoom was emulated (font-size preference, viewport). |
| 6 | Small screens and text scaling | **PASS with residuals** | Widths 320–1920 and landscape: no page overflow. Real default-font-size 200% on 96 loads: no page-level overflow; one data-dependent clipping (N2) and the 320/350 px residuals recorded in H15-06 (not re-run at 320/350 today). The "wide element" heuristic flagged 60 loads (widths) and 24 (landscape), and 12 of the 13 text-scaling flags, all of them the closed, `inert` off-canvas navigation drawer in RTL (not visible, no scroll), not defects; the 13th is N2. |
| 7 | Loading, failure, retry | **PASS** | Loading: skeleton/busy state present on 12/12 (6 routes × AR/EN) with the real backend's responses delayed 4 s (interception used only to delay). Failure: the real backend was stopped; every page showed a translated alert and a retry control; after the backend returned, retry recovered **12/12** (6 routes × AR/EN). The tenants page has two independent loaders: the page-level "Try again" reloads the list only; the global-controls card recovered with its own Refresh (works, but two actions). |
| 8 | CI on `main` after the merge | **PASS** | `CI` run 38495336871 and `Web CI` run 38495336974 on `22f2ee50`: `success`. |
| 9 | Local suites on `main` | **PASS** | Web: 550 files / 6001 tests; `tsc --noEmit`: 48 errors = recorded baseline; `next build`: exit 0. The full Laravel suites were **not** run locally (CI is the evidence). |
| 10 | Backend items deferred earlier | see §5 | — |

## 5. Remaining items: BLOCKER / DEFER / VERIFY

**BLOCKERS: none.**

### New findings in this review

| ID | Class | Finding | Evidence | Impact and recommendation |
|---|---|---|---|---|
| N1 | **DEFER — owner decision** (accessibility, serious) | Price-history table: horizontally scrollable region with no focusable content at 150–200% text (WCAG 2.1.1) | axe `scrollable-region-focusable` at 200%/1280 and 200%/1024, 150%/1024, EN+AR; DOM: `div[data-awj-grid-scroll].overflow-x-auto`, `scrollWidth 793 > clientWidth 606`, 0 focusable children; evidence image `h1-final-evidence/prices-history-200pct-1280.png` | A keyboard-only user at large text cannot scroll the table; columns are cut off. Mouse/touch users are fine. Data-dependent (needs price rows; earlier runs had none). Same pattern as H15-08, which was fixed for the tenant-detail table only. Recommended: a separate small slice applying the H15-08 pattern to the shared grid scroller, or a waiver. The shared `DataTable` may affect other pages (not measured). |
| N2 | **DEFER** (P3, usability) | Tenant card at 390 px and 200% text clips the account number, owner name and email with an ellipsis | `h1-final-evidence/tenants-card-390-200pct-en.png`; real-preference measurement: `Account number: 1000006` spans beyond the viewport; earlier runs had no account numbers so this was not seen | The full text is in the DOM (screen readers read it) but a sighted large-text user on a phone cannot read the account number. No page scroll. Waive or schedule. |

### Previously deferred backend items

| Item | Class | Evidence today | Assessment |
|---|---|---|---|
| Backend `401` without `Accept` returned a 500 HTML page | **RESOLVED** | Real calls without `Accept` on `/platform/overview`, `/platform/tenants`, `/platform/prices` → 401 JSON | Fixed on `main` by #1392. Not a remaining item. |
| Concurrent duplicate price version returns 500 | **DEFER — waiver required** | Real: a second POST of the same `(plan, currency, effective_on)` → HTTP 500. With `APP_DEBUG=true` the message exposes the SQL; **with `APP_DEBUG=false` (production mode, executed) the body is `{"message":"Server Error"}` with no SQL.** The UI blocks a known duplicate (H15-05) | No data is corrupted (the database unique key holds). Impact: an administrator in a two-tab/two-admin race sees a generic error. Needs a backend change (validation 422/409): outside this review. |
| Tenants list ordering has no tie-break | **DEFER + VERIFY** | `PlatformTenantService` orders by `created_at` descending only; timestamps are second-resolution; in the test data 8 tenants have only 4 distinct `created_at` values (ties exist). Paging was consistent on SQLite (ties resolve by row id). **Not reproduced on PostgreSQL** (not run here). | Risk: on PostgreSQL a tenant created in the same second as another could repeat or be skipped between pages. Platform-only, read-only listing. Verify on PostgreSQL before relying on it; fix is a one-line backend tie-break (needs approval). |
| Retention dry run: backend rejects `{"dry_run":true}` | **DEFER** | Real: `{"dry_run":true}` and `{"dry_run":true,"apply":false}` → 422; the UI's body `{"dry_run":true,"apply":true}` → 202 and stays a dry run | The workaround is in place and verified; the root-cause fix is a backend validation change awaiting approval. |

### Carried P3 items (from H1-5), status on `main`

| ID | Class | Status |
|---|---|---|
| H15-17 | DEFER | `IntlError INVALID_KEY` is logged on **every** page (12/12 loads executed). Console noise (and the Next.js dev "Issues" badge); not user-visible in production. |
| H15-12 | DEFER | Server messages remain Arabic-only on the English UI (confirmed on the login error from the API); not re-tested in the UI. |
| H15-13 (comma amount read as grouping), H15-14 (apply confirmation stays ticked), H15-16 (targets under 44 px), H15-15 (no confirm on Save plan / End trial) | **VERIFY / owner decision** | Not re-tested today; no merged change addresses them (each slice report lists them as not started). H15-15 is a recorded spec decision. |
| 320/350 px at 200% text residuals (H15-06 report) | DEFER | Shell header cluster, summary tiles and one button on tenant detail/tenants; not re-run today (matrix ran at 390 and 1280). |

### Not verifiable here (VERIFY before or as an explicit waiver)

Real screen readers; Firefox; WebKit; native browser zoom; the production build served with a production backend; real R2/ClamAV/AI providers and document operations with real documents; stale-response guard under out-of-order latency; PostgreSQL-specific behaviour (ordering above); the full Laravel suites locally (CI is the evidence).

## 6. Residual security and functional risk

- **Security:** none found. Authentication, token separation (platform vs tenant), read/write abilities and the secrets handling (verified in H1-5) behaved correctly in every executed check; the 500 on a duplicate price exposes SQL only with `APP_DEBUG=true` (a debug setting) and is generic in production mode.
- **Functional:** N1 (keyboard scrolling of one table at large text), N2 (large-text clipping on phones), the two-action recovery on the tenants page, the duplicate-price 500 race, and the unverified PostgreSQL ordering tie.
- **Accounting:** none; no financial calculation, journal or invoice path was touched by H1. The dashboard figures were checked against the API in H1-5.

## 7. Items that need Safwan's explicit decision

1. **N1** — waive, or approve one small follow-up slice (recommended before closure because it is a serious axe rule).
2. **N2** and the 320/350 px 200% residuals — waive or schedule.
3. **Duplicate price 500 race** — approve a backend change or waive.
4. **Tenants ordering tie-break** — approve the backend tie-break and/or a PostgreSQL check, or waive.
5. **Retention dry-run validation** — approve the backend root-cause fix or keep the verified workaround.
6. **H15-12…H15-17** — waive as a P3 bundle or schedule; **H15-15** is already an owner decision.
7. **Unverified environments** (screen readers, Firefox, WebKit, native zoom, production serving) — waive for H1 or schedule a manual pass.
8. Whether to count this review, performed by the same agent that built H15-03…H15-11, as sufficient or to ask for an independent reviewer.

## 8. Closure recommendation

Do **not** close H1 yet. Close it after Safwan explicitly (a) accepts or schedules N1, N2 and the deferred backend items, and (b) accepts the unverified environments or runs them. If he prefers not to carry N1, the smallest path is one frontend slice (H15-08 pattern on the shared scroller) followed by a re-run of the 48-load axe pass. No deploy or production release is implied by this document.

## 9. Tests and results (executed on `22f2ee50`)

| Check | Result |
|---|---|
| Width matrix (7 routes × AR/EN × light/dark × 8 widths = 224 loads) | 0 overflow, 0 console errors, 1 `h1` each, `dir`/theme correct; 60 heuristic flags = closed `inert` drawer in RTL |
| Landscape (70 loads) | 0 overflow; flags = the same drawer |
| Text scaling, CSS override 150/200% (56 loads) | 0 page overflow; 1 element beyond the viewport at 200%/390 EN tenants (N2) |
| Text scaling, real browser font-size preference 100/200% (96 loads) | no page-level overflow; findings equal the H15-09 baseline except the data-dependent N2 (see §5) |
| axe 4.10.2, 6 routes × AR/EN × 1280/390 × 100/200% (48 loads) | only N1 |
| axe, login page 8 combinations | no violations |
| Keyboard Tab walk, 6 routes × AR/EN × 70 stops | skip link first; 0 heading stops; 0 disabled stops |
| Loading (12) / failure with real backend stopped and retry (12) | 12/12 and 12/12 |
| API auth/isolation matrix | 12/12 as expected |
| Duplicate price in production mode | 500, body `Server Error`, no SQL |
| PHP subset on SQLite | 278 passed, 2 failed (`StorefrontMedia*`, container image-processing limit, unrelated) |
| Web suite | 550 files / 6001 tests passed |
| `tsc --noEmit` | 48 errors (baseline) |
| `next build` | exit 0 |
| CI `main` @ `22f2ee50` | `CI` and `Web CI` success |

## 10. Next step

Safwan reviews this document and the two evidence images (`docs/plans/platform/h1-final-evidence/`), then decides the items in §7. No merge, deploy, production release or closing of the H1 Horizon happens without his explicit approval.
