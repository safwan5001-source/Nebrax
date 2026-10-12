# AWJ-HORIZON-V2-1C — Practical Autonomy Pilot (dry-run evaluator) — Implementation Report

STATUS: `@@VERDICT_LINE@@`
DATE: 2026-10-12
SCOPE: dry-run only. **No merge, no deploy, no Ruleset/Protection/Auto-Merge/permission change, no grant issued, no other Horizon touched, no V2-4.** `ELIGIBLE_SIMULATED` is a statement about decision logic over synthetic fixtures, never permission to merge.

## 1. Executive verdict — `@@VERDICT@@`

@@VERDICT_BODY@@

## 2. Git state

| Field | Value |
|---|---|
| Branch | `horizon/v2-1c-dryrun-authorization-evaluator` (new, independent, from latest `origin/main`) |
| PR | @@PR@@ |
| Base SHA (`origin/main` when the PR was opened) | @@BASE@@ |
| Final Head SHA | @@HEAD@@ (the report cannot contain the hash of the commit that contains it; the PR description and the delivery comment carry the exact SHA) |
| Last confirmed #1346 merge SHA | `6532c0c9df1a769c72b07edbc5e48912b01a1950` (confirmed on `main`) |

## 3. G1 — GitHub readiness (read-only, 2026-10-12)

Method: `gh api` GET requests through the session proxy, nothing written. Anything the proxy or token refused is listed as unverifiable — no setting is inferred from documentation alone.

### 3.1 Verified directly on this repository

| Item | Observation |
|---|---|
| Rulesets | `GET /rulesets` → `[]` (endpoint reachable; none defined) |
| Rules applying to `main` | `GET /rules/branches/main` → `[]` |
| Branch protection | `main`: `protected:false`, `enforcement_level:"off"`, `checks:[]`; `branches?protected=true` → `[]` |
| Force-push / deletion restriction | none (no ruleset, no protection) |
| Required status check `CI Gate` | **not required**; `CI Gate` runs as an informational check on `pull_request` |
| Require PR | not enforced (V2-1B measured: last 40 commits all came through PRs) |
| Auto-merge · update-branch · delete-branch-on-merge | all `false` (`allow_auto_merge:false`) |
| Merge methods | squash, merge-commit and rebase all allowed |
| Repo kind | public, owned by a **User** (not an organisation) |
| CODEOWNERS | `* @safwan5001-source`; `codeowners/errors` → `[]` (valid but inert: no rule requires Code-Owner review) |
| Commit signatures on `main` | last 8 commits: `verified:true, reason:valid`, **committer = GitHub** (web-flow), author = the owner account → the Verified badge on `main` is produced by GitHub's own key and proves nothing about owner intent (confirms V2-1B §4.6) |
| `CI Gate` coverage of open PRs | 14 open PRs; **only #1349 and #1348 have a `CI Gate` check run; 12 have none** → if `CI Gate` became required, those 12 would sit at "Expected — waiting" until a new push (V2-1B D7) |
| Check-run twins | live on #1349: `php artisan test (L11, sqlite/pgsql)` and `web build (Next.js)` each appear twice (one from the `push` workflow run, one from `pull_request`); the event is only recoverable via `actions/runs` (readable) → twin handling is required, not hypothetical |
| Parallel horizons right now | #1349 (CUST-HV V10b) active; #1348 (Media Storage S6) **merged by another session during this one** (`main` moved `6532c0c → 11abda9`) and #1350 (Media Storage S7) opened — a live demonstration of the "main moved after testing" case (T3) |

### 3.2 Not verifiable from this session (proxy/token refused or API cannot answer)

| Item | Why |
|---|---|
| `branches/main/protection` details | HTTP 403 `Resource not accessible by integration` |
| Actions permissions / default workflow token permissions / "allow Actions to approve PRs" | proxy: *Access to this GitHub Actions path is not permitted* |
| Collaborators, installed Apps, environments, webhooks, secrets | proxy refused |
| Whether a ruleset **can be created** here with: *Restrict file paths*, *Require signed commits*, *Require review from Code Owners*, *Evaluate* enforcement, *Bypass actors* options | the GET endpoint answering `[]` does not prove the feature set; documentation is not proof for this repo/plan (instruction) |
| Effect of *Require signed commits* with the current "Squash and merge" flow | untested |
| Whether the owner account can bypass a future ruleset | unknown; documentation says admins bypass unless prevented |
| "Required reviewers" | per documentation not offered on user-owned repositories (not verified here) |

