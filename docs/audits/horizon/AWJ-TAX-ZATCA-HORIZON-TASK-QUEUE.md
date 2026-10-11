# AWJ-TAX-ZATCA-HORIZON — Task Queue (Bootstrap V1)

> **Owner decision 2026-10-11:** TAX-ZATCA designated as the sole active Horizon on merge of activation PR #1324. Delivery execution is paused. TAX-HZ-00 is the first permitted read-only evidence pass. Candidate REM implementation remains gated on that pass and subsequent owner-approved task scope and merge approvals.


**Status:** PROPOSED / NOT ACTIVATED. This file is an *overlay* on the canonical 40-task audit remediation queue; it does not replace that queue or the current active Delivery Horizon in `docs/autonomous-engineering/TASK-QUEUE.md`.

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
