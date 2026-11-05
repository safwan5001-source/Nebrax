<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\FuelNozzle;
use App\Models\FuelProduct;
use App\Models\FuelPump;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Payment;
use App\Models\Product;
use App\Models\Role;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\User;
use App\Services\EntitlementGrantService;
use App\Services\FuelStationSettingsService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * UI-2 (#2007) — عقد كتابات تطبيق البائع كما هي في الخادم فعلاً (لا كما نتمنى).
 *
 * يثبت ما بُنيت عليه واجهة «محطات أَوْج | تشغيل المحطات»: الصلاحيات الدقيقة لكل كتابة، السياسات الافتراضية (float صريح + قراءات خزانات
 * مطلوبة)، سلوك idempotency الحرفي — بما فيه الثغرات الموثَّقة (R2/R3/R4 في AWJ_FUEL_STATIONS_UI_2_WRITE_CONTRACT_AUDIT.md) التي تحييدها
 * الواجهة — وغياب أي أثر مالي أو مخزني من هذه المسارات. أي تغيير في هذه السلوكيات يجب أن يُراجَع مع الواجهة قبل أن ينكسر العقد.
 */
class FuelShiftSellerContractTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const BASE = '/api/fuel-stations/shifts';

    /** @test */
    public function the_seller_flow_works_end_to_end_under_the_default_policy_and_leaves_no_accounting_or_stock_trace(): void
    {
        $f = $this->fixture();
        $seller = $this->sellerToken($f);

        // السياسات الافتراضية التي تبني عليها الواجهة (تُقرأ بـ fuel_stations.view فقط).
        $this->withToken($seller)->getJson("/api/fuel-stations/stations/{$f['station']->id}/settings")->assertOk()
            ->assertJsonPath('data.shift_opening_cash_float_required', true)
            ->assertJsonPath('data.shift_opening_tank_reading_required', true)
            ->assertJsonPath('data.shift_closing_tank_reading_required', true)
            ->assertJsonPath('data.shift_opening_meter_reading_required', true)
            ->assertJsonPath('data.shift_closing_meter_reading_required', true)
            ->assertJsonPath('data.shift_allow_close_with_pending_cash_variance', true);

        // عهدة الافتتاح صريحة (ولو صفراً) — لا افتراض.
        $this->withToken($seller)->postJson(self::BASE . '/open', ['fuel_station_id' => $f['station']->id, 'idempotency_key' => 'k-no-float'])
            ->assertStatus(422)->assertJsonPath('message', 'سياسة المحطة تتطلب تسجيل float نقدي افتتاحي صريح، ولو كانت قيمته صفراً.');

        $id = $this->withToken($seller)->postJson(self::BASE . '/open', ['fuel_station_id' => $f['station']->id, 'opening_float_minor' => 50000, 'idempotency_key' => 'k-open-1'])
            ->assertCreated()->assertJsonPath('data.status', 'open')->assertJsonPath('data.opening_float_minor', 50000)->json('data.id');

        // الإسناد: مرة واحدة، والتكرار 422 «مسند بالفعل» (الواجهة تعدّه نجاحاً).
        $this->withToken($seller)->postJson(self::BASE . "/{$id}/staff", ['user_id' => $f['seller']->id, 'role' => 'attendant'])->assertCreated();
        $this->withToken($seller)->postJson(self::BASE . "/{$id}/staff", ['user_id' => $f['seller']->id, 'role' => 'attendant'])
            ->assertStatus(422)->assertJsonPath('message', 'العامل مسند بالفعل إلى هذا الشفت.');

        // الإغلاق قبل القراءات المطلوبة (افتراضياً: عدادات + خزانات، بداية ونهاية) مرفوض.
        $this->withToken($seller)->postJson(self::BASE . "/{$id}/close", ['counted_cash_minor' => 50000])->assertStatus(422);

        $this->meter($seller, $id, $f['nozzle']->id, 'opening', 100000, 'e-m-o');
        $this->tank($seller, $id, $f['tank']->id, 'opening', 900000, 'e-t-o');
        $this->meter($seller, $id, $f['nozzle']->id, 'closing', 160250, 'e-m-c');
        $this->tank($seller, $id, $f['tank']->id, 'closing', 840000, 'e-t-c');

        // الحركات النقدية التشغيلية — المتوقع = عهدة + إيداع − سحب − مصروف (لا مبيعات).
        $this->cash($seller, $id, 'cash_in', 2000, 'فكة', 'c-1');
        $this->cash($seller, $id, 'cash_out', 500, 'إيداع بنكي', 'c-2');
        $this->cash($seller, $id, 'expense', 300, 'مياه', 'c-3');

        $this->withToken($seller)->postJson(self::BASE . "/{$id}/close", ['counted_cash_minor' => 51000, 'closing_note' => 'تسليم'])
            ->assertOk()
            ->assertJsonPath('data.status', 'closed')
            ->assertJsonPath('data.expected_operational_cash_minor', 51200)   // 50000 + 2000 − 500 − 300
            ->assertJsonPath('data.cash_variance_minor', -200)
            ->assertJsonPath('data.cash_variance.status', 'pending_review')
            ->assertJsonPath('data.operational_meter_milliliters', 60250);

        // الإغلاق الثاني محروس بالحالة (الواجهة تتحقق بإعادة القراءة لا بإعادة الإرسال).
        $this->withToken($seller)->postJson(self::BASE . "/{$id}/close", ['counted_cash_minor' => 51000])
            ->assertStatus(422)->assertJsonPath('message', 'الشفت ليس مفتوحاً ولا يقبل حركة تشغيلية جديدة.');

        // البائع لا يعتمد ولا يراجع الفرق ولا يصحّح.
        $this->withToken($seller)->postJson(self::BASE . "/{$id}/approve", ['note' => 'x'])->assertForbidden();
        $this->withToken($seller)->postJson(self::BASE . "/{$id}/cash-variance/review", ['note' => 'x'])->assertForbidden();
        $this->withToken($seller)->postJson(self::BASE . "/{$id}/corrections", ['target_type' => 'cash_count', 'reason' => 'x', 'proposed' => ['a' => 1]])->assertForbidden();

        // لا قيد، لا حركة مخزون، لا دفعة، لا فاتورة — كل ما سبق تشغيلي بحت.
        $this->assertSame(0, JournalEntry::count());
        $this->assertSame(0, StockMovement::count());
        $this->assertSame(0, Payment::count());
        $this->assertSame(0, Invoice::count());
    }

    /** @test */
    public function each_write_needs_its_own_permission_on_the_server(): void
    {
        $f = $this->fixture();
        $viewer = $this->tokenFor($f, 'fuel-view-only', ['fuel_stations.view', 'fuel.shift.view']);
        $noCash = $this->tokenFor($f, 'fuel-no-cash', ['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.open', 'fuel.shift.close']);
        $noClose = $this->tokenFor($f, 'fuel-no-close', ['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.open', 'fuel.shift.cash_count']);

        $this->withToken($viewer)->getJson(self::BASE)->assertOk();
        $this->withToken($viewer)->postJson(self::BASE . '/open', ['fuel_station_id' => $f['station']->id, 'opening_float_minor' => 0, 'idempotency_key' => 'v-1'])->assertForbidden();

        $id = $this->withToken($noClose)->postJson(self::BASE . '/open', ['fuel_station_id' => $f['station']->id, 'opening_float_minor' => 0, 'idempotency_key' => 'o-1'])->assertCreated()->json('data.id');
        $this->withToken($viewer)->postJson(self::BASE . "/{$id}/meter-readings", ['fuel_nozzle_id' => $f['nozzle']->id, 'reading_stage' => 'opening', 'meter_milliliters' => 1, 'evidence_key' => 'v-m'])->assertForbidden();
        $this->withToken($viewer)->postJson(self::BASE . "/{$id}/tank-readings", ['fuel_tank_id' => $f['tank']->id, 'reading_stage' => 'opening', 'quantity_milliliters' => 1, 'evidence_key' => 'v-t'])->assertForbidden();
        $this->withToken($viewer)->postJson(self::BASE . "/{$id}/cash-movements", ['type' => 'cash_in', 'amount_minor' => 1, 'reason' => 'x', 'idempotency_key' => 'v-c'])->assertForbidden();
        $this->withToken($noCash)->postJson(self::BASE . "/{$id}/cash-movements", ['type' => 'cash_in', 'amount_minor' => 1, 'reason' => 'x', 'idempotency_key' => 'n-c'])->assertForbidden();
        $this->withToken($noCash)->postJson(self::BASE . "/{$id}/close", ['counted_cash_minor' => 0])->assertForbidden();   // close + cash_count معاً
        $this->withToken($noClose)->postJson(self::BASE . "/{$id}/close", ['counted_cash_minor' => 0])->assertForbidden();
        $this->assertSame('open', $this->withToken($viewer)->getJson(self::BASE . "/{$id}")->json('data.status'));
    }

    /** @test */
    public function reading_evidence_is_idempotent_by_key_and_one_reading_exists_per_nozzle_and_stage(): void
    {
        $f = $this->fixture();
        $seller = $this->sellerToken($f);
        $id = $this->open($seller, $f, 'k-ev');

        $this->meter($seller, $id, $f['nozzle']->id, 'opening', 100000, 'same-key');
        // نفس المفتاح + نفس القيمة ⇒ يُعاد السجل (إعادة آمنة بعد انقطاع) — والمجموع سجل واحد.
        $this->meter($seller, $id, $f['nozzle']->id, 'opening', 100000, 'same-key');
        $this->assertCount(1, $this->withToken($seller)->getJson(self::BASE . "/{$id}")->json('data.meter_readings'));
        // نفس المفتاح + قيمة مختلفة ⇒ مرفوض.
        $this->withToken($seller)->postJson(self::BASE . "/{$id}/meter-readings", ['fuel_nozzle_id' => $f['nozzle']->id, 'reading_stage' => 'opening', 'meter_milliliters' => 100001, 'evidence_key' => 'same-key'])
            ->assertStatus(422)->assertJsonPath('message', 'مفتاح دليل قراءة العداد استُخدم سابقاً لسجل مختلف.');
        // مفتاح آخر لنفس الفوهة/المرحلة ⇒ «مسجلة بالفعل» — القراءة لا تُعدَّل ولا تُستبدل.
        $this->withToken($seller)->postJson(self::BASE . "/{$id}/meter-readings", ['fuel_nozzle_id' => $f['nozzle']->id, 'reading_stage' => 'opening', 'meter_milliliters' => 100000, 'evidence_key' => 'other-key'])
            ->assertStatus(422)->assertJsonPath('message', 'قراءة العداد لهذه الفوهة والمرحلة مسجلة بالفعل ولا يعاد استخدامها.');
    }

    /** @test */
    public function documented_risk_R2_a_closing_reading_below_opening_is_accepted_when_recorded_but_makes_the_shift_impossible_to_close(): void
    {
        $f = $this->fixture();
        $seller = $this->sellerToken($f);
        $this->relaxPolicy($f, ['shift_opening_tank_reading_required' => false, 'shift_closing_tank_reading_required' => false]);
        $id = $this->open($seller, $f, 'k-r2');
        $this->meter($seller, $id, $f['nozzle']->id, 'opening', 100000, 'r2-o');
        $this->meter($seller, $id, $f['nozzle']->id, 'closing', 50000, 'r2-c'); // يُقبل عند التسجيل!

        $this->withToken($seller)->postJson(self::BASE . "/{$id}/close", ['counted_cash_minor' => 0])
            ->assertStatus(422)->assertJsonPath('message', 'قراءة إغلاق العداد لا تكون أقل من قراءة الفتح لنفس الفوهة.');
        // ولا مخرج: لا يمكن استبدال القراءة ولا تعديلها على وردية مفتوحة ⇒ تحجبها الواجهة قبل الإرسال.
        $this->withToken($seller)->postJson(self::BASE . "/{$id}/meter-readings", ['fuel_nozzle_id' => $f['nozzle']->id, 'reading_stage' => 'closing', 'meter_milliliters' => 150000, 'evidence_key' => 'r2-fix'])->assertStatus(422);
        $this->assertSame('open', $this->withToken($seller)->getJson(self::BASE . "/{$id}")->json('data.status'));
    }

    /** @test */
    public function documented_risk_R3_an_open_key_replays_the_first_shift_even_after_it_was_closed_and_whatever_the_payload(): void
    {
        $f = $this->fixture();
        $seller = $this->sellerToken($f);
        $this->relaxPolicy($f, [
            'shift_opening_meter_reading_required' => false, 'shift_closing_meter_reading_required' => false,
            'shift_opening_tank_reading_required' => false, 'shift_closing_tank_reading_required' => false,
        ]);
        $first = $this->withToken($seller)->postJson(self::BASE . '/open', ['fuel_station_id' => $f['station']->id, 'opening_float_minor' => 100, 'idempotency_key' => 'reused'])->assertCreated()->json('data.id');
        $this->withToken($seller)->postJson(self::BASE . "/{$first}/close", ['counted_cash_minor' => 100])->assertOk();

        $replay = $this->withToken($seller)->postJson(self::BASE . '/open', ['fuel_station_id' => $f['station']->id, 'opening_float_minor' => 999999, 'idempotency_key' => 'reused'])->assertCreated();
        $replay->assertJsonPath('data.id', $first)->assertJsonPath('data.status', 'closed')->assertJsonPath('data.opening_float_minor', 100);
        // ⇒ الواجهة: مفتاح جديد لكل نية، وتتحقق أن الردّ open وبعهدة الافتتاح المرسلة قبل إعلان النجاح.
        $this->assertSame(1, \App\Models\FuelShift::count());
    }

    /** @test */
    public function documented_risk_R4_a_cash_movement_key_replays_the_first_effect_even_when_the_amount_differs(): void
    {
        $f = $this->fixture();
        $seller = $this->sellerToken($f);
        $id = $this->open($seller, $f, 'k-r4');
        $this->cash($seller, $id, 'cash_in', 1000, 'أولى', 'dup');
        $replay = $this->cash($seller, $id, 'cash_in', 777777, 'مختلفة', 'dup');
        $this->assertCount(1, $replay['cash_movements']);
        $this->assertSame(1000, $replay['cash_movements'][0]['amount_minor']);
        // وسحب/مصروف يفوق المتوقع مرفوض.
        $this->withToken($seller)->postJson(self::BASE . "/{$id}/cash-movements", ['type' => 'cash_out', 'amount_minor' => 1000000, 'reason' => 'كبير', 'idempotency_key' => 'big'])
            ->assertStatus(422)->assertJsonPath('message', 'لا يمكن إخراج أو تسجيل مصروف نقدي يتجاوز الرصيد التشغيلي المتوقع للشفت.');
    }

    /** @test */
    public function a_second_open_shift_for_the_station_is_refused_and_a_foreign_branch_context_is_refused(): void
    {
        $f = $this->fixture();
        $seller = $this->sellerToken($f);
        $this->open($seller, $f, 'k-first');
        $this->withToken($seller)->postJson(self::BASE . '/open', ['fuel_station_id' => $f['station']->id, 'opening_float_minor' => 0, 'idempotency_key' => 'k-second'])
            ->assertStatus(422)->assertJsonPath('message', 'توجد وردية وقود مفتوحة للمحطة؛ يجب إغلاقها أو تصحيحها عبر المسار المدقق أولاً.');

        $other = Branch::create(['tenant_id' => $f['tenant_id'], 'name' => 'فرع آخر', 'code' => 'B2', 'is_main' => false]);
        $this->withToken($seller)->withHeader('X-Branch-Id', $other->id)
            ->postJson(self::BASE . '/open', ['fuel_station_id' => $f['station']->id, 'opening_float_minor' => 0, 'idempotency_key' => 'k-other-branch'])
            ->assertStatus(422)->assertJsonPath('message', 'محطة الشفت لا تخص الفرع النشط.');
    }

    /** @return array<string,mixed> */
    private function meter(string $token, string $shift, string $nozzle, string $stage, int $ml, string $key): array
    {
        return $this->withToken($token)->postJson(self::BASE . "/{$shift}/meter-readings", ['fuel_nozzle_id' => $nozzle, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => $key])->assertCreated()->json('data');
    }

    /** @return array<string,mixed> */
    private function tank(string $token, string $shift, string $tank, string $stage, int $ml, string $key): array
    {
        return $this->withToken($token)->postJson(self::BASE . "/{$shift}/tank-readings", ['fuel_tank_id' => $tank, 'reading_stage' => $stage, 'reading_type' => 'physical', 'quantity_milliliters' => $ml, 'evidence_key' => $key])->assertCreated()->json('data');
    }

    /** @return array<string,mixed> */
    private function cash(string $token, string $shift, string $type, int $amount, string $reason, string $key): array
    {
        return $this->withToken($token)->postJson(self::BASE . "/{$shift}/cash-movements", ['type' => $type, 'amount_minor' => $amount, 'reason' => $reason, 'idempotency_key' => $key])->assertCreated()->json('data');
    }

    private function open(string $token, array $f, string $key): string
    {
        return $this->withToken($token)->postJson(self::BASE . '/open', ['fuel_station_id' => $f['station']->id, 'opening_float_minor' => 50000, 'idempotency_key' => $key])->assertCreated()->json('data.id');
    }

    /** @param array<string,bool> $values */
    private function relaxPolicy(array $f, array $values): void
    {
        app(FuelStationSettingsService::class)->putStationValues($f['station'], $values, $f['owner'], 'تهيئة اختبار عقد البائع');
    }

    private function sellerToken(array &$f): string
    {
        $token = $this->tokenFor($f, 'fuel-seller', ['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.open', 'fuel.shift.cash_count', 'fuel.shift.close'], $user);
        $f['seller'] = $user;

        return $token;
    }

    /** @param array<int,string> $permissions */
    private function tokenFor(array $f, string $slug, array $permissions, ?User &$user = null): string
    {
        $role = Role::create(['tenant_id' => $f['tenant_id'], 'slug' => $slug, 'name' => $slug, 'permissions' => $permissions, 'is_system' => false]);
        $user = User::create(['tenant_id' => $f['tenant_id'], 'name' => $slug, 'email' => "{$slug}@example.test", 'password' => 'password123', 'role' => $role->slug]);

        return $user->createToken('api')->plainTextToken;
    }

    /** @return array{tenant_id:string,owner:User,station:FuelStation,tank:FuelTank,nozzle:FuelNozzle} */
    private function fixture(): array
    {
        $auth = $this->registerTenant('fuel-seller-contract', 'owner-fuel-seller@example.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $branch = Branch::where('tenant_id', $auth['tenant_id'])->sole();
        app(BranchContext::class)->set($branch->id);
        $owner = User::where('tenant_id', $auth['tenant_id'])->where('role', 'owner')->sole();
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($auth['tenant_id']), 'fuel_stations.core', EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL,
            CarbonImmutable::now('UTC'), grantReasonCode: 'test_ui2_seller_contract', reason: 'اختبار عقد UI-2.',
        );
        $product = Product::create(['tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'sku' => 'FUEL-SC-P', 'name' => 'منتج وقود', 'unit' => 'mL', 'track_inventory' => true]);
        $fuelProduct = FuelProduct::create(['tenant_id' => $auth['tenant_id'], 'product_id' => $product->id, 'code' => 'FUEL-SC', 'name' => 'وقود اختبار']);
        $station = FuelStation::create(['tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'code' => 'ST-SC', 'name' => 'محطة اختبار']);
        $tank = FuelTank::create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuelProduct->id,
            'code' => 'TN-SC', 'name' => 'خزان اختبار', 'capacity_milliliters' => 1000000, 'safe_capacity_milliliters' => 900000,
        ]);
        $pump = FuelPump::create(['tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'pump_number' => 'P-SC']);
        $nozzle = FuelNozzle::create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_pump_id' => $pump->id,
            'fuel_tank_id' => $tank->id, 'fuel_product_id' => $fuelProduct->id, 'nozzle_number' => 'N-SC',
        ]);

        return ['tenant_id' => $auth['tenant_id'], 'owner' => $owner, 'station' => $station, 'tank' => $tank, 'nozzle' => $nozzle];
    }
}
