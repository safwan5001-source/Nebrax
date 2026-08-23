<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** إعداد تكامل على مستوى منصة Nebrax؛ لا ينتمي إلى مستأجر. */
class PlatformIntegrationSetting extends Model
{
    use HasUuids;

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = [
        'integration_key',
        'provider',
        'enabled',
        'configuration',
        'configured_at',
        'updated_by',
    ];

    protected $hidden = ['configuration'];

    protected function casts(): array
    {
        return [
            'enabled' => 'boolean',
            'configuration' => 'encrypted:array',
            'configured_at' => 'immutable_datetime',
        ];
    }

    public function updater(): BelongsTo
    {
        return $this->belongsTo(PlatformAdministrator::class, 'updated_by');
    }
}
