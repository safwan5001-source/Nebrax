<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\PersonalAccessToken;
use Tests\TestCase;

/**
 * AUTH-REMEMBER-1: «تذكرني» = توكن 30 يوماً يفرضه الخادم؛ الافتراضي 7؛ لا توكن دائم.
 */
class AuthRememberMeTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function login(array $extra = []): array
    {
        $this->registerTenant('nibras', 'owner@nibras.test');

        return $this->postJson('/api/login', ['email' => 'owner@nibras.test', 'password' => 'password123'] + $extra)
            ->assertOk()->json();
    }

    private function tokenRow(string $plain): ?PersonalAccessToken
    {
        return PersonalAccessToken::findToken($plain);
    }

    /** @test */
    public function default_login_token_lasts_seven_days(): void
    {
        $row = $this->tokenRow($this->login()['token']);
        $this->assertEqualsWithDelta(7 * 86400, now()->diffInSeconds($row->expires_at, false), 5);
    }

    /** @test */
    public function remember_false_keeps_the_seven_day_lifetime(): void
    {
        $row = $this->tokenRow($this->login(['remember' => false])['token']);
        $this->assertEqualsWithDelta(7 * 86400, now()->diffInSeconds($row->expires_at, false), 5);
    }

    /** @test */
    public function remember_true_issues_a_server_enforced_thirty_day_token(): void
    {
        $row = $this->tokenRow($this->login(['remember' => true])['token']);
        $this->assertNotNull($row->expires_at);
        $this->assertEqualsWithDelta(30 * 86400, now()->diffInSeconds($row->expires_at, false), 5);
    }

    /** @test */
    public function remember_must_be_boolean(): void
    {
        $this->registerTenant('nibras', 'owner@nibras.test');
        $this->postJson('/api/login', ['email' => 'owner@nibras.test', 'password' => 'password123', 'remember' => 'forever'])
            ->assertStatus(422);
    }

    /** @test */
    public function an_expired_remembered_token_is_rejected_and_a_valid_one_restores_the_session(): void
    {
        $plain = $this->login(['remember' => true])['token'];
        $this->withToken($plain)->getJson('/api/me')->assertOk();

        $this->travel(31)->days();
        $this->app['auth']->forgetGuards();
        $this->withToken($plain)->getJson('/api/me')->assertUnauthorized();
    }

    /** @test */
    public function the_seven_day_token_expires_while_a_remembered_one_survives(): void
    {
        $short = $this->login()['token'];
        $long = $this->postJson('/api/login', ['email' => 'owner@nibras.test', 'password' => 'password123', 'remember' => true])->json('token');

        $this->travel(10)->days();
        $this->app['auth']->forgetGuards();
        $this->withToken($short)->getJson('/api/me')->assertUnauthorized();
        $this->app['auth']->forgetGuards();
        $this->withToken($long)->getJson('/api/me')->assertOk();
    }

    /** @test */
    public function logout_revokes_the_remembered_token(): void
    {
        $plain = $this->login(['remember' => true])['token'];
        $this->withToken($plain)->postJson('/api/logout')->assertOk();
        $this->assertNull($this->tokenRow($plain));
        $this->app['auth']->forgetGuards();
        $this->withToken($plain)->getJson('/api/me')->assertUnauthorized();
    }

    /** @test */
    public function an_invalid_token_gets_401(): void
    {
        $this->withToken('999|not-a-real-token')->getJson('/api/me')->assertUnauthorized();
    }
}
