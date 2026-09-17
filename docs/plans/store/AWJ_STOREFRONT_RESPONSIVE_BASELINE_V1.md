# AWJ Store — Responsive Visual Baseline V1

**Status:** LOCKED — product-owner visual approval  
**Approved:** 2026-09-17  
**Applies to:** AWJ customer-facing Storefront  
**Parent specification:** `docs/plans/store/AWJ_STOREFRONT_DESIGN_SYSTEM.md`  
**Next implementation slice:** `STORE-UI-1 — Storefront Shell`

---

## 1. Decision

The responsive visual direction produced during the AWJ Store prototype pass is approved by the product owner and is now the implementation baseline for the storefront.

This locks the **responsive composition and visual direction**, not demo commerce facts or merchant content.

Implementation must adapt the approved baseline to the existing AWJ/Spree storefront architecture rather than replacing the existing commerce foundation or copying the prototype as production domain logic.

**Visual acceptance rule:** no storefront UI PR is merged merely because it compiles or resembles the reference. The implementation preview must be reviewed against this baseline and receive product-owner visual approval before merge.

---

## 2. Responsive contract

The same storefront system must support coordinated responsive compositions across:

- Mobile reference: approximately `390–430px`.
- Tablet reference: `768px`.
- Wide tablet / compact desktop reference: `1024px`.
- Desktop reference: `1280px`.
- Wide desktop reference: `1440px`.

These are visual acceptance reference widths, not a requirement to create separate codebases or hard-coded device modes.

Mobile is not a scaled-down desktop. Tablet is a first-class intermediate composition. Desktop uses the available width for stronger commerce density and navigation.

---

## 3. Locked shell direction

### Mobile

- compact storefront header.
- prominent search access.
- shopper-focused content density.
- persistent bottom navigation on primary shopping surfaces.
- two-column product presentation where content remains readable.
- no desktop-only navigation chrome forced into the mobile composition.

### Tablet

- adaptive header and content grid.
- category navigation and product density increase progressively.
- no forced desktop cart/sidebar composition where width is insufficient.
- layout must remain deliberate at both `768px` and `1024px`.

### Desktop

- full storefront header.
- merchant identity/logo.
- prominent search.
- account/wishlist/cart actions only when the corresponding capability exists.
- visible horizontal category navigation sourced from AWJ-authoritative category data.
- shared bounded content container.
- wider commerce canvas and denser product grid.
- complete footer foundation.
- no mobile bottom navigation.

---

## 4. Theme direction

The approved prototype uses semantic theme tokens and demonstrates the first `AWJ Modern` visual direction.

The prototype's green palette is a **baseline/default presentation**, not a merchant color hard-coded throughout production components.

Production implementation must consume semantic Store Theme Tokens so that the future Store Customizer can safely control supported presentation properties without changing commerce truth.

Initial visual qualities remain:

- calm, modern commerce presentation.
- light neutral background.
- white/near-white surfaces.
- restrained borders and shadows.
- consistent radius system.
- strong product imagery.
- compact readable product cards.
- clear hierarchy and primary calls to action.
- Arabic-first spacing and typography quality.
- mirrored and usable English LTR behavior.

---

## 5. AWJ data boundary remains authoritative

Approval of the visual baseline does **not** approve prototype mock data as production data.

AWJ remains the system of record for:

- products and product identity.
- categories/classifications and membership.
- prices and valid discounts/promotions.
- inventory and availability.
- product media governed by AWJ.
- publication/eligibility.
- shipping capabilities when implemented.
- payment capabilities when implemented.
- customer/order state and other commerce facts governed by backend contracts.

The Store Customizer controls presentation only. It must not create a duplicate product catalog, duplicate taxonomy, independent price truth, or independent inventory truth.

---

## 6. Prototype/demo content is not locked

The approved prototype contains demo content used only to exercise the visual system. The following are explicitly **not production requirements or defaults merely because they appear in the prototype**:

- sample products, names, descriptions, ratings or review counts.
- sample discounts/coupons.
- sample customer/address/order data.
- sample shipping methods, delivery times, geographic claims or shipping prices.
- sample payment methods or gateway names.
- promotional/trust/legal/service copy.
- membership/loyalty wording.
- order-tracking content.

These values may later be configured, supplied or omitted by AWJ according to implemented capabilities and Store Customizer configuration.

Production UI must fail closed for unsupported capabilities and must not turn prototype copy into a platform promise.

---

## 7. Capability-driven presentation

Optional UI must render only when the corresponding AWJ capability/data contract exists.

The prototype validated the presentation concept for optional capabilities including:

