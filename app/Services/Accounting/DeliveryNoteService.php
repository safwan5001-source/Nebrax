<?php

namespace App\Services\Accounting;

use App\Models\DeliveryNote;
use App\Models\DeliveryNoteEvent;
use App\Models\DeliveryNoteLine;
use App\Models\Partner;
use App\Models\Product;
use App\Models\User;
use App\Models\Warehouse;
use App\Support\Settings;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * دورة سند التسليم التشغيلية العامة.
 *
 * لا تستدعي هذه الخدمة InvoiceService أو InventoryService أو LedgerService أو PaymentService.
 * الخصم المخزني والترحيل المالي ما زالا ملك دورة الفاتورة إلى قرار PR-10 المعتمد.
 */
class DeliveryNoteService
{
    private const MAX_QUANTITY = 1000000;

    public function __construct(protected UnitConversion $units) {}

    /** @param array<string,mixed> $data @param array<int,array<string,mixed>> $items */
    public function create(array $data, array $items): DeliveryNote
    {
        [$tenantId, $branchId] = $this->trustedScope();
        if ($items === []) {
            throw new RuntimeException('سند التسليم يجب أن يحتوي على سطر واحد على الأقل.');
        }

        return DB::transaction(function () use ($data, $items, $tenantId, $branchId) {
            $this->assertCustomer($data['customer_id'] ?? null);
            $this->assertWarehouse($data['warehouse_id'] ?? null, $branchId);
            $resolvedItems = $this->resolveItems($items, $branchId);
            $date = $this->dateString($data['delivery_date'] ?? null);

            $note = DeliveryNote::create([
                'tenant_id' => $tenantId,
                'branch_id' => $branchId,
                'number' => DeliveryNote::nextDocumentNumber($this->documentPrefix(), $date, $branchId),
                'external_reference' => $this->nullableText($data['external_reference'] ?? null, 120),
                'customer_id' => $data['customer_id'],
                'warehouse_id' => $data['warehouse_id'],
                'delivery_date' => $date,
                'notes' => $this->nullableText($data['notes'] ?? null, 5000),
                'created_by' => $data['created_by'] ?? null,
            ]);

            $this->replaceLines($note, $resolvedItems);
            $this->appendEvent($note, 'created', null, DeliveryNote::STATUS_DRAFT, $data['created_by'] ?? null, null, [
                'line_count' => count($resolvedItems),
            ]);

            return $note->fresh($this->relations());
        });
    }

    /** @param array<string,mixed> $data @param array<int,array<string,mixed>> $items */
    public function update(DeliveryNote $note, array $data, array $items, int $expectedVersion): DeliveryNote
    {
        if ($items === []) {
            throw new RuntimeException('سند التسليم يجب أن يحتوي على سطر واحد على الأقل.');
        }

        return DB::transaction(function () use ($note, $data, $items, $expectedVersion) {
            $note = DeliveryNote::lockForUpdate()->findOrFail($note->id);
            $this->assertDraftAndVersion($note, $expectedVersion);
            $this->assertCustomer($data['customer_id'] ?? null);
            $this->assertWarehouse($data['warehouse_id'] ?? null, $note->branch_id);
            $resolvedItems = $this->resolveItems($items, $note->branch_id);

            DeliveryNote::withWorkflowMutation(function () use ($note, $data): void {
                $note->update([
                    'external_reference' => $this->nullableText($data['external_reference'] ?? null, 120),
                    'customer_id' => $data['customer_id'],
                    'warehouse_id' => $data['warehouse_id'],
                    'delivery_date' => $this->dateString($data['delivery_date'] ?? null),
                    'notes' => $this->nullableText($data['notes'] ?? null, 5000),
                    'version' => $note->version + 1,
                ]);
            });

            $note->lines()->delete();
            $this->replaceLines($note, $resolvedItems);
            $this->appendEvent($note, 'updated', DeliveryNote::STATUS_DRAFT, DeliveryNote::STATUS_DRAFT, $data['actor_id'] ?? null, $this->nullableText($data['reason'] ?? null, 500), [
                'line_count' => count($resolvedItems),
            ]);

            return $note->fresh($this->relations());
        });
    }

