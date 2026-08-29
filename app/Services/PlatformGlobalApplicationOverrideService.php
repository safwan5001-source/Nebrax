<?php

namespace App\Services;

use App\Models\JournalEntry;
use App\Models\PlatformAdministrator;
use App\Models\PlatformAdministratorAction;
use App\Models\Tenant;
use App\Support\ApplicationCatalog;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * منسّق التحكم العام بالتطبيقات عبر جميع المستأجرين — يفوّض بالكامل
 * إلى PlatformApplicationOverrideService دون مصدر حقيقة موازٍ.
 */
class PlatformGlobalApplicationOverrideService
{
    public const CHUNK_SIZE = 50;

    public const GLOBAL_GRANT_ALL_TENANTS = 'grant_all_tenants';
    public const GLOBAL_REVERT_ALL_TENANTS = 'revert_all_tenants';
    public const GLOBAL_SHOW_ALL_TENANTS = 'show_all_tenants';
    public const GLOBAL_HIDE_ALL_TENANTS = 'hide_all_tenants';
    public const GLOBAL_GRANT_ALL_APPS_ALL_TENANTS = 'grant_all_apps_all_tenants';
    public const GLOBAL_REVERT_ALL_APPS_ALL_TENANTS = 'revert_all_apps_all_tenants';
    public const GLOBAL_SHOW_ALL_APPS_ALL_TENANTS = 'show_all_apps_all_tenants';
    public const GLOBAL_HIDE_ALL_APPS_ALL_TENANTS = 'hide_all_apps_all_tenants';

    public const SINGLE_APP_OPERATIONS = [
        self::GLOBAL_GRANT_ALL_TENANTS,
        self::GLOBAL_REVERT_ALL_TENANTS,
        self::GLOBAL_SHOW_ALL_TENANTS,
        self::GLOBAL_HIDE_ALL_TENANTS,
    ];

    public const ALL_APPS_OPERATIONS = [
        self::GLOBAL_GRANT_ALL_APPS_ALL_TENANTS,
        self::GLOBAL_REVERT_ALL_APPS_ALL_TENANTS,
        self::GLOBAL_SHOW_ALL_APPS_ALL_TENANTS,
        self::GLOBAL_HIDE_ALL_APPS_ALL_TENANTS,
    ];

    public function __construct(
        private PlatformApplicationOverrideService $overrides,
    ) {}

    /** @return list<string> */
    public static function operations(): array
    {
        return array_merge(self::SINGLE_APP_OPERATIONS, self::ALL_APPS_OPERATIONS);
    }

    public static function isSingleAppOperation(string $operation): bool
    {
        return in_array($operation, self::SINGLE_APP_OPERATIONS, true);
    }

    public static function isAllAppsOperation(string $operation): bool
    {
        return in_array($operation, self::ALL_APPS_OPERATIONS, true);
    }

    /** @return array{applications: list<array<string, mixed>>, tenant_count: int} */
    public function summary(?array $tenantIds = null): array
    {
        $tenants = $this->resolveTenants($tenantIds);
        $aggregates = [];

        foreach (ApplicationCatalog::all() as $key => $application) {
            $aggregates[$key] = [
                'key' => $key,
                'group' => $application['group'],
                'maturity' => $application['maturity'],
                'mandatory' => $application['mandatory'],
                'access' => $application['access'],
                'dependencies' => $application['dependencies'],
                'protected_status' => $this->protectedStatus($application),
                'global_commercial' => ['granted' => 0, 'inherit' => 0, 'denied' => 0],
                'global_operational' => ['enabled' => 0, 'disabled' => 0, 'suspended' => 0],
                'can_grant_all_tenants' => false,
                'can_revert_all_tenants' => false,
                'can_show_all_tenants' => false,
                'can_hide_all_tenants' => false,
            ];
        }

        foreach ($tenants as $tenant) {
            $summary = $this->overrides->summary($tenant);
            foreach ($summary['applications'] as $row) {
                $key = $row['key'];
                if (! isset($aggregates[$key])) {
                    continue;
                }

                $commercialMode = $row['commercial_mode'];
                if (isset($aggregates[$key]['global_commercial'][$commercialMode])) {
                    $aggregates[$key]['global_commercial'][$commercialMode]++;
                }

                $operationalStatus = $row['operational_status'];
                if (isset($aggregates[$key]['global_operational'][$operationalStatus])) {
                    $aggregates[$key]['global_operational'][$operationalStatus]++;
                }

                $aggregates[$key]['can_grant_all_tenants'] = $aggregates[$key]['can_grant_all_tenants'] || $row['can_grant'];
                $aggregates[$key]['can_revert_all_tenants'] = $aggregates[$key]['can_revert_all_tenants'] || $row['can_revert'];
                $aggregates[$key]['can_show_all_tenants'] = $aggregates[$key]['can_show_all_tenants'] || $row['can_show'];
                $aggregates[$key]['can_hide_all_tenants'] = $aggregates[$key]['can_hide_all_tenants'] || $row['can_hide'];
            }
        }

        return [
            'applications' => array_values($aggregates),
            'tenant_count' => $tenants->count(),
        ];
    }

