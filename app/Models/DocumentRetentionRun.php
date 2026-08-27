<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** سجل محكوم لتشغيل retention يدوي أو dry-run على مستوى المنصة. */
class DocumentRetentionRun extends Model
{
    use HasUuids;

    public const STATUS_PLANNED = 'planned';

    public const STATUS_COMPLETED = 'completed';

    public const STATUS_FAILED = 'failed';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = [
        'document_retention_policy_id',
        'platform_administrator_id',
        'dry_run',
        'cutoff_at',
        'limit_count',
        'after_file_id',
        'last_file_id',
        'status',
        'scanned_count',
        'eligible_count',
        'purged_count',
        'skipped_count',
        'error_code',
        'error_message_safe',
        'started_at',
        'finished_at',
    ];

    protected function casts(): array
    {
        return [
            'dry_run' => 'boolean',
            'cutoff_at' => 'immutable_datetime',
            'started_at' => 'immutable_datetime',
            'finished_at' => 'immutable_datetime',
            'limit_count' => 'integer',
            'scanned_count' => 'integer',
            'eligible_count' => 'integer',
            'purged_count' => 'integer',
            'skipped_count' => 'integer',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (self $run): void {
            if (! in_array($run->status, [self::STATUS_PLANNED, self::STATUS_COMPLETED, self::STATUS_FAILED], true)) {
                throw new LogicException('Document retention run status is not permitted.');
            }
        });
        static::updating(function (self $run): void {
            $allowed = [
                'status', 'scanned_count', 'eligible_count', 'purged_count', 'skipped_count',
                'error_code', 'error_message_safe', 'last_file_id', 'started_at', 'finished_at', 'updated_at',
            ];
            if (array_diff(array_keys($run->getDirty()), $allowed) !== []) {
                throw new LogicException('Document retention run identity and parameters are immutable.');
            }
        });
        static::deleting(fn () => throw new LogicException('Document retention runs are retained as governance evidence.'));
    }

    public function policy(): BelongsTo
    {
        return $this->belongsTo(DocumentRetentionPolicy::class, 'document_retention_policy_id');
    }

    public function administrator(): BelongsTo
    {
        return $this->belongsTo(PlatformAdministrator::class, 'platform_administrator_id');
    }
}
