<?php

namespace App\Services\Accounting;

use App\Models\AccountingPeriodLock;
use App\Models\AccountingPeriodLockEvent;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  AccountingPeriodLockService — إدارة نطاقات القفل (ACC-6)
 * ═══════════════════════════════════════════════════════════════
 *  المسار الإداري وحده: عرض · إنشاء · تحرير. لا ترحيل هنا ولا قراءةً يعتمدها
 *  المحرّك — الإنفاذ في `AccountingDateGuard` داخل `LedgerService` حصراً.
 *
 *  ═══ ثلاث قواعد تحكم هذه الطبقة ═══
 *
 *  1. **لا تعديل في المكان ولا حذف.** تصحيح نطاق قائم = تحريره بسبب ثم إنشاء
 *     نطاق بديل. فالتاريخ الإداري لا يُمحى: من قفل، ومتى، ولماذا، ومن حرّر.
 *     الصفّ المحرَّر يبقى بحالة `released`، والسجل الثابت يشهد على الفعلين.
 *
 *  2. **لا تداخل بين النطاقات النشطة.** ولا يُعتمد في منعه على
 *     «افحص ثم أدرج» عارياً: الفحص والإدراج داخل معاملة واحدة تقفل مِرساة
 *     المستأجر أولاً (`tenants`) — نفس مِرساة الحارس ومِرساة ترقيم القيود.
 *     فطلبان متزامنان يتسلسلان فعلاً على PostgreSQL، ولا يمرّان معاً.
 *     التلاصق مسموح: نطاقٌ ينتهي في يوم ويبدأ التالي في اليوم التالي.
 *
 *  3. **تواريخ محاسبية `Y-m-d`، شاملة الطرفين.** لا طوابع زمنية ولا تحويل
 *     منطقة زمنية — القفل يقارن أياماً تقويمية كما يقارنها الأستاذ.
 */
class AccountingPeriodLockService
{
    public function __construct(private TenantContext $tenantContext) {}

    /** @return array{locks: list<array<string, mixed>>} */
    public function list(): array
    {
        $locks = AccountingPeriodLock::query()
            ->with(['creator:id,name', 'releaser:id,name'])
            // النشط أولاً ثم الأحدث نطاقاً: الشاشة أداة يومية، وأولُ ما يُسأل
            // عنه «ما المقفول الآن؟» لا «ما أُنشئ آخراً».
            ->orderByRaw("CASE WHEN status = 'active' THEN 0 ELSE 1 END")
            ->orderByDesc('start_date')
            ->get()
            ->map(fn (AccountingPeriodLock $lock) => $this->describe($lock))
            ->all();

        return ['locks' => $locks];
    }

    /** @return array<string, mixed> */
    public function create(string $startDate, string $endDate, string $reason, ?User $actor): array
    {
        $start = $this->normalize($startDate, 'تاريخ البداية');
        $end   = $this->normalize($endDate, 'تاريخ النهاية');

        if ($start > $end) {
            throw new RuntimeException('تاريخ بداية النطاق يجب ألّا يتجاوز تاريخ نهايته.');
        }

        $reason = trim($reason);
        if ($reason === '') {
            throw new RuntimeException('سبب القفل مطلوب.');
        }

        return DB::transaction(function () use ($start, $end, $reason, $actor) {
            $this->lockAnchor();

            // الفحص **داخل** المعاملة وبعد المِرساة: التداخل مستحيل لا مستبعَد.
            // شرط التداخل بين نطاقين مغلقين شاملين: البداية ≤ نهاية الآخر
            // والنهاية ≥ بدايته. التلاصق يخرج منه طبيعياً بلا استثناء خاص.
            $conflict = AccountingPeriodLock::query()
                ->where('status', 'active')
                ->whereDate('start_date', '<=', $end)
                ->whereDate('end_date', '>=', $start)
                ->first();

            if ($conflict !== null) {
                throw new RuntimeException(sprintf(
                    'النطاق يتداخل مع قفل نشط قائم من %s إلى %s.',
                    $conflict->start_date->toDateString(),
                    $conflict->end_date->toDateString(),
                ));
            }

            $lock = AccountingPeriodLock::create([
                'start_date' => $start,
                'end_date'   => $end,
                'status'     => 'active',
                'reason'     => $reason,
                'created_by' => $actor?->id,
            ]);

            $this->recordEvent($lock, 'lock_created', $actor, $reason);

            return $this->describe($lock->fresh(['creator', 'releaser']));
        });
    }

