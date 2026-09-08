# PR-NOTIF-5 Safety Invariants

- Notification reads never mutate invoice/payment/journal state.
- POS notification reads never mutate session/reconciliation/drawer/journal state.
- Tenant ID is an explicit predicate on all domain scans.
- Recipients are active users in the same tenant, permission-filtered and branch-filtered.
- Notification actions are server allowlisted and point only to existing internal routes that re-authorize on open.
- No raw payment credentials, ZATCA payloads, cost data, or sensitive POS audit payloads are copied into notifications.
- Read/unread remains independent from the underlying business condition.
- Repeated scans are idempotent through stable dedupe keys.
