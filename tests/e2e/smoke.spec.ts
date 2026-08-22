import { expect, test } from '@playwright/test';
import { decodeUrlState, encodeUrlState } from '../../src/data/urlState';

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

/** M2-1 奥秘冒烟：从菜单启动"心跳"之旅，第一步文案出现，可下一步。 */
test('heartbeat wonder plays from the menu', async ({ page }) => {
  // 第二步会"打开心脏"（展开内部 + 隔离 + 相机飞行），软件渲染下这一帧很重。
  //
  // 2026-08-21 全量之后又翻了一倍（478 万面，软件渲染约 1.2 秒一帧），实测首跑
  // 6.1 分钟、重试 4.0 分钟——360 秒正好卡在中间，于是每轮都判一次"首跑失败、
  // 重试通过"。这不是产品不稳，是预算没跟上资产。
  //
  // 上面那段注释原来还写着"这条不行：它是从菜单点开的，只能老老实实等"。
  // **那个理由站不住**：`?v=…selected=heart` 影响的只是后台补载的**顺序**
  // （器官排第一位），不影响"从菜单点开"这条路径本身——这个用例真正要覆盖的
  // 是画廊 → 播放器那一段，不是"冷启动要等多久"。改成带上它之后不再卡预算。
  // （2026-08-21 换成整页画廊之后又多了 29 张卡片要渲，606 秒越过了 600 秒的线。）
  test.setTimeout(600_000);
  await page.goto(`/?v=${encodeUrlState({ layer: 0, selected: 'heart' })}`);
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });

  await page.getByRole('button', { name: '奥秘' }).click();
  // 2026-08-21：下拉换成了整页卡片画廊（Gallery.tsx），入口按钮名字没变
  await page
    .getByTestId('wonder-gallery')
    .getByRole('button', { name: '心跳与血液的旅程' })
    .click();

  const player = page.getByTestId('wonder-player');
  await expect(player).toBeVisible();
  // 2026-08-22：标题与 n/m 进度从播放器 header 挪进了字幕带的 kicker
  await expect(page.getByTestId('wonder-caption')).toContainText('心跳与血液的旅程');

  // 先暂停自动播放，再手动步进（避免 9s/步 的自动推进造成竞态）
  await player.getByRole('button', { name: '暂停' }).click();
  const progress = page.getByTestId('wonder-caption').locator('.progress');
  const [before, total] = (await progress.innerText()).split('/').map((n) => Number(n.trim()));
  expect(total).toBeGreaterThan(1);
  await player.getByRole('button', { name: '下一步' }).click();
  await expect(progress).toHaveText(`${before! + 1} / ${total}`);

  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await page.screenshot({ path: 'test-results/smoke-wonder.png', timeout: 120_000 });

  await player.getByRole('button', { name: '退出' }).click();
  await expect(player).not.toBeVisible();
});

/** M2-5 冒烟：语言切换收进了「关于」弹层（2026-08-22 顶栏收拢），实时切换界面语言。 */
test('language toggle switches UI to English and back', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });
  await page.getByRole('button', { name: '关于' }).click();
  const about = page.getByTestId('about-dialog');
  await expect(about).toBeVisible();
  // 简介与署名合在同一层里：CC BY 的署名义务不能因为收拢顶栏而丢
  await expect(about).toContainText('BodyParts3D');
  const toggle = page.getByRole('button', { name: '切换语言 / Switch language' });
  await expect(page.locator('header')).toContainText('人体透视科普');
  await expect(toggle).toHaveText('EN');
  await toggle.click();
  await expect(page.locator('header')).toContainText('See-through Human Anatomy');
  await expect(toggle).toHaveText('中文');
  await toggle.click();
  await expect(page.locator('header')).toContainText('人体透视科普');
  await about.getByRole('button', { name: '关闭' }).click();
  await expect(about).toHaveCount(0);
  await expect(page.getByRole('button', { name: '奥秘' })).toBeVisible();
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

  // 分享收进了个人中心（👤）菜单：二维码 canvas 有内容
  await page.getByRole('button', { name: '个人中心' }).click();
  await page.getByTestId('personal-menu').getByRole('menuitem', { name: '分享' }).click();
  const qr = page.getByTestId('share-qr');
  await expect(qr).toBeVisible();
  const size = await qr.evaluate((c) => (c as HTMLCanvasElement).width);
  expect(size).toBeGreaterThan(100);
});

