# IMP-H2-S2 — One value verdict for extraction, review and preview

**Branch:** `claude/imp-h2-s2-value-normalization` · backend only · no migration/env/ledger/ZATCA change

## Problem (verified in code)

Three steps of the AI-action product import judged the same cell with three different rules:
- extraction (`AiActionProductFileIntakeService::valueLooksValid`) and review (`AiActionProductReviewService::valid`) used private regexes (money up to **4** decimals, percent with decimals, booleans always valid, no enum aliases);
- the final preview (`AiActionProductPreviewBuilder`) already used `ProductImportValueNormalizer` (money max 2 decimals, integer percent, strict booleans, type aliases).

So a row could be "ready" in review and then fail the preview — and the two regexes had themselves drifted (percent lower bound, trailing-grouping handling).

## Change

- `ProductImportValueNormalizer::isValid($field, $raw)` — the single verdict (blank ⇒ valid; required is a separate check; a field with no definition in the import contract is left alone, as before).
- Both services now delegate to it; their private regexes are removed.
- The normalizer itself learns the Arabic thousands separator `٬` (U+066C) for money and integers — extraction/review accepted it, the preview did not, so a value could pass two steps and fail the third. Now all three agree.

## Intended behavior changes (all toward the preview's existing verdict)

| Cell | Before (extraction/review) | Now |
|---|---|---|
| money `10.1234` | accepted, then rejected at preview | rejected at extraction/review |
| percent `15.5` | accepted, then rejected at preview | rejected |
| boolean `ربما` | accepted | rejected |
| type `سلعة` / `خدمة` | rejected | accepted (same alias the preview accepts) |
| text over the field's `max` | extraction unlimited / review 10 000 | field `max` (default 255) |
| money/integer with `٬` | accepted at extraction/review, rejected at preview | accepted everywhere |

## Tests

New truth table `ProductImportValueAgreementTest` (20 cells, via `isValid`) and an integration test in `AiActionProductReviewTest` (review rejects `10.1234`, `15.5`, a junk boolean with `review_field_invalid`; accepts Arabic digits/grouping, `15%`, a type alias). Unchanged and green: `AiActionProduct*`, `ProductImport*`, `ImportJob*` — 284 passed, 4 skipped (PG-only). CI on the PR. Codex is out of quota — no Codex review is claimed.
