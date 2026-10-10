# AWJ Cloudflare Platform Horizon V1

**Status:** READY FOR REVIEW / horizon authorization candidate  
**Prepared:** 2026-09-29  
**Base:** `main@e6fc91d172c0759f1b7e422e9396b775995fc645`  
**Process:** نظام الأفق / AWJ Autonomous Engineering Horizon  
**Scope:** Cloudflare as AWJ edge/security/storage/media/SaaS-domain platform around the existing Railway + Laravel + PostgreSQL architecture.

> This document is durable architecture/planning evidence. It does **not** authorize production deployment, DNS cutover, Railway environment changes, secret injection, WAF enforcement, custom-domain provider migration, or a new major horizon until explicitly authorized.

## 1. Objective

Use Cloudflare as a bounded infrastructure layer for AWJ where it adds clear value, without moving AWJ business authority out of Laravel/PostgreSQL and without creating unsafe vendor lock-in.

Target shape:

```text
User / Merchant / Store Customer
        |
        v
Cloudflare Edge
  - DNS / TLS / DDoS
  - WAF / Rate Limiting
  - Turnstile
  - CDN / Cache
  - Image Transformations
  - Cloudflare for SaaS (decision-gated)
        |
        +------------------------+
        |                        |
        v                        v
Railway Origin               Cloudflare R2
- Laravel API                - product media
- Next.js ERP                - storefront assets
- Storefront                 - documents/PDFs
- PostgreSQL                 - attachments/exports
```

AWJ Commerce/ERP business truth remains in Laravel/PostgreSQL. Cloudflare may protect, route, cache, transform, or store files; it must not become an alternate accounting, tenant, pricing, stock, auth, order, payment, or authorization authority.

## 2. Repository state already proven

### R2 foundation

- AWJ-R2-1 is merged via PR #1092.
- Merge SHA: `e6fc91d172c0759f1b7e422e9396b775995fc645`.
- `config/filesystems.php` contains a separate `r2` disk driven only by `R2_*` environment variables.
- Existing default/local/public/s3 flows remain unchanged.
- The R2 disk deliberately declares no Laravel/Flysystem visibility because Cloudflare R2 does not implement S3 object ACL semantics used by visibility APIs.
- `docs/storage.md` is the current storage contract.
- No existing production flow selects R2 yet.
- AWJ-R2-2 is an active implementation slice outside this documentation PR; do not claim its result until merged evidence exists.

### Existing custom-domain architecture

`docs/plans/store/AWJ_CUSTOM_DOMAIN_EDGE_TLS_ARCHITECTURE.md` currently documents a Railway custom-domain provisioning approach. That remains the accepted repository evidence until a deliberate provider decision supersedes it.

Cloudflare for SaaS is therefore a **Decision Gate**, not a silent replacement.

## 3. External evidence — official Cloudflare sources

Retrieved 2026-09-29.

### R2

Official pricing:
- Standard storage: $0.015/GB-month.
- Class A: $4.50/million operations.
- Class B: $0.36/million operations.
- Internet egress: free.
- Included monthly usage currently includes 10 GB-month Standard storage, 1M Class A and 10M Class B operations.

Source: https://developers.cloudflare.com/r2/pricing/

### Cache / CDN

Cloudflare Cache is available on all plans and caches content at geographically distributed edge locations to reduce origin load and latency. Cache Rules can define what is cached and for how long.

Source: https://developers.cloudflare.com/cache/

### Rate Limiting

Cloudflare Rate Limiting Rules can protect websites and APIs, including login endpoints against brute-force attempts and API clients against abusive request volume.

Source: https://developers.cloudflare.com/waf/rate-limiting-rules/

### Turnstile

Current Free plan:
- up to 20 widgets per account;
- 10 hostnames per widget;
- unlimited challenges;
- suitable for most production applications according to Cloudflare.

The hostname limit matters for a multi-domain SaaS storefront and must not be ignored.

Source: https://developers.cloudflare.com/turnstile/plans/

### Images

Cloudflare Images can transform images stored outside Cloudflare Images, including R2.
Current Free plan includes up to 5,000 unique transformations/month.
Paid transformations: first 5,000 included, then $0.50/1,000 unique transformations/month.

