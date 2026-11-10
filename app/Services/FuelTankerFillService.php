<?php

namespace App\Services;

use App\Models\FuelNozzle;
use App\Models\FuelProduct;
use App\Models\FuelPump;
use App\Models\FuelShift;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\FuelTanker;
use App\Models\FuelTankerFill;
use App\Models\FuelTankerOwner;
use App\Models\Product;
use App\Models\User;
use App\Tenancy\BranchContext;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * TANKER-PR4 — **الكاتب الوحيد** لسندات تعبئة الصهاريج (`fuel_tanker_fills`).
 *
 * ⚠ سجل تشغيلي فقط: **لا** خصم مخزون ولا حركة مخزون ولا قيد ولا فاتورة ولا تحصيل ولا عمولة ولا مخزون داخلي للصهريج (التكامل المخزني PR-6 بعد اعتماد قواعده).
 * لا يستدعي `InventoryService`/`LedgerService`/`InvoiceService`/`PaymentService` ولا يلمس `StockMovement` (يحرسه اختبار ساكن). السند المسجَّل `inventory_status = pending_integration`.
 *
 * ترتيب الأقفال (يطابق `FUEL-LOCK-ORDER`): المحطة `FOR NO KEY UPDATE` ← الفوهة `FOR SHARE` ← المضخة/الخزان `FOR KEY SHARE` ← الوردية `FOR SHARE` ← صاحب الصهريج/الصهريج `FOR SHARE`
 * ← مِرساة الترقيم (داخل `nextDocumentNumber`) ← الإدراج. قفل المحطة يُسلسل كل تعبئات المحطة (فيستحيل تسجيل السند نفسه مرتين تزامنياً داخل المحطة)، والفهرس الفريد في القاعدة خط الدفاع
 * الأخير للنطاقات الأوسع (مؤسسة/صاحب صهريج). قفل الوردية `FOR SHARE` يتعارض مع `FOR UPDATE` الذي يأخذه الإغلاق: لا تعبئة تُسجَّل في وردية تُغلق في اللحظة نفسها.
 *
 * Idempotency: الإعادة بالمفتاح نفسه تُحسم قبل أي تقييم جديد وتعيد السجل الأول (حتى لو أُغلقت الوردية بعده)؛ اختلاف محتوى الطلب ⇒ 409. المحتوى يُقارَن ببصمة (`request_fingerprint`).
 */
class FuelTankerFillService
{
    public function __construct(
        private FuelStationSettingsService $settings,
        private FuelStationAuditTrail $audit,
        private FuelQuantity $quantity,
    ) {}

    /**
     * @param  array<string,mixed>  $attributes
     * @return array{fill: FuelTankerFill, replayed: bool}
     *
     * @throws FuelTankerFillException
     */
    public function record(array $attributes, User $actor): array
    {
        $this->requirePermission($actor, 'fuel.tanker.fill.record');
        $intent = $this->parseIntent($attributes);

        try {
            return DB::transaction(fn () => $this->recordInTransaction($intent, $actor));
        } catch (UniqueConstraintViolationException $exception) {
            return $this->resolveUniqueViolation($intent, $actor, $exception);
        }
    }