    public function confirm(DeliveryNote $note, int $expectedVersion, ?string $actorId, ?string $reason = null): DeliveryNote
    {
        $actorId = $this->assertActor($actorId);
        $reason = $this->nullableText($reason, 500);

        return DB::transaction(function () use ($note, $expectedVersion, $actorId, $reason) {
            $note = DeliveryNote::lockForUpdate()->findOrFail($note->id);
            $this->assertDraftAndVersion($note, $expectedVersion);
            $this->revalidateLockedNote($note);

            DeliveryNote::withWorkflowMutation(function () use ($note, $actorId): void {
                $note->update([
                    'status' => DeliveryNote::STATUS_CONFIRMED,
                    'version' => $note->version + 1,
                    'confirmed_by' => $actorId,
                    'confirmed_at' => now(),
                ]);
            });

            $this->appendEvent($note, 'confirmed', DeliveryNote::STATUS_DRAFT, DeliveryNote::STATUS_CONFIRMED, $actorId, $reason, null);

            return $note->fresh($this->relations());
        });
    }

    public function cancel(DeliveryNote $note, int $expectedVersion, ?string $actorId, string $reason): DeliveryNote
    {
        $actorId = $this->assertActor($actorId);
        $reason = $this->requiredText($reason, 500, 'إلغاء سند التسليم يتطلب سبباً واضحاً.');

        return DB::transaction(function () use ($note, $expectedVersion, $actorId, $reason) {
            $note = DeliveryNote::lockForUpdate()->findOrFail($note->id);
            if ($note->isCancelled()) {
                throw new RuntimeException('سند التسليم ملغى بالفعل.');
            }
            if (! in_array($note->status, [DeliveryNote::STATUS_DRAFT, DeliveryNote::STATUS_CONFIRMED], true)) {
                throw new RuntimeException('لا يمكن إلغاء سند التسليم في حالته الحالية.');
            }
            $this->assertVersion($note, $expectedVersion);

            $fromStatus = $note->status;
            DeliveryNote::withWorkflowMutation(function () use ($note, $actorId, $reason): void {
                $note->update([
                    'status' => DeliveryNote::STATUS_CANCELLED,
                    'version' => $note->version + 1,
                    'cancelled_by' => $actorId,
                    'cancelled_at' => now(),
                    'cancellation_reason' => $reason,
                ]);
            });

            $this->appendEvent($note, 'cancelled', $fromStatus, DeliveryNote::STATUS_CANCELLED, $actorId, $reason, null);

            return $note->fresh($this->relations());
        });
    }

    /** @return array{0:string,1:string} */
    private function trustedScope(): array
    {
        $tenant = app(TenantContext::class);
        $branch = app(BranchContext::class);
        if (! $tenant->has() || ! $branch->has()) {
            throw new RuntimeException('سندات التسليم تتطلب سياق مستأجر وفرع موثوقين.');
        }

        return [$tenant->id(), $branch->id()];
    }

    private function assertCustomer(mixed $customerId): Partner
    {
        if (! is_string($customerId) || $customerId === '') {
            throw new RuntimeException('العميل مطلوب.');
        }
        $customer = Partner::query()->find($customerId);
        if (! $customer) {
            throw new RuntimeException('العميل غير موجود أو خارج نطاق الفرع.');
        }
        if (! $customer->isCustomer()) {
            throw new RuntimeException('الطرف المحدد ليس عميلاً صالحاً لسند التسليم.');
        }
        if (! $customer->is_active) {
            throw new RuntimeException('العميل المحدد غير نشط.');
        }

        return $customer;
    }

    private function assertWarehouse(mixed $warehouseId, string $branchId): Warehouse
    {
        if (! is_string($warehouseId) || $warehouseId === '') {
            throw new RuntimeException('المستودع مطلوب لسند التسليم.');
        }
        $warehouse = Warehouse::query()->find($warehouseId);
        if (! $warehouse) {
            throw new RuntimeException('المستودع غير موجود.');
        }
        if (! $warehouse->is_active) {
            throw new RuntimeException('المستودع المحدد غير نشط.');
        }
        if ($warehouse->branch_id !== null && $warehouse->branch_id !== $branchId) {
            throw new RuntimeException('المستودع المحدد خارج فرع سند التسليم.');
        }

        return $warehouse;
    }

