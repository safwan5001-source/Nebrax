<?php

namespace App\Services\DocumentCenter;

use App\Contracts\DocumentSafetyScanner;
use App\Services\PlatformIntegrationResolver;
use App\Support\DocumentScanStatus;
use RuntimeException;

/** عميل بروتوكول clamd INSTREAM عبر اتصال TCP خاص. */
class ClamAvTcpDocumentSafetyScanner implements DocumentSafetyScanner
{
    public function __construct(private readonly PlatformIntegrationResolver $settings)
    {
    }

    public function providerName(): string
    {
        return 'clamav-tcp';
    }

    public function ping(): bool
    {
        $socket = $this->connect();
        try {
            $this->writeAll($socket, "zPING\0");
            $response = $this->readResponse($socket);

            return str_contains($response, 'PONG');
        } finally {
            fclose($socket);
        }
    }

    public function scan($stream): DocumentScanStatus
    {
        if (! is_resource($stream)) {
            throw new RuntimeException('Scanner requires a readable document stream.');
        }

        $socket = $this->connect();
        try {
            $this->writeAll($socket, "zINSTREAM\0");
            while (! feof($stream)) {
                $chunk = fread($stream, 8192);
                if ($chunk === false) {
                    throw new RuntimeException('Document stream read failed during safety scan.');
                }
                if ($chunk !== '') {
                    $this->writeAll($socket, pack('N', strlen($chunk)) . $chunk);
                }
            }
            $this->writeAll($socket, pack('N', 0));
            $response = $this->readResponse($socket);
        } finally {
            fclose($socket);
        }

        if (str_contains($response, ' FOUND')) {
            return DocumentScanStatus::INFECTED;
        }
        if (str_contains($response, ' OK')) {
            return DocumentScanStatus::CLEAN;
        }

        throw new RuntimeException('Safety scanner returned an unsupported response.');
    }

    /** @return resource */
    private function connect()
    {
        $configuration = $this->settings->activeConfiguration('malware_scanner');
        $host = trim((string) ($configuration['host'] ?? ''));
        $port = (int) ($configuration['port'] ?? 3310);
        $timeout = max(1, min(30, (int) ($configuration['timeout_seconds'] ?? 10)));

        if ($this->settings->activeProvider('malware_scanner') !== 'clamav_tcp' || $host === '') {
            throw new RuntimeException('Malware scanner is not configured.');
        }

        $socket = @stream_socket_client(
            "tcp://{$host}:{$port}",
            $errorNumber,
            $errorMessage,
            $timeout,
            STREAM_CLIENT_CONNECT,
        );
        if (! is_resource($socket)) {
            throw new RuntimeException('Malware scanner is unavailable.');
        }
        stream_set_timeout($socket, $timeout);

        return $socket;
    }

    /** @param resource $socket */
    private function writeAll($socket, string $payload): void
    {
        $offset = 0;
        while ($offset < strlen($payload)) {
            $written = fwrite($socket, substr($payload, $offset));
            if ($written === false || $written === 0) {
                throw new RuntimeException('Malware scanner connection closed unexpectedly.');
            }
            $offset += $written;
        }
    }

    /** @param resource $socket */
    private function readResponse($socket): string
    {
        $response = stream_get_contents($socket, 4096);
        if ($response === false || $response === '') {
            throw new RuntimeException('Malware scanner did not return a decision.');
        }

        return $response;
    }
}
