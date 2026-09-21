# ADR-08 — Commerce Customer Address Schema

**Status:** Accepted — Owner Decision
**Date:** 2026-09-21
**Scope:** resolves `ADR-05` §13/§22's deferred Commerce Address schema non-decision, for the new `COM-MOBILE-ADDRESSES-1` task only (split from the originally bundled `COM-MOBILE-CUSTOMER-1`, see below). Does not reopen any other ADR-05 boundary; does not refactor `Partner`.

## Context

`ADR-05` §13 ("Commerce Addresses are not forced into the current Partner address shape") explicitly deferred the schema; §22 lists "Commerce Address database schema" among its non-decisions. `Partner` (the ERP/accounting customer authority) has exactly one flat address per partner and, per ADR-05, most Commerce customers (`CustomerIdentity` rows) have no `Partner` at all — so there is nothing to extend, and ADR-05 §20 already forbids weakening/repurposing existing ERP/Partner behavior for Commerce's sake.

The Decision Escalation packet (delivered to Safwan) compared three options — a dedicated `CustomerIdentity`-owned address table (recommended), a shared polymorphic `Partner`+`CustomerIdentity` address refactor (rejected as out-of-scope ERP-wide blast radius), and no address book at all (rejected as leaving the 2026 Saudi National Address shipping mandate unaddressed) — and recommended a dedicated table with explicit Saudi National Address support from day one.

## External Evidence

