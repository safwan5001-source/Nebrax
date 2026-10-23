# AWJ Storefront — Typography Library Expansion — Implementation Report

| | |
|---|---|
| **Branch** | `feat/storefront-typography-library-expansion` |
| **Base SHA** | `2e64c267fca8586e3ddb4f051e5d6a52e5f208d8` (`main`) |
| **Head SHA / PR URL** | code head `45f718acb919a33a96e937aea3a90ff7e513af05` (this report is the following commit) · https://github.com/safwan5001-source/Nebrax/pull/1681 |
| **Merge / Deploy / Production** | NOT PERFORMED |

## 1. Summary

The existing font catalogue (CUST-HV V5e-2c) was **extended, not replaced**. Four new families were appended:
**Almarai, Alexandria, Noto Kufi Arabic, Reem Kufi**. They appear in the existing *Global design → Typography*
selects (heading font and body font are already independent), are stored as catalogue keys in
`typography.headingFamily` / `bodyFamily`, and render through the existing token pipeline on the public storefront
and in the Customizer Canvas.

The three **Thmanyah** families (Sans, Serif Display, Serif Text) were added from the official files **on the project
owner's explicit instruction and responsibility, with NO written licence exception on file** — read §4 before merging.

## 2. Fonts: requested vs. existing vs. added

| Requested | Status | Catalogue key |
|---|---|---|
| Cairo | already present (paired with Geist) — not duplicated | `cairo-geist` |
| Tajawal | already present (paired with Geist) — not duplicated | `tajawal-geist` |
| IBM Plex Sans Arabic | already present — not duplicated | `plex-arabic` |
| Readex Pro | already present — not duplicated | `readex` |
| Almarai | **added** | `almarai` |
| Alexandria | **added** | `alexandria` |
| Noto Kufi Arabic | **added** | `noto-kufi` |
| Reem Kufi | **added** | `reem-kufi` |
| Thmanyah Sans | **added — owner-accepted licence risk (§4)** | `thmanyah-sans` |
| Thmanyah Serif Display | **added — owner-accepted licence risk (§4)** | `thmanyah-serif-display` |
| Thmanyah Serif Text | **added — owner-accepted licence risk (§4)** | `thmanyah-serif-text` |

Previously present (8, unchanged, same order and stacks): `cairo-geist`, `tajawal-geist`, `plex-arabic`, `noto-inter`,
`readex`, `rubik`, `el-messiri`, `amiri-lora`. Catalogue is now 15 entries. Keys are append-only (order is part of
the PHP/TS contract); a test pins the original eight.

Note on Cairo/Tajawal: they exist only as the Arabic half of a Geist pair. If a standalone "Cairo only" /
"Tajawal only" option is wanted, that is a product decision (it would change the Latin glyphs) and was not assumed.

## 3. Sources and licences of the added fonts

All four are Google Fonts families (licence `OFL`), loaded through `next/font/google` — downloaded at build time and
**served from the store's own origin**; the browser never contacts a font CDN. Availability (names, weights, subsets)
was read from Next.js's bundled `font-data.json`, and a production `next build` of the storefront compiled and
downloaded all four.

| Family | Weights | Subsets | Notes |
|---|---|---|---|
| Almarai | 400, 700, 800 (300 not loaded) | arabic, latin | No 500: weight 500 falls to the nearest cut per CSS matching |
| Alexandria | variable 100–900 | arabic, latin | |
| Noto Kufi Arabic | variable 100–900 | arabic, latin | |
| Reem Kufi | variable 400–700 | arabic, latin | Heading weight 800 renders as 700 (family maximum) |

The editor's weight controls (400/500/700/800 heading, 400/500/700 body) are independent of the family, as already
documented in V5e-2c; a weight a family lacks falls to its nearest real cut.

## 4. Thmanyah — why it was not added

**Update — official package reviewed.** The owner supplied `Thmanyah-Font-Family_2.zip` (official package: `LICENSE.pdf`,
`ترخيص خط ثمانية.pdf` (Arabic, prevails), a aesthetics guide, and for each of `thmanyahsans`, `thmanyahserifdisplay`,
`thmanyahseriftext`: Light / Regular / Medium / Bold / Black in OTF and WOFF2). The files are available and official.
The **licence in that package, however, does not cover this use**, and the zip contains no written exception:

