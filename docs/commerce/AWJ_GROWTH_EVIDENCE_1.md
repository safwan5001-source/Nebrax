# AWJ-GROWTH-EVIDENCE-1 — Official Platform Capability & Integration Matrix

**Status:** Evidence baseline / documentation only  
**Base SHA:** `8a2436b712e80b95260fe59bb33b31e1f293b018`  
**Date:** 2026-09-30  
**Scope:** Meta / Instagram / Facebook / WhatsApp / TikTok / Snapchat / Google Ads / YouTube  
**No implementation, merge, deploy, production changes, or ad spend.**

---

## 1. Purpose

This pass converts the AWJ Growth product vision into a provider-by-provider capability contract based on current official documentation.

Rules:

1. **Official evidence first.**
2. A capability is not considered supported because another provider supports it.
3. Regional availability, review/approval requirements, quotas and policy restrictions remain provider-specific.
4. AWJ UI must be capability-driven.
5. Read access should precede write access for paid advertising.
6. Any money-moving action remains behind RBAC, tenant guardrails and audit.
7. Organic publishing, paid advertising, business messaging and transactional communication remain separate capabilities.

---

## 2. Status legend

- **VERIFIED** — official source confirms capability.
- **VERIFIED_WITH_GATES** — capability exists but requires scopes, review/audit, specific account type or other gate.
- **PARTIAL** — official evidence confirms only part of the desired AWJ use case.
- **OPEN** — not proven in this pass; do not implement from assumption.
- **NOT_APPLICABLE** — provider/channel does not serve that purpose.

---

## 3. Executive capability matrix

| Provider | Ads create/manage | Reporting | Organic publish | Messaging | Webhooks | Conversion server-side | Catalog/commerce | AWJ V1 stance |
|---|---|---|---|---|---|---|---|---|
| Meta Ads | VERIFIED | VERIFIED | via Instagram API | via Instagram/WhatsApp APIs | provider-specific | VERIFIED via CAPI | VERIFIED | V1 |
| Instagram | Ads through Meta | insights supported | VERIFIED_WITH_GATES | VERIFIED_WITH_GATES | VERIFIED_WITH_GATES | via Meta | PARTIAL | V1 |
| WhatsApp | NOT_APPLICABLE as standard campaign manager | messaging analytics/provider data | NOT_APPLICABLE | VERIFIED_WITH_GATES | VERIFIED | NOT_APPLICABLE as ad CAPI | templates/catalog messages supported | V1 |
| TikTok Ads | VERIFIED | VERIFIED | separate Organic/Content Posting APIs | Business Messaging API exists | VERIFIED for selected business events | provider business APIs | VERIFIED/PARTIAL by product | V1 |
| TikTok Content Posting | NOT_APPLICABLE | post status | VERIFIED_WITH_GATES | NOT_APPLICABLE | VERIFIED post outcome | NOT_APPLICABLE | NOT_APPLICABLE | V1 publishing |
| Snapchat | VERIFIED | VERIFIED | OPEN for AWJ publishing target | OPEN for AWJ inbox target | provider/API specific | VERIFIED CAPI | Dynamic Product Ads/catalog supported | V1 ads |
| Google Ads | VERIFIED | VERIFIED | NOT_APPLICABLE | NOT_APPLICABLE | API jobs/events differ | VERIFIED via enhanced/server integrations | Merchant/product-feed paths | V1 |
| YouTube Ads | through Google Ads | VERIFIED | organic channel publishing is separate YouTube API scope and not part of this pass | NOT_APPLICABLE | n/a for ads | via Google measurement | creator/product integrations exist | V1 ads |

---

## 4. Meta Ads — Facebook + Instagram paid media

### Evidence

Meta's official Marketing API/Postman workspace states that applications can:

- create campaigns,
- edit campaigns,
- create ad sets,
- create ads,
- retrieve account/ad data,
- retrieve insights.

Meta also documents related Conversions API and Catalog API capabilities.

Current 2026 platform note: Meta renamed Ads Management Standard Access to **Marketing API Access Tier** on 2026-05-04; access tier affects higher rate limits/system-user quotas and enhanced capabilities.

### AWJ decision

Create a `MetaAdsProvider` that owns paid-media actions for both Facebook and Instagram.

Minimum V1 capabilities:

