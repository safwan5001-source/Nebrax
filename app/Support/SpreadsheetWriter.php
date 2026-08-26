<?php

namespace App\Support;

use RuntimeException;
use ZipArchive;

/**
 * كاتب جداول موحّد لملفات التبادل: CSV و XLSX.
 *
 * يقابل `SpreadsheetReader` ويشاركه العلّة نفسها: ورقة واحدة من قيم بسيطة،
 * فلا مبرّر لحزمة خارجية. الكتابة تعتمد النصوص المضمّنة (`inlineStr`) بدل
 * جدول النصوص المشتركة، فلا تحتاج تمريرة ثانية على البيانات ولا ذاكرة تتراكم.
 *
 * **قاعدة النوع:** ما يُقرأ لاحقاً كمعرّف (رمز الصنف، الباركود، UUID) يُكتب
 * نصّاً كي لا يُسقط Excel أصفاره البادئة أو يحوّله إلى صيغة علمية. وما هو مبلغ
 * أو كمية يُكتب رقماً كي يُجمَع ويُفرَز في Excel كرقم لا كنص.
 */
class SpreadsheetWriter
{
    public const TYPE_TEXT = 's';
    public const TYPE_NUMBER = 'n';

    /** نمط الأرقام العشرية (منزلتان) — فهرسه 1 في `styles.xml` أدناه. */
    private const STYLE_DECIMAL = 1;

    /**
     * CSV متوافق مع Excel العربي: BOM ثم أسطر CRLF.
     *
     * @param  array<int, string>  $headers
     * @param  iterable<int, array<int, string|int|null>>  $rows
     */
    public static function csv(array $headers, iterable $rows): string
    {
        $lines = [self::csvLine($headers)];
        foreach ($rows as $row) {
            $lines[] = self::csvLine($row);
        }

        return "\xEF\xBB\xBF".implode("\r\n", $lines)."\r\n";
    }

    /**
     * يكتب CSV مباشرة إلى المخرَج (بلا تجميع كامل في الذاكرة).
     *
     * @param  array<int, string>  $headers
     * @param  iterable<int, array<int, string|int|null>>  $rows
     */
    public static function streamCsv(array $headers, iterable $rows): void
    {
        echo "\xEF\xBB\xBF".self::csvLine($headers)."\r\n";
        foreach ($rows as $row) {
            echo self::csvLine($row)."\r\n";
        }
    }

    /** @param array<int, string|int|null> $values */
    private static function csvLine(array $values): string
    {
        $escaped = array_map(static function ($value): string {
            $text = $value === null ? '' : (string) $value;
            // منع حقن الصيغ (CSV injection): خلية تبدأ بمُشغّل تُسبَق بعلامة اقتباس
            // مفردة، فيقرأها Excel نصّاً بدل تنفيذها كصيغة.
            if ($text !== '' && str_contains("=+-@\t\r", $text[0])) {
                $text = "'".$text;
            }

            return preg_match('/[",\r\n]/', $text) === 1
                ? '"'.str_replace('"', '""', $text).'"'
                : $text;
        }, $values);

        return implode(',', $escaped);
    }

    /**
     * يبني ملف XLSX في المسار المعطى.
     *
     * @param  array<int, string>  $headers
     * @param  iterable<int, array<int, string|int|null>>  $rows
     * @param  array<int, string>  $types  نوع كل عمود: `TYPE_TEXT` أو `TYPE_NUMBER`
     */
    public static function xlsx(string $path, array $headers, iterable $rows, array $types = [], string $sheetName = 'Sheet1'): void
    {
        // ورقة العمل تُكتب إلى ملف مؤقت سطراً سطراً بدل تجميعها نصّاً في
        // الذاكرة: تصدير خمسين ألف صف كان سيبني سلسلةً بعشرات الميغابايت.
        $sheetPath = self::writeSheetFile($headers, $rows, $types);

        try {
            $zip = new ZipArchive();
            if ($zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
                throw new RuntimeException('تعذر إنشاء ملف XLSX.');
            }

            $safeName = self::sheetName($sheetName);
            $zip->addFromString('[Content_Types].xml', self::contentTypesXml());
            $zip->addFromString('_rels/.rels', self::rootRelsXml());
            $zip->addFromString('xl/workbook.xml', self::workbookXml($safeName));
            $zip->addFromString('xl/_rels/workbook.xml.rels', self::workbookRelsXml());
            $zip->addFromString('xl/styles.xml', self::stylesXml());
            $zip->addFile($sheetPath, 'xl/worksheets/sheet1.xml');

            // `addFile` يقرأ المصدر وقت `close()` — فلا يُحذف المؤقت قبله.
            if (! $zip->close()) {
                throw new RuntimeException('تعذر إغلاق ملف XLSX بعد الكتابة.');
            }
        } finally {
            @unlink($sheetPath);
        }
    }

