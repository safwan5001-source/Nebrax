<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

class CommercialProductVersion extends Model
{
    use HasUuids;

    public $incrementing = false;
    protected $keyType = 'string';
    protected $fillable = ['commercial_product_id', 'version'];
    protected function casts(): array { return ['version' => 'integer', 'published_at' => 'immutable_datetime']; }

    protected static function booted(): void
    {
        static::updating(function (self $version): void {
            if ($version->getOriginal('published_at') !== null) {
                throw new LogicException('Published commercial product versions are immutable.');
            }
        });
        static::deleting(function (self $version): void {
            if ($version->published_at !== null) {
                throw new LogicException('Published commercial product versions cannot be deleted.');
            }
        });
    }

    public function product(): BelongsTo { return $this->belongsTo(CommercialProduct::class, 'commercial_product_id'); }
    public function capabilities(): HasMany { return $this->hasMany(CommercialProductVersionCapability::class); }
}
