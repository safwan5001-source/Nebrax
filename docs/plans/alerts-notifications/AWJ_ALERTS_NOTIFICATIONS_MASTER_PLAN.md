# AWJ Alerts & Notifications — Master Plan

**Date:** 2026-09-06  
**Status:** PR-NOTIF-0 architecture audit completed — implementation not started  
**Source branch:** `docs/alerts-notifications-master-plan`  

> Source of truth for the AWJ Alerts & Notifications program. No application code, migration, merge, deploy, or production release is authorized by this document.

## 1. Goal and Domain Boundaries

AWJ will provide one user-facing notification center while preserving four separate concepts:

- **Alert:** persistent business/control condition requiring attention or resolution.
- **Notification:** per-user delivery record with read/unread lifecycle.
- **System Announcement:** AWJ-platform message targeted to tenants/users.
- **What's New:** durable tenant-facing release/update history.

Core rule:

`Read Notification != Resolved Alert`

A notification never modifies an accounting entry, balance, financial document, inventory transaction, ZATCA document, or POS transaction merely because it was delivered/read/acknowledged.

## 2. Governing Principles

1. Tenant Isolation, RBAC, security, accounting correctness, and backward compatibility first.
2. Do not replace the existing Financial Control Alert engine.
3. Notification payloads, badge counts, metadata, and source links must not leak unauthorized data.
4. Notify on meaningful state transitions, not every scan/event.
5. Phase 1 delivery is **In-App only**; Email/Push/real-time are deferred.
6. UI remains dense, RTL-first, responsive, token-based, Lucide-based, and consistent with AWJ design conventions.

# 3. Confirmed Current Architecture — PR-NOTIF-0

The following findings were confirmed against current `main` on 2026-09-06.

## 3.1 EXISTING — REUSE: Financial Control Alert engine

AWJ already has a real domain alert register:

- `App\Models\FinancialControlAlert`
- table `financial_control_alerts`
- `App\Services\Accounting\FinancialControlService`
- `App\Http\Controllers\Api\FinancialControlAlertController`
- `/financial-alerts` workspace and finance alert settings UI
- scheduled `finance:scan-controls`

The engine is explicitly read-only with respect to accounting: it scans accounting/report state and only writes alert records.

Confirmed financial checks include:

- unbalanced posted/reversed journal entries;
- Trial Balance imbalance;
- Balance Sheet imbalance;
- posted Invoice/Purchase/Payment/Expense/ManualJournal without a valid linked posted/reversed journal entry.

### Existing alert lifecycle

`FinancialControlService` uses deterministic `fingerprint` values.

- first detection -> `active`;
- acknowledgement -> `acknowledged`;
- issue no longer found -> `resolved` + `resolved_at`;
- resolved issue detected again -> reopened as `active`, with detection/acknowledgement state reset.

This is a proven lifecycle/deduplication pattern and should inform other domain alerts without forcing all domains into the same model.

### Existing financial settings

Finance settings already accept:

- `financial_alerts_enabled`;
- `alert_check_window_days` (1..90).

The financial scan reads these through AWJ's centralized `Settings` abstraction.

### Existing scheduling

`finance:scan-controls` is scheduled hourly and iterates tenants. The command/service respects tenant settings unless a forced/manual scan is requested.

## 3.2 EXISTING — REUSE CAREFULLY: Fuel operational alerts

Fuel operations already reuse `FinancialControlAlert` for non-financial operational conditions. This proves the table/model can technically hold operational alerts, but the name and financial scan lifecycle create domain coupling.

**Decision:** do not rename `financial_control_alerts` or `FinancialControlAlert` now. Do not make them the universal notification store. Preserve backward compatibility and introduce a generic notification delivery layer separately.

Future domain alert producers may reuse the existing alert register only when their lifecycle/schema genuinely fits; otherwise use a domain-specific alert model behind a common notification contract.

## 3.3 NEW REQUIRED: User Notification delivery layer

Code search on current `main` found no application Notification model/engine and no Laravel `Notification` usage under `app`. The frontend also has no `/notifications` implementation.

Therefore PR-NOTIF-1 requires a new per-user notification delivery contract/storage.

**Architecture decision:** use a dedicated AWJ notification model/table rather than turning `FinancialControlAlert` into per-user delivery storage. Laravel's notification abstraction may be used internally only if it cleanly supports AWJ's explicit tenant/user/authorization contracts; the database contract remains AWJ-owned and explicit.

Reasoning:

- domain Alert lifecycle differs from user Read/Unread lifecycle;
- one Alert can notify multiple users;
- system announcements are not financial alerts;
- explicit `tenant_id` is required for isolation and efficient unread counts;
- AWJ needs category/severity/source/deduplication metadata with predictable API behavior.

## 3.4 NEW REQUIRED: Top-bar Bell and Notification Center

Current `web/src/components/layout/topbar.tsx` contains quick-create, language, theme, branch/user account controls, but **no notification Bell**.

PR-NOTIF-2 will add the Bell without redesigning the Topbar.

Target UX:

- Bell + unread badge (`1..99+`);
- tabs: **الكل | تنبيهات | تحديثات**;
- mark read / mark all read;
- open authorized source;
- full `/notifications` workspace.

