import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// 云端/CI 无 GPU：优先使用环境预装的 Chromium（软件渲染），并关闭沙箱。
const prebuiltChromium = '/opt/pw-browsers/chromium';
const executablePath =
  process.env.HYI_CHROMIUM_PATH ?? (existsSync(prebuiltChromium) ? prebuiltChromium : undefined);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  retries: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
  },
  webServer: {
    command: 'pnpm build && pnpm preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
