# AWJ Alerts & Notifications — Master Plan

**Date:** 2026-09-06  
**Status:** Architecture plan — pre-implementation  
**Scope:** Alerts, notifications, notification settings, inventory alerts, financial controls, ZATCA, POS, receivables, AWJ system updates, and What's New.  

> This document is the planning source of truth for the AWJ Alerts & Notifications program. It must be updated with confirmed repository findings during PR-NOTIF-0 before implementation begins.

## 1. Goal

Build one coherent alerts and notifications experience for AWJ while keeping the underlying domain concepts separate:

- **Alert:** a persistent business/control condition that needs attention or resolution.
- **Notification:** a user-directed message with a read/unread lifecycle.
- **System Announcement:** a platform-originated message from AWJ to selected tenants/users.
- **What's New:** a durable, user-facing release/update history.

Core rule:

`Read Notification != Resolved Alert`

No alert or notification may automatically modify an accounting entry, balance, financial document, inventory transaction, ZATCA document, or POS transaction merely because the alert exists or is acknowledged/read.

## 2. Governing Principles

1. Tenant Isolation, RBAC, security, accounting correctness, and backward compatibility come first.
2. Reuse existing alert infrastructure where appropriate; do not create a parallel alert engine without first auditing what exists.
3. Notifications must never become a side channel around permissions or sensitive-data authorization.
4. Only actionable/relevant events should generate notifications; avoid notification noise.
5. Deduplication and lifecycle semantics are required before enabling recurring producers.
6. Phase 1 delivery is **In-App only**. Email, push, and real-time delivery are deferred until explicitly justified and approved.
7. AWJ UI remains dense, RTL-first, responsive, token-based, and consistent with the existing design system.

## 3. Existing Financial Control Alerts

