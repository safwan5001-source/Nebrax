<?php

namespace App\Support;

/**
 * المُحلِّل الإنتاجي: DNS النظام لـ IPv4 (A) وIPv6 (AAAA). عنوان IP الحرفيّ يُعاد
 * كما هو دون استعلام. يُحقن في الإنتاج، ويُستبدَل بمُحلِّل حتميّ في الاختبارات.
 */
final class SystemWebhookHostResolver implements WebhookHostResolver
{
    public function resolve(string $host): array
    {
        // عنوان IP حرفيّ: لا استعلام — يتحقّق منه المتحقّق مباشرةً.
        if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
            return [$host];
        }

        $ips = [];

        // IPv4 (A)
        $a = @gethostbynamel($host);
        if (is_array($a)) {
            $ips = array_merge($ips, $a);
        }

        // IPv6 (AAAA)
        $aaaa = @dns_get_record($host, DNS_AAAA);
        if (is_array($aaaa)) {
            foreach ($aaaa as $record) {
                if (isset($record['ipv6'])) {
                    $ips[] = $record['ipv6'];
                }
            }
        }

        return array_values(array_unique($ips));
    }
}
