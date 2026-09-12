<?php

// إعداد CORS لنبراس — الواجهة تنادي الـ API عبر Bearer token (بلا كوكيز).
// النطاقات المسموح بها تُضبط عبر متغيّر البيئة FRONTEND_URL (يفصل بينها بفواصل)،
// وإلا يُسمح بكل النطاقات (آمن مع مصادقة الرمز، لا اعتماد على الكوكيز).
//
// نطاقات المستأجر الفرعية `{slug}.{base}` تُسمح بنمط مستقل حتى لا نوسّع
// الكوكي إلى `.awj.app` ولا ندرج كل مستأجر يدوياً في FRONTEND_URL.
$origins = array_filter(array_map('trim', explode(',', (string) env('FRONTEND_URL', ''))));

$baseDomains = array_filter(array_map(
    static fn (string $domain): string => mb_strtolower(trim($domain)),
    explode(',', (string) (
        env('AWJ_TENANT_BASE_DOMAINS') !== null && env('AWJ_TENANT_BASE_DOMAINS') !== ''
            ? env('AWJ_TENANT_BASE_DOMAINS')
            : env('AWJ_TENANT_BASE_DOMAIN', 'awj.app')
    )),
));
if ($baseDomains === []) {
    $baseDomains = ['awj.app'];
}

$originPatterns = [];
foreach ($baseDomains as $domain) {
    if ($domain === '') {
        continue;
    }
    $quoted = preg_quote($domain, '/');
    $originPatterns[] = '^https?://[a-z0-9-]+\\.'.$quoted.'(?::\\d+)?$';
}

return [
    'paths' => ['api/*', 'sanctum/csrf-cookie'],
    'allowed_methods' => ['*'],
    'allowed_origins' => $origins ?: ['*'],
    'allowed_origins_patterns' => $originPatterns,
    'allowed_headers' => ['*'],
    'exposed_headers' => [],
    'max_age' => 0,
    'supports_credentials' => false,
];
