<?php

namespace App\Services;

use App\Models\ImportDocumentReservation;
use App\Models\Partner;
use App\Support\DuplicateDocumentException;
use App\Tenancy\TenantContext;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use LogicException;

/**
 * خدمة حجز هوية المستند (IMP-H5-S1a) — **مالك دورة حياة الحجز الوحيد**. خدمات المستندات (المصروفات/المشتريات/الفواتير) تستدعيها داخل معاملاتها
 * (إنشاء ⇒ حجز، تعديل مسند ⇒ إعادة اشتقاق ذرّية، حذف مسودة ⇒ تحرير)؛ المستوردون لا يكتبون حجزاً مباشرةً.
 *
 *  - **الحَكَم الفهرس الفريد** `(tenant_id, domain, dedupe_key)`، والإدراج `INSERT … ON CONFLICT DO NOTHING` فلا تُجهَض معاملة PostgreSQL عند التنازع؛
 *    الخاسر يرى أن الصف لم يُدرَج فيرمي `DuplicateDocumentException` والمعاملة كلها تتراجع بيد المستدعي.
 *  - **المسند خاصٌّ بالمجال** (كل مجال يعلن عناصره ولا يستعير مفتاح مجال آخر): المصروف = مورّد ‖ مرجع مطبَّع ‖ تاريخ ‖ مبلغ (هللات) ‖ معرّف التمييز؛ المشترى = مورّد ‖ رقم فاتورة المورّد.
 *  - **المرجع المطبَّع:** أرقام لاتينية، أحرف صغيرة، وأحرف/أرقام فقط (`INV-001` = `inv 001`). مرجعٌ فارغ بعد التطبيع ⇒ لا مرجع (للمصروف يبقى يحجز بمفتاح «بلا مرجع»).
 *  - **تُستدعى داخل معاملة فقط** (`LogicException` وإلا): الحجز بلا مستنده المحفوظ معه ذرّياً حجزٌ يتيم.
 */
final class DocumentDuplicateReservationService
{
    public const DOMAIN_EXPENSE = 'expense';
    public const DOMAIN_PURCHASE = 'purchase';
    public const DOMAIN_SALES_INVOICE = 'sales_invoice';
    public const DOMAINS = [self::DOMAIN_EXPENSE, self::DOMAIN_PURCHASE, self::DOMAIN_SALES_INVOICE];

    public const SOURCE_STANDARD = 'standard';
    public const SOURCE_AI_ACTION = 'ai_action';
    public const SOURCE_DOCUMENT_CENTER = 'document_center';
    public const SOURCE_MANUAL = 'manual';
    public const SOURCES = [self::SOURCE_STANDARD, self::SOURCE_AI_ACTION, self::SOURCE_DOCUMENT_CENTER, self::SOURCE_MANUAL];

    public function __construct(private readonly TenantContext $tenantContext) {}

    // ═══════════════════════════════ التطبيع والمسندات ═══════════════════════════════

    /** مرجع مطبَّع للمقارنة، أو `null` إن لم يبقَ منه شيء. */
    public static function normalizeReference(?string $reference): ?string
    {
        if ($reference === null) {
            return null;
        }
        if (class_exists(\Normalizer::class)) {
            $reference = \Normalizer::normalize($reference, \Normalizer::FORM_KC) ?: $reference;   // عرض كامل العرض → لاتيني، تركيبات → موحَّدة
        }
        // أشكال عربية مكافئة بصرياً: ألف مهموزة/موصولة → ا، ياء فارسية/مقصورة → ي، كاف فارسية → ك، والتطويل يُحذف.
        $reference = strtr($reference, ['أ' => 'ا', 'إ' => 'ا', 'آ' => 'ا', 'ٱ' => 'ا', 'ى' => 'ي', 'ی' => 'ي', 'ک' => 'ك', 'ـ' => '']);
        $latin = strtr($reference, ['٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4', '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9',
            '۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4', '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9']);
        $clean = preg_replace('/[^\p{L}\p{N}]+/u', '', mb_strtolower($latin, 'UTF-8')) ?? '';

        return $clean === '' ? null : $clean;
    }

    /** اسم بائع مطبَّع (مسافات مطوية وأحرف صغيرة) حين لا طرف مسجَّل. */
    public static function normalizeName(?string $name): ?string
    {
        $clean = trim(preg_replace('/\s+/u', ' ', mb_strtolower((string) $name, 'UTF-8')) ?? '');

        return $clean === '' ? null : $clean;
    }

