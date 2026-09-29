# MOBILE-PREVIEW-3 — Browser App Preview Shell — Implementation Report

**Horizon:** AWJ App Builder — Real Mobile Preview
**Status:** IMPLEMENTED — PR open, **not merged, no deploy**
**Repository:** `safwan5001-source/Nebrax`
**Branch:** `mobile-preview-3-claude-code`
**Base SHA:** `7bef75797ab608aeccb66056e049861ac787a102` (latest `origin/main` at task start)
**Scope:** Web-only (`web/`). No backend, no mobile Flutter runtime, no schema/API change.

## 0. Note on the task file named in the request

At task start, `docs/plans/app-builder/MOBILE-PREVIEW-3-CLAUDE-CODE-TASK.md` did not exist
anywhere in this repository (confirmed against `origin/main` and the complete `git log --all`
history at that time). Implementation therefore proceeded on the equivalent scope already
approved in `AWJ_APP_BUILDER_REAL_MOBILE_PREVIEW_HORIZON.md` §11/§12 and
`REAL-MOBILE-PREVIEW-2-RUNTIME-ARCHITECTURE-EVIDENCE.md` §8/§14.

The task file (and a companion `REAL-MOBILE-PREVIEW-SALLA-MOBILE-BENCHMARK.md`, built from
user-supplied Salla screenshots) was subsequently published on branch
`docs/mobile-preview-3-claude-task` / PR #1098. Both were read in full and are reconciled against
the already-completed implementation in §1a/§1b below — every one of the task file's 10 numbered
"Required implementation" items and the benchmark's 6 decisions (B1–B6) is checked individually.
PR #1098 itself is docs-only and untouched by this report; it is not merged or closed by this work.

## 0a. Official-sources evidence pass (Salla / Zid / Shopify / Flutter)

Per the task file's "Required external benchmark pass," the following **official** documentation
(not the screenshot-based benchmark, which is a separate, already-reviewed source) was fetched and
read directly, kept proportional to this task:

| Source | Finding |
|---|---|
| Salla help center — App Design subcategory | Documents app customization (WebView template, bottom tabs, welcome screens, menu template, motion support) as a set of settings screens. |
| Salla help center — "Start customizing the app" article | Table of contents references a **dedicated, separate article**, "معاينة التطبيق من صفحة صانع التطبيقات" (Preview the app from the App Maker page) — i.e. Salla's own official docs confirm Preview is a distinct documented feature from the design/settings screens, not the same screen. |
| Zid help center — Mobile App category + Create App page | Zid's mobile app is a **subscription/managed-design service**, not a self-serve visual builder: "designing the app with your unique branding" is something Zid's team does for the merchant; no live preview, device frame, or customization interface is documented anywhere. This confirms the task's own caution — do not assume Zid matches Salla's model — and that AWJ's actual choice (self-serve Design + Browser Preview) follows the Salla pattern, not the Zid one; nothing to reconcile. |
| Shopify — Theme Editor preview/inspector | Preview window "updates automatically when you make changes" (live-reactive, no manual refresh step documented) and offers a mobile/desktop viewport toggle in the editor chrome. |
| Shopify — Theme Editor features overview | Confirms a "collapse the sidebar…giving you a full-width preview" mode — structurally the same pattern as this PR's Full Preview (hide chrome, maximize the preview area, allow exit). |
| Flutter — Web platform integration | Flutter Web compiles a full separate Dart/Flutter runtime (WASM) and framework layer; explicitly not suited to every scenario. Confirms embedding it is materially heavier than a React-based preview. |
| Flutter — Embedding Flutter web in an existing app | Embedding requires a dedicated host element with mandatory explicit width/height/position/overflow CSS, a single engine instance per page, and no iframe sandboxing unless using the full-page mode. Confirms MP-2's Hybrid-architecture deferral of Flutter Web/Real Runtime Preview to a later task remains the correct call — this is genuinely non-trivial integration work, not something to fold into MP-3. |

