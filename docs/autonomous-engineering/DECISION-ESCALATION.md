# AWJ Decision Escalation V1

## Principle

**Autonomous by default. Escalate by significance, not by ordinary uncertainty.**

Claude should solve normal engineering uncertainty itself through repository inspection, tests and research.

It should stop on the affected path when a decision would materially determine AWJ product behavior, architecture, security, accounting, data ownership, compatibility or long-term platform commitment.

## Must escalate

### Accounting / financial semantics
Examples:
- journal account mapping;
- recognition timing;
- tax treatment;
- valuation semantics;
- settlement/refund accounting;
- changing posted-document behavior.

### Tenant / branch / authorization architecture
Examples:
- changing tenant resolution;
- bypassing/scoping global scopes;
- new cross-tenant administration capability;
- changing ownership/authentication model.

### Destructive or hard-to-reverse data decisions
Examples:
- destructive migration;
- irreversible backfill;
- data deletion/rewriting;
- changing canonical identifiers.

### Breaking contracts
Examples:
- public API incompatibility;
- database contract that breaks existing clients;
- incompatible event/webhook contract;
- abandoning required backward compatibility.

### Strategic platform/provider commitment
Examples:
- payment provider;
- app runtime framework lock after proof gate;
- signing/account ownership model;
- critical hosting/storage architecture;
- major paid third-party dependency.

### Product/business policy with multiple valid answers
Follow AWJ configurable-policy principle. If uncertain whether a choice is technical correctness or business policy, escalate.

### Security trade-off
Any proposal that intentionally accepts meaningful security exposure, broadens credential scope, weakens isolation or changes secret custody.

### Material scope expansion
A discovered issue requires substantial work outside the authorized outcome.

### Conflicting authoritative decisions
Two accepted sources cannot both be satisfied safely.

## Usually do not escalate

Claude should decide and continue for:
- local naming/internal structure;
- small refactor required by the task;
- choosing an existing service/helper;
- adding validation/tests;
- task-caused CI repair;
- implementation pattern with no material external contract impact;
- query/index optimization that preserves semantics and is adequately tested;
- defensive error handling within accepted behavior.

## Escalation packet

Do not ask only "what should I do?"

Create:

### DECISION REQUIRED
**Decision ID:**  
**Task / blocker:**  
**Why a decision is required now:**  
**Current repository evidence:**  
**External evidence:** official/current sources where relevant  
**Option A:** benefits, risks, compatibility/cost  
**Option B:** benefits, risks, compatibility/cost  
**Other viable options:**  
**Claude recommendation:** with reasoning  
**What changes if accepted:**  
**What remains unchanged:**  
**Can unrelated work continue safely?:** YES/NO + exact work

Pause only work dependent on the decision. If other dependency-independent authorized tasks can safely continue, continue them.

## ADR rule

After Safwan/authorized reviewer resolves a material decision:
- create or update an ADR/decision record;
- record date, decision, context, alternatives, rationale and consequences;
- link affected tasks/docs;
- never silently rewrite old decision history; supersede it.

## Emergency safety stop

If repository evidence suggests current code may already cause:
- cross-tenant exposure;
- corrupt accounting;
- destructive data loss;
- credential leakage;
- unauthorized payment/order effects;

stop risky mutations, preserve evidence, report the issue immediately, and do not "fix forward" in production without explicit authorization.
