# IMP-WIZARD-STATE-01b — Older wizards adopt the shared engine guards

**Branch:** `claude/imp-wizard-state-01b`. **Web only.** No backend, migration, permission or ZATCA change; no journal entries. Builds on 01a (engine: `foreignJob`, domain refusal in `applyLoop`, epoch-based `reset`).

## What changed
- **`hasFrozenOptions(job)`** (`import-jobs/client.ts`): preview-bound ∨ repair child (`parent_job_id`). One predicate replaces the three local `frozenJob` copies (purchase, taxonomy, price list) and is adopted by the older screens. Server basis: `ImportJobService::applyNextChunk` treats both as frozen-at-creation and rejects a differing explicit option (`assertOptionsFrozen`), so sending the page's current options to a resumed repair child fails.
- **Partner wizard** (the most behind): foreign-domain job refused on every path via `engine.foreignJob`; repair children resume (Apply/Continue); stale job dropped when a rule changes (`dropJob`, guarded while uploading/applying); job-creation failure returns to the preview with the error instead of an empty page; Apply disabled once a preview's job has ended (+ `preview_used` note); stepper cannot jump to a missing preview or move during upload/apply; explicit Continue for a paused bound job; partial-failure note and «start another» after a failure; `engine.error` shown; result shows the **cumulative** rows processed (the per-status counts are the last chunk only, hint kept). 7 ar/en keys added to `partnerImport`.
- **Expense wizard**: foreign-domain refusal (`resumed_wrong_domain` card, `confirmAndApply` refuses) and the repair-child freeze predicate on all four paths. It already had the other guards.
- **Stocktake wizard:** unchanged — it already refuses a foreign domain/target (`resumeMismatch`), is atomic (no repair children) and has every other guard; the engine now refuses a foreign apply too.
- **Product catalog / workbook / inventory-opening pages:** the apply call uses `hasFrozenOptions` so a resumed repair child sends `{}`. Mechanical change, covered by the helper's unit test and the engine refusal; **no page-level test added** (these pages have no resume tests today; disclosed).

## Tests
Partner +6 (14), expense +2 (20), `client.test.ts` +1. Mutation controls (each fails a test when applied): Partner foreign guard · frozen predicate (Partner and expense) · `dropJob` · creation-failure step · terminal-job Apply block · stepper missing-preview guard (a first draft was vacuous — it passed with the guard removed — and gained an assertion that the apply card stays). Full web suite: 715 files / 8576 tests passed.

## Remaining
- Page-level resume tests for the three product pages; optional removal of the hardened wizards' hand-written foreign-domain check in favour of `engine.foreignJob`.
- `useImportJobEngine.test.tsx(158)` TypeScript error is pre-existing and untouched.
