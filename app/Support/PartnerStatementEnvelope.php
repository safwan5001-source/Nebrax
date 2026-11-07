<?php

namespace App\Support;

/**
 * AIA-0.1 — غلاف السلامة المالية (Verified Report Envelope) لكشف حساب الطرف في الـ Public API.
 *
 * يبني **الحقول الإضافية** فقط (`role`, `row_count`, `totals`, `balance_convention`, `position`, `display`,
 * `minor_unit_exponent`, `integrity`, `report_status`)؛ الحقول القديمة يبقيها المتحكّم حرفياً.
 * الخادم يحسب ويتحقق وينسّق، والوكيل **يقتبس** ولا يحسب.
 *
 * - **الاتجاه** (لا يُقلب في الحقول القديمة): الرصيد الجاري = مدين − دائن لكل الأدوار؛ الموجب = الطرف مدين لنا
 *   (`receivable`)، السالب = نحن مدينون له (`payable`). مورد برصيد دائن ⇒ `payable`. الجانب يُحدَّد من إشارة الرصيد
 *   لا من الدور؛ ويُعلَم `opposite_sign` حين يخالف الدورَ المتوقع (عميل دائن / مورد مدين).
 * - **العملة (D-12 الخيار C):** `SAR` فقط ⇒ `minor_unit_exponent = 2` و`display` عبر `Money::toRiyal` (لا تعديل عليها).
 *   غيرها ⇒ `report_status = unsupported` بلا `display` ولا `position`، والقيم الخام القديمة تبقى للتوافق دون ادعاء
 *   صحتها كوحدات فعلية.
 * - **`report_status`**: `final` فقط حين العملة مدعومة وكل الفحوص ناجحة والنتيجة كاملة؛ وإلا `unverified` (فحص فشل)
 *   أو `partial` (نتيجة غير مكتملة) أو `unsupported`. لا `display` ولا `position` إلا مع `final`/`partial` سليمين.
 * - لا `float` ولا تقريب ولا قسمة هنا؛ الحساب كله في `StatementIntegrity` بأعداد صحيحة، وحدّ `2^53−1` يسري على كل مجموع
 *   ورصيد وسيط محسوب. عند فشل الجمع تكون `totals.debit_minor/credit_minor/net_minor = null` (لا إجماليات جزئية مضللة).
 * - `row_count_matches_rows` ليس إثبات اكتمال مستقلاً (العددان مشتقان من الصفوف نفسها)؛ الاكتمال المستقل في AIA-0.2.
 */
final class PartnerStatementEnvelope
{
    public const STATUS_FINAL = 'final';
    public const STATUS_PARTIAL = 'partial';
    public const STATUS_UNVERIFIED = 'unverified';
    public const STATUS_UNSUPPORTED = 'unsupported';

    public const SIDE_RECEIVABLE = 'receivable';
    public const SIDE_PAYABLE = 'payable';
    public const SIDE_SETTLED = 'settled';

    /** ما لا تغطيه الفحوص صراحةً: يُعلَن كي لا يُقرأ «verified» كمطابقة مع دفاتر أخرى. */
    private const NOT_CHECKED = [
        'role_attribution_independent_verification',
        'source_documents_reconciliation',
        // AIA-0.1 لا يملك مصدراً مستقلاً لعدد الحركات المتوقع؛ تحقق الاكتمال المستقل مؤجَّل إلى AIA-0.2.
        'completeness_independent_verification',
    ];

