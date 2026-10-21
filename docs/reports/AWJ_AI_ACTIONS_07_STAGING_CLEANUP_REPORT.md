# AWJ AI-ACTIONS-07 — Image Staging Lifecycle & Cleanup

**Scope:** manage the lifecycle of the *private staged images* the AI product import creates (AI-06A/06B) and delete them safely when
they are no longer needed. Nothing else changed: no accounting/inventory rule, no change to the approval or execution flow, no API
change, `AI_ACTIONS_EXECUTION_ENABLED` and remote image fetching stay **off**, no Railway/production change, no merge/deploy.

## 1. What was found (current lifecycle, before this change)
* A staged image = one immutable `ai_action_images` row (evidence the preview named) + two private objects
  (`ai-actions/{tenant}/{action}/images/{uuid}.{ext}` and `….thumb.{ext}`). Nothing ever removed them (06A risk #3, 06B "next step").
* The action state machine already says what an image is *for*: a draft/approved action still needs it for preview + approval;
  an execution reads it (from the approved bytes, never the network); a failed/partially-failed run feeds a repair, which **copies**
  the bytes into a new action (own keys); a successfully executed run has already copied them into `ProductMedia` (own files).
* "Draft deletion" today only exists as **cancel** (a status). There is no API that deletes an action.

## 2. Design — no parallel state machine
The state of an image is **derived** from the state its action already has; only **one** fact is stored: `ai_action_images.purged_at`.

| Derived state | Meaning | Purged when |
|---|---|---|
| staged (draft / ready / approved-but-lapsed) | needed for preview + approval | idle ≥ `draft_days` (default **30**, = the draft retention) |
| approved (live approval) | an execution may start | **never** while the approval is live |
| executing | a run (or retry) holds a lease | **never** |
| consumed (executed, all succeeded) | bytes already copied into product media | `executed_days` after the run finished (default **7**) |
| failed / partially failed | repair window — a repair copies from these | `repairable_days` after the run finished (default **30**) |
| cancelled | can never be used again | `cancelled_days` after cancelling (default **1**) |
| purged | bytes gone, row kept as audit | terminal |

* **Configurable, safe defaults:** `AI_ACTIONS_STAGING_{DRAFT,CANCELLED,EXECUTED,REPAIRABLE}_DAYS`. Floors in code (draft ≥ 1, executed ≥ 1,
  repairable ≥ 1, cancelled ≥ 0); a non-whole-number value falls back to the default — a typo can neither purge early nor keep forever.
* **Final product images are unreachable:** they are `ProductMedia` rows with their own files; the job only ever touches keys that match the
  exact staging layout *and* belong to the row's own tenant and action (asserted: the product gallery files are identical before/after).

## 3. Safety model of the cleanup
`php artisan ai-actions:purge-staged-images [--dry-run] [--tenant=<uuid>] [--limit=500]` — scheduled daily 03:50
(`withoutOverlapping()->onOneServer()`, same pattern and same "dormant until `schedule:run` is wired" caveat as `imports:prune`).

| Requirement | Implementation |
|---|---|
| Server-side eligibility | `AiActionStagedImageRetention::decide()` — status, live approval, execution state, time since last activity |
| No conflict with execution / repair / approval | The decision is **re-taken under `lockForUpdate` on the `ai_actions` row** — the same lock execution, retry, approval, preview and repair-start already take. A scan that saw an idle draft loses to an execution/approval that got the lock first (tested). |
| Path traversal / outside staging scope | Every key must match `^ai-actions/<tenant-uuid>/<action-uuid>/images/<uuid>(.thumb)?.(jpg\|png\|webp)$`, equal the row's own tenant and action, and contain no `..`, NUL or backslash. Anything else is counted `unsafe`, **never touched**, and the command exits non-zero. |
| Tenant isolation | Rows are read with explicit tenant filter (`--tenant`) and keys are bound to the row's tenant; a key pointing into another tenant's path is refused. |
| Shared files | An object still referenced by another live row is not deleted (a repair copy always gets new keys, so this is defence in depth). |
| Dry run | Counts actions / images / candidate bytes; writes nothing, takes no lock, deletes nothing. |
| Idempotent | Purged rows are skipped; a second run reports 0. |
| Partial storage failure | Order is **delete objects → then mark `purged_at`**. A failed delete leaves the row unpurged (counted `failed`, retried next run, command exits 1); a crash after the delete is re-run safely (deleting a missing object is a no-op). The DB never claims an object is gone that is not. |
| Logging | One line `ai_actions.staged_images.cleanup` with **counts only** (no tenant/action ids, no object keys) — asserted. |
| Immutability | `AiActionImage` still rejects every change except the single, irreversible `purged_at` transition; deletes are still rejected. |

### Draft deletion
There is no delete endpoint (so no API change). Cancel keeps the files for `cancelled_days` (default 1 day) and the job removes them.
For any hard delete of an action (console/future code) a model `deleting` hook runs `purgeBeforeDeleting()`: it removes the objects first,
**refuses** to delete an executing / live-approval action, and aborts the deletion if any object could not be removed — no orphaned objects, no half-delete.

### What the user sees after a purge (no silent loss)
* Later previews of a draft whose ZIP was purged carry the warning `image_archive_purged`; re-uploading the same ZIP is treated as new evidence (not a replay).
* A purged URL image is fetched again when remote fetching is on (new row `…#2`); when it is off the row gets a **blocking** `image_purged` error.
* Thumbnails of purged images answer `410 image_purged`; execution never materialises a purged image (an approval over a purged archive is refused `approval_stale`, and a forced attach fails `image_missing`).
* A repair started from an origin whose images were purged copies nothing for them (existing behaviour: the reviewer re-supplies the ZIP).

## 4. Changed files
Backend: `app/Services/AiActionStagedImageRetention.php` (new), `app/Console/Commands/PurgeAiActionStagedImages.php` (new),
`database/migrations/2026_11_20_010000_add_purged_at_to_ai_action_images.php` (new, additive, nullable), `app/Models/AiActionImage.php`,
`app/Models/AiAction.php` (deleting hook), `app/Services/AiActionProductImageStager.php`, `AiActionProductPreviewBuilder.php` (one warning),
`AiActionProductExecutionService.php` (one guard), `config/ai_actions.php`, `routes/console.php`.
Tests: `tests/Feature/AiActionStagingCleanupTest.php` (19). Docs: `docs/engineering/AWJ_REMOTE_PRODUCT_IMAGES_RUNBOOK.md` (new, documentation only), this report.
No web change.

## 5. Tests
Required scenarios → test:

| Scenario | Test |
|---|---|
| expired staging file / recent kept | `an_expired_idle_draft_loses…`, `the_retention_windows_follow…` (also bad config) |
| file still needed for execution/repair | `nothing_a_live_approval_or_a_running_execution_needs_is_purged`, windows test (repair window) |
| final image linked to a product | `final_product_images_are_never_reached…` |
| files shared between repair attempts | `a_repair_copies_only_images_that_still_exist_and_never_shares_objects…`, `an_object_another_live_row_still_references_is_not_deleted` |
| cleanup twice | `running_the_cleanup_twice…` |
| storage deletion failure | `a_storage_failure_leaves_the_row_unpurged…`, `a_failed_object_delete_stops_the_action_deletion…` |
| path traversal | `keys_outside_the_staging_layout_are_never_deleted` (traversal, other tenant, other action, foreign prefix, backslash, suffix, absolute) |
| tenant isolation | `the_cleanup_can_be_scoped_to_one_tenant…` |
| race cleanup vs execution/approval | `a_decision_is_retaken_under_the_action_lock…` |
| dry run | `a_dry_run_counts_candidates_and_deletes_nothing` |
| after-purge behaviour | `a_purged_image_is_reported_explicitly…`, `a_purged_remote_image_is_fetched_again…`, `an_image_purged_behind_an_approval…` |
| immutability / draft deletion / log | `the_purge_marker_is_the_only_change…`, `deleting_an_action_removes…`, `the_operational_log_carries_counts_only` |

| Check | Result |
|---|---|
| `AiActionStagingCleanupTest` (19) | **19 passed on SQLite and PostgreSQL** |
| `AiAction*` + `ProductImport*` + `ProductMedia*` + `ProductReferenceClassificationGuard` + `BranchIsolationGuard` | **236 passed on PostgreSQL** (incl. the 06A/06B suites unchanged) |
| `AiAction*` on SQLite | 106 passed |
| Full PHP suite, SQLite (local) | 8,148 tests: 7,976 passed, 146 skipped, **26 failed — all `Fuel*`** (`bcmul()` undefined: `bcmath` missing locally, CI installs it). Nothing else failed. |
| Web | not touched (CI `web-ci` builds it) |
| CI | **green on `972a606ae`**: `php artisan test (L11, sqlite)`, `php artisan test (L11, pgsql)`, `CI Gate` — all success |

## 6. Risks and what remains
1. The schedule entry is **dormant until a scheduler is wired** (same as `imports:prune`/`webhooks:prune`; current deployment has no `schedule:run`). Until then run `ai-actions:purge-staged-images` by hand (use `--dry-run` first).
2. A still-"live" approval (≤ `AI_ACTIONS_APPROVAL_TTL_MINUTES`, default 60) delays purging of a consumed run by up to that TTL — deliberately conservative.
3. Shortening windows (e.g. `AI_ACTIONS_STAGING_REPAIRABLE_DAYS`) shortens the repair window: a repair after the purge needs the ZIP re-uploaded.
4. `purged_at` is a new column on an immutable table; the guard allows exactly that transition. The migration is additive and reversible.
5. The web UI shows the server's Arabic message for `image_purged` / `image_archive_purged`; dedicated English strings were not added (no web change in this slice).
6. Remote fetching remains off; see the runbook — the application checks narrow SSRF exposure but do not replace a network egress policy.

## 7. Git / CI
| Item | Value |
|---|---|
| Branch | `ai-actions-07-staging-cleanup` |
| PR | https://github.com/safwan5001-source/Nebrax/pull/1589 (Draft, base `main`) |
| Base SHA | `fd2822e46e9df35ff139e1155fd9963547932e02` (`main` after #1584 + #1586) |
| Code head (CI verified green) | `972a606aeeedda510f58432b4d4091b13cce39be` |
| Head | the commit carrying this report (a report cannot contain its own SHA; current value is on the PR) |

The local first full run showed 651 failures only because `APP_KEY` was not set in this environment (`MissingAppKeyException`); rerun with a key: 26 failures, all `Fuel*`.

## 8. Next step
Wire a scheduler for the retention/prune commands in the deployment (separate approved task), and — only after the runbook's egress requirements are met and the owner approves — pilot remote image fetching in staging.
