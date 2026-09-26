# CUST-H1 — Theme Copies & Safe Publication Lifecycle
## Evidence Pass + UX Contract

**Status:** Horizon active — evidence/UX phase only  
**Date:** 2026-09-26  
**Repository:** `safwan5001-source/Nebrax`  
**Base:** `main@145dac8a6b46b4b8c7ccfe3d225d950701ddfcea`  
**Parent roadmap:** `docs/plans/store/AWJ_STORE_CUSTOMIZER_HORIZON_ROADMAP_V1.md`  
**Persistence authority:** `docs/plans/store/AWJ_STORE_CUSTOMIZER_PERSISTENCE_ARCHITECTURE.md`  
**Execution model:** Horizon system — Evidence → UX Contract → Architecture/Data Contract → Implementation → Verification → Merge Gate → Closure

---

## 1. Horizon goal

Give the merchant a safe way to prepare multiple storefront designs for seasons, campaigns, redesigns, and future launches **without modifying the live store until publication**.

This Horizon owns:

- named design copies / versions;
- explicit version states;
- previewing an exact version;
- publishing an exact version;
- scheduled publication;
- schedule edit / cancel;
- duplicate / rename / eligible delete;
- stale/concurrent edit protection;
- clear distinction between Draft, Scheduled and Published;
- safe fallback/rollback semantics for failed publish.

This Horizon does **not** own:

- Product/Category multi-page builder;
- Store Identity Studio;
- Section Library expansion;
- Undo/Redo;
- custom CSS/JS;
- promotion rules;
- theme marketplace;
- deployment.

---

## 2. Repository evidence — current AWJ truth

### 2.1 Current persistence model

Current production architecture is intentionally a **single current-head row per storefront**:

`storefront_presentations`

- `storefront_id`
- `tenant_id`
- `schema_version`
- `draft_config`
- `draft_revision`
- `published_config`
- `published_revision`
- `published_at`

The table has `unique(storefront_id)`.

This was explicitly designed as **current state, not an audit log**. The original architecture rejected revision/history tables because Version History was DEFERRED at that time.

### 2.2 Current lifecycle

Current lifecycle:

```
Draft
  ↓ Save
draft_config + draft_revision
  ↓ Publish
published_config + published_revision + published_at
  ↓
Public storefront
```

Current guarantees already exist:

- saving Draft never changes Published;
- public runtime never reads Draft;
- Publish is transactional;
- stale `draft_revision` → 409;
- failed Publish preserves the prior Published snapshot;
- repeated publish of the same revision is idempotent;
- server re-normalizes before persist/publish;
- tenant ownership is resolved through authenticated tenant context;
- foreign storefront id → non-leaking 404;
- current draft is private workspace state;
- public traffic is Host-resolved and Published-only.

These guarantees are **not negotiable** in CUST-H1.

### 2.3 Current limitation

The current model can represent only:

- one current draft;
- one current published snapshot.

It cannot honestly represent:

- several named drafts;
- a scheduled version;
- multiple future campaign designs;
- version-specific editing;
- an independently previewable design copy;
- version deletion/duplication;
- a reliable version list.

Therefore CUST-H1 **cannot be implemented as UI-only work** over the existing one-row current-head model.

This is an Architecture/Data Decision Gate.

---

## 3. External evidence — Salla

First-party Salla Help Center reviewed 2026-09-26.

Salla documents:

- creating theme copies;
- renaming a copy;
- customizing a copy;
- previewing a copy;
- publishing a copy;
- scheduling publication;
- modifying/canceling a publication;
- deleting eligible copies;
- Draft / Scheduled / Published states;
- seasonal/campaign use;
- custom publication by geography/language in its platform.

Sources:

- Salla — إدارة نسخ الثيم وتخصيصها
- Salla — متجر الثيمات / حالات الثيم
- Salla — إدارة نسخ الثيم

### What this proves

A mature regional commerce platform treats theme copies as a **first-class lifecycle**, not as a hidden revision history.

### What AWJ should adopt

- merchant-visible named versions;
- clear status;
- preview-before-publish;
- scheduling;
- safe version operations;
- seasonal workflow.

### What AWJ does **not** copy automatically

Salla's geographic/language targeting is **not** authorized in CUST-H1.

