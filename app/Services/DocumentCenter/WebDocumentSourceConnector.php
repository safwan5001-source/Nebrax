<?php

namespace App\Services\DocumentCenter;

use App\Contracts\DocumentSourceConnector;
use App\Support\DocumentSourceChannel;

/** تنفيذ داخلي لقناة الويب؛ ليس متحكماً ولا يقبل أي طلب HTTP خارجي. */
final class WebDocumentSourceConnector implements DocumentSourceConnector
{
    public function __construct(
        private readonly DocumentChannelIdentityResolver $identities,
        private readonly DocumentSourceReceptionService $reception,
    ) {}

    public function channel(): DocumentSourceChannel
    {
        return DocumentSourceChannel::WEB;
    }

    public function receive(DocumentSourceEnvelope $envelope): DocumentSourceReceipt
    {
        if ($envelope->channel !== $this->channel()) {
            throw new DocumentSourceException(DocumentSourceException::NOT_SUPPORTED);
        }

        $resolved = $this->identities->resolveFingerprint(
            $envelope->channel,
            $envelope->identity->external_identity_fingerprint,
            $envelope->actor,
        );
        if ($resolved->id !== $envelope->identity->id) {
            throw new DocumentSourceException(DocumentSourceException::IDENTITY_NOT_FOUND);
        }

        return $this->reception->receive($envelope);
    }
}
