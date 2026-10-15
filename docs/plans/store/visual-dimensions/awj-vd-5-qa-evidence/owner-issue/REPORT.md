# VD-5 owner-reported defect: Discovery preview shows placeholders instead of the real value images

Branch `fix/vd-5-builder-preview-real-visuals` (worktree `<local path>`), commit `798ff3879`, base `origin/main` ce573241a. Not pushed, no PR. Web-only change (10 files), no API/DB/permission change.

## 1. Summary
The owner's images were saved correctly and the admin API returned them; the builder never used them. The Discovery panel preview invented every value's look: real value names/counts, but pictures were cycled placeholders (mountain gradients, heart/star/flower fallback icons) and shapes were the section default. It also labelled that only in a tiny grey caption. The "حسب القالب" control is not disabled; it is a pressed "inheritance state" button that does nothing when pressed again, with a label that reads like a template name.

## 2. Data-flow table (observed in Chromium, network log in `json/before-preview-facts.json`)
| Source | Endpoint / field | Consumer | Before | After |
|---|---|---|---|---|
| Dimension values (CommerceFacetValue `visual`, normalized) | `GET /commerce/workspace/facets` -> `values[].visual`, `visual_version` | `loadFacets` -> `Facet.values[].visual` -> `previewSource` | ignored (no `visual` read) | resolved per value + dimension `defaults` through the shared chain |
| Signed thumbnails | same list -> `values[].visual_preview.thumb_160/320` (`/api/commerce/workspace/storefront-media/{media}/variants/thumb-*.webp?expires&tenant&signature`, ttl 1200 s, tampered signature -> 403, `private, max-age=600`) | `previewImage()` (VD-3) | ignored; 0 image requests | `<img src>`; 4 real thumbs requested, 200 |
| Names, `product_count`, `is_active` | same list | `realValues` | used | used (+ inactive count said) |
| Placeholder pictures | built-in `REAL_VALUE_MEDIA/ICONS` + `samplePicture()` data: SVG | `DiscoveryPanelPreview` | drawn for REAL values | sample mode only, labelled |
| Public storefront | `store/v1 meta.facets[].visual` (count>0, published products of that sales channel only) + guarded route + same-origin proxy `/api/storefront/media/facet-visuals/...` | storefront tile | real images (200 image/webp) | unchanged (reference) |
The builder already called the facets endpoint 2-4 times per open; no new request was needed.

## 3. Findings per requirement
1. Trace: CommerceFacetVisual -> `/facets` payload (visual + visual_preview present for every value with an image; confirmed in `json/facet-payloads.json`) -> `loadFacets` -> `DataSectionFields` -> `DiscoveryDisplayFields` -> `DiscoveryPanelPreview.previewSource`, where the looks were dropped.
2. Real or mock: names/counts real, looks mock (placeholder SVG data URIs) in the panel preview. The main canvas never renders discovery values at all: a dashed box said "Live catalog values appear here", which is untrue in the builder (copy corrected).
3. Paths/proxy/context: the facets endpoint is tenant-scoped by token and tenant-wide (no sales-channel filter, `product_count` counts every assigned product incl. unpublished). Signed thumbnail needs no media-library permission. The storefront uses a different, sales-channel-scoped, published-only route. Fallback chain image -> icon -> initial is the shared resolver's; the preview previously bypassed it.
4. Unpublished / empty values: storefront hides values with no PUBLISHED product on that channel (and inactive values). The builder cannot know "unpublished-only" (count includes them), so it says the rule in words (see Decision Gate G1). Observed: qa-o `boss` (only an unpublished product) shows in the builder, absent from the store; `friend`/`eid` (count 0) are flagged "no products"; seeded `purple` (S2-only) shows in S1's builder preview, not on S1's storefront.
5. "حسب القالب": it is layout INHERITANCE (property follows the template, D-08), not template SELECTION (the picker above it, editable at all times). It was never disabled (`disabled:false` in `json/before-template-ar.json`). Defects: pressed state looks like a selected template chip, re-pressing is a silent no-op, no text says which template/layout it follows. Fix is wording + hint only; storage model unchanged (only the template id is saved; "follow" deletes the layout key; legacy documents untouched).

## 4. Root cause
`discovery-preview-model.ts`: "looks are always samples, because the builder does not read value visuals" - `realValues()` kept the real names but cycled `REAL_VALUE_MEDIA/ICONS`, and `previewValueVisual()` emitted placeholder media ids. Not the template, not the API, not image protection.

