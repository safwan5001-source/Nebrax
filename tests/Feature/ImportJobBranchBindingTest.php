<?php

namespace Tests\Feature;

use App\Models\ImportJob;
use App\Models\Product;
use App\Models\User;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * IMP-H1-S3a — فرع التشغيلة الدائمة ثابتٌ بعد الإنشاء.
 *
 * قبل هذه الشريحة كان الفرع يُؤخذ من الطلب الحالي عند كل قطعة ترحيل (F-15): تشغيلةٌ فُحصت في فرعٍ تُرحَّل في فرعٍ آخر
 * لو تغيّرت ترويسة `X-Branch-Id` بين الاستدعاءات، فتُوسَم المنتجات (BranchScoped) بغير فرع صاحب التشغيلة.
 */
class ImportJobBranchBindingTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    private function csv(string $sku): UploadedFile
    {
        return UploadedFile::fake()->createWithContent('catalog.csv', "sku,name,type,sale_price\n{$sku},منتج {$sku},good,10.00\n");
    }

    private function branch(string $token, string $name): string
    {
        return $this->withToken($token)->postJson('/api/branches', ['name' => $name])->assertCreated()['data']['id'];
    }

    /** نفس المستخدم/الفرع الرئيسي الافتراضي بعد تنظيف ترويسة الفرع وسياقه. */
    private function mainBranchRequestState(): void
    {
        $this->withoutHeader('X-Branch-Id');
        app(BranchContext::class)->forget();
    }

    private function create(string $token, UploadedFile $file, array $extra = [], array $headers = [])
    {
        return $this->withToken($token)->withHeaders($headers)->post('/api/import-jobs', array_merge([
            'domain' => 'product_catalog',
            'file' => $file,
        ], $extra), ['Accept' => 'application/json']);
    }

    private function apply(string $token, string $id, array $headers = [])
    {
        return $this->withToken($token)->withHeaders($headers)->postJson("/api/import-jobs/{$id}/apply", ['mode' => 'create']);
    }

    /** @test */
    public function a_new_job_records_the_active_branch_and_exposes_it(): void
    {
        $auth = $this->registerTenant();
        $other = $this->branch($auth['token'], 'فرع الخبر');

        $inOther = $this->create($auth['token'], $this->csv('BR-A'), [], ['X-Branch-Id' => $other])->assertCreated();
        $this->assertSame($other, $inOther['data']['branch_id']);
        $this->assertSame($other, ImportJob::query()->whereKey($inOther['data']['id'])->value('branch_id'));

        $this->mainBranchRequestState();
        $inMain = $this->create($auth['token'], $this->csv('BR-B'))->assertCreated();
        $this->assertNotNull($inMain['data']['branch_id']);
        $this->assertNotSame($other, $inMain['data']['branch_id']);
    }

    /** @test */
    public function apply_uses_the_job_branch_not_the_branch_active_on_the_apply_request(): void
    {
        $auth = $this->registerTenant();
        $other = $this->branch($auth['token'], 'فرع الخبر');

        $this->mainBranchRequestState();
        $jobId = $this->create($auth['token'], $this->csv('BR-MAIN'))->assertCreated()['data']['id'];
        $mainBranch = ImportJob::query()->whereKey($jobId)->value('branch_id');

        // نرحّل والفرع النشط للطلب فرعٌ آخر.
        $this->apply($auth['token'], $jobId, ['X-Branch-Id' => $other])->assertOk()->assertJsonPath('data.status', 'completed');

        $product = Product::withoutGlobalScopes()->where('sku', 'BR-MAIN')->firstOrFail();
        $this->assertSame($mainBranch, $product->branch_id, 'المنتج يُوسَم بفرع التشغيلة لا بفرع طلب الترحيل.');
        $this->assertNotSame($other, $product->branch_id);
    }

    /** @test */
    public function the_request_branch_context_is_restored_after_a_chunk(): void
    {
        $auth = $this->registerTenant();
        $other = $this->branch($auth['token'], 'فرع الخبر');
        $this->mainBranchRequestState();
        $jobId = $this->create($auth['token'], $this->csv('BR-RESTORE'))->assertCreated()['data']['id'];

        $this->apply($auth['token'], $jobId, ['X-Branch-Id' => $other])->assertOk();

        $this->assertSame($other, app(BranchContext::class)->id(), 'سياق فرع الطلب يعود كما كان بعد القطعة.');
    }

    /** @test */
    public function a_user_without_access_to_the_job_branch_cannot_apply_or_cancel_it(): void
    {
        $auth = $this->registerTenant();
        $other = $this->branch($auth['token'], 'فرع الخبر');
        $this->mainBranchRequestState();
        $jobId = $this->create($auth['token'], $this->csv('BR-FENCE'))->assertCreated()['data']['id'];

        // مدير مقيَّد بفرع الخبر وحده.
        $token = $this->tokenForRole($auth['tenant_id'], 'admin', 'restricted@branch-fence.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        User::query()->where('email', 'restricted@branch-fence.test')->firstOrFail()->branches()->sync([$other]);
        $this->mainBranchRequestState();

        $this->apply($token, $jobId, ['X-Branch-Id' => $other])->assertForbidden();
        $this->withToken($token)->withHeaders(['X-Branch-Id' => $other])->postJson("/api/import-jobs/{$jobId}/cancel")->assertForbidden();
        $this->assertSame(0, Product::withoutGlobalScopes()->where('sku', 'BR-FENCE')->count());
        $this->assertSame('ready', ImportJob::query()->whereKey($jobId)->value('status'));
    }

    /** @test */
    public function an_idempotency_key_reused_in_another_branch_is_rejected(): void
    {
        $auth = $this->registerTenant();
        $other = $this->branch($auth['token'], 'فرع الخبر');
        $this->mainBranchRequestState();

        $this->create($auth['token'], $this->csv('BR-IDEM'), ['idempotency_key' => 'branch-idem-1'])->assertCreated();
        // نفس الملف والمجال والمفتاح، فرعٌ مختلف ⇒ ليس إعادة محاولة.
        $this->create($auth['token'], $this->csv('BR-IDEM'), ['idempotency_key' => 'branch-idem-1'], ['X-Branch-Id' => $other])->assertStatus(422);
        $this->assertSame(1, ImportJob::query()->where('idempotency_key', 'branch-idem-1')->count());

        // وإعادة المحاولة الحقيقية (نفس الفرع) تُعيد التشغيلة نفسها.
        $this->mainBranchRequestState();
        $this->create($auth['token'], $this->csv('BR-IDEM'), ['idempotency_key' => 'branch-idem-1'])->assertOk();
    }

    /** @test */
    public function a_legacy_job_without_a_branch_keeps_the_old_behaviour(): void
    {
        $auth = $this->registerTenant();
        $other = $this->branch($auth['token'], 'فرع الخبر');
        $this->mainBranchRequestState();
        $jobId = $this->create($auth['token'], $this->csv('BR-LEGACY'))->assertCreated()['data']['id'];
        ImportJob::query()->whereKey($jobId)->update(['branch_id' => null]);

        $this->apply($auth['token'], $jobId, ['X-Branch-Id' => $other])->assertOk();

        $this->assertSame($other, Product::withoutGlobalScopes()->where('sku', 'BR-LEGACY')->value('branch_id'));
    }
}
