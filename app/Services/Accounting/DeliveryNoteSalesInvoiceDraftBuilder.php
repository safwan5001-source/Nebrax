<?php

namespace App\Services\Accounting;

use App\Models\Branch;
use App\Models\CostCenter;
use App\Models\DeliveryNote;
use App\Models\DeliveryNoteEvent;
use App\Models\DeliveryNoteInvoiceAllocation;
use App\Models\DeliveryNoteInvoiceDraftBuild;
use App\Models\DeliveryNoteLine;
use App\Models\DeliveryNoteLineInvoiceLink;
use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Models\Partner;
use App\Models\Product;
use App\Models\PriceList;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\PriceListService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * الحد الوحيد بين سندات التسليم والفوترة في PR-10.
 *
 * ينشئ مسودة واحدة عبر InvoiceService::create() ثم يسجل روابط تدقيق immutable.
 * يقتصر أثره على المسودة وروابط المصدر وسجل الأحداث فقط.
 */
class DeliveryNoteSalesInvoiceDraftBuilder
{
    private const MAX_NOTES = 50;
    private const MAX_MONEY = 100000000000;
    private const MAX_QUANTITY = 1000000;

    public function __construct(
        private readonly InvoiceService $invoices,
        private readonly UnitConversion $units,
        private readonly PriceListService $priceLists,
    ) {}

    /**
     * معاينة غير كاتبة. تعرض الحقيقة المرئية فقط ولا تكشف سنداً من مستأجر/فرع آخر.
     *
     * @param array<string,mixed> $data
     * @return array<string,mixed>
     */
    public function preview(array $data): array
    {
        [, $branchId] = $this->trustedScope();
        $noteIds = $this->noteIds($data['delivery_note_ids'] ?? null);
        $notes = DeliveryNote::query()
            ->with(['customer.defaultPriceList', 'warehouse', 'lines.product', 'invoiceAllocations.invoice'])
            ->whereIn('id', $noteIds)
            ->orderBy('id')
            ->get()
            ->keyBy('id');

        $requestedPriceList = $this->previewPriceList($data);
        $rows = [];
        foreach ($noteIds as $noteId) {
            $note = $notes->get($noteId);
            if (! $note) {
                $rows[] = [
                    'id' => $noteId,
                    'eligible' => false,
                    'issues' => ['not_available'],
                ];
                continue;
            }

            $issues = $this->eligibilityIssues($note, $branchId, false);
            $recommendedPriceList = $requestedPriceList ?? $this->activeDefaultPriceList($note);
            $rows[] = [
                'id' => $note->id,
                'number' => $note->number,
                'version' => (int) $note->version,
                'customer_id' => $note->customer_id,
                'customer_name' => $note->customer?->name,
                'warehouse_id' => $note->warehouse_id,
                'warehouse_name' => $note->warehouse?->name,
                'delivery_date' => $note->delivery_date?->toDateString(),
                'eligible' => $issues === [],
                'issues' => $issues,
                'lines' => $note->lines->map(fn (DeliveryNoteLine $line) => [
                    'id' => $line->id,
                    'line_number' => (int) $line->line_number,
                    'product_id' => $line->product_id,
                    'product_name' => $line->product_name_snapshot,
                    'unit_name' => $line->unit_name,
                    'unit_factor' => (int) $line->unit_factor,
                    'quantity' => (int) $line->quantity,
                    'quantity_numerator' => $line->quantity_numerator === null ? null : (int) $line->quantity_numerator,
                    'quantity_denominator' => $line->quantity_denominator === null ? null : (int) $line->quantity_denominator,
                    'suggested_unit_price' => $this->suggestedPrice($line, $recommendedPriceList),
                    'suggested_tax_rate' => $line->product?->tax_rate,
                    'recommended_price_list_id' => $recommendedPriceList?->id,
                ])->values()->all(),
            ];
        }

        $eligible = array_values(array_filter($rows, fn (array $row) => $row['eligible']));
        $compatibility = $this->compatibilityIssues($eligible);

        return [
            'delivery_notes' => $rows,
            'compatible' => $compatibility === [] && count($rows) === count($eligible),
            'compatibility_issues' => $compatibility,
            'pricing_required' => true,
            'requested_price_list_id' => $requestedPriceList?->id,
        ];
    }

