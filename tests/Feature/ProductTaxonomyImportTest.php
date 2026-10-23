<?php

namespace Tests\Feature;

use App\Models\Brand;
use App\Models\ImportJob;
use App\Models\JournalEntry;
use App\Models\Product;
use App\Models\ProductCategory;
use App\Services\ProductTaxonomyImportAdapter;
use App\Services\ProductTaxonomyImportService;
use App\Support\BranchSettings;
use App\Support\ImportChunk;
use App\Support\ImportPlanDriftException;
use App\Support\ImportUnitFailureException;
use App\Support\ProductTaxonomyImportFields;
use App\Support\SpreadsheetWriter;
use App\Tenancy\BranchContext;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

/**
 * IMP-H4-S1 — استيراد التصنيفات والعلامات التجارية: العقد، الهوية بالمسار، سياسة الآباء، الأوضاع، القفل على العنصر القائم، النوافذ، والمحوّل
 * (غير مسجَّل بعد: S2).
 *
 * تشغيل: php artisan test --filter=ProductTaxonomyImportTest
 */
class ProductTaxonomyImportTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private string $tenantId;

    private string $token;

    protected function setUp(): void
    {
        parent::setUp();
        $auth = $this->registerTenant();
        $this->tenantId = $auth['tenant_id'];
        $this->token = $auth['token'];
        app(TenantContext::class)->set($this->tenantId);
    }

    private function service(): ProductTaxonomyImportService
    {
        return app(ProductTaxonomyImportService::class);
    }

    /** @param list<array<string,string>> $rows */
    private function file(array $rows, string $name = 'taxonomy.csv'): UploadedFile
    {
        $keys = array_values(array_unique(array_merge(...array_map('array_keys', $rows))));
        $table = array_map(fn (array $row): array => array_map(fn (string $key): string => $row[$key] ?? '', $keys), $rows);

        return UploadedFile::fake()->createWithContent($name, SpreadsheetWriter::csv($keys, $table));
    }

    /** @return list<string> */
    private function actions(array $preview): array
    {
        return array_map(fn (array $row): string => (string) $row['action'], $preview['rows']);
    }

    /** @return list<string> مسارات كل التصنيفات مرتّبةً */
    private function paths(): array
    {
        $all = ProductCategory::query()->get()->keyBy('id');
        $paths = $all->map(function (ProductCategory $category) use ($all): string {
            $names = [$category->name];
            for ($node = $category; $node->parent_id !== null; $node = $all[$node->parent_id]) {
                array_unshift($names, $all[$node->parent_id]->name);
            }

            return implode(' > ', $names);
        })->values()->all();
        sort($paths);

        return $paths;
    }

    // ═══════════════════════════════ العقد ═══════════════════════════════

    /** @test */
    public function the_contracts_expose_no_media_pricing_stock_or_tenant_fields_and_map_arabic_headers(): void
    {
        foreach (ProductTaxonomyImportFields::KINDS as $kind) {
            foreach (['image', 'image_path', 'parent_id', 'tenant_id', 'branch_id', 'sale_price', 'quantity'] as $forbidden) {
                $this->assertNotContains($forbidden, ProductTaxonomyImportFields::keys($kind), "$kind/$forbidden");
            }
        }

        $map = ProductTaxonomyImportFields::autoMap('category', ['الاسم', 'مسار التصنيف الأب', 'الوصف', 'اللون', 'نشط', 'عمود غريب']);
        $this->assertSame(['name', 'parent_path', 'description', 'color', 'is_active', null], array_values($map));
        $this->assertSame(['name', 'is_active'], array_values(ProductTaxonomyImportFields::autoMap('brand', ['العلامة', 'الحالة'])));
    }

    /** @test */
    public function a_legacy_numeric_id_column_is_not_mistaken_for_the_nebrax_uuid(): void
    {
        $this->assertSame([null, 'name'], array_values(ProductTaxonomyImportFields::autoMap('category', ['id', 'الاسم'])));
    }

    /** @test */
    public function both_templates_import_as_they_are(): void
    {
        $category = $this->service()->preview(UploadedFile::fake()->createWithContent('c.csv', $this->service()->template('category')), ['kind' => 'category']);
        $brand = $this->service()->preview(UploadedFile::fake()->createWithContent('b.csv', $this->service()->template('brand')), ['kind' => 'brand']);

        $this->assertSame([0, 3], [$category['error_rows'], $category['create_rows']]);
        $this->assertSame([0, 2], [$brand['error_rows'], $brand['create_rows']]);
    }

    /** @test */
    public function an_unknown_kind_or_option_is_refused(): void
    {
        foreach ([['kind' => 'product'], ['kind' => 'brand', 'mode' => 'delete'], ['kind' => 'brand', 'parent_policy' => 'x'], ['kind' => 'brand', 'mapping' => [0 => 'sale_price']]] as $options) {
            try {
                $this->service()->options($options);
                $this->fail('كان يجب رفض الخيار: '.json_encode($options));
            } catch (\RuntimeException $e) {
                $this->assertNotSame('', $e->getMessage());
            }
        }
        $this->assertSame('error', $this->service()->options(['kind' => 'brand', 'parent_policy' => 'create_missing'])['parent_policy'], 'العلامات بلا آباء: السياسة تُثبَّت');
    }

    // ═══════════════════════════════ التصنيفات: الإنشاء والمسار ═══════════════════════════════

    /** @test */
    public function categories_are_created_in_order_with_parents_defined_earlier_in_the_file(): void
    {
        $rows = [
            ['name' => 'زيوت', 'description' => 'زيوت المحركات', 'color' => '#1F7A8C'],
            ['name' => 'فلاتر', 'parent_path' => 'زيوت'],
            ['name' => 'فلاتر هواء', 'parent_path' => 'زيوت > فلاتر', 'is_active' => 'لا'],
        ];
        $preview = $this->service()->preview($this->file($rows), ['kind' => 'category']);
        $this->assertSame(['create', 'create', 'create'], $this->actions($preview));
        $this->assertSame(0, $preview['implicit_parents']);
        $this->assertSame('زيوت > فلاتر > فلاتر هواء', $preview['rows'][2]['path']);

        $result = $this->service()->apply($this->file($rows), ['kind' => 'category']);

        $this->assertSame([3, 0, 0, 0], [$result['created'], $result['updated'], $result['skipped'], $result['implicit_parents_created']]);
        $this->assertSame(['زيوت', 'زيوت > فلاتر', 'زيوت > فلاتر > فلاتر هواء'], $this->paths());
        $leaf = ProductCategory::query()->where('name', 'فلاتر هواء')->first();
        $this->assertFalse($leaf->is_active);
        $this->assertSame('#1F7A8C', ProductCategory::query()->where('name', 'زيوت')->value('color'));
    }

    /** @test */
    public function a_missing_parent_is_an_error_by_default_and_created_on_request(): void
    {
        $rows = [['name' => 'فلاتر هواء', 'parent_path' => 'زيوت > فلاتر']];

        $strict = $this->service()->preview($this->file($rows), ['kind' => 'category']);
        $this->assertSame(['error'], $this->actions($strict));
        $this->assertStringContainsString('زيوت', $strict['errors'][0]['messages'][0]);
        $this->assertSame(0, ProductCategory::query()->count());

        $lenient = $this->service()->preview($this->file($rows), ['kind' => 'category', 'parent_policy' => 'create_missing']);
        $this->assertSame(['create'], $this->actions($lenient));
        $this->assertSame(2, $lenient['implicit_parents']);
        $this->assertSame(['زيوت', 'زيوت > فلاتر'], $lenient['rows'][0]['creates_parents']);

        $result = $this->service()->apply($this->file($rows), ['kind' => 'category', 'parent_policy' => 'create_missing']);
        $this->assertSame([1, 2], [$result['created'], $result['implicit_parents_created']]);
        $this->assertSame(['زيوت', 'زيوت > فلاتر', 'زيوت > فلاتر > فلاتر هواء'], $this->paths());
        $this->assertTrue((bool) ProductCategory::query()->where('name', 'زيوت')->value('is_active'));
    }

    /** @test */
    public function implicit_parents_are_shared_by_later_rows_and_never_duplicated(): void
    {
        $rows = [
            ['name' => 'أ', 'parent_path' => 'جذر > فرع'],
            ['name' => 'ب', 'parent_path' => 'جذر > فرع'],
            ['name' => 'ج', 'parent_path' => 'جذر'],
        ];
        $result = $this->service()->apply($this->file($rows), ['kind' => 'category', 'parent_policy' => 'create_missing']);

        $this->assertSame([3, 2], [$result['created'], $result['implicit_parents_created']]);
        $this->assertSame(['جذر', 'جذر > ج', 'جذر > فرع', 'جذر > فرع > أ', 'جذر > فرع > ب'], $this->paths());
    }

    /** @test */
    public function the_same_name_under_different_parents_is_legitimate_but_a_sibling_clash_is_not(): void
    {
        $oils = ProductCategory::create(['name' => 'زيوت']);
        $parts = ProductCategory::create(['name' => 'قطع غيار']);
        ProductCategory::create(['name' => 'فلاتر', 'parent_id' => $oils->id]);

        $preview = $this->service()->preview($this->file([
            ['name' => 'فلاتر', 'parent_path' => 'قطع غيار'],
            ['name' => 'فلاتر', 'parent_path' => 'زيوت'],
        ]), ['kind' => 'category']);

        $this->assertSame(['create', 'error'], $this->actions($preview));
        $this->assertStringContainsString('يطابق عنصراً موجوداً', $preview['errors'][0]['messages'][0]);
        $this->assertSame(0, ProductCategory::query()->where('parent_id', $parts->id)->count());
    }

    /** @test */
    public function the_same_path_twice_in_one_file_fails_the_whole_file_before_any_write(): void
    {
        $rows = [['name' => 'أ'], ['name' => 'ب'], ['name' => 'أ']];

        $preview = $this->service()->preview($this->file($rows), ['kind' => 'category']);
        $this->assertSame(['create', 'create', 'error'], $this->actions($preview));

        try {
            $this->service()->apply($this->file($rows), ['kind' => 'category', 'batch_offset' => 0, 'batch_size' => 1]);
            $this->fail('كان يجب أن يفشل الملف كله عند التكرار داخله.');
        } catch (ImportUnitFailureException $e) {
            $this->assertSame([2], array_column($e->failures, 'ordinal'));
        }
        $this->assertSame(0, ProductCategory::query()->count());
    }

    /** @test */
    public function malformed_cells_are_row_errors_not_silent_repairs(): void
    {
        $rows = [
            ['name' => 'لون سيئ', 'color' => 'red'],
            ['name' => 'يحمل > فاصلاً'],
            ['name' => 'مسار فارغ', 'parent_path' => 'أ >  > ب'],
            ['name' => 'عميق', 'parent_path' => implode(' > ', range(1, 8))],
            ['name' => 'حالة سيئة', 'is_active' => 'ربما'],
            ['name' => str_repeat('م', 256)],
        ];

        $preview = $this->service()->preview($this->file($rows), ['kind' => 'category', 'parent_policy' => 'create_missing']);

        $this->assertSame(array_fill(0, 6, 'error'), $this->actions($preview));
        $this->assertStringContainsString('#RRGGBB', $preview['errors'][0]['messages'][0]);
        $this->assertStringContainsString('فاصل المسار', $preview['errors'][1]['messages'][0]);
        $this->assertStringContainsString('مستوى فارغ', $preview['errors'][2]['messages'][0]);
        $this->assertStringContainsString('للمستويات', $preview['errors'][3]['messages'][0]);
        $this->assertSame(0, ProductCategory::query()->count());
    }

    // ═══════════════════════════════ الأوضاع والتحديث ═══════════════════════════════

    /** @test */
    public function update_changes_description_colour_and_status_only_and_matches_by_path(): void
    {
        $root = ProductCategory::create(['name' => 'زيوت', 'description' => 'قديم', 'color' => '#111111']);
        $child = ProductCategory::create(['name' => 'فلاتر', 'parent_id' => $root->id]);

        $rows = [
            ['name' => 'زيوت', 'description' => 'جديد', 'color' => '#222222'],
            ['name' => 'فلاتر', 'parent_path' => 'زيوت', 'is_active' => 'لا'],
            ['name' => 'غير موجود'],
        ];
        $preview = $this->service()->preview($this->file($rows), ['kind' => 'category', 'mode' => 'update']);
        $this->assertSame(['update', 'update', 'error'], $this->actions($preview));
        $this->assertStringContainsString('لا يمكن التحديث', $preview['errors'][0]['messages'][0]);

        $this->service()->apply($this->file(array_slice($rows, 0, 2)), ['kind' => 'category', 'mode' => 'update']);

        $this->assertSame(['جديد', '#222222'], [$root->refresh()->description, $root->color]);
        $this->assertFalse($child->refresh()->is_active);
        $this->assertSame($root->id, $child->parent_id);
    }

    /** @test */
    public function blank_cells_keep_values_by_default_and_clear_only_clearable_fields_on_request(): void
    {
        $category = ProductCategory::create(['name' => 'زيوت', 'description' => 'وصف', 'color' => '#111111']);
        $rows = [['name' => 'زيوت', 'description' => '', 'color' => '', 'is_active' => '']];

        $ignored = $this->service()->preview($this->file($rows), ['kind' => 'category', 'mode' => 'update']);
        $this->assertSame(['skip'], $this->actions($ignored));

        $cleared = $this->service()->preview($this->file($rows), ['kind' => 'category', 'mode' => 'update', 'blank_policy' => 'clear']);
        $this->assertSame(['update'], $this->actions($cleared));
        $this->assertStringContainsString('لا يقبل المسح', $cleared['rows'][0]['warnings'][0]);

        $this->service()->apply($this->file($rows), ['kind' => 'category', 'mode' => 'update', 'blank_policy' => 'clear']);
        $category->refresh();
        $this->assertSame([null, null, true], [$category->description, $category->color, $category->is_active]);
    }

    /** @test */
    public function upsert_creates_missing_updates_changed_and_skips_identical(): void
    {
        ProductCategory::create(['name' => 'ثابت', 'description' => 'كما هو']);
        ProductCategory::create(['name' => 'متغير', 'description' => 'قبل']);
        $rows = [
            ['name' => 'ثابت', 'description' => 'كما هو'],
            ['name' => 'متغير', 'description' => 'بعد'],
            ['name' => 'جديد'],
        ];

        $result = $this->service()->apply($this->file($rows), ['kind' => 'category', 'mode' => 'upsert']);

        $this->assertSame([1, 1, 1], [$result['created'], $result['updated'], $result['skipped']]);
    }

    /** @test */
    public function an_existing_category_is_never_renamed_or_moved_by_nebrax_id(): void
    {
        $root = ProductCategory::create(['name' => 'زيوت']);
        ProductCategory::create(['name' => 'قطع غيار']);
        $a = ProductCategory::create(['name' => 'فلاتر', 'parent_id' => $root->id]);
        $b = ProductCategory::create(['name' => 'شمعات', 'parent_id' => $root->id]);
        $c = ProductCategory::create(['name' => 'زجاج', 'parent_id' => $root->id]);

        $rows = [
            ['nebrax_id' => $a->id, 'name' => 'اسم جديد'],
            ['nebrax_id' => $b->id, 'parent_path' => 'قطع غيار'],
            ['nebrax_id' => $c->id, 'name' => 'زجاج', 'parent_path' => 'زيوت', 'description' => 'مسموح'],
        ];
        $preview = $this->service()->preview($this->file($rows), ['kind' => 'category', 'mode' => 'update']);

        $this->assertSame(['error', 'error', 'update'], $this->actions($preview));
        $this->assertStringContainsString('لا يعيد تسمية', $preview['errors'][0]['messages'][0]);
        $this->assertStringContainsString('لا يعيد تسمية', $preview['errors'][1]['messages'][0]);
        $this->assertSame([$root->id, 'فلاتر'], [$a->refresh()->parent_id, $a->name]);
        $this->assertSame($root->id, $b->refresh()->parent_id);
    }

    /** @test */
    public function a_nebrax_id_that_is_unknown_or_malformed_is_rejected_without_leaking_other_tenants(): void
    {
        $rows = [['nebrax_id' => '00000000-0000-4000-8000-000000000000', 'description' => 'x'], ['nebrax_id' => '123', 'description' => 'x']];

        $preview = $this->service()->preview($this->file($rows), ['kind' => 'category', 'mode' => 'update']);

        $this->assertSame(['error', 'error'], $this->actions($preview));
        $this->assertStringContainsString('لا يطابق', $preview['errors'][0]['messages'][0]);
        $this->assertStringContainsString('غير صالح', $preview['errors'][1]['messages'][0]);
    }

    /** @test */
    public function a_row_that_defines_a_parent_after_its_child_updates_the_implicitly_created_parent(): void
    {
        $rows = [
            ['name' => 'فرع', 'parent_path' => 'جذر'],
            ['name' => 'جذر', 'description' => 'وُصف لاحقاً'],
        ];
        $options = ['kind' => 'category', 'mode' => 'upsert', 'parent_policy' => 'create_missing'];

        $preview = $this->service()->preview($this->file($rows), $options);
        $this->assertSame(['create', 'update'], $this->actions($preview));

        $result = $this->service()->apply($this->file($rows), $options);
        $this->assertSame([1, 1, 1], [$result['created'], $result['updated'], $result['implicit_parents_created']]);
        $this->assertSame('وُصف لاحقاً', ProductCategory::query()->where('name', 'جذر')->value('description'));
        $this->assertSame(['جذر', 'جذر > فرع'], $this->paths());

        // نفس الصف في وضع الإنشاء: الجذر صار «موجوداً» بسبب الابن، فيُرفض بدل أن يُنشأ مكرراً.
        ProductCategory::query()->delete();
        $createOnly = $this->service()->preview($this->file($rows), ['mode' => 'create'] + $options);
        $this->assertSame(['create', 'error'], $this->actions($createOnly));
    }

    // ═══════════════════════════════ العزل بين الفروع ═══════════════════════════════

    /** @test */
    public function a_category_in_another_isolated_branch_blocks_the_name_but_cannot_be_updated_or_used_as_a_parent(): void
    {
        BranchSettings::merge(['share_products' => false]);
        $mainId = $this->withToken($this->token)->getJson('/api/branches')['data'][0]['id'];
        $otherId = $this->withToken($this->token)->postJson('/api/branches', ['name' => 'فرع آخر'])->assertCreated()['data']['id'];
        $foreign = ProductCategory::withoutGlobalScope(BranchScope::class)->create(['name' => 'زيوت', 'branch_id' => $otherId]);
        app(BranchContext::class)->set($mainId);

        $rows = [
            ['name' => 'زيوت'],
            ['name' => 'فلاتر', 'parent_path' => 'زيوت'],
        ];
        $create = $this->service()->preview($this->file($rows), ['kind' => 'category']);
        $this->assertSame(['error', 'error'], $this->actions($create));
        $this->assertStringContainsString('خارج نطاق فرعك', $create['errors'][0]['messages'][0]);
        $this->assertStringContainsString('غير متاح في نطاق فرعك', $create['errors'][1]['messages'][0]);

        $update = $this->service()->preview($this->file([['name' => 'زيوت', 'description' => 'x']]), ['kind' => 'category', 'mode' => 'update']);
        $this->assertSame(['error'], $this->actions($update));
        $this->assertNull(ProductCategory::withoutGlobalScope(BranchScope::class)->whereKey($foreign->id)->value('description'));
    }

    // ═══════════════════════════════ العلامات التجارية ═══════════════════════════════

    /** @test */
    public function brands_are_created_updated_and_deduplicated_by_name(): void
    {
        Brand::create(['name' => 'تويوتا']);
        $rows = [['name' => 'تويوتا', 'is_active' => 'لا'], ['name' => 'هيونداي'], ['name' => 'كيا', 'is_active' => 'لا']];

        $create = $this->service()->preview($this->file($rows), ['kind' => 'brand']);
        $this->assertSame(['error', 'create', 'create'], $this->actions($create));

        $result = $this->service()->apply($this->file($rows), ['kind' => 'brand', 'mode' => 'upsert']);

        $this->assertSame([2, 1, 0], [$result['created'], $result['updated'], $result['skipped']]);
        $this->assertSame([false, true, false], [
            (bool) Brand::query()->where('name', 'تويوتا')->value('is_active'),
            (bool) Brand::query()->where('name', 'هيونداي')->value('is_active'),
            (bool) Brand::query()->where('name', 'كيا')->value('is_active'),
        ]);
    }

    /** @test */
    public function a_brand_is_not_renamed_by_nebrax_id_and_a_duplicate_name_in_the_file_fails_it(): void
    {
        $brand = Brand::create(['name' => 'تويوتا']);

        $rename = $this->service()->preview($this->file([['nebrax_id' => $brand->id, 'name' => 'اسم آخر']]), ['kind' => 'brand', 'mode' => 'update']);
        $this->assertSame(['error'], $this->actions($rename));
        $this->assertStringContainsString('لا يعيد تسمية', $rename['errors'][0]['messages'][0]);

        $this->expectException(ImportUnitFailureException::class);
        $this->service()->apply($this->file([['name' => 'أ'], ['name' => 'أ']]), ['kind' => 'brand']);
    }

    /** @test */
    public function a_brand_in_another_isolated_branch_blocks_the_name(): void
    {
        BranchSettings::merge(['share_products' => false]);
        $mainId = $this->withToken($this->token)->getJson('/api/branches')['data'][0]['id'];
        $otherId = $this->withToken($this->token)->postJson('/api/branches', ['name' => 'فرع آخر'])->assertCreated()['data']['id'];
        Brand::withoutGlobalScope(BranchScope::class)->create(['name' => 'تويوتا', 'branch_id' => $otherId]);
        app(BranchContext::class)->set($mainId);

        $preview = $this->service()->preview($this->file([['name' => 'تويوتا']]), ['kind' => 'brand', 'mode' => 'upsert']);

        $this->assertSame(['error'], $this->actions($preview));
        $this->assertStringContainsString('خارج نطاق فرعك', $preview['errors'][0]['messages'][0]);
    }

    // ═══════════════════════════════ لا آثار جانبية ═══════════════════════════════

    /** @test */
    public function importing_touches_no_products_and_posts_no_journal_entries(): void
    {
        $product = Product::create(['name' => 'منتج', 'type' => 'good', 'sale_price' => 1000]);
        $before = [Product::query()->count(), JournalEntry::query()->count(), $product->updated_at?->toISOString()];

        $this->service()->apply($this->file([['name' => 'زيوت']]), ['kind' => 'category']);
        $this->service()->apply($this->file([['name' => 'تويوتا']]), ['kind' => 'brand']);

        $this->assertSame($before, [Product::query()->count(), JournalEntry::query()->count(), $product->refresh()->updated_at?->toISOString()]);
        $this->assertNull($product->category_id);
    }

    // ═══════════════════════════════ النوافذ والمعاينة ═══════════════════════════════

    /** @test */
    public function windows_apply_in_order_and_parents_created_by_one_window_serve_the_next(): void
    {
        $rows = [
            ['name' => 'أ', 'parent_path' => 'جذر'],
            ['name' => 'ب', 'parent_path' => 'جذر'],
            ['name' => 'ج', 'parent_path' => 'جذر'],
        ];
        $options = ['kind' => 'category', 'parent_policy' => 'create_missing'];

        $first = $this->service()->apply($this->file($rows), $options + ['batch_offset' => 0, 'batch_size' => 2]);
        $this->assertSame([2, 1, 3], [$first['created'], $first['implicit_parents_created'], $first['total_rows']]);

        $second = $this->service()->apply($this->file($rows), $options + ['batch_offset' => 2, 'batch_size' => 2]);
        $this->assertSame([1, 0], [$second['created'], $second['implicit_parents_created']]);
        $this->assertSame(['جذر', 'جذر > أ', 'جذر > ب', 'جذر > ج'], $this->paths());
    }

    /** @test */
    public function the_previewed_plan_stays_valid_across_windows_even_for_implicit_then_explicit_parents(): void
    {
        $rows = [
            ['name' => 'فرع', 'parent_path' => 'جذر'],
            ['name' => 'جذر', 'description' => 'لاحقاً'],
        ];
        $options = ['kind' => 'category', 'mode' => 'upsert', 'parent_policy' => 'create_missing'];
        $plan = $this->service()->previewWithPlan($this->file($rows), $options)['plan'];
        $this->assertSame(['c', 'u:'], [$plan[2], substr($plan[3], 0, 2)]);

        $this->service()->apply($this->file($rows), $options + ['expected_plan' => $plan, 'batch_offset' => 0, 'batch_size' => 1]);
        $this->service()->apply($this->file($rows), $options + ['expected_plan' => $plan, 'batch_offset' => 1, 'batch_size' => 1]);

        $this->assertSame('لاحقاً', ProductCategory::query()->where('name', 'جذر')->value('description'));
    }

    /** @test */
    public function a_changed_state_between_preview_and_apply_is_refused_as_drift(): void
    {
        $file = $this->file([['name' => 'زيوت']]);
        $planned = $this->service()->previewWithPlan($file, ['kind' => 'category', 'mode' => 'upsert'])['plan'];
        ProductCategory::create(['name' => 'زيوت']);

        $this->expectException(ImportPlanDriftException::class);
        $this->service()->apply($file, ['kind' => 'category', 'mode' => 'upsert', 'expected_plan' => $planned]);
    }

    /** @test */
    public function an_erroneous_row_aborts_the_window_with_no_partial_write(): void
    {
        $this->expectException(ImportUnitFailureException::class);
        try {
            $this->service()->apply($this->file([['name' => 'سليم'], ['name' => 'سيئ', 'color' => 'nope']]), ['kind' => 'category']);
        } finally {
            $this->assertSame(0, ProductCategory::query()->count());
        }
    }

    /** @test */
    public function a_row_wider_than_the_header_is_an_error_not_a_silent_truncation(): void
    {
        $file = UploadedFile::fake()->createWithContent('wide.csv', "name,description\nسليم,وصف\nعريض,شارع 1, مبنى 2\n");

        $preview = $this->service()->preview($file, ['kind' => 'category']);

        $this->assertSame(['create', 'error'], $this->actions($preview));
        $this->assertStringContainsString('يتجاوز صف العناوين', $preview['errors'][0]['messages'][0]);
    }

    // ═══════════════════════════════ المحوّل ═══════════════════════════════

    /** @test */
    public function the_adapter_declares_its_domain_and_canonicalises_options(): void
    {
        $adapter = app(ProductTaxonomyImportAdapter::class);

        $this->assertSame(['product_taxonomy', 'row'], [$adapter->domain(), $adapter->unit()]);
        $this->assertSame(ProductTaxonomyImportService::DURABLE_MAX_ROWS, $adapter->maxRows());
        $this->assertSame([], $adapter->sensitiveColumnIndexes(['a'], []));
        $this->assertSame(
            ['kind' => 'category', 'mode' => 'create', 'blank_policy' => 'ignore', 'parent_policy' => 'create_missing', 'mapping' => ['0' => 'name', '1' => null]],
            $adapter->canonicalOptions(['kind' => 'category', 'parent_policy' => 'create_missing', 'mapping' => [1 => null, 0 => 'name'], 'ignored_key' => 'x']),
        );
    }

    /** @test */
    public function the_adapter_chunk_writes_through_the_service_and_reports_processed_units(): void
    {
        $file = $this->file([['name' => 'أ'], ['name' => 'ب'], ['name' => 'ج']]);
        $chunk = new ImportChunk(new ImportJob, $file, null, ['kind' => 'brand', 'mode' => 'create'], 0, 2, null, true);

        $result = app(ProductTaxonomyImportAdapter::class)->applyChunk($chunk);

        $this->assertSame(2, $result->processedUnits);
        $this->assertSame(['أ', 'ب'], Brand::query()->orderBy('name')->pluck('name')->all());
    }
}
