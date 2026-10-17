import { describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

// 捕获流式事件监听器，模拟 Rust 端推送 http://stream 事件
const streamListeners: Array<(event: { payload: any }) => void> = [];
const unlisten = vi.fn();
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_name: string, handler: (event: { payload: any }) => void) => {
    streamListeners.push(handler);
    return () => {
      unlisten();
      streamListeners.splice(streamListeners.indexOf(handler), 1);
    };
  }),
}));

import { downloadHttpResponse, executeHttpRequest, prepareHttpRequest } from '@/services/http/HttpExecutionService';
import { suggestDownloadFileName } from '@/utils/download';
import { httpbinUrl } from '../helpers/httpbin';
import { emptyTests, makeRequest } from '../helpers/workflowFactory';

const emit = (payload: any) => streamListeners.forEach(listener => listener({ payload }));

describe('shared send pipeline', () => {
  it('PIPE-001 prepares the request with variables, auth and unresolved names', async () => {
    const vars: Record<string, string> = { host: 'api.example.com', token: 't1' };
    const prepared = await prepareHttpRequest(makeRequest({
      method: 'POST',
      url: 'https://{{host}}/items',
      params: [{ key: 'q', value: '{{missing}}', enabled: true }],
      headers: [{ key: 'X-Id', value: '1', enabled: true }],
      auth: { type: 'bearer', token: '{{token}}', username: '', password: '' },
      body: { type: 'json', raw: '{"a":"{{host}}"}', formData: [], urlencoded: [] },
      settings: { followRedirects: false, maxRedirectCount: 3, verifySsl: true, autoEncodeUrl: true, acceptEncoding: false },
    } as any), value => value.replace(/\{\{(\w+)\}\}/g, (match, name) => vars[name] ?? match));

    expect(prepared.url).toBe('https://api.example.com/items?q={{missing}}');
    expect(prepared.headers).toEqual({ 'X-Id': '1', Authorization: 'Bearer t1', 'Content-Type': 'application/json' });
    expect(prepared.body).toBe('{"a":"api.example.com"}');
    expect(prepared.unresolvedVariables).toEqual(['missing']);
    expect(prepared.settings.followRedirects).toBe(false);
  });

  it('PIPE-002 pushes live stream snapshots and finishes with merged test data', async () => {
    const updates: any[] = [];
    const sse = 'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n';
    vi.mocked(invoke).mockImplementationOnce(async (_command: string, payload: any) => {
      const { requestId } = payload.options;
      expect(payload.options.streamEvents).toBe(true);
      emit({ requestId: 'other', kind: 'start', status: 500, statusText: 'x', headers: [], elapsedMs: 1 });
      emit({ requestId, kind: 'start', status: 200, statusText: 'OK', headers: [['content-type', 'text/event-stream']], elapsedMs: 5 });
      emit({ requestId, kind: 'chunk', data: sse.slice(0, 40), elapsedMs: 10, receivedBytes: 40 });
      await new Promise(resolve => setTimeout(resolve, 80));
      return {
        status: 200, statusText: 'OK', headers: [['content-type', 'text/event-stream']],
        body: sse, isBase64: false, durationMs: 5, totalMs: 120, bodyBytes: sse.length, streamed: true, interrupted: null,
      };
    });

    const result = await executeHttpRequest(makeRequest({ url: 'https://api.example.com/chat', tests: emptyTests() }), {
      onStreamUpdate: response => updates.push(response),
    });

    expect(updates[0]).toMatchObject({ status: 200, size: '0B', stream: { active: true } });
    // 每次推送都是新对象，界面才能感知变化
    expect(updates[1]).not.toBe(updates[0]);
    expect(updates[1].size).toBe('40B');
    expect(result.response.stream).toMatchObject({ active: false, text: 'Hello' });
    expect(result.response.time).toBe('120ms');
    expect(JSON.parse(result.response.testBody!).text).toBe('Hello');
    expect(result.consoleLog.stream!.eventCount).toBeGreaterThan(0);
    expect(unlisten).toHaveBeenCalled();
    expect(streamListeners).toHaveLength(0);
  });

  it('PIPE-003 does not listen for stream events without a stream callback', async () => {
    const before = unlisten.mock.calls.length;
    const result = await executeHttpRequest(makeRequest({ url: httpbinUrl('/get'), tests: emptyTests() }));
    expect(result.response.status).toBe(200);
    expect(unlisten.mock.calls.length).toBe(before);
  });

  it('PIPE-004 downloads raw bytes with the same request rules', async () => {
    vi.mocked(invoke).mockImplementationOnce(async (_command: string, payload: any) => {
      expect(payload.options.headers.Authorization).toBe('Basic dTpw');
      return {
        status: 200, statusText: 'OK',
        headers: [['content-type', 'image/png'], ['content-disposition', 'attachment; filename="logo.png"']],
        body: 'iVBORw==', isBase64: true, durationMs: 3, bodyBytes: 4,
      };
    });
    const started = vi.fn();
    const download = await downloadHttpResponse(makeRequest({
      url: 'https://files.example.com/x',
      auth: { type: 'basic', token: '', username: 'u', password: 'p' },
    } as any), { onRequestStart: started });

    expect(started).toHaveBeenCalledWith(expect.stringMatching(/^req-/));
    expect([...download.bytes]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(download.size).toBe('4B');
    expect(suggestDownloadFileName(download.headers, download.url, download.contentType)).toBe('logo.png');
  });

  it('PIPE-005 suggests file names from the URL or content type', () => {
    expect(suggestDownloadFileName({}, 'https://x.com/files/report.pdf?v=1', 'application/pdf')).toBe('report.pdf');
    expect(suggestDownloadFileName({}, 'https://x.com/files/report', 'application/pdf')).toBe('report.pdf');
    expect(suggestDownloadFileName({}, 'https://x.com/', 'application/json')).toBe('download.json');
    expect(suggestDownloadFileName({}, 'not a url', '')).toBe('download');
    expect(suggestDownloadFileName({ 'content-disposition': "attachment; filename*=UTF-8''%E6%8A%A5%E5%91%8A.csv" }, '', '')).toBe('报告.csv');
  });
});
