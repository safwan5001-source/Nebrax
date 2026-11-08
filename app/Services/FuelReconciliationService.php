<?php

namespace App\Services;

use App\Models\Account;
use App\Models\FuelOperationalLedger;
use App\Models\FuelProduct;
use App\Models\FuelReconciliation;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\FuelTankReading;
use App\Models\FuelTankReadingRequest;
use App\Models\ProductWarehouseStock;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\AccountRoleResolver;
use App\Services\Accounting\InventoryService;
use App\Services\Accounting\LedgerService;
use App\Tenancy\BranchScope;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Cycle 2: يربط الدليل المادي بالكتاب عبر تسوية صريحة فقط.
 *
 * ATG/physical evidence لا يمس مخزون Nebrax. اعتماد مسودة مؤمنة هو المكان الوحيد
 * الذي ينشئ StockMovement ثم قيداً متوازناً عبر LedgerService في نفس المعاملة.
 */
class FuelReconciliationService
{
    public function __construct(
        private FuelQuantity $quantity,
        private FuelStationSettingsService $settings,
        private FuelCostBasisService $costBasis,
        private InventoryService $inventory,
        private LedgerService $ledger,
        private AccountRoleResolver $roles,
        private FuelStationAuditTrail $audit,
        private FuelTankReadingRequestService $requests,
    ) {}

