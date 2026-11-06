<?php

namespace Tests\ExpProbe;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** تجربة معزولة (exp/ci-sqlite-parallel): يسجّل أي عامل وأي ملف قاعدة بيانات يخدم هذا الصنف. لا يدخل المستودع الرئيسي. */
class __CLASS__ extends TestCase
{
    use RefreshDatabase;

    /** @test */
    public function records_worker_database_identity(): void
    {
        $file = DB::selectOne('PRAGMA database_list');
        $tables = (int) DB::selectOne("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table'")->c;
        $marker = 'probe-' . bin2hex(random_bytes(6));
        $record = [
            'class' => static::class,
            'token' => getenv('TEST_TOKEN') ?: ($_SERVER['TEST_TOKEN'] ?? 'none'),
            'pid' => getmypid(),
            'db_file' => (string) ($file->file ?? ''),
            'tables' => $tables,
            'marker' => $marker,
        ];
        file_put_contents(getenv('EXP_PROBE_FILE') ?: '/tmp/exp-probe.jsonl', json_encode($record) . "\n", FILE_APPEND | LOCK_EX);
        sleep(2); // يوزّع الأصناف على العمّال بدل أن يستهلكها عاملٌ واحد
        $this->assertGreaterThan(100, $tables);
    }
}
