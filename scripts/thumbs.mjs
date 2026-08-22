/**
 * 渲出卡片画廊要的缩略图（`public/thumbs/*.webp`）。
 *
 * 用法：先 `npx vite build` 再起 preview，然后 `node scripts/thumbs.mjs`。
 * 只重渲缺的图；`--force` 全部重来，`--only=<id前缀>` 只渲匹配的几张。
 *
 * 为什么一次加载跑完所有图：软件渲染下加载六个系统要一分钟，六十多张图
 * 各开一次页面就是一小时。页面用 `?thumbs=1` 暴露 `window.__hyiPose`
 * （见 src/ui/App.tsx），脚本逐个摆画面、逐个截图，全程只加载一次。
 */
import { chromium } from '@playwright/test';
import { mkdirSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.HYI_PREVIEW ?? 'http://127.0.0.1:4173/hyibody/';
const OUT = 'public/thumbs';
const SIZE = 320;
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const ONLY = args.find((a) => a.startsWith('--only='))?.slice(7);

mkdirSync(OUT, { recursive: true });

function readJsonDir(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

/**
 * 奥秘的封面挑哪一步？**不能用第一步**。
 *
 * 实测：29 则里绝大多数的第一步是"全身宽景"开场（`preset: front|hero` + 很低的
 * layer），当片头很好，当封面则是 29 张几乎一模一样的全身图——卡片墙上完全
 * 分不出哪则讲什么。改挑**第一个真正对着某个结构的特写**（有 selected、没有
 * preset），它就是这一则的主角。
 */
function coverScene(w) {
  const step = w.steps.find((s) => s.selected && !s.preset) ?? w.steps[0];
  return { ...step, text: undefined, durationMs: undefined };
}

const jobs = [
  ...readJsonDir('content/wonders').map((w) => ({
    name: `wonder-${w.id}`,
    scene: coverScene(w),
  })),
  ...readJsonDir('content/views').map((v) => ({ name: `view-${v.id}`, scene: v.view })),
].filter((j) => (ONLY ? j.name.includes(ONLY) : true));

const todo = jobs.filter((j) => FORCE || !existsSync(join(OUT, `${j.name}.webp`)));
console.log(`共 ${jobs.length} 张，需要渲 ${todo.length} 张`);
if (todo.length === 0) process.exit(0);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
// 正方形视口：卡片是 1:1，直接按 1:1 渲就不用再裁，人体也不会被裁掉手脚
const ctx = await browser.newContext({
  viewport: { width: 720, height: 720 },
  serviceWorkers: 'block',
});
const page = await ctx.newPage();
page.setDefaultTimeout(240000);
page.on('pageerror', (e) => console.log('  PAGEERROR ' + String(e).slice(0, 160)));

const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(0) + 's';

// low 而不是 medium（2026-08-22）：medium 修完 AO 分辨率并开了 MSAA 之后，
// SwiftShader 一帧要接近一分钟，逐张截图直接超时。low 档没有 AO/bloom，
// 但烘焙的腔隙顶点色照样在——封面的体积感靠它补，实测够用。
await page.goto(`${BASE}?thumbs=1&hq=low`, { waitUntil: 'load' });
await page.waitForSelector('[data-testid="viewer"][data-hyi-loaded="1"]');
await page.waitForFunction(() => typeof window.__hyiPose === 'function');
// 界面全藏起来：缩略图里不该出现搜索框、控制条、信息卡
await page.addStyleTag({
  content: `.hyi-header,.hyi-topbar,.hyi-search,.hyi-dock,.hyi-layer-slider,
            .hyi-info,.hyi-label-layer,.hyi-attribution,.hyi-wonder-menu{display:none!important}`,
});
console.log(`场景就绪 ${el()}`);

const viewer = page.locator('[data-testid="viewer"]');
let done = 0;
for (const job of todo) {
  await page.evaluate((scene) => window.__hyiPose(scene), job.scene);
  // 相机是瞬移的（poseScene 用 transitionMs:0），但材质与分层的过渡还要几帧
  await page.waitForTimeout(1800);
  const buf = await viewer.screenshot({ type: 'png', timeout: 120000 });
  const webp = await page.evaluate(
    async ([b64, size]) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, size, size);
      return c.toDataURL('image/webp', 0.82).split(',')[1];
    },
    [buf.toString('base64'), SIZE],
  );
  writeFileSync(join(OUT, `${job.name}.webp`), Buffer.from(webp, 'base64'));
  done += 1;
  if (done % 5 === 0 || done === todo.length) console.log(`  ${done}/${todo.length} (${el()})`);
}

await ctx.close();
await browser.close();
console.log(`完成 ${el()}`);
