<?php

namespace Tests\Feature;

use App\Models\CommerceOrder;
use App\Models\DeliveryConnectorAccount;
use App\Models\DeliveryConnectorAttempt;
use App\Models\DeliveryHubOrder;
use App\Models\DeliveryInvoiceContext;
use App\Models\DeliveryPlatformProfile;
use App\Models\DeliveryPlatformProfileVersion as Version;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Payment;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Support\Rbac;
use App\Support\WebhookSignature;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * DLV-CONNECTOR-CORE-1 — إدخال تشغيلي موقَّع فقط.
 * تشغيل: php artisan test --filter=DeliveryConnectorCoreTest
 */
class DeliveryConnectorCoreTest extends TestCase
{
    use \Illuminate\Foundation\Testing\RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function a_mapped_store_ingests_an_operational_order_without_financial_side_effects(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('core');
        $before = $this->financialCounts();
        $account = $this->connector($auth['token'], $profile, 'store-1', $branch);
        $this->assertSame(DeliveryConnectorAccount::STATUS_CONFIGURED, $account['data']['status']);
        $this->assertArrayNotHasKey('secret', $account['data']);
        $this->assertNotContains($account['data']['status'], ['connected', 'live', 'synced']);

        $event = $this->event('P-1', ['note' => 'operational']);
        $created = $this->postEvent($account['data']['id'], $event, $account['secret'])->assertCreated();
        $this->assertFalse($created['data']['idempotent_replay']);
        $this->assertSame(DeliveryHubOrder::RECEIVED, $created['data']['state']);
        $this->assertTrue($created['data']['applied']);

        $order = DeliveryHubOrder::query()->findOrFail($created['data']['delivery_hub_order_id']);
        $this->assertSame($auth['tenant_id'], (string) $order->tenant_id);
        $this->assertSame($branch, (string) $order->branch_id);
        $this->assertSame('P-1', $order->provider_order_id);
        $this->assertNull($order->idempotency_key);
        $this->assertSame($before, $this->financialCounts());
        $this->assertSame(0, CommerceOrder::withoutGlobalScopes()->count());
        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->count());

        $storedSecret = DB::table('delivery_connector_accounts')->value('secret');
        $storedBody = DB::table('delivery_connector_attempts')->value('operational_raw_body');
        $this->assertNotSame($account['secret'], $storedSecret);
        $this->assertStringNotContainsString($account['secret'], (string) $storedSecret);
        $this->assertStringNotContainsString('operational', (string) $storedBody);
        $this->assertStringNotContainsString($account['secret'], $this->withToken($auth['token'])->getJson('/api/delivery-connectors')->getContent());

