import { describe, expect, it } from 'vitest';
import { detectAnswer, formatJsonAnswer, renderMarkdown, safeLinkHref } from '@/utils/answerRender';
import { isThinkingOpen, parseStreamBody } from '@/utils/streamResponse';
import { htmlPreviewAllowsScripts } from '@/constants/htmlPreview';

describe('answer rendering', () => {
  it('ANSWER-001 detects JSON, HTML, SVG and XML answers', () => {
    expect(detectAnswer('  {"a": [1, 2]}\n')).toEqual({ kind: 'json', content: '{"a": [1, 2]}' });
    expect(detectAnswer('[1, 2, 3]').kind).toBe('json');
    expect(detectAnswer('<!DOCTYPE html><html><body>x</body></html>').kind).toBe('html');
    expect(detectAnswer('<div class="card"><p>x</p></div>').kind).toBe('html');
    expect(detectAnswer('<svg viewBox="0 0 1 1"><rect/></svg>').kind).toBe('svg');
    expect(detectAnswer('<?xml version="1.0"?><svg></svg>').kind).toBe('svg');
    expect(detectAnswer('<?xml version="1.0"?><order id="1"/>').kind).toBe('xml');
  });

  it('ANSWER-002 keeps ordinary text as Markdown', () => {
    expect(detectAnswer('# Title\n\nSome **bold** text.').kind).toBe('markdown');
    expect(detectAnswer('[docs](https://example.com) explain it').kind).toBe('markdown');
    expect(detectAnswer('{not json} but prose').kind).toBe('markdown');
    expect(detectAnswer('{"a": 1} and then prose').kind).toBe('markdown');
    expect(detectAnswer('<div>open only').kind).toBe('markdown');
    expect(detectAnswer('<custom-tag>x</custom-tag>').kind).toBe('markdown');
    expect(detectAnswer('Use `<div>` for blocks.').kind).toBe('markdown');
    expect(detectAnswer('').kind).toBe('markdown');
  });

  it('ANSWER-003 unwraps an answer that is one fenced code block', () => {
    expect(detectAnswer('```json\n{"a": 1}\n```')).toEqual({ kind: 'json', content: '{"a": 1}' });
    expect(detectAnswer('```html\n<p>hi</p>\n```\n')).toEqual({ kind: 'html', content: '<p>hi</p>' });
    expect(detectAnswer('```\n{"a": 1}\n```').kind).toBe('json');
    // 代码块前后还有别的内容，或者是别的语言，仍然按 Markdown
    expect(detectAnswer('```json\n{"a": 1}\n```\nDone.').kind).toBe('markdown');
    expect(detectAnswer('Here:\n```json\n{"a": 1}\n```').kind).toBe('markdown');
    expect(detectAnswer('```python\nprint(1)\n```').kind).toBe('markdown');
  });

  it('ANSWER-004 decides early while the answer is still streaming', () => {
    expect(detectAnswer('{"items": [{"id": 1', true)).toEqual({ kind: 'json', content: '{"items": [{"id": 1' });
    expect(detectAnswer('{"items": [{"id": 1', false).kind).toBe('markdown');
    expect(detectAnswer('```json\n{"a": ', true)).toEqual({ kind: 'json', content: '{"a":' });
    expect(detectAnswer('<div class="card"><p>par', true).kind).toBe('html');
    expect(detectAnswer('[link](https://exa', true).kind).toBe('markdown');
    expect(detectAnswer('```python\nprint(', true).kind).toBe('markdown');
  });

  it('ANSWER-005 formats complete and partial JSON', () => {
    expect(formatJsonAnswer('{"a":[1,2],"b":{"c":"x"}}')).toBe('{\n  "a": [\n    1,\n    2\n  ],\n  "b": {\n    "c": "x"\n  }\n}');
    expect(formatJsonAnswer('{"a":[1,{"b":"x, y"')).toBe('{\n  "a": [\n    1,\n    {\n      "b": "x, y"');
  });

  it('ANSWER-006 renders Markdown with escaped code, safe links and no images', () => {
    const html = renderMarkdown([
      '## Title',
      '',
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '```html',
      '<script>alert(1)</script>',
      '```',
      '',
      '```json',
      '{"a":1}',
      '```',
      '',
      '[ok](https://example.com/x?a=1&b=2) [bad](javascript:alert(1)) ![logo](https://example.com/logo.png)',
      '',
      '<img src=x onerror=alert(1)>',
    ].join('\n'));

    expect(html).toContain('<h2>Title</h2>');
    expect(html).toContain('<table>');
    expect(html).toContain('data-lang="html"');
    expect(html).toContain('data-action="preview"');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    // json 代码块自动格式化，没有 Preview 按钮
    expect(html).toContain('{\n  &quot;a&quot;: 1\n}');
    expect(html.match(/data-action="preview"/g)).toHaveLength(1);
    expect(html).toContain('<a href="https://example.com/x?a=1&amp;b=2" data-action="link">ok</a>');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<img');
    expect(html).toContain('class="md-image-link">logo</a>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('ANSWER-007 renders an unclosed code block as code', () => {
    const html = renderMarkdown('Intro\n\n```python\nclass TokenBucket:\n    pass');
    expect(html).toContain('data-lang="python"');
    expect(html).toContain('class TokenBucket:');
    expect(html).toContain('<p>Intro</p>');
  });

  it('ANSWER-008 only allows http, https and mailto links', () => {
    expect(safeLinkHref('https://example.com')).toBe('https://example.com');
    expect(safeLinkHref(' mailto:a@example.com ')).toBe('mailto:a@example.com');
    expect(safeLinkHref('javascript:alert(1)')).toBeNull();
    expect(safeLinkHref('data:text/html,<script>')).toBeNull();
    expect(safeLinkHref('/relative')).toBeNull();
    expect(safeLinkHref(null)).toBeNull();
  });

  it('ANSWER-009 opens thinking while it streams and folds it when the answer starts', () => {
    const base = { manual: null, hasThinking: true, hasText: false, active: true };
    expect(isThinkingOpen(base)).toBe(true);
    expect(isThinkingOpen({ ...base, hasText: true })).toBe(false);
    expect(isThinkingOpen({ ...base, active: false })).toBe(false);
    expect(isThinkingOpen({ ...base, hasThinking: false })).toBe(false);
    // 手动点过之后不再自动改变
    expect(isThinkingOpen({ ...base, hasText: true, manual: true })).toBe(true);
    expect(isThinkingOpen({ ...base, manual: false })).toBe(false);
    // 思考内容仍在输出时，即使已有回答或结果也展开；流结束后折叠
    expect(isThinkingOpen({ ...base, hasText: true, thinkingLatest: true })).toBe(true);
    expect(isThinkingOpen({ ...base, hasText: true, thinkingLatest: true, active: false })).toBe(false);
  });

  it('ANSWER-010 records how long the thinking lasted', () => {
    const accumulator = parseStreamBody('', 'sse');
    const chunk = (delta: unknown) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
    accumulator.push(chunk({ reasoning_content: 'a' }), 400);
    accumulator.push(chunk({ reasoning_content: 'b' }), 1900);
    accumulator.push(chunk({ content: 'answer' }), 2100);
    expect([accumulator.thinkingStartMs, accumulator.thinkingEndMs]).toEqual([400, 1900]);
  });

  it('ANSWER-011 offers running preview scripts only where the isolation was verified', () => {
    expect(htmlPreviewAllowsScripts('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)')).toBe(true);
    expect(htmlPreviewAllowsScripts('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/120.0')).toBe(false);
    expect(htmlPreviewAllowsScripts('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15')).toBe(false);
    expect(htmlPreviewAllowsScripts('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36')).toBe(false);
    expect(htmlPreviewAllowsScripts('')).toBe(false);
  });
});
