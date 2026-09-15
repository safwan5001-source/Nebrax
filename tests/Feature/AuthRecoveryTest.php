<?php

namespace Tests\Feature;

use App\Mail\AuthActionMail;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Carbon;
use Tests\TestCase;

class AuthRecoveryTest extends TestCase
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
    public function unknown_email_gets_the_same_neutral_response(): void
    {
        $message = $this->postJson('/api/forgot-password', ['email' => 'missing@example.test'])
            ->assertOk()->json('message');
        $this->postJson('/api/forgot-password', ['email' => 'owner@example.test'])
            ->assertOk()->assertJsonPath('message', $message);
    }

    /** @test */
    public function reset_token_changes_password_and_is_single_use(): void
    {
        $this->registerTenant('alpha', 'owner@example.test');
        $this->postJson($this->tenantUrl('alpha', 'forgot-password'), ['email' => 'owner@example.test'])->assertOk();
        Mail::assertSent(AuthActionMail::class, function (AuthActionMail $mail) use (&$url): bool {
            $url = $mail->url;
            return $mail->action === 'reset';
        });
        parse_str((string) parse_url($url, PHP_URL_QUERY), $query);
        $token = $query['token'];
        $payload = ['token' => $token, 'password' => 'new-password-123', 'password_confirmation' => 'new-password-123'];
        $this->postJson($this->tenantUrl('alpha', 'reset-password'), $payload)->assertOk();
        $this->postJson($this->tenantUrl('alpha', 'reset-password'), $payload)->assertStatus(422);
        $this->postJson('/api/login', ['email' => 'owner@example.test', 'password' => 'new-password-123'])->assertOk();
    }

    /** @test */
    public function expired_reset_token_is_rejected(): void
    {
        $this->registerTenant('alpha', 'owner@example.test');
        $this->postJson($this->tenantUrl('alpha', 'forgot-password'), ['email' => 'owner@example.test']);
        Mail::assertSent(AuthActionMail::class, function (AuthActionMail $mail) use (&$url): bool { $url = $mail->url; return $mail->action === 'reset'; });
        parse_str((string) parse_url($url, PHP_URL_QUERY), $query);
        DB::table('auth_action_tokens')->update(['expires_at' => Carbon::now()->subMinute()]);
        $this->postJson($this->tenantUrl('alpha', 'reset-password'), ['token' => $query['token'], 'password' => 'new-password-123', 'password_confirmation' => 'new-password-123'])->assertStatus(422);
    }

    /** @test */
    public function email_verification_is_single_use_and_resend_is_rate_limited(): void
    {
        $auth = $this->registerTenant('alpha', 'owner@example.test');
        $user = User::where('email', 'owner@example.test')->firstOrFail();
        $this->withToken($auth['token'])->postJson('/api/email/verification-notification')->assertOk();
        Mail::assertSent(AuthActionMail::class, function (AuthActionMail $mail) use (&$url): bool { $url = $mail->url; return $mail->action === 'verify'; });
        parse_str((string) parse_url($url, PHP_URL_QUERY), $query);
        $this->postJson($this->tenantUrl('alpha', 'email/verify'), ['token' => $query['token']])->assertOk();
        $this->assertNotNull($user->fresh()->email_verified_at);
        $this->postJson($this->tenantUrl('alpha', 'email/verify'), ['token' => $query['token']])->assertStatus(422);
        for ($i = 0; $i < 5; $i++) { $this->withToken($auth['token'])->postJson('/api/email/verification-notification'); }
        $this->withToken($auth['token'])->postJson('/api/email/verification-notification')->assertStatus(429);
    }

    /** @test */
    public function token_from_tenant_a_cannot_be_used_on_tenant_b(): void
    {
        $this->registerTenant('alpha', 'owner@alpha.test');
        $this->registerTenant('beta', 'owner@beta.test');
        $this->postJson($this->tenantUrl('alpha', 'forgot-password'), ['email' => 'owner@alpha.test']);
        Mail::assertSent(AuthActionMail::class, function (AuthActionMail $mail) use (&$url): bool { $url = $mail->url; return $mail->action === 'reset'; });
        parse_str((string) parse_url($url, PHP_URL_QUERY), $query);
        $this->postJson($this->tenantUrl('beta', 'reset-password'), ['token' => $query['token'], 'password' => 'new-password-123', 'password_confirmation' => 'new-password-123'])->assertStatus(422);
    }

    /** @test */
    public function tenant_bound_token_fails_without_hostname_context(): void
    {
        $this->registerTenant('alpha', 'owner@alpha.test');
        $this->postJson($this->tenantUrl('alpha', 'forgot-password'), ['email' => 'owner@alpha.test']);
        Mail::assertSent(AuthActionMail::class, function (AuthActionMail $mail) use (&$url): bool { $url = $mail->url; return $mail->action === 'reset'; });
        parse_str((string) parse_url($url, PHP_URL_QUERY), $query);
        // مضيف مطلق غير-مستأجر صراحةً: مسار نسبي هنا يرث جذر آخر طلب مُعالَج
        // (alpha.awj.app أعلاه) عبر مساعد url()، فيُبطل ما يفحصه هذا الاختبار.
        $this->postJson('http://localhost/api/reset-password', ['token' => $query['token'], 'password' => 'new-password-123', 'password_confirmation' => 'new-password-123'])->assertStatus(422);
    }

    /** @test */
    public function verification_token_is_rejected_on_other_tenant_and_without_context(): void
    {
        $auth = $this->registerTenant('alpha', 'owner@alpha.test');
        $this->registerTenant('beta', 'owner@beta.test');
        $this->withToken($auth['token'])->postJson('/api/email/verification-notification');
        Mail::assertSent(AuthActionMail::class, function (AuthActionMail $mail) use (&$url): bool { $url = $mail->url; return $mail->action === 'verify'; });
        parse_str((string) parse_url($url, PHP_URL_QUERY), $query);
        $this->postJson($this->tenantUrl('beta', 'email/verify'), ['token' => $query['token']])->assertStatus(422);
        $this->postJson('/api/email/verify', ['token' => $query['token']])->assertStatus(422);
    }

    /** @test */
    public function forgot_password_without_tenant_context_does_not_issue_a_global_token(): void
    {
        $this->registerTenant('alpha', 'owner@alpha.test');
        Mail::assertSent(AuthActionMail::class, 1);
        $this->postJson('/api/forgot-password', ['email' => 'owner@alpha.test'])
            ->assertOk()->assertJsonPath('message', 'إذا كان الحساب موجوداً لهذا البريد، فقد أُرسلت تعليمات الاسترداد.');
        Mail::assertSent(AuthActionMail::class, 1);
        $this->assertDatabaseMissing('auth_action_tokens', ['type' => 'password_reset']);
    }

    /** @test */
    public function generated_links_use_the_tenant_frontend_hostname(): void
    {
        $this->registerTenant('alpha', 'owner@alpha.test');
        $this->postJson($this->tenantUrl('alpha', 'forgot-password'), ['email' => 'owner@alpha.test']);
        Mail::assertSent(AuthActionMail::class, function (AuthActionMail $mail): bool {
            return $mail->action === 'reset' && str_starts_with($mail->url, 'http://alpha.awj.app/reset-password?token=');
        });
        $auth = User::where('email', 'owner@alpha.test')->firstOrFail()->createToken('test')->plainTextToken;
        $this->withToken($auth)->postJson('/api/email/verification-notification');
        Mail::assertSent(AuthActionMail::class, function (AuthActionMail $mail): bool {
            return $mail->action === 'verify' && str_starts_with($mail->url, 'http://alpha.awj.app/verify-email?token=');
        });
    }
}
