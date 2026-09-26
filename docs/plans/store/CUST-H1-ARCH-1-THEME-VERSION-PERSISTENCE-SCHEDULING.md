# CUST-H1-ARCH-1 — Theme Version Persistence & Scheduling Architecture

**Status:** Architecture lock candidate — documentation only  
**Date:** 2026-09-26  
**Repository:** `safwan5001-source/Nebrax`  
**Base:** `main@145dac8a6b46b4b8c7ccfe3d225d950701ddfcea`  
**Parent Horizon:** `CUST-H1-THEME-VERSIONS-EVIDENCE-UX.md`  
**Authority after approval:** CUST-H1 implementation slices  
**No runtime code / migration / API is authorized by this document alone.**

---

## 0. Executive decision

CUST-H1 adopts a **Compatibility Head + Version Rows** architecture.

```
Tenant
  └─ Storefront
       ├─ StorefrontPresentation              (existing optional 0..1 compatibility/public head)
       │    ├─ draft_config / draft_revision  (legacy-compatible working head)
       │    ├─ published_config               (public compatibility snapshot)
       │    ├─ published_revision
       │    ├─ published_at
       │    ├─ active_version_id              (new nullable pointer)
       │    └─ scheduled_version_id           (new nullable pointer)
       │
       └─ StorefrontPresentationVersion[]     (new named independently editable versions)
            ├─ id
            ├─ name
            ├─ config
            ├─ revision
            ├─ schema_version
            ├─ scheduled_for
            ├─ schedule_generation
            ├─ last_published_at
            └─ timestamps
```

### Why this model

It is the smallest design that simultaneously preserves:

- the existing public runtime contract;
- current `storefront_presentations` ownership and tenant boundary;
- backward compatibility for existing merchants;
- current Published fallback semantics;
- current normalization rules;
- current transactional publication guarantees;

while adding:

- multiple named editable copies;
- independent per-version revisions;
- one live version;
- one scheduled next version in CUST-H1 V1;
- duplication;
- rename;
- exact-version preview;
- safe scheduled publication;
- retention of the former live design.

The existing head row remains the stable compatibility boundary. Version rows are the new merchant lifecycle model.

---

## 1. Evidence that constrains the design

Current repository evidence:

- `storefront_presentations` is **zero-or-one per Storefront**; `unique(storefront_id)` enforces at most one row, while untouched storefronts may have no row.
- It stores one `draft_config` and one `published_config`.
- `StorefrontPresentationService` locks the owned Storefront and presentation row for Save/Publish.
- Draft save uses an integer optimistic-concurrency revision.
- Publish is atomic and server-normalized.
- Public runtime reads only `published_config` and never Draft.
- A failed Publish leaves Published unchanged.
- Foreign Storefronts fail through the established tenant-scoped non-leaking path.
- Current repository search found no generic existing delayed-publication scheduler infrastructure suitable to reuse.

Therefore:

1. replacing the head row would create unnecessary public-runtime and migration risk;
2. multiple copies cannot be represented honestly inside the current row;
3. scheduling requires a real server-side execution path and deploy/runtime support, not a browser timer.

---

## 2. Ownership

### Decision

```
Tenant
  └─ Storefront
       ├─ StorefrontPresentation (0..1)
       └─ StorefrontPresentationVersion (1:N)
```

Both models are CompanyWide, like Storefront.

Tenant authority remains:

`auth User → SetTenant → TenantContext`

Never:

- request body;
- version id;
- storefront id;
- Host for workspace writes;
- query string;
- cookie.

A Version is valid only when:

`version.tenant_id == storefront.tenant_id == TenantContext::id()`

Missing or foreign Storefront/Version returns the same non-leaking **404** semantics used by current Commerce workspace resources.

---

## 3. Existing table evolution

### 3.1 Keep existing columns

Do **not** remove or repurpose:

- `draft_config`
- `draft_revision`
- `published_config`
- `published_revision`
- `published_at`
- `schema_version`

They remain compatibility fields during and after CUST-H1.

### 3.2 Add nullable pointers

Add to `storefront_presentations`:

```
draft_schema_version             unsignedSmallInteger
published_schema_version         unsignedSmallInteger nullable
active_version_id                uuid nullable
scheduled_version_id             uuid nullable
compatibility_working_version_id uuid nullable
```

Backfill / migration sequence:

1. add `draft_schema_version` as nullable (or with a compatibility-safe temporary default) and `published_schema_version` as nullable;
2. backfill `draft_schema_version = existing schema_version`;
3. if `published_config != null`, backfill `published_schema_version = existing schema_version`; otherwise leave null;
4. verify no existing presentation row has null `draft_schema_version`;
5. enforce `draft_schema_version NOT NULL` using the repository's SQLite/PostgreSQL-compatible migration pattern;
6. keep legacy `schema_version` populated for backward compatibility during the transition.

Do not add a non-null/no-default column to a populated table before backfill; PostgreSQL would reject the change and the backfill could never run.

FK strategy:

- all three reference `storefront_presentation_versions.id`;
- `nullOnDelete` is acceptable only through controlled service deletion rules;
- deleting the active version through normal product APIs is forbidden;
- deleting the scheduled version requires schedule cancellation in the same transaction first;
- deleting the compatibility-working version is forbidden while the legacy API compatibility window remains active.

