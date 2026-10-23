# IMP-H2-S4b — Settings card for the tenant AI Actions opt-in (web only)

**Branch:** `claude/imp-h2-s4b-ai-actions-settings-card` · **Depends on:** H2-S4 (`0572fa4`). **No backend, migration, env, accounting, ZATCA or AI-setting change.** Not IMP-X-01.

## What it adds

- `AiActionsEnablementCard` (`web/src/modules/ai-actions/enablement-card.tsx`) on `/intelligence/settings`: shows the server state (enabled / not enabled), a switch for holders of `ai.actions.manage`, and the “nothing runs automatically” statement.
  The page was gated on `ai.consent.manage` alone; it now opens for either permission and shows each section only to its own holders (assistant consent unchanged).
- The switch reflects **only the server response** (no optimistic state). While the platform flag is off, turning it **on** is disabled (the server would refuse with 409); turning it **off** is always allowed. A refused save shows the server message and re-reads the state.
- `AiActionsDisabledNotice` on the assisted-review import screen (`/products/ai-import`): when AI Actions are not effective it says *why* (platform vs organization) and links managers to the settings, or tells others to ask the owner. Renders nothing when effective or when the status cannot be read (the server still enforces everything).
- Bilingual copy (AR/EN, language from `<html lang>`, same convention as the other AI Actions panels).

## Tests

`enablement-card.test.tsx` (6): saves and shows the server's value; platform-off disables enabling but not disabling; no switch without the permission; refused save → server message + state re-read; notice for manager vs non-manager; notice hidden when effective or unreadable.
Existing `ai-import/page.test.tsx` (11), roles catalog guard and layout suites unchanged and green. Typecheck: no errors in touched files.

## Disclosures

No screenshots / visual check of the new card (component tests + typecheck only). No Codex review (quota exhausted); no subagent review for this small web-only slice.
