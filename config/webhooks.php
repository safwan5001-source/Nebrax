<?php

/**
 * سياسات الـ Webhooks الصادرة (PR-7) — مركزيّة وقابلة للضبط عبر البيئة، بافتراضات
 * إنتاجيّة آمنة. لا تجمّد قيمًا تشغيليّة في عقد الـ API العام؛ هذه تشغيليّة بحتة.
 */
return [
    // HTTPS إلزاميّ افتراضيًا. يُفعَّل http فقط في بيئة محليّة/اختبارية واعية.
    'allow_insecure_url' => (bool) env('WEBHOOKS_ALLOW_INSECURE_URL', false),

    // حدّ اشتراكات الـ Webhook لكل مستأجر (يمنع الإساءة/التضخّم).
    'max_endpoints_per_tenant' => (int) env('WEBHOOKS_MAX_ENDPOINTS_PER_TENANT', 20),

    'delivery' => [
        'connect_timeout'        => (int) env('WEBHOOKS_CONNECT_TIMEOUT', 5),   // ثوانٍ
        'timeout'                => (int) env('WEBHOOKS_TIMEOUT', 10),          // إجماليّ ثوانٍ
        'max_attempts'           => (int) env('WEBHOOKS_MAX_ATTEMPTS', 6),
        'lease_seconds'          => (int) env('WEBHOOKS_LEASE_SECONDS', 120),   // إيجار المعالجة
        'batch_size'             => (int) env('WEBHOOKS_BATCH_SIZE', 50),
        'response_snippet_bytes' => (int) env('WEBHOOKS_RESPONSE_SNIPPET_BYTES', 2048),
        'user_agent'             => env('WEBHOOKS_USER_AGENT', 'AWJ-Webhooks/1.0'),

        // تأخير تصاعديّ حتميّ بين المحاولات (ثوانٍ) بعد المحاولة رقم 1..N.
        // المحاولة الأولى فوريّة؛ بعد كلّ فشل يُجدوَل التالي بهذه المدد، حتى النفاد.
        'backoff_seconds' => [60, 300, 1800, 7200, 21600], // 1m · 5m · 30m · 2h · 6h
    ],

    'retention' => [
        // احتفاظ حتميّ (بالأيام) قبل التقليم عبر أمر Artisan.
        'delivered_days' => (int) env('WEBHOOKS_RETENTION_DELIVERED_DAYS', 30),
        'terminal_days'  => (int) env('WEBHOOKS_RETENTION_TERMINAL_DAYS', 30),
    ],
];
