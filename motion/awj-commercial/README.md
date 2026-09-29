# أَوْج / AWJ — «معاملة واحدة» · 15-second brand film

Standalone Remotion 4 + React 19 + TypeScript project. It has **no imports from `web/`, no
API calls, and no network access at render time**. Fonts (IBM Plex, OFL) and the Riyal-sign
outline (OFL) are bundled locally.

| | |
|---|---|
| Composition | `AwjCommercial` |
| Size / rate | 1920 × 1080 · 60 fps |
| Duration | 900 frames = 15.00 s |
| Output | H.264 High, yuv420p, CRF 14 |

## Preview

```bash
cd motion/awj-commercial
npm ci
npm run studio          # Remotion Studio at http://localhost:3000, scrub frame by frame
```

## Render

```bash
npm run render          # → out/awj-commercial-1920x1080-60fps.mp4   (~3.5 min on 4 vCPU)
npm run typecheck
```

In a container without Remotion's own Chrome, point it at an existing headless shell:

```bash
AWJ_CHROME=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell npm run render
```

Frame-by-frame review (bundles once and renders any frames you list):

```bash
AWJ_CHROME=… node scripts/stills.mjs 84 186 282 340 398 474 494 586 736 899
python3 scripts/sheet.py 5   # → out/sheet.jpg (needs Pillow)
```

## Structure

```
src/
  config/     timeline.ts (every beat as an absolute frame) · theme.ts (tokens from globals.css)
              demo-data.ts (the one reconciled demo sale, in halalas)
  lib/        motion.ts (easing families, keyframe tracks, log-space zoom) · fonts.ts
  primitives/ Camera (+ project/unproject) · Carrier (the travelling value) · RollingNumber
              Rise (baseline mask for whole Arabic words) · DirBlur · Riyal · Qr
  ui/         Faithful AWJ surfaces: PosScreen · DocMorph (receipt → invoice) · InventoryScreen
              JournalScreen · Dashboard (+ Sidebar/TopBar) · Panels (invoice register, storefront)
  scenes/     S1Hook · S2Sale · S3Ledger · S4Control · S5Brand
docs/         CREATIVE_TREATMENT.md · SOUND_CUE_SHEET.md · IMPLEMENTATION_REPORT.md
```

## Adapting to 9:16

Each UI surface is a fixed 1920×1080 *world*; scenes only decide how a `Camera` frames that
world and where screen-space type sits. A 1080×1920 cut needs new camera keyframes and type
positions (in `scenes/*`), not new UI. `Camera`, `project`/`unproject` already read the
composition size from `useVideoConfig()`.
