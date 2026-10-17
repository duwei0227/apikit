// 应用中用到的外部地址：GitHub 仓库和文档站。

export const GITHUB_URL = 'https://github.com/duwei0227/apikit';
export const DOCS_URL = 'https://duwei0227.github.io/apikit/';

/** 文档站地址：语言为中文时打开中文文档，否则打开英文文档 */
export const docsUrlFor = (language: string): string => (
  language.toLowerCase().startsWith('zh') ? DOCS_URL : `${DOCS_URL}en/`
);

/** 显示用的地址：去掉协议和末尾的斜杠 */
export const displayUrl = (url: string): string => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

/** 界面中 ? 链接对应的文档章节：页面路径和中英文页面中的锚点 */
export const DOC_TOPICS = {
  workflowConditions: { page: 'guide/workflow', zh: '多个条件', en: 'several-conditions' },
  workflowLoops: { page: 'guide/workflow', zh: '循环', en: 'loops' },
  setVariables: { page: 'guide/workflow', zh: 'set-variables', en: 'set-variables' },
  extractVariables: { page: 'guide/tests', zh: '提取变量-global-variable-settings', en: 'extract-variables-global-variable-settings' },
  mockTemplate: { page: 'guide/mock', zh: '模板语法', en: 'template-syntax' },
  mcp: { page: 'guide/ai', zh: '', en: '' },
} as const;

export type DocTopic = keyof typeof DOC_TOPICS;

/** 文档章节的地址：按语言选中文或英文页面，锚点做 URL 编码 */
export const docsTopicUrl = (topic: DocTopic, language: string): string => {
  const { page, zh, en } = DOC_TOPICS[topic];
  const chinese = docsUrlFor(language) === DOCS_URL;
  const anchor = chinese ? zh : en;
  return `${docsUrlFor(language)}${page}${anchor ? `#${encodeURIComponent(anchor)}` : ''}`;
};
