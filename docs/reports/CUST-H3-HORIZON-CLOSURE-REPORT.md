# CUST-H3 — Horizon Closure Report: Store Identity Studio

**Report type:** Closure / documentation only. No runtime code, no refactor, no re-opened slice, no deploy.

---

## 1. Executive closure status

**CUST-H3 HORIZON CLOSED — IMPLEMENTATION COMPLETE**

Every capability in the CUST-H3-ARCH-1 contract (§3) is either **LIVE** with verified Canvas/Published parity, or **GATED BY DESIGN** per an explicit contract decision that was never meant to become LIVE in this Horizon. No contracted acceptance criterion is open. The one item still listed as a gap in the architecture document at H3's start — `accentColor` — closes as **GATED BY DESIGN**, not as a miss: ARCH-1 §5 required H3 to either define a real semantic role for it or leave the control hidden/gated, and H3-2 verified no control renders it anywhere, which is the gated outcome the contract itself authorized.

Production deployment is **not** part of this closure (see §21).

---

## 2. Baseline / final main SHA

- **Baseline requested by the task:** `a9b37bda8b81a60d89eb3caa3aaea828a72bac71`
- **Verified against `git fetch origin main` at task start:** `a9b37bda8b81a60d89eb3caa3aaea828a72bac71` — **matches exactly.**
- This SHA is also, independently, the merge commit of PR #1146 (CUST-H3-4) — i.e. `origin/main`'s HEAD at task start is literally the last H3 slice's own merge commit. There is no code on `main` past CUST-H3-4 at the time of this closure.

---

## 3. Architecture contract