Source: https://developers.cloudflare.com/images/pricing/

### Cloudflare for SaaS

Current non-Enterprise plans include:
- 100 custom hostnames;
- maximum 50,000;
- $0.10 per additional hostname.

Cloudflare for SaaS routes customer-owned custom hostnames to an AWJ-controlled origin and supports API-driven custom hostname creation/TLS lifecycle.

Sources:
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/create-custom-hostnames/

### Workers

Workers remains available for edge logic and integrates with other Cloudflare primitives. It is not authorization to move AWJ core business logic to the edge.

Source: https://developers.cloudflare.com/workers/platform/pricing/

## 4. AWJ decisions for this horizon

### CF-01 — Railway remains the application origin

**Decision:** keep Railway as the application runtime/origin for Laravel, Next.js/Storefront and PostgreSQL.

Cloudflare is an edge/storage/support layer, not a replacement for the current application architecture.

Moving accounting, inventory, payments, pricing, tenant authorization or PostgreSQL authority into Workers/D1 is out of scope.

### CF-02 — R2 is the preferred durable object-storage provider

**Decision:** R2 is the target object store for AWJ binary/file content after runtime proof and staged migration.

Candidate content:
- product/category media;
- storefront logos/banners/theme assets;
- invoice/document PDF artifacts;
- customer/supplier/ERP attachments;
- import/export artifacts when retention policy permits.

Not stored as R2 business authority:
- invoice records/lines/taxes/totals;
- journal entries;
- balances;
- inventory quantities;
- product/customer/tenant records;
- RBAC/auth state.

Those remain in PostgreSQL.

### CF-03 — Tenant isolation is enforced in AWJ, not by bucket naming alone

Object keys must be server-derived and tenant-prefixed. A future stable contract may use:

```text
tenant/{tenant_id}/{domain}/{resource_id}/{filename}
```

Exact key naming is owned by the R2 implementation slice, but:
- tenant id is never trusted from request path/body;
- no cross-tenant raw object access;
- no bucket-wide list exposed to clients/controllers;
- path traversal is rejected;
- private/sensitive objects are not made public merely for convenience.

### CF-04 — Cloudflare does not replace AWJ authentication

Laravel remains the source of truth for:
- user/customer identity;
- password/OTP/session/token semantics;
- tenant resolution;
- permissions/RBAC;
- email verification;
- password reset;
- customer ownership.

Cloudflare may protect the boundary before Laravel.

### CF-05 — Authentication protection pattern

Target request chain:

```text
Client
 -> Cloudflare WAF / DDoS
 -> Rate Limit
 -> Turnstile when policy requires
 -> Laravel Auth / Tenant / RBAC
```

Initial protected surfaces include:
- login;
- registration/account creation;
- forgot/reset password;
- OTP issue/verify routes where applicable;
- public form submission;
- checkout abuse-sensitive endpoints.

Turnstile must be validated server-side. Client-side success alone is not authorization.

Login should not automatically challenge every legitimate user. Risk-based/escalating challenge is preferred where practical; registration/public abuse surfaces may use Turnstile by default.

### CF-06 — Rate limits must be identity/route aware

Do not apply a naive global per-IP policy to the entire ERP/API.

Reasons:
- corporate NAT can place many legitimate users behind one IP;
- storefront/public API traffic has different budgets from login/write paths;
- authenticated identity/store/customer/tenant context may be safer dimensions where available.

Every enforcement rule requires:
- endpoint inventory;
- expected traffic baseline;
- failure behavior;
- observability;
- rollback/disable plan.

### CF-07 — Cache is public-content-only by default

Safe candidates:
- static JS/CSS/fonts;
- public storefront images;
- immutable theme assets;
- explicitly cacheable public storefront responses after tenant/host correctness is proven.

Default no-cache/bypass:
- authenticated ERP pages/API;
- `/api/me`;
- financial/accounting endpoints;
- inventory/account balances;
- customer-private responses;
- any response containing session/authorization data.

Cache keys must never mix tenants/hosts/locales/authorization states.

### CF-08 — R2 + Images is the target media-delivery direction

Store one canonical/original media object where practical; deliver bounded variants/transforms for card/mobile/detail/banner needs.

