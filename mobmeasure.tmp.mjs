import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox'] });
// 微信内置浏览器实测可视区：402 宽，扣掉标题栏与底部导航后约 640 高
const ctx = await browser.newContext({ viewport: { width: 402, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:4173/hyibody/', { waitUntil: 'load' });
await page.waitForSelector('[data-testid="viewer"][data-hyi-ready="1"]', { timeout: 180000 });
await page.waitForTimeout(11000);
await page.getByRole('button', { name: '搜索' }).click();
await page.locator('.hyi-search input').fill('左髋骨');
await page.waitForTimeout(500);
await page.locator('[data-testid="search-results"] button').first().click();
await page.waitForTimeout(5000);
const r = await page.evaluate(() => {
  const host = document.querySelector('[data-testid="viewer"]').getBoundingClientRect();
  const box = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect();
    return b.height ? { top: Math.round(b.top - host.top), bottom: Math.round(b.bottom - host.top), h: Math.round(b.height) } : null; };
  // 遮挡掩码：逐行看有没有被界面盖住
  const rects = ['.hyi-header','.hyi-topbar','.hyi-dock','.hyi-layer-slider','.hyi-info']
    .map(s => [s, box(s)]).filter(([,b]) => b);
  const covered = new Array(Math.round(host.height)).fill(false);
  for (const [,b] of rects) for (let y = Math.max(0,b.top); y < Math.min(covered.length, b.bottom); y++) covered[y] = true;
  const free = covered.filter(v => !v).length;
  // 标签落点
  const lbl = document.querySelector('.hyi-label');
  const line = document.querySelector('.hyi-label-line circle');
  const anchor = line ? { x: Math.round(+line.getAttribute('cx')), y: Math.round(+line.getAttribute('cy')) } : null;
  return { h: Math.round(host.height), rects: Object.fromEntries(rects), free,
    anchorBehindChrome: anchor ? covered[Math.min(covered.length-1, Math.max(0, anchor.y))] : null, anchor,
    labelVisible: !!lbl };
});
console.log(JSON.stringify(r, null, 1));
await page.screenshot({ path: '/tmp/claude-0/-home-user-hyibody/110d6193-3972-5780-ac17-c41a313e16c0/scratchpad/shots/mob-selected.png', timeout: 90000 });
await browser.close();