Source read: `docs/plans/store/CUST-H3-ARCH-1-IDENTITY-CONTRACT.md` (merged via PR #1138).

Key decisions this closure checks the implementation against:

1. CUST-H3 is an **evolution of the existing `StorefrontPresentationConfig`** fields, not a new identity persistence model (§1).
2. Canonical persistence remains the CUST-H1 Version document; H3 never writes directly to Published state (§2).
3. A capability registry of 12 fields, each with a starting state (§3) — reproduced and closed out in §5 below.
4. Public components must consume semantic values, deterministically, SSR-safely, fail-closed on unknown values, with no new identity network fetch (§4).
5. `accentColor` stays backward-compatible in storage; before it can be LIVE, H3 must define a real semantic role or hide/gate the control (§5).
6. Typography may expand the closed `FONT_PRESETS` enum only with vetted, curated families — no arbitrary font URL/upload (§6).
7. `density`/`productCard` must map to real, bounded classes/tokens with no commerce-truth fork (§7).
8. Branding media reuses the locked contract — no new upload endpoint or media table (§8).
9. Backward compatibility: existing Versions continue to normalize, no DB backfill, no field deleted (§9).
10. No new authority: public identity comes only from the host-resolved Published Snapshot (§10).
11. Four implementation slices (H3-1..H3-4) plus this formal closure (§11).
12. Gates requiring a **new** architecture decision before implementation may proceed: DB migration, new endpoint, uploaded-font storage, arbitrary CSS, schema change beyond an explicitly reviewed additive field, page-specific identity authority (§12). **None of these gates was crossed in H3-1 through H3-4** — confirmed below, slice by slice.

---

## 4. Merged PR / slice history

All five PRs were verified directly against GitHub (`pull_request_read` / `get_commit`), not from memory or from the implementation reports alone.

| PR | Title | State | Merged | Merge SHA (on `main`) | Base→Head scope | Files | +/− |
|---|---|---|---|---|---|---|---|
| [#1138](https://github.com/safwan5001-source/Nebrax/pull/1138) | docs(store): define CUST-H3 Store Identity architecture | closed | ✅ merged | `8f425ceb7cd944c7cef9a887aa01a0cf77a81a54` | docs only — architecture contract | 3 | +487 / −0 |
| [#1140](https://github.com/safwan5001-source/Nebrax/pull/1140) | feat(store): consolidate Store Identity Studio | closed | ✅ merged | `2981743de0bea007ca1f3941bc0f2cbf9840b23d` | H3-1 — web code + test + docs | 4 | +529 / −40 |
| [#1144](https://github.com/safwan5001-source/Nebrax/pull/1144) | feat(store): close color and typography truth | closed | ✅ merged | `aa8815e5d761f7678cb90a67f69531bc35813a0d` | H3-2 — PHP + web + storefront code/test/docs | 27 | +1077 / −20 |
| [#1145](https://github.com/safwan5001-source/Nebrax/pull/1145) | feat(store): close global component appearance parity | closed | ✅ merged | `946ef115b986caaf7893a0b24cc0afbcddbc4830` | H3-3 — web + storefront code/test/docs (no PHP) | 11 | +566 / −7 |
| [#1146](https://github.com/safwan5001-source/Nebrax/pull/1146) | test(store): close H3 cross-page global parity | closed | ✅ merged | `a9b37bda8b81a60d89eb3caa3aaea828a72bac71` | H3-4 — tests + docs only (no production code) | 3 | +637 / −0 |

**Chain continuity verified:** each PR's base commit is an ancestor of the previous PR's merge commit (checked with `git merge-base --is-ancestor`), and `git log` on `origin/main` confirms all five merge commits sit on the same linear history ending at the current HEAD. Two unrelated interleaved PRs exist in between H3-1 and H3-2 on `main` (#1141/#1143, App Builder device-preview work, and #1142, the CUST-H3-2-specific architecture doc) — neither touches any file H3-1..H3-4 touch, confirmed by their own file lists not overlapping the Store Customizer/storefront presentation paths.

**Did runtime/code change, per PR?**

| PR | Runtime code | Tests | Docs |
|---|---|---|---|
| #1138 | No | No | Yes (architecture contract) |
| #1140 | Yes (web Customizer: `ControlPanels.tsx`, `messages.ts`) | Yes (new suite) | Yes |
| #1144 | Yes (PHP normalizer + web/storefront font/color resolvers) | Yes (new + updated suites) | Yes |
| #1145 | Yes (web + storefront density/productCard resolvers and consumers) | Yes (new + updated suites) | Yes |
| #1146 | **No** (verification-only; two new regression tests) | Yes (2 new tests) | Yes |

**Current `main` CI status** (re-checked at the current HEAD, `a9b37bda8b81a60d89eb3caa3aaea828a72bac71` — which is PR #1146's own merge commit): all 8 check runs for that commit are `success` — `php artisan test` (sqlite, pgsql) ×2 (one pair per job group), `web build (Next.js)`, `storefront (lint + typecheck + test)`, `merchant preview visual QA`, `published footer visual QA`. No failing or pending check on the commit this closure is based on.

---

## 5. Capability closure matrix

| Capability | Final status | Evidence slice | Notes |
|---|---|---|---|
| **Identity** | | | |
| `displayName` | **LIVE** | H3-1 (consolidation) · H3-4 (cross-page proof) | One merchant-facing Identity surface; fallback order (`branding.displayName` → live store name → translated default) unchanged; shared, not per-page. |
| `logo` | **LIVE** | H3-1 · H3-4 | Distinct accessible name + thumbnail preview added in H3-1; resolved once per render in H3-4's structural proof. |
| `compactLogo` | **LIVE** | H3-1 · H3-4 | Selected only when `header.style === "compact"`, both layers; same resolved value across Home/Product/Category. |
| `favicon` | **LIVE** | H3-1 (control) · H3-4 (public resolution path) | Served by the single global `/icon` route reading the same Published fetch the layout uses; N/A on Canvas by contract (no separate document/tab to show it in), not a gap. |
| **Appearance** | | | |
| `primaryColor` | **LIVE** | H3-2 (byte-identical `presentationCssVars()` restored) · H3-4 (identical style object across pages) | Fail-closed invalid-hex handling, derived foreground/hover/soft/ring — unchanged, re-verified. |
| `accentColor` | **GATED by design** | H3-2 (§8) · H3-4 (§12, re-confirmed) | Round-trips through all 3 normalizer layers; **zero rendered control** in either `ControlPanels.tsx` (web or storefront); no Published consumer. Matches ARCH-1 §5's explicit gate — not a miss. |
| `fontPreset` | **LIVE** — `cairo-geist`, `tajawal-geist` | H3-2 (first pass + P1 fix) · H3-4 (regression re-run) | See §7 (H3-2 closure) for the two runtime bugs found and fixed before merge. |
| `radius` | **LIVE** | H3-ARCH-1 start state (already LIVE) · H3-3 (re-verified, no code touched) · H3-4 | Canvas and Published call the byte-identical `presentationCssVars(primary, radius)`. |
| `density` | **LIVE** | H3-3 (closed the Product/Category gap) · H3-4 | Home's `publishedHomeStackClass` was already live; H3-3 added `pageContainerPaddingClass()` / `publishedPageContainerPaddingClass()` for Product/Category, both layers, AWJ Market's own locked chrome untouched. |
| `productCard` | **LIVE** | H3-3 (closed the Category-grid Canvas mock gap) · H3-4 | Real Published `ProductCard.tsx` path was already live broadly; H3-3 fixed the Canvas's Category preview mock, which had been silently ignoring the field. |
| `header.style` | **LIVE** | H3-ARCH-1 start state (already LIVE) · H3-3 (re-verified, no code touched) · H3-4 | Ties `compact` to logo variant + utility-strip visibility, identically on Canvas and Published. |
| **Global behavior** | | | |
| Home parity | **LIVE** | H3-4 §6–§18 (evidence matrix) | Single shared layout/Canvas resolves identity/appearance once, before branching on page. |
| Product parity | **LIVE** | H3-3 (density) · H3-4 | `productCard` is N/A on Product (no grid on a single-item detail page) — page-type fact, not a gap. |
| Category parity | **LIVE** | H3-3 (density + productCard) · H3-4 | Last of the three pages to reach full parity; closed by H3-3. |
| Header | **LIVE** | H3-3 (confirmed complete, no change) · H3-4 | Rendered once per layout/Canvas, outside the page-switching boundary. |
| Footer / public chrome | **LIVE** | H3-4 §18 | Rendered once, outside the page-switching boundary; existing configured behavior traced, untouched. |
| Mobile | **LIVE / verified** | H3-1 (390px reachability) · H3-3 · H3-4 (`store-brand-qa` matrix incl. 390–1440px) | No new breakpoint-sensitive class introduced beyond what already existed. |
| Desktop | **LIVE / verified** | H3-1..H3-4 | Same evidence as mobile; `store-brand-qa` matrix covers both. |
| RTL | **LIVE / verified** | H3-1 (Arabic labels) · H3-2 (Tajawal Arabic coverage) · H3-4 (`dir` resolved once per document/Canvas root) | No per-page direction logic exists to diverge. |
| LTR | **LIVE / verified** | H3-1 · H3-4 | Same single-resolution-point structure as RTL. |
| Accessibility | **LIVE / verified** | H3-1 (distinct accessible names, thumbnail `alt=""`) · H3-3 (no tap-target change) · H3-4 (skip-link/aria-label/focus-ring re-confirmed untouched) | No color-only state indicator anywhere in scope. |
| Draft/Published isolation | **LIVE / verified** | H3-1 (`data-lifecycle` stays clean) · H3-4 §19 (structural proof + backend `StorefrontPresentationPublicRuntimeTest` contract tests) | No H3 code bypasses the H1 Version lifecycle; Draft is never on the public payload. |
| Backward compatibility | **LIVE / verified** | H3-1..H3-4, each slice's own §Backward compatibility | `StorefrontPresentationNormalizer::VERSION` stays `3` throughout all four slices; pre-H3 documents normalize and render identically. |

---

## 6. H3-1 closure — Identity Studio shell + branding consolidation

**What H3-1 actually delivered** (PR #1140, merged `2981743d`):

- Framed the existing four branding fields (`displayName`, `logoDataUrl`, `compactLogoDataUrl`, `faviconDataUrl`) under one merchant-language "Identity"/"الهوية" surface inside the already-existing `branding` Customizer panel, with an intro sentence — not a second heading (a duplicate-heading approach was tried and reverted, documented as a judgment call in the report, §19).
- Gave each of the three logo slots (logo, compact logo, favicon) a **distinguishable accessible name** for its upload input and remove button — previously all three shared the literal "Choose image"/"Remove" name, which is a real accessibility defect the slice closed.
- Added a small thumbnail preview next to each logo slot once a value is saved, satisfying ARCH-1 §8's explicit "preview" requirement for branding media controls.
- **No new persistence model.** Zero changes to `presentation/config.ts`, `presentation/urls.ts`, `sanitizeLogoUrl`, or any field-writing code path — `patch()` calls are byte-identical to before.
- **No panel-authority change.** Panel ids (`"branding"`, `"theme"`), nav grouping, default panel, and `handleSelectPage`'s fallback logic are all unchanged — preserving existing deep-links, click-to-edit routing, and test assertions.

This closure does not exaggerate H3-1's scope: it was a UX consolidation + accessibility fix on top of an already-correct persistence/authority model, exactly as ARCH-1 §11 scoped it.

---

## 7. H3-2 closure — Color + typography truth

**What H3-2 delivered** (PR #1144, merged `aa8815e5`):

- **Color**: confirmed `primaryColor` remains the single LIVE brand-color control, unchanged in behavior; confirmed `accentColor` has no rendered control anywhere (the GATED outcome, §5).
- **Typography truth**: `tajawal-geist` was added as a second, real, selectable `fontPreset` after a dedicated verification pass (Arabic+Latin subset coverage, available weights, self-hosted `next/font/google` build support — all confirmed against the actual Next.js font metadata, not assumed) and a synchronized enum addition across the PHP normalizer and both TS mirrors.

**H3-2 P1 fixes — explicitly confirmed fixed before merge.** Owner review of the first pass found two runtime-correctness bugs that would have made `tajawal-geist` a silent no-op on the public storefront:

1. **Selected font must apply on the actual Published wrapper.** The first pass set a CSS custom property (`--store-font-arabic`) on a descendant `<div>` but consumed it in a `body { font-family }` rule on an **ancestor** — custom properties cannot cross that boundary upward, so the Published page would always have fallen back to the rule's own default (Cairo), never actually reading the merchant's chosen preset. **Fixed** by having `publishedThemeStyle()` compute the complete, literal `fontFamily` value directly and apply it as an inline style on the same wrapper that already carries `--store-primary` — the wrapper now owns the property it needs, not a variable some ancestor was expected to read.
2. **Tajawal must not be shadowed by Cairo.** The first pass's font stack reused the existing Geist instance, which had its own `fallback: ["Cairo"]` baked in by `next/font`'s own mechanics — so the stack silently expanded to include Cairo *before* Tajawal in the fallback chain, and Cairo (full Arabic coverage) would answer for every Arabic glyph first. **Fixed** by declaring a second, dedicated Geist instance with `fallback: ["Tajawal"]`, so `tajawal-geist`'s resolved stack never references Cairo or the original Geist instance at all.

Both fixes are verified at three independent levels in the final merged revision: the font-loader argument level (real `Geist()` mock-call inspection, not string literals), the resolver level (`fontPresetFamilyStack()` unit tests), and the consumption level (real rendered DOM `style.fontFamily`, not jsdom approximation). `accentColor` remains GATED, untouched by this slice beyond re-confirming the grep-verified absence of any rendered control.

---

## 8. H3-3 closure — Global component appearance parity

**What H3-3 delivered** (PR #1145, merged `946ef115`):

- **`density` parity closed**: the Customizer Canvas already *simulated* a compact/comfortable difference in the Product/Category page previews' own container padding, but the real Published Product (`ProductDetails.tsx`) and Category (`c/[...permalink]/page.tsx`) pages never actually varied by `density` — a Canvas-only effect with no Published truth behind it. A single shared resolver (`pageContainerPaddingClass()` / `publishedPageContainerPaddingClass()`) now backs both Canvas previews and both real page shells. AWJ Market's own already-locked compact chrome (a separate, pre-existing Master Spec decision) is explicitly untouched and regression-tested.
- **`productCard` parity closed**: the real Published grid (`ProductCard.tsx`, shared by `InfiniteProductList`/`FeaturedShelf`/`NewArrivalsSection`) was already correctly wired; the gap was entirely on the Canvas side — the Category preview's grid-tile mock was hard-coded and ignored `productCard`. Fixed to vary by the same field, calibrated to its own smaller mock layout.
- **`radius` verified already complete** — both layers call the identical `presentationCssVars(primary, radius)`; no code touched.
- **`header.style` verified already complete** — the Canvas's own documented `compact` computation already matches the Published Header's two-thing gate (logo variant, utility strip); no code touched.
- **No commerce-truth change**: no product data, pricing, variant, add-to-cart, or availability logic was touched — confirmed by the slice's own explicit scope statement and file list (11 files, all presentation-layer).
- **No unnecessary redesign**: the two fixes are narrowly scoped to the exact Canvas-mock/Published-shell gaps the evidence pass identified; `radius`/`header.style` were explicitly left alone once confirmed correct, rather than being "touched for consistency."

---

## 9. H3-4 closure — Cross-page/global parity + integrated QA

**What H3-4 delivered** (PR #1146, merged `a9b37bda`):

- **Verification-only outcome.** Scoped per ARCH-1 §11 as the integrated-QA slice: trace actual consumers (not normalizers) for every capability across Home/Product/Category, fix only what evidence proves is a gap. **Outcome: no runtime gap was found.**
- **No runtime gaps found** because `(storefront)/layout.tsx` and `StorefrontPreviewCanvas.tsx` each resolve every identity/appearance value exactly once, upstream of branching on which page's content they wrap — a structural guarantee (one component instance, one computed set of values, `children`/`page` only switches the body), not a convention that could silently drift.
- **Cross-page structural parity** was confirmed for every capability in the registry via a 6-page evidence matrix (Canvas Home/Product/Category × Published Home/Product/Category) built by reading the real consumer files, not inferred from normalizer agreement alone.
- **Home/Product/Category**: all twelve capabilities trace to one shared resolution point per layer; the only "N/A" cells (favicon on Canvas, productCard on the Product page) are page-type facts, not gaps.
- **Shared identity authority**: confirmed structurally — Header/Footer sit outside the page-switching boundary on both Canvas and Published, so no code path exists that could fork identity per page.
- **Public chrome**: Footer's existing configured behavior (logo/tagline/copyright/social/WhatsApp/app-store links/business identity/SBC seal) traced and confirmed unchanged, reading from the same single config object as every other capability.
- **Lifecycle**: no second Draft/Published mechanism exists or was added; every `published*` helper is a pure function of an already-fetched Published snapshot.
- **Backward compatibility**: re-confirmed the pre-H2 normalization regression test still passes unmodified.
- **Integrated regression tests**: two new, focused tests added — `layout.test.tsx` (Published) and `StorefrontPreviewCanvas.crossPageIdentity.test.tsx` (Canvas) — each proving identical resolved identity/theme/appearance across three simulated pages against a **populated, non-default** config, not just the default/null case.
- **Visual/browser QA evidence**: the existing real-Chromium `store-brand-qa` Playwright suites re-ran green (web 33/33, storefront 69/69) across the existing viewport/locale matrix, with one isolated flaky re-run explained as resource contention, not a regression (unrelated spec, passed clean on immediate re-run).

**Explicitly: no production runtime code was needed in H3-4.** The slice's only diff is two new regression test files plus its own implementation report — confirmed by the PR's own file list (3 files: 2 test files + 1 doc) and by its explicit "Files changed" / "Fixes made: None to production code" sections.

---

## 10. Identity authority

Confirmed from evidence across all four slices, not asserted new here:

- **No page-specific identity authority exists.** H3-4 §7 traces this structurally: both `(storefront)/layout.tsx` and `StorefrontPreviewCanvas.tsx` compute identity/theme/appearance from `presentation`/`config` alone, before ever branching on `children`/`page` — there is no code path by which Home, Product, or Category could diverge.
- **No new public identity endpoint** was added in any slice. Favicon resolution (`/icon` route) is pre-existing, reads the same cached `fetchStorefrontConfig()` call the layout already used, and was only *verified*, not changed, in H3-4.
- **No new runtime network fetch** for identity was introduced — `publishedThemeStyle()`, `publishedFaviconUrl()`, `publishedPageContainerPaddingClass()`, and every other `published*` helper added across H3-2/H3-3 are pure functions of an already-fetched Published config, not new data sources. Fonts self-host via the existing `next/font/google` build-time seam — no `<link>`/`@import`/CDN call was added.
- **Tenant/host authority unchanged.** No slice touched the host-resolution or tenant-scoping layer; the public storefront's existing Published-snapshot-by-resolved-host mechanism is untouched.
- **Published Snapshot remains the sole public source.** Every `published*` helper operates only on data from `fetchStorefrontConfig()`, documented in that function's own header as Published-only.
- **Draft does not leak.** Structurally proven (identity is resolved once, upstream of any page branch, from a Published-only fetch) and confirmed at the backend contract level by the pre-existing, unmodified `StorefrontPresentationPublicRuntimeTest` suite (`public_runtime_never_exposes_an_unpublished_draft`, `host_isolation_never_returns_another_tenants_published_presentation`, `anonymous_workspace_draft_routes_are_unreachable`) — none of which any H3 slice touched.
- **`commerce.manage` / existing workspace authority unchanged.** No H3 slice added, removed, or modified an authorization gate; all merchant-facing mutations continue through the existing authenticated, tenant-scoped presentation endpoints.

No new security claim is made beyond what the four implementation reports already document.

---

## 11. Published/Draft lifecycle

- **Authority chain preserved exactly as ARCH-1 §2 specifies:** Active Version Draft → Save/Duplicate/Publish/Schedule → Published Snapshot → Public Storefront. No H3 slice touched the Save/Duplicate/Publish/Schedule API or its backing services — confirmed by each slice's own file list (zero overlap with the Version lifecycle controllers/services) and by the existing `ExperienceBuilder.versions/.publish/.schedule.test.tsx` suites (52+15+21 tests) running unmodified and green throughout H3-1 → H3-4.
- **Draft isolation re-verified, not merely assumed, in H3-4** via the dedicated regression tests described in §9, run against a populated (non-default) config specifically to catch a future accidental leak that a default-only test could miss.
- **No field was deleted** in any slice; `StorefrontPresentationNormalizer::VERSION` stayed at `3` across all four slices.

---

## 12. Security / tenant isolation impact

See §10 for the full evidence trail. Summary: **no change.** No slice added an endpoint, widened an existing endpoint's authority, changed host/tenant resolution, or introduced a code path by which one tenant's Draft or another tenant's Published config could become visible. The one backend file touched across all four slices was the PHP normalizer (`StorefrontPresentationNormalizer.php`, H3-2 only) — an enum addition (`tajawal-geist`) to an already-existing, already-tenant-scoped, already-validated field; it adds no new field, no new endpoint, no new authorization branch.

---

## 13. Schema / persistence impact

Confirmed directly from each PR's actual file list (via GitHub, not from the reports' prose alone):

- **No DB migration** in any of the five PRs — no file under `database/migrations/` appears in any diff (#1138: 3 docs files; #1140: 4 web/docs files; #1144: 27 files, one PHP — the normalizer and its test, zero migrations; #1145: 11 files, zero PHP; #1146: 3 files, zero PHP).
- **No backfill.**
- **No new persistence model.** `accentColor`, `fontPreset`, `density`, `productCard` were all already-persisted `StorefrontPresentationConfig` fields before H3 started (ARCH-1 §3's own registry); H3 only closed runtime-consumption gaps for some of them.
- **No schema version bump for H3.** `StorefrontPresentationNormalizer::VERSION` is confirmed `3` throughout H3-1 → H3-4, in every slice's own "Backward compatibility" section.
- **No new identity table, no new media table, no new uploaded-font storage.** Branding media reuses the pre-existing locked contract (ARCH-1 §8); typography uses only the existing self-hosted `next/font/google` seam (ARCH-1 §6's own constraint — curated presets only, no upload).

**No report contradicts this.** No STOP condition in ARCH-1 §12 was triggered by any of the four implementation slices.

---

## 14. Backward compatibility

- **Existing Versions still normalize.** Each slice's own normalizer/config tests (PHP + both TS mirrors) re-confirm a pre-H3 stored document normalizes to the same defaults (`cairo-geist`, `comfortable`, `standard`, default radius) it always did; H3-4 re-ran the pre-H2 byte-identical normalization regression test unmodified.
- **Missing optional fields retain defaults.** `accentColor` defaults to `null` and is never required; `fontPreset`/`density`/`productCard`/`radius` all fail closed to their pre-H3 defaults for an absent or unknown value — explicitly tested at the resolver layer in H3-2 and H3-3.
- **Existing Cairo behavior remains supported.** `cairo-geist`'s resolved font stack is unchanged byte-for-byte by the H3-2 P1 fix (the fix added a second, independent Tajawal-fallback Geist instance; the original `--font-geist` instance used by `cairo-geist` was never touched).
- **Unknown values fail closed.** Verified at every resolver introduced or touched: `fontPresetFamilyStack`, `pageContainerPaddingClass`/`publishedPageContainerPaddingClass`, and the pre-existing normalizer enum acceptance.
- **Existing Published lifecycle preserved** — see §11.

---

## 15. Mobile / desktop

- H3-1 added explicit 390px mobile-reachability coverage for the new Identity grouping (no new toolbar button; reached via existing click-to-edit).
- H3-3/H3-4 introduced no new breakpoint-sensitive classes beyond what the Canvas already computed; the existing `store-brand-qa` Playwright suite's `[390, 430, 768, 1024, 1280, 1440]`-width matrix ran green through H3-4 (33/33 web, 69/69 storefront), including no-horizontal-overflow and 44px-minimum-touch-target assertions.
- No desktop/mobile-specific divergence was found or introduced at any point in H3.

---

## 16. RTL / LTR

- H3-1 added an explicit Arabic/RTL test for the new Identity grouping and copy.
- H3-2's Tajawal verification explicitly covered full Arabic glyph coverage as a precondition for adding the preset.
- H3-4 confirmed structurally that `dir`/`lang` are resolved once per document (storefront) or once per Canvas render (web), independent of `page` — there is no per-page direction logic to diverge, and the existing `DocumentShell.test.tsx` RTL/LTR assertions ran unmodified throughout.
- `storefront`'s `check-locale-parity.ts` confirmed all 5 locale files (ar/de/es/fr/pl) stayed in sync with `en.json` through H3-4.

---

## 17. Accessibility

- H3-1's core deliverable was an accessibility fix: distinct accessible names for three previously-ambiguous upload/remove control pairs, plus a decorative (`alt=""`) thumbnail that does not duplicate an already-present visible label.
- H3-3 confirmed no interactive element's tap target size changed by either the `density` or `productCard` fix — only non-interactive container/text padding.
- H3-4 re-confirmed, unchanged: the skip-link, the account icon's `aria-label`, the footer's own focus-visible override, and that no color-only state indicator exists anywhere in scope.
- No slice introduced a new accessibility regression; the real-Chromium `store-brand-qa` suite's keyboard-focus-visible and touch-target assertions stayed green throughout.

---

## 18. QA rollup

Per the task's own instruction, this section **collects results already documented in H3-1..H3-4** and separately reports current `main` CI status (§4) — it does not rerun every historical suite.

| Area | H3-1 | H3-2 (final, post-P1-fix) | H3-3 | H3-4 |
|---|---|---|---|---|
| PHP (full `php artisan test`) | not separately re-stated (no PHP touched) | 4968 passed / 56 failed / 51 skipped | 4968 passed / 56 failed / 51 skipped (identical) | 4968 passed / 56 failed / 51 skipped (identical) |
| PHP normalizer only | n/a | 33/33 | 33/33 | 33/33 |
| web Vitest (full) | 2472/2472 | 2493/2493 | — (module-focused: 236/236) + full suite unaffected | 2501/2501 |
| storefront Vitest (full) | n/a (storefront untouched) | 748/748 | 754/754 | 755/755 |
| web typecheck | 27 pre-existing errors, 0 new | baseline unchanged, 0 new | 27 pre-existing, 0 new | 15 pre-existing, 0 new |
| storefront typecheck | n/a | clean | clean | clean |
| web build | ✅ exit 0 | ✅ | ✅ | ✅ |
| storefront build | n/a | ✅ (Turbopack) | ✅ | ✅ |
| Playwright `store-brand-qa` (web, real Chromium) | ✅ (part of CI) | n/a (not re-run; no visual-relevant change) | 33/33 | 33/33 |
| Playwright `store-brand-qa` (storefront, real Chromium) | ✅ (part of CI) | n/a | 69/69 | 69/69 |
| RTL/LTR | ✅ dedicated test | ✅ unaffected | ✅ unaffected | ✅ locale-parity script, all 5 locales |
| Mobile/desktop | ✅ 390px dedicated test | n/a | ✅ viewport matrix | ✅ viewport matrix |
| Accessibility | ✅ dedicated test | n/a | ✅ no tap-target change | ✅ re-confirmed unchanged |
| Draft/Published regression | ✅ `data-lifecycle` assertion | n/a | n/a | ✅ 2 new populated-config regression tests |

**Current `main` CI** (checked directly against the HEAD commit this closure is based on, §4): all 8 check runs `success` — no pending or failing check on `origin/main` at `a9b37bda`.

**This closure does not claim "all tests globally pass."** The PHP full suite carries 56 pre-existing failures and 51 skips throughout H3-2/H3-3/H3-4 (identical counts across all three, confirming zero H3 impact), and web typecheck carries pre-existing baseline errors (27 at H3-1/H3-3, 15 at H3-4 — the count itself shifted between slices for reasons unrelated to H3, as both reports independently confirm via `git stash` comparison against each slice's own base commit). These are addressed as known non-blockers in §19, not folded into a false "all green" claim.

---

## 19. Known non-blockers

Carried forward accurately from the H3 reports, confirmed still unrelated to H3 at closure time:

- **Pre-existing PHP failures (56, stable across H3-2/H3-3/H3-4):** four unrelated environment-caused clusters — missing `aws/aws-sdk-php` vendor package (`ProductMediaR2*`/`R2*` tests), the Fuel Stations business-domain module, missing `RESEND_API_KEY`/mail environment (`AuthRecoveryTest`/`ResendMailTransportTest`), and `ProductOptionValueVisualTest` (unrelated product visual-type assertions). None reference `StorefrontPresentationNormalizer`, `fontPreset`, `accentColor`, `density`, `productCard`, or any file any H3 slice touched.
- **Pre-existing web typecheck errors** (27 at H3-1/H3-3's base, 15 at H3-4's base — both counts independently verified against a clean checkout of each slice's own base commit): all in files no H3 slice ever touched (`pos/settings/configuration`, several `commerce/appearance/*.test.tsx` files, `platform/integrations/gemini-card.test.tsx`, `documents/document-language-selector.test.tsx`, `global-application-controls-card.test.tsx`, several `products/product-*.test.tsx` files, `documents/use-document-label-mode.test.tsx`, `import-jobs/useImportJobEngine.test.tsx`).
- **No dedicated new cross-route pixel-diff framework exists.** H3-3 and H3-4 both state this explicitly and justify it: the task briefs for both slices explicitly forbade building a new visual-regression framework; existing real-Chromium coverage (`store-brand-qa`) was used and re-run green instead, and H3-2's font-resolution bug — the one place a pure string assertion previously missed a real runtime defect — was closed with real rendered-DOM and real font-loader-argument assertions, not by building a screenshot-diff harness.

None of these are H3 blockers: they are unchanged, unrelated, and pre-date H3 start in every case checked.

---

## 20. Remaining future work

Strict reading — only items that were never part of the H3 contract, or that the contract explicitly deferred:

- **`accentColor` semantic activation** — future horizon / separate decision. ARCH-1 §5 required H3 to either define a real semantic role or leave it gated; H3 chose (correctly, per the evidence) to leave it gated, since no control exists to activate. Defining that semantic role is explicitly out of H3's contract, not a remaining H3 item.
- **Custom font upload** — future horizon / separate architecture. ARCH-1's own registry (§3) lists this as `GATED` from H3's start, and ARCH-1 §12 names "uploaded font storage" as one of the explicit gates that would require a *new* architecture decision before any implementation could even begin. Never in H3's scope.
- **Richer identity/theme capabilities not in the H3 contract** (e.g. a second independent typography control for heading vs. body, arbitrary brand colors beyond the current primary/accent pair, per-page identity overrides) — none of these were ever part of ARCH-1's 12-capability registry; raising them now would be new scope, not a gap in what H3 promised.
- **Production deployment/verification** — see §21. Not performed, and not part of this merge-completion closure.

No already-closed H3 item (displayName, logo, compactLogo, favicon, primaryColor, fontPreset, radius, density, productCard, header.style, cross-page parity, Draft/Published isolation) is listed here.

---

## 21. Deployment status

**H3 merge completion ≠ production deployment.**

- H3 code and docs are merged into `main` as of `a9b37bda8b81a60d89eb3caa3aaea828a72bac71` (§2, §4).
- **No Production release was performed as part of any of these five merges.** Every one of the five implementation/architecture reports carries its own explicit "No Deploy performed" / "No Production release performed" confirmation, and nothing in this closure task altered that — this closure report is itself docs-only and performs no deploy.
- Production activation/verification of CUST-H3 is a **separate, owner-approved action**, not implied or authorized by any of the five merges or by this closure report.

---

## 22. Final closure verdict

All CUST-H3-ARCH-1 capability-registry criteria are either **COMPLETE** (LIVE with verified Canvas/Published parity) or **GATED BY DESIGN** (per an explicit contract decision, not an unresolved gap):

- COMPLETE: `displayName`, `logo`, `compactLogo`, `favicon`, `primaryColor`, `fontPreset` (2 presets), `radius`, `density`, `productCard`, `header.style`, Home/Product/Category structural parity, footer/public chrome, mobile, desktop, RTL, LTR, accessibility, Draft/Published isolation, backward compatibility.
- GATED BY DESIGN: `accentColor` (persisted, backward-compatible, intentionally no merchant-facing control or Published consumer yet).
- NOT PART OF H3 (correctly excluded, not a gap): custom font upload.
- REMAINING GAP: **none found.**

# CUST-H3 HORIZON CLOSED — IMPLEMENTATION COMPLETE
