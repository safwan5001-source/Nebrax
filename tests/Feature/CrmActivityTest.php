<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات سجلّ علاقات العملاء (CRM). غير محاسبي — لا قيود.
 * تشغيل: php artisan test --filter=CrmActivityTest
 */
class CrmActivityTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function it_creates_and_lists_activities(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->postJson('/api/crm-activities', [
            'type' => 'call', 'subject' => 'مكالمة متابعة', 'activity_at' => '2026-07-01 11:00:00',
        ])->assertCreated()->assertJsonPath('data.type', 'call')->assertJsonPath('data.status', 'open');

        $this->withToken($auth['token'])->getJson('/api/crm-activities')
            ->assertOk()->assertJsonCount(1, 'data');
    }

    /** @test */
    public function subject_and_date_are_required(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->postJson('/api/crm-activities', ['subject' => ''])
            ->assertStatus(422)->assertJsonValidationErrors(['subject', 'activity_at']);
    }

    /** @test */
    public function activities_are_tenant_isolated(): void
    {
        $a = $this->registerTenant('acme', 'owner@acme.test');
        $id = $this->withToken($a['token'])->postJson('/api/crm-activities', [
            'subject' => 'نشاط آكمي', 'activity_at' => '2026-07-01 10:00:00',
        ])->assertCreated()['data']['id'];

        $b = $this->registerTenant('globex', 'owner@globex.test');
        $this->withToken($b['token'])->getJson("/api/crm-activities/{$id}")->assertNotFound();
        $this->withToken($b['token'])->getJson('/api/crm-activities')->assertOk()->assertJsonCount(0, 'data');
    }
}
