<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

class CommercialPlanVersionProduct extends Model
{
    use HasUuids;
    public $incrementing = false;
    public $timestamps = false;
    protected $keyType = 'string';
    protected $fillable = ['commercial_plan_version_id', 'commercial_product_version_id'];

    protected static function booted(): void
    {
        $guard = function (self $mapping): void {
            if ($mapping->planVersion()->whereNotNull('published_at')->exists()) throw new LogicException('A published plan composition is immutable.');
        };
        static::creating($guard); static::updating($guard); static::deleting($guard);
    }

    public function planVersion(): BelongsTo { return $this->belongsTo(CommercialPlanVersion::class); }
    public function productVersion(): BelongsTo { return $this->belongsTo(CommercialProductVersion::class); }
}