AWJ already has Financial Control Alerts from earlier work (including PR #306 and the unified list work in PR #482). Fuel-related work has also reused this alert foundation.

PR-NOTIF-0 must confirm the current implementation on `main`, including model/schema, services, APIs, scheduler, settings, RBAC, tenant/branch scope, severity, acknowledgement, deduplication, resolution, and non-financial reuse.

The current financial control engine remains the source of truth for its checks. The Notification Center must not re-run financial checks.

Expected existing examples to verify rather than assume include:

- Trial Balance / Balance Sheet control discrepancies.
- Unbalanced journal entries.
- Posted documents without linked journal entries.

No new financial rule is approved by this plan.

## 4. Inventory Alerts

Inventory is the first recommended business integration after the notification foundation.

### 4.1 Low Stock

Generate/activate a Low Stock alert when available inventory reaches or falls below the approved reorder/minimum threshold.

The threshold must **not** be hard-coded globally. PR-NOTIF-0 must determine the current Product/Inventory/Warehouse contract and whether the correct threshold is product-level, warehouse-level, or another existing model.

### 4.2 Out of Stock

Generate/activate an Out of Stock alert when available quantity reaches zero or below according to the inventory availability semantics already used by AWJ.

### 4.3 Lifecycle and Spam Prevention

Target behavior:

- `Normal -> Low Stock`: one alert/notification transition.
- `Low Stock -> Out of Stock`: a new meaningful transition.
- `Low Stock/Out of Stock -> Normal`: recovery/resolution according to the approved lifecycle.
- A later `Normal -> Low Stock` may create a new alert cycle.

The system must not generate a new notification every scan while the same condition remains active.

### 4.4 Warehouse Scope

Multi-warehouse behavior must be confirmed before implementation. Alert identity may need to include tenant + warehouse + product + rule, but this is not final until PR-NOTIF-0 confirms the current inventory architecture.

## 5. ZATCA Alerts

Future notification producers should be limited to actionable states such as:

- submission failure;
- rejection;
- clearance failure;
- reporting failure;
- resend/intervention required.

Successful routine submissions should not create notification noise.

This program must not alter ZATCA behavior unless a later explicitly approved PR scopes that change.

## 6. POS Alerts

Future POS alerts should focus on operational conditions requiring attention, for example:

- session/shift requiring review;
- cash variance requiring review;
- pending approval;
- important operational exception.

Barcode/payment sounds and other immediate POS feedback are not Notification Center events.

## 7. Receivables Alerts

Future phases may support:

- due soon;
- due today;
- overdue.

Reminder cadence and deduplication must prevent repetitive daily spam. No receivables behavior is changed by this planning document.

## 8. AWJ System Updates and Announcements

AWJ should be able to inform tenants about:

- new features;
- improvements;
- important updates;
- scheduled maintenance;
- important operational announcements.

### 8.1 Audience Targeting

System announcements should eventually support targeting appropriate to the confirmed platform architecture, potentially including:

- all tenants;
- specific tenant(s);
- enabled Application/Capability;
- subscription plan, if a suitable plan contract exists;
- user language;
- other rollout/entitlement criteria supported by the current system.

Example principle: a POS-specific feature update should not be sent to a tenant that does not use POS when the entitlement/application architecture can reliably express that distinction.

## 9. Notification Center UX

Target top-bar behavior:

- Lucide Bell icon.
- unread badge (`1` through `99+`).
- badge represents unread count, not severity.

Target panel tabs:

- **الكل**
- **تنبيهات**
- **تحديثات**

Core actions:

- mark as read;
- mark all as read;
- open the real source entity/workspace;
- open the full `/notifications` workspace.

The full workspace should support appropriate search/filter/history capabilities while preserving AWJ's dense accounting-tool UX.

Source navigation examples:

- inventory alert -> product/inventory context;
- invoice alert -> invoice;
- financial control -> `/financial-alerts`;
- POS alert -> relevant session/workspace;
- AWJ update -> `/whats-new` or update details.

## 10. What's New

Target route:

`/whats-new`

This is separate from transient read/unread notifications and provides a durable release history.

Suggested content groups:

- New;
- Improvements;
- Fixes;
- release date;
- affected modules;
- Learn More when useful.

Never expose sensitive internal implementation or exploitable security details in tenant-facing release notes.

## 11. Alerts & Notifications Settings

Settings are a first-class part of the architecture, not a late cosmetic feature.

Conceptual navigation:

`Settings -> Alerts & Notifications`

### 11.1 Tenant / Organization Policy

Managed by authorized tenant administrators. It may define:

- enabled alert categories/types;
- organization-level alert policies;
- recipients/roles;
- reminder cadence;
- mandatory/critical notification policies.

### 11.2 User Preferences

Users may customize permitted notifications only within:

- tenant policy;
- RBAC;
- entitlements;
- branch/warehouse/data visibility.

A user preference must never grant access to data or an event that the user could not otherwise access.

### 11.3 Inventory Settings

Plan for:

- Low Stock enabled/disabled;
- Out of Stock enabled/disabled;
- reorder/minimum threshold semantics;
- recipients;
- deduplication/recovery policy.

Threshold placement must be based on the confirmed inventory model, not assumed here.

### 11.4 Financial and Operational Settings

Future settings may cover:

- existing Financial Control Alerts;
- receivables;
- ZATCA;
- POS.

Some critical alerts may be tenant-mandated and therefore not individually suppressible.

### 11.5 AWJ Update Settings

May cover:

- new features;
- improvements;
- important updates;
- scheduled maintenance.

Critical operational platform announcements may be mandatory even if normal product-news notifications are optional.

### 11.6 Delivery Channels

**Phase 1:** In-App only.

Deferred pending explicit approval and demonstrated need:

- Email;
- Web/Mobile Push;
- real-time delivery.

WhatsApp/SMS are outside the current scope.

## 12. Security and Authorization Requirements

Non-negotiable requirements:

- Tenant Isolation.
- User/recipient isolation.
- RBAC.
- Entitlements/Application access.
- Branch/Warehouse scope where applicable.
- No IDOR.
- No sensitive-data leakage through notification title, message, metadata, badge counts, or source links.
- Inventory cost authorization remains enforced; notifications cannot expose cost to unauthorized users.
- Cross-tenant list/count/read/mark-read/source access must be impossible.
- Source authorization must still be checked when a notification is opened.

## 13. Severity

Initial conceptual levels:

- `info`
- `warning`
- `critical`

A marketing/product update must not be marked critical merely to increase visibility.

Severity must not rely on color alone in the UI.

## 14. Preliminary Data Contracts — Not Final

A user notification may eventually require concepts similar to:

- id;
- tenant_id;
- recipient_user_id;
- category;
- type;
- severity;
- localized title/message or translation keys;
- source_type/source_id;
- safe action descriptor;
- read_at;
- created_at;
- metadata;
- deduplication/idempotency identity.

This is **not an approved schema**. PR-NOTIF-0 must determine whether Laravel Notifications, a custom model, or an extension/wrapper around existing AWJ infrastructure best fits current architecture and backward compatibility.

System Announcements and release notes should remain conceptually separate from per-user notification delivery unless the audit proves another existing design is preferable.

## 15. Implementation Roadmap

### PR-NOTIF-0 — Existing Alerts Architecture Audit

Read-only architecture audit. No application behavior changes.

Deliverable: update this document with confirmed architecture and decisions.

### PR-NOTIF-1 — Notification Foundation

Expected scope after PR-NOTIF-0 approval:

- notification storage/model;
- Tenant Isolation;
- recipient/RBAC contract;
- read/unread;
- unread count;
- source/action contract;
- deduplication/idempotency;
- API;
- tests.

### PR-NOTIF-2 — Notification Center UI

- Bell and badge;
- panel/sheet;
- `/notifications`;
- filters/actions;
- responsive/mobile;
- RTL/LTR;
- light/dark.

### PR-NOTIF-3 — Inventory Alerts + Settings

- Low Stock;
- Out of Stock;
- threshold semantics;
- warehouse scope;
- recovery/resolution;
- deduplication;
- recipients;
- inventory notification settings;
- tests.

### PR-NOTIF-4 — Financial + ZATCA Integration

- reuse Financial Control Alerts;
- connect relevant financial alerts to notification delivery;
- integrate important ZATCA events;
- preserve accounting and ZATCA behavior.

### PR-NOTIF-5 — Receivables + POS

- due soon/today/overdue policies;
- reminder cadence;
- important POS operational alerts.

### PR-NOTIF-6 — AWJ System Updates

- System Announcements;
- audience targeting;
- publish/expire;
- notification delivery;
- `/whats-new`;
- release notes;
- system-update settings.

### PR-NOTIF-7 — Advanced Preferences & Channels

- advanced user preferences;
- Email if explicitly approved;
- Push/real-time only if justified and approved.

## 16. Priority Order

- **P0:** Foundation + Security + Tenant Isolation + settings contract.
- **P1:** Notification Center + Low/Out-of-Stock.
- **P2:** Financial Alerts + ZATCA.
- **P3:** Receivables + POS.
- **P4:** AWJ System Updates + What's New.
- **P5:** Email/Push/real-time.

## 17. PR-NOTIF-0 Audit Checklist

PR-NOTIF-0 must inspect only what is needed to answer these questions on current `main`:

1. `FinancialControlAlert` model/schema/service/controller.
2. Existing alert settings.
3. Scheduler/commands responsible for scans.
4. `/financial-alerts` API and UI.
5. Severity/status/acknowledgement lifecycle.
6. Tenant Isolation.
7. Branch scoping.
8. RBAC/permissions.
9. Fuel reuse of FinancialControlAlert.
10. Any other alert/notification engines already present.
11. Laravel built-in Notification usage, if any.
12. Existing notification-related tables/migrations.
13. Top Bar/header implementation and any Bell/notification placeholder.
14. Product/Inventory/Warehouse models relevant to stock thresholds.
15. Existing minimum stock/reorder point fields/settings.
16. Exact available/on-hand/reserved quantity semantics.
17. Multi-warehouse behavior.
18. Existing inventory scheduler/events/listeners suitable for alert production.
19. Tenant/user settings architecture suitable for notification settings.
20. Applications/entitlements architecture suitable for AWJ announcement targeting.
21. Translation/i18n conventions.
22. Existing API pagination/filter conventions suitable for `/notifications`.

Do not inspect unrelated project areas unless required to resolve one of the questions above.

## 18. Required Architecture Decisions After PR-NOTIF-0

Update this document with a **Confirmed Current Architecture** section and classify findings as:

- `EXISTING — REUSE`
- `EXTEND`
- `NEW REQUIRED`
- `DEFERRED`
- `NOT APPLICABLE`

Then record explicit decisions for:

1. Whether `FinancialControlAlert` remains a domain alert engine or should be generalized/wrapped.
2. Laravel Notifications vs custom notification storage.
3. Exact relationship between Domain Event, Alert, and Notification.
4. Alert lifecycle.
5. Notification lifecycle.
6. Deduplication/idempotency strategy.
7. Recipient resolution strategy.
8. Tenant/branch/warehouse scope strategy.
9. Settings hierarchy.
10. System Announcement architecture.
11. What's New architecture.
12. Inventory Low/Out-of-Stock semantics.
13. Polling vs real-time for the first release.

Do not choose a solution merely because it is conventional Laravel architecture; prefer the solution that fits current AWJ contracts and backward compatibility.

## 19. Definition of Done

The program is not complete merely because a Bell appears.

Required quality gates across the relevant implementation PRs:

- Tenant Isolation tests.
- RBAC tests.
- No sensitive-data leakage.
- Deduplication/idempotency.
- Correct read/unread behavior.
- Correct alert lifecycle.
- Confirmed inventory warehouse/threshold semantics.
- Accounting behavior unchanged unless explicitly scoped and approved.
- ZATCA behavior unchanged unless explicitly scoped and approved.
- RTL/LTR.
- Mobile/responsive behavior.
- Light/Dark.
- SQLite/PostgreSQL as required by project CI.
- Backend/frontend tests appropriate to each change.
- Build/CI green.

No merge, deploy, or production release without Safwan's explicit approval.

## 20. Immediate Next Step

Execute **PR-NOTIF-0 only** as a read-only architecture audit. Update this same document with repository-confirmed findings and architecture decisions before writing any notification migration or application implementation.