**What this changes vs. the already-completed implementation:** nothing architecturally — MP-2's
Hybrid decision and the task's own locked architecture are reconfirmed, not revised. It does
surface one concrete UX gap, addressed in §1b below, and it retires one open question (whether a
"Refresh Preview" action belongs in MP-3): Shopify's own pattern is auto-live-update, not a manual
refresh button, and this PR's `previewRoot` already reads live React state directly (no snapshot,
no staleness) — so there is nothing for a refresh action to actually refresh. No Decision Gate is
touched by this evidence; documented here rather than added as a no-op button.

## 0b. Task-file requirements checklist (`MOBILE-PREVIEW-3-CLAUDE-CODE-TASK.md`, all 10 items)

| # | Requirement | Status |
|---|---|---|
| 1 | Design / App Preview workspace mode | ✅ header switch, independent state |
| 2 | `PreviewState` (draft/published/default) kept separate | ✅ unchanged, orthogonal axis |
| 3 | App Preview: non-editing, no selection, no type tags, no hover rings, no Inspector/Layers interaction, no hidden Draft mutation | ✅ `interactive={false}`; structure/inspector panes not rendered; `previewRoot` never mutates |
| 4 | Device preview: professional iPhone/Android presets, app-level shell not a decorative card, content-first (not decorative fake OS chrome), desktop = central viewport + Full Preview, **small/mobile-admin screens must not show a tiny phone inside the phone — use available width** | ⚠️ **gap found and fixed in this pass** — see §1b |
| 5 | Keep Draft/Published/Default switching, RTL/LTR, sample-data behavior, schema/binding semantics, Design state on return | ✅ all reused as-is, proven by tests |
| 6 | Visible truth label ("معاينة المتصفح" / "Browser Preview") | ✅ exact wording match |
| 7 | Full Preview: hide editor chrome, maximize, allow exit, preserve Draft edits/selected page/component/source/locale/device choice | ✅ — nothing is reset on enter/exit since it's the same component state, not a remount |
| 8 | Reuse `AppBuilderCanvas` with an explicit mode; do not fork renderer/schema semantics | ✅ one new `interactive` prop, same renderer |
| 9 | Shell structurally ready for app-level navigation/empty/auth states later; reuse only already-supported safe placeholders in MP-3, don't invent | ✅ no regression — actions were already inert-unless-dispatched in the Canvas (Design mode too); nothing invented |
| 10 | Optional Refresh Preview, only if safe (no publish/persist/session/auth) | Not added — see §0a: nothing to refresh given the live-state architecture; documented rather than built as a no-op |

## 1b. Benchmark decisions checklist (B1–B6) and the gap found

| Decision | Status |
|---|---|
| B1 — separate editing from full preview | ✅ |
| B2 — desktop central viewport vs. mobile-admin content-first, no tiny nested phone | ⚠️ → ✅ **fixed in this pass** |
| B3 — app-level shell, not card-level; defer deeper nav parity to MP-4 | ✅ |
| B4 — no blank preview on loading/error/no-published states | ✅ (existing loading/error branches reused) |
| B5 — Refresh Preview only if safe, no new snapshot/session architecture | ✅ (not added; see §0a) |
| B6 — device frame is orientation only, never presented as runtime proof | ✅ (truth badge present, wording explicit) |

**Gap found (B2 / task item 4):** `DeviceFrame` rendered its iPhone/Android bezel at a fixed pixel
size (`390×844` / `412×915`) **at every viewport**, including actual small/mobile-admin screens —
exactly the "tiny phone inside the phone" anti-pattern both the task file and the Salla benchmark
explicitly call out. This is a real, in-scope MP-3 gap, not a Decision Gate matter (pure responsive
CSS, no schema/auth/runtime implication) — fixed in this same PR, not deferred:

- `DeviceFrame` is now responsive by CSS breakpoint alone (no JS media-query check, no resize
  listener, no hydration risk): below `lg` — this Builder route's own existing mobile-admin
  breakpoint, the same one its structure/inspector panes already switch on — the bezel, padding,
  background, and notch/camera-dot silhouette are all absent (not merely visually hidden — the
  relevant classes are simply never applied below `lg`), and the canvas fills the available width
  and height. At `lg` and above, the professional bezel renders exactly as before.