Indexes:

- index(active_version_id)
- index(scheduled_version_id)
- index(compatibility_working_version_id)

### Why pointers live on the head

They establish one authoritative live version, one authoritative scheduled-next version, and one durable legacy compatibility working version without partial unique indexes or status races across SQLite/PostgreSQL.

`compatibility_working_version_id` exists only for the mixed-client compatibility window. It is not merchant-facing state. It gives the legacy GET/PUT/publish endpoints one unambiguous Version target after multiple Draft Versions exist.

Version state is **derived**, not trusted from a merchant-writable status column.

---

## 4. New table — storefront_presentation_versions

### Required columns

```
id                    uuid PK
tenant_id             foreignUuid → tenants cascadeOnDelete
storefront_id         foreignUuid → storefronts cascadeOnDelete
name                  string(120)
schema_version        unsignedSmallInteger
config                json NOT NULL
revision              unsignedInteger default 1
scheduled_for         timestamp nullable
schedule_generation   unsignedInteger default 0
last_published_at     timestamp nullable
created_at
updated_at
```

### Constraints/indexes

- primary `id`
- index(`tenant_id`)
- index(`storefront_id`)
- index(`tenant_id, storefront_id`)
- index(`scheduled_for`)
- index(`storefront_id, scheduled_for`)

Do not require globally unique version names.

A merchant may have two versions with the same display name, although UX should warn/clarify to reduce confusion.

### No SoftDeletes in CUST-H1 V1

Deletion is product deletion, not audit history.

Published/live versions are not deletable by product API.

If future compliance/audit requires tombstones, that is a separate decision.

---

## 5. Version state machine

Version state is calculated server-side.

### Published

`version.id === presentation.active_version_id`

Exactly one or zero active version pointer per Storefront.

### Scheduled

`version.id === presentation.scheduled_version_id`
AND
`version.scheduled_for != null`

### Draft

Any existing version that is neither active nor scheduled.

### Important

Do **not** persist a merchant-writable `status` enum.

This prevents contradictory rows such as two `published` versions.

The API may return a derived `state: draft|scheduled|published`.

---

## 6. One-live / one-scheduled V1 rule

CUST-H1 V1 supports:

- many Draft versions;
- one Published version;
- at most one Scheduled-next version per Storefront.

Why only one Scheduled-next version:

- matches the first merchant need;
- keeps scheduling UX understandable;
- avoids a future-publication queue/state-machine before it is needed;
- lets the head row be the serialized source of truth.

A future Horizon may support a schedule queue/calendar.

---

## 7. Backfill / migration strategy

Migration must be deterministic and preserve current public bytes/meaning.

### Case A — no presentation row

Migration itself creates nothing.

The merchant still receives current virtual/default behavior.

On the **first Version creation** (or, as a defensive fallback, first Version publish), the service must create the missing `storefront_presentations` compatibility head **inside the same ownership-checked transaction**.

Creation requirements:

- lock the owned Storefront;
- attempt a lazy insert with normalized default `draft_config`, `draft_revision = 0`, current legacy `schema_version`, matching non-null `draft_schema_version`, `published_schema_version = null`, and null Published/version pointers;
- rely on `unique(storefront_id)` as the final race authority;
- catch unique violation outside the aborted PostgreSQL transaction and retry-read the winning head, following the existing STORE-BACKEND-1 first-insert pattern;
- only then create/publish Version state.

Therefore a storefront that starts with no presentation row can create its first Version and later publish it without a missing-head dead end.

### Case B — presentation row, Published exists, Draft equals Published

Create one Version:

- name: localized/default migration name such as `التصميم الحالي` / server-neutral internal fallback;
- config = normalized Published;
- revision = max(1, current draft_revision);
- last_published_at = existing `published_at`.

Set `active_version_id` to it.

Set `compatibility_working_version_id` to that same Version unless implementation evidence requires a separately created Draft working copy for the legacy editor.

Keep existing head config fields unchanged.

### Case C — Published exists, Draft differs from Published

Create two versions:

1. Published version from `published_config`, with `last_published_at = existing published_at`.
2. Draft version from `draft_config`, with `revision = max(1, existing draft_revision)`.

Set active pointer to Published version.

Set `compatibility_working_version_id` to the migrated Draft version.

The legacy/current workspace compatibility draft remains `draft_config`, and legacy GET/PUT/publish maps deterministically to `compatibility_working_version_id` until the compatibility window is retired.

No user work is discarded.

### Case D — Draft exists, never Published

Create one Draft version from `draft_config`, with `revision = max(1, existing draft_revision)`.

`active_version_id = null`.

Set `compatibility_working_version_id` to the migrated Draft version.

Public runtime remains AWJ Modern/default exactly as before.

### Idempotency

Backfill must be safely re-runnable or guarded by pointer/version existence so a retry cannot duplicate migrated versions.

Migration code must normalize documents before writing version rows but must not rewrite the existing public head snapshot during migration.

---

## 8. Source-of-truth rules after rollout

### Public runtime

**Still reads `storefront_presentations.published_config`.**

