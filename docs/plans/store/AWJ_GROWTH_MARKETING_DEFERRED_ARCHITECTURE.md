# AWJ Growth & Marketing Platform — Deferred Product Architecture

**Status:** DOCUMENTED / DEFERRED — implementation intentionally closed for now  
**Decision date:** 2026-09-28  
**Revisit gate:** after the AWJ Store and AWJ App Builder reach their agreed completion/maturity gates.

## 1. Decision

AWJ will eventually provide a unified Growth & Marketing platform rather than a narrow "Pixels" feature.

No Growth implementation is to begin now. The current product priority remains:
1. Complete and mature AWJ Store.
2. Complete and mature AWJ App Builder.
3. Re-open this document, verify current external platform APIs/policies, then convert the architecture into implementation slices.

This document exists so the capability is not forgotten while Store/App Builder work continues.

## 2. Product scope

Merchant-facing area: **Growth & Marketing / النمو والتسويق**.

Planned capability families:

- Advertising connections and campaign management: Meta, Google, TikTok, Snapchat.
- Social/channel connections.
- Conversion tracking: browser pixels/tags plus server-side conversion/event APIs.
- Product catalog/feed synchronization.
- Audiences and retargeting.
- Abandoned-cart recovery.
- Marketing messaging: WhatsApp, SMS, email, and later push where supported.
- Promotions and coupons.
- Referral programs.
- Affiliate marketing.
- Loyalty/rewards.
- Unified attribution and campaign reporting.
- ERP-aware profit intelligence: campaign revenue, COGS, payment fees, shipping, ad spend, and contribution/profit views where accounting evidence is available.

## 3. Core architectural principle

Storefront, Checkout, POS, and future apps MUST NOT embed platform-specific marketing business logic.

They emit AWJ-owned canonical commerce events into a tenant-isolated tracking layer. Platform adapters translate those events for external destinations.

Conceptually:

AWJ Store / AWJ Apps
→ Canonical Event Layer
→ Tracking & Consent Engine
→ Destination Adapters
→ Meta / Google / TikTok / Snapchat / other approved destinations

Supporting engines:
- Catalog Sync
- Audience/Segmentation
- Marketing Automation
- Attribution/Reporting

## 4. Canonical event contract — proposed baseline

The eventual implementation should define and version an AWJ-owned event schema. Candidate commerce events include:

- page_view
- view_product
- search
- add_to_cart
- remove_from_cart
- view_cart
- begin_checkout
- add_payment_info
- purchase
- refund/cancel where appropriate

Each event should carry only the minimum justified payload, for example:
- tenant/storefront/channel identifiers
- event_id
- event timestamp
- session/customer pseudonymous identifiers where permitted
- product/variant identifiers and quantities
- value and currency
- order identifier for purchase events

External naming must remain inside adapters. AWJ internal code must not depend on Meta/TikTok/etc event names.

## 5. Browser + server delivery

Architecture should support both:
- browser/client tracking where required; and
- server-side delivery where the destination supports it.

A stable event_id/deduplication strategy is required before dual delivery is enabled, so the same conversion is not counted twice.

A failed advertising destination MUST NOT block checkout, order posting, invoice posting, payment capture, inventory movement, or any financial transaction. Delivery should be asynchronous/retriable where appropriate.

## 6. Tenant isolation and security — hard requirements

Growth data is tenant data.

Required invariants:
- Every connection, credential, catalog, audience, event, delivery attempt, and report is tenant scoped.
- Cross-tenant reads/writes must fail closed.
- Provider secrets/tokens must never be exposed to storefront clients.
- Secrets must be encrypted at rest using the project's approved secret mechanism.
- RBAC is required for connect/disconnect/configuration and campaign actions.
- Sensitive actions require auditability.
- Webhook/provider callbacks require signature/state validation and tenant-safe resolution.
- Logs must not leak access tokens, raw secrets, or unnecessary customer identifiers.

No financial/accounting posting behavior may be changed to satisfy marketing attribution.

## 7. Privacy and consent

Tracking must not be treated as unconditional.

Before implementation, AWJ must define:
- consent categories and merchant configuration;
- behavior before/after consent;
- first-party identifier rules;
- data minimization and retention;
- deletion/export implications;
- regional/legal configuration where applicable;
- provider-specific consent requirements.

Store themes and App Builder output should consume the same AWJ consent/tracking contract rather than inventing separate implementations.

## 8. Merchant UX target

Suggested navigation:

