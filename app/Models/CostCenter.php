<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\HasMany;

class CostCenter extends BaseModel
{
    protected $fillable = [
        'tenant_id', 'code', 'name', 'is_active',
    ];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    public function lines(): HasMany
    {
        return $this->hasMany(JournalLine::class);
    }
}