Badge represents unread count, never severity.

## 3.5 EXISTING — REUSE: Inventory reorder threshold

The product schema already contains:

`products.reorder_level` — documented as the low-stock alert threshold.

`Product` exposes/casts it, product create/update contracts use it, and product UI already references it.

The existing product list already defines stock states:

- `out`: tracked product with `quantity_on_hand <= 0`;
- `low`: tracked product with `quantity_on_hand > 0`, `reorder_level > 0`, and `quantity_on_hand <= reorder_level`.

**Decision:** PR-NOTIF-3 must reuse this exact product-level threshold initially. Do not add another `minimum_stock`/`reorder_point` field.

## 3.6 EXISTING + EXTEND: Inventory quantity and warehouse semantics

AWJ has both product aggregate stock and warehouse stock infrastructure. `User` already supports assigned warehouses through `user_warehouse`, with:

- `allowedWarehouseIds()`;
- `canAccessWarehouse()`;
- empty assignment preserving backward-compatible unrestricted behavior.

The current Low/Out product-list semantics are product-level using `products.quantity_on_hand` and `products.reorder_level`.

**Decision for first inventory alert release:** preserve those existing product-level semantics. Do **not** silently reinterpret `reorder_level` as a per-warehouse threshold.

Warehouse-specific Low Stock thresholds are a separate future product decision because there is no confirmed per-warehouse reorder threshold contract in the audited model. If added later, it must be explicit and backward compatible.

## 3.7 EXISTING — REUSE: Tenant settings architecture

AWJ has centralized `App\Support\Settings` backed by `tenants.settings[$group]` JSON. The inventory group already contains inventory policies; finance already has alert settings.

**Decision:** tenant-level notification policy should extend the existing Settings architecture rather than introduce a second generic tenant-settings table in PR-NOTIF-1.

Recommended future group:

`notifications`

with category/policy keys added incrementally. Existing finance settings remain where they are for backward compatibility; the notification layer consumes them rather than moving them immediately.

## 3.8 EXISTING — REUSE: User preferences and access scopes

`users.preferences` already exists as JSON. Users also have explicit branch and warehouse assignments plus RBAC.

**Decision:** user notification preferences can extend `users.preferences` unless a later scale/query requirement proves a dedicated preference table necessary.

Recipient resolution must always intersect:

`Tenant policy ∩ User preference ∩ RBAC ∩ Entitlement ∩ Branch/Warehouse visibility`

A preference can only reduce delivery; it cannot grant access.

## 3.9 EXISTING — REUSE: Application entitlement targeting

`TenantApplicationEntitlement` provides explicit `tenant_id`, `capability_key`, access mode, validity dates, revocation, metadata, and idempotency semantics.

**Decision:** AWJ System Announcements may use the existing entitlement/capability architecture for module-specific targeting. Do not create a duplicate application-targeting mechanism.

## 3.10 NEW REQUIRED: System Announcements and What's New

No generic tenant-facing system announcement/release-note delivery engine was confirmed in the audited notification paths.

These remain separate concepts:

- System Announcement = publishable/targetable platform content;
- Notification = per-user delivery/read state;
- What's New = durable release history.

PR-NOTIF-6 will define their persistence/admin publishing contract. It must not expose internal security or implementation details.

# 4. Architecture Decision Record

## ADR-01 — Keep FinancialControlAlert domain-specific

**Decision:** KEEP + WRAP/INTEGRATE. No rename/refactor now.

`FinancialControlAlert` remains the source of truth for existing financial controls and compatible existing fuel behavior. Notification Center consumes alert transitions; it does not own financial scanning.

## ADR-02 — Dedicated AWJ notification storage

**Decision:** NEW REQUIRED.

PR-NOTIF-1 should introduce explicit per-user notification storage with at least the concepts:

- `id`;
- `tenant_id`;
- `recipient_user_id`;
- `category`;
- `type`;
- `severity`;
- safe/localizable title/message contract;
- `source_type` / `source_id` or equivalent safe action descriptor;
- `deduplication_key` / idempotency identity;
- `read_at`;
- timestamps;
- constrained metadata.

Exact migration/index names are implementation details for PR-NOTIF-1 and require tests before merge.

## ADR-03 — Domain Event -> Alert -> Notification is not mandatory for every event

Two supported paths:

`Persistent condition -> Domain Alert -> Notification transition`

for Low Stock, financial controls, etc.

and:

`Discrete event/announcement -> Notification`

for events that do not need an independently resolvable Alert.

## ADR-04 — Alert vs Notification lifecycle

Alert lifecycle:

`active -> acknowledged -> resolved -> reopened(active)` where the domain supports it.

Notification lifecycle:

`unread -> read`

Reading/marking a Notification never acknowledges or resolves its source Alert.

## ADR-05 — Deduplication

Persistent alerts use stable domain fingerprints/state transitions. Per-user notifications use an explicit idempotency/deduplication key derived from source + transition/occurrence + recipient.

Repeated scans while a condition remains unchanged must not create repeated notifications.

## ADR-06 — Recipient resolution

