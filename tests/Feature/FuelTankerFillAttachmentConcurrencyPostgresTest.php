<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\FuelNozzle;
use App\Models\FuelProduct;
use App\Models\FuelPump;
use App\Models\FuelShift;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\FuelTankerFill;
use App\Models\FuelTankerFillAttachment;
use App\Models\FuelTankerOwner;
use App\Models\User;
use App\Services\FuelStationSettingsService;
use App\Services\FuelTankerFillAttachmentService;
use App\Services\FuelTankerFillException;
use App\Services\FuelTankerFillService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * TANKER-PR5 — مرفقات سندات التعبئة تحت تزامن حقيقي (PostgreSQL + `pcntl_fork`، تخزين محلي حقيقي في مجلد مؤقت):
 *  - المحتوى نفسه من عدة عمليات ⇒ مرفق نشط واحد وملف واحد (idempotency بالمحتوى).
 *  - حد العدد تحت تزامن ملفات مختلفة ⇒ لا يُتجاوز أبداً، والمرفوضة لا تترك ملفات يتيمة.
 *  - إضافة ↔ إلغاء السند، وإضافة ↔ إغلاق الوردية (سياسة المنع)، وإزالة ↔ استبدال: لا جمود، والنتيجة متسقة (الملفات = الصفوف).
 * يُتخطّى على SQLite فقط؛ غياب pcntl على PostgreSQL فشل لا تخطٍّ.
 */
class FuelTankerFillAttachmentConcurrencyPostgresTest extends TestCase
{
    use InteractsWithApi;
    use UsesWorkerDatabaseWithoutTransaction;

    private string $dir;
    private string $disk;

    /** @var list<string> */
    private array $tenants = [];