    /**
     * إلغاء سند بسبب: الانتقال الوحيد المسموح. رقم السند الورقي يبقى محجوزاً (الصف لا يُحذف). مسموح ما دامت الوردية مفتوحة فقط (بعد الإغلاق تحكم مراجعة الفروق، لا تعديل صامت).
     *
     * @throws FuelTankerFillException
     */
    public function void(FuelTankerFill $fill, string $reason, User $actor): FuelTankerFill
    {
        $this->requirePermission($actor, 'fuel.tanker.fill.void');
        $reason = trim($reason);
        if ($reason === '' || mb_strlen($reason) > 500) {
            throw new FuelTankerFillException(FuelTankerFillException::INVALID_INPUT, 'سبب الإلغاء مطلوب (حتى 500 حرف).');
        }

        return DB::transaction(function () use ($fill, $reason, $actor) {
            $station = FuelStation::query()->lock('for no key update')->find($fill->fuel_station_id);
            if ($station === null || ! $actor->canAccessFuelStation($station)) {
                throw $this->notFound();
            }
            $locked = FuelTankerFill::query()->withoutGlobalScope(BranchScope::class)->lockForUpdate()->find($fill->id);
            if ($locked === null) {
                throw $this->notFound();
            }
            if ($locked->status === FuelTankerFill::STATUS_VOIDED) {
                return $locked; // idempotent: السند ملغى سابقاً، بلا أثر ولا تغيير للسبب/المنفّذ/الوقت
            }
            $shift = FuelShift::query()->withoutGlobalScope(BranchScope::class)->lock('for share')->find($locked->fuel_shift_id);
            if ($shift === null || ! $shift->isOpen()) {
                throw new FuelTankerFillException(FuelTankerFillException::SHIFT_NOT_OPEN, 'لا يُلغى سند تعبئة بعد إغلاق وردية المحطة؛ يُعالج الفرق عبر مراجعة الوردية.');
            }

            $before = $this->audit->snapshot($locked);
            $locked->forceFill([
                'status' => FuelTankerFill::STATUS_VOIDED,
                'voided_by' => $actor->id,
                'voided_at' => now(),
                'void_reason' => $reason,
            ])->save();
            $this->audit->record('tanker_fill.voided', $locked, $before, $this->audit->snapshot($locked->fresh()), $actor, $reason);

            return $locked->fresh();
        });
    }

    // ───────────────────────── التسجيل ─────────────────────────

