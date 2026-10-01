# CUST-H3-2 — Implementation Report: Color + Typography Truth

## 1. Base SHA

`7b4dfe14b0705aa9af9467b2430e9133de846f2c` (confirmed as `origin/main` HEAD at session start — this matches the SHA the task brief named as the expected baseline).

## 2. Head SHA

`51dfa3e06ca849d5a106f78369df54da30190992`

(First-pass head, now superseded by the P1 fix in §5a below: `6eaeae5c330d37a41a5129605452a60ad2514c0c`.)

## 3. Branch

`feat/cust-h3-2-color-typography-truth`

## 4. PR number + URL

PR #1144 — https://github.com/safwan5001-source/Nebrax/pull/1144

## 5a. P1 review findings and fix (read this first)

Owner review of PR #1144 found two runtime-correctness bugs in the first pass. **Both are fixed in this revision.** Everything below this section that discusses Canvas/Published typography behavior describes the **fixed** state; §23 records exactly what was wrong in the first pass for the record.

### Root cause 1 — Published font variable declared on the wrong side of the cascade

The first pass set `--store-font-arabic` via inline style on `<div data-published-theme>` inside `(storefront)/layout.tsx`, but consumed it in a `body { font-family: ... }` rule in `globals.css`. `body` is an **ancestor** of that div. CSS custom properties only cascade **downward** — an ancestor's computed value can never see a property a descendant sets. `body`'s `font-family` therefore always resolved to the rule's own fallback (`var(--font-cairo)`), regardless of the merchant's actual published `fontPreset`. The public storefront would have kept rendering Cairo for every tenant, including ones that published `tajawal-geist`.

**Fix:** stop relying on a CSS custom property crossing that boundary at all. `publishedThemeStyle()` (`storefront/src/lib/presentation/public.ts`) now computes the resolved font stack directly in JavaScript and sets it as a literal `fontFamily` property **on the same object** that carries `--store-primary` and the other color vars — the object `(storefront)/layout.tsx` applies as one inline `style` on its theme wrapper div. The wrapper that owns the variable now also owns the property that consumes it, and every element inside it inherits that wrapper's own `font-family` normally (standard CSS inheritance, not custom-property cascade). `globals.css`'s `body` rule reverts to a fixed, unconditional Cairo/Geist default — it is now only ever the no-presentation fallback (when `publishedThemeStyle()` returns `undefined` and no wrapper div renders at all), never a path the Published preset is expected to drive.

### Root cause 2 — Geist's own Cairo fallback preempting Tajawal

`next/font`'s `fallback` option bakes the named fallback face directly into *that specific font instance's own* generated CSS value — this was already true and already documented in `DocumentShell.tsx`'s pre-existing comment explaining why `Geist({ fallback: ["Cairo"] })` is there: it makes `--font-geist` itself expand to `"Geist", Cairo` internally, not just `"Geist"`. The first pass built the `tajawal-geist` stack as `var(--font-geist), var(--font-tajawal), ...`, reusing that same Cairo-fallback Geist instance — which, once expanded, actually reads `"Geist", Cairo, Tajawal, ...`. Cairo (second in the expanded list) has full Arabic coverage and would answer for every Arabic glyph before the browser ever reached Tajawal (fourth). `tajawal-geist` would have been a complete visual no-op for Arabic text — Latin would correctly show Geist, but Arabic would silently still be Cairo.

