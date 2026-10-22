# TREASURY-T3: unified treasury selection contract

| | |
|---|---|
| Scope | One reusable, read-only resolver for the treasury or bank entity a future posting will use. **No existing posting path is migrated or touched.** |
| Base | `origin/main` @ `8127f4608` (includes #1611, #1617, #1622) |
| Branch | `claude/treasury-t3-selection-contract` |
| Sources read | `TREASURY-BANKING-PHASE0-AUDIT.md` (sections 2, 3, 6, 9, 10), T1 and T2 reports, `CashBankAccountService`, `CashBankAccount`, `PaymentService::resolvePaymentSetup`, the `cash_bank_accounts` and `payment_methods` migrations |
| Not done | merge, deploy, data reset, migration, tenant activation, ZATCA transmission, any posting change |

## 1. Confirmed current behavior and compatibility findings

`CashBankAccountService::resolveForPayment(?string $glAccountId, string $method)` is the only selection logic today (used by receipts, supplier payments, refunds, custody, POS settlement, paid sales and purchases):

| Behavior | Detail |
|---|---|
| Input | A **ledger account id** (what the existing `cash_account_id` columns store) or `null`, plus a method string; anything that is not `bank` is treated as `cash`. |
| Omitted | Main (`is_main`) entity of the type. |
| Side effect | Calls `bootstrapDefaults()` first, so it can write (provisioning). |
| Checks | Entity exists, type matches, entity and its GL account active. It does **not** check that the GL account is postable (not a group) or an asset. Failures are plain `RuntimeException` messages (422 through `ApiController::domain()`), without a stable code. |
| Authorization | Separate: `assertAllowed($entity, 'deposit'|'withdraw', $user)` using the entity's own scope (`CashBankAccount::allows()`). |
| Uniqueness | `unique(tenant_id, account_id)` and the partial unique `one_main_per_type` guarantee at most one entity per ledger account and one main per type. |

Compatibility constraints that shaped the contract:

1. Existing columns hold **ledger account ids**, not entity ids, so the contract accepts both (`TreasurySelection::ledgerAccount()` resolves through the unique key; it never reads a GL code).
2. Voucher default is "main of type" = decision D-T3 option (a). It is the default policy here, so T4 onwards keeps today's behavior wherever a path already behaves that way.
3. Errors must stay `RuntimeException` so they remain 422 domain errors.
4. Provisioning (`bootstrapDefaults`) is a write and belongs to a posting path or to T9; the resolver must be read-only.

**D-T3 compatibility result.** Option (a) and option (b) are supported now as `TreasurySelectionPolicy::MainOfType` and `ExplicitRequired`, passed per call (no setting, no schema). Option (c), a per-branch or per-user default treasury, needs a schema change and is **not implemented**; it can be added as a third policy case once approved. One decision remains for T4 and is documented rather than guessed: the hard-coded paths (cash sales invoice, credit notes, returns, expenses, assets, payroll) post to `1110`/`1120` regardless of which entity is main. Adopting `MainOfType` there changes the GL account only for a tenant that has moved `is_main` away from `1110`/`1120`; for every other tenant the posting is identical. That is the intended direction of the audit but it is an accounting behavior change, so it must be approved per path (see section 6).

## 2. Contract

```php
app(TreasurySelectionResolver::class)->resolve(
    TreasurySelection $selection,        // entity($id) | ledgerAccount($id) | none(); null id = not sent
    string $type,                        // 'cash' | 'bank' (programming error otherwise)
    TreasurySelectionPolicy $policy = MainOfType,
    ?string $authorize = null,           // 'deposit' | 'withdraw' enforces the entity scope; null = caller's job
    ?User $actor = null,
): ResolvedTreasury;                     // entity, entityId, accountId, type, name, currency, viaDefault
```

Resolution order for an **explicit** selection (always wins over the policy): well-formed UUID, found in the current tenant, type matches, entity active, linked GL account found in the same tenant, active, not a group and an asset, then optional authorization. For an **omitted** selection the policy decides.

| `reason` | Raised when |
|---|---|
| `not_found` | Unknown id, another tenant's id (same message, no existence leak), empty string, a GL code such as `1110`, any non-UUID. Never a database error. |
| `wrong_type` | Entity is a bank but cash was requested, or the reverse. Never swapped. |
| `inactive` | Entity inactive, explicit or the main. An inactive main is **not** replaced by another active entity. |
| `gl_account_missing` | Linked ledger account is not visible in this tenant (including a corrupt link to another tenant's account). |
| `gl_account_inactive` | Linked ledger account inactive. |
| `gl_account_invalid` | Linked ledger account is a group or not an asset. |
| `no_default` | No main entity for the type and fewer than two active candidates (a lone candidate is not promoted). |
| `ambiguous_default` | No main flag and two or more active candidates (or, defensively, two mains). |
| `explicit_required` | Policy `ExplicitRequired` and nothing selected. |
| `not_permitted` | `$authorize` given and the entity's deposit or withdraw scope rejects the actor (fails closed without an actor). |

Guarantees: no GL code or `111`/`112` prefix is ever interpreted; no silent substitution; no provisioning; no `INSERT`/`UPDATE`/`DELETE` and no row lock (asserted by a query listener); no ledger access; tenant scoping comes from the scoped models. Authorization is not bypassed: by default the resolver grants nothing and checks nothing, exactly as `resolveForPayment` plus `assertAllowed` today; with `$authorize` it applies the same `allows()` rule.

## 3. Files changed

| File | Change |
|---|---|
| `app/Services/Accounting/TreasurySelectionResolver.php` | New resolver. |
| `app/Support/TreasurySelection.php` | New immutable input (`entity`, `ledgerAccount`, `none`). |
| `app/Support/TreasurySelectionPolicy.php` | New enum (`MainOfType`, `ExplicitRequired`). |
| `app/Support/ResolvedTreasury.php` | New immutable result. |
| `app/Support/TreasurySelectionException.php` | New typed domain error with the reason codes above. |
| `tests/Feature/TreasurySelectionResolverTest.php` | New, 21 tests. |
| `CLAUDE.md` | New short section documenting the contract and that it is not wired yet. |
| `docs/audits/treasury/TREASURY-T3-IMPLEMENTATION-REPORT.md` | This report. |

No existing source file was modified, no migration added.

## 4. Tests (`TreasurySelectionResolverTest`)

| Required case | Test |
|---|---|
| Explicit treasury (by entity id and by ledger account id) | `an_explicit_cash_treasury_is_resolved_by_entity_id_and_by_ledger_account_id` |
| Explicit bank | `an_explicit_bank_account_is_resolved_and_beats_the_main_default`, wrong type rejected in `an_explicit_selection_of_the_wrong_type_is_rejected_never_swapped` |
| Default treasury | `omitting_the_selection_resolves_the_main_entity...`, `the_default_follows_a_changed_main_entity` |
| Missing default | `a_missing_default_is_an_explicit_error_not_a_guess` |
| Multiple candidates, no unambiguous default | `several_candidates_without_a_main_are_ambiguous_and_a_single_one_is_not_promoted` |
| Inactive treasury | `an_inactive_explicit_selection_is_rejected`, `an_inactive_main_is_never_silently_replaced...` |
| Cross-tenant isolation | `another_tenants_entity_or_ledger_account_is_indistinguishable_from_unknown` (identical message), `an_entity_linked_to_a_ledger_account_of_another_tenant...` |
| Invalid or missing linked GL account | `an_inactive_group_or_non_asset_ledger_account_is_rejected`, the cross-tenant link case above |
| Legacy tenant compatibility | `a_registered_legacy_tenant_resolves_to_its_historical_1110_and_1120`, `an_unprovisioned_tenant_gets_no_default_until_it_is_provisioned_the_existing_way`, `it_matches_the_existing_resolve_for_payment_for_every_compatible_input` (six inputs equal to `resolveForPayment`, and it rejects where the legacy method rejects) |
| No posting or journal side effects | `resolving_writes_nothing_and_creates_no_journal_entry` (row counts unchanged, no write or lock statement) and `only_the_resolver_itself_references_the_contract...` (no service wires it, and the resolver does not use the ledger) |
| Extra | policy `ExplicitRequired`; optional authorization with scope, no actor and invalid action; never guessing from GL prefixes or malformed ids; unknown type is a programming error |

Running the tests on PostgreSQL found a real defect in the first draft: a non-UUID id (`''`, `1110`) made PostgreSQL raise `invalid input syntax for type uuid`. The resolver now rejects any non-UUID explicit id as `not_found` before querying, and the tests cover seven malformed values on both selection kinds. Mutation checks: making the resolver substitute an active entity for an inactive main, or wiring it into a service, each fails the corresponding test.

## 5. Results

RESULTS_PLACEHOLDER

## 6. Risks and remaining decisions

- **Decision D-T3 (formal):** the contract defaults to `MainOfType`. Please confirm that as the default policy for T4 to T8 or choose `ExplicitRequired` per path. Option (c) needs a schema design first.
- **Per-path behavior change in T4 to T8:** moving a hard-coded path to `MainOfType` changes the posted GL account only for tenants whose main treasury is not `1110`/`1120`. Each path should state this in its own PR with entries shown before and after.
- Policy is a call parameter, not a stored tenant setting. A setting can be added when a path needs it (configurable-policies rule), without changing this contract.
- The typed `reason` is not exposed over HTTP: `ApiController::domain()` turns any `RuntimeException` into a 422 with the message only. T4 can add a pass-through like the emergency-stop exception if the UI needs the code.
- The resolver does not check currency compatibility or negative-balance rules; those stay with the posting service (transfers already do).
- Provisioning of an incomplete tenant is intentionally not done here (T9); an unprovisioned tenant gets `no_default`.

## 7. Recommended next step (T4)

Cash sales invoice routing, behind the contract: resolve with `TreasurySelection::ledgerAccount($invoice->cash_account_id)` for paid invoices and `TreasurySelection::none()` with `MainOfType` and `authorize: 'deposit'` for cash-type invoices, keep `bootstrapDefaults()` before it (as `resolveForPayment` does today), and post to `ResolvedTreasury::accountId` instead of the fixed `1110`. Show the entries before and after for a tenant on `1110` (identical) and one whose main is a custom treasury (changes), run the ZATCA invoice suites on both engines, and require the approval above first.