    /**
     * FUEL-B6: تسجيل قراءة خزان مستقلة (دليل تشغيلي) — الكاتب الوحيد لـ`fuel_tank_readings`.
     *
     * **لا أثر مخزني أو محاسبي أبداً:** لا حركة مخزون ولا متوسط تكلفة ولا قيد ولا تسوية (يحرسه اختبار ساكن). التحويل إلى فروق = دورة التسوية (B7).
     *
     * التحقق (بعد قفل صف الخزان `FOR UPDATE` فيتسلسل ما يخص الخزان الواحد):
     *  1) idempotency بمفتاح الدليل على **بصمة النية الكاملة** (المحطة/الخزان/النوع/الكمية/الفاعل/الوقت الصريح/الأدلة/السبب): المفتاح نفسه والنية نفسها
     *     ⇒ الأثر الأول بلا إنشاء؛ أي اختلاف ⇒ `FUEL_READING_EVIDENCE_MISMATCH`. غياب الوقت الصريح = «وقت الخادم عند الإنشاء» ولا يُقارَن فلا تعارض زائف عند الإعادة؛
     *  2) الخزان ضمن المحطة وفرعها وغير معطَّل؛  3) الكمية ≤ سعة الخزان؛
     *  4) الوقت: صريح في المستقبل (بعد سماحية انحراف الساعة) مرفوض؛ **صريح في الماضي بأكثر من السماحية = قراءة متأخرة** تحكمها سياسة المحطة
     *     (`tank_reading_backdating_policy`، الافتراضي `deny`): `deny` يرفض، `authorized_user` يسجّلها مباشرة لمن يملك `fuel.reading.late.record`،
     *     و`supervisor_approval` يحفظها **طلباً بانتظار الموافقة** (لا قراءة تشغيلية) لمشرف مخوَّل (`FuelTankReadingRequestService`). الحدّ الأقصى للتأخير والسبب
     *     الإلزامي يُفرضان قبل أي مسار؛ والقراءة المتأخرة لا تُعيد ترتيب السجلات القائمة (آخر قراءة = الأحدث قياساً دائماً).
     * يُسجَّل كل إنشاء بحدث تدقيق داخل المعاملة نفسها. `wasRecentlyCreated` يميّز الإنشاء (201) من الإعادة (200).
     *
     * @param array<string, mixed> $data
     */
    public function recordReading(array $data): FuelTankReading|FuelTankReadingRequest
    {
        try {
            return DB::transaction(function () use ($data) {
                $station = $this->station($data['fuel_station_id']);
                $tank = $this->tank($data['fuel_tank_id'], $station);
                $type = $data['reading_type'] ?? '';
                if (! in_array($type, FuelTankReading::TYPES, true)) {
                    throw new RuntimeException('نوع قراءة الخزان غير صالح.');
                }
                $milliliters = $this->quantity->litersToMilliliters($data['quantity_liters']);
                $evidenceKey = trim((string) ($data['evidence_key'] ?? ''));
                if ($evidenceKey === '') {
                    throw new RuntimeException('مفتاح دليل القياس مطلوب.');
                }
                $actorId = $data['recorded_by'] ?? null;
                $evidence = $this->normalizedEvidence($data['evidence'] ?? null);
                $explicitAt = $this->explicitTime($data['measured_at'] ?? null);
                $reason = $this->cleanReason($data['late_reason'] ?? null);
                $hash = $this->intentHash($station->id, $tank->id, $type, $milliliters, $actorId, $explicitAt, $evidence, $reason);

                // تسلسل كل ما يخص هذا الخزان (فحص السياسة + الإدراج) — لا يمسّ بقية الجداول.
                $tank = FuelTank::whereKey($tank->id)->lockForUpdate()->firstOrFail();

                $request = FuelTankReadingRequest::where('evidence_key', $evidenceKey)->first();
                if ($request !== null) {
                    return $this->replay($request->intent_hash === $hash, $request);
                }
                $existing = FuelTankReading::where('evidence_key', $evidenceKey)->first();
                if ($existing !== null) {
                    return $this->replay($this->sameReadingIntent($existing, $hash, $station, $tank, $type, $milliliters, $actorId, $evidence), $existing);
                }

                if ($tank->status === FuelTank::STATUS_INACTIVE) {
                    throw new RuntimeException('FUEL_READING_TANK_INACTIVE: الخزان معطَّل ولا تُسجَّل له قراءات.');
                }
                if ($milliliters > (int) $tank->capacity_milliliters) {
                    throw new RuntimeException('FUEL_READING_EXCEEDS_CAPACITY: الكمية المقاسة تتجاوز سعة الخزان المعتمدة ولا تُقبل.');
                }

                $now = CarbonImmutable::now();
                $skew = (int) $this->settings->get($station, 'device_max_future_skew_seconds');
                if ($explicitAt !== null && $explicitAt->getTimestamp() > $now->getTimestamp() + $skew) {
                    throw new RuntimeException('FUEL_READING_FUTURE_TIME: وقت القياس في المستقبل ولا يُقبل.');
                }
                $backdated = $explicitAt !== null && $explicitAt->getTimestamp() < $now->getTimestamp() - $skew;
                if (! $backdated) {
                    return $this->insertReading($station, $tank, $type, $milliliters, $explicitAt ?? $now, $evidenceKey, $hash, $evidence, $actorId, 'tank_reading.recorded', null);
                }

                $policy = $this->settings->tankReadingBackdating($station);
                if ($policy['policy'] === 'deny') {
                    throw new RuntimeException('FUEL_READING_BACKDATING_DENIED: سياسة المحطة لا تسمح بتسجيل قراءات بتاريخ سابق.');
                }
                if ($now->getTimestamp() - $explicitAt->getTimestamp() > $policy['max_hours'] * 3600) {
                    throw new RuntimeException('FUEL_READING_BACKDATING_TOO_OLD: القراءة أقدم من الحد الأقصى المسموح لتأخير التسجيل في سياسة المحطة ولا تُقبل حتى بموافقة.');
                }
                if ($policy['reason_required'] && $reason === null) {
                    throw new RuntimeException('FUEL_READING_BACKDATING_REASON_REQUIRED: سبب القراءة المتأخرة إلزامي.');
                }

                if ($policy['policy'] === 'authorized_user') {
                    $actor = $actorId === null ? null : User::query()->find($actorId);
                    if ($actor === null || ! $actor->hasPermission(self::LATE_RECORD_PERMISSION)) {
                        throw new RuntimeException('FUEL_READING_BACKDATING_NOT_AUTHORIZED: تسجيل قراءة بتاريخ سابق يتطلب صلاحية مخصَّصة لذلك.');
                    }
                    $late = $evidence + ['late_reason' => $reason];

                    return $this->insertReading($station, $tank, $type, $milliliters, $explicitAt, $evidenceKey, $hash, $late, $actorId, 'tank_reading.recorded_late', $reason);
                }

                return $this->requests->create($station, $tank, $type, $milliliters, $explicitAt, $evidenceKey, $hash, $evidence, $reason, $actorId);
            });
        } catch (QueryException $exception) {
            if (str_contains($exception->getMessage(), 'fuel_reading_evidence_unique') || str_contains($exception->getMessage(), 'fuel_reading_request_evidence_unique')) {
                throw new RuntimeException('FUEL_READING_EVIDENCE_MISMATCH: مفتاح دليل القياس مستخدم مسبقاً ولا يمكن تسجيل القياس مرتين.', previous: $exception);
            }

            throw $exception;
        }
    }

    public const LATE_RECORD_PERMISSION = 'fuel.reading.late.record';

