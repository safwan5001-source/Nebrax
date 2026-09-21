# AWJ Autonomous Engineering — Current State

> This file is a durable resume point, not a substitute for Git/GitHub evidence.

LAST_UPDATED: 2026-09-21
LAYER_VERSION: V1
STATUS: EXECUTING

## Current objective

Execute the first bounded autonomous-engineering horizon: close the Commerce Mobile API readiness gaps sequentially, beginning with COM-MOBILE-MEDIA-1. Preserve AWJ tenant/security/business invariants and stop at material Decision Gates.

## Confirmed repository context

- Existing `docs/agent-workspace/` contains the earlier ChatGPT ↔ Claude orchestration protocol and operational evidence.
- Existing `.claude/AGENT_ORCHESTRATION.md` is the older orchestration entrypoint.
- The new `docs/autonomous-engineering/` layer is additive. It does not erase historical orchestration evidence.
- PR #887 (App Builder architecture + Commerce Mobile API readiness) is merged and post-merge reviewed; Merge SHA: `f43a8e0db36952f3007557fc127c3a6a28de0700`.
- PR #890 (Autonomous Engineering V1) is merged and post-merge reviewed; Merge SHA: `587ed50c152450ee8c354486648a75f31a3d24a6`.
- `COM-MOBILE-MEDIA-1` (mobile-authorized product media, `/commerce/v1/media/{id}`) is **done**: PR #911 merged and post-merge reviewed; Merge SHA: `8386ece721f3e6b37c9f2ff8db64f10e2b44d9c4`. Along the way it also fixed a pre-existing production defect (`disk = 'document'` media returning a 500) in the already-shipped `StorefrontMediaController` for `/store/v1`, discovered via automated review while building the mobile equivalent. Full evidence: `docs/plans/commerce/COM-MOBILE-MEDIA-1-IMPLEMENTATION-REPORT.md`.
- Docs-only follow-up PR #915 merged; Merge SHA: `c91f873276abdacafebd789f8bc953aea4690840`.
- `COM-MOBILE-VARIANTS-1` (variant/options/UOM mobile contract) is **done**: PR #916 merged and post-merge reviewed; Merge SHA: `40445016973d050963d25519ed15ba05e0de6b66`. Discovered backlog: alternate-unit (UOM) selection contract, needed by both `/store/v1` and `/commerce/v1`, not yet designed. Full evidence: `docs/plans/commerce/COM-MOBILE-VARIANTS-1-IMPLEMENTATION-REPORT.md`.
- `COM-MOBILE-AUTH-1` evaluated for promotion and found **not ready**: `docs/plans/store/ADR-05-CUSTOMER-MOBILE-IDENTITY-BOUNDARY.md` (Accepted, 2026-09-09) fixes the conceptual identity boundary (Commerce Authentication Identity / Customer Account / ERP User / Partner stay distinct; tenant-scoped; ownership-based authorization) but explicitly lists as **non-decisions**: authentication framework/provider, SMS/OTP provider, password-vs-passwordless default, and token/session format. This is a genuine Decision Escalation Gate (Tenant/Auth architecture + potential paid third-party vendor commitment), not an evidence gap Claude can resolve — see Decision Escalation packet delivered to Safwan.
- Safwan resolved the Decision Escalation (`COM-MOBILE-AUTH-1-IDENTITY-MECHANISM`): support phone+OTP (primary) and email+password (alternative), provider-neutral OTP with no real vendor integrated yet. Recorded durably in `docs/plans/store/ADR-06-COMMERCE-MOBILE-AUTH-MECHANISM.md`. `COM-MOBILE-AUTH-1` (customer mobile auth + profile) is **done**: PR #920 merged and post-merge reviewed; Merge SHA: `a8f83b170eb2f696541e9f4d48d3db407ab02dd5`. Reuses the existing, previously-unwired `/customer/v1` identity stack unmodified, extended into `/commerce/v1` via a new `X-Customer-Token` header + `AuthenticateCommerceCustomer` middleware, plus new OTP scaffolding. 24 focused tests + full `Customer|Commerce` regression green on SQLite and PostgreSQL (post two Codex review rounds that found and fixed 4 real issues: a dropped audit trail, a partner-linking dead-end for phone-only customers, an OTP-issuance concurrency race, and a shared-quota rate-limit gap — plus a fifth, self-found security fix closing an account-boundary leak via an unverified self-declared phone). One merge conflict against `main` (trivial import-ordering clash with a concurrently-merged PR) resolved before merge. Full evidence: `docs/plans/commerce/COM-MOBILE-AUTH-1-IMPLEMENTATION-REPORT.md`.

## Current execution horizon

- Horizon: Commerce Mobile API readiness closure V1.
- First executable task: `COM-MOBILE-MEDIA-1` — **done**.
- Second executable task: `COM-MOBILE-VARIANTS-1` — **done**.
- Third executable task: `COM-MOBILE-AUTH-1` — **done**.
- Fourth/fifth candidates evaluated and found **not ready** — both moved to `decision_required`:
  - `COM-MOBILE-CART-IDENTITY-1` (guest → customer cart transition): `docs/plans/store/COMMERCE_MOBILE_API_READINESS.md` §12 explicitly requires a cart-merge policy decision (claim vs. merge, conflict/quantity behavior, pricing/revalidation, abandoned-cart handling, logout/multi-device behavior) that `COM-MOBILE-AUTH-1` did not and could not resolve.
  - `COM-MOBILE-CUSTOMER-1` (addresses + order history): blocked by ADR-05 §13/§22's explicit Commerce Address schema non-decision; its order-history half is comparatively evidence-ready but the task is currently scoped as one bundled unit.
  - No other queue candidate is independently ready — all remaining items trace back to these same two open decisions or to unconfirmed V1 scope. This is a genuine Decision Escalation, not an evidence gap — see `TASK-QUEUE.md` for the full evaluation delivered to Safwan.
- Implementation merge: standing authority after mandatory final-head pre-merge review, required green CI, no unresolved Decision Gate, and mandatory post-merge review.
- Deploy / production release / destructive production operation: not authorized without Safwan's explicit approval.

## Completed in this layer

- Start-here/source-of-truth order.
- Autonomous engineering protocol.
- Decision escalation rules.
- Quality gates.
- Master execution-plan format and initial Commerce Mobile horizon seed.
- Durable current-state convention.
- Durable queue convention.
- ADR convention.
- Implementation report convention.
- Claude autonomous entrypoint/bootstrap.
- Legacy orchestration compatibility/mode selection.
- Standing merge authority with review/CI/Decision Gate safeguards.

## Authorization boundary

Authorized:
- sequential implementation work required to close the documented Commerce Mobile readiness gaps;
- only tasks promoted to `ready` after current-main dependency/evidence validation;
- routine engineering choices inside each task's documented outcome/invariants.

Not authorized:
- deploy or production release;
- destructive production operations;
- silent resolution of material accounting/payment/auth/tenant/security/strategic decisions;
- unrelated App Builder runtime implementation;
- material scope expansion outside this horizon.

## Resume rule

A future agent should:
1. verify this file against the actual PR/branch/repository state;
2. correct stale factual metadata rather than trusting it blindly;
3. read the active queue item;
4. continue only within its authorized horizon.
