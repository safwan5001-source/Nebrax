# AWJ Help Center V2 — Master Plan

**Project:** أَوْج — AWJ ERP  
**Status:** Planning approved; implementation not started  
**Baseline:** Help Center V1 (PR #694)  
**Scope:** Help Center only

## 1. Purpose

V2 evolves the existing Help Center from a standalone article library into contextual, in-product assistance tied to the user's current AWJ screen, while preserving the characteristics of a daily accounting tool: clarity, density, speed, trust, and consistency.

V2 must build on V1 rather than replace or redesign it.

## 2. V1 Baseline

The V1 baseline is the implementation delivered by PR #694:

- Authenticated `/help` and `/help/[slug]` routes.
- Arabic and English support with RTL/LTR behavior.
- Six help categories and ten practical articles.
- Arabic-friendly local search and category filtering.
- Explicit empty/not-found states.
- Reading time and related articles.
- Direct links from help content to relevant AWJ screens.
- Help Center entry points in the top bar and mobile user menu.
- Static frontend content with no Help Center backend/database.

V2 must preserve backward compatibility with these routes and behaviors unless a later approved PR explicitly changes them.

## 3. V2 Goals

1. Provide contextual help without forcing users to leave their current workflow.
2. Cover real AWJ screens and workflows systematically rather than adding arbitrary articles.
3. Improve Arabic/English search and discovery while keeping the implementation simple and fast.
4. Respect existing RBAC and avoid exposing inaccessible product actions through Help Center UI.
5. Harden accessibility, mobile, RTL/LTR, testing, and production verification.

## 4. Non-Goals

The following are explicitly outside Help Center V2 unless separately approved:

- AI Help Assistant.
- RAG/vector database.
- External CMS.
- Support Tickets.
- AI-generated accounting guidance.
- Broad navigation redesign.
- Accounting-rule changes.
- Unrelated backend/API/database work.

These may be evaluated separately after V2 is complete.

## 5. Delivery Sequence

V2 is divided into four small, reviewable PRs:

`V1 → PR-HELP-2A → PR-HELP-2B → PR-HELP-2C → PR-HELP-2D → Production Verification → V3 decision`

No PR may silently absorb work from a later phase.

---

# PR-HELP-2A — Contextual Help

## Objective

Introduce a reusable contextual-help mechanism that maps supported AWJ screens to relevant Help Center content.

## Expected UX

- A consistent `?` help affordance is available on supported screens.
- Activating it opens a side `Sheet` rather than navigating the user away from their task.
- The sheet shows the most relevant help article/topic for the current screen.
- The user can open the complete article at the existing `/help/[slug]` route.
- Existing `/help` navigation remains unchanged.

## Architecture

Use a centralized, typed mapping between application routes/contexts and Help Center article slugs. Avoid scattered page-specific hard-coded logic when a shared mechanism is sufficient.

The contextual layer must reuse the V1 article source rather than creating a second content system.

## Constraints

- Frontend only unless implementation proves a backend change is genuinely required and separately approved.
- No database migration.
- No redesign of existing screens.
- No accounting behavior changes.
- Preserve mobile and desktop behavior.
- Follow AWJ design tokens, Lucide icons, and existing Sheet primitives.

## Acceptance Criteria

- Supported screen resolves to the correct article/context.
- Unknown/unmapped screens fail safely and do not break navigation.
- Full article remains accessible through `/help/[slug]`.
- RTL/LTR and mobile behavior are tested.
- Existing Help Center tests remain green.

---

# PR-HELP-2B — Content Coverage

## Objective

Systematically expand Help Center coverage based on functionality that actually exists in AWJ.

## Required Audit

Create a lightweight coverage matrix comparing:

- Existing AWJ screens/modules.
- Existing V1/V2 help articles.
- Missing user-facing workflows that merit documentation.

Prioritize common daily workflows and high-risk accounting/operational workflows.

## Content Rules

Every new article must:

- Describe functionality that exists in the product.
- Use the product's actual terminology.
- Be available in Arabic and English.
- Provide concise steps rather than marketing copy.
- Link only to real AWJ routes/actions.
- Identify important prerequisites or permission requirements where relevant.
- Avoid inventing accounting behavior or promising unsupported functionality.

## Article Structure

Prefer the established structure:

1. Short explanation.
2. Numbered steps.
3. Notes/cautions when genuinely necessary.
4. Common problems where useful.
5. Related topics.
6. Relevant AWJ screen/action link.

Screenshots are optional and should be introduced only when they materially improve comprehension and can be maintained reliably.

## Acceptance Criteria

- Coverage matrix is included or documented.
- Content additions correspond to existing AWJ functionality.
- Arabic/English parity is maintained.
- No undocumented route/action is presented as available.
- Existing V1 articles remain backward compatible.

---

# PR-HELP-2C — Search & Discovery

## Objective

Improve finding the correct help content without introducing unnecessary search infrastructure.

## Search Improvements

- Preserve Arabic normalization already introduced in V1.
- Add curated Arabic and English keywords/synonyms where they improve discovery.
- Examples include domain vocabulary such as invoice/sales, customer/client, inventory/stocktake, while the final synonym set must be derived from actual AWJ terminology.
- Improve ranking so title and strong keywords have appropriate priority over weak body matches.
- Allow current contextual information to improve discovery where useful without hiding unrelated results.
- Preserve category filtering and explicit no-results states.

## Architecture Constraint

Search should remain local/static while Help Center content size and performance make that appropriate.

Do not introduce Elasticsearch, external search, embeddings, vectors, RAG, or a backend search service without a separately approved architecture decision.

## Acceptance Criteria

- Arabic and English search behavior is deterministic and tested.
- Common AWJ terminology and approved synonyms resolve expected articles.
- Ranking tests cover ambiguous/multiple-result cases.
- Category filtering remains compatible.
- Search remains responsive on mobile and desktop.

---

# PR-HELP-2D — Feedback & Hardening

## Objective

Finish V2 with UX/accessibility hardening and make an explicit decision on article feedback rather than adding storage implicitly.

## Feedback Decision Gate

Evaluate whether `هل كانت هذه المقالة مفيدة؟ / Was this article helpful?` provides enough product value to justify persistence.

Before adding any backend persistence, explicitly define:

- What is stored.
- Whether feedback is anonymous or user-linked.
- Tenant ownership/isolation behavior.
- Required permissions, if any.
- Retention/privacy expectations.
- Duplicate/repeated feedback behavior.

If this is not justified, V2 may ship without persistent feedback. Do not create a database table merely because a feedback control is visually desirable.

## Hardening

Verify and improve where necessary:

- Keyboard accessibility.
- Focus management for contextual Help Sheet.
- Screen-reader labels.
- RTL/LTR.
- Desktop/mobile responsive behavior.
- Empty/not-found/error states.
- Broken article/route references.
- Regression coverage for locale JSON integrity.
- Help Center build/test coverage.

## Acceptance Criteria

- Feedback persistence is either deliberately implemented under an approved design or deliberately deferred.
- Accessibility checks pass for core Help Center flows.
- Mobile and desktop flows are verified.
- Arabic and English flows are verified.
- Help Center tests and Web build/CI are green.

---

# 6. RBAC and Information Exposure

Help Center must not become a mechanism for bypassing application authorization.

Rules:

- Help content may explain product concepts, but contextual actions and deep links must respect existing AWJ access rules.
- Do not render an actionable shortcut to a protected screen when the current user cannot access that function, where the application already exposes enough permission context to make that decision safely.
- Help Center itself must never grant or simulate a permission.
- Backend authorization remains authoritative regardless of Help Center UI behavior.
- Do not duplicate or redefine permission semantics inside the Help subsystem.

Any implementation requiring new permission semantics must stop for a separate security/RBAC decision.

# 7. Accounting Safety

Help Center is informational UI. V2 must not alter:

- Posting behavior.
- Journal entries.
- Ledger balances.
- Tax calculations.
- Period locks.
- Document numbering.
- Financial validation.
- Tenant accounting configuration.

If documentation reveals a discrepancy in actual accounting behavior, record it as a separate issue/task; do not fix it inside a Help Center PR.

# 8. Design System Requirements

All V2 work must follow the AWJ design system and the existing application primitives:

- RTL-first Arabic with English LTR mirror.
- Existing semantic design tokens; no raw component hex colors.
- Lucide icons with established AWJ treatment.
- Dense, clear accounting-product UX.
- No gradients, decorative visual noise, oversized cards, or generic SaaS-dashboard styling.
- Use existing shadcn/ui primitives such as `Sheet` where appropriate.
- Preserve the existing Help Center visual language rather than creating a parallel design system.

Informational callouts should use neutral/informational presentation unless a semantic financial warning state genuinely applies; financial warning colors must not be repurposed merely for decorative emphasis.

# 9. Testing Strategy

For each PR:

1. Run focused Help Center/unit tests first.
2. Run locale/i18n validation when translations change.
3. Run relevant Web tests.
4. Run production Web build.
5. Use broader tests only as impact requires.

For security-sensitive contextual links, include RBAC-oriented tests where applicable.

Final V2 verification must include:

- Arabic desktop.
- Arabic mobile.
- English desktop.
- English mobile.
- Search and filters.
- Contextual Help Sheet.
- Article navigation.
- Related topics.
- Deep links/actions with appropriate access behavior.

# 10. Definition of Done

A V2 PR is not complete merely because code was written.

Each implementation PR requires:

- Focused tests green.
- Required broader tests/build green.
- CI green.
- Review completed.
- Explicit Safwan approval before merge.

V2 as a whole is Done only after:

- PR-HELP-2A through PR-HELP-2D are completed or an explicitly documented phase is deliberately deferred.
- Approved PRs are merged.
- Production deployment is successful.
- Production functional/visual verification is completed.

# 11. Git / Release Rules

- Keep every PR small and scoped to its named phase.
- No unrelated refactoring.
- No merge without Safwan's explicit approval.
- No deploy/production release without Safwan's explicit approval.
- Every implementation handoff must report changed files, tests/results, build/CI, risks/remaining work, branch, PR, Base SHA, Head SHA, and next recommended step.

# 12. Future Decision — V3

After V2 production verification, evaluate whether AWJ should introduce an AI Help Assistant.

That decision must be separate and should consider at minimum:

- Quality and completeness of the Help Center knowledge base.
- Grounding/citation requirements.
- Accounting-answer safety.
- Tenant data boundaries.
- Permission-aware retrieval.
- Cost and latency.
- Auditability and user trust.

AI assistance is not part of this V2 plan.