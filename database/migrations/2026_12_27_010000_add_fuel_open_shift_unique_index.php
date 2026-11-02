<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * FS-33 (PR-13) — وردية وقود مفتوحة واحدة لكل محطة، يفرضها فهرس فريد جزئي في القاعدة.
 *
 * كان الثبات تطبيقياً فقط: `FuelShiftService::open` يقفل صف المحطة ثم يفحص `exists()`، فأي كتابة تتجاوز الخدمة (SQL خام،
 * سكربت، نسخة أقدم أثناء النشر) تستطيع إنشاء وردية مفتوحة ثانية. الفهرس يجعل القاعدة هي الحاكم الأخير ولا يغيّر سلوك الخدمة
 * (قفلها وفحصها باقيان، وتعارض الفهرس يُحوَّل إلى رسالة التضارب القائمة في `open()`).
 *
 * فهرس جزئي `WHERE status = 'open'` على `(fuel_station_id)`: الوردية المغلقة/المعتمدة لا تُقيَّد، ومحطة أخرى لا تتأثر.
 * `fuel_station_id` وحده كافٍ (المحطة تنتمي لمستأجر واحد). `CREATE UNIQUE INDEX … WHERE` يعمل على PostgreSQL وSQLite بالصيغة نفسها
 * ولا يمسّ الجدول (لا إعادة بناء SQLite).
 *
 * ═══ الفحص المسبق (فشل واضح وآمن) ═══
 * إن وُجدت محطة بأكثر من وردية مفتوحة تفشل الهجرة **قبل** أي تغيير برسالة تسرد المحطات والورديات المتعارضة. لا تعديل ولا حذف
 * ولا إغلاق تلقائي لأي وردية: تُعالج يدوياً بالمسار المدقَّق (إغلاق/تصحيح) ثم تُعاد الهجرة.
 *
 * التراجع يُسقط الفهرس فقط. لا بيانات تُمسّ في الاتجاهين.
 */
return new class extends Migration
{
    private const INDEX = 'fuel_shifts_one_open_per_station';

    public function up(): void
    {
        $this->assertNoConflictingOpenShifts();

        DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS ".self::INDEX." ON fuel_shifts (fuel_station_id) WHERE status = 'open'");
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS '.self::INDEX);
    }

    private function assertNoConflictingOpenShifts(): void
    {
        $stationIds = DB::table('fuel_shifts')
            ->where('status', 'open')
            ->groupBy('fuel_station_id')
            ->havingRaw('COUNT(*) > 1')
            ->pluck('fuel_station_id');

        if ($stationIds->isEmpty()) {
            return;
        }

        $lines = [];
        foreach ($stationIds as $stationId) {
            $station = DB::table('fuel_stations')->where('id', $stationId)->first(['code', 'name', 'tenant_id']);
            $shifts = DB::table('fuel_shifts')
                ->where('fuel_station_id', $stationId)
                ->where('status', 'open')
                ->orderBy('opened_at')
                ->get(['id', 'number', 'opened_at']);
            $lines[] = sprintf(
                '- المحطة %s (%s) مستأجر %s: %s',
                $station->code ?? '?',
                $stationId,
                $station->tenant_id ?? '?',
                $shifts->map(fn ($shift) => "{$shift->number} [{$shift->id}] فُتحت {$shift->opened_at}")->implode(' ، '),
            );
        }

        throw new RuntimeException(
            "FS-33: لا يمكن إنشاء فهرس «وردية مفتوحة واحدة لكل محطة» لوجود ورديات مفتوحة متعارضة. لم يُعدَّل أي سجل.\n"
            ."أغلق أو صحّح الورديات الزائدة عبر المسار المدقَّق ثم أعد تشغيل الهجرة:\n".implode("\n", $lines)
        );
    }
};
