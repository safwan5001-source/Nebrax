<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Closure;
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
        } catch (RuntimeException $e) {
            abort(422, $e->getMessage());
        }
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
