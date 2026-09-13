<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sales_channels', function (Blueprint $table) {
            // Current configuration, not historical truth: a referenced list cannot
            // be deleted until the channel assignment is explicitly cleared.
            $table->foreignUuid('default_price_list_id')
                ->nullable()
                ->constrained('price_lists')
                ->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('sales_channels', function (Blueprint $table) {
            $table->dropConstrainedForeignId('default_price_list_id');
        });
    }
};
