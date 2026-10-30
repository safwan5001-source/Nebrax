# IMP-H8-S4b — AI Actions history in the Import Hub (UI)

**Branch:** `claude/ai-actions-history-hub-ui` (stacked on IMP-H8-S4a, PR #1802). **Web only:** no backend, migration, permission, env or ZATCA change. **No journal entries and no stock effect** — the section only calls `GET /ai-actions` (read-only).

## What it adds
- `AiActionsHistory` section under the run history in `/imports`: table of the assistant actions of the tenant (type, status badge, row count, execution result `status: count`, creator, date), filters **status** and **only mine**, server pagination (10/25/50), and an *Open* link to `/products/ai-import?action=<id>` — only for a type with a known screen (`aiActionHref`); an unknown future type gets no guessed link.
- **Visibility:** rendered only for users holding `ai.actions.use` (same permission as the endpoint); the server remains the authority (type gates, branch, operator controls). A server **403** (assistant not enabled, no grant, no permission) shows an "unavailable" empty state without filters or retry — it is not an error. Other failures show a retryable error.
- Read-only by construction: the client only ever issues `GET`; no approve/execute/cancel affordance.
- Copy ar/en (`importHub.ai_*`, ten status labels). The note says the status is the stored one (expiry materialises when the action is opened — S4a disclosure).

## Tests
`ai-actions-history.test.ts` 4 (query allow-list, statuses, link policy, 403 vs other errors) · `AiActionsHistory.test.tsx` 5 (rows + link policy + execution result; filters/page sent and reset; 403 unavailable; empty/filtered/error+retry; read-only) · `ImportHub.test.tsx` +1 (section only with the permission and no `/ai-actions` call without it). Whole `modules/imports` (37) and `components/document-center` suites green; `tsc` clean for the touched files.
**Mutation controls** (each fails tests): section rendered without the permission gate (3) · 403 treated as an error (2) · `mine` filter not sent (2).

## Test-harness note
`beforeEach(() => api.mockReset())` returns the mock, which vitest runs as a cleanup hook after the test (it calls `api()` with no arguments). Written with a block body here (and fixed in the IMP-DOC-DISTINCT-01 dialog test).

## Not done / follow-ups
No search/sort, no per-row execution detail (the assistant screen has it), no navigation for types other than `product_import.v1` (none exist). Visual QA was done with component tests only (no screenshots).
