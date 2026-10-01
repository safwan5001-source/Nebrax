# CUST-H4-2 — Capability Registry + Section Library UX — Implementation Report

**Horizon:** CUST-H4 — Section Library & Real Section Activation
**Slice:** H4-2 (Capability Registry + Section Library UX)
**Base SHA:** `b6024bd25a826e3800238d9c3ea1c62920001614` — `docs(store): define CUST-H4 section library and activation contract (#1150)`
**Implementation commit (Head SHA):** `b6f360b812a8441bff81b09d72b64cd61c062397`
**Branch:** `feat/cust-h4-2-section-library`
**PR:** opened against `main`, not merged (see final chat response for the URL/number)

---

## 1. Scope actually implemented

Per `docs/plans/store/CUST-H4-ARCH-1-SECTION-LIBRARY-ACTIVATION-CONTRACT.md` §17/§35
(H4-2 definition), this slice:

- Formalizes merchant-facing capability metadata directly on the existing
  `SECTION_CAPABILITIES` registry (`web/src/modules/store-experience-builder/presentation/section-capabilities.ts`)
  — no second/parallel registry was created.
- Builds a real Section Library UI (`SectionLibrary.tsx`) replacing the flat,
  unsearchable inline `<ul>` "add section" list that previously lived in
  `ControlPanels.tsx`'s `HomepagePanel`.
- Adds full Arabic/English localization for every new string through the
  existing `messages.ts` system — no hardcoded merchant-facing text.
- Adds focused tests for the registry and the Library component, and updates
  one existing integration test whose assertions encoded the old flat
  picker's shape (see §6).

**Explicitly not touched in this slice** (per the task's scope guard and
confirmed unnecessary by evidence): Categories/NewArrivals Canvas parity
(H4-3), Banner/Benefits/CustomContent/AppPromo completion (H4-4), Featured's
real product picker (H4-5), Offers' Commerce contract/backend/renderers
(H4-6/H4-7), and the cross-section QA pass (H4-8). No content contract
(`section-content.ts`), no `GATED_HOME_SECTION_KEYS`, no Canvas/Published
renderer, no API route, and no database migration was changed. Zero PHP/
Laravel files are part of this diff.

---

## 2. Files changed

```
 web/src/app/(commerce)/commerce/appearance/section-instances.test.tsx     |  13 +-   (M)
 web/src/modules/store-experience-builder/ControlPanels.tsx                |  56 +--   (M)
 web/src/modules/store-experience-builder/SectionLibrary.tsx               | 408 ++++  (A, new)
 web/src/modules/store-experience-builder/__tests__/SectionLibrary.test.tsx| 186 +++   (A, new)
 web/src/modules/store-experience-builder/__tests__/section-capabilities.test.ts | 112 ++ (M)
 web/src/modules/store-experience-builder/messages.ts                      |  63 ++    (M)
 web/src/modules/store-experience-builder/presentation/section-capabilities.ts | 192 ++ (M)
 7 files changed, 978 insertions(+), 52 deletions(-)
```

---

## 3. Capability registry changes

`SectionCapability` (in `section-capabilities.ts`) gained:

| Field | Type | Purpose |
|---|---|---|
| `state` | `"live" \| "partial" \| "gated" \| "deferred"` | Truth state per CUST-H4-ARCH-1 §5 — never flattened to `"live"`. |
| `category` | `SectionLibraryCategory` (7-value union) | Section Library taxonomy group (§16). |
| `merchantAddable` | `boolean` | Independent gate from instance-count rules; `canAddSectionType` now checks it first. |
| `titleKey` / `descriptionKey` | `CustomizerMessageKey` | Single source of truth for the card/composer title and the Library's short merchant-facing description — `ControlPanels.tsx`'s old hand-authored `SECTION_LABEL` map is now a one-line derived alias from this field, removing a duplication risk. |
| `reasonKey` | `CustomizerMessageKey?` | Shown on the Library card whenever `state !== "live"`. |

