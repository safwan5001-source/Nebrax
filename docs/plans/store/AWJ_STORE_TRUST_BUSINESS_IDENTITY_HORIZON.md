# AWJ Store Trust, Business Identity & External Brands Horizon V1

**Status:** Proposed / owner-authorized for definition only  
**Repository:** `safwan5001-source/Nebrax`  
**Base main SHA:** `7c1dd55c7e7cd2e8e9d80f3cf52f65b260947d48`  
**Preceding merge:** PR #926 — Official Saudi Business Center Merchant Seal Integration  
**No Deploy / Production Release authorization**

## 1. Objective

Close the public-store trust and external-brand presentation surfaces as one coherent horizon instead of leaving CR, VAT, SBC, WhatsApp, social networks, App Store, Google Play, and related official assets as disconnected features.

This horizon owns presentation, provenance, UX parity, accessibility, and safe external-link behavior.

It does **not** create a second legal-identity source, a storage subsystem, a verification authority, or new commerce/financial truth.

## 2. Source-of-truth boundaries

### Business identity

Canonical values remain server-owned:

- legal/business entity name → `Tenant.name`;
- Commercial Registration → `Tenant.cr_number`;
- VAT number → `Tenant.vat_number`;
- public store/display name → `Storefront.name`.

The Store Customizer may control presentation only. It must not create duplicate authoritative CR/VAT/legal-name fields.

### Saudi Business Center

PR #926 is merged. Its current contract remains authoritative unless this horizon finds a verified defect.

The merchant does not become a verification authority.

The official loader executes only in the public storefront. Authoring/preview surfaces remain inert and must not expose a seal token to the third-party loader.

### WhatsApp / Social / App stores

Merchant configuration may provide links/usernames only through the existing presentation contract.

External brand marks are presentation assets. Their authenticity and permitted usage must be evidenced before production use.

## 3. Mandatory evidence rule

Before changing or adding any third-party or government brand asset, inspect the current code and then consult authoritative external sources where needed.

For each external brand record:

- official source;
- exact asset/mark/badge;
- permitted usage context;
- required colors/proportions/clear space;
- localization requirements if any;
- linking requirements;
- whether local hosting is permitted or the asset must be served/embedded another way;
- any restrictions on alteration, recoloring, redrawing, or combining with other marks.

Do not use screenshots, AI-generated marks, hand-redrawn approximations, unofficial icon packs, or copied assets as substitutes for official evidence.

## 4. Horizon scope

### A. Business Identity

Complete and verify:

- legal name;
- CR;
- VAT;
- store display name distinction;
- Footer presentation;
- Customizer preview parity;
- Arabic RTL / English LTR;
- desktop/mobile layout;
- absence behavior when canonical values are missing.

No CR/VAT editing is introduced in the Customizer.

### B. Saudi Business Center

Post-merge verification of #926:

- official seal provenance remains documented;
- public-only loader execution;
- disabled/token-redaction behavior;
- text fallback;
- stale loader race protection;
- tenant isolation;
- merchant preview parity without external script execution.

Do not create a second SBC implementation.

### C. WhatsApp

Complete evidence and presentation for:

- configured WhatsApp destination;
- floating/footer/both placements;
- official icon/brand use where permitted;
- safe external-link behavior;
- no message-sending claim;
- Preview must not navigate away from the editor.

### D. Social networks

Current supported networks:

- Instagram
- X
- TikTok
- Snapchat
- YouTube
- LinkedIn
- Facebook

Verify and complete:

- normalized/safe merchant URL handling;
- icon/brand presentation;
- accessible label;
- external-link semantics;
- hide invalid/empty values;
- Preview ↔ Published parity.

Do not add new networks unless current product evidence requires them.

### E. App Store / Google Play

Complete:

- existing `iosUrl` / `androidUrl` contract;
- Footer links;
- App Promo section;
- official App Store / Google Play badge usage when evidence permits;
- no fake app availability;
- no badge without a real valid destination;
- locale/responsive behavior.

### F. Shared trust/footer composition

Ensure semantic grouping:

1. Business Identity
2. Official Trust / SBC
3. Communication / Social
4. Applications
5. Existing policies/navigation/payment areas where already supported

Do not visually mix CR/VAT with verification badges or external social brands.

## 5. Explicitly out of scope

- Business document image uploads/viewer implementation
- persistent/object storage activation
- branding upload endpoints
- new logo storage architecture
- Promotions / Offers
- payment-brand implementation not already supported
- VAT validation/verification service
- CR government lookup
- new SBC verification API/polling/scraping
- accounting / invoice / ZATCA changes
- new social networks
- redesign of the entire Store Customizer
- Deploy / Production Release

## 6. Storage boundary

The owner decision already selected:

`KEEP_EMBEDDED_MEDIA_UNTIL_PERSISTENT_STORAGE_IS_AUTHORIZED`

That decision currently lives in PR #1044 and must be reconciled into durable main history before any task attempts to depend on it.

This horizon must not:

- move branding to local container disk;
- add a branding-only bucket;
- enable `DOCUMENT_DURABLE_STORAGE_ENABLED`;
- implement Business Documents Viewer uploads.

If an official external badge/icon can be safely consumed without a new merchant-upload/storage path, that may remain in scope after evidence. Otherwise stop at a Decision Gate.

## 7. Invariants

Preserve:

- Tenant Isolation;
- `commerce.manage` on merchant authoring;
- Draft/Public separation;
- canonical legal identity authority;
- public minimum-data principle;
- no secret/token exposure to authoring surfaces or unnecessary public responses;
- safe URL allow-listing/normalization;
- no arbitrary merchant HTML/JS;
- backward compatibility for existing presentation documents;
- no finance/tax/payment semantics change.

## 8. Required visual and interaction QA

Verify both Arabic RTL and English LTR at:

- 390
- 430
- 768
- 1024
- 1280
- 1440

Surfaces:

- merchant Web Customizer;
- any maintained storefront dev mirror/harness, without treating it as product authority;
- published Storefront Footer;
- App Promo where applicable.

States:

- empty;
- partial configuration;
- fully configured;
- invalid/unsafe external link;
- long text;
- missing canonical identity field;
- SBC OFF / ON without token / ON with token;
- app links none / one / both.

No horizontal overflow or inaccessible icon-only controls.

## 9. Task sequence

Use the companion queue:

`docs/plans/store/AWJ_STORE_TRUST_BUSINESS_IDENTITY_TASK_QUEUE.md`

Execution must be dependency-safe.

No task may promote itself to ready by inventing an asset license, verification authority, URL policy, or storage path.

## 10. Horizon gates

Every implementation PR requires:

Evidence → Scope/DoD → focused tests → broader risk tests → Implementer self-review → Reviewer → AWJ Guardian → exact-head CI → PRE_MERGE_REVIEW PASS → merge → POST_MERGE_REVIEW PASS.

No deploy.

## 11. Horizon end

The horizon closes only when:

- all ready tasks are merged and post-reviewed;
- all external-brand assets in production use have provenance/usage evidence;
- CR/VAT/SBC/WhatsApp/Social/App links have Preview ↔ Published parity;
- responsive/accessibility/security QA is recorded;
- blocked storage-backed document imagery is explicitly left deferred rather than silently omitted;
- closure report and CURRENT-STATE are updated.

Do not automatically start a storage horizon, Promotions Engine, or another theme horizon after closure.
