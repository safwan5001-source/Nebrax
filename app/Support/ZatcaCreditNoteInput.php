<?php

namespace App\Support;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use InvalidArgumentException;

/**
 * مدخلات بانيّ XML إشعار الدائن (381) — REM-18a. قيمة ثابتة: كل ما يدخل المستند **صريح ومتحقَّق منه** هنا، وأي ناقص أو
 * مجهول يُرفض (فشل مغلق) بدل أن يُستنتج:
 *
 *  • التصنيف `standard|simplified` حرفياً — لا قيمة افتراضية ولا تطبيع حروف (يأتي من الفاتورة الأصلية، لا من الإشعار).
 *  • مرجع الفاتورة الأصلية (BT-25) رقمٌ صريح وحيد؛ نطاق «من–إلى» لعدة فواتير (DTG §4.3) خارج النطاق.
 *  • السبب (KSA-10) رمزٌ من `ZatcaNoteReason` الخمسة؛ لا نصّ حرّ ولا ربط تلقائي.
 *  • وسيلة الدفع: `cash` فقط ⇒ `PaymentMeansCode 10` (الدليل الوحيد: عيّنات ZATCA)؛ `credit` لا رمز موثَّقاً له فيُرفض
 *    (قرار D4 مفتوح). SDK لا يتحقق من قيمة الرمز، فالقيد هنا قيد AWJ لا قاعدة SDK.
 *  • لقطة الطرفين v1 مُمرَّرة صراحةً (عادةً لقطة الفاتورة الأصلية)؛ ولحظة الإصدار وUUID وICV وPIH مُمرَّرة — الصنف لا
 *    يقرأ ساعة ولا قاعدة بيانات ولا إعدادات.
 *  • المبالغ كما خُزِّنت: يُتحقَّق من اتّساقها (مجموع الأسطر = رأس الإشعار) ولا يُعاد حسابها.
 *
 * العملة SAR ثابتة كما في الفاتورة (لا عمود عملة في أي مستند).
 */
final class ZatcaCreditNoteInput
{
    /** القيمة الوحيدة الموثَّقة لـ `PaymentMeansCode` (UNTDID 4461 = نقداً) — عيّنات ZATCA الرسمية للإشعار الدائن. */
    public const PAYMENT_MEANS_CASH = '10';

    public const CLASSIFICATIONS = ['standard', 'simplified'];

    /** حدّ BT-1 في قاموس البيانات: 1–127 حرفاً. */
    private const MAX_NUMBER_LENGTH = 127;

    public readonly CarbonImmutable $issuedAt;

    /** @var array{seller: array<string, mixed>, buyer: array<string, mixed>} */
    public readonly array $parties;

    public readonly string $paymentMeansCode;

    /**
     * @param list<ZatcaCreditNoteLine> $lines
     * @param array<string, mixed>|string|null $partySnapshot لقطة v1 (مصفوفة أو JSON)
     */
    public function __construct(
        public readonly string $number,
        public readonly string $uuid,
        public readonly int $icv,
        public readonly string $previousHash,
        CarbonInterface $issuedAt,
        public readonly string $classification,
        mixed $partySnapshot,
        public readonly string $originalInvoiceNumber,
        public readonly string $reasonCode,
        string $refundType,
        public readonly int $subtotal,
        public readonly int $taxAmount,
        public readonly int $total,
        public readonly array $lines,
    ) {
        self::assertText($number, 'رقم الإشعار', self::MAX_NUMBER_LENGTH);
        self::assertText($originalInvoiceNumber, 'رقم الفاتورة الأصلية (BT-25)', self::MAX_NUMBER_LENGTH);

        if (preg_match('/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i', $uuid) !== 1) {
            throw new InvalidArgumentException('UUID الإشعار (KSA-1) غير صالح.');
        }
        if ($icv < 1) {
            throw new InvalidArgumentException('عدّاد الإشعار ICV يبدأ من 1.');
        }
        self::assertPreviousHash($previousHash);

        if (! in_array($classification, self::CLASSIFICATIONS, true)) {
            throw new InvalidArgumentException('تصنيف مستند ZATCA غير معروف؛ المقبول standard أو simplified فقط ولا يُستنتج.');
        }
        if (! ZatcaNoteReason::isKnown($reasonCode)) {
            throw new InvalidArgumentException('سبب إصدار الإشعار غير معتمد؛ يجب أن يكون أحد أسباب قاموس بيانات ZATCA الخمسة (KSA-10).');
        }
        $this->paymentMeansCode = match ($refundType) {
            'cash' => self::PAYMENT_MEANS_CASH,
            'credit' => throw new InvalidArgumentException(
                'لا رمز PaymentMeansCode موثَّقاً لإشعار التخفيض من الذمّة (credit)؛ القرار D4 مفتوح ولا يُخترع رمز.'
            ),
            default => throw new InvalidArgumentException('نوع التسوية غير معروف؛ المقبول cash فقط في هذا الإصدار.'),
        };

        $this->issuedAt = CarbonImmutable::instance($issuedAt)->setTimezone('UTC');
        $this->parties = ZatcaPartyXml::requireSnapshotArray($partySnapshot);

        if ($lines === [] || ! array_is_list($lines)) {
            throw new InvalidArgumentException('الإشعار يحتاج سطراً واحداً على الأقل.');
        }
        $net = 0;
        $tax = 0;
        foreach ($lines as $line) {
            if (! $line instanceof ZatcaCreditNoteLine) {
                throw new InvalidArgumentException('سطر إشعار غير صالح.');
            }
            $net += $line->net();
            $tax += $line->lineTax;
        }
        if ($subtotal !== $net || $taxAmount !== $tax || $total !== $subtotal + $taxAmount) {
            throw new InvalidArgumentException('مجاميع الإشعار لا تطابق أسطره؛ لا يُعاد حسابها ولا يُخرَج XML متناقض.');
        }
        if ($total <= 0) {
            throw new InvalidArgumentException('إجمالي الإشعار يجب أن يكون موجباً.');
        }
    }

    /** كل الأسطر S/15 (شرط `TaxSubtotal` — لا تصنيف لغير 15، REM-16). */
    public function allStandardRated(): bool
    {
        foreach ($this->lines as $line) {
            if (! ZatcaMonetaryXml::isStandardRate($line->taxRate)) {
                return false;
            }
        }

        return true;
    }

    private static function assertText(string $value, string $label, int $max): void
    {
        if ($value === '' || trim($value) !== $value) {
            throw new InvalidArgumentException("{$label} مطلوب بلا مسافات في طرفيه.");
        }
        if (preg_match('//u', $value) !== 1 || preg_match('/[\x00-\x1F\x7F]/', $value) === 1) {
            throw new InvalidArgumentException("{$label} يحتوي محارف تحكّم أو ترميزاً غير صالح.");
        }
        if (mb_strlen($value) > $max) {
            throw new InvalidArgumentException("{$label} يتجاوز {$max} حرفاً.");
        }
    }

    /** PIH: Base64 قياسي لهاش SHA-256 (32 بايت) أو لـ genesis (نصّ ست عشري من 64 بايت) — لا غير. */
    private static function assertPreviousHash(string $value): void
    {
        $decoded = base64_decode($value, true);
        if ($decoded === false || base64_encode($decoded) !== $value || ! in_array(strlen($decoded), [32, 64], true)) {
            throw new InvalidArgumentException('الهاش السابق (PIH) يجب أن يكون Base64 قياسياً لهاش SHA-256 أو لقيمة genesis الرسمية.');
        }
    }
}
