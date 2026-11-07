import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { alias: { '@': '/home/user/Nebrax/web/src' } },
  esbuild: { jsx: 'automatic' },
  server: { fs: { strict: false } },
  test: { include: ['/tmp/claude-0/-home-user-Nebrax/639ea9ef-af28-5301-9cf1-48331ebdabdb/scratchpad/vt/*.test.tsx'], root: '/home/user/Nebrax/web', environment: 'node' },
});
