<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * رصيد افتتاحي للمخزون — نقطة الصفر التي يبدأ منها الدفتر الدائم.
 *
 * ليس تسويةَ جرد ولا إذنَ إضافة: يُسجَّل مرّةً واحدة للصنف قبل أن تكون له أي
 * حركة. الترحيل يحرّك الكميات والمتوسط ويولّد **قيداً واحداً** للمستند كلّه
 * في المعاملة نفسها، فلا ينفصل حساب المراقبة 1140 عن دفتر المخزون المساعد.
 */
/**
 * @see design-system/foundations/multi-branch-architecture.md
 * **مشترك عن قصد لا عن إغفال:** المستند الواحد يضمّ مخازن من فروع مختلفة
 * ومخزناً مركزياً بلا فرع، فوسمُه بفرعٍ واحد ملكيّةٌ كاذبة تنسب أرصدة فرعٍ
 * لغيره. بُعد الفرع يعيش على حركة المخزون (من فرع مخزنها) وعلى سطور القيد
 * (مجمَّعة بفرع المخزن) — حيث يصحّ فعلاً.
 */
class InventoryOpening extends BaseModel implements CompanyWide
{
    use GeneratesDocumentNumbers;
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'number', 'opening_date', 'status', 'notes', 'source_filename',
        'allow_zero_cost', 'total_quantity', 'total_value',
        'journal_entry_id', 'created_by', 'posted_by', 'posted_at',
    ];

    protected $casts = [
        'opening_date'    => 'date',
        'allow_zero_cost' => 'boolean',
        'total_quantity'  => 'integer',
        'total_value'     => 'integer',
        'posted_at'       => 'datetime',
    ];

    protected $attributes = [
        'status'          => 'draft',
        'allow_zero_cost' => false,
        'total_quantity'  => 0,
        'total_value'     => 0,
    ];

    public function lines(): HasMany
    {
        return $this->hasMany(InventoryOpeningLine::class)->orderBy('position');
    }

    public function journalEntry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class);
    }

    public function isDraft(): bool
    {
        return $this->status === 'draft';
    }

    public function isPosted(): bool
    {
        return $this->status === 'posted';
    }
}
