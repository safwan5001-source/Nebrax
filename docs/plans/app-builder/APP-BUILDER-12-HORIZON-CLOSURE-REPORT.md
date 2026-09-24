# AWJ App Builder Horizon V1 — Closure Report (APP-BUILDER-12)

STATUS: merged — post-merge review PASS
DATE: 2026-09-24

## Horizon outcome

**AWJ App Builder Horizon V1 is CLOSED.** All 12 tasks resolved: 10 completed and merged
(`APP-BUILDER-1/2/3/4/5/6/8/9/10/11`), 1 explicitly deferred as a genuine Decision Escalation Gate
(`APP-BUILDER-7`), 1 is this closure task. The horizon delivered a real, working, tenant-isolated,
RBAC-gated App Builder: a merchant can create an app, edit it visually (add/remove/reorder
components, edit typed properties/actions, undo/redo), sync theme from their real store, manage
pages/navigation, apply a curated template, validate compatibility, publish an immutable versioned
experience, and roll back to any prior version — end to end, proven by
`APP-BUILDER-11`'s integrated test, not just by each piece's own isolated tests.

One real scope boundary surfaced during execution and was handled correctly rather than papered
over: **live Commerce data binding and live Commerce runtime dispatch were never built anywhere in
the accepted contract** — not by this horizon, and not by the Mobile Runtime Proof V1 horizon this
one builds on. Both `APP-BUILDER-7` (Data/Actions/Conditions/Visibility) and the "bind real
Commerce resource / proven Flutter runtime consumes" clause of `APP-BUILDER-11`'s original wording
hit this same boundary. Neither was forced through by inventing a contract on the spot; both are
recorded below as one connected deferred architecture track for owner/ChatGPT review.

## What is COMPLETE — proven by the current, accepted App Builder contract

| Task | Outcome | PR (Merge SHA) |
|---|---|---|
| APP-BUILDER-1 | Domain/persistence foundation — `BuilderApp`/`BuilderDraftExperience`/`BuilderPublishedExperienceVersion`, tenant/RBAC boundary, immutable versioning | #969 (`0560429d`) |
| APP-BUILDER-2 | Schema validation + runtime capability contract — `AppSchemaParser`/`CompatibilityResolver` realigned to the real, tested Mobile Runtime contract | #971 (`8844881d`) |
| APP-BUILDER-3 | Component/Action/Data Resource registries — full metadata for all 15 components/6 actions; `DataResourceRegistry` deliberately empty (first evidence of the deferred boundary) | #973 (`4256d0aa`) |
| APP-BUILDER-4 | App Manager + creation wizard — apps list, three creation paths, safe minimum shell | #975 + docs #976 (`163bcc1c`) |
| APP-BUILDER-5 | Builder workspace shell — Pages/Layers/canvas/Inspector, locale/device preview, read-only baseline | #977 + docs #978 (`f48d583f`) |
| APP-BUILDER-6 | Visual editing + history — select/add/remove/reorder, typed property/action editing, undo/redo, dirty/save | #979 (`08c143b6`) |
| APP-BUILDER-7 | Data/Actions/Conditions/Visibility — **deferred, `decision_required`** (see below) | — |
| APP-BUILDER-8 | Theme + Use My Store Design — theme tokens, Detect→Diff→Preview→Apply sync from real Store Customizer data | #983 (`1248223`) |
| APP-BUILDER-9 | Templates + navigation/pages — page add/remove/set-home, real `navigate` action picker, curated template set | #985 (`c054c9c2`) |
| APP-BUILDER-10 | Validate/Publish/Version/Rollback foundation — standalone Validate endpoint, Publish flow, versions page, restore-to-draft | #988 (`b69f9812`) |
| APP-BUILDER-11 | Integrated vertical proof (owner-redefined scope) + UX/security closure evidence | #990 (`a7a2e0c3`) |
| APP-BUILDER-12 | This closure report | (pending) |

