<?php

namespace App\Tenancy;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Scope;

/**
 * Global Scope يحقن WHERE tenant_id = ? في كل استعلام تلقائياً.
 * حاجز العزل الأساسي بين المستأجرين.
 */
class TenantScope implements Scope
{
    public function apply(Builder $builder, Model $model): void
    {
        $ctx = app(TenantContext::class);
        if ($ctx->has()) {
            $builder->where($model->getTable() . '.tenant_id', $ctx->id());
        }
    }
}
