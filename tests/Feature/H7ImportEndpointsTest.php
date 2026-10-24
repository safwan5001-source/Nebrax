<?php

namespace Tests\Feature;

use App\Models\ImportPreview;
use App\Models\JournalEntry;
use App\Models\Product;
use App\Models\Role;
use App\Models\StockMovement;
use App\Models\TenantApplicationState;
use App\Models\Stocktake;
use App\Models\Warehouse;
use App\Services\Accounting\InventoryService;
use App\Services\Accounting\StocktakeService;
use App\Services\AiActionRegistry;
use App\Support\SpreadsheetWriter;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * IMP-H7-S1b — نقاط استيراد أعداد ورقة جرد (قالب/حقول/فحص/معاينة) ومجال `stocktake_count` في المحرك الدائم: مربوط بمعاينة، ذرّي، بوابات الكتابة المباشرة،
 * عزل المستأجر، وعدم أي ترحيل أو أثر مخزني/محاسبي. لا تطبيق متزامن ولا مسار ذكاء اصطناعي (H7-S4 لاحقاً).
 *
 * تشغيل: php artisan test --filter=H7ImportEndpointsTest
 */
class H7ImportEndpointsTest extends TestCase
{
    use CapturesThrowable;
    use InteractsWithApi;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    /** @param list<array<string,string>> $rows */
    private function file(array $rows): UploadedFile
    {
        $keys = array_values(array_unique(array_merge(...array_map('array_keys', $rows))));
        $table = array_map(fn (array $row): array => array_map(fn (string $key): string => $row[$key] ?? '', $keys), $rows);

        return UploadedFile::fake()->createWithContent('count.csv', SpreadsheetWriter::csv($keys, $table));
    }

    private function upload(string $token, string $uri, array $body)
    {
        return $this->withToken($token)->post($uri, $body, ['Accept' => 'application/json']);
    }

    private function role(string $tenantId, string $slug, array $permissions, string $email): string
    {
        app(TenantContext::class)->set($tenantId);
        Role::create(['slug' => $slug, 'name' => $slug, 'permissions' => $permissions, 'is_system' => false]);

        return $this->tokenForRole($tenantId, $slug, $email);
    }

    /** @return array{0: array<string,mixed>, 1: Stocktake, 2: array<string,Product>} */
    private function tenantWithStocktake(string $slug = 'acme', string $email = 'owner@acme.test'): array
    {
        $auth = $this->registerTenant($slug, $email);
        app(TenantContext::class)->set($auth['tenant_id']);
        $warehouse = Warehouse::create(['name' => 'المخزن الرئيسي', 'code' => 'WH-'.$slug, 'is_default' => true]);
        $products = [];
        foreach (['a' => 'SKU-A', 'b' => 'SKU-B'] as $key => $sku) {
            $products[$key] = Product::create(['name' => "صنف {$key}", 'sku' => $sku.$slug, 'type' => 'good', 'sale_price' => 2000, 'purchase_price' => 1000, 'track_inventory' => true]);
            app(InventoryService::class)->receiveStock($products[$key], 10, 1000, ['warehouse_id' => $warehouse->id]);
        }

        return [$auth, app(StocktakeService::class)->open(['warehouse_id' => $warehouse->id]), $products];
    }

    private function runJob(string $token, string $id): string
    {
        $status = null;
        for ($i = 0; $i < 6 && $status !== 'completed'; $i++) {
            $status = $this->withToken($token)->postJson("/api/import-jobs/{$id}/apply", [])->assertOk()->json('data.status');
        }

        return (string) $status;
    }

    /** @test */
    public function the_domain_is_bound_only_has_the_direct_count_gates_and_no_ai_action_exists_yet(): void
    {
        $this->assertSame([AiActionRegistry::PRODUCT_IMPORT], app(AiActionRegistry::class)->types());
        $this->assertContains('stocktake_count', \App\Support\ImportJobDomain::values());
        $this->assertContains('stocktake_count', \App\Support\ImportJobDomain::PREVIEW_BOUND_ONLY);
    }

