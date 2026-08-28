<?php

namespace App\Services\Pos;

use App\Models\PosSessionEvent;

/**
 * مصدر الحقيقة الوحيد لكتالوج قواعد الكشف الرقابي (Phase 2).
 *
 * كل قاعدة تُعرَّف تعريفاً **تصريحياً حتمياً**: مصدر البسط، ومقام التطبيع، ومعامل
 * التطبيع (per)، وثقة الدليل، ومصدر المبلغ قيد المراجعة، والموضوع (مستخدم/زوج/
 * معتمِد)، وأسلوب المقارنة (أساس ديناميكي أم عتبة ثابتة). النوافذ والأوزان والحد
 * الأدنى للعينة والعتبات تعيش هنا وحدها — لا أرقام سحرية متناثرة. المستأجر يضبط
 * صفّه في `pos_exception_rules`، وتبقى هذه الافتراضات الحامية أساس الزرع والسقوط.
 */
final class PosExceptionRuleCatalog
{
    // الفئات (تطابق المهمة: A..G).
    public const CATEGORY_CART = 'cart';
    public const CATEGORY_PAYMENT = 'payment';
    public const CATEGORY_CASH = 'cash';
    public const CATEGORY_RETURNS = 'returns';
    public const CATEGORY_APPROVAL = 'approval';
    public const CATEGORY_TIMING = 'timing';

    // ثقة الدليل — مشتقّة من نموذج Phase 1.
    public const CONFIDENCE_SERVER = 'server_authoritative';
    public const CONFIDENCE_CLIENT = 'client_observed';

    // أسلوب المقارنة.
    public const COMPARE_BASELINE = 'baseline';   // نسبة إلى خط الأساس (self→peer→static)
    public const COMPARE_STATIC = 'static';       // نسبة إلى عتبة مطلقة/مئوية ثابتة

    // نوع الموضوع.
    public const SUBJECT_USER = 'user';           // منفّذ العملية
    public const SUBJECT_PAIR = 'pair';           // زوج منفّذ↔معتمِد
    public const SUBJECT_APPROVER = 'approver';   // المعتمِد

    // مقام التطبيع.
    public const DENOM_ITEMS_ADDED = 'items_added';
    public const DENOM_CARTS = 'carts';
    public const DENOM_CHECKOUTS_STARTED = 'checkouts_started';
    public const DENOM_CHECKOUTS_COMPLETED = 'checkouts_completed';
    public const DENOM_SESSIONS = 'sessions';
    public const DENOM_WORKED_SECONDS = 'worked_seconds';
    public const DENOM_SALES_AMOUNT = 'sales_amount';
    public const DENOM_SENSITIVE_OPS = 'sensitive_ops';
    public const DENOM_APPROVALS_FOR_PERFORMER = 'approvals_for_performer';
    public const DENOM_APPROVALS_IN_BRANCH = 'approvals_in_branch';
    public const DENOM_OVERRIDE_REQUESTS = 'override_requests';

    // ═══ ثوابت الدرجة والنطاقات (مصدر واحد) ═══
    /** أسقف الفئة تمنع فئة واحدة (عدة قواعد متشابهة) من تفجير الدرجة. */
    public const CATEGORY_SCORE_CAP = 30;
    public const TOTAL_SCORE_CAP = 100;
    /** نصيب الشدّة من وزن القاعدة (نقطة مئوية ×100). */
    public const SEVERITY_FACTOR = ['watch' => 40, 'review' => 70, 'priority' => 100];
    /** حدود النطاق من الدرجة الكلية. */
    public const BAND_THRESHOLDS = ['watch' => 25, 'review' => 50, 'priority' => 75];
    /** عتبة نسبة التجاوز التي ترفع الشدّة (نسبة ×100 من خط الأساس). */
    public const SEVERITY_RATIO = ['review' => 200, 'priority' => 300];
    /** للقواعد الثابتة: نسبة التجاوز فوق العتبة (٪) التي ترفع الشدّة. */
    public const STATIC_SEVERITY_OVER = ['review' => 25, 'priority' => 50];
    /** الحد الأدنى لعدد النظراء ذوي العينة الكافية لاعتماد خط أساس النظراء. */
    public const MIN_PEERS = 3;
    /** كل المقاييس المطبّعة تُخزَّن بمقياس القيمة ×1000 (milli) لتفادي float. */
    public const RATE_SCALE = 1000;

