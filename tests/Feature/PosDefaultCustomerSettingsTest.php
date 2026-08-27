<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * العميل الافتراضي في POS مرجع طرف موجود فعلاً، لا نص حر ينشئ عميلًا صامتًا.
 */
class PosDefaultCustomerSettingsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function pos_can_store_an_active_visible_customer_as_the_default_reference(): void
    {
        ['token' => $token] = $this->registerTenant('pos-default-customer', 'owner@pos-default-customer.test');
        $customer = $this->withToken($token)->postJson('/api/partners', [
            'name' => 'شركة العميل المحدد',
            'type' => 'customer',
            'phone' => '0500000001',
        ])->assertCreated()['data'];

        $this->withToken($token)->putJson('/api/sales-config/pos', [
            'data' => ['default_customer_id' => $customer['id']],
        ])->assertOk()
            ->assertJsonPath('data.default_customer_id', $customer['id'])
            ->assertJsonPath('data.default_customer', 'شركة العميل المحدد');

        $this->withToken($token)->getJson('/api/sales-config/pos')
            ->assertOk()
            ->assertJsonPath('data.default_customer_id', $customer['id'])
            ->assertJsonPath('data.default_customer', 'شركة العميل المحدد');
    }

    /** @test */
    public function pos_rejects_a_supplier_or_foreign_customer_as_the_default_reference(): void
    {
        ['token' => $token] = $this->registerTenant('pos-default-a', 'owner@pos-default-a.test');
        $supplier = $this->withToken($token)->postJson('/api/partners', [
            'name' => 'مورد فقط',
            'type' => 'supplier',
        ])->assertCreated()['data'];

        $this->withToken($token)->putJson('/api/sales-config/pos', [
            'data' => ['default_customer_id' => $supplier['id']],
        ])->assertUnprocessable();

        ['token' => $otherToken] = $this->registerTenant('pos-default-b', 'owner@pos-default-b.test');
        $foreign = $this->withToken($otherToken)->postJson('/api/partners', [
            'name' => 'عميل مؤسسة أخرى',
            'type' => 'customer',
        ])->assertCreated()['data'];

        $this->withToken($token)->putJson('/api/sales-config/pos', [
            'data' => ['default_customer_id' => $foreign['id']],
        ])->assertUnprocessable();
    }

    /** @test */
    public function clearing_the_default_reference_returns_to_the_canonical_walkin_customer(): void
    {
        ['token' => $token] = $this->registerTenant('pos-default-clear', 'owner@pos-default-clear.test');

        $this->withToken($token)->putJson('/api/sales-config/pos', [
            'data' => ['default_customer_id' => null],
        ])->assertOk()
            ->assertJsonPath('data.default_customer_id', null)
            ->assertJsonPath('data.default_customer', 'عميل نقدي (POS)');
    }

    /** @test */
    public function a_legacy_name_is_resolved_only_when_it_matches_one_existing_customer(): void
    {
        ['token' => $token] = $this->registerTenant('pos-default-legacy', 'owner@pos-default-legacy.test');
        $customer = $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل قديم مضبوط',
            'type' => 'customer',
        ])->assertCreated()['data'];

        $this->withToken($token)->putJson('/api/sales-config/pos', [
            'data' => ['default_customer' => 'عميل قديم مضبوط'],
        ])->assertOk()
            ->assertJsonPath('data.default_customer_id', $customer['id'])
            ->assertJsonPath('data.default_customer', 'عميل قديم مضبوط');

        $this->withToken($token)->putJson('/api/sales-config/pos', [
            'data' => ['default_customer' => 'اسم مكتوب بالخطأ ولا يوجد'],
        ])->assertOk()
            ->assertJsonPath('data.default_customer_id', null)
            ->assertJsonPath('data.default_customer', 'عميل نقدي (POS)');
    }
}
