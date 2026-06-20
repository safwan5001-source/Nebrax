<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات RBAC: الأدوار وصلاحياتها على endpoints.
 * تشغيل:  php artisan test --filter=ApiRbacTest
 */
class ApiRbacTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function unauthenticated_requests_are_rejected(): void
    {
        $this->getJson('/api/partners')->assertUnauthorized();
        $this->postJson('/api/partners', [])->assertUnauthorized();
    }

    /** @test */
    public function staff_can_view_but_cannot_manage_partners(): void
    {
        $auth  = $this->registerTenant();
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@acme.test');

        // قراءة مسموحة
        $this->withToken($staff)->getJson('/api/partners')->assertOk();

        // إنشاء ممنوع (403)
        $this->withToken($staff)->postJson('/api/partners', [
            'name' => 'عميل', 'type' => 'customer',
        ])->assertForbidden();
    }

    /** @test */
    public function accountant_can_manage_partners_and_invoices(): void
    {
        $auth = $this->registerTenant();
        $acc  = $this->tokenForRole($auth['tenant_id'], 'accountant', 'acc@acme.test');

        $this->withToken($acc)->postJson('/api/partners', [
            'name' => 'عميل', 'type' => 'customer',
        ])->assertCreated();
    }

    /** @test */
    public function owner_has_full_access(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'منتج', 'type' => 'good', 'sale_price' => 10000,
        ])->assertCreated();
    }
}
