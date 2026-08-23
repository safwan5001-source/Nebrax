<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

class CommercialProduct extends Model
{
    use HasUuids;

    public $incrementing = false;
    protected $keyType = 'string';
    protected $fillable = ['code', 'name'];

    protected static function booted(): void
    {
        static::updating(function (self $product): void {
            if ($product->isDirty('code')) {
                throw new LogicException('Commercial product identity is immutable.');
            }
        });
    }

    public function versions(): HasMany
    {
        return $this->hasMany(CommercialProductVersion::class);
    }
}
