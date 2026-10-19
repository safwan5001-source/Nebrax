# AWJ AI-ACTIONS-01 + Product Images Foundation — Implementation Report

## Delivery identity

- Repository: `safwan5001-source/Nebrax`
- Base branch: `main`
- Base SHA: `aa6a389fb929179652e2a2652192c30913c52de5`
- Working branch: `feat/ai-actions-01-product-images`
- Implementation head SHA: `ace7950470c69eee572e092cad759210db1f1a51`
- Draft PR: https://github.com/safwan5001-source/Nebrax/pull/1567
- Merge/deploy/Railway changes: none

## Baseline reused

This slice starts from the merged AI-ACTIONS-00 design in PR #1564 (`af5f53b0`) and follows `docs/architecture/AWJ_AI_ACTIONS_ARCHITECTURE.md` and PR 1 of `docs/plans/AWJ_AI_ACTIONS_IMPLEMENTATION_PLAN.md`. It does not repeat or replace the read-only AWJ Intelligence gateway. AI-08 is already on `main` at `7a70612f`; no assistant conversation or financial-answer code was changed.

Repository services reused instead of creating parallel engines:

- `ProductImportService`, `ProductImportFields`, `SpreadsheetReader`, and durable `ImportJobService` remain the catalog import authority.
- `ProductMediaService` remains the only product-media persistence path and continues to use `DocumentStorageService`/R2 and the existing derivative service.
- `WebhookUrlValidator` provides HTTPS, credential, DNS, public-IP, IPv4/IPv6, and no-private-range validation for remote image URLs; the fetcher also disables redirects and applies short timeouts and byte bounds.
- `TenantContext`, `BranchContext`, `BelongsToTenant`, `SetTenant`, `SetBranch`, and `User::canAccessBranch()` provide server-derived tenant/branch scope.
- `Rbac`, `Settings`, and `EnforceUserIdempotency` provide the existing role, tenant flag, and request replay boundaries.

## Implemented changes

### Inert AI Action boundary

- Added a platform flag and tenant setting, both disabled by default.
- Added separately assignable `ai.actions.use`, `ai.actions.approve`, and `ai.actions.repair` permissions. The only registered action additionally requires `products.manage`.
- Added tenant-owned `ai_actions`, immutable `ai_action_versions`, and append-only `ai_action_events`. Child rows use composite tenant/action foreign keys.
- Added the closed `AiActionRegistry`; only `product_import.v1` exists.
- Added strict proposal contracts: exact required keys, bounded rows/payload/strings, typed scalar field values, provenance, decisions, trusted-match kinds, violations, and media-source contracts. Unknown keys fail closed.
- Added `AiActionGateway` create/read/version/cancel orchestration. Every mutation reauthorizes a fresh actor, validates tenant/branch/domain permissions, uses a database transaction, requires `expected_version`, and records a safe allowlisted event.
- Added HMAC-SHA256 proposal hashes over canonical JSON plus tenant/action/version identity.
- Added request idempotency to all mutating action APIs. A stale version returns stable HTTP 409.
- Deliberately did **not** add approve, execute, or repair APIs and did not connect the assistant, Anthropic, or any ERP mutation service. Product rows cannot be created or updated through this gateway.

### Product image import foundation

- Added optional `primary_image_url` and `additional_image_urls` fields to the shared import contract. Catalog mutation payloads explicitly exclude these media-only fields, preserving old CSV/XLSX behavior.
- Added optional product image ZIPs to synchronous preview/apply and durable import jobs. Durable jobs persist the private archive path, safe metadata, and SHA-256; archive identity is part of creation idempotency.
- ZIP matching is deterministic: `<SKU|barcode>.<ext>` is primary and `<SKU|barcode>__2.<ext>`, `__3`, etc. are additional. Existing products resolve by Nebrax ID, then SKU, then barcode registry.
- Preview reports ready, approval-required, erroneous, missing, duplicate/already-attached, and unmatched archive items. Image sources do not affect stock quantities.
- Added an explicit UI archive picker and two distinct confirmations: apply matched images, and add images to existing products. Old imports with no media fields/archive remain unchanged.
- Image persistence delegates to `ProductMediaService`; the first successfully attached image is the cover under the repository's existing `sort_order` convention, with up to eight product-level images.
- Existing product media is never deleted, reordered, replaced, or silently overwritten. With explicit approval this slice only appends new unique images.

