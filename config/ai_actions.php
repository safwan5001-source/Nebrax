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
    'draft_retention_days' => (int) env('AI_ACTIONS_DRAFT_RETENTION_DAYS', 30),
];
