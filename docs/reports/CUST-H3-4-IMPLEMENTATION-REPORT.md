# CUST-H3-4 — Implementation Report: Cross-Page / Global Parity + Integrated QA

## 1. Base SHA

`946ef115b986caaf7893a0b24cc0afbcddbc4830` (verified against `origin/main` at task start — `feat(store): close global component appearance parity (#1145)`, the CUST-H3-3 merge commit).

## 2. Head SHA

`dd29cd9ae8098e290d7d5e46308818ce3028cba8`

## 3. Branch

`feat/cust-h3-4-cross-page-integrated-qa`

## 4. PR number + URL

PR #1146 — https://github.com/safwan5001-source/Nebrax/pull/1146. No merge performed.

## 5. Mission framing — verification first

This slice was scoped as verification-first per CUST-H3-ARCH-1 §11: identify exact cross-page/global
parity gaps by tracing actual consumers (not assuming parity from normalizers alone), fix only what
evidence proves is a gap, run integrated QA, and report. **Outcome: no runtime gap was found.** Every
capability in scope resolves through a single shared code path for Home/Product/Category, on both the
Canvas and the Published storefront — not by convention, but by the literal shape of the code (one
component instance, computed once, with `children`/`page` only switching the page body underneath it).
The only changes made are two **focused regression tests** that lock in this architectural invariant
against a populated (non-default) config, so a future change that accidentally forks identity per page
fails loudly instead of silently.

## 6. Evidence Matrix

Built by reading the actual consumers, not the normalizers: `(storefront)/layout.tsx`, `Header.tsx`,
`Footer.tsx`, `DocumentShell.tsx`, `app/icon/route.ts`, `lib/presentation/public.ts`,
`lib/commerce/storefront.ts`, and `StorefrontPreviewCanvas.tsx`.

| Capability | Canvas Home | Canvas Product | Canvas Category | Published Home | Published Product | Published Category |
|---|---|---|---|---|---|---|
| `displayName` | LIVE | LIVE | LIVE | LIVE | LIVE | LIVE |
| logo | LIVE | LIVE | LIVE | LIVE | LIVE | LIVE |
| compactLogo | LIVE | LIVE | LIVE | LIVE | LIVE | LIVE |
| favicon | N/A by contract | N/A by contract | N/A by contract | LIVE | LIVE | LIVE |
| `primaryColor` | LIVE | LIVE | LIVE | LIVE | LIVE | LIVE |
| `accentColor` | GATED | GATED | GATED | GATED | GATED | GATED |
| `fontPreset` | LIVE | LIVE | LIVE | LIVE | LIVE | LIVE |
| `radius` | LIVE | LIVE | LIVE | LIVE | LIVE | LIVE |
| `density` | LIVE | LIVE | LIVE | LIVE | LIVE | LIVE |
| `productCard` | LIVE | N/A by contract | LIVE | LIVE (shelves) | N/A by contract | LIVE (grid) |
| `header.style` | LIVE | LIVE | LIVE | LIVE | LIVE | LIVE |
| footer/public chrome | LIVE | LIVE | LIVE | LIVE | LIVE | LIVE |

Notes:
- **favicon is N/A on Canvas by contract**, not a gap: the Canvas is an in-page preview frame, not a
  separate document with its own browser tab — there is no favicon surface to render inside it. The
  favicon *control* (upload/preview/remove) was already closed in H3-1; what H3-4 verifies is the
  *public* favicon resolution path (§9), which has no Canvas analogue to diverge from.
- **productCard is N/A on the Product page** (both Canvas and Published) because a single product's
  detail page has no product-card grid to vary — this is the page type, not a parity gap. Category's
  grid and Home's shelves are the two real surfaces, and both were already closed in H3-3.
- No cell in this matrix was filled in from a normalizer read alone; each LIVE cell traces to the actual
  rendering component cited in §7–§17 below.

