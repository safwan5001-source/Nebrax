<?php

namespace App\Services;

use App\Models\CorporateFuelAuditEvent;
use App\Models\CorporateFuelContract;
use App\Models\CorporateFuelContractPrice;
use App\Models\CorporateFuelContractProduct;
use App\Models\CorporateFuelContractStation;
use App\Models\CorporateFuelCreditLock;
use App\Models\FuelProduct;
use App\Models\FuelStation;
use App\Models\Partner;
use App\Models\User;
use App\Tenancy\TenantContext;
use Carbon\Carbon;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * دورة عقد وقود الشركات. لا تنشئ هذه الخدمة ذمة أو فاتورة؛ دورها تهيئة
 * سياسة التفويض قبل أن يستهلكها FuelSaleService في finalization.
 */
class CorporateFuelContractService
{
    public function create(array $attributes, User $actor): CorporateFuelContract
    {
        return DB::transaction(function () use ($attributes, $actor) {
            $partner = Partner::findOrFail($this->requiredUuid($attributes, 'partner_id'));
            if (! $partner->isCustomer() || ! $partner->is_active) {
                throw new RuntimeException('عقد الوقود المؤسسي يتطلب عميلاً نشطاً.');
            }

            $from = $this->date($attributes['effective_from'] ?? now());
            $until = $this->nullableDate($attributes['effective_until'] ?? null);
            $this->assertDateRange($from, $until);
            $this->assertRestrictions($attributes);
            $this->assertPolicyOverrides($attributes);

            $contract = CorporateFuelContract::create([
                'number' => CorporateFuelContract::nextDocumentNumber('CFC', $from->toDateString()),
                'partner_id' => $partner->id,
                'status' => CorporateFuelContract::STATUS_DRAFT,
                'effective_from' => $from,
                'effective_until' => $until,
                'credit_limit_minor' => $this->nonNegativeInt($attributes, 'credit_limit_minor'),
                'payment_terms_days' => $this->nonNegativeInt($attributes, 'payment_terms_days', 0),
                'station_restriction_mode' => $attributes['station_restriction_mode'] ?? CorporateFuelContract::RESTRICTION_ALL,
                'fuel_restriction_mode' => $attributes['fuel_restriction_mode'] ?? CorporateFuelContract::RESTRICTION_ALL,
                'billing_mode' => CorporateFuelContract::BILLING_PER_SALE,
                'odometer_policy' => $attributes['odometer_policy'] ?? null,
                'driver_required' => $attributes['driver_required'] ?? null,
                'vehicle_required' => $attributes['vehicle_required'] ?? null,
                'fuel_card_required' => $attributes['fuel_card_required'] ?? null,
                'created_by' => $actor->id,
            ]);
            $this->replaceRestrictions($contract, $attributes);
            $this->audit($contract, 'created', null, $this->snapshot($contract), $actor, $this->nullableText($attributes['reason'] ?? null));

            return $contract->fresh(['stations', 'fuelProducts']);
        });
    }

