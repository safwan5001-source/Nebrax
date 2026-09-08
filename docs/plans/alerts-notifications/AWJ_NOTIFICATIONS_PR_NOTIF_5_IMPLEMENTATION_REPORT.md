# AWJ Notifications — PR-NOTIF-5 Implementation Report

Date: 2026-09-08
Branch: `claude/pr-notif-5-receivables-pos`
Base SHA: `643b7d9d1e5638aea92f38c59fbf7555c8bd8948`

## Scope

Receivables and actionable POS notifications only. No schema migration, no accounting posting changes, no payment mutation, no POS session/reconciliation mutation, no ZATCA changes, and no new external channels.

## Receivables

- Read-only scan of posted sales invoices with a positive `remaining()` and a due date.
- States: `due_soon` (next 3 days), `due_today`, `overdue`.
- Recipients: active tenant users with `invoices.manage`, intersected with branch visibility.
- Source/action: invoice → `view_receivable_invoice` → existing invoice route.
- Scanner is scheduled daily at 08:00. Paid/zero-remaining invoices stop producing notifications.
- Dedupe is delegated to the existing `NotificationService` unique delivery contract.

## POS

- Read-only projection of already-authoritative closed-session states only:
  - `difference_status=pending` → critical variance notification to `pos.variance.approve` holders.
  - `handover_status=pending` → warning handover notification to `pos.session.handover.confirm` holders.
- Recipients are tenant- and branch-aware.
- Source/action: POS session → existing `/pos/sessions/{id}` route.
- Hourly scan; fixed per-session/type dedupe means repeated scans do not spam.
- No checkout, drawer, close, handover, reconciliation, LedgerService or variance-posting behavior is changed.

## Tests

Added focused feature coverage for same-day receivables dedupe, paid-invoice stop condition, POS variance/handover dedupe, and explicit JournalEntry/JournalLine non-mutation assertions.

CI is the authoritative execution environment for this connector-driven implementation; results are recorded after the PR workflows complete.

## Risks / follow-up

- The repository schedule definitions only run where `schedule:run`/cron is operationally connected; this PR does not alter infrastructure.
- The three-day due-soon window is notification policy only and does not alter due dates or accounting semantics.

## Remaining

Run CI on SQLite/PostgreSQL/Web, review the exact PR diff, and merge only if all required checks are green and the final review remains safe.
