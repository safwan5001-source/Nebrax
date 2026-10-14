# AWJ-ERP-UX-H1-2C — Toast region, error announcements, localized dismiss — Implementation Report

STATUS: PR OPEN (see PR for exact-head CI, PRE_MERGE_REVIEW and merge record)
DATE: 2026-10-14
Backlog: ERP-UX-004 (P2) · Audit: [H1-0](../AWJ-ERP-UX-H1-0-AUDIT.md) · Contract: H1-1 §2.3 (T1–T4)

## Outcome
The shared toast (`web/src/components/ui/toast.tsx`, `useToast()` in 185 modules) now:
- stays inside the viewport on phones (equal 16 px inline margin; corner placement with `max-w-sm` from `sm`), above the iOS safe area;
- announces errors immediately (`role="alert"`, `aria-live="assertive"`); success/info/warning stay polite (`role="status"`);
- keeps errors on screen 8 s (successes 4 s) and pauses auto-dismiss while hovered or focused;
- names the dismiss button in the interface language (`common.dismissNotification`: «إغلاق التنبيه» / "Dismiss notification").

No API of `useToast()` changed; no caller edited.

## Root cause
- Container `fixed bottom-4 end-4 w-full max-w-sm`: `w-full` is the full viewport width, then offset by `end-4`, so on phones it overflowed by 16 px (and started at x = −16 in LTR).
- Every variant used `role="status"` and the same 4 s timer.
- The timer effect depended on the inline `onDismiss` prop: every toast added or removed re-created it, restarting **all** visible timers. Fixed with a ref.
- Dismiss label was the literal `إغلاق`.

## Changed files
- `web/src/components/ui/toast.tsx`
- `web/src/messages/{ar,en}.json` (`common.dismissNotification`)
- `web/src/components/ui/__tests__/toast.test.tsx` (new, 6 tests)
- `docs/plans/erp/reports/AWJ-ERP-UX-H1-2C-REPORT.md`

The label uses `useCommonLabel` from H1-2A (`web/src/lib/ui-label.ts`), so a consumer rendered without an intl provider still gets the label from `<html lang>`.

## Tests and exact results
- `toast.test.tsx` → 6 passed (polite vs assertive; error outlives success; hover pause; AR/EN label; phone inset class; provider-less label).
- Full Vitest on this branch (rebased on `main` `ca652ff`): **553 files, 6,023 tests passed**.
- Real browser (production builds, local Laravel), toast region bounds (`left`/`right` vs viewport width):

| Viewport | Before (`main`) | After |
|---|---|---|
| 320 AR | 4 → 336 (vw 320) | **16 → 304** |
| 320 EN | −16 → 343 | **16 → 304** |
| 390 AR | 16 → 400 (vw 390) | **16 → 374** |
| 1440 EN | 1040 → 1424 | 1040 → 1424 (unchanged) |

## Self-review / Guardian
- Reviewer: no new prop; `role` switch only by variant; pause state is per toast; the ref fix removes a real timer-reset bug.
- AWJ Guardian: presentation only. Toast text, which actions raise toasts, and every request/posting path are unchanged.

## Risks / remaining
Not verified: real screen readers; iOS safe-area on a device.

## Recommended next task
H1-6A (contrast and workspace link names).
