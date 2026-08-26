<?php

namespace App\Support;

use RuntimeException;
use SimpleXMLElement;
use XMLReader;
use ZipArchive;

/**
 * قارئ جداول موحّد لملفات التبادل: CSV و XLSX.
 *
 * **لماذا قارئ داخلي بدل حزمة جاهزة؟** المستودع نواةٌ يُجمَّع منها مشروع
 * Laravel وقت البناء بقوائم نسخ صريحة، وحزم Composer تُثبَّت في أربعة مواضع
 * (CI، setup.sh، deploy/assemble.sh، Dockerfile). وقراءة XLSX هنا محصورة في
 * ورقة واحدة من قيم نصّية بلا صيغ ولا تنسيقات ولا رسوم، فكلفة حزمة كاملة
 * (PhpSpreadsheet ~ عشرات الآلاف من الأسطر وسطح هجوم أوسع) لا يقابلها عائد.
 *
 * القارئ **لا يفسّر** القيم: يعيدها نصّاً كما وردت، ويترك التحقق والتحويل
 * لطبقة الاستيراد. فمعنى «35.00» و«good» و«1» يخصّ عقد المنتجات لا صيغة الملف.
 */
class SpreadsheetReader
{
    /** أقصى حجم غير مضغوط مقبول داخل XLSX — يصدّ قنابل الضغط (zip bombs). */
    private const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;

    /** أقصى حجم لمُدخل واحد داخل الأرشيف. */
    private const MAX_ENTRY_BYTES = 32 * 1024 * 1024;

    /** فواصل CSV المرشّحة — Excel العربي/الأوروبي يكتب «؛» في بعض الإعدادات. */
    private const DELIMITERS = [',', ';', "\t", '|'];

    /**
     * يقرأ ملفاً إلى صفوف نصّية. الصف الأول هو صف العناوين كما ورد في الملف.
     *
     * @return array<int, array<int, string>>
     */
    public static function read(string $path, string $extension, int $maxRows, int $maxColumns): array
    {
        $extension = strtolower(trim($extension));

        return match ($extension) {
            'xlsx' => self::readXlsx($path, $maxRows, $maxColumns),
            'csv', 'txt' => self::readCsv($path, $maxRows, $maxColumns),
            default => throw new RuntimeException('صيغة الملف غير مدعومة. استخدم CSV أو XLSX.'),
        };
    }

    /** الصيغ المقبولة في طبقة التحقق وواجهة الرفع معاً. */
    public static function isSupportedExtension(string $extension): bool
    {
        return in_array(strtolower(trim($extension)), ['csv', 'txt', 'xlsx'], true);
    }

    /**
     * @return array<int, array<int, string>>
     */
    private static function readCsv(string $path, int $maxRows, int $maxColumns): array
    {
        $handle = @fopen($path, 'r');
        if ($handle === false) {
            throw new RuntimeException('تعذر قراءة ملف الاستيراد.');
        }

        try {
            $delimiter = self::sniffDelimiter($path);
            $rows = [];
            $first = true;

            while (($values = fgetcsv($handle, 0, $delimiter)) !== false) {
                // fgetcsv يعيد [null] لسطر فارغ تماماً؛ نتخطاه بلا احتساب.
                if ($values === [null]) {
                    continue;
                }
                if ($first) {
                    $values = self::stripBom($values);
                    $first = false;
                }
                if (count($values) > $maxColumns) {
                    throw new RuntimeException("عدد أعمدة الملف يتجاوز الحد الأقصى ({$maxColumns} عموداً).");
                }
                if (count($rows) > $maxRows) {
                    // +1: صف العناوين لا يُحتسب من حصة البيانات.
                    throw new RuntimeException("يتجاوز الملف الحد الأقصى البالغ {$maxRows} صفاً. قسّم الملف إلى دفعات أصغر.");
                }

                $rows[] = array_map(static fn ($value): string => self::normalizeCell((string) ($value ?? '')), $values);
            }

            if ($rows === []) {
                throw new RuntimeException('ملف الاستيراد فارغ.');
            }

            return $rows;
        } finally {
            fclose($handle);
        }
    }

    /** يختار الفاصل الذي يعطي أكبر عدد حقول في أول سطر غير فارغ. */
    private static function sniffDelimiter(string $path): string
    {
        $handle = @fopen($path, 'r');
        if ($handle === false) {
            return ',';
        }

        try {
            $line = '';
            while (($candidate = fgets($handle)) !== false) {
                if (trim($candidate) !== '') {
                    $line = $candidate;
                    break;
                }
            }
            if ($line === '') {
                return ',';
            }

            $best = ',';
            $bestCount = 0;
            foreach (self::DELIMITERS as $delimiter) {
                $count = count(str_getcsv($line, $delimiter));
                if ($count > $bestCount) {
                    $best = $delimiter;
                    $bestCount = $count;
                }
            }

            return $best;
        } finally {
            fclose($handle);
        }
    }

