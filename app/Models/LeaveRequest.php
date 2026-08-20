<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * طلب إجازة — سجلٌّ واحد لموظفٍ بفترةٍ محدَّدة، بسير موافقة أحادي المستوى
 * (لا تعدّد مستويات في هذا التمرير — design-system/foundations/
 * hr-users-architecture.md «الإجازات»). **بلا أثرٍ مالي آلي**: لا يمسّ
 * PayrollService ولا يستدعي LedgerService مهما كانت `leaveType.is_paid`.
 */
class LeaveRequest extends BaseModel implements CompanyWide
{
    public const STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];

    protected $fillable = [
        'tenant_id', 'employee_id', 'leave_type_id', 'start_date', 'end_date',
        'days_count', 'status', 'reason', 'rejection_reason',
        'approved_by', 'approved_at', 'created_by',
    ];

    protected $casts = [
        'start_date'  => 'date',
        'end_date'    => 'date',
        'days_count'  => 'integer',
        'approved_at' => 'datetime',
    ];

    protected $attributes = [
        'status' => 'pending',
    ];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function leaveType(): BelongsTo
    {
        return $this->belongsTo(LeaveType::class);
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
