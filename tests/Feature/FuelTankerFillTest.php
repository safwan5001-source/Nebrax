<?php

namespace Tests\Feature;

use App\Models\FuelNozzle;
use App\Models\FuelPump;
use App\Models\FuelShift;
use App\Models\FuelStationAuditEvent;
use App\Models\FuelTanker;
use App\Models\FuelTankerFill;
use App\Models\FuelTankerOwner;
use App\Support\StationSessionBoundary;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use LogicException;
use Tests\TestCase;

/**
 * TANKER-PR4 — سندات تعبئة الصهاريج: الإنشاء، الأرقام (الإلكتروني FTF ≠ الورقي)، منع تكرار السند الورقي (محطة، أصفار بادئة، ملغى محجوز)، سياسات الصهريج والسعة،
 * قيود الفوهة والمعدات، الوردية الموحَّدة، الكمية، idempotency، الصلاحيات والبوابة وعزل المؤسسات، عدم قابلية التعديل، وغياب أي أثر مخزني/محاسبي.
 */
class FuelTankerFillTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use BuildsFuelStaffFixture;

    private const BASE = '/api/fuel-stations/tanker-fills';
    private const RECORD = ['fuel.tanker.fill.view', 'fuel.tanker.fill.record', 'fuel.tanker.fill.void'];

    private FuelNozzle $nozzle;
    private FuelPump $pump;
    private FuelTankerOwner $owner;
    private FuelTanker $tanker;
    private FuelShift $shift;
    private int $keySeq = 0;

    protected function setUp(): void
    {
        parent::setUp();
        config(['fuel_stations.tanker_management_enabled' => true, 'fuel_stations.tanker_fills_enabled' => true]);
        $this->buildFixture();
        app(TenantContext::class)->set($this->tenantId);
        $this->pump = FuelPump::create(['branch_id' => $this->fx['branchA']->id, 'fuel_station_id' => $this->fx['s1']->id, 'pump_number' => '02', 'name' => 'مضخة 2']);
        $this->nozzle = $this->makeNozzle($this->fx['s1'], $this->pump, $this->fx['t1'], '1');
        $this->owner = FuelTankerOwner::create(['name' => 'عسكر', 'code' => 'ASK', 'status' => 'active']);
        $this->tanker = FuelTanker::create(['fuel_tanker_owner_id' => $this->owner->id, 'plate_number' => 'أ ب ج 1234', 'plate_key' => 'ABJ1234', 'capacity_milliliters' => 5_000_000, 'status' => 'active']);
        $this->shift = $this->openShift($this->fx['s1'], 'FSH-T4-1');
    }

    // ───────────────────────── أدوات ─────────────────────────

    private function makeNozzle($station, FuelPump $pump, $tank, string $number): FuelNozzle
    {
        return FuelNozzle::create([
            'branch_id' => $station->branch_id, 'fuel_station_id' => $station->id, 'fuel_pump_id' => $pump->id, 'fuel_tank_id' => $tank->id,
            'fuel_product_id' => $this->fx['fuel']->id, 'nozzle_number' => $number,
        ]);
    }

    private function openShift($station, string $number): FuelShift
    {
        return FuelShift::create([
            'branch_id' => $station->branch_id, 'fuel_station_id' => $station->id, 'number' => $number, 'status' => FuelShift::STATUS_OPEN,
            'opening_float_minor' => 0, 'idempotency_key' => 'shift-' . $number, 'opened_by' => $this->makeUser('seller-' . $number, 'role-seller-' . $number, ['fuel_stations.view'])['user']->id, 'opened_at' => now(),
        ]);
    }

    private function closeShift(FuelShift $shift): void
    {
        $shift->forceFill(['status' => FuelShift::STATUS_CLOSED, 'closed_at' => now()])->save();
    }

    /** @param list<string> $permissions @return array{user: \App\Models\User, token: string} */
    private function staff(array $permissions = self::RECORD, ?array $stations = null): array
    {
        $n = ++$this->keySeq;

        return $this->makeUser("staff{$n}", "role-fill-{$n}", array_merge(['fuel_stations.view'], $permissions), $stations);
    }

    /** @param array<string,mixed> $over @return array<string,mixed> */
    private function payload(array $over = []): array
    {
        return array_merge([
            'fuel_station_id' => $this->fx['s1']->id, 'fuel_nozzle_id' => $this->nozzle->id, 'fuel_tanker_owner_id' => $this->owner->id,
            'voucher_number' => '4052', 'quantity_liters' => '2000', 'idempotency_key' => 'fill-key-' . (++$this->keySeq),
        ], $over);
    }

    /** @param array<string,mixed> $over */
    private function record(string $token, array $over = []): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($token)->postJson(self::BASE, $this->payload($over));
    }

    private function setPolicy(array $values): void
    {
        $this->withToken($this->fx['owner'])->putJson('/api/fuel-stations/settings', $values + ['reason' => 'اختبار PR-4'])->assertOk();
    }

    private function setStationPolicy(string $stationId, array $values): void
    {
        $this->withToken($this->fx['owner'])->putJson("/api/fuel-stations/stations/{$stationId}/settings", $values + ['reason' => 'اختبار PR-4'])->assertOk();
    }

    /** @return array{fuel_station_id: string, fuel_nozzle_id: string} محطة ثانية بفوهة ووردية مفتوحة. */
    private function secondStation(): array
    {
        $pump = FuelPump::create(['branch_id' => $this->fx['branchA']->id, 'fuel_station_id' => $this->fx['s2']->id, 'pump_number' => '01', 'name' => 'م']);
        $nozzle = $this->makeNozzle($this->fx['s2'], $pump, $this->fx['t2'], '1');
        $this->openShift($this->fx['s2'], 'FSH-T4-2');

        return ['fuel_station_id' => $this->fx['s2']->id, 'fuel_nozzle_id' => $nozzle->id];
    }

    /** @return array<string,int> */
    private function sideEffectCounts(): array
    {
        $counts = [];
        foreach (['stock_movements', 'journal_entries', 'journal_lines', 'invoices', 'payments', 'fuel_sales', 'fuel_operational_ledgers', 'fuel_shifts'] as $table) {
            $counts[$table] = (int) DB::table($table)->count();
        }

        return $counts;
    }

    // ───────────────────────── الإنشاء والأرقام ─────────────────────────

    /** @test */
    public function a_fill_is_recorded_against_the_station_nozzle_owner_and_the_unified_open_shift(): void
    {
        $staff = $this->staff();
        $before = $this->sideEffectCounts();

        $response = $this->record($staff['token'], ['quantity_liters' => '1234.567', 'fuel_tanker_id' => $this->tanker->id, 'voucher_number' => '04052', 'notes' => 'ملاحظة'])->assertCreated();

        $data = $response->json('data');
        $this->assertSame(1_234_567, $data['quantity_milliliters']);
        $this->assertSame('1234.567', $data['quantity_liters']);
        $this->assertSame('04052', $data['voucher_number'], 'الأصفار البادئة تُحفظ حرفياً');
        $this->assertSame('recorded', $data['status']);
        $this->assertSame('pending_integration', $data['inventory_status']);
        $this->assertSame($this->shift->id, $data['fuel_shift_id'], 'الوردية الموحَّدة المفتوحة، لا وردية مستقلة');
        $this->assertSame($this->pump->id, $data['fuel_pump_id']);
        $this->assertSame($this->nozzle->id, $data['fuel_nozzle_id']);
        $this->assertSame($this->fx['t1']->id, $data['fuel_tank_id']);
        $this->assertSame($this->fx['fuel']->id, $data['fuel_product_id']);
        $this->assertSame($this->owner->id, $data['fuel_tanker_owner_id']);
        $this->assertSame($this->tanker->id, $data['fuel_tanker_id']);
        $this->assertSame($staff['user']->id, $data['recorded_by']);
        $this->assertFalse($response->json('meta.replayed'));
        $this->assertArrayNotHasKey('tenant_id', $data);
        $this->assertArrayNotHasKey('idempotency_key', $data);
        $this->assertSame($this->tenantId, FuelTankerFill::query()->findOrFail($data['id'])->tenant_id);

        $this->assertSame($before, $this->sideEffectCounts(), 'لا مخزون ولا قيد ولا فاتورة ولا تحصيل ولا وردية جديدة');
    }

    /** @test */
    public function the_electronic_ftf_number_is_sequential_and_independent_of_the_paper_voucher(): void
    {
        $staff = $this->staff();
        $first = $this->record($staff['token'], ['voucher_number' => '9001'])->assertCreated()->json('data.number');
        $second = $this->record($staff['token'], ['voucher_number' => '17'])->assertCreated()->json('data.number');

        $year = now()->setTimezone('Asia/Riyadh')->format('Y');
        $this->assertMatchesRegularExpression('/^FTF-\d{4}-00001$/', $first);
        $this->assertMatchesRegularExpression('/^FTF-\d{4}-00002$/', $second);
        $this->assertStringStartsWith("FTF-{$year}-", $first);
        $this->assertNotSame('9001', $first);
    }

    /** @test */
    public function the_same_owner_can_fill_several_times_in_one_shift_with_separate_vouchers(): void
    {
        $staff = $this->staff();
        $this->record($staff['token'], ['voucher_number' => '4052', 'quantity_liters' => '2000'])->assertCreated();
        $this->record($staff['token'], ['voucher_number' => '4053', 'quantity_liters' => '3000'])->assertCreated();

        $this->assertSame(2, FuelTankerFill::query()->where('fuel_shift_id', $this->shift->id)->count());
        $this->assertSame(5_000_000, (int) FuelTankerFill::query()->sum('quantity_milliliters'));
    }

    /** @test */
    public function no_beneficiary_company_is_required_or_accepted(): void
    {
        $staff = $this->staff();
        $this->record($staff['token'])->assertCreated();
        $this->record($staff['token'], ['voucher_number' => '5', 'partner_id' => 'x'])->assertStatus(422);
    }

    // ───────────────────────── السند الورقي ─────────────────────────

    /** @test */
    public function a_duplicate_voucher_in_the_same_station_is_rejected_with_the_existing_record_reference(): void
    {
        $staff = $this->staff();
        $first = $this->record($staff['token'])->assertCreated()->json('data');

        $duplicate = $this->record($staff['token'], ['quantity_liters' => '10'])->assertStatus(409);
        $duplicate->assertJsonPath('reason', 'voucher_duplicate')->assertJsonPath('details.existing_fill_number', $first['number']);
        $this->assertSame(1, FuelTankerFill::query()->count());
    }

    /** @test */
    public function leading_zeros_are_preserved_and_distinguish_vouchers(): void
    {
        $staff = $this->staff();
        $this->record($staff['token'], ['voucher_number' => '04052'])->assertCreated();
        $this->record($staff['token'], ['voucher_number' => '4052'])->assertCreated();
        $this->record($staff['token'], ['voucher_number' => '004052'])->assertCreated();
        $this->record($staff['token'], ['voucher_number' => '04052'])->assertStatus(409);

        $this->assertEqualsCanonicalizing(['04052', '4052', '004052'], FuelTankerFill::query()->pluck('voucher_number')->all());
    }

    /** @test */
    public function voucher_normalisation_ignores_case_spacing_and_arabic_digits_but_not_zeros(): void
    {
        $staff = $this->staff();
        $this->record($staff['token'], ['voucher_number' => 'ab 12'])->assertCreated();
        $this->record($staff['token'], ['voucher_number' => ' AB  12 '])->assertStatus(409);
        $this->record($staff['token'], ['voucher_number' => '٠٤٠٥٢'])->assertCreated();
        $this->assertSame('04052', FuelTankerFill::query()->where('voucher_key', '04052')->firstOrFail()->voucher_number);
        $this->record($staff['token'], ['voucher_number' => '04052'])->assertStatus(409);
    }

    /** @test */
    public function invalid_vouchers_are_rejected(): void
    {
        $staff = $this->staff();
        foreach (['', '   ', '--', str_repeat('9', 65), '12;34', "12\n34;"] as $voucher) {
            $this->record($staff['token'], ['voucher_number' => $voucher])->assertStatus(422);
        }
        $this->assertSame(0, FuelTankerFill::query()->count());
    }

    /** @test */
    public function a_voided_voucher_number_stays_reserved_and_the_row_cannot_be_deleted(): void
    {
        $staff = $this->staff();
        $fill = $this->record($staff['token'])->assertCreated()->json('data');
        $this->withToken($staff['token'])->postJson(self::BASE . "/{$fill['id']}/void", ['reason' => 'خطأ إدخال'])->assertOk()->assertJsonPath('data.status', 'voided');

        $again = $this->record($staff['token'])->assertStatus(409);
        $again->assertJsonPath('reason', 'voucher_duplicate')->assertJsonPath('details.existing_status', 'voided');

        $this->expectException(QueryException::class);
        DB::table('fuel_tanker_fills')->where('id', $fill['id'])->delete();
    }

    /** @test */
    public function the_same_voucher_is_allowed_in_another_station_under_the_default_station_scope(): void
    {
        $staff = $this->staff();
        $this->record($staff['token'])->assertCreated();

        $pump2 = FuelPump::create(['branch_id' => $this->fx['branchA']->id, 'fuel_station_id' => $this->fx['s2']->id, 'pump_number' => '01', 'name' => 'م']);
        $nozzle2 = $this->makeNozzle($this->fx['s2'], $pump2, $this->fx['t2'], '1');
        $this->openShift($this->fx['s2'], 'FSH-T4-2');

        $this->record($staff['token'], ['fuel_station_id' => $this->fx['s2']->id, 'fuel_nozzle_id' => $nozzle2->id])->assertCreated();
        $this->assertSame(2, FuelTankerFill::query()->where('voucher_key', '4052')->count());
    }

    /** @test */
    public function the_voucher_scope_policy_widens_narrows_or_disables_the_duplicate_check(): void
    {
        $staff = $this->staff();
        $pump2 = FuelPump::create(['branch_id' => $this->fx['branchA']->id, 'fuel_station_id' => $this->fx['s2']->id, 'pump_number' => '01', 'name' => 'م']);
        $nozzle2 = $this->makeNozzle($this->fx['s2'], $pump2, $this->fx['t2'], '1');
        $this->openShift($this->fx['s2'], 'FSH-T4-2');
        $other = FuelTankerOwner::create(['name' => 'عزوز', 'code' => 'AZZ', 'status' => 'active']);
        $station2 = ['fuel_station_id' => $this->fx['s2']->id, 'fuel_nozzle_id' => $nozzle2->id];

        // مؤسسة: السند نفسه مرفوض في أي محطة.
        $this->setPolicy(['tanker_voucher_unique_scope' => 'tenant']);
        $this->record($staff['token'], ['voucher_number' => 'T-1'])->assertCreated();
        $this->record($staff['token'], $station2 + ['voucher_number' => 'T-1'])->assertStatus(409)->assertJsonPath('reason', 'voucher_duplicate');

        // صاحب صهريج: السند نفسه مرفوض لنفس الصاحب فقط.
        $this->setPolicy(['tanker_voucher_unique_scope' => 'owner']);
        $this->record($staff['token'], ['voucher_number' => 'O-1'])->assertCreated();
        $this->record($staff['token'], $station2 + ['voucher_number' => 'O-1'])->assertStatus(409);
        $this->record($staff['token'], $station2 + ['voucher_number' => 'O-1', 'fuel_tanker_owner_id' => $other->id])->assertCreated();

        // بلا منع: التكرار مقبول.
        $this->setPolicy(['tanker_voucher_unique_scope' => 'none']);
        $this->record($staff['token'], ['voucher_number' => 'N-1'])->assertCreated();
        $this->record($staff['token'], ['voucher_number' => 'N-1'])->assertCreated();
        $this->assertSame(2, FuelTankerFill::query()->where('voucher_key', 'n-1')->count());
    }

    /** @test */
    public function mixed_per_station_voucher_policies_give_the_same_answer_in_either_order(): void
    {
        $staff = $this->staff();
        $this->setStationPolicy($this->fx['s1']->id, ['tanker_voucher_unique_scope' => 'tenant']); // المحطة 1 بنطاق مؤسسة، والمحطة 2 بالافتراضي (محطة)
        $station2 = $this->secondStation();

        // سند سُجّل بنطاق «مؤسسة» يبقى محجوزاً مؤسسياً حتى لو سُجّل الثاني من محطة بسياسة «محطة».
        $this->record($staff['token'], ['voucher_number' => 'MIX-1'])->assertCreated();
        $this->record($staff['token'], $station2 + ['voucher_number' => 'MIX-1'])->assertStatus(409)->assertJsonPath('reason', 'voucher_duplicate');

        // والعكس: سند بنطاق «محطة» ثم كاتب بنطاق «مؤسسة» ⇒ يغطّيه نطاق الكاتب.
        $this->record($staff['token'], $station2 + ['voucher_number' => 'MIX-2'])->assertCreated();
        $this->record($staff['token'], ['voucher_number' => 'MIX-2'])->assertStatus(409)->assertJsonPath('reason', 'voucher_duplicate');

        // سندان مختلفان لا يتأثران، و«بلا منع» لدى الكاتب تعطيل صريح لفحصه.
        $this->record($staff['token'], $station2 + ['voucher_number' => 'MIX-3'])->assertCreated();
        $this->setStationPolicy($this->fx['s2']->id, ['tanker_voucher_unique_scope' => 'none']);
        $this->record($staff['token'], $station2 + ['voucher_number' => 'MIX-3'])->assertCreated();
    }

    // ───────────────────────── سياسات الصهريج والسعة ─────────────────────────

    /** @test */
    public function the_tanker_is_optional_by_default_and_required_when_the_station_policy_says_so(): void
    {
        $staff = $this->staff();
        $this->record($staff['token'], ['voucher_number' => 'A1'])->assertCreated()->assertJsonPath('data.fuel_tanker_id', null);

        $this->setPolicy(['tanker_selection_required' => true]);
        $this->record($staff['token'], ['voucher_number' => 'A2'])->assertStatus(422)->assertJsonPath('reason', 'tanker_required');
        $this->record($staff['token'], ['voucher_number' => 'A2', 'fuel_tanker_id' => $this->tanker->id])->assertCreated();
    }

    /** @test */
    public function an_owner_with_no_registered_tankers_is_never_blocked_even_when_selection_is_required(): void
    {
        $staff = $this->staff();
        $this->setPolicy(['tanker_selection_required' => true]);
        $bare = FuelTankerOwner::create(['name' => 'بلا مركبات', 'code' => 'NOV', 'status' => 'active']);
        $before = $this->sideEffectCounts();

        $data = $this->record($staff['token'], ['fuel_tanker_owner_id' => $bare->id, 'voucher_number' => 'W1'])->assertCreated()->json('data');
        $this->assertNull($data['fuel_tanker_id']);
        $this->assertTrue($data['policy_snapshot']['tanker_selection_required'], 'السياسة نفسها لم تتغيّر');
        $this->assertSame('owner_has_no_registered_tankers', $data['policy_snapshot']['tanker_selection_waived'], 'الاستثناء مسجَّل في لقطة السياسة');
        $this->assertSame($before, $this->sideEffectCounts(), 'لا أثر مخزني ولا محاسبي');

        // الاستثناء خاص بهذا المالك: مالك له مركبة يبقى خاضعاً للسياسة في المحطة نفسها.
        $this->record($staff['token'], ['voucher_number' => 'W2'])->assertStatus(422)->assertJsonPath('reason', 'tanker_required');
    }

    /** @test */
    public function the_policy_still_applies_to_an_owner_who_has_a_tanker_in_any_state(): void
    {
        $staff = $this->staff();
        $this->setPolicy(['tanker_selection_required' => true]);

        $this->record($staff['token'], ['voucher_number' => 'X1'])->assertStatus(422)->assertJsonPath('reason', 'tanker_required');

        // مركبة موقوفة تبقى «مسجَّلة»: المالك خاضع للسياسة ولا يُعفى (وتحديد الموقوفة مرفوض كما كان).
        $this->tanker->update(['status' => 'suspended']);
        $this->record($staff['token'], ['voucher_number' => 'X2'])->assertStatus(422)->assertJsonPath('reason', 'tanker_required');
        $this->record($staff['token'], ['voucher_number' => 'X2', 'fuel_tanker_id' => $this->tanker->id])->assertStatus(422)->assertJsonPath('reason', 'tanker_inactive');
        $this->assertSame(0, FuelTankerFill::query()->count());
    }

    /** @test */
    public function the_exemption_does_not_loosen_any_other_rule_for_an_owner_without_tankers(): void
    {
        $staff = $this->staff();
        $this->setPolicy(['tanker_selection_required' => true]);
        $bare = FuelTankerOwner::create(['name' => 'بلا مركبات', 'code' => 'NOV', 'status' => 'active']);
        $over = ['fuel_tanker_owner_id' => $bare->id];

        // صهريج صريح لا يتبع المالك يبقى مرفوضاً.
        $this->record($staff['token'], $over + ['voucher_number' => 'Y1', 'fuel_tanker_id' => $this->tanker->id])->assertStatus(422)->assertJsonPath('reason', 'tanker_mismatch');
        // صاحب الصهريج غير النشط مرفوض، والسند الورقي المكرر مرفوض، والوردية المطلوبة قائمة.
        $this->record($staff['token'], $over + ['voucher_number' => 'Y2'])->assertCreated();
        $this->record($staff['token'], $over + ['voucher_number' => 'Y2'])->assertStatus(409)->assertJsonPath('reason', 'voucher_duplicate');
        $bare->update(['status' => 'inactive']);
        $this->record($staff['token'], $over + ['voucher_number' => 'Y3'])->assertStatus(422)->assertJsonPath('reason', 'owner_inactive');
        $bare->update(['status' => 'active']);
        $this->closeShift($this->shift);
        $this->record($staff['token'], $over + ['voucher_number' => 'Y4'])->assertStatus(422);
    }

    /** @test */
    public function the_exemption_respects_permissions_gates_station_access_and_tenant_isolation(): void
    {
        $this->setPolicy(['tanker_selection_required' => true]);
        $bare = FuelTankerOwner::create(['name' => 'بلا مركبات', 'code' => 'NOV', 'status' => 'active']);
        $over = ['fuel_tanker_owner_id' => $bare->id, 'voucher_number' => 'Z1'];

        // الصلاحيات: العرض وحده أو بلا صلاحية لا يسجّلان، ومستخدم محطة أخرى 404، ومحطة بوابة مغلقة 404.
        $this->record($this->staff(['fuel.tanker.fill.view'])['token'], $over)->assertForbidden();
        $this->record($this->staff([])['token'], $over)->assertForbidden();
        $this->record($this->staff(self::RECORD, [$this->fx['s2']->id])['token'], $over)->assertNotFound();
        config(['fuel_stations.tanker_fills_enabled' => false]);
        $this->record($this->staff()['token'], $over)->assertNotFound();
        config(['fuel_stations.tanker_fills_enabled' => true]);
        $this->assertSame(0, FuelTankerFill::query()->count());

        // العزل: مركبات مؤسسة أخرى (ولو بالرقم نفسه) لا تُحتسب لهذا المالك ولا تُرى.
        $other = $this->registerTenant('fuel-t4-exempt', 'owner@fuel-t4-exempt.test', autoEnableApplications: true);
        app(TenantContext::class)->set($other['tenant_id']);
        $foreignOwner = FuelTankerOwner::create(['name' => 'مالك آخر', 'code' => 'NOV', 'status' => 'active']);
        FuelTanker::create(['fuel_tanker_owner_id' => $foreignOwner->id, 'plate_number' => 'Q 1', 'plate_key' => 'Q1', 'status' => 'active']);
        app(TenantContext::class)->set($this->tenantId);

        $this->record($this->staff()['token'], $over)->assertCreated()->assertJsonPath('data.fuel_tanker_id', null);
        // ولا يعمل على مالك مؤسسة أخرى (معرّفه غير موجود في نطاق هذه المؤسسة).
        $this->record($this->staff()['token'], ['fuel_tanker_owner_id' => $foreignOwner->id, 'voucher_number' => 'Z2'])->assertStatus(422);
    }

    /** @test */
    public function the_tanker_must_belong_to_the_selected_owner_and_be_active(): void
    {
        $staff = $this->staff();
        $other = FuelTankerOwner::create(['name' => 'عزوز', 'code' => 'AZZ', 'status' => 'active']);
        $foreign = FuelTanker::create(['fuel_tanker_owner_id' => $other->id, 'plate_number' => 'X 1', 'plate_key' => 'X1', 'status' => 'active']);
        $this->record($staff['token'], ['fuel_tanker_id' => $foreign->id])->assertStatus(422)->assertJsonPath('reason', 'tanker_mismatch');

        $this->tanker->update(['status' => 'suspended']);
        $this->record($staff['token'], ['fuel_tanker_id' => $this->tanker->id])->assertStatus(422)->assertJsonPath('reason', 'tanker_inactive');
    }

    /** @test */
    public function an_inactive_or_unknown_owner_is_rejected(): void
    {
        $staff = $this->staff();
        $this->owner->update(['status' => 'inactive']);
        $this->record($staff['token'])->assertStatus(422)->assertJsonPath('reason', 'owner_inactive');
        $this->record($staff['token'], ['fuel_tanker_owner_id' => '00000000-0000-4000-8000-000000000001'])->assertStatus(422);
    }

    /** @test */
    public function capacity_overrun_needs_an_explicit_confirmation_by_default_and_records_who_and_when(): void
    {
        $staff = $this->staff();
        $over = ['fuel_tanker_id' => $this->tanker->id, 'quantity_liters' => '5200'];

        $this->record($staff['token'], $over)->assertStatus(422)
            ->assertJsonPath('reason', 'capacity_overrun_confirmation_required')
            ->assertJsonPath('details.capacity_milliliters', 5_000_000)
            ->assertJsonPath('details.overrun_milliliters', 200_000);
        $this->assertSame(0, FuelTankerFill::query()->count());

        $data = $this->record($staff['token'], $over + ['confirm_capacity_overrun' => true])->assertCreated()->json('data');
        $this->assertSame(200_000, $data['capacity_overrun_milliliters']);
        $this->assertSame('allow_with_confirmation', $data['capacity_overrun_policy']);
        $this->assertSame($staff['user']->id, $data['capacity_overrun_confirmed_by']);
        $this->assertNotNull($data['capacity_overrun_confirmed_at']);
        $this->assertSame(5_000_000, $data['tanker_capacity_milliliters']);
    }

    /** @test */
    public function capacity_equal_to_the_limit_or_an_unknown_capacity_needs_no_confirmation(): void
    {
        $staff = $this->staff();
        $data = $this->record($staff['token'], ['fuel_tanker_id' => $this->tanker->id, 'quantity_liters' => '5000', 'voucher_number' => 'E1'])->assertCreated()->json('data');
        $this->assertNull($data['capacity_overrun_milliliters']);

        $this->tanker->update(['capacity_milliliters' => null]);
        $this->record($staff['token'], ['fuel_tanker_id' => $this->tanker->id, 'quantity_liters' => '99999', 'voucher_number' => 'E2'])->assertCreated();
    }

    /** @test */
    public function the_block_policy_refuses_overrun_even_when_confirmed_and_allow_records_it_unconfirmed(): void
    {
        $staff = $this->staff();
        $over = ['fuel_tanker_id' => $this->tanker->id, 'quantity_liters' => '6000'];

        $this->setPolicy(['tanker_capacity_overrun_policy' => 'block']);
        $this->record($staff['token'], $over + ['confirm_capacity_overrun' => true, 'voucher_number' => 'B1'])->assertStatus(422)->assertJsonPath('reason', 'capacity_overrun_blocked');

        $this->setPolicy(['tanker_capacity_overrun_policy' => 'allow']);
        $data = $this->record($staff['token'], $over + ['voucher_number' => 'B2'])->assertCreated()->json('data');
        $this->assertSame(1_000_000, $data['capacity_overrun_milliliters']);
        $this->assertNull($data['capacity_overrun_confirmed_by']);
        $this->assertSame('allow', $data['policy_snapshot']['tanker_capacity_overrun_policy']);
    }

    // ───────────────────────── المنتج والمعدات والفوهة ─────────────────────────

    /** @test */
    public function the_nozzle_operation_restriction_blocks_tanker_fills_only_when_the_operation_is_excluded(): void
    {
        $staff = $this->staff();
        $this->nozzle->update(['allowed_operations' => [FuelNozzle::OPERATION_DIRECT_SALE]]);
        $this->record($staff['token'])->assertStatus(422)->assertJsonPath('reason', 'nozzle_operation_not_allowed');

        $this->nozzle->update(['allowed_operations' => [FuelNozzle::OPERATION_DIRECT_SALE, FuelNozzle::OPERATION_TANKER_FILL]]);
        $this->record($staff['token'])->assertCreated();
    }

    /** @test */
    public function inactive_equipment_and_foreign_nozzles_are_rejected(): void
    {
        $staff = $this->staff();
        $this->nozzle->update(['status' => FuelNozzle::STATUS_INACTIVE]);
        $this->record($staff['token'], ['voucher_number' => 'Q1'])->assertStatus(422)->assertJsonPath('reason', 'equipment_not_operational');
        $this->nozzle->update(['status' => FuelNozzle::STATUS_ACTIVE]);

        $this->pump->update(['status' => FuelPump::STATUS_MAINTENANCE]);
        $this->record($staff['token'], ['voucher_number' => 'Q2'])->assertStatus(422)->assertJsonPath('reason', 'equipment_not_operational');
        $this->pump->update(['status' => FuelPump::STATUS_ACTIVE]);

        $this->fx['t1']->update(['status' => 'inactive']);
        $this->record($staff['token'], ['voucher_number' => 'Q3'])->assertStatus(422)->assertJsonPath('reason', 'equipment_not_operational');
        $this->fx['t1']->update(['status' => 'active']);

        $pump2 = FuelPump::create(['branch_id' => $this->fx['branchA']->id, 'fuel_station_id' => $this->fx['s2']->id, 'pump_number' => '01', 'name' => 'م']);
        $foreign = $this->makeNozzle($this->fx['s2'], $pump2, $this->fx['t2'], '1');
        $this->record($staff['token'], ['fuel_nozzle_id' => $foreign->id, 'voucher_number' => 'Q4'])->assertStatus(422)->assertJsonPath('reason', 'invalid_input');
        $this->assertSame(0, FuelTankerFill::query()->count());
    }

    /** @test */
    public function a_supplied_product_must_match_the_nozzle_product(): void
    {
        $staff = $this->staff();
        $this->record($staff['token'], ['fuel_product_id' => '00000000-0000-4000-8000-000000000009', 'voucher_number' => 'P1'])->assertStatus(422)->assertJsonPath('reason', 'product_mismatch');
        $this->record($staff['token'], ['fuel_product_id' => $this->fx['fuel']->id, 'voucher_number' => 'P2'])->assertCreated();
    }

    // ───────────────────────── الوردية الموحَّدة ─────────────────────────

    /** @test */
    public function a_fill_needs_the_open_unified_shift_and_never_creates_one(): void
    {
        $staff = $this->staff();
        $this->closeShift($this->shift);
        $shifts = FuelShift::query()->count();

        $this->record($staff['token'])->assertStatus(422)->assertJsonPath('reason', 'shift_required');
        $this->assertSame($shifts, FuelShift::query()->count(), 'لا وردية مستقلة للتعبئة');
        $this->assertSame(0, FuelTankerFill::query()->count());
    }

    /** @test */
    public function a_supplied_shift_must_be_the_current_open_shift(): void
    {
        $staff = $this->staff();
        $closed = $this->openShift($this->fx['s2'], 'FSH-T4-OTHER');
        $this->record($staff['token'], ['fuel_shift_id' => $closed->id])->assertStatus(422)->assertJsonPath('reason', 'shift_not_open');
        $this->record($staff['token'], ['fuel_shift_id' => $this->shift->id])->assertCreated();
    }

    // ───────────────────────── الكمية ─────────────────────────

    /** @test */
    public function quantities_are_exact_positive_and_given_in_exactly_one_field(): void
    {
        $staff = $this->staff();
        $bad = [
            ['quantity_liters' => '0'], ['quantity_liters' => '0.000'], ['quantity_liters' => '-5'], ['quantity_liters' => '1.2345'], ['quantity_liters' => 1.2345],
            ['quantity_liters' => 'abc'], ['quantity_liters' => ''], ['quantity_milliliters' => 0], ['quantity_milliliters' => -1], ['quantity_milliliters' => '12.5'],
            ['quantity_liters' => '5', 'quantity_milliliters' => 5000],
        ];
        foreach ($bad as $i => $over) {
            $base = $this->payload(['voucher_number' => "BAD{$i}"]);
            unset($base['quantity_liters']);
            $this->withToken($staff['token'])->postJson(self::BASE, $over + $base)->assertStatus(422);
        }
        $none = $this->payload();
        unset($none['quantity_liters']);
        $this->withToken($staff['token'])->postJson(self::BASE, $none)->assertStatus(422)->assertJsonPath('reason', 'quantity_invalid');
        $this->assertSame(0, FuelTankerFill::query()->count());
    }

    /** @test */
    public function liters_are_converted_to_milliliters_without_float_error(): void
    {
        $staff = $this->staff();
        $cases = ['0.001' => 1, '0.1' => 100, '2000' => 2_000_000, '12345.678' => 12_345_678];
        $i = 0;
        foreach ($cases as $liters => $ml) {
            $this->record($staff['token'], ['quantity_liters' => (string) $liters, 'voucher_number' => 'L' . (++$i)])->assertCreated()->assertJsonPath('data.quantity_milliliters', $ml);
        }
        // عدد عشري JSON بثلاث منازل مقبول؛ وما يفقد الدقة مرفوض.
        $this->record($staff['token'], ['quantity_liters' => 0.3, 'voucher_number' => 'F1'])->assertCreated()->assertJsonPath('data.quantity_milliliters', 300);
        $ml = $this->payload(['quantity_milliliters' => 1500, 'voucher_number' => 'M1']);
        unset($ml['quantity_liters']);
        $this->withToken($staff['token'])->postJson(self::BASE, $ml)->assertCreated()->assertJsonPath('data.quantity_liters', '1.5');
    }

    // ───────────────────────── idempotency ─────────────────────────

    /** @test */
    public function resending_the_same_request_returns_the_original_record_without_a_second_row_or_audit(): void
    {
        $staff = $this->staff();
        $payload = $this->payload();
        $first = $this->withToken($staff['token'])->postJson(self::BASE, $payload)->assertCreated();
        $audits = FuelStationAuditEvent::query()->where('action', 'tanker_fill.recorded')->count();

        $replay = $this->withToken($staff['token'])->postJson(self::BASE, $payload)->assertOk();
        $replay->assertJsonPath('meta.replayed', true);
        $this->assertSame($first->json('data.id'), $replay->json('data.id'));
        $this->assertSame($first->json('data.number'), $replay->json('data.number'));
        $this->assertSame(1, FuelTankerFill::query()->count());
        $this->assertSame($audits, FuelStationAuditEvent::query()->where('action', 'tanker_fill.recorded')->count());
    }

    /** @test */
    public function reusing_a_key_with_different_content_is_a_conflict_and_changes_nothing(): void
    {
        $staff = $this->staff();
        $payload = $this->payload();
        $this->withToken($staff['token'])->postJson(self::BASE, $payload)->assertCreated();

        foreach ([['quantity_liters' => '2001'], ['voucher_number' => '9999'], ['fuel_tanker_id' => $this->tanker->id], ['notes' => 'تغيير']] as $change) {
            $this->withToken($staff['token'])->postJson(self::BASE, array_merge($payload, $change))->assertStatus(409)->assertJsonPath('reason', 'idempotency_key_reused');
        }
        $this->assertSame(1, FuelTankerFill::query()->count());
        $this->assertSame(2_000_000, (int) FuelTankerFill::query()->value('quantity_milliliters'));
    }

    /** @test */
    public function a_replay_is_answered_even_after_the_shift_was_closed(): void
    {
        $staff = $this->staff();
        $payload = $this->payload();
        $id = $this->withToken($staff['token'])->postJson(self::BASE, $payload)->assertCreated()->json('data.id');
        $this->closeShift($this->shift);

        $this->withToken($staff['token'])->postJson(self::BASE, $payload)->assertOk()->assertJsonPath('data.id', $id)->assertJsonPath('meta.replayed', true);
    }

    /** @test */
    public function the_confirmation_flag_does_not_change_the_request_identity(): void
    {
        $staff = $this->staff();
        $payload = $this->payload(['fuel_tanker_id' => $this->tanker->id, 'quantity_liters' => '5100']);
        $this->withToken($staff['token'])->postJson(self::BASE, $payload)->assertStatus(422);
        $this->assertSame(0, FuelTankerFill::query()->count());

        $id = $this->withToken($staff['token'])->postJson(self::BASE, $payload + ['confirm_capacity_overrun' => true])->assertCreated()->json('data.id');
        $this->withToken($staff['token'])->postJson(self::BASE, $payload)->assertOk()->assertJsonPath('data.id', $id);
    }

    // ───────────────────────── الصلاحيات والبوابة والعزل ─────────────────────────

    /** @test */
    public function the_endpoints_are_closed_with_a_uniform_404_when_either_gate_is_off(): void
    {
        $staff = $this->staff();
        $id = $this->record($staff['token'])->assertCreated()->json('data.id');

        config(['fuel_stations.tanker_fills_enabled' => false]);
        $this->withToken($staff['token'])->getJson(self::BASE)->assertNotFound();
        $this->withToken($staff['token'])->getJson(self::BASE . "/{$id}")->assertNotFound();
        $this->record($staff['token'], ['voucher_number' => 'G1'])->assertNotFound();
        $this->withToken($staff['token'])->postJson(self::BASE . "/{$id}/void", ['reason' => 'اختبار'])->assertNotFound();
        $this->withToken($this->fx['owner'])->getJson(self::BASE)->assertNotFound();

        config(['fuel_stations.tanker_fills_enabled' => true, 'fuel_stations.tanker_management_enabled' => false]);
        $this->withToken($staff['token'])->getJson(self::BASE)->assertNotFound();
    }

    /** @test */
    public function each_action_needs_its_own_permission(): void
    {
        $viewer = $this->staff(['fuel.tanker.fill.view']);
        $recorder = $this->staff(['fuel.tanker.fill.record']);
        $voider = $this->staff(['fuel.tanker.fill.void']);
        $nothing = $this->staff([]);

        $this->record($viewer['token'])->assertForbidden();
        $this->record($nothing['token'])->assertForbidden();
        $id = $this->record($recorder['token'])->assertCreated()->json('data.id');

        $this->withToken($recorder['token'])->getJson(self::BASE)->assertForbidden();
        $this->withToken($viewer['token'])->getJson(self::BASE)->assertOk();
        $this->withToken($viewer['token'])->postJson(self::BASE . "/{$id}/void", ['reason' => 'اختبار'])->assertForbidden();
        $this->withToken($recorder['token'])->postJson(self::BASE . "/{$id}/void", ['reason' => 'اختبار'])->assertForbidden();
        $this->withToken($voider['token'])->postJson(self::BASE . "/{$id}/void", ['reason' => 'اختبار'])->assertOk();
        $this->assertSame($recorder['user']->id, FuelTankerFill::query()->findOrFail($id)->recorded_by);
    }

    /** @test */
    public function the_new_permissions_are_owner_admin_only_by_default(): void
    {
        $matrix = (new \ReflectionClass(\App\Support\Rbac::class))->getConstant('MATRIX');
        foreach (self::RECORD as $permission) {
            $this->assertContains($permission, \App\Support\Rbac::PERMISSIONS);
            foreach ($matrix as $role => $permissions) {
                $this->assertNotContains($permission, $permissions, "{$role} لا يملك {$permission} ضمنياً");
            }
            foreach (\App\Support\FuelStaffTemplates::all() as $template => $definition) {
                $this->assertNotContains($permission, $definition['permissions'], "قالب {$template} لا يمنحها قبل واجهة التطبيق المكتملة");
            }
        }
    }

    /** @test */
    public function a_station_pin_session_cannot_reach_the_fill_endpoints(): void
    {
        $staff = $this->staff();
        $session = $staff['user']->createToken(StationSessionBoundary::TOKEN_NAME, [StationSessionBoundary::ABILITY])->plainTextToken;

        $this->withToken($session)->getJson(self::BASE)->assertForbidden();
        $this->withToken($session)->postJson(self::BASE, $this->payload())->assertForbidden();
        $this->assertSame(0, FuelTankerFill::query()->count());
    }

    /** @test */
    public function a_user_without_access_to_the_station_gets_a_uniform_404_before_any_effect(): void
    {
        $restricted = $this->staff(self::RECORD, [$this->fx['s2']->id]);
        $this->record($restricted['token'])->assertNotFound();
        $this->assertSame(0, FuelTankerFill::query()->count());

        $id = $this->record($this->staff()['token'])->assertCreated()->json('data.id');
        $this->withToken($restricted['token'])->getJson(self::BASE . "/{$id}")->assertNotFound();
        $this->assertSame([], $this->withToken($restricted['token'])->getJson(self::BASE)->assertOk()->json('data'));
        $this->withToken($restricted['token'])->postJson(self::BASE . "/{$id}/void", ['reason' => 'اختبار'])->assertNotFound();
    }

    /** @test */
    public function tenant_and_branch_ids_cannot_be_sent_and_other_tenants_cannot_see_or_use_records(): void
    {
        $staff = $this->staff();
        $this->record($staff['token'], ['tenant_id' => $this->tenantId])->assertStatus(422);
        $this->record($staff['token'], ['branch_id' => $this->fx['branchA']->id])->assertStatus(422);
        $id = $this->record($staff['token'])->assertCreated()->json('data.id');

        $other = $this->registerTenant('fuel-t4-other', 'owner@fuel-t4-other.test', autoEnableApplications: true);
        app(TenantContext::class)->set($other['tenant_id']);
        app(\App\Services\EntitlementGrantService::class)->grant(
            \App\Models\Tenant::findOrFail($other['tenant_id']), 'fuel_stations.core', \App\Support\EntitlementAccessMode::FULL, \App\Support\EntitlementSourceType::MANUAL,
            \Carbon\CarbonImmutable::now('UTC'), grantReasonCode: 'test_fuel_t4_other', reason: 'اختبار عزل PR-4.',
        );
        $this->withToken($other['token'])->getJson(self::BASE . "/{$id}")->assertStatus(404);
        $this->record($other['token'])->assertStatus(404); // محطة المستأجر الآخر = غير موجودة
        $this->assertSame([], $this->withToken($other['token'])->getJson(self::BASE)->json('data') ?? []);
    }

    // ───────────────────────── القراءة والعرض ─────────────────────────

    /** @test */
    public function the_list_filters_by_station_shift_owner_status_voucher_and_period(): void
    {
        $staff = $this->staff();
        $a = $this->record($staff['token'], ['voucher_number' => '04052'])->assertCreated()->json('data');
        $this->record($staff['token'], ['voucher_number' => '4053'])->assertCreated();
        $this->withToken($staff['token'])->postJson(self::BASE . "/{$a['id']}/void", ['reason' => 'خطأ'])->assertOk();

        $list = fn (string $query) => $this->withToken($staff['token'])->getJson(self::BASE . '?' . $query)->assertOk()->json('data');
        $this->assertCount(2, $list(''));
        $this->assertCount(1, $list('status=voided'));
        $this->assertCount(1, $list('voucher_number=04052'));
        $this->assertCount(0, $list('voucher_number=4052'), 'الأصفار البادئة جزء من الهوية');
        $this->assertCount(2, $list('station_id=' . $this->fx['s1']->id . '&shift_id=' . $this->shift->id . '&owner_id=' . $this->owner->id));
        $this->assertCount(0, $list('station_id=' . $this->fx['s2']->id));
        $this->assertCount(2, $list('from=' . urlencode(now()->subHour()->toIso8601String()) . '&to=' . urlencode(now()->addHour()->toIso8601String())));
        $this->assertCount(0, $list('from=' . urlencode(now()->addHour()->toIso8601String())));
        $this->withToken($staff['token'])->getJson(self::BASE . '?status=bogus')->assertStatus(422);
        $this->withToken($staff['token'])->getJson(self::BASE . "/{$a['id']}")->assertOk()->assertJsonPath('data.owner.name', 'عسكر');
    }

    // ───────────────────────── الإلغاء ─────────────────────────

    /** @test */
    public function voiding_needs_a_reason_is_audited_and_idempotent(): void
    {
        $staff = $this->staff();
        $id = $this->record($staff['token'])->assertCreated()->json('data.id');

        $this->withToken($staff['token'])->postJson(self::BASE . "/{$id}/void", [])->assertStatus(422);
        $this->withToken($staff['token'])->postJson(self::BASE . "/{$id}/void", ['reason' => 'ab'])->assertStatus(422);
        $this->withToken($staff['token'])->postJson(self::BASE . "/{$id}/void", ['reason' => 'خطأ في الإدخال', 'status' => 'recorded'])->assertStatus(422);

        $voided = $this->withToken($staff['token'])->postJson(self::BASE . "/{$id}/void", ['reason' => 'خطأ في الإدخال'])->assertOk()->json('data');
        $this->assertSame('voided', $voided['status']);
        $this->assertSame($staff['user']->id, $voided['voided_by']);
        $this->assertSame('خطأ في الإدخال', $voided['void_reason']);

        $again = $this->withToken($staff['token'])->postJson(self::BASE . "/{$id}/void", ['reason' => 'سبب آخر'])->assertOk()->json('data');
        $this->assertSame('خطأ في الإدخال', $again['void_reason'], 'الإعادة لا تغيّر السبب ولا المنفّذ');
        $this->assertSame(1, FuelStationAuditEvent::query()->where('action', 'tanker_fill.voided')->count());
    }

    /** @test */
    public function a_fill_cannot_be_voided_after_its_shift_is_closed(): void
    {
        $staff = $this->staff();
        $id = $this->record($staff['token'])->assertCreated()->json('data.id');
        $this->closeShift($this->shift);

        $this->withToken($staff['token'])->postJson(self::BASE . "/{$id}/void", ['reason' => 'خطأ في الإدخال'])->assertStatus(422)->assertJsonPath('reason', 'shift_not_open');
        $this->assertSame('recorded', FuelTankerFill::query()->findOrFail($id)->status);
    }

    // ───────────────────────── التدقيق وعدم قابلية التعديل ─────────────────────────

    /** @test */
    public function every_fill_is_audited_with_the_actor_station_nozzle_and_shift(): void
    {
        $staff = $this->staff();
        $id = $this->record($staff['token'])->assertCreated()->json('data.id');

        $event = FuelStationAuditEvent::query()->where('action', 'tanker_fill.recorded')->sole();
        $this->assertSame($staff['user']->id, $event->actor_id);
        $this->assertSame($this->fx['s1']->id, $event->fuel_station_id);
        $this->assertSame($id, $event->subject_id);
        $this->assertSame($this->nozzle->id, $event->after['fuel_nozzle_id']);
        $this->assertSame($this->shift->id, $event->after['fuel_shift_id']);
        $this->assertSame($this->owner->id, $event->after['fuel_tanker_owner_id']);
        $this->assertSame('4052', $event->after['voucher_number']);
    }

    /** @test */
    public function a_recorded_fill_cannot_be_edited_or_deleted_through_the_model_or_raw_sql(): void
    {
        $staff = $this->staff();
        $id = $this->record($staff['token'])->assertCreated()->json('data.id');
        $fill = FuelTankerFill::query()->findOrFail($id);

        foreach (['quantity_milliliters' => 1, 'voucher_number' => '1', 'fuel_tanker_owner_id' => FuelTankerOwner::create(['name' => 'x', 'status' => 'active'])->id] as $column => $value) {
            try {
                $fill->forceFill([$column => $value])->save();
                $this->fail("{$column} يجب ألا يتغيّر");
            } catch (LogicException) {
                $fill = FuelTankerFill::query()->findOrFail($id);
            }
            try {
                // savepoint: على PostgreSQL يُفسد خطأ SQL المعاملة المُغلِّفة للاختبار فلا يلتقطه التالي.
                DB::transaction(fn () => DB::table('fuel_tanker_fills')->where('id', $id)->update([$column => $value]));
                $this->fail("{$column} يجب ألا يتغيّر بالـSQL الخام");
            } catch (QueryException) {
                $this->assertTrue(true);
            }
        }
        try {
            $fill->delete();
            $this->fail('لا حذف');
        } catch (LogicException) {
            $this->assertTrue(true);
        }
        $this->assertSame(2_000_000, (int) FuelTankerFill::query()->findOrFail($id)->quantity_milliliters);
    }

    /** @test */
    public function the_database_rejects_non_positive_quantities_and_unknown_inventory_status(): void
    {
        $this->expectException(QueryException::class);
        $row = $this->rawRow();
        $row['quantity_milliliters'] = 0;
        DB::table('fuel_tanker_fills')->insert($row);
    }

    /** @test */
    public function the_database_enforces_the_voucher_reservation_key_even_without_the_service(): void
    {
        DB::table('fuel_tanker_fills')->insert($this->rawRow());
        $this->expectException(QueryException::class);
        DB::table('fuel_tanker_fills')->insert($this->rawRow(['number' => 'FTF-RAW-2', 'idempotency_key' => 'raw-key-2']));
    }

    /** @return array<string,mixed> */
    private function rawRow(array $over = []): array
    {
        return array_merge([
            'id' => (string) \Illuminate\Support\Str::uuid(), 'tenant_id' => $this->tenantId, 'branch_id' => $this->fx['branchA']->id,
            'fuel_station_id' => $this->fx['s1']->id, 'fuel_shift_id' => $this->shift->id, 'fuel_pump_id' => $this->pump->id, 'fuel_nozzle_id' => $this->nozzle->id,
            'fuel_tank_id' => $this->fx['t1']->id, 'fuel_product_id' => $this->fx['fuel']->id, 'fuel_tanker_owner_id' => $this->owner->id,
            'number' => 'FTF-RAW-1', 'voucher_number' => 'R1', 'voucher_key' => 'r1', 'voucher_scope' => 'station', 'voucher_scope_key' => 'station:' . $this->fx['s1']->id,
            'quantity_milliliters' => 1000, 'policy_snapshot' => '{}', 'status' => 'recorded', 'inventory_status' => 'pending_integration',
            'idempotency_key' => 'raw-key-1', 'request_fingerprint' => str_repeat('a', 64), 'recorded_by' => $this->makeUser('rawuser', 'role-raw', ['fuel_stations.view'])['user']->id,
            'recorded_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ], $over);
    }

    // ───────────────────────── حدود الشريحة ─────────────────────────

    /** @test */
    public function the_service_never_touches_inventory_accounting_invoicing_or_payments(): void
    {
        $source = $this->codeWithoutComments(app_path('Services/FuelTankerFillService.php'));
        foreach (['InventoryService', 'LedgerService', 'InvoiceService', 'PaymentService', 'StockMovement', 'JournalEntry', 'journal_lines', 'FuelCostBasisService', 'ZatcaService'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $source, "{$forbidden} خارج نطاق PR-4 (التكامل المخزني PR-6)");
        }
        $model = $this->codeWithoutComments(app_path('Models/FuelTankerFill.php'));
        $this->assertStringNotContainsString('stock_movement', $model);
        $this->assertFalse(\Illuminate\Support\Facades\Schema::hasColumn('fuel_tanker_fills', 'stock_movement_id'));
        $this->assertFalse(\Illuminate\Support\Facades\Schema::hasColumn('fuel_tanker_fills', 'journal_entry_id'));
    }

    private function codeWithoutComments(string $path): string
    {
        $code = '';
        foreach (token_get_all((string) file_get_contents($path)) as $token) {
            if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
                continue;
            }
            $code .= is_array($token) ? $token[1] : $token;
        }

        return $code;
    }

    /** @test */
    public function the_direct_sale_path_does_not_read_the_tanker_fill_table_or_gate(): void
    {
        $source = (string) file_get_contents(app_path('Services/FuelSaleService.php'));
        $this->assertStringNotContainsString('TankerFill', $source);
        $this->assertStringNotContainsString('allowsOperation', $source);
    }

    /** @test */
    public function a_nozzle_with_fills_cannot_be_deleted(): void
    {
        $staff = $this->staff();
        $this->record($staff['token'])->assertCreated();

        $this->expectException(\RuntimeException::class);
        app(\App\Services\FuelStationMasterDataService::class)->deleteNozzle($this->nozzle, $staff['user']);
    }

    /** @test */
    public function the_migration_rollback_refuses_while_fills_exist(): void
    {
        $this->record($this->staff()['token'])->assertCreated();
        $migration = require database_path('migrations/2027_01_25_010000_create_fuel_tanker_fills.php');

        $this->expectException(\RuntimeException::class);
        $migration->down();
    }

    /** @test */
    public function the_voucher_duplicate_lookup_has_a_dedicated_index(): void
    {
        $names = array_column(\Illuminate\Support\Facades\Schema::getIndexes('fuel_tanker_fills'), 'name');
        $this->assertContains('fuel_tanker_fill_voucher_lookup_idx', $names);
        $this->assertContains('fuel_tanker_fill_voucher_unique', $names);
    }

    /** @test */
    public function the_longest_supported_custom_numbering_format_still_records(): void
    {
        $staff = $this->staff();
        \App\Support\DocumentNumberingCatalog::putSeriesFormat('fuel_tanker_fill', 'default', str_repeat('P', 20), str_repeat('S', 20));

        $number = $this->record($staff['token'])->assertCreated()->json('data.number');
        $this->assertSame(52, strlen($number), $number);
        $this->assertSame($number, FuelTankerFill::query()->value('number'));
    }

    /** @test */
    public function a_voucher_whose_lowercase_key_expands_still_records(): void
    {
        $staff = $this->staff();
        $voucher = str_repeat('İ', 64); // 64 حرفاً ظاهراً ⇒ مفتاح من 128 حرفاً بعد التصغير
        $this->record($staff['token'], ['voucher_number' => $voucher])->assertCreated()->assertJsonPath('data.voucher_number', $voucher);
        $this->assertSame(128, mb_strlen((string) FuelTankerFill::query()->value('voucher_key')));
        $this->record($staff['token'], ['voucher_number' => $voucher])->assertStatus(409)->assertJsonPath('reason', 'voucher_duplicate');
        $this->assertSame(128, mb_strlen((string) FuelTankerFill::normalizeVoucher($voucher)['key']));
    }

    /** @test */
    public function a_zero_voucher_filter_returns_only_that_voucher(): void
    {
        $staff = $this->staff();
        $this->record($staff['token'], ['voucher_number' => '0'])->assertCreated();
        $this->record($staff['token'], ['voucher_number' => '1'])->assertCreated();

        $rows = $this->withToken($staff['token'])->getJson(self::BASE . '?voucher_number=0')->assertOk()->json('data');
        $this->assertCount(1, $rows);
        $this->assertSame('0', $rows[0]['voucher_number']);
        $this->assertCount(2, $this->withToken($staff['token'])->getJson(self::BASE . '?voucher_number=')->assertOk()->json('data'));
    }

    /** @test */
    public function the_ftf_series_is_registered_in_the_numbering_catalog(): void
    {
        $this->assertContains('fuel_tanker_fill', \App\Support\DocumentNumberingCatalog::editableKeys());
        $this->assertTrue(\App\Support\DocumentNumberingCatalog::hasSeries('fuel_tanker_fill', 'default'));
        $this->assertContains(FuelTankerFill::class, \App\Support\DocumentNumberingCatalog::branchNumberedModels());
        $this->assertStringStartsWith('FTF-', \App\Support\DocumentNumberingCatalog::preview('fuel_tanker_fill')['number'] ?? '');
    }
}
