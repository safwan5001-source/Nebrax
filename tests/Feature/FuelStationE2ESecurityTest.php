<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Employee;
use Illuminate\Support\Facades\Hash;
use App\Models\FuelStation;
use App\Models\Tenant;
use App\Models\User;
use App\Services\EntitlementGrantService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** FUEL-E2E (3/3): الصلاحيات، عزل المستأجرين والفروع والمحطات، الدقة والتقريب. */
class FuelStationE2ESecurityTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use FuelStationE2EWorld;

    private const RECEIPTS = ['shift_expected_cash_basis' => 'receiving_shift_receipts'];

    private function readyShift(string $tag): string
    {
        $shift = $this->openShift('seller', "{$tag}-open");
        $this->meter('seller', $shift, 'opening', 1000000)->assertCreated();
        $this->tankReading('seller', $shift, 'opening', 10000000)->assertCreated();

        return $shift;
    }

    // ═════════ S11 — مصفوفة الصلاحيات (أقل امتياز) ═════════

    /** @test */
    public function s11_permission_matrix_blocks_every_unauthorised_actor_without_side_effects(): void
    {
        $this->buildWorld(self::RECEIPTS);
        $shift = $this->readyShift('s11');
        $sale = $this->finalSale('seller', $shift, 20000, 's11-sale');
        $draftId = $this->draftSale('seller', $shift, 1000, 's11-draft')->json('data.id');
        $this->meter('seller', $shift, 'closing', 1020000)->assertCreated();
        $this->tankReading('seller', $shift, 'closing', 9980000)->assertCreated();
        $this->declareCollection('seller', $shift, 0, 0, 's11-decl')->assertSuccessful();
        $this->closeShift('seller', $shift, 20000, 'E2E_TEST')->assertSuccessful();
        $st = $this->w['station']['id'];
        $n = $this->w['nozzle']['id'];

        $attempts = [
            // [من، طريقة، مسار، جسم]
            ['nobody', 'getJson', '/api/fuel-stations/shifts', []],
            ['nobody', 'getJson', '/api/fuel-stations/sales', []],
            ['nobody', 'postJson', '/api/fuel-stations/shifts/open', ['fuel_station_id' => $st, 'opening_float_minor' => 0, 'idempotency_key' => 'x1']],
            ['viewer', 'postJson', '/api/fuel-stations/shifts/open', ['fuel_station_id' => $st, 'opening_float_minor' => 0, 'idempotency_key' => 'x2']],
            ['viewer', 'postJson', '/api/fuel-stations/sales', ['fuel_station_id' => $st, 'fuel_nozzle_id' => $n, 'quantity_milliliters' => 1000, 'partner_id' => $this->w['customer']->id, 'idempotency_key' => 'x3']],
            ['viewer', 'postJson', "/api/fuel-stations/sales/{$draftId}/finalize", []],
            ['viewer', 'postJson', "/api/fuel-stations/sales/{$sale['id']}/payments", ['payment_method_id' => $this->w['cash']->id, 'amount_minor' => 100, 'idempotency_key' => 'x4']],
            ['viewer', 'postJson', "/api/fuel-stations/shifts/{$shift}/close", ['counted_cash_minor' => 0]],
            ['seller', 'postJson', "/api/fuel-stations/shifts/{$shift}/approve", ['note' => 'x']],
            ['seller', 'postJson', "/api/fuel-stations/shifts/{$shift}/cash-variance/review", ['note' => 'xxx']],
            ['seller', 'postJson', '/api/fuel-stations/prices', ['fuel_station_id' => $st, 'fuel_product_id' => $this->w['fuelProduct']['id'], 'price_per_liter_minor' => 1, 'start_now' => true]],
            ['seller', 'postJson', '/api/fuel-stations/stations', ['branch_id' => $this->w['branch']->id, 'code' => 'E2E_TEST-HACK', 'name' => 'E2E_TEST hack']],
            ['seller', 'postJson', '/api/fuel-stations/tanks', ['fuel_station_id' => $st, 'fuel_product_id' => $this->w['fuelProduct']['id'], 'code' => 'E2E_TEST-H', 'name' => 'h', 'capacity_milliliters' => 10, 'safe_capacity_milliliters' => 9]],
            ['seller', 'putJson', "/api/fuel-stations/stations/{$st}/settings", ['shift_supervisor_approval_required' => false]],
            ['seller', 'putJson', "/api/fuel-stations/nozzles/{$n}", ['status' => 'inactive']],
            ['seller', 'getJson', '/api/fuel-stations/staff', []],
            ['seller', 'postJson', '/api/fuel-stations/opening-balances', ['fuel_station_id' => $st]],
            ['seller', 'postJson', "/api/fuel-stations/shifts/{$shift}/corrections", ['reason' => 'x']],
            ['supervisor', 'postJson', '/api/fuel-stations/shifts/open', ['fuel_station_id' => $st, 'opening_float_minor' => 0, 'idempotency_key' => 'x5']],
            ['supervisor', 'postJson', '/api/fuel-stations/sales', ['fuel_station_id' => $st, 'fuel_nozzle_id' => $n, 'quantity_milliliters' => 1000, 'partner_id' => $this->w['customer']->id, 'idempotency_key' => 'x6']],
            ['supervisor', 'postJson', '/api/fuel-stations/prices', ['fuel_station_id' => $st, 'fuel_product_id' => $this->w['fuelProduct']['id'], 'price_per_liter_minor' => 1, 'start_now' => true]],
        ];
        $before = [DB::table('fuel_sales')->count(), DB::table('payments')->count(), DB::table('fuel_shifts')->count(), DB::table('fuel_station_product_prices')->count()];
        $matrix = [];
        foreach ($attempts as [$who, $method, $path, $body]) {
            $r = $this->as($who)->{$method}($path, $body);
            $matrix[] = [$who, strtoupper(str_replace('Json', '', $method)), str_replace('/api/fuel-stations/', '', $path), $r->status()];
            $this->assertSame(403, $r->status(), "{$who} {$method} {$path} يجب أن يكون 403 (وصل {$r->status()})");
        }
        $this->assertSame($before, [DB::table('fuel_sales')->count(), DB::table('payments')->count(), DB::table('fuel_shifts')->count(), DB::table('fuel_station_product_prices')->count()], 'لا أثر جانبي لمحاولات ممنوعة');

        // الإيجابي المقابل: كل دور يفعل ما يخصه.
        $this->as('viewer')->getJson('/api/fuel-stations/shifts')->assertOk();
        $this->as('supervisor')->postJson("/api/fuel-stations/shifts/{$shift}/collection/review", ["note" => "E2E_TEST"])->assertSuccessful();
        $this->as('supervisor')->postJson("/api/fuel-stations/shifts/{$shift}/approve", ['note' => 'E2E_TEST'])->assertSuccessful();

        // التكلفة مخفية عن البائع ومرئية للمالك (حدود الاطلاع).
        $sellerView = $this->as('seller')->getJson("/api/fuel-stations/sales/{$sale['id']}")->assertOk()['data'];
        $ownerView = $this->as('owner')->getJson("/api/fuel-stations/sales/{$sale['id']}")->assertOk()['data'];
        $this->evidence('S11', ['denied_attempts' => count($attempts), 'all_403' => true, 'seller_sees_cogs' => $sellerView['cogs_minor'] ?? 'hidden', 'owner_sees_cogs' => $ownerView['cogs_minor'] ?? null, 'matrix' => $matrix]);
        $this->assertTrue(! isset($sellerView['cogs_minor']) || $sellerView['cogs_minor'] === null, 'البائع لا يرى تكلفة البضاعة');
    }

    // ═════════ S12 — عزل المستأجرين ═════════

    /** @test */
    public function s12_another_tenants_owner_cannot_see_or_touch_any_station_shift_sale_or_payment(): void
    {
        $this->buildWorld(self::RECEIPTS);
        $shift = $this->readyShift('s12');
        $sale = $this->finalSale('seller', $shift, 20000, 's12-sale');
        $worldA = $this->w;
        $paymentsA = DB::table('payments')->count();

        // مستأجر B كامل الصلاحيات وله وحدة الوقود، لكنه غريب.
        $b = $this->registerTenant('e2e-test-foreign', 'owner@e2e-test-foreign.invalid');
        app(TenantContext::class)->set($b['tenant_id']);
        app(EntitlementGrantService::class)->grant(Tenant::findOrFail($b['tenant_id']), 'fuel_stations.core', EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL, CarbonImmutable::now('UTC'), grantReasonCode: 'e2e_test', reason: 'E2E_TEST foreign tenant.');
        $tb = $b['token'];
        $this->flushHeaders();

        $get = fn (string $p) => $this->withToken($tb)->getJson($p);
        $post = fn (string $p, array $d = []) => $this->withToken($tb)->postJson($p, $d);
        $results = [
            'list_stations' => $get('/api/fuel-stations/stations')->json('data'),
            'list_shifts' => $get('/api/fuel-stations/shifts')->json('data'),
            'list_sales' => $get('/api/fuel-stations/sales')->json('data'),
            'show_station' => $get("/api/fuel-stations/stations/{$worldA['station']['id']}")->status(),
            'show_shift' => $get("/api/fuel-stations/shifts/{$shift}")->status(),
            'show_sale' => $get("/api/fuel-stations/sales/{$sale['id']}")->status(),
            'show_collection' => $get("/api/fuel-stations/shifts/{$shift}/collection")->status(),
            'open_on_foreign_station' => $post('/api/fuel-stations/shifts/open', ['fuel_station_id' => $worldA['station']['id'], 'opening_float_minor' => 0, 'idempotency_key' => 'b-open'])->status(),
            'finalize_foreign_sale' => $post("/api/fuel-stations/sales/{$sale['id']}/finalize")->status(),
            'pay_foreign_sale' => $post("/api/fuel-stations/sales/{$sale['id']}/payments", ['payment_method_id' => $worldA['cash']->id, 'amount_minor' => 100, 'idempotency_key' => 'b-pay'])->status(),
            'meter_on_foreign_shift' => $post("/api/fuel-stations/shifts/{$shift}/meter-readings", ['fuel_nozzle_id' => $worldA['nozzle']['id'], 'reading_stage' => 'closing', 'meter_milliliters' => 1, 'evidence_key' => 'b-m'])->status(),
            'close_foreign_shift' => $post("/api/fuel-stations/shifts/{$shift}/close", ['counted_cash_minor' => 0])->status(),
            'price_on_foreign_station' => $post('/api/fuel-stations/prices', ['fuel_station_id' => $worldA['station']['id'], 'fuel_product_id' => $worldA['fuelProduct']['id'], 'price_per_liter_minor' => 1, 'start_now' => true])->status(),
            'sale_with_foreign_nozzle' => $post('/api/fuel-stations/sales', ['fuel_station_id' => $worldA['station']['id'], 'fuel_nozzle_id' => $worldA['nozzle']['id'], 'quantity_milliliters' => 1000, 'partner_id' => $worldA['customer']->id, 'idempotency_key' => 'b-sale'])->status(),
        ];
        $this->evidence('S12', ['results' => $results]);
        $this->assertSame([], $results['list_stations']);
        $this->assertSame([], $results['list_shifts']);
        $this->assertSame([], $results['list_sales']);
        foreach (array_filter($results, 'is_int') as $k => $status) {
            $this->assertContains($status, [403, 404, 422], "{$k}: وصل {$status}");
            $this->assertNotContains($status, [200, 201], "{$k}: اخترق العزل");
        }
        $this->assertSame($paymentsA, DB::table('payments')->count(), 'لا سند قبض عبر المستأجر الغريب');
        $this->assertSame(1, DB::table('fuel_sales')->count());
        // وردية A ما زالت مفتوحة وسليمة.
        $this->assertSame('open', DB::table('fuel_shifts')->where('id', $shift)->value('status'));
    }

    // ═════════ S13 — عزل الفرع والمحطة ═════════

    /** @test */
    public function s13_branch_scoped_and_station_scoped_users_cannot_operate_outside_their_scope(): void
    {
        $this->buildWorld(self::RECEIPTS);
        $shift = $this->readyShift('s13');
        $sale = $this->finalSale('seller', $shift, 20000, 's13-sale');
        $tenantId = $this->w['tenant_id'];
        app(TenantContext::class)->set($tenantId);

        // مستخدم مقيَّد بفرع آخر.
        $branch2 = Branch::create(['tenant_id' => $tenantId, 'name' => 'E2E_TEST فرع 2', 'code' => 'E2E_TEST-B2']);
        $other = $this->e2eUser('branch2-seller', ['fuel.shift.view', 'fuel.shift.open', 'fuel.shift.cash_count', 'fuel.shift.close', 'fuel.sale.view', 'fuel.sale.create', 'fuel.sale.finalize', 'fuel.sale.collect', 'fuel_stations.view']);
        $other->branches()->attach($branch2->id);
        $this->w['tokens']['branch2'] = $other->createToken('api')->plainTextToken;

        // مستخدم مقيَّد بمحطة أخرى في الفرع نفسه.
        $station2 = FuelStation::create(['tenant_id' => $tenantId, 'branch_id' => $this->w['branch']->id, 'code' => 'E2E_TEST-ST2', 'name' => 'E2E_TEST محطة 2']);
        $scoped = $this->e2eUser('station2-seller', ['fuel.shift.view', 'fuel.shift.open', 'fuel.shift.cash_count', 'fuel.shift.close', 'fuel.sale.view', 'fuel.sale.create', 'fuel.sale.finalize', 'fuel.sale.collect', 'fuel_stations.view']);
        $scoped->forceFill(['fuel_station_scope' => User::FUEL_SCOPE_ASSIGNED])->save();
        $scoped->fuelStations()->attach($station2->id);
        $this->w['tokens']['station2'] = $scoped->createToken('api')->plainTextToken;

        $out = [];
        foreach (['branch2', 'station2'] as $who) {
            $listed = collect($this->as($who)->getJson('/api/fuel-stations/shifts')->assertOk()['data'])->pluck('id')->all();
            $out[$who] = [
                'sees_foreign_shift_in_list' => in_array($shift, $listed, true),
                'show_shift' => $this->as($who)->getJson("/api/fuel-stations/shifts/{$shift}")->status(),
                'open_shift_on_station1' => $this->as($who)->postJson('/api/fuel-stations/shifts/open', ['fuel_station_id' => $this->w['station']['id'], 'opening_float_minor' => 0, 'idempotency_key' => "{$who}-open"])->status(),
                'pay_station1_sale' => $this->as($who)->postJson("/api/fuel-stations/sales/{$sale['id']}/payments", ['payment_method_id' => $this->w['cash']->id, 'amount_minor' => 100, 'idempotency_key' => "{$who}-pay"])->status(),
                'finalize_station1_replay' => $this->as($who)->postJson("/api/fuel-stations/sales/{$sale['id']}/finalize")->status(),
                'close_station1_shift' => $this->as($who)->postJson("/api/fuel-stations/shifts/{$shift}/close", ['counted_cash_minor' => 0])->status(),
                'sales_list_has_station1_sale' => in_array($sale['id'], collect($this->as($who)->getJson('/api/fuel-stations/sales')['data'])->pluck('id')->all(), true),
            ];
        }
        $this->evidence('S13', $out);
        foreach ($out as $who => $o) {
            $this->assertFalse($o['sees_foreign_shift_in_list'], "{$who}: وردية خارج النطاق ظهرت في القائمة");
            $this->assertFalse($o['sales_list_has_station1_sale'], "{$who}: بيع خارج النطاق ظهر في القائمة");
            foreach (['show_shift', 'open_shift_on_station1', 'pay_station1_sale', 'finalize_station1_replay', 'close_station1_shift'] as $k) {
                $this->assertContains($o[$k], [403, 404, 422], "{$who}.{$k} = {$o[$k]}");
            }
        }
        $this->assertSame(0, DB::table('payments')->count(), 'لا سند عبر مستخدم خارج النطاق');
    }

    // ═════════ S14 — الدقة والتقريب ═════════

    /** @test */
    public function s14_fractional_quantities_round_to_the_halala_and_every_total_equals_the_sum_of_its_parts(): void
    {
        $this->buildWorld(self::RECEIPTS);
        $shift = $this->readyShift('s14');
        $rows = [];
        // كميات كسرية بالميلي لتر: غير قابلة للقسمة على السعر (2.30/لتر).
        foreach ([1, 3, 7, 11, 217, 1999, 12345, 33333, 99999] as $i => $ml) {
            $d = $this->draftSale('seller', $shift, $ml, "s14-{$i}");
            $this->assertSame(201, $d->status(), "{$ml} مل: المسودة يجب أن تُنشأ");
            $f = $this->as('seller')->postJson('/api/fuel-stations/sales/' . $d['data']['id'] . '/finalize');
            if ($ml === 1) { // 0.23 هللة تُقرَّب إلى صفر: الرفض متوقع صراحةً (P3 في التقرير: الرسالة غير واضحة).
                $this->assertSame(422, $f->status(), '1 مل: بيع بقيمة صفر يجب أن يُرفض 422');
                $rows[] = ['ml' => $ml, 'finalize_status' => 422, 'msg' => mb_substr((string) $f->json('message'), 0, 100)];
                continue;
            }
            $this->assertSame(200, $f->status(), "{$ml} مل: الإنهاء يجب أن ينجح — " . mb_substr((string) $f->getContent(), 0, 200));
            $s = $f['data'];
            $inv = DB::table('invoices')->where('id', DB::table('fuel_sales')->where('id', $s['id'])->value('invoice_id'))->first();
            $exact = $ml * 230 / 1000; // هللات بدقة كسرية
            $rows[] = ['ml' => $ml, 'exact_minor' => $exact, 'gross_minor' => (int) $s['gross_minor'], 'invoice_total' => (int) $inv->total, 'subtotal' => (int) $inv->subtotal, 'tax' => (int) $inv->tax_amount, 'remainder' => ($s['rounding_remainder_numerator'] ?? null) . '/' . ($s['rounding_remainder_denominator'] ?? null)];
            // الهللة الواحدة: أي سطر يختلف عن القيمة الدقيقة بأكثر من نصف هللة خطأ.
            $this->assertLessThanOrEqual(0.5, abs($exact - (int) $inv->total), "{$ml} مل: الإجمالي {$inv->total} بعيد عن {$exact}");
            $this->assertSame((int) $inv->subtotal + (int) $inv->tax_amount, (int) $inv->total, "{$ml} مل: الإجمالي ≠ صافي + ضريبة");
        }
        $this->evidence('S14', ['rows' => $rows]);
        $this->assertCount(9, $rows, 'كل الكميات التسع خضعت للفحص');
        $this->assertSame(8, DB::table('invoices')->count(), 'ثماني فواتير ناجحة (1 مل مرفوض)');
        // تكامل الدفتر بعد كل الكسور.
        $this->assertBooksIntegrity('s14');
        $b = $this->books();
        $sumInvoices = (int) DB::table('invoices')->sum('total');
        $this->assertSame($sumInvoices, $this->net($b, '1130'), 'ذمم العملاء (غير محصّلة) = مجموع الفواتير');
        $this->assertSame($sumInvoices, ($b['by']['4110']['c'] ?? 0) + ($b['by']['2120']['c'] ?? 0), 'إيراد + ضريبة = مجموع الفواتير');
    }

    // ═════════ S15 — دخول الموظف برقم الموظف + PIN وتشغيل وردية بالجلسة المقيَّدة ═════════

    /** @test */
    public function s15_station_pin_session_runs_a_whole_shift_but_nothing_administrative(): void
    {
        $this->buildWorld(self::RECEIPTS, slug: 'e2e-pin');
        $tenantId = $this->w['tenant_id'];
        app(TenantContext::class)->set($tenantId);
        $emp = Employee::create(['employee_no' => 'E2E_TEST-EMP-1', 'name' => 'E2E_TEST موظف محطة', 'basic_salary' => 0, 'is_active' => true]);
        $this->w['seller']->forceFill(['employee_id' => $emp->id, 'station_pin_hash' => Hash::make('482915'), 'station_pin_set_at' => now()])->save();
        $host = 'http://e2e-pin.awj.app/api/';

        $bad = [];
        foreach (['000000', '482916', 'abcdef', '12345'] as $pin) { $bad[$pin] = $this->postJson($host . 'station/login', ['employee_no' => 'E2E_TEST-EMP-1', 'pin' => $pin])->status(); }
        $bad['unknown_employee'] = $this->postJson($host . 'station/login', ['employee_no' => 'NOPE', 'pin' => '482915'])->status();
        $bad['no_tenant_host'] = $this->postJson('http://localhost/api/station/login', ['employee_no' => 'E2E_TEST-EMP-1', 'pin' => '482915'])->status();
        foreach ($bad as $k => $st) { $this->assertGreaterThanOrEqual(400, $st, "{$k}"); $this->assertLessThan(500, $st, "{$k}"); }

        $login = $this->postJson($host . 'station/login', ['employee_no' => 'E2E_TEST-EMP-1', 'pin' => '482915'])->assertSuccessful();
        $token = $login['token'];
        $h = fn () => $this->flushHeaders()->withToken($token);
        // تشغيل وردية كاملة بالجلسة المقيَّدة.
        $shiftRes = $h()->postJson($host . 'fuel-stations/shifts/open', ['fuel_station_id' => $this->w['station']['id'], 'opening_float_minor' => 20000, 'idempotency_key' => 's15-open'])->assertSuccessful();
        $shift = $shiftRes['data']['id'];
        $h()->postJson($host . "fuel-stations/shifts/{$shift}/meter-readings", ['fuel_nozzle_id' => $this->w['nozzle']['id'], 'reading_stage' => 'opening', 'meter_milliliters' => 1000000, 'evidence_key' => 's15-mo'])->assertCreated();
        $h()->postJson($host . "fuel-stations/shifts/{$shift}/tank-readings", ['fuel_tank_id' => $this->w['tank']['id'], 'reading_stage' => 'opening', 'quantity_milliliters' => 10000000, 'evidence_key' => 's15-to'])->assertCreated();
        $h()->postJson($host . "fuel-stations/shifts/{$shift}/meter-readings", ['fuel_nozzle_id' => $this->w['nozzle']['id'], 'reading_stage' => 'closing', 'meter_milliliters' => 1020000, 'evidence_key' => 's15-mc'])->assertCreated();
        $h()->postJson($host . "fuel-stations/shifts/{$shift}/tank-readings", ['fuel_tank_id' => $this->w['tank']['id'], 'reading_stage' => 'closing', 'quantity_milliliters' => 9980000, 'evidence_key' => 's15-tc'])->assertCreated();
        $h()->postJson($host . "fuel-stations/shifts/{$shift}/collection", ['idempotency_key' => 's15-c', 'base_revision' => 0, 'lines' => [['payment_method_id' => $this->w['cash']->id, 'amount_minor' => 4600], ['payment_method_id' => $this->w['bank']->id, 'amount_minor' => 0]]])->assertSuccessful();
        $closeRes = $h()->postJson($host . "fuel-stations/shifts/{$shift}/close", ['counted_cash_minor' => 24600, 'closing_note' => 'E2E_TEST'])->assertSuccessful();
        $this->assertSame($this->w['seller']->id, $closeRes['data']['opened_by']);

        // ما لا تفتحه جلسة PIN: إدارة، أسعار، مبيعات ERP، فواتير، إعدادات، موظفون، تقارير مالية.
        $deny = [
            'create_station' => $h()->postJson($host . 'fuel-stations/stations', ['branch_id' => $this->w['branch']->id, 'code' => 'E2E_TEST-X', 'name' => 'x'])->status(),
            'set_price' => $h()->postJson($host . 'fuel-stations/prices', ['fuel_station_id' => $this->w['station']['id'], 'fuel_product_id' => $this->w['fuelProduct']['id'], 'price_per_liter_minor' => 1, 'start_now' => true])->status(),
            'create_sale' => $h()->postJson($host . 'fuel-stations/sales', ['fuel_station_id' => $this->w['station']['id'], 'fuel_nozzle_id' => $this->w['nozzle']['id'], 'quantity_milliliters' => 1000, 'partner_id' => $this->w['customer']->id, 'idempotency_key' => 's15-sale'])->status(),
            'list_invoices' => $h()->getJson($host . 'invoices')->status(),
            'list_partners' => $h()->getJson($host . 'partners')->status(),
            'journal_entries' => $h()->getJson($host . 'journal-entries')->status(),
            'staff_list' => $h()->getJson($host . 'fuel-stations/staff')->status(),
            'settings_put' => $h()->putJson($host . "fuel-stations/stations/{$this->w['station']['id']}/settings", ['shift_supervisor_approval_required' => false])->status(),
            'approve_own' => $h()->postJson($host . "fuel-stations/shifts/{$shift}/approve", ['note' => 'x'])->status(),
        ];
        // ملف المستأجر الآخر: نفس الجلسة لا تعمل على مضيف مستأجر ثانٍ.
        $this->evidence('S15', ['bad_logins' => $bad, 'denied' => $deny, 'shift_status' => $closeRes['data']['status']]);
        foreach ($deny as $k => $st) { $this->assertContains($st, [401, 403, 404, 405], "{$k} = {$st}"); }
        $this->assertSame(1, DB::table('fuel_shifts')->where('id', $shift)->where('status', 'closed')->count());
    }
}
