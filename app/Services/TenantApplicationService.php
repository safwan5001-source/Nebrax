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
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Models\TenantApplicationEvent;
use App\Models\TenantApplicationState;
use App\Models\User;
use App\Models\ZatcaCredential;
use App\Support\ApplicationCatalog;
use App\Support\TenantApplicationEntitlementDecision;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * قرار كل مستأجر بتفعيل/إيقاف قدرة من ApplicationCatalog، مع فحص الاعتماديات
 * والإلزامية وسجل تدقيق. الإنفاذ الفعلي على المسارات والشريط الجانبي يقرأ
 * `statusFor()`/`navVisibility()` وحدهما (`EnsureApplicationActive`).
 */
class TenantApplicationService
{
    public function __construct(
        private CommercialApplicationStatusService $commercialStatus,
        private TenantApplicationEntitlementResolver $entitlements,
    ) {}

    /**
     * لحظة تفعيل الإنفاذ الفعلي. لا صف حالة = "معطّلة" منطقياً في `stateFor()`
     * منذ P1 — لكن لا مستأجر لمس `/applications` صراحة قبل اليوم، فتطبيق هذا
     * الافتراض على الإنفاذ الفعلي (حجب المسار/إخفاء الشريط) يحجب استخداماً
     * حياً قائماً بلا إشعار. المستأجرون المسجَّلون قبل هذا التاريخ يُعامَلون
     * كمفعّلين فعلياً ما داموا لم يوقفوا القدرة صراحة (صفّ موجود يبقى الحقيقة
     * دوماً)؛ المستأجرون الجدد بعده يبدؤون بالافتراضي الحقيقي: معطّلة حتى
     * تُفعَّل صراحة. قرار مالك صريح — لا يغطّي `stateFor()`/لوحة `/applications`
     * عمداً: تبقى تعرض الحالة المخزَّنة الحرفية كما صُمِّمت واختُبرت في P1/P2.
     */
    private const ENFORCEMENT_CUTOVER_AT = '2026-08-21 00:00:00';


