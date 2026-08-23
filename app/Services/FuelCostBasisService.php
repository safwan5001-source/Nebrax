<?php

namespace App\Services;

use App\Models\FuelDelivery;
use App\Models\FuelInventoryCostMovement;
use App\Models\FuelInventoryCostState;
use App\Models\FuelProduct;
use App\Models\JournalEntry;
use App\Models\ProductWarehouseStock;
use App\Models\StockMovement;
use App\Models\Warehouse;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Cost Basis خاص بالوقود: القيمة الدقيقة المتبقية كسـر (numerator/denominator)
 * مستقل عن money العام. القيود النهائية وحدها هللات صحيحة، والباقي الكسري
 * يبقى محمولاً في state حتى لا ينشأ drift تراكمي.
 */
class FuelCostBasisService
{
    public function assertReady(FuelProduct $fuelProduct, Warehouse $warehouse): FuelInventoryCostState
    {
        return DB::transaction(function () use ($fuelProduct, $warehouse) {
            $state = $this->lockedState($fuelProduct, $warehouse);
            if ($state !== null) {
                return $state;
            }

            $warehouseQuantity = (int) (ProductWarehouseStock::query()
                ->where('warehouse_id', $warehouse->id)
                ->where('product_id', $fuelProduct->product_id)
                ->value('quantity') ?? 0);
            if ($warehouseQuantity > 0) {
                throw new RuntimeException('FUEL_COST_BASELINE_REQUIRED: مخزون الوقود القائم يحتاج baseline تكلفة مدققاً قبل أي عملية جديدة.');
            }

            try {
                FuelInventoryCostState::create([
                    'warehouse_id' => $warehouse->id,
                    'fuel_product_id' => $fuelProduct->id,
                    'quantity_milliliters' => 0,
                    'cost_pool_minor' => 0,
                    'cost_numerator_minor' => '0',
                    'cost_denominator' => '1',
                    'allocation_mode' => 'none',
                    'allocation_basis_quantity_milliliters' => 0,
                    'allocation_basis_cost_pool_minor' => 0,
                    'allocation_issued_milliliters' => 0,
                    'allocation_posted_minor' => 0,
                    'carry_remainder_numerator' => '0',
                    'carry_remainder_denominator' => '1',
                ]);
            } catch (\Throwable $exception) {
                $state = $this->lockedState($fuelProduct, $warehouse);
                if ($state === null) {
                    throw $exception;
                }
            }

            return $this->lockedState($fuelProduct, $warehouse) ?? throw new RuntimeException('تعذر إنشاء حالة تكلفة الوقود.');
        });
    }

    public function recordReceipt(FuelProduct $fuelProduct, Warehouse $warehouse, StockMovement $movement, int $quantityMilliliters, int $totalCostMinor, ?JournalEntry $journalEntry = null, ?FuelDelivery $delivery = null): FuelInventoryCostMovement
    {
        if ($quantityMilliliters <= 0 || $totalCostMinor < 0) {
            throw new RuntimeException('كمية وقيمة استلام الوقود غير صالحتين.');
        }

        return DB::transaction(function () use ($fuelProduct, $warehouse, $movement, $quantityMilliliters, $totalCostMinor, $journalEntry, $delivery) {
            $state = $this->assertReady($fuelProduct, $warehouse);
            $before = $this->snapshot($state);
            $quantityBefore = (int) $state->quantity_milliliters;
            $quantityAfter = $this->addInt($quantityBefore, $quantityMilliliters, 'كمية تكلفة الوقود');
            // state يحفظ معدل التكلفة/mL لا قيمة الرصيد الكلية: (rate×oldQty + receiptCost) / newQty.
            [$numerator, $denominator] = $this->normalise(
                $this->add(
                    $this->mul((string) $state->cost_numerator_minor, (string) $quantityBefore),
                    $this->mul((string) $totalCostMinor, (string) $state->cost_denominator),
                ),
                $this->mul((string) $state->cost_denominator, (string) $quantityAfter),
            );
            $poolAfter = $this->addInt((int) $state->cost_pool_minor, $totalCostMinor, 'قيمة تكلفة الوقود');
            $this->updateState($state, [
                'quantity_milliliters' => $quantityAfter,
                'cost_pool_minor' => $poolAfter,
                'cost_numerator_minor' => $numerator,
                'cost_denominator' => $denominator,
                'allocation_mode' => 'none',
            ]);

            return $this->movement($fuelProduct, $warehouse, $movement, 'receipt', $quantityMilliliters, $totalCostMinor, $before, $state->fresh(), $journalEntry, $delivery);
        });
    }

