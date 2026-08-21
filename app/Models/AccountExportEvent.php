<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * أثر تدقيقي ثابت لتنزيل تصدير بيانات المؤسسة.
 *
 * لا يحفظ الملف أو محتواه، بل يثبت فقط من طلب التصدير ومتى تم، حتى لا تتسرّب
 * البيانات أو تتكدس نُسخ قديمة منها في التخزين. وهو مشترك للمؤسسة لا للفرع.
 */
class AccountExportEvent extends BaseModel implements CompanyWide
{
    public const CREATED_AT = null;
    public const UPDATED_AT = null;

    protected $fillable = [
        'tenant_id', 'user_id', 'file_name', 'ip_address', 'user_agent', 'generated_at',
    ];

    protected $casts = [
        'generated_at' => 'datetime',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
