# AWJ Alerts & Notifications — Master Plan

**Date:** 2026-09-06  
**Status:** PR-NOTIF-0 complete; Milestone 1 execution contracts approved for implementation planning  
**Source branch:** `docs/alerts-notifications-master-plan`  

> Source of truth for the AWJ Alerts & Notifications program. No application code, migration, merge, deploy, or production release is authorized by this document.

## 1. Goal and Domain Boundaries

AWJ will provide one user-facing notification center while preserving four separate concepts:

- **Alert:** persistent business/control condition requiring attention or resolution.
- **Notification:** per-user delivery record with read/unread lifecycle.
- **System Announcement:** AWJ-platform message targeted to tenants/users.
- **What's New:** durable tenant-facing release/update history.

Core rule: `Read Notification != Resolved Alert`.

A notification never modifies an accounting entry, balance, financial document, inventory transaction, ZATCA document, or POS transaction merely because it was delivered/read/acknowledged.

## 2. Governing Principles

1. Tenant Isolation, RBAC, security, accounting correctness, and backward compatibility first.
2. Do not replace the existing Financial Control Alert engine.
3. Notification payloads, badge counts, metadata, and source links must not leak unauthorized data.
4. Notify on meaningful state transitions, not every scan/event.
5. Phase 1 delivery is **In-App only**; Email/Push/real-time are deferred.
6. UI remains dense, RTL-first, responsive, token-based, Lucide-based, and consistent with AWJ design conventions.
7. Milestone 1 is split into three independently testable checkpoints: PR-NOTIF-1, PR-NOTIF-2, PR-NOTIF-3. Do not collapse their boundaries even if one Claude Code session executes all three.
8. No merge or deploy between checkpoints without Safwan's explicit approval. Commits/branches/PRs may be prepared for review.

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

Confirmed financial checks include unbalanced posted/reversed journal entries, Trial Balance imbalance, Balance Sheet imbalance, and posted Invoice/Purchase/Payment/Expense/ManualJournal without a valid linked posted/reversed journal entry.

### Existing alert lifecycle

`FinancialControlService` uses deterministic `fingerprint` values:

- first detection -> `active`;
- acknowledgement -> `acknowledged`;
- issue no longer found -> `resolved` + `resolved_at`;
- resolved issue detected again -> reopened as `active`, with detection/acknowledgement state reset.

This is a proven lifecycle/deduplication pattern and should inform other domain alerts without forcing all domains into the same model.

### Existing financial settings and scheduling

Finance settings already accept `financial_alerts_enabled` and `alert_check_window_days` (1..90) through AWJ's centralized `Settings` abstraction. `finance:scan-controls` is scheduled hourly and iterates tenants while respecting tenant settings unless a forced/manual scan is requested.

## 3.2 EXISTING — REUSE CAREFULLY: Fuel operational alerts

Fuel operations already reuse `FinancialControlAlert` for non-financial operational conditions. This proves the table/model can technically hold operational alerts, but the name and financial scan lifecycle create domain coupling.

**Decision:** do not rename `financial_control_alerts` or `FinancialControlAlert` now. Do not make them the universal notification store. Preserve backward compatibility and introduce a generic notification delivery layer separately.

## 3.3 NEW REQUIRED: User Notification delivery layer

Code search on current `main` found no application Notification model/engine and no Laravel `Notification` usage under `app`. The frontend also has no `/notifications` implementation.

Therefore PR-NOTIF-1 requires a new per-user notification delivery contract/storage.

**Architecture decision:** use a dedicated AWJ notification model/table rather than turning `FinancialControlAlert` into per-user delivery storage. Laravel's notification abstraction may be used internally only if it cleanly supports AWJ's explicit tenant/user/authorization contracts; the database contract remains AWJ-owned and explicit.

## 3.4 NEW REQUIRED: Top-bar Bell and Notification Center

Current `web/src/components/layout/topbar.tsx` contains quick-create, language, theme, branch/user account controls, but **no notification Bell**. PR-NOTIF-2 adds the Bell without redesigning the Topbar.

