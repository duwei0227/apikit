// 流式响应（SSE / 逐行 JSON）的解析：把收到的文本拆成事件，并从常见大模型接口的事件里
// 提取回答文本、思考内容、结束原因和 token 用量。

export type StreamFormat = 'sse' | 'ndjson';

export interface StreamEvent {
  index: number;
  /** 从发出请求到收到这个事件的毫秒数 */
  timeMs: number;
  /** SSE 的 event 字段；没有时取 JSON 里的 type / object 字段，都没有则为 message */
  event: string;
  /** 事件数据的原文 */
  data: string;
  /** data 能解析成 JSON 时的结果 */
  json?: unknown;
}

export interface StreamUsage {
  inputTokens?: number;
  outputTokens?: number;
}

/** 断言和变量提取使用的合并结果 */
export interface StreamTestObject {
  text: string;
  thinking: string;
  finishReason: string | null;
  usage: Record<string, unknown> | null;
  eventCount: number;
  events: unknown[];
  /** 自定义格式的结果事件，按事件名取最后一个事件的数据 */
  results: Record<string, unknown>;
}

/**
 * 自定义格式里文本事件之后的结果事件，例如 token 输出思考过程，result、fill 输出结果。
 * text 是事件里的文本字段，value 是 data 字段（没有文本和 data 字段时是整个事件）
 */
export interface StreamResult {
  /** 对应 events 中的 index */
  index: number;
  event: string;
  text: string;
  value?: unknown;
}

const STREAM_CONTENT_TYPES: Array<[string, StreamFormat]> = [
  ['text/event-stream', 'sse'],
  ['application/x-ndjson', 'ndjson'],
  ['application/ndjson', 'ndjson'],
  ['application/jsonl', 'ndjson'],
  ['application/x-jsonlines', 'ndjson'],
];

export function detectStreamFormat(contentType: string | undefined | null): StreamFormat | null {
  const value = (contentType || '').trim().toLowerCase();
  const match = STREAM_CONTENT_TYPES.find(([prefix]) => value.startsWith(prefix));
  return match ? match[1] : null;
}

const isObject = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const asText = (value: unknown): string => (typeof value === 'string' ? value : '');

/** 按路径取嵌套字段，中间不是对象（或数组下标不存在）时返回 undefined */
const get = (value: unknown, ...path: Array<string | number>): unknown => {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
};

const objectAt = (value: unknown, ...path: Array<string | number>): Record<string, unknown> | undefined => {
  const found = get(value, ...path);
  return isObject(found) ? found : undefined;
};

interface Delta {
  text?: string;
  thinking?: string;
  finishReason?: string;
  usage?: Record<string, unknown>;
  /** 来自自定义格式的文本事件：出现结果事件后算作思考内容 */
  custom?: boolean;
}

/** 自定义的逐段输出格式里，表示“这是一段回答文本”的事件名或 type */
const GENERIC_TEXT_EVENTS = new Set(['token', 'delta', 'chunk', 'text', 'content', 'message', 'answer']);
const GENERIC_TEXT_FIELDS = ['content', 'text', 'delta', 'token'];

/**
 * 从一个事件的 JSON 里取出增量；不认识的结构返回 null。
 * eventName 是 SSE 的 event 字段，没有时为空字符串。
 */
