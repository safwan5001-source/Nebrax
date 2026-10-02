# CUST-H4-2 — Capability Registry + Section Library UX — Implementation Report

**Horizon:** CUST-H4 — Section Library & Real Section Activation
**Slice:** H4-2 (Capability Registry + Section Library UX)
**Base SHA:** `b6024bd25a826e3800238d9c3ea1c62920001614` — `docs(store): define CUST-H4 section library and activation contract (#1150)`
**Mobile UX polish commit (Head SHA):** `f6da3659bc0eb6ad0a8b04f82efd4b0a39663bf3`
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

## Revision Note 2 (owner/reviewer correction on PR #1154 — mobile contract)

Revision 1's `SectionLibraryDialog` was a centered dialog on **both** desktop
and mobile, explicitly documented as such ("Centered dialog, not a Bottom
Sheet — same markup on mobile and desktop"). On mobile this opened **nested
inside** the existing "sections" Bottom Sheet `ExperienceBuilder.tsx` already
provides — a second `aria-modal` surface stacked on top of the first,
contradicting the merged H4 architecture's own mobile UX contract (§26:
"The Section Picker must follow the same Bottom Sheet pattern on mobile, not
a separate modal paradigm").

**This revision:**

- Splits the component (`SectionLibrary.tsx`) into `SectionLibraryContent`
  (the actual search/category/card content, no dialog/modal chrome of its
  own) and `SectionLibraryDialog` (the existing centered-dialog wrapper,
  desktop-only now, built from `SectionLibraryContent`).
- **Desktop:** unchanged — `SectionLibraryDialog`, same centered-dialog
  precedent as `PublishConfirmDialog`.
- **Mobile:** `HomepagePanel` (`ControlPanels.tsx`) now renders
  `SectionLibraryContent` **directly in place of its own composer body**
  when the picker is open and `isMobileViewport` is true — inside the
  *same* "sections" Bottom Sheet `ExperienceBuilder.tsx` already opens, via
  an early return, not a new dialog. No new `mobileSheet` state/wiring was
  needed: `isMobileViewport` is threaded through as one new optional prop
  (`PanelsProps` → `HomepagePanel`), reusing the exact `isMobileViewport`
  state `ExperienceBuilder` already computes. There is never more than one
  `role="dialog"`/`aria-modal="true"` surface on screen on mobile.
- The Library's own header close button becomes a **back** control on
  mobile (`onClose` → `setPickerOpen(false)`, which simply falls through to
  the normal composer render) rather than an **exit** — the sheet itself
  never closes, satisfying "Back/close behavior must return cleanly to the
  previous Sections state."
- The card list's scroll region switched from `flex-1 overflow-y-auto`
  (which depends on an ancestor flex column with a defined height — true
  for the desktop dialog, not true for the mobile sheet's own plain
  `overflow-y-auto` body) to a fixed `max-h-[*vh]` cap — the same
  fixed-height nested-scroll-region pattern `ProductPreviewPickerPanel`
  already uses elsewhere in this module — so "independent scrolling" holds
  in both presentations without depending on a specific ancestor layout.
- Fixed the two stale comments P2 flagged in `section-capabilities.ts` (the
  module-level "stays addable-with-honest-copy" line and the
  `merchantAddable` field's "None today" line) — both described the
  pre-Revision-1-fix behavior; no runtime state changed in this revision.
- Added real browser visual QA via Playwright against the existing
  `/dev/customizer-versions` fixture (no backend/login needed — the same
  pattern `cust-h2-2-page-navigator.spec.ts` already uses) — see §13.

## Revision Note 3 (owner/reviewer correction on PR #1154 — Back vs Close affordance)

Revision 2 correctly moved the Library inside the existing mobile Bottom
Sheet instead of stacking a second dialog on top of it, but left its own
header control as a "×" (Close) icon — identical in appearance to the
outer sheet's own "×", right above it. Both controls called a handler
named `onClose`, but they do different things: the outer "×" exits the
whole Sections sheet; the inner one only returns to the composer list.
Two identical-looking "×" controls for two different actions is confusing.

**This revision:**

- Adds `closeAction?: "close" | "back"` to `SectionLibraryContent` (default
  `"close"`, preserving every existing desktop call site's behavior without
  changes). Only the header control's **icon and accessible label** switch
  on this prop — the handler is still `onClose` either way; nothing about
  *what* happens changes, only how it's presented.
- `SectionLibraryDialog` (desktop) now passes `closeAction="close"`
  explicitly — unchanged behavior, made explicit per the review's own
  "small explicit prop" guidance.
- `HomepagePanel`'s mobile branch (`ControlPanels.tsx`) now passes
  `closeAction="back"` — the control reads "رجوع"/"Back" with a directional
  arrow instead of "×", labeled via a new `sectionLibraryBack` message key
  (ar/en), distinct from the existing `close` key the outer sheet's "×"
  still uses.
- The arrow is drawn pointing start-ward (left, LTR) and flipped under
  `rtl:rotate-180` — the exact same logical-direction Tailwind pattern
  `storefront/.../HeroSection.tsx` already uses for its own chevron, not a
  hardcoded locale check. Under RTL it correctly points right (toward
  "back" in a right-to-left reading flow).
- New `data-section-picker`/`data-close-action` and
  `data-section-library-close-action` attributes make the distinction
  assertable in tests (and inspectable in the browser) without relying on
  icon shape alone.
- Desktop is otherwise untouched — same `SectionLibraryDialog`, same close
  behavior, same tests passing unchanged.

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

Cumulative diff vs. Base SHA (all three review-fix revisions included;
`git diff --stat` on the staged tree, so new files are counted too):

```
 web/e2e/cust-h4-2-section-library-visual.spec.ts                          | 144 ++++       (A, new — Rev. 2; extended in Rev. 3)
 web/src/app/(commerce)/commerce/appearance/section-instances.test.tsx     |  49 ++-         (M)
 web/src/app/(commerce)/commerce/appearance/section-library-mobile.test.tsx| 270 +++++       (A, new — Rev. 2; extended in Rev. 3)
 web/src/modules/store-experience-builder/ControlPanels.tsx                |  85 ++--         (M)
 web/src/modules/store-experience-builder/ExperienceBuilder.tsx            |   2 +            (M)
 web/src/modules/store-experience-builder/SectionLibrary.tsx               | 510 +++++++++++  (A, new — Rev. 1; restructured Rev. 2; closeAction added Rev. 3)
 web/src/modules/store-experience-builder/__tests__/SectionLibrary.test.tsx| 284 ++++++++++    (A, new — Rev. 1; extended Rev. 2 and Rev. 3)
 web/src/modules/store-experience-builder/__tests__/section-capabilities.test.ts | 134 ++++++ (M)
 web/src/modules/store-experience-builder/messages.ts                      |  83 ++++          (M)
 web/src/modules/store-experience-builder/presentation/section-capabilities.ts | 218 +++++++- (M)
 10 files changed, 1724 insertions(+), 55 deletions(-)
```

This fix's own diff (Revision 3 only, on top of the Revision-1/2 commits
`b6f360b`/`1135c56`/`6a4103c`/`716906e`/`350f0d3`/`46fd93a`) touches 6
files: `SectionLibrary.tsx` (`closeAction` prop + `BackIcon`),
`ControlPanels.tsx` (`closeAction="back"` on the mobile call site),
`messages.ts` (new `sectionLibraryBack` key, ar/en), `SectionLibrary.test.tsx`
(4 new tests), `section-library-mobile.test.tsx` (1 new test + 1 updated),
and `e2e/cust-h4-2-section-library-visual.spec.ts` (back-vs-close
assertions + new screenshots) — plus this report.

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

`SectionLibraryContent` (`SectionLibrary.tsx`) holds the actual search/
category/card content, shared by two presentations, chosen by
`HomepagePanel` (`ControlPanels.tsx`) from the `isMobileViewport` prop
`ExperienceBuilder.tsx` threads down:

- **Desktop** (`isMobileViewport === false`) — `SectionLibraryDialog` wraps
  `SectionLibraryContent` in a **centered dialog**, reusing the exact
  precedent `PublishConfirmDialog` already established in
  `ExperienceBuilder.tsx` ("مركزيٌّ لا Bottom Sheet — نفس الترميز على
  الجوال وسطح المكتب"): a `fixed inset-0` backdrop, `role="dialog"
  aria-modal="true"`, `max-w-lg`, `max-h-[85dvh]`, independent
  `overflow-y-auto` on the card list (`flex-1`) with header/search/chips
  fixed. `closeAction="close"` — the header control is a real "×" Close,
  because on desktop it genuinely closes the dialog.
- **Mobile** (`isMobileViewport === true`) — **no dialog wrapper at all.**
  `HomepagePanel` renders `SectionLibraryContent` directly, in place of its
  own composer body, inside the *same* generic "sections" mobile Bottom
  Sheet `ExperienceBuilder.tsx` already opens (an early return in
  `HomepagePanel`, gated on `pickerOpen && isMobileViewport`) — not a
  second stacked dialog. The card list's scroll region uses a fixed
  `max-h-[60vh]` cap instead of `flex-1` here, since the mobile sheet's own
  body is a plain `overflow-y-auto` div with no defined height for a
  `flex-1` child to fill (the same fixed-height nested-scroll pattern
  `ProductPreviewPickerPanel` already uses). There is never more than one
  `role="dialog"`/`aria-modal="true"` surface on screen — see Revision
  Note 2 for why the first revision's "always a centered dialog, even on
  mobile" approach was wrong and what replaced it. `closeAction="back"`
  (Revision Note 3) — the header control reads "رجوع"/"Back" with a
  directional arrow (`rtl:rotate-180`, same logical-flip pattern
  `storefront/.../HeroSection.tsx`'s own chevron already uses), not a
  second "×" next to the outer sheet's real Close — it returns to the
  composer, the sheet itself never closes.
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

## 8. Mobile behavior (rewritten for Revision 2 — real architecture; Back/Close polish in Revision 3)

- **Follows the existing Bottom Sheet contract, not a nested modal.** The
  Library opens *inside* the same generic "sections" mobile Bottom Sheet
  `ExperienceBuilder.tsx` already provides (reached via the bottom-nav "+
  إضافة قسم" button or the "الأقسام" tab), replacing that sheet's own
  composer content in place — confirmed by a real browser test asserting
  `page.getByRole('dialog')` stays at count 1 throughout open → search →
  add → close.
- **Back, not a second Close (Revision Note 3).** The Library's own header
  control now reads `aria-label="رجوع"`/`"Back"` with a directional arrow
  icon — not `aria-label="إغلاق"` (Close), which the outer Sections sheet's
  own control keeps exclusively. Clicking it calls `setPickerOpen(false)`,
  which simply falls through to `HomepagePanel`'s normal composer render —
  the sheet itself never closes. Verified at three levels: a component
  test asserting the label/icon pair for `closeAction="back"` vs
  `"close"`; an `ExperienceBuilder`-level integration test asserting
  exactly one `aria-label="إغلاق"` element exists on the whole page while
  the Library is open (the outer sheet's), that the Library's own control
  is `aria-label="رجوع"` and is *not* a descendant of anything labeled
  "إغلاق", and that clicking it returns to the composer in the same still-
  open sheet; and a real browser test confirming the same, plus that the
  outer sheet's own "إغلاق" still closes the whole sheet when clicked.
- **Preserves document state.** Opening the Library only sets local
  `pickerOpen` state; it never touches `StorefrontPresentationConfig` —
  confirmed in the browser test by reading
  `[data-experience-builder]`'s `data-lifecycle` attribute (stays
  `"clean"` after merely opening the Library).
- Search input is a real `<input type="search">` with an associated
  `sr-only` `<label>`, usable with the on-screen keyboard open; the card
  list area is capped at `max-h-[60vh]` with its own `overflow-y-auto`
  (see §5 for why this differs from the desktop dialog's `flex-1`).
- No horizontal overflow at 390/430px — verified both by the Vitest
  integration suite and, now, by a real rendered browser at both exact
  widths (`document.documentElement.scrollWidth <= clientWidth`,
  screenshotted; see §13).
- Add still goes through the same `addSection` path `HomepagePanel`
  already had — verified end-to-end in the browser: adding `banner`
  returns to the composer with a new, visible `banner` row and the newly
  added instance's own settings shown (identical selection behavior to
  the pre-existing desktop flow).

**Observation from visual QA, pre-existing, not touched by this fix:** at
the `/dev/customizer-versions` fixture's true-mobile viewport,
`HomepagePanel` is actually mounted *twice* simultaneously — once inside
`ExperienceBuilder`'s CSS-hidden (`class="hidden ... lg:flex"`) desktop
`<aside>`, once inside the mobile Bottom Sheet — because the `<aside>`'s
hidden/visible class is driven by `mobilePane` ("edit"/"preview") alone,
with no explicit `isMobileViewport` check forcing it hidden below the
`lg` breakpoint. In every path this fix's own tests and visual QA actually
exercise, `mobilePane` stays at its default (`"preview"`), so the `<aside>`
copy is never visually shown — but it does mean a test or a future change
must not write an unscoped `page.locator(...)` query on this page expecting
exactly one match for composer-row/picker selectors; ours are explicitly
scoped to the visible sheet (see `cust-h4-2-section-library-visual.spec.ts`).
This is pre-existing `ExperienceBuilder.tsx` behavior unrelated to the
Section Library, out of this fix's bounded scope, and is recorded here
only because visual QA surfaced it directly.

## 9. Accessibility behavior

- Real `<dialog>`-pattern markup on desktop: `role="dialog"`,
  `aria-modal="true"`, `aria-label` set to the Library's title (switched
  from `aria-labelledby` + a shared `useId()` in Revision 1 to a plain
  `aria-label` in Revision 2, matching `ExperienceBuilder.tsx`'s own
  generic mobile sheet precedent exactly, once the title's owning `<h2>`
  moved into the now-shared `SectionLibraryContent` and no longer had a
  single fixed id to cross-reference from two different wrapper contexts).
- **Never more than one `aria-modal` surface.** On mobile,
  `SectionLibraryContent` carries no `role`/`aria-modal` of its own — only
  the pre-existing outer sheet does — confirmed by a dedicated unit test
  (`SectionLibraryContent` renders with `role`/`aria-modal` both absent)
  and by the browser test's running `page.getByRole('dialog')` count
  assertion at every step.
- **Never two identically-labeled controls for two different actions**
  (Revision Note 3). The header control's accessible name now matches
  what it actually does: `aria-label="رجوع"`/`"Back"` on mobile
  (`closeAction="back"`), `aria-label="إغلاق"`/`"Close"` on desktop
  (`closeAction="close"`, the default) — a screen reader user on mobile
  never hears "Close" twice for two different outcomes. The back arrow is
  `aria-hidden="true"` (decorative; the button's own `aria-label` carries
  the meaning), drawn start-ward and flipped via `rtl:rotate-180` so it
  always points toward "previous" in the active reading direction.
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

Re-run in full after this mobile UX polish (Back/Close affordance split +
new/updated tests):

**Targeted (new/changed) suites:**

```
src/modules/store-experience-builder/__tests__/section-capabilities.test.ts    22 tests passed  (unchanged by this fix — no runtime state changed)
src/modules/store-experience-builder/__tests__/SectionLibrary.test.tsx         18 tests passed  (+4: closeAction default, back-renders-not-close + calls onClose, English back label, SectionLibraryDialog always shows real Close)
src/app/(commerce)/commerce/appearance/section-instances.test.tsx              12 tests passed  (unchanged by this fix)
src/app/(commerce)/commerce/appearance/section-editing.test.tsx                 8 tests passed  (unchanged by this fix)
src/app/(commerce)/commerce/appearance/section-library-mobile.test.tsx          7 tests passed  (+1: new test proving the outer sheet's own Close still closes the whole sheet, distinct from the Library's Back; the existing "closing returns to composer" test was strengthened to assert the single-"×"/Back-not-Close distinction explicitly)
```

**Full module directory** (`web/src/modules/store-experience-builder`):
25 test files, **266 tests passed** (+4), 0 failed.

**Full `(commerce)` route group** (`web/src/app/(commerce)`): 19 test
files (unchanged — no new files, existing ones extended), **189 tests
passed** (+1), 0 failed.

**Full web suite** (`npm test`, i.e. `vitest run` across all of `web/src`):
337 test files, **2538 tests passed** (+5), 0 failed.

**Real browser (Playwright)** — extended:
`e2e/cust-h4-2-section-library-visual.spec.ts`, run against the
`desktop` project (each test sets its own explicit viewport, same
convention `cust-h2-2-page-navigator.spec.ts` already uses), Chromium,
against the existing `/dev/customizer-versions` demo fixture (no Laravel
server, no login): **3 passed, 0 failed** — AR 390, AR 430, AR desktop,
now with explicit Back-vs-Close assertions (exactly one `aria-label="إغلاق"`
on screen while the mobile Library is open, the Library's own control is
`aria-label="رجوع"`, its SVG carries the `rtl:rotate-180` class, and the
desktop dialog exposes `aria-label="إغلاق"` and never `"رجوع"`). See §13
for what was actually inspected.

**TypeScript** (`npx tsc --noEmit`): pre-existing, unrelated errors exist on
`main` in files this slice never touches (`pos/settings/configuration`,
`gemini-card`, `document-language-selector`, `product-*`,
`use-document-label-mode`, `useImportJobEngine`). None of the files this
fix changed appear in the error list.

**Build** (`npm run build`), re-run after this fix:
`✓ Compiled successfully in 44s`, `✓ Generating static pages (179/179)` —
clean, no errors.

**Backend** (`php artisan test`, full suite, no `--filter`, run from the
scaffolded `nibras-app` Laravel project per this repo's test-environment
convention): confirmed consistent across all four rounds (first H4-2
revision, the Offers review fix, the mobile-contract fix, and this
Back/Close polish) — **4973 passed, 59 failed, 51 skipped (31069
assertions)**. This round's own re-run (932s) matches the prior three
exactly; an earlier same-round attempt produced a spurious 184-failure
result because the session's compact-hook scaffold rebuild raced the
background test run and corrupted the `nibras-app` checkout mid-suite —
discarded once the `.env` rebuild timestamp exposed the race, and
re-run clean to get this confirmed number.
**Zero PHP/Laravel files are part of this diff, in any revision** — every
revision of this slice is `web/` TypeScript (+ one Playwright e2e spec)
only. §12 shows the
authoritative result: the PR's own CI runs `php artisan test` fresh on
both SQLite and PostgreSQL and both are green, confirming the local 59
failures are an artifact of this session's own scaffold, not a real issue.
No accounting/journal-entry table applies to this report: this slice never
calls `LedgerService::post` or any financial service — it is a
presentation/registry/UI-only change.

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

**Performed with real screenshots in this session**, correcting the first
revision's honest gap. A pre-installed headless Chromium
(`/opt/pw-browsers/chromium-1194`) plus the repository's own existing
Playwright e2e harness and `/dev/customizer-versions` demo fixture (the
same fixture `cust-h2-2-page-navigator.spec.ts` already uses — mounts the
real `ExperienceBuilder`, no Laravel server, no login) made this possible
without standing up the full backend.

Spec: `e2e/cust-h4-2-section-library-visual.spec.ts`, run via
`npx playwright test e2e/cust-h4-2-section-library-visual.spec.ts
--project=desktop` (each test sets its own explicit viewport, same
convention `cust-h2-2-page-navigator.spec.ts` already established), with
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` pointed at the pre-installed browser
(the repo's own `playwright.config.ts` looks for `/usr/bin/chromium` etc.,
none of which exist in this execution environment). **3/3 passed**,
re-run after this Back/Close polish with new assertions and new
screenshots added.

**Widths actually inspected, as the task required — screenshots opened and
read, not just asserted on:**

- **AR 390** (`ar-390-sections-sheet.png`, `ar-390-library-open.png`,
  `ar-390-library-search.png`, `ar-390-after-add.png`,
  `ar-390-library-back-control.png`) — the Library opens inside the same
  "sections" sheet (one dialog, titled "الأقسام" with its own real "×"
  Close, and the Library's own "مكتبة الأقسام" header directly beneath it
  — **now showing a right-pointing back arrow, not a second "×"**, no
  stacked second overlay); category chips wrap cleanly in two rows with no
  clipping; cards render with their thumbnail glyph, title, description,
  and (for `featured`) the "قيد الإكمال" badge; search for "شريط ترويجي"
  correctly narrows to the one matching card under "الصور والفيديو" with
  its "إضافة" action visible; after clicking it, the sheet returns to the
  composer, now on the newly-added instance's own settings panel (title
  "شريط ترويجي" with a visibility toggle) — the exact same selection
  behavior the pre-existing desktop Add flow already had.
- **AR 430** (`ar-430-sections-sheet.png`, `ar-430-library-open.png`,
  `ar-430-library-search.png`, `ar-430-after-add.png`,
  `ar-430-library-back-control.png`) — same checks, confirming the layout
  isn't 390-specific; chips and cards use the extra 40px cleanly, still no
  horizontal overflow; the back arrow renders identically.
- **AR desktop** (1440×960; `ar-desktop-homepage-panel.png`,
  `ar-desktop-library-dialog.png`) — the centered dialog renders correctly
  over the dimmed Canvas (which stays visible and in place behind it, per
  the "Canvas remains dominant" requirement), two-column card grid with
  category headings, `offers` visibly disabled with its own "غير مفعّل"
  badge and the "العروض قادمة…" reason text, `banner` visibly enabled —
  and the dialog's own header control is still a plain "×" (Close), not an
  arrow, confirmed both visually and via the spec's explicit assertion.

**What the spec additionally asserts, beyond what a screenshot alone
shows:** at every step, `page.getByRole('dialog')` stays at count 1 (the
structural "no nested modal" guarantee); `document.documentElement
.scrollWidth <= clientWidth + 1` (no horizontal overflow) at both mobile
widths; the Library content's own root carries no `role` attribute;
**exactly one `aria-label="إغلاق"` element exists on the whole mobile page
while the Library is open** (the outer sheet's), the Library's own control
is `aria-label="رجوع"`, and its `<svg>` carries the `rtl:rotate-180` class
(the structural half of confirming the arrow actually flips under RTL —
the screenshots are the visual half); the desktop dialog's control is
`aria-label="إغلاق"` and there is no `"رجوع"` anywhere in it.

**One real finding from this pass**, unrelated to the Section Library
itself and out of this fix's scope: at this fixture's true-mobile
viewport, `HomepagePanel` is mounted twice in the DOM simultaneously (see
§8's "Observation" paragraph) — discovered because an early, unscoped
version of the spec's locators hit Playwright's strict-mode "resolved to 2
elements" error. The spec's final locators are explicitly scoped to the
visible sheet to avoid this; the underlying pre-existing duplication is
recorded, not fixed, per this task's scope guard.

**Not covered in this pass** (unchanged from the first revision's honest
disclosure): 768/1024/1280 tablet-ish widths, and English/LTR. The task's
explicit minimum for this fix was 390 RTL, 430 RTL, and desktop — all
three are covered above. A fuller width/direction matrix is recommended
for H4-8's own cross-section QA pass rather than duplicated here.

## 14. Risks / remaining items

- Visual QA (§13) now covers real screenshots at 390 RTL, 430 RTL, and
  desktop — the task's explicit minimum. 768/1024/1280 and English/LTR
  remain code-level/functionally-tested only (RTL default locale, logical
  CSS); recommend folding a fuller width/direction matrix into H4-8's own
  cross-section QA pass rather than duplicating it here.
- `HomepagePanel` is mounted twice simultaneously at true-mobile viewports
  in the `/dev/customizer-versions` fixture (§8's "Observation") — a
  pre-existing `ExperienceBuilder.tsx` layout quirk (the desktop `<aside>`'s
  hidden/visible class doesn't check `isMobileViewport`), surfaced by this
  fix's own visual QA but not caused by it and out of this fix's bounded
  scope. Worth a follow-up ticket; not blocking, since it never actually
  renders visible content at these viewports in any path this fix or the
  existing test suite exercises.
- The 59 local backend test failures (§11) are confirmed, via the PR's own
  green `php artisan test (L11, sqlite/pgsql)` CI checks (§12), to be an
  artifact of this session's local `nibras-app` scaffold only — not a real
  repository issue and not caused by this diff.
- `SECTION_LABEL` in `ControlPanels.tsx` is now a derived one-liner from
  the registry rather than a hand-authored map — a deliberate de-
  duplication, not a behavior change; every existing `SECTION_LABEL[type]`
  call site is untouched.
- Revision 3's `closeAction` prop is additive and defaults to `"close"`,
  so every pre-existing caller of `SectionLibraryContent`/
  `SectionLibraryDialog` other than `ControlPanels.tsx`'s mobile early
  return keeps its prior Close semantics without being touched. Only one
  call site (`ControlPanels.tsx`'s `pickerOpen && isMobileViewport` branch)
  passes `closeAction="back"`.
- The Back icon (`BackIcon`) is a new, separate `<svg>` from `CloseIcon` —
  not a CSS rotation of the same glyph — so a future change to one shape
  cannot accidentally also change the other's meaning.

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
2. Confirm the corrected mobile behavior (§5, §8, Revision Note 2) — the
   Library now replaces the existing "sections" Bottom Sheet's own content
   on mobile instead of stacking a second centered dialog on top of it —
   matches the merged H4 architecture's mobile UX contract.
3. Confirm the Back-vs-Close affordance fix (§5, §8, §9, Revision Note 3)
   — mobile shows exactly one Close "×" (the outer Bottom Sheet's), and
   the inner Library header control is a direction-correct Back arrow
   (`رجوع`/`Back`) that returns to the composer without closing the
   sheet; desktop is unaffected and keeps its own real Close control.
4. Optionally fold the pre-existing double-mount `HomepagePanel` layout
   quirk (§8, §14) into a follow-up ticket; not blocking.
5. On approval, proceed to H4-3/H4-4/H4-5 (independently parallelizable
   per the Horizon's own sequencing) and H4-6 (Offers backend, startable
   independently of all of them) — H4-6+H4-7 are also what unlocks
   flipping `offers` to `state: "live", merchantAddable: true` per §4's
   documented transition.

This closes out the three review-fix rounds raised on PR #1154 (Offers
addability, mobile Bottom Sheet contract, Back-vs-Close affordance). No
further rework is pending from this session absent new reviewer feedback.
