<?php

namespace App\Http\Controllers\Api;

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
        'pos'        => ['default_customer' => 'عميل نقدي (POS)', 'print_receipt' => true, 'allow_discount' => true, 'receipt_footer' => '', 'cash_refund_policy' => PosSettings::CASH_REFUND_ORIGINAL_CASH_ONLY, 'exchange_surplus_policy' => PosSettings::EXCHANGE_SURPLUS_CUSTOMER_CREDIT_ONLY, 'held_sale_close_policy' => PosSettings::HELD_SALE_DISCARD_ON_SESSION_CLOSE],
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
            $request->validate([
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
            ]);
            // نحفظ الكائن كاملاً لا قيمة السياسة وحدها، كي تبقى الاستجابة وشاشة
            // POS والقراءة الخادمية فوق الافتراضات نفسها للمستأجر القديم والجديد.
            $data = array_merge(PosSettings::group($tenant), $data);
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
            return PosSettings::group($tenant);
        }

        return $stored ?? self::DEFAULTS[$section];
    }
}
