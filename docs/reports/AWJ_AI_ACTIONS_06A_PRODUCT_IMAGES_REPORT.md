# AWJ AI-ACTIONS-06A — Product Images (first of two linked PRs)

## Scope decision

The task asked for product images **and** a repair workflow. Together they exceed a safe single PR (a new
staging store, a per-image result model, an approval-bound identity for every image, an execution change and
two UI surfaces — before any repair logic). Per the brief the work is split into two linked PRs, **images first**:

| PR | Content | Status |
|---|---|---|
| **06A (this PR)** | Images: staging, preview identity, approval binding, per-image execution result, thumbnails, UI | Draft |
| 06B | Repair workflow for failed rows (stacked on 06A) | follows |

No other feature was added.

## What is implemented (and verified)

### Sources
* **URLs in the CSV/XLSX** (`primary_image_url`, `additional_image_urls`) — already in the closed extraction contract.
* **A ZIP of images attached to the action** — `POST /api/ai-actions/{action}/image-archives`. Entries are matched to rows by
  `SKU`/barcode (`SKU.jpg` = cover, `SKU__2.jpg`, `SKU__3.jpg` … = extras) — the same convention as the traditional importer.
* Direct single-image uploads: **not added**. The current structure has no per-row upload surface; a ZIP of one image covers it,
  and a second upload path would have meant a second validation path.

### Security (nothing is fetched or stored before it passes)
| Threat | Control |
|---|---|
| SSRF | URL must be HTTPS, no credentials, DNS resolves only to public addresses (`WebhookUrlValidator`), **checked before any request**; no redirects; connect/total timeouts; streamed size cap. Remote fetching stays **off** (`PRODUCT_IMPORT_REMOTE_IMAGES_ENABLED=false`); when off, no request and no DNS lookup is made and the row only carries a warning. At most `ai_actions.max_remote_images_per_preview` (20) fetches per preview. |
| Zip Slip / hostile ZIP | The whole archive is validated first (`ProductImageArchiveService::manifest`: `..`, absolute and drive paths, NUL, encryption, unsupported members, duplicate basenames, entry count, uncompressed size, compression ratio); nothing is extracted to a path — each entry is streamed to a temp file and then to a generated private key. One bad entry rejects the whole archive and leaves **no object behind**. |
| Malicious / mislabelled files | Real content is inspected (`finfo` MIME ↔ extension, `getimagesize`, 5 MiB, 40 MP, SHA-256) before storage, and a thumbnail must decode (an image the gallery could not derive is rejected here). |
| Leaking signed links | The preview/audit label is `host/path` only; the raw URL (query/token) is never echoed into the preview, events or API. |
| Tenant / branch isolation | `AiActionImage` / `AiActionExecutionImage` are `CompanyWide` records reached only through the action (tenant-scoped route + `authorizeFileIntake` branch check); thumbnails are served by an authenticated, action-scoped endpoint (`nosniff`, `default-src 'none'`, private cache). |

### Preview and approval
* Each row lists every image it names: source (kind + safe label), role, **content SHA-256**, MIME, size, dimensions, a thumbnail, and
  a status (`ready` / `skipped` / `unavailable` / `error`) with the reason. The identity is inside the preview that the approval hash
  binds; swapping the bytes or the archive after approval changes the live recomputation (`approval_stale`) or withdraws the approval.
* Matching state is explicit: archive entries that match no row are listed (`images.archive.unmatched`); one entry matching two rows
  is an error (`archive_image_ambiguous`); two cover images is an error.
* **Existing products are never replaced.** There is no replace/delete/reorder operation at all. Adding images to an existing product is an
  **append** that needs an explicit per-row decision (`media_update_approved`, saved as a new action version); without it the images are shown
  as `skipped: existing_product_needs_decision` and the product itself can still be updated. An image already on the product is
  `skipped: already_attached`; exceeding the 8-image gallery limit blocks the preview.
* Uploading a *different* image set after a preview/approval withdraws them (`image_source_changed`); re-uploading the same pictures (even
  re-zipped) is an idempotent no-op. The newest upload is always the matched one.

### Execution
* Approval still never executes; the images are attached only inside the approved execution, **from the staged, approved bytes — no network at
  execution time**. Each image has its **own result record** (`ai_action_execution_images`: pending / success / failed / skipped, reason,
  retryable, attempts, resulting `product_media_id`), independent of the product row. A product can succeed while an image fails; the run then
  ends `partially_failed` and an image is **never reported as saved unless the media row exists**.
* Before attaching: the product must still be visible to the actor, the staged bytes must still hash to the approved identity
  (`image_changed`, non-retryable), the gallery must have room (`gallery_full`), and a duplicate hash is reconciled (a crash between "attached" and
  "recorded" never attaches twice).
* Retry re-runs **failed, retryable images alone** under the same still-valid approval: the product is not saved again, no activity is duplicated.
* An image-only update of an existing product leaves the product record untouched.
* Reuses `ProductMediaService::attachToProduct` (storage, derivatives, content-hash uniqueness) — no parallel gallery code.

### UX
Upload file → review → (images card: ZIP upload) → preview with thumbnails and per-image status → approval → run → results with per-image
status → retry of failed work. Arabic and English (`<html lang>`), RTL-safe (logical classes, `bdi`/`dir="ltr"` for file names and hashes).
A double click on the ZIP picker sends one request; upload is disabled with unsaved edits or after execution starts.

