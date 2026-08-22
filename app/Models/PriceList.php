<?php

namespace App\Models;

use App\Tenancy\BranchScope;
use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * قائمة أسعار يختارها موظف المبيعات يدوياً في مسودة الفاتورة.
 * لا تحمل إجمالياً ولا تنشئ قيداً؛ القيمة النهائية تبقى لقطة في سطر الفاتورة.
 */
class PriceList extends BaseModel implements CompanyWide
{
    use SoftDeletes;

    protected $fillable = [
        'tenant_id',
        'name',
        'description',
        'is_active',
    ];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    protected $attributes = [
        'is_active' => true,
    ];

    public function items(): HasMany
    {
        return $this->hasMany(PriceListItem::class);
    }

    /** العملاء قد يجعلونها اقتراحهم الافتراضي عند بدء فاتورة جديدة. */
    public function defaultPartners(): HasMany
    {
        return $this->hasMany(Partner::class, 'default_price_list_id')
            ->withoutGlobalScope(BranchScope::class);
    }

    /** الفواتير تحفظ المرجع لتظهر القائمة المختارة عند مراجعة المستند. */
    public function invoices(): HasMany
    {
        return $this->hasMany(Invoice::class);
    }
}
