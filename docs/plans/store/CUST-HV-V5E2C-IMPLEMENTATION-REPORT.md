# CUST-HV V5e-2c — Curated, self-hosted font catalogue (heading / body families) — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V5e-2c** — closes V5e-2 (V5e-2a global tokens ✓ → V5e-2b buttons ✓ → **V5e-2c font catalogue**) |
| **Branch** | `cust-hv/v5e2c-font-catalogue` (stacked on V5e-2b) |
| **Authority** | V0 §5.1 (`headingFamily` / `bodyFamily`), §5.2 (catalogue ≥ 6 Arabic+Latin entries, self-hosted, subsetted, OFL-class only, `font-display: swap`, loaded only when selected, no third-party CDN), §5.4 (custom fonts reserved, **not enabled**), N-5 (catalogue verified at slice time), §2.2 |
| **Depends on** | V5e-2a (`typography` group, `data-gt` mechanism) · H3-2 (`fontPreset`, `next/font` strategy) |

---

## Implemented

### The catalogue — eight entries, every one verified at slice time (N-5)
| Key | Faces | Kind |
|---|---|---|
| `cairo-geist` *(legacy `fontPreset`)* | Geist (Latin) + Cairo (Arabic) | sans |
| `tajawal-geist` *(legacy `fontPreset`)* | Geist + Tajawal | sans |
| `plex-arabic` | IBM Plex Sans Arabic (Arabic + Latin) | sans |
| `noto-inter` | Inter (Latin) + Noto Sans Arabic | sans |
| `readex` | Readex Pro (Arabic + Latin) | sans |
| `rubik` | Rubik (Arabic + Latin) | sans |
| `el-messiri` | El Messiri (Arabic + Latin) | display |
| `amiri-lora` | Lora (Latin) + Amiri (Arabic naskh) | serif |

**Licence check (done now, against each family's upstream `METADATA.pb` in `google/fonts`):** every family — Cairo, Tajawal, Geist, IBM Plex Sans Arabic, Noto Sans Arabic, Inter, Readex Pro, Rubik, El Messiri, Amiri, Lora — is `license: "OFL"`. **Availability** (names, subsets, weights) was checked against the Next.js bundled Google Fonts metadata, and a production `next build` of the storefront compiled with all eight pairs (it downloads and validates every face).

### Contract (PHP authority + both TS twins, the shared fixture, now 29 cases)
`typography.headingFamily` / `typography.bodyFamily` — **catalogue keys only**. A family name, a CSS stack, `custom:<mediaId>` (a merchant upload — reserved by V0 §5.4, not enabled), a list/object or injected CSS is dropped. `font-catalogue.ts` ×2 is byte-identical (test-enforced); a test parses the PHP `FONT_FAMILIES` list and asserts it equals the TS keys, in order. `fontPreset` is unchanged and maps onto the first two keys (a test asserts their stacks equal `fontPresetFamilyStack`), so a document without `bodyFamily` renders exactly as before.

### Loading — "only when selected", proved
Every face is self-hosted by `next/font` (fetched at build time, served from the store's origin; the browser never contacts a font CDN — a test fails if the shell references `fonts.googleapis` / `@import`), subsetted to Arabic + Latin only, `display: swap`, and declared `preload: false`, so **no preload link is emitted** and the browser requests a face's file only when the resolved `font-family` is used by rendered text. A Latin face paired with a separate Arabic face names it as its `fallback` (the existing Geist/Cairo technique) so Arabic never falls to a local Arial. Proven in a real browser: with `headingFamily: amiri-lora` + `bodyFamily: readex` the Canvas loads Readex and Lora faces and **none** of Rubik / Plex / El Messiri / Noto Sans Arabic / Tajawal; with no font token none of the catalogue faces load at all.

### Rendering
`bodyFamily` becomes the theme wrapper's own `font-family` (`publishedThemeStyle` and the Canvas root; it wins over `fontPreset`); `headingFamily` emits `--gt-hf` + the token `hf` → `[data-gt~="hf"] :where(h1, h2, h3) { font-family: var(--gt-hf) }`, with the same specificity discipline as the other global tokens (a section design still wins). The stylesheet-coverage test already guarantees the token and the variable are consumed by both stylesheets.

### Merchant UI
ThemePanel → Global design → Typography: **Heading font** and **Body font** selects listing each family by name and kind (sans / display / serif), an "as today" choice, and a note that the fonts are hosted on our servers and the body font overrides the identity font above. AR/EN.

---

## Proof

| Gate | Result |
|---|---|
| PHP | `StorefrontGlobalTokensTest` on the 29-case fixture (catalogue keys, legacy keys, name/CSS/custom upload/list rejected, canonical order) |
| Twins | fixture ×2 · catalogue test (≥ 6 entries, unique keys, PHP list parity, legacy stacks identical, only keys resolve, every referenced `--font-*` variable is declared in **both** the storefront shell and the Canvas fonts module, each catalogue face is `swap` + `preload: false` + Arabic/Latin only, no CDN) · token↔stylesheet coverage (now includes `hf` / `--gt-hf`) · twin files byte-identical |
| Real browser (Canvas, `cust-hv-v5e2a-canvas-proof.spec.ts`, 14) | AR/EN × 390–1440: headings resolve to the Lora/Amiri pair and the body to Readex (the real `next/font` faces, not a fallback); **only the chosen faces load** (and none without a token) |
| Build | storefront `next build`: compiled successfully with the catalogue (every family name / weight / subset validated and downloaded by `next/font`) |
| UI | `GlobalTokensEditor` — every catalogue key offered with name + kind, choosing writes the key, the default removes the group |

## Design Quality Pass
Evidence `docs/plans/store/cust-hv-v5e2c/` (Canvas, AR 1280 and EN 1280 with `amiri-lora` headings and a Readex body): Arabic headings render in the naskh serif with the underline style and the body in Readex; Latin headings in Lora; both scripts keep the RTL/LTR start edge, nothing overflows at any of the six widths, and the soft pill button stays legible on the new body face. Weights a family lacks (Amiri has 400/700) fall to the nearest available cut — the editor's heading-weight control remains independent of the family.

## Invariants
| Invariant | Status |
|---|---|
| Tenant isolation / RBAC / Draft-Published / revision concurrency | Untouched — validated additive keys in the existing document; PHP accepts them before any UI writes them |
| Backward compatibility | Absent keys ⇒ no token, no variable, no rule; `fontPreset` renders as before; version stays 3 |
| Performance / privacy | No third-party font request; no `<link rel="preload">` for any catalogue face; a file is fetched only when its family is used; ~8 extra `@font-face` rule sets in the document CSS (measured by the build, no extra network) |
| Commerce / accounting | Untouched |

## Limitations / next
- A merchant **font upload** (`custom:<mediaId>`) stays deferred (V0 §5.4): it needs the proven media domain `storefront-fonts`, `woff2` validation, licensing acknowledgement and a CSP `font-src` review — its own Evidence Gate, later in CUST-HV.
- Per-section font families are deliberately not offered (V0 §5.2: hierarchy and performance).
- `@font-face` declarations of the eight pairs ship in every document's CSS (the files do not); making even the CSS conditional would need a per-route font module split and is deferred unless measurement shows a cost.
- **V5e-3** (separators, overlap presets, one-time reveal) is next.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
