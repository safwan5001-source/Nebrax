<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * جهة اتصال (شخص) — مرتبطة اختيارياً بعميل. غير محاسبية.
 */
class Contact extends BaseModel
{
    protected $fillable = [
        'tenant_id', 'partner_id', 'name', 'job_title', 'email', 'phone', 'notes', 'created_by',
    ];

    public function partner(): BelongsTo
    {
        return $this->belongsTo(Partner::class);
    }
}
