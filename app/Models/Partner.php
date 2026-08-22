<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use App\Tenancy\BranchShareable;
use App\Tenancy\BranchSharing;
use App\Tenancy\ResolvesBranchReferences;
use Closure;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * طرف تجاري: عميل أو مورد (أو كلاهما).
 * بيانات أساسية تُربط بسطور القيد عبر (partner_type, partner_id) لكشوف الحساب.
 */
/**
 * @see design-system/foundations/multi-branch-architecture.md
 * تشغيلي بعزل **مشروط بمفتاحين**: العملاء ومفتاحهم، الموردون ومفتاحهم.
 * المراجع المخزَّنة في المستندات تُحلّ خارج العزل عبر `referenceBelongsTo`.
 */
class Partner extends BaseModel implements BranchShareable
{
    use BranchScoped;
    use ResolvesBranchReferences;
    use SoftDeletes;

    protected $fillable = [
        'tenant_id', 'branch_id', 'code', 'type', 'entity_type', 'name', 'name_en',
        'vat_number', 'cr_number', 'email', 'phone', 'mobile', 'address', 'city',
        'building_no', 'street', 'district', 'postal_code', 'country',
        'classification', 'customer_classification_id', 'supplier_classification_id', 'default_price_list_id', 'credit_limit', 'credit_period', 'is_active',
    ];

    protected $casts = [
        'is_active'     => 'boolean',
        'credit_limit'  => 'integer',
        'credit_period' => 'integer',
    ];

    protected $attributes = [
        'type'        => 'customer',
        'entity_type' => 'commercial',
        'is_active'   => true,
    ];

    /** قائمة سعر مشتركة تقترح للعميل عند إنشاء فاتورة جديدة؛ لا تعيد تسعير مستند محفوظ. */
    public function defaultPriceList(): BelongsTo
    {
        return $this->referenceBelongsTo(PriceList::class, 'default_price_list_id');
    }

    /** مرجع تحليلي محفوظ؛ لا يختفي عند تبديل سياق الفرع. */
    public function customerClassification(): BelongsTo
    {
        return $this->referenceBelongsTo(Classification::class, 'customer_classification_id');
    }

    /** مرجع تحليلي محفوظ؛ لا يختفي عند تبديل سياق الفرع. */
    public function supplierClassification(): BelongsTo
    {
        return $this->referenceBelongsTo(Classification::class, 'supplier_classification_id');
    }

    public function isCustomer(): bool
    {
        return in_array($this->type, ['customer', 'both'], true);
    }

    public function isSupplier(): bool
    {
        return in_array($this->type, ['supplier', 'both'], true);
    }

    /**
     * الطرف كيان واحد بمفتاحَي مشاركة — فالإعفاء **حسب النوع**:
     *
     *  • المفتاحان مفعّلان  ⇒ مشترك بالكامل (الافتراضي — لا تصفية إطلاقاً).
     *  • المفتاحان مطفآن    ⇒ عزل كامل.
     *  • واحد فقط مفعّل     ⇒ إعفاء **جزئي**: أنواع ذلك المفتاح وحدها تُستثنى،
     *    و`both` معها لأنه يحمل الصفتين — فمشاركةُ صفةٍ تكفي لإظهاره.
     */
    public function branchSharingExemption(BranchSharing $sharing): bool|Closure
    {
        $customers = $sharing->shared('share_customers');
        $suppliers = $sharing->shared('share_suppliers');

        if ($customers && $suppliers) {
            return true;
        }
        if (! $customers && ! $suppliers) {
            return false;
        }

        $types = $customers ? ['customer', 'both'] : ['supplier', 'both'];

        return fn (Builder $q) => $q->whereIn('partners.type', $types);
    }
}
