# AC-UX-HZ-01 — Final Report (Users, Roles, Permissions & Scope Management)

**Horizon:** Access Control Administration & Permission-Aware UX
**Closure base:** `main` @ `e972e5ba949a57c3716b53d6bd75894c7e262989` (AC-UX-09 merged)
**Inspection base (AC-UX-00):** `main` @ `5ff31353272f8e1cf0dc153d90c6bd860cfc4982`
**Deploy status:** **NOT DEPLOYED.** This horizon had merge authority only — no deploy, no Railway, no production migration or configuration change was made or requested.

Companions: [MASTER-PLAN](./AC-UX-HZ-01-MASTER-PLAN.md) · [TASK-QUEUE](./AC-UX-HZ-01-TASK-QUEUE.md) · [CURRENT-STATE](./AC-UX-HZ-01-CURRENT-STATE.md) · canonical reference [AWJ_USERS_ROLES_PERMISSIONS_DAFTRA_REFERENCE](./AWJ_USERS_ROLES_PERMISSIONS_DAFTRA_REFERENCE.md).

---

## 1. Outcome

| Before | After |
|---|---|
| Users and Roles were two tabs inside the HR page; permissions shown as a flat chip wall under raw keys (101 of 134 keys untranslated); empty branch/warehouse scope looked like "none"; delete had no confirmation and a failed delete still toasted success; deactivation carried no explanation | Dedicated **`/users`** and **`/roles`** workspaces with permission-gated nav, view-only modes, side-sheet editors, explicit **All / Selected** scope with plain-language summaries, grouped/searchable/risk-labelled permission catalogue with full AR/EN coverage, confirmations that state consequences, honest error states, a read-only **access summary**, a legible treasury deposit/withdraw rule editor, one shared **`useCan`** capability helper with a live `/me` refresh, and a QA matrix guarding all of it |
| `users.manage` / `roles.manage` holders could escalate (F-1, F-2, F-4 — owner-classified **High**) | Closed server-side by **AC-UX-00A** before any UI shipped; negative tests on sqlite + pgsql |

---

## 2. Slices delivered (squash-merged, one PR each, always from fresh `origin/main`)

| Slice | What | PR | Merge SHA |
|---|---|---|---|
| 00 | Baseline inspection, UX contract, execution docs | #1460 | `58582ce` |
| **00A** | **Grant boundaries (backend, owner-mandated)**: scope ceiling, role grant ceiling, target ceiling, `roles.manage` role-definition ceiling | #1462 | `f1b7031` |
| 01 | Users workspace V2 (`/users`) | #1465 | `cc30b53` |
| 02 | User editor sheet + access scope | #1466 | `8c9f411` |
| 03A | Roles workspace shell + catalogue (`/roles`) | #1467 | `cd72408` |
| 03B | Role editing, risk map, unsaved guard | #1468 | `db93a70` |
| 04 | Role create + safe client-side clone | #1469 | `f147fb6` |
| 05 | Shared scope editor + summary language | #1471 | `7e8af03` |
| 06 | Treasury deposit/withdraw access legibility | #1475 | `beaa6bf` |
| 07 | `useCan` capability helper + live `/me` refresh | #1480 | `f1bcc67` |
| 08 | Read-only per-user access summary | #1481 | `23c1dd3` |
| 09 | Keyboard / RTL / responsive / theme QA + focus restore | #1484 | `e972e5b` |
| 10 | Closure + this report | #1486 | `757a7a3` |

Every slice's PR body carries the full implementation report (baseline, scope, contracts, security invariants, tests, visual verification, backward compatibility, risks, **NOT DEPLOYED**, next slice).

---

## 3. Closure verification

### 3.1 Scope audit (what the horizon actually touched)
Computed per merge commit (`git show --name-only <sha>`), not from the raw range, because `main` also carried unrelated work during the horizon:

- **Backend files changed in the whole horizon: 5, all in 00A** — `RoleController.php`, `UserController.php`, `Rbac.php` (one pure `Rbac::covers()` helper), `RoleGrantBoundaryTest.php`, `UserGrantBoundaryTest.php`.
- **Migrations: 0** in every slice. **Workflow / deploy / Railway files: 0.** **Accounting, ledger, invoice, ZATCA, tax files: 0.**
- Slices 00–01…09 otherwise change only `web/**` and `docs/plans/access-control/**`.