## 3.5 EXISTING — REUSE: Inventory reorder threshold

The product schema already contains `products.reorder_level`, documented and used as the low-stock threshold. Existing product-list semantics are:

- `out`: tracked product with `quantity_on_hand <= 0`;
- `low`: tracked product with `quantity_on_hand > 0`, `reorder_level > 0`, and `quantity_on_hand <= reorder_level`.

**Decision:** PR-NOTIF-3 reuses this exact product-level threshold. Do not add another `minimum_stock`/`reorder_point` field.

## 3.6 EXISTING + EXTEND: Inventory quantity and warehouse semantics

AWJ has product aggregate stock and warehouse stock infrastructure. `User` already supports assigned warehouses through `user_warehouse`, including `allowedWarehouseIds()` and `canAccessWarehouse()`; empty assignment preserves backward-compatible unrestricted behavior.

**Decision for first inventory alert release:** preserve current product-level semantics using `products.quantity_on_hand` and `products.reorder_level`. Do not silently reinterpret `reorder_level` as a per-warehouse threshold. Warehouse-specific thresholds are a separate future product decision.

## 3.7 EXISTING — REUSE: Settings, user preferences and entitlements

AWJ has centralized `App\Support\Settings` backed by `tenants.settings[$group]` JSON. `users.preferences` already exists. Users also have branch/warehouse assignments and RBAC. `TenantApplicationEntitlement` provides explicit capability targeting.

Recipient resolution must always intersect:

`Tenant policy ∩ User preference ∩ RBAC ∩ Entitlement ∩ Branch/Warehouse visibility`.

A preference may reduce delivery; it can never grant access.

## 3.8 NEW REQUIRED: System Announcements and What's New

No generic tenant-facing system announcement/release-note delivery engine was confirmed. System Announcement, Notification and What's New remain separate concepts. Their persistence/admin publishing contract is deferred to PR-NOTIF-6.

# 4. Architecture Decision Record

## ADR-01 — Keep FinancialControlAlert domain-specific

**Decision:** KEEP + WRAP/INTEGRATE. No rename/refactor now. Notification Center consumes later alert transitions; it does not own financial scanning.

## ADR-02 — Dedicated AWJ notification storage

**Decision:** NEW REQUIRED. Per-user delivery requires explicit tenant, recipient, category/type/severity, safe/localizable content, safe source/action, deduplication identity, read state and constrained metadata.

## ADR-03 — Domain Event -> Alert -> Notification is not mandatory for every event

Supported paths:

`Persistent condition -> Domain Alert -> Notification transition`

and

`Discrete event/announcement -> Notification`.

## ADR-04 — Alert vs Notification lifecycle

Alert lifecycle where supported: `active -> acknowledged -> resolved -> reopened(active)`.

Notification lifecycle: `unread -> read`.

Reading a Notification never acknowledges or resolves its source Alert.

## ADR-05 — Deduplication

Persistent alerts use stable domain fingerprints/state transitions. Per-user notifications use an explicit idempotency/deduplication identity derived from source + transition/occurrence + recipient. Repeated scans while a condition is unchanged must not create repeated notifications.

## ADR-06 — Recipient resolution

Recipients are resolved server-side. Never trust client-supplied recipient lists for domain-generated notifications. Resolution honors tenant, permission, capability, branch, warehouse and relevant preference constraints.

## ADR-07 — Inventory semantics

Low Stock:

`track_inventory = true AND quantity_on_hand > 0 AND reorder_level > 0 AND quantity_on_hand <= reorder_level`

Out of Stock:

`track_inventory = true AND quantity_on_hand <= 0`.

No new threshold field in PR-NOTIF-3.

## ADR-08 — Settings hierarchy

1. Domain/system mandatory safety rules.
2. Tenant policy through existing Settings architecture.
3. User preference through existing user preferences where appropriate.
4. Effective RBAC/entitlement/branch/warehouse access always wins over preference.

## ADR-09 — System Announcement targeting

Use existing tenant/capability entitlement contracts where possible. Announcement persistence remains separate from per-user notification delivery.

