<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\DocumentBatch;
use App\Models\DocumentFile;
use App\Models\Tenant;
use App\Services\EntitlementGrantService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * اكتُشف في Production (Horizon MEDIA-STORAGE): ربط {batch} الضمني يسبق SetTenant،
 * فيصل مستأجر آخر إلى منطق الخدمة (422 بدل 404) بل يكتب كائناً على التخزين قبل أن
 * يفشل الاستعلام المُقيَّد. هذا الاختبار يحرس ألّا يحدث: 404 قبل أي أثر جانبي.
 */
class DocumentCenterIntakeCrossTenantTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private string $png;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        config()->set('document_center.storage.driver', 'local');
        config()->set('document_center.storage.disk', 'local');
        config()->set('queue.default', 'sync');
        Queue::fake();
        $this->png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', true);
    }

    /** @test */
    public function another_tenant_cannot_upload_into_a_draft_batch_and_nothing_is_written_to_storage(): void
    {
        $a = $this->authorizedTenant('xt-a');
        $b = $this->authorizedTenant('xt-b');
        $batch = $this->as($a['token'])->postJson('/api/document-batches', ['document_type' => 'purchase_invoice'])->assertCreated()->json('data.id');
        $before = Storage::disk('local')->allFiles();

        $this->as($b['token'])->post("/api/document-batches/{$batch}/files", [
            'file' => UploadedFile::fake()->createWithContent('intruder.png', $this->png),
        ], ['Accept' => 'application/json'])->assertNotFound();

        $this->assertSame($before, Storage::disk('local')->allFiles());
        $this->assertSame(0, DocumentFile::withoutGlobalScopes()->where('document_batch_id', $batch)->count());
        $this->assertSame('draft', DocumentBatch::withoutGlobalScopes()->findOrFail($batch)->status->value);
    }

    /** @test */
    public function another_tenant_gets_not_found_not_a_state_error_so_batch_existence_does_not_leak(): void
    {
        $a = $this->authorizedTenant('xt-c');
        $b = $this->authorizedTenant('xt-d');
        $batch = $this->as($a['token'])->postJson('/api/document-batches', ['document_type' => 'purchase_invoice'])->assertCreated()->json('data.id');
        $this->as($a['token'])->post("/api/document-batches/{$batch}/files", [
            'file' => UploadedFile::fake()->createWithContent('own.png', $this->png),
        ], ['Accept' => 'application/json'])->assertCreated();
        $this->as($a['token'])->postJson("/api/document-batches/{$batch}/complete")->assertOk();

        $this->as($b['token'])->post("/api/document-batches/{$batch}/files", [
            'file' => UploadedFile::fake()->createWithContent('intruder.png', $this->png),
        ], ['Accept' => 'application/json'])->assertNotFound();
        $this->as($b['token'])->postJson("/api/document-batches/{$batch}/complete")->assertNotFound();
        $this->as($b['token'])->postJson("/api/document-batches/{$batch}/review-changes", [])->assertNotFound();
        $this->as($b['token'])->postJson("/api/document-batches/{$batch}/assign-reviewer", [])->assertNotFound();
        $this->as($b['token'])->postJson("/api/document-batches/{$batch}/complete-review", [])->assertNotFound();
        $this->as($b['token'])->getJson("/api/document-batches/{$batch}/eligible-reviewers")->assertNotFound();

        $this->assertSame('received', DocumentBatch::withoutGlobalScopes()->findOrFail($batch)->status->value);
    }

    /**
     * Production starts every request with no tenant context, so implicit route binding
     * runs unscoped before `SetTenant`. Tests share one container, so drop any context a
     * previous step left behind; otherwise the lingering tenant would mask the bug.
     */
    private function as(string $token): static
    {
        app(TenantContext::class)->forget();
        app(BranchContext::class)->forget();

        return $this->withToken($token);
    }

    /** @return array{tenant_id:string,token:string,branch_id:string} */
    private function authorizedTenant(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        app(TenantContext::class)->set($auth['tenant_id']);
        $branchId = Branch::query()->where('tenant_id', $auth['tenant_id'])->value('id');
        app(BranchContext::class)->set($branchId);
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($auth['tenant_id']),
            'document_center.core',
            EntitlementAccessMode::FULL,
            EntitlementSourceType::ADDON,
            now('UTC')->subMinute(),
            null,
            'xt-test',
            (string) Str::uuid(),
        );

        return [...$auth, 'branch_id' => $branchId];
    }
}
