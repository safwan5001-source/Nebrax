<?php

/**
 * CUST-HV V2a — Customizer media library (`storefront_media`).
 *
 * Reuses the approved R2 foundation (`R2StorageService`) and the same imaging
 * runtime as product media (Intervention Image over GD — one library, one
 * container binding). Contract: docs/plans/store/CUST-HV-V0-DECISIONS-AND-
 * ARCHITECTURE-CONTRACT.md §7.
 */
return [
    // Fail-closed gate. While false, uploads answer 503 `storage_not_enabled`
    // and the library lists what exists — there is never a fallback to the
    // ephemeral DocumentStorageService disk (V0 §7.1). Production enablement is
    // the N-2 go-live checklist item (verify R2 credentials first), not a code
    // decision.
    'r2' => [
        'enabled' => filter_var(env('STOREFRONT_MEDIA_R2_ENABLED', false), FILTER_VALIDATE_BOOL),
    ],

    // Upload validation (V0 §7.4).
    'max_files_per_request' => 8,
    'max_bytes' => 5 * 1024 * 1024,
    'min_short_edge' => 320,
    'max_edge' => 8192,
    'max_pixels' => 40_000_000,

    // Decode-memory guard (N-1 — calibrated on measured RSS, see the V2a report).
    // GD allocates pixel buffers outside PHP's `memory_limit`, so that ini value
    // says nothing about the real cost; the container's RAM does. Measured peak
    // RSS above the idle process: ≈ pixels × 4 × 1.0 (decode + in-place scale)
    // and ≈ pixels × 4 × 2.75 when EXIF orientation forces a rotated copy.
    // The estimate uses 1.15× / 3.0× plus a fixed overhead and is compared with
    // a per-request budget; an image over budget is refused up front with an
    // actionable error rather than risking the worker. 256 MB admits every
    // plain image up to the 40 MP cap and rotated phone photos up to ~18 MP.
    'decode_budget_bytes' => (int) env('STOREFRONT_MEDIA_DECODE_BUDGET_MB', 256) * 1024 * 1024,
    'decode_overhead_bytes' => 32 * 1024 * 1024,
    'decode_buffers_plain' => 1.15,
    'decode_buffers_rotated' => 3.0,

    // Per-tenant library quota (V0 §7.4 plan-limit hook; V2 default).
    'max_assets_per_tenant' => (int) env('STOREFRONT_MEDIA_MAX_ASSETS', 500),
    'max_bytes_per_tenant' => (int) env('STOREFRONT_MEDIA_MAX_BYTES', 1024 * 1024 * 1024),

    // Base variant ladder (V0 §7.5): WebP + JPEG fallback at each width.
    'ladder_widths' => [480, 768, 1280, 1920],
    'thumbnail_widths' => [160, 320],
    'quality' => ['webp' => 82, 'jpg' => 85],

    // V2b — per-usage transform derivatives (V0 §7.5). Nominal widths are the
    // base ladder (they enter the transformKey); each usage is 4 widths × 2
    // formats = 8 files from ONE decode. Generation is inline and bounded to one
    // usage per request (no worker, no scheduler — AWJ Production has neither).
    'derivative_widths' => [480, 768, 1280, 1920],
    // `pending` older than this is read as failed(interrupted) and may be
    // re-claimed by the next request: a crashed/timed-out request can never
    // leave a usage permanently pending (AMEND-21). Must exceed the slowest
    // legitimate single-usage render (measured in the V2b report).
    'derivative_lease_seconds' => (int) env('STOREFRONT_MEDIA_DERIVATIVE_LEASE_SECONDS', 120),
    // Abuse bounds, not UX limits: a crop edit saves a new usage key, so the
    // V2c reconciler (not these caps) is what reclaims superseded framings.
    'max_derivative_usages_per_media' => 200,
    'max_derivative_rows_per_tenant' => 4000,
    'max_status_transforms_per_request' => 16,

    // Soft-delete retention before the reconciler may purge (V0 §7.9).
    'purge_after_days' => 30,
    // Derivatives of a framing that no document references any more are removed
    // only after this grace, so a framing being edited right now is never reaped.
    'derivative_orphan_grace_hours' => 24,

    // Workspace signed read link lifetime (V0 §7.3).
    'signed_url_minutes' => 20,
];
