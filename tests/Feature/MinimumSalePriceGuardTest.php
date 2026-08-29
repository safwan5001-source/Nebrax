<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class MinimumSalePriceGuardTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function customer(string $token): array
    {
        return $this->withToken($token)
            ->postJson('/api/partners', ['name' => 'عميل السعر الأدنى', 'type' => 'customer'])
            ->assertCreated()['data'];
    }

    private function product(string $token): array
    {
        return $this->withToken($token)
            ->postJson('/api/products', [
                'name' => 'منتج بسعر محروس',
                'sku' => 'MIN-PRICE-001',
                'type' => 'good',
                'sale_price' => 120000,
                'min_sale_price' => 100000,
            ])
            ->assertCreated()['data'];
    }

    private function invoicePayload(string $partnerId, string $productId, array $item = []): array
    {
        return [
            'partner_id' => $partnerId,
            'tax_inclusive' => false,
            'items' => [[
                'product_id' => $productId,
                'quantity' => 1,
                'unit_price' => 90000,
                'tax_rate' => 0,
                ...$item,
            ]],
        ];
    }

    /** @test */
    public function a_new_tenant_enforces_the_minimum_price_by_default_and_can_toggle_the_policy(): void
    {
        $auth = $this->registerTenant();
        $customer = $this->customer($auth['token']);
        $product = $this->product($auth['token']);

        $this->withToken($auth['token'])->getJson('/api/sales-settings')
            ->assertOk()
            ->assertJsonPath('data.enforce_min_sale_price', true);

        $this->withToken($auth['token'])
            ->postJson('/api/invoices', $this->invoicePayload($customer['id'], $product['id']))
            ->assertStatus(422)
            ->assertJsonPath('message', 'سعر «منتج بسعر محروس» الصافي أقل من الحد الأدنى. اكتب سبب الاستثناء وأرسله لاعتماد مدير أو مالك.');

        $this->withToken($auth['token'])
            ->putJson('/api/sales-settings', ['enforce_min_sale_price' => false])
            ->assertOk()
            ->assertJsonPath('data.enforce_min_sale_price', false);

        $this->withToken($auth['token'])
            ->postJson('/api/invoices', $this->invoicePayload($customer['id'], $product['id']))
            ->assertCreated()
            ->assertJsonPath('data.lines.0.minimum_price_override', null);
    }

    /** @test */
    public function an_owner_can_override_below_minimum_price_only_with_a_reason_and_the_line_keeps_the_audit_snapshot(): void
    {
        $auth = $this->registerTenant();
        $customer = $this->customer($auth['token']);
        $product = $this->product($auth['token']);
        $owner = User::where('tenant_id', $auth['tenant_id'])->firstOrFail();

        $this->withToken($auth['token'])
            ->postJson('/api/invoices', $this->invoicePayload($customer['id'], $product['id'], [
                'minimum_price_override_reason' => 'تصريف مخزون نهاية الموسم',
            ]))
            ->assertCreated()
            ->assertJsonPath('data.lines.0.min_sale_price', '1000.00')
            ->assertJsonPath('data.lines.0.minimum_price_override.reason', 'تصريف مخزون نهاية الموسم')
            ->assertJsonPath('data.lines.0.minimum_price_override.approved_by_user_id', $owner->id);
    }

    /** @test */
    public function an_accountant_cannot_override_a_minimum_price_even_with_a_reason(): void
    {
        $owner = $this->registerTenant();
        $customer = $this->customer($owner['token']);
        $product = $this->product($owner['token']);
        $accountant = $this->tokenForRole($owner['tenant_id'], 'accountant', 'accountant@minimum-price.test');

        $this->withToken($accountant)
            ->postJson('/api/invoices', $this->invoicePayload($customer['id'], $product['id'], [
                'minimum_price_override_reason' => 'طلب العميل خصماً خاصاً',
            ]))
            ->assertStatus(422)
            ->assertJsonPath('message', 'السعر الأقل من الحد الأدنى يتطلب اعتماد مالك أو مدير مخوّل.');
    }

    /** @test */
    public function point_of_sale_uses_the_same_minimum_price_guard(): void
    {
        $auth = $this->registerTenant();
        $customer = $this->customer($auth['token']);
        $product = $this->product($auth['token']);
        $warehouseId = $this->withToken($auth['token'])->postJson('/api/warehouses', [
            'name' => 'مخزن اختبار السعر', 'code' => 'MIN-POS-W', 'is_active' => true,
        ])->assertCreated()['data']['id'];
        $deviceId = $this->withToken($auth['token'])->postJson('/api/pos-devices', [
            'name' => 'كاشير اختبار السعر', 'code' => 'MIN-POS', 'warehouse_id' => $warehouseId, 'is_active' => true,
        ])->assertCreated()['data']['id'];
        $sessionId = $this->withToken($auth['token'])
            ->postJson('/api/pos-sessions/open', ['opening_balance' => 0, 'pos_device_id' => $deviceId])
            ->assertCreated()['data']['id'];

        // هذا الاختبار يثبت الحارس الأدنى بعد السماح الصريح بتعديل السعر؛
        // السياسة الجديدة المغلقة افتراضياً ترفض التعديل قبل بلوغ هذا الحارس.
        $this->withToken($auth['token'])
            ->putJson('/api/sales-config/pos', ['data' => ['allow_unit_price_override' => true]])
            ->assertOk();

        $this->withToken($auth['token'])
            ->postJson('/api/pos/checkout', [
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
                'partner_id' => $customer['id'],
                'pos_session_id' => $sessionId,
                'items' => [[
                    'product_id' => $product['id'],
                    'quantity' => 1,
                    'unit_price' => 90000,
                    'tax_rate' => 0,
                ]],
                'tenders' => ['credit' => 90000],
            ])
            ->assertStatus(422)
            ->assertJsonPath('message', 'سعر «منتج بسعر محروس» الصافي أقل من الحد الأدنى. اكتب سبب الاستثناء وأرسله لاعتماد مدير أو مالك.');
    }
}
