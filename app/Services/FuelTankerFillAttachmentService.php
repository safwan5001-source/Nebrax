<?php

namespace App\Services;

use App\Models\FuelShift;
use App\Models\FuelStation;
use App\Models\FuelTankerFill;
use App\Models\FuelTankerFillAttachment;
use App\Models\User;
use App\Services\DocumentCenter\DocumentFileInspector;
use App\Tenancy\BranchScope;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * TANKER-PR5 — **الكاتب الوحيد** لمرفقات سندات تعبئة الصهاريج (`fuel_tanker_fill_attachments`) فوق `AttachmentStorage` (R2/محلي خاص) و`DocumentFileInspector` القائمين؛ لا تخزين موازٍ.
 *
 * ⚠ دليل فقط: لا يغيّر السند ولا الكمية ولا `inventory_status`، ولا يستدعي `InventoryService`/`LedgerService`/`InvoiceService`/`PaymentService` (يحرسه اختبار ساكن).
 *
 * - **الفحص على المحتوى الفعلي** (finfo + مطابقة الامتداد + سلامة الصورة/PDF) ثم حصر الأنواع في السقف الصلب (PDF/JPG/PNG) وتضييقه بسياسة المحطة (`tankerAttachmentPolicy`: الأنواع والحجم والعدد).
 * - **idempotent بالمحتوى:** فهرس فريد جزئي (السند، SHA-256) للمرفقات النشطة؛ إعادة رفع ملف مرفوع سابقاً (بعد انقطاع الرد) تُعيد الصف الموجود ولا تكتب ملفاً ثانياً، ولو تغيّرت السياسة بعدها.
 * - **ذرّية:** الملفات تُكتب أولاً (`putMany` كلها أو لا شيء) ثم تُدرج الصفوف والتدقيق في معاملة بعد قفل صف السند؛ أي فشل لاحق يحذف ما كُتب (تعويض لا يرمي ويُسجَّل فشله).
 * - **السجل التاريخي لا يُفقد:** الإزالة والاستبدال انتقالان (`removed`/`replaced` + منفّذ + وقت + سبب) والصف والملف يبقيان؛ لا حذف فعلي لأيٍّ منهما.
 * - ترتيب الأقفال: صف السند `FOR UPDATE` (يتسلسل مع الإضافة الأخرى والإلغاء `void` الذي يقفله كذلك) ← الوردية `FOR SHARE` (يتعارض مع `FOR UPDATE` الإغلاق) ← صف المرفق عند الاستبدال/الإزالة.
 *   لا يأخذ قفل المحطة (فلا دورة مع `void` الذي يبدأ بالمحطة ثم السند).
 */
class FuelTankerFillAttachmentService
{
    public const MAX_PER_REQUEST = 5;

    public function __construct(
        private readonly AttachmentStorage $storage,
        private readonly DocumentFileInspector $inspector,
        private readonly FuelStationSettingsService $settings,
        private readonly FuelStationAuditTrail $audit,
    ) {}

    // ───────────────────────── القراءة ─────────────────────────

    /**
     * @return \Illuminate\Support\Collection<int, FuelTankerFillAttachment>
     */
    public function list(FuelTankerFill $fill, User $actor, bool $history = false)
    {
        $this->requirePermission($actor, 'fuel.tanker.fill.view');
        $query = $this->attachments($fill)->with(['uploader:id,name', 'remover:id,name'])->orderBy('uploaded_at')->orderBy('id');
        if (! $history || ! $actor->hasPermission('fuel.tanker.fill.attachment.remove')) {
            $query->where('status', FuelTankerFillAttachment::STATUS_ACTIVE);
        }

        return $query->get();
    }