## ADR-10 — Polling first

PR-NOTIF-2 uses conservative polling/refetch compatible with the current web app. WebSockets/push are not a Milestone 1 dependency.

# 5. Milestone 1 — Execution Contract

Milestone 1 consists of **PR-NOTIF-1 -> PR-NOTIF-2 -> PR-NOTIF-3**. A single implementation agent may execute them sequentially, but each checkpoint must remain reviewable, testable and independently attributable.

## 5.1 PR-NOTIF-1 — Notification Foundation

### Objective

Create the secure, tenant-isolated per-user delivery foundation. This PR must be useful without any Bell UI or inventory producer.

### Required backend contract

Introduce a dedicated AWJ notification persistence model/table using project naming conventions. The schema must support, at minimum:

- stable primary identifier;
- explicit `tenant_id`;
- explicit recipient user identifier;
- category and type;
- severity constrained to the approved values needed by the foundation;
- safe/localizable title/message representation consistent with existing i18n conventions;
- optional source type/id or equivalent server-approved action descriptor;
- explicit deduplication/idempotency key;
- `read_at` nullable timestamp;
- timestamps;
- constrained metadata only when justified.

Do not store secrets, cost data, tokens, credentials, unrestricted URLs, arbitrary executable actions or raw sensitive source payloads in notification metadata.

### Required service/domain behavior

Provide one server-side creation/delivery primitive so future producers do not write notification rows ad hoc. It must:

- require/derive tenant and recipient safely;
- reject cross-tenant recipient/source combinations;
- validate category/type/severity/action contracts;
- enforce deterministic idempotency/deduplication;
- be safe under retry/concurrent delivery;
- avoid granting source access merely because a notification exists.

Do not generalize or rename `FinancialControlAlert` in this PR.

### Required API behavior

Authenticated API must provide the minimum contracts needed by PR-NOTIF-2:

- paginated current-user notification list;
- unread count;
- mark one owned notification read;
- mark all current-user notifications read;
- optional filtering required by the approved UI categories/read state, using existing API conventions.

All queries/actions are scoped server-side by authenticated tenant + authenticated recipient. A notification ID alone is never sufficient authorization.

The API must not provide arbitrary create/update/delete endpoints to normal clients. Domain producers create notifications server-side.

### Source/action security

A notification may point to a source, but opening that source must pass the source module's normal authorization again. The notification API must not act as an authorization proxy.

Actions must be allowlisted/typed server-side; never accept arbitrary external URLs or arbitrary frontend commands from producer metadata.

### Migration/backward compatibility

- additive migration only;
- no changes to accounting tables or `financial_control_alerts`;
- safe for existing tenants;
- indexes must support tenant+recipient unread count/list and deduplication efficiently;
- SQLite and PostgreSQL compatibility according to current CI requirements.

### Required tests

At minimum prove:

- Tenant A cannot list/count/read Tenant B notifications;
- User A cannot read/mark User B notification in the same tenant unless a separately approved admin contract exists (none is required here);
- unread count is recipient-specific and tenant-specific;
- mark-one and mark-all only affect authorized recipient rows;
- duplicate delivery with the same idempotency identity does not create duplicate rows;
- retry/concurrency behavior is safe to the extent supported by project test patterns;
- invalid severity/action/source contracts are rejected;
- sensitive metadata is not accepted/exposed outside the approved contract;
- API pagination/filter behavior follows existing conventions.

### Explicitly out of scope

- Bell/Topbar UI;
- `/notifications` page;
- Low Stock/Out of Stock producer;
- FinancialControlAlert integration;
- ZATCA/POS/receivables producers;
- System Announcements/What's New;
- email, push, WebSocket/SSE;
- broad settings redesign.

### PR-NOTIF-1 checkpoint

Before moving to PR-NOTIF-2, record changed files, migration, API contract, focused tests/results, SQLite/PostgreSQL status and any unresolved risk. Do not hide a failing foundation test behind later UI work.

## 5.2 PR-NOTIF-2 — Notification Center UI

### Objective