```text
ads.accounts.read
ads.campaigns.read
ads.adsets.read
ads.ads.read
ads.insights.read

ads.campaigns.create
ads.campaigns.update
ads.campaigns.pause
ads.adsets.create
ads.adsets.update
ads.ads.create
ads.ads.update

catalog.read
catalog.sync
conversions.send
```

### Gates

- OAuth/access-token flow.
- Meta permissions/app review as applicable.
- Marketing API access tier/rate limits.
- Business/ad-account permissions.
- Provider versioning must be tracked.

### Official sources

- https://www.postman.com/meta/facebook-marketing-api/overview
- https://developers.facebook.com/docs/marketing-apis/
- https://developers.meta.com/blog/updates-to-ads-management-standard-access-feature/

---

## 5. Instagram — publishing, inbox and insights

### Verified publishing

Meta's official Instagram API collection confirms that Professional accounts (Business/Creator) can manage presence and publish media.

Current scope names for Instagram Login include:

- `instagram_business_basic`
- `instagram_business_content_publish`
- `instagram_business_manage_messages`
- `instagram_business_manage_comments`

With Facebook Login, content publishing is available to Instagram Professional accounts; official documentation notes Stories publishing is limited to Business accounts.

### Verified messaging gate

The Instagram Send API allows business/professional accounts to send and receive messages, but conversation initiation is constrained: the recipient must have first sent a message to the professional account.

Therefore AWJ must **not** model Instagram messaging like unrestricted outbound WhatsApp campaign messaging.

### AWJ decision

```text
publishing.image          VERIFIED_WITH_GATES
publishing.video          VERIFIED_WITH_GATES
publishing.reels          VERIFY endpoint specifics during implementation contract
publishing.stories        VERIFIED_WITH_GATES (business accounts)
comments.manage           VERIFIED_WITH_GATES
insights.read             VERIFIED_WITH_GATES
messaging.receive         VERIFIED_WITH_GATES
messaging.reply           VERIFIED_WITH_GATES
messaging.cold_outbound   NOT_SUPPORTED_BY_CURRENT_EVIDENCE
```

### Official sources

- https://www.postman.com/meta/instagram/overview
- https://www.postman.com/meta/instagram/collection/6yqw8pt/instagram-api
- https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api

---

## 6. WhatsApp Business Platform

### Verified core

Meta's official WhatsApp Business Platform collection confirms:

- Cloud API is the official API.
- programmatic send/receive messaging,
- text/media/template messages,
- message IDs,
- delivery/read/failure status via webhooks,
- WABA webhook subscriptions,
- message-template create/read/edit/delete operations,
- business system integration.

### Required assets

The official Cloud API guide requires:

- Meta business portfolio,
- WhatsApp Business Account,
- business phone number,
- access token/permissions.

Relevant permissions include `whatsapp_business_messaging` and for management operations `whatsapp_business_management`.

### AWJ decision

WhatsApp lives under **AWJ Communications Platform** and is consumed by AWJ Growth.

```text
messaging.send_service       VERIFIED_WITH_GATES
messaging.send_template      VERIFIED_WITH_GATES
messaging.receive            VERIFIED
messaging.status             VERIFIED
templates.manage             VERIFIED_WITH_GATES
webhooks.messages            VERIFIED
commerce.catalog_message     VERIFIED_WITH_GATES
campaign.messaging           POLICY_GATED
```

Transactional/service/marketing/authentication must remain distinct in AWJ policy handling.

### Official sources

- https://www.postman.com/meta/whatsapp-business-platform/overview
- https://www.postman.com/meta/whatsapp-business-platform/collection/wlk6lh4/whatsapp-cloud-api
- https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-ba8d099d-007e-4b52-b9f2-3cf3c60e4fbc
- https://www.postman.com/meta/whatsapp-business-platform/folder/lboq68h/webhooks
- https://www.postman.com/meta/whatsapp-business-platform/folder/lczy75a/templates

---

## 7. TikTok — API for Business

### Verified API families

TikTok's official API for Business documentation separates:

1. **Marketing API**
2. **Organic API**
3. **Business Messaging API**

Marketing API supports programmatic campaign/ad-group/ad management, creative assets/tools, audiences and reporting.

Organic API is explicitly positioned for brand organic presence and links organic success to paid amplification such as Spark Ads.

Business Messaging API exists as a separate API family; its exact AWJ inbox contract requires its own provider-specific pass before implementation.