    /**
     * حالة المرفقات لواجهة المستخدم: السياسة الفعّالة وما يُسمح الآن ولماذا (لا استنتاج في المتصفح).
     *
     * @return array<string,mixed>
     */
    public function state(FuelTankerFill $fill, User $actor): array
    {
        $station = $this->station($fill);
        $policy = $this->settings->tankerAttachmentPolicy($station);
        $shift = FuelShift::query()->withoutGlobalScope(BranchScope::class)->find($fill->fuel_shift_id);
        $active = $this->attachments($fill)->where('status', FuelTankerFillAttachment::STATUS_ACTIVE)->count();
        $addBlock = $this->addBlock($fill, $shift, $policy, $active);
        $removeBlock = $this->removalBlock($fill, $shift, $policy);

        return [
            'policy' => [
                'required' => $policy['required'],
                'required_stage' => $policy['required_stage'],
                'mime_types' => $policy['mime_types'],
                'max_bytes' => $policy['max_bytes'],
                'max_count' => $policy['max_count'],
                'max_per_request' => self::MAX_PER_REQUEST,
                'after_close' => $policy['after_close'],
                'removal' => $policy['removal'],
            ],
            'active_count' => $active,
            'status' => $active > 0 ? 'present' : ($policy['required'] ? 'missing' : 'none'),
            'can_add' => $actor->hasPermission('fuel.tanker.fill.attachment.add') && $addBlock === null,
            'add_blocked_reason' => $addBlock,
            'can_remove' => $actor->hasPermission('fuel.tanker.fill.attachment.remove') && $removeBlock === null,
            'remove_blocked_reason' => $removeBlock,
            'can_view_history' => $actor->hasPermission('fuel.tanker.fill.attachment.remove'),
        ];
    }

    /**
     * مرفق قابل للتنزيل لمن يحق له: النشط لمن يملك العرض، والتاريخي (المُزال/المُستبدَل) لمن يملك صلاحية الإزالة فقط. غير ذلك 404 موحَّد.
     */
    public function forDownload(FuelTankerFill $fill, string $attachmentId, User $actor): FuelTankerFillAttachment
    {
        $this->requirePermission($actor, 'fuel.tanker.fill.view');
        $attachment = $this->attachments($fill)->whereKey($attachmentId)->first();
        if ($attachment === null) {
            throw $this->notFound();
        }
        if ($attachment->status !== FuelTankerFillAttachment::STATUS_ACTIVE && ! $actor->hasPermission('fuel.tanker.fill.attachment.remove')) {
            throw $this->notFound();
        }

        return $attachment;
    }

    /** اسم تنزيل يربط الملف بالسند الإلكتروني (FTF) والورقي — آمن لترويسة HTTP. */
    public function downloadName(FuelTankerFill $fill, FuelTankerFillAttachment $attachment): string
    {
        $safe = fn (string $value): string => trim((string) preg_replace('/[^\p{L}\p{N}._-]+/u', '_', $value), '_');
        $name = $safe($fill->number) . '__' . $safe($fill->voucher_number) . '__' . $safe($attachment->original_name);

        return mb_substr($name, 0, 200);
    }

    // ───────────────────────── الإضافة ─────────────────────────

    /**
     * @param  array<int, UploadedFile>  $files
     * @return array{attachments: list<FuelTankerFillAttachment>, created: int}
     *
     * @throws FuelTankerFillException
     */
    public function add(FuelTankerFill $fill, array $files, User $actor): array
    {
        $this->requirePermission($actor, 'fuel.tanker.fill.attachment.add');
        if ($files === [] || count($files) > self::MAX_PER_REQUEST) {
            throw new FuelTankerFillException(FuelTankerFillException::ATTACHMENT_INVALID, 'أرفق من ملف إلى ' . self::MAX_PER_REQUEST . ' ملفات في الطلب الواحد.');
        }

        // ملفات مكررة داخل الطلب نفسه تُدمج بمحتواها.
        $unique = [];
        foreach ($files as $file) {
            $info = $this->inspect($file);
            $unique[$info->sha256] ??= [$file, $info];
        }

        $existing = $this->activeByHash($fill, array_keys($unique));
        $fresh = array_filter($unique, fn ($pair, $hash) => ! $existing->has($hash), ARRAY_FILTER_USE_BOTH);
        if ($fresh === []) {
            // إعادة طلب أُنجز سابقاً: تُعاد الصفوف الموجودة حتى لو تغيّرت السياسة أو أُغلقت الوردية بعده (لا كتابة ولا فحص سياسة جديد).
            return ['attachments' => array_values(array_map(fn ($hash) => $existing->get($hash), array_keys($unique))), 'created' => 0];
        }

        $policy = $this->settings->tankerAttachmentPolicy($this->station($fill));
        foreach ($fresh as [, $info]) {
            $this->assertFileAllowed($info, $policy);
        }
        $shift = FuelShift::query()->withoutGlobalScope(BranchScope::class)->find($fill->fuel_shift_id);
        $this->assertCanAdd($fill, $shift, $policy, $this->activeCount($fill), count($fresh));

        $stored = $this->storeFiles($fill, array_map(fn ($pair) => $pair[0], array_values($fresh)));
        $storedByHash = array_combine(array_keys($fresh), $stored);

        $unused = [];
        try {
            $rows = DB::transaction(function () use ($fill, $unique, $fresh, $storedByHash, $actor, &$unused) {
                $locked = $this->lockFill($fill);
                $policy = $this->settings->tankerAttachmentPolicy($this->station($locked));
                $shift = FuelShift::query()->withoutGlobalScope(BranchScope::class)->lock('for share')->find($locked->fuel_shift_id);
                $current = $this->activeByHash($locked, array_keys($unique));
                $toInsert = array_filter($fresh, fn ($pair, $hash) => ! $current->has($hash), ARRAY_FILTER_USE_BOTH);
                if ($toInsert !== []) {
                    $this->assertCanAdd($locked, $shift, $policy, $this->activeCount($locked), count($toInsert));
                }

                $rows = [];
                foreach ($unique as $hash => [, $info]) {
                    if ($current->has($hash)) {
                        $unused[] = $storedByHash[$hash] ?? null; // سباق: سبقنا رفعٌ متزامن لنفس المحتوى ⇒ لا نسخة ثانية.
                        $rows[] = $current->get($hash);
                        continue;
                    }
                    $rows[] = $this->insertRow($locked, $storedByHash[$hash], $info, $actor);
                }

                return $rows;
            });
        } catch (Throwable $exception) {
            $this->storage->discard(array_values($storedByHash));
            if ($exception instanceof UniqueConstraintViolationException) {
                $winners = $this->activeByHash($fill, array_keys($unique));
                if ($winners->count() === count($unique)) {
                    return ['attachments' => $winners->values()->all(), 'created' => 0];
                }
            }

            throw $exception;
        }

        $this->storage->discard(array_values(array_filter($unused)));

        return ['attachments' => $rows, 'created' => count(array_filter($rows, fn ($row) => $row->wasRecentlyCreated))];
    }

