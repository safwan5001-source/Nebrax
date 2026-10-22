<?php

return [
    // مدة الاحتفاظ بتشغيلات الاستيراد المنتهية (ملغاة/فاشلة) قبل التقليم
    // (`imports:prune`). لا يمسّ تشغيلات مرفوعة/جاهزة مهما تقادمت.
    'retention_days' => (int) env('IMPORTS_RETENTION_DAYS', 14),

    // صلاحية معاينة الاستيراد أحادية الاستعمال (IMP-H1-S3b) قبل أن تُنفَق بإنشاء تشغيلة تنفيذية.
    // لحظة بدء إلزام المعاينة لإنشاء التشغيلات التنفيذية (ISO-8601) — `null` = غير ملزمة بعد. تُضبط في شريحة التفعيل بتعديل كود.
    'preview_required_from' => null,

    'preview_ttl_minutes' => (int) env('IMPORTS_PREVIEW_TTL_MINUTES', 60),

    // ═══════════════════════════════════════════════════════════════
    //  تخزين ملفات الاستيراد الدائم — عقدٌ محايدٌ عن السائق، مستقلٌّ عن
    //  Document Center تماماً (لا اعتماد على `PlatformIntegrationResolver`
    //  ولا أي منطق مجاله). التبديل بين local وS3/R2 تغييرُ إعدادٍ فقط؛
    //  `App\Services\ImportJobFileStorage` لا يتغيّر ولا خدمة/متحكّم آخر.
    //
    //  ⚠️ **`local` ليس ديمومة إنتاجية.** قرص حاوية الخادم (Render/Railway
    //  اليوم) **مؤقت** — يُفقَد عند إعادة البناء أو استبدال الحاوية أو
    //  إعادة التشغيل، وهذا سلوكٌ فعليٌّ لا افتراضي. `local` هو الافتراضي
    //  هنا لأنه يطابق وضع كل مسار رفع ملفات آخر في هذا النظام اليوم (راجع
    //  `deploy/DEPLOY.md`: «مخاطرة مؤقتة مقبولة خلال مرحلة التطوير») — لا
    //  قرار جديد، بل استمرارٌ للوضع القائم. **لا يجوز لأي وحدة لاحقة في
    //  برنامج Durable Imports أن تفترض ديمومة عبر عمليات نشر متتالية طالما
    //  الإعداد هنا `local`.** الديمومة الفعلية تتطلّب `driver=s3` مع مزوّد
    //  تخزين كائنات حقيقي (S3 أو أي مزوّد متوافق كـCloudflare R2، عبر
    //  `endpoint`/`use_path_style_endpoint`) — وتوفير الحساب/الدلو (bucket)/
    //  بيانات الاعتماد قرارٌ تشغيليٌّ (سعة/تكلفة) يخصّ صفوان، لا يُنشئه ولا
    //  يُفعّله هذا الملف أو أي كود في هذا الـPR تلقائياً.
    'storage' => [
        'driver' => env('IMPORTS_STORAGE_DRIVER', 'local'),
        'key' => env('IMPORTS_STORAGE_KEY'),
        'secret' => env('IMPORTS_STORAGE_SECRET'),
        'region' => env('IMPORTS_STORAGE_REGION', 'auto'),
        'bucket' => env('IMPORTS_STORAGE_BUCKET'),
        'endpoint' => env('IMPORTS_STORAGE_ENDPOINT'),
        'url' => env('IMPORTS_STORAGE_URL'),
        'use_path_style_endpoint' => filter_var(env('IMPORTS_STORAGE_PATH_STYLE', true), FILTER_VALIDATE_BOOL),
    ],
];
