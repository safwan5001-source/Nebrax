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
    public function preferences_save_merges_and_keeps_keys_the_request_does_not_carry(): void
    {
        $auth = $this->registerTenant();
        $user = User::withoutGlobalScopes()->where('email', 'owner@acme.test')->firstOrFail();
        // مفتاح مخزَّن غير معروف لهذا الطلب (مثلاً من إصدار أحدث) لا يجوز أن يضيع عند حفظ العرض.
        $user->forceFill(['preferences' => ['locale' => 'ar', 'theme' => 'system', 'appTheme' => 'ink', 'future_key' => ['a' => 1]]])->save();

        $this->withToken($auth['token'])->putJson('/api/account/preferences', ['locale' => 'en', 'theme' => 'dark'])
            ->assertOk()
            ->assertJsonPath('user.preferences.locale', 'en')
            ->assertJsonPath('user.preferences.appTheme', 'ink')
            ->assertJsonPath('user.preferences.future_key.a', 1);
    }

    /** @test */
    public function commerce_alerts_preference_is_saved_alone_and_survives_display_saves(): void
    {
        $auth = $this->registerTenant();
        $other = $this->registerTenant('globex', 'owner@globex.test');

        // حفظ التنبيه وحده بلا locale/theme (توافق: الحسابات الجديدة تحصل على افتراضات /me).
        $this->withToken($auth['token'])->putJson('/api/account/preferences', ['commerce_alerts' => ['enabled' => false]])
            ->assertOk()
            ->assertJsonPath('user.preferences.commerce_alerts.enabled', false)
            ->assertJsonPath('user.preferences.locale', 'ar')
            ->assertJsonPath('user.preferences.theme', 'system')
            ->assertJsonPath('user.preferences.appTheme', 'default');

        // حفظ عرض لاحق لا يمحو التنبيه.
        $this->withToken($auth['token'])->putJson('/api/account/preferences', ['locale' => 'en', 'theme' => 'light'])
            ->assertOk()
            ->assertJsonPath('user.preferences.commerce_alerts.enabled', false)
            ->assertJsonPath('user.preferences.locale', 'en');

        // وحفظ التنبيه لا يمحو العرض.
        $this->withToken($auth['token'])->putJson('/api/account/preferences', ['commerce_alerts' => ['enabled' => true]])
            ->assertOk()
            ->assertJsonPath('user.preferences.commerce_alerts.enabled', true)
            ->assertJsonPath('user.preferences.locale', 'en')
            ->assertJsonPath('user.preferences.theme', 'light');

        $this->withToken($auth['token'])->getJson('/api/me')
            ->assertOk()
            ->assertJsonPath('user.preferences.commerce_alerts.enabled', true);

        // شخصي: مستخدم مؤسسة أخرى لا يتأثر.
        $this->withToken($other['token'])->getJson('/api/me')
            ->assertOk()
            ->assertJsonMissingPath('user.preferences.commerce_alerts');
    }

    /** @test */
    public function commerce_alerts_preference_is_strictly_validated(): void
    {
        $auth = $this->registerTenant();

        foreach ([
            ['commerce_alerts' => ['enabled' => 'maybe']],
            ['commerce_alerts' => ['enabled' => true, 'storefronts' => ['x']]], // مفتاح غير مسموح بعد
            ['commerce_alerts' => 'on'],
            ['commerce_alerts' => []],      // لا مفتاح ⇒ لا locale/theme ⇒ طلب فارغ
            [],
            ['locale' => 'en'],             // locale بلا theme كما كان 422
        ] as $body) {
            $this->withToken($auth['token'])->putJson('/api/account/preferences', $body)->assertStatus(422);
        }

        $this->withToken($auth['token'])->getJson('/api/me')->assertJsonMissingPath('user.preferences.commerce_alerts');
    }

    /** @test */
    public function saves_of_different_keys_from_different_devices_do_not_overwrite_each_other(): void
    {
        $auth = $this->registerTenant();

        // تسلسل جهازين: كل حفظ يقرأ آخر حالة مقفولة فيدمج عليها (السباق الحقيقي يحرسه قفل الصف على PostgreSQL).
        $this->withToken($auth['token'])->putJson('/api/account/preferences', ['locale' => 'en', 'theme' => 'dark', 'appTheme' => 'core'])->assertOk();
        $this->withToken($auth['token'])->putJson('/api/account/preferences', ['commerce_alerts' => ['enabled' => false]])->assertOk();
        $this->withToken($auth['token'])->putJson('/api/account/preferences', ['locale' => 'ar', 'theme' => 'dark'])
            ->assertOk()
            ->assertJsonPath('user.preferences.appTheme', 'core')
            ->assertJsonPath('user.preferences.commerce_alerts.enabled', false);
    }

    /** @test */
    public function app_theme_defaults_to_default_and_is_not_dropped_by_a_locale_only_save(): void
    {
        $auth = $this->registerTenant();

        // لم يُرسَل appTheme من قبل — الافتراض المخزَّن default.
        $this->withToken($auth['token'])->getJson('/api/me')
            ->assertOk()
            ->assertJsonPath('user.preferences.appTheme', 'default');

        $this->withToken($auth['token'])->putJson('/api/account/preferences', [
            'locale'   => 'ar',
            'theme'    => 'system',
            'appTheme' => 'ink',
        ])->assertOk()
            ->assertJsonPath('user.preferences.appTheme', 'ink');

        // حفظ لاحق بلا appTheme (عميل قديم) لا يمسح الاختيار القائم.
        $this->withToken($auth['token'])->putJson('/api/account/preferences', [
            'locale' => 'en',
            'theme'  => 'light',
        ])->assertOk()
            ->assertJsonPath('user.preferences.locale', 'en')
            ->assertJsonPath('user.preferences.appTheme', 'ink');

        $this->withToken($auth['token'])->putJson('/api/account/preferences', [
            'locale'   => 'en',
            'theme'    => 'light',
            'appTheme' => 'neon',
        ])->assertStatus(422);
    }

    /** @test */
    public function app_theme_core_is_saved_restored_and_survives_a_preferences_only_save(): void
    {
        $auth = $this->registerTenant();
        $other = $this->registerTenant('globex', 'owner@globex.test');

        // AWJ Core (الثيم الثالث): يُحفظ ويُسترجع عبر /me كما Ink تماماً.
        $this->withToken($auth['token'])->putJson('/api/account/preferences', [
            'locale'   => 'ar',
            'theme'    => 'dark',
            'appTheme' => 'core',
        ])->assertOk()
            ->assertJsonPath('user.preferences.appTheme', 'core')
            ->assertJsonPath('user.preferences.theme', 'dark');

        $this->withToken($auth['token'])->getJson('/api/me')
            ->assertOk()
            ->assertJsonPath('user.preferences.appTheme', 'core');

        // عميل قديم لا يرسل appTheme لا يمسح الاختيار.
        $this->withToken($auth['token'])->putJson('/api/account/preferences', [
            'locale' => 'en',
            'theme'  => 'light',
        ])->assertOk()
            ->assertJsonPath('user.preferences.appTheme', 'core');

        // التفضيل شخصي: مستخدم مؤسسة أخرى لا يتأثر.
        $this->withToken($other['token'])->getJson('/api/me')
            ->assertOk()
            ->assertJsonPath('user.preferences.appTheme', 'default');

        // القيم القديمة ما زالت مقبولة، والانتقال بين الثلاثة حرّ.
        foreach (['ink', 'default', 'core', 'ink'] as $value) {
            $this->withToken($auth['token'])->putJson('/api/account/preferences', [
                'locale'   => 'ar',
                'theme'    => 'system',
                'appTheme' => $value,
            ])->assertOk()
                ->assertJsonPath('user.preferences.appTheme', $value);
        }

        // القائمة مغلقة: لا حساسية حالة ولا قيم مجاورة.
        foreach (['Core', 'CORE', 'cores', 'neon', 'dark'] as $invalid) {
            $this->withToken($auth['token'])->putJson('/api/account/preferences', [
                'locale'   => 'ar',
                'theme'    => 'system',
                'appTheme' => $invalid,
            ])->assertStatus(422);
        }

        // الفشل لا يغيّر المخزَّن.
        $this->withToken($auth['token'])->getJson('/api/me')
            ->assertOk()
            ->assertJsonPath('user.preferences.appTheme', 'ink');
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
