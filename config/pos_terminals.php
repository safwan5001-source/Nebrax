<?php

/**
 * PAY-H6-02 — مهل أجهزة دفع POS (قيم أمان تشغيلية؛ الافتراضيات محافظة). لا سياسة محاسبية هنا.
 */
return [
    // موافقة جهاز لم يستهلكها بيع خلال هذه المدة تُلغى آلياً على الجهاز (لا موافقة يتيمة).
    'approval_ttl_minutes' => (int) env('POS_TERMINAL_APPROVAL_TTL_MINUTES', 10),

    // طلب لم يصل إلى حالة نهائية خلال هذه المدة يُستعلَم عنه ثم يُلغى (انتهاء).
    'pending_expire_minutes' => (int) env('POS_TERMINAL_PENDING_EXPIRE_MINUTES', 15),

    // أقصى مدة لنداء واحد إلى المزوّد (يلتزم بها كل محوّل حقيقي). الإيجار يُفرَض ≥ ثلاثة أضعافها فلا تتراكب عمليتان على طلب واحد في الحالة الطبيعية.
    'provider_timeout_seconds' => (int) env('POS_TERMINAL_PROVIDER_TIMEOUT_SECONDS', 20),

    // إيجار الإلغاء/التعويض: يمنع مُعوِّضين متزامنين، وينتهي تلقائياً بعد انهيار العامل.
    'compensation_lease_seconds' => (int) env('POS_TERMINAL_COMPENSATION_LEASE_SECONDS', 90),
];
