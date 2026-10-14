# AC-UX-HZ-01 — Master Plan

**Horizon:** Access Control Administration & Permission-Aware UX
**Independent of:** the TAX/ZATCA horizon (do not touch its backlog or docs).
**Execution docs only.** The canonical functional/security reference stays
[`AWJ_USERS_ROLES_PERMISSIONS_DAFTRA_REFERENCE.md`](./AWJ_USERS_ROLES_PERMISSIONS_DAFTRA_REFERENCE.md); inspected facts live in
[`AC-UX-HZ-01-CURRENT-STATE.md`](./AC-UX-HZ-01-CURRENT-STATE.md); status in [`AC-UX-HZ-01-TASK-QUEUE.md`](./AC-UX-HZ-01-TASK-QUEUE.md).

---

## 1. Posture

- **Backend authorization is authoritative.** UI hiding is never the security boundary. No slice weakens, widens, or reinterprets any server check.
- **No rebuild.** Access Control V2 backend is complete; this horizon is UI/UX over existing contracts.
- **Priority order:** Tenant Isolation → Security → Accounting invariants → Backward compatibility → Existing API contracts → Data integrity → UX → density → consistency → polish.
- **Design system:** AWJ Design System **v3** (semantic tokens only, no new tokens, no parallel system, v3/legacy gate untouched). Authority: code+tests → v3 → `DESIGN_SYSTEM.md` → older plans → `CLAUDE.md` invariants override visuals.
- **MERGE ≠ DEPLOY.** No deploy, Railway, production config, or production migration.

### Non-negotiable contracts carried into every slice

| Contract | UI consequence |
|---|---|
| Empty `branch_ids`/`warehouse_ids` = **unrestricted** | The editor models **All / Selected** explicitly. "Selected" with zero ticked is **not saveable** (it would serialize to `[]` = all). There is no "no access" state — requesting one is a STOP. |
| `?branch=all` = all branches *allowed to the user* | Copy never says "all branches of the company" for a restricted user. |
| Owner/admin `*` | Shown as "Full access". Role writes never include `*`. Owner role is read-only. |
| Exact canonical permission key is opaque | Grouping/labels/risk are display-only derivations; the original string is the only stored/compared/submitted value (`role-dialog.test.tsx` contract is preserved and extended). |
| Deactivation ≠ employee deletion | Copy states: login and API access stop and tokens are revoked; the employee record and history are unchanged. |
| REM-03/03b, REM-08, REM-37, treasury ACL, inventory/report scopes, POS/Fuel actor propagation | Not reopened. |

---

## 2. Slice plan

One PR per slice, always branched from fresh `origin/main`, never stacked on an unmerged branch.

| Slice | Scope (summary) | Branch | Backend change? |
|---|---|---|---|
| **AC-UX-00** | Baseline inspection, UX contract, three execution docs, small doc corrections | `feat/access-control/ac-ux-00-baseline` | none |
| **AC-UX-01** | Users workspace V2: dense DataTable, filters, status semantics, lifecycle actions with confirmations, mobile records, real error states | `feat/access-control/ac-ux-01-users-workspace` | none |
| **AC-UX-02** | User editor (Sheet), identity/status/role/scope sections, effective-access summary before save | `feat/access-control/ac-ux-02-user-scope-editor` | none |
| **AC-UX-03A** | Roles workspace shell: master/detail, role rail, permission catalogue (grouped, searchable, read) | `feat/access-control/ac-ux-03a-role-workspace-shell` | none |
| **AC-UX-03B** | Role editing: selection model, group select, risk treatment, dirty-state, unsaved guard, system-role messaging | `feat/access-control/ac-ux-03b-role-editing` | none |
| **AC-UX-04** | Role create + client-side clone (name + permissions only) | `feat/access-control/ac-ux-04-role-clone` | none (verified: plain `POST /roles` suffices) |
| **AC-UX-05** | Shared scope-editor component + summary language; adopt in Users | `feat/access-control/ac-ux-05-scope-ux` | none |
| **AC-UX-06** | Treasury deposit/withdraw access made legible on the existing account form | `feat/access-control/ac-ux-06-treasury-access` | none |
| **AC-UX-07** | Capability helper + hidden/read-only/disabled/allowed states on high-value screens; `/me` refresh | `feat/access-control/ac-ux-07-permission-aware` | none |
| **AC-UX-08** | Per-user access summary from source assignments only | `feat/access-control/ac-ux-08-access-summary` | none |
| **AC-UX-09** | Keyboard / RTL / responsive / dark / states QA with existing Playwright | `feat/access-control/ac-ux-09-a11y-visual-qa` | none |
| **AC-UX-10** | Closure verification + `AC-UX-HZ-01-FINAL-REPORT.md` | `feat/access-control/ac-ux-10-closure` | none |

