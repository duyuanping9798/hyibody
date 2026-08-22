import { expect, test, type Page } from '@playwright/test';

/**
 * 演示前自检（2026-08-19 新增）。
 *
 * smoke.spec.ts 管功能对不对，这一份管**当众演示时会不会翻车**：首屏预算、
 * 展厅无人值守的自恢复、奥秘能不能一路讲完、二维码扫不扫得到、转屏、Retina。
 * 演示前跑一次 `pnpm test:e2e`，心里就有底。
 *
 * 两条口径值得写明：
 * 1. **视口按真机来**，尤其是 `deviceScaleFactor: 2`。之前整套 e2e 都跑在 DPR 1 下，
 *    结果 `setSize(w, h, false)` 把画布撑成两倍这种事故一路绿灯上线——DPR 1 的
 *    绿灯对像素比相关的改动不算数（见 DECISIONS.md 2026-08-19）。
 * 2. **点击用 `force: true`**。云端软件渲染只有 ~1 fps，Playwright 点击前要等元素
 *    「连续两帧位置不变」，这个条件在 1 fps 下基本不可能满足，正常点击 0/3 成功而
 *    强制点击 3/3 成功。这是测试环境的限制，不是应用缺陷——所以绕开可点击性检查，
 *    直接断言**点完之后状态确实变了**。
 */

const PHONE = { width: 402, height: 780 };

async function ready(page: Page, timeout = 120_000) {
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-hyi-ready', '1', { timeout });
}

/** 画布的 CSS 尺寸与容器尺寸（用来抓"画布被撑大"这类事故）。 */
async function canvasVsHost(page: Page) {
  return page.evaluate(() => {
    const host = document.querySelector('[data-testid="viewer"]')!.getBoundingClientRect();
    const canvas = document.querySelector('canvas')!.getBoundingClientRect();
    return {
      hostW: Math.round(host.width),
      hostH: Math.round(host.height),
      canvasW: Math.round(canvas.width),
      canvasH: Math.round(canvas.height),
    };
  });
}

/**
 * 画面里有多少"亮"像素——只用来判断"不是白屏/黑屏"。
 *
 * 粗采样（每 8 行 × 每 8 列）。完整扫一遍 804×1560 的画布要把 WebGL 帧缓冲
 * 读回内存再逐像素遍历，云端软件渲染下这一步能吃掉几十秒。
 */
async function litCount(page: Page) {
  return page.evaluate(() => {
    const c = document.querySelector('canvas')!;
    const probe = document.createElement('canvas');
    probe.width = c.width;
    probe.height = c.height;
    const ctx = probe.getContext('2d')!;
    ctx.drawImage(c, 0, 0);
    const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
    let lit = 0;
    for (let y = 0; y < probe.height; y += 8) {
      for (let x = 0; x < probe.width; x += 8) {
        const i = (y * probe.width + x) * 4;
        if (data[i]! + data[i + 1]! + data[i + 2]! > 110) lit++;
      }
    }
    return lit;
  });
}

