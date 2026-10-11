# AWJ-PLATFORM-UX-H1 — Platform Administration UX Horizon

Status: **H1-PAGINATION IN REVIEW / NO MERGE**  
Owner: Safwan | Implementer: **Grok** | Date: 2026-10-11  
Repository: `safwan5001-source/Nebrax`  
Execution protocol: [AWJ Horizon System](../../autonomous-engineering/AWJ-HORIZON-SYSTEM.md)  
H1-0 evidence: [AWJ-PLATFORM-UX-H1-AUDIT.md](./AWJ-PLATFORM-UX-H1-AUDIT.md)  
H1-1 spec: [AWJ-PLATFORM-UX-H1-1-UX-SPEC.md](./AWJ-PLATFORM-UX-H1-1-UX-SPEC.md)  

Owner decision 2026-10-11: option A approved and the H1-1 spec was merged in PR #1312. `H1-PAGINATION` is the first code slice: frontend only, on the existing list API. `H1-CONTRAST` and H1-2 stay unstarted. This pagination PR is not merge approval.

## Purpose

Modernize the **platform-level administration console**, not tenant ERP pages, into a clear, fast, trustworthy, responsive Arabic-first control plane. This horizon is a UX/UI modernization of existing platform features, **not** authorization to rewrite authentication, introduce new platform business features, or rework the backend.

**Owner requirements:** all screen sizes, desktop/laptop/tablet/phone, portrait and landscape, Arabic RTL and English LTR, light/dark, keyboard and touch. **Grok is the designated implementer** instead of the default Claude Code described in Horizon reference.

## Non-negotiable gates

- **No merge, deployment, release, production migration or production operations without Safwan's explicit approval.** Every individual PR merge needs approval; this task description and Horizon's general automation flow are not approval.
- Protect platform principal separation, auth/RBAC, tenant/branch isolation, backwards compatibility, accounting and financial semantics, API contracts, secrets and PII.
- No new API/schema/business logic, broad refactor, unrelated fixes, or inferred fake metrics in a UI-only PR. Escalate material changes with a Decision Packet.
- Do not conflate platform-level subscriptions/contracted MRR with invoiced revenue or confirmed collections. Amounts are from authoritative API, stored in minor units and formatted without float-based financial calculations.
- Do not expose tenant identity in **aggregated analytics**; existing authorized tenant-management surfaces remain subject to their existing explicit authorization and audit boundaries.
- Source of truth for current colors/tokens is the repository's current `web/src/app/globals.css`, Tailwind bindings, and accepted design decisions; no hardcoded hex in components. Existing uploaded older design guidance is **reference only**, not overriding current repo.

## Verified evidence — partial, must revalidate against latest main

- `web/src/app/platform/page.tsx`: overview KPIs for tenants, users, subscriptions, contracted MRR/ARR and renewals; stand-alone top header, cards and action buttons. No shared persistent platform shell apparent in this inspected file.
- `web/src/app/platform/tenants/page.tsx`: tenant-management list built on TanStack DataTable, search/filter/detail navigation. The existence of authorized tenant-level details here does **not** authorize revealing tenant details in aggregate analytics.
- `web/src/app/platform/prices/page.tsx`: editable/versioned plan pricing, including currency and effective date; preserve precision, validations and action boundaries.
- `PLATFORM_DEVELOPMENT_ROADMAP.md`: explicit platform/admin separation and financial metric definitions; older roadmap statuses are not proof of present feature completeness.
- `docs/autonomous-engineering/AWJ-HORIZON-SYSTEM.md`: Evidence → decisions → durable documentation → dependency queue → small PRs → scoped tests → reviews → exact-head CI → merge gate → post-merge proof.
- This is **not** a complete screen inventory or browser QA. Grok must inspect all actual `/platform/**` routes, components, tests, backend route contracts and prior implementation reports before drawing conclusions.

## H1-0 — Evidence-first inventory & UX audit (mandatory first deliverable; no product code)

1. Fetch latest `origin/main` and record exact Base SHA; identify latest relevant handoff without broad re-exploration. Read official Horizon documents, relevant platform design docs and deployed code contracts.
2. Inventory **every** existing `web/src/app/platform/**` route, layout, form, list, page, login and action; record functional purpose, platform permission guard, backend dependency, read/write actions and existing tests.
3. Evaluate desktop/tablet/mobile, RTL/LTR, light/dark, navigation consistency, overflow, data density, table filters/actions, touch targets, keyboard/focus, skeleton/empty/error/forbidden states, feedback and confirmations.
4. Capture real browser screenshots and measurable overflow assertions if browser environment available, masking sensitive data. **Code reading alone is not tested responsiveness**. Distinguish verified issues from hypotheses.
5. Classify P0/P1/P2/P3 and separate actual UI defects from feature proposals; avoid PII in screenshots/reports.
6. Review authoritative current external guidance as needed, including WCAG 2.2 and responsive navigation/table practices. Label **external evidence**, **AWJ decisions**, and **open owner decisions** separately.
7. Write `docs/plans/platform/AWJ-PLATFORM-UX-H1-AUDIT.md`: route matrix, breakpoint evidence, IA proposal, component map, ranked defect list, risks and next safe work item. Audit file written in H1-0; product UI code was not changed.
8. Present **DESIGN_GATE** for any material navigation/content hierarchy redesign prior to major UI implementation.

