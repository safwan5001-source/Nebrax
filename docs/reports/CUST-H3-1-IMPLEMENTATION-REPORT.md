# CUST-H3-1 — Implementation Report: Store Identity Studio Shell + Branding Consolidation

## 1–4. Identification

| | |
|---|---|
| **Base SHA** | `8f425ceb7cd944c7cef9a887aa01a0cf77a81a54` (verified against `origin/main` at task start — the CUST-H3-ARCH-1 merge commit, `docs(store): define CUST-H3 Store Identity architecture (#1138)`) |
| **Head SHA** | `9408bd06a0a6d2f64dcfac50c4d3f60d000b37ee` |
| **Branch** | `feat/cust-h3-1-identity-studio-shell` |
| **PR** | [#1140 — feat(store): consolidate Store Identity Studio](https://github.com/safwan5001-source/Nebrax/pull/1140) |

## 5. What was implemented

**Reality check first.** Before changing anything, the actual merchant-facing labels for the `"theme"` and `"branding"` Customizer panels were read directly from `messages.ts`. They were already `"Appearance"`/`"المظهر"` and `"Identity"`/`"الهوية"` — not the raw internal words "Theme"/"Branding" the task brief used to describe the problem. So the literal naming requirement ("هوية المتجر" or "Identity") was already satisfied before this slice, and the CUST-H3-ARCH-1 report's own classification — *"H3 is therefore primarily a UX consolidation + runtime parity Horizon, not a backend/storage Horizon"* — held even more narrowly than expected: there was no second, competing "Branding" surface to merge into "Identity"; `branding.*` was already the single owner of all four capabilities.

What *was* missing, verified by reading `ControlPanels.tsx`, `ExperienceBuilder.tsx` and `StorefrontPreviewCanvas.tsx` directly:

1. **No framing.** `BrandingPanel` rendered display name, logo, compact logo and favicon as four bare fields in a row, with no shared heading, intro, or visual grouping telling the merchant "this is one Identity, not four settings."
2. **Indistinguishable accessible names.** All three logo slots' upload `<input>` and "Remove" `<button>` shared the exact same literal accessible name ("Choose image" / "Remove" — the implicit `<label>` text), so a screen-reader user could not tell the three apart.
3. **No preview thumbnail.** Once a logo/compact logo/favicon was saved, the editor control gave no visual confirmation of what was stored — only a "Remove" button vs. a "No logo" message. The ARCH-1 contract (§8, Branding media) explicitly requires a "preview" property on these controls.

Everything else the brief worried about was already correct and is preserved byte-for-byte:
- Identity (`"branding"` panel id) is already Global — never filtered out when switching Home/Product/Category (`visibleNavGroups`/`visiblePanels` in `ExperienceBuilder.tsx` only ever hide the page-specific `"homepage"`/`"product"`/`"category"` panels).
- `handleSelectPage` never resets the `"branding"` panel when switching pages (it only redirects away from the three page-specific panels back to `"theme"`).
- Click-to-edit on the preview logo (`data-preview-chrome="branding"`) already routes to the `"branding"` panel and opens the mobile bottom sheet.

**Changes made (`web/src/modules/store-experience-builder/`):**

- `ControlPanels.tsx`
  - `BrandingPanel` now wraps its four fields in one `<Section hint={t("identityIntro")}>` — an intro paragraph, not a second heading (the inspector's own `<h2>` already shows "Identity"/"الهوية"; a nested `<h3>` repeating it was tried and removed after it produced a duplicate-heading ambiguity in `getByRole('heading')` queries — see §19).
  - `LogoField` now:
    - Computes `aria-label`s combining the field's own label with "Choose image"/"Remove" (e.g. `"Store logo — Choose image"`), so the three slots are distinguishable to assistive tech. The visible button text is unchanged.
    - Renders a `size-10` `<img>` thumbnail (decorative `alt=""`, since the adjacent visible label already names the field) when a value is present.
- `messages.ts` — added `identityIntro` (ar/en), the one new merchant-facing string this slice introduces.

No other file in `store-experience-builder/` or elsewhere was touched. `ExperienceBuilder.tsx`, `StorefrontPreviewCanvas.tsx`, panel ids, nav grouping, default panel (`"theme"`), and the `handleSelectPage` fallback logic are all unchanged.

### Storefront twin — left untouched, and why

`storefront/src/components/customizer/{ControlPanels,ExperienceBuilder,messages}.tsx` is a structural mirror of this editor, but its only consumers are dev-only harness pages (`src/app/dev/customizer-visual`, `src/app/dev/store-ui-6`, `src/app/dev/trust-visual`) — not the public storefront runtime, and not covered by any parity test (none exists that imports both twins). Per the task's own instruction ("افتح storefront twin files فقط إذا كان ذلك ضروريًا للحفاظ على parity أو الاختبارات"), it was left unmodified: there is no test or production path that needs it to match, and touching a dev-only mirror file was unnecessary risk for this slice.

### What was deliberately *not* done

- **No mobile toolbar button added for Identity.** The brief explicitly says not to add a fourth toolbar button unless the existing structure can't cope. The existing "Design" button + click-to-edit-on-logo already reach the Identity panel on mobile (see §10), so nothing was added.
- **No panel id rename, no nav reorder, no default-panel change.** `"branding"`/`"theme"` ids are depended on by `data-panel`/`data-preview-chrome` test assertions in `section-selection.test.tsx` and by the chrome click-to-edit wiring. Renaming or reordering them was unnecessary for this slice's goal and would have been a pure backward-compatibility risk for zero acceptance-criteria benefit.
- **No change to `primaryColor`/`accentColor`/`fontPreset`/`density`/`radius`/`productCard`** or the `"theme"` panel's content — out of scope per the brief (H3-2/H3-3).

## 6. Files changed

```
web/src/modules/store-experience-builder/ControlPanels.tsx                       (modified)
web/src/modules/store-experience-builder/messages.ts                             (modified)
web/src/modules/store-experience-builder/__tests__/ExperienceBuilder.identity.test.tsx  (new)
docs/reports/CUST-H3-1-IMPLEMENTATION-REPORT.md                                   (new, this file)
```

## 7. UX changes, specifically

- The Identity panel (desktop sidebar entry, mobile `<select>` option, and mobile bottom sheet opened via click-to-edit on the preview logo) now opens on an intro sentence explaining, in the merchant's own language, that display name/logo/compact logo/favicon are one Identity: *"Your store's name and logo live here together. The compact logo appears in the mobile header, and the favicon shows in the browser tab."* / *"اسم متجرك وشعاره يُحفظان هنا معاً. الشعار المصغّر يظهر في الرأس المضغوط على الجوال، وأيقونة التبويب تظهر في شريط المتصفح."*
- Each of the three logo fields (Store logo / Compact mobile logo / Favicon) now shows a small thumbnail of the saved image next to its Replace/Remove controls, instead of only "Remove" with no visual confirmation.
- No internal key names ("branding.displayName", "logoDataUrl", etc.) are shown anywhere — confirmed in the test suite (§14, test 1).

## 8. How `StorefrontPresentationConfig` was preserved

- Zero changes to `presentation/config.ts`, `presentation/urls.ts`, or any other file defining or sanitizing the `branding` shape. `sanitizeLogoUrl`, the 512 KB practical cap communicated in `logoHint`, and the SVG rejection are all untouched.
- `BrandingPanel`'s `patch()` calls are byte-identical to before (`patch({ branding: { ...config.branding, <field>: value } })`) — this slice only changed what is rendered around those fields, never what they write.
- No new field, no new persisted key, no schema version bump.

## 9. How the Version lifecycle was preserved

- `ExperienceBuilder.tsx` — the component owning Draft/Save/Publish/Schedule — was not modified at all in this PR.
- The new test `keeps Identity open and its values intact across Home → Product → Category → Home, without touching Draft state` explicitly asserts `data-lifecycle="clean"` stays `"clean"` through every page switch while the Identity panel is open with an edited `displayName` from `initialConfig`.
- No test in the existing 52-test `ExperienceBuilder.versions.test.tsx`, 15-test `.publish.test.tsx`, or 21-test `.schedule.test.tsx` suites regressed (all pass — §14).

## 10. Mobile evidence

- Verified by reading `ExperienceBuilder.tsx`: the mobile bottom toolbar keeps exactly its existing three buttons per page (`Sections` / `+ Add section` / `Design` on Home; equivalent triads on Product/Category) — no fourth button was added.
- Identity is reached on mobile exactly as before: tapping the logo in the live preview canvas (`data-preview-chrome="branding"`) opens the existing bottom-sheet inspector with the full Identity panel, already touch-usable (plain `<button>`/`<label>` elements, no hover dependency).
- New test `is reachable and usable at a 390px mobile viewport via click-to-edit on the preview logo, with no new toolbar entry added` renders at `window.innerWidth = 390`, counts exactly 3 toolbar buttons, clicks the logo chrome, and asserts the resulting `role="dialog"` sheet contains the Store logo field and its (now distinctly-labeled) Remove action.
- All Replace/Remove controls are native `<label>`/`<button>` elements — no custom hover-only affordances were introduced.

## 11. RTL/LTR evidence

- New test `renders the same Identity grouping in Arabic RTL with the localized labels` renders with `initialLocale="ar"`, asserts `dir="rtl"` on the builder root, and asserts the Arabic heading ("الهوية"), the new Arabic intro sentence, and the three Arabic field labels ("شعار المتجر", "شعار مصغّر للجوال", "أيقونة التبويب") all render correctly.
- The English/LTR equivalent is covered by the first new test (`initialLocale="en"`, default `dir="ltr"` from existing `ExperienceBuilder` behavior).
- No layout change was introduced that is direction-sensitive (the thumbnail `<img>` sits in the existing `flex items-center gap-2` row, which already uses logical `gap`, not left/right-specific spacing).

## 12. Accessibility evidence

- New test `gives each logo slot a distinct accessible name for its upload input and remove action` asserts `getByLabelText` succeeds unambiguously for all six combinations (3 slots × upload/remove) — this would have thrown a "multiple elements" error before this change, since all three upload inputs and all three remove buttons previously shared one accessible name each.
- Keyboard focus order is unchanged (no new tab stops were added — the thumbnail `<img>` is not focusable; it is adjacent, decorative supporting content for a field whose text label is already present and announced).
- The thumbnail uses `alt=""` deliberately: the field's visible `<span>` label (e.g. "Store logo") already names it, so a redundant announcement was avoided per standard practice for a decorative image beside its own caption.
- No control relies on color alone to convey state — presence/absence of the "Remove" button and the "No logo — typographic name is used" text are the status signal, as before.

## 13–14. Tests run and exact results

All commands were run from `web/` on this PR's head commit.

### Focused suite (new + directly related)
```
npx vitest run src/modules/store-experience-builder/__tests__/ \
  "src/app/(commerce)/commerce/appearance/section-selection.test.tsx" \
  "src/app/(commerce)/app-builder/[id]/builder/page.test.tsx"
```
**Result:** `Test Files  21 passed (21)` · `Tests  267 passed (267)`

Included: the new `ExperienceBuilder.identity.test.tsx` (7/7 passing), `ExperienceBuilder.pageNavigator.test.tsx` (9/9), `ExperienceBuilder.versions.test.tsx` (52/52), `ExperienceBuilder.publish.test.tsx` (15/15), `ExperienceBuilder.schedule.test.tsx` (21/21), `ExperienceBuilder.productRegions.test.tsx` (13/13), `ExperienceBuilder.categoryRegions.test.tsx` (14/14), `section-selection.test.tsx` (8/8 — includes the chrome click-to-edit `data-panel="branding"` assertion), `app-builder/[id]/builder/page.test.tsx` (41/41), and all `presentation`/`page-presentation`/`section-capabilities`/`presetSelectionPatch` unit suites.

### Full web Vitest suite
```
npx vitest run
```
**Result:** `Test Files  331 passed (331)` · `Tests  2472 passed (2472)` — no suite was skipped or reduced; this is the full pre-existing suite plus the one new file.

### New test file — what it locks in
`web/src/modules/store-experience-builder/__tests__/ExperienceBuilder.identity.test.tsx` (7 tests):
1. One merchant-facing Identity entry groups all four fields with the new intro, with no internal key names visible.
2. Same grouping renders correctly in Arabic RTL with localized copy.
3. Identity stays open and its values (display name) survive Home → Product → Category → Home, with `data-lifecycle` staying `"clean"` throughout (Global, no per-page state, no Draft mutation from navigation alone).
4. No-logo → display-name text fallback in the live preview header, and an `<img>` with the logo's data URL once one is set (confirms the GOAL's explicit "if no logo, fallback remains the display name" requirement is unchanged).
5. Thumbnail preview renders for a saved logo; removing one slot clears only that slot (verified the other two logo fields and the display name are untouched).
6. Distinct accessible names for all three upload inputs and all three remove buttons.
7. Mobile reachability at 390px via click-to-edit, with exactly 3 toolbar buttons (no 4th button added).

## 15. Typecheck result

```
npx tsc --noEmit
```
27 pre-existing errors remain, in files this PR never touched (`pos/settings/configuration`, `commerce/appearance/section-editing.test.tsx`, `section-instances.test.tsx`, `platform/integrations/gemini-card.test.tsx`, `documents/document-language-selector.test.tsx`, `global-application-controls-card.test.tsx`, `products/product-multi-barcode-table.test.tsx`, `products/product-variants-panel.test.tsx`, `products/product-workspace.test.tsx`, `documents/use-document-label-mode.test.tsx`, `import-jobs/useImportJobEngine.test.tsx`). Confirmed identical (same 27-line count) by stashing this PR's changes and re-running against the Base SHA directly — these predate this slice. **Zero errors in any file this PR changed.**

## 16. Build result

```
npm run build
```
Exit code `0`. Full static/dynamic route manifest generated with no compile errors or new warnings.

## 17. CI status

Verified on PR #1140's GitHub Actions checks:

- **CI:** SUCCESS (`php artisan test` — L11 sqlite and pgsql)
- **Web CI:** SUCCESS (web build / Next.js)
- **Store Brand QA:** SUCCESS (merchant preview visual QA, published footer visual QA)

All 7 check runs on the PR completed with conclusion `success`. No CI run was skipped or bypassed — these are the same checks the full local Vitest, typecheck and build runs above (§13–16) already validated.

## 18. Backward compatibility

- Panel ids (`"branding"`, `"theme"`), their nav grouping, their mobile `<select>` entries, and the default initial panel (`"theme"`) are byte-identical to before.
- `data-panel`, `data-panel-option`, `data-preview-chrome="branding"` and all other test/deep-link-relevant `data-*` attributes are unchanged.
- Click-to-edit from the live preview logo → `"branding"` panel routing (`handleSelectChrome`) is untouched.
- `handleSelectPage`'s fallback-to-`"theme"` logic when leaving `"homepage"`/`"product"`/`"category"` is untouched; `"branding"` was never part of that fallback set and still isn't.
- The only user-visible *new* string is `identityIntro`; no existing message key's value was changed, and no key was removed — verified no test anywhere in the suite asserted on the old (now-shared) "Choose image"/"Remove" accessible-name collision, so adding distinct `aria-label`s introduced no regression.
- Existing Versions/Drafts created before this slice continue to normalize and render identically: `presentation/config.ts` was not touched, so an existing stored `branding` object needs no migration and loses nothing.

## 19. Risks / remaining gaps

- **Dev-only storefront twin left unsynced.** `storefront/src/components/customizer/{ControlPanels,messages}.tsx` still has the old four-bare-fields `BrandingPanel` with shared accessible names. This is intentional (see §5) since it's dev-harness-only and not parity-tested, but a future slice that *does* start relying on that twin for visual QA should pick up the same framing.
- **No image-content validation beyond existing `sanitizeLogoUrl`.** The new thumbnail simply renders whatever `logoDataUrl`/`compactLogoDataUrl`/`faviconDataUrl` already passed that existing regex-based check; this PR added no new validation and relies entirely on the pre-existing contract.
- **One design decision worth flagging for owner review:** a `<Section title={t("branding")} ...>` (i.e., repeating "Identity" as a second heading inside the panel) was tried first and reverted after it created an ambiguous `getByRole('heading', { name: 'Identity' })` match against the inspector's own `<h2>`. The current shape (intro paragraph, no second heading) was chosen as the less redundant, equally clear option — but it is a visual judgment call, not a locked requirement from the architecture docs, and the owner may prefer an explicit "Store Identity" sub-heading instead.

## 20. Explicit confirmations

- No DB changes.
- No API changes.
- No schema version bump.
- No Backend changes.
- No Merge.
- No Deploy.
- No Production release.

## 21. Next step

**CUST-H3-2 — Color + Typography Truth.**

---

CUST-H3-1 READY FOR MERGE — OWNER APPROVAL REQUIRED
