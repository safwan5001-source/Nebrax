<?php

namespace App\Services\Accounting;

use App\Models\FiscalYear;
use App\Models\FiscalYearClose;
use App\Models\FiscalYearEvent;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  FiscalYearService — تعريف السنوات المالية وإدارتها (FISCAL-2)
 * ═══════════════════════════════════════════════════════════════
 *  إنشاء/تعديل/عرض فقط. الإقفال والفتح في `FiscalCloseService` — فصلٌ متعمَّد:
 *  هذا مسار إعدادات، وذاك مسار يولّد قيوداً محاسبية.
 *
 *  ثلاث قواعد:
 *   1. **الحدّان شاملان** و`start <= end`، والسنة قد تكون غير تقويمية.
 *   2. **لا تتداخل سنتان** لمستأجر واحد — والفحص والإدراج داخل معاملة تقفل
 *      مِرساة المستأجر (نفس مِرساة ACC-6 وترقيم القيود)، فلا سباق
 *      «افحص ثم أدرج».
 *   3. **سنة أُقفلت لا تُعدَّل حدودها ولا تُحذف**: نطاقها صار حقيقةً محاسبية
 *      مسجَّلةً في قيدٍ مرحَّل، وتحريكه يكذب على القيد.
 */
class FiscalYearService
{
    public function __construct(private TenantContext $tenantContext) {}

    /** @return list<array<string, mixed>> */
    public function list(): array
    {
        return FiscalYear::query()
            ->with(['creator:id,name', 'closes.closer:id,name', 'closes.reopener:id,name'])
            ->orderByDesc('start_date')
            ->get()
            ->map(fn (FiscalYear $year) => $this->describe($year))
            ->all();
    }

    /** @return array<string, mixed> */
    public function create(array $data, ?User $actor): array
    {
        [$start, $end] = $this->normalizeRange($data);
        $name = trim((string) ($data['name'] ?? ''));
        if ($name === '') {
            throw new RuntimeException('اسم السنة المالية مطلوب.');
        }

        return DB::transaction(function () use ($start, $end, $name, $actor) {
            $this->lockAnchor();
            $this->assertNoOverlap($start, $end, null);

            $year = FiscalYear::create([
                'name'       => $name,
                'start_date' => $start,
                'end_date'   => $end,
                'status'     => FiscalYear::STATUS_OPEN,
                'created_by' => $actor?->id,
            ]);

            $this->recordEvent($year, FiscalYearEvent::YEAR_CREATED, $actor, null, [
                'start_date' => $start,
                'end_date'   => $end,
                'name'       => $name,
            ]);

            return $this->describe($year->fresh(['creator', 'closes']));
        });
    }

    /** @return array<string, mixed> */
    public function update(string $id, array $data, ?User $actor): array
    {
        return DB::transaction(function () use ($id, $data, $actor) {
            $this->lockAnchor();

            $year = FiscalYear::query()->whereKey($id)->first();
            if ($year === null) {
                throw new RuntimeException('السنة المالية غير موجودة.');
            }
            if ($year->isTransitioning()) {
                throw new RuntimeException('لا يمكن تعديل سنة مالية أثناء عملية إقفال أو فتح.');
            }

            $name = trim((string) ($data['name'] ?? $year->name));
            if ($name === '') {
                throw new RuntimeException('اسم السنة المالية مطلوب.');
            }

            $wantsRangeChange = array_key_exists('start_date', $data) || array_key_exists('end_date', $data);
            $start = $year->start_date->toDateString();
            $end   = $year->end_date->toDateString();

            if ($wantsRangeChange) {
                [$newStart, $newEnd] = $this->normalizeRange([
                    'start_date' => $data['start_date'] ?? $start,
                    'end_date'   => $data['end_date'] ?? $end,
                ]);

                // سنةٌ لها تاريخ إقفال — ولو جيلاً معكوساً — نطاقُها مثبَّت:
                // القيد المرحَّل حُسب على حدودها، فتحريكها بأثر رجعي يجعل
                // الرقم المخزَّن لا يطابق أي فترة قائمة.
                if (($newStart !== $start || $newEnd !== $end) && ! $this->rangeIsMutable($year)) {
                    throw new RuntimeException('لا يمكن تعديل حدود سنة مالية أُقفلت أو لها سجل إقفال.');
                }

                $this->assertNoOverlap($newStart, $newEnd, $year->id);
                $start = $newStart;
                $end   = $newEnd;
            }

            $year->update(['name' => $name, 'start_date' => $start, 'end_date' => $end]);

            $this->recordEvent($year, FiscalYearEvent::YEAR_UPDATED, $actor, null, [
                'start_date' => $start,
                'end_date'   => $end,
                'name'       => $name,
            ]);

            return $this->describe($year->fresh(['creator', 'closes']));
        });
    }

