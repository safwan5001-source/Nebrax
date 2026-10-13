# AWJ-PLATFORM-UX-H15-06 — Missing Application Translations & Narrow-Screen Overflow

Scope: frontend only (`web/`). No backend, DB, permission, product or status change.

## 1. Root cause

`ApplicationCatalog` exposes 45 application keys (e.g. `document_center.core`, `commerce.app_builder`).
The platform pages build a message key `applications.keys.<key with '.' → '_'>`. Two catalogue
keys had **no message** in `ar.json`/`en.json`, so next-intl rendered the raw path
`applications.keys.document_center_core` — a long unbreakable string — in:

- Global application controls card (name, search filter label, dialogs)
- Tenant override card (table name cell, preview rows, dialogs)

At ≤350px that string widened the table/cards (partly mitigated earlier by H15-09 `break-words`).

## 2. Adopted translations and their source in the project

| Key | EN | AR | Existing project source |
|---|---|---|---|
| `document_center.core` → `applications.keys.document_center_core` | Document Center | مركز المستندات | `nav.documentCenter` |
| `commerce.app_builder` → `applications.keys.commerce_app_builder` | App Builder | صانع التطبيقات | `nav.appBuilder` |

No new wording was invented: both names are the wording already shipped in the navigation, added
to the existing `applications.keys.*` mechanism (no parallel dictionary). Technical keys are
unchanged in API requests, DB and the monospace `dir="ltr"` key line under each name.
Naming note for Safwan: `appBuilder.noAccess` uses the phrase «تطبيقات AWJ» in AR; if the official
Arabic product name differs, only the one `commerce_app_builder` string changes.

## 3. Change

- `components/platform/application-label.ts` (new): `applicationLabel(t, key)` — uses the message if
  `t.has` says it exists, otherwise falls back to the **technical key** (never a message path, never throws).
- `global-application-controls-card.tsx`, `application-override-card.tsx`: replaced the local label
  logic with the helper; name/key cells get `break-words`, table name/key capped at
  `max-w-[min(20rem,70vw)]`; preview cell `break-words`.
- `messages/en.json`, `messages/ar.json`: the two keys.
- Tests: `application-names.test.tsx` (new, 16), `text-scaling.test.tsx` (guard regex updated to the helper call form).

## 4. Tests

Regression tests cover: both names AR/EN in both cards and dialogs; no raw `applications.keys.` path;
fallback for unknown keys (shows key, no throw); long unknown key stays wrappable; requests still send the
technical key; status/permissions unchanged; H15-09 wrap classes kept; **catalogue coverage guard**
(every key in backend `ApplicationCatalog.php` has a message in both locales).

| Run | Result |
|---|---|
| `src/components/platform` | 77/77 |
| names + text-scaling after mutations | 26/26 |
| Mutation checks (5: remove each message, drop fallback, drop break-words, send label instead of key, drop `has` guard) | all 5 caught |
| Full web suite | 545 files / 5909 tests passed |
| `tsc --noEmit` | 48 errors = baseline on main (no new) |
| `next build` | exit 0 |

## 5. Real-browser verification (Playwright + Chromium; mocked vs real)

Real: local Laravel + Next dev, real login, real default-font-size preference for 100%/200% text.
Mocked: one response containing a deliberately long unknown key (to exercise the fallback layout).

- Names correct in EN and AR; no raw path; 0 `MISSING_MESSAGE` console errors.
- Narrow matrix (tenants, tenant detail; EN/AR; 320/350/390): **100% text: 0/12 horizontal overflow.**
- **200% text:** 4/12 residuals, none caused by names: tenants EN 320 (10px); tenant detail EN 320 (59px), EN 350 (29px), AR 320 (15px) — shell header cluster, commercial summary tiles, "Inspect access" button. Pre-existing (H15-09 scope boundary), recorded as residual.
- H15-09 matrix re-run on final code: 0/48 at 100% and 200%.
- Geometry vs main (48 page states, 36 544 elements): 16 pages differ, **0 added / 0 removed**; shifts are
  uniformly vertical −24/−48px (two raw-key names that wrapped over 2–3 lines are now one short line)
  plus table column redistribution. Nothing else moved.

## 6. Residual risks / not verified

- 200% text residuals above at 320/350px (non-name).
- `document_center` group label is missing in `applications.groups` — affects the ERP `/applications` page, out of this slice's scope.
- Native browser zoom, real screen reader, Firefox and WebKit not run (screen-reader names verified by accessible-name tests only).
- Pages outside the platform area untouched.

## 7. Backward compatibility

Existing keys, API payloads, permissions, statuses unchanged. Unknown future keys degrade to the technical key.

## 8. Reviews

Implementer: self-review + mutation checks above. Reviewer / AWJ Guardian: recorded on the PR.

## 9. Git

Branch `claude/awj-h15-06-app-translations` · Base SHA `e8832155ddd977431a09898f254fd50a17d4d4d6` (main after H15-09 #1399).
No merge, deploy, production release or Horizon closure without Safwan's explicit approval.
