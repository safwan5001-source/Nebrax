<?php

namespace Tests\Feature;

use App\Models\Classification;
use App\Models\Partner;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PaymentService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبار عقد نقطة عرض السند (GET /api/payments/{id}) الذي يغذّي مستند سند القبض/الصرف:
 * يعيد الملاحظات وتخصيصات السند (نصّ المستند + المبلغ). لا قيود جديدة — عرض فقط.
 * تشغيل: php artisan test --filter=PaymentVoucherApiTest
 */
class PaymentVoucherApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function show_returns_notes_and_allocations_for_the_voucher(): void
    {
        ['token' => $token, 'tenant_id' => $tid] = $this->registerTenant('nibras', 'owner@nibras.test');
        app(TenantContext::class)->set($tid);

        $customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $invoice = app(InvoiceService::class)->post(app(InvoiceService::class)->create(
            ['partner_id' => $customer->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]] // 115000
        ));

        $payment = app(PaymentService::class)->post(app(PaymentService::class)->create(
            ['partner_id' => $customer->id, 'amount' => 115000, 'notes' => 'دفعة كاملة'],
            [['invoice_id' => $invoice->id, 'amount' => 115000]]
        ));

        $this->withToken($token)->getJson("/api/payments/{$payment->id}")
            ->assertOk()
            ->assertJsonPath('data.notes', 'دفعة كاملة')
            ->assertJsonCount(1, 'data.allocations')
            ->assertJsonPath('data.allocations.0.label', $invoice->number)
            ->assertJsonPath('data.allocations.0.amount', '1150.00');
    }

    /** @test */
    public function show_loads_the_classification_for_the_voucher_and_isolates_tenants(): void
    {
        ['token' => $token, 'tenant_id' => $tid] = $this->registerTenant('classified', 'owner@classified.test');
        ['tenant_id' => $otherTid] = $this->registerTenant('foreign', 'owner@foreign.test');

        app(TenantContext::class)->set($otherTid);
        $foreign = Classification::create(['scope' => 'receipt', 'name' => 'تصنيف مؤسسة أخرى']);

        app(TenantContext::class)->set($tid);
        $customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $classification = Classification::create(['scope' => 'receipt', 'name' => 'تسوية عملاء']);
        $draft = fn () => app(PaymentService::class)->create(
            ['partner_id' => $customer->id, 'amount' => 50000],
            []
        );

        // تصنيف المؤسسة نفسها يصل في استجابة التفاصيل.
        $withClassification = $draft();
        $this->withToken($token)->putJson("/api/payments/{$withClassification->id}/classification", ['classification_id' => $classification->id])->assertOk();
        $this->withToken($token)->getJson("/api/payments/{$withClassification->id}")
            ->assertOk()
            ->assertJsonPath('data.classification_id', $classification->id)
            ->assertJsonPath('data.classification.id', $classification->id)
            ->assertJsonPath('data.classification.name', 'تسوية عملاء')
            ->assertJsonPath('data.classification.scope', 'receipt');

        // بلا تصنيف: المفتاح موجود وقيمته null (لا اختلاق).
        // إزالة التصنيف عبر المسار نفسه ⇒ المفتاح موجود وقيمته null.
        $without = $withClassification;
        $this->withToken($token)->putJson("/api/payments/{$without->id}/classification", ['classification_id' => null])->assertOk();
        $this->withToken($token)->getJson("/api/payments/{$without->id}")
            ->assertOk()
            ->assertJsonPath('data.classification_id', null)
            ->assertJsonPath('data.classification', null);

        // معرّف تصنيف مؤسسة أخرى (مدخل مباشر بتجاوز الخدمة) لا يُحلّ ولا يُسرَّب اسمه.
        \DB::table('payments')->where('id', $without->id)->update(['classification_id' => $foreign->id]);
        $this->withToken($token)->getJson("/api/payments/{$without->id}")
            ->assertOk()
            ->assertJsonPath('data.classification', null)
            ->assertDontSee('تصنيف مؤسسة أخرى');
    }

    /** @test */
    public function receipt_voucher_drafts_can_be_updated_duplicated_and_deleted_but_posted_ones_cannot(): void
    {
        ['token' => $token, 'tenant_id' => $tid] = $this->registerTenant('drafts', 'owner@drafts.test');
        app(TenantContext::class)->set($tid);
        $customer = Partner::create(['name' => 'عميل مسودة', 'type' => 'customer']);
        $payment = app(PaymentService::class)->create(['partner_id' => $customer->id, 'amount' => 100000]);

        $this->withToken($token)->putJson("/api/payments/{$payment->id}", [
            'partner_id' => $customer->id,
            'direction' => 'received',
            'method' => 'bank',
            'amount' => 200000,
            'notes' => 'محدّث',
        ])->assertOk()
            ->assertJsonPath('data.amount', '2000.00')
            ->assertJsonPath('data.notes', 'محدّث');

        $copy = $this->withToken($token)->postJson("/api/payments/{$payment->id}/duplicate")
            ->assertCreated()['data'];
        $this->assertSame('draft', $copy['status']);
        $this->assertNotSame($payment->id, $copy['id']);
        $this->assertNotSame($payment->number, $copy['number']);
        // السند التاريخي بلا فرع يُنسخ في الفرع النشط للطلب، بسلسلة ذلك الفرع؛
        // أما السند الموسوم فيبقى في نطاق فرعه المصدر داخل الخدمة.
        $this->assertDatabaseHas('payments', ['id' => $copy['id']]);
        $this->assertNotNull(\App\Models\Payment::findOrFail($copy['id'])->branch_id);
        $this->assertEmpty($copy['allocations'] ?? []);

        $this->withToken($token)->deleteJson("/api/payments/{$payment->id}")->assertOk();
        $this->withToken($token)->getJson("/api/payments/{$payment->id}")->assertNotFound();

        $this->withToken($token)->postJson("/api/payments/{$copy['id']}/post")->assertOk();
        $this->withToken($token)->putJson("/api/payments/{$copy['id']}", [
            'partner_id' => $customer->id, 'direction' => 'received', 'method' => 'cash', 'amount' => 100000,
        ])->assertStatus(422);
        $this->withToken($token)->deleteJson("/api/payments/{$copy['id']}")->assertStatus(422);
    }
}
