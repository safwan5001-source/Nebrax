<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * موعد مع عميل — مستند تنظيمي غير محاسبي (لا يولّد قيوداً).
 */
class Appointment extends BaseModel
{
    protected $fillable = [
        'tenant_id', 'partner_id', 'title', 'appointment_at',
        'duration_minutes', 'status', 'location', 'notes', 'created_by',
    ];

    protected $casts = [
        'appointment_at'   => 'datetime',
        'duration_minutes' => 'integer',
    ];

    protected $attributes = [
        'status' => 'scheduled',
    ];

    public function partner(): BelongsTo
    {
        return $this->belongsTo(Partner::class);
    }
}
