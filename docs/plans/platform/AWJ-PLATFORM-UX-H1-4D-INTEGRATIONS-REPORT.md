# H1-4D — Platform Integrations UX — Implementation report

STATUS: MERGED (PR #1372, `0349b822b5f38cf4fb4fe7b1ee4b89e847030ddc`) / NOT DEPLOYED / POST-MERGE VERIFICATION NOT RECORDED
Horizon: AWJ-PLATFORM-UX-H1 · Slice: H1-4D (integrations) · Date: 2026-10-12
Spec: [AWJ-PLATFORM-UX-H1-1-UX-SPEC.md](./AWJ-PLATFORM-UX-H1-1-UX-SPEC.md) §8, §9 and §12.6

## Scope found

The platform has one integrations screen: `/platform/integrations` (`web/src/app/platform/(console)/integrations/page.tsx`), backed by:

- `GET /platform/integrations` (overview: four integrations plus runtime), `PUT /platform/integrations/{key}`, `POST /platform/integrations/{key}/test`, `POST /platform/integrations/document_ai/test`;
- the file-scan exceptions list on the same page: `GET`/`POST /platform/document-file-scan-exceptions`, `POST …/{id}/revoke`, and `GET /platform/tenants` for the tenant picker.

Real status fields (`PlatformIntegrationService::overview`): per integration `enabled`, `configured`, `configured_at`, `provider` and masked secrets; per AI provider `last_test_status` (`passed`/`failed`/`not_tested`), `last_tested_at` and, for Gemini, an error code. Storage, scanner and processing carry **no** last-test data (a test result is a one-off response). So the page shows only what exists; it does not invent "connected", "connecting" or "failed" states.

## Outcome

The page now sits inside `PlatformShell` as a normal page: one `h1`, a single Refresh action, no private back link. Each service card shows a saved-state badge (not configured / saved, disabled / saved, enabled) from `configured` and `enabled`, an explicit note that a live check runs only on **Test**, and a "not saved yet" note when the toggle differs from the saved state. AI provider cards show the last test result and date, and whether a (masked) key is stored. The file-scan exceptions panel is localized, labelled, responsive and uses the confirmation dialog for revoking. No endpoint, payload, permission or secret handling changed.

## What was done

Files: `integrations/page.tsx`, `integrations/file-scan-exceptions.tsx`, `integrations/isolate.ts` (new), `integrations/integrations.test.tsx` (new), `integrations/gemini-card.test.tsx` (two small updates), `messages/ar.json` and `en.json` (+37 keys each, `platformIntegrations`), this report, the H1-4C report (corrected to MERGED) and the horizon status.

- **Header and states.** Back link removed (the shell owns navigation). Refresh is 44px. A first load shows the skeleton; a refresh keeps the settings on screen; a load failure is a `role="alert"` row that wraps (`flex-wrap`, retry 44px) and, if settings are already on screen, appears above them instead of replacing them. `aria-busy` on `main` while loading.
- **Notice.** Success stays a `role="status"` line; a failed test or save is now `role="alert"` with a negative tone and an icon, so failure no longer reads as a status. The message is whatever the API returned; no secret is copied into it.
- **Service cards.** Status badge, last-configured date, effect note when the enable toggle is unsaved, 44px controls and toggles, header that wraps on narrow screens. The runtime card header wraps. A visually hidden `h2` gives the core cards a heading level.
- **AI providers.** Last-test line keeps its text and gains an icon and colour (pass/fail), "API key stored / No API key stored" from `has_api_key`/`api_key_masked` (the key itself is never shown), and the same unsaved-toggle note.
- **Layout.** Per spec: storage beside scanner from `xl`; file-scan exceptions and background processing full width; one column below. In the exceptions form the four fields are one column below `md`, two at `md`, four from `xl`; Grant is full width below `sm`, at the inline end above it.
- **File-scan exceptions.** All bilingual literals (`عربي / English`) moved into messages in both languages; the warning that an exception is not a clean scan is kept with its meaning. Visible labels, status badges translated, expiry shown with the formatter, skeleton / empty / load-failure-with-retry states, a grant notice that is a status on success and an alert on failure.
- **Revoke.** `window.prompt` ×2 replaced by the existing `ConfirmDialog`: the dialog states the permanent effect (from the server: a revoked exception cannot be reactivated; admission needs an active exception; existing admissions are unchanged), collects reason and password in labelled fields, confirm is disabled until both are present and while busy, Cancel/Escape/backdrop send nothing, focus starts on Cancel and returns to the Revoke button, and the password is cleared whenever the dialog opens or closes. A rejected revoke keeps the dialog open with the server message as an alert. Request and body are unchanged.
- **Dates.** The formatter defaults to Arabic when no locale is passed, which put Arabic AM/PM and reordered digits on the English page. The page locale (`useLocale`) is now passed, and dates in running text are isolated with first-strong direction (`FSI…PDI` in strings, `<bdi>` in elements), so Arabic keeps its own RTL formatting and English reads LTR. (Found in a real-browser screenshot; the first attempt forced LTR and was wrong for Arabic, which the same screenshots showed.)

## Secrets and safety

- Secret inputs stay `type="password"`; stored secrets appear only as the masked placeholder the API returns, never as a value, text node or title. After a save the typed secrets are cleared by the existing hydration. Admin password stays on every write that required it.
- Nothing connects on open: opening the page only reads. A connection test is sent only by pressing **Test**; opening the revoke dialog sends nothing (all checked in unit tests and in a real browser).
- No new logging, no secret in a notice, no snapshot of a secret. A test types distinct secret values and asserts they never appear in the page text and appear only in the `PUT` body.
- Permissions, platform auth, endpoints, payloads and tenant isolation are untouched; the page still redirects to the platform login when signed out.

## Not done, deliberately

- No new status values, providers, OAuth flow, rotation or reconnect action. No confirmation dialog on enable/disable or Save (the toggle is already two-step: change, then Save with the admin password); instead the unsaved effect is stated.
- No change to the test-then-reload behaviour (below), the shared `Dialog`, `DataTable`, `Select`, `Input`, `Badge` or the date formatter.
- No Backend, database or migration change; no tenant ERP page touched. H1-4E and H1-5 not started.

## Tests actually run

| Command | Result |
|---|---|
| `npx vitest run "src/app/platform/(console)/integrations"` | 6 files, 41 tests passed (19 existing + 22 new) |
| `npx vitest run` (full web suite) | 514 files, 5455 tests passed |
| `npm run build` | passed; the `/platform*` routes build, URLs unchanged |
| `npx tsc --noEmit` | 48 errors, the same count as `main`; one is the existing `gemini-card.test.tsx` line 178 error, none is in new or changed product code |
| ESLint | not run: the repo has no ESLint config |

New tests (`integrations.test.tsx`, jsdom, real page, real `ar.json`/`en.json`, real `formatDateTime`, `platformApi` mocked): structure (no link, one `h1`, labelled sections, 44px refresh); opening sends no write and no test; status from `configured`/`enabled` only and no "connected" wording; AI test result, date and key-stored state from API fields; unsaved-toggle note with no request; secrets (empty password inputs, masked placeholder, never rendered, typed secret only in the `PUT` body and cleared); failed test = alert, passed = status; first-load failure with wrapped 44px retry and recovery; refresh failure keeps settings; duplicate save blocked while busy; exceptions (no mixed-language literals, warning kept, one-column grid classes, labels, translated statuses, empty and load-failure states, grant payload and gating, revoke dialog sends nothing on open/cancel, explains the effect, returns focus, revokes once with the same payload, password not retained, rejected revoke keeps the dialog); dates (page language, isolation, Arabic page); locale key parity. Mutation checks: reverting the alert role, the saved-state source, the revoke confirm gate and the password clearing each made a test fail. The existing Gemini tests pass; the mock gained `useLocale` and one assertion compares the paragraph text instead of a text node (the date now sits in its own `<bdi>`).

Real browser (Playwright-core + Chromium, Next dev server in demo mode; **every `/api/*` call was intercepted with fixtures: no Laravel API and no real session**; ad-hoc probes, not committed, not run by CI):

| Probe | Matrix | Result |
|---|---|---|
| Layout: page-level overflow, direction, theme, one `h1`, no links, three section anchors, grid columns of the exceptions form (1 / 2 / 4) and the core grid (1 / 2), every input, select and button at least 44px high, zero writes on open | widths 320, 375, 390, 430, 768, 1024, 1440, 1920 × `ar`/RTL, `en`/LTR × light, dark = 32 | 0 failures (run on the final layout) |
| Flows at 390/1024 | toggle, test, revoke dialog | no write on open or toggle; one `POST …/test` only on click, shown as an alert; opening the revoke dialog sent nothing; focus began on Cancel, Tab stayed inside, Escape closed with no request and focus returned to the Revoke button; a double click on confirm sent exactly one revoke with the expected body |
| States at 390 | load error, slow load, empty exceptions, exceptions load failure | alert row wraps with a 44px retry and no overflow; skeleton with `aria-busy`; empty and failure messages shown |
| Dates | `en` and `ar` | English "1 Sept 2026, 10:00 AM"; Arabic keeps its own RTL formatting; neither reorders |

The screenshots also found the date problem described above; both the Arabic and the English page were re-checked after the fix.

## Responsive and accessibility results

- Viewports 320 to 1920, both directions, both themes: verified in a real browser as above; no page-level horizontal overflow, controls at least 44px, exceptions form and grids as specified.
- Landmarks and headings: one `h1`, `h2` for the core group (visually hidden) and the AI section, `h3` card titles; the exceptions card is a labelled region; every form control has a visible `label`; status uses text (and an icon for pass/fail), never colour alone; notes use `role="note"`, failures `role="alert"`, successes `role="status"`; the revoke dialog has a focus start on Cancel, Tab containment and focus return (the dialog trap is the H1-4B `ConfirmDialog`).
- Contrast: only semantic tokens; the text colours used measure 7.09 / 5.42 (warning), 7.13 / 5.24 (positive) and 6.47 / 6.24 (negative) in light / dark.
- Not verified: landscape, zoom and text scaling, screen readers, and a real authenticated session against the API (the fixtures follow the real `overview()` shape). H1-5 owns those.

## Pre-merge reviews

### Implementer

Behaviour-preserving: handlers, endpoints and payloads are the previous code; the changes are layout, labels, status derivation, the notice role, the revoke dialog and the date locale. One real-browser finding was fixed: the date rendering (the first attempt, forcing left-to-right, was wrong for Arabic and was corrected after re-checking screenshots). A probe selector also matched a hidden `<option>` and made the first matrix run slow; it was corrected and the matrix re-run on the final code.

### Reviewer

- The saved-state badge reads the API summary and the toggle reads form state; a test proves they can differ and that the note appears without any request. "Last test" text is unchanged for the existing Gemini assertions.
- `FileScanExceptions` keeps its requests exactly; the new state is local to the dialog and cleared on every open/close. A load failure there was a plain status line; it is now an alert with a retry.
- The confirm dialog cannot be closed while busy, and the revoke button is disabled while any request is in flight, so a duplicate revoke or grant is not possible.

### AWJ Guardian

- **Secrets:** no secret rendered, logged or copied into a notice; password inputs unchanged; the dialog's password is cleared on open and close; masked values appear only as placeholders.
- **Auth and isolation:** only `platformApi`; no tenant context or branch header; the platform redirect and the server's permission checks are unchanged.
- **No auto-connect:** only reads on open; tests and writes only from explicit actions.
- **Backend/API/DB:** unchanged; no migration. Backward compatibility: translation keys only added.

## CI

Final Head `60071829adcf14f709bc4f7120c47994ed096c10` of PR #1372: all 7 GitHub check runs `success` (CI Gate, web build ×2, php artisan test sqlite ×2, pgsql ×2; the three workflow runs `38254410599`, `38254410692` and `38254410574`), read through the GitHub API. The Codex review of that head completed with no findings and there were no review threads.

## Merge / post-merge

- PRE_MERGE_REVIEW: PASS, recorded as a comment on PR #1372 by the repository owner account for the exact Head above; no review threads.
- Merge status: merged on 2026-10-13 (01:08:29 UTC) by the repository owner account, not by the Claude session. Merge SHA `0349b822b5f38cf4fb4fe7b1ee4b89e847030ddc`, confirmed on `origin/main` (subject "feat(platform): H1-4D integrations UX (#1372)"). The owner authorized the merge only, not deployment.
- Post-merge review: not done. No target-branch check or smoke evidence on `0349b822` was collected, so none is claimed.
- Deploy / production release: not done.

## Risks and remaining work

- **Mock-only browser run.** Server-side validation and real error messages were not exercised against a Laravel API; the fixtures follow the real response shape.
- **Test then reload (existing behaviour, not changed).** After a storage, scanner or processing **Test**, the page reloads the overview and re-hydrates those forms, so unsaved edits (and any typed secret) in those cards are discarded. The AI provider test only refreshes the overview. Aligning the two is a behaviour change, so it is recorded here.
- **Tenant picker size.** The exceptions form lists whatever `GET /platform/tenants` returns on its first page; with many tenants the picker could be incomplete. A searchable picker belongs with the tenants list work.
- **Shared date formatter** defaults to Arabic when no locale is passed; other platform pages that call `formatDateTime(value)` without a locale may show Arabic AM/PM on the English UI. Recommend passing the locale there (outside this slice).
- **No server last-test data** for storage, scanner and processing, so the page cannot show a persisted connection state for them; a future API field would allow it.
- Pre-existing and unrelated: 48 `tsc` errors in test files; `INVALID_KEY` message-namespace errors in the Next dev log for keys containing dots (`cart.itemCount` and similar, also on `main`); the Next dev overlay badge in dev screenshots.

## Git state

- Branch: `claude/awj-h1-contrast-recovery-fx8unn` (restarted from `main` after #1368 merged; older remote history is merged in so no force-push is needed).
- Base SHA: `62dabab4d59ee8c1a58e50f69854d7fe013613f6` (`origin/main` at start).
- Head SHA: `60071829adcf14f709bc4f7120c47994ed096c10`. PR: #1372 (merged).

## Next dependency-ready task

**H1-4E** (document operations, spec §12.7): see `AWJ-PLATFORM-UX-H1-4E-DOCUMENT-OPERATIONS-REPORT.md`.