### 3.3 Owner Decision Packet for G1 — only what is needed

Screenshots (no settings to change):
1. **Settings → Rules → Rulesets → New branch ruleset** (stop before saving): the list of available rules, the *Enforcement status* options, and the *Bypass list* options.
2. **Settings → Actions → General**: *Workflow permissions* and *Allow GitHub Actions to create and approve pull requests*.
3. **Settings → Collaborators and teams** (to confirm there is a single writer identity).

Choices (recommended default in bold; unanswered = nothing changes):
- D7 — the 12 PRs without a `CI Gate` run: **inventory and close/freeze before any "required check"**; otherwise push an empty-diff-free update from each owner.
- D3 — "Require branch up to date": **off at G3; the evaluator checks the base** (`BASE_MOVED_RETEST`, observed for real this session).

## 4. What was built

A pure, offline, deterministic evaluator of the V2-1B §4.2 algorithm, with a read-only evidence collector and an idempotent audit ledger. Nothing in it can act.

| File | Role |
|---|---|
| `scripts/horizon-eval/horizon_eval.py` | evaluator + CLI. Strict schema → default-deny classification → grant/authenticity → scope → parallel-horizon conflicts → PR/CI/head/base/review checks → decision. No network/process/env/write capability. |
| `scripts/horizon-eval/policy/zone_policy.v1.json` | versioned Zone A/B/C/P path table, surfaces, hard-deny list, CI floor, windows. Editing it is Zone C. |
| `scripts/horizon-eval/ledger.py` | local idempotent audit store (pending marker → atomic commit; integrity-hashed records). |
| `scripts/horizon-eval/contract_runner.py` | loads the 23 contract fixtures (base + overlay), prints the PASS/FAIL table. |
| `scripts/horizon-eval/collect_snapshot.py` | **GET-only** `gh api` collector → `live` snapshot of one PR. |
| `scripts/horizon-eval/fixtures/synthetic/**` | 2 base cases + 25 overlay cases. Every file carries `SYNTHETIC` notice; grants are `GR-SYNTHETIC-*`. The only place a grant-like file exists. |
| `scripts/horizon-eval/snapshots/**` | 5 frozen read-only snapshots of real PRs (#1349, #1350, #1346, #586, #1093; patches omitted, so code files read `PATCH_UNAVAILABLE`). |
| `scripts/horizon-eval/test_*.py` (4 files) | unit · contract + exhaustive mutation · static guards · live-snapshot validation |
| `scripts/horizon-eval/README.md` | minimal usage |
| this report | |

Not modified: application code, accounting services, migrations, APIs, `.github/**` (no CI workflow), `scripts/ci-gate/**`, any other Horizon branch or document.

### 4.1 Decision model

`STOP_OWNER_DECISION > BLOCK > WAIT > ELIGIBLE_SIMULATED` (most restrictive reason wins; all reasons are still reported, each with a stable code).

- **Eligible requires**: zero WAIT/BLOCK/STOP reasons **and** synthetic mode **and** an explicit opt-in. A final invariant re-checks this and downgrades to `BLOCK` otherwise.
- **Live mode can never be eligible**: no independent owner-authenticity verifier exists (V2-1B §4.6 / D2), so `GRANT_AUTHENTICITY_UNVERIFIED` is unconditional. A GitHub Verified badge, a commit signature, or any self-asserted evidence field is explicitly ignored (`GITHUB_BADGE_IGNORED`).
- **Synthetic mode** accepts only fixtures that are marked synthetic, live under `fixtures/synthetic/`, are verified by `synthetic-test-verifier`, assert all six §4.6 conditions, and whose content hash matches the "signed" hash. Synthetic grants in live mode, and live evidence relabelled synthetic, are both refused.
- **Fail-closed inputs**: any missing/ill-typed field → `INPUT_INVALID` (BLOCK); unknown grant fields rejected; any internal exception → `EVALUATOR_ERROR` (BLOCK); unknown path → Zone C; unsafe path (`..`, `//`, backslash, control chars) → BLOCK; protected paths are matched **case-insensitively** (case-colliding `Docs/Autonomous-Engineering/`); behaviour analysis can only raise a zone; missing patch for code is not assumed safe.
- **Time**: the CLI binds `now` to the wall clock (>5 min skew → `CLOCK_SKEW`); `--replay` is the explicit opt-out for frozen snapshots.
- **Parallel horizons (read-only)**: path overlap and semantic-surface overlap (e.g. PHP tokens normaliser vs TS twin share no file but share `S-TOKENS-CONTRACT`); observed evidence beats reported (a claim can raise but never shrink what GitHub shows; "paused" is ignored when activity is observed); unregistered/unclaimed overlap → `STOP` (ownership never inferred from branch names); stale observation → `WAIT`; claim-order ties serialise. No write to any other branch is possible.
- **Audit record**: whitelisted fields only (decision, reason codes, zone basis, per-file zones, grant id/hash, check names/ids/conclusions, review verdicts, SHAs, idempotency key, evidence digest, `would_merge:false`, `tool_calls` zeros). PR title/body/comments are **never copied**; details are sanitised; secret-like output withholds the record (`AUDIT_REDACTION_TRIGGERED`).
- **Recovery**: `record_id = sha256(idempotency_key(horizon, task, head_sha, action) + evidence_digest)`. Same evidence → replay (no duplicate); new evidence for the same key → new record; interrupted run → pending marker found and cleared; torn/corrupted record → ignored and re-evaluated; a merged PR → `PR_ALREADY_MERGED` + `resume_phase: POST_MERGE_VERIFY` (GitHub state beats the handoff narrative).

## 5. Tests — exact results

Command: `PYTHONDONTWRITEBYTECODE=1 python3 -I -m unittest discover -s scripts/horizon-eval` (stdlib only).

| Layer | File | Tests | Result |
|---|---|---|---|
| 1. Focused evaluator unit tests (incl. 34 review-finding regressions) | `test_horizon_eval.py` | 120 | OK |
| 2. Contract + regression + mutation | `test_contract.py` | 12 | OK |
| 3. Representative read-only repository evidence | `test_live_snapshots.py` | 8 | OK |
| Static guards (no capability, fixture isolation) | `test_static_guards.py` | 19 | OK |
| **Total** | | **159** | **OK, 0 failures, 0 errors** |

Fail-closed evidence beyond the contract table:
- **472 single-input mutation points** (two eligible bases: A and B) — each element deleted, nulled, and type-swapped; none stays eligible except a reviewed harmless list (free-text/optional elements) — this found a real gap (manifest lacking a required check) fixed with the policy `ci_floor`.
- **Sabotage run**: 23 deliberate defects injected into the evaluator (ignore CI conclusion, accept live authenticity, drop default-deny, ignore injection, accept grants from branches, ignore expiry, push-twin counted, rename ignored, action gate dropped, drop the presentational allowlist, self-asserted registration, COMMENTED clears change request, `+++` lines skipped, author check dropped, ledger context ignored, …) → **22/23 caught**; the survivor (dropping the app filter for same-named checks) is masked by a second, independent defence (`CI_CHECK_WRONG_APP` BLOCK) — redundancy, not a hole.
- Adversarial review (section 8) findings are listed with their resolution.

Contract table (11 scenarios / 23 cases + 2 extras), all PASS, **false-eligible = 0**:

| case | expected | got | result | blocking reasons |
|---|---|---|---|---|
| DR-01 | ELIGIBLE_SIMULATED | ELIGIBLE_SIMULATED | PASS |  |
| DR-02 | WAIT | WAIT | PASS | INDEPENDENT_REVIEW_MISSING |
| DR-03 | STOP_OWNER_DECISION | STOP_OWNER_DECISION | PASS | ZONE_C_OWNER_GATED |
| DR-04a | BLOCK | BLOCK | PASS | CI_CHECK_NOT_SUCCESS |
| DR-04b | WAIT | WAIT | PASS | CI_CHECK_PENDING, CI_CHECK_PENDING |
| DR-04c | BLOCK | BLOCK | PASS | CI_CHECK_NOT_SUCCESS |
| DR-05a | BLOCK | BLOCK | PASS | HEAD_NOT_IN_COMMITS, HEAD_SHA_CHANGED_AFTER_REVIEW, CI_CHECK_MISSING, CI_CHECK_MISSING, CI |
| DR-05b | WAIT | WAIT | PASS | CI_CHECK_PENDING |
| DR-05c | WAIT | WAIT | PASS | BASE_MOVED_RETEST |
| DR-06a | BLOCK | BLOCK | PASS | GRANT_EXPIRED |
| DR-06b | BLOCK | BLOCK | PASS | GRANT_REVOKED, KILL_SWITCH_ACTIVE |
| DR-06c | BLOCK | BLOCK | PASS | GRANT_FROM_UNTRUSTED_ORIGIN, NO_ACTIVE_GRANT |
| DR-07a | STOP_OWNER_DECISION | STOP_OWNER_DECISION | PASS | CONFLICT_EXCLUSIVE_SURFACE, ZONE_C_OWNER_GATED |
| DR-07b | STOP_OWNER_DECISION | STOP_OWNER_DECISION | PASS | CONFLICT_POLICY_STOP, CATEGORY_PATH_MISMATCH, CI_CHECK_NEVER_STARTED |
| DR-07c | STOP_OWNER_DECISION | STOP_OWNER_DECISION | PASS | UNREGISTERED_HORIZON_ACTIVE, TASK_NOT_ALLOWLISTED, ZONE_EXCEEDS_CATEGORY, ZONE_NOT_IN_GRAN |
| DR-08a | STOP_OWNER_DECISION | STOP_OWNER_DECISION | PASS | HARD_DENY_PATH, ZONE_C_OWNER_GATED, CATEGORY_PATH_MISMATCH |
| DR-08b | STOP_OWNER_DECISION | STOP_OWNER_DECISION | PASS | CI_STEP_HOLLOWING_SUSPECTED, HARD_DENY_PATH, ZONE_C_OWNER_GATED, CATEGORY_PATH_MISMATCH |
| DR-08c | STOP_OWNER_DECISION | STOP_OWNER_DECISION | PASS | HARD_DENY_PATH, ZONE_C_OWNER_GATED, CATEGORY_PATH_MISMATCH |
| DR-08d | STOP_OWNER_DECISION | STOP_OWNER_DECISION | PASS | HARD_DENY_PATH, HARD_DENY_PATH, HARD_DENY_PATH, ZONE_C_OWNER_GATED, CATEGORY_PATH_MISMATCH |
| DR-09a | BLOCK | BLOCK | PASS | PR_ALREADY_MERGED |
| DR-09b | ELIGIBLE_SIMULATED | ELIGIBLE_SIMULATED | PASS |  |
| DR-10 | STOP_OWNER_DECISION | STOP_OWNER_DECISION | PASS | INJECTION_SUSPECTED |
| DR-11 | STOP_OWNER_DECISION | STOP_OWNER_DECISION | PASS | HARD_DENY_PATH, ZONE_P_NEVER_AUTONOMOUS, CATEGORY_PATH_MISMATCH |
| X-01 | ELIGIBLE_SIMULATED | ELIGIBLE_SIMULATED | PASS |  |
| X-02 | BLOCK | BLOCK | PASS | GRANT_AUTHENTICITY_UNVERIFIED, SYNTHETIC_GRANT_IN_LIVE_MODE |

contract cases: 23 in 11 scenarios · pass 23/23 · extra cases: 2 · false-eligible: 0

`php artisan test` was **not** run locally: the change contains no PHP/application/DB/API code. The repository's full PHP matrix runs in PR CI (section 7).

## 6. Mapping against the 11 scenarios / 23 cases

| # | Scenario | Cases | Fixture | Result |
|---|---|---|---|---|
| DR-01 | Zone A eligible (simulated) | 1 | `DR-01` | `ELIGIBLE_SIMULATED`, `would_merge:false`, audit fields complete |
| DR-02 | Zone B extra evidence | 1 | `DR-02` (+ extra `X-01` positive path) | `WAIT` — independent reviewer missing; with all extras present → `ELIGIBLE_SIMULATED` |
| DR-03 | Financial change = Zone C | 1 | `DR-03` | `STOP_OWNER_DECISION` (`ZONE_C_OWNER_GATED`) even with an active A+B grant |
| DR-04 | CI failed / pending / cancelled | 3 | `DR-04a-c` | `BLOCK` / `WAIT` / `BLOCK` (skipped, neutral, timed_out, … covered in unit tests) |
| DR-05 | Head changed / push-twin / base moved | 3 | `DR-05a-c` | `BLOCK` (review invalidated) / `WAIT` (twin ignored) / `WAIT` (`BASE_MOVED_RETEST`) |
| DR-06 | Grant expired / revoked / forged | 3 | `DR-06a-c` | `BLOCK` ×3 (kill-switch + revoked id; branch-origin grant ignored) |
| DR-07 | Parallel horizons | 3 | `DR-07a-c` | `STOP` ×3 (exclusive surface; semantic overlap with no shared file; unregistered recent activity) |
| DR-08 | Gate/governance tampering | 4 | `DR-08a-d` | `STOP_OWNER_DECISION` ×4 under a **hostile grant allowing `**`** |
| DR-09 | Recovery | 2 | `DR-09a-b` | `BLOCK` + `POST_MERGE_VERIFY` (merged, handoff wrong) / replay with exactly 1 ledger record |
| DR-10 | Prompt injection | 1 | `DR-10` | `STOP_OWNER_DECISION` + `INJECTION_SUSPECTED`, classification unchanged |
| DR-11 | Production | 1 | `DR-11` | `STOP_OWNER_DECISION` (`ZONE_P_NEVER_AUTONOMOUS`) |

Deviations from the V2-1B contract (all in the conservative direction):
1. `ELIGIBLE_WITH_EXTRA_VERIFICATION` is not an output (mission allows four); Zone B returns `ELIGIBLE_SIMULATED` only when regression-test, Guardian and a genuinely independent reviewer attestations are present, otherwise `WAIT`.
2. DR-07a uses `S-ATTACH-STORAGE` (a Zone B surface) instead of `S-FIN-CONTROLLERS`: files on the latter are Zone C and would stop for path reasons, hiding whether conflict detection works. The `S-FIN-CONTROLLERS` overlap is a separate unit test that asserts both reasons.
3. DR-07 conflicts return `STOP` under the default `conflict_policy: stop`; `serialize` yields `WAIT` (unit-tested). Any overlap also lifts the context zone to ≥ B (per §3.2), so an A-only grant cannot cover an overlapping PR.
4. DR-05c returns `WAIT` (D3 default: the evaluator checks the base), not `BLOCK`.
5. "Tool log proves no merge call" is structural: the evaluator has no tool access; the record's `tool_calls` are constant zeros and `test_static_guards.py` fails on any network/process/env/write/merge symbol.
6. DR-09b "dedupe comment" is modelled as the ledger replay plus an author-checked audit-comment marker (`audit_comment.already_posted`), since nothing is posted.

## 7. CI

@@CI@@

## 8. Reviews

### 8.1 Implementer self-review
Scope stayed inside `scripts/horizon-eval/**` + this report. Defects found by my own tests and fixed before review: a required check missing from the evidence manifest left a case eligible (→ policy `ci_floor`); the evaluator trusted `now` from the evidence (→ CLI binds to the wall clock, `CLOCK_SKEW`); case-colliding protected paths (→ case-insensitive match for Zone C/P and hard-deny); claim-order ties did not serialise.

### 8.2 Reviewer — independent adversarial review (fresh-context subagent, read-only)
Same GitHub identity as the author, so this is **not** an "independent reviewer" in the V2-1B §3/T2 sense; it is an extra adversarial pass. It reproduced **false-eligible results** against the first pushed version (`09aac33`). All were treated as blocking and fixed in this PR, each with a regression test (`ReviewerFindings`, 24 tests):

| # | Finding (severity) | Resolution |
|---|---|---|
| 1 | `+++…` content lines skipped by the scanners (blocker) | every `+` line is content; regression for behaviour and injection scans |
| 2 | JS-only token denylist trivially evaded; added tests/PHP unscanned; pure deletions ignored (blocker) | Zone A UI code now requires a **positive presentational allowlist** on added *and* removed lines; broader C/B token sets; removed lines scanned; added-test files with dangerous APIs leave Zone A |
| 3 | all of `web/src`, `storefront/src` treated as UI (high) | narrowed to component/module/app dirs; `lib/`, `middleware`, `auth`, `app/api` → Zone C |
| 4 | horizon registration self-asserted from PR text (high) | registration needs registry entry **and** branch prefix; own PR needs registered `owner_agent`, branch prefix |
| 5 | no author/fork/commit-author check (high) | head repo = base repo = requested repo; PR and every commit author ∈ registry `authors` |
| 6 | a COMMENTED review erased CHANGES_REQUESTED (high) | only APPROVED/DISMISSED clear it |
| 7 | independence case/format-sensitive (high) | identities normalised (case, `[bot]`, whitespace) against author, agents, registry owner/authors |
| 8 | 300-char display truncation let long paths dodge `paths_deny` (medium) | allow/deny/hard-deny match the **raw** filename; display only is sanitised |
| 9 | ledger replay ignored flags/clock/policy; lone surrogates collapsed digests (high) | record identity now includes `allow_synthetic`, clock binding + skew outcome, policy hash; ASCII-safe canonical JSON; unhashable input never persists or replays; replayed ELIGIBLE must be self-consistent |
| 10 | same-named check from another app masked a failure (medium) | only `github-actions` runs count; a non-Actions duplicate of a required name is a BLOCK |
| 11 | low items: rename without previous name, trailing-dot dirs, nested governance glob, case-sensitive overlaps, dropped renames, future timestamps, head ∉ commits, revoked sibling grant, zero-file PR, surrogate `task_id` raising | all fixed with tests |
| 12 | unkeyed ledger hash can be forged (low) | documented: detects corruption, not forgery; replay re-validates plausibility; the ledger authorises nothing |
| 13 | collector truncated text before scanning (medium) | truncation is marked (`[[TRUNCATED]]` → BLOCK); oversize patches become unassessable (→ Zone B) |
| residual | web/storefront CI was never *required* | files under `web/**` / `storefront/**` now require the matching check (policy `required_when_touched`); `docs/engineering/**`, `AGENTS.md`, ADRs are Zone C |

### 8.2b Codex automated review on PR #1351 (round 1: 3 findings on `a272dc0`; round 2: 3 findings on `96d346d`; round 3: 3 findings on `8d22cf7`; round 4: 2 findings on `3294f3b`; all valid, all fixed)
| Severity | Finding | Resolution |
|---|---|---|
| P1 | backend monetary tokens (`amount`, `total`, `price`, `invoice`, …) only raised to Zone B → `$amount * 2` stayed eligible under a B grant | monetary tokens in non-UI code → **Zone C** (`BEHAVIOR_MONETARY_TOKEN_IN_BACKEND`); UI keeps B |
| P1 | presentational allowlist accepted JSX expression containers (`disabled={!isAdmin}`) | braces removed from the allowlist (JSX expressions are runtime code) |
| P2 | collector mis-parsed paginated object responses (`check-runs`) | `gh api --paginate --slurp` + `flatten_pages()` for array and object pages (tested) |

Round 2 (`96d346d`):

| Severity | Finding | Resolution |
|---|---|---|
| P1 | token-free numeric edit (`0.15 → 0.25`) in a financial helper stayed Zone B | financial **path words** (`invoice`, `tax`, `price`, `vat`, `payment`, `fee`, … matched as words, so `Syntax` ≠ `tax`) under code roots → Zone C regardless of the diff |
| P1 | `<button type="submit">` passed the character allowlist | Zone A markup is now **structural**: only safe elements (no `a/button/input/form/select/img`, no components) with whitelisted literal attributes (`className, aria-label, alt, title, placeholder, lang, dir, …`) plus plain text; lone boolean-attribute lines (`disabled`) rejected |
| P1 | another PR counted as "registered" from self-reported horizon + branch | registration also requires the other PR's head repo = requested repo and its author ∈ registry `authors` (collector now captures both) |

Round 3 (`8d22cf7`) — the findings shared one root cause: *generic `app/**` was Zone B, so every missing token/vocabulary entry became a false-eligible path*. The fix is structural:

| Severity | Finding | Resolution |
|---|---|---|
| P1 | missing/oversize patch on an already-Zone-B backend file stayed eligible | uninspectable code patch → `PATCH_UNAVAILABLE` **BLOCK** (no zone bound is assumed) |
| P1 | `Role.php`, `StoreRoleRequest.php`… fell to generic Zone B (`return true;` in `grants()`) | generic `app/**` is **no longer Zone B**: unlisted backend paths are default-deny Zone C; Zone B is only the explicit bounded subtrees (`app/Services/DocumentCenter/**`, the tokens/presentation files, tests, bounded UI). RBAC/policy/provider/user/tenant/role/permission implementations are explicit `S-RBAC-TENANT` Zone C |
| P1 | financial vocabulary lacked `expense`, `cost`, … | vocabulary extended (expense, cost, margin, revenue, purchase, cash, bank, custody, gosi, loan, inventory, stock, …) and now explicitly **defence in depth only**; completeness is no longer the guard |

Round 4 (`3294f3b`):

| Severity | Finding | Resolution |
|---|---|---|
| P1 | `pr.base_sha == main.sha` can both be fresh while checks ran against an older merge ref | every counted run must carry the base it was **tested** against (collector reads it from the workflow run's `pull_requests[].base.sha`); mismatch → `CI_TESTED_AGAINST_OLDER_BASE` (WAIT), unknown → `TESTED_BASE_UNKNOWN` (BLOCK) |
| P1 | claim validated from the body only | exact `horizon:<id>` label required and no contradictory `horizon:*` label (V2-1B §6.3: branch + label + claim block) |

Known limit of the allowlist: a plain-text line is indistinguishable from an attribute line in multi-line JSX beyond the boolean-attribute list; the allowlist is deliberately narrow (labels/text), and anything it does not recognise falls to Zone B, never A.

Residual risks the reviewer listed that are **not** closed (declared in §11): unauthenticated attestations; test code executes in CI; symlinks/file modes invisible in the files API; injection regexes are defence-in-depth (paraphrase/homoglyph can evade; classification never depends on text); `head_pushed_at` is the author-controlled commit date; no semantic check of `approved_outcome`.

### 8.3 AWJ Guardian
Accounting/tax/ZATCA: no effect, no journal entries. Tenant/branch isolation and RBAC: untouched; no tenant data in code, fixtures or snapshots. Security: no secrets; no credential, no permission, no workflow; collector is GET-only and statically guarded. GitHub settings: untouched (read-only probes). Other horizons: no branch, file or claim touched. V2-2/V2-3/V2-4: not started.

### 8.4 PRE_MERGE_REVIEW
`@@PMR@@` This is a verdict about the pilot PR only; it is **not** an authorisation to merge (the PR touches a Zone C directory and needs the owner).


## 9. Evidence: verified vs assumed vs unavailable

| Verified directly (this session) | Assumed / modelled | Unavailable |
|---|---|---|
| `main` SHA, branch/ruleset state, merge settings, CODEOWNERS validity, commit-signature provenance, open-PR list and per-PR file lists, check runs and their workflow-run events, the CI Gate manifest on `main`; evaluator behaviour (127 tests, sabotage run) | Attestations (PRE_MERGE_REVIEW, Guardian, regression, independent) are agent-recorded evidence with **no authenticity channel** (same open problem as D2); the horizon registry and grants directory do not exist on `main` yet (fixtures only); `head_pushed_at` is approximated by the head commit date; `pull.base.sha` can lag the real base tip (errs toward `WAIT`); several surface path patterns (`S-TOKENS-CONTRACT`, `S-PRESENTATION`, `S-NAV-I18N`) are my reading of repository paths and need owner approval (D1) | Actions settings, collaborators, secrets/environments, ruleset creation capabilities, bypass behaviour, plan features (section 3.2) |

## 10. Security / tenant / accounting impact

- **Accounting / tax / ZATCA / RBAC / tenant isolation / migrations / APIs:** none touched. No financial operation → no journal entries to tabulate.
- **Tenant data / secrets:** the evaluator and ledger never read secrets or tenant data; snapshots hold public PR metadata with **patches omitted** (an earlier raw snapshot of #1348 contained a test literal shaped like an AWS key id; it was discarded, not committed, and #1348 was replaced by #1350).
- **Security posture:** adds a deny-by-default decision library that nothing invokes; no workflow runs it; no permission is granted. Risk of the PR itself ≈ nil; risk it models is described in V2-1B.
- **Backward compatibility:** purely additive under a new directory.

## 11. Remaining risks, blockers, owner decisions

Blockers / gaps (not silently expanded):
1. **Tests are not wired into CI.** Doing so edits `.github/**` (Zone C, forbidden here). Follow-up: add `python -m unittest discover -s scripts/horizon-eval` next to the existing gate self-tests — owner-reviewed PR.
2. **Authenticity (D2) is unresolved**; therefore live mode is permanently non-eligible and attestations are unauthenticated.
3. **Policy table not approved (D1)** and default-deny already makes many ordinary files Zone C: e.g. root-level `AWJ-HORIZON-*-REPORT.md` files (seen in #1348) match no rule. Deliberate until the owner extends the table.
4. `approved_outcome` ↔ PR-intent match is not automatable → listed in `human_checks_remaining` of every record.
5. 12 of 14 open PRs never ran `CI Gate` (D7).
6. S12/S13 (gate hollowing) remain open until G4; the evaluator treats those paths as owner-gated by policy only.

### Decision packet (consequential decisions only; nothing activated)

| # | Decision | Recommended safe default |
|---|---|---|
| 1 | **GitHub protections that actually exist** | Provide the 3 screenshots (§3.3). Until then assume **none**; do not enable anything on documentation alone. Then G2 (guard-only ruleset: block force-push/deletion), rollback drill, G3 (PR + `CI Gate`, 0 approvals). |
| 2 | **Reviewer/bot identity and gate-file protection** | Create a second identity (GitHub App/bot account) as reviewer; CODEOWNERS + Code-Owner review for `.github/**`, `scripts/ci-gate/**`, `scripts/horizon-eval/**`, future `grants/` and `registry/`. Use *Restrict file paths* only if the screenshot shows it. Until then these paths stay Zone C by policy. |
| 3 | **Owner-authorization authenticity** | Minimum = V2-1B §4.6 option (a): hardware-key signing, key fingerprint registered out-of-band, `allowed_signers` pinned on `main`, signature bound to file hash, web-flow signatures excluded, revocation path — plus a **verifier outside agent sessions**. Never the Verified badge. Later add (b) bot identity. Until then: owner merges per PR, as today. |
| 4 | **Up-to-date branch strategy** | Do not require "up to date" at G3; keep the evaluator's base check (it fired for real this session). Revisit with CI-cycle data (~25–40 min per cycle). |
| 5 | **Conditions for a limited Zone A pilot with real merges** | (i) G1 table verified, G3 stable ≥ 2 weeks; (ii) evaluator + tests running in CI read-only; (iii) D2(a) verifier live and a first real grant signed; (iv) grant: Zone A `docs-nongov` only, ≤ 48 h, ≤ 1 merge/day, 1 open PR, ≤ 8 files / 200 lines, named agent; (v) owner shadow-reviews the first N PRs; (vi) rollback + kill-switch drills passed; (vii) explicit separate "V2-4" decision. |
| 6 | **Rollback / emergency stop** | In order: (a) the owner's words "stop merging" in the session stop the agent immediately; (b) set the grant `revoked`/add the kill-switch on `main` (the evaluator re-fetches before every action); (c) Ruleset → *Disabled* in the UI; (d) fix-forward revert PRs, never history rewrites. With no grants issued, there is nothing to stop today. |

## 12. Rollback plan for this PR

Purely additive: revert the merge commit (or close the PR before merge). Nothing imports, schedules or executes it; no CI, runtime, data, setting or grant depends on it. Delete local ledger directories if any were created (they live outside the repository).

## 13. Exact next step

Owner review of this PR (Zone C directory: owner-gated by the model's own rules), then: screenshots for G1 and decisions D1–D3/D7 → a small follow-up PR that wires the tests into the CI Gate self-test step. **V2-2, V2-3 and V2-4 have not started.**