    /**
     * @param  list<string>|null  $tenantIds
     * @return array<string, mixed>
     */
    public function preview(
        string $operation,
        ?string $applicationKey = null,
        ?array $tenantIds = null,
    ): array {
        $this->assertOperation($operation, $applicationKey);
        $requestId = (string) Str::uuid();
        $tenants = $this->resolveTenants($tenantIds);
        $tenantResults = $this->evaluateTenants($tenants, $operation, $applicationKey);

        return $this->buildResponse($requestId, $operation, $applicationKey, $tenantIds, $tenantResults, null);
    }

    /**
     * @param  list<string>|null  $tenantIds
     * @return array<string, mixed>
     */
    public function apply(
        PlatformAdministrator $administrator,
        string $operation,
        ?string $applicationKey = null,
        ?array $tenantIds = null,
        ?string $reason = null,
    ): array {
        $this->assertOperation($operation, $applicationKey);
        $requestId = (string) Str::uuid();
        $tenants = $this->resolveTenants($tenantIds);
        $journalEntriesBefore = JournalEntry::count();
        $tenantResults = [];

        foreach ($tenants->chunk(self::CHUNK_SIZE) as $chunk) {
            foreach ($chunk as $tenant) {
                $tenantResults[] = $this->applyForTenant(
                    $tenant,
                    $administrator,
                    $operation,
                    $applicationKey,
                    $reason,
                );
            }
        }

        $response = $this->buildResponse($requestId, $operation, $applicationKey, $tenantIds, $tenantResults, $reason);
        $this->logGlobalBulkAction($administrator, $response);

        if (JournalEntry::count() !== $journalEntriesBefore) {
            throw new RuntimeException('Global application override must not create journal entries.');
        }

        return $response;
    }

    /**
     * @param  list<string>|null  $tenantIds
     * @return Collection<int, Tenant>
     */
    private function resolveTenants(?array $tenantIds): Collection
    {
        $query = Tenant::query()->orderBy('account_number')->orderBy('id');

        if ($tenantIds !== null && $tenantIds !== []) {
            $query->whereIn('id', $tenantIds);
        }

        return $query->get();
    }

    private function assertOperation(string $operation, ?string $applicationKey): void
    {
        if (! in_array($operation, self::operations(), true)) {
            throw new RuntimeException('عملية عامة غير معروفة.');
        }

        if (self::isSingleAppOperation($operation)) {
            if ($applicationKey === null || ApplicationCatalog::find($applicationKey) === null) {
                throw new RuntimeException('مفتاح التطبيق مطلوب للعمليات الفردية.');
            }
        }
    }

    /**
     * @param  Collection<int, Tenant>  $tenants
     * @return list<array<string, mixed>>
     */
    private function evaluateTenants(Collection $tenants, string $operation, ?string $applicationKey): array
    {
        $results = [];

        foreach ($tenants->chunk(self::CHUNK_SIZE) as $chunk) {
            foreach ($chunk as $tenant) {
                $results[] = $this->previewForTenant($tenant, $operation, $applicationKey);
            }
        }

        return $results;
    }

    /** @return array<string, mixed> */
    private function previewForTenant(Tenant $tenant, string $operation, ?string $applicationKey): array
    {
        if (self::isSingleAppOperation($operation)) {
            $preview = $this->previewSingleApp($tenant, $operation, $applicationKey);
            $outcome = $preview['outcome'];

            return [
                'tenant_id' => $tenant->id,
                'tenant_name' => $tenant->name,
                'account_number' => $tenant->account_number,
                'outcome' => $outcome,
                'skip_reasons' => $preview['skip_reasons'] ?? [],
                'notes' => $preview['notes'] ?? [],
                'application_results' => [$preview],
            ];
        }

        $bulkAction = $this->bulkActionForOperation($operation);
        $bulkPreview = $this->overrides->previewBulk($tenant, $bulkAction, null);
        $appliedApps = array_values(array_filter(
            $bulkPreview['results'],
            fn (array $row): bool => $row['outcome'] === 'applied',
        ));
        $skipReasons = [];
        foreach ($bulkPreview['results'] as $row) {
            foreach ($row['skip_reasons'] ?? [] as $reason) {
                $skipReasons[] = $reason;
            }
        }

        return [
            'tenant_id' => $tenant->id,
            'tenant_name' => $tenant->name,
            'account_number' => $tenant->account_number,
            'outcome' => $appliedApps !== [] ? 'applied' : 'skipped',
            'skip_reasons' => array_values(array_unique($skipReasons)),
            'notes' => [],
            'application_results' => $bulkPreview['results'],
            'applied_application_count' => count($appliedApps),
        ];
    }

