<?php

namespace App\Services;

use App\Models\FuelNozzle;
use App\Models\FuelShift;
use App\Models\FuelShiftEvent;
use App\Models\FuelShiftMeterReading;
use App\Models\FuelShiftMeterVarianceReview;
use App\Models\FuelShiftNozzleReconciliation;
use App\Models\FuelStation;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * مطابقة قراءات الفوهات مع العمليات المسجَّلة عليها عند إغلاق الوردية (TANKER-PR8) — **تشغيلية بحتة: لا قيد ولا حركة مخزون ولا فاتورة ولا تحصيل ولا تعديل قراءة.**
 *
 *   لكل فوهة:  M = إغلاق − افتتاح     D = مبيعات مباشرة نهائية (`source=station`)     T = سندات تعبئة صهاريج مسجَّلة (غير ملغاة)     U = M − D − T
 *
 * تعبئة الصهريج **ليست بيعاً نقدياً ولا شبكة**: لا تُنشأ لها فاتورة أو تحصيل، وتُفصل لتراتها في عمود مستقل (انظر `PR8_ANALYSIS_AND_PLAN.md`).
 *
 * **فصل بين «إنشاء لقطات جديدة» و«حماية الاعتماد» (TANKER-PR8-S):**
 *  - إنشاء لقطات جديدة عند الإغلاق = بوابة النشر `fuel_stations.shift_meter_reconciliation_enabled` (مغلقة افتراضياً) **و**إعداد المؤسسة/المحطة `shift_meter_reconciliation_enabled`
 *    (حوكمة، الافتراضي `false`). أيٌّ منهما مغلق ⇒ لا لقطة جديدة ولا متطلب للوردية الجديدة (السلوك السابق حرفياً).
 *  - حماية الاعتماد والمراجعة لورديات **لها لقطات مجمَّدة** مستقلة تماماً عن البوابة والإعداد: المتطلب (`review_requirement`) مثبَّت على اللقطة وقت الإغلاق، فلا يُسقطه تعطيل الإعداد
 *    ولا إغلاق البوابة ولا تغيير سياسة لاحق؛ والمشرف يُكمل المراجعة بصلاحيته وبنطاق محطته حتى بعد التعطيل. عطلٌ يمنع المراجعة ⇒ يبقى الاعتماد محجوباً (لا مسار تجاوز عام).
 *  - ورديات أُغلقت بلا لقطات (قبل PR-8، أو والمطابقة غير فعّالة) لا متطلب عليها بأثر رجعي ولا تُحجب.
 *  - `freezeAtClose` داخل معاملة الإغلاق (تحت قفل الوردية `FOR UPDATE`: مجموعة سندات التعبئة ثابتة لأن تسجيلها وإلغاءها يأخذان قفل الوردية `FOR SHARE` ويتطلبان وردية مفتوحة).
 *  - `review` تصنيف وصفي من قائمة ثابتة، قرار واحد ثابت لكل لقطة (`fuel.shift.meter_variance_review`)، تحت قفل الوردية.
 *  - `assertApprovable` شرط الاعتماد (تحت قفل الوردية، بلا شرط على البوابة أو الإعداد): كل لقطة مجمَّدة ذات متطلب فرقُها (خارج التفاوت) أو مطابقتها لم تكتمل تحتاج مراجعة مسجَّلة.
 */
class FuelShiftMeterReconciliationService
{
    public const NOT_CHECKED = ['internal_issue_not_built', 'unrecorded_direct_sales_not_detectable', 'accounting_effect_not_applied'];

    public function __construct(
        private FuelShiftNozzleLiters $liters,
        private FuelStationSettingsService $settings,
    ) {}

    public const REQUIREMENT = FuelShiftNozzleReconciliation::REQUIREMENT_REQUIRED_BEFORE_APPROVAL;

    /** بوابة النشر (env): تحكم إنشاء لقطات جديدة وفتح المطابقة الحيّة. **ليست** شرطاً لحماية اعتماد ورديات لها لقطات. */
    public static function enabled(): bool
    {
        return (bool) config('fuel_stations.shift_meter_reconciliation_enabled', false);
    }

