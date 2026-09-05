<?php

namespace App\Support;

use App\Models\Partner;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Builder;

/**
 * إعدادات نقطة البيع المخزنة في `tenants.settings['sales_config']['pos']`.
 *
 * لا تقرأ خدمة المرتجعات أو البيع حمولة العميل أو متحكماً؛ هذه هي نقطة القراءة
 * الخادمية الموحدة للسياسات التي تؤثر في سلوك POS التشغيلي والمالي.
 */
final class PosSettings
{
    public const DEFAULT_WALKIN_CUSTOMER = 'عميل نقدي (POS)';
    public const CASH_REFUND_ORIGINAL_CASH_ONLY = 'original_cash_only';
    public const CASH_REFUND_ALLOW_ANY_POS_SALE = 'allow_any_pos_sale';
    public const EXCHANGE_SURPLUS_CUSTOMER_CREDIT_ONLY = 'customer_credit_only';
    public const EXCHANGE_SURPLUS_ALLOW_CASH_REFUND = 'allow_cash_refund';
    public const HELD_SALE_DISCARD_ON_SESSION_CLOSE = 'discard_on_session_close';
    public const HELD_SALE_KEEP_FOR_NEXT_SESSION = 'keep_for_next_session';
    public const PRODUCT_CATEGORY_VISIBILITY_ALL = 'all';
    public const PRODUCT_CATEGORY_VISIBILITY_ONLY = 'only';
    public const PRODUCT_CATEGORY_VISIBILITY_EXCEPT = 'except';
    public const RECEIPT_PAPER_THERMAL_58 = 'thermal_58';
    public const RECEIPT_PAPER_THERMAL_80 = 'thermal_80';
    public const PAYMENT_METHODS_ALL_ACTIVE = 'all_active';
    public const PAYMENT_METHODS_ONLY = 'only';
    public const PAYMENT_METHODS_NONE = 'none';
    public const CASH_DRAWER_DRIVER_UNAVAILABLE = 'unavailable';
    public const CASH_DRAWER_DRIVER_LOCAL_BRIDGE = 'local_bridge';
    public const AUDIT_POLICY_ALLOWED = 'allowed';
    public const AUDIT_POLICY_APPROVAL_REQUIRED = 'approval_required';
    public const AUDIT_POLICY_DENIED = 'denied';
    public const INTERACTION_MODE_AUTO = 'AUTO';
    public const INTERACTION_MODE_TOUCH = 'TOUCH';
    public const INTERACTION_MODE_KEYBOARD_MOUSE = 'KEYBOARD_MOUSE';
    public const INTERACTION_MODE_HYBRID = 'HYBRID';

    /** أوضاع تفاعل الكاشير المعتمدة — سياسة تشغيل لا أثر مالي. */
    public const INTERACTION_MODES = [
        self::INTERACTION_MODE_AUTO,
        self::INTERACTION_MODE_TOUCH,
        self::INTERACTION_MODE_KEYBOARD_MOUSE,
        self::INTERACTION_MODE_HYBRID,
    ];

