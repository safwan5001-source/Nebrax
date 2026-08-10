<?php

namespace App\Support;

use App\Models\DocumentRevision;

/**
 * حاملُ قيود السجلّ الجارية — **مربوط `scoped()` لا `singleton()`**.
 *
 * الخدمة تكتب الرأس ثم الإجماليات في نداءين، فلولا الدمج لظهر التعديل الواحد
 * سجلَّين. والدمج يحتاج ذاكرةً تعيش **عمر وحدة العمل الواحدة ثم تموت**:
 *
 *  - `static` كانت ستعيش عمر عامل الطابور كلّه.
 *  - و`scoped` وحدها لا تكفي: في الاختبارات (وOctane) تُخدَم عدّة طلبات في
 *    الحاوية نفسها، فيُدمج تعديلُ طلبٍ لاحق في قيد إنشاءِ طلبٍ سابق.
 *
 * فالحدّ الحقيقي هو **المعاملة**: `RecordsRevisions` يُسقط المفتاح عند إتمام
 * المعاملة الخارجية (`afterCommit`)، فتبدأ كل عملية بذاكرة نظيفة.
 */
class RevisionBuffer
{
    /** @var array<string, DocumentRevision> */
    private array $entries = [];

    public function get(string $key): ?DocumentRevision
    {
        return $this->entries[$key] ?? null;
    }

    public function put(string $key, DocumentRevision $revision): void
    {
        $this->entries[$key] = $revision;
    }

    public function forget(string $key): void
    {
        unset($this->entries[$key]);
    }
}
