<?php

return [
    // Remote image ingestion is operationally separate from parsing local ZIPs
    // and ships off. When enabled, URLs still pass public-IP validation, HTTPS,
    // no-redirect, timeout, byte, MIME, pixel and content checks.
    'remote_enabled' => filter_var(env('PRODUCT_IMPORT_REMOTE_IMAGES_ENABLED', false), FILTER_VALIDATE_BOOLEAN),
    'max_archive_bytes' => 50 * 1024 * 1024,
    'max_archive_entries' => 1000,
    'max_archive_uncompressed_bytes' => 100 * 1024 * 1024,
    'max_compression_ratio' => 100,
];
