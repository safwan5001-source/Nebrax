# Products & Inventory — Acceptance Matrix

| Package | Security/Tenant | Branch/Warehouse | UOM | Accounting | Concurrency | API/Compatibility | Required evidence |
|---|---|---|---|---|---|---|---|
| PR-SEC-INV-1 | TenantScope unchanged | deny inaccessible UUID read/mutations/post; transfer checks source+target | unchanged | no accounting semantic change | no regression to post locks | preserve endpoints/status semantics | targeted auth tests + existing inventory tests |
| PR-INV-1 | permission server-side | same policy across branches | no quantity change | no valuation change | export/import auth race-safe at apply | unauthorized safe shapes/errors documented | read/write/import/export/history/filter/sort tests |
| PR-PRICE-1 | override permission authoritative | no branch bypass | per-UOM explicit price semantics preserved | sales economics only; no inventory valuation change | final validation inside authoritative transaction/path | preserve valid invoices/POS flows | line/header discount matrices + override tests |
| PR-INV-2 | tenant refs unchanged | source warehouse authorized | historical/base quantity correct | Δ1140 = Δsubledger; supplier credit difference represented | posting atomic/double-post safe | historical purchase references preserved | UOM factors + valuation divergence + rollback tests |
| PR-INV-3 | tenant refs unchanged | source/target authorization preserved | immutable unit_name/unit_factor/base qty | receipt/issue/transfer 1140 invariants preserved | posting lock and availability safe | existing base-unit clients remain valid | base/alt UOM × receipt/issue/transfer tests |
| PR-INV-4 | tenant refs unchanged | warehouse scope correct | base qty; multi-UOM UX deferred | variance entry = actual posted stock correction | stale movement cannot silently corrupt count | current stocktake API compatibility deliberate | concurrent sale/receipt/transfer + rollback tests |
| PR-UOM-1 | tenant barcode namespace | branch sharing cannot create barcode ambiguity | in-use base/factor cannot reinterpret stock/live refs | no stock/GL rewrite from template edit | barcode uniqueness atomic | explicit conflict/fail-closed contracts | mutation + barcode race + live-ref tests |
| PR-PROD-LIFE-1 | tenant-scoped registry queries | branch sharing must not hide references | inventory identity protected | historical refs preserved | lifecycle decision atomic enough for mutation/delete | deactivation/delete behavior documented | architecture census + missing-ref regression tests |

## Universal Definition of Done

For every implementation PR:

1. Scope matches its plan; unrelated refactors excluded.
2. Targeted tests first, then relevant wider suite. Financial/security/Tenant Isolation changes must not reduce test coverage.
3. SQLite/PostgreSQL differences are considered where DB constraints/locking matter.
4. Build/lint/type checks relevant to touched surfaces pass.
5. No merge/deploy is performed without explicit approval.
6. Implementation Report MD records changed files, tests/results, Build/CI, risks/remaining, Branch/PR/Base SHA/Head SHA, and next step.
7. Any deviation from plan is called out explicitly; it is not silently normalized as implementation detail.
8. New migrations are safe for intended production architecture; preservation of current demo data is not a requirement, but migration behavior must be deterministic and documented.
9. No hidden weakening of Tenant Isolation, authorization, accounting, UOM or idempotency invariants.