## 7. Identity parity (structural, not conventional)

**Published:** `(storefront)/layout.tsx` is the single component every page under
`[country]/[locale]/(storefront)/**` (Home, Product, Category, cart, account, policies, …) renders
through. It resolves `displayName`, `logoUrl`, `themeStyle` (color + font), `compact`, and
`productCard` **before** it ever branches on `children` — none of those computations reference
`children` at all (confirmed by reading the file: every identity/theme value is derived from
`presentation`/`identity` alone, then handed to `Header`/`Footer`/`PublishedCardStyleProvider`, with
`children` passed through untouched as `{chrome}`'s inner `<main>` content). This means Home, Product
and Category cannot structurally diverge in identity — they are different `children` values passed into
one already-resolved layout, not three independent identity consumers that merely happen to agree today.

**Canvas:** `StorefrontPreviewCanvas.tsx` renders one `<header>` and one `<footer>` unconditionally; the
`page === "product" ? <ProductPagePreview/> : page === "category" ? <CategoryPagePreview/> : <homeDiv/>`
ternary sits **between** them, switching only the page body. `storeName`, `logo`, `vars`
(`presentationCssVars`), and `fontFamily` are all computed once, above that ternary, from the same
top-level `config` prop — again, not by convention but because the JSX literally has one header/footer
and the branch is scoped to the body alone.

No page-specific identity authority exists on either side. Changing the Product or Category preview
does not reset identity, fork branding, or touch the Draft lifecycle differently from Home — there is
no code path that could do so, since identity is resolved once per render, upstream of the page branch.

## 8. displayName

Confirmed via `publishedStoreName()` (storefront) / `previewStoreName()` (web) — both take `presentation`
+ a live-name fallback + a final string fallback, called once per render in the shared layout/Canvas
root. Fallback order (`branding.displayName` → live store name → translated "Shop"/"Store" string) is
unchanged from H3-1 and is exercised by the existing `ExperienceBuilder.identity.test.tsx` suite. No new
name field was added.

## 9. Logo / compactLogo

`publishedLogoUrl(presentation, compact)` (storefront) and the equivalent inline computation in
`StorefrontPreviewCanvas.tsx` both select `compactLogoDataUrl` only when `compact` is true (standard
logo otherwise, falling back to the standard logo if no compact logo is set). `compact` is
`header.style === "compact"` in both layers (plus `mobileViewport` on the Canvas, which has no
Published equivalent since the Published Header's own `md`/mobile responsive behavior is independent
of `header.style` — documented in the Canvas's own code comment, confirmed by reading `Header.tsx`).
Home/Product/Category read the identical resolved `logoUrl`/`logo` value — there is no per-page logo
state. Fallback to the display name text when no logo is set is unchanged (`StoreBrand.tsx` renders the
name `<span>` whenever `sanitizeLogoUrl` returns null).

## 10. favicon

`storefront/src/app/icon/route.ts` is a single, global Next.js file-convention route (served for every
page under the app, not per-route) that calls `fetchPublishedPresentation()` → `publishedFaviconUrl()`.
`fetchPublishedPresentation()` reads `fetchStorefrontConfig()`, which is wrapped in React's `cache()` and
is the **same function** `(storefront)/layout.tsx` calls for Header/Footer identity — so favicon and
chrome identity are guaranteed to read the same Published snapshot within a request, and neither can
ever see Draft (`fetchStorefrontConfig`'s own doc comment: *"Published presentation only... Draft is
never present on this payload"*). `publishedFaviconUrl` falls back to the logo when no favicon is set,
and to the hard-coded `/favicon.ico` static file when there is no presentation at all or the stored
value fails `sanitizeLogoUrl` — unchanged, pre-existing behavior, not touched by H3-1/2/3/4. Tenant/host
resolution is unchanged (the route performs no host-based lookup of its own; it relies on the same
resolved-Storefront fetch every other public page uses).

## 11. primaryColor

Both Canvas and Published call the byte-identical `presentationCssVars(primaryColor, radius)` (two
structurally identical `tokens.ts` files, confirmed unchanged by H3-3's own evidence pass and re-verified
here), applying the result as the single wrapper's inline CSS vars. Home/Product/Category share that one
wrapper. The new `layout.test.tsx` test (§19) proves this directly: a non-default `primaryColor` resolves
to the identical `style` object regardless of which page's content the layout wraps.

## 12. accentColor gate

Re-confirmed unchanged: `grep -n "accentColor"` across both `ControlPanels.tsx` files (web and
storefront) returns zero rendered controls — the field round-trips through the PHP normalizer and both
TS mirrors (accepted, validated, persisted) but no merchant-facing control, Canvas preview, or Published
consumer reads it for rendering. `web/src/modules/app-builder/theme-panel.tsx`'s own, unrelated use of
`accentColor` as a free-form App Builder token seed (not a Store Customizer control) is untouched, exactly
as it was in H3-2. Nothing in H3-3 or H3-4 touched this gate.

## 13. Typography (Cairo / Tajawal) regression

Re-ran the exact seam H3-2's P1 fix closed:

- `fontPresetFamilyStack('tajawal-geist')` still never references `--font-cairo` or the shared
  `--font-geist` (asserted by existing `tokens.test.ts` suites, both layers, still passing).
- `publishedThemeStyle()` still sets `fontFamily` as an own property on the same object that carries
  `--store-primary`, applied as one inline style on `(storefront)/layout.tsx`'s wrapper div — confirmed
  directly by the new `layout.test.tsx` test, which asserts a `tajawal-geist` config's resolved
  `fontFamily` contains `--font-geist-tajawal` and explicitly does **not** contain `--font-cairo`,
  identically across three simulated pages.
- Canvas: `StorefrontPreviewCanvas.typography.test.tsx`'s existing "same global font applies across
  Home, Product and Category" test still passes unmodified.
- No Draft leak, no runtime external font CDN: unchanged — `next/font/google` self-hosting, confirmed by
  the clean production builds (§22).

No regression found; no font architecture change made.

## 14. radius

Unchanged since H3-3 (confirmed parity-complete there, re-verified here): both layers call the same
`presentationCssVars(primary, radius)`, both apply `--store-radius` on their one shared wrapper. No code
touched.

## 15. density

Unchanged since H3-3. Home: `publishedHomeStackClass(density)` (storefront) vs. the Canvas's own literal
`density === "compact" ? "space-y-6 py-3" : "space-y-8 py-4 md:space-y-10 md:py-6"` — confirmed these are
the exact same two literal class strings, not just "the same kind of logic." Product/Category:
`publishedPageContainerPaddingClass(density)` / `pageContainerPaddingClass(density)`, closed in H3-3 and
re-verified unchanged here (`"py-3"` compact / `"py-5 md:py-6"` comfortable, both layers, both pages).

## 16. productCard

Unchanged since H3-3. Home shelves (`cardPad`/`publishedProductCardBodyClass`) and Category's grid (real
`ProductCard.tsx` on Published; the calibrated preview tile on Canvas) both already resolve from the one
`productCard` field. Product page has no product-card grid on either side (N/A, not a gap — §6).

## 17. header.style

Unchanged since H3-3 (confirmed parity-complete there). Published ties `compact` to exactly two things
(logo variant, utility-strip visibility); the Canvas computes the identical `compact` for the identical
two effects, documented in the Canvas's own code comment distinguishing it from the shell's independent
`md`/`lg` responsive behavior. Both read the one `header.style` field; Home/Product/Category render
through the one shared header.

## 18. Footer / public chrome

`Footer` is rendered once in `(storefront)/layout.tsx`, outside the page-switching `<main>` boundary —
structurally identical situation to Header (§7). The Canvas mirrors this: one `<footer>` block below the
page-switching ternary in `StorefrontPreviewCanvas.tsx`. No new Footer appearance control was added or
considered; only existing, already-configured behavior (`footer.showLogo`, `footer.tagline`,
`footer.copyright`, social links, WhatsApp placement, app-store links, business identity, SBC seal) was
traced, and all of it reads from the same single `presentation`/`config` object every other capability
in this report does.

## 19. Draft vs. Published lifecycle

- **No second lifecycle mechanism exists or was added.** `publishedPageContainerPaddingClass()`,
  `publishedThemeStyle()`, `publishedFaviconUrl()`, and every other `published*` helper in this report
  are pure functions of an already-resolved `StorefrontPresentationConfig | null` — none of them fetch,
  branch on an authoring flag, or read anything but the Published snapshot already fetched by the layout
  or the `/icon` route.
- **Draft cannot leak publicly**: `fetchStorefrontConfig()`'s own doc comment states Draft is never on
  this payload; the backend's own `StorefrontPresentationPublicRuntimeTest.php` (part of the full suite,
  §21) asserts this at the API contract level with dedicated tests —
  `public_runtime_never_exposes_an_unpublished_draft`, `host_isolation_never_returns_another_tenants_published_presentation`,
  `anonymous_workspace_draft_routes_are_unreachable`. None of this was touched by H3-1/2/3/4.
- **Switching Home/Product/Category does not create a new identity authority** — proven structurally in
  §7 and directly by the new tests in §20.
- **No H3 code bypasses H1 Version lifecycle.** H3-1/2/3/4 touched zero files under the Version
  Save/Duplicate/Publish/Schedule API or its backing services; the existing
  `ExperienceBuilder.versions/.publish/.schedule.test.tsx` suites (52+15+21 tests) ran unmodified in the
  full web Vitest run (§21) and passed.

## 20. New tests added (the only production-adjacent change in this slice)

Two focused regression tests, each proving the invariant in §7 directly against a **populated**
(non-default) config — not the already-covered default/null-presentation case:

1. **`storefront/src/app/[country]/[locale]/(storefront)/layout.test.tsx`** — new test
   `"resolves identical identity/theme/appearance for Home, Product and Category — no page-specific
   identity authority"`. Renders the real `StorefrontLayout` three times with three different
   `children` (standing in for Home/Product/Category) against one populated presentation
   (`displayName`, logo + compact logo, `primaryColor: "#7a2e8f"`, `fontPreset: "tajawal-geist"`,
   `radius: "sharp"`, `productCard: "compact"`, `header.style: "compact"`). Asserts: the resolved
   theme-wrapper `style` object is `toEqual` across all three renders and contains the correct Tajawal
   stack without Cairo; `Header`/`Footer` both receive the identical `storeName`/`logoUrl`
   (correctly the compact logo, since `header.style` is compact); `PublishedCardStyleProvider` receives
   `productCard: "compact"` in all three; and each render's own page content still passes through
   untouched as `children`.
2. **`web/src/modules/store-experience-builder/__tests__/StorefrontPreviewCanvas.crossPageIdentity.test.tsx`**
   (new file) — renders `StorefrontPreviewCanvas` with `page="home"/"product"/"category"` against the
   same kind of populated config, and asserts the rendered logo `<img src>` (correctly the compact logo)
   and the `--store-primary` CSS variable are identical across all three pages.

No production code was changed. Both tests pass against the current, unmodified architecture — they
exist to make a future accidental per-page fork fail loudly, per CUST-H3-ARCH-1 §11's "integrated QA"
requirement.

## 21. Backward compatibility

- `StorefrontPresentationNormalizer::VERSION` unchanged (still `3`). No PHP file changed (confirmed via
  `git status` before committing).
- `StorefrontPresentationNormalizerTest`'s existing `"a pre cust h2 document normalizes byte identically
  aside from the version bump"` test (part of the 33/33 suite, §22) continues to pass — a stored document
  missing every H2/H3 field still normalizes to `cairo-geist`/`comfortable`/`standard`/`"default"` radius
  and renders identically to before.
- No schema bump, no migration, no backfill, no new persisted field.

## 22. Mobile / desktop evidence

- Structural: Header/Footer are the same component instances regardless of viewport; `compact` already
  folds correctly at `md` via existing Tailwind responsive classes, unchanged by this slice.
- `web/e2e/store-brand-qa.spec.ts` (merchant preview, `/dev/trust-visual`) ran across its existing
  `[390, 430, 768, 1024, 1280, 1440]` width × `[ar, en]` matrix — **33/33 passed** (real headless
  Chromium), including no-horizontal-overflow and 44px-minimum touch-target assertions.
- `storefront/e2e/store-brand-qa.spec.ts` (published footer) ran its own matrix — **69/69 passed**.
- No new mobile-specific surface was introduced by this slice (no production code changed), so no new
  mobile evidence beyond the above regression run was needed.

## 23. RTL / LTR evidence

- `storefront/src/components/layout/DocumentShell.tsx` sets `<html lang dir>` once via
  `localeDirection(locale)`, for every route under `[country]/[locale]` — Home, Product and Category all
  inherit the same `dir` from this one ancestor; there is no per-page direction logic to diverge.
  `DocumentShell.test.tsx`'s existing RTL/LTR assertions ran unmodified and passed.
- `StorefrontPreviewCanvas`'s root `dir={locale === "ar" ? "rtl" : "ltr"}` is computed once per render
  from the `locale` prop, independent of `page` — confirmed by reading the code; exercised by the new
  cross-page test at `locale="ar"` and by the existing identity/typography suites at both locales.
- `web/e2e/store-brand-qa.spec.ts` asserts `<html dir>` directly for both `ar` and `en` across its full
  viewport matrix (§22) — passed.
- `storefront`'s `check-locale-parity.ts` — **all 5 locale files (`ar`, `de`, `es`, `fr`, `pl`) in sync
  with `en.json`**.

## 24. Accessibility

- No interactive control was added, removed, or restyled by this slice (no production code changed).
- Re-confirmed unchanged: `Header.tsx`'s skip-link, `aria-label` on the account icon button, and the
  footer's own `focus-visible:outline-store-footer-foreground` override (needed because the global focus
  ring is invisible on the footer's own background) — none of this was touched by H3-1/2/3/4.
- `StoreBrand.tsx`'s logo `<img alt={name}>` (meaningful, not decorative — the logo doubles as the
  home-link brand mark) is unchanged; H3-1's distinct-accessible-name fix for the three Identity upload
  controls (`"Store logo — Choose image"` etc.) is untouched and still covered by
  `ExperienceBuilder.identity.test.tsx`.
