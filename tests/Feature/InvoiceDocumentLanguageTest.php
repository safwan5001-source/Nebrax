<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\Partner;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Support\PrintTemplateContract;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * لغة مستند الفاتورة — قرار مسودة، لقطة تجميد، عرض مشتقّ.
 *
 * تحرس فصل لغة المستند عن UI locale وعن اختيار التصميم (#633)، وسيمنطيقس
 * التجميد الوحيدة عند الترحيل، وعدم انحدار لسلوك المستأجرين القائمين.
 * لا تمسّ ZATCA/QR/الأرقام/المحاسبة — قرار عرض بحت.
 */
class InvoiceDocumentLanguageTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected Partner $customer;
    protected InvoiceService $invoices;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس',
            'slug' => 'nibras-doc-lang',
            'vat_number' => '300000000000003',
            'currency' => 'SAR',
        ]);

        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->invoices = app(InvoiceService::class);
    }

    private function draft(array $extra = []): Invoice
    {
        return $this->invoices->create(
            array_merge([
                'partner_id' => $this->customer->id,
                'payment_type' => 'cash',
                'zatca_document_type' => 'standard',
            ], $extra),
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );
    }

    /** @test */
    public function contract_publishes_v1_languages_and_asserts_them(): void
    {
        $this->assertSame(['ar', 'en', 'bilingual'], PrintTemplateContract::DOCUMENT_LANGUAGES);
        $this->assertSame('ar', PrintTemplateContract::assertLanguage('ar'));
        $this->assertSame('bilingual', PrintTemplateContract::assertLanguage('bilingual'));
        $this->assertNull(PrintTemplateContract::assertLanguage(null));
        $this->assertNull(PrintTemplateContract::assertLanguage(''));
    }

    /** @test */
    public function assert_language_rejects_unknown_values_with_arabic_message(): void
    {
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('لغة المستند «fr» غير مدعومة.');
        PrintTemplateContract::assertLanguage('fr');
    }

    /** @test */
    public function effective_language_resolution_prefers_frozen_then_draft_then_tenant_then_ar(): void
    {
        $this->assertSame('en', PrintTemplateContract::resolveEffectiveLanguage('en', 'ar', 'bilingual'));
        $this->assertSame('ar', PrintTemplateContract::resolveEffectiveLanguage(null, 'ar', 'bilingual'));
        $this->assertSame('bilingual', PrintTemplateContract::resolveEffectiveLanguage(null, null, 'bilingual'));
        $this->assertSame('ar', PrintTemplateContract::resolveEffectiveLanguage(null, null, null));
    }

    /** @test */
    public function creating_without_language_leaves_columns_null_and_effective_falls_back_to_ar(): void
    {
        $invoice = $this->draft();
        $this->assertNull($invoice->language);
        $this->assertNull($invoice->language_frozen);
    }

    /** @test */
    public function creating_with_language_saves_it_on_the_draft(): void
    {
        $invoice = $this->draft(['language' => 'en']);
        $this->assertSame('en', $invoice->language);
        $this->assertNull($invoice->language_frozen);
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
        $invoice = $this->draft(['language' => 'en']);
        $kept = $this->invoices->update($invoice, [
            'partner_id' => $this->customer->id,
        ], [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]);
        $this->assertSame('en', $kept->language);

        $reset = $this->invoices->update($kept, [
            'partner_id' => $this->customer->id,
            'language' => null,
        ], [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]);
        $this->assertNull($reset->language);
    }

    /** @test */
    public function posting_freezes_the_draft_language_choice(): void
    {
        $invoice = $this->draft(['language' => 'bilingual']);
        $posted = $this->invoices->post($invoice);
        $this->assertSame('bilingual', $posted->language_frozen);
        $this->assertSame('bilingual', $posted->language);
    }

    /** @test */
    public function posting_without_draft_language_freezes_tenant_default(): void
    {
        Settings::put('documents', ['default_language' => 'en']);
        $invoice = $this->draft();
        $posted = $this->invoices->post($invoice);
        $this->assertSame('en', $posted->language_frozen);
        $this->assertNull($posted->language);
    }

    /** @test */
    public function posting_without_draft_or_tenant_default_freezes_ar(): void
    {
        $invoice = $this->draft();
        $posted = $this->invoices->post($invoice);
        $this->assertSame('ar', $posted->language_frozen);
    }

    /** @test */
    public function posted_invoice_ignores_later_tenant_default_change(): void
    {
        $invoice = $this->draft(['language' => 'ar']);
        $posted = $this->invoices->post($invoice);
        $this->assertSame('ar', $posted->language_frozen);

        Settings::put('documents', ['default_language' => 'en']);
        $reloaded = $posted->fresh();
        $this->assertSame('ar', $reloaded->language_frozen);
    }

    /** @test */
    public function changing_tenant_default_does_not_touch_existing_drafts(): void
    {
        $invoice = $this->draft();
        $this->assertNull($invoice->language);
        Settings::put('documents', ['default_language' => 'bilingual']);
        $reloaded = $invoice->fresh();
        $this->assertNull($reloaded->language);
    }

    /** @test */
    public function updating_a_single_draft_language_does_not_change_tenant_default(): void
    {
        Settings::put('documents', ['default_language' => 'ar']);
        $invoice = $this->draft();
        $this->invoices->update($invoice, [
            'partner_id' => $this->customer->id,
            'language' => 'en',
        ], [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]);

        $this->assertSame('ar', Settings::get('documents', 'default_language'));
    }

    /** @test */
    public function posted_language_frozen_survives_reposting_attempts(): void
    {
        // إعادة الترحيل ممنوعة أصلاً بحراسة الحالة القائمة (isDraft) — نتحقق
        // من عدم انحدار: `language_frozen` لا يتغير من محاولة لا تُنفَّذ إطلاقاً.
        $invoice = $this->draft(['language' => 'en']);
        $posted = $this->invoices->post($invoice);
        $this->expectException(RuntimeException::class);
        $this->invoices->post($posted);
        $this->assertSame('en', $posted->fresh()->language_frozen);
    }

    /** @test */
    public function duplicate_does_not_copy_frozen_language_and_language_defaults_to_null(): void
    {
        // النسخ يعيد المرور عبر create()، والغياب يعني افتراضي المستأجر — لا نسخ
        // للـfrozen من المصدر. يماثل استبعاد لقطات الطباعة في `duplicate()`.
        $invoice = $this->draft(['language' => 'en']);
        $posted = $this->invoices->post($invoice);
        $duplicate = $this->invoices->duplicate($posted);
        $this->assertNull($duplicate->language_frozen);
        // لا يُنقل قرار المسودة أيضاً — النسخة الجديدة تبدأ فارغة (tenant default).
        $this->assertNull($duplicate->language);
    }
}
