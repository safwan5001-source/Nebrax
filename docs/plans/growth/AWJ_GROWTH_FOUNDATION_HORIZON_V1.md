# AWJ Growth Foundation Horizon V1

**Status:** READY FOR OWNER REVIEW  
**Base SHA:** `82e5199fe75d06bb3546802d141f42da92e3a63f`  
**Execution:** نظام الأفق / Claude Code  
**Merge authority:** Not granted by this document; requires Safwan's explicit launch/merge authorization.  
**Depends on:** `docs/commerce/AWJ_GROWTH_PLATFORM_V1.md`, `docs/commerce/AWJ_GROWTH_EVIDENCE_1.md`

## Goal

Build the provider-neutral foundation for AWJ Growth before any real provider OAuth, ad spend, publishing, messaging send, or production provider action.

This horizon establishes:

- tenant-owned provider connections;
- provider/capability registry;
- connection lifecycle;
- encrypted credential custody;
- RBAC;
- append-only audit;
- provider adapter seams;
- read-only connection/status APIs;
- provider-neutral webhook intake boundary.

## Existing AWJ authority to reuse

- `app/Models/BaseModel.php`: tenant business models inherit tenant isolation.
- `app/Support/Rbac.php`: central permission source.
- `app/Http/Middleware/EnsurePermission.php`: route-level RBAC.
- `app/Models/PlatformIntegrationSetting.php`: useful encrypted-at-rest pattern, but platform-global and **not** the tenant Growth authority.
- Document Center: useful provider-registry/secret-masking patterns, not ownership semantics.
- Existing POS/Document Center audit patterns: use as append-only evidence precedent.
- `AWJ_GROWTH_EVIDENCE_1.md`: exact capability vocabulary and provider evidence.

## Locked decisions

### Tenant ownership

Every Growth connection belongs to exactly one tenant.

Never:
- accept client-supplied `tenant_id`;
- resolve tenant from provider account id alone;
- fall back across tenants;
- reveal foreign-tenant existence through error details.

### Company-wide classification

Growth connections are tenant-wide, not branch-owned. New Growth persistence models must use the repository's explicit CompanyWide classification required by branch-isolation guards.

### Secret custody

Provider credentials/tokens:
- encrypted at rest;
- hidden from serialization;
- never returned after write;
- never logged;
- never included in audit payloads;
- accessed only through a dedicated credential service.

Do **not** reuse `PlatformIntegrationSetting` as tenant connection authority.

### Capability vocabulary

Use exactly:

```text
VERIFIED
VERIFIED_WITH_GATES
PARTIAL
OPEN
NOT_APPLICABLE
```

Connection lifecycle:

```text
pending
connected
expired
revoked
error
```

### No live provider actions in this horizon

Forbidden:
- real OAuth redirect/callback;
- external token exchange;
- campaign create/update/pause;
- budget mutation;
- live publishing;
- live messaging;
- provider-specific SDK lock-in;
- production credentials.

### No accounting effects

No invoices, payments, journals, inventory, pricing, tax, or ZATCA changes.

## Domain contract

### GrowthConnection

Proposed durable model:

```text
GrowthConnection
├── id UUID
├── tenant_id UUID
├── provider string
├── provider_account_id nullable string
├── display_name nullable string
├── status string
├── granted_scopes json
├── credentials encrypted json   (added in GF-2, not GF-1)
├── connected_at nullable datetime
├── expires_at nullable datetime
├── last_refreshed_at nullable datetime
├── revoked_at nullable datetime
├── last_error_code nullable string
├── created_by nullable UUID
├── updated_by nullable UUID
└── timestamps
```

GF-1 schema note:
- GF-1 creates the connection identity/lifecycle columns **without a credentials column**.
- GF-2 adds the credentials column/cast together with the dedicated custody service so there is never an interim plaintext-secret path.

Constraints:
- tenant-scoped uniqueness where appropriate;
- never global uniqueness on provider account id;
- credentials hidden;
- normalized/deduplicated scopes;
- additive migration only;
- PostgreSQL + SQLite compatibility.

### Capability registry

V1 capability definitions are code-backed, not tenant-editable DB truth.

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

Each capability exposes:
- provider;
- capability key;
- state;
- required scopes;
- review requirement;
- business-account requirement;
- regional status.

### GrowthConnectionAudit

Append-only company-wide evidence:

```text
GrowthConnectionAudit
├── id UUID
├── tenant_id UUID
├── growth_connection_id nullable UUID
├── actor_id nullable UUID
├── action string
├── provider string
├── safe_metadata json
└── created_at
```

Minimum actions:
- connection_created
- connection_metadata_updated
- connection_status_changed
- credentials_replaced
- connection_revoked

Metadata must be bounded and reject secret-bearing keys/values.

## RBAC

Add to `Rbac::PERMISSIONS` only:

```text
growth.view
growth.connections.manage
growth.ads.manage
growth.budget.manage
growth.publishing.manage
growth.messaging.manage
```

Do not add them to accountant/staff/self_service defaults. Owner/admin continue through `*`.

This horizon actively uses:
- `growth.view`
- `growth.connections.manage`

## API contract

Prefix: `/api/growth`

```text
GET  /providers
GET  /connections
GET  /connections/{id}
POST /connections
PUT  /connections/{id}
POST /connections/{id}/revoke
```

