<?php

/**
 * PAY-H6-02 — مهل أجهزة دفع POS (قيم أمان تشغيلية؛ الافتراضيات محافظة). لا سياسة محاسبية هنا.
 */
return [
    // موافقة جهاز لم يستهلكها بيع خلال هذه المدة تُلغى آلياً على الجهاز (لا موافقة يتيمة).
    'approval_ttl_minutes' => (int) env('POS_TERMINAL_APPROVAL_TTL_MINUTES', 10),

    // طلب لم يصل إلى حالة نهائية خلال هذه المدة يُستعلَم عنه ثم يُلغى (انتهاء).
    'pending_expire_minutes' => (int) env('POS_TERMINAL_PENDING_EXPIRE_MINUTES', 15),

    // إيجار الإلغاء/التعويض: يمنع مُعوِّضين متزامنين، وينتهي تلقائياً بعد انهيار العامل.
    'compensation_lease_seconds' => (int) env('POS_TERMINAL_COMPENSATION_LEASE_SECONDS', 90),
];
