<?php

namespace App\Services;

use App\Models\PlatformAdministrator;
use App\Models\PlatformAdministratorAction;
use App\Models\Tenant;
use App\Models\TenantApplicationEntitlement;
use App\Models\TenantApplicationState;
use App\Support\ApplicationCatalog;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Support\TenantApplicationEntitlementDecision;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use RuntimeException;

/**
 * منسّق تجاوزات المنصة للتطبيقات — طبقة رقيقة فوق منح الاستحقاق التجاري
 * وحالة التطبيق التشغيلية، بلا مصدر حقيقة موازٍ.
 */
class PlatformApplicationOverrideService
{
    public const OVERRIDE_SOURCE_REFERENCE_TYPE = 'platform-application-override';

    public static function overrideSourceReferenceId(string $capabilityKey): string
    {
        $hash = hash('sha256', self::OVERRIDE_SOURCE_REFERENCE_TYPE . ':' . $capabilityKey);

        return sprintf(
            '%s-%s-%s-%s-%s',
            substr($hash, 0, 8),
            substr($hash, 8, 4),
            substr($hash, 12, 4),
            substr($hash, 16, 4),
            substr($hash, 20, 12),
        );
    }

    public const BULK_GRANT_ALL = 'grant_all';
    public const BULK_REVERT_ALL = 'revert_all';
    public const BULK_SHOW_ALL = 'show_all';
    public const BULK_HIDE_ALL = 'hide_all';

    public function __construct(
        private TenantApplicationService $applications,
        private EntitlementGrantService $grants,
        private TenantApplicationEntitlementResolver $entitlements,
        private ApplicationAccessDecision $accessDecision,
    ) {}

    /**
     * @return array{applications: list<array<string, mixed>>}
     */
    public function summary(Tenant $tenant): array
    {
        return $this->withTenantContext($tenant, function () use ($tenant): array {
            $at = CarbonImmutable::now('UTC');
            $overrideGrants = $this->activeOverrideGrants($tenant, $at);
            $states = TenantApplicationState::query()->get()->keyBy('application_key');

            $applications = [];
            foreach (ApplicationCatalog::all() as $key => $application) {
                $applications[] = $this->applicationRow(
                    $tenant,
                    $key,
                    $application,
                    $states->get($key),
                    $overrideGrants->get($key),
                    $at,
                );
            }

            return ['applications' => $applications];
        });
    }

    /** @return array<string, mixed> */
    public function previewGrant(Tenant $tenant, string $applicationKey): array
    {
        return $this->previewSingle($tenant, $applicationKey, 'grant');
    }

    /** @return array<string, mixed> */
    public function grant(
        Tenant $tenant,
        PlatformAdministrator $administrator,
        string $applicationKey,
        ?string $reason = null,
        bool $recordPlatformAction = true,
    ): array {
        $preview = $this->previewGrant($tenant, $applicationKey);
        if ($preview['outcome'] !== 'applied') {
            throw new RuntimeException($preview['skip_reasons'][0] ?? 'لا يمكن منح التجاوز التجاري.');
        }

        return $this->withTenantContext($tenant, function () use ($tenant, $administrator, $applicationKey, $reason, $recordPlatformAction): array {
            $grant = $this->grants->grant(
                $tenant,
                $applicationKey,
                EntitlementAccessMode::FULL,
                EntitlementSourceType::ADMINISTRATIVE_OVERRIDE,
                CarbonImmutable::now('UTC'),
                null,
                self::OVERRIDE_SOURCE_REFERENCE_TYPE,
                self::overrideSourceReferenceId($applicationKey),
                null,
                'platform_override',
                $reason,
                $administrator->id,
            );

            if ($recordPlatformAction && $grant->wasRecentlyCreated) {
                $this->logPlatformAction(
                    $administrator,
                    $tenant,
                    PlatformAdministratorAction::ACTION_APPLICATION_GRANTED,
                    null,
                    $applicationKey,
                );
            }

            return [
                'outcome' => 'applied',
                'application_key' => $applicationKey,
                'override_grant_id' => $grant->id,
                'commercial_mode' => 'granted',
                'idempotent' => ! $grant->wasRecentlyCreated,
            ];
        });
    }

    /** @return array<string, mixed> */
    public function previewRevert(Tenant $tenant, string $applicationKey): array
    {
        return $this->previewSingle($tenant, $applicationKey, 'revert');
    }

