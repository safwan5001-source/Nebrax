<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\ProductWarehouseStock;
use Illuminate\Support\Facades\DB;
use App\Models\Branch;
use App\Models\FuelStation;
use App\Models\Partner;
use App\Models\PaymentMethod;
use App\Models\Product;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\CashBankAccountService;
use App\Services\EntitlementGrantService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;

/**
 * FUEL-E2E — عالم اختبار اصطناعي لمحطة وقود. كل الأسماء والرموز تبدأ بـ E2E_TEST.
 * الإنشاء يمرّ عبر HTTP API الحقيقي (محطة/منتج/خزان/مضخة/فوهة/رصيد افتتاحي/سعر) لا عبر النماذج،
 * فيختبر العلاقات والتحقق والصلاحيات كما يراها عميل حقيقي. لا بوابة دفع ولا حساب بنكي حقيقي.
 */
trait FuelStationE2EWorld
{
    /** @var array<string,mixed> */
    protected array $w = [];

    protected function evidence(string $scenario, array $data): void
    {
        $dir = '/tmp/claude-0/e2e';
        @mkdir($dir, 0777, true);
        file_put_contents($dir . '/evidence.jsonl', json_encode(['scenario' => $scenario, 'at' => now()->toIso8601String()] + $data, JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND);
    }

    protected function as(string $who): static
    {
        return $this->withToken($this->w['tokens'][$who]);
    }

    /** @param array<int,string> $permissions */
    protected function e2eUser(string $slug, array $permissions, ?string $tenantId = null): User
    {
        $tenantId ??= $this->w['tenant_id'];
        app(TenantContext::class)->set($tenantId);
        $role = Role::create(['tenant_id' => $tenantId, 'slug' => "e2e-{$slug}", 'name' => "E2E_TEST {$slug}", 'permissions' => $permissions, 'is_system' => false]);

        return User::create(['tenant_id' => $tenantId, 'name' => "E2E_TEST {$slug}", 'email' => "e2e-{$slug}-" . substr(md5($tenantId), 0, 6) . "@e2e-test.invalid", 'password' => 'password123', 'role' => $role->slug]);
    }

    /**
     * @param  array<string,mixed>  $settings  تجاوزات إعدادات المحطة فوق الافتراضيات الصارمة
     * @param  array{liters?:string, cost?:int, price?:int}  $stock
     */
    protected function buildWorld(array $settings = [], array $stock = [], string $slug = 'e2e-test-fuel'): void
    {
        config([
            'fuel_stations.shift_collection_declaration_enabled' => true,
            'fuel_stations.shift_cash_receipts_enabled' => true,
        ]);
        $auth = $this->registerTenant($slug, "owner@{$slug}.invalid");
        $tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($tenantId);
        Tenant::findOrFail($tenantId)->update(['country' => 'SA']);
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($tenantId), 'fuel_stations.core', EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL,
            CarbonImmutable::now('UTC'), grantReasonCode: 'e2e_test', reason: 'E2E_TEST fuel station journey.',
        );
        $branch = Branch::where('tenant_id', $tenantId)->sole();
        app(BranchContext::class)->set($branch->id);
        $owner = User::where('tenant_id', $tenantId)->where('role', 'owner')->sole();
        $warehouse = Warehouse::where('tenant_id', $tenantId)->where('branch_id', $branch->id)->sole();
        $this->w = ['tenant_id' => $tenantId, 'branch' => $branch, 'warehouse' => $warehouse, 'owner' => $owner, 'tokens' => ['owner' => $auth['token']]];

        // الأدوار: بائع (أقل امتياز لتشغيل الوردية) ومشرف (مراجعة/اعتماد) وعارض فقط.
        $seller = $this->e2eUser('seller', ['fuel.shift.view', 'fuel.shift.open', 'fuel.shift.cash_count', 'fuel.shift.close', 'fuel.sale.view', 'fuel.sale.create', 'fuel.sale.finalize', 'fuel.sale.collect', 'fuel_stations.view']);
        $supervisor = $this->e2eUser('supervisor', ['fuel.shift.view', 'fuel.shift.approve', 'fuel.shift.cash_variance_review', 'fuel.sale.view', 'fuel_stations.view']);
        $viewer = $this->e2eUser('viewer', ['fuel.shift.view', 'fuel.sale.view']);
        $nobody = $this->e2eUser('nobody', []);
        foreach (compact('seller', 'supervisor', 'viewer', 'nobody') as $name => $user) {
            $this->w[$name] = $user;
            $this->w['tokens'][$name] = $user->createToken('api')->plainTextToken;
        }
        app(TenantContext::class)->set($tenantId);
        app(BranchContext::class)->set($branch->id);

        // ── كتالوج المنتج الأساسي (مخزون mL) ثم بيانات الوقود عبر API ──
        $product = Product::create(['tenant_id' => $tenantId, 'branch_id' => $branch->id, 'sku' => 'E2E_TEST-91', 'name' => 'E2E_TEST بنزين 91', 'unit' => 'mL', 'track_inventory' => true]);
        $base = '/api/fuel-stations';
        $station = $this->as('owner')->postJson("{$base}/stations", [
            'branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'code' => 'E2E_TEST-ST1', 'name' => 'E2E_TEST محطة نبراس الطموح', 'timezone' => 'Asia/Riyadh',
        ])->assertCreated()['data'];
        $fuelProduct = $this->as('owner')->postJson("{$base}/products", ['product_id' => $product->id, 'code' => 'E2E_TEST-91', 'name' => 'E2E_TEST بنزين 91'])->assertCreated()['data'];
        $tank = $this->as('owner')->postJson("{$base}/tanks", [
            'fuel_station_id' => $station['id'], 'fuel_product_id' => $fuelProduct['id'], 'code' => 'E2E_TEST-T1', 'name' => 'E2E_TEST خزان 1',
            'capacity_milliliters' => 20000000, 'safe_capacity_milliliters' => 18000000,
        ])->assertCreated()['data'];
        $pump = $this->as('owner')->postJson("{$base}/pumps", ['fuel_station_id' => $station['id'], 'pump_number' => 'E2E_TEST-P1'])->assertCreated()['data'];
        $nozzle = $this->as('owner')->postJson("{$base}/nozzles", [
            'fuel_pump_id' => $pump['id'], 'fuel_tank_id' => $tank['id'], 'fuel_product_id' => $fuelProduct['id'], 'nozzle_number' => 'E2E_TEST-N1',
        ])->assertCreated()['data'];

        // ── طرق الدفع (نقد/بنك من تهيئة النظام — لا بوابة فعلية) ──
        app(CashBankAccountService::class)->bootstrapDefaults();
        $cash = PaymentMethod::where('settlement_type', 'cash')->where('is_active', true)->sole();
        $bank = PaymentMethod::where('settlement_type', 'bank')->where('is_active', true)->orderBy('name')->firstOrFail();
        $customer = Partner::create(['tenant_id' => $tenantId, 'branch_id' => $branch->id, 'name' => 'E2E_TEST عميل نقدي', 'type' => 'customer']);

        $equity = Account::where('tenant_id', $tenantId)->where('code', '3130')->first() ?? Account::where('tenant_id', $tenantId)->where('type', 'equity')->where('is_group', false)->firstOrFail();
        $defaults = [
            'fuel_price_tax_mode' => 'tax_inclusive',
            'fuel_sales_allowed_payment_method_ids' => [$cash->id, $bank->id],
            'fuel_sales_allow_deferred_payment' => false,
            'fuel_opening_balance_account_id' => $equity->id,
        ];
        $this->as('owner')->putJson("{$base}/stations/{$station['id']}/settings", array_replace($defaults, $settings))->assertOk();

        // ── رصيد افتتاحي (مسودة ← ترحيل) وسعر ──
        $liters = $stock['liters'] ?? '10000';
        $costPerLiter = $stock['cost'] ?? 100;
        $opening = $this->as('owner')->postJson("{$base}/opening-balances", [
            'fuel_station_id' => $station['id'], 'opening_date' => now('Asia/Riyadh')->toDateString(), 'idempotency_key' => 'e2e-open-bal-' . $slug,
            'lines' => [['fuel_tank_id' => $tank['id'], 'quantity_liters' => $liters]],
            'costs' => [['fuel_product_id' => $fuelProduct['id'], 'unit_cost_per_liter_minor' => $costPerLiter]],
        ])->assertCreated()['data'];
        $this->as('owner')->postJson("{$base}/opening-balances/{$opening['id']}/post")->assertSuccessful();
        $this->as('owner')->postJson("{$base}/prices", [
            'fuel_station_id' => $station['id'], 'fuel_product_id' => $fuelProduct['id'], 'price_per_liter_minor' => $stock['price'] ?? 230, 'start_now' => true,
            'idempotency_key' => 'e2e-price-' . $slug . '-1',
        ])->assertSuccessful();

        $this->w += compact('product', 'station', 'fuelProduct', 'tank', 'pump', 'nozzle', 'cash', 'bank', 'customer') + ['opening' => $opening];
    }

