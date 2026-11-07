<?php

namespace Tests\Feature;

use App\Models\FuelNozzle;
use App\Models\FuelPump;
use App\Models\FuelSale;
use App\Models\FuelTank;
use App\Models\Invoice;
use App\Models\ProductWarehouseStock;
use App\Models\StockMovement;
use App\Services\FuelSaleService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * FUEL-P1-1 (FUEL_STATION_E2E_REPORT §6): لا يُباع وقود عبر مضخة أو خزان أو فوهة في الصيانة/معطّلة — عند المسودة وعند الإنهاء —
 * ولا يترك الرفض أثراً (بيع/فاتورة/حركة مخزون/قيد). كانت الفوهة وحدها مفحوصة فيمرّ البيع عبر مضخة أو خزان في الصيانة.
 */
class FuelSaleEquipmentStateTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use CapturesThrowable;
    use BuildsFuelEquipmentFixture;

    private const NON_ACTIVE = ['maintenance', 'inactive'];

    /** @return array<string,int> */
    private function footprint(array $f): array
    {
        return [
            'sales' => FuelSale::count(), 'invoices' => Invoice::count(), 'movements' => StockMovement::where('source_type', FuelSale::class)->count(),
            'journals' => DB::table('journal_entries')->where('tenant_id', $f['tenant_id'])->count(),
            'stock' => (int) ProductWarehouseStock::where('product_id', $f['product']->id)->sum('quantity'),
        ];
    }

    /** @return array<string,mixed> */
    private function payload(array $f, string $set, string $key, int $ml = 20000): array
    {
        return [
            'fuel_station_id' => $f['station']->id, 'fuel_nozzle_id' => $f[$set]['nozzle']->id, 'fuel_shift_id' => $f['shift']->id,
            'partner_id' => $f['customer']->id, 'quantity_milliliters' => $ml, 'idempotency_key' => $key,
        ];
    }

    private function setStatus(string $kind, array $f, string $set, string $status): void
    {
        $model = match ($kind) { 'pump' => FuelPump::class, 'tank' => FuelTank::class, 'nozzle' => FuelNozzle::class };
        $model::whereKey($f[$set][$kind]->id)->update(['status' => $status]);
    }

    #[Test]
    public function a_draft_is_refused_when_the_pump_tank_or_nozzle_is_not_active_and_leaves_no_trace(): void
    {
        $f = $this->equipmentFixture();
        $sales = app(FuelSaleService::class);
        $base = $this->footprint($f);
        $expectedCode = ['pump' => 'FUEL_PUMP_NOT_OPERATIONAL', 'tank' => 'FUEL_TANK_NOT_OPERATIONAL', 'nozzle' => null];

        foreach (['pump', 'tank', 'nozzle'] as $kind) {
            foreach (self::NON_ACTIVE as $status) {
                $this->setStatus($kind, $f, 'a', $status);
                $error = $this->thrown(fn () => $sales->createDraft($this->payload($f, 'a', "draft-{$kind}-{$status}"), $f['actor']), "{$kind} {$status}: يجب رفض المسودة.");
                if ($expectedCode[$kind] !== null) {
                    $this->assertStringContainsString($expectedCode[$kind], $error->getMessage(), "{$kind} {$status}");
                }
                $this->assertSame($base, $this->footprint($f), "{$kind} {$status}: لا أثر");
                $this->setStatus($kind, $f, 'a', 'active');
            }
        }
    }

    #[Test]
    public function finalizing_a_draft_is_refused_when_its_pump_or_tank_went_to_maintenance_and_works_again_once_reactivated(): void
    {
        $f = $this->equipmentFixture();
        $sales = app(FuelSaleService::class);
        $draft = $sales->createDraft($this->payload($f, 'a', 'finalize-after-maintenance'), $f['actor']);
        $base = $this->footprint($f);

        foreach (['pump' => 'FUEL_PUMP_NOT_OPERATIONAL', 'tank' => 'FUEL_TANK_NOT_OPERATIONAL'] as $kind => $code) {
            foreach (self::NON_ACTIVE as $status) {
                $this->setStatus($kind, $f, 'a', $status);
                $error = $this->thrown(fn () => $sales->finalize($draft->fresh(), $f['actor']), "{$kind} {$status}: يجب رفض الإنهاء.");
                $this->assertStringContainsString($code, $error->getMessage());
                $this->assertSame('draft', $draft->fresh()->status, 'المسودة تبقى مسودة');
                $this->assertSame($base, $this->footprint($f), "{$kind} {$status}: لا فاتورة ولا حركة مخزون ولا قيد");
                $this->setStatus($kind, $f, 'a', 'active');
            }
        }

        // بعد إعادة التفعيل يُنهى البيع مرة واحدة ويخصم 20 لتر بالضبط.
        $finalized = $sales->finalize($draft->fresh(), $f['actor']);
        $this->assertSame('finalized', $finalized->status);
        $after = $this->footprint($f);
        $this->assertSame($base['invoices'] + 1, $after['invoices']);
        $this->assertSame($base['movements'] + 1, $after['movements']);
        $this->assertSame($base['stock'] - 20000, $after['stock']);
    }

    #[Test]
    public function a_nozzle_that_became_inactive_after_the_draft_still_blocks_finalization(): void
    {
        $f = $this->equipmentFixture();
        $sales = app(FuelSaleService::class);
        $draft = $sales->createDraft($this->payload($f, 'a', 'nozzle-after-draft'), $f['actor']);
        $base = $this->footprint($f);
        foreach (self::NON_ACTIVE as $status) {
            $this->setStatus('nozzle', $f, 'a', $status);
            $this->thrown(fn () => $sales->finalize($draft->fresh(), $f['actor']), "فوهة {$status}");
            $this->assertSame($base, $this->footprint($f));
        }
    }

    #[Test]
    public function equipment_in_maintenance_does_not_block_a_second_independent_pump_tank_and_nozzle(): void
    {
        $f = $this->equipmentFixture();
        $sales = app(FuelSaleService::class);
        $this->setStatus('pump', $f, 'a', 'maintenance');
        $this->setStatus('tank', $f, 'a', 'inactive');
        $base = $this->footprint($f);

        $sale = $sales->finalize($sales->createDraft($this->payload($f, 'b', 'independent-b'), $f['actor']), $f['actor']);
        $this->assertSame('finalized', $sale->status);
        $this->assertSame($f['b']['pump']->id, $sale->fuel_pump_id);
        $this->assertSame($f['b']['tank']->id, $sale->fuel_tank_id);
        $this->assertSame($base['stock'] - 20000, $this->footprint($f)['stock']);
    }

    #[Test]
    public function the_api_answers_422_with_a_stable_code_and_no_side_effect_for_pump_and_tank_in_maintenance(): void
    {
        $f = $this->equipmentFixture();
        $base = $this->footprint($f);
        foreach (['pump' => 'FUEL_PUMP_NOT_OPERATIONAL', 'tank' => 'FUEL_TANK_NOT_OPERATIONAL'] as $kind => $code) {
            $this->setStatus($kind, $f, 'a', 'maintenance');
            $draft = $this->withToken($f['token'])->postJson('/api/fuel-stations/sales', $this->payload($f, 'a', "api-{$kind}"));
            $draft->assertStatus(422);
            $this->assertStringContainsString($code, (string) $draft->json('message'));
            $this->assertSame($base, $this->footprint($f));
            $this->setStatus($kind, $f, 'a', 'active');
        }

        // الحالة الصحيحة تمرّ عبر الـAPI نفسه (شاهد إيجابي): مسودة ثم إنهاء.
        $ok = $this->withToken($f['token'])->postJson('/api/fuel-stations/sales', $this->payload($f, 'a', 'api-ok'))->assertCreated()['data'];
        $this->setStatus('pump', $f, 'a', 'maintenance');
        $fin = $this->withToken($f['token'])->postJson("/api/fuel-stations/sales/{$ok['id']}/finalize");
        $fin->assertStatus(422);
        $this->assertStringContainsString('FUEL_PUMP_NOT_OPERATIONAL', (string) $fin->json('message'));
        $this->setStatus('pump', $f, 'a', 'active');
        $this->withToken($f['token'])->postJson("/api/fuel-stations/sales/{$ok['id']}/finalize")->assertOk();
        $this->assertSame($base['stock'] - 20000, $this->footprint($f)['stock']);
    }
}
