# MOBILE-RUNTIME-2 — Implementation Report

STATUS: review (implementation complete, pre-merge review pending CI observation)
DATE: 2026-09-22

## Outcome

A pure-Dart App Schema parser/validator and runtime-compatibility kernel
exists under `mobile/lib/schema/`, satisfying Quality Gate B's
MOBILE-RUNTIME-2 portion: versioned schema parsing/validation, a capability
manifest model, a deterministic compatibility resolver with fail-closed/
fallback semantics, version-skew and rollback-selection logic, and
malicious/unknown-input negatives. No Flutter widget/rendering code exists
yet — that is MOBILE-RUNTIME-3's Component + Action Registry.

## Repository evidence / root cause

Horizon-launch continuation, not a bug fix. Evidence checked before
starting:
- `docs/plans/mobile/AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1.md` §4 MR-04 (App
  Schema shape: schemaVersion/minRuntimeVersion, page definitions, approved
  component instances, typed props/bindings, allowlisted actions,
  navigation, theme tokens, compatibility/fallback) and MR-05 (Action
  Registry allowlist) fix the exact component/action identifier lists this
  task's allowlist must match.
- `docs/plans/store/RUNTIME_COMPATIBILITY_V1.md` (full document, read in
  this session before MOBILE-RUNTIME-1) fixes the compatibility principle,
  capability-manifest concept, fail-closed rules (§8), safe-fallback rules
  (§9), version-skew/rollback expectations (§15, §35), and explicitly
  leaves "exact capability-manifest format" and "semantic version vs
  integer capability versions" open (§36) — meaning MOBILE-RUNTIME-2 may
  choose a concrete format as long as the principles hold, not required to
  invent an untested one from the horizon's illustrative JSON alone.
- `mobile/` from MOBILE-RUNTIME-1 (merged, PR #948) — workspace, toolchain,
  CI baseline already exist; this task adds to `lib/`/`test/` only.
- No existing `lib/schema/` or equivalent — confirmed via `ls mobile/lib`.

## Approach chosen

1. **Schema data model + parser** (`lib/schema/app_schema.dart`):
   `AppSchema.parse(String)` — strict-allowlist JSON parsing. Every object
   level (schema root, component node, action, theme, navigation) only
   accepts a fixed, named set of keys; any other key throws
   `SchemaFormatException('unknown_field', ...)`. This is the concrete
   mechanism behind MR-04's "no secret-bearing schema fields... no tenant
   switching": there is structurally no field a schema author (or an
   attacker controlling published content) could add to carry a tenant
   override or a secret, because an unrecognized field is rejected outright
   rather than silently ignored or passed through.
2. **Bounded complexity**: component tree depth (32), node count (500), and
   props nesting/collection size (8 / 64) are all capped during parsing,
   directly serving `AWJ_APP_BUILDER_PRODUCT_ARCHITECTURE_V1.md` §13A-D's
   "bounded in complexity" requirement and guarding against a
   pathological/oversized published schema.
