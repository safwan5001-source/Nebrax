<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/** نبضة تشغيل غير مستأجرية لمكوّن داخلي مثل عامل المستندات. */
class PlatformRuntimeHeartbeat extends Model
{
    use HasUuids;

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = ['component', 'instance_id', 'status', 'metadata', 'last_seen_at'];

    protected function casts(): array
    {
        return [
            'metadata' => 'array',
            'last_seen_at' => 'immutable_datetime',
        ];
    }
}