AWJ must not invent market/city/language targeting until an authoritative AWJ market/locale publication contract exists.

For CUST-H1 V1:

- one storefront;
- one active published design at a time;
- one or more non-live copies;
- optional scheduled activation time.

Targeted publication remains DEFERRED.

---

## 4. External evidence — Shopify

First-party Shopify Help Center reviewed 2026-09-26.

Shopify documents:

- duplicate theme;
- customize duplicate;
- several draft themes;
- only one published theme at a time;
- publishing a new theme moves the old published theme back into Draft rather than losing it;
- unpublished themes can be previewed;
- seasonal copies are a normal use case.

### What this proves

Two useful lifecycle principles are common and mature:

1. **one live design at a time**;
2. replacing the live design should **not destroy the former live design**.

### AWJ decision direction

CUST-H1 should preserve the previously published design as a recoverable design/version rather than overwrite it irreversibly.

Exact persistence mechanics are an Architecture Decision, not yet locked by this document.

---

## 5. Product model — merchant language

Merchant-facing term:

**نسخ التصميم / Design Versions**

Do not expose:

- row;
- snapshot;
- revision integer;
- schema version;
- JSON;
- publish transaction;
- optimistic concurrency token.

### Initial states

- **مسودة / Draft**
- **مجدول / Scheduled**
- **منشور / Published**

Do not introduce extra states unless architecture proves they are required.

Internal failure/error conditions are not permanent version states.

---

## 6. Core UX

### 6.1 Entry point

The Customizer top toolbar must make the currently edited version obvious.

Example:

```
الخروج | الرئيسية ▼ | نسخة رمضان 1448 · مسودة ▼ | محفوظ ✓ | معاينة | نشر
```

The version selector must never be visually confused with the page selector.

Page selector answers:

> Which storefront page am I editing?

Version selector answers:

> Which design copy am I editing?

---

## 6.2 Version manager

A dedicated lightweight version manager is required.

Each card/row shows:

- version name;
- state;
- last modified;
- published/scheduled timestamp where applicable;
- live marker for current Published;
- schedule timezone when Scheduled.

Allowed actions depend on state.

### Draft

- Open/Edit
- Preview
- Rename
- Duplicate
- Publish now
- Schedule
- Delete, if eligible

### Scheduled

- Open/Edit according to architecture policy
- Preview
- Reschedule
- Cancel schedule
- Duplicate
- Delete only if safe and schedule is canceled atomically

### Published

- Open/View
- Preview
- Duplicate
- Create draft from this version

Published must **not** expose a simple destructive Delete action.

---

## 6.3 Create copy

Entry actions:

- **نسخة جديدة**
- **تكرار هذه النسخة**

Creating from Published is the primary path for seasonal work.

The resulting version must:

- have a new stable id;
- have a human-readable name;
- copy the presentation document;
- not become live;
- not inherit a Scheduled state;
- be editable independently.

Default generated names must be understandable, but naming UX should encourage explicit names such as:

- رمضان 1448
- اليوم الوطني
- عروض نهاية السنة

Do not expose internal ids.

---

## 6.4 Preview

Preview must identify exactly which version is being previewed.

It must not rely on “current draft” ambiguity once several versions exist.

The Preview header/banner should include:

- version name;
- state;
- non-live warning when applicable.

Public anonymous runtime must remain Published-only.

CUST-H1 must **not** expose private drafts through an unauthenticated public preview URL unless a later explicit security architecture approves that capability.

In-workspace authenticated preview remains the default.

---

## 6.5 Publish now

Publishing is a high-trust action.

Confirmation must state:

- version being published;
- storefront affected;
- that the current live design will be replaced;
- that the replaced design will remain recoverable if the architecture implements the required retention model.

Do not use a generic “Are you sure?” dialog.

Success state must be reported only after authoritative server success.

Failure must preserve the current live version.

---

## 6.6 Schedule publication

Required fields:

- activation date;
- activation time;
- explicit timezone.

Default timezone display must be based on the storefront/account-supported authoritative timezone contract; implementation must not silently assume browser timezone if backend/store policy differs.

The confirmation should read naturally, e.g.:

> سيتم نشر «نسخة رمضان 1448» في 1 رمضان 1448، الساعة 12:00 ص بتوقيت الرياض.

UX requirements:

