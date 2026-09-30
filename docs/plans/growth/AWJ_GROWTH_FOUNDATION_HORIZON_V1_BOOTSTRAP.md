# AWJ Growth Foundation Horizon V1 — Claude Code Bootstrap

Execute **AWJ Growth Foundation Horizon V1** under **نظام الأفق** from latest `origin/main`.

## Start

1. Fetch latest `origin/main`; report exact Base SHA.
2. Confirm these are present on current `main`:
   - `docs/commerce/AWJ_GROWTH_PLATFORM_V1.md`
   - `docs/commerce/AWJ_GROWTH_EVIDENCE_1.md`
   - `docs/plans/growth/AWJ_GROWTH_FOUNDATION_HORIZON_V1.md`
3. Read:
   - `CLAUDE.md`
   - `.claude/AUTONOMOUS_ENGINEERING.md`
   - `docs/autonomous-engineering/AWJ-HORIZON-SYSTEM.md`
   - `docs/autonomous-engineering/AUTONOMOUS-ENGINEERING-PROTOCOL.md`
   - `docs/autonomous-engineering/QUALITY-GATES.md`
   - `docs/autonomous-engineering/DECISION-ESCALATION.md`
   - `docs/autonomous-engineering/IMPLEMENTATION-REPORT-CONVENTION.md`
   - the three Growth authority documents above.
4. Inspect only implementation patterns needed by GF-1:
   - `app/Models/BaseModel.php`
   - CompanyWide/branch isolation interfaces and guard tests;
   - `app/Support/Rbac.php`
   - `app/Http/Middleware/EnsurePermission.php`
   - current tenant-scoped service/API tests;
   - `PlatformIntegrationSetting` only as encrypted-storage precedent;
   - Document Center registry/audit patterns only where useful.
5. Do not broadly rediscover the repository.

## Authorized horizon

```text
GF-1 Domain + RBAC + Capability Registry
GF-2 Credential Custody + Audit
GF-3 Read API
GF-4 Local Connection Lifecycle API
GF-5 Minimal Connections UI
GF-6 Webhook Intake Boundary + Closure
```

Start with **GF-1 only**.

After each task:
inspect → implement smallest correct slice → focused/risk tests → Implementer review → Reviewer review → AWJ Guardian → final diff → exact-final-Head CI → PRE_MERGE_REVIEW PASS → **merge only if Safwan's launch instruction explicitly grants merge authority for this horizon; otherwise stop and request approval** → actual Merge SHA → POST_MERGE_REVIEW PASS → durable implementation report → next dependency-ready task.

Do not wait for “continue” between normal stages.

## Non-negotiables

- Tenant Isolation first.
- Every tenant business model extends `BaseModel`.
- New Growth models must use correct CompanyWide/branch classification.
- Never accept client-supplied tenant id.
- No cross-tenant fallback.
- Do not reuse `PlatformIntegrationSetting` as tenant Growth authority.
- Provider credentials encrypted at rest, hidden, write-only externally.
- No secrets in API/log/audit/test snapshots.
- Exact capability vocabulary from Evidence 1.
- New Growth permissions are not auto-added to accountant/staff/self_service.
- No live provider OAuth/network calls in this horizon.
- No campaign/ad/budget/publish/message external writes.
- No accounting/payment/inventory/pricing/tax/ZATCA changes.
- No unrelated refactor.
- This bootstrap does **not** itself grant standing merge authority. Safwan must explicitly grant it when launching the horizon, or Claude must stop before each merge.
- Merge ≠ Deploy.
- Never Production Deploy/Release without Safwan's explicit approval.

## GF-1 exact outcome

Implement only:

1. provider key enum/registry;
2. capability status enum/registry;
3. connection lifecycle status enum;
4. `GrowthConnection` tenant-scoped CompanyWide model + additive migration **without credential storage in GF-1**;
5. RBAC permissions:
   - `growth.view`
   - `growth.connections.manage`
   - `growth.ads.manage`
   - `growth.budget.manage`
   - `growth.publishing.manage`
   - `growth.messaging.manage`
6. no default accountant/staff/self_service grants;
7. tests proving:
   - schema/model constraints;
   - Tenant Isolation;
   - CompanyWide classification guard;
   - exact registry/capability vocabulary;
   - owner/admin wildcard behavior unchanged;
   - restricted roles do not receive Growth permissions by default;
   - unknown provider/state fails closed.

