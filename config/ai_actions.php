<?php

return [
    // AI-ACTIONS-01: the action surface ships dark. Enabling the read/write
    // draft workflow still does not enable ERP execution or a paid provider.
    'enabled' => filter_var(env('AI_ACTIONS_ENABLED', false), FILTER_VALIDATE_BOOLEAN),
    'max_product_rows' => (int) env('AI_ACTIONS_MAX_PRODUCT_ROWS', 2000),
    'max_proposal_bytes' => (int) env('AI_ACTIONS_MAX_PROPOSAL_BYTES', 5 * 1024 * 1024),
    'draft_retention_days' => (int) env('AI_ACTIONS_DRAFT_RETENTION_DAYS', 30),
];
