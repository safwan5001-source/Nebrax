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
    public function creating_a_partner_validates_input(): void
    {
        $token = $this->registerTenant()['token'];

        $this->withToken($token)->postJson('/api/partners', [
            'type' => 'invalid', // اسم مفقود + نوع غير صالح
        ])->assertStatus(422)->assertJsonValidationErrors(['name', 'type']);
    }
}
