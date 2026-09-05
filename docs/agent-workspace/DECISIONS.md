# Agent Decision Log

Append material orchestration decisions here. Do not rewrite history except to correct an explicit factual error; add a superseding entry instead.

---

## DEC-0001 — Orchestration authority model

DATE: 2026-09-06
STATUS: ACCEPTED
OWNER: Safwan

### Decision

Use a three-role model:

- Safwan is final owner authority.
- ChatGPT is planner/architect/reviewer.
- Claude Code is implementation engineer with an explicit duty to inspect repository reality and raise better approaches, risks, questions, or challenges.

Claude Code is not a blind executor. A materially better idea must be proposed to ChatGPT with evidence rather than silently substituted.

### Owner gates

No merge, deploy, production release, destructive operation, or sensitive scope expansion without Safwan's explicit approval.

### Rationale

Combine ChatGPT's planning/review role with Claude Code's direct repository implementation context while preserving accounting correctness, data integrity, security, tenant/branch isolation, backward compatibility, and human control.
