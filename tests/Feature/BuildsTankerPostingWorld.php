<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\FuelNozzle;
use App\Models\FuelPump;
use App\Models\FuelShift;
use App\Models\FuelTankerFill;
use App\Models\FuelTankerOwner;
use App\Models\Role;
use App\Models\User;
use App\Services\Accounting\InventoryService;
use App\Services\Accounting\LedgerService;
use App\Services\FuelCostBasisService;
use App\Services\FuelInventoryLedgerReconciliation;
use App\Services\FuelStationSettingsService;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * TANKER-PR6B-4/5/6 — عالم اختبار مشترك لسندات التعبئة المرحَّلة: محطة نبراس الطموح المرجعية بأرصدة افتتاحية مرحَّلة فعلاً (بنزين 91 = 30,000 لتر بتكلفة وهمية 218 هللة/لتر ⇒ قيمة المجمّع 6,540,000 هللة)،
 * حساب وسيط 1145 معيَّن، وردية مفتوحة، وفوهة وصاحب صهريج. بيانات اختبارية فقط. يستعمله `FuelTankerFillInventoryReversalTest` وملحقاته؛ يحتاج `InteractsWithApi` و`BuildsFuelOpeningWorld`.
 */
trait BuildsTankerPostingWorld
{
    private const OPENING = '/api/fuel-stations/opening-balances';
    private const FILLS = '/api/fuel-stations/tanker-fills';

    /** @var array<string,mixed> */
    private array $w;
    private FuelNozzle $nozzle;
    private FuelTankerOwner $owner;
    private Account $clearing;
    private int $seq = 0;

    protected function bootPostingWorld(): void
    {
        config([
            'fuel_stations.tanker_management_enabled' => true, 'fuel_stations.tanker_fills_enabled' => true,
            'fuel_stations.tanker_inventory_posting_enabled' => true,
        ]);
        $this->w = $this->openingWorld();
        $id = $this->withToken($this->w['owner_token'])->postJson(self::OPENING, $this->openingPayload($this->w))->assertCreated()->json('data.id');
        $this->withToken($this->w['owner_token'])->postJson(self::OPENING . "/{$id}/post")->assertOk();

        app(TenantContext::class)->set($this->w['tenant_id']);
        $this->clearing = Account::create(['code' => '1145', 'name' => 'وسيط وقود مصروف لصهاريج', 'type' => 'asset', 'normal_balance' => 'debit', 'is_group' => false, 'is_active' => true]);
        $this->configure(['tanker_issue_clearing_account_id' => $this->clearing->id, 'tanker_inventory_posting_start_at' => now()->subDay()->utc()->format('Y-m-d\TH:i:s\Z')]);

        $station = $this->w['station'];
        $pump = FuelPump::create(['branch_id' => $station->branch_id, 'fuel_station_id' => $station->id, 'pump_number' => '01', 'name' => 'مضخة 1']);
        $this->nozzle = FuelNozzle::create([
            'branch_id' => $station->branch_id, 'fuel_station_id' => $station->id, 'fuel_pump_id' => $pump->id, 'fuel_tank_id' => $this->w['tanks']['91']->id,
            'fuel_product_id' => $this->w['fuels']['91']->id, 'nozzle_number' => '1',
        ]);
        $this->owner = FuelTankerOwner::create(['name' => 'عسكر', 'code' => 'ASK', 'status' => 'active']);
        FuelShift::create([
            'branch_id' => $station->branch_id, 'fuel_station_id' => $station->id, 'number' => 'FSH-RV-1', 'status' => FuelShift::STATUS_OPEN, 'opening_float_minor' => 0,
            'idempotency_key' => 'shift-rv-1', 'opened_by' => $this->w['actor']->id, 'opened_at' => now(),
        ]);
    }

    /** @param array<string,mixed> $values */
    private function configure(array $values): void
    {
        app(TenantContext::class)->set($this->w['tenant_id']);
        app(FuelStationSettingsService::class)->putTenant($values, $this->w['actor'], 'إعداد اختبار العكس');
    }

    private function fill(int $milliliters = 3_000_000): FuelTankerFill
    {
        $n = ++$this->seq;
        $response = $this->withToken($this->w['owner_token'])->postJson(self::FILLS, [
            'fuel_station_id' => $this->w['station']->id, 'fuel_nozzle_id' => $this->nozzle->id, 'fuel_tanker_owner_id' => $this->owner->id,
            'voucher_number' => "RV-{$n}", 'quantity_milliliters' => $milliliters, 'idempotency_key' => "fill-rv-{$n}",
        ])->assertCreated();

        return FuelTankerFill::query()->findOrFail($response->json('data.id'));
    }