### AWJ decision

```text
ads.campaigns.read/create/update       VERIFIED
ads.adgroups.read/create/update        VERIFIED
ads.ads.read/create/update             VERIFIED
ads.reporting                          VERIFIED
audiences.manage                       VERIFIED
creative.manage                        VERIFIED
webhooks.selected_business_events      VERIFIED
organic.brand_management               VERIFIED conceptually
spark_ads.integration                  VERIFIED conceptually
business_messaging                     PARTIAL — separate evidence pass required
```

### Official sources

- https://business-api.tiktok.com/portal
- https://business-api.tiktok.com/gateway/docs/
- https://ads.tiktok.com/resources/help/article/marketing-api

---

## 8. TikTok — Content Posting API

### Verified

As of the official docs updated August 2026:

- Direct Post supports video and photo.
- Upload API supports uploading video/photo as drafts for the user to finish in TikTok.
- Direct Post requires `video.publish`.
- Upload requires `video.upload`.
- Target TikTok user must authorize the app.
- Unaudited clients' directly posted content is restricted to private visibility.
- TikTok provides post-status fetch plus Content Posting webhooks.
- creator information must be queried before direct posting.
- API rate limits are endpoint/token specific.

### AWJ decision

```text
publishing.video.direct       VERIFIED_WITH_GATES
publishing.photo.direct       VERIFIED_WITH_GATES
publishing.video.draft        VERIFIED_WITH_GATES
publishing.photo.draft        VERIFIED_WITH_GATES
publishing.status             VERIFIED
publishing.webhook            VERIFIED
```

Do not promise public publishing until TikTok audit/app approval requirements are satisfied.

### Official sources

- https://developers.tiktok.com/products/content-posting-api
- https://developers.tiktok.com/docs/en/content-posting-api-get-started
- https://developers.tiktok.com/docs/en/content-posting-api-get-started-upload-content
- https://developers.tiktok.com/docs/en/content-posting-api-reference-get-video-status
- https://developers.tiktok.com/docs/en/content-posting-api-reference-photo-post

---

## 9. Snapchat Ads

### Verified paid-media foundation

Snap's official developer/business documentation confirms:

- Marketing API for advertising technology integrations,
- campaign execution/management use cases,
- real-time reporting,
- advanced targeting/bidding,
- product/catalog-driven ads,
- Snap Pixel,
- Conversions API,
- custom/lookalike audience use cases.

Snap's CAPI is server-to-server and supports web/app/offline conversion events.

### Saudi relevance

Snap's official Salla integration page explicitly discusses Salla stores and Saudi Arabia, confirming Snap Pixel + CAPI as a relevant ecommerce integration pattern in KSA.

This does **not** prove that every Marketing API feature has identical regional availability; that remains feature-specific.

### AWJ decision

```text
ads.manage                 VERIFIED
ads.reporting              VERIFIED
audiences.manage           VERIFIED
catalog/product_ads        VERIFIED
pixel                      VERIFIED
conversions.server         VERIFIED
organic.publish            OPEN
business.messaging         OPEN
```

Do not build Snapchat publishing/inbox UI until official API evidence is obtained for the exact desired use case.

### Official sources

- https://developers.snap.com/api/marketing-api/
- https://developers.snap.com/api/marketing-api/Conversions-API
- https://forbusiness.snapchat.com/advertising
- https://forbusiness.snapchat.com/advertising/snap-pixel
- https://forbusiness.snapchat.com/resources/salla

---

## 10. Google Ads + YouTube paid media

### Verified Google Ads API

Google Ads API supports programmatic campaign management and reporting.

For a multi-tenant SaaS managing accounts on behalf of multiple users, Google documents the **multi-user OAuth authentication** workflow.

### Important 2026 onboarding change

Official Google Ads documentation states that **developer tokens were sunset on September 9, 2026** and API access levels are now associated with Google Cloud projects. Older client libraries may still locally expect a token value, but API servers ignore the developer-token header.

This must be reflected in AWJ implementation planning; do not implement from older onboarding guides that assume developer-token access is the active server-side control.

### Performance Max

Official Google Ads/API docs confirm Performance Max can be created programmatically and spans Google's inventory including:

- Search
- YouTube
- Display
- Discover
- Gmail
- Maps

YouTube Shorts inventory is included in Performance Max.

