<?php

namespace Tests\Feature;

use App\Models\Employee;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\PaymentAttachment;
use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class PaymentCollectionDetailsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** بيانات التحصيل والمرفقات وصفية، وتبقى حالة المسودة بلا قيد حتى تأكيد التحصيل. */
    /** @test */
    public function collection_details_default_to_the_current_users_employee_and_keep_a_private_attachment(): void
    {
        Storage::fake('local');
        $auth = $this->registerTenant('collection-details', 'owner@collection-details.test');
        app(TenantContext::class)->set($auth['tenant_id']);

        $collector = Employee::create([
            'employee_no' => 'EMP-00001',
            'name' => 'موظف التحصيل',
            'job_title' => 'محصّل',
        ]);
        User::where('email', 'owner@collection-details.test')->firstOrFail()->update(['employee_id' => $collector->id]);
        $customer = Partner::create(['name' => 'عميل التحصيل', 'type' => 'customer']);

        $payment = $this->withToken($auth['token'])->post('/api/payments', [
            'partner_id' => $customer->id,
            'direction' => 'received',
            'method' => 'cash',
            'amount' => 125000,
            'reference' => 'REF-2026-001',
            'payment_details' => 'تم الاستلام عبر جهاز نقاط البيع.',
            'notes' => 'إيصال العميل الأصلي مرفق.',
            'attachments' => [UploadedFile::fake()->create('receipt.pdf', 120, 'application/pdf')],
        ], ['Accept' => 'application/json'])->assertCreated()
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.payment_details', 'تم الاستلام عبر جهاز نقاط البيع.')
            ->assertJsonPath('data.collector_employee_id', $collector->id)
            ->assertJsonPath('data.collector_employee_name', 'موظف التحصيل')
            ->assertJsonCount(1, 'data.attachments')['data'];

        $stored = Payment::findOrFail($payment['id']);
        $this->assertSame('draft', $stored->status);
        $this->assertNull($stored->journal_entry_id);
        $attachment = PaymentAttachment::where('payment_id', $payment['id'])->firstOrFail();
        Storage::disk('local')->assertExists($attachment->path);

        $this->withToken($auth['token'])
            ->get("/api/payments/{$payment['id']}/attachments/{$attachment->id}")
            ->assertOk()
            ->assertDownload('receipt.pdf');

        $this->withToken($auth['token'])->postJson("/api/payments/{$payment['id']}/post")
            ->assertOk()
            ->assertJsonPath('data.status', 'posted');

        $posted = Payment::findOrFail($payment['id']);
        $this->assertNotNull($posted->journal_entry_id);
        $this->assertSame($collector->id, $posted->collector_employee_id);
    }

    /** مرفق سند لا يمكن تنزيله تحت سند آخر حتى لو كان المستخدم ضمن المستأجر نفسه. */
    /** @test */
    public function a_payment_attachment_is_bound_to_its_visible_payment(): void
    {
        Storage::fake('local');
        $auth = $this->registerTenant('collection-attachments', 'owner@collection-attachments.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);

        $first = $this->withToken($auth['token'])->post('/api/payments', [
            'partner_id' => $customer->id,
            'direction' => 'received',
            'method' => 'cash',
            'amount' => 100000,
            'attachments' => [UploadedFile::fake()->create('proof.pdf', 120, 'application/pdf')],
        ], ['Accept' => 'application/json'])->assertCreated()['data'];
        $second = $this->withToken($auth['token'])->postJson('/api/payments', [
            'partner_id' => $customer->id,
            'direction' => 'received',
            'method' => 'cash',
            'amount' => 100000,
        ])->assertCreated()['data'];

        $attachment = PaymentAttachment::where('payment_id', $first['id'])->firstOrFail();
        $this->withToken($auth['token'])
            ->getJson("/api/payments/{$second['id']}/attachments/{$attachment->id}")
            ->assertNotFound();
    }
}