    /** لا تعدّل سياسة عقد نشط تاريخياً؛ غيّرها في مسودة جديدة أو عقد لاحق. */
    public function updateDraft(CorporateFuelContract $contract, array $attributes, User $actor): CorporateFuelContract
    {
        return DB::transaction(function () use ($contract, $attributes, $actor) {
            $contract = CorporateFuelContract::lockForUpdate()->findOrFail($contract->id);
            if ($contract->status !== CorporateFuelContract::STATUS_DRAFT) {
                throw new RuntimeException('لا يمكن تعديل عقد وقود غير مسودة؛ أنشئ عقداً مؤرخاً جديداً للتغيير الجوهري.');
            }

            $before = $this->snapshot($contract);
            $from = array_key_exists('effective_from', $attributes) ? $this->date($attributes['effective_from']) : $contract->effective_from;
            $until = array_key_exists('effective_until', $attributes) ? $this->nullableDate($attributes['effective_until']) : $contract->effective_until;
            $this->assertDateRange($from, $until);
            $this->assertRestrictions($attributes, $contract);
            $this->assertPolicyOverrides($attributes, $contract);

            $updates = [
                'effective_from' => $from,
                'effective_until' => $until,
                'credit_limit_minor' => array_key_exists('credit_limit_minor', $attributes)
                    ? $this->nonNegativeInt($attributes, 'credit_limit_minor') : $contract->credit_limit_minor,
                'payment_terms_days' => array_key_exists('payment_terms_days', $attributes)
                    ? $this->nonNegativeInt($attributes, 'payment_terms_days') : $contract->payment_terms_days,
                'station_restriction_mode' => $attributes['station_restriction_mode'] ?? $contract->station_restriction_mode,
                'fuel_restriction_mode' => $attributes['fuel_restriction_mode'] ?? $contract->fuel_restriction_mode,
                'odometer_policy' => array_key_exists('odometer_policy', $attributes) ? $attributes['odometer_policy'] : $contract->odometer_policy,
                'driver_required' => array_key_exists('driver_required', $attributes) ? $attributes['driver_required'] : $contract->driver_required,
                'vehicle_required' => array_key_exists('vehicle_required', $attributes) ? $attributes['vehicle_required'] : $contract->vehicle_required,
                'fuel_card_required' => array_key_exists('fuel_card_required', $attributes) ? $attributes['fuel_card_required'] : $contract->fuel_card_required,
            ];
            $contract->update($updates);
            $this->replaceRestrictions($contract, $attributes);
            $contract = $contract->fresh(['stations', 'fuelProducts']);
            $this->audit($contract, 'draft_updated', $before, $this->snapshot($contract), $actor, $this->nullableText($attributes['reason'] ?? null));

            return $contract;
        });
    }

    public function activate(CorporateFuelContract $contract, User $actor, ?string $reason = null): CorporateFuelContract
    {
        return DB::transaction(function () use ($contract, $actor, $reason) {
            $contract = CorporateFuelContract::lockForUpdate()->findOrFail($contract->id);
            if ($contract->status !== CorporateFuelContract::STATUS_DRAFT) {
                throw new RuntimeException('لا يمكن تنشيط عقد وقود ليس مسودة.');
            }
            if ($contract->billing_mode !== CorporateFuelContract::BILLING_PER_SALE) {
                throw new RuntimeException('الفوترة المجمعة الشهرية مؤجلة ولا يمكن تفعيلها في Cycle 6.');
            }
            $this->assertRestrictionRows($contract);
            $creditLock = $this->lockForPartner($contract->partner_id);
            unset($creditLock);
            $this->assertNoActiveOverlap($contract);

            $before = $this->snapshot($contract);
            $contract->update([
                'status' => CorporateFuelContract::STATUS_ACTIVE,
                'activated_by' => $actor->id,
                'activated_at' => now(),
            ]);
            $contract = $contract->fresh();
            $this->audit($contract, 'activated', $before, $this->snapshot($contract), $actor, $this->nullableText($reason));

            return $contract;
        });
    }

    public function suspend(CorporateFuelContract $contract, User $actor, string $reason): CorporateFuelContract
    {
        $reason = trim($reason);
        if ($reason === '') {
            throw new RuntimeException('سبب تعليق عقد الوقود مطلوب للتدقيق.');
        }

        return DB::transaction(function () use ($contract, $actor, $reason) {
            $contract = CorporateFuelContract::lockForUpdate()->findOrFail($contract->id);
            if ($contract->status !== CorporateFuelContract::STATUS_ACTIVE) {
                throw new RuntimeException('يمكن تعليق عقد وقود نشط فقط.');
            }
            $this->lockForPartner($contract->partner_id);
            $before = $this->snapshot($contract);
            $contract->update([
                'status' => CorporateFuelContract::STATUS_SUSPENDED,
                'suspended_by' => $actor->id,
                'suspended_at' => now(),
                'suspension_reason' => $reason,
            ]);
            $contract = $contract->fresh();
            $this->audit($contract, 'suspended', $before, $this->snapshot($contract), $actor, $reason);

            return $contract;
        });
    }

