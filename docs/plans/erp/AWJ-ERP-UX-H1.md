# AWJ-ERP-UX-H1 — ERP UI / UX / Accessibility Horizon (state file)

Status: **CLOSED** — all slices merged on `main` (H1-8 closure: [AWJ-ERP-UX-H1-8-CLOSURE.md](./AWJ-ERP-UX-H1-8-CLOSURE.md)). Merged ≠ Deployed ≠ Production verified: nothing in this horizon was deployed.
Owner: Safwan · Executor: **Claude Code** (sole executor) · Started: 2026-10-14
Repository: `safwan5001-source/Nebrax` · Protocol: [AWJ Horizon System](../../autonomous-engineering/AWJ-HORIZON-SYSTEM.md), [Execution Protocol](../../engineering/AWJ_HORIZON_EXECUTION_PROTOCOL.md)
Charter: [AWJ-ERP-UX-H1-CHARTER.md](./AWJ-ERP-UX-H1-CHARTER.md) · H1-0 audit: [AWJ-ERP-UX-H1-0-AUDIT.md](./AWJ-ERP-UX-H1-0-AUDIT.md)

## Owner direction (2026-10-14) — supersedes the charter's approval boundaries

- Scope expanded from UX/accessibility to complete ERP-wide UI + UX + accessibility + responsive + visual consistency + interaction + performance, **for routes that actually exist**.
- **Merge authority inside this horizon only:** each ready, in-scope PR may be merged after exact-final-head Reviewer + AWJ Guardian review, required CI green and a recorded `PRE_MERGE_REVIEW: PASS`; after merge, `POST_MERGE_REVIEW: PASS` with the Merge SHA before a dependent slice starts.
- **Not authorized:** production deploy/release/migration, destructive production operations, changes to accounting entries, ledger, VAT/ZATCA, rounding/minor units, pricing, balances, inventory postings, tenant/branch visibility, auth/RBAC, database structure, public API, infrastructure; scope expansion into new features.
- Runs in parallel with `AWJ-PLATFORM-UX-H1`; no ERP slice edits `web/src/app/platform/**` or `web/src/components/platform/**`.
- Routine P2/P3 design choices inside the AWJ design system are decided by the executor and documented; only high-impact decisions are escalated.

## Slice status

| Slice | Content | PR | Status | Merge SHA |
|---|---|---|---|---|
| H1-0 | Evidence audit, backlog, queue (docs) | #1418 | merged — PRE/POST_MERGE_REVIEW PASS | `276ebef` |
| H1-1 | ERP UI contract + acceptance rubric (docs) | #1420 | merged — PASS / PASS | `69e9ffe` |
| H1-2A | Dialog focus management + localized close (ERP-UX-001/002) | #1421 | merged — PASS / PASS | `6581e58` |
| H1-2B | Closed menus inert (ERP-UX-003) | #1422 | merged — PASS / PASS | `0902fd0` |
| H1-2C | Toast region, assertive errors, label (ERP-UX-004) | #1433 | merged — PASS / PASS | `9c50ead` |
| H1-3A | Skip link, 320 px header, menu ARIA (ERP-UX-005/006/021) | #1423 | merged — PASS / PASS | `d9dbeaf` |
| H1-3B | Non-navigable "soon" sidebar items (ERP-UX-007) | #1424 | merged — PASS / PASS | `a90b3f9` |
| H1-3C | Display preferences kept on refresh (ERP-UX-026) | #1425 | merged — PASS / PASS | `ca652ff` |
| H1-4A | Row-action headers, bidi-safe names (ERP-UX-015/016) | #1426 | merged — PASS / PASS | `45092a9` |
| H1-4B | Product-edit sideways scroll (ERP-UX-022) | #1427 | merged — PASS / PASS | `fa3166f` |
| H1-4C | Minus sign left of negative amounts in RTL (ERP-UX-027) | #1428 | merged — PASS / PASS | `b222da8` |
| H1-5A | Localized forbidden state (ERP-UX-009) | #1429 | merged — PASS / PASS | `42c8b1c` |
| H1-5B | Every flagged control named (ERP-UX-010) | #1435 | merged — PASS / PASS | `b8f3453` |
| H1-5C | Dashboard KPI fit at ≤360 px (ERP-UX-024) | #1430 | merged — PASS / PASS | `c6ca972` |
| (fix) | KPI test after 4C+5C interaction (test only) | #1436 | merged — PASS / PASS | `ccf0be2` |
| H1-6A | Contrast, dark-mode document paper, workspace link names (ERP-UX-011/012) | #1434 | merged — PASS / PASS | `4ca1ece` |
| H1-6B | In-app confirm, finance/accounting/HR (ERP-UX-017) | #1437 | merged — PASS / PASS | `317d04d` |
| H1-7A | Numbering labels (ERP-UX-008) | #1431 | merged — PASS / PASS | `29a2316` |
| H1-7B | Heading order (ERP-UX-014) | #1438 | merged — PASS / PASS | `3093e10` |
| H1-7C1 | English UI on main lists (ERP-UX-025) | #1432 | merged — PASS / PASS | `cc490d6` |
| H1-7D | Landmarks, links, 404, fuel settings, labels (ERP-UX-019/023, rest of 025) | #1439 | merged — PASS / PASS | `7888cdf` |
| H1-7E | Sans placeholders, Customizer chevron (ERP-UX-018/020) | #1440 | merged — PASS / PASS | `622783e` |
| H1-7F | Residuals from the closure crawl incl. restricted role (ERP-UX-014/019/023) | #1441 | merged — PASS / PASS | `ea7c0c3` |
| H1-8 | Regression matrix, role matrix, closure report (docs) | #1443 | merged — PASS / PASS (see H1-8b note) | `f8e7ab8` |
| H1-8b | Late review findings on #1438, #1439 and #1443; re-crawl of the actual final tree | this PR | see [report](./reports/AWJ-ERP-UX-H1-8B-REPORT.md) | — |

Open owner decision (non-blocking): **D-ERP-UX-01** — additive `name_en` on report account rows (ERP-UX-013).

Per-slice review records (exact-head CI, full Vitest, PRE/POST_MERGE_REVIEW) live on each PR; implementation reports in `reports/AWJ-ERP-UX-H1-*-REPORT.md`.

**H1-8b note:** the `PRE_MERGE_REVIEW` records of #1438, #1439 and #1443 state "no open review threads", but automated (Codex) review threads had been posted on each before it merged — one, one and three respectively. They were found after closure and are answered and fixed in H1-8b; see its report.

## Definition of done (from the owner direction, §6)

Every actual ERP route audited or explicitly excluded with rationale; P0/P1 fixed and verified; P2/P3 disposition recorded; shared components conform to the AWJ specification; tests and visual/accessibility verification recorded with what was not performed; each slice's PR and merge status recorded. **Merged ≠ Deployed ≠ Production verified.**
