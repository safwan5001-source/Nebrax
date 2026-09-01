<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * أساس متحكّمات الـ Public API القرائية (PR-3).
 *
 * لا يحمل منطق أعمال: يوفّر فقط تقسيمًا مقيَّدًا وفرزًا بقائمة سماح — فالموارد
 * تستعلم نماذج المستأجر المعزولة مباشرةً (عزل `TenantScope` قائم) وتعيد موارد
 * Public مخصّصة عبر `PublicApiResponse`. لا كتابة، ولا مسارات ذات أثر جانبي.
 */
abstract class PublicApiController extends Controller
{
    private const DEFAULT_PER_PAGE = 25;
    private const MAX_PER_PAGE = 100;

    /** حجم صفحة مقيَّد بسقف صلب — لا قوائم غير محدودة. */
    protected function perPage(Request $request): int
    {
        $requested = (int) $request->integer('per_page', self::DEFAULT_PER_PAGE);
        if ($requested < 1) {
            $requested = self::DEFAULT_PER_PAGE;
        }

        return min(self::MAX_PER_PAGE, $requested);
    }

    /**
     * فرز حتميّ بقائمة سماح صارمة + مِرساة `id` كسر تعادل. لا يُمرَّر اسم عمود من
     * العميل مباشرةً إلى `orderBy` أبدًا. حقل فرز غير مدعوم → خطأ تحقّق (422).
     *
     * @param  array<string, string>  $allowed  مفتاح العميل → عمود قاعدة البيانات
     */
    protected function applySort(Builder $query, ?string $sort, array $allowed, string $default): void
    {
        $sort = trim((string) ($sort ?? ''));
        if ($sort === '') {
            $sort = $default;
        }

        $direction = str_starts_with($sort, '-') ? 'desc' : 'asc';
        $field = ltrim($sort, '-');

        if (! array_key_exists($field, $allowed)) {
            throw ValidationException::withMessages([
                'sort' => "حقل فرز غير مدعوم: «{$field}».",
            ]);
        }

        $query->orderBy($allowed[$field], $direction)->orderByDesc('id');
    }

    /** بحث LIKE آمن: يهرّب محارف النمط، ويبقى داخل predicate المستأجر. */
    protected function likeTerm(string $search): string
    {
        return '%'.addcslashes(trim($search), '%_\\').'%';
    }
}
