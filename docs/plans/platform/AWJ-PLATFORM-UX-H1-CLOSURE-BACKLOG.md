# AWJ-PLATFORM-UX-H1 — Owner Closure Decision and Deferred-Items Register

STATUS: **DRAFT — AWAITING FINAL OWNER APPROVAL** · Horizon status: **OPEN** · Documentation only · No code, deploy or production release
Date: 2026-10-14 · Last merged fix: PR #1449 · `main` @ `c519ea5b0a4b51bf7e0538e8df061360c92a02b5` (verified: commit subject "fix(platform): keyboard-reachable price history scroll region (H1-N1) (#1449)")

This file records the owner's closure decision (as supplied by Safwan) and the register that closure condition 1 asks for. It is **not** an approval of production deployment, of any change to financial/accounting rules, or of accessibility completeness.

## 1. Decision (owner)

Defer the remaining H1 risks and improvements to an independent Backlog, preparing a **conditional** closure of the Horizon. Proposed outcome: **READY FOR CONDITIONAL CLOSURE**. Actual state: **OPEN**.

H1 closes only after: (1) the deferred items are recorded in a Backlog (this register is the repository reference); (2) H15-13 has its own independent treatment (§4); (3) the owner explicitly approves the final closure document.

## 2. Register of deferred items

Owner/assignee: **to be set by the owner** (not assumed here). Ticket IDs below (`BL-H1-xx`) are repository references; if tickets are opened in another tracker, add their links to the "Ticket" column.

| Ref | Item | Priority | Impact | Acceptance criteria | Evidence | Ticket / owner |
|---|---|---|---|---|---|---|
| — | **N1** price-history keyboard scroll | Done | — | Fixed and merged in #1449; axe finding 9/24 → 0/24, keyboard scroll LTR+RTL | `AWJ-PLATFORM-UX-H1-N1-PRICE-HISTORY-A11Y-REPORT.md` | — |
| BL-H1-01 | **N2** text clipped at 200% on phones (tenant card: account number, owner name/email truncated with an ellipsis) | P3 | Large-text users on a ~390 px phone cannot read the account number or owner fields visually; the full text is in the DOM, no page scroll. Reading data is affected, not writing | At 390 px and 200% text the account number, owner name and email are fully readable (wrap or reveal) in EN and AR, no horizontal page scroll, 100% layout unchanged | `h1-final-evidence/tenants-card-390-200pct-en.png`; Final Acceptance N2 | TBD |
| BL-H1-02 | **Concurrent duplicate price version → Backend 500** | P2 | Two admins/tabs saving the same `(plan, currency, effective_on)` get a generic 500; the unique key keeps data intact. With `APP_DEBUG=true` the SQL text is returned, in production mode the body is `Server Error` | Backend answers 422/409 with a stable message for a duplicate key (also under a race); UI shows it; no SQL in any mode; test with concurrent requests on SQLite and PostgreSQL. **No change to pricing rules** | Final Acceptance §5 (real 500; production-mode check) | TBD |
| BL-H1-03 | **Tenants ordering on equal `created_at`** | P2 | `orderByDesc('created_at')` only; timestamps are second-resolution (8 test tenants → 4 distinct values). On PostgreSQL ties may repeat or skip a row across pages. Not reproduced here (PostgreSQL not run); platform-only read listing | Deterministic tie-break (for example `id`) on the listing; a **PostgreSQL** test that pages through tenants with identical `created_at` and sees every tenant exactly once; SQLite unchanged | Final Acceptance §5; `PlatformTenantService` | TBD |
| BL-H1-04 | **Retention dry-run validation** | P2 | Backend rejects `{"dry_run":true}` and `{"dry_run":true,"apply":false}` with 422; the UI works around it by sending `apply:true` with `dry_run:true` (stays a dry run, no purge) | Validation accepts a dry run without `apply`; **safe behaviour preserved**: an apply still requires explicit confirmation and no purge can occur from a dry-run body; HTTP tests for all body shapes. No change to Retention rules or to what gets deleted | `PlatformDocumentOperationsController` rule `apply: required_if:dry_run,false|accepted` | TBD |
| BL-H1-05 | **H15-12** server messages Arabic-only on the English UI | P3 | English users see Arabic server text (for example login errors) | Platform API messages localized or mapped by code in the UI for EN/AR | H1-5 report; login error confirmed Arabic via API | TBD |
| BL-H1-06 | **H15-14** apply confirmation stays ticked after a retention apply | P3 | A second apply needs no fresh confirmation | Confirmation resets after each run; test | H1-5 report | TBD |
| BL-H1-07 | **H15-16** controls under 44 px (tenant application cards 32 px, date-picker icon 28 px) | P3 | Touch-target size | All interactive controls ≥ 44 px (or documented exception) | H1-5 report | TBD |
| BL-H1-08 | **H15-17** (three parts) (a) `IntlError INVALID_KEY` logged on every page; (b) Dependencies cell repeats `fuel_stations.core` ×3; (c) **session-guard mismatch**: the dashboard (`web/src/app/platform/(console)/page.tsx:76`) redirects to login unless the stored administrator profile exists (`currentPlatformAdministrator()`), while `PlatformShell` and the other console pages accept a session with only `platform_token` | (a) P3 · (b) P3 · **(c) P3 provisional — set only after the auth/security assessment in §4a (missing and malformed profile assessed separately); the owner confirms it** | (a) console noise (and the Next.js dev "Issues" badge), not user-visible in production; (b) cosmetic; (c) user-facing inconsistency with no authorization effect found in the code (§4a): with a token but a missing or malformed `platform_administrator` entry the dashboard bounces to login while every other console page opens | (a) No `INVALID_KEY` error on the platform pages; (b) dependency cell lists unique keys; **(c) one guard rule for all console pages: (1) token present + profile **missing** → the same outcome on the dashboard and on every other console page (either all open and show an empty/neutral name, or all redirect to login); (1b) token present + profile **malformed** (not valid JSON) → the same deterministic outcome on every console page: the platform session is cleared (as `getPlatformAdministrator()` does today), the user lands on the login page, no platform data is shown, and there is no request/redirect loop; (2) token missing → all redirect to login, no platform request sent; (3) expired/revoked token → every page redirects to login and clears the platform session on the first 401; (4) a tenant token or the ERP session never opens any console page and no console request is accepted (API 403); (5) unit tests for 1, 1b, 2 and 3 on the dashboard and on one other console page, and the existing real-API 401/403 matrix re-run unchanged. No Backend, permission or Tenant Isolation change** | Final Acceptance §5 (H15-17 carried) and H1-5 report row H15-17; code facts in §4a | TBD |
| BL-H1-09 | **320 / 350 px at 200% text** residual overflow | P3 | Shell header cluster, summary tiles and one button on tenant detail/tenants overflow slightly | 0 page-level overflow at 320/350 px and 200% text on tenants and tenant detail, EN and AR, with the real browser font-size preference | `AWJ-PLATFORM-UX-H15-06-TRANSLATIONS-REPORT.md` §5 (tenants EN 320 10 px; detail EN 320 59 px, EN 350 29 px, AR 320 15 px) | TBD |
| — | **H15-15** confirmation for Save plan / End trial now | Follow-up | Keeps the earlier design decision (no confirmation); re-evaluate when needed | — | Spec decision (H1-1/H1-4B) | — |
| BL-H1-10 | **H15-13** comma read as thousands separator in amounts — **mandatory independent financial assessment** | Assessment required | See §4. Not covered by the general deferral | See §4 | `web/src/lib/money.ts` `riyalToMinor` | TBD |

