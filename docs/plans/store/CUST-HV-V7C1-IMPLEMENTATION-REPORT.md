# CUST-HV V7c-1 — Header `sticky: on-scroll-up` — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V7c-1** — first half of V7c (V7a structure ✔ → V7b colours ✔ → **V7c-1 `sticky: on-scroll-up`** → V7c-2 overlay-on-hero → V7d navigation + icons → V7e footer). The scroll controller is split from overlay-on-hero because overlay needs the region contrast proof and the transparent→solid scroll threshold, which reuse this slice's controller but carry their own proof burden. |
| **Branch** | `cust-hv/v7c-header-overlay` (from `main` after V7b #1294) |
| **Authority** | V0 §9.1 (`sticky?: 'always'\|'on-scroll-up'\|'off'`) · §9.2 (never hides while a menu / search is open or focus is inside the header) · §9.3 point 6 (Canvas = scroll-position simulator over the shared rule) |
| **Scope** | One enum value added to the existing `header.design.sticky`. No new key, no migration, no API/gate change, `PRESENTATION_CONFIG_VERSION` stays 3. |

## AWJ Decision recorded here

| Question | Decision |
|---|---|
| Where does the rule live? | `stepScrollUp` in the shared `header-design.ts` twin: pure, so the storefront (window scroll), the Canvas simulator (preview-pane scroll) and the tests run the **same** function. |
| When is the header hidden? | Never within its own height of the top; never while focus is inside it, an `aria-expanded="true"` control exists in it (menu / search), or the page scroll is locked by an open dialog (`body[data-scroll-locked]`). Past that: hides on a downward movement ≥ 4 px, returns on the first upward one ≥ 4 px. Overscroll above the top counts as the top. |
| Keyboard? | A `focusin` on the hidden header reveals it **before** the focused control paints, and pins it while the shopper works inside. |
| Motion? | A 200 ms transform slide (V0 §9.3 ceiling); `prefers-reduced-motion: reduce` ⇒ no transition (instant). |
| No JavaScript / before hydration? | The header is `sticky` exactly like `always`; nothing ever hides. |
| In-page offset? | Unchanged from `always` (the header comes back on the first upward scroll, so jump targets keep clearing it). |
| Announcement bar? | The slide distance includes `--store-announcement-height`, so a header under a sticky announcement bar leaves fully. (V3's rule that the bar never stacks with a sticky header below `md` is unchanged and out of scope here.) |

## What was built

- **PHP** `StorefrontHeaderDesignNormalizer::STICKY` gains `on-scroll-up`; **TS twins** (byte-identical) gain the enum value, token `hs-u`, `stepScrollUp` / `SCROLL_UP_JITTER_PX`. Fixture `header-design.json` updated (the old "deferred" case no longer lists it; a valid case added).
- **Storefront** `HeaderScrollUp` (client, renders a hidden marker) mounted by `Header` only for `on-scroll-up`; stylesheet rules (slide + reduced motion) live in the shared chrome block, so the Canvas gets the identical rules.
- **Canvas** `HeaderScrollUpPreview` finds the preview pane's scroll host and drives the same attribute.
- **Editor**: the Sticky select gains "Returns when scrolling up" (AR/EN).

## Backward compatibility

An additive enum value. `always` / `off` / absent render byte-identically (no controller mounted — test-pinned), and a document that already carried an unknown sticky value still drops it.

## Design Quality Pass — real Chromium, the production controller

The proof bundles the **production** `HeaderScrollUp` (esbuild) into the rendered production-`Header` pages and drives real scrolling at 390 / 430 / 768 / 1024 / 1280 / 1440, AR RTL / EN LTR, wordmark / image logo: header visible at the top → slides fully out of view after scrolling down → returns on the first upward scroll → hides again → **focusing the search field inside the hidden header reveals it and it then stays through further downward scrolling** → hides once focus leaves → the slide has a transition normally and none under `prefers-reduced-motion`. All earlier V7a/V7b proofs still hold (same run). Results: see the PR; evidence in `docs/plans/store/cust-hv-v7c1/`.

## Tests

`stepScrollUp` rule tests (top / overscroll / hide / return / jitter / pinned / replayed path) in the storefront and web twins; `HeaderScrollUp` jsdom tests (hide-return, focus pinning, expanded menu and scroll-lock pinning, cleanup); `Header` mounts the controller only for `on-scroll-up`; Canvas simulator test; PHP fixture.

## Limitations (stated)

- With a header that is hidden, an in-page anchor jump still lands clear of the (reserved) header space.
- The Canvas simulator is driven by the preview pane's scroll; a hidden header cannot be clicked for selection until the pane scrolls back up (the Header row in the inspector selects it anyway).
- The sticky-**off** mobile-menu-sheet offset limitation from V7a is unchanged.

## Invariants

Tenant isolation, authN/authZ, Draft vs Published, concurrency, media ownership: **untouched**. No arbitrary CSS/JS/HTML. No financial behaviour ⇒ no journal entries.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
