import { expect, test } from '@playwright/test';

/**
 * 渲染截图冒烟测试（无 GPU 软件渲染，只做粗检，真机观感由人类确认 — CLAUDE.md）。
 * 验收：占位 glb 加载成功、WebGL 画面非空、留存截图供 PR 审阅。
 */
test('viewer renders the placeholder model', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });

  // 等两帧确保画面已绘制
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );

  // 读回 WebGL 画布像素（renderer 开启 preserveDrawingBuffer），统计非背景像素占比
  const foregroundRatio = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return -1;
    const probe = document.createElement('canvas');
    const w = (probe.width = 160);
    const h = (probe.height = 120);
    const ctx = probe.getContext('2d');
    if (!ctx) return -1;
    ctx.drawImage(canvas, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    let foreground = 0;
    for (let i = 0; i < data.length; i += 4) {
      // 背景清屏色 #0b1020，偏离即视为前景
      const dr = Math.abs(data[i]! - 0x0b);
      const dg = Math.abs(data[i + 1]! - 0x10);
      const db = Math.abs(data[i + 2]! - 0x20);
      if (dr + dg + db > 30) foreground += 1;
    }
    return foreground / (w * h);
  });
  expect(foregroundRatio).toBeGreaterThan(0.02);

  await page.screenshot({ path: 'test-results/smoke.png' });
});
