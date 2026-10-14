# AWJ-VD-4A — Implementation Report (Discovery display contract and templates)

STATUS: **MERGED** — PR #1490 merged by the owner as `c57f4be1746fdf6ce92df2ea2adba2a075d2b3c6`. POST_MERGE_REVIEW: PENDING (post-merge CI running).
DATE: 2026-10-14
HORIZON: AWJ-COMMERCE-VISUAL-DIMENSIONS-H1 · slice VD-4a (H1-4)
AUTHORITY: the owner authorized VD-1b and VD-4a in parallel, on their approved contracts. That approval covers only these two slices' DB/API changes. Decision 4 set the rule for out-of-range numbers (see "Numbers" below).

## Outcome

A `discovery` section can now carry its **display settings** (L3, §3.7) in the presentation document. A **code-owned template registry** supplies defaults that any explicit value overrides. Nothing renders differently yet: the storefront renderer (VD-4b) and the builder UI (VD-4c) consume this contract later.

**Not touched:**
- the database, endpoints, the OpenAPI specs (`store/v1/storefront` is in none of them), and rendering;
- the filtering logic (`facet[key]=slug`), Bloom (ADR-26), and anything financial.

## Contract

Optional keys of `discovery` content are emitted **only when present and valid**, in this canonical order, after the four existing keys `title, axis, dimension?, display`:

| Key | Values | Absent means |
|---|---|---|
| `layout` | `image-grid` · `image-cards` · `carousel` · `icon-grid` · `text-list` | template, else legacy `display` (tiles/chips) |
| `template` | a registry id (below) | none |
| `columns` | `{mobile 1–4, tablet 2–6, desktop 2–8}`; each device optional | template, else 2/3/4 |
| `rows` | 1–2 (carousel only) | template, else 1 |
| `gap` | `tight` · `normal` · `loose` | `normal` |
| `textPosition` | `below` · `overlay` · `beside` | template, else `below` |
| `contentSequence` | `media-first` · `label-first` | `media-first` |
| `valueSort` | `merchant` · `count` | `merchant` |
| `shape` / `size` / `showLabel` | VD-1a lists | inherit (facet-visual chain, D-08) |
| `cardStyle` | `plain` · `outlined` · `elevated` · `filled` | template, else `plain` |
| `align` | `start` · `center` | `center` |
| `showCounts` | boolean | `false` |
| `maxItems` | 4–24 | 12 |

**Numbers (owner decision 4).** The existing contract is kept:
- Saving a presentation document **normalizes and never returns 422 on content**, so strict save-time validation would break that contract and was not added.
- Integers follow the existing `productShelf.limit` rule in all three normalizers. An integral number (`6`, or `6.0`, which PHP decodes as a float) is **clamped** into its range. Anything else (a fraction, a string, a boolean, an object, `INF`) **drops the key**, so the value inherits.
- A legacy document normalizes byte-for-byte as before.

**Templates** (`DiscoveryTemplateRegistry` in PHP + byte-identical `discovery-templates.ts` in web and storefront, pinned to `tests/Fixtures/presentation/discovery-templates.json`; append-only): `gift-circles`, `boutique-arches`, `editorial-portrait`, `market-icons`, `swipe-rail`, `minimal-text`, `catalog-rounded`, with the §3.7 values.

**Resolver** (`resolveDiscoveryDisplay`, TS):
- Every layout key resolves as explicit section value → template → system default; columns resolve per device.
- `rows` applies only when the resolved layout is `carousel`.
- `shape`, `size` and `showLabel` are **not** resolved here. They are handed to the facet-visual resolver from VD-1a:
  - the section's explicit values become its `section` context, above the value's own visual;
  - the template's values become its `template` context, below the value's own visual.
- This keeps D-08's per-property chain, with no change to VD-1a.

## Deviation from the approved text: two key names

`contentOrder` and `valueOrder` were renamed to **`contentSequence`** and **`valueSort`**. Values and meaning are unchanged.

- **Why:** the independent review found that the commerce firewall (`commerce-firewall.json`, CUST-HV V9d-4) denies any key whose last word is a commercial word, and `order` is one. Both keys would have been **denied**. The firewall's hostile fixture did not include the new keys, so tests were green.
- **Proof:** with the old name injected, `StorefrontCommerceFirewallTest` fails with "commercial keys leaked … contentOrder".
- **Choice:** renaming leaves the firewall policy untouched (a security control) and loses no data, since nothing is stored under the old names.
- **Alternative for the owner:** add both names to the firewall's `allowedKeys`. That is a security-policy change and needs an explicit decision.
- **Updated:** the architecture document's §3.7 now uses the new names, with a note recording the change.

## Builder editor: a backward-compatibility fix

The existing discovery panel (`DataSectionFields.tsx`) **rebuilt** the content from its four fields on every edit, so it would have erased stored display settings when a merchant renamed a section.

- It now keeps the settings it does not edit.
- They are kept from the **last real content** (a ref refreshed in an effect), so an edit that briefly empties the section, such as switching to the facet axis before choosing a dimension, does not lose them.
- Two tests cover this; each was shown to fail without its fix.

## Changed files

