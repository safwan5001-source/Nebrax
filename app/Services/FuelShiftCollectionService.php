<?php

namespace App\Services;

use App\Models\FuelShift;
use App\Models\FuelShiftCollectionDeclaration;
use App\Models\FuelShiftCollectionRevision;
use App\Models\FuelShiftEvent;
use App\Models\FuelStation;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * إقرار تحصيل الوردية: توزيع ما حُصِّل حسب طرق الدفع المسموحة للمحطة ومطابقته بمبيعات العدادات.
 *
 * **تشغيلي فقط.** لا يُنشئ سنداً ولا فاتورة ولا قيداً ولا حركة خزينة ولا يلمس `payments`/`fuel_sales`، ولا يغيّر النقد المتوقع/الفرق
 * المحفوظين في `close`. المطابقة تقارن ما أقرّ به البائع بتقدير العدادات؛ وليست إثباتاً لتحصيل مالي مسجَّل. لا يحتسب البيع الآجل ولا
 * التسويات غير المسجّلة (مستبعدة افتراضياً وتُعلَن في كل استجابة).
 *
 * التزامن: كل كتابة تحت قفل الوردية `FOR UPDATE` (نفس قفل `close`/حركات النقد) فلا يسبق الحفظُ الإغلاقَ ولا يتجاوزه؛
 * ولا يوجد قفل مِرساة مستأجر هنا لأن الخدمة لا تُرحّل قيداً.
 * التكرار: مفتاح idempotency فريد للمؤسسة + بصمة الحمولة؛ نسخة الأساس `base_revision` تمنع الكتابة فوق نسخة جهاز آخر؛ وحفظ حمولة مطابقة للحالية بمفتاح جديد لا ينشئ نسخة.
 */
class FuelShiftCollectionService
{
    public const DISCLAIMERS = ['operational_not_financial_proof', 'credit_sales_excluded', 'unrecorded_settlements_excluded'];

    public function __construct(
        private FuelShiftService $shifts,
        private FuelShiftSalesCalculator $sales,
        private FuelStationPaymentMethods $methods,
        private FuelShiftCashExpectationService $expectation,
    ) {}

    public static function enabled(): bool
    {
        return (bool) config('fuel_stations.shift_collection_declaration_enabled', false);
    }

    /**
     * العرض الكامل للوردية. المفتوحة: حساب حيّ للمبيعات وطرق الدفع الحالية؛ المغلقة: اللقطة المجمَّدة فقط (إن وُجد إقرار).
     * قيم المبيعات/الفرق/نقد المبيعات المستنتج تتطلب `fuel.sale.view` (D8) وإلا `visible:false`.
     *
     * @return array<string,mixed>
     */
    public function view(FuelShift $shift, User $viewer): array
    {
        $station = FuelStation::findOrFail($shift->fuel_station_id);
        $declaration = FuelShiftCollectionDeclaration::where('fuel_shift_id', $shift->id)->first();
        $open = $shift->isOpen();
        $salesVisible = $viewer->hasPermission('fuel.sale.view');

        $current = $open ? $this->methods->allowedFor($station) : collect();
        $savedByMethod = collect($declaration?->lines ?? [])->keyBy('payment_method_id');

        $frozen = $declaration?->status === FuelShiftCollectionDeclaration::STATUS_FROZEN;
        $sales = $frozen
            ? $this->frozenSales($declaration)
            : $this->sales->compute($shift, $shift->closed_at ?? now());

        $difference = null;
        if ($declaration !== null) {
            $difference = $frozen
                ? $declaration->difference_minor
                : ($sales['complete'] ? $declaration->collected_total_minor - (int) $sales['amount_minor'] : null);
        }

        $payload = [
            'enabled' => true,
            'state' => $declaration === null ? 'none' : ($frozen ? 'frozen' : 'declared'),
            'revision' => $declaration?->revision ?? 0,
            'methods' => $open ? $current->map(fn ($method) => [
                'id' => $method->id,
                'name' => $method->name,
                'name_en' => $method->name_en,
                'settlement_type' => $method->settlement_type,
                'saved_amount_minor' => $savedByMethod->has($method->id) ? (int) $savedByMethod->get($method->id)['amount_minor'] : null,
            ])->values()->all() : [],
            'methods_changed' => $open && $declaration !== null
                && $savedByMethod->keys()->sort()->values()->all() !== $current->pluck('id')->sort()->values()->all(),
            'declaration' => $declaration === null ? null : [
                'id' => $declaration->id,
                'revision' => $declaration->revision,
                'status' => $declaration->status,
                'lines' => collect($declaration->lines)->map(fn ($line) => $line + [
                    'still_allowed' => $open ? $current->contains('id', $line['payment_method_id']) : null,
                ])->values()->all(),
                'collected_total_minor' => $declaration->collected_total_minor,
                'cash_declared_minor' => $declaration->cash_declared_minor,
                'network_declared_minor' => $declaration->network_declared_minor,
                'declared_by' => $declaration->declared_by,
                'declared_at' => $declaration->declared_at?->toIso8601String(),
                'frozen_at' => $declaration->frozen_at?->toIso8601String(),
            ],
            'sales' => $this->presentSales($sales, $salesVisible),
            'reconciliation' => $this->presentReconciliation($declaration, $sales, $difference, $salesVisible),
            'drawer' => $this->drawer($shift, $declaration, $salesVisible),
            'disclaimers' => self::DISCLAIMERS,
        ];

        return $payload;
    }

