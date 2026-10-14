# AWJ-ERP-UX-H1-4B — Product edit sideways scroll — Implementation Report

STATUS: PR OPEN (see PR for exact-head CI, PRE_MERGE_REVIEW and merge record)
DATE: 2026-10-14
Backlog: ERP-UX-022 (P2) · Audit: [H1-0](../AWJ-ERP-UX-H1-0-AUDIT.md) · Contract: H1-1 §2.7

## Outcome
`/products/:id/edit` no longer scrolls horizontally (264 px at 1440 px in AR and EN, v3 and legacy; 40 px at 768; 32 px at 320–390).

## Root cause
`product-media-section.tsx` rendered the live-media file input as `<Input className="sr-only">`. The shared `Input` applies `w-full px-3 border`; those utilities win over `sr-only`, so the "hidden" input was `position: absolute` with the width of a distant positioned ancestor and pushed the document wider. It was also an invisible, unnamed Tab stop.

## Approach
Replace it with a native `<input type="file" hidden>` keeping the same ref, id, `accept`, `multiple`, `disabled` and `onChange`. The input is only opened programmatically by the visible upload buttons (`fileInputRef.current?.click()`), which works on `hidden` file inputs in current browsers. The pending-upload input (`ws-media-pending`, visible and labelled) is unchanged.

Not changed on purpose: the same `<Input className="sr-only">` pattern in `general-payment-form.tsx` and `document-payment-form.tsx` sits inside a positioned label and produced **no** measured overflow; finance forms are left untouched in this slice and the pattern is recorded in H1-1 §2.7.

## Changed files
- `web/src/components/products/product-media-section.tsx`
- `web/src/components/products/product-workspace.test.tsx` (+1 test)
- `docs/plans/erp/reports/AWJ-ERP-UX-H1-4B-REPORT.md`

## Tests and exact results
- `product-workspace.test.tsx` → 25 passed (new: live input is `hidden`, not `w-full`, still `type=file`; existing media tests for pending upload and first-save upload unchanged).
- Full Vitest on the final tree: recorded in the PR.
- Real browser (baseline vs integration build), page overflow on `/products/:id/edit`: 1440 AR 264 → **0**, 1440 EN 264 → **0**, 768 40 → **0**, 390 32 → **0**, 320 32 → **0**.

## Self-review / Guardian
Upload flow, endpoints, file types and limits unchanged; no product data, price or stock field touched.

## Risks / remaining
Upload through the live gallery was not exercised end-to-end in the browser (no upload performed against the local backend); covered by existing unit tests of the upload handlers.

## Recommended next task
H1-4A (bidi-safe names, action header labels).
