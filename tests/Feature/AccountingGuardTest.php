<?php

namespace Tests\Feature;

use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  الحرّاس المحاسبية — الخطوط الحمراء تصير فحصاً لا نصّاً
 * ═══════════════════════════════════════════════════════════════
 *  ثلاث قواعد هي أخطر ما في النظام، وكانت محفوظةً بالانضباط وحده:
 *
 *   1. **احتكار المحرك** — لا كتابة في `journal_*` خارج `LedgerService`.
 *   2. **مناعة القيد** — حتى المحرك لا يحذف قيداً ولا يعيد كتابة مبالغه.
 *   3. **بلا `float`** — الحساب المالي أعدادٌ صحيحة بالهللات، بلا استثناء.
 *
 *  الانضباط صمد حتى اليوم: فحصُ الشجرة عند كتابة هذا الملف وجد **صفر**
 *  مخالفة. ولذلك يبدأ السقف صفراً — كما بدأ حارس عزل الفروع، وكما يجب أن
 *  يبقى. حارسٌ يُضاف قبل أول انحراف أرخص من واحدٍ يُضاف بعده.
 *
 *  **لماذا اختباراً لا خطوة CI:** لأن البروتوكول يقول `php artisan test`
 *  قبل أي PR، فالمخالفة تظهر على جهاز من كتبها لا بعد الدفع بدقائق.
 *
 *  تشغيل: php artisan test --filter=AccountingGuardTest
 *  المرجع: AGENTS.md §4 (الخطوط الحمراء) · CLAUDE.md (قواعد التحقق المحاسبي)
 */
class AccountingGuardTest extends TestCase
{
    /** المحرك — الملفّ الوحيد المأذون له بالكتابة في دفتر اليومية. */
    private const ENGINE = 'app/Services/Accounting/LedgerService.php';

    /**
     * أنماط الكتابة في دفتر اليومية.
     *
     * القراءة مسموحة للجميع (`JournalLine::query()`, `::where`, `::sum`) —
     * التقارير وكشوف الحساب مبنيّةٌ عليها. الممنوع **الإنشاء والتعديل والحذف**.
     */
    private const JOURNAL_WRITES = [
        '/\b(JournalEntry|JournalLine)::\s*(create|forceCreate|insert|insertGetId|upsert|updateOrCreate|firstOrCreate|destroy|truncate)\s*\(/',
        '/\bnew\s+(JournalEntry|JournalLine)\b/',
        '/DB::table\(\s*[\'"]journal_(entries|lines)[\'"]\s*\)/',
    ];

    /**
     * الأعمدة التي يجوز للمحرك تعديلها على قيدٍ مرحَّل.
     *
     * حالةُ القيد تتغيّر عند العكس (`posted` ← `reversed`) — وهذا ليس مسّاً
     * بالمبالغ. أما `debit`/`credit`/`account_id`/`entry_date` فلا تُعدَّل
     * أبداً: التصحيح بقيدٍ عكسي، وإلا انكسر الأثر الرجعي.
     */
    private const MUTABLE_ENTRY_COLUMNS = ['status', 'posted_at', 'reversed_at', 'reversal_of'];

    /** أنماط الـ float — أي واحدٍ منها في طبقةٍ مالية يعني هللةً ضائعة. */
    private const FLOAT_PATTERNS = [
        '/\((float|double)\)/',
        '/\bfloatval\s*\(/',
        '/:\s*\??float\b/',
        '/\bfloat\s+\$/',
    ];

    /**
     * حقولٌ ليست مالاً، فالـ float فيها مشروع.
     *
     * الإحداثيات الجغرافية (`branches.latitude/longitude`) عددٌ عشري بطبيعته
     * ولا يمرّ بحسابٍ مالي. تُستثنى بالاسم لا بالسطر — أرقام السطور تنزلق.
     */
    private const NON_MONETARY = ['latitude', 'longitude'];

    /** الطبقة التي يُحسب فيها المال — التقريب فيها يكون بأعداد صحيحة. */
    private const MONEY_LAYER = ['app/Services/Accounting/', 'app/Support/'];

    // ═══════════════════════════════════════════════════════════════
    //  ١. احتكار المحرك
    // ═══════════════════════════════════════════════════════════════

