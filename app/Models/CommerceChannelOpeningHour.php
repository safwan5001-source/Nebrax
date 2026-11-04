<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * فترة ساعات عمل أسبوعية لقناة ويب (COPS-H4-3، D-OPS-7/D-H4-01): صف لكل فترة، `CompanyWide`. **غياب كل صفوف القناة = مفتوحة 24/7** (السلوك الحالي).
 * يوم الأسبوع 0=الأحد..6=السبت؛ البداية/النهاية «HH:MM» بتوقيت القناة (النهاية حتى «24:00»). الكاتب الوحيد `CommerceChannelOperationsSettingsService`
 * (يستبدل مجموعة الفترات كاملةً داخل معاملة الإعداد نفسها وبنسختها) — لذلك لا شيء في `$fillable`.
 */
class CommerceChannelOpeningHour extends BaseModel implements CompanyWide
{
    protected $table = 'commerce_channel_opening_hours';

    /** عمداً فارغ: الكتابة عبر الخدمة بـforceFill فقط. */
    protected $fillable = [];

    protected function casts(): array
    {
        return ['weekday' => 'integer'];
    }

    public function channel(): BelongsTo
    {
        return $this->belongsTo(SalesChannel::class, 'sales_channel_id');
    }
}
