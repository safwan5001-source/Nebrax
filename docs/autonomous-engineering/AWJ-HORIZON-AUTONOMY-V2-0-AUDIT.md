# AWJ Horizon Autonomy V2 — V2-0 Initial Repository Evidence Audit

**Date:** 2026-10-11  
**Status:** PARTIAL / read-only repository inventory; not a conclusive inventory of live agent sessions.  
**Base:** source docs read from repository default branch on this date.  
**Boundaries:** no change to existing protocol/permissions, other horizon branches, merges, or production.

## 1. Sources inspected
- `docs/autonomous-engineering/AWJ-HORIZON-SYSTEM.md`
- `docs/autonomous-engineering/00-START-HERE.md`
- `docs/autonomous-engineering/AUTONOMOUS-ENGINEERING-PROTOCOL.md`
- `docs/autonomous-engineering/QUALITY-GATES.md`
- `docs/autonomous-engineering/DECISION-ESCALATION.md`
- `docs/autonomous-engineering/CURRENT-STATE.md`
- `docs/autonomous-engineering/TASK-QUEUE.md`
- GitHub open-PR search and branch-name search.
- Verified PR #1324 appears merged, not open, in GitHub PR searches.

## 2. Material findings

### P1 — merge-authority ambiguity across documents
`00-START-HERE.md` and older V1 protocol text say standing merge authority after gates. `CURRENT-STATE.md` and active `TASK-QUEUE.md` explicitly say that the owner currently requires **per-PR explicit merge approval**, in particular for TAX-ZATCA. The specific current active queue controls its own work; **no V2 general permission may silently override it**. Do not activate V2 merge automation until authority conflicts are resolved in a single authoritative, versioned grant model. The V2 proposal is not itself a grant.

### Active vs paused vs open but unverified
- TAX-ZATCA: the recorded active horizon after PR #1324 activation merge. Its first recorded task is **TAX-HZ-00 read-only Evidence/Decision Pass**, not automatic remediation, posting, credentials, production integration or release.
- Delivery Platforms & Settlement V1: explicitly **PAUSED**, not deleted or closed. Preserve its gates/handoffs, no task selection while paused.
- PR #1326: `AWJ-HORIZON-MEDIA-STORAGE S1`; **open PR** evidence of work, not proof of a currently running agent.
- PR #1329: `CUST-HV V9d-1`; **open PR**, potential Customizer horizon overlap.
- PR #1328: `H1-CONTRAST`; **open PR**, platform UX work.
- PR #1327: this proposal; **draft open PR**.
- Other open documentary/feature PRs include Growth Foundation #1128, Cloudflare #1093, Customizer #1089 and others. These may be paused, historical, or active; **do not infer runtime status** from age or presence.
- Branch-name search finds numerous `docs/*horizon*` and `claude/*horizon*` names; names alone are not active-session confirmation.

### Concurrency risk
Concurrent horizons may overlap on shared UI tokens, routes, domain contracts and GitHub main. In particular platform UX and Customizer work may share UI design infrastructure, and TAX and Delivery can overlap invoices/VAT/payments and access rules. This is an **overlap hypothesis** requiring changed-path and semantic dependency review, not proof of a conflict.

### Existing mature capabilities
Existing Horizon already specifies evidence, Researcher/Architect, scoped planning, self-review/Reviewer/Guardian, exact head CI, pre/post merge review and next-task progression. V2 must extend only uncovered areas: versioned authority, concurrency-safe active registry/leases, interruption recovery, implementation proof and conditional automation. Avoid building duplicate policy frameworks.

## 3. Limitations and unanswered questions

- No direct visibility into currently executing Claude/Grok/Cursor session lifetimes or user-side running tasks.
- GitHub branch protection/rulesets, required approvals, app permissions and merge action eligibility have not yet been inspected.
- Open PR searches give a non-exhaustive signal of work; no per-PR updated/head/CI review yet.
- This report is **not** a security approval for any automation credential.
- External research for orchestrator/ruleset technology is deferred until choosing the actual integration and its version-specific controls.

## 4. V2-0 remaining targeted work