/**
 * Retina 冒烟：画布必须正好铺满容器。
 *
 * 2026-08-19 线上事故：`renderer.setSize(w, h, false)` 不更新 canvas 的 CSS 尺寸，
 * canvas 就按固有尺寸（= CSS 尺寸 × 像素比）显示。DPR 1 的机器看不出来——
 * 而 Playwright 默认就是 DPR 1，19 条 e2e 全瞎了，用户在 iPhone 上只看得见
 * 整幅画面的左上四分之一。这条专门盯着 DPR 2。
 */
test.describe('retina viewport', () => {
  test.use({ viewport: { width: 402, height: 780 }, deviceScaleFactor: 2, hasTouch: true });

  test('canvas fills its container on a 2x display', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
      timeout: 60_000,
    });
    const size = await page.evaluate(() => {
      const host = document.querySelector('[data-testid="viewer"]');
      const canvas = document.querySelector('canvas');
      if (!host || !canvas) return null;
      const h = host.getBoundingClientRect();
      const c = canvas.getBoundingClientRect();
      return { hw: h.width, hh: h.height, cw: c.width, ch: c.height, dpr: window.devicePixelRatio };
    });
    expect(size).not.toBeNull();
    expect(size!.dpr).toBe(2);
    // 允许 1 px 的舍入误差，两倍那种错法差着几百像素，一抓一个准
    expect(Math.abs(size!.cw - size!.hw)).toBeLessThanOrEqual(1);
    expect(Math.abs(size!.ch - size!.hh)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: 'test-results/smoke-retina.png' });
  });
});

/** M1-7 移动端冒烟：竖屏视口下六格控制条完整、信息卡可见、留存截图。 */
test.describe('mobile viewport', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('layer bar and info card usable on small screen', async ({ page }) => {
    const state = encodeUrlState({ layer: 0.62, selected: 'skull' });
    await page.goto(`/?v=${state}`);
    await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
      timeout: 60_000,
    });

    await expect(page.getByTestId('info-card')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('info-card')).toContainText('颅骨');

    // 六格调音台：六个推子都在（390px 宽也得一行放下），器官层主场上器官满档
    const bar = page.getByTestId('layer-bar');
    await expect(bar).toBeVisible();
    await expect(bar.getByRole('slider')).toHaveCount(6);
    await expect(bar.locator('[data-system="organs"] .hyi-chip-fader')).toHaveAttribute(
      'aria-valuenow',
      '100',
    );
    // 一行放得下：条宽不超过视口
    const box = await bar.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(390);

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
  // 软件渲染：开关换成一句说明，不给切（画质挪进了帮助面板，见 ShortcutHelp.tsx）
  await page.keyboard.press('?');
  await expect(page.getByTestId('shortcut-help')).toBeVisible();
  await expect(page.getByText('当前设备用软件渲染，已自动降到基础画质')).toBeVisible();

  await page.goto('/?hq=medium');
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });
  await page.keyboard.press('?');
  await expect(page.getByTestId('shortcut-help')).toBeVisible();
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
 * 剖切从旧分享链接恢复（2026-08-22 界面上的剖切面板砍掉了，能力留在引擎里：
 * 奥秘的剖切步骤与存量分享链接都还要用）。恢复后它算"脏状态"，
 * 「返回全身」必须出现并且能把它清干净——这是删掉面板后唯一的关闭入口。
 */