**New:**
- `app/Support/Commerce/DiscoveryTemplateRegistry.php`
- `storefront/src/lib/presentation/discovery-templates.ts`
- `web/src/modules/store-experience-builder/presentation/discovery-templates.ts` (byte-identical twin)
- `tests/Fixtures/presentation/discovery-templates.json`
- `tests/Feature/DiscoveryDisplayContractTest.php`
- `storefront/src/lib/presentation/__tests__/discovery-display.test.ts`
- `web/src/modules/store-experience-builder/__tests__/discovery-display.test.ts`
- this report

**Modified:**
- `app/Support/Commerce/StorefrontPresentationNormalizer.php` (constants + `discoveryDisplayOptions` + `clampedInteger`)
- `storefront/src/lib/presentation/section-content.ts`
- `web/src/modules/store-experience-builder/presentation/section-content.ts` (the same constants, types and normalization)
- `tests/Fixtures/presentation/data-sections.json` (+6 discovery cases; additions only)
- `tests/Fixtures/presentation/commerce-firewall.json` (the VD-4a keys added to the hostile discovery section; additions only)
- `web/src/modules/store-experience-builder/DataSectionFields.tsx`
- `web/src/modules/store-experience-builder/__tests__/ControlPanels.dataSections.test.tsx`
- `docs/plans/store/visual-dimensions/AWJ-VD-H1-0-EVIDENCE-AND-ARCHITECTURE.md` (§3.7 key names)
- `AWJ-VD-H1-TASK-QUEUE.md`

## Tests and exact results (local)

| Suite | Result |
|---|---|
| PHP focused (`DiscoveryDisplayContractTest`, `StorefrontPresentationDataSectionsTest`, `StorefrontCommerceFirewall*`) | **15 passed (3942 assertions)** |
| PHP full (`php artisan test --parallel`, SQLite) | **OK — 6913 tests, 52059 assertions, 0 failures, 95 skipped** |
| Storefront full (`pnpm test`) | **200 files passed / 15 skipped; 2562 tests passed / 15 skipped** |
| Storefront static (Biome · locales · `tsc`) | Biome 0 errors (2 warnings + 2 infos, pre-existing, untouched files) · locales in sync · tsc exit 0 |
| Web full (`npm run test`) | **613 files / 6794 tests passed** (includes the drift ratchet) |
| Web build | **Compiled; 189/189 static pages** |

**What the tests pin:**
- **PHP:** exact key order with `assertSame` (no key sorting), idempotency, the legacy document byte-identical, the registry `===` its fixture, append-only ids, and every template valid as content.
- **TS:** the same fixture with key order, closed lists and ranges parsed from the PHP source, the registry against its fixture, byte-identity of the twins, and resolver precedence (including `rows` only for carousel and prototype-key ids like `constructor`).
- **Firewall:** the hostile document now carries every VD-4a key, in PHP and both TS suites.

Notes:
- Web `tsc --noEmit` shows the same 48 pre-existing test-file errors, none in changed files. `npm run lint` is not configured in this repo.
- PostgreSQL runs in CI; this slice has no SQL.

## Independent review

A separate review of commit `5ce5fab` re-ran PHP and both TS normalizers on hostile inputs and found **parity in values and key order**. Inputs included:
- `1e20`, `-0`, `INF`, `3.0000000000000004`, `"4"`;
- booleans, `columns` as a list or `{}`;
- `__proto__` and `constructor`.

It raised:

| # | Finding | Decision |
|---|---|---|
| 1 | `contentOrder`/`valueOrder` denied by the commerce firewall (blocking contract conflict) | **Fixed by renaming**, plus the keys added to the hostile fixture. The allow-list alternative is left to the owner. |
| 2 | The editor fix lost settings across an edit that briefly empties the section | **Fixed** (ref + effect) with a test that fails without it. |
| 3 | `rows` should apply to the carousel only | **Fixed** in the resolver, with tests. |
| 4 | `Object.hasOwn` is new in the public bundle (ES2017 target) | **Fixed.** An explicit id list replaces it; Biome had been rewriting `hasOwnProperty.call` back to `Object.hasOwn`. |

## Accounting impact

**None.** No financial operation, no journal entry.

## Tenant / branch isolation, security

- No model, query or endpoint.
- Merchant values reach output only through closed lists, bounded integers and booleans; no free text was added.
- The commerce firewall is unchanged and now covers these keys.

## Backward compatibility

- Additive and optional.
- Existing and default documents are byte-identical.
- `display` is still honoured when `layout` is absent.
- The editor no longer drops unknown display keys.
- PR #1089 (version publish) re-normalizes through this same normalizer, so it keeps the keys. PR #853 is docs only.

## API / DB / migration impact

- No database or migration.
- **Public document contract:** `store/v1/storefront` may now carry the optional keys above. This is why merging needs explicit approval.

## Risks / remaining

- Nothing visible until VD-4b (renderer) and VD-4c (builder UI).
- The legacy mapping when `layout` is null (tiles/chips) stays the renderer's responsibility.

## Git state

- Branch: `feat/vd-4a-discovery-display-contract` from `757a7a3`
- PR / head: recorded on the PR
