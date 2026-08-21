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
            'currency'      => 'SAR',
            'country'       => 'SA',
            'phone'         => '0123456789',
            'mobile'        => '0551234567',
            'building_no'   => '7404',
            'street'        => 'شارع الحارث بن عبدالله',
            'additional_no' => '3185',
            'district'      => 'الخضراء',
            'city'          => 'مكة المكرمة',
            'postal_code'   => '24267',
            'short_address' => 'RDHA7404',
        ])->assertOk()->assertJsonPath('company.name', 'نبراس الطموح للتجارة')
            ->assertJsonPath('company.vat_number', '310122393500003')
            ->assertJsonPath('company.city', 'مكة المكرمة')
            ->assertJsonPath('company.short_address', 'RDHA7404');

        $tenant = Tenant::find($tenantId);
        $this->assertSame('نبراس الطموح للتجارة', $tenant->name);
        $this->assertSame('2050123456', $tenant->cr_number);
        $this->assertSame('مكة المكرمة', $tenant->settings['company']['city']);
        $this->assertSame('RDHA7404', $tenant->settings['company']['short_address']);

        $this->withToken($token)->getJson('/api/me')
            ->assertOk()
            ->assertJsonPath('company.building_no', '7404')
            ->assertJsonPath('company.mobile', '0551234567');
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
