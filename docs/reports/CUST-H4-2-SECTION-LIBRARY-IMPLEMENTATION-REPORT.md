# CUST-H4-2 — Capability Registry + Section Library UX — Implementation Report

**Horizon:** CUST-H4 — Section Library & Real Section Activation
**Slice:** H4-2 (Capability Registry + Section Library UX)
**Base SHA:** `b6024bd25a826e3800238d9c3ea1c62920001614` — `docs(store): define CUST-H4 section library and activation contract (#1150)`
**Review-fix commit (Head SHA):** `1135c56ea39facbbff6833ec9a68073e01277156`
**Branch:** `feat/cust-h4-2-section-library`
**PR:** [safwan5001-source/Nebrax#1154](https://github.com/safwan5001-source/Nebrax/pull/1154), open against `main`, not merged

---

## Revision Note 1 (owner/reviewer correction on PR #1154)

The first revision of this slice set `offers.merchantAddable: true` — reasoning
that today's already-shipped behavior (Offers addable, with an honest
`gatedBadge`/`gatedSection` caveat) was itself a "real, non-deceptive gate"
per CUST-H4-ARCH-1 §6, so H4-2 should formalize it rather than change it.

**The owner/reviewer corrected this on PR #1154: that reasoning was wrong for
the Library specifically.** The CUST-H4 rule is *no merchant-addable fake
section* — and Offers has neither the H4-6 real Commerce backend nor the
H4-7 real Canvas/Published renderers yet, so a merchant who adds it from the
Library gets a section that can never actually work until two entire future
slices ship. "Honest about being gated" and "still lets you add it anyway"
are not the same thing; §6's "real, non-deceptive gate" language describes
the pre-existing composer-row badge, not a license to make it addable via
this slice's own new Library UI.

**This revision:**
- Flips `offers.merchantAddable` from `true` to `false` (§3, §4). `state`
  stays `"gated"` — unchanged.
- Offers stays **visible** in the Library (never hidden) with a new,
  dedicated reason key (`sectionOffersComingSoon`) explaining it becomes
  addable once H4-6 + H4-7 ship — replacing the reused `gatedSection` copy,
  which was written for a different surface (the selected-instance settings
  panel) and didn't actually say "not addable."
- Fixes a real bug this revealed in `addDisabledReasonKey()`
  (`SectionLibrary.tsx`): it returned `null` for a capability-level
  non-addable reason, which would have silently shown no explanation at all
  once `merchantAddable: false` was set. The hierarchy is now explicit:
  (1) capability-level non-addable reason, (2) document-wide
  `MAX_HOME_SECTIONS` reason, (3) singleton/per-type max-instance reason.
- Updates the registry/Library tests that encoded the old "Offers stays
  addable" assumption (§11), and documents the still-not-performed
  `gated→live` / `false→true` transition explicitly (§4) so it isn't flipped
  prematurely in a later slice.
- Does **not** touch `canDuplicateSection`/the composer row's duplicate
  button for an *already-persisted* `offers` instance — that was true before
  this slice even started (pre-existing `canDuplicate: true`) and the
  review's scope is specifically the Library's `onAdd` path, not the
  existing composer row. Existing persisted Offers instances remain fully
  backward compatible and untouched.
- Everything else from the first revision — the registry's `state`/
  `category`/`titleKey`/`descriptionKey` fields, Featured's `partial` status,
  the 7-category taxonomy, the dialog UX itself — is carried forward
  unchanged; it was not reopened.

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

Cumulative diff vs. Base SHA (first H4-2 revision + this review fix,
same 7 files, no new files added by the fix):