    public function createPrice(CorporateFuelContract $contract, array $attributes, User $actor): CorporateFuelContractPrice
    {
        return DB::transaction(function () use ($contract, $attributes, $actor) {
            $contract = CorporateFuelContract::lockForUpdate()->findOrFail($contract->id);
            if (in_array($contract->status, [CorporateFuelContract::STATUS_CANCELLED, CorporateFuelContract::STATUS_EXPIRED], true)) {
                throw new RuntimeException('لا يمكن إضافة سعر إلى عقد ملغى أو منتهٍ.');
            }

            $fuelProduct = FuelProduct::findOrFail($this->requiredUuid($attributes, 'fuel_product_id'));
            if (! $fuelProduct->is_active) {
                throw new RuntimeException('لا يمكن تسعير منتج وقود غير نشط.');
            }
            $from = $this->date($attributes['effective_from'] ?? now());
            $until = $this->nullableDate($attributes['effective_until'] ?? null);
            $this->assertDateRange($from, $until);
            $taxMode = $attributes['tax_mode'] ?? null;
            if (! in_array($taxMode, CorporateFuelContractPrice::TAX_MODES, true)) {
                throw new RuntimeException('نمط VAT لسعر العقد يجب أن يكون tax_inclusive أو tax_exclusive.');
            }
            $price = $this->positiveInt($attributes, 'price_per_liter_minor');
            $this->assertNoPriceOverlap($contract, $fuelProduct, $from, $until);

            $result = CorporateFuelContractPrice::create([
                'corporate_fuel_contract_id' => $contract->id,
                'fuel_product_id' => $fuelProduct->id,
                'price_per_liter_minor' => $price,
                'tax_mode' => $taxMode,
                'effective_from' => $from,
                'effective_until' => $until,
                'status' => CorporateFuelContractPrice::STATUS_ACTIVE,
                'created_by' => $actor->id,
                'approved_by' => $actor->id,
                'reason' => $this->nullableText($attributes['reason'] ?? null),
            ]);
            $this->audit($result, 'price_created', null, $this->priceSnapshot($result), $actor, $result->reason);

            return $result;
        });
    }

    public function resolveActive(Partner $partner, CarbonInterface $at): CorporateFuelContract
    {
        $contract = CorporateFuelContract::where('partner_id', $partner->id)
            ->where('status', CorporateFuelContract::STATUS_ACTIVE)
            ->where('effective_from', '<=', $at)
            ->where(fn ($query) => $query->whereNull('effective_until')->orWhere('effective_until', '>', $at))
            ->orderByDesc('effective_from')
            ->first();
        if ($contract === null) {
            throw new RuntimeException('CORPORATE_CONTRACT_NOT_ACTIVE');
        }

        return $contract;
    }

    public function effectivePrice(CorporateFuelContract $contract, FuelProduct $fuelProduct, CarbonInterface $at): ?CorporateFuelContractPrice
    {
        return CorporateFuelContractPrice::where('corporate_fuel_contract_id', $contract->id)
            ->where('fuel_product_id', $fuelProduct->id)
            ->where('status', CorporateFuelContractPrice::STATUS_ACTIVE)
            ->where('effective_from', '<=', $at)
            ->where(fn ($query) => $query->whereNull('effective_until')->orWhere('effective_until', '>', $at))
            ->orderByDesc('effective_from')
            ->first();
    }

    private function lockForPartner(string $partnerId): CorporateFuelCreditLock
    {
        $tenantId = app(TenantContext::class)->id();
        CorporateFuelCreditLock::firstOrCreate(['tenant_id' => $tenantId, 'partner_id' => $partnerId]);

        return CorporateFuelCreditLock::where('tenant_id', $tenantId)
            ->where('partner_id', $partnerId)
            ->lockForUpdate()
            ->firstOrFail();
    }

