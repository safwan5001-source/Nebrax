# BL-002 — Visual Dimensions H1: follow-ups and side issues (G1–G6 + residuals)

STATUS: **OPEN — backlog, outside any horizon.** Nothing here is scheduled, approved or started. Each item needs its own owner decision before work begins.
OPENED: 2026-10-15 (AWJ-COMMERCE-VISUAL-DIMENSIONS-H1 closure; source: `docs/plans/store/visual-dimensions/AWJ-VD-5-QA-REPORT.md`)
RULE: any item marked API / DB / permission / security / accounting needs explicit owner approval before implementation and merge.

## Decision-gate items (G1–G6)

| ID | Item | Why it waits | Suggested next step |
|---|---|---|---|
| G1 | Per-store published-product count/flag in the admin facets list, so the builder can say exactly "this value will not appear on store X" (today the preview only states the rule: a value shows only if a published product on that channel carries it; `product_count` includes unpublished products) | **API change** | Owner decision; additive field on `GET /commerce/workspace/facets` |
| G2 | Lifetime of the signed `visual_preview` thumbnail (1200 s); UI currently offers a «reload the preview» button | **Backend / security decision** | Decide: keep, extend, or silent refresh |
| G3 | Render real Discovery tiles on the builder's main canvas (today a dashed placeholder note) | Needs facet loading on the canvas + a design decision | Separate small design + slice |
| G4 | `GET commerce/workspace/storefront-media?q=` returns 500 on PostgreSQL (`ESCAPE '\\'` with a bound `?`) → media-picker search box is broken (pre-existing, shared media library) | **Backend defect**, outside the visual-dimensions UI | Root-cause + test on pgsql; separate PR |
| G5 | English storefront: `getLocale()` (next-intl server) falls back to `ar`, so `/sa/en/products`, shelves, delivery promise, offers still show Arabic names (home Discovery was fixed by #1521) | Changes the data language of every English page | Publish the URL locale to next-intl (`setRequestLocale`) or thread `locale` through each fetcher; own slice |
| G6 | BL-001: journal-line order is **not** an accounting requirement; the flake is test-side | **Accounting tests** need explicit approval | See `BL-001-ROOT-CAUSE-ANALYSIS.md`: test-only canonicalisation of `VatSemanticRoutingTest::journal()` via one shared helper; no production change |

## Residuals from VD-5 (low priority, no decision needed unless noted)

- D-W-9 (medium): builder panel preview, `overlay` captions collapse into thin bars in a narrow panel (`DiscoveryPanelPreview` `OVERLAY_LABEL w-fit`).
- D-W-5: media-capability probe failure (429/5xx/offline) is shown as "library not enabled" and cached 60 s (`use-media-capability.ts`).
- D-W-6: media picker on a phone — 27 targets under 44 px (shared `MediaPicker`; also used by the Customizer).
- D-W-7: upload rejection text arrives in Arabic inside the English UI; no client-side size check.
- D-W-11: facet Data tab has no version check (last writer wins).
- D-S-4: with the public `store/v1` rate limit (30/min/IP) exhausted the home page loses its Discovery sections; confirm in production that the limiter key is the shopper, not the shared Next server IP.
- D-S-5..D-S-8: `beside` + counts spacing; `overlay` on 80 px frames covers the glyph; `icon-grid` shows one icon for different image-only values (by design); home presentation silently truncates beyond 30 sections (no 422); malformed proxy paths answer with Next's own 404 (`no-cache`, not `no-store`); `?x=1` on a valid proxy path is served 200.
- Other fixed bottom UI can still cover keyboard focus: the Market-theme PDP sticky buy bar and the WhatsApp FAB (the #1528 padding covers the bottom nav only); sticky header on Shift+Tab (no `scroll-padding-top`).
- Review nits left as-is: `MediaDialog` opener fallback on Safari; `keydownInFlight` retains the last KeyboardEvent; `facets-panel` «Customize appearance» stays disabled with no explanation if the reload never lists the new row; `FacetVisualTile` `<img>` has no `referrerPolicy`; panel-preview status regions announce the standing store-rule sentence on mount.
- Test hygiene for the VD-5 specs: storefront spec leaks one media item per run; its cleanup swallows errors; `reset-throttle.sh` (stack-local, outside the repo) must only clear rate-limiter buckets.
- Not verified in VD-5 (needs real infrastructure or devices): real screen reader, production build/hydration, real R2/CDN/custom domains, physical iOS safe-area, Safari/Firefox, dark mode of the storefront (out of scope D-13), «media not ready» / «deleted while referenced» in a browser (API cannot produce them; covered by PHP N-tests).

## Staging

An owner-approved-in-principle **Staging pass on real infrastructure** is still to be done before any release. It needs a separate explicit permission; no deploy and no environment change was made by this horizon.
