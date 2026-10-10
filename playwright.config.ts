import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, FAKE_AYRSHARE_URL, serverEnv } from './e2e/env';

export default defineConfig({
  testDir: './e2e',
  testMatch: /specs\/.*\.spec\.ts/,
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: { baseURL: BASE_URL, trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'],
      // Fake mic/camera for voice.spec. On macOS, headless getUserMedia never resolves while the audio
      // service runs out of process, so keep it in-process (harmless elsewhere).
      launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
        '--disable-features=AudioServiceOutOfProcess'] } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /specs\/page-sweep\.spec\.ts/ },
  ],
  webServer: [{
    // Fake Ayrshare (AYRSHARE_BASE_URL in serverEnv()); started before the app.
    command: 'npx tsx e2e/fake-ayrshare/server.ts',
    url: `${FAKE_AYRSHARE_URL}/__requests`,
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
  }, {
    // serverEnv() applies to the whole shell command, so `next build` inlines the
    // e2e project's NEXT_PUBLIC_* values (not the ones in the owner's .env).
    command: 'npx next build && npx next start -p 3100',
    url: `${BASE_URL}/login`,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    env: serverEnv(),
    stdout: 'pipe',
  }],
});