New exports: `SectionCapabilityState`, `SectionLibraryCategory`,
`SECTION_LIBRARY_CATEGORIES` (ordered list of all 7), `SECTION_LIBRARY_CATEGORY_LABEL`
(category → message key), `sectionTypesInCategory(category)`.

`canAddSectionType` now also returns `false` when `!cap.merchantAddable` —
additive; every one of the 10 current types has `merchantAddable: true`
today (no type is withheld), so existing behavior is unchanged until a
future type sets it to `false`.

## 4. Final capability matrix (H4-2 scope)

| Type | state | category | merchantAddable | reasonKey when non-live |
|---|---|---|---|---|
| hero | live | mediaVideo | true | — |
| categories | live | categoriesNavigation | true | — |
| newArrivals | live | categoriesNavigation | true | — |
| wholesale | live | offersMarketing | true | — |
| banner | live | mediaVideo | true | — |
| featured | **partial** | products | true | "منتقي منتجات حقيقي قادم قريباً…" / "A real product picker is coming soon…" |
| offers | **gated** | offersMarketing | true | reuses the existing `gatedSection` copy |
| benefits | live | trustServices | true | — |
| appPromo | live | appCommunication | true | — |
| customContent | live | content | true | — |

This is an exact transcription of CUST-H4-ARCH-1 §5's bolded **State**
column — Featured is never flattened to LIVE, and Offers is never hidden
or flattened. All 7 taxonomy categories have at least one mapped section
(no empty category); a dedicated test (`maps every section to exactly one
of the 7 taxonomy categories, none empty`) guards this.

**Offers decision (H4-2 scope, not reinterpreted):** the architecture
document does not instruct H4-2 to change Offers' addability — today's
code already allows adding `offers` instances with an honest `gatedBadge`
pill and `gatedSection` explanatory copy (§6 of the contract calls this
"a real, working, non-deceptive gate — it is just minimal"). H4-2 keeps
that behavior and only formalizes it into the registry (`merchantAddable:
true`, `state: "gated"`, `reasonKey: "gatedSection"`) instead of changing
it. This is recorded explicitly because the task brief flagged Offers'
addability as a decision to follow from the merged document rather than
reinterpret independently.

## 5. Section Library UX behavior

`SectionLibraryDialog` (`SectionLibrary.tsx`), opened from `HomepagePanel`'s
existing local `pickerOpen` state (same trigger button as before):

- **Centered dialog**, not a Bottom Sheet — reuses the exact precedent
  `PublishConfirmDialog` already established in `ExperienceBuilder.tsx`
  ("مركزيٌّ لا Bottom Sheet — نفس الترميز على الجوال وسطح المكتب"): a
  `fixed inset-0` backdrop, `role="dialog" aria-modal="true"`, `max-w-lg`,
  `max-h-[85dvh]` with independent `overflow-y-auto` on the card list only
  (header/search/chips stay fixed).
- **No new `ExperienceBuilder` wiring.** Because `HomepagePanel` (and thus
  the picker) is already rendered both in the desktop sidebar and inside
  the generic mobile "sections" Bottom Sheet, the new dialog nests inside
  that existing Bottom Sheet on mobile automatically — confirmed no
  `transform`/`filter`/`will-change` exists on any ancestor (there's an
  explicit prior-art comment in `ExperienceBuilder.tsx` confirming this),
  so the dialog's own `fixed` positioning escapes to the viewport correctly
  without a portal.
- **Search** matches a simple lower-cased substring against each type's
  translated title + description (`normalizeSearchText`) — no new fuzzy-
  search infrastructure, per the task's own guidance that simple matching
  is sufficient.
- **Categories**: the 7 taxonomy chips + "All". Selecting "All" (default)
  groups cards under category headings; selecting one category hides the
  rest (headings and cards) and shows only that category's matches —
  verified by test.