```
 web/src/app/(commerce)/commerce/appearance/section-instances.test.tsx     |  49 +-   (M)
 web/src/modules/store-experience-builder/ControlPanels.tsx                |  56 +-   (M)
 web/src/modules/store-experience-builder/SectionLibrary.tsx               | 416 ++++ (A, new)
 web/src/modules/store-experience-builder/__tests__/SectionLibrary.test.tsx| 200 ++++ (A, new)
 web/src/modules/store-experience-builder/__tests__/section-capabilities.test.ts | 134 ++ (M)
 web/src/modules/store-experience-builder/messages.ts                      |  75 ++   (M)
 web/src/modules/store-experience-builder/presentation/section-capabilities.ts | 198 ++ (M)
 7 files changed, 1073 insertions(+), 55 deletions(-)
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
`offers` is the one type that sets it to `false` today (see Revision Note
1 above and §4); every other type keeps `merchantAddable: true`, so
existing add behavior for all 9 other types is unchanged.

## 4. Final capability matrix (H4-2 scope, post-review-fix)

| Type | state | category | merchantAddable | reasonKey when non-live |
|---|---|---|---|---|
| hero | live | mediaVideo | true | — |
| categories | live | categoriesNavigation | true | — |
| newArrivals | live | categoriesNavigation | true | — |
| wholesale | live | offersMarketing | true | — |
| banner | live | mediaVideo | true | — |
| featured | **partial** | products | true | "منتقي منتجات حقيقي قادم قريباً…" / "A real product picker is coming soon…" |
| offers | **gated** | offersMarketing | **false** | "العروض قادمة…" / "Offers is coming…" (`sectionOffersComingSoon`) |
| benefits | live | trustServices | true | — |
| appPromo | live | appCommunication | true | — |
| customContent | live | content | true | — |

This is an exact transcription of CUST-H4-ARCH-1 §5's bolded **State**
column — Featured is never flattened to LIVE. All 7 taxonomy categories
have at least one mapped section (no empty category); a dedicated test
(`maps every section to exactly one of the 7 taxonomy categories, none
empty`) guards this.

**Offers decision (corrected per Revision Note 1):** Offers is visible in
the Library — never hidden — but `merchantAddable: false` because neither
the H4-6 real Commerce backend nor the H4-7 real Canvas/Published
renderers exist yet. Its card is disabled and shows the dedicated
`sectionOffersComingSoon` reason, distinct from the pre-existing
`gatedSection` copy (which remains exactly as-is for an already-persisted
instance's selected-settings panel — untouched by this fix).

**Capability transition, documented but NOT performed by this PR:**

```
Today (H4-2, this PR):     offers.state = "gated",  offers.merchantAddable = false
After H4-6 + H4-7 ship:    offers.state = "live",   offers.merchantAddable = true
```

Both fields must flip together, only once H4-6 (the real `storefront_offers`
backend) and H4-7 (the real Canvas + Published renderers) are both done —
not as part of this or any H4-2 follow-up.

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
- A repeatable, merchant-addable type (`banner`, `featured`, `benefits`,
  `customContent`) stays addable until the document-wide
  `MAX_HOME_SECTIONS` (30) cap, at which point **every** card — singleton
  or not — disables with "بلغت الحد الأقصى للأقسام." / "Section limit
  reached.", reusing the existing message key the old Add button's
  `title` attribute already used.
- `offers` is the one capability-level exception: it is always disabled
  regardless of instance count or the document-wide cap, because
  `merchantAddable: false` wins first in the disabled-reason hierarchy
  (see below).
- Disabled controls never call `onAdd` (verified by dedicated tests
  clicking a disabled card — both a maxed-out singleton and the
  always-disabled `offers` card — and asserting the mock was not invoked).

**Disabled-reason hierarchy (fixed in the review-fix revision):**
`addDisabledReasonKey()` in `SectionLibrary.tsx` previously returned `null`
for a capability-level non-addable type, which would have silently shown no
explanation at all for `offers` once `merchantAddable` became `false`. It
now resolves in this order, matching the review's required priority:

1. **Capability-level non-addable reason** (`!cap.merchantAddable` →
   `cap.reasonKey`) — always wins first; this is what `offers` hits.
2. **Document-wide `MAX_HOME_SECTIONS` reason** — applies to every type
   once the 30-section cap is reached.
3. **Singleton/per-type max-instance reason** ("Already added") — applies
   once a capped type's instance count reaches its `maxInstances`.

The state badge (the small "غير مفعّل"/"قيد الإكمال" pill) is rendered
independently of this hierarchy and is unaffected by it — it reflects
`cap.state`, not the add-disabled reason.

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

Re-run in full after the review fix (Offers `merchantAddable: false` +
the `addDisabledReasonKey` hierarchy fix + updated/added tests):

**Targeted (new/changed) suites:**

```
src/modules/store-experience-builder/__tests__/section-capabilities.test.ts   22 tests passed  (+2: non-addable + transition-documentation tests)
src/modules/store-experience-builder/__tests__/SectionLibrary.test.tsx        13 tests passed  (+2: offers-disabled-with-reason + offers-click-never-adds)
src/app/(commerce)/commerce/appearance/section-instances.test.tsx             12 tests passed  (+1: offers-withheld integration test; multi-instance example switched from offers → benefits)
src/app/(commerce)/commerce/appearance/section-editing.test.tsx               8 tests passed  (unchanged — duplicate-button behavior for an existing offers instance is untouched by this fix)
```

**Full module directory** (`web/src/modules/store-experience-builder`):
25 test files, **261 tests passed**, 0 failed.

**Full `(commerce)` route group** (`web/src/app/(commerce)`):
18 test files, **182 tests passed**, 0 failed.

**Full web suite** (`npm test`, i.e. `vitest run` across all of `web/src`):
336 test files, **2526 tests passed**, 0 failed.

**TypeScript** (`npx tsc --noEmit`): pre-existing, unrelated errors exist on
`main` in files this slice never touches (`pos/settings/configuration`,
`gemini-card`, `document-language-selector`, `product-*`,
`use-document-label-mode`, `useImportJobEngine` — all pre-existing strict-
mode/test-typing gaps unrelated to Section Library/capabilities). None of
the 7 files this slice changed appear in that error list.

**Build** (`npm run build`), re-run after the review fix:
`✓ Compiled successfully in 16.3s`, `✓ Generating static pages (179/179)` —
clean, no errors.

**Backend** (`php artisan test`, full suite, no `--filter`, run from the
scaffolded `nibras-app` Laravel project per this repo's test-environment
convention): on the first H4-2 revision, locally, in this session's
scaffold: **4973 passed, 59 failed, 51 skipped (31069 assertions)**. Re-run
after this review fix for completeness — **zero PHP/Laravel files are part
of this diff, in either revision**, so this slice (and this fix) is
`web/` TypeScript only (presentation/UI layer, capability metadata, and
localization strings) and cannot itself change any backend test outcome.
§12 shows the authoritative result: the PR's own CI runs `php artisan
test` fresh on both SQLite and PostgreSQL and both are green, confirming
the local 59 failures are an artifact of this session's own scaffold, not
a real issue. No accounting/journal-entry table applies to this report:
this slice never calls `LedgerService::post` or any financial service —
it is a presentation/registry/UI-only change.

## 12. CI status

**Observed directly on GitHub for this PR — all 8 checks green** (on the
first revision's head commit, `6a4103c`; the review-fix commit re-triggers
the same workflows and is expected to match since the diff is `web/`-only):

| Check | Conclusion |
|---|---|
| `web build (Next.js)` ×2 | ✅ success |
| `php artisan test (L11, sqlite)` ×2 | ✅ success |
| `php artisan test (L11, pgsql)` ×2 | ✅ success |
| `merchant preview visual QA` | ✅ success |
| `published footer visual QA` | ✅ success |

This is the important correction to §11's backend note above: **CI's own
`php artisan test` runs (both SQLite and PostgreSQL) are green** on a
freshly-provisioned environment for this exact PR. That confirms the 59
failures seen locally in this session (e.g. `Class "App\Mail\AuthActionMail"
not found`) are an artifact of this session's own scaffolded `nibras-app`
checkout, not a real pre-existing repository issue and certainly not
something this diff caused — the repository's actual CI, which is the
authoritative gate, passes cleanly.

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
- The 59 local backend test failures (§11) are confirmed, via the PR's own
  green `php artisan test (L11, sqlite/pgsql)` CI checks (§12), to be an
  artifact of this session's local `nibras-app` scaffold only — not a real
  repository issue and not caused by this diff.
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
  no Offers Canvas/Published renderer exist. Offers' composer-row/
  selected-settings behavior for an already-persisted instance is
  unchanged. The one behavior this PR does change is new-instance
  creation from the Library: Offers is now correctly withheld from
  merchant-addable results until H4-6 and H4-7 both ship (see Revision
  Note 1 and §4's documented transition).
- **H4-8** — No integrated responsive/RTL/LTR/accessibility/parity QA pass
  across all 10 sections has been performed; this report's §13 visual-QA
  gap is exactly the kind of item that pass is meant to close.

## 16. No Merge / No Deploy / No Production release

This task did not merge the PR, did not deploy anything, and did not
release anything to production. The PR remains open, pending review.

## 17. Next recommended step

Owner/reviewer review of this PR, specifically:
1. Confirm the corrected Offers behavior (§4, Revision Note 1) — visible,
   `state: "gated"`, `merchantAddable: false`, disabled with an honest
   "coming soon" reason — matches intent.
2. Decide whether a real screenshot-based visual QA pass is required
   before H4-2 is considered closed, or deferred to H4-8 as this report
   recommends.
3. On approval, proceed to H4-3/H4-4/H4-5 (independently parallelizable
   per the Horizon's own sequencing) and H4-6 (Offers backend, startable
   independently of all of them) — H4-6+H4-7 are also what unlocks
   flipping `offers` to `state: "live", merchantAddable: true` per §4's
   documented transition.
