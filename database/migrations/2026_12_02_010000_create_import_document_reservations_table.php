<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * IMP-H5-S1a — حجوزات هوية المستندات المستوردة (`import_document_reservations`): **مخطط فقط**، لا يقرؤه ولا يكتبه أي مسار قائم بعد.
 *
 * التكرار في المصروفات والمشتريات (وفواتير المبيعات لاحقاً) لا يحرسه قيد في جداولها (لا فهرس فريد يُضاف على `purchases`/`expenses`: مؤسساتٌ قائمة قد تحمل
 * تكراراً فيفشل `migrate --force` عند الإقلاع). الحجز جدولٌ مستقلٌّ يُدرَج في معاملة إنشاء المستند نفسها، وفهرسه الفريد هو الحكم عند التزامن:
 *   `(tenant_id, domain, dedupe_key)` — `dedupe_key` بصمة SHA-256 للمسند **الخاص بالمجال** (لا مفتاح مشترك بين مجالين).
 * `predicate` يحفظ المكوّنات القانونية (للمسند) بجانب البصمة غير القابلة للعكس، فيعاد اشتقاق المفتاح عند تعديل حقلٍ من المسند دون فقدان المرجع.
 *
 * عمر الحجز = عمر مستنده: يُحذف مع حذف المسودة في معاملتها (خدمة المستند لا المستورد)، ويبقى لمستند مرحَّل. لا علاقة FK بالمستند (متعدد الأشكال)؛
 * يرتبط بالمستأجر CASCADE كبقية الجداول. نموذجه `CompanyWide`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('import_document_reservations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('domain', 32);                       // expense | purchase | sales_invoice
            $table->char('dedupe_key', 64);                     // SHA-256 للمسند الخاص بالمجال
            $table->uuid('counterparty_id')->nullable();        // المورد/العميل إن وُجد (للتشخيص؛ ليس جزءاً من الفرادة بذاته)
            $table->string('document_type', 64);                // اسم المستند (expense | purchase | …)
            $table->uuid('document_id');
            $table->string('source', 24);                       // standard | ai_action | document_center | manual
            $table->json('predicate');                          // المكوّنات القانونية للمسند
            $table->timestamps();

            $table->unique(['tenant_id', 'domain', 'dedupe_key'], 'import_doc_reservation_unique');
            $table->unique(['tenant_id', 'document_type', 'document_id'], 'import_doc_reservation_document_unique');   // مستند واحد = حجز واحد
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('import_document_reservations');
    }
};
