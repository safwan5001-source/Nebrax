<?php

namespace App\Http\Controllers\Api;

use App\Models\Partner;
use App\Models\PaymentMethod;
use App\Models\ProductCategory;
use App\Models\Tenant;
use App\Support\Settings;
use App\Support\PosSettings;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * إعدادات أقسام المبيعات المتعددة (تفضيلات غير محاسبية) — تُخزَّن في
 * tenants.settings['sales_config'][<section>]. متحكّم عام لكل الأقسام:
 * حالات الفواتير، الفاتورة الإلكترونية، التصميمات، الحقول الإضافية،
 * قوائم الأسعار، مصادر الطلب، خيارات الشحن، أوامر البيع.
 *
 * لا أثر محاسبي (لا قيود). كل قسم بنية حرّة (قائمة أو كائن) محدودة الحجم.
 */
class SalesConfigController extends ApiController
{
    /** القيم الافتراضية لكل قسم — القوائم فارغة، النماذج بكائن افتراضي. */
    private const DEFAULTS = [
        'statuses'   => [],
        'fields'     => [],
        'pricelists' => [],
        'sources'    => [],
        'shipping'   => [],
        // تعريفات الضرائب (تفضيل غير محاسبي): الاسم، النسبة %، ومتضمَّن في السعر أم لا.
        // المجموعة السعودية القياسية افتراضياً. لا يمسّ محرّك القيود.
        'taxes'      => [
            ['name' => 'VAT', 'rate' => 15, 'inclusive' => false],
            ['name' => 'Zero Rated', 'rate' => 0, 'inclusive' => false],
            ['name' => 'Tax Free', 'rate' => 0, 'inclusive' => false],
        ],
        'einvoice'   => ['enabled' => false, 'phase' => '1', 'vat_number' => ''],
        'designs'    => ['template' => 'classic', 'theme' => 'blue', 'show_logo' => true, 'logo' => '', 'logo_height' => 56, 'sections' => [], 'accent_color' => '#2563EB', 'footer_text' => '', 'terms_text' => '', 'bank_text' => '', 'stamp' => '', 'signature' => ''],
        'orders'     => ['auto_convert' => false, 'require_approval' => false, 'prefix' => 'SO'],
        'pos'        => ['default_customer_id' => null, 'default_customer' => PosSettings::DEFAULT_WALKIN_CUSTOMER, 'print_receipt' => true, 'receipt_paper_size' => PosSettings::RECEIPT_PAPER_THERMAL_80, 'allow_discount' => true, 'receipt_footer' => '', 'enabled_payment_method_ids' => [], 'payment_methods_mode' => PosSettings::PAYMENT_METHODS_ALL_ACTIVE, 'default_payment_method_id' => null, 'apply_customer_price_list' => true, 'allow_unit_price_override' => false, 'show_onscreen_numeric_keypad' => false, 'allow_deferred_payment' => true, 'product_category_visibility_mode' => PosSettings::PRODUCT_CATEGORY_VISIBILITY_ALL, 'product_category_ids' => [], 'cash_refund_policy' => PosSettings::CASH_REFUND_ORIGINAL_CASH_ONLY, 'exchange_surplus_policy' => PosSettings::EXCHANGE_SURPLUS_CUSTOMER_CREDIT_ONLY, 'held_sale_close_policy' => PosSettings::HELD_SALE_DISCARD_ON_SESSION_CLOSE, 'show_product_images' => true, 'cash_drawer_enabled' => false, 'cash_drawer_driver' => PosSettings::CASH_DRAWER_DRIVER_UNAVAILABLE, 'cash_drawer_auto_open_after_cash' => false, 'sound_enabled' => true, 'scan_sound_enabled' => true, 'error_sound_enabled' => true, 'payment_sound_enabled' => true, 'sound_volume' => 60, 'haptics_enabled' => true],
    ];

    public function show(string $section): JsonResponse
    {
        $this->assertSection($section);

        return response()->json(['data' => $this->withCompanyLogo($section, $this->current($this->tenant(), $section))]);
    }

