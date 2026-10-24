# IMP-WIZARD-STATE-01a — Shared engine: domain refusal and reset that stops the loop

**Branch:** `claude/imp-wizard-state-01`. **Web only, one hook:** `web/src/modules/import-jobs/useImportJobEngine.ts`. No backend, migration, permission or ZATCA change; no journal entries. Backward compatible: every existing call site keeps working unchanged (full web suite 715 files / 8567 tests green).

## Gaps closed (from the S2b / S1c / S4b / S6a reports)
1. **A job of another domain resumed from `?job=` could be applied from any wizard.** The server executes the domain stored on the job whatever the screen, and `resume` never checked it. The hardened wizards (purchase, taxonomy, price list, unit templates) each guard it by hand; the older ones (Partner, expense, stocktake, product, workbook, opening) did not.
   - The engine now remembers the domain of every job it received (`resume`, `upload`, `repair`, each apply response) and **`applyLoop` refuses a job it knows belongs to another domain** (no request, an Arabic error, `busy` stays `null`).
   - New return field **`foreignJob`** (`job.domain !== engine domain`) so a wizard can render its «not this screen's job» card without re-deriving it. The job stays in state, so the existing hand-written guards keep working as they are.
   - An id the engine has never seen (direct call, tests) is **not** refused: the rule blocks a known mismatch only.
2. **`reset()` did not stop a running `applyLoop`**, so the next response resurrected the discarded job; a late `upload`/`resume`/`repair`/`cancel` response could replace a screen that had started over.
   - `reset()` bumps an **epoch** and releases the in-flight lock. Every operation captured the epoch at its start and, after each `await`, returns silently if it changed: no state write, no next chunk, no re-fetch. A late upload resolves to `null`.
   - The server-side request already in flight is **not cancelled** and its effect stands; only its display and the loop's continuation stop (stated in the code).

## Tests
`useImportJobEngine.test.tsx` +4 (16 total): foreign job flagged and never applied; own-domain job not flagged and an unseen id still applied; reset mid-loop → one chunk only, job not resurrected; reset releases the lock, new upload succeeds, late old upload ignored. Mutation controls (each fails a test when applied): refusal removed · `foreignJob` always false · loop ignoring the epoch after a chunk · reset keeping the lock · upload ignoring the epoch.

## Not in this slice
- **WIZARD-STATE-01b (next):** adopt `engine.foreignJob`, the `frozenJob` predicate (preview-bound ∨ repair child) and the busy-navigation guard in the Partner, expense, stocktake and product/workbook/opening screens, with one test each, and the Partner wizard's cumulative result counts. The hardened wizards can then drop their hand-written domain check in favour of `foreignJob` (optional cleanup).
- `useImportJobEngine.test.tsx(158)` TypeScript error is pre-existing and untouched.
