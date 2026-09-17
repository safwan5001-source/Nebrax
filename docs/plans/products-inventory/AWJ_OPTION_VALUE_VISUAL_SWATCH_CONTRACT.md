# AWJ Option Value Visual / Swatch Contract

Status: Approved architecture contract
Date: 2026-09-17
Scope: Product Options / Variants visual metadata across ERP, POS, Storefront and future mobile commerce

## 1. Purpose

AWJ currently supports Product Options and concrete Product Variants. An option value such as `أبيض`, `أسود`, or `أحمر` is currently semantic text only. This is sufficient to generate variant combinations, but it is not sufficient for a visual commerce experience where a customer selects an actual color swatch or material sample.

This contract adds visual metadata to an Option Value without changing Variant identity, inventory identity, pricing authority, barcode authority, or historical accounting truth.

Example:

- Option: اللون
- Value label: أزرق سماوي
- Visual type: color
- Visual value: `#AFC9F5`

The same canonical Option Value visual metadata may then be rendered consistently in Product administration, POS, Storefront, and future mobile applications.

## 2. Core principle

**The Option Value is the canonical owner of its visual swatch.**

A Product Variant references option values; it does not duplicate their color metadata merely for presentation.

Example resolution:

`Product + Size=L + Color=Sky Blue -> concrete ProductVariant`

The `Sky Blue` Option Value independently provides the swatch used to render the color selector.

Visual metadata is presentation/catalog metadata. It MUST NOT become inventory, pricing, barcode, accounting, or publication authority.

## 3. Supported visual types

Option Values must support these conceptual modes:

### 3.1 None / text

Default and backward-compatible behavior.

Examples:
- Size: S, M, L, XL
- Capacity: 128 GB, 256 GB
- Material: Cotton

No swatch is required.

### 3.2 Color

The Option Value has a user-selected real color value.

Example:
- Label: أبيض
- Visual type: color
- Color value: `#FFFFFF`

The label remains authoritative for human-readable text. The hex value is visual metadata only.

### 3.3 Image swatch

The Option Value uses a small visual sample/image rather than a flat color.

Examples:
- wood grain
- marble
- fabric texture
- patterned material

The image must use AWJ's tenant-safe media/storage boundary. Internal storage paths must never be exposed directly to clients.

## 4. UX contract — Product Create/Edit

Option authoring must distinguish ordinary values from visual values.

A user must not be forced to name an option exactly `اللون` or `Color` for AWJ to infer behavior. Visual behavior must be explicit metadata, not string-name guessing.

Conceptually an option/value authoring flow may expose:

- ordinary/text option
- color visual option
- image/sample visual option

For a color value, the UI should collect:

- human label, e.g. `أزرق سماوي`
- actual color through a color picker
- canonical normalized color value

For an image swatch, the UI should collect:

- human label
- tenant-safe image/sample

The value chip/list should show the visual swatch beside the label, e.g. `● أزرق سماوي`.

Mobile controls must remain touch-friendly and must not rely on hover.

## 5. Storefront contract

Storefronts may render visual Option Values as swatches instead of text-only buttons.

Example:

`🔵 ⚪ ⚫ +2`

A selected swatch must still resolve through the normal Variant option-value combination. The visual color itself never identifies stock.

Conceptual flow:

`Customer selects Color=Sky Blue`
`+ Size=L`
`-> resolve ProductVariant`
`-> resolve availability / inventory identity`
`-> resolve canonical pricing precedence`
`-> resolve barcode only where applicable`
`-> resolve gallery/media presentation`

The Storefront must not infer a Variant from a hex value.

## 6. POS contract

POS may render the same canonical Option Value swatch to make variant selection faster.

The swatch is presentation only.

POS must continue to resolve the concrete ProductVariant before inventory/pricing operations. Client-provided visual metadata must never be trusted as Product/Variant identity or price authority.

## 7. Relationship to Variant Media

This contract intentionally supports the previously approved media direction:

1. Product gallery = shared/common media.
2. Visual Option Value media = preferred shared visual media for a value such as `Color=Black`.
3. Exact ProductVariant media override = optional more-specific layer where supported.

Conceptual resolved gallery:

`Product gallery + selected visual Option Value media + optional exact Variant overrides`

A swatch image is not automatically the full product gallery. Swatch thumbnail/sample media and option-value product media may share infrastructure, but their semantics must remain explicit.

No missing Option Value media-authoring backend should be invented silently as part of a frontend-only change. Implementation must inspect current authority first.

## 8. Data/domain requirements

Implementation must preserve the existing Product Option / Option Value identity and extend it with nullable visual metadata using the smallest safe model.

The exact schema must be evidence-driven from the current repository before implementation. This document does not mandate column names before that evidence pass.

The domain must be able to represent at minimum:

- visual type: none/text, color, image
- normalized color value when visual type is color
- tenant-safe media reference when visual type is image

Invalid combinations must be rejected, for example:

- color type without a valid color value
- image type with an invalid/cross-tenant media reference
- arbitrary unsupported visual types

Existing Option Values with no visual metadata must remain valid and render as text.

## 9. Tenant Isolation and security

Visual metadata MUST preserve AWJ Tenant Isolation.

Requirements:

