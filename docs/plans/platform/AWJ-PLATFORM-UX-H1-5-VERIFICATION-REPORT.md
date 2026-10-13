# H1-5 — Platform UX Final Verification & Closure — Verification report

STATUS: IN REVIEW / DO NOT MERGE / DO NOT DEPLOY
Horizon: AWJ-PLATFORM-UX-H1 · Slice: H1-5 (verification, not feature work) · Date: 2026-10-13
Spec: [AWJ-PLATFORM-UX-H1-1-UX-SPEC.md](./AWJ-PLATFORM-UX-H1-1-UX-SPEC.md)

## Verdict

**NOT READY to close the Horizon.** Two P1 defects were found by running the real Laravel backend, which no earlier slice did. Both were fixed in a separate, small, tested PR (#1376). **Update 2026-10-13 10:25 UTC:** the repository owner reviewed and merged #1376 as `4683c42aa95fd3f3fb5332dc2de0c8b8b324a40d` (PRE_MERGE_REVIEW PASS on head `c23944ea…`; the owner approved that merge only). The fixes were verified in a real browser on the PR branch before the merge; they have **not** been re-verified on `main` after the merge. ([fix details](#fixes-proposed-not-merged)). The Horizon may be closed only after all three conditions hold: (1) the P1 fix PR is merged with Safwan's approval (**met**: #1376, `4683c42a`); (2) the P2 items below are accepted or scheduled by Safwan; (3) the checks this report could not run (a real screen reader, the browser's own zoom and text-size settings, Firefox and WebKit, and the Laravel suites green in CI on the merged head) are either performed or explicitly waived in writing by Safwan. A NOT VERIFIED item is not a pass and does not close by default. Nothing here changes the Backend, database, financial rules or permissions, and nothing was merged or deployed.

| P1 | Where | What a real backend showed | Mock tests said |
|---|---|---|---|
| H15-01 | `/platform/document-operations` | Every retention **dry run** is rejected: `POST /platform/document-retention-runs {"dry_run":true}` returns 422 "The apply field must be accepted." Only the destructive apply path works. | Passed: the test pinned the same (wrong) body. |
| H15-02 | `/platform/integrations` | About 47 form controls (42 inputs, 5 selects) have a visible label that is not linked to the control, so assistive technology announces unnamed fields (axe `label` and `select-name`, impact critical; 4 of 4 theme/language runs). | Passed: the H1-4D report states "every form control has a visible label", which is true visually only. |

## How this was verified (and what was not)

**Real environment, no mocks.** Laravel 11.57 built by `setup.sh` from this repository at the Base SHA, SQLite, `php artisan serve` on 127.0.0.1:8000. Next.js 15.5 dev server on 127.0.0.1:3001 with `NEXT_PUBLIC_API_URL` pointing at it. Playwright-core with Chromium. Isolated, non-production data: two seeded platform administrators (one active, one inactive), 28 test tenants, test price versions and contracts created through the UI. No route interception: browser traffic was only observed. No production data, no real tenant, no external provider credential. Chromium only; the server ran with `APP_DEBUG=true` for the UI runs, so one finding was re-checked against a second server with `APP_DEBUG=false APP_ENV=production` (H15-05).

Earlier slices ran in jsdom and a mocked browser. **This report does not count any mocked run as backend evidence.** Items I could not run for real are marked BLOCKED or NOT VERIFIED and are not passes.

Environment notes: the container lacked `bcmath`, the AWS SDK and AVIF support for the Laravel suites (see Tests); the session-start hook re-runs `setup.sh` (`migrate:fresh`), which wiped the seeded test database once during this work; I re-seeded it. All results below are from the re-seeded database.

## Coverage matrix (pages)

| Page | Real session | Real API actions | Responsive (8 widths × RTL/LTR × light/dark) | Landscape | Zoom 100/200/400% | Text 150/200% | Keyboard / dialogs | axe |
|---|---|---|---|---|---|---|---|---|
| Login | PASS | PASS | PASS | PASS | PASS | PASS | PASS (Enter, labels) | not run (see note) |
| Shell / navigation | PASS | n/a | PASS (drawer at 390) | PASS | PASS | **FAIL** (H15-09) | PASS | PASS |
| Dashboard | PASS | read-only | PASS | PASS | PASS | **FAIL** (H15-09) | PASS | **FAIL** (H15-07) |
| Tenants list | PASS | PASS (CSV, paging, search) | **FAIL ≤350px** (H15-06) | PASS | **FAIL at 400%** (H15-06) | FAIL | PASS | P3 heading order |
| Tenant detail | PASS | PASS (plan, trial, contract, dialogs) | PASS | PASS | PASS | **FAIL** (H15-09) | PASS (dialog) | **FAIL** (H15-08) |
| Prices | PASS | PASS (money, dates) | PASS | PASS | PASS | FAIL (H15-09) | PASS | PASS |
| Integrations | PASS | PASS (save, wrong password, test, exceptions) | PASS | PASS | PASS | FAIL (H15-09) | PASS (revoke dialog) | **FAIL** (H15-02) |
| Document operations | PASS | **FAIL** dry run (H15-01); apply PASS; export PASS | PASS | PASS | PASS | FAIL at 390px (H15-09) | PASS | PASS |

Counts: 224 page loads in the width matrix, 70 landscape, 28 zoom, 56 text scaling, 24 axe runs (6 console routes × 4 theme/language combinations; the login page was not axe-scanned: the first axe run that appeared to cover the dashboard had silently loaded the login page, which is how the dashboard defect was missed until the run was repeated with a complete session). The width matrix had 4 hard failures, all `/platform/tenants` at 320px (page-level horizontal scroll 351px > 320px). Elements reported to the right of the viewport below 1024px were the off-canvas navigation drawer, not page content.

## Real session and backend results

| Check | Result | Evidence |
|---|---|---|
| Login with valid credentials, UI | PASS | `POST /platform/login` 200, token stored, dashboard opens, token not present in page DOM |
| Wrong password | PASS | 422, message shown in the login alert, no token, stays on `/platform/login` |
| Inactive administrator | PASS | 403, message shown, no token |
| Invalid email / empty password | PASS | blocked client-side, no request sent |
| Direct access to all 6 console routes without a session (`/platform`, `/platform/tenants`, `/platform/tenants/[id]`, `/platform/prices`, `/platform/integrations`, `/platform/document-operations`) | PASS | every one redirects to `/platform/login` with 0 API calls and no platform data in the page (the detail route was added after a review comment noted the first run covered five) |
| Logout | PASS | `POST /platform/logout` 200, token cleared, protected route redirects, the old token returns 401 |
| Session expiry / revoked token while on a page | PASS for page loads | redirects to login, token cleared |
| Session expiry on the audit **export** | **FAIL** | H15-04 |
| 401/403 matrix (no token, expired, tenant token, inactive admin, read-only token, full token) over 7 endpoint kinds | PASS | no token / expired 401; tenant and inactive 403; read-only token 200 on reads and 403 on every manage route; denied writes changed no rows |
| Platform token on tenant routes | PASS | `/partners`, `/invoices`, `/products`, `/me` → 403; a tenant token still works on its own routes |
| Validation | PASS with caveats | server 422 shown inline; duplicate price date is a 500 (H15-05) |
| Secrets (storage keys) | PASS | saved with admin password; responses carry only masked values and `has_*` flags; the raw secret and key id were absent from the DOM, `localStorage`/`sessionStorage`, the integrations response, the Laravel log and the audit CSV export (0 matches each), and the stored configuration is encrypted at rest; fields are empty after save and reload |
| Admin-password gate on sensitive saves | PASS | missing password 422, wrong password 422 and not logged out, correct password 200 |
| No request when opening confirm dialogs | PASS | deactivate dialog, revoke-exception dialog: 0 writes on open and on Escape |
| Duplicate-submission prevention | PASS | double-click on Save price version → one POST; buttons disabled while busy (also unit-tested) |
| Dashboard figures vs API | PASS | UI 10.00 / 120.00 / 28 tenants / 1 active contract equals `GET /platform/overview`; future-start contracts are not counted by the API (naive DB sum would be 209.80) |
| Tenants CSV column order (H1-4A P1 regression) | PASS | header on the real page: `Organization, Account number, Support number, Owner name, Owner email, Phone number, Plan, Status, Trial ends, Users`; 25 rows for the 25 shown |
| Pagination, per-page, search | PASS | page 2 shows 3 of 28; rapid Previous/Next/Previous ends on the right page; the SQL-like search string returns 0 rows with HTTP 200 |
| Stale-response guard under real latency | NOT VERIFIED | the local backend answers in milliseconds, so a late response could not be produced; covered only by the earlier unit tests |
| Money precision | PASS | 199.00→19900, 199.5→19950, 0.30→30, 0→0, `١٩٩٫٥٠`→19950, 99,999,999,999.99→9999999999999 minor units; `199.005`, `-5`, `1e3`, 16-digit amounts blocked in the UI |
| Price effective dates | PASS | contract creation uses only an in-effect version: a contract from 2026-10-31 is rejected (no version yet), 2026-11-02 uses the 2026-11-01 version; leap day 2028-02-29 and a past date accepted and labelled |
| Integration save then re-test | PASS | save with the integration disabled, then enabled, then Test; a disabled save tested against local disk reports success (H15-10); an enabled save with an unreachable endpoint reports failure |
| Retention apply | PASS | confirm gate keeps the button disabled; `{"dry_run":false,"apply":true}` → 202 |
| Retention dry run | **FAIL** | H15-01 |
| Real providers (R2, ClamAV, AI) | NOT VERIFIED | no external service or credential exists in the isolated environment, and none was used |
| Document operations with real batches/runs/files | NOT VERIFIED | the test database has no documents; counts are 0, so non-empty states ran only in the earlier mocked slices |
| Tenant-to-tenant isolation inside platform pages | PASS (by design) | platform endpoints are cross-tenant aggregates; a tenant token gets 403 everywhere, a platform token gets 403 on tenant data routes |

## Defects

Classification: P0 blocks release, P1 blocks the closure gate, P2 should be fixed or knowingly accepted before closure, P3 is minor. "Origin" separates defects that H1 introduced from ones already on `main` before H1; none of this is mixed.

| ID | Sev | Origin | Defect | Evidence | Status |
|---|---|---|---|---|---|
| H15-01 | **P1** | Pre-existing (request body from `5cdfe803`, kept by H1-4E) | Retention dry run always 422 | `{"dry_run":true}` and `{"dry_run":true,"apply":false}` → 422; `{"dry_run":true,"apply":true}` → 202. Reproduced through the real UI twice (policy off and on). No HTTP test covers this endpoint, only runner-level tests. | Fixed in #1376 (merged `4683c42a`, web side; not re-verified on `main`); backend rule fix still recommended |
| H15-02 | **P1** | Pre-existing helper, carried by H1-4D | Integrations form controls without an accessible name | axe `label` critical ×42 and `select-name` critical ×5 on every run; real DOM: `<label>` with no `for`, input with no id | Fixed in #1376 (merged `4683c42a`; not re-verified on `main`) |
| H15-03 | P2 | H1-4D | Scan-exception tenant picker lists only the first 20 tenants | picker calls `GET /platform/tenants` with the default page size; 20 options for 28 tenants; no pagination or search. Mocks returned two tenants. Already recorded as a recommendation in H1-4D/4E | Open |
| H15-04 | P2 | Pre-existing | Audit export with an expired session: no redirect to login, generic error | `platformDownloadFile` sends no `Accept`, does not handle 401, and falls back to a hard-coded Arabic message; the backend answers an unauthenticated request without `Accept` with a 500 HTML page (also true of `/platform/overview` and `/platform/prices`) | Open |
| H15-05 | P2 | H1-4C (UI) and pre-existing (backend) | A known duplicate price version can be submitted and fails with a 500 | the preview says "already exists" but Save stays enabled; server returns 500 (unique key `plan,currency,effective_on`). With `APP_DEBUG=true` the UI shows the SQL text; with `APP_DEBUG=false` it shows "Server Error". No secret leak in production mode | Open |
| H15-06 | P2 | Pre-existing data/catalog | Two of 45 application keys have no translation (`document_center.core`, `commerce.app_builder`, in both languages); the raw `applications.keys.*` text is shown in the global controls, the per-tenant override card and their dialogs, and its unbreakable width causes horizontal page scroll at ≤350px (zoom 400%) | `/platform/tenants` at 320px: scrollWidth 351 > 320 | Open |
| H15-07 | P2 | H1-3 | Dashboard description lists are invalid: `dl` has `div > div/span` children | axe `definition-list` and `dlitem` serious (4 of 4 runs); earlier mocked checks missed it | Open |
| H15-08 | P2 | H1-4B / pre-existing | Tenant detail: one select without a name (`h-9 w-full sm:w-44`) and a horizontally scrollable table region with no focusable content | axe `select-name` critical ×1 and `scrollable-region-focusable` serious ×1 (4 of 4 runs) | Open |
| H15-09 | P2 | Shell (H1-2) and cards | Text scaled to 200% causes page-level horizontal scroll: the shell's **Sign out** button at 390px, `whitespace-nowrap` badges ("Coming soon", "Next scheduled") elsewhere | text-scaling matrix: 18 of 28 combinations at 200%; 2 at 150% (tenants) | Open |
| H15-10 | P2 | Pre-existing backend behaviour | "Test connection" for private storage reports success against the **local** disk when the saved integration is disabled, with the message "connected to private storage"; nothing contacts the saved endpoint | save disabled → Test → ok:true; save enabled → Test → ok:false | Open (needs backend or copy decision) |
| H15-11 | P3 | Pre-existing | Heading order skips a level on tenants, tenant detail and integrations | axe `heading-order` moderate | Open |
| H15-12 | P3 | Pre-existing | Server messages and some labels are Arabic-only on the English UI (test results, validation text, the date-picker button name, product names) | seen in the alerts and a button name | Open |
| H15-13 | P3 | H1-4C | A comma amount `1,5` is read as `15.00` (grouping), not `1.50`; the preview shows 15.00 before saving | request body `monthly_amount:1500` | Open |
| H15-14 | P3 | H1-4E | After an apply run the confirmation checkbox stays ticked, so a second apply needs no new confirmation | observed after a 202 apply | Open |
| H15-15 | P3 | Spec decision | **Save plan** and **End trial now** act immediately with no confirmation | `PATCH` sent on first click; the spec keeps these unconfirmed | Owner decision |
| H15-16 | P3 | Known | Interactive controls below 44px remain in the tenants application cards (32px) and the date-picker icon (28px) | listed as unchanged in H1-4B | Open |
| H15-17 | P3 | Pre-existing | Dashboard guard needs the stored administrator profile, other console pages need only the token; `IntlError INVALID_KEY` (`appBuilder.builder.visibility.signalOption`) logs on every page; the Dependencies cell repeats `fuel_stations.core` ×3 | console and DOM | Open |

## Fixes (PR #1376, merged by the owner as `4683c42a`)

Branch `claude/awj-h1-5-p1-fixes` (from Base SHA, web only, no Backend, database or permission change). It was reviewed and merged separately from this report's PR.

- **H15-02:** `Field` generates an id (`useId`), links its label with `htmlFor` and assigns the id to the first element child; the custom `Select` forwards `id`. Regression test: every input and select on the page has a label or `aria-label`, ids are unique, `getAllByLabelText` resolves to the right control. Mutation check: reverting the fix makes it fail with 53 unnamed controls. Real browser, fixed code: 0 unnamed of 74 controls.
- **H15-01:** the dry-run request also sends `apply: true`; the server reads `dry_run`, which stays true, so no purge can result. The existing request-body test is corrected to the contract the API actually enforces. Real browser, fixed code: `POST {"dry_run":true,"apply":true}` → 202 twice, no alert. **Recommended root-cause fix, needs Safwan's approval because it touches the Backend:** change the validation to require `apply` only when `dry_run` is false (`exclude_if:dry_run,true` plus the existing `required_if`/`accepted`) and add an HTTP test for this endpoint. The web fix keeps working after that change.

Suggested small follow-ups (not built, not P1): H15-03 (page the tenant picker or add a search), H15-04 (send `Accept` and treat 401 like `platformApi`; backend should return JSON 401 without the header), H15-05 (disable Save on a known duplicate; return 422 instead of 500), H15-06 (add the two message keys and let long keys wrap), H15-07 to H15-09 (markup and `whitespace-normal`).

## Accessibility

- Automated: axe-core 4.10.2 on 6 routes × light/dark × en/ar (24 runs), WCAG 2 A/AA, 2.1 A/AA, 2.2 AA and best-practice. **Color-contrast: 0 violations in all 24 runs** (axe cannot evaluate every state, so this is not a full contrast audit). Findings are H15-02, 07, 08 and 11. axe is not a substitute for the manual checks below.
- Keyboard (real): skip link first, then navigation, language, theme, sign out, Refresh; focus rings visible on every platform control (the only "no ring" stops are the Next.js dev overlay). Deactivate dialog and revoke dialog: labelled, `aria-modal`, first focus on the safe button, ten Tab presses never left the dialog, Escape closes, focus returns to the opener, zero requests. Mobile drawer: expands, ten Tab presses stay in the drawer and menu button, Escape closes and returns focus.
- Touch targets at 390px: dashboard, integrations, documents 0 controls under 44px; prices 1 (the date-picker icon, 28px); tenants 58 under 44px (the application cards, 32px, known H15-16).
- Real screen reader: **NOT VERIFIED** (none available in this environment).
- Browsers: Chromium only. Firefox and WebKit are **NOT VERIFIED** (not installed here).
- Zoom was emulated with the viewport and device scale factor (200% = 640px, 400% = 320px); text scaling by setting the root font size to 150% and 200%. Neither is the browser's own zoom UI, so a manual pass in a desktop browser is still advisable.

## Backward compatibility

- No Backend, database, permission or financial-rule file changed in this branch (documentation only).
- Existing API contracts: every request the UI sent in the real run was accepted with its existing shape, except H15-01 (a pre-existing mismatch). The tenants CSV order matches the pre-4A order.
- The fix branch changes two request/markup details only (the dry-run body gains `apply`, form fields gain ids) and is additive.

## Tests, build, CI

| Check | Result |
|---|---|
| Laravel `php artisan test`, SQLite (isolated file DB, `migrate:fresh` first) | **NOT GREEN in this environment, not claimed as a pass.** Full run (after installing `php8.3-bcmath`, which the container lacked; the first run had 154 failures): 6370 passed, 129 failed, 73 skipped (46,800 assertions), 1,178 s. The failures are in 27 classes, all in the media, R2/object-storage, mail and upload families (`StorefrontMedia*`, `ProductMediaR2*`, `AttachmentDurabilityS1`, `AuthRecovery`, `UserInvitation`, `DocumentStorageDiagnose`, …). Causes found: `Aws\Exception\AwsException` is not installed (no AWS SDK in this container) and GD has no AVIF support (`imageavif` missing). The `AuthRecovery`/`UserInvitation` mail failures (11) were not root-caused. No PHP file changed in this branch, so none of these can come from it, but the suite cannot be called green until CI runs it. None of the platform-named or document-operations test classes appear among the failures. |
| Laravel `php artisan test`, PostgreSQL 16 (local, `migrate:fresh` first) | **Same result family, not claimed as a pass.** PostgreSQL 16 (local), one isolated database per test file cloned from a migrated template, 3 workers, 592 files: 6444 passed, 123 failed, 2 skipped; 25 files fail, all in the same media/R2/mail/storage families as SQLite; one file (`ProductMediaR2ReadTest`) hit the 240 s per-file timeout and has no result. The PostgreSQL-only concurrency tests that SQLite skips ran and passed. Setup notes: the container's PostgreSQL needed `max_locks_per_transaction` raised from 64 to 2048, otherwise `migrate:fresh` dropping 300+ tables fails with "out of shared memory" and most files fail; a first single-database full run also hung 28 minutes on a lock wait and was abandoned, and a first per-file attempt was contaminated by processes sharing databases, so those results were discarded. |
| Web full suite (`npm test`), main working tree at the Base SHA plus this report | 522 files, 5546 tests passed (exit 0). On the P1 fix branch: 522 files, 5547 tests passed (one new test). |
| `tsc --noEmit` against the baseline | 48 errors, equal to the baseline on `main`; 47 are in `*.test.ts(x)` files and 1 is in `e2e/pos-ui-v3-visual-verify.spec.ts` (all test/spec files, none in product code). |
| Next.js production build | `next build` completed (exit 0) on the Base SHA working tree with this report added. |
| GitHub CI on this PR | See the checks on this PR (not repeated here: they did not exist when this file was committed). Fix PR: #1376. |

GitHub CI on the fix PR #1376 (head `c23944ea153d977045feecd0518843027ee6636b`; PHP code identical to the Base SHA) finished with all 7 check runs `success`, including the full Laravel suite on SQLite and on PostgreSQL (workflow run 38365588245). That is independent evidence that the local Laravel failures above came from this container (no AWS SDK, no AVIF in GD, and so on) and not from the code. It is a result for that branch's head, not a post-merge result on `main`, and it is stated only for the suite as CI ran it. CI for this report PR is on the PR itself.

## NOT VERIFIED / BLOCKED (not passes)

- Laravel suites green on SQLite and PostgreSQL (see the table: failures are environment-related but unproven, until CI runs them); the login page's axe scan;
- Real screen reader; Firefox; WebKit; the browser's native zoom and text-size settings.
- Stale-response guard under real network latency.
- R2, ClamAV and AI providers; document operations with real document data; behaviour at hundreds of tenants.
- A production build served with a real production backend (the UI ran on the dev server, which also issues each read twice because of React strict mode; this is a dev-only effect and was not measured on a production build).
- Deploy or production environment of any kind.

## Pre-merge reviews

### Implementer
This PR changes documentation only (the H1-5 report, the H1-4E report's merge state, the horizon status line). The fixes are in PR #1376 and were limited to the two P1 defects: a label/id link in `Field` and `Select`, and one request-body field on the retention dry run. Each has a regression test; the integrations test was mutation-checked (fails with 53 unnamed controls without the fix). Both fixes were also re-run in a real browser against the real backend.

### Reviewer
- Evidence separates real-backend results from mocked ones; nothing mocked is counted as backend evidence. Every PASS in the tables names its observation; unobserved items are NOT VERIFIED.
- A first axe pass that looked clean for the dashboard had silently loaded the login page (the dashboard guard needs the stored administrator profile). This was found, repeated with a complete session, and recorded in the report; the login page itself was not axe-scanned.
- The Laravel results are reported as not green because the suites failed in this container for environment reasons; the report says so and does not infer a pass.
- Open question for the reviewer: whether H15-03 (tenant picker limited to 20) should be raised to P1 for a platform with many tenants. It fails closed and the rest of the page works, so it is recorded as P2.

### AWJ Guardian
- **Backend / database / permissions / financial rules:** untouched. The proposed backend validation change for H15-01 is a recommendation only and needs Safwan's approval.
- **Data:** only isolated test data; no production data, no real tenant, no external credential. Test secrets were fake and are absent from the DOM, storage, responses, logs, the audit CSV and the stored configuration (encrypted at rest).
- **Dangerous actions:** none run on real tenants; plan, trial, contract and retention actions ran on test tenants only.
- **Merge and deploy:** neither requested nor performed.

## Recommendation on closing the Horizon

Do not close it yet. Closure needs all three conditions in the verdict: the P1 fix PR merged by Safwan's decision (done: #1376); the P2 list accepted in writing or scheduled; and the NOT VERIFIED accessibility and browser checks (real screen reader, native browser zoom and text size, Firefox, WebKit) either done or waived by Safwan. Earlier slice reports assigned the screen-reader, zoom and text-scaling checks to H1-5; this report ran zoom and text scaling by emulation only and could not run a screen reader, so those gates stay open until done or waived. With the conditions met, the Horizon can close with this report as its verification record. The most valuable follow-up beyond the P2 list is one HTTP-level test per platform write endpoint, because the two P1 defects were invisible to every mocked test.

## Git state

- Branch: `claude/awj-h1-5-platform-ux-verification` (new, from `origin/main`).
- Base SHA: `9becbb62b5e76484ba287e5ef424185893a092a8` (H1-4E merge, PR #1375).
- Head SHA and PR: see the pull request.
- Fix PR (separate): #1376, branch `claude/awj-h1-5-p1-fixes`, head `c23944ea153d977045feecd0518843027ee6636b`, merged into `main` by the owner as `4683c42aa95fd3f3fb5332dc2de0c8b8b324a40d`.

## Next dependency-ready task

Safwan's review of this report; a post-merge re-check of H15-01 and H15-02 on `main` if wanted; then decisions on the P2 list and on the unverified checks. No further slice was started.
