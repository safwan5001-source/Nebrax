<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Station-only PIN credential for an existing AWJ user.
     * Nullable to preserve current ERP accounts and existing login behavior.
     * Only a one-way password hash may be stored; never a plaintext PIN.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('station_pin_hash')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('station_pin_hash');
        });
    }
};
