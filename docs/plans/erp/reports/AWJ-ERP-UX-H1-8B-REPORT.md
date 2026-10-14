# AWJ-ERP-UX-H1-8b — Late review findings and the actual final tree — Implementation Report

STATUS: PR OPEN (see PR for exact-head CI, PRE_MERGE_REVIEW and merge record)
DATE: 2026-10-14
Origin: automated (Codex) review threads on #1438, #1439, #1441 and #1443, found unanswered after the horizon closed · Closure: [H1-8](../AWJ-ERP-UX-H1-8-CLOSURE.md)

## Why this slice exists
Codex posted one finding on #1438, one on #1439 and three on #1443 **before** each merged, but the `PRE_MERGE_REVIEW` records say "Review threads: none open". The threads had not been re-read immediately before merging. Its one finding on #1441 had been fixed before merge (`bc1f56e`) but never answered. This slice answers all six on the code, fixes what is real, and corrects the closure evidence.

## Findings and dispositions
| PR | Finding | Verified? | Disposition |
|---|---|---|---|
| #1438 | The ERP layout's `CardTitleLevel h2` also lifts cards that sit inside a section with its own `h2`, so they become its siblings | **Yes.** `/document-design`: family cards were `h2` next to "Choose a work area" `h2`. A search for the same pattern found one more: the template governance tab (revision history and assignments cards under the tab `h2`). All other files that mix `h2` and `CardTitle` use the `h2` for list-item titles that are siblings of the cards (checked) | **Fixed**: both areas wrap their nested cards in `CardTitleLevel level="h3"` |
| #1439 | The root 404 sends unknown `/platform/...` URLs to `/dashboard`; platform administrators have a separate session, so they end up at the ERP login | **Yes** (`isPlatformAuthenticated()` vs `isAuthenticated()`) | **Fixed**: `/platform` and `/platform/*` link to `/platform` with "Back to the platform console" / «العودة إلى لوحة المنصة» (`notFound.backPlatform`); `/platforms` is not matched. No file under `app/platform/**` or `components/platform/**` changed |
| #1441 | Shared forbidden title as `h1` doubles the page `h1` on Developers pages | Already fixed before merge | Answered on the thread |
| #1443 | The "final" matrix crawled `622783e` + H1-7F, not final `main` (which also has #1419 RBAC/messages and #1411) | **Yes** | **Corrected**: that matrix is relabelled as integration-tree evidence; the actual final tree was re-crawled (below) |
| #1443 | The closure counts its own merge record before it exists | **Yes** | **Recorded**: #1443 → `f8e7ab8` in the state file; closure wording fixed |
| #1443 | `compare.py` turns a missing `results.jsonl` into zeros | **Yes** | **Fixed**: aborts with the missing path |

## Changed files
`web/src/modules/print-templates/components/print-template-center.tsx`, `.../print-template-studio.tsx`, `web/src/app/not-found.tsx`, `web/src/messages/{ar,en}.json` (`notFound.backPlatform`), `docs/plans/erp/h1-8-evidence/tools/compare.py`. Tests: `web/src/app/not-found.test.tsx`, `web/src/modules/print-templates/components/__tests__/print-template-heading-outline.test.tsx` (new). Docs: state file, closure report, both final matrices (one new), 7B and 7D reports (corrections).

## Tests and exact results
- New tests against `main`'s code: **4 failed** (platform 404 ×2, family cards `h3`, governance wrapper); with the fix: **all pass**. Affected suites: 22 files / 162 tests passed.
- Full Vitest on the code commit `f12016a` (`main` `f8e7ab8` + fixes): **570 files / 6,093 tests passed**. Production `next build`: passed.
- Real browser (production build, EN, 1440): `/document-design` outline `H1 Print template center → H2 Choose a work area → H3 Sales, Purchases and suppliers, Finance and vouchers, Inventory and logistics`; `/no-such-page` → `/dashboard` "Back to the dashboard"; `/platform/no-such-page` → `/platform` "Back to the platform console".
- **Actual final tree re-crawl**: `main` `f8e7ab8` + `f12016a`, 1,248 loads (v3 AR 1440, EN dark 1440, AR 390, AR 320, legacy AR 1440, staff role). Same counts as the integration-tree matrix on every audited rule, overflow, heading, message and raw-key metric; only the legacy console-error count changed (28 → 27 routes). [REGRESSION-MATRIX-FINAL-MAIN.md](../h1-8-evidence/REGRESSION-MATRIX-FINAL-MAIN.md).
- `compare.py` with a missing input directory: exits 1 naming the file; with complete input: exit 0.

## Self-review / Guardian
- Reviewer: context-only heading change (no class or text change); 404 change is one `usePathname` check; the docs now describe what was actually verified.
- AWJ Guardian: no accounting, VAT/ZATCA, money, tenant/branch, RBAC/auth, API, schema or infrastructure change; no `/platform` source edited. The re-crawl used a local tenant re-seeded through the public API (the local database had been reset by the session setup). Nothing deployed.

## Not verified
- The governance tab in a real browser: the re-seeded tenant has no saved print template, so the tab cannot be opened; it is covered by the source-level test only.
- Real screen readers, non-Chromium browsers, production.

## Process correction
Before every merge, re-read the PR's review threads at the moment of merging, not only when the review is written.
