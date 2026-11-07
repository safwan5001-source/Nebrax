<?php

namespace Tests\Feature;

use App\Models\Employee;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * يبذر عالم E2E_TEST في قاعدة بيانات مؤقتة **مهاجَرة سلفاً** (بلا RefreshDatabase) لاختبارات المتصفح الحيّة.
 * يعمل فقط عند ضبط E2E_SEED_OUT؛ لا يُشغَّل ضمن الحزمة العادية. الإخراج: ملف JSON بالرموز والمعرّفات.
 */
class FuelStationE2ESeedLiveTest extends TestCase
{
    use InteractsWithApi;
    use FuelStationE2EWorld;

    /** @test */
    public function seed_live_world(): void
    {
        $out = getenv('E2E_SEED_OUT');
        if (! $out) { $this->markTestSkipped('E2E_SEED_OUT غير مضبوط.'); }
        $this->buildWorld(['shift_expected_cash_basis' => 'receiving_shift_receipts'], slug: 'e2e-ui');
        $pins = [];
        foreach (['seller' => ['EMP-E2E-S', '482915'], 'supervisor' => ['EMP-E2E-V', '739104']] as $who => [$no, $pin]) {
            $emp = Employee::create(['employee_no' => $no, 'name' => "E2E_TEST {$who}", 'basic_salary' => 0, 'is_active' => true]);
            $this->w[$who]->forceFill(['employee_id' => $emp->id, 'station_pin_hash' => Hash::make($pin), 'station_pin_set_at' => now()])->save();
            $pins[$who] = ['employee_no' => $no, 'pin' => $pin];
        }
        file_put_contents($out, json_encode([
            'slug' => 'e2e-ui', 'tenant_id' => $this->w['tenant_id'], 'tokens' => $this->w['tokens'], 'pins' => $pins,
            'station_id' => $this->w['station']['id'], 'nozzle_id' => $this->w['nozzle']['id'], 'tank_id' => $this->w['tank']['id'],
            'users' => ['seller' => ['id' => $this->w['seller']->id, 'email' => $this->w['seller']->email], 'supervisor' => ['id' => $this->w['supervisor']->id, 'email' => $this->w['supervisor']->email], 'owner' => ['email' => 'owner@e2e-ui.invalid']],
        ], JSON_PRETTY_PRINT));
        $this->assertFileExists($out);
    }
}
