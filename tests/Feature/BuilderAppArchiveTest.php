<?php

namespace Tests\Feature;

use App\Models\BuilderApp;
use App\Models\BuilderDraftExperience;
use App\Models\BuilderPublishedExperienceVersion;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * AD-06 / S05d (DRF-08) — أرشفة التطبيق (soft): مخفي، لا يُخدَم ولا يُنشر ولا يُحرَّر، ولا يُؤرشف الحيّ، ولا يُحتسب في الحدّ.
 *
 * تشغيل: php artisan test --filter=BuilderAppArchiveTest
 */
class BuilderAppArchiveTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @return array{token: string, tenant_id: string, mobile: string} */
    private function store(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        app(TenantContext::class)->set($auth['tenant_id']);
        SalesChannel::create(['slug' => 'mobile', 'name' => 'تطبيق الجوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true]);
        app(TenantContext::class)->forget();
        $client = app(ApiClientKeyService::class)->createClient(Tenant::find($auth['tenant_id']), 'mobile-app', true);

        return $auth + ['mobile' => app(ApiClientKeyService::class)->issueKey($client, 'default', [])->plainTextToken];
    }

    private function createApp(array $s, string $name = 'تطبيقي'): string
    {
        return $this->withToken($s['token'])->postJson('/api/app-builder/apps', ['name' => $name, 'creation_source' => 'scratch'])->assertCreated()->json('data.id');
    }

    private function version(string $tenantId, string $appId, int $version, string $marker): BuilderPublishedExperienceVersion
    {
        app(TenantContext::class)->set($tenantId);
        $schema = array_merge(BuilderDraftExperience::minimalSafeSchema(), ['theme' => ['tokens' => ['marker' => $marker]]]);
        $row = BuilderPublishedExperienceVersion::create([
            'builder_app_id' => $appId, 'version' => $version, 'schema' => $schema,
            'schema_version' => (string) $schema['schemaVersion'], 'published_at' => now()->addSeconds($version),
        ]);
        app(TenantContext::class)->forget();

        return $row;
    }

    private function archive(array $s, string $appId)
    {
        return $this->withToken($s['token'])->postJson("/api/app-builder/apps/{$appId}/archive");
    }

    /** @test */
    public function archiving_hides_the_app_from_the_default_list_and_unarchiving_restores_it(): void
    {
        $s = $this->store('ar-list');
        $id = $this->createApp($s);

        $this->archive($s, $id)->assertOk()->assertJsonPath('data.id', $id);
        $this->assertNotNull($this->archive($s, $id)->assertOk()->json('data.archived_at')); // idempotent

        $this->assertSame([], $this->withToken($s['token'])->getJson('/api/app-builder/apps')->json('data'));
        $this->assertCount(1, $this->withToken($s['token'])->getJson('/api/app-builder/apps?archived=1')->json('data'));
        $this->withToken($s['token'])->getJson("/api/app-builder/apps/{$id}")->assertOk(); // القراءة المباشرة مسموحة

        $this->withToken($s['token'])->postJson("/api/app-builder/apps/{$id}/unarchive")->assertOk()->assertJsonPath('data.archived_at', null);
        $this->assertCount(1, $this->withToken($s['token'])->getJson('/api/app-builder/apps')->json('data'));
    }

    /** @test */
    public function an_archived_app_cannot_be_edited_published_or_previewed_but_remains_readable(): void
    {
        $s = $this->store('ar-block');
        $id = $this->createApp($s);
        $this->archive($s, $id)->assertOk();

        $this->withToken($s['token'])->putJson("/api/app-builder/apps/{$id}/draft", $this->builderDraftBody($id, BuilderDraftExperience::minimalSafeSchema()))->assertStatus(422);
        $this->withToken($s['token'])->postJson("/api/app-builder/apps/{$id}/versions", [])->assertStatus(422);
        $this->withToken($s['token'])->postJson("/api/app-builder/apps/{$id}/preview-sessions")->assertStatus(422);

        $this->withToken($s['token'])->getJson("/api/app-builder/apps/{$id}/draft")->assertOk();
        $this->withToken($s['token'])->getJson("/api/app-builder/apps/{$id}/versions")->assertOk();

        // بعد إعادة التفعيل يعود التحرير والنشر.
        $this->withToken($s['token'])->postJson("/api/app-builder/apps/{$id}/unarchive")->assertOk();
        $this->withToken($s['token'])->postJson("/api/app-builder/apps/{$id}/versions", [])->assertCreated();
    }

    /** @test */
    public function the_qr_preview_flow_is_blocked_for_archived_apps_including_references_issued_before_archival(): void
    {
        $s = $this->store('ar-qr');
        $id = $this->createApp($s);

        $issued = $this->withToken($s['token'])->postJson("/api/app-builder/apps/{$id}/preview-exchange-references")->assertCreated()->json('reference');
        $this->archive($s, $id)->assertOk();

        // مرجع صدر قبل الأرشفة لا يتحوّل إلى جلسة جهاز.
        $this->postJson('/preview/v1/exchange', ['reference' => $issued])->assertStatus(401);
        // ولا يُصدَر مرجع جديد.
        $this->withToken($s['token'])->postJson("/api/app-builder/apps/{$id}/preview-exchange-references")->assertStatus(422);

        // بعد إعادة التفعيل يعود إصدار المراجع.
        $this->withToken($s['token'])->postJson("/api/app-builder/apps/{$id}/unarchive")->assertOk();
        $this->withToken($s['token'])->postJson("/api/app-builder/apps/{$id}/preview-exchange-references")->assertCreated();
    }

    /** @test */
    public function an_archived_apps_versions_are_never_served_and_an_older_active_app_is_served_instead(): void
    {
        $s = $this->store('ar-serve');
        $old = $this->createApp($s, 'قديم');
        $new = $this->createApp($s, 'جديد');
        $this->version($s['tenant_id'], $old, 1, 'old-active');
        $this->version($s['tenant_id'], $new, 2, 'new-archived'); // نشر أحدث زمنياً

        $served = fn () => $this->getJson('/commerce/v1/experience', ['Authorization' => 'Bearer '.$s['mobile']]);
        $served()->assertOk()->assertJsonPath('data.schema.theme.tokens.marker', 'new-archived');

        $this->archive($s, $new)->assertOk();
        $served()->assertOk()->assertJsonPath('data.schema.theme.tokens.marker', 'old-active');

        $this->archive($s, $old)->assertOk();
        $served()->assertNotFound();
    }

    /** @test */
    public function the_live_app_cannot_be_archived_until_the_pointer_moves(): void
    {
        config(['app_builder.live_pointer_enabled' => true]);
        $s = $this->store('ar-live');
        $a = $this->createApp($s, 'أ');
        $b = $this->createApp($s, 'ب');
        $this->version($s['tenant_id'], $a, 1, 'a');
        $this->version($s['tenant_id'], $b, 1, 'b');

        $this->withToken($s['token'])->postJson("/api/app-builder/apps/{$a}/versions/1/promote")->assertOk();
        $this->archive($s, $a)->assertStatus(409)->assertJsonPath('reason', 'app_is_live');
        $this->assertNull(BuilderApp::withoutGlobalScopes()->find($a)->archived_at);

        $this->withToken($s['token'])->postJson("/api/app-builder/apps/{$b}/versions/1/promote")->assertOk();
        $this->archive($s, $a)->assertOk();

        // ولا يمكن جعل نسخة من المؤرشف حيّة.
        $this->withToken($s['token'])->postJson("/api/app-builder/apps/{$a}/versions/1/promote")->assertStatus(422);
    }

    /** @test */
    public function archived_apps_do_not_count_against_the_app_limit_and_unarchive_respects_it(): void
    {
        $s = $this->store('ar-quota');
        Tenant::findOrFail($s['tenant_id'])->forceFill(['plan_limits' => ['builder_apps' => 1]])->save();

        $first = $this->createApp($s);
        $this->withToken($s['token'])->postJson('/api/app-builder/apps', ['name' => 'ثانٍ', 'creation_source' => 'scratch'])->assertStatus(422);

        $this->archive($s, $first)->assertOk();
        $second = $this->createApp($s, 'ثانٍ'); // الحيّز فُرِّغ

        $this->withToken($s['token'])->postJson("/api/app-builder/apps/{$first}/unarchive")->assertStatus(422);
        $this->assertNotNull(BuilderApp::withoutGlobalScopes()->find($first)->archived_at);
        $this->assertNotNull($second);
    }

    /** @test */
    public function archive_requires_manage_and_never_crosses_tenants(): void
    {
        $a = $this->store('ar-iso-a');
        $b = $this->store('ar-iso-b');
        $id = $this->createApp($a);

        $this->archive($b, $id)->assertNotFound();
        $staff = $this->tokenForRole($a['tenant_id'], 'staff', 'staff@ar-iso-a.test');
        $this->withToken($staff)->postJson("/api/app-builder/apps/{$id}/archive")->assertForbidden();
        $this->withToken($staff)->postJson("/api/app-builder/apps/{$id}/unarchive")->assertForbidden();
        $this->assertNull(BuilderApp::withoutGlobalScopes()->find($id)->archived_at);
    }
}
