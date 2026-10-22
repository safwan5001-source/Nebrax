<?php

namespace App\Services;

use App\Http\Middleware\EnsureApplicationActive;
use App\Support\ImportJobDomain;
use App\Support\Rbac;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * تفويض تشغيلات الاستيراد الدائم **حسب المجال** (IMP-H1-S1).
 *
 * كانت مسارات `/import-jobs` كلها مقيَّدة بـ`products.view|manage` فقط، فيرث أي مجال (مثل
 * `inventory_opening`) صلاحيات المنتجات ولا يخضع لقدرته (`inventory.core`) التي تفرضها واجهته المباشرة.
 * هنا بوابات المجال الفعلية (`ImportJobDomain::authorization`):
 *   ١. صلاحية RBAC — نفس فحص `EnsurePermission` ورسالته.
 *   ٢. قدرة التطبيق — **نفس** `EnsureApplicationActive::authorize` (لا نسخة ثانية من القواعد):
 *      `suspended` قراءة فقط، و`disabled` ممنوعة، والإنفاذ التجاري والمراقبة الظلية محفوظان.
 * الترتيب كما في المسارات الثابتة: صلاحية ثم قدرة.
 */
class ImportJobAccess
{
    public function __construct(private readonly EnsureApplicationActive $applications) {}

    /** عرض تشغيلة (GET): صلاحية العرض + القدرة (المعلّقة تسمح بالقراءة). */
    public function assertView(Request $request, string $domain): void
    {
        $this->assert($request, $domain, 'view');
    }

    /** إنشاء/ترحيل/إلغاء تشغيلة: صلاحية الإدارة + القدرة (المعلّقة تمنع الكتابة). */
    public function assertManage(Request $request, string $domain): void
    {
        $this->assert($request, $domain, 'manage');
    }

    /**
     * المجالات التي يجوز لهذا المستخدم **عرضها** الآن — لتصفية القائمة بلا 403. تستعمل البوابة
     * نفسها (فلا تظهر تشغيلات مجالٍ لا يملك المستخدم صلاحيته أو قدرته معطّلة).
     *
     * @return list<string>
     */
    public function viewableDomains(Request $request): array
    {
        $allowed = [];
        foreach (ImportJobDomain::values() as $domain) {
            try {
                $this->assertView($request, $domain);
                $allowed[] = $domain;
            } catch (HttpException $e) {
                if ($e->getStatusCode() !== 403) {
                    throw $e;
                }
            }
        }

        return $allowed;
    }

    private function assert(Request $request, string $domain, string $level): void
    {
        $gates = ImportJobDomain::authorization($domain);

        $user = $request->user();
        if (! $user || ! Rbac::allows((string) $user->role, $gates[$level])) {
            abort(403, 'ليس لديك صلاحية لتنفيذ هذا الإجراء.');
        }

        if ($gates['app'] !== null) {
            $this->applications->authorize($request, $gates['app']);
        }
    }
}