- `web/e2e/store-brand-qa.spec.ts`'s existing keyboard-focus-visible and touch-target assertions passed
  (§22) — no color-only state indicator was introduced or found.
- Compact density/header do not remove or shrink any interactive element below its existing tap target;
  only container/text padding and logo-variant selection change, as established in H3-3 and re-verified
  unchanged here.

## 25. Browser / visual QA evidence

Used only existing harnesses, per the task's explicit instruction not to build a new visual framework:

| Suite | Command | Result |
|---|---|---|
| web — store-brand-qa (merchant preview, `/dev/trust-visual`) | `npx playwright test e2e/store-brand-qa.spec.ts --project=desktop` | **33/33 passed** (real headless Chromium) |
| storefront — store-brand-qa (published footer) | `npx playwright test --config=playwright.brand-qa.config.ts --project=chromium` | **69/69 passed** (real headless Chromium) |

One test (`merchant preview state partial`, desktop) failed on a first concurrent run (five other heavy
local processes — two builds, the full PHP suite, the other Playwright suite — were competing for CPU at
the same moment) and **passed cleanly in isolation on immediate re-run** — ruled a transient resource-
contention flake per the task's own CI-triage guidance, not a regression: nothing in this slice touches
`/dev/trust-visual`, its fixture data, or any file the spec exercises.

