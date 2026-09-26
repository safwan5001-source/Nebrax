# Owner decision — store branding media durability

**Status:** Resolved on current `main`. Documentation only.  
**Decision date:** 2026-09-26  
**Recorded on main by:** STORE-TRUST-STATE-1  
**Stable key:** `KEEP_EMBEDDED_MEDIA_UNTIL_PERSISTENT_STORAGE_IS_AUTHORIZED`

## Why this file exists

The owner selected this decision while the write-up still lived only in open PR #1044 (`docs/store-branding-media-evidence`, head `7d322222afcace1fe68ed73a88712edeb1ab1ecb`, base `0f36355573b3de746211bd1bed0a6f888f0bba0a`).

That pull request is **not merged**. Its base is stale, and it edits `CURRENT-STATE.md` from that old base. Merging it is not authorized.

This file is the durable copy on current main. It does not authorize implementation.

## Problem the decision answers

Store logos, compact logos, and favicons are raster data URLs, or merchant-typed `https` URLs, inside the storefront presentation JSON. Each slot is capped at 512 KiB. SVG is rejected. The JSON is durable because it is in PostgreSQL.

`DocumentStorageService` is the existing private file authority. Production forces it onto the local container disk while `DOCUMENT_DURABLE_STORAGE_ENABLED=false`. `deploy/DEPLOY.md` documents that disk as ephemeral. Putting branding on that disk would be less durable than the current JSON.

## Selected option

**Option 1 — keep embedded branding media until persistent storage is explicitly authorized.**

### Effective behavior

- Keep raster data-URL branding in the presentation JSON, including the 512 KiB cap and the SVG rejection.
- Keep merchant-entered `https` branding URLs.
- Keep banner media on the existing `https` URL contract.
- Do not add a branding upload endpoint.
- Do not move branding onto the local container disk.
- Do not add a branding-only bucket or a second storage service.
- Do not enable `DOCUMENT_DURABLE_STORAGE_ENABLED` from Store Customizer or from this trust horizon.
- Do not rewrite existing presentation documents.

### Not selected

- Authorize durable-storage activation now, then extend `DocumentStorageService`. That remains a later platform decision. It is not started here.
- Upload branding to the current local disk. Rejected.
- Add a new storage provider. Rejected.

## What remains deferred

Business Documents Viewer and any branding upload stay deferred until a later explicit authorization of persistent storage. A favicon `<link>` that only reads the existing data URL was not part of this decision and is not started here.

Offers, promotions, undo/version history, Market, and Floral are unchanged by this decision.

## What this decision does not authorize

No runtime code, no database migration, no new bucket, no production file migration, and no deploy.
