# AWJ-HORIZON-V2-1D — Horizon evaluator in CI + GitHub safety packet — Implementation Report

STATUS: READY FOR OWNER REVIEW — **not merged**, nothing activated. Dry-run only.
DATE: 2026-10-13
Follows: V2-1C (PR #1351, merged as `04427a0`). Builds on V2-1A (CI Gate) and V2-1B (authority model).

## 1. Outcome

A regression in the Horizon dry-run evaluator now turns CI red. The 172 existing tests (plus 8 CI-wiring guards and 1 runner guard = **181**) run as the check `Horizon dry-run evaluator (tests)` **only on pushes and PRs that touch Horizon files** (`scripts/horizon-eval/**`, its own workflow file, `.github/ci-gate/**`), and **CI Gate requires it for exactly those PRs** (`tier: paths`, as directed by the owner: no new global `always` requirement). Every other PR — accounting, POS, storefront, web, DB, other CI — never sees it (§3b).

It fails on: any test failure/error · any skipped or expected-failure test (final line must be exactly `OK`) · fewer than `MIN_TESTS` tests discovered · a non-zero contract table (23 cases / 11 scenarios, **false-eligible must be 0**) · tests that dirty the working tree.

What it does **not** do: it grants nothing, merges nothing, and changes no GitHub setting. `ELIGIBLE_SIMULATED` is still not authorization; live mode still cannot be eligible (no independent owner-authenticity verifier, V2-1B §4.6 / D2).

## 2. Changed files (11)

| File | Change |
|---|---|
| `.github/workflows/horizon-eval-ci.yml` | **new** — job `horizon-eval`, name `Horizon dry-run evaluator (tests)`; `push` + `pull_request` **path-filtered** to `scripts/horizon-eval/**`, `.github/workflows/horizon-eval-ci.yml`, `.github/ci-gate/**` (everything the tests read or guard); no job `if`, no `continue-on-error`; `permissions: contents: read`; no secrets, no network, no installs; `persist-credentials: false`; 10-min timeout |
| `.github/ci-gate/required-checks.json` | **+1 entry** `tier: paths` with a guard (`require`: `set -o pipefail`, `MIN_TESTS=`, `!= "OK"`; `forbidden`: `\|\| true`, `\|\| :`, `exit 0`, ` -k `, `--pattern`, ` -p `, `--failfast`). No existing entry touched |
| `scripts/ci-gate/ci_gate.py` | **trusted gate logic, strengthened only** (§5b, Codex P1): a manifest check now counts only when its check run belongs to the suite of the workflow the manifest declares (`restrict_to_declared_workflows`), and `validate()` hard-fails if a required check name is produced by more than one PR-triggered job. No existing rule removed or relaxed |
| `scripts/ci-gate/test_ci_gate.py` | original 49 tests kept **unchanged** except one assertion (unknown diff requires every blocking check: 8 → 9; see §5). **+23 tests**: Horizon paths-tier expectation/verdicts, unrelated-PR immunity, end-to-end `run_gate` for a Horizon PR and unrelated PRs, impostor binding, duplicate producer, unparseable job name, hidden matrix axis, step-level `if`, baseline anti-weakening incl. path-filter narrowing |
| `scripts/horizon-eval/contract_runner.py` + `test_contract.py` | exit code now also requires exactly 23 contract cases (an empty fixture dir used to exit 0); +1 test |
| `scripts/horizon-eval/test_ci_integration.py` | **new**, 8 stdlib-only guards: manifest entry, tier `paths`, guard strings, exact path filter (and that it covers every file the tests read), least privilege, no network, floor bounds |
| `scripts/horizon-eval/collect_snapshot.py` | defect fix (§6): `gh_get` now refuses dot-segments and encoded separators |
| `scripts/horizon-eval/test_static_guards.py` | the matching test is now hermetic and covers 7 more refused paths |
| `scripts/horizon-eval/README.md` | documents the CI job |
| this report | — |

Not touched: application code, accounting, tax, ZATCA, RBAC, tenant isolation, migrations, APIs, `ci.yml`, `web-ci.yml`, `ci-gate.yml`, `ci_gate.py`, the evaluator, the policy table, Zone A/B definitions, other Horizon branches.

## 3. Effect on the existing CI Gate

| Question | Answer |
|---|---|
| Existing required checks renamed or reclassified? | **No.** All 10 manifest entries are byte-identical; one is added. `compare_baseline` (run in CI with the trusted base copy) reports no weakening. |
| Gate logic changed? | **Strengthened, not relaxed** (§5b): bind each required check to its declared workflow + reject duplicate producers of a required name. `ci-gate.yml` untouched. **These two additions take effect only after this PR merges** — the Gate on this PR runs the trusted *base* copy of the script by design. |
| New requirement on PRs | **Only** PRs whose diff matches the workflow's `pull_request.paths` must report `Horizon dry-run evaluator (tests)` = success (the Gate reads the filter from the workflow file, like `web build`). All other PRs: the check is "not required (path filter)" and never waits. A matching PR that never reports it fails after the existing 10-min grace period. |
| Can a path filter or skip hide it? | Not silently. `validate()` already rejects, for a blocking check: a missing `pull_request.paths` on `tier: paths`, a job-level `if`, `continue-on-error` on job or step, a rename (name drift), or the workflow no longer triggering on `pull_request`. Each is proven by a mutation test in `test_ci_gate.py` (§5). |
| Push-event twin check-runs | Handled by the existing `bind_check_runs` (only `pull_request`-event runs of the exact head SHA count); a test shows a green push twin cannot mask a red PR-event run. |
| Gate self-tests | 49 → **72**, all green (6 s). |
| Self-change banner | This PR edits `.github/ci-gate/**` and `scripts/ci-gate/**`, so the Gate prints its `GATE SELF-CHANGE` warning. Expected; weakening is blocked automatically, everything else is owner review. |

## 3b. Demonstrations requested by the owner

**1. A Horizon-related PR executes its tests and blocks on test failure.**

| Evidence | Result |
|---|---|
| Gate expectation for this PR's real diff (11 files incl. `scripts/horizon-eval/**`) | `Horizon dry-run evaluator (tests)` **required** (3 blocking checks expected) |
| Real CI on this PR | the check ran on both the `push` and `pull_request` events and passed (§11) |
| `run_gate` end to end (`EndToEnd.test_horizon_pr_requires_and_is_blocked_by_the_horizon_check`) | Horizon green → gate passes; Horizon **failure → gate fails**; Horizon never reported → gate fails at the deadline; an impostor job of the same name cannot stand in |
| Verdict unit tests (`HorizonPathsTier.test_horizon_pr_blocks_on_failure_and_waits_when_missing`) | failure / cancelled / skipped / neutral / timed_out / action_required / stale / none → **fail**; missing → wait → fail; other-app spoof → wait; in-progress → wait |
| **Real failing run on GitHub** (throwaway branch `demo/v2-1d-horizon-failing-test`, commit `ea629d3`, one deliberately failing test, never a PR; **still on the remote** — this session's proxy refuses branch deletion, so the owner can delete `demo/v2-1d-horizon-failing-test` and `demo/v2-1d-unrelated-docs-only`) | `Horizon Eval CI` run `38440378507` (push event) → job `Horizon dry-run evaluator (tests)` **failure**: step "Evaluator tests" failed on `test_deliberate_failure` (`AssertionError: deliberate failure to demonstrate that the Horizon CI check blocks`); the contract-table and clean-tree steps were skipped. For a PR carrying such a commit the gate requires this check (path match) and therefore fails |
| Local replay of the workflow's own `run:` blocks with a failing test / skipped test / deleted tests / disabled authenticity check / policy default flipped | all rc 1 (§4.1) |

**2. An unrelated accounting / POS / storefront PR is unaffected.**

| Evidence | Result |
|---|---|
| Last 80 real changes merged to `main` (file lists from git) run through the real gate expectation | **2 require Horizon** (the Horizon-related ones); **78 unaffected**, including the 2 accounting/ledger-touching, 2 POS-touching and 18 storefront-touching changes |
| All 18 real open PRs other than this one (file lists via the GitHub API, read-only) | **0** require Horizon (incl. #586 ZATCA, #778 pay-v2 accounting design, #704 accounting settings, #1089/#1385 storefront, #1386 tenant picker); each keeps exactly its previous required set |
| Unit + end to end (`HorizonPathsTier`, `EndToEnd.test_unrelated_pr_is_green_without_any_horizon_run`) | 12 unrelated paths (Accounting/Ledger service, POS controller and service, storefront, web, migration, routes, docs, other workflows, `ci_gate.py`) never expect Horizon and still expect the two PHP suites; the non-web ones pass with PHP green and **no Horizon run at all** (the web/storefront ones with their own existing check) |
| **Real run on GitHub** (throwaway branch `demo/v2-1d-unrelated-docs-only`, docs-only change, `f72aaaf`) | only `CI` triggered (run `38440382778`, cancelled by me to spare runners); **no `Horizon Eval CI` run exists** for that SHA |

**3. Existing CI Gate tests and baseline anti-weakening protections still pass.**

| Evidence | Result |
|---|---|
| The **original** `test_ci_gate.py` from `main` (49 tests, unmodified) against the new `ci_gate.py` + new manifest/workflows | 48 pass; **1 fails by design**: `test_unknown_diff_requires_everything_blocking` expects 8 blocking checks and there are now 9 (§5). Nothing else changes. The trusted *base* `ci_gate.py` (what the Gate actually runs on this PR) shows the identical single difference |
| The updated suite | **72 / 72 OK**; `ci_gate.py validate` → no errors, no warnings |
| `compare_baseline(origin/main checkout → this PR head)` with the real files | `[]` — nothing weakened |
| Anti-weakening tests (the existing ones + 6 new for the Horizon entry) | removing / demoting / repointing a blocking check, shrinking a guard, narrowing a path filter → rejected; widening → allowed |
| Existing check names, tiers, workflows, guards | all 10 pre-existing manifest entries byte-identical; `ci.yml`, `web-ci.yml`, `ci-gate.yml` untouched |
| GitHub settings | nothing changed: no Ruleset, branch protection, permissions or Auto-Merge (read-only GETs only) |

## 4. Tests and exact results

| Suite | Before | After | Result |
|---|---|---|---|
| `scripts/horizon-eval` (`python3 -I -B -m unittest discover`) | 172 | **181** (+8 `test_ci_integration`, +1 `test_contract`) | OK |
| `scripts/ci-gate` | 49 | **72** (+23) | OK |
| Contract table | 23/23 · 2 extras | 23/23 · 2 extras | false-eligible **0** |
| `ci_gate.py validate` | OK | OK | no errors, no warnings |
| Workflow `run:` blocks executed locally in bash with `-eo pipefail`, clean env | — | 181 tests · floor 181 · `OK` · contract 23/23 · tree clean (incl. ignored files) | rc 0 |

### 4.1 Sabotage runs of the new job (each must turn CI red)

Run in scratch copies of the tree with the workflow's own `run:` blocks:

| Sabotage | Caught by | Result |
|---|---|---|
| a failing test | unittest | red |
| a skipped class (`OK (skipped=3)`) | clean-`OK` check | red |
| tests deleted (152 < floor) | `MIN_TESTS` floor (isolated from the in-suite floor test) | red |
| **security regression**: live-mode authenticity check disabled | unit/static tests **and** the contract table (rc 1) | red |
| **policy regression**: `default_zone` C → B | 86 failures / 34 errors | red |
| `\|\| true` swallowing the test exit code | in-suite guard (and, in CI, `validate()` guard) | red |

### 4.2 Gate-side sabotage (the wiring cannot be quietly removed)

Manifest copies with the Horizon entry removed / demoted to `advisory` / guard deleted make 3–13 of the new gate tests fail each (e.g. `test_removing_horizon_check_fails`, `test_demoting_horizon_check_fails`, `test_horizon_test_step_cannot_be_neutered`).

## 5. Finding: any new blocking check changes one hard-coded count in the gate's self-tests

An earlier iteration of this PR made the check `tier: always`; that turned 8 gate self-tests red (they hard-code the always-set as the two PHP suites) and was dropped on owner direction in favour of `tier: paths`. With `tier: paths` **48 of the 49 original tests pass byte-for-byte unchanged**; the one that changes is `test_unknown_diff_requires_everything_blocking` (`len(exp) == 8`): when the PR diff is unknown/truncated the gate requires *every* blocking check, so adding any blocking check must move it to 9 — it now also asserts the Horizon check is in the set. That test runs inside the `CI Gate` job ("Gate self-tests (PR copy)"), so it has to be updated in the same PR. Evidence in §3b.

## 5b. Finding (Codex P1): a same-named job in another workflow could satisfy a required check

`bind_check_runs` pools check runs from every `pull_request` suite of the head SHA and `latest_by_name` then forgets which workflow a run came from. A PR could add a job named `Horizon dry-run evaluator (tests)` (or `php artisan test (L11, sqlite)` — **inherited, pre-existing for the PHP checks**) to any other PR-triggered workflow; its green result, from the same `github-actions` app, satisfied the manifest entry while the real job failed or never ran. `validate()` only warned ("unclassified"). Two fixes, both in the trusted gate and both strengthening-only:

1. `restrict_to_declared_workflows`: a run named like a manifest check is kept only if its check suite belongs to the workflow run whose `path` equals the manifest's `workflow` (live `actions/runs` paths were checked: plain `.github/workflows/<file>.yml`). Unknown suite or other workflow → dropped → the check reads "not reported" → wait → fail at the deadline. Names not in the manifest pass through unchanged.
2. `validate()`: a manifest check name produced by more than one PR-triggered job (same or another workflow) is a hard error (belt and braces for fix 1; none exist today).
3. (Codex P1, second round) a job whose display name the gate cannot evaluate — e.g. `name: ${{ 'Horizon dry-run evaluator (tests)' }}` with `needs: horizon-eval` and `if: always()`, which would report success after the real job fails and win `latest_by_name` by id — used to be only a warning and was skipped by the duplicate scan. Inside any workflow that hosts a required check it is now a hard error. Workflows that host no required check keep the warning-only behaviour (none exist today with such names).
4. (Codex P1, third round) a matrix axis the job name does not mention (`variant: [checked, bypass]` on a constant-named job) makes GitHub create several same-named check runs; `job_names()` now multiplies the name by the hidden combinations so the duplicate-producer scan rejects it. A non-mapping `matrix` (e.g. `fromJson`) is rejected.
5. (Codex P1, third round) a step-level `if` on the guarded test step (`if: false`) left the job green with zero tests run. A guarded step with `if` is now an error (an `if` on an unguarded diagnostics step, as the PHP workflow has, stays allowed). The contract-table and clean-tree steps are still unguarded (D7) — skipping them leaves `test_contract` and the in-suite checks as the signal.
6. (Codex P1, fourth round) a matrix axis whose value is an expression (`variant: ${{ fromJSON(...) }}`) was ignored by the multiplier; any non-list axis value now raises, i.e. fails closed (an error inside a workflow that hosts a required check).

7. (Codex P1, fifth round) `set +e; exit() { return 0; }` inside the test step neutralises its failure handling while keeping every required substring. The manifest `forbidden` list now also rejects `set +e`, `set +o`, `trap `, `exit()`, `exit ()`, `alias `, `BASH_ENV`, `command_not_found` (baseline-protected once merged). **Deliberately the last in-script shell variation this PR chases**: bash offers unbounded ways to alter a script's behaviour (`eval`, sourced files, `PATH` shadowing, …) and no substring lint can be complete. Further ones are answered by D3, not by more strings.

**Honest limit of §5b.** Items 1–6 close every path Codex found, but they are static lint of a workflow the PR author controls: each round found a new variation, and a determined author editing the declared workflow can keep looking for one the lint does not model. What actually bounds this is **owner review of `.github/**` and `scripts/**`** (D3) — the lint raises the cost and catches accidents and obvious bypasses, it is not a substitute for that control.

Revert-proof: removing the call in `run_gate` fails `test_impostor_horizon_check_from_another_workflow_cannot_pass_the_gate` (end-to-end); disabling the duplicate check fails `test_duplicate_producer_…`. Residual: the trusted base copy of the gate runs on this PR, so this PR itself is not protected by the new binding; protection starts at merge.

## 6. Finding: `collect_snapshot.gh_get` path guard was bypassable (fixed)

The allow-list regex admits `.` and `%`, so `repos/o/r/../../x` (and `%2e%2e`, `%2F`) passed and reached `gh api`. Effect was bounded (GET-only, read-only collector, not the evaluator), but the "repos paths only" claim was false, and the existing test passed **only because `gh` happened to fail** (it needs `gh` and a network; with `gh` absent it errored). Fix: refuse any `.`/`..` segment and `%2e|%2f|%5c`; the test now patches `subprocess.run` to fail if a refused path spawns a process. Revert-proof: with the fix removed the test fails (`spawned a process`).

## 7. Security risks and mitigations

| Risk | Mitigation | Residual |
|---|---|---|
| PR-controlled code runs in the job | `contents: read` only, no secrets, `persist-credentials: false`, `pull_request` (never `pull_request_target`/`workflow_run`), no network/install step | The code can still read the checkout and use the runner's network; it holds no credential |
| Check skipped / path-filter removed or narrowed / renamed | `tier: paths` (filter **required** by `validate()`; narrowing blocked by `compare_baseline` after merge) + `validate()` lints; push twins ignored by `bind_check_runs`; other-app spoofing ignored by `latest_by_name` (`github-actions` only) | none known |
| Test silently dropped | `MIN_TESTS` floor (shell) + in-suite floor test (≤5 slack below reality) | a PR may lower both **and** the guard in one commit — see next row |
| PR weakens the check itself | `compare_baseline` blocks removal/demotion/repointing and **loss** of guard strings once this is on `main` | **Open:** edits that keep the guard strings but change test *content* (e.g. weaken an assertion, lower the `MIN_TESTS=` value, monkeypatch `unittest`) or the workflow's unguarded parts (see the Reviewer list in §10) are not machine-detectable. They are Zone C (`scripts/horizon-eval/**`, `.github/**`) and need owner review; no ruleset enforces that yet (D3 below) |
| `MIN_TESTS` ratchet cannot be a guard string | a literal value in `guard.require` would make every legitimate increase look like a weakening | value policed only by the in-suite test and review |
| Bootstrap | on this PR the Gate runs the **base** gate script against the PR manifest, so the new check is already required on its own PR | — |

## 8. GitHub protections — verified vs unknown (read-only, 2026-10-13)

Method: `gh api` GET through the session proxy; nothing written.

**Verified now**

| Item | Observation |
|---|---|
| Rulesets / rules on `main` | `GET /rulesets` → `[]`; `GET /rules/branches/main` → `[]` |
| Branch protection | `main.protected = false`, `enforcement_level: off`, no required checks; `branches?protected=true` → 0 |
| Force-push / deletion restriction, required PR, required reviews | none in effect |
| Required status checks | none — `CI Gate` (and now the Horizon check) are informational until the owner makes them required |
| Repo settings | public, **User-owned**; `allow_auto_merge: false`; squash/merge/rebase all allowed; `delete_branch_on_merge: false`; `allow_update_branch: false`; the session token reports `admin: true` yet branch-protection GET returns 403 (integration token) |
| CODEOWNERS | root `CODEOWNERS`: `* @safwan5001-source` + `/design-system/`, tokens; `codeowners/errors` → `[]`. Valid but inert — no rule requires Code-Owner review. `.github/**`, `scripts/ci-gate/**`, `scripts/horizon-eval/**`, `docs/autonomous-engineering/**` have no explicit owner line |
| Workflows registered | 14 repo workflows incl. `CI Gate`; **7 are registered from files that are not on `main`** (`AWJ translation migration`, 4× `One-shot POS …`, 2× `Patch …`; defined on other branches). Their write capability was not inspected here |
| `CI Gate` coverage of the 14 open PRs | #1381 in progress, #1359 success, **12 have no `CI Gate` run** (#1128 #1105 #1093 #1089 #853 #784 #778 #704 #703 #586 #578 #202) — same as V2-1C D7 |

**Unknown / not verifiable from this session** (proxy or token refuses; documentation is not treated as proof)

| Item | Why |
|---|---|
| Branch-protection details; Actions permissions / default token scope / "approve PRs" setting | HTTP 403 |
| Collaborators, installed Apps, environments, secrets, webhooks | proxy refuses |
| Whether a ruleset **can be created** with: *Restrict file paths*, *Require status checks (with GitHub Actions app pinned)*, *Require review from Code Owners*, *Block force pushes*, *Restrict deletions*, *Evaluate* mode, *Bypass list* | creating one is a write; the empty `GET` proves nothing about the feature set |
| Whether the owner can bypass a future ruleset, and how | depends on the bypass list the owner sets |
| Whether a **second identity** with write access exists (needed for any independent review) | collaborators not readable; V2-1B observed a single writer identity |
| Effect of *required checks* on the 12 PRs without a `CI Gate` run | untested |

## 9. Owner Decision Packet

Nothing below has been changed. Unanswered = nothing changes. Recommended default in **bold**. Suggested order: apply in *Evaluate* mode first (a ruleset in Evaluate mode records what it would block without blocking).

| # | Decision | Options | Recommendation and why |
|---|---|---|---|
| **D1** | **Required status checks** | (a) `CI Gate` only · (b) `CI Gate` + `Horizon dry-run evaluator (tests)` directly · (c) none | **(a), pinned to the GitHub Actions app.** The Gate already waits for the Horizon check (`always`), so (a) is one stable name; (b) adds defence in depth against a Gate bug at the cost of a second name to maintain. Gate: do D6 first or it deadlocks 12 PRs. |
| **D2** | **Required PR reviews / independent reviewer** | (a) require 1 approval now · (b) **require a PR, 0 approvals, until a second identity exists** · (c) nothing | **(b).** A personal repo has one human; GitHub does not let an author approve their own PR, so (a) either deadlocks or is bypassed by the owner every time. "Independent" needs a **second GitHub account with write access** (not the one Claude uses). Decide whether you will create one; until then reviews stay advisory and the Gate is the only machine control. |
| **D3** | **Protect `.github/**`, governance, authorization policy** | (a) ruleset *Restrict file paths* on `.github/**`, `scripts/ci-gate/**`, `scripts/horizon-eval/**`, `docs/autonomous-engineering/**`, `CODEOWNERS` · (b) explicit CODEOWNERS lines + *Require Code-Owner review* (needs D2's second identity) · (c) status quo | **(a) if the feature exists on your plan (unverified), else (b) after D2.** Without either, §7's "open" row stays open: a PR can edit the workflow and the tests together and pass. Today only review discipline protects these paths. |
| **D4** | **Force-push and deletion on `main`** | block both · allow | **Block both** (no workflow here needs them; feature-branch deletion is unaffected if the ruleset targets only the default branch). Zero operational cost. |
| **D5** | **Bypass and emergency recovery** | (a) bypass list = repository admin (you), "pull requests only" · (b) no bypass | **(a).** You stay able to recover. Emergency stop, in order: set the ruleset to *Disabled* (one click, Settings → Rules); revert a bad merge with `git revert` via PR; for autonomy there is nothing to stop yet — Auto-Merge is off, no grants exist, the evaluator cannot act. Write down who holds the admin credential; Claude has none of this power (403). |
| **D6** | **Open-PR compatibility** | (a) inventory and close/freeze the 12 PRs without a `CI Gate` run before D1 · (b) have each owner push once · (c) leave and accept they are blocked | **(a).** Required checks bind to the head SHA; those PRs never ran the Gate, so they would sit at "Expected — waiting". Only PRs that touch Horizon files will additionally need `Horizon dry-run evaluator (tests)` — it appears automatically on their next push/reopen because the merge ref carries the new workflow. Docs-only and unrelated PRs are **exempt** (the check is path-scoped, §3b). |
| D7 | Guard the contract-table and clean-tree steps too (they are not covered by the manifest guard) | later, separate PR | Duplicate-name/impostor hardening is **done** in §5b; this remaining item only extends `guard` coverage. |
| D8 | The seven workflows registered from other branches (`AWJ translation migration`, `One-shot POS …`, `Patch …`) | review / delete those branches or disable the workflows | **Inspect before any protection work:** they are outside this PR's scope but are exactly the kind of write-capable automation a ruleset on `.github/**` is meant to cover. |

**Not decided here and still gating any autonomy:** D2-authenticity (how an owner grant is proven authentic), policy-table approval, Zone A/B expansion. This PR expands neither.

## 10. Reviews

### Implementer
Wiring, gate-side tests, sabotage matrix (§4) and the two findings (§5, §6) done; every new guard has a test that fails when the guard is removed.

### Reviewer (independent, fresh-context, read-only subagent, on `b9b0f17`)
Ran the suites, extracted the workflow `run:` blocks under `bash -e`, injected skips / expected failures / `atexit` forgery, and built a sabotage matrix. 3 confirmed findings, all fixed in the follow-up commit:

| # | Sev | Finding | Resolution |
|---|---|---|---|
| 1 | **HIGH** | A gate self-test mutated the literal `MIN_TESTS=172`; after the floor was raised to 180 it failed, so **CI Gate would have gone red on every PR** (the self-tests run unconditionally in the Gate job). My mistake: I re-ran the gate suite before bumping the floor, not after. | The mutation now reads the live value. Both suites are now run after every edit. |
| 2 | LOW | `python -I` implies `-E`, so `PYTHONDONTWRITEBYTECODE` was ignored and `__pycache__` was written; it is gitignored, so the clean-tree step could not see it. | `-B` added; the clean-tree step uses `git status --porcelain --ignored`. |
| 3 | LOW | `contract_runner` exited 0 when zero cases were found (`all([])`). | Exits non-zero unless exactly 23 contract cases ran; test added. |

Reviewer-confirmed OK: triggers, permissions, no `${{ }}` injection surface, skip/expected-failure/`pipefail`/`atexit` handling, output parsing, gate binding (twin runs, other-app spoofing, workflow-ran-but-job-missing), `ci_gate.py` unchanged, rollout (no baseline entry on this PR → `compare_baseline` is empty; after merge it protects the entry).

**Allowed by `validate()` today — only owner review stands in the way** (carried to §7 / D3): lowering the `MIN_TESTS=` value; `|| echo` / `set +e` inside the step; a conditional that keeps the `!= "OK"` text but is dead; a decoy step that holds the guard strings while the real step evades the substring (e.g. double space); `shell: sh`, `timeout-minutes: 1`, an unusable `runs-on`; removing the contract-table or clean-tree steps (not guarded); a **duplicate job with the same name** in another PR-triggered workflow (**fixed afterwards, §5b**, after Codex rated it P1); and a test module in `scripts/horizon-eval` that monkeypatches `unittest` result classes at import time (rc 0, final line `OK`). The contract-table step is a second, independent signal for the last one — it does not go through `unittest`.

### AWJ Guardian
- No ledger, journal, tax, ZATCA, RBAC, tenant, migration or API surface touched; no financial operation, so no journal entry is produced.
- The job has no secrets, no network, `contents: read`; it cannot merge, push, comment or change a setting.
- Evaluator behaviour is untouched (only a read-only collector's argument check tightened).
- Zone A/B not expanded; no grant issued; Auto-Merge/Ruleset/Protection untouched.

### PRE_MERGE_REVIEW
Reviewed code head `94c5d063caf858eb51059fc443e90b4edf36e2a1` (docs-only commits may follow it; the final head is in the PR comment). Scope = the 11 files in §2, no application/accounting/RBAC/tenant/migration/API path. CI green on that exact SHA (§11). Reviewer findings (3) and Codex findings (3: P1, P2, P1) all fixed with tests and resolved; Codex's last pass on `94c5d06` found nothing. No merge conflict (`git merge-tree` against current `main` is clean). **Merge is an owner decision.**

## 11. CI

Code head `94c5d063caf858eb51059fc443e90b4edf36e2a1`:

| Check | Event | Check-run ID | Result |
|---|---|---|---|
| CI Gate | pull_request | 115382643285 | ✅ (15:45 → 16:17, waits for the php suites) |
| Horizon dry-run evaluator (tests) | pull_request | 115382637779 | ✅ (13 s) |
| Horizon dry-run evaluator (tests) | push | 115382601977 | ✅ |
| php artisan test (L11, sqlite) | pull_request / push | 115382638352 / 115382602149 | ✅ / ✅ |
| php artisan test (L11, pgsql) | pull_request / push | 115382637662 / 115382602816 | ✅ / ✅ |

Workflow runs: Horizon Eval CI `38422331403` (PR) / `38422321550` (push) · CI `38422331402` / `38422321474` · CI Gate `38422331421`.

History worth knowing: the Gate run on `b0b23d5` failed with `stale gate: PR head is now …` — the designed abort when a newer push lands, not a test failure. Earlier heads' runs were superseded by the review-fix pushes. The Gate on this PR ran the **base** gate script (by design), so §5b's binding protects PRs only after merge; the new gate tests (66) were run locally and in the Gate's own "Gate self-tests (PR copy)" step.

`main` has moved by 1 commit since the base (`704a7ef`), touching none of this PR's paths; not merged in, to avoid restarting CI.

## 12. Rollback

Revert the PR (`git revert -m 1 <merge>` via a PR). That removes the workflow and the manifest entry together; the gate self-tests revert with them, so the Gate returns to exactly its pre-PR behaviour. If a ruleset was created that **requires** `Horizon dry-run evaluator (tests)` by name, switch it to *Disabled* (or drop that check) **before** reverting, otherwise PRs wait for a check that no longer exists. Nothing else depends on this PR.

## 13. Git state

- Branch: `horizon/v2-1d-ci-integration`
- PR: #1382
- Base SHA: `704a7efe1f5aabdd4ba3cb8b92394510446261e7` (`main` has since advanced; clean merge)
- Code head SHA: `94c5d063caf858eb51059fc443e90b4edf36e2a1` (CI-verified, §11). Final head SHA: see the PR delivery comment (a docs-only commit records this very section).

## 14. Next step

Owner decisions D1–D6 (§9), starting with D6 (inventory the 12 PRs) and D3 (how `.github/**` and the evaluator are protected). Then, and only then, a ruleset in *Evaluate* mode. No autonomy is activated by this PR.