    /**
     * @param array<string,mixed> $data
     */
    public function build(array $data): DeliveryNoteInvoiceDraftResult
    {
        [$tenantId, $branchId] = $this->trustedScope();
        $command = $this->normaliseBuildCommand($data);

        try {
            return DB::transaction(function () use ($command, $tenantId, $branchId) {
            // مرساة ثابتة لكل فرع: تمنع سباق المفتاح نفسه حتى عندما تختلف مجموعتا السندات.
            Branch::query()->whereKey($branchId)->lockForUpdate()->firstOrFail();

            $existing = DeliveryNoteInvoiceDraftBuild::query()
                ->where('idempotency_key', $command['idempotency_key'])
                ->lockForUpdate()
                ->first();
            if ($existing) {
                if (! hash_equals($existing->request_checksum, $command['checksum'])) {
                    throw new DeliveryNoteInvoiceConflictException('تم استخدام مفتاح إعادة الطلب مع محتوى مختلف.');
                }

                $invoice = Invoice::query()->findOrFail($existing->invoice_id);
                return new DeliveryNoteInvoiceDraftResult($this->loadInvoice($invoice), true);
            }

            $notes = DeliveryNote::query()
                ->whereIn('id', $command['delivery_note_ids'])
                ->orderBy('id')
                ->lockForUpdate()
                ->get();
            if ($notes->count() !== count($command['delivery_note_ids'])) {
                throw new RuntimeException('أحد سندات التسليم غير موجود أو خارج الفرع النشط.');
            }

            $lines = DeliveryNoteLine::query()
                ->where('tenant_id', $tenantId)
                ->where('branch_id', $branchId)
                ->whereIn('delivery_note_id', $command['delivery_note_ids'])
                ->orderBy('id')
                ->lockForUpdate()
                ->get()
                ->groupBy('delivery_note_id');

            $existingAllocations = DeliveryNoteInvoiceAllocation::query()
                ->whereIn('delivery_note_id', $command['delivery_note_ids'])
                ->orderBy('delivery_note_id')
                ->lockForUpdate()
                ->get();
            if ($existingAllocations->isNotEmpty()) {
                throw new DeliveryNoteInvoiceConflictException('أحد سندات التسليم مرتبط بالفعل بفاتورة مبيعات.');
            }

            $this->assertLockedNotes($notes->all(), $lines->all(), $command, $branchId);
            $notes->first()->loadMissing('customer.defaultPriceList');
            $priceList = $command['price_list_id'] === null
                ? $this->activeDefaultPriceList($notes->first())
                : PriceList::query()->findOrFail($command['price_list_id']);
            $invoiceItems = $this->buildInvoiceItems($notes->all(), $lines->all(), $command['line_pricing'], $priceList);

            $invoiceData = [
                'partner_id' => $notes->first()->customer_id,
                'warehouse_id' => $notes->first()->warehouse_id,
                'invoice_date' => $command['invoice_date'],
                'due_date' => $command['due_date'],
                'notes' => $command['notes'],
                'tax_inclusive' => $command['tax_inclusive'],
                'cost_center_id' => $command['cost_center_id'],
                'created_by' => $command['actor_id'],
                'minimum_price_override_actor_id' => $command['actor_id'],
            ];
            // غياب الاختيار الصريح يترك InvoiceService::create() يطبّق قائمة العميل الافتراضية النشطة؛
            // وقد تحقّقنا من قرارات السطر مقابلها أعلاه إن وُجدت.
            if ($command['price_list_id'] !== null) {
                $invoiceData['price_list_id'] = $command['price_list_id'];
            }
            $invoice = $this->invoices->create($invoiceData, array_column($invoiceItems, 'item'));

            $build = DeliveryNoteInvoiceDraftBuild::withWriting(fn () => DeliveryNoteInvoiceDraftBuild::create([
                'idempotency_key' => $command['idempotency_key'],
                'request_checksum' => $command['checksum'],
                'invoice_id' => $invoice->id,
                'created_by' => $command['actor_id'],
                'created_at' => now(),
            ]));

            $this->createLinksAndEvents($build, $invoice, $notes->all(), $lines->all(), $invoiceItems, $command);

            return new DeliveryNoteInvoiceDraftResult($this->loadInvoice($invoice), false);
            }, 3);
        } catch (QueryException $exception) {
            if ($this->isDeliveryNoteAllocationUniqueViolation($exception)) {
                throw new DeliveryNoteInvoiceConflictException('أحد سندات التسليم مرتبط بالفعل بفاتورة مبيعات.');
            }

            throw $exception;
        }
    }

