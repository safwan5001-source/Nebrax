<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ZatcaCredential extends BaseModel
{
    protected $fillable = [
        'environment', 'stage', 'status', 'credentials',
        'certificate_fingerprint', 'configured_at', 'expires_at', 'updated_by',
    ];

    protected $hidden = ['credentials'];

    protected function casts(): array
    {
        return [
            'credentials' => 'encrypted:array',
            'configured_at' => 'immutable_datetime',
            'expires_at' => 'immutable_datetime',
        ];
    }

    public function updater(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }
}
