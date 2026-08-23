<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** سجل ثابت لتغييرات إعدادات التكاملات؛ لا يخزن قيماً أو أسراراً. */
class PlatformIntegrationAuditEvent extends Model
{
    use HasUuids;

    public $incrementing = false;

    public $timestamps = false;

    protected $keyType = 'string';

    protected $fillable = [
        'platform_administrator_id',
        'integration_key',
        'action',
        'changed_keys',
        'occurred_at',
    ];

    protected function casts(): array
    {
        return [
            'changed_keys' => 'array',
            'occurred_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Platform integration audit events are append-only.'));
        static::deleting(fn () => throw new LogicException('Platform integration audit events are append-only.'));
    }

    public function administrator(): BelongsTo
    {
        return $this->belongsTo(PlatformAdministrator::class, 'platform_administrator_id');
    }
}