### 3.2 Backend regression matrix (run on `main` @ `e972e5b`, sqlite)
`php artisan test --filter=` over: `RoleGrantBoundaryTest`, `UserGrantBoundaryTest`, `RoleTest`, `UserManagementTest`, `UserAccessScopeTest`, `UserEmployeeLinkTest`, `UserInvitationTest`, `UserRequestIdempotencyTest`, `Rem08DeactivatedUserAccessTest`, `ApiRbacTest`, `Rem37ZatcaSubmitPermissionTest`, `ReportEffectiveScopeTest`, `LegacyInventoryWarehouseScopeTest`
→ **149 passed (1447 assertions)**. The full backend suite ran on sqlite **and** PostgreSQL in CI on every PR's exact head.

### 3.3 Frontend verification (run on `main` @ `e972e5b`)
- `vitest`: **612 files / 6767 tests passed.**
- `npm run build`: passes (also green in Web CI on every PR).
- Playwright `ac-ux-01` … `ac-ux-09` (desktop 1440 + mobile 390, AR/EN, light/dark/Ink where applicable): **177 passed, 60 skipped, 1 failed** in one 8-minute run. The 60 skips are by design (the AC-UX-09 matrix runs only on the `desktop` project and sets its own viewports, so its `mobile`-project instances skip). The single failure was the **first page load of the run** — the cold `next dev` compile of `/users` exceeded the 5 s heading assertion in `ac-ux-02`'s first test; the same spec re-run on its own passed **18/18**, so it is a cold-start timing artefact, not a behaviour regression.

### 3.4 Visual verification
Per slice, screenshots were reviewed (AR desktop, EN desktop, AR mobile, dark; Ink in 09) and not committed. AC-UX-09 turned this into a regression guard: `{users, roles} × {1440, 1280, 768, 390} × {EN, AR} × {light, dark, Ink}` asserts heading, `rtl`, applied theme, **no horizontal overflow**, and an accessible name on every visible interactive control in the main content (with a self-test proving the audit really flags an unnamed control).

---

## 4. Security & contract invariants (verified, not assumed)

| Invariant | Evidence |
|---|---|
| UI hiding is never the security boundary | Every mutation still passes through the server's `EnsurePermission` + 00A ceilings; the UI shows less-or-equal to what the server computed and always renders the server's refusal message |
| Privilege-escalation chain closed (F-1/F-2/F-4) | 00A rules 1–3b + executable negative tests (self-unrestriction, out-of-scope assignment, create-without-scope, self-admin, target takeover by password reset, `roles.manage` self-expansion, cross-tenant, warehouse parity) |
| Empty branch/warehouse assignment = unrestricted | Shown everywhere as **"All"**, never "none" (01, 02, 05, 08); "Selected" with nothing ticked is refused before any request; `scopePayload` never sends an accidental empty array; "no branches" state is not offered |
| `?branch=all` / owner-admin `*` / canonical permission keys | Untouched. Keys are treated as **opaque** (never split or reconstructed to decide anything); grouping/labels are display-only with a humanised fallback for unknown keys |
| REM-03/03b, REM-08, REM-37, treasury ACL, inventory/report scopes | Not modified; their backend suites are in the matrix above and pass |
| Tenant isolation | No change; cross-tenant mutation negative tests retained |
| Treasury rule semantics | `CashBankAccount::allows` unchanged — the form now states honestly that the rule applies **on top of** role permissions, that **owners/admins are not exempt**, and that `Branch` = the branch active at operation time |
| Permission refresh safety | `/me` refresh adopts only `role` + `permissions`, only for the **same user id**, only when a list is present and changed; failure/other-user responses never touch storage |
| D-J per-input degradation | Every lookup (`roles`/`users`/`hr`/`branches`/`products`) is requested only by viewers who hold its gating permission — no request known in advance to 403; saved values are kept and never lost on save; verified at component, page and e2e levels |

---

