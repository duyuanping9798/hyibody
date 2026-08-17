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

/** M2-1 故事线冒烟：从菜单启动"心跳"之旅，第一步文案出现，可下一步。 */
test('heartbeat tour plays from the menu', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });

  await page.getByRole('button', { name: '故事线' }).click();
  await page.getByTestId('tour-list').getByRole('button', { name: '心跳与血液的旅程' }).click();

  const player = page.getByTestId('tour-player');
  await expect(player).toBeVisible();
  await expect(player).toContainText('心跳与血液的旅程');

  // 先暂停自动播放，再手动步进（避免 9s/步 的自动推进造成竞态）
  await player.getByRole('button', { name: '暂停' }).click();
  const progress = player.locator('.progress');
  const before = Number((await progress.innerText()).split('/')[0]);
  await player.getByRole('button', { name: '下一步' }).click();
  await expect(progress).toHaveText(`${before + 1} / 7`);

  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await page.screenshot({ path: 'test-results/smoke-tour.png' });

  await player.getByRole('button', { name: '退出' }).click();
  await expect(player).not.toBeVisible();
});

/** M2-2/M2-3 冒烟：Kiosk 闲置吸引动画出现（?idle=2 加速），分享弹层出二维码。 */
test('kiosk attract mode and share dialog', async ({ page }) => {
  await page.goto('/?kiosk=1&idle=2');
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });
  // 大按钮模式生效
  await expect(page.locator('body.hyi-kiosk')).toBeAttached();
  // 2 秒闲置后吸引动画浮层出现
  await expect(page.getByTestId('kiosk-attract')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: 'test-results/smoke-kiosk.png' });
  // 触摸退出吸引动画
  await page.mouse.click(640, 400);
  await expect(page.getByTestId('kiosk-attract')).not.toBeVisible();

  // 分享弹层：二维码 canvas 有内容
  await page.getByRole('button', { name: '分享' }).click();
  const qr = page.getByTestId('share-qr');
  await expect(qr).toBeVisible();
  const size = await qr.evaluate((c) => (c as HTMLCanvasElement).width);
  expect(size).toBeGreaterThan(100);
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