    /** @param array<int,array<string,mixed>> $items @return array<int,array<string,mixed>> */
    private function resolveItems(array $items, string $branchId): array
    {
        $this->trustedScope();
        $resolved = [];
        foreach (array_values($items) as $position => $item) {
            $productId = $item['product_id'] ?? null;
            if (! is_string($productId) || $productId === '') {
                throw new RuntimeException('كل سطر في سند التسليم يحتاج منتجاً.');
            }
            $product = Product::query()->find($productId);
            if (! $product) {
                throw new RuntimeException('أحد المنتجات غير موجود أو خارج نطاق الفرع.');
            }
            if (! $product->is_active) {
                throw new RuntimeException("المنتج «{$product->name}» غير نشط.");
            }
            [$quantity, $quantityNumerator, $quantityDenominator] = $this->resolveQuantity($item);
            $requestedUnit = isset($item['unit']) ? $item['unit'] : null;
            if ($requestedUnit !== null && ! is_string($requestedUnit)) {
                throw new RuntimeException('وحدة السطر غير صالحة.');
            }
            if ($quantityNumerator !== null && (! is_string($requestedUnit) || trim($requestedUnit) === '')) {
                throw new RuntimeException('الكمية النسبية تحتاج اسم وحدة عرض صريحاً.');
            }
            [$unitName, $unitFactor] = $this->units->resolve($product, $requestedUnit);
            $resolved[] = [
                'tenant_id' => app(TenantContext::class)->id(),
                'branch_id' => $branchId,
                'line_number' => $position + 1,
                'product_id' => $product->id,
                'product_name_snapshot' => $product->name,
                'product_sku_snapshot' => $product->sku,
                'product_barcode_snapshot' => $product->barcode,
                'unit_name' => $unitName ?? $product->unit,
                'unit_factor' => $unitFactor,
                'quantity' => $quantity,
                'quantity_numerator' => $quantityNumerator,
                'quantity_denominator' => $quantityDenominator,
                'description' => $this->nullableText($item['description'] ?? null, 1000),
            ];
        }

        return $resolved;
    }

    /** @param array<int,array<string,mixed>> $resolvedItems */
    private function replaceLines(DeliveryNote $note, array $resolvedItems): void
    {
        foreach ($resolvedItems as $line) {
            DeliveryNoteLine::create($line + ['delivery_note_id' => $note->id]);
        }
    }

    private function revalidateLockedNote(DeliveryNote $note): void
    {
        $this->assertCustomer($note->customer_id);
        $this->assertWarehouse($note->warehouse_id, $note->branch_id);
        $note->loadMissing('lines');
        if ($note->lines->isEmpty()) {
            throw new RuntimeException('سند التسليم يجب أن يحتوي على سطر واحد على الأقل.');
        }

        foreach ($note->lines as $line) {
            $product = Product::query()->find($line->product_id);
            if (! $product || ! $product->is_active) {
                throw new RuntimeException('لا يمكن تأكيد سند التسليم لأن أحد منتجاته غير متاح أو غير نشط.');
            }
            $unit = $line->unit_name === $product->unit ? null : $line->unit_name;
            [, $factor] = $this->units->resolve($product, $unit);
            if ($factor !== (int) $line->unit_factor) {
                throw new RuntimeException('وحدة أحد سطور سند التسليم لم تعد متسقة مع المنتج.');
            }
            $this->assertStoredQuantity($line);
        }
    }

    /** @param array<string,mixed> $item @return array{0:int,1:?int,2:?int} */
    private function resolveQuantity(array $item): array
    {
        $quantity = $this->positiveInteger($item['quantity'] ?? null, 'الكمية');
        $hasNumerator = array_key_exists('quantity_numerator', $item) && $item['quantity_numerator'] !== null;
        $hasDenominator = array_key_exists('quantity_denominator', $item) && $item['quantity_denominator'] !== null;
        if (! $hasNumerator && ! $hasDenominator) {
            return [$quantity, null, null];
        }
        if (! $hasNumerator || ! $hasDenominator) {
            throw new RuntimeException('الكمية النسبية تحتاج quantity_numerator وquantity_denominator معاً.');
        }
        if ($quantity !== 1) {
            throw new RuntimeException('السطر النسبي يستخدم quantity=1 للتوافق؛ المقدار الحقيقي في البسط والمقام.');
        }

        return [
            1,
            $this->positiveInteger($item['quantity_numerator'], 'quantity_numerator'),
            $this->positiveInteger($item['quantity_denominator'], 'quantity_denominator'),
        ];
    }