    /**
     * @param  array<string,mixed>  $intent
     * @return array{fill: FuelTankerFill, replayed: bool}
     */
    private function recordInTransaction(array $intent, User $actor): array
    {
        $station = FuelStation::query()->lock('for no key update')->find($intent['station_id']);
        if ($station === null) {
            throw $this->notFound();
        }
        $this->assertStationUsable($station, $actor);

        // الإعادة بالمفتاح تُحسم قبل أي تقييم جديد (الوردية قد تكون أُغلقت، والسياسات قد تغيّرت).
        $existing = FuelTankerFill::query()->withoutGlobalScope(BranchScope::class)->where('idempotency_key', $intent['key'])->first();
        if ($existing !== null) {
            return ['fill' => $this->assertReplay($existing, $intent, $actor), 'replayed' => true];
        }

        $policy = $this->settings->tankerFillPolicy($station);

        $nozzle = FuelNozzle::query()->lock('for share')->find($intent['nozzle_id']);
        if ($nozzle === null || $nozzle->fuel_station_id !== $station->id || $nozzle->branch_id !== $station->branch_id) {
            throw new FuelTankerFillException(FuelTankerFillException::INVALID_INPUT, 'الفوهة غير موجودة أو لا تخص محطة التعبئة.');
        }
        if ($nozzle->status !== FuelNozzle::STATUS_ACTIVE) {
            throw new FuelTankerFillException(FuelTankerFillException::EQUIPMENT_NOT_OPERATIONAL, 'الفوهة غير نشطة.');
        }
        if (! $nozzle->allowsOperation(FuelNozzle::OPERATION_TANKER_FILL)) {
            throw new FuelTankerFillException(FuelTankerFillException::NOZZLE_OPERATION_NOT_ALLOWED, 'هذه الفوهة غير مسموح لها بتعبئة الصهاريج (قيد عمليات الفوهة).');
        }

        $pump = FuelPump::query()->lock('for key share')->find($nozzle->fuel_pump_id);
        $tank = FuelTank::query()->lock('for key share')->find($nozzle->fuel_tank_id);
        $this->assertEquipment($pump, $tank, $station);
        $fuelProduct = $this->assertProduct($nozzle, $tank, $intent);

        $shift = $this->lockedOpenShift($station, $intent['shift_id']);

        $owner = FuelTankerOwner::query()->lock('for share')->find($intent['owner_id']);
        if ($owner === null) {
            throw new FuelTankerFillException(FuelTankerFillException::INVALID_INPUT, 'صاحب الصهريج غير موجود.');
        }
        if ($owner->status !== FuelTankerOwner::STATUS_ACTIVE) {
            throw new FuelTankerFillException(FuelTankerFillException::OWNER_INACTIVE, 'صاحب الصهريج غير نشط.');
        }
        $tanker = $this->resolveTanker($intent['tanker_id'], $owner, $policy['selection_required']);

        $this->serializeVoucher($intent['voucher_key'], $policy['voucher_unique_scope']);
        $this->assertVoucherAvailable($intent, $policy['voucher_unique_scope'], $station, $owner, $actor);
        $overrun = $this->evaluateCapacity($tanker, $intent['quantity_milliliters'], $policy['capacity_overrun_policy'], $intent['confirm_overrun']);

        $id = (string) Str::uuid();
        $fill = new FuelTankerFill([
            'branch_id' => $station->branch_id,
            'fuel_station_id' => $station->id,
            'fuel_shift_id' => $shift->id,
            'fuel_pump_id' => $pump->id,
            'fuel_nozzle_id' => $nozzle->id,
            'fuel_tank_id' => $tank->id,
            'fuel_product_id' => $fuelProduct->id,
            'fuel_tanker_owner_id' => $owner->id,
            'fuel_tanker_id' => $tanker?->id,
            'number' => FuelTankerFill::nextDocumentNumber('FTF', $this->settings->businessDate($station), $station->branch_id),
            'voucher_number' => $intent['voucher_display'],
            'voucher_key' => $intent['voucher_key'],
            'voucher_scope' => $policy['voucher_unique_scope'],
            'voucher_scope_key' => $this->scopeKey($policy['voucher_unique_scope'], $id, $station->id, $owner->id),
            'quantity_milliliters' => $intent['quantity_milliliters'],
            'tanker_capacity_milliliters' => $tanker?->capacity_milliliters,
            'capacity_overrun_milliliters' => $overrun['overrun'],
            'capacity_overrun_policy' => $overrun['overrun'] === null ? null : $policy['capacity_overrun_policy'],
            'capacity_overrun_confirmed_by' => $overrun['confirmed'] ? $actor->id : null,
            'capacity_overrun_confirmed_at' => $overrun['confirmed'] ? now() : null,
            'policy_snapshot' => [
                'tanker_selection_required' => $policy['selection_required'],
                'tanker_voucher_unique_scope' => $policy['voucher_unique_scope'],
                'tanker_capacity_overrun_policy' => $policy['capacity_overrun_policy'],
            ],
            'notes' => $intent['notes'],
            'idempotency_key' => $intent['key'],
            'request_fingerprint' => $intent['fingerprint'],
            'recorded_by' => $actor->id,
            'recorded_at' => now(),
        ]);
        $fill->id = $id;
        $fill->save();

        $this->audit->record('tanker_fill.recorded', $fill, null, $this->audit->snapshot($fill), $actor);

        return ['fill' => $fill->fresh(), 'replayed' => false];
    }

    /**
     * خطأ تفرّد: إمّا سباق على المفتاح نفسه (نتيجة إعادة متزامنة ⇒ تُعاد السجل الأول إن طابق المحتوى)، وإمّا سند ورقي مكرر في نطاق أوسع من المحطة.
     *
     * @param  array<string,mixed>  $intent
     * @return array{fill: FuelTankerFill, replayed: bool}
     */
    private function resolveUniqueViolation(array $intent, User $actor, UniqueConstraintViolationException $exception): array
    {
        $existing = FuelTankerFill::query()->withoutGlobalScope(BranchScope::class)->where('idempotency_key', $intent['key'])->first();
        if ($existing !== null) {
            return ['fill' => $this->assertReplay($existing, $intent, $actor), 'replayed' => true];
        }

        $duplicate = FuelTankerFill::query()->withoutGlobalScope(BranchScope::class)->where('voucher_key', $intent['voucher_key'])->first();
        if ($duplicate !== null) {
            throw $this->voucherDuplicate($duplicate, $actor);
        }

        throw $exception;
    }

