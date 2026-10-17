import { defineConfig } from '@playwright/test';

// 浏览器测试（npm run test:e2e）。先构建，再在预览服务器上测试生产构建：
// 不会遇到开发服务器首次加载依赖时的整页刷新，也更接近发布版本。
// 第一次运行前执行一次：npx playwright install chromium
const PORT = 4183;

// 项目没有安装 @types/node，只声明这里用到的部分
declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // 用 Chromium 默认的 Linux UA：需要模拟 Windows 的用例（集合树指针拖动）在用例里单独设置
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