This is intentional.

CUST-H1 does not require the public storefront route to join Versions.

### Version editing

The selected `StorefrontPresentationVersion.config` is the authoritative editable document.

### Active pointer

`active_version_id` identifies which version produced the current Published snapshot.

### Legacy compatibility draft

`draft_config` remains synchronized with the **currently selected compatibility working version only where old API compatibility requires it**.

New CUST-H1 endpoints must not rely on `draft_config` as the source of truth for arbitrary versions.

### Long-term note

A later architecture may retire compatibility draft fields after all clients move to version APIs. CUST-H1 does not remove them.

---

## 9. Version concurrency

Each version has independent:

`revision: uint`

Save contract:

- client sends expected `revision`;
- server locks owned Storefront + head + selected Version;
- mismatch → 409;
- **before normalization**, reject if either the stored Version schema or the incoming document's declared `config.version` is greater than `StorefrontPresentationNormalizer::VERSION`;
- server normalizes only supported-schema config;
- successful save increments Version revision by 1.

An older runtime must never use normalization fallback as an implicit downgrade path for a newer client payload.

No JSON auto-merge.

Two tabs editing different versions do not conflict.

Two tabs editing the same version use independent-version 409 protection.

---

## 10. Workspace API contract

Existing endpoints remain backward compatible during rollout:

```
GET  /api/commerce/workspace/storefronts/{storefront}/presentation
PUT  /api/commerce/workspace/storefronts/{storefront}/presentation
POST /api/commerce/workspace/storefronts/{storefront}/presentation/publish
```

New version endpoints:

### List

```
GET /api/commerce/workspace/storefronts/{storefront}/presentation/versions
```

Returns merchant-safe fields only:

- id
- name
- state (derived)
- revision
- scheduled_for
- schedule_token (opaque, changes on every schedule/reschedule/cancel/replace)
- last_published_at
- created_at
- updated_at

No tenant_id.

### Create new

```
POST /api/commerce/workspace/storefronts/{storefront}/presentation/versions
```

Body:

```json
{
  "name": "رمضان 1448",
  "source_version_id": "<optional uuid>"
}
```

If source omitted:

- architecture implementation decision: use current active version config if available; otherwise current normalized compatibility Draft/default.

No client config injection in the create-copy endpoint.

### Read exact version

```
GET /api/commerce/workspace/storefronts/{storefront}/presentation/versions/{version}
```

Returns:

- metadata;
- normalized config;
- revision.

### Save exact version

```
PUT /api/commerce/workspace/storefronts/{storefront}/presentation/versions/{version}
```

Body:

```json
{
  "config": {},
  "revision": 7
}
```

**Active Published Versions are read-only.** If `version.id === active_version_id`, this endpoint returns a lifecycle conflict (recommended **409**). The merchant must create/duplicate a Draft Version and edit that Draft.

This preserves the invariant that a Version reported as `Published` is byte-for-byte the source of the current public head snapshot. It also ensures duplicating the Published Version copies the live design, never unpublished edits.

### Rename

Use focused metadata endpoint or PATCH:

```
PATCH /api/commerce/workspace/storefronts/{storefront}/presentation/versions/{version}
```

Allowed envelope:

- name
- revision if the implementation uses one revision for metadata+config

Recommendation: one revision token for the row to avoid split concurrency semantics.

### Duplicate

Creation with `source_version_id` is sufficient; no separate duplicate route is required.

### Delete

```
DELETE /api/commerce/workspace/storefronts/{storefront}/presentation/versions/{version}
```

Reject:

- active version;
- scheduled version unless schedule is canceled first;
- `compatibility_working_version_id` while the legacy compatibility window is active;
- foreign version.

### Publish now

```
POST /api/commerce/workspace/storefronts/{storefront}/presentation/versions/{version}/publish
```

Body:

```json
{
  "revision": 7
}
```

If the target Version is currently Scheduled, **Publish Now is rejected with 409**. The merchant must explicitly cancel the schedule first, then Publish Now.

This prevents an older delayed Publish Now request from implicitly canceling a newer schedule/reschedule decision.

### Schedule

```
PUT /api/commerce/workspace/storefronts/{storefront}/presentation/versions/{version}/schedule
```

Schedule body when no storefront schedule currently exists:

```json
{
  "revision": 7,
  "scheduled_for": "2026-10-01T21:00:00+03:00"
}
```

If the Storefront already has **any** scheduled Version — whether the same target or a different target — the request must include the opaque token representing the currently scheduled lifecycle state:

```json
{
  "revision": 7,
  "scheduled_for": "2026-10-02T21:00:00+03:00",
  "expected_current_schedule_token": "<opaque token>"
}
```

Rules:

- no current schedule → token must be absent/null;
- current schedule exists → token is required;
- stale/missing token while a schedule exists → **409**;
- token is validated against the locked head/current scheduled Version before invalidating or replacing anything;
- the rule applies equally to same-target reschedule and different-target replacement.

A stale dialog for Version B therefore cannot erase a newer schedule for Version C.

`schedule_generation` remains an internal persistence/job concurrency value and is never part of the merchant API contract.

Server stores a canonical UTC timestamp.

