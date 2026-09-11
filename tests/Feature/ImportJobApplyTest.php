<?php

namespace Tests\Feature;

use App\Models\ImportJob;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Product;
use App\Models\StockMovement;
use App\Services\ImportJobService;
use App\Support\ImportJobStatus;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * PR-DUR-2 — محرّك الترحيل المجزّأ/القابل للاستئناف لتشغيلة `product_catalog`
 * وحدها. يعيد استعمال `ProductImportService::apply()` حصراً كحد الطفرة —
 * الاختبارات هنا تثبت التسلسل عبر القطع، الاستئناف من مؤشّر دائم بعد انقطاع،
 * عدم التكرار عند إعادة محاولة قطعة مكتملة أو متزامنة، الفشل المغلَق على
 * مجال/حالة خاطئة، وصِفر أثرٍ مخزنيّ أو محاسبيّ.
 */
class ImportJobApplyTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** مستأجر اختبار القفل — يُنشأ خارج معاملة الاختبار عبر اتصالٍ منفصل، فيُنظَّف يدوياً. */
    protected ?string $lockTestTenantId = null;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    protected function tearDown(): void
    {
        $tenantId = $this->lockTestTenantId;
        parent::tearDown();

        if ($tenantId !== null) {
            DB::connection('rival')->table('import_jobs')->where('tenant_id', $tenantId)->delete();
            DB::connection('rival')->table('tenants')->where('id', $tenantId)->delete();
            DB::connection('rival')->disconnect();
        }
    }

    private function csv(int $rows): UploadedFile
    {
        $lines = ["sku,name,type,sale_price"];
        for ($i = 1; $i <= $rows; $i++) {
            $lines[] = "SKU-{$i},منتج رقم {$i},good,100.00";
        }

        return UploadedFile::fake()->createWithContent('catalog.csv', implode("\n", $lines)."\n");
    }

    /**
     * ملفٌ فيه صفّان صالحان (SKU-1، SKU-2) وثلاثة صفوف فارغة: واحد متخلّل
     * بينهما، واثنان متذيّلان — لاختبار تصحيح مراجعة PR-DUR-2 (Finding 1):
     * صفّ فيزيائي = ٥، صفّ بيانات فعلي = ٢.
     */
    private function csvWithBlankRows(): UploadedFile
    {
        $lines = [
            'sku,name,type,sale_price',
            'SKU-1,منتج رقم 1,good,100.00',
            ',,,',
            'SKU-2,منتج رقم 2,good,100.00',
            ',,,',
            ',,,',
        ];

        return UploadedFile::fake()->createWithContent('catalog-with-blanks.csv', implode("\n", $lines)."\n");
    }

    private function createReadyJob(string $token, int $rows): string
    {
        return $this->withToken($token)
            ->post('/api/import-jobs', ['domain' => 'product_catalog', 'file' => $this->csv($rows)])
            ->assertCreated()
            ->assertJsonPath('data.status', ImportJobStatus::READY)
            ->json('data.id');
    }

    /** @test */
    public function first_apply_processes_chunks_and_completes(): void
    {
        $auth = $this->registerTenant();
        $jobId = $this->createReadyJob($auth['token'], 3);

        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['batch_size' => 1])
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::PROCESSING)
            ->assertJsonPath('data.processed_rows', 1);

        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['batch_size' => 1])
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::PROCESSING)
            ->assertJsonPath('data.processed_rows', 2);

        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['batch_size' => 1])
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::COMPLETED)
            ->assertJsonPath('data.processed_rows', 3);

        $this->assertSame(3, Product::count());
        $this->assertNotNull(ImportJob::findOrFail($jobId)->finished_at);
    }

    /** @test */
    public function an_interrupted_first_chunk_leaves_no_partial_state_and_a_retry_completes_cleanly(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $jobId = $this->createReadyJob($auth['token'], 2);

        // يحاكي انقطاع العملية بعد قفل الصفّ ومحاولة تجميد الخيارات، وقبل أي
        // التزام — استثناءٌ يُطلَق مرّةً واحدة فقط أثناء حفظ هذه التشغيلة
        // تحديداً، فيتراجع `DB::transaction()` عن كل شيء تلقائياً.
        ImportJob::saving(function ($model) use ($jobId) {
            static $fired = false;
            if ($fired || $model->id !== $jobId) {
                return;
            }
            $fired = true;

            throw new \RuntimeException('محاكاة انقطاع العملية قبل الالتزام.');
        });

        $service = app(ImportJobService::class);
        $job = ImportJob::findOrFail($jobId);

        $crashed = false;
        try {
            $service->applyNextChunk($job, [], null, true);
        } catch (\Throwable $e) {
            $crashed = true;
        }
        $this->assertTrue($crashed, 'الانقطاع المحاكى يجب أن يظهر كاستثناء لهذه المحاولة.');

        $job->refresh();
        $this->assertSame(ImportJobStatus::READY, $job->status, 'انقطاعٌ قبل الالتزام لا يجب أن يترك حالة معلَّقة.');
        $this->assertSame(0, $job->processed_rows);
        $this->assertNull($job->apply_options);
        $this->assertSame(0, Product::count());

        // إعادة المحاولة (الاستئناف) من نفس المؤشّر الدائم (صفر) تنجح كاملةً.
        $result = $service->applyNextChunk($job->fresh(), [], null, true);
        $this->assertSame(ImportJobStatus::COMPLETED, $result->status);
        $this->assertSame(2, $result->processed_rows);
        $this->assertSame(2, Product::count(), 'لا أثر مضاعف بعد الاستئناف.');
    }

    /** @test */
    public function retrying_a_completed_job_is_idempotent_and_creates_nothing_twice(): void
    {
        $auth = $this->registerTenant();
        $jobId = $this->createReadyJob($auth['token'], 2);

        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply")
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::COMPLETED);

        $this->assertSame(2, Product::count());

        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply")
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::COMPLETED)
            ->assertJsonPath('data.processed_rows', 2);

        $this->assertSame(2, Product::count(), 'إعادة محاولة تشغيلة مكتملة لا تنشئ شيئاً ثانيةً.');
    }

    /**
     * قفلٌ حقيقيّ على صفّ التشغيلة يُختبر على PostgreSQL فقط — اتصالٌ منفصل
     * فعلياً (نفس اصطلاح `DocumentNumberingTest`/`ImportJobTest`) يحاول
     * `SELECT ... FOR UPDATE` على نفس الصفّ أثناء إمساك معاملتنا بالقفل؛
     * `lock_timeout` قصير يجعله يفشل حتماً بدل التجمّد، مثبتاً أن القفل حقيقيٌّ
     * لا افتراضاً. SQLite يُسلسِل الكتابات بقفلٍ عامّ على مستوى الملف فلا
     * يختبر نفس الشيء.
     */
    /** @test */
    public function a_concurrent_apply_attempt_is_blocked_by_a_real_row_lock(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('قفل الصفّ الحقيقي يُختبر على PostgreSQL فقط.');
        }

        // التشغيلة والمستأجر يُنشآن عبر اتصالٍ منفصل فعلياً ملتزَم فوراً (لا
        // معاملة الاختبار المغلَّفة) — تماماً كاصطلاح `DocumentNumberingTest`/
        // `ImportJobTest::concurrent_duplicate_creation_...`: صفٌّ يعيش داخل
        // معاملة اختبارنا غير مرئيٍّ أصلاً لاتصالٍ آخر، فلا معنى لمحاولة قفله.
        config(['database.connections.rival' => config('database.connections.pgsql')]);
        $rival = DB::connection('rival');
        $rival->statement("SET lock_timeout = '200ms'");

        $tenantId = (string) Str::uuid();
        $rival->table('tenants')->insert([
            'id' => $tenantId,
            'name' => 'مستأجر قفل الترحيل',
            'slug' => 'lock-' . substr($tenantId, 0, 8),
            'currency' => 'SAR',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->lockTestTenantId = $tenantId;

        $file = $this->csv(2);
        $contents = file_get_contents($file->getRealPath());
        $sha256 = hash('sha256', $contents);
        $jobId = (string) Str::uuid();
        $storagePath = "imports/{$tenantId}/{$jobId}/original.csv";
        Storage::disk('local')->put($storagePath, $contents);

        $rival->table('import_jobs')->insert([
            'id' => $jobId,
            'tenant_id' => $tenantId,
            'domain' => 'product_catalog',
            'status' => ImportJobStatus::READY,
            'original_filename' => 'catalog.csv',
            'extension' => 'csv',
            'mime_type' => 'text/csv',
            'byte_size' => strlen($contents),
            'storage_disk' => 'local',
            'storage_path' => $storagePath,
            'content_sha256' => $sha256,
            'row_count' => 2,
            'column_count' => 4,
            'processed_rows' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $blocked = false;

        ImportJob::saving(function ($model) use ($jobId, $rival, &$blocked) {
            static $fired = false;
            if ($fired || $model->id !== $jobId) {
                return;
            }
            $fired = true;

            try {
                $rival->select('select * from import_jobs where id = ? for update', [$jobId]);
            } catch (\Throwable $e) {
                $blocked = true;
            }
        });

        $token = $this->tokenForRole($tenantId, 'owner', 'owner@lock.test');

        $this->withToken($token)
            ->postJson("/api/import-jobs/{$jobId}/apply")
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::COMPLETED);

        $this->assertTrue($blocked, 'اتصالٌ آخر يجب أن يُمنع من قراءة نفس الصفّ FOR UPDATE أثناء ترحيل القطعة.');
        $this->assertSame(2, Product::withoutGlobalScopes()->where('tenant_id', $tenantId)->count(), 'لا تكرار رغم محاولة القراءة المتزامنة.');
    }

    /** @test */
    public function apply_cannot_be_called_from_another_tenant(): void
    {
        $authA = $this->registerTenant('tenant-a', 'owner@a.test');
        $authB = $this->registerTenant('tenant-b', 'owner@b.test');

        $jobId = $this->createReadyJob($authA['token'], 2);

        $this->withToken($authB['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply")
            ->assertNotFound();

        $this->assertSame(0, Product::withoutGlobalScopes()->count());
    }

    /** @test */
    public function apply_fails_closed_on_a_cancelled_job(): void
    {
        $auth = $this->registerTenant();
        $jobId = $this->createReadyJob($auth['token'], 2);

        $this->withToken($auth['token'])->postJson("/api/import-jobs/{$jobId}/cancel")->assertOk();

        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply")
            ->assertStatus(422);

        $this->assertSame(0, Product::count());
    }

    /** @test */
    public function apply_fails_closed_on_a_domain_with_no_apply_engine(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $service = app(ImportJobService::class);
        $job = $service->create($this->csv(2), 'product_catalog', null, null);
        $job->forceFill(['domain' => 'a_future_domain'])->save();

        $this->expectException(\RuntimeException::class);
        $service->applyNextChunk($job, [], null, true);
    }

    /** @test */
    public function completed_apply_creates_zero_inventory_or_ledger_effect(): void
    {
        $auth = $this->registerTenant();
        $jobId = $this->createReadyJob($auth['token'], 2);

        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply")
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::COMPLETED);

        $this->assertSame(2, Product::count());
        $this->assertSame(0, StockMovement::count());
        $this->assertSame(0, JournalEntry::count());
        $this->assertSame(0, JournalLine::count());

        foreach (Product::all() as $product) {
            $this->assertSame(0, (int) $product->quantity_on_hand);
            $this->assertSame(0, (int) $product->avg_cost);
        }
    }

    /**
     * تصحيح مراجعة PR-DUR-2 (Finding 1 — BLOCKER): صفّ فارغ متخلّل بين
     * صفّين صالحين، وصفّان فارغان متذيّلان. `row_count` يجب أن يعدّ صفّي
     * البيانات فقط (٢) لا الصفوف الفيزيائية الخمسة، وحجم دُفعة ١ يجب أن
     * يعالج صفّاً واحداً حقيقياً في كل استدعاء بلا التوقّف عند الفراغات ولا
     * أثرٍ مضاعف، وينتهي بحالة `completed` لا `failed`.
     */
    /** @test */
    public function blank_rows_are_excluded_from_row_count_and_do_not_block_completion(): void
    {
        $auth = $this->registerTenant();

        $jobId = $this->withToken($auth['token'])
            ->post('/api/import-jobs', ['domain' => 'product_catalog', 'file' => $this->csvWithBlankRows()])
            ->assertCreated()
            ->assertJsonPath('data.status', ImportJobStatus::READY)
            ->assertJsonPath('data.row_count', 2)
            ->json('data.id');

        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['batch_size' => 1])
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::PROCESSING)
            ->assertJsonPath('data.processed_rows', 1);

        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['batch_size' => 1])
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::COMPLETED)
            ->assertJsonPath('data.processed_rows', 2);

        $this->assertSame(2, Product::count(), 'الصفوف الفارغة لا تُنشئ منتجات، والصفّان الحقيقيّان يُطبَّقان مرّةً واحدة فقط.');
        $this->assertSame(['SKU-1', 'SKU-2'], Product::orderBy('sku')->pluck('sku')->all());

        // إعادة محاولة بعد الاكتمال idempotent — لا استدعاء ثانٍ لـ
        // `ProductImportService::apply()` ولا أثر مضاعف.
        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['batch_size' => 1])
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::COMPLETED)
            ->assertJsonPath('data.processed_rows', 2);

        $this->assertSame(2, Product::count());
    }

    /** @test */
    public function multiple_and_trailing_blank_rows_complete_in_a_single_default_size_call(): void
    {
        $auth = $this->registerTenant();
        $jobId = $this->withToken($auth['token'])
            ->post('/api/import-jobs', ['domain' => 'product_catalog', 'file' => $this->csvWithBlankRows()])
            ->assertCreated()
            ->json('data.id');

        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply")
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::COMPLETED)
            ->assertJsonPath('data.processed_rows', 2);

        $this->assertSame(2, Product::count());
    }

    /**
     * توافق رجعي: تشغيلة PR-DUR-1 أُنشئت قبل تصحيح هذه المراجعة تحمل
     * `row_count` بالحساب الفيزيائي القديم (٥ يشمل الصفوف الفارغة). أول
     * استدعاء `/apply` يصحّح `row_count` ذاتياً (٢) قبل أن يعتمد عليه
     * الاكتمال، فتكتمل التشغيلة بدل أن تعلَق أو تفشل.
     */
    /** @test */
    public function a_stale_pre_fix_physical_row_count_self_heals_on_first_apply(): void
    {
        $auth = $this->registerTenant();
        $tenantId = $auth['tenant_id'];

        $file = $this->csvWithBlankRows();
        $contents = file_get_contents($file->getRealPath());
        $sha256 = hash('sha256', $contents);
        $jobId = (string) Str::uuid();
        $storagePath = "imports/{$tenantId}/{$jobId}/original.csv";
        Storage::disk('local')->put($storagePath, $contents);

        DB::table('import_jobs')->insert([
            'id' => $jobId,
            'tenant_id' => $tenantId,
            'domain' => 'product_catalog',
            'status' => ImportJobStatus::READY,
            'original_filename' => 'catalog-with-blanks.csv',
            'extension' => 'csv',
            'mime_type' => 'text/csv',
            'byte_size' => strlen($contents),
            'storage_disk' => 'local',
            'storage_path' => $storagePath,
            'content_sha256' => $sha256,
            'row_count' => 5, // الحساب الفيزيائي القديم قبل هذا التصحيح.
            'column_count' => 4,
            'processed_rows' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply")
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::COMPLETED)
            ->assertJsonPath('data.processed_rows', 2)
            ->assertJsonPath('data.row_count', 2);

        $this->assertSame(2, Product::count());
    }

    /**
     * تصحيح مراجعة PR-DUR-2 (Finding 2 — P2): `batch_size` جزءٌ من
     * `apply_options` المجمَّدة عند أول قطعة — تماماً كبقية الخيارات
     * الدلالية (mode/blank_policy/master_data_policy/mapping). استدعاءٌ
     * لاحقٌ بقيمة مختلفة يُتجاهَل ولا يغيّر حجم القطع المتبقّية.
     */
    /** @test */
    public function batch_size_is_frozen_from_the_first_apply_call_and_later_requests_cannot_change_it(): void
    {
        $auth = $this->registerTenant();
        $jobId = $this->createReadyJob($auth['token'], 3);

        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['batch_size' => 1])
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::PROCESSING)
            ->assertJsonPath('data.processed_rows', 1);

        // استدعاءٌ لاحقٌ بـ batch_size=100 يُتجاهَل: القيمة المجمَّدة (١) من
        // أول استدعاء هي التي تحكم حجم كل قطعة تالية طوال عمر التشغيلة.
        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['batch_size' => 100])
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::PROCESSING)
            ->assertJsonPath('data.processed_rows', 2);

        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['batch_size' => 100])
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::COMPLETED)
            ->assertJsonPath('data.processed_rows', 3);

        $this->assertSame(3, Product::count());
    }

    /**
     * PR-DUR-HARDEN-1 — الملف يتجاوز سقف الاستيراد المتزامن القديم (٢٠٠٠
     * صفّ) لكنه دون `DURABLE_MAX_ROWS` الجديد (٢٠٠٠٠) الخاص بالمحرّك الدائم
     * وحده. صفوفٌ فارغة تتخلّل حول حاجز الـ٢٠٠٠ القديم تحديداً (لا حول حدود
     * القطعة العادية فقط) لإثبات أن الرفع الجديد لا يفقد ولا يكرّر صفّاً عند
     * هذا الحاجز بالذات.
     */
    private function csvBeyondLegacyLimit(int $rows): UploadedFile
    {
        $lines = ['sku,name,type,sale_price'];
        for ($i = 1; $i <= $rows; $i++) {
            $lines[] = "SKU-{$i},منتج رقم {$i},good,100.00";
            // صفّان فارغان متخلّلان حول حاجز الـ٢٠٠٠ الصفّي القديم تحديداً.
            if ($i === 1999 || $i === 2000) {
                $lines[] = ',,,';
            }
        }

        return UploadedFile::fake()->createWithContent('large-catalog.csv', implode("\n", $lines)."\n");
    }

    /** @test */
    public function a_durable_upload_beyond_the_legacy_row_limit_is_accepted_and_completes_without_loss_or_duplication(): void
    {
        $auth = $this->registerTenant();
        $rows = 2200;

        $jobId = $this->withToken($auth['token'])
            ->post('/api/import-jobs', ['domain' => 'product_catalog', 'file' => $this->csvBeyondLegacyLimit($rows)])
            ->assertCreated()
            ->assertJsonPath('data.status', ImportJobStatus::READY)
            ->assertJsonPath('data.row_count', $rows)
            ->json('data.id');

        $status = null;
        $iterations = 0;
        do {
            $iterations++;
            $this->assertLessThan(200, $iterations, 'يجب أن تكتمل التشغيلة خلال عدد قطعٍ معقول.');
            $response = $this->withToken($auth['token'])->postJson("/api/import-jobs/{$jobId}/apply")->assertOk();
            $status = $response->json('data.status');
        } while ($status !== ImportJobStatus::COMPLETED);

        $this->assertSame($rows, Product::count(), 'كل الصفوف الصالحة تُطبَّق مرّةً واحدة فقط — لا فقدان ولا تكرار حول الحاجز القديم.');
        // أول صفّ، وصفّان قبل/بعد حاجز الـ٢٠٠٠ القديم مباشرةً، وآخر صفّ.
        foreach ([1, 1999, 2000, 2001, 2200] as $index) {
            $this->assertNotNull(Product::where('sku', "SKU-{$index}")->first(), "SKU-{$index} يجب أن يكون قد استُورد.");
        }

        $this->assertSame(0, StockMovement::count());
        $this->assertSame(0, JournalEntry::count());
        $this->assertSame(0, JournalLine::count());
    }

    /**
     * العكس: ملفٌ يتجاوز حتى `DURABLE_MAX_ROWS` نفسها — السقف الجديد أعلى
     * لكنه ليس معدوماً. الفشل هنا فشل فحصٍ هيكلي (كحال تجاوز سقف الأعمدة
     * في `ImportJobTest`) — تشغيلةٌ تُنشأ بحالة `failed` لا رفض ٤٢٢ للطلب،
     * لأن `inspect()` يلتقط الفشل ويسجّله على التشغيلة نفسها للتدقيق.
     */
    /** @test */
    public function a_durable_upload_beyond_the_new_durable_row_limit_fails_the_job_at_inspect(): void
    {
        $auth = $this->registerTenant();

        $response = $this->withToken($auth['token'])
            ->post('/api/import-jobs', ['domain' => 'product_catalog', 'file' => $this->csv(\App\Services\ProductImportService::DURABLE_MAX_ROWS + 1)])
            ->assertCreated()
            ->assertJsonPath('data.status', ImportJobStatus::FAILED);

        $this->assertNotEmpty($response->json('data.error_message'));
        $this->assertSame(0, Product::count());
    }
}
