<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use App\Services\FuelStaffAccessService;
use App\Support\FuelStaffRevisionConflictException;
use App\Support\FuelStaffTemplates;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * FUEL-B3 — تزامن إسناد موظفي الوقود على PostgreSQL (`pcntl_fork`):
 *  - `expected_revision` نفسه من عدة مديرين ⇒ ينجح واحد والباقي 409 (لا كتابة فوق حالة تغيّرت).
 *  - بلا revision ⇒ التعديلات تتسلسل (قفل صف المستخدم) فتنجح كلها بلا جمود، والحالة النهائية = طلب واحد كاملاً (قالب ومحطاته معاً، لا مزيج)،
 *    دور شخصي واحد، وحدث تدقيق لكل تعديل مطبَّق.
 * على PostgreSQL لا يُتخطّى إن غاب `pcntl`؛ يُتخطّى على SQLite فقط.
 */
class FuelStaffConcurrencyPostgresTest extends TestCase
{
    use InteractsWithApi;
    use UsesWorkerDatabaseWithoutTransaction;
    use BuildsFuelStaffFixture;

    private string $dir;

    protected function setUp(): void
    {
        parent::setUp();
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على الأقفال.');
        }
        $this->assertTrue(function_exists('pcntl_fork'), 'pcntl مطلوب لاختبارات تزامن PostgreSQL؛ غيابه فشل لا تخطٍّ.');
        $this->dir = sys_get_temp_dir() . '/fuel_staff_' . uniqid();
        mkdir($this->dir);
    }

    protected function tearDown(): void
    {
        if (isset($this->dir) && is_dir($this->dir)) {
            foreach (glob($this->dir . '/*') ?: [] as $f) {
                @unlink($f);
            }
            @rmdir($this->dir);
        }
        if (DB::connection()->getDriverName() === 'pgsql' && isset($this->tenantId)) {
            DB::table('tenants')->where('id', $this->tenantId)->delete();
        }
        parent::tearDown();
    }

    /** @return array{actor: string, target: string, branch: string} */
    private function scene(): array
    {
        $this->buildFixture();
        $target = $this->makeUser('emp', 'staff');
        $actor = User::where('tenant_id', $this->tenantId)->where('role', 'owner')->firstOrFail();

        return ['actor' => $actor->id, 'target' => $target['user']->id, 'branch' => $this->fx['branchA']->id];
    }

    /** @param array<string,string> $scene */
    private function enter(array $scene): void
    {
        app(TenantContext::class)->set($this->tenantId);
        app(BranchContext::class)->set($scene['branch']);
    }

    /** @test */
    public function one_revision_raced_by_several_managers_lets_exactly_one_win_and_the_rest_get_409(): void
    {
        $scene = $this->scene();
        $this->enter($scene);
        $service = app(FuelStaffAccessService::class);
        // حالة الأساس. **كل** وظيفة منافسة أدناه تغيّر هذه الحالة فعلاً (قالبها أو محطتها يختلف): وظيفة تطابق الأساس بلا تغيير لا تحرّك الـrevision
        // (بصمة حالة لا عدّاد)، فتنجح كـno-op قبل الفائز الحقيقي أو بعده بحسب من يأخذ القفل أولاً، وهذا سباق في الاختبار لا في الخدمة
        // (يغطّيه الاختبار الحتمي `a_noop_with_the_current_revision…` أدناه).
        $baseline = ['template' => 'supervisor', 'station' => 's1'];
        $revision = $service->update(User::findOrFail($scene['actor']), $scene['target'], ['template' => $baseline['template'], 'station_ids' => [$this->fx[$baseline['station']]->id]])['revision'];
        $templates = ['seller', 'supervisor', 'station_manager', 'supervisor', 'station_manager', 'seller'];
        foreach ($templates as $i => $template) {
            $this->assertNotSame($baseline, ['template' => $template, 'station' => $i % 2 === 0 ? 's1' : 's2'], "الوظيفة {$i} تطابق حالة الأساس فلا تُعدّ منافسة حقيقية على الـrevision.");
        }

        $jobs = [];
        foreach ($templates as $i => $template) {
            $jobs[] = function () use ($scene, $template, $revision, $i) {
                $this->enter($scene);
                try {
                    app(FuelStaffAccessService::class)->update(User::findOrFail($scene['actor']), $scene['target'], [
                        'template' => $template, 'station_ids' => [$i % 2 === 0 ? $this->fx['s1']->id : $this->fx['s2']->id], 'expected_revision' => $revision,
                    ]);

                    return 'ok:' . $template . ':' . ($i % 2 === 0 ? 's1' : 's2');
                } catch (FuelStaffRevisionConflictException) {
                    return 'conflict';
                }
            };
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $values = array_column($results, 'value');
        $winners = array_values(array_filter($values, fn ($v) => str_starts_with($v, 'ok:')));
        $this->assertCount(1, $winners, json_encode($results));
        $this->assertSame(5, count(array_filter($values, fn ($v) => $v === 'conflict')), json_encode($results));
        // الحالة النهائية = الفائز كاملاً.
        [, $template, $station] = explode(':', $winners[0]);
        $this->assertFinalState($scene, $template, $station);
        $this->assertNotSame($revision, app(FuelStaffAccessService::class)->show(User::findOrFail($scene['actor']), $scene['target'])['revision'], 'الفائز غيّر الحالة فتغيّر الـrevision.');
        $this->assertSame(2, (int) DB::table('access_change_events')->where('tenant_id', $this->tenantId)->where('action', 'fuel_staff.updated')->where('outcome', 'applied')->count()); // التهيئة + الفائز
    }

    /**
     * عقد `revision`: بصمة **حالة** لا عدّاد. تعديل يطابق الحالة الحالية لا يغيّرها ولا يُنتج حدث تدقيق، فيبقى الـrevision صالحاً؛ ثم تعديل حقيقي بنفس الـrevision
     * ينجح، وبعده يُرفض كل من يحمل الـrevision القديم. حتمي (تسلسل صريح بلا fork) ويشرح سبب أن الاختبار التنافسي أعلاه لا يتضمن وظيفة no-op.
     *
     * @test
     */
    public function a_noop_with_the_current_revision_is_accepted_without_changing_it_or_writing_an_audit_event(): void
    {
        $scene = $this->scene();
        $this->enter($scene);
        $service = app(FuelStaffAccessService::class);
        $actor = User::findOrFail($scene['actor']);
        $state = ['template' => 'seller', 'station_ids' => [$this->fx['s1']->id]];
        $revision = $service->update($actor, $scene['target'], $state)['revision'];
        $applied = fn () => (int) DB::table('access_change_events')->where('tenant_id', $this->tenantId)->where('action', 'fuel_staff.updated')->where('outcome', 'applied')->count();
        $this->assertSame(1, $applied());

        $noop = $service->update($actor, $scene['target'], $state + ['expected_revision' => $revision]);
        $this->assertSame($revision, $noop['revision'], 'تعديل يطابق الحالة لا يحرّك الـrevision.');
        $this->assertSame(1, $applied(), 'تعديل بلا تغيير فعلي لا يُنتج حدث تدقيق.');

        $real = $service->update($actor, $scene['target'], ['template' => 'supervisor', 'station_ids' => [$this->fx['s2']->id], 'expected_revision' => $revision]);
        $this->assertNotSame($revision, $real['revision']);
        $this->assertSame(2, $applied());

        try {
            $service->update($actor, $scene['target'], ['template' => 'station_manager', 'station_ids' => [$this->fx['s1']->id], 'expected_revision' => $revision]);
            $this->fail('الـrevision القديم بعد تغيير حقيقي يجب أن يُرفض.');
        } catch (FuelStaffRevisionConflictException $e) {
            $this->assertSame($real['revision'], $e->currentRevision);
        }
        $this->assertSame(2, $applied());
    }

    /** @test */
    public function revision_less_updates_serialize_without_deadlock_and_leave_one_coherent_state_with_one_personal_role(): void
    {
        $scene = $this->scene();
        $this->enter($scene);
        $templates = ['seller', 'supervisor', 'station_manager', 'seller', 'supervisor', 'station_manager'];

        $jobs = [];
        foreach ($templates as $i => $template) {
            $jobs[] = function () use ($scene, $template, $i) {
                $this->enter($scene);
                app(FuelStaffAccessService::class)->update(User::findOrFail($scene['actor']), $scene['target'], [
                    'template' => $template, 'station_ids' => [$i % 2 === 0 ? $this->fx['s1']->id : $this->fx['s2']->id],
                ]);

                return $template . ':' . ($i % 2 === 0 ? 's1' : 's2');
            };
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $final = array_column($results, 'value');
        // الحالة النهائية تطابق طلباً واحداً بكامله (قالبه ومحطته معاً) — لا مزيج بين طلبين.
        $matches = 0;
        foreach (array_unique($final) as $candidate) {
            [$template, $station] = explode(':', $candidate);
            try {
                $this->assertFinalState($scene, $template, $station);
                $matches++;
            } catch (\PHPUnit\Framework\AssertionFailedError) {
                // ليس الأخير.
            }
        }
        $this->assertSame(1, $matches, 'الحالة النهائية يجب أن تطابق طلباً واحداً بكامله: ' . json_encode($final));
        $this->assertSame(1, Role::where('tenant_id', $this->tenantId)->where('slug', 'like', 'fuel-staff-%')->count(), 'دور شخصي واحد للموظف');
        $this->assertSame(6, (int) DB::table('access_change_events')->where('tenant_id', $this->tenantId)->where('action', 'fuel_staff.updated')->where('outcome', 'applied')->count());
    }

    /** @param array<string,string> $scene */
    private function assertFinalState(array $scene, string $template, string $station): void
    {
        $user = User::findOrFail($scene['target']);
        $permissions = array_values(array_filter(
            \App\Support\Rbac::permissionsForRole($user->role),
            fn (string $p) => FuelStaffTemplates::isFuelDomain($p),
        ));
        sort($permissions);
        $this->assertSame(FuelStaffTemplates::permissions($template), $permissions);
        $this->assertSame([$this->fx[$station]->id], $user->fuelStations()->pluck('fuel_stations.id')->all());
        $this->assertSame('assigned', $user->fuel_station_scope);
    }

    private function assertAllCompleted(array $results): void
    {
        foreach ($results as $i => $result) {
            $this->assertTrue($result['ok'] ?? false, "العملية {$i}: ".($result['error_class'] ?? '').' '.($result['message'] ?? ''));
            $message = (string) ($result['message'] ?? '');
            $this->assertFalse(str_contains($message, '40P01') || stripos($message, 'deadlock') !== false, "جمود في العملية {$i}");
        }
    }

    /** @param list<callable> $jobs @return array<int, array<string, mixed>> */
    private function runConcurrently(array $jobs): array
    {
        $barrier = $this->dir.'/barrier_'.uniqid();
        $resultFiles = [];
        $pids = [];

        foreach ($jobs as $i => $job) {
            $resultFiles[$i] = $this->dir.'/result_'.uniqid()."_{$i}";
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
