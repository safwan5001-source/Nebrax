<?php

// إعداد CORS لنبراس — الواجهة تنادي الـ API عبر Bearer token (بلا كوكيز).
// النطاقات المسموح بها تُضبط عبر متغيّر البيئة FRONTEND_URL (يفصل بينها بفواصل)،
// وإلا يُسمح بكل النطاقات (آمن مع مصادقة الرمز، لا اعتماد على الكوكيز).
$origins = array_filter(array_map('trim', explode(',', (string) env('FRONTEND_URL', ''))));

return [
    'paths' => ['api/*', 'sanctum/csrf-cookie'],
    'allowed_methods' => ['*'],
    'allowed_origins' => $origins ?: ['*'],
    'allowed_origins_patterns' => [],
    'allowed_headers' => ['*'],
    'exposed_headers' => [],
    'max_age' => 0,
    'supports_credentials' => false,
];
