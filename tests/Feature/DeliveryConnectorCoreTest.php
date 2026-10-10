<?php

namespace Tests\Feature;

use App\Models\CommerceOrder;
use App\Models\DeliveryConnectorAccount;
use App\Models\DeliveryConnectorAttempt;
use App\Models\DeliveryConnectorOperatorEvent;
use App\Models\DeliveryHubOrder;
use App\Models\DeliveryInvoiceContext;
use App\Models\DeliveryPlatformProfile;
use App\Models\DeliveryPlatformProfileVersion as Version;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Payment;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\TenantApplicationState;
use App\Models\User;
use App\Services\DeliveryHub\DeliveryConnectorAccountService;
use App\Services\DeliveryHub\DeliveryConnectorIngestionService;
use App\Support\Rbac;
use App\Support\WebhookSignature;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use LogicException;
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
        $this->assertContains('delivery_connector.reassign', Rbac::PERMISSIONS);
        $this->assertNotContains('delivery_connector.reassign', Rbac::MATRIX['accountant']);
        $this->assertNotContains('delivery_connector.reassign', Rbac::MATRIX['staff']);
        $this->assertNotContains('delivery_connector.reassign', Rbac::MATRIX['self_service']);
        $this->assertNull($account['data']['operated_by']);
        $this->assertNotEmpty($account['data']['configured_by']);
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

    /** @test */
    public function a_secret_rotated_during_verification_is_rejected_after_the_row_lock(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('relock');
        $account = $this->connector($auth['token'], $profile, 'store-relock', $branch);
        $before = $this->financialCounts();
        $issued = null;
        $armed = true;
        DB::listen(function ($query) use (&$armed, &$issued, $auth, $account): void {
            if (! $armed || ! str_contains($query->sql, 'delivery_connector_accounts')) {
                return;
            }
            $sql = strtolower(ltrim($query->sql));
            if (str_contains($sql, 'for update') || str_starts_with($sql, 'update') || str_starts_with($sql, 'insert')) {
                return;
            }
            $armed = false;
            app(TenantContext::class)->set($auth['tenant_id']);
            $fresh = DeliveryConnectorAccount::query()->findOrFail($account['data']['id']);
            [, $issued] = app(DeliveryConnectorAccountService::class)->rotateSecret($fresh);
        });

        $event = $this->event('P-relock', ['sku' => 'locked']);
        $this->postEvent($account['data']['id'], $event, $account['secret'])
            ->assertUnauthorized()
            ->assertJsonPath('error_code', 'invalid_signature');
        $this->assertIsString($issued);
        $this->assertNotSame($account['secret'], $issued);
        $this->assertSame(0, DeliveryHubOrder::withoutGlobalScopes()->count());
        $this->assertSame(0, DeliveryConnectorAttempt::withoutGlobalScopes()->count());
        $this->assertSame($before, $this->financialCounts());
        $this->assertSame(2, (int) DeliveryConnectorAccount::withoutGlobalScopes()->findOrFail($account['data']['id'])->secret_version);

        $created = $this->postEvent($account['data']['id'], $event, $issued)->assertCreated();
        $this->assertFalse($created['data']['idempotent_replay']);
        $this->assertSame(2, (int) DeliveryConnectorAttempt::query()->firstOrFail()->secret_version);
        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->count());
        $this->assertSame($before, $this->financialCounts());
    }

    /** @test */
    public function disabled_or_suspended_sales_pos_rejects_connector_writes(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('appstate');
        $account = $this->connector($auth['token'], $profile, 'store-app', $branch);
        $before = $this->financialCounts();
        $event = $this->event('P-app', ['sku' => 'a']);

        foreach (['disabled', 'suspended'] as $status) {
            $this->setApplicationStatus($auth['tenant_id'], $status);
            $this->postEvent($account['data']['id'], $event, $account['secret'])
                ->assertForbidden()
                ->assertJsonPath('error_code', 'application_inactive');
            $this->assertSame(0, DeliveryHubOrder::withoutGlobalScopes()->count());
            $this->assertSame(0, DeliveryConnectorAttempt::withoutGlobalScopes()->count());
        }

        $this->setApplicationStatus($auth['tenant_id'], 'enabled');
        $created = $this->postEvent($account['data']['id'], $event, $account['secret'])->assertCreated();
        $this->assertFalse($created['data']['idempotent_replay']);

        $this->setApplicationStatus($auth['tenant_id'], 'suspended');
        $later = $this->event('P-app', ['sku' => 'a']);
        $this->postEvent($account['data']['id'], $later, $account['secret'])
            ->assertForbidden()
            ->assertJsonPath('error_code', 'application_inactive');
        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->count());
        $this->assertSame(1, DeliveryConnectorAttempt::withoutGlobalScopes()->count());
        $this->assertSame($before, $this->financialCounts());

        $this->setApplicationStatus($auth['tenant_id'], 'enabled');
        $this->postEvent($account['data']['id'], $later, $account['secret'])->assertCreated();
        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->where('provider_order_id', 'P-app')->count());
    }

    /** @test */
    public function oversized_integers_and_object_list_shapes_do_not_collapse(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('json');
        $account = $this->connector($auth['token'], $profile, 'store-json', $branch);
        $before = $this->financialCounts();
        $id = $account['data']['id'];
        $secret = $account['secret'];

        $object = $this->event('P-shape');
        $object['intake_payload'] = new \stdClass();
        $created = $this->postEvent($id, $object, $secret)->assertCreated();

        $list = $object;
        $list['event_id'] = (string) Str::uuid();
        $list['intake_payload'] = [];
        $this->postEvent($id, $list, $secret)
            ->assertStatus(409)
            ->assertJsonPath('error_code', 'payload_conflict');

        $this->postRaw($id, $this->rawEnvelope('P-nested', '{"items":{}}'), $secret)->assertCreated();
        $this->postRaw($id, $this->rawEnvelope('P-nested', '{"items":[]}'), $secret)
            ->assertStatus(409)
            ->assertJsonPath('error_code', 'payload_conflict');

        $reordered = $this->event('P-keys');
        $reordered['intake_payload'] = ['b' => 1, 'a' => 2];
        $firstKeys = $this->postEvent($id, $reordered, $secret)->assertCreated();
        $reordered['event_id'] = (string) Str::uuid();
        $reordered['intake_payload'] = ['a' => 2, 'b' => 1];
        $secondKeys = $this->postEvent($id, $reordered, $secret)->assertCreated();
        $this->assertSame($firstKeys['data']['delivery_hub_order_id'], $secondKeys['data']['delivery_hub_order_id']);

        $bigCreated = $this->postRaw($id, $this->rawEnvelope('P-big', '{"n":9223372036854775808}'), $secret)->assertCreated();
        $this->postRaw($id, $this->rawEnvelope('P-big', '{"n":9223372036854775809}'), $secret)
            ->assertStatus(409)
            ->assertJsonPath('error_code', 'payload_conflict');
        $this->postRaw($id, $this->rawEnvelope('P-big', '{"n":"9223372036854775808"}'), $secret)
            ->assertStatus(409)
            ->assertJsonPath('error_code', 'payload_conflict');
        $replayedBig = $this->postRaw($id, $this->rawEnvelope('P-big', '{"n":9223372036854775808}'), $secret)->assertCreated();
        $this->assertSame($bigCreated['data']['delivery_hub_order_id'], $replayedBig['data']['delivery_hub_order_id']);

        $this->postRaw($id, $this->rawEnvelope('P-neg', '{"n":-9223372036854775809}'), $secret)->assertCreated();
        $this->postRaw($id, $this->rawEnvelope('P-neg', '{"n":-9223372036854775810}'), $secret)
            ->assertStatus(409)
            ->assertJsonPath('error_code', 'payload_conflict');

        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->where('provider_order_id', 'P-shape')->count());
        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->where('provider_order_id', 'P-big')->count());
        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->where('provider_order_id', 'P-nested')->count());
        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->where('provider_order_id', 'P-neg')->count());
        $this->assertSame($created['data']['delivery_hub_order_id'], DeliveryHubOrder::query()->where('provider_order_id', 'P-shape')->firstOrFail()->id);
        $this->assertSame($before, $this->financialCounts());
        $this->assertSame(0, CommerceOrder::withoutGlobalScopes()->count());
    }

    /** @test */
    public function stale_secret_rotations_commit_distinct_versions(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('versions');
        $account = $this->connector($auth['token'], $profile, 'store-ver', $branch);
        $before = $this->financialCounts();
        app(TenantContext::class)->set($auth['tenant_id']);
        $first = DeliveryConnectorAccount::query()->findOrFail($account['data']['id']);
        $second = DeliveryConnectorAccount::query()->findOrFail($account['data']['id']);
        $this->assertSame(1, (int) $first->secret_version);
        $this->assertSame(1, (int) $second->secret_version);

        DB::flushQueryLog();
        DB::enableQueryLog();
        $service = app(DeliveryConnectorAccountService::class);
        [$rotatedA, $secretA] = $service->rotateSecret($first);
        [$rotatedB, $secretB] = $service->rotateSecret($second);
        if (DB::connection()->getDriverName() === 'pgsql') {
            $sql = strtolower(implode("\n", array_column(DB::getQueryLog(), 'query')));
            $this->assertStringContainsString('for update', $sql);
        }

        $this->assertSame(2, (int) $rotatedA->secret_version);
        $this->assertSame(3, (int) $rotatedB->secret_version);
        $this->assertNotSame($secretA, $secretB);
        $this->assertNotSame($account['secret'], $secretA);
        $stored = DeliveryConnectorAccount::query()->findOrFail($account['data']['id']);
        $this->assertSame(3, (int) $stored->secret_version);
        $this->assertSame($secretB, $stored->secret);

        $event = $this->event('P-ver', ['sku' => 'a']);
        $this->postEvent($account['data']['id'], $event, $account['secret'])->assertUnauthorized();
        $this->postEvent($account['data']['id'], $event, $secretA)->assertUnauthorized();
        $created = $this->postEvent($account['data']['id'], $event, $secretB)->assertCreated();
        $this->assertSame(3, (int) DeliveryConnectorAttempt::query()->firstOrFail()->secret_version);
        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->count());
        $this->assertSame($created['data']['delivery_hub_order_id'], DeliveryHubOrder::query()->where('provider_order_id', 'P-ver')->firstOrFail()->id);
        $this->assertSame($before, $this->financialCounts());
    }

    /** @test */
    public function an_expired_subscription_rejects_ingestion_without_burning_the_event(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('subexp');
        $account = $this->connector($auth['token'], $profile, 'store-sub', $branch);
        $before = $this->financialCounts();
        $event = $this->event('P-sub', ['sku' => 'a']);

        Tenant::query()->whereKey($auth['tenant_id'])->update([
            'trial_ends_at' => now()->subDay(),
            'subscription_ends_at' => now()->subDay(),
        ]);

        $this->postEvent($account['data']['id'], $event, $account['secret'])
            ->assertForbidden()
            ->assertJsonPath('error_code', 'subscription_inactive');
        $this->assertSame(0, DeliveryHubOrder::withoutGlobalScopes()->count());
        $this->assertSame(0, DeliveryConnectorAttempt::withoutGlobalScopes()->count());
        $this->assertSame($before, $this->financialCounts());

        Tenant::query()->whereKey($auth['tenant_id'])->update([
            'trial_ends_at' => now()->addDay(),
            'subscription_ends_at' => null,
        ]);
        $this->postEvent($account['data']['id'], $event, $account['secret'])->assertCreated();
        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->count());
        $this->assertSame(1, DeliveryConnectorAttempt::withoutGlobalScopes()->count());
    }

    /** @test */
    public function numeric_looking_object_keys_keep_one_string_order(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('keysort');
        $account = $this->connector($auth['token'], $profile, 'store-keys', $branch);
        $before = $this->financialCounts();
        $id = $account['data']['id'];
        $secret = $account['secret'];

        $first = $this->postRaw($id, $this->rawEnvelope('P-numkeys', '{"01":"a","1":"b"}'), $secret)->assertCreated();
        $second = $this->postRaw($id, $this->rawEnvelope('P-numkeys', '{"1":"b","01":"a"}'), $secret)->assertCreated();
        $this->assertSame($first['data']['delivery_hub_order_id'], $second['data']['delivery_hub_order_id']);
        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->where('provider_order_id', 'P-numkeys')->count());
        $this->assertSame($before, $this->financialCounts());
    }

    /** @test */
    public function lossy_decimal_literals_do_not_collapse(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('decimals');
        $account = $this->connector($auth['token'], $profile, 'store-dec', $branch);
        $before = $this->financialCounts();
        $id = $account['data']['id'];
        $secret = $account['secret'];

        $created = $this->postRaw($id, $this->rawEnvelope('P-dec', '{"n":1.0000000000000001}'), $secret)->assertCreated();
        $this->postRaw($id, $this->rawEnvelope('P-dec', '{"n":1.0}'), $secret)
            ->assertStatus(409)
            ->assertJsonPath('error_code', 'payload_conflict');
        $same = $this->postRaw($id, $this->rawEnvelope('P-dec', '{"n":1.0000000000000001}'), $secret)->assertCreated();
        $this->assertSame($created['data']['delivery_hub_order_id'], $same['data']['delivery_hub_order_id']);

        $this->postRaw($id, $this->rawEnvelope('P-exp', '{"n":1e2}'), $secret)->assertCreated();
        $this->postRaw($id, $this->rawEnvelope('P-exp', '{"n":100}'), $secret)
            ->assertStatus(409)
            ->assertJsonPath('error_code', 'payload_conflict');
        $this->postRaw($id, $this->rawEnvelope('P-one', '{"n":1}'), $secret)->assertCreated();
        $this->postRaw($id, $this->rawEnvelope('P-one', '{"n":1.0}'), $secret)
            ->assertStatus(409)
            ->assertJsonPath('error_code', 'payload_conflict');

        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->where('provider_order_id', 'P-dec')->count());
        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->where('provider_order_id', 'P-exp')->count());
        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->where('provider_order_id', 'P-one')->count());
        $this->assertSame($before, $this->financialCounts());
        $this->assertSame(0, CommerceOrder::withoutGlobalScopes()->count());
    }

    /** @test */
    public function manual_numbers_keep_their_type_and_duplicate_members_are_rejected(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('adopt');
        $account = $this->connector($auth['token'], $profile, 'store-adopt', $branch);
        $before = $this->financialCounts();
        $id = $account['data']['id'];
        $secret = $account['secret'];

        $manual = $this->withToken($auth['token'])->postJson('/api/delivery-hub/orders', [
            'delivery_platform_profile_id' => $profile,
            'provider_order_id' => 'P-manual-num',
            'branch_id' => $branch,
            'intake_payload' => ['amount' => 5000],
        ])->assertCreated();
        $adopted = $this->postEvent($id, [
            'event_id' => (string) Str::uuid(),
            'provider_order_id' => 'P-manual-num',
            'intake_payload' => ['amount' => 5000],
        ], $secret)->assertCreated();
        $this->assertSame($manual['data']['id'], $adopted['data']['delivery_hub_order_id']);

        $this->withToken($auth['token'])->postJson('/api/delivery-hub/orders', [
            'delivery_platform_profile_id' => $profile,
            'provider_order_id' => 'P-manual-str',
            'branch_id' => $branch,
            'intake_payload' => ['amount' => '5000'],
        ])->assertCreated();
        $this->postEvent($id, [
            'event_id' => (string) Str::uuid(),
            'provider_order_id' => 'P-manual-str',
            'intake_payload' => ['amount' => 5000],
        ], $secret)->assertStatus(409)->assertJsonPath('error_code', 'payload_conflict');

        $this->postRaw($id, $this->rawEnvelope('P-dup', '{"n":2}'), $secret)->assertCreated();
        $this->postRaw($id, $this->rawEnvelope('P-dup', '{"n":1,"n":2}'), $secret)
            ->assertStatus(422)
            ->assertJsonPath('error_code', 'invalid_payload');
        $this->postRaw($id, $this->rawEnvelope('P-esc', '{"a":1,"\u0061":2}'), $secret)
            ->assertStatus(422)
            ->assertJsonPath('error_code', 'invalid_payload');
        $this->postRaw($id, $this->rawEnvelope('P-nest', '{"o":{"a":1,"a":2}}'), $secret)
            ->assertStatus(422)
            ->assertJsonPath('error_code', 'invalid_payload');
        $this->postRaw($id, $this->rawEnvelope('P-arr', '{"a":[{"n":1,"n":2}]}'), $secret)
            ->assertStatus(422)
            ->assertJsonPath('error_code', 'invalid_payload');

        $manualDot = '{"delivery_platform_profile_id":"'.$profile.'","provider_order_id":"P-manual-dot","branch_id":"'.$branch.'","intake_payload":{"amount":1.0}}';
        $this->call('POST', '/api/delivery-hub/orders', [], [], [], $this->jsonHeaders($auth['token']), $manualDot)->assertCreated();
        $dot = '{"event_id":"'.Str::uuid().'","provider_order_id":"P-manual-dot","intake_payload":{"amount":1.0}}';
        $this->postRaw($id, $dot, $secret)->assertCreated();
        $this->withToken($auth['token'])->postJson('/api/delivery-hub/orders', [
            'delivery_platform_profile_id' => $profile,
            'provider_order_id' => 'P-manual-dot-str',
            'branch_id' => $branch,
            'intake_payload' => ['amount' => '1.0'],
        ])->assertCreated();
        $dotString = '{"event_id":"'.Str::uuid().'","provider_order_id":"P-manual-dot-str","intake_payload":{"amount":1.0}}';
        $this->postRaw($id, $dotString, $secret)->assertStatus(409)->assertJsonPath('error_code', 'payload_conflict');

        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->where('provider_order_id', 'P-manual-num')->count());
        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->where('provider_order_id', 'P-manual-dot')->count());
        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->where('provider_order_id', 'P-dup')->count());
        $this->assertSame(0, DeliveryHubOrder::withoutGlobalScopes()->where('provider_order_id', 'P-esc')->count());
        $this->assertSame(0, DeliveryHubOrder::withoutGlobalScopes()->where('provider_order_id', 'P-arr')->count());
        $this->assertSame($before, $this->financialCounts());
    }

    /** @test */
    public function manual_adoption_rejects_object_shapes_the_hub_would_collapse(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('shape');
        $account = $this->connector($auth['token'], $profile, 'store-shape', $branch);
        $before = $this->financialCounts();
        $id = $account['data']['id'];
        $secret = $account['secret'];

        $kept = $this->withToken($auth['token'])->postJson('/api/delivery-hub/orders', [
            'delivery_platform_profile_id' => $profile,
            'provider_order_id' => 'P-shape-keep',
            'branch_id' => $branch,
            'intake_payload' => ['keep' => 'yes'],
        ])->assertCreated();
        $adopted = $this->postEvent($id, [
            'event_id' => (string) Str::uuid(),
            'provider_order_id' => 'P-shape-keep',
            'intake_payload' => ['keep' => 'yes'],
        ], $secret)->assertCreated();
        $this->assertSame($kept['data']['id'], $adopted['data']['delivery_hub_order_id']);

        $list = $this->withToken($auth['token'])->postJson('/api/delivery-hub/orders', [
            'delivery_platform_profile_id' => $profile,
            'provider_order_id' => 'P-shape-list',
            'branch_id' => $branch,
            'intake_payload' => ['a'],
        ])->assertCreated();
        $sameList = '{"event_id":"'.Str::uuid().'","provider_order_id":"P-shape-list","intake_payload":["a"]}';
        $adoptedList = $this->postRaw($id, $sameList, $secret)->assertCreated();
        $this->assertSame($list['data']['id'], $adoptedList['data']['delivery_hub_order_id']);

        $this->withToken($auth['token'])->postJson('/api/delivery-hub/orders', [
            'delivery_platform_profile_id' => $profile,
            'provider_order_id' => 'P-shape-empty',
            'branch_id' => $branch,
            'intake_payload' => [],
        ])->assertCreated();
        $this->postRaw($id, '{"event_id":"'.Str::uuid().'","provider_order_id":"P-shape-empty","intake_payload":{}}', $secret)
            ->assertStatus(409)
            ->assertJsonPath('error_code', 'payload_conflict');

        $this->withToken($auth['token'])->postJson('/api/delivery-hub/orders', [
            'delivery_platform_profile_id' => $profile,
            'provider_order_id' => 'P-shape-index',
            'branch_id' => $branch,
            'intake_payload' => ['a'],
        ])->assertCreated();
        $this->postRaw($id, '{"event_id":"'.Str::uuid().'","provider_order_id":"P-shape-index","intake_payload":{"0":"a"}}', $secret)
            ->assertStatus(409)
            ->assertJsonPath('error_code', 'payload_conflict');

        $this->withToken($auth['token'])->postJson('/api/delivery-hub/orders', [
            'delivery_platform_profile_id' => $profile,
            'provider_order_id' => 'P-shape-nest',
            'branch_id' => $branch,
            'intake_payload' => ['a' => []],
        ])->assertCreated();
        $this->postRaw($id, '{"event_id":"'.Str::uuid().'","provider_order_id":"P-shape-nest","intake_payload":{"a":{}}}', $secret)
            ->assertStatus(409)
            ->assertJsonPath('error_code', 'payload_conflict');

        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->where('provider_order_id', 'P-shape-empty')->count());
        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->where('provider_order_id', 'P-shape-index')->count());
        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->where('provider_order_id', 'P-shape-nest')->count());
        $this->assertSame(0, DeliveryConnectorAttempt::withoutGlobalScopes()
            ->whereIn('provider_order_id', ['P-shape-empty', 'P-shape-index', 'P-shape-nest'])
            ->whereNotNull('authoritative_checksum')
            ->count());
        $this->assertSame($before, $this->financialCounts());
    }

    /** @test */
    public function an_oversized_body_is_rejected_before_signature_verification(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('size');
        $account = $this->connector($auth['token'], $profile, 'store-size', $branch);
        $before = $this->financialCounts();
        $id = $account['data']['id'];
        $bogus = 't='.time().',v1='.str_repeat('ab', 32);
        $server = [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_ACCEPT' => 'application/json',
            'HTTP_X_AWJ_SIGNATURE' => $bogus,
        ];

        $this->call(
            'POST',
            '/api/delivery-connectors/'.$id.'/events',
            [],
            [],
            [],
            $server,
            str_repeat('x', DeliveryConnectorIngestionService::MAX_RAW_BYTES + 1),
        )->assertStatus(422)->assertJsonPath('error_code', 'invalid_payload');

        $this->call(
            'POST',
            '/api/delivery-connectors/'.$id.'/events',
            [],
            [],
            [],
            $server,
            str_repeat('x', DeliveryConnectorIngestionService::MAX_RAW_BYTES),
        )->assertStatus(401)->assertJsonPath('error_code', 'invalid_signature');

        $this->assertSame(0, DeliveryConnectorAttempt::withoutGlobalScopes()->count());
        $this->assertSame(0, DeliveryHubOrder::withoutGlobalScopes()->count());
        $this->assertSame($before, $this->financialCounts());
    }

    /** @test */
    public function a_connector_cannot_act_on_an_order_mapped_to_another_branch(): void
    {
        [$auth, $first, $profile] = $this->tenantWithPlatform('xbranch');
        $second = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع آخر'])->assertCreated()['data']['id'];
        $home = $this->connector($auth['token'], $profile, 'store-home-branch', $first);
        $other = $this->connector($auth['token'], $profile, 'store-other-branch', $second);
        $before = $this->financialCounts();

        $created = $this->postEvent($home['data']['id'], $this->event('P-xbranch', ['sku' => 'a']), $home['secret'])->assertCreated();
        $orderId = $created['data']['delivery_hub_order_id'];
        $this->postEvent($other['data']['id'], $this->event('P-xbranch', ['sku' => 'a'], 'cancel'), $other['secret'])
            ->assertStatus(422)
            ->assertJsonPath('error_code', 'branch_unavailable');

        $order = DeliveryHubOrder::withoutGlobalScopes()->findOrFail($orderId);
        $this->assertSame(DeliveryHubOrder::RECEIVED, $order->state);
        $this->assertSame($first, (string) $order->branch_id);
        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->where('provider_order_id', 'P-xbranch')->count());
        $foreign = DeliveryConnectorAttempt::withoutGlobalScopes()
            ->where('delivery_connector_account_id', $other['data']['id'])
            ->firstOrFail();
        $this->assertNull($foreign->delivery_hub_order_id);
        $this->assertNull($foreign->authoritative_checksum);

        $this->withToken($auth['token'])->postJson('/api/delivery-hub/orders', [
            'delivery_platform_profile_id' => $profile,
            'provider_order_id' => 'P-xmanual',
            'branch_id' => $first,
            'intake_payload' => ['sku' => 'm'],
        ])->assertCreated();
        $this->postEvent($other['data']['id'], $this->event('P-xmanual', ['sku' => 'm']), $other['secret'])
            ->assertStatus(422)
            ->assertJsonPath('error_code', 'branch_unavailable');
        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->where('provider_order_id', 'P-xmanual')->count());
        $this->assertSame(0, DeliveryConnectorAttempt::withoutGlobalScopes()
            ->where('provider_order_id', 'P-xmanual')
            ->whereNotNull('authoritative_checksum')
            ->count());

        $this->postEvent($home['data']['id'], $this->event('P-xbranch', ['sku' => 'a'], 'cancel'), $home['secret'])->assertCreated();
        $this->assertSame(DeliveryHubOrder::CANCELLED, DeliveryHubOrder::withoutGlobalScopes()->findOrFail($orderId)->state);
        $this->assertSame($before, $this->financialCounts());
    }

    /** @test */
    public function the_originating_connector_can_follow_up_after_an_unrouted_order_is_routed(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('follow');
        $account = $this->connector($auth['token'], $profile, 'store-follow', null);
        $before = $this->financialCounts();
        $payload = ['sku' => 'follow'];

        $created = $this->postEvent($account['data']['id'], $this->event('P-follow', $payload), $account['secret'])->assertCreated();
        $orderId = $created['data']['delivery_hub_order_id'];
        $this->assertSame(DeliveryHubOrder::UNROUTED, $created['data']['state']);

        $this->withToken($auth['token'])->postJson('/api/delivery-hub/orders/'.$orderId.'/transition', [
            'action' => 'route',
            'branch_id' => $branch,
        ])->assertOk();

        $accepted = $this->postEvent($account['data']['id'], $this->event('P-follow', $payload, 'accept'), $account['secret'])->assertCreated();
        $this->assertSame($orderId, $accepted['data']['delivery_hub_order_id']);
        $this->assertSame(DeliveryHubOrder::ACCEPTED, DeliveryHubOrder::withoutGlobalScopes()->findOrFail($orderId)->state);
        $this->assertSame(2, DeliveryConnectorAttempt::withoutGlobalScopes()
            ->where('delivery_connector_account_id', $account['data']['id'])
            ->where('outcome', 'accepted')
            ->count());
        $this->assertSame(0, DeliveryConnectorAttempt::withoutGlobalScopes()
            ->where('delivery_connector_account_id', $account['data']['id'])
            ->where('error_code', 'branch_unavailable')
            ->count());

        $other = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع بعيد'])->assertCreated()['data']['id'];
        $foreign = $this->connector($auth['token'], $profile, 'store-far', $other);
        $this->postEvent($foreign['data']['id'], $this->event('P-follow', $payload, 'cancel'), $foreign['secret'])
            ->assertStatus(422)
            ->assertJsonPath('error_code', 'branch_unavailable');
        $this->assertSame(DeliveryHubOrder::ACCEPTED, DeliveryHubOrder::withoutGlobalScopes()->findOrFail($orderId)->state);

        $this->withToken($auth['token'])->postJson('/api/delivery-hub/orders', [
            'delivery_platform_profile_id' => $profile,
            'provider_order_id' => 'P-manual-branched',
            'branch_id' => $branch,
            'intake_payload' => ['sku' => 'manual'],
        ])->assertCreated();
        $this->postEvent($account['data']['id'], $this->event('P-manual-branched', ['sku' => 'manual']), $account['secret'])
            ->assertStatus(422)
            ->assertJsonPath('error_code', 'branch_unavailable');
        $this->assertSame(0, DeliveryConnectorAttempt::withoutGlobalScopes()
            ->where('provider_order_id', 'P-manual-branched')
            ->whereNotNull('authoritative_checksum')
            ->count());

        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->where('provider_order_id', 'P-follow')->count());
        $this->assertSame($before, $this->financialCounts());
    }

    /** @test */
    public function another_connector_on_the_same_branch_cannot_use_the_originating_baseline(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('xsame');
        $first = $this->connector($auth['token'], $profile, 'store-same-a', $branch);
        $second = $this->connector($auth['token'], $profile, 'store-same-b', $branch);
        $before = $this->financialCounts();

        $created = $this->postEvent($first['data']['id'], $this->event('P-same', ['sku' => 'a']), $first['secret'])->assertCreated();
        $orderId = $created['data']['delivery_hub_order_id'];
        $this->postEvent($second['data']['id'], $this->event('P-same', ['sku' => 'a'], 'cancel'), $second['secret'])
            ->assertStatus(422)
            ->assertJsonPath('error_code', 'branch_unavailable');

        $order = DeliveryHubOrder::withoutGlobalScopes()->findOrFail($orderId);
        $this->assertSame(DeliveryHubOrder::RECEIVED, $order->state);
        $foreign = DeliveryConnectorAttempt::withoutGlobalScopes()
            ->where('delivery_connector_account_id', $second['data']['id'])
            ->firstOrFail();
        $this->assertNull($foreign->delivery_hub_order_id);
        $this->assertNull($foreign->authoritative_checksum);

        $this->postEvent($first['data']['id'], $this->event('P-same', ['sku' => 'a'], 'cancel'), $first['secret'])->assertCreated();
        $this->assertSame(DeliveryHubOrder::CANCELLED, DeliveryHubOrder::withoutGlobalScopes()->findOrFail($orderId)->state);
        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->where('provider_order_id', 'P-same')->count());
        $this->assertSame($before, $this->financialCounts());
    }

    /** @test */
    public function manual_adoption_rejects_numbers_that_would_become_strings(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('lossy-adopt');
        $account = $this->connector($auth['token'], $profile, 'store-lossy-adopt', $branch);
        $before = $this->financialCounts();
        $id = $account['data']['id'];
        $secret = $account['secret'];

        $this->withToken($auth['token'])->postJson('/api/delivery-hub/orders', [
            'delivery_platform_profile_id' => $profile,
            'provider_order_id' => 'P-big-str',
            'branch_id' => $branch,
            'intake_payload' => ['n' => '9223372036854775808'],
        ])->assertCreated();
        $this->postRaw($id, '{"event_id":"'.Str::uuid().'","provider_order_id":"P-big-str","intake_payload":{"n":9223372036854775808}}', $secret)
            ->assertStatus(409)
            ->assertJsonPath('error_code', 'payload_conflict');

        $this->withToken($auth['token'])->postJson('/api/delivery-hub/orders', [
            'delivery_platform_profile_id' => $profile,
            'provider_order_id' => 'P-trail',
            'branch_id' => $branch,
            'intake_payload' => ['n' => '1.00'],
        ])->assertCreated();
        $this->postRaw($id, '{"event_id":"'.Str::uuid().'","provider_order_id":"P-trail","intake_payload":{"n":1.00}}', $secret)
            ->assertStatus(409)
            ->assertJsonPath('error_code', 'payload_conflict');

        $kept = $this->withToken($auth['token'])->postJson('/api/delivery-hub/orders', [
            'delivery_platform_profile_id' => $profile,
            'provider_order_id' => 'P-exact',
            'branch_id' => $branch,
            'intake_payload' => ['n' => 5000],
        ])->assertCreated();
        $adopted = $this->postEvent($id, [
            'event_id' => (string) Str::uuid(),
            'provider_order_id' => 'P-exact',
            'intake_payload' => ['n' => 5000],
        ], $secret)->assertCreated();
        $this->assertSame($kept['data']['id'], $adopted['data']['delivery_hub_order_id']);

        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->where('provider_order_id', 'P-big-str')->count());
        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->where('provider_order_id', 'P-trail')->count());
        $this->assertSame(0, DeliveryConnectorAttempt::withoutGlobalScopes()
            ->whereIn('provider_order_id', ['P-big-str', 'P-trail'])
            ->whereNotNull('authoritative_checksum')
            ->count());
        $this->assertSame($before, $this->financialCounts());
    }

    /** @test */
    public function a_deleted_creator_fails_closed_until_an_explicit_reassignment(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('recover');
        $before = $this->financialCounts();
        $operator = $this->user($auth, 'operator@recover.test');
        $successor = $this->user($auth, 'next@recover.test');
        $account = $this->connector($operator['token'], $profile, 'store-recover', $branch);
        $id = $account['data']['id'];
        $this->assertSame($operator['id'], $account['data']['configured_by']);
        $this->assertNull($account['data']['operated_by']);

        $historical = $this->postEvent($id, $this->event('P-hist', ['sku' => 'old']), $account['secret'])->assertCreated();
        $historicalOrder = DeliveryHubOrder::query()->findOrFail($historical['data']['delivery_hub_order_id']);
        $this->assertSame($operator['id'], (string) $historicalOrder->created_by);

        $manual = $this->withToken($auth['token'])->postJson('/api/delivery-hub/orders', [
            'delivery_platform_profile_id' => $profile,
            'provider_order_id' => 'MANUAL-KEEP',
            'branch_id' => $branch,
        ])->assertCreated();

        $this->withToken($auth['token'])->deleteJson('/api/users/'.$operator['id'])->assertOk();
        $storedSecret = DB::table('delivery_connector_accounts')->where('id', $id)->value('secret');
        $retry = $this->event('P-retry', ['sku' => 'new']);
        $this->postEvent($id, $retry, $account['secret'])
            ->assertStatus(422)
            ->assertJsonPath('error_code', 'actor_unavailable');
        $this->assertSame(1, DeliveryConnectorAttempt::withoutGlobalScopes()->count());
        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->where('provider_order_id', 'P-hist')->count());
        $this->assertSame(0, DeliveryHubOrder::withoutGlobalScopes()->where('provider_order_id', 'P-retry')->count());

        $reassigned = $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$id.'/reassign', [
            'user_id' => $successor['id'],
        ])->assertOk();
        $this->assertSame($operator['id'], $reassigned['data']['configured_by']);
        $this->assertSame($successor['id'], $reassigned['data']['operated_by']);
        $this->assertSame(DeliveryConnectorAccount::STATUS_CONFIGURED, $reassigned['data']['status']);
        $this->assertSame(1, $reassigned['data']['secret_version']);
        $this->assertArrayNotHasKey('secret', $reassigned->json());
        $this->assertArrayNotHasKey('secret', $reassigned['data']);
        $this->assertStringNotContainsString($account['secret'], $reassigned->getContent());
        $this->assertSame($storedSecret, DB::table('delivery_connector_accounts')->where('id', $id)->value('secret'));

        $created = $this->postEvent($id, $retry, $account['secret'])->assertCreated();
        $this->assertFalse($created['data']['idempotent_replay']);
        $retryOrder = DeliveryHubOrder::query()->findOrFail($created['data']['delivery_hub_order_id']);
        $this->assertSame($successor['id'], (string) $retryOrder->created_by);
        $this->assertSame($operator['id'], (string) DeliveryHubOrder::query()->findOrFail($historicalOrder->id)->created_by);

        $follow = $this->postEvent($id, $this->event('P-hist', ['sku' => 'old'], 'accept'), $account['secret'])->assertCreated();
        $kept = DeliveryHubOrder::query()->findOrFail($historicalOrder->id);
        $this->assertSame($historicalOrder->id, $follow['data']['delivery_hub_order_id']);
        $this->assertSame($operator['id'], (string) $kept->created_by);
        $this->assertSame($successor['id'], (string) $kept->updated_by);
        $this->assertSame(DeliveryHubOrder::ACCEPTED, $kept->state);

        $ownerId = (string) User::query()->where('email', 'owner@recover.test')->value('id');
        $manualOrder = DeliveryHubOrder::query()->where('provider_order_id', 'MANUAL-KEEP')->firstOrFail();
        $this->assertSame($manual['data']['id'], $manualOrder->id);
        $this->assertSame($ownerId, (string) $manualOrder->created_by);
        $this->assertSame(DeliveryHubOrder::RECEIVED, $manualOrder->state);

        $events = DeliveryConnectorOperatorEvent::withoutGlobalScopes()->get();
        $this->assertCount(1, $events);
        $this->assertSame($auth['tenant_id'], (string) $events[0]->tenant_id);
        $this->assertSame($id, (string) $events[0]->delivery_connector_account_id);
        $this->assertSame($operator['id'], (string) $events[0]->from_user_id);
        $this->assertSame($successor['id'], (string) $events[0]->to_user_id);
        $this->assertSame($ownerId, (string) $events[0]->actor_user_id);
        $this->assertNotNull($events[0]->created_at);
        $this->assertNotNull(User::withTrashed()->find($operator['id'])->deleted_at);

        $again = $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$id.'/reassign', [
            'user_id' => $successor['id'],
        ])->assertOk();
        $this->assertSame($successor['id'], $again['data']['operated_by']);
        $this->assertSame($operator['id'], $again['data']['configured_by']);
        $this->assertCount(1, DeliveryConnectorOperatorEvent::withoutGlobalScopes()->get());
        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->where('provider_order_id', 'P-hist')->count());
        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->where('provider_order_id', 'P-retry')->count());
        $this->assertSame(1, (int) DeliveryConnectorAttempt::query()->where('provider_order_id', 'P-retry')->firstOrFail()->secret_version);
        $this->assertSame($before, $this->financialCounts());
        $this->assertSame(0, CommerceOrder::withoutGlobalScopes()->count());
    }

    /** @test */
    public function a_suspended_creator_is_not_replaced_until_reassignment_and_an_ineligible_operator_does_not_fall_back(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('suspend');
        $before = $this->financialCounts();
        $operator = $this->user($auth, 'operator@suspend.test');
        $successor = $this->user($auth, 'next@suspend.test');
        $account = $this->connector($operator['token'], $profile, 'store-suspend', $branch);
        $id = $account['data']['id'];
        $secret = $account['secret'];

        User::query()->whereKey($operator['id'])->update(['is_active' => false]);
        $paused = $this->event('P-pause', ['sku' => 'a']);
        $this->postEvent($id, $paused, $secret)->assertStatus(422)->assertJsonPath('error_code', 'actor_unavailable');
        $this->assertSame(0, DeliveryConnectorAttempt::withoutGlobalScopes()->count());
        $this->assertNull(DeliveryConnectorAccount::withoutGlobalScopes()->findOrFail($id)->operated_by);

        User::query()->whereKey($operator['id'])->update(['is_active' => true]);
        $resumed = $this->postEvent($id, $paused, $secret)->assertCreated();
        $this->assertSame($operator['id'], (string) DeliveryHubOrder::query()->findOrFail($resumed['data']['delivery_hub_order_id'])->created_by);

        User::query()->whereKey($operator['id'])->update(['is_active' => false]);
        $moved = $this->event('P-move', ['sku' => 'b']);
        $this->postEvent($id, $moved, $secret)->assertStatus(422)->assertJsonPath('error_code', 'actor_unavailable');
        $this->assertSame(1, DeliveryConnectorAttempt::withoutGlobalScopes()->count());

        $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$id.'/reassign', [
            'user_id' => $successor['id'],
        ])->assertOk()->assertJsonPath('data.operated_by', $successor['id']);
        $movedOrder = $this->postEvent($id, $moved, $secret)->assertCreated();
        $this->assertSame($successor['id'], (string) DeliveryHubOrder::query()->findOrFail($movedOrder['data']['delivery_hub_order_id'])->created_by);
        $this->assertSame($operator['id'], (string) DeliveryConnectorAccount::withoutGlobalScopes()->findOrFail($id)->configured_by);

        User::query()->whereKey($successor['id'])->update(['is_active' => false]);
        $blocked = $this->event('P-block', ['sku' => 'c']);
        $this->postEvent($id, $blocked, $secret)->assertStatus(422)->assertJsonPath('error_code', 'actor_unavailable');
        $this->assertSame(0, DeliveryHubOrder::withoutGlobalScopes()->where('provider_order_id', 'P-block')->count());
        $this->assertSame(2, DeliveryConnectorAttempt::withoutGlobalScopes()->count());

        User::query()->whereKey($successor['id'])->update(['is_active' => true]);
        $this->postEvent($id, $blocked, $secret)->assertCreated();
        $this->assertSame($successor['id'], (string) DeliveryHubOrder::query()->where('provider_order_id', 'P-block')->firstOrFail()->created_by);
        $this->assertSame($before, $this->financialCounts());
    }

    /** @test */
    public function ineligible_targets_and_weaker_permissions_cannot_reassign(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('elig');
        [$first, $second] = $this->twoBranches($auth['token']);
        $before = $this->financialCounts();
        $successor = $this->user($auth, 'next@elig.test');
        $account = $this->connector($auth['token'], $profile, 'store-elig', $first);
        $id = $account['data']['id'];
        $storedSecret = DB::table('delivery_connector_accounts')->where('id', $id)->value('secret');

        $other = $this->registerTenant('elig-other', 'owner@elig-other.test');
        $foreignId = (string) User::query()->where('email', 'owner@elig-other.test')->value('id');
        $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$id.'/reassign', [
            'user_id' => $foreignId,
        ])->assertStatus(422)->assertJsonPath('error_code', 'operator_ineligible');

        $inactive = $this->user($auth, 'inactive@elig.test');
        User::query()->whereKey($inactive['id'])->update(['is_active' => false]);
        $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$id.'/reassign', [
            'user_id' => $inactive['id'],
        ])->assertStatus(422)->assertJsonPath('error_code', 'operator_ineligible');

        $removed = $this->user($auth, 'removed@elig.test');
        $this->withToken($auth['token'])->deleteJson('/api/users/'.$removed['id'])->assertOk();
        $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$id.'/reassign', [
            'user_id' => $removed['id'],
        ])->assertStatus(422)->assertJsonPath('error_code', 'operator_ineligible');

        $offBranch = $this->user($auth, 'off@elig.test', 'admin', [$second]);
        $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$id.'/reassign', [
            'user_id' => $offBranch['id'],
        ])->assertStatus(422)->assertJsonPath('error_code', 'operator_ineligible');

        $unscoped = $this->connector($auth['token'], $profile, 'store-open', null);
        $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$unscoped['data']['id'].'/reassign', [
            'user_id' => $offBranch['id'],
        ])->assertStatus(422)->assertJsonPath('error_code', 'operator_ineligible');

        $onBranch = $this->user($auth, 'on@elig.test', 'admin', [$first]);
        $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$id.'/reassign', [
            'user_id' => $onBranch['id'],
        ])->assertOk()->assertJsonPath('data.operated_by', $onBranch['id']);
        $this->assertSame($account['data']['configured_by'], DeliveryConnectorAccount::withoutGlobalScopes()->findOrFail($id)->configured_by);
        $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$id.'/reassign', [
            'user_id' => $successor['id'],
        ])->assertOk();

        $limited = $this->user($auth, 'limited@elig.test', 'admin', [$second]);
        $this->withToken($limited['token'])->postJson('/api/delivery-connectors/'.$id.'/reassign', [
            'user_id' => $successor['id'],
        ])->assertNotFound();
        $this->withToken($limited['token'])->postJson('/api/delivery-connectors/'.$unscoped['data']['id'].'/reassign', [
            'user_id' => $successor['id'],
        ])->assertNotFound();

        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@elig.test');
        $accountant = $this->tokenForRole($auth['tenant_id'], 'accountant', 'accountant@elig.test');
        $this->withToken($staff)->postJson('/api/delivery-connectors/'.$id.'/reassign', [
            'user_id' => $successor['id'],
        ])->assertForbidden();
        $this->withToken($accountant)->postJson('/api/delivery-connectors/'.$id.'/reassign', [
            'user_id' => $successor['id'],
        ])->assertForbidden();

        $role = $this->withToken($auth['token'])->postJson('/api/roles', [
            'name' => 'إدارة الربط',
            'permissions' => ['delivery_connector.view', 'delivery_connector.manage'],
        ])->assertCreated();
        $manager = $this->user($auth, 'manager@elig.test', $role['data']['slug']);
        $managed = $this->connector($auth['token'], $profile, 'store-managed', $first);
        $rotated = $this->withToken($manager['token'])->postJson('/api/delivery-connectors/'.$managed['data']['id'].'/rotate-secret')->assertOk();
        $this->assertArrayHasKey('secret', $rotated->json());
        $this->withToken($manager['token'])->postJson('/api/delivery-connectors/'.$managed['data']['id'].'/reassign', [
            'user_id' => $successor['id'],
        ])->assertForbidden();
        $this->assertNull(DeliveryConnectorAccount::withoutGlobalScopes()->findOrFail($managed['data']['id'])->operated_by);
        $this->assertSame(2, (int) DeliveryConnectorAccount::withoutGlobalScopes()->findOrFail($managed['data']['id'])->secret_version);

        $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$id.'/reassign', [])->assertStatus(422);
        $this->assertSame($storedSecret, DB::table('delivery_connector_accounts')->where('id', $id)->value('secret'));
        $this->assertNull(DeliveryConnectorAccount::withoutGlobalScopes()->findOrFail($unscoped['data']['id'])->operated_by);
        $this->assertSame($successor['id'], (string) DeliveryConnectorAccount::withoutGlobalScopes()->findOrFail($id)->operated_by);
        $this->assertSame($first, (string) DeliveryConnectorAccount::withoutGlobalScopes()->findOrFail($id)->branch_id);
        $this->assertNotSame($other['tenant_id'], $auth['tenant_id']);
        $this->assertSame($before, $this->financialCounts());
        $this->assertStringNotContainsString($account['secret'], $this->withToken($auth['token'])->getJson('/api/delivery-connectors/'.$id)->getContent());
    }

    /** @test */
    public function reassignment_does_not_enable_or_rotate_a_disabled_connector(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('stayoff');
        $before = $this->financialCounts();
        $successor = $this->user($auth, 'next@stayoff.test');
        $account = $this->connector($auth['token'], $profile, 'store-off', $branch);
        $id = $account['data']['id'];
        $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$id.'/disable')->assertOk();
        $storedSecret = DB::table('delivery_connector_accounts')->where('id', $id)->value('secret');
        $version = (int) DeliveryConnectorAccount::withoutGlobalScopes()->findOrFail($id)->secret_version;

        $response = $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$id.'/reassign', [
            'user_id' => $successor['id'],
        ])->assertOk();
        $this->assertSame(DeliveryConnectorAccount::STATUS_DISABLED, $response['data']['status']);
        $this->assertNotNull($response['data']['disabled_at']);
        $this->assertSame($successor['id'], $response['data']['operated_by']);
        $this->assertSame($account['data']['configured_by'], $response['data']['configured_by']);
        $this->assertSame($version, $response['data']['secret_version']);
        $this->assertArrayNotHasKey('secret', $response->json());
        $this->assertSame($storedSecret, DB::table('delivery_connector_accounts')->where('id', $id)->value('secret'));
        $this->assertSame($branch, $response['data']['branch_id']);
        $this->assertSame('jahez', $response['data']['platform_key']);

        $event = $this->event('P-off', ['sku' => 'a']);
        $this->postEvent($id, $event, $account['secret'])
            ->assertForbidden()
            ->assertJsonPath('error_code', 'connector_disabled');
        $this->assertSame(0, DeliveryConnectorAttempt::withoutGlobalScopes()->count());
        $this->assertSame(0, DeliveryHubOrder::withoutGlobalScopes()->count());
        $this->assertSame($before, $this->financialCounts());
    }

    /** @test */
    public function application_and_subscription_gates_block_reassignment_without_burning_the_event(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('gates');
        $before = $this->financialCounts();
        $successor = $this->user($auth, 'next@gates.test');
        $account = $this->connector($auth['token'], $profile, 'store-gates', $branch);
        $id = $account['data']['id'];
        $event = $this->event('P-gate', ['sku' => 'a']);

        foreach (['disabled', 'suspended'] as $status) {
            $this->setApplicationStatus($auth['tenant_id'], $status);
            $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$id.'/reassign', [
                'user_id' => $successor['id'],
            ])->assertForbidden();
            $this->postEvent($id, $event, $account['secret'])
                ->assertForbidden()
                ->assertJsonPath('error_code', 'application_inactive');
            $this->assertNull(DeliveryConnectorAccount::withoutGlobalScopes()->findOrFail($id)->operated_by);
            $this->assertSame(0, DeliveryConnectorAttempt::withoutGlobalScopes()->count());
        }

        $this->setApplicationStatus($auth['tenant_id'], 'enabled');
        Tenant::query()->whereKey($auth['tenant_id'])->update([
            'trial_ends_at' => now()->subDay(),
            'subscription_ends_at' => now()->subDay(),
        ]);
        $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$id.'/reassign', [
            'user_id' => $successor['id'],
        ])->assertForbidden();
        $this->postEvent($id, $event, $account['secret'])
            ->assertForbidden()
            ->assertJsonPath('error_code', 'subscription_inactive');
        $this->assertNull(DeliveryConnectorAccount::withoutGlobalScopes()->findOrFail($id)->operated_by);
        $this->assertSame(0, DeliveryConnectorAttempt::withoutGlobalScopes()->count());
        $this->assertSame(0, DeliveryHubOrder::withoutGlobalScopes()->count());

        Tenant::query()->whereKey($auth['tenant_id'])->update([
            'trial_ends_at' => now()->addDay(),
            'subscription_ends_at' => null,
        ]);
        $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$id.'/reassign', [
            'user_id' => $successor['id'],
        ])->assertOk()->assertJsonPath('data.operated_by', $successor['id']);
        $created = $this->postEvent($id, $event, $account['secret'])->assertCreated();
        $this->assertSame($successor['id'], (string) DeliveryHubOrder::query()->findOrFail($created['data']['delivery_hub_order_id'])->created_by);
        $this->assertSame(1, (int) DeliveryConnectorAccount::withoutGlobalScopes()->findOrFail($id)->secret_version);
        $this->assertSame($before, $this->financialCounts());
    }

    /** @test */
    public function stale_reassignments_commit_distinct_operators_under_the_account_lock(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('locks');
        $before = $this->financialCounts();
        $firstUser = $this->user($auth, 'first@locks.test');
        $secondUser = $this->user($auth, 'second@locks.test');
        $account = $this->connector($auth['token'], $profile, 'store-locks', $branch);
        app(TenantContext::class)->set($auth['tenant_id']);
        $owner = User::query()->where('email', 'owner@locks.test')->firstOrFail();
        $staleA = DeliveryConnectorAccount::query()->findOrFail($account['data']['id']);
        $staleB = DeliveryConnectorAccount::query()->findOrFail($account['data']['id']);
        $this->assertNull($staleA->operated_by);
        $this->assertNull($staleB->operated_by);
        $storedSecret = DB::table('delivery_connector_accounts')->where('id', $account['data']['id'])->value('secret');

        DB::flushQueryLog();
        DB::enableQueryLog();
        $service = app(DeliveryConnectorAccountService::class);
        $afterA = $service->reassign($staleA, $owner, $firstUser['id']);
        $afterB = $service->reassign($staleB, $owner, $secondUser['id']);
        if (DB::connection()->getDriverName() === 'pgsql') {
            $sql = strtolower(implode("\n", array_column(DB::getQueryLog(), 'query')));
            $this->assertStringContainsString('for update', $sql);
        }

        $this->assertSame($firstUser['id'], (string) $afterA->operated_by);
        $this->assertSame($secondUser['id'], (string) $afterB->operated_by);
        $stored = DeliveryConnectorAccount::query()->findOrFail($account['data']['id']);
        $this->assertSame($secondUser['id'], (string) $stored->operated_by);
        $this->assertSame($account['data']['configured_by'], (string) $stored->configured_by);
        $this->assertSame(1, (int) $stored->secret_version);
        $this->assertSame($storedSecret, DB::table('delivery_connector_accounts')->where('id', $account['data']['id'])->value('secret'));

        $events = DeliveryConnectorOperatorEvent::withoutGlobalScopes()->get();
        $this->assertCount(2, $events);
        $this->assertTrue($events->contains(fn ($event) => (string) $event->from_user_id === (string) $account['data']['configured_by']
            && (string) $event->to_user_id === $firstUser['id']
            && (string) $event->actor_user_id === (string) $owner->id));
        $this->assertTrue($events->contains(fn ($event) => (string) $event->from_user_id === $firstUser['id']
            && (string) $event->to_user_id === $secondUser['id']
            && (string) $event->actor_user_id === (string) $owner->id));

        $created = $this->postEvent($account['data']['id'], $this->event('P-lock', ['sku' => 'a']), $account['secret'])->assertCreated();
        $this->assertSame($secondUser['id'], (string) DeliveryHubOrder::query()->findOrFail($created['data']['delivery_hub_order_id'])->created_by);
        $this->assertSame($before, $this->financialCounts());
    }

    /** @test */
    public function a_target_deleted_after_the_account_lock_is_rejected(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('stale');
        $before = $this->financialCounts();
        $target = $this->user($auth, 'target@stale.test');
        $account = $this->connector($auth['token'], $profile, 'store-stale', $branch);
        $id = $account['data']['id'];
        $row = User::query()->findOrFail($target['id']);
        $selects = 0;
        $armed = true;
        DB::listen(function ($query) use (&$armed, &$selects, $row): void {
            if (! $armed || ! str_contains($query->sql, 'delivery_connector_accounts')) {
                return;
            }
            $sql = strtolower($query->sql);
            if (! str_contains($sql, 'select')) {
                return;
            }
            $selects++;
            if ($selects < 2 && ! str_contains($sql, 'for update')) {
                return;
            }
            $armed = false;
            $row->delete();
        });

        $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$id.'/reassign', [
            'user_id' => $target['id'],
        ])->assertStatus(422)->assertJsonPath('error_code', 'operator_ineligible');

        $this->assertNull(DeliveryConnectorAccount::withoutGlobalScopes()->findOrFail($id)->operated_by);
        $this->assertSame(0, DeliveryConnectorOperatorEvent::withoutGlobalScopes()->count());
        $this->assertNull(User::withTrashed()->findOrFail($target['id'])->deleted_at);
        $this->assertSame(0, DeliveryHubOrder::withoutGlobalScopes()->count());
        $this->assertSame($before, $this->financialCounts());
    }

    /** @test */
    public function an_in_flight_ingest_keeps_the_locked_actor_snapshot(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('inflight');
        $before = $this->financialCounts();
        $successor = $this->user($auth, 'next@inflight.test');
        $account = $this->connector($auth['token'], $profile, 'store-inflight', $branch);
        $id = $account['data']['id'];
        $selects = 0;
        $armed = true;
        DB::listen(function ($query) use (&$armed, &$selects, $id, $successor): void {
            if (! $armed || ! str_contains($query->sql, 'delivery_connector_accounts')) {
                return;
            }
            $sql = strtolower($query->sql);
            if (! str_contains($sql, 'select')) {
                return;
            }
            $selects++;
            if (! str_contains($sql, 'for update') && $selects < 2) {
                return;
            }
            $armed = false;
            DB::table('delivery_connector_accounts')->where('id', $id)->update([
                'operated_by' => $successor['id'],
            ]);
        });

        $first = $this->postEvent($id, $this->event('P-snap', ['sku' => 'a']), $account['secret'])->assertCreated();
        $this->assertSame(
            $account['data']['configured_by'],
            (string) DeliveryHubOrder::query()->findOrFail($first['data']['delivery_hub_order_id'])->created_by,
        );
        $this->assertSame($successor['id'], (string) DeliveryConnectorAccount::withoutGlobalScopes()->findOrFail($id)->operated_by);

        $second = $this->postEvent($id, $this->event('P-next', ['sku' => 'b']), $account['secret'])->assertCreated();
        $this->assertSame($successor['id'], (string) DeliveryHubOrder::query()->findOrFail($second['data']['delivery_hub_order_id'])->created_by);
        $this->assertSame(
            $account['data']['configured_by'],
            (string) DeliveryHubOrder::query()->findOrFail($first['data']['delivery_hub_order_id'])->created_by,
        );
        $this->assertSame(1, (int) DeliveryConnectorAccount::withoutGlobalScopes()->findOrFail($id)->secret_version);
        $this->assertSame($before, $this->financialCounts());
    }

    /** @test */
    public function reassignment_committed_before_the_row_lock_is_the_ingest_actor(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('beforelock');
        $before = $this->financialCounts();
        $successor = $this->user($auth, 'next@beforelock.test');
        $account = $this->connector($auth['token'], $profile, 'store-before', $branch);
        $armed = true;
        DB::listen(function ($query) use (&$armed, $auth, $account, $successor): void {
            if (! $armed || ! str_contains($query->sql, 'delivery_connector_accounts')) {
                return;
            }
            $sql = strtolower(ltrim($query->sql));
            if (! str_starts_with($sql, 'select') || str_contains($sql, 'for update')) {
                return;
            }
            $armed = false;
            app(TenantContext::class)->set($auth['tenant_id']);
            $owner = User::query()->where('email', 'owner@beforelock.test')->firstOrFail();
            $fresh = DeliveryConnectorAccount::query()->findOrFail($account['data']['id']);
            app(DeliveryConnectorAccountService::class)->reassign($fresh, $owner, $successor['id']);
        });

        $created = $this->postEvent($account['data']['id'], $this->event('P-before', ['sku' => 'a']), $account['secret'])->assertCreated();
        $this->assertSame($successor['id'], (string) DeliveryHubOrder::query()->findOrFail($created['data']['delivery_hub_order_id'])->created_by);
        $stored = DeliveryConnectorAccount::withoutGlobalScopes()->findOrFail($account['data']['id']);
        $this->assertSame($account['data']['configured_by'], (string) $stored->configured_by);
        $this->assertSame($successor['id'], (string) $stored->operated_by);
        $this->assertSame(1, (int) $stored->secret_version);
        $this->assertCount(1, DeliveryConnectorOperatorEvent::withoutGlobalScopes()->get());
        $this->assertSame($before, $this->financialCounts());
    }

    /** @test */
    public function naming_the_creator_is_audited_once_and_history_cannot_be_rewritten(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('audit');
        $before = $this->financialCounts();
        $account = $this->connector($auth['token'], $profile, 'store-audit', $branch);
        $id = $account['data']['id'];
        $creator = $account['data']['configured_by'];
        $other = $this->user($auth, 'other@audit.test');

        $named = $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$id.'/reassign', [
            'user_id' => $creator,
        ])->assertOk();
        $this->assertSame($creator, $named['data']['operated_by']);
        $this->assertSame($creator, $named['data']['configured_by']);
        $this->assertCount(1, DeliveryConnectorOperatorEvent::withoutGlobalScopes()->get());
        $event = DeliveryConnectorOperatorEvent::withoutGlobalScopes()->firstOrFail();
        $this->assertSame($creator, (string) $event->from_user_id);
        $this->assertSame($creator, (string) $event->to_user_id);

        $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$id.'/reassign', [
            'user_id' => $creator,
        ])->assertOk();
        $this->assertCount(1, DeliveryConnectorOperatorEvent::withoutGlobalScopes()->get());

        app(TenantContext::class)->set($auth['tenant_id']);
        $row = DeliveryConnectorAccount::query()->findOrFail($id);
        try {
            $row->forceFill(['configured_by' => $other['id']])->save();
            $this->fail('configured_by was rewritten');
        } catch (DomainException $e) {
            $this->assertStringContainsString('immutable', $e->getMessage());
        }
        $this->assertSame($creator, (string) DeliveryConnectorAccount::query()->findOrFail($id)->configured_by);

        try {
            $event->forceFill(['to_user_id' => $other['id']])->save();
            $this->fail('operator event was updated');
        } catch (LogicException) {
            $this->assertSame($creator, (string) DeliveryConnectorOperatorEvent::withoutGlobalScopes()->findOrFail($event->id)->to_user_id);
        }
        try {
            $event->delete();
            $this->fail('operator event was deleted');
        } catch (LogicException) {
            $this->assertSame(1, DeliveryConnectorOperatorEvent::withoutGlobalScopes()->count());
        }

        $this->assertSame(1, (int) DeliveryConnectorAccount::query()->findOrFail($id)->secret_version);
        $this->assertSame($before, $this->financialCounts());
        $this->assertSame(0, Invoice::withoutGlobalScopes()->count());
    }

    /** @return array<string, string> */
    private function jsonHeaders(string $token): array
    {
        return [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_ACCEPT' => 'application/json',
            'HTTP_AUTHORIZATION' => 'Bearer '.$token,
        ];
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

    private function postRaw(string $accountId, string $body, string $secret): \Illuminate\Testing\TestResponse
    {
        return $this->call('POST', '/api/delivery-connectors/'.$accountId.'/events', [], [], [], $this->headers($body, $secret), $body);
    }

    private function rawEnvelope(string $providerOrderId, string $payloadJson): string
    {
        return '{"event_id":"' . Str::uuid() . '","provider_order_id":"' . $providerOrderId . '","external_order_reference":"REF","provider_status":"provider-said-ready","intake_payload":' . $payloadJson . '}';
    }

    private function setApplicationStatus(string $tenantId, string $status): void
    {
        app(TenantContext::class)->set($tenantId);
        TenantApplicationState::query()->where('application_key', 'sales.pos')->update(['status' => $status]);
        app(TenantContext::class)->forget();
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

    private function raiseUserLimit(string $tenantId): void
    {
        $tenant = Tenant::findOrFail($tenantId);
        $limits = $tenant->plan_limits ?? [];
        $limits['users'] = null;
        $tenant->plan_limits = $limits;
        $tenant->save();
    }

    /** @param  array<int, string>|null  $branchIds
     * @return array{id: string, token: string}
     */
    private function user(array $auth, string $email, string $role = 'admin', ?array $branchIds = null): array
    {
        $this->raiseUserLimit($auth['tenant_id']);
        $payload = [
            'name' => 'مستخدم تشغيلي',
            'email' => $email,
            'password' => 'password123',
            'role' => $role,
        ];
        if ($branchIds !== null) {
            $payload['branch_ids'] = $branchIds;
        }
        $created = $this->withToken($auth['token'])->postJson('/api/users', $payload)->assertCreated();
        app(TenantContext::class)->set($auth['tenant_id']);
        $user = User::query()->findOrFail($created['data']['id']);

        return ['id' => (string) $user->id, 'token' => $user->createToken('api')->plainTextToken];
    }
}
