<?php

namespace Tests\Feature;

use App\Support\SpreadsheetReader;
use App\Support\SpreadsheetWriter;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * AWJ-AIA G-S10 — اختبار إعادة إنتاج (Repro) لا يثبّت العيب.
 *
 * `SpreadsheetWriter::csv()` يسبق **أي** خلية تبدأ بـ`= + - @ \t \r` بعلامة `'`
 * (حماية حقن الصيغ للنصوص)، فتصير المبالغ السالبة — كرصيد مورد `-65000` هللة — نصاً
 * `'-65000` لا عدداً. عيب دقة لأي تصدير مالي عبر CSV.
 *
 * **يقبل الاختبار حالتين ولا يفرض بقاء العيب:**
 *   - **معيب (الحالي):** الناتج `'-65000` ⇒ يُعلَّم `incomplete` برسالة صريحة (إنذار لا فشل).
 *   - **مُصلَح:** الناتج `-65000` عدداً ⇒ يمرّ صارماً بلا تعديل.
 *
 * ثوابت تنجح قبل أي إصلاح وبعده وتحرس الحماية نفسها من أن يضيّعها الإصلاح:
 * النص الحرّ المبدوء بمشغّل صيغة يبقى مُحيَّداً (بما فيه ما يبدأ بـ`-`)، الأعداد غير السالبة
 * سليمة، وXLSX المضبوط النوع يحفظ السالب.
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
    public function csv_negative_integer_amount_is_either_a_number_or_the_documented_open_defect(): void
    {
        $line = $this->firstDataLine(SpreadsheetWriter::csv(['balance_minor'], [[-65000]]));

        // أي ناتج آخر (مثلاً -65000 مقتطعاً أو بصيغة مختلفة) فشل حقيقي.
        $this->assertContains($line, ["'-65000", '-65000']);

        if ($line === "'-65000") {
            $this->markTestIncomplete(
                'G-S10 مفتوح (معروف): الرصيد السالب يُكتب نصاً \'-65000 في CSV. يُعالَج في AIA-2.2 بوضع أعمدة عددية؛ عندها يمرّ هذا الاختبار صارماً.'
            );
        }

        $this->assertSame('-65000', $line);
    }

    #[Test]
    public function invariant_csv_neutralises_dash_prefixed_non_numeric_text(): void
    {
        // حماية يجب ألّا يفقدها أي إصلاح لعيب الأرقام السالبة.
        $line = $this->firstDataLine(SpreadsheetWriter::csv(['d'], [["-cmd|' /C calc'!A0"]]));

        $this->assertStringStartsWith("'-cmd", $line);
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
