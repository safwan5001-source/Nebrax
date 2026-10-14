# AWJ-TAX-ZATCA-HORIZON — Master Plan (Bootstrap V1)

> **Owner activation decision — 2026-10-11:** Pause AWJ Delivery Platforms & Settlement Horizon V1 and designate TAX-ZATCA the sole active Horizon **effective once this documentation PR merges**. Preserve Delivery evidence and resume point; do not execute both in parallel. The initial approved activity is the read-only TAX-HZ-00 Evidence/Decision Pass. This approval does **not** authorize remediation code, a PR merge without specific owner approval, Deploy, ZATCA submission, or production migration. This decision supersedes the initial proposal's unresolved active-versus-parallel gate below.


**Status:** PROPOSED / DOCUMENTED — not released, not ZATCA-certified. *Activation:* superseded by the owner decision above (TAX-ZATCA active since #1324). *Current task status:* `TAX-ZATCA-RECONCILIATION-AUDIT.md` (2026-10-14).  
**Prepared:** 2026-10-11  
**Repository:** `safwan5001-source/Nebrax`

## Purpose
Run the existing VAT / ZATCA remediation programme using **نظام الأفق / AWJ Autonomous Engineering Horizon**, with evidence-first decisions, one bounded PR per task, verified financial and security invariants, explicit owner-controlled merge and production gates. This document is an orchestration layer, **not** a substitute for the full remediation plan or official ZATCA requirements.

## Source of truth
1. `docs/autonomous-engineering/AWJ-HORIZON-SYSTEM.md` and its linked operating/quality/decision protocols.
2. `docs/audits/AWJ-TAX-ZATCA-AUDIT-1.md` — audit snapshot at `0534ef16543b01c69b416b58897337e012a9d1ab`; verdict **NOT READY**.
3. `docs/audits/AWJ-TAX-ZATCA-GAP-MATRIX.md` and `docs/audits/AWJ-TAX-ZATCA-REMEDIATION-PLAN.md` — 40 tasks, explicit finding IDs, dependencies, acceptance tests, ADRs, rollout gates.
4. Current `main` source, tests, the latest implementation reports and live PR/CI evidence — verify before marking anything done.
5. Current primary ZATCA rules, official technical specifications and SDK validator versions — recheck at each affected implementation task; distinguish external evidence from AWJ decisions.

**Caution:** the original remediation document says “Nothing ... has been implemented” because it was authored at audit time. That is *historical*, not today's status; use verified merged evidence below.

## Confirmed programme progress at bootstrap
- PR **#1290** (audit documents) merged.
- PR **#1291** (REM-01 sourced return VAT allocation) merged as `999e06c52cd9e7dba3d8e16b3be00fc8d9ad9fa0`.
- PR **#1304** (REM-02 credit-note VAT and caps) merged as `56fcac621411a10506ed626f43b4d5a99b2ed798`.
- PR **#1315** (credit-note print/PDF reconciliation) merged as `3209fcb77cc4e02b729bb74c34adf7e131869a1b`.
- PR **#1320** (print visual verification evidence) merged as `265974693502bc734ff0e9dbd12123bf3f345b51`.
These are **merged code/docs** status only, not evidence of production deployment, ZATCA onboarding, live endpoint success or tax compliance.

> *Update 2026-10-14:* this list is the bootstrap snapshot. REM-03/03b, REM-04, REM-05, REM-06, REM-08, REM-11, REM-37 and TAX-N01 have since been merged; see `TAX-ZATCA-RECONCILIATION-AUDIT.md` for the verified merge SHAs, remaining work and the historical (August 2026) ZATCA pipeline PRs.

## Existing-horizon isolation / activation gate
At the time this plan was drafted, `docs/autonomous-engineering/CURRENT-STATE.md` designates **AWJ Delivery Platforms & Settlement Horizon V1** as the single ACTIVE horizon, and its task queue has a separate active segment. This plan **does not overwrite or silently terminate that horizon**, nor edit the global `CURRENT-STATE.md`, `TASK-QUEUE.md` or `MASTER-EXECUTION-PLAN.md`.

Before launching autonomous execution, the owner must decide whether TAX-ZATCA becomes the active horizon (pausing/closing Delivery through its documented handoff) or runs as an expressly authorized isolated concurrent horizon. Record the decision, ownership, conflict controls and exact activation commit. Until then, this is an approved *planning proposal*, not a licence to execute changes.

## Definition of Done — distinguish stages
1. **Bootstrap complete:** current evidence reconciled, task/dependency queue baselined, owner decisions identified, Horizon activation approved and documented.
2. **Engineering complete:** all mandatory, applicable findings closed with code/tests/review/merge verification; deferred scenarios explicitly blocked and approved; official offline SDK XSD/EN16931/KSA validation passes using real AWJ outputs including standard/simplified invoices and credit/debit notes.
3. **Operational readiness:** onboarding, clearance versus reporting, state machine, 24-hour deadline, retries/idempotency, audit storage, tenancy, security, monitoring and runbooks verified in a nonproduction controlled environment.
4. **Production readiness / go-live:** independent owner decision, verified residency/real-data classification, ZATCA compliance evidence, production credentials and rollout/rollback plan, production tests and sign-offs. Neither merging nor test green implies this stage.

## Non-negotiable invariants
- Financial values in integer halalas; posted journals immutable; accounting effects via canonical ledger; exact balance and VAT cap.
- Tenant/branch isolation, permissions, no cross-tenant disclosure; source invoice/return/credit-note traceability.
- Backward compatibility unless owner approves material changes; do not silently change tax rules, APIs or DB semantics.
- Idempotency and concurrency under PostgreSQL; no duplicate ICV, chain, submission or refund; consistent lock order.
- No live ZATCA traffic, production migration, credential change, rollout, merge or deploy without appropriate explicit owner authorization.
- Keep `ZATCA_SUBMISSION_DISPATCH_ENABLED=false` until independently approved and readiness proven.
- Never mark a requirement complete based solely on AWJ-authored tests instead of official validator evidence.

## Execution phases
**0 — Evidence + policy:** REM-00A, REM-00B; verify actual production/data residency, deployment, current findings, open ADRs, and all already merged REM-01/02 code. No use of real customer data without authority.

**1 — Core financial and isolation safety:** prioritize REM-03, REM-04, REM-05, REM-08, REM-09 and other dependency-ready Tier 1 tasks based on fresh evidence; REM-06 requires REM-05, REM-10 requires REM-09. The separate POS partial-rounding convention and saved print layouts are tracked as follow-ups, not silently assumed solved.

**2 — Compliance oracle / invoice content:** REM-11 independent SDK validator harness early; REM-12 and REM-13 may be explored in bounded independent slices after evidence; REM-14 depends on 13; REM-16 depends on 11/12/13/14; REM-17 depends on 11/13; REM-18 depends on 16/02.

**3 — Provisioning and reliable transmission:** REM-19, 21–27 according to declared dependencies. Do not enable sending to ZATCA or release standard invoices before their required clearance gate.

**4 — Returns/reporting/storage and release:** REM-28–38 with real dependency ordering, supported VAT cases, retention and operational sign-offs. Use the source remediation matrix for the complete 40-task queue, not this shorthand.

## Engineering loop / evidence gates
For each selected task:
1. Read only needed current code and latest report; verify base SHA and external primary requirements when applicable.
2. Confirm acceptance criteria, policy decisions, dependencies and negative security/tenant tests.
3. Implement smallest independent PR; financial/security tasks require focused tests, SQLite, PostgreSQL, appropriate concurrency and full repository suites/build as mandated.
4. Self-review, independent reviewer where available and AWJ Guardian review; resolve findings or escalate with Decision Packet.
5. Verify required CI on **exact final Head SHA** and final diff. Record `PRE_MERGE_REVIEW: PASS` or BLOCKED.
6. **STOP and request Safwan's explicit approval for each PR merge.** Never use outdated “standing merge authority” in older protocol to override the current owner rule.
7. After owner-authorized merge, record actual Merge SHA and `POST_MERGE_REVIEW`; only then unblock dependent tasks.
8. Update this horizon's task state and implementation handoff; advance automatically only to independent, authorized work. Do not create stacked dependent PRs by default.

## Decision gates that must not be guessed
- Active horizon versus concurrent horizon; the Delivery handoff.
- Tax classification, rate changes, adjustment semantics, standalone notes, unsupported VAT scenarios, historical remediation or migration policies.
- Environment/credentials, ZATCA submission activation, production residency, rollout/cutover, destructive operations.
- A5 support, physical thermal printer qualification and configurable saved print columns remain *pre-release / follow-up* decisions from the credit-note work, not proof of tax readiness.

## Known unverified
Real production data/residency and backups; current live ZATCA credential/onboarding state; actual production environment configuration; SDK results on newly generated documents; post-merge production behavior. Label these **NOT VERIFIED** until evidence obtained. The older audit's “NOT READY” remains the default release verdict.

## Next authorized step
Run **TAX-HZ-00 Evidence and Decision Pass** (read-only, no code / no merge / no deploy): reconcile live `main` with the full 40-task remediation queue, current external ZATCA references, existing active Delivery horizon, and decision owners. Return a precise activation Decision Packet and a first dependency-ready task recommendation. Do not begin REM implementation before activation approval.

**Companion:** `AWJ-TAX-ZATCA-HORIZON-TASK-QUEUE.md` and `AWJ-TAX-ZATCA-HORIZON-BOOTSTRAP.md`.


## Research charter — owner-approved 2026-10-11
Claude Code is expressly authorized to spend the time reasonably needed for **thorough, evidence-first research** before selecting tax/ZATCA architecture, operational workflows or relevant UX. Research depth is not limited to a quick scan; avoid repeated searches without decision value.

### Regulatory/technical primary sources (priority)
- **ZATCA (هيئة الزكاة والضريبة والجمارك)** official website, Fatoora/e-invoicing developer and integration documentation, E-Invoicing Regulation, implementation resolutions, XML Implementation Standard, Data Dictionary, Security Features Implementation Standards, developer portal and official SDK validator; use their latest available *applicable* releases and confirm effective dates.
- Official Saudi VAT law, implementing regulations, guides, rulings/circulars and official clarifications as applicable; distinguish mandatory law/regulation from explanatory guidance, SDK behavior, examples and proposals.
- Official sources for UBL 2.1 / EN 16931 when needed for interoperability; verify that Saudi overlays/requirements take precedence for KSA documents.
- Record each consulted primary document's exact title, publisher, URL, version, release/effective date (when available), retrieval date and relevant section/page/rule ID. Do not infer validity from search snippets alone. If official sources contradict, identify the discrepancy and escalate material compliance interpretation instead of guessing.

### UX / comparable systems
Study relevant **official** product documentation, public help centers, product demos and accessible UI examples for suitable Saudi accounting/POS/ERP systems (e.g. Daftra, Salla, Qoyod, Zoho Books, Odoo, ERPNext and others if relevant). Focus on real invoice/credit-note lifecycle, tax settings, ZATCA connection status, submission outcomes, blocked/error states, financial reconciliation, permissions, print and bilingual/RTL presentation.

For every proposed UI pattern, identify the reference product and exact observed URL/screen, what was actually observed (versus assumed), usability trade-offs, and how it fits AWJ's dense, clear, trustworthy daily accounting UI. Respect product terms/copyright; do not copy source code, protected layouts/assets, brands or wording. External UI is **design evidence**, not legal authority and never overrides AWJ accounting, tenancy, compatibility or official ZATCA rules.

### Required research outputs / decision discipline
Build an evidence register and a small comparison matrix with columns **Source / Current version or date / Verifiable evidence / Proposed AWJ use / Status (mandatory, guidance, inspiration, unresolved)**. Separate:
1. **External official requirements and verified facts**;
2. **Observed competitor UX patterns**;
3. **AWJ decisions/proposals with rationale**;
4. **Open owner/compliance decisions**.

Revalidate primary sources immediately before implementing each rule-sensitive slice, record any changed regulations or SDK versions, and tie applicable requirements to acceptance tests and official SDK fixtures. Screenshots/public UI references support design decisions but do not prove ZATCA compliance. If external sites are inaccessible, record **NOT VERIFIED**, never manufacture evidence.

Research is authorized; production API traffic, sensitive credentials, change of accounting semantics, merging PRs and deploying are not authorized by this charter.
