<?php

namespace App\Support;

use App\Models\FiscalYearClose;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * ═══════════════════════════════════════════════════════════════
 *  هوية قيد الإقفال السنوي — بنيويّة لا نصّية (FISCAL-2)
 * ═══════════════════════════════════════════════════════════════
 *  قيد الإقفال يُعرَف بعلاقته بنموذجه: `source_type = FiscalYearClose` و
 *  `source_id = <معرّف الجيل>`. **ممنوع** التعرّف عليه بوصفٍ نصّي أو رقم قيد
 *  أو كود حساب (FISCAL-1، «no text-based close detection») — الوصف يتغيّر
 *  بالترجمة وبتعديل المستخدم، والكود يتغيّر بإعادة التوجيه.
 *
 *  و«قيد إقفال» هنا يشمل **العاكس أيضاً**: عند فتح سنة يُنشئ
 *  `LedgerService::reverse()` قيداً مرتبطاً بالأصل عبر `reversal_of` بلا
 *  `source_type` خاص به. لو استُثني الأصل وحده من قائمة الدخل لظهرت سطور
 *  العاكس فيها بعد الفتح فقلبت إشارة السنة رأساً على عقب.
 *
 *  القاعدة الحاكمة لاستعماله:
 *   • قائمة الدخل التاريخية  → **تستثني** (وإلا ظهرت السنة المقفلة بصفر).
 *   • حساب الإقفال نفسه      → **يستثني** (يُقفل ما أنتجته العمليات فقط).
 *   • ميزان المراجعة والأستاذ والميزانية → **تشمل** (قيدٌ حقيقيّ في الدفاتر).
 */
final class FiscalCloseJournals
{
    /**
     * يقصر استعلام `journal_entries` على ما **ليس** قيد إقفال ولا عاكسَ قيد إقفال.
     *
     * يُطبَّق داخل `whereHas('entry', ...)` حيث يكون الجدول باسمه غير المُلقَّب،
     * فيستعمل هنا لقباً (`fiscal_close_source`) للانضمام الذاتي بلا تصادم.
     *
     * @param  Builder<\App\Models\JournalEntry>|QueryBuilder  $query
     */
    public static function exclude($query): void
    {
        $query
            ->where(function ($entry) {
                $entry->whereNull('journal_entries.source_type')
                    ->orWhere('journal_entries.source_type', '!=', FiscalYearClose::class);
            })
            ->whereNotExists(function ($sub) {
                $sub->select(DB::raw(1))
                    ->from('journal_entries as fiscal_close_source')
                    ->whereColumn('fiscal_close_source.id', 'journal_entries.reversal_of')
                    // العزل صريح لا اتّكالاً على `TenantScope`: هذا استعلام
                    // خام لا يمرّ بالنطاق العام للنموذج.
                    ->whereColumn('fiscal_close_source.tenant_id', 'journal_entries.tenant_id')
                    ->where('fiscal_close_source.source_type', FiscalYearClose::class);
            });
    }

    /** عكس `exclude()`: يقصر الاستعلام على قيود الإقفال وعواكسها وحدها. */
    public static function only($query): void
    {
        $query->where(function ($entry) {
            $entry->where('journal_entries.source_type', FiscalYearClose::class)
                ->orWhereExists(function ($sub) {
                    $sub->select(DB::raw(1))
                        ->from('journal_entries as fiscal_close_source')
                        ->whereColumn('fiscal_close_source.id', 'journal_entries.reversal_of')
                        ->whereColumn('fiscal_close_source.tenant_id', 'journal_entries.tenant_id')
                        ->where('fiscal_close_source.source_type', FiscalYearClose::class);
                });
        });
    }
}
