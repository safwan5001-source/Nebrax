# AWJ-ERP-UX-H1-7E — Arabic placeholders in numeric fields, Customizer chevron — Implementation Report

STATUS: PR OPEN (see PR for exact-head CI, PRE_MERGE_REVIEW and merge record)
DATE: 2026-10-14
Backlog: ERP-UX-018, ERP-UX-020 (P3) · Audit: [H1-0](../AWJ-ERP-UX-H1-0-AUDIT.md)

## Outcome
- **ERP-UX-018:** numeric inputs (`.num`) use IBM Plex Mono for tabular digits; their placeholder is often Arabic hint text («اختياري»), which Mono rendered letter-spaced and broken. `.num::placeholder` now uses the Sans family; typed values stay Mono.
- **ERP-UX-020:** the Store Customizer sidebar toggle passed polyline *points* to `<path d>`, so the browser logged `Expected moveto path command` on `/commerce/appearance` and the chevron never rendered. It is now a `<polyline points>` — the intended chevron appears; no other Customizer behavior changes.

## Changed files
`web/src/app/globals.css` (one rule), `web/src/modules/store-experience-builder/ExperienceBuilder.tsx` (one element), test `web/src/app/__tests__/erp-ux-h1-7e.test.ts`.

## Tests and exact results
- Guard tests (2): `.num` stays Mono and `.num::placeholder` is Sans; chevron uses `polyline`, never `path d={points}`.
- Store Customizer suites: 134 files / 2,406 tests pass. Full Vitest on the exact head: recorded in the PR.
- Real browser (final `main` build vs this change, AR, 1440):

| Probe | `main` | This change |
|---|---|---|
| `/commerce/appearance` SVG `path d` console errors | 1 | **0** |
| `/purchase-orders/new` «اختياري» placeholder font | IBM Plex Mono | **IBM Plex Sans Arabic** (value font unchanged: Mono) |

## Guardian
Presentation only. No value, number formatting, Customizer persistence, preview contract or `/platform` file touched.