Recipients are resolved server-side. Never trust a client-supplied recipient list for domain-generated notifications.

Resolution must honor tenant, permission, capability, branch, warehouse, and relevant user preference constraints.

## ADR-07 — Inventory semantics

Initial Low Stock:

`track_inventory = true AND quantity_on_hand > 0 AND reorder_level > 0 AND quantity_on_hand <= reorder_level`

Initial Out of Stock:

`track_inventory = true AND quantity_on_hand <= 0`

These match current AWJ product-list semantics.

No new threshold field in PR-NOTIF-3.

## ADR-08 — Settings hierarchy

1. Domain/system mandatory safety rules.
2. Tenant policy through existing Settings architecture.
3. User preference through existing user preferences where appropriate.
4. Effective RBAC/entitlement/branch/warehouse access always wins over preference.

## ADR-09 — System Announcement targeting

Use existing tenant/capability entitlement contracts where possible. Announcement persistence remains separate from per-user notification delivery.

## ADR-10 — Polling first

PR-NOTIF-2 should use conservative polling/refetch behavior compatible with the existing web app. WebSockets/push are not a Phase 1 dependency.

# 5. Planned Notification Categories

## Inventory

- Low Stock — warning by default.
- Out of Stock — critical by default where actionable.
- recovery resolves the Alert but does not unread/delete historical Notifications.

## Financial Controls

Existing FinancialControlAlert transitions integrated later; no financial rule changes.

## ZATCA

Actionable failures/rejections/resend-required only. Successful routine submissions do not create noise.

## POS

Operational exceptions requiring intervention only. Barcode/payment audio feedback is not Notification Center content.

## Receivables

Due soon / due today / overdue with cadence/deduplication policy.

## AWJ System Updates

- New Feature;
- Improvement;
- Important Update;
- Scheduled Maintenance;
- Important Operational Announcement.

# 6. Settings Plan

Target navigation:

`Settings -> Alerts & Notifications`

Tenant policy will eventually control category enablement, recipients/roles, reminder cadence, and mandatory critical policies.

User preferences can reduce optional delivery inside tenant policy and authorization boundaries.

Inventory settings must reuse `reorder_level`; notification enablement/recipient policy is separate from the product threshold itself.

Phase 1 channel: **In-App only**.

Deferred: Email, Web/Mobile Push, real-time, WhatsApp/SMS.

# 7. Security Contract

Every implementation PR must prove:

- tenant-isolated list/count/read/mark-read;
- recipient ownership checks;
- no cross-tenant IDOR;
- source authorization on open;
- no sensitive information in title/message/metadata for unauthorized users;
- branch/warehouse visibility where the source is scoped;
- entitlement checks for module-specific notifications;
- inventory cost never leaks through notification payloads.

# 8. Roadmap

### PR-NOTIF-0 — Architecture Audit

**Status: COMPLETE in documentation.** No application code changed.

### PR-NOTIF-1 — Notification Foundation

Next implementation gate:

- dedicated notification model/table;
- explicit Tenant Isolation;
- recipient ownership/RBAC contract;
- read/unread + unread count;
- safe source/action contract;
- deduplication/idempotency contract;
- list/count/read/mark-read API;
- focused security/Tenant Isolation tests;
- no Bell UI yet;
- no inventory producer yet;
- no financial/ZATCA/POS behavior change.

### PR-NOTIF-2 — Notification Center UI

Bell, badge, panel/sheet, `/notifications`, filters/actions, responsive, RTL/LTR, light/dark.

### PR-NOTIF-3 — Inventory Alerts + Settings

Low Stock/Out of Stock using existing `reorder_level` and existing product-level stock semantics; lifecycle, deduplication, recipients, settings, tests.

### PR-NOTIF-4 — Financial + ZATCA Integration

Connect existing FinancialControlAlert transitions and selected actionable ZATCA events without changing accounting/ZATCA behavior.

### PR-NOTIF-5 — Receivables + POS

Due/overdue policies and selected POS operational alerts.

### PR-NOTIF-6 — AWJ System Updates

System Announcements, entitlement-aware audience targeting, publish/expire, `/whats-new`, release notes, update settings.

### PR-NOTIF-7 — Advanced Preferences & Channels

Advanced preferences; Email/Push/real-time only after explicit approval and demonstrated need.

# 9. Definition of Done

Across relevant PRs:

- Tenant Isolation tests;
- RBAC and source authorization tests;
- no sensitive-data leakage;
- deduplication/idempotency;
- correct Alert lifecycle;
- correct Notification read/unread lifecycle;
- inventory semantics preserved;
- accounting behavior unchanged unless explicitly scoped;
- ZATCA behavior unchanged unless explicitly scoped;
- RTL/LTR + mobile + light/dark;
- SQLite/PostgreSQL CI as applicable;
- backend/frontend tests and build green.

No merge, deploy, or production release without Safwan's explicit approval.

# 10. Immediate Next Step

Proceed only to **PR-NOTIF-1 — Notification Foundation** after review/approval of this audit. Keep scope infrastructure-only: no Bell UI, no inventory producer, no financial rule changes, no ZATCA/POS changes.