- Option Value belongs to the same tenant/product option boundary already enforced by the Variants domain.
- Image swatches must not reference another tenant's media.
- Media access must use existing guarded/tenant-safe media mechanisms.
- Internal storage paths must not leak in API or rendered DOM.
- Mutation permissions must follow the existing Product Option/Variant management authority.
- Client-provided hex/image data is presentation input only and never trusted for financial or inventory authority.

## 10. Backward compatibility

This feature must be additive.

Existing products/options/variants without visual metadata remain valid.

Existing API consumers must continue to work if they ignore the new nullable visual fields.

No synthetic/default Variant is introduced.

Simple Products remain directly sellable and are unaffected.

No existing Variant IDs may be regenerated merely because visual metadata changes.

Changing `أزرق سماوي` from one visual hex to another is a presentation/catalog edit and must not recreate the Variant or alter its inventory identity.

## 11. Inventory, pricing and barcode invariants

Visual Option Value metadata MUST NOT change these authorities:

- each concrete Variant retains its independent inventory/valuation identity;
- UOM remains orthogonal to Variant;
- canonical Product/Variant × UOM pricing remains authoritative;
- conversion factor does not determine explicit selling price;
- Barcode remains an alias/resolver to Product + optional Variant + UOM;
- Barcode is not price authority;
- a swatch is never barcode authority;
- a swatch is never inventory identity.

## 12. Publication and Commerce invariants

`CommerceListing.is_published` remains the sole Product publication truth.

Visual Option metadata must not introduce `Product.is_online` or another publication flag.

A storefront may expose only the Option Values/Variants that are valid under the existing Commerce publication and availability rules.

## 13. Historical documents and accounting

Live swatches/colors/images are catalog presentation metadata.

Posted financial documents must not reinterpret historical truth from current visual metadata.

Existing immutable line snapshots for Product/Variant descriptors, SKU/barcode/UOM/pricing/tax/totals remain authoritative for historical documents.

Changing a color swatch later must not change historical invoices, inventory valuation, journals, or posted document meaning.

## 14. Accessibility

Color must never be the only carrier of meaning.

Every visual Option Value must retain a human-readable label.

Storefront/POS/admin UI must provide accessible names for swatches and visible selected-state treatment beyond color alone (border/check/selection state as appropriate).

White/light swatches must remain visually distinguishable against light backgrounds through a neutral boundary.

## 15. API contract direction

Existing Option/Variant endpoints should be extended rather than creating a parallel visual-options subsystem, unless repository evidence proves a separate resource is necessary.

Read surfaces should expose enough normalized metadata for clients to render:

- label
- visual type
- normalized color value or tenant-safe image representation

Write surfaces must validate type-specific fields and tenant ownership.

Clients must not be required to infer visual type from the option name.

## 16. Non-goals

This contract does NOT authorize:

- changing Variant inventory identity;
- changing UOM architecture;
- changing pricing precedence;
- changing barcode resolution;
- changing accounting/document posting;
- changing Commerce publication authority;
- building a new storefront theme system;
- building SEO functionality;
- inventing per-Variant duplicate color metadata;
- automatic color-name-to-hex guessing as canonical truth;
- making visual identity a tenant Setting.

## 17. Settings decision

This is **not a tenant-configurable policy**.

Whether a particular Option Value has no visual, a color, or an image is catalog data owned by that Product Option Value. It is not a business-policy switch.

## 18. Implementation sequence

Recommended bounded sequence:

### VAR-OPTION-VISUAL-1 — Domain/API authority

Evidence pass first, then smallest additive persistence/API extension for Option Value visual metadata, including validation, Tenant Isolation and backward compatibility tests.

### VAR-OPTION-VISUAL-2 — Product Workspace authoring

Add visual type selection, color picker, image/sample authoring where backend authority exists, mobile/RTL/LTR UX, and preserve existing Variant generation workflow.

### VAR-OPTION-VISUAL-3 — Commerce/POS consumption

Render canonical swatches in Storefront/POS and resolve user selections through existing Option Value -> ProductVariant identity. Do not duplicate authority in clients.

Media switching should follow the approved Product gallery -> Option Value media -> exact Variant override precedence where each layer is actually implemented.

## 19. Required tests

At minimum implementation must prove:

1. Existing text-only Option Values remain valid.
2. Valid color metadata persists and round-trips through API.
3. Invalid color values are rejected.
4. Image visual metadata cannot cross tenant boundaries.
5. Editing a swatch does not regenerate/change ProductVariant identity.
6. Variant combination generation remains unchanged.
7. Inventory identity is unchanged.
8. Pricing authority/precedence is unchanged.
9. Barcode resolution is unchanged.
10. Commerce publication authority is unchanged.
11. Storefront/POS resolve selections by Option Value/Variant IDs, never by hex/image.
12. Accessible human label remains available with every swatch.
13. RTL/LTR and mobile authoring/rendering are covered where practical.

## 20. Acceptance statement

AWJ considers Visual Option Values correctly implemented only when a merchant can define a value such as:

`أزرق سماوي + #AFC9F5`

or a visual material sample, and that single canonical definition can be consumed consistently by ERP, POS, Storefront and future mobile commerce while the concrete ProductVariant remains the sole inventory/sellable identity and all existing accounting, pricing, barcode, publication, security and Tenant Isolation invariants remain intact.