    /** @param array<string,mixed> $intent */
    private function assertReplay(FuelTankerFill $existing, array $intent, User $actor): FuelTankerFill
    {
        $station = FuelStation::query()->find($existing->fuel_station_id);
        if ($existing->request_fingerprint !== $intent['fingerprint'] || $station === null || ! $actor->canAccessFuelStation($station)) {
            throw new FuelTankerFillException(
                FuelTankerFillException::IDEMPOTENCY_CONFLICT,
                'مفتاح منع التكرار استُخدم سابقاً بمحتوى مختلف؛ استعمل مفتاحاً جديداً لعملية جديدة.',
                409,
            );
        }

        return $existing;
    }

    // ───────────────────────── التحققات ─────────────────────────

    private function assertStationUsable(FuelStation $station, User $actor): void
    {
        if (! $actor->canAccessFuelStation($station)) {
            throw $this->notFound();
        }
        $branchId = app(BranchContext::class)->id();
        if ($branchId !== null && $station->branch_id !== $branchId) {
            throw $this->notFound();
        }
        if ($station->status !== FuelStation::STATUS_ACTIVE) {
            throw new FuelTankerFillException(FuelTankerFillException::EQUIPMENT_NOT_OPERATIONAL, 'محطة الوقود غير نشطة.');
        }
    }

    private function assertEquipment(?FuelPump $pump, ?FuelTank $tank, FuelStation $station): void
    {
        if ($pump === null || $pump->fuel_station_id !== $station->id || $pump->branch_id !== $station->branch_id) {
            throw new FuelTankerFillException(FuelTankerFillException::EQUIPMENT_NOT_OPERATIONAL, 'مضخة الفوهة غير موجودة أو لا تخص المحطة.');
        }
        if ($pump->status !== FuelPump::STATUS_ACTIVE) {
            throw new FuelTankerFillException(FuelTankerFillException::EQUIPMENT_NOT_OPERATIONAL, 'المضخة ' . $pump->pump_number . ' ليست نشطة؛ لا تُسجَّل التعبئة عبرها.');
        }
        if ($tank === null || $tank->fuel_station_id !== $station->id || $tank->branch_id !== $station->branch_id) {
            throw new FuelTankerFillException(FuelTankerFillException::EQUIPMENT_NOT_OPERATIONAL, 'خزان الفوهة غير موجود أو لا يخص المحطة.');
        }
        if ($tank->status !== FuelTank::STATUS_ACTIVE) {
            throw new FuelTankerFillException(FuelTankerFillException::EQUIPMENT_NOT_OPERATIONAL, 'الخزان ' . $tank->code . ' ليس نشطاً؛ لا تُسجَّل التعبئة منه.');
        }
    }

    /**
     * منتج الفوهة هو مصدر الحقيقة: يجب أن يطابق منتج خزانها (وأي منتج أرسله المستدعي)، وأن يكون مهيّأً بوحدة mL/L كما يشترط مسار البيع.
     *
     * @param  array<string,mixed>  $intent
     */
    private function assertProduct(FuelNozzle $nozzle, FuelTank $tank, array $intent): FuelProduct
    {
        $fuelProduct = FuelProduct::query()->find($nozzle->fuel_product_id);
        if ($fuelProduct === null) {
            throw new FuelTankerFillException(FuelTankerFillException::PRODUCT_MISMATCH, 'منتج الفوهة غير موجود.');
        }
        if ($tank->fuel_product_id !== $fuelProduct->id) {
            throw new FuelTankerFillException(FuelTankerFillException::PRODUCT_MISMATCH, 'منتج خزان الفوهة لا يطابق منتج الفوهة.');
        }
        if ($intent['product_id'] !== null && $intent['product_id'] !== $fuelProduct->id) {
            throw new FuelTankerFillException(FuelTankerFillException::PRODUCT_MISMATCH, 'المنتج المرسَل لا يطابق منتج الفوهة المحددة.');
        }
        try {
            $this->quantity->assertFuelUnitMapping($fuelProduct, Product::query()->find($fuelProduct->product_id));
        } catch (RuntimeException $exception) {
            throw new FuelTankerFillException(FuelTankerFillException::PRODUCT_MISMATCH, $exception->getMessage());
        }

        return $fuelProduct;
    }

