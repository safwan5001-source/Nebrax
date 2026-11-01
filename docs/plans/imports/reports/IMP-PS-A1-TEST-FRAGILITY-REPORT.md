# IMP-PS-A1 — test-only fix: structural privacy assertion in the job-read test

**Scope:** one test, `PartnerStatementImportTest::reading_a_statement_job_requires_partner_visibility_and_the_stored_result_carries_no_partner_data`. **No application, permission, route, migration or behaviour change.** Base: `main@abacd29fc4ecaf4af5994e8ca592cb692408d0f0` (branch cut from the then-current `main`).

## Problem
The test asserted that the raw JSON body of the job responses does not contain the substrings `115000` and `1150`. The body carries random UUIDs and a SHA-256, so a UUID such as `…-ff95a01150ad` makes the test fail by chance (observed once in a wide local run; ≈ 0.3 % per run). The privacy guarantee it protects (a completed statement job exposes no partner data) was never in doubt.

## Fix
The assertion is now **structural**: the responses are decoded and every leaf is checked.
- string leaves must not contain the customer name, `INV-1001`, `PAY-77`, `فاتورة` (none of which can collide with an id or hash);
- numeric leaves must not equal a statement amount (`115000`, `1150`, `50000`, `500`) — exact equality, so ids and hashes (strings) cannot collide;
- `apply_result` keys are exactly the seven allowed ones, `reconciliation_id` is a UUID, `replayed` is a boolean, the five counters are integers;
- list items carry no `partner`, `partner_name`, `lines` or `rows` key.
The permission checks around it (403 for a view-only role, list filtered, immediate effect of revoking `partners.view`) are unchanged.

## Evidence
| Check | Result |
|---|---|
| New test, unmodified app | passes |
| New test with `reconciliation_id` forced to `a31fc5f7-033d-4ab9-9991-ff95a01150ad` (the colliding shape) | **passes** |
| The old test with the same id | **fails** (reproduces the fragility) |
| Mutation: an amount (`total_debit = 115000`) added to the stored result | new test fails |
| Mutation: the partner name added to the stored result | new test fails |
| `PartnerStatement*` suites | SQLite and PostgreSQL green (see the PR) |

## Risks
None for the product (test file only). The structural check is stricter on shape than the old one and equally strict on content.