    /** مفتاح المورّد: طرفٌ مسجَّل بمعرّفه، وإلا اسم البائع المطبَّع، وإلا لا مورّد. */
    public static function vendorKey(?string $partnerId, ?string $vendorName): string
    {
        if ($partnerId !== null && $partnerId !== '') {
            return 'p:'.mb_strtolower($partnerId, 'UTF-8');
        }
        $name = self::normalizeName($vendorName);

        return $name === null ? 'none' : 'n:'.$name;
    }

    /**
     * مسند المصروف. المرجع الفارغ يعني «بلا مرجع» (`reference = null`) ولا يُسقط الحجز: المفتاح البديل = مورّد ‖ تاريخ ‖ مبلغ.
     * `occurrenceId` معرّف تمييز صريح لتكرارٍ حقيقي (مصروفان بالمورّد واليوم والمبلغ نفسها) يُصدَر وقت المعاينة لا يُشتق من تشغيلة لاحقة.
     *
     * @return array<string, mixed>
     */
    public static function expensePredicate(?string $partnerId, ?string $vendorName, ?string $reference, string $date, int $amountMinor, ?string $occurrenceId = null): array
    {
        return [
            'vendor' => self::vendorKey($partnerId, $vendorName),
            'reference' => self::normalizeReference($reference),
            'date' => self::normalizeDate($date),
            'amount' => $amountMinor,
            'occurrence' => ($occurrenceId === null || $occurrenceId === '') ? null : $occurrenceId,
        ];
    }

    /** @return array<string, mixed> */
    public static function purchasePredicate(string $supplierId, string $supplierInvoiceNo): array
    {
        $reference = self::normalizeReference($supplierInvoiceNo);
        if ($reference === null) {
            // مسند المشترى لا يحمل تاريخاً ولا مبلغاً: مرجعٌ فارغ بعد التطبيع كان سيدمج كل مشتريات المورّد بلا مرجع في هوية واحدة.
            throw new LogicException('رقم فاتورة المورّد مطلوب (ولا يتكوّن من رموز فقط) لحجز هوية المشترى.');
        }

        return ['supplier' => mb_strtolower($supplierId, 'UTF-8'), 'reference' => $reference];
    }

    /** تاريخ بصيغة Y-m-d، وإلا LogicException (مفتاح التكرار لا يقبل تواريخ بصيغ متعددة). */
    public static function normalizeDate(string $date): string
    {
        try {
            return \Carbon\Carbon::parse($date)->toDateString();
        } catch (\Throwable) {
            throw new LogicException("تاريخ غير صالح لحجز الهوية: {$date}");
        }
    }

