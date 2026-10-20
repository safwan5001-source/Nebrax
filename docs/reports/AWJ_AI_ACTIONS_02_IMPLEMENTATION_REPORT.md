# AWJ AI-ACTIONS-02 — Secure Product File Intake & Extraction

## Scope delivered

This change adds the second, non-writing AI Actions slice for `product_import.v1`:

- private CSV/XLSX source-file intake;
- deterministic, immutable extraction manifests bound to the AI Action and its version;
- Arabic and English header mapping through the existing `ProductImportFields` catalog;
- explicit missing/invalid-field violations, including absent trusted identifiers;
- image URL source preservation for the product-image workflow introduced in AI-ACTIONS-01;
- authenticated retrieval of the persisted manifest.

There is no Anthropic call, product creation/update, stock mutation, accounting posting, approval, execution, repair endpoint, Railway change, or deployment in this slice.

## Reuse and design decisions

| Existing component | Reuse in this change |
| --- | --- |
| `AiActionGateway` / `AiActionPolicy` | The intake service calls the same fresh-user, tenant, RBAC, and branch-context authorization path as Action drafts. |
| `ProductImportFields` | Header aliases and field definitions are the single mapping source for Arabic/English CSV/XLSX files. |
| `SpreadsheetReader` | Reads CSV and XLSX. Its existing XLSX archive limits protect against malformed archives and compression bombs. AI Actions deliberately accepts only CSV/XLSX, not its legacy `.txt` compatibility input. |
| `ProductImportActionSchema` | Validates each extracted row against the existing closed proposal contract before persistence. |
| `DocumentStorageService` | Writes the raw source stream to the existing private storage profile; no public URL or storage key is returned by the API. |
| `EnforceUserIdempotency` | Protects HTTP retries. A database unique key on action/version/content SHA-256 also coalesces same-content uploads submitted with a new request key. |

## Data and API contracts

New immutable records:

- `ai_action_files`: source metadata, SHA-256, private storage profile/key, action version and uploader;
- `ai_action_extractions`: extraction manifest, HMAC manifest hash, action version and creator.

New routes, both behind `ai.actions.use`, the existing action-domain permission, tenant scope, branch scope, rate limits, and action-version checks:

- `POST /api/ai-actions/{action}/files` (`expected_version`, `file`)
- `GET /api/ai-actions/{action}/files/{file}/extraction`

The manifest preserves source values and origin (`extracted`/`missing`) and emits `needs_review` for missing or invalid values. It neither manufactures prices/SKUs nor fetches image URLs. Image references retain `existing_update_approved: false`, so a future application phase cannot treat them as approval to overwrite existing product images.

## Security properties

- Extension allow-list plus actual CSV UTF-8/content validation and actual XLSX parsing; upload MIME is descriptive only and not trusted.
- Bounded file and row limits; the XLSX reader's existing archive traversal/size checks are reused.
- Files are private; API responses omit storage profile/key and do not expose a download endpoint.
- URLs are recorded only, never fetched, so this intake slice has no SSRF path. Invalid/non-HTTP(S) image references are visibly flagged.
- Tenant-bound route models plus the Gateway policy prevent cross-tenant access; action/file association is checked again before retrieval.
- `lockForUpdate`, exact expected version, HTTP idempotency, and a content SHA-256 uniqueness constraint protect against stale or duplicate requests.
- Source-file and extraction model updates/deletes throw; the manifest hash is calculated over canonical JSON with tenant/action/version binding.

## Files changed

- `config/ai_actions.php`
- `database/migrations/2026_11_15_010000_create_ai_action_file_intake_tables.php`
- `app/Models/AiAction.php`
- `app/Models/AiActionFile.php`
- `app/Models/AiActionExtraction.php`
- `app/Services/AiActionGateway.php`
- `app/Services/AiActionProductFileIntakeService.php`
- `app/Http/Requests/StoreAiActionFileRequest.php`
- `app/Http/Resources/AiActionExtractionResource.php`
- `app/Http/Controllers/Api/AiActionController.php`
- `routes/api.php`
- `tests/Feature/AiActionProductFileIntakeTest.php`

## Tests and checks

Added feature coverage for:

- Arabic CSV and English XLSX extraction;
- preservation of image source fields, missing purchase price, and no product writes;
- duplicate content upload replay and stale-version rejection;
- corrupt XLSX, unsupported type, and oversized file rejection;
- tenant isolation and RBAC denial.

`php -l` passed for every new/changed PHP implementation and test file by running the cached `php:8.3-apache` container.

Full Laravel feature tests could not be run in this workspace: the Docker build reached `apt-get update` but the build container could not resolve `deb.debian.org`. This is an environment DNS limitation, not a test failure. Run the following CI-equivalent checks after push:

```bash
php artisan test --filter=AiActionProductFileIntakeTest
php artisan test --filter=AiActionsFoundationTest
php artisan test --filter=ProductImportMediaSecurityTest
```

Run the first two under both SQLite and PostgreSQL; project CI already matrices those databases. Run the web workflow unchanged as it is triggered by the pull request.

## Residual risks / next slice boundary

The source file is intentionally retained privately for the action retention period; the scheduled retention/deletion job belongs to a later lifecycle PR. URL fetching, ZIP image ingestion, product matching, editable grids, preview approval, and product writes are deliberately not enabled here.

## Recommended first interactive-table task

Implement a read-only-to-editable Product Import Review table over this manifest: server-side JSON Patch-style field edits create a **new AI Action version**, recompute validation/matching, show extracted/user/AI origins distinctly, and filter `needs_review` rows. It must still have no execute endpoint; approval and product persistence remain a later PR.
