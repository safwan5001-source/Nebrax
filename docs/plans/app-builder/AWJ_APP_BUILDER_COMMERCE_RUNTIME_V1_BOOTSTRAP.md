# AWJ App Builder — Commerce Data & Dynamic Runtime V1 — Bootstrap

Continuation horizon after **AWJ App Builder Horizon V1** (CLOSED, see
`docs/plans/app-builder/APP-BUILDER-12-HORIZON-CLOSURE-REPORT.md`). Owner-issued mission,
recorded here verbatim as the durable bootstrap record per `AWJ-HORIZON-SYSTEM.md`'s
"قبل إطلاق التنفيذ" step 9.

## Mission (owner-issued, condensed)

Resolve the architectural boundary that caused `APP-BUILDER-7` and part of `APP-BUILDER-11` to be
deferred: lock a safe Data Source / Resource Registry contract, connect App Builder components to
real AWJ Commerce data, implement constrained Conditions/Visibility, implement real Commerce
runtime dispatch, complete the deferred `APP-BUILDER-7` scope, prove the mobile experience consumes
the same Commerce Core as the AWJ Store, complete an App Builder UX/localization polish pass, close
the known Builder canvas theme-token rendering gap, and prove the resulting path end to end.

Non-negotiable: **one Commerce Core, multiple presentation channels** — the App Builder never owns
commerce data or business rules, only presentation/experience configuration. Tenant/auth/session
authority never comes from App Schema. No arbitrary JS/eval/expressions/SQL/GraphQL/HTTP/executable
code in schema. Backward compatibility with already-published Builder experience versions is
mandatory.

**Phase 1 (this phase) is Evidence & Architecture only — implementation is explicitly forbidden
until the Decision Gate below is approved.** Preview & Testing infrastructure is not included and
must not be started without separate owner authorization.

## Phase 1 required reading (read in this order before continuing any follow-on task)

- `CLAUDE.md`
- `docs/autonomous-engineering/AWJ-HORIZON-SYSTEM.md`
- `docs/autonomous-engineering/DECISION-ESCALATION.md`
- `docs/autonomous-engineering/CURRENT-STATE.md` (this horizon's entry, appended at closure of
  Phase 1)
- `docs/plans/app-builder/APP-BUILDER-12-HORIZON-CLOSURE-REPORT.md`
- `docs/plans/app-builder/AWJ_APP_BUILDER_COMMERCE_RUNTIME_V1_EVIDENCE.md` (this horizon's Phase 1
  deliverable — evidence, external research, proposed architecture, Update/Release Matrix, and the
  open Decision Escalation Packet)
- `docs/openapi/commerce-api-v1.yaml` (canonical `commerce/v1` contract — the real API surface any
  Data Resource Registry must bind to)

## Horizon End for Phase 1

Phase 1 ends at the Decision Gate recorded in `AWJ_APP_BUILDER_COMMERCE_RUNTIME_V1_EVIDENCE.md`
§8. No implementation task in this horizon may be promoted to `ready` until Safwan/ChatGPT resolve
that packet. This mirrors the same gate discipline already used for `APP-BUILDER-7`/`APP-BUILDER-11`
in the prior horizon.
