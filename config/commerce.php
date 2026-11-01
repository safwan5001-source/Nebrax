<?php

return [

    /*
    |--------------------------------------------------------------------------
    | إلغاء طلب المتجر بواسطة الموظف — COMMERCE-ORDERS-O3a-2b (ADR-28 D-9-G1)
    |--------------------------------------------------------------------------
    |
    | مغلق افتراضياً: المسار POST commerce/orders/{id}/cancel يردّ 404 ولا يتغيّر مسار إلغاء نية الدفع القديم
    | (payment-intents/{id}/cancel) حرفياً. لا يُفتح إلا بقرار تفعيل منسَّق مستقل بعد اعتماد عقد الجمهور (ADR-28 §5.2).
    |
    */
    'order_cancellation_enabled' => (bool) env('COMMERCE_ORDER_CANCELLATION_ENABLED', false),

    /*
    |--------------------------------------------------------------------------
    | هوية مشتري الجملة وعضويته — H6 Batch E (D-1/D-2 المعتمدان)
    |--------------------------------------------------------------------------
    |
    | مغلق افتراضياً: مسارات store/v1 (auth/*, me, wholesale/*) ومسارات اعتماد الموظف commerce/wholesale/*
    | تردّ 404 موحَّداً. حتى مفتوحاً، لا تعمل إلا على قناة web موسومة `wholesale_membership_enabled`
    | (لا مسار HTTP يضبطها في هذه الدفعة)، فلا يتأثر أي متجر DTC. لا يُفتح قبل قرار تفعيل منسَّق مستقل.
    |
    */
    'wholesale_buyer_enabled' => (bool) env('COMMERCE_WHOLESALE_BUYER_ENABLED', false),

    /*
    |--------------------------------------------------------------------------
    | حسابات العملاء للتجزئة (B2C) — B2C-ACCOUNTS
    |--------------------------------------------------------------------------
    |
    | مغلق افتراضياً. يفتح مسارات `store/v1` لهوية المتسوّق (تسجيل/دخول/خروج/استرجاع كلمة المرور) ومسارات `account/*`
    | (الملف الشخصي، العناوين، الطلبات، الجلسات، ربط طلبات الضيف) على قناة web موسومة `customer_accounts_enabled` فقط؛
    | وإلا 404 موحَّد. لا أثر على التصفح كضيف أو السلة أو الإتمام أو الدفع. لا يُفتح عالمياً قبل قرار تفعيل منسَّق.
    |
    */
    'retail_accounts_enabled' => (bool) env('COMMERCE_RETAIL_ACCOUNTS_ENABLED', false),

    /*
    | عمر جلسة حساب المتسوّق (أيام): «تذكّرني» (الافتراضي) يعطي رمزاً دائماً عبر إعادة تشغيل المتصفح؛ بدونها يوم واحد وكوكي جلسة.
    | الرمز Sanctum قابل للإبطال (خروج/إنهاء الجلسات/تغيير كلمة المرور/إعادة تعيينها).
    */
    'account_session_days' => (int) env('COMMERCE_ACCOUNT_SESSION_DAYS', 30),
    'account_session_days_short' => 1,

    /*
    | H6 Batch H — buyer e-mail verification link lifetime (minutes) and the minimum gap between two verification
    | e-mails to the same identity (seconds; a request inside the gap is silently skipped — mail-bombing guard).
    */
    'buyer_verification_ttl_minutes' => (int) env('COMMERCE_BUYER_VERIFICATION_TTL_MINUTES', 1440),
    'buyer_verification_resend_gap_seconds' => (int) env('COMMERCE_BUYER_VERIFICATION_RESEND_GAP_SECONDS', 60),
    // H6 Batch M — buyer password reset: link lifetime (shorter than verification: it grants account takeover) and the per-account gap between mails.
    'buyer_password_reset_ttl_minutes' => (int) env('COMMERCE_BUYER_PASSWORD_RESET_TTL_MINUTES', 60),
    'buyer_password_reset_resend_gap_seconds' => (int) env('COMMERCE_BUYER_PASSWORD_RESET_RESEND_GAP_SECONDS', 60),

];
