import { describe, expect, it } from 'vitest';
import {
  StreamAccumulator,
  describeStream,
  detectStreamFormat,
  formatDuration,
  normalizeUsage,
  parseStreamBody,
} from '@/utils/streamResponse';

const sse = (data: unknown, event?: string) => `${event ? `event: ${event}\n` : ''}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;

describe('stream response parsing', () => {
  it('STREAM-001 detects streaming content types', () => {
    expect(detectStreamFormat('text/event-stream')).toBe('sse');
    expect(detectStreamFormat('Text/Event-Stream; charset=utf-8')).toBe('sse');
    expect(detectStreamFormat('application/x-ndjson')).toBe('ndjson');
    expect(detectStreamFormat('application/json')).toBeNull();
    expect(detectStreamFormat(undefined)).toBeNull();
  });

  it('STREAM-002 splits SSE events across chunk boundaries', () => {
    const accumulator = new StreamAccumulator('sse');
    // 事件被拆在两个数据块里，第二块同时带来下一个完整事件
    expect(accumulator.push('event: ping\ndata: {"a"', 10)).toBe(0);
    expect(accumulator.push(':1}\n\n: comment\n\ndata: line one\ndata: line two\r\n\r\n', 25)).toBe(2);
    expect(accumulator.push('data: tail', 30)).toBe(0);
    accumulator.finish(40);

    expect(accumulator.events.map(event => [event.index, event.timeMs, event.event, event.data])).toEqual([
      [1, 25, 'ping', '{"a":1}'],
      [2, 25, 'message', 'line one\nline two'],
      [3, 40, 'message', 'tail'],
    ]);
    expect(accumulator.events[0].json).toEqual({ a: 1 });
    expect(accumulator.events[1].json).toBeUndefined();
    expect(accumulator.firstEventMs).toBe(25);
    expect(accumulator.recognized).toBe(false);
    expect(accumulator.raw).toContain(': comment');
  });

  it('STREAM-003 merges an OpenAI chat completion stream', () => {
    const chunk = (delta: unknown, finish: string | null = null) => sse({ object: 'chat.completion.chunk', choices: [{ delta, finish_reason: finish }] });
    const body = chunk({ role: 'assistant', content: '' })
      + chunk({ reasoning_content: 'Let me think. ' })
      + chunk({ content: '你好' })
      + chunk({ content: ', world' })
      + chunk({}, 'stop')
      + sse({ object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 12, completion_tokens: 4 } })
      + sse('[DONE]');
    const accumulator = parseStreamBody(body, 'sse', 900);

    expect(accumulator.text).toBe('你好, world');
    expect(accumulator.thinking).toBe('Let me think. ');
    expect(accumulator.finishReason).toBe('stop');
    expect(normalizeUsage(accumulator.usage)).toEqual({ inputTokens: 12, outputTokens: 4 });
    expect(accumulator.recognized).toBe(true);
    expect(accumulator.events).toHaveLength(7);
    expect(accumulator.events[6]).toMatchObject({ event: 'done', data: '[DONE]' });
    expect(accumulator.events[0].event).toBe('chat.completion.chunk');

    const merged = accumulator.toTestObject();
    expect(merged).toMatchObject({ text: '你好, world', finishReason: 'stop', eventCount: 7 });
    expect(merged.usage).toEqual({ prompt_tokens: 12, completion_tokens: 4 });
    expect(merged.events[2]).toMatchObject({ choices: [{ delta: { content: '你好' } }] });
    expect(merged.events[6]).toBe('[DONE]');
  });

  it('STREAM-004 merges an Anthropic messages stream', () => {
    const body = sse({ type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 24, output_tokens: 1 } } }, 'message_start')
      + sse({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }, 'content_block_start')
      + sse({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Plan. ' } }, 'content_block_delta')
      + sse({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'A token' } }, 'content_block_delta')
      + sse({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: ' bucket' } }, 'content_block_delta')
      + sse({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 187 } }, 'message_delta')
      + sse({ type: 'message_stop' }, 'message_stop');
    const accumulator = parseStreamBody(body, 'sse');

    expect(accumulator.text).toBe('A token bucket');
    expect(accumulator.thinking).toBe('Plan. ');
    expect(accumulator.finishReason).toBe('end_turn');
    expect(normalizeUsage(accumulator.usage)).toEqual({ inputTokens: 24, outputTokens: 187 });
    expect(accumulator.events.map(event => event.event)).toContain('message_stop');
    expect(accumulator.toTestObject().events[0]).toMatchObject({ type: 'message_start' });
  });

  it('STREAM-005 merges OpenAI Responses, Gemini and Ollama streams', () => {
    const responses = parseStreamBody(
      sse({ type: 'response.created' }, 'response.created')
        + sse({ type: 'response.reasoning_summary_text.delta', delta: 'Hmm. ' })
        + sse({ type: 'response.output_text.delta', delta: 'Hi' })
        + sse({ type: 'response.output_text.delta', delta: ' there' })
        + sse({ type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 3, output_tokens: 2 } } }),
      'sse',
    );
    expect([responses.text, responses.thinking, responses.finishReason]).toEqual(['Hi there', 'Hmm. ', 'completed']);
    expect(normalizeUsage(responses.usage)).toEqual({ inputTokens: 3, outputTokens: 2 });

    const gemini = parseStreamBody(
      sse({ candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text: 'Bon' }] } }] })
        + sse({ candidates: [{ content: { parts: [{ text: 'jour' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2 } }),
      'sse',
    );
    expect([gemini.text, gemini.thinking, gemini.finishReason]).toEqual(['Bonjour', 'thinking…', 'STOP']);
    expect(normalizeUsage(gemini.usage)).toEqual({ inputTokens: 7, outputTokens: 2 });

    const ollama = parseStreamBody(
      `${JSON.stringify({ model: 'm', message: { role: 'assistant', content: 'Hel' }, done: false })}\n`
        + `${JSON.stringify({ model: 'm', message: { role: 'assistant', content: 'lo' }, done: false })}\n`
        + JSON.stringify({ model: 'm', message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 9, eval_count: 2 }),
      'ndjson',
    );
    expect([ollama.text, ollama.finishReason, ollama.events.length]).toEqual(['Hello', 'stop', 3]);
    expect(normalizeUsage(ollama.usage)).toEqual({ inputTokens: 9, outputTokens: 2 });
  });

  it('STREAM-006 keeps unknown streams as events without answer text', () => {
    const accumulator = parseStreamBody(sse({ price: 101.5 }, 'tick') + sse('plain text', 'note'), 'sse');
    expect(accumulator.recognized).toBe(false);
    expect(accumulator.text).toBe('');
    expect(accumulator.toTestObject()).toEqual({
      text: '',
      thinking: '',
      finishReason: null,
      usage: null,
      eventCount: 2,
      events: [{ price: 101.5 }, 'plain text'],
      results: {},
    });

    const view = describeStream(accumulator, { active: false, interrupted: 'stopped', revision: 3 });
    expect(view).toMatchObject({ format: 'sse', active: false, interrupted: 'stopped', eventCount: 2, recognized: false, revision: 3 });
    expect(view.usage).toEqual({});
  });

  it('STREAM-007 formats durations', () => {
    expect(formatDuration(412)).toBe('412ms');
    expect(formatDuration(6400)).toBe('6.4s');
    expect(formatDuration(null)).toBe('-');
  });

  it('STREAM-008 streams custom token text as the answer until a result event turns it into thinking', () => {
    // 与 bpp-ai 评审接口相同的格式：event 和 data 后面没有空格，token 是思考过程，result、fill 是结果
    const event = (name: string, data: unknown) => `event:${name}\ndata:${JSON.stringify(data)}\n\n`;
    const accumulator = new StreamAccumulator('sse');
    accumulator.push(event('token', { type: 'token', sessionId: null, content: '先看', data: null }), 100);
    accumulator.push(event('token', { type: 'token', sessionId: null, content: '表单摘要', data: null }), 300);
    // 还没有结果事件时 token 按回答边收边显示
    expect([accumulator.text, accumulator.thinking]).toEqual(['先看表单摘要', '']);

    accumulator.push(event('result', { type: 'result', sessionId: 's1', content: null, data: { suggestAction: '通过' } }), 500);
    // 第一个结果事件到达后，之前的文本改为思考内容
    expect([accumulator.text, accumulator.thinking]).toEqual(['', '先看表单摘要']);
    expect(accumulator.thinkingLatest).toBe(true);
    accumulator.push(event('token', { type: 'token', sessionId: null, content: '，再补充', data: null }), 600);
    accumulator.push(event('fill', { type: 'fill', sessionId: null, content: '同意。', data: null }), 700);
    accumulator.push(event('done', { type: 'done', sessionId: 's1', content: null, data: null }), 800);
    accumulator.finish(800);

    expect(accumulator.recognized).toBe(true);
    expect(accumulator.thinking).toBe('先看表单摘要，再补充');
    expect([accumulator.thinkingStartMs, accumulator.thinkingEndMs]).toEqual([100, 600]);
    expect(accumulator.text).toBe('同意。');
    expect(accumulator.results).toEqual([
      { index: 3, event: 'result', text: '', value: { suggestAction: '通过' } },
      { index: 5, event: 'fill', text: '同意。' },
    ]);
    const testObject = accumulator.toTestObject();
    expect(testObject.results).toEqual({
      result: { type: 'result', sessionId: 's1', content: null, data: { suggestAction: '通过' } },
      fill: { type: 'fill', sessionId: null, content: '同意。', data: null },
    });
    expect(testObject.events).toHaveLength(6);
  });

  it('STREAM-010 keeps custom token text as the answer when the stream has no results', () => {
    const accumulator = new StreamAccumulator('sse');
    accumulator.push(sse({ content: '你好' }, 'token'), 100);
    expect([accumulator.text, accumulator.thinking]).toEqual(['你好', '']);
    accumulator.push(sse({ content: '世界' }, 'token'), 150);
    expect([accumulator.text, accumulator.thinking]).toEqual(['你好世界', '']);

    accumulator.push(sse({ type: 'done' }, 'done') + sse('[DONE]'), 200);
    accumulator.finish(200);
    expect([accumulator.text, accumulator.thinking, accumulator.results]).toEqual(['你好世界', '', []]);
    expect([accumulator.thinkingStartMs, accumulator.thinkingEndMs]).toEqual([null, null]);
    expect(accumulator.toTestObject().results).toEqual({});
  });

  it('STREAM-013 tracks whether the latest text is thinking', () => {
    const chunk = (delta: Record<string, string>) => sse({ choices: [{ delta }] });
    const accumulator = new StreamAccumulator('sse');
    accumulator.push(chunk({ reasoning_content: '想' }), 100);
    expect(accumulator.thinkingLatest).toBe(true);
    accumulator.push(chunk({ content: '答' }), 200);
    expect(accumulator.thinkingLatest).toBe(false);

    // 自定义格式：结果事件之后继续输出的文本是思考内容，结果事件本身不改变
    const custom = new StreamAccumulator('sse');
    custom.push(sse({ content: '一' }, 'token'), 100);
    expect(custom.thinkingLatest).toBe(false);
    custom.push(sse({ content: '处理中' }, 'status') + sse({ content: '二' }, 'token'), 200);
    expect([custom.text, custom.thinking, custom.thinkingLatest]).toEqual(['处理中', '一二', true]);
    custom.push(sse({ content: '完成' }, 'fill'), 300);
    expect(custom.thinkingLatest).toBe(true);
  });

  it('STREAM-011 reads results from text, data or the whole event', () => {
    const accumulator = parseStreamBody(
      sse({ content: '思考' }, 'token')
        + sse({ score: 90 }, 'score')
        + sse('plain summary', 'summary')
        + sse({ data: '字符串数据' }, 'note')
        + sse({ type: 'complete', sessionId: 's1' }),
      'sse',
    );
    expect(accumulator.thinking).toBe('思考');
    expect(accumulator.results.map(({ event, text, value }) => [event, text, value])).toEqual([
      ['score', '', { score: 90 }],
      ['summary', 'plain summary', undefined],
      ['note', '字符串数据', undefined],
    ]);
    expect(accumulator.text).toBe('plain summary\n\n字符串数据');
  });

  it('STREAM-012 ignores events after custom text when they carry nothing', () => {
    const accumulator = parseStreamBody(
      sse({ content: '回答' }, 'token') + sse({ content: null, data: null }, 'status') + sse('', 'ping'),
      'sse',
    );
    expect([accumulator.text, accumulator.thinking, accumulator.results]).toEqual(['回答', '', []]);
  });

  it('STREAM-009 only joins text from events that look like answer text', () => {
    const plain = parseStreamBody(`data: ${JSON.stringify({ content: 'Hel' })}\n\ndata: ${JSON.stringify({ text: 'lo' })}\n\n`, 'sse');
    expect([plain.recognized, plain.text]).toEqual([true, 'Hello']);

    const named = parseStreamBody(`event: delta\ndata: ${JSON.stringify({ delta: 'a' })}\n\nevent: chunk\ndata: ${JSON.stringify({ token: 'b' })}\n\n`, 'sse');
    expect(named.text).toBe('ab');

    // 状态、日志之类的事件即使带 content 也不算回答
    const other = parseStreamBody(
      `event: status\ndata: ${JSON.stringify({ content: 'searching' })}\n\n`
        + `data: ${JSON.stringify({ type: 'log', content: 'step 1' })}\n\n`
        + `event: token\ndata: ${JSON.stringify({ content: { nested: true } })}\n\n`,
      'sse',
    );
    expect([other.recognized, other.text]).toEqual([false, '']);
  });
});
