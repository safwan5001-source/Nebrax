# Unified Import Horizon — backlog closure group report

Group: PR backlog closure + AI Actions Beta readiness evidence (2026-10-23). Docs only.

## Done

| PR | Slice | Merge SHA |
|---|---|---|
| #1662 | H3-S2 partner endpoints + job domain | `408218b` |
| #1663 | H3-S3 customers/suppliers UI | `6ae0536` |
| #1664 | H4-S1 categories + brands | `fa40c92` |
| #1666 | H4-S2 price-list items | `9de26a7` |
| #1667 | H4-S3 unit templates | `da9dbf7` |
| #1668 / #1670 / #1671 / #1672 | X-01a / b / c / d operator controls | `2355d31` / `4514493` / `a148c01` / `6432e59` |
| #1675 | H5-S1a reservation foundation | `f80f1c7` |
| #1676 | H5-S1b expense reservation lifecycle + `finance.duplicate_reference_policy` | `b0d81e7` |
| #1679 | payments PG fork tests on per-worker databases (root cause of `scheduler_unproven`) | `7f1bc70` |
| #1683 | H4-S5 durable job domains + inspect/preview endpoints | `dc1db3d` |
| #1684 | H7-S1a stocktake count-sheet import (unregistered) | `f2110a0` |

Changed files (this PR): `AWJ_UNIFIED_IMPORT_HORIZON_TRACKER.md` (rows, pointer, operational blockers) and this report.

## Tests / CI

- Every merged PR: SQLite ✅, PostgreSQL ✅, CI Gate ✅ on the merged head; PostgreSQL concurrency tests for the financial/tenant-isolation slices (H5-S1a/b, H7-S1a, X-01).
- AI Actions readiness (local, `origin/main` `0cbff05`): `AiAction*`, tenant-isolation, `ImportJob*`, `ImportPreview*`, `ApplicationAccess` — SQLite 326 passed / 9 PG-only skips; PostgreSQL 351 passed, 0 failed (includes `AiActionControlConcurrencyPostgresTest`).
- Review: Codex where quota allowed; otherwise independent subagent review — no Codex review is claimed where it did not run.

## Risks / watch items

- **OPS-02** (open): Beta UI still reports execution unavailable from platform management; likely a missing Super Admin grant for `product_import.v1` (unverified). Not a Horizon blocker.
- **WATCH-02**: one unexplained `ReturnSourceVatAccuracyTest` 422 on #1676's PG job; passed on re-run; not called flaky.
- #1626 remains Draft (D-13). No Railway setting, deploy, migration, accounting or ZATCA rule was changed by this group.

## Remaining / next

H5-S1c (expense adapter) → H7-S1b (stocktake endpoints + job domain + UI) → H5-S2/S3 → H3/H4 UI wizards; AI slices after the X-01 operational state is verified.
