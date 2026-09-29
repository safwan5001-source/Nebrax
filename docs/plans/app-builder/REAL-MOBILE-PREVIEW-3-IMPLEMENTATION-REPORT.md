# MOBILE-PREVIEW-3 — Browser App Preview Shell — Implementation Report

**Horizon:** AWJ App Builder — Real Mobile Preview
**Status:** IMPLEMENTED — PR open, **not merged, no deploy**
**Repository:** `safwan5001-source/Nebrax`
**Branch:** `mobile-preview-3-claude-code`
**Base SHA:** `7bef75797ab608aeccb66056e049861ac787a102` (latest `origin/main` at task start)
**Scope:** Web-only (`web/`). No backend, no mobile Flutter runtime, no schema/API change.

## 0. Note on the task file named in the request

The request named `docs/plans/app-builder/MOBILE-PREVIEW-3-CLAUDE-CODE-TASK.md` as the task
source. That file does not exist in this repository — confirmed against the latest `origin/main`
and the complete `git log --all` history (no commit ever added it, on any branch). Per the
owner's explicit instruction after this was flagged, this task proceeded on the scope already
**approved and merged** in this repository's own documentation instead of stopping or inventing
a substitute file:

- `docs/plans/app-builder/AWJ_APP_BUILDER_REAL_MOBILE_PREVIEW_HORIZON.md` §11 (task queue entry
  for MOBILE-PREVIEW-3) and §12 (Decision Gates) and §16 (non-goals);
- `docs/plans/app-builder/REAL-MOBILE-PREVIEW-2-RUNTIME-ARCHITECTURE-EVIDENCE.md` §8
  ("MOBILE-PREVIEW-3 implementation boundary" — the concrete required/reuse/do-not-implement-yet
  lists) and §14 (recommended implementation approach).

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
| `web/src/modules/app-builder/device-frame.tsx` | **New.** `DeviceFrame` component + `DEVICE_FRAME_PRESETS` (iphone/android). Pure presentational wrapper; never inspects the App Schema. |
| `web/src/modules/app-builder/canvas.tsx` | Added `interactive?: boolean` (default `true`) to `AppBuilderCanvas`, threaded through `CanvasComponentNode`/`NodeFrame`. `false` removes the type-tag and all selection/hover/click chrome; the honesty-only `UnsupportedVisibilityBadge` is deliberately **not** gated by it. No other behavior changed. |
| `web/src/app/(app)/app-builder/[id]/builder/page.tsx` | New `BuilderMode` (`'design' \| 'preview'`) state, independent of `PreviewState`. New header switch. Preview-mode content area (device-frame toolbar + `DeviceFrame`-wrapped, `interactive={false}` canvas). Full Preview overlay. Undo/Redo/Save/Publish and the Design-only mobile/tablet/desktop width toggle now render only in Design mode. |
| `web/src/messages/ar.json` / `en.json` | New `appBuilder.builder.builderMode.{design,preview}` and `appBuilder.builder.preview.{browserTruthBadge,fullPreviewAction,exitFullPreviewAction}` keys, both languages. |
| `web/src/modules/app-builder/canvas.test.tsx` | +5 tests: default `interactive` unchanged; `interactive={false}` removes chrome and click-to-select everywhere (including the canvas background); still resolves bindings/repeats templates/shows the sample-data banner; still shows the visibility-honesty badge. |
| `web/src/modules/app-builder/device-frame.test.tsx` | **New.** 3 tests: renders children, tags itself by preset, sizes the screen area to the preset. |
| `web/src/app/(app)/app-builder/[id]/builder/page.test.tsx` | +7 tests: editing controls/panels fully absent in Preview; clicking canvas content in Preview selects nothing; iPhone/Android preset switch; Full Preview open/exit; Draft/Published/Default switching works read-only inside Preview; returning to Design preserves selection and the dirty flag; locale toggle still sets `dir` inside Preview. |

## 3. Tests

- **Focused, new:** 5 (canvas) + 3 (device-frame) + 7 (page) = **15 new tests, all passing.**
- **Broader, same files:** `canvas.test.tsx` 14/14, `device-frame.test.tsx` 3/3,
  `page.test.tsx` 37/37 (30 pre-existing + 7 new) — **all pre-existing assertions unchanged and
  green**, confirming `interactive` defaulting to `true` and the new `BuilderMode` defaulting to
  `'design'` preserve every existing behavior exactly.
- **Translation-key guard** (`src/lib/__tests__/i18n-keys.test.ts`, 5/5): confirms every new
  `t('...')` call resolves in both `ar.json`/`en.json`, no duplicate keys, and the two language
  trees stay structurally identical.
- **Full web suite:** `npm run test` (Vitest) — **302 test files, 2143 tests, all green.** Zero
  regressions anywhere in the repository.
- **TypeScript / build:** `npm run build` (Next.js production build, which type-checks the whole
  project) completed with **no errors**, including the `/app-builder/[id]/builder` route itself.
  A baseline `npx tsc --noEmit` comparison against clean `origin/main` confirmed the handful of
  pre-existing unrelated type errors elsewhere in the repo (`pos/settings`, `gemini-card`,
  `document-language-selector`, `product-*`, `use-document-label-mode`, `useImportJobEngine`) are
  identical before and after this change — this change introduced zero new type errors. (One
  self-caught issue during development: an early draft placed the new `previewRoot`/
  `previewThemeTokensResolved` computation before the component's `!schema` null-check, which
  `tsc` correctly rejected — fixed by moving it after the guard, where `schema` is narrowed
  non-null.)
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

- PR opened against `main`, CI to be monitored to green.
- **Not merged. No deploy.** Awaiting the owner's explicit merge approval per this task's
  instructions.
- Recommended next task per the Horizon: **MOBILE-PREVIEW-4 — Runtime semantic parity.**
