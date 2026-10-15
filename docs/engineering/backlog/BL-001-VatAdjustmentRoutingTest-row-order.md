# BL-001 — `VatAdjustmentRoutingTest` depends on database row order

STATUS: **OPEN — backlog, outside any horizon.** Not scheduled. No fix is proposed for approval yet.
OPENED: 2026-10-15
AREA: tests · accounting (test code only; no accounting logic is affected)
SEVERITY: low (test flake on PostgreSQL; no product behaviour is wrong)
OWNER DECISION: recorded as an independent backlog item by the owner on 2026-10-15, outside AWJ-COMMERCE-VISUAL-DIMENSIONS-H1. The horizon does not change accounting logic or accounting tests.

## What happened

CI job `php artisan test (L11, pgsql)` failed one test on PR #1499 at head `68f7412`:

`Tests\Feature\VatAdjustmentRoutingTest::a_purchase_debit_note_credits_the_current_tax_input_role` (assertion at `tests/Feature/VatAdjustmentRoutingTest.php:379`)

The amounts were identical. Only the **order of the array keys** differed:

| | Expected | Actual (pgsql) |
|---|---|---|
| order of account codes | `2110`, `5115`, `1150` | `1150`, `2110`, `5115` |
| values | `2110 [115000, 0] · 5115 [0, 100000] · 1150 [0, 15000]` | the same three entries |

The next run, on head `23e72f4` of the same PR, passed on both SQLite and pgsql, with no change to that test.

## Second occurrence (2026-10-15)

The same flake hit a **different test of the same class** on PR #1508 (head `e8fabcf`): `VatAdjustmentRoutingTest::a_sales_return_with_default_mappings_is_byte_identical_to_before` (assertion at `tests/Feature/VatAdjustmentRoutingTest.php:254`; `2120` and `4110` swapped, same amounts). The failed job passed on its single re-run. This confirms the cause is the shared `journal()` helper, not one test, and that any PR can meet it on pgsql. Impact so far: one re-run each time, no product defect.

## Cause

The test's `journal()` helper (`tests/Feature/VatAdjustmentRoutingTest.php:213`) loads `JournalEntry::with('lines.account')` and iterates `$entry->lines` with **no `ORDER BY`**, then builds an array keyed by account code. The assertions use `assertSame`, which compares key order as well as values. SQL does not guarantee row order without `ORDER BY`, and PostgreSQL returns rows in physical order, which can differ between runs. SQLite usually returns insertion order, so the test passes there.

The same helper is used by other tests in the file, so any of them could show the same flake.

## Evidence

- Failing job log: Actions run `38649265795`, job `116143738622` (PR #1499, head `68f7412`).
- Passing re-run: PR #1499 head `23e72f4`, 7/7 checks green.
- Not related to the change under test: PR #1499 touches no accounting code and not this test.

## Impact

- A pgsql CI job can fail at random with no product defect, which costs a re-run and can block a merge.
- No accounting figure, journal entry, report or tax output is affected.

## Options (not decided)

Any of these is a **test-only** change. None changes accounting logic.

1. Sort `$entry->lines` (for example by account code) inside `journal()` before building the array.
2. Compare with `assertEquals` on the keyed arrays, which ignores key order.
3. `ksort()` both the expected and the actual arrays before `assertSame`.

Whichever is chosen, the same fix should cover every test that uses `journal()`.

## Rules for working on it

- Needs the owner's approval before any change, because it touches accounting tests.
- Do not change journal-entry logic, `LedgerService`, or any assertion about amounts.
- Verify on pgsql (CI) and SQLite; a local pgsql run is available.