    private const DEFAULTS = [
        // المعرّف هو المصدر المستقر للعميل الافتراضي. الاسم يبقى للتوافق مع
        // الإصدارات القديمة من POS، ويُطبّع عند الحفظ من سجل العميل نفسه.
        'default_customer_id' => null,
        'default_customer'   => self::DEFAULT_WALKIN_CUSTOMER,
        'print_receipt'      => true,
        // قالبا الإيصال الحراري المعتمدان في محرّك المستندات. 80 مم يحافظ على
        // سلوك الكاشير القائم، بينما يتيح 58 مم للطابعات الضيقة بلا تغيير مالي.
        'receipt_paper_size' => self::RECEIPT_PAPER_THERMAL_80,
        'allow_discount'     => true,
        'receipt_footer'     => '',
        // قائمة فارغة تعني «كل الوسائل النشطة»: لا تتغير شاشة POS للمستأجر
        // القائم عند ترقية المرحلة قبل أن يختار تقييداً صريحاً.
        'enabled_payment_method_ids' => [],
        // «الكل» و«المحدد» و«لا شيء» حالات مختلفة صراحةً؛ لا تجعل قائمة فارغة
        // غامضة بين التوافق التاريخي ومنع التحصيل في محطة POS.
        'payment_methods_mode' => self::PAYMENT_METHODS_ALL_ACTIVE,
        // اختيار عرضي للواجهة؛ تظل صلاحية الطريقة وتفعيلها مفروضة في الخدمة.
        'default_payment_method_id' => null,
        // قائمة السعر الافتراضية للعميل تُطبّق افتراضياً؛ الكاشير والخدمة يعيدان
        // تسعير السلة منها ما لم يعطلها المالك صراحةً.
        'apply_customer_price_list' => true,
        // تعديل السعر يغير الإيراد مباشرة؛ الافتراض الحامي يمنعه إلى أن يفعّله
        // مالك الشركة صراحةً، بينما يبقى الحد الأدنى وصلاحية استثنائه مستقلين.
        'allow_unit_price_override' => false,
        // لم يكن للكاشير محرر رقمي على الشاشة؛ يبقى المسار النصي القائم للمستأجرين
        // الحاليين حتى يفعّل المالك المساعد اللمسي صراحةً من تهيئة POS.
        'show_onscreen_numeric_keypad' => false,
        // أسلوب التفاعل يوجّه طبقة /pos التكيفية فقط. AUTO يحفظ سلوك المستأجرين
        // القائمين (تكيّف PR-4 + أهداف لمس PR-6) دون قفل نمط واحد.
        'interaction_mode' => self::INTERACTION_MODE_AUTO,
        // الافتراض يحفظ سلوك POS السابق الذي كان يسمح ببيع جزئي/آجل.
        'allow_deferred_payment' => true,
        // الافتراض المتوافق: لا تتغير المنتجات الظاهرة للمستأجر القائم. يختار
        // المالك لاحقاً «فقط» أو «الكل ما عدا» لتقييد تصنيفات الكاشير.
        'product_category_visibility_mode' => self::PRODUCT_CATEGORY_VISIBILITY_ALL,
        'product_category_ids' => [],
        // الافتراض الحامي: لا يخرج نقد من الدرج أكثر من النقد الذي دخل منه
        // بسبب فاتورة المصدر نفسها، ما لم يفعّل مالك الشركة الخيار الصريح الآخر.
        'cash_refund_policy' => self::CASH_REFUND_ORIGINAL_CASH_ONLY,
        // الافتراض الحامي: فرق المرتجع الزائد يبقى رصيداً للعميل، فلا يخرج
        // نقد من الدرج في الاستبدال إلا بتفويض إداري صريح وسياسة نقد متحققة.
        'exchange_surplus_policy' => self::EXCHANGE_SURPLUS_CUSTOMER_CREDIT_ONLY,
        // الافتراض الحامي: لا تظل مسودات السلة القديمة قابلة للاستئناف بعد إغلاق
        // ورديتها إلا إذا اختار المالك الاحتفاظ بها صراحةً ضمن نفس الكاشير والمخزن.
        'held_sale_close_policy' => self::HELD_SALE_DISCARD_ON_SESSION_CLOSE,
        // صور الكتالوج تفضيل عرض خاص بنقطة البيع فقط؛ يبقى مفعّلاً افتراضياً
        // حتى تتوافق المنشآت القائمة مع عرض صور المنتجات عند توافرها.
        'show_product_images' => true,
        // PR-2S: سياسة عرض إضافية فوق صلاحية `products.view_cost` — لا تمنح
        // الصلاحية وحدها كشفاً تلقائياً في POS. الافتراض الحامي معطّل: لا يظهر
        // شيء جديد لمستأجر قائم لم يفعّله المالك صراحةً. الأكثر تقييداً يفوز.
        'show_cost_profit_in_pos' => false,
        // لا تتصل السحابة بالطابعة أو USB أبداً. الافتراض يظل unavailable حتى
        // يقترن جهاز POS بجسر محلي موثوق وتفعّله المؤسسة صراحةً.
        'cash_drawer_enabled' => false,
        'cash_drawer_driver' => self::CASH_DRAWER_DRIVER_UNAVAILABLE,
        'cash_drawer_auto_open_after_cash' => false,
        // العد الأعمى لا يغير حساب expected، بل يؤخر كشفه إلى ما بعد تثبيت
        // counted cash. يبقى معطلاً افتراضياً لحفظ سلوك المنشآت الحالية.
        'blind_cash_count_enabled' => false,
        // سياسات العمليات الحساسة تمديد قابل للضبط لا أسماء أدوار. «المسموح» هو
        // الافتراض المتوافق للعمليات القائمة؛ إعادة العد لا يسمح بها إلا باعتماد.
        'audit_operation_policies' => [
            'item_remove' => self::AUDIT_POLICY_ALLOWED,
            'price_override' => self::AUDIT_POLICY_ALLOWED,
            'discount_change' => self::AUDIT_POLICY_ALLOWED,
            'cart_cancel' => self::AUDIT_POLICY_ALLOWED,
            'cash_recount' => self::AUDIT_POLICY_APPROVAL_REQUIRED,
            // Phase 4 — امتداد للنموذج القائم على عمليات خادمية حقيقية (لا Telemetry
            // بعد الفعل): إنشاء مرتجع، صرف نقدي، وفتح الدرج اليدوي. الافتراض «مسموح»
            // يحفظ سلوك كل مستأجر قائم؛ التقييد قرار مالك صريح لاحق.
            'refund' => self::AUDIT_POLICY_ALLOWED,
            'cash_out' => self::AUDIT_POLICY_ALLOWED,
            'manual_drawer_open' => self::AUDIT_POLICY_ALLOWED,
        ],
        // تفضيلات feedback محلية للواجهة؛ لا تدخل في البيع أو القيد ولا تعتمد
        // عليها الخدمة لتقرير صحة العملية. تظل مفعلة بالتوافق مع تجربة POS.
        'sound_enabled' => true,
        'scan_sound_enabled' => true,
        'error_sound_enabled' => true,
        'payment_sound_enabled' => true,
        'sound_volume' => 60,
        'haptics_enabled' => true,
    ];

