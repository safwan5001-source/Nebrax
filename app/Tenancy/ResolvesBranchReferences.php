<?php

namespace App\Tenancy;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * علاقات **حلّ المراجع** — لا تُصفّى بالفرع أبداً.
 *
 * علاقات Eloquent تمرّ عبر الـ Global Scopes، فمنتجٌ لا يراه الفرع النشط يُرجع
 * `null` من `$line->product` **بلا استثناء** — والمسار المحاسبي يتعامل مع null
 * بـ `continue` فيتخطّى قيد التكلفة صامتاً. هذا الـ trait يقفل ذلك الباب.
 *
 * استخدمه في سطور المستندات ورؤوسها لكل مرجع مخزَّن:
 *
 *     public function product(): BelongsTo
 *     {
 *         return $this->referenceBelongsTo(Product::class);
 *     }
 *
 * @see design-system/foundations/multi-branch-architecture.md — «تصفّح مقابل مرجع»
 */
trait ResolvesBranchReferences
{
    /**
     * `belongsTo` بلا عزل فرع. يستنتج اسم العلاقة من الدالة المُستدعية تماماً
     * كما يفعل Eloquent، فتُشتقّ منه المفاتيح الأجنبية كالمعتاد.
     */
    protected function referenceBelongsTo(
        string $related,
        ?string $foreignKey = null,
        ?string $ownerKey = null,
        ?string $relation = null,
    ): BelongsTo {
        $relation ??= debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 2)[1]['function'] ?? null;

        return $this->belongsTo($related, $foreignKey, $ownerKey, $relation)
            ->withoutGlobalScope(BranchScope::class);
    }
}
