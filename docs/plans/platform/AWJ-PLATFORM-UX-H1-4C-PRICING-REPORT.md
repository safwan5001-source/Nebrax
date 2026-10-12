# H1-4C — Platform Pricing & Plans UX — Implementation report

STATUS: IN REVIEW / DO NOT MERGE / DO NOT DEPLOY
Horizon: AWJ-PLATFORM-UX-H1 · Slice: H1-4C (prices) · Date: 2026-10-12
Spec: [AWJ-PLATFORM-UX-H1-1-UX-SPEC.md](./AWJ-PLATFORM-UX-H1-1-UX-SPEC.md) §8 and §12.5

## Scope found

The platform has one pricing screen: `/platform/prices` (`web/src/app/platform/(console)/prices/page.tsx`), backed by `GET /platform/prices` and `POST /platform/prices` (`PlatformSubscriptionController::prices` and `storePrice`). There is no separate "plans" or "publish/activate" screen and no edit or delete endpoint for a price version, so none was added. A price version has exactly these API fields: `id, plan, currency, monthly_amount, monthly_amount_minor, effective_on, created_at`. There is **no status field**.

## Outcome

The page now shows, from the data the API already returns: the price in effect by date for each plan, the next scheduled version, a status for every version in the history, a preview of what a new version will be before it is saved, and a plain statement of what adding a version does and does not change. Money display, amount parsing, the POST body and the endpoints are unchanged. No backend, database, permission, pricing-rule or tenant-isolation change.

## What was done

Product code: `prices/page.tsx` (rewritten layout), `prices/price-status.ts` (new, pure date comparison) and `prices/use-today.ts` (new, see the review corrections), new message keys in the `platformPrices` namespace of `ar.json` and `en.json`.

- **Header:** one `h1` and subtitle. The page-level "back" link is gone (the shell has the Prices destination); `Prices` is a top-level destination so there is no parent to return to.
- **Current prices by plan** (new section): one card per plan (`free`, `basic`, `pro`, `enterprise`, plus any other plan code the API returns): the amount in effect by date, since which date, and the next scheduled version with its start date. No amount is computed; each is `formatRiyal` of the API's `monthly_amount` string. A plan with no versions says so; a plan whose only versions are in the future says "No version in effect yet".
- **Status of each version** (new, derived): *In effect by date*, *Scheduled*, *Superseded* or *Unknown*, from `effective_on` and today's UTC date only. The rule mirrors the server's `scopeEffectiveOn` (the in-effect version for a plan and currency is the one with the latest `effective_on` on or before the day). A version dated in the future is never shown as in effect. If two versions of a plan share the latest effective date the page does **not** pick one: it shows both and says "Shares its effective date with another version". Every label is text in a badge, not a colour only.
- **What the label means, stated on the page:** "Status is derived from the effective date and today's date (UTC) only; the server chooses the price version for each new contract when it is created." The API does not expose the server's clock or timezone, so the label is guidance, not a server decision.
- **Add price version:** a plain statement of the effect (existing contracts never change; each contract keeps the version it was created with; a version is used for new contracts that start on or after its effective date; a future date means scheduled). Plan, amount and date have real `<label for>` and 44px controls (one column below `sm`, two from `sm`, four from `lg`); Save is full width. The amount is LTR with a hint ("In Saudi riyals, for example 199.00") and an inline error when malformed.
- **Preview before saving** (new): "Plan · amount monthly · effective date", whether the date makes it scheduled or applies to contracts starting then, and "Sent to the server as N halalas" with the integer minor units. **Nothing is requested while typing or previewing.** No confirmation dialog was added: the spec (§12.5) says a new version is not destructive, and the brief says to keep the existing mechanism.
- **Result of saving:** a status message with the saved plan, amount (from the API response), effective date and whether it is scheduled or in effect by date; the version appears in the history in the existing order.
- **Errors:** a failed load is a `role="alert"` with a 44px Retry and the form stays usable; a failed save is a separate `role="alert"` next to the form, shows the server's message, and keeps the typed values and the history.
- **History:** table from `md` (plan, status, price, currency, effective date, added on) and cards below `md`. "Added on" is the date part of the API's `created_at`. A note says the history is append-only.
- **RTL correctness:** every date and amount inside running text is isolated left-to-right (`<bdi dir="ltr">`). Without it an Arabic page rendered `2026-03-26` as `26-03-2026`. This was found in a screenshot and fixed before this report (see below).
- **States:** skeletons for the summary and the history while loading, and an empty state for the history together with "No price version for this plan yet" on each plan card.

