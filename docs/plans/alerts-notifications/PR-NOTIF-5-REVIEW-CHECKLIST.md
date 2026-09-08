# PR-NOTIF-5 Review Checklist

- [ ] Exact head CI green on SQLite, PostgreSQL and Web.
- [ ] No migration/schema change.
- [ ] No LedgerService/InvoiceService/PosSessionService behavior change.
- [ ] Tenant + branch + permission recipient isolation reviewed.
- [ ] Dedupe behavior reviewed.
- [ ] Notification payload contains no sensitive data.
- [ ] Actions point to existing re-authorized routes.
