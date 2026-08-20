import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'public/**',
      'test-results/**',
      'playwright-report/**',
      'pipeline/**',
      'prototype/**',
      // 一次性脚本（截图、量测、批量生成），已 gitignore；不进仓库的东西不该卡 lint
      'scratch/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', URL: 'readonly' },
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // 渲染核心保持纯 three.js，禁止依赖 React（CLAUDE.md 目录约定）
    files: ['src/viewer/**/*.ts', 'src/data/**/*.ts', 'src/tours/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'react', message: 'src/viewer|data|tours 禁止 import React' }] },
      ],
    },
  },
  prettier,
);
