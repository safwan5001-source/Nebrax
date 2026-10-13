<?php

namespace App\Http\Controllers\Api;

use App\Support\DeliveryPlatformCatalog;
use App\Support\DeliveryProviderReadiness;
use App\Support\Rbac;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * INT-READY-1 — جاهزية مزوّدي التوصيل للتكامل الأصلي. قراءة فقط.
 *
 * بيانات المنصة نفسها لكل المستأجرين (سجلّ ثابت بلا بيانات مستأجر)، فلا قراءة من
 * قاعدة البيانات ولا كتابة. الصلاحية في `routes/api.php`: `invoices.view` وقدرة
 * `sales.pos` — كشاشة منصات التوصيل نفسها، فلا صلاحية جديدة.
 *
 * الحقول الداخلية `technical` و`evidence_date` و`evidence_ref` (قسم «متقدم» في
 * التصميم) تُعاد فقط لمن يملك `delivery_connector.view`؛ غيره يتلقى حالة UX
 * العامة (`ux_state`) وأعلام الجاهزية بلا تفاصيل الدليل.
 */
class DeliveryProviderReadinessController extends ApiController
{
    public function index(Request $request): JsonResponse
    {
        $withEvidence = Rbac::allows((string) $request->user()->role, 'delivery_connector.view');

        $items = [];
        foreach (DeliveryProviderReadiness::all() as $key => $row) {
            $catalog = DeliveryPlatformCatalog::get($key);

            $item = [
                'platform_key' => $key,
                'name' => $catalog['name'] ?? $key,
                'name_en' => $catalog['name_en'] ?? $key,
                'ux_state' => DeliveryProviderReadiness::uxState($row),
                'connect_enabled' => $row['connect_enabled'],
                'sync_enabled' => $row['sync_enabled'],
            ];
            // الحقول الثلاثة الداخلية (القيمة التقنية، تاريخ الدليل، مرجعه) لقسم «متقدم»
            // لمالك/مدير فقط (تصميم DLV-INTEGRATIONS-UX-DESIGN-1 §5.3). `ux_state` عام.
            if ($withEvidence) {
                $item['technical'] = $row['technical'];
                $item['evidence_date'] = $row['evidence_date'];
                $item['evidence_ref'] = $row['evidence_ref'];
            }

            $items[] = $item;
        }

        return response()->json(['data' => $items]);
    }
}
