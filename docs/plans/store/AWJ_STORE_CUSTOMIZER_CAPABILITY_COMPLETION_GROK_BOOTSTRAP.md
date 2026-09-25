# Grok Bootstrap — AWJ Store Customizer Capability Completion Horizon

Use this file as the session bootstrap.

## Command

**نفّذ هذه المهمة بنظام الأفق.**

Repository:

`safwan5001-source/Nebrax`

Start by running:

`git fetch origin`

Then verify the exact latest `origin/main`.

Known base when this horizon was documented:

`1a0cac9863e48eb4eb2e4870e1f0aa70878382af`

If `origin/main` is newer, use the newer SHA and report it.

## Read first

1. `docs/autonomous-engineering/AWJ-HORIZON-SYSTEM.md`
2. `docs/autonomous-engineering/CURRENT-STATE.md`
3. `docs/plans/store/AWJ_STORE_CUSTOMIZER_BUILD_DONT_HIDE_DECISION.md`
4. `docs/plans/store/AWJ_STORE_CUSTOMIZER_CAPABILITY_COMPLETION_HORIZON.md`
5. `docs/plans/store/AWJ_STORE_CUSTOMIZER_CAPABILITY_COMPLETION_TASK_QUEUE.md`
6. previous storefront visual completion evidence only as needed; do not repeat broad discovery.

## Mission

Build the intended merchant-facing Store Customizer capabilities end-to-end instead of hiding them because they are incomplete.

Priority:

`banner → featured → offers → benefits → appPromo → customContent`

Do not assume this order is the final dependency order. The focused Evidence Pass may reorder independent tasks.

Also carry in one small cleanup from prior review:

`STORE-CUSTOMIZER-CLEANUP-1` — verify/fix nested interactive semantics in fixed-chrome click-to-edit without redesigning the builder.

## Autonomous execution

After the Evidence Pass and durable task classification:

- implement dependency-ready work;
- open small PRs;
- test;
- self-review;
- reviewer review;
- AWJ Guardian review;
- exact-head CI;
- record PRE_MERGE_REVIEW: PASS;
- merge;
- post-merge verify;
- record POST_MERGE_REVIEW: PASS;
- update durable state;
- continue automatically to the next genuinely-ready task.

Do not wait for “استمر” between routine tasks.

## Hard constraints

- Tenant Isolation first.
- Preserve `commerce.manage`.
- Draft must not become public before publish.
- Prices/discounts/tax/stock/availability remain server-owned.
- Featured products reference products; they do not copy financial truth.
- Offers must use authoritative AWJ offer/promotion data.
- No arbitrary HTML/CSS/JS/iframe.
- Backward compatibility for existing presentation documents.
- Unknown values fail closed.
- No broad refactor outside scope.
- No Deploy / Production Release / Production Migration.

## Decision Gate behavior

Do not stop just because a backend is missing.

Stop only for a material decision such as schema/migration risk, tenant/security/RBAC architecture, storage-provider architecture, or financial/pricing authority.

When blocked, issue a Decision Packet and continue independent work where possible.

## Final deliverable

Create:

`docs/plans/store/AWJ_STORE_CUSTOMIZER_CAPABILITY_COMPLETION_CLOSURE_REPORT.md`

Report:
- final main SHA;
- every PR / Branch / Base SHA / Head SHA / Merge SHA;
- tests and CI;
- visual QA;
- RTL/LTR;
- mobile/desktop;
- security / tenant isolation;
- backward compatibility;
- performance;
- capabilities completed;
- Decision Gates;
- remaining deferred/out-of-scope items;
- final Horizon status.

At Horizon End, stop. Do not deploy and do not start another main horizon automatically.