    /** إعداد المؤسسة/المحطة الفعّال `shift_meter_reconciliation_enabled` (محطة ← مؤسسة ← افتراضي `false`) — اشتراك اختياري. */
    public function settingEnabled(FuelStation $station): bool
    {
        return $this->settings->get($station, 'shift_meter_reconciliation_enabled') === true;
    }

    /** هل تُنشأ لقطات جديدة عند إغلاق ورديات هذه المحطة؟ بوابة النشر **و**الإعداد معاً. */
    public function activeFor(FuelStation $station): bool
    {
        return self::enabled() && $this->settingEnabled($station);
    }

    /** هل للوردية لقطات مجمَّدة؟ (تحدد إتاحة القراءة والمراجعة والحماية بمعزل عن البوابة والإعداد.) */
    public function hasSnapshots(FuelShift $shift): bool
    {
        return FuelShiftNozzleReconciliation::where('fuel_shift_id', $shift->id)->exists();
    }

    /**
     * هل تُتاح مسارات المطابقة لهذه الوردية؟ لقطات موجودة (قراءة ومراجعة، حتى بعد تعطيل الإعداد أو إغلاق البوابة) **أو** مطابقة فعّالة الآن (العرض الحيّ).
     * غير ذلك ⇒ 404 كما كان عند غلق البوابة.
     */
    public function accessibleFor(FuelShift $shift): bool
    {
        if ($this->hasSnapshots($shift)) {
            return true;
        }

        return $this->activeFor(FuelStation::findOrFail($shift->fuel_station_id));
    }

    /**
     * الحالة الفعلية للمحطة للعرض في الإعدادات (لا تُسرّب شيئاً غير مفتاحين منطقيين ومصدر القيمة).
     *
     * @return array{deployment_open: bool, setting_enabled: bool, active: bool, source: string}
     */
    public function policyFor(FuelStation $station): array
    {
        $setting = $this->settingEnabled($station);

        return [
            'deployment_open' => self::enabled(), 'setting_enabled' => $setting, 'active' => self::enabled() && $setting,
            'source' => in_array('shift_meter_reconciliation_enabled', $this->settings->stationOverrideKeys($station), true) ? 'station' : 'organization',
        ];
    }

    /**
     * يُجمّد لقطة كل فوهة للوردية داخل معاملة الإغلاق. idempotent: لا تُكتب لقطة ثانية لفوهة لها لقطة.
     */
    public function freezeAtClose(FuelShift $shift, User $actor): void
    {
        if (! self::enabled()) {
            return;
        }
        $station = FuelStation::findOrFail($shift->fuel_station_id);
        if (! $this->settingEnabled($station)) {
            return;   // المطابقة غير مفعّلة لهذه المحطة/المؤسسة: لا لقطة جديدة ولا متطلب (ورديات أُغلقت بلا لقطات لا تُلزَم بأثر رجعي).
        }
        $tolerance = (int) $this->settings->get($station, 'shift_meter_tolerance_milliliters');
        $existing = FuelShiftNozzleReconciliation::where('fuel_shift_id', $shift->id)->pluck('fuel_nozzle_id')->all();

        $computed = $this->compute($shift, $station, $tolerance);
        $now = now();
        $created = 0;
        foreach ($computed as $row) {
            if (in_array($row['fuel_nozzle_id'], $existing, true)) {
                continue;
            }
            (new FuelShiftNozzleReconciliation)->forceFill($row + [
                'id' => (string) Str::uuid(), 'tenant_id' => $shift->tenant_id, 'branch_id' => $shift->branch_id,
                'fuel_station_id' => $station->id, 'fuel_shift_id' => $shift->id, 'frozen_at' => $now,
                'review_requirement' => self::REQUIREMENT,
            ])->save();
            $created++;
        }
        if ($created > 0) {
            FuelShiftEvent::create([
                'branch_id' => $shift->branch_id, 'fuel_shift_id' => $shift->id, 'type' => FuelShiftEvent::TYPE_METER_RECONCILIATION_FROZEN,
                'payload' => [
                    'nozzles' => $created, 'review_requirement' => self::REQUIREMENT, 'setting_source' => $this->policyFor($station)['source'],
                    'variance_nozzles' => count(array_filter($computed, fn (array $r) => in_array($r['status'], [FuelShiftNozzleReconciliation::STATUS_VARIANCE, FuelShiftNozzleReconciliation::STATUS_INCOMPLETE], true))),
                ],
                'actor_id' => $actor->id, 'occurred_at' => $now,
            ]);
        }
    }

