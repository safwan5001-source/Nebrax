<?php

namespace App\Services;

use App\Models\Branch;
use App\Models\CrmActivity;
use App\Models\Employee;
use App\Models\EmployeeCustody;
use App\Models\Expense;
use App\Models\FuelStation;
use App\Models\Payment;
use App\Models\PosSession;
use App\Models\Purchase;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\TenantApplicationEvent;
use App\Models\TenantApplicationGroupEvent;
use App\Models\TenantApplicationGroupState;
use App\Models\TenantApplicationState;
use App\Models\User;
use App\Support\ApplicationCatalog;
use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * قرار كل مستأجر بتفعيل/تعطيل تطبيق رئيسي وقدراته الفرعية مع فحص الاعتماديات
 * والإلزامية وسجل تدقيق. حالة التطبيق الرئيسي مستقلة عن حالات الفروع، ولذلك
 * تعطيله يحجب التطبيق كله من دون تغيير اختيارات الفروع المحفوظة.
 */
class TenantApplicationService
{
    public function __construct(private CommercialApplicationStatusService $commercialStatus) {}

    private const ENFORCEMENT_CUTOVER_AT = '2026-08-21 00:00:00';

    /** @return array<string, Closure(): bool> */
    private function dataChecks(): array
    {
        return [
            'sales.pos' => fn () => PosSession::query()->exists(),
            'crm.follow_up' => fn () => CrmActivity::query()->exists(),
            'inventory.core' => fn () => StockMovement::query()->exists(),
            'purchases.cycle' => fn () => Purchase::query()->exists(),
            'hr.employees' => fn () => Employee::query()->exists(),
            'company.branches' => fn () => Branch::where('is_main', false)->exists(),
            'finance.operations' => fn () => Expense::query()->exists()
                || Payment::query()->exists()
                || EmployeeCustody::query()->exists(),
            'fuel_stations.core' => fn () => FuelStation::query()->exists(),
        ];
    }

    private function hasOperationalData(string $key): bool
    {
        $check = $this->dataChecks()[$key] ?? null;

        return $check !== null && $check();
    }

    public function hasOperationalEvidence(string $key): bool
    {
        return $this->hasOperationalData($key);
    }

    /** @return list<string> */
    public function groupKeys(): array
    {
        return array_values(array_unique(array_map(
            fn (array $application) => $application['group'],
            ApplicationCatalog::all(),
        )));
    }

    private function groupExists(string $group): bool
    {
        return in_array($group, $this->groupKeys(), true);
    }

    /** غياب صف المجموعة يعني مفعّلة، حفاظاً على السلوك السابق للنشر. */
    public function isGroupEnabled(string $group): bool
    {
        if (! $this->groupExists($group)) {
            return false;
        }

        $value = TenantApplicationGroupState::query()
            ->where('group_key', $group)
            ->value('requested_enabled');

        return $value === null ? true : (bool) $value;
    }

    /**
     * @return array<string, array{key:string,enabled:bool,manageable:bool,changed_by:?string,changed_at:?string,reason:?string,capabilities:list<string>}>
     */
    public function groupStateFor(): array
    {
        $rows = TenantApplicationGroupState::query()->get()->keyBy('group_key');
        $catalog = ApplicationCatalog::all();
        $result = [];

        foreach ($this->groupKeys() as $group) {
            $row = $rows->get($group);
            $capabilities = array_keys(array_filter(
                $catalog,
                fn (array $application) => $application['group'] === $group,
            ));
            $manageable = count(array_filter(
                $capabilities,
                fn (string $key) => ApplicationCatalog::find($key)['maturity'] === ApplicationCatalog::MATURITY_BUILT,
            )) > 0;

            $result[$group] = [
                'key' => $group,
                'enabled' => $row?->requested_enabled ?? true,
                'manageable' => $manageable,
                'changed_by' => $row?->changed_by,
                'changed_at' => $row?->updated_at?->toIso8601String(),
                'reason' => $row?->reason,
                'capabilities' => $capabilities,
            ];
        }

        return $result;
    }

