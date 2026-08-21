<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // قوائم أسعار مشتركة للمؤسسة: يختارها البائع صراحةً في المسودة، ولا
        // تنشئ قيداً أو تغير سطراً قائماً بذاتها.
        Schema::create('price_lists', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('name', 255);
            $table->text('description')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['tenant_id', 'name']);
            $table->index(['tenant_id', 'is_active']);
        });

        // السعر في كل عنصر هللات؛ اسم الوحدة الفارغ يمثل وحدة أساس المنتج، فلا
        // توجد قيمة NULL داخل الفهرس الفريد تختلف دلالتها بين SQLite وPostgreSQL.
        Schema::create('price_list_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('price_list_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained()->restrictOnDelete();
            $table->string('unit_name', 255)->default('');
            $table->unsignedBigInteger('price');
            $table->timestamps();

            $table->unique(['price_list_id', 'product_id', 'unit_name']);
            $table->index(['tenant_id', 'product_id']);
        });

        // لا تحذف القائمة المختارة من مستند قائم: الفاتورة تبقى حجة تاريخية،
        // وتظل قيمة السعر نفسها مثبتة في سطرها كما هي.
        Schema::table('invoices', function (Blueprint $table) {
            $table->foreignUuid('price_list_id')->nullable()->constrained('price_lists')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->dropConstrainedForeignId('price_list_id');
        });

        Schema::dropIfExists('price_list_items');
        Schema::dropIfExists('price_lists');
    }
};
