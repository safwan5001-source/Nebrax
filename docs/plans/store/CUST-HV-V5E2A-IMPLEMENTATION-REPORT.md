# CUST-HV V5e-2a — Global design tokens: typography, surfaces, content width, motion — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V5e-2a** — first part of V5e-2 (V5e-2a global tokens → V5e-2b buttons + button text → V5e-2c self-hosted font catalogue) |
| **Branch** | `cust-hv/v5e2a-global-tokens` (stacked on V5e-1) |
| **Authority** | V0 §5.1/§5.2 (typography tokens, named steps), §6.2 (surfaces), §6.3 (content width), §6.6 (motion), §2.2 (additive + three normalizers in lock-step) |
| **Depends on** | V5e-1 (section typography / heading styles) · V5d (design tab, palette editor) |

**Why a split.** `buttons` need a label-contrast proof and a publish gate (V0 §6.1 / §4.5), and font families need a self-hosted, subsetted, OFL-licensed catalogue (V0 §5.2 / N-5). Neither is needed to ship the four tokens below, and each deserves its own evidence — so they are V5e-2b / V5e-2c rather than a single oversized PR.

---

## Implemented

### Contract (PHP authority + web twin + storefront twin, one shared fixture)
Four optional, additive document keys. **Absent ⇒ the storefront renders byte-identically** (V0 §2.2); `PRESENTATION_CONFIG_VERSION` stays 3; an invalid value is dropped on its own, an empty group is omitted, key order is canonical.