    /** جميع إعدادات POS، مدموجة فوق الافتراضات المعتمدة. */
    public static function group(?Tenant $tenant = null): array
    {
        $tenant ??= self::tenant();
        $stored = $tenant?->settings['sales_config']['pos'] ?? [];
        // التوافق مع الإعدادات القديمة: قائمة فارغة كانت تعني كل الطرق النشطة،
        // وغير الفارغة كانت تعني تقييد POS بالمعرفات المحفوظة.
        if (! array_key_exists('payment_methods_mode', $stored)) {
            $stored['payment_methods_mode'] = empty($stored['enabled_payment_method_ids'])
                ? self::PAYMENT_METHODS_ALL_ACTIVE
                : self::PAYMENT_METHODS_ONLY;
        }

        $merged = array_merge(self::DEFAULTS, array_intersect_key($stored, self::DEFAULTS));
        if (! in_array($merged['interaction_mode'] ?? null, self::INTERACTION_MODES, true)) {
            $merged['interaction_mode'] = self::INTERACTION_MODE_AUTO;
        }

        return $merged;
    }

    /** أسلوب تفاعل الكاشير الصالح؛ القيمة الغائبة أو القديمة تعود لتلقائي. */
    public static function interactionMode(?Tenant $tenant = null): string
    {
        $mode = self::group($tenant)['interaction_mode'];

        return in_array($mode, self::INTERACTION_MODES, true)
            ? $mode
            : self::INTERACTION_MODE_AUTO;
    }

    /** قائمة معرّفات الوسائل المقيدة صراحةً؛ الفارغة تعني جميع الوسائل النشطة. */
    public static function enabledPaymentMethodIds(?Tenant $tenant = null): array
    {
        $ids = self::group($tenant)['enabled_payment_method_ids'];
        if (! is_array($ids)) {
            return [];
        }

        return array_values(array_unique(array_filter($ids, fn (mixed $id) => is_string($id) && $id !== '')));
    }

