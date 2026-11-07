<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Branch;
use App\Models\FuelProduct;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\EntitlementGrantService;
use App\Services\FuelStationSettingsService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * عالم اختبار «الرصيد الافتتاحي للوقود» — محطة نبراس الطموح المرجعية (بيانات مرجعية للاختبار فقط):
 * بنزين 91 = 30,000 لتر · بنزين 95 = 15,555 لتر · ديزل = 31,000 لتر، لكل منتج خزان واحد سعته 34,000 لتر.
 *
 * **التكاليف وهمية بالكامل** (218 / 233 / 166 هللة للتر) وتخص الاختبارات وحدها؛ لا علاقة لها بتكلفة فعلية لأي محطة.
 * حساب الطرف المقابل يُعيَّن صراحةً في الإعداد (لا دور معتمد ولا افتراض): الاختبار هو «المالك» الذي يعيّنه.
 */
trait BuildsFuelOpeningWorld
{
    public const FAKE_COST_91 = 218;
    public const FAKE_COST_95 = 233;
    public const FAKE_COST_DIESEL = 166;

    /** 30,000,000 × 218 ÷ 1000 */
    public const VALUE_91 = 6_540_000;
    /** 15,555,000 × 233 ÷ 1000 */
    public const VALUE_95 = 3_624_315;
    /** 31,000,000 × 166 ÷ 1000 */
    public const VALUE_DIESEL = 5_146_000;
    public const TOTAL_VALUE = 15_310_315;

    /** @var list<string> */
    protected array $createdTenants = [];

    /** @return array<string,mixed> */
    protected function openingWorld(bool $configureAccount = true, ?string $stationCode = null): array
    {
        config(['fuel_stations.opening_balance_enabled' => true]);
        $slug = 'fob-' . Str::lower(Str::random(7));
        $auth = $this->registerTenant($slug, "owner-{$slug}@fob.test");
        $tenantId = $auth['tenant_id'];
        $this->createdTenants[] = $tenantId;
        app(TenantContext::class)->set($tenantId);
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($tenantId), 'fuel_stations.core', EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL,
            CarbonImmutable::now('UTC'), grantReasonCode: 'test_fuel_opening', reason: 'اختبار الرصيد الافتتاحي للوقود.',
        );
        Tenant::findOrFail($tenantId)->update(['country' => 'SA']);
        $branch = Branch::where('tenant_id', $tenantId)->where('is_main', true)->firstOrFail();
        app(BranchContext::class)->set($branch->id);
        $warehouse = Warehouse::where('tenant_id', $tenantId)->where('is_default', true)->firstOrFail();
        $actor = User::where('tenant_id', $tenantId)->where('role', 'owner')->firstOrFail();

