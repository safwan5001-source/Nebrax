# ADR-006: Human Review Workspace

- **Status:** Accepted
- **Scope:** PR-6

The normalized extraction result remains immutable evidence. Human corrections are append-only `document_review_changes`; the reviewed document is projected deterministically from original evidence plus ordered changes. No review operation mutates provider payloads, creates master data, or creates financial transactions.

Human confirmation is independent from a suggested score. Match decisions and issue state changes are made only through `DocumentReviewService`, with trusted tenant/branch context, row locks, optimistic batch version checks, actor and reason. A stale command fails safely rather than overwriting another reviewer.

`ready_for_draft` means only that a supported purchase-invoice review passed its readiness policy. It is reached only through `DocumentWorkflowService`; it is not approval, posting, or authority to create a draft. `TransactionDraftBuilder` remains a later phase.

PR-6 keeps provider networking hard-disabled and makes no storage, queue, worker, Render, S3/R2, Redis, ClamAV, or deployment activation.
