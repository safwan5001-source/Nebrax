<?php

namespace App\Services;

use App\Models\FuelStation;
use App\Models\FuelStationWalkInPartner;
use App\Models\Partner;
use App\Models\User;
use App\Services\Accounting\PartnerService;
use App\Support\Rbac;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * العميل النقدي المخصّص لمحطة وقود (P1-3a، التحفظ 3): إجراء إداري صريح **لا ينشأ عند الإغلاق**.
 *
 *  • طرف عميل واحد لكل محطة، رمزه حتمي `FWI-<16 خانة SHA-256(tenant|station)>`، **بلا رقم ضريبي** (فاتورته تُصنَّف `simplified` لاحقاً)، وموسوم
 *    `system_kind = fuel_walk_in` فيُستبعد من قائمة العملاء ولا يُختار يدوياً. لا مطابقة ولا دمج مع أي عميل مسمّى بالاسم أو الهاتف.
 *  • المحطة والطرف كلاهما فريد في القاعدة (محطة ثانية لا تعيد استعمال الطرف)، والمستأجر الآخر مرفوض بحارس القاعدة.
 *  • **idempotent**: التعيين الثاني يعيد الربط القائم بلا أثر. الربط ثابت (لا فك ولا استبدال في V1 — قرار مؤجَّل).
 *  • لا قيد محاسبي: `PartnerService::create` برصيد افتتاحي صفر لا يولّد قيداً (يحرسه الاختبار).
 *
 * الصلاحية `fuel.governance.manage` (تُفحص هنا لا في المتحكم وحده)، وترتيب القفل: صف المحطة `FOR NO KEY UPDATE` (كمسارات الوردية والبيع) ثم
 * قفل استشاري على PostgreSQL حول البحث+الإنشاء (نمط `CustomerPartnerResolver`، فلا يُلتقط خطأ تفرّد داخل معاملة PG).
 */
class FuelStationWalkInPartnerService
{
    public const SYSTEM_KIND = 'fuel_walk_in';
    public const CODE_PREFIX = 'FWI-';

    public function __construct(
        private readonly PartnerService $partners,
        private readonly FuelStationAuditTrail $audit,
    ) {}

    public static function codeFor(string $tenantId, string $stationId): string
    {
        return self::CODE_PREFIX.strtoupper(substr(hash('sha256', $tenantId.'|'.$stationId), 0, 16));
    }

    /** @return array{partner:Partner,link:FuelStationWalkInPartner,created:bool} */
    public function assign(FuelStation $station, User $actor): array
    {
        if (! Rbac::allows((string) $actor->role, FuelStationSettingsService::GOVERNANCE_PERMISSION)) {
            throw new AuthorizationException('تعيين العميل النقدي للمحطة يتطلب صلاحية حوكمة الوقود.');
        }

        return DB::transaction(function () use ($station, $actor) {
            $locked = FuelStation::query()->whereKey($station->id)->lock('for no key update')->firstOrFail();

            $existing = FuelStationWalkInPartner::query()->where('fuel_station_id', $locked->id)->first();
            if ($existing !== null) {
                $partner = $this->partnerOf($existing);
                if ($partner->trashed()) {
                    // الربط ثابت؛ طرفٌ حُذف ناعماً يُستعاد (إصلاح idempotent) بدل أن يبقى الربط على طرف محذوف.
                    $partner->restore();
                }

                return ['partner' => $partner, 'link' => $existing, 'created' => false];
            }

            $code = self::codeFor((string) $locked->tenant_id, (string) $locked->id);
            if (DB::getDriverName() === 'pgsql') {
                DB::select('select pg_advisory_xact_lock(hashtextextended(?, 0))', ['fuel-walk-in:'.$locked->tenant_id.':'.$locked->id]);
            }

            $partner = Partner::query()->withoutGlobalScopes()->withTrashed()
                ->where('tenant_id', $locked->tenant_id)->where('code', $code)->first();
            if ($partner !== null) {
                // رمز حتمي لا يصطدم عملياً؛ لو وُجد طرف بالرمز نفسه وليس نظامياً فلا نتبنّاه (فشل مغلق).
                if ($partner->system_kind !== self::SYSTEM_KIND) {
                    throw new RuntimeException('FUEL_SETTLEMENT_WALK_IN_CODE_CONFLICT: رمز العميل النقدي محجوز لطرف آخر.');
                }
                if ($partner->trashed()) {
                    $partner->restore();
                }
            } else {
                $partner = $this->partners->create([
                    'branch_id' => $locked->branch_id,
                    'code' => $code,
                    'type' => 'customer',
                    'entity_type' => 'individual',
                    'name' => 'عميل نقدي — '.$locked->name,
                    'name_en' => 'Walk-in customer — '.($locked->name_en ?? $locked->code),
                    'is_active' => true,
                    // لا رقم ضريبي ولا عنوان ولا رصيد افتتاحي: لا يُخترع شيء للعميل النقدي.
                ]);
                $partner->forceFill(['system_kind' => self::SYSTEM_KIND])->save();
            }

            $link = new FuelStationWalkInPartner();
            $link->forceFill([
                'tenant_id' => $locked->tenant_id,
                'branch_id' => $locked->branch_id,
                'fuel_station_id' => $locked->id,
                'partner_id' => $partner->id,
                'created_by' => $actor->id,
            ])->save();

            $this->audit->record('station.walk_in_partner_assigned', $link, null, [
                'fuel_station_id' => $locked->id, 'partner_id' => $partner->id, 'code' => $code,
            ], $actor);

            return ['partner' => $partner, 'link' => $link, 'created' => true];
        });
    }

    /** @return array{assigned:bool,partner:?array{id:string,code:?string,name:string,is_active:bool}} */
    public function view(FuelStation $station): array
    {
        $link = FuelStationWalkInPartner::query()->where('fuel_station_id', $station->id)->first();
        if ($link === null) {
            return ['assigned' => false, 'partner' => null];
        }
        $partner = $this->partnerOf($link);

        return ['assigned' => true, 'partner' => [
            'id' => $partner->id, 'code' => $partner->code, 'name' => $partner->name, 'is_active' => (bool) $partner->is_active,
        ]];
    }

    private function partnerOf(FuelStationWalkInPartner $link): Partner
    {
        return Partner::query()->withoutGlobalScopes()->withTrashed()->where('tenant_id', $link->tenant_id)->findOrFail($link->partner_id);
    }
}
