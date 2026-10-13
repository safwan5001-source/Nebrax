# H1-4E — Platform Document Operations UX — Implementation report

STATUS: MERGED (PR #1375, `9becbb62b5e76484ba287e5ef424185893a092a8`) / NOT DEPLOYED / POST-MERGE VERIFICATION NOT RECORDED HERE (see the H1-5 report)
Horizon: AWJ-PLATFORM-UX-H1 · Slice: H1-4E (document operations) · Date: 2026-10-13
Spec: [AWJ-PLATFORM-UX-H1-1-UX-SPEC.md](./AWJ-PLATFORM-UX-H1-1-UX-SPEC.md) §8, §9 and §12.7

## Scope found (what exists, checked in the repository first)

The platform has one document-operations screen: `/platform/document-operations` (`web/src/app/platform/(console)/document-operations/page.tsx`). It is **not** a document queue or a list of operations. Backed by:

- `GET /platform/document-operations` (`PlatformDocumentOperationsController::overview`): platform runtime, **document batches counted by status**, **processing runs counted by status**, the retention policy with its last run, and the **ten latest retention runs**.
- `GET /platform/document-usage` (period totals and, in the payload only, per-tenant and per-provider rows), `GET /platform/document-diagnostics` (runtime readiness and run counts).
- Actions: `PATCH /platform/document-retention-policy`, `POST /platform/document-retention-runs` (dry run by default; apply needs `apply:true`), `GET /platform/document-audit/export` (CSV, throttled).

What the brief listed but the repository **does not have** on this screen, and what this slice therefore did not build: a list of documents or processing jobs; search, filters or pagination (the data is a handful of aggregates and ten runs); a per-record tenant (batches and runs are aggregate counts across all tenants, and the usage `per_tenant` rows are deliberately not rendered, spec §12.7); a detail view, created/updated times for operations; retry, cancel or reprocess actions; document download or preview links. None of these was invented or added.

## Outcome

The page is a normal page inside `PlatformShell`: one `h1`, no private back arrow, 44px header actions. It now shows the real data it already received but never displayed: batches and processing runs **by status** (translated, unknown statuses shown as received), queued/running/failed run counts, whether each retention run was a dry run or applied, all four counts per run (scanned, eligible, purged, skipped), created and cutoff times, the usage period, and the last run. The retention run keeps its dry-run default and its apply confirmation, now explained, and every action is blocked while any request is in flight. No endpoint, payload, permission or retention logic changed.

## What was done

Files: `document-operations/page.tsx` (rewritten layout, same data and actions), `document-operations/document-operations.test.tsx` (new), `messages/ar.json` and `en.json` (+46 keys each in `documentOperations`), this report, the H1-4D report (corrected to MERGED) and the horizon status.

- **Header and notices.** Back arrow removed (the shell owns navigation). A one-line scope note says the figures cover the whole platform across all tenants and that no per-tenant or document-level detail is shown. Success and progress are `role="status"`; action and load failures are `role="alert"` (spec §12.7), with a 44px **Retry** on a load failure.
- **Loading.** First load shows skeleton cards instead of a text line. A refresh keeps the last data on screen (it used to blank the page); a failed refresh puts the alert above the retained data.
- **Statuses.** Two cards list batches and processing runs by status with counts. Known server values (15 batch states, 5 run states, 3 retention-run states, from the enums) are translated; any other value is shown as the server sent it. Nothing is listed that the API did not return.
- **Runtime tiles.** The fourth tile keeps the running count and adds queued and failed counts from the same diagnostics payload. Tiles are one column below `md`, two from `md`, four from `xl`.
- **Retention policy.** Labelled days field (44px) with an inline hint and invalid state for a value that is not a whole number from 1 to 3650; Save is disabled for such a value (the server rejects it anyway) and while any action runs.
- **Retention run.** Dry run stays the default. A one-line effect statement (dry run deletes nothing; applying deletes the eligible objects of this batch under the policy), the existing confirmation checkbox only when dry run is off (turning dry run back on clears it), the run button disabled until confirmed, and a note when the saved policy is disabled (the server rejects runs then; the button is not disabled, so eligibility is unchanged). No second dialog, per spec §12.7. A "last run" line shows status, kind, purged count and time.
- **Usage.** Totals are grouped (`1,234,567`) with the period the API reports. `per_tenant` and provider rows are never rendered.
- **Run history.** Per run: shortened id, dry-run or applied badge, translated status (this also fixes `planned`, which had no label), scanned / eligible / purged / skipped, created and cutoff times, and the resume cursor with wrapping. The old line labelled the scanned count "Operations"; it is now labelled correctly.
- **Errors.** 403 shows "Your platform role does not allow this." and 404 "The requested resource was not found."; other errors keep the server message.
- **Busy.** Every action (save, run, export, and refresh while loading) is disabled while any request is in flight, so no duplicate or overlapping request can start (before, only the same action was blocked, so a policy save could overlap a run).
- **Dates.** The page locale is passed to the formatter and dates sit in `<bdi>` (see H1-4D: the formatter defaults to Arabic).

## Privacy and safety

- No document content, file name or tenant identifier is shown; the only identifiers are the retention-run id (shortened) and the resume cursor, both already displayed before. `per_tenant` is in the payload and stays hidden (a test puts a distinctive tenant id in the fixture and asserts it never appears).
- No new link, download or preview. Export remains the one existing button; in demo mode it still makes no request.
- Opening the page only reads the three existing endpoints; toggling dry run or apply sends nothing; an action sends one request.
- Permissions, platform auth, endpoints, payloads, retry logic, state transitions and tenant isolation are untouched.

## Not done, deliberately

- No server-side filtering, pagination, list, detail or retry/cancel action (none exists). No change to OCR, Document AI, queues or workers. No second confirmation dialog for apply (spec).
- No change to shared components (`Badge`, `Card`, `Skeleton`, `Label`) or to the date formatter. H1-5 not started.

## Tests actually run

| Command | Result |
|---|---|
| `npx vitest run "src/app/platform/(console)/document-operations"` | 1 file, 22 tests passed |
| `npx vitest run` (full web suite) | 522 files, 5546 tests passed |
| `npm run build` | passed; the `/platform*` routes build, URLs unchanged |
| `npx tsc --noEmit` | 48 errors, the same count as `main`; none in `document-operations/` |
| ESLint | not run: the repo has no ESLint config |

New tests (jsdom, real page, real `ar.json`/`en.json`, `platformApi` and `platformDownloadFile` mocked): structure (no link or arrow, one `h1`, 44px actions, scope note); skeleton on first load; opening sends only the three reads; refresh keeps data and a failed refresh shows an alert above it; first-load failure with 44px retry and recovery; 403 and 404 in plain words; batches and runs by translated status, an unknown status shown as received and no status invented; empty states; running/queued/failed counts; usage grouping with the period and no per-tenant or provider data; run history (dry-run vs applied, translated `planned`, four counts, shortened id, cursor, created and cutoff in `<bdi>`); English dates contain no Arabic; disabled-policy note without disabling the run; dry run default and apply gating with no request on toggling; exact request bodies (dry run with cursor; apply with `apply:true`); every action blocked during a run; failed run as an alert; policy payload and days validation; export success, demo outcome, failure, and no second export while running; key parity and an Arabic render. Mutation checks: making notices always `status`, blocking only the same action, removing the days gate, showing raw statuses, blanking data on refresh and removing the apply gate each made at least one test fail.

Real browser (Playwright-core + Chromium, Next dev server; **every `/api/*` call was intercepted with fixtures and a fake signed-in session, no Laravel API**; ad-hoc probes, not committed, not run by CI). The first run used the app's built-in demo mode, which serves its own demo data for these endpoints and ignores mocked responses, so it exercised small data only; the probes were switched to a fake session so the stress fixture was used.

| Probe | Matrix | Result |
|---|---|---|
| Layout: page-level overflow on either edge, direction, theme, one `h1`, no links, grid columns of the tiles (1 / 2 / 4) and of the card pairs (1 / 2), all inputs and buttons at least 44px high, zero writes on open, no per-tenant leak; fixture with all 15 batch statuses plus a long unknown status, seven-digit counts and a ten-digit token total | widths 320, 375, 390, 430, 768, 1024, 1440, 1920 × `ar`/RTL, `en`/LTR × light, dark = 32 | 0 failures on the final code |
| Flows at 390/1440 | dry run default, apply gate, runs, policy, export, keyboard | no write on open or on toggling; dry run default on; apply disabled until confirmed; a double click on Run sent exactly one request with the expected body and every action was disabled meanwhile; invalid days (0, 3651, 1.5) kept Save disabled and sent nothing; the policy `PATCH` body was correct; export made one request and showed the success status; Tab order days → enable → Save → dry run → Run |
| States at 390 | load error, forbidden (Arabic), slow load, empty, run rejected | alert with a 44px retry and no overflow; the 403 plain-words text; skeleton; empty messages; server message as an alert |

The stress fixture found two real problems that small demo data had hidden, both fixed: a long unbroken status name widened a grid column and caused page-level horizontal overflow at 320 and 375px (statuses now wrap and grid cells can shrink), and the first-edge check missed overflow toward the left in RTL (the probe now checks both edges). The usage figures were also stacked into one column below `sm` so a ten-digit total cannot touch its neighbour.

## Responsive and accessibility results

- Viewports 320 to 1920, both directions, both themes: verified in a real browser as above; no page-level overflow, controls at least 44px, grids as specified.
- One `h1`, `h2` for each card and a visually hidden `h2` for the status group; every form control has a visible label (`htmlFor`); the days field has `aria-invalid` and an `aria-describedby` hint; status is text, never colour alone; notes use `role="note"`, failures `role="alert"`, successes `role="status"`; `aria-busy` on `main` while loading.
- Tab order checked on desktop. The apply confirmation is a checkbox, not a dialog, so there is no focus trap to maintain on this page.
- Contrast: only semantic tokens (measured in H1-4D: 7.09 / 5.42 warning, 7.13 / 5.24 positive, 6.47 / 6.24 negative in light / dark).
- Not verified: landscape, zoom and text scaling, screen readers, and a real authenticated session against the API (the fixtures follow the real response shapes). H1-5 owns those.

## Pre-merge reviews

### Implementer

Behaviour-preserving: the three reads, the three actions, their bodies and the `load()` side effects (days, enabled, resume cursor) are the previous code. New behaviour is display-only, plus two tightenings that cannot change a result: disabling Save for a value the server rejects, and disabling every action while any is in flight.

### Reviewer

- `Count`/status lists render only what the API returns; unknown statuses are shown raw, never mapped. The old "Operations" label on the scanned count was wrong and is corrected.
- Refreshing no longer blanks the page, which also removes a flash where the retention form reset to its last saved values under the user.
- The run request still sends `apply` only when dry run is off, and `after_file_id` only when a cursor exists (a test asserts both bodies).

### AWJ Guardian

- **Tenant and document privacy:** aggregate counts only; `per_tenant` and provider rows hidden; no document content, names or links; nothing new in notices or logs.
- **Auth and permissions:** only `platformApi`/`platformDownloadFile` with the platform session; the signed-out redirect and the server's permission checks are unchanged; 403 and 404 are explained, not hidden.
- **No unrequested action:** reads on open; writes only on an explicit click; apply still needs the explicit confirmation.
- **Backend/API/DB:** unchanged; no migration. Backward compatibility: translation keys only added (the namespace is shared with tenant pages; no existing key changed).

## CI

Final head of PR #1375: `8fd2ee8edcaa9fdee20ec639f69630a65536448e`. All 7 GitHub check runs finished `success` (CI Gate, web build x2, php artisan test sqlite x2, pgsql x2; workflow runs 38332490289, 38332490329, 38332490330). One web build had failed earlier on a transient `next/font` fetch; it passed on a single re-run with no code change. CI on the PR head is not evidence of a check on `main` after the merge.

## Merge / post-merge

- Merged 2026-10-13 04:59:47 UTC by the repository owner account as PR #1375; merge SHA `9becbb62b5e76484ba287e5ef424185893a092a8`. PRE_MERGE_REVIEW: PASS, recorded as a PR comment for the exact head. The Codex bot was unavailable (usage limit); that is not represented as a pass.
- Deploy: not requested, not done.
- Post-merge verification of this slice on `main` is recorded in the H1-5 report, not here: [AWJ-PLATFORM-UX-H1-5-VERIFICATION-REPORT.md](./AWJ-PLATFORM-UX-H1-5-VERIFICATION-REPORT.md).

## Risks and remaining work

- **Mock-only browser run.** Server-side validation and real error messages were not exercised against a Laravel API.
- **No per-operation view exists.** If the product needs a document queue, per-document or per-tenant operations, filters or retry/cancel, that is new API and screen work, not a UX pass; it is recorded here, not built.
- **Resume cursor is client state.** It is initialised once from the latest run and then follows each run's response; a page reload re-reads it from the latest run. Existing behaviour, unchanged.
- **Shared date formatter** defaults to Arabic when no locale is passed; other platform pages that call it without a locale may show Arabic AM/PM on the English UI (recorded in H1-4D).
- **Demo mode** serves built-in demo data for these endpoints, so a demo screenshot does not reflect a real payload (found while verifying this slice).
- Pre-existing and unrelated: 48 `tsc` errors in test files; `INVALID_KEY` message-namespace errors in the Next dev log for keys containing dots (also on `main`); the Next dev overlay badge in dev screenshots.

## Remaining before H1-5

- H1-5 (final integrated verification, per the horizon plan): real authenticated session against the API for all platform pages; landscape, zoom and text scaling; screen readers; the open recommendations recorded in the H1-4A to H1-4E reports (tenant picker size, test-then-reload discarding unsaved edits, shared date formatter locale, no persisted connection state for storage/scanner/processing).

## Git state

- Branch: `claude/awj-h1-4e-document-operations` (new, from `origin/main`; not a reuse of an earlier slice branch).
- Base SHA: `0349b822b5f38cf4fb4fe7b1ee4b89e847030ddc` (`origin/main` at start).
- Head SHA: `8fd2ee8edcaa9fdee20ec639f69630a65536448e`. PR #1375, merged as `9becbb62b5e76484ba287e5ef424185893a092a8`.

## Next dependency-ready task

**H1-5**: integrated verification of the platform administration UX against a real backend. Done as a verification slice; see its report. Closing the Horizon is a separate decision.