## Not changed
Accounting, stock, price/tax rules, the traditional import, `AI_ACTIONS_EXECUTION_ENABLED` (still `false` by default), Anthropic, Railway.
No journal entry is produced by this change (images do not touch the ledger or stock — asserted in the tests).

## Files
Backend: `database/migrations/2026_11_18_010000_create_ai_action_image_tables.php`, `app/Models/AiActionImage.php`,
`app/Models/AiActionExecutionImage.php`, `app/Services/AiActionProductImageStager.php` (new), `AiActionProductPreviewBuilder.php`,
`AiActionProductApprovalService.php`, `AiActionProductExecutionService.php`, `AiActionProductReviewService.php`,
`AiActionController.php`, `StoreAiActionImageArchiveRequest.php`, `StoreAiActionReviewRequest.php`, `routes/api.php`, `config/ai_actions.php`.
Web: `modules/ai-actions/product-images.ts`, `product-images-ui.tsx` (new), `product-preview*.ts(x)`, `product-execution*.ts(x)`,
`app/(app)/products/ai-import/page.tsx`. Tests: `AiActionProductImagesTest` (18), updated `AiActionProduct{PreviewApproval,Execution}Test`,
`product-images-ui.test.tsx` (12), page/panel tests.

## API additions
* `POST /api/ai-actions/{action}/image-archives` (`expected_version`, `archive`; `ai.actions.use`, idempotent, throttled)
* `GET  /api/ai-actions/{action}/images` — staged archive summary
* `GET  /api/ai-actions/{action}/images/{image}/thumbnail` — authenticated thumbnail
* `POST /api/ai-actions/{action}/review/versions` — edit accepts `media_update_approved` per row
* Preview rows gain `images.items[]`; the preview gains `images.archive` and `totals.images`; execution rows gain `images[]`, the execution
  gains `images` counts and `permissions.retryable_images`.

## Tests

| Check | Result |
|---|---|
| `AiActionProductImagesTest` (new, 18: valid/invalid images, SSRF incl. internal/metadata/loopback/plain-http/credentials/redirect/non-image/oversize, remote dark by default + fetch bound, Zip Slip + hostile archives, existing-gallery decision/append-only/duplicate/full gallery, archive ambiguity, image changed after approval, new archive withdraws approval, image failure after product success, retry of one image alone, expired approval + revoked permission, tenant/branch isolation, idempotency, immutability) | **18 passed on SQLite and PostgreSQL** (PG run twice) |
| All `AiAction*` + `ProductImport*` + `ProductMedia*` + `ProductReferenceClassificationGuard` + `BranchIsolationGuard` | **205 passed on PostgreSQL**, 58+ on SQLite |
| Full PHP suite, SQLite (local, 8,072 tests) | 7,901 passed, 145 skipped, **26 failed — all in `Fuel*` classes** (`bcmul()` undefined: `bcmath` is not installed in this environment; CI installs it). Nothing else failed. |
| Web `vitest` AI Actions + ai-import | **48 passed** (new: 12 image-component tests — authenticated thumbnails, per-image status/reason, append-only note, ZIP upload with idempotency key + version, server rejection, disabled while unsaved/locked, double-click guard, English; 2 page tests — upload then review reload, explicit media decision only for *update* rows) |
| `npm run build` (Next.js) | passes |
| `tsc --noEmit` | no errors in changed files |

**CI note.** The first CI run of the web build failed in an unrelated `store-experience-builder` test. Root cause: the AI panel tests stubbed
`crypto.randomUUID` (a constant id) and never unstubbed it, and vitest runs every file in one process, so two same-id sections collapsed in a later test.
The test was passing in isolation. Fix (06A `a814ae0`): AI test files call `vi.unstubAllGlobals()` after each test; no unrelated test was edited.

Two existing assertions changed meaning (images are no longer "deferred"): `AiActionProductPreviewApprovalTest` (remote-off URLs are `unavailable` with a warning) and `AiActionProductExecutionTest` (per-image `unavailable`, `deferred = {unit_template}`).

## Risks and what remains
1. **Remote fetching is code-complete but dark.** Application-level SSRF checks narrow the exposure; they do not replace a network egress policy
   (DNS can change between validation and connect). Enable `PRODUCT_IMPORT_REMOTE_IMAGES_ENABLED` only behind egress controls. The shared
   fetcher was deliberately not changed (it also serves the traditional import).
2. **Staging is synchronous** (`QUEUE_CONNECTION=sync`): archives are capped at 200 images (`AI_ACTIONS_MAX_ARCHIVE_IMAGES`) and 20 remote fetches per
   preview; larger sets must be split. Image attachment is batched (50 per request) and driven by the UI loop.
3. Staged objects are kept with the action (private); the retention job planned in AI-02 should delete them with the draft.
4. No `replace` of an existing product's images exists by design; if the business needs it, it is a separate, explicitly approved operation.
5. Direct single-file upload per row and AVIF/GIF are out of scope.
6. Local environment lacks `bcmath`/`APP_KEY` (Fuel tests); CI is authoritative.

## Git / CI

__GIT__

## Next step
**06B — Repair workflow** stacked on this branch: failed rows shown with reasons inside `/products/ai-import`, edit only the affected fields (value
provenance kept), re-validate, new preview + approval when data changed or the approval expired, re-run only the failed rows, never touching
successful products or earlier results.
