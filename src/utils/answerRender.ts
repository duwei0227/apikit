// 大模型回答文本的展示：判断回答是 JSON、HTML、SVG、XML 还是 Markdown，并把 Markdown 转成 HTML。
// 回答来自任意服务端，这里生成的 HTML 里所有动态内容都做了转义；放进页面前还要再用 DOMPurify 清洗一遍。

import { Marked } from 'marked';
import { prettyPrintPartialJson } from './jsonFormat';

export type AnswerKind = 'markdown' | 'json' | 'html' | 'svg' | 'xml';

export interface DetectedAnswer {
  kind: AnswerKind;
  /** 去掉外层代码块标记后的内容；Markdown 为原文 */
  content: string;
}

const FENCE_KINDS: Record<string, AnswerKind> = {
  json: 'json',
  jsonc: 'json',
  html: 'html',
  htm: 'html',
  svg: 'svg',
  xml: 'xml',
};

/** 成对标签开头时按 HTML 处理的标签 */
const HTML_ROOT_TAGS = new Set([
  'html', 'body', 'head', 'div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside',
  'table', 'ul', 'ol', 'dl', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'form', 'style', 'figure', 'details',
]);

function looksLikeJsonStart(text: string): boolean {
  if (text.startsWith('{')) return /^\{\s*("|\}|$)/.test(text);
  if (text.startsWith('[')) {
    // [文字](链接) 是 Markdown 链接，不是数组
    if (/^\[[^\]\n]*\]\(/.test(text)) return false;
    return /^\[\s*([[{"\d\-tfn\]]|$)/.test(text);
  }
  return false;
}

function isCompleteJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function detectBare(text: string, streaming: boolean): AnswerKind {
  if (looksLikeJsonStart(text) && (streaming || isCompleteJson(text))) return 'json';

  const markup = text.replace(/^<\?xml[^>]*\?>\s*/i, '');
  if (/^<!doctype\s+html/i.test(markup) || /^<html[\s>]/i.test(markup)) return 'html';
  if (/^<svg[\s>]/i.test(markup)) return 'svg';
  if (markup !== text) return 'xml';

  const root = /^<([a-z][\w-]*)[\s>]/i.exec(text);
  if (root && HTML_ROOT_TAGS.has(root[1].toLowerCase())) {
    // 接收过程中还没有闭合标签，结束后要求以同名标签闭合
    if (streaming || new RegExp(`</${root[1]}\\s*>$`, 'i').test(text)) return 'html';
  }
  return 'markdown';
}

/**
 * 判断回答的类型。很多模型会把 JSON / HTML 整段包在一个代码块里，这种情况按里面的内容处理；
 * streaming 为 true 时代码块或 JSON 可以还没有收完。
 */
export function detectAnswer(text: string, streaming = false): DetectedAnswer {
  const trimmed = text.trim();
  if (!trimmed) return { kind: 'markdown', content: text };

  const fence = /^```([\w-]*)[^\n]*\n([\s\S]*)$/.exec(trimmed);
  if (fence) {
    const rest = fence[2];
    const closing = rest.indexOf('```');
    const closed = closing !== -1 && rest.slice(closing + 3).trim() === '';
    // 只有一个代码块、且后面没有别的内容时才整体处理
    if (closed || (closing === -1 && streaming)) {
      const inner = (closed ? rest.slice(0, closing) : rest).replace(/\n$/, '');
      const fenceKind = FENCE_KINDS[fence[1].toLowerCase()];
      if (fenceKind) return { kind: fenceKind, content: inner };
      if (!fence[1]) {
        const bare = detectBare(inner.trim(), streaming);
        if (bare !== 'markdown') return { kind: bare, content: inner.trim() };
      }
    }
    return { kind: 'markdown', content: text };
  }

  const kind = detectBare(trimmed, streaming);
  return { kind, content: kind === 'markdown' ? text : trimmed };
}

/** JSON 回答的格式化文本；还没收完时按已有内容排版 */
export function formatJsonAnswer(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return prettyPrintPartialJson(content);
  }
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 只保留 http、https 和 mailto 链接 */
export function safeLinkHref(href: string | null | undefined): string | null {
  const value = (href || '').trim();
  return /^(https?:|mailto:)/i.test(value) ? value : null;
}

const PREVIEWABLE_CODE = new Set(['html', 'htm', 'svg']);

const markdown = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    code({ text, lang }) {
      const language = (lang || '').trim().split(/\s+/)[0].toLowerCase();
      const code = language === 'json' || language === 'jsonc' ? formatJsonAnswer(text) : text;
      const preview = PREVIEWABLE_CODE.has(language)
        ? '<button type="button" class="md-code-button" data-action="preview">Preview</button>'
        : '';
      return `<div class="md-code" data-lang="${escapeHtml(language)}">`
        + `<div class="md-code-head"><span>${escapeHtml(language || 'text')}</span>`
        + `<span class="md-code-actions">${preview}<button type="button" class="md-code-button" data-action="copy">Copy</button></span></div>`
        + `<pre><code>${escapeHtml(code)}</code></pre></div>`;
    },
    // 回答里夹带的原始 HTML 按文本显示，不当作标签渲染
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      const safe = safeLinkHref(href);
      return safe ? `<a href="${escapeHtml(safe)}" data-action="link">${label}</a>` : label;
    },
    // 不自动加载远程图片：显示成带替代文字的链接
    image({ href, text }) {
      const label = escapeHtml(text || 'image');
      const safe = safeLinkHref(href);
      return safe
        ? `<a href="${escapeHtml(safe)}" data-action="link" class="md-image-link">${label}</a>`
        : label;
    },
  },
});

/** 把 Markdown 转成 HTML。结果还没有清洗，放进页面前必须经过 DOMPurify。 */
export function renderMarkdown(source: string): string {
  return markdown.parse(source, { async: false }) as string;
}
