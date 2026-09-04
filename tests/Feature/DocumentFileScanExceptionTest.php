<?php

namespace Tests\Feature;

use App\Models\PlatformAdministrator;
use App\Models\PlatformAdministratorAction;
use App\Models\PlatformDocumentFileScanException;
use App\Models\PlatformIntegrationSetting;
use App\Services\PlatformIntegrationResolver;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Carbon;
use LogicException;
use Tests\TestCase;

class DocumentFileScanExceptionTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    public function test_grant_fields_are_immutable_and_revoke_is_one_way(): void
    {
        $auth = $this->registerTenant('scan-exception', 'scan-exception@nebrax.test', false);
        $admin = PlatformAdministrator::create(['name' => 'Platform Operator', 'email' => 'scan-admin@nebrax.test', 'password' => 'platform-password-123']);
        $exception = PlatformDocumentFileScanException::create(['tenant_id' => $auth['tenant_id'], 'reason' => 'temporary scanner outage', 'granted_by' => $admin->id, 'granted_at' => now('UTC'), 'expires_at' => Carbon::now('UTC')->addHour()]);

        $exception->reason = 'rewritten';
        $this->expectException(LogicException::class);
        $exception->save();
    }

    public function test_first_revoke_records_actor_reason_and_audit_and_cannot_be_rewritten(): void
    {
        $auth = $this->registerTenant('scan-revoke', 'scan-revoke@nebrax.test', false);
        $admin = PlatformAdministrator::create(['name' => 'Platform Operator', 'email' => 'revoke-admin@nebrax.test', 'password' => 'platform-password-123']);
        $exception = PlatformDocumentFileScanException::create(['tenant_id' => $auth['tenant_id'], 'reason' => 'temporary scanner outage', 'granted_by' => $admin->id, 'granted_at' => now('UTC')]);
        $token = $admin->createToken('platform-console', ['platform:read', 'platform:manage'])->plainTextToken;

        $this->withToken($token)->postJson("/api/platform/document-file-scan-exceptions/{$exception->id}/revoke", ['reason' => 'scanner restored', 'current_password' => 'platform-password-123'])->assertOk();
        $revoked = $exception->fresh();
        $this->assertNotNull($revoked->revoked_at);
        $this->assertSame($admin->id, $revoked->revoked_by);
        $this->assertSame('scanner restored', $revoked->revocation_reason);
        $this->assertDatabaseHas('platform_administrator_actions', ['platform_administrator_id' => $admin->id, 'action' => PlatformAdministratorAction::ACTION_FILE_SCAN_EXCEPTION_REVOKED]);

        $this->withToken($token)->postJson("/api/platform/document-file-scan-exceptions/{$exception->id}/revoke", ['reason' => 'again', 'current_password' => 'platform-password-123'])->assertUnprocessable();
        $revoked->revocation_reason = 'rewritten';
        $this->expectException(LogicException::class);
        $revoked->save();
    }

    public function test_only_disabled_or_unconfigured_scanners_are_authoritatively_inactive_for_admission(): void
    {
        PlatformIntegrationSetting::create([
            'integration_key' => 'malware_scanner',
            'provider' => 'clamav_tcp',
            'enabled' => true,
            'configuration' => [],
        ]);
        $this->assertFalse(app(PlatformIntegrationResolver::class)->malwareScannerIsAuthoritativelyDisabledOrUnconfigured());

        PlatformIntegrationSetting::query()->where('integration_key', 'malware_scanner')->update(['enabled' => false]);
        $this->app->forgetInstance(PlatformIntegrationResolver::class);
        $this->assertTrue(app(PlatformIntegrationResolver::class)->malwareScannerIsAuthoritativelyDisabledOrUnconfigured());

        PlatformIntegrationSetting::query()->where('integration_key', 'malware_scanner')->delete();
        $this->app->forgetInstance(PlatformIntegrationResolver::class);
        $this->assertTrue(app(PlatformIntegrationResolver::class)->malwareScannerIsAuthoritativelyDisabledOrUnconfigured());

        Schema::shouldReceive('hasTable')->once()->with('platform_integration_settings')->andReturn(false);
        $this->assertFalse((new PlatformIntegrationResolver())->malwareScannerIsAuthoritativelyDisabledOrUnconfigured());
    }
}
