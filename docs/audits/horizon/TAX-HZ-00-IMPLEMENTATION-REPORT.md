# TAX-HZ-00 — Implementation Report (ZATCA Official Evidence & Remediation Priorities)

STATUS: COMPLETE — documentation only; **merged as PR #1398 (`0c90419874594169d422515e881425e5b3b3fa70`)**. Historical snapshot at `main` `4781a45` (2026-10-13); its task counts pre-date REM-03…REM-37 — current reconciliation: `TAX-ZATCA-RECONCILIATION-AUDIT.md`
DATE: 2026-10-13
HORIZON: TAX-ZATCA (active since PR #1324 merge `21fed642f735ec5bcedb55c0f5e10548c7df6d5f`, 2026-10-11T19:31:56Z — verified via GitHub; Delivery Platforms Horizon remains paused)
ZONE: C (tax, accounting, ZATCA credentials, tenant isolation) — read-only research; no Zone C code touched

## Outcome

One focused documentation PR delivering five documents (this report and four companions). The assessment concludes — as AUDIT-1 did on 2026-10-10 and with no change found in the official documents since — that AWJ's ZATCA pipeline is **not a compliant Phase 2 implementation yet** and is **safely disabled** (transmission is off by config default and by the deployment's queue connection). Nothing in this pass is a compliance, certification or approval claim.

| Deliverable (brief §9) | File |
|---|---|
| 1. Official ZATCA requirements evidence matrix | `TAX-HZ-00-EXTERNAL-EVIDENCE-REGISTER.md` (≈113 matrix rows, 26 decision packets, source-currency table) |
| 2. Existing AWJ implementation and gap assessment | `TAX-HZ-00-AWJ-GAP-ASSESSMENT.md` |
| 3. Accounting-platform UX benchmark | `TAX-HZ-00-UX-BENCHMARK.md` |
| 4. Prioritized remediation backlog | `TAX-HZ-00-REMEDIATION-BACKLOG.md` |
| 5. Final Markdown implementation report | this file |

## Git / PR record

| Field | Value |
|---|---|
| Repository | `safwan5001-source/Nebrax` |
| Branch | `claude/tax-hz-00-zatca-evidence-pass` (independent; no other Horizon branch touched) |
| Base | `origin/main` = `4781a4525a97e463b2a2f3cd59c055de8474d7d7` (2026-10-13) |
| Head SHA, PR number, CI status | Recorded in the **PR description** and the hand-back message — a file cannot contain its own commit hash |
| Merge | **None. Stopped before merge.** Requires Safwan's explicit approval. No Deploy. |

### Exact changed files (all new, all Markdown, all under `docs/audits/horizon/`)

1. `TAX-HZ-00-IMPLEMENTATION-REPORT.md`
2. `TAX-HZ-00-EXTERNAL-EVIDENCE-REGISTER.md`
3. `TAX-HZ-00-AWJ-GAP-ASSESSMENT.md`
4. `TAX-HZ-00-UX-BENCHMARK.md`
5. `TAX-HZ-00-REMEDIATION-BACKLOG.md`

Not touched (by design): application code, tests, migrations, routes, config, `CLAUDE.md`, `docs/autonomous-engineering/CURRENT-STATE.md` and `TASK-QUEUE.md`, the three `AWJ-TAX-ZATCA-HORIZON-*` files, CI workflows, the CI Gate manifest, Horizon policy/grants, GitHub settings.

## What is verified versus inferred

| Class | Content |
|---|---|
| **Verified today (2026-10-13)** | PR #1324 merged (GitHub read). `main` = `4781a45`. Every official ZATCA PDF/xlsx in the audit register re-downloaded; SHA-256 identical to the audit copies; page "Last Update" stamps unchanged; latest wave still Wave 25 (integrate by 1 Feb 2027); SDK latest stable still 238-R3.4.8. Code claims re-read at file:line by two independent read-only passes, and spot-checked again by the lead (transport accept rule `ZatcaHttpTransport.php:83`, `QUEUE_CONNECTION=sync` `Dockerfile:58`, `compliance.zatca mandatory=false`, the four bare `findOrFail` sites in `InvoiceController`, unfiltered revisions feed). 171 `Zatca*` tests pass on in-memory SQLite; REM-01/02 targeted tests pass (21/21 and 104/104). |
| **Carried from AUDIT-1 (not re-run)** | The SDK validation results (AWJ XML fails XSD/EN/KSA; 19/19 official samples pass; hash step matches 19/19). No SDK execution happened in this pass; no workflow in the repo runs the SDK. |
| **NOT VERIFIED** | Production state (real taxpayer data, tenants, `ZATCA_*` values, worker/scheduler, `APP_PREVIOUS_KEYS`, residency); PostgreSQL behaviour in this pass; full PHP/web suites; CI on the REM-01/02 heads; merge SHAs of #1291/#1304/#1315/#1320 (shallow clone); Swagger/OpenAPI-defined header and JSON names; live gateway behaviour; Wave 26 absence beyond the first news page; the Unified GCC VAT Agreement text; the Official Gazette text for Board Res. 24-06-01. |