    /** @test */
    public function journal_tables_are_written_only_through_the_ledger_engine(): void
    {
        $violations = [];

        foreach ($this->coreFiles() as $file) {
            $relative = $this->relative($file);
            if ($relative === self::ENGINE) {
                continue;
            }

            foreach (self::JOURNAL_WRITES as $pattern) {
                foreach ($this->scan($file, $pattern) as $hit) {
                    $violations[] = "{$relative}:{$hit}";
                }
            }
        }

        $this->assertSame([], $violations, $this->explain(
            'كتابةٌ مباشرة في دفتر اليومية خارج المحرك',
            'كل أثرٍ محاسبي يمرّ عبر LedgerService::post() أو ::reverse() حصراً.',
            'القيد المكتوب يدوياً لا يُفحص توازنه، ولا يُربط بمصدره، ولا يُحدِّث أرصدة الحسابات.',
            $violations,
        ));
    }

    // ═══════════════════════════════════════════════════════════════
    //  ٢. مناعة القيد بعد الترحيل
    // ═══════════════════════════════════════════════════════════════

    /** @test */
    public function the_engine_never_deletes_or_rewrites_a_posted_entry(): void
    {
        $engine = app_path('Services/Accounting/LedgerService.php');
        $this->assertFileExists($engine, 'المحرك مفقود — تحقّق من قائمة النسخ في ci.yml و assemble.sh.');

        // (أ) لا حذف إطلاقاً — القيد يُعكس ولا يُمحى.
        $deletions = [];
        foreach (['/->\s*(delete|forceDelete)\s*\(/', '/::\s*(destroy|truncate)\s*\(/'] as $pattern) {
            foreach ($this->scan($engine, $pattern) as $hit) {
                $deletions[] = self::ENGINE . ":{$hit}";
            }
        }

        $this->assertSame([], $deletions, $this->explain(
            'حذفٌ داخل المحرك',
            'التصحيح بقيدٍ عكسي عبر reverse() — لا بحذف.',
            'القيد الممحوّ يكسر الأثر الرجعي، وهو سببُ وجود النظام لا ميزةً فيه.',
            $deletions,
        ));

        // (ب) التحديث لا يمسّ عموداً مالياً.
        preg_match_all(
            '/->update\(\s*\[(.*?)\]\s*\)/s',
            $this->sourceWithoutComments($engine),
            $updates,
        );

        $touched = [];
        foreach ($updates[1] as $body) {
            preg_match_all('/[\'"]([a-z_]+)[\'"]\s*=>/i', $body, $keys);
            $touched = array_merge($touched, $keys[1]);
        }

        $financial = array_values(array_diff(array_unique($touched), self::MUTABLE_ENTRY_COLUMNS));
        sort($financial);

        $this->assertSame([], $financial, $this->explain(
            'تعديلٌ على عمودٍ مالي في قيدٍ مرحَّل',
            'المسموح تعديله: ' . implode('، ', self::MUTABLE_ENTRY_COLUMNS) . ' — لا غير.',
            'تعديل مبلغٍ مرحَّل يغيّر تقريراً صدر بالفعل، ولا يترك أثراً يشرح الفرق.',
            $financial,
        ));
    }

    // ═══════════════════════════════════════════════════════════════
    //  ٣. المال أعدادٌ صحيحة
    // ═══════════════════════════════════════════════════════════════

    /** @test */
    public function no_float_survives_in_the_money_layer(): void
    {
        $violations = [];

        foreach ($this->coreFiles() as $file) {
            $relative = $this->relative($file);

            foreach (self::FLOAT_PATTERNS as $pattern) {
                foreach ($this->scan($file, $pattern) as $hit) {
                    if ($this->isNonMonetary($hit)) {
                        continue;
                    }
                    $violations[] = "{$relative}:{$hit}";
                }
            }
        }

        $this->assertSame([], $violations, $this->explain(
            'استعمال float في طبقةٍ مالية',
            'المال بالهللات كـ int. التحويل إلى ريال في طبقة العرض وحدها.',
            '0.1 + 0.2 ≠ 0.3 في العشري الثنائي — والفرق يتراكم صامتاً حتى لا يقفل ميزان المراجعة.',
            $violations,
        ));
    }

