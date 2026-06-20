<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * الاختبار الحاسم: استحالة وصول مستأجر لبيانات مستأجر آخر عبر أي endpoint،
 * حتى عند إرسال المعرّف الصحيح.
 * تشغيل:  php artisan test --filter=ApiTenantIsolationTest
 */
class ApiTenantIsolationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function createPartner(string $token, string $name): string
    {
        return $this->withToken($token)->postJson('/api/partners', [
            'name' => $name, 'type' => 'customer',
        ])->assertCreated()['data']['id'];
    }

    /** @test */
    public function a_tenant_cannot_read_another_tenants_partner_even_with_correct_id(): void
    {
        $a = $this->registerTenant('alpha', 'a@alpha.test');
        $b = $this->registerTenant('beta', 'b@beta.test');

        $partnerA = $this->createPartner($a['token'], 'عميل ألفا');

        // المستأجر B يرسل المعرّف الصحيح لمورد A → 404 (غير موجود ضمن نطاقه)
        $this->withToken($b['token'])->getJson("/api/partners/{$partnerA}")->assertNotFound();
    }

    /** @test */
    public function a_tenant_cannot_update_or_delete_another_tenants_partner(): void
    {
        $a = $this->registerTenant('alpha', 'a@alpha.test');
        $b = $this->registerTenant('beta', 'b@beta.test');

        $partnerA = $this->createPartner($a['token'], 'عميل ألفا');

        $this->withToken($b['token'])->putJson("/api/partners/{$partnerA}", [
            'name' => 'مُخترَق', 'type' => 'customer',
        ])->assertNotFound();

        $this->withToken($b['token'])->deleteJson("/api/partners/{$partnerA}")->assertNotFound();
    }

    /** @test */
    public function listing_returns_only_the_callers_own_records(): void
    {
        $a = $this->registerTenant('alpha', 'a@alpha.test');
        $b = $this->registerTenant('beta', 'b@beta.test');

        $this->createPartner($a['token'], 'عميل ألفا');
        $this->createPartner($b['token'], 'عميل بيتا');

        $listB = $this->withToken($b['token'])->getJson('/api/partners')->assertOk();
        $this->assertCount(1, $listB['data']);
        $this->assertSame('عميل بيتا', $listB['data'][0]['name']);
    }

    /** @test */
    public function a_tenant_cannot_invoice_against_another_tenants_partner(): void
    {
        $a = $this->registerTenant('alpha', 'a@alpha.test');
        $b = $this->registerTenant('beta', 'b@beta.test');

        $partnerA = $this->createPartner($a['token'], 'عميل ألفا');

        // B يحاول إنشاء فاتورة بمعرّف طرف يخص A → 404 (عزل على الكتابة)
        $this->withToken($b['token'])->postJson('/api/invoices', [
            'partner_id'   => $partnerA,
            'payment_type' => 'cash',
            'items'        => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertNotFound();
    }
}
