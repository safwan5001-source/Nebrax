# AWJ-ERP-UX-H1-7B — Heading order on ERP pages — Implementation Report

STATUS: PR OPEN (see PR for exact-head CI, PRE_MERGE_REVIEW and merge record)
DATE: 2026-10-14
Backlog: ERP-UX-014 (P3) · Audit: [H1-0](../AWJ-ERP-UX-H1-0-AUDIT.md) · Contract: H1-1 §3 (one `h1`, no skipped levels)

## Outcome
On 91 ERP routes (forms, settings, reports, details) the outline jumped from the page `h1` straight to `h3` card titles, so screen-reader heading navigation ("next level-2 heading") found nothing. Card titles directly under the page title are now `h2`. Nothing visible changes: `CardTitle` styling does not depend on its level.

## Root cause
`CardTitle` defaults to `h3` (a decision locked by the Platform horizon, H15-11, with a test "stays an h3 for every existing consumer"). Platform pages opt in with `as="h2"`; ERP pages never did.

## Approach
- `components/ui/card.tsx`: new `CardTitleLevel` context. `CardTitle` uses `as` if given, else the nearest `CardTitleLevel`, else **`h3`** — so every consumer outside a provider (including all `/platform` pages) renders exactly as before, and both H15-11 tests pass unchanged.
- The ERP `(app)` layout and the `(fuel)` layout set `CardTitleLevel level="h2"` around page content. Explicit `as` still wins (sections that own an `h2` can pass `as="h3"` or wrap their content).
- Pages outside those layouts: `/me` (two cards → `as="h2"`) and `/app-builder/new` (form wrapped in `CardTitleLevel h2`, attribute-level only).
- Two native headings: `/inventory-settings` hub items `h3` → `h2` (no group headings on that hub); developer docs operation summary `h3` → `h2` (its sub-sections stay `h3`).
- `card.tsx` became a client module (`'use client'`); every importer was already a client component (checked).

## Reviewed for over-flattening
14 ERP files render their own `h2`. All are item titles in lists/cards (payment methods, settlement types, fuel stations/permits/orders/alerts, supplier ledger, accounts children, dashboard quick actions, report presentation panels) or a print-template section; card titles become their siblings, which matches the visual hierarchy. No card is visually nested inside one of those `h2` sections.

## Changed files
`web/src/components/ui/card.tsx`, `web/src/app/(app)/layout.tsx`, `web/src/app/(fuel)/layout.tsx`, `web/src/app/me/page.tsx`, `web/src/app/(commerce)/app-builder/new/page.tsx`, `web/src/app/(app)/inventory-settings/page.tsx`, `web/src/components/developer/docs/docs-explorer.tsx`; test `web/src/components/ui/__tests__/card-title-level.test.tsx` (new).

## Tests and exact results
- `card-title-level.test.tsx` (3): provider → `h2` with identical classes; no provider → `h3`; explicit `as` wins; both ERP layouts set `h2`.
- Platform `heading-outline.test.tsx` (H15-11) passes unchanged, including "stays an h3 for every existing consumer".
- Full Vitest on the exact head: recorded in the PR.
- Real browser (production builds, EN, 1440), outline probe over the 91 audited routes (first heading that skips a level):

| Build | v3 | legacy |
|---|---|---|
| `main` before | **91 / 91** routes skip (89 card titles, 2 native `h3`) | — |
| This change | **0 / 91** | **0 / 91** |

The axe `heading-order` pass over the same routes is recorded in the PR.

## Self-review / Guardian
- Reviewer: no class, layout or text change; context default keeps the H15-11 contract; one hook call per render (no conditional hook).
- AWJ Guardian: semantics only. No data, permission, request or `/platform` file change; platform rendering unchanged.

## External research
WCAG 2.2 SC 1.3.1 and 2.4.6; axe `heading-order` (best practice).

## Risks / remaining
- Card titles inside dialogs within ERP pages are now `h2` under the dialog's own `h2` title (sibling level) — no skip, acceptable outline.
- Not verified: real screen readers.

## Recommended next task
H1-7C2 (remaining hard-coded Arabic) and the P3 cluster (ERP-UX-018/019/020/023), then H1-8 closure.