No dedicated real-browser computed-style (font-family/color) comparison across actual
`Home`/`Product`/`Category` **routes** exists as infrastructure today — the two existing dev fixtures that
come closest (`/dev/product-visual`, `/dev/category-visual`, from CUST-H2-5) mount `ProductDetails`/
`CategoryBanner` directly for region-order parity, not identity/theme, and `/dev/trust-visual` is scoped
to the Footer trust section. Building a new one would be a new visual framework, which the task
explicitly says not to do. Instead, computed-style/font proof for this slice's actual claim (one shared
layout resolves identity/theme once, before branching on page content) was obtained the strongest way
available without a new harness: real React Testing Library DOM output from the actual production
`StorefrontLayout`/`StorefrontPreviewCanvas` components (§20), not jsdom approximations or string-only
assertions. This is stated explicitly rather than claimed as pixel/visual parity.

## 26. Actual gaps found

**None.** Every capability in the Evidence Matrix (§6) was already LIVE and already shared across
Home/Product/Category by construction, following H3-1/H3-2/H3-3. No consumer wiring was missing, no
Canvas/Published mirror diverged, and no Draft-lifecycle or tenant-isolation issue was found.

## 27. Fixes made

None to production code. Two focused regression tests added (§20) to lock in the parity this report's
evidence establishes, so a future regression is caught by CI rather than discovered in review.

