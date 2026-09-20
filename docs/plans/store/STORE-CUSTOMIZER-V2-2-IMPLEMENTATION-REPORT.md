# STORE-CUSTOMIZER-V2-2 — Implementation Report

**Task:** PR-STORE-CUSTOMIZER-V2-2 — Section Editing + Section Picker (Phase 1) + Picker/Add/Duplicate/Delete continuation (Phase 2)
**Branch:** `feat/store-customizer-v2-section-editing`
**PR:** [#881 — feat(store): Customizer V2 section editing and picker](https://github.com/safwan5001-source/Nebrax/pull/881)
**Phase 1 Base SHA:** `7d424518fd7cf3a8ed0681a7942a42269b339801` (main after PR #879 merge — V2-1)
**Phase 2 (continuation) Base SHA:** `f22fe510aad6c9212295de33a7d696afe6a187b1` (main after PR #884 merge — CONTRACT-2)
**Head SHA (code, Phase 2):** `c2772434cb56d021df5b39f21940b01f17d742f3` (final head incl. this report recorded in §14)

> Sections 1–16 below describe Phase 1 (in-contract editing). Phase 2 — the continuation that consumed CONTRACT-2 (#884, merged) and added the Section Picker + Add / Duplicate / Delete + instance-id selection — is documented in §17 onward.

---

## 17. Phase 2 — Contract consumed (from merged PR #884)

Consumed as-is, no re-design, no re-implementation of migration/normalization:

- `PresentationHomeSection = { id: string; type: HomeBuilderSectionKey; visible: boolean }`, schema version `2`.
- `MAX_HOME_SECTIONS = 30`, `safeId = /^[a-zA-Z0-9_-]{1,64}$/`, `HOME_BUILDER_SECTION_KEYS` (10 keys) — all imported from `presentation/config.ts` / `presentation/tokens.ts`.
- v2 semantics: absence = real delete (no resurrection), unknown types fail-closed, legacy migration `id = key` (which is why default sections have `id === type`).

## 18. Phase 2 — Capability model (new, UI-side only)

New module `web/src/modules/store-experience-builder/presentation/section-capabilities.ts`:

```ts
export interface SectionCapability {
  type: HomeBuilderSectionKey;
  maxInstances: number | null; // null = no per-type cap (MAX_HOME_SECTIONS still applies)
  canDuplicate: boolean;
}
```

| Type | maxInstances | canDuplicate | Rationale |
|---|---|---|---|
| hero | 1 | no | heroHeadline/heroSubheadline remain global `homepage` fields (ownership unchanged per spec) |
| categories / newArrivals / wholesale / appPromo | 1 | no | catalog/channel-driven singletons |
| banner / featured / offers / benefits / customContent | null | yes | multi-instance allowed, independent ids; gated ones stay gated (badge + note unchanged — no gated section became a finished feature) |

Helpers: `canAddSectionType(sections, type)` (cap → false; singleton present → false), `hasAddableSectionType(sections)`, `canDuplicateSection(sections, section)`. The normalizers do **not** depend on this model; it constrains UI-produced configs only.

## 19. Phase 2 — ID generation strategy

`newHomeSectionId()` → `section-${crypto.randomUUID()}` (browser-safe; length 44 ≤ 64; matches `safeId`). Fallback (test environments without `crypto.randomUUID`) follows the existing project pattern (`createPosCheckoutAttemptId` in `web/src/lib/pos-checkout-attempt.ts`) — no new helper invented. Called **only** at user creation time (Add/Duplicate click), never during normalization or reads. No timestamp-only ids.

## 20. Phase 2 — Selection by instance id

- `ExperienceBuilder`: `selectedSection` / `pendingSectionScroll` are now `string | null` **instance ids** (were `HomeBuilderSectionKey | null`). `handleSelectSection(id, origin)` accepts `null` (clears selection — used by Delete fallback).
- `ControlPanels` `PanelsProps`: `selectedSection?: string | null`, `onSelectSection?: (id: string | null) => void`; the selected-section settings block looks up `sections.find((s) => s.id === selectedSection)`.
- `StorefrontPreviewCanvas`: each rendered section carries both `data-preview-section={type}` (kept for compatibility) **and** `data-preview-section-id={section.id}`; click/keyboard selection passes the id; `selected = selectedSection === section.id`.
- Scroll bridge targets `[data-preview-section-id="<id>"]`, so duplicate instances scroll to the exact instance.
- **Backward compatibility:** default sections have `id === type` (CONTRACT-2 migration), so all V2-1 selection tests and V2-2 Phase-1 editing assertions (e.g. `dataset.selectedSection === 'categories'`, `[data-preview-section="hero"]`) pass unmodified.

## 21. Phase 2 — Picker / Add / Duplicate / Delete behavior

**Picker:** a `+ إضافة قسم` button (`data-add-section`) above the composer list toggles a lightweight inline panel (`data-section-picker`) listing all 10 registered types in registry order, with translated names and the existing gated badge for gated types. Singletons already present are **disabled**; multi-instance types stay enabled; at `MAX_HOME_SECTIONS` the button is disabled with `title = sectionLimitReached`. No unknown types can appear (list = `HOME_BUILDER_SECTION_KEYS`). No modal/focus-trap architecture added; Escape/focus behavior is that of a simple inline list, consistent with current composer density.

**Add:** appends `{ id: newHomeSectionId(), type, visible: true }` at the end of the array (logical place: new sections land at the bottom, reorder is one click away), selects the new instance immediately (settings block opens for it), preserves existing order, no auto Save/Publish (draft only).

**Duplicate:** only when `canDuplicateSection` (capability + under cap). Copies `type` + `visible` only — there is no per-section content payload in the contract to copy — assigns a new id, inserts immediately after the source, selects the copy. Hero/singletons never show the ⧉ button.

**Delete:** removes the instance from `homepage.sections` — that **is** the delete in v2 (no `visible=false` substitute, no resurrection on save/normalize). If the deleted instance was selected, selection falls back deterministically: next sibling → previous sibling → `null` (settings block returns to the default hero-content state). No confirmation modal (no existing project pattern for row-level deletes in this composer; consistent with nav-links/social delete). No stale selected id can survive.

**Hide vs Delete:** Hide = per-row toggle or settings-block toggle → `visible=false`, instance stays. Delete = removal from array. The two paths share no code.

**Reorder:** unchanged arrow mechanism moves the instance object itself (identity preserved); duplicates of the same type don't interfere (rows keyed by `section.id`); selection stays on the same id after a move.

**Editing (kept from Phase 1):** selected-section settings block, visibility toggle, hero fields (still global), gated note, catalog-managed note — all now resolved by `section.id`.

## 22. Phase 2 — Preview bridge limitations

None blocking. The preview already renders per-instance (`.map` over `sections`), so duplicate instances of the same type render independently and are independently selectable via `data-preview-section-id`. Duplicates of multi-instance types render the same placeholder content (the contract has no per-instance content yet) — they are visually identical by design, distinguished in the composer by order/selection. The **public storefront renderer** was not touched; the preview canvas only gained a data attribute and an id prop.

## 23. Phase 2 — Storefront dev-mirror parity decision

`storefront/src/components/customizer/*` is a dev-only, inert harness: it renders the preview canvas with **no selection bridge, no composer, no picker** (selection props are optional and unused there). Phase 1 didn't touch it; CONTRACT-2 already keeps it compiling against the v2 shape. **Decision: no parity changes** — adding instance UI there would duplicate the builder without a consumer. The production storefront renderer path is web-only for this module. Documented here per spec; if the mirror later grows a composer, it must consume `section-capabilities.ts` instead of re-implementing rules.

## 24. Phase 2 — Changed / new files

| File | Change |
|---|---|
| `web/src/modules/store-experience-builder/presentation/section-capabilities.ts` | **New** — capability registry + guards + `newHomeSectionId` |
| `web/src/modules/store-experience-builder/presentation/index.ts` | Export the new module |
| `web/src/modules/store-experience-builder/ControlPanels.tsx` | HomepagePanel: picker UI, add/duplicate/delete, id-based selection + settings lookup, per-row duplicate/delete buttons, `data-section-id` on rows |
| `web/src/modules/store-experience-builder/ExperienceBuilder.tsx` | Selection state → instance id (`string | null`); scroll targets `data-preview-section-id`; nullable `onSelectSection` |
| `web/src/modules/store-experience-builder/StorefrontPreviewCanvas.tsx` | `data-preview-section-id` per instance; selection by id; `data-preview-section={type}` kept |
| `web/src/modules/store-experience-builder/messages.ts` | 4 new keys × 2 locales: `addSection`, `duplicateSection`, `deleteSection`, `sectionLimitReached` |
| `web/src/modules/store-experience-builder/__tests__/section-capabilities.test.ts` | **New** — 11 unit tests |
| `web/src/app/(commerce)/commerce/appearance/section-instances.test.tsx` | **New** — 10 UI tests |
| `web/src/app/(commerce)/commerce/appearance/section-editing.test.tsx` | Updated: v1-era "no add/duplicate/delete controls" negative test replaced by capability-aware test (duplicate only for multi-instance; singletons disabled in picker) |

## 25. Phase 2 — Tests, exact results (local, before push)

- `section-capabilities.test.ts`: **11/11 passed**.
- `section-instances.test.tsx`: **10/10 passed** — picker lists all 10 types with translated names + gated badges; existing hero/singletons disabled, multi-instance enabled; add creates safe unique `section-<uuid>` id and selects it; multi-instance add twice → distinct ids; duplicate copies type/visible, new id, sits at source+1, selected; duplicate instances independently selectable (aria-pressed + 2 preview elements with distinct ids); delete removes from array (not hide) → next-sibling fallback; last-instance delete → previous-sibling fallback; delete-all → selection cleared, no settings block; hide keeps instance and only flips `visible`; reorder preserves all ids and keeps selection; settings block targets the selected id among duplicates (visibility flip affects only that instance; preview shows only the visible one).
- `section-editing.test.tsx`: **8/8 passed** (incl. updated capability test).
- `section-selection.test.tsx` (V2-1 regression): **7/7 passed**, unmodified.
- Module suite (`store-experience-builder`): 3 files / **23 tests passed** (incl. CONTRACT-2 presentation tests — stayed green).
- Appearance suite: 4 files / **30 tests passed**.
- **Full web suite: 288 files / 1981 tests — all passed** (no existing test reduced or weakened; one outdated negative test replaced by a stricter capability-aware one).
- `npx tsc --noEmit`: store-experience-builder module + appearance tests **clean**; remaining errors are the pre-existing main baseline in unrelated files.
- `npm run build` (Next.js): **success**, exit 0.

## 26. Phase 2 — Persistence / scope confirmation

Draft→Save→Preview→Publish flow reused unchanged (every mutation goes through the same `patch` → draft → `saveStorefrontPresentation` / `publishStorefrontPresentation` path). No new API, no DB migration, no schema version 3, no parallel persistence, no Hero content ownership change, no tenant/auth change, no public API change, no Customizer redesign, no Theme Tokens work. CONTRACT-2 normalization untouched.

## 27. Phase 2 — Git / CI

- **Current Base SHA:** `f22fe510aad6c9212295de33a7d696afe6a187b1` (main after #884).
- **Commits (Phase 2):** capability model (`0c59e79d`) → message keys (`ab1427f2`) → composer picker/add/duplicate/delete + id selection (`b3343b71`) → selection bridge id upgrade (`809a8f52`) → tests (`c2772434`) → this report.
- **Head SHA (code):** `c2772434cb56d021df5b39f21940b01f17d742f3`.
- **Final Head SHA (incl. report):** recorded in the PR head after the report commit.
- **CI status (real runs on the code head `c2772434`, all success):** `web build (Next.js)` ✅ (03:53:26 → 03:56:19) · `php artisan test (L11, sqlite)` ✅ (03:53:26 → 03:59:40) · `php artisan test (L11, pgsql)` ✅ (03:53:26 → 04:11:31); the previous push (`809a8f52`) also ran green: web build ✅ (03:55:04), sqlite ✅ (04:01:27), pgsql ✅ (04:07:46) — 6/6 green. `storefront (lint + typecheck + test)` did not run: `storefront-ci.yml` is path-scoped to `storefront/**`, untouched by this PR.
- Branch synced with main before Phase 2 (`merge-base = f22fe510`, ahead 7, behind 0) — no merge/rebase needed. No force-push; normal commits only.

## 28. Phase 2 — Risks / deferred

- **Deferred (by contract):** per-instance content for multi-instance types (banner/featured/offers/benefits/customContent currently render identical placeholder content per type — the v2 contract has no per-instance payload field). Gated sections remain preview-only.
- **Risk (low):** Delete has no confirmation; consistent with existing row-level deletes in the same UI (nav links, social links). Deleted instances only persist on explicit Save (draft flow).
- **Risk (low):** id generation depends on `crypto.randomUUID` (all modern browsers; fallback covers legacy/test environments).
- **Not in scope (unchanged):** DnD reorder, Undo/Redo, version history, per-section content contracts, storefront dev-mirror composer.

## 29. Phase 2 — Recommended next step

Review and merge PR #881. Natural follow-up (separate PR): per-instance content payloads for multi-instance types (starting with `banner`), which would make Duplicate materially useful beyond layout placeholders; only then consider surfacing banner/featured/offers/benefits/customContent publishing beyond the gated preview.

**No Merge. No Deploy.**

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