    /** الوردية الموحَّدة المفتوحة للمحطة: لا تُنشأ وردية مستقلة للتعبئة، ولا تُسجَّل تعبئة بلا وردية مفتوحة. */
    private function lockedOpenShift(FuelStation $station, ?string $suppliedShiftId): FuelShift
    {
        $open = FuelShift::query()->withoutGlobalScope(BranchScope::class)
            ->where('fuel_station_id', $station->id)->where('status', FuelShift::STATUS_OPEN)->first();
        if ($open === null) {
            throw new FuelTankerFillException(FuelTankerFillException::SHIFT_REQUIRED, 'لا توجد وردية مفتوحة للمحطة؛ تُسجَّل التعبئة داخل الوردية الموحَّدة المفتوحة فقط.');
        }
        if ($suppliedShiftId !== null && $suppliedShiftId !== $open->id) {
            throw new FuelTankerFillException(FuelTankerFillException::SHIFT_NOT_OPEN, 'الوردية المحددة ليست الوردية المفتوحة الحالية للمحطة.');
        }
        $locked = FuelShift::query()->withoutGlobalScope(BranchScope::class)->lock('for share')->find($open->id);
        if ($locked === null || ! $locked->isOpen()) {
            throw new FuelTankerFillException(FuelTankerFillException::SHIFT_NOT_OPEN, 'أُغلقت وردية المحطة قبل تسجيل التعبئة.');
        }

        return $locked;
    }

    private function resolveTanker(?string $tankerId, FuelTankerOwner $owner, bool $selectionRequired): ?FuelTanker
    {
        if ($tankerId === null) {
            if ($selectionRequired) {
                throw new FuelTankerFillException(FuelTankerFillException::TANKER_REQUIRED, 'سياسة المحطة تتطلب اختيار الصهريج عند التعبئة.');
            }

            return null; // الصهريج اختياري افتراضياً: صاحب الصهريج وحده يكفي، ولا يُمنع صاحب صهريج بسبب مركبة غير مسجَّلة.
        }
        $tanker = FuelTanker::query()->lock('for share')->find($tankerId);
        if ($tanker === null) {
            throw new FuelTankerFillException(FuelTankerFillException::INVALID_INPUT, 'الصهريج غير موجود.');
        }
        if ($tanker->fuel_tanker_owner_id !== $owner->id) {
            throw new FuelTankerFillException(FuelTankerFillException::TANKER_MISMATCH, 'الصهريج المحدد لا يتبع صاحب الصهريج المحدد.');
        }
        if ($tanker->status !== FuelTanker::STATUS_ACTIVE) {
            throw new FuelTankerFillException(FuelTankerFillException::TANKER_INACTIVE, 'الصهريج غير نشط.');
        }

        return $tanker;
    }

    /**
     * يُسلسل تسجيلات السند الورقي نفسه داخل المؤسسة تحت نطاقات مختلفة (محطة A بسياسة «مؤسسة» ومحطة B بسياسة «محطة»): قفلا المحطتين صفّان مختلفان والفهرس الفريد يقبل مفتاحَي نطاق
     * مختلفين، فبلا هذا يمرّ فحصان متزامنان معاً. قفل استشاري على (مؤسسة، مفتاح السند) يُؤخذ **بعد** أقفال الصفوف وقبل مِرساة الترقيم ويُحرَّر مع المعاملة؛ لا يتعارض مع سند آخر.
     * على SQLite (كاتب واحد) لا حاجة له. «بلا منع» لا يفحص ولا يُسلسل.
     */
    private function serializeVoucher(string $voucherKey, string $scope): void
    {
        if ($scope === FuelTankerFill::SCOPE_NONE || DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }
        DB::select('select pg_advisory_xact_lock(hashtextextended(?, 0))', ['tanker-fill-voucher:' . app(TenantContext::class)->id() . ':' . $voucherKey]);
    }