## 28. Files changed

```
storefront/src/app/[country]/[locale]/(storefront)/layout.test.tsx                                    (modified)
web/src/modules/store-experience-builder/__tests__/StorefrontPreviewCanvas.crossPageIdentity.test.tsx  (new)
docs/reports/CUST-H3-4-IMPLEMENTATION-REPORT.md                                                        (new, this file)
```

No PHP file changed (confirmed via `git status` before committing).

## 29. Tests + exact results

| Suite | Command | Result |
|---|---|---|
| storefront — new/modified layout test | `npx vitest run "src/app/[country]/[locale]/(storefront)/layout.test.tsx"` | **4/4 passed** (1 new) |
| web — store-experience-builder module (focused) | `npx vitest run src/modules/store-experience-builder` | **237/237 passed** (24 files — 236 pre-existing + 1 new) |
| PHP — normalizer only | `php artisan test --filter=StorefrontPresentationNormalizerTest` | **33/33 passed** (166 assertions) — unchanged, confirms zero impact since no PHP file changed |
| web — full suite | `npx vitest run` | **2501/2501 passed** (335 files) |
| storefront — full suite | `npx vitest run` | **755/755 passed** (110 files — 754 pre-existing + 1 new) |
| PHP — full suite | `php artisan test` | **4968 passed, 56 failed, 51 skipped** (31030 assertions) — **identical counts** to CUST-H3-2/H3-3's own reports; all 56 failures are the same pre-existing environment clusters (missing `aws/aws-sdk-php` vendor package, missing `RESEND_API_KEY`/mail env, Fuel Stations module, `ProductOptionValueVisualTest`) — none reference `StorefrontPresentationNormalizer`, identity, or any file this PR touched |
| storefront — locale parity | `npx tsx scripts/check-locale-parity.ts` | **All 5 locale files (ar/de/es/fr/pl) in sync with en.json** |
| web/storefront — store-brand-qa Playwright (real Chromium) | see §25 | **33/33 (web) + 69/69 (storefront) passed** |

