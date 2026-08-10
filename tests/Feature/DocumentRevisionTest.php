<?php

namespace Tests\Feature;

use App\Models\DocumentRevision;
use App\Models\Invoice;
use App\Models\Quote;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  سجلّ تغييرات المستندات — يجعل التعديل الصامت مرئياً
 * ═══════════════════════════════════════════════════════════════
 *  ثلاثة أعطال (#165، #166) كانت تغيّر **مبالغ** الفواتير عند تعديل حقلٍ لا
 *  مالي، ولم يكشفها إلا مسحٌ متعمَّد للكود — لأن لا سجلّ يُراجَع. هذا السجلّ
 *  يحفظ لكل تغيير قيمتَه قبل وبعد وفاعلَه.
 *
 *  **لا أثر محاسبي**: لا قيد ولا رصيد ولا إجمالي. اختبار صريح أدناه يحرس ذلك.
 *
 *  تشغيل: php artisan test --filter=DocumentRevisionTest
 */
class DocumentRevisionTest extends TestCase
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

    private function invoice(array $extra = []): array
    {
        return $this->withToken($this->token)->postJson('/api/invoices', array_merge([
            'partner_id'   => $this->partnerId,
            'payment_type' => 'credit',
            'items'        => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ], $extra))->assertCreated()['data'];
    }

    private function revisionsOf(string $id): array
    {
        return $this->withToken($this->token)->getJson("/api/revisions/invoice/{$id}")->assertOk()['data'];
    }

    /** الإنشاء حدثٌ واحد لا سلسلة — رغم أن الخدمة تكتب الرأس ثم الإجماليات. */
    /** @test */
    public function creating_an_invoice_records_exactly_one_entry(): void
    {
        $invoice = $this->invoice();

        $log = $this->revisionsOf($invoice['id']);

        $this->assertCount(1, $log);
        $this->assertSame('created', $log[0]['action']);
    }

    /**
     * **جوهر الوحدة.** التعديل يُسجَّل بقيمة كل حقل قبلَ وبعد — وهو بالضبط ما
     * كان سيكشف أعطال #165/#166 يوم حدوثها بدل مسحٍ بعد أشهر.
     *
     * @test
     */
    public function an_edit_records_the_value_before_and_after(): void
    {
        $invoice = $this->invoice(['shipping' => 50000]);

        $this->withToken($this->token)->putJson("/api/invoices/{$invoice['id']}", [
            'partner_id' => $this->partnerId,
            'shipping'   => 20000,
            'notes'      => 'تخفيض الشحن',
            'items'      => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertOk();

        $log = $this->revisionsOf($invoice['id']);

        $this->assertCount(2, $log);            // إنشاء + تعديل
        $this->assertSame('updated', $log[0]['action']);

        $changes = $log[0]['changes'];
        $this->assertSame([50000, 20000], $changes['shipping']);
        $this->assertSame([null, 'تخفيض الشحن'], $changes['notes']);
        // والإجمالي المشتقّ يظهر متغيّراً معه — أثر التعديل لا مدخلاته وحدها
        // (١١٥٬٠٠٠ سلع + شحن ٥٠٬٠٠٠ وضريبته ٧٬٥٠٠ ⇒ ١٧٢٬٥٠٠ ← ١٣٨٬٠٠٠)
        $this->assertSame([172500, 138000], $changes['total']);
    }

    /**
     * التعديل الواحد قيدٌ واحد: الخدمة تكتب الرأس ثم الإجماليات في نداءين،
     * فلولا الدمج لقرأ المستخدم عمليةً واحدة سطرين متناقضين.
     *
     * @test
     */
    public function two_writes_in_one_request_merge_into_one_entry(): void
    {
        $invoice = $this->invoice();

        $this->withToken($this->token)->putJson("/api/invoices/{$invoice['id']}", [
            'partner_id' => $this->partnerId, 'notes' => 'ملاحظة',
            'items'      => [['description' => 'خدمة', 'quantity' => 2, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertOk();

        $log = $this->revisionsOf($invoice['id']);

        $this->assertCount(2, $log);
        // الرأس (الملاحظة) والإجماليات في القيد نفسه
        $this->assertArrayHasKey('notes', $log[0]['changes']);
        $this->assertArrayHasKey('total', $log[0]['changes']);
    }

    /** الترحيل انتقال حالة — يُصنَّف كذلك ليقرأ الخطّ الزمني بوضوح. */
    /** @test */
    public function posting_is_recorded_as_a_status_change(): void
    {
        $invoice = $this->invoice();
        $this->withToken($this->token)->postJson("/api/invoices/{$invoice['id']}/post")->assertOk();

        $log = $this->revisionsOf($invoice['id']);

        $this->assertSame('status', $log[0]['action']);
        $this->assertSame(['draft', 'posted'], $log[0]['changes']['status']);
    }

    /** الفاعل مسجَّل — سجلٌّ بلا فاعل نصفُ سجلّ. */
    /** @test */
    public function the_acting_user_is_recorded(): void
    {
        $invoice = $this->invoice();
        $log = $this->revisionsOf($invoice['id']);

        $this->assertNotNull($log[0]['user_id']);
        $this->assertSame('المالك', $log[0]['user_name']);
    }

    /**
     * **الضمان الحاسم:** السجلّ لا يمسّ المحاسبة إطلاقاً.
     *
     * @test
     */
    public function the_log_never_touches_the_ledger(): void
    {
        $invoice = $this->invoice();
        $this->withToken($this->token)->putJson("/api/invoices/{$invoice['id']}", [
            'partner_id' => $this->partnerId, 'notes' => 'تعديل',
            'items'      => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertOk();

        $stored = Invoice::findOrFail($invoice['id']);
        $this->assertSame(115000, (int) $stored->total, 'الإجمالي لم يتأثّر بوجود السجلّ.');
        $this->assertNull($stored->journal_entry_id, 'ولا قيد وُلد.');
        $this->assertGreaterThan(0, DocumentRevision::count());
    }

    /** الحقول الضخمة (XML الفاتورة الإلكترونية) مستثناة فلا يتضخّم السجلّ. */
    /** @test */
    public function bulky_zatca_fields_are_not_logged(): void
    {
        $invoice = $this->invoice();
        $this->withToken($this->token)->postJson("/api/invoices/{$invoice['id']}/post")->assertOk();

        $changes = $this->revisionsOf($invoice['id'])[0]['changes'];

        $this->assertArrayNotHasKey('zatca_xml', $changes);
        $this->assertArrayNotHasKey('zatca_qr', $changes);
    }

    /** عرض السعر مسجَّل أيضاً — نفس الـ trait، بلا كود إضافي. */
    /** @test */
    public function quotes_are_logged_too(): void
    {
        $quote = $this->withToken($this->token)->postJson('/api/quotes', [
            'partner_id' => $this->partnerId,
            'items'      => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 100000]],
        ])->assertCreated()['data'];

        $log = $this->withToken($this->token)->getJson("/api/revisions/quote/{$quote['id']}")->assertOk()['data'];

        $this->assertCount(1, $log);
        $this->assertSame(Quote::class, DocumentRevision::firstOrFail()->document_type);
    }

    /** نوع غير معروف يُرفض بـ 404 — لا يُمرَّر اسم كلاس من العميل. */
    /** @test */
    public function an_unknown_document_type_is_rejected(): void
    {
        $invoice = $this->invoice();

        $this->withToken($this->token)
            ->getJson("/api/revisions/App%5CModels%5CUser/{$invoice['id']}")
            ->assertNotFound();
    }

    /**
     * سجلٌّ ينمو بلا حدّ يصير عبئاً. القديم يُشذَّب والحديث يبقى.
     * (`Prunable` من Laravel — `php artisan model:prune` مجدولاً.)
     *
     * @test
     */
    public function old_entries_are_pruned_and_recent_ones_kept(): void
    {
        $invoice = $this->invoice();
        $fresh   = DocumentRevision::firstOrFail();

        $stale = DocumentRevision::create([
            'document_type' => Invoice::class,
            'document_id'   => $invoice['id'],
            'action'        => 'updated',
            'diff'          => ['total' => [1, 2]],
        ]);
        // أقدم من مدّة الاحتفاظ بيوم واحد
        $stale->forceFill([
            'created_at' => now()->subDays(DocumentRevision::RETENTION_DAYS + 1),
        ])->saveQuietly();

        $this->artisan('model:prune', ['--model' => [DocumentRevision::class]])->assertSuccessful();

        $this->assertNull(DocumentRevision::find($stale->id), 'القديم شُذِّب.');
        $this->assertNotNull(DocumentRevision::find($fresh->id), 'والحديث بقي.');
    }

    /** العزل: سجلّ مستند مستأجرٍ آخر غير مرئي. */
    /** @test */
    public function a_tenant_cannot_read_another_tenants_log(): void
    {
        $invoice = $this->invoice();
        $other   = $this->registerTenant('other', 'other@nibras.test');

        $this->withToken($other['token'])
            ->getJson("/api/revisions/invoice/{$invoice['id']}")
            ->assertNotFound();
    }
}
