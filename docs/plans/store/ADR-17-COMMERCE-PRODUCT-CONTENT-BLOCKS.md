# ADR-17 — Commerce Structured Product Content Blocks (FLOWERS-CONTENT-1)

**Status:** Accepted for implementation within `AWJ_FLOWERS_HORIZON_1_AUTONOMOUS_EXECUTION.md` slice H5
**Date:** 2026-10-03
**Scope:** shared Commerce catalog content — not Flowers-only

## 1. Context

**AWJ REPOSITORY EVIDENCE** — `Product` has a generic `description` and a few descriptive columns, but no typed content-block model for composition, care, allergens, storage or safety text (`FLOWERS_EVIDENCE_1_AWJ_REUSE_GAP_AUDIT.md` §16). The audit prescribes a reusable shared Catalog capability rather than one column per flower/cake concern.

**EXTERNAL EVIDENCE** — FNP product pages separate care/composition/allergen text from the description; Shopify/Saleor keep typed attributes distinct from rich descriptions.

## 2. Decision (AWJ DECISION)

- **Narrative/safety text** → *content blocks*. **Filterable descriptive dimensions** (flower type, colour, flavour, serving size, packaging) → **facets** (ADR-14). Not duplicated: a merchant who wants to filter by flavour creates a `flavor` facet; the free-text flavour story lives in the description.
- `commerce_product_content_blocks`: one block per `block_type` per product (`unique(product_id, block_type)`), bilingual plain-text `body`/`body_en` (≤ 2000 chars), `is_active`, `sort_order` (by block position).
- `block_type` is a **finite platform-owned enum**: `composition`, `care`, `natural_variation`, `included_items`, `dimensions`, `materials`, `allergens`, `storage`, `preparation_notes`, `personalization_instructions`. Adding a type is a code change, never merchant-defined free keys (no unbounded schema).
- Admin API `GET/PUT products/{id}/content` (atomic whole-set replace; `products.view` / `products.manage`).
- Public product **detail** (store/v1, commerce/v1) exposes active blocks under `content_blocks` **only when any exist**; products without blocks are byte-identical to today.
- Plain text only (shared `PlainText` normalizer; multi-line allowed, ≤ 40 lines). Never HTML — consumers escape at render.
- Content is **merchant-authored information, not a compliance claim**: AWJ does not validate allergen/legal correctness and the UI labels the allergen block as merchant-provided.

## 3. Rejected

One column per concern on `Product`; a free-form key/value store; HTML/rich text in V1; merchant-defined block types.

## 4. Consequences

Additive tables only; no price/inventory/ledger effect; generic products unchanged.