    /** @return array<string, mixed> */
    public function revert(
        Tenant $tenant,
        PlatformAdministrator $administrator,
        string $applicationKey,
        ?string $reason = null,
        bool $recordPlatformAction = true,
    ): array {
        $preview = $this->previewRevert($tenant, $applicationKey);
        if ($preview['outcome'] !== 'applied') {
            throw new RuntimeException($preview['skip_reasons'][0] ?? 'لا يمكن التراجع عن التجاوز التجاري.');
        }

        return $this->withTenantContext($tenant, function () use ($tenant, $administrator, $applicationKey, $recordPlatformAction): array {
            $revoked = $this->grants->revokeSource(
                $tenant,
                EntitlementSourceType::ADMINISTRATIVE_OVERRIDE,
                self::OVERRIDE_SOURCE_REFERENCE_TYPE,
                self::overrideSourceReferenceId($applicationKey),
                $administrator->id,
            );

            if ($recordPlatformAction && $revoked > 0) {
                $this->logPlatformAction(
                    $administrator,
                    $tenant,
                    PlatformAdministratorAction::ACTION_APPLICATION_REVERTED,
                    $applicationKey,
                    null,
                );
            }

            return [
                'outcome' => 'applied',
                'application_key' => $applicationKey,
                'revoked_count' => $revoked,
                'commercial_mode' => $this->commercialMode($tenant, $applicationKey, CarbonImmutable::now('UTC')),
            ];
        });
    }

    /** @return array<string, mixed> */
    public function previewShow(Tenant $tenant, string $applicationKey): array
    {
        return $this->previewSingle($tenant, $applicationKey, 'show');
    }

    /** @return array<string, mixed> */
    public function show(
        Tenant $tenant,
        PlatformAdministrator $administrator,
        string $applicationKey,
        ?string $reason = null,
        bool $recordPlatformAction = true,
    ): array {
        $preview = $this->previewShow($tenant, $applicationKey);
        if ($preview['outcome'] !== 'applied') {
            throw new RuntimeException($preview['skip_reasons'][0] ?? 'لا يمكن إظهار التطبيق.');
        }

        return $this->withTenantContext($tenant, function () use ($tenant, $administrator, $applicationKey, $reason, $recordPlatformAction): array {
            $state = $this->applications->enableForPlatform($applicationKey, $administrator, $reason);

            if ($recordPlatformAction) {
                $this->logPlatformAction(
                    $administrator,
                    $tenant,
                    PlatformAdministratorAction::ACTION_APPLICATION_SHOWN,
                    null,
                    $applicationKey,
                );
            }

            return [
                'outcome' => 'applied',
                'application_key' => $applicationKey,
                'operational_status' => $state->status,
            ];
        });
    }

    /** @return array<string, mixed> */
    public function previewHide(Tenant $tenant, string $applicationKey): array
    {
        return $this->previewSingle($tenant, $applicationKey, 'hide');
    }

    /** @return array<string, mixed> */
    public function hide(
        Tenant $tenant,
        PlatformAdministrator $administrator,
        string $applicationKey,
        ?string $reason = null,
        bool $recordPlatformAction = true,
    ): array {
        $preview = $this->previewHide($tenant, $applicationKey);
        if ($preview['outcome'] !== 'applied') {
            throw new RuntimeException($preview['skip_reasons'][0] ?? 'لا يمكن إخفاء التطبيق.');
        }

        return $this->withTenantContext($tenant, function () use ($tenant, $administrator, $applicationKey, $reason, $recordPlatformAction): array {
            $state = $this->applications->disableForPlatform($applicationKey, $administrator, $reason);

            if ($recordPlatformAction) {
                $this->logPlatformAction(
                    $administrator,
                    $tenant,
                    PlatformAdministratorAction::ACTION_APPLICATION_HIDDEN,
                    $applicationKey,
                    $state->status,
                );
            }

            return [
                'outcome' => 'applied',
                'application_key' => $applicationKey,
                'operational_status' => $state->status,
            ];
        });
    }

    /**
     * @param  list<string>|null  $keys
     * @return array{action: string, results: list<array<string, mixed>>}
     */
    public function previewBulk(Tenant $tenant, string $action, ?array $keys = null): array
    {
        return $this->withTenantContext($tenant, fn (): array => [
            'action' => $action,
            'results' => $this->evaluateBulk($tenant, $action, $keys),
        ]);
    }

