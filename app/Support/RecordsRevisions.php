<?php

namespace App\Support;

use App\Models\DocumentRevision;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Illuminate\Support\Facades\DB;

/**
 * ═══════════════════════════════════════════════════════════════
 *  تسجيل تغييرات المستند — تلقائي، لا يعتمد على انضباط الخدمات
 * ═══════════════════════════════════════════════════════════════
 *  يُركَّب على النموذج لا على الخدمة عمداً: التسجيل في الخدمات يعني أن كل
 *  مسار جديد يجب أن يتذكّر التسجيل — وأول مسار ينساه يعيدنا إلى الصمت الذي
 *  أخفى أعطال #165/#166. على النموذج، **كل** كتابة تُسجَّل بلا استثناء.
 *
 *  **دمج الكتابات المتتالية:** الخدمة تكتب الرأس ثم الإجماليات في نداءين،
 *  فلولا الدمج لظهر التعديل الواحد سجلَّين. تُجمَّع كتابات الطلب الواحد في
 *  قيد واحد: أقدمُ قيمة «قبل» وأحدثُ قيمة «بعد».
 */
trait RecordsRevisions
{
    /**
     * حقول لا تُسجَّل: طوابع الوقت، وحقول ZATCA الضخمة (XML كامل لكل قيد
     * كان سيُضخّم السجلّ بلا فائدة — الهاش وحده يكفي للتتبّع).
     */
    private static array $revisionIgnored = [
        'updated_at', 'created_at', 'zatca_xml', 'zatca_qr', 'zatca_previous_hash',
    ];

    public static function bootRecordsRevisions(): void
    {
        static::created(fn (Model $model) => $model->writeRevision('created', []));

        static::updated(function (Model $model) {
            $changes = [];

            foreach ($model->getChanges() as $key => $new) {
                if (in_array($key, self::$revisionIgnored, true)) {
                    continue;
                }
                // داخل حدث `updated` لم تُزامَن الأصول بعد، فـ getOriginal يعطي ما قبل الحفظ.
                $changes[$key] = [self::revisionValue($model->getOriginal($key)), self::revisionValue($new)];
            }

            if ($changes !== []) {
                $model->writeRevision('updated', $changes);
            }
        });
    }

    public function revisions(): MorphMany
    {
        return $this->morphMany(DocumentRevision::class, 'document')->latest();
    }

    /**
     * يكتب القيد أو يدمج فيه إن سبق لهذا الطلب أن كتب واحداً لهذا المستند.
     * الدمج يحفظ أقدم «قبل» وأحدث «بعد»، فيقرأ التعديل كعملية واحدة.
     */
    public function writeRevision(string $action, array $changes): void
    {
        $buffer = app(RevisionBuffer::class);
        $key    = static::class . ':' . $this->getKey();

        if ($existing = $buffer->get($key)) {
            $merged = $existing->diff ?? [];
            foreach ($changes as $field => [$old, $new]) {
                $merged[$field] = [$merged[$field][0] ?? $old, $new];
            }
            // إنشاءٌ تلاه تعديل يبقى «إنشاءً» — لا حدثين على مستند وُلد للتوّ.
            $existing->update(['diff' => $merged]);

            return;
        }

        $buffer->put($key, DocumentRevision::create([
            'document_type' => static::class,
            'document_id'   => $this->getKey(),
            'action'        => $action === 'created' ? 'created' : (array_key_exists('status', $changes) ? 'status' : 'updated'),
            'diff'          => $changes,
            'user_id'       => auth()->id(),
        ]));

        // حدّ الدمج هو المعاملة لا عمر الحاوية: عند إتمام المعاملة الخارجية
        // يُنسى المفتاح، فلا يُدمج تعديلُ عمليةٍ لاحقة في قيد عملية سابقة.
        // (خارج أي معاملة يُنفَّذ فوراً، فتُسجَّل كل كتابة على حدة — وهو الصواب.)
        DB::afterCommit(fn () => $buffer->forget($key));
    }

    /** قيمة قابلة للتخزين في json — التواريخ نصوصاً والكائنات مُسطَّحة. */
    private static function revisionValue(mixed $value): mixed
    {
        if ($value instanceof \DateTimeInterface) {
            return $value->format('Y-m-d');
        }

        return is_scalar($value) || $value === null ? $value : (string) $value;
    }
}
