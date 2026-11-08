<?php

namespace Tests\Feature;

use App\Models\FuelShift;
use App\Models\FuelStationAuditEvent;
use App\Models\User;
use App\Services\FuelShiftService;
use App\Services\Reporting\FuelReportExporter;
use App\Support\StationSessionBoundary;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;
use ZipArchive;

/**
 * HORIZON-REPORTS / S2 — تصدير XLSX/CSV من حمولة المحرك نفسها: تطابق الأرقام، حذف الأعمدة المحظورة، حقن الصيغ، التدقيق، النطاق، وجلسة PIN.
 * بيانات اصطناعية: وردية 100 لتر × 2.30 = 230.00 ريال.
 */
class FuelReportExportApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use CapturesThrowable;
    use BuildsFuelCashFixture;

    private const BASE = '/api/fuel-stations/report-center';

    protected function setUp(): void
    {
        parent::setUp();
        config(['fuel_stations.shift_cash_receipts_enabled' => true]);
        $this->f = $this->fixture();
        config(['fuel_stations.shift_cash_receipts_enabled' => false]);
    }

    private function shift(string $key = 'x', int $open = 5_000_000, int $close = 5_100_000): FuelShift
    {
        $shift = $this->open($key);
        $service = app(FuelShiftService::class);
        foreach (['opening' => $open, 'closing' => $close] as $stage => $ml) {
            $service->recordMeter($shift->fresh(), ['fuel_nozzle_id' => $this->f['nozzle']->id, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => "m-{$shift->id}-{$stage}"], $this->f['actor']);
        }

        return $service->close($shift->fresh(), 20000, null, $this->f['actor']);
    }

    private function token(string $who = 'actor'): string
    {
        return $this->f[$who]->createToken('t')->plainTextToken;
    }

    /** @return array<string,string> اسم الورقة ← XML الورقة */
    private function sheets(string $binary): array
    {
        $path = tempnam(sys_get_temp_dir(), 'rpt-test-');
        file_put_contents($path, $binary);
        $zip = new ZipArchive;
        $this->assertTrue($zip->open($path) === true);
        $workbook = $zip->getFromName('xl/workbook.xml');
        preg_match_all('/<sheet name="([^"]+)"/u', $workbook, $names);
        $out = [];
        foreach ($names[1] as $i => $name) {
            $out[html_entity_decode($name)] = $zip->getFromName('xl/worksheets/sheet'.($i + 1).'.xml');
        }
        $zip->close();
        @unlink($path);

        return $out;
    }

    /** @test */
    public function xlsx_export_matches_the_screen_payload_with_a_summary_sheet_and_totals(): void
    {
        $this->shift();
        $res = $this->withToken($this->token())->get(self::BASE.'/sales.daily/export?format=xlsx&lang=en');
        $res->assertOk();
        $this->assertStringContainsString('spreadsheetml.sheet', $res->headers->get('Content-Type'));
        $this->assertStringContainsString('no-store', $res->headers->get('Cache-Control'));
        $this->assertSame('nosniff', $res->headers->get('X-Content-Type-Options'));
        $this->assertStringContainsString('attachment; filename="fuel-sales-daily-', $res->headers->get('Content-Disposition'));

        $sheets = $this->sheets($res->getContent());
        $this->assertSame(['Summary', 'Daily sales'], array_keys($sheets));
        $daily = $sheets['Daily sales'];
        $this->assertStringContainsString('Liters', $daily);
        $this->assertStringContainsString('<v>100.000</v>', $daily); // لتر بدقة ثلاث منازل
        $this->assertStringContainsString('<v>230.00</v>', $daily);  // ريال بدقة منزلتين
        $this->assertStringContainsString('Total', $daily);          // صف الإجمالي
        $this->assertStringContainsString('Daily sales', $sheets['Summary']);

        // الشاشة والملف من حمولة واحدة: القيمة نفسها.
        $screen = $this->withToken($this->token())->getJson(self::BASE.'/sales.daily')->json('data.tables.0.totals');
        $this->assertSame(100_000, $screen['liters']);
        $this->assertSame(23_000, $screen['amount']);
    }

    /** @test */
    public function arabic_headers_are_used_by_default(): void
    {
        $this->shift();
        $sheets = $this->sheets($this->withToken($this->token())->get(self::BASE.'/sales.by_product/export')->getContent());
        $this->assertArrayHasKey('ملخص', $sheets);
        $this->assertStringContainsString('المنتج', $sheets['المبيعات حسب المنتج']);
    }

    /** @test */
    public function csv_export_is_utf8_with_bom_and_a_totals_row(): void
    {
        $this->shift();
        $res = $this->withToken($this->token())->get(self::BASE.'/sales.daily/export?format=csv&lang=en');
        $res->assertOk();
        $body = $res->getContent();
        $this->assertStringStartsWith("\xEF\xBB\xBF", $body);
        $lines = explode("\r\n", trim(substr($body, 3)));
        $this->assertSame('Day,Station,Shifts,Liters,Value,Incomplete shifts', $lines[0]);
        $this->assertStringContainsString(',1,100.000,230.00,0', $lines[1]);
        $this->assertStringStartsWith('Total,', end($lines));
    }

    /** @test */
    public function csv_neutralizes_formula_injection_in_text_cells_but_keeps_negative_numbers_numeric(): void
    {
        $payload = [
            'report' => ['key' => 'x.y', 'title' => ['ar' => 'ت', 'en' => 'T']], 'timezone' => 'Asia/Riyadh', 'period' => null,
            'tables' => [[
                'key' => 't', 'title' => ['ar' => 'ج', 'en' => 'T'],
                'columns' => [
                    ['key' => 'name', 'type' => 'text', 'label' => ['ar' => 'الاسم', 'en' => 'Name']],
                    ['key' => 'v', 'type' => 'money', 'label' => ['ar' => 'قيمة', 'en' => 'Value']],
                ],
                'rows' => [['name' => '=HYPERLINK("http://x")', 'v' => -550], ['name' => '+1', 'v' => 0], ['name' => '@SUM(A1)', 'v' => 1], ['name' => "-2+3", 'v' => 2]],
                'totals' => null,
            ]],
        ];
        $csv = app(FuelReportExporter::class)->csv($payload, 'en');
        $this->assertStringContainsString('"\'=HYPERLINK(""http://x"")",-5.50', $csv); // نص محمي، والرقم السالب يبقى رقماً
        $this->assertStringContainsString("'+1,0.00", $csv);
        $this->assertStringContainsString("'@SUM(A1),0.01", $csv);
        $this->assertStringContainsString("'-2+3,0.02", $csv);
    }

    /** @test */
    public function user_supplied_text_that_looks_like_a_formula_is_neutralized_end_to_end(): void
    {
        $evil = User::create(['tenant_id' => $this->f['tenant_id'], 'name' => '=cmd|calc', 'email' => 'evil@rpt.test', 'password' => 'password123', 'role' => 'owner']);
        app(FuelShiftService::class)->open(['fuel_station_id' => $this->f['station']->id, 'opening_float_minor' => 0, 'idempotency_key' => 'shift-evil'], $evil);

        $csv = $this->withToken($this->token())->get(self::BASE.'/shifts.log/export?format=csv&lang=en')->getContent();
        $this->assertStringContainsString("'=cmd|calc", $csv);
        $this->assertStringNotContainsString(',=cmd|calc', $csv);
    }

    /** @test */
    public function exports_omit_columns_the_user_may_not_see(): void
    {
        $this->shift();
        $seller = $this->withToken($this->token('seller'))->get(self::BASE.'/sales.daily/export?format=csv&lang=en');
        $seller->assertOk();
        $this->assertStringNotContainsString('Value', $seller->getContent());
        $this->assertStringNotContainsString('230.00', $seller->getContent());
        $this->assertStringContainsString('100.000', $seller->getContent());

        $xlsx = $this->sheets($this->withToken($this->token('seller'))->get(self::BASE.'/sales.consolidated/export?lang=en')->getContent());
        $this->assertSame(['Summary', 'Liters (stations × products)'], array_keys($xlsx)); // جدول القيمة بكامله محذوف
        $this->assertStringNotContainsString('230.00', implode('', $xlsx));
    }

    /** @test */
    public function every_export_is_audited_without_amounts_or_rows(): void
    {
        $this->shift();
        $this->withToken($this->token())->get(self::BASE.'/sales.daily/export?format=xlsx&from=2020-01-01&to=2030-01-01')->assertStatus(422); // مدى كبير لا يُدقَّق
        $this->assertSame(0, FuelStationAuditEvent::where('action', 'report.exported')->count());

        $this->withToken($this->token())->get(self::BASE.'/sales.daily/export?format=csv')->assertOk();
        $event = FuelStationAuditEvent::where('action', 'report.exported')->sole();
        $this->assertSame($this->f['actor']->id, $event->actor_id);
        $this->assertSame('sales.daily', $event->after['report']);
        $this->assertSame('csv', $event->after['format']);
        $this->assertSame($this->f['station']->id, $event->fuel_station_id);
        $this->assertStringNotContainsString('23000', json_encode($event->after));
    }

    /** @test */
    public function print_pdf_share_are_audited_and_unauthorized_reports_are_not_found(): void
    {
        $res = $this->withToken($this->token())->postJson(self::BASE.'/sales.daily/audit', ['action' => 'pdf', 'filters' => ['station_id' => $this->f['station']->id, 'evil' => 'x', 'from' => '2027-01-01']]);
        $res->assertCreated();
        $event = FuelStationAuditEvent::where('action', 'report.pdf')->sole();
        $this->assertSame(['station_id' => $this->f['station']->id, 'from' => '2027-01-01'], $event->after['filters']); // مفاتيح غير معرّفة تُسقَط
        $this->withToken($this->token())->postJson(self::BASE.'/sales.daily/audit', ['action' => 'hack'])->assertStatus(422);

        $salesOnly = $this->roleUser($this->f['tenant_id'], 'so', 'so@rpt.test', ['fuel.sale.view']);
        $this->f['so'] = $salesOnly;
        $this->withToken($this->token('so'))->postJson(self::BASE.'/shifts.log/audit', ['action' => 'print'])->assertNotFound();
    }

    /** @test */
    public function a_station_pin_session_can_read_and_export_reports_but_not_reach_admin_routes(): void
    {
        $this->shift();
        // جلسة PIN تتطلب موظفاً نشطاً مرتبطاً بالحساب.
        $employee = \App\Models\Employee::create(['employee_no' => 'EMP-RPT-1', 'name' => 'بائع', 'basic_salary' => 0, 'is_active' => true]);
        $this->f['seller']->forceFill(['employee_id' => $employee->id])->save();
        $station = $this->f['seller']->createToken('station-ops', [StationSessionBoundary::ABILITY])->plainTextToken;

        $this->withToken($station)->getJson(self::BASE.'/catalog')->assertOk();
        $this->withToken($station)->getJson(self::BASE.'/sales.daily')->assertOk();
        $this->withToken($station)->get(self::BASE.'/sales.daily/export?format=csv')->assertOk();
        $this->withToken($station)->postJson(self::BASE.'/sales.daily/audit', ['action' => 'print'])->assertCreated();
        // لا اتساع في الصلاحية: بقية المسارات الإدارية ما زالت محجوبة.
        $this->withToken($station)->postJson('/api/fuel-stations/prices', [])->assertForbidden();
    }

    /** @test */
    public function exporting_a_station_outside_the_scope_is_not_found(): void
    {
        $other = $this->roleUser($this->f['tenant_id'], 'scoped2', 'scoped2@rpt.test', ['fuel.shift.view', 'fuel.sale.view']);
        $other->forceFill(['fuel_station_scope' => 'assigned'])->save();
        $other->fuelStations()->sync([]);
        $this->f['scoped2'] = $other;
        $this->withToken($this->token('scoped2'))->get(self::BASE.'/sales.daily/export?station_id='.$this->f['station']->id)->assertNotFound();
        $this->assertSame(0, FuelStationAuditEvent::where('action', 'report.exported')->count());
    }
}
