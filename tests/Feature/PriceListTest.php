<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PriceListTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function product(string $token, string $sku = 'PRICE-LIST-001'): array
    {
        return $this->withToken($token)->postJson('/api/products', [
            'name' => 'منتج قائمة الأسعار',
            'sku' => $sku,
            'type' => 'good',
            'unit' => 'قطعة',
            'sale_price' => 100000,
            'tax_rate' => 0,
        ])->assertCreated()['data'];
    }

    private function customer(string $token): array
    {
        return $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل قائمة الأسعار',
            'type' => 'customer',
        ])->assertCreated()['data'];
    }

    private function priceList(string $token, string $name = 'الجملة'): array
    {
        return $this->withToken($token)->postJson('/api/price-lists', [
            'name' => $name,
            'description' => 'تسعير يدوي لعملاء الجملة',
        ])->assertCreated()['data'];
    }

    private function addItem(string $token, string $priceListId, string $productId, int $price = 87500): array
    {
        return $this->withToken($token)->postJson("/api/price-lists/{$priceListId}/items", [
            'product_id' => $productId,
            'price' => $price,
        ])->assertCreated()['data'];
    }

    /** @test */
    public function a_manual_price_list_resolves_a_product_price_and_the_invoice_keeps_its_reference_not_a_live_recalculation(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);
        $customer = $this->customer($auth['token']);
        $priceList = $this->priceList($auth['token']);
        $this->addItem($auth['token'], $priceList['id'], $product['id']);

        $this->withToken($auth['token'])
            ->getJson("/api/price-lists/{$priceList['id']}/resolve?product_id={$product['id']}")
            ->assertOk()
            ->assertJsonPath('data.matched', true)
            ->assertJsonPath('data.price', '875.00');

        $invoice = $this->withToken($auth['token'])->postJson('/api/invoices', [
            'partner_id' => $customer['id'],
            'price_list_id' => $priceList['id'],
            // القائمة تقترح السعر في الواجهة؛ الخدمة تحسب دائماً من لقطة السطر.
            'items' => [[
                'product_id' => $product['id'],
                'quantity' => 1,
                'unit_price' => 87500,
                'tax_rate' => 0,
            ]],
        ])->assertCreated()
            ->assertJsonPath('data.price_list_id', $priceList['id'])
            ->assertJsonPath('data.price_list.name', 'الجملة')
            ->assertJsonPath('data.lines.0.unit_price', '875.00')['data'];

        $this->withToken($auth['token'])
            ->postJson("/api/price-lists/{$priceList['id']}/items", [
                'product_id' => $product['id'],
                'price' => 70000,
            ])->assertCreated()
            ->assertJsonPath('data.price', '700.00');

        $this->withToken($auth['token'])->getJson("/api/invoices/{$invoice['id']}")
            ->assertOk()
            ->assertJsonPath('data.price_list_id', $priceList['id'])
            ->assertJsonPath('data.lines.0.unit_price', '875.00');
    }

    /** @test */
    public function an_inactive_price_list_cannot_be_selected_for_a_new_invoice_and_a_used_list_cannot_be_deleted(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);
        $customer = $this->customer($auth['token']);
        $priceList = $this->priceList($auth['token']);

        $invoicePayload = [
            'partner_id' => $customer['id'],
            'price_list_id' => $priceList['id'],
            'items' => [[
                'product_id' => $product['id'],
                'quantity' => 1,
                'unit_price' => 100000,
                'tax_rate' => 0,
            ]],
        ];

        $this->withToken($auth['token'])->postJson('/api/invoices', $invoicePayload)->assertCreated();
        $this->withToken($auth['token'])->deleteJson("/api/price-lists/{$priceList['id']}")
            ->assertStatus(422)
            ->assertJsonPath('message', 'لا يمكن حذف قائمة أسعار استُخدمت في فاتورة. عطّلها بدلاً من ذلك.');

        $this->withToken($auth['token'])->putJson("/api/price-lists/{$priceList['id']}", ['is_active' => false])
            ->assertOk()
            ->assertJsonPath('data.is_active', false);

        $this->withToken($auth['token'])->postJson('/api/invoices', $invoicePayload)
            ->assertStatus(422)
            ->assertJsonPath('message', 'قائمة الأسعار المحددة غير نشطة.');
    }

    /** @test */
    public function price_lists_are_tenant_isolated_and_an_item_blocks_product_deletion(): void
    {
        $owner = $this->registerTenant();
        $product = $this->product($owner['token']);
        $priceList = $this->priceList($owner['token']);
        $this->addItem($owner['token'], $priceList['id'], $product['id']);

        $other = $this->registerTenant('other-price-list', 'other-price-list@example.test');
        $this->withToken($other['token'])->getJson("/api/price-lists/{$priceList['id']}")->assertNotFound();
        $this->withToken($other['token'])->getJson("/api/price-lists/{$priceList['id']}/resolve?product_id={$product['id']}")->assertNotFound();

        $this->withToken($owner['token'])->deleteJson("/api/products/{$product['id']}")
            ->assertStatus(422);
    }
}
