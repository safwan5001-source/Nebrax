<?php

namespace Tests\Feature;

use App\Models\Tenant;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات تحرير ملف الشركة (PUT /api/company).
 * تحديث ملف فقط — لا أثر محاسبي (لا قيود تُولَّد).
 * تشغيل: php artisan test --filter=CompanyTest
 */
class CompanyTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function owner_can_update_company_profile(): void
    {
        ['token' => $token, 'tenant_id' => $tenantId] = $this->registerTenant('nibras', 'owner@nibras.test');

        $this->withToken($token)->putJson('/api/company', [
            'name'       => 'نبراس الطموح للتجارة',
            'vat_number' => '310122393500003',
            'cr_number'  => '2050123456',
            'currency'   => 'SAR',
            'country'    => 'SA',
        ])->assertOk()->assertJsonPath('company.name', 'نبراس الطموح للتجارة')
            ->assertJsonPath('company.vat_number', '310122393500003');

        $tenant = Tenant::find($tenantId);
        $this->assertSame('نبراس الطموح للتجارة', $tenant->name);
        $this->assertSame('2050123456', $tenant->cr_number);
    }

    /** @test */
    public function name_is_required(): void
    {
        ['token' => $token] = $this->registerTenant('nibras', 'owner@nibras.test');

        $this->withToken($token)->putJson('/api/company', ['name' => ''])
            ->assertStatus(422);
    }

    /** @test */
    public function staff_cannot_update_company(): void
    {
        ['tenant_id' => $tenantId] = $this->registerTenant('nibras', 'owner@nibras.test');
        $staff = $this->tokenForRole($tenantId, 'staff', 'staff@nibras.test');

        $this->withToken($staff)->putJson('/api/company', ['name' => 'محاولة'])
            ->assertForbidden();
    }

    /** @test */
    public function update_is_isolated_per_tenant(): void
    {
        ['token' => $aToken] = $this->registerTenant('acme', 'owner@acme.test');
        ['token' => $bToken] = $this->registerTenant('globex', 'owner@globex.test');

        $this->withToken($aToken)->putJson('/api/company', ['name' => 'آكمي المحدّثة'])->assertOk();

        // المستأجر B لم يتأثّر
        $this->withToken($bToken)->getJson('/api/me')
            ->assertOk()->assertJsonPath('company.name', 'شركة globex');
    }
}