If a slice would exceed a coherent reviewable size it is split (03 is already pre-split).

Per-PR requirements: implementation report in the PR body (template from the horizon brief), `NOT DEPLOYED` stated, `CURRENT-STATE` updated only **after** merge with the real Merge SHA.

---

## 3. Information architecture (D)

### Findings that drive it
- Users/Roles are today **tabs inside HR**, gated by role *name*. HR's tab model suits employee-adjacent work; but users/roles are gated by `users.*`/`roles.*`, not `hr.*`, are required by non-HR administrators, and a 134-permission editor does not fit a tab body.
- Scope data (branches/warehouses) belongs to **a user**; treasury access belongs to **an account**. A standalone "Scopes" area would duplicate both and invent a place to edit data that has an owner already.
- The sidebar already groups **settings**-type entries and supports per-item `permission` (`hasPermission`) — no new mechanism needed.

### Decision `[DECIDED — reversible, within horizon authority]` (D-C)

```
Settings (existing sidebar group "settings"; NO new group, NO new section)
├─ Users               /users          permission: users.view
└─ Roles & Permissions /roles          permission: roles.view
```

- **Scopes / Access is not a third top-level destination.** Scope is edited inside the Users editor (AC-UX-02/05) and surfaced read-only in the access summary (AC-UX-08). Treasury access stays on the cash-and-bank account form (AC-UX-06).
- `/hr?tab=users` and `/hr?tab=roles` **keep working** (redirect to `/users` / `/roles`) so bookmarks and the "link a user from an employee" flow do not break. The HR tabs are removed only when the redirect ships.
- `EmployeeDialog`'s unified "employee + login" creation flow is **untouched** (Employee ⊃ User lifecycle separation preserved); the Users workspace links to employees (`/hr/employees/{id}`) and never deletes them.
- Sidebar gating switches from role-name to `users.view` / `roles.view`. Route-level pages also check the permission and render a proper "no access" state (the API remains the authority).
- **Each workspace slice gates its own mutating controls** (see §4.8); AC-UX-07 consolidates the helper and extends to the rest of the ERP, it does not retrofit these two screens.
- Introduced in **AC-UX-01** (Users) and **AC-UX-03A** (Roles). If AC-UX-01 discovers a concrete reason this is wrong (e.g. a canonical-structure conflict), it falls back to keeping the tabs and gating them by permission — this is recorded, not silently chosen.

---

## 4. UX acceptance spec (E)

Applies to every Access Control screen. A slice's checklist is the relevant subset.

### 4.1 Global
- v3 semantic tokens only (`bg-surface`, `text-muted`, `border-border`, status tokens via existing Tailwind aliases); **no** hex/rgb, `rounded-[…]`, `shadow-[…]`, `text-[<12px]`. Lucide icons, no decorative icon tiles, no gradients, no entrance animation.
- Logical CSS properties only (RTL-first): `ms-/me-/ps-/pe-/start-/end-`, mirrored chevrons, numbers/emails/keys isolated (`dir="ltr"` / `.num`).
- Every user-visible string in **both** `ar.json` and `en.json` via next-intl; no dotted-invalid keys; no hard-coded copy.
- Every main surface has explicit **loading, empty, no-results, error + retry**. Errors are never swallowed into "empty".
- State never conveyed by colour alone (text + icon/shape + `aria-label`).
- No local state that can become permission authority; admin queries re-fetch after every mutation; nothing permission-bearing is cached across logout/login/tenant switch (reuse existing auth invalidation).

