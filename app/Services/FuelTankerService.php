<?php

namespace App\Services;

use App\Models\FuelTanker;
use App\Models\FuelTankerOwner;
use App\Models\FuelTankerOwnerCompanyLink;
use App\Models\Partner;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use RuntimeException;

/**
 * TANKER-PR1 — **الكاتب الوحيد** لبيانات أصحاب الصهاريج الرئيسية: الملف، الصهريج، وربط الشركات المؤرَّخ.
 *
 * ⚠ بيانات رئيسية فقط: **لا** حركة مخزون ولا قيد ولا فاتورة ولا قبض ولا عمولة ولا تسوية (مراحل لاحقة، وقراراتها المحاسبية/الضريبية مفتوحة). لا يستدعي
 * `InventoryService` ولا `LedgerService` ولا `InvoiceService` ولا `PaymentService` (يحرسه اختبار ساكن).
 *
 * كل كتابة في معاملة واحدة مع حدث تدقيق بالفاعل (`FuelStationAuditTrail`، لقطتا قبل/بعد للحقول المتغيّرة فقط). عزل المستأجر من `BaseModel`؛ المراجع (الطرف) تُحلّ
 * في نطاق المستأجر الحالي فقط، ومعرّف مستأجر آخر يُعامل «غير موجود» برسالة واحدة. ربط الشركات يقفل صف صاحب الصهريج `FOR UPDATE` قبل فحص التداخل
 * فلا يُنشأ ربطان متداخلان بالتزامن.
 */
class FuelTankerService
{
    public function __construct(private FuelStationAuditTrail $audit) {}

    // ───────────────────────── أصحاب الصهاريج ─────────────────────────

    /** @param array<string,mixed> $attributes */
    public function createOwner(array $attributes, User $actor): FuelTankerOwner
    {
        return DB::transaction(function () use ($attributes, $actor) {
            $name = $this->requiredText($attributes, 'name', 'اسم صاحب الصهريج');
            $code = $this->nullableText($attributes['code'] ?? null);
            $status = $attributes['status'] ?? FuelTankerOwner::STATUS_ACTIVE;
            $this->assertStatus($status, FuelTankerOwner::STATUSES);
            $this->assertOwnerCodeAvailable($code, null);

            try {
                $owner = FuelTankerOwner::create([
                    'code' => $code,
                    'name' => $name,
                    'phone' => $this->nullableText($attributes['phone'] ?? null),
                    'notes' => $this->nullableText($attributes['notes'] ?? null),
                    'status' => $status,
                    'created_by' => $actor->id,
                ]);
            } catch (UniqueConstraintViolationException) {
                throw $this->duplicate('code', 'رمز صاحب الصهريج مسجَّل مسبقاً.');
            }
            $this->audit->record('tanker_owner.created', $owner, null, $this->audit->snapshot($owner), $actor, $this->nullableText($attributes['reason'] ?? null));

            return $owner;
        });
    }

    /** @param array<string,mixed> $attributes */
    public function updateOwner(FuelTankerOwner $owner, array $attributes, User $actor): FuelTankerOwner
    {
        return DB::transaction(function () use ($owner, $attributes, $actor) {
            $owner = FuelTankerOwner::lockForUpdate()->findOrFail($owner->id);
            $before = $this->audit->snapshot($owner);

            $changes = [];
            if (array_key_exists('name', $attributes)) {
                $changes['name'] = $this->requiredText($attributes, 'name', 'اسم صاحب الصهريج');
            }
            if (array_key_exists('code', $attributes)) {
                $code = $this->nullableText($attributes['code']);
                $this->assertOwnerCodeAvailable($code, $owner->id);
                $changes['code'] = $code;
            }
            foreach (['phone', 'notes'] as $field) {
                if (array_key_exists($field, $attributes)) {
                    $changes[$field] = $this->nullableText($attributes[$field]);
                }
            }
            if (array_key_exists('status', $attributes)) {
                $this->assertStatus($attributes['status'], FuelTankerOwner::STATUSES);
                $changes['status'] = $attributes['status'];
            }

            try {
                $owner->update($changes);
            } catch (UniqueConstraintViolationException) {
                throw $this->duplicate('code', 'رمز صاحب الصهريج مسجَّل مسبقاً.');
            }
            $this->audit->record('tanker_owner.updated', $owner, $before, $this->audit->snapshot($owner->fresh()), $actor, $this->nullableText($attributes['reason'] ?? null));

            return $owner->fresh();
        });
    }

