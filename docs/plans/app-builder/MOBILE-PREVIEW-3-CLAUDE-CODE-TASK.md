# MOBILE-PREVIEW-3 — Claude Code Task

## Goal
Implement the **Browser App Preview Shell** for AWJ App Builder.

## Start
- Repository: `safwan5001-source/Nebrax`
- Start from latest `origin/main`.
- Expected baseline at task creation:
  `7bef75797ab608aeccb66056e049861ac787a102`
- Verify and report the exact Base SHA before coding.

## Read first
Only what is needed:
- `docs/plans/app-builder/AWJ_APP_BUILDER_REAL_MOBILE_PREVIEW_HORIZON.md`
- `docs/plans/app-builder/REAL-MOBILE-PREVIEW-1-EVIDENCE-PASS.md`
- `docs/plans/app-builder/REAL-MOBILE-PREVIEW-2-RUNTIME-ARCHITECTURE-EVIDENCE.md`
- `docs/plans/app-builder/REAL-MOBILE-PREVIEW-SALLA-MOBILE-BENCHMARK.md`

Do not repeat a broad App Builder/mobile-runtime investigation.

## Required external benchmark pass before coding
Do a **small evidence-first benchmark pass** before fixing the MP-3 UX. Use original/official documentation first and keep it proportional to this task.

Required sources to inspect:
- Salla App Maker / mobile-app design and preview documentation:
  - https://help.salla.sa/subcategory/%D8%AA%D8%B5%D9%85%D9%8A%D9%85-%D8%A7%D9%84%D8%AA%D8%B7%D8%A8%D9%8A%D9%82/zwocpbw83fyabe83uead25zy
  - https://help.salla.sa/subcategory/%D8%AA%D8%B5%D9%85%D9%8A%D9%85-%D8%A7%D9%84%D8%AA%D8%B7%D8%A8%D9%8A%D9%82-1/xqnf6uqfpwemieicn4nfcul6
  - https://help.salla.sa/article/%D8%A7%D8%A8%D8%AF%D8%A3-%D8%A8%D8%AA%D8%B5%D9%85%D9%8A%D9%85-%D8%A7%D9%84%D8%AA%D8%B7%D8%A8%D9%8A%D9%82/r4f54u89q3ivwaj9is0jc6qs
- Zid official mobile-app/help documentation:
  - https://help.zid.sa/category/zid-mobile-app/
  - https://help.zid.sa/subscription-to-mobile-app/
  - https://help.zid.sa/create-app/
- Shopify official theme editor / preview patterns for mature merchant editing UX:
  - https://help.shopify.com/en/manual/online-store/themes/customizing-themes/theme-editor/features-overview
  - https://help.shopify.com/en/manual/online-store/themes/customizing-themes/theme-editor/preview-inspector
- Flutter official web/runtime documentation only where it affects truthful preview boundaries:
  - https://docs.flutter.dev/platform-integration/web
  - https://docs.flutter.dev/platform-integration/web/embedding-flutter-web

Also read:
- `docs/plans/app-builder/REAL-MOBILE-PREVIEW-SALLA-MOBILE-BENCHMARK.md`
- the user-provided Salla screenshots referenced there.

Benchmark rules:
- distinguish **external evidence** from **AWJ decision**
- do not assume Zid has the same self-serve builder model as Salla; document differences
- do not copy any product blindly
- extract only patterns relevant to MP-3: Design vs Preview separation, device viewport, full preview, navigation expectations, empty/auth-dependent states, refresh-preview behavior, responsive desktop/mobile-admin treatment, and truth labeling
- keep deeper runtime/auth/session conclusions deferred to their locked Horizons unless current evidence proves a blocker
- if a new finding would materially change the locked MP-3 architecture or cross a Decision Gate, STOP and report it before coding
- add only a concise evidence note to the implementation report; do not create a broad new research project

## Locked architecture
`React Design Canvas → React Browser App Preview → Flutter Real Runtime Preview → Flutter Physical Device Preview`

This task implements **Browser App Preview only**.

## Required implementation
1. Add clear workspace mode:
   - `Design`
   - `App Preview`

2. Keep `PreviewState` separate:
   - `draft`
   - `published`
   - `default`

3. In App Preview:
   - non-editing
   - no component selection
   - no type tags
   - no selection/hover rings
   - no Inspector/Layers editing interaction
   - no hidden Draft mutation

4. Device preview:
   - professional iPhone preset
   - professional Android preset
   - app-level preview shell, not a decorative card
   - content-first frame, not decorative fake OS chrome
   - desktop: central device viewport + Full Preview
   - on small/mobile admin screens, do **not** show a tiny phone inside the phone; use available width

5. Keep:
   - Draft / Published / Default source switching
   - Arabic/RTL and English/LTR
   - existing sample-data behavior
   - current schema/binding semantics
   - existing Builder state when switching back to Design

6. Add visible truth label:
   - Arabic: `معاينة المتصفح`
   - English: `Browser Preview`

7. Add Full Preview:
   - hide editor chrome
   - maximize preview
   - allow exit
   - preserve Draft edits, selected page/component, source, locale, and device choice

8. Prefer reusing `AppBuilderCanvas` with an explicit `design/preview` mode.
   Do not fork renderer/schema semantics unless technically unavoidable.

9. Keep the shell structurally ready for app-level navigation and truthful states such as empty cart, empty category/content, auth-required orders, and logged-out account. In MP-3, reuse only already-supported safe semantics/placeholders; do not invent runtime/auth behavior. Deeper parity is MP-4+.

10. A `Refresh Preview` action is allowed only if it refreshes existing browser-preview state safely. It must not publish, persist, create a preview session, or introduce auth/token architecture.

## Likely files
Inspect first:
- `web/src/app/(app)/app-builder/[id]/builder/page.tsx`
- `web/src/modules/app-builder/canvas.tsx`
- focused tests/translations only as needed

Keep scope tight. No unrelated refactor.

## Hard boundaries
Do **not**:
- add Preview Session/auth
- forward store bearer/admin Sanctum to browser/mobile
- add live merchant commerce data
- add customer identity/login
- add Flutter Web
- add QR/Open-on-phone
- change API contracts/database/RBAC/Tenant Isolation
- change financial/accounting behavior
- deploy/sign/distribute/publish

If implementation requires MP-5 auth/security Decision Gate, **STOP and report**.

## Tests
Add focused proof for:
- Design remains editable
- App Preview hides editing/selection affordances
- preview content does not trigger component selection
- Draft / Published / Default still work
- RTL/LTR
- iPhone / Android preset switching
- Full Preview enter/exit + state preservation
- small-screen behavior
- sample-data truth label
- entering/using App Preview does not save/publish/mutate by itself

Run focused tests first, then relevant web tests/build.

## Branch / PR
Use:
`feat/mobile-preview-3-browser-shell`

Open one PR:
`feat(app-builder): MOBILE-PREVIEW-3 browser app preview shell`

Use the Horizon workflow: complete implementation, focused tests, relevant web tests/build, open the PR, follow CI, and address in-scope findings until the task is ready for closure. Stop only before merge unless explicit merge approval exists. Do not deploy/Production.

## Final report
Return a concise Markdown report with:
- Base SHA / Head SHA
- Branch / PR
- files changed
- what was implemented
- Design vs App Preview behavior
- device-frame + small-screen behavior
- Full Preview behavior
- Draft/Published/Default + RTL/LTR proof
- tests/build/CI results
- confirmation: no auth/token/API/DB/RBAC/Tenant Isolation changes
- risks/remaining gaps
- deferrals to MP-4 / MP-5 / MP-6 / MP-7
- next step