function extractDelta(json: unknown, eventName = ''): Delta | null {
  if (!isObject(json)) return null;

  // Anthropic Messages
  if (json.type === 'content_block_delta' && isObject(json.delta)) {
    return { text: asText(json.delta.text), thinking: asText(json.delta.thinking) };
  }
  if (json.type === 'message_start' && isObject(json.message)) {
    return { usage: objectAt(json.message, 'usage') };
  }
  if (json.type === 'message_delta') {
    return {
      finishReason: asText(get(json, 'delta', 'stop_reason')) || undefined,
      usage: objectAt(json, 'usage'),
    };
  }

  // OpenAI Responses
  if (typeof json.type === 'string' && json.type.startsWith('response.')) {
    if (json.type === 'response.output_text.delta') return { text: asText(json.delta) };
    if (json.type === 'response.reasoning_summary_text.delta' || json.type === 'response.reasoning_text.delta') {
      return { thinking: asText(json.delta) };
    }
    if (json.type === 'response.completed' || json.type === 'response.incomplete') {
      return {
        finishReason: asText(get(json, 'response', 'status')) || undefined,
        usage: objectAt(json, 'response', 'usage'),
      };
    }
    return {};
  }

  // OpenAI Chat Completions 及兼容接口
  if (Array.isArray(json.choices)) {
    const choice = json.choices[0];
    const delta = objectAt(choice, 'delta') ?? {};
    return {
      text: asText(delta.content) || asText(get(choice, 'text')),
      thinking: asText(delta.reasoning_content) || asText(delta.reasoning),
      finishReason: asText(get(choice, 'finish_reason')) || undefined,
      usage: objectAt(json, 'usage'),
    };
  }

  // Gemini
  if (Array.isArray(json.candidates)) {
    const candidate = json.candidates[0];
    const contentParts = get(candidate, 'content', 'parts');
    const parts: unknown[] = Array.isArray(contentParts) ? contentParts : [];
    let text = '';
    let thinking = '';
    parts.forEach(part => {
      const partText = get(part, 'text');
      if (typeof partText !== 'string') return;
      if (get(part, 'thought') === true) thinking += partText;
      else text += partText;
    });
    return {
      text,
      thinking,
      finishReason: asText(get(candidate, 'finishReason')) || undefined,
      usage: objectAt(json, 'usageMetadata'),
    };
  }

  // Ollama
  if (typeof json.done === 'boolean' && (isObject(json.message) || typeof json.response === 'string')) {
    const usage: Record<string, unknown> = {};
    if (typeof json.prompt_eval_count === 'number') usage.prompt_eval_count = json.prompt_eval_count;
    if (typeof json.eval_count === 'number') usage.eval_count = json.eval_count;
    return {
      text: asText(get(json, 'message', 'content')) || asText(json.response),
      thinking: asText(get(json, 'message', 'thinking')) || asText(json.thinking),
      finishReason: asText(json.done_reason) || undefined,
      usage: Object.keys(usage).length > 0 ? usage : undefined,
    };
  }

  // 自定义格式，例如 event:token + {"type":"token","content":"已"}：
  // 事件名或 type 像一段回答文本时，取其中的字符串字段；没有事件名也没有 type 时同样处理
  const kind = (eventName || asText(json.type)).toLowerCase();
  if (kind === '' || GENERIC_TEXT_EVENTS.has(kind)) {
    const field = GENERIC_TEXT_FIELDS.find(key => typeof json[key] === 'string');
    if (field) return { text: asText(json[field]), custom: true };
  }

  // 只带 usage 的收尾事件
  if (isObject(json.usage)) return { usage: json.usage };
  return null;
}

/** 没有内容时只表示流结束的事件名 */
const END_EVENTS = new Set(['done', 'end', 'finish', 'finished', 'complete', 'completed', 'stop']);

/** 结果事件的内容：文本字段和 data 字段都为空时返回 null（例如只表示结束的 done） */
function resultPayload(event: StreamEvent): Omit<StreamResult, 'index' | 'event'> | null {
  const { json, data } = event;
  if (json === undefined) return data.trim() && data !== '[DONE]' ? { text: data } : null;
  if (typeof json === 'string') return json ? { text: json } : null;
  if (!isObject(json)) return json === null ? null : { text: '', value: json };

  const field = GENERIC_TEXT_FIELDS.find(key => typeof json[key] === 'string' && json[key] !== '');
  let text = field ? asText(json[field]) : '';
  let value: unknown;
  if ('data' in json) {
    value = json.data ?? undefined;
    if (typeof value === 'string') {
      text = text ? `${text}\n\n${value}` : value;
      value = undefined;
    }
  } else if (!GENERIC_TEXT_FIELDS.some(key => key in json) && !END_EVENTS.has(event.event.toLowerCase())) {
    // 没有约定的字段时，整个事件就是结果，例如 {"type":"result","score":90}
    value = json;
  }
  return text || value !== undefined ? { text, ...(value !== undefined ? { value } : {}) } : null;
}

const firstNumber = (...values: unknown[]): number | undefined => (
  values.find((value): value is number => typeof value === 'number')
);

/** 把各家的用量字段归一成输入 / 输出 token 数 */
export function normalizeUsage(usage: Record<string, unknown> | null): StreamUsage {
  if (!usage) return {};
  return {
    inputTokens: firstNumber(usage.input_tokens, usage.prompt_tokens, usage.promptTokenCount, usage.prompt_eval_count),
    outputTokens: firstNumber(usage.output_tokens, usage.completion_tokens, usage.candidatesTokenCount, usage.eval_count),
  };
}

