# AWJ Store Customizer — Visual Verification / Polish Pass

**Status:** Proposed  
**Base main SHA:** `298908cb3d5c8809f6bce34e1abacc6c2f1a0695`  
**Purpose:** Close the only material verification gap left by the Store Customizer Capability Completion Horizon.

## Scope

This is **not** a new feature horizon.

It is a narrow verification/polish pass for the capabilities already merged in PR #1029 and closed in #1031:

- banner
- benefits
- structured custom content
- featured products
- app promo
- fixed-chrome click-to-edit semantics

Offers remain outside implementation scope and stay `PRODUCT_DECISION_REQUIRED`.

## Goals

Verify the real merchant and published experience at:

`390 / 430 / 768 / 1024 / 1280 / 1440`

Across:

- Arabic RTL
- English LTR
- Store Customizer Preview
- Published storefront

And for materially relevant states:

- normal populated content
- empty content
- long content
- missing optional media
- safe fallback / failed product reference where applicable

## Required evidence

For each tested viewport/locale pair, record:

- surface tested
- route / harness used
- section types present
- whether preview matched published output
- overflow / clipping / wrapping issues
- interaction issues
- RTL/LTR issues
- screenshot or browser-captured evidence where possible

Do not mark a cell PASS based only on code inspection.

## Harness drift

The closure report noted that the storefront `/dev` customizer harness still shows dashed placeholders for section types now implemented in the web builder.

Inspect this only to determine one of:

1. the harness is part of the supported verification path and must be updated; or
2. the harness is obsolete/non-authoritative and should be documented as such.

Do not refactor the builder or create a second authoring surface.

## Fix policy

If verification finds:

- **P1/P2 functional, accessibility, layout, RTL/LTR, Preview↔Published parity, or misleading merchant-state defects**: make the smallest focused fix, add tests, open a PR, review exact head, pass CI, merge, and verify post-merge.
- **P3 polish only**: document unless the fix is trivial and clearly in scope.
- **No issue**: no runtime PR is required.

No broad redesign. No theme expansion. No Market/Floral work. No offers implementation.

## Safety invariants

Preserve:

- Tenant Isolation
- `commerce.manage`
- Draft/Public separation
- server-owned price/discount/tax/stock/availability
- backward compatibility
- no executable merchant HTML/CSS/JS
- existing fail-closed behavior
- no Production Deploy / Release / Migration

## Definition of Done

This pass closes when:

1. Browser-level visual verification is captured for the named viewports or every unavailable cell has a concrete reason.
2. Arabic RTL and English LTR are verified.
3. Preview ↔ Published parity is checked for the completed capabilities.
4. Empty/long/missing-media states are exercised where relevant.
5. Any P1/P2 found is fixed and merged through normal Horizon review gates.
6. Harness drift is resolved by either a small sync or a documented non-authoritative status.
7. A final verification report is committed.

Final report:

`docs/plans/store/AWJ_STORE_CUSTOMIZER_VISUAL_VERIFICATION_REPORT.md`

## End condition

After the verification report is complete, stop.

Do not start another horizon and do not deploy.
