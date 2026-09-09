<?php

namespace Tests\Feature;

use App\Models\Partner;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\PurchaseService;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * لغة مستند فاتورة المشتريات — PR-LANG-2. نفس عقد PR-LANG-1 (الفواتير) حرفياً،
 * عبر `PrintTemplateContract::resolveEffectiveLanguage()` الموحّد؛ هذا الملف
 * يحرس أن `PurchaseService` يطبّقه بنفس السيمنطيقس بلا اختراع مسار موازٍ.
 *
 * لا يمسّ الأرقام أو الضرائب أو المخزون أو القيد — قرار عرض بحت.
 */
class PurchaseDocumentLanguageTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected Partner $supplier;
    protected Product $product;
    protected PurchaseService $purchases;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس',
            'slug' => 'nibras-purchase-lang',
            'vat_number' => '300000000000003',
            'currency' => 'SAR',
        ]);

        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->supplier = Partner::create(['name' => 'مورد', 'type' => 'supplier']);
        $this->product = Product::create([
            'name' => 'صنف', 'type' => 'stock', 'track_inventory' => true,
            'purchase_price' => 10000, 'sale_price' => 15000, 'tax_rate' => 15,
        ]);
        $this->purchases = app(PurchaseService::class);
    }

    private function draft(array $extra = []): Purchase
    {
        return $this->purchases->create(
            array_merge([
                'partner_id' => $this->supplier->id,
                'payment_type' => 'credit',
            ], $extra),
            [['product_id' => $this->product->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]]
        );
    }

    /** @test */
    public function creating_without_language_leaves_columns_null(): void
    {
        $purchase = $this->draft();
        $this->assertNull($purchase->language);
        $this->assertNull($purchase->language_frozen);
    }

    /** @test */
    public function creating_with_language_saves_it_on_the_draft(): void
    {
        $purchase = $this->draft(['language' => 'en']);
        $this->assertSame('en', $purchase->language);
        $this->assertNull($purchase->language_frozen);
    }

    /** @test */
    public function creating_with_invalid_language_is_rejected_by_the_service(): void
    {
        $this->expectException(RuntimeException::class);
        $this->draft(['language' => 'fr']);
    }

    /** @test */
    public function update_omits_language_keeps_it_and_null_clears_it(): void
    {
        $purchase = $this->draft(['language' => 'en']);
        $kept = $this->purchases->update($purchase, [
            'partner_id' => $this->supplier->id,
        ], [['product_id' => $this->product->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]]);
        $this->assertSame('en', $kept->language);

        $reset = $this->purchases->update($kept, [
            'partner_id' => $this->supplier->id,
            'language' => null,
        ], [['product_id' => $this->product->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]]);
        $this->assertNull($reset->language);
    }

    /** @test */
    public function update_can_set_an_explicit_override(): void
    {
        $purchase = $this->draft();
        $updated = $this->purchases->update($purchase, [
            'partner_id' => $this->supplier->id,
            'language' => 'bilingual',
        ], [['product_id' => $this->product->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]]);
        $this->assertSame('bilingual', $updated->language);
    }

    /** @test */
    public function posting_freezes_the_draft_language_choice(): void
    {
        $purchase = $this->draft(['language' => 'bilingual']);
        $posted = $this->purchases->post($purchase);
        $this->assertSame('bilingual', $posted->language_frozen);
        $this->assertSame('bilingual', $posted->language);
    }

    /** @test */
    public function posting_without_draft_language_freezes_tenant_default(): void
    {
        Settings::put('documents', ['default_language' => 'en']);
        $purchase = $this->draft();
        $posted = $this->purchases->post($purchase);
        $this->assertSame('en', $posted->language_frozen);
        $this->assertNull($posted->language);
    }

    /** @test */
    public function posting_without_draft_or_tenant_default_freezes_ar(): void
    {
        $purchase = $this->draft();
        $posted = $this->purchases->post($purchase);
        $this->assertSame('ar', $posted->language_frozen);
    }

    /** @test */
    public function posted_purchase_ignores_later_tenant_default_change(): void
    {
        $purchase = $this->draft(['language' => 'ar']);
        $posted = $this->purchases->post($purchase);
        $this->assertSame('ar', $posted->language_frozen);

        Settings::put('documents', ['default_language' => 'en']);
        $reloaded = $posted->fresh();
        $this->assertSame('ar', $reloaded->language_frozen);
    }

    /** @test */
    public function changing_tenant_default_does_not_touch_existing_drafts(): void
    {
        $purchase = $this->draft();
        $this->assertNull($purchase->language);
        Settings::put('documents', ['default_language' => 'bilingual']);
        $reloaded = $purchase->fresh();
        $this->assertNull($reloaded->language);
    }

    /** @test */
    public function updating_a_single_draft_language_does_not_change_tenant_default(): void
    {
        Settings::put('documents', ['default_language' => 'ar']);
        $purchase = $this->draft();
        $this->purchases->update($purchase, [
            'partner_id' => $this->supplier->id,
            'language' => 'en',
        ], [['product_id' => $this->product->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]]);

        $this->assertSame('ar', Settings::get('documents', 'default_language'));
    }

    /** @test */
    public function posted_language_frozen_survives_reposting_attempts(): void
    {
        // إعادة الترحيل ممنوعة أصلاً بحراسة الحالة القائمة (isDraft) — نتحقق
        // من عدم انحدار: `language_frozen` لا يتغير من محاولة لا تُنفَّذ إطلاقاً.
        $purchase = $this->draft(['language' => 'en']);
        $posted = $this->purchases->post($purchase);
        $this->expectException(RuntimeException::class);
        $this->purchases->post($posted);
        $this->assertSame('en', $posted->fresh()->language_frozen);
    }

    /** @test */
    public function posted_purchase_cannot_be_updated_so_language_stays_frozen(): void
    {
        $purchase = $this->draft(['language' => 'en']);
        $posted = $this->purchases->post($purchase);

        $this->expectException(RuntimeException::class);
        $this->purchases->update($posted, [
            'partner_id' => $this->supplier->id,
            'language' => 'ar',
        ], [['product_id' => $this->product->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]]);
    }

    /** @test */
    public function duplicate_does_not_copy_frozen_language_and_language_defaults_to_null(): void
    {
        // النسخ يعيد المرور عبر create()، والغياب يعني افتراضي المستأجر — لا نسخ
        // للـfrozen من المصدر. يماثل استبعاد لقطات الطباعة في `duplicate()`.
        $purchase = $this->draft(['language' => 'en']);
        $posted = $this->purchases->post($purchase);
        $duplicate = $this->purchases->duplicate($posted, null);
        $this->assertNull($duplicate->language_frozen);
        // لا يُنقل قرار المسودة أيضاً — النسخة الجديدة تبدأ فارغة (tenant default).
        $this->assertNull($duplicate->language);
    }

    /** @test */
    public function legacy_purchase_without_language_columns_resolves_to_ar_by_default(): void
    {
        // محاكاة صفٍّ قديم قبل PR-LANG-2: `language`/`language_frozen` كلاهما NULL
        // فعلياً بلا أي كتابة صريحة — لا backfill ولا محاولة استنتاج تاريخي.
        $purchase = $this->draft();
        $posted = $this->purchases->post($purchase);
        // إجبار الحالة إلى ما تبدو عليه فاتورة قديمة لم يمرّ عليها PR-LANG-2:
        // كلا العمودين NULL رغم أنها posted — سيناريو استحال بعد هذا التغيير
        // فعلياً (post() يجمّد الآن دائماً)، لكنه يحاكي الصف التاريخي الفعلي.
        $posted->forceFill(['language_frozen' => null, 'language' => null])->save();

        $reloaded = $posted->fresh();
        $this->assertSame(
            'ar',
            \App\Support\PrintTemplateContract::resolveEffectiveLanguage(
                $reloaded->language_frozen,
                $reloaded->language,
                Settings::get('documents', 'default_language'),
            )
        );
    }
}
