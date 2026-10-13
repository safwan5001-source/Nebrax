<?php

namespace App\Support;

use LogicException;

/**
 * سجلّ جاهزية مزوّدي التوصيل للتكامل الأصلي — INT-READY-1.
 *
 * ثابت يملكه الخادم، من العائلة نفسها لـ`DeliveryPlatformCatalog`: لا جدول، لا
 * إعداد مستأجر، لا تعديل عبر API. يُعدَّل **فقط** بطلب دمج يستشهد بالدليل
 * (R-GATE-3/4 في `docs/plans/pos/DLV-INTEGRATIONS-UX-DESIGN-1.md`).
 *
 * القيم مأخوذة حرفياً من `DLV-PROVIDER-READINESS-1-REPORT.md` (التحقق 2026-10-11).
 * لم يُضَف أي ادّعاء خارجي جديد. لا مزوّد `READY`، وكل `connect_enabled` و
 * `sync_enabled` تساوي `false`. تحويل أي منها إلى `true` طلب دمج مستقل (R-GATE-4)
 * ويفرضه اختبار تجميد يحتاج تعديلاً صريحاً في الطلب نفسه.
 *
 * ما لا يفعله: لا يتصل بمزوّد، لا يخزّن بيانات اعتماد، لا يفعّل منصة، ولا يلمس
 * ملفات المنصات (`DeliveryPlatformProfile`) ولا الفواتير ولا القيود. حالة الإسناد
 * اليدوي في نقطة البيع (الخطوة A) مستقلة تماماً عن هذا السجل (الخطوة B).
 */
final class DeliveryProviderReadiness
{
    /** مفردات تقرير الأدلة (DLV-PROVIDER-READINESS-1). `READY` غير مستخدمة اليوم. */
    public const TECHNICAL_READY = 'READY';

    public const TECHNICAL_BLOCKED = 'BLOCKED';

    public const TECHNICAL_OWNER_GATE = 'OWNER_GATE';

    public const TECHNICAL_STATUSES = [
        self::TECHNICAL_READY,
        self::TECHNICAL_BLOCKED,
        self::TECHNICAL_OWNER_GATE,
    ];

    /** حالات UX على مستوى المزوّد (مشتقّة، وليست قيم قاعدة بيانات). */
    public const STATE_NOT_SUPPORTED = 'NOT_SUPPORTED';

    public const STATE_AWAITING_PROVIDER_APPROVAL = 'AWAITING_PROVIDER_APPROVAL';

    public const STATE_READY_TO_CONNECT = 'READY_TO_CONNECT';

    private const EVIDENCE = 'docs/plans/pos/DLV-PROVIDER-READINESS-1-REPORT.md';

    private const EVIDENCE_DATE = '2026-10-11';

    private const FIELDS = [
        'technical',
        'evidence_ref',
        'evidence_date',
        'auth_method',
        'connect_enabled',
        'sync_enabled',
    ];

    /**
     * الترتيب ثابت ومقصود: ترتيب سجلّ العرض في الواجهة (HungerStation، Jahez،
     * Mrsool، Keeta، Ninja، The Chefz) — لا ترتيب تفضيل ولا توصية.
     *
     * @var array<string, array{technical:string,evidence_ref:string,evidence_date:string,auth_method:?string,connect_enabled:bool,sync_enabled:bool}>
     */
    private const ROWS = [
        'hungerstation' => [
            'technical' => self::TECHNICAL_OWNER_GATE,
            'evidence_ref' => self::EVIDENCE . ' §4.1',
            'evidence_date' => self::EVIDENCE_DATE,
            'auth_method' => null,
            'connect_enabled' => false,
            'sync_enabled' => false,
        ],
        'jahez' => [
            'technical' => self::TECHNICAL_BLOCKED,
            'evidence_ref' => self::EVIDENCE . ' §4.2',
            'evidence_date' => self::EVIDENCE_DATE,
            'auth_method' => null,
            'connect_enabled' => false,
            'sync_enabled' => false,
        ],
        'mrsool' => [
            'technical' => self::TECHNICAL_BLOCKED,
            'evidence_ref' => self::EVIDENCE . ' §4.3',
            'evidence_date' => self::EVIDENCE_DATE,
            'auth_method' => null,
            'connect_enabled' => false,
            'sync_enabled' => false,
        ],
        'keeta' => [
            'technical' => self::TECHNICAL_OWNER_GATE,
            'evidence_ref' => self::EVIDENCE . ' §4.4',
            'evidence_date' => self::EVIDENCE_DATE,
            'auth_method' => null,
            'connect_enabled' => false,
            'sync_enabled' => false,
        ],
        'ninja' => [
            'technical' => self::TECHNICAL_BLOCKED,
            'evidence_ref' => self::EVIDENCE . ' §4.5',
            'evidence_date' => self::EVIDENCE_DATE,
            'auth_method' => null,
            'connect_enabled' => false,
            'sync_enabled' => false,
        ],
        'the_chefz' => [
            'technical' => self::TECHNICAL_BLOCKED,
            'evidence_ref' => self::EVIDENCE . ' §4.6',
            'evidence_date' => self::EVIDENCE_DATE,
            'auth_method' => null,
            'connect_enabled' => false,
            'sync_enabled' => false,
        ],
    ];

