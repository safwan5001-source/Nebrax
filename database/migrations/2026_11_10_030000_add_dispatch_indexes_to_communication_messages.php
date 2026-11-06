<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * AWJ-COMMS-03-A — فهارس الموزّع (إضافية بحتة، الثلاثة المخطَّطة لهذه الشريحة في اعتماد 02-A §5.5).
 *
 * فهارس جزئية فقط (محمولة PG/SQLite كالمعتمد في المشروع)، بلا تغيير أعمدة ولا قيود ولا Triggers ولا بيانات:
 *  - `comm_msg_due_idx`    `(next_attempt_at)` للمستحق القابل للمطالبة (يستبعد OTP لأن حمولته NULL).
 *  - `comm_msg_expiry_idx` `(expires_at)` لانتهاء صلاحية ما لم يُرسَل بعد (يستعمله الكنّاس لاحقاً).
 *  - `comm_msg_lease_idx`  `(lease_until)` لاسترجاع الإيجار المنقضي.
 *
 * مؤجَّلة لشرائحها: فهارس نافذة الإيصال والتقليم (03-B) ومطابقة الإيصال على المحاولات (08).
 *
 * `down()` يحذف الفهارس الثلاثة فقط، وهو آمن مع وجود بيانات (لا فقد بيانات) فلا حاجة لحارس الصفوف.
 */
return new class extends Migration
{
    private const INDEXES = [
        'comm_msg_due_idx' => "(next_attempt_at) WHERE status IN ('queued','retry_scheduled') AND payload_encrypted IS NOT NULL",
        'comm_msg_expiry_idx' => "(expires_at) WHERE status IN ('queued','retry_scheduled')",
        'comm_msg_lease_idx' => "(lease_until) WHERE status = 'sending'",
    ];

    public function up(): void
    {
        foreach (self::INDEXES as $name => $definition) {
            DB::statement("CREATE INDEX IF NOT EXISTS {$name} ON communication_messages {$definition}");
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('communication_messages')) {
            return;
        }

        foreach (array_keys(self::INDEXES) as $name) {
            DB::statement("DROP INDEX IF EXISTS {$name}");
        }
    }
};
