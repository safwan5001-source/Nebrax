<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;

/**
 * قاعدة العامل المهاجَرة بلا معاملة مُغلِّفة، لاختبارات `pcntl_fork` على PostgreSQL.
 *
 * العمليات الفرعية تحتاج صفوفاً مثبَّتة فلا تصلح المعاملة المُغلِّفة، لكن صنفاً بلا أيٍّ من سمات قاعدة البيانات يعمل على قاعدة الـCI
 * الأساسية المشتركة بين كل عمّال ParaTest. وصف المنصة (الإيقاف الطارئ) عالميّ لا يخصّ مستأجراً، فيحذفه تنظيفُ صنفٍ في عاملٍ آخر
 * أثناء اختبار حدٍّ يعتمد عليه. وجود `RefreshDatabase` يحوّل العامل إلى قاعدته الخاصة (`…_test_N`) ويهاجرها مرة لكل عملية؛
 * وإبطال `beginDatabaseTransaction` يُبقي الكتابات مثبَّتة كما كانت.
 */
trait UsesWorkerDatabaseWithoutTransaction
{
    use RefreshDatabase;

    public function beginDatabaseTransaction(): void
    {
        // عمداً: لا معاملة مُغلِّفة.
    }
}