    /** @test */
    public function rounding_in_the_money_layer_stays_integer(): void
    {
        $violations = [];

        foreach ($this->coreFiles() as $file) {
            $relative = $this->relative($file);
            if (! $this->inMoneyLayer($relative)) {
                continue;
            }

            foreach ($this->scan($file, '/(?<![\w>$])(round|floor|ceil)\s*\(/') as $hit) {
                $violations[] = "{$relative}:{$hit}";
            }
        }

        $this->assertSame([], $violations, $this->explain(
            'دالّة تقريبٍ عشرية في طبقة المال',
            'round() تعيد float في PHP — حتى على مدخلٍ صحيح. التقريب النصفي لأعلى يُكتب بحسابٍ صحيح.',
            'النمط المتّبع في ComputesLineTax و InvoiceService: intdiv على البسط والمقام بلا وسيطٍ عشري.',
            $violations,
        ));
    }

    // ═══════════════════════════════════════════════════════════════
    //  أدوات
    // ═══════════════════════════════════════════════════════════════

    /** كل ملفات PHP تحت app/ في المشروع المجمَّع. */
    private function coreFiles(): array
    {
        $files = [];

        $tree = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator(app_path(), RecursiveDirectoryIterator::SKIP_DOTS)
        );

        foreach ($tree as $file) {
            if ($file->isFile() && $file->getExtension() === 'php') {
                $files[] = $file->getPathname();
            }
        }

        sort($files);

        return $files;
    }

    private function relative(string $path): string
    {
        return 'app/' . ltrim(str_replace(app_path(), '', $path), '/\\');
    }

    private function inMoneyLayer(string $relative): bool
    {
        foreach (self::MONEY_LAYER as $prefix) {
            if (str_starts_with($relative, $prefix)) {
                return true;
            }
        }

        return false;
    }

    private function isNonMonetary(string $hit): bool
    {
        foreach (self::NON_MONETARY as $field) {
            if (stripos($hit, $field) !== false) {
                return true;
            }
        }

        return false;
    }

    /**
     * الملف بلا تعليقات، بأرقام سطورٍ محفوظة.
     *
     * التعليقات في هذا المستودع تصف القاعدة بنصّها («بلا float»، «لا كتابة
     * مباشرة في journal_lines») — فمسحُها شرطُ ألّا يُفشل الحارسُ التوثيقَ
     * الذي يشرحه. والأسطر تُستبدل بأسطرٍ فارغة لا تُحذف، وإلا انزلقت الأرقام.
     */
    private function sourceWithoutComments(string $file): string
    {
        $source = '';

        foreach (token_get_all((string) file_get_contents($file)) as $token) {
            if (! is_array($token)) {
                $source .= $token;
                continue;
            }

            if ($token[0] === T_COMMENT || $token[0] === T_DOC_COMMENT) {
                $source .= str_repeat("\n", substr_count($token[1], "\n"));
                continue;
            }

            $source .= $token[1];
        }

        return $source;
    }

    /** أسطر الملف المطابقة للنمط، مسبوقةً برقم السطر. */
    private function scan(string $file, string $pattern): array
    {
        $hits = [];

        foreach (explode("\n", $this->sourceWithoutComments($file)) as $index => $line) {
            if (preg_match($pattern, $line)) {
                $hits[] = ($index + 1) . ': ' . trim($line);
            }
        }

        return $hits;
    }

    /** رسالة فشلٍ تقول ما وقع، وما القاعدة، ولماذا هي قاعدة. */
    private function explain(string $what, string $rule, string $why, array $hits): string
    {
        return "\n\n  ✗ {$what}\n"
            . "  القاعدة: {$rule}\n"
            . "  لماذا:   {$why}\n\n"
            . "  المواضع:\n    " . implode("\n    ", $hits) . "\n\n"
            . "  إن كان هذا الموضع استثناءً حقيقياً — لا تُعدِّل الحارس.\n"
            . "  اعرضه على المالك، فالاستثناء في كودٍ محاسبي قرارٌ لا تفصيل.\n";
    }
}