    // ───────────────────────── الاستبدال والإزالة ─────────────────────────

    /**
     * يستبدل مرفقاً نشطاً بملف جديد: الجديد يُنشأ نشطاً ويُوسَم القديم `replaced` (الصف والملف يبقيان). إعادة الطلب نفسه (القديم صار مستبدَلاً بالمحتوى نفسه) تُعيد الجديد.
     *
     * @return array{attachment: FuelTankerFillAttachment, replayed: bool}
     *
     * @throws FuelTankerFillException
     */
    public function replace(FuelTankerFill $fill, FuelTankerFillAttachment $old, UploadedFile $file, User $actor): array
    {
        $this->requirePermission($actor, 'fuel.tanker.fill.attachment.remove');
        $this->requirePermission($actor, 'fuel.tanker.fill.attachment.add');
        $info = $this->inspect($file);

        if ($old->status === FuelTankerFillAttachment::STATUS_REPLACED && $old->replaced_by_attachment_id !== null) {
            $successor = $this->attachments($fill)->whereKey($old->replaced_by_attachment_id)->first();
            if ($successor !== null && $successor->sha256 === $info->sha256) {
                return ['attachment' => $successor, 'replayed' => true];
            }
        }
        if ($old->status !== FuelTankerFillAttachment::STATUS_ACTIVE) {
            throw new FuelTankerFillException(FuelTankerFillException::ATTACHMENT_NOT_ACTIVE, 'المرفق ليس نشطاً؛ لا يُستبدل.', 409);
        }
        if ($old->sha256 === $info->sha256) {
            throw new FuelTankerFillException(FuelTankerFillException::ATTACHMENT_SAME_CONTENT, 'الملف الجديد مطابق للمرفق الحالي.');
        }
        if ($this->activeByHash($fill, [$info->sha256])->isNotEmpty()) {
            throw new FuelTankerFillException(FuelTankerFillException::ATTACHMENT_DUPLICATE, 'هذا الملف مرفق بالسند نفسه مسبقاً.', 409);
        }

        $policy = $this->settings->tankerAttachmentPolicy($this->station($fill));
        $this->assertFileAllowed($info, $policy);
        $shift = FuelShift::query()->withoutGlobalScope(BranchScope::class)->find($fill->fuel_shift_id);
        $this->assertCanReplace($fill, $shift, $policy);

        [$stored] = $this->storeFiles($fill, [$file]);
        try {
            $row = DB::transaction(function () use ($fill, $old, $stored, $info, $actor) {
                $locked = $this->lockFill($fill);
                $policy = $this->settings->tankerAttachmentPolicy($this->station($locked));
                $shift = FuelShift::query()->withoutGlobalScope(BranchScope::class)->lock('for share')->find($locked->fuel_shift_id);
                $this->assertCanReplace($locked, $shift, $policy);
                $current = $this->attachments($locked)->whereKey($old->id)->lockForUpdate()->first();
                if ($current === null || $current->status !== FuelTankerFillAttachment::STATUS_ACTIVE) {
                    throw new FuelTankerFillException(FuelTankerFillException::ATTACHMENT_NOT_ACTIVE, 'المرفق ليس نشطاً؛ لا يُستبدل.', 409);
                }
                if ($this->activeByHash($locked, [$info->sha256])->isNotEmpty()) {
                    throw new FuelTankerFillException(FuelTankerFillException::ATTACHMENT_DUPLICATE, 'هذا الملف مرفق بالسند نفسه مسبقاً.', 409);
                }

                $new = $this->insertRow($locked, $stored, $info, $actor, $current->id, audit: false);
                $current->forceFill([
                    'status' => FuelTankerFillAttachment::STATUS_REPLACED,
                    'removed_by' => $actor->id,
                    'removed_at' => now(),
                    'replaced_by_attachment_id' => $new->id,
                ])->save();
                $this->audit->record('tanker_fill.attachment_replaced', $locked, null, [
                    'attachment_id' => $current->id, 'replaced_by_attachment_id' => $new->id,
                    'old' => $this->describe($current), 'new' => $this->describe($new),
                ], $actor);

                return $new;
            });
        } catch (Throwable $exception) {
            $this->storage->discard([$stored]);

            throw $exception;
        }

        return ['attachment' => $row, 'replayed' => false];
    }

