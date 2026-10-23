<?php

namespace Tests\Feature;

use App\Models\AiAction;
use App\Models\AiActionExecution;
use App\Models\AiActionExecutionImage;
use App\Models\AiActionExecutionRow;
use App\Models\PlatformAdministrator;
use App\Models\Product;
use App\Models\ProductMedia;
use App\Services\AiActionControlService;
use App\Services\AiActionRegistry;
use App\Services\AiActionsAccessResolver;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;
use ZipArchive;

/**
 * IMP-X-01b — الإيقاف أثناء التنفيذ يسري خلال **كتابة** واحدة (صف أو صورة)، ولا يترك استيراداً مكتملاً «قيد التشغيل»، ويحرّر الاستئجار، ويسري كذلك على
 * سحب موافقة المالك والمسار `retry`؛ وبوابة النشر المغلقة لا تضيف استعلاماً واحداً.
 */
class AiActionControlInFlightStopTest extends TestCase
{
    use InteractsWithAiProductActions;
    use InteractsWithApi;
    use InteractsWithWebhooks;
    use RefreshDatabase;

    private const TYPE = AiActionRegistry::PRODUCT_IMPORT;

    private PlatformAdministrator $admin;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        config(['document_center.storage.driver' => 'local', 'document_center.storage.disk' => 'local', 'ai_actions.runtime_controls_enforced' => true]);
        $this->admin = PlatformAdministrator::create(['name' => 'مدير', 'email' => 'stop@platform.test', 'password' => 'secret-password-1', 'is_active' => true]);
    }

    private function control(): AiActionControlService
    {
        return app(AiActionControlService::class);
    }

    private function grantAll(string $tenant): void
    {
        foreach (['use', 'execution'] as $capability) {
            $this->control()->setPlatformState($this->admin, '*', $capability, true, 'مفتاح رئيسي للاختبار');
            $this->control()->setPlatformState($this->admin, self::TYPE, $capability, true, 'توفّر النوع للاختبار');
            $this->control()->setTenantState($this->admin, $tenant, self::TYPE, $capability, true, 'منحة المستأجر للاختبار');
        }
        app(TenantContext::class)->set($tenant);
        Settings::put('ai_actions', ['execution_approved' => true]);
    }

    private function png(int $rgb): string
    {
        $image = imagecreatetruecolor(8, 8);
        imagefill($image, 0, 0, $rgb);
        ob_start();
        imagepng($image);

        return (string) ob_get_clean();
    }

    /** @param array<string,string> $entries */
    private function zip(array $entries): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'ai-stop-test-');
        $zip = new ZipArchive();
        $zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE);
        foreach ($entries as $entry => $bytes) {
            $zip->addFromString($entry, $bytes);
        }
        $zip->close();

        return new UploadedFile($path, 'images.zip', 'application/zip', null, true);
    }

    /** @param array<string,string> $images @return array{0:string,1:array<string,mixed>} */
    private function approved(array $auth, array $rows, array $images = [], string $key = 'stop-act-0001'): array
    {
        $id = $this->makeAction($auth, $rows, $key);
        if ($images !== []) {
            $this->withToken($auth['token'])->withHeader('Idempotency-Key', $key.'-zip')
                ->post("/api/ai-actions/{$id}/image-archives", ['expected_version' => 1, 'archive' => $this->zip($images)], ['Accept' => 'application/json'])->assertCreated();
        }
        $preview = $this->preview($auth['token'], $id, 1, $key.'-pv')->assertCreated()->json('data');
        $this->approve($auth['token'], $id, $preview, 1, $key.'-ap')->assertCreated();

        return [$id, $preview];
    }

    private function execute(string $token, string $id, string $key)
    {
        return $this->withToken($token)->withHeader('Idempotency-Key', $key)->postJson("/api/ai-actions/{$id}/executions", ['expected_version' => 1]);
    }

    /** @test */
    public function a_stop_during_image_attachment_takes_effect_before_the_next_image(): void
    {
        $auth = $this->registerTenant();
        $this->enable($auth['tenant_id']);
        $this->grantAll($auth['tenant_id']);
        [$id] = $this->approved($auth, [$this->good('a', 2, 'STOP-IMG')], ['STOP-IMG.png' => $this->png(0xFF0000), 'STOP-IMG__2.png' => $this->png(0x00FF00), 'STOP-IMG__3.png' => $this->png(0x0000FF)]);

        $stopped = false;
        ProductMedia::created(function () use (&$stopped): void {
            if (! $stopped) {
                $stopped = true;
                $this->control()->setPlatformState($this->admin, '*', 'execution', false, 'إيقاف طارئ أثناء الصور');
            }
        });

        $this->execute($auth['token'], $id, 'stop-img-0001')->assertForbidden()->assertJsonPath('error.code', 'execution_platform_off');

        $this->assertSame(1, ProductMedia::withoutGlobalScopes()->count(), 'صورة واحدة فقط قبل الإيقاف');
        $this->assertSame(2, AiActionExecutionImage::withoutGlobalScopes()->where('status', AiActionExecutionImage::STATUS_PENDING)->count());
        $execution = AiActionExecution::query()->withoutGlobalScopes()->firstOrFail();
        $this->assertSame(AiActionExecution::STATUS_RUNNING, $execution->status);
        $this->assertNull($execution->claim_token);

        // رفع الإيقاف يُكمل الصورتين المتبقيتين دون تكرار.
        $this->control()->setPlatformState($this->admin, '*', 'execution', true, 'رفع الإيقاف');
        $this->execute($auth['token'], $id, 'stop-img-0002')->assertSuccessful();
        $this->assertSame(3, ProductMedia::withoutGlobalScopes()->count());
        $this->assertSame(AiActionExecution::STATUS_COMPLETED, $execution->fresh()->status);
    }

    /** @test */
    public function a_stop_after_the_last_write_still_finalises_the_execution_instead_of_leaving_it_running(): void
    {
        $auth = $this->registerTenant();
        $this->enable($auth['tenant_id']);
        $this->grantAll($auth['tenant_id']);
        [$id] = $this->approved($auth, [$this->good('a', 2, 'STOP-LAST')]);

        $stopped = false;
        Product::created(function () use (&$stopped): void {
            if (! $stopped) {
                $stopped = true;
                $this->control()->setPlatformState($this->admin, '*', 'execution', false, 'إيقاف بعد آخر كتابة');
            }
        });

        // لا كتابة بعد المنتج الوحيد: لا شيء يُمنَع، فيكتمل التنفيذ ولا يبقى معلّقاً.
        $this->execute($auth['token'], $id, 'stop-last-0001')->assertSuccessful();

        $this->assertSame(1, Product::withoutGlobalScopes()->count());
        $this->assertSame(AiActionExecution::STATUS_COMPLETED, AiActionExecution::query()->withoutGlobalScopes()->firstOrFail()->status);
        $this->assertSame(AiAction::STATUS_EXECUTED, AiAction::query()->withoutGlobalScopes()->firstOrFail()->status);
    }

    /** @test */
    public function withdrawing_the_owners_approval_mid_run_stops_the_next_row_and_the_retry_path_is_gated_too(): void
    {
        $auth = $this->registerTenant();
        config(['ai_actions.execution_batch_rows' => 10]);
        $this->enable($auth['tenant_id']);
        $this->grantAll($auth['tenant_id']);
        [$id] = $this->approved($auth, [$this->good('a', 2, 'WD-1'), $this->good('b', 3, 'WD-2')]);

        $withdrawn = false;
        Product::created(function () use (&$withdrawn, $auth): void {
            if (! $withdrawn) {
                $withdrawn = true;
                app(TenantContext::class)->set($auth['tenant_id']);
                Settings::put('ai_actions', ['execution_approved' => false]);
            }
        });

        $this->execute($auth['token'], $id, 'stop-wd-0001')->assertForbidden()->assertJsonPath('error.code', 'tenant_owner_not_approved');
        $this->assertSame(1, Product::withoutGlobalScopes()->count());

        $execution = AiActionExecution::query()->withoutGlobalScopes()->firstOrFail();
        $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'stop-wd-retry')->postJson("/api/ai-actions/{$id}/executions/{$execution->id}/retry")
            ->assertForbidden()->assertJsonPath('error.code', 'tenant_owner_not_approved');
        $this->assertSame(1, AiActionExecutionRow::query()->withoutGlobalScopes()->where('status', AiActionExecutionRow::STATUS_PENDING)->count());
    }

    /** @test */
    public function a_closed_gate_adds_no_query_and_no_error(): void
    {
        config(['ai_actions.runtime_controls_enforced' => false]);
        $resolver = app(AiActionsAccessResolver::class);
        DB::flushQueryLog();
        DB::enableQueryLog();

        $resolver->assertAllowed(null, 'nope.v1', AiActionsAccessResolver::EXECUTION);
        $this->assertNull($resolver->denial((string) \Illuminate\Support\Str::uuid(), self::TYPE, AiActionsAccessResolver::PREVIEW));

        $this->assertSame([], DB::getQueryLog());
        DB::disableQueryLog();
    }
}