Rules:
- current Sanctum + TenantContext stack;
- foreign id => non-revealing 404;
- no client tenant id;
- credentials write-only;
- unknown envelope keys rejected where current AWJ pattern supports strict envelopes;
- no provider network calls.

## Credential service boundary

Expected service:

```text
GrowthCredentialService
- replace(connection, secretPayload, actor)
- clear(connection, actor)
- hasCredentials(connection): bool
- decryptForProviderUse(connection): internal-only array
```

API may expose only `has_credentials: true|false`.

No token fragments, logs, audit secrets, queue secrets, or response secrets.

## Minimal UI scope

Allowed:
- Growth → Connections;
- provider list;
- connection status;
- capability availability;
- local metadata edit/revoke;
- explicit not-connected / provider-authorization-later states.

Not allowed:
- fake OAuth;
- campaign builder;
- budgets;
- analytics dashboard;
- publishing composer;
- WhatsApp send UI.

Follow AWJ design system and RTL/LTR + light/dark + explicit loading/empty/error states.

## Task queue

### GF-1 — Domain + RBAC + Capability Registry
- enums/value objects;
- GrowthConnection migration/model **excluding credential storage**;
- provider registry;
- capability registry;
- RBAC additions;
- CompanyWide classification;
- focused tests.
- **No HTTP write endpoints, credentials, OAuth, webhooks, or UI.**

### GF-2 — Credential Custody + Audit
- encrypted credentials;
- hidden serialization;
- credential service;
- append-only audit;
- secret-leakage negatives;
- cross-tenant secret negatives.

### GF-3 — Read API
- providers list;
- connections list/show;
- capability output;
- `growth.view`;
- tenant isolation;
- non-revealing foreign ids.

### GF-4 — Local Connection Lifecycle API
- create/update/revoke local records;
- `growth.connections.manage`;
- actor propagation;
- lifecycle guards;
- idempotent revoke;
- no provider network.

Client-writable fields in this horizon are intentionally narrow. A client may choose the provider and local display metadata only. The client must **not** set or spoof:
- `tenant_id`;
- `status`;
- `provider_account_id`;
- `granted_scopes`;
- `connected_at` / `expires_at` / `last_refreshed_at`;
- `last_error_code`.

Create starts as `pending`. Only the explicit local revoke action may transition it to `revoked` in this horizon. Provider-authoritative connection/scopes/account metadata are populated only in later provider integration horizons after verified OAuth/API evidence.

### GF-5 — Minimal Connections UI
- provider/status/capability presentation;
- ar/en + RTL/LTR;
- loading/error/empty/ready;
- permission-aware actions;
- no fake authorization.

### GF-6 — Webhook Intake Boundary + Closure
- provider-neutral receipt/verification interface;
- idempotency/replay tests;
- no business mutation;
- horizon regression;
- closure report.

## Dependency order

```text
GF-1 → GF-2 → GF-3 → GF-4 → GF-5 → GF-6
```

No dependent stacked PRs by default. Each task unlocks only after previous merge + POST_MERGE_REVIEW PASS + durable report.

This horizon document does **not** itself grant standing merge authority. If Safwan launches Claude Code without explicitly granting merge authority for this horizon, Claude must stop at the merge gate after `PRE_MERGE_REVIEW: PASS` and request approval. Deploy/Production authority is never implied.

## Mandatory negative tests

Across the horizon prove:

- foreign tenant connection cannot be read;
- foreign tenant connection cannot be mutated;
- foreign tenant credentials cannot be retrieved;
- tenant spoofing ignored/rejected;
- accountant/staff without explicit custom permission denied;
- self_service denied;
- client cannot create/update a connection as `connected` or inject provider-authoritative account/scope metadata;
- revoked connection cannot silently become connected;
- credentials never serialize;
- credentials never enter audit;
- unknown provider fails closed;
- invalid capability state impossible;
- malformed scopes fail safely;
- new BaseModel models pass branch-isolation classification guard.

## Backward compatibility

Additive only.

Do not:
- rename existing commerce/developer/app-builder APIs;
- repurpose existing permissions;
- repurpose `PlatformIntegrationSetting`;
- change existing role defaults;
- change tenant middleware semantics.

## Decision escalation

Escalate only material decisions, including:
- strategic KMS/secret-manager change;
- provider OAuth/security design that changes custody;
- destructive migration/backfill;
- platform-admin cross-tenant Growth visibility;
- shared provider credentials across tenants;
- live provider network execution;
- provider billing policy;
- real ad spend/budget action;
- production credentials;
- Production Deploy/Release.

Routine code structure, validation, naming, tests and local refactors are autonomous.

## Definition of Done

Horizon closes only when:
- GF-1..GF-6 merged;
- PRE_MERGE_REVIEW + POST_MERGE_REVIEW recorded for each;
- Tenant Isolation proven;
- RBAC proven;
- secret leakage tests green;
- no live provider write exists;
- no financial/inventory/ZATCA impact;
- UI bidi/accessibility verified where applicable;
- final closure report contains PR/Base/Head/Merge SHAs/tests/CI;
- next provider-read horizon is recommended but not started automatically.

Recommended next major horizon:
**AWJ Growth Provider Read Integrations V1**.