Expose the PR-NOTIF-1 foundation as a dense, fast AWJ Notification Center without changing producer/domain behavior.

### Topbar contract

Modify the existing Topbar minimally:

- add Lucide Bell in the established action area;
- show unread badge `1..99+`;
- badge is unread count, not severity;
- zero unread should not show a misleading badge;
- do not redesign quick-create, language, theme, branch or account controls.

### Panel/Sheet contract

Bell opens a compact notification surface appropriate to existing responsive primitives. It must support:

- tabs: **الكل | تنبيهات | تحديثات**;
- dense recent notification list;
- clear unread/read state without relying on color alone;
- severity cue using icon/text/accessible treatment;
- mark one read;
- mark all read;
- open authorized source when available;
- link to full `/notifications` workspace;
- loading, empty, error and retry states.

`تنبيهات` represents business/control alert-related notifications. `تحديثات` is reserved for platform/update notifications; the UI may support the category even before PR-NOTIF-6 produces them.

### `/notifications` workspace contract

Create a full workspace using existing AWJ page/list conventions rather than a custom dashboard. It should provide:

- paginated history;
- read/unread filter;
- category/tab-compatible filter;
- severity/type filtering only if the foundation API supports it cleanly;
- safe source navigation;
- mark read actions;
- appropriate date/time display;
- dense desktop presentation and usable mobile records.

Do not expose raw source IDs, dedupe keys or internal metadata as user-facing fields.

### Fetching/refetch contract

Phase 1 is polling/refetch, not real-time infrastructure. Use the project's existing data-fetching patterns. Avoid aggressive polling; refresh on sensible lifecycle events such as opening the panel, completing read actions and conservative periodic refetch if justified by current conventions.

No WebSocket, SSE, push service worker or new realtime dependency in this PR.

### Accessibility/design requirements

- RTL and LTR;
- Arabic/English translations using existing i18n conventions;
- light/dark tokens only;
- keyboard-accessible Bell and actions;
- accessible labels/tooltips where required;
- focus handling for panel/sheet;
- no severity communicated by color alone;
- mobile-safe touch targets;
- preserve AWJ density and accounting-workspace feel.

### Required frontend tests

At minimum cover:

- badge 0 / normal count / `99+`;
- panel loading/empty/error/data states;
- tab/filter behavior;
- mark-one and mark-all integration behavior;
- source action rendering only when safe action exists;
- responsive/mobile critical behavior using current test approach;
- translations or locale-sensitive rendering where existing test patterns support it.

Backend security remains authoritative; UI hiding is not authorization.

### Explicitly out of scope

- changing notification schema except a narrowly justified foundation correction;
- inventory producer;
- Financial/ZATCA/POS integrations;
- System Announcement publishing UI;
- What's New;
- realtime infrastructure;
- Topbar redesign.

### PR-NOTIF-2 checkpoint

Before moving to PR-NOTIF-3, record changed files, UI surfaces, API integration, frontend tests/build and any foundation correction. If PR-NOTIF-1 must change materially, stop and report rather than burying the architecture change in inventory work.

## 5.3 PR-NOTIF-3 — Inventory Alerts + Settings

### Objective

Add the first real business producer: Low Stock and Out of Stock, using the exact existing AWJ product-level stock semantics and the notification foundation.

### Domain conditions

Only tracked inventory products participate.

Low Stock condition:

`track_inventory = true AND quantity_on_hand > 0 AND reorder_level > 0 AND quantity_on_hand <= reorder_level`.

Out of Stock condition:

`track_inventory = true AND quantity_on_hand <= 0`.

Do not add a second threshold field. Do not reinterpret `reorder_level` per warehouse.

### Alert lifecycle contract

Inventory conditions require persistent state separate from Notification read state. Implement the smallest backward-compatible domain state mechanism needed to prove lifecycle and deduplication; do not force inventory conditions into `FinancialControlAlert` merely for reuse.

Required transitions:

