<?php

namespace Tests\Feature;

use App\Mail\AuthActionMail;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
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

    /**
     * AUTH-MAIL-PROD-1 diagnostic — الإرسال الناجح لا يسرّب البريد ولا التوكن
     * إلى السجل، والحقول المتوقعة تُسجَّل صحيحة.
     *
     * @test
     */
    public function diagnostic_log_on_a_successful_send_never_exposes_the_email_or_token(): void
    {
        $captured = null;
        Log::shouldReceive('info')
            ->once()
            ->with('auth_recovery_diagnostic', \Mockery::on(function (array $payload) use (&$captured): bool {
                $captured = $payload;
                return true;
            }));

        $this->registerTenant('alpha', 'owner@alpha.test');
        $this->postJson($this->tenantUrl('alpha', 'forgot-password'), ['email' => 'owner@alpha.test'])->assertOk();

        $url = null;
        Mail::assertSent(AuthActionMail::class, function (AuthActionMail $mail) use (&$url): bool {
            $url = $mail->url;
            return $mail->action === 'reset';
        });
        parse_str((string) parse_url($url, PHP_URL_QUERY), $query);
        $token = $query['token'];
        $tokenHash = hash('sha256', $token);

        $this->assertNotNull($captured);
        $haystack = json_encode($captured);
        $this->assertStringNotContainsString('owner@alpha.test', $haystack);
        $this->assertStringNotContainsString($token, $haystack);
        $this->assertStringNotContainsString($tokenHash, $haystack);
        $this->assertArrayNotHasKey('email', $captured);
        $this->assertArrayNotHasKey('token', $captured);
        $this->assertArrayNotHasKey('password', $captured);

        $this->assertTrue($captured['hostname_tenant_present']);
        $this->assertSame('alpha', $captured['tenant_slug_resolved']);
        $this->assertTrue($captured['user_matched']);
        $this->assertTrue($captured['token_issue_reached']);
        $this->assertTrue($captured['mail_send_reached']);
        $this->assertArrayNotHasKey('exception_class', $captured);
    }

    /**
     * AUTH-MAIL-PROD-1 diagnostic — بلا سياق مستأجر يبقى السلوك مغلقاً
     * (محايد، بلا بريد، بلا توكن) والحقول المسجَّلة تعكس ذلك دون تسريب البريد.
     *
     * @test
     */
    public function diagnostic_log_without_tenant_context_stays_fail_closed(): void
    {
        $this->registerTenant('alpha', 'owner@alpha.test');

        $captured = null;
        Log::shouldReceive('info')
            ->once()
            ->with('auth_recovery_diagnostic', \Mockery::on(function (array $payload) use (&$captured): bool {
                $captured = $payload;
                return true;
            }));

        $res = $this->postJson('/api/forgot-password', ['email' => 'owner@alpha.test']);

        $res->assertOk()->assertJsonPath('message', 'إذا كان الحساب موجوداً لهذا البريد، فقد أُرسلت تعليمات الاسترداد.');
        Mail::assertNotSent(AuthActionMail::class, fn (AuthActionMail $mail) => $mail->action === 'reset');
        $this->assertDatabaseMissing('auth_action_tokens', ['type' => 'password_reset']);

        $this->assertNotNull($captured);
        $this->assertStringNotContainsString('owner@alpha.test', json_encode($captured));
        $this->assertFalse($captured['hostname_tenant_present']);
        $this->assertNull($captured['tenant_slug_resolved']);
        $this->assertFalse($captured['user_matched']);
        $this->assertFalse($captured['token_issue_reached']);
        $this->assertFalse($captured['mail_send_reached']);
    }

    /**
     * AUTH-MAIL-PROD-1 diagnostic — تعارض Host/Origin بين مستأجرين يُرفض
     * مغلقاً (404) داخل الـ middleware قبل بلوغ المتحكم، فلا يصدر أي حدث
     * تشخيصي إطلاقاً — حدود العزل بين المستأجرين لم تتغيّر.
     *
     * @test
     */
    public function diagnostic_logging_does_not_run_and_cross_tenant_isolation_holds_on_conflicting_origin(): void
    {
        $this->registerTenant('company-a', 'a@alpha.test');
        $this->registerTenant('company-b', 'b@beta.test');

        Log::shouldReceive('info')->never();

        $res = $this->postJson($this->tenantUrl('company-a', 'forgot-password'), [
            'email' => 'a@alpha.test',
        ], ['Origin' => 'https://company-b.awj.app']);

        $res->assertStatus(404);
        Mail::assertNotSent(AuthActionMail::class, fn (AuthActionMail $mail) => $mail->action === 'reset');
    }
}
