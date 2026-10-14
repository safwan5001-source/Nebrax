# AWJ-ERP-UX-H1 — ERP UI / UX / Accessibility Horizon (state file)

Status: **IN EXECUTION** — H1-0 audit delivered; slices H1-1 … H1-8 queued (see table)
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

| Slice | Content | Branch / PR | Status | Merge SHA |
|---|---|---|---|---|
| H1-0 | Evidence audit, backlog, queue (docs) | `docs/erp-ux-h1-0-audit` | in review | — |
| H1-1 | ERP UI contract + acceptance rubric (docs) | — | queued | — |
| H1-2A | Dialog focus management + localized close (ERP-UX-001/002) | — | queued | — |
| H1-2B | Dropdown inert when closed (ERP-UX-003) | — | queued | — |
| H1-2C | Toast region, live region, label (ERP-UX-004) | — | queued | — |
| H1-3A | Skip link, 320 px header, menu ARIA (ERP-UX-005/006/021) | — | queued | — |
| H1-3B | Non-navigable "soon" sidebar items (ERP-UX-007) | — | queued | — |
| H1-3C | Display preferences not re-applied on refresh (ERP-UX-026) | — | queued | — |
| H1-4A | Bidi-safe names, action header labels (ERP-UX-015/016) | — | queued | — |
| H1-4B | Product-edit sideways scroll from mis-hidden file input (ERP-UX-022) | — | queued | — |
| H1-5A | Localized forbidden state (ERP-UX-009) | — | queued | — |
| H1-5B | Accessible names for unnamed controls (ERP-UX-010) | — | queued | — |
| H1-5C | Dashboard KPI amount spill at ≤360 px (ERP-UX-024) | — | queued | — |
| H1-6A | Contrast on `/applications`, workspace link name (ERP-UX-011/012) | — | queued | — |
| H1-6B | Native confirm → in-app dialog, finance/HR (ERP-UX-017) | — | queued | — |
| H1-7A | Missing numbering labels (ERP-UX-008) | — | queued | — |
| H1-7C… | Hard-coded Arabic UI strings → catalogs, per module group (ERP-UX-025) | — | queued | — |
| H1-7B | Heading order + misc P3 (ERP-UX-014/018/019/020/023) | — | queued | — |
| H1-8 | Regression crawl, role matrix, closure report | — | queued | — |

Open owner decision (non-blocking): **D-ERP-UX-01** — additive `name_en` on report account rows (ERP-UX-013).

## Definition of done (from the owner direction, §6)

Every actual ERP route audited or explicitly excluded with rationale; P0/P1 fixed and verified; P2/P3 disposition recorded; shared components conform to the AWJ specification; tests and visual/accessibility verification recorded with what was not performed; each slice's PR and merge status recorded. **Merged ≠ Deployed ≠ Production verified.**
