# Custom-Domain PostgreSQL Concurrency Test — CI Repair Report

## 1. Base SHA

`0318f0eeaac1396283c290a3acfc5f93ce441875` (`main`, "STORE-ADMIN-ADOPT-1B-3A
custom domain TXT verification (#856)")

## 2. Head SHA

`<HEAD_SHA>` — see the PR's commit list; the code commit is `51b01e2`.

## 3. Branch

`claude/fix-webhook-events-pgsql-ci`

The branch name is stale — it was cut before the `webhook_events` diagnosis was
disproved. It is kept because renaming it costs a force-push and buys nothing;
the PR title and this report carry the accurate subject.

## 4. PR

[#859](https://github.com/safwan5001-source/Nebrax/pull/859)

## 5. Exact reproduction result

Reproduced locally against real PostgreSQL 16, byte-for-byte with CI's setup
(`DB_CONNECTION=pgsql`, database `nibras`, `migrate:fresh --force`,
`php artisan test`):

```
FAIL  Tests\Feature\CommerceWorkspaceCustomDomainPostgresConcurrencyTest
⨯ two different tenants racing for the same hostname never both succeed
Failed asserting that 0 is identical to 1.
at tests/Feature/CommerceWorkspaceCustomDomainPostgresConcurrencyTest.php:154
```

Identical to CI on `main` at `0318f0e` and on PR #857 at `f156e29`.

## 6. Deterministic vs intermittent

**Effectively deterministic: it fails ~98.67% of runs.**

The test builds its contested hostname with `Str::random(8)`, whose alphabet is
`[A-Za-z0-9]`. Measured over 100,000 draws, only **1.33%** come out already
all-lowercase-or-digit:

```
Str::random(8) is already all-lowercase/digits in 1.33% of draws (1326/100000)
=> the test therefore FAILS in about 98.67% of runs
```

That is why every CI run on `main` and on #857 was red, while the test is
technically case-dependent rather than unconditional.

## 7. Proven root cause

**The test asserts against the hostname it typed, not the hostname the database
stores.**

`StorefrontDomain::setHostnameAttribute()` is the single call site of
`HostnameNormalizer::normalize()`, which lower-cases the value
(`mb_strtolower`). The normalized form is what `storefront_domains.hostname`
holds and what its **global** unique index enforces. The final two assertions
queried the raw mixed-case input, matched nothing, and reported a correctly
persisted race as a lost row.

Captured directly from the instrumented run:

```
QUERIED_VALUE : race-qYPr8LrU.example.com     <- what the assertion looked for
RAW_COLUMN    : race-qypr8lru.example.com     <- what the row actually holds
MATCH         : false
```

## 8. Evidence distinguishing test-harness from application defect

The locker child was instrumented from inside its own open transaction,
immediately after `StorefrontDomain::create()` returned:

```
created_id              a2c5d8a4-3da5-40fe-a299-376a871e207f
exists                  true
wasRecentlyCreated      true
tx_level_after_create   1
total_rows_in_table     1      <- the row IS in the table
by_id                   1      <- and is findable by its id
self_sees_before_commit 0      <- but NOT by `where hostname = <raw input>`
backend_pid             694
current_db              nibras
search_path             public
```

The row was never lost. It was present under a key the test was not asking for.
That settles the question the brief required to be settled before any edit:

| Probe | Result |
|---|---|
| **A** — does the winning child transaction commit? | Yes. `committed: true`, `tx_level_after_commit: 0`, same backend pid (694) as the insert. |
| **B** — does a fresh independent PostgreSQL connection see exactly one row? | Yes, **once queried by the stored form** — a raw `PDO` opened in the parent returns exactly 1 row owned by tenant A. |
| **C** — is the parent reading through a connection inherited across `fork`? | No observable defect. The parent's Laravel connection and a brand-new independent `PDO` agree on every probe, before and after the fix. |
| **D** — does Laravel/PDO state or an outer test transaction affect visibility? | No. `Tests\TestCase` uses neither `RefreshDatabase` nor `DatabaseTransactions`; `parent_tx_level: 0` throughout. `config('database.connections.pgsql')` declares no `read`/`write` split and no `sticky`, so reads and writes share one PDO. |
| **E** — does child shutdown/exit change connection or transaction behaviour? | Not materially. The commit is observable from an unrelated process afterwards. |
| **F** — does the loser still receive `StorefrontHostnameConflictException`? | Yes, on every run — including every run that *failed*. The service normalizes tenant B's input the same way, so the collision is detected correctly. |
| **G** — is the DB unique constraint still the final authority? | Yes. Unchanged; no schema, index or constraint was touched. |

**Conclusion: test-harness defect, not a production domain-creation failure.**
The race, the held transaction, the conflict translation and the unique
constraint all behaved correctly the entire time.

## 9. Exact fix and why it is minimal

One test file. The test now resolves the stored form once and reads the
database by it:

```php
$storedHostname = HostnameNormalizer::normalize($raceHostname);
```

and the two final queries use `$storedHostname` instead of `$raceHostname`.

The mixed-case input is **kept**, not normalized away at the source. Generating
an already-lowercase hostname would also make CI green, but it would delete the
only coverage that normalization is part of the uniqueness key — which is the
very property that makes this a race. One assertion is therefore **added**:

```php
$this->assertSame($storedHostname, $winner->hostname);
```

No assertion is weakened, none is skipped, the `1` is untouched, the concurrent
`pcntl_fork`, the held transaction and the unique-constraint proof are all
unchanged. No application code, no migration, no schema, no index.

## 10. Changed files

```
tests/Feature/CommerceWorkspaceCustomDomainPostgresConcurrencyTest.php   (+20 −2)
```

Plus this report. Nothing else.

## 11. Exact concurrency semantics after the fix

Unchanged from what #856 intended, now actually asserted. From an instrumented
run with a deliberately mixed-case hostname — the path that was failing:

```
raw_input_typed          race-JYXCrs0t.EXAMPLE.com
stored_normalized        race-jyxcrs0t.example.com
loser_outcome            { ok: false, conflict: true,
                           message: "اسم النطاق مستخدم بالفعل." }
FRESH_INDEPENDENT_count  1
FRESH_INDEPENDENT_rows   [ { tenant_id: <tenant A>,
                             hostname: "race-jyxcrs0t.example.com" } ]
winner_is_tenantA        true
```

One success, one clean `StorefrontHostnameConflictException`, one persisted
hostname — confirmed from a connection that took no part in the race.

## 12. Targeted test results

```
PASS  Tests\Feature\CommerceWorkspaceCustomDomainPostgresConcurrencyTest
✓ two different tenants racing for the same hostname never both succeed
Tests: 1 passed (7 assertions)
```

(7 assertions, up from 5 — the two new ones are the normalization contract.)

## 13. Repeated race-test results

25 consecutive full invocations against real PostgreSQL:

```
=== repeated race: 25 passed, 0 failed out of 25 ===
```

Plus a forced mixed-case run (§11) to exercise the ~98.7% path deliberately
rather than waiting for chance.

## 14. Related custom-domain tests

```
php artisan test --filter="CustomDomain|StorefrontDomain|StorefrontProvisioning|HostnameNormalizer|TenantHostnameResolver"
Tests: 124 passed (438 assertions)
```

## 15. PostgreSQL suite result

**The test this PR fixes passes inside the full clean run:**

```
PASS  Tests\Feature\CommerceWorkspaceCustomDomainPostgresConcurrencyTest
```

The rest of that local run is **not** a valid CI proxy, and is reported as such
rather than dressed up. A clean `migrate:fresh --force` followed by one
`php artisan test` on PostgreSQL 16 in this sandbox gives:

```
Tests:  74 failed, 4052 passed (25095 assertions)
```

across 16 classes — none of them the class changed here. CI on the *same base*
reports `1 failed, 4125 passed`, so `main` exhibits none of them. Two causes
were identified and both are this sandbox's, not the repository's:

- **`ext-bcmath` is not installed here.** `php -m` returns no `bcmath`, and
  `FuelCostBasisService` calls `bcmul()`/`bcadd()` directly — hence every
  `Fuel*` class fails with `Call to undefined function App\Services\bcmul()`.
  CI installs it explicitly (`ci.yml:80` — `extensions: mbstring, pdo_sqlite,
  sqlite3, pgsql, pdo_pgsql, bcmath, intl, fileinfo, zip, dom`).
- **Transient schema state mid-suite.** `CommercialAssignment*` and friends fail
  on `relation "account_role_mappings" does not exist`, yet that table and its
  three migrations are present and applied both before and after the run — so
  the schema was rebuilt underneath them by another test during the run, a
  local ordering artifact.

Per the brief's scope rule these are reported, not repaired. **CI on #859 is the
authority for the full-suite verdict.**

## 16. SQLite result

**No regression is possible on this leg, and none is observed.** The changed
test skips off PostgreSQL by its own guard, which the run confirms:

```
- two different tenants racing for the same hostname never both succeed
  → يتطلب PostgreSQL حقيقياً لإثبات قيد التفرّد ضد سباق حقيقي.
```

Locally: `Tests: 35 failed, 41 skipped, 4050 passed` — the same sandbox gaps as
§15 (`bcmath` chief among them). **CI's sqlite leg on #859 passes**, which is
the fact that matters and confirms those 35 are local-only.

## 17. CI status

On #859:

| Check | Result |
|---|---|
| `php artisan test (L11, sqlite)` | ✅ **success** |
| `php artisan test (L11, pgsql)` | ✅ **success** |

**Green on the code commit `51b01e2`, on both the push run
([35308792767](https://github.com/safwan5001-source/Nebrax/actions/runs/35308792767))
and the pull_request run
([35309886036](https://github.com/safwan5001-source/Nebrax/actions/runs/35309886036)).**
That is the check this PR exists to turn green: it was red on `main` at
`0318f0e` and on #857 at `f156e29` with this same single failure, and CI's own
PostgreSQL 16 service now runs the suite clean.

One later sqlite run on the docs commit `cae2b84` failed on an unrelated,
pre-existing 0.8% flake (`ZatcaQrCertificateMaterialExtractorTest`); the
parallel run of that same commit passed. See §21.

## 18. Tenant Isolation assessment

Unchanged. No scope, no `TenantScope` usage, no `TenantContext` call and no
model was modified. The test still asserts the winner is tenant A and still
reads across tenants only via the explicit `withoutGlobalScope(TenantScope)`
that #856 wrote for exactly that purpose.

## 19. Backward compatibility assessment

Total. The diff touches one test file; no production class, contract, route,
resource or configuration is involved.

## 20. Production-data / schema impact

None. No migration added or altered, no index or constraint touched, no
destructive operation, nothing that runs against a production database. The
brief's requirement that a migration only change if evidence proves the schema
wrong is satisfied by the evidence proving the opposite: the schema stored the
row correctly.

## 21. Risks / remaining items

- **Low risk.** A test-only change whose fixed form was run 25 consecutive times
  plus a forced worst-case draw.
- **Noted, not fixed (out of scope):** this sandbox cannot run the full suite
  faithfully — see §15 for the two proven causes (`ext-bcmath` absent; a
  transient mid-suite schema rebuild). They are environment gaps here, not
  findings about `main`, which CI reports at `1 failed, 4125 passed` on the
  same base. Reported rather than repaired, per the brief's scope rule.
- **Separate pre-existing flake found in CI, reported not repaired:**
  `ZatcaQrCertificateMaterialExtractorTest:21` failed once on `cae2b84` while
  the parallel workflow run on the *same commit* passed. It generates a fresh
  random EC key per run and compares
  `$details['ec']['x'].$details['ec']['y']` from `openssl_pkey_get_details()`
  against the DER-parsed point. OpenSSL does not zero-pad those coordinates to
  the curve's 32-byte field size, so ~1 run in 125 yields a 31-byte coordinate
  and a 64-byte expectation. Measured on PHP 8.4.19 / OpenSSL 3.0.13:
  `24/3000 draws (0.80%)`, against 1 − (255/256)² ≈ 0.78% expected. The
  production extractor is the correct side — DER's SEC1 point is fixed-width —
  so the fix belongs in the test (left-pad both coordinates). Out of scope
  here per the brief's no-opportunistic-cleanup rule; warrants its own small PR.
- The sibling `StorefrontProvisioningPostgresConcurrencyTest` was checked for
  the same pattern: it derives its hostname from `ManagedStorefrontHostname::forSlug()`,
  not from raw random input, so it is unaffected. No other test in the suite
  builds a hostname from `Str::random` and then asserts on the raw value.

## 22. Confirmation

- **No PR #857 changes.** That branch was not checked out, committed to, or
  pushed during this work.
- **No storefront changes.** Nothing under `storefront/` is touched.
- **No `webhook_events` changes.** That diagnosis was disproved and abandoned;
  no file related to it was opened or edited.
- **No unrelated migration.** No migration of any kind was added or altered.
- **No application-code change at all** — the fix is one test file.
- **Not merged.**
- **Not deployed.**

## 23. Recommended next step

Review and merge this PR. Once it lands on `main`, PR #857's pgsql leg clears
without any change to that branch — its failure was always this test. Rebasing
#857 onto the updated `main`, or simply re-running its checks after this merges,
should take it fully green.
