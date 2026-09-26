# Grok Bootstrap — Store Customizer Visual Verification / Polish Pass

Repository: `safwan5001-source/Nebrax`

Start with:

`git fetch origin`

Verify exact latest `origin/main`. Known base when this pass was documented:

`298908cb3d5c8809f6bce34e1abacc6c2f1a0695`

Read:

1. `docs/plans/store/AWJ_STORE_CUSTOMIZER_CAPABILITY_COMPLETION_CLOSURE_REPORT.md`
2. `docs/plans/store/AWJ_STORE_CUSTOMIZER_VISUAL_VERIFICATION_PASS.md`
3. only the implementation files/tests needed for the already-completed sections

Do **not** repeat the capability horizon.

## Mission

Perform the missing browser-level verification for the completed Store Customizer capabilities.

Viewports:

`390, 430, 768, 1024, 1280, 1440`

Locales:

- Arabic RTL
- English LTR

Surfaces:

- merchant Preview
- Published storefront

States:

- populated
- empty
- long content
- missing optional media
- failed/missing product reference where applicable

## Output

Create:

`docs/plans/store/AWJ_STORE_CUSTOMIZER_VISUAL_VERIFICATION_REPORT.md`

The report must contain an evidence matrix and classify findings by severity.

## Fix authority

If you find a real P1/P2 inside this pass, make the smallest focused fix and follow the standard Horizon gates through merge.

Do not ask for “continue” between routine verification/fix steps.

Do not implement offers, Market, Floral, Undo/Redo, Version History, or unrelated redesign.

No Deploy / Production Release / Production Migration.

At completion, stop and report the final main SHA plus any PR/head/merge SHAs.
