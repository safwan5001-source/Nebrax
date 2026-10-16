<?php

namespace App\Services;

use App\Contracts\AiAssistantTool;
use App\Models\Tenant;
use App\Models\User;
use App\Support\AiAssistantDataCategory;
use App\Support\AiAssistantDenied;
use App\Support\Money;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use InvalidArgumentException;

/**
 * أساس أدوات التقارير المالية للمساعد (AI-02B) — **قراءة فقط** فوق `ReportService`.
 *
 * الثوابت المشتركة:
 *  - الأرقام من الخدمة الحتمية نفسها (هللات صحيحة)؛ لا SQL مولَّد ولا إعادة حساب ولا float.
 *    تُعاد كل قيمة كـ`{minor:int, decimal:"1150.00"}` مع العملة والوحدة الصغرى صراحةً.
 *  - **SAR فقط** في المرحلة التجريبية: مستأجر بعملة أخرى يُرفض قبل أي قراءة (`currency_unsupported`).
 *  - الصلاحية `reports.view` (فوق `ai.assistant.use`) يفحصها الحارس عند كل استدعاء بفاعل طازج.
 *  - النطاق: الفروع المحلولة والمصرَّح بها فقط تُمرَّر صراحةً (لا اتساع). التقارير المالية بلا بُعد مخزن،
 *    فيُرفض طلبٌ يحدد مخازن صراحةً (`scope_not_supported`) بدل تجاهله بصمت — ويطابق ذلك سلوك مسارات
 *    `/api/reports/*` الحالية التي تفرض نطاق الفرع وحده.
 *  - التواريخ بتوقيت المستأجر، بصيغة `Y-m-d` صارمة، ولا تاريخ مستقبلي.
 */
abstract class AiFinanceReportTool implements AiAssistantTool
{
    public const CURRENCY = 'SAR';

    public const MINOR_UNIT = 2;

    /** حدّ مدة قائمة الدخل (يوم، شاملاً الطرفين). */
    public const MAX_PERIOD_DAYS = 366;

    private const DEFAULT_TIMEZONE = 'Asia/Riyadh';

    public function __construct(protected readonly TenantContext $tenantContext) {}

    public function requiredPermission(): string
    {
        return 'reports.view';
    }

    public function dataCategory(): string
    {
        return AiAssistantDataCategory::FINANCIAL_SUMMARY;
    }

    public function supportsWarehouseScope(): bool
    {
        return false;
    }

    /**
     * @param  array{mode:string, ids:list<string>}  $branchScope
     * @param  array{mode:string, ids:list<string>}  $warehouseScope
     */
    final public function execute(User $actor, array $arguments, array $branchScope, array $warehouseScope): array
    {
        $tenant = $this->tenant();
        if (strtoupper((string) $tenant->currency) !== self::CURRENCY) {
            throw AiAssistantDenied::for('currency_unsupported');
        }

        // ids فارغة = لا تصفية (غير مقيَّد ولم يطلب شيئاً)؛ وإلا القائمة المحلولة صراحةً.
        $branchFilter = $branchScope['mode'] === 'all' ? null : $branchScope['ids'];

        return $this->build($actor, $arguments, $branchScope, $branchFilter, $this->timezone($tenant));
    }

    /**
     * @param  array<string,mixed>  $arguments
     * @param  array{mode:string, ids:list<string>}  $branchScope
     * @param  list<string>|null  $branchFilter
     * @return array<string,mixed>
     */
    abstract protected function build(User $actor, array $arguments, array $branchScope, ?array $branchFilter, string $timezone): array;

    /** @return array{minor:int, decimal:string} */
    protected function money(int $minor): array
    {
        return ['minor' => $minor, 'decimal' => Money::toRiyal($minor)];
    }

    /** @return array<string,mixed> الرأس المشترك لكل نتيجة مالية. */
    protected function envelope(string $report, string $timezone, array $branchScope): array
    {
        return [
            'report' => $report,
            'schema_version' => 1,
            'currency' => self::CURRENCY,
            'minor_unit' => self::MINOR_UNIT,
            'currency_assumption' => 'sar_only_pilot_tenant_currency_verified',
            'scope' => [
                'branch' => $branchScope,
                // التقارير المالية بلا بُعد مخزن؛ لا تُصفّى بمخزن.
                'warehouse' => ['mode' => 'not_applicable', 'ids' => []],
            ],
            'timezone' => $timezone,
            'generated_at' => CarbonImmutable::now('UTC')->toIso8601String(),
        ];
    }

    /** @param array<string,mixed> $arguments @param list<string> $allowed */
    protected function assertClosedSchema(array $arguments, array $allowed): void
    {
        $unknown = array_diff(array_keys($arguments), $allowed);
        if ($unknown !== []) {
            throw new InvalidArgumentException('unsupported_argument');
        }
    }

    protected function parseDate(mixed $value, string $timezone): CarbonImmutable
    {
        if (! is_string($value) || preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) !== 1) {
            throw new InvalidArgumentException('invalid_date');
        }

        $date = CarbonImmutable::createFromFormat('!Y-m-d', $value, $timezone);
        if ($date === false || $date->format('Y-m-d') !== $value || $date->year < 2000) {
            throw new InvalidArgumentException('invalid_date');
        }
        if ($date->greaterThan($this->today($timezone))) {
            throw new InvalidArgumentException('future_date');
        }

        return $date;
    }

    protected function today(string $timezone): CarbonImmutable
    {
        return CarbonImmutable::now($timezone)->startOfDay();
    }

    protected function timezone(?Tenant $tenant = null): string
    {
        $zone = (string) (($tenant ?? $this->tenant())->timezone ?: self::DEFAULT_TIMEZONE);

        return in_array($zone, timezone_identifiers_list(), true) ? $zone : self::DEFAULT_TIMEZONE;
    }

    /** مستأجر السياق الموثوق حصراً. */
    protected function tenant(): Tenant
    {
        $id = $this->tenantContext->id();
        $tenant = $id === null ? null : Tenant::query()->find($id);
        if ($tenant === null) {
            throw AiAssistantDenied::for('actor_unavailable');
        }

        return $tenant;
    }

    /** @param array<string,mixed> $query */
    protected function apiPath(string $path, array $query, ?array $branchFilter): string
    {
        if ($branchFilter !== null) {
            $query['branch_id'] = $branchFilter;
        }

        return '/api/reports/' . $path . ($query === [] ? '' : '?' . http_build_query($query));
    }
}