## Key findings

### A. AWJ implementation (current `main`)

1. **No stage is verified by the official SDK in this repo's CI.** No workflow or test references the SDK, JDK or Fatoora. Tests are AWJ-vs-AWJ and several encode the non-conformant behaviour (two-field body, raw-hash genesis, 64-byte tag 7).
2. **Remediation status of the 40-task queue:** 2 verified done (REM-01, REM-02), 2 partial (REM-09, REM-34), **36 not started**, 18 of which are also decision-gated because no ADR file exists. Nothing in Tier 2/3 (REM-11…27) has started. 12 tasks are dependency-ready (REM-00A/00B, 03, 04, 05, 07, 08, 09, 11, 20, 37, 38).
3. **Submission is disabled twice:** `ZATCA_SUBMISSION_DISPATCH_ENABLED=false` by default and `QUEUE_CONNECTION=sync` in the `Dockerfile` makes readiness fail. No worker, scheduler, sweep or 24-hour clock exists; `submission_mode=automatic` is stored but read by nothing (N3).
4. **No onboarding at all** (no CSR/OTP/compliance or production CSID/renewal/revocation). Credentials are pasted in, one per tenant × environment, encrypted with `APP_KEY` only; the validator does not bind the certificate to the tenant's VAT number or to the environment template (→ `TAX-N02`). No audit event on credential or environment change (N7).
5. **The HTTP call runs inside an open DB transaction with a row lock**; acceptance is decided by HTTP 200/202 alone; the dispatcher swallows every `Throwable` without logging (N1); no in-doubt state.
6. **Sign/QR/XML:** the UBL build is still the audit-time skeleton; signature path unchanged from the audit. Immutability of `zatca_*` after posting is enforced by service logic only (no model/DB guard).
7. **REM-03 (branch authorisation) is real and open**: four mutations in `InvoiceController` plus returns, quotes and the revisions feed use bare lookups; credit notes were already fixed by REM-02.
8. Residual from REM-02: tenants pinned by migration `2026_11_04_030000` to allow standalone credit notes keep **uncapped** notes (decision D-11).

### B. Official-requirement findings that change how we plan

1. **No newer official document exists** since the 2026-10-10 register (XML Standard / Security Standard / Data Dictionary remain v1.2 of 19 May 2023).
2. **CLAUDE.md's ICV claim is not confirmed by the texts read** ("two chains under one VAT number violate the spec"): the counter and chain are defined per *Unit*, and many units can be onboarded under one VAT number. The tenant-level default may still be the safest AWJ choice, but the stated justification needs a sourced position (D-06 / `TAX-N07`).
3. **PDF-vs-SDK conflicts** need recorded decisions: QR tag 6 length (32 vs 44), tag-3 timestamp format, BillingReference (PDF mandatory vs SDK warning), QR size 700 vs 1000, 7- vs 9-position transaction code, curve naming ("ECDSA, 256" / P-256 / secp256k1). Recommended default: SDK as CI oracle, strictest-of-both for generation.
4. **Newer than the audit (lower evidence strength):** staff posts on the Fatoora Developer Community forum say that since 6 Aug 2025 a repeated hash within 24 h returns **208** on Clearance (with the cleared invoice) and **409** on Reporting (treat as success). Current `normalize()` would record both as non-retryable `rejected`. The `uuid` request-body key is supported by two official sources (Developer Portal Manual steps; sandbox Release-2 note). These are forum/portal sources, **not** a formal Standard → confirm before they drive behaviour (D-06, `REM-21a` is written to avoid asserting them as "accepted").
5. IR Art. 26 is a place-of-supply article; time of supply rests on the GCC Agreement Art. 23 + IR Art. 20; invoice timing on IR Art. 53/54 (Art. 54(6) 15th-day rule: effective date only corroborated).
6. SDK 4.0.0 Beta (Java 21) exists on the portal but has an **older** rule set; 3.4.8 stays the baseline. The SDK ships an LGPL-3.0 licence text; distribution is a SharePoint link (decision D-03).
7. No ZATCA technical standard names a hosting region; the VAT IR requires records in-Kingdom or accessible from a terminal there (ADR-H).
8. Wave 25 integrate-by date is **1 Feb 2027** (111 days). On the audit's own estimates the Tier 2+3 critical path is 81–131 engineering days sequentially. Whether any AWJ tenant is a real taxpayer or in a wave is NOT VERIFIED (D-10).

### C. UX benchmark (design evidence only — never a ZATCA requirement)

