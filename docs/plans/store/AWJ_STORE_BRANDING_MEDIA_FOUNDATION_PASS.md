# AWJ Store Branding & Media Foundation — Evidence / Decision Pass

**Status:** Evidence complete — `INFRA_DECISION_REQUIRED`  
**Repository:** `safwan5001-source/Nebrax`  
**Base main SHA:** `8881a8f3f4f86b4b62b7faca1f52cef91a21e4a2`  
**Scope:** Store Customizer branding/media persistence only  
**No implementation authorization:** this pass does not authorize a storage provider, DB migration, public API change, deploy, or production migration.

## Why this is next

Store Customizer capability completion and visual verification are closed.

Current evidence records one remaining product/architecture gate in the customization foundation:

- branding media currently uses a Data URL persistence path with a 512 KB cap;
- banner content accepts an `https` image URL but does not own a real merchant media upload lifecycle;
- the previous horizon explicitly deferred object-storage/media architecture.

Themes, richer visual customization, and merchant branding should not build on a temporary persistence mechanism.

## Objective

Determine the smallest safe AWJ-owned media foundation for merchant branding and Store Customizer media.

The pass must answer from current repository evidence:

1. What media/file abstractions already exist in AWJ?
2. Which of them are tenant-safe and reusable for Store Customizer branding?
3. Whether the existing Product Media / document media architecture can be reused without creating a second file system.
4. What media types need first-class support:
   - store logo;
   - favicon/store icon if already part of the product contract;
   - banner image;
   - future section images only if already evidenced.
5. Required lifecycle:
   - upload;
   - validate;
   - persist metadata/reference;
   - preview;
   - publish;
   - public delivery;
   - replace;
   - delete/orphan cleanup;
   - tenant deletion/export implications if applicable.
6. Required authorization boundary, including `commerce.manage`.
7. Whether public media delivery requires signed URLs, public immutable URLs, a proxy/download route, or another existing AWJ pattern.
8. What backwards compatibility is required for existing Data URL branding documents.
9. Whether any migration is actually needed.

## Evidence-first rule

Do not choose S3, Railway Volume, Cloudflare R2, Supabase Storage, or any other provider merely because it is convenient.

First inspect:

- current Laravel filesystem configuration;
- existing ProductMedia / document-media / attachment models and routes;
- tenant scoping;
- production hosting/storage assumptions already committed in repo;
- existing public storefront media delivery;
- cleanup/retention behavior;
- security validations for MIME/type/size;
- any existing image normalization/transcoding behavior.

External provider research is allowed only after repository evidence establishes a genuine provider decision.

## Required classification

For each reusable media path found, record:

`Mechanism | Current owner/domain | Tenant scoped? | Public delivery | Upload validation | Cleanup | Reusable for Store branding? | Risk / gap`

Then classify the next step as exactly one of:

- `REUSE_EXISTING_PATH`
- `EXTEND_EXISTING_PATH`
- `PRODUCT_DECISION_REQUIRED`
- `INFRA_DECISION_REQUIRED`
- `NOT_READY`

## Invariants

Preserve:

- Tenant Isolation;
- `commerce.manage`;
- Draft/Public separation;
- backward compatibility for existing stores;
- no arbitrary remote fetch proxy;
- no cross-tenant media references;
- no executable uploads;
- MIME/type/size validation;
- no accounting/payment/tax impact;
- no provider lock-in without owner decision.

## Data URL migration rule

Existing Data URL branding must not break.

The Evidence Pass must decide whether old values:

- continue rendering indefinitely;
- lazily migrate;
- migrate only on next save;
- require a separate migration.

Do not silently rewrite existing merchant data in this pass.

## Deliverables

Create:

- `docs/plans/store/AWJ_STORE_BRANDING_MEDIA_FOUNDATION_EVIDENCE.md`
- if a real architectural choice remains: `docs/plans/store/AWJ_STORE_BRANDING_MEDIA_FOUNDATION_DECISION_PACKET.md`

The Evidence document must include:

- current-state diagram;
- reusable code paths;
- security/tenant findings;
- backward-compatibility constraints;
- migration necessity or lack thereof;
- provider decision necessity or lack thereof;
- smallest safe implementation slice;
- recommended next task IDs and dependency order.

## Stop conditions

Stop and issue a Decision Packet if the smallest safe implementation requires any of:

- a new storage provider;
- a new cross-service media architecture;
- a meaningful DB schema/migration;
- signed/public URL policy with material trade-offs;
- material retention/deletion policy;
- tenant/security boundary change.

Otherwise, if current AWJ infrastructure is sufficient, the pass may classify a focused implementation slice as ready.

## Explicitly out of scope

- Promotions / Offers
- Undo/Redo
- Version history
- Market theme
- Floral theme
- broad Store Customizer redesign
- production deploy/release/migration

## End condition

This pass ends with evidence and a go/no-go classification only.

Do not implement the media foundation in the same PR.