    /**
     * @param  array{partner?:array, opening_balance:mixed, rows:array, closing_balance:mixed}  $statement  ناتج `ReportService::partnerStatement` كما هو
     * @param  mixed  $currency  رمز عملة المستأجر كما خُزِّن
     * @param  bool  $complete  `false` ⇒ نتيجة جزئية (لا `final`)
     * @param  int|null  $emittedRowCount  عدد الصفوف المُخرَجة في الاستجابة فعلاً. المقارنة به تحرس طبقة التسلسل فقط
     *                                     (صف مفقود/مكرَّر)، **وليست إثبات اكتمال مستقلاً** لأن العددين مشتقان من المصفوفة نفسها (AIA-0.2).
     * @return array<string, mixed>
     */
    public static function build(array $statement, ?string $role, mixed $currency, bool $complete = true, ?int $emittedRowCount = null): array
    {
        $rows = $statement['rows'] ?? [];
        $evaluation = StatementIntegrity::evaluate(
            $statement['opening_balance'] ?? null,
            $rows,
            $statement['closing_balance'] ?? null,
            $emittedRowCount,
        );

        $exponent = CurrencyMinorUnits::exponentFor($currency);
        $totals = $evaluation['totals'];

        if ($exponent === null) {
            $status = self::STATUS_UNSUPPORTED;
            $integrityStatus = 'unsupported';
        } elseif (! $evaluation['passed']) {
            $status = self::STATUS_UNVERIFIED;
            $integrityStatus = 'failed';
        } else {
            $status = $complete ? self::STATUS_FINAL : self::STATUS_PARTIAL;
            $integrityStatus = 'verified';
        }

        $integrity = ['status' => $integrityStatus, 'checks' => $evaluation['checks'], 'not_checked' => self::NOT_CHECKED];
        if ($integrityStatus === 'unsupported') {
            $integrity['reason'] = 'currency_exponent_unsupported';
        }
        if ($evaluation['failed'] !== []) {
            $integrity['failed_checks'] = $evaluation['failed'];
        }

        $trusted = $exponent !== null && $evaluation['passed'];

        return [
            'role' => $role,
            'row_count' => $totals['row_count'],
            'totals' => $totals,
            'balance_convention' => [
                'formula' => 'debit_minus_credit',
                'positive_means' => 'partner_owes_us',
                'negative_means' => 'we_owe_partner',
            ],
            'position' => $trusted ? self::position($statement, $role) : null,
            'display' => $trusted ? self::display($statement, $totals, (string) CurrencyMinorUnits::normalize($currency)) : null,
            'minor_unit_exponent' => $exponent,
            'integrity' => $integrity,
            'report_status' => $status,
        ];
    }

    /** جانب الرصيد من إشارته: سالب ⇒ نحن مدينون (payable)، موجب ⇒ الطرف مدين لنا (receivable). */
    public static function sideOf(int $net): string
    {
        return $net < 0 ? self::SIDE_PAYABLE : ($net > 0 ? self::SIDE_RECEIVABLE : self::SIDE_SETTLED);
    }

    /** @return array{opening: array, closing: array} */
    private static function position(array $statement, ?string $role): array
    {
        $expected = in_array($role, ['customer', 'supplier'], true)
            ? $role
            : (in_array($statement['partner']['type'] ?? null, ['customer', 'supplier'], true) ? $statement['partner']['type'] : null);

        $describe = static function (int $balance) use ($expected): array {
            $side = self::sideOf($balance);

            return [
                'side' => $side,
                'amount_minor' => abs($balance),
                // خلاف الدور المتوقع: عميل دائن (payable) أو مورد مدين (receivable). يتطلب دوراً معلوماً.
                'opposite_sign' => ($expected === 'customer' && $side === self::SIDE_PAYABLE)
                    || ($expected === 'supplier' && $side === self::SIDE_RECEIVABLE),
            ];
        };

        return ['opening' => $describe($statement['opening_balance']), 'closing' => $describe($statement['closing_balance'])];
    }

    /**
     * نصوص جاهزة بصيغة `Money::toRiyal` حرفياً (أرقام 0–9، نقطة عشرية، بلا فاصل آلاف). الإجماليات والأرصدة المطلقة
     * بجانب صريح؛ `net` بإشارته.
     *
     * @param  array{debit_minor:int, credit_minor:int, net_minor:int, row_count:int}  $totals  غير فارغة هنا: لا يُستدعى إلا والفحوص ناجحة
     * @return array<string, mixed>
     */
    private static function display(array $statement, array $totals, string $currency): array
    {
        $opening = $statement['opening_balance'];
        $closing = $statement['closing_balance'];

        return [
            'currency' => $currency,
            'minor_unit_exponent' => 2,
            'opening' => Money::toRiyal(abs($opening)),
            'opening_side' => self::sideOf($opening),
            'debit' => Money::toRiyal($totals['debit_minor']),
            'credit' => Money::toRiyal($totals['credit_minor']),
            'net' => Money::toRiyal($totals['net_minor']),
            'closing' => Money::toRiyal(abs($closing)),
            'closing_side' => self::sideOf($closing),
        ];
    }
}
