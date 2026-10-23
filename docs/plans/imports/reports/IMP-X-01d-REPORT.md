# IMP-X-01d — Console UI for the operator controls + tenant-side owner approval card

**Branch:** `claude/imp-x01d-console-ui` (stacked on X-01c) · Web only (+ docs). No backend, env, Railway or provider/AI-setting change. The UI is a thin client over the X-01a/c APIs: the server is the authority, nothing is assumed successful, and every change is reloaded from the server.

## What it adds
- `components/platform/ai-action-controls-card.tsx` (+ `ai-action-controls.ts`): one card, two views.
  - **Platform** (placed on the existing platform *Integrations* page next to the AI budgets card — the established AI surface of the console; the platform nav keeps its five destinations): read-only **environment floor** badges (D-10, not editable), the **master switch** and per-type availability for the two capabilities (*Preview & review* / *Execution*), the last 30 audit events.
  - **Tenant** (on the tenant detail page, after the application-override card): the tenant's grants per type/capability, the **effective decision with its reason** for preview / review / execution, the tenant's recent events.
  - Every toggle opens the shared `ConfirmDialog` with a **mandatory reason** (3–500 chars, disabled confirm until valid); the PUT carries exactly the typed change; a failed write shows the server message and does not claim success; an unexpected response shape is an explicit load failure with a retry. Ar/en copy under `platformAiActions`, RTL-safe (`dir="ltr"` for type identifiers), Badges opt into wrapping (the platform text-scaling contract).
- `modules/ai-actions/enablement-card.tsx` (+ `enablement.ts`): the tenant's AI Actions settings card gains the **owner approval of execution** — shown once the organisation has enabled AI Actions; a switch only for the owner (`role === 'owner'` and the permission), a read-only state for others; a status line explaining why execution is unavailable *only when the operator gate is open*, with tenant-safe wording (platform-layer reasons are already collapsed to `platform_unavailable` by the server). New optional fields are tolerated by older servers.
- Existing page tests mock the new card (it has its own tests), so their alert assertions are unchanged.

## Tests
`ai-action-controls-card.test.tsx` (6): platform view (floor read-only, master/type rows, audit trail), reason-gated change sends exactly the typed body then reloads, cancel sends nothing, failed write → alert with the server message, tenant route + grants + effective reasons, bad shape → retry. `enablement-card.test.tsx` (+5): owner switch saves the server response, non-owner read-only, hidden until the organisation opted in, reason line only with the gate open, failed approval reloads. `tsc` clean for the touched files; platform/ai-actions suites green (the one `ConfirmDialog` Tab-trap test fails locally on `main` too and is untouched by this change).

## Disclosures
No screenshots / no visual check (headless slice; the card reuses existing platform primitives). No Codex review (quota exhausted); this slice has no independent review beyond its tests — it adds no authority (all enforcement is server-side and reviewed in X-01a/b/c). The default state of everything is unchanged: the operator gate is off.