### Image security

- Actual bytes, not client MIME alone, are checked with `finfo`, supported MIME/extension agreement, `getimagesize`, a 5 MiB bound, a 40-megapixel bound, and SHA-256.
- ZIP handling never calls `extractTo`/`extractAll`; it rejects absolute/traversal paths, drive paths, NUL, encrypted entries, unsupported members, duplicate basenames, excessive entry/count/uncompressed size, zero-size anomalies, and unsafe compression ratios.
- Remote images require HTTPS, no embedded credentials, public DNS/IP results, no redirect, bounded connect/total time, streaming size enforcement, and content inspection. Remote fetching ships disabled (`PRODUCT_IMPORT_REMOTE_IMAGES_ENABLED=false`) until operations explicitly enables it.
- Import-only `product_media.content_sha256` values plus a tenant/product uniqueness constraint and preflight checks protect against duplicate content and concurrent duplicate attachment. Storage files are removed when a media-row insert loses the uniqueness race; historical direct gallery uploads retain their existing duplicate-permitted behavior.

## Data changes

Three additive migrations are included:

1. AI action/action-version/action-event foundation tables.
2. Nullable `product_media.content_sha256` and uniqueness constraint. Existing rows and direct gallery uploads remain valid with `NULL`; imported images are hashed.
3. Nullable image-archive identity/storage columns on `import_jobs`.

No migration mutates existing product, inventory, tax, price, or accounting values.

## Tests and checks

Added backend coverage for:

- feature-off, absence of execute/approve routes, no product mutation;
- tenant isolation, RBAC, immutable versions/events, strict version conflict, and request replay;
- ZIP Slip and duplicate archive names, content/extension mismatch, SSRF loopback rejection, disabled remote fetch;
- durable archive persistence and archive-aware idempotency;
- legacy import compatibility;
- SKU image linkage, one-time attachment, and explicit approval for existing product media.

Added/updated web coverage for archive form data and role-catalog labels.

Locally completed:

- `git diff --check` — passed.
- Arabic/English message JSON parsing — passed.
- targeted Vitest (`contract`, durable import engine, role catalog): 3 files / 34 tests — passed.
- repository-wide TypeScript check was attempted; it remains red on pre-existing unrelated generated `.next` paths and legacy test fixture type errors. No error referenced a changed file.

PHP is not installed in the provided editing container, so Laravel/SQLite/PostgreSQL execution is delegated to the repository CI. CI result is recorded on the Draft PR.

## Known constraints and risks

- Remote URL ingestion is code-complete but intentionally dark by default. Operations must assess egress controls before enabling it; application validation narrows SSRF risk but does not replace network-level egress policy.
- Product media has no explicit `is_primary` column. Cover identity is `sort_order=0`. New-product imports preserve primary-first order; existing-product imports append only, so this slice does not replace an existing cover.
- Media attachment follows catalog commit and reports per-image partial failures. It never rolls back a valid product import merely because external/storage media failed; failed images can be retried without duplicating successful hashes. A future action executor should persist per-image operation results for richer repair.
- Re-reading and inspecting a large ZIP for each durable chunk is bounded but can be expensive. A future PR may persist an immutable validated manifest after introducing the AI action file/extraction tables from AI-ACTIONS-00 PR 2.
- Existing media rows are not backfilled with hashes in this slice; duplicate-byte detection is authoritative for newly inspected uploads and opportunistic for historical rows.
- No image bytes or spreadsheet rows are sent to Anthropic. No paid provider API is called by implementation or tests.

## Acceptance outcome

- The AI Action gateway is independent, tenant/branch/RBAC checked, versioned, idempotent, audited, schema-closed, and incapable of ERP execution.
- Traditional product import remains available and backward compatible, while gaining an optional shared media plan and persistence path usable by a later AI Action workflow.
- Unsafe images are rejected; existing product media is not changed without a dedicated explicit confirmation.
- No merge, deployment, Railway, or live Anthropic action was performed.

## Recommended next PR

Proceed with AI-ACTIONS-02 from the merged plan: private action-file intake and deterministic CSV/XLSX extraction, reusing the hardened image archive/URL contracts added here. Keep provider calls and ERP execution off. Add immutable extraction manifests once per action file so later preview and durable chunks do not repeatedly inspect the same archive.
