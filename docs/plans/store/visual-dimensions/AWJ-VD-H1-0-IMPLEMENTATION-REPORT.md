# AWJ-VD-H1-0 — Implementation Report (Evidence & Architecture)

STATUS: **COMPLETE — PR in review, stopped at Decision Gate G0**
DATE: 2026-10-14

## Outcome

H1-0 delivers the evidence pass, the proposed architecture, the DB/API changes, the backward-compatibility and risk analysis, the Decision Register (D-01..D-15) and the Task Queue (VD-1a..VD-6).

This slice is **documentation only**. No code, migration, API, or runtime behaviour changed.

## Repository evidence / root cause

See `AWJ-VD-H1-0-EVIDENCE-AND-ARCHITECTURE.md` §2. Key facts:
- Facets have no visual columns. ADR-14 §5 defers "facet value images".
- `discovery` (ADR-21) is the existing "shop by" section, with `tiles` and `chips` displays that are text only.
- `storefront_media` is the canonical media library: the original is stored once, WebP derivatives are generated, and framing is stored per use.
- The media reference scanner only sees presentation documents. Any new reference outside them needs a scanner container and a serving gate.
- `IconRegistry` is a closed, append-only list twinned across PHP and TypeScript.
- There is no shape engine, and the storefront has no dark mode.

## Approach chosen

Three layers:
- **L1:** facet data, unchanged.
- **L2:** visual identity, in one new additive table `commerce_facet_visuals` with normalized JSON.
- **L3:** per-surface display settings, as optional fields inside the content of the `discovery` section.

The design reuses the media library, `MediaRef`, `IconRegistry`, the existing picker components, and the existing filter URLs.

## Why this approach fits AWJ

- No parallel storage (CUST-HV D-01).
- Presentation data follows the established normalized-document pattern: PHP authority, TS twins, shared fixtures.
- Filtering, counts and ADR-14 contracts stay untouched.
- Every change is additive and reversible.

## Changed files

- `docs/plans/store/visual-dimensions/AWJ-VD-H1-MASTER-PLAN.md` (new)
- `docs/plans/store/visual-dimensions/AWJ-VD-H1-0-EVIDENCE-AND-ARCHITECTURE.md` (new)
- `docs/plans/store/visual-dimensions/AWJ-VD-H1-0-EXTERNAL-EVIDENCE.md` (new)
- `docs/plans/store/visual-dimensions/AWJ-VD-H1-DECISION-REGISTER.md` (new)
- `docs/plans/store/visual-dimensions/AWJ-VD-H1-TASK-QUEUE.md` (new)
- `docs/plans/store/visual-dimensions/AWJ-VD-H1-0-IMPLEMENTATION-REPORT.md` (new)
- `docs/autonomous-engineering/CURRENT-STATE.md` (pointer section only)
- `docs/autonomous-engineering/TASK-QUEUE.md` (pointer section only)

## Tests and exact results

No runtime change, so no PHP or web tests were run for this slice. The documentation makes no claim of test results.

## Build / lint / typecheck

Not applicable (docs only).

## CI

To be observed on the PR head. Docs-only changes are expected to trigger only path-relevant workflows.

## Pre-merge review

- PRE_MERGE_REVIEW: pending owner Decision Gate G0
- Reviewed Head SHA: recorded on the PR
- Findings / resolution: —

## Merge

- Merge status: **not merged.** Requires explicit owner approval (D-14).
- Merge SHA: —

## Post-merge review

—

## Self-review

### Implementer

All claims cite repository paths and lines. External claims are separated as SEEN versus INFERENCE.

### Reviewer

Scope is limited to docs. The shared state files only receive short pointer sections and leave TAX-ZATCA content untouched.

### AWJ Guardian

The design keeps:
- tenant isolation: CompanyWide model, saving guards, and a 4-condition public gate;
- RBAC: `commerce.manage` for visuals;
- media safety: no SVG upload, never serve the original, scanner protection;
- backward compatibility: byte-identical legacy documents.

It also confirms no accounting, tax, inventory or order impact.

## Accounting impact

None. No journal entries are produced by any slice of this horizon.

## Tenant / branch isolation impact

Design only. The new model is proposed as `CompanyWide`, the same as ADR-14 catalog tables.

## Security / authorization impact

Design only (§3.8, R2/R3).

## Backward compatibility

Design guarantees are listed in §4 of the architecture report.

## API / DB / migration impact

Proposed only:
- one additive table;
- two workspace write routes;
- one additive `visual` key in workspace and `storefront.v1` responses;
- one guarded public media route.

Nothing is implemented.

## External research used

`AWJ-VD-H1-0-EXTERNAL-EVIDENCE.md`. Sources: FNP (seen, desktop and mobile), Salla Raed (official source and previews), Shopify Dawn (source), Shopify Search & Discovery docs, MDN, WCAG 2.2, OWASP. Floward was blocked by Cloudflare.

## Risks / remaining work

- R1–R15 in the architecture report §5.
- Screenshots of the current UI mentioned by the owner were not received. Only the prototype zip arrived.

## Discovered backlog

See Task Queue → Backlog.

## Git state

- Branch: `docs/awj-commerce-visual-dimensions-h1-0`
- PR: see GitHub (opened from this branch)
- Base SHA: `f147fb6063d36952971724609250f9ba1baf42f5`
- Head SHA: recorded on the PR

## Recommended next dependency-ready task

**VD-1a** (visual contract and registries: pure code, no DB/API). It becomes ready only after the owner approves the Decision Register.
