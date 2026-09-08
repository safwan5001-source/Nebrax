# PR-NOTIF-5 Test Matrix

Required before merge:

- Backend SQLite CI green.
- Backend PostgreSQL CI green.
- Web CI green.
- Receivables: posted + remaining + due date eligibility; dedupe; paid stop; no journal mutation.
- POS: variance pending; handover pending; dedupe; resolved state stops new delivery; no journal mutation.
- Existing notification action validation remains green.
- Existing accounting/POS suites remain green through repository CI.

No migration is introduced by this PR.