Reached with page bodies: ZATCA Fatoora Portal manual v3 (3 pages viewed), Daftra (9 articles, 4 screenshots), Odoo 18/19, Zoho Books (3 screenshots), Qoyod (4 pages). Partial: Wafeq, ERPNext (third-party app only), Foodics. **Not observed:** Salla, Zid, Rewaa. No Arabic/RTL competitor screens were seen (RTL guidance derives from AWJ's own design system). AWJ already has a settings/connection page, classification select, QR rendering, linked credit-note form and a backend attempts API, but the invoice page shows **no ZATCA status**. 11 ranked recommendations (R1–R11), 13 rejected patterns, 12 open UX decisions (U1–U12) — all gated by the backend items they name; no UI work is proposed before REM-03/REM-21a.

## Approach and why it fits AWJ

* Built on AUDIT-1 (295 requirements, 105 findings, 40 REM cards) rather than repeating it; revalidated sources by hash/date and re-read changed-risk clauses.
* Five independent read-only workers (REM status ×2, official sources ×2, UX) wrote drafts; the lead reviewed every draft, spot-checked code claims, de-collided IDs, and wrote the backlog and this report. Drafts are archived outside the repo.
* Strict separation of binding regulation / official technical spec / SDK behaviour / guidance / competitor observation / AWJ proposal, with a verification label on every row.
* Honors CLAUDE.md rule 6: policy-bearing choices are surfaced as owner decisions (D-02…D-12), not guessed.

## Validation results

| Check | Result |
|---|---|
| Diff is Markdown-only, five new files under `docs/audits/horizon/` | PASS (`git diff --stat` at commit time) |
| Table-structure check (every Markdown table row has the header's column count; script run over all five files) | PASS — 0 issues |
| Repo-path existence check (every backticked `app/ routes/ database/ config/ tests/ web/ deploy/ docs/ .github/` path in the five files resolves, incl. `web/src`-relative paths) | PASS — 0 missing |
| Secret scan (PEM headers, DER prefixes, token-shaped strings, `AKIA…`) | PASS — only descriptive mentions of the patterns |
| Compliance-claim scan ("is compliant/certified") | PASS — only disclaimers |
| No ZATCA network traffic, OTP, CSR-to-ZATCA, CSID, production write | Per the workers' hand-back reports and their briefs (public pages/PDFs/portal static assets only; SDK zips downloaded and read, **not executed**) |
| `php artisan test` (full) | **Not run locally** — docs-only diff; the repository's required `php artisan test` jobs run in CI on the exact head |
| CI | See PR description (CI Gate + `php artisan test` sqlite/pgsql run on every PR) |

## Risks

1. **Time:** if any tenant is a real taxpayer in Wave 25 or earlier, the critical path does not fit before 1 Feb 2027 without parallelisation (D-10).
2. **Governing-document drift:** CLAUDE.md's ICV statement and "no automated web tests" line are wrong/unsourced.
3. **Evidence quality:** several API-level names remain NOT VERIFIED until Swagger is captured (TAX-E02); 208/409 rely on staff forum posts.
4. **Test suite lock-in:** green ZATCA tests (171) mask non-conformance; Tier-2 PRs must replace them deliberately.
5. **Process:** 18 tasks are blocked on ADRs that do not exist (REM-00B).
6. **Residual financial exposure:** pinned uncapped standalone credit notes (D-11).

## Unanswered questions for the owner (consequential only)

D-02 start REM-03? · D-03 SDK licence/fixture policy · D-04 definition of "KSA tenant" + default-on semantics · D-05 ADR package + tax adviser · D-06 authorise written clarifications to ZATCA · D-07 who captures Swagger · D-08 data residency · D-09 key custody · D-10 real taxpayers/waves? · D-11 pinned standalone-credit-note tenants · D-12 CLAUDE.md corrections. Detail: backlog §3. None blocks this documentation PR.

## Next recommended executable task

**`REM-03` — branch authorisation on invoice/return/quote/revision mutations** (S, 1–2 days, P1, no migration, no ADR, no financial or ZATCA logic, extends an existing test class). Proposed concurrent second branch with disjoint files: `REM-08`. Start `REM-11` as soon as D-03 is decided. Full card: backlog §4. **Nothing starts without Safwan's explicit approval.**

## Proposed (not applied) queue update after merge

On merge of this PR, the Horizon handoff docs (`CURRENT-STATE.md`, `TASK-QUEUE.md`, `AWJ-TAX-ZATCA-HORIZON-TASK-QUEUE.md`) could record: TAX-HZ-00 = done (evidence pass), merge SHA, and the candidate order REM-03 → REM-08 → REM-11 (post D-03) → REM-37 → TAX-N01 → REM-04. This PR deliberately does **not** edit them (per the bootstrap rule against editing global state files without authorisation).

## Horizon integration

Independent branch; no other Horizon branch, policy, grant, CI Gate manifest, GitHub setting, ruleset, branch protection or authorization rule was changed. AWJ Horizon Shadow Mode was **not used**. Delivery Platforms Horizon untouched and paused.

## Pre-merge / post-merge review

* PRE_MERGE_REVIEW: **PENDING** (owner). Reviewed head SHA: see PR.
* Merge status: not merged. Merge SHA: n/a. POST_MERGE_REVIEW: n/a.