    /**
     * @param  array<int, string|null>  $values
     * @return array<int, string|null>
     */
    private static function stripBom(array $values): array
    {
        if (isset($values[0]) && str_starts_with((string) $values[0], "\xEF\xBB\xBF")) {
            $values[0] = substr((string) $values[0], 3);
        }

        return $values;
    }

    /**
     * @return array<int, array<int, string>>
     */
    private static function readXlsx(string $path, int $maxRows, int $maxColumns): array
    {
        $zip = new ZipArchive();
        if ($zip->open($path) !== true) {
            throw new RuntimeException('تعذر فتح ملف XLSX. تأكد أنه ملف Excel صالح غير تالف.');
        }

        try {
            self::assertArchiveIsSane($zip);
            $sheetPath = self::firstSheetPath($zip);
            $shared = self::sharedStrings($zip);
            $sheetXml = $zip->getFromName($sheetPath);
            if ($sheetXml === false) {
                throw new RuntimeException('ملف XLSX لا يحتوي ورقة عمل قابلة للقراءة.');
            }

            return self::parseSheet($sheetXml, $shared, $maxRows, $maxColumns);
        } finally {
            $zip->close();
        }
    }

    private static function assertArchiveIsSane(ZipArchive $zip): void
    {
        $total = 0;
        for ($index = 0; $index < $zip->numFiles; $index++) {
            $stat = $zip->statIndex($index);
            if ($stat === false) {
                continue;
            }
            $size = (int) ($stat['size'] ?? 0);
            if ($size > self::MAX_ENTRY_BYTES) {
                throw new RuntimeException('ملف XLSX يحتوي جزءاً أكبر من الحد المسموح. أعد حفظه بجدول أصغر.');
            }
            $total += $size;
            if ($total > self::MAX_UNCOMPRESSED_BYTES) {
                throw new RuntimeException('حجم ملف XLSX بعد فك الضغط يتجاوز الحد المسموح.');
            }
        }
    }

    /** يتبع علاقة المصنّف إلى أول ورقة، ولا يفترض `sheet1.xml` اسماً ثابتاً. */
    private static function firstSheetPath(ZipArchive $zip): string
    {
        $workbook = $zip->getFromName('xl/workbook.xml');
        $rels = $zip->getFromName('xl/_rels/workbook.xml.rels');
        if ($workbook === false || $rels === false) {
            throw new RuntimeException('بنية ملف XLSX غير صالحة.');
        }

        $workbookXml = self::parseXml($workbook);
        $relsXml = self::parseXml($rels);

        $relationshipId = null;
        foreach ($workbookXml->xpath('//*[local-name()="sheets"]/*[local-name()="sheet"]') ?: [] as $sheet) {
            foreach ($sheet->attributes('http://schemas.openxmlformats.org/officeDocument/2006/relationships') ?? [] as $name => $value) {
                if ($name === 'id') {
                    $relationshipId = (string) $value;
                    break 2;
                }
            }
        }

        if ($relationshipId !== null) {
            foreach ($relsXml->children() as $relationship) {
                if ((string) $relationship['Id'] === $relationshipId) {
                    $target = ltrim((string) $relationship['Target'], '/');

                    return str_starts_with($target, 'xl/') ? $target : 'xl/'.$target;
                }
            }
        }

        // احتياط لمصنّف بلا علاقات صريحة (مولّدات بسيطة).
        if ($zip->locateName('xl/worksheets/sheet1.xml') !== false) {
            return 'xl/worksheets/sheet1.xml';
        }

        throw new RuntimeException('ملف XLSX لا يحتوي ورقة عمل قابلة للقراءة.');
    }

    /**
     * @return array<int, string>
     */
    private static function sharedStrings(ZipArchive $zip): array
    {
        $xml = $zip->getFromName('xl/sharedStrings.xml');
        if ($xml === false) {
            return [];
        }

        $strings = [];
        $reader = new XMLReader();
        if (! $reader->XML($xml, 'UTF-8', LIBXML_NONET)) {
            return [];
        }

        try {
            while ($reader->read()) {
                if ($reader->nodeType === XMLReader::ELEMENT && $reader->localName === 'si') {
                    $node = $reader->readOuterXml();
                    $strings[] = $node === '' ? '' : self::textOf($node);
                }
            }
        } finally {
            $reader->close();
        }

        return $strings;
    }

    /** يجمع كل عقد `t` داخل عنصر — النص المنسّق يُقسَّم إلى `r/t` متعددة. */
    private static function textOf(string $xml): string
    {
        $element = self::parseXml($xml);
        $parts = $element->xpath('//*[local-name()="t"]') ?: [];

        return implode('', array_map(static fn ($node): string => (string) $node, $parts));
    }

