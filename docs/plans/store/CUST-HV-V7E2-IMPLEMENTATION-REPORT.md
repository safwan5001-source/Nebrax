# CUST-HV V7e-2 — Footer: six layouts, link groups and design in the storefront — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V7e-2** — second of three parts of V7e (V7e-1 model + gate ✔ #1299 → **V7e-2 storefront rendering + Chromium proof** → V7e-3 Canvas parity + editor + Canvas fixture removal) → V8. |
| **Branch** | `cust-hv/v7e2-footer-render` (from `main` after #1299) |
| **Authority** | V0 §10.2 (layout contracts and frozen cross-layout rules) · §10.3 (groups) · §4.5 (provable contrast) · §2.2 (additive) |
| **Scope** | Storefront rendering only: the `Footer` reads `footer.layout`, `footer.groups`, `footer.design`; a pure resolver turns the design into validated colour tokens. No PHP, no endpoint, no schema; `PRESENTATION_CONFIG_VERSION` stays 3; no accounting effect. |

## AWJ Decisions recorded here (what V0 left open — not contract changes)

| Question | Decision | Why |
|---|---|---|
| Legacy footer | With no `layout`, `groups` or `design` the markup is the original **byte for byte** (a committed fixture of the rendered HTML, two scenarios, is asserted equal). `groups` and/or `design` without a `layout` keep the original stacked structure, swapping the three fixed columns for the merchant's groups and applying the design. | Backward compatibility is a release gate (V0 §2.2); nothing about an existing store changes until the merchant opts in. |
| How colour is applied | Validated hex values re-point the **existing** footer tokens (`--store-footer`, `-foreground`, `-muted`, `-link`, `-border`) inline on `<footer>`; every existing class follows with no new CSS and no string from the document ever reaches CSS. | Smallest mechanism that cannot drift from the theme's own footer rules. |
| Derived colours | Over a designed background: heading = best of pure white / black; body (muted) text and links = a step toward the background taken only while they still clear 4.5:1, else the full foreground; divider = a decorative tint. A test sweeps nine backgrounds (pale to saturated) and proves every derived colour ≥ 4.5:1. Explicit colours override only the token they name and are gated at Publish (V7e-1). | §4.5: provable by construction. |
| Which data each layout draws | The same data in every layout: brand, tagline, groups, identity / licence / seal, contact, social, WhatsApp, apps, copyright. Layouts that draw social marks themselves (compact / centered / minimal) keep them out of the trust grid; brand-heavy moves WhatsApp and the app badges into its CTA band. A test asserts exactly **one** of each mark in every layout. | V0: "same data feeds every layout (no content duplication); no layout hides identity/verification at any width". |
| Flat-row layouts | compact / centered / minimal flatten the groups' links into one `<nav aria-label="Quick links">` (the group titles are not drawn in a single row); minimal shows the first three. Every footer link in the new layouts is a ≥ 44 px target. | §10.2 tables. |
| Disclosures | `columns` collapses groups past the fourth, and `brand-heavy` collapses every group, **below `md` only**. Progressive: server render, no-JS and ≥ `md` are plain headings over links; once mounted on a narrow viewport the heading becomes a real `<button aria-expanded aria-controls>` over a collapsed list, and it turns back into a plain heading if the viewport widens. | Nothing hidden that a script cannot reveal; a keyboard user never lands on a control that does nothing. |
| `design.align` | Applies to the brand block, the bottom bar and (for centered) the row alignment; `centered` defaults to the centre, every other layout to the start; logical (`text-start` / `text-end`) so RTL mirrors. | §10.2 RTL column. |
| Footer link groups when resolving | Reuse the V7d resolver: a typed target that no longer exists is omitted (never a dead link); a group without a title or without a live link is omitted; the product-target cap (8) is shared across the footer's menus and inline links. A present `groups` list that resolves to nothing yields no groups — the legacy columns do not come back behind the merchant's back. | Same honesty rules as the header menu. |

## What was built

- Twin `footer-design.ts` (storefront + web, byte-identical): `resolveFooterDesign` → validated `--store-footer*` variables, spacing, logo size, alignment.
- `navigation-resolve.ts`: `resolveFooterGroups`, `collectNavTargetIds` now takes one or many menus; `public-footer.ts` (`publishedFooterGroups`) reads only what the groups point at; `(storefront)/layout.tsx` passes `layout`, `groups`, `design` to the footer.
- `Footer.tsx`: the original path kept intact + six layout compositions over the same shared blocks (brand, trust grid, social, WhatsApp, badges, bottom bar); `FooterGroupDisclosure` (client) for the collapsible groups; message `footer.quickLinks` in six locales.

## Design Quality Pass — real Chromium

`scripts/footer-proof/` renders the **production** `Footer` (with `resolveFooterDesign` and `resolveFooterGroups`) for 40 pages — every layout with the default and a light designed background, plus 6-group, brand-role, explicit-colour, end-aligned and spacing variants — in AR RTL and EN LTR at 390 / 430 / 768 / 1024 / 1280 / 1440, mounts the real `FooterGroupDisclosure`, and measures: **7 958 checks, 0 violations.**

- every width: no horizontal overflow; the CR number visible; **every colour the footer draws** (brand, headings, links, tagline, copyright, trust text) ≥ 4.5:1 against the footer's own computed background, designed or not; every footer link ≥ 44 px tall; designed background, explicit heading / link colours and spacing land exactly; one social mark, one WhatsApp link, one app badge;
- compact: brand · links · social on one row from `lg` with mirrored inline order under RTL, stacked below; columns: brand block first on the inline-start side with the groups on its row, groups below the brand on phones, and on phones groups 5–6 are exactly the collapsed `aria-expanded` disclosures (open / keyboard-close / no overflow), none from `md`; centered: brand on the container's centre at every width (or at the chosen end); editorial: the statement is a `<p>` on the inline-start side from `lg`, above below; minimal: copyright · ≤ 3 links · social on one line from `lg`, no separate bottom bar; brand-heavy: the labelled CTA band above the groups, carrying WhatsApp + the badge (not the trust grid), a ≥ 44 px CTA, and every group a collapsed disclosure on phones.
- **Negative controls, both caught**: `--strip` (the `lg` row / grid rules removed from the stylesheet) → 138 violations; `--lie` (link colour forced to the background's own colour) → 165 violations.
- Screenshots: `docs/plans/store/cust-hv-v7e2/` (compact, columns RTL, centered light, editorial brand, minimal explicit RTL, brand-heavy desktop + RTL phone, six-group phone with disclosures). The social / WhatsApp marks are blank boxes in the screenshots only because the proof harness loads pages without the app's static assets.

## Tests

`Footer.legacy.test.tsx` (byte-identical fixture; absent keys change nothing); `Footer.layouts.test.tsx` (21: the shared contract per layout — nothing dropped or duplicated, identity visible, one of each mark, safe external links — plus per-layout structure, default-groups fallback, groups-only, disclosure behaviour with a mocked `matchMedia` incl. progressive / widen-back, design variables and literal spacing / alignment classes, icon + badge); `resolveFooterDesign` tests (nine-background sweep, explicit overrides, role resolution, hex-only output); `resolveFooterGroups` / shared product cap tests; twin byte-identity extended.

## Limitations (stated)

- No editor and no Canvas yet (V7e-3): until then a layout can only arrive through the API, and the Canvas still draws its existing footer.
- Media / gradient / alpha surfaces, `divider.kind` / `height`, `border`, `logo.treatment` and `linkHover` are deferred (V7e-1).
- Category links inside a group target categories by id and resolve to `/c/<permalink>`; product targets are capped at 8 per footer.
- The disclosure collapses only after hydration on a narrow viewport (by design: no-JS shows everything), so a phone shows the open state for the moment before hydration.

## Invariants

Tenant isolation, authN/authZ, Draft vs Published, concurrency, media ownership: **untouched** — the storefront reads only the Published document and the public category / product endpoints for ids a Published footer names; no new endpoint. External links keep `rel="noopener noreferrer"`. No arbitrary CSS / JS / HTML: every colour is a validated hex, every class a literal. No journal entry, no accounting behaviour.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