test('a legacy share link with a clip still restores and can be cleared', async ({ page }) => {
  test.setTimeout(240_000);
  const state = encodeUrlState({
    layer: 0.55,
    selected: 'heart',
    clip: { axis: 'y', pos: 0.05, flip: true },
  });
  await page.goto(`/?v=${state}`);
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('info-card')).toBeVisible({ timeout: 30_000 });

  const back = page.getByRole('button', { name: /返回全身/ });
  await expect(back).toBeVisible();
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await page.screenshot({ path: 'test-results/smoke-halfcut.png' });

  await back.click();
  await expect(page.getByRole('button', { name: /返回全身/ })).toHaveCount(0);
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

  // 搜索框常驻（2026-08-20 改回左上角），/ 只负责把焦点送过去
  await expect(page.locator('.hyi-search input')).toBeVisible();
  await expect(page.locator('.hyi-search input')).not.toBeFocused();
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

  // 语言开关在「关于」弹层里，切完关掉弹层再看卡片
  await page.getByRole('button', { name: '关于' }).click();
  await page.getByRole('button', { name: '切换语言 / Switch language' }).click();
  await page.getByTestId('about-dialog').getByRole('button', { name: 'Close' }).click();
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

/** HRA 第三批：脊髓现在是 C1–S5 的完整一条，能展开出颈 / 胸 / 腰 / 骶四段。 */
test('spinal cord spans the trunk and opens into four regions', async ({ page }) => {
  test.setTimeout(240_000);
  const state = encodeUrlState({ layer: 0.95, selected: 'spinal_cord' });
  await page.goto(`/?v=${state}`);
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });
  const infoCard = page.getByTestId('info-card');
  await expect(infoCard).toBeVisible({ timeout: 30_000 });
  await expect(infoCard.locator('h2')).toHaveText('脊髓');
  await expect(infoCard.locator('.meta')).toContainText('HuBMAP HRA');
  await page.screenshot({ path: 'test-results/smoke-spinal-cord.png' });

  await page.getByRole('button', { name: '展开内部（4）' }).click();
  await expect(page.getByRole('button', { name: '收起内部' }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/smoke-spinal-parts.png' });
});

/**
 * HRA 第四批：气道（气管 → 主支气管 → 支气管树）与眼球。
 * 支气管树与主支气管借的是气管的变换，衔接处只能靠截图人工比对。
 */
test('airway and eyes are in place', async ({ page }) => {
  test.setTimeout(240_000);
  const airway = encodeUrlState({ layer: 0.75, selected: 'bronchial_tree' });
  await page.goto(`/?v=${airway}`);
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });
  const infoCard = page.getByTestId('info-card');
  await expect(infoCard).toBeVisible({ timeout: 30_000 });
  await expect(infoCard.locator('h2')).toHaveText('支气管树');
  await page.screenshot({ path: 'test-results/smoke-airway.png' });

  const eyes = encodeUrlState({ layer: 0.62, selected: 'eyes' });
  await page.goto(`/?v=${eyes}`);
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });
  await expect(infoCard).toBeVisible({ timeout: 30_000 });
  await expect(infoCard.locator('h2')).toHaveText('眼球');
  await expect(infoCard.locator('.meta')).toContainText('HuBMAP HRA');
  await page.getByRole('button', { name: /展开内部/ }).click();
  await expect(page.getByRole('button', { name: '收起内部' }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/smoke-eyes.png' });
});

/** 点开一个结构，信息卡上应列出讲到它的奥秘，点一下就开始播。 */
test('info card lists wonders about the selected structure', async ({ page }) => {
  test.setTimeout(240_000);
  const state = encodeUrlState({ layer: 0.55, selected: 'heart' });
  await page.goto(`/?v=${state}`);
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });
  const infoCard = page.getByTestId('info-card');
  await expect(infoCard).toBeVisible({ timeout: 30_000 });
  const related = infoCard.locator('.hyi-related');
  await expect(related).toBeVisible();
  await expect(related.locator('h3')).toContainText('奥秘');
  await page.screenshot({ path: 'test-results/smoke-related-wonders.png' });

  // 点进去应该直接开播，播放器取代分层滑块出现在底部
  await related.locator('.hyi-related-item').first().click();
  await expect(page.getByTestId('wonder-player')).toBeVisible({ timeout: 20_000 });
});

/** `?wonder=<id>` 直接开播某一则奥秘——分享链接与展厅排期都靠它。 */
test('a wonder can be started straight from the url', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/?wonder=digestion');
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });
  const player = page.getByTestId('wonder-player');
  await expect(player).toBeVisible({ timeout: 30_000 });
  // 2026-08-22：进度挪进了字幕带的 kicker（播放器 header 已删）
  await expect(page.getByTestId('wonder-caption')).toContainText('1 /');
  // 不存在的 id 不该炸，安安静静回到普通视图
  await page.goto('/?wonder=nope');
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('wonder-player')).toHaveCount(0);
});

/**
 * UGC：把当前画面抓成一步，编好之后用链接分享出去，别人打开就能播。
 *
 * 这条串起整套自创奥秘的主路径。刻意把每一步拉到 20 秒——云端软件渲染下
 * 一来一回要好几秒，短步骤会在我们查到之前自己播完、播放器都没了。
 */
