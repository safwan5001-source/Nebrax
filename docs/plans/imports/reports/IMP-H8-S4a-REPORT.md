# IMP-H8-S4a — AI Actions history list (backend contract)

**Branch:** `claude/ai-actions-history-backend`. **Read-only endpoint, no migration, no permission, env or ZATCA change.** **No journal entries and no stock effect** — the endpoint reads existing `ai_actions` / `ai_action_versions` / `ai_action_executions` rows and writes nothing (a test asserts no row and no `updated_at` changes).

## Contract
`GET /api/ai-actions` — middleware `ai.actions.use` + `throttle:60,1`.

| Query | Rule |
|---|---|
| `type` | one of the registered types (today `product_import.v1`) |
| `status` | one of the `AiAction::STATUS_*` constants |
| `mine` | boolean (`1`/`0`/`true`/`false`) — only the caller's actions |
| `from`, `to` | `Y-m-d`, inclusive on `created_at`; `to ≥ from` |
| `page` | 1..100000 |
| `per_page` | 1..**50**, default 15 |
| `tenant_id`, `created_by`, `branch_id` | **prohibited** (422) — scope is never taken from the request |

Order is fixed: `created_at DESC, id DESC` (no client-supplied sort). Response: `{data: [...], meta: {current_page, last_page, per_page, total}}`. A row carries `id, type, schema_version, status, version, branch_id, created_by, created_by_name, summary{row_count, error_count, needs_review_count}, execution{id,status,retry_count,started_at,finished_at,rows{status:count}} | null, cancelled_at, expires_at, created_at, updated_at`. **No proposal, no cost, no preview payload, no claim token, no file names** — detail stays at `GET ai-actions/{id}`.

## Authorization — no weaker than `show`
1. General gate (`AiActionPolicy::authorize` with no type): platform flag, tenant `ai_actions.enabled`, active actor/tenant, `ai.actions.use` → the same error codes as `show` (`platform_disabled`, `tenant_not_enabled`, `permission_denied` …), 403.
2. **Per registered type**, the same `authorize` call `show` makes (domain permissions `products.manage`, application key, operator controls under the runtime-controls gate, branch access). A type that fails is **excluded from the result**, not an error: its existence is not disclosed and the list never contains a row the caller could not open.
3. Branch scope = `assertBranchContext`'s: rows with no branch, or the active branch only.
4. Tenant scope = the model's `TenantScope` (`AiAction` is `CompanyWide`); the child lookups (versions, executions, rows) are tenant-scoped the same way.

## Cost and query shape
- Latest version is fetched **without the `proposal` column**; counts come from `validation_summary`.
- Latest execution per action + row counts by status: two extra grouped queries for the page. A test asserts the query count is identical for 2 and 7 actions (no N+1).

## Disclosed behaviour
- `status` is the **stored** status; time-based expiry (`ready_for_approval`/`approved` → `expired`) is materialised when the action is opened (`show`), because a list must not write.
- With the operator-controls gate on and no Super Admin grant, `show` is refused (default deny, D-11) and so the list is **empty** for that type. This is by design (same rule as `show`) and is the likely visible symptom of OPS-02; the settings status endpoint is what explains availability.

## Tests (`AiActionHistoryListTest`, 11, SQLite + PostgreSQL)
Summary/order/pagination and absence of proposal/cost · tenant isolation + prohibited scope params · platform/tenant closed · RBAC gate + type-gate hiding · operator controls identical to `show` · branch scope · strict filters and page cap · `mine` among users of one tenant · executed action with execution counts and constant query count · read-only · unauthenticated.
**Mutation controls** (each fails at least one test): branch filter removed · per-type gate removed · operator control (type) removed · `mine` filter removed.

## Not done / follow-ups
- IMP-H8-S4b: the Hub UI (separate PR) consumes this endpoint. No free-text search and no sort options by design (first version).
