<?php

namespace Tests\Feature;

use App\Models\BuilderApp;
use App\Models\BuilderDraftExperience;
use App\Models\BuilderLivePointer;
use App\Models\BuilderLivePointerEvent;
use App\Models\BuilderPublishedExperienceVersion;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

/**
 * AD-06 — هجرة المؤشرات الحيّة: Dry-run افتراضي بلا أي كتابة، `--apply` محجوب ببوابة المؤشر، idempotent، معزول بالمستأجر.
 *
 * تشغيل: php artisan test --filter=BuilderLivePointerBackfillTest
 */
class BuilderLivePointerBackfillTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @return array{tenant_id: string, token: string, mobile: string|null} */
    private function store(string $slug, bool $withChannel = true): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $mobile = null;
        if ($withChannel) {
            app(TenantContext::class)->set($auth['tenant_id']);
            SalesChannel::create(['slug' => 'mobile', 'name' => 'تطبيق الجوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true]);
            app(TenantContext::class)->forget();
            $client = app(ApiClientKeyService::class)->createClient(Tenant::find($auth['tenant_id']), 'mobile-app', true);
            $mobile = app(ApiClientKeyService::class)->issueKey($client, 'default', [])->plainTextToken;
        }

        return $auth + ['mobile' => $mobile];
    }

    /** مستأجر مباشر بلا تسجيل HTTP (حدّ معدّل التسجيل 429 في اختبار متعدد المستأجرين). */
    private function bareTenant(string $slug, bool $withChannel = true): string
    {
        $tenant = Tenant::create([
            'name' => "شركة {$slug}", 'slug' => $slug, 'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        if ($withChannel) {
            app(TenantContext::class)->set($tenant->id);
            SalesChannel::create(['slug' => 'mobile', 'name' => 'تطبيق الجوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true]);
            app(TenantContext::class)->forget();
        }

        return $tenant->id;
    }

    private function publish(string $tenantId, string $marker, int $version = 1, ?BuilderApp $app = null, ?array $schema = null, ?\DateTimeInterface $at = null): BuilderPublishedExperienceVersion
    {
        app(TenantContext::class)->set($tenantId);
        $app ??= BuilderApp::create(['name' => 'تطبيقي', 'creation_source' => BuilderApp::SOURCE_SCRATCH]);
        $schema ??= array_merge(BuilderDraftExperience::minimalSafeSchema(), ['theme' => ['tokens' => ['marker' => $marker]]]);
        $row = BuilderPublishedExperienceVersion::create([
            'builder_app_id' => $app->id, 'version' => $version, 'schema' => $schema,
            'schema_version' => (string) $schema['schemaVersion'], 'published_at' => $at ?? now()->addSeconds($version),
        ]);
        app(TenantContext::class)->forget();

        return $row;
    }

    /** @return array{0: int, 1: list<array<string, mixed>>, 2: array<string, mixed>} */
    private function backfill(array $options = []): array
    {
        $code = Artisan::call('app-builder:backfill-live-pointers', $options);
        $lines = array_values(array_filter(array_map('trim', explode("\n", Artisan::output()))));
        $summary = json_decode((string) array_pop($lines), true);
        $rows = array_map(fn ($l) => json_decode($l, true), $lines);

        return [$code, $rows, $summary];
    }

    private function pointerCount(): int
    {
        return BuilderLivePointer::withoutGlobalScopes()->count();
    }

    /** @test */
    public function the_default_is_a_dry_run_that_writes_nothing_and_reports_what_it_would_create(): void
    {
        $a = $this->store('bf-dry');
        $v = $this->publish($a['tenant_id'], 'one');

        [$code, $rows, $summary] = $this->backfill(['--tenant' => $a['tenant_id']]);

        $this->assertSame(0, $code);
        $this->assertSame('dry-run', $summary['mode']);
        $this->assertSame(['would_create' => 1], $summary['summary']);
        $this->assertSame($v->id, $rows[0]['version_id']);
        $this->assertSame($v->builder_app_id, $rows[0]['app_id']);
        $this->assertSame(0, $this->pointerCount());
        $this->assertSame(0, BuilderLivePointerEvent::withoutGlobalScopes()->count());
    }

    /** @test */
    public function apply_is_refused_while_the_pointer_gate_is_closed_and_nothing_is_written(): void
    {
        $a = $this->store('bf-closed');
        $this->publish($a['tenant_id'], 'one');

        [$code] = $this->backfill(['--apply' => true]);

        $this->assertSame(2, $code);
        $this->assertSame(0, $this->pointerCount());
    }

    /** @test */
    public function apply_with_the_gate_open_pins_the_current_legacy_selection_and_is_idempotent(): void
    {
        config(['app_builder.live_pointer_enabled' => true]);
        $a = $this->store('bf-apply');
        $this->publish($a['tenant_id'], 'one', 1);
        $latest = $this->publish($a['tenant_id'], 'two', 2, BuilderApp::withoutGlobalScopes()->where('tenant_id', $a['tenant_id'])->first());

        [$code, , $summary] = $this->backfill(['--apply' => true]);
        $this->assertSame(0, $code);
        $this->assertSame(1, $summary['summary']['created'] ?? 0);

        $pointer = BuilderLivePointer::withoutGlobalScopes()->firstOrFail();
        $this->assertSame($latest->id, $pointer->live_version_id);
        $event = BuilderLivePointerEvent::withoutGlobalScopes()->firstOrFail();
        $this->assertSame('promote', $event->action);
        $this->assertStringContainsString('backfill', (string) $event->reason);
        $this->assertNull($event->actor_id);

        // الجهاز يخدَم من المؤشر نفسه، ويطابق ما كان يخدمه السلوك القديم.
        $this->getJson('/commerce/v1/experience', ['Authorization' => 'Bearer '.$a['mobile']])
            ->assertOk()->assertJsonPath('data.schema.theme.tokens.marker', 'two');

        // تشغيل ثانٍ: لا شيء جديد.
        [, $rows2, $summary2] = $this->backfill(['--apply' => true, '--tenant' => $a['tenant_id']]);
        $this->assertSame(['already_pointed' => 1], $summary2['summary']);
        $this->assertSame('already_pointed', $rows2[0]['status']);
        $this->assertSame(1, $this->pointerCount());
        $this->assertSame(1, BuilderLivePointerEvent::withoutGlobalScopes()->count());
    }

    /** @test */
    public function every_status_is_reported_honestly(): void
    {
        $noChannel = ['tenant_id' => $this->bareTenant('bf-nochan', withChannel: false)];
        $this->publish($noChannel['tenant_id'], 'x');
        $empty = ['tenant_id' => $this->bareTenant('bf-empty')];
        $future = ['tenant_id' => $this->bareTenant('bf-future')];
        $this->publish($future['tenant_id'], 'f', 1, null, array_merge(BuilderDraftExperience::minimalSafeSchema(), ['schemaVersion' => '9.0.0']));
        $archived = ['tenant_id' => $this->bareTenant('bf-archived')];
        $arch = $this->publish($archived['tenant_id'], 'a');
        BuilderApp::withoutGlobalScopes()->whereKey($arch->builder_app_id)->update(['archived_at' => now()]);

        [, $rows] = $this->backfill();
        $status = collect($rows)->pluck('status', 'tenant_id');

        $this->assertSame('no_mobile_channel', $status[$noChannel['tenant_id']]);
        $this->assertSame('no_published_versions', $status[$empty['tenant_id']]);
        $this->assertSame('not_renderable', $status[$future['tenant_id']]);
        $this->assertSame('no_published_versions', $status[$archived['tenant_id']], 'التطبيق المؤرشف لا يُرحَّل');
        $this->assertSame(0, $this->pointerCount());
    }

    /** @test */
    public function tenants_are_isolated_and_a_multi_app_tenant_is_flagged(): void
    {
        $a = $this->store('bf-iso-a');
        $b = $this->store('bf-iso-b');
        $aOne = $this->publish($a['tenant_id'], 'a1');
        $this->publish($a['tenant_id'], 'a2', 1, null, null, now()->addMinutes(5)); // تطبيق ثانٍ أحدث
        $bOne = $this->publish($b['tenant_id'], 'b1');

        [, $rows] = $this->backfill();
        $byTenant = collect($rows)->keyBy('tenant_id');

        $this->assertNotSame($aOne->id, $byTenant[$a['tenant_id']]['version_id'], 'الأحدث عبر تطبيقات المستأجر نفسه');
        $this->assertContains('multiple_apps', $byTenant[$a['tenant_id']]['notes']);
        $this->assertSame($bOne->id, $byTenant[$b['tenant_id']]['version_id']);
        $this->assertSame($bOne->builder_app_id, $byTenant[$b['tenant_id']]['app_id']);
        $this->assertEmpty($byTenant[$b['tenant_id']]['notes']);

        [, $onlyB] = $this->backfill(['--tenant' => $b['tenant_id']]);
        $this->assertCount(1, $onlyB);
    }

    /** @test */
    public function the_backfill_write_is_create_only_so_it_never_undoes_a_promotion_made_after_planning(): void
    {
        config(['app_builder.live_pointer_enabled' => true]);
        $a = $this->store('bf-race');
        $first = $this->publish($a['tenant_id'], 'planned', 1);
        $app = BuilderApp::withoutGlobalScopes()->where('tenant_id', $a['tenant_id'])->first();
        $chosen = $this->publish($a['tenant_id'], 'admin-choice', 2, $app);

        // المعاينة/التخطيط قالت would_create لـ$chosen (الأحدث)... ثم رقّى مدير نسخة أخرى قبل التنفيذ:
        app(TenantContext::class)->set($a['tenant_id']);
        $service = app(\App\Services\AppBuilder\BuilderLivePointerService::class);
        $service->promote($first, null, 'admin promotion');
        $created = $service->createIfAbsent($chosen, null, 'backfill');
        app(TenantContext::class)->forget();

        $this->assertFalse($created, 'يتخطّى ولا يحدّث');
        $this->assertSame($first->id, BuilderLivePointer::withoutGlobalScopes()->firstOrFail()->live_version_id);
        $this->assertSame(1, BuilderLivePointerEvent::withoutGlobalScopes()->count(), 'لا حدث ثانٍ');
    }

    /** @test */
    public function an_invalid_tenant_option_is_rejected(): void
    {
        [$code] = $this->backfill(['--tenant' => 'not-a-uuid']);
        $this->assertSame(2, $code);
    }
}