| Licence clause (thmanyah's Font License, © 2026) | Effect on a multi-tenant storefront |
|---|---|
| *Prohibited:* "Redistribute, share, upload, **host**, or make the Font Software available for download on any website, **server**, digital platform…. May only be downloaded from the official website and used on your own devices and projects." | Committing the files to the repo (a hosted server) or serving them from AWJ's origin is hosting |
| *Prohibited:* "Make the Font Software available in any manner that allows end users or third parties to extract, download, access, reuse… **including through web embedding**" | A storefront `@font-face` serves a downloadable WOFF2 to every visitor |
| *Permitted:* embed in websites/web apps "**only as part of a compiled, packaged, or obfuscated product**" | A publicly fetchable `.woff2` URL is not an obfuscated package |
| *Non-exclusive, non-transferable*; "sell, rent, lease, **sublicense**" prohibited | Tenant merchants selecting the font for their own stores is arguably sublicensing |
| *Prohibited:* "Modify, edit, adapt… in any way" | Subsetting/re-encoding is modification (the supplied WOFF2 are usable as delivered) |
| "No amendment to, or exception from, this License is effective unless **made in writing and issued by the Company**." Exceptions: ask@thmanyah.com | The owner's reported permission only counts once issued in writing by thmanyah |

Conclusion: the standard licence permits AWJ itself to use the font in its own products, but **not** to host it for
third-party tenants' public storefronts. (An engineering reading of the licence, not legal advice.)

**Decision recorded:** the owner instructed that the files be added and stated they accept the responsibility. This
report does **not** claim a licence grant exists. The residual risk — demand for removal, licence revocation, and a damages
claim under the licence's Enforcement section (Saudi law, Riyadh courts) — is the owner's. **Recommended before merge/deploy:**
obtain the written exception from ask@thmanyah.com (hosting/CDN, public `@font-face` serving, tenant selection, repository storage).

**What was shipped:** the 12 official WOFF2 files (Regular 400 / Medium 500 / Bold 700 / Black 900 for each family; Light not
used), byte-for-byte unmodified (no subsetting or re-encoding), in `storefront/src/fonts/thmanyah/` and a duplicate under
`web/.../presentation/fonts/thmanyah/` for the Canvas; declared with `next/font/local`, `display: swap`, `preload: false`
(≈80 KB each, fetched only when the family is selected and used; verified: 0 font preloads, 12 `@font-face` rules emitted).
The two licence PDFs are in `docs/legal/thmanyah/`. Editor heading weight 800 renders as Black (900), the nearest heavier cut.

**Removal (one commit):** delete the three `localFont` declarations in `DocumentShell.tsx` and `fonts.ts`, the three keys from the PHP
list, both catalogue twins and the fixture, and the two `fonts/thmanyah/` folders. A store that saved a Thmanyah key then falls back to the
default font (the key is dropped); nothing else is affected. Because keys are append-only for backward compatibility, prefer
disabling over re-ordering.

## 5. Integration details

No new settings, controls, fields, APIs or migrations. The existing flow carries everything:

- **Contract (authority):** `StorefrontGlobalTokensNormalizer::FONT_FAMILIES` — four keys appended.
- **TS twins:** `storefront/.../font-catalogue.ts` and `web/.../presentation/font-catalogue.ts` (byte-identical; test-enforced) — four entries (name, kind, stack).
- **Loading:** `DocumentShell.tsx` (public storefront) and `presentation/fonts.ts` (Canvas) declare the four faces with
  `display: "swap"`, `preload: false`, Arabic+Latin subsets only. No `<link rel="preload">` is emitted for any of them.
- **Editor:** `GlobalTokensEditor` already lists `FONT_CATALOGUE` by *name — kind*; the new entries appear in both the
  Heading font and Body font selects, with "as today" (default) to reset. Live preview is the Canvas, which loads the real faces.
- **Application:** unchanged pipeline — `bodyFamily` becomes the theme wrapper's `font-family`; `headingFamily` emits `--gt-hf`
  for h1–h3. Elements inside the themed wrapper (nav, categories, product cards/PDP, prices, buttons, cart/checkout, copy)
  inherit it; per-section design overrides still win, as before.
- **Defaults:** the default font for new stores is unchanged; no field was added to any existing document.
- **Not touched:** ERP/admin fonts (`web/src/app/layout.tsx`), accounting, APIs, DB, published designs of existing stores.

## 6. Files changed

| File | Change |
|---|---|
| `app/Support/Commerce/StorefrontGlobalTokensNormalizer.php` | +7 keys in `FONT_FAMILIES` (4 Google + 3 Thmanyah) |
| `storefront/src/lib/presentation/font-catalogue.ts` | +4 keys/entries, doc comment |
| `web/src/modules/store-experience-builder/presentation/font-catalogue.ts` | byte-identical twin |
| `storefront/src/components/layout/DocumentShell.tsx` | +4 `next/font/google` faces |
| `web/src/modules/store-experience-builder/presentation/fonts.ts` | +4 faces (Canvas) |
| `tests/Fixtures/presentation/global-tokens.json` | +3 cases (new keys accepted; `thmanyah-*` dropped) |
| `storefront/src/lib/presentation/__tests__/font-catalogue.test.ts` | face count 8→12; append-only; unique names; no Thmanyah |
| `storefront/src/components/layout/DocumentShell.test.tsx` | `next/font/google` mock knows the 4 new exports |
| `web/vitest.setup.ts` | same mock update (44 canvas test files import `fonts.ts`) |
| `web/src/modules/store-experience-builder/__tests__/GlobalTokensEditor.test.tsx` | option list, names, no duplicates, no Thmanyah |
| `storefront/src/fonts/thmanyah/*.woff2`, `web/.../presentation/fonts/thmanyah/*.woff2` | 12 official files each (unmodified) |
| `docs/legal/thmanyah/` | the two licence PDFs from the official package |
| this report | new |

## 7. Tests and results (local)

| Check | Result |
|---|---|
| Storefront `vitest run` (all) | 3039 passed, 16 skipped — after the mock fix (first run caught the missing mock exports, fixed) |
| Storefront `src/lib/presentation` (incl. fixture parity, PHP-key parity, token↔stylesheet coverage, golden `pre-hv-golden`) | 1537 passed |
| Web `src/modules/store-experience-builder` (159 files) | 3011 passed |
| Fixture vs PHP normalizer (standalone PHP runner, no Laravel) | 43 cases, 0 failures |
| Storefront `tsc --noEmit`, `biome check` on changed files | clean |
| Storefront `next build` | compiled successfully; four new families' `@font-face` emitted; **0 font preloads** in prerendered HTML, none for the new faces |
| Web `tsc --noEmit` | one error in `SliderFields.test.tsx` — **pre-existing**, a file this change does not touch |
| Web `next build` | compiled successfully (also after the Thmanyah files were added) |
| Thmanyah | storefront build emits 12 `@font-face` (400/500/700/900 × 3), 0 font preloads; tests assert the files exist, are real `wOF2`, are `swap` + `preload: false`; fixture 44 cases / 0 failures; web editor 3012 passed; storefront presentation + layout 1703 passed |

Coverage of the requested list: old fonts retained (append-only test) · no duplicate options · new fonts visible
(editor test) · save/reload (existing token round-trip fixtures + new cases) · tenant isolation unchanged (no new
storage; settings stay in each store's own document) · legacy documents unchanged (absent keys ⇒ no token, golden test green).

## 8. Risks and notes

- **Laravel feature tests were not run locally** (`vendor/`/`artisan` are absent; the repo is a core that CI assembles). The PHP change is one
  constant, covered by the standalone fixture run and by the TS parity test that parses the PHP list. CI (`StorefrontGlobalTokensTest`,
  `PreHvBackwardCompatibilityTest`, `ButtonTokensPublishGateTest`) is the gate. No accounting/journal code is touched, so there are no journal entries to present.
- **Deploy order:** deploy the backend (PHP accepts the keys) before the storefront/web that offers them; the reverse would let the editor save
  keys an older backend drops. The reverse direction is safe (older frontend never emits them).
- **Rollback:** a store that saved a new key and is rolled back to older code loses only that font choice (dropped → default); nothing else changes.
- **Page weight:** four more `@font-face` rule sets ship in the document CSS (files are fetched only when used) — same trade-off already accepted in V5e-2c.
- **Real-browser/mobile visual proof** (Playwright on Canvas, AR/EN × desktop/mobile) was not produced in this slice; the unit/build evidence
  above proves loading and wiring, not visual quality. Recommended before merge, using the existing `cust-hv-v5e2a-canvas-proof` harness.
- Alexandria/Noto Kufi use variable files (larger per file than a static cut) but are fetched only when selected.

## 9. Not completed

- A written Thmanyah licence exception (shipped on owner responsibility instead, §4).
- Standalone Cairo / Tajawal entries (already offered as Geist pairs; not duplicated).
- Visual browser proof and mobile screenshots.

## 10. Suggested next step

Obtain Thmanyah's written exception before merge/deploy; in parallel run the existing Canvas
proof harness with the new faces at 390/1440 in AR and EN.
