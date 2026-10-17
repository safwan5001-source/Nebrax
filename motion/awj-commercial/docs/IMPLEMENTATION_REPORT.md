# AWJ 15-second brand film — Implementation report

## 1. Creative concept

**«معاملة واحدة» (One Sale).** One fictional cash sale — 4 × زيت محرك 5W-30 for
**1,250.00** including 15% VAT — travels through AWJ without cuts to unrelated screenshots:
POS cart → thermal receipt → tax invoice → stock movement → journal entries → dashboard KPI.
The film moves from **fragmentation** (dark macro ticker) through **connection** (the sale)
and **control** (the whole workspace as one plane) to **أَوْج**, where one horizon line
becomes the brand's baseline and the wordmark rises from behind it. *Awj* means apex, so the
brand reveal is literally the line reaching its peak.

Full treatment: `docs/CREATIVE_TREATMENT.md`. Sound: `docs/SOUND_CUE_SHEET.md`.

## 2. Final storyboard (frames @ 60 fps)

| Frames | Beat | Hand-off into the next beat |
|---|---|---|
| 0–72 | Six ticker bands race (directional blur), part for «أعمالك كثيرة.», lock onto one tab stop; «لكن إدارتها واحدة.» | Bands squeeze into a centre slit |
| 76–102 | The slit *is* the POS cart line at 2.6× and opens to the full POS | Same object, no cut |
| 96–186 | Pull-back; tile selected; qty 1→4 with taps; totals roll 312.50 → 625.00 → 937.50 → 1,250.00; pay → «تم الدفع» | The 1,250.00 total leaves the POS as a carried element |
| 186–238 | Total flies onto the rising receipt; receipt prints line by line; QR draws | Same paper |
| 238–282 | Receipt **morphs** into the A4 tax invoice (paper, item row and total interpolate) | Camera push |
| 282–343 | Push to total → whip to quantity (directional blur) → isolate «4» → accelerating dive | Glyph match-cut |
| 343–398 | Out of «4» comes «−4» in the stock ledger; rows re-sort; 128 → 124; cost 720.00 highlights | 720.00 drags a wipe |
| 398–474 | 720.00 lands in the cost entry and splits to credit; sale entry snaps in; Σ مدين / Σ دائن roll to 1,250.00 and lock | Totals merge to the centre |
| 474–496 | The balanced amount shrinks into one point | The point is the chart's last point |
| 496–548 | The point rises (+1,250.00), camera pulls back through the dashboard; four KPIs update from the sale | Camera slides the dashboard aside |
| 548–606 | «كل شيء متصل.» / «لحظة بلحظة.»; right-to-left sweep flips AWJ to dark theme | The dashboard is one tile of a plane |
| 606–736 | Lateral track across POS / invoices, 2.5D pull-out over 6 surfaces; «الصورة كاملة. والقرار أوضح.» | Aperture closes onto a line |
| 736–900 | Line retracts to the baseline; أَوْج rises; AWJ; «أعمالك. في أَوْجها.»; quiet hold | — |

## 3. Financial truth of the demo data

All figures reconcile (halalas internally, `src/config/demo-data.ts`):

| Operation | Debit | Credit | Amount |
|---|---|---|---|
| Sale (JE-2026-01872) | 1110 الصندوق | — | 1,250.00 |
| | — | 4110 إيرادات المبيعات | 1,086.96 |
| | — | 2120 ضريبة مخرجات | 163.04 |
| Cost (JE-2026-01873) | 5110 تكلفة البضاعة المباعة | 1140 المخزون | 720.00 (4 × 180.00) |

KPI deltas shown: sales +1,250.00 · cash +1,250.00 · stock value −720.00 · receivables 0.00.
Stock ledger: 88 → 86 → 80 → 128 → **124**. These are illustrative visuals only — nothing in
the film posts to, reads from, or changes the AWJ ledger.

## 4. What was implemented

- Isolated Remotion project `motion/awj-commercial/` (no imports from `web/`, no app code touched).
- Composition `AwjCommercial`: 1920×1080, 60 fps, 900 frames.
- Faithful recreations of AWJ surfaces built from product tokens: POS, receipt/tax invoice,
  stock movement, journal entries, dashboard (sidebar/top bar/KPI cards/chart/latest
  invoices), invoice register, storefront — light **and** dark themes.
- Motion primitives: virtual `Camera` with `project`/`unproject` for cross-world hand-offs,
  `Carrier`, per-digit `RollingNumber`, whole-word `Rise` mask, `DirBlur`, keyframe `track`
  and log-space `trackLog` zoom, distinct easing families per object mass.