    /** @return array<string, array{technical:string,evidence_ref:string,evidence_date:string,auth_method:?string,connect_enabled:bool,sync_enabled:bool}> */
    public static function all(): array
    {
        return self::ROWS;
    }

    /** @return list<string> */
    public static function keys(): array
    {
        return array_keys(self::ROWS);
    }

    /** @return array{technical:string,evidence_ref:string,evidence_date:string,auth_method:?string,connect_enabled:bool,sync_enabled:bool}|null */
    public static function get(string $key): ?array
    {
        return self::ROWS[$key] ?? null;
    }

    /**
     * حالة UX على مستوى المزوّد (§4.2 من وثيقة التصميم). `READY_TO_CONNECT` تتطلب
     * `READY` **و** `connect_enabled`؛ حالة تقنية جاهزة وحدها لا تكفي (R-LADDER-2).
     *
     * @param  array{technical:string,connect_enabled:bool}  $row
     */
    public static function uxState(array $row): string
    {
        if ($row['technical'] === self::TECHNICAL_BLOCKED) {
            return self::STATE_NOT_SUPPORTED;
        }

        if ($row['technical'] === self::TECHNICAL_READY && $row['connect_enabled'] === true) {
            return self::STATE_READY_TO_CONNECT;
        }

        return self::STATE_AWAITING_PROVIDER_APPROVAL;
    }

    /**
     * يتحقق من اتساق صفوف السجلّ، ويفشل بـ`LogicException` عند أي تناقض. تستدعيه
     * البوابة عند البناء، فلا يمكن أن يعمل نظام بسجلّ يسمح بالربط لمزوّد غير جاهز.
     *
     * @param  array<string, mixed>  $rows
     */
    public static function validate(array $rows): void
    {
        $expected = DeliveryPlatformCatalog::keys();
        $given = array_map('strval', array_keys($rows));
        if (array_diff($expected, $given) !== [] || array_diff($given, $expected) !== []) {
            throw new LogicException('Provider readiness must cover exactly the delivery platform catalog keys.');
        }

        foreach ($rows as $key => $row) {
            if (! is_array($row) || array_keys($row) !== self::FIELDS) {
                throw new LogicException("Readiness row {$key} must have exactly the documented fields.");
            }
            if (! in_array($row['technical'], self::TECHNICAL_STATUSES, true)) {
                throw new LogicException("Readiness row {$key} has an unknown technical status.");
            }
            if (! is_string($row['evidence_ref']) || trim($row['evidence_ref']) === '') {
                throw new LogicException("Readiness row {$key} needs an evidence reference.");
            }
            if (! is_string($row['evidence_date']) || preg_match('/^\d{4}-\d{2}-\d{2}$/', $row['evidence_date']) !== 1) {
                throw new LogicException("Readiness row {$key} needs an ISO evidence date.");
            }
            if ($row['auth_method'] !== null && (! is_string($row['auth_method']) || trim($row['auth_method']) === '')) {
                throw new LogicException("Readiness row {$key} has an invalid auth method.");
            }
            if (! is_bool($row['connect_enabled']) || ! is_bool($row['sync_enabled'])) {
                throw new LogicException("Readiness row {$key} flags must be booleans.");
            }
            if ($row['connect_enabled'] && $row['technical'] !== self::TECHNICAL_READY) {
                throw new LogicException("Readiness row {$key} cannot enable connect unless technically READY.");
            }
            if ($row['connect_enabled'] && $row['auth_method'] === null) {
                throw new LogicException("Readiness row {$key} cannot enable connect without a declared auth method.");
            }
            if ($row['sync_enabled'] && ! $row['connect_enabled']) {
                throw new LogicException("Readiness row {$key} cannot enable sync without connect.");
            }
        }
    }
}