3. **No code-execution surface, by construction, not by blocklist**: props/
   action-params values are restricted to JSON-safe scalars/collections
   (`_validateJsonSafeValue`). There is no "expression" field, no template
   string evaluation, nothing resembling `eval`. This satisfies MR-04's "no
   arbitrary executable code... no remote expressions with general code
   semantics" architecturally (the format has no such capability) rather
   than by trying to blocklist dangerous-looking strings, which the App
   Builder architecture doc itself treats as the wrong approach (§13A: "no
   arbitrary code/eval" as a structural constraint, not a content filter).
4. **Registry identifiers, not yet a rendering registry**
   (`lib/schema/registry_identifiers.dart`): a fixed `Map<String,int>` of
   component type names and action type names, copied verbatim from the
   horizon's MR-04/MR-05 candidate lists. This lets the schema
   parser/compatibility layer reject unknown/unsupported types on its own
   authority, without depending on MOBILE-RUNTIME-3's actual widget-
   rendering/action-dispatch implementation existing yet — the two tasks
   share one identifier source of truth (`RuntimeCapabilities`) so they can
   never drift apart silently.
5. **Capability manifest** (`lib/schema/capability_manifest.dart`): models
   `RUNTIME_COMPATIBILITY_V1.md` §4's concept — platform, runtime version,
   supported schema range, and the two identifier maps above.
   `CapabilityManifest.current(platform)` is the one production constructor;
   tests construct alternate manifests directly to simulate older/newer
   runtimes and iOS/Android divergence without needing two real app builds
   (§26: "never assume iOS and Android carry the same capability
   simultaneously").
6. **Compatibility resolver** (`lib/schema/compatibility.dart`): a single
   pure function, `CompatibilityResolver.resolve(schema, manifest) ->
   CompatibilityResult`. Sealed result type: `RenderableExperience` (with a
   pruned, fallback-applied component tree + a list of what was omitted and
   why) or `IncompatibleExperience` (with a machine-readable reason enum).
   Rule implemented exactly per the horizon's compatibility contract (§6):
   schema-version-too-new/too-old and runtime-too-old fail closed
   immediately; a missing named `requiredCapabilities` entry fails closed;
   walking the component tree, an unsupported component/action is either
   safely omitted (only when that exact node was explicitly marked
   `optional: true` — the *default* is `false`, so the safe-by-default
   posture is fail-closed, matching RUNTIME_COMPATIBILITY_V1.md §9's "fallback
   is allowed only when ... explicitly declares it") or propagates a
   fail-closed result up to the whole document. Marking a node optional
   makes its *entire subtree* one safely-omittable unit — a deliberate
   simplification recorded in the code's own doc comment, reasoned there
   fully.
7. **Rollback selection** (`selectRollbackTarget`): picks the newest schema
   from a candidate list that the resolver actually finds `Renderable`,
   returning `null` (never a guess) when none qualify — directly implements
   RUNTIME_COMPATIBILITY_V1.md §15 ("verify target Experience compatibility
   ... before rollback").
8. **No new dependency.** Wrote a ~50-line first-party `SchemaVersion`
   comparator (`lib/schema/schema_version.dart`) instead of adding a semver
   package: this kernel only ever compares AWJ-owned `x.y.z` strings with no
   pre-release/build-metadata suffixes, a problem narrow enough that MR-19's
   "whether a narrower first-party implementation is reasonable" applies
   directly.
9. **Test fixtures** (`test/schema/test_schemas.dart`,
   `schema_parser_test.dart`, `compatibility_test.dart` — 35 new tests)
   cover every fixture class the horizon's §6 lists that is meaningfully
   testable at this pure-kernel layer: current schema; older-but-supported
   schema; new-runtime + older-Experience; old-runtime rendering what it
   still supports; unknown optional component/action (fallback); unknown
   required component/action (fail closed); too-new/too-old schema version;
   runtime-too-old; missing named capability; malformed schema (bad JSON,
   wrong root type, unknown fields, missing fields, bad version format,
   non-list children, wrong root component type, dangling
   `initialPageId`, oversized/too-deep trees); iOS/Android capability
   divergence (same schema, different platform manifests, different
   results); rollback selecting only a compatible candidate and skipping an
   incompatible newer one; rollback returning `null` when nothing
   qualifies. The two fixtures explicitly **not** covered here — "no-network
   startup with/without a compatible last-known-good" — require an actual
   runtime/network layer that does not exist until later tasks
   (MOBILE-RUNTIME-5/10); noted as discovered/expected backlog below, not a
   gap in this task's own scope.

## Why this approach fits AWJ

- Zero touch on `app/`, `database/`, `routes/`, or any PHP/Laravel code —
  this is a new, currently-unwired Dart kernel with no network/tenant/auth
  surface at all.
- Reuses MOBILE-RUNTIME-1's workspace/toolchain unchanged; no new
  dependency, so no new license/maintenance/security review is owed beyond
  what MOBILE-RUNTIME-1 already recorded.
- Directly encodes AWJ's non-negotiable horizon boundaries (no tenant
  switching, no secret fields, no arbitrary code/HTTP/SQL) as *structural*
  parser constraints rather than a runtime policy that could be bypassed —
  the strongest available control for a proof this early.
- Keeps strict scope discipline: does not build the Component/Action
  Registry's actual widget rendering or action dispatch (MOBILE-RUNTIME-3),
  does not touch the Commerce client (MOBILE-RUNTIME-4), does not add
  screens (MOBILE-RUNTIME-5).

## Changed files

```
mobile/lib/schema/schema_version.dart          (new)
mobile/lib/schema/registry_identifiers.dart    (new)
mobile/lib/schema/capability_manifest.dart     (new)
mobile/lib/schema/app_schema.dart              (new)
mobile/lib/schema/compatibility.dart           (new)
mobile/lib/schema/schema.dart                  (new — barrel export)
mobile/test/schema/test_schemas.dart           (new — shared fixture builders)
mobile/test/schema/schema_parser_test.dart     (new — 19 tests)
mobile/test/schema/compatibility_test.dart     (new — 16 tests)
docs/plans/mobile/MOBILE-RUNTIME-2-IMPLEMENTATION-REPORT.md  (new, this file)
```

## Tests and exact results

```
$ flutter analyze
Analyzing mobile...
No issues found! (ran in 7.8s)

$ flutter test
...
00:01 +34: /home/user/Nebrax/mobile/test/widget_test.dart: AwjMobileRuntimeApp defaults to RTL text direction
00:01 +35: All tests passed!
```

35 tests total: 33 new (19 parser + 16 compatibility/rollback) + the 2
pre-existing MOBILE-RUNTIME-1 shell tests, all green. No test was
weakened, skipped, or deleted to reach green.

## Build / lint / typecheck

`flutter analyze` (above) — no separate typecheck step in Dart. No build
attempted (out of this task's scope; Gate G is MOBILE-RUNTIME-9's).

## CI

Not yet observed on GitHub Actions — PR not yet opened at the time of
writing this section. Updated once CI is observed on the exact PR head.

## Pre-merge review

- PRE_MERGE_REVIEW: **pending** — recorded once CI is green on the exact
  PR head (Gate 9).

## Merge

- Merge status: not yet opened/merged.

## Post-merge review

- POST_MERGE_REVIEW: not yet applicable.

## Self-review

### Implementer
Did I satisfy MOBILE-RUNTIME-2's actual outcome ("parser/validator/version/
fallback")? Yes — see Gate B mapping above. Is there a simpler safe design?
Considered skipping the props JSON-safety walk (redundant since `jsonDecode`
already can't produce non-JSON values) — kept it anyway because it is also
where the size/depth *bound* lives, which is not redundant; removing it
would drop that guard. Did I reuse existing authority instead of
duplicating business logic? N/A — no business logic (pricing/stock/tenant)
exists in this layer by design; that is the point of MR-03. Are failure
states deliberate? Yes — `SchemaFormatException` carries a stable `code`
for every rejection path, and `IncompatibleExperience` carries a
machine-readable `reason` enum; no failure is a silently-swallowed
exception or an unstructured string.

### Reviewer
What would I reject if this PR came from another engineer? I specifically
checked: (1) that the default for `optional` is `false`, not `true` — a
flipped default would make the resolver fail-open instead of fail-closed,
which is exactly backwards for a security-relevant control (verified by the
"unsupported required component/action fails closed" tests using the
*default*, not an explicit `optional: false`); (2) that marking a subtree
optional cannot be used to smuggle a *required*, security-sensitive
capability past the check — walked the recursion by hand (see code comment
on `_resolveComponent`) and concluded this is an accepted, intentional
simplification (an optional ancestor makes its whole subtree droppable),
not an oversight, and documented why; (3) that `requiredCapabilities`
checking the same identifier namespace as component/action types (rather
than the horizon's illustrative dotted-namespace example) is a recorded,
reasoned V1 choice, not an unnoticed deviation — added a doc comment on
`CapabilityManifest.namedCapabilityVersion` explaining it, since
`RUNTIME_COMPATIBILITY_V1.md` §36 explicitly leaves the exact format open.
Is any code broader than the task? No — no widget code, no Commerce client
code exists in this diff. Are tests proving behavior rather than
implementation trivia? Yes — every test asserts on the public
`CompatibilityResult`/`SchemaFormatException.code` contract, not on private
helper internals.

### AWJ Guardian
Can Tenant A affect/read Tenant B? Not applicable — no network/tenant
context exists in this pure-Dart kernel; the parser's unknown-field
rejection specifically defeats a schema attempting to smuggle a `tenantId`
field at all (tested explicitly). Can branch boundaries be bypassed? Not
applicable, same reason. Is any financial value computed with unsafe types
or client authority? No — this layer carries zero pricing/stock/payment
data; MR-04/MR-03 both explicitly keep authoritative commerce data server-
side, and no arithmetic on money exists anywhere in this diff. Can
authorization be bypassed by IDs/headers/host/schema input? Not
applicable — no auth exists yet (MOBILE-RUNTIME-4). Is posted accounting
immutable? Untouched — no PHP/Laravel code imported or referenced. Could
retries duplicate side effects? No side effects exist (pure functions, no
I/O). Could old clients/tenants break? No — nothing outside `mobile/`
depends on this new kernel; it is not yet wired into `main.dart`/`app.dart`.
Are secrets/PII exposed in logs/errors/artifacts? No secret material exists
anywhere in this layer, and no logging was added.

## Accounting impact

None. No accounting code, journal entries, or financial computation exists
in this task's diff.

## Tenant / branch isolation impact

None — no network call, no data access, no tenant-aware code path exists in
this pure-Dart parsing/compatibility kernel.

## Security / authorization impact

Positive, structural: the schema format has no channel for tenant
override, secret material, arbitrary code, arbitrary HTTP, or SQL, enforced
by strict key-allowlisting and JSON-safe-value validation at parse time
(tested with explicit malicious-input fixtures). No new attack surface
introduced — this code is not yet invoked by anything reachable from
outside `mobile/lib/schema/` and its own test suite.

## Backward compatibility

Fully preserved — no existing file outside `mobile/lib/schema/` and
`mobile/test/schema/` (both new directories) was modified. `lib/app.dart`/
`lib/main.dart` are unchanged and do not yet import this kernel.

## API / DB / migration impact

None.

## External research used

- `docs/plans/store/RUNTIME_COMPATIBILITY_V1.md` (already read in full this
  session) — the compatibility principle, fail-closed rules, safe-fallback
  rules, and explicit open decisions this task's design choices are
  grounded in and cross-referenced against throughout the code comments.
- No new external (web) research was needed for this task — it implements
  an already-accepted AWJ-owned contract rather than adopting external
  platform behavior.

## Risks / remaining work

- The two "no-network startup" compatibility fixtures from horizon §6 are
  not covered here — they require an actual runtime/network layer that
  does not exist until MOBILE-RUNTIME-5 (Home/Product/Cart) and are
  evidenced at MOBILE-RUNTIME-10. Recorded as expected sequencing, not a
  gap in this task's own Gate B scope (which is the parser/compatibility
  kernel, not the running app).
- `RuntimeCapabilities.components`/`.actions` currently exist only as
  identifiers with capability version `1` — MOBILE-RUNTIME-3 is the task
  that gives each of them an actual typed prop schema and Flutter widget.

## Discovered backlog

None discovered beyond what the horizon document already scopes into later
tasks.

## Git state

- Branch: `claude/awj-mobile-runtime-horizon-v1-g0n8mm`
- PR: (recorded once opened)
- Base SHA: `12109a204abf7950d3818243ef31380b194505d3` (`origin/main`, PR #949)
- Head SHA: `dcec5eecea5a99c1735b7cf33d58456b4b61c2d0` (pushed)

## Recommended next dependency-ready task

`MOBILE-RUNTIME-3` (Component + Action Registry) — dependency-ready only
after this task's Post-Merge Review passes. `MOBILE-RUNTIME-4` (Commerce
client) only depends on `MOBILE-RUNTIME-1` and could also proceed in
parallel per the horizon's dependency table, but this session continues
sequentially per نظام الأفق's "do not optimize for number of PRs" guidance.