    /**
     * @param  list<string>|null  $keys
     * @return array{action: string, results: list<array<string, mixed>>}
     */
    public function applyBulk(
        Tenant $tenant,
        PlatformAdministrator $administrator,
        string $action,
        ?array $keys = null,
        ?string $reason = null,
    ): array {
        return $this->withTenantContext($tenant, function () use ($tenant, $administrator, $action, $keys, $reason): array {
            $results = DB::transaction(function () use ($tenant, $administrator, $action, $keys, $reason): array {
                $evaluated = $this->evaluateBulk($tenant, $action, $keys);
                $applied = [];

                foreach ($evaluated as $row) {
                    if ($row['outcome'] !== 'applied') {
                        $applied[] = $row;
                        continue;
                    }

                    $key = $row['application_key'];
                    try {
                        $applied[] = match ($action) {
                            self::BULK_GRANT_ALL => $this->grant($tenant, $administrator, $key, $reason, recordPlatformAction: false),
                            self::BULK_REVERT_ALL => $this->revert($tenant, $administrator, $key, $reason, recordPlatformAction: false),
                            self::BULK_SHOW_ALL => $this->show($tenant, $administrator, $key, $reason, recordPlatformAction: false),
                            self::BULK_HIDE_ALL => $this->hide($tenant, $administrator, $key, $reason, recordPlatformAction: false),
                            default => throw new RuntimeException('إجراء مجمّع غير معروف.'),
                        };
                    } catch (RuntimeException|ValidationException $exception) {
                        $applied[] = [
                            'application_key' => $key,
                            'outcome' => 'skipped',
                            'skip_reasons' => [$this->bulkSkipMessage($exception)],
                        ];
                    }
                }

                return $applied;
            });

            $appliedCount = count(array_filter($results, fn (array $row): bool => $row['outcome'] === 'applied'));
            $this->logPlatformAction(
                $administrator,
                $tenant,
                PlatformAdministratorAction::ACTION_APPLICATION_BULK,
                $action,
                (string) $appliedCount,
            );

            return ['action' => $action, 'results' => $results];
        });
    }

    /**
     * @param  array{group:string,maturity:string,mandatory:bool,dependencies:list<string>,access:string}  $application
     * @return array<string, mixed>
     */
    private function applicationRow(
        Tenant $tenant,
        string $key,
        array $application,
        ?TenantApplicationState $state,
        ?TenantApplicationEntitlement $overrideGrant,
        CarbonImmutable $at,
    ): array {
        $operationalStatus = $this->applications->statusFor($key);
        $commercialMode = $this->commercialMode($tenant, $key, $at, $overrideGrant);
        $skipGrant = $this->skipReasonsFor($tenant, $key, $application, 'grant', $overrideGrant, $operationalStatus);
        $skipRevert = $this->skipReasonsFor($tenant, $key, $application, 'revert', $overrideGrant, $operationalStatus);
        $skipShow = $this->skipReasonsFor($tenant, $key, $application, 'show', $overrideGrant, $operationalStatus);
        $skipHide = $this->skipReasonsFor($tenant, $key, $application, 'hide', $overrideGrant, $operationalStatus);
        $effectiveAccess = $this->accessDecision->decide($tenant, $key, \App\Support\ApplicationOperationClass::READ, null, $at);

        return [
            'key' => $key,
            'group' => $application['group'],
            'maturity' => $application['maturity'],
            'mandatory' => $application['mandatory'],
            'dependencies' => $application['dependencies'],
            'access' => $application['access'],
            'commercial_mode' => $commercialMode,
            'override_grant_id' => $overrideGrant?->id,
            'operational_status' => $operationalStatus,
            'effective_access' => $effectiveAccess->level->value,
            'can_grant' => $skipGrant === [],
            'can_revert' => $skipRevert === [],
            'can_show' => $skipShow === [],
            'can_hide' => $skipHide === [],
            'skip_reasons' => [
                'grant' => $skipGrant,
                'revert' => $skipRevert,
                'show' => $skipShow,
                'hide' => $skipHide,
            ],
            'changed_at' => $state?->updated_at?->toIso8601String(),
            'reason' => $state?->reason,
        ];
    }

