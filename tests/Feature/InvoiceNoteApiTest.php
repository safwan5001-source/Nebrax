<?php

namespace Tests\Feature;

use App\Models\InvoiceNoteAttachment;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * ملاحظات ومرفقات الفاتورة سجل داخلي غير محاسبي:
 * يثبت التخزين الخاص، ولا يسمح بنطاق فرع آخر أو نوع ملف غير معتمد.
 */
class InvoiceNoteApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function it_stores_a_private_invoice_note_and_downloads_its_attachment(): void
    {
        Storage::fake('local');
        $auth = $this->registerTenant();
        $invoice = $this->invoice($auth['token']);

        $created = $this->withToken($auth['token'])->post("/api/invoices/{$invoice['id']}/notes", [
            'recorded_at' => '2026-08-20 11:15:00',
            'body' => 'تم استلام مستند الإثبات من العميل.',
            'attachments' => [UploadedFile::fake()->create('proof.pdf', 120, 'application/pdf')],
        ])->assertCreated()
            ->assertJsonPath('data.invoice_id', $invoice['id'])
            ->assertJsonPath('data.body', 'تم استلام مستند الإثبات من العميل.')
            ->assertJsonCount(1, 'data.attachments')['data'];

        $attachment = InvoiceNoteAttachment::findOrFail($created['attachments'][0]['id']);
        Storage::disk('local')->assertExists($attachment->path);

        $this->withToken($auth['token'])->getJson("/api/invoices/{$invoice['id']}/notes")
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $created['id'])
            ->assertJsonPath('data.0.attachments.0.original_name', 'proof.pdf');

        $this->withToken($auth['token'])->get("/api/invoices/{$invoice['id']}/notes/{$created['id']}/attachments/{$attachment->id}/download")
            ->assertOk()
            ->assertDownload('proof.pdf');
    }

    /** @test */
    public function it_rejects_an_attachment_outside_the_approved_document_types(): void
    {
        $auth = $this->registerTenant();
        $invoice = $this->invoice($auth['token']);

        $this->withToken($auth['token'])->post("/api/invoices/{$invoice['id']}/notes", [
            'attachments' => [UploadedFile::fake()->create('untrusted.exe', 10, 'application/octet-stream')],
        ])->assertUnprocessable()
            ->assertJsonValidationErrors('attachments.0');
    }

    /** @test */
    public function another_branch_cannot_read_or_write_notes_on_an_invoice_outside_its_scope(): void
    {
        $auth = $this->registerTenant();
        $token = $auth['token'];
        app(TenantContext::class)->set($auth['tenant_id']);

        $mainBranch = $this->withToken($token)->getJson('/api/branches')->assertOk()['data'][0]['id'];
        $otherBranch = $this->withToken($token)->postJson('/api/branches', ['name' => 'فرع مرفقات آخر'])->assertCreated()['data']['id'];
        $invoice = $this->invoice($token, $otherBranch);

        $this->withToken($token)->withHeaders(['X-Branch-Id' => $mainBranch])
            ->getJson("/api/invoices/{$invoice['id']}/notes")->assertNotFound();
        $this->withToken($token)->withHeaders(['X-Branch-Id' => $mainBranch])
            ->postJson("/api/invoices/{$invoice['id']}/notes", ['body' => 'محاولة عزل غير صالحة'])
            ->assertNotFound();
    }

    private function invoice(string $token, ?string $branchId = null): array
    {
        $request = $this->withToken($token);
        if ($branchId !== null) {
            $request = $request->withHeaders(['X-Branch-Id' => $branchId]);
        }

        $partnerId = $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل ملاحظة',
            'type' => 'customer',
        ])->assertCreated()['data']['id'];

        return $request->postJson('/api/invoices', [
            'partner_id' => $partnerId,
            'payment_type' => 'credit',
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated()['data'];
    }
}
