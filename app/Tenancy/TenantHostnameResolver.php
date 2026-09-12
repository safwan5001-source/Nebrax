<?php

namespace App\Tenancy;

use App\Models\Tenant;
use App\Support\HostnameNormalizer;
use App\Support\InvalidHostnameException;
use Illuminate\Http\Request;

/**
 * حسم مستأجر ERP من hostname — V1 نطاقات فرعية تحت نطاق AWJ فقط.
 *
 * `{slug}.{base_domain}` → `tenants.slug` (مطابقة غير حسّاسة لحالة الأحرف،
 * ويجب أن تُنتج مستأجراً نشطاً واحداً بالضبط). ليس `StorefrontDomain`.
 *
 * التطبيع عبر `HostnameNormalizer` حصراً — لا تحليل hostname موازٍ هنا.
 *
 * مضيف غير قابل للتطبيع أو خارج النطاق الأساسي أو محجوز → وضع غير-مستأجر
 * (null) حتى لا يُكسر الدخول الحالي على localhost / Render / Vercel.
 * شريحة مستأجر تحت النطاق الأساسي بلا مستأجر مطابق → فشل مغلق (404).
 */
final class TenantHostnameResolver
{
    public const FAILURE_MESSAGE = 'تعذّر تحديد مؤسسة صالحة.';

    /**
     * يستخرج slug المستأجر من hostname خام، أو null إن لم يكن الطلب في
     * وضع النطاق الفرعي للمستأجر.
     */
    public function extractSlug(string $rawHost): ?string
    {
        try {
            $hostname = HostnameNormalizer::normalize($rawHost);
        } catch (InvalidHostnameException) {
            return null;
        }

        foreach ($this->baseDomains() as $base) {
            if ($hostname === $base) {
                return null;
            }

            $suffix = '.'.$base;
            if (! str_ends_with($hostname, $suffix)) {
                continue;
            }

            $label = substr($hostname, 0, -strlen($suffix));

            // V1: شريحة واحدة فقط. `foo.bar.awj.app` خارج العقد.
            if ($label === '' || str_contains($label, '.')) {
                return null;
            }

            if (ReservedTenantSlugs::contains($label)) {
                return null;
            }

            return $label;
        }

        return null;
    }

    /**
     * @return array{id: string, slug: string}|null null = وضع غير-مستأجر.
     * فشل مغلق (404 غير كاشف) عند تعارض Host/Origin أو slug غير معروف.
     */
    public function resolveFromRequest(Request $request): ?array
    {
        $hostSlug = $this->extractSlug((string) $request->getHost());
        $originHost = $this->originHost($request);
        $originSlug = $originHost !== null ? $this->extractSlug($originHost) : null;

        if ($hostSlug !== null && $originSlug !== null && $hostSlug !== $originSlug) {
            abort(404, self::FAILURE_MESSAGE);
        }

        $slug = $hostSlug ?? $originSlug;
        if ($slug === null) {
            return null;
        }

        return [
            'id' => $this->tenantIdForSlug($slug),
            'slug' => $slug,
        ];
    }

    public function tenantIdForSlug(string $slug): string
    {
        $normalized = mb_strtolower($slug);

        $matches = Tenant::query()
            ->whereRaw('lower(slug) = ?', [$normalized])
            ->where('is_active', true)
            ->limit(2)
            ->get();

        if ($matches->count() !== 1) {
            abort(404, self::FAILURE_MESSAGE);
        }

        return (string) $matches->first()->id;
    }

    /** @return list<string> أطول نطاقاً أولاً حتى لا يبتلع أبٌ أقصر ابناً. */
    private function baseDomains(): array
    {
        $domains = config('tenancy.base_domains', ['awj.app']);
        if (! is_array($domains) || $domains === []) {
            $domains = ['awj.app'];
        }

        $normalized = [];
        foreach ($domains as $domain) {
            $base = $this->normalizeBaseDomain((string) $domain);
            if ($base !== null) {
                $normalized[] = $base;
            }
        }

        $normalized = array_values(array_unique($normalized));
        usort($normalized, static fn (string $a, string $b): int => strlen($b) <=> strlen($a));

        return $normalized;
    }

    /**
     * تطبيع نطاق أساسي. يسمح بتسمية واحدة (`localhost`) لأن HostnameNormalizer
     * يرفضها عمداً كهوية متجر، بينما هي أبٌّ صالح للتطوير المحلي.
     */
    private function normalizeBaseDomain(string $raw): ?string
    {
        $value = mb_strtolower(trim($raw));
        $value = rtrim($value, '.');
        if ($value === '' || str_contains($value, '/') || str_contains($value, ':') || str_contains($value, '@')) {
            return null;
        }

        foreach (explode('.', $value) as $label) {
            if ($label === '' || ! preg_match('/\A[a-z0-9]([a-z0-9-]*[a-z0-9])?\z/', $label)) {
                return null;
            }
        }

        return $value;
    }

    private function originHost(Request $request): ?string
    {
        $origin = $request->headers->get('Origin');
        if (! is_string($origin) || $origin === '' || strcasecmp($origin, 'null') === 0) {
            return null;
        }

        $parts = parse_url($origin);
        if (! is_array($parts) || empty($parts['host']) || ! is_string($parts['host'])) {
            return null;
        }

        $host = $parts['host'];
        if (! empty($parts['port'])) {
            $host .= ':'.$parts['port'];
        }

        return $host;
    }
}
