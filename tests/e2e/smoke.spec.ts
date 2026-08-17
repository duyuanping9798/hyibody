import { expect, test } from '@playwright/test';
import { encodeUrlState } from '../../src/data/urlState';

/**
 * 渲染截图冒烟测试（无 GPU 软件渲染，只做粗检，真机观感由人类确认 — CLAUDE.md）。
 * 验收：manifest 声明的 glb（M1 起为流水线产物）加载成功、WebGL 画面非空、
 * 留存截图供 PR 审阅。
 */
test('viewer renders the manifest assets', async ({ page }) => {
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

/**
 * M1-6 交互冒烟：用 ?v= 分享链接恢复"分层滑到骨骼层 + 选中颅骨"的状态，
 * 信息卡应显示中文名，并留存截图。
 */
test('layer state and selection restore from share URL', async ({ page }) => {
  const state = encodeUrlState({ layer: 0.62, selected: 'skull' });
  await page.goto(`/?v=${state}`);
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });

  const infoCard = page.getByTestId('info-card');
  await expect(infoCard).toBeVisible({ timeout: 20_000 });
  await expect(infoCard).toContainText('颅骨');
  await expect(infoCard).toContainText('Skull');

  // 分层滑块位于骨骼段：皮肤应已淡出（截图供人工比对）
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await page.screenshot({ path: 'test-results/smoke-layered.png' });
});

/** M1-7 移动端冒烟：竖屏视口下抽屉面板可唤出、信息卡可见、留存截图。 */
test.describe('mobile viewport', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('drawer panels and info card usable on small screen', async ({ page }) => {
    const state = encodeUrlState({ layer: 0.62, selected: 'skull' });
    await page.goto(`/?v=${state}`);
    await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
      timeout: 60_000,
    });

    await expect(page.getByTestId('info-card')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('info-card')).toContainText('颅骨');

    // 抽屉：默认收起 → 点标签展开系统面板
    const systemsTab = page.getByRole('button', { name: '系统', exact: true });
    await expect(systemsTab).toBeVisible();
    await systemsTab.click();
    await expect(page.getByRole('button', { name: '皮肤 显示/隐藏' })).toBeVisible();

    await page.screenshot({ path: 'test-results/smoke-mobile.png' });
  });
});
