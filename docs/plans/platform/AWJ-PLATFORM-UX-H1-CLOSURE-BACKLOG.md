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
| BL-H1-08 | **H15-17** `IntlError INVALID_KEY` logged on every page; Dependencies cell repeats `fuel_stations.core` ×3 | P3 | Console noise (and the Next.js dev "Issues" badge); not user-visible in production | No `INVALID_KEY` error on the platform pages; dependency cell lists unique keys | Confirmed on 12/12 loads on `main` @ `22f2ee50`; key `appBuilder.builder.visibility.signalOption` | TBD |
| BL-H1-09 | **320 / 350 px at 200% text** residual overflow | P3 | Shell header cluster, summary tiles and one button on tenant detail/tenants overflow slightly | 0 page-level overflow at 320/350 px and 200% text on tenants and tenant detail, EN and AR, with the real browser font-size preference | `AWJ-PLATFORM-UX-H15-06-TRANSLATIONS-REPORT.md` §5 (tenants EN 320 10 px; detail EN 320 59 px, EN 350 29 px, AR 320 15 px) | TBD |
| — | **H15-15** confirmation for Save plan / End trial now | Follow-up | Keeps the earlier design decision (no confirmation); re-evaluate when needed | — | Spec decision (H1-1/H1-4B) | — |
| BL-H1-10 | **H15-13** comma read as thousands separator in amounts — **mandatory independent financial assessment** | Assessment required | See §4. Not covered by the general deferral | See §4 | `web/src/lib/money.ts` `riyalToMinor` | TBD |

Deferring a financial or security item is **not** acceptance of its production risk (§5).

## 3. Verification still open (not PASS)

Real screen readers; Firefox and WebKit; the browser's native zoom; production build served with the production Backend; real external integrations and real documents (no suitable test environment); concurrent PostgreSQL cases that were never run. None may be reported as PASS without real test evidence.

## 4. H15-13 — independent treatment (read-only facts, no change made)

What the code does today (`web/src/lib/money.ts`, `riyalToMinor`):
- A comma is removed as a thousands separator, so `1,5` is read as **15** (→ 1500 minor units, 15.00), not 1.50; `1,50` → 150.00. The Arabic decimal separator `٫` is converted to `.` correctly. The Arabic comma `،` is not handled (→ rejected as malformed).
- The function is **shared**: 49 non-test source files import it (platform prices among them), so any change affects many screens and money paths, not only `/platform/prices`.
- In `/platform/prices` the preview shows the parsed amount (15.00) before saving, and the Backend stores minor units; the parsing happens in the UI only.

Why it needs its own assessment: it is a financial-input interpretation rule with a locale policy decision (comma as thousands vs decimal separator), used across the ERP. Under the project rules a policy with more than one reasonable answer must be put to the owner and be configurable rather than silently changed. Suggested scope for that task (not started): inventory the 49 consumers; decide the policy (reject ambiguous `x,y` with a clear message vs. locale-driven interpretation); define acceptance tests including Arabic/Latin digits and both separators; no Backend or accounting change implied.

## 5. Controls on deferral

- Each item above needs its own ticket or a clear reference (this register is the reference until tickets exist), with priority, impact, acceptance criteria and owner.
- Deferring a financial or security issue is not acceptance of its risk in production.
- No change to pricing, accounting rules, Tenant Isolation or Retention outside an approved task.
- Remaining risks are reviewed before any Production Release.

## 6. Closure conditions and state

| # | Condition | State |
|---|---|---|
| 1 | Deferred items documented in a Backlog | **Register written here (this PR); tickets/owners still to be set by the owner** |
| 2 | Independent treatment defined for H15-13 | **Facts and proposed scope written (§4); the task itself and its owner are for the owner to approve** |
| 3 | Final closure document explicitly approved by the owner | **Pending** |

Horizon state: **OPEN.** Nothing in this document merges, deploys or releases anything automatically.
