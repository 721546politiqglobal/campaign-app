import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'node', setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'e2e/**/*.test.ts'],
    exclude: ['node_modules/**', 'e2e/specs/**', 'e2e/live/**'],
  },
  resolve: { alias: { '@': resolve(__dirname, './src') } },
});
