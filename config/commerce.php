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
    | القبول اليدوي لطلبات المتجر — COPS-H1-3 / H1-4 (ADR-29 §2.2، R-6b)
    |--------------------------------------------------------------------------
    |
    | مغلق افتراضياً. H1-3 يحرس به **إعداد** وضع القبول فقط: ما دام مغلقاً يردّ `PUT commerce/channels/{id}/operations-settings` بـ409 على محاولة ضبط
    | `acceptance_mode = manual`، ويعلن `GET` الوضع الفعّال `auto` مهما خُزِّن. لا يوجد في H1-3 أي إنفاذ (قبول/رفض يأتيان في H1-4 خلف البوابة نفسها).
    | لا يُفتح إلا بقرار تفعيل منسَّق مستقل يشمل بوابة الإلغاء (الرفض = إلغاء، ADR-29 §2.2).
    |
    */
    'order_acceptance_enabled' => (bool) env('COMMERCE_ORDER_ACCEPTANCE_ENABLED', false),

    /*
    |--------------------------------------------------------------------------
    | تنفيذ طلبات المتجر — COPS-H2-1 (خطة H2-0، D-H2-21)
    |--------------------------------------------------------------------------
    |
    | مغلقة افتراضياً: مغلقة ⇒ مسارات الكتابة 404 ولا `fulfillment_actions`. **لا تُخفي** حقائق تنفيذ مخزَّنة (قراءة الموظف، مرشّح القائمة، قيد الإلغاء
    | وحراس القاعدة تعمل دائماً — AR-3). لا تُفتح لمستأجر قبل قرار تفعيل منسَّق يشمل بوابة الإلغاء (D-H2-06).
    |
    */
    'order_fulfillment_enabled' => (bool) env('COMMERCE_ORDER_FULFILLMENT_ENABLED', false),

    /*
    |--------------------------------------------------------------------------
    | تتبّع الضيف الموقَّع لطلب المتجر — COPS-H2-5 (خطة H2-0، D-H2-15/16/17)
    |--------------------------------------------------------------------------
    |
    | مغلق افتراضياً: مغلقاً ⇒ `POST store/v1/orders/{order}/tracking-link` و`GET store/v1/order-tracking/{token}` 404 موحَّد.
    | الرمز `trk1` عديم الحالة (HMAC بمفتاح مشتق لغرضه) منفصل الغرض عن مرجع الطلب `v1`: لا يخوّل دفعاً ولا قراءة كاملة، والمرجع لا يخوّل التتبع.
    | الصلاحية `confirmed_at + ttl_days` (حتمي)؛ التدوير بتغيير المفتاح (`COMMERCE_TRACKING_KEY`) يبطل كل الرموز. لا إبطال لكل طلب في V1.
    |
    */
    'guest_order_tracking_enabled' => (bool) env('COMMERCE_GUEST_ORDER_TRACKING_ENABLED', false),
    'guest_tracking_ttl_days' => (int) env('COMMERCE_GUEST_TRACKING_TTL_DAYS', 90),
    'tracking_key' => env('COMMERCE_TRACKING_KEY'),

    /*
    |--------------------------------------------------------------------------
    | تنبيه التاجر بطلبات المتجر — COPS-H3 (ADR-30)
    |--------------------------------------------------------------------------
    |
    | مغلقة افتراضياً: مغلقة ⇒ لا مُنتِج إشعارات للطلبات (H3-1)، و`GET commerce/alerts/config` يعلن `enabled=false` فلا يبدأ مركز التنبيه استطلاعاً (H3-3)،
    | ومسار الإقرار 404 (H3-4). القراءات الإضافية (`head_seq`، ETag الانتباه) لا تتغير بها. لا تُفتح لمستأجر حي قبل قرار تفعيل منسَّق منفصل
    | (اختبار أجهزة فعلي + موافقة صريحة). فتحها لا يمنح أي صلاحية: المستلمون حاملو `commerce.orders.view` فعلاً (R-8).
    |
    */
    'order_alerts_enabled' => (bool) env('COMMERCE_ORDER_ALERTS_ENABLED', false),

    /*
    | وتيرة استطلاع مركز التنبيه (COPS-H3-3، يعلنها الخادم عبر `GET commerce/alerts/config` فيمكن ضبطها/إيقافها دون نشر واجهة). القيم بالمللي ثانية:
    | `feed_ms` استطلاع التغذية (مؤشّر تغيّر رخيص مع ETag/304) في الوضع المدعوم؛ `attention_ms` مصالحة الحالة؛ `attention_only_ms` للمقيَّد بمخازن (لا تغذية له).
    | الهدف الداخلي ≤ 15ث p95 (ADR-30 §0 R-11): 10ث + زمن الطلب + مهلة. القيم تُقيَّد في المتحكّم (feed ≥ 5000، attention ≥ 15000، attention_only ≥ 10000).
    */
    'order_alerts_polling' => [
        'feed_ms' => (int) env('COMMERCE_ORDER_ALERTS_FEED_MS', 10_000),
        'attention_ms' => (int) env('COMMERCE_ORDER_ALERTS_ATTENTION_MS', 60_000),
        'attention_only_ms' => (int) env('COMMERCE_ORDER_ALERTS_ATTENTION_ONLY_MS', 15_000),
    ],

    /*
    |--------------------------------------------------------------------------
    | نافذة حداثة مصالحة الانتباه — COPS-H1-2 (ADR-29 §2.4)
    |--------------------------------------------------------------------------
    |
    | GET commerce/orders/attention لا يعيد إلا طلبات أُنشئت ضمن هذه المدة (بالساعات، 1..720). الافتراضي 48 ≥ ضعف أقصى مهلة حجز دفع
    | إلكتروني (24 ساعة) كي لا يختفي طلب دُفع قرب نهاية مهلته. قراءة فقط؛ لا تغيّر أي سلوك قائم.
    |
    */
    'attention_window_hours' => (int) env('COMMERCE_ATTENTION_WINDOW_HOURS', 48),

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
