<?php

namespace App\Tenancy;

use Closure;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Scope;

/**
 * Global Scope يعزل الاستعلامات بالفرع النشط — للبيانات **التشغيلية** فقط.
 *
 * ثلاث قواعد تحكمه:
 *  1. **لا يعمل إلا حين يكون سياق الفرع مضبوطاً** (كنمط TenantScope). فبلا سياق
 *     (أوامر artisan، مهام مجدولة، اختبارات وحدة) لا يُصفّى شيء.
 *  2. **يشمل صفوف `branch_id IS NULL`** — البيانات المنشأة قبل الفروع تبقى مرئية
 *     لكل الفروع، فلا تختفي بيانات قائمة عند تفعيل العزل.
 *  3. **يحترم مفاتيح المشاركة** — نموذج `BranchShareable` يُعفى كلياً أو جزئياً
 *     حسب ما يقرّره `branchSharingExemption()`.
 *
 * لا يُطبَّق على البيانات المحاسبية (سطور القيد): تصفيتها صريحة في التقارير حتى
 * يبقى ميزان المراجعة المجمّع شاملاً. انظر design-system/foundations/multi-branch-architecture.md
 */
class BranchScope implements Scope
{
    public function apply(Builder $builder, Model $model): void
    {
        $ctx = app(BranchContext::class);
        if (! $ctx->has()) {
            return;
        }

        $exemption = $model instanceof BranchShareable
            ? $model->branchSharingExemption(app(BranchSharing::class))
            : false;

        if ($exemption === true) {
            return; // مشترك بالكامل — كأنّ لا Scope على هذا النموذج
        }

        $table = $model->getTable();
        $builder->where(function (Builder $q) use ($table, $ctx, $exemption) {
            $q->where($table . '.branch_id', $ctx->id())
              ->orWhereNull($table . '.branch_id'); // بيانات ما قبل الفروع = مشتركة

            if ($exemption instanceof Closure) {
                $q->orWhere(fn (Builder $inner) => $exemption($inner)); // مشاركة جزئية
            }
        });
    }

    /**
     * استعلام **حلّ مرجع**: يتجاوز عزل الفرع عمداً.
     *
     * المستند القائم حجّة محاسبية؛ إخفاء مرجعه لا يحمي بيانات أحد — يُفسد قيداً
     * فقط (سطر فاتورة بلا منتج ⇒ قيد تكلفة البضاعة المباعة لا يُولَّد صامتاً).
     * التصفية بالفرع تحكم ما يُتصفَّح ويُختار، لا ما هو مخزَّن في مستند.
     *
     * @param  class-string<Model>  $modelClass
     */
    public static function reference(string $modelClass): Builder
    {
        return $modelClass::query()->withoutGlobalScope(static::class);
    }
}
