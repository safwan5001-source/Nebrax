<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Product;
use App\Models\Tenant;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  سياسة البيع بلا رصيد — إعداد لكل مستأجر
 * ═══════════════════════════════════════════════════════════════
 *  `inventory.allow_negative_stock`:
 *   • `false` (الافتراض للجديد) → يُرفض البيع بأكثر من الرصيد بـ 422.
 *   • `true`  (المستأجر القائم) → يمرّ كما كان، بلا تغيير سلوك بترقية.
 *
 *  **لماذا الرفض هو الأصحّ:** الكمية السالبة أثرها مزدوج — 1140 يصير برصيد
 *  دائن، **والمتوسط المتحرك يُفسَد بعده** فتصير كل تكلفة بضاعة مباعة لاحقة
 *  خاطئة. اختبارٌ أدناه يقيس هذا الإفساد بالرقم.
 *
 *  تشغيل: php artisan test --filter=NegativeStockPolicyTest
 */
class NegativeStockPolicyTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private string $token;
    private string $partnerId;

    protected function setUp(): void
    {
        parent::setUp();

        $auth = $this->registerTenant();
        $this->token = $auth['token'];
        $this->partnerId = $this->withToken($this->token)
            ->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])
            ->assertCreated()['data']['id'];
    }

    private function product(int $qty = 3, int $cost = 10000): array
    {
        return $this->withToken($this->token)->postJson('/api/products', [
            'name' => 'إسمنت', 'sku' => 'CEM-1', 'type' => 'good',
            'purchase_price' => $cost, 'sale_price' => $cost * 2,
            'track_inventory' => true, 'initial_quantity' => $qty,
        ])->assertCreated()['data'];
    }

    /** يحاول بيع `quantity` ويُعيد الاستجابة (دون توكيد). */
    private function sell(string $productId, int $quantity)
    {
        $invoice = $this->withToken($this->token)->postJson('/api/invoices', [
            'partner_id' => $this->partnerId, 'payment_type' => 'cash',
            'items' => [['product_id' => $productId, 'quantity' => $quantity, 'unit_price' => 20000, 'tax_rate' => 0]],
        ])->assertCreated()['data'];

        return $this->withToken($this->token)->postJson("/api/invoices/{$invoice['id']}/post");
    }

    /** الافتراض للمستأجر الجديد: الرفض. */
    /** @test */
    public function a_new_tenant_defaults_to_rejecting_negative_stock(): void
    {
        $this->assertFalse(
            $this->withToken($this->token)->getJson('/api/inventory-settings')
                ->assertOk()['data']['allow_negative_stock']
        );
    }

    /**
     * **جوهر السياسة.** بيع ١٠ والمتاح ٣ يُرفض بـ 422، ولا يُترك أثر:
     * لا حركة مخزون ولا قيد ولا كمية سالبة.
     *
     * @test
     */
    public function selling_beyond_stock_is_rejected_and_leaves_no_trace(): void
    {
        $product = $this->product(3);
        $before  = (int) (Account::where('code', '1140')->first()->balance?->balance ?? 0);

        $this->sell($product['id'], 10)
            ->assertStatus(422)
            ->assertJsonFragment(['message' => 'الكمية المتاحة من «إسمنت» (3) أقل من المطلوب (10). '
                . 'لا يمكن البيع بأكثر من الرصيد — يمكن تغيير ذلك من إعدادات المخزون.']);

        $stored = Product::findOrFail($product['id']);
        $this->assertSame(3, $stored->quantity_on_hand, 'الكمية لم تُمسّ.');
        $this->assertSame($before, (int) Account::where('code', '1140')->first()->balance?->balance);
    }

    /** البيع في حدود الرصيد يمرّ طبعاً. */
    /** @test */
    public function selling_within_stock_still_works(): void
    {
        $product = $this->product(10);

        $this->sell($product['id'], 4)->assertOk();

        $this->assertSame(6, Product::findOrFail($product['id'])->quantity_on_hand);
    }

    /** والبيع بكامل الرصيد إلى الصفر مسموح — الحدّ هو السالب لا الصفر. */
    /** @test */
    public function selling_the_exact_remaining_quantity_is_allowed(): void
    {
        $product = $this->product(5);

        $this->sell($product['id'], 5)->assertOk();

        $this->assertSame(0, Product::findOrFail($product['id'])->quantity_on_hand);
    }

    /** تفعيل السياسة يُعيد السلوك السابق حرفياً — لمن يبيع ثم يستلم. */
    /** @test */
    public function enabling_the_setting_restores_the_previous_behaviour(): void
    {
        $product = $this->product(3);

        $this->withToken($this->token)
            ->putJson('/api/inventory-settings', ['allow_negative_stock' => true])->assertOk();

        $this->sell($product['id'], 10)->assertOk();

        $this->assertSame(-7, Product::findOrFail($product['id'])->quantity_on_hand);
    }

    /**
     * **قياس الضرر الذي تمنعه السياسة.** الكمية السالبة تُفسد المتوسط المتحرك:
     * شراءٌ لاحق يقسم الوارد على قاعدة سالبة فيخرج متوسطٌ مضخّم — وكل قيد
     * تكلفة بضاعة مباعة بعده خاطئ.
     *
     * @test
     */
    public function negative_stock_corrupts_the_moving_average(): void
    {
        $product = $this->product(3, 10000); // ٣ بمتوسط ١٠٠ ريال

        $this->withToken($this->token)
            ->putJson('/api/inventory-settings', ['allow_negative_stock' => true])->assertOk();
        $this->sell($product['id'], 10)->assertOk(); // ⇒ −٧

        // شراء ١٠ بتكلفة ٢٠٠ ريال الحقيقية
        $supplier = $this->withToken($this->token)
            ->postJson('/api/partners', ['name' => 'مورد', 'type' => 'supplier'])->assertCreated()['data'];
        $purchase = $this->withToken($this->token)->postJson('/api/purchases', [
            'partner_id' => $supplier['id'],
            'items' => [['product_id' => $product['id'], 'quantity' => 10, 'unit_price' => 20000, 'tax_rate' => 0]],
        ])->assertCreated()['data'];
        $this->withToken($this->token)->postJson("/api/purchases/{$purchase['id']}/post")->assertOk();

        $stored = Product::findOrFail($product['id']);
        $this->assertSame(3, $stored->quantity_on_hand);
        $this->assertSame(43333, (int) $stored->avg_cost, 'المتوسط تضخّم: ٤٣٣٫٣٣ بدل ٢٠٠٫٠٠.');
    }

    /** إرجاع المشتريات إخراجٌ كالبيع — فيخضع للسياسة نفسها. */
    /** @test */
    public function returning_more_than_held_to_a_supplier_is_rejected(): void
    {
        $product = $this->product(2);
        $supplier = $this->withToken($this->token)
            ->postJson('/api/partners', ['name' => 'مورد', 'type' => 'supplier'])->assertCreated()['data'];

        $return = $this->withToken($this->token)->postJson('/api/returns', [
            'type' => 'purchase', 'partner_id' => $supplier['id'], 'payment_type' => 'credit',
            'items' => [['product_id' => $product['id'], 'quantity' => 5, 'unit_price' => 10000, 'tax_rate' => 0]],
        ])->assertCreated()['data'];

        $this->withToken($this->token)->postJson("/api/returns/{$return['id']}/post")
            ->assertStatus(422);
    }

    /**
     * **الترحيل لا يغيّر سلوك القائمين.** هجرة 000044 تثبّت `true` لكل مستأجر
     * موجود وقت الترقية — فمن عنده مخزون سالب لا تتوقّف مبيعاته فجأةً.
     *
     * @test
     */
    public function the_migration_grandfathers_existing_tenants(): void
    {
        // مستأجر «قائم» بلا إعداد صريح — كما كان قبل الترقية
        $legacy = Tenant::create([
            'name' => 'مستأجر قديم', 'slug' => 'legacy',
            'vat_number' => '300000000000009', 'currency' => 'SAR',
        ]);
        DB::table('tenants')->where('id', $legacy->id)->update(['settings' => json_encode([])]);

        $this->runGrandfatherMigration();

        app(TenantContext::class)->set($legacy->id);
        $this->assertTrue(Settings::get('inventory', 'allow_negative_stock'), 'القائم يُبقى على سلوكه.');
    }

    /** والمفتاح المضبوط صراحةً لا تلمسه الهجرة. */
    /** @test */
    public function the_migration_never_overwrites_an_explicit_choice(): void
    {
        $tenant = Tenant::create([
            'name' => 'مستأجر مشدَّد', 'slug' => 'strict',
            'vat_number' => '300000000000008', 'currency' => 'SAR',
        ]);
        DB::table('tenants')->where('id', $tenant->id)
            ->update(['settings' => json_encode(['inventory' => ['allow_negative_stock' => false]])]);

        $this->runGrandfatherMigration();

        app(TenantContext::class)->set($tenant->id);
        $this->assertFalse(Settings::get('inventory', 'allow_negative_stock'));
    }

    /**
     * تشغيل هجرة 000044 مباشرةً.
     *
     * `artisan migrate --path` لا يُجدي هنا: الهجرة سُجّلت أصلاً في
     * `RefreshDatabase` فيتخطّاها الـ migrator صامتاً — ولاختبارٍ يمرّ بلا أن
     * يُشغّل ما يدّعي اختباره ضررٌ أكبر من غيابه.
     */
    private function runGrandfatherMigration(): void
    {
        (require database_path('migrations/2025_01_01_000044_grandfather_negative_stock_policy.php'))->up();
    }

    /**
     * **الحقل المعروض ولا يُكتب.** التتبع التفصيلي (رقم مسلسل/شحنة/صلاحية)
     * غير مبنيّ: لا جدول دفعات ولا طبقة تكلفة لكل دفعة. فتفعيله يُرفض برسالة
     * مفهومة — تخزين `true` لقدرة غير موجودة كذبٌ يبني عليه قارئٌ لاحق.
     *
     * @test
     */
    public function detailed_tracking_is_readable_but_cannot_be_enabled(): void
    {
        $this->assertFalse(
            $this->withToken($this->token)->getJson('/api/inventory-settings')
                ->assertOk()['data']['detailed_tracking_enabled']
        );

        $this->withToken($this->token)
            ->putJson('/api/inventory-settings', ['detailed_tracking_enabled' => true])
            ->assertStatus(422)
            ->assertJsonValidationErrors('detailed_tracking_enabled');

        // إطفاؤه صراحةً مقبول — لا رفض لما لا يغيّر شيئاً.
        $this->withToken($this->token)
            ->putJson('/api/inventory-settings', ['detailed_tracking_enabled' => false])
            ->assertOk();
    }

    /** الرفض لا يُسقط الحقول الأخرى في الطلب نفسه: لا حفظ جزئي. */
    /** @test */
    public function a_rejected_tracking_flag_saves_nothing_else(): void
    {
        $this->withToken($this->token)->putJson('/api/inventory-settings', [
            'allow_negative_stock'      => true,
            'detailed_tracking_enabled' => true,
        ])->assertStatus(422);

        $this->assertFalse(
            $this->withToken($this->token)->getJson('/api/inventory-settings')['data']['allow_negative_stock'],
            'التحقق يسبق الحفظ، فلا يمرّ نصف الطلب.'
        );
    }

    /** عرض الكميات تفضيل عرض بحت — يُحفظ ولا يمسّ رصيداً ولا قيداً. */
    /** @test */
    public function showing_quantities_is_a_display_preference_only(): void
    {
        $product = $this->product(5);

        $this->assertTrue(
            $this->withToken($this->token)->getJson('/api/inventory-settings')['data']['show_stock_quantities'],
            'الافتراض العرض — لا إخفاء بلا طلب.'
        );

        $this->withToken($this->token)
            ->putJson('/api/inventory-settings', ['show_stock_quantities' => false])->assertOk();

        // الرصيد كما هو، والبيع يعمل: الإخفاء عرضٌ لا سياسة.
        $this->assertSame(5, Product::findOrFail($product['id'])->quantity_on_hand);
        $this->sell($product['id'], 2)->assertOk();
        $this->assertSame(3, Product::findOrFail($product['id'])->quantity_on_hand);
    }

    /** حفظ مفتاح لا يمسّ إخوته في المجموعة نفسها. */
    /** @test */
    public function saving_one_key_leaves_its_siblings_untouched(): void
    {
        $this->withToken($this->token)
            ->putJson('/api/inventory-settings', ['allow_negative_stock' => true])->assertOk();

        $this->withToken($this->token)
            ->putJson('/api/inventory-settings', ['show_stock_quantities' => false])->assertOk();

        $data = $this->withToken($this->token)->getJson('/api/inventory-settings')['data'];
        $this->assertTrue($data['allow_negative_stock'], 'المفتاح غير المرسَل يبقى كما هو.');
        $this->assertFalse($data['show_stock_quantities']);
    }

    /** السياسة معزولة بالمستأجر. */
    /** @test */
    public function the_policy_is_isolated_per_tenant(): void
    {
        $this->withToken($this->token)
            ->putJson('/api/inventory-settings', ['allow_negative_stock' => true])->assertOk();

        $other = $this->registerTenant('other', 'other@nibras.test');

        $this->assertFalse(
            $this->withToken($other['token'])->getJson('/api/inventory-settings')['data']['allow_negative_stock']
        );
    }
}
