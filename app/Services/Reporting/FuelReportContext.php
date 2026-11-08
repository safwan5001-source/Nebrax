<?php

namespace App\Services\Reporting;

use App\Models\FuelStation;
use App\Models\User;
use App\Services\FuelStationSettingsService;
use Carbon\CarbonImmutable;
use Closure;
use DateTimeInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

/**
 * سياق تشغيل تقرير وقود واحد — ثابت بعد البناء:
 *  - المستخدم والمرشحات المُتحقَّق منها؛
 *  - المحطات **المتاحة للمستخدم فقط** (فرعاً ومخزناً ومحطات مسنَدة) بعد تطبيق مرشح `station_id`؛ لا استعلام بلا `scoped()`؛
 *  - الفترة بالتقويم **بتوقيت كل محطة** (`FuelStationSettingsService::operatingTimezone`) لا بتوقيت الخادم.
 *
 * لا يخزّن معرّف مستأجر: العزل آلي بنطاق `BaseModel`، والمحطات المتاحة نفسها محلولة داخل المستأجر الحالي.
 */
final class FuelReportContext
{
    /** حد أقصى لمدى الفترة بالأيام (حماية الأداء). */
    public const MAX_RANGE_DAYS = 366;

    /** @var array<string,string> station_id => timezone */
    private array $timezones = [];

    /** @var array{0:string,1:string}|null */
    private ?array $period = null;

    /**
     * @param  array<string,mixed>  $filters
     * @param  Collection<string,FuelStation>  $stations  المحطات المتاحة (بعد مرشح المحطة) مفهرسة بالمعرّف
     * @param  Closure(Builder):Builder  $branchScope  نطاق الفرع النشط/المسموح (من المتحكّم)
     */
    public function __construct(
        public readonly User $user,
        public readonly array $filters,
        public readonly Collection $stations,
        private readonly Closure $branchScope,
        public readonly CarbonImmutable $generatedAt,
        private readonly FuelStationSettingsService $settings,
    ) {
        foreach ($stations as $id => $station) {
            $this->timezones[$id] = $settings->operatingTimezone($station);
        }
    }

    /** نسخة بمرشحات افتراضية لم يحدّدها المستخدم (قيم المستخدم تتقدّم دائماً) — لتقارير بفترة افتراضية خاصة (اليوم، الشهر). @param array<string,mixed> $defaults */
    public function withDefaults(array $defaults): self
    {
        return new self($this->user, $this->filters + $defaults, $this->stations, $this->branchScope, $this->generatedAt, $this->settings);
    }

    /** تاريخ اليوم بتوقيت أول محطة متاحة. */
    public function today(): string
    {
        return $this->generatedAt->setTimezone($this->timezoneList()[0])->toDateString();
    }

    /** @return list<string> */
    public function stationIds(): array
    {
        return $this->stations->keys()->map(fn ($id) => (string) $id)->values()->all();
    }

    public function filter(string $key): mixed
    {
        $value = $this->filters[$key] ?? null;

        return $value === '' ? null : $value;
    }

    public function timezone(string $stationId): string
    {
        return $this->timezones[$stationId] ?? FuelStationSettingsService::FALLBACK_TIMEZONE;
    }

    /** @return list<string> */
    public function timezoneList(): array
    {
        return array_values(array_unique($this->timezones)) ?: [FuelStationSettingsService::FALLBACK_TIMEZONE];
    }

    /** يقيّد الاستعلام بمحطات المستخدم المتاحة والفرع المسموح (فارغ ⇒ لا صفوف). */
    public function scoped(Builder $query, string $stationColumn = 'fuel_station_id'): Builder
    {
        $query->whereIn($query->getModel()->getTable().'.'.$stationColumn, $this->stationIds());

        return ($this->branchScope)($query);
    }

    /** @return array{0:string,1:string} [من، إلى] تاريخان شاملان (Y-m-d). */
    public function period(): array
    {
        if ($this->period !== null) {
            return $this->period;
        }
        $anchorTz = $this->timezoneList()[0];
        $to = $this->filter('to') ?? CarbonImmutable::now($anchorTz)->toDateString();
        $from = $this->filter('from') ?? CarbonImmutable::parse($to, $anchorTz)->subDays(6)->toDateString();
        if (CarbonImmutable::parse($from)->greaterThan(CarbonImmutable::parse($to))) {
            throw ValidationException::withMessages(['from' => ['تاريخ البداية بعد تاريخ النهاية.']]);
        }
        if (CarbonImmutable::parse($from)->diffInDays(CarbonImmutable::parse($to)) > self::MAX_RANGE_DAYS) {
            throw ValidationException::withMessages(['to' => ['مدى الفترة يتجاوز '.self::MAX_RANGE_DAYS.' يوماً؛ ضيّق الفترة.']]);
        }

        return $this->period = [$from, $to];
    }

