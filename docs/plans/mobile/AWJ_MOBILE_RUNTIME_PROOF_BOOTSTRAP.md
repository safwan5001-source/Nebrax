# AWJ Mobile Runtime Proof — Claude Bootstrap

Repository: `safwan5001-source/Nebrax`

## Mission

Execute **AWJ Mobile Runtime Proof Horizon V1** continuously under **نظام الأفق**.

## Start

1. Fetch latest `origin/main`.
2. Report exact Base SHA.
3. Read, in order:
   - `CLAUDE.md`
   - `docs/autonomous-engineering/00-START-HERE.md`
   - `docs/autonomous-engineering/AWJ-HORIZON-SYSTEM.md`
   - `docs/autonomous-engineering/AUTONOMOUS-ENGINEERING-PROTOCOL.md`
   - `docs/autonomous-engineering/QUALITY-GATES.md`
   - `docs/autonomous-engineering/DECISION-ESCALATION.md`
   - `docs/plans/mobile/AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1.md`
   - `docs/plans/store/AWJ_APP_BUILDER_PRODUCT_ARCHITECTURE_V1.md`
   - `docs/plans/store/RUNTIME_COMPATIBILITY_V1.md`
   - `docs/plans/store/COMMERCE_MOBILE_API_READINESS.md`
   - current `docs/autonomous-engineering/CURRENT-STATE.md` and `TASK-QUEUE.md`.
4. Verify the Commerce Mobile horizon remains closed and the committed `/commerce/v1` OpenAPI contract + guest/authenticated journey tests are present.
5. Do not perform broad project rediscovery.

## Execution

Start with `MOBILE-RUNTIME-1`.

For every task:
- inspect only relevant code/docs/tests;
- use current official platform docs when behavior may have changed;
- before adding non-trivial Flutter/native dependencies, record license, maintenance, security/native-permission and lock-in evidence;
- implement the smallest correct slice;
- run focused tests first, then risk-appropriate broader tests/builds;
- self-review as Implementer;
- review as Reviewer;
- review as AWJ Guardian;
- resolve all non-optional findings;
- inspect final diff;
- require exact-final-Head CI;
- record `PRE_MERGE_REVIEW: PASS` with exact Head SHA;
- merge under standing authority only when all gates pass;
- verify actual Merge SHA and integration on `main`;
- inspect post-merge checks and run focused smoke/regression when warranted;
- record `POST_MERGE_REVIEW: PASS` with actual Merge SHA;
- update durable state/report;
- automatically continue to the next dependency-ready task.

Any Head change after pre-merge review invalidates that review.

## Non-negotiable boundaries

- AWJ Commerce Core is business truth.
- No parallel pricing/stock/payment/shipping/order logic in Flutter.
- No schema-supplied tenant authority.
- No arbitrary executable remote code.
- No arbitrary HTTP action from merchant schema.
- No secrets/tokens in schema/logs/deep links/plain preferences.
- Secure session material must use the platform-secure-storage abstraction.
- Unknown security-significant schema/action input fails closed.
- Preserve Arabic default + English + RTL/LTR.
- Preserve backward compatibility.
- Treat runtime compatibility as explicit capabilities, not version numbers alone.
- Never remotely require a native capability before a compatible installed-runtime policy permits it.
- Store release/rollout must never be treated as proof that devices installed the binary.
- Last-known-good Experience caching is presentation recovery only; it must not become stale business authority or a secret cache.
- Offline-first commerce is out of scope, but safe no-network startup is required.
- Diagnostics must redact tokens, secret order/cart references, credentials and PII.
- No production deploy/release.
- No App Store/Google Play submission.
- No merchant signing/account ownership change.
- No paid/permanent provider commitment.

## Decision Escalation

Stop and send a Decision Packet if a material decision is reached, including:
- evidence;
- alternatives;
- tradeoffs;
- recommendation;
- impact;
- whether independent safe work can continue.

In particular, escalate:
- proposal to abandon Flutter for another runtime;
- permanent messaging/push provider;
- payment/native SDK/provider commitment;
- Apple/Google ownership/signing/release;
- breaking Commerce API change;
- destructive migration;
- major schema/runtime capability expansion;
- production action.

## Final report

At horizon closure, commit an MD report containing:
- what was proven;
- all PRs / Merge SHAs;
- files/components introduced;
- tests and exact results;
- Android/iOS build evidence;
- RTL/LTR/accessibility evidence;
- deep-link/push evidence;
- security/Guardian findings;
- runtime compatibility results, including capability manifest, version-skew and rollback matrix;
- last-known-good/no-network startup evidence;
- cold-start/resume/network interruption/retry evidence;
- performance measurements: cold/warm startup, first meaningful render, schema path, list/image behavior, memory/jank observations and release artifact sizes;
- dependency/license/security review summary;
- Flutter viability conclusion;
- known limitations/deferred items;
- remaining Decision Gates;
- next recommended horizon.

Do not start the next major horizon automatically.