    /** بصمة SHA-256 للمسند الخاص بالمجال (مفاتيح مرتّبة ⇒ ثابتة). */
    public static function key(string $domain, array $predicate): string
    {
        self::assertDomain($domain);
        foreach ($predicate as $name => $value) {
            if ($value !== null && ! is_int($value) && ! is_string($value)) {
                throw new LogicException("قيمة مسند الحجز '{$name}' يجب أن تكون عدداً صحيحاً أو نصاً أو null (لا float ولا مصفوفة): الهاش يميّز 100 عن \"100\".");
            }
        }
        ksort($predicate);

        return hash('sha256', $domain."\x1f".json_encode($predicate, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    }

    // ═══════════════════════════════ دورة الحياة ═══════════════════════════════

    /**
     * يحجز الهوية لمستندٍ في معاملته. تنازعٌ ⇒ `DuplicateDocumentException` (والمستدعي يترك المعاملة تتراجع).
     *
     * @param  array<string, mixed>  $predicate
     */
    public function reserve(string $domain, array $predicate, string $documentType, string $documentId, string $source, ?string $counterpartyId = null): ImportDocumentReservation
    {
        $this->assertInTransaction();
        self::assertDomain($domain);
        $this->assertSource($source);
        $tenantId = $this->tenantId();
        $this->assertCounterparty($counterpartyId);
        $key = self::key($domain, $predicate);

        $row = [
            'id' => (string) Str::uuid(), 'tenant_id' => $tenantId, 'domain' => $domain, 'dedupe_key' => $key, 'counterparty_id' => $counterpartyId,
            'document_type' => $documentType, 'document_id' => $documentId, 'source' => $source,
            'predicate' => json_encode($predicate, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
            'created_at' => now(), 'updated_at' => now(),
        ];
        if (DB::table('import_document_reservations')->insertOrIgnore($row) !== 1) {
            $holder = $this->find($domain, $key);
            if ($holder !== null && $holder->document_type === $documentType && $holder->document_id === $documentId) {
                return $holder;   // إعادة محاولة متماثلة لمستندٍ يحمل الحجز نفسه: لا خطأ.
            }
            if ($holder === null) {
                // المفتاح حرّ لكن المستند نفسه محجوز بهوية أخرى (فهرس المستند الفريد): مستند واحد = حجز واحد؛ تغيير الهوية عبر rekey فقط.
                throw new LogicException('هذا المستند يحمل حجزاً بهوية مختلفة؛ غيّرها عبر rekey().');
            }
            throw new DuplicateDocumentException($domain, $holder->document_type, $holder->document_id);
        }

        return ImportDocumentReservation::query()->whereKey($row['id'])->firstOrFail();
    }

    /**
     * يعيد اشتقاق حجز مستندٍ لمسندٍ جديد (تعديل حقلٍ من مسنده) **في الصف نفسه** (UPDATE لا حذف+إدراج): من قفل الصف ينتظر معدّلٌ متزامن
     * فيرى النسخة المحدَّثة (سلسلة التحديث) بدل أن يجد صفاً محذوفاً فيتجاهل طلبه بصمت. التنازع ⇒ استثناء، والتحديث داخل نقطة حفظ فلا يبقى
     * أثرٌ جزئي حتى لو التقط المستدعي الاستثناء وتابع. المسند نفسه ⇒ لا شيء؛ مستندٌ بلا حجز (أُنشئ يدوياً تحت allow) ⇒ لا شيء.
     *
     * @param  array<string, mixed>  $predicate
     */
    public function rekey(string $documentType, string $documentId, array $predicate, ?string $counterpartyId = null): void
    {
        $this->assertInTransaction();
        $this->tenantId();
        $this->assertCounterparty($counterpartyId);
        $current = ImportDocumentReservation::query()->where('document_type', $documentType)->where('document_id', $documentId)->lockForUpdate()->first();
        if ($current === null) {
            return;
        }
        $key = self::key($current->domain, $predicate);
        if ($key === $current->dedupe_key) {
            return;
        }

        try {
            DB::transaction(fn () => $current->forceFill([
                'dedupe_key' => $key, 'predicate' => $predicate, 'counterparty_id' => $counterpartyId,
            ])->save());
        } catch (UniqueConstraintViolationException) {
            $holder = $this->find($current->domain, $key);
            throw new DuplicateDocumentException($current->domain, $holder?->document_type, $holder?->document_id);
        }
    }

    /** يحرّر حجز مستندٍ (حذف مسودة). يعيد عدد ما حُرِّر. */
    public function release(string $documentType, string $documentId): int
    {
        $this->assertInTransaction();
        $this->tenantId();

        return ImportDocumentReservation::query()->where('document_type', $documentType)->where('document_id', $documentId)->delete();
    }

    /** حجز مستندٍ بعينه (للتعديل: يُقرأ مسنده المخزَّن لإعادة الاشتقاق)، أو `null` إن لم يُحجز. */
    public function forDocument(string $documentType, string $documentId): ?ImportDocumentReservation
    {
        $this->tenantId();

        return ImportDocumentReservation::query()->where('document_type', $documentType)->where('document_id', $documentId)->first();
    }

    /** @param array<string, mixed>|string $predicateOrKey */
    public function find(string $domain, array|string $predicateOrKey): ?ImportDocumentReservation
    {
        $this->tenantId();
        $key = is_array($predicateOrKey) ? self::key($domain, $predicateOrKey) : $predicateOrKey;

        return ImportDocumentReservation::query()->where('domain', $domain)->where('dedupe_key', $key)->first();
    }

    // ═══════════════════════════════════════════════════════════════

    private function tenantId(): string
    {
        $id = $this->tenantContext->id();
        if (! is_string($id) || $id === '') {
            throw new LogicException('حجز هوية المستند يتطلب سياق مؤسسة.');
        }

        return $id;
    }

    /** الطرف (إن أُعطي) يجب أن يكون من المؤسسة الحالية — لا معرّف طرفٍ من مؤسسة أخرى في عمود تشخيصي. */
    private function assertCounterparty(?string $counterpartyId): void
    {
        if ($counterpartyId !== null && ! Partner::query()->whereKey($counterpartyId)->exists()) {
            throw new LogicException('طرف الحجز غير موجود في المؤسسة الحالية.');
        }
    }

    private function assertInTransaction(): void
    {
        if (DB::transactionLevel() < 1) {
            throw new LogicException('حجز هوية المستند يجري داخل معاملة المستند نفسها.');
        }
    }

    private static function assertDomain(string $domain): void
    {
        if (! in_array($domain, self::DOMAINS, true)) {
            throw new LogicException("مجال حجز غير معروف: {$domain}");
        }
    }

    private function assertSource(string $source): void
    {
        if (! in_array($source, self::SOURCES, true)) {
            throw new LogicException("مصدر حجز غير معروف: {$source}");
        }
    }
}