    /**
     * يقيّد عموداً زمنياً بالفترة (أو بفترة بديلة) بحدود يوم **كل محطة** بتوقيتها، مجمَّعةً بالمنطقة الزمنية.
     *
     * @param  array{0:string,1:string}|null  $period
     */
    public function constrainPeriod(Builder $query, string $column, string $stationColumn = 'fuel_station_id', ?array $period = null): Builder
    {
        [$from, $to] = $period ?? $this->period();
        $table = $query->getModel()->getTable();
        $groups = [];
        foreach ($this->timezones as $stationId => $tz) {
            $groups[$tz][] = $stationId;
        }
        if ($groups === []) {
            return $query->whereRaw('1 = 0');
        }

        return $query->where(function (Builder $outer) use ($groups, $from, $to, $table, $column, $stationColumn) {
            foreach ($groups as $tz => $ids) {
                $start = CarbonImmutable::parse($from, $tz)->startOfDay()->utc();
                $endExclusive = CarbonImmutable::parse($to, $tz)->addDay()->startOfDay()->utc();
                $outer->orWhere(fn (Builder $q) => $q->whereIn($table.'.'.$stationColumn, $ids)
                    ->where($table.'.'.$column, '>=', $start)->where($table.'.'.$column, '<', $endExclusive));
            }
        });
    }

    /**
     * أوسع مدى UTC يغطي الفترة في كل مناطق المحطات (للاستعلام الأولي ثم ترشيح دقيق بالتاريخ المحلي لكل سجل).
     *
     * @return array{0:CarbonImmutable,1:CarbonImmutable}
     */
    public function utcEnvelope(): array
    {
        [$from, $to] = $this->period();
        $starts = [];
        $ends = [];
        foreach ($this->timezoneList() as $tz) {
            $starts[] = CarbonImmutable::parse($from, $tz)->startOfDay()->utc();
            $ends[] = CarbonImmutable::parse($to, $tz)->addDay()->startOfDay()->utc();
        }

        return [min($starts), max($ends)];
    }

    /** هل تاريخ التقويم المحلي للحظة (بتوقيت المحطة) ضمن الفترة؟ */
    public function inPeriod(?DateTimeInterface $at, string $stationId): bool
    {
        $date = $this->businessDate($at, $stationId);
        [$from, $to] = $this->period();

        return $date !== null && $date >= $from && $date <= $to;
    }

    /** تاريخ التقويم (Y-m-d) للحظة بتوقيت المحطة. */
    public function businessDate(?DateTimeInterface $at, string $stationId): ?string
    {
        return $at === null ? null : CarbonImmutable::instance($at)->setTimezone($this->timezone($stationId))->toDateString();
    }

    public function stationName(string $stationId): string
    {
        $station = $this->stations->get($stationId);

        return $station === null ? '' : (string) $station->name;
    }

    /** مرشح الفترة المقارِنة (`sales.comparison`): الافتراضي الفترة السابقة بالطول نفسه. @return array{0:string,1:string} */
    public function comparePeriod(): array
    {
        [$from, $to] = $this->period();
        $cFrom = $this->filter('compare_from');
        $cTo = $this->filter('compare_to');
        if ($cFrom !== null && $cTo !== null) {
            if (CarbonImmutable::parse($cFrom)->greaterThan(CarbonImmutable::parse($cTo))) {
                throw ValidationException::withMessages(['compare_from' => ['تاريخ بداية فترة المقارنة بعد نهايتها.']]);
            }

            return [$cFrom, $cTo];
        }
        $days = CarbonImmutable::parse($from)->diffInDays(CarbonImmutable::parse($to)) + 1;

        return [CarbonImmutable::parse($from)->subDays($days)->toDateString(), CarbonImmutable::parse($from)->subDay()->toDateString()];
    }
}