/** 人体在画布上的竖向范围（按亮度阈值扫描像素）。 */
async function bodyBand(page: Page) {
  return page.evaluate(() => {
    const host = document.querySelector('[data-testid="viewer"]')!.getBoundingClientRect();
    const c = document.querySelector('canvas')!;
    const probe = document.createElement('canvas');
    probe.width = c.width;
    probe.height = c.height;
    const ctx = probe.getContext('2d')!;
    ctx.drawImage(c, 0, 0);
    const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
    let top = Infinity;
    let bottom = -1;
    let lit = 0;
    for (let y = 0; y < probe.height; y++) {
      for (let x = 0; x < probe.width; x += 3) {
        const i = (y * probe.width + x) * 4;
        // 舞台底是 #0b1020（近黑），亮度过阈值才算人体像素
        if (data[i]! + data[i + 1]! + data[i + 2]! > 110) {
          lit++;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
    const dpr = probe.width / host.width;
    return {
      lit,
      top: Math.round(top / dpr),
      bottom: Math.round(bottom / dpr),
      height: Math.round(host.height),
    };
  });
}

test.describe('演示前自检 · 手机（Retina）', () => {
  // 真机是 DPR ≥ 2；DPR 1 下跑再多用例也抓不到"画布被撑成两倍"这类事故
  test.use({ deviceScaleFactor: 2 });

  test('手机 Retina：画布不被撑大，人体完整落在界面让出的空当里', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/');
    await ready(page);
    await page.waitForTimeout(6000);

    const size = await canvasVsHost(page);
    // 两倍那种错法差着几百像素，1 px 的容差足够
    expect(Math.abs(size.canvasW - size.hostW)).toBeLessThanOrEqual(1);
    expect(Math.abs(size.canvasH - size.hostH)).toBeLessThanOrEqual(1);

    const band = await bodyBand(page);
    expect(band.lit).toBeGreaterThan(200);
    // 头顶让开顶栏、脚让开底部工具条，且不能小到看不清
    expect(band.top).toBeGreaterThan(40);
    expect(band.bottom).toBeLessThan(band.height - 100);
    expect(band.bottom - band.top).toBeGreaterThan(band.height * 0.45);
  });

  test('转屏：画布跟着容器走，人体仍在画面里', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/');
    await ready(page);
    await page.waitForTimeout(6000);

    await page.setViewportSize({ width: PHONE.height, height: PHONE.width });
    await page.waitForTimeout(4000);

    const size = await canvasVsHost(page);
    expect(Math.abs(size.canvasW - size.hostW)).toBeLessThanOrEqual(1);
    expect(Math.abs(size.canvasH - size.hostH)).toBeLessThanOrEqual(1);

    const band = await bodyBand(page);
    expect(band.lit).toBeGreaterThan(100);
    expect(band.bottom).toBeLessThan(band.height);
    await page.screenshot({ path: 'test-results/demo-landscape.png', timeout: 120_000 });
  });

  test('奥秘：深链开播并能一路讲到最后一步，末帧不空', async ({ page }) => {
    // 十步逐一走完，每步都要重新出图；云端软件渲染约 1 fps，且全量套件同时
    // 跑的时候机器更忙，预算要按最坏情况给
    test.setTimeout(600_000);
    await page.setViewportSize(PHONE);
    await page.goto('/?wonder=heartbeat');
    await ready(page);
    await page.waitForTimeout(5000);

    const player = page.getByTestId('wonder-player');
    await expect(player).toBeVisible();
    const progress = page.getByTestId('wonder-caption').locator('.progress');
    const total = Number((await progress.innerText()).split('/')[1]!.trim());
    expect(total).toBeGreaterThan(1);

    // 先停掉自动播放，再一步步走完（force 的原因见文件头）
    await player.getByRole('button', { name: '暂停' }).click({ force: true });
    const current = async () => Number((await progress.innerText()).split('/')[0]!.trim());

    // 按**实际进度**驱动，不能按 total - 1 死循环：深链是自动播放的，
    // 等点到「暂停」时进度早已自己往前走了几步；而且走到最后一步时
    // 「下一步」会变成「结束」，多点一次就会卡在找一个不存在的按钮上。
    const start = await current();
    let index = start;
    for (let guard = 0; index < total && guard <= total; guard++) {
      await player.getByRole('button', { name: '下一步' }).click({ force: true });
      await page.waitForTimeout(250);
      index = await current();
    }
    expect(index).toBe(total);
    // 起步就已经在最后一步的话，上面的循环一次没跑，等于什么都没验证
    expect(start).toBeLessThan(total);

    // 讲到最后一步不能是白屏——奥秘是演示的主菜。这里只要"画面非空"，
    // 用粗采样就够，不必做完整的包围盒扫描（那一步在软件渲染下太贵）
    expect(await litCount(page)).toBeGreaterThan(30);
    // 这里**不**截图：给 804×1560 编码 PNG 是整条用例里最贵的一步，实测单跑能过、
    // 放进全量套件就顶破预算，而它没有任何断言价值。留档交给便宜的取景用例。
  });
});

test.describe('演示前自检 · 展厅与分享', () => {
  // 展厅一体机按 DPR 1 算：2160×3840 的绘制缓冲在软件渲染下慢到没法测
  test('展厅：闲置进吸引动画，触摸即醒，按钮都够大', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1080, height: 1920 });
    await page.goto('/?kiosk=1&idle=3');
    await ready(page);
    await expect(page.locator('body.hyi-kiosk')).toBeAttached();

    await expect(page.locator('.hyi-attract')).toBeVisible({ timeout: 60_000 });
    await page.mouse.click(540, 900);
    await expect(page.locator('.hyi-attract')).toHaveCount(0, { timeout: 30_000 });

    // KICKOFF 第 6 节：展厅无键鼠，所有按钮 ≥ 56 px
    const tooSmall = await page.evaluate(() =>
      [...document.querySelectorAll('.hyi-btn')]
        .map((b) => ({
          t: b.textContent?.trim().slice(0, 8) ?? '',
          h: b.getBoundingClientRect().height,
        }))
        .filter((b) => b.h > 0 && b.h < 56)
        .map((b) => `${b.t}:${Math.round(b.h)}`),
    );
    expect(tooSmall).toEqual([]);
  });

  test('分享：二维码画得出来且够大，手机扫得到', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/');
    await ready(page);
    await page.waitForTimeout(4000);

    await page.getByRole('button', { name: '分享' }).click({ force: true });
    const qr = page.locator('.hyi-share canvas');
    await expect(qr).toBeVisible();
    const box = await qr.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(120);
  });
});