    // ───────── مساعدات تشغيل الوردية عبر HTTP ─────────

    protected function openShift(string $who, string $key, int $float = 20000): string
    {
        return $this->as($who)->postJson('/api/fuel-stations/shifts/open', [
            'fuel_station_id' => $this->w['station']['id'], 'opening_float_minor' => $float, 'idempotency_key' => $key,
        ])->assertSuccessful()['data']['id'];
    }

    protected function meter(string $who, string $shift, string $stage, int $ml, ?string $key = null)
    {
        return $this->as($who)->postJson("/api/fuel-stations/shifts/{$shift}/meter-readings", [
            'fuel_nozzle_id' => $this->w['nozzle']['id'], 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => $key ?? "e2e-meter-{$shift}-{$stage}",
        ]);
    }

    protected function tankReading(string $who, string $shift, string $stage, int $ml, ?string $key = null)
    {
        return $this->as($who)->postJson("/api/fuel-stations/shifts/{$shift}/tank-readings", [
            'fuel_tank_id' => $this->w['tank']['id'], 'reading_stage' => $stage, 'quantity_milliliters' => $ml, 'evidence_key' => $key ?? "e2e-tank-{$shift}-{$stage}",
        ]);
    }

    protected function draftSale(string $who, string $shift, mixed $ml, string $key, array $extra = [])
    {
        return $this->as($who)->postJson('/api/fuel-stations/sales', $extra + [
            'fuel_station_id' => $this->w['station']['id'], 'fuel_nozzle_id' => $this->w['nozzle']['id'], 'fuel_shift_id' => $shift,
            'partner_id' => $this->w['customer']->id, 'quantity_milliliters' => $ml, 'idempotency_key' => $key,
        ]);
    }

