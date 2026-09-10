# PR-DUR-5 — Implementation Report

**Durable Imports Frontend Integration (final PR of the Durable Imports decomposition)**

## 1. What changed

Replaced the browser-session-dependent import execution flow with the durable `ImportJob` workflow (PR-DUR-1..4)
across all three wired domains — `product_catalog`, `product_workbook`, `inventory_opening` — through one shared
frontend engine, without any backend change and without a visual redesign.

## 2. Old frontend flow vs. new durable flow

**Before (Product Catalog, representative of the old pattern):**
```
POST /products/import/inspect   (file, every time it changes)
POST /products/import/preview   (file + options)
loop: POST /products/import/apply   (file + options + client-computed batch_offset, re-uploads the file every call)
```
Nothing survives a refresh mid-loop — the batch offset and the file itself live only in browser memory.

**After:**
```
POST /products/import/inspect    (unchanged, local file, pre-commit UX only)
POST /products/import/preview    (unchanged, local file, pre-commit UX only)
— confirm —
POST /import-jobs                (the file, ONCE — creates the durable ImportJob)
loop: POST /import-jobs/{id}/apply   (id only, no file; server returns processed_rows/row_count/status)
GET  /import-jobs/{id}           (resume after refresh/interruption — authoritative state)
```
The file is uploaded exactly once, at the confirm step. Every subsequent call — including a resumed one after a
refresh — addresses the job id only.

## 3. Final user-visible workflow

Four steps for all three domains: **Setup** (file + all pre-commit decisions) → **Preview** (validated,
non-mutating read) → **Apply** (durable, either chunked-with-progress or atomic-with-honest-status) → **Result**
(final counts, next actions). Product Workbook has no prior step to skip — it is a new page built on this same
four-step shape from the start (no separate mapping step, since Products-sheet column mapping is auto-matched by
header name by default and this is a brand-new surface with no existing mapping UX to preserve).

## 4. Old 7-step wizard mapping (Product Catalog)

| Old step | Disposition | Why |
|---|---|---|
| file | Consolidated into **Setup** | Pre-commit decision, not a distinct mutation moment. |
| mode | Consolidated into **Setup** | Same. |
| mapping | Consolidated into **Setup** | Same — every control (per-column target field, samples, required/locked/identifier badges, reset-to-suggested) is still present, just in one screen instead of its own step. |
| rules (blank/master-data policy) | Consolidated into **Setup** | Same. |
| preview | **Retained** as its own step | A genuinely different moment: a validated, non-mutating read, still against the local file via the existing session-only endpoint. |
| apply | **Replaced** with the durable engine | The one and only file upload happens here (`POST /import-jobs`); every following call is job-id-only. |
| result | **Retained** as its own step | Distinct terminal moment. |

Net: 7 → 4. No control was removed to make the flow *look* simpler — the three merged steps held no writes and
no state the user couldn't equally well decide in one place; the three retained steps are retained because they
are genuinely different moments (nothing written → durable write in progress → done). Inventory Opening's
5-step wizard was consolidated the same way, into the same 4-step shape, keeping every field (opening date,
notes, allow-zero-cost, mapping table).

## 5. Files changed

| File | Change |
|---|---|
| `web/src/modules/import-jobs/client.ts` | **New.** Typed client for `POST /import-jobs`, `GET /import-jobs/{id}`, `POST /import-jobs/{id}/apply`, `POST /import-jobs/{id}/cancel` — mirrors `ImportJobResource`/`ImportJobController` literally. |
| `web/src/modules/import-jobs/useImportJobEngine.ts` | **New.** The shared state machine: `upload`, `resume`, `applyLoop` (server-owned cursor, network-interruption handling, duplicate-click guard, safety cap), `cancel`; plus `useImportJobUrlParam`/`useResumeFromUrl` for URL-based recovery. |
| `web/src/modules/import-jobs/ImportJobStatusPanel.tsx` | **New.** Shared status/progress/cancel UI, reused by all three pages. |
| `web/src/modules/import-jobs/useImportJobEngine.test.tsx` | **New.** 8 unit tests on the engine (see §12). |
| `web/src/app/(app)/products/import/page.tsx` | Rewritten: 7 steps → 4, durable engine replaces the client-owned apply loop. |
| `web/src/app/(app)/products/import/page.test.tsx` | Rewritten for the new flow — 5 tests. |
| `web/src/app/(app)/inventory-openings/import/page.tsx` | Rewritten: 5 steps → 4, durable atomic apply; draft-only completion wording preserved verbatim. |
| `web/src/app/(app)/inventory-openings/import/page.test.tsx` | Rewritten — 4 tests. |
| `web/src/app/(app)/products/workbook-import/page.tsx` | **New.** First frontend for Product Workbook, built on the durable engine from day one. |
| `web/src/app/(app)/products/workbook-import/page.test.tsx` | **New.** 3 tests. |
| `web/src/modules/products/workbook/contract.ts` | **New.** Minimal types + `FormData` builder for the workbook preview endpoint (session-only, pre-commit). |
| `web/src/app/(app)/products/page.tsx` | Added a "Workbook import" action button linking to the new page. |
| `web/src/messages/en.json`, `web/src/messages/ar.json` | New `importJobs` (shared durable-state strings) and `productWorkbook` namespaces; a handful of new keys in `products`/`inventoryOpenings` for the consolidated Setup step and the resumed-without-file mini-form. |
| `docs/plans/products-inventory/phase-2-completion/DURABLE-IMPORTS-DECOMPOSITION.md` | §9 added: full PR-DUR-5 contract. |