    private function isDeliveryNoteAllocationUniqueViolation(QueryException $exception): bool
    {
        $message = $exception->getMessage();

        foreach ([
            'delivery_note_invoice_draft_builds_idempotency_unique',
            'delivery_note_invoice_allocations_delivery_note_id_unique',
            'delivery_note_line_invoice_links_delivery_note_line_id_unique',
            'delivery_note_invoice_allocations.delivery_note_id',
            'delivery_note_line_invoice_links.delivery_note_line_id',
        ] as $constraint) {
            if (str_contains($message, $constraint)) {
                return true;
            }
        }

        return false;
    }

    /** @return array{0:string,1:string} */
    private function trustedScope(): array
    {
        $tenant = app(TenantContext::class);
        $branch = app(BranchContext::class);
        if (! $tenant->has() || ! $branch->has()) {
            throw new RuntimeException('إنشاء فاتورة من سندات التسليم يتطلب سياق مستأجر وفرع موثوقين.');
        }

        return [$tenant->id(), $branch->id()];
    }

    /** @param mixed $value @return array<int,string> */
    private function noteIds(mixed $value): array
    {
        if (! is_array($value) || $value === [] || count($value) > self::MAX_NOTES) {
            throw new RuntimeException('اختر سند تسليم واحداً إلى خمسين سنداً.');
        }
        $ids = array_values($value);
        foreach ($ids as $id) {
            if (! is_string($id) || $id === '') {
                throw new RuntimeException('معرّف سند التسليم غير صالح.');
            }
        }
        if (count($ids) !== count(array_unique($ids))) {
            throw new RuntimeException('لا يمكن اختيار سند التسليم أكثر من مرة.');
        }
        sort($ids, SORT_STRING);

        return $ids;
    }

    /** @param array<int,array<string,mixed>> $rows @return array<int,string> */
    private function compatibilityIssues(array $rows): array
    {
        if ($rows === []) {
            return ['no_eligible_delivery_notes'];
        }
        $first = $rows[0];
        foreach ($rows as $row) {
            if ($row['customer_id'] !== $first['customer_id']) {
                return ['mixed_customer'];
            }
            if ($row['warehouse_id'] !== $first['warehouse_id']) {
                return ['mixed_warehouse'];
            }
        }

        return [];
    }

    /** @return array<int,string> */
    private function eligibilityIssues(DeliveryNote $note, string $branchId, bool $locked): array
    {
        $issues = [];
        if ($note->branch_id !== $branchId) {
            $issues[] = 'branch_mismatch';
        }
        if (! $note->isConfirmed()) {
            $issues[] = $note->isCancelled() ? 'cancelled' : 'not_confirmed';
        }
        if ($note->invoiceAllocations->isNotEmpty()) {
            $issues[] = 'already_invoiced';
        }
        if (! $note->customer || ! $note->customer->isCustomer() || ! $note->customer->is_active) {
            $issues[] = 'invalid_customer';
        }
        if (! $note->warehouse || ! $note->warehouse->is_active
            || ($note->warehouse->branch_id !== null && $note->warehouse->branch_id !== $branchId)) {
            $issues[] = 'invalid_warehouse';
        }
        if ($note->lines->isEmpty()) {
            $issues[] = 'empty_lines';
        }

        foreach ($note->lines as $line) {
            if (! $this->lineIsValid($line)) {
                $issues[] = 'invalid_line';
                break;
            }
        }

        return array_values(array_unique($issues));
    }

    private function lineIsValid(DeliveryNoteLine $line): bool
    {
        $product = Product::query()->find($line->product_id);
        if (! $product || ! $product->is_active) {
            return false;
        }

        try {
            $unit = $line->unit_name === $product->unit ? null : $line->unit_name;
            [, $factor] = $this->units->resolve($product, $unit);
        } catch (RuntimeException) {
            return false;
        }

        if ($factor !== (int) $line->unit_factor) {
            return false;
        }

        return $this->validQuantity($line->quantity, $line->quantity_numerator, $line->quantity_denominator);
    }

