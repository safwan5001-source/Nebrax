<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/**
 * رأس سلسلة ZATCA المشتركة (ICV/PIH) لمستأجر — REM-18b-1 (مخطط فقط).
 *
 * `CompanyWide`: السلسلة تخصّ الكيان القانوني (الرقم الضريبي المسجَّل) لا فرعاً. لا يقرأ هذا النموذج ولا يكتبه أي مسار قائم؛
 * المخصِّص (REM-18b-2) هو الكاتب الوحيد لاحقاً. ثوابت القاعدة (T4–T7: تقدّم +1 بمدخل مقابل، بذرة صحيحة، منع الحذف و
 * TRUNCATE) هي الحارس الفعلي؛ حارس النموذج رسالة أوضح قبل الوصول إليها فقط.
 */
class ZatcaChain extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'chain_key', 'last_icv', 'seed_icv', 'seed_legacy_count', 'seed_excluded_null_icv', 'seeded_at',
    ];

    protected function casts(): array
    {
        return [
            'last_icv' => 'integer',
            'seed_icv' => 'integer',
            'seed_legacy_count' => 'integer',
            'seed_excluded_null_icv' => 'integer',
            'seeded_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        static::deleting(fn () => throw new LogicException('رأس سلسلة ZATCA لا يُحذف.'));
    }

    public function entries(): HasMany
    {
        return $this->hasMany(ZatcaChainEntry::class, 'chain_id');
    }
}
