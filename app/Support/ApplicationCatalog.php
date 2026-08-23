<?php

namespace App\Support;

/**
 * ═══════════════════════════════════════════════════════════════
 *  كتالوج قدرات المنتج — مصدر حقيقة ثابت، لا حالة مستأجر
 * ═══════════════════════════════════════════════════════════════
 *
 * يعرّف هذا الكتالوج «ما الذي يمكن أن يقدمه نبراكس» فقط:
 * المفتاح، المجموعة، نضج القدرة، إلزاميتها، واعتمادياتها.
 *
 * لا يخزّن قرار مستأجر بتفعيل القدرة، ولا يتحكم في التنقل أو الصلاحيات بعد.
 * ذلك يأتي في مرحلة حالة التطبيقات وبوابات الإنفاذ؛ فالخلط بين تعريف المنتج
 * وحالة المستأجر سيجعل الإعدادات المشتركة تتسرب بين المؤسسات.
 *
 * المجموعات تطابق خريطة نبراكس، لا أسماء واجهة دفترة حرفياً. والأخضر/الرمادي
 * في لقطة دفترة كان حالة حساب مرجعي، لا افتراضاً صالحاً لأي مستأجر في نبراكس.
 */
final class ApplicationCatalog
{
    public const MATURITY_BUILT = 'built';

    public const MATURITY_COMING_SOON = 'coming_soon';

    public const MATURITY_RETIRED = 'retired';

