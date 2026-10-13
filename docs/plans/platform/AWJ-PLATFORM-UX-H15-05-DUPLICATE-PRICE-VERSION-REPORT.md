# H15-05 — Duplicate price version UX fix — Implementation report

STATUS: IN REVIEW / DO NOT MERGE / DO NOT DEPLOY
Horizon: AWJ-PLATFORM-UX-H1 · Follow-up to the H1-5 report ([AWJ-PLATFORM-UX-H1-5-VERIFICATION-REPORT.md](./AWJ-PLATFORM-UX-H1-5-VERIFICATION-REPORT.md), PR #1377, merge `48620cbb4488d4df0d5a01994faef436add8a547`) · Date: 2026-10-13
Scope: **Frontend only.** No Backend, database, migration, pricing or subscription change. The other P2 findings are not addressed here.

## Defect (H15-05, from the H1-5 report)

On `/platform/prices`, entering a version with the same `(plan, currency, effective_on)` as an existing one showed a warning that the version already exists, but Save stayed enabled. The request then failed with a Backend 500 (the unique key `plan, currency, effective_on`), shown as the SQL text when `APP_DEBUG=true` and as "Server Error" otherwise.

## What changed

When the price catalogue is **loaded and fresh** (first fetch finished, no fetch in flight, no load error — the page's existing `catalogueFresh`), a candidate whose plan, currency and effective date match an existing version is a **known duplicate**:

- Save is disabled, so no request that the unique key would reject is sent.
- A message is shown under the form, in Arabic and English: "A version for this plan and effective date already exists, so it can't be added again. Choose a different effective date." The date field gets `aria-invalid` and `aria-describedby` pointing at the message; Save carries the same `aria-describedby`.
- The preview no longer repeats a second sentence about the same thing.
- The block clears as soon as the plan or date changes. After a successful save the page already reloads the catalogue, so the just-saved plan and date becomes a known duplicate on that reload.

When the catalogue is **not** complete and fresh (loading, failed to load, or reload failed after a save), **no verdict is drawn**: a neutral note says it cannot be confirmed whether a version already exists and that the server still rejects duplicates. Nothing claims a duplicate or the absence of one, Save is not blocked, and the server decides.

Amounts (integer minor units), effective-date logic, status derivation, the `POST /platform/prices` payload and the API are unchanged.

**The database unique key remains the authority.** The UI check only avoids sending a request that is known in advance to fail; it does not replace the constraint.

## Files

| File | Change |
|---|---|
| `web/src/app/platform/(console)/prices/price-status.ts` | new `isDuplicateVersion`, used by `previewOutcome` (same rule, now shared) |
| `web/src/app/platform/(console)/prices/page.tsx` | `knownDuplicate`, disabled Save, the two messages, ARIA wiring, preview line hidden when duplicate |
| `web/src/messages/en.json`, `web/src/messages/ar.json` | `platformPrices.duplicateBlocked`, `platformPrices.duplicateUnverified` (keys added only) |
| `.../prices/prices.test.tsx`, `.../prices/price-status.test.ts` | regression tests |
| this report | |

## Tests actually run

| Check | Result |
|---|---|
| `prices` folder (page, status, today hook) | 3 files, 51 tests passed |
| New and changed regression tests | known duplicate (message, disabled Save, ARIA, no request, future date too); different date and different plan allowed with the unchanged payload; block clears on a date change; **catalogue unavailable** (no duplicate claimed, "cannot confirm" note, Save enabled, request still sent); first load pending then complete; stale list after a failed reload; same plan and date blocked after a successful save and reload; `isDuplicateVersion` unit test; both locales have both keys |
| Mutation checks | removing the block made 4 tests fail; drawing a verdict without a fresh catalogue made 1 fail (the stale-list test was added because the first version of the suite did not catch it) |
| Full web suite (`npm test`) | 522 files, 5554 tests passed |
| `tsc --noEmit` | 48 errors, equal to the baseline; none outside test/spec files, none in the prices files |
| `next build` | exit 0 |
| Real browser, real Laravel backend, isolated test data, no route interception | see below |
| GitHub CI | recorded on the PR for the final head (this file is part of that head, so it does not restate a result that did not exist when it was committed) |

### Real backend (Chromium, Laravel on SQLite, Next dev server, English and Arabic)

| Scenario | Observed |
|---|---|
| Known duplicate (basic, an existing date) | message shown in both languages, Save disabled, `aria-invalid="true"`, `aria-describedby="price-duplicate"`, **0 POSTs** after trying to save |
| Different date | not blocked; `POST /platform/prices` 201 with `{"plan":"basic","currency":"SAR","monthly_amount":25000,"effective_on":…}` (unchanged shape and minor units) |
| Same plan and date again right after the save | blocked by the refreshed catalogue, 0 POSTs |
| Same date on another plan | not blocked |
| Catalogue genuinely unavailable (a read-only token gets 403 on the price list) | no duplicate claimed, "cannot confirm" note shown, Save enabled; clicking sends the request and the server answers (403 here), so nothing is suppressed on an unconfirmed list |
| Two tabs, both fresh; tab A saves a key, tab B (stale list) submits the same key | **not** blocked by the UI; the Backend returns **500** (SQL text under `APP_DEBUG=true`) — see risks |

## Risks and what remains

- **Concurrent requests still end in a Backend 500 (separate issue, not fixed here).** The UI can only know what its catalogue holds. If another administrator (or another tab) adds the same key after this tab loaded, the UI allows the save and the Backend answers with a 500. That is a Backend defect: a duplicate key should return a proper 422 or 409 with a clear message. Fixing it needs a Backend change and **Safwan's approval**; it is recorded here as an independent follow-up and is not part of this PR.
- The catalogue is refreshed on load and after each save only. A version added by someone else between loads is invisible until the next load; this is the race above.
- The duplicate message appears together with the success notice right after a save of the same plan and date (the reload brings the saved version in). This is accurate and Save is already disabled because the amount is cleared.
- While the catalogue is loading, the "cannot confirm" note shows briefly.
- Pre-existing and unchanged: the comma reading of `1,5` (H15-13), the Arabic-only server messages (H15-12), and the other P2/P3 items in the H1-5 report.

## Backward compatibility

No API, schema, permission or pricing-rule change; payload and minor-unit conversion byte-identical; two translation keys added, none changed; `previewDuplicate` is kept (still used for the key map, no longer shown on a known duplicate).

## Git state

- Branch: `claude/awj-h15-05-duplicate-price-version` (new, from `origin/main`).
- Base SHA: `48620cbb4488d4df0d5a01994faef436add8a547` (the H1-5 report merge).
- Code Head SHA: `74843c929b73ad962631ff24201ba98f6392ecbd`; the PR head also includes this report.
- PR: see the pull request.

## Next dependency-ready task

Safwan's review of this PR. Not started: the Backend 422/409 fix for concurrent duplicates (needs approval), and the remaining H1-5 P2 items. No merge, no deploy, Horizon not closed.
