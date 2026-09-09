<?php

return [
    // مدة الاحتفاظ بتشغيلات الاستيراد المنتهية (ملغاة/فاشلة) قبل التقليم
    // (`imports:prune`). لا يمسّ تشغيلات مرفوعة/جاهزة مهما تقادمت.
    'retention_days' => (int) env('IMPORTS_RETENTION_DAYS', 14),
];
