# CUST-HV V6b-5 — Real-pixel proof of picture backgrounds — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V6b-5** — closes V6b (V6b-1 evidence ✔ → V6b-2 contract + gate ✔ → V6b-3 render ✔ → V6b-4 inspector ✔ → **V6b-5 real-pixel proof**) |
| **Branch** | `cust-hv/v6b5-real-pixel-proof` (from `main` after V6b-4 #1280) |
| **Authority** | V0 §3.2.1 (media background proof) · §4.5 (contrast) · AMEND-8 / AMEND-9 |
| **Scope** | Verification only. **No product behaviour changes**: no contract, API, migration, renderer or gate change. New: one env-gated PHP exporter test, one env-gated storefront render test, two Node scripts, evidence. |

---

## Why this slice exists
V6b-1…4 prove contrast from **measured evidence** and decide with one shared engine, but until now the evidence and the
renderer had been checked separately: V6b-3's browser proof used synthetic SVGs with hand-written bounds. V6b-5 closes the loop
on the **real chain**: upload → real ladder (WebP + JPEG) → real evidence → real publish-gate verdict → real
`publishedNodes` / `SectionBackdrop` / compiled storefront CSS → Chromium → **the actual pixels behind the text**.

## What was built (all inert in CI unless the env var is set)

| Piece | Role |
|---|---|
| `tests/Feature/StorefrontMediaPixelProofExportTest.php` (`STOREFRONT_PIXEL_PROOF_DIR`) | Generates photograph-like images (gradient + film grain + hard edges, bright specks, windows, tree silhouettes, a hard black\|white split, a portrait), uploads them through the **real API pipeline**, creates **real crop derivatives**, and exports the files the server actually serves, the widened bounds (`StorefrontMediaContrastEvidence`) and the **publish-validator verdict** for 28 configurations. |
| `storefront/scripts/pixel-proof/build-css.mjs` | Compiles `globals.css` exactly as the app does (Tailwind v4 / PostCSS). |
| `storefront/src/lib/presentation/pixel-proof.render.test.tsx` (`PIXEL_PROOF_DIR`) | Renders each case through the real `publishedNodes` (LTR + RTL), with the server's files and bounds. Also renders the **negative control** (below). |
| `storefront/scripts/pixel-proof/measure.mjs` | Chromium measurement; exit 1 on any violation. `--control` runs the negative control; `--shots <dir>` saves evidence screenshots. |

Run (`PIXEL_PROOF_CHROMIUM=<path>` selects a Chromium binary when the installed Playwright revision differs from the browser cache; the script imports the declared `@playwright/test`): `STOREFRONT_PIXEL_PROOF_DIR=/tmp/p php artisan test --filter=StorefrontMediaPixelProofExportTest` →
`node storefront/scripts/pixel-proof/build-css.mjs /tmp/p` → `PIXEL_PROOF_DIR=/tmp/p npx vitest run src/lib/presentation/pixel-proof.render.test.tsx` →
`node storefront/scripts/pixel-proof/measure.mjs /tmp/p [--control]`.

## What is asserted — per case × 6 widths (390 · 430 · 768 · 1024 · 1280 · 1440) × AR RTL + EN LTR

1. **Decision parity** — the storefront paints a picture **iff** the publish gate called the configuration provable. When painted, the `<picture>` must have **chosen the right file for the viewport** (phone picture at ≤ 767 px, default above — asserted from `currentSrc`). When rejected, the section must restore **both the legacy surface and the legacy text colours**: no `mbg`/`ovl` tokens, the legacy gradient still present, heading colour back to the legacy white, and the legacy heading/supporting line measured on real pixels (≥ 4.5 : 1).
2. **Readability on real pixels** — glyphs hidden, every pixel under the heading and the supporting line is read back; the WCAG ratio of the text colour against **that pixel** (alpha-composited) must be ≥ 4.5.
3. **Evidence brackets the pixels** — the min/max of the backdrop as Chromium composites it (decoded WebP/JPEG + overlay) must lie inside the interval the bounds + overlay predict — the interval the gate reasoned over.
4. **Layout** — no horizontal overflow; heading is the topmost element at its centre; backdrop covers its section; image actually loaded.

## Result

| | |
|---|---|
| Configurations | **28** (4 photographs × 5 overlays, picture + phone picture, two crop derivatives, an asset with no evidence, a provable default with an unprovable phone picture) |
| Checks | **336** (28 × 6 widths × 2 directions) |
| Painted (gate: provable) | 156 — worst pixel contrast **heading 7.47 : 1, supporting line 7.56 : 1** (≥ 4.5 required) |
| Fell back (gate: rejected) | 180 — all with the legacy surface, none painted |
| Decision-parity violations | **0** |
| Readability violations | **0** |
| Evidence-bracket violations | **0** (rendered pixels never left the predicted interval; tolerance was not needed) |
| Layout violations | **0** |

Per-case results: `cust-hv-v6b5/pixel-proof-summary.json`. Screenshots (published hero, LTR 1280 and RTL 390):
`cust-hv-v6b5/*.png` — e.g. `street_black-70`, `snow_white-60` (pale photo + white wash ⇒ automatic dark text), `dusk+portrait_black-70`
(phone picture), `split-left_none` (a **real crop derivative** proven on its own evidence), `dusk_black-40` (rejected ⇒ legacy gradient).

### Flows covered
- **Overlay rescue** — the same photo is rejected at no/40 %/default-role-50 % overlay and accepted at 70 % black or 60 % white (`dusk`, `snow`, `street`, `split`).
- **Derivative-cropped frame** — `split-left` (left 40 % of a black\|white picture) is provable with no overlay because its derivative's own evidence is dark (AMEND-8); `dusk-mid` is rejected bare and accepted with 70 %.
- **Evidence missing** — an asset without evidence (`nodata`) is rejected, and as the phone picture beside a provable default it still rejects the whole background (`dusk+nodata`); the storefront falls back in every case.
- **RTL** — the same page mirrored: text flips to the other side of the photograph; the whole-frame (position-independent) proof is exactly what keeps this safe (see the control).

### Negative control — the measurement can fail
`measure.mjs --control` renders the **rejected** configurations with deliberately false (too dark) bounds. The storefront trusts the
evidence it is handed and paints them, and the same pixel measurement then **catches 17 of 28 renders** (14 rejected configurations × 2 directions) as unreadable (worst down to **1.04 : 1**);
the remaining 11 are legitimately dark where the text happens to sit in that direction. Example: `split/black-40` is 20 : 1 in LTR
(text over the dark half) but **2.96 : 1 in RTL** (text over the bright half) — which is precisely why the gate refuses a
position-dependent argument and judges the whole frame.

## Findings (no product change made — for the owner)

| # | Finding | Evidence | Disposition |
|---|---|---|---|
| F-1 | **Whole-frame evidence + encoding margin saturates on any photograph that has both a highlight and a shadow.** Bounds came out ≈ `[0,0,0]…[255,251,255]` for every busy photograph (grain/specks/hard edges), so only strong overlays pass (≈ 70 % black or 60 % white); the picture is then largely muted (see `street_black-70.ltr.1280.png`). | `manifest` bounds of `dusk`, `snow`, `street`, `split`; screenshots | This is the frozen V0/V6b-1 contract working as designed (conservative, position-independent, fail-closed). V6b-1 already lists a tighter **regional** proof as a possible later refinement (new `basis`, no version change). Recommend scheduling it as an optional slice if merchants find overlays too heavy; **not** changed here. |
| F-2 | The default overlay (`role: overlay`, 50 %) is rejected for every busy photograph. | `*/role-50` rows | The inspector already explains this and offers "Add a darker overlay" (V6b-4); the verdict never claims legibility. No change. |
| F-3 | The generic measurement needed an inset past the section's rounded corners (page background shows there). | measurement bug found and fixed in `measure.mjs` | Fixed in the script. |

## Limitations (stated, not hidden)
- **Canvas** is not re-measured in pixels in this slice: it shares the identical backdrop CSS block (parity-tested) and the byte-identical resolver twin, and its DOM/decision parity is covered by `StorefrontPreviewCanvas.background` tests (V6b-4). A pixel-level Canvas run would need the signed-URL layer mocked and adds little beyond that.
- The photographs are **synthetic photograph-like** (deterministic, generated in the test); they exercise the same encoder/decoder/colour paths as real uploads and include the hostile cases (grain, 1–2 px bright specks, hard edges, chroma-bleed colours), but they are not licensed stock photos.
- Chromium only (the CI browser); other engines' decoders are covered by the encoding margin, not measured.

## Verification
| Gate | Result |
|---|---|
| Exporter (real pipeline) | 1 passed (240 assertions) |
| Browser proof | 336 checks, **0 violations**; negative control 17 / 28 renders caught |
| Storefront suite | `src/lib/presentation` 545 passed (+1 skipped: the env-gated render test) · biome clean on new files · no tsc errors in new files |
| Full `php artisan test` | see PR (new exporter test is skipped without the env var) |

## Invariants
Tenant isolation, Draft/Published, concurrency, media ownership, accounting: **untouched** (verification code only; the exporter runs on the test database with in-memory R2). Backward compatibility: no runtime change. No financial behaviour ⇒ no journal entries.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
