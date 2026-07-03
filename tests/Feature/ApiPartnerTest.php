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

        // create
        $id = $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل نقدي', 'type' => 'customer', 'city' => 'الدمام',
        ])->assertCreated()->assertJsonPath('data.name', 'عميل نقدي')['data']['id'];

        // show
        $this->withToken($token)->getJson("/api/partners/{$id}")
            ->assertOk()->assertJsonPath('data.city', 'الدمام');

        // update
        $this->withToken($token)->putJson("/api/partners/{$id}", [
            'name' => 'عميل آجل', 'type' => 'both',
        ])->assertOk()->assertJsonPath('data.type', 'both');

        // delete
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
            'credit_limit' => 250000, // 2500.00 هللة
            'credit_period' => 30,
        ])->assertCreated()['data']['id'];

        $this->withToken($token)->getJson("/api/partners/{$id}")
            ->assertOk()
            ->assertJsonPath('data.classification', 'VIP')
            ->assertJsonPath('data.mobile', '0551234567')
            ->assertJsonPath('data.building_no', '1234')
            ->assertJsonPath('data.district', 'العليا')
            ->assertJsonPath('data.country', 'SA')
            ->assertJsonPath('data.credit_limit', '2500.00') // بالريال لا الهللات
            ->assertJsonPath('data.credit_period', 30);
    }

    /** @test */
    public function the_partner_index_filters_by_role(): void
    {
        $token = $this->registerTenant()['token'];

        foreach ([['ع', 'customer'], ['م', 'supplier'], ['ك', 'both']] as [$name, $type]) {
            $this->withToken($token)->postJson('/api/partners', ['name' => $name, 'type' => $type])->assertCreated();
        }

        // العملاء = customer + both
        $customers = $this->withToken($token)->getJson('/api/partners?type=customer')->assertOk()->json('data');
        $this->assertEqualsCanonicalizing(['customer', 'both'], array_column($customers, 'type'));

        // الموردون = supplier + both
        $suppliers = $this->withToken($token)->getJson('/api/partners?type=supplier')->assertOk()->json('data');
        $this->assertEqualsCanonicalizing(['supplier', 'both'], array_column($suppliers, 'type'));

        // بلا فلتر = الكل
        $this->withToken($token)->getJson('/api/partners')->assertOk()->assertJsonCount(3, 'data');
    }

    /** @test */
    public function creating_a_partner_validates_input(): void
    {
        $token = $this->registerTenant()['token'];

        $this->withToken($token)->postJson('/api/partners', [
            'type' => 'invalid', // اسم مفقود + نوع غير صالح
        ])->assertStatus(422)->assertJsonValidationErrors(['name', 'type']);
    }
}