    /**
     * خط الأساس الثابت الاحتياطي لكل قاعدة أساس (بمقياس القيمة ×1000) — يُستعمل
     * فقط حين لا يتوفر أساس شخصي ولا أساس نظراء بعينة كافية. يمنع معاقبة كاشير
     * جديد/قليل الحجم، ويبقى نقطة سقوط مفسَّرة صراحةً. مصدر واحد لا أرقام متناثرة.
     */
    public const STATIC_FALLBACK_RATE = [
        'item_removal_rate' => 15000,        // 15 إزالة لكل 100 صنف مُضاف
        'quantity_reduction_rate' => 12000,  // 12 لكل 100
        'cart_cancellation_rate' => 15000,   // 15 إلغاء لكل 100 سلة
        'price_override_rate' => 8000,        // 8 لكل 100 سلة
        'discount_activity_rate' => 25000,   // 25 لكل 100 سلة
        'payment_failure_rate' => 10000,     // 10 لكل 100 سلة
        'aborted_checkout_rate' => 15000,    // 15 لكل 100 checkout مبدوء
        'manual_drawer_open_rate' => 6000,   // 6 فتحات لكل ساعة
        'cash_movement_frequency' => 3000,   // 3 حركات لكل جلسة
        'closing_variance_frequency' => 30000, // 30 لكل 100 جلسة
        'recount_usage_rate' => 20000,       // 20 لكل 100 جلسة
        'variance_settlement_frequency' => 20000,
        'refund_frequency' => 10000,         // 10 لكل 100 عملية مكتملة
        'refund_amount_rate' => 50000,       // 50 مبلغ مرتجع لكل 1000 مبيعات (٥٪)
    ];

