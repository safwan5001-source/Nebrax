# AWJ-ERP-UX-H1-3C — Display preferences kept on background refresh — Implementation Report

STATUS: PR OPEN (see PR for exact-head CI, PRE_MERGE_REVIEW and merge record)
DATE: 2026-10-14
Backlog: ERP-UX-026 (P2) · Audit: [H1-0](../AWJ-ERP-UX-H1-0-AUDIT.md)

## Outcome
Switching language (or light/dark) from the top bar now survives opening `/settings`. Before: toggle to English → open Settings → the next page is Arabic again.

## Root cause
`persistUser()` stores the user **and** applies the account's stored display preferences to the device (locale cookie, `theme`, AWJ theme). That is right at sign-in and after an explicit "save preferences", but `/settings` also calls it after a background `GET /me` refresh (and the security card after an e-mail change), silently overriding the top-bar choice.

## Approach
`persistUser(user, { applyDisplayPreferences?: boolean })`, default `true` (sign-in, register, handoff and the preferences card behave exactly as before). The two background refreshes pass `false`: the user record is still updated, display preferences are not re-applied. No API call, payload or stored preference changes; the account preference shown in Settings still reflects the server value.

## Changed files
- `web/src/lib/auth.ts`
- `web/src/app/(app)/settings/page.tsx`
- `web/src/components/settings/account-security-card.tsx`
- `web/src/lib/__tests__/auth.test.ts` (+2 tests)
- `docs/plans/erp/reports/AWJ-ERP-UX-H1-3C-REPORT.md`

## Tests and exact results
- `auth.test.ts` → 4 passed (2 existing; new: default applies cookie/theme, refresh mode keeps device cookie/theme while storing the user).
- Full Vitest on the final tree: **550 files, 6,003 tests passed**.
- Real browser, `docs/plans/erp/h1-0-evidence/tools/probe-locale.cjs` (token mode, which avoids the 5-per-minute login throttle; the account preference stays Arabic):

| Step | Baseline `main` | With this change |
|---|---|---|
| Start (account preference Arabic) | ar | ar |
| Top-bar toggle → English | en | en |
| `/invoices` | en | en |
| `/settings` | en | en |
| Next page `/invoices` | **ar** (reverted) | **en** |
| `locale` cookie | ar | en |

## Guardian
Authentication, token handling, permissions and session revocation untouched; only which fields of an already-fetched user are applied to the UI.

## Decision
AWJ Decision: the account preference is applied when the user signs in or saves it; a device-level toggle is not overwritten by data refreshes. Rejected: making the top-bar toggle write the account preference (changes behavior on every device of that user — a product choice not needed to fix the defect).
