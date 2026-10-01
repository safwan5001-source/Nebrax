# CUST-H3-ARCH-1 — Store Identity Contract

**Status:** Proposed architecture · no implementation authorization  
**Baseline:** `956d9865cd12622cb9fd5190fed5284b8f053e70`

## 1. Architectural decision

CUST-H3 is an **evolution of the existing `StorefrontPresentationConfig` global fields**, not a new identity persistence model.

No schema-version bump is required merely to reorganize the merchant UX or wire already-persisted fields into the renderer.

Any future addition of a genuinely new persisted field must be proposed separately and follow the PHP + web + storefront twin-normalizer parity rule.

## 2. Authority

Canonical persistence remains the CUST-H1 Version document.

```
Active Version Draft
  ├─ global identity/theme fields
  ├─ Home presentation
  └─ pagePresentation.{product,category}
        ↓
Save / Duplicate / Publish / Schedule
        ↓
Published Snapshot
        ↓
Public Storefront
```

H3 never writes directly to Published state.

## 3. Identity capability registry

| Capability | Contract | State for H3 start |
|---|---|---|
| displayName | `branding.displayName` | LIVE |
| logo | `branding.logoDataUrl` | LIVE |
| compactLogo | `branding.compactLogoDataUrl` | LIVE |
| favicon | `branding.faviconDataUrl` | LIVE |
| primaryColor | `primaryColor` | LIVE |
| accentColor | `accentColor` | GAP: persisted/no public consumer |
| font | `fontPreset` | GAP: only one preset |
| radius | `radius` | LIVE |
| density | `density` | GAP: parity not closed |
| productCard | `productCard` | GAP: parity not closed |
| headerStyle | `header.style` | LIVE |
| customFontUpload | none | GATED |

## 4. Semantic renderer contract

Public components consume semantic values, not merchant storage keys directly.

H3 may extend `presentationCssVars()` or introduce narrowly-scoped presentation helpers, but must not create a second theme authority.

Required properties:

- deterministic;
- SSR-safe;
- no client-only recomputation that changes first paint;
- unknown values fail closed to existing defaults;
- no extra runtime network request for identity;
- same Published Snapshot already used by public chrome/pages.

## 5. Accent color gate

`accentColor` remains backward-compatible in storage.

Before exposing it as LIVE, H3 must define exactly what it means, for example a controlled secondary emphasis role. It must **not** become an unrestricted replacement for arbitrary text/background colors.

If no useful semantic role is justified in H3, the merchant control should be hidden/gated while the stored field remains accepted.

## 6. Typography contract

H3 V1 may expand the closed `FONT_PRESETS` enum only with vetted curated font families.

Each preset must define:

- body family;
- heading family if distinct;
- supported weights;
- Arabic/Latin fallback stack;
- loading mechanism;
- runtime CSS mapping.

If the existing schema cannot express body vs heading independently, H3 must choose either:

1. keep one merchant-facing “الخط” preset that defines both internally; or
2. propose an additive schema change in a separate architecture decision.

Do not pretend two independent controls exist before the contract supports them.

## 7. Density / product-card contract

These are already stored and merchant-facing today, but H3 treats them as incomplete until the public runtime consumes them.

Implementation must map them to real, bounded classes/tokens:

- density changes approved spacing/density surfaces only;
- productCard selects a closed card presentation variant;
- no DOM/data fork that changes commerce truth;
- no per-page duplicate setting.

## 8. Branding media

Reuse the locked branding-media contract.

No new upload endpoint or media table is part of H3-ARCH-1.

Controls must provide:

- clear replace/remove action;
- preview;
- validation/failure feedback;
- fallback to display name when no logo;
- alt/accessibility behavior where applicable.

## 9. Backward compatibility

Existing Versions:

- continue to normalize;
- retain current stored values;
- receive existing defaults for missing fields;
- do not require DB backfill;
- must render identically unless the merchant intentionally changes identity.

No field is deleted in H3 V1.

## 10. Security / tenant isolation

No authority change is proposed.

Workspace mutations continue behind existing authenticated tenant-scoped presentation endpoints and `commerce.manage`.

Public identity comes only from the host-resolved Published Snapshot. No Storefront id supplied by the public client becomes authority.

## 11. Proposed implementation slices

### CUST-H3-1 — Identity Studio shell + consolidation

- merchant-language global Identity entry/surface;
- group existing display name/logo/compact logo/favicon;
- preserve existing persistence;
- responsive + RTL/LTR;
- no schema change.

### CUST-H3-2 — Color + typography truth

- primary color UX;
- decide/close accent semantic gate;
- vetted curated font preset decision and implementation if evidence passes;
- public + Canvas parity;
- accessibility contrast checks.

### CUST-H3-3 — Global component appearance parity

- close `density` public runtime mapping;
- close `productCard` public runtime mapping;
- radius/header/global appearance consolidation;
- no commerce-data behavior change.

### CUST-H3-4 — Cross-page/global parity + integrated QA

- Home/Product/Category identity parity;
- favicon/header/footer/public chrome;
- mobile/desktop;
- RTL/LTR;
- accessibility;
- Draft/Published lifecycle regression;
- backward compatibility.

### CUST-H3 Horizon Closure

Formal closure report after all slices are reviewed and merged.

## 12. Gates

Implementation must stop and open a new architecture decision if it discovers a need for:

- DB migration;
- new public/workspace endpoint;
- uploaded font storage;
- arbitrary CSS;
- schema change beyond an explicitly reviewed additive field;
- a page-specific identity authority.

## 13. Owner merge/deploy gates

Each slice remains independently reviewable.

No Merge, Deploy or Production release is authorized by this architecture document.
