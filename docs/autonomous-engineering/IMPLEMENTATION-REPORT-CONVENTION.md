# AWJ Autonomous Implementation Report Convention

## Purpose

Every completed engineering task leaves enough evidence for Safwan, ChatGPT, Claude Code, or another capable agent to resume without re-investigating the project.

## Preferred location

Use the relevant domain report location when one exists. Otherwise:

`docs/reports/implementation/<TASK-ID>.md`

Avoid maintaining two copies of the same report.

## Required report

```md
# <TASK-ID> — Implementation Report

STATUS:
DATE:

## Outcome
## Repository evidence / root cause
## Approach chosen
## Why this approach fits AWJ
## Changed files
## Tests and exact results
## Build / lint / typecheck
## CI
## Self-review
### Implementer
### Reviewer
### AWJ Guardian
## Accounting impact
## Tenant / branch isolation impact
## Security / authorization impact
## Backward compatibility
## API / DB / migration impact
## External research used
## Risks / remaining work
## Discovered backlog
## Git state
- Branch:
- PR:
- Base SHA:
- Head SHA:
## Recommended next dependency-ready task
```

## Truthfulness

- Never claim a command/test/CI result not observed.
- Distinguish local tests from CI.
- Distinguish PR-ready from merged.
- Distinguish merged from deployed.
- Distinguish deployed from production-verified.
- For accounting-impacting work include the explicit journal-entry table required by `CLAUDE.md`.
