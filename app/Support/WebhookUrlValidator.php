<?php

namespace App\Support;

/**
 * تحقّق SSRF لعناوين الـ Webhooks — **حرِج للدمج** (PR-7). وجهة الـ Webhook شبكةٌ
 * يتحكّم بها المهاجم، فلا بدّ من دفاع قويّ يُطبَّق **عند إنشاء/تحديث الاشتراك
 * وعند كلّ تسليم** (إعادة التحقّق وقت الإرسال تضيّق نافذة إعادة ربط DNS).
 *
 * القرارات:
 *  - HTTPS إلزاميّ (يُسمح http فقط باستثناء محليّ/اختباري واعٍ عبر `allowInsecure`).
 *  - لا اعتمادات مضمَّنة في العنوان (user:pass@).
 *  - يُحلّ المضيف إلى عناوين IP، ويُرفض إن كان **أيٌّ** منها غير عموميّ (loopback،
 *    private، link-local، ULA، CGNAT، multicast، reserved، unspecified) — IPv4 وIPv6،
 *    مع فكّ العناوين IPv4-mapped/‏compat داخل IPv6. لا مطابقة نصّية للمضيف.
 *  - لا إعادة توجيه (تُفرض في عميل HTTP)، ومنفذ صالح.
 *
 * لا يعتمد على أعلام PHP الجزئية (`FILTER_FLAG_NO_*`) بل على قوائم CIDR صريحة
 * ثنائية — حتميّ وقابل للاختبار على IPv4 وIPv6.
 */
final class WebhookUrlValidator
{
    /** نطاقات IPv4 المحظورة (غير عموميّة). */
    private const BLOCKED_V4 = [
        '0.0.0.0/8',        // this-host / unspecified
        '10.0.0.0/8',       // private
        '100.64.0.0/10',    // CGNAT
        '127.0.0.0/8',      // loopback
        '169.254.0.0/16',   // link-local
        '172.16.0.0/12',    // private
        '192.0.0.0/24',     // IETF protocol assignments
        '192.0.2.0/24',     // TEST-NET-1
        '192.88.99.0/24',   // 6to4 relay anycast
        '192.168.0.0/16',   // private
        '198.18.0.0/15',    // benchmarking
        '198.51.100.0/24',  // TEST-NET-2
        '203.0.113.0/24',   // TEST-NET-3
        '224.0.0.0/4',      // multicast
        '240.0.0.0/4',      // reserved (incl. 255.255.255.255)
    ];

    /** نطاقات IPv6 المحظورة (غير عموميّة). */
    private const BLOCKED_V6 = [
        '::1/128',      // loopback
        '::/128',       // unspecified
        '64:ff9b::/96', // NAT64 (يُفكّ IPv4 المضمَّن أيضًا)
        '100::/64',     // discard-only
        '2001:db8::/32',// documentation
        'fc00::/7',     // unique local (ULA)
        'fe80::/10',    // link-local
        'ff00::/8',     // multicast
    ];

    public function __construct(
        private readonly WebhookHostResolver $resolver,
        private readonly bool $allowInsecure = false,
    ) {
    }

    /**
     * يتحقّق من العنوان أو يرمي `WebhookUrlException` برمز السبب.
     *
     * @throws WebhookUrlException
     */
    public function validate(string $url): void
    {
        $url = trim($url);
        $parts = parse_url($url);

        if ($parts === false || ! isset($parts['scheme'], $parts['host']) || $parts['host'] === '') {
            throw new WebhookUrlException('invalid_url', 'عنوان الـ Webhook غير صالح.');
        }

        $scheme = strtolower($parts['scheme']);
        if ($scheme !== 'https' && ! ($scheme === 'http' && $this->allowInsecure)) {
            throw new WebhookUrlException('scheme_not_allowed', 'يجب أن يكون عنوان الـ Webhook عبر HTTPS.');
        }

        if (isset($parts['user']) || isset($parts['pass'])) {
            throw new WebhookUrlException('embedded_credentials', 'لا يُسمح باعتمادات مضمَّنة في عنوان الـ Webhook.');
        }

        $port = $parts['port'] ?? ($scheme === 'https' ? 443 : 80);
        if ($port < 1 || $port > 65535) {
            throw new WebhookUrlException('invalid_port', 'منفذ عنوان الـ Webhook غير صالح.');
        }

        $host = $parts['host'];
        // مضيف بين قوسين (IPv6 حرفيّ) — أزل الأقواس.
        $host = trim($host, '[]');

        $ips = $this->resolver->resolve($host);
        if ($ips === []) {
            throw new WebhookUrlException('unresolvable_host', 'تعذّر حلّ اسم مضيف عنوان الـ Webhook.');
        }

        foreach ($ips as $ip) {
            if (! $this->isPublicIp($ip)) {
                throw new WebhookUrlException('blocked_ip', 'يشير عنوان الـ Webhook إلى نطاق شبكة غير مسموح به.');
            }
        }
    }

    /** هل العنوان صالح وعموميّ (ليس في أي نطاق محظور)؟ */
    public function isPublicIp(string $ip): bool
    {
        $binary = @inet_pton($ip);
        if ($binary === false) {
            return false; // ليس عنوان IP صالحًا.
        }

        // IPv6: افكّ IPv4-mapped/‏compat (::ffff:a.b.c.d) وأعد الفحص كـ IPv4.
        if (strlen($binary) === 16) {
            $embedded = $this->embeddedIpv4($binary);
            if ($embedded !== null) {
                return $this->isPublicIp($embedded);
            }

            foreach (self::BLOCKED_V6 as $cidr) {
                if ($this->inCidr($binary, $cidr)) {
                    return false;
                }
            }

            return true;
        }

        // IPv4 (4 بايت)
        foreach (self::BLOCKED_V4 as $cidr) {
            if ($this->inCidr($binary, $cidr)) {
                return false;
            }
        }

        return true;
    }

    /** يستخرج IPv4 المضمَّن في IPv6 (mapped ::ffff:0:0/96 أو compat) أو null. */
    private function embeddedIpv4(string $binary): ?string
    {
        // IPv4-mapped: أول 10 بايت أصفار، ثم 0xffff، ثم 4 بايت IPv4.
        $mappedPrefix = str_repeat("\x00", 10) . "\xff\xff";
        if (str_starts_with($binary, $mappedPrefix)) {
            return inet_ntop(substr($binary, 12, 4));
        }

        return null;
    }

    /** هل العنوان الثنائي ضمن CIDR المعطى (نفس العائلة)؟ مطابقة بادئة بتّيّة. */
    private function inCidr(string $binary, string $cidr): bool
    {
        [$subnet, $bits] = explode('/', $cidr);
        $subnetBinary = @inet_pton($subnet);
        if ($subnetBinary === false || strlen($subnetBinary) !== strlen($binary)) {
            return false;
        }

        $bits = (int) $bits;
        $fullBytes = intdiv($bits, 8);
        $remainderBits = $bits % 8;

        if ($fullBytes > 0 && strncmp($binary, $subnetBinary, $fullBytes) !== 0) {
            return false;
        }

        if ($remainderBits === 0) {
            return true;
        }

        $mask = 0xff << (8 - $remainderBits) & 0xff;

        return (ord($binary[$fullBytes]) & $mask) === (ord($subnetBinary[$fullBytes]) & $mask);
    }
}
