<?php

namespace Tests\Feature;

use App\Support\SpreadsheetReader;
use App\Support\SpreadsheetWriter;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * AWJ-AIA G-S10 — اختبار إعادة إنتاج (Characterization)، لا إصلاح.
 *
 * يوثّق أن `SpreadsheetWriter::csv()` يسبق **أي** خلية تبدأ بـ`= + - @ \t \r` بعلامة `'`
 * (حماية حقن الصيغ للنصوص)، فتصير المبالغ السالبة — كرصيد مورد `-65000` هللة — نصاً
 * `'-65000` لا عدداً. هذا مقبول لمستهلكي التصدير الحاليين (منتجات/مخزون: لا أعداد
 * سالبة مقصودة) لكنه عيب دقة لأي تصدير مالي عبر CSV.
 *
 * يصف السلوك الحالي وينجح عليه. عند إضافة وضع الأعمدة العددية (AIA-2.2) تُضاف
 * اختبارات الوضع الجديد، ويبقى هذا الاختبار حارساً لسلوك الوضع الافتراضي القائم
 * (لا تغيير لمستهلكيه الحاليين).
 *
 * تشغيل: php artisan test --filter=SpreadsheetWriterNegativeAmountReproTest
 */
class SpreadsheetWriterNegativeAmountReproTest extends TestCase
{
    /** السطر الثاني (بعد الترويسة) من ناتج CSV بلا BOM. */
    private function firstDataLine(string $csv): string
    {
        $lines = explode("\r\n", ltrim($csv, "\xEF\xBB\xBF"));

        return $lines[1];
    }

    #[Test]
    public function csv_prefixes_a_negative_integer_amount_with_an_apostrophe(): void
    {
        $line = $this->firstDataLine(SpreadsheetWriter::csv(['balance_minor'], [[-65000]]));

        // الواقع الحالي: نص مسبوق بـ' (ليس عدداً). الرصيد المورّد السالب يُفسد في أي أداة تقرأ العمود عدداً.
        $this->assertSame("'-65000", $line);
        $this->assertNotSame('-65000', $line);
    }

    #[Test]
    public function csv_leaves_non_negative_integers_and_plain_text_intact(): void
    {
        $line = $this->firstDataLine(SpreadsheetWriter::csv(['a', 'b', 'c'], [[0, 115000, 'مورد']]));

        $this->assertSame('0,115000,مورد', $line);
    }

    #[Test]
    public function csv_still_neutralises_formula_text_which_is_the_protection_to_preserve(): void
    {
        $line = $this->firstDataLine(SpreadsheetWriter::csv(['d'], [['=HYPERLINK("http://x")']]));

        $this->assertStringStartsWith("\"'=HYPERLINK", $line);
    }

    #[Test]
    public function xlsx_with_a_typed_number_column_preserves_the_negative_amount(): void
    {
        $path = tempnam(sys_get_temp_dir(), 'awj-neg-').'.xlsx';

        try {
            SpreadsheetWriter::xlsx($path, ['balance_minor'], [[-65000]], [SpreadsheetWriter::TYPE_NUMBER]);

            $read = SpreadsheetReader::read($path, 'xlsx', 10, 10);
        } finally {
            @unlink($path);
        }

        $flat = json_encode($read);
        $this->assertStringContainsString('-65000', $flat);
        $this->assertStringNotContainsString("'-65000", $flat);
    }
}