    /** @return array<string, mixed> */
    private function previewSingle(Tenant $tenant, string $applicationKey, string $operation): array
    {
        return $this->withTenantContext($tenant, function () use ($tenant, $applicationKey, $operation): array {
            $application = ApplicationCatalog::find($applicationKey);
            if ($application === null) {
                return [
                    'application_key' => $applicationKey,
                    'outcome' => 'skipped',
                    'skip_reasons' => ['مفتاح تطبيق غير معروف.'],
                ];
            }

            $at = CarbonImmutable::now('UTC');
            $overrideGrant = $this->activeOverrideGrants($tenant, $at)->get($applicationKey);
            $operationalStatus = $this->applications->statusFor($applicationKey);
            $skipReasons = $this->skipReasonsFor($tenant, $applicationKey, $application, $operation, $overrideGrant, $operationalStatus);

            if ($skipReasons !== []) {
                return [
                    'application_key' => $applicationKey,
                    'outcome' => 'skipped',
                    'skip_reasons' => $skipReasons,
                    'operational_status' => $operationalStatus,
                    'commercial_mode' => $this->commercialMode($tenant, $applicationKey, $at, $overrideGrant),
                ];
            }

            $result = [
                'application_key' => $applicationKey,
                'outcome' => 'applied',
                'skip_reasons' => [],
                'operational_status' => match ($operation) {
                    'show' => 'enabled',
                    'hide' => $this->applications->hasOperationalEvidence($applicationKey) ? 'suspended' : 'disabled',
                    default => $operationalStatus,
                },
                'commercial_mode' => match ($operation) {
                    'grant' => 'granted',
                    'revert' => $this->commercialMode($tenant, $applicationKey, $at, null),
                    default => $this->commercialMode($tenant, $applicationKey, $at, $overrideGrant),
                },
            ];

            if ($operation === 'hide' && $result['operational_status'] === 'suspended') {
                $result['notes'] = ['يوجد بيانات تشغيلية؛ سيُعلَّق التطبيق للقراءة فقط.'];
            }

            if ($operation === 'show' && ApplicationCatalog::isCommerciallyGated($applicationKey)) {
                $entitlement = $this->entitlements->resolve($tenant, $applicationKey, $at);
                if ($entitlement === TenantApplicationEntitlementDecision::DENIED) {
                    $result['notes'] = ['التطبيق سيظهر تشغيلياً لكن الوصول التجاري ما زال مرفوضاً.'];
                }
            }

            return $result;
        });
    }

    /**
     * @param  list<string>|null  $keys
     * @return list<array<string, mixed>>
     */
    private function evaluateBulk(Tenant $tenant, string $action, ?array $keys): array
    {
        $targetKeys = $keys ?? $this->defaultBulkKeys($action);
        $ordered = match ($action) {
            self::BULK_GRANT_ALL, self::BULK_SHOW_ALL => $this->orderKeysForEnable($targetKeys),
            self::BULK_REVERT_ALL, self::BULK_HIDE_ALL => $this->orderKeysForDisable($targetKeys),
            default => throw new RuntimeException('إجراء مجمّع غير معروف.'),
        };

        $operation = match ($action) {
            self::BULK_GRANT_ALL => 'grant',
            self::BULK_REVERT_ALL => 'revert',
            self::BULK_SHOW_ALL => 'show',
            self::BULK_HIDE_ALL => 'hide',
        };

        $results = [];
        foreach ($ordered as $key) {
            $results[] = $this->previewSingle($tenant, $key, $operation);
        }

        return $results;
    }

    /** @return list<string> */
    private function defaultBulkKeys(string $action): array
    {
        return array_keys(array_filter(
            ApplicationCatalog::all(),
            function (array $application, string $key) use ($action): bool {
                if ($application['mandatory']) {
                    return false;
                }

                return match ($action) {
                    self::BULK_GRANT_ALL, self::BULK_REVERT_ALL => ApplicationCatalog::isCommerciallyGated($key)
                        && $application['maturity'] === ApplicationCatalog::MATURITY_BUILT,
                    self::BULK_SHOW_ALL, self::BULK_HIDE_ALL => $application['maturity'] === ApplicationCatalog::MATURITY_BUILT,
                    default => false,
                };
            },
            ARRAY_FILTER_USE_BOTH,
        ));
    }

    /**
     * @param  list<string>  $keys
     * @return list<string>
     */
    private function orderKeysForEnable(array $keys): array
    {
        $catalog = ApplicationCatalog::all();
        $keySet = array_flip($keys);
        $ordered = [];
        $visiting = [];

        $visit = function (string $key) use (&$visit, &$ordered, &$visiting, $catalog, $keySet): void {
            if (! isset($keySet[$key]) || isset($visiting[$key])) {
                return;
            }

            $visiting[$key] = true;
            foreach ($catalog[$key]['dependencies'] ?? [] as $dependency) {
                $visit($dependency);
            }
            unset($visiting[$key]);
            $ordered[] = $key;
        };

        foreach ($keys as $key) {
            $visit($key);
        }

        return array_values(array_unique($ordered));
    }

    /**
     * @param  list<string>  $keys
     * @return list<string>
     */
    private function orderKeysForDisable(array $keys): array
    {
        return array_reverse($this->orderKeysForEnable($keys));
    }

