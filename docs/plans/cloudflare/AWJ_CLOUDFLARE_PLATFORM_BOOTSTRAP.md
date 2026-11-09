# AWJ Cloudflare Platform Horizon V1 — Bootstrap

Repository: `safwan5001-source/Nebrax`

## Mission

Execute the authorized subset of **AWJ Cloudflare Platform Horizon V1** under **نظام الأفق**.

This bootstrap is dormant until Safwan explicitly authorizes horizon execution. Documentation approval alone is not production-change approval.

## Start

1. Fetch latest `origin/main`.
2. Report exact Base SHA.
3. Read:
   - `CLAUDE.md`
   - `docs/autonomous-engineering/00-START-HERE.md`
   - `docs/autonomous-engineering/AWJ-HORIZON-SYSTEM.md`
   - `docs/autonomous-engineering/AUTONOMOUS-ENGINEERING-PROTOCOL.md`
   - `docs/autonomous-engineering/QUALITY-GATES.md`
   - `docs/autonomous-engineering/DECISION-ESCALATION.md`
   - `docs/plans/cloudflare/AWJ_CLOUDFLARE_PLATFORM_HORIZON_V1.md`
   - `docs/storage.md`
   - `docs/plans/store/AWJ_CUSTOM_DOMAIN_EDGE_TLS_ARCHITECTURE.md`
   - current `CURRENT-STATE.md` and `TASK-QUEUE.md`.
4. Reconcile any work completed after the plan's Base SHA.
5. Do not repeat broad repository discovery.

## External-evidence rule

Cloudflare is a fast-changing external platform.

Before implementing a service-specific slice, verify the relevant current official Cloudflare documentation. Record:
- official source;
- retrieval date;
- any plan/quota/pricing dependency that affects architecture.

Do not use stale plan assumptions as implementation authority.

## Execution rules

For each authorized task:
- confirm dependency readiness from current `main`;
- implement the smallest safe slice;
- preserve Tenant Isolation and Backward Compatibility;
- run focused tests before broad tests;
- self-review, Reviewer review, AWJ Guardian review;
- require green CI on exact final Head;
- record PRE_MERGE_REVIEW and Reviewed Head SHA;
- merge only under the currently applicable owner/standing merge policy;
- perform post-merge verification and record actual Merge SHA;
- do not deploy or mutate Production without explicit owner approval.

## Non-negotiable boundaries

- Railway remains the application origin unless a separate architecture decision says otherwise.
- Laravel/PostgreSQL remain business truth.
- No Cloudflare cache may make private/financial data cross-user or cross-tenant.
- No client-supplied tenant authority.
- No secrets in repository/logs/reports/screenshots.
- R2 remains private and ACL-free.
- No bucket-wide client listing.
- Turnstile never replaces server-side auth/authorization.
- WAF/Rate Limit never becomes undocumented business policy.
- Custom-domain provider remains a Decision Gate until explicitly accepted.
- Merge is not Deploy.

## Current start point

AWJ-R2-1 is merged via PR #1092 / Merge SHA:
`e6fc91d172c0759f1b7e422e9396b775995fc645`.

AWJ-R2-2 may have moved after this bootstrap was authored. Read current repository/PR evidence; do not infer status from this document.

## Decision escalation

Stop and send a Decision Packet for:
- Railway vs Cloudflare for SaaS custom-domain provider choice;
- material paid-plan commitment;
- nameserver/DNS architecture change;
- production security rule with meaningful false-positive risk;
- Cloudflare service becoming business authority;
- new persistent data store outside PostgreSQL/R2;
- destructive file migration;
- breaking auth/public API change;
- production deploy/release.

## Closure

Commit a closure report that distinguishes:
- code merged;
- Cloudflare configuration applied;
- Railway configuration applied;
- production deploy/verification;
- deferred services;
- costs/quotas observed;
- remaining Decision Gates.

Do not automatically begin a new major horizon after closure.