    /** @return array{posted_cost_minor:int,remainder_numerator:string,remainder_denominator:string} */
    public function quoteIssue(FuelProduct $fuelProduct, Warehouse $warehouse, int $quantityMilliliters): array
    {
        $state = $this->readyForQuantity($fuelProduct, $warehouse, $quantityMilliliters, 'صرف');
        [$valueNumerator, $valueDenominator] = $this->portion($state, $quantityMilliliters);
        return $this->quoteDecrease($state, $valueNumerator, $valueDenominator);
    }

    public function recordIssue(FuelProduct $fuelProduct, Warehouse $warehouse, StockMovement $movement, int $quantityMilliliters, int $postedCostMinor, ?JournalEntry $journalEntry = null): FuelInventoryCostMovement
    {
        return DB::transaction(function () use ($fuelProduct, $warehouse, $movement, $quantityMilliliters, $postedCostMinor, $journalEntry) {
            $state = $this->readyForQuantity($fuelProduct, $warehouse, $quantityMilliliters, 'صرف');
            [$valueNumerator, $valueDenominator] = $this->portion($state, $quantityMilliliters);
            $quote = $this->quoteDecrease($state, $valueNumerator, $valueDenominator);
            if ($quote['posted_cost_minor'] !== $postedCostMinor) {
                throw new RuntimeException('تغيّرت تكلفة الوقود قبل تثبيت الصرف؛ أعد العملية داخل معاملة مقفلة.');
            }
            $before = $this->snapshot($state);
            $remainingQuantity = (int) $state->quantity_milliliters - $quantityMilliliters;
            $this->updateState($state, [
                'quantity_milliliters' => $remainingQuantity,
                'cost_pool_minor' => (int) $state->cost_pool_minor - $postedCostMinor,
                'cost_numerator_minor' => $remainingQuantity === 0 ? '0' : (string) $state->cost_numerator_minor,
                'cost_denominator' => $remainingQuantity === 0 ? '1' : (string) $state->cost_denominator,
                'allocation_mode' => 'issue',
                'carry_remainder_numerator' => $quote['remainder_numerator'],
                'carry_remainder_denominator' => $quote['remainder_denominator'],
            ]);

            return $this->movement($fuelProduct, $warehouse, $movement, 'issue', $quantityMilliliters, $postedCostMinor, $before, $state->fresh(), $journalEntry, null);
        });
    }

    /** زيادة جرد لا تخلق GRNI: تسعّر من متوسط Cost Basis الدقيق الحالي فقط. */
    public function quoteGain(FuelProduct $fuelProduct, Warehouse $warehouse, int $quantityMilliliters): array
    {
        $state = $this->readyForGain($fuelProduct, $warehouse, $quantityMilliliters);
        [$valueNumerator, $valueDenominator] = $this->portion($state, $quantityMilliliters);
        return $this->quoteIncrease($state, $valueNumerator, $valueDenominator);
    }