    /**
     * عرض مطابقة وردية: اللقطة المجمَّدة للمغلقة/المعتمدة، وحساب حيّ (لا يُحفظ) للمفتوحة. قراءة فقط.
     *
     * @return array<string,mixed>
     */
    public function view(FuelShift $shift, User $viewer): array
    {
        $station = FuelStation::findOrFail($shift->fuel_station_id);
        $tolerance = (int) $this->settings->get($station, 'shift_meter_tolerance_milliliters');
        $frozen = FuelShiftNozzleReconciliation::where('fuel_shift_id', $shift->id)->with('review')->get()->keyBy('fuel_nozzle_id');
        $nozzles = FuelNozzle::whereIn('id', $this->nozzleIds($shift, $frozen->keys()->all()))->orderBy('nozzle_number')->orderBy('id')->get()->keyBy('id');

        $isLive = $frozen->isEmpty();
        $rows = $isLive
            ? collect($this->compute($shift, $station, $tolerance))->map(fn (array $row) => $row + ['review' => null, 'id' => null])
            : $frozen->map(fn (FuelShiftNozzleReconciliation $r) => $this->presentFrozen($r));

        $presented = $rows->map(function (array $row) use ($nozzles, $isLive) {
            $nozzle = $nozzles->get($row['fuel_nozzle_id']);

            return [
                'id' => $row['id'], 'nozzle_id' => $row['fuel_nozzle_id'], 'nozzle_number' => $nozzle?->nozzle_number, 'fuel_product_id' => $row['fuel_product_id'],
                'metered_milliliters' => $row['metered_milliliters'], 'direct_sale_milliliters' => $row['direct_sale_milliliters'],
                'tanker_fill_milliliters' => $row['tanker_fill_milliliters'], 'tanker_fill_count' => $row['tanker_fill_count'],
                'draft_sale_milliliters' => $row['draft_sale_milliliters'], 'unexplained_milliliters' => $row['unexplained_milliliters'],
                'tolerance_milliliters' => $row['tolerance_milliliters'], 'status' => $row['status'], 'incompleteness' => $row['incompleteness'],
                'requires_review' => in_array($row['status'], [FuelShiftNozzleReconciliation::STATUS_VARIANCE, FuelShiftNozzleReconciliation::STATUS_INCOMPLETE], true),
                'review' => $row['review'], 'frozen' => ! $isLive,
            ];
        })->sortBy([['nozzle_number', 'asc'], ['nozzle_id', 'asc']])->values();

        $needs = $presented->filter(fn (array $r) => $r['requires_review'] && $r['review'] === null && ! $isLive);
        // المراجعة متاحة للمشرف على لقطات مجمَّدة لوردية مغلقة بصلاحيته ونطاق محطته، **بمعزل عن الإعداد الحالي والبوابة** (مسار إكمال المراجعة بعد التعطيل).
        $canReview = $viewer->hasPermission('fuel.shift.meter_variance_review') && $shift->isClosed() && ! $isLive;

        return [
            'shift_id' => $shift->id,
            'frozen' => ! $isLive,
            'basis' => 'direct_sales_plus_tanker_fills',
            'nozzles' => $presented->all(),
            'totals' => [
                'metered_milliliters' => $presented->every(fn (array $r) => $r['metered_milliliters'] !== null) ? (int) $presented->sum('metered_milliliters') : null,
                'direct_sale_milliliters' => (int) $presented->sum('direct_sale_milliliters'),
                'tanker_fill_milliliters' => (int) $presented->sum('tanker_fill_milliliters'),
                'unexplained_milliliters' => $presented->every(fn (array $r) => $r['unexplained_milliliters'] !== null) ? (int) $presented->sum('unexplained_milliliters') : null,
            ],
            'summary' => [
                'variance_nozzles' => $presented->where('status', FuelShiftNozzleReconciliation::STATUS_VARIANCE)->count(),
                'incomplete_nozzles' => $presented->where('status', FuelShiftNozzleReconciliation::STATUS_INCOMPLETE)->count(),
                'pending_review' => $needs->count(),
                'review_complete' => ! $isLive && $needs->isEmpty(),
            ],
            'tolerance_milliliters' => $tolerance,
            'policy' => $this->policyFor($station) + ['review_requirement' => $isLive ? null : (($frozen->first()?->review_requirement) ?? self::REQUIREMENT), 'approval_blocked' => ! $isLive && $needs->isNotEmpty()],
            'can_review' => $canReview,
            'review_classifications' => [
                'surplus' => FuelShiftMeterVarianceReview::FOR_SURPLUS,
                'over_recorded' => FuelShiftMeterVarianceReview::FOR_OVER_RECORDED,
                'incomplete' => FuelShiftMeterVarianceReview::FOR_INCOMPLETE,
            ],
            'not_checked' => self::NOT_CHECKED,
            'disclaimers' => ['operational_only_no_accounting_effect', 'tanker_fill_is_not_a_sale'],
        ];
    }

