# CUST-HV V5d-3 — V1B items: 768 editing surface, 1024 Canvas width, delete confirmation, live accent — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V5d-3** — closes V5d (V5d-1 gate ✓ → V5d-2 authoring UI ✓ → **V5d-3 V1B items**) |
| **Branch** | `cust-hv/v5d3-v1b-surfaces` |
| **Authority** | V0 §IA (tablet drawer, 1024 Canvas ≥ 560), §4.1 (`accentColor` becomes a live palette role), Master Gap DEF-2 / DEF-6 / DEF-7 (BL-3) / BL-4 |
| **Depends on** | V5d-2 (palette editor, inspector) |

These four were deliberately held back by V1A until the editor IA and palette model existed (V5d-1/2). They are now co-designed with them.

---

## Implemented

### DEF-7 / BL-3 — a real editing surface at 768–1023
On `main` the inspector, rail and edit controls were `display:none` between 768 and 1023: only the Canvas was shown. Now:
- an **Edit** button in the Canvas strip opens the inspector as a **360 px side drawer over the Canvas** (≥ 320 required), docked on the *start* side (right in RTL, left in LTR) exactly where the desktop panel lives, **below the toolbar** so Save / Publish / Exit stay visible (the V1A guarantee is preserved and asserted);
- the panel `<select>` is the navigation (the rail becomes this drawer); a labelled close button; **Escape** closes from anywhere and **returns focus to the Edit button**;
- tapping a section or chrome in the Canvas opens its inspector (the natural editing flow).
No drawer machinery exists outside 768–1023 (asserted).

### BL-4 — the Canvas keeps its width at 1024
At 1024–1279 the navigation rail is icons-only (Canvas ≥ 560 px asserted; was ≈ 486). The merchant's stored expanded/collapsed preference is **not touched** — it is only overridden for that band, and the toggle is disabled there.

### DEF-6 — deleting a section that has authored work asks first
A section with content **or** a design shows an inline `alertdialog` ("Delete this section? Its content and design will be lost. The deletion becomes permanent once you save the draft."), focus on **Cancel**, Escape cancels. An empty section is removed immediately, exactly as before.

### DEF-2 — `accentColor` is a live role
- The builder's **Store palette** now has the accent field (hex, clearable → `null`) — the existing `accentColor` key, no second source of truth.
- The accent drives `--store-accent` / `--store-accent-foreground` (foreground picked by the existing white / near-black rule) **only when the merchant set one**; the first consumers are the **sale badge** (product card, preview) and the **offer badge**. Utilities read `var(--store-accent, <today's token>)`, so a legacy `accentColor: null` document renders **identically** — proved in a real browser (computed colours with and without the variable).
- Honest scope: the accent currently dresses the badges; further chrome (highlights, hover accents, selected states) lands with the slices that restyle those surfaces (V5e buttons/surfaces, V7 header/footer) rather than being guessed here.

---

## Design Quality Pass

Real browser, 13/13 (`web/e2e/cust-hv-v5d3-layout.spec.ts`) + the V5d-2 inspector spec now runs the **whole flow inside the 768 drawer** (12/12). Evidence `docs/plans/store/cust-hv-v5d3/*.jpg`.

| Check | Result |
|---|---|
| 768 / AR + EN | drawer ≥ 320, inside the viewport, under the toolbar; Save visible; panels reachable; Escape + close button; focus returns |
| 1024 | rail collapsed (`data-builder-navigation-collapsed=true`), Canvas ≥ 560 |
| 1280 / 1440 | unchanged |
| < 768 | unchanged (no Edit button; sheets) |
| Overflow | no added horizontal overflow at any width |
| Evidence-driven fix | the first drawer docked on the *end* side, i.e. the opposite of the desktop panel in RTL — moved to the *start* side so tablet and desktop agree |
| Keyboard | Edit toggle `aria-expanded`/`aria-controls`; Escape; focus return; Cancel focused in the delete confirmation |
| Tokens | semantic tokens only; drift ratchet green (the first close-button used neutral classes — fixed) |

## Invariants

| Invariant | Status |
|---|---|
| Tenant Isolation / auth / RBAC | No route, model or migration. |
| Draft vs Published | Authoring/layout only. Accent flows through the existing document (`accentColor`) and the existing publish path. |
| Backward compatibility | Absent accent ⇒ no CSS variable emitted ⇒ identical colours (unit + browser); empty-section delete unchanged; ≥ 1280 and < 768 layouts unchanged; stored sidebar preference untouched. |
| Commerce / accounting | Untouched (the badge is a label; no price/stock/offer data read or changed). |
| Accessibility | Focus management, Escape, labelled controls; badge foreground chosen by the existing contrast rule. |

## Verification

| Gate | Result |
|---|---|
| Web | store-experience-builder + governance **65 files / 1008 ✓** (new: drawer ×3, compact rail, delete confirmation ×4, accent palette, accent vars) · `tsc` clean for the module |
| Storefront | **143 files / 1312 ✓** (new accent-vars test) · `biome check` ✓ · `tsc` ✓ |
| Browser | `cust-hv-v5d3-layout` 13/13 · `cust-hv-v5d-design-inspector` 12/12 (incl. 768 drawer) |
| Backend | no `app/` change in this slice |

## Limitations / next

- Accent chrome beyond the two badges (see above).
- The drawer is non-modal by design (the Canvas stays interactive so selection works); it has no scrim.
- **V5e** — typography tokens, button styles, surface styles, separators, overlap presets, bounded motion (and then V6: Hero & Banner).

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
