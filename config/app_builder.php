<?php

return [
    /*
     | AD-12 (S02): سقف حجم مخطط تجربة صانع التطبيقات (JSON، بايت) عند الحفظ والنشر. قيمة تقنية لحماية الخادم
     | والجهاز، لا سياسة عمل؛ تجاوزه 422 `schema_too_large` بلا كتابة.
     */
    'max_schema_bytes' => (int) env('APP_BUILDER_MAX_SCHEMA_BYTES', 262144),

    /*
     | AD-02 (S05b): أقصى عدد نسخ منشورة حديثة يفحصها `GET commerce/v1/experience` بحثاً عن الأعلى المتوافقة مع جيل الجهاز.
     | حدّ كلفة تقني لا سياسة عمل؛ تجاوزه دون إيجاد متوافقة ⇒ 404 (الجهاز يعود للتجربة الافتراضية).
     */
    'runtime_selection_scan_limit' => (int) env('APP_BUILDER_RUNTIME_SELECTION_SCAN_LIMIT', 100),

    /* AD-05 (S20a): سقف بيانات المحرر (`editor_meta`، JSON بايت) عند الحفظ. */
    'max_editor_meta_bytes' => (int) env('APP_BUILDER_MAX_EDITOR_META_BYTES', 65536),
];
