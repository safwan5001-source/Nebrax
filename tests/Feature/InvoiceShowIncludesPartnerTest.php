<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * PR-4: `GET /invoices/{id}` كان يُسقط `partner` من الاستجابة لأن العلاقة لم
 * تكن محمَّلة رغم أن `InvoiceResource` تُعرّف الحقل أصلاً (`whenLoaded`) — فجوة
 * كانت تُفقد اسم العميل من إعادة طباعة الإيصال ومركز فواتير نقطة البيع، وكلاهما
 * يستهلك هذا المسار نفسه. هذا الاختبار يحرس اكتمال العقد القائم لا يضيف حقلاً
 * جديداً.
 */
class InvoiceShowIncludesPartnerTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function show_includes_the_partner_name_needed_by_the_pos_invoice_center_and_receipt_reprint(): void
    {
        $auth = $this->registerTenant('inv-show-partner', 'owner@inv-show-partner.test');

        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل اختبار الفاتورة', 'type' => 'customer',
        ])->assertCreated()['data']['id'];

        $warehouseId = $this->withToken($auth['token'])->postJson('/api/warehouses', [
            'name' => 'مخزن الفاتورة', 'code' => 'INV-SHOW-W', 'is_active' => true,
        ])->assertCreated()['data']['id'];
        $deviceId = $this->withToken($auth['token'])->postJson('/api/pos-devices', [
            'name' => 'كاشير الفاتورة', 'code' => 'INV-SHOW-D', 'warehouse_id' => $warehouseId, 'is_active' => true,
        ])->assertCreated()['data']['id'];
        $sessionId = $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => 0, 'pos_device_id' => $deviceId,
        ])->assertCreated()['data']['id'];

        $invoiceId = $this->withToken($auth['token'])->postJson('/api/pos/checkout', [
            'idempotency_key' => (string) Str::uuid(),
            'partner_id' => $partnerId,
            'pos_session_id' => $sessionId,
            'warehouse_id' => $warehouseId,
            'items' => [['description' => 'صنف اختبار', 'quantity' => 1, 'unit_price' => 5000, 'tax_rate' => 15]],
            'tenders' => ['cash' => 5750, 'card' => 0, 'transfer' => 0, 'credit' => 0],
        ])->assertCreated()['data']['id'];

        $this->withToken($auth['token'])->getJson("/api/invoices/{$invoiceId}")
            ->assertOk()
            ->assertJsonPath('data.partner.name', 'عميل اختبار الفاتورة')
            ->assertJsonPath('data.partner.id', $partnerId);
    }
}
