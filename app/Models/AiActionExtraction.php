<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

class AiActionExtraction extends BaseModel implements CompanyWide
{
    public $timestamps = false;

    protected $fillable = [
        'tenant_id', 'ai_action_file_id', 'ai_action_id', 'action_version',
        'schema_version', 'manifest', 'manifest_hash', 'created_by', 'created_at',
    ];

    protected $casts = [
        'action_version' => 'integer',
        'schema_version' => 'integer',
        'manifest' => 'array',
        'created_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('AI action extraction manifests are immutable.'));
        static::deleting(fn () => throw new LogicException('AI action extraction manifests are immutable.'));
    }

    public function file(): BelongsTo
    {
        return $this->belongsTo(AiActionFile::class, 'ai_action_file_id');
    }

    public function action(): BelongsTo
    {
        return $this->belongsTo(AiAction::class, 'ai_action_id');
    }
}