    /** مسودة + إنهاء؛ يعيد بيانات البيع النهائية. */
    protected function finalSale(string $who, string $shift, int $ml, string $key): array
    {
        $id = $this->draftSale($who, $shift, $ml, $key)->assertSuccessful()['data']['id'];

        return $this->as($who)->postJson("/api/fuel-stations/sales/{$id}/finalize")->assertSuccessful()['data'];
    }

    protected function collect(string $who, string $saleId, string $method, int $amount, string $key)
    {
        return $this->as($who)->postJson("/api/fuel-stations/sales/{$saleId}/payments", [
            'payment_method_id' => $this->w[$method]->id, 'amount_minor' => $amount, 'idempotency_key' => $key,
        ]);
    }

    /** يعلن التحصيل: [cash => x, bank => y]. */
    protected function declareCollection(string $who, string $shift, int $cash, int $bank, string $key, int $rev = 0)
    {
        return $this->as($who)->postJson("/api/fuel-stations/shifts/{$shift}/collection", [
            'idempotency_key' => $key, 'base_revision' => $rev,
            'lines' => [['payment_method_id' => $this->w['cash']->id, 'amount_minor' => $cash], ['payment_method_id' => $this->w['bank']->id, 'amount_minor' => $bank]],
        ]);
    }

    protected function closeShift(string $who, string $shift, int $counted, ?string $note = null)
    {
        return $this->as($who)->postJson("/api/fuel-stations/shifts/{$shift}/close", ['counted_cash_minor' => $counted] + ($note !== null ? ['closing_note' => $note] : []));
    }