    // ───────────────────────── الصهاريج ─────────────────────────

    /** @param array<string,mixed> $attributes */
    public function createTanker(array $attributes, User $actor): FuelTanker
    {
        return DB::transaction(function () use ($attributes, $actor) {
            $owner = $this->activeOwnerForUpdate((string) ($attributes['fuel_tanker_owner_id'] ?? ''));
            $plate = $this->requiredText($attributes, 'plate_number', 'رقم لوحة الصهريج');
            $key = self::plateKey($plate);
            $status = $attributes['status'] ?? FuelTanker::STATUS_ACTIVE;
            $this->assertStatus($status, FuelTanker::STATUSES);
            $capacity = $this->normalizedCapacity($attributes['capacity_milliliters'] ?? null);
            $this->assertPlateAvailable($key, null);

            try {
                $tanker = FuelTanker::create([
                    'fuel_tanker_owner_id' => $owner->id,
                    'plate_number' => $plate,
                    'plate_key' => $key,
                    'plate_country' => $this->nullableText($attributes['plate_country'] ?? null),
                    'capacity_milliliters' => $capacity,
                    'notes' => $this->nullableText($attributes['notes'] ?? null),
                    'status' => $status,
                    'created_by' => $actor->id,
                ]);
            } catch (UniqueConstraintViolationException) {
                throw $this->duplicate('plate_number', 'رقم اللوحة مسجَّل مسبقاً لصهريج آخر.');
            }
            $this->audit->record('tanker.created', $tanker, null, $this->audit->snapshot($tanker), $actor, $this->nullableText($attributes['reason'] ?? null));

            return $tanker->load('owner');
        });
    }

    /** @param array<string,mixed> $attributes */
    public function updateTanker(FuelTanker $tanker, array $attributes, User $actor): FuelTanker
    {
        return DB::transaction(function () use ($tanker, $attributes, $actor) {
            $tanker = FuelTanker::lockForUpdate()->findOrFail($tanker->id);
            if (array_key_exists('fuel_tanker_owner_id', $attributes) && (string) $attributes['fuel_tanker_owner_id'] !== (string) $tanker->fuel_tanker_owner_id) {
                throw new RuntimeException('لا يُنقل الصهريج إلى صاحب آخر بتعديل مباشر؛ يحتاج مساراً مدقَّقاً يُعتمد لاحقاً.');
            }
            $before = $this->audit->snapshot($tanker);

            $changes = [];
            if (array_key_exists('plate_number', $attributes)) {
                $plate = $this->requiredText($attributes, 'plate_number', 'رقم لوحة الصهريج');
                $key = self::plateKey($plate);
                $this->assertPlateAvailable($key, $tanker->id);
                $changes['plate_number'] = $plate;
                $changes['plate_key'] = $key;
            }
            if (array_key_exists('plate_country', $attributes)) {
                $changes['plate_country'] = $this->nullableText($attributes['plate_country']);
            }
            if (array_key_exists('capacity_milliliters', $attributes)) {
                $changes['capacity_milliliters'] = $this->normalizedCapacity($attributes['capacity_milliliters']);
            }
            if (array_key_exists('notes', $attributes)) {
                $changes['notes'] = $this->nullableText($attributes['notes']);
            }
            if (array_key_exists('status', $attributes)) {
                $this->assertStatus($attributes['status'], FuelTanker::STATUSES);
                $changes['status'] = $attributes['status'];
            }

            try {
                $tanker->update($changes);
            } catch (UniqueConstraintViolationException) {
                throw $this->duplicate('plate_number', 'رقم اللوحة مسجَّل مسبقاً لصهريج آخر.');
            }
            $this->audit->record('tanker.updated', $tanker, $before, $this->audit->snapshot($tanker->fresh()), $actor, $this->nullableText($attributes['reason'] ?? null));

            return $tanker->fresh('owner');
        });
    }

    // ───────────────────────── ربط الشركات (مؤرَّخ) ─────────────────────────