## Financial precision and backward compatibility

- **Money display:** every amount shown comes from the API's `monthly_amount` string through the existing `formatRiyal`. The preview uses the existing `formatMinorRiyal(riyalToMinor(input))`, which formats from the integer minor units by string, so no new arithmetic and no floating-point step is introduced by this slice. Nothing is summed, averaged, rounded or converted. A test asserts that a derived sum never appears.
- **Parsing:** `riyalToMinor` and `isValidRiyal` are unchanged and still decide validity (up to two decimals, Arabic-Indic digits and separators normalised, negatives rejected). The POST body is the same four fields: `{ plan, currency: 'SAR', monthly_amount: <integer minor units>, effective_on }`, asserted exactly, including that the amount is an integer.
- **Endpoints and validation:** same two endpoints, same method and body, same response handling. No server validation rule was changed or duplicated; the page only refuses locally what it refused before (malformed or negative amounts), now with an inline message instead of the generic "unable to add" alert.
- **Not changed:** stored prices, contract data, how a price is chosen for a contract, permissions, platform auth, tenant isolation. No automatic activation or publication action exists or was added. There is no CSV or export on this page.
- **Existing behaviour kept:** the list is re-sorted by plan then effective date after a save, exactly as before; the signed-out redirect is unchanged; the four plan codes stay the only creatable plans.

## Not done, deliberately

- No edit, delete, publish, activate or schedule action: the API has none.
- No "server today" or timezone claim. The status uses the browser's computation of today's UTC date and says so. The server's timezone is not defined in this repository (Laravel config is generated), so a version dated today could be classified one way here and another by the server near midnight; the page says the server decides for each new contract.
- Plan marketing names and a plan-management screen: out of scope (spec §12.5 keeps the four codes).
- H1-4D, H1-4E and H1-5 not started.

## Files changed

- `web/src/app/platform/(console)/prices/page.tsx`
- `web/src/app/platform/(console)/prices/price-status.ts` (new) and `price-status.test.ts` (new, 9 tests)
- `web/src/app/platform/(console)/prices/use-today.ts` and `use-today.test.tsx` (new, 3 tests)
- `web/src/app/platform/(console)/prices/prices.test.tsx` (new, 18 tests)
- `web/src/messages/ar.json`, `web/src/messages/en.json`
- `docs/plans/platform/AWJ-PLATFORM-UX-H1-4C-PRICING-REPORT.md` (new)
- `docs/plans/platform/AWJ-PLATFORM-UX-H1-4B-TENANT-DETAIL-REPORT.md`, `AWJ-PLATFORM-UX-H1.md` (status and closure only)

No existing test file needed changes: the platform shell tests, the tenant tests and everything else pass as they were.

## Tests actually run

| Command | Result |
|---|---|
| `npx vitest run src/components/platform src/app/platform src/design src/lib` | 100 files, 723 tests passed (after the review corrections) |
| `npm test` (full web suite) | 508 files, 5333 tests passed (after the review corrections) |
| `npm run build` | passed; all 7 `/platform*` routes build, URLs unchanged |
| `npx tsc --noEmit` | 48 errors, same count as `main`; none in the prices files |
| ESLint | not run: the repo has no ESLint config |

