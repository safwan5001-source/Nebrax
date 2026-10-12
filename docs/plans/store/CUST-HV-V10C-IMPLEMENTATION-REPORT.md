# CUST-HV V10c — Section names and built-in section styles — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V10c** — third V10 slice (V10a model ✔ → V10b Preview / Apply ✔ → **V10c workflow: section names + ready styles** → V10d Library thumbnails, hover action bar, drag reorder). |
| **Branch** | `cust-hv/v10c-section-workflow` (stacked on V10b until it merges) |
| **Authority** | V0 §17.1 (section labels, O13) · §17.2 (duplicate with design, copy / paste style, reset design, built-in section presets) · D-19 / D-23 |
| **Scope** | One additive, editor-only key (`homepage.sections[i].label`) in PHP (authority) + the merchant-app TS twin + shared fixture; the public snapshot strip; the section list / inspector; a ready-styles selector. No endpoint, schema or Publish-rule change; `PRESENTATION_CONFIG_VERSION` stays 3; no accounting effect. |

## What already existed (verified, not rebuilt)

Duplicate **with design**, **Copy style / Paste style** (same-type, normalised for the target) and **Reset design** (section and the store-wide tokens) are already in the product (`DesignInspector`, `GlobalTokensEditor`, `design-clipboard`). V10c adds only what was missing: names, the label suffix on duplicate, and ready styles.

## AWJ Decisions recorded here

| Question | Decision | Why |
|---|---|---|
| `label` | ≤ 60 code points, trimmed with PHP's default `trim` set, blank / non-string = absent; canonical key order `id · type · visible · label · content · design`; any section type may carry one. | V0 §17.1; the merchant-app twin reproduces PHP's trim set exactly (a regex, not JS `trim`). |
| Editor metadata only | The **storefront normaliser never reads it** (test: it is dropped from every section) and `StorefrontConfigController` **strips it from the public snapshot** (test with a published document: sections intact, no `label`, the text appears nowhere in the response). It is never an `aria-label` or a heading. | "never rendered on the storefront … stripped from the public snapshot". |
| Where it shows | The section list (name first, the type as a quiet hint beneath), the row tooltip, the inspector title, the name field (placeholder = the default title, 60-character limit). Duplicating a named section keeps the name with a localized "copy" suffix; when it does not fit in 60 code points the ORIGINAL name is shortened, never the suffix (review), so a duplicate is always distinguishable. | O13. |
| Canvas chip | **Built** (review: V0 §17.1 names it). `SelectablePreviewSection` shows the name as a chip on the **selected** section only: plain text (the label is merchant-typed), `aria-hidden` (the list and inspector carry it), pointer-transparent, one line with ellipsis, on the inline-start edge inside the section's own box (editor tokens, outside the store's section markup). Only the selected, named wrapper gains `position: relative`. | The Canvas is where two same-type sections are otherwise indistinguishable. |
| Ready styles | `sectionPresetsFor(type)`: four structural styles (**Soft card, Flat, Airy, Tight** — shape / border / shadow / rhythm, **never a colour**) plus each built-in theme's default for that type ("AWJ Market" rail, "AWJ Trade" four columns), offered only where the type can use them, normalised through the section's own capability list, de-duplicated. Applying one replaces the design like Paste style, with the same notice and Reset. | "built-in section presets per type, shipped with themes". Structural-only ⇒ a preset cannot fail a contrast gate. |
| User-saved presets | Not built (V0 §17.3: LATER). | — |

## Tests

- Shared fixture `section-labels.json` (13 cases, expected values computed by the PHP authority) × PHP `StorefrontSectionLabelsTest` (with idempotence) and the merchant-app `section-labels.test.ts` (key order compared through JSON); the storefront twin ignores the key (`section-labels.test.ts`).
- PHP API: editor-only labels never reach the public snapshot (`StorefrontMediaRefTest`).
- `ControlPanels.sectionName.test.tsx` (6): typing stores, clearing removes the key, 60-char limit, list shows name + type hint, duplicate keeps design and suffixes the name within the limit, an unnamed section duplicates unnamed.
- `section-presets.test.tsx` (5): every preset for every type is already in normal form and colour-free, unique per type, shelf styles come from the themes; the selector applies a style, announces it, and Reset clears it; types without presets show no selector.
- `StorefrontPreviewCanvas.sectionChip.test.tsx` (4): the chip on the selected section only (two same-type sections stay distinguishable), inert (aria-hidden; none when unselected or unnamed), text never markup, never inside the storefront section frame.
- Real Chromium `cust-hv-v10c-section-chip.spec.ts` (8): name a new section; the chip is inside the section's box, on the inline-start edge (RTL right / LTR left), one line, pointer-transparent, no horizontal overflow — AR RTL + EN LTR at 390 / 768 / 1024 / 1440 (screenshots in `test-results/cust-hv-v10c`).
- Review rounds: duplicate-name suffix survives truncation (the original is shortened); the label normaliser is idempotent after the 60-point cut (PHP + TS twin, two new fixture cases); a named section asks before delete.
- Full web / storefront / PHP suites (see PR).

## Invariants

Tenant isolation, authN/authZ, Draft vs Published (the key is authored in drafts; the public snapshot omits it), concurrency, media ownership: untouched. **Commerce firewall:** a name is text the merchant types for themselves; presets are closed-list structural tokens. No arbitrary CSS / JS / HTML. No journal entry.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
