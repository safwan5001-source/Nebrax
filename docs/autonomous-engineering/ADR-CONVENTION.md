# AWJ Architecture / Decision Record Convention

## When to create an ADR

Create an ADR for a material decision that future engineers/agents must not repeatedly rediscover, especially:
- architecture;
- accounting policy/semantics;
- tenant/branch/security model;
- public API compatibility;
- database ownership/identity;
- strategic provider/framework;
- credential/signing ownership;
- meaningful configurable business policy.

Do not create ADRs for ordinary local implementation choices.

## Location

Preferred:
`docs/decisions/ADR-XXXX-short-name.md`

If a domain already has an accepted decision-log convention, link rather than duplicate.

## Required structure

```md
# ADR-XXXX — Title

DATE:
STATUS: proposed | accepted | superseded
DECIDED_BY:
SUPERSEDES:
RELATED_TASKS:

## Context
## Decision
## Alternatives considered
## Evidence
### Repository evidence
### External evidence
## Rationale
## Consequences
## Compatibility / migration impact
## Security / tenant / accounting impact
## Follow-up
```

## External evidence

For changing platforms/policies, record official source title and retrieval date. URLs may be recorded in the repository document.

Do not turn a secondary blog into architectural authority when official documentation exists.

## History

Accepted ADRs are append/supersede history. Do not silently rewrite the rationale of an old accepted decision to make current architecture look cleaner.
