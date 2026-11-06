<?php

namespace App\Models;

use App\Tenancy\BelongsToBranch;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * FUEL-B5.1: مرفق سند المورد (صورة/PDF) لاستلام وقود؛ دليل فقط — لا أثر مخزني أو محاسبي ولا يدخل في هاش أو توقيع.
 * `BelongsToBranch` كبقية المرفقات: يرث فرع الاستلام ويُعرض بنطاق المستخدم (الاستلام نفسه BranchScoped).
 */
class FuelDeliveryAttachment extends BaseModel
{
    use BelongsToBranch;
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_delivery_id', 'disk', 'path', 'original_name',
        'mime_type', 'size', 'sha256', 'uploaded_by',
    ];

    protected $casts = ['size' => 'integer'];

    public function delivery(): BelongsTo
    {
        return $this->referenceBelongsTo(FuelDelivery::class, 'fuel_delivery_id');
    }

    public function uploader(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'uploaded_by');
    }
}