    private function validQuantity(mixed $quantity, mixed $numerator, mixed $denominator): bool
    {
        if (! is_int($quantity) && !(is_string($quantity) && preg_match('/^[1-9][0-9]*$/', $quantity))) {
            return false;
        }
        $quantity = (int) $quantity;
        if ($quantity < 1 || $quantity > self::MAX_QUANTITY) {
            return false;
        }
        if ($numerator === null && $denominator === null) {
            return true;
        }
        if ($numerator === null || $denominator === null || $quantity !== 1) {
            return false;
        }

        return $this->positiveInteger($numerator, 'quantity_numerator', self::MAX_QUANTITY)
            && $this->positiveInteger($denominator, 'quantity_denominator', self::MAX_QUANTITY);
    }

    /** @param array<string,mixed> $data @return array<string,mixed> */
    private function normaliseBuildCommand(array $data): array
    {
        $noteIds = $this->noteIds($data['delivery_note_ids'] ?? null);
        $versions = is_array($data['expected_versions'] ?? null) ? $data['expected_versions'] : [];
        $normalizedVersions = [];
        foreach ($noteIds as $id) {
            if (! array_key_exists($id, $versions) || ! $this->positiveInteger($versions[$id], 'expected_versions', PHP_INT_MAX)) {
                throw new RuntimeException('كل سند تسليم يحتاج نسخة متوقعة صالحة.');
            }
            $normalizedVersions[$id] = (int) $versions[$id];
        }
        ksort($normalizedVersions, SORT_STRING);

        $actorId = $data['actor_id'] ?? null;
        if (! is_string($actorId) || $actorId === '' || ! User::query()->whereKey($actorId)->exists()) {
            throw new RuntimeException('المستخدم المنفذ غير صالح أو خارج نطاق المستأجر.');
        }

        $linePricing = $this->normaliseLinePricing($data['line_pricing'] ?? null);
        $command = [
            'delivery_note_ids' => $noteIds,
            'expected_versions' => $normalizedVersions,
            'idempotency_key' => $this->idempotencyKey($data['idempotency_key'] ?? null),
            'reason' => $this->requiredText($data['reason'] ?? null, 500, 'إنشاء مسودة الفاتورة يتطلب سبب قرار واضحاً.'),
            'invoice_date' => $this->dateString($data['invoice_date'] ?? null),
            'due_date' => $this->nullableDate($data['due_date'] ?? null),
            'notes' => $this->nullableText($data['notes'] ?? null, 5000),
            'tax_inclusive' => $this->strictBoolean($data['tax_inclusive'] ?? false, 'tax_inclusive'),
            'price_list_id' => $this->optionalVisiblePriceListId($data),
            'cost_center_id' => $this->optionalCostCenterId($data['cost_center_id'] ?? null),
            'line_pricing' => $linePricing,
            'actor_id' => $actorId,
        ];
        $checksumData = $command;
        unset($checksumData['actor_id']);
        $command['checksum'] = hash('sha256', json_encode($checksumData, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));

        return $command;
    }

    /** @param mixed $rows @return array<string,array<string,mixed>> */
    private function normaliseLinePricing(mixed $rows): array
    {
        if (! is_array($rows) || $rows === []) {
            throw new RuntimeException('يجب إدخال قرار تسعير لكل سطر سند تسليم.');
        }
        $normalized = [];
        foreach ($rows as $row) {
            if (! is_array($row) || ! is_string($row['delivery_note_line_id'] ?? null) || $row['delivery_note_line_id'] === '') {
                throw new RuntimeException('مرجع سطر سند التسليم في التسعير غير صالح.');
            }
            $id = $row['delivery_note_line_id'];
            if (isset($normalized[$id])) {
                throw new RuntimeException('لا يمكن تكرار قرار تسعير لسطر سند التسليم نفسه.');
            }
            $unitPrice = $this->integer($row['unit_price'] ?? null, 'unit_price', 1, self::MAX_MONEY);
            $taxRate = $this->integer($row['tax_rate'] ?? 15, 'tax_rate', 0, 100);
            $discount = $this->integer($row['discount'] ?? 0, 'discount', 0, self::MAX_MONEY);
            $normalized[$id] = [
                'delivery_note_line_id' => $id,
                'unit_price' => $unitPrice,
                'tax_rate' => $taxRate,
                'discount' => $discount,
                'minimum_price_override_reason' => $this->nullableText($row['minimum_price_override_reason'] ?? null, 500),
            ];
        }
        ksort($normalized, SORT_STRING);

        return $normalized;
    }

