// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import DeliveryPlatformDetailPage from './page';
import { DeliveryPlatformDetailScreen } from '@/components/integrations/delivery-platform-detail-screen';
import { deliveryPlatformKeys } from '@/lib/integration-center';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));

const render = (platformKey: unknown) => DeliveryPlatformDetailPage({ params: Promise.resolve({ platformKey: platformKey as string }) });

describe('DeliveryPlatformDetailPage (server boundary)', () => {
  it.each(deliveryPlatformKeys())('a known key (%s) renders the client screen with that key', async (key) => {
    const element = await render(key);

    expect(element.type).toBe(DeliveryPlatformDetailScreen);
    expect(element.props).toEqual({ platformKey: key });
  });

  it.each(['talabat', 'KEETA', '', '../keeta', 'keeta/../jahez', 'jahez?x=1', 'keeta ', '__proto__'])(
    'an unknown key (%j) calls notFound() before rendering anything',
    async (key) => {
      await expect(render(key)).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    },
  );

  it('a non-string route param is unknown, not a crash', async () => {
    await expect(render(['keeta', 'jahez'])).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    await expect(render(undefined)).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  });

  it('never reads data: no API request is made on either path', async () => {
    await render('keeta');
    await render('talabat').catch(() => undefined);

    expect(api).not.toHaveBeenCalled();
  });
});