The API returns an opaque merchant-safe `schedule_token` for the current scheduled lifecycle state. Do not expose raw internal generations or job ids.

Schedule / replace transaction must:

1. lock Storefront/head/target Version;
2. reject active Published target;
3. compare request `revision` to locked target Version revision; mismatch → **409** before any schedule/pointer mutation;
4. read the locked head's current `scheduled_version_id`;
5. if no current schedule exists, require `expected_current_schedule_token` to be absent/null;
6. if a current schedule exists, lock that currently scheduled Version (if different from target) and require `expected_current_schedule_token` to match the current opaque schedule token; missing/stale token → **409**;
7. validate future timestamp;
8. if replacing another scheduled Version, invalidate it by incrementing its internal `schedule_generation` and clearing `scheduled_for`;
9. increment the target Version internal `schedule_generation`;
10. set target Version `scheduled_for`;
11. atomically set head `scheduled_version_id = target.id`;
12. return a new opaque `schedule_token`;
13. commit.

The previously scheduled Version must not retain obsolete schedule metadata after replacement. Its derived state becomes Draft and its `scheduled_for` must be null. Any delayed job for it becomes stale by generation/pointer checks.

**Active Published Versions cannot be scheduled.** If `version.id === active_version_id`, return a lifecycle conflict (recommended **409**). A merchant who wants a future change must create/duplicate a Draft Version first.

This keeps the derived state exclusive: a Version cannot be both Published and Scheduled.

### Cancel schedule

```
DELETE /api/commerce/workspace/storefronts/{storefront}/presentation/versions/{version}/schedule
```

All version write endpoints require existing `commerce.manage` and current workspace middleware. No new permission is introduced in CUST-H1.

---

## 11. Publish transaction

Immediate Publish must:

1. begin DB transaction;
2. lock owned Storefront;
3. lock `storefront_presentations` head;
4. lock target Version;
5. re-check tenant/storefront/version relationship;
6. validate expected Version revision;
7. **before normalization**, require `target.schema_version <= StorefrontPresentationNormalizer::VERSION`; if the Version uses a forward schema unsupported by the running code, abort with a lifecycle/compatibility conflict and leave both the Version and current Published snapshot unchanged;
8. normalize target Version config server-side;
9. enforce document-size limits;
10. if normalization upgrades/transforms the Version document or schema, atomically persist the normalized `config` and resulting `schema_version` back to the target Version before/with publication; define this normalization-only rewrite as **not a merchant edit**, so it does not create a stale-edit surprise or increment the merchant-facing Version revision unless implementation evidence proves revision increment is necessary;
11. copy that exact persisted normalized config to existing head `published_config`;
12. atomically set head `published_schema_version = target.schema_version` using the persisted target schema version;
13. do **not** retag the unrelated compatibility Draft; `draft_schema_version` remains the schema version of `draft_config`;
14. update legacy shared `schema_version` only according to the compatibility strategy chosen in implementation, and never use it as authority for new reads;
15. update `published_revision` with a compatibility monotonic value;
16. update `published_at = now()`;
17. set `active_version_id = target.id`;
18. set target `last_published_at = now()`;
19. commit.

Precondition: the target must not be the current Scheduled Version. Publish Now never clears a schedule implicitly.

The Published document and `published_schema_version` are one atomic pair. The Draft document and `draft_schema_version` are a separate atomic pair. A v2 Published document must never be interpreted through a v1 tag, and publishing v2 must never silently retag a still-v1 legacy Draft.

The active Version row must also remain the exact source of the live snapshot after normalization. Reading or duplicating the active Version later must produce the same document semantics as the public head.

### Forward-schema fail-closed rule

A Version written by a newer deployment must **never** be normalized by an older runtime if `version.schema_version > StorefrontPresentationNormalizer::VERSION`.

This protects rolling deploys and rollbacks from the existing forward-schema fallback behavior that can resolve unsupported documents to the AWJ Modern default.

The guard applies **before any normalization** on every Version path that reads or transforms config:

- exact Version read;
- exact Version save;
- legacy GET/PUT mapping;
- duplicate/create-from-Version;
- immediate Publish;
- scheduled Publish.

For write paths that accept a document body, validate **both**:

1. stored Version/head schema tag is supported; and
2. incoming document's declared `config.version` is not greater than `StorefrontPresentationNormalizer::VERSION`.

Either forward-schema condition fails closed before normalization or persistence.

Unsupported forward-schema Version behavior:

- exact read returns an explicit compatibility error rather than fabricated/default config;
- save is rejected before normalization/persistence;
- duplicate is rejected rather than creating a default-derived copy;
- legacy compatibility calls fail closed if their mapped Version is forward-schema;
- immediate/scheduled publication fails closed.

On failure:

- no Version config/schema mutation;
- no `published_config` mutation;
- no active pointer change;
- no schedule-success mark;
- current live storefront remains unchanged;
- response/job outcome is explicit and observable.

No partial public state is observable.

### Former live version

The former version row remains intact and becomes Draft by derivation when the active pointer moves away.

This gives safe recovery without inventing another status transition.

### Publishing the already-active unchanged version

May be idempotent 200 when the expected revision/config are unchanged.

Do not rewrite `published_at` on a true no-op.

