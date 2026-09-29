# AWJ Horizon Execution Protocol

> **Status:** Permanent project workflow.
>
> This protocol applies whenever the owner says **"بنظام الأفق"**, **"Horizon"**, or explicitly assigns a large task as a multi-slice execution horizon.

## 1. Purpose

The Horizon system is AWJ's default execution model for large, multi-step product and engineering work that is safer and easier to review as a sequence of small independent pull requests.

A Horizon is **one approved outcome** implemented through multiple ordered **Slices**.

The agent must preserve accounting correctness, security, tenant isolation, backward compatibility, and AWJ design-system consistency throughout the entire Horizon.

## 2. Horizon execution contract

When a task is assigned **بنظام الأفق**:

1. Read the latest relevant implementation report, handoff, task documentation, and current repository state. Do not restart discovery from zero.
2. Define the Horizon goal, boundaries, dependencies, and ordered Slices before implementation.
3. Keep each Slice small, independently testable, reviewable, and revertible.
4. Start each Slice from the latest approved `origin/main` unless the documented dependency model requires otherwise.
5. Use a dedicated branch for each Slice.
6. For every Slice:
   - perform only the required discovery;
   - implement the scoped change;
   - run focused tests first;
   - run broader tests where financial, security, tenancy, API, schema, or regression risk requires them;
   - open a PR;
   - inspect CI and review findings;
   - fix in-scope findings;
   - produce/update implementation evidence.
7. After a Slice is ready and merged under the owner's current merge authorization, continue automatically to the next Slice from the newest `origin/main`.
8. Do **not** stop merely because a PR was opened.
9. Continue until the Horizon is complete or a true decision gate is reached.

## 3. Decision gates — when to stop

Stop and ask the owner only when one of these is reached:

- Merge is required but no merge authorization exists.
- Deploy, Production release, migration execution, destructive operation, or irreversible external action is required.
- Scope must materially expand.
- A financial/accounting rule must change.
- Tenant isolation, RBAC/security model, public API contract, or database architecture must change beyond the approved scope.
- Evidence reveals a product decision with multiple materially valid alternatives that cannot be resolved from existing AWJ rules.
- A blocker requires credentials, access, external approval, paid service activation, or owner input.

A note such as **"do not merge/deploy"** is a safety gate, not an instruction to stop immediately after opening a PR. Continue all safe work that remains inside the approved Horizon.

## 4. Mandatory external research

For every Slice involving product behavior, UI/UX, architecture, external integrations, platform rules, standards, or third-party APIs, research is mandatory before fixing the implementation decision.

The agent MUST:

1. Check current **official documentation** and primary sources.
2. Inspect relevant **real product websites/apps** when available.
3. For UI/UX work, perform **visual research**, not text-only research:
   - view real screenshots/pages;
   - inspect desktop and mobile patterns where relevant;
   - inspect interaction flows, tables, forms, dialogs, filters, navigation, empty/loading/error states, and responsive behavior as applicable.
4. Prefer official docs and first-party evidence; use strong secondary references only to complement them.
5. Do not rely on memory when current external evidence can be checked.
6. Do not blindly copy competitors. Evidence informs the AWJ decision; AWJ constraints and design principles remain authoritative.

## 5. Evidence discipline

Every research-backed Slice must distinguish:

### External Evidence
What the official documentation, real product, benchmark, or visual inspection actually shows.

### AWJ Decision
What AWJ will implement after considering that evidence.

### Rejected / Not Adopted
Important patterns found externally that AWJ intentionally will not copy, with a short reason when useful.

Do not present an AWJ proposal as if it were external evidence.

When evidence is unavailable or inaccessible, state that limitation explicitly rather than inventing behavior.

## 6. UI/UX Horizon requirements

For UI/UX work, the implementation must remain consistent with AWJ's design system.

Research should include visual comparison against the most relevant references for the task (for example Microsoft Dynamics, Salla, Shopify, SAP, Oracle, or another explicitly named benchmark), but the result must fit AWJ rather than imitate a reference.

Before implementation, verify at minimum when relevant:

- desktop layout;
- mobile layout;
- RTL/LTR behavior;
- information density;
- table behavior;
- search/filter/sort patterns;
- editing flows;
- navigation hierarchy;
- loading/empty/error states;
- dialogs/sheets;
- scroll behavior;
- accessibility/focus behavior;
- financial-number readability;
- light/dark behavior where the surface supports both.

For significant UI changes, visual verification of the implemented result is required before the Slice is considered complete.

## 7. Branch, PR, and merge model

Preferred pattern:

```text
Horizon
 ├─ Slice 1 → branch → tests → PR → findings → ready/merge
 ├─ Slice 2 → fresh branch from latest main → tests → PR → findings → ready/merge
 ├─ Slice 3 → fresh branch from latest main → ...
 └─ Horizon closure report
```

Do not accumulate a large Horizon in one long-lived branch when independent Slices are practical.

Do not merge unrelated cleanup or refactors into a Slice.

## 8. Testing policy

Testing must be risk-based, never convenience-based.

- Focused tests first.
- Broader tests when required by the change.
- Financial/accounting changes: do not reduce coverage.
- Tenant isolation/security/RBAC changes: include negative and cross-tenant cases.
- Database/API compatibility changes: verify backward compatibility explicitly.
- UI changes: run relevant frontend tests/build and visual verification when applicable.
- CI failures: inspect the failing job/logs first; do not perform broad unrelated repair.

A Slice is not complete merely because code was written.

## 9. Final report requirement for every Slice

Each Slice report must include:

- Slice name and objective.
- Branch.
- PR number/link.
- Base SHA.
- Head SHA.
- What changed.
- Files changed.
- External documentation/references reviewed.
- Visual sources/screens/screenshots inspected when UI/UX is involved.
- External Evidence.
- AWJ Decision.
- Tests executed and results.
- Build/CI status.
- Security / tenant-isolation / accounting considerations where relevant.
- Known risks.
- Remaining work.
- Explicit next Slice.

## 10. Horizon closure report

When the final Slice is complete, produce one Horizon-level closure report containing:

- Original Horizon objective.
- All Slices in order.
- PRs and merge status.
- Key architectural/product decisions.
- Research sources used across the Horizon.
- Test/CI summary.
- Production/deployment status.
- Remaining gaps or follow-up Horizons.
- Confirmation of whether the Horizon is truly complete.

## 11. Merge and deployment authority

Horizon mode does not override owner authorization.

- Never deploy to Production without explicit owner approval.
- Never perform a Production release merely because all Slices are merged.
- Merge only under the owner's current explicit authorization.
- If the owner has explicitly authorized continuous merging for the current Horizon, each ready Slice may be merged and execution may continue automatically.
- When that authorization is absent, stop only at the merge gate; do not discard the completed Slice work.

## 12. Default interpretation

When the owner says only:

> **"نفذ بنظام الأفق"**

interpret it as:

> Research first where relevant — including official documentation and visual inspection — define ordered Slices, implement each Slice on its own branch, test it, open and harden its PR, merge only when authorized, then continue automatically to the next Slice until the Horizon is complete or a true decision gate is reached.
