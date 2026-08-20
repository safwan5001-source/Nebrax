<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * الهيكل التنظيمي: مسمى وظيفي/قسم/مستوى وظيفي/نوع وظيفة ككيانات مُدارة لكل
 * مؤسسة (design-system/foundations/hr-users-architecture.md — «الهيكل
 * التنظيمي»)، تستبدل ثلاثة حقول نصية حرة على `employees` (job_title،
 * department، employment_type) وتضيف رابعاً جديداً كلياً (job_level).
 *
 * بلا بذرٍ افتراضي لأيٍّ منها عمداً: على عكس طرق الدفع (مرتبطة فعلياً
 * بحسابات بنك/صندوق حقيقية)، هذه أربعتها أسماء حرّة بالكامل تخص كل مؤسسة —
 * بذر قيمٍ افتراضية لواحدٍ منها (أنواع التوظيف) دون البقية يكسر التماثل بلا
 * مبرر محاسبي، فتُترك شاشة فارغة يملؤها كل مستأجر بما يخصه، كبقية الهيكل.
 */
return new class extends Migration
{
    private array $lookupTables = ['job_titles', 'departments', 'job_levels', 'employment_types'];

    public function up(): void
    {
        foreach ($this->lookupTables as $table) {
            Schema::create($table, function (Blueprint $t) {
                $t->uuid('id')->primary();
                $t->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
                $t->string('name');
                $t->boolean('is_active')->default(true);
                $t->timestamps();

                $t->unique(['tenant_id', 'name']);
            });
        }

        Schema::table('employees', function (Blueprint $table) {
            $table->foreignUuid('job_title_id')->nullable()->after('job_title')
                ->constrained('job_titles')->nullOnDelete();
            $table->foreignUuid('department_id')->nullable()->after('department')
                ->constrained('departments')->nullOnDelete();
            $table->foreignUuid('job_level_id')->nullable()->after('department_id')
                ->constrained('job_levels')->nullOnDelete();
            $table->foreignUuid('employment_type_id')->nullable()->after('employment_type')
                ->constrained('employment_types')->nullOnDelete();
        });

        $this->backfill('job_title', 'job_titles', 'job_title_id');
        $this->backfill('department', 'departments', 'department_id');
        $this->backfill('employment_type', 'employment_types', 'employment_type_id');

        Schema::table('employees', function (Blueprint $table) {
            $table->dropColumn(['job_title', 'department', 'employment_type']);
        });
    }

    /**
     * لكل قيمةٍ نصّية موجودة فعلياً على موظفٍ قائم: يُنشأ كيانٌ مطابقٌ لها
     * (مرة واحدة لكل مستأجر) ثم يُربط كل موظفٍ يحمل تلك القيمة به. لا كيان
     * يُنشأ لقيمةٍ لم يستخدمها أي موظف فعلياً.
     */
    private function backfill(string $textColumn, string $table, string $fkColumn): void
    {
        $distinctValues = DB::table('employees')
            ->select('tenant_id', $textColumn)
            ->whereNotNull($textColumn)
            ->where($textColumn, '!=', '')
            ->distinct()
            ->get();

        foreach ($distinctValues as $row) {
            $value = trim((string) $row->$textColumn);
            if ($value === '') {
                continue;
            }

            $id = DB::table($table)
                ->where('tenant_id', $row->tenant_id)
                ->where('name', $value)
                ->value('id');

            if (! $id) {
                $id = (string) Str::uuid();
                DB::table($table)->insert([
                    'id' => $id, 'tenant_id' => $row->tenant_id, 'name' => $value,
                    'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
                ]);
            }

            DB::table('employees')
                ->where('tenant_id', $row->tenant_id)
                ->where($textColumn, $row->$textColumn)
                ->update([$fkColumn => $id]);
        }
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->string('job_title')->nullable();
            $table->string('department')->nullable();
            $table->string('employment_type')->nullable();
        });

        foreach ([
            ['job_title_id', 'job_titles', 'job_title'],
            ['department_id', 'departments', 'department'],
            ['employment_type_id', 'employment_types', 'employment_type'],
        ] as [$fk, $table, $textColumn]) {
            DB::table('employees')
                ->join($table, "employees.$fk", '=', "$table.id")
                ->update(["employees.$textColumn" => DB::raw("$table.name")]);
        }

        Schema::table('employees', function (Blueprint $table) {
            $table->dropConstrainedForeignId('job_title_id');
            $table->dropConstrainedForeignId('department_id');
            $table->dropConstrainedForeignId('job_level_id');
            $table->dropConstrainedForeignId('employment_type_id');
        });

        foreach ($this->lookupTables as $table) {
            Schema::dropIfExists($table);
        }
    }
};
