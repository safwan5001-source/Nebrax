import { describe, expect, it } from 'vitest';
import { payloadFor } from './page';

const form = {
  enabled: true,
  provider: 'r2',
  endpoint: 'https://account.r2.cloudflarestorage.com',
  bucket: 'private-documents',
  region: 'auto',
  access_key_id: '',
  secret_access_key: '',
  use_path_style_endpoint: true,
  host: '',
  port: '3310',
  timeout_seconds: '75',
  max_attempts: '4',
  backoff_seconds: '15, 60, 180',
  model: '',
  api_key: '',
  current_password: 'platform-password-123',
};

describe('platform integration payloads', () => {
  it('omits blank storage secrets so the backend preserves the encrypted values', () => {
    const payload = payloadFor('document_storage', form);

    expect(payload).not.toHaveProperty('access_key_id');
    expect(payload).not.toHaveProperty('secret_access_key');
    expect(payload.bucket).toBe('private-documents');
  });

  it('normalizes numeric processing policy values', () => {
    const payload = payloadFor('document_processing', form);

    expect(payload).toMatchObject({
      provider: 'redis',
      max_attempts: 4,
      timeout_seconds: 75,
      backoff_seconds: [15, 60, 180],
    });
  });
});