### Demand Gen / YouTube

Official Google Ads docs confirm Demand Gen reaches:

- YouTube,
- YouTube Shorts,
- Discover,
- Gmail,
- Google video partner inventory / current supported visual surfaces.

Google notes that Video Action Campaigns have been upgraded to Demand Gen by 2026.

### AWJ decision

```text
google.accounts.connect         VERIFIED_WITH_GATES
google.campaigns.read           VERIFIED
google.campaigns.write          VERIFIED
google.reporting                VERIFIED
google.performance_max          VERIFIED
google.demand_gen               VERIFIED
youtube.ads                     VERIFIED
youtube.shorts_ads              VERIFIED
google.oauth.multi_user         VERIFIED
```

Organic YouTube channel publishing is **outside this evidence pass** and must not be inferred from Google Ads API.

### Official sources

- https://developers.google.com/google-ads/api/docs/oauth/overview
- https://developers.google.com/google-ads/api/docs/oauth/user-authentication
- https://developers.google.com/google-ads/api/docs/api-policy/developer-token
- https://developers.google.com/google-ads/api/performance-max/standard
- https://support.google.com/google-ads/answer/16042151
- https://support.google.com/google-ads/answer/16040528
- https://support.google.com/google-ads/answer/15110871

---

## 11. Conversion signal architecture

The evidence strongly supports server-side conversion signals as a cross-provider foundation:

- Meta Conversions API
- Snapchat Conversions API
- Google first-party/enhanced conversion infrastructure
- TikTok business conversion/event APIs (exact event contract to be detailed separately)

### AWJ decision

Create one internal contract:

```text
GrowthConversionEvent
├── tenant_id
├── event_id
├── event_type
├── occurred_at
├── source
├── order_id?
├── customer_ref?
├── value?
├── currency?
├── consent_state
├── attribution_context
└── provider_delivery_status[]
```

Requirements:

- deterministic event ID,
- deduplication,
- tenant isolation,
- consent state,
- no forbidden/sensitive payloads,
- provider-specific mapping outside domain core,
- refund/cancellation correction path,
- audit trail.

---

## 12. Authentication and credential model

### Shared rule

Provider tokens/secrets must never be stored as generic tenant settings.

Use:

```text
GrowthConnection
├── tenant_id
├── provider
├── provider_account_id
├── encrypted_credentials_ref
├── granted_scopes
├── expires_at
├── status
├── last_refresh_at
└── revoked_at
```

### Provider notes

- Meta: OAuth/access-token + business permissions/app review/access tier as applicable.
- TikTok: developer app + user/business authorization + API-specific approvals.
- Snapchat: Marketing API onboarding/OAuth/provider access requirements to be locked in provider contract.
- Google: OAuth 2.0; multi-user flow is appropriate for SaaS managing separate customer accounts; API access is now tied to Google Cloud project access level.

---

## 13. Webhook/event ingestion

Do not let provider webhook payloads directly mutate accounting/commerce records.

Pipeline:

```text
Provider webhook
→ signature/verification
→ raw immutable receipt
→ tenant resolution
→ idempotency
→ provider adapter
→ normalized Growth event
→ domain handler
→ audit
```

Required:

- replay protection where provider supports/signals it,
- idempotency,
- unknown-event safe handling,
- dead-letter/retry path,
- tenant resolution before business action,
- no cross-tenant fallback.

---

## 14. Capability-driven UI contract

The UI must query capabilities rather than branch on provider name.

Example:

```json
{
  "provider": "tiktok",
  "capabilities": {
    "ads.create": true,
    "ads.reporting": true,
    "publishing.video.direct": true,
    "publishing.photo.direct": true,
    "messaging.business": "partial"
  }
}
```

A capability can have metadata:

```text
state: VERIFIED | VERIFIED_WITH_GATES | PARTIAL | OPEN | NOT_APPLICABLE
requires_review: boolean
requires_business_account: boolean
requires_scope: string[]
regional_status: VERIFIED | UNKNOWN | RESTRICTED

The runtime/UI enum names must match this document's status legend; do not introduce a second vocabulary such as `GATED` or `UNAVAILABLE` without an explicit mapping.
```

---

## 15. V1 provider scope locked by this pass

### Build in V1

**Meta**
- Ads read/write
- insights
- catalog/conversion integration

