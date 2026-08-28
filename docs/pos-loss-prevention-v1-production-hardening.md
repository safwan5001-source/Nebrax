# POS Loss Prevention v1.0 — Production Hardening Closure

## Scope

Production Hardening + Final Closure of POS Loss Prevention Phase 1–4.
**Not** Phase 5. No accounting/ZATCA/inventory/checkout truth changes.

Base: latest `main` at branch creation (`cc1bbe7f`).

## Audited components

See [`docs/pos-loss-prevention-v1-production-hardening-audit.md`](pos-loss-prevention-v1-production-hardening-audit.md).

## Findings by severity → fixes

| Severity | Finding | Fix | Regression test |
|---|---|---|---|
| P0 | `consumeApprovalIfNeeded` without internal transaction → drawer approval double-spend | Wrap consume in `DB::transaction` inside `PosAuditService` | `manual_drawer_approval_cannot_be_consumed_twice` |
| P1 | Idempotency race → 500 | Catch unique violation; re-select winner | Covered by existing sequential + unique constraint; race path now returns original row |
| P1 | Branch-restricted investigator can link/promote foreign-branch evidence | `assertActorCanAccessEvidenceBranch` in case service | `branch_restricted_investigator_cannot_link_or_promote_foreign_branch_evidence` |
| P1 | Needs Attention shows superseded rule-version exceptions | Filter to current rule version + `syncRules()` on queue load | `needs_attention_hides_exceptions_from_superseded_rule_versions` + Phase 4 pagination test |
| P1 | Attention hint claimed read-only while approve exists | Copy AR/EN corrected | e2e selector update |
| P2 | Missing detection index on performer/type/time | Migration `2026_08_31_020000_…` | `performer_timeline_index_exists_after_hardening_migration` |
| P2 | Case child FKs cascadeOnDelete (Postgres) | Restrict on delete (pgsql only) | Documented; no HTTP delete path |
| P2 | Risk/Rules/detail empty-on-error; mobile cards thin; float money | UI hardening + `riyalToMinor` | Vitest configuration + mock-data remain green |

## Tests added

`tests/Feature/PosLossPreventionHardeningTest.php` (6 tests).

## Local verification (pre-CI)

| Layer | Result |
|---|---|
| Targeted PHP (`PosLossPrevention*`) | Green after Needs Attention syncRules fix (91 tests) |
| Hardening suite | 6/6 green |
| Vitest (configuration + mock-data) | 18/18 green |
| Full SQLite / Web build / Playwright live | Recorded after push via GitHub CI + local follow-up |

## Security / isolation matrix

| Check | Result |
|---|---|
| Tenant isolation | Intact (BaseModel + prior tests) |
| Branch isolation (reads) | Intact |
| Branch isolation (evidence link/promote) | **Fixed** |
| RBAC view ⊄ write | Intact |
| Assign foreign-tenant owner | **Regression added** |
| Approval replay (drawer) | **Fixed** |

## Concurrency / idempotency

- Approval consume now transaction-scoped regardless of caller.
- Client-event insert races convert unique violations into idempotent success.

## Performance / indexes

- Added `pos_events_performer_type_timeline_index` for detection aggregates.

## Known deferred

- Server-side cart engine / offline event layer.
- Branch working-hours architecture.
- Concurrent over-refund serialization in `ReturnService::post` (pre-existing accounting; out of LP scope).
- DB triggers for append-only (Eloquent guards remain; no current bypass path).
- AI / CCTV video / Phase 5 alerts.

## Accounting impact

| Operation | Debit | Credit | Amount | Source |
|---|---:|---:|---:|---|
| — | — | — | — | No accounting entry |

## Visual QA

See [`docs/pos-loss-prevention-v1-production-hardening-visual-qa.md`](pos-loss-prevention-v1-production-hardening-visual-qa.md).

## Final readiness

Recorded in PR handoff after CI on final HEAD.
