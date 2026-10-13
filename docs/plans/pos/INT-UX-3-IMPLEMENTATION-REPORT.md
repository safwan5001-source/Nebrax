# INT-UX-3 — Implementation Report

STATUS: PR open for review. Not merged. Not deployed.
DATE: 2026-10-13
TASK: Manual attribution panel integration inside the Integration Center (frontend only)
HORIZON: Integrations Center — Slice 4 (after INT-UX-2, PR #1390, merge `430262548deb5f4f982bfc956dd8c9086af49a83`)
SCOPE: INT-UX-3 **as defined by Horizon** (`DLV-INTEGRATIONS-UX-DESIGN-1.md` §11). INT-UX-4, INT-AUDIT-1 and the ingress panel were **not** started, and DP-C option 2 is **not** treated as approved.

## Scope gate (done before any code)

The first brief for this task described branch mappings and signed inbound endpoints. That is Horizon's **INT-UX-4** (read-only ingress panel, only if DP-C option 2 is approved), not INT-UX-3 (*"Manual attribution panel integration"*). Work stopped and the conflict was reported; the owner then chose **option B: implement the original INT-UX-3** and confirmed the earlier wording was a mistake. DP-C is recorded as "raised, not decided" and stays that way.

Horizon definition implemented: *"Show the tenant's A value and deep links (profile setup, Hub, report), respecting `company.manage`, `delivery_hub.view`, `reports.view`. Acceptance: links appear only for entitled users; no edits inside the Center. Security: read-only over profiles; Hub/report permission gating mirrored. Tests: link visibility matrix per role; existing `/delivery-platforms`, POS picker and report suites unchanged. Excludes: editing profiles, changing financial roles."*

## Audit of what INT-UX-2 already delivered (so nothing is duplicated)

| INT-UX-3 requirement | State after INT-UX-2 | Action |
|---|---|---|
| Show the tenant's A value | Done: ladder row A on the detail page and the A column/chip in the catalog (from `GET /delivery-platforms`, fail-closed `unreadable`) | None |
| Hub deep link gated by `delivery_hub.view` | Done (`canViewHub`) | None; covered by the new matrix |
| Report deep link gated by `reports.view` | Done (`canViewReport`) | None; covered by the new matrix |
| **Profile-setup link gated by `company.manage`** | **Gap.** The link was shown to every `invoices.view` user. The server rejects writes without `company.manage` (`POST/PUT /delivery-platforms`), so accountants and staff were offered a setup path they cannot complete | **Fixed** |
| Link visibility matrix per role | Gap: no test covered the setup link per role | **Added** |
| No edits inside the Center | Done (no write call; structural test) | Unchanged and re-run |

## What was built (the remaining gap only)

- `PROFILE_MANAGE_PERMISSION = 'company.manage'` in `web/src/lib/integration-center.ts` (an **existing** permission; the same key the server and the `/delivery-platforms` page already use).
- `use-delivery-integration-data.ts`: one more permission read, exposed as `canManageProfiles` (no new request).
- `delivery-platform-detail-screen.tsx` passes it; `delivery-platform-detail.tsx` renders the setup link **only** when it is true. Otherwise the same list item keeps the factual sentence and shows a muted hint: «يتطلب إعدادها صلاحية إدارة إعدادات المؤسسة.» / "Setting it up needs permission to manage company settings." A gated link is **absent**, never disabled and never hidden by CSS.
- Two message keys (AR/EN). No new component, no new route, no refactoring.

The hub and report links, the ladder, the ingress note and every state (loading, success, partial failure with retry, no permission, POS off, unknown key → real 404, malformed data) are unchanged.

## Data and permission contracts used (all existing; nothing invented)

| Surface | Contract | Server guard (existing) |
|---|---|---|
| A value | `GET /api/delivery-platforms` | `invoices.view` + application `sales.pos` |
| Readiness (unchanged) | `GET /api/delivery-platforms/readiness` | `invoices.view` + `sales.pos` |
| Setup target | page `/delivery-platforms` (list for `invoices.view`, edit for `company.manage`) | `POST/PUT /api/delivery-platforms` require `company.manage` + `sales.pos` |
| Hub target | page `/delivery-hub` | `GET /api/delivery-hub/*` require `delivery_hub.view` (writes `delivery_hub.operate`) |
| Report target | page `/reports/sales/delivery-channel` | `GET /api/reports/delivery-channel` requires `reports.view` |

Role reality (`Rbac::MATRIX`): owner/admin `*`; accountant and staff have `invoices.view` + `reports.view` only (no `company.manage`, no `delivery_hub.view`); self-service has none. The UI reads the server-computed permission **list**, not the role name (`hasPermission`), so a customised `admin` without `company.manage` also loses the link (tested).

**Target routes are actually protected, not just hidden.** Verified in code and by existing backend tests (run by the PHP CI jobs on this PR): `DeliveryPlatformApiTest::only_company_managers_can_mutate_but_viewers_can_read` (staff/accountant read 200, write 403; self-service 403), `::a_disabled_pos_application_blocks_configuration_for_that_tenant`, `DeliveryHubProjectionTest::view_cannot_mutate_and_accountant_or_staff_are_not_operators` (staff `GET /delivery-hub/orders` 403; asserts the matrix), `DeliveryChannelReportTest::missing_reports_view_is_forbidden_and_bad_filters_are_rejected`. On the web side each target page also checks its own permission (`/delivery-platforms`: `canView`/`canManage`; `/delivery-hub`: `delivery_hub.view`; the report workspace: `reports.view` and a 403 state). Coverage found during the audit: the report workspace (`delivery-channel-report-workspace.test.tsx`, missing permission and 403) and the profile editor (`delivery-platforms-workspace.test.tsx`, "keeps a viewer from saving") were tested; the **page-level gates of `/delivery-hub` and `/delivery-platforms` were not**. Two small tests were added for them (see below).

## Tenant isolation and secrets — evidence

- This slice adds **no request, endpoint, field or storage**. It only decides whether an existing link is rendered. Data still comes from the two existing tenant-scoped reads.
- Tenant isolation is a server property and is already pinned by existing tests: `DeliveryPlatformApiTest::a_second_tenant_cannot_see_modify_or_resolve_the_first_tenants_profile`, `DeliveryHubProjectionTest::another_tenant_cannot_read_or_learn_the_order`, `DeliveryChannelReportTest::another_tenant_is_invisible`. The UI never builds a tenant identifier.
- No secret, token, signing key or header is read or rendered; the signed-ingress note stays prose only. The structural test `no-connection-controls.test.ts` (unchanged, re-run) forbids connector and credential routes, write methods, raw buttons/forms/inputs and any href outside the allow-list.
- Hiding the link is **not** the protection: every target is guarded by the server (above), and the denied/self-service path makes zero delivery requests (tested at component and browser level).

## Changed files

| File | Change |
|---|---|
| `web/src/lib/integration-center.ts` | `PROFILE_MANAGE_PERMISSION` constant |
| `web/src/components/integrations/use-delivery-integration-data.ts` | `canManageProfiles` |
| `web/src/components/integrations/delivery-platform-detail-screen.tsx` | passes the flag |
| `web/src/components/integrations/delivery-platform-detail.tsx` | gated setup link + permission hint |
| `web/src/messages/ar.json`, `en.json` | `detail.setupNeedsPermission` |
| `web/src/components/integrations/delivery-platform-detail.test.tsx` | link-visibility matrix (5 permission sets) and hint/manager/A-value tests, both locales |
| `web/src/components/integrations/delivery-platform-detail-screen.test.tsx` | end-to-end role matrix through the hook (owner, admin, accountant, staff, three custom roles), customised-admin case, self-service zero-request case; accountant expectation updated |
| `web/src/app/(app)/delivery-hub/page.test.tsx`, `web/src/app/(app)/delivery-platforms/page.test.tsx` | New. Prove the target pages deny without a request and load for an entitled user: hub (accountant, staff, self-service, operate-only → forbidden state and zero requests; `delivery_hub.view` → loads); profiles (self-service and no `invoices.view` → forbidden and zero requests; accountant/staff → read only, never a write request). 18 tests across both locales |
| `web/e2e/int-ux-2-delivery-platform-catalog.spec.ts` | new INT-UX-3 section (browser role matrix, hint contrast, manager-only, POS off, denial, navigation both directions, keyboard); `manager` viewer fixture |
| `docs/plans/pos/INT-UX-3-IMPLEMENTATION-REPORT.md` | This report |

No backend, API, database, migration, `Rbac`, readiness-registry, accounting, POS or workflow change. INT-UX-1/2 components were not refactored.

## Tests and exact results

| Run | Result |
|---|---|
| The two detail test files, before → after | 60 → **85** tests (+25), all passing |
| Related suites (integrations, lib, app routes incl. the two new page-gate tests, middleware, delivery-platforms/hub workspaces, delivery hub lib, delivery-channel report workspace) | **19 files, 302 tests passed** |
| **Full web suite** (`npx vitest run`), final tree | **544 files, 5919 tests passed**, exit 0 |
| `npm run build` (Next.js 15.5.19, includes type check) | **Succeeded** (`BUILD_EXIT 0`) |
| `tsc --noEmit` | no errors in any changed file; the only error is the pre-existing `gemini-card.test.tsx` |
| Playwright (real Chromium, desktop 1440 and mobile 390), `int-ux-1` + `int-ux-2` specs on the dev server | **150 passed, 3 skipped (desktop-only by design), 1 failed** — the failure is a pre-existing intermittent test, see below |
| INT-UX-3 section alone, both viewports | **15 passed, 1 skipped** (keyboard test is desktop-only) |

What the INT-UX-3 tests pin: the link matrix for owner, admin, accountant, staff, custom roles (manage only, hub only, none) and a customised admin without `company.manage`; self-service makes **zero** requests and shows no link; a gated link is absent (no `disabled`/`aria-disabled`/button); the factual sentence and ladder row A stay visible for every viewer; POS off hides the whole panel; navigation Center → catalog → detail → setup link → back, then hub and report links leave the Center; keyboard order and focus indicator; the hint meets contrast ≥ 4.5 in both locales and themes; AR/EN key parity.

**Pre-existing intermittent failure (not caused by this change).** `int-ux-1-integration-center.spec.ts › summary error keeps the card usable` uses `getByRole('alert')`, which sometimes also matches Next's empty route announcer (`#__next-route-announcer__`, `role="alert"`) and fails with a strict-mode violation. Proof it is independent of this PR: on clean `main` (`5b22b357`, my changes stashed) three runs of that test gave **fail, pass, fail**, and across the full runs it failed in different variants each time. A one-line fix (target `data-testid="integration-center-summary-error"`) is **not** applied here to keep this PR free of side changes; it is listed under remaining work.

## Visual verification

Real Chromium via Playwright, API intercepted (no backend). Screenshots of the changed panel were taken for owner and accountant in Arabic/light and English/dark on desktop and mobile (8 images) and viewed: the owner sees all three links; the accountant sees the factual sentence, the muted permission hint and only the report link; the layout, RTL/LTR direction, spacing and contrast are consistent with INT-UX-2; no green is used. Existing INT-UX-2 states (loading, error, denied, POS off, unknown key, malformed evidence) re-passed in the same run.

**Research note (honest).** No new external visual research was performed for this slice. It adds no new pattern: the only visible change is one muted sentence in place of a link, following the "absent, not disabled" rule already used by INT-UX-1/2 and the design document. The INT-UX-1/2 reports record the earlier public-page research and its limitation (authenticated admin screens of competitors were never inspected). The owner can overrule this and request a research pass.

## Build / CI

`npm run build` passed locally. `web-ci.yml` and `ci.yml` (php sqlite and pgsql) run on the PR; **no CI result is claimed in this report**. The observed result for the exact head is given in the hand-off message.

## Pre-merge review

- PRE_MERGE_REVIEW: **PENDING** — requires CI green on the exact Head SHA. Any later head change invalidates it.

## Merge

Not merged (stopped before merge by instruction). Not deployed.

## Self-review

### Implementer
- The change is the smallest that closes the audited gap: one permission read, one conditional, one hint, no new component.
- The setup link is gated on the permission list the server computed, the same source the other two links use.

### Reviewer
- Non-managers lose a link they could previously follow to a read-only list of profiles (`/delivery-platforms` is viewable with `invoices.view`). Horizon's acceptance ("links appear only for entitled users", "respecting `company.manage`") and the owner's instruction call for exactly this; the list remains reachable from the sidebar for anyone who may view it.
- The hint says "permission to manage company settings" rather than naming a role, because custom roles can hold `company.manage`.

### AWJ Guardian
| Risk | Result |
|---|---|
| A setup path offered to a user the server will reject | Link absent without `company.manage`; server guard unchanged and covered by backend tests |
| Hiding mistaken for protection | Every target is server-guarded; denied users make zero requests |
| Role name trusted over the permission list | Uses the server-computed list; customised admin test |
| Connection/sync control appears | None; structural + browser assertions re-run |
| Signed ingress shown as a connection, or DP-C pre-empted | No ingress panel; note unchanged; INT-UX-4 not started |
| Secrets exposed | None read or rendered |
| Tenant leak | No new request; existing isolation tests apply |

## Accounting impact
None. No journal entry, invoice, payment, VAT, commission, settlement or stock path is read or written, so no journal-entry table applies.

## Tenant / branch isolation impact
None added. Reads and targets are existing tenant-scoped (and, where applicable, branch-scoped) server routes.

## Security / authorization impact
No new permission, endpoint or field. Client gating now mirrors the server for the setup link; the server remains the authority.

## Backward compatibility
Additive and narrowing: owners/admins see exactly what they saw; accountants and staff no longer see a setup link they could not use. `/delivery-platforms`, the POS picker, the Delivery Hub and the channel report are unchanged.

## API / DB / migration impact
None.

## Risks / remaining work

| Risk | Note |
|---|---|
| Verified against intercepted API responses only; Chromium only; no live screen-reader pass | Roles, names, focus order and contrast are asserted |
| Not verified against the real production backend | INT-UX-2 and INT-UX-3 are unverified there; a smoke pass should accompany the first deploy |
| Pre-existing flaky INT-UX-1 e2e assertion | Backlog: change `getByRole('alert')` to the summary-error test id |
| The e2e spec is not run by `web-ci.yml` | It repeats the visual verification; CI type-checks it through `tsconfig.json` |
| No new external visual research | Stated above; owner may request it |
| First middleware in the app (from INT-UX-2) | Unchanged here; rename to `proxy.ts` on Next 16 |

Not started, by instruction: **INT-UX-4** (read-only signed-ingress panel; needs a recorded DP-C decision), **INT-AUDIT-1**, any ingress management action, and any change to the six providers' readiness.

## Git state

- Branch: `feat/int-ux-3-manual-attribution-panel`
- Base SHA: `0c90419874594169d422515e881425e5b3b3fa70` (`origin/main` when the PR was opened; the branch was rebased onto it, and the commits between the INT-UX-2 merge `430262548deb5f4f982bfc956dd8c9086af49a83` and this base are documentation only)
- Head SHA: the PR head (this file cannot embed its own commit hash)
- PR: stated in the hand-off message

## Recommended next dependency-ready task

Per Horizon's order, the next UX slice is **INT-UX-4**, but only after the owner records a decision on **DP-C**; **INT-AUDIT-1** follows its own approval and **INT-UX-5** depends on it. Neither was started. Independently, secret rotation/disable stays out of reach until INT-AUDIT-1.