    private function assertNoActiveOverlap(CorporateFuelContract $contract): void
    {
        $until = $contract->effective_until?->toDateTimeString() ?? '9999-12-31 23:59:59';
        $overlap = CorporateFuelContract::where('partner_id', $contract->partner_id)
            ->whereKeyNot($contract->id)
            ->where('status', CorporateFuelContract::STATUS_ACTIVE)
            ->where('effective_from', '<', $until)
            ->where(fn ($query) => $query->whereNull('effective_until')->orWhere('effective_until', '>', $contract->effective_from))
            ->exists();
        if ($overlap) {
            throw new RuntimeException('يوجد عقد وقود نشط متداخل للعميل؛ علّق أو أنهِ العقد السابق قبل التنشيط.');
        }
    }

    private function assertNoPriceOverlap(CorporateFuelContract $contract, FuelProduct $fuelProduct, CarbonInterface $from, ?CarbonInterface $until): void
    {
        $end = $until?->toDateTimeString() ?? '9999-12-31 23:59:59';
        $overlap = CorporateFuelContractPrice::where('corporate_fuel_contract_id', $contract->id)
            ->where('fuel_product_id', $fuelProduct->id)
            ->where('status', CorporateFuelContractPrice::STATUS_ACTIVE)
            ->where('effective_from', '<', $end)
            ->where(fn ($query) => $query->whereNull('effective_until')->orWhere('effective_until', '>', $from))
            ->exists();
        if ($overlap) {
            throw new RuntimeException('يتداخل سعر عقد فعال مع نطاق فعالية السعر المطلوب.');
        }
    }

    private function replaceRestrictions(CorporateFuelContract $contract, array $attributes, bool $onlyProvided = true): void
    {
        if (array_key_exists('station_ids', $attributes) || ! $onlyProvided) {
            CorporateFuelContractStation::where('corporate_fuel_contract_id', $contract->id)->delete();
            foreach ($attributes['station_ids'] ?? [] as $stationId) {
                $station = FuelStation::find($stationId);
                if ($station === null) {
                    throw new RuntimeException('قيد العقد يتضمن محطة غير موجودة أو لا تنتمي إلى المستأجر النشط.');
                }
                CorporateFuelContractStation::create(['corporate_fuel_contract_id' => $contract->id, 'fuel_station_id' => $station->id]);
            }
        }
        if (array_key_exists('fuel_product_ids', $attributes) || ! $onlyProvided) {
            CorporateFuelContractProduct::where('corporate_fuel_contract_id', $contract->id)->delete();
            foreach ($attributes['fuel_product_ids'] ?? [] as $fuelProductId) {
                $fuelProduct = FuelProduct::find($fuelProductId);
                if ($fuelProduct === null) {
                    throw new RuntimeException('قيد العقد يتضمن منتج وقود غير موجود أو لا ينتمي إلى المستأجر النشط.');
                }
                CorporateFuelContractProduct::create(['corporate_fuel_contract_id' => $contract->id, 'fuel_product_id' => $fuelProduct->id]);
            }
        }
    }

    private function assertRestrictions(array $attributes, ?CorporateFuelContract $current = null): void
    {
        $stationMode = $attributes['station_restriction_mode'] ?? $current?->station_restriction_mode ?? CorporateFuelContract::RESTRICTION_ALL;
        $fuelMode = $attributes['fuel_restriction_mode'] ?? $current?->fuel_restriction_mode ?? CorporateFuelContract::RESTRICTION_ALL;
        if (! in_array($stationMode, CorporateFuelContract::RESTRICTION_MODES, true)
            || ! in_array($fuelMode, CorporateFuelContract::RESTRICTION_MODES, true)) {
            throw new RuntimeException('وضع قيود العقد يجب أن يكون all أو selected.');
        }
        foreach (['station_ids', 'fuel_product_ids'] as $key) {
            if (array_key_exists($key, $attributes) && (! is_array($attributes[$key]) || ! array_is_list($attributes[$key]) || count($attributes[$key]) !== count(array_unique($attributes[$key])))) {
                throw new RuntimeException('قوائم قيود العقد يجب أن تكون معرفات فريدة.');
            }
        }
    }