    /** @param array<string,mixed> $data */
    private function optionalVisiblePriceListId(array $data): ?string
    {
        if (! array_key_exists('price_list_id', $data) || $data['price_list_id'] === null) {
            return null;
        }
        if (! is_string($data['price_list_id']) || $data['price_list_id'] === '') {
            throw new RuntimeException('قائمة الأسعار غير صالحة.');
        }
        $priceList = \App\Models\PriceList::query()->find($data['price_list_id']);
        if (! $priceList || ! $priceList->is_active) {
            throw new RuntimeException('قائمة الأسعار المحددة غير موجودة أو غير نشطة.');
        }

        return $priceList->id;
    }

    private function optionalCostCenterId(mixed $costCenterId): ?string
    {
        if ($costCenterId === null) {
            return null;
        }
        if (! is_string($costCenterId) || $costCenterId === '') {
            throw new RuntimeException('مركز التكلفة غير صالح.');
        }
        $center = CostCenter::query()->find($costCenterId);
        if (! $center || ! $center->is_active) {
            throw new RuntimeException('مركز التكلفة غير موجود أو غير نشط.');
        }

        return $center->id;
    }

    /** @param array<int,DeliveryNote> $notes @param array<string,\Illuminate\Support\Collection<int,DeliveryNoteLine>> $lines */
    private function assertLockedNotes(array $notes, array $lines, array $command, string $branchId): void
    {
        $firstCustomer = null;
        $firstWarehouse = null;
        $allLines = [];
        foreach ($notes as $note) {
            $note->setRelation('lines', $lines[$note->id] ?? collect());
            $note->loadMissing(['customer', 'warehouse', 'invoiceAllocations']);
            $issues = $this->eligibilityIssues($note, $branchId, true);
            if ($issues !== []) {
                throw new DeliveryNoteInvoiceConflictException('أحد سندات التسليم لم يعد مؤهلاً لإنشاء فاتورة مبيعات.');
            }
            if ((int) $note->version !== $command['expected_versions'][$note->id]) {
                throw new DeliveryNoteInvoiceConflictException('تم تعديل أحد سندات التسليم من مستخدم آخر؛ حدّث المعاينة ثم أعد المحاولة.');
            }
            $firstCustomer ??= $note->customer_id;
            $firstWarehouse ??= $note->warehouse_id;
            if ($note->customer_id !== $firstCustomer || $note->warehouse_id !== $firstWarehouse) {
                throw new RuntimeException('يجب أن تشترك سندات التسليم في العميل والمستودع نفسيهما.');
            }
            foreach ($note->lines as $line) {
                $allLines[$line->id] = $line;
            }
        }

        $provided = array_keys($command['line_pricing']);
        sort($provided, SORT_STRING);
        $expected = array_keys($allLines);
        sort($expected, SORT_STRING);
        if ($provided !== $expected) {
            throw new RuntimeException('يجب تسعير كل سطر من سطور سندات التسليم مرة واحدة دون استثناء أو تكرار.');
        }
    }

