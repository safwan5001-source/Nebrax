# CUST-HV V7a — Header structural design — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V7a** — first sub-slice of V7 (Header / Footer / Navigation). Planned order: **V7a header structure** → V7b header colours behind a contrast gate → V7c `sticky: on-scroll-up` + overlay-on-hero → V7d navigation schema / editor / pickers + icon registry → V7e footer layouts / groups / design. |
| **Branch** | `cust-hv/v7a-header` (from `main` after V6c-7 #1289) |
| **Authority** | V0 §9.1 (`HeaderDesign`) · §9.2 (height presets feed `--store-header-height*` so `--store-header-offset` stays correct) · §9.4 (logical start/centre, mirrored order) · §2.2 (additive, absent ⇒ identical) |
| **Scope** | One additive optional key, **`header.design`**, in the presentation document (three normalizers in lock-step: PHP authority + web twin + storefront twin, byte-identical TS twins). No migration, no API route change, no publish-gate change, `PRESENTATION_CONFIG_VERSION` stays 3. No accounting / commerce effect. |

---

## AWJ Decision recorded here (what V0 left open — not a contract change)

V0 §9.1 lists eleven `HeaderDesign` fields. V7a takes the ones that are **purely structural** — they change geometry, never a colour a contrast proof would have to cover — and leaves the rest to the slices that can prove them.

| Field | V7a | Meaning |
|---|---|---|
| `layout` | `standard · compact · centered · two-row` | `standard` = today's row. `compact` = the legacy `style: compact` (compact logo, no utility strip). `centered` = search on the start side, **brand centred**, actions on the end side (a symmetric spacer column keeps the brand centred even while the tablet menu button is showing). `two-row` = brand + actions on row 1, a full-width search on row 2. |
| `mobileLayout` | `logo-centre · logo-start` | below 768 px; no effect from 768 px (proven). |
| `height` | `compact · standard · tall` | identity-row minimum (desktop 52 / 64 / 80 px, phone 46 / 54 / 62 px). A minimum, not a fixed height: a larger logo or wrapped content is never clipped. |
| `logo.size` | `sm · md · lg · xl` | replaces the logo image height (and its width cap) or the wordmark size. |
| `sticky` | `always · off` | `off` = the header scrolls away **and the in-page offset collapses** (skip-link landing, the product gallery's sticky top). |
| `border.width` | `none · hairline · medium` | every band of the header (utility strip, identity row, category rail): 0 / 1 / 2 px. `hairline` = today. |
| `shadow` | `none · soft · medium` | on the `<header>`. |

**Precedence with the legacy header fields.** `design.layout`, when present, wins over `header.style` (`standard` ⇒ not compact even if the legacy style says compact); absent, the legacy style stays the source. `showSearch / showAccount / showCart / showCategoryNav / links` are untouched and still the only switches for those items (the contract's `search` / `categoryNav` presentation enums are not accepted yet — see below). The editor says so when the two disagree.

**Deliberately not here yet (dropped fail-closed, fixture-pinned):** `surface` / `text` / `icon` colours → V7b (needs the contrast gate); `sticky: on-scroll-up` and `mode` (`transparent | overlay-hero`) → V7c (needs the scroll controller and the header-band contrast proof); explicit `search` (`icon-expand`) and `categoryNav` (`tabs`) presentation; `logo.align` / `logo.treatment` (`mono-*` needs the overlay slice).

**Why a stylesheet block *and* literal classes.** Things the *page below the header* depends on (heights → `--store-header-height*` → `--store-header-offset`, sticky off) must live on the theme wrapper, because custom properties resolve where they are declared; so the resolver emits a `data-hd` token list on the wrapper and `globals.css` restates the dependent properties there. Structure that only the header's own DOM needs (grid columns, placement, logo size) is a set of literal Tailwind class maps inside `Header.tsx` — no string from the document is ever interpolated into CSS or a class.

---

## What was built

- **PHP** `StorefrontHeaderDesignNormalizer` (authority) wired into `StorefrontPresentationNormalizer`: `header.design` is appended after `links` only when something survives.
- **TS twins** `header-design.ts` (web + storefront, byte-identical, test-enforced): vocabulary, `normalizeHeaderDesign`, `headerIsCompact`, `headerDesktopLayout`, `resolveHeaderDesign` (→ `data-hd` tokens `hh-c hh-t hl-2 hs-o hb-n hb-m hx-s hx-m`; defaults emit nothing). Both `config.ts` normalizers carry the key; one shared fixture `tests/Fixtures/presentation/header-design.json` pins all three.
- **Storefront**: `Header.tsx` (class maps per layout; `design` prop), `StoreBrand` `scale`, `(storefront)/layout.tsx` (compact via `headerIsCompact`, design prop), `publishedThemeAttrs` (merges `data-gt` + `data-hd`), `globals.css` "CUST-HV V7a — header design".
- **Canvas**: `StorefrontPreviewCanvas` header branches (sticky/relative, mobile logo-start, centered / two-row on desktop only — never inside the phone frame, row minimum height, logo scale), `StoreBrand` scale, `store-preview.css` chrome block (border + shadow — the *same* rule set as the storefront, parity-tested).
- **Editor**: `HeaderDesignPanel` (7 selects + reset) in the Header panel with AR/EN messages; every select starts on "Default", every change re-normalises, clearing the last field removes the key.

## Backward compatibility

Absent design ⇒ **byte-identical markup** (class strings pinned verbatim by tests) and no `data-hd`. An explicit all-defaults design renders the same geometry (proven in Chromium); the only markup difference is `min-h` instead of `h` on the identity row. `StoreBrand` without `scale` keeps its class string and order exactly. Old documents, old versions and the legacy `header.style` flow are untouched.

## Design Quality Pass — real Chromium, the production `Header`

`header-proof.render.test.tsx` renders the production `Header` (and the production `publishedThemeAttrs` / `publishedThemeStyle` wrapper) for 18 designs × AR RTL / EN LTR × wordmark / image logo; `scripts/header-proof/measure.mjs` measures them at 390 / 430 / 768 / 1024 / 1280 / 1440.

| Proof | Result |
|---|---|
| centered | brand centre = container centre (≤ 1.5 px) at every width from 768 — including 768–1023 with the menu button visible; search on the start side, actions on the end side (mirrored under RTL); one row |
| two-row | search below brand and actions, spans the container; brand on the start edge, actions on the end edge |
| compact | no utility strip; explicit `standard` overrides a legacy compact style |
| mobile logo-start | brand follows the menu button (mirrored); **no leak into desktop** (geometry equals the absent design) |
| height | header grows/shrinks by exactly +16 / −12 px desktop, +8 / −8 px phone |
| logo | image 28 / 64 px and wordmark 20 / 36 px desktop (24 / 48 and 18 / 30 phone) as chosen; the header contains it |
| sticky | `always`: stays at the top after scrolling and the offset clears the real header height (never absurdly larger); `off`: scrolls away and the offset is 0 |
| border / shadow | 0 / 1 / 2 px on every band; soft ≤ 4 px blur, medium ≥ 20 px |
| all | no horizontal overflow; no overlap among menu / brand / search / actions; explicit defaults == absent design |

**6 328 checks, 0 violations.** Negative controls fail as they must: with every `[data-hd]` rule stripped from the stylesheet → 440 violations; the absent design measured against every design's expectations → 712 violations. Evidence: `docs/plans/store/cust-hv-v7a/`.

Canvas parity is test-pinned: root `data-hd` equals the storefront wrapper's tokens, every layout's structure, sticky, the phone frame ignoring desktop-only layouts, and the border/shadow stylesheet block identical to the storefront's modulo scope.

## Tests

- PHP `StorefrontHeaderDesignTest` (shared fixture, absent ⇒ identical, key order beside legacy fields).
- storefront / web `header-design.test.ts` (fixture, config integration, idempotence, resolution, `headerIsCompact`), twin byte-identity, `header-design.canvas.test.tsx` (Canvas + editor panel + stylesheet parity), `Header.test.tsx` and `StoreBrand.test.tsx` additions (absent ⇒ exact legacy classes; one search instance in every layout).
- Env-gated Chromium proof (inert in CI).

## Limitations (stated)

- With `sticky: off` the mobile menu sheet still opens at the fixed `announcement + header-height` offset; scrolled past the header, a band of page shows above it (harmless, transparent overlay). Revisited with the V7c scroll controller.
- `height` is a minimum: content taller than the preset (large logo, long wordmark) grows the row; the sticky offset is a close upper-bound estimate, proven to clear the real header and never exceed it by more than 80 px.
- The "centered" spacer columns assume the menu button's 2.5 rem footprint (the existing control).
- The in-storefront customizer harness copy (`storefront/src/components/customizer`) is a dev mirror and is not kept in sync (as in earlier slices).

## Invariants

Tenant isolation, authN/authZ, Draft vs Published, concurrency, media ownership: **untouched** — the key rides the existing presentation document and its three normalizers; no endpoint, gate or persistence change. No arbitrary CSS/JS/HTML: enumerated tokens only. No financial behaviour ⇒ no journal entries.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
