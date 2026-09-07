<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    /**
     * ═══════════════════════════════════════════════════════════════
     *  PR-UOM-1 — فضاء الباركود الموحّد: أساسي واحد + بديل، بقيدٍ فريد
     * ═══════════════════════════════════════════════════════════════
     *  `products.barcode` (الأساسي) و`product_barcodes.code` (البديل) كانا
     *  جدولين منفصلين بفحص `exists()` على مستوى التطبيق فقط — غير ذرّي تحت
     *  التزامن، وغير متماثل (تحقّق الباركود الأساسي عند الإنشاء لا يفحص
     *  الجدول البديل إطلاقاً، والاستيراد كذلك). صفٌّ واحد هنا لكل كود
     *  مستعمَل — أساسياً كان أو بديلاً — بقيدٍ فريد `(tenant_id, code)` يجعل
     *  الفضاء **مصدر حقيقة واحداً** تفرضه قاعدة البيانات نفسها، لا فحصاً
     *  تطبيقياً سابقاً له يمكن أن يفوته سباقٌ متزامن.
     *
     *  **لا تُحرَّر لمنتجٍ مُعطَّل أو محذوفٍ ناعماً:** التحرير الوحيد يقع في
     *  `ProductLifecycleService::delete()` — وهو مسارٌ لا يُكمِل أصلاً إلا
     *  حين لا توجد أي مراجع تاريخية للمنتج، فتحريره حينها لا يكسر أي هوية
     *  قائمة. التعطيل (`is_active=false`) لا يمسّ هذا الجدول إطلاقاً.
     */
    public function up(): void
    {
        Schema::create('barcode_registry', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('code', 255);
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->enum('kind', ['primary', 'alternate']);
            $table->timestamps();

            $table->unique(['tenant_id', 'code']);
            $table->index(['tenant_id', 'product_id']);
        });

        $this->backfillExistingBarcodes();
    }

    /**
     * تعبئة الفضاء من البيانات القائمة. المستودع نواة ما قبل الإنتاج
     * (`CLAUDE.md`: بيانات تجريبية يمكن إعادة ضبطها) — فسياسة الهجرة هنا:
     * تعارضٌ فعلي (كودٌ مكرّر بين منتجين، أو بين الأساسي والبديل، لم يكن
     * القيد الفريد القديم على `product_barcodes` وحده يمنعه) **يُفشل الهجرة
     * بتشخيصٍ واضح** بدل إسقاطه صامتاً أو إضعاف التفرّد النهائي لإرضاء صفوف
     * تجريبية — كما ينصّ عقد PR-UOM-1 صراحةً.
     */
    private function backfillExistingBarcodes(): void
    {
        $rows = [];
        $seen = []; // "{tenant_id}|{code}" => true — يكشف التعارض قبل أي إدراج

        $conflicts = [];

        $primaries = DB::table('products')
            ->whereNotNull('barcode')
            ->where('barcode', '!=', '')
            ->get(['id', 'tenant_id', 'barcode']);

        foreach ($primaries as $product) {
            $key = $product->tenant_id.'|'.$product->barcode;
            if (isset($seen[$key])) {
                $conflicts[] = "المستأجر {$product->tenant_id}: الباركود «{$product->barcode}» مكرّر بين أكثر من منتج أساسي.";

                continue;
            }
            $seen[$key] = true;

            $rows[] = [
                'id' => (string) Str::uuid(),
                'tenant_id' => $product->tenant_id,
                'code' => $product->barcode,
                'product_id' => $product->id,
                'kind' => 'primary',
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }

        $alternates = DB::table('product_barcodes')->get(['id', 'tenant_id', 'code', 'product_id']);

        foreach ($alternates as $barcode) {
            $key = $barcode->tenant_id.'|'.$barcode->code;
            if (isset($seen[$key])) {
                $conflicts[] = "المستأجر {$barcode->tenant_id}: الباركود «{$barcode->code}» مستخدَم في أكثر من موضع (أساسي/بديل).";

                continue;
            }
            $seen[$key] = true;

            $rows[] = [
                'id' => (string) Str::uuid(),
                'tenant_id' => $barcode->tenant_id,
                'code' => $barcode->code,
                'product_id' => $barcode->product_id,
                'kind' => 'alternate',
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }

        if ($conflicts !== []) {
            throw new RuntimeException(
                "تعذّرت تعبئة فضاء الباركود الموحّد بسبب تعارضات قائمة يجب حلّها يدوياً قبل هذه الهجرة:\n"
                .implode("\n", $conflicts)
            );
        }

        foreach (array_chunk($rows, 500) as $chunk) {
            DB::table('barcode_registry')->insert($chunk);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('barcode_registry');
    }
};