test('a self-made wonder can be captured, shared by link and played back', async ({ page }) => {
  test.setTimeout(420_000);
  await page.goto('/');
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });

  // 创作入口收进了个人中心（👤）菜单
  await page.getByRole('button', { name: '个人中心' }).click();
  await page.getByTestId('editor-open').click();
  const editor = page.getByTestId('wonder-editor');
  await expect(editor).toBeVisible();

  // 第一步：默认全身景
  await page.getByRole('button', { name: '把当前画面加成一步' }).click();
  const stepEditor = page.getByTestId('step-editor');
  await expect(stepEditor).toBeVisible({ timeout: 20_000 });
  await stepEditor.locator('textarea').first().fill('先看整个人。');
  await stepEditor.locator('textarea').nth(1).fill('Start with the whole body.');
  await stepEditor.locator('input[type=range]').fill('20');
  await page.getByRole('button', { name: '收起这一步' }).click();

  // 第二步：搜到心脏选中它再抓——抓出来的这一步必须带上 selected
  await page.locator('.hyi-search input').fill('心脏');
  await page.getByTestId('search-results').locator('button').first().click();
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: '把当前画面加成一步' }).click();
  await expect(stepEditor).toBeVisible({ timeout: 20_000 });
  await stepEditor.locator('textarea').first().fill('心脏在这儿。');
  await stepEditor.locator('textarea').nth(1).fill('Here is the heart.');
  await stepEditor.locator('input[type=range]').fill('20');
  await page.getByRole('button', { name: '收起这一步' }).click();

  await expect(editor.locator('.steps > li')).toHaveCount(2);
  const draft = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('hyi.wonderDraft') ?? 'null'),
  );
  expect(draft.steps[1].selected).toBe('heart');
  expect(draft.steps[1].focus).toBe(true);

  // 填完标题，问题清单就该空了
  await page.getByRole('button', { name: '基本信息' }).click();
  await editor.locator('.basics input').nth(0).fill('心脏在哪儿');
  await editor.locator('.basics input').nth(1).fill('Where the heart is');
  await expect(editor.locator('.problems')).toHaveCount(0);

  // 分享链接里装着整则奥秘，不需要后端
  const shared = await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.search = '';
    // 直接用页面里的编码函数会牵扯打包边界，这里复用界面按钮的结果更实在：
    // 从 localStorage 取草稿，按同一套 base64url 编码
    const raw = localStorage.getItem('hyi.wonderDraft')!;
    const bytes = new TextEncoder().encode(raw);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    const encoded = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    url.searchParams.set('w', encoded);
    return url.toString();
  });

  await page.goto(shared);
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });
  const player = page.getByTestId('wonder-player');
  await expect(player).toBeVisible({ timeout: 40_000 });
  // 2026-08-22：标题在字幕带的 kicker 里（播放器 header 已删）
  await expect(page.getByTestId('wonder-caption')).toContainText('心脏在哪儿');
  // 放映层跟着出来：字幕带、章节进度、黑边
  await expect(page.getByTestId('wonder-caption')).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: 'test-results/smoke-ugc-shared.png', timeout: 120_000 });
});

/** 坏掉的 ?w= 不该白屏——链接会被聊天软件截断、会被手抄错。 */
/**
 * 分享链接里的相机机位要活下来。
 *
 * 2026-08-21 修掉的 bug：`setCameraPose` 没清 `autoFramed`，界面量完面板高度
 * 后 `setSafeInsets` 会"好心"重新框一次全身，把恢复的机位顶掉。**每条分享链接
 * 都中招**，只是带 selected 的链接随后会 aimAt 到那个结构，症状被盖掉一半。
 * 所以这条故意**不选中任何结构**——纯粹分享一个角度，那才是完全失效的情形。
 */