    /** @return list<array<string, mixed>> سجل التدقيق، الأحدث أولاً. */
    public function events(?string $fiscalYearId = null): array
    {
        return FiscalYearEvent::query()
            ->with('actor:id,name')
            ->when($fiscalYearId !== null, fn ($q) => $q->where('fiscal_year_id', $fiscalYearId))
            ->orderByDesc('created_at')
            ->get()
            ->map(fn (FiscalYearEvent $event) => [
                'id'            => $event->id,
                'fiscal_year_id' => $event->fiscal_year_id,
                'action'        => $event->action,
                'actor'         => $event->actor?->name,
                'generation'    => $event->generation,
                'journal_entry_id' => $event->journal_entry_id,
                'reason'        => $event->reason,
                'details'       => $event->details,
                'created_at'    => $event->created_at?->toIso8601String(),
            ])
            ->all();
    }

    /** السنة المالية التي يقع فيها تاريخ معيّن، إن وُجدت. */
    public function yearContaining(string $date): ?FiscalYear
    {
        return FiscalYear::query()
            ->whereDate('start_date', '<=', $date)
            ->whereDate('end_date', '>=', $date)
            ->first();
    }

    /** @return array<string, mixed> */
    public function describe(FiscalYear $year): array
    {
        $year->loadMissing(['creator', 'closes.closer', 'closes.reopener']);
        $active = $year->closes->firstWhere('status', FiscalYearClose::STATUS_ACTIVE);

        return [
            'id'         => $year->id,
            'name'       => $year->name,
            'start_date' => $year->start_date->toDateString(),
            'end_date'   => $year->end_date->toDateString(),
            'status'     => $year->status,
            'created_by' => $year->creator?->name,
            'created_at' => $year->created_at?->toIso8601String(),
            'active_generation' => $active?->generation,
            // سنةٌ أُقفلت بلا قيد (لا نشاط) تُميَّز صراحةً عن سنةٍ لها قيد إقفال.
            'closed_without_journal' => $active !== null && $active->isZeroActivity(),
            'generations' => $year->closes->map(fn (FiscalYearClose $close) => [
                'id'          => $close->id,
                'generation'  => $close->generation,
                'status'      => $close->status,
                'journal_entry_id'  => $close->journal_entry_id,
                'reversal_entry_id' => $close->reversal_entry_id,
                'total_revenue' => $close->total_revenue,
                'total_expense' => $close->total_expense,
                'net_income'    => $close->net_income,
                'closed_by'     => $close->closer?->name,
                'closed_at'     => $close->closed_at?->toIso8601String(),
                'reopened_by'   => $close->reopener?->name,
                'reopened_at'   => $close->reopened_at?->toIso8601String(),
                'reopen_reason' => $close->reopen_reason,
            ])->values()->all(),
        ];
    }

    /** @return array{0:string,1:string} */
    private function normalizeRange(array $data): array
    {
        $start = $this->normalizeDate($data['start_date'] ?? null, 'تاريخ بداية السنة المالية');
        $end   = $this->normalizeDate($data['end_date'] ?? null, 'تاريخ نهاية السنة المالية');

        if ($start > $end) {
            throw new RuntimeException('تاريخ بداية السنة المالية يجب ألّا يتجاوز تاريخ نهايتها.');
        }

        return [$start, $end];
    }

    private function normalizeDate(mixed $value, string $label): string
    {
        if ($value === null || $value === '') {
            throw new RuntimeException("{$label} مطلوب.");
        }

        try {
            return Carbon::parse((string) $value)->toDateString();
        } catch (\Throwable) {
            throw new RuntimeException("{$label} غير صالح.");
        }
    }

    /** التداخل بين نطاقين مغلقين شاملين: البداية ≤ نهاية الآخر والنهاية ≥ بدايته. */
    private function assertNoOverlap(string $start, string $end, ?string $exceptId): void
    {
        $conflict = FiscalYear::query()
            ->when($exceptId !== null, fn ($q) => $q->whereKeyNot($exceptId))
            ->whereDate('start_date', '<=', $end)
            ->whereDate('end_date', '>=', $start)
            ->first();

        if ($conflict !== null) {
            throw new RuntimeException(sprintf(
                'النطاق يتداخل مع السنة المالية «%s» (%s إلى %s).',
                $conflict->name,
                $conflict->start_date->toDateString(),
                $conflict->end_date->toDateString(),
            ));
        }
    }

    private function rangeIsMutable(FiscalYear $year): bool
    {
        return $year->isOpen() && $year->closes()->count() === 0;
    }

    private function recordEvent(FiscalYear $year, string $action, ?User $actor, ?string $reason, array $details): void
    {
        FiscalYearEvent::create([
            'fiscal_year_id' => $year->id,
            'action'         => $action,
            'actor_user_id'  => $actor?->id,
            'reason'         => $reason,
            'details'        => $details,
        ]);
    }

    /**
     * مِرساة التسلسل: صفّ المستأجر — نفسه الذي يقفله `AccountingDateGuard`
     * وترقيمُ القيود وخدمة أقفال الفترات (ACC-6). فلا mutex في ذاكرة العملية.
     */
    private function lockAnchor(): void
    {
        $tenantId = $this->tenantContext->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا يوجد مستأجر نشط لإدارة السنوات المالية.');
        }

        Tenant::whereKey($tenantId)->lockForUpdate()->firstOrFail();
    }
}