    /**
     * @param array<int,DeliveryNote> $notes
     * @param array<string,\Illuminate\Support\Collection<int,DeliveryNoteLine>> $lines
     * @param array<string,array<string,mixed>> $pricing
     * @return array<int,array{item:array<string,mixed>,sources:array<int,DeliveryNoteLine>}>
     */
    private function buildInvoiceItems(array $notes, array $lines, array $pricing, ?PriceList $priceList): array
    {
        $notesById = collect($notes)->keyBy('id');
        $groups = [];
        foreach ($lines as $noteId => $noteLines) {
            foreach ($noteLines as $line) {
                $decision = $pricing[$line->id];
                $product = Product::query()->findOrFail($line->product_id);
                $this->assertPriceDecision($line, $product, $decision, $priceList);
                $key = implode('|', [
                    $line->product_id,
                    $line->unit_name,
                    $line->unit_factor,
                    $decision['unit_price'],
                    $decision['tax_rate'],
                    $decision['minimum_price_override_reason'] ?? '',
                ]);
                $groups[$key] ??= [
                    'product' => $product,
                    'unit_name' => $line->unit_name,
                    'unit_factor' => (int) $line->unit_factor,
                    'decision' => $decision,
                    'discount' => 0,
                    'sources' => [],
                ];
                // الخصم قرار على سطر المصدر؛ عند الدمج يجب أن يجمع ولا أن ينسخ أول قيمة فقط.
                $groups[$key]['discount'] = $this->checkedAdd($groups[$key]['discount'], $decision['discount'], 'خصم سطر الفاتورة');
                $groups[$key]['sources'][] = $line->setRelation('deliveryNote', $notesById[$noteId]);
            }
        }
        ksort($groups, SORT_STRING);

        $result = [];
        foreach ($groups as $groupKey => $group) {
            [$numerator, $denominator] = $this->sumQuantities($group['sources']);
            $product = $group['product'];
            $baseUnit = $group['unit_name'] === $product->unit && $group['unit_factor'] === 1;
            $invoiceItem = [
                'product_id' => $product->id,
                'description' => $this->sourceDescription($group['sources'], $groupKey),
                'unit' => $baseUnit ? null : $group['unit_name'],
                'unit_price' => $group['decision']['unit_price'],
                'tax_rate' => $group['decision']['tax_rate'],
                'discount' => $group['discount'],
                'minimum_price_override_reason' => $group['decision']['minimum_price_override_reason'],
            ];
            if ($denominator === 1) {
                if ($numerator > self::MAX_QUANTITY) {
                    throw new RuntimeException('إجمالي كمية سطر الفاتورة يتجاوز الحد المسموح به.');
                }
                $invoiceItem['quantity'] = $numerator;
            } else {
                $invoiceItem['quantity'] = 1;
                $invoiceItem['quantity_numerator'] = $numerator;
                $invoiceItem['quantity_denominator'] = $denominator;
                // InvoiceLinePrecision يحتاج اسم الوحدة للكمية النسبية حتى لو كانت وحدة الأساس.
                $invoiceItem['unit'] = $group['unit_name'];
            }
            $result[] = ['item' => $invoiceItem, 'sources' => $group['sources']];
        }

        return $result;
    }

    /** @param array<string,mixed> $decision */
    private function assertPriceDecision(DeliveryNoteLine $line, Product $product, array $decision, ?PriceList $priceList): void
    {
        if ($decision['unit_price'] <= 0) {
            throw new RuntimeException('لا يمكن إنشاء مسودة بسعر وحدة صفري أو فارغ.');
        }
        if ($priceList !== null) {
            $requestedUnit = $line->unit_name === $product->unit ? null : $line->unit_name;
            $listedPrice = $this->priceLists->resolve($priceList, $product, $requestedUnit);
            if ($listedPrice === null || $listedPrice !== $decision['unit_price']) {
                throw new RuntimeException('قرار تسعير أحد السطور لا يطابق قائمة الأسعار المحددة.');
            }
        }
        [$numerator, $denominator] = $this->quantityFraction($line);
        if ($numerator > intdiv(PHP_INT_MAX, $decision['unit_price'])) {
            throw new RuntimeException('قيمة تسعير سطر سند التسليم تتجاوز الحد المسموح به.');
        }
        $gross = intdiv($numerator * $decision['unit_price'], $denominator);
        if ($decision['discount'] > $gross) {
            throw new RuntimeException('خصم السطر لا يمكن أن يتجاوز قيمته الإجمالية.');
        }

        $unit = $line->unit_name === $product->unit ? null : $line->unit_name;
        [, $factor] = $this->units->resolve($product, $unit);
        if ($factor !== (int) $line->unit_factor) {
            throw new RuntimeException('وحدة أحد سطور سند التسليم لم تعد متسقة مع المنتج.');
        }
    }

    /** @param array<int,DeliveryNoteLine> $sources @return array{0:int,1:int} */
    private function sumQuantities(array $sources): array
    {
        $numerator = 0;
        $denominator = 1;
        foreach ($sources as $line) {
            [$lineNumerator, $lineDenominator] = $this->quantityFraction($line);
            $gcd = $this->gcd($denominator, $lineDenominator);
            $left = intdiv($lineDenominator, $gcd);
            $right = intdiv($denominator, $gcd);
            $newDenominator = $this->checkedMultiply($denominator, $left, 'كمية سطر الفاتورة');
            $scaledCurrent = $this->checkedMultiply($numerator, $left, 'كمية سطر الفاتورة');
            $scaledLine = $this->checkedMultiply($lineNumerator, $right, 'كمية سطر الفاتورة');
            $numerator = $this->checkedAdd($scaledCurrent, $scaledLine, 'كمية سطر الفاتورة');
            $denominator = $newDenominator;
        }
        $gcd = $this->gcd($numerator, $denominator);

        return [intdiv($numerator, $gcd), intdiv($denominator, $gcd)];
    }