    /**
     * تصنيف فرق فوهة (وصفي بلا أثر مالي). قرار واحد ثابت لكل لقطة؛ الإعادة بالتصنيف نفسه idempotent، وبتصنيف مختلف 409-منطقي (RuntimeException).
     */
    public function review(FuelShift $shift, string $nozzleId, string $classification, ?string $note, User $actor): FuelShiftMeterVarianceReview
    {
        if (! $actor->hasPermission('fuel.shift.meter_variance_review')) {
            throw new RuntimeException('لا تملك صلاحية مراجعة فروق عدّادات الوردية.');
        }
        $note = $note === null ? null : trim($note);
        if (! in_array($classification, FuelShiftMeterVarianceReview::ALL, true)) {
            throw new RuntimeException('METER_VARIANCE_CLASSIFICATION_INVALID: تصنيف الفرق غير معروف.');
        }
        if ($classification === FuelShiftMeterVarianceReview::OTHER && ($note === null || mb_strlen($note) < 3)) {
            throw new RuntimeException('METER_VARIANCE_NOTE_REQUIRED: التصنيف «أخرى» يتطلب ملاحظة (3 أحرف على الأقل).');
        }
        if ($note !== null && mb_strlen($note) > 500) {
            throw new RuntimeException('METER_VARIANCE_NOTE_TOO_LONG: الملاحظة لا تتجاوز 500 حرف.');
        }

        return DB::transaction(function () use ($shift, $nozzleId, $classification, $note, $actor) {
            $shift = FuelShift::lockForUpdate()->findOrFail($shift->id);
            $station = FuelStation::findOrFail($shift->fuel_station_id);
            if (! $actor->canAccessFuelStation($station)) {
                throw new RuntimeException('محطة الشفت خارج نطاق صلاحياتك.');
            }
            if (! $shift->isClosed()) {
                throw new RuntimeException('METER_VARIANCE_SHIFT_NOT_CLOSED: تُراجَع فروق العدّادات لوردية مغلقة وقبل اعتمادها.');
            }
            $reconciliation = FuelShiftNozzleReconciliation::where('fuel_shift_id', $shift->id)->where('fuel_nozzle_id', $nozzleId)->lockForUpdate()->first();
            if ($reconciliation === null) {
                throw new RuntimeException('METER_VARIANCE_NOT_FOUND: لا توجد لقطة مطابقة لهذه الفوهة في الوردية.');
            }
            if (! $reconciliation->requiresReview()) {
                throw new RuntimeException('METER_VARIANCE_NOT_REQUIRED: هذه الفوهة مطابقة أو ضمن التفاوت ولا تحتاج مراجعة.');
            }
            $allowed = match (true) {
                $reconciliation->status === FuelShiftNozzleReconciliation::STATUS_INCOMPLETE => FuelShiftMeterVarianceReview::FOR_INCOMPLETE,
                (int) $reconciliation->unexplained_milliliters < 0 => FuelShiftMeterVarianceReview::FOR_OVER_RECORDED,
                default => FuelShiftMeterVarianceReview::FOR_SURPLUS,
            };
            if (! in_array($classification, $allowed, true)) {
                throw new RuntimeException('METER_VARIANCE_CLASSIFICATION_MISMATCH: هذا التصنيف لا يناسب نوع الفرق.');
            }

            $existing = FuelShiftMeterVarianceReview::where('fuel_shift_nozzle_reconciliation_id', $reconciliation->id)->first();
            if ($existing !== null) {
                if ($existing->classification === $classification && ($existing->note ?? null) === ($note === '' ? null : $note)) {
                    return $existing; // إعادة آمنة: القرار نفسه، بلا أثر.
                }
                throw new RuntimeException('METER_VARIANCE_ALREADY_REVIEWED: روجع هذا الفرق بالفعل؛ القرار ثابت ولا يُعدَّل.');
            }

            $review = (new FuelShiftMeterVarianceReview)->forceFill([
                'id' => (string) Str::uuid(), 'tenant_id' => $shift->tenant_id, 'branch_id' => $shift->branch_id, 'fuel_station_id' => $station->id,
                'fuel_shift_id' => $shift->id, 'fuel_nozzle_id' => $nozzleId, 'fuel_shift_nozzle_reconciliation_id' => $reconciliation->id,
                'classification' => $classification, 'note' => $note === '' ? null : $note, 'reviewed_by' => $actor->id, 'reviewed_at' => now(),
            ]);
            $review->save();
            FuelShiftEvent::create([
                'branch_id' => $shift->branch_id, 'fuel_shift_id' => $shift->id, 'type' => FuelShiftEvent::TYPE_METER_VARIANCE_REVIEWED,
                'payload' => ['nozzle_id' => $nozzleId, 'classification' => $classification, 'unexplained_milliliters' => $reconciliation->unexplained_milliliters, 'status' => $reconciliation->status],
                'actor_id' => $actor->id, 'occurred_at' => now(),
            ]);

            return $review;
        });
    }

