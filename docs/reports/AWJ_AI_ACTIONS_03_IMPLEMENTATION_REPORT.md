# AWJ AI-ACTIONS-03 — Interactive Product Import Review

## Delivered

- Added a shared `/products/ai-import` review flow: secure file intake, editable responsive product table, search, `needs_review` filter, visible field origin, and a safe bulk-edit control.
- Added **استيراد عبر مساعد أَوْج** beside the existing traditional Products import; the traditional route remains untouched.
- Added review API endpoints which derive the first proposal from the immutable AI-ACTIONS-02 extraction manifest and persist user edits only as a new `AiActionVersion`.
- No endpoint approves, executes, creates, updates, posts, or changes product stock/accounting data.

## Security and contracts

`AiActionProductReviewService` reuses `AiActionGateway`, so fresh-user authorization, tenant isolation, RBAC, branch scope, state checks, action version locking, canonical version hashing, and audit events remain enforced. The review endpoint accepts a bounded set of row/field edits, validates field keys and basic money/percent/integer/enum shape, marks edited values `user`, and keeps `existing_update_approved` false for image sources.

Conflicting `expected_version` values return `version_conflict`; there is no automatic overwrite. Extracted values stay available in the version chain, and no missing value is invented.

## Files

- `app/Services/AiActionProductReviewService.php`
- `app/Http/Requests/StoreAiActionReviewRequest.php`
- `app/Http/Controllers/Api/AiActionController.php`
- `routes/api.php`
- `web/src/app/(app)/products/ai-import/page.tsx`
- `web/src/app/(app)/products/page.tsx`
- `tests/Feature/AiActionProductReviewTest.php`

## Verification

- PHP syntax lint passed for the new service, request, and controller.
- `web` TypeScript compilation identifies the new page's original variant error; it was corrected. The full command still reports pre-existing generated-route and unrelated type errors in the repository, so it is not a clean global gate.
- CI should run the PostgreSQL/SQLite Laravel matrix and web checks on the Draft PR.

## Risks / follow-up

The compact bulk editor applies a visible user value to currently filtered rows and still requires a version save; a future UX PR can add selection-based bulk operations and conversational edit intents. Approval, image fetching/attachment, existing-product matching, and ERP execution remain intentionally out of scope.