    /** @return array<string, mixed> */
    private function applyForTenant(
        Tenant $tenant,
        PlatformAdministrator $administrator,
        string $operation,
        ?string $applicationKey,
        ?string $reason,
    ): array {
        try {
            return DB::transaction(function () use ($tenant, $administrator, $operation, $applicationKey, $reason): array {
                $preview = $this->previewForTenant($tenant, $operation, $applicationKey);

                if ($preview['outcome'] !== 'applied') {
                    return $preview;
                }

                if (self::isSingleAppOperation($operation)) {
                    $result = $this->applySingleApp($tenant, $administrator, $operation, $applicationKey, $reason);
                    $preview['application_results'] = [$result];

                    return array_merge($preview, [
                        'outcome' => $result['outcome'],
                        'skip_reasons' => $result['skip_reasons'] ?? [],
                    ]);
                }

                $bulkAction = $this->bulkActionForOperation($operation);
                $bulkResult = $this->overrides->applyBulk(
                    $tenant,
                    $administrator,
                    $bulkAction,
                    null,
                    $reason,
                    recordPlatformAction: false,
                );
                $appliedApps = array_values(array_filter(
                    $bulkResult['results'],
                    fn (array $row): bool => $row['outcome'] === 'applied',
                ));

                return array_merge($preview, [
                    'outcome' => $appliedApps !== [] ? 'applied' : 'skipped',
                    'application_results' => $bulkResult['results'],
                    'applied_application_count' => count($appliedApps),
                ]);
            });
        } catch (\Throwable $exception) {
            return [
                'tenant_id' => $tenant->id,
                'tenant_name' => $tenant->name,
                'account_number' => $tenant->account_number,
                'outcome' => 'failed',
                'skip_reasons' => [],
                'notes' => [],
                'error' => $exception->getMessage(),
                'application_results' => [],
            ];
        }
    }

    /** @return array<string, mixed> */
    private function previewSingleApp(Tenant $tenant, string $operation, string $applicationKey): array
    {
        return match ($this->singleAppMethod($operation)) {
            'grant' => $this->overrides->previewGrant($tenant, $applicationKey),
            'revert' => $this->overrides->previewRevert($tenant, $applicationKey),
            'show' => $this->overrides->previewShow($tenant, $applicationKey),
            'hide' => $this->overrides->previewHide($tenant, $applicationKey),
            default => throw new RuntimeException('عملية فردية غير معروفة.'),
        };
    }

    /** @return array<string, mixed> */
    private function applySingleApp(
        Tenant $tenant,
        PlatformAdministrator $administrator,
        string $operation,
        string $applicationKey,
        ?string $reason,
    ): array {
        return match ($this->singleAppMethod($operation)) {
            'grant' => $this->overrides->grant($tenant, $administrator, $applicationKey, $reason, recordPlatformAction: false),
            'revert' => $this->overrides->revert($tenant, $administrator, $applicationKey, $reason, recordPlatformAction: false),
            'show' => $this->overrides->show($tenant, $administrator, $applicationKey, $reason, recordPlatformAction: false),
            'hide' => $this->overrides->hide($tenant, $administrator, $applicationKey, $reason, recordPlatformAction: false),
            default => throw new RuntimeException('عملية فردية غير معروفة.'),
        };
    }

    private function singleAppMethod(string $operation): string
    {
        return match ($operation) {
            self::GLOBAL_GRANT_ALL_TENANTS => 'grant',
            self::GLOBAL_REVERT_ALL_TENANTS => 'revert',
            self::GLOBAL_SHOW_ALL_TENANTS => 'show',
            self::GLOBAL_HIDE_ALL_TENANTS => 'hide',
            default => throw new RuntimeException('عملية فردية غير معروفة.'),
        };
    }

    private function bulkActionForOperation(string $operation): string
    {
        return match ($operation) {
            self::GLOBAL_GRANT_ALL_APPS_ALL_TENANTS => PlatformApplicationOverrideService::BULK_GRANT_ALL,
            self::GLOBAL_REVERT_ALL_APPS_ALL_TENANTS => PlatformApplicationOverrideService::BULK_REVERT_ALL,
            self::GLOBAL_SHOW_ALL_APPS_ALL_TENANTS => PlatformApplicationOverrideService::BULK_SHOW_ALL,
            self::GLOBAL_HIDE_ALL_APPS_ALL_TENANTS => PlatformApplicationOverrideService::BULK_HIDE_ALL,
            default => throw new RuntimeException('عملية جماعية غير معروفة.'),
        };
    }