---

## 12. Compatibility published_revision

Existing public/workspace clients may rely on `published_revision`.

Do not redefine it to equal Version revision, because different Versions may have overlapping revision numbers.

CUST-H1 implementation must make `storefront_presentations.published_revision` a **head-level monotonic publication revision**:

- preserve current value on migration;
- each non-no-op publish increments by 1;
- never decrement;
- version revision remains independent.

This is a deliberate evolution from the old equality `published_revision = draft_revision`.

Any old test asserting equality must be replaced only after proving no external contract depends on equality; API compatibility depends on the field remaining numeric/monotonic, not on internal equality.

This contract change must be called out explicitly in the implementation PR.

---

## 13. Scheduling model

### Decision

Schedule state is persisted in DB; execution is server-side.

No browser timers.

The authoritative schedule consists of:

- head `scheduled_version_id`;
- target version `scheduled_for`;
- target version `schedule_generation`.

### schedule_generation

Every schedule/reschedule/cancel increments `schedule_generation`.

A queued/delayed execution carries:

- storefront_id;
- version_id;
- expected schedule_generation.

At execution:

- lock Storefront + head + Version;
- require head scheduled pointer still equals target;
- require Version generation still equals expected;
- require `scheduled_for <= now()`;
- otherwise exit safely/no-op.

This makes stale delayed jobs harmless.

---

## 14. Scheduler runtime contract

Repository evidence did not reveal a reusable delayed-publication worker contract.

Therefore implementation must add a real runtime path and document deployment requirements.

### Preferred execution model

**DB-owned due schedule + isolated execution unit**, with a small recurring dispatcher.

Preferred Production mode is a real asynchronous queue worker/connection.

A Laravel scheduled command runs every minute:

```
storefront-presentations:dispatch-due
```

It selects due scheduled heads/versions in bounded batches and dispatches idempotent publish jobs.

Why not only delayed queue jobs:

- delayed jobs can be lost/reconfigured during deploy/provider changes;
- DB remains authoritative;
- dispatcher can recover due work after downtime.

Why not one monolithic direct scheduler loop:

- one failed publication must not abort/starve later due publications;
- each due item requires independent exception isolation and retry/observability.

### Queue/runtime evidence

Current Production container configuration pins `QUEUE_CONNECTION=sync`.

Therefore **scheduler availability alone is not enough to mark Scheduled Publishing LIVE**.

Production activation requires one of these locked paths:

**Path A — preferred**
- non-sync queue connection;
- always-running queue worker;
- retry/backoff policy;
- failed-job observability;
- scheduler/cron dispatching due work.

**Path B — explicit sync fallback**
- dispatcher processes each due schedule in an isolated try/catch unit;
- one failure cannot abort the batch;
- failed items remain DB-authoritative and retryable on the next pass;
- bounded per-run batch;
- per-item failure logging/metrics;
- starvation test proving a failing first item does not block later due items.

Until one path is verified in Production runtime, Schedule UX remains **GATED**.

### Deployment gate

CUST-H1 Scheduled publishing is **GATED** until Production has:

1. an always-running scheduler path:
   - Laravel scheduler worker/process; or
   - equivalent platform cron invoking `schedule:run`;
2. **and** either:
   - a real non-sync queue worker/connection, or
   - the explicitly verified per-item sync isolation/retry contract above.

Implementation may land code before activation, but UX must not expose LIVE scheduling in Production until both scheduling and execution isolation are verified.

---

## 15. Scheduled publish job

Job identity inputs:

- storefront_id;
- version_id;
- schedule_generation.

Job behavior:

1. establish safe tenant context from persisted authoritative Storefront/Version relation — never from client input;
2. transaction + locks;
3. verify pointer/generation/due time;
4. normalize target config;
5. publish through the same internal transaction path as immediate Publish;
6. clear schedule atomically;
7. mark result through normal logs/observability.

Retry must be idempotent.

If Publish fails:

- current `published_config` is unchanged;
- schedule remains diagnosable;
- implementation must define retry/error observability;
- do not silently mark success.

---

## 16. Schedule / edit semantics

### Editing a scheduled version

Allowed.

But a saved edit increments Version revision while the schedule still points to that Version.

At execution, **the latest saved config of that same scheduled Version** is published.

This is the simplest merchant mental model:

> “I scheduled this design version.”

not:

> “I scheduled a hidden immutable snapshot.”

UX must clearly show “last modified” after scheduling.

If product later requires immutable scheduled snapshots, that is a future change.

### Rename scheduled version

Allowed; no effect on scheduled content.

### Duplicate scheduled version

Allowed; duplicate is Draft with no schedule.

### Delete scheduled version

Not allowed directly.

Cancel first, then delete.

---

## 17. Reschedule and cancel transaction

### Reschedule

Request must include both:

- expected Version `revision`;
- current opaque `schedule_token`.

Transaction:

1. lock Storefront/head/Version;
2. require target is current scheduled pointer;
3. validate `schedule_token` against the locked current schedule generation; mismatch → **409**;
4. compare expected Version `revision` with the locked Version; mismatch → **409** before any schedule change;
5. validate future timestamp;
6. increment generation;
7. update `scheduled_for`;
8. return a new `schedule_token`;
9. commit.