    /** @param array<string,mixed> $body */
    private function postFill(FuelTankerFill $fill, ?string $token = null, array $body = []): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($token ?? $this->w['owner_token'])->postJson(self::FILLS . "/{$fill->id}/inventory-posting", $body);
    }

    /** @param array<string,mixed> $body */
    private function reverseFill(FuelTankerFill $fill, ?string $token = null, array $body = ['reason' => 'سند أُدخل بالخطأ']): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($token ?? $this->w['owner_token'])->postJson(self::FILLS . "/{$fill->id}/inventory-reversal", $body);
    }

    /** @param list<string> $permissions @return array{user: User, token: string} */
    private function userWith(array $permissions, ?array $stations = null): array
    {
        app(TenantContext::class)->set($this->w['tenant_id']);
        $slug = 'rv-role-' . (++$this->seq);
        Role::create(['tenant_id' => $this->w['tenant_id'], 'slug' => $slug, 'name' => $slug, 'permissions' => $permissions, 'is_system' => false]);
        $user = User::create(['tenant_id' => $this->w['tenant_id'], 'name' => $slug, 'email' => "{$slug}@rv.test", 'password' => 'password123', 'role' => $slug]);
        if ($stations !== null) {
            $user->forceFill(['fuel_station_scope' => User::FUEL_SCOPE_ASSIGNED])->save();
            $user->fuelStations()->sync($stations);
        }

        return ['user' => $user, 'token' => $user->createToken('api')->plainTextToken];
    }

    /** @return array<string,int> بصمة كل ما يجب ألا يتغيّر عند الرفض/الفشل. */
    private function state(): array
    {
        $t = $this->w['tenant_id'];

        return $this->openingEffects($this->w) + [
            'postings' => (int) DB::table('fuel_tanker_fill_inventory_postings')->where('tenant_id', $t)->count(),
            'reversed_postings' => (int) DB::table('fuel_tanker_fill_inventory_postings')->where('tenant_id', $t)->where('status', 'reversed')->count(),
            'payments' => (int) DB::table('payments')->where('tenant_id', $t)->count(),
            'journal_lines' => (int) DB::table('journal_lines')->where('tenant_id', $t)->count(),
            'pool_quantity' => (int) DB::table('fuel_inventory_cost_states')->where('tenant_id', $t)->sum('quantity_milliliters'),
            'pool_value' => (int) DB::table('fuel_inventory_cost_states')->where('tenant_id', $t)->sum('cost_pool_minor'),
            'posted_fills' => (int) DB::table('fuel_tanker_fills')->where('tenant_id', $t)->where('inventory_status', '<>', 'pending_integration')->count(),
        ];
    }

    private function stock91(): int
    {
        return (int) DB::table('product_warehouse_stock')->where('warehouse_id', $this->w['warehouse']->id)->where('product_id', $this->w['fuels']['91']->product_id)->value('quantity');
    }

    /** @return array<string,mixed> */
    private function pool91(): array
    {
        return (array) DB::table('fuel_inventory_cost_states')->where('warehouse_id', $this->w['warehouse']->id)->where('fuel_product_id', $this->w['fuels']['91']->id)->first();
    }

    /** @return list<string> */
    private function attemptOutcomes(FuelTankerFill $fill, ?string $operation = null): array
    {
        return DB::table('fuel_tanker_fill_inventory_posting_attempts')->where('fuel_tanker_fill_id', $fill->id)
            ->when($operation !== null, fn ($q) => $q->where('operation_type', $operation))->orderBy('created_at')->get()
            ->map(fn ($r) => $r->operation_type . '/' . $r->outcome . ':' . ($r->reason_code ?? ''))->all();
    }

    /**
     * يحاكي توريد وقود (استلاماً بتكلفة مختلفة) يغيّر متوسط المجمّع بين الترحيل والعكس: حركة وارد بوسم المجمّع + قيد (مدين المخزون / دائن حساب التوريد) + حركة تكلفة مربوطة بالقيد.
     * بيانات اختبارية فقط عبر الأوّليات القائمة (لا كتابة مباشرة في الأستاذ).
     */
    private function receiveAt(int $milliliters, int $totalCostMinor): void
    {
        app(TenantContext::class)->set($this->w['tenant_id']);
        $product = \App\Models\Product::query()->findOrFail($this->w['fuels']['91']->product_id);
        $inventory = Account::query()->where('code', '1140')->firstOrFail();
        $payable = Account::query()->where('code', '9999')->first()
            ?? Account::create(['code' => '9999', 'name' => 'مورد وقود (اختبار)', 'type' => 'liability', 'normal_balance' => 'credit', 'is_group' => false, 'is_active' => true]);
        DB::transaction(function () use ($product, $inventory, $payable, $milliliters, $totalCostMinor) {
            $movement = app(InventoryService::class)->applyReceipt($product, $milliliters, intdiv($totalCostMinor, $milliliters), [
                'warehouse_id' => $this->w['warehouse']->id, 'date' => now()->toDateString(), 'notes' => 'استلام اختباري', InventoryService::FUEL_POOL_META => true,
            ], $totalCostMinor);
            $entry = app(LedgerService::class)->post([
                ['account_id' => $inventory->id, 'debit' => $totalCostMinor, 'branch_id' => $this->w['station']->branch_id],
                ['account_id' => $payable->id, 'credit' => $totalCostMinor, 'branch_id' => $this->w['station']->branch_id],
            ], ['entry_date' => now()->toDateString(), 'description' => 'توريد اختباري']);
            app(FuelCostBasisService::class)->recordReceipt($this->w['fuels']['91'], $this->w['warehouse'], $movement, $milliliters, $totalCostMinor, $entry);
        });
    }

    /** @return array<string,mixed> */
    private function reconcile(): array
    {
        app(TenantContext::class)->set($this->w['tenant_id']);

        return app(FuelInventoryLedgerReconciliation::class)->reconcile([$this->w['warehouse']->id], [$this->w['station']->branch_id], true, true);
    }

    /** @return list<string> رموز نتائج المطابقة بمستوى خطأ. */
    private function reconcileErrors(): array
    {
        return collect($this->reconcile()['findings'])->filter(fn ($f) => ($f['severity'] ?? 'error') === 'error')->pluck('code')->unique()->values()->all();
    }
}
