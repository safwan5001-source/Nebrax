<?php

namespace App\Services\Reporting;

use App\Models\FuelStation;
use App\Models\Tenant;
use App\Models\User;
use App\Services\FuelStationSettingsService;
use App\Support\FuelCostVisibility;
use App\Support\FuelReportCatalog;
use App\Support\FuelReportDefinition;
use App\Support\FuelReportTable;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Support\Facades\Validator;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * محرك تقارير الوقود الموحَّد — **المصدر الوحيد** لأرقام التقارير في تطبيق المحطة ووحدة أَوْج وPDF وExcel وCSV.
 *
 * الخط: تعريف من السجل ← تفويض (صلاحية الاطلاع) ← تحقق من المرشحات ← سياق (محطات المستخدم المتاحة فقط) ← بانٍ ← حذف الأعمدة الحسّاسة
 * من الحمولة نفسها ← إجماليات (تُجمَع هنا مرة واحدة) ← حمولة بعقد ثابت. لا يكتب شيئاً في قاعدة البيانات.
 *
 * الأمان: المستأجر من `TenantContext` (يُرفض التشغيل بدونه)، والمحطات من `accessibleStationIds` الممرَّرة من المتحكّم (null = غير مقيَّد)،
 * ومحطة خارج النطاق ⇒ 404 موحَّد. لا تُقبل أي معرّفات مستأجر/محطة من المدخلات خارج هذا التحقق.
 */
class FuelReportEngine
{
    /** @var array<string,list<mixed>> */
    private const RULES = [
        'station_id' => ['nullable', 'uuid'],
        'from' => ['nullable', 'date_format:Y-m-d'],
        'to' => ['nullable', 'date_format:Y-m-d'],
        'compare_from' => ['nullable', 'date_format:Y-m-d'],
        'compare_to' => ['nullable', 'date_format:Y-m-d'],
        'product_id' => ['nullable', 'uuid'],
        'pump_id' => ['nullable', 'uuid'],
        'nozzle_id' => ['nullable', 'uuid'],
        'user_id' => ['nullable', 'uuid'],
        'shift_id' => ['nullable', 'uuid'],
        'status' => ['nullable', 'in:open,closed,approved,requested,rejected,draft'],
        'group' => ['nullable', 'in:day,week,month'],
        'date_basis' => ['nullable', 'in:opened,closed'],
        'dimension' => ['nullable', 'in:product,station'],
        'overdue_hours' => ['nullable', 'integer', 'min:1', 'max:720'],
    ];

    public function __construct(private FuelStationSettingsService $settings) {}

    /** @return array{families:array<string,array{ar:string,en:string}>,reports:list<array<string,mixed>>} */
    public function catalog(User $user): array
    {
        $reports = array_map(fn (FuelReportDefinition $d) => $d->toArray(), FuelReportCatalog::visibleTo($user));

        return ['families' => FuelReportCatalog::FAMILIES, 'reports' => $reports];
    }

    /**
     * @param  array<string,mixed>  $params
     * @param  list<string>|null  $accessibleStationIds  null = مستخدم غير مقيَّد بمحطات
     * @param  Closure(\Illuminate\Database\Eloquent\Builder):\Illuminate\Database\Eloquent\Builder  $branchScope
     * @return array<string,mixed>
     */
    public function run(User $user, string $key, array $params, ?array $accessibleStationIds, Closure $branchScope): array
    {
        if (! app(TenantContext::class)->has()) {
            throw new HttpException(403, 'تقارير محطات الوقود تتطلب سياق مستأجر موثوقاً.');
        }
        $definition = FuelReportCatalog::find($key) ?? throw new HttpException(404);
        // 404 (لا 403) كي لا يُكشف وجود تقرير لا يملك المستخدم صلاحيته.
        if (! FuelReportCatalog::allows($user, $definition)) {
            throw new HttpException(404);
        }

        $filters = $this->validated($params, $definition);
        $stations = $this->resolveStations($filters['station_id'] ?? null, $accessibleStationIds);
        $context = new FuelReportContext($user, $filters, $stations, $branchScope, CarbonImmutable::now(), $this->settings);

        /** @var FuelReportBuilder $builder */
        $builder = app($definition->builder);
        $built = $builder->build($definition, $context);

        $allowed = $this->allowedSensitivities($user);
        // جدول كامل حسّاس (مثل مصفوفة المبالغ) يُحذف بكامله لمن لا يملك سلطته؛ وإلا تُحذف أعمدته الحسّاسة وحدها.
        $tables = array_values(array_map(
            fn (array $table) => $this->withTotals($this->redactTable($table, $allowed)),
            array_filter($built['tables'], fn (array $table) => $this->permitted($table['sensitivity'] ?? null, $allowed)),
        ));
        $summary = array_values(array_filter($built['summary'] ?? [], fn (array $item) => $this->permitted($item['sensitivity'] ?? null, $allowed)));
        $summary = array_map(function (array $item) {
            unset($item['sensitivity']);

            return $item;
        }, $summary);

        $gaps = array_values(array_unique($built['gaps'] ?? []));
        $usesPeriod = $built['period'] ?? true;

        return [
            'report' => $definition->toArray(),
            'generated_at' => $context->generatedAt->utc()->toIso8601String(),
            'timezone' => $context->timezoneList()[0],
            'timezones' => $context->timezoneList(),
            'tenant' => ['name' => Tenant::query()->whereKey(app(TenantContext::class)->id())->value('name')],
            'stations' => $stations->map(fn (FuelStation $s) => ['id' => $s->id, 'name' => $s->name, 'code' => $s->code])->values()->all(),
            'period' => $usesPeriod ? ['from' => $context->period()[0], 'to' => $context->period()[1]] : null,
            'filters' => array_filter($filters, fn ($v) => $v !== null && $v !== ''),
            'summary' => $summary,
            'tables' => $tables,
            'data_quality' => ['complete' => $gaps === [] && ! ($built['truncated'] ?? false), 'gaps' => $gaps, 'notes' => $built['notes'] ?? []],
            'truncated' => (bool) ($built['truncated'] ?? false),
            'source' => ['kind' => $definition->source],
        ];
    }