- **Cards**: title, short description, a small deterministic inline-SVG
  thumbnail (per-type pictogram — grid for Categories, star for Featured,
  price-tag for Offers, etc.), a state badge for non-live types only
  ("قيد الإكمال"/"In progress" for partial, the existing "غير مفعّل"/"Not
  enabled" pill for gated — **no badge at all for live types**, keeping
  the Library scannable rather than noisy), and an explanatory reason line
  when applicable. No developer terminology (`type`, `schema`, `registry`,
  `capability`, `renderer`) is ever rendered to the merchant.
- **Add behavior**: unchanged section-instance model — clicking an
  addable card calls the same `addSection`/`canAddSectionType` path
  `HomepagePanel` already had; the dialog closes and the new instance is
  selected, exactly as before.

## 6. Singleton / repeatable / max-instance behavior

- A singleton already present (`hero`, `categories`, `newArrivals`,
  `wholesale`, `appPromo` — all 5 exist once in `DEFAULT_PRESENTATION_CONFIG`)
  renders its card **disabled** with the explicit reason "أُضيف بالفعل" /
  "Already added" — never a silently-disabled button with no explanation.
- A repeatable type (`banner`, `featured`, `offers`, `benefits`,
  `customContent`) stays addable until the document-wide
  `MAX_HOME_SECTIONS` (30) cap, at which point **every** card — singleton
  or not — disables with "بلغت الحد الأقصى للأقسام." / "Section limit
  reached.", reusing the existing message key the old Add button's
  `title` attribute already used.
- Disabled controls never call `onAdd` (verified by a dedicated test
  clicking a disabled card and asserting the mock was not invoked).

## 7. RTL/LTR behavior

- No direction-specific hardcoded margins — logical Tailwind classes
  throughout (`gap-*`, `px-*`, `text-start`), consistent with the rest of
  the module's existing components (`ProductPreviewPickerPanel`,
  `ProductRegionInspector`).
- Section titles wrapped in `<bdi>` for correct bidi isolation of
  merchant-facing/translated text, matching the existing Hero/
  ProductPreviewPickerPanel precedent.