**Instagram**
- professional-account publishing
- comments/insights
- inbound-first messaging/replies

**WhatsApp**
- official Cloud API
- templates
- transactional/service messaging
- inbox/webhooks/status
- policy-controlled marketing messaging

**TikTok**
- ads read/write/reporting
- Content Posting direct/draft
- post status/webhooks
- Organic/Spark integration contract after provider detail pass

**Snapchat**
- ads
- reporting
- audiences/catalog
- Pixel/CAPI
- no assumed organic publishing/inbox

**Google/YouTube**
- Google Ads account connection
- campaign/reporting
- Performance Max
- Demand Gen
- YouTube/Shorts paid inventory
- no assumed organic YouTube publishing

---

## 16. Explicitly deferred / requires deeper contract

1. TikTok Business Messaging exact eligibility, regional availability and message-policy contract.
2. Snapchat organic publishing capability for AWJ's desired use case.
3. Snapchat direct business messaging/inbox capability for AWJ.
4. Organic YouTube upload/publishing through YouTube Data API.
5. Exact Meta/Instagram endpoint/version contract for every media subtype (Reels/Stories/carousels) at implementation time.
6. Provider-specific rate-limit tables.
7. Provider-specific Saudi-region restrictions for each ad objective/format.
8. Exact pricing/fees for each provider; pricing is time-sensitive and separate from API capability.
9. Creator authorization/rights lifecycle for Spark/Partnership/creator ads.
10. Production app-review checklists for each provider.

None of these may be silently implemented from assumptions.

---

## 17. Architecture consequences

This evidence pass confirms the AWJ Growth architecture should keep these boundaries:

```text
AWJ Growth Domain
├── Ads
├── Publishing
├── Analytics
├── Automation
├── Growth AI
│
├── Provider Adapters
│   ├── MetaAdsProvider
│   ├── TikTokAdsProvider
│   ├── SnapchatAdsProvider
│   └── GoogleAdsProvider
│
├── Publishing Adapters
│   ├── InstagramPublishingProvider
│   └── TikTokPublishingProvider
│
└── Communications Platform
    ├── WhatsAppProvider
    ├── InstagramMessagingProvider
    ├── SMS Providers
    └── Email Providers
```

This avoids pretending that every social provider has the same ads, posting and messaging surfaces.

---

## 18. Security / tenancy non-negotiables

Before any provider reaches production:

- tenant-scoped connection ownership,
- encrypted credentials,
- explicit scopes recorded,
- disconnect/revocation,
- token refresh handling,
- cross-tenant negative tests,
- webhook tenant resolution,
- idempotent writes,
- RBAC for read/write/spend,
- separate permission for budget changes,
- immutable audit for spend-impacting actions,
- no AI bypass of provider or tenant policy.

---

## 19. Recommended next implementation sequence

### GROWTH-FOUNDATION-1 — Connections & Capability Registry

Documentation/contract first, then code:

1. `GrowthConnection` contract.
2. Provider enum/registry.
3. Capability registry.
4. encrypted credential reference contract.
5. connection lifecycle: pending/connected/expired/revoked/error.
6. tenant isolation.
7. RBAC:
   - `growth.view`
   - `growth.connections.manage`
   - `growth.ads.manage`
   - `growth.budget.manage`
   - `growth.publishing.manage`
   - `growth.messaging.manage`
8. audit events.
9. no external provider write in the first foundation slice.

### Then

- GROWTH-TRACKING-1 — normalized conversion/event contract.
- GROWTH-META-READ-1.
- GROWTH-TIKTOK-READ-1.
- GROWTH-SNAP-READ-1.
- GROWTH-GOOGLE-READ-1.
- Only after stable read/attribution: provider write slices.

---

## 20. Evidence conclusion

The AWJ Growth V1 concept is technically viable across the requested channels, but **not as one identical universal API**.

The evidence supports:

- paid ads across Meta, TikTok, Snapchat and Google/YouTube,
- organic publishing for Instagram and TikTok under provider gates,
- official WhatsApp business messaging,
- constrained Instagram business messaging,
- server-side conversion signal foundations,
- programmatic reporting and campaign management.

The evidence does **not** currently support assuming identical organic publishing or inbox capabilities for Snapchat, or unrestricted outbound Instagram messaging.

Therefore the existing **Capability Matrix + Provider Adapter + shared Communications Platform** direction is confirmed.

