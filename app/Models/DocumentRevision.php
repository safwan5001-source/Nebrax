<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;

/**
 * قيد في سجلّ تغييرات مستند — يُكتب مرّة ولا يُعدَّل.
 *
 * لا أثر محاسبي: لا يمسّ قيداً ولا رصيداً. غرضه أن تكون التغييرات الصامتة
 * على المسوّدات **مرئية** — وهي المنطقة التي لا تحرسها قاعدة الـ immutability.
 */
/** @see design-system/foundations/multi-branch-architecture.md — مشترك: سجلّ تابع لمستند — يتبع فرع رأسه */
class DocumentRevision extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    /** سجلّ لا يُعدَّل: لا `updated_at` له معنى، لكن نُبقيه لبساطة الجدول. */
    protected $fillable = [
        'tenant_id', 'document_type', 'document_id', 'action', 'diff', 'user_id',
    ];

    protected $casts = ['diff' => 'array'];

    /** ميكروثانية — يرتّب الخطّ الزمني قيوداً تقع في الثانية نفسها. */
    protected $dateFormat = 'Y-m-d H:i:s.u';

    public function document(): MorphTo
    {
        return $this->morphTo();
    }

    /** مرجع مخزَّن — لا يُصفّى بالفرع (المستخدم قد يكون من فرع آخر). */
    public function user(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class);
    }
}