New tests (30 after the review corrections, jsdom, real page, real `ar.json`/`en.json`, real `formatRiyal`, `platformApi` mocked, system date pinned to 2026-10-12): no private link, one `h1` and three labelled sections; every API amount shown exactly as `formatRiyal` formats the API string and no derived sum; in-effect, scheduled and superseded by date in the summary and the history; a lone future version is never current; equal-date versions are not disambiguated; typing and previewing send nothing and the preview echoes amount and integer minor units; exact POST body with an integer amount; Arabic-Indic digits and separators produce the same integer; malformed and negative amounts produce no request and an inline error; success is a status with the saved values and the date-derived state, failure is an alert and keeps history and input; labels and 44px controls; load failure alert with 44px Retry while the form stays; skeleton and empty states; the signed-out redirect; Arabic render with dates isolated left-to-right; message keys in both locales. The 8 unit tests cover the date rule (today is in effect, tomorrow is not, grouping by plan and currency, ties, null dates, next scheduled, UTC date).

Real browser (Playwright-core and Chromium, Next dev server, demo mode). **Mock versus real session:** every `/api/*` call was intercepted by the probe. `GET` and `POST /platform/prices` returned fixtures built relative to the run date (past, today-tied, future, a 999,999,999.99 amount); other endpoints returned 503. There was no Laravel API and no real platform session, so server validation (for example whether it accepts past dates), real latency and authorization were not exercised. Ad-hoc probes, not committed, not run by CI.

| Probe | Matrix | Result |
|---|---|---|
| Layout | widths 320, 375, 390, 430, 768, 1024, 1440, 1920 × `ar`/RTL, `en`/LTR × light, dark = 32 | 0 failures after two fixes: no page-level horizontal overflow, direction and theme correct, one `h1`, no links in the page, three sections, cards below 768 and the table from 768 with contained scroll, selects, inputs and buttons at least 44px (the browser/date-widget calendar button, 28px, is shared and excluded) |
| Form (390, en) | typing, previewing, saving | typing and previewing made 0 POSTs; the preview read "basic · 1,234.56 ⃁ monthly · effective …", "Scheduled: not treated as in effect before this date." and "Sent to the server as 123456 halalas." from the Arabic-Indic input "١٬٢٣٤٫٥٦"; Save posted exactly `{"plan":"basic","currency":"SAR","monthly_amount":123456,"effective_on":…}`; the status message and the new row appeared; Tab order plan, amount, date, calendar button, Save |
| Failure states | POST 422, GET 403, empty catalogue, slow load | the 422 showed the server message as an alert and kept the history; the 403 showed the alert in Arabic with the form still present; the empty and skeleton states rendered |

Findings from the browser run, fixed before this report: at 1024px with extreme amounts four plan cards in one row overflowed the page (now two columns until `xl`); Arabic running text reordered `2026-03-26` to `26-03-2026` (dates and amounts are now isolated left-to-right); a 14-digit amount wrapped mid-number (amounts no longer wrap).

## Responsive and accessibility results

- **320 to 1920, both directions, both themes:** verified in a real browser with fixtures as above.
- **Keyboard:** the form is reachable in order with native controls; a failure is an `alert`, success a `status`; there is no dialog on this page, so no dialog focus management applies.
- **Labels and targets:** the three form controls have programmatic labels; the amount has `aria-invalid` and `aria-describedby` for its hint or error; the primary action is 44px.
- **Not verified:** landscape, zoom and text scaling, screen readers, and a real authenticated session against the Laravel API. H1-5 owns those.

## Review corrections (two P2 findings from the automated Codex review of `5bb833e`)

Both were verified against the code before changing anything; both were real, small and in scope.

1. **Saved-version confirmation could contradict the history.** The success message labelled a new version "In effect by date" whenever its date was not in the future. A retroactive version (for example dated 2026-01-01 when the plan already has a version from 2026-09-01) is classified as superseded in the history by the same rule, so the two disagreed. The confirmation now reads its state from the same classification of the updated catalogue the history uses: scheduled, in effect by date, or a new text "Superseded: a later version is already in effect". A test saves a retroactive version and asserts the message and the row agree; it fails if the old behaviour is restored.
2. **Date-derived state could go stale in a long-lived tab.** "Today" was computed on render, so a page left open across UTC midnight kept yesterday's classification until an unrelated render. A small hook, `useToday`, now holds today's UTC date as state, advances it at the next UTC midnight (and every day after), and re-reads it when the tab becomes visible again (a sleeping device skips timers). Tests use fake timers to prove the rollover without interaction, the repeat roll, the visibility re-read, and that the timer is cleared on unmount; a pure helper has its own unit test.

