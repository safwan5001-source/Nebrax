<?php

namespace App\Services\Commerce\Edge;

use App\Services\Commerce\StorefrontEdgeConflictException;
use App\Services\Commerce\StorefrontEdgeMisconfiguredException;
use App\Services\Commerce\StorefrontEdgeUnavailableException;

/** عميل حتمي للاختبارات — بلا شبكة. */
final class FakeStorefrontEdgeClient implements StorefrontEdgeClient
{
    public int $provisionCalls = 0;

    public int $fetchCalls = 0;

    public int $findCalls = 0;

    public int $releaseCalls = 0;

    /** @var array<string, EdgeBinding> */
    public array $byId = [];

    /** @var array<string, string> */
    public array $hostnameToId = [];

    public ?string $provisionFailure = null;

    public ?string $fetchFailure = null;

    public bool $throwUnavailableAfterRecordingProvision = false;

    public bool $unknownIdsAreMissing = false;

    public bool $misconfigured = false;

    /** أول N استدعاءات لـ findByHostname تُرجع null حتى مع وجود الصف. */
    public int $findMisses = 0;

    public string $nextSnapshotStatus = EdgeSnapshot::STATUS_DNS_REQUIRED;

    public function provision(string $hostname): EdgeBinding
    {
        $this->assertConfigured();
        $this->provisionCalls++;
        if ($this->provisionFailure === 'conflict') {
            throw new StorefrontEdgeConflictException('هذا النطاق مسجَّل بالفعل لدى مزوّد الحافة.');
        }
        if ($this->provisionFailure === 'unavailable') {
            throw new StorefrontEdgeUnavailableException('تعذّر الاتصال بمزوّد تفعيل النطاق. حاول مرة أخرى لاحقاً.');
        }

        $binding = $this->remember($hostname, $this->snapshot($hostname, $this->nextSnapshotStatus));
        if ($this->throwUnavailableAfterRecordingProvision) {
            throw new StorefrontEdgeUnavailableException('تعذّر الاتصال بمزوّد تفعيل النطاق. حاول مرة أخرى لاحقاً.');
        }

        return $binding;
    }

    public function fetch(string $providerId): EdgeSnapshot
    {
        $this->assertConfigured();
        $this->fetchCalls++;
        if ($this->fetchFailure === 'unavailable') {
            throw new StorefrontEdgeUnavailableException('تعذّر الاتصال بمزوّد تفعيل النطاق. حاول مرة أخرى لاحقاً.');
        }
        if (isset($this->byId[$providerId])) {
            return $this->byId[$providerId]->snapshot;
        }
        if ($this->unknownIdsAreMissing) {
            return new EdgeSnapshot(EdgeSnapshot::STATUS_FAILED, [], 'لم يعد نطاق الحافة موجوداً لدى المزوّد.', true);
        }

        return $this->snapshot('unknown.example.com', $this->nextSnapshotStatus);
    }

    public function findByHostname(string $hostname): ?EdgeBinding
    {
        $this->assertConfigured();
        $this->findCalls++;
        if ($this->findMisses > 0) {
            $this->findMisses--;

            return null;
        }
        $id = $this->hostnameToId[$hostname] ?? null;

        return $id !== null ? ($this->byId[$id] ?? null) : null;
    }

    public function release(string $providerId): void
    {
        $this->assertConfigured();
        $this->releaseCalls++;
        $binding = $this->byId[$providerId] ?? null;
        unset($this->byId[$providerId]);
        if ($binding !== null) {
            unset($this->hostnameToId[$binding->hostname]);
        }
    }

    public function seedHostname(string $hostname, string $status = EdgeSnapshot::STATUS_DNS_REQUIRED, ?string $id = null): EdgeBinding
    {
        $this->nextSnapshotStatus = $status;

        return $this->remember($hostname, $this->snapshot($hostname, $status), $id);
    }

    public function setSnapshotForId(string $providerId, string $status): void
    {
        $existing = $this->byId[$providerId] ?? null;
        if ($existing === null) {
            return;
        }
        $this->byId[$providerId] = new EdgeBinding(
            $providerId,
            $existing->hostname,
            $this->snapshot($existing->hostname, $status),
        );
    }

    private function remember(string $hostname, EdgeSnapshot $snapshot, ?string $id = null): EdgeBinding
    {
        $id ??= 'fake-'.substr(hash('sha256', $hostname), 0, 32);
        $binding = new EdgeBinding($id, $hostname, $snapshot);
        $this->byId[$id] = $binding;
        $this->hostnameToId[$hostname] = $id;

        return $binding;
    }

    private function snapshot(string $hostname, string $status): EdgeSnapshot
    {
        $records = [
            new EdgeDnsRecord('CNAME', $hostname, 'g05ns7.up.railway.app'),
            new EdgeDnsRecord('TXT', '_railway-verify.'.$hostname, 'railway-verify=test-token'),
        ];
        $error = $status === EdgeSnapshot::STATUS_FAILED ? 'تعذّر إصدار شهادة HTTPS لهذا النطاق.' : null;

        return new EdgeSnapshot($status, $records, $error);
    }

    private function assertConfigured(): void
    {
        if ($this->misconfigured) {
            throw new StorefrontEdgeMisconfiguredException('مزوّد تفعيل النطاق غير مضبوط على الخادم.');
        }
    }
}