    public function recordGain(FuelProduct $fuelProduct, Warehouse $warehouse, StockMovement $movement, int $quantityMilliliters, int $postedCostMinor, ?JournalEntry $journalEntry = null): FuelInventoryCostMovement
    {
        return DB::transaction(function () use ($fuelProduct, $warehouse, $movement, $quantityMilliliters, $postedCostMinor, $journalEntry) {
            $state = $this->readyForGain($fuelProduct, $warehouse, $quantityMilliliters);
            [$valueNumerator, $valueDenominator] = $this->portion($state, $quantityMilliliters);
            $quote = $this->quoteIncrease($state, $valueNumerator, $valueDenominator);
            if ($quote['posted_cost_minor'] !== $postedCostMinor) {
                throw new RuntimeException('تغيّرت تكلفة الوقود قبل تثبيت زيادة الجرد؛ أعد العملية داخل معاملة مقفلة.');
            }
            $before = $this->snapshot($state);
            $this->updateState($state, [
                'quantity_milliliters' => $this->addInt((int) $state->quantity_milliliters, $quantityMilliliters, 'كمية زيادة الوقود'),
                'cost_pool_minor' => $this->addInt((int) $state->cost_pool_minor, $postedCostMinor, 'قيمة زيادة الوقود'),
                'cost_numerator_minor' => (string) $state->cost_numerator_minor,
                'cost_denominator' => (string) $state->cost_denominator,
                'allocation_mode' => 'gain',
                'carry_remainder_numerator' => $quote['remainder_numerator'],
                'carry_remainder_denominator' => $quote['remainder_denominator'],
            ]);

            return $this->movement($fuelProduct, $warehouse, $movement, 'adjustment_gain', $quantityMilliliters, $postedCostMinor, $before, $state->fresh(), $journalEntry, null);
        });
    }

    private function readyForQuantity(FuelProduct $fuelProduct, Warehouse $warehouse, int $quantityMilliliters, string $operation): FuelInventoryCostState
    {
        if ($quantityMilliliters <= 0) {
            throw new RuntimeException("كمية {$operation} الوقود يجب أن تكون موجبة.");
        }
        $state = $this->assertReady($fuelProduct, $warehouse);
        if ($quantityMilliliters > $state->quantity_milliliters) {
            throw new RuntimeException("كمية {$operation} الوقود تتجاوز Cost Pool المتاح في المخزن.");
        }
        return $state;
    }

    private function readyForGain(FuelProduct $fuelProduct, Warehouse $warehouse, int $quantityMilliliters): FuelInventoryCostState
    {
        if ($quantityMilliliters <= 0) {
            throw new RuntimeException('كمية زيادة الجرد يجب أن تكون موجبة.');
        }
        $state = $this->assertReady($fuelProduct, $warehouse);
        if ($state->quantity_milliliters <= 0 || $this->isZero((string) $state->cost_numerator_minor)) {
            throw new RuntimeException('FUEL_GAIN_COST_BASIS_REQUIRED: لا توجد Cost Basis دقيقة لتقييم زيادة الوقود من رصيد صفري.');
        }
        return $state;
    }

    /** @return array{0:string,1:string} */
    private function portion(FuelInventoryCostState $state, int $quantity): array
    {
        return $this->normalise(
            $this->mul((string) $state->cost_numerator_minor, (string) $quantity),
            (string) $state->cost_denominator,
        );
    }

    /** @return array{0:string,1:string} */
    private function remainingAfterDecrease(FuelInventoryCostState $state, int $quantity): array
    {
        $remaining = (int) $state->quantity_milliliters - $quantity;
        if ($remaining === 0) {
            return ['0', '1'];
        }
        return $this->normalise(
            $this->mul((string) $state->cost_numerator_minor, (string) $remaining),
            $this->mul((string) $state->cost_denominator, (string) $state->quantity_milliliters),
        );
    }