Deferring a financial or security item is **not** acceptance of its production risk (§5).

## 3. Verification still open (not PASS)

Real screen readers; Firefox and WebKit; the browser's native zoom; production build served with the production Backend; real external integrations and real documents (no suitable test environment); concurrent PostgreSQL cases that were never run; **the stale-response guard under out-of-order network latency** (the local backend answers in milliseconds, so a late response could not be produced; covered only by unit tests — H1-5 report and Final Acceptance §5 "Not verifiable here": needs real-environment evidence or an explicit waiver).

**BL-H1-11 — stale-response guard (open verification, acceptance test required).** The tenants list and the prices page guard against a late response overwriting a newer one (request sequencing in `tenants/page.tsx` and `prices/page.tsx`); other platform pages were not checked for the same guard. Today this is covered only by unit tests; the local backend answers in milliseconds, so a real out-of-order response was never produced. Acceptance test (real browser against a real test backend, with response delay injected per request, no change to application code):
1. *Tenants list, paging/search:* send request A (page 2 or a search term) held for 3 s and request B (page 3 or a different term) answered immediately; after A finally arrives the list, the pagination state and the search box still show B, and A's rows never appear (A resolves **after** B).
2. *Same with the reverse order* (B slower than A): the final state shows B.
3. *Prices page reload after a save:* hold the first catalogue response and resolve a second one first; the table shows the second catalogue and never briefly the older one after the second has rendered.
4. *Failure ordering:* an older request that **fails** after a newer one succeeded does not replace the data with an error banner.
5. No duplicate rows and no console errors in any case; repeat in EN and AR.
Result: PASS only with this evidence recorded; otherwise it stays NOT VERIFIED and needs an explicit owner waiver before Production Release. None may be reported as PASS without real test evidence.

