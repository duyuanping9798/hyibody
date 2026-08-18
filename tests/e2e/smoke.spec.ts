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
  // 第二步会"打开心脏"（展开内部 + 隔离 + 相机飞行），软件渲染下这一帧很重
  test.setTimeout(240_000);
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
  const [before, total] = (await progress.innerText()).split('/').map((n) => Number(n.trim()));
  expect(total).toBeGreaterThan(1);
  await player.getByRole('button', { name: '下一步' }).click();
  await expect(progress).toHaveText(`${before! + 1} / ${total}`);

  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await page.screenshot({ path: 'test-results/smoke-tour.png', timeout: 120_000 });

  await player.getByRole('button', { name: '退出' }).click();
  await expect(player).not.toBeVisible();
});

/** M2-5 冒烟：中英切换按钮实时切换界面语言。 */
test('language toggle switches UI to English and back', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });
  const toggle = page.getByRole('button', { name: '切换语言 / Switch language' });
  await expect(page.locator('header')).toContainText('人体透视科普');
  await expect(toggle).toHaveText('EN');
  await toggle.click();
  await expect(page.locator('header')).toContainText('See-through Human Anatomy');
  await expect(page.getByRole('button', { name: 'Tours' })).toBeVisible();
  await expect(toggle).toHaveText('中文');
  await toggle.click();
  await expect(page.locator('header')).toContainText('人体透视科普');
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

/**
 * 回归冒烟（2026-08-18）：
 * 1) ?v= 选中后台加载的器官（心脏）也能恢复——之前首屏只有皮肤+骨骼，选中被丢掉；
 * 2) 选中结构后背景仍是深色——描边外扩量曾按物体空间算，被量化缩放放大成巨壳，
 *    整个视口糊成青色。
 */
test('share link restores an organ selection without flooding the background', async ({ page }) => {
  const state = encodeUrlState({ layer: 0.5, selected: 'heart' });
  await page.goto(`/?v=${state}`);
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });

  const infoCard = page.getByTestId('info-card');
  await expect(infoCard).toBeVisible({ timeout: 30_000 });
  await expect(infoCard).toContainText('心脏');

  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const corners = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const probe = document.createElement('canvas');
    probe.width = canvas.width;
    probe.height = canvas.height;
    const ctx = probe.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(canvas, 0, 0);
    const at = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3);
    return [at(4, 4), at(probe.width - 4, 4), at(4, probe.height - 4)];
  });
  expect(corners).not.toBeNull();
  for (const [r, g, b] of corners!) {
    // 深色舞台底：任何通道都不该被描边染亮
    expect(Math.max(r!, g!, b!)).toBeLessThan(60);
  }
  await page.screenshot({ path: 'test-results/smoke-select-organ.png' });
});

/**
 * B 步渲染升级：画质档位。
 * 云端无 GPU（SwiftShader）时自动退到 low 档并说明原因；`?hq=medium` 强制开后处理，
 * 高画质开关出现且可切换。
 */
test('quality tier falls back on software rendering and can be forced on', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });
  // 软件渲染：开关换成一句说明，不给切
  await expect(page.getByText('当前设备用软件渲染，已自动降到基础画质')).toBeVisible();

  await page.goto('/?hq=medium');
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });
  const toggle = page.getByRole('checkbox');
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(toggle).toBeChecked();
  await page.screenshot({ path: 'test-results/smoke-quality.png' });
});

/**
 * C 步界面：信息卡读 content/definitions/zh.json（blurb + "你知道吗"），
 * 选中结构时挂 3D 标签引线。
 */
test('info card shows blurb and fact, selection gets a 3D label', async ({ page }) => {
  const state = encodeUrlState({ layer: 0.45, selected: 'heart' });
  await page.goto(`/?v=${state}`);
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });

  const infoCard = page.getByTestId('info-card');
  await expect(infoCard).toBeVisible({ timeout: 30_000 });
  await expect(infoCard).toContainText('心脏');
  // 标签（系统 / 部位）
  await expect(infoCard.locator('.hyi-tags li').first()).toHaveText('器官');
  // 一句话科普来自 zh.json 的 blurb
  await expect(infoCard.locator('.blurb')).toContainText('拳头大小');
  // "你知道吗"小知识来自同一条的 fact
  await expect(infoCard.locator('.hyi-fact')).toContainText('10 万次');

  // 3D 标签引线跟着结构走
  const label = page.getByTestId('structure-label');
  await expect(label).toBeVisible();
  await expect(label.locator('.hyi-label .zh')).toHaveText('心脏');

  await page.screenshot({ path: 'test-results/smoke-infocard.png' });
});

/**
 * 剖切封盖 + 沿结构半剖：隔离心脏 → 一键把剖切面移到它中心并切掉朝向相机的那半。
 * 封盖是模板缓冲效果（截图人工比对），这里只锁住交互链路与状态。
 */
test('half-section cuts through the selected structure', async ({ page }) => {
  const state = encodeUrlState({ layer: 0.55, selected: 'heart' });
  await page.goto(`/?v=${state}`);
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('info-card')).toBeVisible({ timeout: 30_000 });

  // 剖切默认关闭时不出现"反向"
  await expect(page.getByRole('button', { name: '反向' })).toHaveCount(0);

  await page.getByRole('button', { name: '沿此结构半剖' }).click();
  // 剖切被打开：轴向按钮进入选中态，反向开关出现
  await expect(page.getByRole('button', { name: '反向' })).toBeVisible();
  await expect(page.locator('.hyi-clip-row .hyi-btn.active')).toHaveCount(1);

  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await page.screenshot({ path: 'test-results/smoke-halfcut.png' });
});