    /** @return array{0:int,1:int} */
    private function quantityFraction(DeliveryNoteLine $line): array
    {
        if ($line->quantity_numerator === null && $line->quantity_denominator === null) {
            return [(int) $line->quantity, 1];
        }

        return [(int) $line->quantity_numerator, (int) $line->quantity_denominator];
    }

    /** @param array<int,DeliveryNoteLine> $sources */
    private function sourceDescription(array $sources, string $groupKey): string
    {
        $references = collect($sources)
            ->sortBy(fn (DeliveryNoteLine $line) => [$line->deliveryNote->number, $line->line_number])
            ->map(fn (DeliveryNoteLine $line) => "{$line->deliveryNote->number}/{$line->line_number}")
            ->implode('، ');
        $suffix = ' #' . substr(hash('sha256', $groupKey), 0, 12);
        $description = 'توريد — سندات ' . $references;

        return mb_strimwidth($description, 0, 1000 - mb_strlen($suffix), '…') . $suffix;
    }

    /**
     * @param array<int,DeliveryNote> $notes
     * @param array<string,\Illuminate\Support\Collection<int,DeliveryNoteLine>> $lines
     * @param array<int,array{item:array<string,mixed>,sources:array<int,DeliveryNoteLine>}> $invoiceItems
     * @param array<string,mixed> $command
     */
    private function createLinksAndEvents(
        DeliveryNoteInvoiceDraftBuild $build,
        Invoice $invoice,
        array $notes,
        array $lines,
        array $invoiceItems,
        array $command,
    ): void {
        $allocations = [];
        foreach ($notes as $note) {
            $allocations[$note->id] = DeliveryNoteInvoiceAllocation::withWriting(fn () => DeliveryNoteInvoiceAllocation::create([
                'delivery_note_invoice_draft_build_id' => $build->id,
                'delivery_note_id' => $note->id,
                'invoice_id' => $invoice->id,
                'delivery_note_number_snapshot' => $note->number,
                'delivery_note_status_snapshot' => $note->status,
                'created_by' => $command['actor_id'],
                'created_at' => now(),
            ]));
        }

        foreach ($invoiceItems as $group) {
            $sourceDescription = $group['item']['description'];
            $invoiceLine = InvoiceLine::query()
                ->where('invoice_id', $invoice->id)
                ->where('description', $sourceDescription)
                ->sole();
            foreach ($group['sources'] as $sourceLine) {
                DeliveryNoteLineInvoiceLink::withWriting(fn () => DeliveryNoteLineInvoiceLink::create([
                    'delivery_note_invoice_allocation_id' => $allocations[$sourceLine->delivery_note_id]->id,
                    'delivery_note_line_id' => $sourceLine->id,
                    'invoice_line_id' => $invoiceLine->id,
                    'quantity' => $sourceLine->quantity,
                    'quantity_numerator' => $sourceLine->quantity_numerator,
                    'quantity_denominator' => $sourceLine->quantity_denominator,
                    'unit_name' => $sourceLine->unit_name,
                    'unit_factor' => $sourceLine->unit_factor,
                    'created_by' => $command['actor_id'],
                    'created_at' => now(),
                ]));
            }
        }

        foreach ($notes as $note) {
            DeliveryNoteEvent::withAppend(fn () => DeliveryNoteEvent::create([
                'delivery_note_id' => $note->id,
                'event' => 'sales_invoice_draft_created',
                'from_status' => DeliveryNote::STATUS_CONFIRMED,
                'to_status' => DeliveryNote::STATUS_CONFIRMED,
                'actor_id' => $command['actor_id'],
                'reason' => $command['reason'],
                'metadata' => [
                    'invoice_id' => $invoice->id,
                    'invoice_number' => $invoice->number,
                    'delivery_note_invoice_allocation_id' => $allocations[$note->id]->id,
                    'idempotency_checksum' => $command['checksum'],
                ],
                'occurred_at' => now(),
            ]));
        }
    }

    /** @param array<string,mixed> $data */
    private function previewPriceList(array $data): ?PriceList
    {
        $id = $this->optionalVisiblePriceListId($data);

        return $id === null ? null : PriceList::query()->findOrFail($id);
    }

