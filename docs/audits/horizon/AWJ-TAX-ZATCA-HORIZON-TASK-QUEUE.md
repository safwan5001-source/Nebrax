# AWJ-TAX-ZATCA-HORIZON — Task Queue (Bootstrap V1)

> **Owner decision 2026-10-11:** TAX-ZATCA designated as the sole active Horizon on merge of activation PR #1324. Delivery execution is paused. TAX-HZ-00 is the first permitted read-only evidence pass. Candidate REM implementation remains gated on that pass and subsequent owner-approved task scope and merge approvals.


**Status:** ~~PROPOSED / NOT ACTIVATED~~ — **superseded by the owner activation decision above (TAX-ZATCA is the sole active Horizon since the merge of #1324).** Current task status: `TAX-ZATCA-RECONCILIATION-AUDIT.md` (audited at `main` `76b05f6`, 2026-10-14). This file is an *overlay* on the canonical 40-task audit remediation queue; it does not replace that queue or the current active Delivery Horizon in `docs/autonomous-engineering/TASK-QUEUE.md`.

## State vocabulary
- `merged`: PR merged on GitHub; not automatically deployed.
- `evidence-needed`: must verify current repository or external regulatory fact before implementation.
- `decision-gated`: requires explicit owner decision before scope/behavior.
- `candidate`: dependency may be ready, but no fresh evidence pass yet.
- `blocked`: prerequisite or safety gate outstanding.
- `active`: only after separate Horizon activation/handoff recorded.
- `done`: all defined verification and post-merge gates evidenced; do not equate with production release.

## Completed merged foundation
| ID | Merged evidence | Current status |
|---|---|---|
| AUDIT-1 | #1290 | merged (audit documents) |
| REM-01 | #1291, merge `999e06c52cd9e7dba3d8e16b3be00fc8d9ad9fa0` | merged, production not verified |
| REM-02 | #1304, merge `56fcac621411a10506ed626f43b4d5a99b2ed798` | merged, production not verified |
| PRINT-01 | #1315, merge `3209fcb77cc4e02b729bb74c34adf7e131869a1b` | merged, physical printer not verified |
| PRINT-02 | #1320, merge `265974693502bc734ff0e9dbd12123bf3f345b51` | merged, evidence/docs only |
| TAX-HZ-00 | #1398, merge `0c90419874594169d422515e881425e5b3b3fa70` | merged (evidence pass documents) |
| REM-03 | #1403, merge `c589ced1dcbad88ef023d8be6ead34bc58f489f0` | merged, post-merge `CI` run #9327 success, production not verified |
| REM-03b | #1410, merge `322c20cf009e0f1c917566e4930b689764651b60` | merged, post-merge `CI` run #9351 success, production not verified |
| REM-08 | #1415, merge `6670a9a7e5df063d8d42ad6872a0b5599ae8bb11` | merged, post-merge `CI` run #9359 success, production not verified |
| REM-11 | #1416, merge `cb87e17d7583d8b24eab76e87ae5dad1d78484b3` | merged (advisory SDK harness), `CI` run #9365 success; D-03a open; production not verified |
| REM-37 | #1419, merge `ff8e2332d23d156de2ca6f79646da2eccc7da4e8`; review fixes #1445, merge `38e259c8a7b2776f0f00da8ff1d14b9453e9f139` | merged, `CI` runs #9424 / #9444 success, production not verified |
| TAX-N01 | #1444, merge `17dc59af83c44ed3f4b3a4f9c59f61a5f5d3ea36` | merged, `CI` run #9437 success, production not verified |
| REM-04 | #1450, merge `899bcba4f3ecfbe4bf504c2276db2dc817daff42`; follow-up #1461, merge `51851c04ae11ac90c14e223bc44456765d0dc535` | merged, `CI` runs #9456 / #9515 success, production not verified |
| REM-05 | #1457, merge `a8a950508d533805530c324d51595fe46cdaa682` | merged, `CI` run #9532 success, production not verified |
| REM-06 | #1473, merge `76b05f69a32fb7d2c5d741708661261dfc01d6cf` | merged, `CI` run #9596 success (sqlite + pgsql), production not verified; Fiscal Close VAT line follow-up open |

> **Status update (2026-10-14).** "Merged" is not "deployed", "SDK-validated" or "compliant". The foundation list is limited to merged PRs; for everything else (including the August 2026 ZATCA pipeline PRs #503–#593 and the closed-without-merge drafts #587–#591, whose implementation was incorporated through #592) see `TAX-ZATCA-RECONCILIATION-AUDIT.md`.

## Initial queue (not an authorization to implement)
| Order | ID | Source | Depends on | Initial status | Definition of next gate |
|---:|---|---|---|---|---|
| 0 | TAX-HZ-00 | Evidence + decisions / REM-00A, REM-00B | none | decision-gated | Owner resolves active-vs-concurrent horizon, verifies production-data classification; current-main gap delta |
| 1 | REM-03 | Audit SEC-01 | none | candidate | Scope branch mutation authorization and negative tests; confirm not already fixed |
| 2 | REM-11 | Audit PH2-14 | none | candidate | Official ZATCA SDK version and offline CI harness / fixtures evidence |
| 3 | REM-04 | Audit SEC-02 | none | candidate | Verify invoice-post concurrency against latest lock-order work; avoid duplicate fix |
| 4 | REM-05 | Audit ACC-01 | none | candidate | VAT account roles and report contracts evidence |
| 5 | REM-08 | Audit SEC-04 | none | candidate | Verify revoked/disabled-user API access |
| 6 | REM-09 | Audit VAT-05, PH1-08 | none | candidate | Overflow guards and integer arithmetic regression |
| 7 | REM-12 | Audit VAT-03, VAT-11, VAT-15 | none | candidate | Regulatory rate/category design and owner ADR |
| 8 | REM-13 | Audit PH1-01, PH1-14, PH2-08 | none | candidate | Posting-time issue timestamp freeze tests |
| 9 | REM-06 | Audit ACC-02 | REM-05 | blocked | VAT role fixes merged/post-merge verified |
| 10 | REM-10 | Audit VAT-07/08/09/10/12/14, CON-12 | REM-09 | blocked | Arithmetic guard merged + owner rules |
| 11 | REM-14 | Audit PH1-02/04/18, PH2-16 | REM-13 | blocked | Issue time freeze merged and seller/buyer snapshot ADR |
| 12 | REM-16 | Audit VAT-04/06, PH1-17, PH2-04/13 | REM-11/12/13/14 | blocked | Validator, categories, time, party snapshots |
| 13 | REM-17 | Audit stamp/QR findings | REM-11/13 | blocked | SDK oracle and issue time |
| 14 | REM-18 | Audit note e-invoicing | REM-16 + REM-02 | blocked | Valid UBL invoice + sourced notes |
| 15 | REM-19–38 | Canonical remediation plan | per source matrix | blocked / unassessed | Recompute per item from current evidence; do not promote in bulk |

> **Status update (2026-10-14).** The *Initial status* column above is the bootstrap snapshot and is kept as authored. Since then REM-03 (+03b), REM-04 (+follow-up), REM-05, REM-06, REM-08 and REM-11 were merged (see the foundation table); REM-09, 12, 13, 14 and 16–18 remain unmerged. REM-06 was unblocked by REM-05. Current per-task status, counts and the dependency graph: `TAX-ZATCA-RECONCILIATION-AUDIT.md`.

> **Status update (2026-10-15, documentation only).** D-05 is **partially recorded, not resolved.** ADR-A, ADR-I and ADR-B direction is recorded in `docs/decisions/ADR-0001-invoice-issue-timestamp.md`, `docs/decisions/ADR-0002-vat-categories-and-exemptions.md` and `docs/decisions/ADR-0003-monetary-rounding-and-tax-totals.md`. REM-12, REM-13 and REM-10/16 remain decision-gated by the open regulatory gates listed in those ADRs; tax-adviser sign-off and ZATCA clarification (D-06/TAX-E01) are not obtained. **REM-13a** (persist the issuance instant at the posting boundary, preserve it through reprint/resend, align XML/QR timestamp generation with the approved representation contracts) is the *proposed* next implementation slice — **PROPOSED, NOT AUTHORIZED, NOT IMPLEMENTED; a database migration adding `issued_at` is NOT YET AUTHORIZED.**
>
> **Update 2026-10-15 (REM-13a).** The owner authorised REM-13a (Option 1) including the `invoices.issued_at` migration; it is **implemented in one Draft PR, not merged, not deployed** (`REM-13a-IMPLEMENTATION-REPORT.md`). XML `IssueTime` is settled by BR-KSA-70 (AST, no `Z`); QR tag-3 text (**Q1**) and the BR-KSA-04 time zone (**Q2**) remain unresolved regulatory questions for D-06 / TAX-E01 and no QR format was changed. REM-14 stays blocked on the merge of REM-13a.

Other independent tasks REM-07, REM-20, REM-37, REM-38 and tier dependencies stay in the **canonical** remediation plan; not omission or closure.

## Special follow-ups from prior merged work
- POS partial return versus API cumulative rounding: preserve source VAT cap and all REM-01 regression tests; do not change convention without owner-approved financial behavior decision.
- Saved/frozen layouts: credit-note discount columns not selectable via all historical persisted print contracts. Follow up before broad production print certification.
- A5 unsupported; thermal physical device test outstanding.
- Legacy credit-note finance review command and tenant/branch authorization require production operating plan; no historical writes without authorization.

## Per-task execution record template
`Task ID | owner | prerequisite merge SHAs | evidence URLs/commit | status | branch/PR | base SHA | head SHA | tests SQLite/PG/Web | official SDK (if applicable) | PRE_MERGE_REVIEW | owner merge approval | merge SHA | POST_MERGE_REVIEW | deploy (separate)`.

## Selection policy
Select the smallest highest-risk *dependency-ready and activated* task after verifying the live repo. Never infer `done` from historical audit or test green alone. Remediation tasks remain candidates until explicitly authorized under the active Horizon. Stop for merge approval and material decisions.


## TAX-HZ-00 research deliverables (owner-approved)
The read-only Evidence Pass includes **deep primary-source review** of current ZATCA/Fatoora official specifications, applicable Saudi VAT regulations and the official offline validator, plus grounded UX benchmarking of suitable accounting/ERP systems. Deliver an external-evidence register and an observed-UX comparison with direct citations, version/date checks, actionable design proposals and open decision packets. No competitor pattern may become an unreviewed financial or ZATCA rule. These deliverables are part of TAX-HZ-00 acceptance, not a licence to start product implementation.