## 4. H15-13 — independent treatment (read-only facts, no change made)

What the code does today (`web/src/lib/money.ts`, `riyalToMinor`):
- A comma is removed as a thousands separator, so `1,5` is read as **15** (→ 1500 minor units, 15.00), not 1.50; `1,50` → 150.00. The Arabic decimal separator `٫` is converted to `.` correctly. The Arabic comma `،` is not handled (→ rejected as malformed).
- The function is **shared**: 49 non-test source files import it (platform prices among them), so any change affects many screens and money paths, not only `/platform/prices`.
- In `/platform/prices` the preview shows the parsed amount (15.00) before saving, and the Backend stores minor units; the parsing happens in the UI only.

Why it needs its own assessment: it is a financial-input interpretation rule with a locale policy decision (comma as thousands vs decimal separator), used across the ERP. Under the project rules a policy with more than one reasonable answer must be put to the owner and be configurable rather than silently changed. Suggested scope for that task (not started): inventory the 49 consumers; decide the policy (reject ambiguous `x,y` with a clear message vs. locale-driven interpretation); define acceptance tests including Arabic/Latin digits and both separators; no Backend or accounting change implied.

## 4a. H15-17(c) session-guard mismatch — auth/security assessment (read-only; no code changed)

Facts from the code on `main` @ `c519ea5b…`:
- `isPlatformAuthenticated()` = a stored `platform_token` exists (or demo mode). `currentPlatformAdministrator()` reads the stored profile (`platform_administrator`) through `getPlatformAdministrator()`, which for a **syntactically malformed** value (JSON parse failure) calls `clearPlatformSession()` and returns `null` (`web/src/lib/platform-api.ts:32-43`).
- The dashboard guard requires **both**; `PlatformShell` (`platform-shell.tsx:62,66`) and the other console pages require **only the token**. Apart from the malformed case below, the profile is used for **display only** (the name in the shell); no code path found uses it for an authorization decision (`grep` of `currentPlatformAdministrator|getPlatformAdministrator`: the shell and the dashboard guard only).
- Authorization is enforced by the API, not by this client check: executed on `main` @ `22f2ee50` — no token / bad token → 401 JSON (with and without `Accept`); a tenant token on platform routes → 403; a platform token on tenant routes → 403. A 401 on any platform request clears the platform session and redirects to login (`platform-api.ts`: `expirePlatformSession`).
- **Two distinct cases, not one:** (i) profile **missing** → no mutation; the dashboard redirects to login, the other pages open with an empty name; (ii) profile **malformed** → reading it **mutates the session** (token and profile are cleared), and because `PlatformShell` calls the getter on every console page (`platform-shell.tsx:66`) the user is effectively signed out on the next shell mount, then redirected by the first 401. This case is a **forced local logout** (fail-closed: no data exposure, no escalation found), but it is a session side effect of reading a display value, so it is recorded and tested separately.
- Direction of the mismatch: on the dashboard it **fails closed** (redirect to login); on the other pages the UI opens but every data request still needs a valid token. So no unauthenticated access to platform data and no privilege escalation was found.

What was **not** done: neither state ("valid token + missing profile" and "valid token + malformed profile") was reproduced in a browser in this review; the description above is derived from the code. That is why the priority stays **P3 provisional**: if a browser check or a later code path shows the profile being used for access decisions, or any console page rendering data without a valid token, the item is re-rated (P2 or higher) and handled as a security finding.

## 5. Controls on deferral

- Each item above needs its own ticket or a clear reference (this register is the reference until tickets exist), with priority, impact, acceptance criteria and owner.
- Deferring a financial or security issue is not acceptance of its risk in production.
- No change to pricing, accounting rules, Tenant Isolation or Retention outside an approved task.
- Remaining risks are reviewed before any Production Release.

## 6. Closure conditions and state

| # | Condition | State |
|---|---|---|
| 1 | Deferred items documented in a Backlog | **PENDING — not satisfied.** The register is written, but every item still has a `TBD` owner. Keep this condition pending until, for **each** item, an owner/ticket is recorded **or** the owner records an explicit waiver or schedule (§5 requires an owner per item) |
| 2 | Independent treatment defined for H15-13 | **Facts and proposed scope written (§4); the task itself and its owner are for the owner to approve** |
| 3 | Final closure document explicitly approved by the owner | **Pending** |

Horizon state: **OPEN.** Nothing in this document merges, deploys or releases anything automatically.
