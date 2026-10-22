# IMP-H1-S8c — "إصلاح الصفوف الفاشلة" UI step

**Branch:** `claude/imp-h1-s8c-repair-ui` · **Depends on:** S8a, S8b · web, plus one review-driven backend correction to S8b (child option freezing)

## Evidence (External Evidence / AWJ Decision)

Text-level research only — **no screenshots were viewed** (the available search tools return text, so the protocol's visual-inspection requirement was not met for this slice; the UI is deliberately a minimal panel inside the existing import result card, reusing existing components and tokens, to keep that gap small).

| External evidence | Source |
|---|---|
| Failed rows are never committed and successes stay; the guide says to download a failed-rows report and re-import **only the corrected rows** — re-uploading the whole file turns already-imported records into update matches with fresh errors | DualEntry, *fix a failed bulk import* (docs.dualentry.com/accountants/integrations/fix-a-failed-bulk-import) |
| Status distinguishes **Partial Success** from Error; export only the errored rows; reruns skip rows that already succeeded | Frappe/ERPNext data import docs (docs.frappe.io/framework-git/data-import) |
| Error-file pattern: same layout as the original import plus an **error message column**, edited and re-imported with the same mapping | Highview EZ Importer (highviewapps.com/blog/download-errors-in-ez-importer) |
| Shopify's own product import tells the user to fix and retry; no official per-row error download was found | Shopify community/help results (unverified for product imports) |

**AWJ decision:** failed rows download as XLSX with the original headers, an error column and protected `_awj_*` columns; upload the same file back; the server validates membership and claims units — the client holds no repair state. **Not adopted:** a row-by-row in-browser editor (out of scope; spreadsheets are the existing editing surface) and re-importing the whole file.

## Changes (web)

- `client.ts`: `ImportJob` gains `parent_job_id` and `failed_units` (server fields from S8a/S8b); `downloadImportFailures(id)` (always `format=xlsx`) and `createRepairJob(parentId, file, key?)` (multipart: only `file` + optional idempotency key — domain, branch and options come from the parent).
- `useImportJobEngine.repair()`: creates the child and makes it the screen job; on refusal the failed parent stays on screen with the server's message (stable `repair_ref_*` messages), so the repair step is not lost.
- `ImportRepairPanel` (shared; renders only for `status === 'failed'` **and** `failed_units > 0`, which the server reports only for row-unit domains): count, three-step instruction, download and upload buttons (disabled while busy), and a note about the protected `_awj_` columns and blank cost columns for users without the cost permission. AR + EN strings under `importJobs`.
- `ImportJobStatusPanel`: "تشغيلة إصلاح" badge for child jobs.
- `/products/import` (the only row-unit domain today): wires download and `repairFailedRows` → `engine.repair` → `applyLoop(child.id, …)` with the page's own apply options (the original column mapping is reused when the file is still in the session; otherwise the server auto-maps by header, which the failures file keeps).

## Independent review (read-only subagent) — findings and disposition

Verified by the reviewer: `failed_units` reaches the panel on every failure path (apply 422 → refetch via `getImportJob`, network-uncertain refetch, resume from `?job=`); no `inFlight` race between `repair()` and `applyLoop()`; AR/EN key parity.

| # | Finding | Disposition |
|---|---|---|
| 1 | **Real (S8b semantic gap):** a repair child took the page's *current* options on its first chunk, overriding the inherited ones — a failed `update`/`upsert` run reopened from `?job=` would be repaired as `create` | **Fixed server-side:** a repair child's options are frozen at creation from its parent (like a preview-bound job) and a conflicting explicit option is rejected (`options_frozen`); the page now sends `{}`. Tests: child inherits `upsert`, explicit `create` is refused, a body-less apply completes; **negative control** (freezing off) fails it |
| 2 | `apply_product_images` could be sent with no archive on the child | **Fixed:** a repair child always runs with image options off (no archive is part of a repair); images for repaired rows are added through the normal product-image flow. Tested |
| 3 | A failed download was an unhandled rejection; demo outcome ignored | **Fixed:** errors surface in the page error banner; `demo-unavailable` shows the existing toast |
| 4 | After a repair the parent disappears (`?job=` becomes the child); parent units left out of the corrected file are unreachable | **Mitigated:** the child's status panel offers "عرض التشغيلة الأصلية" (reopens the parent and its repair panel); tested |
| 5 | The hidden file input stayed focusable / announced twice | **Fixed:** `aria-hidden` + `tabIndex=-1`; `aria-busy` on the panel. (A live-region announcement for busy/error remains the page's existing error `role="alert"`) |
| 6 | No idempotency key on repair | **Fixed:** deterministic key per parent+file (name/size/mtime) so a retry after a lost response returns the same child |
| 7 | Weak tests (no `failed_units` via the 422 path, no child-option coverage) | **Added** the 422-refetch test and the backend option/image tests. A page-level orchestration test is not added (the page is large; covered indirectly) |
| Minor | `{count}` plural in English; render gap between `setJob(child)` and `applyLoop` | English now uses ICU plural; the gap is cosmetic (one frame) and left as is |

## Safety

One small backend correction rode along (finding 1/2, in `ImportJobService`/`ImportRepairService`; no migration, no env, no accounting/ZATCA/AI change); everything else is web. The panel is inert unless the server says a failed job has repairable units.

## Tests / verification

- vitest: `ImportRepairPanel` (4: visible conditions, hidden for completed / zero / undefined / processing, handlers, disabled while busy), engine (`repair` success and refusal keeps the parent), client (repair multipart contract, XLSX download path) — 21 passing in `src/modules/import-jobs`; products-area suites 68 passing.
- `npm run build` succeeds. `tsc --noEmit` shows only pre-existing errors in unrelated test files (one in this module's older test, untouched lines).
- Not covered: no browser/E2E run and no visual review (see Evidence note).
