<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CustomerDefaultPriceListTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function priceList(string $token, string $name = 'سعر عملاء الشركة'): array
    {
        return $this->withToken($token)->postJson('/api/price-lists', [
            'name' => $name,
        ])->assertCreated()['data'];
    }

    private function customer(string $token, ?string $priceListId = null, string $type = 'customer'): array
    {
        return $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل القائمة الافتراضية',
            'type' => $type,
            'default_price_list_id' => $priceListId,
        ])->assertCreated()['data'];
    }

    private function product(string $token): array
    {
        return $this->withToken($token)->postJson('/api/products', [
            'name' => 'منتج تسعير العميل',
            'sku' => 'CUSTOMER-LIST-001',
            'type' => 'good',
            'sale_price' => 100000,
            'tax_rate' => 0,
        ])->assertCreated()['data'];
    }

    private function invoicePayload(string $partnerId, string $productId, array $overrides = []): array
    {
        return [
            'partner_id' => $partnerId,
            'items' => [[
                'product_id' => $productId,
                'quantity' => 1,
                'unit_price' => 100000,
                'tax_rate' => 0,
            ]],
            ...$overrides,
        ];
    }

    /** @test */
    public function a_customers_active_default_price_list_is_suggested_only_when_the_invoice_does_not_choose_one(): void
    {
        $auth = $this->registerTenant();
        $priceList = $this->priceList($auth['token']);
        $customer = $this->customer($auth['token'], $priceList['id']);
        $product = $this->product($auth['token']);

        $this->assertSame($priceList['id'], $customer['default_price_list_id']);
        $this->assertSame('سعر عملاء الشركة', $customer['default_price_list']['name']);

        $this->withToken($auth['token'])->postJson('/api/invoices', $this->invoicePayload($customer['id'], $product['id']))
            ->assertCreated()
            ->assertJsonPath('data.price_list_id', $priceList['id']);

        // null الصريح اختيار يدوي للسعر الأساسي؛ لا يعيد الخادم تطبيق افتراض العميل.
        $this->withToken($auth['token'])->postJson('/api/invoices', $this->invoicePayload($customer['id'], $product['id'], [
            'price_list_id' => null,
        ]))->assertCreated()
            ->assertJsonPath('data.price_list_id', null);
    }

    /** @test */
    public function an_inactive_default_is_not_suggested_and_a_price_list_referenced_by_a_customer_cannot_be_deleted(): void
    {
        $auth = $this->registerTenant();
        $priceList = $this->priceList($auth['token']);
        $customer = $this->customer($auth['token'], $priceList['id']);
        $product = $this->product($auth['token']);

        $this->withToken($auth['token'])->deleteJson("/api/price-lists/{$priceList['id']}")
            ->assertStatus(422)
            ->assertJsonPath('message', 'لا يمكن حذف قائمة أسعار معيّنة افتراضياً لعميل. أزلها من العميل أو عطّلها بدلاً من ذلك.');

        $this->withToken($auth['token'])->putJson("/api/price-lists/{$priceList['id']}", ['is_active' => false])
            ->assertOk();

        $this->withToken($auth['token'])->postJson('/api/invoices', $this->invoicePayload($customer['id'], $product['id']))
            ->assertCreated()
            ->assertJsonPath('data.price_list_id', null);
    }

    /** @test */
    public function only_an_active_tenant_owned_price_list_can_be_assigned_to_a_customer(): void
    {
        $owner = $this->registerTenant();
        $priceList = $this->priceList($owner['token']);
        $other = $this->registerTenant('customer-price-list-other', 'customer-price-list-other@example.test');

        $this->withToken($other['token'])->postJson('/api/partners', [
            'name' => 'عميل أجنبي',
            'type' => 'customer',
            'default_price_list_id' => $priceList['id'],
        ])->assertStatus(422)
            ->assertJsonPath('message', 'قائمة السعر الافتراضية غير موجودة أو غير نشطة.');

        $this->withToken($owner['token'])->postJson('/api/partners', [
            'name' => 'مورد فقط',
            'type' => 'supplier',
            'default_price_list_id' => $priceList['id'],
        ])->assertStatus(422)
            ->assertJsonPath('message', 'لا يمكن إسناد قائمة سعر افتراضية لطرف ليس عميلاً.');
    }
}
