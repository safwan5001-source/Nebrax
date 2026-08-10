<?php

namespace Tests\Feature;

use App\Models\JournalEntry;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  API دورة الشراء — التصفية بالنوع، وحراسة حقول الهوية عند التعديل
 * ═══════════════════════════════════════════════════════════════
 *  تشغيل: php artisan test --filter=ProcurementApiTest
 */
class ProcurementApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function doc(string $token, string $type, array $extra = []): array
    {
        return $this->withToken($token)->postJson('/api/procurement', array_merge([
            'type'  => $type,
            'items' => [['description' => 'إسمنت', 'quantity' => 10, 'unit_price' => 15000, 'tax_rate' => 15]],
        ], $extra))->assertCreated()['data'];
    }

    private function supplier(string $token): array
    {
        return $this->withToken($token)
            ->postJson('/api/partners', ['name' => 'مورد', 'type' => 'supplier'])
            ->assertCreated()['data'];
    }

    /** @test */
    public function it_creates_a_purchase_request_and_derives_totals(): void
    {
        $auth = $this->registerTenant();
        $doc  = $this->doc($auth['token'], 'request', ['requested_by' => 'إدارة المشاريع']);

        $this->assertSame('request', $doc['type']);
        $this->assertSame('draft', $doc['status']);
        $this->assertStringStartsWith('PR-', $doc['number']);
        $this->assertSame('1500.00', $doc['subtotal']);
        $this->assertSame('1725.00', $doc['total']);
    }

    /** القائمة تُصفّى بالنوع — فلا تختلط الطلبات بالأوامر في شاشة واحدة. */
    /** @test */
    public function the_list_filters_by_type(): void
    {
        $auth     = $this->registerTenant();
        $supplier = $this->supplier($auth['token']);
        $this->doc($auth['token'], 'request');
        $this->doc($auth['token'], 'order', ['partner_id' => $supplier['id']]);

        $requests = $this->withToken($auth['token'])->getJson('/api/procurement?type=request')->assertOk()['data'];
        $orders   = $this->withToken($auth['token'])->getJson('/api/procurement?type=order')->assertOk()['data'];

        $this->assertCount(1, $requests);
        $this->assertCount(1, $orders);
        $this->assertSame('request', $requests[0]['type']);
        $this->assertStringStartsWith('PO-', $orders[0]['number']);
    }

    /**
     * درس #150: حقلٌ يُقبل ثم يسقط صامتاً = 200 OK على تعديل لم يحدث.
     * `type` يُحدَّد عند الإنشاء ولا يقرؤه `update` — فيجب أن يُرفض صراحةً.
     *
     * @test
     */
    public function changing_the_type_on_update_is_rejected(): void
    {
        $auth = $this->registerTenant();
        $doc  = $this->doc($auth['token'], 'request');

        $this->withToken($auth['token'])->putJson("/api/procurement/{$doc['id']}", [
            'type' => 'order',
        ])->assertStatus(422)->assertJsonValidationErrors('type');

        // ولم يتغيّر شيء فعلاً
        $this->assertSame('request', $this->withToken($auth['token'])
            ->getJson("/api/procurement/{$doc['id']}")['data']['type']);
    }

    /** @test */
    public function changing_the_source_document_on_update_is_rejected(): void
    {
        $auth = $this->registerTenant();
        $doc  = $this->doc($auth['token'], 'request');

        $this->withToken($auth['token'])->putJson("/api/procurement/{$doc['id']}", [
            'source_document_id' => $doc['id'],
        ])->assertStatus(422)->assertJsonValidationErrors('source_document_id');
    }

    /** تعديل الرأس وحده مسموح — بلا إرسال السطور. */
    /** @test */
    public function the_header_can_be_updated_without_resending_the_lines(): void
    {
        $auth = $this->registerTenant();
        $doc  = $this->doc($auth['token'], 'request');

        $updated = $this->withToken($auth['token'])->putJson("/api/procurement/{$doc['id']}", [
            'requested_by' => 'إدارة الصيانة',
        ])->assertOk()['data'];

        $this->assertSame('إدارة الصيانة', $updated['requested_by']);
        $this->assertSame($doc['total'], $updated['total']);
    }

    /**
     * السلسلة كاملةً عبر الـ API حتى الفاتورة — **بلا قيد واحد**.
     * القيد يبدأ عند ترحيل الفاتورة، لا قبله.
     *
     * @test
     */
    public function the_api_chain_produces_a_draft_purchase_without_any_journal_entry(): void
    {
        $auth     = $this->registerTenant();
        $supplier = $this->supplier($auth['token']);
        $before   = JournalEntry::count();

        $order = $this->doc($auth['token'], 'order', ['partner_id' => $supplier['id']]);

        $this->withToken($auth['token'])->postJson("/api/procurement/{$order['id']}/transition", ['status' => 'submitted'])->assertOk();
        $this->withToken($auth['token'])->postJson("/api/procurement/{$order['id']}/transition", ['status' => 'approved'])->assertOk();

        $purchase = $this->withToken($auth['token'])
            ->postJson("/api/procurement/{$order['id']}/convert", ['target' => 'purchase'])
            ->assertCreated()['data'];

        $this->assertSame('draft', $purchase['status']);
        $this->assertSame($before, JournalEntry::count(), 'دورة الشراء عبر الـ API لا تولّد قيوداً.');
    }

    /** انتقال غير مسموح يعود 422 لا 500. */
    /** @test */
    public function an_illegal_transition_returns_422(): void
    {
        $auth = $this->registerTenant();
        $doc  = $this->doc($auth['token'], 'request');

        $this->withToken($auth['token'])
            ->postJson("/api/procurement/{$doc['id']}/transition", ['status' => 'approved'])
            ->assertStatus(422);
    }

    /** عزل المستأجر: مستند مستأجر آخر غير مرئي ولا قابل للتعديل. */
    /** @test */
    public function a_tenant_cannot_reach_another_tenants_document(): void
    {
        $a = $this->registerTenant();
        $b = $this->registerTenant('other', 'other@nibras.test');

        $doc = $this->doc($a['token'], 'request');

        $this->withToken($b['token'])->getJson("/api/procurement/{$doc['id']}")->assertNotFound();
        $this->withToken($b['token'])->getJson('/api/procurement')->assertOk()->assertJsonCount(0, 'data');
    }
}