    /** وضع إتاحة التحصيل في POS؛ القيمة غير المعروفة تعود للتوافق الآمن مع الكل النشط. */
    public static function paymentMethodsMode(?Tenant $tenant = null): string
    {
        $mode = self::group($tenant)['payment_methods_mode'];

        return in_array($mode, [self::PAYMENT_METHODS_ALL_ACTIVE, self::PAYMENT_METHODS_ONLY, self::PAYMENT_METHODS_NONE], true)
            ? $mode
            : self::PAYMENT_METHODS_ALL_ACTIVE;
    }

    /** لا تتجاوز واجهة الكاشير الوسائل التي قيّدها المالك، مع تمييز «لا شيء» صراحةً. */
    public static function allowsPaymentMethod(string $paymentMethodId, ?Tenant $tenant = null): bool
    {
        return match (self::paymentMethodsMode($tenant)) {
            self::PAYMENT_METHODS_NONE => false,
            self::PAYMENT_METHODS_ONLY => in_array($paymentMethodId, self::enabledPaymentMethodIds($tenant), true),
            default => true,
        };
    }

    /** المعرّف الافتراضي المفضّل للعرض؛ قد يعود null إن لم يحدد المالك وسيلة. */
    public static function defaultPaymentMethodId(?Tenant $tenant = null): ?string
    {
        $id = self::group($tenant)['default_payment_method_id'];

        return is_string($id) && $id !== '' ? $id : null;
    }

    /** ورق الإيصال الحراري المسموح؛ لا تمرر قيمة إعداد غير معتمدة إلى الطباعة. */
    public static function receiptPaperSize(?Tenant $tenant = null): string
    {
        $size = self::group($tenant)['receipt_paper_size'];

        return in_array($size, [self::RECEIPT_PAPER_THERMAL_58, self::RECEIPT_PAPER_THERMAL_80], true)
            ? $size
            : self::RECEIPT_PAPER_THERMAL_80;
    }

    /** تطبيق قائمة سعر العميل سياسة POS صريحة؛ الافتراض يحدّث السلة عند الاختيار. */
    public static function appliesCustomerPriceList(?Tenant $tenant = null): bool
    {
        return self::group($tenant)['apply_customer_price_list'] !== false;
    }

    /** تعديل سعر الوحدة سياسة POS صريحة؛ الافتراض الحامي يمنع السعر المخصص. */
    public static function allowsUnitPriceOverride(?Tenant $tenant = null): bool
    {
        return self::group($tenant)['allow_unit_price_override'] === true;
    }

    /** الخصم سياسة POS صريحة؛ الافتراض يحفظ السلوك التاريخي للمستأجر القائم. */
    public static function allowsDiscount(?Tenant $tenant = null): bool
    {
        return self::group($tenant)['allow_discount'] !== false;
    }

    /**
     * R6 — الأهلية القانونية لطرف عميل POS: نشط ونوعه عميل أو كلاهما. لا مورّد
     * صرف، ولا طرف معطّل — بصرف النظر عن مصدر الطلب (منتقي الواجهة أو طلب API
     * مباشر بمعرّف مصنوع). هذا المرجع الوحيد للشرط: يستعمله كذلك تطبيع العميل
     * الافتراضي في `SalesConfigController::findEligiblePosCustomer()`، فلا
     * يوجد شرطان مختلفان لنفس السؤال في الكود.
     */
    public static function isEligibleCustomer(Partner $partner): bool
    {
        return $partner->is_active && in_array($partner->type, ['customer', 'both'], true);
    }

    /** البيع المؤجل سياسة صريحة؛ القيمة غير المعروفة تورّث الإتاحة التاريخية. */
    public static function allowsDeferredPayment(?Tenant $tenant = null): bool
    {
        return self::group($tenant)['allow_deferred_payment'] !== false;
    }

    /** وضع إتاحة التصنيفات الصالح؛ القيمة غير المعروفة تحافظ على الكتالوج الكامل. */
    public static function productCategoryVisibilityMode(?Tenant $tenant = null): string
    {
        $mode = self::group($tenant)['product_category_visibility_mode'];

        return in_array($mode, [
            self::PRODUCT_CATEGORY_VISIBILITY_ALL,
            self::PRODUCT_CATEGORY_VISIBILITY_ONLY,
            self::PRODUCT_CATEGORY_VISIBILITY_EXCEPT,
        ], true) ? $mode : self::PRODUCT_CATEGORY_VISIBILITY_ALL;
    }