    /**
     * يزيل مرفقاً نشطاً بسبب: انتقال إلى `removed` يحتفظ بالصف والملف (السجل التاريخي) — لا حذف فعلي. idempotent: المُزال سابقاً يُعاد كما هو.
     *
     * @return array{attachment: FuelTankerFillAttachment, replayed: bool}
     *
     * @throws FuelTankerFillException
     */
    public function remove(FuelTankerFill $fill, FuelTankerFillAttachment $attachment, string $reason, User $actor): array
    {
        $this->requirePermission($actor, 'fuel.tanker.fill.attachment.remove');
        $reason = trim($reason);
        if (mb_strlen($reason) < 3 || mb_strlen($reason) > 500) {
            throw new FuelTankerFillException(FuelTankerFillException::INVALID_INPUT, 'سبب الإزالة مطلوب (3 إلى 500 حرف).');
        }

        return DB::transaction(function () use ($fill, $attachment, $reason, $actor) {
            $locked = $this->lockFill($fill);
            $current = $this->attachments($locked)->whereKey($attachment->id)->lockForUpdate()->first();
            if ($current === null) {
                throw $this->notFound();
            }
            if ($current->status === FuelTankerFillAttachment::STATUS_REMOVED) {
                return ['attachment' => $current, 'replayed' => true];
            }
            if ($current->status !== FuelTankerFillAttachment::STATUS_ACTIVE) {
                throw new FuelTankerFillException(FuelTankerFillException::ATTACHMENT_NOT_ACTIVE, 'المرفق ليس نشطاً؛ لا يُزال.', 409);
            }
            $policy = $this->settings->tankerAttachmentPolicy($this->station($locked));
            $shift = FuelShift::query()->withoutGlobalScope(BranchScope::class)->lock('for share')->find($locked->fuel_shift_id);
            $block = $this->removalBlock($locked, $shift, $policy);
            if ($block !== null) {
                throw $this->removalException($block);
            }

            $current->forceFill([
                'status' => FuelTankerFillAttachment::STATUS_REMOVED,
                'removed_by' => $actor->id,
                'removed_at' => now(),
                'removal_reason' => $reason,
            ])->save();
            $this->audit->record('tanker_fill.attachment_removed', $locked, null, ['attachment_id' => $current->id, 'attachment' => $this->describe($current)], $actor, $reason);

            return ['attachment' => $current->fresh(), 'replayed' => false];
        });
    }

    // ───────────────────────── الداخل ─────────────────────────

    /**
     * @param  array<int, UploadedFile>  $files
     * @return list<array{disk:string,path:string,original_name:string,mime_type:?string,size:int}>
     */
    private function storeFiles(FuelTankerFill $fill, array $files): array
    {
        try {
            return $this->storage->putMany(AttachmentStorage::DOMAIN_FUEL_TANKER_FILL, (string) $fill->id, $files, "fuel-tanker-fills/{$fill->id}");
        } catch (Throwable $exception) {
            report($exception);

            throw new FuelTankerFillException(FuelTankerFillException::ATTACHMENT_STORAGE_FAILED, 'تعذّر حفظ الملف؛ لم يُسجَّل شيء. أعد المحاولة.', 503);
        }
    }