Do not:
- create uncontrolled transformation cardinality;
- weaken MIME/security validation;
- use remote-fetch transforms as an SSRF proxy;
- let image convenience bypass tenant/publication authorization.

### CF-09 — Cloudflare for SaaS is decision-gated

Cloudflare for SaaS is strategically attractive for AWJ Store custom domains because it scales beyond Railway's current documented custom-domain-per-service approach and provides customer-hostname/TLS lifecycle at the edge.

However, AWJ already has a documented Railway custom-domain architecture.

Therefore:
- no implementation may silently replace Railway custom-domain provisioning;
- first resolve `CF-SAAS-DOMAIN-PROVIDER-1`;
- compare existing Railway architecture, Cloudflare for SaaS, migration/compatibility, cost, TLS lifecycle, hostname verification and rollback;
- preserve existing AWJ-managed wildcard subdomains and current merchant-domain records unless an explicit migration is approved.

Decision packet:
`docs/plans/cloudflare/CF-SAAS-DOMAIN-PROVIDER-1-DECISION-PACKET.md`.

### CF-10 — Workers/Queues/KV/Durable Objects are optional, evidence-driven tools

No general platform migration.

Potential later uses:
- signed/private delivery gateway;
- small edge routing/redirect logic;
- webhook ingress;
- provider-neutral asynchronous edge tasks;
- non-authoritative edge configuration.

They require a concrete use case and dependency/cost/security review before adoption.

### CF-11 — Zero Trust / Access is for internal AWJ surfaces, not customer RBAC

Potential targets:
- staging;
- debug/admin tooling;
- internal dashboards.

It must not replace application RBAC for customers/tenants.

### CF-12 — Avoid hard vendor lock-in

Required abstractions:
- R2 through an S3-compatible/storage service boundary;
- domain provider behind an AWJ domain-provisioning interface if provider automation is adopted;
- Turnstile behind a verification service boundary;
- WAF/cache rules documented as infrastructure policy rather than business semantics.

Core business rules remain portable and testable without Cloudflare.

## 5. Security and tenant invariants

Non-negotiable:

1. Tenant Isolation.
2. Branch Isolation where applicable.
3. No client-supplied tenant authority.
4. No financial/accounting authority at the edge/cache.
5. No secrets in repository, logs, screenshots, reports or client bundles.
6. R2 bucket credentials are server-side only and least-privilege.
7. No public bucket write.
8. No ACL-dependent R2 design.
9. No private ERP/API response cached across users/tenants.
10. No Turnstile token trusted without server verification.
11. No WAF/Rate Limit rule that becomes an undocumented business rule.
12. Custom-domain routing must resolve to exactly one authorized storefront/tenant.
13. Production DNS/TLS/secret changes remain owner-gated.
14. Merge is not Deploy.

## 6. Target platform responsibility matrix

| Concern | Authority |
|---|---|
| Accounting / journals / balances | Laravel + PostgreSQL |
| Product/stock/pricing/payment/order rules | Laravel + PostgreSQL |
| Tenant/RBAC/auth identity | Laravel |
| Application runtime | Railway |
| Durable binary object storage | R2 |
| Public static/media acceleration | Cloudflare CDN/Cache |
| Image resizing/format optimization | Cloudflare Images where adopted |
| DDoS/WAF/rate protection | Cloudflare Edge |
| Human/bot challenge | Turnstile |
| DNS/TLS edge | Cloudflare where activated |
| Merchant custom-domain provisioning | Decision gate: Railway vs Cloudflare for SaaS |
| Internal staging access | Cloudflare Access candidate |
| Edge code | Workers only for bounded approved cases |

## 7. Authentication and account-creation design

### Login

Cloudflare responsibility:
- DDoS/WAF filtering;
- endpoint-specific rate limit;
- optionally invoke Turnstile after suspicious/failed behavior.

Laravel responsibility:
- credential verification;
- tenant context;
- session/token issuance;
- lockout/security policy;
- audit trail;
- RBAC.

### Registration / Create Account

Cloudflare responsibility:
- WAF;
- rate limit;
- Turnstile against automated account creation.