    /** قائمة تصنيفات POS الصريحة؛ لا تفسر قائمة فارغة إلا مع وضعها المرافق. */
    public static function productCategoryIds(?Tenant $tenant = null): array
    {
        $ids = self::group($tenant)['product_category_ids'];
        if (! is_array($ids)) {
            return [];
        }

        return array_values(array_unique(array_filter($ids, fn (mixed $id) => is_string($id) && $id !== '')));
    }

    /**
     * PR-2S: هل مسموح بعرض التكلفة/الربحية داخل POS؟ هذا وحده لا يمنح أي شيء —
     * `EnsurePermission`/`Rbac::allows` هو حدّ الأمان الحقيقي على `products.view_cost`؛
     * هذا الإعداد يزيد القيد فوقه فقط (صلاحية=نعم وإعداد=معطّل ⇐ لا كشف).
     */
    public static function showsCostProfitInPos(?Tenant $tenant = null): bool
    {
        return self::group($tenant)['show_cost_profit_in_pos'] === true;
    }

    /** هل العد الأعمى مفعّل؟ قيمة غير معروفة لا تكشف بيانات إضافية. */
    public static function blindCashCountEnabled(?Tenant $tenant = null): bool
    {
        return self::group($tenant)['blind_cash_count_enabled'] === true;
    }

    /** سياسة العملية الحساسة الصالحة؛ القيم المجهولة تعود إلى الافتراض المتوافق. */
    public static function auditOperationPolicy(string $operation, ?Tenant $tenant = null): string
    {
        $policies = self::group($tenant)['audit_operation_policies'];
        $policy = is_array($policies) ? ($policies[$operation] ?? self::AUDIT_POLICY_ALLOWED) : self::AUDIT_POLICY_ALLOWED;

        return in_array($policy, [self::AUDIT_POLICY_ALLOWED, self::AUDIT_POLICY_APPROVAL_REQUIRED, self::AUDIT_POLICY_DENIED], true)
            ? $policy
            : self::AUDIT_POLICY_ALLOWED;
    }

    /** المنتج بلا تصنيف لا تقيّده السياسة؛ المقصود هو التصنيفات المُدارة حصراً. */
    public static function allowsProductCategory(?string $categoryId, ?Tenant $tenant = null): bool
    {
        if ($categoryId === null) {
            return true;
        }

        $ids = self::productCategoryIds($tenant);

        return match (self::productCategoryVisibilityMode($tenant)) {
            self::PRODUCT_CATEGORY_VISIBILITY_ONLY => in_array($categoryId, $ids, true),
            self::PRODUCT_CATEGORY_VISIBILITY_EXCEPT => ! in_array($categoryId, $ids, true),
            default => true,
        };
    }

    /** يطبق الحارس نفسه عند تحميل الكتالوج، فلا تكون الفلترة واجهية قابلة للتجاوز. */
    public static function constrainProductsByCategory(Builder $query, ?Tenant $tenant = null): Builder
    {
        $mode = self::productCategoryVisibilityMode($tenant);
        $ids = self::productCategoryIds($tenant);

        if ($mode === self::PRODUCT_CATEGORY_VISIBILITY_ALL
            || ($mode === self::PRODUCT_CATEGORY_VISIBILITY_EXCEPT && $ids === [])) {
            return $query;
        }

        return $query->where(function (Builder $categories) use ($mode, $ids) {
            // المنتج التاريخي غير المصنف لا يدخل في نطاق الإقصاء أو الاختيار.
            $categories->whereNull('category_id');
            if ($mode === self::PRODUCT_CATEGORY_VISIBILITY_ONLY && $ids !== []) {
                $categories->orWhereIn('category_id', $ids);
            }
            if ($mode === self::PRODUCT_CATEGORY_VISIBILITY_EXCEPT && $ids !== []) {
                $categories->orWhereNotIn('category_id', $ids);
            }
        });
    }