    /**
     * يُنشئ القراءة المعتمدة من طلب متأخر (يُستدعى من `FuelTankReadingRequestService::decide` داخل معاملته بعد قفل الخزان ثم الطلب).
     * وقت القياس الأصلي محفوظ كما هو؛ وقت الاعتماد = `created_at` للقراءة و`decided_at` للطلب. لا إعادة ترتيب ولا تعديل لقراءة قائمة.
     */
    public function materializeLateRequest(FuelTankReadingRequest $request, FuelStation $station, FuelTank $tank, User $approver): FuelTankReading
    {
        if ($tank->status === FuelTank::STATUS_INACTIVE) {
            throw new RuntimeException('FUEL_READING_TANK_INACTIVE: الخزان معطَّل ولا تُسجَّل له قراءات.');
        }
        if ((int) $request->quantity_milliliters > (int) $tank->capacity_milliliters) {
            throw new RuntimeException('FUEL_READING_EXCEEDS_CAPACITY: الكمية المقاسة تتجاوز سعة الخزان المعتمدة ولا تُقبل.');
        }
        $evidence = $this->normalizedEvidence($request->evidence) + ['late_reason' => $request->reason, 'late_request_id' => $request->id];

        return $this->insertReading(
            $station, $tank, $request->reading_type, (int) $request->quantity_milliliters, CarbonImmutable::instance($request->measured_at),
            $request->evidence_key, $request->intent_hash, $evidence, $request->requested_by, 'tank_reading.recorded_late', 'late_request:' . $request->id, $approver,
        );
    }

    /** @param array<string,mixed>|null $evidence */
    private function insertReading(FuelStation $station, FuelTank $tank, string $type, int $milliliters, CarbonImmutable $measuredAt, string $key, string $hash, ?array $evidence, mixed $actorId, string $auditAction, ?string $auditReason, ?User $auditActor = null): FuelTankReading
    {
        $reading = FuelTankReading::create([
            'branch_id' => $station->branch_id,
            'fuel_station_id' => $station->id,
            'fuel_tank_id' => $tank->id,
            'reading_type' => $type,
            'quantity_milliliters' => $milliliters,
            'measured_at' => $measuredAt,
            'evidence_key' => $key,
            'intent_hash' => $hash,
            'evidence' => $evidence === [] ? null : $evidence,
            'recorded_by' => $actorId,
        ]);
        $this->audit->record(
            $auditAction,
            $reading,
            null,
            $this->audit->snapshot($reading),
            $auditActor ?? ($actorId === null ? null : User::query()->find($actorId)),
            $auditReason,
        );

        return $reading;
    }

    private function replay(bool $same, FuelTankReading|FuelTankReadingRequest $existing): FuelTankReading|FuelTankReadingRequest
    {
        if (! $same) {
            throw new RuntimeException('FUEL_READING_EVIDENCE_MISMATCH: مفتاح دليل القياس مستخدم مسبقاً ولا يمكن تسجيل القياس مرتين.');
        }

        return $existing; // إعادة إرسال مقصودة/منقطعة: الأثر الأول نفسه بلا إنشاء ولا تدقيق ثانٍ.
    }

    /**
     * مطابقة النية لقراءة قائمة. ذات بصمة ⇒ مقارنة البصمة الكاملة. قراءة سابقة للبصمة (`NULL`) ⇒ حقولها الظاهرة (المحطة/الخزان/النوع/الكمية/الفاعل/الأدلة)
     * دون الوقت (غير قابل للمقارنة بدقة بلا معرفة إن كان صريحاً).
     *
     * @param array<string,mixed>|null $evidence
     */
    private function sameReadingIntent(FuelTankReading $existing, string $hash, FuelStation $station, FuelTank $tank, string $type, int $milliliters, mixed $actorId, ?array $evidence): bool
    {
        if ($existing->intent_hash !== null) {
            return hash_equals((string) $existing->intent_hash, $hash);
        }

        return $existing->fuel_station_id === $station->id
            && $existing->fuel_tank_id === $tank->id
            && $existing->reading_type === $type
            && (int) $existing->quantity_milliliters === $milliliters
            && $existing->recorded_by === $actorId
            && $this->normalizedEvidence($existing->evidence) === ($evidence ?? []);
    }