    /**
     * منع تكرار السند الورقي حسب سياسة النطاق (محطة افتراضياً). **الأصفار البادئة تُحفظ** (المفتاح حرفي)، و**السند الملغى يبقى محجوزاً** (لا استثناء للملغى).
     * يتعارض السند إذا غطّى نطاق **الكاتب الحالي** السجل القائم **أو** غطّى نطاق **السجل القائم** (المحفوظ عند تسجيله) الكاتب الحالي — فلا يتوقف الحكم على ترتيب التسجيل ولا على اختلاف
     * سياسات المحطات (سند سُجّل بنطاق «مؤسسة» يبقى محجوزاً مؤسسياً حتى لو سُجّل الثاني من محطة بسياسة «محطة»). «بلا منع» لدى الكاتب تعطيل صريح لفحصه.
     * الفهرس الفريد في القاعدة يحرس السباق في مفتاح النطاق نفسه؛ والقفل الاستشاري أعلاه يحرس النطاقات المختلفة.
     *
     * @param  array<string,mixed>  $intent
     */
    private function assertVoucherAvailable(array $intent, string $scope, FuelStation $station, FuelTankerOwner $owner, User $actor): void
    {
        if ($scope === FuelTankerFill::SCOPE_NONE) {
            return;
        }
        $duplicate = FuelTankerFill::query()->withoutGlobalScope(BranchScope::class)
            ->where('voucher_key', $intent['voucher_key'])
            ->where(function ($covered) use ($scope, $station, $owner) {
                // نطاق الكاتب الحالي.
                $covered->where(function ($writer) use ($scope, $station, $owner) {
                    match ($scope) {
                        FuelTankerFill::SCOPE_STATION => $writer->where('fuel_station_id', $station->id),
                        FuelTankerFill::SCOPE_OWNER => $writer->where('fuel_tanker_owner_id', $owner->id),
                        default => $writer->whereRaw('1 = 1'),
                    };
                })
                // نطاق السجل القائم كما حُفظ عند تسجيله.
                ->orWhere('voucher_scope', FuelTankerFill::SCOPE_TENANT)
                ->orWhere(fn ($q) => $q->where('voucher_scope', FuelTankerFill::SCOPE_OWNER)->where('fuel_tanker_owner_id', $owner->id))
                ->orWhere(fn ($q) => $q->where('voucher_scope', FuelTankerFill::SCOPE_STATION)->where('fuel_station_id', $station->id));
            })
            ->first();
        if ($duplicate !== null) {
            throw $this->voucherDuplicate($duplicate, $actor);
        }
    }

    private function voucherDuplicate(FuelTankerFill $existing, User $actor): FuelTankerFillException
    {
        $details = ['voucher_number' => $existing->voucher_number];
        $station = FuelStation::query()->find($existing->fuel_station_id);
        if ($station !== null && $actor->canAccessFuelStation($station)) {
            // لا يُكشف سجل خارج نطاق المستخدم (نطاق المؤسسة/صاحب الصهريج قد يلتقي بمحطة أخرى).
            $details['existing_fill_number'] = $existing->number;
            $details['existing_status'] = $existing->status;
        }

        return new FuelTankerFillException(
            FuelTankerFillException::VOUCHER_DUPLICATE,
            'رقم السند الورقي مسجَّل مسبقاً' . ($existing->status === FuelTankerFill::STATUS_VOIDED ? ' (سند ملغى؛ رقمه يبقى محجوزاً)' : '') . '.',
            409,
            $details,
        );
    }

    /**
     * سياسة تجاوز سعة الصهريج. السعة غير المحددة (NULL) لا تُقارَن (لا حدّ مخترع).
     *
     * @return array{overrun: ?int, confirmed: bool}
     */
    private function evaluateCapacity(?FuelTanker $tanker, int $quantity, string $policy, bool $confirmed): array
    {
        $capacity = $tanker?->capacity_milliliters;
        if ($tanker === null || $capacity === null || $quantity <= $capacity) {
            return ['overrun' => null, 'confirmed' => false];
        }
        $overrun = $quantity - $capacity;
        $details = ['capacity_milliliters' => $capacity, 'quantity_milliliters' => $quantity, 'overrun_milliliters' => $overrun];

        if ($policy === 'block') {
            throw new FuelTankerFillException(FuelTankerFillException::CAPACITY_EXCEEDED, 'كمية التعبئة تتجاوز سعة الصهريج وسياسة المحطة تمنع التجاوز.', 422, $details);
        }
        if ($policy === 'allow_with_confirmation') {
            if (! $confirmed) {
                throw new FuelTankerFillException(
                    FuelTankerFillException::CAPACITY_CONFIRMATION_REQUIRED,
                    'كمية التعبئة تتجاوز سعة الصهريج؛ أعد الإرسال بتأكيد صريح (confirm_capacity_overrun) لتسجيلها.',
                    422,
                    $details,
                );
            }

            return ['overrun' => $overrun, 'confirmed' => true];
        }

        return ['overrun' => $overrun, 'confirmed' => false]; // allow: يُسجَّل التجاوز بلا تأكيد
    }