## H1-1 — Architecture and responsive design specification

Design a coherent shell for authenticated platform pages, distinct from tenant ERP shell and login. Include responsive sidebar/drawer, compact topbar, breadcrumbs, page titles and contextual actions. Discover existing routes first: overview, tenants/detail, prices, integrations, document operations, other verified routes. Subscriptions/contracts, audit/security, billing/collections, health monitoring, settings: **only add navigation for routes that already exist; otherwise defer/propose them**, never fake functional destinations.

Define page patterns (KPI overview, table/search/filter, detail, form, destructive confirmation, loading/empty/error/403), desktop/tablet/mobile information density and interactions, safe area, text scaling and keyboard support. Produce spec and visual acceptance matrix; request owner design decision at material design gate.

## H1-2 — Shared Platform Shell

First implementation PR: introduce an isolated, responsive authenticated platform shell; preserve login, guards, existing links, access rights and tenant/admin separation. Functional actions remain reachable at 320px and landscape. Add focused tests. Open PR, execute review and exact-head CI; **stop before merge pending explicit permission**.

## H1-3 — Platform overview

Second small PR after dependency safe: redesign KPI hierarchy using **existing** trusted API data only (tenants, users, subscription states, contractual MRR/ARR, renewal windows, breakdown by plan). Labels must distinguish contractual value from invoicing and cash collection. No fabricated health charts/financial trends. Cover no-data/loading/failed API.

## H1-4 — Management pages

Split into independently reviewed PRs by existing screens: tenants list/detail, prices/plans, integrations, document operations, remaining verified routes. Standardize table and form patterns, filtering and mobile access without changing API contract, data security or financial behavior. Keep shared tenant ERP surfaces unchanged unless separately justified/tested.

## H1-5 — Regression, accessibility and closure

Verify viewports **320 / 375 / 390 / 430 / 768 / 1024 / 1440 / 1920px**, portrait/landscape where relevant, both languages and themes, zoom/text scaling, touch/keyboard/focus, safe areas, no page-level sideways overflow, and **all existing functionality preserved**. Responsive tables may have localized overflow or equivalent accessible cards retaining their actions. Include browser evidence, targeted and risk-based tests, platform auth/tenant isolation tests, CI on exact SHA, outstanding risk log and honest merge/deploy status.

## Dependency-safe queue

| Slice | Depends on | Output | Approval boundary |
|---|---|---|---|
| H1-0 audit | latest main + Horizon references | audit / factual inventory | done, no product UI code |
| H1-1 UX spec | approved option A | detailed IA, shell, states, acceptance matrix | **DESIGN_GATE before H1-2** |
| H1-PAGINATION | H1-1 spec approved, latest main | tenants list uses existing `page` metadata. No new API | **MERGE_GATE**. Highest-priority code slice. Independent of the shell |
| H1-CONTRAST | latest main. No shared files with pagination | gate-off dark danger text contrast. Sizes unchanged | **MERGE_GATE**. Separate PR. Not bundled with the shell or ERP restyle |
| H1-2 shell | H1-1 spec approved, and it does not edit the pagination or contrast files in the same PR | platform console shell only | **MERGE_GATE**. Do not start before H1-1 approval |
| H1-3 overview | shell merged and post-merge verified, or an explicit independence note | focused UI PR | **MERGE_GATE** |
| H1-4 management | relevant prior dependencies | small per-page PRs | **MERGE_GATE per PR** |
| H1-5 closure | approved changes on main | QA report | no deploy without permission |

No default stacked dependent PRs. Before every merge: final diff, independent-style reviewer, AWJ Guardian, relevant tests, CI on **exact final Head SHA**, record PRE_MERGE_REVIEW. Owner approves each merge. After approved merge: inspect merge SHA, checks, post-merge proof before starting dependent slices.

## Mandatory Grok milestone handoff (Markdown)

- Phase and verified work, what was explicitly **not** changed.
- Main Base SHA, branch, PR URL, final Head SHA; Merge SHA only if approved and performed.
- Inventory, files changed, scope rationale, priority findings and screenshots.
- Actual executed commands and results, width/direction/theme matrix, CI exact Head.
- Authorization/platform-vs-tenant boundary, PII, financial precision and backward compatibility review.
- Open risks, decisions, blocked items, next dependency-ready slice.
- Report truthful outcomes; never assert tests/visual QA without having run them.

## Grok bootstrap instruction

Read `docs/autonomous-engineering/AWJ-HORIZON-SYSTEM.md` and its companion documents **from main**, then this document. Start **H1-0**, not production changes. Audit current platform routes; persist evidence to `docs/plans/platform/AWJ-PLATFORM-UX-H1-AUDIT.md`, propose IA and design decision packet. Continue autonomously only within approved bounds. No merge or deploy. If GitHub access/tooling fails, record limitations rather than claim completion.

## State and ownership

This document is the authorized scoped **UX horizon specification**, not evidence that H1-0 was executed or any implementation is accepted. Keep horizon state localized to `docs/plans/platform/` until the official Horizon protocol determines safe central state updates; avoid overwriting other active horizons' `CURRENT-STATE.md` or `TASK-QUEUE.md`.
