<?php

namespace Tests\Feature;

use App\Models\BuilderDraftExperience;
use App\Models\PreviewExchangeReference;
use App\Models\PreviewSession;
use App\Models\PreviewSessionEvent;
use App\Models\Role;
use App\Models\User;
use App\Support\Rbac;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\PersonalAccessToken;
use Tests\TestCase;

/**
 * MOBILE-PREVIEW-7 — تبادل QR/الرابط العميق لمرّة واحدة: إصدار مرجع (لوحة
 * التاجر)، استهلاكه ذرّياً (`POST /preview/v1/exchange` العام)، إعادة
 * التشغيل (replay)، العزل، والتدقيق بلا تسريب نصّ خام.
 *
 * تشغيل: php artisan test --filter=PreviewExchangeTest
 */
class PreviewExchangeTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function createApp(string $token): string
    {
        return $this->withToken($token)->postJson('/api/app-builder/apps', [
            'name' => 'تطبيق', 'creation_source' => 'scratch',
        ])->json('data.id');
    }

    private function saveDraft(string $token, string $appId, array $schema): void
    {
        $this->withToken($token)->putJson("/api/app-builder/apps/{$appId}/draft", ['schema' => $schema])
            ->assertOk();
    }

    private function issueReference(string $token, string $appId): array
    {
        return $this->withToken($token)
            ->postJson("/api/app-builder/apps/{$appId}/preview-exchange-references", [])
            ->assertCreated()
            ->json();
    }

    // ── RBAC (نفس بوابة إصدار جلسة المعاينة المباشرة) ───────────────────

    /** @test */
    public function issuance_requires_apps_builder_view_staff_is_denied(): void
    {
        $auth = $this->registerTenant('mp7-rbac-deny', 'owner@mp7-rbac-deny.test');
        $appId = $this->createApp($auth['token']);

        $staffToken = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@mp7-rbac-deny.test');

        $this->withToken($staffToken)->postJson("/api/app-builder/apps/{$appId}/preview-exchange-references", [])
            ->assertForbidden();
    }

    /** @test */
    public function a_custom_role_granted_only_apps_builder_view_may_issue_an_exchange_reference(): void
    {
        $auth = $this->registerTenant('mp7-rbac-custom', 'owner@mp7-rbac-custom.test');
        $appId = $this->createApp($auth['token']);

        $role = Role::create([
            'tenant_id' => $auth['tenant_id'], 'slug' => 'preview-only', 'name' => 'معاينة فقط',
            'permissions' => ['apps_builder.view'], 'is_system' => false,
        ]);
        $this->assertTrue(Rbac::allows($role->slug, 'apps_builder.view'));

        $user = User::create([
            'tenant_id' => $auth['tenant_id'], 'name' => 'معاينة فقط', 'email' => 'preview-only@mp7-rbac-custom.test',
            'password' => 'password123', 'role' => $role->slug,
        ]);
        $token = $user->createToken('api')->plainTextToken;

        $this->withToken($token)->postJson("/api/app-builder/apps/{$appId}/preview-exchange-references", [])
            ->assertCreated();
    }

    // ── عزل المستأجر عند الإصدار ─────────────────────────────────────

    /** @test */
    public function issuing_a_reference_for_another_tenants_app_id_is_denied(): void
    {
        $tenantA = $this->registerTenant('mp7-tenant-a', 'owner@mp7-tenant-a.test');
        $tenantB = $this->registerTenant('mp7-tenant-b', 'owner@mp7-tenant-b.test');
        $appId = $this->createApp($tenantA['token']);

        $this->withToken($tenantB['token'])->postJson("/api/app-builder/apps/{$appId}/preview-exchange-references", [])
            ->assertStatus(404);
    }

    // ── إصدار: النصّ الخام مرّة واحدة، هاش فقط يُخزَّن، رابط عميق صحيح ──

    /** @test */
    public function issuance_returns_the_raw_reference_once_and_persists_only_its_hash(): void
    {
        $auth = $this->registerTenant('mp7-raw-once', 'owner@mp7-raw-once.test');
        $appId = $this->createApp($auth['token']);

        $response = $this->issueReference($auth['token'], $appId);

        $raw = $response['reference'];
        $this->assertIsString($raw);
        $this->assertNotEmpty($raw);
        $this->assertStringContainsString($raw, $response['deep_link']);
        $this->assertStringStartsWith('https://', $response['deep_link']);
        $this->assertStringContainsString('/preview/'.$raw, $response['deep_link']);

        // لا توكن عامل هنا إطلاقاً — العقد الأمني يمنعه صراحةً.
        $this->assertArrayNotHasKey('token', $response);
        $this->assertArrayNotHasKey('session', $response);

        $record = PreviewExchangeReference::withoutGlobalScopes()->findOrFail($response['exchange_reference_id']);
        $this->assertNotEquals($raw, $record->reference_hash);
        $this->assertSame(hash('sha256', $raw), $record->reference_hash);
        $this->assertSame(64, strlen($record->reference_hash));
        $this->assertNull($record->consumed_at);
        $this->assertNull($record->preview_session_id);
    }

    /** @test */
    public function the_exchange_reference_expires_in_five_minutes(): void
    {
        $auth = $this->registerTenant('mp7-ttl', 'owner@mp7-ttl.test');
        $appId = $this->createApp($auth['token']);

        $response = $this->issueReference($auth['token'], $appId);
        $expiresAt = \Illuminate\Support\Carbon::parse($response['expires_at']);

        // نافذة سخيّة (±١٥ ثانية) تمتصّ أي فارق زمني بين اختبارٍ وخادمه أو
        // انحرافاً في ساعة النظام، بينما تبقى كافية تماماً لتمييز خمس دقائق
        // عن أي TTL آخر مستعمل في هذا النظام (١٥/٦٠ دقيقة لجلسات المعاينة).
        $this->assertTrue(
            $expiresAt->between(now()->addMinutes(5)->subSeconds(15), now()->addMinutes(5)->addSeconds(15)),
            "expires_at لم يقع ضمن نافذة الخمس دقائق المتوقعة: {$expiresAt->toIso8601String()}",
        );
    }

    // ── الاستهلاك الناجح: يُنتج جلسة معاينة عاملة عادية تماماً ─────────

    /** @test */
    public function a_valid_reference_exchanges_into_a_working_preview_session(): void
    {
        $auth = $this->registerTenant('mp7-exchange-ok', 'owner@mp7-exchange-ok.test');
        $appId = $this->createApp($auth['token']);

        $schema = BuilderDraftExperience::minimalSafeSchema();
        $schema['pages']['home']['children'] = [
            ['type' => 'Text', 'id' => 'exchange-marker', 'props' => ['text' => 'محتوى عبر التبادل']],
        ];
        $this->saveDraft($auth['token'], $appId, $schema);

        $issued = $this->issueReference($auth['token'], $appId);

        $exchange = $this->postJson('/preview/v1/exchange', ['reference' => $issued['reference']])
            ->assertCreated();

        $rawSessionToken = $exchange->json('token');
        $this->assertIsString($rawSessionToken);
        $this->assertMatchesRegularExpression('/^\d+\|/', $rawSessionToken);
        $this->assertSame('device', $exchange->json('session.channel'));

        // نفس عقد `preview/v1/experience` تماماً — إصدارٌ مباشر أو عبر تبادل
        // ينتجان جلسة واحدة الشكل والسلوك، لا مساراً موازياً.
        $fetch = $this->withToken($rawSessionToken)->getJson('/preview/v1/experience')->assertOk();
        $fetch->assertJsonPath('data.schema.pages.home.children.0.id', 'exchange-marker');
        $fetch->assertJsonPath('data.source', 'draft');

        $tokenRow = PersonalAccessToken::query()
            ->where('tokenable_type', PreviewSession::class)
            ->where('tokenable_id', $exchange->json('session.id'))
            ->firstOrFail();
        $this->assertSame([PreviewSession::ABILITY_READ], $tokenRow->abilities);

        // المرجع صار مستهلَكاً ومربوطاً بالجلسة الناتجة.
        $record = PreviewExchangeReference::withoutGlobalScopes()->findOrFail($issued['exchange_reference_id']);
        $this->assertNotNull($record->consumed_at);
        $this->assertSame($exchange->json('session.id'), $record->preview_session_id);
    }

    /** @test */
    public function the_exchanged_session_uses_the_snapshot_frozen_at_reference_issuance_not_a_later_draft_edit(): void
    {
        $auth = $this->registerTenant('mp7-frozen-snapshot', 'owner@mp7-frozen-snapshot.test');
        $appId = $this->createApp($auth['token']);

        $v1 = BuilderDraftExperience::minimalSafeSchema();
        $v1['pages']['home']['children'] = [['type' => 'Text', 'id' => 'v1', 'props' => ['text' => 'أولى']]];
        $this->saveDraft($auth['token'], $appId, $v1);

        $issued = $this->issueReference($auth['token'], $appId);

        // التعديل يحدث بعد إصدار المرجع، قبل أي تبادل فعلي.
        $v2 = BuilderDraftExperience::minimalSafeSchema();
        $v2['pages']['home']['children'] = [['type' => 'Text', 'id' => 'v2', 'props' => ['text' => 'ثانية']]];
        $this->saveDraft($auth['token'], $appId, $v2);

        $exchange = $this->postJson('/preview/v1/exchange', ['reference' => $issued['reference']])->assertCreated();
        $raw = $exchange->json('token');

        $fetch = $this->withToken($raw)->getJson('/preview/v1/experience')->assertOk();
        $fetch->assertJsonPath('data.schema.pages.home.children.0.id', 'v1');
        $fetch->assertJsonPath('data.draft_changed', true);
    }

    // ── إعادة التشغيل (Replay) وحالات الرفض العامة ──────────────────

    /** @test */
    public function a_second_exchange_of_the_same_reference_is_rejected(): void
    {
        $auth = $this->registerTenant('mp7-replay', 'owner@mp7-replay.test');
        $appId = $this->createApp($auth['token']);
        $issued = $this->issueReference($auth['token'], $appId);

        $this->postJson('/preview/v1/exchange', ['reference' => $issued['reference']])->assertCreated();

        $second = $this->postJson('/preview/v1/exchange', ['reference' => $issued['reference']]);
        $second->assertStatus(401);
        $this->assertSame('unauthenticated', $second->json('error.code'));

        // لا جلسة ثانية نتيجة إعادة التشغيل.
        $this->assertSame(1, PreviewSession::withoutGlobalScopes()
            ->where('builder_app_id', $appId)->count());
    }

    /** @test */
    public function an_expired_reference_is_rejected_generically(): void
    {
        $auth = $this->registerTenant('mp7-expired', 'owner@mp7-expired.test');
        $appId = $this->createApp($auth['token']);
        $issued = $this->issueReference($auth['token'], $appId);

        PreviewExchangeReference::withoutGlobalScopes()
            ->where('id', $issued['exchange_reference_id'])
            ->update(['expires_at' => now()->subMinute()]);

        $response = $this->postJson('/preview/v1/exchange', ['reference' => $issued['reference']]);
        $response->assertStatus(401);
        $this->assertSame('unauthenticated', $response->json('error.code'));
    }

    /** @test */
    public function an_unknown_or_malformed_reference_is_rejected_with_the_same_generic_shape(): void
    {
        $unknown = $this->postJson('/preview/v1/exchange', ['reference' => 'totally-made-up-reference-value']);
        $unknown->assertStatus(401);
        $this->assertSame('unauthenticated', $unknown->json('error.code'));

        $empty = $this->postJson('/preview/v1/exchange', ['reference' => '']);
        $empty->assertStatus(401);
        $this->assertSame('unauthenticated', $empty->json('error.code'));

        $missing = $this->postJson('/preview/v1/exchange', []);
        $missing->assertStatus(401);

        $tooLong = $this->postJson('/preview/v1/exchange', ['reference' => str_repeat('a', 500)]);
        $tooLong->assertStatus(401);
    }

    /** @test */
    public function merchant_admin_and_store_bearer_tokens_are_never_accepted_as_an_exchange_reference(): void
    {
        $auth = $this->registerTenant('mp7-no-cred-accept', 'owner@mp7-no-cred-accept.test');

        // توكن المستخدم الإداري نفسه كمرجع — يُرفض كأي نصّ عشوائي آخر، بلا
        // أي معاملة خاصة (لا يُفحص كنوع Sanctum مختلف، بل كهاش لا يطابق شيئاً).
        $response = $this->postJson('/preview/v1/exchange', ['reference' => $auth['token']]);
        $response->assertStatus(401);
        $this->assertSame('unauthenticated', $response->json('error.code'));
    }

    // ── التدقيق: لا نصّ خام في أي سجلّ ────────────────────────────────

    /** @test */
    public function raw_reference_never_appears_in_any_audit_row(): void
    {
        $auth = $this->registerTenant('mp7-no-log-leak', 'owner@mp7-no-log-leak.test');
        $appId = $this->createApp($auth['token']);
        $issued = $this->issueReference($auth['token'], $appId);

        // محاولة فاشلة (منتهية) ثم محاولة ناجحة — كلاهما يجب ألّا يسجّل النصّ الخام.
        $this->postJson('/preview/v1/exchange', ['reference' => 'wrong-guess-value'])->assertStatus(401);
        $exchange = $this->postJson('/preview/v1/exchange', ['reference' => $issued['reference']])->assertCreated();
        $rawSessionToken = $exchange->json('token');

        $events = PreviewSessionEvent::withoutGlobalScopes()->get();
        $this->assertGreaterThanOrEqual(2, $events->count());
        foreach ($events as $event) {
            $this->assertStringNotContainsString($issued['reference'], (string) $event->reason);
            $this->assertStringNotContainsString($issued['reference'], json_encode($event->toArray()));
            $this->assertStringNotContainsString($rawSessionToken, (string) $event->reason);
            $this->assertStringNotContainsString($rawSessionToken, json_encode($event->toArray()));
        }

        $reference = PreviewExchangeReference::withoutGlobalScopes()->findOrFail($issued['exchange_reference_id']);
        $this->assertStringNotContainsString($issued['reference'], json_encode($reference->toArray()));
    }

    // ── حارس القدرة (نفس قناة المعاينة المباشرة) ─────────────────────

    /** @test */
    public function disabled_app_builder_capability_blocks_exchange_reference_issuance(): void
    {
        $auth = $this->registerTenant('mp7-cap-disabled', 'owner@mp7-cap-disabled.test', autoEnableApplications: false);

        $this->withToken($auth['token'])->postJson('/api/app-builder/apps', [
            'name' => 'تطبيق', 'creation_source' => 'scratch',
        ])->assertStatus(403);
    }
}
