# H1-4B — Platform Tenant Details UX — Implementation report

STATUS: IN REVIEW / DO NOT MERGE / DO NOT DEPLOY
Horizon: AWJ-PLATFORM-UX-H1 · Slice: H1-4B (tenant detail) · Date: 2026-10-12
Spec: [AWJ-PLATFORM-UX-H1-1-UX-SPEC.md](./AWJ-PLATFORM-UX-H1-1-UX-SPEC.md) §8 (dialogs) and §12.4 (tenant detail)

## Outcome

`/platform/tenants/[id]` is reorganised inside the merged `PlatformShell`. The three `window.confirm` calls (deactivate or activate a tenant, cancel a contract, record a contract's expiry) are replaced by one confirmation dialog with initial focus on "Go back", focus return to the opener, Escape and backdrop as cancel, Tab and Shift+Tab containment, and a request that is sent only by the confirm button. Request URLs and bodies are byte-identical to before. No API, schema, permission, money formatting or tenant-isolation change.

## What was done

Product code:

- `web/src/app/platform/(console)/tenants/[id]/page.tsx` (page rework)
- `web/src/components/platform/confirm-dialog.tsx` (new)
- `web/src/components/platform/contract-management-card.tsx` (confirm flow, button sizing)
- `web/src/components/platform/commercial-operations-card.tsx` (one-line overflow fix, see below)

Page:

- **Header:** back link to the tenant list with a logical chevron (`rtl:rotate-180`), visible text and 44px height (it said "Back to dashboard" and linked to the list; new key `backToTenants`). The name wraps instead of truncating, with slug (LTR), status and plan badges under it.
- **Identity card:** one column below `sm`, two from `sm`, three from `lg`. Email and phone are LTR (email breaks anywhere), dates are LTR. Added `subscription_ends_at` (already returned by the API, not shown before) next to the trial end. Copy-reference buttons have a 44px hit area, same 16px icon, same accessible name.
- **Plan and trial:** side by side from `lg`, stacked below. Selects, date input and buttons are 44px; buttons are full width below `sm`. Every control now has a real `<label for>` (before, labels were not associated). Same disabled rules, same PATCH payloads (`{ plan }`, `{ trial_ends_at }`, `{ trial_ends_at: null }`).
- **Contracts, commercial operations, application overrides:** unchanged components in their previous order. "Record contract" is 44px and full width below `sm`.
- **Access management:** last card before the audit note, marked as a sensitive action by an icon, a text badge ("Sensitive action"), a red border and a danger button that carries an icon and its own text label, so danger is not conveyed by colour alone. Order of the cards is otherwise the spec's order.
- **States:** skeleton while loading with no data yet (it no longer stays on screen under a failure message); failure is `role="alert"` with a 44px Retry; success is `role="status"`; each action clears the previous message first; the region has `aria-busy` while refreshing; the signed-out redirect is unchanged.

Dialogs:

- **`ConfirmDialog`** is built on the existing `Dialog` without editing it. It adds initial focus on "Go back" (never on the destructive button), focus return to the opener (falls back to `#platform-content` if the opener no longer exists), Tab and Shift+Tab containment, and a busy state in which both buttons are disabled and Escape/backdrop do not close. Title says what will happen ("Deactivate {name}?"), the body repeats the existing confirmation sentence, the confirm button is `danger` with an icon for deactivate, cancel and expire, and `primary` for activate. The cancel button is labelled "Go back" so it cannot be confused with "Cancel contract".
- **Deactivate or activate:** opening the dialog sends nothing; confirming sends exactly `PATCH /platform/tenants/{id}` with `{ is_active }`, closes the dialog and announces the result. A failure shows an alert.
- **Cancel or expire a contract:** the dialog now contains the effective date and reason fields plus the confirmation sentence; confirming sends the same `POST /platform/subscriptions/{id}/cancel|expire` with `{ effective_on, reason }`. The old second `window.confirm` after the form is gone, so there is one decision step instead of two. A failure keeps the dialog open with the error shown on the card. "Change contract" (transition) keeps its form dialog unchanged: it is not destructive and the spec does not ask for a confirm step there.

## Not done, deliberately

- No change to the commercial-operations assignment and application-override flows: their preview and confirmation-token dialogs stay as they are (spec §8).
- No `Dialog` edit, so the shared component still does not trap Tab; `ConfirmDialog` does it for the three confirmations only. The transition dialog and the commercial-assignment dialogs keep the shared behaviour.
- Existing `size="sm"` buttons inside the contract, commercial and override cards (32 to 36px) are unchanged; the spec keeps existing sm controls until a slice names them. See risks.
- No API, payload, schema, permission, money or tenant-isolation change. No ERP page touched. H1-4C not started.

### One limited fix outside the page file, justified

At 430px and below the commercial-operations card header (title block plus Refresh and Assign buttons) forced page-level horizontal scroll because its button group could not wrap. It is one class on each of two elements (`flex-wrap`). Found by the real-browser run (12 of 32 combinations failed before it, 0 after), it breaks the spec's no-page-scroll rule on this page.

## Files changed

- `web/src/app/platform/(console)/tenants/[id]/page.tsx`
- `web/src/components/platform/confirm-dialog.tsx` (new) and `confirm-dialog.test.tsx` (new, 7 tests)
- `web/src/components/platform/contract-management-card.tsx` and `contract-management-card.test.tsx` (new, 7 tests)
- `web/src/components/platform/commercial-operations-card.tsx` (two class names)
- `web/src/app/platform/(console)/tenants/[id]/tenant-detail.test.tsx` (new, 14 tests)
- `web/src/messages/ar.json`, `web/src/messages/en.json` (+6 keys each: `backToTenants`, `subscriptionEndsAt`, `sensitiveAction`, `goBack`, `deactivateDialogTitle`, `activateDialogTitle`)
- `docs/plans/platform/AWJ-PLATFORM-UX-H1-4B-TENANT-DETAIL-REPORT.md` (new)
- `docs/plans/platform/AWJ-PLATFORM-UX-H1-4A-TENANTS-REPORT.md`, `AWJ-PLATFORM-UX-H1.md` (status/closure only)

## Tests actually run

| Command | Result |
|---|---|
| `npx vitest run src/components/platform src/app/platform src/design src/components/data-table.test.tsx` | 21 files, 239 tests passed |
| `npm test` (full web suite) | 505 files, 5303 tests passed |
| `npm run build` | passed; all 7 `/platform*` routes build, URLs unchanged |
| `npx tsc --noEmit` | 48 errors, same count as `main`; none in the files touched here |
| ESLint | not run: the repo has no ESLint config |

The existing `tenant-reference-numbers.test.tsx` (display and copy of both reference numbers on the detail page) and the commercial-operations tests pass unchanged.

New tests (28), jsdom, real components, real `ar.json`/`en.json`, `platformApi` mocked:

- **`ConfirmDialog`:** opens labelled and modal and sends nothing; first focus is "Go back"; Escape, backdrop, close button and "Go back" each cancel without confirming and return focus to the opener; confirm only through the confirm button; Tab and Shift+Tab wrap inside and escaped focus is pulled back; busy disables both buttons and ignores Escape; danger variant plus text label.
- **Detail page:** identity fields with LTR values, logical back link, one `h1`, all three child cards present; skeleton then failure alert with 44px retry and no endless skeleton; signed-out redirect and no request; plan save payload, success as `status`, Save disabled until the plan differs; trial save and clear payloads with labelled controls; a failed save is an `alert` and not a status; deactivate opens a dialog with no request and no `window.confirm`; Escape and "Go back" cancel with focus back on the button and no request; confirm sends exactly `{ is_active: false }` once, closes, announces; activate is primary and sends `{ is_active: true }`; failed confirm shows an alert and closes; the sensitive section has text, icon and a danger button; copy button 44px and clipboard call; Arabic render and message keys in both locales.
- **Contract card:** cancel dialog sends nothing and never calls `window.confirm`; Escape and "Go back" cancel and restore focus; confirm posts `/platform/subscriptions/sub-1/cancel` with `{ effective_on, reason }` once, refreshes and announces; expire uses `/expire`; a failed confirm keeps the dialog open with an alert and confirm needs a date; transition keeps its payload `{ plan, currency: 'SAR', effective_on, external_reference, reason }` with no added confirm step; contracted amounts still formatted by `formatRiyal` (`1,500.50`).

Real browser (Playwright-core and Chromium, Next dev server, demo mode). **Mock versus real session:** the browser used the real Next app and real components, but every `/api/*` call was intercepted: the tenant `GET` and `PATCH` and the contract `POST` endpoints returned fixtures (and recorded what was sent), and all other endpoints returned 503. There was no Laravel API and no real platform session, so server-side authorization, real validation errors and real data were not exercised.

| Probe | Matrix | Result |
|---|---|---|
| Layout | widths 320, 375, 390, 430, 768, 1024, 1440, 1920 × `ar`/RTL, `en`/LTR × light, dark = 32 | 0 failures after the card-header fix: no page-level overflow, direction and theme correct, one `h1`. Before the fix 12 of the 32 combinations, all at 430px or narrower, overflowed |
| Deactivate dialog (390, en, keyboard) | open with Enter from the button | one dialog, focus on "Go back", **0 requests** before confirming; 6 Tab and 6 Shift+Tab presses never left the dialog (order: confirm, Close, Go back, confirm, Close, Go back); Escape closed it with 0 requests and focus back on "Deactivate tenant"; confirming sent exactly `PATCH {"is_active":false}`, the dialog closed, the status "Tenant status updated." appeared and focus landed on the button, now "Activate tenant" |
| Contract cancel dialog (1440, ar, dark) | open from the keyboard | one dialog, focus on "تراجع", 0 requests; Escape closed it, 0 requests, focus back on the opener "إلغاء العقد" |
| Failure (390, ar) | all APIs 403 | alert "ممنوع" shown, no skeleton left on screen |

The fixture used a 90-character mixed Arabic and English name, a long slug, a long email and large amounts to stress layout. Screenshots were reviewed in both directions and the dialog on a phone.

## Responsive and accessibility results

- **320 to 1920, both directions, both themes:** verified as above. The history table (contract card) was already a table from `lg` and cards below.
- **Dialog behaviour:** initial focus, focus return, Escape, Tab and Shift+Tab containment verified in jsdom and in the real browser for the deactivate dialog (keyboard) and the contract-cancel dialog (open, focus, Escape, return).
- **Touch targets:** new and changed page controls (back link, plan select, trial input and buttons, copy buttons, access button, retry, dialog buttons, record contract) are at least 44px. **Still below 44px, unchanged:** the `sm` action buttons inside the contract rows (32px), the commercial-operations and application-override cards (32 to 36px), and the browser's native date-picker icon (28px). The spec keeps existing `sm` controls until a slice names them.
- **Not verified:** landscape, zoom and text scaling, screen readers (announcement of the dialog title and status), a real authenticated session against the Laravel API, and Tab behaviour in the transition and commercial dialogs (shared `Dialog`, no trap). H1-5 owns those.

## Pre-merge reviews

### Implementer

Product changes are confined to this page, a new dialog wrapper, the contract card's confirmation, and two class names. The `PATCH` and `POST` calls were not edited; only what triggers them moved from `window.confirm` to a dialog. The real-browser run found the card-header overflow, which jsdom cannot see.

### Reviewer

- **No action by opening:** the confirm handlers are only reachable from the confirm button; tests assert zero requests after opening, after Escape, backdrop, close and "Go back", and in the real browser. While a request is in flight both buttons are disabled and Escape does not close, so a second click cannot send a second request.
- **Focus return:** the opener is captured during the first render of the dialog body, before focus moves. The page passes the access button explicitly (Safari does not focus buttons on click). The contract card passes the clicked button. If the opener disappears after a successful change (a cancelled contract no longer has those buttons) focus falls back to the page content container instead of the document body.
- **Contract flow change:** previously the user saw a form dialog and then a `window.confirm`; now they see one dialog that contains the fields and the confirmation. Payloads and endpoints are the same.
- **Heading structure:** no extra section headings were added, because the child cards already carry their own titles and duplicates would read twice.

### AWJ Guardian

- **Permissions and isolation:** every request still goes through `platformApi` with the platform administrator session; no tenant ERP context, branch header or ERP component is used. Server-side authorization is the boundary and is unchanged; the UI is not one. The signed-out redirect is unchanged.
- **Sensitive actions:** deactivate, activate, contract cancel and contract expiry now require an explicit in-page confirmation that states the consequence. Opening a dialog cannot change data. The audit notice is kept.
- **Secrets and data exposure:** nothing new is requested or shown except `subscription_ends_at`, a field the same endpoint already returns to the same authorized operator. No secret or other tenant's data is displayed.
- **Money:** contracted amounts still go through `formatRiyal` and contract amounts are not recomputed or re-rounded; a test checks a formatted amount.
- **Backward compatibility:** URLs, endpoints, bodies, response handling, props of the three child cards and the existing tests are unchanged; translation keys only added.

## CI

Recorded on the pull request for the exact head SHA (the checks and the final head are listed in the PR and in the hand-off summary). This file is part of that head, so it does not restate results that did not exist when it was committed.

## Merge / post-merge

- Merge status: not merged. Merge SHA: none. Post-merge review: not done. Deploy: not requested.
- Post-merge verification of #1318, #1328, #1355, #1358 and #1362 on `main` has not been recorded; this slice does not claim it.

## Risks and remaining work

- **Mocked API only in the browser.** The real authenticated flow (real 403/422 messages, real latency, a real tenant list feeding this page) was not run. Behaviour on a real `PATCH` failure is covered by unit tests and one browser failure state, not by a live server.
- **Focus trap scope.** Only the three confirmations trap Tab. The shared `Dialog` and the transition and commercial dialogs still let Tab leave. Fixing it in `Dialog` is a shared-component change recorded for a later slice.
- **Small controls remain** in the child cards (see above); a dedicated slice should enlarge them together with their card layouts.
- **Long names in the dialog title** are truncated by the shared `Dialog` title style; the full name is still the dialog's accessible name and the sentence below does not repeat it.
- Pre-existing and unrelated: 48 `tsc` errors in test files; `IntlError` for a `cart.itemCount` key printed by some tests; Next dev overlay badge in dev screenshots.

## Git state

- Branch: `claude/awj-h1-contrast-recovery-fx8unn` (restarted from `main` after #1362 merged; older remote history is merged in so no force-push is needed).
- Base SHA: `93a30cf873c99078b0d766f4ade7537f765bacd7` (`origin/main` at start).
- Head SHA and PR: see the pull request.

## Next dependency-ready task

**H1-4C**, the next page in the H1-4 list (prices, integrations or document operations, one per PR, spec §12.5 to §12.7). Not started.