A stale reschedule request cannot overwrite a newer reschedule even when Version content did not change.

A stale reschedule request must never silently schedule a Version whose content changed after the scheduling dialog was opened.

Old execution token becomes stale.

### Cancel

Request must include the current opaque `schedule_token`.

Transaction:

1. lock Storefront/head/Version;
2. require `head.scheduled_version_id === target.id`; if not, return **409** or an explicitly documented stale-cancel no-op — never clear another Version's pointer;
3. validate `schedule_token` against the locked current schedule generation; mismatch → **409**;
4. increment generation;
5. clear target `scheduled_for`;
6. clear head `scheduled_version_id`;
7. commit.

A delayed cancel from an older schedule generation cannot clear a newer schedule for the same Version.

Any old queued job becomes a safe no-op. A delayed cancellation for superseded Version A cannot cancel newer scheduled Version B.

---

## 18. Scheduling timezone

API accepts ISO-8601 with explicit offset.

Store UTC in DB.

API returns:

- UTC canonical timestamp;
- UI formats in the authoritative merchant/store timezone.

### Architecture constraint

Do not assume browser timezone is authoritative.

If AWJ lacks a locked Storefront timezone field at implementation time:

- use the existing authoritative tenant/business timezone if one exists and is proven;
- otherwise make timezone a required architecture dependency before enabling Schedule UX.

For Saudi-first default behavior, `Asia/Riyadh` must not be hard-coded as a universal tenant rule.

---

## 19. Create / duplicate transaction

Creation:

- lock owned Storefront;
- ensure the compatibility head exists using the concurrency-safe lazy-create contract from §7 Case A;
- lock/read the resulting head;
- resolve optional source Version within same Storefront/Tenant;
- choose source config;
- normalize;
- create new Version revision 1;
- scheduled_for null;
- schedule_generation 0;
- last_published_at null.

If copying the active version, the copy is still Draft.

No public head field changes.

---

## 20. Delete rules

Delete is allowed only if Version is:

- same Tenant/Storefront;
- not active;
- not scheduled;
- not the compatibility working Version during the legacy compatibility window.

Delete is a serialized lifecycle transaction:

1. begin transaction;
2. lock owned Storefront;
3. lock presentation head;
4. lock target Version;
5. re-check tenant/storefront relationship;
6. re-check `active_version_id`, `scheduled_version_id`, and `compatibility_working_version_id` **after all locks are held**;
7. reject with lifecycle conflict if any pointer now references the target;
8. delete the Version;
9. commit.

This uses the same lock order as Publish/Schedule to prevent Delete racing with a lifecycle pointer change.

Deleting an eligible Draft has no public effect.

FK `nullOnDelete` is only a defensive last resort, not product lifecycle logic. Normal product APIs must never rely on it to clear a pointer that became active/scheduled concurrently.

---

## 21. Legacy API behavior

During CUST-H1 rollout:

### GET legacy presentation

Continue returning:

- draft
- draft_revision
- published
- published_revision
- published_at

The Draft side is backed by the durable head pointer `compatibility_working_version_id`. If the pointer is null during transition, the service deterministically creates/selects the compatibility working Version under the same transaction/locking rules and persists the pointer before returning mutable legacy state.

### PUT legacy presentation

Compatibility behavior is explicit:

- lock Storefront + head + `compatibility_working_version_id` Version;
- fail closed if the mapped Version schema is newer than the running normalizer;
- map the legacy Draft API only to that persisted Version;
- normalize through the supported server schema;
- synchronize head `draft_config`, `draft_schema_version`, and `draft_revision` **atomically** for old response semantics;
- never select “an arbitrary Draft” by recency/name/query order;
- legacy calls cannot mutate another named Version.

The Draft document and `draft_schema_version` must always be written as one atomic pair.

### Legacy publish

Map only to `compatibility_working_version_id`.

If the compatibility Version is also the current active Published Version, legacy editing must first fork/create a Draft compatibility Version; it must not mutate the active row in place.

Runtime fork revision rule:

- the fork starts with `revision = current legacy draft_revision` (minimum 1);
- the legacy PUT validates the caller's expected `draft_revision` against that preserved value;
- the same transaction then applies the requested save and increments both the compatibility Version revision and legacy head `draft_revision` consistently;
- the new `compatibility_working_version_id` is persisted atomically.

This prevents an unchanged legacy client from seeing a revision reset or spurious 409 during the Active→Draft compatibility fork.

New Customizer UI moves to Version APIs.

After migration and adoption, legacy endpoints may be deprecated only through a separate compatibility decision.

---

## 22. Public runtime

No public API shape change is required.

`GET /store/v1/storefront` continues to expose only Published presentation.

Public rendering remains based on the head's `published_config`.

Benefits:

- no extra join;
- no cache semantic change;
- no leak of version metadata;
- no leak of scheduled designs;
- no leak of private version names.

---

## 23. Cache behavior

Keep current presentation runtime `no-store` semantics unless a separate performance decision changes them.

Publish transaction updates the compatibility Published snapshot, so public runtime sees the new design through the same path as today.

