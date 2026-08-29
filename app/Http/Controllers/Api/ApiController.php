<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Warehouse;
use App\Tenancy\BranchContext;
use Closure;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use PDOException;
use RuntimeException;

abstract class ApiController extends Controller
{
    /**
     * ينفّذ منطق نطاق ويحوّل أخطاء العمل (RuntimeException) إلى استجابة 422 موحّدة.
     * أخطاء قاعدة البيانات (QueryException ترث PDOException ترث RuntimeException)
     * تُعاد رمياً كي لا يتسرّب نص SQL للعميل — تصلها معالجة 500 القياسية.
     */
    protected function domain(Closure $fn): mixed
    {
        try {
            return $fn();
        } catch (PDOException $e) {
            throw $e;
        } catch (\App\Services\Pos\PosIdempotencyConflictException $e) {
            // تعارض idempotency → 409 من المتحكّم، لا 422 عام.
            throw $e;
        } catch (RuntimeException $e) {
            abort(422, $e->getMessage());
        }
    }

    /**
     * ═══════════════════════════════════════════════════════════════
     *  تصفية قائمة مستندات بالفرع النشط — **صريحة، لا Global Scope**
     * ═══════════════════════════════════════════════════════════════
     *  المستندات المحاسبية مصنَّفة `BelongsToBranch`: موسومة بالفرع بلا Scope
     *  عالمي، حفاظاً على شمول ميزان المراجعة المجمّع (لو صُفّيت تلقائياً
     *  لاختفت قيود صامتةً). فتصفية **العرض** تتمّ هنا في المتحكّم وحده،
     *  ولا تمسّ `ReportService` ولا أي حساب محاسبي.
     *
     *  ثلاث قواعد:
     *   1. الافتراضي = الفرع النشط. `?branch=all` يُظهر كل الفروع صراحةً.
     *   2. تشمل `branch_id IS NULL` — بيانات ما قبل الفروع تبقى مرئية للجميع.
     *   3. بلا سياق فرع (مؤسسة بفرع واحد، أوامر artisan) لا تصفية إطلاقاً.
     */
    protected function scopeToActiveBranch(Builder $query, Request $request): Builder
    {
        $table   = $query->getModel()->getTable();
        $allowed = $request->user()?->allowedBranchIds();

        // «كل الفروع» تعني كلَّ **ما يملكه المستخدم** لا كلَّ ما في المؤسسة:
        // القيد على المستخدم لا يُرفَع بمعاملٍ في الرابط.
        if ($request->query('branch') === 'all') {
            return $allowed === null ? $query : $this->whereBranchIn($query, $table, $allowed);
        }

        $branchId = app(BranchContext::class)->id();

        if ($branchId === null) {
            return $allowed === null ? $query : $this->whereBranchIn($query, $table, $allowed);
        }

        return $this->whereBranchIn($query, $table, [$branchId]);
    }

    /**
     * تصفية بفروع محدَّدة **مع إبقاء الصفوف بلا فرع مرئية**.
     *
     * `branch_id` الفارغ يعني «ما قبل الفروع» أو ما أُنشئ بلا سياق (أوامر
     * artisan، مهامّ مجدولة) — وهو مشترك بطبيعته. إخفاؤه كان سيُخفي بيانات
     * قائمة عن كل مستخدم بمجرّد تفعيل التقييد، وهو ضررٌ أكبر من الذي يدفعه.
     */
    private function whereBranchIn(Builder $query, string $table, array $branchIds): Builder
    {
        return $query->where(function (Builder $q) use ($table, $branchIds) {
            $q->whereIn($table . '.branch_id', $branchIds)
              ->orWhereNull($table . '.branch_id');
        });
    }

    /**
     * يتحقق من أن المخزن موجود داخل المستأجر ونشط ومتاح للمستخدم.
     *
     * القائمة المصفّاة تُحسن التجربة فقط؛ الحارس يمنع حقن معرّف من مستأجر آخر أو
     * من فرع لا يراه المستخدم أو من مخزن موقوف. المخزن المركزي بلا فرع يمرّ عبر
     * قيد المستودع نفسه، فلا يُرفض لمجرد عدم حمله `branch_id`.
     */
    protected function assertWarehouseAllowed(
        ?string $warehouseId,
        ?string $branchId = null,
        bool $resolveImplicitWarehouse = true,
    ): void {
        // يبقى اختيار المخزن اختيارياً في حفظ المسودات. لا نحلّ افتراضاً لم
        // يختَره المستخدم إلا عند ترحيل حركة مخزون فعلية، حيث يجب فحص صلاحيته.
        if ($warehouseId === null && ! $resolveImplicitWarehouse) {
            return;
        }

        $warehouse = $warehouseId === null
            ? ($branchId === null
                ? Warehouse::default()
                : Warehouse::where('branch_id', $branchId)->where('is_active', true)
                    ->orderByDesc('is_default')->orderBy('code')->first() ?? Warehouse::default())
            : Warehouse::whereKey($warehouseId)->first();

        // المعرّف الصريح غير المرئي في TenantScope محاولةٌ لمعرفة/حقن مخزن أجنبي.
        if ($warehouseId !== null && ! $warehouse) {
            abort(422, 'المستودع غير موجود.');
        }
        // منشأة لم تنشئ مخازن بعد تبقى متوافقة مع الحركات التاريخية بلا موقع كمية.
        if (! $warehouse) {
            return;
        }
        if (! $warehouse->is_active) {
            abort(422, 'المستودع المحدد غير نشط.');
        }

        $user = request()->user();
        if (! $user?->canAccessWarehouse($warehouse->id)
            || ($warehouse->branch_id !== null && ! $user->canAccessBranch($warehouse->branch_id))) {
            abort(422, 'هذا المستودع خارج نطاق صلاحياتك.');
        }
    }

    /** الفرع النشط الذي سيسم المستندات الجديدة عبر BelongsToBranch. */
    protected function activeBranchId(): ?string
    {
        return app(BranchContext::class)->id();
    }

    /**
     * تحقق ملكية مرجع داخل المستأجر: المعرّف (إن وُجد) يجب أن يعود لنموذج
     * يراه الـ TenantScope الحالي — يصدّ حقن معرّفات مستأجرين آخرين أو معرّفات وهمية.
     *
     * @param  class-string<\Illuminate\Database\Eloquent\Model>  $model
     */
    protected function assertTenantOwned(string $model, ?string $id, string $label): void
    {
        if ($id !== null && ! $model::whereKey($id)->exists()) {
            abort(422, "{$label} غير موجود.");
        }
    }

    /**
     * تحقق ملكية مجموعة معرّفات (سطور المستندات) داخل المستأجر دفعة واحدة.
     *
     * @param  class-string<\Illuminate\Database\Eloquent\Model>  $model
     * @param  array<int, string|null>  $ids
     */
    protected function assertTenantOwnedAll(string $model, array $ids, string $label): void
    {
        $ids = array_values(array_unique(array_filter($ids)));
        if ($ids && $model::whereKey($ids)->count() !== count($ids)) {
            abort(422, "{$label} غير موجود.");
        }
    }
}
