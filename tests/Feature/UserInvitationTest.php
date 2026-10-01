<?php

namespace Tests\Feature;

use App\Mail\AuthActionMail;
use App\Models\User;
use App\Services\AuthRecoveryService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class UserInvitationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
    }

    private function tenantUrl(string $slug, string $path): string
    {
        return "http://{$slug}.awj.app/api/{$path}";
    }

    /** @test */
    public function authorized_admin_can_create_a_user_and_send_a_secure_invitation_without_plaintext_password(): void
    {
        $auth = $this->registerTenant('alpha', 'owner@alpha.test');
        $response = $this->withToken($auth['token'])->postJson('/api/users', [
            'name' => 'موظف ألفا',
            'email' => 'user@alpha.test',
            'role' => 'staff',
            'send_invitation' => true,
        ])->assertCreated();

        $user = User::where('email', 'user@alpha.test')->firstOrFail();
        $this->assertNotSame('password123', $user->password);
        $this->assertFalse(Hash::check('password123', $user->password));
        $this->assertDatabaseHas('auth_action_tokens', [
            'tenant_id' => $auth['tenant_id'],
            'user_id' => $user->id,
            'type' => AuthRecoveryService::LOGIN_INVITATION,
        ]);
        Mail::assertSent(AuthActionMail::class, function (AuthActionMail $mail): bool {
            return $mail->action === 'invite'
                && $mail->tenantName === 'شركة alpha'
                && $mail->userName === 'موظف ألفا'
                && $mail->loginEmail === 'user@alpha.test'
                && str_starts_with($mail->url, 'http://alpha.awj.app/reset-password?token=');
        });
        $this->assertStringNotContainsString('password123', (string) app('view')->make('emails.auth-action', [
            'action' => 'invite', 'url' => 'https://alpha.awj.app/reset-password?token=redacted',
            'tenantName' => 'شركة alpha', 'userName' => 'موظف ألفا', 'loginEmail' => 'user@alpha.test',
        ])->render());
        $this->assertNotNull($response->json('data.id'));
    }

    /** @test */
    public function resend_keeps_the_current_password_unchanged_and_is_rate_limited(): void
    {
        $auth = $this->registerTenant('alpha', 'owner@alpha.test');
        $user = User::create([
            'tenant_id' => $auth['tenant_id'], 'name' => 'مستخدم', 'email' => 'user@alpha.test',
            'password' => 'known-password-123', 'role' => 'staff',
        ]);
        $before = $user->fresh()->password;

        $this->withToken($auth['token'])->postJson("/api/users/{$user->id}/send-invitation")
            ->assertOk()->assertJsonPath('message', 'تم إرسال بيانات الدخول إلى بريد المستخدم.');
        $this->assertSame($before, $user->fresh()->password);
        Mail::assertSent(AuthActionMail::class, fn (AuthActionMail $mail): bool => $mail->action === 'invite');

        for ($i = 0; $i < 4; $i++) {
            $this->withToken($auth['token'])->postJson("/api/users/{$user->id}/send-invitation");
        }
        $this->withToken($auth['token'])->postJson("/api/users/{$user->id}/send-invitation")->assertStatus(429);
    }

    /** @test */
    public function unauthorized_and_cross_tenant_targets_are_rejected(): void
    {
        $a = $this->registerTenant('alpha', 'owner@alpha.test');
        $b = $this->registerTenant('beta', 'owner@beta.test');
        $userA = User::where('email', 'owner@alpha.test')->firstOrFail();
        $staff = $this->tokenForRole($a['tenant_id'], 'staff', 'staff@alpha.test');

        $this->withToken($staff)->postJson("/api/users/{$userA->id}/send-invitation")->assertForbidden();
        $this->withToken($b['token'])->postJson("/api/users/{$userA->id}/send-invitation")->assertNotFound();
    }

    /** @test */
    public function invitation_token_is_tenant_bound_single_use_and_changes_password_only_on_completion(): void
    {
        $a = $this->registerTenant('alpha', 'owner@alpha.test');
        $b = $this->registerTenant('beta', 'owner@beta.test');
        $user = User::create([
            'tenant_id' => $a['tenant_id'], 'name' => 'مدعو', 'email' => 'invite@alpha.test',
            'password' => 'old-password-123', 'role' => 'staff',
        ]);
        $token = app(AuthRecoveryService::class)->issue($user, AuthRecoveryService::LOGIN_INVITATION);
        $before = $user->fresh()->password;
        $user->createToken('active-session');

        $this->postJson($this->tenantUrl('beta', 'reset-password'), [
            'token' => $token, 'password' => 'new-password-123', 'password_confirmation' => 'new-password-123',
        ])->assertStatus(422);
        $this->assertSame($before, $user->fresh()->password);

        $this->postJson($this->tenantUrl('alpha', 'reset-password'), [
            'token' => $token, 'password' => 'new-password-123', 'password_confirmation' => 'new-password-123',
        ])->assertOk();
        $this->assertTrue(Hash::check('new-password-123', $user->fresh()->password));
        $this->assertDatabaseMissing('personal_access_tokens', ['tokenable_id' => $user->id, 'name' => 'active-session']);
        $this->postJson($this->tenantUrl('alpha', 'reset-password'), [
            'token' => $token, 'password' => 'another-password-123', 'password_confirmation' => 'another-password-123',
        ])->assertStatus(422);
    }

    /** @test */
    public function an_expired_invitation_token_is_rejected(): void
    {
        $a = $this->registerTenant('alpha', 'owner@alpha.test');
        $user = User::create([
            'tenant_id' => $a['tenant_id'], 'name' => 'مدعو', 'email' => 'invite@alpha.test',
            'password' => 'old-password-123', 'role' => 'staff',
        ]);
        $token = app(AuthRecoveryService::class)->issue($user, AuthRecoveryService::LOGIN_INVITATION);
        DB::table('auth_action_tokens')->where('user_id', $user->id)->update(['expires_at' => now()->subMinute()]);

        $this->postJson($this->tenantUrl('alpha', 'reset-password'), [
            'token' => $token, 'password' => 'new-password-123', 'password_confirmation' => 'new-password-123',
        ])->assertStatus(422);
    }
}