    /**
     * كل قدرة لها مفتاح نقطة مستقل، حتى لو كانت مجموعة الأعمال نفسها مفعلة.
     *
     * `mandatory` يعني: لا ينبغي لمسار «إيقاف التطبيق» المستقبلي أن يعرض
     * إيقافها بعد تهيئة المؤسسة؛ وليس معناه أن صلاحيات المستخدم تتجاوز RBAC.
     *
     * @var array<string, array{group:string,maturity:string,mandatory:bool,dependencies:list<string>}>
     */
    private const APPLICATIONS = [
        // ────────────────────────── المبيعات ونقطة البيع ──────────────────────────
        'sales.invoicing' => [
            'group' => 'sales',
            'maturity' => self::MATURITY_BUILT,
            'mandatory' => true,
            'dependencies' => [],
        ],
        'sales.pos' => [
            'group' => 'pos',
            'maturity' => self::MATURITY_BUILT,
            'mandatory' => false,
            'dependencies' => ['sales.invoicing'],
        ],
        'sales.commissions' => [
            'group' => 'sales',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => ['sales.invoicing'],
        ],
        'sales.installments' => [
            'group' => 'sales',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => ['sales.invoicing', 'finance.operations'],
        ],
        'sales.promotions' => [
            'group' => 'sales',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => ['sales.invoicing'],
        ],
        /**
         * تفعيلها يعيش لاحقاً في إعدادات إدارة التطبيقات (`settings`)، منفصلاً
         * عن ترقيم الفاتورة الإلكترونية الذي يبقى ضمن المبيعات — فمجموعتها
         * `settings` تصف مكان مفتاح التفعيل نفسه، لا الوحدة المحاسبية.
         */
        'compliance.zatca' => [
            'group' => 'settings',
            'maturity' => self::MATURITY_BUILT,
            'mandatory' => false,
            'dependencies' => ['sales.invoicing', 'accounting.ledger'],
        ],

        // ─────────────────────── العملاء وعلاقات العملاء ───────────────────────
        'crm.customers' => [
            'group' => 'customers',
            'maturity' => self::MATURITY_BUILT,
            'mandatory' => true,
            'dependencies' => [],
        ],
        'sales.insurance' => [
            'group' => 'customers',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => ['sales.invoicing'],
        ],
        'crm.follow_up' => [
            'group' => 'customers',
            'maturity' => self::MATURITY_BUILT,
            'mandatory' => false,
            'dependencies' => ['crm.customers'],
        ],
        'crm.loyalty' => [
            'group' => 'customers',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => ['crm.customers', 'sales.invoicing'],
        ],
        'crm.memberships' => [
            'group' => 'customers',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => ['crm.customers'],
        ],
        'crm.customer_attendance' => [
            'group' => 'customers',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => ['crm.customers'],
        ],
        'crm.points_balances' => [
            'group' => 'customers',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => ['crm.customers', 'sales.invoicing'],
        ],

        // ───────────────────── المخزون والمشتريات ─────────────────────
        'inventory.core' => [
            'group' => 'inventory',
            'maturity' => self::MATURITY_BUILT,
            'mandatory' => false,
            'dependencies' => [],
        ],
        'purchases.cycle' => [
            'group' => 'purchases',
            'maturity' => self::MATURITY_BUILT,
            'mandatory' => false,
            'dependencies' => ['accounting.ledger'],
        ],

        // ───────────────────────── الحسابات والمالية ─────────────────────────
        'accounting.ledger' => [
            'group' => 'accounting',
            'maturity' => self::MATURITY_BUILT,
            'mandatory' => true,
            'dependencies' => [],
        ],
        'accounting.cheques' => [
            'group' => 'accounting',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => ['accounting.ledger', 'finance.operations'],
        ],
        'finance.operations' => [
            'group' => 'finance',
            'maturity' => self::MATURITY_BUILT,
            'mandatory' => false,
            'dependencies' => ['accounting.ledger'],
        ],

        // ───────────────────────── الموارد البشرية ─────────────────────────
        'hr.employees' => [
            'group' => 'hr',
            'maturity' => self::MATURITY_BUILT,
            'mandatory' => false,
            'dependencies' => [],
        ],
        'hr.requests' => [
            'group' => 'hr',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => ['hr.employees'],
        ],
        'hr.payroll' => [
            'group' => 'hr',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => ['hr.employees', 'accounting.ledger'],
        ],
        'hr.attendance' => [
            'group' => 'hr',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => ['hr.employees'],
        ],
        'hr.organization' => [
            'group' => 'hr',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => ['hr.employees'],
        ],

        // ───────────────────────── التشغيل والعمليات ─────────────────────────
        'operations.work_orders' => [
            'group' => 'operations',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => [],
        ],
        'operations.rentals' => [
            'group' => 'operations',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => [],
        ],
        'operations.leases' => [
            'group' => 'operations',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => ['operations.rentals'],
        ],
        'operations.bookings' => [
            'group' => 'operations',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => [],
        ],
        'operations.time_tracking' => [
            'group' => 'operations',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => ['hr.employees'],
        ],
        'operations.manufacturing' => [
            'group' => 'operations',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => ['inventory.core'],
        ],
        'operations.workflow' => [
            'group' => 'operations',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => [],
        ],

        // ───────────────────────── اللوجستيات ─────────────────────────
        'logistics.fleet' => [
            'group' => 'logistics',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => [],
        ],
        'logistics.shipping' => [
            'group' => 'logistics',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => [],
        ],

        // ───────────────────── إدارة محطات الوقود ─────────────────────
        // المنتج التجاري الأول هو `fuel-stations`، لكن الكتالوج يعرّف قدرات
        // تقنية فقط. لا يصبح أي مفتاح هنا منتجاً مدفوعاً مستقلاً تلقائياً.
        // تبدأ دورة 0 بـ core وحدها؛ لا تُمنح/تُفعَّل القدرات المؤجلة قبل أن
        // يكتمل نطاقها الحقيقي في دورته، فيبقى كتالوج التطبيقات صادقاً.
        'fuel_stations.core' => [
            'group' => 'fuel_stations',
            'maturity' => self::MATURITY_BUILT,
            'mandatory' => false,
            'dependencies' => [],
        ],
        'fuel_stations.inventory' => [
            'group' => 'fuel_stations',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => ['fuel_stations.core'],
        ],
        'fuel_stations.forecourt' => [
            'group' => 'fuel_stations',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => ['fuel_stations.core'],
        ],
        'fuel_stations.fleet' => [
            'group' => 'fuel_stations',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => ['fuel_stations.core'],
        ],
        'fuel_stations.avi' => [
            'group' => 'fuel_stations',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => ['fuel_stations.core'],
        ],
        'fuel_stations.maintenance' => [
            'group' => 'fuel_stations',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => ['fuel_stations.core'],
        ],
        'fuel_stations.integrations' => [
            'group' => 'fuel_stations',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => ['fuel_stations.core'],
        ],

        // ───────────────────────── البنية والإضافات ─────────────────────────
        'company.branches' => [
            'group' => 'branches',
            'maturity' => self::MATURITY_BUILT,
            'mandatory' => false,
            'dependencies' => [],
        ],
        'communications.sms' => [
            'group' => 'settings',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => [],
        ],
        'commerce.storefront' => [
            'group' => 'sales',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => ['sales.invoicing'],
        ],

        // ─────────────────────── التكاملات الخارجية ───────────────────────
        'integration.mudad' => [
            'group' => 'integrations',
            'maturity' => self::MATURITY_COMING_SOON,
            'mandatory' => false,
            'dependencies' => [],
        ],
    ];

