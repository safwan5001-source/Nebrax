<?php

return [
    /*
     | AD-12 (S02): سقف حجم مخطط تجربة صانع التطبيقات (JSON، بايت) عند الحفظ والنشر. قيمة تقنية لحماية الخادم
     | والجهاز، لا سياسة عمل؛ تجاوزه 422 `schema_too_large` بلا كتابة.
     */
    'max_schema_bytes' => (int) env('APP_BUILDER_MAX_SCHEMA_BYTES', 262144),
];
