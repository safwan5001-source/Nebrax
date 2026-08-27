<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\DeliveryNote;
use App\Models\DocumentChannelIdentity;
use App\Models\DocumentFile;
use App\Models\DocumentSourceAuditEvent;
use App\Models\DocumentSourceReceiptRecord;
use App\Models\Expense;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Payment;
use App\Models\Purchase;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\User;
use App\Services\DocumentCenter\DocumentChannelIdentityResolver;
use App\Services\DocumentCenter\DocumentChannelIdentityService;
use App\Services\DocumentCenter\DocumentSourceEnvelope;
use App\Services\DocumentCenter\DocumentSourceException;
use App\Services\DocumentCenter\DocumentStorageService;
use App\Services\DocumentCenter\WebDocumentSourceConnector;
use App\Services\EntitlementGrantService;
use App\Services\TenantApplicationService;
use App\Support\DocumentSourceChannel;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Mockery;
use RuntimeException;
use Tests\TestCase;

class DocumentSourceChannelTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private string $png;

    private string $otherPng;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        config()->set('document_center.storage.driver', 'local');
        config()->set('document_center.storage.disk', 'local');
        config()->set('document_center.storage.persistent_enabled', false);
        $this->png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', true);
        $this->otherPng = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAQAAAB0L9bPAAAADUlEQVR42mP8z8BQDwAFgQH/q842WQAAAABJRU5ErkJggg==', true);
    }

    /** @test */
    public function a_trusted_web_channel_reuses_secure_intake_and_replays_the_same_receipt_without_financial_effects(): void
    {
        $fixture = $this->authorizedFixture('channel-replay');
        $identity = $this->identity($fixture['owner'], 'web-connector-01');
        $connector = app(WebDocumentSourceConnector::class);

        $accepted = $connector->receive($this->envelope($identity, $fixture['owner'], 'message-001', $this->image('invoice.png')));
        $replayed = $connector->receive($this->envelope($identity, $fixture['owner'], 'message-001', $this->image('invoice-copy.png')));

        $this->assertFalse($accepted->idempotentReplay);
        $this->assertTrue($replayed->idempotentReplay);
        $this->assertSame($accepted->batch->id, $replayed->batch->id);
        $this->assertSame($accepted->file->id, $replayed->file->id);
        $this->assertSame('web', $accepted->batch->source_type);
        $this->assertSame(hash('sha256', $this->png), $accepted->file->sha256);
        $this->assertSame(1, DocumentSourceReceiptRecord::query()->count());
        $this->assertSame(3, DocumentSourceAuditEvent::query()->count());
        Storage::disk('local')->assertExists($accepted->file->object_key);

        $this->assertSame(0, Invoice::query()->count());
        $this->assertSame(0, Purchase::query()->count());
        $this->assertSame(0, Expense::query()->count());
        $this->assertSame(0, DeliveryNote::query()->count());
        $this->assertSame(0, JournalEntry::query()->count());
        $this->assertSame(0, Payment::query()->count());
        $this->assertSame(0, StockMovement::query()->count());
    }

    /** @test */
    public function a_reused_external_reference_with_different_content_is_rejected_and_only_a_safe_conflict_event_is_recorded(): void
    {
        $fixture = $this->authorizedFixture('channel-conflict');
        $identity = $this->identity($fixture['owner'], 'web-connector-02');
        $connector = app(WebDocumentSourceConnector::class);
        $connector->receive($this->envelope($identity, $fixture['owner'], 'message-002', $this->image('original.png')));

        $exception = $this->capture(fn () => $connector->receive(
            $this->envelope($identity, $fixture['owner'], 'message-002', $this->otherImage('changed.png')),
        ));

        $this->assertSame(DocumentSourceException::REFERENCE_CONFLICT, $exception->errorCode);
        $this->assertSame(1, DocumentSourceReceiptRecord::query()->count());
        $this->assertSame(1, DocumentFile::query()->count());
        $this->assertTrue(DocumentSourceAuditEvent::query()->where('event', DocumentSourceAuditEvent::CONFLICT_REJECTED)->exists());
        $this->assertCount(1, Storage::disk('local')->allFiles());
    }

    /** @test */
    public function disabled_identities_cross_tenant_resolution_and_foreign_branch_actors_are_rejected_before_receipt_creation(): void
    {
        $fixture = $this->authorizedFixture('channel-isolation');
        $identity = $this->identity($fixture['owner'], 'web-connector-03');
        app(DocumentChannelIdentityService::class)->disable($identity, $fixture['owner']);

        $disabled = $this->capture(fn () => app(WebDocumentSourceConnector::class)->receive(
            $this->envelope($identity, $fixture['owner'], 'message-disabled', $this->image('disabled.png')),
        ));
        $this->assertSame(DocumentSourceException::IDENTITY_DISABLED, $disabled->errorCode);

        $other = $this->authorizedFixture('channel-other');
        $notFound = $this->capture(fn () => app(DocumentChannelIdentityResolver::class)->resolve(
            DocumentSourceChannel::WEB,
            'web-connector-03',
            $other['owner'],
        ));
        $this->assertSame(DocumentSourceException::IDENTITY_NOT_FOUND, $notFound->errorCode);

        app(TenantContext::class)->set($fixture['tenant_id']);
        app(BranchContext::class)->set($fixture['branch']->id);
        app(DocumentChannelIdentityService::class)->enable($identity, $fixture['owner']);
        $foreignBranch = Branch::create(['code' => 'ALT-'.substr($fixture['tenant_id'], 0, 5), 'name' => 'فرع بديل']);
        $fixture['owner']->branches()->sync([$foreignBranch->id]);
        app(TenantContext::class)->set($fixture['tenant_id']);
        app(BranchContext::class)->set($foreignBranch->id);
        $branchDenied = $this->capture(fn () => app(WebDocumentSourceConnector::class)->receive(
            $this->envelope($identity, $fixture['owner'], 'message-branch', $this->image('branch.png')),
        ));
        $this->assertSame(DocumentSourceException::ACCESS_DENIED, $branchDenied->errorCode);
        $this->assertSame(0, DocumentSourceReceiptRecord::query()->count());
    }

    /** @test */
    public function metadata_scope_spoofing_and_unsupported_channels_are_rejected_at_the_internal_contract_boundary(): void
    {
        $fixture = $this->authorizedFixture('channel-metadata');
        $identity = $this->identity($fixture['owner'], 'web-connector-04');

        $metadata = $this->capture(fn () => DocumentSourceEnvelope::fromResolvedIdentity(
            $identity,
            $fixture['owner'],
            DocumentSourceChannel::WEB,
            'purchase_invoice',
            'message-metadata',
            $this->image('metadata.png'),
            ['tenant_id' => 'spoofed'],
        ));
        $this->assertSame(DocumentSourceException::METADATA_INVALID, $metadata->errorCode);

        $api = $this->capture(fn () => DocumentSourceEnvelope::fromResolvedIdentity(
            $identity,
            $fixture['owner'],
            DocumentSourceChannel::API,
            'purchase_invoice',
            'message-api',
            $this->image('api.png'),
        ));
        $this->assertSame(DocumentSourceException::NOT_SUPPORTED, $api->errorCode);
        $this->assertSame(0, DocumentSourceReceiptRecord::query()->count());
    }

    /** @test */
    public function entitlement_application_state_and_rbac_are_enforced_for_the_internal_connector(): void
    {
        $fixture = $this->authorizedFixture('channel-access');
        $identity = $this->identity($fixture['owner'], 'web-connector-05');
        app(TenantApplicationService::class)->disable('document_center.core', $fixture['owner']);
        $disabledApp = $this->capture(fn () => app(WebDocumentSourceConnector::class)->receive(
            $this->envelope($identity, $fixture['owner'], 'message-app-disabled', $this->image('app-disabled.png')),
        ));
        $this->assertSame(DocumentSourceException::ACCESS_DENIED, $disabledApp->errorCode);

        $missingEntitlement = $this->registerTenant('channel-no-entitlement', 'owner@channel-no-entitlement.test');
        app(TenantContext::class)->set($missingEntitlement['tenant_id']);
        $branch = Branch::query()->firstOrFail();
        app(BranchContext::class)->set($branch->id);
        $owner = User::where('tenant_id', $missingEntitlement['tenant_id'])->firstOrFail();
        $identityWithoutGrant = DocumentChannelIdentity::create([
            'channel' => DocumentSourceChannel::WEB,
            'display_name' => 'هوية بلا استحقاق',
            'external_identity_fingerprint' => DocumentSourceEnvelope::fingerprint('web-connector-06'),
            'external_identity_masked' => 'web…-06',
            'created_by' => $owner->id,
        ]);
        $denied = $this->capture(fn () => app(WebDocumentSourceConnector::class)->receive(
            $this->envelope($identityWithoutGrant, $owner, 'message-entitlement', $this->image('entitlement.png')),
        ));
        $this->assertSame(DocumentSourceException::ACCESS_DENIED, $denied->errorCode);

        $staffToken = $this->tokenForRole($fixture['tenant_id'], 'staff', 'staff@channel-access.test');
        $staff = User::where('tenant_id', $fixture['tenant_id'])->where('email', 'staff@channel-access.test')->firstOrFail();
        app(TenantContext::class)->set($fixture['tenant_id']);
        app(BranchContext::class)->set($fixture['branch']->id);
        $rbac = $this->capture(fn () => app(WebDocumentSourceConnector::class)->receive(
            $this->envelope($identity, $staff, 'message-rbac', $this->image('rbac.png')),
        ));
        $this->assertNotSame('', $staffToken);
        $this->assertSame(DocumentSourceException::ACCESS_DENIED, $rbac->errorCode);
        $this->assertSame(0, DocumentSourceReceiptRecord::query()->count());
    }

    /** @test */
    public function invalid_file_failure_never_creates_a_success_receipt_or_orphaned_storage_object(): void
    {
        $fixture = $this->authorizedFixture('channel-failure');
        $identity = $this->identity($fixture['owner'], 'web-connector-07');
        $exception = $this->capture(fn () => app(WebDocumentSourceConnector::class)->receive(
            $this->envelope(
                $identity,
                $fixture['owner'],
                'message-invalid-file',
                UploadedFile::fake()->createWithContent('not-a-pdf.pdf', 'not actually a pdf'),
            ),
        ));

        $this->assertSame(DocumentSourceException::INTAKE_REJECTED, $exception->errorCode);
        $this->assertSame(0, DocumentSourceReceiptRecord::query()->count());
        $this->assertSame(0, DocumentFile::query()->count());
        $this->assertSame([], Storage::disk('local')->allFiles());
        $this->assertTrue(DocumentSourceAuditEvent::query()->where('event', DocumentSourceAuditEvent::REJECTED)->exists());
    }

    /** @test */
    public function storage_failure_does_not_leave_a_success_receipt_or_an_orphaned_object(): void
    {
        $fixture = $this->authorizedFixture('channel-storage-failure');
        $identity = $this->identity($fixture['owner'], 'web-connector-storage-failure');
        $storage = Mockery::mock(DocumentStorageService::class);
        $storage->shouldReceive('profile')->once()->andReturn('platform');
        $storage->shouldReceive('put')->once()->andThrow(new RuntimeException('storage unavailable'));
        $this->app->instance(DocumentStorageService::class, $storage);

        $exception = $this->capture(fn () => app(WebDocumentSourceConnector::class)->receive(
            $this->envelope($identity, $fixture['owner'], 'message-storage-failure', $this->image('storage-failure.png')),
        ));

        $this->assertSame(DocumentSourceException::INTAKE_REJECTED, $exception->errorCode);
        $this->assertSame(0, DocumentSourceReceiptRecord::query()->count());
        $this->assertSame(0, DocumentFile::query()->count());
        $this->assertSame([], Storage::disk('local')->allFiles());
        $this->assertTrue(DocumentSourceAuditEvent::query()->where('event', DocumentSourceAuditEvent::REJECTED)->exists());
    }

    /** @test */
    public function the_database_replay_constraint_rejects_a_competing_receipt_and_review_list_exposes_only_masked_source_data(): void
    {
        $fixture = $this->authorizedFixture('channel-projection');
        $identity = $this->identity($fixture['owner'], 'web-connector-08');
        $accepted = app(WebDocumentSourceConnector::class)->receive(
            $this->envelope($identity, $fixture['owner'], 'message-projection-008', $this->image('projection.png')),
        );

        try {
            DocumentSourceReceiptRecord::create([
                'document_channel_identity_id' => $identity->id,
                'channel' => 'web',
                'external_reference_fingerprint' => DocumentSourceEnvelope::fingerprint('message-projection-008'),
                'external_reference_masked' => 'mess…-008',
                'content_sha256' => $accepted->file->sha256,
                'document_batch_id' => $accepted->batch->id,
                'document_file_id' => $accepted->file->id,
                'received_by' => $fixture['owner']->id,
                'received_at' => now('UTC'),
            ]);
            $this->fail('يلزم أن يمنع القيد الفريد receipt منافساً للمرجع نفسه.');
        } catch (QueryException) {
            $this->assertSame(1, DocumentSourceReceiptRecord::query()->count());
        }

        $this->withToken($fixture['token'])->getJson('/api/document-batches?channel=web')
            ->assertOk()
            ->assertJsonPath('data.0.id', $accepted->batch->id)
            ->assertJsonPath('data.0.source.channel', 'web')
            ->assertJsonPath('data.0.source.identity_name', 'قناة ويب اختبارية')
            ->assertJsonMissingPath('data.0.source.external_identity_fingerprint')
            ->assertJsonMissingPath('data.0.source.content_sha256')
            ->assertJsonMissingPath('data.0.source.object_key');
    }

    /** @return array{tenant_id:string,token:string,owner:User,branch:Branch} */
    private function authorizedFixture(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        app(TenantContext::class)->set($auth['tenant_id']);
        $branch = Branch::query()->firstOrFail();
        app(BranchContext::class)->set($branch->id);
        $tenant = Tenant::findOrFail($auth['tenant_id']);
        app(EntitlementGrantService::class)->grant(
            $tenant,
            'document_center.core',
            EntitlementAccessMode::FULL,
            EntitlementSourceType::ADDON,
            now('UTC')->subMinute(),
            null,
            'document-channel-pr11-test',
            (string) Str::uuid(),
        );

        return [
            ...$auth,
            'owner' => User::where('tenant_id', $auth['tenant_id'])->firstOrFail(),
            'branch' => $branch,
        ];
    }

    private function identity(User $actor, string $externalIdentity): DocumentChannelIdentity
    {
        return app(DocumentChannelIdentityService::class)->create(
            $actor,
            DocumentSourceChannel::WEB,
            'قناة ويب اختبارية',
            $externalIdentity,
            ['message_kind' => 'internal-test'],
        );
    }

    private function envelope(DocumentChannelIdentity $identity, User $actor, string $reference, UploadedFile $file): DocumentSourceEnvelope
    {
        return DocumentSourceEnvelope::fromResolvedIdentity(
            $identity,
            $actor,
            DocumentSourceChannel::WEB,
            'purchase_invoice',
            $reference,
            $file,
            ['source_label' => 'test-source', 'labels' => ['locale' => 'ar']],
        );
    }

    private function image(string $name): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, $this->png);
    }

    private function otherImage(string $name): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, $this->otherPng);
    }

    private function capture(callable $callback): DocumentSourceException
    {
        try {
            $callback();
        } catch (DocumentSourceException $exception) {
            return $exception;
        }

        $this->fail('كان متوقعاً أن يرفض عقد القناة هذا الإدخال.');
    }
}
