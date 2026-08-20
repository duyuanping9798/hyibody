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
  /*
   * 云端只有 4 个核，而画面全靠软件渲染（CPU 光栅化，本身就是多线程的）。
   * Playwright 默认开 CPU 数一半的 worker，两个浏览器一起跑把负载顶到 8 以上，
   * 每个用例的帧率直接减半——实测两条最长的用例就是这么超时的（不是断言失败，
   * 是 600 s / 120 s 的钟走完了）。串行反而更快，也更接近真机的单窗口情形。
   */
  ...(process.env.CI ? { workers: 1 } : {}),
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