## 30. Typecheck

- `storefront/`: `npx tsc --noEmit -p .` — **clean, zero errors** (including the modified test file).
- `web/`: `npx tsc --noEmit -p .` — **15 pre-existing errors**, in files this PR never touched, matching
  the same baseline cluster CUST-H3-1/H3-2/H3-3 already documented (`pos/settings/configuration`,
  `commerce/appearance/section-{editing,instances,selection}.test.tsx`, `platform/integrations/gemini-card.test.tsx`,
  `documents/document-language-selector.test.tsx`, `global-application-controls-card.test.tsx`,
  `products/product-{multi-barcode-table,variants-panel,workspace}.test.tsx`,
  `documents/use-document-label-mode.test.tsx`, `import-jobs/useImportJobEngine.test.tsx`). **Zero errors
  in either file this PR changed.**
- `web/`: `next lint` is not configured in this repository (no ESLint config file exists; the command
  prompts interactively to scaffold one) — this is a pre-existing condition, unrelated to this slice, and
  out of this slice's bounded scope to fix.
- `storefront/`: `npx biome check` on the modified test file — **clean, no issues**.

## 31. Builds

- `web/`: `npm run build` — exit code `0` after a clean `.next` rebuild (an initial run hit a stale-cache
  `PageNotFoundError` for an unrelated route, `/accounting-settings/fiscal-years`, which exists on disk
  and is untouched by this PR; a clean rebuild resolved it, confirming it was a cache artifact from a
  concurrent dev-server run during QA, not a code issue).