    /** @return array<string, mixed> */
    public function release(string $id, string $reason, ?User $actor): array
    {
        $reason = trim($reason);
        if ($reason === '') {
            throw new RuntimeException('سبب تحرير القفل مطلوب.');
        }

        return DB::transaction(function () use ($id, $reason, $actor) {
            $this->lockAnchor();

            // إعادة القراءة داخل المعاملة: تحريران متزامنان لا يكتب ثانيهما
            // فوق الأول ولا يسجّل حدثاً ثانياً لقفلٍ محرَّر أصلاً.
            $lock = AccountingPeriodLock::query()->whereKey($id)->first();
            if ($lock === null) {
                throw new RuntimeException('نطاق القفل غير موجود.');
            }
            if (! $lock->isActive()) {
                throw new RuntimeException('نطاق القفل محرَّر بالفعل.');
            }

            $lock->update([
                'status'         => 'released',
                'released_by'    => $actor?->id,
                'released_at'    => Carbon::now(),
                'release_reason' => $reason,
            ]);

            $this->recordEvent($lock, 'lock_released', $actor, $reason);

            return $this->describe($lock->fresh(['creator', 'releaser']));
        });
    }

    /** @return list<array<string, mixed>> سجل التدقيق الثابت، الأحدث أولاً. */
    public function events(?string $lockId = null): array
    {
        return AccountingPeriodLockEvent::query()
            ->with('actor:id,name')
            ->when($lockId !== null, fn ($q) => $q->where('accounting_period_lock_id', $lockId))
            ->orderByDesc('created_at')
            ->get()
            ->map(fn (AccountingPeriodLockEvent $event) => [
                'id'         => $event->id,
                'lock_id'    => $event->accounting_period_lock_id,
                'action'     => $event->action,
                'actor'      => $event->actor?->name,
                'start_date' => $event->start_date->toDateString(),
                'end_date'   => $event->end_date->toDateString(),
                'reason'     => $event->reason,
                'created_at' => $event->created_at?->toIso8601String(),
            ])
            ->all();
    }

    /** @return array<string, mixed> */
    private function describe(AccountingPeriodLock $lock): array
    {
        return [
            'id'             => $lock->id,
            'start_date'     => $lock->start_date->toDateString(),
            'end_date'       => $lock->end_date->toDateString(),
            'status'         => $lock->status,
            'reason'         => $lock->reason,
            'created_by'     => $lock->creator?->name,
            'created_at'     => $lock->created_at?->toIso8601String(),
            'released_by'    => $lock->releaser?->name,
            'released_at'    => $lock->released_at?->toIso8601String(),
            'release_reason' => $lock->release_reason,
        ];
    }

    private function recordEvent(AccountingPeriodLock $lock, string $action, ?User $actor, string $reason): void
    {
        AccountingPeriodLockEvent::create([
            'accounting_period_lock_id' => $lock->id,
            'action'                    => $action,
            'actor_user_id'             => $actor?->id,
            'start_date'                => $lock->start_date->toDateString(),
            'end_date'                  => $lock->end_date->toDateString(),
            'reason'                    => $reason,
        ]);
    }

    /** تاريخ محاسبي `Y-m-d` — بلا وقت وبلا إزاحة منطقة زمنية. */
    private function normalize(string $value, string $label): string
    {
        try {
            return Carbon::parse($value)->toDateString();
        } catch (\Throwable) {
            throw new RuntimeException("{$label} غير صالح.");
        }
    }

    /**
     * مِرساة التسلسل: صفّ المستأجر — نفسه الذي يقفله `AccountingDateGuard`
     * وترقيمُ القيود. فالإنشاء/التحرير يتبادل الاستبعاد مع الترحيل على
     * PostgreSQL بلا mutex في ذاكرة العملية.
     */
    private function lockAnchor(): void
    {
        $tenantId = $this->tenantContext->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا يوجد مستأجر نشط لإدارة أقفال الفترات.');
        }

        Tenant::whereKey($tenantId)->lockForUpdate()->firstOrFail();
    }
}