GF-1 must **not** create:
- HTTP mutation endpoints;
- any credentials column/cast/service or secret write path (GF-2 owns credential storage end-to-end);
- OAuth;
- webhooks;
- UI;
- external provider clients.

## Locked keys

Provider keys:

```text
meta
instagram
whatsapp
tiktok_ads
tiktok_content
snapchat
google_ads
youtube_ads
```

Capability states:

```text
VERIFIED
VERIFIED_WITH_GATES
PARTIAL
OPEN
NOT_APPLICABLE
```

Connection states:

```text
pending
connected
expired
revoked
error
```

If repository enum conventions require internal casing differences, preserve the external/domain meaning and document explicit mapping; never silently invent different states.

## Migration requirements

- additive only;
- UUID primary key;
- tenant FK/index consistent with existing models;
- no global provider-account uniqueness;
- no destructive backfill;
- PostgreSQL + SQLite;
- rollback verified;
- indexes only when justified;
- no speculative columns outside the locked contract without evidence;
- GF-1 must not add a credentials column; GF-2 adds encrypted credential storage atomically with its custody service and leakage tests.

## GF-4 lifecycle authority constraint

When GF-4 is reached, the local API must not let clients claim provider-authenticated state.

Client-writable local fields are limited to provider selection and safe display metadata. Reject/ignore spoofing of:
- `tenant_id`;
- `status`;
- `provider_account_id`;
- `granted_scopes`;
- connection/expiry/refresh timestamps;
- provider error state.

A locally created record starts `pending`. In this horizon the only externally-triggerable status transition is explicit local revoke → `revoked`. `connected`, provider account identity and granted scopes are provider-authoritative and belong to later verified provider OAuth/API horizons.

Add negative tests for create/update attempts that inject those fields.

## Testing policy

Run progressively:
1. closest unit/model/RBAC tests;
2. focused feature/isolation tests;
3. SQLite;
4. PostgreSQL where persistence is touched;
5. relevant broader regression;
6. CI on exact final Head.

Do not reduce tests to make CI green.

Any cross-tenant leakage or secret exposure is a blocker.

## Review policy

### Implementer
Smallest correct implementation; no duplicate authority.

### Reviewer
Inspect:
- enum drift;
- validation gaps;
- lifecycle bypass;
- serialization leakage;
- unnecessary abstraction;
- backward compatibility;
- races/idempotency where relevant.

### AWJ Guardian
Inspect:
- Tenant Isolation;
- CompanyWide classification;
- RBAC;
- credential boundaries;
- auditability;
- provider boundary;
- no financial/inventory/ZATCA effects.

## CI

Inspect failing job/log first.
Fix only task-caused failures.
Avoid repeated polling.
Any Head change invalidates PRE_MERGE_REVIEW.

## Decision Gate

Use `docs/autonomous-engineering/DECISION-ESCALATION.md`.

Escalate material decisions such as:
- new strategic secret custody/KMS;
- platform-admin cross-tenant visibility;
- shared credentials across tenants;
- live provider auth/network;
- destructive schema;
- provider billing/financial authority;
- production credentials;
- real spend;
- Production Deploy/Release.

Provide a complete Decision Packet and continue independent safe work if possible.

## Required implementation report per task

Include:

- task;
- branch;
- Base SHA;
- final Head SHA;
- PR number;
- exact changed files;
- implementation summary;
- exact tests/results;
- SQLite/PostgreSQL;
- web build/typecheck when relevant;
- CI;
- Tenant Isolation evidence;
- RBAC evidence;
- secret-leakage evidence;
- `PRE_MERGE_REVIEW: PASS`;
- Merge SHA;
- `POST_MERGE_REVIEW: PASS`;
- risks/deferred;
- next dependency-ready task.

## Horizon end

After GF-6:
- write final closure report;
- prove no live provider write/spend exists;
- list PR/Merge SHAs;
- list provider-specific open decisions;
- recommend next read-only provider integration horizon;
- STOP.

Do not automatically start a new major horizon.

## Begin

Synchronize latest `origin/main`, verify the Growth authority docs, execute GF-1, and continue through this horizon under نظام الأفق.

**Evidence before assumption. Safety before speed. No false completion. No unnecessary interruption.**
