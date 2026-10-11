# CUST-HV V7e-1 — Footer model, link groups and contrast gate — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V7e-1** — first of three parts of V7e (V7e-1 model + publish gate → V7e-2 six layouts in the storefront + Chromium proof → V7e-3 Canvas parity + editor + Canvas fixture removal) → V8. |
| **Branch** | `cust-hv/v7e-footer` (from `main` after V7d-4 #1298) |
| **Authority** | V0 §10.1 (model) · §10.2 (cross-layout rules: all text/link pairs pass §4.5) · §10.3 (groups reuse the navigation item model) · §2.2 (additive) |
| **Scope** | Data model + normalisation (PHP authority, two byte-identical TS twins, shared fixtures) and the publish-time contrast gate. **No rendering change**: nothing reads the new keys yet, so every footer renders exactly as today. `PRESENTATION_CONFIG_VERSION` stays 3; no endpoint, no migration, no accounting effect. |

## Why split V7e

V7e is three independently verifiable things — what the document may say (this slice), how six layouts render it (needs the real-Chromium proof, like V7a), and how the merchant edits it plus the Canvas twin (like V7d-4). Shipping the model first lets the gate and the twins be proven in isolation and keeps each PR reviewable.

## AWJ Decisions recorded here (what V0 left open — not contract changes)

| Question | Decision | Why |
|---|---|---|
| Which design fields now | `surface.background` (palette role or hex), `text`, `heading`, `link`, `divider.color`, `spacing.top/bottom` (`sm`/`md`/`lg`), `logo.size` (`sm`/`md`/`lg`), `align` (`start`/`center`/`end`). | The colour + structure the six layouts need; the same fields-first approach V7a/V7b took for the header. |
| Deferred (dropped fail-closed, fixture-pinned) | media / gradient / `alpha` surfaces, `divider.kind` / `height`, `border`, `logo.treatment`, `linkHover`. | Media surfaces need the overlay-proof machinery applied to the footer (its own slice); `linkHover` follows the heading colour (what the footer does today); the rest are cosmetic variants with no layout dependency. |
| Default backdrop | The footer surface token `#111827` — pinned by a test that reads it from `globals.css`. | The gate must judge against what is really drawn. |
| What the gate judges | Only **explicit** `text` / `heading` / `link`, each ≥ 4.5:1 (worst ratio) against the designed background, else `#111827`. The automatic colour over a designed background (best of pure white / black) passes by construction; the divider colour is decorative and never judged. Errors are `footer.design.<field>` / `contrast_insufficient`, wired into the publish validator exactly like the header's. | V0 §10.2 + the V7b precedent. |
| Groups | ≤ 6 groups, each `{ id, title ≤ 40, menu?, links? ≤ 8, span? 1|2 }`; ids sanitised + de-duplicated deterministically; `menu` is only a *reference* (validated as an id; a missing menu degrades at render — V0 §11.1); `links` are the **same typed navigation items** (typed targets, https externals via the same sanitiser) but flat: children and the header's `presentation` are stripped. A group with neither source is kept as a draft. | V0 §10.3: reuse the item model and pickers; nothing new to learn or to attack. |
| `span` | Only the integers 1 and 2; strings and other numbers drop. | Closed enum. |

## What was built

- PHP: `StorefrontFooterNormalizer` (authority), `FooterDesignContrast` (publish gate), `StorefrontNavigationNormalizer::normalizeFlatItems` (shared flat-link normalisation), wiring in `StorefrontPresentationNormalizer` (keys appended after the legacy footer fields, canonical order `layout → groups → design`) and `StorefrontPresentationPublishValidator`.
- TS twins `footer-design.ts` (byte-identical in storefront / web, added to the twin-identity test) with `normalizeFooterExtras`, `footerContrastIssues`; `normalizeNavFlatItems` added to the `navigation.ts` twins; both `config.ts` carry the three keys on `footer`.
- Fixtures: `tests/Fixtures/presentation/footer-design.json` (30 cases, expected values computed by the PHP authority and reviewed) and `footer-contrast.json` (11 cases).

## Backward compatibility

Absent keys ⇒ the footer object is exactly `{ tagline, showLogo, copyright }` (PHP and both TS twins, test-pinned, version stays 3). Invalid / unknown values leave the document identical to one without them. Old published versions are untouched. The Footer component does not read the new keys until V7e-2.

## Tests

PHP `StorefrontFooterDesignTest` (fixture × normaliser, absent ⇒ identical + version 3, key order after the legacy fields, contrast fixture, exact error paths, publish validator rejects an unreadable footer and accepts the readable one); storefront and web `footer-design.test.ts` (both fixtures × `normalizeFooterExtras` / `normalizePresentationConfig` / `footerContrastIssues`, default-backdrop pin against `globals.css`); twin byte-identity extended with `footer-design.ts`.

## Limitations (stated)

- No rendering, no editor (V7e-2 / V7e-3).
- Media / gradient / alpha surfaces and `linkHover` are deferred (see above).
- Menu references are not checked against `navigation.menus` at normalisation (a missing menu is a render-time degrade, per V0 §11.1).

## Invariants

Tenant isolation, authN/authZ, Draft vs Published, concurrency, media ownership: **untouched** — the keys ride the existing presentation document; the only new server behaviour is a pure validation rule at Publish. External URLs go through the same https sanitiser; no raw internal paths. No arbitrary CSS / JS / HTML. No journal entry, no accounting behaviour.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