Laravel responsibility:
- tenant/account provisioning;
- identity uniqueness;
- email verification;
- transactionality;
- authorization boundary;
- audit.

### Forgot / Reset Password

- rate limit request and verification endpoints;
- Turnstile when policy requires;
- do not leak whether an email/account exists;
- reset token lifecycle remains Laravel-owned and tenant-bound.

### Customer OTP / commerce authentication

Cloudflare controls abuse at the public boundary only.
OTP issuance/verification/provider abstraction, customer identity and ownership remain AWJ services.

### Turnstile + custom domains

Free-plan hostname limits mean a design that binds one widget directly to unbounded merchant custom domains will not scale.

Before Storefront Turnstile rollout across custom domains, prove one of:
- an AWJ-controlled challenge origin/flow that remains valid and secure;
- bounded widget/hostname strategy;
- Enterprise requirement;
- another supported Cloudflare pattern.

Do not guess around hostname validation.

## 8. Cache policy baseline

### Never cache by default

- authenticated Laravel API responses;
- ERP HTML personalized to a user;
- financial reports;
- invoices/account statements containing private data;
- `Set-Cookie`/authorization-sensitive content;
- cart/customer/order private state;
- admin/customizer responses.

### Candidate cache targets

- immutable hashed assets;
- public storefront CSS/JS/fonts;
- public product/category images;
- public theme media;
- selected public storefront GET responses only after host/tenant/locale cache-key proof.

Every public API caching task must include cross-tenant negative tests and header/cache-key evidence.

## 9. Storage migration order

Do not switch all file classes at once.

Recommended order after R2 runtime smoke proof:

1. Product media.
2. Storefront branding/theme assets.
3. General document/attachment flows.
4. Generated PDF artifacts.
5. Import/export artifacts with explicit retention policy.

For every migration slice:
- dual-read/backward-compatible strategy if existing local objects remain;
- deterministic key ownership;
- upload/read/delete tests;
- cross-tenant negatives;
- orphan cleanup policy;
- rollback;
- production verification after owner-approved deploy.

No financial record migration to R2.

## 10. Quality Gates

### Gate A — R2 runtime safety
- ACL-free write/read/exists/delete path proven.
- tenant-prefixed key contract.
- no production flow switched prematurely.
- manual smoke test path available without printing secrets.

### Gate B — Railway runtime integration
- secrets added only through owner-approved Railway environment change;
- smoke write/read/delete succeeds against `awj-production`;
- temporary object cleaned up;
- no tenant data touched.

### Gate C — Media migration
- one flow at a time;
- backward-compatible reads;
- tenant isolation negatives;
- cleanup/rollback;
- production verification.

### Gate D — Edge/DNS
- origin path documented;
- TLS mode and proxy behavior proven;
- no redirect loop;
- API/WebSocket/host forwarding regressions checked;
- rollback path documented.

### Gate E — WAF / Rate Limit
- route inventory;
- baseline traffic evidence;
- dry-run/log/managed challenge strategy where available;
- false-positive review;
- auth/customer/storefront separation;
- rollback.

### Gate F — Turnstile
- server-side verification;
- replay/expiry/error handling;
- no bypass path;
- accessibility/UX;
- registration/login/reset negatives;
- custom-domain hostname strategy resolved before multi-domain storefront rollout.

### Gate G — Cache
- explicit cache/bypass matrix;
- no authenticated/private caching;
- cache key proves host/tenant/locale separation;
- purge/version strategy;
- stale-content policy.

### Gate H — Images
- allowed source strategy;
- bounded transformations;
- format/size behavior;
- fallback;
- SSRF/publication/tenant constraints.

### Gate I — Cloudflare for SaaS
- provider decision accepted;
- hostname ownership/TLS/routing state machine;
- migration compatibility with current Railway approach;
- API token least privilege;
- churn/delete lifecycle;
- cost/quota monitoring;
- production pilot before broad rollout.

## 11. Dependency-safe task queue

