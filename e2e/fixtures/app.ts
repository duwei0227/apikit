// 浏览器测试的公共部分：在页面里模拟 Tauri（内存文件系统、事件、HTTP），
// 打开应用，并提供读写 Pinia store、操作编辑器和检查浮层的辅助函数。
// 测试运行在生产构建的预览服务器上，只通过界面、store 和编辑器 API 驱动，不读组件内部状态。

import { test as base, expect, type Locator, type Page } from '@playwright/test';

export interface MockHttpResponse {
  status?: number;
  statusText?: string;
  contentType?: string;
  body: string;
  /** 流式响应：发送后不立即返回，由 App.pushStream 逐段推送，App.endStream 结束（body 不使用） */
  live?: boolean;
}

declare global {
  interface Window {
    __store: (name: string) => any;
    __sent: any[];
    __invokes: Array<[string, any]>;
    __mockResponse: MockHttpResponse;
    __emitTauriEvent: (event: string, payload: unknown) => void;
    /** 其它命令的模拟返回值，按命令名 */
    __invokeResults: Record<string, unknown>;
    /** 正在接收的模拟流式响应 */
    __liveStream: { requestId: string; received: string; end: () => void } | null;
    /** 模拟的文件系统：路径 → 内容 */
    __files: Map<string, string>;
  }
}

/** 在页面脚本之前注入的 Tauri 模拟 */
function tauriMock() {
  const files = new Map<string, string>();
  const dirs = new Set(['/tmp/apikit']);
  const callbacks: Record<number, (payload: unknown) => void> = {};
  const listeners: Record<string, number[]> = {};
  const norm = (p: string) => String(p).replace(/\/+$/, '');
  let nextCallbackId = 1;

  window.__files = files;
  window.__sent = [];
  window.__invokes = [];
  window.__mockResponse = { contentType: 'application/json', body: '{"ok":true}' };
  window.__liveStream = null;
  window.__invokeResults = {};
  window.__emitTauriEvent = (event, payload) => {
    (listeners[event] || []).forEach(id => callbacks[id]?.({ event, id: 0, payload }));
  };
  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  (window as any).__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    transformCallback: (fn: (payload: unknown) => void) => { const id = nextCallbackId++; callbacks[id] = fn; return id; },
    unregisterCallback: (id: number) => { delete callbacks[id]; },
    invoke: async (cmd: string, args: any, options: any) => {
      window.__invokes.push([cmd, args]);
      if (cmd === 'plugin:event|listen') {
        (listeners[args.event] ||= []).push(args.handler);
        return args.handler;
      }
      if (cmd in window.__invokeResults) return window.__invokeResults[cmd];
      if (cmd === 'plugin:path|join') return args.paths.join('/').replace(/\/+/g, '/');
      if (cmd.startsWith('plugin:path|')) return '/tmp/apikit';
      if (cmd === 'plugin:fs|exists') return files.has(norm(args.path)) || dirs.has(norm(args.path));
      if (cmd === 'plugin:fs|mkdir') { dirs.add(norm(args.path)); return null; }
      if (cmd === 'plugin:fs|write_text_file') {
        const path = norm(decodeURIComponent(options.headers.path));
        const text = new TextDecoder().decode(args);
        const append = JSON.parse(options.headers.options || 'null')?.append === true;
        files.set(path, append ? (files.get(path) || '') + text : text);
        return null;
      }
      if (cmd === 'plugin:fs|read_text_file') {
        const path = norm(args.path);
        if (!files.has(path)) throw new Error('not found');
        return Array.from(new TextEncoder().encode(files.get(path)));
      }
      if (cmd === 'plugin:fs|remove') { files.delete(norm(args.path)); return null; }
      if (cmd === 'plugin:fs|read_dir') {
        const dir = norm(args.path) + '/';
        const names = new Set<string>();
        for (const f of [...files.keys(), ...dirs]) if (f.startsWith(dir)) names.add(f.slice(dir.length).split('/')[0]);
        return [...names].map(name => ({ name, isFile: files.has(dir + name), isDirectory: dirs.has(dir + name), isSymlink: false }));
      }
      if (cmd === 'send_http_request') {
        window.__sent.push(args.options);
        const { status = 200, statusText = 'OK', contentType = 'application/json', body, live } = window.__mockResponse;
        if (live) {
          const requestId = args.options.requestId;
          window.__emitTauriEvent('http://stream', { requestId, kind: 'start', status, statusText, headers: [['content-type', contentType]], elapsedMs: 5 });
          return new Promise(resolve => {
            window.__liveStream = {
              requestId,
              received: '',
              end: () => {
                const received = window.__liveStream?.received ?? '';
                window.__liveStream = null;
                resolve({ status, statusText, headers: [['content-type', contentType]], body: received, isBase64: false, durationMs: 5, bodyBytes: received.length, streamed: true });
              },
            };
          });
        }
        return { status, statusText, headers: [['content-type', contentType]], body, isBase64: false, durationMs: 5, bodyBytes: body.length };
      }
      return null;
    },
  };
}

export class App {
  readonly errors: string[] = [];

  constructor(readonly page: Page) {
    page.on('pageerror', e => this.errors.push(e.message));
    page.on('console', m => {
      if (m.type() === 'error' || (m.type() === 'warning' && /Vue warn/.test(m.text()))) this.errors.push(m.text());
    });
  }

  async open(theme: 'light' | 'dark' = 'light') {
    await this.page.addInitScript(tauriMock);
    await this.page.addInitScript((theme) => { localStorage.setItem('theme', theme); }, theme);
    await this.page.goto('/');
    await this.page.getByText('New Collection').first().waitFor();
    await this.page.evaluate(() => {
      const app = (document.querySelector('#app') as any).__vue_app__;
      window.__store = (name: string) => app.config.globalProperties.$pinia._s.get(name);
    });
    if (theme === 'dark') await this.page.evaluate(() => document.documentElement.classList.add('p-dark'));
  }

