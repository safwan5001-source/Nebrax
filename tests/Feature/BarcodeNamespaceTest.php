<?php

namespace Tests\Feature;

use App\Models\BarcodeRegistryEntry;
use App\Models\Product;
use App\Models\ProductBarcode;
use App\Support\SpreadsheetWriter;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PR-UOM-1 — فضاء الباركود الموحّد: أساسي وبديل، تفرّدٌ ذرّي على مستوى المستأجر
 * ═══════════════════════════════════════════════════════════════
 *  العلّة المؤكَّدة: `Product.barcode` (الأساسي) و`ProductBarcode.code`
 *  (البديل) كانا يُفحصان بـ`exists()` منفصلين — غير متماثلين (تحقّق الإنشاء
 *  لا يفحص الجدول البديل إطلاقاً)، وغير ذرّيين تحت التزامن. `barcode_registry`
 *  صفٌّ واحد لكل كود مستعمَل، بقيدٍ فريد `(tenant_id, code)`.
 *
 *  تشغيل: php artisan test --filter=BarcodeNamespaceTest
 */
class BarcodeNamespaceTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private function product(string $token, array $overrides = []): array
    {
        return $this->withToken($token)->postJson('/api/products', array_merge([
            'name' => 'منتج', 'sku' => 'BC-'.uniqid(), 'type' => 'good',
            'unit' => 'piece', 'sale_price' => 10000,
        ], $overrides))->assertCreated()['data'];
    }

    // ═══════════════════════════════════════════════════════════
    //  the four collision directions within one tenant
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function primary_conflicts_with_primary(): void
    {
        $auth = $this->registerTenant();
        $this->product($auth['token'], ['barcode' => 'CODE-1']);

        $this->withToken($auth['token'])
            ->postJson('/api/products', [
                'name' => 'ثانٍ', 'sku' => 'BC-'.uniqid(), 'type' => 'good',
                'unit' => 'piece', 'sale_price' => 10000, 'barcode' => 'CODE-1',
            ])->assertStatus(422);

        $this->assertSame(1, BarcodeRegistryEntry::where('code', 'CODE-1')->count());
    }

    /** @test */
    public function primary_conflicts_with_an_existing_alternate(): void
    {
        $auth = $this->registerTenant();
        $owner = $this->product($auth['token']);
        $this->withToken($auth['token'])
            ->postJson("/api/products/{$owner['id']}/barcodes", ['code' => 'CODE-2', 'unit_name' => 'piece'])
            ->assertCreated();

        $this->withToken($auth['token'])
            ->postJson('/api/products', [
                'name' => 'ثانٍ', 'sku' => 'BC-'.uniqid(), 'type' => 'good',
                'unit' => 'piece', 'sale_price' => 10000, 'barcode' => 'CODE-2',
            ])->assertStatus(422);
    }

    /** @test */
    public function alternate_conflicts_with_an_existing_primary(): void
    {
        $auth = $this->registerTenant();
        $this->product($auth['token'], ['barcode' => 'CODE-3']);
        $other = $this->product($auth['token']);

        $this->withToken($auth['token'])
            ->postJson("/api/products/{$other['id']}/barcodes", ['code' => 'CODE-3', 'unit_name' => 'piece'])
            ->assertStatus(422);
    }

    /** @test */
    public function alternate_conflicts_with_another_products_alternate(): void
    {
        $auth = $this->registerTenant();
        $first = $this->product($auth['token']);
        $second = $this->product($auth['token']);
        $this->withToken($auth['token'])
            ->postJson("/api/products/{$first['id']}/barcodes", ['code' => 'CODE-4', 'unit_name' => 'piece'])
            ->assertCreated();

        $this->withToken($auth['token'])
            ->postJson("/api/products/{$second['id']}/barcodes", ['code' => 'CODE-4', 'unit_name' => 'piece'])
            ->assertStatus(422);

        $this->assertSame(1, ProductBarcode::where('code', 'CODE-4')->count());
    }

    // ═══════════════════════════════════════════════════════════
    //  cross-tenant is allowed
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function the_same_barcode_in_a_different_tenant_does_not_conflict(): void
    {
        $authA = $this->registerTenant('tenant-a', 'a@nibras.test');
        $this->product($authA['token'], ['barcode' => 'SHARED-1']);

        $authB = $this->registerTenant('tenant-b', 'b@nibras.test');
        $this->withToken($authB['token'])
            ->postJson('/api/products', [
                'name' => 'منتج ب', 'sku' => 'BC-'.uniqid(), 'type' => 'good',
                'unit' => 'piece', 'sale_price' => 10000, 'barcode' => 'SHARED-1',
            ])->assertCreated();

        $this->assertSame(2, BarcodeRegistryEntry::withoutGlobalScopes()->where('code', 'SHARED-1')->count());
    }

    // ═══════════════════════════════════════════════════════════
    //  soft-deleted / deactivated historical identity protection
    // ═══════════════════════════════════════════════════════════

    /** تعطيلٌ محضٌ (`is_active=false`) لا يحرّر الباركود — الهوية التاريخية قد تبقى قائمة. */
    /** @test */
    public function a_deactivated_products_barcode_is_never_released(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token'], ['barcode' => 'CODE-5']);

        $this->withToken($auth['token'])->putJson("/api/products/{$product['id']}", [
            'name' => $product['name'], 'type' => 'good', 'unit' => 'piece',
            'sale_price' => 10000, 'is_active' => false,
        ])->assertOk();

        $this->assertTrue(BarcodeRegistryEntry::isTaken('CODE-5'));
        $this->withToken($auth['token'])
            ->postJson('/api/products', [
                'name' => 'آخر', 'sku' => 'BC-'.uniqid(), 'type' => 'good',
                'unit' => 'piece', 'sale_price' => 10000, 'barcode' => 'CODE-5',
            ])->assertStatus(422);
    }

    /**
     * حذفٌ حقيقيّ (soft-delete عبر `ProductLifecycleService::delete()`) لا
     * يُقبل إلا حين لا توجد أي مراجع تاريخية للمنتج أصلاً — فتحرير باركوده
     * حينها لا يكسر أي هوية قائمة، بخلاف التعطيل أعلاه.
     */
    /** @test */
    public function a_truly_deleted_products_barcode_is_released_and_reusable(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token'], ['barcode' => 'CODE-6']);

        $this->withToken($auth['token'])->deleteJson("/api/products/{$product['id']}")->assertOk();

        $this->assertFalse(BarcodeRegistryEntry::isTaken('CODE-6'));
        $this->withToken($auth['token'])
            ->postJson('/api/products', [
                'name' => 'جديد', 'sku' => 'BC-'.uniqid(), 'type' => 'good',
                'unit' => 'piece', 'sale_price' => 10000, 'barcode' => 'CODE-6',
            ])->assertCreated();
    }

    // ═══════════════════════════════════════════════════════════
    //  atomicity / DB-level enforcement (race), not app-level exists() alone
    // ═══════════════════════════════════════════════════════════

    /**
     * الفحص المسبق (`isTaken`) وحده لا يمنع سباقاً؛ القيد الفريد في
     * `barcode_registry` هو الضامن الفعلي. نحاكي السباق بتخطّي الفحص
     * المسبق ومحاولة `claim()` مباشرة على كودٍ تحجزه صفٌّ آخر بالفعل —
     * فيفشل عند الإدراج نفسه، لا قبله.
     */
    /** @test */
    public function a_concurrent_claim_is_rejected_by_the_unique_constraint_not_just_the_pre_check(): void
    {
        $auth = $this->registerTenant();
        $first = $this->product($auth['token'], ['barcode' => 'RACE-1']);
        $second = $this->product($auth['token']);

        // محاكاة سباق: إدراجٌ مباشر في الجدول يتخطّى فحص isTaken تماماً —
        // فيبقى القيد الفريد وحده هو ما يرفضه.
        $this->expectException(\RuntimeException::class);
        BarcodeRegistryEntry::claim('RACE-1', $second['id'], 'primary');
    }

    /** القيد الفريد نفسه، مباشرةً على الجدول — يثبت أن الذرّية من قاعدة البيانات لا التطبيق. */
    /** @test */
    public function the_database_unique_index_rejects_a_duplicate_row_directly(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);

        BarcodeRegistryEntry::create(['code' => 'DB-LEVEL-1', 'product_id' => $product['id'], 'kind' => 'primary']);

        $this->expectException(QueryException::class);
        DB::table('barcode_registry')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => BarcodeRegistryEntry::where('code', 'DB-LEVEL-1')->value('tenant_id'),
            'code' => 'DB-LEVEL-1',
            'product_id' => $product['id'],
            'kind' => 'alternate',
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    // ═══════════════════════════════════════════════════════════
    //  rollback / atomicity of the surrounding write
    // ═══════════════════════════════════════════════════════════

    /** رفضٌ عند الحفظ يترك المنتج والباركود كما كانا — لا حفظ جزئي. */
    /** @test */
    public function a_rejected_barcode_update_leaves_no_partial_write(): void
    {
        $auth = $this->registerTenant();
        $this->product($auth['token'], ['barcode' => 'TAKEN-1']);
        $product = $this->product($auth['token'], ['barcode' => 'ORIGINAL-1']);

        $this->withToken($auth['token'])->putJson("/api/products/{$product['id']}", [
            'name' => $product['name'], 'type' => 'good', 'unit' => 'piece',
            'sale_price' => 10000, 'barcode' => 'TAKEN-1',
        ])->assertStatus(422);

        $this->assertSame('ORIGINAL-1', Product::findOrFail($product['id'])->barcode, 'الباركود الأصلي لم يتحرّك.');
        $this->assertTrue(BarcodeRegistryEntry::isTaken('ORIGINAL-1'));
        $this->assertSame(1, BarcodeRegistryEntry::where('code', 'TAKEN-1')->count(), 'لا نسخة إضافية لباركودٍ مأخوذ.');
    }

    /** رفض إنشاء باركود بديل لا يترك صفّاً يتيماً في `product_barcodes` ولا في السجل الموحّد. */
    /** @test */
    public function a_rejected_alternate_barcode_creation_leaves_no_orphan_row(): void
    {
        $auth = $this->registerTenant();
        $this->product($auth['token'], ['barcode' => 'TAKEN-2']);
        $product = $this->product($auth['token']);

        $countBefore = ProductBarcode::count();

        $this->withToken($auth['token'])
            ->postJson("/api/products/{$product['id']}/barcodes", ['code' => 'TAKEN-2', 'unit_name' => 'piece'])
            ->assertStatus(422);

        $this->assertSame($countBefore, ProductBarcode::count(), 'لا صفّ باركود بديل تيتيم.');
    }

    // ═══════════════════════════════════════════════════════════
    //  changing/removing a primary barcode frees it correctly
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function changing_a_products_primary_barcode_frees_the_old_code_for_reuse(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token'], ['barcode' => 'OLD-CODE']);

        $this->withToken($auth['token'])->putJson("/api/products/{$product['id']}", [
            'name' => $product['name'], 'type' => 'good', 'unit' => 'piece',
            'sale_price' => 10000, 'barcode' => 'NEW-CODE',
        ])->assertOk();

        $this->assertFalse(BarcodeRegistryEntry::isTaken('OLD-CODE'));
        $this->withToken($auth['token'])
            ->postJson('/api/products', [
                'name' => 'آخر', 'sku' => 'BC-'.uniqid(), 'type' => 'good',
                'unit' => 'piece', 'sale_price' => 10000, 'barcode' => 'OLD-CODE',
            ])->assertCreated();
    }

    /** حذف باركودٍ بديل يحرّر السجل الموحّد أيضاً — لا تسجيلٌ يتيم. */
    /** @test */
    public function deleting_an_alternate_barcode_releases_it_from_the_registry(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);
        $barcode = $this->withToken($auth['token'])
            ->postJson("/api/products/{$product['id']}/barcodes", ['code' => 'ALT-FREE', 'unit_name' => 'piece'])
            ->assertCreated()['data'];

        $this->withToken($auth['token'])
            ->deleteJson("/api/products/{$product['id']}/barcodes/{$barcode['id']}")
            ->assertOk();

        $this->assertFalse(BarcodeRegistryEntry::isTaken('ALT-FREE'));
    }

    /**
     * حذف الباركود البديل وتحرير سجلّه معاملةٌ واحدة (PR-UOM-1 مراجعة): فشلٌ في
     * أيّ شطرٍ يتراجع عن الآخر أيضاً — لا يبقى سطر `product_barcodes` محذوفاً
     * وسجلّه في `barcode_registry` قائماً (أو العكس)، فلا يتباعد المصدر عن السجل.
     */
    /** @test */
    public function a_failure_releasing_the_registry_rolls_back_the_alternate_barcode_delete_too(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);
        $barcode = $this->withToken($auth['token'])
            ->postJson("/api/products/{$product['id']}/barcodes", ['code' => 'ATOMIC-DEL', 'unit_name' => 'piece'])
            ->assertCreated()['data'];

        // محاكاة فشلٍ حقيقي في نصف العملية الثاني (تحرير السجل) عبر استثناءٍ
        // يُطلَق فور تنفيذ عبارة الحذف على `barcode_registry` — لا موك لخدمةٍ
        // وسيطة (لا توجد واحدة هنا)، بل استثناءٌ حقيقي داخل نفس المعاملة يثبت
        // أن `DB::transaction` المضافة هي ما يحمي الذرّية فعلاً.
        DB::listen(function ($query): void {
            $sql = strtolower($query->sql);
            if (str_contains($sql, 'delete') && str_contains($sql, 'barcode_registry')) {
                throw new \RuntimeException('محاكاة فشل تحرير السجل — للاختبار فقط.');
            }
        });

        $this->withToken($auth['token'])
            ->deleteJson("/api/products/{$product['id']}/barcodes/{$barcode['id']}");

        $this->assertNotNull(ProductBarcode::find($barcode['id']), 'الحذف تراجع بالكامل — الصفّ ما زال قائماً.');
        $this->assertTrue(BarcodeRegistryEntry::isTaken('ATOMIC-DEL'), 'السجل لم يُحرَّر لأن المعاملة كلّها تراجعت.');
    }

    /**
     * وبالاتجاه المعاكس: فشلٌ في حجز السجل عند إنشاء باركودٍ بديل يتراجع عن
     * صفّ `product_barcodes` نفسه أيضاً — لا صفّ بديل يتيم بلا سجلٍّ يحميه.
     */
    /** @test */
    public function a_failure_claiming_the_registry_rolls_back_the_alternate_barcode_creation_too(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);
        $countBefore = ProductBarcode::count();

        DB::listen(function ($query): void {
            $sql = strtolower($query->sql);
            if (str_contains($sql, 'insert') && str_contains($sql, 'barcode_registry')) {
                throw new \RuntimeException('محاكاة فشل حجز السجل — للاختبار فقط.');
            }
        });

        $this->withToken($auth['token'])
            ->postJson("/api/products/{$product['id']}/barcodes", ['code' => 'ATOMIC-CREATE', 'unit_name' => 'piece']);

        $this->assertSame($countBefore, ProductBarcode::count(), 'لا صفّ باركود بديل تيتيم رغم فشل الحجز.');
        $this->assertFalse(BarcodeRegistryEntry::isTaken('ATOMIC-CREATE'));
    }

    // ═══════════════════════════════════════════════════════════
    //  import conflict uses the same namespace
    // ═══════════════════════════════════════════════════════════

    /** استيراد سطر بباركود يستعمله بالفعل باركودٌ بديلٌ لمنتجٍ آخر يُرفض — نفس الفضاء. */
    /** @test */
    public function importing_a_barcode_already_used_as_another_products_alternate_is_rejected(): void
    {
        $auth = $this->registerTenant();
        $owner = $this->product($auth['token'], ['sku' => 'IMP-OWNER']);
        $this->withToken($auth['token'])
            ->postJson("/api/products/{$owner['id']}/barcodes", ['code' => 'IMP-ALT-1', 'unit_name' => 'piece'])
            ->assertCreated();
        $this->product($auth['token'], ['sku' => 'IMP-TARGET']);

        $file = UploadedFile::fake()->createWithContent(
            'import.csv',
            SpreadsheetWriter::csv(['sku', 'barcode'], [['IMP-TARGET', 'IMP-ALT-1']])
        );

        $this->withToken($auth['token'])
            ->post('/api/products/import/preview', ['file' => $file, 'mode' => 'update'])
            ->assertOk()
            ->assertJsonPath('data.error_rows', 1);
    }
}