test('share link keeps its camera angle instead of snapping back to full body', async ({
  page,
}) => {
  test.setTimeout(240_000);
  // 一个明显偏离默认全身取景的机位：贴到胸廓跟前、从左前方看
  const cam = {
    pos: [-240, -320, 430] as [number, number, number],
    target: [0, 0, 402] as [number, number, number],
  };
  const state = encodeUrlState({ layer: 0.62, cam });
  await page.goto(`/?v=${state}`);
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-loaded', '1', {
    timeout: 180_000,
  });
  // setSafeInsets 是界面量完真实高度才推进来的，等它跑过
  await page.waitForTimeout(4000);

  // 地址栏的 ?v= 只在分层/混合/显隐/剖切/选中变化时才回写，所以点一下
  // 「肌肉」的主场跳转触发它（分层动、相机不动），回写时带的是**当前**
  // 相机位姿——机位被顶掉的话这里就能读出来
  await page.getByRole('button', { name: '看肌肉层' }).click({ force: true });
  await expect
    .poll(() => new URL(page.url()).searchParams.get('v'), { timeout: 30_000 })
    .not.toBe(state);

  const after = decodeUrlState(new URL(page.url()).searchParams.get('v'));
  expect(after.cam, '回写的状态里应该有相机位姿').toBeTruthy();
  const dist = Math.hypot(
    after.cam!.pos[0] - cam.pos[0],
    after.cam!.pos[1] - cam.pos[1],
    after.cam!.pos[2] - cam.pos[2],
  );
  // 默认全身取景在 1000 毫米开外，被顶掉的话这个距离是几百毫米量级；
  // 留 60 毫米余量给分层缓动带来的细微移动
  expect(dist, `相机被挪了 ${Math.round(dist)} 毫米，机位没保住`).toBeLessThan(60);
});

test.describe('wonder player on a phone', () => {
  test.use({ viewport: { width: 402, height: 874 }, hasTouch: true });

  test('caption and control bar never overlap on a narrow screen', async ({ page }) => {
    // 2026-08-22 真机回归锁：字幕带写死 bottom:118px + 按钮折行，白色字幕
    // 直接砸进控制条、盖住标题。修法是动态锚点 + 手机图标化单行——这条
    // 断言两个层的包围盒不相交，且控制条没有折行。
    test.setTimeout(300_000);
    await page.goto('/?hq=low&wonder=aorta');
    const player = page.getByTestId('wonder-player');
    await expect(player).toBeVisible({ timeout: 240_000 });
    await player.getByRole('button', { name: '暂停' }).click();
    // 第 3 步的字幕有三行——正是真机上叠压最重的现场
    await player.getByRole('button', { name: '下一步' }).click();
    await page.waitForTimeout(4000);
    const cap = await page.getByTestId('wonder-caption').boundingBox();
    const bar = await player.boundingBox();
    expect(cap).toBeTruthy();
    expect(bar).toBeTruthy();
    expect(cap!.y + cap!.height, '字幕带的下沿压进了控制条').toBeLessThanOrEqual(bar!.y + 1);
    expect(bar!.height, '控制条折行了').toBeLessThan(90);
  });
});

test('a broken ?w= link falls back to the plain viewer', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?w=这不是base64');
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('wonder-player')).toHaveCount(0);
  // 普通界面照常在：搜索框、六格控制条
  await expect(page.locator('.hyi-search input')).toBeVisible();
  await expect(page.getByTestId('layer-bar')).toBeVisible();
});

test('局部细剖：卡片墙点一张，画面就摆成那个视角', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });
  // 骨骼是首屏之后第一个补载的，「胸廓」这张卡要等它到位才点得出东西
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-loaded', '1', {
    timeout: 240_000,
  });

  await page.getByRole('button', { name: '细剖' }).click();
  const gallery = page.getByTestId('atlas-gallery');
  await expect(gallery).toBeVisible();
  // 分类标签在，「全部」之外还有部位
  await expect(gallery.getByRole('tab', { name: '全部' })).toBeVisible();
  await expect(gallery.getByRole('tab', { name: '胸部' })).toBeVisible();

  await gallery.getByRole('button', { name: '胸廓：前面观' }).click();
  // 点完画廊自己关掉，人就站在那个视角上
  await expect(gallery).toHaveCount(0);

  // 这张视图把 layer 定在骨骼主场 0.45，并选中肋骨
  const state = await page.evaluate(() => {
    const v = new URL(location.href).searchParams.get('v');
    return v ? JSON.parse(atob(v.replace(/-/g, '+').replace(/_/g, '/'))) : null;
  });
  expect(state?.layer).toBeCloseTo(0.45, 2);
  await expect(page.locator('.hyi-info')).toContainText('肋骨');
});

