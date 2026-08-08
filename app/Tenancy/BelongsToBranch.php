<?php

namespace App\Tenancy;

use App\Models\Branch;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * وسم المستند بالفرع النشط عند الإنشاء — **بلا Global Scope**.
 *
 * على عكس `BelongsToTenant` (حاجز عزل يصفّي كل استعلام)، الفرع بُعد تحليلي:
 * يُكتب فقط، ولا يُصفّى به شيء تلقائياً. التصفية بالفرع صريحة في التقارير.
 */
trait BelongsToBranch
{
    public static function bootBelongsToBranch(): void
    {
        static::creating(function (Model $model) {
            $ctx = app(BranchContext::class);
            if ($ctx->has() && empty($model->branch_id)) {
                $model->branch_id = $ctx->id();
            }
        });
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }
}