- Verified by running the full component test suite under the `ar` locale
  (the module's default/primary locale) and explicitly re-rendering the
  dialog under `en` in a dedicated test to confirm no raw message key
  leaks in either direction.
- Category chips and search input use a plain flex-wrap row with no
  direction-dependent absolute positioning, so RTL/LTR mirrors purely via
  the `dir` attribute the rest of the Customizer already sets.

## 8. Mobile behavior

- Reuses the established preview-first mobile Customizer model: the
  Library opens as an additive dialog, not a new product/navigation
  concept.
- Search input is a real `<input type="search">` with an associated
  `sr-only` `<label>` — usable with the on-screen keyboard open; the card
  list area scrolls independently of the header/search/chips (`overflow-
  y-auto` scoped to the list container only), so opening the keyboard
  cannot trap or hide the search field.
- No horizontal overflow: the dialog is `w-full max-w-lg` with `p-4`
  gutters and a `grid-cols-1 sm:grid-cols-2` card grid, so at 390/430px
  width cards stack in a single column with no clipped content.
- Opening/closing the Library only toggles `HomepagePanel`'s local
  `pickerOpen` boolean — it never touches `StorefrontPresentationConfig`,
  so Canvas scroll position, selection, and Draft/dirty state are
  unaffected by open/close (structural guarantee, not something that
  needed a new test: the dialog receives `sections` read-only and emits
  only `onAdd`/`onClose`).

## 9. Accessibility behavior

- Real `<dialog>`-pattern markup: `role="dialog"`, `aria-modal="true"`,
  `aria-labelledby` pointing at the visible `<h2>` title.
- Every section card is a genuine `<button>` (never a click-only `<div>`),
  keyboard-focusable and keyboard-activatable natively, `disabled` for
  non-addable states (so screen readers and keyboard users get the native
  disabled semantics, not just a visual dimming).
- Search input has a proper `sr-only` `<label htmlFor>` pairing — no bare
  placeholder-as-label anti-pattern.
- Category chips are real `<button aria-pressed>` elements grouped under
  `role="group" aria-label`.
- Disabled state is never color-only: every disabled card also carries a
  visible text reason ("Already added" / the limit-reached copy / the
  gated/partial reason), satisfying "disabled state understandable beyond
  color."
- `autoFocus` moves focus onto the search input when the dialog opens —
  this is both a UX nicety and the mechanism that makes **Escape actually
  work**: the root backdrop's `onKeyDown` only receives the bubbled
  keydown once focus is already inside the dialog subtree, exactly the
  same pattern `VersionManagerPanel.tsx`'s own create-form input already
  established in this codebase (`autoFocus` + a keydown handler reachable
  from the focused control).
- Thumbnails are `aria-hidden="true"` (decorative, per the task's explicit
  "thumbnail decorative content handled appropriately" requirement) —
  the card's own title text is the accessible name.

## 10. Localization

All new merchant-facing strings were added to the existing
`CUSTOMIZER_MESSAGES` object in `messages.ts` (both `ar` and `en` blocks,
same key set in each — verified by a dedicated test resolving every
title/description/category-label/reason key used by the registry in both
locales and asserting neither falls back to the raw key string). No
hardcoded text exists in `SectionLibrary.tsx` — every visible string goes
through the `t()` callback the rest of the module already uses.

## 11. Tests executed — exact results

**Targeted (new/changed) suites:**

```
src/modules/store-experience-builder/__tests__/section-capabilities.test.ts   20 tests passed
src/modules/store-experience-builder/__tests__/SectionLibrary.test.tsx        11 tests passed
src/app/(commerce)/commerce/appearance/section-instances.test.tsx             11 tests passed
src/app/(commerce)/commerce/appearance/section-editing.test.tsx               8 tests passed
```

**Full module directory** (`web/src/modules/store-experience-builder`):
25 test files, **257 tests passed**, 0 failed.

**Full `(commerce)` route group** (`web/src/app/(commerce)`):
18 test files, **181 tests passed**, 0 failed.

**Full web suite** (`npm test`, i.e. `vitest run` across all of `web/src`):
336 test files, **2521 tests passed**, 0 failed.

**TypeScript** (`npx tsc --noEmit`): pre-existing, unrelated errors exist on
`main` in files this slice never touches (`pos/settings/configuration`,
`gemini-card`, `document-language-selector`, `product-*`,
`use-document-label-mode`, `useImportJobEngine` — all pre-existing strict-
mode/test-typing gaps unrelated to Section Library/capabilities). None of
the 7 files this slice changed appear in that error list.

**Build** (`npm run build`): `✓ Compiled successfully in 18.7s`,
`✓ Generating static pages (179/179)` — clean, no errors.

**Backend** (`php artisan test`, full suite, no `--filter`, run from the
scaffolded `nibras-app` Laravel project per this repo's test-environment
convention): **4973 passed, 59 failed, 51 skipped (31069 assertions)**,
duration 937s. **Zero PHP/Laravel files are part of this diff** — this
slice is `web/` TypeScript only (presentation/UI layer, capability
metadata, and localization strings). The failures are pre-existing in the
scaffolded environment and unrelated to this change (e.g. the first
failure surfaced is `Class "App\Mail\AuthActionMail" not found` in
`UserInvitationTest` — an environment/autoload gap, not a regression this
diff could cause, since no file in `app/`, `database/`, `routes/`, or
`tests/` was touched). No accounting/journal-entry table applies to this
report: this slice never calls `LedgerService::post` or any financial
service — it is a presentation/registry/UI-only change.

## 12. CI status

Not yet observed on GitHub for this PR at report-writing time (PR just
opened). The two gates this repository's `web-ci.yml` actually runs are
`npm run test` and `npm run build`, both of which were run locally above
with the results shown — the PR's CI run is expected to mirror them.

## 13. Visual QA

**Not performed with real screenshots in this session** — no browser/dev-
server screenshot tool was available in this execution environment for
this task. What *was* verified instead, and should be treated as a
substitute, not an equivalent:

- The full rendered DOM tree was inspected via Vitest's
  `--reporter`/failure-diff output while iterating on the component (the
  `SectionLibrary.test.tsx` failures during development printed the full
  serialized DOM, which was read and used to fix two test-query bugs —
  see commit history for the corrected `getByRole("heading", …)` queries).
- Responsive class choices (`max-w-lg`, `grid-cols-1 sm:grid-cols-2`,
  `max-h-[85dvh]`, `p-4` gutters) were chosen by directly matching the
  classes `PublishConfirmDialog` and `ProductPreviewPickerPanel` already
  use at the same breakpoints in this same module, not invented fresh.
- RTL was exercised functionally (the default test locale is `ar`, and
  every assertion runs against the Arabic-rendered DOM), but no pixel-
  level screenshot comparison at 390/430/768/1024/1280/1440 was captured.

**This is recorded honestly as a gap, not claimed as done.** If a real
visual QA pass (actual screenshots at the six specified widths, both
directions) is required before this slice is considered fully closed, it
should be treated as a follow-up on this same PR rather than assumed.

## 14. Risks / remaining items

- Visual QA (§13) is code-level/DOM-level verified, not screenshot-
  verified. Recommend a follow-up visual pass (desktop + mobile, both
  directions) before treating H4-2 as fully closed, ideally folded into
  H4-8's own cross-section QA pass per the Horizon plan rather than
  duplicated here.
- The pre-existing 59 backend test failures in the scaffolded environment
  (`App\Mail\AuthActionMail` and whatever else the full run surfaces) are
  unrelated to this slice but are flagged here for visibility — they exist
  on `main` independent of this change.
- `SECTION_LABEL` in `ControlPanels.tsx` is now a derived one-liner from
  the registry rather than a hand-authored map — a deliberate de-
  duplication, not a behavior change; every existing `SECTION_LABEL[type]`
  call site is untouched.

## 15. Confirmation of what remains for H4-3 through H4-8

Unchanged by this slice, exactly as scoped:

- **H4-3** — Categories/NewArrivals Canvas still reads the deliberate mock
  `PREVIEW_CATEGORIES`/`PREVIEW_PRODUCTS` fixtures; wiring to the already-
  shipped `commerce/workspace/storefronts/{id}/{categories,products}` reads
  is untouched.
- **H4-4** — Banner has no `imageAlt` field yet; AppPromo's content is
  still authored from the separate "Apps" settings panel, not its own
  Content tab.
- **H4-5** — Featured's Content tab is still a raw product-id text input
  (no real multi-select picker); `FeaturedShelf.tsx`'s Published renderer
  still does N unbatched per-product fetches.
- **H4-6/H4-7** — No `storefront_offers` table, no `StorefrontOfferResolver`,
  no workspace CRUD routes, no `GET /store/v1/offers`, no `OffersContent`,
  no Offers Canvas/Published renderer exist. Offers remains exactly as
  gated as it was before this slice (unchanged runtime behavior) — only
  its registry metadata is now formalized.
- **H4-8** — No integrated responsive/RTL/LTR/accessibility/parity QA pass
  across all 10 sections has been performed; this report's §13 visual-QA
  gap is exactly the kind of item that pass is meant to close.

## 16. No Merge / No Deploy / No Production release

This task did not merge the PR, did not deploy anything, and did not
release anything to production. The PR remains open, pending review.

## 17. Next recommended step

Owner/reviewer review of this PR, specifically:
1. Confirm the Offers "stays addable, formalized as gated" interpretation
   (§4) matches intent, rather than hiding Offers from addable results.
2. Decide whether a real screenshot-based visual QA pass is required
   before H4-2 is considered closed, or deferred to H4-8 as this report
   recommends.
3. On approval, proceed to H4-3/H4-4/H4-5 (independently parallelizable
   per the Horizon's own sequencing) and H4-6 (Offers backend, startable
   independently of all of them).
