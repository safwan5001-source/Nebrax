# CF-SAAS-DOMAIN-PROVIDER-1 — Custom Domain Edge Provider Decision Packet

**Status:** DECISION REQUIRED — do not implement provider migration yet  
**Prepared:** 2026-09-29  
**Related horizon:** `AWJ_CLOUDFLARE_PLATFORM_HORIZON_V1.md`

## 1. Decision

Choose the long-term provider architecture for merchant custom domains and TLS:

1. retain the repository's current Railway custom-domain provisioning architecture;
2. adopt Cloudflare for SaaS for merchant custom hostnames;
3. define a staged hybrid/migration path.

This is a material infrastructure/SaaS architecture decision and must not be inferred from the decision to use Cloudflare R2.

## 2. Current AWJ evidence

The existing accepted architecture is documented in:

`docs/plans/store/AWJ_CUSTOM_DOMAIN_EDGE_TLS_ARCHITECTURE.md`

It was designed around Railway custom-domain registration on the Storefront service, with AWJ ownership verification and provider TLS readiness kept separate.

Do not rewrite or silently invalidate that document. If Cloudflare for SaaS is selected, create an ADR that explicitly supersedes only the affected provider-specific parts.

## 3. New Cloudflare evidence

Official Cloudflare for SaaS documentation, retrieved 2026-09-29:

- Cloudflare for SaaS can route customer-owned custom hostnames to a SaaS provider origin.
- Non-Enterprise plans currently include 100 custom hostnames.
- Additional hostnames are currently $0.10 each.
- Non-Enterprise max is currently 50,000 hostnames.
- Custom hostname lifecycle can be managed through Cloudflare/API and includes TLS/validation state.

Sources:
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/create-custom-hostnames/
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/getting-started/

## 4. Why this matters

AWJ Store is multi-tenant and expects:
- AWJ-managed subdomains;
- merchant-owned custom domains;
- automatic/observable TLS lifecycle;
- thousands of potential stores over time.

The provider decision affects:
- DNS instructions shown to merchants;
- TLS/certificate state;
- domain lifecycle/state machine;
- API credentials;
- quotas/cost;
- support operations;
- rollback;
- existing verified custom domains;
- host-to-tenant resolution.

## 5. Required comparison before acceptance

| Area | Railway current architecture | Cloudflare for SaaS candidate |
|---|---|---|
| Current repository implementation alignment | Existing architecture docs/reports | New provider integration |
| Domain quota/scale | Must verify live plan/limits | 100 included; 50k non-Enterprise max per current docs |
| TLS lifecycle | Railway provider state | Cloudflare custom-hostname TLS state |
| DNS model | Railway routing + verification records | Cloudflare SaaS CNAME/fallback/custom-hostname validation |
| Existing AWJ TXT ownership | Preserve | Preserve unless explicit migration changes contract |
| Origin | Storefront Railway service | Railway can remain fallback/custom origin |
| Vendor coupling | Railway API | Cloudflare for SaaS API |
| Migration | none if retained | required for existing custom-domain provider state |
| Rollback | existing design | must be explicitly designed |
| Cost | verify current Railway plan | current additional hostname pricing documented above |

## 6. Invariants

Whichever provider is selected:

- AWJ remains authoritative for tenant/storefront ownership.
- A hostname may resolve to only one active authorized storefront.
- Ownership verified != TLS ready.
- Cross-tenant hostname access returns no tenant data.
- Merchant cannot supply provider IDs as authority.
- Provider API credentials are server-only and least-privilege.
- Domain add/verify/activate/disconnect operations are auditable.
- Production cutover requires explicit owner approval.
- Existing domains must not be broken by migration.
- AWJ-managed wildcard subdomains remain operational during transition.

## 7. Evidence required before decision

1. Current Railway production plan/domain quota and actual Storefront service binding state.
2. Existing custom-domain rows and whether any are live/merchant-facing.
3. Cloudflare zone/plan intended for AWJ Store.
4. Whether apex custom domains are required in the next product scope.
5. Required migration downtime tolerance.
6. Expected custom-domain count at 100 / 1,000 / 10,000 stores.
7. Operational support expectations for failed DNS/TLS provisioning.

## 8. Recommended direction to evaluate

Evaluate **Cloudflare for SaaS as the long-term scalable edge/TLS provider while keeping Railway as origin**, because it aligns with the broader Cloudflare edge strategy and current hostname scaling/pricing is SaaS-friendly.

This is a recommendation for the decision review, not an accepted architecture change.

## 9. Stop condition

Do not implement `CF-SAAS-DOMAINS-1` until:
- this decision is explicitly accepted;
- the accepted ADR records migration/compatibility;
- owner approval exists for any production DNS/provider cutover.
