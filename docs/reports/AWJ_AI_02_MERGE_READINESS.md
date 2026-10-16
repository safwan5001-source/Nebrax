# AWJ AI-02 — Final Merge Readiness

Scope: PR #1548 (AI-02A) and PR #1549 (AI-02B). Read-only verification plus the minimum fixes that verification required. No merge, no deployment, no live provider, no change to accounting, tenant isolation, RBAC or the approved financial access policy.

## 1. Recommendation

| PR | Decision | Condition |
|---|---|---|
| **#1548** AI-02A | **GO** | Mark it ready for review (it is a Draft), then merge it with a **merge commit** (see section 3 for why). No code conflict exists. |
| **#1549** AI-02B | **GO, after #1548 merges** | Retarget to `main`. With a merge commit on #1548 the retarget is conflict-free (verified). If #1548 is squash-merged, use the verified recipe in section 3 (code applies cleanly; only the shared report file needs the branch version). |

No NO-GO finding remains. One real defect was found and fixed in #1549 (section 5, finding F1).

## 2. Branches, PRs and SHAs

| | #1548 AI-02A | #1549 AI-02B |
|---|---|---|
| Branch | `feat/ai-02-financial-intelligence-20261016` | `feat/ai-02b-finance-tools-20261016` |
| Base branch | `main` | `feat/ai-02-financial-intelligence-20261016` (stacked) |
| Base SHA | `336284170ea6a044ee745fda2f1c844e161215cf` (AI-01 squash merge) | `9da822712bb809af0b84bda7489b5e136e51ec97` (head of #1548) |
| Head SHA | `9da822712bb809af0b84bda7489b5e136e51ec97` (unchanged this round) | code head `a84678293e29f2d956ed8ada81cecbef26d79d4c`; the report-only commit that adds this file follows it and is the PR head |
| `main` today | `1b6f51d67cf68b59ce5ba6cb6450b983b43b8345` (#1550, 1 commit ahead of both PRs' common base) | same |

## 3. Merge blockers and resolution

### 3.1 Why #1548 is reported as not mergeable

What GitHub reports for #1548, read through the available API (`pull_request_read`):

| Field | Value |
|---|---|
| `state` / `merged` | open / false |
| **`draft`** | **true** |
| `mergeable_state` | `clean` |
| Checks on head `9da8227` | SQLite, PostgreSQL and CI Gate: all **success** |
| Reviews / comments | none |
| Base vs `main` | `main` moved by one commit after the PR was opened: `1b6f51d` (#1550) |

Findings:
1. **The only hard blocker is the Draft state.** GitHub does not enable the merge button on a Draft pull request. This is the exact reason the PR cannot be merged as it stands. I did not change it, because marking a PR ready for review is the owner's decision.
2. **There is no merge conflict.** `mergeable_state` is `clean`, and I confirmed it independently with trial merges against the current `main` (`git merge-tree --write-tree`): #1548 into `main` exits 0, and #1549 into `main` exits 0.
3. **The branch is one commit behind `main`.** #1550 changes only `web/src/messages/ar.json`, `web/src/messages/en.json` and one report file, with no overlap with these PRs. "Update branch" is not required for correctness. It would only matter if branch protection demands an up-to-date branch.
4. **Limit of this inspection:** the tools available here do not expose branch-protection settings or required-review rules, so a protection rule that blocks merging cannot be excluded. The API reports `clean`, which would show `blocked` if a required rule were unmet. If the merge button still stays disabled after the PR is marked ready, the repository's merge settings are the next place to look.

No conflict was present, so nothing was merged into the branches and no unrelated change was made.

### 3.2 Interaction with #1550 (permission labels)

The web role editor has a test (`web/src/modules/roles/catalog.test.ts`) that requires a label for every module, action and area of every permission in `Rbac::PERMISSIONS`. #1550 fixed this for `ai.assistant.use`. AI-02A also adds a permission, **`ai.audit.view`**, so I verified it:
- `ai` (module): label added by #1550. `audit` (area) and `view` (action): already labeled.
- I ran the web test on the tree "#1549 + current `main`": **4 files, 39 tests passed**.
- Therefore #1548 and #1549 do not reintroduce the red `web build` failure that #1550 fixed. Note the web job is skipped on these PRs (no `web/` change), so this check was only possible locally.

### 3.3 Can #1549 be retargeted cleanly after #1548 merges?

I simulated both merge styles on throwaway local worktrees (nothing pushed):

| #1548 merged as | Result for #1549 |
|---|---|
| **Merge commit** | **Clean, 0 conflicts.** A's commits stay ancestors of #1549, so retargeting to `main` just works. **Recommended.** |
| **Squash** (as #1546 was) | A direct merge conflicts in 5 code files plus the report, because the squash commit is not an ancestor of #1549 and both sides edit the same lines. With the recipe below it is clean for code; only the report file needs a manual choice. |

Recipe if #1548 is squash-merged (verified end to end):
```
git fetch origin
git checkout feat/ai-02b-finance-tools-20261016
git rebase --onto origin/main 9da822712bb809af0b84bda7489b5e136e51ec97 feat/ai-02b-finance-tools-20261016
# the only conflict is docs/reports/AWJ_AI_02_IMPLEMENTATION_REPORT.md: take the branch version
git checkout origin/feat/ai-02b-finance-tools-20261016 -- docs/reports/AWJ_AI_02_IMPLEMENTATION_REPORT.md
git add docs/reports/AWJ_AI_02_IMPLEMENTATION_REPORT.md && git rebase --continue
git push --force-with-lease      # only after the owner agrees to rewrite this branch
```
Verification: after the rebase, the code tree (`app`, `config`, `database`, `routes`, `tests`) is **identical** to the current #1549 head; the only differences are the main-only changes (#1550) and the report text. Please keep the CI re-run after the retarget as the final gate.

## 4. Final scope and migration verification

### Scope against `main`
- Files changed (non-test, non-doc): the AI gateway files, `Rbac.php` (two permission strings), `routes/api.php`, `routes/console.php`, `config/ai_assistant.php`, three new models, and the one migration.
- **Accounting, reporting and web:** 0 files changed under `app/Services/Accounting`, `app/Services/Reporting`, `ReportService`, `ReportController`, or `web/`. No Document Center, Store, UI or Help Center change.
- **Migrations:** exactly one, `2026_11_13_010000_create_ai_metering_and_audit_tables.php`, creating `ai_budgets`, `ai_requests` and `ai_audit_events` (no change to any existing table). Its content was committed once (`e98b2c5`) and has not changed since review. #1549 adds none.
- **Safety evidence (details in the implementation report, A8):** it is the last file in the sequence and depends only on `tenants`; `main` already carries `2026_11_*` migrations (the repository's sequence runs ahead of the calendar), so the date is not anomalous. Verified fresh, rollback and incremental re-apply on SQLite and a local PostgreSQL 16, including the PostgreSQL `CHECK` constraints; `AiMeteringMigrationTest` guards ordering and the round trip in CI.

### Paid-provider access is still disabled
- `config/ai_assistant.php`: `enabled` defaults to `false`, `provider` to `mock`; the price table lists only `mock` (not billable, price 0). Nothing sets `AI_ASSISTANT_ENABLED` in any environment, deployment, Docker or CI file in the repository (searched).
- The only class implementing the provider contract is `MockAiAssistantProvider`. Any other configured provider fails closed with `503 provider_unavailable` and reads no platform secret and opens no connection.
- No tenant has consent: `ai_assistant.enabled=false` and no categories by default. `financial_summary` remains default-deny.
- New guard `AiPaidProviderDisabledTest` (4 tests) pins all of this, so adding a real adapter later must update it deliberately.

## 5. Security and financial correctness findings

| # | Area | Finding | Status |
|---|---|---|---|
| **F1** | Warehouse-restricted users | The tool result states `warehouse: not_applicable` and `user_restriction_applied: false`, but the gateway's own `data.scope.warehouse` (`assigned` plus the user's warehouse id) sat next to the figures and could be misread as a data filter. | **Fixed** in #1549: the response now carries `scope_kind: authorization`, and a new test walks every tool result to prove "warehouse" never appears outside `scope.warehouse` and the user's warehouse id never appears in the figures. |
| F2 | Warehouse policy | Financial reports and `/api/reports/income-statement` and `/aging/*` apply branch scope only; warehouse restriction governs inventory reads. The tools return exactly what the API returns to the same user (verified across 5 actor kinds). | Consistent with the approved policy. No change. Whether warehouse restriction should limit financial visibility remains an owner decision. |
| F3 | Historical aging | Every aging result carries `basis.as_of_role = age_reference_only`, `historical_balance_rebuilt = false`, `balance_semantics = current_outstanding_balance`, `balance_as_of = generation_time`, plus the `as_of_not_historical` warning when `as_of` is not today in the tenant timezone. A test with an invoice paid after the requested date shows it absent from a past `as_of` (balance not rebuilt). `ReportService` is unchanged. | Verified. No change. |
| F4 | Tenant isolation / RBAC / scope | Cross-tenant branch, warehouse and actor ids rejected; forbidden ids rejected, never widened; `ai.assistant.use` + `reports.view` + `financial_summary` consent re-checked per invocation with a freshly loaded actor; partner detail needs `partners.view`; revocation between planning and execution enforced. | Verified by tests (see section 6). |
| F5 | Money | Amounts are integer minor units with `decimal` strings from the existing `Money` helper; a test asserts no floats in any result. SAR is enforced; non-SAR tenants are refused before any read. | Verified. |
| F6 | Spend control | No unlimited default; reservation is one conditional `UPDATE` per cap row; verified under real parallelism on SQLite (12 processes) and PostgreSQL 16 (16 processes): 2 granted, never above the cap. | Verified (A8). |
| F7 | Audit | Metadata only; required durable write before any provider call; append-only through the model; read access needs `ai.audit.view` (owner/admin only). | Verified. |

## 6. Test results and CI

| Check | Result |
|---|---|
| Focused set run this round (SQLite): all AI suites (`AiAssistantGatewayTest`, `AiMeteringTest`, `AiMeteringMigrationTest`, `AiAuditTest`, `AiFinanceToolsTest`, `AiPaidProviderDisabledTest`) plus nearby report, scope, isolation, RBAC and route-guard suites | **248 passed, 1 skipped** (the skip is the PostgreSQL-only `CHECK` test; it runs on PostgreSQL in CI) |
| `AiFinanceToolsTest` | 33 tests (adds the F1 test) |
| Web permission-label coverage on "#1549 + current `main`" | **39 passed** |
| Trial merges against current `main` | #1548 and #1549 both clean |
| Mutation checks this round | not repeated; previous mutations still fail the tests (see implementation report) |
| Full local suite | **not re-run** (as instructed): the changes this round add one response key and tests only. Previous full run: 7441 passed, 26 failed, all the environmental `bcmath` set in six fuel classes that CI passes. |

CI, read once per PR with no repeated polling:

| PR | Head tested | SQLite | PostgreSQL | CI Gate |
|---|---|---|---|---|
| #1548 | `9da8227` (current head) | success | success | success |
| #1549 | `a846782` (code head) | success | success | success |

The report-only commit that adds this file to #1549 changes no code. GitHub will run CI on it again; the result should match the row above.

## 7. Risks that remain (none block the merge)

1. **Policy decision still open for the owner:** a warehouse-restricted user sees company-wide financial statements, as in the application today.
2. **Narration discipline:** `warnings`, `basis` and `scope_kind` are machine-readable; only a prompt instruction or the AI-03 UI guarantees a model respects them.
3. **Stacked-PR mechanics:** the squash-merge path for #1548 needs the recipe in 3.3; a merge commit avoids it.
4. **Branch-protection rules** could not be read here (3.1, item 4).
5. **Audit tamper resistance** is model-level only; **budget caps need a reviewed operator path** before any paid call; the real provider adapter remains blocked by the privacy, residency, billing-owner and numeric-cap gates.

## 8. Owner actions, in order

1. Mark #1548 ready for review (it is a Draft) and merge it with a **merge commit**.
2. Retarget #1549 to `main` (or run the section 3.3 recipe if #1548 was squashed), let CI run, then merge.
3. Do not enable `AI_ASSISTANT_ENABLED` or any tenant consent anywhere; there is no real provider to enable.