    /** @return array{by:array<string,array{d:int,c:int}>,debit:int,credit:int,entries:int,unbalanced:int} */
    protected function books(): array
    {
        $t = $this->w['tenant_id'];
        $rows = DB::table('journal_lines')
            ->join('accounts', 'accounts.id', '=', 'journal_lines.account_id')
            ->join('journal_entries', 'journal_entries.id', '=', 'journal_lines.journal_entry_id')
            ->where('journal_lines.tenant_id', $t)->whereIn('journal_entries.status', ['posted', 'reversed'])
            ->groupBy('accounts.code')->selectRaw('accounts.code as code, SUM(journal_lines.debit) as d, SUM(journal_lines.credit) as c')->get();
        $by = [];
        foreach ($rows as $r) { $by[$r->code] = ['d' => (int) $r->d, 'c' => (int) $r->c]; }
        $unbalanced = DB::table('journal_lines')->where('tenant_id', $t)->groupBy('journal_entry_id')
            ->havingRaw('SUM(debit) <> SUM(credit)')->selectRaw('journal_entry_id')->get()->count();

        return [
            'by' => $by, 'debit' => array_sum(array_column($by, 'd')), 'credit' => array_sum(array_column($by, 'c')),
            'entries' => DB::table('journal_entries')->where('tenant_id', $t)->where('status', 'posted')->count(), 'unbalanced' => $unbalanced,
        ];
    }

    protected function net(array $books, string $code): int
    {
        return ($books['by'][$code]['d'] ?? 0) - ($books['by'][$code]['c'] ?? 0);
    }

    protected function assertBooksIntegrity(string $at): void
    {
        $b = $this->books();
        $this->assertSame($b['debit'], $b['credit'], "{$at}: Σ مدين ≠ Σ دائن");
        $this->assertSame(0, $b['unbalanced'], "{$at}: يوجد قيد غير متوازن");
    }

    protected function stockMl(): int
    {
        return (int) ProductWarehouseStock::where('warehouse_id', $this->w['warehouse']->id)->where('product_id', $this->w['product']->id)->sum('quantity');
    }


    /** يشغّل وردية قياسية كاملة حتى الإغلاق. */
    protected function standardShift(string $tag, int $ml, string $method = 'cash', ?int $counted = null, int $float = 20000): array
    {
        $shift = $this->openShift('seller', "{$tag}-open", $float);
        $this->as('seller')->postJson("/api/fuel-stations/shifts/{$shift}/staff", ['user_id' => $this->w['seller']->id, 'role' => 'attendant'])->assertSuccessful();
        $this->meter('seller', $shift, 'opening', 1000000)->assertCreated();
        $this->tankReading('seller', $shift, 'opening', 10000000)->assertCreated();
        $sale = $this->finalSale('seller', $shift, $ml, "{$tag}-sale");
        $gross = (int) $sale['gross_minor'];
        $this->collect('seller', $sale['id'], $method, $gross, "{$tag}-pay")->assertSuccessful();
        $this->meter('seller', $shift, 'closing', 1000000 + $ml)->assertCreated();
        $this->tankReading('seller', $shift, 'closing', 10000000 - $ml)->assertCreated();
        $this->declareCollection('seller', $shift, $method === 'cash' ? $gross : 0, $method === 'bank' ? $gross : 0, "{$tag}-decl")->assertSuccessful();

        return ['shift' => $shift, 'sale' => $sale, 'gross' => $gross, 'counted' => $counted ?? ($float + ($method === 'cash' ? $gross : 0))];
    }

}
