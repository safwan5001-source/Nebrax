# AWJ-TAX-ZATCA-AUDIT-1 — Deliverable C: Remediation Plan

> **Status of this document:** a *plan*. Nothing in it has been implemented. The audit that produced it was audit-only: no application code, schema, test, configuration or credential was changed, no live ZATCA endpoint was contacted, and nothing was merged or deployed.

| | |
|---|---|
| Audit | AWJ-TAX-ZATCA-AUDIT-1 (VAT engine, accounting integration, e-invoicing, ZATCA Phase 1 and 2, production readiness, security) |
| Repository | `safwan5001-source/Nebrax` |
| Audited base = head commit | `0534ef16543b01c69b416b58897337e012a9d1ab` (origin/main, 2026-10-10) |
| Companion deliverables | A — `AWJ-TAX-ZATCA-AUDIT-1.md` (findings and verdict) · B — `AWJ-TAX-ZATCA-GAP-MATRIX.md` (requirement-by-requirement) |
| Findings addressed | 105 defects/gaps (P0 8 · P1 25 · P2 49 · P3 23) plus 4 observations → 38 tasks and 2 evidence/decision tasks |

## 1. Principles

1. **Small, independent, reviewable tasks.** One REM = one PR (or the lettered sub-tasks inside it). Each has its own acceptance criteria and regression tests. A task never bundles an unrelated refactor.
2. **Sequence = risk.** Tier 1 critical financial/security defects → Tier 2 critical ZATCA blockers → Tier 3 submission reliability & recovery → Tier 4 VAT reporting/reconciliation gaps → Tier 5 UX/operational. Tier 0 (evidence and decisions) runs in parallel from day one because several later tasks cannot start without it.
3. **The official validator is the oracle.** For every ZATCA-facing task the acceptance test is the ZATCA SDK validator run offline in CI (REM-11), not an AWJ-vs-AWJ comparison. A passing test suite alone does not establish regulatory compliance; neither does this plan.
4. **Repository invariants stay untouched** (CLAUDE.md): money in halalas as `bigint`; every ledger effect through `LedgerService::post`; tenant/branch isolation by construction; posted journals immutable; policy that has more than one defensible answer is a setting with a safe default (rule 6) — hence the ADR tasks.
5. **Pre-PR protocol per task (CLAUDE.md):** run the complete `php artisan test` on SQLite and PostgreSQL; for any financial operation the PR description carries the resulting journal entry as a table (accounts, debit, credit); web changes pass `npm run test` (Vitest — 445 files / 4 117 tests at the audited commit, run by Web CI) and `npm run build`, and the Playwright specs of the touched screens are run locally because they are not part of the default CI.
6. **Tests that currently enshrine a defect** (e.g. the two-field transport body, the genesis PIH, the 64-byte signature) are replaced in the same PR with an explicit justification and a Compliance reviewer — they are not deleted silently and no unrelated test is touched.
7. **No production data, no live ZATCA traffic, no credential changes** in any task unless a separate, explicit approval is recorded for that step (REM-19 and the go-live gates).
8. **Pre-production policy.** `docs/audits/AWJ_PRE_PRODUCTION_DATA_POLICY.md` (owner-approved 2026-09-06) treats every current tenant and document as test data: tasks choose the correct invariant or default rather than a compatibility shim for that data, and migrations may re-flag or reset it deliberately. Intended code and API contracts, tenant isolation, accounting accuracy, security and idempotency are not relaxed. Whether any real taxpayer data already exists in production is NOT VERIFIED (REM-00A).

## 2. Sequence overview

Effort scale (indicative engineering days, excluding review, QA and compliance sign-off): S = 1–2 · M = 3–5 · L = 6–10 · XL = 11+. Priority = highest severity among the findings the task closes.

| Seq | Task | Tier | Priority | Title | Closes findings | Depends on | Effort |
|---:|---|---:|---|---|---|---|---|
| 1 | **REM-00A** | 0 | P1 | Production evidence pack and data-residency baseline (no code) | CON-01 | — | S (1–3 d) + external lead time |
| 2 | **REM-00B** | 0 | — | Decision-record package for the policy-bearing items | — | — | M (3–5 d across owners) |
| 3 | **REM-01** | 1 | P0 | Sales/purchase returns: derive base and VAT from the source line | VAT-01, VAT-13 | — | M (3–5 d) |
| 4 | **REM-02** | 1 | P1 | Credit notes inherit the source invoice's VAT basis and are capped | VAT-02, ACC-06 | REM-01 | M (3–5 d) |
| 5 | **REM-03** | 1 | P1 | Branch authorisation on invoice mutations (edit / delete / classify / post) | SEC-01 | — | S (1–2 d) |
| 6 | **REM-04** | 1 | P1 | Fix PostgreSQL deadlock in concurrent invoice posting (lock order) | SEC-02 | — | M (3–5 d) |
| 7 | **REM-05** | 1 | P1 | Constrain VAT account roles and make the tax report role-based | ACC-01 | — | M (3–5 d) |
| 8 | **REM-06** | 1 | P1 | Complete semantic routing for notes, returns, expenses, assets and POS exchanges | ACC-02 | REM-05 | M (3–5 d) |
| 9 | **REM-07** | 1 | P2 | Immutability of posted documents and journals at model and database level | ACC-05, PH1-09, SEC-05 | — | L (6–10 d) |
| 10 | **REM-08** | 1 | P2 | Deactivated users lose API access immediately | SEC-04 | — | S (1 d) |
| 11 | **REM-09** | 1 | P2 | 64-bit overflow guards in tax and allocation arithmetic | VAT-05, PH1-08 | — | M (3–5 d) |
| 12 | **REM-10** | 1 | P2 | VAT arithmetic consistency: discount rounding, shipping VAT rate, server-authoritative inclusive flag, one formula | VAT-07, VAT-08, VAT-09, VAT-10, VAT-12, VAT-14, CON-12 | REM-09 | M–L (5–9 d, split 10a–10f) |
| 13 | **REM-11** | 2 | P2 | SDK conformance harness in CI (official validator as test oracle) | PH2-14 | — | M (3–5 d) |
| 14 | **REM-12** | 2 | P1 | VAT category / exemption-reason model and effective-dated rates | VAT-03, VAT-11, VAT-15 | — | L (6–10 d) |
| 15 | **REM-13** | 2 | P1 | Issue date and time frozen at posting (QR tag 3, XML IssueDate/IssueTime, print) | PH1-01, PH1-14, PH2-08 | — | M (3–5 d) |
| 16 | **REM-14** | 2 | P1 | Seller/buyer master data: validation at issuance and immutable snapshots | PH1-02, PH1-04, PH1-18, PH2-16 | REM-13 | M (3–5 d) |
| 17 | **REM-15** | 2 | P1 | Standard vs simplified classification becomes an issuance precondition | PH1-05 | REM-14 | S (1–2 d) |
| 18 | **REM-16** | 2 | P0 | Rebuild the UBL 2.1 KSA invoice body (validate with the SDK) | VAT-04, VAT-06, PH1-17, PH2-04, PH2-13 | REM-11, REM-12, REM-14, REM-13 | XL (12–20 d, 16a–16d) |
| 19 | **REM-17** | 2 | P0 | Cryptographic stamp and QR conformance (signature value, SignedProperties, QR tags, genesis PIH, TLV guard) | PH1-07, PH2-01, PH2-02, PH2-03, PH2-06, PH2-11, PH2-12 | REM-11, REM-13 | L (8–12 d, 17a–17c) |
| 20 | **REM-18** | 2 | P0 | E-invoice credit and debit notes (type 381/383) with BillingReference | PH1-06, PH2-05 | REM-16, REM-02 | L (6–10 d) |
| 21 | **REM-19** | 2 | P1 | Onboarding lifecycle: CSR → compliance CSID → compliance checks → production CSID → renewal | PH2-09, CON-11 | REM-17 | XL (11–15 d) |
| 22 | **REM-20** | 2 | P1 | E-invoicing as a default-on capability for KSA tenants | PH1-03, SEC-08 | — | S (1–2 d) |
| 23 | **REM-21** | 3 | P1 | Submission outcome classification and request contract | SUB-02, SUB-03, SUB-11, SUB-15 | REM-16 | M (3–5 d) |
| 24 | **REM-22** | 3 | P2 | In-doubt state, claim lease, HTTP outside the DB transaction, DB-level attempt uniqueness | SUB-06, SUB-09, SUB-13 | REM-21 | M (3–5 d) |
| 25 | **REM-23** | 3 | P0 | Orchestration: worker, scheduler, automatic submission, 24-hour reporting clock | SUB-05, OPS-01 | REM-22, REM-00A | L (6–10 d) |
| 26 | **REM-24** | 3 | P0 | Release gate for standard invoices, cleared-XML consumption and the correction flow | SUB-01, SUB-04, SUB-07, CON-09 | REM-21, REM-23 | L (6–10 d) |
| 27 | **REM-25** | 3 | P2 | Environment-scoped ICV/PIH chain and attempts; guard environment switching | PH2-10, SUB-08, SUB-10, SUB-12, SEC-06 | REM-19 | M (3–5 d) |
| 28 | **REM-26** | 3 | P1 | Fail-closed hardening and readiness depth | PH2-07, OPS-03, SEC-03, SEC-13, CON-10, CON-11 | REM-19, REM-25 | M (3–5 d) |
| 29 | **REM-27** | 3 | P1 | Observability, sweeps, notification digest and operator runbook | OPS-02, OPS-04, SUB-14, CON-05 | REM-23 | M (3–5 d) |
| 30 | **REM-28** | 4 | P1 | Saudi VAT return, VAT-period freeze and reconciliation | ACC-03, ACC-04, ACC-11, ACC-12 | REM-05, REM-06, REM-12 | XL (12–20 d, 28a–28d) |
| 31 | **REM-29** | 4 | P2 | Tax point, supply date and advance payments (prepayment invoices, type 386) | CON-03, CON-07 | REM-16, REM-28 | L (6–10 d) |
| 32 | **REM-30** | 4 | P2 | Commerce/storefront order → invoice path and VAT on online sales | VAT-16, ACC-08 | REM-10, REM-28 | L (6–10 d) |
| 33 | **REM-31** | 4 | P2 | Credit/debit-note issuance deadline and adjustment-period controls | CON-02 | REM-28 | S (1–2 d) |
| 34 | **REM-32** | 4 | P2 | Unsupported VAT scenarios: reverse charge, imports, restricted input VAT, proportional deduction, bad-debt relief, deemed supplies, margin scheme, export evidence, capital assets | CON-04, CON-08 | REM-12, REM-28 | L (6–10 d) per case family |
| 35 | **REM-33** | 4 | P2 | Report-layer tenant guard, reversal source link, change-log retention and audit-trail completeness | ACC-07, ACC-09, ACC-10, CON-13 | REM-07 | M–L (5–8 d, split 33a–33b) |
| 36 | **REM-34** | 5 | P2 | Document rendering and labelling (drafts, thermal receipt, compliance copy, language) | PH1-10, PH1-11, PH1-13, PH1-15, CON-06 | REM-13 | M (3–5 d) |
| 37 | **REM-35** | 5 | P3 | Allocate invoice numbers at posting | PH1-12 | REM-34 | M (3–5 d) |
| 38 | **REM-36** | 5 | P1 | Retention, durable storage and e-invoice export | PH1-16, CON-01 | REM-00A | M (3–5 d) |
| 39 | **REM-37** | 5 | P2 | Separation of duties: dedicated `zatca.submit` permission | SEC-07 | — | S (1–2 d) |
| 40 | **REM-38** | 5 | P3 | Hygiene bundle (fractional-quantity validation, cleared-XML parser, CORS configuration, observations) | VAT-17, SEC-11, SEC-12 · obs.: PH1-19, PH2-15, SEC-09, SEC-10 | — | S–M (2–4 d) |

### Indicative effort by tier

| Tier | Tasks | Low (days) | High (days) |
|---|---:|---:|---:|
| Tier 0 — Evidence & decisions (no product code) | 2 | 4 | 8 |
| Tier 1 — Critical financial / security defects | 10 | 31 | 52 |
| Tier 2 — Critical ZATCA blockers | 10 | 54 | 86 |
| Tier 3 — Submission reliability & recovery | 7 | 27 | 45 |
| Tier 4 — VAT reporting & reconciliation gaps | 6 | 36 | 60 |
| Tier 5 — UX, operational & hygiene | 5 | 12 | 21 |
| **Total** | **40** | **164** | **272** |

> Two P0 findings (SUB-01, SUB-05) sit in Tier 3 because their fixes presuppose documents that pass validation: transmitting today's output would only generate rejections. They stay stop-ship for any claim of Phase 2 compliance.