- date/time remain editable;
- scheduled state visible in manager;
- next scheduled publication is obvious;
- user can cancel schedule;
- user can reschedule;
- past time is rejected;
- DST/timezone semantics, where relevant, are server authoritative.

Do not ship schedule UI without a real scheduler/worker execution path.

---

## 6.7 One-live-version rule

CUST-H1 V1 follows:

**One storefront → one Published version at a time.**

When another version becomes Published:

- it becomes the authoritative public design atomically;
- the previous live design is retained according to the locked data architecture;
- no interval may expose a partial document.

---

## 7. Mobile UX

Version lifecycle must be fully usable from mobile.

Do not create a desktop-only version manager.

Mobile pattern:

- version name/state visible in compact top context;
- version manager opens as Bottom Sheet / full-height mobile sheet;
- cards/rows are touch-friendly;
- destructive actions are not placed beside common edit actions without separation;
- date/time scheduler is mobile-native where possible;
- Save/Publish/Schedule controls must not be clipped at 390px or 430px;
- switching version must preserve a coherent navigation state.

---

## 8. Desktop / tablet UX

At desktop/tablet:

- current version stays visible in toolbar;
- version manager may use Sheet/Popover/Panel depending on density;
- the Canvas remains dominant;
- version management must not turn the Customizer back into an admin settings page;
- version switching should not reset page selection unnecessarily when both versions support the same page context;
- loading/switching state must be explicit.

---

## 9. Required states

CUST-H1 UX must explicitly handle:

- version list loading;
- no extra versions yet;
- creating;
- duplicating;
- renaming;
- saving;
- saved;
- stale/conflict;
- preview loading;
- publish in progress;
- publish success;
- publish failure;
- scheduling;
- schedule success;
- scheduler execution pending;
- reschedule;
- cancel schedule;
- deletion in progress;
- deletion failure.

No silent state transitions.

---

## 10. Concurrency

Current AWJ uses `draft_revision` and 409 stale-write protection.

CUST-H1 must preserve or strengthen that guarantee per version.

Required scenario:

Session A and Session B edit the same version.

- A saves.
- B attempts stale save.
- B must not silently overwrite A.

The UX must not auto-merge arbitrary presentation JSON.

Conflict UX should:

- explain that a newer version exists;
- offer reload;
- preserve user confidence;
- not claim save succeeded.

Architecture must define whether revisions live:

- per version;
- on a separate head/working-copy;
- or through another explicit concurrency model.

---

## 11. Scheduling safety

A scheduled publication is a server-owned future action.

Required guarantees:

- schedule belongs to the same tenant/storefront/version;
- scheduler re-checks eligibility at execution;
- canceled schedule cannot later execute;
- rescheduling invalidates the prior execution token/job safely;
- duplicate jobs are idempotent;
- exact version payload published is deterministic;
- failed scheduled publish preserves prior live design;
- execution result is auditable enough to diagnose failure.

Do not implement client timers.

---

## 12. Tenant/security boundaries

CUST-H1 must preserve:

- tenant from authenticated user context only;
- storefront under TenantScope;
- foreign version id → non-leaking 404;
- no tenant/storefront/version id accepted as authority from request body;
- public runtime never exposes non-published version content;
- server normalization before save and before publish;
- no script/HTML execution added by this Horizon;
- no commerce/pricing/inventory data copied into version documents.

Cross-tenant tests are mandatory.

---

## 13. Backward compatibility

Existing storefronts currently have exactly one `storefront_presentations` current-head row.

CUST-H1 architecture must define a migration path that:

- keeps existing Published output unchanged;
- keeps existing Draft content recoverable;
- does not require merchants to recreate designs;
- does not change public rendering semantics before they use Versions;
- keeps old URLs/API consumers working where backward compatibility requires it.

Migration must be deterministic and tested on both sqlite and pgsql where applicable.

---

## 14. Architecture Decision Gate

The current one-row model is not sufficient for CUST-H1.

Before implementation, a separate Architecture/Data Contract must choose and lock a model.

The architecture pass must evaluate at minimum:

### Option family A — head row + immutable/mutable version rows

Keep `storefront_presentations` as the published/current compatibility head and add version rows.

Potential advantages:

- lowest public-runtime compatibility risk;
- existing public read path can remain stable;
- gradual migration.