    private function assertRestrictionRows(CorporateFuelContract $contract): void
    {
        if ($contract->station_restriction_mode === CorporateFuelContract::RESTRICTION_SELECTED && ! $contract->stations()->exists()) {
            throw new RuntimeException('عقد المحطات selected يتطلب محطة مسموحة واحدة على الأقل.');
        }
        if ($contract->fuel_restriction_mode === CorporateFuelContract::RESTRICTION_SELECTED && ! $contract->fuelProducts()->exists()) {
            throw new RuntimeException('عقد الوقود selected يتطلب منتج وقود مسموحاً واحداً على الأقل.');
        }
    }

    private function assertPolicyOverrides(array $attributes, ?CorporateFuelContract $current = null): void
    {
        $policy = $attributes['odometer_policy'] ?? $current?->odometer_policy;
        if ($policy !== null && ! in_array($policy, ['disabled', 'optional', 'required'], true)) {
            throw new RuntimeException('سياسة عداد العقد يجب أن تكون disabled أو optional أو required.');
        }
        foreach (['driver_required', 'vehicle_required', 'fuel_card_required'] as $key) {
            if (array_key_exists($key, $attributes) && $attributes[$key] !== null && ! is_bool($attributes[$key])) {
                throw new RuntimeException('سياسات العقد المنطقية يجب أن تكون true أو false أو null للوراثة.');
            }
        }
    }

    private function assertDateRange(CarbonInterface $from, ?CarbonInterface $until): void
    {
        if ($until !== null && $until->lte($from)) {
            throw new RuntimeException('نهاية فعالية عقد أو سعر الوقود يجب أن تكون بعد البداية حصراً.');
        }
    }

    private function requiredUuid(array $data, string $key): string
    {
        $value = $data[$key] ?? null;
        if (! is_string($value) || trim($value) === '') {
            throw new RuntimeException("{$key} مطلوب.");
        }
        return $value;
    }

    private function positiveInt(array $data, string $key): int
    {
        $value = $data[$key] ?? null;
        if (! is_int($value) || $value <= 0) {
            throw new RuntimeException("{$key} يجب أن يكون عدداً صحيحاً موجباً.");
        }
        return $value;
    }

    private function nonNegativeInt(array $data, string $key, ?int $default = null): int
    {
        $value = $data[$key] ?? $default;
        if (! is_int($value) || $value < 0) {
            throw new RuntimeException("{$key} يجب أن يكون عدداً صحيحاً غير سالب.");
        }
        return $value;
    }

    private function date(mixed $value): Carbon
    {
        return Carbon::parse($value);
    }

    private function nullableDate(mixed $value): ?Carbon
    {
        return $value === null || $value === '' ? null : Carbon::parse($value);
    }

    private function nullableText(mixed $value): ?string
    {
        $value = trim((string) $value);
        return $value === '' ? null : $value;
    }

    private function audit(object $subject, string $action, ?array $before, ?array $after, User $actor, ?string $reason): void
    {
        CorporateFuelAuditEvent::create([
            'subject_type' => $subject::class,
            'subject_id' => $subject->id,
            'action' => $action,
            'before' => $before,
            'after' => $after,
            'changed_by' => $actor->id,
            'reason' => $reason,
            'changed_at' => now(),
        ]);
    }

    private function snapshot(CorporateFuelContract $contract): array
    {
        return $contract->only([
            'id', 'number', 'partner_id', 'status', 'effective_from', 'effective_until', 'credit_limit_minor',
            'payment_terms_days', 'station_restriction_mode', 'fuel_restriction_mode', 'billing_mode',
            'odometer_policy', 'driver_required', 'vehicle_required', 'fuel_card_required',
        ]);
    }

    private function priceSnapshot(CorporateFuelContractPrice $price): array
    {
        return $price->only([
            'id', 'corporate_fuel_contract_id', 'fuel_product_id', 'price_per_liter_minor', 'tax_mode',
            'effective_from', 'effective_until', 'status', 'approved_by',
        ]);
    }
}
