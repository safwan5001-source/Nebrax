<?php

return [
    'storage' => [
        // التخزين الدائم (S3/R2) مؤجل حالياً. عند false يبقى كل ما يمر عبر
        // DocumentStorageService على القرص المحلي حتى لو وُجد إعداد تكامل محفوظ.
        'persistent_enabled' => filter_var(env('DOCUMENT_DURABLE_STORAGE_ENABLED', false), FILTER_VALIDATE_BOOL),
        'profile' => 'platform',
        'driver' => env('DOCUMENT_STORAGE_DRIVER', 'local'),
        'disk' => env('DOCUMENT_STORAGE_DISK', 'local'),
        'key' => env('DOCUMENT_STORAGE_KEY'),
        'secret' => env('DOCUMENT_STORAGE_SECRET'),
        'region' => env('DOCUMENT_STORAGE_REGION', 'auto'),
        'bucket' => env('DOCUMENT_STORAGE_BUCKET'),
        'endpoint' => env('DOCUMENT_STORAGE_ENDPOINT'),
        'url' => env('DOCUMENT_STORAGE_URL'),
        'use_path_style_endpoint' => filter_var(env('DOCUMENT_STORAGE_PATH_STYLE', true), FILTER_VALIDATE_BOOL),
    ],

    'ai' => [
        // Fail closed by default. External provider traffic is enabled only by an explicit
        // backend environment flag; provider-level settings still apply independently.
        'provider_network_enabled' => filter_var(env('DOCUMENT_AI_PROVIDER_NETWORK_ENABLED', false), FILTER_VALIDATE_BOOL),
    ],

    'processing' => [
        // حد مستقل لعدد دورات إعادة المحاولة اليدوية المقبولة لكل document_processing_run —
        // لا علاقة له بميزانية محاولات المزوّد داخل الدورة الواحدة (providers.*.max_attempts
        // أو document_processing.max_attempts). يُشتقّ من عدّ أحداث retry_queued الدائمة في
        // document_governance_events، فلا حاجة لعمود/جدول إضافي. افتراض متحفّظ يحمي من
        // استنزاف المزوّد الخارجي دون تجميد المستأجر عند عطل مؤقت قصير.
        'manual_retry_max_cycles' => (int) env('DOCUMENT_MANUAL_RETRY_MAX_CYCLES', 3),
    ],

    'intake' => [
        'max_file_kilobytes' => (int) env('DOCUMENT_MAX_FILE_KB', 20480),
        'max_files_per_batch' => (int) env('DOCUMENT_MAX_FILES_PER_BATCH', 10),
        'max_pdf_pages' => (int) env('DOCUMENT_MAX_PDF_PAGES', 50),
        'max_image_dimension' => (int) env('DOCUMENT_MAX_IMAGE_DIMENSION', 12000),
        'max_image_pixels' => (int) env('DOCUMENT_MAX_IMAGE_PIXELS', 80000000),
        'retention_days' => (int) env('DOCUMENT_RETENTION_DAYS', 365),
        'download_url_minutes' => (int) env('DOCUMENT_DOWNLOAD_URL_MINUTES', 5),
        'pdfinfo_binary' => env('DOCUMENT_PDFINFO_BINARY', 'pdfinfo'),
    ],
];