    /** @return array{posted_cost_minor:int,remainder_numerator:string,remainder_denominator:string} */
    private function quoteDecrease(FuelInventoryCostState $state, string $valueNumerator, string $valueDenominator): array
    {
        // فَقد: posted = floor(value + carry)، وcarry' = القيمة الكسرية المتبقية.
        // هذا يبقي cost_pool = exact_cost + carry في كل لحظة حتى الاستنفاد الكامل.
        [$sumNumerator, $sumDenominator] = $this->addFractions(
            (string) $state->carry_remainder_numerator,
            (string) $state->carry_remainder_denominator,
            $valueNumerator,
            $valueDenominator,
        );
        [$postedString, $remainderNumerator] = $this->divMod($sumNumerator, $sumDenominator);

        return ['posted_cost_minor' => $this->toInt($postedString, 'قيمة صرف الوقود'), 'remainder_numerator' => $remainderNumerator, 'remainder_denominator' => $sumDenominator];
    }

    /** @return array{posted_cost_minor:int,remainder_numerator:string,remainder_denominator:string} */
    private function quoteIncrease(FuelInventoryCostState $state, string $valueNumerator, string $valueDenominator): array
    {
        // زيادة: posted = ceil(value - carry)، وcarry' = carry - value + posted.
        [$deltaNumerator, $deltaDenominator] = $this->subtractFractions(
            $valueNumerator,
            $valueDenominator,
            (string) $state->carry_remainder_numerator,
            (string) $state->carry_remainder_denominator,
        );
        $posted = $this->ceilPositive($deltaNumerator, $deltaDenominator);
        $remainderNumerator = $this->sub(
            $this->mul((string) $posted, $deltaDenominator),
            $deltaNumerator,
        );
        [$remainderNumerator, $remainderDenominator] = $this->normalise($remainderNumerator, $deltaDenominator);

        return ['posted_cost_minor' => $posted, 'remainder_numerator' => $remainderNumerator, 'remainder_denominator' => $remainderDenominator];
    }

    /** @return array{quantity:int,pool:int,numerator:string,denominator:string,remainder_numerator:string,remainder_denominator:string} */
    private function snapshot(FuelInventoryCostState $state): array
    {
        return [
            'quantity' => (int) $state->quantity_milliliters,
            'pool' => (int) $state->cost_pool_minor,
            'numerator' => (string) $state->cost_numerator_minor,
            'denominator' => (string) $state->cost_denominator,
            'remainder_numerator' => (string) $state->carry_remainder_numerator,
            'remainder_denominator' => (string) $state->carry_remainder_denominator,
        ];
    }

    /** @param array<string,mixed> $changes */
    private function updateState(FuelInventoryCostState $state, array $changes): void
    {
        $state->update($changes + [
            'allocation_basis_quantity_milliliters' => $changes['quantity_milliliters'] ?? $state->quantity_milliliters,
            'allocation_basis_cost_pool_minor' => $changes['cost_pool_minor'] ?? $state->cost_pool_minor,
            'allocation_issued_milliliters' => 0,
            'allocation_posted_minor' => 0,
        ]);
    }

    private function movement(FuelProduct $fuelProduct, Warehouse $warehouse, StockMovement $stockMovement, string $type, int $quantity, int $postedCost, array $before, FuelInventoryCostState $after, ?JournalEntry $journal, ?FuelDelivery $delivery): FuelInventoryCostMovement
    {
        return FuelInventoryCostMovement::create([
            'warehouse_id' => $warehouse->id,
            'fuel_product_id' => $fuelProduct->id,
            'stock_movement_id' => $stockMovement->id,
            'journal_entry_id' => $journal?->id,
            'fuel_delivery_id' => $delivery?->id,
            'movement_type' => $type,
            'quantity_milliliters' => $quantity,
            'posted_cost_minor' => $postedCost,
            'cost_pool_minor_before' => $before['pool'],
            'cost_numerator_before' => $before['numerator'],
            'cost_denominator_before' => $before['denominator'],
            'quantity_milliliters_before' => $before['quantity'],
            'carry_remainder_numerator_before' => $before['remainder_numerator'],
            'carry_remainder_denominator_before' => $before['remainder_denominator'],
            'cost_pool_minor_after' => $after->cost_pool_minor,
            'cost_numerator_after' => $after->cost_numerator_minor,
            'cost_denominator_after' => $after->cost_denominator,
            'quantity_milliliters_after' => $after->quantity_milliliters,
            'carry_remainder_numerator_after' => $after->carry_remainder_numerator,
            'carry_remainder_denominator_after' => $after->carry_remainder_denominator,
            'occurred_at' => now(),
        ]);
    }

