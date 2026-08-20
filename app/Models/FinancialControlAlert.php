<?php

namespace App\Models;

use App\Tenancy\BelongsToBranch;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** تنبيه رقابي قراءة-فقط؛ لا يغيّر القيد أو المصدر الذي يصفه. */
class FinancialControlAlert extends BaseModel
{
    use BelongsToBranch;

    protected $fillable = [
        'tenant_id',
        'branch_id',
        'fingerprint',
        'rule',
        'severity',
        'status',
        'title',
        'description',
        'source_type',
        'source_id',
        'details',
        'first_detected_at',
        'last_detected_at',
        'resolved_at',
        'acknowledged_by',
        'acknowledged_at',
        'acknowledgement_note',
    ];

    protected $casts = [
        'details' => 'array',
        'first_detected_at' => 'datetime',
        'last_detected_at' => 'datetime',
        'resolved_at' => 'datetime',
        'acknowledged_at' => 'datetime',
    ];

    public function acknowledgedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'acknowledged_by');
    }
}
