# CUST-H3-2 — Color + Typography Truth — Evidence & Decision

**Status:** Decision ready for owner review · no implementation authorization  
**Baseline:** `2981743de0bea007ca1f3941bc0f2cbf9840b23d`

## 1. Scope

CUST-H3-2 closes two presentation-truth gaps identified by CUST-H3-ARCH-1:

1. color controls must correspond to real semantic public runtime behavior;
2. typography must become a real curated merchant choice rather than a disabled one-value selector.

This slice does not change density or product-card behavior; those remain CUST-H3-3.

## 2. Current AWJ evidence

### Color

The current presentation contract persists:

- `primaryColor`
- `accentColor`

The public semantic renderer `presentationCssVars()` currently consumes **primary color only** (plus radius) and derives:

- `--store-primary`
- hover variants
- soft variants
- readable foreground
- ring / primary aliases

`accentColor` is normalized and persisted but no public semantic consumer was found.

### Typography

The closed font enum currently contains one value only:

`cairo-geist`

The merchant selector is therefore disabled.

Public storefront typography is currently loaded in `DocumentShell.tsx` with:

- Cairo for Arabic;
- Geist for Latin.

Both are loaded through `next/font/google`.

The Customizer Canvas currently hard-codes the same Cairo/Geist stack rather than resolving a merchant font preset.

## 3. External evidence

### Shopify

Shopify documents colors and typography as global Theme Settings that apply across the online store. Its color model emphasizes named reusable palettes/schemes instead of unrelated per-template color choices.

AWJ adaptation:

- color remains global Version state;
- page navigation does not create separate Product/Category brand colors;
- only colors with a defined semantic role are merchant-facing.

### Next.js

Current Next.js documentation states that `next/font` automatically optimizes and self-hosts Google or local fonts, avoiding browser requests to Google and reducing layout-shift risk.

AWJ adaptation:

- curated fonts should use the existing `next/font` loading seam;
- do not inject arbitrary external font URLs;
- runtime and Canvas must resolve the same preset deterministically.

### Curated Arabic candidate

Tajawal is an open-source Arabic/Latin family with seven weights and is documented for web use.

AWJ V1 candidate:

- `tajawal-geist`
- Arabic: Tajawal
- Latin: Geist

This is a **candidate pending implementation-time build/import verification**, not an unconditional dependency commitment.

IBM Plex Sans Arabic was also reviewed and is a valid future candidate, but adding multiple new families at once is intentionally deferred to keep H3-2 small and measurable.

## 4. AWJ decision — color

### Primary color — LIVE

`primaryColor` remains the merchant's single brand-color control in H3-2.

Requirements:

- color picker + hex input;
- invalid values fail closed;
- readable foreground is derived automatically;
- hover/soft variants stay derived by AWJ;
- Canvas and Published public storefront must match;
- no page-specific copy of this value.

### Accent color — GATED / hidden

`accentColor` remains accepted by normalizers and persisted for backward compatibility.

H3-2 does **not** expose it as an active merchant control because no named semantic public role exists today.

Do not map it opportunistically to:

- arbitrary links;
- arbitrary backgrounds;
- sale/discount status;
- success/warning/destructive states;
- commerce truth.

A later architecture decision may activate it only after a specific semantic role is justified.

No destructive migration or field removal is needed.

## 5. AWJ decision — typography

### Merchant model

H3-2 exposes one merchant-facing control:

**الخط / Typography**

The current schema has one `fontPreset` field, so H3-2 does not pretend that Heading Font and Body Font are independently configurable.

Each preset is an internal bundle that defines the Arabic/Latin stack.

### V1 presets

1. `cairo-geist` — existing default; backward compatible.
2. `tajawal-geist` — candidate curated alternative, activated only if implementation-time verification proves:
   - supported import/loading path;
   - Arabic and Latin rendering;
   - required weights;
   - build success;
   - SSR/hydration stability;
   - acceptable bundle/runtime impact.

If any verification fails, H3-2 must keep the second preset gated and report the evidence rather than shipping a fake choice.

## 6. Runtime contract

Introduce one shared deterministic font-preset resolver conceptually equivalent to:

```
fontPreset -> semantic body/font family stack
```

The exact implementation location may differ between web Canvas and storefront runtime, but the mapping must remain identical.

Requirements:

- no extra network request per page;
- same Draft preset drives Canvas;
- only Published Snapshot drives public storefront;
- unknown preset fails closed to `cairo-geist`;
- existing Versions remain visually unchanged;
- no arbitrary CSS or custom font URL.

## 7. Canvas parity

The current Canvas hard-codes Cairo/Geist.

H3-2 must change it to resolve `config.fontPreset`.

Acceptance requires:

- selecting a font changes Canvas immediately;
- Save/reload preserves it;
- Published storefront uses the same family;
- Home/Product/Category preserve the same global font;
- RTL/LTR both verified.

## 8. Accessibility and readability

Color:

- maintain readable foreground derivation;
- do not encode state by brand color alone;
- focus treatment remains visible.

Typography:

- headings/body remain readable at current sizes;
- no font choice may remove required Arabic glyph coverage;
- fallback stack remains explicit;
- font selection cannot cause content clipping or control overflow at mobile widths.

## 9. Backward compatibility

Existing documents with:

`fontPreset: "cairo-geist"`

continue to normalize and render identically.

Existing persisted `accentColor` remains round-trippable even though the merchant control stays hidden.

No DB backfill.

## 10. Explicit non-goals

H3-2 does not authorize:

- custom font upload;
- arbitrary external font URL;
- separate heading/body persisted fields;
- font-size controls;
- custom CSS;
- page-specific colors/fonts;
- density work;
- product-card work;
- DB migration;
- new API endpoint.

## 11. Implementation acceptance

H3-2 implementation is ready only when:

- primary color remains real Canvas/Public parity;
- accent is not presented as LIVE;
- font selector has at least two choices only if the second is proven real;
- preset selection affects Canvas and Published runtime;
- unknown/stale font values fail closed;
- PHP/web/storefront normalizers remain consistent;
- existing `cairo-geist` Versions are unchanged;
- RTL/LTR + mobile + build/tests pass.