    /**
     * يحفظ (أو يستبدل) إقرار التحصيل لوردية **مفتوحة**.
     *
     * @param  array{idempotency_key:string,base_revision:int,lines:array<int,array{payment_method_id:string,amount_minor:int}>}  $attributes
     * @return array{view:array<string,mixed>,replayed:bool,unchanged:bool}
     *
     * @throws FuelShiftCollectionConflictException
     */
    public function declare(FuelShift $shift, array $attributes, User $actor): array
    {
        if (! $actor->hasPermission('fuel.shift.cash_count')) {
            throw new RuntimeException('لا تملك صلاحية تنفيذ عملية الشفت المطلوبة.');
        }
        $key = $this->key($attributes['idempotency_key'] ?? null);
        $base = $attributes['base_revision'] ?? null;
        if (! is_int($base) || $base < 0) {
            throw new RuntimeException('FUEL_COLLECTION_INVALID: نسخة الأساس يجب أن تكون عدداً صحيحاً غير سالب.');
        }
        $lines = $this->normalizeLines($attributes['lines'] ?? null);
        $hash = hash('sha256', json_encode($lines, JSON_THROW_ON_ERROR));

        $outcome = DB::transaction(function () use ($shift, $actor, $key, $base, $lines, $hash) {
            $shift = $this->shifts->lockOpenShift($shift, $actor);
            $station = FuelStation::findOrFail($shift->fuel_station_id);

            $declaration = FuelShiftCollectionDeclaration::where('fuel_shift_id', $shift->id)->lockForUpdate()->first();
            $currentRevision = $declaration?->revision ?? 0;

            // مفتاح مستخدم من قبل: إعادة إرسال (lost response) إن طابق الوردية والحمولة، وإلا تعارض. لا أثر ثانٍ في الحالتين.
            $used = FuelShiftCollectionRevision::where('idempotency_key', $key)->first();
            if ($used !== null) {
                if ($used->fuel_shift_id !== $shift->id || $used->payload_hash !== $hash) {
                    throw new FuelShiftCollectionConflictException('idempotency_conflict', 'FUEL_COLLECTION_IDEMPOTENCY_CONFLICT: مفتاح منع التكرار استُخدم لإقرار مختلف.', $currentRevision);
                }

                return ['replayed' => true, 'unchanged' => false];
            }
            if ($base !== $currentRevision) {
                throw new FuelShiftCollectionConflictException('stale_revision', 'FUEL_COLLECTION_STALE_REVISION: عُدِّل الإقرار من جهاز آخر؛ أعد تحميل الإقرار الحالي.', $currentRevision);
            }

            // مطابقة طرق الدفع الحالية تماماً: لا طريقة معطّلة ولا طريقة مفعّلة مفقودة (القائمة تتبع إعداد المحطة لحظة الحفظ).
            $allowed = $this->methods->allowedFor($station)->keyBy('id');
            $submitted = collect($lines)->pluck('payment_method_id');
            $unknown = $submitted->reject(fn ($id) => $allowed->has($id));
            if ($unknown->isNotEmpty()) {
                throw new RuntimeException('FUEL_COLLECTION_METHOD_NOT_ALLOWED: توجد طريقة دفع غير مسموحة أو معطّلة لهذه المحطة؛ حدّث القائمة.');
            }
            if ($allowed->keys()->diff($submitted)->isNotEmpty()) {
                throw new RuntimeException('FUEL_COLLECTION_METHODS_CHANGED: فُعِّلت طريقة دفع جديدة للمحطة؛ حدّث القائمة وأدخل مبلغها.');
            }

            if ($declaration !== null && $declaration->payload_hash === $hash) {
                return ['replayed' => false, 'unchanged' => true];
            }

            $stored = collect($lines)->map(fn ($line) => [
                'payment_method_id' => $line['payment_method_id'],
                'name' => $allowed->get($line['payment_method_id'])->name,
                'settlement_type' => $allowed->get($line['payment_method_id'])->settlement_type,
                'amount_minor' => $line['amount_minor'],
            ])->values()->all();
            $total = array_sum(array_column($stored, 'amount_minor'));
            $cash = array_sum(array_column(array_filter($stored, fn ($l) => $l['settlement_type'] === 'cash'), 'amount_minor'));
            $now = now();
            $sales = $this->sales->compute($shift, $now);
            $difference = $sales['complete'] ? $total - (int) $sales['amount_minor'] : null;

            $state = [
                'revision' => $currentRevision + 1,
                'status' => FuelShiftCollectionDeclaration::STATUS_DECLARED,
                'payload_hash' => $hash,
                'lines' => $stored,
                'collected_total_minor' => $total,
                'cash_declared_minor' => $cash,
                'network_declared_minor' => $total - $cash,
                'declared_by' => $actor->id,
                'declared_at' => $now,
            ] + $this->salesColumns($sales, $difference);

            if ($declaration === null) {
                $declaration = (new FuelShiftCollectionDeclaration)->forceFill($state + [
                    'tenant_id' => $shift->tenant_id, 'branch_id' => $shift->branch_id,
                    'fuel_station_id' => $station->id, 'fuel_shift_id' => $shift->id,
                ]);
            } else {
                $declaration->forceFill($state);
            }
            $declaration->save();

            (new FuelShiftCollectionRevision)->forceFill([
                'tenant_id' => $shift->tenant_id, 'branch_id' => $shift->branch_id, 'fuel_shift_id' => $shift->id,
                'declaration_id' => $declaration->id, 'revision' => $declaration->revision, 'idempotency_key' => $key,
                'payload_hash' => $hash, 'lines' => $stored, 'collected_total_minor' => $total,
                'actor_id' => $actor->id, 'occurred_at' => $now,
            ])->save();

            $this->event($shift, FuelShiftEvent::TYPE_COLLECTION_DECLARED, $actor, [
                'declaration_id' => $declaration->id, 'revision' => $declaration->revision,
                'collected_total_minor' => $total, 'cash_declared_minor' => $cash, 'network_declared_minor' => $total - $cash,
                'method_count' => count($stored), 'sales_complete' => $sales['complete'],
                'sales_minor' => $sales['amount_minor'], 'difference_minor' => $difference,
            ]);

            return ['replayed' => false, 'unchanged' => false];
        });

        return ['view' => $this->view($shift->fresh(), $actor), 'replayed' => $outcome['replayed'], 'unchanged' => $outcome['unchanged']];
    }

