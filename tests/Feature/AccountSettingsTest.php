<?php

namespace Tests\Feature;

use App\Models\AccountExportEvent;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AccountSettingsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function user_can_save_only_supported_display_preferences(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->putJson('/api/account/preferences', [
            'locale' => 'en',
            'theme'  => 'dark',
        ])->assertOk()
            ->assertJsonPath('user.preferences.locale', 'en')
            ->assertJsonPath('user.preferences.theme', 'dark');

        $this->withToken($auth['token'])->getJson('/api/me')
            ->assertOk()
            ->assertJsonPath('user.preferences.locale', 'en')
            ->assertJsonPath('user.preferences.theme', 'dark');

        $this->withToken($auth['token'])->putJson('/api/account/preferences', [
            'locale' => 'fr',
            'theme'  => 'neon',
        ])->assertStatus(422);
    }

    /** @test */
    public function user_must_confirm_current_password_to_change_email_and_global_email_stays_unique(): void
    {
        $auth = $this->registerTenant('account-email', 'account-email@example.test');
        $this->registerTenant('occupied-email', 'occupied@example.test');

        $this->withToken($auth['token'])->putJson('/api/account/email', [
            'email'            => 'new-account-email@example.test',
            'current_password' => 'wrong-password',
        ])->assertStatus(422);

        $this->withToken($auth['token'])->putJson('/api/account/email', [
            'email'            => 'occupied@example.test',
            'current_password' => 'password123',
        ])->assertStatus(422);

        $this->withToken($auth['token'])->putJson('/api/account/email', [
            'email'            => 'new-account-email@example.test',
            'current_password' => 'password123',
        ])->assertOk()
            ->assertJsonPath('user.email', 'new-account-email@example.test');

        $this->postJson('/api/login', [
            'email'    => 'new-account-email@example.test',
            'password' => 'password123',
        ])->assertOk();
    }

    /** @test */
    public function password_change_keeps_current_token_and_revokes_other_sessions(): void
    {
        $auth = $this->registerTenant('account-password', 'account-password@example.test');
        $user = User::where('email', 'account-password@example.test')->firstOrFail();
        $otherToken = $user->createToken('other-device')->plainTextToken;

        $this->withToken($auth['token'])->putJson('/api/account/password', [
            'current_password'      => 'password123',
            'password'              => 'new-password-123',
            'password_confirmation' => 'new-password-123',
        ])->assertOk();

        $this->withToken($auth['token'])->getJson('/api/me')->assertOk();
        $this->withToken($otherToken)->getJson('/api/me')->assertUnauthorized();

        $this->postJson('/api/login', [
            'email'    => 'account-password@example.test',
            'password' => 'new-password-123',
        ])->assertOk();
    }

    /** @test */
    public function company_export_is_owner_only_and_never_contains_credentials(): void
    {
        $auth = $this->registerTenant('account-export', 'account-export@example.test');
        $owner = User::where('email', 'account-export@example.test')->firstOrFail();
        $adminToken = $this->tokenForRole($auth['tenant_id'], 'admin', 'account-export-admin@example.test');

        $this->withToken($adminToken)->getJson('/api/account/export')->assertForbidden();

        $response = $this->withToken($auth['token'])->getJson('/api/account/export');
        $response->assertOk();
        $response->assertHeader('content-type', 'application/json; charset=UTF-8');
        $this->assertStringContainsString('attachment;', (string) $response->headers->get('content-disposition'));

        $export = json_decode($response->streamedContent(), true, 512, JSON_THROW_ON_ERROR);
        $this->assertSame(1, $export['export_version']);
        $this->assertSame($auth['tenant_id'], $export['company']['id']);
        $this->assertSame('account-export@example.test', $export['users'][0]['email']);
        $this->assertArrayNotHasKey('password', $export['users'][0]);
        $this->assertArrayNotHasKey('personal_access_tokens', $export);

        $this->assertDatabaseHas('account_export_events', [
            'tenant_id' => $auth['tenant_id'],
            'user_id'   => $owner->id,
        ]);
        $this->assertSame(1, AccountExportEvent::count());
    }
}