    private function scopeKey(string $scope, string $fillId, string $stationId, string $ownerId): string
    {
        return match ($scope) {
            FuelTankerFill::SCOPE_STATION => 'station:' . $stationId,
            FuelTankerFill::SCOPE_OWNER => 'owner:' . $ownerId,
            FuelTankerFill::SCOPE_TENANT => 'tenant',
            default => 'none:' . $fillId,
        };
    }

    // ───────────────────────── المدخلات ─────────────────────────

    /**
     * يطبّع مدخلات الطلب إلى «نية» ثابتة ويحسب بصمتها. `tenant_id`/`branch_id`/المنتج المشتق لا يُقبلون من العميل (الطلب يرفض المفاتيح المجهولة).
     *
     * @param  array<string,mixed>  $attributes
     * @return array<string,mixed>
     */
    private function parseIntent(array $attributes): array
    {
        $station = $this->requiredId($attributes, 'fuel_station_id', 'المحطة');
        $nozzle = $this->requiredId($attributes, 'fuel_nozzle_id', 'الفوهة');
        $owner = $this->requiredId($attributes, 'fuel_tanker_owner_id', 'صاحب الصهريج');
        $tanker = $this->optionalId($attributes, 'fuel_tanker_id', 'الصهريج');
        $shift = $this->optionalId($attributes, 'fuel_shift_id', 'الوردية');
        $product = $this->optionalId($attributes, 'fuel_product_id', 'المنتج');

        $voucherRaw = $attributes['voucher_number'] ?? null;
        $voucher = is_string($voucherRaw) || is_int($voucherRaw) ? FuelTankerFill::normalizeVoucher((string) $voucherRaw) : null;
        if ($voucher === null) {
            throw new FuelTankerFillException(
                FuelTankerFillException::VOUCHER_INVALID,
                'رقم السند الورقي مطلوب (حتى 64 حرفاً: أحرف وأرقام و - / . _ # ومسافة، يبدأ بحرف أو رقم).',
            );
        }

        $key = $attributes['idempotency_key'] ?? null;
        if (! is_string($key) || ! preg_match('/^[A-Za-z0-9._:\-]{8,128}$/', $key)) {
            throw new FuelTankerFillException(FuelTankerFillException::INVALID_INPUT, 'مفتاح منع التكرار مطلوب (8–128 حرفاً: أحرف وأرقام و . _ : -).');
        }

        $notes = isset($attributes['notes']) && is_string($attributes['notes']) ? trim($attributes['notes']) : '';
        if (mb_strlen($notes) > 1000) {
            throw new FuelTankerFillException(FuelTankerFillException::INVALID_INPUT, 'الملاحظة أطول من 1000 حرف.');
        }
        $quantity = $this->quantityMilliliters($attributes);

        $intent = [
            'station_id' => $station, 'nozzle_id' => $nozzle, 'owner_id' => $owner, 'tanker_id' => $tanker, 'shift_id' => $shift, 'product_id' => $product,
            'voucher_display' => $voucher['display'], 'voucher_key' => $voucher['key'], 'quantity_milliliters' => $quantity,
            'notes' => $notes === '' ? null : $notes, 'key' => $key, 'confirm_overrun' => ($attributes['confirm_capacity_overrun'] ?? false) === true,
        ];
        // بصمة المحتوى = ما أرسله المستدعي من نية (لا أعلام الموافقة ولا المفتاح نفسه): اختلافها مع المفتاح نفسه ⇒ 409.
        $intent['fingerprint'] = hash('sha256', json_encode([
            $station, $nozzle, $owner, $tanker, $shift, $product, $voucher['key'], $quantity, $intent['notes'],
        ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));

        return $intent;
    }

    /**
     * الكمية باللترات (نص/عدد بثلاث منازل عشرية حداً أقصى) أو بالملليلتر صحيحاً — واحد منهما فقط. لا تقريب صامت، ولا صفر ولا سالب.
     * عدد عشري (float) يُقبل فقط إن كان يطابق ثلاث منازل بلا فرق (تجنّباً لأخطاء الفاصلة العائمة).
     *
     * @param  array<string,mixed>  $attributes
     */
    private function quantityMilliliters(array $attributes): int
    {
        $hasMl = ($attributes['quantity_milliliters'] ?? null) !== null && $attributes['quantity_milliliters'] !== '';
        $hasLiters = ($attributes['quantity_liters'] ?? null) !== null && $attributes['quantity_liters'] !== '';
        if ($hasMl === $hasLiters) {
            throw new FuelTankerFillException(FuelTankerFillException::QUANTITY_INVALID, 'أرسل الكمية بحقل واحد: quantity_liters (لترات) أو quantity_milliliters (ملليلتر صحيح).');
        }

        if ($hasMl) {
            $value = $attributes['quantity_milliliters'];
            if (! is_int($value) && ! (is_string($value) && ctype_digit($value) && strlen($value) <= 18)) {
                throw new FuelTankerFillException(FuelTankerFillException::QUANTITY_INVALID, 'الكمية بالملليلتر يجب أن تكون عدداً صحيحاً.');
            }
            $milliliters = (int) $value;
        } else {
            $value = $attributes['quantity_liters'];
            if (is_float($value)) {
                $text = number_format($value, 3, '.', '');
                if (abs((float) $text - $value) > 1e-9) {
                    throw new FuelTankerFillException(FuelTankerFillException::QUANTITY_INVALID, 'كمية اللترات بحد أقصى ثلاث منازل عشرية؛ أرسلها نصاً لتجنّب التقريب.');
                }
                $value = $text;
            }
            if (! is_int($value) && ! is_string($value)) {
                throw new FuelTankerFillException(FuelTankerFillException::QUANTITY_INVALID, 'كمية اللترات غير صالحة.');
            }
            try {
                $milliliters = $this->quantity->litersToMilliliters($value);
            } catch (RuntimeException $exception) {
                throw new FuelTankerFillException(FuelTankerFillException::QUANTITY_INVALID, $exception->getMessage());
            }
        }

        if ($milliliters <= 0) {
            throw new FuelTankerFillException(FuelTankerFillException::QUANTITY_INVALID, 'كمية التعبئة يجب أن تكون أكبر من صفر.');
        }

        return $milliliters;
    }

    /** @param array<string,mixed> $attributes */
    private function requiredId(array $attributes, string $key, string $label): string
    {
        $value = $this->optionalId($attributes, $key, $label);
        if ($value === null) {
            throw new FuelTankerFillException(FuelTankerFillException::INVALID_INPUT, "{$label} مطلوب.");
        }

        return $value;
    }

    /** @param array<string,mixed> $attributes */
    private function optionalId(array $attributes, string $key, string $label): ?string
    {
        $value = $attributes[$key] ?? null;
        if ($value === null || $value === '') {
            return null;
        }
        if (! is_string($value) || ! Str::isUuid($value)) {
            throw new FuelTankerFillException(FuelTankerFillException::INVALID_INPUT, "معرّف {$label} غير صالح.");
        }

        return strtolower($value);
    }

    private function requirePermission(User $actor, string $permission): void
    {
        if (! $actor->hasPermission($permission)) {
            throw new FuelTankerFillException(FuelTankerFillException::FORBIDDEN, 'لا تملك صلاحية تنفيذ هذه العملية.', 403);
        }
    }

    private function notFound(): FuelTankerFillException
    {
        return new FuelTankerFillException(FuelTankerFillException::NOT_FOUND, 'السجل غير موجود.', 404);
    }
}