    /**
     * "هل توجد بيانات تشغيلية حقيقية؟" لكل قدرة قابلة للإيقاف — تحوّل الإيقاف
     * إلى `suspended` (قراءة فقط) بدل `disabled` الكاملة. القدرات الإلزامية
     * الثلاث لا تحتاج فحصاً (لا تُوقَف بتاتاً). فواتير ZATCA نفسها تظل ملك
     * `sales.invoicing` الإلزامية، لكن بيانات اعتماد CSID نموذج مستقل وحساس؛
     * وجودها يجعل إيقاف `compliance.zatca` تعليقاً للقراءة بدل إخفائها.
     * `company.branches`: الفرع الرئيسي يُزرع تلقائياً لكل مستأجر عند
     * التسجيل، فـ`Branch::exists()` الخام سيكون صحيحاً دوماً ويُبطل الفحص —
     * يُفحص وجود فرع غير رئيسي تحديداً.
     *
     * @return array<string, Closure(): bool>
     */
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
            // حتى قبل Cycle 1، إنشاء محطة قرار تشغيلي لا ينبغي أن يختفي معه
            // التاريخ عند إيقاف التطبيق؛ يصبح الوصول قراءة فقط مثل بقية المجالات.
            'fuel_stations.core' => fn () => FuelStation::query()->exists(),
            'compliance.zatca' => fn () => ZatcaCredential::query()->exists(),
        ];
    }

    private function hasOperationalData(string $key): bool
    {
        $check = $this->dataChecks()[$key] ?? null;

        return $check !== null && $check();
    }

    /**
     * دليل بيانات التشغيل الموثوق نفسه المستخدم عند تعليق التطبيق. المستدعي
     * يظل مسؤولاً عن اختيار TenantContext الصحيح قبل الاستعلام.
     */
    public function hasOperationalEvidence(string $key): bool
    {
        return $this->hasOperationalData($key);
    }

    /**
     * دمج الكتالوج الثابت مع حالة المستأجر الحالية.
     *
     * @return array<string, array{group:string,maturity:string,mandatory:bool,dependencies:list<string>,enabled:bool,status:string,changed_by:?string,changed_at:?string,reason:?string,commercial:array{availability:string,source_count:int},effective_access:string,dependency_status:string}>
     */
    public function stateFor(): array
    {
        $rows = TenantApplicationState::query()->get()->keyBy('application_key');
        $tenantId = app(TenantContext::class)->id();
        $commercial = $tenantId === null ? [] : $this->commercialStatus->forTenant(Tenant::findOrFail($tenantId));

        $result = [];
        foreach (ApplicationCatalog::all() as $key => $application) {
            $row = $rows->get($key);

            $result[$key] = [
                ...$application,
                'enabled' => $this->isEnabled($key, $application, $rows),
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
     * حالة قدرة واحدة — لإنفاذ `EnsureApplicationActive` على مساراتها، بمعزل عن
     * حساب `stateFor()` الكامل لكل الكتالوج. القدرات الإلزامية وغير المبنية
     * لا تُمرَّر هنا أصلاً (لا مسار مُنفَذ عليها)، فتُعامَل كمفعّلة دوماً لو
     * استُدعيت بالخطأ — لا حجب لقدرة لا يملك المستأجر خياراً بإيقافها.
     */
    public function statusFor(string $key): string
    {
        $application = ApplicationCatalog::find($key);

        // المفتاح غير المعروف ليس قدرةً إلزامية ولا غير مبنية؛ منحه وصولاً
        // فعّالاً يجعل أي خطأ إملائي في App Guard تجاوزاً صامتاً للإنفاذ.
        if ($application === null) {
            return 'disabled';
        }

        if ($application['mandatory'] || $application['maturity'] !== ApplicationCatalog::MATURITY_BUILT) {
            return 'enabled';
        }

        $status = TenantApplicationState::query()->where('application_key', $key)->value('status');
        if ($status !== null) {
            return $status;
        }

        return $this->isGrandfatheredTenant() ? 'enabled' : 'disabled';
    }

    /**
     * أي قدرات قابلة للإيقاف (غير إلزامية، مبنية) **مرئية** اليوم لهذا المستأجر —
     * تغذّي الشريط الجانبي وحده، لا صلاحيات ولا إنفاذ مسار.
     *
     * للقدرات المعلَنة `ACCESS_COMMERCIAL` يُقيَّم الاستحقاق التجاري أيضاً — مساراتها
     * تحرسها `EnsureCommercialApplicationAccess`، فبقاء الرابط بلا منحة كان يجعل
     * الواجهة أوسع من الخادم. القدرات التشغيلية تبقى على حالة التطبيق وحدها.
     *
     * @return array<string, bool>
     */
    public function navVisibility(): array
    {
        $rows = TenantApplicationState::query()->get()->keyBy('application_key');
        $grandfathered = $this->isGrandfatheredTenant();

        $navigable = array_filter(
            ApplicationCatalog::all(),
            fn (array $application) => ! $application['mandatory']
                && $application['maturity'] === ApplicationCatalog::MATURITY_BUILT,
        );

        $commercialKeys = array_keys(array_filter(
            $navigable,
            fn (array $application) => $application['access'] === ApplicationCatalog::ACCESS_COMMERCIAL,
        ));
        $entitlements = $this->entitlementsFor($commercialKeys);

        $result = [];
        foreach ($navigable as $key => $application) {
            $status = $rows->get($key)?->status ?? ($grandfathered ? 'enabled' : 'disabled');
            $enabled = $status !== 'disabled';

            $entitled = $application['access'] !== ApplicationCatalog::ACCESS_COMMERCIAL
                || ($entitlements[$key] ?? TenantApplicationEntitlementDecision::DENIED) !== TenantApplicationEntitlementDecision::DENIED;

            $result[$key] = $enabled && $entitled;
        }

        return $result;
    }

    /**
     * @param  list<string>  $keys
     * @return array<string, TenantApplicationEntitlementDecision>
     */
    private function entitlementsFor(array $keys): array
    {
        $tenantId = app(TenantContext::class)->id();
        if ($keys === [] || $tenantId === null) {
            return [];
        }

        $tenant = Tenant::find($tenantId);
        if ($tenant === null) {
            return [];
        }

        return $this->entitlements->resolveMany($tenant, $keys, CarbonImmutable::now('UTC'));
    }

    /**
     * سُجِّل المستأجر قبل لحظة تفعيل الإنفاذ الفعلي؟ راجع تعليق
     * `ENFORCEMENT_CUTOVER_AT` أعلاه — يحدّد افتراض القدرات التي لم يقرر
     * المستأجر بشأنها صراحة بعد (لا صفّ `TenantApplicationState`) في
     * `statusFor()`/`navVisibility()` فقط.
     */
    private function isGrandfatheredTenant(): bool
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            return true;
        }

        $tenant = Tenant::find($tenantId);

        return $tenant === null || $this->isLegacyTenant($tenant);
    }

    /** Uses the same cutover contract as legacy route reachability. */
    public function isLegacyTenant(Tenant $tenant): bool
    {
        return $tenant->created_at === null || $tenant->created_at->lt(self::ENFORCEMENT_CUTOVER_AT);
    }

    public function enableForPlatform(string $key, PlatformAdministrator $administrator, ?string $reason = null): TenantApplicationState
    {
        if (! ApplicationCatalog::exists($key)) {
            throw new RuntimeException('مفتاح تطبيق غير معروف.');
        }

        if (! ApplicationCatalog::isActivatable($key)) {
            throw new RuntimeException('هذه القدرة غير مبنية بعد ولا يمكن تفعيلها.');
        }

        $missing = $this->missingDependenciesForPlatformEnable($key);

        if ($missing !== []) {
            throw new RuntimeException('اعتماديات غير مفعّلة: ' . implode('، ', $missing));
        }

        return DB::transaction(function () use ($key, $administrator, $reason) {
            $state = TenantApplicationState::updateOrCreate(
                ['application_key' => $key],
                [
                    'requested_enabled' => true,
                    'status' => 'enabled',
                    'changed_by' => null,
                    'changed_by_platform_administrator_id' => $administrator->id,
                    'reason' => $reason,
                ],
            );

            TenantApplicationEvent::create([
                'application_key' => $key,
                'action' => 'enabled',
                'changed_by' => null,
                'changed_by_platform_administrator_id' => $administrator->id,
                'reason' => $reason,
            ]);

            return $state;
        });
    }

    public function disableForPlatform(string $key, PlatformAdministrator $administrator, ?string $reason = null): TenantApplicationState
    {
        $application = ApplicationCatalog::find($key);
        if ($application === null) {
            throw new RuntimeException('مفتاح تطبيق غير معروف.');
        }

        if ($application['mandatory']) {
            throw new RuntimeException('هذه القدرة إلزامية ولا يمكن إيقافها.');
        }

        $dependents = $this->dependentsBlockingPlatformDisable($key);
        if ($dependents !== []) {
            throw new RuntimeException('توابع مفعّلة تعتمد على هذه القدرة: ' . implode('، ', $dependents));
        }

        return DB::transaction(function () use ($key, $administrator, $reason) {
            $tenantId = app(TenantContext::class)->id();
            if ($tenantId !== null) {
                Tenant::whereKey($tenantId)->lockForUpdate()->firstOrFail();
            }

            $status = $this->hasOperationalData($key) ? 'suspended' : 'disabled';

            $state = TenantApplicationState::updateOrCreate(
                ['application_key' => $key],
                [
                    'requested_enabled' => false,
                    'status' => $status,
                    'changed_by' => null,
                    'changed_by_platform_administrator_id' => $administrator->id,
                    'reason' => $reason,
                ],
            );

            TenantApplicationEvent::create([
                'application_key' => $key,
                'action' => $status,
                'changed_by' => null,
                'changed_by_platform_administrator_id' => $administrator->id,
                'reason' => $reason,
            ]);

            return $state;
        });
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
            throw new RuntimeException('هذه القدرة إلزامية ولا يمكن إيقافها.');
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

        return DB::transaction(function () use ($key, $actor, $reason) {
            // القفل نفسه الذي يستخدمه حفظ بيانات اعتماد ZATCA: يمنع أن يرى
            // التعطيل عدم وجود بيانات، ثم تُنشأ البيانات بعده مباشرة خلف 403.
            $tenantId = app(TenantContext::class)->id();
            if ($tenantId !== null) {
                Tenant::whereKey($tenantId)->lockForUpdate()->firstOrFail();
            }

            // بيانات حقيقية موجودة → قراءة فقط بدل إيقاف كامل، فلا تُفقَد إمكانية
            // مراجعة السجل التاريخي. يُعاد الفحص داخل المعاملة وبعد القفل.
            $status = $this->hasOperationalData($key) ? 'suspended' : 'disabled';

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
     * منطق نقي معزول عن قاعدة البيانات وبيانات الكتالوج الحقيقية عمداً — يبقى
     * قابلاً للاختبار المباشر حتى لو لم يوجد اليوم مساران حقيقيان في الكتالوج
     * ينتجان مساراً إيجابياً هنا (كل اعتماديات القدرات غير الإلزامية اليوم
     * تنتهي عند قدرة إلزامية، فيُحجب الإيقاف بفحص `mandatory` أولاً).
     *
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

    /**
     * اعتماديات يجب أن تكون مفعّلة قبل إظهار/تفعيل قدرة من المنصة.
     * يحترم cohort ما قبل الإنفاذ: بلا صف حالة، يُعامَل الاعتماد كمُلبًى إذا
     * لم يكن `statusFor()` معطّلاً — يطابق نية الإنفاذ على المسارات.
     *
     * @return list<string>
     */
    public function missingDependenciesForPlatformEnable(string $key): array
    {
        $rows = TenantApplicationState::query()->get()->keyBy('application_key');

        return array_values(array_filter(
            ApplicationCatalog::dependenciesFor($key),
            fn (string $dependency) => ! $this->isDependencySatisfiedForPlatformEnable($dependency, $rows),
        ));
    }

    /**
     * توابع ما زالت تشغيلياً نشطة (غير معطّلة) وتمنع إخفاء هذه القدرة.
     *
     * @return list<string>
     */
    public function dependentsBlockingPlatformDisable(string $key): array
    {
        $rows = TenantApplicationState::query()->get()->keyBy('application_key');
        $blockingKeys = array_keys(array_filter(
            ApplicationCatalog::all(),
            fn (array $app, string $appKey) => $this->countsAsBlockingDependent($appKey, $app, $rows),
            ARRAY_FILTER_USE_BOTH,
        ));

        return self::dependentsCurrentlyEnabled($key, ApplicationCatalog::all(), $blockingKeys);
    }

    /** @param \Illuminate\Support\Collection<string, TenantApplicationState> $rows */
    private function isDependencySatisfiedForPlatformEnable(string $dependency, $rows): bool
    {
        $application = ApplicationCatalog::find($dependency);
        if ($application === null) {
            return false;
        }

        if ($this->isEnabled($dependency, $application, $rows)) {
            return true;
        }

        return $rows->get($dependency) === null
            && $this->isGrandfatheredTenant()
            && $this->statusFor($dependency) !== 'disabled';
    }

    /** @param \Illuminate\Support\Collection<string, TenantApplicationState> $rows */
    private function countsAsBlockingDependent(string $appKey, array $app, $rows): bool
    {
        if ($app['mandatory'] || $app['maturity'] !== ApplicationCatalog::MATURITY_BUILT) {
            return false;
        }

        return $this->statusFor($appKey) !== 'disabled';
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
