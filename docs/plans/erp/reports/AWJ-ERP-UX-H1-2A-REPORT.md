# AWJ-ERP-UX-H1-2A — Dialog focus management + localized close label — Implementation Report

STATUS: PR OPEN (see PR for exact-head CI, PRE_MERGE_REVIEW and merge record)
DATE: 2026-10-14
Backlog: ERP-UX-001 (P1), ERP-UX-002 (P2) · Audit: [H1-0](../AWJ-ERP-UX-H1-0-AUDIT.md) · Contract: H1-1 §2.1 (D1–D7)

## Outcome
The shared modal `Dialog` (`web/src/components/ui/dialog.tsx`, 123 ERP call sites, also used by `/platform` confirm dialogs) now follows the WAI-ARIA APG modal-dialog pattern: focus moves in on open, Tab/Shift+Tab wrap inside, Escape closes only the top-most dialog, focus returns to the opener, the page behind does not scroll, and the close button is named in the interface language. No props, call signatures, content, actions or requests changed.

## Repository evidence / root cause
The component rendered a fixed `div role="dialog" aria-modal="true"` with only a document-level Escape listener; nothing moved, contained or restored focus. `closeLabel` defaulted to the literal `'إغلاق'` and 122 of 123 callers relied on it.

## Approach chosen
- Focus logic in one effect keyed on `open` only (callers pass inline `onClose`; a ref keeps the latest without re-running focus on every render).
- Initial focus: keep a control that focused itself (`autoFocus`); else first focusable in the body; on `pointer: coarse` the dialog container (prevents the virtual keyboard from covering the dialog — APG allows a static element).
- Tab containment computed from visible focusables; a module-level open stack picks the top-most dialog by DOM nesting so nested dialogs do not fight (React runs child effects first).
- Body `overflow: hidden` saved/restored; opener refocused if still connected.
- Close label: new `common.close` (AR `إغلاق`, EN `Close`) through `useCommonLabel` (`web/src/lib/ui-label.ts`), which falls back to `<html lang>` when a consumer renders without `NextIntlClientProvider` (three existing isolated tests did) — the primitive gains no new provider requirement.

## Why this approach fits AWJ
Fixes one shared primitive instead of 123 pages; matches the existing platform `ConfirmDialog` behavior (its tests pass unchanged, including its own "Go back first" initial focus, which D1 respects).

## Changed files
- `web/src/components/ui/dialog.tsx`
- `web/src/lib/ui-label.ts` (new)
- `web/src/messages/ar.json`, `web/src/messages/en.json` (`common.close`)
- `web/src/components/ui/__tests__/dialog.test.tsx` (new, 10 tests)
- `docs/plans/erp/reports/AWJ-ERP-UX-H1-2A-REPORT.md`

## Tests and exact results
- `npx vitest run src/components/ui/__tests__/dialog.test.tsx` → 10 passed (focus in, autoFocus kept, Tab/Shift+Tab wrap, pull-back from outside, Escape + focus return, scroll lock/restore, nested Escape, AR/EN/explicit label, provider-less fallback, role/modal/name).
- Full Vitest on this branch's final tree: **551 files, 6,011 tests passed**. An earlier run before the fallback hook surfaced 15 failures in 3 files that render `Dialog` without an intl provider (`platform/confirm-dialog`, `reports/report-saved-views`, `commerce-workspace/create-store-dialog`); fixed in the primitive, not by editing those tests.
- Real browser (production build, local Laravel, EN, 1440): integration build containing H1-2A with other H1 slices (port 3002) vs. `main` baseline (port 3001):

| Probe | Before (`main`) | After |
|---|---|---|
| `/cost-centers` "New cost center": focus inside after open | no | yes |
| Tab escapes out of 40 (incl. Shift+Tab) | 31 | **0** |
| Focus after Escape | `A: Fiscal Years` | **trigger button** |
| Close button name (EN) | `إغلاق` | **Close** |
| Body scroll behind | visible | hidden |
| `/contacts` "Add contact": Tab escapes / focus after Escape | 27 / `Purchases` | **0 / trigger** |

## Build / lint / typecheck
`next build` (includes TypeScript) green on the integration build containing this change. No ESLint config in `web/`.

## Self-review
- Implementer: smallest change in one file + one helper; no prop changes.
- Reviewer: effect deps `[open]` intentional (ref for `onClose`); focusables filtered by `getClientRects()` so hidden elements never become wrap targets; stack cleaned in effect cleanup; scroll value restored rather than cleared.
- AWJ Guardian: no request, permission, tenant/branch, money or posting path touched. Dialog content (forms that post/delete) unchanged; Escape still only closes (never confirms).

## Accounting / tenant / security / API / DB
None. Backward compatible: every existing caller works unchanged; `closeLabel` still overrides.

## External research used
WAI-ARIA APG *Dialog (Modal) Pattern* (initial focus, Tab containment, Escape, focus return, `aria-modal` semantics) — see H1-0 §7.

## Risks / remaining work
- Platform dialogs inherit the improved behavior (shared primitive); platform tests pass. No platform file edited.
- Not verified: real screen readers, Firefox/WebKit.

## Recommended next dependency-ready task
H1-6B (native `window.confirm` → in-app dialog) now has a compliant primitive to build on.