    /** @test */
    public function there_is_no_synchronous_apply_route(): void
    {
        [$auth, $stocktake] = $this->tenantWithStocktake();

        $this->upload($auth['token'], '/api/stocktakes/count-import/apply', ['file' => $this->file([['sku' => 'x', 'counted_quantity' => '1']]), 'stocktake_id' => $stocktake->id])->assertStatus(404);
    }

    /** @test */
    public function fields_template_inspect_and_preview_serve_the_stocktake_and_write_nothing(): void
    {
        [$auth, $stocktake, $p] = $this->tenantWithStocktake();

        $keys = array_column($this->withToken($auth['token'])->getJson('/api/stocktakes/count-import/fields')->assertOk()->json('data.fields'), 'key');
        $this->assertSame(['nebrax_id', 'sku', 'barcode', 'product_name', 'counted_quantity'], $keys);

        $template = $this->withToken($auth['token'])->get("/api/stocktakes/{$stocktake->id}/count-import/template")->assertOk()->streamedContent();
        $this->assertStringContainsString('SKU-Aacme', $template);

        $rows = [['sku' => 'SKU-Aacme', 'counted_quantity' => '9'], ['sku' => 'SKU-Bacme', 'counted_quantity' => '7']];
        $inspect = $this->upload($auth['token'], '/api/stocktakes/count-import/inspect', ['file' => $this->file($rows), 'stocktake_id' => $stocktake->id])->assertOk()->json('data');
        $this->assertSame(['sku', 'counted_quantity'], array_column($inspect['columns'], 'suggested_field'));

        $preview = $this->upload($auth['token'], '/api/stocktakes/count-import/preview', ['file' => $this->file($rows), 'stocktake_id' => $stocktake->id])->assertOk()->json('data');
        $this->assertSame([2, 0], [$preview['to_write'], $preview['error_rows']]);
        $binding = ImportPreview::query()->whereKey($preview['binding']['id'])->firstOrFail();
        $this->assertSame('stocktake_count', $binding->domain);
        $this->assertSame($stocktake->id, $binding->options['stocktake_id']);
        $this->assertNull($binding->plan);

        $this->assertNull($stocktake->fresh('lines')->lines->firstWhere('product_id', $p['a']->id)->counted_quantity);
    }

    /** @test */
    public function a_bound_job_writes_the_counts_atomically_and_posts_nothing(): void
    {
        [$auth, $stocktake, $p] = $this->tenantWithStocktake();
        $rows = [['sku' => 'SKU-Aacme', 'counted_quantity' => '9'], ['sku' => 'SKU-Bacme', 'counted_quantity' => '12']];
        $movements = StockMovement::query()->count();
        $entries = JournalEntry::query()->count();

        $binding = $this->upload($auth['token'], '/api/stocktakes/count-import/preview', ['file' => $this->file($rows), 'stocktake_id' => $stocktake->id])->assertOk()->json('data.binding');
        $job = $this->upload($auth['token'], '/api/import-jobs', [
            'domain' => 'stocktake_count', 'file' => $this->file($rows), 'options' => ['stocktake_id' => $stocktake->id], 'preview_id' => $binding['id'], 'preview_hash' => $binding['hash'],
        ])->assertCreated()->json('data');

        // الهدف المجمَّد ظاهر لمجال الجرد وحده (تتحقق منه الواجهة عند الاستئناف)
        $this->assertSame($stocktake->id, $job['target_id']);
        $this->assertSame('completed', $this->runJob($auth['token'], $job['id']));
        $lines = $stocktake->fresh('lines')->lines;
        $this->assertSame([9, 12], [$lines->firstWhere('product_id', $p['a']->id)->counted_quantity, $lines->firstWhere('product_id', $p['b']->id)->counted_quantity]);
        $this->assertSame('draft', $stocktake->fresh()->status, 'الجرد لا يُرحَّل من الاستيراد.');
        $this->assertSame([$movements, $entries], [StockMovement::query()->count(), JournalEntry::query()->count()]);
    }