- Normal -> Low Stock: activate/create Low Stock condition and deliver one notification per eligible recipient;
- Low Stock -> unchanged Low Stock: no repeated notification;
- Low Stock -> Out of Stock: resolve/supersede Low Stock as appropriate and activate Out of Stock; deliver a new meaningful notification;
- Out of Stock -> unchanged Out of Stock: no repeated notification;
- Low/Out -> Normal: resolve/recover active condition; historical notifications remain historical/read state unchanged;
- recovered product later drops again: new valid alert cycle/transition and notification.

The implementation must document exact fingerprint/idempotency identities and how recovery/reopen is represented.

### Triggering contract

Prefer integration with confirmed existing inventory mutation/service boundaries if they provide reliable post-commit state. If a scheduler/reconciliation scan is required for correctness, keep it narrow, tenant-safe and idempotent.

Do not emit a notification from inside an uncommitted transaction that may roll back. Do not create multiple competing producers for the same transition.

If current architecture cannot guarantee reliable event-driven coverage for all stock mutation paths, choose a deterministic reconciliation approach rather than broad refactoring of every inventory writer.

### Recipient contract

Recipients are resolved server-side. Default policy must be conservative and permission-aware. Recipients must belong to the tenant and have relevant inventory/product access. Where current branch/warehouse visibility can be determined for the product/source, enforce it; never broaden access through notification delivery.

Because the initial threshold is product aggregate, do not invent a warehouse-specific alert identity. Warehouse assignment remains an authorization/visibility constraint, not a new threshold semantic.

Do not expose product cost or purchase price in inventory notification content.

### Settings contract

Extend existing tenant `Settings` architecture; do not introduce a parallel generic settings table.

Add only settings required for this release, conceptually including:

- Low Stock notifications enabled/disabled;
- Out of Stock notifications enabled/disabled;
- recipient policy/role selection only if it can be expressed safely using current RBAC/settings patterns.

Product `reorder_level` remains product data, not duplicated into notification settings.

User-level opt-out may be added only if it cleanly fits existing `users.preferences`; mandatory tenant policy and authorization always win. Do not build the full PR-NOTIF-7 preferences system here.

### Severity/content defaults

- Low Stock: `warning` by default;
- Out of Stock: `critical` by default when actionable.

Content must identify the product sufficiently for action without including sensitive cost information. Use localization/i18n conventions; do not hardcode Arabic-only user-facing strings in backend records if the foundation uses translation keys/parameters.

### Source/action contract

Notification source should open an existing authorized product/inventory context using the safe action contract from PR-NOTIF-1. Source authorization is rechecked on navigation/API access.

### Required tests

At minimum prove:

- exact Low Stock boundary at `quantity_on_hand == reorder_level`;
- `reorder_level <= 0` does not create Low Stock;
- zero/negative tracked quantity creates Out of Stock, not Low Stock;
- untracked products do not create inventory alerts;
- unchanged repeated evaluation does not duplicate alert/notification;
- Low -> Out produces one new meaningful transition;
- recovery resolves condition without deleting/altering notification history;
- recovery then later drop can notify again;
- tenant isolation;
- recipient RBAC/visibility restrictions;
- disabled tenant setting suppresses delivery as contracted;
- no inventory cost leaks in notification payload/API;
- concurrent/retried evaluation remains idempotent;
- existing product-list Low/Out semantics remain unchanged;
- no stock quantity, valuation or accounting entry is modified by the alert producer.

Run focused inventory tests first, then the broader relevant inventory/accounting regression set required by the change. Do not reduce financial/security/Tenant Isolation coverage.

### Explicitly out of scope

- per-warehouse reorder thresholds;
- reserved/available-to-promise redesign;
- stock valuation changes;
- accounting entries;
- FinancialControlAlert refactor;
- ZATCA/POS/receivables producers;
- email/push/realtime;
- System Announcements/What's New.

### PR-NOTIF-3 checkpoint

Produce a complete implementation report for Milestone 1 with separate PR-NOTIF-1/2/3 sections. Include exact lifecycle/dedupe semantics, settings keys, recipient rules, changed files, migrations, tests/results, build/CI, risks/remaining, Branch/PR/Base SHA/Head SHA for each checkpoint if available, and recommended next step.