Saudi National Address is an official addressing standard administered by Saudi Post (SPL) under the General Transport Authority (TGA). Corroborated across the official SPL National Address page, the official TGA mandate announcement, and the Saudi Press Agency's (SPA, the official state news agency) coverage of that announcement — **all three primary/official domains (`splonline.com.sa`, `tga.gov.sa`, `spa.gov.sa`) returned `EGRESS_BLOCKED` when fetched directly from this sandboxed environment's network policy**, so the specifics below are corroborated via search-engine summaries of those exact official pages plus independent secondary sources (Qoyod, tryOto, gogamegeek), not a direct read of the primary page content. This should be independently re-verified against `splonline.com.sa`/`tga.gov.sa` directly from an unrestricted environment before treating any exact digit-count below as contractually final — the overall shape (which fields exist and their purpose) is corroborated by multiple independent sources and matches the owner decision's own field list, so implementation proceeds on it, but the caveat is recorded honestly per this repository's own sourcing-discipline convention (see `design-system/foundations/numbering-reference.md`'s own precedent for flagging unverified secondary-sourced specifics).

- National Address components (SPL, official — corroborated): **Building Number**, **Street**, **District**, **City**, **Postal Code**, and **Secondary/Additional Number**. Building Number + Additional Number + Postal Code together resolve to one unique physical point. An optional derived **Short Address** (commonly described as 4 letters + 4 digits) acts as a single lookup code for the same point.
- TGA mandate (official, corroborated via SPA coverage of the TGA announcement): all parcel delivery companies are required not to receive/transport any shipment that does not include the National Address, effective from **January 2026**.
- Sources consulted (secondary, corroborating the blocked official pages): [Additional Number in Saudi National Address — Qoyod](https://www.qoyod.com/en/blog/e-invoicing/additional-number-saudi-national-address/), [What is the National Address — tryOto](https://help.tryoto.com/en/support/solutions/articles/150000213920-what-is-the-national-address-how-to-register-for-your-national-address-short-address-), [Important Update: Saudi Arabia National Address Requirement](https://gogamegeek.com/blogs/news/important-update-saudi-arabia-national-address-short-address-requirement). Official pages identified but not directly fetchable from this environment: `https://splonline.com.sa/en/national-address-1/`, `https://www.tga.gov.sa/en/MediaCenter/TGANewsDetails/139`, `https://www.spa.gov.sa/N2300769`.

No AWJ-internal ZATCA e-invoicing path requires customer address fields beyond what `Partner.address` already exposes — ZATCA is not a forcing function for this schema.

## AWJ Decision (owner-authorized)

1. **A dedicated `commerce_customer_addresses` table**, one-to-many from `CustomerIdentity`, is the Commerce customer address source of truth. `Partner` is not used and is not refactored.
2. Schema follows the existing `CustomerIdentity` child-table pattern already established by `CustomerOtpCode`/`CustomerPartnerLink` (`COM-MOBILE-AUTH-1`): UUID PK, `tenant_id` FK, `CompanyWide` classification, tenant-scoped composite FK to `customer_identities`.
3. Fields: `label`, `recipient_name`, `phone`, `country`, `region`, `city`, `district`, `street`, `building_no` (reusing `Partner.building_no`'s existing naming), `additional_number`, `postal_code`, `short_address` (nullable), `latitude`/`longitude` (nullable — optional, never mandatory merely because the column exists), `delivery_notes`, `is_default_shipping`, `is_default_billing`.
4. Saudi National Address fields (`building_no`, `additional_number`, `short_address`) are supported but **not unconditionally required** — validation is country-aware: mandatory-shape validation (e.g., digit-count checks) applies only when `country` identifies Saudi Arabia; a non-Saudi address is never blocked by a Saudi-specific field being empty.
5. Order-time snapshotting reuses `CommerceOrderSnapshot`'s existing, already-enforced immutability guard (`booted()` rejects create/update/delete/re-link once the owning order is confirmed) — no parallel historical-address mechanism. Selecting a saved address at checkout **copies** its fields into `CommerceCheckout`'s delivery fields (and from there into the snapshot at order confirmation, unchanged); editing or deleting a saved address afterward never touches a confirmed order's snapshot, by the same existing guard.
6. The pre-existing gap found during the Decision Escalation evidence pass — `CommerceOrderService::createFromCheckout()`'s header→snapshot mapping never sets `shipping_building_no` — is closed as part of this task's minimum required address flow (Commerce Address/Checkout → `CommerceOrderSnapshot`), since a National-Address-capable address book would otherwise still produce an incomplete snapshot end-to-end. This is a narrow, backward-compatible fix (adds a previously-dropped field to an existing mapping) — it does not modify any historical confirmed order snapshot.
7. `/store/v1` is not changed unless a narrowly necessary, backward-compatible shared fix is proven — the `createFromCheckout()` mapping fix above is Commerce-specific and does not touch `/store/v1`'s own checkout path.
8. Guest checkout remains fully backward compatible: the existing free-text `PATCH checkout/address` contract is unchanged and remains valid with zero saved addresses; a saved address is an authenticated-customer convenience that *populates* checkout fields, never a replacement or requirement.

## Task split (owner-approved)

The originally bundled `COM-MOBILE-CUSTOMER-1` (Addresses + customer order history) is split:
- **`COM-MOBILE-ORDER-HISTORY-1`** — exposes `CommerceOrderService::ownedOrders()` as a `/commerce/v1` route. No schema decision, no dependency on this ADR.
- **`COM-MOBILE-ADDRESSES-1`** — this ADR's schema and checkout-population wiring.

## Open Decisions (still not made — explicitly out of scope here)

- Exact Short Address derivation/lookup mechanism (whether AWJ ever calls an SPL lookup API to derive/validate a Short Address, versus accepting it as free-text customer input) — not needed for this task; the field is optional and accepted as provided.
- Real shipping-provider integration and its own address-field mapping requirements (`COM-MOBILE-SHIPPING-1`, still backlog).
- Any Partner/Commerce address unification — explicitly rejected as out of scope for this decision (Option B in the escalation packet), not merely deferred.

## Consequences

### Benefits
Closes the Saudi National Address gap ahead of the January 2026 shipping mandate without touching `Partner` or any ERP-wide address behavior; reuses every available existing pattern (child-table shape, immutability guard, checkout free-text fallback).

### Costs/trade-offs
A genuinely new table and CRUD surface; country-aware validation is a small amount of new logic with no existing AWJ precedent to copy verbatim (built narrowly for this task, not a general-purpose country-validation framework).

## References
- `docs/plans/store/ADR-05-CUSTOMER-MOBILE-IDENTITY-BOUNDARY.md` §13, §20, §22
- `docs/plans/commerce/COM-MOBILE-ADDRESSES-1-IMPLEMENTATION-REPORT.md` (full evidence, once implemented)
