# Work group report — AI Actions history, IMP-DOC-DISTINCT-01, OPS-02, IMP-PARTNER-STATEMENTS (2026-10-30)

Base: results through PR #1800 (`b35349e`) taken as approved, no re-exploration. Owner instructions this window: (1) AI Actions history in the Import Hub — backend contract first, UI in a separate PR; (2) IMP-DOC-DISTINCT-01 approved; (3) OPS-02 inspected at the application-logic level only (no Railway change, no platform-control bypass); (4) IMP-PARTNER-STATEMENTS registered, plan/contracts/decisions only; (5) D-13 and the other open accounting decisions left open. **Nothing was deployed and no environment setting was changed.**

## PRs

| # | PR | Merge SHA | CI at merge | Codex | Report |
|---|---|---|---|---|---|
| 1 | #1802 IMP-H8-S4a — `GET /api/ai-actions` history list (backend) | `4595a41` | SQLite ✅ · PostgreSQL ✅ · CI Gate ✅ | no findings | `IMP-H8-S4a-REPORT.md` |
| 2 | #1803 IMP-DOC-DISTINCT-01 — confirm a genuine repeat expense in the Document Center | `cfca0a1` | SQLite ✅ · PostgreSQL ✅ · web build ✅ · CI Gate ✅ | P1 + P2 fixed, re-review clean | `IMP-DOC-DISTINCT-01-REPORT.md` |
| 3 | #1804 OPS-02 — application-logic diagnosis (tests + report, no production change) | `0b069f9` | SQLite ✅ · PostgreSQL ✅ · CI Gate ✅ | no findings | `IMP-OPS-02-DIAGNOSIS-REPORT.md` |
| 4 | #1805 IMP-PARTNER-STATEMENTS — plan, contracts, decisions + Tracker rows (docs) | `3035909` | SQLite ✅ · PostgreSQL ✅ · CI Gate ✅ | no findings | `AWJ_IMP_PARTNER_STATEMENTS_PLAN.md` |
| 5 | #1806 IMP-H8-S4b — AI Actions history in the Import Hub (UI) | `24d911f` | SQLite ✅ · PostgreSQL ✅ · web build ✅ · CI Gate ✅ | P2 fixed, re-review clean | `IMP-H8-S4b-REPORT.md` |

Head SHAs reviewed: #1802 `2ccf9fb`, #1803 `8c3d883`, #1804 `d6a2a0f`, #1805 `1b3e95d`, #1806 `b0bcbba`.

## Accounting statement
No PR in this window creates a journal entry, stock movement, payment or ZATCA artefact. #1803 changes only how a **draft** expense is created (posting is the unchanged `ExpenseService::post`: Dr expense account + input VAT 1150 / Cr cash, bank or suppliers). #1802/#1806 are read-only. #1804/#1805 add tests/docs only. No migration, permission or environment change.

## What each delivered
1. **History (S4a + S4b).** Read-only paginated endpoint with a strict filter allow-list (scope params prohibited), authorization no weaker than `show` (general gate → per-type gates incl. operator controls → branch scope), summary rows without proposal or cost, constant query count. UI section in `/imports` for holders of `ai.actions.use`; 403 ⇒ "unavailable"; latest-request-wins after Codex found a stale-retry race.
2. **IMP-DOC-DISTINCT-01.** Explicit `confirm_distinct_occurrence`; the same document number is never confirmable and is classified at the first refusal; the confirmation is consumed only when a real repeat exists; idempotent via the batch link; audit flag; UI step only after a server-confirmable refusal. Codex P1 (race on the reference probe) fixed by moving the protocol into `ExpenseService::createDistinctOccurrence` in the caller's outer transaction and proven with a 5-racer PostgreSQL fork test.
3. **OPS-02.** No application defect: `platform_unavailable` merges six platform-level reasons; tenant grants cannot help while a platform row or the execution env floor in the serving process is off. Four tests reproduce the symptom and each step to the fix. **Nothing was granted** (a Super Admin console action on the live environment).
4. **IMP-PARTNER-STATEMENTS.** Plan with two tracks separated by a static-test wall: reconcile (no effect on the books) vs historical posting to reviewable drafts only; proposed model/API/policies; slices PS-S0..PS-B2; decisions D-PS-01..09 open.

## Verification
- Full local backend suite (SQLite) for #1802: 9702 passed; 28 failures are environmental/pre-existing on this sandbox (26 Fuel tests need `bcmath`; 2 `InventoryOpeningZeroValueDateGuardTest`); one failure of this work's own query-count test was fixed (cache-state dependent). Full suites for #1803–#1806 were left to CI (focused + related suites run locally; web `modules/imports`, `components/document-center` and the capabilities guard green locally).
- Mutation controls: S4a 4, S4b 3 (+1 for the retry fix), DOC-DISTINCT 3 backend + 2 UI + 1 PostgreSQL race; each fails tests. One disclosed survivor (deterministic occurrence id is defence in depth).

## Risks and limits
- S4b/S4a: with operator controls enforced and no Super Admin grant, the history is empty for that type (same rule as `show`; same root cause as OPS-02). The status shown is the stored one.
- DOC-DISTINCT: for a prior expense created manually under the `allow` policy (no reservation) the "same document" rule cannot apply; the reviewer's explicit confirmation decides. Confirmation is business policy (rule 6) — approved by the owner for the Document Center only.
- A web-CI-only guard (`capabilities.guard`: no direct `hasPermission` import) failed once on #1806 and was fixed by using `useCan`; run the whole web suite locally before pushing UI next time.
- Test harness trap found: `beforeEach(() => mock.reset())` returns the mock and vitest runs it as a cleanup after the test.

## Remaining
- **OPS-02 action (owner / platform admin):** open Platform console → tenant → AI Action controls and grant the missing platform rows; verify execution env flags on the serving service. Not done by the agent.
- Gated: AI slices H3-S4/H4-S4/H5-S5/H7-S2/H7-S4 (X-01 + OPS-02), H6 (D-03), #1626 Draft (D-13 and the other accounting decisions — untouched), D-01..D-04, D-06, D-07, OPS-01.
- IMP-PARTNER-STATEMENTS: decisions D-PS-01..09 needed before PS-A1; Track B additionally blocked on D-03/D-06/D-13.
