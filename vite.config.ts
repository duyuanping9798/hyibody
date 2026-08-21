/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages 部署在 /hyibody/ 子路径下，CI 通过 VITE_BASE 注入；
// 本地开发与自定义域名默认 '/'。
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    react(),
    // PWA 离线（M2-3）：**首屏预缓存 + 其余运行时缓存**，autoUpdate 静默换新版本。
    //
    // 2026-08-20 全量之后资产是 30 MB，muscles.glb 一个就 9.45 MB。原来那份配置
    // 是"预缓存全部 glb、单文件上限 8 MB"，直接把构建挂掉了。把上限抬到 10 MB
    // 是错的解法：那等于每个访客一进门就得在 Service Worker 安装期吞完 30 MB，
    // 手机流量和弱网上尤其恶劣，而且装到一半断了整个 SW 都装不上。
    //
    // 现在的分法跟加载架构对齐：**预缓存 = 首屏**（应用外壳 + manifest + 皮肤，
    // 约 2 MB），**其余五个系统走 CacheFirst 运行时缓存**——用过一次就存下来，
    // 之后离线可用。代价说清楚：**冷启动就断网时只有皮肤**，要完整离线得先在线
    // 完整看过一遍。
    VitePWA({
      // 单文件预览构建（scripts/build-preview.mjs）里没有 Service Worker 环境，
      // 用 HYI_NO_PWA=1 关掉，免得控制台一片红
      disable: process.env.HYI_NO_PWA === '1',
      registerType: 'autoUpdate',
      manifest: {
        name: 'HyiBody 人体透视科普',
        short_name: 'HyiBody',
        description: '三维分层查看核心解剖结构的科普网页',
        lang: 'zh-CN',
        display: 'standalone',
        orientation: 'any',
        theme_color: '#0b1020',
        background_color: '#0b1020',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
      workbox: {
        // glb 里只预缓存皮肤（首屏那一份），其余五个系统交给下面的运行时缓存
        globPatterns: ['**/*.{js,css,html,json,png,woff2}', '**/assets/skin.glb'],
        maximumFileSizeToCacheInBytes: 4_000_000,
        runtimeCaching: [
          {
            urlPattern: /\/assets\/[^/]+\.glb$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'hyi-systems',
              // 6 个系统 + 换版本时的新旧并存，留一倍余量
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