    /**
     * @return array<string, array<string, mixed>> الكتالوج الكامل مفهرساً بالمفتاح.
     */
    public static function rules(): array
    {
        return [
            // ═══ A. تلاعب السلة/الأصناف (رصد عميلي ثانوي موسوم) ═══
            'item_removal_rate' => [
                'category' => self::CATEGORY_CART,
                'weight' => 12, 'min_sample' => 20, 'window_days' => 30, 'threshold' => 150,
                'compare' => self::COMPARE_BASELINE, 'subject' => self::SUBJECT_USER,
                'numerator_types' => [PosSessionEvent::TYPE_ITEM_REMOVED],
                'denominator' => self::DENOM_ITEMS_ADDED, 'per' => 100,
                'confidence' => self::CONFIDENCE_CLIENT, 'amount' => false,
            ],
            'quantity_reduction_rate' => [
                'category' => self::CATEGORY_CART,
                'weight' => 8, 'min_sample' => 20, 'window_days' => 30, 'threshold' => 150,
                'compare' => self::COMPARE_BASELINE, 'subject' => self::SUBJECT_USER,
                'numerator_types' => [PosSessionEvent::TYPE_ITEM_QUANTITY_CHANGED],
                'denominator' => self::DENOM_ITEMS_ADDED, 'per' => 100,
                'confidence' => self::CONFIDENCE_CLIENT, 'amount' => false,
            ],
            'cart_cancellation_rate' => [
                'category' => self::CATEGORY_CART,
                'weight' => 12, 'min_sample' => 10, 'window_days' => 30, 'threshold' => 150,
                'compare' => self::COMPARE_BASELINE, 'subject' => self::SUBJECT_USER,
                'numerator_types' => [PosSessionEvent::TYPE_CART_CANCELLED, PosSessionEvent::TYPE_CART_DISCARDED],
                'denominator' => self::DENOM_CARTS, 'per' => 100,
                'confidence' => self::CONFIDENCE_CLIENT, 'amount' => false,
            ],
            'price_override_rate' => [
                'category' => self::CATEGORY_CART,
                'weight' => 15, 'min_sample' => 10, 'window_days' => 30, 'threshold' => 150,
                'compare' => self::COMPARE_BASELINE, 'subject' => self::SUBJECT_USER,
                'numerator_types' => [PosSessionEvent::TYPE_PRICE_OVERRIDDEN],
                'denominator' => self::DENOM_CARTS, 'per' => 100,
                'confidence' => self::CONFIDENCE_CLIENT, 'amount' => false,
            ],
            'discount_activity_rate' => [
                'category' => self::CATEGORY_CART,
                'weight' => 10, 'min_sample' => 10, 'window_days' => 30, 'threshold' => 150,
                'compare' => self::COMPARE_BASELINE, 'subject' => self::SUBJECT_USER,
                'numerator_types' => [PosSessionEvent::TYPE_DISCOUNT_APPLIED, PosSessionEvent::TYPE_DISCOUNT_CHANGED, PosSessionEvent::TYPE_DISCOUNT_REMOVED],
                'denominator' => self::DENOM_CARTS, 'per' => 100,
                'confidence' => self::CONFIDENCE_CLIENT, 'amount' => false,
            ],

            // ═══ B. الدفع/الإتمام ═══
            'payment_failure_rate' => [
                'category' => self::CATEGORY_PAYMENT,
                'weight' => 12, 'min_sample' => 10, 'window_days' => 30, 'threshold' => 150,
                'compare' => self::COMPARE_BASELINE, 'subject' => self::SUBJECT_USER,
                'numerator_types' => [PosSessionEvent::TYPE_PAYMENT_FAILED, PosSessionEvent::TYPE_PAYMENT_CANCELLED],
                'denominator' => self::DENOM_CARTS, 'per' => 100,
                // يخلط دليلاً خادمياً (فشل) وعميلياً (إلغاء واجهة) → يوسم عميلياً.
                'confidence' => self::CONFIDENCE_CLIENT, 'amount' => false,
            ],
            'aborted_checkout_rate' => [
                'category' => self::CATEGORY_PAYMENT,
                'weight' => 10, 'min_sample' => 10, 'window_days' => 30, 'threshold' => 150,
                'compare' => self::COMPARE_BASELINE, 'subject' => self::SUBJECT_USER,
                // البسط مشتقّ: checkout_started دون checkout_completed مطابق للسلة.
                'numerator_types' => ['@aborted_checkouts'],
                'denominator' => self::DENOM_CHECKOUTS_STARTED, 'per' => 100,
                'confidence' => self::CONFIDENCE_SERVER, 'amount' => false,
            ],

            // ═══ C. الدرج/الجلسة ═══
            'manual_drawer_open_rate' => [
                'category' => self::CATEGORY_CASH,
                'weight' => 10, 'min_sample' => 14400, 'window_days' => 30, 'threshold' => 150,
                'compare' => self::COMPARE_BASELINE, 'subject' => self::SUBJECT_USER,
                'numerator_types' => [PosSessionEvent::TYPE_CASH_DRAWER_OPEN_ATTEMPT],
                'denominator' => self::DENOM_WORKED_SECONDS, 'per' => 3600, // فتحات لكل ساعة عمل
                'confidence' => self::CONFIDENCE_SERVER, 'amount' => false,
            ],
            'cash_movement_frequency' => [
                'category' => self::CATEGORY_CASH,
                'weight' => 8, 'min_sample' => 5, 'window_days' => 30, 'threshold' => 150,
                'compare' => self::COMPARE_BASELINE, 'subject' => self::SUBJECT_USER,
                'numerator_types' => [PosSessionEvent::TYPE_CASH_IN_RECORDED, PosSessionEvent::TYPE_CASH_OUT_RECORDED],
                'denominator' => self::DENOM_SESSIONS, 'per' => 1, // حركات لكل جلسة
                'confidence' => self::CONFIDENCE_SERVER, 'amount' => false,
            ],
            'closing_variance_frequency' => [
                'category' => self::CATEGORY_CASH,
                'weight' => 12, 'min_sample' => 5, 'window_days' => 60, 'threshold' => 150,
                'compare' => self::COMPARE_BASELINE, 'subject' => self::SUBJECT_USER,
                'numerator_types' => [PosSessionEvent::TYPE_CLOSING_DIFFERENCE_REQUIRES_ACKNOWLEDGEMENT],
                'denominator' => self::DENOM_SESSIONS, 'per' => 100,
                'confidence' => self::CONFIDENCE_SERVER, 'amount' => false,
            ],
            'closing_variance_magnitude' => [
                'category' => self::CATEGORY_CASH,
                'weight' => 15, 'min_sample' => 3, 'window_days' => 60, 'threshold' => 150,
                // عتبة مطلقة بالهللات: متوسط فرق الجلسة يتجاوز `config.absolute` (افتراضاً 5000 هللة = 50 ريال).
                'compare' => self::COMPARE_STATIC, 'subject' => self::SUBJECT_USER,
                'numerator_types' => [PosSessionEvent::TYPE_CLOSING_DIFFERENCE_REQUIRES_ACKNOWLEDGEMENT],
                'denominator' => self::DENOM_SESSIONS, 'per' => 1,
                'confidence' => self::CONFIDENCE_SERVER, 'amount' => true, 'amount_abs' => true,
                'config' => ['absolute' => 5000],
            ],
            'recount_usage_rate' => [
                'category' => self::CATEGORY_CASH,
                'weight' => 8, 'min_sample' => 5, 'window_days' => 60, 'threshold' => 150,
                'compare' => self::COMPARE_BASELINE, 'subject' => self::SUBJECT_USER,
                'numerator_types' => [PosSessionEvent::TYPE_CLOSING_COUNT_RECOUNTED],
                'denominator' => self::DENOM_SESSIONS, 'per' => 100,
                'confidence' => self::CONFIDENCE_SERVER, 'amount' => false,
            ],
            'variance_settlement_frequency' => [
                'category' => self::CATEGORY_CASH,
                'weight' => 8, 'min_sample' => 5, 'window_days' => 60, 'threshold' => 150,
                'compare' => self::COMPARE_BASELINE, 'subject' => self::SUBJECT_USER,
                'numerator_types' => [PosSessionEvent::TYPE_CLOSING_DIFFERENCE_SETTLED],
                'denominator' => self::DENOM_SESSIONS, 'per' => 100,
                'confidence' => self::CONFIDENCE_SERVER, 'amount' => false,
            ],

            // ═══ D. المرتجعات/الاستبدال (دليل خادمي حصراً) ═══
            'refund_frequency' => [
                'category' => self::CATEGORY_RETURNS,
                'weight' => 12, 'min_sample' => 10, 'window_days' => 30, 'threshold' => 150,
                'compare' => self::COMPARE_BASELINE, 'subject' => self::SUBJECT_USER,
                'numerator_types' => [PosSessionEvent::TYPE_RETURN_RECORDED, PosSessionEvent::TYPE_EXCHANGE_RECORDED],
                'denominator' => self::DENOM_CHECKOUTS_COMPLETED, 'per' => 100,
                'confidence' => self::CONFIDENCE_SERVER, 'amount' => false,
            ],
            'refund_amount_rate' => [
                'category' => self::CATEGORY_RETURNS,
                'weight' => 15, 'min_sample' => 100000, 'window_days' => 30, 'threshold' => 150,
                'compare' => self::COMPARE_BASELINE, 'subject' => self::SUBJECT_USER,
                'numerator_types' => [PosSessionEvent::TYPE_RETURN_RECORDED, PosSessionEvent::TYPE_EXCHANGE_RECORDED],
                'denominator' => self::DENOM_SALES_AMOUNT, 'per' => 1000, // مبلغ مرتجع لكل 1000 وحدة مبيعات
                'confidence' => self::CONFIDENCE_SERVER, 'amount' => true, 'amount_abs' => true,
                'numerator_mode' => 'amount',
            ],

            // ═══ E. الاعتماد/التجاوز (يحافظ على فصل المنفّذ عن المعتمِد) ═══
            'approval_required_rate' => [
                'category' => self::CATEGORY_APPROVAL,
                'weight' => 10, 'min_sample' => 10, 'window_days' => 30, 'threshold' => 150,
                'compare' => self::COMPARE_BASELINE, 'subject' => self::SUBJECT_USER,
                'numerator_types' => [PosSessionEvent::TYPE_OVERRIDE_REQUESTED],
                'denominator' => self::DENOM_SENSITIVE_OPS, 'per' => 100,
                'confidence' => self::CONFIDENCE_SERVER, 'amount' => false,
            ],
            'performer_approver_pair_concentration' => [
                'category' => self::CATEGORY_APPROVAL,
                'weight' => 15, 'min_sample' => 4, 'window_days' => 60, 'threshold' => 50000,
                // ثابتة: نسبة تركّز الزوج من كل اعتمادات المنفّذ تتجاوز threshold% (÷100).
                'compare' => self::COMPARE_STATIC, 'subject' => self::SUBJECT_PAIR,
                'numerator_types' => [PosSessionEvent::TYPE_OVERRIDE_APPROVED],
                'denominator' => self::DENOM_APPROVALS_FOR_PERFORMER, 'per' => 100,
                'confidence' => self::CONFIDENCE_SERVER, 'amount' => false,
            ],
            'approver_concentration' => [
                'category' => self::CATEGORY_APPROVAL,
                'weight' => 10, 'min_sample' => 5, 'window_days' => 60, 'threshold' => 60000,
                'compare' => self::COMPARE_STATIC, 'subject' => self::SUBJECT_APPROVER,
                'numerator_types' => [PosSessionEvent::TYPE_OVERRIDE_APPROVED],
                'denominator' => self::DENOM_APPROVALS_IN_BRANCH, 'per' => 100,
                'confidence' => self::CONFIDENCE_SERVER, 'amount' => false,
            ],
            'override_approval_rate' => [
                'category' => self::CATEGORY_APPROVAL,
                'weight' => 10, 'min_sample' => 5, 'window_days' => 60, 'threshold' => 90000,
                // نسبة الموافقة من الطلبات تتجاوز threshold% (اعتماد شبه تلقائي).
                'compare' => self::COMPARE_STATIC, 'subject' => self::SUBJECT_APPROVER,
                'numerator_types' => [PosSessionEvent::TYPE_OVERRIDE_APPROVED],
                'denominator' => self::DENOM_OVERRIDE_REQUESTS, 'per' => 100,
                'confidence' => self::CONFIDENCE_SERVER, 'amount' => false,
            ],

            // ═══ F. أنماط التوقيت ═══
            'near_close_concentration' => [
                'category' => self::CATEGORY_TIMING,
                'weight' => 10, 'min_sample' => 8, 'window_days' => 30, 'threshold' => 40000,
                // نسبة العمليات الحساسة في آخر `config.window_minutes` قبل الإغلاق تتجاوز threshold%.
                'compare' => self::COMPARE_STATIC, 'subject' => self::SUBJECT_USER,
                'numerator_types' => ['@near_close_sensitive'],
                'denominator' => self::DENOM_SENSITIVE_OPS, 'per' => 100,
                'confidence' => self::CONFIDENCE_CLIENT, 'amount' => false,
                'config' => ['window_minutes' => 30],
            ],
        ];
    }

    /** أنواع العمليات الحساسة التي تشكّل مقام `sensitive_ops`. */
    public static function sensitiveOpTypes(): array
    {
        return [
            PosSessionEvent::TYPE_ITEM_REMOVED,
            PosSessionEvent::TYPE_ITEM_QUANTITY_CHANGED,
            PosSessionEvent::TYPE_PRICE_OVERRIDDEN,
            PosSessionEvent::TYPE_DISCOUNT_APPLIED,
            PosSessionEvent::TYPE_DISCOUNT_CHANGED,
            PosSessionEvent::TYPE_DISCOUNT_REMOVED,
            PosSessionEvent::TYPE_CART_CANCELLED,
            PosSessionEvent::TYPE_OVERRIDE_REQUESTED,
        ];
    }

    /** بيانات القاعدة من الكتالوج، أو null إن كان المفتاح مجهولاً. */
    public static function rule(string $key): ?array
    {
        return self::rules()[$key] ?? null;
    }
}