### 4.2 Desktop (≥1280, verify 1440)
- **Users:** DataTable, row ≈ 40–48px per v3 grid tokens, sticky header, columns: identity (name+email 2-line), employee link, role (name per D-H fallback: system translation → /roles name only if `roles.view` → "Custom role"; never the raw slug), status (text+indicator), branch scope summary, warehouse scope summary, row actions (≤2 icon actions + ⋯). Search + status/role filters + result count. 1280×720 shows ≥ 6 rows.
- **Roles:** master/detail — role rail (name, system/custom, users count, permission count) + detail pane (identity, permission catalogue, sensitive summary, assigned-users count). No giant undifferentiated checkbox wall; ≤ 3 nesting levels (module → area → permission).
- Editors use Sheet/workspace (not a small modal) when they hold role + scopes or the catalogue.
- Footer/toolbar for dirty state: **Save**, **Reset/Cancel**, unsaved-changes guard on navigation/close.

### 4.3 Tablet (~768)
- Rail collapses to a selector above the detail; table keeps identity + status + actions, other columns move to row expansion/Sheet; no horizontal **page** scroll (internal scroll only inside a grid, per v3).

### 4.4 Mobile (~390)
- DataTable renders `mobileRecord` cards (v3 rule): identity, role, status chip, scope summaries, primary action; touch targets ≥ 44px; row actions visible without hover.
- Editors become full-screen sheets with sticky action bar; permission catalogue is a single-column list with sticky search.

### 4.5 Keyboard & a11y
- Everything reachable in logical order; visible focus ring (existing v3 focus token); dialogs/sheets trap focus and restore it on close; Escape closes only when there is nothing unsaved (otherwise confirms).
- Permission rows are real checkboxes (label + description + risk text associated via `aria-describedby`); group toggles have tri-state (`aria-checked="mixed"`); live region announces selected counts.
- Destructive/high-impact actions require explicit confirmation naming the consequence.

### 4.6 Themes
- Light/Dark × Default/Ink where the product supports them, verified in AC-UX-09 with existing Playwright infrastructure (no new visual-regression framework; screenshots reviewed, not committed).

### 4.8 Permission gating inside the workspaces (not deferred to AC-UX-07)
- A viewer with only `users.view` / `roles.view` gets a **read-only** workspace: no create / edit / activate-deactivate / delete / invite / scope-edit controls are rendered (or, where discoverability matters, they are disabled with a reason). Controls are keyed to `users.manage` / `roles.manage` via the existing `hasPermission` mirror (`lib/permissions.ts`); no new raw-string helper is introduced before 07.
- Corollary: AC-UX-01 and AC-UX-03A/03B each ship with tests for the three viewer types — `*`, manage-holder, view-only — and a test that the 403 path (stale client / direct API) surfaces a proper error, not a success toast.
- Backend remains authoritative; this gating is purely to stop offering actions that will 403.

### 4.7 Semantics-specific
- **Status:** "Active" / "Inactive" text + indicator; deactivation dialog states: login & API access stop, active tokens are revoked, employee record and history are unchanged, can be reactivated (re-login required).
- **Scope:** `All branches` · `3 branches` · `Dammam +2`; never a chip wall in tables; editor = `All` / `Selected` radio; `Selected` with zero ticks disables Save with an inline reason; copy says what an unrestricted assignment means. Lists limited by the viewer's own scope are labelled as such (F-3).
- **Sensitive permissions:** risk label + icon + text (not red-only), exact key available in secondary detail/tooltip; summary count of sensitive permissions selected.
- **System roles:** no active delete action; immutability explained in text; owner read-only; editing a wildcard system role warns that `*` becomes an explicit list.
- **Role changes** warn "applies immediately to N users".

---

## 5. Decision register

