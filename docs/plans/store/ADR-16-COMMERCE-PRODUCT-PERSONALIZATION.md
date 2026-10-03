# ADR-16 — Commerce Product Personalization (FLOWERS-PERSONALIZATION-1)

**Status:** Accepted for implementation within `AWJ_FLOWERS_HORIZON_1_AUTONOMOUS_EXECUTION.md` slice H4 (phased: H4a definitions, H4b cart/checkout/order persistence, H4c customer image upload)
**Date:** 2026-10-03
**Scope:** shared Commerce — not Flowers-only

---

## 1. Context

**AWJ REPOSITORY EVIDENCE**

- `ProductVariant`/`ProductOption` model **sellable SKU identity** (size, flavour). Engraving text, cake message, uploaded photo are *customer inputs*, not SKU identity (`FLOWERS_EVIDENCE_1_AWJ_REUSE_GAP_AUDIT.md` §5.2, §15).
- `CommerceCartItem` has a closed shape; line identity is enforced by two **partial unique indexes** (`simple`: cart+product+unit, `variant`: cart+product+variant+unit). Two bouquets with different card texts therefore cannot coexist as separate lines today.
- Cart merge (guest → customer) re-adds each guest line through `CommerceCartService::add()`.
- `CommerceOrderLine` is an immutable snapshot; `CommerceOrderSnapshot`-style freezing is the established pattern.
- `ProductMedia` is merchant-owned catalog media; it must not be reused for customer uploads (audit §15).

**EXTERNAL EVIDENCE** — Shopify models free-text customisation as per-line *line item properties* distinct from variants; the FNP evidence shows text and image personalisation as product-level inputs with fulfilment-visible values (`FNP_DEEP_EVIDENCE_1_REPORT.md`).

**INFERENCE** — Making the validated input part of **line identity** is the only way to keep one-line-per-distinct-customisation without a JSON dumping ground on the cart item.

## 2. Decision (AWJ DECISION)

### 2.1 Definitions (H4a)

- `commerce_product_personalization_fields`: per product, `key` (slug, unique per product), `type` ∈ {`text`, `textarea`, `select`} (`image` reserved for H4c), bilingual `label`, optional `help_text`, `is_required`, `max_length` (text/textarea, bounded 1–500), `sort_order`, `is_active`.
- `commerce_product_personalization_options`: select choices (`value_key` slug unique per field, bilingual label, `sort_order`, `is_active`).
- Bounded: ≤ 8 fields per product, ≤ 30 options per select field. Definitions are replaced as a whole set by key in one transaction (`PUT products/{id}/personalization`), RBAC `products.view` / `products.manage` (as publication/facets).
- Public product **detail** (`store/v1` and `commerce/v1`) exposes active fields under `personalization` **only when the product has any** — products without fields are byte-identical to today.

### 2.2 Persistence (H4b)

- `commerce_cart_items.personalization_signature` (`NOT NULL DEFAULT ''`): SHA-256 of the normalized, key-sorted input. Both partial unique indexes are rebuilt to include it, so the same product + same input merges quantity while different input is a separate line.
- `commerce_cart_item_personalizations`: `field_key`, type, label snapshot, `value_text` (selects store the `value_key`; the label is snapshotted too). **No FK to the definition** — a later definition change never breaks a cart/order.
- `add()` accepts a validated `personalization` map; guest→customer merge re-adds it; checkout revalidation re-runs validation against the **current** definitions (`personalization_invalid` → review-required, no order).
- Order: `commerce_order_line_personalizations` immutable snapshot copied inside the completion transaction (frozen after confirmation, like other snapshots). Shown to the order owner and in fulfilment order reads.

### 2.3 Server authority & hygiene

- Unknown keys, wrong types, over-length, inactive/unknown select values and missing required fields are refused server-side. Text uses the shared plain-text normalizer (control and bidi-override characters stripped, length by characters). Values are plain text, never HTML.
- **No price impact in V1.** Any price modifier changes financial totals/tax and needs its own contract; the line price stays `CommercePriceResolver`'s result.

### 2.4 Images (H4c — separate contract)

Customer uploads get their own tenant-safe object with ownership, MIME *content* sniffing, size/count limits and retention — never a `ProductMedia` row. No composite preview is claimed.

## 3. Rejected / Not adopted

- Personalization as variants/options (SKU explosion, wrong semantics).
- A JSON/metadata blob on the cart item or order line.
- A foreign key from cart/order values to the live definition (would break history on edit).
- Price modifiers in V1; image preview/composition.

## 4. Consequences

- Generic products and carts: signature `''`, no rows, identical behaviour.
- The cart-identity index change is additive in meaning (existing rows have signature `''`), but touches the cart core; mitigated by running the full cart/merge/checkout suites on SQLite and PostgreSQL.
- No ledger/VAT/ZATCA/inventory effect.