Every merge above is independently verified in its own implementation report: single-parent
squash, zero content drift from the reviewed pre-merge head via a path-restricted diff, and
post-merge CI green on the merge commit itself — not just the pre-merge head.

### Security / tenant isolation

Every mutating and read route under `/api/app-builder/apps/*` is scoped by `TenantContext`
(`BaseModel`/`TenantScope`, no manual-scope-bypassing query anywhere in this horizon's code).
Cross-tenant access returns a safe 404, never a leak, verified with real HTTP tests at every task
(`BuilderAppTest`, extended and re-verified end to end by `AppBuilderIntegratedProofTest` in
`APP-BUILDER-11`). Published versions are structurally immutable (`booted()` guard rejects
update/delete unconditionally) — no mutation path exists anywhere, audited fresh in every task's
AWJ Guardian self-review.

### RBAC

Three distinct permissions from `APP-BUILDER-1` onward: `apps_builder.view` (read),
`apps_builder.manage` (draft edit + validate), `apps_builder.publish` (deliberately narrower than
`.manage` — publish is irreversible and customer-facing). Verified with real HTTP tests at every
task that touches a route, including the specific assertion that `.publish` is required and
`.manage` alone is insufficient (`APP-BUILDER-10`), and that a role with neither permission is
denied reads as well as writes (`APP-BUILDER-11`).

### App Schema stays declarative, untrusted configuration

Non-negotiable across all 11 completed tasks: no schema field ever selects tenant authority,
executes code, or reaches the database directly. `AppSchemaParser`/`CompatibilityResolver` are the
sole gate, server-side, unchanged in shape since `APP-BUILDER-2`. `APP-BUILDER-11`'s boundary test
is executable proof, not just a written claim, that the full 11-task lifecycle never weakened this:
a `bindings` key is still structurally rejected and `DataResourceRegistry` is still empty after the
complete journey runs.

### Accessibility / bidi (ar/en, RTL/LTR)

- Every major slice (`APP-BUILDER-4/5/6/8/9/10`) got its own dedicated UI/UX Evidence Pass before
  implementation, validating ar/en + RTL/LTR, key states, and progressive disclosure against the
  AWJ Design System — never a mechanically-reused Store Customizer pattern.
- The Builder canvas genuinely re-renders RTL/LTR live from the selected preview locale
  (`web/src/modules/app-builder/canvas.tsx`'s `dir` binding, reconfirmed by direct code reading in
  `APP-BUILDER-11`'s closure evidence).
- `ar.json`/`en.json` key parity for every `appBuilder.*` namespace is enforced by the codebase's
  own `i18n-keys.test.ts` guard, part of the full frontend suite every task ran.

### Runtime compatibility

`AppSchemaParser` and `CompatibilityResolver` are direct ports of the real, tested Mobile Runtime
contract (`mobile/lib/schema/app_schema.dart`, `capability_manifest.dart`, `compatibility.dart`) —
never an illustrative or invented shape, corrected once at `APP-BUILDER-2` after `APP-BUILDER-1`
had used the architecture doc's aspirational shape instead. A schema that requires an unsupported
component/action fails the whole publish closed; an optional one safely degrades. This contract was
never touched or weakened by any later task.

### Regression evidence (cumulative, this horizon)

Final state after `APP-BUILDER-11`: full backend suite **4638 passed, 35 pre-existing failures
(missing `bcmath` PHP extension in the local build — unrelated to App Builder, present since before
this horizon began), 49 skipped**; full frontend suite **2076/2076 passed** (296 files); `npm run
build` succeeds; `npx tsc --noEmit` zero errors in any App Builder file. Every task's own report
carries its own before/after test counts, confirming the delta at each step was exactly that task's
new tests — zero unexplained regressions across all 11 completed tasks.

## What is DEFERRED — one connected architecture track, not silently dropped

Both items below hit the identical, real boundary: the accepted App Schema contract and Mobile
Runtime capability manifest have **no concept of a live Commerce data resource** anywhere in them.

1. **`APP-BUILDER-7` — Data/Actions/Conditions/Visibility (Develop mode).** Evaluated for
   implementation (2026-09-24) and found not ready: three of its four named concepts (Data,
   Conditions, Visibility) have no backing in the accepted, tested App Schema contract.
   `SchemaComponent._allowedKeys` in `mobile/lib/schema/app_schema.dart` accepts only
   `type/id/optional/props/children/action` — no `bindings`, `conditions`, or `visibility` field
   exists. Building any of them requires inventing an expression/condition engine or a Data Source
   Registry contract, both explicitly listed as **not locked** in
   `AWJ_APP_BUILDER_PRODUCT_ARCHITECTURE_V1.md`'s §"Open Decisions after 04B". Owner decision:
   kept explicitly deferred (`decision_required`), never implemented, never invented around.

2. **`APP-BUILDER-11`'s original "bind real Commerce resource / proven Flutter runtime consumes"
   clause.** The horizon doc's literal task-11 wording asked for something the accepted contract
   cannot do: `DataResourceRegistry::RESOURCES` is deliberately empty, every registered `Action` is
   `DISPATCH_PROVEN_NOOP` (real Commerce API dispatch — `MOBILE-RUNTIME-4/5` — was never built, and
   that work belongs to the **already-closed** Mobile Runtime Proof V1 horizon, not this one).
   Escalated; owner decision (2026-09-24, option 2): redefine the task around what is actually
   built, and record this specific clause as deferred rather than reinterpreted or quietly
   satisfied with a fixture. Full finding: `docs/plans/app-builder/APP-BUILDER-11-UX-EVIDENCE-PASS.md`.

**These are one connected track, not two independent gaps**, because they share one root cause: no
Data Source Registry contract has been locked yet, anywhere in AWJ's accepted architecture. Neither
can be resolved by this horizon's own authority — both require a genuine architecture/product
decision (locking the Data Source Registry contract's exact shape, and building the corresponding
runtime dispatch — either within a follow-on to the closed Mobile Runtime Proof horizon, or a new
one) before any future task can touch them honestly.

## Known limitations carried forward (not blockers, not silently dropped)

- **Theme token visual completeness** (`APP-BUILDER-8`): radius/density/product-card-style tokens
  are persisted, diffed, and synced correctly, but only the primary color is reflected live in the
  Builder canvas preview today (`tailwind.config.ts`'s `borderRadius.DEFAULT` is a fixed value, not
  CSS-variable-driven). Recorded as an explicit, scoped gap in `APP-BUILDER-8`'s own evidence pass
  and report — a real, already-identified follow-up for whichever future task next touches the
  canvas rendering pipeline, not a regression from this closure.
- **Local test-environment gap** (present since before this horizon, surfaced by every task's full
  backend suite run): the local build's PHP is missing the `bcmath` extension, causing 35
  `FuelSupplyReceivingTest`/`FuelCostBasisService` failures unrelated to App Builder in every run.
  Confirmed via `diff -rq` in multiple tasks not to reproduce on real CI. Not an App Builder defect;
  carried forward as discovered backlog (also noted: `setup.sh` never copies `app/Mail/*.php`,
  unlike `ci.yml`/`deploy/assemble.sh` — a separate, already-identified environment-parity gap).
- **Full drag-heavy authoring stays desktop-optimized** (`APP-BUILDER-5`): an intentional,
  documented design decision under the horizon's own explicit allowance ("full drag-heavy
  authoring may remain desktop-optimized if documented and intentionally designed"), not an
  unresolved gap — the responsive/mobile admin baseline for essential management/review actions is
  built and evidence-passed.

## Explicitly out of scope for this horizon (unchanged, never touched)

Per the horizon doc's own boundary, none of the following were built or approached: App
Factory/build farm, Apple/Google signing or account ownership, App Store/Google Play
submission/release, production rollout, a permanent push/messaging provider, payment-provider
selection or native payment SDK commitment, arbitrary merchant code/HTTP/packages/SQL/eval, a
marketplace/extensions ecosystem, a general-purpose workflow/automation engine, advanced
collaboration/multiplayer editing, a full analytics platform, offline-first commerce, AI-generated
executable runtime behavior, real-device Preview Session infrastructure, or a broad Store
Customizer redesign.

## Next-horizon recommendation

1. **A dedicated "App Builder Data & Dynamic Behavior" decision track** — lock the exact Data
   Source Registry contract shape (what resources, what binding syntax in the App Schema, what
   read/write authority boundary) as a genuine architecture decision before any implementation
   task is scheduled. This single decision unblocks both `APP-BUILDER-7` and the deferred portion
   of `APP-BUILDER-11` at once — they should be re-scoped together, not separately, once it lands.
2. **A corresponding Mobile Runtime follow-on** (or a new horizon) to build real Commerce API
   dispatch (`MOBILE-RUNTIME-4/5`) — every registered `Action` today is `DISPATCH_PROVEN_NOOP`;
   without this, even a locked Data Source Registry contract cannot produce a genuinely live
   merchant experience end to end.
3. **`APP-BUILDER-8`'s canvas token-rendering gap** (radius/density/product-card-style not yet
   visually reflected) is a small, well-scoped, low-risk follow-up independent of the above — worth
   picking up whenever a task next touches the canvas rendering pipeline.
4. **Preview & Testing horizon** remains explicitly not started, per this horizon's own boundary
   and the bootstrap's closure instruction — a separate authorization decision for the owner.

## Merge and post-merge review

This closure report merged as part of PR #991 (which also carried `APP-BUILDER-11`'s own
post-merge documentation, pushed to the same still-open branch before that earlier docs-only
content had merged) via squash as `ac6c375f669adfbcb9dc301c8296c42d8506c4b3`, pre-merge head
`9d0828d8a121bf29ffea44762b6b5b15fb0c79a7`.

