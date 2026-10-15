# AWJ-VD-1C — Implementation Report (Public facet visuals and guarded image delivery)

STATUS: **MERGED** — PR #1499 merged by the owner as `b1b7988b907bc2f437cb2ef6d31ff34c70ece606`. POST_MERGE_REVIEW: PASS — CI (sqlite + pgsql) and Storefront CI green on main. Production deployment still needs the owner's explicit approval.
DATE: 2026-10-14
HORIZON: AWJ-COMMERCE-VISUAL-DIMENSIONS-H1 · slice VD-1c (H1-1)
AUTHORITY:
- The owner authorized VD-1c with decisions D1–D4 (recorded as VD1C-D1..D4 in the decision register) and nine mandatory requirements.
- The authorization covers this slice only.

## Outcome

Storefront shoppers can now receive facet and value visuals: the documents in `meta.facets`, and the images through a guarded route and the storefront proxy. Nothing renders yet; the VD-4b renderer consumes this contract.

**Not touched:**
- `commerce/v1`, which is pinned by N16;
- filtering (`CatalogFacetFilter::apply()`, `facet[key]=slug`);
- the database (no migration), the shared public error renderer;
- RBAC, accounting and inventory.

## Contract

### 1. `meta.facets` (`storefront.v1` only, D1/D2)

| Field | Content |
|---|---|
| `meta.facets[].visual` | the facet document normalized: `{self?, defaults?}`, or `null` |
| `meta.facets[].values[].visual` | the value's own document normalized (no inheritance), or `null` |
| `…image.sources` | `[{width, format, src}]` for each generated file in `thumb-160 \| thumb-320 \| 480w \| 768w` × `webp \| jpg`; `src` is the origin path `/store/v1/media/facet-visuals/{visualId}/{mediaId}/{file}` |

Rules:
- **Visibility on this channel:**
  - A value gets a visual only when `count > 0`. Counts come from the channel-gated, active-only base query, so `count > 0` proves an active product published on this channel carries it.
  - A facet gets a visual only when at least one listed value has `count > 0`.
  - A value listed only because it is selected (count 0) gets `null`. This was found by the independent review (finding 1).
- An image whose media is not active and ready is removed. A document left empty becomes `null`.
- Never emitted: originals, the admin signed `visual_preview`, `visual_version`.
- Legacy `{tenantSlug}` routes return `visual: null` everywhere (D2). The image route is not registered there.
- Two bounded queries per response: the visual rows of the listed facets and values, then their media. A test pins this.

### 2. `GET /store/v1/media/facet-visuals/{visualId}/{mediaId}/{file}`

Host group only (`ResolveStorefrontDomain`). Guards run in this order, all before `If-None-Match`:
1. lowercase UUIDs and a file from the 8-file list;
2. the visual row is in this tenant (`TenantScope`);
3. the facet is active, and the value too for a value row;
4. visible on **this** storefront's sales channel: an active product with a published `CommerceListing` on the channel is assigned to the value, or to any active value of the facet for a facet image;
5. the normalized document references this `mediaId`;
6. the media is tenant-scoped, active and ready, and has the file.

Responses:
- **Success:** `private, no-store` + a content `ETag` (it includes the media id) + `nosniff`.
- **Any failure:** one uniform 404 with `Cache-Control: no-store`, built by the controller's `notFound()` (D4). A catch-all route under the prefix returns the same response.
- **Outside D4:** an unknown host, or a rate-limited request, is refused by the middleware before the controller, through the shared renderer (`no-cache, private`). Those responses carry no data, and the proxy turns every non-200/304 into `no-store`.

### 3. Storefront

- **Proxy** `api/storefront/media/facet-visuals/[visualId]/[mediaId]/[file]`:
  - params are validated before the origin is called;
  - 200 and 304 get `public, max-age=300, must-revalidate` (D3);
  - everything else gets `no-store`;
  - only `image/webp` and `image/jpeg` are passed through.
- **Mapper:** `toRenderableMediaUrl` checks `facet-visuals` before the generic pattern and returns the proxy path or `null`, never the raw URL.
- **`parseListingFacets`:**
  - re-normalizes the documents with the VD-1a twin;
  - keeps only canonical sources for the same media and format;
  - removes an image left without sources;
  - applies the same `count > 0` rule as the server.

**Cache window (requirement 5):**
- At the origin and in `meta.facets`, a withdrawal takes effect immediately.
- A browser or shared cache holding a 200 from the proxy may show it for at most **300 s**. Its revalidation then reaches the origin and gets a 404.
- Tested in `route.test.ts`: a 304 is cached again, a refusal becomes an uncached 404.

## Requirements → evidence

