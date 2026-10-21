<?php

return [
    // AI-ACTIONS-01: the action surface ships dark. Enabling the read/write
    // draft workflow still does not enable ERP execution or a paid provider.
    'enabled' => filter_var(env('AI_ACTIONS_ENABLED', false), FILTER_VALIDATE_BOOLEAN),
    'max_product_rows' => (int) env('AI_ACTIONS_MAX_PRODUCT_ROWS', 2000),
    'max_proposal_bytes' => (int) env('AI_ACTIONS_MAX_PROPOSAL_BYTES', 5 * 1024 * 1024),
    // AI-ACTIONS-02: intake accepts only a bounded, private source file. The
    // extracted manifest remains subject to max_product_rows above.
    'max_file_bytes' => (int) env('AI_ACTIONS_MAX_FILE_BYTES', 10 * 1024 * 1024),
    'max_file_rows' => (int) env('AI_ACTIONS_MAX_FILE_ROWS', 2000),
    // AI-ACTIONS-04: a preview can be approved only while fresh, and an approval
    // is a short-lived authority — a later execution step must start inside it.
    'preview_ttl_minutes' => (int) env('AI_ACTIONS_PREVIEW_TTL_MINUTES', 30),
    'approval_ttl_minutes' => (int) env('AI_ACTIONS_APPROVAL_TTL_MINUTES', 60),
    // AI-ACTIONS-05: applying an approved preview writes products. It ships dark and is
    // independent of `enabled`, so the review/approval surface can be on while writes are off.
    'execution_enabled' => filter_var(env('AI_ACTIONS_EXECUTION_ENABLED', false), FILTER_VALIDATE_BOOLEAN),
    // Rows applied per request (each in its own transaction) and how long a worker holds the lease.
    'execution_batch_rows' => (int) env('AI_ACTIONS_EXECUTION_BATCH_ROWS', 200),
    'execution_lease_seconds' => (int) env('AI_ACTIONS_EXECUTION_LEASE_SECONDS', 120),
    'preview_page_size' => (int) env('AI_ACTIONS_PREVIEW_PAGE_SIZE', 100),
    // AI-ACTIONS-06: images are staged synchronously (validated, thumbnailed, stored privately) before
    // a preview can name them, so both the archive size and the remote fetches per preview are bounded.
    'max_archive_images' => (int) env('AI_ACTIONS_MAX_ARCHIVE_IMAGES', 200),
    'max_remote_images_per_preview' => (int) env('AI_ACTIONS_MAX_REMOTE_IMAGES_PER_PREVIEW', 20),
    'image_thumbnail_px' => 256,
    // AI-ACTIONS-07: how long the private staged images (the bytes a preview named) are kept, by what became of the
    // action. Days are floored in code (`AiActionStagingRetention`) and a value that is not a whole number falls
    // back to its default, so a mistyped setting can neither purge too early nor keep forever.
    'staging_retention' => [
        'draft_days' => env('AI_ACTIONS_STAGING_DRAFT_DAYS'),         // idle draft; default = draft_retention_days (30)
        'cancelled_days' => env('AI_ACTIONS_STAGING_CANCELLED_DAYS'), // after cancelling; default 1
        'executed_days' => env('AI_ACTIONS_STAGING_EXECUTED_DAYS'),   // after a fully successful run; default 7
        'repairable_days' => env('AI_ACTIONS_STAGING_REPAIRABLE_DAYS'), // after a run with failures (repair window); default 30
    ],
    'draft_retention_days' => (int) env('AI_ACTIONS_DRAFT_RETENTION_DAYS', 30),
];