    /**
     * يُستدعى من `FuelShiftService::close` داخل معاملة الإغلاق وتحت قفل الوردية: يعيد حساب المبيعات ويُجمّد الإقرار مع لقطة الدرج.
     * لا إقرار ⇒ لا شيء (الإغلاق لا يشترطه). لا يرمي لأسباب بيانات؛ الثغرات تُسجَّل في اللقطة.
     * **لا يعتمد على البوابة عمداً:** البوابة تحكم الكتابة والعرض فقط؛ إقرارٌ حُفظ وهي مفتوحة يجب أن يُجمَّد عند الإغلاق ولو أُغلقت بعدها،
     * وإلا بقي «معلّقاً» على وردية مغلقة. بلا إقرارات (حالة ما قبل التفعيل) تكلفته استعلام واحد على الجدول.
     *
     * @param  array<string,mixed>  $live  ناتج `FuelShiftCashExpectationService::live`
     */
    public function freezeAtClose(FuelShift $shift, int $countedCashMinor, array $live, User $actor): ?FuelShiftCollectionDeclaration
    {
        $declaration = FuelShiftCollectionDeclaration::where('fuel_shift_id', $shift->id)->lockForUpdate()->first();
        if ($declaration === null) {
            return null;
        }

        $now = now();
        $sales = $this->sales->compute($shift, $now);
        $difference = $sales['complete'] ? $declaration->collected_total_minor - (int) $sales['amount_minor'] : null;
        $drawer = $this->drawerImplied($countedCashMinor, (int) $live['opening'], (int) $live['cash_in'], (int) $live['cash_out'], (int) $live['expenses']);

        $declaration->forceFill($this->salesColumns($sales, $difference) + [
            'status' => FuelShiftCollectionDeclaration::STATUS_FROZEN,
            'opening_float_minor' => (int) $live['opening'],
            'counted_cash_minor' => $countedCashMinor,
            'cash_in_minor' => (int) $live['cash_in'],
            'cash_out_minor' => (int) $live['cash_out'],
            'treasury_handover_minor' => (int) $live['handover'],
            'expenses_minor' => (int) $live['expenses'],
            'drawer_implied_sales_cash_minor' => $drawer,
            'cash_cross_difference_minor' => $declaration->cash_declared_minor - $drawer,
            'frozen_at' => $now,
        ])->save();

        $this->event($shift, FuelShiftEvent::TYPE_COLLECTION_FROZEN, $actor, [
            'declaration_id' => $declaration->id, 'revision' => $declaration->revision,
            'collected_total_minor' => $declaration->collected_total_minor, 'sales_complete' => $sales['complete'],
            'sales_minor' => $sales['amount_minor'], 'difference_minor' => $difference,
            'cash_cross_difference_minor' => $declaration->cash_cross_difference_minor,
        ]);

        return $declaration;
    }

