# AWJ — AI Permission Labels Fix (Report)

| | |
|---|---|
| Branch | `claude/awj-ai-permission-labels` |
| PR | https://github.com/safwan5001-source/Nebrax/pull/1550 (targets `main`; **not merged**) |
| Base SHA | `336284170ea6a044ee745fda2f1c844e161215cf` (`origin/main`, #1546 AI-01) |
| Code head | `02ab424de0a628ecaeaf429abf4660f3d61f8a9b` |
| Final head | the commit adding this CI update (docs-only; shown on the PR) |

## Problem
PR #1546 (AI-01 Secure AI Gateway) added the server permission `ai.assistant.use` to `app/Support/Rbac.php`. The web role editor needs a label for every **module**, **action** and **area** of every server permission; `web/src/modules/roles/catalog.test.ts` ("permission label coverage") guards that, in English and Arabic. The labels for `ai` / `use` / `assistant` did not exist, so two tests failed (`en` and `ar`) and the `web build (Next.js)` job and CI Gate went red on any PR touching `web/`. `main` itself had not run the web job since #1546 (backend-only diff), so it went unnoticed.

## Investigation
- Catalogue source: `Rbac::PERMISSIONS` (the key appears at `Rbac.php:215`, and in the owner default role at `:43`); the test parses it as `module.area.action`.
- Label structure: `web/src/messages/{en,ar}.json` → `hr.perm_modules`, `hr.perm_actions`, `hr.perm_areas` (flat key → label maps). The role editor renders a permission as *module — area — action* (e.g. "Point of sale — Audit — Export"); new entries in earlier changes were appended at the end of each map (…`operate`, `publish`, `reassign`), so I followed that.
- Existing wording used as the convention: modules and areas are short nouns, actions are verbs (`View`/`عرض`, `Manage`/`إدارة`, `Operate`/`تشغيل`).

## Change (only labels; 2 files, +6 / −0 net lines of content)
| Map | Key | English | Arabic |
|---|---|---|---|
| `hr.perm_modules` | `ai` | AI | الذكاء الاصطناعي |
| `hr.perm_actions` | `use` | Use | استخدام |
| `hr.perm_areas` | `assistant` | Assistant | المساعد |

Resulting label of `ai.assistant.use`: **AI — Assistant — Use** / **الذكاء الاصطناعي — المساعد — استخدام**. (The only other diff lines are the trailing commas JSON needs.)

**Untouched:** `Rbac.php` and every permission identifier, authorization logic, default roles, migrations, API, tests (no test was edited or loosened), PR #1547.

## Verification
| Check | Result |
|---|---|
| `src/modules/roles` (catalog + audit-permission tests) | ✅ 4 files / 39 tests (the 2 failing tests now pass) |
| Full web vitest (`npx vitest run`) | ✅ 636 files / 7,412 tests, 0 failures |
| JSON validity of both message files | ✅ |
| `npm run build` (web) | ✅ exit 0 |
| PHP | not applicable — no PHP file changed |

## CI
Code head `02ab424` (status as of 06:39 UTC; one poll after the web job finished, not repeated):

| Check | Result |
|---|---|
| `web build (Next.js)` — the job that was red | ✅ **success** (both workflow runs; 06:23 / 06:24 UTC) |
| `php artisan test (L11, sqlite)` | ⏳ in progress at the last check (no PHP file changed) |
| `php artisan test (L11, pgsql)` | ⏳ in progress at the last check (no PHP file changed) |
| `CI Gate` | ⏳ waits for the two PHP jobs |

The PHP jobs were still running at the last check, so **the final CI Gate result is not recorded here**; it is visible on the PR.

## Risks
- **Very low.** Display-only strings; no behavioural, authorization or data change. The wording ("AI", "Assistant", "Use") is a reasonable default — if the AI-01 owner wants different product terminology, only these three pairs change.
- Arabic terms were chosen to match the existing glossary style (noun/verb forms) but have not had a native-reviewer pass beyond the author's.
- Any open PR touching `web/` (e.g. #1547) stays red on this test until this lands in `main` and they pick it up (merge `main` or rebase). I did not touch #1547.

## Next action
1. Review and merge this PR (merging to `main` triggers Railway's production auto-deploy of `main` — web labels only).
2. Then update #1547 from `main` (e.g. “Update branch”) so its `web build` / CI Gate re-run green.
3. Process suggestion: make `web-ci` run when `app/Support/Rbac.php` changes, so a new permission without labels fails on the PR that adds it (not done — out of scope).
