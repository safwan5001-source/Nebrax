<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * سجل أحداث بطاقة المنتج أو الخدمة.
 *
 * لا يحمل أثراً محاسبياً ولا يبدل حقيقة المخزون؛ دوره أن يبقى تغيّر الكتالوج
 * مرئياً وقابلاً للمراجعة حتى بعد تعطيل المنتج أو حذفه حذفاً ناعماً.
 */
class ProductActivity extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'product_id', 'action', 'diff', 'user_id',
    ];

    protected $casts = [
        'diff' => 'array',
    ];

    /** يرتّب الأحداث المتتابعة في الثانية الواحدة بلا التباس. */
    protected $dateFormat = 'Y-m-d H:i:s.u';

    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }

    /** الفاعل مرجع تاريخي؛ لا تحجبه تصفية الفرع عن سجل الكتالوج. */
    public function user(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class);
    }
}