> The totals are order-of-magnitude figures to size the programme, not a commitment; the Tier 2 critical path (REM-11 → 12 → 13 → 14 → 16 → 17 → 18 → 19) dominates calendar time because those tasks share the XML/stamp code and the SDK oracle.

## 3. Tiers and execution waves

**Tier 0 — Evidence & decisions (no product code).** Close the NOT VERIFIED production questions and take the policy decisions that CLAUDE.md rule 6 reserves for the owner, before dependent code starts.

**Tier 1 — Critical financial / security defects.** Wrong tax posted, cross-branch authorisation, deadlocks, mis-routed VAT accounts. Stop-ship for any production use of the affected flows, independent of ZATCA.

**Tier 2 — Critical ZATCA blockers.** Everything that makes a generated e-invoice fail ZATCA validation or makes the stamp/QR wrong. Nothing in Tier 3 is meaningful until the SDK validator passes.

**Tier 3 — Submission reliability & recovery.** Outcome classification, in-doubt handling, orchestration (worker/scheduler/24-hour clock), release gating for standard invoices, environment scoping, observability.

**Tier 4 — VAT reporting & reconciliation gaps.** VAT return boxes, period freeze, note deadlines, prepayments, reverse charge/imports, commerce-to-invoice path, report-layer guards.

**Tier 5 — UX, operational & hygiene.** Document rendering/labels, numbering at posting, retention/export, separation of duties, low-risk clean-ups.

Dependency layering (tasks in the same wave can run in parallel once the previous wave is merged):

| Wave | Tasks that can start |
|---:|---|
| 0 | REM-00A, REM-00B, REM-01, REM-03, REM-04, REM-05, REM-07, REM-08, REM-09, REM-11, REM-12, REM-13, REM-20, REM-37, REM-38 |
| 1 | REM-02, REM-06, REM-10, REM-14, REM-17, REM-33, REM-34, REM-36 |
| 2 | REM-15, REM-16, REM-19, REM-28, REM-35 |
| 3 | REM-18, REM-21, REM-25, REM-29, REM-30, REM-31, REM-32 |
| 4 | REM-22, REM-26 |
| 5 | REM-23 |
| 6 | REM-24, REM-27 |

**Critical path to a first ZATCA-valid document set (simulation only):** REM-11 (oracle) → REM-12 (categories) → REM-13 (issue time) → REM-14 (parties) → REM-16 (UBL) → REM-17 (stamp/QR) → REM-18 (notes) → REM-19 (onboarding). **Critical path to safe transmission:** the above + REM-21 → REM-22 → REM-23 → REM-24 → REM-26/27, then the go-live gates in §6.

## 4. Interim compensating controls (operational — nothing here changes the product)

These reduce exposure while the tasks above are built. They are recommendations for the business owner; none has been applied by the audit.

| Exposure (finding) | Interim control | Owner |
|---|---|---|
| VAT-01, VAT-02 — returns and credit notes recompute VAT wrongly for tax-inclusive or header-discounted sales | Process returns of such sales through the POS-session return flow (verified exact in probes R5/R6) or hold API/web returns and credit notes for manual review; Finance compares return/credit-note VAT with the source invoice `line_tax` for everything already posted. | Finance |
| SUB-01, SUB-05, PH2-04…PH2-06 — standard invoices are not cleared, simplified invoices are not reported, XML/stamp/QR fail the validator | Keep `ZATCA_SUBMISSION_DISPATCH_ENABLED=false` (the repository default) and do **not** describe AWJ output as cleared or reported. Tenants inside an integration wave must keep issuing their clearance/reporting documents through a channel that has completed ZATCA onboarding (for example the Fatoora portal) until the go-live gates pass. | Compliance / Product |
| PH1-01, PH2-08 — QR/XML time is the draft-creation time | Post simplified invoices on the day they are created; avoid carrying drafts across days. | Operations |
| PH1-04, PH1-02 — seller VAT number not validated; party data read live on reprints | Verify each tenant's VAT number (15 digits, first and last digit 3) and address before first issuance; do not edit company/partner identity after issuance without Finance sign-off. | Tenant admin / Support |
| PH1-03 — e-invoicing application disabled for fresh tenants | Enable `compliance.zatca` for every KSA tenant at onboarding so QR and ICV exist. | Support |
| SEC-01 — branch-restricted users can mutate/post other branches' invoices | Review users that combine a branch restriction with invoice-management rights; remove the rights until REM-03 ships. | Tenant admin |
| SEC-02 — PostgreSQL deadlocks on concurrent posting | Expect occasional 500s on concurrent postings for the same tenant and retry in the client; avoid bulk parallel posting jobs. | Operations |
| SEC-04 — deactivated users keep API access | Revoke the user's personal access tokens as part of off-boarding. | Support |
| ACC-01, ACC-02 — VAT roles can be remapped into the wrong account class | Do not remap VAT/AR/AP roles; restrict who may change account routing. | Finance |
| ACC-03, ACC-04 — no VAT return, no period freeze | Prepare the return from a separate workpaper; after filing, apply the existing accounting period lock (a verified control) to the filed period. | Finance |
| PH1-16 — retention purge and local disk | Do not run `documents:retention-run --apply` on tax documents; keep backups for at least six years; confirm storage durability (REM-00A). | Operations |
| CON-12 — the invoice `adjustment` field is unbounded and untaxed | Use the field for rounding only (a few halalas); put any fee or surcharge on a taxable line or in shipping; Finance reviews postings to account 5170 (document adjustments) for amounts larger than a rounding. | Finance |
| CON-13 — no login trail, no password change at first use, deletions and outputs not logged | Create users through the invitation (reset-link) flow instead of an administrator-set password; keep the web-server and reverse-proxy access logs as the authentication trail; limit who may delete drafts. | Tenant admin / Operations |
| OPS-01 — no worker/scheduler in production blueprint | If dispatch is ever enabled before REM-23, run a queue worker and scheduler and watch the backlog manually. | Operations |

## 5. Decision records required (ADR)