export class StreamAccumulator {
  readonly format: StreamFormat;
  readonly events: StreamEvent[] = [];
  /** 已收到的原始文本 */
  raw = '';
  text = '';
  thinking = '';
  finishReason: string | null = null;
  usage: Record<string, unknown> | null = null;
  /** 至少有一个事件是认识的大模型格式 */
  recognized = false;
  firstEventMs: number | null = null;
  /** 第一段和最后一段思考内容到达的时间 */
  thinkingStartMs: number | null = null;
  thinkingEndMs: number | null = null;
  /** 最近收到的文本是思考内容（之后还没有回答文本），界面据此在接收时展开 Thinking */
  thinkingLatest = false;
  /** 自定义格式的结果事件，例如 token 输出思考过程之后的 result、fill */
  readonly results: StreamResult[] = [];

  private buffer = '';
  /** 收到过自定义格式的文本事件：之后带内容的其它事件算结果 */
  private hasCustomText = false;
  /** 第一段和最后一段自定义格式文本到达的时间，出现结果事件后作为思考时间 */
  private customStartMs: number | null = null;
  private customEndMs: number | null = null;

  constructor(format: StreamFormat) {
    this.format = format;
  }

  /** 追加一段文本，返回这次新解析出来的事件数 */
  push(chunk: string, timeMs: number): number {
    if (!chunk) return 0;
    this.raw += chunk;
    this.buffer += chunk;
    const before = this.events.length;
    if (this.format === 'sse') this.drainSse(timeMs, false);
    else this.drainLines(timeMs, false);
    return this.events.length - before;
  }

  /** 流结束：处理末尾没有以空行或换行收尾的内容 */
  finish(timeMs: number): void {
    if (this.format === 'sse') this.drainSse(timeMs, true);
    else this.drainLines(timeMs, true);
  }

  toTestObject(): StreamTestObject {
    return {
      text: this.text,
      thinking: this.thinking,
      finishReason: this.finishReason,
      usage: this.usage,
      eventCount: this.events.length,
      events: this.events.map(eventValue),
      results: Object.fromEntries(this.results.map(result => [result.event, eventValue(this.events[result.index - 1])])),
    };
  }

  private drainSse(timeMs: number, flush: boolean) {
    // 事件以空行分隔，换行可能是 \n、\r\n 或 \r
    const separator = /\r\n\r\n|\n\n|\r\r/;
    for (;;) {
      const match = separator.exec(this.buffer);
      if (!match) break;
      const block = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      this.addSseBlock(block, timeMs);
    }
    if (flush && this.buffer.trim()) {
      const block = this.buffer;
      this.buffer = '';
      this.addSseBlock(block, timeMs);
    }
  }

  private addSseBlock(block: string, timeMs: number) {
    let eventName = '';
    const dataLines: string[] = [];
    block.split(/\r\n|\n|\r/).forEach(line => {
      if (!line || line.startsWith(':')) return;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') eventName = value;
      else if (field === 'data') dataLines.push(value);
    });
    if (!eventName && dataLines.length === 0) return;
    this.addEvent(eventName, dataLines.join('\n'), timeMs);
  }