    /** @return array<string, array{group:string,maturity:string,mandatory:bool,dependencies:list<string>}> */
    public static function all(): array
    {
        return self::APPLICATIONS;
    }

    /** @return list<string> */
    public static function keys(): array
    {
        return array_keys(self::APPLICATIONS);
    }

    /** @return array{group:string,maturity:string,mandatory:bool,dependencies:list<string>}|null */
    public static function find(string $key): ?array
    {
        return self::APPLICATIONS[$key] ?? null;
    }

    public static function exists(string $key): bool
    {
        return array_key_exists($key, self::APPLICATIONS);
    }

    /** هل القدرة صالحة للعرض لاحقاً كخيار تفعيل، قبل فحص الخطة وحالة المستأجر؟ */
    public static function isActivatable(string $key): bool
    {
        $application = self::find($key);

        return $application !== null && $application['maturity'] === self::MATURITY_BUILT;
    }

    /** @return list<string> */
    public static function dependenciesFor(string $key): array
    {
        return self::find($key)['dependencies'] ?? [];
    }

    /** @return list<string> */
    public static function groups(): array
    {
        return array_values(array_unique(array_column(self::APPLICATIONS, 'group')));
    }

    /**
     * أخطاء عقد الكتالوج فقط. لا يفحص هذا التابع جاهزية المستأجر أو خطته؛
     * تلك مسؤولية مرحلة حالة التطبيقات وبوابات الإنفاذ اللاحقة.
     *
     * @return list<string>
     */
    public static function validationErrors(): array
    {
        $errors = [];
        $maturities = [self::MATURITY_BUILT, self::MATURITY_COMING_SOON, self::MATURITY_RETIRED];

        foreach (self::APPLICATIONS as $key => $application) {
            if ($application['group'] === '') {
                $errors[] = "{$key}: المجموعة مطلوبة.";
            }

            if (! in_array($application['maturity'], $maturities, true)) {
                $errors[] = "{$key}: حالة نضج غير معروفة.";
            }

            if ($application['mandatory'] && $application['maturity'] !== self::MATURITY_BUILT) {
                $errors[] = "{$key}: القدرة الإلزامية يجب أن تكون مبنية.";
            }

            if (count($application['dependencies']) !== count(array_unique($application['dependencies']))) {
                $errors[] = "{$key}: الاعتماد مكرر.";
            }

            foreach ($application['dependencies'] as $dependency) {
                if ($dependency === $key) {
                    $errors[] = "{$key}: لا يجوز أن يعتمد التطبيق على نفسه.";
                }

                if (! self::exists($dependency)) {
                    $errors[] = "{$key}: اعتماد غير معروف {$dependency}.";

                    continue;
                }

                if (
                    $application['maturity'] === self::MATURITY_BUILT
                    && self::find($dependency)['maturity'] !== self::MATURITY_BUILT
                ) {
                    $errors[] = "{$key}: قدرة مبنية تعتمد على قدرة غير مبنية {$dependency}.";
                }
            }
        }

        return $errors;
    }
}