    public function update(Request $request, string $section): JsonResponse
    {
        $this->assertSection($section);

        // البنية حرّة (قائمة عناصر أو كائن إعدادات) محدودة بـ 200 عنصراً.
        $data = $request->validate([
            'data' => ['present', 'array', 'max:200'],
        ])['data'];

        $tenant = $this->tenant();

        if ($section === 'pos') {
            $posInput = $data;
            $request->validate([
                'data.default_customer_id' => ['nullable', 'uuid'],
                'data.default_customer' => ['nullable', 'string', 'max:255'],
                'data.cash_refund_policy' => ['nullable', Rule::in([
                    PosSettings::CASH_REFUND_ORIGINAL_CASH_ONLY,
                    PosSettings::CASH_REFUND_ALLOW_ANY_POS_SALE,
                ])],
                'data.exchange_surplus_policy' => ['nullable', Rule::in([
                    PosSettings::EXCHANGE_SURPLUS_CUSTOMER_CREDIT_ONLY,
                    PosSettings::EXCHANGE_SURPLUS_ALLOW_CASH_REFUND,
                ])],
                'data.held_sale_close_policy' => ['nullable', Rule::in([
                    PosSettings::HELD_SALE_DISCARD_ON_SESSION_CLOSE,
                    PosSettings::HELD_SALE_KEEP_FOR_NEXT_SESSION,
                ])],
                'data.enabled_payment_method_ids' => ['nullable', 'array', 'max:50'],
                'data.enabled_payment_method_ids.*' => ['uuid', 'distinct'],
                'data.payment_methods_mode' => ['nullable', Rule::in([
                    PosSettings::PAYMENT_METHODS_ALL_ACTIVE,
                    PosSettings::PAYMENT_METHODS_ONLY,
                    PosSettings::PAYMENT_METHODS_NONE,
                ])],
                'data.default_payment_method_id' => ['nullable', 'uuid'],
                'data.receipt_paper_size' => ['nullable', Rule::in([
                    PosSettings::RECEIPT_PAPER_THERMAL_58,
                    PosSettings::RECEIPT_PAPER_THERMAL_80,
                ])],
                'data.apply_customer_price_list' => ['nullable', 'boolean'],
                'data.allow_unit_price_override' => ['nullable', 'boolean'],
                'data.show_onscreen_numeric_keypad' => ['nullable', 'boolean'],
                'data.allow_deferred_payment' => ['nullable', 'boolean'],
                'data.show_product_images' => ['nullable', 'boolean'],
                'data.cash_drawer_enabled' => ['nullable', 'boolean'],
                'data.cash_drawer_driver' => ['nullable', Rule::in([
                    PosSettings::CASH_DRAWER_DRIVER_UNAVAILABLE,
                    PosSettings::CASH_DRAWER_DRIVER_LOCAL_BRIDGE,
                ])],
                'data.cash_drawer_auto_open_after_cash' => ['nullable', 'boolean'],
                'data.sound_enabled' => ['nullable', 'boolean'],
                'data.scan_sound_enabled' => ['nullable', 'boolean'],
                'data.error_sound_enabled' => ['nullable', 'boolean'],
                'data.payment_sound_enabled' => ['nullable', 'boolean'],
                'data.sound_volume' => ['nullable', 'integer', 'between:0,100'],
                'data.haptics_enabled' => ['nullable', 'boolean'],
                'data.product_category_visibility_mode' => ['nullable', Rule::in([
                    PosSettings::PRODUCT_CATEGORY_VISIBILITY_ALL,
                    PosSettings::PRODUCT_CATEGORY_VISIBILITY_ONLY,
                    PosSettings::PRODUCT_CATEGORY_VISIBILITY_EXCEPT,
                ])],
                'data.product_category_ids' => ['nullable', 'array', 'max:100'],
                'data.product_category_ids.*' => ['uuid', 'distinct'],
            ]);
            // نحفظ الكائن كاملاً لا قيمة السياسة وحدها، كي تبقى الاستجابة وشاشة
            // POS والقراءة الخادمية فوق الافتراضات نفسها للمستأجر القديم والجديد.
            $data = array_merge(PosSettings::group($tenant), $data);
            $this->normalizePosDefaultCustomerForWrite($data, $posInput);
            // قبل هذا العقد كانت القائمة غير الفارغة تعني «المحدد فقط»؛ لا
            // تُحوّل تحديثات العميل القديمة إلى «كل الطرق» عند ترقية الخادم.
            if (array_key_exists('enabled_payment_method_ids', $posInput)
                && ! array_key_exists('payment_methods_mode', $posInput)) {
                $data['payment_methods_mode'] = $posInput['enabled_payment_method_ids'] === []
                    ? PosSettings::PAYMENT_METHODS_ALL_ACTIVE
                    : PosSettings::PAYMENT_METHODS_ONLY;
            }
            $this->assertPosPaymentMethods($data);
            $this->assertPosProductCategories($data);
            $this->assertCashDrawerContract($data);
        }

        // ═══════════════════════════════════════════════════════════════
        //  الشعار يُخزَّن على مستوى الشركة لا داخل تصميم المستندات
        // ═══════════════════════════════════════════════════════════════
        //  الشاشة لم تتغيّر — ما زالت ترفعه ضمن قسم «التصاميم والهوية» —
        //  لكن مخزنه ارتفع إلى `settings['company']['logo']` ليقرأه `/me`
        //  فتعرضه قشرة التطبيق لكل مستخدم بلا قيد صلاحية `invoices.view`.
        //  (هجرة 000048 نقلت القيم القائمة.)
        //
        //  **مصدر واحد لا نسختان:** يُنزَع من حمولة التصميم قبل حفظها، فلا
        //  تبقى نسخة قديمة تنحرف عن الجديدة ويحتار القارئ أيّهما الصحيح.
        if ($section === 'designs' && array_key_exists('logo', $data)) {
            Settings::put('company', ['logo' => (string) $data['logo']], $tenant);
            unset($data['logo']);
        }

        $settings = $tenant->settings ?? [];
        $config = $settings['sales_config'] ?? [];
        $config[$section] = $data;
        $settings['sales_config'] = $config;
        $tenant->update(['settings' => $settings]);

        return response()->json(['data' => $this->withCompanyLogo($section, $data)]);
    }