    /**
     * @param  array<int, string>  $headers
     * @param  iterable<int, array<int, string|int|null>>  $rows
     * @param  array<int, string>  $types
     */
    private static function writeSheetFile(array $headers, iterable $rows, array $types): string
    {
        $path = tempnam(sys_get_temp_dir(), 'nebrax-sheet-');
        if ($path === false) {
            throw new RuntimeException('تعذر تجهيز ملف ورقة العمل المؤقت.');
        }

        $handle = fopen($path, 'w');
        if ($handle === false) {
            @unlink($path);
            throw new RuntimeException('تعذر فتح ملف ورقة العمل المؤقت للكتابة.');
        }

        try {
            fwrite($handle, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                .'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>');
            fwrite($handle, self::rowXml(1, $headers, array_fill(0, max(1, count($headers)), self::TYPE_TEXT)));

            $number = 2;
            foreach ($rows as $row) {
                fwrite($handle, self::rowXml($number, array_values($row), $types));
                $number++;
            }

            fwrite($handle, '</sheetData></worksheet>');
        } catch (\Throwable $exception) {
            fclose($handle);
            @unlink($path);
            throw $exception;
        }

        fclose($handle);

        return $path;
    }

    /**
     * @param  array<int, string|int|null>  $values
     * @param  array<int, string>  $types
     */
    private static function rowXml(int $number, array $values, array $types): string
    {
        $cells = '';
        foreach (array_values($values) as $index => $value) {
            $reference = self::columnLetter($index).$number;
            $text = $value === null ? '' : (string) $value;
            if ($text === '') {
                continue;
            }

            $type = $types[$index] ?? self::TYPE_TEXT;
            if ($type === self::TYPE_NUMBER && preg_match('/^-?\d+(\.\d+)?$/', $text) === 1) {
                $style = str_contains($text, '.') ? ' s="'.self::STYLE_DECIMAL.'"' : '';
                $cells .= '<c r="'.$reference.'"'.$style.'><v>'.$text.'</v></c>';
                continue;
            }

            $cells .= '<c r="'.$reference.'" t="inlineStr"><is><t xml:space="preserve">'
                .self::escape($text).'</t></is></c>';
        }

        return '<row r="'.$number.'">'.$cells.'</row>';
    }

    private static function escape(string $value): string
    {
        // XML 1.0 لا يقبل محارف التحكّم؛ حذفها يمنع ملفاً تالفاً من خلية ملوّثة.
        $value = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/u', '', $value) ?? '';

        return htmlspecialchars($value, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    }

    /** 0 → A · 26 → AA */
    private static function columnLetter(int $index): string
    {
        $letters = '';
        $index++;
        while ($index > 0) {
            $remainder = ($index - 1) % 26;
            $letters = chr(65 + $remainder).$letters;
            $index = intdiv($index - 1, 26);
        }

        return $letters;
    }

    /** Excel يرفض اسم ورقة يتجاوز ٣١ محرفاً أو يحوي `: \ / ? * [ ]`. */
    private static function sheetName(string $name): string
    {
        $clean = preg_replace('/[:\\\\\\/?*\[\]]/u', ' ', trim($name)) ?? 'Sheet1';
        $clean = mb_substr($clean, 0, 31);

        return $clean === '' ? 'Sheet1' : $clean;
    }

    private static function contentTypesXml(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            .'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            .'<Default Extension="xml" ContentType="application/xml"/>'
            .'<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            .'<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            .'<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            .'</Types>';
    }

    private static function rootRelsXml(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            .'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            .'</Relationships>';
    }

    private static function workbookXml(string $sheetName): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            .'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            .'<sheets><sheet name="'.self::escape($sheetName).'" sheetId="1" r:id="rId1"/></sheets>'
            .'</workbook>';
    }

    private static function workbookRelsXml(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            .'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            .'<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
            .'</Relationships>';
    }

    /** نمطان فقط: العام، ورقم بمنزلتين عشريتين للمبالغ. */
    private static function stylesXml(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            .'<numFmts count="1"><numFmt numFmtId="164" formatCode="0.00"/></numFmts>'
            .'<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
            .'<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
            .'<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
            .'<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            .'<cellXfs count="2">'
            .'<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
            .'<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
            .'</cellXfs>'
            .'<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
            .'</styleSheet>';
    }
}
