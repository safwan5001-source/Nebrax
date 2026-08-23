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
    protected function casts(): array
    {
        return [
            'version' => 'integer',
            'published_at' => 'immutable_datetime',
            'retired_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(function (self $version): void {
            if ($version->isDirty(['plan_code', 'version'])) {
                throw new LogicException('Commercial plan version identity is immutable.');
            }

            if ($version->getOriginal('published_at') !== null && array_diff(array_keys($version->getDirty()), ['retired_at']) !== []) {
                throw new LogicException('Published commercial plan versions are immutable.');
            }

            if ($version->isDirty('retired_at')) {
                if ($version->getOriginal('published_at') === null) {
                    throw new LogicException('Only published commercial plan versions may be retired.');
                }
                if ($version->getOriginal('retired_at') !== null) {
                    throw new LogicException('Retired commercial plan versions cannot change lifecycle state.');
                }
            }
        });
        static::deleting(function (self $version): void {
            if ($version->published_at !== null) throw new LogicException('Published commercial plan versions cannot be deleted.');
        });
    }

    public function products(): HasMany { return $this->hasMany(CommercialPlanVersionProduct::class); }
}