    /** سياسة رد النقد الصالحة فقط؛ القيمة المخزنة غير المعروفة تعود للافتراض الحامي. */
    public static function cashRefundPolicy(?Tenant $tenant = null): string
    {
        $policy = self::group($tenant)['cash_refund_policy'];

        return in_array($policy, [self::CASH_REFUND_ORIGINAL_CASH_ONLY, self::CASH_REFUND_ALLOW_ANY_POS_SALE], true)
            ? $policy
            : self::CASH_REFUND_ORIGINAL_CASH_ONLY;
    }

    /** سياسة تسوية فرق الاستبدال الصالحة فقط؛ القيمة غير المعروفة لا تسمح بالنقد. */
    public static function exchangeSurplusPolicy(?Tenant $tenant = null): string
    {
        $policy = self::group($tenant)['exchange_surplus_policy'];

        return in_array($policy, [self::EXCHANGE_SURPLUS_CUSTOMER_CREDIT_ONLY, self::EXCHANGE_SURPLUS_ALLOW_CASH_REFUND], true)
            ? $policy
            : self::EXCHANGE_SURPLUS_CUSTOMER_CREDIT_ONLY;
    }

    /** سياسة السلال المعلّقة الصالحة فقط؛ القيمة غير المعروفة تلغي المسودة عند الإغلاق. */
    public static function heldSaleClosePolicy(?Tenant $tenant = null): string
    {
        $policy = self::group($tenant)['held_sale_close_policy'];

        return in_array($policy, [self::HELD_SALE_DISCARD_ON_SESSION_CLOSE, self::HELD_SALE_KEEP_FOR_NEXT_SESSION], true)
            ? $policy
            : self::HELD_SALE_DISCARD_ON_SESSION_CLOSE;
    }

    /**
     * Phase 4 — إعدادات منفصلة عن `sales_config.pos` القائم (`sales_config.pos_loss_prevention`)
     * حتى لا تتغيّر افتراضات القسم الأصلي لمستأجر قائم بإضافة مفتاح لم يطلبه.
     */
    private const LP_DEFAULTS = [
        // فصل المهام (SoD) لمسارات تسوية فرق الإغلاق: افتراضه معطّل حمايةً
        // للمنشآت أحادية الكاشير (لا معتمِد ثانٍ متاح أصلاً) — تفعيلٌ صريح فقط.
        'self_approval_blocked_for_variance' => false,
        // دقائق سماح حول حدود الوردية المعتمدة لقاعدة outside_operating_hours —
        // يمتص فروقات الساعة/المزامنة الطبيعية، لا يغيّر منطق التغطية نفسه.
        'outside_hours_grace_minutes' => 30,
    ];

    /** إعدادات منع الفقد (Phase 4) لهذا المستأجر، مدموجة فوق الافتراضات الحامية. */
    public static function lossPreventionGroup(?Tenant $tenant = null): array
    {
        $tenant ??= self::tenant();
        $stored = $tenant?->settings['sales_config']['pos_loss_prevention'] ?? [];

        return array_merge(self::LP_DEFAULTS, array_intersect_key($stored, self::LP_DEFAULTS));
    }

    /** فصل مهام تسوية الفرق — اختياري صراحةً، لا يُفرض على منشأة كاشير واحد. */
    public static function selfApprovalBlockedForVariance(?Tenant $tenant = null): bool
    {
        return self::lossPreventionGroup($tenant)['self_approval_blocked_for_variance'] === true;
    }

    /** دقائق سماح outside_operating_hours؛ قيمة خارج المدى المعقول تعود للافتراض. */
    public static function outsideHoursGraceMinutes(?Tenant $tenant = null): int
    {
        $minutes = self::lossPreventionGroup($tenant)['outside_hours_grace_minutes'];

        return is_int($minutes) && $minutes >= 0 && $minutes <= 240 ? $minutes : 30;
    }

    private static function tenant(): ?Tenant
    {
        $id = app(TenantContext::class)->id();

        return $id ? Tenant::find($id) : null;
    }
}
