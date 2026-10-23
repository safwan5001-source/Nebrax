<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * AI-ACTIONS-06: a product image that passed every security check and sits in private storage, bound
 * to one AI action. It is evidence of what the user was shown and approved (identity = content SHA-256),
 * not a product image: nothing here is visible to the storefront or attached to a product.
 */
class AiActionImage extends BaseModel implements CompanyWide
{
    public const KIND_ARCHIVE = 'archive';
    public const KIND_URL = 'url';

    protected $fillable = [
        'tenant_id', 'ai_action_id', 'source_kind', 'source_key', 'source_label', 'archive_sha256', 'archive_seq',
        'content_sha256', 'mime_type', 'extension', 'size_bytes', 'width', 'height',
        'storage_profile', 'storage_key', 'thumb_key', 'thumb_mime', 'purged_at', 'created_by',
    ];

    protected $casts = ['archive_seq' => 'integer', 'size_bytes' => 'integer', 'width' => 'integer', 'height' => 'integer', 'purged_at' => 'datetime'];

    protected static function booted(): void
    {
        // Immutable evidence of what a preview named — except for the one fact the retention job records: when the
        // private bytes were purged. Nothing else may change, and a purge can never be undone.
        static::updating(function (self $image): void {
            $changed = array_keys($image->getDirty());
            if ($image->getOriginal('purged_at') !== null || array_diff($changed, ['purged_at', 'updated_at']) !== []) {
                throw new LogicException('Staged AI action images are immutable.');
            }
        });
        static::deleting(fn () => throw new LogicException('Staged AI action images are immutable.'));
    }

    public function isPurged(): bool
    {
        return $this->purged_at !== null;
    }

    public function action(): BelongsTo
    {
        return $this->belongsTo(AiAction::class, 'ai_action_id');
    }
}
