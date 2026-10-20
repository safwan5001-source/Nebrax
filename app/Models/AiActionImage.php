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
        'storage_profile', 'storage_key', 'thumb_key', 'thumb_mime', 'created_by',
    ];

    protected $casts = ['archive_seq' => 'integer', 'size_bytes' => 'integer', 'width' => 'integer', 'height' => 'integer'];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Staged AI action images are immutable.'));
        static::deleting(fn () => throw new LogicException('Staged AI action images are immutable.'));
    }

    public function action(): BelongsTo
    {
        return $this->belongsTo(AiAction::class, 'ai_action_id');
    }
}