- Review tooling: `scripts/stills.mjs` (bundle once, render any frames), `scripts/sheet.py`.

## 5. Files created / changed

All new, under `motion/awj-commercial/`:
`package.json`, `package-lock.json`, `tsconfig.json`, `remotion.config.ts`, `.gitignore`,
`README.md`, `docs/{CREATIVE_TREATMENT,SOUND_CUE_SHEET,IMPLEMENTATION_REPORT}.md`,
`public/fonts/*` (IBM Plex woff2 + OFL licences), `scripts/{stills.mjs,sheet.py}`,
`src/**` (config, lib, primitives, ui, scenes, Root, index, AwjCommercial).
No file outside `motion/` was modified.

## 6. Source assets reused

| Asset | Source |
|---|---|
| Colour tokens (light/dark) | `web/src/app/globals.css`, `DESIGN_SYSTEM.md` |
| Wordmark «أَوْج» / «AWJ» | `web/src/lib/brand.ts`, `web/src/components/layout/awj-logo.tsx` (typographic wordmark, Plex Sans Arabic Bold, primary; Latin tracking 0.08em) — reproduced, not redrawn |
| Typography | IBM Plex Sans Arabic + IBM Plex Mono (same families as `web/src/app/layout.tsx`), bundled from `@fontsource` |
| Money format | `web/src/lib/money.ts` (`1,250.00` + U+20C1) |
| KPI card / POS tile / sidebar grammar | `web/src/components/dashboard/kpi-card.tsx`, `web/src/components/pos/pos-product-tile.tsx`, Module Map in `CLAUDE.md` |
| Saudi Riyal outline | `@emran-alhaddad/saudi-riyal-font` (OFL-1.1) glyph path — Plex has no U+20C1 glyph |

## 7. Rendering configuration

`remotion.config.ts`: PNG frames → H.264 (High), CRF 14, `yuv420p`, concurrency 4.
Command: `npm run render` → `out/awj-commercial-1920x1080-60fps.mp4`.

## 8. Checks performed

| Check | Result |
|---|---|
| `tsc --noEmit` | pass |
| ffprobe | h264 High · 1920×1080 · 60/1 · **900 frames** · 15.000 s · yuv420p · ~5.3 Mb/s · 9.9 MB |
| `blackdetect` / `freezedetect` over the encode | no black frames, no unintended freezes |
| Frame review — PASS 1–2 (36-frame contact sheet) | found & fixed: Rise masks leaking Arabic dots of hidden lines; journal columns mis-aligned by `flex-end` in RTL (carriers landed off-target); ج descender clipped by the brand mask; tanween clipped at band edges; blur over-applied to a push; receipt under-framed; Act-4 plane too high |
| Frame review — PASS 3–6 (transition frames from the *encoded* MP4) | carrier continuity POS→receipt→invoice (added `unproject`), glyph match-cut 343, wipe, lock, collapse→chart point, theme sweep, aperture; fixed lingering totals rule at 490 and fatha tip peeking above the baseline at 760–780 |
| Arabic shaping / RTL | whole-word masks only, verified at 34, 570, 720, 899 |
| Network at render | none (fonts and assets bundled) |
| Backend suite (`php artisan test`, repo rule before commit) | see PR description |

## 9. Limitations

- **Silent master.** Picture is cut to the cue sheet; music/SFX are not produced.
- UI surfaces are **high-fidelity recreations** from product tokens and components, not live
  screen captures; product images in POS/store tiles are the product's own empty image slots.
- The ZATCA QR is a deterministic visual pattern, not a scannable code.
- 9:16 is architected for (world/camera separation) but not cut.
- The final render was made with Playwright's headless shell in the cloud container; locally
  Remotion downloads its own Chrome Headless Shell.

## 10. Recommended next polish

1. Commission the score/SFX against the cue sheet and mix to −14 LUFS (web) / −24 LKFS (broadcast).
2. Cut the 9:16 version: re-key cameras so the carried value stays in the upper third.
3. Replace empty product slots with approved product photography.
4. Optional 0.5 s end-card variant with URL/CTA for paid social.
5. A/B the campaign line: current «أعمالك. في أَوْجها.»; documented alternative
   «كل عملية. في مكانها.» (stronger on the connection idea, weaker on the brand name) —
   not used; the brief's line was kept.

## 11. Git

| | |
|---|---|
| Branch | `motion/awj-commercial-15s` |
| Base SHA | `fd2ad2098d6e51e1fd51abeed34ff926f1cbae74` |
| Head SHA | see PR (commit containing this report) |
| PR | see PR link in the session summary |

Not merged. Not deployed.