| Order | ID | Status at planning time | Depends on | Outcome |
|---|---|---|---|---|
| 1 | AWJ-R2-1 | done | — | R2 filesystem foundation, PR #1092 |
| 2 | AWJ-R2-2 | in_progress outside this docs PR | R2-1 | ACL-free runtime path + tenant-safe key proof |
| 3 | CF-R2-RUNTIME-1 | owner_gate after R2-2 | R2-2 | Add Railway secrets + real R2 smoke test |
| 4 | CF-R2-PRODUCT-MEDIA-1 | backlog | CF-R2-RUNTIME-1 | Product media migration |
| 5 | CF-R2-STOREFRONT-MEDIA-1 | backlog | Product Media | Store branding/theme media migration |
| 6 | CF-R2-DOCUMENTS-1 | backlog | Runtime + migration patterns | Attachments/PDF/document object storage |
| 7 | CF-EDGE-BASELINE-1 | backlog | evidence pass | DNS/proxy/TLS origin baseline |
| 8 | CF-WAF-1 | backlog | EDGE baseline | WAF baseline without business-rule changes |
| 9 | CF-RATE-LIMIT-1 | backlog | WAF + traffic evidence | Login/register/reset/API abuse controls |
| 10 | CF-TURNSTILE-AUTH-1 | backlog | auth route evidence | Registration + risk-based login/reset challenge |
| 11 | CF-CACHE-1 | backlog | EDGE baseline | Safe public/static/storefront cache rules |
| 12 | CF-IMAGES-1 | backlog | R2 media + cache baseline | R2-backed image transformations |
| 13 | CF-SAAS-DOMAIN-PROVIDER-1 | decision_required | existing Railway architecture + current Cloudflare evidence | Choose custom-domain provider architecture |
| 14 | CF-SAAS-DOMAINS-1 | blocked on decision | CF-SAAS-DOMAIN-PROVIDER-1 | Custom-domain/TLS lifecycle implementation if Cloudflare selected |
| 15 | CF-BOT-1 | backlog | WAF/traffic evidence | Storefront bot-abuse policy if needed |
| 16 | CF-ZT-INTERNAL-1 | backlog | internal-host inventory | Zero Trust/Access for staging/internal tools |
| 17 | CF-EDGE-OPTIONALS-1 | decision_required | proven use case | Workers/Queues/KV/DO only if justified |
| 18 | CF-CLOUDFLARE-CLOSE-1 | backlog | all authorized tasks | Horizon closure/evidence/deferred decisions |

Statuses are planning state only. They must be revalidated against current `main` before execution. This document does not automatically authorize all rows.

## 12. Production owner gates

Explicit Safwan approval is required before:
- adding/changing Railway production secrets;
- production deploy;
- DNS nameserver/proxy/TLS cutover;
- enabling blocking WAF/Rate Limit rules in production;
- enabling Turnstile as a hard production requirement;
- production cache rules that alter application behavior;
- custom-domain provider migration;
- destructive file migration/delete;
- paid plan/provider commitment where material.

## 13. Definition of Done

The authorized Cloudflare horizon is closed only when the subset explicitly authorized by Safwan has:
- exact task outcomes merged and post-merge reviewed;
- production-required tasks separately deployed/verified with owner approval;
- no unresolved P1/P2 findings;
- R2 storage state truthful and backward compatible;
- edge/security/cache behavior evidenced;
- custom-domain provider decision recorded rather than assumed;
- costs/quotas relevant to adopted services documented;
- deferred services clearly listed;
- final closure report committed.

Do not treat “configured in Cloudflare dashboard” as complete when repository/runtime/rollback evidence is required.

## 14. Explicit deferred / non-goals

Until separately justified:
- move Laravel/PostgreSQL to Workers/D1;
- make Workers an accounting/business-rule runtime;
- adopt Queues/KV/Durable Objects merely because they are available;
- cache private ERP data;
- expose R2 bucket publicly for writes;
- make Cloudflare identity the AWJ tenant/RBAC authority;
- replace the existing custom-domain architecture without a provider decision;
- broad production cutover in one release.

## 15. Next action

Current engineering sequence stays:

```text
AWJ-R2-2
 -> review/merge under normal gates
 -> owner-approved Railway R2 variables
 -> real temporary-object smoke test
 -> first isolated media migration
```

The broader Cloudflare platform work begins only after this plan is reviewed/authorized as a Horizon or through individually approved slices.
