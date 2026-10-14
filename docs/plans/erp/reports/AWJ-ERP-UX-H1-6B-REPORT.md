# AWJ-ERP-UX-H1-6B — In-app confirmation instead of `window.confirm` (finance, accounting, HR) — Implementation Report

STATUS: PR OPEN (see PR for exact-head CI, PRE_MERGE_REVIEW and merge record)
DATE: 2026-10-14
Backlog: ERP-UX-017 (P3, consistency) · Audit: [H1-0](../AWJ-ERP-UX-H1-0-AUDIT.md) · Contract: H1-1 §2.1 (modal dialog D1–D7)

## Outcome
Finance, accounting and HR screens ask "are you sure?" in an AWJ dialog instead of the browser's native box: same wording, interface-language buttons, design-system styling, red confirm for destructive actions, **Cancel focused first**, Escape/outside-click cancel, focus returns to the button that asked. What each action does — and the request it sends — is unchanged.

## Approach
- `web/src/components/ui/confirm-dialog.tsx`: `ConfirmProvider` (mounted once in `Providers`, next to `ToastProvider`) and `useConfirm()` → `confirm({ message, tone?, title?, confirmLabel? }): Promise<boolean>`, rendered with the H1-2A `Dialog`. Same contract as `window.confirm`: `true` only on Confirm; Cancel, Escape, overlay or a superseding request resolve `false`.
- Call sites changed from `if (!window.confirm(msg)) return;` to `if (!(await askConfirm({ message: msg, tone }))) return;` — identical message keys; `tone: 'danger'` for delete / deactivate / cancel, default for post / send / reset. One callback (`hr` role delete) became `async`; `askConfirm` added to `useCallback` dependencies where used.
- Outside the provider (isolated component tests), `useConfirm()` falls back to `window.confirm`, so the existing tests that stub `window.confirm` keep testing the same branches.
- New keys `common.confirm` (تأكيد / Confirm), `common.confirmTitle` (تأكيد الإجراء / Confirm action).

## Converted (31 call sites, 20 files)
Cash & bank (list + detail), cost centers, manual journals (list + detail), employee custodies (list + detail: post, delete), expenses (list, detail: post, delete; categories), payment methods, settlement types, receipt vouchers (list + detail: post, delete), account routing (reset), HR (team invitation, role delete; employee detail: contract, leave request, employee request, attachment; request types, org structure, leave types).

## Not converted in this slice (recorded)
Products (variants ×5, barcodes, list/detail delete), price lists ×2, POS (held sale discard, devices), Fuel master-data retire, Commerce unsaved-changes registry and Store Customizer ×5. Same primitive applies; left out to keep this slice to the backlog's "finance/HR first" scope and away from Commerce/Customizer layer ownership.

## Tests and exact results
- `confirm-dialog.test.tsx` (7): resolves true on Confirm; Cancel focused first and Confirm red for `danger`; false on Cancel and Escape with focus back on the trigger; primary style + custom label; Arabic labels; native fallback outside the provider; guard that the converted directories contain no `window.confirm`/`confirm(`.
- Converted modules' existing suites: 9 files / 66 tests pass unchanged.
- Typecheck: clean for app code.
- Full Vitest on the exact head: recorded in the PR.
- Real browser (production builds, local Laravel, `/cost-centers` delete):

| Probe | `main` | This change (EN) |
|---|---|---|
| Dialog | native browser box | `role=dialog` "Confirm action", "Delete this cost center?" |
| Initial focus | — | **Cancel** |
| Tab presses leaving the dialog (of 20) | 20 (native box; page not focus-managed) | **0** |
| Cancel → requests | none | **none** |
| Escape → requests | — | **none** |
| Confirm → requests | — | **`DELETE /cost-centers/{id}` (same endpoint), row removed** |
| Native dialogs raised | 2 | **0** |

## Self-review / Guardian
- Reviewer: no call site's condition changed besides `await`; message keys untouched; provider adds one hidden-until-open dialog to the tree.
- AWJ Guardian: posting (expenses, custodies, receipt vouchers) and deletes still require an explicit confirmation; the default focus is the safe choice; Escape never confirms. No request payload, permission, posting rule, ledger or API change.

## Risks / remaining
- Remaining native confirms listed above.
- Not verified: real screen readers.

## Recommended next task
H1-7B (heading order and remaining P3 items).
