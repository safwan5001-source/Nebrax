<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات CRUD للأطراف عبر API (نجاح + تحقق المدخلات).
 * تشغيل:  php artisan test --filter=ApiPartnerTest
 */
class ApiPartnerTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function full_partner_crud_cycle(): void
    {
        $token = $this->registerTenant()['token'];

        $id = $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل نقدي', 'type' => 'customer', 'city' => 'الدمام',
        ])->assertCreated()->assertJsonPath('data.name', 'عميل نقدي')['data']['id'];

        $this->withToken($token)->getJson("/api/partners/{$id}")
            ->assertOk()->assertJsonPath('data.city', 'الدمام');

        $this->withToken($token)->putJson("/api/partners/{$id}", [
            'name' => 'عميل آجل', 'type' => 'both',
        ])->assertOk()->assertJsonPath('data.type', 'both');

        $this->withToken($token)->deleteJson("/api/partners/{$id}")->assertOk();
        $this->withToken($token)->getJson("/api/partners/{$id}")->assertNotFound();
    }

    /** @test */
    public function partner_profile_fields_round_trip_and_credit_limit_is_returned_in_riyal(): void
    {
        $token = $this->registerTenant()['token'];

        $id = $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل مميّز', 'type' => 'customer',
            'classification' => 'VIP', 'mobile' => '0551234567',
            'building_no' => '1234', 'street' => 'الملك فهد', 'district' => 'العليا',
            'postal_code' => '12211', 'country' => 'SA',
            'credit_limit' => 250000,
            'credit_period' => 30,
        ])->assertCreated()['data']['id'];

        $this->withToken($token)->getJson("/api/partners/{$id}")
            ->assertOk()
            ->assertJsonPath('data.classification', 'VIP')
            ->assertJsonPath('data.mobile', '0551234567')
            ->assertJsonPath('data.building_no', '1234')
            ->assertJsonPath('data.district', 'العليا')
            ->assertJsonPath('data.country', 'SA')
            ->assertJsonPath('data.credit_limit', '2500.00')
            ->assertJsonPath('data.credit_period', 30);
    }

    /** @test */
    public function the_partner_index_filters_by_role(): void
    {
        $token = $this->registerTenant()['token'];

        foreach ([['ع', 'customer'], ['م', 'supplier'], ['ك', 'both']] as [$name, $type]) {
            $this->withToken($token)->postJson('/api/partners', ['name' => $name, 'type' => $type])->assertCreated();
        }

        $customers = $this->withToken($token)->getJson('/api/partners?type=customer')->assertOk()->json('data');
        $this->assertEqualsCanonicalizing(['customer', 'both'], array_column($customers, 'type'));

        $suppliers = $this->withToken($token)->getJson('/api/partners?type=supplier')->assertOk()->json('data');
        $this->assertEqualsCanonicalizing(['supplier', 'both'], array_column($suppliers, 'type'));

        $this->withToken($token)->getJson('/api/partners')->assertOk()->assertJsonCount(3, 'data');
    }

    /** @test */
    public function partner_index_search_is_scoped_by_role_and_matches_supported_identity_fields(): void
    {
        $token = $this->registerTenant()['token'];

        $this->withToken($token)->postJson('/api/partners', [
            'name' => 'شركة أفق للتجزئة', 'type' => 'customer', 'mobile' => '0551112233',
        ])->assertCreated();
        $this->withToken($token)->postJson('/api/partners', [
            'name' => 'مؤسسة المورد الذهبي', 'type' => 'supplier', 'vat_number' => '310123456700003',
        ])->assertCreated();
        $this->withToken($token)->postJson('/api/partners', [
            'name' => 'طرف مشترك', 'type' => 'both', 'email' => 'both@example.test',
        ])->assertCreated();

        $customers = $this->withToken($token)
            ->getJson('/api/partners?type=customer&search=%D8%A3%D9%81%D9%82&per_page=4')
            ->assertOk()->json('data');
        $this->assertCount(1, $customers);
        $this->assertSame('شركة أفق للتجزئة', $customers[0]['name']);

        $supplier = $this->withToken($token)
            ->getJson('/api/partners?type=supplier&search=310123456700003&per_page=4')
            ->assertOk()->json('data');
        $this->assertCount(1, $supplier);
        $this->assertSame('مؤسسة المورد الذهبي', $supplier[0]['name']);

        $both = $this->withToken($token)
            ->getJson('/api/partners?type=customer&search=both%40example.test')
            ->assertOk()->json('data');
        $this->assertCount(1, $both);
        $this->assertSame('both', $both[0]['type']);

        $this->withToken($token)
            ->getJson('/api/partners?type=customer&search=310123456700003')
            ->assertOk()->assertJsonCount(0, 'data');
    }

    /** @test */
    public function partner_index_search_treats_like_wildcards_as_literal_text_and_caps_input_length(): void
    {
        $token = $this->registerTenant()['token'];
        $this->withToken($token)->postJson('/api/partners', ['name' => 'عميل 100% موثوق', 'type' => 'customer'])->assertCreated();
        $this->withToken($token)->postJson('/api/partners', ['name' => 'عميل آخر', 'type' => 'customer'])->assertCreated();

        $this->withToken($token)->getJson('/api/partners?type=customer&search=%25')
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.name', 'عميل 100% موثوق');

        $this->withToken($token)->getJson('/api/partners?search='.str_repeat('x', 101))
            ->assertStatus(422)->assertJsonValidationErrors(['search']);
    }

    /** @test */
    public function searching_partners_still_requires_partners_view_permission(): void
    {
        $auth = $this->registerTenant();
        $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل', 'type' => 'customer',
        ])->assertCreated();

        // self_service لا يحمل partners.view في المصفوفة الافتراضية — إضافة
        // معامل search لا تفتح مساراً موازياً يتجاوز EnsurePermission القائم.
        $restricted = $this->tokenForRole($auth['tenant_id'], 'self_service', 'ss@acme.test');
        $this->withToken($restricted)->getJson('/api/partners?search=عميل')->assertForbidden();
    }

    /** @test */
    public function creating_a_partner_validates_input(): void
    {
        $token = $this->registerTenant()['token'];

        $this->withToken($token)->postJson('/api/partners', [
            'type' => 'invalid',
        ])->assertStatus(422)->assertJsonValidationErrors(['name', 'type']);
    }
}
