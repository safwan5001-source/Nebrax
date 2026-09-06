<?php

namespace Tests\Feature;

use App\Support\Rbac;
use Tests\TestCase;

/**
 * ACC-1: صلاحيتا `accounting_settings.view`/`manage` — مركز إعدادات المحاسبة
 * لا يغيّر أي سلوك محاسبي؛ هذا الاختبار يحرس التعريف والافتراضات فقط.
 * تشغيل: php artisan test --filter=AccountingSettingsRbacTest
 */
class AccountingSettingsRbacTest extends TestCase
{
    /** @test */
    public function permission_catalog_contains_the_new_permissions(): void
    {
        $this->assertContains('accounting_settings.view', Rbac::PERMISSIONS);
        $this->assertContains('accounting_settings.manage', Rbac::PERMISSIONS);
    }

    /** @test */
    public function owner_and_admin_have_access_via_wildcard(): void
    {
        $this->assertTrue(Rbac::allows('owner', 'accounting_settings.view'));
        $this->assertTrue(Rbac::allows('owner', 'accounting_settings.manage'));
        $this->assertTrue(Rbac::allows('admin', 'accounting_settings.view'));
        $this->assertTrue(Rbac::allows('admin', 'accounting_settings.manage'));
    }

    /** @test */
    public function accountant_and_staff_do_not_have_access_by_default(): void
    {
        $this->assertFalse(Rbac::allows('accountant', 'accounting_settings.view'));
        $this->assertFalse(Rbac::allows('accountant', 'accounting_settings.manage'));
        $this->assertFalse(Rbac::allows('staff', 'accounting_settings.view'));
        $this->assertFalse(Rbac::allows('staff', 'accounting_settings.manage'));
    }
}