    /**
     * نقد المبيعات الذي يفترضه الدرج = المعدود − العهدة − وارد غير المبيعات + الصادر (يشمل التسليم للخزنة) + المصروف.
     * هو معكوس معادلة المتوقع `E = O + R + I − U − X` عند افتراض المعدود = المتوقع. يفصل الدرج عن العهدة وعن المسلَّم للخزنة.
     */
    private function drawerImplied(int $counted, int $opening, int $cashIn, int $cashOut, int $expenses): int
    {
        return $counted - $opening - $cashIn + $cashOut + $expenses;
    }

    /** @return array<string,mixed> */
    private function drawer(FuelShift $shift, ?FuelShiftCollectionDeclaration $declaration, bool $salesVisible): array
    {
        if ($declaration?->status === FuelShiftCollectionDeclaration::STATUS_FROZEN) {
            return [
                'frozen' => true,
                'opening_float_minor' => $declaration->opening_float_minor,
                'counted_cash_minor' => $declaration->counted_cash_minor,
                'treasury_handover_minor' => $declaration->treasury_handover_minor,
                'cash_in_minor' => $declaration->cash_in_minor,
                'cash_out_minor' => $declaration->cash_out_minor,
                'expenses_minor' => $declaration->expenses_minor,
                'implied_sales_cash' => $salesVisible
                    ? ['visible' => true, 'amount_minor' => $declaration->drawer_implied_sales_cash_minor, 'declared_difference_minor' => $declaration->cash_cross_difference_minor]
                    : ['visible' => false],
            ];
        }

        $station = FuelStation::findOrFail($shift->fuel_station_id);
        $live = $this->expectation->live($shift, $this->expectation->effectiveBasis($station));

        return [
            'frozen' => false,
            'opening_float_minor' => (int) $live['opening'],
            'counted_cash_minor' => $shift->counted_cash_minor === null ? null : (int) $shift->counted_cash_minor,
            'treasury_handover_minor' => (int) $live['handover'],
            'cash_in_minor' => (int) $live['cash_in'],
            'cash_out_minor' => (int) $live['cash_out'],
            'expenses_minor' => (int) $live['expenses'],
            'implied_sales_cash' => ['visible' => $salesVisible, 'amount_minor' => null, 'declared_difference_minor' => null],
        ];
    }

    /** @param array<string,mixed> $sales @return array<string,mixed> */
    private function presentSales(array $sales, bool $visible): array
    {
        $products = array_map(fn ($row) => $visible ? $row : array_diff_key($row, array_flip(['price_per_liter_minor', 'price_source', 'amount_minor'])), $sales['products']);

        return [
            'visible' => $visible,
            'complete' => $sales['complete'],
            'milliliters' => $sales['milliliters'],
            'milliliters_complete' => $sales['milliliters_complete'],
            'amount_minor' => $visible ? $sales['amount_minor'] : null,
            'tax_mode' => $visible ? $sales['tax_mode'] : null,
            'evaluated_at' => $sales['evaluated_at'],
            'products' => $products,
            'nozzles' => $sales['nozzles'],
            'gaps' => $sales['gaps'],
        ];
    }

