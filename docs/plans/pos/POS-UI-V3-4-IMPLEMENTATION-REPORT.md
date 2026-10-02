# POS-UI-V3-4 — Implementation Report

STATUS: READY FOR REVIEW
DATE: 2026-10-03

## Outcome

Payment is a terminal workspace over the existing tender engine. Amount due stays the strongest number. Methods are large targets. One received-amount field follows the selected method. Paid, Remaining, and Change stay visible. Remaining is the strongest result while a balance remains. Change becomes the strongest result when cash change exists. Confirm Payment stays the only primary action.

## Repository evidence / root cause

Started from latest `origin/main` `3429ec39018479671326928ecb732294404f2878` (POS-UI-V3-3, PR #1170).

POS-UI-V3-3 POST_MERGE_REVIEW: PASS on that merge SHA. Post-merge Web CI [37068605907](https://github.com/safwan5001-source/Nebrax/actions/runs/37068605907) and PHP CI [37068605826](https://github.com/safwan5001-source/Nebrax/actions/runs/37068605826) succeeded. Comment: https://github.com/safwan5001-source/Nebrax/pull/1170#issuecomment-5962392928

The previous payment screen used a fixed 340px summary and put an amount input inside every method card.

## Approach chosen

- Desktop split is `7fr / 13fr` (35/65) with a 240px summary floor. DOM order stays summary then interaction, so LTR matches the approved diagram and RTL mirrors it.
- Method tiles are buttons (`min-h-14`, `aria-pressed`) and show an applied amount. They do not each contain an input.
- The selected method owns one received field. Exact amount and quick amounts still call `set()` for that method, and exact amount still fills `remainingForMethod` (not the full total when another tender exists).
- `simulateTenders` and `orderedTenderPayload` are unchanged. Confirm still sends that payload and stays locked while paying, offline, submitting, or recovering.
- On-screen keypad stays the existing `PosNumericEditor` dialog, opened only when `show_onscreen_numeric_keypad` is on. Payment passes `keyClassName="min-h-14"` (56px). The cart editor default remains `min-h-12`.
- Deferred payment copy and the disabled-reason path are unchanged.
- Selecting a method targets it. It does not overwrite a stored amount. Exact amount remains the way to fill the real remaining balance.

## Why this approach fits AWJ

Presentation only. No change to checkout authority, tender ordering, change math, deferred policy, or idempotency.

## Changed files

- `web/src/components/pos/pos-payment.tsx`
- `web/src/components/pos/pos-payment.test.tsx`
- `web/src/components/pos/pos-numeric-editor.tsx`
- `docs/plans/pos/POS-UI-V3-4-IMPLEMENTATION-REPORT.md`

## Tests and exact results

Local Vitest, exit 0:

- `pos-payment.test.tsx` — 13 passed
- `pos-numeric-editor.test.tsx` — 6 passed
- Earlier in this slice: `pos-responsive.test.ts` and `pos-payment-tender.test.ts` passed (included in a 40-pass run before the final keypad assertion fix; those two files were not edited)

## Build / lint / typecheck

`npm run build` in `web/` compiled TypeScript successfully (`Compiled successfully in 22.4s`) then failed the local ESLint step because `eslint-config-next` is not installed in this environment. That failure is outside this diff (store-experience files, missing Next ESLint plugin). Web CI on the PR is the authoritative build.

## CI

Pending on the PR.

## Pre-merge review

- PRE_MERGE_REVIEW: PENDING
- Reviewed Head SHA: pending exact final head
- Findings / resolution: pending

## Merge

- Merge status: not merged
- Merge SHA: —

## Post-merge review

- POST_MERGE_REVIEW: PENDING
- Reviewed Merge SHA: —
- Target-branch checks/smoke: —
- Findings / resolution: —

## Self-review

### Implementer

One received field. Method selection is explicit. Tender payload path is the same function as before.

### Reviewer

Tests that typed into a second method now select it first. Assertions on paid, remaining, change, bank overflow, split order, change-from-cash, deferred, and the submit lock are unchanged in meaning.

### AWJ Guardian

- Accounting impact: none. No journal entries.
- Tenant / branch isolation impact: none.
- Security / authorization impact: none.
- Backward compatibility: same `PosPayment` props and `onConfirm` payload.
- API / DB / migration impact: none.

## Accounting impact

None.

## Tenant / branch isolation impact

None.

## Security / authorization impact

None.

## Backward compatibility

Props and confirm payload are unchanged. The keypad still appears only when the existing POS setting is on.

## API / DB / migration impact

None.

## External research used

None.

## Risks / remaining work

Portrait payment stacking is still the current single column. POS-UI-V3-5 owns the sticky transaction bar and full-height cart, not a second payment engine.

Local production lint could not load `@next/next` rules. Do not treat that as a product failure unless Web CI fails.

## Discovered backlog

None that blocks this Horizon.

## Git state

- Branch: `pos-ui-v3-4`
- PR: pending
- Base SHA: `3429ec39018479671326928ecb732294404f2878`
- Head SHA: recorded after commit; PRE_MERGE uses the exact final head

## Recommended next dependency-ready task

POS-UI-V3-5 after this slice is merged and POST_MERGE_REVIEW passes.