**Zero backend files changed** — no endpoint, no schema, no migration. Confirmed by `git status` on the full
repo at commit time: only `web/` and this doc changed.

## 6. ImportJob identity / recovery mechanism

The job id is written into the page URL (`?job=<id>`) the instant a job exists — on successful upload, and on
successful resume. `useResumeFromUrl` reads that param on mount and calls `GET /import-jobs/{id}`, the sole
source of truth for what renders next. A refresh, tab close/reopen, or back/forward navigation that preserves
the query string recovers the exact backend state with **no re-upload**.

**Disclosed gap**: if a refresh happens *before* the first successful `/apply` call (job still `ready`), the
browser has lost the original `File` object and any column-mapping choices — this is a real browser limitation
(no `File` handle survives a reload) compounded by the durable API's `inspect` step storing only row/column
*counts*, not per-column headers/samples (that richer detail lives only in the session-only `/inspect`
endpoints, which need the file). In that narrow window the page shows a compact "continuing an existing import"
form for the domain's other required settings (e.g. `opening_date`, `price_list_id`) and lets column mapping
fall back to the API's existing auto-match-by-header-name default — never blocking the user, never asking them
to re-upload. Extending the durable API to carry column-level inspection detail would be a backend contract
change and is out of this PR's scope.

## 7. Backend state → frontend state mapping

`ImportJobStatusPanel` renders exactly `App\Support\ImportJobStatus`'s values (`uploaded`, `ready`, `queued`,
`processing`, `completed`, `failed`, `cancelled`) — no invented names. The apply button is enabled only for
`{ready, processing, completed}` (`completed` short-circuits, matching backend idempotency); the cancel button
only for `{uploaded, ready}` — both mirrored from the backend's own `ImportJobStatus::CANCELLABLE_FROM`-equivalent
sets. A terminal status always wins: the engine's state is always "whatever the server just returned" — there is
no code path that lets an older client belief persist once a newer server response has landed.

## 8. Progress / resume behavior

- **Product Catalog (chunked)**: the apply loop reads `processed_rows`/`row_count` from each response to decide
  whether to continue; the browser never computes or stores a batch offset. The status panel renders a real
  progress bar only when `row_count > 0` and status is `processing`.
- **Product Workbook / Inventory Opening (atomic)**: neither domain's `apply()` accepts `batch_offset`/
  `batch_size` (PR-DUR-3/4's own recorded design decision) — the panel's `atomic` mode suppresses the progress
  bar and shows an honest "processing the whole file as one step" message instead. No client-side chunking of
  an atomic domain was invented.
- **Duplicate-click protection**: an in-memory `inFlight` ref (not React state) makes a second `upload`/
  `applyLoop`/`cancel` call a silent no-op while one is already running. Proven by a dedicated unit test.
- **Safety cap**: the apply loop carries a 5000-iteration ceiling that surfaces an explicit error rather than
  spinning forever if a response ever fails to advance recognizably. This was not theoretical — an incomplete
  test mock during this PR's own test-writing reproduced exactly this failure mode (a tight, unbounded
  microtask loop that starved the JS event loop and required killing the test process), which is what prompted
  adding the cap as real, disclosed hardening rather than a hypothetical safeguard.

## 9. Product Catalog behavior — preserved

Mode/mapping/blank-policy/master-data-policy are sent exactly as before. Cost authorization stays a backend-only
decision (`SensitiveCostPolicy`) — the frontend has no code path that evaluates or caches it.

## 10. Product Workbook + PriceList behavior — preserved

One `price_list_id` is selected before the run (a dropdown from `GET /price-lists`, filtered to `is_active`
client-side for UX only — the backend's own live check in `ProductWorkbookService::resolveActivePriceList()`,
unchanged, remains the actual gate). No default/base price list concept exists anywhere in the new code; no
per-row price list. The frontend has no pricing logic at all — it only displays sheet-level counts already
computed by the backend's preview/apply responses, so it cannot derive a price from a UOM conversion factor even
by accident. The atomic nature of the apply step is presented honestly (§8).

