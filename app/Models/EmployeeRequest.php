<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * طلبٌ عام لموظف (سلفة، استئذان، شكوى...) بحقولٍ موحّدة عبر كل الأنواع —
 * نطاق البناء الأول لإدارة الطلبات، بسير موافقة أحادي المستوى (نفس نمط
 * `LeaveRequest` تماماً). سُمِّي `EmployeeRequest` لا `Request` تجنّباً
 * لتصادم الاسم مع `Illuminate\Http\Request`.
 */
class EmployeeRequest extends BaseModel implements CompanyWide
{
    public const STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];

    protected $fillable = [
        'tenant_id', 'employee_id', 'request_type_id', 'title', 'description',
        'requested_date', 'status', 'rejection_reason',
        'approved_by', 'approved_at', 'created_by',
    ];

    protected $casts = [
        'requested_date' => 'date',
        'approved_at'    => 'datetime',
    ];

    protected $attributes = [
        'status' => 'pending',
    ];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function requestType(): BelongsTo
    {
        return $this->belongsTo(RequestType::class);
    }

    public function approver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }

    public function isPending(): bool
    {
        return $this->status === 'pending';
    }
}