    /**
     * شرط الاعتماد: كل لقطة مجمَّدة ذات متطلب مراجعة (فرق خارج التفاوت أو مطابقة لم تكتمل) تحتاج مراجعة مسجَّلة. وردية بلا لقطات (أُغلقت قبل PR-8 أو والمطابقة غير فعّالة) لا تُحجب.
     * يُستدعى تحت قفل الوردية `FOR UPDATE` من `FuelShiftService::approve`.
     */
    public function assertApprovable(FuelShift $shift): void
    {
        // لا شرط على البوابة ولا على الإعداد: المتطلب مثبَّت على اللقطة. ورديات بلا لقطات لا تُحجب (لا أثر رجعي). أي عطل في القراءة يرمي فيبقى الاعتماد محجوباً (فشل مغلق).
        $pending = FuelShiftNozzleReconciliation::where('fuel_shift_id', $shift->id)
            ->whereIn('status', [FuelShiftNozzleReconciliation::STATUS_VARIANCE, FuelShiftNozzleReconciliation::STATUS_INCOMPLETE])
            ->where(fn ($query) => $query->whereNull('review_requirement')->orWhere('review_requirement', self::REQUIREMENT))
            ->whereNotIn('id', FuelShiftMeterVarianceReview::query()->select('fuel_shift_nozzle_reconciliation_id'))
            ->exists();
        if ($pending) {
            throw new RuntimeException('FUEL_METER_VARIANCE_REVIEW_REQUIRED: يوجد فرق عدّاد فوهة يحتاج تصنيفاً ومراجعة مشرف مسجَّلة قبل اعتماد الوردية.');
        }
    }

    // ───────────────────────── الحساب ─────────────────────────

