<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

class CommercialProductVersionCapability extends Model
{
    use HasUuids;
    public $incrementing = false;
    public $timestamps = false;
    protected $keyType = 'string';
    protected $fillable = ['commercial_product_version_id', 'capability_key'];

    protected static function booted(): void
    {
        $guard = function (self $mapping): void {
            if ($mapping->productVersion()->whereNotNull('published_at')->exists()) {
                throw new LogicException('A published product composition is immutable.');
            }
        };
        static::creating($guard);
        static::updating($guard);
        static::deleting($guard);
    }

    public function productVersion(): BelongsTo { return $this->belongsTo(CommercialProductVersion::class); }
}