Version-list/editor APIs are authenticated workspace data and should not be treated as public cacheable documents.

---

## 24. Authorization

Reuse:

- auth:sanctum
- EnsureUserPrincipal
- SetTenant
- SetBranch where current Commerce workspace requires it
- EnsureActiveSubscription
- EnsurePermission:commerce.manage
- existing self_service deny behavior

No `commerce.appearance` permission in CUST-H1.

Version IDs are row selectors, never authorization sources.

---

## 25. Normalization and document size

Reuse `StorefrontPresentationNormalizer` as server authority.

Every Version Save and Publish:

- normalizes;
- drops unknown fields;
- applies URL/logo/token safety;
- applies schema version;
- enforces existing document size limits.

Versions do not weaken current presentation security.

---

## 26. API response model

Suggested exact Version resource:

```json
{
  "id": "uuid",
  "storefront_id": "uuid",
  "name": "رمضان 1448",
  "state": "draft",
  "schema_version": 2,
  "config": {},
  "revision": 7,
  "scheduled_for": null,
  "last_published_at": null,
  "created_at": "...",
  "updated_at": "..."
}
```

List endpoint may omit `config` for payload efficiency.

Do not expose:

- tenant_id;
- schedule_generation;
- internal job ids;
- internal compatibility pointers.

---

## 27. Error semantics

- 401 unauthenticated
- 403 missing permission / invalid principal / subscription
- 404 missing or foreign Storefront
- 404 missing or foreign Version
- 409 stale Version revision
- 409 schedule/publish state conflict
- 422 invalid envelope
- 422 invalid/past scheduled_for
- 422 active/scheduled Version deletion attempt may instead use 409 if treated as state conflict; choose one consistently in implementation contract
- 422 oversize normalized document

Recommendation: use **409** for valid resource + invalid lifecycle state; 422 for malformed semantic input.

---

## 28. Dual-DB constraints

Architecture must work on SQLite and PostgreSQL.

Do not depend on:

- PostgreSQL-only partial unique indexes;
- exclusion constraints;
- advisory locks.

One-active/one-scheduled rules are enforced through the locked head row pointers.

True concurrency tests should run on PostgreSQL where repository convention already allows SQLite skips for race-specific tests.

---

## 29. Required implementation tests

### Migration/backfill

- no row;
- draft only;
- published == draft;
- published != draft;
- rerun/idempotency;
- schema normalization;
- no public snapshot mutation;
- compatibility Draft Version preserves existing draft_revision in Cases C and D;
- dual-write/cutover test proving a legacy Draft save committed immediately before backfill is present in the resulting compatibility Version;
- deployment guard prevents head-only legacy writers during backfill.

### Version CRUD

- create blank/from current;
- duplicate;
- rename;
- exact read;
- save;
- delete eligible;
- active delete blocked;
- scheduled delete blocked;
- compatibility-working delete blocked during legacy compatibility window;
- save to active Published Version blocked;

### Isolation

- tenant A cannot list/read/save/publish/schedule/delete tenant B version;
- same-tenant Storefront A version cannot be used under Storefront B URL;
- no body authority override.

### Concurrency

- same-version stale save;
- different-version independent save;
- publish vs save;
- publish vs publish;
- initial schedule stale revision → 409 with no schedule mutation;
- replacing scheduled Version A with B clears A.scheduled_for and invalidates A.schedule_generation atomically;
- schedule vs reschedule;
- stale reschedule revision → 409 with no schedule mutation;
- stale expected_current_schedule_token on same-target reschedule → 409;
- stale expected_current_schedule_token on different-target schedule replacement → 409;
- stale schedule_token on cancel → 409;
- reordered reschedule/cancel requests cannot overwrite or clear newer scheduling state;
- stale cancel for superseded Version cannot clear newer scheduled pointer;
- schedule vs cancel;
- stale job generation no-op.

### Publication

- active pointer changes atomically;
- old live Version retained;
- Published compatibility snapshot updated;
- normalization-on-publish persists back to the target Version so active Version == live snapshot;
- published_schema_version changes atomically with published_config;
- draft_schema_version remains paired with draft_config;
- publishing v2 after migrated v1 head preserves v2 semantics in public normalization without reinterpreting a v1 compatibility draft;
- failed publish leaves old snapshot;
- forward-schema Version is rejected before normalization and leaves Version + Published snapshot unchanged;
- forward-schema exact read/save/duplicate/legacy paths fail closed without fabricating defaults;
- incoming save payload with forward `config.version` fails closed before normalization;
- scheduled forward-schema Version also fails closed without replacing live;
- idempotent republish;
- public runtime sees only current Published.

### Scheduling

- future validation;
- UTC persistence;
- due dispatcher;
- duplicate dispatch;
- stale job;
- canceled job;
- rescheduled job;
- execution failure;
- scheduler recovery after late run.

### Legacy compatibility

- old GET/PUT/publish tests remain or are deliberately adapted;
- current frontend can survive transition until it moves to version endpoints.

---

## 30. Implementation slicing

After this architecture is approved, implementation should be split by risk:

### CUST-H1-1 — Version persistence foundation

