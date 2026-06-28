<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * نشاط في سجلّ علاقات العملاء (CRM) — غير محاسبي.
 */
class CrmActivity extends BaseModel
{
    protected $table = 'crm_activities';

    protected $fillable = [
        'tenant_id', 'partner_id', 'type', 'subject', 'activity_at', 'status', 'notes', 'created_by',
    ];

    protected $casts = [
        'activity_at' => 'datetime',
    ];

    protected $attributes = [
        'type'   => 'note',
        'status' => 'open',
    ];

    public function partner(): BelongsTo
    {
        return $this->belongsTo(Partner::class);
    }
}