    private function lockedState(FuelProduct $fuelProduct, Warehouse $warehouse): ?FuelInventoryCostState
    {
        return FuelInventoryCostState::query()
            ->where('warehouse_id', $warehouse->id)
            ->where('fuel_product_id', $fuelProduct->id)
            ->lockForUpdate()
            ->first();
    }

    /** @return array{0:string,1:string} */
    private function addFractions(string $leftNumerator, string $leftDenominator, string $rightNumerator, string $rightDenominator): array
    {
        return $this->normalise(
            $this->add($this->mul($leftNumerator, $rightDenominator), $this->mul($rightNumerator, $leftDenominator)),
            $this->mul($leftDenominator, $rightDenominator),
        );
    }

    /** @return array{0:string,1:string} */
    private function subtractFractions(string $leftNumerator, string $leftDenominator, string $rightNumerator, string $rightDenominator): array
    {
        return $this->normalise(
            $this->sub($this->mul($leftNumerator, $rightDenominator), $this->mul($rightNumerator, $leftDenominator)),
            $this->mul($leftDenominator, $rightDenominator),
        );
    }

    /** @return array{0:string,1:string} */
    private function normalise(string $numerator, string $denominator): array
    {
        if ($this->compare($denominator, '0') <= 0) {
            throw new RuntimeException('مقام Cost Basis يجب أن يكون موجباً.');
        }
        if ($this->isZero($numerator)) {
            return ['0', '1'];
        }
        $gcd = $this->gcd($this->abs($numerator), $denominator);
        return [$this->div($numerator, $gcd), $this->div($denominator, $gcd)];
    }

    /** @return array{0:string,1:string} */
    private function divMod(string $numerator, string $denominator): array
    {
        $whole = $this->div($numerator, $denominator);
        return [$whole, $this->sub($numerator, $this->mul($whole, $denominator))];
    }

    private function ceilPositive(string $numerator, string $denominator): int
    {
        if ($this->compare($numerator, '0') <= 0) {
            return 0;
        }
        $whole = $this->div($this->add($numerator, $this->sub($denominator, '1')), $denominator);
        return $this->toInt($whole, 'قيمة صرف الوقود');
    }

    private function gcd(string $left, string $right): string
    {
        while (! $this->isZero($right)) {
            [, $remainder] = $this->divMod($left, $right);
            $left = $right;
            $right = $remainder;
        }
        return $left;
    }

    private function addInt(int $left, int $right, string $label): int
    {
        if ($right > PHP_INT_MAX - $left) {
            throw new RuntimeException("{$label} يتجاوز الحد المسموح به.");
        }
        return $left + $right;
    }

    private function toInt(string $value, string $label): int
    {
        if ($this->compare($value, (string) PHP_INT_MAX) > 0 || $this->compare($value, '0') < 0) {
            throw new RuntimeException("{$label} يتجاوز الحد المسموح به.");
        }
        return (int) $value;
    }

    private function add(string $left, string $right): string { return bcadd($left, $right, 0); }
    private function sub(string $left, string $right): string { return bcsub($left, $right, 0); }
    private function mul(string $left, string $right): string { return bcmul($left, $right, 0); }
    private function div(string $left, string $right): string { return bcdiv($left, $right, 0); }
    private function compare(string $left, string $right): int { return bccomp($left, $right, 0); }
    private function abs(string $value): string { return $this->compare($value, '0') < 0 ? substr($value, 1) : $value; }
    private function isZero(string $value): bool { return $this->compare($value, '0') === 0; }
}