    /**
     * العميل الافتراضي مرجع موجود فعلاً، لا نص حر. عند مسح الاختيار نعود
     * للعميل النقدي النظامي. وللتوافق مع عملاء API القديمة نحل الاسم القديم
     * فقط إن طابق عميلاً واحداً مرئياً؛ لا ننشئ طرفاً من خطأ كتابي.
     */
    private function normalizePosDefaultCustomerForWrite(array &$data, array $input): void
    {
        if (array_key_exists('default_customer_id', $input)) {
            $id = $input['default_customer_id'];
            if ($id === null || $id === '') {
                $data['default_customer_id'] = null;
                $data['default_customer'] = PosSettings::DEFAULT_WALKIN_CUSTOMER;

                return;
            }

            $partner = $this->findEligiblePosCustomer((string) $id);
            if ($partner === null) {
                abort(422, 'العميل الافتراضي غير موجود أو معطل أو خارج نطاق الفرع المسموح.');
            }

            $data['default_customer_id'] = $partner->id;
            $data['default_customer'] = $partner->name;

            return;
        }

        if (! array_key_exists('default_customer', $input)) {
            return;
        }

        $legacyName = trim((string) ($input['default_customer'] ?? ''));
        if ($legacyName === '' || $legacyName === PosSettings::DEFAULT_WALKIN_CUSTOMER) {
            $data['default_customer_id'] = null;
            $data['default_customer'] = PosSettings::DEFAULT_WALKIN_CUSTOMER;

            return;
        }

        $matches = Partner::query()
            ->where('is_active', true)
            ->whereIn('type', ['customer', 'both'])
            ->where('name', $legacyName)
            ->limit(2)
            ->get();
        if ($matches->count() !== 1) {
            $data['default_customer_id'] = null;
            $data['default_customer'] = PosSettings::DEFAULT_WALKIN_CUSTOMER;

            return;
        }

        $data['default_customer_id'] = $matches->first()->id;
        $data['default_customer'] = $matches->first()->name;
    }