    /** @param array{disk:string,path:string} $stored */
    private function insertRow(FuelTankerFill $fill, array $stored, \App\Services\DocumentCenter\InspectedDocumentFile $info, User $actor, ?string $replaces = null, bool $audit = true): FuelTankerFillAttachment
    {
        $row = new FuelTankerFillAttachment([
            'branch_id' => $fill->branch_id,
            'fuel_tanker_fill_id' => $fill->id,
            'disk' => $stored['disk'],
            'path' => $stored['path'],
            'original_name' => $info->originalName,
            'mime_type' => $info->detectedMime,
            'size' => $info->sizeBytes,
            'sha256' => $info->sha256,
            'uploaded_by' => $actor->id,
            'uploaded_at' => now(),
            'replaces_attachment_id' => $replaces,
        ]);
        $row->id = (string) Str::uuid();
        $row->save();
        if ($audit) {
            $this->audit->record('tanker_fill.attachment_added', $fill, null, ['attachment_id' => $row->id, 'attachment' => $this->describe($row)], $actor);
        }

        return $row;
    }

    /** وصف آمن للتدقيق: هوية الملف لا محتواه ولا مساره الداخلي. @return array<string,mixed> */
    private function describe(FuelTankerFillAttachment $attachment): array
    {
        return ['original_name' => $attachment->original_name, 'mime_type' => $attachment->mime_type, 'size' => $attachment->size, 'sha256' => $attachment->sha256];
    }

    private function inspect(mixed $file): \App\Services\DocumentCenter\InspectedDocumentFile
    {
        if (! $file instanceof UploadedFile) {
            throw new FuelTankerFillException(FuelTankerFillException::ATTACHMENT_INVALID, 'ملف غير صالح.');
        }
        try {
            $info = $this->inspector->inspect($file);
        } catch (ValidationException $exception) {
            $message = collect($exception->errors())->flatten()->first() ?? 'الملف غير صالح.';

            throw new FuelTankerFillException(FuelTankerFillException::ATTACHMENT_INVALID, (string) $message);
        }
        // السقف الصلب (PDF/JPG/PNG) يسري دائماً أياً كانت السياسة؛ الفاحص يقبل WebP أيضاً لغير هذا المسار.
        if (! in_array($info->detectedMime, FuelStationSettingsService::TANKER_ATTACHMENT_TYPES['images_and_pdf'], true)) {
            throw new FuelTankerFillException(FuelTankerFillException::ATTACHMENT_TYPE_NOT_ALLOWED, 'الأنواع المسموحة: PDF وJPG وPNG.');
        }

        return $info;
    }

    /** @param array{mime_types: list<string>, max_bytes: int} $policy */
    private function assertFileAllowed(\App\Services\DocumentCenter\InspectedDocumentFile $info, array $policy): void
    {
        if (! in_array($info->detectedMime, $policy['mime_types'], true)) {
            throw new FuelTankerFillException(FuelTankerFillException::ATTACHMENT_TYPE_NOT_ALLOWED, 'نوع الملف غير مسموح بسياسة هذه المحطة.', 422, ['allowed_mime_types' => $policy['mime_types']]);
        }
        if ($info->sizeBytes > $policy['max_bytes']) {
            throw new FuelTankerFillException(FuelTankerFillException::ATTACHMENT_TOO_LARGE, 'حجم الملف يتجاوز الحد المسموح لهذه المحطة.', 422, ['max_bytes' => $policy['max_bytes']]);
        }
    }

    /** @param array<string,mixed> $policy */
    private function addBlock(FuelTankerFill $fill, ?FuelShift $shift, array $policy, int $activeCount, int $adding = 1): ?string
    {
        if ($fill->status === FuelTankerFill::STATUS_VOIDED) {
            return 'fill_voided';
        }
        if (($shift === null || ! $shift->isOpen()) && $policy['after_close'] === 'deny') {
            return 'shift_closed';
        }
        if ($activeCount + $adding > $policy['max_count']) {
            return 'limit_reached';
        }

        return null;
    }

