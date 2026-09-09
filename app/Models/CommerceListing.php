<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * عرض تجاري لمنتج على قناة بيع واحدة — يفصل حقيقة المنتج الأساسية
 * (`Product`) عن عرضه/نشره التجاري حسب القناة. لا يخزّن سعراً ولا مخزوناً
 * ولا مخزن تنفيذ ولا أثراً محاسبياً: هذه كلها تعيش في وحداتها الأصلية
 * (PriceList لاحقاً، ProductWarehouseStock/InventoryReservation، Warehouse
 * عبر FulfillmentPolicy، Invoice/LedgerService).
 *
 * **`CompanyWide`**: تهيئة على مستوى المؤسسة، كـ`SalesChannel`/`FulfillmentPolicy`
 * أنفسهما — لا فرعاً بعينه.
 */
/** @see design-system/foundations/multi-branch-architecture.md — مشترك: عرضٌ تجاري تابع لقناة — العزل عبر القناة/المستأجر */
class CommerceListing extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'product_id', 'sales_channel_id', 'title', 'description', 'is_published',
    ];

    protected $casts = [
        'is_published' => 'boolean',
    ];

    protected $attributes = [
        'is_published' => false,
    ];

    /** مرجع مخزَّن — لا يُصفّى بالفرع أبداً (وإلا اختفى العرض عن قناة لا ترى فرع المنتج). */
    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }

    public function salesChannel(): BelongsTo
    {
        return $this->belongsTo(SalesChannel::class);
    }

    /**
     * العنوان الظاهر: تجاوز القناة إن وُجد، وإلا اسم المنتج (لا نسخ مخزَّن).
     */
    public function displayTitle(): string
    {
        return $this->title ?? $this->product->name;
    }

    /**
     * الوصف الظاهر: تجاوز القناة إن وُجد، وإلا وصف المنتج (قد يكون null أيضاً).
     */
    public function displayDescription(): ?string
    {
        return $this->description ?? $this->product->description;
    }
}
