// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({ useLocale: () => 'en' }));
vi.mock('@/lib/auth', () => ({ currentUser: () => ({ role: 'viewer', permissions: [] }) }));
vi.mock('@/lib/api', () => ({ api: () => Promise.resolve({ data: {} }) }));
vi.mock('../store-context', () => ({ useOptionalCommerceStoreContext: () => null }));
vi.mock('./sections', () => ({ visibleSettingsSections: () => [] }));

import { SettingsHub } from './settings-hub';

describe('SettingsHub empty state (COPS-H4-1)', () => {
  afterEach(cleanup);

  it('explains that nothing is available and renders no links', async () => {
    render(<SettingsHub />);
    await waitFor(() => expect(screen.getByText('No settings sections are available for your permissions.')).toBeTruthy());
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});