    private function activeDefaultPriceList(DeliveryNote $note): ?PriceList
    {
        $priceList = $note->customer?->defaultPriceList;

        return $priceList?->is_active ? $priceList : null;
    }

    private function suggestedPrice(DeliveryNoteLine $line, ?PriceList $priceList = null): ?int
    {
        $product = $line->product;
        if (! $product || ! $product->is_active) {
            return null;
        }
        if ($priceList !== null) {
            $unit = $line->unit_name === $product->unit ? null : $line->unit_name;
            $listed = $this->priceLists->resolve($priceList, $product, $unit);
            if ($listed !== null) {
                return $listed;
            }
        }
        if ($line->unit_name === $product->unit && (int) $line->unit_factor === 1) {
            return (int) $product->sale_price > 0 ? (int) $product->sale_price : null;
        }

        return null;
    }

    private function dateString(mixed $value): string
    {
        if ($value === null || $value === '') {
            return now()->toDateString();
        }
        if (! is_string($value)) {
            throw new RuntimeException('تاريخ الفاتورة غير صالح.');
        }
        try {
            return Carbon::parse($value)->toDateString();
        } catch (\Throwable) {
            throw new RuntimeException('تاريخ الفاتورة غير صالح.');
        }
    }

    private function nullableDate(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        return $this->dateString($value);
    }

    private function requiredText(mixed $value, int $maxLength, string $message): string
    {
        $value = $this->nullableText($value, $maxLength);
        if ($value === null) {
            throw new RuntimeException($message);
        }

        return $value;
    }

    private function nullableText(mixed $value, int $maxLength): ?string
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
        if (mb_strlen($value) > $maxLength) {
            throw new RuntimeException('النص المدخل يتجاوز الحد المسموح به.');
        }

        return $value;
    }

    private function idempotencyKey(mixed $value): string
    {
        if (! is_string($value) || ! preg_match('/^[A-Za-z0-9._:-]{8,128}$/', $value)) {
            throw new RuntimeException('مفتاح إعادة الطلب غير صالح.');
        }

        return $value;
    }

    private function strictBoolean(mixed $value, string $label): bool
    {
        if (is_bool($value)) {
            return $value;
        }
        if ($value === 0 || $value === '0') {
            return false;
        }
        if ($value === 1 || $value === '1') {
            return true;
        }
        throw new RuntimeException("{$label} غير صالح.");
    }

    private function integer(mixed $value, string $label, int $min, int $max): int
    {
        if (! is_int($value) && !(is_string($value) && preg_match('/^-?[0-9]+$/', $value))) {
            throw new RuntimeException("{$label} يجب أن يكون عدداً صحيحاً بالهللات.");
        }
        $integer = (int) $value;
        if ($integer < $min || $integer > $max || (string) $integer !== (string) $value) {
            throw new RuntimeException("{$label} يتجاوز الحد المسموح به.");
        }

        return $integer;
    }

    private function positiveInteger(mixed $value, string $label, int $max): bool
    {
        if (! is_int($value) && !(is_string($value) && preg_match('/^[1-9][0-9]*$/', $value))) {
            return false;
        }
        $integer = (int) $value;

        return $integer > 0 && $integer <= $max && (string) $integer === (string) $value;
    }

    private function checkedMultiply(int $left, int $right, string $label): int
    {
        if ($left !== 0 && $right > intdiv(PHP_INT_MAX, $left)) {
            throw new RuntimeException("{$label} تتجاوز الحد المسموح به.");
        }

        return $left * $right;
    }

    private function checkedAdd(int $left, int $right, string $label): int
    {
        if ($right > PHP_INT_MAX - $left) {
            throw new RuntimeException("{$label} تتجاوز الحد المسموح به.");
        }

        return $left + $right;
    }

    private function gcd(int $left, int $right): int
    {
        while ($right !== 0) {
            [$left, $right] = [$right, $left % $right];
        }

        return max(1, $left);
    }

    private function loadInvoice(Invoice $invoice): Invoice
    {
        return $invoice->fresh([
            'partner', 'warehouse', 'priceList', 'lines.product', 'lines.costCenterAllocations.costCenter',
            'deliveryNoteAllocations.deliveryNote', 'deliveryNoteAllocations.lineLinks.deliveryNoteLine',
        ]);
    }
}