    /** لا يتجاوز بحث الإعداد Tenant/Branch scopes ولا يقبل مورداً فقط. */
    private function findEligiblePosCustomer(string $id): ?Partner
    {
        return Partner::query()
            ->whereKey($id)
            ->where('is_active', true)
            ->whereIn('type', ['customer', 'both'])
            ->first();
    }

    /**
     * لا تسمح إعدادات POS إلا بوسائل دفع نشطة تملكها المؤسسة الحالية. القائمة
     * الفارغة تعني كل الوسائل النشطة للحفاظ على سلوك المستأجرين قبل هذه المرحلة.
     */
    private function assertPosPaymentMethods(array $data): void
    {
        $enabled = array_values(array_unique($data['enabled_payment_method_ids'] ?? []));
        $mode = $data['payment_methods_mode'] ?? PosSettings::PAYMENT_METHODS_ALL_ACTIVE;
        $default = $data['default_payment_method_id'] ?? null;
        if ($mode === PosSettings::PAYMENT_METHODS_NONE && ($enabled !== [] || $default !== null)) {
            abort(422, 'لا تقبل نقطة البيع طريقة افتراضية أو قائمة طرق عند تعطيل التحصيل.');
        }
        if ($mode === PosSettings::PAYMENT_METHODS_ONLY && $enabled === []) {
            abort(422, 'وضع الطرق المحددة يحتاج وسيلة دفع واحدة مفعلة على الأقل.');
        }
        if ($mode === PosSettings::PAYMENT_METHODS_ALL_ACTIVE && $enabled !== []) {
            abort(422, 'وضع كل الطرق النشطة لا يقبل قائمة طرق محددة.');
        }
        $ids = array_values(array_unique(array_filter([...$enabled, $default])));

        if ($ids === []) {
            return;
        }

        $activeIds = PaymentMethod::whereIn('id', $ids)
            ->where('is_active', true)
            ->pluck('id')
            ->all();
        if (count($activeIds) !== count($ids)) {
            abort(422, 'تتضمن إعدادات POS وسيلة دفع غير موجودة أو معطلة.');
        }

        if ($default !== null && $mode === PosSettings::PAYMENT_METHODS_ONLY && ! in_array($default, $enabled, true)) {
            abort(422, 'وسيلة الدفع الافتراضية يجب أن تكون ضمن الوسائل المفعلة في POS.');
        }
    }

    /** لا يسمح بتفعيل درج نقدية قبل تسجيل جسر محلي مقترن في جهاز POS نشط. */
    private function assertCashDrawerContract(array $data): void
    {
        $driver = $data['cash_drawer_driver'] ?? PosSettings::CASH_DRAWER_DRIVER_UNAVAILABLE;
        $enabled = ($data['cash_drawer_enabled'] ?? false) === true;
        $automatic = ($data['cash_drawer_auto_open_after_cash'] ?? false) === true;
        if (! $enabled && ! $automatic) {
            return;
        }
        if ($driver !== PosSettings::CASH_DRAWER_DRIVER_LOCAL_BRIDGE) {
            abort(422, 'تفعيل درج النقدية يتطلب اختيار الجسر المحلي المدعوم.');
        }

        $hasPairedDevice = \App\Models\PosDevice::query()
            ->where('is_active', true)
            ->get(['cash_drawer_config'])
            ->contains(fn (\App\Models\PosDevice $device) => is_array($device->cash_drawer_config)
                && isset($device->cash_drawer_config['bridge_url'], $device->cash_drawer_config['pairing_secret']));
        if (! $hasPairedDevice) {
            abort(422, 'تفعيل درج النقدية يتطلب اقتران جهاز POS واحد على الأقل بالجسر المحلي.');
        }
    }

