<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

class DeliveryNoteInvoicePermissionMigrationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    #[Test]
    public function migration_backfills_only_existing_system_accountants_and_rolls_back_without_touching_custom_roles(): void
    {
        $auth = $this->registerTenant('legacy-delivery-invoice-permission', 'owner@legacy-delivery-invoice-permission.test');
        app(TenantContext::class)->set($auth['tenant_id']);

        $accountant = Role::query()->where('slug', 'accountant')->sole();
        $legacyPermissions = array_values(array_filter(
            $accountant->permissions,
            fn (string $permission): bool => $permission !== 'delivery_notes.invoice',
        ));
        $accountant->update(['permissions' => $legacyPermissions]);
        $custom = Role::create([
            'slug' => 'legacy-delivery-custom',
            'name' => 'دور مخصص محفوظ',
            'permissions' => ['delivery_notes.view'],
            'is_system' => false,
        ]);

        $migration = require database_path('migrations/2025_01_01_000128_grant_delivery_note_invoice_permission_to_existing_accountants.php');
        $migration->up();
        $migration->up();

        $accountant->refresh();
        $custom->refresh();
        $this->assertContains('delivery_notes.invoice', $accountant->permissions);
        $this->assertSame(1, count(array_keys($accountant->permissions, 'delivery_notes.invoice', true)));
        $this->assertSame(['delivery_notes.view'], $custom->permissions);

        $migration->down();
        $accountant->refresh();
        $custom->refresh();
        $this->assertNotContains('delivery_notes.invoice', $accountant->permissions);
        $this->assertSame($legacyPermissions, $accountant->permissions);
        $this->assertSame(['delivery_notes.view'], $custom->permissions);
    }

    #[Test]
    public function a_new_tenant_receives_the_delivery_note_invoice_permission_from_the_current_system_role_matrix(): void
    {
        $auth = $this->registerTenant('new-delivery-invoice-permission', 'owner@new-delivery-invoice-permission.test');
        app(TenantContext::class)->set($auth['tenant_id']);

        $accountant = Role::query()->where('slug', 'accountant')->sole();

        $this->assertContains('delivery_notes.invoice', $accountant->permissions);
    }
}
