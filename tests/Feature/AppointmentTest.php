<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات مواعيد العملاء (CRUD). غير محاسبية — لا قيود.
 * تشغيل: php artisan test --filter=AppointmentTest
 */
class AppointmentTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function partner(string $token): string
    {
        return $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل', 'type' => 'customer',
        ])->assertCreated()['data']['id'];
    }

    /** @test */
    public function it_creates_and_lists_appointments(): void
    {
        $auth = $this->registerTenant();
        $partnerId = $this->partner($auth['token']);

        $this->withToken($auth['token'])->postJson('/api/appointments', [
            'partner_id'     => $partnerId,
            'title'          => 'اجتماع متابعة',
            'appointment_at' => '2026-07-01 10:00:00',
            'location'       => 'الدمام',
        ])->assertCreated()->assertJsonPath('data.title', 'اجتماع متابعة')
            ->assertJsonPath('data.status', 'scheduled');

        $this->withToken($auth['token'])->getJson('/api/appointments')
            ->assertOk()->assertJsonCount(1, 'data');
    }

    /** @test */
    public function title_and_date_are_required(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->postJson('/api/appointments', ['title' => ''])
            ->assertStatus(422)->assertJsonValidationErrors(['title', 'appointment_at']);
    }

    /** @test */
    public function appointments_are_tenant_isolated(): void
    {
        $a = $this->registerTenant('acme', 'owner@acme.test');
        $id = $this->withToken($a['token'])->postJson('/api/appointments', [
            'title' => 'موعد آكمي', 'appointment_at' => '2026-07-01 09:00:00',
        ])->assertCreated()['data']['id'];

        $b = $this->registerTenant('globex', 'owner@globex.test');
        $this->withToken($b['token'])->getJson("/api/appointments/{$id}")->assertNotFound();
        $this->withToken($b['token'])->getJson('/api/appointments')->assertOk()->assertJsonCount(0, 'data');
    }
}
