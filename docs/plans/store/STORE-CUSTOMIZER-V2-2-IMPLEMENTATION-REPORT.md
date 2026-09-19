# STORE-CUSTOMIZER-V2-2 — Implementation Report

**Task:** PR-STORE-CUSTOMIZER-V2-2 — Section Editing + Section Picker
**Branch:** `feat/store-customizer-v2-section-editing`
**PR:** [#881 — feat(store): Customizer V2 section editing and picker](https://github.com/safwan5001-source/Nebrax/pull/881)
**Base SHA:** `7d424518fd7cf3a8ed0681a7942a42269b339801` (main after PR #879 merge — V2-1)
**Head SHA (code):** `80aff80cd1f0c5024d613c6c231a032eebd0fad2` (final head recorded in §14)

---

## 1. Phase 0 — Evidence

### 1.1 The sections model in `StorefrontPresentationConfig` v1

`web/src/modules/store-experience-builder/presentation/config.ts`:

```ts
export type PresentationHomeSection = {
  key: HomeBuilderSectionKey;
  visible: boolean;
};
```

- The homepage section list is a **closed set of 10 known keys** (`HOME_BUILDER_SECTION_KEYS` in `presentation/tokens.ts`): `hero`, `categories`, `newArrivals`, `wholesale` (implemented) + `banner`, `featured`, `offers`, `benefits`, `appPromo`, `customContent` (gated, preview-only).
- **One instance per key. There are no instance IDs.** Identity of a section = its key.
- Order = array order. Visibility = the boolean flag.
- Section content exists only for the hero (`heroHeadline` ≤120 chars, `heroSubheadline` ≤200 chars). All other sections render from the AWJ catalog / fixtures — there are no per-section content fields.

### 1.2 Normalization is fail-closed and collapses instances

`resolveHomeBuilderSections()`:

```ts
const known = configured.filter((s) => HOME_BUILDER_SECTION_KEYS.includes(s.key));
const seen = new Set(known.map((s) => s.key));
return [
  ...known.map((s) => ({ key: s.key, visible: Boolean(s.visible) })),
  ...DEFAULT_PRESENTATION_CONFIG.homepage.sections.filter((s) => !seen.has(s.key)),
];
```

Consequences (verified against the code, not assumed):

1. **Duplicate keys collapse.** Two entries with the same key become one after normalization — the `seen` Set keeps the first occurrence only.
2. **Removed keys reappear.** Any key absent from the stored list is re-appended from defaults as `visible: true`. Absence is not representable.
3. **Unknown keys are dropped.** The picker cannot invent new section types — normalization deletes anything outside the closed set.

The storefront-side model (`presentation/home-sections.ts`) states the design intent explicitly: sections are deliberately "a closed set of known keys, because an open-ended one would let configuration invent commerce surfaces the storefront has no data for."

### 1.3 Persistence (STORE-BACKEND-1)

`ExperienceBuilder` loads/saves/publishes the whole `StorefrontPresentationConfig` document per tenant storefront (`storefrontId` prop; `loadStorefrontPresentation` / `saveStorefrontPresentation` / `publishStorefrontPresentation` from `@/modules/commerce-workspace/presentation`; `saved` / `draft` / `draftRevision` state; Draft ≠ Published). The document schema is the v1 shape above. No tenant-isolation issue was found in the current persistence path during this task.

## 2. Capability assessment per operation

| Operation | Representable in v1? | Verdict |
|---|---|---|
| **Edit** (selected section → its settings) | ✅ Yes — hero content fields + visibility exist | **Implemented** (improved UX, §3) |
| **Reorder** | ✅ Yes — array order is persisted | **Kept as-is** (existing arrow mechanism, mandatory per spec) |
| **Hide / Show** | ✅ Yes — `visible: boolean` | **Kept + surfaced** in the selected-section block |
| **Add (Section Picker)** | ❌ No — closed key set; every known key already exists in every config; unknown keys are dropped by normalization | **STOP CONDITION — not implemented** |
| **Duplicate** | ❌ No — no instance IDs; duplicate keys collapse in `resolveHomeBuilderSections` | **STOP CONDITION — not implemented** |
| **Delete** | ❌ No — absent keys are re-appended as defaults; "delete" would silently equal `visible: false` | **STOP CONDITION — not implemented** |

Per the task's Scope Decision, the correct outcome of V2-2 is therefore: (1) implement/improve Edit + Reorder + Hide/Show within the current contract — done; (2) document the Add/Duplicate/Delete gap — this section + §10; (3) propose the smallest contract evolution as a separate PR — §10.

No Section Picker was built: the current contract cannot represent adding anything (all known keys are always present), so a picker would be an empty or dishonest UI. No fake Duplicate/Delete was shipped: a "Delete" that is actually `visible=false` would mislead the merchant, and hiding already exists under its honest name.

## 3. What was implemented (in-contract)

**Selected-section settings block in `HomepagePanel`** (`ControlPanels.tsx`):

- When `selectedSection` is set (via the unchanged V2-1 bridge — sidebar composer click or preview click), the panel header area shows a block titled with the section's localized label and hint `selectedSectionHint`, containing **only what is honest for that section**:
  - a visibility **Toggle** (identical draft mutation as the composer row — same `patch`, same STORE-BACKEND-1 flow);
  - **hero** → the `heroHeadline` / `heroSubheadline` fields (the only section content fields that exist in v1);
  - **gated** sections → the existing `gatedSection` note;
  - **other implemented** sections (categories / newArrivals / wholesale) → a new honest note `sectionManagedNote`: content comes from the AWJ catalog and cannot be edited here; show/hide/reorder remain available.
- When nothing is selected, the previous default `heroContent` section renders exactly as before (no regression for users who never select).
- The composer list (reorder ↑/↓ arrows with `aria-label`s, per-row visibility toggles, selection marker) is **unchanged** — no reorder rewrite, no DnD dependency.
- Global theme/identity controls were **not** moved into section settings.

Progressive disclosure is realized as: select a section → see its settings; everything else stays in its panel. There is no deeper content/design/advanced split to expose in v1 because no further per-section fields exist; inventing them would be dishonest UI.

## 4. Message keys added (bilingual)

`web/src/modules/store-experience-builder/messages.ts`:

- `selectedSectionHint` — ar: «تظهر هنا إعدادات القسم المحدد فقط.» / en: "Only the selected section's settings appear here."
- `sectionManagedNote` — ar: «محتوى هذا القسم يأتي من كتالوج أَوْج ولا يُحرَّر من هنا. يمكنك إظهاره أو إخفاؤه وإعادة ترتيبه.» / en: "This section's content comes from the AWJ catalog and cannot be edited here. You can show, hide and reorder it."

## 5. Contracts touched

None. `StorefrontPresentationConfig` v1, normalization, STORE-BACKEND-1 persistence, and all public/API contracts are byte-identical to main. No DB migration, no API evolution, no tenant-resolution/auth/authorization change.

## 6. Persistence behavior

Unchanged by design: every mutation (visibility from composer or selected block, hero fields, reorder) goes through the existing `patch` → draft state → Save draft / Publish flow of STORE-BACKEND-1. No localStorage/sessionStorage/cookies. Draft ≠ Published unchanged.

## 7. Changed files

| File | Change |
|---|---|
| `web/src/modules/store-experience-builder/ControlPanels.tsx` | Selected-section settings block in `HomepagePanel`; `setVisible` helper; `heroFields` extraction; composer untouched (+57/−30 approx.) |
| `web/src/modules/store-experience-builder/messages.ts` | 2 new keys × 2 locales |
| `web/src/app/(commerce)/commerce/appearance/section-editing.test.tsx` | **New** — 8 tests |

## 8. Tests — exact results

- **Targeted:** `section-editing.test.tsx` 8/8 passed; `section-selection.test.tsx` (V2-1 regression) 7/7 passed, unmodified.
- **Full web suite:** `npx vitest run` → **284 files / 1939 tests, all passed** (1931 on main baseline + 8 new).
- New coverage: default (nothing selected) state; hero selected → content fields shown, standalone hero section replaced; editing headline updates state; catalog-managed note for implemented sections (no phantom fields); gated note for gated sections; visibility toggle from the selected block keeps preview in sync and selection survives the mutation; reorder works while a section is selected; negative test asserting no add/duplicate/delete controls exist anywhere in the builder.

## 9. Build / typecheck

- `npx tsc --noEmit`: **12 errors — identical to the main baseline** (pre-existing, unrelated files).
- `npx next build`: **success** (route table complete, exit 0).

## 10. Contract gap — smallest contract evolution (proposal for a separate PR)

To support Add/Duplicate/Delete honestly, `PresentationHomeSection` needs instance identity. Smallest evolution (v2 shape, additive migration):

```ts
export type PresentationHomeSectionV2 = {
  id: string;                    // stable instance id (e.g. "sec_…")
  type: HomeBuilderSectionKey;   // the closed type set stays closed
  visible: boolean;
};
```

- `homepage.sections` becomes a list of **instances**; `resolveHomeBuilderSections` dedupes by `id`, filters `type` against the known set, and stops re-appending "missing" defaults (absence becomes meaningful → Delete becomes representable).
- Add = append instance of a known type; Duplicate = append instance with same type, new id; both become representable. A Section Picker then honestly lists *types*, including which types allow multiple instances (catalog-driven types like `hero` may reasonably stay single-instance — a per-type `maxInstances` rule can live in the registry, not the stored config).
- Migration: v1 → v2 is mechanical (`id = key` for the single existing instance); normalization can accept both shapes during a transition window (fail-closed stays).
- Persistence/API: the presentation document field `homepage.sections` changes shape → needs the owning contract PR (STORE-BACKEND evolution) **before** any V2-2 picker/duplicate/delete UI. This PR deliberately does not touch it.

## 11. Visual verification

Temporary harness page (`ExperienceBuilder` rendered directly; Arabic, `dir="rtl"`) + headless Chromium screenshots at 1440×900 / 834×1112 / 390×844, default state and with `categories` selected. Verified: selected block shows label + hint + visibility toggle + catalog note; composer below; preview scrolls to and highlights the selected section; mobile stacks correctly with the panel selector; RTL layout intact. **The harness was deleted before committing** (not part of the PR).

## 12. Accessibility

- Selection remains keyboard-operable end-to-end (composer rows and preview sections are real buttons with `aria-pressed`; V2-1 tests pass).
- The selected block uses native inputs/labels (`Field`/`Toggle` = label-wrapped controls); visibility state is text (`ظاهر`/`مخفي`), not color-only.
- No dialog/picker was added, so no new focus-trap/restoration surface exists; had the contract allowed a picker, focus management would have been mandatory — deferred with it.
- Reduced-motion behavior of the V2-1 scroll bridge unchanged (covered by existing test).

## 13. Tenant / security, backward compatibility

- No changes to tenant resolution, auth, authorization, ownership, or public contracts; draft mutations stay within the existing tenant-scoped STORE-BACKEND-1 flow.
- Backward compatible: config v1 shape untouched; published storefronts, existing drafts, normalization/fail-closed, visibility/reorder, preview modes, and the V2-1 selection bridge all behave as before (regression suite green). No silent contract change.

## 14. Git / CI

- **Base SHA:** `7d424518fd7cf3a8ed0681a7942a42269b339801`
- **Commits:** `4fd848a2` (tests) → `4c58b920` (messages) → `80aff80c` (ControlPanels) → `7133c918` (this report)
- **Final Head SHA:** `7133c9181634d99ef0cba4c2f360c85f73de5346`
- **CI status (real runs on the head, all success):** `web build (Next.js)` ✅ · `php artisan test (L11, sqlite)` ✅ ×2 runs · `php artisan test (L11, pgsql)` ✅ ×2 runs — 5/5 green. `storefront (lint + typecheck + test)` did not run because `storefront-ci.yml` is path-scoped to `storefront/**`, which this PR does not touch.
- **Mergeability:** `mergeable_state: clean` (branch from latest main, no conflicts).

## 15. Risks / deferred

- **Deferred (blocked on contract):** Section Picker, Duplicate, Delete — require the §10 contract evolution PR first.
- **Deferred (by spec):** per-section content editing beyond hero (needs per-section content contracts), Version History, Undo/Redo persistence.
- **Risk (low):** merchants may expect an Add button in the composer; the report + PR description set expectations explicitly. No UI hints at unsupported capabilities.

## 16. Recommended next step

Open a small, dedicated contract PR implementing the §10 v2 instance model (`id` + `type`, migration, normalization update, STORE-BACKEND evolution). Once merged, V2-2 can be resumed to add the Section Picker (honest type list, multi-instance rules), Duplicate, and Delete on top of it.

**No Merge. No Deploy.**
