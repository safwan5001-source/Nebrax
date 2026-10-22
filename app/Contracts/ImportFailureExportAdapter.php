<?php

namespace App\Contracts;

/**
 * قدرة اختيارية لمحوّل مجالٍ وحدته الصفّ (IMP-H1-S8a): يعلن أي أعمدة ملفّه **حسّاسة** كي يحجبها ملف الصفوف الفاشلة عمّن لا يملك
 * صلاحية الحقل الحسّاس (اليوم: التكلفة، `SensitiveCostPolicy`). المحوّل الذي لا يعلنها لا يُصدَّر له ملف فشل (فشلٌ مغلق: لا تسريب بالنسيان).
 */
interface ImportFailureExportAdapter
{
    /**
     * @param  array<int, string>  $headers  ترويسات الملف الأصلي
     * @param  array<string, mixed>  $frozenOptions  خيارات التشغيلة المجمَّدة (فيها `mapping` إن وُجدت)
     * @return list<int> فهارس الأعمدة الحسّاسة
     */
    public function sensitiveColumnIndexes(array $headers, array $frozenOptions): array;
}
