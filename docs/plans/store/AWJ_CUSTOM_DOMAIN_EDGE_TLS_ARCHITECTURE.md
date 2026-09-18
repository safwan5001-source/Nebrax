# CUSTOM-DOMAIN-EDGE-ARCH-1 — Custom Domain Edge/TLS Provisioning Architecture

**Status:** Architecture / evidence pass. Docs only. Not implemented. Not merged. Not deployed.  
**Date:** 2026-09-18  
**Repository:** `safwan5001-source/Nebrax`  
**Base:** latest `main` `ce148502138cf8aef2349dd9f3f3938f9b790802` (PR #861 merge)  
**Decision:** **CASE B — Implementable with constrained V1**

This document does not change production code, schema, Railway configuration, or the TXT ownership contract.

---

## 1. Executive Summary

AWJ already proves **DNS ownership** of a merchant custom hostname (`verification_status = verified` via `_awj-verification.<hostname>` / `awj-domain-verification=<token>`). PR #861 correctly refuses Make Primary for every `custom` domain because **ownership is not HTTPS readiness**.

Railway’s public GraphQL API **can** register a custom hostname on a service, return the routing CNAME + a **second** ownership TXT, report DNS/certificate status, and delete the binding. Let’s Encrypt issuance is automatic after both Railway DNS records are in place.

The smallest safe V1 is therefore:

1. Merchant completes existing AWJ TXT ownership (unchanged).
2. AWJ server registers the hostname on the **storefront Next.js** Railway service (`customDomainCreate`).
3. Merchant adds Railway’s CNAME **and** Railway’s TXT (`status.verificationToken` / `_railway-verify.<hostname>`). This is a **different** TXT from AWJ’s ownership record. Do not reuse or replace `_awj-verification`.
4. AWJ polls/checks Railway until certificate status is **ISSUED**.
5. Only then is the domain eligible for Make Primary.
6. Disconnect deletes the Railway binding **before** the DB row.

**Automation of the full loop:** `PARTIALLY_SUPPORTED`.

- Register / status / delete / certificate-backed readiness: **SUPPORTED** by Railway API.
- Merchant DNS configuration: **manual** (required).
- TLS issuance: **asynchronous** (typically < 1 hour; DNS can take up to 72 hours).
- Current AWJ Railway **plan / domain-count quota:** **UNKNOWN** (not readable from this repository; do not guess).
- Platform default: Hobby **2** custom domains per service; Pro **20** per service (increase on request). This is a **scale** constraint for multi-tenant SaaS, not a V1 API blocker.

**V1 constraints (required):**

- Subdomain hostnames only (`shop.merchant.com`). No apex/root (`merchant.com`).
- No HTTP probe of the merchant hostname (no SSRF).
- No queue worker in V1 (`QUEUE_CONNECTION=sync` in production Docker). Merchant-driven “Check HTTPS” plus short server-side Railway queries.
- Make Primary for custom stays fail-closed until a **fresh** Railway certificate=`ISSUED` observation, not a stale boolean.
- Do not auto-provision existing verified custom domains on deploy.

---

## 2. Current Repository Evidence

### StorefrontDomain fields (authoritative)

Source: `app/Models/StorefrontDomain.php`, migrations `2026_09_20_020000_create_storefront_domains_table.php` and `2026_09_21_010000_add_verification_challenge_to_storefront_domains_table.php`.

| Field | Type / values | Role |
|---|---|---|
| `id` | UUID PK | Row id |
| `tenant_id` | UUID FK | Tenant ownership |
| `storefront_id` | UUID FK | Storefront ownership |
| `hostname` | string(253), **globally unique** | Normalized via `HostnameNormalizer` on set |
| `type` | `awj_subdomain` \| `custom` | AWJ-managed vs merchant |
| `is_primary` | bool, default false | Exclusive among **active** primaries per storefront (`storefront_domains_one_primary_active_per_storefront`) |
| `is_active` | bool, default true | Resolver requires true |
| `verification_status` | `pending` \| `verified` \| `failed` | **Ownership** only |
| `verification_token` | string(64), nullable | Server-generated AWJ TXT token |
| `verified_at` | timestamp, nullable | When ownership matched |
| timestamps | created/updated | |

**No SoftDeletes.** Hard delete frees `hostname` immediately.

**Fillable today:** the columns above only. There is **no** persisted state for:

- edge provisioning
- certificate
- TLS / HTTPS readiness
- provider domain ID
- provider status
- CNAME target
- Railway verification token

`makePrimary()` (`StorefrontDomain.php` ~117–126) demotes other primaries on the same storefront then sets this row. It does **not** inspect type, verification, or TLS.

### AWJ-managed namespace

`config/storefront.php`: `managed_base_domain` = `env('AWJ_STOREFRONT_BASE_DOMAIN', 'store.awj.app')`. Live temporary value documented as `store.awjdev.xyz`. Production future: `{tenant}.store.awj.app`.

`ManagedStorefrontHostname` builds `{slug}.{base}` as **exactly one label** under the base. Custom add rejects hostnames under that base (`ManagedNamespaceHostnameException` → 422). Tests also protect `store.awj.app`.

AWJ-managed hostnames are covered by existing wildcard DNS / Railway routing for `*.store.awjdev.xyz` / future `*.store.awj.app`. They do **not** need per-tenant Railway custom-domain registration.

### Public hostname path

Visitor Host hits the **storefront Next.js** app (`storefront/`, Docker on Railway; live evidence `storefront-production-2266.up.railway.app`). That server forwards `X-Storefront-Forwarded-Host` plus `X-Storefront-Gateway-Secret` to Laravel. Laravel API host is `nibras-api-production.up.railway.app`. Custom domains must be attached to the **storefront** Railway service, not the API service. Otherwise the Host never reaches `ResolveStorefrontDomain` with the merchant hostname.

### Ownership verification (must not change)

- Record: `_awj-verification.<hostname>`
- Value: `awj-domain-verification=<token>`
- Resolver: `NativeDnsTxtResolver` uses PHP `dns_get_record(..., DNS_TXT)` only. **No HTTP fetch** to the merchant hostname.
- Operational DNS failure → 503. Mismatch → `failed`, retryable. Already-verified → idempotent, preserves `verified_at`.

### HTTP conventions already used on this surface

| Situation | Status |
|---|---|
| Unknown / cross-tenant / cross-storefront | **404** |
| `self_service` / missing `commerce.manage` | **403** |
| Guest | **401** |
| Business ineligible (unverified, AWJ namespace, custom not TLS-ready, cannot disconnect) | **422** |
| Global hostname conflict | **409** |
| DNS resolver operational failure | **503** |
| Misconfigured managed base domain | **500** |

Keep this table. Map Railway/provider failures onto it (see §21).

### Production queue

`Dockerfile` sets `QUEUE_CONNECTION=sync`. Document-center jobs exist on named queues, but production image is sync. V1 must not depend on a new background worker.

---

## 3. Current Domain Lifecycle

```
Add custom hostname
  → pending + AWJ TXT challenge (1B-3A)
Verify Now
  → dns_get_record TXT match → verified + verified_at
  → mismatch → failed (retryable)
Make Primary (#861)
  → awj_subdomain verified+active → StorefrontDomain::makePrimary()
  → custom → always 422 CustomDomainNotReadyForPrimaryException
Disconnect (#861)
  → custom + not primary → hard delete
  → AWJ-managed or current primary → 422
```

Both Make Primary and Disconnect: transaction + `lockForUpdate` on all storefront domain rows `ORDER BY id`.

Frontend (`/commerce/domains`): Make Primary only for eligible AWJ-managed. Disconnect only for custom (confirmation, no optimistic delete). Verified custom labeled **Ownership verified** + **Awaiting domain activation**. Frontend is not a security boundary.

---

## 4. Railway Platform Evidence

Sources (official unless marked):

- [Manage Domains with the Public API](https://docs.railway.com/integrations/api/manage-domains)
- [API Cookbook](https://docs.railway.com/guides/api-cookbook)
- [Public API](https://docs.railway.com/integrations/api) / [Public API Reference](https://docs.railway.com/reference/public-api)
- [Working with Domains](https://docs.railway.com/networking/domains/working-with-domains)
- [Public Networking limits](https://docs.railway.com/reference/public-networking)
- [CLI `railway domain`](https://docs.railway.com/cli/domain)
- [Troubleshooting SSL](https://docs.railway.com/guides/troubleshooting-ssl)
- [Pricing](https://railway.com/pricing)

**Endpoint:** `https://backboard.railway.com/graphql/v2`

**Documented GraphQL operations:**

| Operation | Kind | Purpose |
|---|---|---|
| `customDomainAvailable` | query | Check whether a hostname can be added |
| `customDomainCreate` | mutation | Attach hostname to a service |
| `customDomain` | query | Status for an existing custom domain |
| update custom domain | mutation | e.g. target port |
| `customDomainDelete` | mutation | Remove binding |
| `serviceDomainCreate` | mutation | Railway-provided `*.up.railway.app` (not merchant custom) |

Cookbook `customDomainCreate` input (official example):

```text
projectId, environmentId, serviceId, domain
```

Optional: `targetPort` (staff threads). Implementation must set the storefront HTTP port explicitly if the service exposes more than one.

Create response (cookbook): `id` plus `status.dnsRecords { hostlabel, requiredValue }`. Official manage-domains page: also query `status.verificationToken` for the Railway TXT.

**DNS record statuses (official table):** `PENDING` | `VALID` | `INVALID`  
**Certificate statuses (official table):** `PENDING` | `ISSUED` | `FAILED`

Community GraphQL dumps also show prefixed enums (`DNS_RECORD_STATUS_PROPAGATED`, `CERTIFICATE_STATUS_TYPE_VALIDATING_OWNERSHIP`) and `status.certificates[]`. **Do not hard-code unofficial enum strings.** EDGE-1 must introspect the live schema and map Railway’s actual fields onto the semantic contract above. Authority for “HTTPS ready” is certificate **ISSUED** (or equivalent introspected value meaning the custom-domain cert is active), **not** DNS VALID alone.

**CLI (official):** `railway domain <host>`, `railway domain status`, `railway domain delete`, `railway domain certificate retry`. Useful for ops; AWJ backend should use GraphQL, not shell-out to CLI.

**SSL (official):** Let’s Encrypt ECDSA, 90-day certs, auto-renew at 30 days remaining. Issuance “should happen within an hour” of correct DNS; troubleshooting allows up to 72 hours for DNS. Missing Railway TXT → HTTP **404** on the custom host even if CNAME resolves. Railway does not publish a static IP; **A records are not supported**.

**Wildcard domains:** supported on Railway, with extra `_acme-challenge` CNAME. **Not useful for arbitrary merchant hostnames** (`shop.merchant.com` is not under a wildcard AWJ controls).

---

## 5. Current AWJ Railway Capability / Unknowns

| Question | Finding |
|---|---|
| Does the repo contain a Railway GraphQL client? | **No.** |
| Are Railway project/service IDs in git? | **No** (correct). Live hostnames appear only in reports: API `nibras-api-production.up.railway.app`, storefront `storefront-production-2266.up.railway.app`. |
| Account/plan for custom-domain quota | **UNKNOWN.** This pass did not read Railway dashboard or tokens (forbidden). |
| Platform limits | Official: Trial 1; Hobby **2/service**; Pro **20/service** default, increase on request. Pricing page: Free 0 after trial; Hobby 2; Pro 20; Enterprise unlimited. |
| Wildcard already covering merchant custom hosts? | **No.** Wildcard covers AWJ-managed `*.store.awjdev.xyz` / future `*.store.awj.app` only. |
| Can we inspect production Railway config from git? | **No.** `deploy/DEPLOY.md` still describes Render for the API; storefront has a Railway-compatible Dockerfile. Live evidence is Railway. |

**Scale implication:** attaching every merchant hostname to **one** storefront service hits the per-service cap. A Railway employee has described a **pool of reverse-proxy services** (≤20 domains each) for LMS-like SaaS. That pool is **out of V1**. V1 assumes a single storefront service plus a documented quota check (`customDomainCreate` failure → 422/503). Before production SaaS scale: confirm plan and request Pro limit increase, or schedule a later EDGE-SCALE slice. Do not invent a proxy mesh now.

---

## 6. DNS Requirements

Two **independent** DNS proofs:

| Purpose | Name | Value | Who consumes it |
|---|---|---|---|
| AWJ ownership (existing, immutable) | `_awj-verification.<hostname>` | `awj-domain-verification=<token>` | AWJ `dns_get_record` |
| Railway edge ownership + routing | TXT from `status.verificationToken` (staff: `_railway-verify.<hostname>`) **and** CNAME from `status.dnsRecords` | token + `*.up.railway.app` target | Railway |

Merchant steps after Activate:

1. Keep the existing AWJ TXT (already verified; leaving it in place is fine).
2. Add **CNAME** `hostname` → Railway `requiredValue` (e.g. `g05ns7.up.railway.app`).
3. Add **Railway TXT** exactly as returned (`hostlabel` + token). Prefer API-returned names over hard-coded `_railway-verify`.

**Subdomain (`shop.merchant.com`) — V1:** CNAME + Railway TXT. Universally supported. **This is the V1 product.**

**Apex (`merchant.com`):** CNAME-flattening / ALIAS / ANAME. No A record. Provider-specific. Cloudflare orange-cloud / Full vs Full (Strict) pitfalls. **Out of V1.** Reject apex in Activate (hostname has only one label, or equals a registrable domain with no subdomain) with 422.

**V1 recommendation:** subdomain-only because (1) DNS is one CNAME everywhere, (2) no ALIAS/flattening matrix, (3) no Cloudflare proxy special cases required for correctness, (4) matches Railway cookbook examples (`api.example.com`).

Do not treat “CNAME exists” (AWJ-side DNS lookup of the routing record) as TLS ready.

---

## 7. TLS / Certificate Readiness

**Not sufficient (explicitly forbidden as HTTPS proof):**

- `verification_status = verified` / `verified_at`
- AWJ TXT success
- CNAME exists / `dns_get_record` of the Railway target
- `is_active` / `is_primary`
- HTTP 200 / browser padlock
- Frontend flag

**Authoritative source of truth:** Railway custom-domain **certificate status = ISSUED** (official table), read via `customDomain` (or equivalent introspected field such as `status.certificates[]` if that is the live shape). DNS VALID is a **prerequisite**, not readiness.

AWJ persisted `edge_status = ready` is a **cache** of that observation. Make Primary and any “Ready” badge must either:

- re-query Railway at decision time, or
- accept a cache only if `edge_checked_at` is within a short window **and** last observation was ISSUED.

V1 recommendation: **re-query Railway inside the Make Primary transaction** for custom domains. Fail closed on timeout/error (503), not “use stale ready”.

---

## 8. Authentication / Credential Boundary

Railway token types (official):

| Token | Header | Scope |
|---|---|---|
| Account | `Authorization: Bearer` | Entire account — too broad |
| Workspace | `Authorization: Bearer` | One workspace — **recommended** |
| Project | `Project-Access-Token` | One environment — narrowest; **not proven** in official docs to allow `customDomainCreate` |
| OAuth | Bearer | Third-party acting as a user — not needed |

**Recommended V1:** Workspace token (or Project token only after EDGE-1 proves the mutation works with it). Server-side env on the **Laravel API** service only:

```text
RAILWAY_API_TOKEN          # workspace token
RAILWAY_PROJECT_ID
RAILWAY_ENVIRONMENT_ID
RAILWAY_STOREFRONT_SERVICE_ID
```

Optional later: `RAILWAY_STOREFRONT_TARGET_PORT`.

**Must not** appear in: browser, merchant JSON, public storefront API, Next.js `NEXT_PUBLIC_*`, git, PR bodies, logs.

This pass: **did not create a token, print a secret, or change environment variables.**

Missing credentials → Activate/status fail closed **503** (“edge provider is not configured”), never a client-visible fallback that marks ready.

GraphQL rate limits (official): Hobby 1000 RPH / 10 RPS; Pro 10_000 RPH / 50 RPS. Honor `Retry-After` on 429. Map 429 → 503 with retryable message.

---

## 9. Recommended Architecture

**CASE B.** Smallest loop:

```
ownership verified (existing)
  → POST .../domains/{id}/activate-edge     # customDomainCreate (idempotent)
  → present Railway CNAME + Railway TXT
  → merchant configures DNS
  → POST .../domains/{id}/refresh-edge      # customDomain query
  → when certificate ISSUED: persist ready
  → Make Primary allowed (EDGE-3)
  → DELETE disconnect: Railway delete then DB delete
```

Target Railway service = **storefront Next.js**, not Laravel API.

No generic multi-cloud `StorefrontEdgeProvider` registry. One narrow PHP port + one Railway GraphQL client + one fake for tests (see §12).

No change to `ResolveStorefrontDomain`. Verified+active custom can already resolve if the Host arrives; Edge work makes the Host **able** to arrive on HTTPS. Pre-existing COM-7-P2A “non-primary still resolves” remains out of scope.

---

## 10. State Machine

Keep **ownership** and **edge** as separate columns. Never overload `verification_status`.

**Ownership** (existing, unchanged): `pending | verified | failed`

**Edge** (new, custom rows only; AWJ-managed stay `none`):

| `edge_status` | Meaning | Who may set it |
|---|---|---|
| `none` | Never provisioned (default, including all current rows) | default |
| `pending` | `customDomainCreate` in flight / provider id not yet stored | server |
| `dns_required` | Railway id stored; merchant must add CNAME+TXT | server after create/status |
| `tls_pending` | Railway DNS VALID (or equivalent); certificate not ISSUED | server after status |
| `ready` | Last **authoritative** observation: certificate ISSUED | server after status / Make Primary check |
| `failed` | Provider error, cert FAILED, or domain removed externally | server |

Do not add `ownership_pending` duplicates. Seven ownership+edge combos are enough.

Illegal transitions: `verified` must not flip to `pending` because edge failed. Edge failure does not un-verify ownership.

---

## 11. Minimum Schema

Nullable additive columns on `storefront_domains` only. No backfill. No auto-provision. Existing AWJ-managed and existing custom rows remain valid with `edge_status = none`.

| Column | Why | Authority vs cache | Can we skip? |
|---|---|---|---|
| `edge_status` | Drive API/UX without inventing a boolean `tls_ready` | **Cache** of last provider observation | **No** — this is the fail-closed gate |
| `edge_provider` | Fixed `'railway'` when provisioned | Cache / discriminator | Yes if V1 hard-codes Railway; keep it (1 string) so rows are self-describing |
| `edge_provider_id` | Railway custom domain `id` for status/delete | **AWJ pointer** to provider object. Provider remains source of truth for the object | **No** |
| `edge_dns_instructions` | JSON: CNAME host/target + Railway TXT name/value returned by Railway | **Cache** of instructions to show the merchant | Could re-query every GET; caching avoids extra Railway calls on list. Keep. |
| `edge_last_error` | Safe, non-secret last provider/DNS message | Cache | Yes, but cheap and needed for UX/ops |
| `edge_checked_at` | When we last queried Railway | Cache | **No** if we allow any stale `ready` |
| `edge_ready_at` | First time we observed ISSUED | Cache | Useful; not a substitute for re-query on Make Primary |

**Do not add:** certificate PEM, expiry, ACME account, Railway project/service IDs per row (those are env), `is_tls_ready` boolean, SoftDeletes, generic `metadata` JSON blob as the only state.

Index: none required beyond existing `storefront_id` / `id` lookups. Optional unique partial index on `edge_provider_id` WHERE NOT NULL — nice for reconciliation; not mandatory in V1 if the service always looks up by our row id then provider id.

Migration must be backward compatible: all new columns nullable (or `edge_status` default `'none'`). `migrate --force` on boot already exists; a failing migration still fails the container (good).

---

## 12. Provider Integration Boundary

**Do not** build a plugin registry “in case we leave Railway”.

**Do** isolate GraphQL HTTP from commerce rules, because tests and secret handling require it.

Recommended V1 types (names illustrative):

```text
StorefrontEdgeClient (interface)
  provision(hostname, serviceBinding) -> EdgeBinding   # id + dns instructions
  fetch(providerId) -> EdgeSnapshot                     # dns + certificate
  findByHostname(hostname) -> ?EdgeBinding              # reconciliation
  release(providerId) -> void                           # idempotent if already gone

RailwayStorefrontEdgeClient implements StorefrontEdgeClient
FakeStorefrontEdgeClient implements StorefrontEdgeClient   # tests only
```

`CommerceWorkspaceStorefrontsService` stays the tenant/lock/eligibility owner. It must never see raw GraphQL. The Railway client must never see `tenant_id` or accept a client-supplied provider id as authority (it is told the id **from our row** after tenant-scoped lock).

---

## 13. Provision Flow

`POST /api/commerce/workspace/storefronts/{id}/domains/{domainId}/activate-edge`

Empty body. `commerce.manage`. Same 404 isolation as #861.

Eligibility (inside existing `lockForUpdate` of all storefront domain rows):

- Domain exists on this tenant/storefront (else 404)
- `type = custom` (else 422)
- `verification_status = verified` (else 422)
- `is_active` (else 422)
- Hostname is a **subdomain** (else 422)
- Not under AWJ managed bases `store.awjdev.xyz` / `store.awj.app` (already true)
- Credentials present (else 503)

Idempotency:

1. If `edge_provider_id` present → do not create; `fetch` and refresh cache; return current instructions/status.
2. If `edge_status` in `pending|dns_required|tls_pending|ready` but id missing (crash after Railway success) → `findByHostname` / `customDomainAvailable`; attach existing Railway id; do not create a second binding.
3. Else `customDomainCreate`. Persist `id` + instructions + `dns_required` **in the same DB transaction after the HTTP call** (provider call is outside DB? see §20). Prefer: lock row, call provider, then write. If write fails, next retry hits step 2.

Never accept `edge_provider_id` or DNS targets from the client.

---

## 14. Status / Reconciliation Flow

`POST .../domains/{domainId}/refresh-edge` (or GET-with-side-effect is worse; use POST). Merchant “Check HTTPS”. Empty body.

Server: lock row → `fetch(edge_provider_id)` → map snapshot:

| Railway observation | Stored `edge_status` |
|---|---|
| Domain missing | `failed` + last_error; do **not** delete the AWJ row here |
| DNS not VALID | `dns_required` |
| DNS VALID, cert not ISSUED | `tls_pending` |
| Cert ISSUED | `ready` + set `edge_ready_at` if null |
| Cert FAILED | `failed` |
| Transport error | leave status; 503 |

Do not HTTP-GET `https://shop.merchant.com`. Do not use AWJ TXT re-check as TLS proof (ownership stays as-is).

Optional later: scheduled reconcile. Not V1 (sync queue). Merchant retry is enough because issuance is “within an hour” after DNS.

If Railway removed the domain externally: `failed`; Activate may provision again (idempotent create / find).

---

## 15. Disconnect Flow

Today (#861): DB hard delete only. After Edge, that **orphans** a Railway binding and can hold a scarce domain slot.

**Safe order for EDGE-3:**

1. Lock storefront domain rows.
2. Eligibility unchanged: custom, not primary; else 422. 404 isolation unchanged.
3. If `edge_provider_id` present: `release(id)`.
   - Success or “already gone” → continue.
   - Transport failure → **do not delete DB row**; 503; row stays so retry can finish.
4. Then DB `delete()` (existing hard delete).

Why provider-first: DB-first + Railway failure = orphaned Railway hostname (blocks reuse, consumes quota). Provider-first + DB failure = row still exists, retry is idempotent (`release` then delete).

Do not change #861 in this architecture pass. EDGE-3 is the slice that updates `disconnectCustomDomainForCurrentTenant`.

AWJ-managed disconnect remains 422. Primary remains 422 (no failover).

---

## 16. Make Primary Integration

Today: `if type === custom` throw `CustomDomainNotReadyForPrimaryException` always.

**Smallest EDGE-3 change** (same lock, same 404/422/403):

```
if custom:
  if !verified || !active: 422 not eligible
  if edge_status is not ready-candidate: 422 not-ready (existing Arabic copy)
  re-query Railway; if certificate !== ISSUED: 422 not-ready (or 503 on transport)
  then existing makePrimary()
else:
  existing AWJ-managed path
```

Do **not** teach `StorefrontDomain::makePrimary()` about Railway. Keep eligibility in the workspace service.

Frontend `canMakeDomainPrimary` today: AWJ-managed verified active not-primary. EDGE-2/3: also custom when **server-presented** `edge_status === 'ready'` (still not a security boundary).

---

## 17. Tenant Isolation

Unchanged rules:

- TenantContext from authenticated user; never from Host on workspace APIs.
- Unknown / cross-tenant / cross-storefront domain → **404**.
- Global unique `hostname` remains the public-resolution key.
- Railway `id` is stored on **our** row; lookup is tenant-scoped then provider call. A client cannot pass another tenant’s Railway id.
- Provision always uses **server env** service id (the AWJ storefront service), never a client-supplied Railway service/project id.

---

## 18. Security Analysis

| Risk | Mitigation |
|---|---|
| Tenant isolation | Existing 404 lock path; provider id not accepted from client |
| Domain hijacking | AWJ TXT ownership **before** Activate; Railway TXT is a **second** proof for the edge, not a replacement |
| Provider IDOR | Provider id read from locked row only |
| SSRF | No HTTP to merchant hostname. Railway GraphQL endpoint is fixed. DNS TXT only via `dns_get_record` for ownership |
| Secrets | Workspace token on Laravel only; never in storefront public responses |
| Host header | Resolver unchanged; gateway secret still required for forwarded host |
| Namespace protection | Existing `ManagedStorefrontHostname` reject for `*.store.awjdev.xyz` / `*.store.awj.app`; Activate reuses it |
| DNS rebinding after ready | Attacker who later controls DNS can point the name away (availability) but cannot attach it to another AWJ tenant (unique hostname). Make Primary re-queries ISSUED. Optional later: periodic reconcile / revoke ready if cert no longer ISSUED |
| Orphaned edge binding | Provider-first disconnect; provision reconciliation by hostname |
| Quota exhaustion / DoS Activate | Per-row idempotency + Railway 429 → 503; still a platform quota risk (UNKNOWN plan) |
| Logging | Never log token, `verificationToken`, Authorization header |

Cloudflare orange-cloud / Full vs Full (Strict) is a **merchant DNS footgun**, not an AWJ security boundary. V1 subdomain + grey-cloud CNAME is the documented path; mention Cloudflare in UX copy only.

---

## 19. Idempotency

| Action | Double-click | Timeout after Railway success | DB pending, Railway ready | Railway deleted externally | DNS changed after ready |
|---|---|---|---|---|---|
| Activate | Second call `fetch`s existing id | `findByHostname` attaches id | refresh to `ready` | create again | N/A |
| Refresh | Pure query + cache write | retry query | write `ready` | `failed` | next refresh may drop to `dns_required` / `failed` |
| Disconnect | Second call 404 after delete | release is idempotent if gone; then DB delete | release then delete | skip release, DB delete | N/A |
| Make Primary | Existing idempotent if already primary | 503 fail-closed | allowed only if ISSUED now | 422 | 422 if no longer ISSUED |

Railway official retry guidance: do **not** blindly retry mutations after HTTP 200. Reconcile by hostname instead.

---

## 20. Concurrency

Reuse #861: `lockForUpdate` all storefront domain rows `ORDER BY id` for Activate, Refresh, Disconnect, Make Primary.

| Race | Outcome |
|---|---|
| Two Activates | Lock serializes; second is idempotent fetch |
| Activate vs Disconnect | Lock serializes; disconnect provider-first |
| Make Primary vs edge transition | Make Primary re-queries under the same lock |
| Duplicate hostname provision | DB unique hostname + Railway `customDomainAvailable` |
| Two tenants, same hostname | Impossible after insert (`unique(hostname)`); 409 on add |

Provider HTTP **inside** the transaction keeps the row locked for Railway’s RTT (usually fine). If that is too long, split: lock, read, unlock, HTTP, lock again, compare version/`edge_provider_id`, write — more code. V1: stay in one transaction like verify-now (already synchronous DNS).

PostgreSQL test: concurrent Activate on one domain leaves one Railway id; concurrent Make Primary still one active primary (existing test plus edge-ready custom variant in EDGE-3).

---

## 21. Failure Semantics

Map onto existing workspace conventions. Do not invent 502 unless the repo already uses it on this surface (it does not).

| Event | Status | Persist |
|---|---|---|
| Missing Railway credentials / service id | **503** | no |
| Railway 429 / 5xx / network timeout | **503** | last_error if we have a row; do not mark `ready` |
| Railway GraphQL `errors` “Not Authorized” | **503** | last_error (ops); no secret |
| Hostname invalid / apex in V1 / AWJ namespace | **422** | no |
| Ownership not verified | **422** | no |
| Domain already on **this** service (our row or findByHostname) | **200** idempotent | attach |
| Domain owned by **another Railway project** / not available | **409** or **422** | last_error; do not mark ready. Prefer **409** if it is a uniqueness conflict, else 422 |
| DNS not configured yet | **200** with `edge_status=dns_required` | yes |
| TLS pending | **200** `tls_pending` | yes |
| TLS FAILED | **422** on Make Primary; Refresh **200** `failed` | yes |
| Disconnect while Railway down | **503**, row kept | yes |
| Make Primary custom without ISSUED | **422** (existing not-ready copy) | no |

Cross-tenant remains **404**, never 422.

---

## 22. UX Contract

Stay on `/commerce/domains`. Do not redesign the page.

Authoritative states from GET list (backend `presentDomain` grows an `edge` object, null for AWJ-managed):

```
pending ownership     → existing Verify Now
ownership verified    → Activate domain   (new)
dns_required          → show CNAME + Railway TXT (copy buttons); Check HTTPS
tls_pending           → “Securing HTTPS…”; Check HTTPS
ready                 → Ready; Make Primary (EDGE-3)
failed                → error copy; retry Activate/Check
```

Copy must never say Ready from `verification_status` alone (already true after #861).

Frontend gating is illustrative. API enforces eligibility.

---

## 23. Backward Compatibility

- No change to 1B-3A TXT contract.
- No change to resolver.
- No change to AWJ-managed Make Primary / Disconnect.
- New columns nullable / default `none`.
- Existing verified custom rows stay “awaiting activation” until the merchant clicks Activate (no mass provision).
- `presentDomain` may **add** `edge`; must not rename `verification` or the six 1B-2 fields.
- Missing Railway env: Activate/Refresh 503; rest of Commerce unchanged.

---

## 24. Deployment Risks

| Risk | V1 control |
|---|---|
| Downtime | Additive nullable migration only |
| Mass provision on migrate | Forbidden — no data backfill |
| Auto Make Primary | Forbidden |
| AWJ-managed domains | Untouched |
| Existing TXT-verified custom | Preserved, `edge_status=none` |
| Wrong Railway service id | Would attach domains to API instead of storefront — Host never reaches resolver. **EDGE-1 must use storefront service id.** Verify with one staging hostname before production |
| Quota | UNKNOWN plan; create will fail closed |
| Let’s Encrypt rate limits | Do not delete+recreate on failure (staff: cooldown). Refresh / `certificate retry` instead |
| Sync queue | No worker required |

---

## 25. Test Matrix (for later implementation — not this pass)

- `FakeStorefrontEdgeClient`: provision/fetch/release/findByHostname
- Railway client unit: GraphQL shape, error mapping, no secret in exceptions
- Tenant isolation 404 on Activate/Refresh/Disconnect
- Client cannot send provider id / DNS / edge_status
- Idempotent double Activate
- Timeout after create → reconcile by hostname
- Refresh: dns_required / tls_pending / ready / failed / missing provider object
- 503 on missing credentials, 429, timeout
- Apex rejected; AWJ namespace rejected
- Disconnect: provider-first; 503 keeps row; already-gone still deletes DB
- Make Primary custom: 422 until ISSUED; 200 after; re-query fail-closed
- Make Primary AWJ regression (15 tests)
- Disconnect AWJ/primary regression
- Resolver regression (17 tests) — no TLS requirement added
- Module boundary allowlist for new URIs
- PostgreSQL: concurrent Activate; concurrent Make Primary
- Frontend: Activate / DNS instructions / never Ready on verified-only / Make Primary appears only when server says ready

---

## 26. CASE A / B / C Decision

**CASE B — Implementable with constrained V1.**

Not CASE A: merchant DNS is manual; TLS is async; AWJ plan/quota is UNKNOWN; apex is messy; GraphQL enum names need introspection; project-token permission for `customDomainCreate` is not explicitly documented.

Not CASE C: Railway documents create / status / delete / certificate ISSUED / CNAME+TXT. That is enough for a safe subdomain V1.

**Constraints that define B:**

1. Subdomain custom hostnames only.
2. Manual merchant DNS (CNAME + Railway TXT, distinct from AWJ TXT).
3. Server-driven Railway register/status/delete.
4. Merchant-driven HTTPS check (no new queue).
5. Make Primary fail-closed until live certificate ISSUED.
6. Single storefront Railway service until quota is proven/raised.
7. No apex, no Cloudflare automation, no reverse-proxy pool, no mass backfill.

**Automation answer (ticket §9):** `PARTIALLY_SUPPORTED`.

---

## 27. Exact Implementation Slices

Each PR: small, independently testable, backward compatible, tenant-safe. No merge/deploy from the architecture agent.

### EDGE-1 — Schema + Railway client + Activate/Refresh APIs

- Nullable migration (§11).
- `StorefrontEdgeClient` + Railway implementation + fake.
- `POST activate-edge`, `POST refresh-edge`.
- Make Primary **still** 422 for all custom (do not open it yet).
- Disconnect **unchanged** (still DB-only) — document the orphan window; close it in EDGE-3. Alternatively include provider-first disconnect here if the PR stays small enough; prefer EDGE-3 so EDGE-1 can ship without changing #861 delete semantics until provider calls are proven.
- Introspect GraphQL; pin enum mapping in one module.
- Staging: one throwaway subdomain, no production tokens in git.

### EDGE-2 — Frontend activation / DNS copy / readiness labels

- `/commerce/domains` only.
- Activate, instructions, Check HTTPS, states from server `edge`.
- Still no Make Primary for custom.

### EDGE-3 — Make Primary eligibility + disconnect reconciliation

- Custom Make Primary iff verified + active + certificate ISSUED (re-query).
- Disconnect: Railway then DB (§15).
- Frontend: show Make Primary for ready custom.
- PostgreSQL concurrency + resolver regression.

### Later (not V1)

- Apex / ALIAS.
- Railway domain-limit increase or reverse-proxy pool (EDGE-SCALE).
- Background reconcile worker (only if production leaves `QUEUE_CONNECTION=sync`).
- Auto-provision on deploy — **never**.

---

## 28. Open Questions / Blockers

| Item | Status |
|---|---|
| AWJ Railway plan and current custom-domain count | **UNKNOWN** — confirm in dashboard before production scale |
| Exact live GraphQL enum names for DNS/cert | Introspect in EDGE-1 |
| Does a **project** token authorize `customDomainCreate`? | **UNKNOWN** — prefer workspace token |
| Storefront service UUID / environment UUID | **UNKNOWN** in repo — set as env, never commit |
| Target port of the storefront service | Confirm when creating domains |
| Whether `customDomainAvailable` is still in schema | Official manage-domains page lists it; third-party dumps differ — introspect |
| Existing verified custom domains in production | Must not be auto-registered |
| Dual TXT merchant confusion | UX must label “AWJ ownership TXT” vs “Railway routing TXT” |

**Non-blockers for V1:** apex support, wildcard merchant domains, queue workers, multi-provider abstraction.

---

## 29. Recommended Next Action

1. Human: confirm Railway workspace plan and, if Pro default 20 is too low, request a limit increase. Capture storefront **service id / environment id / project id** as env (no git).
2. Implement **EDGE-1** on a branch from latest `main` (this SHA or later). Do not reverse later commits.
3. Keep Make Primary fail-closed for custom until EDGE-3.
4. Do not merge or deploy this architecture PR as if it shipped Edge.

---

## Appendix A — Resolver (unchanged; do not modify)

`ResolveStorefrontDomain` (`app/Http/Middleware/ResolveStorefrontDomain.php`):

1. Normalize Host (or secret-gated `X-Storefront-Forwarded-Host`)
2. `StorefrontDomain` by hostname
3. Require `is_active` **and** `isVerified()` (`verification_status = verified`)
4. Active `Storefront`
5. Active `web` `SalesChannel` of the same tenant

**Does not require** `is_primary`. **Does not require** TLS/edge. Pending/failed/inactive → 404. A verified+active custom hostname **will** establish storefront authority **if** the HTTP Host already reaches the app. Edge work is what makes that Host reach the app on HTTPS.

## Appendix B — Official links used

- https://docs.railway.com/integrations/api/manage-domains
- https://docs.railway.com/guides/api-cookbook
- https://docs.railway.com/integrations/api
- https://docs.railway.com/reference/public-api
- https://docs.railway.com/networking/domains/working-with-domains
- https://docs.railway.com/reference/public-networking
- https://docs.railway.com/cli/domain
- https://docs.railway.com/guides/troubleshooting-ssl
- https://railway.com/pricing
