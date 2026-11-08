<?php

namespace Tests\Feature;

use App\Models\AccessChangeEvent;
use App\Models\Employee;
use App\Models\Tenant;
use App\Models\User;
use App\Support\StationPin;
use App\Support\StationSessionBoundary;
use App\Tenancy\HostnameTenantContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * STATION-PIN — دخول تطبيق المحطات برقم الموظف + PIN: التحقق، عزل المستأجر، الجلسة المقيَّدة (لا تفتح واجهات أَوْج الإدارية)،
 * التعيين/التصفير من المدير، الخروج/تبديل الموظف، تحديد المعدل بلا قفل حساب، وبقاء دخول البريد كما هو.
 */
class StationPinLoginTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use BuildsFuelStaffFixture;

    private const HOST = 'http://fuel-b3.awj.app/api/';

    private const PIN = '482915';

    /** @return array{user: User, employee: Employee, token: string} */
    private function makeStationWorker(string $name, ?string $pin = self::PIN, string $role = 'staff', ?array $stations = null, ?string $employeeNo = null): array
    {
        $made = $this->makeUser($name, $role, null, $stations);
        app(TenantContext::class)->set($this->tenantId);
        $employee = Employee::create([
            'employee_no' => $employeeNo ?? Employee::nextDocumentNumber('EMP'),
            'name' => $name, 'basic_salary' => 0, 'is_active' => true,
        ]);
        $made['user']->forceFill(['employee_id' => $employee->id])->save();
        if ($pin !== null) {
            $made['user']->forceFill(['station_pin_hash' => Hash::make($pin), 'station_pin_set_at' => now()])->save();
        }

        return ['user' => $made['user'], 'employee' => $employee, 'token' => $made['token']];
    }

    private function stationLogin(string $employeeNo, string $pin, string $host = self::HOST)
    {
        return $this->postJson($host . 'station/login', ['employee_no' => $employeeNo, 'pin' => $pin]);
    }

    private function noThrottle(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
    }

    // ───────────────────────── الدخول ─────────────────────────

    /** @test */
    public function an_employee_logs_in_with_employee_number_and_pin_and_gets_a_station_scoped_session(): void
    {
        $this->noThrottle();
        $this->buildFixture();
        $w = $this->makeStationWorker('seller1');

        $res = $this->stationLogin($w['employee']->employee_no, self::PIN)->assertOk()
            ->assertHeader('Cache-Control', 'no-store, private')
            ->assertJsonPath('user.id', $w['user']->id)
            ->assertJsonPath('user.station_session', true)
            ->assertJsonMissingPath('user.station_pin_hash');

        $row = \Laravel\Sanctum\PersonalAccessToken::findToken($res->json('token'));
        $this->assertNotNull($row);
        $this->assertSame([StationSessionBoundary::ABILITY], $row->abilities);
        $this->assertNotNull($row->expires_at);
        $this->assertTrue($row->expires_at->lessThanOrEqualTo(now()->addHours(12)->addMinute()));

        $this->withToken($res->json('token'))->getJson('/api/me')->assertOk()
            ->assertJsonPath('user.id', $w['user']->id)
            ->assertJsonPath('user.station_session', true);
    }

    /** @test */
    public function the_login_accepts_arabic_indic_digits_and_surrounding_spaces(): void
    {
        $this->noThrottle();
        $this->buildFixture();
        $w = $this->makeStationWorker('seller1', pin: '482915', employeeNo: '10042');

        $this->stationLogin(' ١٠٠٤٢ ', '٤٨٢ ٩١٥')->assertOk()->assertJsonPath('user.id', $w['user']->id);
    }

    /** @test */
    public function employee_number_matching_is_case_insensitive_only_when_unambiguous(): void
    {
        $this->noThrottle();
        $this->buildFixture();
        $w = $this->makeStationWorker('seller1', employeeNo: 'EMP-AB1');

        $this->stationLogin('emp-ab1', self::PIN)->assertOk()->assertJsonPath('user.id', $w['user']->id);

        // رقمان يختلفان بالحالة فقط ⇒ غامض ⇒ لا مطابقة غير الحسّاسة (التامة وحدها تنجح).
        $this->makeStationWorker('seller2', employeeNo: 'emp-ab1');
        $this->stationLogin('Emp-Ab1', self::PIN)->assertStatus(422);
        $this->stationLogin('EMP-AB1', self::PIN)->assertOk()->assertJsonPath('user.id', $w['user']->id);
    }

    /** @test */
    public function every_failure_returns_the_same_generic_response(): void
    {
        $this->noThrottle();
        $this->buildFixture();
        $ok = $this->makeStationWorker('seller1');
        $noPin = $this->makeStationWorker('seller2', pin: null);
        $inactiveUser = $this->makeStationWorker('seller3');
        $inactiveUser['user']->forceFill(['is_active' => false])->save();
        $inactiveEmp = $this->makeStationWorker('seller4');
        $inactiveEmp['employee']->forceFill(['is_active' => false])->save();

        $bodies = [];
        foreach ([
            [$ok['employee']->employee_no, '111111'],      // PIN خاطئ
            ['NOPE-999', self::PIN],                       // رقم مجهول
            [$noPin['employee']->employee_no, self::PIN],  // لا PIN مضبوط
            [$inactiveUser['employee']->employee_no, self::PIN],
            [$inactiveEmp['employee']->employee_no, self::PIN],
            [$ok['employee']->employee_no, '12345'],       // شكل خاطئ
            [$ok['employee']->employee_no, 'abcdef'],
        ] as [$no, $pin]) {
            $res = $this->stationLogin($no, $pin);
            $res->assertStatus(422)->assertJsonMissingPath('token')->assertJsonPath('reason', 'invalid_credentials');
            $bodies[] = $res->json('message');
        }
        $this->assertCount(1, array_unique($bodies), 'لا يتمايز الرد بين الأسباب');
    }

    /** @test */
    public function a_missing_or_invalid_payload_is_rejected_by_validation(): void
    {
        $this->noThrottle();
        $this->buildFixture();
        $this->postJson(self::HOST . 'station/login', [])->assertStatus(422)->assertJsonValidationErrors(['employee_no', 'pin']);
    }

    /** @test */
    public function the_tenant_comes_only_from_the_hostname_never_from_the_body(): void
    {
        $this->noThrottle();
        $this->buildFixture();
        $w = $this->makeStationWorker('seller1');

        // مضيف بلا مستأجر (نطاق مشترك) ⇒ لا بحث عابر للمستأجرين.
        $this->postJson('/api/station/login', ['employee_no' => $w['employee']->employee_no, 'pin' => self::PIN, 'tenant_id' => $this->tenantId])
            ->assertStatus(422)->assertJsonPath('reason', 'tenant_required')->assertJsonMissingPath('token');
        // مضيف مستأجر غير موجود ⇒ 404 مغلق.
        $this->stationLogin($w['employee']->employee_no, self::PIN, 'http://nobody.awj.app/api/')->assertNotFound();
    }

    /** @test */
    public function the_same_employee_number_in_two_tenants_never_crosses(): void
    {
        $this->noThrottle();
        $this->buildFixture();
        $a = $this->makeStationWorker('sellerA', pin: '482915', employeeNo: 'EMP-00001');

        $other = $this->registerTenant('other-co', 'owner@other-co.test');
        app(TenantContext::class)->set($other['tenant_id']);
        $empB = Employee::create(['employee_no' => 'EMP-00001', 'name' => 'B', 'basic_salary' => 0, 'is_active' => true]);
        $userB = User::create(['tenant_id' => $other['tenant_id'], 'employee_id' => $empB->id, 'name' => 'B', 'email' => 'b@other-co.test', 'password' => 'password123', 'role' => 'staff']);
        $userB->forceFill(['station_pin_hash' => Hash::make('739204')])->save();
        app(TenantContext::class)->forget();

        // رقم واحد في مستأجرين: كلٌّ يدخل على مضيفه وبـPIN مستأجره فقط.
        $this->stationLogin('EMP-00001', '482915', self::HOST)->assertOk()->assertJsonPath('user.id', $a['user']->id);
        $this->stationLogin('EMP-00001', '739204', self::HOST)->assertStatus(422);
        $this->stationLogin('EMP-00001', '739204', 'http://other-co.awj.app/api/')->assertOk()->assertJsonPath('user.id', $userB->id);
        $this->stationLogin('EMP-00001', '482915', 'http://other-co.awj.app/api/')->assertStatus(422);
    }

    /** @test */
    public function a_station_token_from_one_tenant_is_rejected_on_another_tenant_host(): void
    {
        $this->noThrottle();
        $this->buildFixture();
        $w = $this->makeStationWorker('seller1');
        $this->registerTenant('other-co', 'owner@other-co.test');
        $token = $this->stationLogin($w['employee']->employee_no, self::PIN)->json('token');
        app(TenantContext::class)->forget();

        $this->withToken($token)->getJson('http://other-co.awj.app/api/me')->assertForbidden();
    }

    /** @test */
    public function a_cancelled_subscription_blocks_station_login(): void
    {
        $this->noThrottle();
        $this->buildFixture();
        $w = $this->makeStationWorker('seller1');
        Tenant::whereKey($this->tenantId)->update(['is_active' => false]);

        $this->stationLogin($w['employee']->employee_no, self::PIN)->assertStatus(404)->assertJsonMissingPath('token'); // المضيف يفشل مغلقاً لمستأجر غير نشط
    }

    // ───────────────────────── الحدّ على واجهات أَوْج ─────────────────────────

    /** @test */
    public function the_station_session_is_blocked_from_every_non_station_erp_endpoint(): void
    {
        $this->noThrottle();
        $this->buildFixture();
        $w = $this->makeStationWorker('owner-like', role: 'admin'); // أعلى صلاحية: الحدّ ليس RBAC
        $token = $this->stationLogin($w['employee']->employee_no, self::PIN)->json('token');

        foreach ([
            ['GET', '/api/invoices'], ['GET', '/api/users'], ['GET', '/api/products'], ['GET', '/api/partners'], ['GET', '/api/accounts'],
            ['GET', '/api/roles'], ['GET', '/api/reports/trial-balance'], ['GET', '/api/subscription'], ['GET', '/api/notifications'],
            ['PUT', '/api/account/password'], ['PUT', '/api/account/email'], ['GET', '/api/account/export'],
            ['GET', '/api/fuel-stations/settings'], ['GET', '/api/fuel-stations/devices'], ['GET', '/api/fuel-stations/opening-balances'],
            ['GET', '/api/fuel-stations/dashboard'], ['GET', '/api/pos-shifts'], ['POST', '/api/pos-shifts'], // مسارات تسجّلها مزوّدات خدمة خارج routes/api.php
            ['POST', '/api/fuel-stations/staff/' . $w['user']->id . '/pin'], ['DELETE', '/api/fuel-stations/staff/' . $w['user']->id . '/pin'],
        ] as [$method, $uri]) {
            $this->withToken($token)->json($method, $uri)->assertForbidden();
        }
    }

    /** @test */
    public function inside_the_allowed_surface_rbac_and_station_scope_still_apply(): void
    {
        $this->noThrottle();
        $this->buildFixture();
        $s1 = $this->fx['s1'];
        $s3 = $this->fx['s3'];
        $seller = $this->makeStationWorker('seller1', role: 'fuel-b3-seller', stations: [$s1->id]);
        // دور بصلاحية قراءة المحطات فقط.
        \App\Models\Role::create(['tenant_id' => $this->tenantId, 'slug' => 'fuel-b3-seller', 'name' => 's', 'permissions' => ['fuel_stations.view'], 'is_system' => false]);
        $token = $this->stationLogin($seller['employee']->employee_no, self::PIN)->assertOk()->json('token');

        $ids = collect($this->withToken($token)->getJson('/api/fuel-stations/stations')->assertOk()->json('data'))->pluck('id')->all();
        $this->assertContains($s1->id, $ids);
        $this->assertNotContains($s3->id, $ids, 'محطة خارج النطاق لا تظهر');
        $this->withToken($token)->getJson('/api/fuel-stations/stations/' . $s3->id)->assertStatus(404);
        // RBAC: بلا صلاحية فتح وردية ⇒ 403 رغم أن المسار مسموح للجلسة.
        $this->withToken($token)->postJson('/api/fuel-stations/shifts/open', [])->assertForbidden();
    }

    /** @test */
    public function a_normal_email_session_keeps_full_access_and_is_not_marked_as_a_station_session(): void
    {
        $this->noThrottle();
        $this->buildFixture();

        $login = $this->postJson(self::HOST . 'login', ['email' => 'owner@fuel-b3.test', 'password' => 'password123'])->assertOk()
            ->assertJsonMissingPath('user.station_session');
        $row = \Laravel\Sanctum\PersonalAccessToken::findToken($login->json('token'));
        $this->assertSame(['*'], $row->abilities);

        $this->withToken($login->json('token'))->getJson('/api/me')->assertOk()->assertJsonMissingPath('user.station_session');
        $this->withToken($login->json('token'))->getJson('/api/users')->assertOk();
        $this->withToken($login->json('token'))->getJson('/api/fuel-stations/settings')->assertOk();
    }

    /** @test */
    public function any_other_restricted_user_token_is_rejected_everywhere(): void
    {
        $this->noThrottle();
        $this->buildFixture();
        $user = User::where('email', 'owner@fuel-b3.test')->firstOrFail();
        $odd = $user->createToken('odd', ['something-else'])->plainTextToken;

        $this->withToken($odd)->getJson('/api/me')->assertForbidden();
        $this->withToken($odd)->getJson('/api/fuel-stations/stations')->assertForbidden();
    }

    /** @test */
    public function every_user_facing_authenticated_route_goes_through_the_user_principal_gate(): void
    {
        // حارس معماري: أي مسار مصادَق عليه بـSanctum ولا يملك حارساً خاصاً بمبدأ آخر يجب أن يمر بـSetTenant
        // (حيث تُفرض جلسة المحطات)، وإلا فقد تمر جلسة PIN إلى مسار جديد. المبادئ الأخرى: منصة، عميل متجر، مفتاح API.
        $otherPrincipals = [
            \App\Http\Middleware\EnsurePlatformAdministrator::class,
        ];
        $unguarded = [];
        foreach (Route::getRoutes() as $route) {
            $mw = $route->gatherMiddleware();
            $flat = array_map(fn ($m) => is_string($m) ? $m : 'closure', $mw);
            if (! in_array('auth:sanctum', $flat, true)) {
                continue;
            }
            $hasUserGate = (bool) array_filter($flat, fn ($m) => str_starts_with($m, \App\Http\Middleware\SetTenant::class)
                || str_starts_with($m, \App\Http\Middleware\EnsureUserPrincipal::class));
            $hasOther = (bool) array_filter($flat, fn ($m) => $this->startsWithAny($m, $otherPrincipals)
                || str_contains($m, 'Customer') || str_contains($m, 'ApiClient') || str_contains($m, 'PublicApi') || str_contains($m, 'Preview') || str_contains($m, 'ability'));
            if (! $hasUserGate && ! $hasOther) {
                $unguarded[] = implode(',', $route->methods()) . ' ' . $route->uri();
            }
        }
        $this->assertSame([], $unguarded, 'مسارات تقبل توكن مستخدم بلا SetTenant: ' . implode(' | ', $unguarded));
    }

    /** @param list<string> $prefixes */
    private function startsWithAny(string $value, array $prefixes): bool
    {
        foreach ($prefixes as $prefix) {
            if (str_starts_with($value, $prefix)) {
                return true;
            }
        }

        return false;
    }

    /** @test */
    public function the_allowlist_is_least_privilege_reads_by_prefix_and_writes_by_explicit_method_and_route(): void
    {
        foreach (StationSessionBoundary::readPrefixes() as $prefix) {
            $this->assertStringStartsWith('fuel-stations/', $prefix);
        }
        $this->assertNotContains('fuel-stations/staff', StationSessionBoundary::readPrefixes());
        $this->assertTrue(StationSessionBoundary::routeAllowed('GET', 'api/me'));
        $this->assertTrue(StationSessionBoundary::routeAllowed('POST', 'api/logout'));
        $this->assertTrue(StationSessionBoundary::routeAllowed('GET', 'api/fuel-stations/shifts/{id}/collection'));
        $this->assertTrue(StationSessionBoundary::routeAllowed('HEAD', 'api/fuel-stations/stations'));
        $this->assertTrue(StationSessionBoundary::routeAllowed('POST', 'api/fuel-stations/shifts/{id}/close'));
        foreach ([
            ['GET', 'api/fuel-stations/staff'], ['GET', 'api/fuel-stations/staff/{id}'], ['GET', 'api/fuel-stations/staff/audit'],
            ['PUT', 'api/fuel-stations/staff/{id}'], ['POST', 'api/fuel-stations/staff/{id}/pin'], ['DELETE', 'api/fuel-stations/staff/{id}/pin'],
            ['GET', 'api/fuel-stations/settings'], ['PUT', 'api/fuel-stations/settings'], ['PUT', 'api/fuel-stations/stations/{id}/settings'],
            ['POST', 'api/fuel-stations/stations'], ['PUT', 'api/fuel-stations/stations/{id}'], ['DELETE', 'api/fuel-stations/stations/{id}'],
            ['POST', 'api/fuel-stations/pumps'], ['PUT', 'api/fuel-stations/nozzles/{id}'], ['DELETE', 'api/fuel-stations/tanks/{id}'], ['POST', 'api/fuel-stations/products'],
            ['POST', 'api/fuel-stations/prices'], ['POST', 'api/fuel-stations/sales'], ['POST', 'api/fuel-stations/sales/{id}/finalize'], ['POST', 'api/fuel-stations/sales/{id}/payments'],
            ['POST', 'api/fuel-stations/shifts/{id}/corrections'], ['POST', 'api/fuel-stations/opening-balances'], ['POST', 'api/fuel-stations/opening-balances/{id}/post'],
            ['GET', 'api/fuel-stations/stations-evil'], ['POST', 'api/fuel-stations/shifts/open/extra'], ['PATCH', 'api/fuel-stations/shifts/open'],
            ['GET', 'api/invoices'], ['GET', 'api/platform/tenants'],
        ] as [$method, $uri]) {
            $this->assertFalse(StationSessionBoundary::routeAllowed($method, $uri), "{$method} {$uri} must be denied for PIN sessions");
        }
    }

    /** @test */
    public function the_exact_set_of_fuel_mutations_reachable_by_a_pin_session_is_pinned(): void
    {
        // لقطة صريحة: أي مسار كتابة جديد في الوقود محجوب افتراضياً، ويظهر هنا فقط إن أُضيف عمداً إلى WRITE_RULES.
        $reachable = [];
        $denied = [];
        foreach (Route::getRoutes() as $route) {
            if (! str_starts_with($route->uri(), 'api/fuel-stations/')) {
                continue;
            }
            foreach (array_diff($route->methods(), ['GET', 'HEAD']) as $method) {
                $key = "{$method} " . substr($route->uri(), strlen('api/fuel-stations/'));
                StationSessionBoundary::routeAllowed($method, $route->uri()) ? $reachable[] = $key : $denied[] = $key;
            }
        }
        sort($reachable);
        $this->assertSame([
            'DELETE deliveries/{id}/attachments/{attachmentId}',
            'POST deliveries',
            'POST deliveries/{id}/approve',
            'POST deliveries/{id}/attachments',
            'POST deliveries/{id}/cost',
            'POST reading-requests/{id}/approve',
            'POST reading-requests/{id}/reject',
            'POST readings',
            'POST report-center/{key}/audit', // تدقيق الطباعة/PDF/المشاركة (يسجّل حدثاً فقط)
            'POST shifts/open',
            'POST shifts/{id}/approve',
            'POST shifts/{id}/cash-movements',
            'POST shifts/{id}/cash-variance/review',
            'POST shifts/{id}/close',
            'POST shifts/{id}/collection',
            'POST shifts/{id}/collection/review',
            'POST shifts/{id}/meter-readings',
            'POST shifts/{id}/staff',
            'POST shifts/{id}/tank-readings',
        ], $reachable);
        foreach (['PUT staff/{id}', 'POST staff/{id}/pin', 'DELETE staff/{id}/pin', 'POST stations', 'PUT stations/{id}', 'DELETE stations/{id}', 'PUT stations/{id}/settings',
            'POST pumps', 'POST nozzles', 'POST tanks', 'POST products', 'POST prices', 'POST sales', 'POST shifts/{id}/corrections'] as $mustBeDenied) {
            $this->assertContains($mustBeDenied, $denied);
        }
    }

    /** @return list<array{0: string, 1: string}> مسارات إدارية (طريقة، مسار حقيقي) يجب أن ترفضها جلسة PIN حتى لمالك/مدير */
    private function adminMutations(string $stationId, string $userId): array
    {
        $uuid = '00000000-0000-4000-8000-0000000000ff';

        return [
            ['PUT', "/api/fuel-stations/staff/{$userId}"], ['POST', "/api/fuel-stations/staff/{$userId}/pin"], ['DELETE', "/api/fuel-stations/staff/{$userId}/pin"],
            ['GET', '/api/fuel-stations/staff'], ['GET', '/api/fuel-stations/staff/templates'], ['GET', '/api/fuel-stations/staff/audit'],
            ['POST', '/api/fuel-stations/stations'], ['PUT', "/api/fuel-stations/stations/{$stationId}"], ['DELETE', "/api/fuel-stations/stations/{$stationId}"],
            ['PUT', "/api/fuel-stations/stations/{$stationId}/settings"], ['PUT', '/api/fuel-stations/settings'],
            ['POST', '/api/fuel-stations/pumps'], ['PUT', "/api/fuel-stations/pumps/{$uuid}"], ['DELETE', "/api/fuel-stations/pumps/{$uuid}"],
            ['POST', '/api/fuel-stations/nozzles'], ['PUT', "/api/fuel-stations/nozzles/{$uuid}"], ['POST', '/api/fuel-stations/tanks'], ['DELETE', "/api/fuel-stations/tanks/{$uuid}"],
            ['POST', '/api/fuel-stations/products'], ['PUT', "/api/fuel-stations/products/{$uuid}"],
            ['POST', '/api/fuel-stations/prices'], ['POST', '/api/fuel-stations/sales'], ['POST', "/api/fuel-stations/sales/{$uuid}/finalize"], ['POST', "/api/fuel-stations/sales/{$uuid}/payments"],
            ['POST', "/api/fuel-stations/shifts/{$uuid}/corrections"], ['POST', '/api/fuel-stations/opening-balances'], ['POST', "/api/fuel-stations/opening-balances/{$uuid}/post"],
        ];
    }

    private const BOUNDARY_MESSAGE = 'جلسة تطبيق المحطات لا تصل إلى هذا المسار.';

    /** @test */
    public function a_pin_session_of_an_owner_or_admin_still_cannot_reach_any_administrative_fuel_route_and_nothing_changes(): void
    {
        $this->noThrottle();
        $this->buildFixture();
        $station = $this->fx['s1'];
        $victim = $this->makeStationWorker('victim', pin: null);
        $before = [$station->fresh()->name, \App\Models\FuelStation::count(), \App\Models\AccessChangeEvent::count(), $victim['user']->fresh()->role];

        foreach (['owner', 'admin'] as $role) {
            $boss = $this->makeStationWorker("boss-{$role}", role: $role);
            $token = $this->stationLogin($boss['employee']->employee_no, self::PIN)->assertOk()->json('token');
            foreach ($this->adminMutations($station->id, $victim['user']->id) as [$method, $uri]) {
                $res = $this->withToken($token)->json($method, $uri, ['name' => 'HACKED', 'template' => 'seller']);
                $res->assertForbidden();
                $this->assertSame(self::BOUNDARY_MESSAGE, $res->json('message'), "{$role}: {$method} {$uri} must be stopped by the station boundary, not by RBAC");
            }
        }
        $this->assertSame($before, [$station->fresh()->name, \App\Models\FuelStation::count(), \App\Models\AccessChangeEvent::count(), $victim['user']->fresh()->role]);
        $this->assertNull($victim['user']->fresh()->station_pin_hash);
    }

    /** @test */
    public function the_same_administrative_routes_still_work_for_a_normal_erp_session(): void
    {
        $this->noThrottle();
        $this->buildFixture();
        $station = $this->fx['s1'];
        $victim = $this->makeStationWorker('victim', pin: null);

        foreach ($this->adminMutations($station->id, $victim['user']->id) as [$method, $uri]) {
            $res = $this->withToken($this->fx['owner'])->json($method, $uri, []);
            $this->assertNotSame(self::BOUNDARY_MESSAGE, $res->json('message'), "ERP session must never hit the station boundary: {$method} {$uri}");
        }
        // نتائج حقيقية على عيّنة: تعيين PIN وتعديل المحطة وقراءة الموظفين بجلسة البريد.
        $this->withToken($this->fx['owner'])->postJson($this->pinUrl($victim['user']->id))->assertOk();
        $this->withToken($this->fx['owner'])->getJson('/api/fuel-stations/staff')->assertOk();
        $this->withToken($this->fx['owner'])->getJson('/api/fuel-stations/settings')->assertOk();
        $this->withToken($this->fx['owner'])->putJson("/api/fuel-stations/staff/{$victim['user']->id}", ['template' => 'seller', 'station_ids' => [$station->id]])->assertOk();
    }

    /** @test */
    public function every_allowed_pin_write_reaches_rbac_for_a_user_without_the_permission_and_legitimate_operations_work(): void
    {
        $this->noThrottle();
        $this->buildFixture();
        $uuid = '00000000-0000-4000-8000-0000000000ff';
        // موظف بلا أي صلاحية وقود: كل كتابة مسموحة بالحدّ تصل إلى RBAC (رسالة مختلفة عن رسالة الحدّ) لا إلى الحدّ.
        $none = $this->makeStationWorker('plain', role: 'staff');
        $token = $this->stationLogin($none['employee']->employee_no, self::PIN)->assertOk()->json('token');
        foreach ([
            ['POST', '/api/fuel-stations/shifts/open'], ['POST', "/api/fuel-stations/shifts/{$uuid}/meter-readings"], ['POST', "/api/fuel-stations/shifts/{$uuid}/close"],
            ['POST', "/api/fuel-stations/shifts/{$uuid}/approve"], ['POST', '/api/fuel-stations/readings'], ['POST', '/api/fuel-stations/deliveries'],
            ['POST', "/api/fuel-stations/reading-requests/{$uuid}/approve"],
        ] as [$method, $uri]) {
            $res = $this->withToken($token)->json($method, $uri, []);
            $res->assertForbidden();
            $this->assertNotSame(self::BOUNDARY_MESSAGE, $res->json('message'), "{$method} {$uri} is a legitimate station operation");
        }

        // مشرف/بائع فعلي: يفتح ورديته عبر جلسة PIN (العملية المشروعة تنجح).
        $seller = $this->makeStationWorker('seller9', role: 'fuel-b3-seller9', stations: [$this->fx['s1']->id]);
        \App\Models\Role::create(['tenant_id' => $this->tenantId, 'slug' => 'fuel-b3-seller9', 'name' => 's', 'permissions' => ['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.open', 'fuel.shift.cash_count'], 'is_system' => false]);
        $sellerToken = $this->stationLogin($seller['employee']->employee_no, self::PIN)->assertOk()->json('token');
        $res = $this->withToken($sellerToken)->postJson('/api/fuel-stations/shifts/open', [
            'fuel_station_id' => $this->fx['s1']->id, 'opening_cash_minor' => 0, 'idempotency_key' => 'pin-open-1',
        ]);
        $this->assertNotSame(self::BOUNDARY_MESSAGE, $res->json('message'));
        $this->assertContains($res->status(), [200, 201, 422], 'reached the controller (domain validation is acceptable): ' . $res->getContent());
        $this->withToken($sellerToken)->getJson('/api/fuel-stations/stations')->assertOk();
    }

    // ───────────────────────── الخروج والتبديل وحياة الجلسة ─────────────────────────

    /** @test */
    public function logout_revokes_the_session_and_switching_employee_signs_in_a_different_user(): void
    {
        $this->noThrottle();
        $this->buildFixture();
        $a = $this->makeStationWorker('sellerA', pin: '482915');
        $b = $this->makeStationWorker('sellerB', pin: '739204');

        $tokenA = $this->stationLogin($a['employee']->employee_no, '482915')->json('token');
        $this->withToken($tokenA)->postJson('/api/logout')->assertOk();
        $this->assertSame(0, $a['user']->tokens()->where('name', StationSessionBoundary::TOKEN_NAME)->count());
        $this->app['auth']->forgetGuards();
        $this->withToken($tokenA)->getJson('/api/me')->assertUnauthorized();

        $tokenB = $this->stationLogin($b['employee']->employee_no, '739204')->json('token');
        $this->withToken($tokenB)->getJson('/api/me')->assertOk()->assertJsonPath('user.id', $b['user']->id);
        $this->assertSame(0, $a['user']->tokens()->where('name', StationSessionBoundary::TOKEN_NAME)->count(), 'جلسة الأول لا تعود');
    }

    /** @test */
    public function deactivating_the_employee_or_user_kills_an_open_station_session_immediately(): void
    {
        $this->noThrottle();
        $this->buildFixture();
        $a = $this->makeStationWorker('sellerA');
        $b = $this->makeStationWorker('sellerB');
        $ta = $this->stationLogin($a['employee']->employee_no, self::PIN)->json('token');
        $tb = $this->stationLogin($b['employee']->employee_no, self::PIN)->json('token');
        $this->withToken($ta)->getJson('/api/me')->assertOk();
        $this->withToken($tb)->getJson('/api/me')->assertOk();

        $a['employee']->forceFill(['is_active' => false])->save();
        $b['user']->forceFill(['is_active' => false])->save();

        $this->withToken($ta)->getJson('/api/me')->assertForbidden();
        $this->withToken($tb)->getJson('/api/me')->assertForbidden();
    }

    // ───────────────────────── تحديد المعدل بلا قفل حساب ─────────────────────────

    private function loginFrom(string $ip, string $employeeNo, string $pin)
    {
        return $this->withServerVariables(['REMOTE_ADDR' => $ip])->postJson(self::HOST . 'station/login', ['employee_no' => $employeeNo, 'pin' => $pin]);
    }

    /** @test */
    public function failures_are_limited_per_employee_and_address_without_locking_anyone_and_without_disrupting_other_devices(): void
    {
        $this->buildFixture();
        $w = $this->makeStationWorker('sellerA');
        $other = $this->makeStationWorker('sellerB');

        for ($i = 0; $i < 5; $i++) {
            $this->loginFrom('10.0.0.1', $w['employee']->employee_no, '111111')->assertStatus(422);
        }
        // السادسة من العنوان المخمِّن نفسه ⇒ 429 + Retry-After — حتى لو كان الرمز صحيحاً (لا يُستدل على صحته من الحجب).
        $this->loginFrom('10.0.0.1', $w['employee']->employee_no, '111111')->assertStatus(429)->assertHeader('Retry-After')->assertJsonPath('reason', 'too_many_attempts');
        $this->loginFrom('10.0.0.1', $w['employee']->employee_no, self::PIN)->assertStatus(429);

        // لا تعطيل للموظف: جهازه/عنوانه الآخر يدخل بالرمز الصحيح، وموظف آخر من العنوان نفسه لا يتأثر.
        $this->loginFrom('10.0.0.2', $w['employee']->employee_no, self::PIN)->assertOk();
        $this->loginFrom('10.0.0.1', $other['employee']->employee_no, self::PIN)->assertOk();

        // لا قفل: بعد انقضاء النافذة يدخل العنوان نفسه، ولا حالة مخزّنة على المستخدم.
        $this->travel(301)->seconds();
        $this->loginFrom('10.0.0.1', $w['employee']->employee_no, self::PIN)->assertOk();
        $fresh = $w['user']->fresh();
        $this->assertTrue($fresh->is_active);
        $this->assertSame([], array_values(array_intersect(['locked_at', 'failed_attempts', 'lockout_until'], array_keys($fresh->getAttributes()))), 'لا أعمدة قفل أو عدّاد فشل');
    }

    /** @test */
    public function a_successful_sign_in_resets_that_addresss_failure_count(): void
    {
        $this->buildFixture();
        $w = $this->makeStationWorker('sellerA');

        for ($i = 0; $i < 4; $i++) {
            $this->loginFrom('10.0.0.1', $w['employee']->employee_no, '111111')->assertStatus(422);
        }
        $this->loginFrom('10.0.0.1', $w['employee']->employee_no, self::PIN)->assertOk();
        for ($i = 0; $i < 4; $i++) {
            $this->loginFrom('10.0.0.1', $w['employee']->employee_no, '111111')->assertStatus(422); // ما زال تحت الحدّ
        }
    }

    /** @test */
    public function distributed_guessing_hits_a_per_employee_ceiling_that_expires_by_itself(): void
    {
        $this->buildFixture();
        $w = $this->makeStationWorker('sellerA');

        for ($i = 1; $i <= 25; $i++) {
            $this->loginFrom("10.9.0.{$i}", $w['employee']->employee_no, '111111')->assertStatus(422);
        }
        // عنوان جديد كلياً ⇒ محجوب بالسقف العالمي (حماية من الهجوم الموزَّع) حتى بالرمز الصحيح.
        $this->loginFrom('10.8.0.1', $w['employee']->employee_no, self::PIN)->assertStatus(429);
        $this->travel(3601)->seconds();
        $this->loginFrom('10.8.0.1', $w['employee']->employee_no, self::PIN)->assertOk();
    }

    /** @test */
    public function an_unknown_employee_number_is_limited_like_a_known_one(): void
    {
        $this->buildFixture();

        for ($i = 0; $i < 5; $i++) {
            $this->loginFrom('10.0.0.1', 'GHOST-1', self::PIN)->assertStatus(422);
        }
        $this->loginFrom('10.0.0.1', 'GHOST-1', self::PIN)->assertStatus(429);
    }

    /** @test */
    public function a_single_address_flooding_with_many_employee_numbers_is_cut_off(): void
    {
        $this->buildFixture();

        for ($i = 0; $i < 30; $i++) {
            $this->loginFrom('10.0.0.7', "NOPE-{$i}", self::PIN)->assertStatus(422);
        }
        $this->loginFrom('10.0.0.7', 'NOPE-31', self::PIN)->assertStatus(429);
        $this->loginFrom('10.0.0.8', 'NOPE-1', self::PIN)->assertStatus(422); // عنوان آخر لا يتأثر
    }

    // ───────────────────────── التعيين والتصفير من المدير ─────────────────────────

    private function pinUrl(string $userId): string
    {
        return '/api/fuel-stations/staff/' . $userId . '/pin';
    }

    /** @test */
    public function a_manager_can_generate_a_pin_once_and_the_worker_can_then_log_in(): void
    {
        $this->noThrottle();
        $this->buildFixture();
        $w = $this->makeStationWorker('sellerA', pin: null);

        $res = $this->withToken($this->fx['owner'])->postJson($this->pinUrl($w['user']->id), ['reason' => 'تسليم جهاز'])->assertOk()
            ->assertHeader('Cache-Control', 'no-store, private')
            ->assertJsonPath('data.station_pin.has_pin', true)
            ->assertJsonPath('data.user.employee_no', $w['employee']->employee_no);
        $pin = $res->json('data.generated_pin');
        $this->assertMatchesRegularExpression('/\A[0-9]{6}\z/', $pin);
        $this->assertFalse(StationPin::isWeak($pin));

        // التخزين تجزئة لا نص، ولا تظهر في أي قراءة لاحقة.
        $hash = $w['user']->fresh()->station_pin_hash;
        $this->assertNotSame($pin, $hash);
        $this->assertTrue(Hash::check($pin, $hash));
        $show = $this->withToken($this->fx['owner'])->getJson('/api/fuel-stations/staff/' . $w['user']->id)->assertOk();
        $this->assertStringNotContainsString($pin, $show->getContent());
        $this->assertStringNotContainsString($hash, $show->getContent());
        $this->assertStringNotContainsString('generated_pin', $show->getContent());

        $this->stationLogin($w['employee']->employee_no, $pin)->assertOk();
    }

    /** @test */
    public function a_manager_can_set_a_chosen_pin_and_weak_or_malformed_pins_are_refused(): void
    {
        $this->noThrottle();
        $this->buildFixture();
        $w = $this->makeStationWorker('sellerA', pin: null);
        $owner = $this->fx['owner'];

        foreach (['000000', '123456', '654321', '777777', '12345', '1234567', 'abcdef', '12 34'] as $bad) {
            $this->withToken($owner)->postJson($this->pinUrl($w['user']->id), ['pin' => $bad])->assertStatus(422);
        }
        $this->assertNull($w['user']->fresh()->station_pin_hash);

        $this->withToken($owner)->postJson($this->pinUrl($w['user']->id), ['pin' => '٤٨٢٩١٥'])->assertOk()
            ->assertJsonMissingPath('data.generated_pin');
        $this->stationLogin($w['employee']->employee_no, '482915')->assertOk();
    }

    /** @test */
    public function resetting_the_pin_revokes_station_sessions_but_not_email_sessions_and_old_pin_stops_working(): void
    {
        $this->noThrottle();
        $this->buildFixture();
        $w = $this->makeStationWorker('sellerA', pin: '482915');
        $station = $this->stationLogin($w['employee']->employee_no, '482915')->json('token');
        $erpToken = $w['token']; // توكن دخول عادي (*)

        $this->withToken($this->fx['owner'])->postJson($this->pinUrl($w['user']->id), ['pin' => '739204'])->assertOk();

        $this->app['auth']->forgetGuards();
        $this->withToken($station)->getJson('/api/me')->assertUnauthorized();
        $this->app['auth']->forgetGuards();
        $this->withToken($erpToken)->getJson('/api/me')->assertOk();
        $this->stationLogin($w['employee']->employee_no, '482915')->assertStatus(422);
        $this->stationLogin($w['employee']->employee_no, '739204')->assertOk();
    }

    /** @test */
    public function clearing_the_pin_disables_station_login_and_revokes_sessions(): void
    {
        $this->noThrottle();
        $this->buildFixture();
        $w = $this->makeStationWorker('sellerA');
        $token = $this->stationLogin($w['employee']->employee_no, self::PIN)->json('token');

        $this->withToken($this->fx['owner'])->deleteJson($this->pinUrl($w['user']->id))->assertOk()
            ->assertJsonPath('data.station_pin.has_pin', false);

        $this->assertNull($w['user']->fresh()->station_pin_hash);
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/me')->assertUnauthorized();
        $this->stationLogin($w['employee']->employee_no, self::PIN)->assertStatus(422);
    }

    /** @test */
    public function provisioning_is_audited_without_ever_recording_the_pin(): void
    {
        $this->noThrottle();
        $this->buildFixture();
        $w = $this->makeStationWorker('sellerA', pin: null);
        $owner = User::where('email', 'owner@fuel-b3.test')->firstOrFail();

        $pin = $this->withToken($this->fx['owner'])->postJson($this->pinUrl($w['user']->id), ['pin' => '482915', 'reason' => 'أول مرة'])->assertOk()
            ->json('data.station_pin');
        $this->withToken($this->fx['owner'])->postJson($this->pinUrl($w['user']->id), ['pin' => '739204'])->assertOk(); // إعادة تعيين: يُدقَّق أيضاً
        $this->withToken($this->fx['owner'])->deleteJson($this->pinUrl($w['user']->id))->assertOk();

        $events = AccessChangeEvent::where('target_user_id', $w['user']->id)->orderBy('occurred_at')->orderBy('id')->get();
        $this->assertEqualsCanonicalizing(
            ['fuel_staff.station_pin_set', 'fuel_staff.station_pin_set', 'fuel_staff.station_pin_cleared'],
            $events->pluck('action')->all(),
        );
        $this->assertSame($owner->id, $events->first()->actor_id);
        $dump = json_encode($events->toArray());
        foreach (['482915', '739204', 'station_pin_hash', '$2y$'] as $secret) {
            $this->assertStringNotContainsString($secret, $dump);
        }
    }

    /** @test */
    public function provisioning_guards_match_staff_management_and_deny_dangerous_targets(): void
    {
        $this->noThrottle();
        $this->buildFixture();
        $owner = User::where('email', 'owner@fuel-b3.test')->firstOrFail();
        $mgr = $this->makeUser('mgr', 'fuel-b3-mgr', $this->managerPermissions());
        $plain = $this->makeUser('plainstaff', 'staff'); // بلا fuel.staff.manage
        $w = $this->makeStationWorker('sellerA', pin: null);

        // بلا صلاحية إدارة الموظفين ⇒ 403.
        $this->withToken($plain['token'])->postJson($this->pinUrl($w['user']->id))->assertForbidden();
        // مدير: لا يعيّن لنفسه، ولا للمالك.
        $this->withToken($mgr['token'])->postJson($this->pinUrl($mgr['user']->id))->assertForbidden();
        $this->withToken($mgr['token'])->postJson($this->pinUrl($owner->id))->assertForbidden();
        $this->assertNull($owner->fresh()->station_pin_hash);
        // معرّف مجهول ⇒ 404.
        $this->withToken($this->fx['owner'])->postJson($this->pinUrl('00000000-0000-4000-8000-000000000000'))->assertNotFound();
        // مرفوضات مدقَّقة.
        $this->assertGreaterThanOrEqual(2, AccessChangeEvent::where('action', 'fuel_staff.station_pin_set')->where('outcome', 'denied')->count());
    }

    /** @test */
    public function a_target_without_an_active_linked_employee_cannot_get_a_pin(): void
    {
        $this->noThrottle();
        $this->buildFixture();
        $unlinked = $this->makeUser('nolink', 'staff'); // لا employee_id
        $this->withToken($this->fx['owner'])->postJson($this->pinUrl($unlinked['user']->id))->assertStatus(422);

        $w = $this->makeStationWorker('sellerA', pin: null);
        $w['employee']->forceFill(['is_active' => false])->save();
        $this->withToken($this->fx['owner'])->postJson($this->pinUrl($w['user']->id))->assertStatus(422);
        $this->assertNull($w['user']->fresh()->station_pin_hash);
    }

    /** @test */
    public function a_target_from_another_tenant_is_invisible_to_the_manager(): void
    {
        $this->noThrottle();
        $this->buildFixture();
        $other = $this->registerTenant('other-co', 'owner@other-co.test');
        $foreign = User::where('email', 'owner@other-co.test')->firstOrFail();
        app(TenantContext::class)->set($this->tenantId);

        $this->withToken($this->fx['owner'])->postJson($this->pinUrl($foreign->id))->assertNotFound();
        $this->assertNull($foreign->fresh()->station_pin_hash);
        $this->assertSame($other['tenant_id'], $foreign->tenant_id);
    }

    /** @test */
    public function a_station_pin_session_cannot_provision_pins_even_with_the_permission(): void
    {
        $this->noThrottle();
        $this->buildFixture();
        $target = $this->makeStationWorker('victim', pin: null);
        $mgr = $this->makeStationWorker('mgrpin', role: 'fuel-b3-mgr2');
        \App\Models\Role::create(['tenant_id' => $this->tenantId, 'slug' => 'fuel-b3-mgr2', 'name' => 'm', 'permissions' => $this->managerPermissions(), 'is_system' => false]);
        $token = $this->stationLogin($mgr['employee']->employee_no, self::PIN)->assertOk()->json('token');

        $this->withToken($token)->postJson($this->pinUrl($target['user']->id))->assertForbidden();
        $this->assertNull($target['user']->fresh()->station_pin_hash);
    }

    // ───────────────────────── الحماية من التسريب ─────────────────────────

    /** @test */
    public function the_pin_hash_is_never_serialized_or_mass_assignable(): void
    {
        $this->buildFixture();
        $w = $this->makeStationWorker('sellerA');

        $this->assertArrayNotHasKey('station_pin_hash', $w['user']->fresh()->toArray());
        $this->assertStringNotContainsString('station_pin_hash', $w['user']->fresh()->toJson());
        $this->assertNotContains('station_pin_hash', (new User())->getFillable());

        $w['user']->fill(['station_pin_hash' => 'x'])->save();
        $this->assertNotSame('x', $w['user']->fresh()->station_pin_hash, 'تعيين جماعي مرفوض');
    }

    /** @test */
    public function hostname_context_is_not_leaked_between_requests(): void
    {
        $this->noThrottle();
        $this->buildFixture();
        $w = $this->makeStationWorker('sellerA');
        $this->stationLogin($w['employee']->employee_no, self::PIN)->assertOk();

        $this->assertFalse(app(HostnameTenantContext::class)->has());
    }
}
