import { createServer } from 'node:http';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

export const FP_A = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';
export const FP_B = '99:88:77:66:55:44:33:22:11:00:FF:EE:DD:CC:BB:AA:99:88:77:66:55:44:33:22:11:00:FF:EE:DD:CC:BB:AA';
export const TEAM = 'ABCDE12345';

export const FULL_ENV = {
  ANDROID_APP_LINK_SHA256_FINGERPRINTS: FP_A,
  APPLE_TEAM_ID: TEAM,
  PORT: '0',
};

// Starts the app on an ephemeral port; returns helpers and the captured log.
export async function start(env = FULL_ENV) {
  const lines = [];
  const server = createServer(createApp({ config: loadConfig(env), log: (l) => lines.push(l) }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    lines,
    get: (path, init = {}) => fetch(base + path, { redirect: 'manual', ...init }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
