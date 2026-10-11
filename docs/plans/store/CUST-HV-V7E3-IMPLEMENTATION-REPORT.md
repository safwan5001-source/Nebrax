# CUST-HV V7e-3 — Footer in the Canvas and the footer editor — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V7e-3** — last part of V7e (V7e-1 model + gate ✔ #1299 → V7e-2 storefront rendering ✔ #1300 → **V7e-3 Canvas parity + editor + fixture removal**) → V8. |
| **Branch** | `cust-hv/v7e3-footer-editor` (from `main` after #1300) |
| **Authority** | V0 §10.1–10.3 (model, layouts, groups) · §4.5 (provable contrast) · §6 (Canvas = Published) |
| **Scope** | Merchant UI + Canvas only: no PHP, no storefront change, no endpoint or schema change; `PRESENTATION_CONFIG_VERSION` stays 3; no accounting effect. |

## AWJ Decisions recorded here

| Question | Decision | Why |
|---|---|---|
| Canvas fixture removal | When the document sets `groups`, the Canvas draws **those** (disabled / label-less / unserved-content entries and title-less or empty groups are absent, exactly as the storefront omits them) instead of the fixed Shop · Account · Policies preview columns; with no `layout`/`groups`/`design` the Canvas footer is the original one. The fixed columns remain only as the stand-in for the real catalogue the Canvas cannot read. | V0 V7 scope "Canvas fixture removal"; honesty about what the Canvas cannot know. |
| Canvas breakpoints | The Canvas resolves its layout classes from the `viewport` prop (mobile / tablet / desktop), never from `md:` / `lg:` prefixes, with the same class sets as the storefront. Colour utilities the footer uses are mirrored in `store-preview.css` (the Canvas has no Tailwind theme for `store-*`), and a guard test fails if a `store-*` colour utility used by the Canvas footer / nav is missing there. | The host window's width is not the simulated device's; a missing utility draws nothing — the brand-heavy CTA pill did exactly that until this guard was written. |
| Editor shape | One section in the Footer panel: **Layout** (Default + six), **Link groups** (≤ 6; each: title, source = own links or any menu in the document, width 1 / 2 columns, reorder, remove — with a confirmation only when it has links; own links are typed items chosen with the V7d pickers, ≤ 8, never a typed path), **Design** (background, heading, text, link, divider colours with the live contrast verdict; top / bottom spacing; logo size; alignment). | The model V7e-1 froze, edited with the V7d discipline. |
| Writes | Every change re-normalises through `normalizeFooterExtras` (`footer-edit.ts`): clearing the last design field removes `design`, emptying `groups` removes it (the fixed columns return), the legacy `tagline` / `showLogo` / `copyright` are never touched. A test proves what the editor produces equals what the normaliser would store. | The draft can never hold an invalid or empty value. |
| One source per group | Choosing a menu clears the group's own links; adding an own link drops a menu reference. | Unambiguous: nothing silently ignored. |
| Product budget | The footer's own links share the storefront's 8-product-target budget across all groups; the picker disables "Product" when it is exhausted. | The storefront resolves 8 in one batched read. |
| Menus offered | Every menu in `navigation.menus` (today only the `main` menu the header editor creates). A group pointing at a menu that no longer exists degrades to its own links (and the editor shows the own-links editor). | V0 §11.1. |

## What was built

- `CanvasFooter.tsx`: the Canvas footer extracted from `StorefrontPreviewCanvas` — original path preserved, six layouts, groups, design variables via `resolveFooterDesign`, mobile disclosures, selectable chrome (branding / social / WhatsApp / footer) kept; `canvasFooterGroups` in `CanvasNav.tsx`.
- `footer-edit.ts` (pure operations) + `FooterEditor.tsx` (UI), wired into `FooterPanel`; `storefrontId` already plumbed by V7d; ~40 messages AR / EN; `quickLinks` for the Canvas link row.
- Dev fixture `/dev/customizer-visual?scenario=footer&layout=…`.

## Backward compatibility

No `layout` / `groups` / `design` ⇒ the Canvas draws the footer it always did and the Footer panel keeps its three original fields (the new editor adds nothing to the document until used). The 1 554 existing store-experience-builder tests pass unchanged.

## Design Quality Pass

- **Canvas** (`e2e/cust-hv-v7e3-canvas-footer.spec.ts`, real Next dev server): 6 layouts × AR / EN × desktop (1 440) / phone (430) — **24 / 24**: no added horizontal overflow, every element inside the Canvas frame, one WhatsApp link / app badge, contact present, minimal has no bottom bar, columns / editorial groups share a row from desktop, phone disclosures (2 for columns, 6 for brand-heavy) open.
- **Editor in the real builder** (`e2e/cust-hv-v7e3-footer-editor.spec.ts`, demo mode with its mock catalogue): AR / EN × 1 024 / 1 280 / 1 440 — **6 / 6**: choose a layout, add a group, add a page link and a category link through the pickers (picker takes focus), the Canvas swaps the fixed columns for the group and its two links, a designed background reaches the Canvas, nothing overflows, every control stays inside the viewport.
- jsdom: 9 editor tests, 12 model tests, 16 Canvas parity tests, 2 CSS-guard tests.
- The storefront's own Chromium proof for the same layouts is V7e-2's (7 958 checks, 0 violations).
- Screenshots: `docs/plans/store/cust-hv-v7e3/` (six Canvas layouts in Arabic; the editor with a designed background, EN + AR).

## Limitations (stated)

- The editor was proven at desktop widths (≥ 1 024) in the real builder; the phone bottom-sheet presentation reuses the panel and is covered by jsdom.
- Group category / product targets are drawn from their labels in the Canvas (no live catalogue).
- Media / gradient / alpha surfaces, `divider.kind` / `height`, `border`, `logo.treatment`, `linkHover` remain deferred (V7e-1).
- The editor creates only the header's `main` menu; footer groups can reference any menu already in the document.

## Invariants

Tenant isolation, authN/authZ, Draft vs Published, concurrency, media ownership: **untouched** — the editor writes the same presentation document through the existing draft save; catalogue reads use the existing authenticated workspace endpoints. Typed targets only; external URLs through the Publish sanitiser; contrast enforced at Publish (V7e-1). No arbitrary CSS / JS / HTML. No journal entry, no accounting behaviour.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