| # | Requirement | Evidence |
|---|---|---|
| 1 | N1–N19 in full | one PHP test per N in `StorefrontFacetVisualPublicTest`; N14 in the proxy `route.test.ts` |
| 2 | tenant and channel isolation, foreign `mediaId` injection | N9, N10, N11, N17, plus `a_store_without_visible_products_never_emits_visuals_even_for_selected_values` |
| 3 | no original, no `visual_preview` | N12, N15, and the parser N15 vitest |
| 4 | image only with active, published products visible on the channel | N17, N18, N19 (route and meta), plus the empty-store test |
| 5 | 300 s window, revalidation after it | proxy vitest (304 re-cached, 404 not cached), N7 |
| 6 | `commerce/v1` unchanged | N16 asserts the exact keys |
| 7 | no filtering or DB change | the diff: no migration; `CatalogFacetFilter` gains only a read accessor |
| 8 | related, then wider suites; independent security review; CI | below |
| 9 | separate PR and this report | PR #1499 |

## Changed files

**New:**
- `app/Services/Commerce/StorefrontFacetVisualProjector.php`
- `app/Http/Controllers/Api/StorefrontFacetVisualMediaController.php`
- `tests/Feature/StorefrontFacetVisualPublicTest.php`
- `storefront/src/lib/commerce/facet-visual-media.ts` and its test
- `storefront/src/app/api/storefront/media/facet-visuals/[visualId]/[mediaId]/[file]/route.ts` and `route.test.ts`
- this report

**Modified:**
- `app/Http/Controllers/Api/StorefrontProductController.php` (projection)
- `app/Support/Commerce/CatalogFacetFilter.php` (`activeFacetModels()`, read-only)
- `routes/api_storefront.php`
- `storefront/src/lib/commerce/{mappers.ts, listing-facets.ts}` and `listing-facets.test.ts`
- `contracts/flowers-journey/01-product-list.json` (additive `visual: null`, regenerated by the test's writer)
- `AWJ-VD-H1-0-EVIDENCE-AND-ARCHITECTURE.md` (§3.8-b/c on D1–D4), `AWJ-VD-H1-DECISION-REGISTER.md`, `AWJ-VD-H1-TASK-QUEUE.md`

## Tests and exact results (local, after the review fixes)

| Suite | Result |
|---|---|
| `StorefrontFacetVisualPublicTest`, SQLite (in memory) | **25 passed (662 assertions)** |
| The same, plus `FlowersEndToEndJourneyTest`, PostgreSQL 16 | **27 passed (717 assertions)** |
| Related suites (facet filter, VD-1b API, media delivery, firewall, branch guard, route registries, OpenAPI contracts, product/category storefront) | **374 passed** |
| PHP full, `--parallel`, SQLite in memory | **OK — 7038 tests, 53520 assertions, 0 failures, 99 skipped** |
| Storefront full (`pnpm test`) | **2580 passed / 15 skipped** |
| Storefront static (Biome, `tsc`) | clean, exit 0 |

**Mutation checks** (each test was proven to fail without its guard):
- Channel-visibility and media-reference guards disabled: 8 tests fail (N1, N4, N5, N7, N11, N17, N18, N19).
- The `count > 0` gate removed: 3 tests fail (N17, N19, the empty-store test).

## Independent security review

A separate review re-read the diff, ran the tests, and confirmed its main finding with a probe.

| # | Finding | Decision |
|---|---|---|
| 1 | **Blocking:** `meta.facets` emitted visuals for a value selected at count 0 (not visible on this channel), and for its facet. This broke the meta clause of N17. | **Fixed**: the `count > 0` gate, plus tests (N17 with a selection, N19 meta, a store with no products) |
| 2 | The storefront had no defence in depth for 1 | **Fixed**: the parser applies the same rule |
| 3 | The parser accepted non-canonical same-origin paths | **Fixed**: only the strict facet-visuals rewrite is used, plus a test |
| 4 | The route read the raw document, the projection the normalized one | **Fixed**: the route normalizes too, plus a test with an uppercase, padded id |
| 5 | Middleware-level 404 and 429 are `no-cache` rather than `no-store` | **Documented** as outside D4: no data, and the proxy enforces `no-store` |

Confirmed clean: tenant scopes on every model and on the raw pivot query, guard order before 304, strict validation (`%2F`, dot segments, case, segment counts), N9 body and header identity, proxy cache partitioning per host, no original or signed preview in meta, `commerce/v1` keys unchanged.

## CI

- First head `68f7412`: pgsql failed on one test, `VatAdjustmentRoutingTest::a_purchase_debit_note_credits_the_current_tax_input_role`.
  - The values are identical; only the key **order** differs. The test's `journal()` helper loads `lines` without `ORDER BY`, and `assertSame` compares order, so PostgreSQL row order made it fail.
  - VD-1c does not touch that test or accounting. The details and a proposed one-line patch are on the PR rather than widening this slice into an accounting test.
- Final head `23e72f4`: **7/7 green** (php sqlite, php pgsql, CI Gate, storefront ×2, visual QA ×2), with the accounting test above passing.

## Accounting impact

**None.** No financial operation, no journal entry.

## Risks and what remains

- **Nothing visible yet:** VD-4b renders the visuals, and VD-5 verifies a real image load in the browser.
- **Conservative visibility:** a selected value whose count is 0 because of other filters shows no image even though its own products are visible. This is intentional: meta never emits what it cannot prove.
- **Pre-existing, outside scope:** the pgsql ordering flake above.
