# AWJ-ERP-UX-H1-5A — One localized forbidden state — Implementation Report

STATUS: PR OPEN (see PR for exact-head CI, PRE_MERGE_REVIEW and merge record)
DATE: 2026-10-14
Backlog: ERP-UX-009 (P2) · Audit: [H1-0](../AWJ-ERP-UX-H1-0-AUDIT.md) · Contract: H1-1 §2.5

## Outcome
When the API answers **403** (role permission or commercial entitlement), the delivery-notes list and the five Document Center pages now show one localized message — "This capability isn't available for your organization or role. Ask the account owner to enable it." / «هذه القدرة غير متاحة لمؤسستك أو لدورك…» — instead of the raw Arabic server sentence; **Retry** is not offered (it cannot succeed), and the empty-state "create" call to action and the create/upload buttons for the forbidden resource are hidden. Other errors behave exactly as before (server message, retry available).

## Root cause
Each page rendered `ApiError.message` for every failure and offered Retry; `/delivery-notes` additionally rendered its empty state ("No delivery notes" + "New delivery note") underneath the error because the empty check ignored `error`.

## Approach
- `web/src/lib/load-failure.ts`: `describeLoadFailure(error, { forbidden, fallback })` → `{ message, forbidden }` (403 → catalog text; other `ApiError` → server message or fallback; non-API → fallback).
- New key `common.capabilityUnavailable` (AR/EN).
- Pages: `delivery-notes/page.tsx`; `documents/page.tsx`, `documents/{usage,operations,governance,settings}/page.tsx` — keep a `forbidden` flag next to `error`, hide Retry when forbidden; delivery notes also hide the empty state on any error and hide its header actions on 403; Document Center hides Upload on 403.

## Changed files
- `web/src/lib/load-failure.ts` (new), `web/src/lib/__tests__/load-failure.test.ts` (new, 3 tests)
- `web/src/app/(app)/delivery-notes/page.tsx`
- `web/src/app/(app)/documents/page.tsx` (+ test case), `.../usage/page.tsx`, `.../operations/page.tsx`, `.../governance/page.tsx`, `.../settings/page.tsx`
- `web/src/messages/{ar,en}.json`
- `docs/plans/erp/reports/AWJ-ERP-UX-H1-5A-REPORT.md`

## Tests and exact results
- `load-failure.test.ts` → 3 passed; `documents/page.test.tsx` → 3 passed (new: 403 shows the catalog message, no raw text, no Retry, no Upload).
- Full Vitest on the final tree and real-browser before/after on the 403 pages: recorded in the PR.

## Guardian
No permission, entitlement or API change: the same requests are made and the server still decides. The UI only stops offering actions the server has already refused.

## Observation for the owner (not changed)
For the isolated test tenant (pre-cut-over tenant, legacy `plan = enterprise`), `GET /applications/nav-state` correctly returns `document_center.core: false`, so Document Center is hidden from the sidebar (it was reached by URL). It returns **no** `sales.invoicing` key, so the sidebar keeps the Delivery-notes link (its `appKey`) visible while `GET /delivery-notes` is refused by `commercialApp('sales.invoicing', 'read')`. Whether nav-state should report commercial entitlement for `sales.invoicing` is an entitlement-policy question outside UX authority; recorded for the owner, not changed.