    /**
     * ربط شركة (عميل رسمي) بصاحب صهريج من تاريخ (الافتراضي: اليوم) وحتى تاريخ اختياري. **لا يعيد نسب أي عملية سابقة**، ولا يُغلق ربط شركة بصاحب آخر
     * (تعدد الملاك لشركة واحدة وإعادة الإسناد قراران مفتوحان لـPR-10).
     *
     * @param array<string,mixed> $attributes
     */
    public function createLink(FuelTankerOwner $owner, array $attributes, User $actor): FuelTankerOwnerCompanyLink
    {
        return DB::transaction(function () use ($owner, $attributes, $actor) {
            $owner = $this->activeOwnerForUpdate($owner->id);
            $partner = $this->linkablePartner((string) ($attributes['partner_id'] ?? ''));

            $from = $this->date($attributes['valid_from'] ?? null) ?? CarbonImmutable::now()->startOfDay();
            $to = $this->date($attributes['valid_to'] ?? null);
            if ($to !== null && $to->lt($from)) {
                throw ValidationException::withMessages(['valid_to' => 'تاريخ نهاية الربط لا يسبق بدايته.']);
            }

            // تداخل الفترات لزوج (صاحب الصهريج، الشركة) نفسه: [from, to?] مع كل ربط قائم (قفل صف المالك أعلاه يسلسل المنافسين).
            $overlap = FuelTankerOwnerCompanyLink::query()
                ->where('fuel_tanker_owner_id', $owner->id)->where('partner_id', $partner->id)
                ->whereDate('valid_from', '<=', ($to ?? CarbonImmutable::parse('9999-12-31'))->toDateString())
                ->where(fn ($q) => $q->whereNull('valid_to')->orWhereDate('valid_to', '>=', $from->toDateString()))
                ->exists();
            if ($overlap) {
                throw ValidationException::withMessages(['partner_id' => 'هذه الشركة مرتبطة بصاحب الصهريج نفسه في فترة متداخلة.']);
            }

            try {
                $link = FuelTankerOwnerCompanyLink::create([
                    'fuel_tanker_owner_id' => $owner->id,
                    'partner_id' => $partner->id,
                    'valid_from' => $from->toDateString(),
                    'valid_to' => $to?->toDateString(),
                    'note' => $this->nullableText($attributes['note'] ?? null),
                    'created_by' => $actor->id,
                ]);
            } catch (UniqueConstraintViolationException) {
                throw ValidationException::withMessages(['valid_from' => 'يوجد ربط لهذه الشركة بالتاريخ نفسه.']);
            }
            $this->audit->record('tanker_owner_link.created', $link, null, $this->audit->snapshot($link), $actor, $this->nullableText($attributes['reason'] ?? null));

            return $link->load('partner');
        });
    }

    /** إنهاء ربط مفتوح بتاريخ (الافتراضي: اليوم). مرة واحدة؛ لا يُعاد فتحه ولا يُحذف. */
    public function endLink(FuelTankerOwnerCompanyLink $link, array $attributes, User $actor): FuelTankerOwnerCompanyLink
    {
        return DB::transaction(function () use ($link, $attributes, $actor) {
            // نفس ترتيب القفل في الإنشاء: صف صاحب الصهريج أولاً ثم الربط.
            FuelTankerOwner::lockForUpdate()->findOrFail($link->fuel_tanker_owner_id);
            $link = FuelTankerOwnerCompanyLink::lockForUpdate()->findOrFail($link->id);
            if ($link->valid_to !== null) {
                throw new RuntimeException('هذا الربط منتهٍ مسبقاً.');
            }
            $before = $this->audit->snapshot($link);
            $to = $this->date($attributes['valid_to'] ?? null) ?? CarbonImmutable::now()->startOfDay();
            if ($to->lt($link->valid_from)) {
                throw ValidationException::withMessages(['valid_to' => 'تاريخ نهاية الربط لا يسبق بدايته.']);
            }

            $link->update([
                'valid_to' => $to->toDateString(),
                'end_reason' => $this->nullableText($attributes['reason'] ?? null),
                'ended_by' => $actor->id,
                'ended_at' => now(),
            ]);
            $this->audit->record('tanker_owner_link.ended', $link, $before, $this->audit->snapshot($link->fresh()), $actor, $this->nullableText($attributes['reason'] ?? null));

            return $link->fresh('partner');
        });
    }

    // ───────────────────────── مساعدات ─────────────────────────

    /**
     * اللوحة المطبَّعة للمقارنة: أرقام عربية/فارسية→لاتينية، حذف المسافات والفواصل (-/_/.)، أحرف لاتينية كبيرة. لا تغيّر ما يُعرض (`plate_number`).
     */
    public static function plateKey(string $plate): string
    {
        $digits = ['٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4', '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9',
            '۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4', '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9'];
        $normalized = strtr(trim($plate), $digits);
        $normalized = preg_replace('/[\s\-_.\x{200C}\x{200D}\x{200E}\x{200F}]+/u', '', $normalized) ?? $normalized;

        return mb_strtoupper($normalized, 'UTF-8');
    }

