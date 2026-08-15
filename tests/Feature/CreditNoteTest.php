<?php

namespace Tests\Feature;

use App\Models\CreditNote;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات الإشعارات الدائنة: الإجماليات من السطور، والترحيل يولّد قيداً
 * عكسياً متوازناً (مدين 4110 + 2120 / دائن 1130 أو 1110).
 * تشغيل: php artisan test --filter=CreditNoteTest
 */
class CreditNoteTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function line(JournalEntry $entry, string $code): ?JournalLine
    {
        return $entry->lines->first(fn (JournalLine $l) => $l->account->code === $code);
    }

    private function partner(string $token, string $type = 'customer'): string
    {
        return $this->withToken($token)->postJson('/api/partners', [
            'name' => $type === 'supplier' ? 'مورد' : 'عميل',
            'type' => $type,
        ])->assertCreated()['data']['id'];
    }

    /** @test */
    public function creating_a_credit_note_derives_totals_without_a_journal_entry(): void
    {
        $auth = $this->registerTenant();
        $partnerId = $this->partner($auth['token']);

        $res = $this->withToken($auth['token'])->postJson('/api/credit-notes', [
            'partner_id' => $partnerId,
            'items'      => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated();

        $this->assertSame('draft', $res['data']['status']);
        $this->assertSame('1150.00', $res['data']['total']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, JournalEntry::where('source_type', CreditNote::class)->count());
    }

    /** @test */
    public function posting_a_credit_note_generates_a_balanced_reversing_entry(): void
    {
        $auth = $this->registerTenant();
        $partnerId = $this->partner($auth['token']);

        $id = $this->withToken($auth['token'])->postJson('/api/credit-notes', [
            'partner_id'  => $partnerId,
            'refund_type' => 'credit',
            'items'       => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])['data']['id'];

        $posted = $this->withToken($auth['token'])->postJson("/api/credit-notes/{$id}/post")->assertOk();
        $this->assertSame('posted', $posted['data']['status']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $entry = JournalEntry::with('lines.account')
            ->where('source_type', CreditNote::class)->where('source_id', $id)->firstOrFail();

        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(115000, $entry->lines->sum('debit'));
        $this->assertEquals(100000, $this->line($entry, '4110')->debit);  // عكس المبيعات
        $this->assertEquals(15000,  $this->line($entry, '2120')->debit);  // عكس ضريبة المخرجات
        $this->assertEquals(115000, $this->line($entry, '1130')->credit); // تخفيض ذمة العميل
    }

    /** @test */
    public function posting_an_credit_note_freezes_the_matching_published_template_revision(): void
    {
        $auth = $this->registerTenant('credit-template-freeze', 'owner@credit-template-freeze.test');
        $customerId = $this->partner($auth['token']);
        $supplierId = $this->partner($auth['token'], 'supplier');

        $creditTemplate = $this->withToken($auth['token'])->postJson('/api/print-templates', [
            'name' => 'إشعار دائن ثابت',
            'document_types' => ['credit_note'],
            'definition' => ['template_id' => 'credit-note-v1'],
        ])->assertCreated();
        $creditTemplateId = $creditTemplate['data']['id'];
        $creditRevisionId = $this->withToken($auth['token'])
            ->postJson("/api/print-templates/{$creditTemplateId}/publish")
            ->assertOk()['data']['published_revision']['id'];

        $debitTemplate = $this->withToken($auth['token'])->postJson('/api/print-templates', [
            'name' => 'إشعار مدين ثابت',
            'document_types' => ['debit_note'],
            'definition' => ['template_id' => 'debit-note-v1'],
        ])->assertCreated();
        $debitTemplateId = $debitTemplate['data']['id'];
        $debitRevisionId = $this->withToken($auth['token'])
            ->postJson("/api/print-templates/{$debitTemplateId}/publish")
            ->assertOk()['data']['published_revision']['id'];

        foreach ([
            ['document_type' => 'credit_note', 'print_template_revision_id' => $creditRevisionId],
            ['document_type' => 'debit_note', 'print_template_revision_id' => $debitRevisionId],
        ] as $assignment) {
            $this->withToken($auth['token'])->putJson('/api/print-templates/assignments/default', [
                ...$assignment,
                'usage' => 'print',
            ])->assertOk();
        }

        $creditNoteId = $this->withToken($auth['token'])->postJson('/api/credit-notes', [
            'partner_id' => $customerId,
            'type' => 'sales',
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated()['data']['id'];
        $this->withToken($auth['token'])->postJson("/api/credit-notes/{$creditNoteId}/post")
            ->assertOk()
            ->assertJsonPath('data.print_template_revision_id', $creditRevisionId)
            ->assertJsonPath('data.print_template_revision.definition.template_id', 'credit-note-v1');

        $debitNoteId = $this->withToken($auth['token'])->postJson('/api/credit-notes', [
            'partner_id' => $supplierId,
            'type' => 'purchase',
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated()['data']['id'];
        $this->withToken($auth['token'])->postJson("/api/credit-notes/{$debitNoteId}/post")
            ->assertOk()
            ->assertJsonPath('data.print_template_revision_id', $debitRevisionId)
            ->assertJsonPath('data.print_template_revision.definition.template_id', 'debit-note-v1');

        $this->withToken($auth['token'])->putJson("/api/print-templates/{$creditTemplateId}/draft", [
            'definition' => ['template_id' => 'credit-note-v2'],
        ])->assertOk();
        $this->withToken($auth['token'])->postJson("/api/print-templates/{$creditTemplateId}/publish")->assertOk();

        $this->withToken($auth['token'])->getJson("/api/credit-notes/{$creditNoteId}")
            ->assertOk()
            ->assertJsonPath('data.print_template_revision_id', $creditRevisionId)
            ->assertJsonPath('data.print_template_revision.definition.template_id', 'credit-note-v1');
    }

    /** @test */
    public function cash_refund_credits_the_cash_account(): void
    {
        $auth = $this->registerTenant();
        $partnerId = $this->partner($auth['token']);

        $id = $this->withToken($auth['token'])->postJson('/api/credit-notes', [
            'partner_id'  => $partnerId,
            'refund_type' => 'cash',
            'items'       => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])['data']['id'];

        $this->withToken($auth['token'])->postJson("/api/credit-notes/{$id}/post")->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        $entry = JournalEntry::with('lines.account')
            ->where('source_type', CreditNote::class)->where('source_id', $id)->firstOrFail();
        $this->assertEquals(115000, $this->line($entry, '1110')->credit); // استرداد نقدي من الصندوق
    }

    /** @test */
    public function a_credit_note_cannot_be_posted_twice(): void
    {
        $auth = $this->registerTenant();
        $partnerId = $this->partner($auth['token']);
        $id = $this->withToken($auth['token'])->postJson('/api/credit-notes', [
            'partner_id' => $partnerId, 'items' => [['quantity' => 1, 'unit_price' => 10000]],
        ])['data']['id'];

        $this->withToken($auth['token'])->postJson("/api/credit-notes/{$id}/post")->assertOk();
        $this->withToken($auth['token'])->postJson("/api/credit-notes/{$id}/post")->assertStatus(422);
    }

    /** @test */
    public function credit_notes_are_tenant_isolated(): void
    {
        $a = $this->registerTenant('acme', 'owner@acme.test');
        $partnerA = $this->partner($a['token']);
        $id = $this->withToken($a['token'])->postJson('/api/credit-notes', [
            'partner_id' => $partnerA, 'items' => [['quantity' => 1, 'unit_price' => 10000]],
        ])['data']['id'];

        $b = $this->registerTenant('globex', 'owner@globex.test');
        $this->withToken($b['token'])->getJson("/api/credit-notes/{$id}")->assertNotFound();
        $this->withToken($b['token'])->getJson('/api/credit-notes')->assertOk()->assertJsonCount(0, 'data');
    }
}