1. Inspect actual required branch protections/rulesets and default branch CI, authenticated agent's minimum GitHub scopes; document missing permissions, never guess.
2. Inspect latest report/queue per candidate ongoing horizon and cross-reference each PR/branch to classify: active-authorized, paused, blocked, documentation-only, stale/unknown.
3. Build a conflict matrix based on **actual file paths and domain semantics** of overlapping active PRs; no branch writes.
4. Resolve standing-vs-per-PR authorization inconsistency as an explicit owner-approved policy for **future pilot only**, without affecting present TAX gates.
5. Propose and test lease/lock/fencing and source-of-truth strategy; record failure modes.
6. Document protocol-version compatibility and controlled enrollment/rollback; require owner-approved pilot grant before any autonomous merge.
7. Run a no-merge, no-deploy dry-run on low-risk PR workflow before implementation/activation.

## 5. Impact assessment

**Safe today:** documentation and read-only PR/branch evidence gathering isolated in V2 branch.

**Unsafe without further proof:** automatically merging any PR, changing `CURRENT-STATE.md` or current horizon queues on behalf of others, introducing broad standing GitHub credentials, changing shared workflow behavior, auto-deploying, or assuming old open PRs are running work.

**Next decision:** finish V2-0 missing proof; then review explicit enrollment/authority contract (V2-1). No automatic merge or production rights follow from this report.

## 6. Targeted PR changed-path matrix (verified 2026-10-11)

GitHub changed-file listing was checked for PRs #1326, #1328, #1329, #1327, #1089. **No identical changed filenames among these five PRs**; this does not prove semantic independence, absence of merge conflicts on a later main, or current agent activity.

| PR | Primary touched areas | Integration / risk observations |
|---|---|---|
| #1326 Media Storage S1 | Laravel Employee/Expense/Invoice/Payment/Purchase controllers, AttachmentStorage, storage config, employee photo migration, feature tests | **High-impact surface:** affects financial/API upload workflows and DB. Must review financial atomicity, orphan prevention, tenant storage isolation, migration safety and API compatibility, including potential semantic overlap with TAX/Delivery. Not automatic-merge eligible based on title or file count. |
| #1328 Platform H1-CONTRAST | `web/src/app/globals.css`, button tests, platform docs | Shared global CSS can affect ERP and platform beyond named screen; visual/accessibility regression evidence and affected selectors required. |
| #1329 CUST-HV V9d-1 | Laravel StorefrontGlobalTokensNormalizer, storefront components/CSS, builder components/config, feature and visual tests | Cross-boundary storefront ↔ backend token contract; no direct path collision with #1328, but global design/presentation changes need integration QA. |
| #1327 V2 docs | Two `docs/autonomous-engineering` docs only | No runtime code or authorization change; doc-review and consistency checks. |
| #1089 Store Publishing | Laravel commerce presentation controller, service, request, routes and tests | Open historical PR; may affect publishing APIs/versions and Customizer semantics. Verify current applicability/staleness before any action. |

### Branch protection / rulesets / identity — NOT YET VERIFIED

The currently exposed GitHub connector actions include changed-file listing, compare and CI status retrieval, but **do not expose read-only branch-protection or repository-ruleset inspection**. Thus no claims are made about required reviewers, bypass actors, automatic merge availability, merge queue, workflow trust or current GitHub token privileges. These must be checked using a suitably authorized read-only GitHub CLI/API session (or owner screenshots/settings), without changing settings, before choosing a concurrency/merge mechanism.

Do **not** substitute an observed green check or the existence of a merge tool for proof of branch-protection and authorization policy.

### Focused next proof

1. Read-only capture of main rulesets/branch-protection required status checks, reviews, merge queue and bypass/permission controls.
2. Sample current PR head/base SHAs and exact-head workflow evidence for pilot candidates.
3. Semantic conflict review on finance/tenant/API (especially #1326 vs TAX and Delivery) and Customizer/publishing (especially #1329 vs #1089).
4. Build a registry with **verified** horizon state, activity unknown markers and assigned branch ownership; begin as report only, not a lock implementation.