    /**
     * @param  array<int, string>  $shared
     * @return array<int, array<int, string>>
     */
    private static function parseSheet(string $xml, array $shared, int $maxRows, int $maxColumns): array
    {
        $reader = new XMLReader();
        if (! $reader->XML($xml, 'UTF-8', LIBXML_NONET)) {
            throw new RuntimeException('تعذر قراءة ورقة العمل داخل ملف XLSX.');
        }

        $rows = [];
        try {
            while ($reader->read()) {
                if ($reader->nodeType !== XMLReader::ELEMENT || $reader->localName !== 'row') {
                    continue;
                }
                if (count($rows) > $maxRows) {
                    throw new RuntimeException("يتجاوز الملف الحد الأقصى البالغ {$maxRows} صفاً. قسّم الملف إلى دفعات أصغر.");
                }

                $rowXml = $reader->readOuterXml();
                $row = self::parseRow($rowXml, $shared, $maxColumns);
                // الصف الفارغ تماماً يبقى محفوظاً في موضعه كي تبقى أرقام الصفوف
                // في رسائل الأخطاء مطابقةً لما يراه المستخدم في Excel.
                $rows[] = $row;
            }
        } finally {
            $reader->close();
        }

        while ($rows !== [] && self::isBlank(end($rows))) {
            array_pop($rows);
        }
        if ($rows === []) {
            throw new RuntimeException('ملف الاستيراد فارغ.');
        }

        return array_values($rows);
    }

    /**
     * @param  array<int, string>  $shared
     * @return array<int, string>
     */
    private static function parseRow(string $xml, array $shared, int $maxColumns): array
    {
        $element = self::parseXml($xml);
        $cells = [];

        foreach ($element->xpath('./*[local-name()="c"]') ?: [] as $cell) {
            $reference = (string) $cell['r'];
            $index = $reference === '' ? count($cells) : self::columnIndex($reference);
            if ($index >= $maxColumns) {
                throw new RuntimeException("عدد أعمدة الملف يتجاوز الحد الأقصى ({$maxColumns} عموداً).");
            }
            $cells[$index] = self::cellValue($cell, $shared);
        }

        if ($cells === []) {
            return [];
        }

        $row = [];
        for ($index = 0, $last = max(array_keys($cells)); $index <= $last; $index++) {
            $row[$index] = $cells[$index] ?? '';
        }

        return $row;
    }

    /**
     * @param  array<int, string>  $shared
     */
    private static function cellValue(SimpleXMLElement $cell, array $shared): string
    {
        $type = (string) $cell['t'];

        if ($type === 'inlineStr') {
            return self::normalizeCell(self::textOf($cell->asXML() ?: ''));
        }

        $value = null;
        foreach ($cell->xpath('./*[local-name()="v"]') ?: [] as $node) {
            $value = (string) $node;
            break;
        }
        if ($value === null) {
            return '';
        }

        return match ($type) {
            's' => self::normalizeCell($shared[(int) $value] ?? ''),
            'b' => $value === '1' ? '1' : '0',
            'e' => '',
            default => self::normalizeCell(self::normalizeNumeric($value)),
        };
    }

    /**
     * يمنع تسرّب الصيغة العلمية إلى باركود أو رمز صنف: بعض المولّدات تكتب
     * `6.28123456789E+12` لعدد صحيح، وقراءته حرفياً تُنتج رمزاً لا وجود له.
     */
    private static function normalizeNumeric(string $value): string
    {
        if (! preg_match('/^-?\d*\.?\d+[eE][+-]?\d+$/', $value)) {
            return $value;
        }

        $float = (float) $value;
        if (is_finite($float) && abs($float) < 1e15 && floor($float) === $float) {
            return sprintf('%.0F', $float);
        }

        return rtrim(rtrim(sprintf('%.6F', $float), '0'), '.');
    }

    /** `AB12` → 27 (صفري الأساس). */
    private static function columnIndex(string $reference): int
    {
        preg_match('/^([A-Za-z]+)/', $reference, $matches);
        $letters = strtoupper($matches[1] ?? 'A');
        $index = 0;
        foreach (str_split($letters) as $letter) {
            $index = ($index * 26) + (ord($letter) - 64);
        }

        return max(0, $index - 1);
    }

    /** @param array<int, string> $row */
    private static function isBlank(array $row): bool
    {
        foreach ($row as $value) {
            if (trim($value) !== '') {
                return false;
            }
        }

        return true;
    }

    /** يوحّد المسافات غير الفاصلة والأسطر داخل الخلية قبل أي تحقق. */
    private static function normalizeCell(string $value): string
    {
        $value = str_replace(["\u{00A0}", "\u{200B}", "\u{200E}", "\u{200F}", "\u{FEFF}"], ' ', $value);

        return trim($value);
    }

    private static function parseXml(string $xml): SimpleXMLElement
    {
        $previous = libxml_use_internal_errors(true);
        try {
            // بلا LIBXML_NOENT وبلا شبكة: لا كيانات خارجية ولا XXE من ملف مرفوع.
            $element = simplexml_load_string($xml, SimpleXMLElement::class, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING);
            if ($element === false) {
                throw new RuntimeException('بنية ملف XLSX غير صالحة.');
            }

            return $element;
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
        }
    }
}