    /** @param array<string,mixed>|null $evidence */
    private function intentHash(string $stationId, string $tankId, string $type, int $ml, mixed $actorId, ?CarbonImmutable $explicitAt, ?array $evidence, ?string $reason): string
    {
        return hash('sha256', json_encode([
            's' => $stationId, 'k' => $tankId, 't' => $type, 'q' => $ml, 'a' => $actorId,
            'at' => $explicitAt?->utc()->format('Y-m-d\TH:i:s'), // غياب الوقت الصريح = null = «وقت الخادم»
            'e' => $evidence ?? [], 'r' => $reason,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    }

    /** @return array<string,mixed> أدلة مرتّبة المفاتيح تكرارياً، فارغة ⇒ []. */
    private function normalizedEvidence(mixed $evidence): array
    {
        if (! is_array($evidence) || $evidence === []) {
            return [];
        }
        $sort = function (array $values) use (&$sort): array {
            foreach ($values as $key => $value) {
                if (is_array($value)) {
                    $values[$key] = $sort($value);
                } elseif (is_string($value)) {
                    $values[$key] = trim($value);
                }
            }
            if (! array_is_list($values)) {
                ksort($values);
            }

            return $values;
        };

        return $sort($evidence);
    }

    private function explicitTime(mixed $given): ?CarbonImmutable
    {
        if ($given === null || $given === '') {
            return null;
        }
        try {
            return CarbonImmutable::parse($given)->utc()->startOfSecond();
        } catch (\Throwable $exception) {
            throw new RuntimeException('وقت القياس غير صالح.', previous: $exception);
        }
    }

    private function cleanReason(mixed $reason): ?string
    {
        if (! is_string($reason)) {
            return null;
        }
        $clean = trim($reason);

        return $clean === '' ? null : mb_substr($clean, 0, 500);
    }

    /** @param array<string, mixed> $data */
    public function createDraft(array $data): FuelReconciliation
    {
        try {
            return DB::transaction(function () use ($data) {
            $station = $this->station($data['fuel_station_id']);
            $warehouse = $this->warehouse($station);
            $tank = $this->tank($data['fuel_tank_id'], $station);
            $fuelProduct = $this->fuelProduct($tank->fuel_product_id);
            $product = $this->product($fuelProduct);
            $this->quantity->assertFuelUnitMapping($fuelProduct, $product);
            $this->assertSingleTankPerBook($fuelProduct, $warehouse);
            $settings = $this->settings->forStation($station);
            $this->assertNoUnsupportedSourceTotals($data);

            // Cycle 2 لا يستقبل إجماليات تسليم/بيع/تحويل من العميل: لا بد أن تأتي
            // هذه الحركات لاحقاً من مصادر تشغيلية موثقة. رصيد المخزن الرسمي هو
            // opening ويمتلك بالفعل أثر كل حركة معتمدة سابقة.
            $opening = $this->bookBalance($warehouse->id, $product->id);
            $deliveries = 0;
            $sales = 0;
            $transfers = 0;
            $adjustments = 0;
            $expected = $opening;
            if ($expected < 0) {
                throw new RuntimeException('الرصيد المتوقع للخزان لا يمكن أن يكون سالباً. راجع الحركات المرسلة.');
            }

            $physical = $this->reading($data['physical_reading_id'] ?? null, $station, $tank, FuelTankReading::TYPE_PHYSICAL);
            $atg = $this->reading($data['atg_reading_id'] ?? null, $station, $tank, FuelTankReading::TYPE_ATG);
            foreach ([$physical?->id, $atg?->id] as $readingId) {
                if ($readingId !== null && FuelReconciliation::where('physical_reading_id', $readingId)->orWhere('atg_reading_id', $readingId)->exists()) {
                    throw new RuntimeException('لا يمكن إعادة استخدام دليل القياس في تسوية أخرى.');
                }
            }
            $variance = $physical ? $physical->quantity_milliliters - $expected : null;
            $basisPoints = $this->varianceBasisPoints($variance, $expected);

            return FuelReconciliation::create([
                'branch_id' => $station->branch_id,
                'fuel_station_id' => $station->id,
                'fuel_tank_id' => $tank->id,
                'fuel_product_id' => $fuelProduct->id,
                'warehouse_id' => $warehouse->id,
                'opening_book_milliliters' => $opening,
                'deliveries_milliliters' => $deliveries,
                'sales_milliliters' => $sales,
                'transfers_milliliters' => $transfers,
                'prior_adjustments_milliliters' => $adjustments,
                'expected_closing_milliliters' => $expected,
                'physical_closing_milliliters' => $physical?->quantity_milliliters,
                'atg_closing_milliliters' => $atg?->quantity_milliliters,
                'variance_milliliters' => $variance,
                'variance_basis_points' => $basisPoints,
                'tolerance_absolute_milliliters' => (int) $settings['reconciliation_tolerance_absolute_milliliters'],
                'tolerance_basis_points' => (int) $settings['reconciliation_tolerance_basis_points'],
                // Explicit approval remains required even inside tolerance; tolerance is audit metadata, never erasure.
                'requires_approval' => true,
                'physical_reading_id' => $physical?->id,
                'atg_reading_id' => $atg?->id,
                'created_by' => $data['created_by'] ?? null,
                'reason' => $this->nullableTrim($data['reason'] ?? null),
            ]);
            });
        } catch (QueryException $exception) {
            if (str_contains($exception->getMessage(), 'fuel_reconciliations_physical_reading_unique') || str_contains($exception->getMessage(), 'fuel_reconciliations_atg_reading_unique')) {
                throw new RuntimeException('لا يمكن إعادة استخدام دليل القياس في تسوية أخرى.', previous: $exception);
            }

            throw $exception;
        }
    }

    public function approve(FuelReconciliation $reconciliation, string $approverId, ?string $reason = null): FuelReconciliation
    {
        if (! $reconciliation->isDraft()) {
            throw new RuntimeException('لا يمكن اعتماد تسوية غير مسودة.');
        }
        if (! \App\Models\User::whereKey($approverId)->exists()) {
            throw new RuntimeException('الموافق لا ينتمي إلى المستأجر.');
        }

        return DB::transaction(function () use ($reconciliation, $approverId, $reason) {
            $reconciliation = FuelReconciliation::lockForUpdate()->findOrFail($reconciliation->id);
            if (! $reconciliation->isDraft()) {
                throw new RuntimeException('لا يمكن اعتماد تسوية غير مسودة.');
            }
            if ($reconciliation->physical_closing_milliliters === null || $reconciliation->variance_milliliters === null) {
                throw new RuntimeException('لا يمكن اعتماد تسوية بلا قراءة مادية Physical. قراءة ATG دليل مستقل ولا تعدل الكتاب.');
            }

            $station = $this->station($reconciliation->fuel_station_id);
            // FUEL-B2: فصل المعتمِد عن المنشئ حين تلزم سياسة المحطة — داخل المعاملة وبعد قفل المسودة وقبل أي أثر مخزني أو محاسبي.
            $this->settings->assertDistinctApprover($station, $reconciliation->created_by, $approverId, 'تسوية المخزون');
            $warehouse = $this->warehouse($station);
            if ($warehouse->id !== $reconciliation->warehouse_id) {
                throw new RuntimeException('تغير تكوين مخزن المحطة بعد إنشاء المسودة. أنشئ تسوية جديدة حتى يبقى التاريخ صادقاً.');
            }
            $fuelProduct = $this->fuelProduct($reconciliation->fuel_product_id);
            $product = $this->product($fuelProduct);
            $this->quantity->assertFuelUnitMapping($fuelProduct, $product);
            // FUEL-LOCK-ORDER-2: مِرساة المستأجر قبل قفل المنتج/الرصيد/حالة التكلفة (ترتيب ERP: مِرساة ← مجمّع). كان القفل بعد المجمّع ⇒ جمود مع إنهاء بيع. لا أثر محاسبي أو مخزني.
            // الخزان `FOR KEY SHARE` قبل المِرساة (نمط #2066): صف الدفتر التشغيلي اللاحق يحتاج KEY SHARE على الخزان و`recordReading` يمسكه FOR UPDATE ثم يطلب KEY SHARE على المستأجر.
            \App\Models\FuelTank::query()->whereKey($reconciliation->fuel_tank_id)->lock('for key share')->first();
            // صف المنتج `FOR NO KEY UPDATE` أيضاً قبل المِرساة: تعديل بطاقة المنتج (`ProductLifecycleService::update`) يمسكه `FOR UPDATE` ثم يُدرج نشاطاً يحتاج KEY SHARE على المستأجر المتعارض مع المِرساة
            // (فنقفله قبلها كترتيب `main`). **ليس `FOR UPDATE`**: بيع ERP يمسك المِرساة ثم يُدرج حركة مخزون تحتاج `KEY SHARE` على صف المنتج (FK)، و`FOR UPDATE` يتعارض معه ⇒ جمود (CI: 40P01).
            // `NO KEY UPDATE` لا يتعارض مع KEY SHARE ويُسلسل التسويات المتزامنة على المنتج نفسه.
            BranchScope::reference(\App\Models\Product::class)->lock('for no key update')->findOrFail($product->id);
            app(\App\Services\Accounting\AccountingDateGuard::class)->lockLedgerAnchor();
            $this->lockBookStock($warehouse->id, $product->id);
            // FS-01: قد يُضاف خزان ثانٍ بعد إنشاء المسودة؛ نعيد الفحص تحت القفل ولا نقبل فرقاً محسوباً على كتاب مشترك.
            $this->assertSingleTankPerBook($fuelProduct, $warehouse);
            $difference = (int) $reconciliation->variance_milliliters;
            $unitCost = 0; // توافق StockMovement فقط؛ Fuel Cost Basis هو مصدر القيمة.
            $value = 0;
            $stockMovement = null;
            $entry = null;

            if ($difference > 0) {
                $quote = $this->costBasis->quoteGain($fuelProduct, $warehouse, $difference);
                $value = $quote['posted_cost_minor'];
                $unitCost = intdiv($value, $difference);
                $stockMovement = $this->inventory->applyReceipt($product, $difference, $unitCost, $this->movementMeta($reconciliation, $warehouse, $station), $value);
                $entry = $this->postEntry($reconciliation, $station, $value, true, $approverId);
                $this->costBasis->recordGain($fuelProduct, $warehouse, $stockMovement, $difference, $value, $entry);
            } elseif ($difference < 0) {
                $lossQuantity = -$difference;
                $this->assertWarehouseAvailable($warehouse->id, $product->id, $lossQuantity);
                $quote = $this->costBasis->quoteIssue($fuelProduct, $warehouse, $lossQuantity);
                $lossValue = $quote['posted_cost_minor'];
                $value = -$lossValue;
                $unitCost = intdiv($lossValue, $lossQuantity);
                $stockMovement = $this->inventory->applyIssue($product, $lossQuantity, $unitCost, $this->movementMeta($reconciliation, $warehouse, $station) + ['enforce_stock' => true], $lossValue);
                $entry = $this->postEntry($reconciliation, $station, $lossValue, false, $approverId);
                $this->costBasis->recordIssue($fuelProduct, $warehouse, $stockMovement, $lossQuantity, $lossValue, $entry);
            }

            $balance = $this->bookBalance($warehouse->id, $product->id);
            FuelOperationalLedger::create([
                'branch_id' => $station->branch_id,
                'fuel_station_id' => $station->id,
                'fuel_tank_id' => $reconciliation->fuel_tank_id,
                'fuel_product_id' => $fuelProduct->id,
                'warehouse_id' => $warehouse->id,
                'fuel_reconciliation_id' => $reconciliation->id,
                'stock_movement_id' => $stockMovement?->id,
                'movement_type' => $difference > 0
                    ? FuelOperationalLedger::TYPE_ADJUSTMENT_GAIN
                    : ($difference < 0 ? FuelOperationalLedger::TYPE_ADJUSTMENT_LOSS : FuelOperationalLedger::TYPE_RECONCILIATION_MATCHED),
                'quantity_milliliters' => $difference,
                'book_balance_milliliters' => $balance,
                'unit_cost_minor' => $unitCost,
                'value_minor' => $value,
                'idempotency_key' => 'reconciliation:' . $reconciliation->id,
                'source_type' => FuelReconciliation::class,
                'source_id' => $reconciliation->id,
                'occurred_at' => now(),
                'notes' => $reason ?? $reconciliation->reason,
            ]);

            $reconciliation->update([
                'status' => FuelReconciliation::STATUS_APPROVED,
                'unit_cost_minor' => $unitCost,
                'financial_variance_minor' => $value,
                'stock_movement_id' => $stockMovement?->id,
                'journal_entry_id' => $entry?->id,
                'approved_by' => $approverId,
                'approved_at' => now(),
                'reason' => $reason ?? $reconciliation->reason,
            ]);

            return $reconciliation->fresh();
        });
    }

    private function station(string $id): FuelStation
    {
        return FuelStation::findOrFail($id);
    }

    private function tank(string $id, FuelStation $station): FuelTank
    {
        $tank = FuelTank::whereKey($id)->first();
        if (! $tank || $tank->fuel_station_id !== $station->id || $tank->branch_id !== $station->branch_id) {
            throw new RuntimeException('الخزان لا ينتمي إلى المحطة وفرعها.');
        }
        return $tank;
    }

    private function warehouse(FuelStation $station): Warehouse
    {
        if ($station->warehouse_id === null) {
            throw new RuntimeException('المحطة بلا مخزن معيّن. عيّن مخزناً صريحاً قبل أي حركة وقود رسمية.');
        }
        $warehouse = Warehouse::whereKey($station->warehouse_id)->first();
        if (! $warehouse || $warehouse->tenant_id !== $station->tenant_id || ! $warehouse->is_active || ($warehouse->branch_id !== null && $warehouse->branch_id !== $station->branch_id)) {
            throw new RuntimeException('مخزن المحطة غير صالح أو لا يطابق المستأجر/الفرع.');
        }
        return $warehouse;
    }

    private function fuelProduct(string $id): FuelProduct
    {
        $fuelProduct = FuelProduct::find($id);
        if (! $fuelProduct || ! $fuelProduct->is_active) throw new RuntimeException('منتج الوقود غير صالح أو معطل.');
        return $fuelProduct;
    }

    private function product(FuelProduct $fuelProduct): \App\Models\Product
    {
        $product = BranchScope::reference(\App\Models\Product::class)->find($fuelProduct->product_id);
        if (! $product || ! $product->is_active || ! $product->track_inventory) throw new RuntimeException('منتج Nebrax المرتبط يجب أن يكون نشطاً ومتابعاً مخزنياً.');
        return $product;
    }

    private function reading(?string $id, FuelStation $station, FuelTank $tank, string $type): ?FuelTankReading
    {
        if ($id === null) return null;
        $reading = FuelTankReading::whereKey($id)->first();
        if (! $reading || $reading->fuel_station_id !== $station->id || $reading->fuel_tank_id !== $tank->id || $reading->reading_type !== $type) {
            throw new RuntimeException('دليل القراءة لا يطابق المحطة أو الخزان أو النوع المطلوب.');
        }
        return $reading;
    }

    /** @param array<string,mixed> $data */
    private function liters(array $data, string $key): int { return array_key_exists($key, $data) ? $this->quantity->litersToMilliliters($data[$key]) : 0; }
    /** @param array<string,mixed> $data */
    private function signedLiters(array $data, string $key): int
    {
        if (! array_key_exists($key, $data)) return 0;
        $raw = trim((string) $data[$key]);
        $negative = str_starts_with($raw, '-');
        return ($negative ? -1 : 1) * $this->quantity->litersToMilliliters(ltrim($raw, '+-'));
    }

    /**
     * FS-01: الكتاب الرسمي (ProductWarehouseStock) بمستوى (مخزن، منتج)، بينما القراءة المادية
     * لخزان واحد. مع أكثر من خزان غير معطّل يغذّي الكتاب نفسه تُقارَن قراءة خزان برصيد الجميع
     * فيُنتج فقداً/زيادة كاذبة بقيد فعلي. لا دفتر لكل خزان بعد، فالرفض المغلق هو السلوك الآمن
     * (لا سياسة محاسبية جديدة): تسوية خزان وحيد لكل (مخزن، منتج) فقط.
     */
    private function assertSingleTankPerBook(FuelProduct $fuelProduct, Warehouse $warehouse): void
    {
        $stationIds = FuelStation::where('warehouse_id', $warehouse->id)->pluck('id');
        $tanks = FuelTank::whereIn('fuel_station_id', $stationIds)
            ->where('fuel_product_id', $fuelProduct->id)
            ->where('status', '!=', FuelTank::STATUS_INACTIVE)
            ->count();
        if ($tanks > 1) {
            throw new RuntimeException('FUEL_RECONCILIATION_MULTI_TANK_UNSUPPORTED: يوجد أكثر من خزان غير معطّل لنفس منتج الوقود في مخزن المحطة، والتسوية الرسمية تقارن قراءة خزان واحد برصيد المخزن كله. عطّل الخزانات غير المستخدمة أو انتظر دعم دفتر لكل خزان.');
        }
    }

    private function bookBalance(string $warehouseId, string $productId): int
    {
        return (int) (ProductWarehouseStock::where('warehouse_id', $warehouseId)->where('product_id', $productId)->value('quantity') ?? 0);
    }

    private function lockBookStock(string $warehouseId, string $productId): void
    {
        // يقفل المنتج حتى حين لا يوجد صف رصيد بعد، ثم يقفل صف الرصيد إن وُجد.
        // هكذا لا تعتمد تسويتان متزامنتان لقطة تكلفة/رصيد متنافرتين.
        // `NO KEY UPDATE` لا `FOR UPDATE`: لا نرقّي القفل بعد المِرساة ولا نتعارض مع KEY SHARE الذي يأخذه بيع ERP على المنتج (انظر أعلاه).
        BranchScope::reference(\App\Models\Product::class)->lock('for no key update')->findOrFail($productId);
        ProductWarehouseStock::where('warehouse_id', $warehouseId)
            ->where('product_id', $productId)
            ->lockForUpdate()
            ->first();
    }

    private function assertWarehouseAvailable(string $warehouseId, string $productId, int $quantity): void
    {
        if ($this->bookBalance($warehouseId, $productId) < $quantity) throw new RuntimeException('فرق الفقد يتجاوز رصيد الوقود المتاح في مخزن المحطة.');
    }

    private function multiply(int $quantity, int $unitCost): int
    {
        if ($quantity !== 0 && abs($unitCost) > intdiv(PHP_INT_MAX, abs($quantity))) throw new RuntimeException('قيمة فرق الوقود تتجاوز الحد المسموح به.');
        return $quantity * $unitCost;
    }

    /** @return array<string,mixed> */
    private function movementMeta(FuelReconciliation $r, Warehouse $warehouse, FuelStation $station): array
    {
        return ['warehouse_id' => $warehouse->id, 'date' => $this->settings->businessDate($station), 'source_type' => FuelReconciliation::class, 'source_id' => $r->id, 'notes' => 'تسوية وقود معتمدة', InventoryService::FUEL_POOL_META => true];
    }

    private function postEntry(FuelReconciliation $r, FuelStation $station, int $amount, bool $gain, string $approverId): ?\App\Models\JournalEntry
    {
        if ($amount === 0) return null;
        $settings = $this->settings->forStation($station);
        $variance = $this->account(
            $settings[$gain ? 'inventory_gain_account_id' : 'inventory_variance_account_id'] ?? null,
            'inventory_count_variance',
            $gain ? ['expense', 'revenue'] : ['expense'],
        );
        $inventory = $this->account($station->default_inventory_account_id, 'inventory_asset', ['asset']);
        // FS-32: فرع القيد = فرع المحطة (كحركة المخزون ومسار الاستلام) لا فرع سياق الموافق.
        $branchId = $station->branch_id;
        $lines = $gain
            ? [['account_id' => $inventory->id, 'debit' => $amount, 'branch_id' => $branchId], ['account_id' => $variance->id, 'credit' => $amount, 'branch_id' => $branchId]]
            : [['account_id' => $variance->id, 'debit' => $amount, 'branch_id' => $branchId], ['account_id' => $inventory->id, 'credit' => $amount, 'branch_id' => $branchId]];
        return $this->ledger->post($lines, ['entry_date' => $this->settings->businessDate($station), 'description' => $gain ? 'زيادة تسوية وقود' : 'فقد تسوية وقود', 'source_type' => FuelReconciliation::class, 'source_id' => $r->id, 'created_by' => $approverId]);
    }

    /** @param array<int, string> $allowedTypes */
    /** FS-34: تجاوز المحطة/الإعداد الصريح يتقدّم؛ وإلا الدور المحاسبي المعتمد (لا الكود الثابت). */
    private function account(?string $id, string $roleKey, array $allowedTypes): Account
    {
        $account = $id ? Account::whereKey($id)->first() : $this->roles->resolve($roleKey);
        if (! $account || $account->is_group || ! $account->is_active || ! in_array($account->type, $allowedTypes, true)) {
            throw new RuntimeException('حساب فرق أو مخزون الوقود غير صالح للترحيل أو لا يملك الاتجاه المحاسبي المطلوب.');
        }
        return $account;
    }

    /** @param array<string, mixed> $data */
    private function assertNoUnsupportedSourceTotals(array $data): void
    {
        foreach (['deliveries_liters', 'sales_liters', 'transfers_liters', 'prior_adjustments_liters'] as $key) {
            if (! array_key_exists($key, $data) || trim((string) $data[$key]) === '') {
                continue;
            }
            $quantity = in_array($key, ['transfers_liters', 'prior_adjustments_liters'], true)
                ? $this->signedLiters($data, $key)
                : $this->liters($data, $key);
            if ($quantity !== 0) {
                throw new RuntimeException('لا تقبل تسوية Cycle 2 إجماليات حركات يدوية. استخدم مصدراً تشغيلياً موثقاً عند بناء دورة التسليم أو البيع أو التحويل.');
            }
        }
    }

    private function varianceBasisPoints(?int $variance, int $expected): ?int
    {
        if ($variance === null || $expected === 0) {
            return null;
        }
        if (abs($variance) > intdiv(PHP_INT_MAX, 10000)) {
            throw new RuntimeException('نسبة فرق الوقود تتجاوز الحد المسموح به.');
        }

        return intdiv($variance * 10000, $expected);
    }

    private function nullableTrim(?string $value): ?string { $value = trim((string) $value); return $value === '' ? null : $value; }
}
