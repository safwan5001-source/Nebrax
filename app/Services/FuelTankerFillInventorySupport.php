<?php

namespace App\Services;

use App\Models\FuelProduct;
use App\Models\FuelStation;
use App\Models\FuelTankerFill;
use App\Models\ProductWarehouseStock;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\AccountingPeriodLockedException;
use App\Tenancy\BranchContext;
use App\Tenancy\BranchScope;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

/**
 * TANKER-PR6B-4 — الدوال المشتركة بين **خدمتَي الترحيل والعكس** لسند تعبئة الصهريج (استُخرجت من `FuelTankerFillInventoryPostingService` بلا تغيير في السلوك):
 * البوابات الثلاث، الصلاحية، نطاق المحطة/الفرع، تنظيف السبب، المخزن/المنتج، قفل الرصيد، سياسة مطابقة المجمّع والأستاذ، تحويل الأخطاء وتسجيل المحاولة الفاشلة.
 * المستعمل يعرّف `attemptOperation()` (`post|reverse`) و`attemptKeyPrefix()` ويملك الخصائص `$settings` و`$reconciliation`.
 */
trait FuelTankerFillInventorySupport
{
    abstract private function attemptOperation(): string;

    abstract private function attemptKeyPrefix(): string;

    private function assertEnabled(): void
    {
        if (! self::enabled()) {
            throw new FuelTankerFillException(FuelTankerFillException::POSTING_DISABLED, 'ترحيل سندات التعبئة مخزنياً غير مفعَّل.', 404);
        }
    }

    private function requirePermission(User $actor, string $permission): void
    {
        if (! $actor->hasPermission($permission)) {
            throw new FuelTankerFillException(FuelTankerFillException::FORBIDDEN, 'لا تملك صلاحية تنفيذ هذه العملية.', 403);
        }
    }

    private function accessible(FuelStation $station, User $actor): bool
    {
        if (! $actor->canAccessFuelStation($station)) {
            return false;
        }
        $branchId = app(BranchContext::class)->id();

        return $branchId === null || $station->branch_id === $branchId;
    }

    private function notFound(): FuelTankerFillException
    {
        return new FuelTankerFillException(FuelTankerFillException::NOT_FOUND, 'السجل غير موجود.', 404);
    }

    private function cleanReason(mixed $reason): ?string
    {
        $reason = trim((string) $reason);
        if ($reason === '') {
            return null;
        }
        if (mb_strlen($reason) > self::REASON_MAX) {
            throw new FuelTankerFillException(FuelTankerFillException::INVALID_INPUT, 'السبب أطول من الحد المسموح (500 حرف).');
        }

        return $reason;
    }

    private function warehouse(FuelStation $station): Warehouse
    {
        if ($station->warehouse_id === null) {
            throw new FuelTankerFillException(FuelTankerFillException::POSTING_BLOCKED, 'المحطة بلا مخزن معيّن.', 422, ['blockers' => [FuelTankerFillInventoryReadiness::B_WAREHOUSE_REQUIRED]]);
        }
        $warehouse = Warehouse::query()->whereKey($station->warehouse_id)->first();
        if ($warehouse === null || $warehouse->tenant_id !== $station->tenant_id || ! $warehouse->is_active || ($warehouse->branch_id !== null && $warehouse->branch_id !== $station->branch_id)) {
            throw new FuelTankerFillException(FuelTankerFillException::POSTING_BLOCKED, 'مخزن المحطة غير صالح.', 422, ['blockers' => [FuelTankerFillInventoryReadiness::B_WAREHOUSE_UNAVAILABLE]]);
        }

        return $warehouse;
    }

    private function fuelProduct(string $id): FuelProduct
    {
        $fuelProduct = FuelProduct::query()->find($id);
        if ($fuelProduct === null || ! $fuelProduct->is_active || $fuelProduct->product_id === null) {
            throw new FuelTankerFillException(FuelTankerFillException::POSTING_BLOCKED, 'منتج الوقود غير صالح أو معطل.', 422, ['blockers' => [FuelTankerFillInventoryReadiness::B_PRODUCT_UNAVAILABLE]]);
        }

        return $fuelProduct;
    }

    private function product(FuelProduct $fuelProduct): \App\Models\Product
    {
        $product = BranchScope::reference(\App\Models\Product::class)->find($fuelProduct->product_id);
        if ($product === null || ! $product->is_active || ! $product->track_inventory) {
            throw new FuelTankerFillException(FuelTankerFillException::POSTING_BLOCKED, 'منتج الوقود المرتبط يجب أن يكون نشطاً ومتابعاً مخزنياً.', 422, ['blockers' => [FuelTankerFillInventoryReadiness::B_PRODUCT_UNAVAILABLE]]);
        }

        return $product;
    }

    private function lockBookStock(string $warehouseId, string $productId): void
    {
        // المنتج `NO KEY UPDATE` (لا `FOR UPDATE`: بيع ERP يأخذ KEY SHARE عليه بعد المِرساة) ثم صف الرصيد — كمسار التسوية.
        BranchScope::reference(\App\Models\Product::class)->lock('for no key update')->findOrFail($productId);
        ProductWarehouseStock::query()->where('warehouse_id', $warehouseId)->where('product_id', $productId)->whereNull('product_variant_id')->lockForUpdate()->first();
    }

    private function bookBalance(string $warehouseId, string $productId): int
    {
        return (int) (ProductWarehouseStock::query()->where('warehouse_id', $warehouseId)->where('product_id', $productId)->whereNull('product_variant_id')->value('quantity') ?? 0);
    }