  /** 在页面中执行，可通过 window.__store(name) 访问 Pinia store */
  run<T, A = undefined>(fn: (arg: A) => T | Promise<T>, arg?: A): Promise<T> {
    return this.page.evaluate(fn as any, arg as any) as Promise<T>;
  }

  setGlobalVariables(vars: Record<string, string>) {
    return this.run((vars) => {
      const env = window.__store('environments');
      Object.entries(vars).forEach(([key, value]) => env.setGlobalVariable(key, value, true));
    }, vars);
  }

  setMockResponse(response: MockHttpResponse) {
    return this.run((response) => { window.__mockResponse = response; }, response);
  }

  /** 向正在接收的模拟流式响应推送一段数据（setMockResponse 设置 live） */
  pushStream(data: string) {
    return this.run((data) => {
      const live = window.__liveStream;
      if (!live) throw new Error('No live stream');
      live.received += data;
      window.__emitTauriEvent('http://stream', { requestId: live.requestId, kind: 'chunk', data, elapsedMs: 10, receivedBytes: live.received.length });
    }, data);
  }

  endStream() {
    return this.run(() => window.__liveStream?.end());
  }

  /** 当前可见的请求编辑器 */
  get request(): Locator {
    return this.page.locator('.http-request:visible');
  }

  /** 请求编辑器的子页签面板（不含响应区的面板） */
  get requestPanel(): Locator {
    return this.request.locator('.request-tabs > .p-tabview-panels > .p-tabview-panel:visible');
  }

  get url(): Locator {
    return this.request.getByPlaceholder('Enter request URL');
  }

  async newRequest() {
    await this.page.getByRole('button', { name: 'New Request' }).first().click();
    await this.url.waitFor();
  }

  async requestTab(name: string) {
    await this.request.getByRole('tab', { name, exact: true }).first().click();
  }

  /** 让输入框失焦（URL 解析为 Params 在失焦时进行） */
  async blurInputs() {
    await this.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await this.page.waitForTimeout(400);
  }

  /** Params 表格：每行 "key=value"，禁用的行前面加 "!" */
  params(): Promise<string[]> {
    return this.requestPanel.evaluate(panel => {
      const keys = [...panel.querySelectorAll<HTMLInputElement>('input[placeholder=Key]')];
      const values = [...panel.querySelectorAll<HTMLInputElement>('input[placeholder=Value]')];
      return keys.map((key, i) => {
        const checkbox = key.closest('.flex.gap-2')?.querySelector<HTMLInputElement>('input[type=checkbox]');
        return `${checkbox && !checkbox.checked ? '!' : ''}${key.value}=${values[i]?.value ?? ''}`;
      });
    });
  }

  async selectBodyType(type: string) {
    await this.requestTab('Body');
    await this.requestPanel.locator('label', { hasText: new RegExp(`^${type}$`) }).click();
  }
}

/** 页面中可见的 Ace 编辑器（host 为编辑器容器） */
export class AceEditorHandle {
  constructor(readonly page: Page, readonly host: Locator) {}

  async waitReady() {
    await this.host.locator('.ace_content').waitFor();
  }

  value(): Promise<string> {
    return this.host.evaluate((el: any) => el.env.editor.getValue());
  }

  /** 设置内容和光标（| 为光标位置）并聚焦 */
  async setDoc(text: string) {
    await this.host.evaluate((el: any, text: string) => {
      const index = text.indexOf('|');
      const editor = el.env.editor;
      editor.setValue(text.replace('|', ''), -1);
      editor.moveCursorToPosition(editor.session.doc.indexToPosition(index < 0 ? text.length : index));
      editor.clearSelection();
      editor.focus();
    }, text);
    await this.page.waitForTimeout(100);
  }
}

/** 浮层是否显示在最上层并完整落在窗口内 */
export async function overlayState(page: Page, selector: string) {
  return page.evaluate((selector) => {
    const el = [...document.querySelectorAll<HTMLElement>(selector)].pop();
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const points: Array<[number, number]> = [[r.left + 10, r.top + 10], [r.left + r.width / 2, r.top + r.height / 2], [r.right - 10, r.bottom - 10]];
    const onTop = points.every(([x, y]) => { const hit = document.elementFromPoint(x, y); return !!hit && el.contains(hit); });
    const inViewport = r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
    return { onTop, inViewport, top: r.top, bottom: r.bottom };
  }, selector);
}

export async function expectOverlayVisible(page: Page, selector: string) {
  await expect(page.locator(selector).last()).toBeVisible();
  expect(await overlayState(page, selector)).toMatchObject({ onTop: true, inViewport: true });
}

/** 用 Chromium 调试协议模拟输入法组字：逐个输入拼音字母，最后提交 result */
export async function imeType(page: Page, pinyin: string, result: string) {
  const cdp = await page.context().newCDPSession(page);
  for (let i = 1; i <= pinyin.length; i++) {
    await cdp.send('Input.imeSetComposition', { text: pinyin.slice(0, i), selectionStart: i, selectionEnd: i });
  }
  await cdp.send('Input.insertText', { text: result });
  await cdp.detach();
}

export const test = base.extend<{ app: App }>({
  app: async ({ page }, use) => {
    const app = new App(page);
    await use(app);
    // 文件不存在时存储层会读到 "not found" 并按空数据处理，不算错误
    expect(app.errors.filter(message => !/not found/.test(message))).toEqual([]);
  },
});

export { expect };
