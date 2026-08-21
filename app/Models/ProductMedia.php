<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * وسائط خاصة ببطاقة المنتج (صور فقط في هذه المرحلة).
 *
 * المسار الداخلي لا يظهر في API؛ تُستدعى الوسائط من خلال مسار تنزيل محروس
 * يثبت تبعيتها للمنتج والمستأجر أولاً.
 */
class ProductMedia extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'product_id', 'disk', 'path', 'original_name',
        'mime_type', 'size', 'sort_order', 'uploaded_by',
    ];

    protected $casts = [
        'size' => 'integer',
        'sort_order' => 'integer',
    ];

    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }

    public function uploader(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'uploaded_by');
    }
}
