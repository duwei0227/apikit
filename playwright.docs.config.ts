import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// 文档截图（npm run docs:screenshots）：在生产构建上打开各界面截图，保存到 docs/public/screenshots。
// 与浏览器测试共用预览服务器和 Tauri 模拟；界面变化后重新运行即可更新截图。
export default defineConfig({
  ...base,
  testDir: 'docs/screenshots',
  testMatch: '**/*.shots.ts',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: { ...base.use, viewport: { width: 1280, height: 800 }, trace: 'off', screenshot: 'off' },
});
