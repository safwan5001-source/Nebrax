# AWJ ERP — POS Start Same-Tab Navigation

**PR:** [#635](https://github.com/safwan5001-source/Nebrax/pull/635)  
**Branch:** `cursor/pos-start-same-tab-af62`  
**Base SHA:** `2197e2bfffac8cc88517b653a5b4c7a4dd48e7ef` (`origin/main`)  
**Head SHA:** `70e8f17d8d189f47291fd78418866878a700092e` (code `13b2c231` + this report)  
**PR #631 merge on main:** `7f0cf3c1b5c394758f2a34eb52c75eb78f024f1a` (present; feature not recreated)

Do **not** merge. Do **not** deploy without Safwan’s explicit approval.

## Summary

Navigation-only fix after merged PR #631.

- **بدء البيع → `/pos/start` = same AWJ administrative tab** (no `window.open`, no `_blank`).
- **Successful session open / 422 adoption / existing session → `/pos` = new dedicated tab.**
- Failed session creation does **not** open `/pos`.
- No duplicate session creation.
- No backend / API / accounting / database changes.

## Exact navigation behavior before / after

| Step | Before (PR #631 on main) | After (this PR) |
|---|---|---|
| Sidebar **بدء البيع** | `/pos/start` via `target="_blank"`; ERP tab stayed on the previous page | Same-tab Next.js `Link` to `/pos/start` |
| `/pos/start` chrome | `(pos)` full-screen layout (no ERP sidebar) | `(app)` admin layout (sidebar + topbar) |
| Successful `POST /pos-sessions/open` | `router.replace('/pos')` in the start tab | Named window `awj-pos-workspace` → `/pos`; start tab stays on `/pos/start` |
| Existing open session on load | Auto `router.replace('/pos')` in the start tab; no POST | No POST; resume `<a href="/pos" target="_blank">` |
| HTTP 422 adoption | Re-fetch `mine=1`; `replace('/pos')` in the start tab | Same re-fetch; assign `/pos` on the placeholder tab |
| Failed open | Stay on start; show error | Stay on start; close placeholder tab; keep fields; show error |
| Direct `/pos` with no session | `replace('/pos/start')` | Unchanged |

Confirmed:

- **بدء البيع → `/pos/start` = same tab**
- **successful session open/adoption → `/pos` = new dedicated tab**

## Browser / new-tab strategy

Browsers block `window.open('/pos')` after `await api(...)`. `useEffect` after `GET mine=1` has no user gesture.

Chosen pattern (no fragile hacks):

1. **Submit click** («فتح الجلسة وبدء البيع»): after local parse succeeds, synchronously `window.open('about:blank', 'awj-pos-workspace')`, then POST. On success or successful 422 adoption: `posWin.location.replace('/pos')`. On failure: `posWin.close()`.
2. **Popup blocked** (`open` returns `null`): still POST/adopt (session remains source of truth). On success, show an in-page resume control (`target="_blank"`) and a short blocked-popup message. No delayed `window.open`.
3. **Existing session on load:** no `window.open`, no POST. Resume control is a real `_blank` link (user click is allowed).
4. Named window reuses an existing POS tab if one is already open.

## Files changed

| File | Change |
|---|---|
| `web/src/app/(app)/pos/start/page.tsx` | Moved from `(pos)`; open `/pos` in a dedicated tab after success/adoption; resume link for an existing session |
| `web/src/app/(app)/pos/start/page.test.tsx` | Inverted navigation assertions (new tab after success; no same-tab `replace('/pos')`) |
| `web/src/lib/pos-workspace.ts` | `posStart.openInNewTab: false`; `posSellingNewTabProps` + named-window helpers |
| `web/src/components/layout/sidebar.tsx` | Comment only (`بدء البيع` stays same-tab via the flag) |
| `web/src/messages/ar.json` / `en.json` | `open_pos_tab`, `popup_blocked`; `resuming` copy for the resume control |
| `web/src/lib/__tests__/pos-workspace.test.ts` | Start is same-tab; no sidebar new-tab items |
| `web/src/lib/__tests__/pos-open-session.test.ts` | Start page path `(app)`; no `router.replace` on start |
| `web/e2e/pos-dedicated-workspace.spec.ts` | Same-tab start + sidebar; `/pos` popup after session |
| `web/e2e/helpers/open-pos.ts` | After submit, land the test page on `/pos` so existing POS specs still reach the selling workspace |

Unchanged: backend, migrations, API contracts, accounting, `pos-cart-snapshot.ts`, POS checkout, session concurrency, `pos_shift_id` / `opening_balance` payload.

## Tests executed and results

Focused (Vitest):

```
src/lib/__tests__/pos-workspace.test.ts
src/lib/__tests__/pos-open-session.test.ts
src/app/(app)/pos/start/page.test.tsx
```

**27/27 passed.**

Full web suite: `cd web && npm test`  
**219 files, 1382 tests, all passed.**

Covered:

1. بدء البيع is same-tab (`openInNewTab: false`, no `_blank` on the sidebar item).
2. `/pos/start` is not opened with `window.open` / `_blank`.
3. Successful session creation opens `/pos` via the named window (`about:blank` → `location.replace('/pos')`).
4. `/pos` is not assigned before POST returns.
5. Failed session creation closes the placeholder and does not assign `/pos`.
6. Existing open session: no POST; resume `_blank` link to `/pos`.
7. 422 adoption assigns `/pos` on the dedicated tab.
8. Direct `/pos` no-session guard still `replace`s to `/pos/start` (source assertion on `pos/page.tsx`).

Playwright `pos-dedicated-workspace.spec.ts` was updated for the new contract. It was not executed in this environment (no full Laravel+Next demo stack in this run). Web CI is the production build.

## Build result

`cd web && npm run build` — **success** (Next.js 15.5.19).  
Route `/pos/start` present (`4.07 kB`).

## CI status

**Green** on head `70e8f17d` (PR #635):

- CI / php artisan test (L11, sqlite) — passed
- CI / php artisan test (L11, pgsql) — passed
- Web CI / web build (Next.js) — passed

No backend test changes; PHP jobs are unchanged from `main` besides this frontend-only branch.

## Risks / remaining issues

- **Popup blockers:** if `window.open` is blocked, the session is still created and a resume button is shown. Cashiers who block all popups must click **فتح نقطة البيع**.
- **Existing session on load:** one extra click on the resume control (cannot auto-open a tab without a gesture).
- **POS tab with no session:** `replace('/pos/start')` now loads admin chrome in that tab (same URL, `(app)` layout). Acceptable per the approved plan; the dedicated `/pos` workspace itself is unchanged.
- **`pos-cart-snapshot.ts` / legacy `shift_id`:** untouched; still a separate follow-up.
- Live browser QA of the two-tab flow was not run here (unit tests + production build only).

## Confirmation: no backend / accounting / API / database changes

No PHP, migrations, routes, or ledger code was modified. `git diff origin/main -- app/ database/ routes/ tests/` is empty.

## Next recommended step

Safwan reviews PR #635. Merge and deploy **only** after explicit approval.
