# CUST-HV V9b — Benefits: item icons and layout — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V9b** — second V9 slice (V9a category cover ✔ → **V9b benefits icons + layout** → V9c content blocks → V9d cards/rails → V9e product zoom). |
| **Branch** | `cust-hv/v9b-benefits` (stacked on V9a until #1313 merges) |
| **Authority** | V0 §3.4 (`benefits` layout: `flat · cards · columns-2/3/4`) · §11.4 (curated icon registry, D-22) · §2.2 (additive, three normalizers in lock-step) |
| **Scope** | Optional `icon` on each benefit item and the section's `design.layout`. No endpoint, schema, migration or Publish-rule change; `PRESENTATION_CONFIG_VERSION` stays 3; no accounting effect. |

## AWJ Decisions recorded here

| Question | Decision | Why |
|---|---|---|
| Layout vocabulary | Stored in `design.layout`, closed list `flat · columns-2 · columns-3 · columns-4`. **`cards` is the ABSENCE** (cards in automatic columns — today's look) and is never stored. | Same canonical-form rule as hero/banner/gallery; an existing store keeps its exact look and two documents meaning the same thing are literally equal. |
| Column counts | Phones are always **1** column, tablets **2**; only the wide-screen count is the merchant's (`columns-2/3/4`; automatic and `flat` = 3). | A fixed 4-up on a phone is never useful; the merchant controls what is a real choice. |
| `flat` | Drops the card frame and padding; keeps icon, text and the automatic grid. | V0's `flat`. |
| Icon | `item.icon?: IconKey` from the shared registry (24 keys, V7d). Unknown / wrong-case / non-string → dropped (item kept). Decorative (`aria-hidden`); drawn in a 40 px outlined tile on the inline-start edge, in the section's foreground colour. | Registry is the single source; the tile uses border/foreground tokens that designed sections already remap, so no new contrast case. |
| Editor | Icon is a per-item select (same control as navigation); the layout is the Design tab's existing select (Automatic / Flat / Cards in 2·3·4 columns) with a benefits-specific hint, and the content tab says where the layout lives. | One place per setting (V0 §3.4). |
| Canvas columns | The shared storefront classes respond to the HOST window; the Canvas takes its count from `data-vp` (a Canvas-only block placed before the V5c parity marker). | Canvas shows what will be published for the simulated device. |

## What was built

- PHP: `StorefrontPresentationNormalizer` (item icon), `StorefrontSectionDesignNormalizer` (`LAYOUTS['benefits']`, `layout` capability).
- TS twins: `section-content.ts` ×2 (`BenefitItem.icon`, `normalizeBenefits`), `section-design.ts` ×2 (byte-identical; `LAYOUTS.benefits`, `BenefitsLayout`, capability).
- Storefront: `BenefitsBand` (icons, `layout`, `BENEFITS_GRID`), `published-nodes` passes `design.layout`.
- Merchant app: Canvas benefits branch (icons, flat, `data-benefits` / `data-vp`), `store-preview.css` Canvas-only column rules, `BenefitsFields` icon select, `DesignInspector` labels + hint, AR/EN strings.
- Fixture `section-design.json`: capability row + 8 cases.

## Backward compatibility

A benefits section without `icon` or `layout` renders the same cards in the same automatic columns (the item markup gained a flex wrapper; no visual change). `layout: "split"` and other types' variants are still dropped on benefits. Stored documents are never rewritten.

## Tests

- PHP: `benefits_item_icon_is_a_registry_key_or_absent`; shared design fixture (capabilities + 8 cases) green in `StorefrontSectionDesignTest`.
- Storefront: `benefits-content.test.ts` (5: every key, drops, idempotence, closed layout list), `BenefitsBand.v9b.test.tsx` (7: icon placement/decorative, fail-closed unknown key, auto/columns-N/flat classes, phones never fixed). Whole storefront suite 2214 passed; `tsc`, `biome` clean.
- Web: `benefits-content.test.ts` (5, twin), `BenefitsFields.test.tsx` (3), Canvas parity (2), `DesignInspector` benefits layout (1); whole web suite 4725 passed.

## Design Quality Pass

`e2e/cust-hv-v9b-benefits.spec.ts` — the real builder (demo mode), AR RTL × EN LTR × 390 / 768 / 1024 / 1280 / 1440 (10/10): Library → three benefits with a 54-character unbroken word → icon on two of them (none on the third) → walk Automatic / 2 / 3 / 4 columns / Flat in the Design tab: the **computed grid column count equals the storefront's number for the simulated device** (phone 1, tablet 2, desktop the layout's count), cards framed iff not Flat, an unbroken word wraps inside its item, no added horizontal overflow, and the icon sits on the inline-start edge in both directions.

## Limitations (stated)

- Real-storefront Chromium proof was not repeated: the storefront uses the same literal Tailwind classes already used elsewhere (`sm:grid-cols-2`, `lg:grid-cols-3/4`), asserted by unit tests; the Canvas proof covers the shared markup.
- No per-item colour or icon upload (registry only, by contract).

## Invariants

Tenant isolation, authN/authZ, Draft vs Published, concurrency, media ownership: untouched (no media, no endpoint). No arbitrary CSS/JS/HTML: closed lists only. Commerce firewall: nothing here touches price, offer, stock or tax. No journal entry, no accounting behaviour.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