## 5. Defects found *by the horizon itself* and fixed

| Defect | Slice |
|---|---|
| Delete had no confirmation and a failed delete still showed "deleted" (U-2) | 01 |
| Raw `role-xxxxxxxx` slugs and untranslated roles shown as names (U-3/U-3a) — now name → system translation → "Custom role", never a slug | 01 |
| Owner-role user opened an editor whose `<select>` had no matching option (U-6) | 02 |
| 101/134 permission keys rendered under raw module keys; 3 terminal actions untranslated (P-1) | 03A |
| HR tab visibility and login-access gated by role **name** instead of the computed permission list (U-1) | 01, 07 |
| Stale session permissions after a role edit (P-2) | 07 |
| Side-sheet close dropped keyboard focus to `<body>` (found by the AC-UX-09 keyboard test) | 09 |
| HR flow saves the employee before the login, so a scope-limited actor's login grant could be rejected after the employee was already saved; the editor now takes the actor's own scope up front and does not offer an "All" it cannot grant (surfaced over several review rounds on #1471) | 05 |

---

## 6. Accepted residuals and known limits (stated, not hidden)

1. **(Resolved by the AC-UX-11 follow-up — see §10.)** **#1471 residual — own scope unknown for a restricted actor without `users.view`.** The editor learns the actor's own stored scope from the actor's row in `GET /users`. A branch/warehouse-restricted actor who holds `users.manage`/`hr.manage` but **not** `users.view` cannot read that row, so the UI treats the scope as *unknown* and **blocks granting login access** from the HR flow rather than guess. Safe (fail-closed, and the server enforces 00A regardless); the cost is a missing capability for that unusual role shape. → see Owner decision **O-1**.
2. **HR org-structure tab stays owner/admin by role name.** The default accountant holds `hr.manage` and never saw that tab; widening it is a product decision, not a technical fix (07). → **O-4**.
3. **Remaining direct `hasPermission` importers** (commerce and POS route groups, a few non-React helpers) were not migrated to `useCan` to avoid a broad refactor. They are listed in `capabilities.guard.test.ts`, which fails on any **new** importer and on stale entries — the list can only shrink.
4. **`GET /users` is unpaginated** (U-8): `enterprise`/`users: null` tenants have no cap; the table filters/sorts client-side. → **O-2** (API change).
5. **Roles name for viewers with `users.view` but not `roles.view`** relies on the UI fallback chain; a renamed *system* role shows its built-in translation for such viewers. → **O-3** (additive field).
6. **Accessibility QA is structural, not a full WCAG scan:** the accessible-name audit is scoped to `#main-content` (shell chrome is shared ERP-wide), no axe dependency was added, and contrast was reviewed visually per theme rather than computed.
7. **00A documented residuals:** a scope-restricted actor can still *narrow* the scope of a lower-role user inside their own ceiling, and a `roles.manage` holder can narrow roles inside their ceiling (reductions only). `users.manage` / `roles.manage` remain the highest-risk permission class and are labelled so in the role editor.
8. **Data already on screen is not refetched** when a permission changes mid-session; nav and actions re-render immediately and the server remains authoritative for every request.

---

## 7. Owner decisions requested

| ID | Decision | Recommendation | Cost / note |
|---|---|---|---|
| **O-1** — ✅ **approved 2026-10-14, delivered in AC-UX-11 (§10)** | Expose the actor's **own** branch/warehouse scope on `/me` (additive field) | **Yes** — removes residual 6.1 and the "unknown scope" fail-closed path; also lets the editor stop inferring scope from the users list | **Backend/API change** (additive, non-breaking); needs PostgreSQL tests; not authorised in this horizon |
| O-2 | Server-side pagination/search for `/users` | Only when a large tenant appears | API change (D-D) |
| O-3 | Additive `role_name` on `UserResource` | Only if the fallback chain proves inadequate | Non-breaking (D-H) |
| O-4 | Show the HR org-structure tab by permission (`hr.manage`) instead of owner/admin | Product call; default accountants would newly see it | UI-only |
| O-5 | Deep link `/roles?role=<id>` so "Open roles" in the access summary lands on that role | Nice-to-have | UI-only |

---

## 8. `AC-UX-FUTURE` — decision packets only (nothing implemented)

None of these is built, stubbed or implied by the UI. Each needs an owner/ADR decision first because it adds a **new authority model**, which the horizon's STOP register forbids guessing.

| Item | The question the owner must answer first |
|---|---|
| Segregation of duties / approval chains | Which action pairs are mutually exclusive, and is it enforced at grant time, action time, or both? |
| Record scope · own / assigned / created-by | What is the ownership field per document type, and what does "assigned" mean for each? |
| ABAC / deny rules / inheritance | Is a deny model wanted at all given the current additive RBAC, and how do denies interact with `*`? |
| Customer ownership · manager hierarchy | Which entities are ownable and does visibility cascade up a reporting line? |
| New scope meanings (beyond branch/warehouse) | Which dimension, with what empty-assignment semantics (the "empty = unrestricted" rule must not be reused silently)? |
| Unified activity log · recycle-bin security · permanent delete | Who may read it, and how is it kept from becoming a cross-module data side-channel? |
| Dependency-driven authorization | Should granting one permission imply others, and where is that graph owned? |

---

## 9. Definition of done — checklist

- [x] Users, Roles and scope are usable, legible and safe: dedicated workspaces, side-sheet editors, All/Selected scope, access summary, treasury rule editor
- [x] Escalation chain closed server-side before any UI mutation shipped (00A)
- [x] One capability helper (`useCan`) with a live `/me` refresh and a ratchet against drift
- [x] AR/EN complete, RTL-first, light/dark/Ink, 1440/1280/768/390, loading/empty/error/no-permission states, keyboard + focus
- [x] Backend regression matrix and full frontend suite green on the closure head; CI green on every slice's exact head
- [x] No migration · no API break · no authorization weakening · no financial/TAX/ZATCA change · tenant isolation intact · backward-compatible
- [x] Every slice: PR report, exact-head CI, no unresolved thread, squash-merged, SHA recorded
- [x] **Nothing deployed**

---

## 10. Follow-up: AC-UX-11 — own scope on `/me` (owner decision O-1, approved 2026-10-14)

Delivered as a separate small slice from fresh `main` (base `f509929`), under the existing Access Control follow-up authority. **NOT DEPLOYED.**

- **Backend (additive, `/me` only):** `user.branch_ids` and `user.warehouse_ids` — the authenticated actor's **own** stored assignments. **Empty array = unrestricted**, exactly as in `GET /users` (the raw relation is read, not `allowedBranchIds()`, so "unrestricted" can never be mistaken for "unknown"). No other user's scope is exposed; no `users.view` is required; the relations go through the tenant global scope, so a stray pivot row pointing at another tenant's branch/warehouse is never returned. `/login` is unchanged. No migration; no authorization, permission, tenant-isolation or grant-boundary logic touched.
- **Frontend:** a new `useActorScope()` reads the scope from the stored user (filled by the shell's `/me` refresh) or fetches `/me` once (shared in-flight request); `null` = could not be read, never "unrestricted". Users page, HR page and the employee page no longer infer the scope from `GET /users`; the `canReadActorScope` escape hatch in the employee dialog is **removed** (an unreadable scope now blocks granting login for everyone, uniformly).
- **Tests:** `MeActorScopeTest` (15: unrestricted / branch / warehouse / both, no `users.view`, `users.manage` + `hr.manage`, no leakage of other users' scope, cross-tenant + corrupted-pivot isolation, backward-compatible `/me`, `/login` unchanged, no authorization change, 401) — passes on sqlite **and on a real PostgreSQL 16** locally, and in the CI pgsql job (which runs the whole suite); frontend unit + e2e coverage as listed in the PR.
- **Still deliberately open (new, small): O-6.** The HR login-access section still requires `users.view` **and** `users.manage` (it also reads `GET /users` to show whether an employee already has a login). A role holding `users.manage`/`hr.manage` **without** `users.view` therefore still cannot grant login from the HR screen even though the scope is now known. Relaxing that needs a decision on how the dialog should behave when it cannot see existing logins; it is not part of O-1.

