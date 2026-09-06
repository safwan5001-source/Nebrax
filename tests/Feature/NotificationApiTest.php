<?php

namespace Tests\Feature;

use App\Models\Notification;
use App\Models\User;
use App\Services\NotificationService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

/**
 * أساس الإشعارات (PR-NOTIF-1): عزل المستأجر/المستلم، دورة القراءة، والتفرّد.
 * انظر docs/plans/alerts-notifications/AWJ_ALERTS_NOTIFICATIONS_MASTER_PLAN.md §5.1.
 */
class NotificationApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function deliver(string $tenantId, string $recipientId, array $overrides = []): Notification
    {
        app(TenantContext::class)->set($tenantId);

        return app(NotificationService::class)->deliver(array_merge([
            'tenant_id' => $tenantId,
            'recipient_id' => $recipientId,
            'category' => 'alert',
            'type' => 'test.notification',
            'severity' => 'warning',
            'title' => 'عنوان تجريبي',
            'message' => 'نص تجريبي',
            'dedupe_key' => 'test:' . Str::uuid(),
        ], $overrides));
    }

    /** @test */
    public function tenant_a_cannot_list_count_or_mark_tenant_b_notifications(): void
    {
        $a = $this->registerTenant('alpha', 'a@alpha.test');
        $b = $this->registerTenant('beta', 'b@beta.test');
        $userB = User::where('tenant_id', $b['tenant_id'])->first();

        $notifB = $this->deliver($b['tenant_id'], $userB->id);

        $this->withToken($a['token'])->getJson('/api/notifications')
            ->assertOk()
            ->assertJsonCount(0, 'data');

        $this->withToken($a['token'])->getJson('/api/notifications/unread-count')
            ->assertOk()
            ->assertJsonPath('data.count', 0);

        $this->withToken($a['token'])->postJson("/api/notifications/{$notifB->id}/read")
            ->assertNotFound();
    }

    /** @test */
    public function user_a_cannot_read_or_mark_user_b_notification_in_same_tenant(): void
    {
        $tenant = $this->registerTenant('acme1', 'owner1@acme.test');
        $ownerId = User::where('tenant_id', $tenant['tenant_id'])->first()->id;
        $staffToken = $this->tokenForRole($tenant['tenant_id'], 'staff', 'staff1@acme.test');

        $notifForOwner = $this->deliver($tenant['tenant_id'], $ownerId);

        $this->withToken($staffToken)->postJson("/api/notifications/{$notifForOwner->id}/read")
            ->assertNotFound();

        $this->withToken($staffToken)->getJson('/api/notifications')
            ->assertOk()
            ->assertJsonCount(0, 'data');

        $this->assertNull($notifForOwner->fresh()->read_at);
    }

    /** @test */
    public function unread_count_and_lists_are_recipient_specific(): void
    {
        $tenant = $this->registerTenant('acme2', 'owner2@acme.test');
        $ownerId = User::where('tenant_id', $tenant['tenant_id'])->first()->id;
        $staffToken = $this->tokenForRole($tenant['tenant_id'], 'staff', 'staff2@acme.test');
        $staffId = User::where('email', 'staff2@acme.test')->first()->id;

        $this->deliver($tenant['tenant_id'], $ownerId);
        $this->deliver($tenant['tenant_id'], $ownerId);
        $this->deliver($tenant['tenant_id'], $staffId);

        $this->withToken($tenant['token'])->getJson('/api/notifications/unread-count')
            ->assertOk()->assertJsonPath('data.count', 2);

        $this->withToken($staffToken)->getJson('/api/notifications/unread-count')
            ->assertOk()->assertJsonPath('data.count', 1);
    }

    /** @test */
    public function mark_one_and_mark_all_only_affect_authorized_recipient_rows(): void
    {
        $tenant = $this->registerTenant('acme3', 'owner3@acme.test');
        $ownerId = User::where('tenant_id', $tenant['tenant_id'])->first()->id;
        $staffToken = $this->tokenForRole($tenant['tenant_id'], 'staff', 'staff3@acme.test');
        $staffId = User::where('email', 'staff3@acme.test')->first()->id;

        $n1 = $this->deliver($tenant['tenant_id'], $ownerId);
        $n2 = $this->deliver($tenant['tenant_id'], $ownerId);
        $nStaff = $this->deliver($tenant['tenant_id'], $staffId);

        $this->withToken($tenant['token'])->postJson("/api/notifications/{$n1->id}/read")->assertOk();
        $this->assertNotNull($n1->fresh()->read_at);
        $this->assertNull($n2->fresh()->read_at);
        $this->assertNull($nStaff->fresh()->read_at);

        $this->withToken($tenant['token'])->postJson('/api/notifications/mark-all-read')
            ->assertOk()
            ->assertJsonPath('data.updated', 1);

        $this->assertNotNull($n2->fresh()->read_at);
        $this->assertNull($nStaff->fresh()->read_at);
    }

    /** @test */
    public function duplicate_delivery_with_same_dedupe_key_does_not_create_duplicate_rows(): void
    {
        $tenant = $this->registerTenant('acme4', 'owner4@acme.test');
        $ownerId = User::where('tenant_id', $tenant['tenant_id'])->first()->id;

        $first = $this->deliver($tenant['tenant_id'], $ownerId, ['dedupe_key' => 'fixed-key']);
        $second = $this->deliver($tenant['tenant_id'], $ownerId, ['dedupe_key' => 'fixed-key']);

        $this->assertSame($first->id, $second->id);
        $this->assertSame(
            1,
            Notification::query()->where('recipient_id', $ownerId)->where('dedupe_key', 'fixed-key')->count()
        );
    }

    /** @test */
    public function cross_tenant_recipient_is_rejected(): void
    {
        $a = $this->registerTenant('alpha2', 'a2@alpha.test');
        $b = $this->registerTenant('beta2', 'b2@beta.test');
        $userB = User::where('tenant_id', $b['tenant_id'])->first();

        $this->expectException(RuntimeException::class);
        $this->deliver($a['tenant_id'], $userB->id);
    }

    /** @test */
    public function invalid_category_severity_and_type_are_rejected(): void
    {
        $tenant = $this->registerTenant('acme5', 'owner5@acme.test');
        $ownerId = User::where('tenant_id', $tenant['tenant_id'])->first()->id;

        $cases = [
            ['category' => 'not_a_category'],
            ['severity' => 'nonsense'],
            ['type' => 'no-dots-here'],
            ['title' => ''],
            ['message' => ''],
            ['dedupe_key' => ''],
        ];

        foreach ($cases as $overrides) {
            try {
                $this->deliver($tenant['tenant_id'], $ownerId, $overrides);
                $this->fail('Expected RuntimeException for invalid payload: ' . json_encode($overrides));
            } catch (RuntimeException $e) {
                $this->assertTrue(true);
            }
        }
    }

    /** @test */
    public function unregistered_action_is_rejected(): void
    {
        $tenant = $this->registerTenant('acme6', 'owner6@acme.test');
        $ownerId = User::where('tenant_id', $tenant['tenant_id'])->first()->id;

        $this->expectException(RuntimeException::class);
        $this->deliver($tenant['tenant_id'], $ownerId, [
            'action' => 'not_a_real_action',
            'source_type' => 'product',
            'source_id' => (string) Str::uuid(),
        ]);
    }

    /** @test */
    public function a_registered_action_still_requires_its_exact_matching_source_type(): void
    {
        // 'view_product' هو المدخل الوحيد المسجَّل فعلياً (PR-NOTIF-3)؛ يثبت هذا
        // أن التسجيل لا يكفي وحده — النوع المصاحب يجب أن يطابق العقد أيضاً.
        $tenant = $this->registerTenant('acme6b', 'owner6b@acme.test');
        $ownerId = User::where('tenant_id', $tenant['tenant_id'])->first()->id;

        $this->expectException(RuntimeException::class);
        $this->deliver($tenant['tenant_id'], $ownerId, [
            'action' => 'view_product',
            'source_type' => 'invoice',
            'source_id' => (string) Str::uuid(),
        ]);
    }

    /** @test */
    public function source_type_without_source_id_is_rejected(): void
    {
        $tenant = $this->registerTenant('acme7', 'owner7@acme.test');
        $ownerId = User::where('tenant_id', $tenant['tenant_id'])->first()->id;

        $this->expectException(RuntimeException::class);
        $this->deliver($tenant['tenant_id'], $ownerId, ['source_type' => 'product']);
    }

    /** @test */
    public function sensitive_metadata_keys_are_rejected(): void
    {
        $tenant = $this->registerTenant('acme8', 'owner8@acme.test');
        $ownerId = User::where('tenant_id', $tenant['tenant_id'])->first()->id;

        foreach (['cost', 'purchase_price', 'avg_cost', 'token', 'secret', 'api_key', 'password', 'source_url'] as $key) {
            try {
                $this->deliver($tenant['tenant_id'], $ownerId, ['data' => [$key => 'x']]);
                $this->fail("Expected rejection for metadata key: {$key}");
            } catch (RuntimeException $e) {
                $this->assertTrue(true);
            }
        }
    }

    /** @test */
    public function metadata_url_values_are_rejected_even_under_a_safe_key(): void
    {
        $tenant = $this->registerTenant('acme9', 'owner9@acme.test');
        $ownerId = User::where('tenant_id', $tenant['tenant_id'])->first()->id;

        $this->expectException(RuntimeException::class);
        $this->deliver($tenant['tenant_id'], $ownerId, ['data' => ['note' => 'http://evil.example.com']]);
    }

    /** @test */
    public function metadata_non_scalar_values_are_rejected(): void
    {
        $tenant = $this->registerTenant('acme10', 'owner10@acme.test');
        $ownerId = User::where('tenant_id', $tenant['tenant_id'])->first()->id;

        $this->expectException(RuntimeException::class);
        $this->deliver($tenant['tenant_id'], $ownerId, ['data' => ['nested' => ['a' => 1]]]);
    }

    /** @test */
    public function safe_metadata_is_accepted_and_returned(): void
    {
        $tenant = $this->registerTenant('acme11', 'owner11@acme.test');
        $ownerId = User::where('tenant_id', $tenant['tenant_id'])->first()->id;

        $notif = $this->deliver($tenant['tenant_id'], $ownerId, ['data' => ['quantity_on_hand' => 3]]);

        $this->withToken($tenant['token'])->getJson('/api/notifications')
            ->assertOk()
            ->assertJsonPath('data.0.data.quantity_on_hand', 3);

        $this->assertSame(3, $notif->fresh()->data['quantity_on_hand']);
    }

    /** @test */
    public function pagination_and_filters_follow_existing_conventions(): void
    {
        $tenant = $this->registerTenant('acme12', 'owner12@acme.test');
        $ownerId = User::where('tenant_id', $tenant['tenant_id'])->first()->id;

        $alert1 = $this->deliver($tenant['tenant_id'], $ownerId, ['category' => 'alert']);
        $this->deliver($tenant['tenant_id'], $ownerId, ['category' => 'alert']);
        $this->deliver($tenant['tenant_id'], $ownerId, ['category' => 'alert']);
        $this->deliver($tenant['tenant_id'], $ownerId, ['category' => 'update']);

        $this->withToken($tenant['token'])->postJson("/api/notifications/{$alert1->id}/read")->assertOk();

        $this->withToken($tenant['token'])->getJson('/api/notifications?per_page=2')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('meta.total', 4);

        $this->withToken($tenant['token'])->getJson('/api/notifications?category=update')
            ->assertOk()
            ->assertJsonCount(1, 'data');

        $this->withToken($tenant['token'])->getJson('/api/notifications?read=unread')
            ->assertOk()
            ->assertJsonCount(3, 'data');

        $this->withToken($tenant['token'])->getJson('/api/notifications?read=read')
            ->assertOk()
            ->assertJsonCount(1, 'data');
    }
}