**Fix:** a second, dedicated Geist instance, `Geist({ variable: "--font-geist-tajawal", fallback: ["Tajawal"] })`, declared alongside the original in both `DocumentShell.tsx` (storefront) and the new `presentation/fonts.ts` (web Canvas). `tajawal-geist` now resolves through this instance instead of the Cairo-fallback one. The original `--font-geist` is completely untouched — `cairo-geist` and every other existing consumer (notably `globals.css`'s `--font-sans` Tailwind alias) behave exactly as before. `fontPresetArabicVar()` (a single variable reference meant to be composed into a stack — the composition is exactly what caused this bug) is replaced by `fontPresetFamilyStack()`, which returns the **complete, correct, pre-composed stack** for a preset in one piece:

```ts
export function fontPresetFamilyStack(id: FontPresetId): string {
  return id === "tajawal-geist"
    ? "var(--font-geist-tajawal), var(--font-tajawal), system-ui, sans-serif"
    : "var(--font-geist), var(--font-cairo), system-ui, sans-serif";
}
```

`presentationCssVars()` no longer takes a `fontPreset` parameter and no longer emits `--store-font-arabic` — nothing consumes that variable anymore under the new architecture, so it was removed rather than left as a stale, unused key. It reverts to its original 2-argument signature, which also drops all risk to its other consumer (`web/src/modules/app-builder`, an unrelated feature — see §8).

### Files changed in this fix (14, all already covered by §17's file list below except as noted)

- `storefront/src/lib/presentation/tokens.ts` — `fontPresetArabicVar` → `fontPresetFamilyStack`; `presentationCssVars()` back to 2 args.
- `storefront/src/lib/presentation/public.ts` — `publishedThemeStyle()` sets `fontFamily` directly on its own returned style object.
- `storefront/src/app/globals.css` — `body` rule reverted to the fixed Cairo/Geist default.
- `storefront/src/components/layout/DocumentShell.tsx` — adds the second, Tajawal-fallback Geist instance.
- `storefront/src/components/customizer/StorefrontPreviewCanvas.tsx` — uses `fontPresetFamilyStack()` directly.
- `web/src/modules/store-experience-builder/presentation/tokens.ts` — same resolver change as the storefront mirror.
- `web/src/modules/store-experience-builder/presentation/fonts.ts` — adds the second, Tajawal-fallback Geist instance for the Canvas.
- `web/src/modules/store-experience-builder/StorefrontPreviewCanvas.tsx` — uses `fontPresetFamilyStack()` directly.
- Test files updated/added to prove the fix (full list and results in §18): `storefront/src/components/layout/DocumentShell.test.tsx`, `storefront/src/lib/presentation/__tests__/{tokens,public}.test.ts`, `storefront/src/components/customizer/__tests__/StorefrontPreviewCanvas.typography.test.tsx`, `web/src/modules/store-experience-builder/__tests__/{presentation,StorefrontPreviewCanvas.typography}.test.ts(x)`.

No PHP file changed in this fix pass (confirmed via `git status` before committing) — the bug and its fix are entirely in the TypeScript font-resolution layer, so the PHP test results in §18 are unchanged from the first pass and were not re-run.

### Confirmations requested by the review

- **Tajawal is no longer shadowed by Cairo.** `fontPresetFamilyStack('tajawal-geist')` never references `--font-cairo` or the shared `--font-geist` (asserted directly by new tests in both `tokens.test.ts` files and `presentation.test.ts`); it resolves through `--font-geist-tajawal`, whose own `fallback` names Tajawal, not Cairo (asserted directly by the new `DocumentShell.test.tsx` test, which inspects both Geist calls' actual `fallback` options).
- **The Published wrapper actually applies the chosen font.** `publishedThemeStyle()`'s returned object carries `fontFamily` as an own property alongside `--store-primary` (asserted directly in `public.test.ts`), and that whole object is what `(storefront)/layout.tsx` applies as the wrapper's single inline `style` — there is no longer any point where a CSS custom property is expected to cross an ancestor/descendant boundary it cannot cross.

---

## 5. Tajawal verification evidence

Before touching any enum or persistence, Tajawal was verified against the exact seam the storefront already uses (`next/font/google`, as declared in `storefront/src/components/layout/DocumentShell.tsx`):

- **Import support**: `Tajawal` is a named export of `next/font/google` in both Next.js versions this monorepo runs — confirmed by reading `node_modules/next/dist/compiled/@next/font/dist/google/font-data.json` in both `web/` (Next 15.5.19) and `storefront/` (Next 16.2.11).
- **Arabic glyph coverage**: that metadata lists `subsets: ["arabic", "latin"]` for Tajawal — full Arabic coverage, matching Cairo's own `arabic` subset usage.
- **Weights**: available weights are `200, 300, 400, 500, 700, 800, 900` — **no 600**. Cairo (today's default) uses `400/500/600/700/800`. The implementation requests `400/500/700/800` for Tajawal — the closest approximation without requesting an unavailable cut, and without widening the weight set beyond what Cairo already ships.
- **Latin/fallback behavior**: unaffected — the locked decision keeps Latin on Geist in both presets (see §9), so Tajawal's own Latin subset is not consumed; only its Arabic glyphs are used.
- **Build support**: confirmed by a full production build of `storefront/` (`pnpm build`, Next 16.2.11, Turbopack) and `web/` (`npm run build`, Next 15.5.19), both re-run after the P1 fix with the two-Geist-instance architecture — both succeeded (§20).
- **SSR/hydration behavior**: `next/font`'s `variable` strategy (the same one Cairo/Geist already use) sets a CSS custom property via a class name on `<body>`/the Canvas root at render time — no client-only font-swap, no hydration mismatch risk. Covered by `DocumentShell.test.tsx`'s assertions that both `--font-tajawal` and `--font-geist-tajawal` are present on every document, not only Arabic ones.
- **No runtime external CDN request**: `next/font/google` self-hosts at build time (downloads once during `next build`, serves from the app's own origin after). No `@import` or Google Fonts `<link>` was added anywhere.
- **Runtime/build impact**: all four faces/instances (Cairo, Tajawal, and the two Geist instances) are declared unconditionally on every document, but the browser only ever *fetches* the file actually referenced by the resolved `font-family` for rendered text — a store on `cairo-geist` never downloads the Tajawal file, and vice versa; a store on `cairo-geist` never pulls the Tajawal-fallback Geist instance's metrics either, since nothing in its resolved stack references `--font-geist-tajawal`.

**Conclusion: Tajawal passed verification on every point.**

## 6. Was Tajawal activated or GATED, and why

**Activated.** `tajawal-geist` is now a real, selectable merchant preset in:

- `App\Support\Commerce\StorefrontPresentationNormalizer::FONT_PRESETS` (PHP)
- `web/src/modules/store-experience-builder/presentation/tokens.ts::FONT_PRESETS`
- `storefront/src/lib/presentation/tokens.ts::FONT_PRESETS`

All three are now `['cairo-geist', 'tajawal-geist']`, consistently.

## 7. Color behavior

Unchanged from the locked decision — verified, not re-litigated, and untouched by the P1 fix:

- `primaryColor` remains the single LIVE brand-color control: color picker + hex input (`ThemePanel` in both `ControlPanels.tsx` files), fail-closed invalid-hex handling (`isSafeHexColor()`, falls back to the active theme preset's primary), derived readable foreground (`primaryForeground()`, WCAG contrast-based), derived hover/soft variants (`mixHex()`), and the ring/focus alias (`--ring`) — all in `presentationCssVars()`, which is now **byte-identical to its pre-CUST-H3-2 form** (the P1 fix removed the `fontPreset` parameter it had briefly gained, restoring the original 2-argument signature and output shape exactly).
- Canvas and the Published public storefront both consume the same `presentationCssVars()` output (web's own copy and storefront's own copy, structurally identical) — unchanged parity.
- No page-specific color was introduced. Product/Category/Home all read the same top-level `config.primaryColor`.

## 8. accentColor status

**Still GATED/hidden — unchanged, because there was nothing to change.** Before writing any code, both `web/src/modules/store-experience-builder/ControlPanels.tsx` and `storefront/src/components/customizer/ControlPanels.tsx` were grepped for `accentColor`: neither renders any control for it today. The only places `accentColor` appears are:

- `StorefrontPresentationNormalizer::normalize()` (PHP) — accepts/validates/persists it (`isSafeHexColor()` → the value, else `null`).
- `normalizePresentationConfig()` (web and storefront TS mirrors) — same round-trip behavior.
- `messages.ts` (both mirrors) — a translation string (`"لون ثانوي"` / `"Accent color"`) that is not referenced by any rendered `<Field>`/`<select>`/color input in either `ControlPanels.tsx`. It is dead label text, left as-is.
- `web/src/modules/app-builder/theme-panel.tsx` — a **different, unrelated product** ("App Builder", a free-form generic app-theming tool, not the Store Customizer). It reads `accentColor` off the real `StorefrontPresentationConfig` only as a starting-point token for its own `schema.theme.tokens` free token set (`THEME_TOKEN_KEYS`), explicitly documented in that file's own header comment as out of CUST-H3 scope and covered by its own evidence doc (`APP-BUILDER-8-UX-EVIDENCE-PASS.md`). This is not a Store Customizer control and was left untouched. It also calls `presentationCssVars()` with its original 2 arguments — the P1 fix's reversion to that exact signature means this file required **zero changes**, in either direction, across both passes.

Added a new PHP test (`accent_color_round_trips_without_becoming_a_public_consumer_bound_field`) making this explicit: `accentColor` round-trips through two normalization passes, invalid hex still fails to `null`, and the default stays `null`.

## 9. Typography runtime architecture

**Contract (as fixed):** `fontPreset → fontPresetFamilyStack(fontPreset) → the complete, literal font-family value → applied directly as the `fontFamily` style property on the element that needs it`.

`fontPresetFamilyStack()` (in both `tokens.ts` mirrors) is the deterministic resolver, returning a complete stack rather than a single variable meant to be composed (see §5a for why that distinction matters):

```ts
export function fontPresetFamilyStack(id: FontPresetId): string {
  return id === "tajawal-geist"
    ? "var(--font-geist-tajawal), var(--font-tajawal), system-ui, sans-serif"
    : "var(--font-geist), var(--font-cairo), system-ui, sans-serif";
}
```

Latin always resolves through a Geist instance — `--font-geist` for `cairo-geist`, the dedicated `--font-geist-tajawal` for `tajawal-geist` — no heading/body split, matching the locked decision that there is exactly one merchant-facing Typography control. `presentationCssVars(primary, radius)` is unchanged from its pre-CUST-H3-2 form (§7) and carries no typography concern at all anymore.

**Storefront runtime (published):**

- `publishedThemeStyle()` (`storefront/src/lib/presentation/public.ts`) computes `fontFamily: fontPresetFamilyStack(presentation.fontPreset)` and returns it as part of the same object that carries `--store-primary` etc. It is called exactly where it already was, in `(storefront)/layout.tsx`, which applies that whole object as one inline `style` on `<div data-published-theme>` — the existing mechanism color already used, now also carrying the resolved font.
- `storefront/src/app/globals.css`'s `body { font-family: ... }` rule is the **fixed, unconditional** Cairo/Geist default — it only governs routes where `publishedThemeStyle()` returns `undefined` (no presentation at all, so no wrapper div renders) and every pre-CUST-H3-2 stored document (which normalizes to `cairo-geist`, producing the identical resolved stack via the wrapper anyway).
- `DocumentShell.tsx` (the actual next/font loader, one level above where presentation is fetched) declares both Geist instances and both Arabic faces unconditionally. See §16 for why this shape — not DocumentShell reading presentation — is the correct architecture, and why it still holds after the fix.

**Canvas runtime (web Customizer):**

- `web/src/modules/store-experience-builder/presentation/fonts.ts` loads two Geist instances (Cairo-fallback and Tajawal-fallback), Cairo and Tajawal via `next/font/google`, scoped to this module only (the ERP admin app's own chrome font, IBM Plex Sans Arabic, is untouched).
- `StorefrontPreviewCanvas.tsx`'s root div carries `PREVIEW_FONT_VARIABLES` (all four `.variable` class names) and resolves `fontFamily: fontPresetFamilyStack(config.fontPreset)` directly — no more manual template-string composition, which is exactly what let the Cairo-shadowing bug hide in the first pass.

**Why the Canvas needed real font loading, not just a string swap** (unchanged from the first pass — this reasoning was correct, only the *stack itself* had the bug): before this slice, the web admin app never registered the "Cairo"/"Geist" font faces anywhere. The Canvas's `fontFamily` literal therefore only ever resolved to whatever the host OS happened to have installed under those names — not the real storefront face. Loading the real faces is what makes `cairo-geist` finally match the Published storefront and what makes `tajawal-geist` visibly different, as required — and the P1 fix is what makes that difference actually resolve to Tajawal instead of silently staying Cairo.

## 10. PHP/web/storefront parity

All three normalizers accept exactly `['cairo-geist', 'tajawal-geist']` and fail closed to `cairo-geist` for anything else — verified by one dedicated test in each layer, asserting identical behavior. Unaffected by the P1 fix (the fix is entirely in the TS font-*rendering* layer downstream of normalization, not in the enum-*acceptance* layer):

| Layer | Test | Result |
|---|---|---|
| PHP | `StorefrontPresentationNormalizerTest::font_preset_accepts_known_values_and_fails_closed_to_cairo_geist` | ✓ |
| web | `presentation.test.ts` — `'CUST-H3-2: accepts the verified tajawal-geist preset and fails closed to cairo-geist for unknown values'` | ✓ |
| storefront | `config.test.ts` — `'CUST-H3-2: accepts the verified tajawal-geist preset and fails closed to cairo-geist for unknown values'` | ✓ |

No layer accepts a value another rejects, and no layer's default differs.

## 11. Canvas evidence

- `StorefrontPreviewCanvas.typography.test.tsx` (web and storefront, both updated for the fix): `cairo-geist` resolves to `var(--font-geist), var(--font-cairo), system-ui, sans-serif` (unchanged); `tajawal-geist` now resolves to `var(--font-geist-tajawal), var(--font-tajawal), system-ui, sans-serif` **and is asserted to never contain `--font-cairo`** — the specific regression the review flagged; an unknown value fails closed to the Cairo stack; the same global font applies identically across Home/Product/Category previews (looped assertion over all three `page` values, now asserting the corrected Tajawal stack).
- `ControlPanels.typography.test.tsx` (web and storefront, unaffected by the fix — the Typography `<select>`'s behavior was never the bug): the control is enabled, offers exactly `["Cairo + Geist", "Tajawal + Geist"]`, and selecting Tajawal patches only `fontPreset`.
- `StorefrontPreviewCanvas.marketCard.test.tsx` (pre-existing, 16 tests) — re-ran green after the fix, confirming no regression to the existing AWJ Market card-proportion preview logic that shares the same component.

## 12. Published storefront evidence

- `public.test.ts` (storefront): `publishedThemeStyle(DEFAULT_PRESENTATION_CONFIG).fontFamily` is `'var(--font-geist), var(--font-cairo), system-ui, sans-serif'`, asserted **on the same object and in the same test** as `--store-primary`, directly proving the wrapper that applies this style owns both; with `fontPreset: "tajawal-geist"`, `.fontFamily` is `'var(--font-geist-tajawal), var(--font-tajawal), system-ui, sans-serif'` and is asserted to **not** contain `--font-cairo` or the bare `--font-geist` reference — the exact two things that were broken in the first pass.
- `tokens.test.ts` (storefront): `fontPresetFamilyStack()` is tested directly for both presets and for an unknown value (fails closed), plus an explicit test that the Tajawal stack never references Cairo or the shared Geist instance. `presentationCssVars()` is confirmed to no longer carry any `--store-font-arabic` key at all (`not.toHaveProperty`), closing out the now-removed variable cleanly rather than leaving a stale, unused one.
- `DocumentShell.test.tsx` asserts, directly against the real mocked `Geist(...)` call arguments (not just string literals elsewhere), that two distinct Geist calls happen, that the Tajawal-fallback instance's `fallback` option is exactly `["Tajawal"]`, and that it does **not** contain `"Cairo"` — proving the root cause (§5a, root cause 2) is actually closed at the font-loader level, not just in a downstream string.
- Full production builds of both `storefront/` and `web/` (re-run after the fix) compiled every route, including the real `(storefront)/layout.tsx` tree and the Customizer, with no error (§20).

**On "proving the actual effective hierarchy," per the review's request:** this revision proves correctness at three independent levels rather than string assertions alone — (1) the font-loader level (`DocumentShell.test.tsx` inspects the real arguments passed to the mocked `Geist()`/`Cairo()`/`Tajawal()` calls, which is the actual mechanism, not a stand-in for it), (2) the resolver level (`fontPresetFamilyStack()` unit tests), and (3) the consumption level (`publishedThemeStyle()` and the Canvas components' own rendered `style.fontFamily`, read back from real React Testing Library DOM output via `container.querySelector(...).style.fontFamily`, not a mock). No browser/computed-style or visual (Playwright) pass was run — see §23, which carries this forward from the first pass as a still-open, explicitly flagged gap rather than a new omission.

## 13. Draft isolation evidence

Unchanged from the first pass, and unaffected by the P1 fix (which touched only how the already-Published-only presentation's font resolves, not what data reaches that computation). `publishedThemeStyle()` is called exactly once, in `(storefront)/layout.tsx`, on `identity.presentation` — the object returned by `fetchStorefrontConfig()`, which is explicitly documented (`public.ts`'s own file header: *"Draft is unreachable here"*) and architecturally scoped to Published-only data. The Canvas (which *does* read Draft, by design) is a structurally separate component tree that the public storefront never imports or renders.

## 14. RTL/LTR

- `DocumentShell.test.tsx`'s existing RTL/LTR assertions (Arabic `lang=ar dir=rtl`, English `lang=en dir=ltr`) continue to pass unmodified — neither the first pass nor the P1 fix touches `dir`/`lang` logic.
- Both Canvas typography tests pass with `locale="en"`; the underlying `dir={locale === "ar" ? "rtl" : "ltr"}` logic on the Canvas root is untouched — RTL continues to be driven purely by locale, not by font choice.
- Both fonts (Cairo and Tajawal) carry full Arabic glyph coverage (§5), so RTL Arabic rendering is equally complete under either preset, **once the P1 fix ensures Tajawal is actually reached** rather than shadowed by Cairo.

## 15. Mobile

No layout, spacing, or control structure changed by either pass. The Typography `<select>` reuses the exact same `Field`/`selectClass` pattern as the pre-existing Density and Radius selects, already exercised at the Customizer's 390px simulated mobile viewport by `StorefrontPreviewCanvas.marketCard.test.tsx` (re-ran green after the fix, §11).

## 16. Accessibility

- The Typography `<select>` keeps its existing implicit `<label>` association — unaffected by the P1 fix, which never touched `ControlPanels.tsx`.
- Focus/ring semantics for color are untouched — `presentationCssVars()`'s primary/foreground keys are, after the fix, **exactly** what they were before CUST-H3-2 touched this file at all (§7).

**Architecture note (the task's explicit STOP condition on this point, and the P1 review's own "preferred direction"):** `DocumentShell.tsx` — the component that actually calls `next/font/google` — sits *above* `(storefront)/layout.tsx` in the component tree. DocumentShell has no safe, existing way to read `presentation.fontPreset` without a second data-fetch or a new context threaded through the whole app shell — exactly the "architecture widening" the task said to stop and report on, had it been required.

It was not required, and the P1 fix is a cleaner instance of the same answer the first pass intended but implemented incorrectly: DocumentShell unconditionally declares every face/instance a preset could need (as it already did for Cairo), and the Published-presentation-aware layer (`(storefront)/layout.tsx`, via `publishedThemeStyle()`) decides which **complete, literal font-family value** to apply, directly, as an inline style property on its own existing theme wrapper div. The review's "preferred direction" — *"apply the semantic storefront font-family on the published-theme wrapper... rather than expecting a descendant CSS variable to affect body"* — is implemented exactly as stated: the wrapper now owns `fontFamily` as a real, consumed CSS property on itself, not as a custom property it merely declares for some other, higher element to (unsuccessfully) consume. No new authority, no second fetch, no widened Published Snapshot boundary — the only change from the first pass's intent is *where* the resolved value is consumed, not *what* fetches or decides it.

## 17. Files changed

**First pass:** 26 files, +620/−20 (PHP: 2, storefront: 12, web: 10 — including 2 new test files and 2 new infrastructure/support files; full list in the original diff, unchanged by the fix except where noted below).

**P1 fix (this revision):** 14 files, +275/−108, **all TypeScript/CSS, zero PHP** (confirmed via `git status` before committing — the bug and its fix live entirely in the font-resolution layer downstream of the PHP-validated enum):

- `storefront/src/app/globals.css`
- `storefront/src/components/customizer/StorefrontPreviewCanvas.tsx`
- `storefront/src/components/customizer/__tests__/StorefrontPreviewCanvas.typography.test.tsx`
- `storefront/src/components/layout/DocumentShell.test.tsx`
- `storefront/src/components/layout/DocumentShell.tsx`
- `storefront/src/lib/presentation/__tests__/public.test.ts`
- `storefront/src/lib/presentation/__tests__/tokens.test.ts`
- `storefront/src/lib/presentation/public.ts`
- `storefront/src/lib/presentation/tokens.ts`
- `web/src/modules/store-experience-builder/StorefrontPreviewCanvas.tsx`
- `web/src/modules/store-experience-builder/__tests__/StorefrontPreviewCanvas.typography.test.tsx`
- `web/src/modules/store-experience-builder/__tests__/presentation.test.ts`
- `web/src/modules/store-experience-builder/presentation/fonts.ts`
- `web/src/modules/store-experience-builder/presentation/tokens.ts`

No file outside this list and the first pass's original 26 was touched. No new file was added in the fix pass (all changes are to files the first pass already created or modified).

## 18. Tests and exact results

**Test-infrastructure note (first pass, unchanged):** `web/vitest.setup.ts` mocks `next/font/google` globally for web's Vitest run, since `next/font/google` resolves through a Next.js-specific build-time transform that does not exist under plain Vitest. Explicit named exports, not a `Proxy` (an earlier `Proxy`-based attempt caused Vitest to hang indefinitely, since a `Proxy` answering every property access — including `then` — makes the mocked module look like a thenable to anything that duck-types it).

**Test-infrastructure note (P1 fix, new):** `DocumentShell.tsx` now calls `Geist(...)` **twice** (two distinct instances). `DocumentShell.test.tsx`'s mock was updated from capturing one `fontOptions.geist` object (which a second call would have silently overwritten) to an array `fontOptions.geistCalls` capturing every call, with the mock returning each call's own requested `variable` instead of a single hardcoded string — otherwise both instances would have collapsed onto the same mocked class name and the new fix-proving assertions would have been unable to tell them apart.

| Suite | Command | Result |
|---|---|---|
| PHP — normalizer only | `php artisan test --filter=StorefrontPresentationNormalizerTest` | **33/33 passed** (166 assertions) — unchanged, not re-run (no PHP file touched by the fix) |
| PHP — full suite | `php artisan test` | **4968 passed, 56 failed, 51 skipped** (31030 assertions) — unchanged, not re-run; see first-pass analysis below |
| web — store-experience-builder module | `vitest run src/modules/store-experience-builder` | **229/229 passed** (22 files) — re-run after the fix |
| web — full suite | `npm run test` | **2493/2493 passed** (333 files) — re-run after the fix |
| storefront — presentation + customizer + DocumentShell | `vitest run src/lib/presentation src/components/customizer src/components/layout/DocumentShell.test.tsx` | **99/99 passed** (15 files) — re-run after the fix |
| storefront — full suite | `pnpm test` | **748/748 passed** (110 files) — re-run after the fix |

**On the 56 PHP failures (carried forward from the first pass, unchanged):** none touch a file this PR has ever changed (confirmed again after the fix pass, which touched zero PHP files), and none reference `fontPreset`, `accentColor`, `StorefrontPresentationNormalizer`, or anything in the Store Customizer presentation path. They fall into four unrelated, environment-caused clusters — `ProductMediaR2*`/`R2*` tests (missing `aws/aws-sdk-php` vendor package in this sandbox), the Fuel Stations module (separate business domain), `AuthRecoveryTest`/`ResendMailTransportTest` (missing `RESEND_API_KEY`/mail environment), and `ProductOptionValueVisualTest` (unrelated product visual-type assertions). Full detail retained from the first pass; not re-derived since nothing PHP changed.

## 19. Typecheck

- `storefront/`: `npx tsc --noEmit` — clean, zero errors (re-run after the fix).
- `web/`: `npx tsc --noEmit -p .` — the same pre-existing baseline errors present on unmodified `origin/main` (re-verified after the fix: identical error list to the first pass's `git stash` comparison, all in unrelated test files). Zero new errors from either pass.

## 20. Builds

- `storefront/`: `pnpm build` (Next 16.2.11, Turbopack) — **succeeded** after the fix, all 75 routes compiled including `/dev/trust-visual`, confirming the two-Geist-instance architecture (`DocumentShell.tsx` now calling `Geist()` twice with different `fallback` options) compiles cleanly.
- `web/`: `npm run build` (Next 15.5.19) — **succeeded** after the fix, confirming the Canvas's own two-Geist-instance `fonts.ts` compiles cleanly.

## 21. CI status

Not yet observed on this revision. `.github/workflows/storefront-ci.yml` (Biome check + locale parity + typecheck + Vitest) and `.github/workflows/web-ci.yml` (Vitest + build) were replicated locally, in full, against the fixed code, with matching green results (§18, §19, §20, plus `pnpm check` and `pnpm check:locales`, both green). `.github/workflows/ci.yml` (PHP) was not re-run, since no PHP file changed in this fix.

## 22. Backward compatibility

- **Enum addition only** — unaffected by the fix. `FONT_PRESETS` gained one value in all three layers; `cairo-geist` remains first, default, and the fail-closed fallback.
- **No DB migration, no backfill, no schema version bump.** `StorefrontPresentationNormalizer::VERSION` is unchanged (still `3`).
- **A merchant who already selected `cairo-geist`** (the only value ever possible before this PR) sees **zero visual change**, on both Canvas and the Published storefront — and this claim is now actually load-bearing-correct rather than merely asserted: `cairo-geist`'s resolved stack (`var(--font-geist), var(--font-cairo), system-ui, sans-serif`) is **identical before and after the P1 fix**, because the fix only added a *second*, separate Geist instance for `tajawal-geist`; it never touched the original `--font-geist` instance or the `cairo-geist` branch of `fontPresetFamilyStack()`/`fontPresetArabicVar()` (both old and new resolver functions return the exact same string for `cairo-geist`). This is directly asserted by the unchanged `"cairo-geist resolves to the Geist/Cairo stack (unchanged default behavior)"` tests in both `StorefrontPreviewCanvas.typography.test.tsx` files, which needed **no edits** in the fix pass.
- **Forward safety:** an unknown future `fontPreset` value still falls back to `cairo-geist` at both the normalizer (PHP/web/storefront enum acceptance) and resolver (`fontPresetFamilyStack()`) layers — the fix added an explicit fail-closed test for the resolver layer specifically (§9, §12).

## 23. Risks / remaining gaps

- **This PR shipped a first pass with two real runtime-correctness bugs** (§5a) that would have made `tajawal-geist` render identically to `cairo-geist` on the public storefront (both root causes independently prevented Tajawal from ever actually being selected for rendered Arabic text) — i.e., exactly the "LIVE control that is a persisted no-op" anti-pattern CUST-H3-2 exists to close, reintroduced by this PR's own first implementation of the fix for it. Both are now closed and verified at the font-loader argument level (§12), not merely by string assertions one level removed from the actual mechanism. This is recorded here deliberately, not smoothed over, because it is the material fact an owner approving this PR needs.
- **Tajawal's missing 600 weight** — unchanged from the first pass, still a deliberate, documented approximation (§5).
- **CI has not yet run** on this revision (§21).
- **No visual (Playwright) screenshot comparison was run** in either pass. The new tests read real rendered DOM `style.fontFamily` via React Testing Library (not mocked), and `DocumentShell.test.tsx` reads the real arguments passed to the (mocked) `next/font/google` functions — stronger than pure string assertions, but still short of an actual browser computed-style or pixel comparison. Given this PR's own history of a first-pass bug that unit tests alone did not exist to catch (because the first pass never asserted "does not contain Cairo" — only "equals the expected string," which was itself wrong), **a visual QA pass before merge is a stronger recommendation now than it was in the first-pass report**, not merely a carried-forward note.

## 24. Explicit confirmations

- ✅ No DB migration
- ✅ No new API
- ✅ No schema version bump (`StorefrontPresentationNormalizer::VERSION` stays `3`)
- ✅ No custom font upload (all faces/instances load through the existing `next/font/google` self-hosted seam only)
- ✅ No new font preset (still exactly `cairo-geist` and `tajawal-geist`)
- ✅ No new architecture authority (Published Snapshot remains the sole public-runtime source; DocumentShell still never reads presentation — see §16)
- ✅ No Merge performed
- ✅ No Deploy performed
- ✅ No Production release performed

---

## Next step after H3-2

**CUST-H3-3 — Global Component Appearance Parity.**

---

# CUST-H3-2 READY FOR RE-REVIEW — OWNER APPROVAL REQUIRED
