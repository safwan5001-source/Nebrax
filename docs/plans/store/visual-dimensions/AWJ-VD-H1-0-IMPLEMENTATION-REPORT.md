# AWJ-VD-H1-0 — Implementation Report (Evidence & Architecture)

STATUS: **COMPLETE — owner accepted the architecture in principle (2026-10-14). Amendments applied. Awaiting G0 close confirmation.**
DATE: 2026-10-14

## Outcome

H1-0 delivers the evidence pass, the proposed architecture, the DB/API changes, the backward-compatibility and risk analysis, the Decision Register (D-01..D-15) and the Task Queue (VD-1a..VD-6).

This slice is **documentation only**. No code, migration, API, or runtime behaviour changed.

## Owner review round 1 (2026-10-14) — changes applied

| Owner request | Change | Where |
|---|---|---|
| D-04: keep `commerce.manage`; block edits in the UI and explain why; no RBAC change | Status matrix for the UI, a clear message, and server-side tests (accountant 403 / name 200 …). `Rbac` unchanged. | Register D-04 · §3.8-a · VD-3 §3.8 |
| D-08: document inheritance per property; customizing the image must not cancel inheritance of shape and size | A separate resolution chain for each property. Governing example. Implicit `content` from the value's own media. A fallback that keeps shape and size. A fixture with one case per property. | §3.6 · Register D-08 · Queue VD-1a |
| D-15: negative cache tests and no leakage | `mediaId` in the URL. The gate is checked before 304. `no-store` on 404. The proxy does not cache failures. Mandatory tests N1–N16. | §3.8-c/f · Register D-15 · Queue VD-1c |
| Inspect CI and PR comments | Codex P2: race between media deletion and saving a visual. **Valid.** Addressed by locking the media row in both paths (new D-16) with tests. | §3.8-d · R16 · D-16 |
| Current-UI screenshots + prototype | Screenshots `IMG_2584`–`IMG_2588` analysed against the code (C1–C12). VD-3 requirements written. Template `catalog-rounded` added from the owner's concept image. | `AWJ-VD-H1-VD3-EDITOR-UX-REQUIREMENTS.md` · §2.8 · §3.7 |

## Codex review round 2 (on `c247566`) — changes applied

| Finding | Assessment | Change |
|---|---|---|
| P1: the `src` origin path does not reach Laravel from the storefront origin, and the mapper has no facet branch | **Valid.** Verified in `mappers.ts:164`: the generic pattern does not match three segments, so the URL is returned raw. | An explicit, validated branch in `toRenderableMediaUrl()` before the generic pattern. Anything invalid maps to `null`, which triggers the fallback chain. Tests added. Recorded under D-03. |
| P2: the optional concurrency token allows silent overwrites | **Valid.** | `version` column and `expected_version` required whenever a row exists (428/409). New decision D-17. |
| P2: `showLabels` versus `showLabel` | **Valid.** | Standardized on `showLabel` in every layer (D-08). |

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
- `docs/plans/store/visual-dimensions/AWJ-VD-H1-VD3-EDITOR-UX-REQUIREMENTS.md` (new, review round 1)
- `docs/autonomous-engineering/CURRENT-STATE.md` (pointer section only)
- `docs/autonomous-engineering/TASK-QUEUE.md` (pointer section only)

## Tests and exact results

No runtime change, so no PHP or web tests were run for this slice. The documentation makes no claim of test results.

## Build / lint / typecheck

Not applicable (docs only).

## CI

Observed on the first head `675878d`: `php artisan test (L11, pgsql)` passed. `sqlite` and `CI Gate` were still running at the time of the review round. The final head status is recorded in the PR comment/summary after the round-1 push. No failure related to this slice was observed.

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
- R16 (race) and R17 (caching) were added after review.
- The same pre-existing race in the customizer presentation documents is out of scope (backlog).

## Discovered backlog

See Task Queue → Backlog.

## Git state

- Branch: `docs/awj-commerce-visual-dimensions-h1-0`
- PR: see GitHub (opened from this branch)
- Base SHA: `f147fb6063d36952971724609250f9ba1baf42f5`
- Head SHA: recorded on the PR

## Recommended next dependency-ready task

**VD-1a** (visual contract and registries: pure code, no DB/API). It becomes ready only after the owner approves the Decision Register.