**Growth & Marketing**
- Overview
- Channels & Connections
- Tracking & Conversions
- Catalogs
- Audiences
- Campaigns
- Automations
- Promotions
- Loyalty & Referrals
- Event/Delivery Log
- Reports

Connection cards should expose capability status such as:
- Browser tracking
- Server events
- Catalog
- Ads
- Last sync / connection health

Merchants should not normally paste arbitrary JavaScript into themes. Prefer typed, validated integrations.

## 9. Event/Delivery observability

Provide a tenant-scoped event log capable of answering:
- What AWJ event occurred?
- Which destinations were eligible?
- Was it sent, skipped, retried, deduplicated, or failed?
- What safe diagnostic reason is available?

Never expose provider secrets or unnecessary PII in this UI.

## 10. Catalog architecture

Build one AWJ catalog representation and destination adapters rather than provider-specific product models leaking into core commerce.

Catalog sync must account for:
- products and variants
- availability
- price/currency
- media
- canonical URLs
- publication/channel eligibility
- incremental updates and retry
- destination validation errors

The Store's Product Publication / Sales Channel model should remain the commerce source of truth.

## 11. Automation baseline

Future automation triggers may include:
- cart abandoned
- checkout abandoned
- order completed
- customer inactive
- product back in stock
- customer segment entered

Actions may include:
- WhatsApp
- SMS
- email
- coupon/promotion
- audience synchronization

Automation execution must be idempotent and tenant isolated.

## 12. Advertising management

Direct campaign creation/management inside AWJ is a later layer, not a prerequisite for tracking.

When reopened, evaluate current official APIs and permissions for:
- Meta
- Google
- TikTok
- Snapchat

Do not freeze provider API details in this deferred architecture; those APIs and review requirements change.

## 13. AWJ differentiation: ERP-aware profit intelligence

Long-term AWJ advantage is the ability to connect marketing attribution with operational and accounting evidence.

Potential funnel:

Ad spend
→ attributed order/revenue
→ payment fees
→ shipping/fulfilment cost
→ COGS
→ returns/refunds
→ contribution/profit analysis

Important: attribution is analytical. It must never rewrite posted accounting records. Any profitability metric must state its calculation basis and data completeness.

## 14. Proposed implementation sequence when reopened

### GROWTH-0 — Evidence refresh & contracts
Review official provider documentation current at implementation time. Lock canonical events, privacy/consent, tenant/security boundaries, idempotency, retention, and adapter interfaces.

### GROWTH-1 — Tracking Core
Canonical events, event IDs, consent gate, queue/outbox, delivery log, RBAC, encryption, tenant-isolation tests.

### GROWTH-2 — First provider integrations
Select provider order based on merchant demand at that time. Implement browser/server tracking and catalog where justified.

### GROWTH-3 — Remaining channel adapters
Add additional providers without changing Store/Checkout contracts.

### GROWTH-4 — Recovery & messaging automation
Abandoned carts, segmentation, WhatsApp/SMS/email, safe retries/idempotency.

### GROWTH-5 — Promotions, referral, affiliate, loyalty
Build only against stable customer/order/promotion contracts.

### GROWTH-6 — AWJ Ads
Campaign creation/management from AWJ where provider APIs, permissions, economics, and support burden justify it.

### GROWTH-7 — Profit Intelligence
Join attribution with ERP/accounting evidence without altering financial truth.

## 15. Explicitly out of scope now

Until this document is reopened:
- no pixel scripts added as a shortcut;
- no provider credentials schema;
- no Meta/TikTok/Google/Snap API implementation;
- no campaign UI;
- no Growth database migrations;
- no Growth background jobs;
- no refactor of Store/App Builder merely to anticipate this feature.

The only acceptable work before reopening is preserving clean extension seams when already touching Store/App Builder code for their own scoped tasks.

## 16. Reopen checklist

Before implementation:
- Store checkout/order lifecycle is stable.
- Product publication/catalog model is stable.
- App Builder runtime/release model is stable enough to share tracking contracts.
- Current official provider documentation has been re-verified.
- Privacy/consent requirements are approved.
- Security/RBAC/Tenant Isolation threat review is complete.
- Exact MVP provider order is approved.
- Small PR slices and test plan are defined.

## 17. Closure

**Product decision: CLOSED / DEFERRED.**

Do not schedule implementation as part of the current Store/App Builder delivery stream.

When Store + App Builder are ready, reopen this document as the starting point rather than restarting discovery from zero. External provider facts must be refreshed before coding because APIs, permissions, privacy requirements, and platform policies can change.