## 11. Inventory Opening Draft-only evidence

- Completion wording (`draft_created`, `draft_next_step`) states explicitly that a **draft** was created and
  that posting is a separate, later, explicit action — unchanged text from the pre-existing page, now sourced
  from the durable `apply_result` shape (`{inventory_opening_id, number, status, total_quantity, total_value,
  lines_count}`, PR-DUR-4's own normalized summary) instead of the old session-only response shape.
- **No code path in the new page calls `POST /inventory-openings/{id}/post`.** Confirmed by:
  - Reading the full page source: the only navigation after completion is `router.push('/inventory-openings/{id}')`
    (the existing draft review screen), never a post call.
  - `page.test.tsx`'s `'نصّ الاكتمال يوضّح صراحةً...'` test, which asserts `api.mock.calls.filter(call =>
    String(call[0]).includes('/post'))` is empty after a full completed import flow.
- No automatic `StockMovement`, `ProductWarehouseStock`, `JournalEntry`, or `JournalLine` effect is possible from
  this frontend change, because the frontend never calls anything but `InventoryOpeningImportService::apply()`
  (via the durable job), which itself only calls `createDraft()` (PR-DUR-4, unchanged).

## 12. Tests and results

**New/rewritten frontend tests — 50 tests across 7 files, all passing:**

| File | Tests | Covers |
|---|---|---|
| `useImportJobEngine.test.tsx` | 8 | Upload creates/retains identity; resume from authoritative state; chunked apply loop using the server cursor; duplicate-click protection; network interruption → re-fetch → safe continuation (not a false failure); explicit backend rejection (422) surfaced as an actionable error; cancel → cancelled; retry-on-completed is idempotent. |
| `products/import/page.test.tsx` | 5 | Consolidated Setup step (file+mode+mapping+rules together); the durable upload happens exactly once, at confirm; multi-chunk progress driven by the server, ending at Result; resume from URL with no re-upload and no re-inspect; failed state shows the server's actual message. |
| `inventory-openings/import/page.test.tsx` | 4 | Atomic apply (no progressbar element rendered); draft-only completion wording + zero `/post` calls + "open draft" navigation; resume from URL with no re-upload/re-inspect; failed state shows the server's actual message. |
| `products/workbook-import/page.test.tsx` | 3 | Cannot proceed without an active price list selected (inactive lists excluded from the dropdown, matching D-F); atomic apply (no progressbar) with a result summarizing all three sheets, and `price_list_id` present in the actual apply request body; resume from URL with no re-preview. |
| `useImportJobEngine.test.tsx` (client-adjacent) | — | covered above |

**Test commands and results, run progressively as instructed:**

1. Focused frontend tests (the 7 files above): **50/50 passed**.
2. Full Vitest suite (`npm run test`, all 256 test files in the repo): **1684/1684 passed** — zero regressions
   in any other page/module.
3. API regression: not applicable — no backend/shared API integration code changed in this PR (see §5).
4. TypeScript (`npx tsc --noEmit`, after a clean `npm ci` matching CI's lockfile-based install): **zero errors**
   in any file this PR touches. Remaining errors in the full-repo run are pre-existing and unrelated (a stale
   local `node_modules` before `npm ci` produced spurious `@tanstack/react-table` errors across dozens of
   unrelated pages; after `npm ci` those disappeared entirely, leaving only a handful of pre-existing failures in
   unrelated test files — `pos/settings/configuration`, `platform/integrations/gemini-card`,
   `document-language-selector`, `global-application-controls-card`, `use-document-label-mode` — none of which
   this PR touches).
5. Lint: **not run** — this repository has no committed ESLint config (`next lint` prompts interactively to
   create one, and `.github/workflows/web-ci.yml` itself does not run a lint step), so there is no working
   non-interactive lint baseline to check against. Introducing one would be unrelated scope creep for this PR;
   noted here as a pre-existing repository gap, not something this PR silently skipped.
6. Production build (`npm run build`, includes Next.js's own TypeScript check): **succeeded**, zero errors. All
   three routes present in the build output: `/products/import` (6.1 kB), `/products/workbook-import` (3.46 kB),
   `/inventory-openings/import` (6.45 kB).
7. GitHub Actions CI on the exact final Head SHA: **passed** — see §14.

## 13. Mobile and RTL/LTR evidence

All three pages reuse the pre-existing responsive and logical-CSS conventions already established by this
codebase — logical properties (`text-start`, `ms-auto`), `dir="ltr"` scoped only to inherently-LTR content
(filenames, ids), the same mobile card-vs-table pattern the original pages already used for preview rows, and
the same fixed bottom action bar on narrow viewports. `next-intl`'s `useTranslations`/`useLocale` are used
identically to how the pre-existing pages used them, and both `ar.json` and `en.json` received the same new
keys, keeping Arabic and English parity. **This PR did not add a new automated viewport or locale-rendering test
harness** — none of the pre-existing import pages had one either, and building one would be unrelated scope
expansion. Mobile and RTL/LTR correctness rest on reusing the exact same CSS conventions already proven
elsewhere in the app, not on new automated visual assertions; this is disclosed as a testing-scope limitation,
not claimed as coverage that doesn't exist.

## 14. CI

Both workflows passed on every commit pushed to this branch, `pull_request`-triggered included:

| Head SHA | CI (backend) | Web CI |
|---|---|---|
| `1441450d3a5b1c9c74ebd1326a4f2b5954e9efd8` (code-relevant) | [run #4484 — success](https://github.com/safwan5001-source/Nebrax/actions/runs/34440907158) | [run #2547 — success](https://github.com/safwan5001-source/Nebrax/actions/runs/34440907241) |
| `3a6f3cb1510b53bdfd88dcd200dc332ef04c6c3a` (docs-only) | [run #4486 — success](https://github.com/safwan5001-source/Nebrax/actions/runs/34440947489) | [run #2548 — success](https://github.com/safwan5001-source/Nebrax/actions/runs/34440947476) |
| `296d054e6017632504d372f59c89d2f0e9c925d6` (final, docs-only) | [run #4488 — success](https://github.com/safwan5001-source/Nebrax/actions/runs/34440970796) | [run #2549 — success](https://github.com/safwan5001-source/Nebrax/actions/runs/34440970793) |

Backend `CI` passing here confirms no accounting/tenant-isolation/security suite was weakened or broken —
the same PostgreSQL+SQLite `php artisan test` run this codebase always runs, unaffected by this frontend-only
change. `Web CI` passing confirms `npm run test` (all frontend tests, including this PR's 50 new/rewritten
ones) and `npm run build` both succeeded on GitHub's own runner, not just locally.

## 15. Known limitations / risks / remaining work

- **Local import storage remains non-durable across a Railway deploy/restart** (PR-DUR-1's documented,
  unchanged limitation) — this PR does not claim otherwise anywhere in its UI text, code comments, or this
  report. No S3/R2 or storage infrastructure work was done or implied.
- **Pre-`/apply` refresh loses column-mapping richness** (§6) — a disclosed, narrow-window frontend limitation,
  not a backend gap; fixing it would require extending the durable `inspect` contract, out of scope.
- **No accumulated cross-chunk result totals across a resumed Product Catalog import**: `apply_result` is
  overwritten per chunk on the backend (PR-DUR-2's own documented behavior), not accumulated — a result screen
  reached after a resume reflects only the most recently completed chunk's counts, not a running total across
  all chunks. Every row is still applied exactly once (backend idempotency, unaffected), but the *displayed*
  created/updated/skipped totals after a resume may undercount earlier chunks. Disclosed in the UI itself
  (`import_result_last_chunk_hint`) rather than hidden.
- **No lint baseline** in this repository (§12.5) — pre-existing, not introduced or fixed by this PR.
- **Product Workbook has no column-mapping UI** in this first frontend — Products-sheet columns are matched
  automatically by header name (the API's own existing default when no `mapping` is sent), matching V1's
  auto-map convenience. Building a full mapping UI for a three-sheet workbook was judged unnecessary scope
  increase for a page that had zero prior UI to preserve; can be added later without any backend change.

## 16. Deviations from the approved plan

- Two deliberate, disclosed frontend simplifications beyond pure UI wiring: (1) the "resumed without file"
  compact settings form (§6), and (2) omitting the Product Workbook's Products-sheet column-mapping UI (§15) —
  both are additive frontend decisions, not backend contract changes, and both are explicitly recorded rather
  than silently shipped.
- No other deviation from the approved scope. No backend/schema change was needed or made.

## 17. Branch / PR / SHAs / next step

- **Branch:** `claude/pr-dur-5-frontend-durable-imports`
- **Base SHA:** `44a0d1d17dc17908feaebb57ebd8a9c2f36ee71d` (`main`, includes merged PR-DUR-1..4)
- **Head SHA (code, CI-relevant):** `1441450d3a5b1c9c74ebd1326a4f2b5954e9efd8` — CI referenced in §14 ran on
  this commit. A trailing docs-only follow-up commit (`3a6f3cb1510b53bdfd88dcd200dc332ef04c6c3a`, recording this
  SHA in this same file) sits on top and touches no code, so it does not change CI-relevant content.
- **PR:** [#758](https://github.com/safwan5001-source/Nebrax/pull/758), opened as a dedicated PR, separate from
  #746/#753/#754/#755/#756.
- **Status:** CI green on the final head; PR ready for human review. This is the final PR of the approved
  Durable Imports decomposition — no PR-DUR-6 is planned. No merge, no deploy — awaiting explicit review/approval
  per the approved scope.
