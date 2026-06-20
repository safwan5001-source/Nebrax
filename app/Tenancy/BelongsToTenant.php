<?php

namespace App\Tenancy;

use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Illuminate\Database\Eloquent\Model;

/**
 * كل نموذج أعمال يستخدم هذا الـ trait فيُعزل تلقائياً بالمستأجر.
 */
trait BelongsToTenant
{
    public static function bootBelongsToTenant(): void
    {
        static::addGlobalScope(new TenantScope());

        static::creating(function (Model $model) {
            $ctx = app(TenantContext::class);
            if ($ctx->has() && empty($model->tenant_id)) {
                $model->tenant_id = $ctx->id();
            }
        });
    }
}