- **Single-parent squash confirmed:** `git log -1 --format=%P origin/main` on the merge commit
  returns exactly one parent (`a7a2e0c...`, the prior merge base) — a real squash.
- **Zero content drift confirmed:** `git diff <pre-merge-head> origin/main -- docs/plans/app-builder/
  docs/autonomous-engineering/` returns empty.
- **Post-merge CI confirmed green on the merge commit itself:** `CI` (`.github/workflows/ci.yml`,
  sqlite+pgsql) — run `36009975210` — **completed / success**. No `Web CI` run was expected or
  triggered, since the diff touches only `docs/`.

**POST_MERGE_REVIEW: PASS.**

## Self-review

### Implementer

Closed the horizon honestly: every completed task is independently verified (merge SHA, drift
check, post-merge CI), and the one real architectural gap this horizon surfaced is recorded once,
clearly, tied to its actual root cause — not scattered across two unrelated-looking footnotes.

### Reviewer

- Verified every PR number and merge SHA cited above against `docs/autonomous-engineering/
  CURRENT-STATE.md`'s own execution log — none guessed or reconstructed from memory.
- Confirmed the deferred-track framing matches the owner's own 2026-09-24 instruction exactly:
  `APP-BUILDER-7` and `APP-BUILDER-11`'s real-Commerce-binding clause are named as one connected
  follow-up track, not marked done, not silently dropped.
- Confirmed the "known limitations" section cites only gaps actually on record in a prior task's
  own report (`APP-BUILDER-8`'s canvas gap, the pre-existing `bcmath`/`setup.sh` environment gap) —
  no fabricated or assumed gap was introduced to pad this section.

### AWJ Guardian

- Tenant/RBAC/App-Schema-declarative-only invariants held across all 11 completed tasks, verified
  fresh at each one's own AWJ Guardian review, and re-verified end to end by `APP-BUILDER-11`'s
  integrated proof and boundary test.
- No production deploy, release, or App Factory/signing/submission step was taken or approached at
  any point in this horizon.
- Per the horizon bootstrap's own "Horizon End" instruction, this session STOPS after this report
  merges — it does not automatically start Preview & Testing or any new horizon.
