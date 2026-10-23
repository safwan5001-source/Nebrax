<?php

namespace Tests\Feature;

use App\Models\TenantApplicationState;
use App\Models\User;
use App\Services\AiActionPolicy;
use App\Services\AiActionRegistry;
use App\Support\AiActionException;
use App\Support\ApplicationCatalog;
use App\Support\Rbac;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Tests\TestCase;

/**
 * IMP-H1-S7 — بوابات نوع AI Action = بوابات واجهة المجال المباشرة.
 *
 * `EXPECTED` هو العقد: كل نوع مسجَّل يجب أن يظهر هنا بصلاحيات وقدرة واجهته المباشرة. تسجيل نوعٍ جديد في
 * `AiActionRegistry` دون سطرٍ هنا يُفشل الاختبار الأول؛ وسطرٌ هنا لا يطابق تعريف السجلّ يُفشل الثاني.
 * أنواع H3-S4/H4-S4/H5-S5/H7-S2/H7-S4 تضيف سطرها هنا في شرائحها (البوابات المتوقعة موثّقة في الأفق الرئيسي §H1-S7).
 */
class AiActionTypeGatesTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @var array<string, array{permissions: list<string>, application: ?string}> */
    private const EXPECTED = [
        AiActionRegistry::PRODUCT_IMPORT => ['permissions' => ['products.manage'], 'application' => null],
    ];

    private function registry(): AiActionRegistry
    {
        return app(AiActionRegistry::class);
    }

    /** @test */
    public function every_registered_type_declares_its_expected_gates(): void
    {
        $this->assertEqualsCanonicalizing(
            array_keys(self::EXPECTED),
            $this->registry()->types(),
            'نوع مسجَّل بلا بوابات متوقعة في هذا الاختبار (أو العكس).'
        );

        foreach (self::EXPECTED as $type => $gates) {
            $definition = $this->registry()->definition($type);
            $this->assertSame($gates['permissions'], $definition['domain_permissions'], $type);
            $this->assertSame($gates['application'], $definition['application_key'], $type);
        }
    }

    /** @test */
    public function declared_gates_are_real_permissions_and_real_catalog_keys(): void
    {
        $known = collect(Rbac::MATRIX)->flatten()->reject(fn ($p) => $p === '*')->unique()->all();

        foreach ($this->registry()->types() as $type) {
            $definition = $this->registry()->definition($type);
            $this->assertNotEmpty($definition['domain_permissions'], "{$type} بلا صلاحية مجال");
            foreach ($definition['domain_permissions'] as $permission) {
                $this->assertContains($permission, $known, "{$type}: صلاحية غير معروفة {$permission}");
            }
            if ($definition['application_key'] !== null) {
                $this->assertTrue(ApplicationCatalog::exists($definition['application_key']), "{$type}: مفتاح قدرة غير موجود");
            }
        }
    }

    /**
     * `AiActionPolicy` و`AiActionRegistry` فئتان `final` فلا يُستبدلان بمحاكاة؛ والنوع الحقيقي الوحيد بلا مفتاح قدرة،
     * فلا يكشف اختبار سلوكي عطباً في تمرير المفتاح. لذلك حارسٌ ساكن: كل استدعاء `authorize` في البوابة يمرّر
     * صلاحيات المجال والمفتاح من تعريف النوع، لا قيمة ثابتة ولا حذفاً (خطأ في موضع واحد من ستة يمرّ دون أن يلاحظه أحد).
     */
    /** @test */
    public function every_gateway_policy_call_forwards_the_definitions_permissions_and_application_key(): void
    {
        $source = (string) file_get_contents(base_path('app/Services/AiActionGateway.php'));

        $calls = preg_match_all('/->policy->authorize\(/', $source);
        $forwarding = preg_match_all('/->policy->authorize\([^;]*\$definition\[\'domain_permissions\'\], \$definition\[\'application_key\'\], \$definition\[\'type\'\]\)/', $source);

        $this->assertGreaterThanOrEqual(6, $calls);
        $this->assertSame($calls, $forwarding, 'استدعاء policy->authorize في AiActionGateway لا يمرّر domain_permissions وapplication_key وtype من التعريف (type لضوابط المشغّل، IMP-X-01b).');
        $this->assertStringNotContainsString("['domain_permission']", $source);
    }

    // ── سلوك السياسة (النوع الحقيقي الوحيد لا يحمل قدرة، فنختبر الآلية مباشرة) ─────────

    private function actor(string $role): User
    {
        config(['ai_actions.enabled' => true]);
        $auth = $this->registerTenant('gates-'.$role, $role.'@gates.test', autoEnableApplications: false);
        app(TenantContext::class)->set($auth['tenant_id']);
        Settings::put('ai_actions', ['enabled' => true]);

        $user = User::query()->where('email', $role.'@gates.test')->firstOrFail();
        // `registerTenant` ينشئ مالكاً دائماً؛ نعيّن الدور المطلوب للتحقق من الرفض بدور مقيَّد.
        $user->forceFill(['role' => $role])->save();

        return $user;
    }

    private function inventoryStatus(string $status): void
    {
        TenantApplicationState::updateOrCreate(
            ['application_key' => 'inventory.core'],
            ['requested_enabled' => $status === 'enabled', 'status' => $status],
        );
    }

    private function asRequest(string $method): void
    {
        $this->app->instance('request', Request::create('/api/ai-actions', $method));
    }

    /**
     * `$actionPermission` الافتراضي `products.view` لا `ai.actions.use`: أدوار owner/admin تحمل `*` فتمرّ أي صلاحية
     * مهما كان اسمها، فنختبر رفض الصلاحية بدور `accountant` المقيَّد، وسياسة الاستعمال نفسها محروسة في اختبارات AI Actions القائمة.
     */
    private function authorizeWith(User $actor, array $permissions, ?string $application, string $actionPermission = 'products.view'): User
    {
        return app(AiActionPolicy::class)->authorize((string) $actor->id, $actionPermission, $permissions, $application);
    }

    private function assertDeniedWith(string $reason, callable $fn): void
    {
        try {
            $fn();
        } catch (AiActionException $e) {
            $this->assertSame($reason, $e->reason);

            return;
        }
        $this->fail("توقّعنا رفضاً بالسبب {$reason}.");
    }

    /** @test */
    public function a_type_without_an_application_key_is_unchanged_by_the_application_state(): void
    {
        $owner = $this->actor('owner');
        $this->inventoryStatus('disabled');
        $this->asRequest('POST');

        $this->assertSame($owner->id, $this->authorizeWith($owner, ['products.manage'], null)->id);
    }

    /** @test */
    public function an_enabled_application_passes_and_a_disabled_one_is_refused_for_every_verb(): void
    {
        $owner = $this->actor('owner');

        $this->inventoryStatus('enabled');
        foreach (['GET', 'POST'] as $verb) {
            $this->asRequest($verb);
            $this->assertSame($owner->id, $this->authorizeWith($owner, ['products.manage'], 'inventory.core')->id);
        }

        $this->inventoryStatus('disabled');
        foreach (['GET', 'POST'] as $verb) {
            $this->asRequest($verb);
            $this->assertDeniedWith('application_inactive', fn () => $this->authorizeWith($owner, ['products.manage'], 'inventory.core'));
        }
    }

    /** @test */
    public function a_suspended_application_is_read_only(): void
    {
        $owner = $this->actor('owner');
        $this->inventoryStatus('suspended');

        $this->asRequest('GET');
        $this->assertSame($owner->id, $this->authorizeWith($owner, ['products.manage'], 'inventory.core')->id);

        $this->asRequest('POST');
        $this->assertDeniedWith('application_inactive', fn () => $this->authorizeWith($owner, ['products.manage'], 'inventory.core'));
    }

    /** @test */
    public function every_declared_domain_permission_is_required_not_just_the_first(): void
    {
        $accountant = $this->actor('accountant');
        $this->inventoryStatus('enabled');
        $this->asRequest('POST');

        // المحاسب يملك products.manage وhr.manage ولا يملك branches.manage.
        $this->assertSame($accountant->id, $this->authorizeWith($accountant, ['products.manage', 'hr.manage'], 'inventory.core')->id);
        $this->assertDeniedWith(
            'permission_denied',
            fn () => $this->authorizeWith($accountant, ['products.manage', 'branches.manage'], 'inventory.core')
        );
        $this->assertDeniedWith(
            'permission_denied',
            fn () => $this->authorizeWith($accountant, ['branches.manage', 'products.manage'], 'inventory.core')
        );
    }

    /** @test */
    public function a_missing_permission_is_refused_before_the_application_gate_is_consulted(): void
    {
        $accountant = $this->actor('accountant');
        $this->inventoryStatus('disabled');
        $this->asRequest('POST');

        $this->assertDeniedWith(
            'permission_denied',
            fn () => $this->authorizeWith($accountant, ['branches.manage'], 'inventory.core')
        );
        // وبصلاحية كاملة تظهر بوابة القدرة.
        $this->assertDeniedWith(
            'application_inactive',
            fn () => $this->authorizeWith($accountant, ['products.manage'], 'inventory.core')
        );
    }
}
