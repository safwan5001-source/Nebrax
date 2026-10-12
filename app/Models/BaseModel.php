<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

abstract class BaseModel extends Model
{
    use HasUuids {
        HasUuids::resolveRouteBindingQuery as private resolveUuidRouteBindingQuery;
    }
    use BelongsToTenant;

    public $incrementing = false;
    protected $keyType = 'string';

    /**
     * الربط الضمني للمسار ({batch} …) يسبق `SetTenant` في خط الوسطاء، فلا يكون
     * `TenantContext` مضبوطاً وقت الربط ويصمت `TenantScope`. بلا هذا القيد يصل مستأجر
     * آخر إلى نموذج لا يملكه (422/منطق الخدمة بدل 404 — يكشف وجوده وحالته).
     * نقيّد الربط بمستأجر المستخدم المصادَق حين لا يكون السياق مضبوطاً؛ المستخدم بلا
     * `tenant_id` (مدير المنصة) لا يتأثر، وحين يكون السياق مضبوطاً يعمل `TenantScope` كما كان.
     */
    public function resolveRouteBindingQuery($query, $value, $field = null)
    {
        $query = $this->resolveUuidRouteBindingQuery($query, $value, $field);

        if (! app(TenantContext::class)->has()) {
            $tenantId = request()->user()?->tenant_id;
            if (is_string($tenantId) && $tenantId !== '') {
                $query->where($this->getTable() . '.tenant_id', $tenantId);
            }
        }

        return $query;
    }
}
