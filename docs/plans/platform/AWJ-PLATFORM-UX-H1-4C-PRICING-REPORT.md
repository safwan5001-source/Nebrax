# H1-4C — Platform Pricing & Plans UX — Implementation report

STATUS: MERGED (PR #1368, `62dabab4d59ee8c1a58e50f69854d7fe013613f6`) / NOT DEPLOYED / POST-MERGE VERIFICATION NOT RECORDED
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
- `web/src/app/platform/(console)/prices/prices.test.tsx` (new, 20 tests)
- `web/src/messages/ar.json`, `web/src/messages/en.json`
- `docs/plans/platform/AWJ-PLATFORM-UX-H1-4C-PRICING-REPORT.md` (new)
- `docs/plans/platform/AWJ-PLATFORM-UX-H1-4B-TENANT-DETAIL-REPORT.md`, `AWJ-PLATFORM-UX-H1.md` (status and closure only)

No existing test file needed changes: the platform shell tests, the tenant tests and everything else pass as they were.

## Tests actually run

| Command | Result |
|---|---|
| `npx vitest run src/components/platform src/app/platform src/design src/lib` | 100 files, 737 tests passed (after the review corrections) |
| `npm test` (full web suite) | 508 files, 5347 tests passed (after the review corrections) |
| `npm run build` | passed; all 7 `/platform*` routes build, URLs unchanged |
| `npx tsc --noEmit` | 48 errors, same count as `main`; none in the prices files |
| ESLint | not run: the repo has no ESLint config |

New tests (44 after the review corrections, jsdom, real page, real `ar.json`/`en.json`, real `formatRiyal`, `platformApi` mocked, system date pinned to 2026-10-12): no private link, one `h1` and three labelled sections; every API amount shown exactly as `formatRiyal` formats the API string and no derived sum; in-effect, scheduled and superseded by date in the summary and the history; a lone future version is never current; equal-date versions are not disambiguated; typing and previewing send nothing and the preview echoes amount and integer minor units; exact POST body with an integer amount; Arabic-Indic digits and separators produce the same integer; malformed and negative amounts produce no request and an inline error; success is a status with the saved values and the date-derived state, failure is an alert and keeps history and input; labels and 44px controls; load failure alert with 44px Retry while the form stays; skeleton and empty states; the signed-out redirect; Arabic render with dates isolated left-to-right; message keys in both locales. The 8 unit tests cover the date rule (today is in effect, tomorrow is not, grouping by plan and currency, ties, null dates, next scheduled, UTC date).

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

## Review corrections (twelve P2 findings from the automated Codex reviews of `5bb833e`, `d0a7d1d`, `6db47fb`, `cf3f0ce`, `56dc234`, `64d2fd3` and `1eb713a`)

All were verified against the code before changing anything; all were real, small and in scope.

1. **Saved-version confirmation could contradict the history.** The success message labelled a new version "In effect by date" whenever its date was not in the future. A retroactive version (for example dated 2026-01-01 when the plan already has a version from 2026-09-01) is classified as superseded in the history by the same rule, so the two disagreed. The confirmation now reads its state from the same classification of the updated catalogue the history uses: scheduled, in effect by date, or a new text "Superseded: a later version is already in effect". A test saves a retroactive version and asserts the message and the row agree; it fails if the old behaviour is restored.
2. **Date-derived state could go stale in a long-lived tab.** "Today" was computed on render, so a page left open across UTC midnight kept yesterday's classification until an unrelated render. A small hook, `useToday`, now holds today's UTC date as state, advances it at the next UTC midnight (and every day after), and re-reads it when the tab becomes visible again (a sleeping device skips timers). Tests use fake timers to prove the rollover without interaction, the repeat roll, the visibility re-read, and that the timer is cleared on unmount; a pure helper has its own unit test.

3. **A save after a failed first load left a stale error beside a success message.** If the first catalogue request failed but a later save succeeded, the page announced success while still showing the old load error and Retry, and hid the new version. Now, when the catalogue was never loaded, a successful save re-fetches it: the stale error clears when the reload succeeds and the new version appears with the rest. While the catalogue is still unavailable the confirmation does not claim a state for the new version (it would have been derived from an incomplete list), and the load error stays visible. Two tests cover the reload-succeeds and reload-fails paths; both fail if the reload is removed.

4. **A partial list was shown as the catalogue during the post-failure reload.** The summary and history were gated on "the list is empty", so after a failed first load and a successful save the single returned row was presented as the whole catalogue (a retroactive row could appear as the current price) for as long as the reload took. They are now gated on "a complete catalogue has been loaded" (`catalogueLoaded`): until then the skeleton shows (or the load error), and the returned row is not merged into a catalogue that was never loaded; it appears only in the save confirmation. A test with a reload that hangs asserts the skeleton, no catalogue row and no empty state.
5. **An older catalogue response could overwrite a newer one.** A save made while the first request was still pending started a second request; if the first (captured before the save) resolved last it replaced the list and removed the new version. Catalogue requests are now sequenced with a counter: only the latest request may set the list, the error or the loading flag; older results are discarded. A test resolves the stale response after the reload and asserts the saved version is still in the history table; both new tests fail on the previous code and pass now.
6. **The preview contradicted the resulting status for a retroactive date.** The preview text came from "date > today" alone, so a January version for a plan that already has a June version in effect was previewed as "applies to contracts that start on or after this date", while the saved confirmation and the history call it superseded. The preview now uses the same rule as the classification (`previewOutcome` in `price-status.ts`: future = scheduled; an older date behind a later version already in effect for the same plan and currency = superseded; otherwise in effect). While the catalogue has not loaded, a past date is not previewed as applying: the text says a later version cannot be confirmed until the list loads. Preview only; the request, payload and amounts are untouched. Tests: the helper's cases (other plan, other currency, equal date, future), and the page flow preview → save, asserting preview and confirmation agree; two of the three page tests fail on the previous behaviour.
7. **Statuses after a save came from a possibly stale local list.** When the catalogue had loaded, a successful save merged the POST response into the tab's older list; another administrator's version added in between was unknown, so the new row could be labelled current while the server's `priceFor` would pick the other one. Every successful save now re-fetches the complete catalogue and does not merge the returned row locally; the confirmation shows the saved values at once and its state only once a list that contains the row has loaded (until then, no state is claimed). A test has another administrator's September version appear only in the reload and asserts no state is claimed while it is pending and that June is then shown as superseded, not in effect. If the reload fails, the load error with Retry is shown.
8. **The "superseded" text was too absolute.** `priceFor` selects the version by each contract's own start date and allows past dates, so a superseded January version still prices a contract that starts in March. The preview now says it applies only to contracts that start after its date and before the later version's date. A test asserts the window wording.
9. **The preview did not flag a duplicate date.** `platform_price_versions` has a unique key on `(plan, currency, effective_on)`, so a date that already exists for the plan is rejected by the server. `previewOutcome` returns `duplicate` for that case (also for future dates) and the preview says the server will reject it and to choose another date. The Save button is not disabled and the request is not changed, because the loaded list can be stale and the server decides. Because of the unique key, two versions of one plan never share a date, so the "same date" flag in the history can only appear for rows without that guarantee; it is left as is.
10. **The preview used the pre-save list while the post-save reload was pending or had failed.** After a save, the form is usable again but the catalogue the preview reads is the one from before it, so a second retroactive date could be described as in effect, or a repeated date could miss the duplicate warning. The preview now treats the catalogue as fresh only when it has loaded, no fetch is running and there is no load error; otherwise a past date shows the "cannot be confirmed" text (now worded for loading *or* unavailable) and a future date still shows scheduled, which holds regardless. Tests: reload pending (unverified, then superseded once it lands) and reload failed (past unverified, future scheduled); both fail if the gate is reduced to "loaded".
11. **The superseded window excluded the first day.** `scopeEffectiveOn` is inclusive (`effective_on <= contract date`), so a contract starting exactly on the version's date uses it; my replacement wording said "after this date". The text (English and Arabic) now says "on or after this date and before that later version's date", consistent with the form's note. The test asserts the inclusive phrase and fails with the old one.
12. **The summary and history showed the pre-save list during the post-save reload.** The catalogue stayed "loaded" while the refresh ran, so after a save that is effective today the summary still presented the previous version as current next to the success message, indefinitely if the request hung. The summary and history now render from a fresh catalogue only (loaded, no fetch running, no load error) — the same condition the preview uses — and show their skeletons while a refresh runs; if the refresh fails the load error with Retry is shown. A test saves a version effective today with the reload pending, asserts the skeleton and that the previous price appears nowhere, then asserts the new price is the current one once the list lands; it fails with the previous gating. The brief skeleton after each save is the deliberate cost.

None of the changes touches the request, the money helpers or any other behaviour.

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

Final Head `33d1f30ed832eb920f33a02de22f998e666d370e` of PR #1368: all 7 GitHub check runs `success` (CI Gate, web build ×2, php artisan test sqlite ×2, pgsql ×2; the three workflow runs `38237353283`, `38237353272` and `38237353303`), read through the GitHub API. The Codex review of that head completed with no findings. An earlier CI Gate failure on `cf3f0ce` was the stale-gate guard on a superseded run ("PR head is now 56dc234…"), not a code failure.

## Merge / post-merge

- PRE_MERGE_REVIEW: PASS, recorded as a comment on PR #1368 by the repository owner account for the exact Head above; all 12 Codex review threads resolved.
- Merge status: merged on 2026-10-12 (11:51:45 UTC) by the repository owner account, not by the Claude session. Merge SHA `62dabab4d59ee8c1a58e50f69854d7fe013613f6`, confirmed equal to `origin/main` and an ancestor of it (subject "feat(platform): H1-4C pricing & plans UX (#1368)"). The owner authorized the merge only, not deployment.
- Post-merge review: not done. No target-branch check or smoke evidence on `62dabab` was collected, so none is claimed.
- Deploy / production release: not done.

## Risks and remaining work

- **Derived status versus server clock.** A version dated today may read differently on the server near midnight if its timezone is not UTC. The page says the server decides; a future API field for the effective version (or the server's date) would remove the ambiguity. This is a backend change and is recorded, not made.
- **Mock-only browser run.** Server-side validation (for example past dates, duplicate dates for one plan, large amounts) and real error messages were not exercised.
- **Same-date versions** are possible in the data model; the page shows them honestly, but which one the server uses for a new contract is not defined by the endpoint listing.
- **Shared date widget** (28px calendar button) is outside this slice.
- Pre-existing and unrelated: 48 `tsc` errors in test files; `IntlError` for a `cart.itemCount` key printed by some tests; the Next dev overlay badge in dev screenshots.

## Git state

- Branch: `claude/awj-h1-contrast-recovery-fx8unn` (restarted from `main` after #1366 merged; older remote history is merged in so no force-push is needed).
- Base SHA: `56e3d83b2eee97ff671ddd47800a3bda345917a6` (`origin/main` at start).
- Head SHA: `33d1f30ed832eb920f33a02de22f998e666d370e`. PR: #1368 (merged).

## Next dependency-ready task

**H1-4D** (integrations, spec §12.6) — see `AWJ-PLATFORM-UX-H1-4D-INTEGRATIONS-REPORT.md`. Then H1-4E (document operations, spec §12.7).
