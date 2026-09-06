# ACC-6 — Accounting Period Lock Design Gate

**Status:** DESIGN REQUIRED BEFORE IMPLEMENTATION  
**Risk:** Critical accounting control.  
**Implementation:** NOT AUTHORIZED by this document alone.

## Objective
Design a server-enforced Accounting Date Lock that blocks creation/change/reversal of financial effects in a locked date range. A date lock is not a fiscal close and creates no journal entries.

## Core distinction
**Accounting Period Lock:** operational control over dates; no closing entries.  
**Fiscal Period Close:** accounting lifecycle that may generate closing/opening entries.  
They must remain separate models/workflows.

## Decisions required before code
1. Company-wide vs branch-specific locks.
2. Which accounting date is authoritative per document (`date`, posting date, transaction date).
3. Whether Draft creation is allowed inside lock while Posting is blocked.
4. Edit behavior for already-posted documents.
5. Reversal rules: original date, current date, or explicit permitted reversal date.
6. Administrator override: whether allowed, permission, reason, audit.
7. Interaction with imports/API/POS/background jobs.
8. Lock overlap rules and open-ended ranges.
9. timezone/date boundary contract.
10. interaction with future fiscal close.

## Safety principles
- Server-side enforcement is authoritative; frontend disablement is convenience only.
- Every posting path must be covered; partial adoption is unsafe.
- A lock check should be centralized enough to prevent missed modules but must not mutate LedgerService semantics without explicit design approval.
- No silent bypass by direct API/import/POS.
- Unlock/change actions require audit.
- Existing posted history remains intact.

## Proposed model concept
A tenant-isolated `AccountingPeriodLock` may include start_date, end_date, status/active, optional branch dimension only if branch policy is approved, reason, created_by, released_by/released_at and timestamps. Exact schema is not approved yet.

## Required implementation test matrix once designed
- before/start/inside/end/after boundary dates.
- create/post/edit/delete/reverse for every financial document family.
- API/POS/import/background pathways.
- branch isolation if branch-specific.
- timezone boundaries.
- concurrent posting while lock is created.
- unauthorized unlock/override.
- audit trail.
- historical read/report unaffected.
- SQLite/PostgreSQL.

## Stop condition
Do not implement ACC-6 until branch semantics and reversal/override policies are explicitly approved and a complete posting-path inventory has been checked.