| ADR | Decision | Needed by |
|---|---|---|
| ADR-A | Invoice issue time and back-dating policy (`issued_at` vs `invoice_date`; whether back-dated e-invoices are allowed, rejected or shown with both dates). | REM-13 |
| ADR-B | VAT rounding policy: document-level, per-category rounding vs per-line; shipping/charge VAT category; header-discount semantics in tax-inclusive mode; bound and treatment of the document `adjustment` (rounding tolerance vs categorised charge/allowance). | REM-10, REM-16 |
| ADR-C | Chain and environment policy: one ICV/PIH chain per EGS unit and environment; treatment of the legacy phase-1 stub invoices already in the chain. | REM-19, REM-25 |
| ADR-D | E-invoice release policy: standard (B2B) invoices shared only after Clearance; simplified invoices reported within 24 h; contingency/"stamp later" and manual-invoice regeneration procedure. | REM-22, REM-23, REM-24, REM-27 |
| ADR-E | Credit/debit-note model: mandatory source-invoice reference, standalone notes, cumulative caps, tax-basis inheritance, e-invoicing of notes. | REM-02, REM-18, REM-31 |
| ADR-F | Commerce/storefront order → invoice conversion and tax point (CLAUDE.md commerce item 9 requires an approved ADR). | REM-30 |
| ADR-G | VAT period model: period type per tenant, filed-period freeze, amendment mechanism, relation to the accounting lock. | REM-28, REM-29, REM-31 |
| ADR-H | Records location and hosting: which reading applies — IR Art. 66(3) (records kept in the Kingdom, accessible through a terminal in the Kingdom) or the stricter TIG v3 §8.3.1 (a resident's server in the Kingdom) — whether other laws add residency, and what the production topology must be; backed by a tax-adviser opinion or a ZATCA ruling. | REM-00A, REM-36 |
| ADR-I | Tax-category model: S/Z/E/O with VATEX reason codes, effective-dated rate catalogue, defaults per product/partner/tenant. | REM-12, REM-32 |
| ADR-J | Retention classes: minimum six-year class for tax documents, storage durability, export/archive format. | REM-33, REM-36 |

## 6. Go-live gates for enabling ZATCA transmission

`ZATCA_SUBMISSION_DISPATCH_ENABLED` must stay `false` in every environment that holds real taxpayer data until **all** gates below are evidenced. The gates are cumulative and each needs a named approver; "queued" is never evidence of "accepted".

| Gate | Evidence required | Closed by |
|---|---|---|
| **G1 Financial correctness** | Regression tests for VAT-01/02, ACC-01/02, SEC-01/02/04 and REM-10 pass on SQLite and PostgreSQL; Finance has reviewed historical returns/credit notes flagged by REM-01/02. | REM-01…REM-10 |
| **G2 Offline conformance** | SDK `-validate` reports XSD, EN, KSA, QR, SIGNATURE and PIH stages PASSED for the full fixture matrix (standard/simplified × invoice/credit/debit × S/Z/E/O × discount/charge/inclusive/fractional) in CI, with the SDK version pinned and checksum-verified; unsupported shapes are rejected by a coded error, not mis-emitted. | REM-11…REM-20 |
| **G3 Reliability** | Worker and scheduler running with heartbeat; in-doubt state and lease sweep proven by crash/timeout tests; DB-level attempt uniqueness; 24-hour reporting clock with alerts; digest notifications; operator runbook reviewed. | REM-21…REM-27 |
| **G4 Sandbox/simulation (separate approval)** | Onboarding and compliance checks completed against ZATCA sandbox/simulation with synthetic data only, by the implementing team, recorded as evidence. **The audit performed none of this.** | REM-19, REM-25, REM-26 |
| **G5 Chain and environment** | ADR-C implemented: chain keyed by EGS unit/environment; legacy stub invoices flagged and never queued; first production invoice carries the genesis PIH. | REM-25 |
| **G6 Production evidence** | REM-00A evidence pack accepted: configuration, processes, region/residency decision, backups, retention, tenant credential inventory. | REM-00A, REM-36 |
| **G7 Governance** | ADR-A…J signed; tax adviser has reviewed the policies they own; product copy contains no certification or approval claim (REM-34). | REM-00B, REM-34 |
| **G8 Rollout** | Per-tenant enablement flag, canary tenant on simulation, rollback plan, daily reconciliation of AWJ attempts against the ZATCA portal for the first weeks. | REM-23, REM-27 |

## 7. Definition of done (every task)

- [ ] Code and tests merged through a normal reviewed PR; acceptance criteria below demonstrated.
- [ ] Complete `php artisan test` green on SQLite and PostgreSQL (CLAUDE.md pre-PR protocol); `npm run test` and `npm run build` for web changes, plus the Playwright specs of the touched screens.
- [ ] Financial operations: PR description lists the resulting journal entry per operation (account, debit, credit) for review before merge.
- [ ] ADRs referenced; settings introduced have a default that preserves existing tenant behaviour (rule 6).
- [ ] Migrations are additive and tested on a PostgreSQL copy; no destructive change to posted data.
- [ ] Rollback or feature-flag note recorded; release note states the behaviour change.
- [ ] The task's findings are re-tested against the original audit probe (reproduce → fixed) and the Gap Matrix rows it closes are updated.

## 8. Task cards

### Tier 0 — Evidence & decisions (no product code)

#### REM-00A — Production evidence pack and data-residency baseline (no code)

| | |
|---|---|
| Tier · priority | Tier 0 · P1 |
| Closes findings | CON-01 (P1) |
| Depends on | — |
| Decisions (ADR) | ADR-H |
| Effort · owner | S (1–3 d) + external lead time · Ops / Compliance |

**Why.** Everything this audit could not see — production environment values, worker/scheduler processes, storage durability, hosting region, which tenants hold ZATCA credentials — is NOT VERIFIED. The deployment blueprint in the repo (Frankfurt web service, `QUEUE_CONNECTION=sync`, local disk, R2) is evidence of intent only.

**Scope.** Collect and attach (redacted) evidence for: (1) `ZATCA_SUBMISSION_DISPATCH_ENABLED`, `QUEUE_CONNECTION`, `FRONTEND_URL`, storage driver, `APP_ENV`, `APP_DEBUG` — names and non-secret values only; (2) running processes (web, queue worker, scheduler) and their restart/heartbeat behaviour; (3) hosting region of database, application and object storage versus the records-in-the-Kingdom requirement (IR Art. 66(3) and the stricter TIG v3 §8.3.1); (4) backups, restore test date, retention settings; (5) list of tenants with ZATCA credentials, their environment and expiry; (6) written position from ZATCA (support portal / sandbox documentation) on chain continuity across environments — obtained without submitting invoices from this repository.

**Approach.**
- Ops exports a one-page evidence sheet per item; secrets are never attached (names + masked hints only).
- Compliance records the residency interpretation in ADR-H and either accepts the topology or schedules relocation.
- Update the NOT VERIFIED list of the audit report with the evidence references.

**Out of scope.** No application change, no live ZATCA traffic, no credential rotation.

**Acceptance criteria.**
- [ ] Evidence sheet exists for items 1–6 and is reviewed by Ops + Compliance.
- [ ] ADR-H is merged with an explicit accept/relocate decision and owner.
- [ ] Every NOT VERIFIED production row of the audit is either closed with evidence or re-labelled with a reason.

**Regression tests.**
- n/a (documentation task) — verification is the review of the evidence pack.

**Risk and rollout.** None to the product. The residency decision may force a hosting change that is larger than any code task in this plan.

#### REM-00B — Decision-record package for the policy-bearing items

| | |
|---|---|
| Tier · priority | Tier 0 · — |
| Closes findings | — (evidence / decision task) |
| Depends on | — |
| Decisions (ADR) | ADR-A, ADR-B, ADR-C, ADR-D, ADR-E, ADR-F, ADR-G, ADR-H, ADR-I, ADR-J |
| Effort · owner | M (3–5 d across owners) · Product owner / Compliance / Tech lead |

**Why.** CLAUDE.md rule 6 requires that decisions with more than one defensible answer be built as configurable policy with a safe default (`docs/audits/AWJ_PRE_PRODUCTION_DATA_POLICY.md` relaxes only the "protect existing tenants" half of that sentence), and item 9 of the Commerce rules forbids guessing Saudi tax behaviour. Eleven findings cannot be implemented correctly without these decisions.

**Scope.** Write and approve ADR-A … ADR-J (working labels; file them as `docs/decisions/ADR-XXXX-*.md` per `docs/autonomous-engineering/ADR-CONVENTION.md`): each ADR states the options, the recommended default that protects existing tenants, the setting that carries the policy (`Settings`/`BranchSettings`), the migration rule (test data may be reset under the Pre-Production Data Policy; intended code/API contracts are preserved), and the tests that prove it.

**Approach.**
- One short ADR per decision under the repository's ADR location; link each from the REM PRs that depend on it.
- Where the regulation is silent or ambiguous, record the question to ZATCA/tax adviser and the interim default; do not guess.

**Out of scope.** No code.

**Acceptance criteria.**
- [ ] ADR-A … ADR-J merged and signed off by the product owner (and a tax adviser for ADR-A, B, D, E, F, G).
- [ ] Every dependent REM links its ADR.

**Regression tests.**
- n/a

**Risk and rollout.** Delay of the decision is the main schedule risk of Tiers 2–4.

### Tier 1 — Critical financial / security defects

#### REM-01 — Sales/purchase returns: derive base and VAT from the source line

| | |
|---|---|
| Tier · priority | Tier 1 · P0 |
| Closes findings | VAT-01 (P0), VAT-13 (P2) |
| Depends on | — |
| Decisions (ADR) | — |
| Effort · owner | M (3–5 d) · Backend (accounting) |

**Why.** `ReturnService::create()` recomputes VAT from the gross client `unit_price`; tax-inclusive and header-discounted sales are reversed at the wrong VAT (probe R2: 115.00 inclusive sale returns as 132.25; R3: discounted sale returns 15.00 VAT instead of 13.50). Partial returns also accumulate rounding (VAT-13).

**Scope.** `app/Services/Accounting/ReturnService.php`, `ReturnableController`, web `create-return-dialog.tsx`; reuse `PosReturnService::allocate()` which is already exact (probes R5/R6).

**Approach.**
- When `source_line_id` is present, ignore client `unit_price`/`tax_rate` for arithmetic and allocate base/discount/VAT from the stored source line split (including the header-discount share), final part absorbing the remainder.
- Carry `tax_inclusive` into the free-return path via `splitLineTax`.
- Expose `unit_price_before_tax` and charged VAT in `ReturnableController`; cap cumulative returned base and VAT per source line.
- Apply the same rule to purchase returns (code-read only in the audit — add the probe).

**Out of scope.** Credit notes (REM-02); e-invoicing of returns (REM-18); no change to POS returns.

**Acceptance criteria.**
- [ ] Full and partial return of an inclusive sale reverses exactly the charged net and VAT.
- [ ] Σ of partial returns equals the original VAT (7 × 0.10 case).
- [ ] Return of a header-discounted sale reverses the discounted VAT.
- [ ] Ledger entry stays balanced; 2120 debit equals the credited VAT.

**Regression tests.**
- Return against inclusive invoice (full/partial) equals charged amounts.
- Return against header-discounted invoice.
- Purchase return against inclusive purchase.
- Cumulative VAT cap per source line.
- Existing `ReturnTest`, `ReturnFromSourceTest`, `PosReturnTest` stay green on SQLite and PostgreSQL.

**Risk and rollout.** Changes posted amounts of future returns only; no migration of historical rows. Provide a read-only report of historical returns whose VAT differs from the source line so Finance can review them.

#### REM-02 — Credit notes inherit the source invoice's VAT basis and are capped

| | |
|---|---|
| Tier · priority | Tier 1 · P1 |
| Closes findings | VAT-02 (P1), ACC-06 (P2) |
| Depends on | REM-01 |
| Decisions (ADR) | ADR-E |
| Effort · owner | M (3–5 d) · Backend (accounting) |

**Why.** `CreditNoteService` is exclusive-only with a hard-coded 15 % and no cap against the original invoice; an unbounded or unanchored note can over-credit (probe R4: 26 450 / VAT 3 450 on a 1-unit inclusive invoice).

**Scope.** `app/Services/Accounting/CreditNoteService.php` and its request/controller; migration to make `original_invoice_id` `restrictOnDelete`.

**Approach.**
- Resolve rate, inclusive/exclusive mode and per-line caps from `original_invoice_id` when present; use `Settings sales.default_tax_rate` only for standalone notes.
- Validate: source posted, same partner, cumulative note + return cap; keep the design compatible with notes that reference several invoices (R1-117, see REM-18).
- Configurable policy (ADR-E): require a source for sales notes — recommended default *required*, standalone notes only where the setting permits (the Pre-Production Data Policy removes the need to default to the old behaviour for test tenants).

**Out of scope.** E-invoicing of notes (REM-18).

**Acceptance criteria.**
- [ ] Note against inclusive invoice credits exactly the charged VAT.
- [ ] Qty above the invoiced qty, a draft source, a partner mismatch and a cumulative over-credit are rejected.

**Regression tests.**
- CN against inclusive invoice; CN qty > invoice qty rejected; CN rate inherited after a default-rate change; cumulative CN + return cap.

**Risk and rollout.** Behaviour change for anyone issuing free-form notes; under the Pre-Production Data Policy test tenants need no compatibility default.

#### REM-03 — Branch authorisation on invoice mutations (edit / delete / classify / post)

| | |
|---|---|
| Tier · priority | Tier 1 · P1 |
| Closes findings | SEC-01 (P1) |
| Depends on | — |
| Decisions (ADR) | — |
| Effort · owner | S (1–2 d) · Backend |

**Why.** A branch-restricted user can edit, delete and issue (ICV/QR/XML-generating `post`) invoices of branches outside their access because the controller methods use a bare `Invoice::findOrFail` (SEC-01); the revisions feed also leaks cross-branch documents.

**Scope.** `InvoiceController` `update`, `updateClassification`, `destroy`, `post`; `DocumentRevision` feed/index; review quotes/credit-notes/returns controllers for the same pattern.

**Approach.**
- Route every mutation through `visibleInvoice()` or `assertRecordAccessible($invoice->branch_id, …)` immediately after load.
- Filter the revisions feed by the underlying document's branch.

**Out of scope.** Role changes (REM-37).

**Acceptance criteria.**
- [ ] A restricted user receives 404 on PUT/DELETE/POST post/classification for foreign-branch invoices and cannot see their revisions.

**Regression tests.**
- Extend `PosInvoiceBranchAccessTest` for update/destroy/post/classification; revisions feed branch filter; same matrix for quotes, credit notes, returns.

**Risk and rollout.** Low.

#### REM-04 — Fix PostgreSQL deadlock in concurrent invoice posting (lock order)

| | |
|---|---|
| Tier · priority | Tier 1 · P1 |
| Closes findings | SEC-02 (P1) |
| Depends on | — |
| Decisions (ADR) | — |
| Effort · owner | M (3–5 d) · Backend |

**Why.** Concurrent `post()` calls deadlock on PostgreSQL (SQLSTATE 40P01) because the partner-row lock is taken before the tenant-anchor lock while other paths take them in the opposite order (SEC-02). SQLite hides it.

**Scope.** `InvoiceService::post` lock acquisition; services that take the anchor after other rows (audit grep).

**Approach.**
- Acquire the tenant anchor first in every posting path (or replace the partner `FOR UPDATE` by the anchor).
- Wrap posting transactions with deadlock retry (`DB::transaction($fn, 3)`) and map `DeadlockException` to a retryable 409/503 instead of 500.

**Out of scope.** Narrowing the anchor-held critical section (observation SEC-09).

**Acceptance criteria.**
- [ ] N concurrent posts plus concurrent payment/draft creation for the same partner complete with zero 40P01 on PostgreSQL.

**Regression tests.**
- PostgreSQL-only CI job reusing the audit's `icv_race` design; query-log test asserting lock order.

**Risk and rollout.** Medium: lock-order changes need the concurrency job to run in CI on PostgreSQL.

#### REM-05 — Constrain VAT account roles and make the tax report role-based

| | |
|---|---|
| Tier · priority | Tier 1 · P1 |
| Closes findings | ACC-01 (P1) |
| Depends on | — |
| Decisions (ADR) | — |
| Effort · owner | M (3–5 d) · Backend (accounting) |

**Why.** `AccountRoutingService` accepts any posting account for the VAT roles and `ReportService::taxReport` reads fixed codes 1150/2120, so remapping makes VAT silently vanish from the report (ACC-01).

**Scope.** `AccountingRoles`, `AccountRoutingService::assertEligibleAccount`, `AccountRoleResolver`, `ReportService::taxReport`, routing UI warning.

**Approach.**
- Enforce an account-type constraint per role (`tax_output` = liability, `tax_input` = asset/contra-liability); forbid the same account for input and output.
- Make `taxReport` resolve accounts through the roles.

**Out of scope.** Remapping the other services (REM-06).

**Acceptance criteria.**
- [ ] Mapping `tax_output` to an asset/revenue/expense/equity account returns 422.
- [ ] After a legitimate remap, `taxReport` equals Σ invoice VAT.

**Regression tests.**
- Routing validation matrix (API + service); `taxReport` equals Σ VAT after remap; tenant isolation of mappings.

**Risk and rollout.** Existing invalid mappings are reported by a migration check; under the Pre-Production Data Policy test mappings may be reset deliberately.

#### REM-06 — Complete semantic routing for notes, returns, expenses, assets and POS exchanges

| | |
|---|---|
| Tier · priority | Tier 1 · P1 |
| Closes findings | ACC-02 (P1) |
| Depends on | REM-05 |
| Decisions (ADR) | — |
| Effort · owner | M (3–5 d) · Backend (accounting) |

**Why.** Credit notes, sales returns, expenses, assets and POS exchanges still use hard-coded account codes (2120/1130/4110/1150) instead of `AccountRoleResolver` (ACC-02), so a valid remap splits VAT across accounts.

**Scope.** `CreditNoteService`, sales `ReturnService`, `ExpenseService`, `AssetService`, `PosExchangeService`.

**Approach.**
- Resolve `tax_output`/`tax_input`/`accounts_receivable`/`accounts_payable` via `AccountRoleResolver`; keep cash via `CashBankAccountService`.
- Reversals use the original concrete accounts.

**Out of scope.** New routing roles.

**Acceptance criteria.**
- [ ] For each service, mapped and unmapped states hit the same account the originating document used.

**Regression tests.**
- Per-service routing tests (mapped / unmapped); reversal uses original accounts; tenant isolation.

**Risk and rollout.** Low–medium; covered by the existing routing tests plus the new matrix.

#### REM-07 — Immutability of posted documents and journals at model and database level

| | |
|---|---|
| Tier · priority | Tier 1 · P2 |
| Closes findings | ACC-05 (P2), PH1-09 (P2), SEC-05 (P2) |
| Depends on | — |
| Decisions (ADR) | — |
| Effort · owner | L (6–10 d) · Backend |

**Why.** Posted invoices, lines, journal entries and lines can be updated or deleted by any code that bypasses the service convention; `$fillable` exposes `zatca_*`, `status` and `tenant_id` (ACC-05, PH1-09, SEC-05).

**Scope.** `Invoice`, `InvoiceLine`, `JournalEntry`, `JournalLine` models (observers/guards), PostgreSQL triggers (optional hardening), `FinancialControlService`, `DocumentRevision::TYPES`.

**Approach.**
- Model-level `updating`/`deleting` guards when `status = posted` (allow only the ZATCA artefact columns through the dispatcher/clearance path via `forceFill`).
- Drop `tenant_id`/`zatca_*`/`status` from `$fillable`.
- Add `account_balance_drift` and `document_vat_vs_journal` integrity rules; nightly chain-verify command (hash + PIH + totals).

**Out of scope.** Document snapshots (REM-14).

**Acceptance criteria.**
- [ ] Eloquent update/delete of posted rows throws; the dispatcher/clearance path still works; a tampered row is detected by the verify command.

**Regression tests.**
- Model-level update/delete of posted invoice, line, journal throws; `zatca_xml` update throws outside the allowed path; verify command detects a tampered row.

**Risk and rollout.** Medium: guards can break maintenance scripts — grep all writers first.

#### REM-08 — Deactivated users lose API access immediately

| | |
|---|---|
| Tier · priority | Tier 1 · P2 |
| Closes findings | SEC-04 (P2) |
| Depends on | — |
| Decisions (ADR) | — |
| Effort · owner | S (1 d) · Backend |

**Why.** `is_active = false` is not checked by the API middleware; existing Sanctum tokens keep full access (SEC-04).

**Scope.** `SetTenant` / `EnsureUserPrincipal`; the deactivation path (token revocation).

**Approach.**
- Check `is_active` per request; revoke tokens on deactivation.

**Out of scope.** Session policy changes.

**Acceptance criteria.**
- [ ] Deactivated user receives 403 on the next request; token count is 0 after deactivation.

**Regression tests.**
- API test: deactivate → 403; tokens deleted.

**Risk and rollout.** Low.

#### REM-09 — 64-bit overflow guards in tax and allocation arithmetic

| | |
|---|---|
| Tier · priority | Tier 1 · P2 |
| Closes findings | VAT-05 (P2), PH1-08 (P2) |
| Depends on | — |
| Decisions (ADR) | — |
| Effort · owner | M (3–5 d) · Backend (accounting) |

**Why.** Single-line invoices above ≈ 78.4 M SAR and multi-line invoices above ≈ 30–43 M SAR crash with `TypeError` at create/post (VAT-05, PH1-08); the same pattern exists in header-discount and allocation helpers and in purchases.

**Scope.** `ComputesLineTax`, `InvoiceService` allocation helpers, `PurchaseService`; checked-multiply helper as in `DeliveryNoteSalesInvoiceDraftBuilder::checkedMultiply`.

**Approach.**
- Introduce one checked-multiply/`intdiv` helper (bcmath/gmp or `intdiv` with overflow check) and use it in all proportional allocations.
- Document an explicit maximum document amount and return 422 above it.

**Out of scope.** Changing rounding rules (REM-10).

**Acceptance criteria.**
- [ ] A 100 M SAR single line and a 50 M SAR two-line invoice/purchase either post correctly or are rejected with a clear 422 — never a TypeError.

**Regression tests.**
- Create+post at 100 M single line and 50 M two-line for invoices and purchases; Σ prorated revenue equals net sales.

**Risk and rollout.** Low; bcmath is declared in Dockerfile and CI (FuelCostBasisService already depends on it).

#### REM-10 — VAT arithmetic consistency: discount rounding, shipping VAT rate, server-authoritative inclusive flag, one formula

| | |
|---|---|
| Tier · priority | Tier 1 · P2 |
| Closes findings | VAT-07 (P2), VAT-08 (P2), VAT-09 (P2), VAT-10 (P3), VAT-12 (P3), VAT-14 (P3), CON-12 (P2) |
| Depends on | REM-09 |
| Decisions (ADR) | ADR-B |
| Effort · owner | M–L (5–9 d, split 10a–10f) · Backend (accounting) |

**Why.** Header-discount VAT is truncated instead of rounded half-up (VAT-07); shipping VAT is a hard-coded 15 % (VAT-08); POS accepts a client `tax_inclusive` flag (VAT-09); `?? 15` defaults in six services (VAT-10); the formula is duplicated eight times (VAT-12); expenses/assets are exclusive-only (VAT-14); the document `adjustment` is unbounded, untaxed and booked to an expense account (CON-12).

**Scope.** `ComputesLineTax` and its consumers; `InvoiceService::applyDiscount`; shipping tax field; `PosService`; settings `sales.default_tax_inclusive`.

**Approach.**
- 10a — ADR-B decision (header-discount semantics in inclusive mode; shipping VAT treatment).
- 10b — half-up header-discount VAT (`intdiv(2·taxGross·net + subtotal, 2·subtotal)`) and persisted per-line shares.
- 10c — explicit shipping tax rate (category follows in REM-16 once REM-12 exists), same inclusive/exclusive mode as the document; same rule in purchases.
- 10d — `sales.default_tax_inclusive` resolved server-side; client flag validated; defaults via `Settings::get()`.
- 10e — collapse `calcTax`/`extractTax` copies into `ComputesLineTax`; inclusive mode for expenses/assets.
- 10f — bound the document `adjustment` by a tenant-configurable rounding tolerance (CLAUDE.md rule 6; default decided in ADR-B), reject larger values with a coded error that points to the charge/allowance route, and keep the adjustment account for rounding differences only (CON-12).

**Out of scope.** Document-level per-category rounding (VAT-04) — it needs the category model and is delivered with the XML builder in REM-16.

**Acceptance criteria.**
- [ ] Same basket gives the same VAT in invoice, quote, POS, purchase, return and credit note.
- [ ] Probe baskets S15, S16 and P3 match the ADR-B expectation.
- [ ] Existing money tests stay green on both databases.
- [ ] An adjustment above the tolerance is rejected; within it VAT is unchanged and the XML carries BT-114 (REM-16).

**Regression tests.**
- Cross-service equivalence test; S15/S16 baskets; shipping on 0 %-only invoice; POS flag mismatch rejected; inclusive expense 115.00 → 100.00/15.00.

**Risk and rollout.** Medium: changes posted amounts by ≤ 1 halala per document in edge cases; announce in release notes (no per-tenant gate is needed for pre-production test data).

### Tier 2 — Critical ZATCA blockers

#### REM-11 — SDK conformance harness in CI (official validator as test oracle)

| | |
|---|---|
| Tier · priority | Tier 2 · P2 |
| Closes findings | PH2-14 (P2) |
| Depends on | — |
| Decisions (ADR) | — |
| Effort · owner | M (3–5 d) · Backend / DevOps |

**Why.** The existing ZATCA test suite proves AWJ-vs-AWJ consistency and encodes the deviations as expectations (PH2-14); no test runs the official validator. Without an oracle, REM-16/17/18 cannot be accepted.

**Scope.** New CI job (JDK 11, `-Dfile.encoding=UTF-8`), official public sample documents as fixtures with hash goldens, AWJ output fixtures per document shape.

**Approach.**
- Pin the ZATCA SDK version and verify its checksum in CI; run `-validate` over the AWJ fixture matrix (standard/simplified × invoice/credit/debit × S/Z/E/O × discount/charge/inclusive/fractional).
- Add the official samples' hash/QR/signature goldens as unit fixtures.
- Land the job first with the failures recorded as an expected-failure baseline (the audit's SDK runs are the baseline), then shrink the baseline as REM-16/17/18 land.

**Out of scope.** Live ZATCA traffic — the harness is offline.

**Acceptance criteria.**
- [ ] CI job runs the SDK offline and publishes a per-shape pass/fail table.
- [ ] Expected-failure baseline matches the audit's recorded failures.

**Regression tests.**
- Harness self-test: the SDK passes its own samples; AWJ fixture matrix recorded.

**Risk and rollout.** SDK distribution/licence terms and pinning must be checked before vendoring; keep the jar out of the repository (download-and-verify step).

#### REM-12 — VAT category / exemption-reason model and effective-dated rates

| | |
|---|---|
| Tier · priority | Tier 2 · P1 |
| Closes findings | VAT-03 (P1), VAT-11 (P3), VAT-15 (P3) |
| Depends on | — |
| Decisions (ADR) | ADR-I |
| Effort · owner | L (6–10 d) · Backend + Web |

**Why.** `tax_rate = 0` conflates zero-rated, exempt and out-of-scope supplies; there is no category, VATEX reason or effective-dated rate (VAT-03 P1, VAT-11, VAT-15). It blocks the XML tax breakdown, the VAT return and rate changes.

**Scope.** New columns on document lines (`tax_category`, `tax_exemption_reason_code`, `tax_exemption_reason`), header-level allowance/charge category, product/partner defaults, validated settings replacing free-form `sales-config/taxes` JSON, rate catalogue keyed by category and date.

**Approach.**
- ADR-I, then additive migration (default S/15 for all existing rows — no change in posted amounts).
- Validate category/reason against the ZATCA list; capture the reason per line if convenient but emit it per VAT breakdown (reason codes live on BG-23, not on the line); expose in API/UI; carry into report grouping.
- Rate resolution by the tax point (VAT Law Art. 18: the rate applicable at the date of supply) — `invoice_date` until REM-29 provides the supply date; credit notes inherit the original rate.
- Validate the rate domain (BR-KSA-84, an error in the SDK): category S carries 15 % or 5 %, Z/E/O carry 0 %, for lines, allowances/charges and prepayments; today any 0–100 value is accepted (R2-025).

**Out of scope.** XML emission (REM-16); VAT return boxes (REM-28).

**Acceptance criteria.**
- [ ] Zero-rated, exempt and out-of-scope lines are distinguishable end to end.
- [ ] A rate change affects only documents dated after the change; notes inherit the original rate.

**Regression tests.**
- Category/reason validation; rate resolution by date; CN inherits; migration leaves existing amounts unchanged.

**Risk and rollout.** Medium: additive migration on large tables — run on a PostgreSQL copy first.

#### REM-13 — Issue date and time frozen at posting (QR tag 3, XML IssueDate/IssueTime, print)

| | |
|---|---|
| Tier · priority | Tier 2 · P1 |
| Closes findings | PH1-01 (P1), PH1-14 (P3), PH2-08 (P1) |
| Depends on | — |
| Decisions (ADR) | ADR-A |
| Effort · owner | M (3–5 d) · Backend |

**Why.** QR tag 3 and XML IssueDate/IssueTime come from the draft's `created_at` in the app time zone, not from the posting instant or the invoice date shown to the customer (PH1-01, PH2-08), and the Phase-1 QR offset follows the server timezone (PH1-14).

**Scope.** `invoices.issued_at` (UTC) written once in `post()`; `ZatcaService` QR/XML time derivation; `InvoiceResource`; POS receipt time.

**Approach.**
- ADR-A policy for `invoice_date` vs `issued_at` (render both when they differ).
- ADR-A keeps an audited exception for contingency regeneration after a system failure and for re-issued rejected simplified invoices, whose document date stays the transaction date (R1-063; DTG FAQ) — a blanket ban on past issue dates would break the contingency procedure.
- One formatter for Phase 1 and Phase 2: QR tag 3 textually equals the XML `IssueDate` + `T` + `IssueTime` (the SDK check; neither a trailing `Z` nor its absence is mandated by the standard), time zone per ADR-A; no tolerance may admit a future-dated issue date (BR-KSA-04 is an error).

**Out of scope.** Numbering (REM-35).

**Acceptance criteria.**
- [ ] Draft created on D and posted on D+4: QR tag 3 and XML equal the posting instant; POS QR equals checkout time.

**Regression tests.**
- Draft-then-post across days; back-dated draft policy; tag 3 equals XML date + `T` + time; POS receipt shows the issue time.

**Risk and rollout.** Medium: touches the hash input — only affects invoices posted after deployment.

#### REM-14 — Seller/buyer master data: validation at issuance and immutable snapshots

| | |
|---|---|
| Tier · priority | Tier 2 · P1 |
| Closes findings | PH1-02 (P1), PH1-04 (P1), PH1-18 (P3), PH2-16 (P3) |
| Depends on | REM-13 |
| Decisions (ADR) | — |
| Effort · owner | M (3–5 d) · Backend + Web |

**Why.** Seller VAT number is neither validated nor required at issuance (PH1-04); seller/buyer identity on issued invoices is read live so reprints change after edits (PH1-02); QR/XML assume SAR (PH1-18); missing tenant data degrades silently (PH2-16).

**Scope.** `SaudiVatNumber` validation rule in company/partner requests; `seller_snapshot`/`buyer_snapshot` written in `InvoiceService::post`; `InvoiceResource`; web `from-invoice.ts`; currency validation tied to the KSA tax profile.

**Approach.**
- Validate 15 digits, first and last digit 3, everywhere the number is entered; refuse to issue when the ZATCA application is active and seller VAT/CRN/address are missing.
- Persist snapshots at post and render from them.
- Validate the seller national address (4-digit building number, 5-digit postal code) and model the branch-level CR/additional seller ID (R1-090, R1-091).
- Reject non-SAR documents on the e-invoice path until supported.

**Out of scope.** Buyer completeness rules by document type (REM-15).

**Acceptance criteria.**
- [ ] Rename the company/partner after posting: `GET /invoices/{id}` still returns the issue-time parties.
- [ ] Posting without a valid seller VAT fails with a clear message.

**Regression tests.**
- Company update with `12345`/letters → 422; post with empty seller VAT fails; snapshot survives renames; QR tag 2 matches `^3\d{13}3$`.

**Risk and rollout.** Tenants with invalid numbers are reported first (pre-production test data may be corrected or reset deliberately), then the rule is enforced.

#### REM-15 — Standard vs simplified classification becomes an issuance precondition

| | |
|---|---|
| Tier · priority | Tier 2 · P1 |
| Closes findings | PH1-05 (P1) |
| Depends on | REM-14 |
| Decisions (ADR) | — |
| Effort · owner | S (1–2 d) · Backend + Web |

**Why.** Standard invoices can be issued without buyer VAT number or address; the classification is advisory (PH1-05).

**Scope.** `InvoiceService::post` preconditions by `zatca_document_type`; XML buyer block; printed parties block; POS restriction.

**Approach.**
- Standard requires buyer name and address (IR Art. 53(5)(e)); the buyer VAT number is conditional (Annex 2 5.3) and a missing additional buyer ID is accepted with warnings by ZATCA, so hard-blocking it is a configurable policy (rule 6).
- Classify by buyer type and amount: non-taxable legal persons need a tax invoice (R1-075); simplified invoices to taxable persons are permitted only below SAR 1,000 (IR 53(1)(c)) — the classifier currently ignores `partners.entity_type`.
- POS limited to simplified unless buyer data is complete.

**Out of scope.** XML structure beyond the buyer block (REM-16).

**Acceptance criteria.**
- [ ] Standard without buyer VAT/address → 422; standard XML contains buyer `PartyTaxScheme/CompanyID` and `PostalAddress`.

**Regression tests.**
- Standard without buyer data rejected; XML buyer block; print snapshot includes the address.
- Existing web test to extend, not to weaken: `components/invoices/invoice-form.test.tsx:550-559` selects `simplified` and saves with no confirmation step.

**Risk and rollout.** Low.

#### REM-16 — Rebuild the UBL 2.1 KSA invoice body (validate with the SDK)

| | |
|---|---|
| Tier · priority | Tier 2 · P0 |
| Closes findings | VAT-04 (P3), VAT-06 (P1), PH1-17 (P2), PH2-04 (P0), PH2-13 (P2) |
| Depends on | REM-11, REM-12, REM-14, REM-13 |
| Decisions (ADR) | ADR-B |
| Effort · owner | XL (12–20 d, 16a–16d) · Backend (ZATCA) |

**Why.** The UBL document is a skeleton that fails XSD, EN 16931 and BR-KSA rules on every invoice (PH2-04, P0); monetary fields violate the arithmetic rules once a discount, charge or inclusive price exists (VAT-06); the category VAT is the sum of rounded line VAT instead of one document-level rounding per category (VAT-04, P3 — the SDK validator tolerates it, the XML standard does not); the phase-1 XML is a stub (PH1-17); unsupported flags/FX are not gated (PH2-13).

**Scope.** `ZatcaService::buildXml` replaced by a mapping layer (new class per document section) fed by the posted-invoice snapshot, REM-12 categories and REM-14 parties.

**Approach.**
- 16a — header/profile/parties: ProfileID, type code and `name` attribute, UUID/ICV/PIH, TaxCurrencyCode, seller/buyer blocks.
- 16b — monetary: document-level AllowanceCharge, two TaxTotal elements, TaxSubtotal per category with VATEX, LegalMonetaryTotal, PayableRoundingAmount; document-level per-category rounding (VAT-04) per ADR-B, with ledger and QR taking the same document figure; BT-114 carries only the permitted rounding (CON-12) — larger amounts are document allowances/charges with a category, and charges carry a reason code and text (BT-104/105; BR-KSA-19/21, CL-06) (VAT-08).
- 16c — lines: ClassifiedTaxCategory, net PriceAmount (+ allowance when inclusive/discounted), unitCode, quantities, line TaxTotal; field-length rules (item name, city — R2-032); `cac:Delivery/cbc:ActualDeliveryDate` from the supply date (CON-07) and `PaymentMeans` (mandatory on Phase 2 tax invoices per Annex 2 row 9.1 and the container of the mandatory reason on notes — BT-81 itself is optional in the XML standard); KSA-12 (line amount with VAT) on every document type including simplified; keep a matrix marking each mandatory element as error-level or warning-level in the SDK (seller/buyer address, BT-29 and KSA-5 only warn).
- 16d — explicit scope gate: reject (not mis-emit) unsupported shapes (FX, continuous supply, B2G, self-billing) until implemented.
- Gate issuance in CI on the SDK `-validate` result for every fixture shape.

**Out of scope.** Signing/QR (REM-17); notes (REM-18).

**Acceptance criteria.**
- [ ] SDK reports XSD, EN and KSA stages PASSED for every supported fixture shape; unsupported shapes are rejected with a coded error.

**Regression tests.**
- REM-11 matrix with zero expected failures for supported shapes; arithmetic rule tests BR-CO-10/13/15, BR-KSA-51.

**Risk and rollout.** High: hash input changes; applies to new invoices only; legacy stub-era invoices (test data under the Pre-Production Data Policy) are reset or flagged by REM-25 and are never submitted.

#### REM-17 — Cryptographic stamp and QR conformance (signature value, SignedProperties, QR tags, genesis PIH, TLV guard)

| | |
|---|---|
| Tier · priority | Tier 2 · P0 |
| Closes findings | PH1-07 (P2), PH2-01 (P0), PH2-02 (P0), PH2-03 (P0), PH2-06 (P2), PH2-11 (P2), PH2-12 (P2) |
| Depends on | REM-11, REM-13 |
| Decisions (ADR) | — |
| Effort · owner | L (8–12 d, 17a–17c) · Backend (ZATCA / crypto) |

**Why.** The ECDSA signature is computed over the wrong bytes and in the wrong form (PH2-01), the XAdES SignedProperties use the wrong element set and digest encodings (PH2-02), QR tags 3/6/7/8 are wrongly encoded (PH2-03), AWJ makes a signature-policy identifier a hard blocker although the SDK ignores it (PH2-06, P2), the genesis PIH differs (PH2-11) and TLV lengths wrap silently (PH1-07, PH2-12). The audit's SDK runs fail QR and SIGNATURE on every simplified invoice.

**Scope.** `ZatcaXadesSignatureAssembler`, `ZatcaXmlEcdsaSigner`, `ZatcaSignedInvoiceQrMaterialExtractor`, `ZatcaPhaseTwoQrEncoder`, genesis constant, `tlv()` helpers, signature-policy config/readiness.

**Approach.**
- 17a — sign the decoded invoice-hash bytes (`openssl_sign`, SHA-256) and keep the DER output base64; accept DER in extractor/encoder.
- 17b — SignedProperties to the SDK template (SigningCertificate v1 + IssuerSerial, hex-then-base64 digests, `Target="signature"`, no DataObjectFormat, no extra c14n transform on the SignedProperties reference); the signature policy becomes optional configuration (the standard lists it, the SDK ignores it) and must never block posting; decide with ZATCA whether KeyInfo carries the leaf (SDK samples) or the chain (Security Features req 17) — NOT VERIFIED.
- 17c — QR: tag 6 = hash text, tag 7 = SignatureValue text, tag 8 = DER SPKI, tag 3 = XML date/time; genesis PIH = base64(hex(sha256("0"))) (the value fixed by XML Standard v1.2, BR-KSA-26); shared bounded TLV helper that throws above 255 bytes.

**Out of scope.** Certificate onboarding (REM-19).

**Acceptance criteria.**
- [ ] SDK `[QR]` and `[SIGNATURE]` stages PASSED for simplified fixtures; first PIH equals the official constant; a 256-byte value is rejected with a coded error.

**Regression tests.**
- Golden comparisons against the official signed sample; REM-11 matrix; tag layout test; TLV overflow tests.

**Risk and rollout.** High but isolated: pure functions with the SDK as oracle.

#### REM-18 — E-invoice credit and debit notes (type 381/383) with BillingReference

| | |
|---|---|
| Tier · priority | Tier 2 · P0 |
| Closes findings | PH1-06 (P1), PH2-05 (P0) |
| Depends on | REM-16, REM-02 |
| Decisions (ADR) | ADR-E |
| Effort · owner | L (6–10 d) · Backend (ZATCA) |

**Why.** Credit and debit notes are not e-invoiced at all (no XML, QR, hash, ICV/PIH, signature or submission — PH2-05 P0); sales credit notes and returns carry no QR or mandatory reference to the original invoice (PH1-06).

**Scope.** Document-agnostic ZATCA pipeline shared by invoices, credit notes, debit notes and `ReturnDocument`; `CreditNoteService::post`, `ReturnService::post`.

**Approach.**
- Type code, `BillingReference`, `InstructionNote` (reason), QR for simplified notes, ICV/PIH on the tenant/EGS chain, submission attempts for notes.
- Rules: the type-code list is BR-KSA-05, the reason BR-KSA-17 (error) and the billing reference BR-KSA-56 (only a warning in the SDK, although BT-25 is mandatory in the Data Dictionary and IR Art. 54(4)–(5)). Make the reference and the reason required for sales notes (ADR-E): the reference is a Phase 1 duty, the reason a Phase 2 duty (R1-113, R1-116); one note may adjust several invoices of the same customer (R1-117), so use a note↔invoice link table rather than a single mandatory foreign key.

**Out of scope.** Credit-note VAT basis (REM-02).

**Acceptance criteria.**
- [ ] A posted credit note gets ICV n+1 with the PIH of the previous document, type 381, a BillingReference and passes the SDK validation.

**Regression tests.**
- Note XML shapes in the REM-11 matrix; chain continuity across invoices and notes; reason/reference required.

**Risk and rollout.** Medium.

#### REM-19 — Onboarding lifecycle: CSR → compliance CSID → compliance checks → production CSID → renewal

| | |
|---|---|
| Tier · priority | Tier 2 · P1 |
| Closes findings | PH2-09 (P1), CON-11 (P2) |
| Depends on | REM-17 |
| Decisions (ADR) | ADR-C |
| Effort · owner | XL (11–15 d) · Backend (ZATCA) |

**Why.** There is no onboarding flow; credentials are pasted in (PH2-09).

**Scope.** CSR generation (server-side private key, certificate template and subject binding), OTP handling, compliance and production CSID calls through the transport, renewal and revocation, per-EGS credential model with validity windows.

**Approach.**
- Implement against the sandbox/simulation only until REM-26 gates pass; no production calls from automated tests (use fakes).
- Key custody (CON-11): generate the key server-side in the CSR step, never return it, wrap it with a managed key where available, require a new key at each CSID renewal.
- Validator rejects a CSID whose SAN/UID VAT differs from the tenant VAT and a test-template certificate stored under production.

**Out of scope.** Dispatch enablement.

**Acceptance criteria.**
- [ ] CSR output matches the SDK structure (golden); onboarding state machine covered by transport fakes; mismatching certificates rejected.

**Regression tests.**
- CSR golden (`openssl req -text`); validator rejection cases; state-machine tests with `Http::fake`.

**Risk and rollout.** High: first live-facing code; requires a separate approval to run against any ZATCA environment.

#### REM-20 — E-invoicing as a default-on capability for KSA tenants

| | |
|---|---|
| Tier · priority | Tier 2 · P1 |
| Closes findings | PH1-03 (P1), SEC-08 (P3) |
| Depends on | — |
| Decisions (ADR) | — |
| Effort · owner | S (1–2 d) · Backend + Web |

**Why.** `compliance.zatca` is an optional application; fresh tenants start with it disabled, the invoice page's QR comes from the gated endpoint, so QR and ICV are absent for tenants that never enabled it (PH1-03); gating is inconsistent (SEC-08).

**Scope.** `ApplicationCatalog` mandatory/default for KSA tenants; invoice page reads `InvoiceResource.zatca.qr`; signing/transmission consult `statusFor('compliance.zatca')`.

**Approach.**
- Make the capability mandatory (or default-enabled) for KSA tenants — pre-production, so no grandfathering cut-over is needed; keep `/zatca` for XML/hash details. The capability toggle may gate administration surfaces only: generation, signing and transmission stay mandatory and independent of it (R1-001, R1-003, R1-016) — an opt-out of the obligation is ZATCA's decision, not the tenant's.

**Acceptance criteria.**
- [ ] Fresh tenant: invoice page shows the QR with no enablement step; suspended app → no transmission readiness.

**Regression tests.**
- Fresh-tenant invoice data source contains QR; web test that `DocQr` renders from `invoice.zatca.qr`; suspended app blocks readiness.

**Risk and rollout.** Low.

### Tier 3 — Submission reliability & recovery

#### REM-21 — Submission outcome classification and request contract

| | |
|---|---|
| Tier · priority | Tier 3 · P1 |
| Closes findings | SUB-02 (P2), SUB-03 (P1), SUB-11 (P2), SUB-15 (P3) |
| Depends on | REM-16 |
| Decisions (ADR) | — |
| Effort · owner | M (3–5 d) · Backend (ZATCA) |

**Why.** Acceptance is inferred from HTTP status alone (200/202 ⇒ accepted) and non-rejection statuses are recorded as rejected (SUB-02, SUB-11); the request lacks `uuid` and the clearance header (SUB-03); minor contract items (SUB-15). "Queued" must never read as "accepted".

**Scope.** `ZatcaHttpTransport`, `ZatcaSubmissionService::complete`, attempt model/states, notification text.

**Approach.**
- Explicit status map following R2-057 (200 accepted, 202 accepted with warnings, 303 clearance disabled → Reporting API, 400 rejected, 401, 413, 429/5xx resend) with a `failure_category`; read the status fields that exist (only `NOT_REPORTED` is evidenced); redirects not followed; non-JSON 200 treated as failed; `unknown` reopenable state.
- Body `{invoiceHash, uuid, invoice}` with `uuid` equal to the XML `cbc:UUID` (SDK `-invoiceRequest` output; the Developer Portal manual FAQ shows a two-key body — confirm against the sandbox API reference); the `Clearance-Status` header is RECALLED-UNVERIFIED (R2-055) and must be confirmed before use; blocker codes in the 422 response.

**Out of scope.** Real transmission (needs REM-00A / dispatch gate).

**Acceptance criteria.**
- [ ] Matrix of responses → state/category assertions; JSON status mismatch is not accepted; redirect → failed.

**Regression tests.**
- Response-matrix tests with inverted expectations; uuid-mismatch preflight failure; update the transport test that enshrines the two-field body.

**Risk and rollout.** Medium; verify headers/body against the sandbox reference before any live use.

#### REM-22 — In-doubt state, claim lease, HTTP outside the DB transaction, DB-level attempt uniqueness

| | |
|---|---|
| Tier · priority | Tier 3 · P2 |
| Closes findings | SUB-06 (P3), SUB-09 (P2), SUB-13 (P3) |
| Depends on | REM-21 |
| Decisions (ADR) | ADR-D |
| Effort · owner | M (3–5 d) · Backend (ZATCA) |

**Why.** After a timeout the retry resends the same document — which is the documented behaviour, since ZATCA counts a duplicate once (R2-061) — but AWJ records transfer exceptions as non-retryable preflight failures and has no `unknown` state for audit (SUB-06, P3); the HTTP call runs inside an open transaction holding a row lock (SUB-09); one-open-attempt and no-attempt-after-acceptance rules are service-only (SUB-13).

**Scope.** `ZatcaSubmissionService`/`ZatcaSubmissionDispatcher`, attempt table (state, `claimed_at`, `lease_until`), partial unique index.

**Approach.**
- `sending` state with lease; move HTTP outside the transaction; sweep expired leases to `unknown`; reconcile step before any retry of `unknown`.
- Partial unique index (PostgreSQL) with a SQLite fallback.

**Out of scope.** Scheduler (REM-23).

**Acceptance criteria.**
- [ ] HTTP callback runs at transaction level 0; crash simulation leaves `sending` with a lease and the sweep moves it to `unknown`; duplicate pending insert fails on PostgreSQL.

**Regression tests.**
- Transaction-level assertion; crash/lease simulation; timeout ⇒ unknown; retry after unknown needs reconcile.

**Risk and rollout.** Medium.

#### REM-23 — Orchestration: worker, scheduler, automatic submission, 24-hour reporting clock

| | |
|---|---|
| Tier · priority | Tier 3 · P0 |
| Closes findings | SUB-05 (P0), OPS-01 (P1) |
| Depends on | REM-22, REM-00A |
| Decisions (ADR) | ADR-D |
| Effort · owner | L (6–10 d) · Backend + DevOps |

**Why.** Production pins `QUEUE_CONNECTION=sync` with no worker or scheduler (OPS-01); there is no automatic submission, no UI and no 24-hour deadline tracking for simplified invoices (SUB-05, P0).

**Scope.** Deployment (`render.yaml`/Dockerfile: worker + scheduler services, `pcntl`), `SendZatcaSubmission`, new `zatca:sweep` command, `zatca_reporting_due_at`, readiness heartbeat.

**Approach.**
- 23a — infrastructure: worker + scheduler services, heartbeat key checked by `ZatcaTransportReadiness`.
- 23b — on `posted` (simplified) create an `automatic` attempt and enqueue; `zatca_reporting_due_at`; sweep for stale `queued_at`, retryable failures and approaching deadlines.

**Out of scope.** Dispatch enablement (separate approval).

**Acceptance criteria.**
- [ ] Posting a simplified invoice with `submission_mode=automatic` creates a pending attempt and a job; the sweep re-queues stale attempts; readiness reports `worker_unavailable` when the heartbeat is stale; deadline notification fires at T-x.

**Regression tests.**
- Automatic attempt creation; sweep; heartbeat; `queue:work --once` smoke job in CI.

**Risk and rollout.** Medium: first persistent background workload in production.

#### REM-24 — Release gate for standard invoices, cleared-XML consumption and the correction flow

| | |
|---|---|
| Tier · priority | Tier 3 · P0 |
| Closes findings | SUB-01 (P0), SUB-04 (P1), SUB-07 (P1), CON-09 (P2) |
| Depends on | REM-21, REM-23 |
| Decisions (ADR) | ADR-D |
| Effort · owner | L (6–10 d) · Backend + Web |

**Why.** Standard (B2B) invoices are issued, printed and shared before — and independently of — Clearance (SUB-01, P0); the cleared XML/QR is stored but never used (SUB-04); a rejected invoice cannot be corrected, resubmission resends the same XML (SUB-07).

**Scope.** E-invoice lifecycle state driven only by `ZatcaSubmissionService::complete()`; gating of `InvoiceResource.zatca`, `GET …/zatca`, print/PDF/share/thermal, POS receipt; QR extraction from `zatca_cleared_xml`.

**Approach.**
- 24a — lifecycle + gating by document type (ADR-D): standard gated on `cleared`, simplified printable with reporting state shown.
- 24b — serve the QR and XML returned by clearance; archive the cleared XML; add a PDF/A-3 with the cleared XML embedded for sharing and name files per XML Standard §14 (CON-09, R1-038/042, R2-035/037).
- 24c — correction: a rejected document requires a new document (ICV+1, PIH of the last generated), never a resubmission of the same XML.

**Out of scope.** Notes (REM-18).

**Acceptance criteria.**
- [ ] Standard invoice: before clearance `/zatca` is refused and the resource shows the state; after a faked 200 clearance the QR equals the one in `clearedInvoice`; resubmission of a rejected XML is refused.

**Regression tests.**
- Gate matrix by type/state; cleared QR extraction; correction flow chain continuity.
- Existing Playwright spec that pins the two-state document lifecycle and must be updated with the new states (not reverted): `e2e/awj-v3-h2-workspaces.spec.ts:71-75` (Demo Mode, so it does not exercise the backend gate — a Feature test is still needed).

**Risk and rollout.** High product impact: changes when customers receive documents — needs the ADR and a feature flag.

#### REM-25 — Environment-scoped ICV/PIH chain and attempts; guard environment switching

| | |
|---|---|
| Tier · priority | Tier 3 · P2 |
| Closes findings | PH2-10 (P2), SUB-08 (P2), SUB-10 (P2), SUB-12 (P2), SEC-06 (P2) |
| Depends on | REM-19 |
| Decisions (ADR) | ADR-C |
| Effort · owner | M (3–5 d) · Backend (ZATCA) |

**Why.** One ICV/PIH chain spans developer, simulation and production (PH2-10, SUB-10); attempts carry no environment (SUB-08, SEC-06); `active_environment` can be set to an environment without credentials (SUB-12).

**Scope.** Invoice `zatca_environment`/`signing_environment`; attempt columns (`environment`, `certificate_fingerprint`, `endpoint`); chain scope; `UpdateZatcaSettingsRequest`.

**Approach.**
- ADR-C: chain keyed by (tenant, EGS unit/environment), reset on production onboarding; legacy stub-era invoices (test data) reset or flagged and excluded from submission.
- Validate environment/credential at save; block switching while attempts are pending; audit-log the change.

**Acceptance criteria.**
- [ ] Switching environments starts a new chain; the first production invoice PIH equals the genesis constant; saving an environment without credentials returns 422.

**Regression tests.**
- Chain scoping per decision; env mismatch preflight failure; legacy rows never queued; PUT without credential → 422.

**Risk and rollout.** Medium: a flagging/reset step for existing test rows is part of the change.

#### REM-26 — Fail-closed hardening and readiness depth

| | |
|---|---|
| Tier · priority | Tier 3 · P1 |
| Closes findings | PH2-07 (P1), OPS-03 (P2), SEC-03 (P1), SEC-13 (P3), CON-10 (P2), CON-11 (P2) |
| Depends on | REM-19, REM-25 |
| Decisions (ADR) | — |
| Effort · owner | M (3–5 d) · Backend (ZATCA) |

**Why.** Any credential row switches the whole tenant to fail-closed signing and halts all invoicing on expiry or misconfiguration (PH2-07, SEC-03); readiness checks are shallow (OPS-03); raw exception text reaches 422 bodies (SEC-13).

**Scope.** `ZatcaSigningReadiness`, `ZatcaTransportReadiness`, credentials listing (`DecryptException`), error mapping in `ZatcaService`.

**Approach.**
- Signed path enabled by an explicit, validated per-environment flag; expiry warnings N days ahead; synthetic connectivity probe behind opt-in; `undecryptable` credential state; coded business errors instead of raw messages.
- Recovery paths: deleting or disabling a credential restores Phase 1 posting only for tenants before their integration date; afterwards the only compliant fallback is the contingency procedure (notify ZATCA, issue manually, regenerate — CON-05, R1-063), never unsigned output.
- CRL/OCSP revocation check before stamping, with the CRL cached for at most its 7-day validity window (Security Features req 14 — CON-10); fail closed with a coded error when the certificate is revoked or the CRL is stale.

**Acceptance criteria.**
- [ ] Misconfiguration is rejected at save, not discovered at posting; error bodies contain no filesystem paths.

**Regression tests.**
- Each new blocker code; credential delete/disable restores phase-1 posting only before the tenant's integration date; key rotation returns 200 with a status flag; no `/tmp` path in error body.

**Risk and rollout.** Low–medium.

#### REM-27 — Observability, sweeps, notification digest and operator runbook

| | |
|---|---|
| Tier · priority | Tier 3 · P1 |
| Closes findings | OPS-02 (P1), OPS-04 (P2), SUB-14 (P3), CON-05 (P2) |
| Depends on | REM-23 |
| Decisions (ADR) | ADR-D |
| Effort · owner | M (3–5 d) · Backend + Web + Ops |

**Why.** No tenant-wide attempt list or counts, no dispatch/result logging or metrics (OPS-02); job failures outside the dispatcher leave attempts pending silently (OPS-04); one critical alert per failed attempt (SUB-14); no incident/contingency workflow or runbook (CON-05).

**Scope.** `GET /zatca/submissions` (tenant-wide, branch-aware), log + metric hooks, invoice-page ZATCA panel, backlog widget, failed-job hook, digest notifications, runbook document.

**Approach.**
- Index filters/counts; structured logs on each transition; failed-job hook flags the attempt and notifies; digest + backlog counter; bulk retry endpoint.
- Runbook: failure-notification form, uncleared-invoice handling, manual-invoice regeneration, escalation.

**Acceptance criteria.**
- [ ] Operator sees backlog by status; a failed job produces exactly one digest notification; runbook reviewed by Compliance.

**Regression tests.**
- Index filters/counts; log assertions per transition; failed-job hook test; digest aggregation window.

**Risk and rollout.** Low.

### Tier 4 — VAT reporting & reconciliation gaps

#### REM-28 — Saudi VAT return, VAT-period freeze and reconciliation

| | |
|---|---|
| Tier · priority | Tier 4 · P1 |
| Closes findings | ACC-03 (P1), ACC-04 (P1), ACC-11 (P3), ACC-12 (P3) |
| Depends on | REM-05, REM-06, REM-12 |
| Decisions (ADR) | ADR-G |
| Effort · owner | XL (12–20 d, 28a–28d) · Backend + Web + Finance |

**Why.** The "tax report" is three numbers from two account codes with no boxes, categories or reconciliation (ACC-03); filed figures drift through back-dated documents because there is no VAT-period freeze (ACC-04); manual journals hit VAT accounts without a reason (ACC-11); the branch-filtered report drops company-wide VAT lines (ACC-12).

**Scope.** `VatPeriod` entity (open/filed/amended, snapshot of box values and document list), box-mapping rules, drill-down endpoints, GL↔return reconciliation, CSV/PDF export, `AccountingDateGuard`/`VatPeriodGuard`, manual-journal reason.

**Approach.**
- 28a — quick fix: `unallocated` handling in `taxReport` (ACC-12) and reason on manual VAT journals (ACC-11).
- 28b — `VatPeriod` + freeze (ACC-04, ADR-G) wired to the accounting lock; no tolerance admits a future-dated e-invoice (BR-KSA-04).
- 28c — box mapping and return workspace using REM-12 categories (ACC-03): boxes 1, 1.2, 2, 3–16 as in register §3 (no intra-GCC box), filing frequency per IR Art. 58, and the three-case credit/debit-note adjustment table (Amount vs Adjustments field).
- 28d — reconciliation and export.

**Out of scope.** Filing with ZATCA (manual).

**Acceptance criteria.**
- [ ] Box totals from a fixture covering each category; filed snapshot unchanged after later corrections; reconciliation is zero after the mixed scenario; future-dated and filed-period postings are rejected or redirected.

**Regression tests.**
- Box totals per category; period snapshot immutability; reconciliation after mixed scenario; guard tests.

**Risk and rollout.** Medium: new period concept; ship behind a tenant setting.

#### REM-29 — Tax point, supply date and advance payments (prepayment invoices, type 386)

| | |
|---|---|
| Tier · priority | Tier 4 · P2 |
| Closes findings | CON-03 (P2), CON-07 (P2) |
| Depends on | REM-16, REM-28 |
| Decisions (ADR) | ADR-G |
| Effort · owner | L (6–10 d) · Backend |

**Why.** Receipts post to AR only and tax due at receipt of consideration is not modelled (CON-03); there is no supply-date capture, no earliest-of(supply, invoice, payment) tax point and no invoice-issuance deadline control (CON-07).

**Scope.** Supply-date field, tax-point derivation (earliest of supply, invoice, payment), issuance-deadline warning, prepayment document type, XML `PrepaidAmount`/adjustment invoices (R2-031) and `ActualDeliveryDate`.

**Approach.**
- Design per ADR-G; reuse REM-12 categories and the REM-16 builder; the tax point then refines the VAT-period assignment that REM-28 first builds on the invoice date.

**Acceptance criteria.**
- [ ] A receipt before supply generates a prepayment invoice with VAT at the receipt date; the final invoice nets it.
- [ ] The tax point is the earliest of supply, invoice and payment dates; an invoice issued after the 15th of the month following the supply is flagged.

**Regression tests.**
- Prepayment lifecycle fixtures through the SDK harness.

**Risk and rollout.** Medium.

#### REM-30 — Commerce/storefront order → invoice path and VAT on online sales

| | |
|---|---|
| Tier · priority | Tier 4 · P2 |
| Closes findings | VAT-16 (P3), ACC-08 (P2) |
| Depends on | REM-10, REM-28 |
| Decisions (ADR) | ADR-F |
| Effort · owner | L (6–10 d) · Backend (commerce) |

**Why.** Storefront orders carry no VAT and never reach VAT recognition (VAT-16, ACC-08). This is consistent with "CommerceOrder ≠ Invoice" but its VAT consequence is undocumented.

**Scope.** Order→invoice conversion service with tax-point policy; warning in the VAT workspace for paid orders without an invoice until then.

**Approach.**
- ADR-F first; then idempotent conversion through `InvoiceService`/`PaymentService`; derive the price mode from `sales.default_tax_inclusive`.

**Out of scope.** Changing the Commerce contract.

**Acceptance criteria.**
- [ ] A paid order yields exactly one posted invoice with matching VAT; retry is idempotent; the tax point date is recorded.

**Regression tests.**
- Paid order → one invoice; idempotent retry; tax-point date.

**Risk and rollout.** Medium; deferred by design until the ADR is approved.

#### REM-31 — Credit/debit-note issuance deadline and adjustment-period controls

| | |
|---|---|
| Tier · priority | Tier 4 · P2 |
| Closes findings | CON-02 (P2) |
| Depends on | REM-28 |
| Decisions (ADR) | ADR-E, ADR-G |
| Effort · owner | S (1–2 d) · Backend |

**Why.** No control for the 15th-of-month-after deadline for notes nor for the adjustment period of output-tax decreases (CON-02).

**Scope.** Warnings and (configurable) blocks when issuing notes beyond the deadline; report of notes by tax period.

**Approach.**
- Setting-driven policy (ADR-E/ADR-G); default warn-only.

**Acceptance criteria.**
- [ ] A note issued after the deadline is flagged and appears in the VAT workspace adjustment column.

**Regression tests.**
- Deadline boundary tests.

**Risk and rollout.** Low.

#### REM-32 — Unsupported VAT scenarios: reverse charge, imports, restricted input VAT, proportional deduction, bad-debt relief, deemed supplies, margin scheme, export evidence, capital assets

| | |
|---|---|
| Tier · priority | Tier 4 · P2 |
| Closes findings | CON-04 (P2), CON-08 (P2) |
| Depends on | REM-12, REM-28 |
| Decisions (ADR) | ADR-I |
| Effort · owner | L (6–10 d) per case family · Backend |

**Why.** Not supported (CON-04, CON-08); relevant for the VAT return boxes 8–9, deemed-supply output VAT and input-tax correctness.

**Scope.** Purchase-side tax categories/flags and report boxes.

**Approach.**
- Scope by customer demand; implement after REM-12/REM-28; document the unsupported cases to tenants until then.

**Acceptance criteria.**
- [ ] Documented scope statement in product and API; supported cases covered by fixtures.

**Regression tests.**
- Fixture per supported case.

**Risk and rollout.** Low if scoped.

#### REM-33 — Report-layer tenant guard, reversal source link, change-log retention and audit-trail completeness

| | |
|---|---|
| Tier · priority | Tier 4 · P2 |
| Closes findings | ACC-07 (P2), ACC-09 (P3), ACC-10 (P2), CON-13 (P2) |
| Depends on | REM-07 |
| Decisions (ADR) | ADR-J |
| Effort · owner | M–L (5–8 d, split 33a–33b) · Backend |

**Why.** `TenantScope` is a silent no-op without context and the report layer does not assert one (ACC-07); reversal journals carry no `source_type/source_id` (ACC-09); the document change log is pruned after two years and omits notes/returns/expenses (ACC-10); there is no login trail, no password change at first use, no deletion logging and no append-only guard on log rows — Detailed Guidelines §5.6 (CON-13).

**Scope.** `ReportService`, `FinancialControlService`, `FiscalCloseService`; reversal posting; `DocumentRevision` retention/types.

**Approach.**
- `requireTenant()` guard; populate reversal source; stop pruning the document change log before the statutory window (drop `Prunable` or retain ≥ 6 years from the end of the tax period — it is a log whose deletion is a prohibited function, R1-027) and extend `TYPES` to notes, returns, expenses, payments and manual journals.
- 33b — audit-trail completeness (CON-13): `auth_events` table and listeners (login, failed login, logout, token revocation, password change); `must_change_password`/`password_changed_at` for administrator-set passwords; "deleted" revisions for every document type that has revisions (including draft deletion); append-only guards on revision and event rows at model and database level; a server-side output-event endpoint for print/PDF/share/export of tax documents.

**Acceptance criteria.**
- [ ] `taxReport()` without a tenant context throws; reversal carries the original source; prune respects the floor.

**Regression tests.**
- Report without tenant throws; reversal entry carries source + `reversal_of`; prune floor; revision written for note/return/expense edits; login success and failure write an event; an administrator-set password forces a change; draft deletion writes a revision; update/delete on revision and event rows is rejected.

**Risk and rollout.** Low.

### Tier 5 — UX, operational & hygiene

#### REM-34 — Document rendering and labelling (drafts, thermal receipt, compliance copy, language)

| | |
|---|---|
| Tier · priority | Tier 5 · P2 |
| Closes findings | PH1-10 (P2), PH1-11 (P2), PH1-13 (P2), PH1-15 (P2), CON-06 (P2) |
| Depends on | REM-13 |
| Decisions (ADR) | — |
| Effort · owner | M (3–5 d) · Web |

**Why.** Drafts print as "فاتورة ضريبية" with an allocated number (PH1-10); the POS thermal receipt uses the standard title for simplified invoices (PH1-11; the missing printed time is not a defect — Annex 2 row 3.2 does not require it on the printout); the print contract lets templates drop required visible fields and hard-codes a "(15%)" label (CON-06); the landing page and footer over-claim compliance (PH1-13); language `en` drops Arabic from tax invoices (PH1-15).

**Scope.** `DocumentBody` templates, POS receipt builder, landing copy, document language rules.

**Approach.**
- Watermark non-posted documents; simplified title on thermal; enforce the Annex 2 visible item columns for tax documents, derive the VAT label from the line rates, reconcile thermal totals with discount/shipping/adjustment and wrap (not truncate) item descriptions on the 58/80 mm receipt, pass the seller address into credit-note prints; footer only when `status = posted` and a QR exists; reword the landing claim; treat `en` as bilingual for tax documents.

**Acceptance criteria.**
- [ ] Render tests for each template: draft watermark, simplified title, no compliance footer without QR, Arabic present on tax documents.

**Regression tests.**
- Web render tests per template and language.
- Existing web tests that pin today's behaviour and must be changed in the same PR, with a justification rather than a silent edit (they are the reason the change is visible): `modules/documents/registry/document-types.test.ts:68-99` (a valid tax-invoice layout without quantity or unit price) and `:130-138` (`toEqual` on the column catalog); `use-document-label-mode.test.tsx:38` and the six `document-*-v2.test.tsx`/`document-modern.test.tsx` cases that assert English-only labels for a `tax_invoice` (PH1-15); `document-modern.test.tsx:289-317` (a draft asserted to carry `zatca_note` and `footer`, PH1-10/PH1-13); `e2e/invoice-detail-interactions.spec.ts:90` if printing is restricted to posted documents. Two further tests read `MODERN_TOTAL_LABELS.vat` by key (`document-modern.test.tsx:385-395`, `visual-v2.test.ts:91`): keep or migrate that key when the VAT label becomes rate-aware.
- Run the whole Vitest suite (`npm run test`) and the Playwright specs of the touched screens, not only the new tests.

**Risk and rollout.** Low.

#### REM-35 — Allocate invoice numbers at posting

| | |
|---|---|
| Tier · priority | Tier 5 · P3 |
| Closes findings | PH1-12 (P3) |
| Depends on | REM-34 |
| Decisions (ADR) | — |
| Effort · owner | M (3–5 d) · Backend |

**Why.** Numbers are allocated at draft, reused or gapped by draft deletion and restarted by a mid-year prefix change (PH1-12, P3). The register shows that a gap-free invoice number is not required (the ICV is) and that per-branch series are allowed (R1-103); the real exposure is a printed draft whose number is later reused by another invoice (PH1-10).

**Scope.** `GeneratesDocumentNumbers` use by invoices; prefix/suffix lock once used in the current year.

**Approach.**
- Allocate in `post()`; keep a separate draft reference; lock series settings once used.

**Out of scope.** ICV (never part of this layer).

**Acceptance criteria.**
- [ ] Drafts have no number; two drafts posted in reverse order get ascending numbers; prefix change after the first invoice is rejected.

**Regression tests.**
- Numbering tests on SQLite and PostgreSQL.

**Risk and rollout.** Medium: touches a core sequence — protect with the existing numbering tests.

#### REM-36 — Retention, durable storage and e-invoice export

| | |
|---|---|
| Tier · priority | Tier 5 · P1 |
| Closes findings | PH1-16 (P2), CON-01 (P1) |
| Depends on | REM-00A |
| Decisions (ADR) | ADR-H, ADR-J |
| Effort · owner | M (3–5 d) · Backend + Ops |

**Why.** Document-Center files older than 365 days can be purged, storage is local disk, no bulk export of XML/QR exists (PH1-16); records must be kept six years (and in the KSA — CON-01).

**Scope.** Retention planner (document-type-aware, never below six years for tax documents), durable storage configuration, `zatca:export` command.

**Approach.**
- Block purge of files classified as tax documents; retention classes anchored to the end of the tax period (6 years general, longer for capital assets, 15 years for real estate — the current 1–3 650-day clamp cannot express them); enable durable object storage in the permitted region (ADR-H/ADR-J); extend the existing owner export (`GET /api/account/export`, which already carries `zatca_xml/qr/hash`) with notes, returns, expenses, assets and document-centre files, an archive format and an integrity report.

**Acceptance criteria.**
- [ ] Retention planner refuses tax-invoice types younger than six years; export produces a verifiable archive.

**Regression tests.**
- Planner tests; export integrity test.

**Risk and rollout.** Low–medium (storage migration).

#### REM-37 — Separation of duties: dedicated `zatca.submit` permission

| | |
|---|---|
| Tier · priority | Tier 5 · P2 |
| Closes findings | SEC-07 (P2) |
| Depends on | — |
| Decisions (ADR) | — |
| Effort · owner | S (1–2 d) · Backend |

**Why.** ZATCA transmission is granted by `invoices.manage` alone and the settings metadata is readable to roles that should not see it (SEC-07).

**Scope.** `Rbac::PERMISSIONS`, role seeding, the two POST routes, settings `meta` split.

**Approach.**
- Add `zatca.submit` (accountant/admin), gate both routes, split metadata by permission.

**Acceptance criteria.**
- [ ] Roles without `zatca.submit` receive 403 on submission routes.

**Regression tests.**
- Role-matrix test.

**Risk and rollout.** Low; current submitters need a one-time permission grant.

#### REM-38 — Hygiene bundle (fractional-quantity validation, cleared-XML parser, CORS configuration, observations)

| | |
|---|---|
| Tier · priority | Tier 5 · P3 |
| Closes findings | VAT-17 (P3), PH1-19 (P3, obs.), PH2-15 (P3, obs.), SEC-09 (P3, obs.), SEC-10 (P3, obs.), SEC-11 (P3), SEC-12 (P3) |
| Depends on | — |
| Decisions (ADR) | — |
| Effort · owner | S–M (2–4 d) · Backend |

**Why.** Fractional quantities with non-decimal denominators pass draft validation but fail at posting (VAT-17); the cleared-XML parser does not reject DOCTYPE or check the UUID (SEC-11); CORS is open when `FRONTEND_URL` is unset (SEC-12); observations PH1-19, PH2-15, SEC-09, SEC-10 are documentation/optimisation notes. Two housekeeping items noted while the web tests were run belong here although they are not findings: `CLAUDE.md` still says the web app has no automated tests (Vitest and Playwright exist; Web CI runs Vitest), and `next dev` reports `INVALID_KEY` for six message keys that contain a dot.

**Scope.** `InvoiceLinePrecision`, cleared-XML parser reuse of `parseSecurely`, production config validation, documentation of the phase-1-only output, optional C14N optimisation.

**Approach.**
- Validate representability at draft; reuse the secure parser and check `cbc:UUID`; make `FRONTEND_URL` mandatory in production; expose `zatca_mode` on the resource; correct the stale test statement in `CLAUDE.md` (documentation only); rename the six dotted message keys (`appBuilder.builder.visibility.signalOption.cart.itemCount`, `…customer.isAuthenticated`, `…product.inStock`, `developer.events.partner.created`, `…product.created`, `…invoice.created` in `ar.json` and `en.json`) or flatten them to nested objects.

**Acceptance criteria.**
- [ ] Draft with 1/3 quantity is rejected; DOCTYPE in cleared XML rejected; production boot fails without `FRONTEND_URL`.

**Regression tests.**
- Draft validation; DOCTYPE rejection; config validation.
- `npm run test` and the console-clean Playwright specs pass without `INVALID_KEY` messages.

**Risk and rollout.** Low.

## 9. Finding → task traceability

Every finding of the audit (including the four observations and the five consolidator findings CON-01…CON-05) maps to exactly one task.

| Finding | Severity | Status | Task |
|---|---|---|---|
| VAT-01 | P0 | VERIFIED DEFECT | REM-01 |
| VAT-02 | P1 | VERIFIED DEFECT | REM-02 |
| VAT-03 | P1 | NOT IMPLEMENTED | REM-12 |
| VAT-04 | P3 | VERIFIED DEFECT | REM-16 |
| VAT-05 | P2 | VERIFIED DEFECT | REM-09 |
| VAT-06 | P1 | VERIFIED DEFECT | REM-16 |
| VAT-07 | P2 | VERIFIED DEFECT | REM-10 |
| VAT-08 | P2 | VERIFIED DEFECT | REM-10 |
| VAT-09 | P2 | VERIFIED DEFECT | REM-10 |
| VAT-10 | P3 | VERIFIED DEFECT | REM-10 |
| VAT-11 | P3 | NOT IMPLEMENTED | REM-12 |
| VAT-12 | P3 | PARTIALLY IMPLEMENTED | REM-10 |
| VAT-13 | P2 | VERIFIED DEFECT | REM-01 |
| VAT-14 | P3 | PARTIALLY IMPLEMENTED | REM-10 |
| VAT-15 | P3 | PARTIALLY IMPLEMENTED | REM-12 |
| VAT-16 | P3 | NOT IMPLEMENTED | REM-30 |
| VAT-17 | P3 | PARTIALLY IMPLEMENTED | REM-38 |
| ACC-01 | P1 | VERIFIED DEFECT | REM-05 |
| ACC-02 | P1 | PARTIALLY IMPLEMENTED | REM-06 |
| ACC-03 | P1 | NOT IMPLEMENTED | REM-28 |
| ACC-04 | P1 | NOT IMPLEMENTED | REM-28 |
| ACC-05 | P2 | VERIFIED DEFECT | REM-07 |
| ACC-06 | P2 | VERIFIED DEFECT | REM-02 |
| ACC-07 | P2 | VERIFIED DEFECT | REM-33 |
| ACC-08 | P2 | NOT IMPLEMENTED | REM-30 |
| ACC-09 | P3 | PARTIALLY IMPLEMENTED | REM-33 |
| ACC-10 | P2 | PARTIALLY IMPLEMENTED | REM-33 |
| ACC-11 | P3 | PARTIALLY IMPLEMENTED | REM-28 |
| ACC-12 | P3 | PARTIALLY IMPLEMENTED | REM-28 |
| PH1-01 | P1 | VERIFIED DEFECT | REM-13 |
| PH1-02 | P1 | VERIFIED DEFECT | REM-14 |
| PH1-03 | P1 | VERIFIED DEFECT | REM-20 |
| PH1-04 | P1 | VERIFIED DEFECT | REM-14 |
| PH1-05 | P1 | PARTIALLY IMPLEMENTED | REM-15 |
| PH1-06 | P1 | NOT IMPLEMENTED | REM-18 |
| PH1-07 | P2 | VERIFIED DEFECT | REM-17 |
| PH1-08 | P2 | VERIFIED DEFECT | REM-09 |
| PH1-09 | P2 | PARTIALLY IMPLEMENTED | REM-07 |
| PH1-10 | P2 | VERIFIED DEFECT | REM-34 |
| PH1-11 | P2 | VERIFIED DEFECT | REM-34 |
| PH1-12 | P3 | PARTIALLY IMPLEMENTED | REM-35 |
| PH1-13 | P2 | VERIFIED DEFECT | REM-34 |
| PH1-14 | P3 | VERIFIED DEFECT | REM-13 |
| PH1-15 | P2 | VERIFIED DEFECT | REM-34 |
| PH1-16 | P2 | PARTIALLY IMPLEMENTED | REM-36 |
| PH1-17 | P2 | PARTIALLY IMPLEMENTED | REM-16 |
| PH1-18 | P3 | VERIFIED DEFECT | REM-14 |
| PH1-19 | P3 (obs.) | VERIFIED IMPLEMENTED | REM-38 |
| PH2-01 | P0 | VERIFIED DEFECT | REM-17 |
| PH2-02 | P0 | VERIFIED DEFECT | REM-17 |
| PH2-03 | P0 | VERIFIED DEFECT | REM-17 |
| PH2-04 | P0 | VERIFIED DEFECT | REM-16 |
| PH2-05 | P0 | NOT IMPLEMENTED | REM-18 |
| PH2-06 | P2 | VERIFIED DEFECT | REM-17 |
| PH2-07 | P1 | VERIFIED DEFECT | REM-26 |
| PH2-08 | P1 | VERIFIED DEFECT | REM-13 |
| PH2-09 | P1 | NOT IMPLEMENTED | REM-19 |
| PH2-10 | P2 | VERIFIED DEFECT | REM-25 |
| PH2-11 | P2 | VERIFIED DEFECT | REM-17 |
| PH2-12 | P2 | VERIFIED DEFECT | REM-17 |
| PH2-13 | P2 | NOT IMPLEMENTED | REM-16 |
| PH2-14 | P2 | PARTIALLY IMPLEMENTED | REM-11 |
| PH2-15 | P3 (obs.) | VERIFIED IMPLEMENTED | REM-38 |
| PH2-16 | P3 | VERIFIED DEFECT | REM-14 |
| SUB-01 | P0 | VERIFIED DEFECT | REM-24 |
| SUB-05 | P0 | NOT IMPLEMENTED | REM-23 |
| SUB-02 | P2 | VERIFIED DEFECT | REM-21 |
| SUB-03 | P1 | VERIFIED DEFECT | REM-21 |
| SUB-04 | P1 | PARTIALLY IMPLEMENTED | REM-24 |
| SUB-07 | P1 | NOT IMPLEMENTED | REM-24 |
| OPS-01 | P1 | VERIFIED DEFECT | REM-23 |
| OPS-02 | P1 | NOT IMPLEMENTED | REM-27 |
| SUB-06 | P3 | PARTIALLY IMPLEMENTED | REM-22 |
| SUB-08 | P2 | VERIFIED DEFECT | REM-25 |
| SUB-09 | P2 | VERIFIED DEFECT | REM-22 |
| SUB-10 | P2 | NOT VERIFIED | REM-25 |
| SUB-11 | P2 | VERIFIED DEFECT | REM-21 |
| SUB-12 | P2 | VERIFIED DEFECT | REM-25 |
| OPS-03 | P2 | PARTIALLY IMPLEMENTED | REM-26 |
| OPS-04 | P2 | PARTIALLY IMPLEMENTED | REM-27 |
| SUB-13 | P3 | PARTIALLY IMPLEMENTED | REM-22 |
| SUB-14 | P3 | VERIFIED DEFECT | REM-27 |
| SUB-15 | P3 | VERIFIED DEFECT | REM-21 |
| SEC-01 | P1 | VERIFIED DEFECT | REM-03 |
| SEC-02 | P1 | VERIFIED DEFECT | REM-04 |
| SEC-03 | P1 | VERIFIED DEFECT | REM-26 |
| SEC-04 | P2 | VERIFIED DEFECT | REM-08 |
| SEC-05 | P2 | PARTIALLY IMPLEMENTED | REM-07 |
| SEC-06 | P2 | PARTIALLY IMPLEMENTED | REM-25 |
| SEC-07 | P2 | PARTIALLY IMPLEMENTED | REM-37 |
| SEC-08 | P3 | PARTIALLY IMPLEMENTED | REM-20 |
| SEC-09 | P3 (obs.) | VERIFIED IMPLEMENTED | REM-38 |
| SEC-10 | P3 (obs.) | VERIFIED IMPLEMENTED | REM-38 |
| SEC-11 | P3 | PARTIALLY IMPLEMENTED | REM-38 |
| SEC-12 | P3 | NOT VERIFIED | REM-38 |
| SEC-13 | P3 | VERIFIED DEFECT | REM-26 |
| CON-01 | P1 | NOT VERIFIED | REM-00A/REM-36 |
| CON-02 | P2 | NOT IMPLEMENTED | REM-31 |
| CON-03 | P2 | NOT IMPLEMENTED | REM-29 |
| CON-04 | P2 | NOT IMPLEMENTED | REM-32 |
| CON-05 | P2 | NOT IMPLEMENTED | REM-27 |
| CON-06 | P2 | VERIFIED DEFECT | REM-34 |
| CON-07 | P2 | NOT IMPLEMENTED | REM-29 |
| CON-08 | P2 | NOT IMPLEMENTED | REM-32 |
| CON-09 | P2 | NOT IMPLEMENTED | REM-24 |
| CON-10 | P2 | NOT IMPLEMENTED | REM-26 |
| CON-11 | P2 | PARTIALLY IMPLEMENTED | REM-19/REM-26 |
| CON-12 | P2 | VERIFIED DEFECT | REM-10 |
| CON-13 | P2 | PARTIALLY IMPLEMENTED | REM-33 |

