<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

class CommercialPlanVersion extends Model
{
    use HasUuids;
    public $incrementing = false;
    protected $keyType = 'string';
    protected $fillable = ['plan_code', 'version'];
    protected function casts(): array { return ['version' => 'integer', 'published_at' => 'immutable_datetime']; }

    protected static function booted(): void
    {
        static::updating(function (self $version): void {
            if ($version->getOriginal('published_at') !== null) throw new LogicException('Published commercial plan versions are immutable.');
        });
        static::deleting(function (self $version): void {
            if ($version->published_at !== null) throw new LogicException('Published commercial plan versions cannot be deleted.');
        });
    }

    public function products(): HasMany { return $this->hasMany(CommercialPlanVersionProduct::class); }
}