- `storefront/`: `pnpm build` (Next 16.2.11, Turbopack) — exit code `0`, every route compiled including
  `/icon` and `/dev/trust-visual`.

## 32. CI

Both workflows that cover this PR's changed paths will run for real on GitHub:

- `storefront-ci.yml` (paths: `storefront/**`) — covers the modified `layout.test.tsx`.
- `store-brand-qa.yml` (paths include `web/src/modules/store-experience-builder/**`) — covers the new
  Canvas test file.
- `ci.yml` (PHP, sqlite + pgsql) — runs on every branch/PR regardless of path; will pass, since no PHP
  file changed and the full local run (§29) already confirms zero PHP impact.
- `web-ci.yml` (paths: `web/**`) — covers the new Canvas test file; will pass, local `npm run build`
  already succeeded (§31).

## 33. Risks / remaining gaps

- No dedicated real-browser (Playwright) computed-style comparison exists for identity/theme across the
  actual `Home`/`Product`/`Category` **routes** specifically (as opposed to the dev fixtures scoped to
  other concerns) — see §25 for why building one was judged out of this slice's bounded scope (a new
  visual framework) and what evidence was used instead.
- The pre-existing 56 PHP failures and 15 web typecheck errors (both fully unrelated to this PR, itemized
  in §29/§30) remain open, carried forward unchanged from CUST-H3-1/H3-2/H3-3 — not introduced or
  worsened by this slice.

## 34. Accounting entries

None. This slice adds no new financial operation, invoice, payment, or journal-affecting code path —
it is store-presentation/public-runtime verification only. No PHP file was changed.

## 35. Explicit confirmations

- ✅ No DB migration
- ✅ No new API
- ✅ No schema version bump (`StorefrontPresentationNormalizer::VERSION` stays `3`)
- ✅ No new persisted field
- ✅ No new identity authority (one shared layout/Canvas resolves identity once; no page-specific fork)
- ✅ No commerce truth change
- ✅ `accentColor` remains GATED (persisted, backward-compatible, no merchant-facing control, no Published consumer)
- ✅ Draft does not leak publicly (confirmed structurally and via the existing backend contract test suite)
- ✅ No Merge
- ✅ No Deploy
- ✅ No Production release

---

## Next step

Per CUST-H3-ARCH-1 §11, CUST-H3-4 is the last implementation slice before the **CUST-H3 Horizon Closure
Report**. That report is explicitly **not** started by this task and should only begin once this slice is
reviewed and merged.

---

# CUST-H3-4 READY FOR MERGE — OWNER APPROVAL REQUIRED
