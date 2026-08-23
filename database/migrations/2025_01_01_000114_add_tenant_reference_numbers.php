<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private const ACCOUNT_START = 1000000;
    private const SUPPORT_START = 1000;

    /**
     * تضيف مراجع العملاء المستقلة ثم تسندها بترتيب ثابت للمستأجرين الحاليين.
     * العداد المنفصل يبقى حتى لو حُذف مستأجر قسراً مستقبلاً، فلا يعاد استعمال رقم.
     */
    public function up(): void
    {
        Schema::table('tenants', function (Blueprint $table): void {
            $table->unsignedInteger('account_number')->nullable()->unique()->after('slug');
            $table->unsignedInteger('support_number')->nullable()->unique()->after('account_number');
        });

        Schema::create('tenant_reference_number_sequences', function (Blueprint $table): void {
            $table->unsignedTinyInteger('id')->primary();
            $table->unsignedInteger('next_account_number');
            $table->unsignedInteger('next_support_number');
            $table->timestamps();
        });

        $accountNumber = self::ACCOUNT_START;
        $supportNumber = self::SUPPORT_START;

        DB::table('tenants')
            ->orderBy('created_at')
            ->orderBy('id')
            ->select(['id', 'account_number', 'support_number'])
            ->each(function (object $tenant) use (&$accountNumber, &$supportNumber): void {
                $assignment = [];

                if ($tenant->account_number === null) {
                    $assignment['account_number'] = $accountNumber++;
                } else {
                    $accountNumber = max($accountNumber, ((int) $tenant->account_number) + 1);
                }

                if ($tenant->support_number === null) {
                    $assignment['support_number'] = $supportNumber++;
                } else {
                    $supportNumber = max($supportNumber, ((int) $tenant->support_number) + 1);
                }

                if ($assignment !== []) {
                    DB::table('tenants')->where('id', $tenant->id)->update($assignment);
                }
            });

        DB::table('tenant_reference_number_sequences')->insert([
            'id'                  => 1,
            'next_account_number' => $accountNumber,
            'next_support_number' => $supportNumber,
            'created_at'          => now(),
            'updated_at'          => now(),
        ]);
    }

    public function down(): void
    {
        Schema::dropIfExists('tenant_reference_number_sequences');

        Schema::table('tenants', function (Blueprint $table): void {
            $table->dropUnique(['account_number']);
            $table->dropUnique(['support_number']);
            $table->dropColumn(['account_number', 'support_number']);
        });
    }
};