    /**
     * @param  array{group:string,maturity:string,mandatory:bool,dependencies:list<string>,access:string}  $application
     * @return list<string>
     */
    private function skipReasonsFor(
        Tenant $tenant,
        string $key,
        array $application,
        string $operation,
        ?TenantApplicationEntitlement $overrideGrant,
        string $operationalStatus,
    ): array {
        $reasons = [];

        if ($application['maturity'] === ApplicationCatalog::MATURITY_RETIRED) {
            $reasons[] = 'القدرة متقاعدة.';
        }

        if (in_array($operation, ['grant', 'show'], true) && $application['maturity'] !== ApplicationCatalog::MATURITY_BUILT) {
            $reasons[] = 'القدرة غير مبنية بعد.';
        }

        if ($application['mandatory'] && in_array($operation, ['hide'], true)) {
            $reasons[] = 'القدرة إلزامية.';
        }

        if ($operation === 'grant') {
            if (! ApplicationCatalog::isCommerciallyGated($key)) {
                $reasons[] = 'ليست قدرةً محروسة تجارياً.';
            }
            if ($overrideGrant !== null) {
                $reasons[] = 'تجاوز إداري نشط بالفعل.';
            }
        }

        if ($operation === 'revert' && $overrideGrant === null) {
            $reasons[] = 'لا يوجد تجاوز إداري نشط.';
        }

        if ($operation === 'show') {
            if ($operationalStatus === 'enabled') {
                $reasons[] = 'التطبيق مفعّل تشغيلياً بالفعل.';
            }

            $missing = $this->applications->missingDependenciesForPlatformEnable($key);

            if ($missing !== []) {
                $reasons[] = 'اعتماديات غير مفعّلة: ' . implode('، ', $missing);
            }
        }

        if ($operation === 'hide') {
            if ($application['maturity'] !== ApplicationCatalog::MATURITY_BUILT) {
                $reasons[] = 'القدرة غير مبنية بعد.';
            }

            if ($operationalStatus === 'disabled') {
                $reasons[] = 'التطبيق معطّل تشغيلياً بالفعل.';
            }

            $dependents = $this->applications->dependentsBlockingPlatformDisable($key);
            if ($dependents !== []) {
                $reasons[] = 'توابع مفعّلة: ' . implode('، ', $dependents);
            }
        }

        return $reasons;
    }

    private function commercialMode(
        Tenant $tenant,
        string $key,
        CarbonImmutable $at,
        ?TenantApplicationEntitlement $overrideGrant = null,
    ): string {
        $overrideGrant ??= $this->activeOverrideGrants($tenant, $at)->get($key);
        if ($overrideGrant !== null) {
            return 'granted';
        }

        $decision = $this->entitlements->resolve($tenant, $key, $at);

        return $decision === TenantApplicationEntitlementDecision::DENIED ? 'denied' : 'inherit';
    }

  /** @return \Illuminate\Support\Collection<string, TenantApplicationEntitlement> */
    private function activeOverrideGrants(Tenant $tenant, CarbonImmutable $at): \Illuminate\Support\Collection
    {
        return TenantApplicationEntitlement::query()
            ->where('tenant_id', $tenant->id)
            ->where('source_type', EntitlementSourceType::ADMINISTRATIVE_OVERRIDE->value)
            ->where('source_reference_type', self::OVERRIDE_SOURCE_REFERENCE_TYPE)
            ->where('starts_at', '<=', $at)
            ->where(fn ($query) => $query->whereNull('ends_at')->orWhere('ends_at', '>', $at))
            ->where(fn ($query) => $query->whereNull('revoked_at')->orWhere('revoked_at', '>', $at))
            ->get()
            ->keyBy('capability_key');
    }

    private function logPlatformAction(
        PlatformAdministrator $administrator,
        Tenant $tenant,
        string $action,
        ?string $from,
        ?string $to,
    ): void {
        PlatformAdministratorAction::create([
            'platform_administrator_id' => $administrator->id,
            'tenant_id' => $tenant->id,
            'action' => $action,
            'from_value' => $from,
            'to_value' => $to,
        ]);
    }

    private function bulkSkipMessage(RuntimeException|ValidationException $exception): string
    {
        if ($exception instanceof ValidationException) {
            return collect($exception->errors())->flatten()->first() ?? $exception->getMessage();
        }

        return $exception->getMessage();
    }

    private function withTenantContext(Tenant $tenant, Closure $callback): mixed
    {
        $context = app(TenantContext::class);
        $previous = $context->id();
        $context->set($tenant->id);

        try {
            return $callback();
        } finally {
            if ($previous === null) {
                $context->forget();
            } else {
                $context->set($previous);
            }
        }
    }
}