  private drainLines(timeMs: number, flush: boolean) {
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline === -1) break;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.addEvent('', line, timeMs);
    }
    if (flush && this.buffer.trim()) {
      const line = this.buffer.trim();
      this.buffer = '';
      this.addEvent('', line, timeMs);
    }
  }

  private addEvent(eventName: string, data: string, timeMs: number) {
    let json: unknown;
    if (data && data !== '[DONE]') {
      try {
        json = JSON.parse(data);
      } catch {
        json = undefined;
      }
    }

    const typeFromJson = isObject(json) ? (asText(json.type) || asText(json.object)) : '';
    const event: StreamEvent = {
      index: this.events.length + 1,
      timeMs,
      event: eventName || typeFromJson || (data === '[DONE]' ? 'done' : 'message'),
      data,
      ...(json !== undefined ? { json } : {}),
    };
    this.events.push(event);
    if (this.firstEventMs === null) this.firstEventMs = timeMs;

    const delta = extractDelta(json, eventName);
    if (!delta) {
      if (this.hasCustomText) this.addResult(event);
      return;
    }
    this.recognized = true;
    if (delta.custom) {
      this.hasCustomText = true;
      if (!delta.text) return;
      // 还没有结果事件时文本就是回答，边收边显示；出现结果事件后的文本算思考内容
      if (this.results.length > 0) {
        this.addThinking(delta.text, timeMs, timeMs);
      } else {
        this.addText(delta.text);
        if (this.customStartMs === null) this.customStartMs = timeMs;
        this.customEndMs = timeMs;
      }
      return;
    }
    if (delta.text) this.addText(delta.text);
    if (delta.thinking) this.addThinking(delta.thinking, timeMs, timeMs);
    if (delta.finishReason) this.finishReason = delta.finishReason;
    if (delta.usage) this.usage = { ...(this.usage || {}), ...delta.usage };
  }

  private addText(text: string) {
    this.text += text;
    this.thinkingLatest = false;
  }

  private addThinking(text: string, startMs: number, endMs: number) {
    this.thinking += text;
    this.thinkingLatest = true;
    if (this.thinkingStartMs === null) this.thinkingStartMs = startMs;
    this.thinkingEndMs = endMs;
  }

  /** 自定义格式的文本事件之后，带内容的其它事件是结果 */
  private addResult(event: StreamEvent) {
    const payload = resultPayload(event);
    if (!payload) return;
    // 第一个结果事件：之前作为回答显示的文本改为思考内容
    if (this.results.length === 0 && this.text && this.customStartMs !== null && this.customEndMs !== null) {
      this.addThinking(this.text, this.customStartMs, this.customEndMs);
      this.text = '';
    }
    this.results.push({ index: event.index, event: event.event, ...payload });
    if (payload.text) this.text += (this.text ? '\n\n' : '') + payload.text;
  }
}

const eventValue = (event: StreamEvent): unknown => (event.json !== undefined ? event.json : event.data);

/** 一次性解析完整的流式响应体（Workflow、MCP 和历史记录不做实时展示） */
export function parseStreamBody(body: string, format: StreamFormat, timeMs = 0): StreamAccumulator {
  const accumulator = new StreamAccumulator(format);
  accumulator.push(body, timeMs);
  accumulator.finish(timeMs);
  return accumulator;
}

/** 界面和日志使用的流状态快照 */
export interface StreamView {
  format: StreamFormat;
  /** 仍在接收 */
  active: boolean;
  /** 没有正常结束的原因：stopped 为用户停止，其它为错误信息 */
  interrupted: string | null;
  events: StreamEvent[];
  eventCount: number;
  text: string;
  thinking: string;
  /** 自定义格式的结果事件；历史记录中较早保存的流没有这个字段 */
  results?: StreamResult[];
  raw: string;
  finishReason: string | null;
  usage: StreamUsage;
  recognized: boolean;
  firstEventMs: number | null;
  /** 思考内容持续的毫秒数；没有思考内容时为 null */
  thinkingMs: number | null;
  /** 最近收到的文本是思考内容；历史记录中较早保存的流没有这个字段 */
  thinkingLatest?: boolean;
  /** 每次更新加一，供界面跟随滚动 */
  revision: number;
}

export function describeStream(
  accumulator: StreamAccumulator,
  state: { active: boolean; interrupted?: string | null; revision?: number },
): StreamView {
  return {
    format: accumulator.format,
    active: state.active,
    interrupted: state.interrupted ?? null,
    events: accumulator.events,
    eventCount: accumulator.events.length,
    text: accumulator.text,
    thinking: accumulator.thinking,
    results: accumulator.results,
    raw: accumulator.raw,
    finishReason: accumulator.finishReason,
    usage: normalizeUsage(accumulator.usage),
    recognized: accumulator.recognized,
    firstEventMs: accumulator.firstEventMs,
    thinkingMs: accumulator.thinkingStartMs === null || accumulator.thinkingEndMs === null
      ? null
      : accumulator.thinkingEndMs - accumulator.thinkingStartMs,
    thinkingLatest: accumulator.thinkingLatest,
    revision: state.revision ?? 0,
  };
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '-';
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

/**
 * 思考内容是否展开：手动点过就按手动的；否则在接收时，回答还没开始输出或思考内容仍在输出
 * （例如自定义格式在结果事件之后继续输出的文本）时展开，回答开始输出或流结束后折叠。
 */
export function isThinkingOpen(state: {
  manual: boolean | null;
  hasThinking: boolean;
  hasText: boolean;
  active: boolean;
  thinkingLatest?: boolean;
}): boolean {
  if (!state.hasThinking) return false;
  if (state.manual !== null) return state.manual;
  return state.active && (!state.hasText || Boolean(state.thinkingLatest));
}
