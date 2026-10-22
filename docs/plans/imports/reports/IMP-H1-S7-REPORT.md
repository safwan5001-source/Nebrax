# IMP-H1-S7 — AI Action type gates

**Branch:** `claude/imp-h1-s7-ai-action-type-gates` · **Prerequisite for:** every new AI Action type (H3-S4, H4-S4, H5-S5, H7-S2, H7-S4)

## Problem

`AiActionRegistry::definition()` carried a single `domain_permission` string and `AiActionPolicy::authorize()` checked
`ai.actions.*` + that one permission. A future type whose direct API needs **two** permissions or is guarded by an
**application key** (e.g. `inventory.core`, `finance.operations`) could not express the direct API's gates, so the AI path
would have been weaker than the screen path.

## Changes

- Registry definition: `domain_permission: string` → `domain_permissions: list<string>` (all required) + `application_key: ?string`; `types()` lists registered types.
- `AiActionPolicy::authorize(actor, actionPermission, list<string> domainPermissions, ?string applicationKey)`:
  every domain permission is required; a non-null key goes through `EnsureApplicationActive::authorize` (the single implementation
  extracted in H1-S1: cohort enforcement, shadow observation, `suspended` = read-only, `disabled` = refused), mapped to
  `AiActionException('application_inactive', …, 403)`. Permission checks run before the application gate.
- `AiActionGateway`: passes both through all six call sites.
- `product_import.v1`: `['products.manage']`, `application_key = null` → **no behavior change** (existing 186 AI tests unchanged and green).
- `AiActionTypeGatesTest`: `EXPECTED` contract map; a type registered without a matching line fails CI; gates must be real RBAC permissions / catalog keys;
  policy behavior (enabled / suspended read-only / disabled, AND semantics, permission-before-application).
  Negative control: with the application branch removed and only the first permission checked, 4 of 7 tests fail.

## Safety

No journal entry, no migration, no route / env / AI-config change; the assistant and provider are untouched. AI Actions remain off by default.
Read/write classification for `suspended` is the current HTTP request's (all AI Action calls are controller-driven; no queue path exists).

## Verification

`--filter='AiAction|AiAssistant|ApplicationEnforcement'`: 186 passed. Full suite and CI: see PR.

## Review

Codex quota exhausted — **not Codex-reviewed**. Independent subagent review result recorded in the PR description.