## 5. Fix (web/ only, `store-experience-builder/`)
- `discovery-preview-model.ts`: real values carry `stored {visual, facetVisual, image}`; `resolveStoredTile` uses `resolveFacetValueVisual` with section/template context, the storefront's `keepsFrame`/icon-first rules, and `usableMediaIds` so a missing/failed thumbnail falls back exactly like the store; `previewNotes/previewNoteGroups`; `SampleReason`.
- `DiscoveryPanelPreview.tsx`: status line (real vs sample + reason), "Sample" badge in the frame, notices outside the aria-hidden frame (`role=status`): stored image without preview link, link failed to load (capture-phase `error`, per-link key so a reload retries) + "Reload the preview" button, no look, no products, inactive count, standing "store lists only published-product values; counts include unpublished".
- `DiscoveryDisplayFields.tsx` / `DataSectionFields.tsx`: reload hook (existing `retryFacets`); "Follow template" label + hint naming template and layout, and the override hint. Messages ar/en symmetric; no hex colors (semantic tokens only).
- Canvas note for discovery now points to the panel's Live preview.

## 6. Tests
New `__tests__/DiscoveryPanelPreview.realVisuals.test.tsx` (21 tests). On `origin/main` (copied into a clean worktree): 18 failed / 3 passed (`json/tests-BEFORE-on-main.txt`; first failure diff: expected signed `thumb-320.webp` URLs, received `data:image/svg+xml...linearGradient`). On the fix: 21/21 (`json/tests-AFTER-fixed.txt`). Four existing assertions updated for intentionally changed copy (caption, canvas note, template button label via hint, unused-key guard regex). Full web suite: 628 files / 7176 tests passed (`json/full-web-suite.txt`, includes VD-4c drift/twin tests). `tsc` clean for non-test files (pre-existing test-only TS errors on main untouched). `npm run build` succeeded (`json/build.txt`). `next lint` has no ESLint config in the repo (interactive prompt), not run.

## 7. Evidence (`shots/`, `json/`, `harness/`)
Fixtures `qa-o-*` (tenant vd5-a; real uploaded images; heart + circle; published on S1 / unpublished / none / inactive / no image). BEFORE (unmodified main, :3101): `before-preview-{ar,en}-{1440,390}-{recipient,occasion}.png`, `before-page-*`, `before-template-ar-*`, `before-storefront-{color,occasion}-1440.png`. AFTER (fixed code, own dev server :3221, same API, now stopped): `after-preview-*`, `after-page-*`, `after-sample-mode-*`, `after-links-failed-*` / `after-links-reloaded-*` (signed links aborted at network level, then reload), `after-template-*`, `after-side-by-side-color.png` (builder preview vs real published storefront for the same `color` values: same circle/rounded/arch/hexagon shapes with the same real images). Measured: before 0 image requests and `data:` SVG sources; after real thumbnails requested from the signed links, 200, `naturalWidth>0`.

## 8. Residual risks
- qa-o dimensions cannot be rendered on the real storefront without publishing S1 (forbidden), so the storefront comparison uses the seeded `color` dimension; qa-o storefront payload is in `json/facet-payloads.json`.
- Signed links last 20 min: a panel left open longer shows the failed-link notice and the reload button (tested, not time-waited).
- A value with a stored image whose media is still processing/deleted gets the "unavailable" notice by construction (unit-tested; no such real fixture was created).
- Builder preview lists all active values; the store lists fewer (see G1). By construction (not screenshotted) a reload briefly shows the "sample/loading" label while the list refetches.
- `<local path>` shows detached HEAD 8b2b424 (not changed by me). S1 published home untouched (QA-F2 home rev 2); my draft was deleted; `qa-o-*` facets/products/media remain.

## 9. Decision Gate items (not implemented)
- G1: per-store published value count (or a `published_product_count`/`listed_on_store` flag) in the admin facets list, so the builder can say exactly "this value will not appear on S1". Needs API change.
- G2: if signed preview lifetime (1200 s) should be longer or refreshed silently, that is a backend/security decision. The UI uses the reload button instead.
- G3: rendering real discovery tiles on the main canvas (needs facets loading in the canvas + a design decision); only the misleading copy was fixed.