| Key | Fields (named steps only) |
|---|---|
| `typography` | `headingScale` sm·md·lg · `bodyScale` sm·md·lg · `headingWeight` 400·500·700·800 · `bodyWeight` 400·500·700 · `lineHeight` tight·normal·relaxed · `sectionHeading` bar·plain·centered·underline |
| `surfaces` | `radius` none·sm·md·lg·pill · `border.width` none·hairline·medium · `shadow` none·soft·medium·strong |
| `layout` | `contentWidth` narrow (64rem) · standard (today's 85rem) · wide (100rem) |
| `motion` | `duration` instant 0 · fast 150 · base 300 · slow 500 ms · `easing` standard · emphasized |

Files: `app/Support/Commerce/StorefrontGlobalTokensNormalizer.php` (wired into `StorefrontPresentationNormalizer`), `global-tokens.ts` ×2 (byte-identical, test-enforced), `tests/Fixtures/presentation/global-tokens.json` (17 cases), `StorefrontGlobalTokensTest`, `global-tokens.test.ts` ×2.

**Deliberately not accepted yet** (dropped fail-closed, asserted by the fixture): `headingFamily`/`bodyFamily` (V5e-2c), `buttons`/`buttonText` (V5e-2b), a surface border *colour*.

### Resolver — one pure function
`resolveGlobalTokens(doc)` → `{ attrs: { "data-gt": "<tokens>" }, style: { "--gt-*": … } }` or `null`. Only validated enum members map to CSS (a test asserts no `url`, braces or `javascript` ever reach a value). **Today's values emit nothing** — `md` scales, `hairline` border, `standard` width, `bar` heading — so choosing the default is byte-identical to choosing nothing.

### Rendering (storefront + Canvas, same rule set)
`data-gt` + `--gt-*` go on the published theme wrapper (`publishedThemeStyle` + new `publishedThemeAttrs`) and on the Canvas root. The rules live in the `@layer utilities` block (storefront) and its scoped twin (`store-preview.css`); the existing parity test now covers them too. Every rule is keyed on a token that is present **only** when set, and written with `:where()` so a section design's own (higher-specificity) rules still win over a global token while the global token wins over a component's own utility.

- **Typography** — heading scale is a *multiplier* (`zoom`), so the h1/h2/h3 hierarchy is preserved instead of flattened to one size; body scale multiplies running text (`p`); weights and line height step; the **default section-heading style** applies only to the shared section heading and never over a section whose own design chose a style (`:not([data-sd*="hstyle-"] …)`).
- **Surfaces** — `radius` drives the existing `--store-radius`/`--radius` variables (and overrides the legacy `radius` preset when set; the editor says so); border width and shadow apply to card surfaces (`rounded-store` + `border-store-border` / `bg-store-surface`). `pill` is a bounded 1.75 rem — a card is not a capsule.
- **Layout** — `contentWidth` drives the one existing container variable `--store-content-max`.
- **Motion** — bounded duration/easing replace the components' own transition values; under `prefers-reduced-motion` every transition/animation resolves to static. No parallax, no looping animation, no per-property keyframes exist to enable.

### Merchant UI
ThemePanel → **Global design** (`GlobalTokensEditor`): four groups of selects of named steps, an "as today" choice on every control, a reset, an explanation that card corners override the corner preset, AR/EN labels. No free-form inputs. Emptying a group removes it from the document.

---

## Proof

| Gate | Result |
|---|---|
| PHP | `StorefrontGlobalTokensTest` (fixture + absent ⇒ identical + idempotent) · existing normalizer / palette / contrast suites green |
| Twins | fixture ×2 (26 cases each incl. config integration + resolver) · twin files byte-identical · CSS block parity test |
| Real browser — **compiled storefront CSS** (`cust-hv-v5e2a-global-tokens.spec.ts`, 7) | absent tokens ⇒ identical computed styles (side by side) · heading zoom / weight beats the component's `font-extrabold` · card border / shadow / radius · motion duration beats `duration-200` · reduced motion ⇒ static · default heading style never over a section's own style. **Mutation-checked:** with the CSS block removed, 5 of 7 fail (the other two assert absence / a plain variable) |
| Real browser — **Canvas** (`cust-hv-v5e2a-canvas-proof.spec.ts`, 13) | a populated page at the boldest step of every token, **AR RTL + EN LTR × 390/430/768/1024/1280/1440**: tokens actually applied (not just attributes), content width ≤ 64 rem, no horizontal overflow; a page without tokens carries no `data-gt` and no `--gt-*` |
| UI | `GlobalTokensEditor` 6 tests (named steps only, no inputs, numeric weights, `{width}` border, default removes the field, reset, AR/EN) |

## Design Quality Pass

Evidence in `test-results/cust-hv-v5e2a/` (12 screenshots, AR/EN × six widths; reviewed at 390 AR and 1440 EN). Checked: card radius / border / shadow read as one family across product cards, the banner card and the benefits cards; heavier headings and the underlined section headings keep the RTL start edge; no overflow at 390; the narrow container keeps a comfortable measure at 1440; the underline style hides the rule bar rather than doubling it. Computed lengths on a zoomed element are reported in its own space (an underline of 2 px reads 1.78 px at ×1.125) — the proofs account for it. The footer's link rows run together in the preview (inline anchors in the existing footer column markup) — pre-existing, unrelated to these tokens, left untouched. The editor reuses the inspector's `Field` / select / `fieldset min-w-0` building blocks already proven at 360–1440 px in V5d; its own behaviour is covered by jsdom tests, not a new viewport proof.

## Invariants

| Invariant | Status |
|---|---|
| Tenant isolation / RBAC / Draft-Published / revision concurrency | Untouched — a validated, additive part of the existing presentation document |
| Backward compatibility | Absent keys ⇒ no attribute, no variable, no rule applies; version stays 3; rollout order PHP → storefront → builder holds (the PHP authority accepts the keys before any UI writes them) |
| Accessibility | Reduced motion ⇒ static; larger/heavier type never reduces contrast (colour untouched); focus rings are not touched |
| Commerce / accounting | Untouched |

## Limitations / next

- `bodyScale` multiplies running text (`p`) — spans/labels keep their size by design (a hierarchy of micro-text should not scale with copy).
- Font families, `buttons`/`buttonText` and a surface border colour follow in V5e-2b/c.
- Per-section `typography` (V5e-1) and the global tokens compose: a section's explicit size wins for its own text, the global multiplier still applies to headings inside it.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