    /** @param array<string,mixed> $policy */
    private function assertCanAdd(FuelTankerFill $fill, ?FuelShift $shift, array $policy, int $activeCount, int $adding): void
    {
        $block = $this->addBlock($fill, $shift, $policy, $activeCount, $adding);
        if ($block === 'limit_reached') {
            throw new FuelTankerFillException(FuelTankerFillException::ATTACHMENT_LIMIT_REACHED, 'بلغ السند الحد الأقصى لعدد المرفقات.', 422, ['max_count' => $policy['max_count']]);
        }
        if ($block !== null) {
            throw new FuelTankerFillException(
                FuelTankerFillException::ATTACHMENT_ADD_BLOCKED,
                $block === 'fill_voided' ? 'السند ملغى؛ لا تُضاف إليه مرفقات.' : 'سياسة المحطة تمنع إضافة المرفقات بعد إغلاق الوردية.',
                422,
                ['blocked_reason' => $block],
            );
        }
    }

    /** @param array<string,mixed> $policy */
    private function removalBlock(FuelTankerFill $fill, ?FuelShift $shift, array $policy): ?string
    {
        if ($fill->status === FuelTankerFill::STATUS_VOIDED) {
            return 'fill_voided';
        }
        if ($policy['removal'] === 'never') {
            return 'removal_disabled';
        }
        if ($policy['removal'] === 'open_shift_only' && ($shift === null || ! $shift->isOpen())) {
            return 'shift_closed';
        }

        return null;
    }

    /** الاستبدال إزالة + إضافة: تسري عليه سياستا الإزالة والإضافة بعد الإغلاق معاً. @param array<string,mixed> $policy */
    private function assertCanReplace(FuelTankerFill $fill, ?FuelShift $shift, array $policy): void
    {
        $block = $this->removalBlock($fill, $shift, $policy);
        if ($block !== null) {
            throw $this->removalException($block);
        }
        if (($shift === null || ! $shift->isOpen()) && $policy['after_close'] === 'deny') {
            throw new FuelTankerFillException(FuelTankerFillException::ATTACHMENT_ADD_BLOCKED, 'سياسة المحطة تمنع إضافة المرفقات بعد إغلاق الوردية.', 422, ['blocked_reason' => 'shift_closed']);
        }
    }

    private function removalException(string $block): FuelTankerFillException
    {
        $message = match ($block) {
            'fill_voided' => 'السند ملغى؛ لا تُعدَّل مرفقاته.',
            'removal_disabled' => 'سياسة المحطة تمنع إزالة المرفقات واستبدالها.',
            default => 'سياسة المحطة تسمح بإزالة المرفقات واستبدالها أثناء الوردية المفتوحة فقط.',
        };

        return new FuelTankerFillException(FuelTankerFillException::ATTACHMENT_REMOVAL_BLOCKED, $message, 422, ['blocked_reason' => $block]);
    }

    private function lockFill(FuelTankerFill $fill): FuelTankerFill
    {
        $locked = FuelTankerFill::query()->withoutGlobalScope(BranchScope::class)->lockForUpdate()->find($fill->id);
        if ($locked === null) {
            throw $this->notFound();
        }

        return $locked;
    }

    private function station(FuelTankerFill $fill): FuelStation
    {
        $station = FuelStation::query()->find($fill->fuel_station_id);
        if ($station === null) {
            throw $this->notFound();
        }

        return $station;
    }

    /** @return \Illuminate\Database\Eloquent\Builder<FuelTankerFillAttachment> */
    private function attachments(FuelTankerFill $fill)
    {
        return FuelTankerFillAttachment::query()->withoutGlobalScope(BranchScope::class)->where('fuel_tanker_fill_id', $fill->id);
    }

    private function activeCount(FuelTankerFill $fill): int
    {
        return $this->attachments($fill)->where('status', FuelTankerFillAttachment::STATUS_ACTIVE)->count();
    }

    /**
     * @param  list<string|int>  $hashes
     * @return \Illuminate\Support\Collection<string, FuelTankerFillAttachment>
     */
    private function activeByHash(FuelTankerFill $fill, array $hashes)
    {
        return $this->attachments($fill)->where('status', FuelTankerFillAttachment::STATUS_ACTIVE)->whereIn('sha256', $hashes)->get()->keyBy('sha256');
    }

    private function requirePermission(User $actor, string $permission): void
    {
        if (! $actor->hasPermission($permission)) {
            throw new FuelTankerFillException(FuelTankerFillException::FORBIDDEN, 'لا تملك صلاحية تنفيذ هذه العملية.', 403);
        }
    }

    private function notFound(): FuelTankerFillException
    {
        return new FuelTankerFillException(FuelTankerFillException::NOT_FOUND, 'السجل غير موجود.', 404);
    }
}
