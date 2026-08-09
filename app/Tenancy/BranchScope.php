<?php

namespace App\Tenancy;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Scope;

/**
 * Global Scope يعزل الاستعلامات بالفرع النشط — للبيانات **التشغيلية** فقط.
 *
 * قاعدتان تحكمانه:
 *  1. **لا يعمل إلا حين يكون سياق الفرع مضبوطاً** (كنمط TenantScope). فبلا سياق
 *     (أوامر artisan، مهام مجدولة، اختبارات وحدة) لا يُصفّى شيء.
 *  2. **يشمل صفوف `branch_id IS NULL`** — البيانات المنشأة قبل الفروع تبقى مرئية
 *     لكل الفروع، فلا تختفي بيانات قائمة عند تفعيل العزل.
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

        $table = $model->getTable();
        $builder->where(function (Builder $q) use ($table, $ctx) {
            $q->where($table . '.branch_id', $ctx->id())
              ->orWhereNull($table . '.branch_id'); // بيانات ما قبل الفروع = مشتركة
        });
    }
}
