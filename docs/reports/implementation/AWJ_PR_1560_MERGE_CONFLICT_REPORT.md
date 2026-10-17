# AWJ — PR #1560 Merge Conflict Resolution

## Root Cause and Scope

PR #1560 كان مبنيًا على تاريخ يحتوي commits الخاصة بـPR #1559، بينما أصبح `main` يحتوي نسخة Squash من #1559 عند `0bb86f720443a65b95f865600f4d16987847a99d`. لذلك أظهر دمج التاريخ الكامل تعارضات رغم أن المطلوب هو إبقاء تغييرات Document QA الخاصة بـ#1560 فقط.

## SHAs

- Repository: `safwan5001-source/Nebrax`
- PR: `#1560`
- Branch: `feat/ai-07b-document-qa-20261017`
- Base branch: `main`
- Base SHA: `0bb86f720443a65b95f865600f4d16987847a99d`
- Previous PR HEAD protected before rewrite: `bb1bca66796ba224eab9a8e27cd11be028acb19e`
- Pre-#1560 comparison base: `9db5e3b63cb9d1533ea07792fbbb885cf6406400`
- Rebased PR HEAD: `5e25cc0439cd09c9198d39f809b3e21cb7686bed`

## Files Conflicting in a Direct Full-History Merge

A direct `git merge origin/main origin/pr-1560` reported 21 conflicts:

- `app/Contracts/AiExternalAssistantProvider.php`
- `app/Http/Controllers/Api/AiAssistantController.php`
- `app/Http/Requests/AiAssistantSettingsRequest.php`
- `app/Services/AiAssistantConsentService.php`
- `app/Services/AiAssistantGateway.php`
- `app/Services/AiAssistantStatusService.php`
- `app/Services/AiAuditRecorder.php`
- `app/Services/AnthropicAssistantProvider.php`
- `app/Support/AiAssistantDenied.php`
- `app/Support/Settings.php`
- `docs/reports/AWJ_AI_07_ANTHROPIC_GATEWAY_REPORT.md`
- `web/src/components/intelligence/__tests__/consent.test.tsx`
- `web/src/components/intelligence/__tests__/panel.test.tsx`
- `web/src/components/intelligence/assistant-panel.tsx`
- `web/src/components/intelligence/consent-settings.tsx`
- `web/src/components/intelligence/state-notice.tsx`
- `web/src/messages/ar.json`
- `web/src/messages/en.json`
- `web/src/modules/intelligence/state.test.ts`
- `web/src/modules/intelligence/contract.ts`
- `web/src/modules/intelligence/state.ts`

These are historical overlap conflicts with the squashed #1559 content, not evidence that all of #1559 should be reintroduced.

## Resolution Method

1. Created recovery tags for the old PR head and current `main` before rewriting.
2. Fetched and verified current `main` and PR head.
3. Used `9db5e3b63cb9d1533ea07792fbbb885cf6406400` as the last pre-#1560 comparison base.
4. Applied only the binary-safe diff `9db5e3b63..bb1bca667` to a clean worktree based on `main`.
5. The scoped patch applied cleanly with no unresolved index entries.
6. The resulting tree contains 32 changed files, matching the #1560-specific diff, and does not replay the full #1559 history or its 4,000+ line squash.
7. No automatic “ours” or “theirs” resolution was used.

## Preserved Behavior and Safety

- Document QA implementation and its tests are preserved.
- The deterministic PostgreSQL consent-audit assertion fix is preserved.
- The production `AiAssistantDataCategory` behavior is not widened; `document_projected_text` remains gated by the existing platform switch and explicit tenant consent.
- No changes were made to Anthropic activation, Railway settings, RBAC, tenant isolation, document redaction, accounting rules, database schema, or APIs outside the scoped PR changes.

## Tests and CI

Local PHP/Docker execution is unavailable in the Sandbox, so local Laravel/PostgreSQL execution cannot be claimed.

Before conflict resolution, PR #1560 had passed PostgreSQL, SQLite, Web CI, and CI Gate on its old base. After pushing the rebased branch, the new GitHub CI completed successfully:

- PostgreSQL Laravel test suite: **PASS**
- SQLite Laravel test suite: **PASS**
- Web CI pull request check: **PASS**
- Web CI push check: **PASS**
- CI Gate: **PASS**

No real Anthropic API call was made.

## Resulting Files

The reconstructed tree contains 32 changed files relative to `main`; the exact set is the scoped `9db5e3b63..bb1bca667` diff. No unrelated mainline files were added.

## Remaining Risks

The rewrite used `--force-with-lease` against the protected old head. The PR is now reported as mergeable and all required checks are green. The remaining risk is limited to normal post-CI review; no merge or deployment was performed.

## Next Action

The reconstructed `main`-based branch was pushed to PR #1560 with an explicit `--force-with-lease`; mergeability and CI were verified. Do not merge or deploy without separate approval.
