# INT-UX-4 — Implementation Report

STATUS: PR open for review. Not merged. Not deployed.
DATE: 2026-10-13
TASK: Read-only AWJ-signed ingress panel inside the delivery-platform detail page (frontend + one additive server test)
HORIZON: Integrations Center — Slice 5 (after INT-UX-3, PR #1400, merge `c96593e37a02c32ad03f2901ae36ea62c2ff4344`)
APPROVAL: DP-C **option 2**, owner-approved on 2026-10-13 **for this task only**. Not option 3, no native integration, no deploy.

## 1. What was done

A read-only panel titled «نقاط استقبال الأحداث الموقّعة» / "Signed event ingress points" now sits on `/integrations/delivery-platforms/[platformKey]`, directly under the existing "ingress is not a connection" note. It lists the tenant's already-existing `DeliveryConnectorAccount` rows **for that platform** and nothing else. The page was not redesigned; the capability ladder, INT-UX-3 links and the evidence section are untouched.

Per row: store ID at the provider · branch (see §5) · status as the server states it (configured / disabled) · signing-key *version* · creation date (plus the disable date for a disabled point). Rows are a table on `md+` and cards below.

Wording guarantees (tested in both locales): the panel never says «متصل بالمنصة», «حساب التاجر مرتبط», «المزامنة مفعّلة», «جاهز للتكامل الأصلي» (nor their English equivalents). It states, in the panel itself, that (a) having a point does not indicate a connection, a linked merchant account or sync; (b) a point's status is AWJ-only and is **not** platform readiness or the native status shown above; (c) a point may be routed to a branch and that does **not** map the provider's store to a branch; (d) points are shown within the user's branch scope and the panel is read-only. The configured badge uses the neutral (primary-soft) tone — no green — and "disabled" uses the muted tone.

Not built (by instruction): create / edit / disable / rotate / reassign / test / replay, connect / authorize / reconnect / sync, any new endpoint.

## Scope gate (done before any code)

Read `DLV-INTEGRATIONS-UX-DESIGN-1.md` (INT-UX-4, DP-C, DP-E, §5.3, §6.5, §9.3), the INT-UX-3 report, the INT-UX-1/2 interfaces, and the existing controller / resource / model / routes. Finding: **no backend, API, DB, migration or permission change is needed.** `GET /api/delivery-connectors` already carries `delivery_connector.view` + `sales.pos`, the tenant scope (`BaseModel`) and the allowed-branch filter, and its resource never contains the full secret. No stop-and-report condition arose.

## 2. Changed files

| File | Change |
|---|---|
| `web/src/lib/signed-ingress.ts` | **new** — pure allow-list reader (`readIngressPoints`, `readBranchNames`, `branchLabel`) |
| `web/src/components/integrations/use-signed-ingress.ts` | **new** — the only reader: `GET /delivery-connectors`, then `GET /branches` only if needed |
| `web/src/components/integrations/signed-ingress-panel.tsx` | **new** — panel UI (states, table, cards) |
| `web/src/components/integrations/delivery-platform-detail.tsx` / `-screen.tsx` | wire the panel via optional `ingress` props (default = absent) |
| `web/src/components/integrations/use-delivery-integration-data.ts` | exposes `attempt` so the panel re-reads with the page's retry |
| `web/src/messages/ar.json`, `en.json` | `integrationCenter.ingressPanel.*` |
| `web/src/lib/signed-ingress.test.ts`, `signed-ingress-panel.test.tsx` | **new** unit/component tests |
| `web/src/components/integrations/no-connection-controls.test.ts` | narrowed update (see §7) |
| `web/src/components/integrations/delivery-platform-detail-screen.test.tsx` | backend mock gets the two new reads (empty) |
| `web/e2e/int-ux-4-signed-ingress.spec.ts` | **new** real-browser spec |
| `tests/Feature/DeliveryConnectorCoreTest.php` | one additive test (read gate / POS gate / fixed key set / branch scope) |
| `docs/plans/pos/DLV-INTEGRATIONS-UX-DESIGN-1.md` | DP-C decision record (§3) |

## 3. DP-C documentation

Recorded in `DLV-INTEGRATIONS-UX-DESIGN-1.md`, under **DP-C → Decision (owner, 2026-10-13)**, with pointers in §5.3 and the INT-UX-4 slice header. It records: option 2 for INT-UX-4 only (not option 3, not a standing approval); what it does **not** approve (any write action — still INT-UX-5 behind INT-AUDIT-1; any native connection/sync; readiness/ladder changes; provider-store ↔ branch mapping = INT-MAP-1; deploy); the wording limits; the data limits; and that **DP-E is unchanged**. One deliberate supersession is stated explicitly: §5.3 listed "secret prefix … operator"; the prefix is a fragment of the signing secret and no approved source exists for operator names, so neither is shown. No other decision was modified.

## 4. API and permissions used

| Call | Gate | When |
|---|---|---|
| `GET /delivery-connectors` | `delivery_connector.view` (client check on the server-computed permission list, not the role name) + `sales.pos` (server `EnsureApplicationActive`; the page also stops at `/applications/nav-state`) | only if the user holds the permission and the page is allowed |
| `GET /branches` | `branches.view` | only if the user holds it **and** at least one displayed point is routed to a branch; sequential, after the first read |

Zero new permissions, endpoints, tables or migrations. Every call is a plain GET (the structural test rejects any options argument). DP-E unchanged.

## 5. Tenant isolation and branch scoping — proof

- **Server (existing, now pinned by a test).** `DeliveryConnectorAccount` is tenant-scoped through `BaseModel`; `index()` filters `whereIn('branch_id', allowedBranchIds())` for branch-restricted users (so a restricted user does not see rows routed to other branches, nor unrouted rows). The new PHP test registers a tenant with two branches and three accounts and asserts: 3 rows for an unrestricted admin; a branch-restricted admin sees only the first-branch account; staff/accountant/self_service get 403; POS app `disabled` → 403, `suspended` → 200 (read allowed), `enabled` → 200. Existing tests in the same file already cover cross-tenant invisibility.
- **UI.** The client never widens anything: it renders what the server returned for the platform key, ignores rows of other platforms, and treats any malformed envelope as "could not be read".
- **Branch names.** Shown only with `branches.view` and only from the server's authorized `/branches` list. Without the permission the cell is the neutral «موجّهة إلى فرع» (no name, no id, no alternative source); with the permission but a branch missing from the list the cell is «غير متاح» — the id is never shown or guessed. Unit, component and e2e tests assert the name and `br-1` are absent from the panel DOM for a connector-only viewer.

## 6. No-secret proof

The reader is an **allow-list**: it copies only `external_store_id`, `branch_id`, `status`, `secret_version`, `created_at`, `disabled_at` (and uses `id` as a React key only). `secret_prefix`, `configured_by`, `operated_by`, `delivery_platform_profile_id`, and any unexpected field (`secret`, `token`, `signing_key`) never enter state, props or DOM. Evidence:
1. Unit test: a row carrying sentinel values in all those fields → the serialized result contains none of them.
2. Component test: sentinel strings absent from `document.body.innerHTML`, and `secret_prefix`/`configured_by`/`operated_by` absent as attribute names.
3. e2e (real browser, both locales × themes × desktop/mobile): sentinels in the mocked payload; `page.content()` contains none. Screenshots therefore contain none.
4. Structural test: comment-stripped source of the module cannot reference `secret_prefix`, `signing_key`, `.secret`, `token` or `authorization`.
5. No logging, tooltips, `title` attributes or analytics were added.

## 7. Test matrix and results

| Area | Evidence |
|---|---|
| No read without `delivery_connector.view` | component + e2e: accountant → panel absent, zero `/delivery-connectors` requests; PHP: staff/accountant/self_service 403 |
| Blocked when `sales.pos` disabled | component + e2e: only `/applications/nav-state` requested, no panel; PHP: disabled → 403 |
| `branches.view` respected | component + e2e: no `/branches` request without it; neutral text; no name/id in panel DOM |
| Branch-restricted user | PHP (restricted admin sees one account); component (subset renders as returned) |
| Tenant isolation | PHP (existing + list shape); allow-list reader ignores other platforms |
| Empty vs error vs 403 | distinct states; failure, 500, non-list, malformed row, malformed envelope all → error + retry, **never** empty; 403 → "not available to you" note, never empty |
| Loading | skeleton with `role=status`, e2e screenshot |
| Retry | single button; re-reads only the panel; recovers; keyboard focus + visible focus ring (e2e) |
| Permission lost mid-session | component: after retry the panel disappears with no request |
| No write calls / no controls | every request has no options argument; panel has 0 buttons in the success state, 1 (retry) in error |
| Wording | forbidden phrases absent AR/EN; approved term; boundary notes present; configured badge not green |
| Responsive / theme / RTL | e2e: AR RTL + EN LTR × light/dark × desktop 1440 / mobile 390; one layout per viewport; no horizontal overflow, including 15 long ids; AA contrast ≥ 4.5 on title, notes, cells, badge |
| INT-UX-1/2/3 unaffected | their vitest suites pass; Playwright INT-UX-1 + INT-UX-2 specs re-run |

**Narrow update to a guard test.** `no-connection-controls.test.ts` used to forbid `delivery-connectors` anywhere and to expect exactly three endpoints. It now allows exactly the literal GET `api('/delivery-connectors')` and `api('/branches')` **in `use-signed-ingress.ts` only**, and every other prohibition stays (no writes, no raw button/form/input, only the retry button, no connect/sync/disable/rotate/oauth/credential strings, link allow-list). Added: all calls must be option-less GETs; the two paths may be touched by that one file only; no secret-bearing field may be read.

Exact results (this environment):
- Related Vitest (integrations + lib): 7 files / 190 tests passed.
- **Full Vitest: 548 files / 5971 tests passed.**
- `npm run build`: succeeded.
- Playwright `int-ux-4-signed-ingress.spec.ts`: **48 / 48 passed** (desktop + mobile).
- Playwright `int-ux-1` + `int-ux-2`: 150 passed, 1 failed — `int-ux-1 › states › summary error keeps the card usable (ar/light)` on mobile. This is the **pre-existing flake** (`getByRole('alert')` also matching Next's empty route announcer) that was proven earlier on clean `main` (fail/pass/fail) and deliberately not fixed in these PRs. Unrelated to this slice.
- **PHP test not run locally** (no runnable backend here; `php -l` only). It runs in CI (sqlite + pgsql); no claim about it is made until observed there.

## 8. Build and CI

Local build passed. CI status is **not claimed here**; see the PR and the final message for what was observed on the exact head SHA.

## 9. Visual verification

- **Research (honest limits).** Time-boxed pass over public documentation UI for read-only integration/webhook endpoint lists (GitHub webhooks, Salla). Shopify's desktop page returned 403 (Cloudflare), and GitHub's docs exposed no inline screenshots, so the research is limited to public docs and observed structure — not a full visual survey. Adopted: a plain table of endpoints with a neutral status chip and the technical identifier in a monospace, left-to-right cell; explicit "this is not a connection" copy next to it. Rejected: green "active/connected" chips, health/"last delivery" columns and any action menu (would imply a connection or management).
- **Real-browser verification.** Chromium via Playwright, screenshots reviewed for AR-light desktop, EN-dark mobile, AR-light mobile error, EN-dark desktop with 15 rows. Findings: clean hierarchy under the existing note, store IDs left-to-right inside RTL, no overflow with long IDs, readable dark theme, retry reachable by keyboard. A red "N Issues" chip appears in the screenshots: it is the Next.js **dev-server** indicator, not part of the product UI.
- Observation (out of scope, not changed): the app shell's branch switcher requests `/branches` on its own regardless of the panel; the e2e scopes the "no branch name" assertion to the panel for that reason.

## 10. Risks and remaining work

- Server test unverified until CI runs it.
- The panel shows what a user with `delivery_connector.view` may already read through the API; hiding it elsewhere is not protection (the server remains the authority). Owner/admin only by existing RBAC (DP-E unchanged).
- A tenant whose **only** points are routed outside the user's branch scope sees the empty state; the copy says points may exist outside the user's scope, so it does not assert "none exist".
- Operator/configurer names and ingress id are intentionally not shown (no approved source/need). If wanted later it needs a separate decision.
- Provider-store ↔ branch mapping (INT-MAP-1), ingress management (INT-UX-5 behind INT-AUDIT-1) and native integrations remain untouched.
- Existing, unrelated: the INT-UX-1 flake above (backlog: assert by test id).

## 11. Git state

- Branch: `feat/int-ux-4-signed-ingress-readonly`
- Base: `main` @ `c96593e37a02c32ad03f2901ae36ea62c2ff4344`
- PR and head SHA: in the PR and the final message (a report cannot embed the hash of the commit that contains it).

## 12. PRE_MERGE status

Pending: CI on the exact head SHA, owner review. Nothing merged, nothing deployed, no production release.

## 13. Next step

Owner review of this PR. After it: INT-AUDIT-1 is the hard prerequisite for any ingress management (INT-UX-5); INT-MAP-1 stays blocked on its own decisions.
