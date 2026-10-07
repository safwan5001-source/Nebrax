# CUST-HV V5e-2b — Global buttons and button text, with a label-contrast proof — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V5e-2b** — second part of V5e-2 (V5e-2a global tokens ✓ → **V5e-2b buttons + button text** → V5e-2c self-hosted font catalogue) |
| **Branch** | `cust-hv/v5e2b-buttons` (stacked on V5e-2a) |
| **Authority** | V0 §6.1 (button tokens; "label contrast follows §4.5"), §5.1 (`buttonText`), §4.5 (contrast contract), §2.2 (additive, three normalizers in lock-step) |
| **Depends on** | V5e-2a (`data-gt` / `--gt-*` mechanism, `GlobalTokensEditor`) · V5a (contrast engine) · V5d (publish gate pattern) |

---

## Implemented

### Contract (PHP authority + web twin + storefront twin, same shared fixture)
Additive and optional; absent ⇒ byte-identical; version stays 3.

| Key | Fields (named steps only) |
|---|---|
| `buttons` | `style` solid·soft·outline·link · `size` sm·md·lg · `radius` none·sm·md·lg·pill · `colour` brand·accent·text (palette **roles**, never a hex) · `hover` darken·lift·underline·none |
| `typography.buttonText` | `weight` 500·700·800 · `case` normal·upper (Latin only — Arabic has no case) |

Fixture `global-tokens.json` grows to 25 cases (every field, canonical order, invalid values dropped on their own, a hex/CSS colour rejected, `icon` and per-state overrides not accepted yet). Font families remain dropped (V5e-2c).

### Rendering — what "a button" is
No markup changed: the tokens reach buttons **by their existing class tokens**, so an undesigned storefront is byte-identical. A *primary button* is the store's solid CTA (`bg-store-primary` + `rounded-store` + `font-bold` — banner, product card, quick view) or the shared `Button` in its default variant; size / radius / text also reach its outline and secondary variants. **Never reached:** icon-only buttons, ghost / link / destructive variants, and the hero CTA (it is inverted on the brand gradient — V6 owns hero buttons). A contract test pins the selector to the real component class strings, so a component that drops a class fails the test instead of silently escaping the tokens.

| Token | Effect |
|---|---|
| `style` + `colour` | solid: fill = role colour; soft: tinted fill; outline: transparent + 2 px role-colour border; link: underlined label. Today's solid · brand · darken emits **nothing** (the darken amount equals today's `--store-primary-hover`) |
| `hover` | darken / lift (1 px, static under reduced motion) / underline / none; disabled buttons never take a hover |
| `size` | sm / lg step padding and type (md = today) |
| `radius` | none … pill (9999 px) |
| `buttonText` | weight, Latin uppercase |

### Label contrast — proved, not assumed
- **solid / soft** compute their label over their own fill — the proven white/black, or the role colour itself when it clears 4.5:1 over the tint — so they pass **by construction**, for any colour. Every hover label is re-proven over its hover fill.
- **outline / link** label with the role colour over what is behind the button, which the renderer cannot know — so they are **gated at publish**: `ButtonTokensContrast` (PHP authority) and `buttonContrastIssues` (TS twin, driven by the same fixture `button-contrast.json`) judge the colour against the page backdrops `#f8f9fa`, `#ffffff` and a custom `palette.surface`. Failure ⇒ `422 publish_validation_failed` on the path `buttons.colour`, `contrast_insufficient` — through immediate publish, scheduled publish and the legacy head, like the section gate. The boundary is real: `#757575` clears 4.5 on white but **4.37 on the page background**, and the fixture pins it.
- Inside a section with a designed background, outline / link buttons follow the section's own proven foreground (`--sec-link`), not the page-judged colour.

### Merchant UI
ThemePanel → *Global design* → **Buttons**: style, colour, size, corners, hover, button-text weight and case — selects of named steps with an "as today" choice. A live warning (`role="alert"`) appears the moment an outline / link colour cannot be proven, before the merchant hits a publish error. AR/EN.

---

## Proof

| Gate | Result |
|---|---|
| PHP | `StorefrontGlobalTokensTest` (25-case fixture) · `ButtonTokensContrastTest` (12-case fixture + exact error path) · `ButtonTokensPublishGateTest` (API: 422 on `buttons.colour`, draft kept; a solid pale-brand button publishes and the snapshot carries the tokens) |
| Twins | fixture ×2 incl. contrast fixture (`ratio` agrees with PHP) · resolver tests (defaults emit nothing, solid/soft/outline/link, hover re-proof, no CSS from the document) · token ↔ stylesheet coverage test (every emitted token and `--gt-*` variable has a rule in **both** stylesheets) · selector ↔ real components test |
| Real browser — **compiled storefront CSS** (`cust-hv-v5e2b-buttons.spec.ts`, 7) | absent tokens ⇒ identical computed styles · only solid CTAs + default `Button` follow the colours (hero CTA, outline variant, icon, ghost untouched) · hover replaces the component hover but never on a disabled button · sizes never reach icon-only buttons · radius / weight / uppercase · outline border + the designed-section override · link underline · lift static under reduced motion. **Mutation-checked:** with the CSS block removed, 6 of 7 fail (the seventh asserts absence) |
| Real browser — **Canvas** (`cust-hv-v5e2a-canvas-proof.spec.ts`, 13: AR/EN × 390–1440) | the banner CTA is a soft large uppercase pill with a readable label (≥ 4.5:1 computed from the painted colours), no overflow |
| UI | `GlobalTokensEditor` 9 tests (button fields, nested `buttonText`, emptying removes the group, live warning only when unprovable, AR/EN) |

## Design Quality Pass
Evidence `docs/plans/store/cust-hv-v5e2b/` (Canvas, soft · large · pill · uppercase · lift on top of the V5e-2a surface tokens, EN 768 and AR 390). Checked: the CTA keeps its position and the card's content flow at both widths; the uppercase label never affects Arabic text; soft tint + dark label reads clearly; no overflow. Not re-proved visually here: published-storefront pages other than the compiled-CSS spec's representative markup (checkout / account use the shared `Button`, covered by the default-variant selector and its contract test).

## Invariants
| Invariant | Status |
|---|---|
| Tenant isolation / RBAC / Draft-Published / revision concurrency | Untouched — validated additive keys in the existing document; PHP accepts them before any UI writes them |
| Backward compatibility | Absent keys ⇒ no attribute, no variable, no rule applies; no component markup changed; version stays 3 |
| Accessibility | Label contrast proven by construction or gated at publish; hover states never reduce contrast (re-proved); focus rings untouched; reduced motion ⇒ no lift |
| Commerce / accounting | Untouched |

## Limitations / next
- A **per-CTA override** (`style` / `colour` on one button) belongs to the slices that own those CTAs — hero & banner (V6), slider (V8), header actions (V7). Global buttons are the default they will override.
- An **icon on the button** needs the icon registry (V7 / D-22); not accepted yet.
- Product-card / quick-view layouts keep their own structure; `size` only steps padding and type.
- V5e-2c (font catalogue) is next.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
