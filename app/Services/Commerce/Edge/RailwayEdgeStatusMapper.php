<?php

namespace App\Services\Commerce\Edge;

/**
 * CUSTOM-DOMAIN-EDGE-1 — ترجمة عقد Railway الحي (introspection 2026-09-18)
 * إلى حالات AWJ الدلالية فقط. لا تسرّب أسماء الـ enum خارج هذا الصنف.
 *
 * CertificateStatus (حي):
 *   CERTIFICATE_STATUS_TYPE_VALID → ready
 *   CERTIFICATE_STATUS_TYPE_ISSUE_FAILED → failed
 *   غير ذلك مع DNS routing PROPAGATED → tls_pending
 *   وإلا → dns_required
 */
final class RailwayEdgeStatusMapper
{
    public const CERT_VALID = 'CERTIFICATE_STATUS_TYPE_VALID';

    public const CERT_FAILED = 'CERTIFICATE_STATUS_TYPE_ISSUE_FAILED';

    public const DNS_PROPAGATED = 'DNS_RECORD_STATUS_PROPAGATED';

    public const RECORD_CNAME = 'DNS_RECORD_TYPE_CNAME';

    public const RECORD_TXT = 'DNS_RECORD_TYPE_TXT';

    public const PURPOSE_ROUTE = 'DNS_RECORD_PURPOSE_TRAFFIC_ROUTE';

    public const PURPOSE_ACME = 'DNS_RECORD_PURPOSE_ACME_DNS01_CHALLENGE';

    /**
     * @param  array<string, mixed>  $status  CustomDomainStatus GraphQL object
     */
    public function snapshotFromStatus(array $status): EdgeSnapshot
    {
        $records = $this->dnsRecordsFromStatus($status);
        $certificate = (string) ($status['certificateStatus'] ?? '');
        $dnsReady = $this->routingDnsPropagated($status);

        if ($certificate === self::CERT_VALID) {
            $semantic = EdgeSnapshot::STATUS_READY;
        } elseif ($certificate === self::CERT_FAILED) {
            $semantic = EdgeSnapshot::STATUS_FAILED;
        } elseif ($dnsReady) {
            $semantic = EdgeSnapshot::STATUS_TLS_PENDING;
        } else {
            $semantic = EdgeSnapshot::STATUS_DNS_REQUIRED;
        }

        $error = $semantic === EdgeSnapshot::STATUS_FAILED
            ? $this->safeError($status)
            : null;

        return new EdgeSnapshot($semantic, $records, $error);
    }

    /**
     * @param  array<string, mixed>  $status
     * @return list<EdgeDnsRecord>
     */
    public function dnsRecordsFromStatus(array $status): array
    {
        $out = [];
        $seen = [];

        foreach ($status['dnsRecords'] ?? [] as $row) {
            if (! is_array($row)) {
                continue;
            }
            if ((string) ($row['purpose'] ?? '') === self::PURPOSE_ACME) {
                continue;
            }
            $recordType = (string) ($row['recordType'] ?? '');
            $type = match ($recordType) {
                self::RECORD_CNAME => 'CNAME',
                self::RECORD_TXT => 'TXT',
                default => null,
            };
            if ($type === null) {
                continue;
            }
            $name = (string) ($row['fqdn'] ?? $row['hostlabel'] ?? '');
            $value = (string) ($row['requiredValue'] ?? '');
            if ($name === '' || $value === '') {
                continue;
            }
            $key = $type.'|'.$name.'|'.$value;
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $out[] = new EdgeDnsRecord($type, $name, $value);
        }

        $txtHost = trim((string) ($status['verificationDnsHost'] ?? ''));
        $txtValue = trim((string) ($status['verificationToken'] ?? ''));
        if ($txtHost !== '' && $txtValue !== '') {
            $key = 'TXT|'.$txtHost.'|'.$txtValue;
            if (! isset($seen[$key])) {
                $out[] = new EdgeDnsRecord('TXT', $txtHost, $txtValue);
            }
        }

        return $out;
    }

    /**
     * @param  array<string, mixed>  $status
     */
    public function routingDnsPropagated(array $status): bool
    {
        foreach ($status['dnsRecords'] ?? [] as $row) {
            if (! is_array($row)) {
                continue;
            }
            $purpose = (string) ($row['purpose'] ?? '');
            $type = (string) ($row['recordType'] ?? '');
            $isRoute = $purpose === self::PURPOSE_ROUTE
                || ($purpose === '' && $type === self::RECORD_CNAME);
            if (! $isRoute) {
                continue;
            }
            if ((string) ($row['status'] ?? '') === self::DNS_PROPAGATED) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  array<string, mixed>  $status
     */
    private function safeError(array $status): ?string
    {
        $raw = $status['certificateErrorMessage'] ?? null;
        if (! is_string($raw) || trim($raw) === '') {
            return 'تعذّر إصدار شهادة HTTPS لهذا النطاق.';
        }
        $clean = trim($raw);
        if (preg_match('/authorization|bearer|token|railway_api/i', $clean) === 1) {
            return 'تعذّر إصدار شهادة HTTPS لهذا النطاق.';
        }

        return mb_substr($clean, 0, 500);
    }
}
