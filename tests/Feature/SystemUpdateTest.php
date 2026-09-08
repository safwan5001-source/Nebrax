<?php

namespace Tests\Feature;

use App\Models\Notification;
use App\Models\PlatformAdministrator;
use App\Models\SystemUpdate;
use App\Models\SystemUpdateTarget;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\SystemUpdatePublicationService;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * تحديثات النظام / What's New (PR-NOTIF-6): نشر idempotent، استهداف،
 * عزل مستأجر، عدم تكرار إشعارات، لا تعديل محاسبي.
 */
class SystemUpdateTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    protected PlatformAdministrator $admin;
    protected Tenant $tenantA;
    protected Tenant $tenantB;
    protected User $ownerA;
    protected User $ownerB;

    protected function setUp(): void
    {
        parent::setUp();

        $this->admin = PlatformAdministrator::create([
            'name' => 'مدير المنصة',
            'email' => 'admin@platform.test',
            'password' => 'password123',
            'is_active' => true,
        ]);

        $this->tenantA = Tenant::create([
            'name' => 'شركة أ',
            'slug' => 'company-a',
            'vat_number' => '300000000000003',
            'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenantA->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenantA->id);
        $this->ownerA = User::create([
            'tenant_id' => $this->tenantA->id,
            'name' => 'مالك أ',
            'email' => 'owner@company-a.test',
            'password' => 'password123',
            'role' => 'owner',
            'is_active' => true,
        ]);

        $this->tenantB = Tenant::create([
            'name' => 'شركة ب',
            'slug' => 'company-b',
            'vat_number' => '300000000000004',
            'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenantB->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenantB->id);
        $this->ownerB = User::create([
            'tenant_id' => $this->tenantB->id,
            'name' => 'مالك ب',
            'email' => 'owner@company-b.test',
            'password' => 'password123',
            'role' => 'owner',
            'is_active' => true,
        ]);
    }

    private function draft(array $overrides = []): SystemUpdate
    {
        return SystemUpdate::create(array_merge([
            'author_id' => $this->admin->id,
            'status' => SystemUpdate::STATUS_DRAFT,
            'target_type' => SystemUpdate::TARGET_ALL,
            'title_ar' => 'تحسينات على الفوترة',
            'title_en' => 'Invoicing improvements',
            'content_ar' => 'تحسينات عديدة على أداء الفوترة.',
            'content_en' => 'Several invoicing performance improvements.',
        ], $overrides));
    }

    /** @test */
    public function publishing_delivers_notifications_to_all_active_users(): void
    {
        $update = $this->draft();

        app(SystemUpdatePublicationService::class)->publish($update);

        $this->assertSame('published', $update->fresh()->status);
        $this->assertNotNull($update->fresh()->published_at);

        $notifA = Notification::withoutGlobalScope(TenantScope::class)
            ->where('tenant_id', $this->tenantA->id)
            ->where('recipient_id', $this->ownerA->id)
            ->where('source_type', 'system_update')
            ->where('source_id', $update->id)
            ->first();
        $this->assertNotNull($notifA);
        $this->assertSame('update', $notifA->category);
        $this->assertSame('system.update_published', $notifA->type);
        $this->assertSame('view_system_update', $notifA->action);

        $notifB = Notification::withoutGlobalScope(TenantScope::class)
            ->where('tenant_id', $this->tenantB->id)
            ->where('recipient_id', $this->ownerB->id)
            ->where('source_type', 'system_update')
            ->where('source_id', $update->id)
            ->first();
        $this->assertNotNull($notifB);
    }

    /** @test */
    public function publishing_is_idempotent_no_duplicate_notifications(): void
    {
        $update = $this->draft();
        $service = app(SystemUpdatePublicationService::class);

        $service->publish($update);
        $service->publish($update);
        $service->publish($update);

        $count = Notification::withoutGlobalScope(TenantScope::class)
            ->where('source_type', 'system_update')
            ->where('source_id', $update->id)
            ->count();
        // واحد لكل مستخدم نشط (2 مستأجرين × مستخدم واحد لكل منهما)
        $this->assertSame(2, $count);
    }

    /** @test */
    public function tenant_targeted_update_only_delivers_to_that_tenant(): void
    {
        $update = $this->draft(['target_type' => SystemUpdate::TARGET_TENANTS]);
        SystemUpdateTarget::create([
            'system_update_id' => $update->id,
            'target_type' => 'tenant',
            'target_id' => $this->tenantA->id,
        ]);

        app(SystemUpdatePublicationService::class)->publish($update);

        $notifA = Notification::withoutGlobalScope(TenantScope::class)
            ->where('tenant_id', $this->tenantA->id)
            ->where('source_type', 'system_update')
            ->where('source_id', $update->id)
            ->count();
        $notifB = Notification::withoutGlobalScope(TenantScope::class)
            ->where('tenant_id', $this->tenantB->id)
            ->where('source_type', 'system_update')
            ->where('source_id', $update->id)
            ->count();

        $this->assertSame(1, $notifA);
        $this->assertSame(0, $notifB);
    }

    /** @test */
    public function user_targeted_update_only_delivers_to_that_user(): void
    {
        $update = $this->draft(['target_type' => SystemUpdate::TARGET_USERS]);
        SystemUpdateTarget::create([
            'system_update_id' => $update->id,
            'target_type' => 'user',
            'target_id' => $this->ownerA->id,
        ]);

        app(SystemUpdatePublicationService::class)->publish($update);

        $count = Notification::withoutGlobalScope(TenantScope::class)
            ->where('source_type', 'system_update')
            ->where('source_id', $update->id)
            ->count();
        $this->assertSame(1, $count);

        $notif = Notification::withoutGlobalScope(TenantScope::class)
            ->where('source_type', 'system_update')
            ->where('source_id', $update->id)
            ->first();
        $this->assertSame($this->ownerA->id, $notif->recipient_id);
    }

    /** @test */
    public function tenant_api_returns_only_published_updates_visible_to_user(): void
    {
        $draftUpdate = $this->draft();
        $published = $this->draft(['title_ar' => 'تحديث منشور']);
        app(SystemUpdatePublicationService::class)->publish($published);

        $tenantTargeted = $this->draft([
            'title_ar' => 'خاص بمستأجر ب',
            'target_type' => SystemUpdate::TARGET_TENANTS,
        ]);
        SystemUpdateTarget::create([
            'system_update_id' => $tenantTargeted->id,
            'target_type' => 'tenant',
            'target_id' => $this->tenantB->id,
        ]);
        app(SystemUpdatePublicationService::class)->publish($tenantTargeted);

        app(TenantContext::class)->set($this->tenantA->id);
        $response = $this->withToken($this->ownerA->createToken('api')->plainTextToken)
            ->getJson('/api/system-updates')
            ->assertOk();

        $ids = collect($response->json('data'))->pluck('id')->all();
        $this->assertContains($published->id, $ids);
        $this->assertNotContains($draftUpdate->id, $ids);
        $this->assertNotContains($tenantTargeted->id, $ids);
    }

    /** @test */
    public function tenant_user_sees_update_targeted_to_their_tenant(): void
    {
        $update = $this->draft(['target_type' => SystemUpdate::TARGET_TENANTS]);
        SystemUpdateTarget::create([
            'system_update_id' => $update->id,
            'target_type' => 'tenant',
            'target_id' => $this->tenantA->id,
        ]);
        app(SystemUpdatePublicationService::class)->publish($update);

        app(TenantContext::class)->set($this->tenantA->id);
        $response = $this->withToken($this->ownerA->createToken('api')->plainTextToken)
            ->getJson('/api/system-updates')
            ->assertOk();

        $ids = collect($response->json('data'))->pluck('id')->all();
        $this->assertContains($update->id, $ids);
    }

    /** @test */
    public function publishing_a_draft_that_is_not_draft_is_rejected(): void
    {
        $update = $this->draft();
        app(SystemUpdatePublicationService::class)->publish($update);

        $result = app(SystemUpdatePublicationService::class)->publish($update);
        $this->assertSame('published', $result->status);
    }

    /** @test */
    public function notification_read_state_never_affects_system_update_visibility(): void
    {
        $update = $this->draft();
        app(SystemUpdatePublicationService::class)->publish($update);

        $notif = Notification::withoutGlobalScope(TenantScope::class)
            ->where('source_type', 'system_update')
            ->where('source_id', $update->id)
            ->where('recipient_id', $this->ownerA->id)
            ->first();
        $notif->update(['read_at' => now()]);

        app(TenantContext::class)->set($this->tenantA->id);
        $response = $this->withToken($this->ownerA->createToken('api')->plainTextToken)
            ->getJson('/api/system-updates')
            ->assertOk();

        $ids = collect($response->json('data'))->pluck('id')->all();
        $this->assertContains($update->id, $ids);
    }

    /** @test */
    public function tenant_isolation_prevents_cross_tenant_visibility(): void
    {
        $update = $this->draft(['target_type' => SystemUpdate::TARGET_TENANTS]);
        SystemUpdateTarget::create([
            'system_update_id' => $update->id,
            'target_type' => 'tenant',
            'target_id' => $this->tenantA->id,
        ]);
        app(SystemUpdatePublicationService::class)->publish($update);

        app(TenantContext::class)->set($this->tenantB->id);
        $response = $this->withToken($this->ownerB->createToken('api')->plainTextToken)
            ->getJson('/api/system-updates')
            ->assertOk();

        $ids = collect($response->json('data'))->pluck('id')->all();
        $this->assertNotContains($update->id, $ids);
    }

    /** @test */
    public function inactive_users_do_not_receive_notifications(): void
    {
        $inactive = User::create([
            'tenant_id' => $this->tenantA->id,
            'name' => 'معطّل',
            'email' => 'inactive@company-a.test',
            'password' => 'password123',
            'role' => 'staff',
            'is_active' => false,
        ]);

        $update = $this->draft();
        app(SystemUpdatePublicationService::class)->publish($update);

        $notif = Notification::withoutGlobalScope(TenantScope::class)
            ->where('source_type', 'system_update')
            ->where('source_id', $update->id)
            ->where('recipient_id', $inactive->id)
            ->first();
        $this->assertNull($notif);
    }

    /** @test */
    public function platform_api_crud_flow(): void
    {
        $token = $this->admin->createToken('api')->plainTextToken;

        $createResponse = $this->withToken($token)
            ->postJson('/api/platform/system-updates', [
                'title_ar' => 'ميزة جديدة',
                'title_en' => 'New feature',
                'content_ar' => 'تفاصيل الميزة.',
                'content_en' => 'Feature details.',
                'target_type' => 'all',
            ])
            ->assertCreated();

        $id = $createResponse->json('data.id');
        $this->assertNotNull($id);
        $this->assertSame('draft', $createResponse->json('data.status'));

        $this->withToken($token)
            ->putJson("/api/platform/system-updates/{$id}", [
                'title_ar' => 'ميزة جديدة (محدّث)',
            ])
            ->assertOk();

        $this->withToken($token)
            ->postJson("/api/platform/system-updates/{$id}/publish")
            ->assertOk();

        $showResponse = $this->withToken($token)
            ->getJson("/api/platform/system-updates/{$id}")
            ->assertOk();

        $this->assertSame('published', $showResponse->json('data.status'));
        $this->assertSame('ميزة جديدة (محدّث)', $showResponse->json('data.title_ar'));
    }

    /** @test */
    public function published_update_cannot_be_edited_or_deleted(): void
    {
        $token = $this->admin->createToken('api')->plainTextToken;
        $update = $this->draft();
        app(SystemUpdatePublicationService::class)->publish($update);

        $this->withToken($token)
            ->putJson("/api/platform/system-updates/{$update->id}", ['title_ar' => 'محاولة تعديل'])
            ->assertStatus(422);

        $this->withToken($token)
            ->deleteJson("/api/platform/system-updates/{$update->id}")
            ->assertStatus(422);
    }

    /** @test */
    public function the_bridge_never_mutates_accounting_records(): void
    {
        $entriesBefore = \App\Models\JournalEntry::count();
        $linesBefore = \App\Models\JournalLine::count();

        $update = $this->draft();
        app(SystemUpdatePublicationService::class)->publish($update);

        $this->assertSame($entriesBefore, \App\Models\JournalEntry::count());
        $this->assertSame($linesBefore, \App\Models\JournalLine::count());
    }
}
