# VD-5 admin-side QA — evidence index

Stack: local (admin :3101, Laravel :8000 on Postgres, storefront S2 :3103). Tested base: stack code = local `main` 8b2b42438; spec worktree branch `qa/vd-5-web-e2e` (commit caea80705, based on origin/main ee36573f4).
Harness scripts: <local stack dir>/harness-web/ (w1..w10, extract.mjs, snap.mjs, measure.mjs). Network logs: network/*.jsonl (method, path, auth-prefix, status). Owner's reference images: not in the repo, unverified; the VD-3 UX requirements doc was used as the reference.

| ID | Result | Evidence |
|---|---|---|
| W-1 editor matrix (2 editors x 3 tabs x ar/en x 390/768/1280/1440 x light/dark = 96) | PASS (editor); picker dialog FAIL (D-W-6) | w1-results.json, shots/w1/, network/w1-*.jsonl, shots/w10/picker-mobile.png |
| W-2 12 shapes x image/icon/text | PASS (list 36/36, editor 36/36) | w2-results.json, shots/w2/ (contact sheets editor-preview-*.png, list-*.png) |
| W-3 persistence / inheritance | PASS 15/15 | w3-results.json, network/w3.jsonl (image framing/alt persistence: committed spec test 1) |
| W-4 negative states | PASS except W-4.13 (D-W-2), W-4.14 (D-W-3); INFO 6e (D-W-5), 10b (D-W-7) | w4-all-results.json, w4c-results.json, w4-roles.json, w10-results.json, shots/w4/, shots/w10/, network/w4c.jsonl (w4 main-run jsonl lost: the run crashed after N10; its PASS/FAIL lines were recovered from the console log) |
| W-5 concurrency | PASS 10/10 (409, 428, simultaneous save) | w5-results.json, shots/w5/, network/w5-all.jsonl |
| W-6 keyboard | 30/34 PASS; FAIL en/ar .11 (D-W-4), en/ar .16 (D-W-8) | w6-results.json (includes focus orders), shots/w6/ |
| W-7 builder, two sections of one dimension | PASS 21/21 | w7-results.json, w7-storefront.json, shots/w7/, network/w7.jsonl |
| W-8 parity builder panel vs real storefront (17 docs x ar/en x 390/1440 = 68) | container-level PASS; divergences listed | w8-parity.json, w8-storefront.json, w8-builder.json, shots/w8/pair-*.png |
| W-8b editor tile vs storefront tile (8 values) | PASS (only transform-origin px differs because the editor frame is smaller, see D-W-1) | w8b-tile-parity.json, shots/w8b/ |
| W-9 network | PASS 10/10 | w9-results.json, w9-census.json, network/*.jsonl |

Spec: web/e2e/vd5-visual-dimensions.spec.ts, 3 green runs in a row on the final file (3 tests each). spec-run-annotations.json: stale write = 409 (identity exists), 428 (first write).
Console: no errors/warnings other than the known next-intl dotted-key overlay; no hydration warnings in any run.

## Defects
- D-W-1 medium: editor preview caps md and lg frames at the cell width (64.7px) so Medium and Large look identical (Small is 56px). PreviewPanel grid cell 76px in a 17rem aside.
- D-W-2 low: quick-add then "Customize appearance" clicked before the list reload ends closes everything, the editor never opens (facets-panel.tsx finish()/editorMissing). Repro: delay GET facets by 2.5s (w10).
- D-W-3 medium (pre-existing, shared media library): GET storefront-media?q= answers 500 on PostgreSQL (`ESCAPE '\\'` with bound `?`), the picker search box shows "Couldn't reach the media library". StorefrontMediaController::index.
- D-W-4 medium: Escape with unsaved edits does nothing (no confirm, editor stays). The nested Dialog registers its document keydown during the same Escape event and closes itself; the X and Cancel buttons work. FacetVisualEditor.tsx + components/ui/dialog.tsx.
- D-W-5 low: media-probe failure (429/5xx/offline) is shown as "media library is not enabled for this account" and cached 60s (use-media-capability.ts).
- D-W-6 low: media picker on a phone: Use buttons 36px, search 40px, checkbox 16px (27 elements under 44px); shared MediaPicker.
- D-W-7 low: upload rejection text is the server's Arabic inside the English UI with garbled bidi; the "too large" case shows "The upload failed. Try again." (here PHP upload_max_filesize=2M on this stack, so the app's 5MB rule was not reachable; no client size check although max_bytes is known).
- D-W-8 low: after Escape closes the media picker focus goes to <body> (MediaDialog).
- D-W-9 medium: builder panel preview, desktop device, narrow panel: overlay captions collapse into a thin vertical bar (editorial-portrait D08, D14). DiscoveryPanelPreview OVERLAY_LABEL w-fit.
- D-W-10 low (by design, documented in VD-4c): panel preview uses sample pictures/looks and lists values the channel hides (8 vs 7 items; no text-only values; counts hidden). 
- D-W-11 improvement: Data tab (names, active) has no version check, last writer wins silently.
- D-W-12 medium (storefront side): /sa/en discovery sections showed the Arabic value names although meta carries name_en. Reported fixed by storefront PR #1521; not re-verified here (stack storefront not re-synced).

## Not verified
Real screen reader; physical iOS safe area; real R2/CDN; real PHP upload limits; the 5MB rule; owner reference images.