    private function activeOwnerForUpdate(string $ownerId): FuelTankerOwner
    {
        $owner = $ownerId === '' ? null : FuelTankerOwner::lockForUpdate()->find($ownerId);
        if ($owner === null) {
            throw ValidationException::withMessages(['fuel_tanker_owner_id' => 'صاحب الصهريج غير موجود.']);
        }
        if (! $owner->isActive()) {
            throw new RuntimeException('صاحب الصهريج غير نشط؛ فعّله أولاً.');
        }

        return $owner;
    }

    /** الشركة المربوطة: عميل نشط (customer|both) من المستأجر الحالي وليس طرفاً نظامياً؛ وغيره «غير موجود» برسالة واحدة. */
    private function linkablePartner(string $partnerId): Partner
    {
        $partner = $partnerId === '' ? null : Partner::query()->whereNull('system_kind')->find($partnerId);
        if ($partner === null || ! $partner->isCustomer()) {
            throw ValidationException::withMessages(['partner_id' => 'الشركة غير موجودة ضمن عملاء المؤسسة.']);
        }
        if (! $partner->is_active) {
            throw ValidationException::withMessages(['partner_id' => 'العميل غير نشط.']);
        }

        return $partner;
    }

    private function assertOwnerCodeAvailable(?string $code, ?string $exceptId): void
    {
        if ($code === null) {
            return;
        }
        $exists = FuelTankerOwner::query()->where('code', $code)->when($exceptId, fn ($q) => $q->where('id', '!=', $exceptId))->exists();
        if ($exists) {
            throw $this->duplicate('code', 'رمز صاحب الصهريج مسجَّل مسبقاً.');
        }
    }

    private function assertPlateAvailable(string $key, ?string $exceptId): void
    {
        $exists = FuelTanker::query()->where('plate_key', $key)->when($exceptId, fn ($q) => $q->where('id', '!=', $exceptId))->exists();
        if ($exists) {
            throw $this->duplicate('plate_number', 'رقم اللوحة مسجَّل مسبقاً لصهريج آخر.');
        }
    }

    private function duplicate(string $field, string $message): ValidationException
    {
        return ValidationException::withMessages([$field => $message]);
    }

    /** @param list<string> $allowed */
    private function assertStatus(mixed $status, array $allowed): void
    {
        if (! is_string($status) || ! in_array($status, $allowed, true)) {
            throw ValidationException::withMessages(['status' => 'حالة غير صالحة.']);
        }
    }

    /**
     * سعة الصهريج بالمللتر كعدد صحيح موجب أو null. تُطبَّع القيمة المصدَّقة طلباً (نص رقمي من JSON أو form-encoded، أو رقم صحيح بصيغة عشرية كـ3.0E7) بالمعيار نفسه
     * لقاعدة `integer` في Laravel (`FILTER_VALIDATE_INT`)، فلا يُرفض تمثيلٌ صالح؛ وتبقى الكسور والصفر والسالب والمنطقي والنصوص غير العددية مرفوضة (فشل مغلق).
     */
    private function normalizedCapacity(mixed $capacity): ?int
    {
        if ($capacity === null) {
            return null;
        }
        $value = is_bool($capacity) ? false : filter_var($capacity, FILTER_VALIDATE_INT);
        if ($value === false || $value <= 0) {
            throw ValidationException::withMessages(['capacity_milliliters' => 'سعة الصهريج عدد صحيح موجب بالمللتر.']);
        }

        return $value;
    }

    /** @param array<string,mixed> $attributes */
    private function requiredText(array $attributes, string $key, string $label): string
    {
        $value = $this->nullableText($attributes[$key] ?? null);
        if ($value === null) {
            throw ValidationException::withMessages([$key => "{$label} مطلوب."]);
        }

        return $value;
    }

    private function nullableText(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        $text = trim((string) $value);

        return $text === '' ? null : $text;
    }

    private function date(mixed $value): ?CarbonImmutable
    {
        if ($value === null || $value === '') {
            return null;
        }

        return CarbonImmutable::parse((string) $value)->startOfDay();
    }
}