- The two wrapper containers around the preview content (`builder/page.tsx`) drop their `p-6`
  padding and center-alignment below `lg` too (`items-stretch`, `p-0`), so no extra chrome/gutter
  surrounds the now full-width frame on small screens.
- 2 new focused tests added to `device-frame.test.tsx` proving: (a) the screen area carries no
  fixed inline size and only gains the `lg:w-[…]`/`lg:h-[…]` classes: proven by asserting the
  literal Tailwind class tokens are present, not merely relying on an unenforced convention;
  (b) the bezel background/notch classes are entirely un-prefixed-absent below `lg` (present only
  with the `lg:` prefix), using exact-token assertions (a substring check would false-pass, since
  `lg:bg-neutral-900` itself contains the substring `bg-neutral-900`).

## 1. Scope executed

**Required (all delivered):**
- top-level **Design / App Preview** switch in the Builder header (`تصميم` / `معاينة التطبيق`);
- App Preview removes all selection/editing chrome (no `role="button"`, no hover rings, no type
  tags);
- a centered **device-frame shell** (iPhone/Android bezel presets, `390×844` / `412×915`);
- a **Draft / Published / Default** source selector — the existing `PreviewState` switcher, now
  also honored inside App Preview (previously it only drove Design mode's own read-only branch);
- **locale / RTL / LTR** — the existing toggle, verified to still apply direction correctly inside
  the device frame;
- **Full Preview** mode — a distraction-free full-screen overlay of the same device frame;
- an explicit **browser-preview truth badge** (`معاينة المتصفح — ليست عرض زمن تشغيل حقيقي` /
  `Browser Preview — not a real runtime render`);
- the existing sample-data badge is preserved (untouched — same `AppBuilderCanvas` computation);
- clean loading / no-published-version / unavailable states — reused, not reimplemented;
- no hidden editor actions while Preview is active — Undo/Redo/Save/Publish are removed from the
  DOM entirely in Preview mode, not merely disabled.

**Reused, not duplicated:**
- `PreviewState` source logic and its existing `GET .../versions` / `GET .../versions/{n}` fetch —
  **zero new API calls** anywhere in this change;
- the existing App Schema and `resolveNodeBindings` binding-resolution mirror;
- the existing sample-resource data;
- the existing `AppBuilderCanvas` renderer itself — extended with one new prop
  (`interactive?: boolean`, default `true`), not forked or duplicated;
- existing theme-token preview behavior (`schemaThemeTokens`/`themeCssVars`), unchanged.

**Explicitly out of scope (confirmed not touched):** preview-session tokens, live merchant
commerce data, store-bearer forwarding, admin Sanctum forwarding, Flutter Web embedding, QR/deep
links, physical-device preview, signing/distribution, theme/runtime redesign, visibility
capability expansion. No file under `mobile/` was touched. No backend (`app/`, `routes/`) file was
touched.

## 2. Files changed

| File | Change |
|---|---|
| `web/src/modules/app-builder/device-frame.tsx` | **New**, then revised in this pass. `DeviceFrame` component + `DEVICE_FRAME_PRESETS` (iphone/android). Pure presentational wrapper; never inspects the App Schema. Responsive by CSS breakpoint (`lg:`-gated bezel; full-width/content-first below it) — see §1b. |
| `web/src/modules/app-builder/canvas.tsx` | Added `interactive?: boolean` (default `true`) to `AppBuilderCanvas`, threaded through `CanvasComponentNode`/`NodeFrame`. `false` removes the type-tag and all selection/hover/click chrome; the honesty-only `UnsupportedVisibilityBadge` is deliberately **not** gated by it. No other behavior changed. |
| `web/src/app/(commerce)/app-builder/[id]/builder/page.tsx` | New `BuilderMode` (`'design' \| 'preview'`) state, independent of `PreviewState`. New header switch. Preview-mode content area (device-frame toolbar + `DeviceFrame`-wrapped, `interactive={false}` canvas). Full Preview overlay. Undo/Redo/Save/Publish and the Design-only mobile/tablet/desktop width toggle now render only in Design mode. Preview-content wrappers drop padding/centering below `lg` (§1b). Route moved from `(app)` to `(commerce)` by an unrelated upstream PR merged in — see §2a. |
| `web/src/messages/ar.json` / `en.json` | New `appBuilder.builder.builderMode.{design,preview}` and `appBuilder.builder.preview.{browserTruthBadge,fullPreviewAction,exitFullPreviewAction}` keys, both languages. |
| `web/src/modules/app-builder/canvas.test.tsx` | +5 tests: default `interactive` unchanged; `interactive={false}` removes chrome and click-to-select everywhere (including the canvas background); still resolves bindings/repeats templates/shows the sample-data banner; still shows the visibility-honesty badge. |
| `web/src/modules/app-builder/device-frame.test.tsx` | **New**, then extended. 5 tests: renders children, tags itself by preset, screen area carries no fixed inline size and gains `lg:`-only sizing classes, bezel chrome is exact-token-absent below `lg`. |
| `web/src/app/(commerce)/app-builder/[id]/builder/page.test.tsx` | +7 tests: editing controls/panels fully absent in Preview; clicking canvas content in Preview selects nothing; iPhone/Android preset switch; Full Preview open/exit; Draft/Published/Default switching works read-only inside Preview; returning to Design preserves selection and the dirty flag; locale toggle still sets `dir` inside Preview. |

## 2a. Merge-conflict resolution (unrelated upstream route move)

Between this PR's first push and CI completing, `origin/main` advanced with several unrelated
merged PRs, including one (#1059, "open App Builder in dedicated workspace") that **moved** the
entire App Builder route tree from `web/src/app/(app)/app-builder/**` to
`web/src/app/(commerce)/app-builder/**` and switched the page's `dir` attribute from a hardcoded
`"rtl"` to `locale === 'ar' ? 'rtl' : 'ltr'`. This PR's base was merged forward
(`git merge origin/main`); git's rename detection correctly carried this PR's edits onto the new
path automatically, leaving exactly one real content conflict (a colliding import-statement edit
in `builder/page.tsx`), resolved by combining both sides' imports. This PR's own Full Preview
overlay (a second, independent `<div dir="rtl">` the automatic merge had no reason to touch) was
then manually updated to match the same `locale === 'ar' ? 'rtl' : 'ltr'` convention for
consistency. Full build + full test suite re-run clean after the merge (see §3).

## 3. Tests

- **Focused, new:** 5 (canvas) + 5 (device-frame) + 7 (page) = **17 new tests, all passing**
  (device-frame grew from 3 to 5 when the §1b responsiveness fix was proven).
- **Broader, same files:** `canvas.test.tsx` 14/14, `device-frame.test.tsx` 5/5,
  `page.test.tsx` 37/37 (30 pre-existing + 7 new) — **all pre-existing assertions unchanged and
  green**, confirming `interactive` defaulting to `true` and the new `BuilderMode` defaulting to
  `'design'` preserve every existing behavior exactly.
- **Translation-key guard** (`src/lib/__tests__/i18n-keys.test.ts`, 5/5): confirms every new
  `t('...')` call resolves in both `ar.json`/`en.json`, no duplicate keys, and the two language
  trees stay structurally identical.
- **Full web suite:** `npm run test` (Vitest), re-run after the §2a merge and the §1b fix —
  **318 test files, 2265 tests, all green.** Zero regressions anywhere in the repository.
- **TypeScript / build:** `npm run build` (Next.js production build, which type-checks the whole
  project) completed with **no errors**, including the `/app-builder/[id]/builder` route itself,
  both before and after the §2a merge. A baseline `npx tsc --noEmit` comparison against clean
  `origin/main` at each point confirmed the handful of pre-existing unrelated type errors elsewhere
  in the repo (`pos/settings`, `gemini-card`, `document-language-selector`, `product-*`,
  `use-document-label-mode`, `useImportJobEngine`, and — newly present after the merge, from
  unrelated upstream work — `commerce/appearance/section-*`) are identical before and after this
  PR's own changes at each point — zero new type errors introduced by this work. (One self-caught
  issue during development: an early draft placed the new `previewRoot`/`previewThemeTokensResolved`
  computation before the component's `!schema` null-check, which `tsc` correctly rejected — fixed
  by moving it after the guard, where `schema` is narrowed non-null.)
- **Lint:** `next lint` in this sandbox prompts for first-time interactive ESLint setup (no
  `.eslintrc` present) and cannot run non-interactively here. Confirmed this is **not part of
  CI** — `.github/workflows/web-ci.yml`'s only steps are `npm run test` and `npm run build`; no
  lint step exists for this project. Not a gap introduced by this change.

## 4. Decision Gate check (Horizon §12, all 12 gates)

| # | Gate | Triggered? |
|---|---|---|
| 1 | Changing the public App Schema contract | No — schema untouched |
| 2 | Weakening fail-closed compatibility | No — `CompatibilityResolver`/`resolveNodeBindings` untouched |
| 3 | Changing Tenant Isolation behavior | No — no backend touched at all |
| 4 | Changing RBAC/Commerce authorization semantics | No |
| 5 | Forwarding merchant/admin auth to a mobile runtime | No |
| 6 | Exposing long-lived store credentials | No |
| 7 | New token/session architecture | No |
| 8 | Publishing Draft as a side effect of Preview | No — Preview only reads existing state, never calls the draft/publish endpoints |
| 9 | Building a second independent component/runtime contract | No — same `AppBuilderCanvas`, one new boolean prop |
| 10 | Arbitrary executable merchant code | No |
| 11 | Material mobile runtime redesign | No — no file under `mobile/` touched |
| 12 | Mobile signing/TestFlight/Play/App Store/Production release | No |

**No Decision Gate triggered.**

## 5. Backward compatibility

- Design mode is **pixel- and behavior-identical** to before: every existing `page.test.tsx`
  assertion (30 tests) passes unchanged, and `AppBuilderCanvas`'s `interactive` prop defaults to
  `true` so every existing call site (there was exactly one before this change) behaves exactly as
  before without passing the new prop at all.
- No existing API call, App Schema shape, or published/draft semantics changed.
- No new network request is made anywhere in this feature — App Preview reuses whichever
  draft/published/default data is already in memory.

## 6. Security / Tenant Isolation

Not applicable — this is a pure frontend (React/Next.js) UI feature. No backend route, no
authentication/authorization code, no token handling was added, changed, or touched. `TenantScope`/
`BelongsToTenant`/RBAC/Commerce authorization are unaffected because no server-side code in this
PR exists to affect them.

## 7. What is deliberately still missing (matches the Horizon's own MP-4/MP-5+ boundary)

- **Runtime semantic parity** (action availability, navigation, binding/collect conformance
  beyond what the shared canvas already does) is MOBILE-PREVIEW-4's explicit scope, not this
  task's.
- **Real live commerce data**, **preview-session tokens**, **Flutter Web/Real Runtime Preview**,
  and **QR/physical-device preview** all remain MOBILE-PREVIEW-5 through -8's scope, gated behind
  MP-5's mandatory security Decision Gate, exactly as the Horizon requires.
- In-preview page navigation (tapping a `NavigationTarget` inside the device frame to switch
  pages) is not wired — consistent with the existing Design-mode Canvas, where actions are
  visually dimmed/inert unless attached, and with MP-3's own boundary ("clean non-editing
  presentation" of the shell, not action semantics, which is MP-4's job).

## 8. Next steps

- PR #1097 open against `main`, CI monitored to green after both the §2a merge-conflict resolution
  and the §1b gap fix.
- **Not merged. No deploy.** Awaiting the owner's explicit merge approval per this task's
  instructions.
- PR #1098 (the task-file/benchmark docs) reviewed as source material only — not merged, not
  closed, not modified by this work.
- Recommended next task per the Horizon: **MOBILE-PREVIEW-4 — Runtime semantic parity.**