- utility header content.
- trust/service benefits.
- wishlist.
- Buy Now.
- ratings/reviews.
- discounts.
- coupons/promotions.
- membership/loyalty.
- order tracking.

The prototype's JavaScript flags are a visual demonstration only. Production capability resolution must use the approved AWJ application architecture and server-authoritative contracts.

A disabled capability must not leave alternate navigation, stale controls or hidden routes that imply the feature is available.

---

## 8. Generic product options

The baseline intentionally avoids a fashion-specific or color/size-only product model.

Product option presentation must be generic and data-driven. Examples may include:

- color.
- size.
- capacity.
- material.
- package.
- unit.
- model.
- other AWJ-supported option groups.

Only groups supplied by authoritative product/variant data are rendered. Products without option groups must not show an empty options area.

Special visual renderers such as color swatches may be used only as presentation for a supported option type; they do not redefine the underlying product model.

---

## 9. RTL/LTR contract

The responsive baseline is Arabic-first and must remain fully usable in both directions.

Implementation requirements:

- Arabic uses RTL.
- English uses LTR.
- navigation, arrows, spacing and alignment mirror semantically rather than through fragile hard-coded offsets.
- product data and prices remain readable in mixed Arabic/Latin/numeric content.
- mobile bottom navigation preserves meaning and platform usability in both directions.

---

## 10. Relationship to the Store Customizer

The baseline is designed to become configurable later through AWJ Store Customizer.

Customizer-controlled presentation may include approved choices such as:

- merchant identity/logo.
- semantic primary/accent colors.
- supported Arabic/English fonts.
- hero/banner content.
- supported section visibility/order.
- supported category presentation using stable AWJ entity references.
- featured products/collections selected from AWJ-eligible entities.
- footer/contact/policy presentation where supported.

This approval does not require implementing the Customizer inside `STORE-UI-1`.

`STORE-UI-1` should establish the shell and token seams that allow `STORE-UI-6` to add merchant configuration later without redesigning the storefront architecture.

---

## 11. STORE-UI-1 implementation boundary

The next production implementation is limited to **Storefront Shell**.

### In scope

- Store Theme Token foundation.
- desktop header/navigation composition.
- mobile header composition.
- real category navigation using existing AWJ-authoritative category data.
- mobile bottom navigation.
- shared content container and responsive shell behavior.
- footer foundation.
- RTL/LTR shell behavior.
- reuse/adaptation of existing storefront components and data seams.

### Out of scope

- checkout redesign.
- payment implementation.
- shipping/logistics implementation.
- Commerce API changes.
- backend models or migrations.
- accounting/inventory behavior changes.
- duplicate category/product data.
- Store Customizer persistence/editor implementation.
- broad homepage/product-detail redesign beyond what is required to integrate the shell.
- unrelated refactoring.
- changes to the separate product-publication workstream / PR `#794`.

The implementation must preserve backward compatibility and existing storefront/commerce behavior.

---

## 12. Existing storefront architecture is the implementation foundation

The approved baseline is a visual contract, not replacement source code.

`STORE-UI-1` must work from the current `storefront/` Next.js/React structure and reuse the existing shell, category data, navigation, cart/account/search and localization seams where safe.

Do not rebuild the storefront from the single-file Stitch prototype.

The prototype may guide composition, spacing, responsive behavior and visual hierarchy; AWJ repository code and approved Commerce contracts remain authoritative for production behavior.

---

## 13. Acceptance for STORE-UI-1

Before the implementation PR may be considered complete:

- compare Preview against this locked visual baseline.
- verify approximately `390px`, `768px`, `1024px`, `1280px` and `1440px` behavior where practical.
- verify Arabic RTL.
- verify English LTR.
- verify category navigation uses real existing data rather than a second taxonomy.
- verify mobile bottom navigation and desktop navigation do not conflict.
- verify optional capability controls do not invent unsupported commerce behavior.
- run relevant component/unit tests.
- run the appropriate storefront build.
- run broader tests only where the change requires them; financial/security/tenant-isolation coverage must never be weakened.
- record changed files, tests/results, build/CI, risks, remaining work, Branch/PR/Base SHA/Head SHA and next step in the final implementation report.

**No visual approval = No merge.**

---

## 14. Lock statement

As of 2026-09-17, the product owner approved the AWJ Store responsive visual direction as:

**`AWJ Store — Responsive Visual Baseline V1 — LOCKED`**

Future refinements are allowed through explicit subsequent design/implementation tasks and through the planned AWJ Store Customizer. They do not invalidate this baseline unless a newer baseline is explicitly approved.

The immediate next action is `STORE-UI-1 — Storefront Shell`, implemented as a small independent PR with no merge or deployment until explicit product-owner approval.