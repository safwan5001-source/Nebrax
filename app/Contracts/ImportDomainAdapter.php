<?php

namespace App\Contracts;

use App\Support\ImportChunk;
use App\Support\ImportChunkResult;

/**
 * محوِّل مجال الاستيراد (IMP-H1-S2) — **نقطة الالتقاء الوحيدة** بين محرّك التشغيلات الدائمة (`ImportJobService`) وخدمة
 * المجال التي تتحقق وتطابق وتكتب. المحرّك لا يعرف مجالاً بعينه: يطلب من `ImportDomainRegistry` محوّل المجال ثم يستدعيه.
 *
 * قواعد العقد (انظر `docs/plans/imports/AWJ_UNIFIED_IMPORT_MASTER_HORIZON.md` §2.2):
 *  - المحوِّل **لا يكتب** إلا عبر خدمات المجال المعتمدة (لا `Model::create` لكيان أعمال، ولا قيد يومية مباشر).
 *  - المستندات المالية تُنشأ **مسودات** فقط؛ الترحيل فعلٌ منفصل بصلاحيته.
 *  - الاسم ليس معرّفاً أبداً.
 *  - وحدة التنفيذ (`unit()`) هي الأصغر التي لا تُجزَّأ: صفٌّ، أو ملفٌّ كامل، أو مستند (مجموعة صفوف) — فلا يمرّ مؤشّر
 *    المحرّك ولا حدّ الدفعة في منتصف وحدة (القاعدة 9).
 *
 * لا منطق صلاحيات هنا: بوابات كل مجال (RBAC + القدرة) تُفرض خارج المحوّل (شريحة IMP-H1-S1: `ImportJobAccess` على مستوى المتحكّم).
 */
interface ImportDomainAdapter
{
    /** وحدة تنفيذ لا تُجزَّأ: صفّ واحد. */
    public const UNIT_ROW = 'row';

    /** وحدة تنفيذ لا تُجزَّأ: الملف كلّه في معاملة واحدة. */
    public const UNIT_FILE = 'file';

    /** وحدة تنفيذ لا تُجزَّأ: مستند (مجموعة صفوف تخصّ مستنداً واحداً). */
    public const UNIT_DOCUMENT = 'document';

    /** مفتاح المجال (`ImportJobDomain`). */
    public function domain(): string;

    /** @return self::UNIT_* */
    public function unit(): string;

    /** سقف صفوف البيانات لهذا المجال عند الفحص الدائم. */
    public function maxRows(): int;

    /**
     * فحص هيكلي للملف المخزَّن: عدد صفوف البيانات الفعلية (بلا العناوين ولا الفارغة) وعدد الأعمدة.
     * يرمي `RuntimeException` برسالة عربية صالحة للعرض عند عدم صلاحية الهيكل.
     *
     * @return array{0: int, 1: int} [row_count, column_count]
     */
    public function inspect(string $tmpPath, string $extension): array;

    /**
     * إعادة حساب `row_count` عند أول ترحيل إن اختلف تعريفه عن وقت الفحص (تصحيح ذاتي لتشغيلات قديمة)؛ `null` = أبقِ
     * العدد المخزَّن. الأصل: لا إعادة حساب.
     */
    public function recountOnFirstApply(string $tmpPath, string $extension): ?int;

    /** يرحّل قطعة واحدة (وحدات كاملة فقط) ويُرجع عدد الوحدات المنجزة ونتيجة المجال. */
    public function applyChunk(ImportChunk $chunk): ImportChunkResult;
}
