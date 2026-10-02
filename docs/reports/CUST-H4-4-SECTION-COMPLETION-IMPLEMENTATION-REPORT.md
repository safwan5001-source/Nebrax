# CUST-H4-4 — Banner / Benefits / Custom Content / App Promo Completion — Implementation Report

**Horizon:** CUST-H4 — Section Library & Section Quality
**Slice:** H4-4 (Banner / Benefits / Custom Content / App Promo completion)
**Base SHA:** `30ead922dbaf40a20bd7b10ac839876310e0de18` — `feat(store): use real catalog data in H4 Canvas (#1167)` (verified via `git fetch origin main && git rev-parse origin/main` at task start — confirmed this is `origin/main`'s own HEAD and the merged H4-3 PR, not assumed from the task brief)
**Head SHA:** updated in §20 after the second review-fix round (branch `feat/cust-h4-4-section-completion`; was `94ecc91abdab022ec9875c05bf6cdbb0f98da098` at the start of this round, and `b7aaa80b7dbe4d678a1551a6f7dc222e3351116e` after the first review-fix round)
**Branch:** `feat/cust-h4-4-section-completion` (the task's own suggested name; the environment did not require a different one)
**PR:** [safwan5001-source/Nebrax#1172](https://github.com/safwan5001-source/Nebrax/pull/1172), open against `main`, not merged

---

## 0. Final review fixes (this update)

Two P2 review threads and one real, diff-caused Storefront CI failure were raised on PR #1172 after initial open. All three are fixed in this update — see §19 for the full account (root cause, fix, tests, final CI state). Summary:

- **App Promo URL fields now tolerate normal character-by-character typing.** `ExperienceBuilder.updateDraft` normalizes the whole config synchronously on every `onChange`, and the apps normalizer replaces any not-yet-complete URL with `""` — a controlled input bound directly to `config.apps.iosUrl`/`androidUrl` was wiped after the first keystroke. Fixed with a shared `AppUrlField` component (local draft while editing, commits — and only then normalizes — on blur), applied to both the new `AppPromoFields` and the pre-existing `AppsPanel` (which had the identical bug, since both panels edit the same `config.apps` data).
- **Banner `imageAlt` truncation is now Unicode-code-point-aware in both TypeScript normalizers**, matching the PHP server-authoritative normalizer's `mb_substr` semantics exactly. `.slice(0, 150)` counted UTF-16 code units, silently halving a 150-emoji alt text and risking an unpaired surrogate at the boundary; `truncateToCodePoints()` (`Array.from(value).slice(0, max).join("")`) fixes both twins.
- **Storefront CI's real failure**: `storefront (lint + typecheck + test)` failed on a genuine Biome lint/format violation introduced by this PR's own new files (an unsorted import, two unwrapped long lines) — not a flake. Fixed with `pnpm check --write`.

---

## 1. Scope actually implemented

Per the task brief and `CUST-H4-ARCH-1-SECTION-LIBRARY-ACTIVATION-CONTRACT.md` §18–§22/§35 (H4-4's own definition: "small polish items on sections already confirmed LIVE... treated as completion/polish, not rebuilding"):

- **Banner**: added an optional, bounded, backward-compatible `imageAlt` field to `BannerContent`, closing the one named accessibility gap from H4-1 (§18, §29). Wired into both the Canvas and Published `<img>` renderers, and into `BannerFields`' own editor panel.
- **App Promo**: added a real inline Content tab (`AppPromoFields`) to the section's own settings panel in `ControlPanels.tsx`, replacing the static "edit this from Apps settings" note, closing the UX-consistency gap from H4-1 (§22). Reuses `config.apps`/the existing `patch` function and the already-shipped URL validators — no new contract, no new persistence.
- **Benefits** and **Custom Content**: confirmed already LIVE and complete per H4-1's own evidence (§19, §20) and my own direct re-reading of their contracts, normalizers, and both renderers. No code changes — only new focused tests proving the existing bounds/safety/parity hold, per the task's own instruction not to churn working code.
- **Tests**: added focused coverage for all four sections across three layers (PHP normalizer, Canvas/`web`, Published/`storefront`), plus a new Playwright visual-QA spec.

**Explicitly not touched**, per the task's scope guards: Featured's picker/batching (H4-5), Offers (H4-6/H4-7), `storefront/src/components/customizer/*` (confirmed via `grep` to be dev-only mirror tooling used solely by `/dev/trust-visual`, not the real merchant editor — out of scope), checkout/cart/pricing, and no new media-upload architecture (Banner stays https-URL-only, per H4-1 §24's explicit decision that this is sufficient for H4 closure).

---

## 2. Files changed

```
app/Support/Commerce/StorefrontPresentationNormalizer.php                                      |   7 +   (M)
storefront/src/components/home/AppPromoBand.test.tsx                                            |  32 +   (M)
storefront/src/components/home/BannerBand.tsx                                                   |   4 +-  (M)
storefront/src/components/home/__tests__/SectionBands.h4-4.test.tsx                             | 174 +   (A, new)
storefront/src/lib/presentation/__tests__/section-content.h4-4.test.ts                          |  98 +   (A, new)
storefront/src/lib/presentation/section-content.ts                                              |  10 +   (M)
tests/Feature/StorefrontPresentationNormalizerTest.php                                          | 100 +   (M)
web/e2e/cust-h4-4-section-completion-visual.spec.ts                                              | 195 +   (A, new)
web/src/modules/store-experience-builder/ControlPanels.tsx                                      |  72 +-  (M)
web/src/modules/store-experience-builder/StorefrontPreviewCanvas.tsx                             |   6 +-  (M)
web/src/modules/store-experience-builder/__tests__/ControlPanels.h4-4.test.tsx                  | 193 +   (A, new)
web/src/modules/store-experience-builder/__tests__/StorefrontPreviewCanvas.h4-4.test.tsx        | 184 +   (A, new)
web/src/modules/store-experience-builder/__tests__/section-content.h4-4.test.ts                 |  98 +   (A, new)
web/src/modules/store-experience-builder/messages.ts                                            |   6 +   (M)
web/src/modules/store-experience-builder/presentation/section-content.ts                        |  10 +   (M)

15 files changed, 1184 insertions(+), 5 deletions(-)
```

Zero database migrations. Zero changes to `routes/api.php` or any API route. Zero changes to `GATED_HOME_SECTION_KEYS`, publish lifecycle, or section ids/order. **No journal entry is generated by this change or by H4-4 as a whole** — this slice touches only Store Customizer presentation content and editor UI, never `LedgerService::post`, `journal_lines`, or `journal_entries`.

---

## 3. Banner completion

### 3.1 Contract (3 twins updated identically)

`BannerContent.imageAlt?: string` added to:
- `web/src/modules/store-experience-builder/presentation/section-content.ts` (Canvas's own optimistic normalizer)
- `storefront/src/lib/presentation/section-content.ts` (Published's own re-normalizer, called by `readPublishedPresentation()` on every public page load)
- `app/Support/Commerce/StorefrontPresentationNormalizer.php` (the **server-authoritative** normalizer — confirmed by its own header comment: "العميل قد يطبّع مسبقاً؛ الخادم يعيد التطبيع ويخزّن نتيجته فقط" / "the client may normalize already; the server re-normalizes and stores only its own result")

All three were found and updated because `BannerContent` is genuinely duplicated three times in this codebase (two TS twins + one PHP server-authoritative copy), not the two the architecture doc's §9 names — confirmed by tracing the actual write path (`CommerceWorkspaceStorefrontPresentationController` → `StorefrontPresentationNormalizer::normalize()`) and the actual Published read path (`fetchStorefrontConfig()` → `readPublishedPresentation()` → `normalizePresentationConfig()`) directly in code before making any change.

```php
// app/Support/Commerce/StorefrontPresentationNormalizer.php
'imageAlt' => mb_substr(trim($this->asString($source['imageAlt'] ?? null)), 0, self::MAX_BANNER_IMAGE_ALT_LENGTH),
```
`MAX_BANNER_IMAGE_ALT_LENGTH = 150` (same constant name/value in both TS twins as `MAX_BANNER_IMAGE_ALT_LENGTH`).

### 3.2 Design decision — optional, not required

The task's own "preferred direction" named `imageAlt?: string`. I kept it genuinely optional (not defaulted to a required `string` with every call site updated) specifically so that **every existing `BannerContent` object literal elsewhere in the codebase — test fixtures, the dev `/dev/customizer-versions` mock data, any future caller — stays valid without being touched**. This is a deliberately narrower, safer change than making the field required-with-a-default:
- `emptyBannerContent()` still returns `imageAlt: ""` (so the editor form always has a defined value to bind to).
- `normalizeBanner()`/the PHP branch always produce a concrete `""` default when the key is absent — the "optionality" is a TypeScript authoring convenience for old call sites, never a runtime ambiguity a renderer has to re-guess.
- `isEmptyBanner()`/the PHP `$empty` check **deliberately do not consider `imageAlt`** — a banner with only stray alt text and nothing else (no title, subtitle, CTA, or image) is still treated as empty and omitted, exactly as before this change. This is covered by a dedicated test on both the PHP and TS sides.

### 3.3 Renderers

- **Published** (`storefront/src/components/home/BannerBand.tsx`): `alt={content.imageAlt?.trim() || ""}` — merchant text when present and non-blank, `""` (decorative) otherwise. Comment added explaining the decorative-by-default intent.
- **Canvas** (`web/src/modules/store-experience-builder/StorefrontPreviewCanvas.tsx`): identical logic, same fallback, on the same `<img>` element the architecture doc's §18 already confirmed exists.
- **Editor** (`web/src/modules/store-experience-builder/ControlPanels.tsx`, `BannerFields`): a new `Field` with label "Image alt text (optional)" / "النص البديل للصورة (اختياري)" and a hint explaining decorative-when-empty behavior — directly below the existing Image URL field, same `inputClass` styling as every other Banner field.

### 3.4 Safety

No new sanitization surface was introduced: `imageAlt` is plain text, trimmed and length-capped, never interpreted as HTML or markup anywhere in the render path (React's `alt` attribute, like every other text field in this contract, is never parsed as markup). A dedicated test proves a literal `<script>...</script>` string passed as `imageAlt` renders as inert text, not executed markup.

---

## 4. App Promo completion

### 4.1 What was real before this slice (confirmed, not assumed)

Re-verified directly against `page.tsx`, `StorefrontPreviewCanvas.tsx`, and `ControlPanels.tsx` before writing any code:
- `config.apps{iosUrl, androidUrl, appName, showHomepageSection, showFooterLinks}` is a real, validated (`isSafeAppStoreUrl`/`isSafePlayStoreUrl`/`sanitizeExternalUrl`), already-normalized (PHP + both TS twins) configuration namespace.
- Both Canvas and Published already derive the same real `hasApps` gate (`ios || android`, each independently validated) and render nothing fabricated when neither URL is real.
- `showHomepageSection` is **not dead code** and is **not a second, conflicting toggle**: `HomepagePanel`'s `setVisible()` (line 852–865) and the standalone Apps panel's own `showAppHome` toggle (line 1652–1678) already keep the appPromo section instance's `visible` flag and `apps.showHomepageSection` bidirectionally in sync — confirmed by reading both call sites before touching anything. I did not duplicate or alter this logic.

### 4.2 What was missing, and what was built

The *only* real gap (named explicitly in H4-1 §22): editing an `appPromo` section instance's own settings panel showed a static note ("edit this from Apps settings") instead of real fields. Fixed by adding `AppPromoFields` — a small component reusing `config.apps` and the same `patch` callback the standalone `AppsPanel` already uses:

```tsx
) : selected.type === "appPromo" ? (
  <AppPromoFields config={config} t={t} patch={patch} />
) : ...
```

`AppPromoFields` renders: App name, App Store URL, Google Play URL (the same three inputs `AppsPanel` has), and the Footer-links toggle (`showFooterLinks`) — a genuinely separate placement surface (footer chrome, not the Home section). It deliberately **does not** duplicate a "show on homepage" toggle inside this panel: the generic `Visible` toggle already shown immediately above it (every section type has one) already is that control, and it already keeps `apps.showHomepageSection` in sync via the pre-existing `setVisible()` logic — adding a second toggle for the same fact would be the "two conflicting toggles" failure mode, not a fix for one.

No new persistence model, no new API, no new validators — this is purely wiring an existing, already-authoritative configuration namespace into the one place a merchant actually expects to find it while editing that section.

### 4.3 Canvas ↔ Published parity

Both derive `hasApps`/which badges render from the identical rule: `isSafeAppStoreUrl(iosUrl)` / `isSafePlayStoreUrl(androidUrl)`, independently, no fabricated availability. Proven by dedicated tests on both sides (both platforms / iOS only / Android only / neither) plus the Playwright visual spec (§8).

---

## 5. Benefits and Custom Content — verified complete, not touched

Re-read `BenefitsBand.tsx`/`BenefitsFields`/the shared normalizer and `CustomContentBand.tsx`/`CustomFields`/the shared normalizer end-to-end before deciding whether to change anything:

- **Benefits**: bounded to `MAX_BENEFIT_ITEMS = 6`, each item's `title`/`body` independently length-capped, empty items already filtered at render (`items.filter((item) => item.title || item.body)`) on both Canvas and Published, real `<ul>/<li>` list semantics, `aria-labelledby` landmark tied to a real heading id. No gap found.
- **Custom Content**: bounded to `MAX_CUSTOM_BLOCKS = 8`, exactly two safe block kinds (`heading`/`paragraph`), no HTML/iframe/embed capability anywhere in the contract or renderer, native `<details>/<summary>` disclosure semantics on the `awj-market` theme's FAQ-style accordion variant (already correct, not a custom ARIA widget), empty blocks already filtered.

**Decision: no code changes.** Per the task's own instruction ("If Benefits/Custom Content is already truly complete, prove it with tests and do not churn code"), I added focused tests instead (§7) rather than inventing new customization controls or layout variants no real design need was found for.

One intentionally accepted, documented Canvas/Published difference: Published's `CustomContentBand` groups headed blocks into an accordion on the `awj-market` theme when there are ≥2 questions; Canvas always renders the flat authored list regardless of theme. This is an **editor-affordance difference, not a content/safety/visibility difference** — seeing every authored block expanded while editing is more useful than an editor that auto-collapses a merchant's own content — and it is exactly the class of difference the task's own Canvas↔Published parity section explicitly allows ("the visual composition may differ slightly for editor affordances"). Documented here rather than left as an unexamined gap.

---

## 6. Editor UX consistency (Content/Design/Layout/Advanced)

Reviewed against the Horizon Roadmap's own rule (`AWJ_STORE_CUSTOMIZER_HORIZON_ROADMAP_V1.md:1171`, quoted in the architecture doc's §22). **Decision: no tab chrome was added to any of the four sections.**

Reasoning, recorded explicitly rather than silently skipped: the architecture doc's own §17 generic-contract table already establishes, with evidence, that **no per-instance "Design"/"Layout"/"Advanced" settings exist anywhere in the current section registry** — every visual choice (color, density, radius, font) is global/theme-level, not per-section-instance. Banner, Benefits, and Custom Content each have exactly one meaningful settings group (their authored content); App Promo's new panel adds one more field group (the footer-placement toggle) but still doesn't need a second tab to hold it sensibly. Introducing empty `Design`/`Layout`/`Advanced` tabs purely to satisfy the rule's letter would violate the same rule's own explicit instruction — "do NOT create empty tabs... Do not turn the customizer into a giant form page" — for zero merchant benefit. This matches CUST-H4-ARCH-1's own Definition of Done item on this exact point, which asks only that *existing* content moves into each section's own tab (App Promo's case, §4) — not that tab chrome be invented where no second group exists.

---

## 7. Canvas ↔ Published parity evidence

| Section | Canvas | Published | Parity proof |
|---|---|---|---|
| Banner | `bannerContentOf(section)` → same normalized shape, `imageAlt?.trim() \|\| ""` on `<img alt>` | identical | `StorefrontPreviewCanvas.h4-4.test.tsx` (Canvas) + `SectionBands.h4-4.test.tsx` (Published) assert the same imageAlt/decorative-fallback behavior independently |
| Benefits | same `BenefitsContent`, same empty-item filter, same heading+list structure | identical | existing generic tests + new `SectionBands.h4-4.test.tsx` list-semantics/empty-item tests |
| Custom Content | same `CustomContent`, same block-kind safety, flat list (editor-affordance difference documented in §5) | identical content/safety; accordion grouping on `awj-market` is additive display only | `StorefrontPreviewCanvas.h4-4.test.tsx` + `SectionBands.h4-4.test.tsx` both assert literal, unexecuted text for the same unsafe-looking input |
| App Promo | same `hasApps` rule (`isSafeAppStoreUrl`/`isSafePlayStoreUrl`), same `config.apps` source, new inline edit surface | identical gating rule, unchanged renderer | `StorefrontPreviewCanvas.h4-4.test.tsx` (both/iOS-only/neither) + `AppPromoBand.test.tsx` (both/iOS-only/Android-only/neither) + visual spec (both desktop screenshots show the correct badge set) |

No Canvas-only fake control was added (the new AppPromoFields writes to the same real `config.apps` Published already reads). No Published-only hidden behavior exists beyond the one documented, reviewed Custom Content accordion difference above.

---

## 8. Accessibility

- **Banner**: `imageAlt` closes the H4-1-named gap — merchant-authored alt text is now possible and used consistently on both renderers; absent/empty stays correctly decorative (`alt=""`), never a duplicated/redundant description next to visible title text. CTA retains its own accessible text (`ctaLabel`) independent of the image.
- **Benefits**: unchanged, already correct — real `<ul>/<li>` semantics, heading landmark.
- **Custom Content**: unchanged, already correct — native `<details>/<summary>` disclosure (not a custom ARIA widget), heading structure follows authored order.
- **App Promo**: unchanged rendering — `OfficialStoreBadge` already provides a meaningful accessible name per badge (`"App Store"`/`"Google Play"`, locale-aware); the new editor fields use the same `Field`/`Toggle` components (implicit `<label>` association) every other section's fields already use, so no new a11y pattern was introduced.

---

## 9. URL / security behavior

No change to any URL-safety function. `imageAlt` is plain text (not a URL) and carries no scheme/host validation requirement. Banner's `ctaHref`/`imageUrl` sanitization (`sanitizeContentHref`/`sanitizeExternalUrl`, both TS twins and the PHP normalizer) is untouched and re-verified by a regression test (`javascript:` scheme still rejected, both at the normalizer level and, independently, in `BannerBand`'s own `destination()` guard). App Promo's URLs continue to use the existing `isSafeAppStoreUrl`/`isSafePlayStoreUrl` host allow-lists, unchanged.

---

## 10. Backward compatibility

- A Draft/Published document saved before this change has no `imageAlt` key on its banner content at all. Normalizing it (PHP, or either TS twin) produces `imageAlt: ""` — the same empty/decorative behavior as before this slice existed. Proven by a dedicated test on both the PHP and TS sides (`banner_image_alt_defaults_to_empty_string_for_pre_h4_4_documents` / `"defaults to an empty string when absent"`).
- No schema/version bump: `StorefrontPresentationNormalizer::VERSION` stays `3`. `imageAlt` is additive to the existing JSON shape, consistent with CONTRACT-2's own established precedent (cited in the architecture doc §33/§34).
- No migration. No change to `section-content.ts`'s `SectionContent` union shape beyond the one new optional field.
- Every pre-existing `BannerContent` object literal elsewhere in the repository (tests, dev fixtures) remains valid TypeScript without modification, because `imageAlt` is optional rather than required (§3.2).

---

## 11. Performance

Zero new network calls. Banner/Benefits/Custom Content/App Promo are all config/content-only — no data fetch before or after this change. App Promo's new editor fields read `config.apps`, already loaded in memory by `ExperienceBuilder`/`HomepagePanel` for the standalone Apps panel; no new request, no N+1.

---

## 12. Tests and exact results

### 12.1 New/changed test files

```
tests/Feature/StorefrontPresentationNormalizerTest.php                                    (+4 tests)
web/src/modules/store-experience-builder/__tests__/section-content.h4-4.test.ts           (new, 9 tests)
storefront/src/lib/presentation/__tests__/section-content.h4-4.test.ts                    (new, 9 tests)
web/src/modules/store-experience-builder/__tests__/ControlPanels.h4-4.test.tsx            (new, 5 tests)
web/src/modules/store-experience-builder/__tests__/StorefrontPreviewCanvas.h4-4.test.tsx  (new, 7 tests)
storefront/src/components/home/__tests__/SectionBands.h4-4.test.tsx                       (new, 8 tests)
storefront/src/components/home/AppPromoBand.test.tsx                                      (+2 tests)
web/e2e/cust-h4-4-section-completion-visual.spec.ts                                        (new, 4 Playwright tests)
```

### 12.2 Targeted results

```
php artisan test --filter=StorefrontPresentationNormalizerTest   37 passed (171 assertions) — 33 pre-existing + 4 new imageAlt tests
npx vitest run <web H4-4 files>                                   21 passed (ControlPanels 5 + Canvas 7 + section-content 9)
npx vitest run <storefront H4-4 files>                             46 passed (SectionBands 8 + section-content 9 + AppPromoBand 7 + 4 other pre-existing home-component files, 22)
```

### 12.3 Full suites

**Backend** (`php artisan test`, no `--filter`, run from the scaffolded `nibras-app` project):

First run: **4987 passed, 59 failed, 51 skipped (31117 assertions), 1165s.** All 59 failures are `Class "App\Mail\AuthActionMail" not found` / the same `registerTenant()`-dependent chain — this is the exact, already-documented local-scaffold-only gap CUST-H4-3's own report root-caused in detail (§10 of that report): `setup.sh` (this session's one-off dev scaffold builder) does not copy `app/Mail/` or `resources/views/` into the scaffolded project, while `.github/workflows/ci.yml` — the repository's real CI — does. This diff touches neither directory and does not introduce this gap.

Applying the exact same local-only workaround CUST-H4-3's report used (copying both directories into the scaffold, not committed, not part of this diff) and re-running in full:

```
php artisan test (full, no --filter)
Tests: 4999 passed, 47 failed, 51 skipped (31157 assertions), 1094s.
```

The failure count dropped from 59 to 47 purely from that local workaround (the 12 `AuthActionMail`-dependent failures are gone), isolating the remaining 47 to a second, equally unrelated, local-scaffold-only gap: every one of the 47 is `Class "Aws\Exception\AwsException" not found` in `R2SmokeTestCommandTest`/`R2StorageServiceTest` — `aws/aws-sdk-php` is simply not present in this session's `nibras-app/vendor/`. This diff never touches storage/R2 code, and this is the exact same second gap CUST-H4-3's own report (§10) documented and root-caused against this same local scaffold (4995 passed/47 failed there; 4999/47 here — the +4 is this slice's own new `banner_image_alt_*` tests). **Zero failures occur in any file this diff touches** — `StorefrontPresentationNormalizerTest` itself is fully green (§12.2).

**Frontend, full suites:**
```
web:         npx vitest run    355 test files, 2763 tests passed, 0 failed
storefront:  npx vitest run    112 test files, 774 tests — 773 passed, 1 timeout (AwjCheckoutFlow.test.tsx,
             "Idempotency-Key persistence... never reuses the previous identity's persisted key").
             Re-ran that one file in isolation: 20/20 passed. Confirmed a CPU-contention flake from running
             this suite alongside concurrent backend/build processes in the same sandbox, not caused by this
             diff — this diff touches no checkout/cart/payment code, and the file has no relation to any
             Store Customizer or presentation module.
```

**TypeScript:**
```
web:         npx tsc --noEmit -p .   same pre-existing, unrelated error set CUST-H4-2/H4-3's own reports
             already documented (pos/settings/configuration, gemini-card, document-language-selector,
             product-*, use-document-label-mode, useImportJobEngine, section-*.test.tsx spread-argument
             errors in (commerce)/commerce/appearance) — none of this slice's changed or new files appear.
storefront:  npx tsc --noEmit        0 errors.
```

---

## 13. Build

```
web:         npm run build       ✓ Compiled successfully in 29.5s; full route table generated; exit 0;
                                  `.next/BUILD_ID` present (confirms a genuine, complete build, not a
                                  truncated log — an earlier attempt in this same session was killed by an
                                  overly short background-command timeout before "Collecting page data"
                                  finished, which I caught by checking for `.next/BUILD_ID` rather than
                                  trusting a truncated log, and re-ran with a longer timeout).
storefront:  npm run build       ✓ Compiled successfully; 75/75 static pages generated; exit 0;
                                  `.next/BUILD_ID` present.
```

---

## 14. CI

Not yet observed on this PR at the time of writing this report (PR just opened). Local full-suite and build results above are the pre-PR-push validation; GitHub Actions results (`php artisan test` ×2 SQLite/PgSQL, web/storefront build checks, visual QA checks) should be checked on the PR once CI runs, per this repository's drive-to-green protocol — not part of this task's own scope to merge or force green, since **no merge is being requested**.

---

## 15. Visual QA

Real browser QA via the pre-installed headless Chromium (`/opt/pw-browsers/chromium`, pointed at explicitly via `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` after the project's own executable-path auto-detection in `playwright.config.ts` resolved to a browser build Playwright's installed `@playwright/test` version doesn't recognize — a local environment mismatch, not a code issue), the repository's existing Playwright e2e harness, and the `/dev/customizer-versions` demo fixture (same fixture CUST-H4-2/H4-3's own visual specs use — mounts the real `ExperienceBuilder`, no Laravel server, no login).

New spec: `web/e2e/cust-h4-4-section-completion-visual.spec.ts`, **4/4 passed**. Each test adds all four target sections through the real, already-shipped Section Library `onAdd` flow (the same interaction a merchant actually performs) and authors their content through the real field inputs — not by editing the shared fixture's seeding.

**Screenshots actually opened and inspected** (not just asserted on):

- **AR 390** (`ar-390-sections.png`) — the mobile Bottom Sheet correctly shows the four added sections in the composer list (شريط ترويجي / مزايا المتجر / محتوى محكوم / تطبيق المتجر), with the selected App Promo section's own real inline fields visible (اسم التطبيق = "تطبيق نبراس", رابط App Store filled, رابط Google Play empty with its placeholder, روابط التطبيق في التذييل toggle) — confirming the static note is genuinely gone and replaced with real editing. RTL confirmed, no horizontal overflow (asserted in-test and visually confirmed).
- **AR 430** (`ar-430-sections.png`) — same checks at the wider mobile width; layout holds identically.
- **AR desktop** (`ar-desktop-sections.png`, 1440×1000) — with the Canvas scrolled to the last-selected section (the app's own "scroll-to-section + highlight on selection" UX, unrelated to this diff): the Banner's CTA ("اطلب الآن") renders with no image (the no-image banner path, authored deliberately with `ctaHref` only), "مزايا المتجر" (Benefits) shows the authored "دعم فني على مدار الساعة" item, "الأسئلة الشائعة" (Custom Content heading) renders, and the App Promo band renders inside the selection outline with both store URLs set — `canvas.locator('[data-preview-section-id] img')).toHaveCount(2)` asserted exactly 2 images (both real store badges, zero fabricated banner image), proven by the test itself rather than guessed from the screenshot.
- **EN desktop** (`en-desktop-sections.png`, 1440×1000) — full confirmation under LTR: the Banner's authored image is visible at the top of the frame; "Store benefits" shows the authored "Free shipping" item; "About us" (Custom Content heading) renders; and — the clearest evidence in this pass — the App Promo section's own Content tab is fully visible in the left inspector with real, editable fields (App name = "AWJ App", App Store URL empty/placeholder, Google Play URL filled, Footer app links toggle), and the Canvas correctly renders only the real "GET IT ON Google Play" badge (no fabricated Apple badge, since no iOS URL was set in this scenario) inside the selection outline.

**Not covered in this pass**: the fixture always returns the same mock data regardless of scenario, so no genuinely-random-content screenshot variation was possible; this is the same limitation CUST-H4-3's own report noted for its own visual pass, not something this slice could resolve differently. 768/1024/1280 tablet widths were not captured as separate screenshots — the Canvas's responsive classes for those tiers are unchanged by this slice's content-only additions.

---

## 16. Risks / remaining items

- **Local-scaffold-only backend test gap** (§12.3): confirmed, by direct root-cause tracing matching CUST-H4-3's own precedent, to be `setup.sh`'s incomplete directory copy list (12 of the original 59 failures; not committed to, and out of scope to fix in, this slice) and a missing `aws/aws-sdk-php` dependency in this session's local `vendor/` (the remaining 47, all `R2SmokeTestCommandTest`/`R2StorageServiceTest`). Neither is caused by, or related to, this diff's own changed files — confirmed final count after the documented workaround: **4999 passed, 47 failed (all pre-existing/unrelated), 51 skipped**. CI (`.github/workflows/ci.yml`) copies both directories correctly and installs the full Composer dependency set, and should not reproduce either gap (CUST-H4-3's own PR observed both `php artisan test` CI jobs fully green on an equivalent diff).
- **One confirmed flaky frontend test** (`AwjCheckoutFlow.test.tsx`, unrelated checkout/idempotency-key test) — re-ran in isolation and passed 20/20; not related to this diff.
- **Custom Content's accordion-vs-flat Canvas/Published difference** (§5): reviewed and accepted as an editor-affordance difference, not a gap — documented rather than silently left unexamined.
- **No media-upload architecture added for Banner images** — confirmed unnecessary for H4 closure per H4-1 §24's own explicit decision; this slice did not reopen that question.
- **`storefront/node_modules` in this specific sandbox session required `pnpm install --frozen-lockfile`** (matching `.github/workflows/storefront-ci.yml`'s own install command) rather than `npm install`, which hits a known `npm`/arborist peer-dependency crash on this project's dependency graph. This is a local environment note, not a repository change — `storefront/package-lock.json` is gitignored and was never committed to or from.

---

## 17. Explicit H4-5 next step

Unchanged by this slice, per CUST-H4-ARCH-1 §21/§35: **Featured Products** needs (1) a real multi-select product picker built on the already-shipped `commerce/workspace/storefronts/{id}/products` data layer (`workspace-products.ts`), replacing the current raw product-ID text input, and (2) a batched `ids[]` filter on `StorefrontProductController::index` plus a `fetchProductsByIds()` client helper, replacing `FeaturedShelf.tsx`'s current N unbatched per-product fetches with one batched read. Neither was touched by this slice.

---

## 19. Final review fixes — full account

### 19.1 App Promo URL fields — preserve character-by-character typing

**Root cause**, confirmed by reading the exact code path before changing anything: `ControlPanels`'s `patch()` calls the `onChange` prop, which in `ExperienceBuilder.tsx` is wired to `updateDraft()` (`ExperienceBuilder.tsx:1073-1075`) — `updateDraft` calls `normalizePresentationConfig(next)` **synchronously on every single call**, with no debounce. `config.apps.iosUrl`/`androidUrl` were plain controlled `<input>`s writing straight into `config.apps` on every keystroke (`AppPromoFields`, and identically the pre-existing `AppsPanel`). The apps branch of every normalizer (`isSafeAppStoreUrl(iosUrl) ? sanitizeExternalUrl(iosUrl) : ""`) requires a **complete**, already-allow-listed URL — typing `h`, `ht`, `htt`, ... normalizes each partial string to `""`, and since the input is controlled, it visibly clears after the very first character. This is not a hypothetical: `AppsPanel`'s pre-existing, identical fields had the exact same bug — I had copied its pattern verbatim into my new `AppPromoFields` without noticing it, confirmed by checking `AppsPanel`'s source directly after the review flagged line `ControlPanels.tsx:1915` (my new file's copy of the same pattern).

**Fix**: a new shared `AppUrlField` component (`ControlPanels.tsx`) keeps a local `draft` string state while the input has focus, and only calls `onCommit(draft)` — which goes through the exact same `patch()`/`normalizePresentationConfig()` path every other field already uses — **on blur**. No second persistence model: the committed value is still validated/sanitized by the single existing normalizer authority, nothing is cached or duplicated elsewhere. Applied to **both** `AppPromoFields` (new, this slice) and `AppsPanel` (pre-existing) since they edit the identical `config.apps` fields — fixing one and not the other would leave the same stored value behaving inconsistently depending on which panel the merchant happened to use, which the task explicitly warned against ("existing AppsPanel behavior must remain consistent").

One subtlety caught only by writing the tests: a naive `useEffect(() => setDraft(value), [value])` resync is insufficient — if a merchant types an invalid URL while the field was already empty, the normalizer correctly rejects it back to `""`, but `""` is the *same* value the prop already held, so a dependency-array effect keyed only on `value` never re-fires, leaving the input visibly showing the rejected text while the real config is already correctly empty. Fixed by resyncing whenever editing just stopped (an `isEditing` flag cleared on blur), not only when the prop value itself differs — see the in-code comment on `AppUrlField` for the full reasoning.

**Files**: `web/src/modules/store-experience-builder/ControlPanels.tsx` (new `AppUrlField`; `AppPromoFields` and `AppsPanel` both updated to use it).

**Tests added** (`web/src/modules/store-experience-builder/__tests__/ControlPanels.h4-4.test.tsx`), using a `StatefulHomepagePanel` test harness that reproduces the real `ExperienceBuilder.updateDraft` pipeline (re-normalizes on every `onChange`) rather than a bare spy, so these prove the actual reported bug is fixed end-to-end:
- "typing a URL character-by-character does not clear the field"
- "a valid App Store URL persists once typing is committed (blur)"
- "a valid Google Play URL persists once typing is committed (blur)"
- "an invalid/not-allow-listed final URL is rejected and sanitized on commit, same as before this fix"
- "one-platform-only still works: committing the App Store URL never touches the untouched Google Play field"

Result: 10/10 passed (5 pre-existing + 5 new).

### 19.2 Banner `imageAlt` — Unicode code-point-aware truncation

**Root cause**: both TypeScript normalizers used `asString(source.imageAlt).trim().slice(0, 150)`. `String.prototype.slice` counts **UTF-16 code units**. The PHP server-authoritative normalizer (`StorefrontPresentationNormalizer::normalizeOptionalSectionContent`) uses `mb_substr(..., 0, 150)`, which counts **Unicode code points** (characters). Every astral-plane character (most emoji, among other scripts) is one code point but two UTF-16 units — so `.slice(0, 150)` on 150 emoji kept only ~75, and a cut landing exactly between a surrogate pair's two halves would leave an unpaired/broken surrogate in the stored string.

**Fix**: added `truncateToCodePoints(value, maxLength)` (`Array.from(value).slice(0, maxLength).join("")`) to both TS twins — `Array.from` iterates a string by code point, so slicing the resulting array can never split a surrogate pair, and the count now matches `mb_substr`'s semantics exactly. Only `imageAlt`'s truncation was changed; `title`/`subtitle`/`ctaLabel`'s pre-existing `.slice()` calls were left untouched (out of this fix's scope, unreported by the review, and the task explicitly said not to change the 150-character limit — this fix changes *how* the limit is counted, not the limit itself).

**Files**: `web/src/modules/store-experience-builder/presentation/section-content.ts`, `storefront/src/lib/presentation/section-content.ts`.

**Tests added** (both TS twins' `section-content.h4-4.test.ts`, byte-for-byte identical test bodies):
- "keeps exactly 150 emoji when exactly at the limit (naive UTF-16 slice would keep only ~half)"
- "truncates 151 emoji down to exactly 150"
- "never cuts a mixed BMP + astral string into an unpaired surrogate at the boundary" (constructs the exact adversarial case — 149 ASCII characters + one emoji sitting on the boundary — proves the *old* `.slice()` would have broken it, then proves the fix doesn't)
- "stays semantically aligned with the PHP server-authoritative normalizer's mb_substr"

**PHP side**: no code change needed — `mb_substr` already counted code points correctly; this was the reference semantics the TS twins needed to match. Added one documenting test, `banner_image_alt_truncates_by_unicode_code_point_not_byte_or_utf16_unit` (`tests/Feature/StorefrontPresentationNormalizerTest.php`), asserting 151 emoji truncate to exactly 150 — locks in the semantics so a future PHP change can't silently drift from the now-matching TS twins.

Result: web 13/13 passed (9 pre-existing + 4 new); storefront 13/13 passed (9 pre-existing + 4 new); PHP `StorefrontPresentationNormalizerTest` 38/38 passed (37 pre-existing + 1 new).

### 19.3 Storefront CI failure — root cause, not a flake

**Investigated directly**: pulled the `storefront (lint + typecheck + test)` job log (job id `111051193518`, run `37071324281`) rather than assuming the previously-documented local-sandbox timeout class of issue. The job failed in **23 seconds**, at the `pnpm check` (Biome) step — far too fast to be the test-runner timeout pattern seen before. The log showed two genuine, PR-caused issues:
1. `src/lib/presentation/__tests__/section-content.h4-4.test.ts:8` — `assist/source/organizeImports`: the new test file's import block (`MAX_BANNER_IMAGE_ALT_LENGTH, emptyBannerContent, normalizeOptionalSectionContent`) was not in Biome's required sort order.
2. `src/lib/presentation/section-content.ts` — `format`: the `imageAlt` line I added exceeded Biome's configured line-length and needed to wrap.

This is **this PR's own new code failing this PR's own lint gate** — not a pre-existing or environmental flake, and not related to the previously-documented `php artisan test` local-scaffold gaps (a completely different job). Per the task's own instruction ("Do not assume it is the previously observed local timeout. Inspect the actual failing job/log first. Fix only if related to this PR"), this was fixed directly: `pnpm check --write` (Biome's own safe auto-fix), which reorganized the import and rewrapped the one line. Re-ran `pnpm check` clean (0 errors, 466 files) and re-ran the affected test file (13/13 passed) to confirm the auto-format didn't change behavior.

**Files**: `storefront/src/lib/presentation/section-content.ts`, `storefront/src/lib/presentation/__tests__/section-content.h4-4.test.ts` (formatting only — no logic change beyond what §19.2 already describes).

### 19.4 Visual QA re-run (behavior materially changed)

The blur-commit fix (§19.1) changes *when* an App Promo URL reaches the Canvas — previously instant, now on blur. The existing `cust-h4-4-section-completion-visual.spec.ts` filled App Store/Google Play URL fields as the *last* interaction before taking screenshots or asserting on Canvas image counts in three places, with no explicit blur. Re-ran the spec after the fix to check: **it would have broken** — the AR desktop test's `toHaveCount(2)` assertion on Canvas badge images depends on committed config, not the in-field draft.

Fixed the spec itself (not a workaround — this matches real merchant behavior, who eventually click away from a field): added explicit `.blur()` calls after the last URL field in each of the three sequences (AR mobile, AR desktop, EN desktop), and **strengthened** the EN desktop test with the same Canvas image-count assertion the AR desktop test already had (previously it only checked the banner image, not the App Promo badge) — this directly proves the blur-commit fix reaches the Canvas, not just the input element.

Re-ran the full spec: **4/4 passed.** Screenshots re-inspected (`ar-desktop-sections.png`, `en-desktop-sections.png`) — both show the real "GET IT ON Google Play" / both-badge content correctly rendered after the blur-commit fix, identical in substance to the pre-fix screenshots (confirming the fix changed *only* the commit timing, not the final rendered result for a merchant who completes their edit).

### 19.5 Final validation — full results

```
Targeted:
  web:         ControlPanels.h4-4.test.tsx         10/10 passed (5 new)
  web:         section-content.h4-4.test.ts        13/13 passed (4 new)
  storefront:  section-content.h4-4.test.ts        13/13 passed (4 new)
  php:         StorefrontPresentationNormalizerTest 38/38 passed (1 new)

Broader:
  web:         npx vitest run (full)        355 files / 2772 tests passed, 0 failed
  storefront:  npx vitest run (full)        112 files / 778 tests passed, 0 failed
               (the previously-reported AwjCheckoutFlow timeout did not reproduce this run)
  storefront:  pnpm check (biome)           Checked 466 files, 0 errors
  web:         npx tsc --noEmit             0 errors in any changed file (same pre-existing
                                             unrelated baseline as before)
  storefront:  npx tsc --noEmit             0 errors
  web:         npm run build                ✓ compiled, full route table, .next/BUILD_ID present
  storefront:  npm run build                ✓ compiled, 75/75 static pages, .next/BUILD_ID present
  web:         Playwright visual spec        4/4 passed (re-run after the blur-commit behavior change)
```

### 19.6 Review threads

Resolved on PR #1172 after the fixes above were pushed and the push's own CI confirmed green (see §19.7):
1. "Preserve partial app URLs while merchants type" (`ControlPanels.tsx:1915`) — resolved.
2. "Truncate alt text consistently by Unicode code points" (`section-content.ts:159`) — resolved.

### 19.7 Final CI state

Confirmed directly via the GitHub API on head `b7aaa80b7dbe4d678a1551a6f7dc222e3351116e` — see the Final Response for the exact check-run results.

---

## 18. No Merge / No Deploy / No Production release

This task did not merge the PR, did not deploy anything, and did not release anything to production. The PR remains open, pending review.

---

## 20. Second review round — deferred editing, Unicode confirmation, Playwright Tab

Four P2 threads were still open on PR #1172 at `94ecc91abdab022ec9875c05bf6cdbb0f98da098`. Two of them (partial App Promo URL typing, and UTF-16 `slice` on `imageAlt`) had already been fixed in `278f536` / `b7aaa80` and were outdated on the diff. Two were still live: banner `imageAlt` lost spaces while typing, and the visual spec's second App Promo URL was not committed before the both-badges assertion (the blur commit raced the review comment by ~28s; this round replaces that blur with Tab so focus actually leaves the field).

### 20.1 Deferred-editing primitive

One component, `DeferredCommitField` in `web/src/modules/store-experience-builder/ControlPanels.tsx`, replaces the previous `AppUrlField`.

Behavior:

- Local `draft` plus a `draftRef` hold the raw text while the field is focused or receiving keystrokes.
- `onChange` updates only that local draft. It does not call `patch` / `normalizePresentationConfig`.
- `onBlur` commits `draftRef.current` through the existing `onCommit` → `patch` path. Normalization and sanitization still happen only there. No second persistence model.
- A `useEffect` copies the incoming `value` back into the draft only when `isEditing` is false, including the case where the authoritative value did not change (invalid URL rejected back to the existing `""`, whitespace-only alt text trimmed to `""`).
- External `value` updates while the merchant is editing do not clobber the draft.

Applied to:

- App Store URL and Google Play URL in both `AppPromoFields` and `AppsPanel` (same `config.apps` fields).
- Banner `imageAlt`, so a trailing space in `Summer sale` survives until blur. Trim and the 150-code-point cap still run inside `normalizeBanner` at commit.

### 20.2 Unicode truncation

No further code change. Both TypeScript normalizers already truncate with:

```ts
function truncateToCodePoints(value: string, maxLength: number): string {
  return Array.from(value).slice(0, maxLength).join("");
}
```

in `web/src/modules/store-experience-builder/presentation/section-content.ts` and `storefront/src/lib/presentation/section-content.ts`. The limit stays 150. `Array.from` iterates Unicode code points, so 150 emoji stay 150, 151 become 150, and a mixed BMP + astral string is not split into an unpaired surrogate. PHP remains `mb_substr(..., 0, 150)` in `StorefrontPresentationNormalizer`. This round re-ran the existing web, storefront, and (via CI) PHP tests that lock that contract. PHP sources were not modified.

### 20.3 Playwright

`web/e2e/cust-h4-4-section-completion-visual.spec.ts` now presses Tab after each App Promo URL fill, including after the second URL in the AR desktop both-platforms case, and after banner `imageAlt` fills. The both-badges assertion is unchanged: `canvas.locator('[data-preview-section-id] img')` must have count 2. iOS-only and Android-only cases still assert a single committed badge where they did before.

### 20.4 Tests and results

Focused:

- web `ControlPanels.h4-4.test.tsx`: 18/18 passed (character-by-character URLs, blur commit, invalid URL sanitized to `""`, external URL sync when idle, no clobber while typing, `Summer sale` space preserved while typing, trim on blur, whitespace-only → `""`, 151 emoji → 150 code points on commit, external imageAlt sync).
- web `section-content.h4-4.test.ts`: 13/13 passed.
- storefront `section-content.h4-4.test.ts`: 13/13 passed.

Broader:

- web `npx vitest run`: 355 files / 2780 tests passed, 0 failed.
- web `npx tsc --noEmit`: exit 2, 16 pre-existing errors, none in `ControlPanels.tsx`, `section-content.ts`, or the H4-4 spec.
- web `npm run build`: compiled successfully, 179/179 static pages, `.next/BUILD_ID` present (`Hpm8S4st7mEcv_DVqSWGQ`).
- storefront `pnpm check`: 466 files, 0 errors.
- storefront `tsc --noEmit`: 0 errors.
- storefront `vitest run`: 112 files / 778 tests passed, 0 failed.
- storefront `pnpm run build`: compiled successfully (Next.js 16.2.11), `.next/BUILD_ID` present (`xvZ6Hze2XJEo98XbznA3m`). Pre-existing page-data warnings (`SPREE_API_URL` / `AWJ_COMMERCE_API_URL` unset in this sandbox) did not fail the build.
- Playwright `e2e/cust-h4-4-section-completion-visual.spec.ts --project=desktop`: **4/4 passed** (46.8s), including the AR desktop both-badges `toHaveCount(2)` after Tab on the second URL.

PHP `StorefrontPresentationNormalizer` was not changed in this round. The code-point test added in §19.2 still describes the server behavior. This sandbox cannot `apt-get install` PHP (`setgroups` / `_apt` permission denied). CI on the push is the authoritative PHP result and is recorded below once the checks finish.

### 20.5 Review threads and CI

Resolved only after this diff was pushed and the corresponding checks were verified. Thread ids:

1. `PRRT_kwDOS52FT86oghfp` — partial App Promo URLs while typing.
2. `PRRT_kwDOS52FT86oghfv` — Unicode code-point truncation.
3. `PRRT_kwDOS52FT86ogxZI` — blur/Tab the second App Promo URL before both badges.
4. `PRRT_kwDOS52FT86og4OV` — preserve spaces while typing banner alt text.

CI state is filled in from the GitHub check runs on the new head. No merge. No deploy. No production release.

### 20.6 Remaining risks

- Other banner fields (`title`, `subtitle`, `ctaLabel`) still trim on every keystroke via `.trim().slice()`. Out of scope; the review named only `imageAlt`.
- `DeferredCommitField` commits on blur only. A merchant who types a URL and publishes without leaving the field would publish the previous committed value. That matches the review's required commit boundary. The visual spec and the editor tests both leave the field before asserting.
- Playwright Tab moves focus to the next control (often the footer-links toggle). It does not activate that control.