    /**
     * لا تُحفظ قائمة POS إلا من تصنيفات نشطة يراها سياق الفرع/المستأجر الحالي.
     */
    private function assertPosProductCategories(array $data): void
    {
        $ids = array_values(array_unique($data['product_category_ids'] ?? []));
        if ($ids === []) {
            return;
        }

        $activeIds = ProductCategory::whereIn('id', $ids)
            ->where('is_active', true)
            ->pluck('id')
            ->all();
        if (count($activeIds) !== count($ids)) {
            abort(422, 'تتضمن إعدادات POS تصنيف منتج غير موجود أو معطل أو خارج النطاق.');
        }
    }

    private function assertSection(string $section): void
    {
        if (! array_key_exists($section, self::DEFAULTS)) {
            abort(404, 'قسم إعدادات غير معروف.');
        }
    }

    private function tenant(): Tenant
    {
        return Tenant::findOrFail(app(TenantContext::class)->id());
    }

    /** يحقن شعار الشركة في حمولة «التصاميم» فلا ترى الشاشة فرقاً بعد النقل. */
    private function withCompanyLogo(string $section, mixed $data): mixed
    {
        if ($section !== 'designs' || ! is_array($data)) {
            return $data;
        }

        // `array_merge` لا `+`: القيمة القديمة قد تبقى مخزَّنة في قسم التصاميم
        // (الهجرة نسختها ولم تحذفها)، و`+` كان يُبقيها فتنتصر النسخة المهجورة
        // على المصدر الجديد — وهو بالضبط الالتباس الذي نقلُ الحقل يمنعه.
        return array_merge($data, ['logo' => Settings::group('company', $this->tenant())['logo'] ?? '']);
    }

    private function current(Tenant $tenant, string $section): mixed
    {
        $stored = $tenant->settings['sales_config'][$section] ?? null;

        // سياسة POS تُقرأ من خادم واحد أيضاً (`PosSettings`) لأنها تغيّر
        // صلاحية رد النقد الفعلية، لا مجرد تفضيل عرض في شاشة الكاشير.
        if ($section === 'pos') {
            return $this->normalizePosDefaultCustomerForRead(PosSettings::group($tenant));
        }

        return $stored ?? self::DEFAULTS[$section];
    }

    /**
     * يهاجر عقد الاسم القديم في القراءة بلا كتابة صامتة: إن كان الاسم يطابق
     * عميلاً واحداً مرئياً نعيد معرفه، وإلا نعرض العميل النقدي النظامي. بذلك
     * لا يستطيع POS إنشاء عميل اعتباطي من نص إعداد قديم أو خطأ مطبعي.
     */
    private function normalizePosDefaultCustomerForRead(array $data): array
    {
        $id = $data['default_customer_id'] ?? null;
        if (is_string($id) && $id !== '') {
            $partner = $this->findEligiblePosCustomer($id);
            if ($partner !== null) {
                $data['default_customer_id'] = $partner->id;
                $data['default_customer'] = $partner->name;

                return $data;
            }
        }

        $legacyName = trim((string) ($data['default_customer'] ?? ''));
        if ($legacyName !== '' && $legacyName !== PosSettings::DEFAULT_WALKIN_CUSTOMER) {
            $matches = Partner::query()
                ->where('is_active', true)
                ->whereIn('type', ['customer', 'both'])
                ->where('name', $legacyName)
                ->limit(2)
                ->get();
            if ($matches->count() === 1) {
                $data['default_customer_id'] = $matches->first()->id;
                $data['default_customer'] = $matches->first()->name;

                return $data;
            }
        }

        $data['default_customer_id'] = null;
        $data['default_customer'] = PosSettings::DEFAULT_WALKIN_CUSTOMER;

        return $data;
    }
}
