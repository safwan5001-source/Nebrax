<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * نوع طلب — كيانٌ مُدار قابل للتوسعة لكل مؤسسة (سلفة، استئذان، شكوى...)،
 * نطاق البناء الأول لإدارة الطلبات: نوعٌ فقط بحقول موحّدة على `EmployeeRequest`
 * — لا محرّك حقول ديناميكية لكل نوع بعد (design-system/foundations/
 * hr-users-architecture.md «إدارة الطلبات»).
 */
class RequestType extends BaseModel implements CompanyWide
{
    protected $fillable = ['tenant_id', 'name', 'requires_approval', 'is_active'];

    protected $casts = [
        'requires_approval' => 'boolean',
        'is_active'         => 'boolean',
    ];

    protected $attributes = [
        'requires_approval' => true,
        'is_active'         => true,
    ];

    public function employeeRequests(): HasMany
    {
        return $this->hasMany(EmployeeRequest::class);
    }
}