    /**
     * دمج الكتالوج الثابت مع حالة المستأجر الحالية.
     *
     * @return array<string, array<string, mixed>>
     */
    public function stateFor(): array
    {
        $rows = TenantApplicationState::query()->get()->keyBy('application_key');
        $groupRows = TenantApplicationGroupState::query()->get()->keyBy('group_key');
        $tenantId = app(TenantContext::class)->id();
        $commercial = $tenantId === null ? [] : $this->commercialStatus->forTenant(Tenant::findOrFail($tenantId));

        $result = [];
        foreach (ApplicationCatalog::all() as $key => $application) {
            $row = $rows->get($key);
            $groupRow = $groupRows->get($application['group']);

            $result[$key] = [
                ...$application,
                'enabled' => $this->isEnabled($key, $application, $rows),
                'group_enabled' => $groupRow?->requested_enabled ?? true,
                'status' => $row?->status ?? 'disabled',
                'changed_by' => $row?->changed_by,
                'changed_at' => $row?->updated_at?->toIso8601String(),
                'reason' => $row?->reason,
                ...($commercial[$key] ?? [
                    'commercial' => ['availability' => 'not_available', 'source_count' => 0],
                    'effective_access' => 'denied',
                    'dependency_status' => 'not_applicable',
                ]),
            ];
        }

        return $result;
    }

    /**
     * حالة قدرة واحدة لإنفاذ المسارات. بوابة التطبيق الرئيسي تسبق حالة الفرع،
     * كما أن تعطيل تطبيق تعتمد عليه قدرة في تطبيق آخر يحجب القدرة التابعة
     * تشغيلياً من دون تغيير حالتها المحفوظة.
     */
    public function statusFor(string $key): string
    {
        return $this->runtimeStatusFor($key, []);
    }

    /** @param array<string, true> $seen */
    private function runtimeStatusFor(string $key, array $seen): string
    {
        if (isset($seen[$key])) {
            return 'disabled';
        }

        $application = ApplicationCatalog::find($key);
        if ($application === null || ! $this->isGroupEnabled($application['group'])) {
            return 'disabled';
        }

        $seen[$key] = true;

        if ($application['mandatory'] || $application['maturity'] !== ApplicationCatalog::MATURITY_BUILT) {
            $status = 'enabled';
        } else {
            $status = TenantApplicationState::query()->where('application_key', $key)->value('status');
            if ($status === null) {
                $status = $this->isGrandfatheredTenant() ? 'enabled' : 'disabled';
            }
        }

        if ($status === 'disabled') {
            return 'disabled';
        }

        foreach (ApplicationCatalog::dependenciesFor($key) as $dependency) {
            if ($this->runtimeStatusFor($dependency, $seen) !== 'enabled') {
                return 'disabled';
            }
        }

        return $status;
    }

    /**
     * حالة الظهور للشريط الجانبي. القدرة الإلزامية لا تحتاج قيمة true في
     * الحالة العادية، لكننا نعيد false لها عندما يحجبها التطبيق الرئيسي أو
     * اعتماد تشغيلي حتى تختفي روابط التطبيق كاملة.
     *
     * @return array<string, bool>
     */
    public function navVisibility(): array
    {
        $result = [];

        foreach (ApplicationCatalog::all() as $key => $application) {
            if ($application['maturity'] !== ApplicationCatalog::MATURITY_BUILT) {
                continue;
            }

            $status = $this->statusFor($key);
            if ($status === 'disabled') {
                $result[$key] = false;
                continue;
            }

            if ($application['mandatory']) {
                continue;
            }

            $result[$key] = true;
        }

        return $result;
    }

