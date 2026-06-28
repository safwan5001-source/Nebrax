<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات جهات الاتصال (CRUD). غير محاسبية — لا قيود.
 * تشغيل: php artisan test --filter=ContactTest
 */
class ContactTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function it_creates_and_lists_contacts(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->postJson('/api/contacts', [
            'name' => 'محمد أحمد', 'job_title' => 'مدير المشتريات', 'phone' => '0500000000',
        ])->assertCreated()->assertJsonPath('data.name', 'محمد أحمد');

        $this->withToken($auth['token'])->getJson('/api/contacts')
            ->assertOk()->assertJsonCount(1, 'data');
    }

    /** @test */
    public function name_is_required_and_email_must_be_valid(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->postJson('/api/contacts', ['name' => '', 'email' => 'bad'])
            ->assertStatus(422)->assertJsonValidationErrors(['name', 'email']);
    }

    /** @test */
    public function contacts_are_tenant_isolated(): void
    {
        $a = $this->registerTenant('acme', 'owner@acme.test');
        $id = $this->withToken($a['token'])->postJson('/api/contacts', ['name' => 'جهة آكمي'])
            ->assertCreated()['data']['id'];

        $b = $this->registerTenant('globex', 'owner@globex.test');
        $this->withToken($b['token'])->getJson("/api/contacts/{$id}")->assertNotFound();
        $this->withToken($b['token'])->getJson('/api/contacts')->assertOk()->assertJsonCount(0, 'data');
    }
}
