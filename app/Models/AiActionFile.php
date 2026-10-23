<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;
use LogicException;

class AiActionFile extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id', 'ai_action_id', 'action_version', 'original_name', 'extension',
        'content_type', 'size_bytes', 'content_sha256', 'storage_profile', 'storage_key', 'uploaded_by',
    ];

    protected $casts = [
        'action_version' => 'integer',
        'size_bytes' => 'integer',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('AI action source files are immutable.'));
        static::deleting(fn () => throw new LogicException('AI action source files are immutable.'));
    }

    public function action(): BelongsTo
    {
        return $this->belongsTo(AiAction::class, 'ai_action_id');
    }

    public function extraction(): HasOne
    {
        return $this->hasOne(AiActionExtraction::class);
    }
}