    /** @param array<string,mixed> $params @return array<string,mixed> */
    private function validated(array $params, FuelReportDefinition $definition): array
    {
        $rules = array_intersect_key(self::RULES, array_flip($definition->filters));
        $input = array_intersect_key($params, $rules);
        $validated = Validator::make($input, $rules)->validate();

        return array_filter($validated, fn ($v) => $v !== null && $v !== '');
    }

    /**
     * @param  list<string>|null  $accessible
     * @return \Illuminate\Support\Collection<string,FuelStation>
     */
    private function resolveStations(?string $requested, ?array $accessible)
    {
        $query = FuelStation::query()->orderBy('name');
        if ($accessible !== null) {
            $query->whereIn('id', $accessible);
        }
        if ($requested !== null) {
            $query->where('id', $requested);
        }
        $stations = $query->get()->keyBy('id');
        if ($requested !== null && $stations->isEmpty()) {
            throw new HttpException(404); // خارج النطاق أو غير موجودة: رد واحد لا يميّز
        }

        return $stations;
    }

    /** @return array{sales:bool,cost:bool,credit:bool} */
    private function allowedSensitivities(User $user): array
    {
        return [
            FuelReportTable::SALES => $user->hasPermission('fuel.sale.view'),
            FuelReportTable::COST => FuelCostVisibility::canSeeCost($user),
            FuelReportTable::CREDIT => FuelCostVisibility::canSeeCredit($user),
        ];
    }

    /** @param array<string,bool> $allowed */
    private function permitted(?string $sensitivity, array $allowed): bool
    {
        return $sensitivity === null || ($allowed[$sensitivity] ?? false);
    }

    /**
     * يحذف الأعمدة الحسّاسة (التعريف والقيم) من الحمولة نفسها — لا يبقى أثر لقيمتها في JSON/Excel/CSV/PDF.
     *
     * @param  array<string,mixed>  $table
     * @param  array<string,bool>  $allowed
     * @return array<string,mixed>
     */
    private function redactTable(array $table, array $allowed): array
    {
        $drop = [];
        $kept = [];
        foreach ($table['columns'] as $column) {
            if ($this->permitted($column['sensitivity'] ?? null, $allowed)) {
                unset($column['sensitivity']);
                $kept[] = $column;
            } else {
                $drop[] = $column['key'];
            }
        }
        unset($table['sensitivity']);
        $table['columns'] = $kept;
        $table['rows'] = array_map(fn (array $row) => array_diff_key($row, array_flip($drop)), $table['rows']);

        return $table;
    }

    /**
     * إجماليات الأعمدة `total = sum`: أي قيمة `null` في عمود ⇒ إجماليه `null` (غير مكتمل، لا مجموع جزئي كإجمالي). بلا صفوف ⇒ لا إجماليات.
     *
     * @param  array<string,mixed>  $table
     * @return array<string,mixed>
     */
    private function withTotals(array $table): array
    {
        if ($table['rows'] === []) {
            return $table;
        }
        $totals = [];
        foreach ($table['columns'] as $column) {
            if (($column['total'] ?? null) !== 'sum') {
                continue;
            }
            $sum = 0;
            foreach ($table['rows'] as $row) {
                $value = $row[$column['key']] ?? null;
                if ($value === null) {
                    $sum = null;
                    break;
                }
                $sum += (int) $value;
            }
            $totals[$column['key']] = $sum;
        }
        $table['totals'] = $totals === [] ? null : $totals;

        return $table;
    }
}