# 6. Milestone 1 Stop Conditions

The implementation agent must stop and request review instead of making an autonomous architecture expansion if any of these occur:

1. Existing `main` materially contradicts a confirmed PR-NOTIF-0 finding.
2. Correct implementation would require changing accounting posting, journal behavior or balances.
3. Correct implementation would require changing ZATCA behavior/contracts.
4. A new per-warehouse threshold or inventory valuation semantic appears necessary.
5. A database/API breaking change is required.
6. Tenant Isolation cannot be proven with the planned contract.
7. Existing permissions cannot express safe recipient/source access without a broader RBAC change.
8. A broad refactor of inventory writers is required merely to trigger alerts.
9. PR-NOTIF-2 exposes a material flaw in PR-NOTIF-1 architecture rather than a small correction.
10. Tests reveal a pre-existing failure that blocks confidence in the changed safety boundary; report it rather than weakening tests.

# 7. Milestone 1 Agent Execution Rules

When Claude Code executes the milestone:

1. Start from current `main` and read this document plus only the directly relevant implementation files.
2. Do not redo PR-NOTIF-0 from scratch.
3. Execute sequentially: PR-NOTIF-1 -> checkpoint -> PR-NOTIF-2 -> checkpoint -> PR-NOTIF-3 -> checkpoint.
4. Keep commits/PR boundaries attributable to each contract; do not mix unrelated cleanup/refactors.
5. Run focused tests first and expand progressively.
6. Never weaken tests to make CI pass.
7. No merge, deploy or production release.
8. No financial/ZATCA/POS implementation beyond the explicitly stated non-regression checks.
9. If a safer implementation differs from a non-essential detail in this document, stop and report the evidence/recommendation before changing the architecture.
10. Finish with a Markdown implementation report containing: what was done; changed files; migrations; API contracts; UI surfaces; settings; lifecycle/deduplication; recipient/security model; tests/results; build/CI; risks/remaining; Branch/PR/Base SHA/Head SHA if available; and next step.

# 8. Planned Later Categories

## Financial Controls

Existing `FinancialControlAlert` transitions integrate later; no financial rule changes in Milestone 1.

## ZATCA

Actionable failures/rejections/resend-required only. Successful routine submissions do not create noise.

## POS

Operational exceptions requiring intervention only. Barcode/payment audio feedback is not Notification Center content.

## Receivables

Due soon / due today / overdue with cadence/deduplication policy.

## AWJ System Updates

New Feature, Improvement, Important Update, Scheduled Maintenance and Important Operational Announcement.

# 9. Later Roadmap

### PR-NOTIF-0 — Architecture Audit

**Status: COMPLETE in documentation.** No application code changed.

### PR-NOTIF-1 — Notification Foundation

**Execution contract defined in §5.1.**

### PR-NOTIF-2 — Notification Center UI

**Execution contract defined in §5.2.**

### PR-NOTIF-3 — Inventory Alerts + Settings

**Execution contract defined in §5.3.**

### PR-NOTIF-4 — Financial + ZATCA Integration

Connect existing FinancialControlAlert transitions and selected actionable ZATCA events without changing accounting/ZATCA behavior.

### PR-NOTIF-5 — Receivables + POS

Due/overdue policies and selected POS operational alerts.

### PR-NOTIF-6 — AWJ System Updates

System Announcements, entitlement-aware audience targeting, publish/expire, `/whats-new`, release notes, update settings.

### PR-NOTIF-7 — Advanced Preferences & Channels

Advanced preferences; Email/Push/real-time only after explicit approval and demonstrated need.

# 10. Definition of Done

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

# 11. Immediate Next Step

Give Claude Code **Milestone 1 only: PR-NOTIF-1 -> PR-NOTIF-2 -> PR-NOTIF-3**, using this document as the execution source of truth. Claude must preserve the three checkpoints, obey §6 stop conditions and §7 execution rules, and return the required final Markdown implementation report. Do not start PR-NOTIF-4 or any later phase without a new explicit approval.