    /** @param array<string,mixed> $sales @return array<string,mixed> */
    private function presentReconciliation(?FuelShiftCollectionDeclaration $declaration, array $sales, ?int $difference, bool $visible): array
    {
        if (! $visible) {
            return ['visible' => false];
        }
        if ($declaration === null) {
            return ['visible' => true, 'final' => false, 'reason' => 'not_declared', 'difference_minor' => null, 'direction' => null, 'collected_total_minor' => null];
        }
        $final = $difference !== null;

        return [
            'visible' => true,
            'final' => $final,
            'reason' => $final ? null : 'sales_incomplete',
            'collected_total_minor' => $declaration->collected_total_minor,
            'sales_minor' => $sales['amount_minor'],
            'difference_minor' => $difference,
            'direction' => $final ? ($difference === 0 ? 'none' : ($difference > 0 ? 'overage' : 'shortage')) : null,
        ];
    }

    /** @param array<string,mixed> $sales @return array<string,mixed> */
    private function salesColumns(array $sales, ?int $difference): array
    {
        return [
            'sales_milliliters' => $sales['milliliters'],
            'sales_milliliters_complete' => $sales['milliliters_complete'],
            'sales_minor' => $sales['amount_minor'],
            'sales_complete' => $sales['complete'],
            'sales_tax_mode' => $sales['tax_mode'],
            'sales_breakdown' => ['products' => $sales['products'], 'nozzles' => $sales['nozzles']],
            'sales_gaps' => $sales['gaps'],
            'sales_evaluated_at' => now()->parse($sales['evaluated_at']),
            'difference_minor' => $difference,
        ];
    }

    /** @return array<string,mixed> */
    private function frozenSales(FuelShiftCollectionDeclaration $declaration): array
    {
        return [
            'evaluated_at' => $declaration->sales_evaluated_at?->toIso8601String(),
            'tax_mode' => $declaration->sales_tax_mode,
            'milliliters' => (int) $declaration->sales_milliliters,
            'milliliters_complete' => (bool) $declaration->sales_milliliters_complete,
            'amount_minor' => $declaration->sales_minor,
            'complete' => (bool) $declaration->sales_complete,
            'products' => $declaration->sales_breakdown['products'] ?? [],
            'nozzles' => $declaration->sales_breakdown['nozzles'] ?? [],
            'gaps' => $declaration->sales_gaps ?? [],
        ];
    }

    /**
     * @param  mixed  $lines
     * @return list<array{payment_method_id:string,amount_minor:int}>  مرتّبة بمعرّف الطريقة (بصمة حتمية)
     */
    private function normalizeLines(mixed $lines): array
    {
        if (! is_array($lines) || $lines === [] || ! array_is_list($lines)) {
            throw new RuntimeException('FUEL_COLLECTION_INVALID: أدخل مبلغ كل طريقة دفع مفعّلة للمحطة.');
        }
        $normalized = [];
        foreach ($lines as $line) {
            $id = is_array($line) ? ($line['payment_method_id'] ?? null) : null;
            $amount = is_array($line) ? ($line['amount_minor'] ?? null) : null;
            if (! is_string($id) || trim($id) === '' || ! is_int($amount) || $amount < 0 || $amount > 1_000_000_000_000) {
                throw new RuntimeException('FUEL_COLLECTION_INVALID: كل سطر يحتاج معرّف طريقة دفع ومبلغاً صحيحاً غير سالب بالهللات.');
            }
            if (isset($normalized[$id])) {
                throw new RuntimeException('FUEL_COLLECTION_INVALID: طريقة الدفع مكررة في الإقرار.');
            }
            $normalized[$id] = ['payment_method_id' => $id, 'amount_minor' => $amount];
        }
        ksort($normalized);

        return array_values($normalized);
    }

    private function key(mixed $key): string
    {
        if (! is_string($key) || trim($key) === '' || mb_strlen($key) > 120) {
            throw new RuntimeException('FUEL_COLLECTION_INVALID: مفتاح منع التكرار مطلوب (حتى 120 حرفاً).');
        }

        return trim($key);
    }

    /** @param array<string,mixed> $payload */
    private function event(FuelShift $shift, string $type, User $actor, array $payload): void
    {
        FuelShiftEvent::create([
            'branch_id' => $shift->branch_id, 'fuel_shift_id' => $shift->id, 'type' => $type,
            'payload' => $payload, 'actor_id' => $actor->id, 'occurred_at' => now(),
        ]);
    }
}
