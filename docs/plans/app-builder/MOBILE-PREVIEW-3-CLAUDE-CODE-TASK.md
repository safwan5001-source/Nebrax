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

Do not repeat a broad App Builder/mobile-runtime investigation.

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
   - content-first frame, not decorative fake OS chrome
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

Do **not** merge or deploy.

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
