# CUST-HV V7d-4 — Header navigation editor — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V7d-4** — last part of V7d (V7d-1 icons ✔ · V7d-2 document ✔ · V7d-3 rendering ✔ #1297 → **V7d-4 editor** → V7e footer). |
| **Branch** | `cust-hv/v7d4-nav-editor` (from `main` after #1297) |
| **Authority** | V0 §11.2 (interaction) · §11.1 (typed targets, lazy legacy migration) · §11.3 (a11y / RTL) |
| **Scope** | Merchant UI only: no PHP, no endpoint, no schema, no publish-gate change; `PRESENTATION_CONFIG_VERSION` stays 3; no accounting effect. One storefront refinement found by the Chromium proof (dropdown flip, below). |

## AWJ Decisions recorded here

| Question | Decision | Why |
|---|---|---|
| Legacy → menu migration | An **explicit** button ("Use the new menu editor"), shown only while no `main` menu exists. It converts exactly what maps — `home`, https `external`, and a `content` link whose path *is* a content slug — keeps disabled links disabled, ignores the label-less default placeholder (it never rendered), and **lists** what it could not convert (`category` / `product` legacy links hold a free path, never an id; mapping them would be guessing). `header.links` stays stored untouched. | V0 §11.1 "lazy on first nav edit" + no silent data loss + no guessed targets. |
| Typing a target | **Pickers only** — home / category / product (workspace endpoints, debounced search) / content page / external https (validated with the same sanitiser as Publish; `javascript:` and relative paths refused). No raw internal path field exists. | V0 §11.2. |
| Keyboard alternative to drag | Per-row ↑ ↓ and **"Make child ↴" / "Move out ↰"**; drag-and-drop is deferred (the buttons are the complete interface, as V0 allows). A control the operation would refuse is disabled, never silently ignored. | §11.2. |
| Limits in the UI | 24 items, 12 children, depth 1 — the shared constants — plus **8 product targets per menu**: exactly what the storefront resolves in one batched read, so the editor never lets a merchant author an item that would silently not appear. | Honest authoring. |
| "Will it show?" | Each row says why it would be hidden on the store, mirroring the storefront resolver: no text, a content page not served yet (`about`, `faq`), a category / product that no longer exists. A target is called "missing" **only** when the lookup succeeded and (for categories) the whole list was read; an error or a truncated list says nothing. | Never a false alarm; never a dead link left unexplained. |
| Parent presentation | The first child makes its parent a dropdown unless the merchant already chose; a "Show children as a dropdown" switch appears on parents. Removing a parent asks first (only when it has children). | §11.2. |
| Picker focus | The picker takes focus on open (Escape and Tab work without a prior click); Escape closes it. | Keyboard-complete. |
| Appearance fields | Icon (24-key registry, labelled AR/EN) and badge (≤ 12, brand / accent) sit in a collapsible "Icon & badge" group, open when set — dense menus stay scannable. | UX density. |

## Storefront refinement found by the proof (flip)

The Canvas e2e showed a dropdown whose default start-aligned panel passed the right edge of a 768 px frame; the same latent case exists on the storefront (a dropdown near the inline-end edge with a long child). New pure twin `nav-flip.ts` (`shouldFlipPanel`, byte-identical in storefront / web, pinned by the twin test): the panel opens from the parent's **inline-end** edge instead only when the default would leave its container (viewport on the storefront, the Canvas frame in the editor). Exposed as `data-flip`. The Chromium proof gained a page with the dropdown last and a very long child, and now **requires** the flip to occur in each direction.

## What was built

- `navigation-edit.ts` — pure operations (`addItem`, `updateItem`, `setTarget`, `removeItem`, `moveItem`, `indentItem`, `outdentItem`, `canX` predicates, `migrateLegacyLinks`, `withMainMenu`), limits from the shared constants; a test proves what the editor produces is exactly what the normaliser would store.
- `NavigationPanel.tsx`, `NavTargetPicker.tsx`, `use-nav-target-names.ts` (re-fetches only when the *set* of targeted ids changes; abort + stale-response guard); `ControlPanels` `HeaderPanel` switches between the legacy editor + migration button and the new editor; `storefrontId` plumbed from `ExperienceBuilder`.
- ~50 messages AR / EN; `/dev/customizer-visual?scenario=navigation`.

## Backward compatibility

No `main` menu ⇒ the legacy "Additional links" editor and rendering are exactly as before. After the switch, `header.links` is retained in the document. Nothing in published versions changes.

## Design Quality Pass

- **Storefront (real Chromium, production components + compiled stylesheet)**: 4 pages (standard + dropdown-last/long-label) × AR RTL / EN LTR × 390 / 430 / 768 / 1024 / 1280 / 1440 — **428 checks, 0 violations**; negative controls caught: `--strip` (12), `--physical` (6, all RTL), `--noflip` (12).
- **Canvas** (`e2e/cust-hv-v7d-canvas-navigation.spec.ts`): AR / EN × 768 / 1024 / 1280 / 1440, **8 / 8** — rail order, unserved page absent, icon + badge, hover and focus open the panel, alignment (start, or end when flipped), inside the frame, hit-test, no added overflow.
- **Editor in the real builder** (`e2e/cust-hv-v7d4-nav-editor.spec.ts`, demo mode with its mock catalogue): AR / EN × 1024 / 1280 / 1440, **6 / 6** — switch, three picker paths, Escape, picker focus, Make child, dropdown switch, Canvas reflects each edit, no horizontal overflow, every control inside the viewport.
- jsdom: 13 editor tests (picker states, stale search guard, error + retry, https-only, disabled unserved pages, tree ops, remove-with-children confirm, warnings only when truthful, failed lookup claims nothing) + 19 model tests + 4 flip tests.
- Screenshots: `docs/plans/store/cust-hv-v7d4/`.

## Limitations (stated)

- Drag-and-drop reordering is deferred (the button interface is complete).
- The editor was proven at desktop widths (≥ 1024) in the real builder; the phone bottom-sheet presentation reuses the same panel component and is covered by jsdom, not by a phone-width Chromium run in this slice.
- Category names are resolved from the first 500 categories; beyond that a category target is reported neither as missing nor as present.
- Legacy `category` / `product` links must be re-added with the picker (reported by name).
- Footer menu groups (V7e) will reference menus by id; this editor edits only `main`.

## Invariants

Tenant isolation, authN/authZ, Draft vs Published, concurrency, media ownership: **untouched** — the editor writes the same presentation document through the existing draft save; catalogue reads use the existing authenticated workspace endpoints scoped to the storefront. Typed targets only (no free paths); external URLs through the Publish sanitiser. No arbitrary CSS / JS / HTML. No journal entry, no accounting behaviour.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
