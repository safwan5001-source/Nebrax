<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * بنود الراتب على العقد — نطاق البناء الأول لقوالب/بنود الراتب (design-system/
 * foundations/hr-users-architecture.md «قوالب/بنود الراتب»): بنودٌ قابلة
 * للتخصيص على العقد مباشرة (لا قالبٌ مستقلٌّ قابل لإعادة الاستخدام بعد،
 * ولا اشتقاقٌ تلقائي من قواعد الحضور — إدخالٌ يدويٌّ بحت، القراران المعتمدان).
 *
 * كل بندٍ يحمل تصنيفاً (`category`) من أربعةٍ ثابتة تحدِّد نوعه (استحقاق/خصم)
 * ومسارَه المحاسبي في PayrollService::post() (يبقى بلا تغييرٍ هيكلي):
 * `basic`/`allowance` استحقاق يغذّي 5120، و`gosi`/`other` خصمٌ يغذّي 2140/2150
 * على التوالي. التصنيف الحر (اسمٌ مفتوح) داخل كل تصنيفٍ هو ما يجعل البنود
 * «قابلة للتخصيص» فعلياً (أكثر من بدلٍ باسمه الخاص، أكثر من استقطاعٍ باسمه)
 * دون إعادة تصميم مسار الترحيل المحاسبي القائم.
 *
 * هجرةٌ حقيقية: كل عقدٍ قائم (بما فيها عقود الهجرة التلقائية من PR #327) يُحوَّل
 * إلى بندٍ «أساسي» إلزامي بقيمة `basic_salary`، وبنودٍ إضافية بالقيم غير
 * الصفرية من `allowances`/`gosi`/`other_deductions` فقط — لا فقدان بيانات.
 * الأعمدة الأربعة القديمة على `contracts` تُحذف بعد الهجرة: العقد جدولٌ جديدٌ
 * كلياً (PR #327 نفسه) بلا مستهلكين خارج هذا الكود المُتحكَّم به بالكامل، فلا
 * مبرر لإبقائها كأعمدة ميتة (خلافاً لأعمدة Employee القديمة المُبقاة عمداً).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('contract_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('contract_id')->constrained()->cascadeOnDelete();
            $table->string('category'); // basic|allowance|gosi|other
            $table->string('name');
            $table->bigInteger('amount')->default(0); // هللات
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();

            $table->index(['tenant_id', 'contract_id']);
        });

        $this->backfill();

        Schema::table('contracts', function (Blueprint $table) {
            $table->dropColumn(['basic_salary', 'allowances', 'gosi', 'other_deductions']);
        });
    }

    private function backfill(): void
    {
        DB::table('contracts')->orderBy('id')->chunk(200, function ($contracts) {
            $now = now();
            $rows = [];
            foreach ($contracts as $contract) {
                $order = 0;
                $push = function (string $category, string $name, int $amount) use (&$rows, $contract, &$order, $now) {
                    $rows[] = [
                        'id'          => (string) Str::uuid(),
                        'tenant_id'   => $contract->tenant_id,
                        'contract_id' => $contract->id,
                        'category'    => $category,
                        'name'        => $name,
                        'amount'      => $amount,
                        'sort_order'  => $order++,
                        'created_at'  => $now,
                        'updated_at'  => $now,
                    ];
                };

                $push('basic', 'الراتب الأساسي', (int) $contract->basic_salary);
                if ((int) $contract->allowances > 0) {
                    $push('allowance', 'بدلات', (int) $contract->allowances);
                }
                if ((int) $contract->gosi > 0) {
                    $push('gosi', 'التأمينات الاجتماعية (GOSI)', (int) $contract->gosi);
                }
                if ((int) $contract->other_deductions > 0) {
                    $push('other', 'استقطاعات أخرى', (int) $contract->other_deductions);
                }
            }

            if ($rows !== []) {
                DB::table('contract_items')->insert($rows);
            }
        });
    }

    public function down(): void
    {
        Schema::table('contracts', function (Blueprint $table) {
            $table->bigInteger('basic_salary')->default(0)->after('probation_end_date');
            $table->bigInteger('allowances')->default(0)->after('basic_salary');
            $table->bigInteger('gosi')->default(0)->after('allowances');
            $table->bigInteger('other_deductions')->default(0)->after('gosi');
        });

        DB::table('contracts')->orderBy('id')->chunk(200, function ($contracts) {
            foreach ($contracts as $contract) {
                $items = DB::table('contract_items')->where('contract_id', $contract->id)->get();
                DB::table('contracts')->where('id', $contract->id)->update([
                    'basic_salary'     => (int) $items->firstWhere('category', 'basic')?->amount,
                    'allowances'       => (int) $items->where('category', 'allowance')->sum('amount'),
                    'gosi'             => (int) $items->where('category', 'gosi')->sum('amount'),
                    'other_deductions' => (int) $items->where('category', 'other')->sum('amount'),
                ]);
            }
        });

        Schema::dropIfExists('contract_items');
    }
};