    /** @test */
    public function the_job_requires_a_preview_and_the_target_stocktake(): void
    {
        [$auth, $stocktake] = $this->tenantWithStocktake();
        $rows = [['sku' => 'SKU-Aacme', 'counted_quantity' => '9']];

        $this->upload($auth['token'], '/api/import-jobs', ['domain' => 'stocktake_count', 'file' => $this->file($rows), 'options' => ['stocktake_id' => $stocktake->id]])->assertUnprocessable();

        $binding = $this->upload($auth['token'], '/api/stocktakes/count-import/preview', ['file' => $this->file($rows), 'stocktake_id' => $stocktake->id])->assertOk()->json('data.binding');
        $this->upload($auth['token'], '/api/import-jobs', ['domain' => 'stocktake_count', 'file' => $this->file($rows), 'preview_id' => $binding['id'], 'preview_hash' => $binding['hash']])->assertUnprocessable();
        // خيارٌ مختلف عن المعاينة (سياسة العدّ) يُرفض ربطاً
        $this->upload($auth['token'], '/api/import-jobs', [
            'domain' => 'stocktake_count', 'file' => $this->file($rows), 'options' => ['stocktake_id' => $stocktake->id, 'existing_count_policy' => 'overwrite'], 'preview_id' => $binding['id'], 'preview_hash' => $binding['hash'],
        ])->assertUnprocessable();
    }

    /** @test */
    public function gates_follow_the_direct_count_route_and_a_viewer_cannot_preview_or_create(): void
    {
        [$auth, $stocktake] = $this->tenantWithStocktake();
        $rows = [['sku' => 'SKU-Aacme', 'counted_quantity' => '9']];

        $viewer = $this->role($auth['tenant_id'], 'count_viewer', ['products.view'], 'v@h7.test');
        $this->withToken($viewer)->getJson('/api/stocktakes/count-import/fields')->assertForbidden();
        $this->withToken($viewer)->get("/api/stocktakes/{$stocktake->id}/count-import/template")->assertForbidden();
        $this->upload($viewer, '/api/stocktakes/count-import/preview', ['file' => $this->file($rows), 'stocktake_id' => $stocktake->id])->assertForbidden();
        $this->upload($viewer, '/api/import-jobs', ['domain' => 'stocktake_count', 'file' => $this->file($rows), 'options' => ['stocktake_id' => $stocktake->id]])->assertForbidden();

        $manager = $this->role($auth['tenant_id'], 'count_manager', ['products.view', 'products.manage'], 'm@h7.test');
        $this->upload($manager, '/api/stocktakes/count-import/preview', ['file' => $this->file($rows), 'stocktake_id' => $stocktake->id])->assertOk();
    }

