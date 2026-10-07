# CUST-HV V5b — Section Visual Contract (`section.design`) & capability registry — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V5b** — second slice of V5 (V5a engine+palette → **V5b contract** → V5c renderers → V5d inspector/ColourField/publish gate + V1B → V5e typography/buttons/surfaces/separators/motion) |
| **Branch** | `cust-hv/v5b-section-design-contract` |
| **PR** | see PR description (opened with this report) |
| **Base SHA** | `329c4c0a` — `origin/main` after V5a (#1266) merged |
| **Authority** | V0 §3.1–§3.4 (Contract A: typed capability groups, primitives, per-type registry), §3.5 (resolution — V5c), §18 |
| **Depends on** | V5a (palette roles) |

V5b is **contract only**: what a section's `design` may contain, per type, and how it normalises. No renderer reads it yet (V5c) and no UI writes it yet (V5d), so it is **inert** — and provably so: a document without `design` normalises byte-identically.

---

## Implemented

### 1. `section.design` — typed groups, never a style bag (V0 §3.1)
Optional key on a homepage section instance (after `content`), emitted only when non-empty:

| Group | Fields (all enumerated) |
|---|---|
| `background` | `solid {color}` · `gradient {from, to, direction}` (8 logical directions that mirror in RTL — no free angle) |
| `text` | `heading` · `body` · `link` colours, `align` |
| `typography` | `headingScale` sm–xl · `bodyScale` sm–lg · `headingWeight` 400/500/700/800 · `lineHeight` · `headingStyle` bar/plain/centered/underline |
| `width` | `mode` contained/wide/full · `max` narrow/standard/wide |
| `spacing` | `top` · `bottom` · `inner` ∈ none…xl |
| `align` · `radius` · `shadow` | enumerated |
| `border` | `width` none/hairline/medium + `color` (only when not `none`) |

**Colour references** are `{role}` (`brand · accent · surface · surfaceAlt · text · heading · link · border · overlay`) or `{hex}` — never a CSS string. `role` wins over `hex` when both appear (deterministic); hex is canonical lower-case; `rgb()`, names, short hex, `url(...)`, non-objects are dropped.

### 2. Per-type capability registry (V0 §3.4, authoritative)
A type exposes only the groups — and the *fields inside a group* — it can render: e.g. `hero`/`banner`/`benefits` the rich set; shelves (`featured`, `offers`, `newArrivals`, `productShelf`) → background, heading colour, `headingStyle`, width, spacing; `customContent` → `width.max` only; `categories` adds border/radius; `discovery` only background/heading/spacing; `wholesale`/`deliveryPromise` only background + spacing. Anything else is dropped, and a **test enforces that every section type the builder knows has an entry**, so a new type cannot ship without declaring its design capability.

### 3. Three implementations, one fixture
PHP `StorefrontSectionDesignNormalizer` (authority) · `section-design.ts` (web + storefront, byte-identical) · `tests/Fixtures/presentation/section-design.json` — **28 cases + a snapshot of the registry itself**, asserted by PHP and both TS twins (including key order and idempotence). Lenient + deterministic: a bad field is dropped on its own, an invalid group on its own, an empty result is omitted, and the whole document is idempotent.

### 4. Fail-closed on what is not provable yet (decision, stated)
Dropped for now, each entering with the slice that can render **and prove** it:
- `background.kind = "media"` (+ overlay, mobile override) → **V6**, together with the region-luminance evidence the contrast gate needs (V0 §3.2.1). Until then a hand-written document **cannot** carry an unproven image background past the publish gate — it normalises away.
- `layout` variants → V6/V8/V9 (a variant key is only declared when its renderer exists);
- `separator` / `overlap` / `mediaTreatment` / `motion` → V5e/V6/V8.

### 5. One builder fix the contract exposes
`Duplicate section` copied `type/visible/content` only — it would have silently dropped a section's design. It now deep-clones `design` (test: the copy equals the original and is **not the same object**, so editing one never edits the other).

---

## Invariants

| Invariant | Status |
|---|---|
| Tenant Isolation / auth / RBAC | No route, model, query or migration. Pure normalisation + one additive optional key on sections. |
| Draft vs Published / concurrency | Untouched. `design` rides the existing document, versions, publish and schedule paths. |
| Media ownership | No `MediaRef` accepted in `design` yet (fail-closed until V6). |
| Commerce / accounting | Untouched. No journal entries. Section `design` carries no price/stock/offer/availability. |
| Backward compatibility | Absent `design` ⇒ byte-identical (asserted in PHP + both TS apps); `PRESENTATION_CONFIG_VERSION` stays 3; nothing renders `design` yet. |
| Accessibility | Contrast is **not** decided here — colours are references; the V5a engine proves them at the V5d publish gate (unproven ⇒ blocked). |

## Verification

| Gate | Result |
|---|---|
| PHP | `StorefrontSectionDesignTest` **5** (fixture + key order + idempotence; registry snapshot; every known section type declared; absent ⇒ identical; group filtering in a document) |
| Web | `section-design.test.ts` **36** · `ControlPanels.design.test.tsx` **1** (duplicate keeps design) · builder suite 56 files / 832 ✓ |
| Storefront | `section-design.test.ts` **36** · presentation suite 15 files / 325 ✓ · `tsc` ✓ · **`biome check` ✓** |
| Full suites (local) | backend sqlite: 5751 passed · 57 skipped · **28 failed — all environment-only and identical to `main`** (`ext-bcmath` Fuel*, mail views) · web vitest 426 files / 3685 ✓ · storefront vitest 141 files / 1272 ✓ · PostgreSQL by CI |

**Process note.** V5a's first CI run failed on the storefront job: CI runs `biome check` (formatting), not just `lint`; my local pre-push step ran lint only. Fixed by formatting the V5a files (commit `81b22474`) and — from here on — running `pnpm exec biome check src` before every storefront push.

## Risks / deferred

- **Inert until V5c/V5d.** Nothing renders or authors `design` yet; that is deliberate (reviewable, reversible slices).
- **Role fallbacks are V5c/V5d's.** A `{role}` whose palette entry is unset must resolve to *today's* token (surface `#ffffff`, surfaceAlt `#f3f4f6`, text/heading `#111827`, border `#e5e7eb`, link → brand, accent → `accentColor ?? derive(brand)`); the PHP twin of that resolver ships with the publish gate so the editor and server run the identical algorithm (V0 §4.5.6).
- **Contrast is not evaluated at normalisation** (a Draft is never rejected); the V5d publish step recomputes with the V5a engine.
- Page regions (product/category pages, header, footer) get their own design groups with V7/V9.

## Next dependency-safe slice

**V5c** — `resolveSectionDesign` (one pure resolver per runtime, diff-checked) and the Canvas + storefront renderers that apply `design` and the palette (`accentColor` goes live in chrome); absent ⇒ identical output, with Canvas ↔ Published attribute parity tests.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