    /**
     * @return list<array<string,mixed>>
     */
    private function compute(FuelShift $shift, FuelStation $station, int $tolerance): array
    {
        $readings = FuelShiftMeterReading::where('fuel_shift_id', $shift->id)->get()->groupBy('fuel_nozzle_id');
        $liters = $this->liters->forShift($shift);
        $nozzles = FuelNozzle::where('fuel_station_id', $station->id)
            ->where(fn ($query) => $query->where('status', FuelNozzle::STATUS_ACTIVE)->orWhereIn('id', array_unique(array_merge(
                $readings->keys()->all(), array_keys($liters['direct']), array_keys($liters['tanker']),
            ))))
            ->orderBy('nozzle_number')->orderBy('id')->get();

        $rows = [];
        foreach ($nozzles as $nozzle) {
            $pair = $readings->get($nozzle->id, collect());
            $opening = $pair->firstWhere('reading_stage', FuelShiftMeterReading::STAGE_OPENING);
            $closing = $pair->firstWhere('reading_stage', FuelShiftMeterReading::STAGE_CLOSING);
            $direct = (int) ($liters['direct'][$nozzle->id] ?? 0);
            $tanker = (int) ($liters['tanker'][$nozzle->id] ?? 0);

            $metered = null;
            $unexplained = null;
            $incompleteness = null;
            if ($opening === null || $closing === null) {
                $incompleteness = FuelShiftNozzleReconciliation::INCOMPLETE_MISSING_READING;
            } else {
                $delta = (int) $closing->meter_milliliters - (int) $opening->meter_milliliters;
                if ($delta < 0) {
                    $incompleteness = FuelShiftNozzleReconciliation::INCOMPLETE_CLOSING_BELOW_OPENING;   // قراءة خاطئة: لا تُصحَّح ولا يُحسب لها فرق
                } else {
                    $metered = $delta;
                    $unexplained = $delta - $direct - $tanker;
                }
            }
            // فوهة بلا حركة ولا قراءات (احتياط نشط لم يُستعمل) لا تُنتج لقطة ضوضاء.
            if ($incompleteness === FuelShiftNozzleReconciliation::INCOMPLETE_MISSING_READING && $opening === null && $closing === null && $direct === 0 && $tanker === 0) {
                continue;
            }

            $status = match (true) {
                $incompleteness !== null => FuelShiftNozzleReconciliation::STATUS_INCOMPLETE,
                $unexplained === 0 => FuelShiftNozzleReconciliation::STATUS_BALANCED,
                abs($unexplained) <= $tolerance => FuelShiftNozzleReconciliation::STATUS_WITHIN_TOLERANCE,
                default => FuelShiftNozzleReconciliation::STATUS_VARIANCE,
            };

            $rows[] = [
                'fuel_nozzle_id' => $nozzle->id, 'fuel_product_id' => $nozzle->fuel_product_id,
                'metered_milliliters' => $metered, 'direct_sale_milliliters' => $direct, 'tanker_fill_milliliters' => $tanker,
                'tanker_fill_count' => (int) ($liters['tanker_count'][$nozzle->id] ?? 0), 'draft_sale_milliliters' => (int) ($liters['draft'][$nozzle->id] ?? 0),
                'unexplained_milliliters' => $unexplained, 'tolerance_milliliters' => $tolerance, 'status' => $status, 'incompleteness' => $incompleteness,
            ];
        }

        return $rows;
    }

    /** @param array<int,string> $frozenIds @return array<int,string> */
    private function nozzleIds(FuelShift $shift, array $frozenIds): array
    {
        if ($frozenIds !== []) {
            return $frozenIds;
        }

        return FuelNozzle::where('fuel_station_id', $shift->fuel_station_id)->pluck('id')->all();
    }

    /** @return array<string,mixed> */
    private function presentFrozen(FuelShiftNozzleReconciliation $r): array
    {
        return [
            'id' => $r->id, 'fuel_nozzle_id' => $r->fuel_nozzle_id, 'fuel_product_id' => $r->fuel_product_id,
            'metered_milliliters' => $r->metered_milliliters, 'direct_sale_milliliters' => (int) $r->direct_sale_milliliters,
            'tanker_fill_milliliters' => (int) $r->tanker_fill_milliliters, 'tanker_fill_count' => (int) $r->tanker_fill_count,
            'draft_sale_milliliters' => (int) $r->draft_sale_milliliters, 'unexplained_milliliters' => $r->unexplained_milliliters,
            'tolerance_milliliters' => (int) $r->tolerance_milliliters, 'status' => $r->status, 'incompleteness' => $r->incompleteness,
            'review' => $r->review === null ? null : [
                'classification' => $r->review->classification, 'note' => $r->review->note,
                'reviewed_by' => $r->review->reviewed_by, 'reviewed_at' => $r->review->reviewed_at?->toIso8601String(),
            ],
        ];
    }
}