Neither change touches the request, the money helpers or any other behaviour.

## Pre-merge reviews

### Implementer

One page file plus a pure helper. The request code (`load`, the POST and its body, the local sort) is the previous code; the additions are presentation, a derived status, a preview built from the existing money helpers, and messages. The three real-browser findings were reproduced, fixed and re-measured.

### Reviewer

- The status rule is a presentation of two API fields. It never changes what a contract uses and the page says so. The one unavoidable ambiguity (server timezone) is disclosed on the page and here.
- Ties are shown as ties, so the page cannot imply a choice the server's unordered tie-break might not make.
- Preview and success text use the same helpers as the rest of the app; the minor-units line shows the exact integer the request carries, which makes a precision mistake visible before saving.
- No confirmation dialog was added by design (non-destructive, append-only); the history note says versions are never edited or deleted.
- The `<bdi dir="ltr">` isolation is applied to every amount and date in running text; table cells already carried `dir="ltr"`.

### AWJ Guardian

- **Money:** no float arithmetic introduced; all amounts are the API's strings through `formatRiyal`, the preview goes through `minorToRiyal`/`formatRiyal` from the integer minor units, and the request body is the integer `riyalToMinor` returns. No rounding or summing in the UI.
- **Financial effect:** adding a version still never alters existing contracts, which keep the version they were created with (the model's documented behaviour, now stated on the page). No automatic effectiveness or publication.
- **Authorization and isolation:** the page uses only `platformApi` with the platform administrator session; both endpoints still require the platform manage ability on the server (its tests reject read-only and tenant tokens). The UI is not a boundary; the signed-out redirect is unchanged.
- **Backward compatibility:** URLs, endpoints, method, body and response handling unchanged; translation keys only added or reworded within `platformPrices`; no CSV exists on this page, so no export order is affected.

## CI

Recorded on the pull request for the exact head SHA (the checks and the final head are listed in the PR and in the hand-off summary). This file is part of that head, so it does not restate results that did not exist when it was committed.

## Merge / post-merge

- Merge status: not merged. Merge SHA: none. Post-merge review: not done. Deploy: not requested.
- Post-merge verification of #1318, #1328, #1355, #1358, #1362 and #1366 on `main` has not been recorded; this slice does not claim it.

## Risks and remaining work

- **Derived status versus server clock.** A version dated today may read differently on the server near midnight if its timezone is not UTC. The page says the server decides; a future API field for the effective version (or the server's date) would remove the ambiguity. This is a backend change and is recorded, not made.
- **Mock-only browser run.** Server-side validation (for example past dates, duplicate dates for one plan, large amounts) and real error messages were not exercised.
- **Same-date versions** are possible in the data model; the page shows them honestly, but which one the server uses for a new contract is not defined by the endpoint listing.
- **Shared date widget** (28px calendar button) is outside this slice.
- Pre-existing and unrelated: 48 `tsc` errors in test files; `IntlError` for a `cart.itemCount` key printed by some tests; the Next dev overlay badge in dev screenshots.

## Git state

- Branch: `claude/awj-h1-contrast-recovery-fx8unn` (restarted from `main` after #1366 merged; older remote history is merged in so no force-push is needed).
- Base SHA: `56e3d83b2eee97ff671ddd47800a3bda345917a6` (`origin/main` at start).
- Head SHA and PR: see the pull request.

## Next dependency-ready task

**H1-4D**: the next page in the H1-4 list (integrations or document operations, spec §12.6 and §12.7), one per PR. Not started.
