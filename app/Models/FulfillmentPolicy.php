<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * سياسة تنفيذ Commerce — تربط قناة بيع (`SalesChannel`) بمخزن تنفيذ واحد
 * ثابت (`Warehouse`) في V1 (ADR-03: `FIXED_LOCATION`).
 *
 * **`CompanyWide`**: تهيئة على مستوى المؤسسة، كـ`SalesChannel`/`Warehouse`
 * نفسيهما — لا فرعاً بعينه. عمداً بلا `branch_id`: السياسة تختار مخزناً
 * صراحةً، لا تستنتجه من فرع (ADR-03 §12/§13).
 *
 * لا منطق هنا — الحلّ عبر `FulfillmentPolicyService::resolveWarehouseFor()`
 * حصراً، الذي يتحقق من ملكية المستأجر ونشاط القناة والمخزن قبل الإرجاع.
 */
class FulfillmentPolicy extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id', 'sales_channel_id', 'warehouse_id',
    ];

    public function salesChannel(): BelongsTo
    {
        return $this->belongsTo(SalesChannel::class);
    }

    public function warehouse(): BelongsTo
    {
        return $this->belongsTo(Warehouse::class);
    }
}
