<?php

namespace Tests\Feature;

use App\Models\PaymentMethod;
use App\Models\Tenant;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PaymentMethodDefaultsTest extends TestCase
{
    use RefreshDatabase;

    /** @test */
    public function it_bootstraps_the_four_operational_payment_methods_once_per_tenant(): void
    {
        $tenant = Tenant::create([
            'name' => 'شركة طرق الدفع',
            'slug' => 'payment-methods-defaults',
            'vat_number' => '300000000000003',
            'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($tenant->id);

        $service = app(CashBankAccountService::class);
        $service->bootstrapDefaults();
        $service->bootstrapDefaults();

        $methods = PaymentMethod::with('cashBankAccount')->orderBy('name')->get();

        $this->assertCount(4, $methods);
        $this->assertSame(
            ['بطاقة ائتمان', 'تحويل بنكي', 'شيك', 'نقدي'],
            $methods->pluck('name')->all()
        );
        $this->assertSame('cash', $methods->firstWhere('name', 'نقدي')->settlement_type);
        $this->assertSame('cash', $methods->firstWhere('name', 'نقدي')->cashBankAccount->type);

        foreach (['تحويل بنكي', 'شيك', 'بطاقة ائتمان'] as $name) {
            $method = $methods->firstWhere('name', $name);
            $this->assertSame('bank', $method->settlement_type);
            $this->assertSame('bank', $method->cashBankAccount->type);
            $this->assertTrue($method->is_active);
        }
    }

    /** @test */
    public function it_does_not_recreate_deleted_defaults_when_the_tenant_keeps_other_methods(): void
    {
        $tenant = Tenant::create([
            'name' => 'شركة تخصيص الطرق',
            'slug' => 'payment-methods-customization',
            'vat_number' => '300000000000004',
            'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($tenant->id);

        $service = app(CashBankAccountService::class);
        $service->bootstrapDefaults();
        PaymentMethod::where('name', 'شيك')->delete();

        $service->bootstrapDefaults();

        $this->assertSame(3, PaymentMethod::count());
        $this->assertFalse(PaymentMethod::where('name', 'شيك')->exists());
    }
}
