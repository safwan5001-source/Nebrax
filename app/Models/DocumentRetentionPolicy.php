<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** سياسة احتفاظ global محكومة؛ لا override للمستأجر أو الفرع في PR-12. */
class DocumentRetentionPolicy extends Model
{
    use HasUuids;

    public const DEFAULT_KEY = 'document_center_default';

    public const PURGE_MODE_MANUAL_GOVERNED = 'manual_governed';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = [
        'policy_key',
        'retention_days',
        'enabled',
        'purge_mode',
        'updated_by',
    ];

    protected function casts(): array
    {
        return [
            'retention_days' => 'integer',
            'enabled' => 'boolean',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (self $policy): void {
            if ($policy->policy_key === '') {
                $policy->policy_key = self::DEFAULT_KEY;
            }
            if ($policy->purge_mode !== self::PURGE_MODE_MANUAL_GOVERNED) {
                throw new LogicException('Retention policy must use the governed manual purge mode.');
            }
        });

        static::updating(function (self $policy): void {
            if ($policy->isDirty('policy_key') || $policy->isDirty('purge_mode')) {
                throw new LogicException('Retention policy identity and purge mode are immutable.');
            }
        });

        static::deleting(fn () => throw new LogicException('Retention policies are retained for governance history.'));
    }

    public function updater(): BelongsTo
    {
        return $this->belongsTo(PlatformAdministrator::class, 'updated_by');
    }
}