        $station = FuelStation::create(['branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'code' => $stationCode ?? 'FOB-' . $slug, 'name' => 'نبراس الطموح']);
        $tanks = [];
        $fuels = [];
        foreach (['91' => 'بنزين 91', '95' => 'بنزين 95', 'diesel' => 'ديزل'] as $key => $name) {
            $product = Product::create(['branch_id' => $branch->id, 'sku' => "FOB-{$key}-{$slug}", 'name' => $name, 'unit' => 'mL', 'track_inventory' => true]);
            $fuels[$key] = FuelProduct::create(['product_id' => $product->id, 'code' => "FOB-{$key}-{$slug}", 'name' => $name]);
            $tanks[$key] = FuelTank::create([
                'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuels[$key]->id,
                'code' => "T-{$key}-{$slug}", 'name' => "خزان {$name}", 'capacity_milliliters' => 34_000_000, 'safe_capacity_milliliters' => 33_000_000,
            ]);
        }

        $account = Account::where('tenant_id', $tenantId)->where('code', '3130')->first();
        if ($configureAccount && $account !== null) {
            app(FuelStationSettingsService::class)->putTenant(['fuel_opening_balance_account_id' => $account->id], $actor, 'تعيين صريح لاختبار الرصيد الافتتاحي');
        }

        return [
            'tenant_id' => $tenantId, 'branch' => $branch, 'warehouse' => $warehouse, 'actor' => $actor, 'station' => $station,
            'tanks' => $tanks, 'fuels' => $fuels, 'opening_account' => $account, 'slug' => $slug, 'owner_token' => $auth['token'],
        ];
    }

    /** حمولة مستند الأرصدة المرجعية الثلاثة بتكاليف وهمية. @param array<string,mixed> $w @param array<string,mixed> $overrides @return array<string,mixed> */
    protected function openingPayload(array $w, array $overrides = []): array
    {
        return array_replace([
            'fuel_station_id' => $w['station']->id,
            'opening_date' => app(FuelStationSettingsService::class)->businessDate($w['station']),
            'idempotency_key' => 'fob-' . Str::lower(Str::random(10)),
            'lines' => [
                ['fuel_tank_id' => $w['tanks']['91']->id, 'quantity_liters' => '30000'],
                ['fuel_tank_id' => $w['tanks']['95']->id, 'quantity_liters' => '15555'],
                ['fuel_tank_id' => $w['tanks']['diesel']->id, 'quantity_liters' => '31000'],
            ],
            'costs' => [
                ['fuel_product_id' => $w['fuels']['91']->id, 'unit_cost_per_liter_minor' => self::FAKE_COST_91],
                ['fuel_product_id' => $w['fuels']['95']->id, 'unit_cost_per_liter_minor' => self::FAKE_COST_95],
                ['fuel_product_id' => $w['fuels']['diesel']->id, 'unit_cost_per_liter_minor' => self::FAKE_COST_DIESEL],
            ],
        ], $overrides);
    }

    /** بصمة الآثار (مخزون/حركات/دفتر/قيود/تكلفة) للمقارنة قبل/بعد: «لا أثر». @param array<string,mixed> $w @return array<string,int> */
    protected function openingEffects(array $w): array
    {
        $t = $w['tenant_id'];

        return [
            'stock' => (int) DB::table('product_warehouse_stock')->where('warehouse_id', $w['warehouse']->id)->sum('quantity'),
            'stock_rows' => (int) DB::table('product_warehouse_stock')->where('warehouse_id', $w['warehouse']->id)->count(),
            'movements' => (int) DB::table('stock_movements')->where('tenant_id', $t)->count(),
            'ledger' => (int) DB::table('fuel_operational_ledgers')->where('tenant_id', $t)->count(),
            'journal_entries' => (int) DB::table('journal_entries')->where('tenant_id', $t)->count(),
            'cost_states' => (int) DB::table('fuel_inventory_cost_states')->where('tenant_id', $t)->count(),
            'cost_movements' => (int) DB::table('fuel_inventory_cost_movements')->where('tenant_id', $t)->count(),
            'suppliers' => (int) DB::table('partners')->where('tenant_id', $t)->where('type', 'supplier')->count(),
            'purchases' => (int) DB::table('purchases')->where('tenant_id', $t)->count(),
            'deliveries' => (int) DB::table('fuel_deliveries')->where('tenant_id', $t)->count(),
            'invoices' => (int) DB::table('invoices')->where('tenant_id', $t)->count(),
        ];
    }

    /** يلتقط الاستثناء المرمي (أي صنف، بما فيه ما لا يرث RuntimeException) ويفشل إن لم يُرمَ شيء؛ ولا يبتلع فشل التأكيد نفسه. */
    protected function caught(callable $operation): \Throwable
    {
        try {
            $operation();
        } catch (\PHPUnit\Framework\AssertionFailedError $e) {
            throw $e;
        } catch (\Throwable $e) {
            return $e;
        }

        $this->fail('كان متوقعاً أن تُرمى استثناء ولم يحدث.');
    }

    protected function cleanupOpeningTenants(): void
    {
        foreach ($this->createdTenants as $id) {
            DB::table('tenants')->where('id', $id)->delete();
        }
    }
}