    private function assertStoredQuantity(DeliveryNoteLine $line): void
    {
        $this->positiveInteger($line->quantity, 'الكمية');
        $hasNumerator = $line->quantity_numerator !== null;
        $hasDenominator = $line->quantity_denominator !== null;
        if (! $hasNumerator && ! $hasDenominator) {
            return;
        }
        if (! $hasNumerator || ! $hasDenominator || (int) $line->quantity !== 1) {
            throw new RuntimeException('تمثيل الكمية النسبية المحفوظ في سند التسليم غير صالح.');
        }
        $this->positiveInteger($line->quantity_numerator, 'quantity_numerator');
        $this->positiveInteger($line->quantity_denominator, 'quantity_denominator');
    }

    private function assertDraftAndVersion(DeliveryNote $note, int $expectedVersion): void
    {
        if (! $note->isDraft()) {
            throw new RuntimeException('لا يمكن تعديل أو تأكيد سند تسليم غير مسودة.');
        }
        $this->assertVersion($note, $expectedVersion);
    }

    private function assertVersion(DeliveryNote $note, int $expectedVersion): void
    {
        if ($expectedVersion !== (int) $note->version) {
            throw new RuntimeException('تم تعديل سند التسليم من مستخدم آخر؛ حدّث الصفحة ثم أعد المحاولة.');
        }
    }

    private function positiveInteger(mixed $value, string $label): int
    {
        if (! is_int($value) && !(is_string($value) && preg_match('/^[1-9][0-9]*$/', $value))) {
            throw new RuntimeException("{$label} يجب أن تكون عدداً صحيحاً موجباً.");
        }
        $integer = (int) $value;
        if ($integer <= 0 || $integer > self::MAX_QUANTITY || (string) $integer !== (string) $value) {
            throw new RuntimeException("{$label} تتجاوز الحد المسموح به.");
        }

        return $integer;
    }

    private function dateString(mixed $value): string
    {
        if (! is_string($value) || trim($value) === '') {
            return now()->toDateString();
        }

        try {
            return \Illuminate\Support\Carbon::parse($value)->toDateString();
        } catch (\Throwable) {
            throw new RuntimeException('تاريخ التسليم غير صالح.');
        }
    }

    private function nullableText(mixed $value, ?int $maxLength = null): ?string
    {
        if ($value === null) {
            return null;
        }
        if (! is_string($value)) {
            throw new RuntimeException('النص المدخل غير صالح.');
        }
        $value = trim($value);
        if ($value === '') {
            return null;
        }
        if ($maxLength !== null && mb_strlen($value) > $maxLength) {
            throw new RuntimeException('النص المدخل يتجاوز الحد المسموح به.');
        }

        return $value;
    }

    private function requiredText(mixed $value, int $maxLength, string $emptyMessage): string
    {
        $text = $this->nullableText($value, $maxLength);
        if ($text === null) {
            throw new RuntimeException($emptyMessage);
        }

        return $text;
    }

    private function assertActor(?string $actorId): string
    {
        if (! is_string($actorId) || $actorId === '' || ! User::query()->whereKey($actorId)->exists()) {
            throw new RuntimeException('المستخدم المنفذ غير صالح أو خارج نطاق المستأجر.');
        }

        return $actorId;
    }

    /** @param array<string,mixed>|null $metadata */
    private function appendEvent(
        DeliveryNote $note,
        string $event,
        ?string $fromStatus,
        ?string $toStatus,
        ?string $actorId,
        ?string $reason,
        ?array $metadata,
    ): void {
        DeliveryNoteEvent::withAppend(fn () => DeliveryNoteEvent::create([
            'delivery_note_id' => $note->id,
            'event' => $event,
            'from_status' => $fromStatus,
            'to_status' => $toStatus,
            'actor_id' => $actorId,
            'reason' => $reason,
            'metadata' => $metadata,
            'occurred_at' => now(),
        ]));
    }

    private function documentPrefix(): string
    {
        return (string) Settings::get('sales', 'delivery_note_prefix');
    }

    /** @return array<int,string> */
    private function relations(): array
    {
        return ['customer', 'warehouse', 'lines.product', 'events.actor'];
    }
}