Potential risks:

- head/version synchronization;
- source-of-truth ambiguity if poorly designed.

### Option family B — versions become canonical + storefront head pointer

Version rows become authority; storefront presentation state points to active/current version.

Potential advantages:

- cleaner long-term lifecycle model.

Potential risks:

- larger migration;
- public runtime and existing APIs require more change;
- higher backward-compatibility risk.

### Option family C — snapshot/history table appended to current head

Keep one editable current head and snapshot copies separately.

Potential advantages:

- small change.

Potential risks:

- can become “history” rather than truly independently editable named versions;
- may not satisfy multiple draft copies honestly.

**No option is approved by this Evidence/UX document.**

The Architecture Pass must recommend the smallest model that honestly supports:

- multiple independently editable versions;
- one published;
- scheduled activation;
- duplication;
- rename;
- preview;
- recovery of prior published design;
- per-version concurrency;
- tenant isolation;
- backward compatibility.

---

## 15. Explicitly deferred from CUST-H1

- Salla-style publication by country/city/language;
- A/B testing;
- percentage traffic rollout;
- Shopify-style experiment analytics;
- temporary event auto-rollback;
- shared public preview links;
- theme marketplace licensing;
- generic CMS revision history;
- Undo/Redo operation history;
- custom JS.

These may be future Horizons.

---

## 16. Verification matrix

CUST-H1 implementation cannot close without:

### Functional

- create version;
- rename;
- duplicate;
- switch;
- edit independently;
- save;
- preview exact version;
- publish exact version;
- schedule;
- reschedule;
- cancel;
- preserve prior live design;
- eligible delete.

### Responsive UX

- 390
- 430
- 768
- 1024
- 1280
- 1440

Arabic RTL and English LTR.

### Security

- cross-tenant read negative;
- cross-tenant write negative;
- cross-store same-tenant isolation;
- draft/non-live public secrecy;
- foreign id 404;
- no authority fields from body.

### Concurrency

- stale save;
- publish vs save;
- publish vs publish;
- schedule vs edit;
- schedule vs cancel;
- duplicate scheduler delivery/idempotency.

### Backward compatibility

- existing no-version storefront;
- existing draft only;
- existing published snapshot;
- legacy schema/normalization fixtures.

### Failure

- failed immediate publish leaves current live design;
- failed scheduled publish leaves current live design;
- scheduler unavailable/retry path;
- invalid/past schedule;
- deleted/canceled scheduled target.

---

## 17. Definition of Done

CUST-H1 is complete only when:

- [x] Evidence Pass recorded.
- [x] UX Contract recorded.
- [ ] Architecture/Data Contract locked.
- [ ] Migration/backward-compatibility strategy locked.
- [ ] API contract locked.
- [ ] Scheduler execution contract locked.
- [ ] Desktop implementation complete.
- [ ] Mobile implementation complete.
- [ ] RTL/LTR verified.
- [ ] Tenant isolation verified.
- [ ] Concurrency verified.
- [ ] Scheduled publication verified.
- [ ] Preview/Published parity verified.
- [ ] Focused tests pass.
- [ ] Relevant broad tests pass.
- [ ] Build/CI pass.
- [ ] Visual QA complete.
- [ ] PRE_MERGE_REVIEW complete.
- [ ] Owner explicitly approves merge.
- [ ] POST_MERGE_REVIEW complete.
- [ ] Horizon Closure report written.

No Deploy/Production action is implied by Horizon completion.

---

## 18. Next task

**CUST-H1-ARCH-1 — Theme Version Persistence & Scheduling Architecture**

The architecture task must begin from current main and this document. It must not re-audit unrelated Store/ERP modules.

Required output:

- exact current repository evidence;
- chosen ownership graph;
- exact tables/columns/indexes/FKs;
- version state machine;
- current-head compatibility strategy;
- migration strategy;
- Draft/Published mapping;
- per-version revision/concurrency;
- publish transaction;
- scheduler transaction/idempotency;
- API shapes;
- authorization/404 semantics;
- public-runtime read behavior;
- cache behavior;
- failure semantics;
- dual-DB considerations;
- tests required;
- rollout/backward compatibility;
- explicit rejected alternatives.

**Stop after architecture documentation. No runtime code in CUST-H1-ARCH-1.**
