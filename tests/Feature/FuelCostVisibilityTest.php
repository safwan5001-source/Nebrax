<?php

namespace Tests\Feature;

use App\Http\Resources\CorporateFuelContractResource;
use App\Http\Resources\FuelSaleResource;
use App\Models\CorporateFuelContract;
use App\Models\FuelSale;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\User;
use App\Services\EntitlementGrantService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Support\FuelCostVisibility;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Tests\TestCase;

/**
 * FS-23: cogs/margin/credit_limit لا تظهر لمجرد صلاحيات العرض التشغيلية
 * (`fuel.sale.view`، `fuel.reports.view`، `fuel.contract.view`) بل تتبع `products.view_cost` و`fuel.credit.view`.
 */
class FuelCostVisibilityTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const BASE = '/api/fuel-stations';

    /** @test */
    public function the_dashboard_margin_needs_the_cost_permission(): void
    {
        $f = $this->fixture();

        $this->assertArrayHasKey('gross_margin_minor', $this->withToken($f['owner'])->getJson(self::BASE . '/dashboard')->assertOk()->json('data'));
        $this->assertArrayNotHasKey('gross_margin_minor', $this->withToken($f['viewer'])->getJson(self::BASE . '/dashboard')->assertOk()->json('data'));
        $this->assertArrayHasKey('gross_margin_minor', $this->withToken($f['cost_viewer'])->getJson(self::BASE . '/dashboard')->assertOk()->json('data'));
    }

    /** @test */
    public function the_profitability_report_is_refused_without_the_cost_permission_but_other_reports_stay_available(): void
    {
        $f = $this->fixture();

        $this->withToken($f['viewer'])->getJson(self::BASE . '/reports/profitability')->assertForbidden();
        $this->withToken($f['viewer'])->getJson(self::BASE . '/reports/sales')->assertOk();
        $this->withToken($f['viewer'])->getJson(self::BASE . '/reports/inventory')->assertOk();
        $this->withToken($f['owner'])->getJson(self::BASE . '/reports/profitability')->assertOk();
        $this->withToken($f['cost_viewer'])->getJson(self::BASE . '/reports/profitability')->assertOk();
    }

    /** @test */
    public function report_redaction_removes_the_cost_keys_at_any_depth_and_leaves_operational_fields(): void
    {
        $report = ['family' => 'fleet', 'vehicle_consumption' => [
            ['dimension_id' => 'v1', 'sales_count' => 2, 'revenue_minor' => 5000, 'cogs_minor' => 3000, 'margin_minor' => 2000],
        ], 'rows' => [['movement_type' => 'receipt', 'quantity_milliliters' => 10, 'value_minor' => 99]]];

        $redacted = FuelCostVisibility::redactReport($report, false);
        $this->assertSame(['dimension_id' => 'v1', 'sales_count' => 2, 'revenue_minor' => 5000], $redacted['vehicle_consumption'][0]);
        $this->assertSame(['movement_type' => 'receipt', 'quantity_milliliters' => 10], $redacted['rows'][0]);
        $this->assertSame($report, FuelCostVisibility::redactReport($report, true));
    }

    /** @test */
    public function the_sale_resource_hides_cogs_without_the_cost_permission(): void
    {
        $f = $this->fixture();
        $sale = new FuelSale(['quantity_milliliters' => 1000, 'gross_minor' => 5000, 'cogs_minor' => 3200, 'paid_minor' => 0]);

        $restricted = (new FuelSaleResource($sale))->resolve($this->requestFor($f['viewer_user']));
        $this->assertArrayNotHasKey('cogs_minor', $restricted);
        $this->assertArrayNotHasKey('cogs', $restricted);
        $this->assertSame(5000, $restricted['gross_minor']);

        foreach (['owner_user', 'cost_viewer_user'] as $key) {
            $full = (new FuelSaleResource($sale))->resolve($this->requestFor($f[$key]));
            $this->assertSame(3200, $full['cogs_minor']);
            $this->assertArrayHasKey('cogs', $full);
        }
    }

    /** @test */
    public function the_contract_resource_hides_the_credit_limit_without_fuel_credit_view(): void
    {
        $f = $this->fixture();
        $contract = new CorporateFuelContract(['number' => 'CFC-1', 'status' => 'active', 'credit_limit_minor' => 250000, 'payment_terms_days' => 30]);

        $restricted = (new CorporateFuelContractResource($contract))->resolve($this->requestFor($f['viewer_user']));
        $this->assertArrayNotHasKey('credit_limit_minor', $restricted);
        $this->assertSame(30, $restricted['payment_terms_days']);

        $credit = (new CorporateFuelContractResource($contract))->resolve($this->requestFor($f['credit_viewer_user']));
        $this->assertSame(250000, $credit['credit_limit_minor']);
        $owner = (new CorporateFuelContractResource($contract))->resolve($this->requestFor($f['owner_user']));
        $this->assertSame(250000, $owner['credit_limit_minor']);
    }

    private function requestFor(User $user): Request
    {
        $request = Request::create('/');
        $request->setUserResolver(fn () => $user);

        return $request;
    }

    /** @return array<string,mixed> */
    private function fixture(): array
    {
        $auth = $this->registerTenant('fuel-cost-vis', 'owner@fuel-cost-vis.test', autoEnableApplications: true);
        $tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($tenantId);
        $tenant = Tenant::findOrFail($tenantId);
        $grants = app(EntitlementGrantService::class);
        foreach (['fuel_stations.core', 'fuel_stations.maintenance'] as $app) {
            $grants->grant($tenant, $app, EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL, CarbonImmutable::now('UTC'), grantReasonCode: 'test_fs23', reason: 'اختبار حجب التكلفة.');
        }

        $base = ['fuel_stations.view', 'fuel.reports.view', 'fuel.sale.view', 'fuel.contract.view'];
        $make = function (string $slug, array $extra, string $email) use ($tenantId, $base): array {
            $role = Role::create(['tenant_id' => $tenantId, 'slug' => $slug, 'name' => $slug, 'permissions' => [...$base, ...$extra], 'is_system' => false]);
            $user = User::create(['tenant_id' => $tenantId, 'name' => $slug, 'email' => $email, 'password' => 'password123', 'role' => $role->slug]);

            return [$user, $user->createToken('api')->plainTextToken];
        };
        [$viewerUser, $viewer] = $make('fuel-viewer', [], 'viewer@fuel-cost.test');
        [$costUser, $costToken] = $make('fuel-cost-viewer', ['products.view_cost'], 'cost@fuel-cost.test');
        [$creditUser] = $make('fuel-credit-viewer', ['fuel.credit.view'], 'credit@fuel-cost.test');

        return [
            'owner' => $auth['token'], 'owner_user' => User::query()->where('email', 'owner@fuel-cost-vis.test')->firstOrFail(),
            'viewer' => $viewer, 'viewer_user' => $viewerUser,
            'cost_viewer' => $costToken, 'cost_viewer_user' => $costUser,
            'credit_viewer_user' => $creditUser,
        ];
    }
}