    /**
     * @param  list<string>|null  $tenantIds
     * @param  list<array<string, mixed>>  $tenantResults
     * @return array<string, mixed>
     */
    private function buildResponse(
        string $requestId,
        string $operation,
        ?string $applicationKey,
        ?array $tenantIds,
        array $tenantResults,
        ?string $reason,
    ): array {
        $application = $applicationKey !== null ? ApplicationCatalog::find($applicationKey) : null;
        $willApply = array_values(array_filter($tenantResults, fn (array $row): bool => $row['outcome'] === 'applied'));
        $skipped = array_values(array_filter($tenantResults, fn (array $row): bool => $row['outcome'] === 'skipped'));
        $failed = array_values(array_filter($tenantResults, fn (array $row): bool => $row['outcome'] === 'failed'));
        $groupedSkipReasons = [];

        foreach ($tenantResults as $row) {
            foreach ($row['skip_reasons'] ?? [] as $skipReason) {
                $groupedSkipReasons[$skipReason] = ($groupedSkipReasons[$skipReason] ?? 0) + 1;
            }
        }

        arsort($groupedSkipReasons);

        $sampleTenants = array_slice(array_merge(
            array_map(fn (array $row): array => [
                'tenant_id' => $row['tenant_id'],
                'tenant_name' => $row['tenant_name'],
                'account_number' => $row['account_number'],
                'outcome' => $row['outcome'],
                'skip_reasons' => $row['skip_reasons'] ?? [],
            ], $willApply),
            array_map(fn (array $row): array => [
                'tenant_id' => $row['tenant_id'],
                'tenant_name' => $row['tenant_name'],
                'account_number' => $row['account_number'],
                'outcome' => $row['outcome'],
                'skip_reasons' => $row['skip_reasons'] ?? [],
            ], $skipped),
        ), 0, 10);

        return [
            'request_id' => $requestId,
            'operation' => $operation,
            'application_key' => $applicationKey,
            'application_name' => $applicationKey,
            'layer' => $this->layerForOperation($operation),
            'scope' => [
                'mode' => $tenantIds === null || $tenantIds === [] ? 'all' : 'filtered',
                'total_tenants' => count($tenantResults),
                'tenant_ids' => $tenantIds,
            ],
            'counts' => [
                'eligible_tenants' => count($willApply) + count($skipped),
                'will_apply' => count($willApply),
                'skipped' => count($skipped),
                'failed' => count($failed),
            ],
            'skip_reasons' => $groupedSkipReasons,
            'sample_tenants' => $sampleTenants,
            'protections' => [
                'mandatory' => $application['mandatory'] ?? null,
                'dependencies' => $application['dependencies'] ?? [],
                'maturity' => $application['maturity'] ?? null,
                'coming_soon_blocked' => ($application['maturity'] ?? null) !== ApplicationCatalog::MATURITY_BUILT,
                'retired_blocked' => ($application['maturity'] ?? null) === ApplicationCatalog::MATURITY_RETIRED,
            ],
            'reason' => $reason,
            'tenant_results' => $tenantResults,
        ];
    }

    private function layerForOperation(string $operation): string
    {
        return match ($operation) {
            self::GLOBAL_GRANT_ALL_TENANTS,
            self::GLOBAL_REVERT_ALL_TENANTS,
            self::GLOBAL_GRANT_ALL_APPS_ALL_TENANTS,
            self::GLOBAL_REVERT_ALL_APPS_ALL_TENANTS => 'commercial',
            default => 'operational',
        };
    }

    /** @param array{group:string,maturity:string,mandatory:bool,dependencies:list<string>,access:string} $application */
    private function protectedStatus(array $application): ?string
    {
        if ($application['maturity'] === ApplicationCatalog::MATURITY_RETIRED) {
            return 'retired';
        }

        if ($application['mandatory']) {
            return 'mandatory';
        }

        if ($application['maturity'] !== ApplicationCatalog::MATURITY_BUILT) {
            return 'coming_soon';
        }

        return null;
    }

    /** @param array<string, mixed> $response */
    private function logGlobalBulkAction(PlatformAdministrator $administrator, array $response): void
    {
        PlatformAdministratorAction::create([
            'platform_administrator_id' => $administrator->id,
            'tenant_id' => null,
            'action' => PlatformAdministratorAction::ACTION_APPLICATION_GLOBAL_BULK,
            'from_value' => $response['operation'] . ($response['application_key'] ? ':' . $response['application_key'] : ''),
            'to_value' => json_encode([
                'source' => 'platform_global_override',
                'request_id' => $response['request_id'],
                'application_key' => $response['application_key'],
                'scope' => $response['scope']['mode'],
                'applied' => $response['counts']['will_apply'],
                'skipped' => $response['counts']['skipped'],
                'failed' => $response['counts']['failed'],
                'skip_reasons' => $response['skip_reasons'],
            ], JSON_UNESCAPED_UNICODE),
        ]);
    }
}
