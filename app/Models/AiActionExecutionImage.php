<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * AI-ACTIONS-06: the outcome of attaching one approved image to a product. It is independent of the
 * product row — a product can succeed while one of its images fails — and a stored image is final.
 */
class AiActionExecutionImage extends BaseModel implements CompanyWide
{
    public const STATUS_PENDING = 'pending';
    public const STATUS_SUCCESS = 'success';
    public const STATUS_FAILED = 'failed';
    public const STATUS_SKIPPED = 'skipped';

    protected $fillable = [
        'tenant_id', 'ai_action_execution_id', 'ai_action_execution_row_id', 'ai_action_id', 'item_key',
        'ai_action_image_id', 'content_sha256', 'role', 'position', 'status', 'error_code', 'error_message',
        'retryable', 'attempts', 'product_media_id', 'started_at', 'finished_at',
    ];

    protected $casts = [
        'position' => 'integer',
        'retryable' => 'boolean',
        'attempts' => 'integer',
        'started_at' => 'datetime',
        'finished_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(function (self $image): void {
            if (in_array($image->getOriginal('status'), [self::STATUS_SUCCESS, self::STATUS_SKIPPED], true)) {
                throw new LogicException('A finished image result is final.');
            }
        });
        static::deleting(fn () => throw new LogicException('Image results are append-only.'));
    }

    public function row(): BelongsTo
    {
        return $this->belongsTo(AiActionExecutionRow::class, 'ai_action_execution_row_id');
    }
}
