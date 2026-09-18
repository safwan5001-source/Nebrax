<?php

namespace App\Services\Commerce\Edge;

use App\Services\Commerce\StorefrontEdgeConflictException;
use App\Services\Commerce\StorefrontEdgeMisconfiguredException;
use App\Services\Commerce\StorefrontEdgeUnavailableException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * CUSTOM-DOMAIN-EDGE-1 — عميل GraphQL لـ Railway وفق المخطط الحي
 * (introspection على https://backboard.railway.com/graphql/v2).
 *
 * المصادقة: Authorization Bearer (workspace/account token).
 * لا سجلات للترويسة ولا لجسم يحمل أسراراً.
 */
final class RailwayStorefrontEdgeClient implements StorefrontEdgeClient
{
    private bool $lastGraphqlSignalledGone = false;

    private const STATUS_SELECTION = <<<'GQL'
status {
  dnsRecords {
    hostlabel
    fqdn
    recordType
    requiredValue
    currentValue
    status
    zone
    purpose
  }
  certificates {
    issuedAt
    expiresAt
    domainNames
    fingerprintSha256
    keyType
  }
  certificateStatus
  certificateStatusDetailed
  certificateErrorMessage
  certificateErrorType
  certificateRetryable
  verificationToken
  verificationDnsHost
  verified
}
GQL;

    public function __construct(private readonly RailwayEdgeStatusMapper $mapper) {}

    public function provision(string $hostname): EdgeBinding
    {
        $cfg = $this->requiredConfig();
        $input = [
            'domain' => $hostname,
            'projectId' => $cfg['project_id'],
            'environmentId' => $cfg['environment_id'],
            'serviceId' => $cfg['service_id'],
        ];
        if ($cfg['target_port'] !== null) {
            $input['targetPort'] = $cfg['target_port'];
        }

        $data = $this->graphql(
            'mutation CustomDomainCreate($input: CustomDomainCreateInput!) { customDomainCreate(input: $input) { id domain '.self::STATUS_SELECTION.' } }',
            ['input' => $input],
        );
        $node = $data['customDomainCreate'] ?? null;
        if (! is_array($node) || ! is_string($node['id'] ?? null) || $node['id'] === '') {
            throw new StorefrontEdgeUnavailableException('تعذّر تسجيل النطاق لدى مزوّد الحافة.');
        }

        return $this->bindingFromNode($node, $hostname);
    }

    public function fetch(string $providerId): EdgeSnapshot
    {
        $cfg = $this->requiredConfig();
        $data = $this->graphql(
            'query CustomDomain($id: String!, $projectId: String!) { customDomain(id: $id, projectId: $projectId) { id domain deletedAt '.self::STATUS_SELECTION.' } }',
            ['id' => $providerId, 'projectId' => $cfg['project_id']],
        );

        $node = $data['customDomain'] ?? null;
        if (! is_array($node) || ($node['deletedAt'] ?? null) !== null) {
            return new EdgeSnapshot(EdgeSnapshot::STATUS_FAILED, [], 'لم يعد نطاق الحافة موجوداً لدى المزوّد.', true);
        }

        return $this->mapper->snapshotFromStatus(is_array($node['status'] ?? null) ? $node['status'] : []);
    }

    public function findByHostname(string $hostname): ?EdgeBinding
    {
        $cfg = $this->requiredConfig();
        $data = $this->graphql(
            'query ServiceDomains($projectId: String!, $environmentId: String!, $serviceId: String!) { domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) { customDomains { id domain deletedAt '.self::STATUS_SELECTION.' } } }',
            [
                'projectId' => $cfg['project_id'],
                'environmentId' => $cfg['environment_id'],
                'serviceId' => $cfg['service_id'],
            ],
        );
        $list = $data['domains']['customDomains'] ?? [];
        if (! is_array($list)) {
            return null;
        }
        foreach ($list as $node) {
            if (! is_array($node)) {
                continue;
            }
            if (($node['deletedAt'] ?? null) !== null) {
                continue;
            }
            if (strcasecmp((string) ($node['domain'] ?? ''), $hostname) !== 0) {
                continue;
            }

            return $this->bindingFromNode($node, $hostname);
        }

        return null;
    }

    public function release(string $providerId): void
    {
        $this->requiredConfig();
        try {
            $this->graphql(
                'mutation CustomDomainDelete($id: String!) { customDomainDelete(id: $id) }',
                ['id' => $providerId],
            );
        } catch (StorefrontEdgeUnavailableException $e) {
            if ($this->lastGraphqlSignalledGone) {
                $this->lastGraphqlSignalledGone = false;

                return;
            }
            throw $e;
        }
        $this->lastGraphqlSignalledGone = false;
    }

    /**
     * @param  array<string, mixed>  $node
     */
    private function bindingFromNode(array $node, string $hostname): EdgeBinding
    {
        $status = is_array($node['status'] ?? null) ? $node['status'] : [];

        return new EdgeBinding(
            (string) $node['id'],
            (string) ($node['domain'] ?? $hostname),
            $this->mapper->snapshotFromStatus($status),
        );
    }

    /**
     * @return array{token: string, project_id: string, environment_id: string, service_id: string, target_port: ?int, endpoint: string}
     */
    private function requiredConfig(): array
    {
        $token = trim((string) config('storefront.edge.token', ''));
        $projectId = trim((string) config('storefront.edge.project_id', ''));
        $environmentId = trim((string) config('storefront.edge.environment_id', ''));
        $serviceId = trim((string) config('storefront.edge.service_id', ''));
        $endpoint = trim((string) config('storefront.edge.endpoint', 'https://backboard.railway.com/graphql/v2'));
        $port = config('storefront.edge.target_port');
        $targetPort = is_numeric($port) ? (int) $port : null;

        if ($token === '' || $projectId === '' || $environmentId === '' || $serviceId === '' || $endpoint === '') {
            throw new StorefrontEdgeMisconfiguredException('مزوّد تفعيل النطاق غير مضبوط على الخادم.');
        }

        return [
            'token' => $token,
            'project_id' => $projectId,
            'environment_id' => $environmentId,
            'service_id' => $serviceId,
            'target_port' => $targetPort,
            'endpoint' => $endpoint,
        ];
    }

    /**
     * @param  array<string, mixed>  $variables
     * @return array<string, mixed>
     */
    private function graphql(string $query, array $variables): array
    {
        $cfg = $this->requiredConfig();
        $this->lastGraphqlSignalledGone = false;

        try {
            $response = Http::timeout(20)
                ->withHeaders([
                    'Authorization' => 'Bearer '.$cfg['token'],
                    'Content-Type' => 'application/json',
                ])
                ->post($cfg['endpoint'], [
                    'query' => $query,
                    'variables' => $variables,
                ]);
        } catch (ConnectionException $e) {
            Log::warning('storefront.edge.transport', ['reason' => 'connection']);
            throw new StorefrontEdgeUnavailableException('تعذّر الاتصال بمزوّد تفعيل النطاق. حاول مرة أخرى لاحقاً.');
        }

        if ($response->status() === 429) {
            throw new StorefrontEdgeUnavailableException('مزوّد تفعيل النطاق مشغول حالياً. حاول مرة أخرى لاحقاً.');
        }
        if ($response->serverError() || $response->status() >= 500) {
            throw new StorefrontEdgeUnavailableException('تعذّر الاتصال بمزوّد تفعيل النطاق. حاول مرة أخرى لاحقاً.');
        }
        if (! $response->successful()) {
            throw new StorefrontEdgeUnavailableException('تعذّر الاتصال بمزوّد تفعيل النطاق. حاول مرة أخرى لاحقاً.');
        }

        $payload = $response->json();
        if (! is_array($payload)) {
            throw new StorefrontEdgeUnavailableException('تعذّر قراءة استجابة مزوّد تفعيل النطاق.');
        }

        if (isset($payload['errors']) && is_array($payload['errors']) && $payload['errors'] !== []) {
            $this->throwFromGraphqlErrors($payload['errors']);
        }

        $data = $payload['data'] ?? null;
        if (! is_array($data)) {
            throw new StorefrontEdgeUnavailableException('تعذّر قراءة استجابة مزوّد تفعيل النطاق.');
        }

        return $data;
    }

    /**
     * @param  list<mixed>  $errors
     */
    private function throwFromGraphqlErrors(array $errors): void
    {
        $messages = [];
        foreach ($errors as $error) {
            if (! is_array($error)) {
                continue;
            }
            $messages[] = strtolower((string) ($error['message'] ?? ''));
        }
        $joined = implode(' ', $messages);
        if ($this->isGoneGraphqlMessage($joined)) {
            $this->lastGraphqlSignalledGone = true;
            throw new StorefrontEdgeUnavailableException('تعذّر إكمال العملية لدى مزوّد تفعيل النطاق.');
        }
        $this->lastGraphqlSignalledGone = false;
        if (str_contains($joined, 'not authorized') || str_contains($joined, 'unauthorized')) {
            throw new StorefrontEdgeUnavailableException('تعذّر الاتصال بمزوّد تفعيل النطاق. حاول مرة أخرى لاحقاً.');
        }
        if (str_contains($joined, 'already') || str_contains($joined, 'taken') || str_contains($joined, 'exists') || str_contains($joined, 'in use')) {
            throw new StorefrontEdgeConflictException('هذا النطاق مسجَّل بالفعل لدى مزوّد الحافة.');
        }

        Log::warning('storefront.edge.graphql', ['count' => count($errors)]);
        throw new StorefrontEdgeUnavailableException('تعذّر إكمال العملية لدى مزوّد تفعيل النطاق.');
    }

    private function isGoneGraphqlMessage(string $joined): bool
    {
        return str_contains($joined, 'not found')
            || str_contains($joined, 'does not exist')
            || str_contains($joined, 'already deleted')
            || str_contains($joined, 'already gone')
            || str_contains($joined, 'no custom domain')
            || str_contains($joined, 'could not find');
    }
}
