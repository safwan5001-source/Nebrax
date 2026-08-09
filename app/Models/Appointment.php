<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * موعد مع عميل — مستند تنظيمي غير محاسبي (لا يولّد قيوداً).
 */
/** @see design-system/foundations/multi-branch-architecture.md — تشغيلي: معزول بالفرع */
class Appointment extends BaseModel
{
    use ResolvesBranchReferences;
    use BranchScoped;

    protected $fillable = [
        'tenant_id', 'branch_id', 'partner_id', 'title', 'appointment_at',
        'duration_minutes', 'status', 'location', 'notes', 'created_by',
    ];

    protected $casts = [
        'appointment_at'   => 'datetime',
        'duration_minutes' => 'integer',
    ];

    protected $attributes = [
        'status' => 'scheduled',
    ];

    /** مرجع مخزَّن — لا يُصفّى بالفرع أبداً (المستند حجّة قائمة، لا نتيجة تصفّح). */
    public function partner(): BelongsTo
    {
        return $this->referenceBelongsTo(Partner::class);
    }
}