    /** @test */
    public function a_stocktake_of_another_tenant_never_resolves(): void
    {
        [$auth] = $this->tenantWithStocktake('acme', 'o@acme.test');
        [, $foreign] = $this->tenantWithStocktake('other', 'o@other.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $rows = [['sku' => 'SKU-Aacme', 'counted_quantity' => '9']];

        $this->withToken($auth['token'])->get("/api/stocktakes/{$foreign->id}/count-import/template")->assertUnprocessable();
        $this->upload($auth['token'], '/api/stocktakes/count-import/preview', ['file' => $this->file($rows), 'stocktake_id' => $foreign->id])->assertUnprocessable();
    }

    private function disableInventory(string $tenantId): void
    {
        app(TenantContext::class)->set($tenantId);
        TenantApplicationState::updateOrCreate(['application_key' => 'inventory.core'], ['requested_enabled' => false, 'status' => 'disabled']);
    }

    /** @test */
    public function a_disabled_inventory_core_refuses_the_endpoints_and_job_creation_and_apply(): void
    {
        [$auth, $stocktake, $p] = $this->tenantWithStocktake();
        $rows = [['sku' => 'SKU-Aacme', 'counted_quantity' => '9']];
        $binding = $this->upload($auth['token'], '/api/stocktakes/count-import/preview', ['file' => $this->file($rows), 'stocktake_id' => $stocktake->id])->assertOk()->json('data.binding');
        $job = $this->upload($auth['token'], '/api/import-jobs', [
            'domain' => 'stocktake_count', 'file' => $this->file($rows), 'options' => ['stocktake_id' => $stocktake->id], 'preview_id' => $binding['id'], 'preview_hash' => $binding['hash'],
        ])->assertCreated()->json('data');

        $this->disableInventory($auth['tenant_id']);

        $this->withToken($auth['token'])->getJson('/api/stocktakes/count-import/fields')->assertForbidden();
        $this->upload($auth['token'], '/api/stocktakes/count-import/preview', ['file' => $this->file($rows), 'stocktake_id' => $stocktake->id])->assertForbidden();
        $this->upload($auth['token'], '/api/import-jobs', ['domain' => 'stocktake_count', 'file' => $this->file($rows), 'options' => ['stocktake_id' => $stocktake->id]])->assertForbidden();
        $this->withToken($auth['token'])->postJson("/api/import-jobs/{$job['id']}/apply", [])->assertForbidden();
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertNull($stocktake->fresh('lines')->lines->firstWhere('product_id', $p['a']->id)->counted_quantity);
    }

    /** @test */
    public function apply_rejects_a_different_stocktake_or_policy_than_the_frozen_ones(): void
    {
        [$auth, $stocktake] = $this->tenantWithStocktake();
        $other = app(StocktakeService::class)->open(['warehouse_id' => $stocktake->warehouse_id]);
        $rows = [['sku' => 'SKU-Aacme', 'counted_quantity' => '9']];
        $binding = $this->upload($auth['token'], '/api/stocktakes/count-import/preview', ['file' => $this->file($rows), 'stocktake_id' => $stocktake->id])->assertOk()->json('data.binding');
        $job = $this->upload($auth['token'], '/api/import-jobs', [
            'domain' => 'stocktake_count', 'file' => $this->file($rows), 'options' => ['stocktake_id' => $stocktake->id], 'preview_id' => $binding['id'], 'preview_hash' => $binding['hash'],
        ])->assertCreated()->json('data');

        foreach ([['stocktake_id' => $other->id], ['existing_count_policy' => 'overwrite']] as $changed) {
            $this->withToken($auth['token'])->postJson("/api/import-jobs/{$job['id']}/apply", $changed)->assertStatus(422)->assertJsonPath('code', 'options_frozen');
        }
        $this->assertSame('completed', $this->runJob($auth['token'], $job['id']));
    }

    /** @test */
    public function a_count_error_fails_the_whole_job_and_leaves_the_sheet_untouched(): void
    {
        [$auth, $stocktake, $p] = $this->tenantWithStocktake();
        $rows = [['sku' => 'SKU-Aacme', 'counted_quantity' => '9'], ['sku' => 'SKU-Bacme', 'counted_quantity' => 'abc']];

        $binding = $this->upload($auth['token'], '/api/stocktakes/count-import/preview', ['file' => $this->file($rows), 'stocktake_id' => $stocktake->id])->assertOk()->json('data.binding');
        $job = $this->upload($auth['token'], '/api/import-jobs', [
            'domain' => 'stocktake_count', 'file' => $this->file($rows), 'options' => ['stocktake_id' => $stocktake->id], 'preview_id' => $binding['id'], 'preview_hash' => $binding['hash'],
        ])->assertCreated()->json('data');

        $status = $this->withToken($auth['token'])->postJson("/api/import-jobs/{$job['id']}/apply", [])->json('data.status');
        $this->assertNotSame('completed', $status);
        $this->assertNull($stocktake->fresh('lines')->lines->firstWhere('product_id', $p['a']->id)->counted_quantity);
    }
}