    /**
     * `fuel_pool_ledger_variance_policy`: `block` (الافتراضي) يمنع الترحيل عند أي فرق مثبَّت بين المجمّع والأستاذ يخص هذا المجمّع أو فرعه (كمية المجمّع/حالته/تاريخ التكلفة المفتوح،
     * فرق قيمة الفرع، قيد لا يطابق حركاته)؛ `warn` يسمح بلا فحص (الانحراف سابق للترحيل ومستقل عنه: الترحيل يحرّك الطرفين بالمبلغ نفسه). المطابقة قراءة فقط تحت الأقفال نفسها.
     */
    private function assertLedgerVariancePolicy(string $policy, Warehouse $warehouse, FuelProduct $fuelProduct, FuelStation $station): void
    {
        if ($policy !== 'block') {
            return;
        }
        $report = $this->reconciliation->reconcile([$warehouse->id], [$station->branch_id], true, true);
        $relevant = collect($report['findings'])->filter(function (array $finding) use ($warehouse, $fuelProduct, $station) {
            $code = $finding['code'] ?? '';
            if (isset($finding['warehouse_id'])) {
                return $finding['warehouse_id'] === $warehouse->id && ($finding['fuel_product_id'] ?? null) === $fuelProduct->id;
            }

            // فرق قيمة الفرع (خطأ) وقيد لا يطابق حركاته (خطأ). **`movements_without_journal` تحذير لا يمنع**: حركة صفرية القيمة (فقد جزء من هللة) بلا قيد مشروعة، وأي حركة بقيمة غير صفرية بلا قيد
            // تُظهر `value_difference` فتُمنع به.
            return $code === FuelInventoryLedgerReconciliation::F_VALUE_DIFFERENCE
                ? ($finding['branch_id'] ?? null) === $station->branch_id
                : $code === FuelInventoryLedgerReconciliation::F_ENTRY_AMOUNT_DIFFERS;
        })->pluck('code')->unique()->values()->all();
        if ($relevant !== []) {
            throw new FuelTankerFillException(FuelTankerFillException::LEDGER_VARIANCE_BLOCKED, 'يوجد فرق بين مجمّع تكلفة الوقود والأستاذ؛ يُعالج قبل الترحيل (سياسة الانحراف: block).', 422, ['findings' => $relevant]);
        }
    }

    private function toDomain(Throwable $exception): FuelTankerFillException
    {
        if ($exception instanceof FuelTankerFillException) {
            return $exception;
        }
        if ($exception instanceof AccountingPeriodLockedException) {
            return new FuelTankerFillException(FuelTankerFillException::PERIOD_LOCKED, $exception->getMessage() ?: 'الفترة المحاسبية مقفلة.', 422, ['blockers' => [FuelTankerFillInventoryReadiness::B_PERIOD_LOCKED]]);
        }
        if ($exception instanceof RuntimeException) {
            $code = preg_match('/^([A-Z][A-Z0-9_]{3,}):/', $exception->getMessage(), $m) === 1 ? strtolower($m[1]) : null;

            return new FuelTankerFillException(FuelTankerFillException::POSTING_FAILED, $exception->getMessage(), 422, $code === null ? [] : ['code' => $code]);
        }
        // أخطاء غير متوقعة (قاعدة بيانات/برمجية): لا تُسرَّب تفاصيلها؛ تُسجَّل للتشخيص.
        Log::error('tanker fill inventory operation failed unexpectedly', ['exception' => $exception::class, 'message' => $exception->getMessage()]);

        return new FuelTankerFillException(FuelTankerFillException::POSTING_FAILED, 'تعذّر ترحيل السند؛ لم يُكتب أي أثر.', 500);
    }

    /** يُسجَّل بعد التراجع الكامل وفي معاملة منفصلة؛ لا يُفشل الرد ولا يحوي مبالغ. */
    private function recordFailedAttempt(FuelTankerFill $fill, FuelStation $station, User $actor, FuelTankerFillException $exception): void
    {
                if (in_array($exception->status, [403, 404], true)) {
            return; // لا صلاحية (بما فيها صلاحية التاريخي) أو خارج النطاق أو بوابة مغلقة: ليست محاولة ترحيل
        }
        try {
            DB::transaction(function () use ($fill, $station, $actor, $exception) {
                $now = now();
                DB::table('fuel_tanker_fill_inventory_posting_attempts')->insert([
                    'id' => (string) Str::uuid(), 'tenant_id' => $fill->tenant_id, 'branch_id' => $fill->branch_id, 'fuel_tanker_fill_id' => $fill->id,
                    'fuel_station_id' => $station->id, 'posting_id' => null, 'operation_type' => $this->attemptOperation(),
                    'outcome' => $exception->status >= 500 || $exception->reason === FuelTankerFillException::POSTING_FAILED ? 'failed' : 'rejected',
                    'reason_code' => Str::limit(($exception->details['code'] ?? null) !== null ? (string) $exception->details['code'] : $exception->reason, 64, ''),
                    'idempotency_key' => $this->attemptKeyPrefix() . $fill->id, 'actor_id' => $actor->id, 'attempted_at' => $now, 'created_at' => $now,
                ]);
            });
        } catch (Throwable $e) {
            Log::warning('tanker fill posting attempt could not be recorded', ['fill' => $fill->id, 'error' => $e::class]);
        }
    }
}
