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
    // PWA 离线（M2-3）：预缓存全部资产（六系统 glb 共约 4 MB，远低于预算），
    // autoUpdate 静默换新版本
    VitePWA({
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
        globPatterns: ['**/*.{js,css,html,glb,json,png,woff2}'],
        maximumFileSizeToCacheInBytes: 8_000_000,
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
