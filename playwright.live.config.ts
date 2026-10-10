import { defineConfig } from '@playwright/test';

// Live vendor smoke (npm run e2e:live). No app server, no DB: the tests only
// make read-only calls to real vendor APIs using the keys in `.env`.
export default defineConfig({
  testDir: './e2e/live',
  timeout: 30_000,
  reporter: 'list',
});