| ID | Question | Default adopted (no owner action needed unless disagreed) | Escalation |
|---|---|---|---|
| D-A | F-1: branch-restricted `users.manage` actor can clear/widen scope (and F-2: role escalation to `admin`) | **Not fixed in this horizon.** UI performs no client-side attempt to compensate. | **Owner decision packet — see §6.** |
| D-B | Where does permission label/risk/group metadata live? | Frontend presentation map keyed by exact canonical key (display-only), with a drift test against `Rbac::PERMISSIONS` so an unclassified/unknown key degrades to a neutral standard row, never to a hidden or mis-submitted one. | Additive backend field (`meta.permission_meta`) only on owner request. |
| D-C | IA | §3 | Reversible; recorded in AC-UX-01. |
| D-D | Users list scale | No server pagination/search exists and enterprise / `users: null` tenants are **unbounded**. AC-UX-01 stays on the existing API but mitigates: render with the existing DataTable (client-side search/filter), keep rows lightweight (no per-row fetches), apply a visible row-count and degrade gracefully (no eager rendering of hidden detail; windowed/"show more" rendering if the list exceeds a threshold chosen in 01 and measured). The accepted residual risk is the unbounded payload itself. | Server pagination/search = API change → owner decision; recommended if a tenant exceeds a few hundred users. |
| D-H | Role display name when the viewer has `users.view` but not `roles.view` | UI fallback chain, no backend change: (1) system-role translation (`owner/admin/accountant/staff/self_service`); (2) display name from `GET /roles` only when the viewer holds `roles.view` (never request it otherwise — no 403 noise); (3) otherwise a neutral "Custom role" label. The raw `role-xxxxxxxx` slug is never shown as a name. Role **filter** is offered only when names are resolvable. | Additive `role_name` on `UserResource` (non-breaking) removes the limitation — owner approval requested only if the fallback proves inadequate. |
| D-E | Role clone | Client-side prefill → ordinary `POST /roles`; source never mutated. Verified feasible: `POST /roles` takes `name + permissions` and nothing else. | none |
| D-F | "No branches/warehouses" state | **Not offered.** | STOP #2 if requested. |
| D-G | Effective permission preview | Source assignments only (role name, stored scopes, role's explicit permission list, sensitive subset). No client-side authorization engine. | STOP #6/#7 if more is wanted. |

---

## 6. Decision packet — D-A (needs Safwan; not blocking slices 00–10)

**Evidence (current `main`, probe not committed):** a custom role `{users.view, users.manage, branches.view}` assigned to a user scoped to branch A can, via `PUT /api/users/{self}`: `{branch_ids: []}` → 200 and becomes unrestricted; `{branch_ids:[A,B]}` → 200 and gains branch B. `guardOwnerRole` blocks only the `owner` role (so such an actor can also self-assign `admin` = `*`). Owner/admin users are normally unrestricted, which is why this has not surfaced; it needs a non-owner/admin `users.manage` holder that is itself scope-restricted.

**Why the horizon cannot fix it:** any server-side containment (actor ⊆ target scope; restricted actors cannot clear scope; role-assignment ceiling) is **new backend authority** — STOP condition #11, and it touches the empty=unrestricted contract (#2-adjacent).

**Options**

| | Option | Trade-off |
|---|---|---|
| 1 | **Document-only; treat `users.manage`/`roles.manage` as root-equivalent** and show them with top risk treatment ("security administration") + warn when assigning them to a scope-restricted role. | Zero backend risk; relies on administrators; matches current product assumption ("owner/admin only"). **Recommended for this horizon.** |
| 2 | Small separate backend PR: a scope-restricted actor may only assign scopes ⊆ own scope, cannot clear their own, and cannot assign a role with permissions outside their own. | Closes F-1/F-2; needs tests on sqlite+pgsql and a backward-compat review (owner/admin unaffected). Requires explicit approval. |
| 3 | Option 2 plus forbidding `users.manage` on any scope-restricted role at the role-assignment level. | Strongest; changes existing assignment semantics — highest compat risk. |

Until the owner chooses, AC-UX-01…10 proceed on Option 1 behaviour.

---

## 7. STOP register (restated for execution)

Stop and ask Safwan (do not guess, do not implement) on any need for: DB migration · changing empty-assignment semantics · changing owner/admin wildcard · Tenant Isolation change · deny/inheritance model · record-scope semantics · ABAC · accounting/financial rule change · TAX/ZATCA behaviour change · breaking API change · new security-sensitive backend authority · weakening/deleting tests · broad unrelated refactor · production config · deploy/Railway · concurrent conflicting work on the same contract.

`AC-UX-FUTURE` items (SoD, approval chains, record scope, own/assigned/created-by, ABAC, customer ownership, manager hierarchy, recycle-bin security, unified activity log, permanent delete, dependency-driven authorization, new scope meanings, deny rules, inheritance) are **decision-packet-only**.

## 8. Merge gate reminder (standing authority, AC-UX-HZ-01 only)

All 15 gates in the horizon brief must hold on the **exact final head** (scope matches slice; no STOP; no migration; no API break; no financial change; no authz weakening; tenant isolation & backward-compat preserved; CI green on exact head; no unresolved thread; no High/Medium security finding; mergeable/clean; report complete; nothing deploy-related bundled). Squash merge → record Merge SHA → update CURRENT-STATE → next slice from fresh `main`. **No deploy.**
