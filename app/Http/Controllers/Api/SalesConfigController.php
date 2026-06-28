<?php

namespace App\Http\Controllers\Api;

use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

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
        'einvoice'   => ['enabled' => false, 'phase' => '1', 'vat_number' => ''],
        'designs'    => ['template' => 'classic', 'show_logo' => true, 'accent_color' => '#2563EB', 'footer_text' => ''],
        'orders'     => ['auto_convert' => false, 'require_approval' => false, 'prefix' => 'SO'],
        'pos'        => ['default_customer' => 'عميل نقدي (POS)', 'print_receipt' => true, 'allow_discount' => true, 'receipt_footer' => ''],
    ];

    public function show(string $section): JsonResponse
    {
        $this->assertSection($section);

        return response()->json(['data' => $this->current($this->tenant(), $section)]);
    }

    public function update(Request $request, string $section): JsonResponse
    {
        $this->assertSection($section);

        // البنية حرّة (قائمة عناصر أو كائن إعدادات) محدودة بـ 200 عنصراً.
        $data = $request->validate([
            'data' => ['present', 'array', 'max:200'],
        ])['data'];

        $tenant = $this->tenant();
        $settings = $tenant->settings ?? [];
        $config = $settings['sales_config'] ?? [];
        $config[$section] = $data;
        $settings['sales_config'] = $config;
        $tenant->update(['settings' => $settings]);

        return response()->json(['data' => $data]);
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

    private function current(Tenant $tenant, string $section): mixed
    {
        $stored = $tenant->settings['sales_config'][$section] ?? null;

        return $stored ?? self::DEFAULTS[$section];
    }
}