    private function isGrandfatheredTenant(): bool
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            return true;
        }

        $tenant = Tenant::find($tenantId);

        return $tenant === null || $this->isLegacyTenant($tenant);
    }

    public function isLegacyTenant(Tenant $tenant): bool
    {
        return $tenant->created_at === null || $tenant->created_at->lt(self::ENFORCEMENT_CUTOVER_AT);
    }

    public function enableGroup(string $group, ?User $actor, ?string $reason = null): TenantApplicationGroupState
    {
        return $this->setGroupEnabled($group, true, $actor, $reason);
    }

    public function disableGroup(string $group, ?User $actor, ?string $reason = null): TenantApplicationGroupState
    {
        return $this->setGroupEnabled($group, false, $actor, $reason);
    }

    private function setGroupEnabled(string $group, bool $enabled, ?User $actor, ?string $reason): TenantApplicationGroupState
    {
        if (! $this->groupExists($group)) {
            throw new RuntimeException('مفتاح تطبيق رئيسي غير معروف.');
        }

        return DB::transaction(function () use ($group, $enabled, $actor, $reason) {
            $state = TenantApplicationGroupState::updateOrCreate(
                ['group_key' => $group],
                ['requested_enabled' => $enabled, 'changed_by' => $actor?->id, 'reason' => $reason],
            );

            TenantApplicationGroupEvent::create([
                'group_key' => $group,
                'action' => $enabled ? 'enabled' : 'disabled',
                'changed_by' => $actor?->id,
                'reason' => $reason,
            ]);

            return $state;
        });
    }

    /**
     * تفعيل/تعطيل كل التطبيقات الرئيسية المبنية فقط. لا يمس حالات الفروع،
     * ولذلك فإن إعادة التفعيل تستعيد التكوين الفرعي السابق بالكامل.
     *
     * @return array<string, array{enabled:bool}>
     */
    public function setAllGroups(bool $enabled, ?User $actor, ?string $reason = null): array
    {
        $groups = $this->groupStateFor();

        foreach ($groups as $group => $state) {
            if (! $state['manageable']) {
                continue;
            }

            $this->setGroupEnabled($group, $enabled, $actor, $reason);
        }

        return array_map(
            fn (array $state) => ['enabled' => $state['enabled']],
            $this->groupStateFor(),
        );
    }

    /**
     * تفعيل/تعطيل كل القدرات الفرعية القابلة للإدارة داخل تطبيق واحد. القدرات
     * غير المبنية والإلزامية لا تُغيّر، والقدرة غير المتاحة تجارياً لا تُمنح
     * عبر التفعيل الجماعي. أي قدرة يمنعها اعتماد تشغيلي تُعاد ضمن skipped.
     *
     * @return array{changed:list<string>,skipped:array<string,string>}
     */
    public function setGroupCapabilities(string $group, bool $enabled, ?User $actor, ?string $reason = null): array
    {
        if (! $this->groupExists($group)) {
            throw new RuntimeException('مفتاح تطبيق رئيسي غير معروف.');
        }

        $states = $this->stateFor();
        $keys = array_values(array_filter(
            array_keys($states),
            fn (string $key) => $states[$key]['group'] === $group
                && $states[$key]['maturity'] === ApplicationCatalog::MATURITY_BUILT
                && ! $states[$key]['mandatory'],
        ));

        usort($keys, function (string $left, string $right) use ($enabled): int {
            $leftDepth = $this->dependencyDepth($left);
            $rightDepth = $this->dependencyDepth($right);

            return $enabled ? $leftDepth <=> $rightDepth : $rightDepth <=> $leftDepth;
        });

        $changed = [];
        $skipped = [];
        foreach ($keys as $key) {
            if ($enabled && ($states[$key]['effective_access'] ?? 'denied') === 'denied') {
                $skipped[$key] = 'غير متاح ضمن الاستحقاق التجاري الحالي.';
                continue;
            }

            try {
                $enabled ? $this->enable($key, $actor, $reason) : $this->disable($key, $actor, $reason);
                $changed[] = $key;
            } catch (RuntimeException $exception) {
                $skipped[$key] = $exception->getMessage();
            }
        }

        return ['changed' => $changed, 'skipped' => $skipped];
    }

    private function dependencyDepth(string $key, array $seen = []): int
    {
        if (isset($seen[$key])) {
            return 0;
        }

        $seen[$key] = true;
        $dependencies = ApplicationCatalog::dependenciesFor($key);
        if ($dependencies === []) {
            return 0;
        }

        return 1 + max(array_map(
            fn (string $dependency) => $this->dependencyDepth($dependency, $seen),
            $dependencies,
        ));
    }

    public function enable(string $key, ?User $actor, ?string $reason = null): TenantApplicationState
    {
        if (! ApplicationCatalog::exists($key)) {
            throw new RuntimeException('مفتاح تطبيق غير معروف.');
        }

        if (! ApplicationCatalog::isActivatable($key)) {
            throw new RuntimeException('هذه القدرة غير مبنية بعد ولا يمكن تفعيلها.');
        }

        $rows = TenantApplicationState::query()->get()->keyBy('application_key');
        $missing = array_values(array_filter(
            ApplicationCatalog::dependenciesFor($key),
            fn (string $dependency) => ! $this->isEnabled($dependency, ApplicationCatalog::find($dependency), $rows),
        ));

        if ($missing !== []) {
            throw new RuntimeException('اعتماديات غير مفعّلة: ' . implode('، ', $missing));
        }

        return DB::transaction(function () use ($key, $actor, $reason) {
            $state = TenantApplicationState::updateOrCreate(
                ['application_key' => $key],
                ['requested_enabled' => true, 'status' => 'enabled', 'changed_by' => $actor?->id, 'reason' => $reason],
            );

            TenantApplicationEvent::create([
                'application_key' => $key,
                'action' => 'enabled',
                'changed_by' => $actor?->id,
                'reason' => $reason,
            ]);

            return $state;
        });
    }

    public function disable(string $key, ?User $actor, ?string $reason = null): TenantApplicationState
    {
        $application = ApplicationCatalog::find($key);
        if ($application === null) {
            throw new RuntimeException('مفتاح تطبيق غير معروف.');
        }

        if ($application['mandatory']) {
            throw new RuntimeException('هذه القدرة إلزامية ولا يمكن تعطيلها.');
        }

        $rows = TenantApplicationState::query()->get()->keyBy('application_key');
        $enabledKeys = array_keys(array_filter(
            ApplicationCatalog::all(),
            fn (array $app, string $appKey) => $this->isEnabled($appKey, $app, $rows),
            ARRAY_FILTER_USE_BOTH,
        ));

        $dependents = self::dependentsCurrentlyEnabled($key, ApplicationCatalog::all(), $enabledKeys);
        if ($dependents !== []) {
            throw new RuntimeException('توابع مفعّلة تعتمد على هذه القدرة: ' . implode('، ', $dependents));
        }

        $status = $this->hasOperationalData($key) ? 'suspended' : 'disabled';

        return DB::transaction(function () use ($key, $actor, $reason, $status) {
            $state = TenantApplicationState::updateOrCreate(
                ['application_key' => $key],
                ['requested_enabled' => false, 'status' => $status, 'changed_by' => $actor?->id, 'reason' => $reason],
            );

            TenantApplicationEvent::create([
                'application_key' => $key,
                'action' => $status,
                'changed_by' => $actor?->id,
                'reason' => $reason,
            ]);

            return $state;
        });
    }

    /**
     * @param  array<string, array{dependencies:list<string>}>  $catalog
     * @param  list<string>  $enabledKeys
     * @return list<string>
     */
    public static function dependentsCurrentlyEnabled(string $key, array $catalog, array $enabledKeys): array
    {
        $enabled = array_flip($enabledKeys);

        return array_values(array_filter(
            array_keys($catalog),
            fn (string $candidate) => $candidate !== $key
                && isset($enabled[$candidate])
                && in_array($key, $catalog[$candidate]['dependencies'], true),
        ));
    }

    /** @param array{mandatory:bool}|null $application */
    private function isEnabled(string $key, ?array $application, $rows): bool
    {
        if ($application === null) {
            return false;
        }

        if ($application['mandatory']) {
            return true;
        }

        $row = $rows->get($key);

        return $row !== null && $row->requested_enabled;
    }
}