/**
 * 六格调音台（2026-08-22 控制条重做）的主路径：
 * 点名字跳主场（扫描模式）→ 拖/键一个推子进入混合模式 → 独立值不受曲线钳制
 * → 链接带 mix → 重开链接还原。混合是这轮改造的全部新行为，值得一条完整链路。
 */
test('layer mixer: individual faders, mix in the share url, restore on reload', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.goto(`/?v=${encodeUrlState({ layer: 0.45 })}`);
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });

  const bar = page.getByTestId('layer-bar');
  const skeleton = bar.locator('[data-system="skeleton"] .hyi-chip-fader');
  const organs = bar.locator('[data-system="organs"] .hyi-chip-fader');
  // 骨骼主场：骨骼满档，器官只有曲线给的 8% 底噪
  await expect(skeleton).toHaveAttribute('aria-valuenow', '100');
  await expect(organs).toHaveAttribute('aria-valuenow', '8');

  // 键盘压骨骼三档：100 → 85（KEY_STEP 5%），首次触碰即固化进混合模式
  await skeleton.focus();
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowDown');
  await expect(skeleton).toHaveAttribute('aria-valuenow', '85');
  // 器官独立拉满——扫描曲线在这一档只肯给 8%，混合模式下不受它钳制
  await organs.focus();
  await page.keyboard.press('End');
  await expect(organs).toHaveAttribute('aria-valuenow', '100');

  // 回写的 ?v= 带 mix；等防抖落地
  await expect
    .poll(() => decodeUrlState(new URL(page.url()).searchParams.get('v')).mix?.organs, {
      timeout: 30_000,
    })
    .toBe(1);
  const encoded = new URL(page.url()).searchParams.get('v')!;
  expect(decodeUrlState(encoded).mix?.skeleton).toBeCloseTo(0.85, 2);

  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await page.screenshot({ path: 'test-results/smoke-mixer.png', timeout: 120_000 });

  // 重开这条链接：混合原样还原
  await page.goto(`/?v=${encoded}`);
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });
  await expect(bar.locator('[data-system="organs"] .hyi-chip-fader')).toHaveAttribute(
    'aria-valuenow',
    '100',
  );
  await expect(bar.locator('[data-system="skeleton"] .hyi-chip-fader')).toHaveAttribute(
    'aria-valuenow',
    '85',
  );
});

test('奥秘画廊：整页卡片墙，按系统分标签', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', {
    timeout: 60_000,
  });

  await page.getByRole('button', { name: '奥秘' }).click();
  const gallery = page.getByTestId('wonder-gallery');
  await expect(gallery).toBeVisible();
  await expect(gallery.getByRole('tab', { name: '全部' })).toBeVisible();
  // 29 则内置奥秘都该在「全部」里
  const cards = gallery.locator('.hyi-card');
  expect(await cards.count()).toBeGreaterThanOrEqual(25);

  // 切到「器官」标签，卡片数变少但不为零
  await gallery.getByRole('tab', { name: '器官' }).click();
  const organCount = await cards.count();
  expect(organCount).toBeGreaterThan(0);
  expect(organCount).toBeLessThan(29);

  // 关掉之后回到普通界面
  await gallery.getByRole('button', { name: '关闭' }).click();
  await expect(gallery).toHaveCount(0);
  await expect(page.getByTestId('layer-bar')).toBeVisible();

  // 点一张卡：奥秘开演，**画廊必须一起消失**。
  // 这条是真 bug 的回归锁：startWonder 原来只清 activePanel、不清 gallery，
  // 于是画廊整页盖在播放器上，里面的缩略图吃掉所有点击，播放器一个按钮都按不到。
  // 放在这条快用例里而不是「心跳」那条十分钟的用例里——它值得早点红。
  await page.getByRole('button', { name: '奥秘' }).click();
  await expect(page.getByTestId('wonder-gallery')).toBeVisible();
  await page.getByTestId('wonder-gallery').locator('.hyi-card').first().click();
  await expect(page.getByTestId('wonder-gallery')).toHaveCount(0);
  const player = page.getByTestId('wonder-player');
  await expect(player).toBeVisible();
  // 按得到才算真的没被盖住
  await player.getByRole('button', { name: '暂停' }).click();
  await expect(player.getByRole('button', { name: '播放' })).toBeVisible();
});