        foreach (['hungerstation', 'keeta', 'mrsool', 'ninja', 'the_chefz'] as $key) {
            $this->assertSame(0, DeliveryPlatformProfile::withoutGlobalScopes()->where('platform_key', $key)->count());
        }
        $this->assertTrue(DeliveryPlatformProfile::query()->findOrFail($profile)->is_active);
        $this->assertNotContains('delivery_connector.manage', Rbac::MATRIX['accountant']);
        $this->assertNotContains('delivery_connector.view', Rbac::MATRIX['staff']);
    }

    /** @test */
    public function a_missing_mapping_fails_closed(): void
    {
        $body = json_encode($this->event('P-x'), JSON_THROW_ON_ERROR);
        $this->call('POST', '/api/delivery-connectors/'.Str::uuid().'/events', [], [], [], $this->headers($body, 'dsec_'.bin2hex(random_bytes(32))), $body)
            ->assertUnauthorized()
            ->assertJsonPath('error_code', 'invalid_signature');
        $this->assertSame(0, DeliveryHubOrder::withoutGlobalScopes()->count());
        $this->assertSame(0, DeliveryConnectorAttempt::withoutGlobalScopes()->count());
    }

    /** @test */
    public function a_foreign_tenant_claim_fails_closed_and_credentials_stay_isolated(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('home');
        $account = $this->connector($auth['token'], $profile, 'store-home', $branch);
        $other = $this->registerTenant('other', 'owner@other.test');
        $otherProfile = $this->platform($other['token']);

        $event = $this->event('P-foreign');
        $event['tenant_id'] = $other['tenant_id'];
        $this->postEvent($account['data']['id'], $event, $account['secret'])
            ->assertStatus(422)
            ->assertJsonPath('error_code', 'mapping_mismatch');
        $this->assertSame(0, DeliveryHubOrder::withoutGlobalScopes()->count());

        $this->withToken($other['token'])->postJson('/api/delivery-connectors', [
            'delivery_platform_profile_id' => $otherProfile,
            'external_store_id' => 'store-home',
            'branch_id' => $this->branchId($other['token']),
        ])->assertStatus(409)->assertJsonPath('error_code', 'mapping_ambiguous');

        $this->withToken($other['token'])->getJson('/api/delivery-connectors/'.$account['data']['id'])->assertNotFound();
        $this->withToken($other['token'])->postJson('/api/delivery-connectors/'.$account['data']['id'].'/rotate-secret', [])->assertNotFound();
        $listed = $this->withToken($other['token'])->getJson('/api/delivery-connectors')->assertOk();
        $this->assertStringNotContainsString($account['secret'], $listed->getContent());
        $this->assertStringNotContainsString($account['data']['id'], $listed->getContent());

        $cross = $this->event('P-cross', ['note' => 'home-only']);
        $response = $this->postEvent($account['data']['id'], $cross, $account['secret'], null, $other['token'])->assertCreated();
        $order = DeliveryHubOrder::withoutGlobalScopes()->findOrFail($response['data']['delivery_hub_order_id']);
        $this->assertSame($auth['tenant_id'], (string) $order->tenant_id);
        $this->assertNotSame($other['tenant_id'], (string) $order->tenant_id);
    }

    /** @test */
    public function a_foreign_branch_claim_fails_closed_and_branch_users_stay_isolated(): void
    {
        $auth = $this->registerTenant('branches', 'owner@branches.test');
        [$first, $second] = $this->twoBranches($auth['token']);
        $profile = $this->platform($auth['token']);
        $account = $this->connector($auth['token'], $profile, 'store-b', $first);
        $limited = $this->restricted($auth, [$second], 'limited@branches.test');

        $event = $this->event('P-branch');
        $event['branch_id'] = $second;
        $this->postEvent($account['data']['id'], $event, $account['secret'])
            ->assertStatus(422)
            ->assertJsonPath('error_code', 'mapping_mismatch');
        $this->assertSame(0, DeliveryHubOrder::withoutGlobalScopes()->count());

        $created = $this->postEvent($account['data']['id'], $this->event('P-branch'), $account['secret'])->assertCreated();
        $this->withToken($limited)->getJson('/api/delivery-hub/orders/'.$created['data']['delivery_hub_order_id'])->assertNotFound();
        $this->withToken($limited)->getJson('/api/delivery-hub/orders')->assertOk()->assertJsonCount(0, 'data');
        $this->withToken($limited)->getJson('/api/delivery-connectors/'.$account['data']['id'])->assertNotFound();
        $this->withToken($limited)->postJson('/api/delivery-connectors/'.$account['data']['id'].'/rotate-secret')->assertNotFound();
        $this->withToken($limited)->postJson('/api/delivery-connectors/'.$account['data']['id'].'/disable')->assertNotFound();
        $this->withToken($limited)->getJson('/api/delivery-connectors')->assertOk()->assertJsonCount(0, 'data');

        $unrouted = $this->connector($auth['token'], $profile, 'store-unrouted', null);
        $hidden = $this->postEvent($unrouted['data']['id'], $this->event('P-unrouted'), $unrouted['secret'])->assertCreated();
        $this->assertSame(DeliveryHubOrder::UNROUTED, $hidden['data']['state']);
        $this->withToken($limited)->getJson('/api/delivery-hub/orders/'.$hidden['data']['delivery_hub_order_id'])->assertNotFound();
        $this->withToken($limited)->postJson('/api/delivery-connectors', [
            'delivery_platform_profile_id' => $profile,
            'external_store_id' => 'store-denied',
        ])->assertStatus(422)->assertJsonPath('error_code', 'branch_required');
    }

    /** @test */
    public function an_invalid_signature_or_expired_timestamp_is_rejected(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('sig');
        $account = $this->connector($auth['token'], $profile, 'store-sig', $branch);
        $event = $this->event('P-sig');
        $this->postEvent($account['data']['id'], $event, 'dsec_'.bin2hex(random_bytes(32)))
            ->assertUnauthorized()
            ->assertJsonPath('error_code', 'invalid_signature');
        $this->postEvent($account['data']['id'], $event, $account['secret'], time() - 1000)
            ->assertUnauthorized()
            ->assertJsonPath('error_code', 'timestamp_expired');
        $this->assertSame(0, DeliveryHubOrder::withoutGlobalScopes()->count());
        $this->assertSame(0, DeliveryConnectorAttempt::withoutGlobalScopes()->count());
    }

    /** @test */
    public function the_same_event_and_the_same_order_payload_are_idempotent(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('idem');
        $account = $this->connector($auth['token'], $profile, 'store-idem', $branch);
        $event = $this->event('P-idem', ['sku' => 'a']);
        $created = $this->postEvent($account['data']['id'], $event, $account['secret'])->assertCreated();

        $replay = $this->postEvent($account['data']['id'], $event, $account['secret'], time() - 1000)->assertOk();
        $this->assertTrue($replay['data']['idempotent_replay']);
        $this->assertSame($created['data']['delivery_hub_order_id'], $replay['data']['delivery_hub_order_id']);
        $this->assertSame(1, DeliveryConnectorAttempt::withoutGlobalScopes()->count());

        $again = $event;
        $again['event_id'] = (string) Str::uuid();
        $second = $this->postEvent($account['data']['id'], $again, $account['secret'])->assertCreated();
        $this->assertSame($created['data']['delivery_hub_order_id'], $second['data']['delivery_hub_order_id']);
        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->count());
    }

    /** @test */
    public function a_different_payload_conflicts_and_a_new_uuid_cannot_bypass_provider_identity(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('conflict');
        $account = $this->connector($auth['token'], $profile, 'store-c', $branch);
        $event = $this->event('P-c', ['sku' => 'a']);
        $created = $this->postEvent($account['data']['id'], $event, $account['secret'])->assertCreated();

        $changed = $event;
        $changed['intake_payload'] = ['sku' => 'b'];
        $this->postEvent($account['data']['id'], $changed, $account['secret'])
            ->assertStatus(409)
            ->assertJsonPath('error_code', 'payload_conflict');
        $this->assertSame(1, DeliveryConnectorAttempt::withoutGlobalScopes()->count());

        $changed['event_id'] = (string) Str::uuid();
        $this->postEvent($account['data']['id'], $changed, $account['secret'])
            ->assertStatus(409)
            ->assertJsonPath('error_code', 'payload_conflict');

        $bypass = $event;
        $bypass['event_id'] = (string) Str::uuid();
        $this->postEvent($account['data']['id'], $bypass, $account['secret'])->assertCreated();

        $separate = $this->event(null, ['sku' => 'c']);
        $uuidOrder = $this->postEvent($account['data']['id'], $separate, $account['secret'])->assertCreated();
        $this->assertNotSame($created['data']['delivery_hub_order_id'], $uuidOrder['data']['delivery_hub_order_id']);
        $this->assertNull(DeliveryHubOrder::query()->findOrFail($uuidOrder['data']['delivery_hub_order_id'])->provider_order_id);

        $this->assertSame(2, DeliveryHubOrder::withoutGlobalScopes()->count());
        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->where('provider_order_id', 'P-c')->count());
        $this->assertSame('REF', DeliveryHubOrder::query()->findOrFail($created['data']['delivery_hub_order_id'])->external_order_reference);
        $this->assertSame('provider-said-ready', DeliveryHubOrder::query()->findOrFail($created['data']['delivery_hub_order_id'])->provider_status);
    }

    /** @test */
    public function an_out_of_order_action_does_not_regress_hub_state(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('order');
        $account = $this->connector($auth['token'], $profile, 'store-o', $branch);

        $before = $this->financialCounts();
        $this->postEvent($account['data']['id'], $this->event('P-o', ['sku' => 'a'], 'accept'), $account['secret'])->assertCreated()
            ->assertJsonPath('data.state', DeliveryHubOrder::ACCEPTED);
        $this->postEvent($account['data']['id'], $this->event('P-o', ['sku' => 'a'], 'preparing'), $account['secret'])->assertCreated()
            ->assertJsonPath('data.state', DeliveryHubOrder::PREPARING);

        $backward = $this->postEvent($account['data']['id'], $this->event('P-o', ['sku' => 'a'], 'accept'), $account['secret'])->assertOk();
        $this->assertSame('state_not_applied', $backward['data']['outcome']);
        $this->assertFalse($backward['data']['applied']);
        $this->assertSame(DeliveryHubOrder::PREPARING, $backward['data']['state']);
        $this->assertSame(DeliveryHubOrder::PREPARING, DeliveryHubOrder::query()->where('provider_order_id', 'P-o')->firstOrFail()->state);
        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->count());
        $this->assertSame($before, $this->financialCounts());
    }

    /** @test */
    public function cancellation_does_not_release_the_provider_order_identity(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('cancel');
        $account = $this->connector($auth['token'], $profile, 'store-cancel', $branch);
        $created = $this->postEvent($account['data']['id'], $this->event('P-cancel', ['sku' => 'a']), $account['secret'])->assertCreated();
        $cancelled = $this->postEvent($account['data']['id'], $this->event('P-cancel', ['sku' => 'a'], 'cancel'), $account['secret'])->assertCreated();
        $this->assertSame($created['data']['delivery_hub_order_id'], $cancelled['data']['delivery_hub_order_id']);
        $this->assertSame(DeliveryHubOrder::CANCELLED, $cancelled['data']['state']);

        $again = $this->postEvent($account['data']['id'], $this->event('P-cancel', ['sku' => 'a']), $account['secret'])->assertCreated();
        $this->assertSame($created['data']['delivery_hub_order_id'], $again['data']['delivery_hub_order_id']);
        $order = DeliveryHubOrder::query()->where('provider_order_id', 'P-cancel')->firstOrFail();
        $this->assertSame(DeliveryHubOrder::CANCELLED, $order->state);
        $this->assertSame('P-cancel', $order->provider_order_id);
        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->count());
        $this->assertSame(0, Invoice::withoutGlobalScopes()->count());
    }

    /** @test */
    public function disabling_or_rotating_a_secret_does_not_enable_a_provider_or_duplicate_an_order(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('rotate');
        $account = $this->connector($auth['token'], $profile, 'store-r', $branch);
        $event = $this->event('P-r', ['sku' => 'a']);
        $this->postEvent($account['data']['id'], $event, $account['secret'])->assertCreated();

        $rotated = $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$account['data']['id'].'/rotate-secret')->assertOk();
        $this->assertNotSame($account['secret'], $rotated['secret']);
        $this->assertSame(2, $rotated['data']['secret_version']);
        $this->postEvent($account['data']['id'], $event, $account['secret'])->assertUnauthorized();
        $this->postEvent($account['data']['id'], $event, $rotated['secret'])->assertOk()->assertJsonPath('data.idempotent_replay', true);
        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->count());

        $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$account['data']['id'].'/disable')->assertOk()
            ->assertJsonPath('data.status', DeliveryConnectorAccount::STATUS_DISABLED);
        $this->postEvent($account['data']['id'], $event, $rotated['secret'])
            ->assertForbidden()
            ->assertJsonPath('error_code', 'connector_disabled');
        $this->assertSame(['configured', 'disabled'], DeliveryConnectorAccount::STATUSES);
        $this->assertSame(0, DeliveryPlatformProfile::withoutGlobalScopes()->whereIn('platform_key', ['hungerstation', 'keeta', 'mrsool', 'ninja', 'the_chefz'])->count());
    }

    /** @test */
    public function manual_hub_intake_and_unauthorized_roles_are_unchanged(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('manual');
        $this->withToken($auth['token'])->postJson('/api/delivery-hub/orders', [
            'delivery_platform_profile_id' => $profile,
            'provider_order_id' => 'MANUAL-1',
            'branch_id' => $branch,
        ])->assertCreated()->assertJsonPath('data.state', DeliveryHubOrder::RECEIVED);

        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@manual.test');
        $this->withToken($staff)->postJson('/api/delivery-connectors', [
            'delivery_platform_profile_id' => $profile,
            'external_store_id' => 'nope',
            'branch_id' => $branch,
        ])->assertForbidden();
        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->count());
        $this->assertSame(0, Invoice::withoutGlobalScopes()->count());
    }

    /** @return array{0: array{token: string, tenant_id: string}, 1: string, 2: string} */
    private function tenantWithPlatform(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");

        return [$auth, $this->branchId($auth['token']), $this->platform($auth['token'])];
    }

    private function branchId(string $token): string
    {
        return $this->withToken($token)->getJson('/api/branches')->assertOk()['data'][0]['id'];
    }

    /** @return array{0: string, 1: string} */
    private function twoBranches(string $token): array
    {
        $first = $this->branchId($token);
        $second = $this->withToken($token)->postJson('/api/branches', ['name' => 'فرع ثان'])->assertCreated()['data']['id'];

        return [$first, $second];
    }

    private function platform(string $token): string
    {
        return $this->withToken($token)->postJson('/api/delivery-platforms', [
            'platform_key' => 'jahez',
            'collection_mode' => Version::COLLECTION_PLATFORM,
        ])->assertCreated()['data']['id'];
    }

    /** @return array{data: array<string, mixed>, secret: string} */
    private function connector(string $token, string $profile, string $store, ?string $branch): array
    {
        $created = $this->withToken($token)->postJson('/api/delivery-connectors', array_filter([
            'delivery_platform_profile_id' => $profile,
            'external_store_id' => $store,
            'branch_id' => $branch,
        ], fn ($value) => $value !== null))->assertCreated();

        return ['data' => $created['data'], 'secret' => $created['secret']];
    }

    /** @param  array<string, mixed>|null  $payload */
    private function event(?string $providerOrderId, ?array $payload = null, ?string $action = null): array
    {
        return array_filter([
            'event_id' => (string) Str::uuid(),
            'provider_order_id' => $providerOrderId,
            'external_order_reference' => 'REF',
            'provider_status' => 'provider-said-ready',
            'hub_action' => $action,
            'intake_payload' => $payload,
            'occurred_at' => 'not-a-tax-point',
        ], fn ($value) => $value !== null);
    }

    /** @param  array<string, mixed>  $payload */
    private function postEvent(string $accountId, array $payload, string $secret, ?int $timestamp = null, ?string $bearer = null): \Illuminate\Testing\TestResponse
    {
        $body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $server = $this->headers($body, $secret, $timestamp);
        if ($bearer !== null) {
            $server['HTTP_AUTHORIZATION'] = 'Bearer '.$bearer;
        }

        return $this->call('POST', '/api/delivery-connectors/'.$accountId.'/events', [], [], [], $server, $body);
    }

    /** @return array<string, string> */
    private function headers(string $body, string $secret, ?int $timestamp = null): array
    {
        $timestamp ??= time();

        return [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_ACCEPT' => 'application/json',
            'HTTP_X_AWJ_SIGNATURE' => WebhookSignature::signatureHeader(
                $timestamp,
                WebhookSignature::sign($secret, $timestamp, $body),
            ),
        ];
    }

    /** @param  array<int, string>  $branchIds */
    private function restricted(array $auth, array $branchIds, string $email): string
    {
        $tenant = Tenant::findOrFail($auth['tenant_id']);
        $limits = $tenant->plan_limits ?? [];
        $limits['users'] = null;
        $tenant->plan_limits = $limits;
        $tenant->save();

        $this->withToken($auth['token'])->postJson('/api/users', [
            'name' => 'مشغّل فرع',
            'email' => $email,
            'password' => 'password123',
            'role' => 'admin',
            'branch_ids' => $branchIds,
        ])->assertCreated();

        return $this->postJson('/api/login', ['email' => $email, 'password' => 'password123'])->assertOk()['token'];
    }

    /** @return array<string, int> */
    private function financialCounts(): array
    {
        return [
            'invoices' => Invoice::withoutGlobalScopes()->count(),
            'payments' => Payment::withoutGlobalScopes()->count(),
            'journals' => JournalEntry::withoutGlobalScopes()->count(),
            'stock' => StockMovement::withoutGlobalScopes()->count(),
            'contexts' => DeliveryInvoiceContext::withoutGlobalScopes()->count(),
            'commerce' => CommerceOrder::withoutGlobalScopes()->count(),
        ];
    }
}
