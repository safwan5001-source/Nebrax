<?php

namespace App\Support;

use InvalidArgumentException;

/**
 * مفردات scopes الـ Public API — صريحة، محدودة، وقابلة للتوسّع.
 *
 * القيمة النصّية جزء من العقد العام (لا تتغيّر بعد النشر). المطابقة دائمًا **تامّة**
 * (لا wildcard، لا substring). كل scope يُسقَط على صلاحية RBAC قائمة — بذرة seam
 * التفويض لموارد PR-3 (لا يُنفَّذ الإسقاط الآن، فلا موارد بعد).
 *
 * **قرار تسمية موثَّق (partners لا customers):** يعتمد المستودع نموذج `Partner`
 * (العميل طرفٌ بنوع customer، والمورّد بنوع supplier) وصلاحية `partners.view`.
 * فالـ scope القانوني هو `partners:read` حفاظًا على مصطلح المستودع ومطابقة 1:1 مع
 * RBAC، لا `customers:read`. تُعرَّف scopes الكتابة مستقبلًا (`*:write`) دون كسر هذا.
 */
enum PublicApiScope: string
{
    case PARTNERS_READ = 'partners:read';
    case PRODUCTS_READ = 'products:read';
    case INVOICES_READ = 'invoices:read';

    // ── Write (PR-5) — كتابة محكومة. مطابقة تامّة، لا wildcard؛ القراءة لا تعني الكتابة.
    case PARTNERS_WRITE = 'partners:write';
    case PRODUCTS_WRITE = 'products:write';
    case INVOICES_WRITE = 'invoices:write';

    /** صلاحية الأعمال المقابلة في المستودع (القراءة view، والكتابة manage). */
    public function permission(): string
    {
        return match ($this) {
            self::PARTNERS_READ  => 'partners.view',
            self::PRODUCTS_READ  => 'products.view',
            self::INVOICES_READ  => 'invoices.view',
            self::PARTNERS_WRITE => 'partners.manage',
            self::PRODUCTS_WRITE => 'products.manage',
            self::INVOICES_WRITE => 'invoices.manage',
        };
    }

    public static function isKnown(string $scope): bool
    {
        return self::tryFrom($scope) !== null;
    }

    /** @return list<string> كل الـ scopes المعروفة (لرسائل الأدوات والتحقّق). */
    public static function all(): array
    {
        return array_map(static fn (self $scope): string => $scope->value, self::cases());
    }

    /**
     * تحقّق قائمة scopes مطلوبة وتطبيعها: يرفض الفارغ والمجهول و`*` صراحةً،
     * ويزيل التكرار مع حفظ الترتيب. يُستعمل عند إصدار المفاتيح فلا يحمل مفتاحٌ
     * قطّ scope غير معروف أو wildcard.
     *
     * @param  array<int, string>  $scopes
     * @return list<string>
     *
     * @throws InvalidArgumentException
     */
    public static function sanitize(array $scopes): array
    {
        $clean = [];

        foreach ($scopes as $scope) {
            $scope = trim((string) $scope);

            if ($scope === '' || ! self::isKnown($scope)) {
                throw new InvalidArgumentException("scope غير معروف: «{$scope}».");
            }

            $clean[$scope] = $scope;
        }

        return array_values($clean);
    }
}