/**
 * 结构层级：选中心脏 →「展开内部」→ 父结构让位给心室壁/瓣膜等内部件，
 * 点其中一件能看到它自己的名字与科普；「收起内部」回到整颗心脏。
 */
test('opening the heart reveals its inner parts', async ({ page }) => {
  // 展开心脏要额外解 8 个内部件并重算取景，软件渲染下逼近 120 秒默认预算
  test.setTimeout(240_000);
  const state = encodeUrlState({ layer: 0.55, selected: 'heart' });
  await page.goto(`/?v=${state}`);
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });
  const infoCard = page.getByTestId('info-card');
  await expect(infoCard).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: /展开内部/ }).click();
  // 展开后父结构不再被选中，右侧面板出现"收起内部"
  await expect(page.getByRole('button', { name: '收起内部' }).first()).toBeVisible();

  // 点中间，命中某个内部件
  await page.mouse.click(500, 430);
  await expect(infoCard).toBeVisible({ timeout: 20_000 });
  await expect(infoCard.locator('h2')).not.toHaveText('心脏');
  // 心脏内部件来自 HuBMAP HRA，信息卡必须署这个源而不是 BodyParts3D
  await expect(infoCard.locator('.meta')).toContainText('HuBMAP HRA');
  await page.screenshot({ path: 'test-results/smoke-heart-parts.png' });

  await page.getByRole('button', { name: '收起内部' }).first().click();
  await expect(page.getByRole('button', { name: '收起内部' })).toHaveCount(0);
});

/** 一键"返回全身"：钻进器官内部之后总得有条出路。 */
test('back to full body clears isolation, expansion and clipping', async ({ page }) => {
  test.setTimeout(240_000);
  const state = encodeUrlState({ layer: 0.55, selected: 'heart' });
  await page.goto(`/?v=${state}`);
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('info-card')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: /展开内部/ }).click();
  await page.getByRole('button', { name: '返回全身' }).click();

  // 展开、隔离、剖切、选中全部清空
  await expect(page.getByRole('button', { name: '收起内部' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '返回全身' })).toHaveCount(0);
  await expect(page.getByTestId('info-card')).toHaveCount(0);
});

/**
 * 键盘无障碍：`/` 聚焦搜索、↑↓ 走结果、回车选中；`?` 打开快捷键说明；
 * Esc 逐层退出（先关说明页，再取消选中）。
 */
test('keyboard shortcuts drive search, help and escape', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });

  // ? 打开说明页，Esc 关掉
  await page.keyboard.press('?');
  await expect(page.getByTestId('shortcut-help')).toBeVisible();
  await page.screenshot({ path: 'test-results/smoke-shortcuts.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('shortcut-help')).toHaveCount(0);

  // / 聚焦搜索框，打字 → ↓ 走一格 → 回车选中
  await page.keyboard.press('/');
  await expect(page.locator('.hyi-search input')).toBeFocused();
  await page.keyboard.type('骨');
  await expect(page.getByTestId('search-results')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');

  const infoCard = page.getByTestId('info-card');
  await expect(infoCard).toBeVisible({ timeout: 20_000 });
  const picked = await infoCard.locator('h2').textContent();
  expect(picked?.trim()).toBeTruthy();

  // 焦点回到画布后 Esc 取消选中
  await page.locator('canvas').click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('Escape');
  await expect(infoCard).toHaveCount(0);
});

/** 英文界面下信息卡正文该是英文科普，而不是占位句。 */
test('english info card shows english blurb', async ({ page }) => {
  const state = encodeUrlState({ layer: 0.55, selected: 'heart' });
  await page.goto(`/?v=${state}`);
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });
  const infoCard = page.getByTestId('info-card');
  await expect(infoCard).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: '切换语言 / Switch language' }).click();
  await expect(infoCard.locator('h2')).toHaveText('Heart');
  await expect(infoCard.locator('.blurb')).toContainText('muscular pump');
  await expect(infoCard.locator('.blurb')).not.toContainText('coming soon');
  await expect(infoCard.locator('.hyi-fact p')).toContainText('100,000 times');
  await page.screenshot({ path: 'test-results/smoke-infocard-en.png' });
});

/**
 * HRA 第二批器官：肾在剖开层里能展开出皮质 / 锥体 / 肾门，
 * 顺带留一张腹部器官的截图给人工比对位置（脾、胰、肾都换了数据源）。
 */
test('opening the kidneys reveals cortex and pyramids', async ({ page }) => {
  test.setTimeout(240_000);
  const state = encodeUrlState({ layer: 0.62, selected: 'kidneys' });
  await page.goto(`/?v=${state}`);
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });
  const infoCard = page.getByTestId('info-card');
  await expect(infoCard).toBeVisible({ timeout: 30_000 });
  await expect(infoCard.locator('h2')).toHaveText('肾');
  // 肾也换成了 HRA，署名要跟着数据走
  await expect(infoCard.locator('.meta')).toContainText('HuBMAP HRA');
  await page.screenshot({ path: 'test-results/smoke-abdomen.png' });

  await page.getByRole('button', { name: /展开内部/ }).click();
  await expect(page.getByRole('button', { name: '收起内部' }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/smoke-kidney-parts.png' });
});