- migration;
- model;
- version-aware compatibility dual-write/read path;
- rollout/cutover guard proving no head-only legacy writer remains before backfill;
- backfill;
- version CRUD/read APIs;
- revision/isolation tests;
- no scheduling activation.

### CUST-H1-2 — Version-aware Customizer UX

- version manager;
- create/duplicate/rename/switch/delete;
- exact-version editing/preview;
- mobile/desktop UX;
- no Schedule button LIVE yet unless backend scheduler is ready.

### CUST-H1-3 — Immediate version publishing

- publish endpoint;
- active pointer;
- compatibility head update;
- retain former live version;
- public parity tests.

### CUST-H1-4 — Scheduling backend/runtime

- schedule/cancel/reschedule APIs;
- dispatcher;
- idempotent publish job;
- runtime scheduler deployment contract;
- concurrency/failure tests.

### CUST-H1-5 — Scheduling UX + Integrated QA

- schedule UI;
- timezone copy;
- state badges;
- responsive QA;
- failure UX;
- end-to-end immediate/scheduled lifecycle.

Then PRE_MERGE_REVIEW and Horizon Closure.

Do not combine all five into one large PR.

---

## 31. Rejected alternatives

### Replace head with Versions immediately

Rejected for CUST-H1.

Reason: unnecessary migration/public-runtime/API risk.

### Store all Versions in one JSON array on head

Rejected.

Reason: poor concurrency, large writes, no row-level isolation, difficult scheduling/deletion/listing.

### Add version1_config/version2_config columns

Rejected.

Reason: fixed-capacity non-model.

### Status enum as source of truth

Rejected.

Reason: multiple Published/Scheduled rows can drift; cross-DB uniqueness awkward.

### Immutable version on every keystroke/save

Rejected.

Reason: that is revision history, not named merchant copies; storage churn.

### Client/browser scheduling

Rejected.

Reason: unsafe and non-authoritative.

### Queue delay as only source of schedule truth

Rejected.

Reason: recovery after queue/deploy disruption is weaker than DB-authoritative schedule + dispatcher.

---

## 32. Security stop gates

Stop implementation if it would require:

- exposing unpublished config through anonymous public routes;
- deriving tenant from Version id;
- accepting authority fields from request body;
- weakening current URL/logo/HTML safety;
- changing Commerce pricing/catalog truth;
- making browser timer authoritative;
- hard-coding one timezone for all tenants;
- breaking old Published rendering during migration.

---

## 33. Definition of architecture complete

This architecture is ready for implementation only after review confirms:

- [x] ownership graph defined;
- [x] table/column/index/FK strategy defined;
- [x] one-live/one-scheduled model defined;
- [x] state derivation defined;
- [x] migration/backfill defined;
- [x] public compatibility strategy defined;
- [x] version concurrency defined;
- [x] immediate publish transaction defined;
- [x] schedule generation/idempotency defined;
- [x] scheduler runtime dependency defined;
- [x] API shapes defined;
- [x] auth/404 semantics defined;
- [x] dual-DB constraints defined;
- [x] failure semantics defined;
- [x] test matrix defined;
- [x] implementation slices defined;
- [x] rejected alternatives recorded.

Remaining before runtime code:

- owner/architecture review;
- CI on documentation PR;
- explicit decision to proceed with implementation slices.

---

*Documentation only. No DB/API/runtime/merge/deploy is authorized by this file.*


---

## 34. Final architecture consistency checklist

Before CUST-H1 implementation starts, the following invariants are treated as one contract:

- [x] StorefrontPresentation cardinality is **0..1**, never assumed mandatory before first persisted customization.
- [x] One Storefront has many Version rows, but at most one active and one scheduled-next pointer.
- [x] Version state is derived from head pointers; no merchant-writable status authority exists.
- [x] Active Published Version is immutable through normal Save; editing requires a Draft.
- [x] Active Published Version cannot also be Scheduled.
- [x] Compatibility working Version is durable and cannot be deleted during the mixed-client window.
- [x] Legacy Draft config/revision/schema tag move atomically.
- [x] Published config/revision/schema tag move atomically.
- [x] Active Version config/schema remains semantically identical to the public Published snapshot after normalization.
- [x] Forward-schema documents fail closed before normalization across read/save/duplicate/legacy/immediate/scheduled paths.
- [x] Raw `schedule_generation` is internal only; merchant API uses opaque schedule tokens.
- [x] Any existing storefront schedule must be matched by `expected_current_schedule_token` before same-target reschedule or different-target replacement.
- [x] Publish Now cannot implicitly cancel a scheduled lifecycle state; Scheduled must be explicitly canceled first.
- [x] Initial schedule, replacement, reschedule, cancel, and delayed jobs all invalidate stale executions deterministically.
- [x] Delete uses the common Storefront → head → Version lock order and rechecks pointers under lock.
- [x] Public runtime remains Published-head-only and never exposes Draft/Scheduled data.
- [x] Tenant authority comes only from authenticated TenantContext; IDs are selectors, never authority.
- [x] SQLite/PostgreSQL compatibility does not depend on PostgreSQL-only partial unique indexes.
- [x] Scheduling UX remains gated until scheduler + execution isolation are verified in Production.
- [x] No Merge/Deploy/Production activation is authorized by this architecture document.