    protected function setUp(): void
    {
        parent::setUp();
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على الأقفال والفهارس.');
        }
        $this->assertTrue(function_exists('pcntl_fork'), 'pcntl مطلوب لاختبارات تزامن PostgreSQL؛ غيابه فشل لا تخطٍّ.');
        $this->dir = sys_get_temp_dir() . '/fuel_tanker_att_' . uniqid();
        mkdir($this->dir);
        $this->disk = $this->dir . '/disk';
        mkdir($this->disk);
        config(['filesystems.disks.local.root' => $this->disk]);
        app('filesystem')->forgetDisk('local');
    }

    protected function tearDown(): void
    {
        if (isset($this->dir) && is_dir($this->dir)) {
            $this->rrmdir($this->dir);
        }
        if (DB::connection()->getDriverName() === 'pgsql') {
            foreach ($this->tenants as $id) {
                // السندات والمرفقات لا تُحذف مباشرةً؛ حذف المستأجر (المسموح في المُشغّلات) يزيلها مع بقية بياناته.
                DB::table('tenants')->where('id', $id)->delete();
            }
        }
        parent::tearDown();
    }

    private function rrmdir(string $path): void
    {
        foreach (glob($path . '/*') ?: [] as $item) {
            is_dir($item) ? $this->rrmdir($item) : @unlink($item);
        }
        @rmdir($path);
    }

    /** @return list<string> */
    private function filesOnDisk(): array
    {
        $files = [];
        $it = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($this->disk, \FilesystemIterator::SKIP_DOTS));
        foreach ($it as $file) {
            $files[] = $file->getPathname();
        }

        return $files;
    }

    /** @test */
    public function the_same_content_from_many_processes_is_attached_once(): void
    {
        $f = $this->fixture();
        $image = $this->imageFile(300, 200);
        $jobs = [fn () => $this->holdFill($f)];
        foreach (range(1, 8) as $i) {
            $jobs[] = fn () => $this->addFiles($f, [$image]);
        }
        $results = array_slice($this->runConcurrently($jobs), 1);

        $this->assertAllCompleted($results);
        $ids = array_map(fn ($v) => explode(':', $v)[1] ?? $v, array_column($results, 'value'));
        $this->assertCount(1, array_unique($ids), json_encode($results));
        $this->assertSame(1, (int) DB::table('fuel_tanker_fill_attachments')->where('tenant_id', $f['tenant_id'])->count());
        $this->assertCount(1, $this->filesOnDisk(), 'ملف واحد فقط — لا نسخ يتيمة من العمليات الخاسرة');
        $this->assertSame(1, (int) DB::table('fuel_station_audit_events')->where('tenant_id', $f['tenant_id'])->where('action', 'tanker_fill.attachment_added')->count());
    }

    /** @test */
    public function the_count_limit_is_never_exceeded_by_concurrent_distinct_files_and_rejected_ones_leave_no_files(): void
    {
        $f = $this->fixture();
        $this->setPolicy($f, ['tanker_fill_attachment_max_count' => 3]);
        $jobs = [fn () => $this->holdFill($f)];
        foreach (range(1, 6) as $i) {
            $image = $this->imageFile(300 + $i, 200 + $i);
            $jobs[] = fn () => $this->addFiles($f, [$image]);
        }
        $results = array_slice($this->runConcurrently($jobs), 1);

        $this->assertAllCompleted($results);
        $values = array_column($results, 'value');
        $this->assertSame(3, count(array_filter($values, fn ($v) => str_starts_with($v, 'ok:'))), json_encode($values));
        $this->assertSame(3, count(array_filter($values, fn ($v) => $v === 'rejected:attachment_limit_reached')), json_encode($values));
        $this->assertSame(3, (int) DB::table('fuel_tanker_fill_attachments')->where('tenant_id', $f['tenant_id'])->where('status', 'active')->count());
        $this->assertCount(3, $this->filesOnDisk());
    }

    /** @test */
    public function adding_races_with_voiding_the_fill_without_deadlock_and_stays_consistent(): void
    {
        $f = $this->fixture();
        $jobs = [fn () => $this->voidFill($f)];
        foreach (range(1, 4) as $i) {
            $image = $this->imageFile(320 + $i, 210 + $i);
            $jobs[] = fn () => $this->addFiles($f, [$image]);
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $this->assertSame('voided', DB::table('fuel_tanker_fills')->where('id', $f['fill_id'])->value('status'));
        $values = array_column($results, 'value');
        foreach (array_slice($values, 1) as $value) {
            $this->assertTrue(str_starts_with($value, 'ok:') || $value === 'rejected:attachment_add_blocked', $value);
        }
        $rows = (int) DB::table('fuel_tanker_fill_attachments')->where('tenant_id', $f['tenant_id'])->count();
        $this->assertSame(count(array_filter(array_slice($values, 1), fn ($v) => str_starts_with($v, 'ok:'))), $rows);
        $this->assertCount($rows, $this->filesOnDisk(), 'لا ملفات يتيمة ولا صفوف بلا ملفات');
    }

    /** @test */
    public function adding_races_with_the_shift_close_under_the_deny_policy_without_deadlock(): void
    {
        $f = $this->fixture();
        $this->setPolicy($f, ['tanker_fill_attachment_after_close' => 'deny']);
        $jobs = [fn () => $this->closeShift($f)];
        foreach (range(1, 4) as $i) {
            $image = $this->imageFile(340 + $i, 220 + $i);
            $jobs[] = fn () => $this->addFiles($f, [$image]);
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $this->assertSame('closed', DB::table('fuel_shifts')->where('id', $f['shift_id'])->value('status'));
        $values = array_column($results, 'value');
        foreach (array_slice($values, 1) as $value) {
            $this->assertTrue(str_starts_with($value, 'ok:') || $value === 'rejected:attachment_add_blocked', $value);
        }
        $rows = (int) DB::table('fuel_tanker_fill_attachments')->where('tenant_id', $f['tenant_id'])->count();
        $this->assertSame(count(array_filter(array_slice($values, 1), fn ($v) => str_starts_with($v, 'ok:'))), $rows);
        $this->assertCount($rows, $this->filesOnDisk());
    }

    /** @test */
    public function removing_races_with_replacing_the_same_attachment_and_exactly_one_wins(): void
    {
        $f = $this->fixture();
        $original = $this->addFiles($f, [$this->imageFile(360, 240)]);
        $this->assertStringStartsWith('ok:', $original);
        $oldId = explode(':', $original)[1];
        $replacement = $this->imageFile(361, 241);
        $jobs = [
            fn () => $this->holdFill($f),
            fn () => $this->removeAttachment($f, $oldId),
            fn () => $this->replaceAttachment($f, $oldId, $replacement),
            fn () => $this->removeAttachment($f, $oldId),
            fn () => $this->replaceAttachment($f, $oldId, $replacement),
        ];
        $results = array_slice($this->runConcurrently($jobs), 1);

        $this->assertAllCompleted($results);
        $old = DB::table('fuel_tanker_fill_attachments')->where('id', $oldId)->first();
        $this->assertContains($old->status, ['removed', 'replaced']);
        $active = (int) DB::table('fuel_tanker_fill_attachments')->where('tenant_id', $f['tenant_id'])->where('status', 'active')->count();
        $this->assertSame($old->status === 'replaced' ? 1 : 0, $active, json_encode($results));
        $this->assertCount((int) DB::table('fuel_tanker_fill_attachments')->where('tenant_id', $f['tenant_id'])->count(), $this->filesOnDisk(), 'الملفات كلها محفوظة (التاريخ) بلا يتيم');
        foreach (array_column($results, 'value') as $value) {
            $this->assertMatchesRegularExpression('/^(ok|rejected):/', $value);
        }
    }

    // ───────────────────────── أدوات ─────────────────────────

    private function imageFile(int $w, int $h): string
    {
        $path = $this->dir . '/img_' . $w . 'x' . $h . '.jpg';
        $image = imagecreatetruecolor($w, $h);
        imagejpeg($image, $path);

        return $path;
    }

    /** @param array<string,string> $f @param list<string> $paths */
    private function addFiles(array $f, array $paths): string
    {
        $this->enter($f);
        try {
            $files = array_map(fn ($p) => new UploadedFile($p, basename($p), 'image/jpeg', null, true), $paths);
            $result = app(FuelTankerFillAttachmentService::class)->add(FuelTankerFill::query()->withoutGlobalScopes()->findOrFail($f['fill_id']), $files, User::findOrFail($f['actor_id']));

            return 'ok:' . $result['attachments'][0]->id;
        } catch (FuelTankerFillException $exception) {
            return 'rejected:' . $exception->reason;
        }
    }

    /** @param array<string,string> $f */
    private function replaceAttachment(array $f, string $oldId, string $path): string
    {
        $this->enter($f);
        try {
            $fill = FuelTankerFill::query()->withoutGlobalScopes()->findOrFail($f['fill_id']);
            $old = FuelTankerFillAttachment::query()->withoutGlobalScopes()->findOrFail($oldId);
            $result = app(FuelTankerFillAttachmentService::class)->replace($fill, $old, new UploadedFile($path, basename($path), 'image/jpeg', null, true), User::findOrFail($f['actor_id']));

            return 'ok:' . $result['attachment']->id;
        } catch (FuelTankerFillException $exception) {
            return 'rejected:' . $exception->reason;
        }
    }

    /** @param array<string,string> $f */
    private function removeAttachment(array $f, string $oldId): string
    {
        $this->enter($f);
        try {
            $fill = FuelTankerFill::query()->withoutGlobalScopes()->findOrFail($f['fill_id']);
            $old = FuelTankerFillAttachment::query()->withoutGlobalScopes()->findOrFail($oldId);
            $result = app(FuelTankerFillAttachmentService::class)->remove($fill, $old, 'سباق إزالة', User::findOrFail($f['actor_id']));

            return 'ok:' . $result['attachment']->id;
        } catch (FuelTankerFillException $exception) {
            return 'rejected:' . $exception->reason;
        }
    }

    /**
     * يمسك قفل صف السند لحظةً بعد بدء الجميع: كل العمليات تبلغ نقطة القفل وهو مقفول فتتراكم عنده، ثم تُطلَق معاً؛
     * فلو غاب قفل السند في الخدمة لعبرت كلها فحص العدد/المحتوى معاً (يُثبت اختبار «التحوير» ذلك).
     *
     * @param array<string,string> $f
     */
    private function holdFill(array $f, int $microseconds = 1_200_000): string
    {
        $this->enter($f);
        DB::transaction(function () use ($f, $microseconds) {
            FuelTankerFill::query()->withoutGlobalScopes()->lockForUpdate()->findOrFail($f['fill_id']);
            usleep($microseconds);
        });

        return 'ok:held';
    }

    /** @param array<string,string> $f */
    private function voidFill(array $f): string
    {
        $this->enter($f);
        try {
            app(FuelTankerFillService::class)->void(FuelTankerFill::query()->withoutGlobalScopes()->findOrFail($f['fill_id']), 'سباق إلغاء', User::findOrFail($f['actor_id']));

            return 'ok:void';
        } catch (FuelTankerFillException $exception) {
            return 'rejected:' . $exception->reason;
        }
    }

    /** @param array<string,string> $f */
    private function closeShift(array $f): string
    {
        $this->enter($f);
        DB::transaction(function () use ($f) {
            FuelShift::query()->withoutGlobalScopes()->lockForUpdate()->findOrFail($f['shift_id'])->forceFill(['status' => FuelShift::STATUS_CLOSED, 'closed_at' => now()])->save();
        });

        return 'ok:closed';
    }

    /** @param array<string,string> $f @param array<string,mixed> $values */
    private function setPolicy(array $f, array $values): void
    {
        $this->enter($f);
        app(FuelStationSettingsService::class)->putTenant($values, User::findOrFail($f['actor_id']), 'اختبار تزامن المرفقات');
    }

    /** @param array<string,string> $f */
    private function enter(array $f): void
    {
        app(TenantContext::class)->set($f['tenant_id']);
        app(BranchContext::class)->set($f['branch_id']);
    }

    /** @return array<string,string> */
    private function fixture(): array
    {
        $auth = $this->registerTenant('fuel-t4-pg-' . Str::random(6), 'owner-' . Str::random(6) . '@fuel-t4-pg.test');
        $this->tenants[] = $auth['tenant_id'];
        app(TenantContext::class)->set($auth['tenant_id']);
        $branch = Branch::where('tenant_id', $auth['tenant_id'])->sole();
        app(BranchContext::class)->set($branch->id);
        $actor = User::where('tenant_id', $auth['tenant_id'])->where('role', 'owner')->sole();

        $productId = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'وقود T4 mL', 'type' => 'good', 'unit' => 'mL', 'sale_price' => 1000, 'purchase_price' => 10, 'track_inventory' => true,
        ])->assertCreated()['data']['id'];
        $fuel = FuelProduct::create(['product_id' => $productId, 'code' => 'F-T4', 'name' => 'وقود T4']);

        $equipment = function (string $suffix) use ($branch, $fuel, $actor) {
            $station = FuelStation::create(['branch_id' => $branch->id, 'code' => 'FS-' . $suffix, 'name' => 'محطة ' . $suffix]);
            $tank = FuelTank::create(['branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuel->id, 'code' => 'T-' . $suffix, 'name' => 'خزان', 'capacity_milliliters' => 900_000_000, 'safe_capacity_milliliters' => 800_000_000]);
            $pump = FuelPump::create(['branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'pump_number' => '02', 'name' => 'مضخة']);
            $nozzle = FuelNozzle::create(['branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_pump_id' => $pump->id, 'fuel_tank_id' => $tank->id, 'fuel_product_id' => $fuel->id, 'nozzle_number' => '1']);
            $shift = FuelShift::create([
                'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'number' => 'FSH-' . $suffix, 'status' => FuelShift::STATUS_OPEN, 'opening_float_minor' => 0,
                'idempotency_key' => 'shift-' . $suffix, 'opened_by' => $actor->id, 'opened_at' => now(),
            ]);

            return [$station, $nozzle, $shift];
        };
        [$station, $nozzle, $shift] = $equipment('PG1');
        $owner = FuelTankerOwner::create(['name' => 'عسكر', 'code' => 'ASK', 'status' => 'active']);

        $f = [
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'actor_id' => $actor->id, 'station_id' => $station->id, 'nozzle_id' => $nozzle->id,
            'shift_id' => $shift->id, 'tanker_owner_id' => $owner->id,
        ];
        $f['fill_id'] = app(FuelTankerFillService::class)->record([
            'fuel_station_id' => $station->id, 'fuel_nozzle_id' => $nozzle->id, 'fuel_tanker_owner_id' => $owner->id,
            'quantity_liters' => '1000', 'voucher_number' => 'ATT-1', 'idempotency_key' => 'att-fill-' . Str::random(6),
        ], $actor)['fill']->id;
        return $f;
    }

    private function assertAllCompleted(array $results): void
    {
        foreach ($results as $i => $result) {
            $this->assertTrue($result['ok'] ?? false, "العملية {$i}: " . ($result['error_class'] ?? '') . ' ' . ($result['message'] ?? ''));
            $message = (string) ($result['message'] ?? '');
            $this->assertFalse(str_contains($message, '40P01') || stripos($message, 'deadlock') !== false, "جمود في العملية {$i}");
        }
    }

    /** @param list<callable> $jobs @return array<int, array<string, mixed>> */
    private function runConcurrently(array $jobs): array
    {
        $barrier = $this->dir . '/barrier_' . uniqid();
        $resultFiles = [];
        $pids = [];

        foreach ($jobs as $i => $job) {
            $resultFiles[$i] = $this->dir . '/result_' . uniqid() . "_{$i}";
            $pid = pcntl_fork();
            if ($pid === -1) {
                $this->fail('فشل pcntl_fork.');
            }
            if ($pid === 0) {
                DB::purge(config('database.default'));
                $deadline = microtime(true) + 10.0;
                while (! file_exists($barrier) && microtime(true) < $deadline) {
                    usleep(500);
                }
                try {
                    file_put_contents($resultFiles[$i], json_encode(['ok' => true, 'value' => $job()]));
                } catch (\Throwable $e) {
                    file_put_contents($resultFiles[$i], json_encode(['ok' => false, 'error_class' => get_class($e), 'message' => $e->getMessage()]));
                }
                exit(0);
            }
            $pids[] = $pid;
        }

        touch($barrier);
        foreach ($pids as $pid) {
            pcntl_waitpid($pid, $status);
        }

        $results = [];
        foreach ($resultFiles as $i => $file) {
            $raw = is_file($file) ? file_get_contents($file) : false;
            $results[$i] = json_decode($raw !== false ? $raw : '{"ok":false,"message":"no output"}', true);
        }

        return $results;
    }
}
