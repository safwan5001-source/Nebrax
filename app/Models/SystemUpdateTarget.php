<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * هدف تحديث نظام (PR-NOTIF-6): مستأجر أو مستخدم بعينه.
 *
 * فقط عندما `SystemUpdate.target_type` ليس 'all'.
 */
class SystemUpdateTarget extends Model
{
    use HasUuids;

    public $incrementing = false;

    protected $keyType = 'string';

    public $timestamps = false;

    protected $fillable = [
        'system_update_id',
        'target_type',
        'target_id',
    ];

    public function systemUpdate(): BelongsTo
    {
        return $this->belongsTo(SystemUpdate::class);
    }
}
