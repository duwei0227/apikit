import { describe, expect, it } from 'vitest';
import { displayUrl, docsTopicUrl, docsUrlFor } from '@/utils/appLinks';

describe('app links', () => {
  it('opens the Chinese documentation for Chinese and the English one otherwise', () => {
    expect(docsUrlFor('zh-CN')).toBe('https://duwei0227.github.io/apikit/');
    expect(docsUrlFor('zh-TW')).toBe('https://duwei0227.github.io/apikit/');
    expect(docsUrlFor('ZH')).toBe('https://duwei0227.github.io/apikit/');
    expect(docsUrlFor('en-US')).toBe('https://duwei0227.github.io/apikit/en/');
    expect(docsUrlFor('')).toBe('https://duwei0227.github.io/apikit/en/');
  });

  it('shows addresses without the protocol and trailing slash', () => {
    expect(displayUrl('https://duwei0227.github.io/apikit/en/')).toBe('duwei0227.github.io/apikit/en');
    expect(displayUrl('https://github.com/duwei0227/apikit')).toBe('github.com/duwei0227/apikit');
  });

  it('links help icons to the matching documentation section', () => {
    expect(docsTopicUrl('workflowConditions', 'en-US')).toBe('https://duwei0227.github.io/apikit/en/guide/workflow#several-conditions');
    expect(docsTopicUrl('workflowConditions', 'zh-CN'))
      .toBe(`https://duwei0227.github.io/apikit/guide/workflow#${encodeURIComponent('多个条件')}`);
    expect(docsTopicUrl('mockTemplate', 'en')).toBe('https://duwei0227.github.io/apikit/en/guide/mock#template-syntax');
    expect(docsTopicUrl('mcp', 'zh-CN')).toBe('https://duwei0227.github.io/apikit/guide/ai');
  });
});
