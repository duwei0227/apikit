import { expect, test } from './fixtures/app';

for (const scenario of ['failure', 'cancelled', 'download']) {
test(`releases previous response before ${scenario} and keeps other request caches`, async ({ app }) => {
  await app.open();
  await app.newRequest();
  await app.url.fill('https://example.com/first');
  await app.setMockResponse({ contentType: 'text/plain', body: 'previous-response' });
  await app.request.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(app.request.locator('pre.response-pre')).toHaveText('previous-response');
  await app.run((scenario) => {
    const store = window.__store('requests');
    const [id, cache] = [...store.responseCache.entries()].find(([, c]: any) => c.response?.rawBody === 'previous-response') as any;
    store.setResponseCache('other-request', { ...cache, response: { ...cache.response, rawBody: 'other-response' } });
    const internals = (window as any).__TAURI_INTERNALS__;
    const original = internals.invoke;
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === 'send_http_request') {
        (window as any).__resetObserved = {
          response: store.getResponseCache(id)?.response,
          tests: store.getResponseCache(id)?.testResults,
          oldViewCount: document.querySelectorAll('pre.response-pre, .response-tabs .ace_editor').length,
          other: store.getResponseCache('other-request')?.response?.rawBody,
        };
        if (scenario === 'cancelled') throw 'Request cancelled';
        throw new Error('network unavailable');
      }
      return original(cmd, args);
    };
  }, scenario);
  if (scenario === 'download') {
    await app.request.locator('.p-splitbutton-dropdown').click();
    await app.page.getByText('Send And Download', { exact: true }).click();
  } else {
    await app.request.getByRole('button', { name: 'Send', exact: true }).click();
  }
  await expect.poll(() => app.run(() => (window as any).__resetObserved)).toEqual({ response: null, tests: null, oldViewCount: 0, other: 'other-response' });
  await expect(app.request).not.toContainText('previous-response');
});

}
